// HTTP 层：只做请求/响应装配，业务规则在 src/rules.js，持久化在 src/store.js。
const express = require('express');
const path = require('path');

const store = require('./src/store');
const rules = require('./src/rules');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = rules.enrich(await store.readDb());
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(store.sortNewest);
  }
  res.json(db);
});

// 巡测登记：走准入规则 + 幂等（重复提交沿用首次记录）
app.post('/api/surveys', async (req, res) => {
  const payload = req.body || {};
  if (!payload.siteId || !payload.surveyor || !payload.date) {
    return res.status(400).json({ error: '缺少必填字段：样点、巡测人员、日期' });
  }
  const db = await store.readDb();
  const result = rules.createSurvey(db, payload);
  if (!result.deduplicated) await store.writeDb(db);
  res.status(result.deduplicated ? 200 : 201).json({ ...result.survey, deduplicated: result.deduplicated });
});

// 通用创建（样点 / 设备 / 校准记录）
app.post('/api/:collection', async (req, res) => {
  const db = await store.readDb();
  const { collection } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const now = new Date().toISOString();
  const payload = rules.beforeCreate(db, collection, { ...(req.body || {}) });
  const item = {
    id: store.newId(collection),
    ...payload,
    createdAt: now,
    updatedAt: now,
    history: [store.stamp('创建', payload.note || '')]
  };
  db[collection].push(item);
  await store.writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/:collection/:id', async (req, res) => {
  const db = await store.readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = store.find(db, collection, id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const body = { ...(req.body || {}) };
  const historyAction = body.historyAction;
  delete body.historyAction;
  Object.assign(item, body, { updatedAt: new Date().toISOString() });
  item.history = item.history || [];
  if (historyAction || body.note || body.memo || body.status) {
    item.history.unshift(store.stamp(historyAction || body.status || '更新', body.note || body.memo || ''));
  }
  await store.writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await store.readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });
  await store.writeDb(db);
  res.status(204).end();
});

// 配置驱动的简单状态流转动作（样点状态、巡测标记异常/完成复查）
// 注意：必须注册在 /api/:collection/:id/:op 之前，避免被通配路由吞掉。
app.post('/api/action/:actionId/:id', async (req, res) => {
  const db = await store.readDb();
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const result = runAction(db, action, item);
  if (result.error) return res.status(409).json({ error: result.error });
  await store.writeDb(db);
  res.json(result.item);
});

// 领域操作：设备分配/归还/交接、校准更正、巡测重测
const OPERATIONS = {
  'devices/assign': (db, id, body) => rules.assignDevice(db, id, body.holder),
  'devices/return': (db, id) => rules.returnDevice(db, id),
  'devices/handover': (db, id, body) => rules.handoverDevice(db, id, body.to, body.note),
  'calibrations/correct': (db, id, body) => rules.correctCalibration(db, id, body),
  'surveys/retest': (db, id, body) => rules.retestSurvey(db, id, body)
};

function operationMessage(op, result) {
  switch (op) {
    case 'devices/assign': return `已分配给 ${result.device.holder}`;
    case 'devices/return': return '设备已归还入库';
    case 'devices/handover': return `已交接，校准状态：${result.calibrationStatus}`;
    case 'calibrations/correct': return `校准已更正，${result.invalidated.length} 条未复核巡测失效待重测`;
    case 'surveys/retest': return result.ok ? '重测合格，已恢复' : `重测未通过：${result.reasons.join('；')}`;
    default: return '已更新';
  }
}

app.post('/api/:collection/:id/:op', async (req, res) => {
  const key = `${req.params.collection}/${req.params.op}`;
  const operation = OPERATIONS[key];
  if (!operation) return res.status(404).json({ error: 'unknown operation' });
  const db = await store.readDb();
  const result = operation(db, req.params.id, req.body || {});
  if (result.error) return res.status(409).json({ error: result.error });
  await store.writeDb(db);
  res.json({ ...result, message: operationMessage(key, result) });
});

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
