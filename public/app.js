// 界面层：只负责渲染与交互，业务判定全部交给服务端规则层。
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

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
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

function collectionLabel(collection) {
  return state.config.collections[collection]?.label || collection;
}

function relationLabel(relation, id) {
  const item = state.db[relation.collection]?.find((entry) => entry.id === id);
  if (!item) return '未关联';
  return relation.labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
}

function optionList(items, labelFields, emptyLabel) {
  if (!items.length) return `<option value="">${escapeHtml(emptyLabel || '（无匹配记录）')}</option>`;
  return items.map((item) => {
    const label = labelFields.map((field) => item[field]).filter(Boolean).join(' / ');
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join('');
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
    const link = field.filterLink ? ` data-filter-link='${JSON.stringify(field.filterLink)}'` : '';
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}${link}>${optionList(items, field.labelFields)}</select></label>`;
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
    const value = stat.filter ? items.filter((item) => item[stat.filter.field] === stat.filter.value).length : items.length;
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>`;
}

function detailValue(item, field) {
  if (field.combine) {
    return field.combine
      .map((name) => item[name])
      .filter((entry) => entry !== undefined && entry !== null && entry !== '')
      .join(field.sep || ' ~ ');
  }
  const raw = item[field.name];
  if (field.type === 'relation') return relationLabel(field, raw);
  return raw;
}

// 动作可见性：when 条件不满足不渲染（服务端仍有兜底校验）
function actionVisible(action, item) {
  if (!action.when) return true;
  return action.when.in.includes(item[action.when.field]);
}

function actionParamInput(param, item) {
  const required = param.required ? 'required' : '';
  if (param.type === 'select') {
    return `<label>${escapeHtml(param.label)}<select name="${param.name}" ${required}>${param.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (param.type === 'relation') {
    let items = state.db[param.collection] || [];
    if (param.filterField && param.filterItem) {
      items = items.filter((entry) => entry[param.filterField] === item[param.filterItem]);
    }
    const placeholder = param.required ? '' : '<option value="">（保持不变）</option>';
    return `<label>${escapeHtml(param.label)}<select name="${param.name}" ${required}>${placeholder}${optionList(items, param.labelFields)}</select></label>`;
  }
  return `<label>${escapeHtml(param.label)}<input type="${param.type || 'text'}" name="${param.name}" ${required}></label>`;
}

function actionFormHtml(action, item, collection) {
  return `<form class="action-form" data-op="${action.op}" data-collection="${collection}" data-id="${item.id}" hidden>
    ${action.params.map((param) => actionParamInput(param, item)).join('')}
    <div class="inline-actions"><button type="submit">确认${escapeHtml(action.label)}</button></div>
  </form>`;
}

function renderCard(item, collection, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const statusValue = item[view.statusField];
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    const value = detailValue(item, field);
    return `<div>${escapeHtml(field.label)}<br><strong>${escapeHtml(value || '-')}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');
  const actions = state.config.actions.filter((action) => action.collection === collection && actionVisible(action, item));
  const buttons = actions.map((action) => {
    if (action.params) {
      return `<button class="ghost" data-toggle-action="${action.op}" data-id="${item.id}">${escapeHtml(action.label)}</button>`;
    }
    if (action.op) {
      return `<button class="${action.danger ? 'danger' : 'ghost'}" data-op-btn="${action.op}" data-collection="${collection}" data-id="${item.id}">${escapeHtml(action.label)}</button>`;
    }
    return `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`;
  }).join('');
  const forms = actions.filter((action) => action.params).map((action) => actionFormHtml(action, item, collection)).join('');
  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${buttons ? `<div class="actions">${buttons}</div>` : ''}
    ${forms}
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
  const focuses = view.focuses || (view.focus ? [{ ...view.focus, title: view.focusTitle }] : []);
  const panels = focuses.map((focus) => {
    let items = [...(state.db[focus.collection] || [])];
    if (focus.field) items = items.filter((item) => focus.values.includes(item[focus.field]));
    items = items.slice(0, focus.limit || 8);
    const cardView = state.config.views.find((entry) => entry.collection === focus.collection) || focus;
    return `<div class="panel"><h2>${escapeHtml(focus.title)}</h2><div class="list">${items.length ? items.map((item) => renderCard(item, focus.collection, cardView)).join('') : '<div class="empty">暂无记录</div>'}</div></div>`;
  }).join('');
  return `<section class="view active" id="${view.id}">
    ${renderStats()}
    <div class="dash-grid">${panels}</div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  const submissionKey = view.idempotency
    ? `<input type="hidden" name="submissionKey" value="${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}">`
    : '';
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map(formField).join('')}${submissionKey}</div>
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
}

async function load() {
  state.db = await api('/api/db');
  render();
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  if (tab) setTab(tab.dataset.tab);

  const toggle = event.target.closest('[data-toggle-action]');
  if (toggle) {
    const card = toggle.closest('.card');
    const form = card?.querySelector(`form[data-op="${toggle.dataset.toggleAction}"][data-id="${toggle.dataset.id}"]`);
    if (form) form.hidden = !form.hidden;
    return;
  }

  const opButton = event.target.closest('[data-op-btn]');
  if (opButton) {
    try {
      const result = await api(`/api/${opButton.dataset.collection}/${opButton.dataset.id}/${opButton.dataset.opBtn}`, { method: 'POST', body: '{}' });
      await load();
      toast(result?.message || '已更新');
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    try {
      await api(`/api/action/${action.dataset.action}/${action.dataset.id}`, { method: 'POST' });
      await load();
      toast('已更新');
    } catch (error) {
      toast(error.message);
    }
  }
});

document.addEventListener('input', (event) => {
  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) $(`#list-${view.id}`).innerHTML = renderList(view);
});

// 联动下拉：如校准记录随所选设备过滤
document.addEventListener('change', (event) => {
  const form = event.target.closest('form[data-create]');
  if (!form) return;
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  for (const field of view?.fields || []) {
    if (field.filterLink?.form !== event.target.name) continue;
    const select = form.elements[field.name];
    if (!select) continue;
    const sourceValue = event.target.value;
    const items = (state.db[field.collection] || []).filter((item) => !sourceValue || item[field.filterLink.field] === sourceValue);
    select.innerHTML = optionList(items, field.labelFields, '（该设备暂无校准记录）');
  }
});

document.addEventListener('submit', async (event) => {
  const opForm = event.target.closest('form[data-op]');
  if (opForm) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(opForm).entries());
    try {
      const result = await api(`/api/${opForm.dataset.collection}/${opForm.dataset.id}/${opForm.dataset.op}`, { method: 'POST', body: JSON.stringify(payload) });
      await load();
      toast(result?.message || '已更新');
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  try {
    const result = await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
    form.reset();
    await load();
    toast(result?.deduplicated ? '重复提交，已沿用首次记录' : '已保存');
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
