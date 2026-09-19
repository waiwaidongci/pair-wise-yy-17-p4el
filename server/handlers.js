// 业务动作层：把规则判断应用到存储数据上。每个处理器返回 { item } 或 { error }。

const rules = require('./rules');
const { stamp } = require('./store');

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

function touch(item, action, note) {
  item.updatedAt = now();
  item.history = item.history || [];
  item.history.unshift(stamp(action, note));
}

// 分配设备：同一设备未归还不能再次分配
function assignDevice(db, device, body) {
  const check = rules.canAssign(device);
  if (!check.ok) return { error: check.message };
  const operator = String(body.operator || '').trim();
  if (!operator) return { error: '请填写领用人' };
  device.assignedTo = operator;
  device.assignedAt = now();
  touch(device, '分配设备', `领用人：${operator}`);
  return { item: device };
}

function returnDevice(db, device) {
  if (!device.assignedTo) return { error: '设备当前未在领用中' };
  const holder = device.assignedTo;
  device.assignedTo = '';
  device.assignedAt = '';
  touch(device, '归还设备', `归还人：${holder}`);
  return { item: device };
}

// 换班交接：连同当前校准状态快照一起交接
function handoverDevice(db, device, body) {
  if (!device.assignedTo) return { error: '设备未在领用中，无法换班交接' };
  const to = String(body.to || '').trim();
  if (!to) return { error: '请填写接班人' };
  const from = device.assignedTo;
  const calibration = rules.latestCalibration(db.calibrations, device.id);
  const snapshot = rules.calibrationSnapshot(calibration, today());
  device.assignedTo = to;
  device.assignedAt = now();
  device.handoverLog = device.handoverLog || [];
  device.handoverLog.unshift({
    from,
    to,
    at: now(),
    calibrationId: calibration ? calibration.id : '',
    calibrationStatus: snapshot,
    note: String(body.note || '')
  });
  touch(device, '换班交接', `${from} → ${to}；校准状态：${snapshot}`);
  return { item: device };
}

// 校准更正：更正结果/有效期后，依赖它的未复核巡测失效并重算
function correctCalibration(db, calibration, body) {
  const next = {};
  if (body.result) next.result = body.result;
  if (body.validUntil) next.validUntil = body.validUntil;
  if (!Object.keys(next).length) return { error: '没有需要更正的校准内容' };
  const before = `${calibration.result}，有效期至 ${calibration.validUntil || '-'}`;
  Object.assign(calibration, next);
  calibration.correctedAt = now();
  calibration.correctionNote = String(body.note || '');
  const affected = rules.cascadeCalibrationCorrection(db, calibration, calibration.correctedAt);
  touch(
    calibration,
    '校准更正',
    `${before} → ${calibration.result}，有效期至 ${calibration.validUntil || '-'}；${affected.length} 条未复核巡测失效待重测`
  );
  return { item: calibration };
}

// 重测：重新绑定设备/校准并复测，合格才能恢复为有效巡测
function retestSurvey(db, survey, body) {
  if (survey.admission !== rules.ADMISSION_HOLD) return { error: '仅待复测的巡测需要重测' };
  const deviceId = body.deviceId || survey.deviceId;
  const calibrationId = body.calibrationId || survey.calibrationId;
  const device = db.devices.find((entry) => entry.id === deviceId);
  const calibration = db.calibrations.find((entry) => entry.id === calibrationId);
  const draft = { ...survey, deviceId, calibrationId };
  for (const key of ['temperature', 'humidity', 'co2', 'dripRate']) {
    if (body[key] !== undefined && body[key] !== '') draft[key] = Number(body[key]);
  }
  const verdict = rules.evaluateAdmission({ device, calibration, survey: draft });
  Object.assign(survey, {
    deviceId,
    calibrationId,
    temperature: draft.temperature,
    humidity: draft.humidity,
    co2: draft.co2,
    dripRate: draft.dripRate,
    admission: verdict.admission,
    admissionReason: verdict.reason
  });
  if (verdict.admission === rules.ADMISSION_OK) {
    survey.invalid = false;
    survey.retestedAt = now();
    touch(survey, '重测合格', body.note ? `巡测恢复有效：${body.note}` : '巡测恢复有效');
  } else {
    touch(survey, '重测未通过', verdict.reason);
  }
  return { item: survey };
}

module.exports = { assignDevice, returnDevice, handoverDevice, correctCalibration, retestSurvey };
