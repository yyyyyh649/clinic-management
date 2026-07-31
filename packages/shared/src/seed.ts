// Seed: full example config set (stores, staff, tier rules, exam templates, brands, settings).
// Uses STABLE deterministic ids so server.db and client.db seeds produce identical records
// that reconcile by id on first sync (no duplicates).
// All of this is editable in the backend UI afterwards (not hardcoded in app logic).
import type { PrismaClient } from '../generated/client/index.js';
import { DEPT, SETTING_KEYS } from './constants.js';

// Deterministic id helper.
const id = (s: string) => s;

export async function runSeed(prisma: PrismaClient): Promise<void> {
  // ---- Stores ----
  await prisma.store.upsert({ where: { id: id('seed-store-s1') }, update: {}, create: { id: id('seed-store-s1'), code: 'S1', name: '明亮眼科总店' } });
  await prisma.store.upsert({ where: { id: id('seed-store-s2') }, update: {}, create: { id: id('seed-store-s2'), code: 'S2', name: '明亮眼科分店' } });

  // ---- Staff (cross-dept, cross-store; not bound to one store) ----
  const staffDefs = [
    { id: 'seed-staff-1', code: 'ZS', name: '张三', depts: 'OPTICAL,EYE', isMember: false },
    { id: 'seed-staff-2', code: 'LS', name: '李四', depts: 'OPTICAL', isMember: false },
    { id: 'seed-staff-3', code: 'WW', name: '王五', depts: 'EYE', isMember: false },
    { id: 'seed-staff-4', code: 'ZL', name: '赵六', depts: 'OPTICAL,EYE', isMember: false },
  ];
  for (const s of staffDefs) {
    await prisma.staff.upsert({ where: { id: s.id }, update: {}, create: { id: s.id, code: s.code, name: s.name, depts: s.depts, isMember: s.isMember } });
  }

  // ---- Tier rules (4 of max 20) ----
  const tiers = [
    { id: 'seed-tier-1', level: 1, name: '普通会员', minPoints: 0 },
    { id: 'seed-tier-2', level: 2, name: '银卡会员', minPoints: 1000 },
    { id: 'seed-tier-3', level: 3, name: '金卡会员', minPoints: 5000 },
    { id: 'seed-tier-4', level: 4, name: '钻石会员', minPoints: 20000 },
  ];
  for (const t of tiers) {
    await prisma.tierRule.upsert({ where: { id: t.id }, update: {}, create: { ...t, sortOrder: t.level } });
  }

  // ---- Bean expiry setting (disabled by default = 永久有效) ----
  await prisma.setting.upsert({ where: { key: SETTING_KEYS.BEAN_EXPIRY_ENABLED }, update: {}, create: { key: SETTING_KEYS.BEAN_EXPIRY_ENABLED, value: 'false' } });
  await prisma.setting.upsert({ where: { key: SETTING_KEYS.BEAN_EXPIRY_MONTHS }, update: {}, create: { key: SETTING_KEYS.BEAN_EXPIRY_MONTHS, value: '12' } });

  // ---- Exam templates (1 optical + 1 eye, each multi-page) ----
  const opticalPages = [
    { title: '基础验光', questions: [
      { id: 'q1', type: 'FILL', title: '右眼球镜度数', required: true },
      { id: 'q2', type: 'FILL', title: '左眼球镜度数', required: true },
      { id: 'q3', type: 'FILL', title: '右眼柱镜度数', required: false },
      { id: 'q4', type: 'FILL', title: '左眼柱镜度数', required: false },
      { id: 'q5', type: 'FILL', title: '瞳距', required: false },
    ]},
    { title: '检查备注', questions: [
      { id: 'q6', type: 'CHOICE', title: '用眼习惯', required: false, options: ['长时间看屏幕', '户外活动少', '其他'] },
      { id: 'q7', type: 'FILL', title: '其他说明', required: false },
    ]},
  ];
  const eyePages = [
    { title: '眼科检查', questions: [
      { id: 'e1', type: 'FILL', title: '裸眼视力右', required: true },
      { id: 'e2', type: 'FILL', title: '裸眼视力左', required: true },
      { id: 'e3', type: 'FILL', title: '矫正视力右', required: false },
      { id: 'e4', type: 'FILL', title: '矫正视力左', required: false },
      { id: 'e5', type: 'CHOICE', title: '眼压是否正常', required: false, options: ['正常', '偏高', '偏低', '其他'] },
    ]},
    { title: '诊断与建议', questions: [
      { id: 'e6', type: 'FILL', title: '诊断', required: false },
      { id: 'e7', type: 'FILL', title: '处理意见', required: false },
    ]},
  ];
  await prisma.examTemplate.upsert({ where: { id: 'seed-tpl-optical-1' }, update: {}, create: { id: 'seed-tpl-optical-1', name: '标准验光单', dept: DEPT.OPTICAL, pages: JSON.stringify(opticalPages), isActive: true } });
  await prisma.examTemplate.upsert({ where: { id: 'seed-tpl-eye-1' }, update: {}, create: { id: 'seed-tpl-eye-1', name: '标准眼科病历', dept: DEPT.EYE, pages: JSON.stringify(eyePages), isActive: true } });

  // ---- Brands (lens + frame), chain-wide shared ----
  const lensBrands = ['蔡司', '依视路', '豪雅', '明月', '凯米', '万新'];
  const frameBrands = ['雷朋', '暴龙', '陌森', '海伦凯勒', '帕莎', '派丽蒙'];
  for (let i = 0; i < lensBrands.length; i++) {
    await prisma.brand.upsert({ where: { id: `seed-brand-lens-${i}` }, update: {}, create: { id: `seed-brand-lens-${i}`, name: lensBrands[i], type: 'LENS', sortIndex: i, active: true } });
  }
  for (let i = 0; i < frameBrands.length; i++) {
    await prisma.brand.upsert({ where: { id: `seed-brand-frame-${i}` }, update: {}, create: { id: `seed-brand-frame-${i}`, name: frameBrands[i], type: 'FRAME', sortIndex: i, active: true } });
  }

  console.log('[seed] applied: 2 stores, 4 staff, 4 tiers, 2 templates, 12 brands');
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { PrismaClient } = await import('../generated/client/index.js');
  const prisma = new PrismaClient();
  runSeed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
