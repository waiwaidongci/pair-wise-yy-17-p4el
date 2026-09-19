const state = {
  config: null,
  db: {},
  activeTab: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '请求失败');
  }
  if (res.status === 204) return null;
  return res.json();
}

// 条件匹配：统计、看板焦点、动作显隐共用同一套过滤器
function matchFilter(item, filter) {
  const left = item[filter.field] ?? '';
  const right = filter.value === '$today' ? todayStr() : filter.value;
  if (filter.values) return filter.values.includes(left);
  switch (filter.op || 'eq') {
    case 'ne': return left !== right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    case 'gt': return left > right;
    case 'gte': return left >= right;
    default: return left === right;
  }
}

function matchFilters(item, filters = []) {
  return filters.every((filter) => matchFilter(item, filter));
}

function collectionLabel(collection) {
  return state.config.collections[collection]?.label || collection;
}

function relationLabel(relation, id) {
  const item = state.db[relation.collection]?.find((entry) => entry.id === id);
  if (!item) return '未关联';
  return relation.labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
}

function optionList(items, labelFields, selected) {
  return items.map((item) => {
    const label = labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
    const mark = item.id === selected ? ' selected' : '';
    return `<option value="${item.id}"${mark}>${escapeHtml(label)}</option>`;
  }).join('');
}

// 级联下拉：如“校准记录”只列出当前所选设备的校准
function relationAttrs(field) {
  const depends = field.dependsOn ? ` data-depends-on="${field.dependsOn.source}" data-match="${field.dependsOn.match}"` : '';
  return `${depends} data-collection="${field.collection}" data-label-fields='${escapeHtml(JSON.stringify(field.labelFields))}'`;
}

function filterRelationOptions(select, sourceValue) {
  const items = state.db[select.dataset.collection] || [];
  const labelFields = JSON.parse(select.dataset.labelFields || '[]');
  const match = select.dataset.match;
  const filtered = items.filter((item) => !sourceValue || item[match] === sourceValue);
  const current = select.value;
  select.innerHTML = optionList(filtered, labelFields, current);
}

function syncDependentSelects(root = document) {
  $$('select[data-depends-on]', root).forEach((select) => {
    const source = select.form?.elements[select.dataset.dependsOn];
    if (source) filterRelationOptions(select, source.value);
  });
}

function formField(field) {
  const required = field.required ? 'required' : '';
  const value = field.default ? `value="${escapeHtml(field.default)}"` : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<textarea name="${field.name}" ${required}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}${relationAttrs(field)}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function toneFor(value) {
  return state.config.tones?.[value] || '';
}

function historyHtml(item) {
  const history = item.history || [];
  if (!history.length) return '';
  return `<div class="history">${history.slice(0, 5).map((entry) => `
    <div class="history-item"><span>${fmtDate(entry.at)}</span><span>${escapeHtml(entry.action)}${entry.note ? '：' + escapeHtml(entry.note) : ''}</span></div>
  `).join('')}</div>`;
}

function values(form, view) {
  const payload = Object.fromEntries(new FormData(form).entries());
  for (const field of view.fields) {
    if (field.type === 'number') payload[field.name] = Number(payload[field.name] || 0);
  }
  return { ...view.defaults, ...payload };
}

function renderTabs() {
  $('#tabs').innerHTML = state.config.views.map((view, index) => `
    <button class="tab${index === 0 ? ' active' : ''}" data-tab="${view.id}">${escapeHtml(view.label)}</button>
  `).join('');
  state.activeTab = state.config.views[0].id;
}

function setTab(tabId) {
  state.activeTab = tabId;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));
}

function renderStats() {
  return `<div class="stats">${state.config.stats.map((stat) => {
    const items = state.db[stat.collection] || [];
    const filters = stat.filters || (stat.filter ? [stat.filter] : []);
    const value = items.filter((item) => matchFilters(item, filters)).length;
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>`;
}

function renderCard(item, collection, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const pillFields = view.pills || (view.statusField ? [view.statusField] : []);
  const pills = pillFields.map((field) => item[field] ? pill(item[field], toneFor(item[field])) : '').join('');
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    const raw = item[field.name];
    const value = field.type === 'relation' ? relationLabel(field, raw) : raw;
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');
  const actions = state.config.actions
    .filter((action) => action.collection === collection)
    .filter((action) => !action.showWhen || matchFilters(item, [].concat(action.showWhen)))
    .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`)
    .join('');
  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3><div class="pills">${pills}</div></div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    ${historyHtml(item)}
  </article>`;
}

function renderList(view) {
  const collection = view.collection;
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[collection] || [])];
  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => String(item[field] || '').includes(query)));
  }
  if (status) {
    items = items.filter((item) => item[view.statusField] === status);
  }
  return items.length ? items.map((item) => renderCard(item, collection, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
}

function renderDashboardView(view) {
  const focuses = Array.isArray(view.focus) ? view.focus : [view.focus];
  const panels = focuses.map((focus) => {
    let items = (state.db[focus.collection] || []).filter((item) => matchFilters(item, focus.filters || []));
    items = items.slice(0, focus.limit || 8);
    const cardView = state.config.views.find((entry) => entry.collection === focus.collection) || focus;
    const list = items.length ? items.map((item) => renderCard(item, focus.collection, cardView)).join('') : '<div class="empty">暂无事项</div>';
    return `<div class="panel"><h2>${escapeHtml(focus.title)}</h2><div class="list">${list}</div></div>`;
  }).join('');
  return `<section class="view active" id="${view.id}">
    ${renderStats()}
    <div class="focus-grid">${panels}</div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  const idempotencyKey = view.idempotency
    ? `<input type="hidden" name="submissionKey" value="${Date.now()}-${Math.random().toString(16).slice(2, 10)}">`
    : '';
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map(formField).join('')}</div>
        ${idempotencyKey}
        <div class="actions"><button>${escapeHtml(view.submitLabel || '保存')}</button></div>
      </form>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder || '搜索')}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderList(view)}</div>
      </div>
    </div>
  </section>`;
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views.map((view) => view.type === 'dashboard' ? renderDashboardView(view) : renderCrudView(view)).join('');
  setTab(state.activeTab || state.config.views[0].id);
  syncDependentSelects();
}

async function load() {
  state.db = await api('/api/db');
  render();
}

async function runAction(action, id, payload = {}) {
  try {
    await api(`/api/action/${action.id}/${id}`, { method: 'POST', body: JSON.stringify(payload) });
    await load();
    toast('已更新');
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

// 动作弹窗：需要输入的动作（分配/换班/校准更正/重测）先收集参数再提交
function modalField(prompt, item) {
  const required = prompt.required ? 'required' : '';
  const prefill = prompt.prefill ? item?.[prompt.prefill] ?? '' : prompt.default ?? '';
  if (prompt.type === 'select') {
    const options = prompt.options.map((option) => `<option${option === prefill ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('');
    return `<label>${prompt.label}<select name="${prompt.name}" ${required}>${options}</select></label>`;
  }
  if (prompt.type === 'relation') {
    const items = state.db[prompt.collection] || [];
    return `<label>${prompt.label}<select name="${prompt.name}" ${required}${relationAttrs(prompt)}>${optionList(items, prompt.labelFields, prefill)}</select></label>`;
  }
  return `<label>${prompt.label}<input type="${prompt.type || 'text'}" name="${prompt.name}" value="${escapeHtml(String(prefill))}" ${required}></label>`;
}

function closeModal() {
  $('.modal-mask')?.remove();
}

function openActionModal(action, item) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal"><form>
    <h3>${escapeHtml(action.label)}</h3>
    <div class="form-grid">${action.prompts.map((prompt) => modalField(prompt, item)).join('')}</div>
    <div class="actions">
      <button type="submit">确认${escapeHtml(action.label)}</button>
      <button type="button" class="ghost" data-close>取消</button>
    </div>
  </form></div>`;
  document.body.appendChild(mask);
  syncDependentSelects(mask);
  const form = mask.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const ok = await runAction(action, item.id, payload);
    if (ok) closeModal();
  });
  mask.addEventListener('click', (event) => {
    if (event.target === mask || event.target.closest('[data-close]')) closeModal();
  });
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  const button = event.target.closest('[data-action]');
  if (tab) setTab(tab.dataset.tab);
  if (button) {
    const action = state.config.actions.find((entry) => entry.id === button.dataset.action);
    const item = state.db[action.collection]?.find((entry) => entry.id === button.dataset.id);
    if (!action || !item) return;
    if (action.prompts?.length) {
      openActionModal(action, item);
      return;
    }
    await runAction(action, item.id);
  }
});

document.addEventListener('input', (event) => {
  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) $(`#list-${view.id}`).innerHTML = renderList(view);
});

document.addEventListener('change', (event) => {
  const form = event.target.closest('form');
  if (!form || !event.target.name) return;
  $$(`select[data-depends-on="${event.target.name}"]`, form).forEach((select) => filterRelationOptions(select, event.target.value));
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  try {
    const result = await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
    form.reset();
    await load();
    toast(result && result.duplicate ? '重复提交，已沿用首次记录' : '已保存');
  } catch (error) {
    toast(error.message);
  }
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
