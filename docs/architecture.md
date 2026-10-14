# Architecture and format v1

## Boundaries and decisions

- `src/core.js`: UI-independent document constructors, typed graph connection rules, safe numeric expressions, geometry evaluation, JSON validation/serialization, SVG export and transactional undo. It uses Paper.js and the shared pure font/layout modules, and does not access browser or Windows APIs.
- `src/fonts.js`, `src/text-layout.js`: bounded local font assets and deterministic Japanese/Latin outline layout, shared by editor and CLI. See [typography](typography.md).
- `src/main.js`, `src/style.css`: browser editor. Canvas and graph mutate the same document. No second geometry source of truth exists.
- `src/svg-import.js`: strict browser/XML adapter for basic SVG shapes and compound path data. It rejects unsupported attributes/elements rather than silently changing rendering.
- `src/storage.js`: thin browser-download / Tauri-command adapter. Native destinations are selected by the user; the frontend does not receive a general filesystem API.
- `src-tauri/`: Tauri 2 host and Windows NSIS configuration. Chosen for small distribution and reusable existing browser UI. This is a scaffold pending compilation and Windows interaction verification.
- `cli/export.js`: Node headless adapter. It supplies fonts and calls the same core API. Future cloud rendering should wrap this adapter with request limits, timeouts and isolation; no endpoint exists yet.
- Future Nect adapter: exchange versioned documents and evaluated Path values across an explicit boundary. Do not couple the engine to Nect's renderer, UI store, authentication or Electron/Tauri bridge.

## Public API

`document()` creates a schemaVersion 1 project; `layer(name)`, `node(type)` and `point(x,y)` create stable UUID identities.

`connect(layer, sourceId, targetId, parameterKey)` validates type, edit lock and cycles, replaces an existing connection, and restores its previous edge on rejection. Connections cannot cross compositions. `disconnect(node, parameterKey)` drops only the edge, retaining direct value and expression.

`evaluate(layer, fonts)` returns `{ path, error, warnings, values, run }`. `run(nodeId)` evaluates another node in that composition; results are memoized within one evaluation. A per-composition weak cache records each node’s semantic inputs and upstream revision IDs. Only changed dependency chains recompute; moving a graph card does not invalidate geometry. Cached results are defensively copied. Evaluation depth is bounded to 256 nodes and expressions to 4096 characters.

`pathData(path)`, `pathArea(path)`, `exportSVG(document, fonts)` consume plain geometry. `exportSVG` refuses any erroneous visible composition, and emits nonzero-filled compound paths.

`serialize(document)` creates JSON. `deserialize(text)` parses and validates a candidate before editor replacement. `History.apply(fn)` snapshots before mutations, rolls back thrown mutations and clears redo only for actual changes. History is bounded to 100 changes and 96 MB of distinct font bytes; immutable font assets are shared across snapshots. Pointer gestures are one change each.

## Project schema

Root: `{schemaVersion:1, name, width, height, layers, fontAssets?}`. The artboard ratio is independent from the 16:9 workspace design.

Layer: `{id, name, visible, locked, fill, nodes, output}`. Layer order is paint order (last is front). One layer equals one composition. No implicit node sharing.

Node: `{id, type, name, position, params, points, operation, edits, text, font}`. `position` is graph UI position, not artwork position.

Optional `width` and `collapsed` fields hold node-card presentation state. `collapsed` must be Boolean when present and defaults to expanded for older files. Both are excluded from geometry cache signatures and survive JSON roundtrips.

Parameter: `{type, value, expression, locked, source?}`. Types: Scalar, Vector2, Boolean, Path. Resolution order is source connection, expression, direct fallback. Connected fields cannot directly edit fallback through the UI. Disconnection restores the previous expression/value. Vector expressions use `xExpression; yExpression`. Path fallback is null; paths must come from graph edges.

Point: `{id, position:Parameter, handleA:Parameter, handleB:Parameter, handleType}`. Handles are relative vectors. `corner`, `smooth`, `symmetric` affect interactive handle movement. Curve points are owned and edited by the Curve generator, without requiring Remap.

Evaluated Path: `{contours:[{id,closed,points:[{id,position,handleA,handleB}]}], unstable?, fingerprint?}`. No Paper.js objects escape the evaluator. Parsed font objects are caller-supplied dependencies in `fonts` and are not serialized; imported original bytes are embedded separately in `fontAssets`. `exportSVG` resolves them automatically.

## Geometry and correspondence

Paper.js 0.12.18 computes cubic Bézier Boolean union/subtract/intersection/exclusion; results remain normal Path values, so Boolean can feed another Boolean or Remap. Open contours are rejected for area Boolean operations rather than silently closed. Exact tangencies and extreme coordinate/precision conditions are not exhaustively verified.

Primitive/Curve vertex IDs are stable; Transform preserves their IDs because affine transforms do not alter topology. Boolean, Text and Imported Path contours are marked unstable. Their Remap edits store an exact source-geometry fingerprint and suspend with a warning whenever it changes. This conservative rule can suspend more edits than necessary, but never intentionally assigns an old edit to a different vertex. Suspended definitions remain in the saved file; the user can explicitly rebind a retained edit to the currently displayed point, or clear it. Rebind changes only the source fingerprint and is undoable; it does not automatically infer correspondence. Better provenance mapping is deferred.

Text uses OpenType.js with bundled DejaVu Sans or embedded local static TTF/OTF bytes. Multiple contours/counters, Japanese and mixed vertical writing are preserved; the detailed layout, fallback, format and licensing boundaries are in [typography](typography.md). Complex shaping, variable-font axes and automatic font fallback are not supported. Text is evaluated into outlines, with a pass-through Text to Path node retained as the explicit UI boundary.

## Trust and failures

JSON IDs use a conservative safe-character grammar. All graph UI positions, vectors, scalar values, locks, types, expected parameters, layer fills, operations and remap edits are validated; duplicate IDs and edit targets are rejected. Project size is limited to 50 MB UTF-8 before parsing; fonts have separate 20 MB/file and 32 MB/project limits. SVG import retains its 10 MB limit. Unknown versions are rejected. UI text is escaped. Expressions use a numeric parser, never `eval` or `Function`.

An evaluation failure reports an error instead of overwriting stored source data. SVG export does not silently emit a partial visible document. This is not a hardened multi-tenant service: additional graph-depth/CPU bounds and worker isolation are needed before cloud exposure.

## SVG import scope

Supported: zero-origin viewBox, pixel/unitless dimensions, nested groups with solid inherited fills and numeric fill-opacity (0–1), nonzero compound paths, circles, ellipses, unrounded rectangles. Each imported graphic becomes its own composition with Remap and Output. Imported path geometry is retained as immutable source path data, with secondary editing through Remap. Own exported SVG metadata preserves layer names.

Rejected: scripts, external references, declarations/entities, styles/CSS/classes, transformations, nested viewports, clipping/masks/filters, group/object opacity, strokes, even-odd fill and rounded rectangles. Rejection preserves the currently open project. This is intentionally a subset, not arbitrary SVG fidelity.

## Individual Remap controls and graph layout

`enableRemapPoint(node, inputPath, pointId)` creates typed delta parameters for position, handleA and handleB, migrating legacy vector deltas without loss. Their graph keys are `remap.<pointId>.<component>`. Each supports direct fallback, Vector2 expression, typed connection and lock independently, with the same precedence and disconnect restoration as generator parameters. `rebindRemapPoint` explicitly adopts the current source fingerprint, retaining all parameter definitions. Canvas drags alter only undriven, unlocked deltas and refuse suspended edits. Toggle produces Boolean input for closure controls.

Node width (optional, 220–550 px) and position are editor state excluded from geometry cache signatures. New-card placement uses measured card bounds with a gap; graph bounds expand to keep tall Curve/Remap controls scrollable. Field tools have their own row above full-width Vector2 controls. No idle animation or continuous render loop is introduced.

`translateRemapPoints(node, inputPath, pointIds, delta)` applies a Vector2 translation to selected point deltas atomically. It prepares edits on a clone and commits only when every target exists and every position is undriven, unlocked and not suspended. Duplicate IDs apply once. It preserves handles, all other parameters and the upstream geometry. The editor wraps one application in one history transaction. Batch selection and the pending delta are transient editor state, not saved geometry.

## Typed Color values

Color is a separate socket type with a serializable `{hex: "#RRGGBB", alpha: 0..1}` value. The Color node accepts a direct fallback or another Color source; numeric expressions are intentionally unsupported. Output has independent Path and Color (`fill`) inputs. Source takes precedence over the saved fallback. Only Output.fill accepts `null`, meaning live layer fill with alpha 1. Older v1 documents missing Output.fill migrate to this null fallback without changing their appearance. Color inputs reject Path, Vector2, Scalar, Boolean and Image connections; the existing cycle and lock rules apply.

Evaluated Output paths carry a `fill` Color object, used by both the canvas and SVG exporter. SVG writes `fill` plus `fill-opacity`; PNG uses the same SVG scene. Solid SVG fill-opacity inheritance and explicit child overrides import into Output fallback values without multiplying ancestor values. General/group opacity remains rejected. JSON retains graph connections, fallbacks, alpha, locks and collapsed state. Gradients, mixing, strokes and color-management conversions are outside this bounded implementation.

### Graph viewport navigation

Graph zoom is viewport-only CSS zoom (25–200%); model coordinates and saved node widths are unscaled. Pointer movement is converted from the graph screen rectangle into world coordinates, and wire endpoints divide by the same zoom. Native scrolling remains compatible with node reveal and large expanded cards. Node drags capture the pointer and run a time-based edge-pan animation (64 px activation band, quadratic speed ramp, 720 px/s per-axis cap, 50 ms frame cap). Bounds grow ahead of right/bottom movement; left/top retain the nonnegative document origin, with group positions clamped together. Completion records one history transaction; cancellation, lost capture, Escape and blur restore the pre-drag document and stop animation.

Navigation borrows middle-drag pan and modifier-wheel zoom from the official [Fusion 20.3 manual, p. 39](https://documents.blackmagicdesign.com/UserManuals/FusionManual.pdf?_v=1724310010000). Ctrl is the Windows equivalent of Command. Edge-drag scrolling is a requested Nect behavior, not a claim of exact Resolve parity.
