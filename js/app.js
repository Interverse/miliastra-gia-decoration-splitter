// GIA Splitter — interactive, user-controlled Decoration-list splitting.
// Workflow: import a .gia → pick a model → select Decoration entries
// (click / Ctrl / Shift) → Split selected → repeat as needed → download.
// All splitting is byte-preserving; see js/gia-splitter.js.

import { GiaSession } from './gia-splitter.js';

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
  exportBar: $('export-bar'), exModels: $('ex-models'), exSplits: $('ex-splits'),
  exSize: $('ex-size'), setName: $('set-name'),
  btnReset: $('btn-reset'), btnDownload: $('btn-download'), toast: $('toast'),
};

const state = {
  sourceBytes: null,  // as loaded, for Reset
  fileName: '',
  session: null,      // GiaSession
  currentModel: 0,
  sel: new Set(),     // selected row indices in the current model
  anchor: null,       // shift-selection anchor
  rows: [],           // <tr> per decoration index
};

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
    toast(err.message || 'Failed to read that file.');
  }
}

function startSession(session) {
  state.session = session;
  state.currentModel = 0;
  state.sel = new Set();
  state.anchor = null;

  const base = session.meta.exportName || state.fileName;
  els.metaName.textContent = base;
  els.metaStats.textContent =
    `${session.meta.modelsBefore} model${session.meta.modelsBefore === 1 ? '' : 's'} · ${session.meta.decorationEntries.toLocaleString()} Decoration entries · engine ${session.meta.engineVersion || '?'}`;
  els.fileMeta.classList.remove('hidden');
  els.setName.value = `${base} Split`;

  els.dropzone.classList.add('hidden');
  els.workbench.classList.remove('hidden');
  els.exportBar.classList.remove('hidden');
  renderAll();
}

// ---------- model list (master) ----------

function renderModels(highlightId = null) {
  const models = state.session.models;
  els.modelCount.textContent = models.length;
  els.modelList.textContent = '';
  const frag = document.createDocumentFragment();
  for (const m of models) {
    const row = document.createElement('div');
    row.className = 'model-row'
      + (m.id === state.currentModel ? ' active' : '')
      + (m.id === highlightId ? ' flash' : '');
    row.addEventListener('click', () => selectModel(m.id));

    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = m.name || '(unnamed)';
    name.title = m.name;

    const badges = document.createElement('span');
    badges.className = 'model-badges';
    if (m.isNew) {
      const tag = document.createElement('span');
      tag.className = 'tag-new';
      tag.textContent = 'new';
      badges.appendChild(tag);
    }
    const count = document.createElement('span');
    count.className = 'model-count';
    count.textContent = m.count.toLocaleString();
    badges.appendChild(count);

    row.append(name, badges);
    frag.appendChild(row);
  }
  els.modelList.appendChild(frag);
}

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

  els.detailName.textContent = model.name || '(unnamed)';
  els.detailCount.textContent = `${decs.length.toLocaleString()} entr${decs.length === 1 ? 'y' : 'ies'}`;

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
    tdIdx.textContent = d.index;

    const tdName = document.createElement('td');
    tdName.className = 'dec-name';
    if (d.name) tdName.textContent = d.name;
    else { tdName.textContent = '—'; tdName.classList.add('muted'); }

    const tdId = document.createElement('td');
    tdId.className = 'num dec-id';
    if (d.guid != null) tdId.textContent = d.guid;
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
  els.btnSplit.textContent = n ? `Split ${n.toLocaleString()} selected` : 'Split selected';
  if (n === 0) {
    els.splitInfo.textContent = 'No Decoration entries selected.';
    els.splitInfo.classList.remove('armed');
  } else {
    const target = state.session.previewSplitName(state.currentModel);
    els.splitInfo.innerHTML =
      `<b>${n.toLocaleString()}</b> of ${state.rows.length.toLocaleString()} entries will move to new model <b>${escapeHtml(target)}</b>`;
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
    state.sel = new Set();
    state.anchor = null;
    renderModels(newId);
    renderDetail();
    renderExport();
    toast(`Moved ${n.toLocaleString()} entr${n === 1 ? 'y' : 'ies'} to "${newModel.name}".`, true);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Split failed.');
  }
});

// ---------- export ----------

function renderExport() {
  const s = state.session;
  const now = s.models.length;
  els.exModels.innerHTML = s.changed
    ? `${s.meta.modelsBefore}<span class="arrow">→</span>${now}`
    : String(now);
  els.exSplits.textContent = s.splitCount;
  els.exSize.textContent = fmtBytes(s.serialize().length);
  els.btnDownload.textContent = s.changed ? 'Download split .gia' : 'Download .gia (unchanged)';
  els.btnReset.disabled = !s.changed;
}

els.btnReset.addEventListener('click', () => {
  if (!state.session?.changed) return;
  startSession(new GiaSession(state.sourceBytes));
  toast('All splits discarded.', true);
});

els.btnDownload.addEventListener('click', () => {
  if (!state.session) return;
  const name = (els.setName.value.trim() || `${state.fileName} Split`).replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([state.session.serialize()], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.gia`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('File downloaded.', true);
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
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.__gia = { state }; // debug hook
