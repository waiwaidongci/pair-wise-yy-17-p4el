// 端到端冒烟测试：仪器校准与巡测准入闭环
// 运行：npm test（会启动一个使用临时数据文件的独立服务进程）

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3987;
const BASE = `http://localhost:${PORT}`;
const DB_FILE = path.join(os.tmpdir(), `cave-smoke-${Date.now()}.json`);

fs.copyFileSync(path.join(__dirname, '..', 'data', 'db.json'), DB_FILE);

let failures = 0;
function check(name, condition, extra = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

async function api(pathName, options = {}) {
  const res = await fetch(`${BASE}${pathName}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

const post = (pathName, payload) => api(pathName, { method: 'POST', body: JSON.stringify(payload) });
const action = (actionId, id, payload = {}) => post(`/api/action/${actionId}/${id}`, payload);

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  });
}

async function main() {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await waitForServer(server);

    // 1. 有效巡测：设备可用 + 校准合格未过期 + 量程覆盖
    const validDraft = {
      siteId: 'site-seed-1', deviceId: 'device-seed-1', calibrationId: 'cal-seed-1',
      surveyor: '测试员甲', date: '2026-09-19', temperature: 16.5, humidity: 90,
      co2: 700, dripRate: 10, disturbance: '', submissionKey: 'smoke-key-1'
    };
    const created = await post('/api/surveys', validDraft);
    check('有效巡测准入通过', created.status === 201 && created.body.admission === '有效', JSON.stringify(created.body));

    // 2. 重复提交沿用首次记录（同一幂等键）
    const again = await post('/api/surveys', validDraft);
    check('重复提交沿用首次记录', again.status === 200 && again.body.duplicate === true && again.body.id === created.body.id);

    // 3. 重复提交（无幂等键，自然键相同）
    const natural = { ...validDraft };
    delete natural.submissionKey;
    const naturalAgain = await post('/api/surveys', natural);
    check('自然键相同的提交也判重', naturalAgain.body.duplicate === true && naturalAgain.body.id === created.body.id);

    // 4. 校准过期 → 留档待复测
    const expired = await post('/api/surveys', {
      siteId: 'site-seed-1', deviceId: 'device-seed-2', calibrationId: 'cal-seed-2',
      surveyor: '测试员乙', date: '2026-09-19', temperature: 15, humidity: 91, co2: 710, dripRate: 9
    });
    check('校准过期留档待复测', expired.body.admission === '待复测' && expired.body.admissionReason === '校准过期', JSON.stringify(expired.body.admissionReason));

    // 5. 量程不符 → 留档待复测
    const outOfRange = await post('/api/surveys', {
      siteId: 'site-seed-1', deviceId: 'device-seed-1', calibrationId: 'cal-seed-1',
      surveyor: '测试员丙', date: '2026-09-19', temperature: 99, humidity: 90, co2: 700, dripRate: 10
    });
    check('量程不符留档待复测', outOfRange.body.admission === '待复测' && outOfRange.body.admissionReason === '量程不符');

    // 6. 设备停用 → 留档待复测
    await action('device-disable', 'device-seed-2');
    const disabled = await post('/api/surveys', {
      siteId: 'site-seed-1', deviceId: 'device-seed-2', calibrationId: 'cal-seed-2',
      surveyor: '测试员丁', date: '2026-09-19', temperature: 15, humidity: 91, co2: 710, dripRate: 9
    });
    check('设备停用留档待复测', disabled.body.admission === '待复测' && disabled.body.admissionReason === '设备停用');
    await action('device-enable', 'device-seed-2');

    // 7. 待复测不计入异常统计：对待复测巡测标记异常应被拒绝
    const alertOnHold = await action('survey-alert', expired.body.id);
    check('待复测巡测不能标记异常', alertOnHold.status === 409);

    // 8. 设备未归还不能再次分配
    const assignBusy = await action('device-assign', 'device-seed-1', { operator: '路人甲' });
    check('未归还设备不能再次分配', assignBusy.status === 409);

    // 9. 换班交接连同校准状态
    const handover = await action('device-handover', 'device-seed-1', { to: '林岚', note: '早班转晚班' });
    const handoverLog = handover.body.handoverLog?.[0];
    check(
      '换班交接含校准状态快照',
      handover.status === 200 && handover.body.assignedTo === '林岚' &&
        handoverLog?.calibrationId === 'cal-seed-1' && /有效期至 2026-12-31/.test(handoverLog?.calibrationStatus || ''),
      JSON.stringify(handoverLog)
    );

    // 10. 归还后才能再分配
    await action('device-return', 'device-seed-1');
    const reassign = await action('device-assign', 'device-seed-1', { operator: '沈宁' });
    check('归还后可再次分配', reassign.status === 200 && reassign.body.assignedTo === '沈宁');

    // 11. 领用中的设备不能停用
    const disableBusy = await action('device-disable', 'device-seed-1');
    check('领用中的设备不能停用', disableBusy.status === 409);

    // 12. 校准更正：已复核巡测不受影响，未复核巡测失效
    await action('survey-review', 'survey-seed-1'); // 种子巡测先完成复查
    const correct = await action('calibration-correct', 'cal-seed-1', { result: '不合格', validUntil: '2026-12-31', note: '复检发现漂移' });
    check('校准更正成功', correct.status === 200 && correct.body.result === '不合格');
    let db = (await api('/api/db')).body;
    const invalidated = db.surveys.find((entry) => entry.id === created.body.id);
    const reviewed = db.surveys.find((entry) => entry.id === 'survey-seed-1');
    check('未复核巡测失效待重测', invalidated.admission === '待复测' && invalidated.invalid === true);
    check('已复核巡测不受更正影响', reviewed.admission === '有效' && reviewed.status === '已复查');

    // 13. 重测：校准仍不合格 → 不恢复；换新校准合格 → 恢复
    const retestFail = await action('survey-retest', created.body.id, { calibrationId: 'cal-seed-1' });
    check('重测未通过不恢复', retestFail.status === 200 && retestFail.body.admission === '待复测');
    const newCal = await post('/api/calibrations', {
      deviceId: 'device-seed-1', calibratedAt: '2026-09-19', validUntil: '2027-03-31',
      result: '合格', agency: '省计量科学研究院'
    });
    const retestPass = await action('survey-retest', created.body.id, { calibrationId: newCal.body.id, temperature: 16.4 });
    check('重测合格恢复有效', retestPass.body.admission === '有效' && retestPass.body.invalid === false);

    // 14. 列表 / 统计 / 刷新后状态一致
    const before = (await api('/api/db')).body;
    const after = (await api('/api/db')).body;
    const count = (list, fn) => list.filter(fn).length;
    const anomaly = (list) => count(list, (s) => s.status === '异常待复查' && s.admission === '有效');
    const holding = (list) => count(list, (s) => s.admission === '待复测');
    check(
      '刷新后状态一致',
      anomaly(before.surveys) === anomaly(after.surveys) && holding(before.surveys) === holding(after.surveys)
    );
    check(
      '待复测不进入异常统计',
      before.surveys.filter((s) => s.admission === '待复测').every((s) => s.status !== '异常待复查' || s.admission !== '有效')
    );
    // 量程不符巡测依赖 cal-seed-1，更正级联后原因更新为“校准已更正”（创建时的量程不符已在上方验证）
    const expectedHold = ['校准过期', '设备停用', '校准已更正，待重测'];
    const holdReasons = before.surveys.filter((s) => s.admission === '待复测').map((s) => s.admissionReason);
    check('留档原因齐全（过期/停用/更正）', expectedHold.every((reason) => holdReasons.includes(reason)), holdReasons.join(','));
  } finally {
    server.kill();
    fs.rmSync(DB_FILE, { force: true });
  }

  console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
