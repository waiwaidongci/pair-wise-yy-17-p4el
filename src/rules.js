// 规则层：巡测准入、校准有效性、设备分配/交接、校准更正级联、重测恢复、幂等。
// 全部为纯函数 + 对内存 db 对象的领域操作，不触碰文件系统与 HTTP。
const { newId, stamp, find } = require('./store');

const SURVEY_STATUS = {
  NORMAL: '正常',
  ANOMALY: '异常待复查',
  REVIEWED: '已复查',
  HOLD: '留档待复测'
};

const METRICS = [
  { key: 'temperature', label: '温度', min: 'tempMin', max: 'tempMax', unit: '℃' },
  { key: 'humidity', label: '湿度', min: 'humMin', max: 'humMax', unit: '%' },
  { key: 'co2', label: 'CO2', min: 'co2Min', max: 'co2Max', unit: 'ppm' }
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function touch(item, action, note) {
  item.updatedAt = new Date().toISOString();
  item.history = item.history || [];
  item.history.unshift(stamp(action, note));
}

// ---------- 校准有效性 ----------

function latestCalibration(db, deviceId) {
  return (db.calibrations || [])
    .filter((entry) => entry.deviceId === deviceId)
    .sort((a, b) => String(b.calibratedAt || '').localeCompare(String(a.calibratedAt || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

// 统一判定：设备停用 / 校准停用 / 结果不合格 / 超过有效期
function calibrationValidity(device, calibration, date) {
  if (!calibration) return { ok: false, code: 'missing', label: '无校准记录' };
  if (device && device.status === '停用') return { ok: false, code: 'disabled', label: '设备已停用' };
  if (calibration.status === '停用') return { ok: false, code: 'revoked', label: '校准记录已停用' };
  if (calibration.result !== '合格') return { ok: false, code: 'unqualified', label: '校准结果不合格' };
  if (date && calibration.validUntil && String(calibration.validUntil) < String(date)) {
    return { ok: false, code: 'expired', label: `校准已过期（有效期至 ${calibration.validUntil}）` };
  }
  return { ok: true, code: 'valid', label: '校准有效' };
}

// 量程核对：巡测读数必须落在设备量程内
function rangeIssues(device, reading) {
  if (!device) return [];
  const issues = [];
  for (const metric of METRICS) {
    const value = Number(reading[metric.key]);
    if (!Number.isFinite(value)) continue;
    const min = device[metric.min];
    const max = device[metric.max];
    const hasMin = min !== undefined && min !== null && min !== '';
    const hasMax = max !== undefined && max !== null && max !== '';
    if (hasMin && value < Number(min)) {
      issues.push(`${metric.label} ${value}${metric.unit} 低于设备量程下限（${min} ~ ${max}）`);
    } else if (hasMax && value > Number(max)) {
      issues.push(`${metric.label} ${value}${metric.unit} 超出设备量程上限（${min} ~ ${max}）`);
    }
  }
  return issues;
}

// ---------- 巡测准入 ----------

// 每次巡测必须绑定当次设备与有效校准记录；不满足则留档待复测，不进入异常统计。
function evaluateAdmission(db, payload) {
  const reasons = [];
  const device = payload.deviceId ? find(db, 'devices', payload.deviceId) : null;
  const calibration = payload.calibrationId ? find(db, 'calibrations', payload.calibrationId) : null;
  if (!device) reasons.push('未绑定当次设备');
  if (!calibration) reasons.push('未绑定校准记录');
  if (device && calibration) {
    if (calibration.deviceId !== device.id) {
      reasons.push('校准记录与当次设备不匹配');
    } else {
      const validity = calibrationValidity(device, calibration, payload.date);
      if (!validity.ok) reasons.push(validity.label);
    }
    reasons.push(...rangeIssues(device, payload));
  }
  return { device, calibration, ok: reasons.length === 0, reasons };
}

// 重复提交沿用首次记录：提交键优先，其次内容完全一致的天然键。
function naturalKey(payload) {
  return [
    payload.siteId, payload.date, payload.surveyor, payload.deviceId,
    payload.temperature, payload.humidity, payload.co2, payload.dripRate
  ].map((v) => String(v ?? '')).join('|');
}

function findDuplicateSurvey(db, payload) {
  const surveys = db.surveys || [];
  if (payload.submissionKey) {
    const byKey = surveys.find((entry) => entry.submissionKey && entry.submissionKey === payload.submissionKey);
    if (byKey) return byKey;
  }
  const key = naturalKey(payload);
  return surveys.find((entry) => naturalKey(entry) === key) || null;
}

function createSurvey(db, payload) {
  const duplicate = findDuplicateSurvey(db, payload);
  if (duplicate) return { survey: duplicate, deduplicated: true };
  const admission = evaluateAdmission(db, payload);
  const now = new Date().toISOString();
  const survey = {
    id: newId('surveys'),
    ...payload,
    status: admission.ok ? SURVEY_STATUS.NORMAL : SURVEY_STATUS.HOLD,
    holdReason: admission.ok ? '' : admission.reasons.join('；'),
    reviewNote: payload.reviewNote || '',
    createdAt: now,
    updatedAt: now,
    history: [stamp('创建', payload.note || `${payload.surveyor || ''} 巡测登记`)]
  };
  if (!admission.ok) {
    survey.history.unshift(stamp('留档待复测', survey.holdReason));
  }
  db.surveys.push(survey);
  return { survey, deduplicated: false };
}

// 重测：仅留档待复测记录可重测；合格才恢复（回到留档前状态），否则继续留档。
function retestSurvey(db, id, payload) {
  const survey = find(db, 'surveys', id);
  if (!survey) return { error: '巡测记录不存在' };
  if (survey.status !== SURVEY_STATUS.HOLD) return { error: '仅留档待复测的记录可以重测' };
  for (const key of ['deviceId', 'calibrationId', 'temperature', 'humidity', 'co2', 'dripRate']) {
    if (payload[key] !== undefined && payload[key] !== '') survey[key] = payload[key];
  }
  const admission = evaluateAdmission(db, survey);
  if (admission.ok) {
    const restore = survey.statusBeforeHold && survey.statusBeforeHold !== SURVEY_STATUS.HOLD
      ? survey.statusBeforeHold
      : SURVEY_STATUS.NORMAL;
    delete survey.statusBeforeHold;
    survey.status = restore;
    survey.holdReason = '';
    touch(survey, '重测合格', payload.note || `重测通过，恢复为「${restore}」`);
    return { survey, ok: true };
  }
  survey.holdReason = admission.reasons.join('；');
  touch(survey, '重测未通过', survey.holdReason);
  return { survey, ok: false, reasons: admission.reasons };
}

// ---------- 校准更正级联 ----------

// 校准结果更正后，依赖它的未复核巡测失效并留档待重测；已复核（已复查）记录不受影响。
function correctCalibration(db, id, patch) {
  const calibration = find(db, 'calibrations', id);
  if (!calibration) return { error: '校准记录不存在' };
  if (patch.result) calibration.result = patch.result;
  if (patch.validUntil) calibration.validUntil = patch.validUntil;
  calibration.correctedAt = new Date().toISOString();
  touch(calibration, '校准更正', patch.note || `更正为：${calibration.result}，有效期至 ${calibration.validUntil}`);
  const invalidated = [];
  for (const survey of db.surveys || []) {
    if (survey.calibrationId !== id || survey.status === SURVEY_STATUS.REVIEWED) continue;
    if (survey.status !== SURVEY_STATUS.HOLD) {
      survey.statusBeforeHold = survey.status;
      survey.status = SURVEY_STATUS.HOLD;
    }
    survey.holdReason = '依赖的校准记录被更正，待重测';
    touch(survey, '校准更正失效', survey.holdReason);
    invalidated.push(survey.id);
  }
  return { calibration, invalidated };
}

// ---------- 设备分配 / 归还 / 换班交接 ----------

function assignDevice(db, id, holder) {
  const device = find(db, 'devices', id);
  if (!device) return { error: '设备不存在' };
  if (!holder || !String(holder).trim()) return { error: '请填写领用人' };
  if (device.status === '停用') return { error: '设备已停用，不能分配' };
  if (device.status === '借出') return { error: `设备未归还（当前持有人：${device.holder || '未知'}），不能再次分配` };
  device.status = '借出';
  device.holder = String(holder).trim();
  device.assignedAt = new Date().toISOString();
  touch(device, '分配领用', `领用人：${device.holder}`);
  return { device };
}

function returnDevice(db, id) {
  const device = find(db, 'devices', id);
  if (!device) return { error: '设备不存在' };
  if (device.status !== '借出') return { error: '设备不在借出状态' };
  const holder = device.holder;
  device.status = '在库';
  device.holder = '';
  device.assignedAt = '';
  touch(device, '归还入库', holder ? `归还人：${holder}` : '');
  return { device };
}

// 换班交接：设备保持借出，持有人变更，并连同当前校准状态一并交接留痕。
function handoverDevice(db, id, to, note) {
  const device = find(db, 'devices', id);
  if (!device) return { error: '设备不存在' };
  if (device.status !== '借出') return { error: '仅借出中的设备可换班交接' };
  if (!to || !String(to).trim()) return { error: '请填写接班人' };
  const from = device.holder || '—';
  const calibration = latestCalibration(db, id);
  const validity = calibrationValidity(device, calibration, today());
  const snapshot = calibration
    ? `${validity.label}（证书 ${calibration.certificateNo}，有效期至 ${calibration.validUntil}）`
    : '无校准记录';
  device.holder = String(to).trim();
  device.lastHandover = { at: new Date().toISOString(), from, to: device.holder, calibrationStatus: snapshot };
  touch(device, '换班交接', `${from} → ${device.holder}；校准状态：${snapshot}${note ? '；' + note : ''}`);
  return { device, calibrationStatus: snapshot };
}

// ---------- 通用创建钩子（非巡测集合） ----------

function beforeCreate(db, collection, payload) {
  if (collection === 'devices') {
    payload.status = payload.status || '在库';
    payload.holder = payload.holder || '';
  }
  if (collection === 'calibrations') {
    const device = payload.deviceId ? find(db, 'devices', payload.deviceId) : null;
    if (device) {
      payload.deviceCode = device.code;
      payload.deviceName = device.name;
    }
    payload.result = payload.result || '合格';
  }
  return payload;
}

// ---------- 读取时派生展示字段（不落库） ----------

function enrich(db) {
  const date = today();
  for (const device of db.devices || []) {
    const calibration = latestCalibration(db, device.id);
    if (!calibration) {
      device.calibrationLabel = '无校准记录';
    } else {
      const validity = calibrationValidity(device, calibration, date);
      device.calibrationLabel = validity.code === 'valid'
        ? `校准有效（有效期至 ${calibration.validUntil}）`
        : validity.label;
    }
  }
  for (const calibration of db.calibrations || []) {
    const device = find(db, 'devices', calibration.deviceId);
    calibration.validityLabel = calibrationValidity(device, calibration, date).label;
  }
  return db;
}

module.exports = {
  SURVEY_STATUS,
  today,
  latestCalibration,
  calibrationValidity,
  rangeIssues,
  evaluateAdmission,
  createSurvey,
  retestSurvey,
  correctCalibration,
  assignDevice,
  returnDevice,
  handoverDevice,
  beforeCreate,
  enrich
};
