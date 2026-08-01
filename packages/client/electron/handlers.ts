// IPC handlers: front-desk operations executed against the LOCAL DB (offline-first).
// Mirrors the server route logic using shared services (executePayment, executeRecharge, db-helpers).
// After each mutation the sync loop will push it to the cloud automatically.
import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import { getPrisma } from './db.js';
import { getDeviceIdentity, saveDeviceIdentity, getServerUrl, setServerUrl as saveServerUrl } from './device.js';
import { syncOnce, getSyncStatus, onSyncStatus } from './sync.js';
import {
  PrismaClient, executePayment, executeRecharge, PaymentError, loadMemberDetail, loadBalances,
  type DeviceIdentity,
  computeTier, computeAge, memberDaysSince, isPendingReview, reviewDaysRemaining, computeBatchExpiry,
  type BeanExpirySetting,
  LEDGER_FIELD, LEDGER_SOURCE, DISCOUNT_TYPE, BEAN_REDEEM_MULTIPLE, DEPT, DEFAULT_REVIEW_DAYS, REVIEW_STATUS,
  parseYuanToCents,
} from '@clinic/shared';

function p() { return getPrisma(); }
function stamp(input: any) {
  const dev = getDeviceIdentity();
  if (!dev) return input;
  return { ...input, storeId: dev.storeId, storeName: dev.storeName, deviceId: dev.deviceId };
}
// Verify the sensitive-edit (CHANGE) password against the SERVER. Passwords are
// DB-stored on the server only (never pulled to client devices), so the Electron
// client must round-trip to verify. Offline => sensitive edits are unavailable
// (same premise as backend admin login). Used by updateExam / updateMember so
// that "改内容+密码" is verified in the same operation as the write, matching the
// HTTP path (server route verifies inline) — not a separate pre-verify step whose
// result the client could then ignore.
async function verifyChangePasswordOnline(password: string): Promise<boolean> {
  const base = getServerUrl().replace(/\/+$/, '');
  const r = await fetch(`${base}/api/auth/verify-change`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password || '' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('无法连接服务器验证修改密码');
  const data = (await r.json()) as { ok: boolean };
  return !!data.ok;
}
async function beanSetting(): Promise<BeanExpirySetting> {
  const [en, mo] = await Promise.all([
    p().setting.findUnique({ where: { key: 'beanExpiry.enabled' } }),
    p().setting.findUnique({ where: { key: 'beanExpiry.months' } }),
  ]);
  return { enabled: en?.value === 'true', months: mo ? Number(mo.value) : null };
}

export function registerHandlers(getWin: () => BrowserWindow | null) {
  // ---- device + sync ----
  ipcMain.handle('clinic:pingServer', async () => {
    try { const r = await fetch(`${getServerUrl()}/api/ping`, { signal: AbortSignal.timeout(5000) }); return { ok: r.ok, url: getServerUrl() }; }
    catch { return { ok: false, url: getServerUrl() }; }
  });
  ipcMain.handle('clinic:getDevice', () => getDeviceIdentity());
  // Server URL management (set before device bind; lets front desk point at remote cloud).
  ipcMain.handle('clinic:getServerUrl', () => getServerUrl());
  ipcMain.handle('clinic:setServerUrl', (_e, url: string) => { saveServerUrl(url); return getServerUrl(); });
  ipcMain.handle('clinic:registerDevice', async (_e, input: any) => {
    const res = await fetch(`${getServerUrl()}/api/device/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || '注册失败');
    }
    const identity = (await res.json()) as DeviceIdentity;
    saveDeviceIdentity(identity);
    // upsert store + device locally so the device row exists in local cache
    await p().store.upsert({ where: { id: identity.storeId }, update: { name: identity.storeName }, create: { id: identity.storeId, code: identity.storeCode, name: identity.storeName } });
    return identity;
  });
  ipcMain.handle('clinic:getSyncStatus', () => getSyncStatus());
  ipcMain.handle('clinic:syncNow', async () => { try { return await syncOnce(); } catch (e: any) { return { error: e.message }; } });

  // forward sync status updates to renderer
  onSyncStatus((s) => { getWin()?.webContents.send('clinic:syncStatus', s); });

  // A: backend admin login — verifies the shared backend password against the
  // SERVER (single source of truth, same hash the browser admin uses) and returns
  // a server-issued session token. The renderer embeds the admin SPA with
  // ?token=<token> so it auto-logs-in. Re-entering /admin always asks for the
  // password again (no long-term免密).
  ipcMain.handle('clinic:adminLogin', async (_e, password: string) => {
    const base = getServerUrl().replace(/\/+$/, '');
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || '' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || '登录失败（无法连接服务器或密码错误）');
    }
    const data = (await r.json()) as { token: string; expiresAt: number };
    return { token: data.token, serverUrl: base };
  });

  // ---- customer dedup + member search ----
  ipcMain.handle('clinic:dedupCustomer', async (_e, { phone, name }: any) => {
    if (!phone) return { found: false };
    const customers = await p().customer.findMany({ where: { phone, deletedAt: null }, include: { member: true } });
    if (customers.length === 0) return { found: false };
    const exact = customers.find((c) => c.name === name);
    if (exact) return { found: true, mode: 'reuse', customer: exact };
    return { found: true, mode: 'conflict', customers };
  });
  ipcMain.handle('clinic:searchMembers', async (_e, { q, byCard }: any) => {
    if (!q) return { items: [] };
    const where = byCard
      ? { OR: [{ cardNo: { contains: q } }, { cardNo: { endsWith: q } }] }
      : { OR: [{ customer: { name: { contains: q } } }, { customer: { phone: { contains: q } } }, { cardNo: { contains: q } }] };
    const items = await p().member.findMany({ where, include: { customer: true }, take: 30 });
    // Attach balances so the payment page can show balance/points without an extra round-trip.
    const enriched = await Promise.all(items.map(async (m: any) => {
      const balances = await loadBalances(p(), m.id).catch(() => ({ balanceCents: 0, beans: 0, points: 0 }));
      return { ...m, balances };
    }));
    return { items: enriched };
  });

  // ---- member register / detail / list / adjust ----
  ipcMain.handle('clinic:registerMember', async (_e, input: any) => {
    const { name, phone, cardNo, birthday, address, registeredById, registeredByName, initialBalanceCents = 0, initialBeans = 0, customerId: existingCustomerId } = input;
    if (!name || !phone || !cardNo || !birthday || !registeredById) throw new Error('姓名、手机号、卡号、生日、登记人必填');
    if (await p().member.findUnique({ where: { cardNo } })) throw new Error('该会员卡号已存在');
    const setting = await beanSetting();
    const dev = stamp(input);
    const result = await p().$transaction(async (tx) => {
      let customer = existingCustomerId ? await tx.customer.findUnique({ where: { id: existingCustomerId } }) : null;
      if (!customer) {
        customer = await tx.customer.create({ data: { id: uuid(), name, phone, birthday: new Date(birthday), address, isMember: true, createdByStaffId: registeredById, createdByStoreId: dev.storeId, createdByDeviceId: dev.deviceId } });
      } else if (customer.isMember && customer.memberId) throw new Error('该客户已是会员');
      const memberId = uuid();
      const member = await tx.member.create({ data: { id: memberId, customerId: customer.id, cardNo, registeredBy: registeredById, registeredByName: registeredByName || '', registeredStoreId: dev.storeId, registeredStoreName: dev.storeName, registeredAt: new Date() } });
      await tx.customer.update({ where: { id: customer.id }, data: { isMember: true, memberId } });
      if (Number(initialBalanceCents) > 0) {
        await tx.ledger.create({ data: { id: uuid(), memberId, field: LEDGER_FIELD.BALANCE, delta: Number(initialBalanceCents), source: LEDGER_SOURCE.INIT, reason: '开卡初始余额', refType: 'INIT', operatorId: registeredById, operatorName: registeredByName || '', storeId: dev.storeId, storeName: dev.storeName, deviceId: dev.deviceId, syncStatus: 'PENDING', origin: 'CLIENT' } });
      }
      if (Number(initialBeans) > 0) {
        const batchId = uuid();
        await tx.beanBatch.create({ data: { id: batchId, memberId, remaining: Number(initialBeans), total: Number(initialBeans), expiresAt: computeBatchExpiry(new Date(), setting), source: 'INIT', refId: member.id } });
        await tx.ledger.create({ data: { id: uuid(), memberId, field: LEDGER_FIELD.BEANS, delta: Number(initialBeans), source: LEDGER_SOURCE.INIT, reason: '开卡初始豆', refType: 'INIT', beanBatchId: batchId, operatorId: registeredById, operatorName: registeredByName || '', storeId: dev.storeId, storeName: dev.storeName, deviceId: dev.deviceId, syncStatus: 'PENDING', origin: 'CLIENT' } });
      }
      return member;
    });
    return loadMemberDetail(p(), result.id);
  });

  ipcMain.handle('clinic:getMember', async (_e, id: string) => {
    const detail = await loadMemberDetail(p(), id);
    if (!detail) throw new Error('会员不存在');
    const tiers = await p().tierRule.findMany({ orderBy: { minPoints: 'asc' } });
    return { ...detail, tier: computeTier(detail.balances.points, tiers as any), age: computeAge(detail.customer?.birthday) };
  });

  ipcMain.handle('clinic:listMembers', async (_e, filters: any) => {
    const { tier: tierLevel, storeId, dateFrom, dateTo } = filters || {};
    const ageMin = filters.ageMin ? Number(filters.ageMin) : undefined;
    const ageMax = filters.ageMax ? Number(filters.ageMax) : undefined;
    const where: any = { status: 'ACTIVE', deletedAt: null };
    if (storeId) where.registeredStoreId = storeId;
    if (dateFrom || dateTo) { where.registeredAt = {}; if (dateFrom) where.registeredAt.gte = new Date(dateFrom); if (dateTo) where.registeredAt.lte = new Date(dateTo + 'T23:59:59'); }
    const members = await p().member.findMany({ where, include: { customer: true, ledgers: true }, orderBy: { registeredAt: 'desc' } });
    const tiers = await p().tierRule.findMany({ orderBy: { minPoints: 'asc' } });
    const now = new Date();
    let rows = await Promise.all(members.map(async (m) => {
      const bal = await loadBalances(p(), m.id, now);
      const tier = computeTier(bal.points, tiers as any);
      const dueExam = await p().examRecord.findFirst({ where: { customerId: m.customerId, deletedAt: null, voidedAt: null, reviewStatus: { in: ['PENDING', 'CONTACTED'] }, reviewDate: { lte: new Date(now.getTime() + 7 * 86400000) } } });
      return { id: m.id, cardNo: m.cardNo, name: m.customer?.name, phone: m.customer?.phone, birthday: m.customer?.birthday, age: computeAge(m.customer?.birthday), tierName: tier.name, tierLevel: tier.level, points: bal.points, beans: bal.spendableBeans, balanceCents: bal.balanceCents, registeredAt: m.registeredAt, daysSince: memberDaysSince(m.registeredAt, now), registeredBy: m.registeredByName, registeredStoreName: m.registeredStoreName, registeredStoreId: m.registeredStoreId, pendingReview: !!dueExam };
    }));
    if (tierLevel) rows = rows.filter((r) => r.tierLevel === Number(tierLevel));
    if (ageMin !== undefined) rows = rows.filter((r) => (r.age ?? -1) >= ageMin);
    if (ageMax !== undefined) rows = rows.filter((r) => (r.age ?? Infinity) <= ageMax);
    rows.sort((a, b) => { if (a.pendingReview !== b.pendingReview) return a.pendingReview ? -1 : 1; return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(); });
    return { items: rows };
  });

  ipcMain.handle('clinic:adjustLedger', async (_e, { memberId, input }: any) => {
    const { field, delta, reason, operatorId, operatorName, cashReceivedYuan } = input || {};
    if (!field || delta === undefined) throw new Error('字段和增减量必填');
    if (!reason || !reason.trim()) throw new Error('必须填写备注原因');
    const setting = await beanSetting();
    const dev = stamp(input);
    const id = uuid();
    // When adjusting BALANCE with a positive delta (充值), the user may also
    // enter the actual cash received. That creates a Recharge record so the
    // revenue report's cash pool reflects real cash-in (otherwise the cash
    // pool would always be 0 for manual balance edits).
    const cashReceivedCents = (field === LEDGER_FIELD.BALANCE && Number(delta) > 0 && cashReceivedYuan)
      ? parseYuanToCents(cashReceivedYuan) : 0;
    await p().$transaction(async (tx) => {
      if (field === LEDGER_FIELD.BEANS && Number(delta) > 0) {
        const batchId = uuid();
        await tx.beanBatch.create({ data: { id: batchId, memberId, remaining: Number(delta), total: Number(delta), expiresAt: computeBatchExpiry(new Date(), setting), source: 'AWARD', refId: id } });
      } else if (field === LEDGER_FIELD.BEANS && Number(delta) < 0) {
        const batches = await tx.beanBatch.findMany({ where: { memberId } });
        // 用 Ledger 重算 batch.remaining，防止 LWW 同步合并导致存储值虚高、
        // FIFO 选中实际已耗尽的批次。
        const beanLedgers = await tx.ledger.findMany({ where: { memberId, field: LEDGER_FIELD.BEANS } });
        const { selectFIFOConsume, recomputeBatchesFromLedger } = await import('@clinic/shared');
        const reconciled = recomputeBatchesFromLedger(batches as any, beanLedgers as any);
        const plan = selectFIFOConsume(reconciled, Math.abs(Number(delta)));
        let left = Math.abs(Number(delta));
        for (const pl of plan) { const take = Math.min(left, pl.consume); await tx.beanBatch.update({ where: { id: pl.batchId }, data: { remaining: { decrement: take } } }); left -= take; }
      }
      await tx.ledger.create({ data: { id, memberId, field, delta: Number(delta), source: LEDGER_SOURCE.ADJUST, reason, refType: 'ADJUST', operatorId: operatorId || '前台', operatorName: operatorName || '前台', storeId: dev.storeId, storeName: dev.storeName, deviceId: dev.deviceId, syncStatus: 'PENDING', origin: 'CLIENT' } });
      // If this is a recharge (positive balance + cash received), create a Recharge row.
      if (cashReceivedCents > 0) {
        const m = await tx.member.findUnique({ where: { id: memberId } });
        if (m) {
          await tx.recharge.create({ data: { id: uuid(), memberId, cardNo: m.cardNo, cashPaid: cashReceivedCents, balanceAdded: Number(delta), beansGifted: 0, pointsGifted: 0, note: reason, operatorId: operatorId || '前台', operatorName: operatorName || '前台', storeId: dev.storeId, storeName: dev.storeName, deviceId: dev.deviceId } });
        }
      }
    });
    return { ok: true };
  });

  ipcMain.handle('clinic:updateMember', async (_e, { memberId, input }: any) => {
    const member = await p().member.findUnique({ where: { id: memberId }, include: { customer: true } });
    if (!member) throw new Error('会员不存在');
    const { name, phone, address, birthday, changePassword } = input || {};
    const customer = member.customer!;
    // §password-flow: verify the CHANGE password inline (same operation as the
    // write) when the phone is being changed — mirrors the server route. The
    // Electron client round-trips to the server because passwords aren't local.
    const touchingSensitive = phone !== undefined && phone !== customer.phone;
    if (touchingSensitive) {
      const ok = await verifyChangePasswordOnline(changePassword || '');
      if (!ok) throw new Error('修改手机号需要敏感信息修改密码验证通过');
    }
    if (touchingSensitive) {
      await p().phoneHistory.create({ data: { id: uuid(), customerId: customer.id, oldPhone: customer.phone, newPhone: phone, changedBy: input.operatorId || '前台', changedByName: input.operatorName || '前台', storeId: stamp(input).storeId, reason: input.reason || '前台修改手机号' } });
    }
    await p().customer.update({ where: { id: customer.id }, data: { name, phone: touchingSensitive ? phone : undefined, address, birthday: birthday ? new Date(birthday) : undefined } });
    return { ok: true };
  });

  // ---- exams ----
  ipcMain.handle('clinic:createExam', async (_e, input: any) => {
    const { customerId, name, phone, address, birthday, dept, templateId, templateName, content, lensBrand, lensPrice, frameBrand, framePrice, totalAmount, reviewDate, reviewerId, reviewerName, reviewNote, registeredById, registeredByName, registeredAt } = input || {};
    if (!name || !phone || !dept || !registeredById) throw new Error('姓名、手机号、部门、登记人必填');
    if (dept === DEPT.OPTICAL && (lensPrice == null || framePrice == null)) throw new Error('配镜部镜片和镜架价格必填');
    if (dept === DEPT.EYE && totalAmount == null) throw new Error('眼科部总金额必填');
    const dev = stamp(input);
    let customer = customerId ? await p().customer.findUnique({ where: { id: customerId } }) : null;
    if (!customer) {
      const existing = await p().customer.findFirst({ where: { phone, name } });
      customer = existing ?? await p().customer.create({ data: { id: uuid(), name, phone, birthday: birthday ? new Date(birthday) : null, address, createdByStaffId: registeredById, createdByStoreId: dev.storeId, createdByDeviceId: dev.deviceId } });
    }
    const baseAmount = dept === DEPT.OPTICAL ? (Number(lensPrice) || 0) + (Number(framePrice) || 0) : (Number(totalAmount) || 0);
    const review = reviewDate ? new Date(reviewDate) : new Date(Date.now() + DEFAULT_REVIEW_DAYS * 86400000);
    // 登记时间可自定义（默认当前时间）；允许补录历史登记。
    const regAt = registeredAt ? new Date(registeredAt) : new Date();
    const exam = await p().examRecord.create({ data: { id: uuid(), customerId: customer.id, dept, templateId: templateId || null, templateName: templateName || null, content: content ? JSON.stringify(content) : null, lensBrand: lensBrand || null, lensPrice: dept === DEPT.OPTICAL ? Number(lensPrice) : null, frameBrand: frameBrand || null, framePrice: dept === DEPT.OPTICAL ? Number(framePrice) : null, totalAmount: dept === DEPT.EYE ? Number(totalAmount) : null, baseAmount, reviewDate: review, reviewerId: reviewerId || null, reviewerName: reviewerName || null, reviewStatus: 'PENDING', reviewNote: reviewNote || null, registeredBy: registeredById, registeredByName: registeredByName || '', registeredStoreId: dev.storeId, registeredStoreName: dev.storeName, registeredDeviceId: dev.deviceId, registeredAt: regAt } });
    return exam;
  });

  ipcMain.handle('clinic:getExam', async (_e, id: string) => {
    const exam = await p().examRecord.findUnique({ where: { id }, include: { customer: { include: { member: true } }, payment: true } });
    if (!exam) throw new Error('检查记录不存在');
    // B.6: history excludes voided unpaid drafts. §2.4: KEEPS discarded revisions.
    const history = await p().examRecord.findMany({ where: { customerId: exam.customerId, deletedAt: null, voidedAt: null, id: { not: exam.id } }, orderBy: { registeredAt: 'desc' } });
    // §2.4: if this record was superseded, find the newer revision for the banner link.
    let revisedBy: { id: string; createdAt: Date } | null = null;
    if (exam.discardedAt) {
      const newer = await p().examRecord.findFirst({ where: { revisesExamId: exam.id }, select: { id: true, createdAt: true } });
      if (newer) revisedBy = newer;
    }
    return { exam: { ...exam, content: exam.content ? JSON.parse(exam.content) : [] }, customer: exam.customer, history, age: computeAge(exam.customer?.birthday), revisedBy };
  });

  ipcMain.handle('clinic:listExams', async (_e, filters: any) => {
    const { dept, storeId, status, include } = filters || {};
    const daysToReview = filters.daysToReview ? Number(filters.daysToReview) : undefined;
    const where: any = { deletedAt: null, voidedAt: null };
    // §2.4: hide discarded revisions unless explicitly requested.
    if (include !== 'discarded') where.discardedAt = null;
    if (dept) where.dept = dept;
    if (storeId) where.registeredStoreId = storeId;
    if (status) where.reviewStatus = status;
    // B.6: default only PAID exams; include=unpaid shows the 待支付 drafts.
    // When showing discarded revisions, don't enforce the payment filter.
    if (include !== 'unpaid' && include !== 'discarded') where.payment = { isNot: null };
    const exams = await p().examRecord.findMany({ where, include: { customer: true, payment: true }, orderBy: { registeredAt: 'desc' } });
    const now = new Date();
    let rows = exams.map((e) => ({ id: e.id, dept: e.dept, deptLabel: e.dept === DEPT.OPTICAL ? '配镜部' : '眼科部', customerName: e.customer?.name, phone: e.customer?.phone, age: computeAge(e.customer?.birthday), registeredBy: e.registeredByName, registeredAt: e.registeredAt, registeredStoreName: e.registeredStoreName, registeredStoreId: e.registeredStoreId, reviewDate: e.reviewDate, reviewStatus: e.reviewStatus, daysToReview: reviewDaysRemaining(e.reviewDate, now), needsReview: isPendingReview(e as any, now), lensBrand: e.lensBrand, frameBrand: e.frameBrand, baseAmount: e.baseAmount, hasPayment: !!e.payment, discardedAt: e.discardedAt, revisesExamId: e.revisesExamId }));
    if (daysToReview !== undefined) rows = rows.filter((r) => r.daysToReview !== null && r.daysToReview <= daysToReview);
    const rank = (r: any) => (r.reviewStatus === REVIEW_STATUS.CONTACTED_NO_SHOW ? 2 : r.needsReview ? 0 : 1);
    rows.sort((a, b) => { const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb; return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(); });
    return { items: rows };
  });

  // B.6: void an unpaid draft (sets voidedAt; only allowed when no payment exists).
  ipcMain.handle('clinic:voidExam', async (_e, id: string) => {
    const exam = await p().examRecord.findUnique({ where: { id }, include: { payment: true } });
    if (!exam) throw new Error('检查记录不存在');
    if (exam.voidedAt) throw new Error('该记录已作废');
    if (exam.payment) throw new Error('已支付的记录不能作废，如需删除请走回收站');
    await p().examRecord.update({ where: { id }, data: { voidedAt: new Date() } });
    return { ok: true };
  });

  ipcMain.handle('clinic:updateReview', async (_e, { id, input }: any) => {
    const { reviewStatus, reviewerId, reviewerName, reviewNote } = input || {};
    if (!reviewStatus || !['PENDING', 'CONTACTED', 'CONTACTED_NO_SHOW', 'REVIEWED'].includes(reviewStatus)) throw new Error('无效复查状态');
    return p().examRecord.update({ where: { id }, data: { reviewStatus, reviewerId, reviewerName, reviewNote } });
  });

  // 敏感操作二次确认：校验 CHANGE 密码（向服务器验证，Password 表不下发到客户端）。
  // 离线时无法验证 -> 编辑历史检查单必须在线（与后台登录一致的前提）。
  ipcMain.handle('clinic:verifyChange', async (_e, password: string) => {
    const base = getServerUrl().replace(/\/+$/, '');
    const r = await fetch(`${base}/api/auth/verify-change`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || '' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || '无法连接服务器验证修改密码');
    }
    return (await r.json()) as { ok: boolean };
  });

  // 修改检查单（版本化保留 §2.2 + 密码同次校验 §password-flow）：
  // 不覆盖旧记录，而是标记旧记录 discardedAt + 新建一条修正版（revisesExamId 指向旧记录）。
  // 旧记录上的 Payment 不动（历史收款不可改写）。新记录初始未支付，如涉及金额变化走"继续支付"。
  // 密码随提交一起校验（向服务器验证，与 HTTP 路径的 server route 一致），不是单独的预校验。
  ipcMain.handle('clinic:updateExam', async (_e, { id, input }: any) => {
    const exam = await p().examRecord.findUnique({ where: { id } });
    if (!exam) throw new Error('检查记录不存在');
    const { changePassword: cp } = input || {};
    const ok = await verifyChangePasswordOnline(cp || '');
    if (!ok) throw new Error('修改检查单需要敏感信息修改密码验证通过');
    const {
      dept, templateId, templateName, content,
      lensBrand, lensPrice, frameBrand, framePrice, totalAmount,
      reviewDate, reviewerId, reviewerName, reviewNote,
      registeredById, registeredByName, registeredAt,
    } = input || {};
    const d = dept || exam.dept;
    const baseAmount = d === DEPT.OPTICAL
      ? (Number(lensPrice ?? exam.lensPrice) || 0) + (Number(framePrice ?? exam.framePrice) || 0)
      : (Number(totalAmount ?? exam.totalAmount) || 0);
    const newId = uuid();
    const now = new Date();
    // 1. Mark old record discarded. 2. Create revision with modified values.
    // Immutable associations (customerId/store/device) carry over from old.
    const [/* _old */, created] = await p().$transaction([
      p().examRecord.update({ where: { id: exam.id }, data: { discardedAt: now } }),
      p().examRecord.create({
        data: {
          id: newId,
          customerId: exam.customerId,
          dept: d,
          templateId: templateId !== undefined ? (templateId || null) : exam.templateId,
          templateName: templateName !== undefined ? (templateName || null) : exam.templateName,
          content: content !== undefined ? (content ? JSON.stringify(content) : null) : exam.content,
          lensBrand: lensBrand !== undefined ? (lensBrand || null) : exam.lensBrand,
          lensPrice: lensPrice !== undefined ? (d === DEPT.OPTICAL ? Number(lensPrice) : null) : exam.lensPrice,
          frameBrand: frameBrand !== undefined ? (frameBrand || null) : exam.frameBrand,
          framePrice: framePrice !== undefined ? (d === DEPT.OPTICAL ? Number(framePrice) : null) : exam.framePrice,
          totalAmount: totalAmount !== undefined ? (d === DEPT.EYE ? Number(totalAmount) : null) : exam.totalAmount,
          baseAmount,
          reviewDate: reviewDate !== undefined ? new Date(reviewDate) : exam.reviewDate,
          reviewerId: reviewerId !== undefined ? (reviewerId || null) : exam.reviewerId,
          reviewerName: reviewerName !== undefined ? (reviewerName || null) : exam.reviewerName,
          reviewStatus: exam.reviewStatus,
          reviewNote: reviewNote !== undefined ? (reviewNote || null) : exam.reviewNote,
          registeredBy: registeredById !== undefined ? registeredById : exam.registeredBy,
          registeredByName: registeredByName !== undefined ? registeredByName : exam.registeredByName,
          registeredStoreId: exam.registeredStoreId,
          registeredStoreName: exam.registeredStoreName,
          registeredDeviceId: exam.registeredDeviceId,
          registeredAt: registeredAt ? new Date(registeredAt) : exam.registeredAt,
          revisesExamId: exam.id,
          discardedAt: null,
        },
      }),
    ]);
    return created;
  });

  // ---- payment + recharge (use shared services) ----
  ipcMain.handle('clinic:createPayment', async (_e, input: any) => {
    const setting = await beanSetting();
    const dev = stamp(input);
    return executePayment(p(), { ...input, ...dev, beanExpiry: setting });
  });
  ipcMain.handle('clinic:createRecharge', async (_e, input: any) => {
    const setting = await beanSetting();
    const dev = stamp(input);
    return executeRecharge(p(), { ...input, ...dev, beanExpiry: setting });
  });

  // ---- config reads ----
  ipcMain.handle('clinic:getStaff', () => p().staff.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }));
  ipcMain.handle('clinic:getTiers', () => p().tierRule.findMany({ orderBy: { minPoints: 'asc' } }));
  ipcMain.handle('clinic:getTemplates', (_e, dept?: string) => p().examTemplate.findMany({ where: { deletedAt: null, ...(dept ? { dept } : {}) }, orderBy: { createdAt: 'asc' } }).then((t) => t.map((x) => ({ ...x, pages: x.pages ? JSON.parse(x.pages) : [] }))));
  ipcMain.handle('clinic:getBrands', (_e, type?: string) => p().brand.findMany({ where: { deletedAt: null, ...(type ? { type } : {}) }, orderBy: [{ sortIndex: 'asc' }, { name: 'asc' }] }));
  ipcMain.handle('clinic:getStores', () => p().store.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } }));
  ipcMain.handle('clinic:getSettings', async () => { const items = await p().setting.findMany(); const o: Record<string, string> = {}; for (const s of items) o[s.key] = s.value; return o; });
}
