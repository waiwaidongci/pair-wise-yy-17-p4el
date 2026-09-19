// 规则判断层：仪器校准与巡测准入闭环的全部判定逻辑。
// 纯函数、不读写磁盘、不依赖 HTTP，输入数据、输出判定结果。

const ADMISSION_OK = '有效';
const ADMISSION_HOLD = '待复测';

function hold(reason) {
  return { admission: ADMISSION_HOLD, reason };
}

// 量程检查：巡测温度必须落在设备量程内
function withinRange(device, survey) {
  const value = Number(survey.temperature);
  if (!Number.isFinite(value)) return false;
  const min = Number(device.rangeMin);
  const max = Number(device.rangeMax);
  if (Number.isFinite(min) && value < min) return false;
  if (Number.isFinite(max) && value > max) return false;
  return true;
}

// 巡测准入判定：设备可用 + 校准有效（合格且巡测日期在有效期内）+ 量程覆盖。
// 任一不满足则只留档待复测，不进入异常统计。
function evaluateAdmission({ device, calibration, survey }) {
  if (!device) return hold('设备不存在');
  if (device.status === '停用') return hold('设备停用');
  if (!calibration) return hold('缺少校准记录');
  if (calibration.deviceId !== device.id) return hold('校准记录与设备不符');
  if (calibration.result !== '合格') return hold('校准不合格');
  if (calibration.validUntil && survey.date && calibration.validUntil < survey.date) return hold('校准过期');
  if (!withinRange(device, survey)) return hold('量程不符');
  return { admission: ADMISSION_OK, reason: '' };
}

// 重复提交判定：优先客户端幂等键，其次自然键（同样点/设备/日期/人员）
function naturalKeyOf(survey) {
  return [survey.siteId, survey.deviceId, survey.date, survey.surveyor].join('|');
}

function submissionKeyOf(survey) {
  return String(survey.submissionKey || '').trim();
}

function findDuplicate(surveys, draft) {
  const key = submissionKeyOf(draft);
  if (key) {
    const hit = surveys.find((entry) => submissionKeyOf(entry) === key);
    if (hit) return hit;
  }
  const natural = naturalKeyOf(draft);
  return surveys.find((entry) => naturalKeyOf(entry) === natural) || null;
}

// 设备分配约束：停用或未归还（仍有人领用）的设备不能再分配
function canAssign(device) {
  if (!device) return { ok: false, message: '设备不存在' };
  if (device.status === '停用') return { ok: false, message: '设备已停用，不能分配' };
  if (device.assignedTo) return { ok: false, message: `设备未归还（${device.assignedTo} 领用中），不能再次分配` };
  return { ok: true };
}

// 设备当前最新的一条校准记录
function latestCalibration(calibrations, deviceId) {
  return (calibrations || [])
    .filter((entry) => entry.deviceId === deviceId)
    .sort((a, b) => String(b.calibratedAt || '').localeCompare(String(a.calibratedAt || '')))[0] || null;
}

// 换班交接时随设备一起交接的校准状态快照
function calibrationSnapshot(calibration, onDate) {
  if (!calibration) return '无校准记录';
  const expired = calibration.validUntil && onDate && calibration.validUntil < onDate;
  const state = calibration.result !== '合格' ? '不合格' : expired ? '已过期' : '有效';
  return `${calibration.result}，有效期至 ${calibration.validUntil || '-'}（${state}）`;
}

// 校准结果更正后的级联：依赖它的未复核巡测失效并重算，已复核的不受影响。
// 失效后只能等待重测合格才能恢复。
function cascadeCalibrationCorrection(db, calibration, now) {
  const affected = [];
  for (const survey of db.surveys || []) {
    if (survey.calibrationId !== calibration.id) continue;
    if (survey.status === '已复查') continue;
    survey.invalid = true;
    survey.admission = ADMISSION_HOLD;
    survey.admissionReason = '校准已更正，待重测';
    survey.updatedAt = now;
    survey.history = survey.history || [];
    survey.history.unshift({
      at: now,
      action: '校准更正',
      note: `依赖的校准记录被更正（${calibration.result}，有效期至 ${calibration.validUntil || '-'}），巡测失效待重测`
    });
    affected.push(survey.id);
  }
  return affected;
}

module.exports = {
  ADMISSION_OK,
  ADMISSION_HOLD,
  evaluateAdmission,
  withinRange,
  naturalKeyOf,
  submissionKeyOf,
  findDuplicate,
  canAssign,
  latestCalibration,
  calibrationSnapshot,
  cascadeCalibrationCorrection
};
