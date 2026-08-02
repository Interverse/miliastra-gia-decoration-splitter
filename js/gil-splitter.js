// GilSession — UI-facing session over the byte-preserving .gil engine
// (js/gil/). Mirrors the role GiaSession plays for .gia files: it owns the
// loaded document, exposes display views for the master/detail panels and the
// 3D viewer, orchestrates the extraction operations, and keeps exact
// byte-level undo/redo.
//
// The engine modules in js/gil/ are copied verbatim from the verified .gil
// splitter (byte-for-byte round-trip guaranteed by tools/test-gil.mjs) and
// must not be modified; everything site-specific lives here instead.
//
// Undo/redo snapshots are references to the three mutated containers' raw
// bytes (objects, registry, decorations). The engine replaces those arrays on
// mutation and never edits them in place, so snapshots are zero-copy and
// restoring one reproduces the pre-edit file byte-identically.

import { parseGilContainer, buildGilContainer, fieldString } from './gil/gil.js';
import { parseLevel } from './gil/model.js';
import {
  planSplit,
  applySplit,
  checkParentRemoval,
  makeParentComposer,
  MAX_SCALE,
} from './gil/split.js';

export { MAX_SCALE };

export class GilSession {
  constructor(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    // parseGilContainer/parseLevel throw descriptive (English) errors on
    // malformed input; the caller shows them in the load-failure dialog.
    // Nothing is committed to this session until both succeed.
    const container = parseGilContainer(bytes);
    const level = parseLevel(container);
    level.objects; // force-parse now so structural errors surface at load time
    level.decorations;

    this._bytes = bytes;
    this.container = container;
    this.level = level;
    this._undo = []; // [{label:{key,params}, snap}]
    this._redo = [];

    this.meta = {
      levelName: level.name || '',
      gameVersion: this._readVersion(),
      objectsBefore: level.objects.length,
      decorationsBefore: level.decorations.length,
    };
  }

  _readVersion() {
    const f = this.level.root.find((f) => f.num === 43 && f.wire === 2);
    try {
      return f ? fieldString(f) : null;
    } catch {
      return null;
    }
  }

  // id → decoration lookup. level.decorationById is a linear scan, which is
  // O(n²) when walking a parent's id list on large levels; this map is built
  // once per parse and keyed to the level's own cache so undo/redo (which
  // calls level.invalidate()) rebuilds it automatically.
  _decoMap() {
    const decos = this.level.decorations;
    if (this._decoMapFor !== decos) {
      this._decoMapFor = decos;
      this._decoMapCache = new Map(decos.map((d) => [d.id, d]));
    }
    return this._decoMapCache;
  }

  get changed() {
    return this._undo.length > 0;
  }
  get edits() {
    return this._undo.length;
  }
  get canUndo() {
    return this._undo.length > 0;
  }
  get canRedo() {
    return this._redo.length > 0;
  }

  // ---------- display views ----------

  /** Object-list rows. eligible = has decorations (a valid extraction parent). */
  objects({ parentsOnly = true } = {}) {
    const rows = [];
    for (const o of this.level.objects) {
      const count = o.decorationIds.length;
      if (parentsOnly && !count) continue;
      rows.push({ id: o.id, name: o.name, prefabId: o.prefabId, count, eligible: count > 0 });
    }
    return rows;
  }

  parentCount() {
    return this.level.objects.reduce((a, o) => a + (o.decorationIds.length ? 1 : 0), 0);
  }

  /** Decoration rows of one parent, in the parent's list order. */
  decorations(parentId) {
    const parent = this.level.objectById(parentId);
    if (!parent) return [];
    const byId = this._decoMap();
    const out = [];
    // index counts resolved decorations only, matching decorationPoints()
    for (const did of parent.decorationIds) {
      const d = byId.get(did);
      if (!d) continue;
      out.push({
        index: out.length,
        id: d.id,
        name: d.name,
        prefabId: d.prefabId,
        collision: d.collision !== false, // null (prefab default) displays as on
      });
    }
    return out;
  }

  /**
   * 3D-viewer points for one parent's decorations: composed world positions
   * (display-only — the write path recomputes transforms in the engine).
   * index matches the row index from decorations(parentId).
   */
  decorationPoints(parentId) {
    const parent = this.level.objectById(parentId);
    if (!parent) return [];
    const byId = this._decoMap();
    const compose = parent.transform ? makeParentComposer(parent.transform) : null;
    const points = [];
    let index = 0;
    for (const did of parent.decorationIds) {
      const d = byId.get(did);
      if (!d) continue;
      let p = d.transform ? d.transform.pos : { x: 0, y: 0, z: 0 };
      if (compose && d.transform) p = compose(d.transform).pos;
      points.push({ index, guid: d.id, name: d.name, x: p.x, y: p.y, z: p.z });
      index++;
    }
    return points;
  }

  // ---------- extraction ----------

  /**
   * Plan an extraction without modifying anything.
   * mode 'decos': exactly the decorations in onlyDecoIds — their parents are
   * derived from the level itself (every object whose decoration list holds a
   * selected id), so the operation follows the decoration selection wherever
   * it lives, independent of which parents are checked or viewed.
   * mode 'parents': everything inside selectedParentIds.
   * Returns {plan, removal, parentIds} where removal is the parent-deletion
   * safety result (empty unless removeParent is requested and some parent
   * would be fully emptied).
   */
  planExtraction({ mode, selectedParentIds, onlyDecoIds = null, removeParent = false }) {
    const L = this.level;
    let parentIds;
    if (mode === 'decos') {
      parentIds = L.objects
        .filter((o) => o.decorationIds.some((d) => onlyDecoIds.has(d)))
        .map((o) => o.id);
    } else {
      parentIds = [...selectedParentIds];
    }
    const plan = planSplit(L, parentIds, mode === 'decos' ? { onlyDecoIds } : {});

    let removal = { removable: new Set(), warnings: [] };
    if (removeParent && plan.entries.length) {
      // Only parents whose ENTIRE decoration list is being extracted are
      // removal candidates; checkParentRemoval scans the level ONCE for all
      // of them (never per parent).
      const extracted = new Set(plan.entries.map((e) => e.deco.id));
      const fullyCovered = [...new Set(plan.entries.map((e) => e.parent.id))].filter((pid) => {
        const o = L.objectById(pid);
        return o && o.decorationIds.every((d) => extracted.has(d));
      });
      if (fullyCovered.length) removal = checkParentRemoval(L, fullyCovered);
    }
    return { plan, removal, parentIds };
  }

  /**
   * Apply a planned extraction (async; yields to the UI thread). Pushes an
   * undo snapshot and clears the redo stack. Returns the engine summary.
   */
  async applyExtraction({ plan, removal, label, collision, removeParent, onProgress = null }) {
    const snap = this._snapshot();
    const summary = await applySplit(this.level, plan, {
      collision,
      removeParent,
      removableParents: removal.removable,
      onProgress,
    });
    this._undo.push({ label, snap });
    this._redo.length = 0;
    return summary;
  }

  // ---------- undo / redo (exact byte-level state) ----------

  _snapshot() {
    const grab = (f) => (f ? f.raw : null);
    return {
      obj: grab(this.level.objectContainerField),
      reg: grab(this.level.registryContainerField),
      deco: grab(this.level.decoContainerField),
    };
  }

  _restore(snap) {
    const put = (f, raw) => {
      if (f && raw !== null) f.raw = raw;
    };
    put(this.level.objectContainerField, snap.obj);
    put(this.level.registryContainerField, snap.reg);
    put(this.level.decoContainerField, snap.deco);
    this.level.invalidate();
  }

  /** Undo the latest operation; returns its label, or null. */
  undo() {
    const op = this._undo.pop();
    if (!op) return null;
    const current = this._snapshot();
    this._restore(op.snap);
    this._redo.push({ label: op.label, snap: current });
    return op.label;
  }

  /** Redo the latest undone operation; returns its label, or null. */
  redo() {
    const op = this._redo.pop();
    if (!op) return null;
    const current = this._snapshot();
    this._restore(op.snap);
    this._undo.push({ label: op.label, snap: current });
    return op.label;
  }

  // ---------- output ----------

  /** Serialized file; the original input bytes when nothing was changed. */
  serialize() {
    if (!this.changed) return this._bytes;
    return buildGilContainer(
      this.container.head,
      this.level.encodePayload(),
      this.container.suffix
    );
  }
}

export default { GilSession };
