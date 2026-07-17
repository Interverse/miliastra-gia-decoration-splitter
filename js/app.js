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
  btnMoveUp: $('btn-move-up'), btnMoveDown: $('btn-move-down'),
  tableWrap: $('dec-table-wrap'),
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

// size the dropdown to the current selection, not the longest option
const langMeasure = document.createElement('canvas').getContext('2d');
function fitLangSelect() {
  const opt = els.langSelect.selectedOptions[0];
  if (!opt) return;
  const cs = getComputedStyle(els.langSelect);
  langMeasure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = langMeasure.measureText(opt.textContent).width;
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  els.langSelect.style.width = `${Math.ceil(text + pad) + 4}px`;
}
document.fonts?.ready.then(fitLangSelect);

onLangChange(() => {
  els.langSelect.value = currentLang();
  fitLangSelect();
  if (state.session) {
    renderMeta();
    renderAll();
  }
});

initI18n().then(() => {
  els.langSelect.value = currentLang();
  fitLangSelect();
});

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

// The file-import overlay reacts ONLY to external file drags. Internal UI
// drags (decoration reordering) carry 'text/plain', not 'Files', and are
// additionally flagged via drag.indices — they never touch the overlay.
const isFileDrag = (e) =>
  !drag.indices && [...(e.dataTransfer?.types ?? [])].includes('Files');

let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (--dragDepth === 0) document.body.classList.remove('dragging');
});
document.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
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
    name.title = `${m.name} — ${t('rename.tip')}`;
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      renameModelInline(name, m.id);
    });

    // model rows accept decoration drags from the table (move between models)
    row.addEventListener('dragover', (e) => {
      if (!drag.indices || m.id === state.currentModel) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      if (!drag.indices || m.id === state.currentModel) return;
      e.preventDefault();
      e.stopPropagation();
      const indices = drag.indices;
      endDrag();
      drag.indices = indices; // moveSelectionToModel reads them
      moveSelectionToModel(m.id);
      drag.indices = null;
    });

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
  els.detailName.title = t('rename.tip');
  els.detailName.ondblclick = () => renameModelInline(els.detailName, state.currentModel);
  els.detailCount.textContent = tn('detail.entries', decs.length);

  els.decBody.textContent = '';
  state.rows = [];
  const frag = document.createDocumentFragment();
  for (const d of decs) {
    const tr = document.createElement('tr');
    tr.dataset.index = d.index;
    tr.draggable = true;
    tr.addEventListener('dragstart', (e) => onDragStart(d.index, e));
    tr.addEventListener('dragover', (e) => onDragOver(d.index, tr, e));
    tr.addEventListener('drop', (e) => onDrop(e));
    tr.addEventListener('dragend', endDrag);

    const tdDrag = document.createElement('td');
    tdDrag.className = 'col-drag';
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = t('reorder.dragTip');
    tdDrag.appendChild(handle);

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
    tdName.title = t('rename.tip');
    tdName.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(tdName, d.name ?? '', (v) => {
        state.session.renameDecoration(state.currentModel, d.index, v);
        renderDetail();
        renderExport();
      });
    });

    const tdId = document.createElement('td');
    tdId.className = 'num dec-id';
    if (d.guid != null) tdId.textContent = d.guid; // identifier — no grouping
    else { tdId.textContent = '—'; tdId.classList.add('muted'); }

    tr.append(tdDrag, tdCheck, tdIdx, tdName, tdId);
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
  els.btnMoveUp.disabled = n === 0;
  els.btnMoveDown.disabled = n === 0;
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

// ---------- reordering (drag-and-drop + arrow buttons) ----------

const drag = { indices: null, target: null, marked: null };

function onDragStart(i, e) {
  // dragging a selected row moves the whole selection; otherwise just this row
  if (!state.sel.has(i)) {
    state.sel = new Set([i]);
    state.anchor = i;
    syncSelection();
  }
  drag.indices = [...state.sel].sort((a, b) => a - b);
  e.dataTransfer.setData('text/plain', '');
  e.dataTransfer.effectAllowed = 'move';
  for (const idx of drag.indices) state.rows[idx]?.classList.add('dragging');
  els.modelList.classList.add('dec-drag'); // other models light up as drop targets
}

function onDragOver(i, tr, e) {
  if (!drag.indices) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = tr.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  if (drag.marked && (drag.marked.tr !== tr || drag.marked.before !== before)) clearDropMarker();
  if (!drag.marked) {
    tr.classList.add(before ? 'drop-before' : 'drop-after');
    drag.marked = { tr, before };
    drag.target = { index: i, before };
  }
  // auto-scroll the table while dragging near its edges
  const wrap = els.tableWrap.getBoundingClientRect();
  if (e.clientY < wrap.top + 36) els.tableWrap.scrollTop -= 12;
  else if (e.clientY > wrap.bottom - 36) els.tableWrap.scrollTop += 12;
}

function clearDropMarker() {
  if (drag.marked) {
    drag.marked.tr.classList.remove('drop-before', 'drop-after');
    drag.marked = null;
  }
}

function onDrop(e) {
  e.preventDefault();
  if (!drag.indices || !drag.target) return;
  // insertion point in the current list, then re-expressed with the moved
  // rows lifted out (the engine's coordinate system)
  const raw = drag.target.index + (drag.target.before ? 0 : 1);
  const at = raw - drag.indices.filter((i) => i < raw).length;
  applyMove(drag.indices, at);
  endDrag();
}

function endDrag() {
  clearDropMarker();
  if (drag.indices) for (const idx of drag.indices) state.rows[idx]?.classList.remove('dragging');
  drag.indices = null;
  drag.target = null;
  els.modelList.classList.remove('dec-drag');
  for (const el of els.modelList.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
}

function applyMove(indices, at) {
  try {
    const res = state.session.moveDecorations(state.currentModel, indices, at);
    if (!res) return;
    // keep the moved block selected at its new position
    state.sel = new Set(Array.from({ length: res.count }, (_, k) => res.start + k));
    state.anchor = res.start;
    if (res.changed) {
      renderDetail();
      renderExport();
    } else {
      syncSelection();
    }
  } catch (err) {
    console.error(err);
    toast(errMsg(err, 'err.splitFail'));
  }
}

function moveSelection(delta) {
  const sel = [...state.sel].sort((a, b) => a - b);
  if (!sel.length) return;
  // block position among the non-selected rows, then shifted by one step
  let k = 0;
  for (let i = 0; i < sel[0]; i++) if (!state.sel.has(i)) k++;
  applyMove(sel, k + delta);
}

els.btnMoveUp.addEventListener('click', () => moveSelection(-1));
els.btnMoveDown.addEventListener('click', () => moveSelection(1));

// ---------- inline renaming (double-click) ----------

function startInlineRename(el, current, onCommit) {
  if (el.querySelector('input')) return;
  // freeze the host's box first, so swapping text for an input cannot
  // reflow the table/list layout while editing
  const rect = el.getBoundingClientRect();
  el.style.width = `${rect.width}px`;
  el.style.maxWidth = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = current;
  input.spellcheck = false;
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (commit && v && v !== current) onCommit(v);
    else renderAll(); // restore the original display
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

function renameModelInline(el, modelId) {
  const m = state.session.models[modelId];
  startInlineRename(el, m.name, (v) => {
    state.session.renameModel(modelId, v);
    renderAll();
  });
}

// ---------- moving decorations to another model (drag onto model row) ----------

function moveSelectionToModel(targetId) {
  const indices = drag.indices ?? [...state.sel];
  if (!indices.length || targetId === state.currentModel) return;
  try {
    const res = state.session.moveDecorationsToModel(state.currentModel, indices, targetId);
    if (!res) return;
    state.sel = new Set();
    state.anchor = null;
    renderAll();
    toast(tn('toast.moved', res.count, { name: res.targetName }), true);
  } catch (err) {
    console.error(err);
    toast(errMsg(err, 'err.splitFail'));
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
