// HTTP 接线层：只做请求解析、调用规则/存储、返回响应。

const express = require('express');
const path = require('path');
const config = require('./project.config');
const store = require('./server/store');
const rules = require('./server/rules');
const handlers = require('./server/handlers');

const app = express();
const PORT = process.env.PORT || config.port || 3900;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

function respond(res, result) {
  res.status(result.status || 200).json(result.body !== undefined ? result.body : { error: result.error || '请求失败' });
}

function newId(collection) {
  return `${collection}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function cleanDraft(body) {
  const draft = { ...body };
  for (const key of ['id', 'history', 'createdAt', 'updatedAt']) delete draft[key];
  return draft;
}

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = await store.read();
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(sortNewest);
  }
  res.json(db);
});

// 巡测登记：重复提交沿用首次记录；准入判定不过只留档待复测
app.post('/api/surveys', async (req, res) => {
  const draft = cleanDraft(req.body);
  delete draft.admission;
  delete draft.admissionReason;
  delete draft.invalid;
  const result = await store.mutate((db) => {
    const duplicate = rules.findDuplicate(db.surveys, draft);
    if (duplicate) return { status: 200, body: { ...duplicate, duplicate: true } };
    const device = db.devices.find((entry) => entry.id === draft.deviceId);
    const calibration = db.calibrations.find((entry) => entry.id === draft.calibrationId);
    const verdict = rules.evaluateAdmission({ device, calibration, survey: draft });
    const now = new Date().toISOString();
    const item = {
      id: newId('surveys'),
      ...draft,
      admission: verdict.admission,
      admissionReason: verdict.reason,
      invalid: false,
      createdAt: now,
      updatedAt: now,
      history: [
        store.stamp('准入判定', verdict.admission === rules.ADMISSION_OK ? '通过，进入有效巡测' : `留档待复测：${verdict.reason}`),
        store.stamp('创建', draft.note || draft.memo || '')
      ]
    };
    db.surveys.push(item);
    return { status: 201, body: item };
  });
  respond(res, result);
});

app.post('/api/:collection', async (req, res) => {
  const { collection } = req.params;
  const result = await store.mutate((db) => {
    if (!Array.isArray(db[collection])) return { status: 404, error: 'unknown collection' };
    const draft = cleanDraft(req.body);
    const now = new Date().toISOString();
    const item = {
      id: newId(collection),
      ...draft,
      createdAt: now,
      updatedAt: now,
      history: [store.stamp('创建', draft.note || draft.memo || '')]
    };
    db[collection].push(item);
    return { status: 201, body: item };
  });
  respond(res, result);
});

// 修改后的联动：巡测重算准入，校准变更级联到未复核巡测
const afterPatch = {
  surveys(db, item) {
    const device = db.devices.find((entry) => entry.id === item.deviceId);
    const calibration = db.calibrations.find((entry) => entry.id === item.calibrationId);
    const verdict = rules.evaluateAdmission({ device, calibration, survey: item });
    item.admission = verdict.admission;
    item.admissionReason = verdict.reason;
  },
  calibrations(db, item, patch) {
    if ('result' in patch || 'validUntil' in patch) {
      rules.cascadeCalibrationCorrection(db, item, new Date().toISOString());
    }
  }
};

app.patch('/api/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  const result = await store.mutate((db) => {
    if (!Array.isArray(db[collection])) return { status: 404, error: 'unknown collection' };
    const item = db[collection].find((entry) => entry.id === id);
    if (!item) return { status: 404, error: 'not found' };
    const historyAction = req.body.historyAction;
    const patch = cleanDraft(req.body);
    delete patch.historyAction;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    if (afterPatch[collection]) afterPatch[collection](db, item, patch);
    item.history = item.history || [];
    if (historyAction || patch.note || patch.memo || patch.status) {
      item.history.unshift(store.stamp(historyAction || patch.status || '更新', patch.note || patch.memo || ''));
    }
    return { status: 200, body: item };
  });
  respond(res, result);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  const result = await store.mutate((db) => {
    if (!Array.isArray(db[collection])) return { status: 404, error: 'unknown collection' };
    const before = db[collection].length;
    db[collection] = db[collection].filter((entry) => entry.id !== id);
    if (db[collection].length === before) return { status: 404, error: 'not found' };
    return { status: 204, body: null };
  });
  if (result.status === 204) return res.status(204).end();
  respond(res, result);
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const result = await store.mutate((db) => {
    const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
    if (!item) return { status: 404, error: 'not found' };
    if (action.handler) {
      const handler = handlers[action.handler];
      if (!handler) return { status: 404, error: 'unknown handler' };
      const out = handler(db, item, req.body || {});
      if (out.error) return { status: 409, error: out.error };
      return { status: 200, body: out.item };
    }
    const out = runAction(db, action, item);
    if (out.error) return { status: 409, error: out.error };
    return { status: 200, body: out.item };
  });
  respond(res, result);
});

// 通用动作引擎：供配置式简单动作（状态补丁/计数）使用
function getValue(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function setValue(target, pathName, value) {
  const keys = pathName.split('.');
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
}

function findRelated(db, relation, item) {
  return db[relation.collection]?.find((entry) => entry.id === item[relation.localKey]);
}

function runAction(db, action, item) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related };
  const levelRank = { '低': 1, '中': 2, '高': 3 };
  for (const guard of action.guards || []) {
    const left = getValue(context, guard.left);
    const right = guard.rightPath ? getValue(context, guard.rightPath) : guard.right;
    if (guard.op === 'missing' && left) continue;
    if (guard.op === 'missing' && !left) return { error: guard.message };
    if (guard.op === 'empty' && left) return { error: guard.message };
    if (guard.op === 'empty' && !left) continue;
    if (guard.op === 'eq' && left !== right) return { error: guard.message };
    if (guard.op === 'neq' && left === right) return { error: guard.message };
    if (guard.op === 'gte' && Number(left) < Number(right)) return { error: guard.message };
    if (guard.op === 'levelGte' && (levelRank[left] || 0) < (levelRank[right] || 0)) return { error: guard.message };
    if (guard.op === 'notIn' && guard.values.includes(left)) return { error: guard.message };
  }
  for (const patch of action.patches || []) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    const next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(store.stamp(action.label, action.note || '状态流转'));
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(store.stamp(action.label, action.note || '数量调整'));
  }
  return { item };
}

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
