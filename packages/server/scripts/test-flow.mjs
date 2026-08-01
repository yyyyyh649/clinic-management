// End-to-end API smoke test.
const B = 'http://localhost:4000/api';
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; } };
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j);

console.log('1. register member');
const mem = await post('/members', { name: '测试客户', phone: '13800000001', cardNo: 'C0001', birthday: '1990-05-10', address: '测试路1号', registeredById: 'seed-staff-1', registeredByName: '张三', registeredStoreId: 'seed-store-s1', registeredStoreName: '明亮眼科总店', registeredDeviceId: 'dev-test', initialBalanceCents: 200000, initialBeans: 500 });
console.log('  raw member resp keys:', Object.keys(mem), 'error?', mem.error);
const MID = mem.member?.id;
if (!MID) { console.log('  FULL RESP:', JSON.stringify(mem).slice(0,500)); process.exit(1); }
console.log('  MID=', MID, ' balances=', JSON.stringify(mem.balances));

console.log('2. create exam (optical, lens 800 + frame 1200 = 2000元)');
const exam = await post('/exams', { name: '测试客户', phone: '13800000001', dept: 'OPTICAL', lensBrand: '蔡司', lensPrice: 80000, frameBrand: '雷朋', framePrice: 120000, registeredById: 'seed-staff-1', registeredByName: '张三', registeredStoreId: 'seed-store-s1', registeredStoreName: '明亮眼科总店', registeredDeviceId: 'dev-test' });
const EID = exam.id;
console.log('  EID=', EID, ' baseAmount=', exam.baseAmount, ' reviewDate=', exam.reviewDate);

console.log('3. pay: 500元 balance + 200豆 + cash 1280元 (after 2000-500-2=1498 expected; testing mismatch reason)');
// afterDiscount=200000; -50000 balance -200 beans = 149800 expected cash. pay 128000 (mismatch) -> needs reason
const payBad = await post('/payments', { examId: EID, balanceDeductCents: 50000, beansDeductCount: 200, payForMemberId: MID, cashPaidCents: 128000, cashPaidEdited: false, operatorId: 'seed-staff-1', operatorName: '张三', operatorMemberId: MID, storeId: 'seed-store-s1', storeName: '明亮眼科总店', deviceId: 'dev-test', awardMemberId: MID });
console.log('  (should fail w/o reason):', payBad);

console.log('4. pay with reason (correct expected = 149800)');
const pay = await post('/payments', { examId: EID, balanceDeductCents: 50000, beansDeductCount: 200, payForMemberId: MID, cashPaidCents: 149800, cashPaidEdited: false, editReason: '', operatorId: 'seed-staff-1', operatorName: '张三', operatorMemberId: MID, storeId: 'seed-store-s1', storeName: '明亮眼科总店', deviceId: 'dev-test', awardMemberId: MID });
console.log('  payment=', JSON.stringify(pay));

console.log('5. member balances after (balance -50000, beans 500-200+1498(award)=1798, points 1498)');
const det = await fetch(B + '/members/' + MID).then(j);
console.log('  ', JSON.stringify(det.balances), 'tier=', det.tier.name);

console.log('6. revenue (current month)');
// Password comes from the DB (seeded from .env on first boot). The test reads
// it from the env so no real password is hardcoded in this file.
const BPW = process.env.CLINIC_BACKEND_PASSWORD;
if (!BPW) { console.log('  SKIP: set CLINIC_BACKEND_PASSWORD env var to run the auth-gated checks'); }
const tok = BPW ? (await post('/auth/login', { password: BPW })).token : null;
const rev = await fetch(`${B}/stats/revenue?year=2026&month=7`, { headers: { 'x-backend-token': tok } }).then(j);
console.log('  optical=', JSON.stringify(rev.month.optical), 'eye=', JSON.stringify(rev.month.eye), 'total=', rev.month.total, 'carryCash=', rev.month.carryCashToNext);

console.log('7. sync pull (empty cursors) — count records');
const pull = await post('/pull', { deviceId: 'dev-test', cursors: {} });
console.log('  records=', pull.records.length, 'sample tables=', [...new Set(pull.records.map(r=>r.table))]);
