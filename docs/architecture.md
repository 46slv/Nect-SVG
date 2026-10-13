# Architecture and format v1

## Boundaries and decisions

- `src/core.js`: UI-independent document constructors, typed graph connection rules, safe numeric expressions, geometry evaluation, JSON validation/serialization, SVG export and transactional undo. It imports Paper.js only, and does not access browser or Windows APIs.
- `src/main.js`, `src/style.css`: browser editor. Canvas and graph mutate the same document. No second geometry source of truth exists.
- `src/storage.js`: thin browser-download / Tauri-command adapter. Native destinations are selected by the user; the frontend does not receive a general filesystem API.
- `src-tauri/`: Tauri 2 host and Windows NSIS configuration. Chosen for small distribution and reusable existing browser UI. This is a scaffold pending compilation and Windows interaction verification.
- `cli/export.js`: Node headless adapter. It supplies fonts and calls the same core API. Future cloud rendering should wrap this adapter with request limits, timeouts and isolation; no endpoint exists yet.
- Future Nect adapter: exchange versioned documents and evaluated Path values across an explicit boundary. Do not couple the engine to Nect's renderer, UI store, authentication or Electron/Tauri bridge.

## Public API

`document()` creates a schemaVersion 1 project; `layer(name)`, `node(type)` and `point(x,y)` create stable UUID identities.

`connect(layer, sourceId, targetId, parameterKey)` validates type, edit lock and cycles, replaces an existing connection, and restores its previous edge on rejection. Connections cannot cross compositions. `disconnect(node, parameterKey)` drops only the edge, retaining direct value and expression.

`evaluate(layer, fonts)` returns `{ path, error, warnings, values, run }`. `run(nodeId)` evaluates another node in that composition; results are memoized within one evaluation. A new evaluation currently recomputes the reachable graph. Cross-evaluation incremental invalidation remains follow-up work.

`pathData(path)`, `pathArea(path)`, `exportSVG(document, fonts)` consume plain geometry. `exportSVG` refuses any erroneous visible composition, and emits nonzero-filled compound paths.

`serialize(document)` creates JSON. `deserialize(text)` parses and validates a candidate before editor replacement. `History.apply(fn)` snapshots before mutations, rolls back thrown mutations and clears redo only for actual changes. History is bounded to 100 changes for normal transactions; pointer gestures are one change each.

## Project schema

Root: `{schemaVersion:1, name, width, height, layers}`. The artboard ratio is independent from the 16:9 workspace design.

Layer: `{id, name, visible, locked, fill, nodes, output}`. Layer order is paint order (last is front). One layer equals one composition. No implicit node sharing.

Node: `{id, type, name, position, params, points, operation, edits, text, font}`. `position` is graph UI position, not artwork position.

Parameter: `{type, value, expression, locked, source?}`. Types: Scalar, Vector2, Boolean, Path. Resolution order is source connection, expression, direct fallback. Connected fields cannot directly edit fallback through the UI. Disconnection restores the previous expression/value. Vector expressions use `xExpression; yExpression`. Path fallback is null; paths must come from graph edges.

Point: `{id, position:Parameter, handleA:Parameter, handleB:Parameter, handleType}`. Handles are relative vectors. `corner`, `smooth`, `symmetric` affect interactive handle movement. Curve points are owned and edited by the Curve generator, without requiring Remap.

Evaluated Path: `{contours:[{id,closed,points:[{id,position,handleA,handleB}]}], unstable?, fingerprint?}`. No Paper.js objects escape the evaluator. Text font objects are caller-supplied dependencies in `fonts` and are not serialized.

## Geometry and correspondence

Paper.js 0.12.18 computes cubic Bézier Boolean union/subtract/intersection/exclusion; results remain normal Path values, so Boolean can feed another Boolean or Remap. Open contours are rejected for area Boolean operations rather than silently closed. Exact tangencies and extreme coordinate/precision conditions are not exhaustively verified.

Primitive/Curve vertex IDs are stable; Transform preserves their IDs because affine transforms do not alter topology. Boolean and Text contours are marked unstable. Their Remap edits store an exact source-geometry fingerprint and suspend with a warning whenever it changes. This conservative rule can suspend more edits than necessary, but never intentionally assigns an old edit to a different vertex. Suspended definitions remain in the saved file; explicit clear/recreation is the initial rebind workflow. Better provenance mapping is deferred.

Text uses OpenType.js and bundled DejaVu Sans. Multiple contours and counters are preserved. User font import, shaping complex scripts, variable-font axes and font fallback are not yet supported. Text is evaluated into outlines, with a pass-through Text to Path node retained as the explicit UI boundary.

## Trust and failures

JSON IDs use a conservative safe-character grammar. All graph UI positions, vectors, scalar values, locks, types, expected parameters, layer fills, operations and remap edits are validated; duplicate IDs and edit targets are rejected. File size is limited to 10 MB before parsing. Unknown versions are rejected. UI text is escaped. Expressions use a numeric parser, never `eval` or `Function`.

An evaluation failure reports an error instead of overwriting stored source data. SVG export does not silently emit a partial visible document. This is not a hardened multi-tenant service: additional graph-depth/CPU bounds and worker isolation are needed before cloud exposure.
