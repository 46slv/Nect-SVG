# Architecture and format v2

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

`document()` creates a schemaVersion 2 project; `layer(name)`, `node(type)` and `point(x,y)` create stable UUID identities.

`connect(layer, sourceId, targetId, parameterKey)` validates type, edit lock and cycles, replaces an existing connection, and restores its previous edge on rejection. Connections cannot cross compositions. `disconnect(node, parameterKey)` drops only the edge, retaining direct value and expression.

`evaluate(layer, fonts)` returns `{ path, error, warnings, values, run }`. `run(nodeId)` evaluates another node in that composition; results are memoized within one evaluation. A per-composition weak cache records each node’s semantic inputs and upstream revision IDs. Only changed dependency chains recompute; moving a graph card does not invalidate geometry. Cached results are defensively copied. Evaluation depth is bounded to 256 nodes and expressions to 4096 characters.

`pathData(path)`, `pathArea(path)`, `exportSVG(document, fonts)` consume plain geometry. `exportSVG` refuses any erroneous visible composition, and emits nonzero-filled compound paths.

`serialize(document)` creates JSON. `deserialize(text)` parses and validates a candidate before editor replacement. `History.apply(fn)` snapshots before mutations, rolls back thrown mutations and clears redo only for actual changes. History is bounded to 100 changes and 96 MB of distinct font bytes; immutable font assets are shared across snapshots. Pointer gestures are one change each.

## Project schema

Root: `{schemaVersion:2, name, width, height, layers, fontAssets?}`. The artboard ratio is independent from the 16:9 workspace design.

Layer: `{id, name, visible, locked, fill, nodes, output}`. Layer order is paint order (last is front). One layer equals one composition. No implicit node sharing.

Node: `{id, type, name, position, params, points, operation, edits, text, font}`. `position` is graph UI position, not artwork position.

Optional `width` and `collapsed` fields hold node-card presentation state. `collapsed` must be Boolean when present and defaults to expanded for older files. Both are excluded from geometry cache signatures and survive JSON roundtrips.

Parameter: `{type, value, expression, locked, source?, sourcePort?}`. Types: Scalar, Vector2, Boolean, Color, Path, PaintedPath, Image. Resolution order is source connection, expression, direct fallback. Connected fields cannot directly edit fallback through the UI. Disconnection restores the previous expression/value. Vector expressions use `xExpression; yExpression`. Path fallback is null; paths must come from graph edges.

Point: `{id, position:Parameter, handleA:Parameter, handleB:Parameter, handleType}`. Handles are relative vectors. `corner`, `smooth`, `symmetric` affect interactive handle movement. Curve points are owned and edited by the Curve generator, without requiring Remap.

Evaluated Path: `{contours:[{id,closed,group?,points:[{id,position,handleA,handleB}]}], unstable?, fingerprint?}`. No Paper.js objects escape the evaluator. Parsed font objects are caller-supplied dependencies in `fonts` and are not serialized; imported original bytes are embedded separately in `fontAssets`. `exportSVG` resolves them automatically.

## Geometry and correspondence

Paper.js 0.12.18 computes cubic Bézier Boolean union/subtract/intersection/exclusion; results remain normal Path values, so Boolean can feed another Boolean or Remap. Open contours are rejected for area Boolean operations rather than silently closed. Exact tangencies and extreme coordinate/precision conditions are not exhaustively verified.

Primitive/Curve vertex IDs are stable; Transform preserves their IDs because affine transforms do not alter topology. Boolean, Text and Imported Path contours are marked unstable. Their Remap edits store an exact source-geometry fingerprint and suspend with a warning whenever it changes. This conservative rule can suspend more edits than necessary, but never intentionally assigns an old edit to a different vertex. Suspended definitions remain in the saved file; the user can explicitly rebind a retained edit to the currently displayed point, or clear it. Rebind changes only the source fingerprint and is undoable; it does not automatically infer correspondence. Better provenance mapping is deferred.

Text uses OpenType.js with bundled DejaVu Sans or embedded local static TTF/OTF bytes. Multiple contours/counters, Japanese and mixed vertical writing are preserved; the detailed layout, fallback, format and licensing boundaries are in [typography](typography.md). Complex shaping, variable-font axes and automatic font fallback are not supported. Text is evaluated into outlines, with a pass-through Text to Path node retained as the explicit UI boundary.

## Trust and failures

JSON IDs use a conservative safe-character grammar. All graph UI positions, vectors, scalar values, locks, types, expected parameters, layer fills, operations and remap edits are validated; duplicate IDs and edit targets are rejected. Project size is limited to 50 MB UTF-8 before parsing; fonts have separate 20 MB/file and 32 MB/project limits. SVG import retains its 10 MB limit. Unknown versions are rejected. UI text is escaped. Expressions use a numeric parser, never `eval` or `Function`.

An evaluation failure reports an error instead of overwriting stored source data. SVG export does not silently emit a partial visible document. This is not a hardened multi-tenant service: additional graph-depth/CPU bounds and worker isolation are needed before cloud exposure.

## SVG import scope

Supported: zero-origin viewBox, pixel/unitless dimensions, nested groups with inherited solid fills/strokes and the explicit two-stop local linear/concentric-radial gradient fill subsets, independent numeric paint alpha (0–1), and bounded pixel stroke widths, nonzero compound paths, circles, ellipses, unrounded rectangles. Each imported graphic becomes its own composition with Remap, explicit Fill/Linear Gradient Fill/Radial Gradient Fill/Stroke, and Output. Imported path geometry is retained as immutable source path data, with secondary editing through Remap. Own exported SVG metadata preserves layer names.

Rejected: scripts, external references, declarations/entities, styles/CSS/classes, transformations, nested viewports, clipping/masks/filters, group/object opacity, unsupported gradients, unsupported stroke styles/units, even-odd fill and rounded rectangles. Rejection preserves the currently open project. All gradient definitions, exact local references, namespaces and resource budgets are checked before graph construction; see [the safe reopening contract](linear-gradient-fill.md#safe-svg-reopening-contract). This is intentionally a subset, not arbitrary SVG fidelity.

## Individual Remap controls and graph layout

`enableRemapPoint(node, inputPath, pointId)` creates typed delta parameters for position, handleA and handleB, migrating legacy vector deltas without loss. Their graph keys are `remap.<pointId>.<component>`. Each supports direct fallback, Vector2 expression, typed connection and lock independently, with the same precedence and disconnect restoration as generator parameters. `rebindRemapPoint` explicitly adopts the current source fingerprint, retaining all parameter definitions. Canvas drags alter only undriven, unlocked deltas and refuse suspended edits. Toggle produces Boolean input for closure controls.

Node width (optional, 220–550 px) and position are editor state excluded from geometry cache signatures. New-card placement uses measured card bounds with a gap; graph bounds expand to keep tall Curve/Remap controls scrollable. Field tools have their own row above full-width Vector2 controls. No idle animation or continuous render loop is introduced.

`translateRemapPoints(node, inputPath, pointIds, delta)` applies a Vector2 translation to selected point deltas atomically. It prepares edits on a clone and commits only when every target exists and every position is undriven, unlocked and not suspended. Duplicate IDs apply once. It preserves handles, all other parameters and the upstream geometry. The editor wraps one application in one history transaction. Batch selection and the pending delta are transient editor state, not saved geometry.

## Typed Color values

Color is a separate socket type with a serializable `{hex: "#RRGGBB", alpha: 0..1}` value. Color inputs preserve the source/fallback/lock model and reject numeric expressions. Fill, Linear Gradient Fill, Radial Gradient Fill and Stroke accept Path or PaintedPath and output PaintedPath. `socketCompatible` is shared by validation, evaluation, selectors, and drag highlighting. Boolean/Transform/Remap/conversion nodes accept only Path, keeping geometry before painting. Output accepts either Path or PaintedPath; an unpainted Path renders with `fill="none"`.

Fill replaces only `fill`; Stroke replaces only `stroke` (`{hex,alpha,width,cap,join,dash,miterLimit,dashOffset}`), cloning upstream geometry before changing it. Repeated same-channel nodes use the last value. Width is a finite 0–100000 px Scalar; zero width and zero alpha are preserved. SVG uses standard fill-then-stroke order, and PNG rasterizes the identical scene. Solid fill/stroke colors, independent alpha inheritance, open paths and stroke-only shapes import explicitly. CSS, unsupported gradients, unsupported stroke styles/units, transforms and general/group opacity remain rejected.

Schema-v1 migration inserts a Fill before each old Output, copying the complete old Output.fill parameter including source, fallback, expression and lock. Missing fill becomes null; only Fill.color permits null to retain the old live layer.fill fallback. Layer fill remains serialized for legacy fidelity but has no editor control. Output owns only its path. Old geometry consumers of Output are redirected to its pre-paint geometry, preserving editing order. Existing node/layer/asset/guide IDs remain intact. Migration is idempotent, checks the 2000-node limit after insertion, never auto-saves, and the normal validator rejects malformed migrated values. New default layers, shape tools, Pen, and “Use as output” create explicit Fill nodes.

Paint stacks with multiple fills/strokes, gradients beyond the two-stop linear and concentric radial fills, mixing and color-management conversion remain outside this implementation.

### Graph viewport navigation

Graph zoom is viewport-only CSS zoom (5–200%); model coordinates and saved node widths are unscaled. Pointer movement is converted from the graph screen rectangle into world coordinates, and wire endpoints divide by the same zoom. Native scrolling remains compatible with node reveal and large expanded cards. Node drags capture the pointer and run a time-based edge-pan animation (64 px activation band, quadratic speed ramp, 720 px/s per-axis cap, 50 ms frame cap). Bounds grow ahead of right/bottom movement; left/top retain the nonnegative document origin, with group positions clamped together. Completion records one history transaction; cancellation, lost capture, Escape and blur restore the pre-drag document and stop animation.

Navigation borrows middle-drag pan and modifier-wheel zoom from the official [Fusion 20.3 manual, p. 39](https://documents.blackmagicdesign.com/UserManuals/FusionManual.pdf?_v=1724310010000). Ctrl is the Windows equivalent of Command. Edge-drag scrolling is a requested Nect behavior, not a claim of exact Resolve parity.

## Math and named XY outputs

Math is Scalar; Combine Vector takes Scalar x/y and produces Vector2. Separate Vector takes Vector2 and exposes named Scalar `x` and `y` outputs. Existing connections retain `source: nodeId`; Separate connections also require `sourcePort: "x" | "y"`. Port identity is preserved in JSON, history, evaluation, connection menus and wires. Legacy single-output sources omit sourcePort. Invalid/missing ports and typed edges are rejected.

`outputPorts(node)` enumerates sockets; `outputType(node, port)` resolves each type. `connect(layer, sourceId, targetId, key, validating = false, sourcePort)` validates the selected socket atomically. `evaluate(layer).run(id, port)` reads a named output. `activeParameters(node)` defines operation-specific evaluation/UI inputs; `parameters(node)` retains all stored inputs for structural validation. Math supports add/subtract/multiply/divide/min/max/abs/clamp. Divide by zero is 0, Clamp is inclusive and rejects min > max, and all inputs/results must be finite. Expression arithmetic is unchanged.

`setOperation(layer, nodeId, operation)` checks the allowlist and all outgoing typed references before mutation, including hidden, locked and point fields. Hidden connections survive operation changes but remain part of cycle detection and persistence validation. Evaluation caches include operation and active input dependencies, and errors always clear the active traversal set.

## Vector Math and live wiring

Vector Math has Vector2 a/b and Scalar scale inputs. Add/Subtract/Multiply/Divide are componentwise; Scale uses a/scale, Normalize and Length use only a, and Distance/Dot use a/b. Length/Distance/Dot return Scalar; the other operations return Vector2. Zero denominators yield 0 per component, and zero-vector normalization yields [0,0]. Normalize scales finite components before taking the hypotenuse to avoid intermediate overflow/underflow; Length/Distance use Math.hypot. Nonfinite inputs or results are errors. Dynamic type changes go through setOperation, checking every stored outgoing reference before mutation.

The transient wiring state stores screen pointer coordinates and the selected sourcePort. drawWires converts the live socket and pointer through the graph rectangle and zoom, redrawing during pointer movement and scrolling. The dashed blue preview is pointer-transparent and never enters project data or history. Success replaces it with a stored edge in one transaction; Escape, blur, pointercancel and release clear it. Incompatible/locked drops preserve prior connections.

## Bounded Geometry Repeater and text anchors

`Geometry Repeater` has Path input/output with linear, radial-fit and radial-step operations. Count is 1–256 inclusive; count includes the first copy. Linear translates by per-copy step. Radial rotates geometry and relative Bézier handles about center, with startAngle on the first copy. A ±360° fit divides by count; other fit arcs divide by count−1 (or 1 for a single copy), with fit arc bounded to ±360°. Step mode uses angle directly. No paint replication/stack semantics are implied. The point budget is 100000 and contour budget is 10000 for each evaluated output, including nested repeaters. Copies get unique IDs and an unstable fingerprint, so changed repetition suspends downstream Remap edits until explicit rebind.

Text alignment/kerning are optional node properties with legacy defaults start/true. A single shaped run determines both rendered paths and signed inline advance; only n−1 tracking intervals count. Each explicit line/column shifts by 0, −advance/2 or −advance. Cache keys include both properties. Schema 2 remains the save format; older JSON does not need new required properties.

## Join groups and styled strokes

Join Geometry concatenates independently painted geometry groups, not Boolean contours. Derived contours carry an optional group ID. Transform and Remap preserve it; repeated grouped input gets unique groups per copy. `renderElement` emits a g with one path per group, preserving opposite-winding overlaps, compound holes and independent alpha. Ordinary ungrouped paths retain their prior single-compound rendering. Boolean explicitly unions groups within each operand before its requested operation. A 256-group limit applies to Join and grouped Repeater. Geometry IDs/fingerprints use bounded SHA-256; group identity participates in signatures only when present, preserving old ungrouped Remap fingerprints.

Stroke adds optional cap/join/dash metadata and typed Scalar miterLimit/dashOffset parameters. Missing old parameters migrate to 4/0; optional styles default butt/miter/solid. Strict shared dash/style validation is used by JSON, evaluation, UI and SVG import; SVG inherits these presentation properties and exports them explicitly. Documentation of precise bounds is in product-spec section 14.

## Text Position output

Text keeps its legacy default Path socket (no sourcePort) and adds `position`, a Vector2 socket. It returns the resolved Position parameter using the normal source → expression → fallback priority, at the Text's stored reference point before downstream Transform. Reference/font/text changes affect outlines without silently changing the coordinate's meaning. XY reuse, Separate/Math/Combine for one-axis reuse, and Vector Math offsets use ordinary graph edges; no hidden cross-layer or reverse-edit relationships are added.

Evaluation resolves dependencies by node plus output port. Text Position uses a distinct memo/cache entry containing only its Position input and upstream output revisions, independent of fonts and Path generation. Consumers can use the coordinate before a font loads; any consumer of its Path still receives the normal font/outline diagnostic. Separate X/Y continue sharing their vector evaluation. The structural cycle check remains conservatively node-based, including inactive and locked inputs. New named ports pass the same type, lock, history and JSON validation as existing edges.

Schema 2 remains unchanged: old Text Path connections work without migration; older applications may reject the new `sourcePort: "position"`. Source identity is a stable node ID, never a name. Source deletion clears both source fields and restores the retained fallback/expression; duplication keeps references to existing external sources. The editor displays Path and Position separately in expanded/collapsed cards, labels connected values by the published port name, and only offers compatible sockets.

## Selected Transform handle state

`evaluate(layer).transformState(id)` reads the selected Transform input, Anchor, Offset, Scale and Rotation through the same evaluated-parameter resolver used by geometry. It is runtime-only, including on cache hits. `transform-handles.js` shares the character affine helper for source-stage controls and keeps scalar/angle drag mathematics independent of DOM. The editor writes existing Scale/Rotation fields only; there is no schema migration, generalized downstream inverse or persisted control geometry.

## Same-layer Vector2 Reference

Reference stores a nullable explicit `{nodeId, portId}` descriptor, with `output` mapping to the existing unnamed default socket and `position` mapping to Text Position. `nodeDependencies` unifies parameter wires and this typed dependency for cycle checks; evaluation resolves only active parameter dependencies plus Reference, validates the target before reuse, and keys cached values on target identity and upstream output revision. Missing targets are retained as diagnosed dangling IDs, never numeric fallbacks. Document-wide layer ownership rejects cross-layer references even when the source occurs later in the file. `setOperation` protects referenced Vector2 outputs from Scalar changes. See [Reference persistence, duplication and validation](vector-reference.md).

## Character shape records

New documents remain schema2. XY-only stable-character records require schema3; rotation/uniform-scale records require schema4. `characterPositions` record v2 adds sparse `transforms` to the existing logical IDs/offsets, and all schemas 1–4 are accepted with version-specific validation. `text-layout.js` applies local shape about a normal advance-cell pivot before XY and downstream provenance, without altering advances, Position OUT caching or compound paint grouping. See [the full contract](character-transform.md).

## Linear gradient paint

`linear-gradient.js` validates and copies a bounded two-stop descriptor and emits a bare paint-server definition. Core owns the typed node and replaces only fill. `renderElement` emits one definition per top-level layer and reuses its URL through contour-group rendering. Canvas and export allocate deterministic scene-local IDs using the document layer index, independent of user layer names/IDs; PNG rasterizes that SVG. Solid rendering stays unchanged. Endpoint evaluation is artboard-space, after all geometry operations; upstream Repeater shares a ramp. See [the full contract and limitations](linear-gradient-fill.md).

### Bounded Closed Path Offset

`Closed Path Offset` consumes Path and emits unpainted Path before paint nodes. Numeric amount/miterLimit retain the ordinary Scalar source/expression/fallback contract; join uses node.operation. Node schemas remain additive under existing versions, and unknown nodes fail closed in older implementations. A zero amount preserves the evaluated input object. Nonzero output is derived polygon geometry, unstable for Remap: its fingerprint includes upstream node/edge identity, source contour/point identity and geometry, settings and output signature. Rerouting equal geometry therefore suspends existing edits. Evaluator caching includes dependencies and operation as usual.

`closed-offset.js` holds the pure qualified kernel, and `clipper-adapter.js` supplies the pinned true-bevel policy. Graph evaluation tightens counted budgets through an optional fourth argument; it never expands the kernel constants. `assertClosedOffsetChange` prevents newly introduced Offset errors from being retained by UI transactions and gestures, while allowing ordinary missing-input wiring states and preserving pre-existing errors for repair. See [the numerical/dependency/work-limit contract](closed-path-offset.md).

## Concentric radial gradient paint

`radial-gradient.js` follows the same dependency-free descriptor and definition boundary, with a bounded center Vector2 and radius Scalar. Explicit concentric focal values avoid SVG default ambiguity. The existing scene allocator, grouped rendering, paint replacement and PNG path are shared with linear paint. The importer validates both kinds in one definition/reference pass under shared aggregate budgets, constructs independent editable paint values, and retains strict namespace/attribute/structure rejection. See [the radial contract](radial-gradient-fill.md) for exact numeric limits, safe reopening and source-adaptation boundaries.

## Manual pair kerning (schema 9)

`characterPositions` v5 adds sparse `kerningPairs` keyed by ordered adjacent source IDs. Explicit zero remains active. Verified reconciliation retains only surviving adjacent pairs; unknown edits suspend them. Normal/wrapped horizontal and vertical layout share one boundary resolver, replacing the metric component while preserving intrinsic advance and adding tracking once. Text path-cache metadata is isolated from Position OUT cache entries. See [the complete storage, UI and layout contract](pair-kerning.md).

## Node bypass (schema 10)

An optional `bypassed` boolean enables an explicit per-type input identity. `bypassContract` defines compatibility; `setNodeBypassed` retains authored inputs and checks stored cycles. `evaluatedParameters` and active dependency traversal use only the forwarded input while bypassed, without changing the parameter editor or stored-graph validation. Evaluation cache keys and source provenance include bypass state. Forwarded values are cloned with character, paint and contour metadata intact. The [interaction contract](names-visibility-bypass.md) lists supported/unsupported types and persistence boundaries.
