// 端到端闭环测试：需先启动服务（npm start），会向本地库写入测试记录。
// 运行：npm test
const assert = require('assert');

const BASE = 'http://localhost:3912';
const api = async (path, options = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { status: res.status, body };
};
const post = (path, payload) => api(path, { method: 'POST', body: JSON.stringify(payload || {}) });

async function main() {
  const db0 = (await api('/api/db')).body;
  const baseSurveys = db0.surveys.length;
  const baseAnomaly = db0.surveys.filter((s) => s.status === '异常待复查').length;

  // 1. 合格巡测：有效设备 + 有效校准 → 正常
  const ok = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-1', calibrationId: 'cal-1',
    surveyor: '测试员甲', date: '2026-09-19', temperature: 16.5, humidity: 90, co2: 700, dripRate: 10
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, '正常', `expected 正常, got ${ok.body.status}`);

  // 2. 重复提交（同提交键 + 同内容）→ 沿用首次记录，不新增
  const dupPayload = {
    siteId: 'site-seed-1', deviceId: 'device-1', calibrationId: 'cal-1',
    surveyor: '测试员乙', date: '2026-09-19', temperature: 16.6, humidity: 91, co2: 710, dripRate: 11,
    submissionKey: 'key-dup-1'
  };
  const first = await post('/api/surveys', dupPayload);
  const dup = await post('/api/surveys', dupPayload);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.id, first.body.id, '重复提交应沿用首次记录');
  assert.equal(dup.body.deduplicated, true);
  let db = (await api('/api/db')).body;
  assert.equal(db.surveys.filter((s) => s.submissionKey === 'key-dup-1').length, 1, '重复提交不应产生第二条记录');

  // 3. 校准过期 → 留档待复测，不进入异常统计
  const expired = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-2', calibrationId: 'cal-2',
    surveyor: '测试员丙', date: '2026-09-19', temperature: 16, humidity: 90, co2: 800, dripRate: 9
  });
  assert.equal(expired.body.status, '留档待复测');
  assert.match(expired.body.holdReason, /校准已过期/);

  // 4. 设备停用 → 留档待复测
  const disabled = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-3', calibrationId: 'cal-3',
    surveyor: '测试员丁', date: '2026-09-19', temperature: 16, humidity: 90, co2: 800, dripRate: 9
  });
  assert.equal(disabled.body.status, '留档待复测');
  assert.match(disabled.body.holdReason, /停用|不合格/);

  // 5. 量程不符 → 留档待复测（device-1 的 CO2 量程上限 5000）
  const outOfRange = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-1', calibrationId: 'cal-1',
    surveyor: '测试员戊', date: '2026-09-19', temperature: 16, humidity: 90, co2: 6000, dripRate: 9
  });
  assert.equal(outOfRange.body.status, '留档待复测');
  assert.match(outOfRange.body.holdReason, /量程/);

  // 6. 校准与设备不匹配 → 留档待复测
  const mismatch = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-1', calibrationId: 'cal-2',
    surveyor: '测试员己', date: '2026-09-19', temperature: 16, humidity: 90, co2: 800, dripRate: 9
  });
  assert.equal(mismatch.body.status, '留档待复测');
  assert.match(mismatch.body.holdReason, /不匹配/);

  // 7. 异常统计不含留档：待复查数量保持 baseAnomaly
  db = (await api('/api/db')).body;
  const anomalyNow = db.surveys.filter((s) => s.status === '异常待复查').length;
  const holdNow = db.surveys.filter((s) => s.status === '留档待复测').length;
  assert.equal(anomalyNow, baseAnomaly, '留档待复测不得进入异常统计');
  assert.equal(holdNow, 4, `应有 4 条留档，实际 ${holdNow}`);

  // 8. 留档记录不能标记异常
  const alertOnHold = await post(`/api/action/survey-alert/${expired.body.id}`);
  assert.equal(alertOnHold.status, 409);

  // 9. 设备未归还不能再次分配
  const assign1 = await post('/api/devices/device-2/assign', { holder: '王五' });
  assert.equal(assign1.status, 200);
  const assign2 = await post('/api/devices/device-2/assign', { holder: '赵六' });
  assert.equal(assign2.status, 409);
  assert.match(assign2.body.error, /未归还/);
  // 停用设备不能分配
  const assignDisabled = await post('/api/devices/device-3/assign', { holder: '赵六' });
  assert.equal(assignDisabled.status, 409);
  // 归还后可再分配
  await post('/api/devices/device-2/return');
  const assign3 = await post('/api/devices/device-2/assign', { holder: '赵六' });
  assert.equal(assign3.status, 200);
  assert.equal(assign3.body.device.holder, '赵六');

  // 10. 换班交接连同校准状态
  const handover = await post('/api/devices/device-1/handover', { to: '李四', note: '晚班接手' });
  assert.equal(handover.status, 200);
  assert.equal(handover.body.device.holder, '李四');
  assert.match(handover.body.calibrationStatus, /校准有效/);
  assert.match(handover.body.device.history[0].note, /校准状态：校准有效/);
  assert.match(handover.body.device.history[0].note, /沈宁 → 李四/);

  // 11. 校准更正 → 依赖它的未复核巡测失效；已复查不受影响
  // 先把一条 cal-1 巡测走到已复查
  const reviewed = await post('/api/surveys', {
    siteId: 'site-seed-1', deviceId: 'device-1', calibrationId: 'cal-1',
    surveyor: '测试员庚', date: '2026-09-19', temperature: 16, humidity: 90, co2: 800, dripRate: 9
  });
  await post(`/api/action/survey-alert/${reviewed.body.id}`);
  const reviewedDone = await post(`/api/action/survey-review/${reviewed.body.id}`);
  assert.equal(reviewedDone.body.status, '已复查');

  const correct = await post('/api/calibrations/cal-1/correct', { result: '不合格', validUntil: '2026-08-31', note: '溯源证书撤销' });
  assert.equal(correct.status, 200);
  db = (await api('/api/db')).body;
  const seedSurvey = db.surveys.find((s) => s.id === 'survey-seed-1');
  assert.equal(seedSurvey.status, '留档待复测', '未复核巡测应失效留档');
  assert.equal(seedSurvey.statusBeforeHold, '异常待复查', '应记录留档前状态');
  const okSurvey = db.surveys.find((s) => s.id === ok.body.id);
  assert.equal(okSurvey.status, '留档待复测');
  const reviewedSurvey = db.surveys.find((s) => s.id === reviewed.body.id);
  assert.equal(reviewedSurvey.status, '已复查', '已复核记录不受更正影响');
  // 异常统计重算：survey-seed-1 离开异常统计
  const anomalyAfter = db.surveys.filter((s) => s.status === '异常待复查').length;
  assert.equal(anomalyAfter, baseAnomaly - 1, '失效后应重算异常统计');

  // 12. 重测未通过（更正后校准不合格且过期）→ 继续留档
  const retestFail = await post(`/api/surveys/${ok.body.id}/retest`, { note: '直接重测' });
  assert.equal(retestFail.status, 200);
  assert.equal(retestFail.body.ok, false);
  assert.equal(retestFail.body.survey.status, '留档待复测');

  // 13. 登记新合格校准并改绑重测 → 合格恢复，回到留档前状态
  const newCal = await post('/api/calibrations', {
    deviceId: 'device-1', certificateNo: 'JZ-2026-0333', agency: '省计量科学研究院',
    calibratedAt: '2026-09-10', validUntil: '2027-03-10', result: '合格'
  });
  assert.equal(newCal.status, 201);
  assert.equal(newCal.body.deviceCode, 'KQ-01', '校准应自动关联设备编号');
  const retestOk = await post(`/api/surveys/${ok.body.id}/retest`, { calibrationId: newCal.body.id, note: '改绑新校准重测' });
  assert.equal(retestOk.body.ok, true);
  assert.equal(retestOk.body.survey.status, '正常', '重测合格应恢复');
  const retestSeed = await post(`/api/surveys/survey-seed-1/retest`, { calibrationId: newCal.body.id });
  assert.equal(retestSeed.body.survey.status, '异常待复查', '应恢复到留档前状态');

  // 14. 非留档记录不能重测
  const retestWrong = await post(`/api/surveys/${ok.body.id}/retest`, {});
  assert.equal(retestWrong.status, 409);

  // 15. 完成复查守卫：仅异常待复查可复查
  const reviewWrong = await post(`/api/action/survey-review/${ok.body.id}`);
  assert.equal(reviewWrong.status, 409);

  // 16. 刷新后状态一致：重新读取，统计与列表一致
  // 留档 = 4 条准入留档 + 测试员乙（cal-1 更正失效）；ok/seed 两条已重测恢复
  const finalDb = (await api('/api/db')).body;
  const holdFinal = finalDb.surveys.filter((s) => s.status === '留档待复测').length;
  assert.equal(holdFinal, 5, `刷新后留档数应一致，实际 ${holdFinal}`);
  const dupSurvey = finalDb.surveys.find((s) => s.submissionKey === 'key-dup-1');
  assert.equal(dupSurvey.status, '留档待复测', '依赖被更正校准的未复核巡测应失效');
  assert.ok(finalDb.surveys.length >= baseSurveys + 6);

  console.log('全部闭环测试通过 ✔');
  console.log(`  巡测总数 ${finalDb.surveys.length}，异常待复查 ${finalDb.surveys.filter((s) => s.status === '异常待复查').length}，留档待复测 ${holdFinal}`);
}

main().catch((error) => {
  console.error('测试失败:', error.message);
  process.exit(1);
});
