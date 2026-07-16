# GIA Splitter

An interactive, static **.gia splitting utility**. Load a `.gia` file, inspect each
model's Decoration list, select any entries, and move them into a newly created
model — as many times as you like — then download the updated file. Decoration
entries keep their original order on both sides of every split, and **all data you
don't touch is preserved byte-for-byte**, including fields and entry types the tool
doesn't recognize.

Everything runs client-side in the browser — no server, nothing is uploaded.

## Usage

1. Open the site and drop a `.gia` file anywhere on the page (or click *Choose a .gia file*).
2. Pick a model in the left-hand list (each shows its Decoration entry count).
3. Select entries in the Decoration table — click to select, **Ctrl+click** to toggle,
   **Shift+click** for ranges, or use the checkboxes / *Select all*. The bar above the
   table shows exactly how many entries will move and the name of the model they'll
   move into.
4. Hit **Split selected**. The new model appears in the list right after its source;
   you can keep splitting any model, including newly created ones.
5. Download the resulting `.gia` (or *Reset* to discard all splits).

## How splitting works

The splitter never decodes Decoration contents — it performs targeted protobuf
surgery on the container and copies everything else verbatim:

- **Decoration entries** pass through untouched regardless of type or contents; only
  the parent-model reference (component 4/40 field 502) is rewritten for entries that
  move to a new model. This keeps the tool forward-compatible with new decoration types.
- **New models** are byte-copies of their source model — all non-Decoration data is
  carried over — except fields that must remain unique: they receive a fresh guid and
  a `_2`/`_3`… name, plus only the moved decorations' references. A node-graph
  binding, which can belong to one model only, stays with the source model.
- **Ordering**: each model's Decoration list (component 6/40 field 501) keeps its
  entries in the original relative order after every split.
- Entries the tool doesn't understand (node graphs, unknown classes, unknown fields
  at any level) are emitted exactly as they appeared in the source. A file exported
  without any splits is byte-identical to the input.

## Project layout

| Path | Role |
|---|---|
| `index.html`, `css/style.css` | UI shell (master-detail: model list + Decoration table) |
| `js/app.js` | app logic (import → select → split → download) |
| `js/gia-splitter.js` | `GiaSession` — the byte-preserving split engine (self-contained, no dependencies) |
| `tools/test-splitter.mjs` | verification suite (`node tools/test-splitter.mjs`) |
| `tools/gia-parser.js` | legacy geometry-aware parser, used only as an independent cross-check in tests |
| `reference/` | format handoff docs and sample .gia fixtures |

Format details (header layout, entry structure, gotchas) are documented in
[reference/docs/HANDOFF-gia-splitter.md](reference/docs/HANDOFF-gia-splitter.md).

## Run locally

Any static file server works (ES modules don't load from `file://`):

```sh
npx http-server -p 8123 .
# then open http://localhost:8123
```

No build step, no dependencies.

## Tests

```sh
node tools/test-splitter.mjs
```

Verifies, against the sample fixtures: lossless protobuf re-encoding, byte-identical
no-op serialization, order preservation for scattered selections, parent-reference
correctness, byte-identity of node graphs and unmoved Decoration entries, repeated
splits (including splitting a newly created model), and edge cases such as moving
every entry out of a model.

## Deploy to GitHub Pages

```sh
git init
git add .
git commit -m "GIA Splitter"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root**.
The site will be live at `https://<you>.github.io/<repo>/` a minute later.
