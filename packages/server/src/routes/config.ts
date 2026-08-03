// Admin config CRUD: stores, devices, staff, tier rules, exam templates, brands, settings.
// All routes require backend session (mounted under requireBackend).
import { Router } from 'express';
import { prisma } from '../db.js';
import { MAX_TIERS, MAX_TEMPLATES_PER_DEPT, DEPT } from '@clinic/shared';

export const configRouter = Router();

// ---------- Stores ----------
configRouter.get('/stores', async (_req, res) => {
  const items = await prisma.store.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } });
  res.json(items);
});
configRouter.post('/stores', async (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: '门店编码和名称必填' });
  try {
    const s = await prisma.store.create({ data: { code, name } });
    res.json(s);
  } catch (e: any) {
    res.status(400).json({ error: '门店编码已存在' });
  }
});
configRouter.put('/stores/:id', async (req, res) => {
  const { name, code } = req.body || {};
  const s = await prisma.store.update({ where: { id: req.params.id }, data: { name, code } });
  res.json(s);
});
configRouter.delete('/stores/:id', async (req, res) => {
  // soft delete + 给 code 加后缀释放唯一约束，允许新建相同编码的门店
  const store = await prisma.store.findUnique({ where: { id: req.params.id } });
  if (!store) return res.status(404).json({ error: '门店不存在' });
  await prisma.store.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date(), code: `${store.code}_deleted_${Date.now()}` },
  });
  res.json({ ok: true });
});

// ---------- Devices ----------
configRouter.get('/devices', async (_req, res) => {
  const items = await prisma.device.findMany({ include: { store: true }, orderBy: { boundAt: 'desc' } });
  res.json(items);
});
configRouter.delete('/devices/:id', async (req, res) => {
  await prisma.device.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Staff ----------
configRouter.get('/staff', async (_req, res) => {
  const items = await prisma.staff.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  res.json(items);
});
configRouter.post('/staff', async (req, res) => {
  const { name, code, depts, isMember, memberId, phone, active } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: '姓名和工号必填' });
  try {
    const s = await prisma.staff.create({ data: { name, code, depts: depts || 'OPTICAL', isMember: !!isMember, memberId: memberId || null, phone, active: active ?? true } });
    res.json(s);
  } catch (e: any) { res.status(400).json({ error: '工号已存在' }); }
});
configRouter.put('/staff/:id', async (req, res) => {
  const { name, code, depts, isMember, memberId, phone, active } = req.body || {};
  const s = await prisma.staff.update({ where: { id: req.params.id }, data: { name, code, depts, isMember, memberId, phone, active } });
  res.json(s);
});
configRouter.delete('/staff/:id', async (req, res) => {
  // soft delete + 给 code 加后缀释放唯一约束，允许新建相同工号的店员
  const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
  if (!staff) return res.status(404).json({ error: '店员不存在' });
  await prisma.staff.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date(), code: `${staff.code}_deleted_${Date.now()}` },
  });
  res.json({ ok: true });
});

// ---------- Tier rules (max 20) ----------
configRouter.get('/tiers', async (_req, res) => {
  const items = await prisma.tierRule.findMany({ orderBy: { minPoints: 'asc' } });
  res.json(items);
});
configRouter.post('/tiers', async (req, res) => {
  const count = await prisma.tierRule.count();
  if (count >= MAX_TIERS) return res.status(400).json({ error: `最多 ${MAX_TIERS} 个档位` });
  const { name, minPoints, clearEnabled, clearPeriod, clearMonth, clearDay, sortOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: '档位名称必填' });
  // level = next available
  const max = await prisma.tierRule.aggregate({ _max: { level: true } });
  const level = (max._max.level ?? 0) + 1;
  const t = await prisma.tierRule.create({ data: { name, minPoints: Number(minPoints) || 0, level, sortOrder: sortOrder ?? level, clearEnabled: !!clearEnabled, clearPeriod: clearPeriod || null, clearMonth: clearMonth ?? null, clearDay: clearDay ?? null } });
  res.json(t);
});
configRouter.put('/tiers/:id', async (req, res) => {
  const { name, minPoints, clearEnabled, clearPeriod, clearMonth, clearDay, sortOrder } = req.body || {};
  const t = await prisma.tierRule.update({ where: { id: req.params.id }, data: { name, minPoints: minPoints !== undefined ? Number(minPoints) : undefined, clearEnabled, clearPeriod, clearMonth, clearDay, sortOrder } });
  res.json(t);
});
configRouter.delete('/tiers/:id', async (req, res) => {
  await prisma.tierRule.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Exam templates (max 10 per dept) ----------
configRouter.get('/templates', async (req, res) => {
  const dept = req.query.dept as string | undefined;
  const items = await prisma.examTemplate.findMany({ where: { deletedAt: null, ...(dept ? { dept } : {}) }, orderBy: { createdAt: 'asc' } });
  res.json(items.map((t) => ({ ...t, pages: t.pages ? JSON.parse(t.pages) : [] })));
});
configRouter.post('/templates', async (req, res) => {
  const { name, dept, pages } = req.body || {};
  if (!name || !dept) return res.status(400).json({ error: '模板名称和部门必填' });
  const count = await prisma.examTemplate.count({ where: { dept, deletedAt: null } });
  if (count >= MAX_TEMPLATES_PER_DEPT) return res.status(400).json({ error: `${dept === DEPT.OPTICAL ? '配镜部' : '眼科部'}最多 ${MAX_TEMPLATES_PER_DEPT} 个模板` });
  const t = await prisma.examTemplate.create({ data: { name, dept, pages: JSON.stringify(pages || []) } });
  res.json(t);
});
configRouter.put('/templates/:id', async (req, res) => {
  const { name, pages, isActive } = req.body || {};
  const t = await prisma.examTemplate.update({ where: { id: req.params.id }, data: { name, pages: pages ? JSON.stringify(pages) : undefined, isActive } });
  res.json(t);
});
configRouter.delete('/templates/:id', async (req, res) => {
  await prisma.examTemplate.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// ---------- Brands (lens / frame) ----------
configRouter.get('/brands', async (req, res) => {
  const type = req.query.type as string | undefined;
  const items = await prisma.brand.findMany({ where: { deletedAt: null, ...(type ? { type } : {}) }, orderBy: [{ sortIndex: 'asc' }, { name: 'asc' }] });
  res.json(items);
});
configRouter.post('/brands', async (req, res) => {
  const { name, type, sortIndex, active } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: '品牌名称和类型必填' });
  const b = await prisma.brand.create({ data: { name, type, sortIndex: sortIndex ?? 0, active: active ?? true } });
  res.json(b);
});
configRouter.put('/brands/:id', async (req, res) => {
  const { name, sortIndex, active } = req.body || {};
  const b = await prisma.brand.update({ where: { id: req.params.id }, data: { name, sortIndex, active } });
  res.json(b);
});
configRouter.delete('/brands/:id', async (req, res) => {
  await prisma.brand.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// ---------- Settings ----------
configRouter.get('/settings', async (_req, res) => {
  const items = await prisma.setting.findMany();
  const obj: Record<string, string> = {};
  for (const s of items) obj[s.key] = s.value;
  res.json(obj);
});
configRouter.put('/settings', async (req, res) => {
  const entries = req.body || {};
  for (const [key, value] of Object.entries(entries)) {
    await prisma.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
  }
  res.json({ ok: true });
});
