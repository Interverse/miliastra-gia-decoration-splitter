# GIA Splitter

An interactive, static **.gia splitting utility**. Load a `.gia` file, inspect each
model's Decoration list, select any entries, and move them into a newly created
model — as many times as you like — then download the updated file. Decoration
entries keep their original order on both sides of every split, and **all data you
don't touch is preserved byte-for-byte**, including fields and entry types the tool
doesn't recognize.

Everything runs client-side in the browser — no server, nothing is uploaded.

The interface is fully localized into 15 languages — the 14 officially supported
by Genshin Impact plus Italian: English, 简体中文, 繁體中文, 日本語, 한국어,
Français, Deutsch, Español, Português, Русский, ไทย, Tiếng Việt,
Bahasa Indonesia, Türkçe, Italiano — with a runtime language selector in the
top bar (no reload needed).

## Usage

1. Open the site and drop a `.gia` file anywhere on the page (or click *Choose a .gia file*).
2. Pick a model in the left-hand list (each shows its Decoration entry count).
   Every model also has an **export checkbox** right in the sidebar — checked models
   are included in the download; unchecked ones are dimmed. This is independent of
   which model is open for viewing.
3. Select entries in the Decoration table — click to select, **Ctrl+click** to toggle,
   **Shift+click** for ranges, or use the checkboxes / *Select all*. The bar above the
   table shows exactly how many entries will move and the name of the model they'll
   move into.
4. Hit **Split selected**. The new model appears in the list right after its source;
   you can keep splitting any model, including newly created ones.
   You can also **reorder** a model's Decoration entries: drag rows (dragging a
   selected row moves the whole selection) or use the ▲/▼ buttons. The # column
   always shows the current order, and the exported .gia keeps exactly that order.
   Dragging rows onto another model in the sidebar **moves them into that model**
   (appended at the end, bytes preserved, only the parent reference rewritten);
   valid targets light up while you drag. Moves that would push the target past
   the game's **999-entries-per-model limit** are rejected: over-limit targets
   dim immediately when the drag starts, turn red on hover, and dropping shows
   a warning while leaving both models unchanged.
   **Rename** any model or decoration by double-clicking its name.
5. Choose which models the download includes using the sidebar checkboxes, with
   **Select all / Deselect all** at the top of the Models panel. Badges mark newly
   created models and node-graph owners. The selection persists until you change
   it, load another file, or Reset; newly created models are included by default.
6. Download the resulting `.gia` (or *Reset* to discard all changes).

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
  entries in the original relative order after every split. Manual reordering
  rewrites only that list — every Decoration entry keeps its bytes, so all
  metadata stays attached to the same decoration.
- Entries the tool doesn't understand (node graphs, unknown classes, unknown fields
  at any level) are emitted exactly as they appeared in the source. A file exported
  without any splits is byte-identical to the input.
- **Selective export**: deselected models are omitted together with their Decoration
  entries. Non-decoration entries (node graphs, unknown classes) are **always
  preserved** — even when every model referencing them is excluded — so nothing
  outside the Decoration lists is ever silently lost, and the tool stays
  forward-compatible with entry types it doesn't recognize. Every model and entry
  that stays in the export is emitted exactly as a full export would emit it.
- The engine handles both observed model-entry layouts (generated class-1 models
  and class-3 game objects such as Empty Models), so files containing either kind
  load and split correctly.

## Localization

- `js/i18n.js` — tiny dependency-free system: `t(key, params)`, plural-aware
  `tn(key, n)` (via `Intl.PluralRules`), locale number formatting `num()`
  (via `Intl.NumberFormat`), `data-i18n` / `data-i18n-title` /
  `data-i18n-placeholder` bindings for static DOM, and an `onLangChange`
  hook that re-renders dynamic UI. Switching languages never reloads the page.
- English ships in the bundle and is the **fallback for every key**, so missing
  translations degrade to English — never to raw keys or blanks.
- Other locales load on demand from `js/locales/<code>.js`. **Adding a language
  = adding one file + one row in `LANGS`** — no application code changes.
- The saved choice persists in localStorage; first visit auto-detects from the
  browser language (including zh-Hans/zh-Hant disambiguation).
- Engine errors carry i18n codes (`err.i18n`) so validation messages localize
  while logs and tests keep English text.
- Font stacks cover Latin, Cyrillic, Vietnamese, CJK, and Thai on all major
  OSes, with per-language `:lang()` preferences and extra Thai line-height;
  layouts wrap gracefully for long German/Russian strings.

## Project layout

| Path | Role |
|---|---|
| `index.html`, `css/style.css` | UI shell (master-detail: model list + Decoration table) |
| `js/app.js` | app logic (import → select → split → download) |
| `js/gia-splitter.js` | `GiaSession` — the byte-preserving split engine (self-contained, no dependencies) |
| `js/i18n.js`, `js/locales/*.js` | localization system + the 15 language dictionaries |
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
splits (including splitting a newly created model), selective export (omitted models
and their entries, unconditional preservation of non-decoration entries, exporting
only a new model), reordering (order preservation, no-op detection, byte-identity of
every decoration entry, reorder+split composition), loading and splitting class-3
game-object files, the rename and cross-model move actions, and edge cases such
as moving every entry out of a model.

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
