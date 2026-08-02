# GIA / GIL Splitter

An interactive, static splitting utility for **both** Miliastra Wonderland asset
formats — one unified editor that adapts to the loaded file type:

- **`.gia` asset packs**: inspect each model's Decoration list, select any
  entries, and move them into a newly created model — as many times as you
  like — then download the updated file. Decoration entries keep their original
  order on both sides of every split.
- **`.gil` levels**: check parent objects, select any of their attached
  decorations, and extract them into standalone world objects at the exact
  same world position, rotation, scale, and collision state.

In both modes, **all data you don't touch is preserved byte-for-byte**,
including fields and entry types the tool doesn't recognize.

Everything runs client-side in the browser — no server, nothing is uploaded.
Files load via the picker, drag-and-drop anywhere on the page, or clipboard
paste (Ctrl+V of a file copied from the OS).

The interface is fully localized into 15 languages — the 14 officially supported
by Genshin Impact plus Italian: English, 简体中文, 繁體中文, 日本語, 한국어,
Français, Deutsch, Español, Português, Русский, ไทย, Tiếng Việt,
Bahasa Indonesia, Türkçe, Italiano — with a runtime language selector in the
top bar (no reload needed). The choice syncs across all Miliastra Toolkit
sites via the shared `miliastra-lang` key.

## Usage — .gia

1. Open the site and drop a `.gia` file anywhere on the page (or click *Choose a .gia / .gil file*).
2. Pick a model in the left-hand list (each shows its Decoration entry count).
   Every model also has an **export checkbox** right in the sidebar — checked models
   are included in the download; unchecked ones are dimmed. This is independent of
   which model is open for viewing.
3. Select entries in the Decoration table — a click **toggles** a row without
   resetting the rest of the selection, and **Shift+click** inverts the whole
   range from the last-clicked row (so toggling a row on and shift-clicking
   selects the range; toggling one off and shift-clicking deselects it), or
   use the checkboxes / *Select all*. The bar above the table shows exactly
   how many entries will move and the name of the model they'll move into.
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
   **Rename** any model or decoration by double-clicking its name, or select
   multiple entries and use **Rename selected** to give them all the same name
   in one undoable operation (Ctrl+Z / Ctrl+Y).
5. Choose which models the download includes using the sidebar checkboxes, with
   **Select all / Deselect all** at the top of the Models panel. Badges mark newly
   created models and node-graph owners. The selection persists until you change
   it, load another file, or Reset; newly created models are included by default.
6. Download the resulting `.gia` (or *Reset* to discard all changes).

## Usage — .gil

1. Drop (or pick, or paste) a `.gil` level. The left panel lists every object
   that contains decorations, with search, sorting, and an optional *Show all
   objects* view of the whole level (virtualized for large files).
2. Click parent objects to check them (click selects one, Ctrl+click toggles,
   Shift+click selects a range; the checkboxes always toggle); the table shows
   the focused parent's decorations (name, ID, prefab, collision), sortable by
   any column — there a click **toggles** a row without resetting the rest,
   and Shift+click inverts the whole range from the last click. Decoration selections
   **persist across parent objects** — switching or unchecking parents never
   discards them; a dot marks sidebar rows holding selected decorations, and
   the Extraction bar summarizes the global state ("12 decorations selected
   across 3 parent objects"). *Separate Selected Decorations* extracts every
   selected decoration wherever it lives; in `.gia` mode, each model likewise
   remembers its selection so switching models never discards it.
   You can also **reorder** a parent's decorations by dragging rows (dragging
   a selected row moves the focused parent's whole selected block) — only the
   parent's decoration-id list is rewritten, every other byte survives, and
   the move lands on the same undo/redo stack as extractions. Handles appear
   only in file-order view; sort the table and dragging pauses until you
   return to file order (third click on a column header).
   **Rename** a decoration by double-clicking its name, or select several and
   use **Rename selected** to give them all the same name in one undoable
   operation — only the name field inside each decoration's name component is
   rewritten, and extracted objects carry their renamed names.
3. Use the **Extraction** bar:
   - **Separate Selected Decorations** — extracts exactly the decorations
     selected in the table. Unselected decorations stay attached; the parent's
     decoration list is rewritten, not cleared.
   - **Separate All Decorations from Selected Parents** — extracts every
     decoration of the checked parents.
   Two persisted options sit below the buttons: *Enable Collision for
   Extracted Objects* (default on) and *Remove Parent Object After Extraction*
   (default off — a parent is deleted only if it ends up empty **and** a
   level-wide reference scan proves nothing else references it).
4. Before anything is modified, a review dialog lists warnings — most notably
   the game's **zoom limit**: extracted objects whose estimated world scale
   exceeds 50 on any axis are listed with their parent and the offending
   axes. Continue or cancel; cancel changes nothing.
5. **Undo/redo** (buttons or Ctrl+Z / Ctrl+Y) restores exact byte-level state
   through unlimited operations. Long operations show a progress bar and keep
   the page responsive (an 11 MB level with ~8,000 decorations splits in
   about a second).
6. Download the modified `.gil` — a file downloaded without edits is
   byte-identical to the input.

In both modes the **3D viewer** on the right shows the open model's / focused
parent's decorations as points at their world positions: left-drag box-selects
(Ctrl adds, Alt subtracts, Shift toggles), right-drag orbits, middle-drag pans,
and the selection stays in sync with the table both ways. The toolbar offers
search-with-highlight, frame selected/all, grid/axis toggles, labels, point
size/colors, hide/isolate controls, selection stats with a coordinate readout,
and quick-view buttons with an orientation gizmo.

## How .gia splitting works

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
- The 3D viewer only READS decoration positions for display — nothing it does
  feeds back into serialization, so the byte-preservation guarantees are
  unaffected.

## How .gil extraction works

The `.gil` engine (`js/gil/`, verified byte-for-byte against game-produced
reference files) mutates only three top-level containers — world objects,
registry, and decorations — and preserves everything else, including unknown
fields, exactly:

- **Transforms** are composed as `worldPos = parentPos + parentRot × (parentScale
  ⊙ localPos)`, `worldRot = parentRot ∘ localRot` (Euler Z-X-Y degrees),
  `worldScale = parentScale ⊙ localScale` — bit-exact in float32 against
  game-authored reference output.
- **New object ids** follow the game's allocation (highest existing id in the
  `0x4040xxxx` space + 1); the new objects are registered in the level's
  world-object registry group.
- A parent loses exactly one thing: the extracted ids from its decoration-id
  list. Parent removal is gated by a **single-pass** level-wide reference scan.
- **Undo/redo snapshots** are zero-copy references to the three containers'
  raw bytes; restoring a pre-edit snapshot reproduces the original file
  byte-identically.

## Localization

- `js/i18n.js` — tiny dependency-free system: `t(key, params)`, plural-aware
  `tn(key, n)` (via `Intl.PluralRules`), locale number formatting `num()`
  (via `Intl.NumberFormat`), `data-i18n` / `data-i18n-title` /
  `data-i18n-placeholder` bindings for static DOM, and an `onLangChange`
  hook that re-renders dynamic UI. Switching languages never reloads the page.
  Mode-dependent labels use `data-i18n-gil` overrides on the same elements.
- English ships in the bundle and is the **fallback for every key**, so missing
  translations degrade to English — never to raw keys or blanks.
- Other locales load on demand from `js/locales/<code>.js`. **Adding a language
  = adding one file + one row in `LANGS`** — no application code changes.
- The saved choice persists in localStorage (shared `miliastra-lang` key,
  synced live across toolkit sites and tabs); first visit auto-detects from the
  browser language (including zh-Hans/zh-Hant disambiguation).
- Engine errors carry i18n codes (`err.i18n`) so validation messages localize
  while logs and tests keep English text; `.gil` warning/error codes map to
  `gil.w.*` / `gil.e.*` keys.
- Font stacks cover Latin, Cyrillic, Vietnamese, CJK, and Thai on all major
  OSes, with per-language `:lang()` preferences and extra Thai line-height;
  layouts wrap gracefully for long German/Russian strings.

## Project layout

| Path | Role |
|---|---|
| `index.html`, `css/style.css` | UI shell (master-detail: object/model list + decoration table), mode-adaptive via `body.mode-gia` / `body.mode-gil` |
| `js/app.js` | app logic for both modes (import → select → split/extract → download) |
| `js/gia-splitter.js` | `GiaSession` — the byte-preserving .gia split engine (self-contained, no dependencies) |
| `js/gil-splitter.js` | `GilSession` — .gil session wrapper (views, operations, zero-copy undo/redo) |
| `js/gil/` | the verified .gil engine: wire format (`gil.js`), level model (`model.js`), extraction (`split.js`) — do not modify |
| `js/viewer3d.js` | 3D decoration viewer (three.js points, box selection, camera tooling), shared by both modes |
| `js/i18n.js`, `js/locales/*.js` | localization system + the 15 language dictionaries |
| `tools/test-splitter.mjs` | .gia verification suite (`node tools/test-splitter.mjs`) |
| `tools/test-gil.mjs` | .gil engine verification suite (`node tools/test-gil.mjs`) |
| `tools/gia-parser.js` | legacy geometry-aware parser, used only as an independent cross-check in tests |
| `reference/` | format handoff docs and sample .gia/.gil fixtures |

Format details are documented in
[reference/docs/HANDOFF-gia-splitter.md](reference/docs/HANDOFF-gia-splitter.md)
(.gia) and the source `SplitGilDecorations` project's `GIL-FORMAT.md` (.gil).

## Run locally

Any static file server works (ES modules don't load from `file://`):

```sh
npx http-server -p 8123 .
# then open http://localhost:8123
```

No build step; the only dependency is three.js, loaded from the jsDelivr CDN via an import map (used solely by the 3D viewer).

## Tests

```sh
node tools/test-splitter.mjs
node tools/test-gil.mjs
```

`test-splitter.mjs` verifies, against the sample fixtures: lossless protobuf
re-encoding, byte-identical no-op serialization, order preservation for
scattered selections, parent-reference correctness, byte-identity of node
graphs and unmoved Decoration entries, repeated splits, selective export,
reordering, class-3 game-object files, rename and cross-model moves, and edge
cases such as moving every entry out of a model.

`test-gil.mjs` verifies, against the sample `.gil` fixtures: byte-for-byte
round-trips, split correctness against game-authored standalone counterparts
(bit-exact world transforms), minimal parent mutation, registry updates, id
allocation, collision encoding, parent-removal reference safety, and the
zoom-limit warning. Pass a directory argument to use different reference files;
the 11 MB performance section runs only when `Cozy Disc Golf.gil` is present.

## Deploy to GitHub Pages

```sh
git init
git add .
git commit -m "GIA / GIL Splitter"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root**.
The site will be live at `https://<you>.github.io/<repo>/` a minute later.
