// GIA Splitter — interactive, user-controlled Decoration-list splitting.
// Workflow: import a .gia → pick a model → select Decoration entries
// (click / Ctrl / Shift) → Split selected → repeat as needed → download.
// All splitting is byte-preserving; see js/gia-splitter.js.
// All user-facing text goes through js/i18n.js (t/tn/num + data-i18n).

import { GiaSession } from './gia-splitter.js';
import { t, tn, num, LANGS, currentLang, setLanguage, initI18n, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);

const els = {
  fileInput: $('file-input'), btnOpen: $('btn-open'), btnOpenHero: $('btn-open-hero'),
  dropzone: $('dropzone'), workbench: $('workbench'),
  fileMeta: $('file-meta'), metaName: $('meta-name'), metaStats: $('meta-stats'),
  modelCount: $('model-count'), modelList: $('model-list'),
  detailName: $('detail-name'), detailCount: $('detail-count'),
  btnSelectAll: $('btn-select-all'), btnSelectNone: $('btn-select-none'),
  splitInfo: $('split-info'), btnSplit: $('btn-split'),
  decBody: $('dec-table').querySelector('tbody'),
  exportBar: $('export-bar'), exModels: $('ex-models'), exSelected: $('ex-selected'),
  exSplits: $('ex-splits'), exSize: $('ex-size'), setName: $('set-name'),
  btnModelsAll: $('btn-models-all'), btnModelsNone: $('btn-models-none'),
  exportCount: $('export-count'),
  btnReset: $('btn-reset'), btnDownload: $('btn-download'), toast: $('toast'),
  langSelect: $('lang-select'),
};

const state = {
  sourceBytes: null,  // as loaded, for Reset
  fileName: '',
  session: null,      // GiaSession
  currentModel: 0,
  sel: new Set(),     // selected row indices in the current model
  anchor: null,       // shift-selection anchor
  rows: [],           // <tr> per decoration index
  exportSel: new Set() // uids of models included in the export
};

// ---------- language ----------

for (const l of LANGS) {
  const opt = document.createElement('option');
  opt.value = l.code;
  opt.textContent = l.name; // native names — never translated
  els.langSelect.appendChild(opt);
}
els.langSelect.addEventListener('change', () => setLanguage(els.langSelect.value));

onLangChange(() => {
  els.langSelect.value = currentLang();
  if (state.session) {
    renderMeta();
    renderAll();
  }
});

initI18n().then(() => { els.langSelect.value = currentLang(); });

// localized message for engine/UI errors (engine errors carry err.i18n codes)
const errMsg = (err, fallbackKey) =>
  err?.i18n ? t(err.i18n.key, err.i18n.params) : t(fallbackKey);

// ---------- file loading ----------

const openPicker = () => els.fileInput.click();
els.btnOpen.addEventListener('click', openPicker);
els.btnOpenHero.addEventListener('click', openPicker);
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
  els.fileInput.value = '';
});

let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) document.body.classList.add('dragging'); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth === 0) document.body.classList.remove('dragging'); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});

async function loadFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const session = new GiaSession(bytes); // validates before committing state
    state.sourceBytes = bytes;
    state.fileName = file.name.replace(/\.gia$/i, '');
    startSession(session);
  } catch (err) {
    console.error(err);
    toast(errMsg(err, 'err.readFail'));
  }
}

function startSession(session) {
  state.session = session;
  state.currentModel = 0;
  state.sel = new Set();
  state.anchor = null;
  // a new project starts with every model included in the export
  state.exportSel = new Set(session.models.map((m) => m.uid));

  renderMeta();
  els.setName.value = t('export.defaultName', { base: baseName() });

  els.dropzone.classList.add('hidden');
  els.workbench.classList.remove('hidden');
  els.exportBar.classList.remove('hidden');
  renderAll();
}

function baseName() {
  return state.session?.meta.exportName || state.fileName;
}

function renderMeta() {
  const meta = state.session.meta;
  els.metaName.textContent = baseName();
  els.metaStats.textContent = [
    tn('meta.models', meta.modelsBefore),
    tn('meta.entries', meta.decorationEntries),
    t('meta.engine', { v: meta.engineVersion || '?' }),
  ].join(' · ');
  els.fileMeta.classList.remove('hidden');
}

// ---------- model list (master) ----------

function renderModels(highlightId = null) {
  const models = state.session.models;
  els.modelCount.textContent = num(models.length);
  els.modelList.textContent = '';
  const frag = document.createDocumentFragment();
  for (const m of models) {
    const exported = state.exportSel.has(m.uid);
    const row = document.createElement('div');
    row.className = 'model-row'
      + (m.id === state.currentModel ? ' active' : '')
      + (exported ? '' : ' excluded')
      + (m.id === highlightId ? ' flash' : '');
    row.addEventListener('click', () => selectModel(m.id));

    // export inclusion — independent from which model is open for viewing
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'model-export';
    cb.checked = exported;
    cb.title = t('models.includeTip');
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) state.exportSel.add(m.uid);
      else state.exportSel.delete(m.uid);
      row.classList.toggle('excluded', !cb.checked);
      renderExport();
    });

    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = m.name || t('model.unnamed');
    name.title = m.name;

    const badges = document.createElement('span');
    badges.className = 'model-badges';
    if (m.isNew) {
      const tag = document.createElement('span');
      tag.className = 'tag-new';
      tag.textContent = t('tag.new');
      badges.appendChild(tag);
    }
    if (m.hasGraph) {
      const tag = document.createElement('span');
      tag.className = 'tag-graph';
      tag.textContent = t('tag.graph');
      tag.title = t('tag.graphTip');
      badges.appendChild(tag);
    }
    const count = document.createElement('span');
    count.className = 'model-count';
    count.textContent = num(m.count);
    count.title = tn('model.countTip', m.count);
    badges.appendChild(count);

    row.append(cb, name, badges);
    frag.appendChild(row);
  }
  els.modelList.appendChild(frag);
}

els.btnModelsAll.addEventListener('click', () => {
  state.exportSel = new Set(state.session.models.map((m) => m.uid));
  renderModels();
  renderExport();
});
els.btnModelsNone.addEventListener('click', () => {
  state.exportSel.clear();
  renderModels();
  renderExport();
});

function selectModel(id) {
  if (id === state.currentModel) return;
  state.currentModel = id;
  state.sel = new Set();
  state.anchor = null;
  renderModels();
  renderDetail();
}

// ---------- decoration table (detail) ----------

function renderDetail() {
  const model = state.session.models[state.currentModel];
  const decs = state.session.decorations(state.currentModel);

  els.detailName.textContent = model.name || t('model.unnamed');
  els.detailCount.textContent = tn('detail.entries', decs.length);

  els.decBody.textContent = '';
  state.rows = [];
  const frag = document.createDocumentFragment();
  for (const d of decs) {
    const tr = document.createElement('tr');
    tr.dataset.index = d.index;

    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.tabIndex = -1;
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggleRow(d.index); });
    tdCheck.appendChild(cb);

    const tdIdx = document.createElement('td');
    tdIdx.className = 'num muted';
    tdIdx.textContent = d.index; // position identifier — never locale-formatted

    const tdName = document.createElement('td');
    tdName.className = 'dec-name';
    if (d.name) tdName.textContent = d.name;
    else { tdName.textContent = '—'; tdName.classList.add('muted'); }

    const tdId = document.createElement('td');
    tdId.className = 'num dec-id';
    if (d.guid != null) tdId.textContent = d.guid; // identifier — no grouping
    else { tdId.textContent = '—'; tdId.classList.add('muted'); }

    tr.append(tdCheck, tdIdx, tdName, tdId);
    tr.addEventListener('click', (e) => onRowClick(d.index, e));
    state.rows.push(tr);
    frag.appendChild(tr);
  }
  els.decBody.appendChild(frag);
  syncSelection();
}

function onRowClick(i, e) {
  if (e.shiftKey && state.anchor != null) {
    const [a, b] = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    const range = [];
    for (let k = a; k <= b; k++) range.push(k);
    if (e.ctrlKey || e.metaKey) range.forEach((k) => state.sel.add(k));
    else state.sel = new Set(range);
  } else if (e.ctrlKey || e.metaKey) {
    toggleRow(i);
    return;
  } else {
    // plain click: if it's the only selected row, toggle it off; else select it alone
    if (state.sel.size === 1 && state.sel.has(i)) state.sel.clear();
    else state.sel = new Set([i]);
    state.anchor = i;
  }
  if (!e.shiftKey) state.anchor = i;
  syncSelection();
}

function toggleRow(i) {
  if (state.sel.has(i)) state.sel.delete(i);
  else state.sel.add(i);
  state.anchor = i;
  syncSelection();
}

els.btnSelectAll.addEventListener('click', () => {
  state.sel = new Set(state.rows.map((_, i) => i));
  syncSelection();
});
els.btnSelectNone.addEventListener('click', () => {
  state.sel.clear();
  syncSelection();
});

function syncSelection() {
  for (const tr of state.rows) {
    const i = Number(tr.dataset.index);
    const sel = state.sel.has(i);
    tr.classList.toggle('selected', sel);
    tr.querySelector('input').checked = sel;
  }
  const n = state.sel.size;
  els.btnSplit.disabled = n === 0;
  els.btnSplit.textContent = n ? t('split.buttonN', { n: num(n) }) : t('split.button');
  if (n === 0) {
    els.splitInfo.textContent = t('split.none');
    els.splitInfo.classList.remove('armed');
  } else {
    const target = state.session.previewSplitName(state.currentModel);
    els.splitInfo.innerHTML = t('split.info', {
      n: num(n),
      total: num(state.rows.length),
      name: escapeHtml(target),
    });
    els.splitInfo.classList.add('armed');
  }
}

// ---------- split ----------

els.btnSplit.addEventListener('click', () => {
  if (!state.sel.size) return;
  try {
    const n = state.sel.size;
    const newId = state.session.splitModel(state.currentModel, [...state.sel]);
    const newModel = state.session.models[newId];
    state.exportSel.add(newModel.uid); // new models default to exported
    state.sel = new Set();
    state.anchor = null;
    renderModels(newId);
    renderDetail();
    renderExport();
    toast(tn('toast.moved', n, { name: newModel.name }), true);
  } catch (err) {
    console.error(err);
    toast(errMsg(err, 'err.splitFail'));
  }
});

// ---------- export ----------

function renderExport() {
  const s = state.session;
  const models = s.models;
  // drop uids that no longer exist (e.g. after Reset created a new session)
  state.exportSel = new Set([...state.exportSel].filter((uid) => models.some((m) => m.uid === uid)));

  const now = models.length;
  const nSel = state.exportSel.size;
  const partial = nSel < now;

  els.exModels.innerHTML = s.changed
    ? `${num(s.meta.modelsBefore)}<span class="arrow">→</span>${num(now)}`
    : num(now);
  els.exSplits.textContent = num(s.splitCount);
  els.exSelected.textContent = `${num(nSel)}/${num(now)}`;
  els.exSelected.classList.toggle('partial', partial);

  const totalEntries = models
    .filter((m) => state.exportSel.has(m.uid))
    .reduce((sum, m) => sum + m.count, 0);
  els.exportCount.textContent = nSel === 0
    ? t('models.nothing')
    : t('models.exported', { sel: num(nSel), total: num(now), entries: num(totalEntries) });
  els.exportCount.classList.toggle('warn', nSel === 0);

  if (nSel === 0) {
    els.exSize.textContent = '—';
    els.btnDownload.disabled = true;
    els.btnDownload.textContent = t('export.download');
  } else {
    els.exSize.textContent = fmtBytes(s.serialize([...state.exportSel]).length);
    els.btnDownload.disabled = false;
    els.btnDownload.textContent = s.changed || partial
      ? t('export.downloadSplit')
      : t('export.downloadUnchanged');
  }
  els.btnReset.disabled = !s.changed;
}

els.btnReset.addEventListener('click', () => {
  if (!state.session?.changed) return;
  startSession(new GiaSession(state.sourceBytes));
  toast(t('toast.discarded'), true);
});

els.btnDownload.addEventListener('click', () => {
  if (!state.session || state.exportSel.size === 0) return;
  const fallback = t('export.defaultName', { base: state.fileName });
  const name = (els.setName.value.trim() || fallback).replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([state.session.serialize([...state.exportSel])], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.gia`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(t('toast.downloaded'), true);
});

// ---------- misc ----------

function renderAll() {
  renderModels();
  renderDetail();
  renderExport();
}

let toastTimer = null;
function toast(msg, ok = false) {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (ok ? ' ok' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3500);
}

function fmtBytes(n) {
  if (n < 1024) return `${num(n)} ${t('unit.b')}`;
  if (n < 1024 * 1024) return `${num(n / 1024, { maximumFractionDigits: 1 })} ${t('unit.kb')}`;
  return `${num(n / 1024 / 1024, { maximumFractionDigits: 2 })} ${t('unit.mb')}`;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.__gia = { state }; // debug hook
