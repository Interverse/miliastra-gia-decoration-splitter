// Interactive .gia Decoration-list splitter — pure byte-level protobuf surgery.
//
// GiaSession wraps a loaded .gia and supports repeated, user-directed splits:
// any subset of a model's Decoration entries can be moved into a newly created
// model. Serialization preserves everything that wasn't touched:
//
//   - Decoration entries are copied verbatim regardless of type or contents;
//     only the parent-model reference (component 4/40 field 502) is rewritten
//     for entries that move to a new model.
//   - New models are byte-copies of the source model — all non-Decoration
//     data is carried over — except fields that must remain unique: they get
//     a fresh guid and name, and only the moved decorations' references.
//     A node-graph binding, which may belong to one model only, stays with
//     the source model.
//   - Every entry and field the tool does not understand passes through
//     untouched, so unknown fields and future decoration types survive.
//   - Decoration ordering is preserved in both the original and the new
//     model (each keeps its entries in source-list order).
//
// If no split was performed, serialize() returns the original input bytes.

const utf8 = new TextDecoder();
const utf8enc = new TextEncoder();

// Errors carry an i18n code + params so the UI can localize them; the
// message itself stays English for logs and tests.
function fail(message, key, params) {
  const e = new Error(message);
  e.i18n = { key, params };
  throw e;
}

// ---------- low-level protobuf ----------

function readVarint(b, o) {
  let v = 0n, s = 0n, x;
  do { x = b[o++]; v |= BigInt(x & 127) << s; s += 7n; } while (x & 128);
  return [v, o];
}

function encVarint(v) {
  let n = BigInt(v);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return out;
}

// Parse a message body into field items. Item value by wire type:
// 0 = BigInt, 2 = Uint8Array body, 5/1 = raw 4/8-byte Uint8Array.
function parseMsg(b) {
  const items = [];
  let o = 0;
  while (o < b.length) {
    let key; [key, o] = readVarint(b, o);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    if (wire === 0) {
      let v; [v, o] = readVarint(b, o);
      items.push({ field, wire, val: v });
    } else if (wire === 2) {
      let len; [len, o] = readVarint(b, o);
      const n = Number(len);
      if (o + n > b.length) fail('Corrupt message: field overruns buffer', 'err.corrupt');
      items.push({ field, wire, val: b.subarray(o, o + n) });
      o += n;
    } else if (wire === 5) {
      items.push({ field, wire, val: b.subarray(o, o + 4) }); o += 4;
    } else if (wire === 1) {
      items.push({ field, wire, val: b.subarray(o, o + 8) }); o += 8;
    } else {
      fail(`Unsupported wire type ${wire}`, 'err.corrupt');
    }
  }
  return items;
}

function encodeMsg(items) {
  const parts = [];
  let len = 0;
  const push = (a) => { parts.push(a); len += a.length; };
  for (const it of items) {
    push(Uint8Array.from(encVarint(BigInt(it.field) << 3n | BigInt(it.wire))));
    if (it.wire === 0) push(Uint8Array.from(encVarint(it.val)));
    else if (it.wire === 2) { push(Uint8Array.from(encVarint(it.val.length))); push(it.val); }
    else push(it.val);
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const readPacked = (b) => {
  const out = [];
  let o = 0;
  while (o < b.length) { let v; [v, o] = readVarint(b, o); out.push(Number(v)); }
  return out;
};

const encPacked = (nums) => {
  const bytes = [];
  for (const n of nums) bytes.push(...encVarint(n));
  return Uint8Array.from(bytes);
};

// identity message {2: classDomain, 4: guid}
function parseIdentity(b) {
  const id = { classDomain: null, guid: null };
  for (const it of parseMsg(b)) {
    if (it.wire !== 0) continue;
    if (it.field === 2) id.classDomain = Number(it.val);
    else if (it.field === 4) id.guid = Number(it.val);
  }
  return id;
}

function rewriteIdentityGuid(b, guid) {
  return encodeMsg(parseMsg(b).map((it) =>
    it.field === 4 && it.wire === 0 ? { field: 4, wire: 0, val: BigInt(guid) } : it));
}

// ---------- entry scanning ----------

// model (object) entry: guid, name, canonical decoration list, other refs
function summarizeModel(entryBody) {
  const s = { guid: null, name: '', packed: null, refDecGuids: [], otherRefGuids: [] };
  for (const it of parseMsg(entryBody)) {
    if (it.wire !== 2) continue;
    if (it.field === 1) s.guid = parseIdentity(it.val).guid;
    else if (it.field === 2) {
      const id = parseIdentity(it.val);
      if (id.classDomain === 1 && id.guid != null) s.refDecGuids.push(id.guid);
      else if (id.guid != null) s.otherRefGuids.push(id.guid); // e.g. node graphs
    } else if (it.field === 3) s.name = utf8.decode(it.val);
    else if (it.field === 11) {
      for (const p of parseMsg(it.val)) {
        if (p.field !== 1 || p.wire !== 2) continue;
        for (const c of parseMsg(p.val)) {
          if (c.field !== 6 || c.wire !== 2) continue;
          const comp = parseMsg(c.val);
          if (!comp.some((x) => x.field === 1 && x.wire === 0 && Number(x.val) === 40)) continue;
          for (const body of comp) {
            if (body.wire !== 2) continue;
            for (const f of parseMsg(body.val)) {
              if (f.field === 501 && f.wire === 2) s.packed = readPacked(f.val);
            }
          }
        }
      }
    }
  }
  // component 6/40's packed list is the canonical ordering; fall back to the
  // entry's own decoration references if it is absent
  s.decGuids = s.packed ?? s.refDecGuids;
  return s;
}

// non-model entry: class number + guid + name
function summarizeEntry(entryBody) {
  const e = { cls: null, guid: null, name: null };
  for (const it of parseMsg(entryBody)) {
    if (it.field === 5 && it.wire === 0) e.cls = Number(it.val);
    else if (it.field === 1 && it.wire === 2) e.guid = parseIdentity(it.val).guid;
    else if (it.field === 3 && it.wire === 2) e.name = utf8.decode(it.val);
  }
  return e;
}

// ---------- entry rebuilding ----------

// Rebuild a model entry around a new decoration list. Everything not listed
// here is emitted verbatim:
//   - identity guid + prefab-body guid   → replaced on new models
//   - entry name + component 6/1 name    → replaced on new models
//   - decoration references (field 2)    → the list's refs, in list order
//   - component 6/40 field 501           → the list's guids
//   - non-decoration references + component 7/3 graph binding → removed
//     from new models (a node graph can belong to one model only)
function rebuildModelEntry(entryBody, { chunk, allDecSet, isClone, guid, name }) {
  const items = parseMsg(entryBody);

  const refByGuid = new Map();
  for (const it of items) {
    if (it.field !== 2 || it.wire !== 2) continue;
    const id = parseIdentity(it.val);
    if (id.classDomain === 1 && id.guid != null) refByGuid.set(id.guid, it);
  }

  const out = [];
  let refsEmitted = false;
  for (const it of items) {
    if (it.field === 1 && it.wire === 2) {
      out.push(isClone ? { field: 1, wire: 2, val: rewriteIdentityGuid(it.val, guid) } : it);
    } else if (it.field === 2 && it.wire === 2) {
      const id = parseIdentity(it.val);
      if (id.classDomain === 1 && allDecSet.has(id.guid)) {
        if (!refsEmitted) {
          refsEmitted = true;
          for (const g of chunk) {
            const ref = refByGuid.get(g);
            if (ref) out.push(ref);
          }
        }
        // original ref replaced by the list block above
      } else if (!isClone) {
        out.push(it); // graph/unknown references stay with the source model
      }
    } else if (it.field === 3 && it.wire === 2 && isClone) {
      out.push({ field: 3, wire: 2, val: utf8enc.encode(name) });
    } else if (it.field === 11 && it.wire === 2) {
      out.push({ field: 11, wire: 2, val: rebuildPrefabWrap(it.val, { chunk, isClone, guid, name }) });
    } else {
      out.push(it);
    }
  }
  return encodeMsg(out);
}

function rebuildPrefabWrap(wrapBody, ctx) {
  return encodeMsg(parseMsg(wrapBody).map((it) =>
    it.field === 1 && it.wire === 2
      ? { field: 1, wire: 2, val: rebuildPrefabBody(it.val, ctx) }
      : it));
}

function rebuildPrefabBody(prefabBody, { chunk, isClone, guid, name }) {
  const out = [];
  for (const it of parseMsg(prefabBody)) {
    if (it.field === 1 && it.wire === 0 && isClone) {
      out.push({ field: 1, wire: 0, val: BigInt(guid) });
    } else if (it.field === 6 && it.wire === 2) {
      const comp = parseMsg(it.val);
      const type = comp.find((x) => x.field === 1 && x.wire === 0);
      const t = type ? Number(type.val) : null;
      if (t === 40) {
        // decoration guid list → this model's list
        const rebuilt = comp.map((x) => x.wire === 2
          ? { ...x, val: encodeMsg(parseMsg(x.val).map((f) =>
              f.field === 501 && f.wire === 2 ? { field: 501, wire: 2, val: encPacked(chunk) } : f)) }
          : x);
        out.push({ field: 6, wire: 2, val: encodeMsg(rebuilt) });
      } else if (t === 1 && isClone) {
        // prefab name component → new model's name (other subfields kept)
        const rebuilt = comp.map((x) => x.wire === 2
          ? { ...x, val: encodeMsg(parseMsg(x.val).map((f) =>
              f.field === 1 && f.wire === 2 ? { field: 1, wire: 2, val: utf8enc.encode(name) } : f)) }
          : x);
        out.push({ field: 6, wire: 2, val: encodeMsg(rebuilt) });
      } else {
        out.push(it);
      }
    } else if (it.field === 7 && it.wire === 2 && isClone) {
      const comp = parseMsg(it.val);
      const type = comp.find((x) => x.field === 1 && x.wire === 0);
      if (type && Number(type.val) === 3) {
        // node-graph binding: new models must not re-attach the source's graph
        out.push({ field: 7, wire: 2, val: encodeMsg(comp.map((x) => x.wire === 2 ? { ...x, val: new Uint8Array(0) } : x)) });
      } else {
        out.push(it);
      }
    } else {
      out.push(it);
    }
  }
  return encodeMsg(out);
}

// Rewrite a Decoration entry's parent-model reference (component 4/40 field
// 502). Every other byte of the entry is preserved.
function rebuildDecorationParent(entryBody, newParent) {
  const mapComponent4 = (compBytes) => {
    const comp = parseMsg(compBytes);
    if (!comp.some((x) => x.field === 1 && x.wire === 0 && Number(x.val) === 40)) return compBytes;
    return encodeMsg(comp.map((x) => x.wire === 2
      ? { ...x, val: encodeMsg(parseMsg(x.val).map((f) =>
          f.field === 502 && f.wire === 0 ? { field: 502, wire: 0, val: BigInt(newParent) } : f)) }
      : x));
  };
  return encodeMsg(parseMsg(entryBody).map((it) => {
    if (it.field !== 21 || it.wire !== 2) return it;
    return { field: 21, wire: 2, val: encodeMsg(parseMsg(it.val).map((p) => {
      if (p.field !== 1 || p.wire !== 2) return p;
      return { field: 1, wire: 2, val: encodeMsg(parseMsg(p.val).map((b) => {
        if (b.field !== 4 || b.wire !== 2) return b;
        return { field: 4, wire: 2, val: mapComponent4(b.val) };
      })) };
    })) };
  }));
}

// ---------- session ----------

export class GiaSession {
  constructor(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 24) fail('File is too small to be a .gia.', 'err.tooSmall');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this._magic = [dv.getUint32(4, false), dv.getUint32(8, false), dv.getUint32(12, false)];
    if (this._magic[0] !== 1 || this._magic[1] !== 806 || this._magic[2] !== 3) {
      fail(`Not a .gia file (header ${this._magic.join('/')}, expected 1/806/3).`, 'err.notGia', { header: this._magic.join('/') });
    }
    const payloadLen = dv.getUint32(16, false);
    if (20 + payloadLen > bytes.length) fail('Corrupt .gia: payload length exceeds file size.', 'err.corrupt');

    this._bytes = bytes;
    this._tail = bytes.subarray(20 + payloadLen);
    this._top = parseMsg(bytes.subarray(20, 20 + payloadLen));

    this._decNames = new Map(); // decoration guid -> entry name
    this._models = [];
    let exportTag = '', engineVersion = '';
    let decorationEntries = 0, otherEntries = 0;
    let maxGuid = 0;
    const bump = (g) => { if (g != null && g > maxGuid) maxGuid = g; };

    this._top.forEach((it, idx) => {
      if (it.wire !== 2) return;
      if (it.field === 1) {
        const s = summarizeModel(it.val);
        bump(s.guid);
        for (const g of s.decGuids) bump(g);
        this._models.push({
          uid: this._models.length,
          srcTopIndex: idx,
          srcBody: it.val,
          srcAllDecSet: new Set(s.decGuids),
          srcDecGuids: s.decGuids.slice(),
          otherRefGuids: s.otherRefGuids,
          guid: s.guid,
          name: s.name,
          decGuids: s.decGuids.slice(),
          isNew: false,
        });
      } else if (it.field === 2) {
        const e = summarizeEntry(it.val);
        bump(e.guid);
        if (e.cls === 28) {
          decorationEntries++;
          if (e.guid != null) this._decNames.set(e.guid, e.name);
        } else {
          otherEntries++;
        }
      } else if (it.field === 3) exportTag = utf8.decode(it.val);
      else if (it.field === 5) engineVersion = utf8.decode(it.val);
    });

    this._nextGuid = maxGuid + 1;
    this._nextUid = this._models.length;
    this.splitCount = 0;
    this.meta = {
      exportName: (exportTag.match(/\\(.+)\.gia$/) || [])[1] ?? '',
      engineVersion,
      decorationEntries,
      otherEntries,
      modelsBefore: this._models.length,
    };
  }

  // Display view of every model, in file order (new models follow their
  // source). `id` is the current position; `uid` is stable across splits.
  get models() {
    return this._models.map((m, id) => ({
      id,
      uid: m.uid,
      name: m.name,
      guid: m.guid,
      count: m.decGuids.length,
      isNew: m.isNew,
      hasGraph: !m.isNew && m.otherRefGuids.length > 0,
    }));
  }

  // Display view of one model's Decoration list, in model order.
  decorations(modelId) {
    const m = this._models[modelId];
    return m.decGuids.map((guid, index) => ({
      index,
      guid,
      name: this._decNames.get(guid) ?? null,
    }));
  }

  get changed() { return this.splitCount > 0; }

  // Name the next split of this model would produce.
  previewSplitName(modelId) {
    const base = this._models[modelId].name;
    const names = new Set(this._models.map((m) => m.name));
    let k = 2;
    while (names.has(`${base}_${k}`)) k++;
    return `${base}_${k}`;
  }

  // Move the decorations at `indices` (positions within the model's current
  // list) into a newly created model placed right after it. Order is
  // preserved on both sides. Returns the new model's id.
  splitModel(modelId, indices) {
    const m = this._models[modelId];
    if (!m) fail('Unknown model.', 'err.unknownModel');
    const uniq = [...new Set(indices)].sort((a, b) => a - b);
    if (uniq.length === 0) fail('Select at least one Decoration entry to split.', 'err.selectDec');
    if (uniq[0] < 0 || uniq[uniq.length - 1] >= m.decGuids.length) fail('Selection is out of range.', 'err.range');

    const picked = new Set(uniq);
    const moved = [], remaining = [];
    m.decGuids.forEach((g, i) => (picked.has(i) ? moved : remaining).push(g));

    const clone = {
      uid: this._nextUid++,
      srcTopIndex: m.srcTopIndex,
      srcBody: m.srcBody,
      srcAllDecSet: m.srcAllDecSet,
      srcDecGuids: null,
      otherRefGuids: [],
      guid: this._nextGuid++,
      name: this.previewSplitName(modelId),
      decGuids: moved,
      isNew: true,
    };
    m.decGuids = remaining;
    this._models.splice(modelId + 1, 0, clone);
    this.splitCount++;
    return modelId + 1;
  }

  // Serialize the project. `selectedUids` (array/Set of model uids) limits
  // the export to those models: unselected models are omitted along with
  // their Decoration entries and any entries (e.g. node graphs) referenced
  // only by omitted models. Everything kept is preserved exactly as the
  // full export would emit it. Omit the argument to export every model.
  serialize(selectedUids = null) {
    const sel = selectedUids == null ? null : new Set(selectedUids);
    const included = (m) => sel === null || sel.has(m.uid);
    const models = this._models.filter(included);
    if (models.length === 0) fail('Select at least one model to export.', 'err.selectModel');
    const excludesAny = models.length !== this._models.length;

    if (!this.changed && !excludesAny) return this._bytes; // untouched input, byte for byte

    // group live models by their source entry, preserving display order
    const groups = new Map();
    for (const m of this._models) {
      if (!groups.has(m.srcTopIndex)) groups.set(m.srcTopIndex, []);
      groups.get(m.srcTopIndex).push(m);
    }

    // decorations owned by a new model get their parent reference rewritten;
    // decorations owned by an excluded model are dropped from the export
    const reparent = new Map();
    const dropDec = new Set();
    for (const m of this._models) {
      if (!included(m)) {
        for (const g of m.decGuids) dropDec.add(g);
      } else if (m.isNew) {
        for (const g of m.decGuids) reparent.set(g, m.guid);
      }
    }

    // non-decoration entries (e.g. node graphs) are dropped only when every
    // model referencing them is excluded; unreferenced entries always stay
    const otherRefOwners = new Map(); // entry guid -> [model, ...]
    for (const m of this._models) {
      for (const g of m.otherRefGuids) {
        if (!otherRefOwners.has(g)) otherRefOwners.set(g, []);
        otherRefOwners.get(g).push(m);
      }
    }
    const keepOther = (guid) => {
      const owners = otherRefOwners.get(guid);
      return !owners || owners.some(included);
    };

    const out = [];
    this._top.forEach((it, idx) => {
      if (it.field === 1 && it.wire === 2 && groups.has(idx)) {
        for (const m of groups.get(idx)) {
          if (!included(m)) continue;
          if (!m.isNew && m.srcDecGuids && m.decGuids.length === m.srcDecGuids.length
              && m.decGuids.every((g, i) => g === m.srcDecGuids[i])) {
            out.push(it); // never touched → verbatim
          } else {
            out.push({ field: 1, wire: 2, val: rebuildModelEntry(m.srcBody, {
              chunk: m.decGuids,
              allDecSet: m.srcAllDecSet,
              isClone: m.isNew,
              guid: m.guid,
              name: m.name,
            }) });
          }
        }
      } else if (it.field === 2 && it.wire === 2) {
        const e = summarizeEntry(it.val);
        if (e.cls === 28) {
          if (dropDec.has(e.guid)) return;
          if (reparent.has(e.guid)) {
            out.push({ field: 2, wire: 2, val: rebuildDecorationParent(it.val, reparent.get(e.guid)) });
          } else {
            out.push(it);
          }
        } else if (keepOther(e.guid)) {
          out.push(it);
        }
      } else {
        out.push(it);
      }
    });

    const payload = encodeMsg(out);
    const total = 20 + payload.length + this._tail.length;
    const file = new Uint8Array(total);
    const fdv = new DataView(file.buffer);
    fdv.setUint32(0, total - 4, false);
    fdv.setUint32(4, this._magic[0], false);
    fdv.setUint32(8, this._magic[1], false);
    fdv.setUint32(12, this._magic[2], false);
    fdv.setUint32(16, payload.length, false);
    file.set(payload, 20);
    file.set(this._tail, 20 + payload.length);
    return file;
  }
}

// used by tests: parseMsg → encodeMsg must be lossless
export const _internal = { parseMsg, encodeMsg };
export default { GiaSession };
