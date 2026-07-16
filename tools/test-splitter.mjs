// Verification suite for js/gia-splitter.js — run with: node tools/test-splitter.mjs
// Uses the sample fixtures in reference/reference-samples/ and the legacy
// geometry-aware parser (tools/gia-parser.js) as an independent cross-check.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GiaSession, _internal } from '../js/gia-splitter.js';
import { parseGia } from './gia-parser.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(root, 'reference', 'reference-samples');
const load = (f) => new Uint8Array(readFileSync(join(SAMPLES, f)));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const files = [
  'White Square.gia',
  'White Square No Collision.gia',
  '2 White Triangles.gia',
  'Asset Pack With Three Triangles.gia',
  'Autumn Sword Auto Assemble.gia',
];

// helpers to inspect raw entries of a file
const rawView = (b) => {
  const payloadLen = new DataView(b.buffer, b.byteOffset).getUint32(16, false);
  const payload = b.subarray(20, 20 + payloadLen);
  const graphs = [], strings = [], decs = new Map();
  for (const it of _internal.parseMsg(payload)) {
    if (it.field === 2 && it.wire === 2) {
      let cls = 0, guid = 0;
      for (const e of _internal.parseMsg(it.val)) {
        if (e.field === 5 && e.wire === 0) cls = Number(e.val);
        if (e.field === 1 && e.wire === 2) {
          for (const f of _internal.parseMsg(e.val)) if (f.field === 4 && f.wire === 0) guid = Number(f.val);
        }
      }
      if (cls === 28) decs.set(guid, it.val);
      else if (cls === 9) graphs.push(it.val);
    } else if ((it.field === 3 || it.field === 5) && it.wire === 2) strings.push(it.val);
  }
  return { graphs, strings, decs };
};

// 1) protobuf re-encode must be lossless on every sample payload
for (const f of files) {
  const bytes = load(f);
  const payloadLen = new DataView(bytes.buffer).getUint32(16, false);
  const payload = bytes.subarray(20, 20 + payloadLen);
  const re = _internal.encodeMsg(_internal.parseMsg(payload));
  check(`re-encode lossless: ${f}`, eq(re, payload), `${payload.length} bytes`);
}

// 2) session with no splits serializes byte-identically
for (const f of files) {
  const bytes = load(f);
  const s = new GiaSession(bytes);
  check(`no-op serialize is byte-identical: ${f}`, eq(s.serialize(), bytes) && !s.changed);
}

// 3) session views: models + decoration identifiers
{
  const s = new GiaSession(load('Asset Pack With Three Triangles.gia'));
  check('asset pack: 3 models listed', s.models.length === 3,
    s.models.map((m) => `${m.name}:${m.count}`).join(', '));
  const decs = s.decorations(0);
  check('asset pack: decoration rows have index + id + name',
    decs.length === 1 && decs[0].index === 0 && decs[0].guid != null && decs[0].name === 'Decoration_1',
    JSON.stringify(decs[0]));
}

// 4) interactive split on the sword: scattered selection from model 0
{
  const bytes = load('Autumn Sword Auto Assemble.gia');
  const src = parseGia(bytes);
  const s = new GiaSession(bytes);

  const model0Before = s.decorations(0).map((d) => d.guid);
  const pick = [0, 5, 6, 7, 500, 998]; // scattered, includes first and last
  const newId = s.splitModel(0, [...pick].reverse()); // order of input must not matter

  check('sword: new model created after source', newId === 1 && s.models.length === 4
    && s.models[1].isNew && s.models[1].count === pick.length,
    s.models.map((m) => `${m.name}:${m.count}${m.isNew ? '*' : ''}`).join(', '));
  check('sword: new model named with suffix', s.models[1].name === 'autumn_sword_3_2');
  check('sword: source model count reduced', s.models[0].count === 999 - pick.length);

  // ordering preserved on both sides
  const movedExpect = pick.map((i) => model0Before[i]);
  const remainExpect = model0Before.filter((_, i) => !pick.includes(i));
  check('sword: moved entries keep source order', eq(s.decorations(1).map((d) => d.guid), movedExpect));
  check('sword: remaining entries keep source order', eq(s.decorations(0).map((d) => d.guid), remainExpect));

  // serialize and cross-check with the independent parser
  const out = s.serialize();
  const dst = parseGia(out);
  check('sword: output has 4 objects', dst.objects.length === 4);
  check('sword: output decoration entry count preserved', dst.decorations.length === src.decorations.length);

  const outM0 = dst.objects.find((o) => o.name === 'autumn_sword_3');
  const outNew = dst.objects.find((o) => o.name === 'autumn_sword_3_2');
  check('sword: reparsed lists match session lists',
    eq(outM0.decorationGuids, remainExpect) && eq(outNew.decorationGuids, movedExpect));
  check('sword: new model guid unique',
    new Set(dst.objects.map((o) => o.guid)).size === dst.objects.length);

  let parentOk = true;
  for (const o of dst.objects) {
    for (const g of o.decorationGuids) {
      const d = dst.decorations.find((d) => d.guid === g);
      if (!d || d.parentGuid !== o.guid) parentOk = false;
    }
  }
  check('sword: parent references match owning model', parentOk);

  // non-Decoration data outside the models preserved byte-exactly
  const a = rawView(bytes), b = rawView(out);
  check('sword: node-graph entries byte-identical',
    a.graphs.length === b.graphs.length && a.graphs.every((g, i) => eq(g, b.graphs[i])));
  check('sword: export tag + engine version byte-identical',
    a.strings.length === b.strings.length && a.strings.every((x, i) => eq(x, b.strings[i])));

  let untouchedOk = true, movedDiffer = 0;
  const movedSet = new Set(movedExpect);
  for (const [g, raw] of a.decs) {
    const outRaw = b.decs.get(g);
    if (!outRaw) { untouchedOk = false; continue; }
    if (movedSet.has(g)) { if (!eq(raw, outRaw)) movedDiffer++; }
    else if (!eq(raw, outRaw)) untouchedOk = false;
  }
  check('sword: unmoved decoration entries byte-identical', untouchedOk);
  check('sword: moved decoration entries differ only where expected',
    movedDiffer === movedSet.size, `${movedDiffer}/${movedSet.size} rewritten`);

  // untouched models emitted verbatim: their names + counts survive
  check('sword: untouched models unchanged',
    dst.objects.some((o) => o.name === 'autumn_sword_2' && o.decorationGuids.length === 543)
    && dst.objects.some((o) => o.name === 'autumn_sword_1' && o.decorationGuids.length === 999));
}

// 5) multiple splits, including splitting a newly created model
{
  const s = new GiaSession(load('Autumn Sword Auto Assemble.gia'));
  const first = s.decorations(0).map((d) => d.guid);

  s.splitModel(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);   // model 1: 10 entries
  const secondNew = s.splitModel(1, [0, 2, 4]);      // split the new model again
  s.splitModel(4, [10, 11]);                          // split autumn_sword_2 (now id 4? check below)

  const names = s.models.map((m) => `${m.name}:${m.count}${m.isNew ? '*' : ''}`);
  check('multi: three splits produce six models', s.models.length === 6 && s.splitCount === 3, names.join(', '));
  check('multi: split of a new model is named from it', s.models[secondNew].name === 'autumn_sword_3_2_2',
    s.models[secondNew].name);

  const out = s.serialize();
  const dst = parseGia(out);
  check('multi: reparsed output has 6 objects and all entries', dst.objects.length === 6
    && dst.decorations.length === 2541);

  // full-coverage ordering check: every model's reparsed list matches the session
  let allMatch = true;
  for (const m of s.models) {
    const o = dst.objects.find((o) => o.name === m.name);
    if (!o || !eq(o.decorationGuids, s.decorations(m.id).map((d) => d.guid))) allMatch = false;
  }
  check('multi: every reparsed model list matches session state', allMatch);

  // global conservation: all original guids still present exactly once
  const all = dst.objects.flatMap((o) => o.decorationGuids).sort((x, y) => x - y);
  check('multi: no entries lost or duplicated', eq(all, [...first,
    ...parseGia(load('Autumn Sword Auto Assemble.gia')).objects
      .filter((o) => o.name !== 'autumn_sword_3').flatMap((o) => o.decorationGuids),
  ].sort((x, y) => x - y)));

  // idempotence: reload output, no changes → byte-identical
  const s2 = new GiaSession(out);
  check('multi: reloaded output round-trips byte-identically', eq(s2.serialize(), out));
}

// 6) edge cases
{
  const s = new GiaSession(load('2 White Triangles.gia'));
  let threw = false;
  try { s.splitModel(0, []); } catch { threw = true; }
  check('edge: empty selection rejected', threw && !s.changed);

  s.splitModel(0, [0, 1]); // move ALL entries
  check('edge: moving all entries leaves empty source model',
    s.models[0].count === 0 && s.models[1].count === 2);
  const dst = parseGia(s.serialize());
  check('edge: output parses with empty + full model', dst.objects.length === 2
    && dst.decorations.length === 2);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
