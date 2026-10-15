# Names, layer visibility and node bypass

## Rename in place

Double-click a layer name or node title to edit it in place. Keyboard users can focus a name and press F2 (Enter also edits a focused node title). Single clicks still select; dragging a node title still moves its selection after a small movement threshold.

- Enter commits a trimmed, nonempty name. Clicking or tabbing away commits once.
- Escape cancels. Empty or unchanged edits do not consume an Undo step.
- Japanese/other IME composition remains a draft; conversion Enter does not submit it.
- Locked compositions cannot be renamed or have their nodes renamed.
- Names are labels only. Stable layer/node IDs, connections, Reference targets, geometry and saved parameters stay unchanged. JSON retains the labels; SVG is still evaluated artwork.

The existing Layer name Inspector field remains available. Inline editing intentionally rejects blank names without invalidating older documents that contain one.

## Layer visibility

Each layer has an explicit **Hide / Show** button. Its accessible label names the layer and its pressed state reflects visibility. Hidden rows are muted, remain selectable, and keep their whole editable graph.

Visibility uses the existing `layer.visible` field and is undoable/saveable. Hidden layers are excluded from the canvas, SVG and PNG. Visibility can still be toggled on a locked layer. A visible guide layer remains editor-only and is excluded from exported artwork.

## Node bypass

The **Bypass** button in a node header, or **Bypass effect** in the Inspector, temporarily forwards one defined input unchanged. A bypassed card is dashed and labelled **Bypassed**; **Restore effect** re-enables the saved operation. All parameters, secondary inputs, connections, names and node IDs stay intact. Saved effect controls may still be edited; their effect appears when restored. Canvas handles for the bypassed effect are suppressed.

Supported identities are deliberate:

- Transform, Path Remap, Closed Path Offset, Geometry Repeater, Convert to Path, Text to Path: `path → Path`
- Fill, Linear Gradient Fill, Radial Gradient Fill, Stroke: `path → PaintedPath`
- Boolean and Join Geometry: `A → Path`; B is retained but not evaluated
- Math: `A → Scalar`
- Vector Math, when its output is Vector2: `A → Vector2`

Generators have no input geometry to forward. Separate/Combine Vector change types or have multiple outputs; Vector Math Length/Distance/Dot return Scalar from Vector2. These, source/value/controller nodes, Reference and terminal Outputs have disabled controls with an explanation. There is no guessed first socket, generated zero value or automatic deletion.

Paint bypass forwards the complete incoming geometry and prior paint. Bypassing the only Fill makes unpainted geometry invisible; it does not create a default fill. Earlier gradients, stroke, alpha, grouped paths, contour/point identities and character provenance survive unchanged.

### Validation and persistence

The optional `bypassed: true` flag requires project schema 10. Restoring removes the flag; old documents are not upgraded simply by opening, selecting or renaming. Newer schemas are rejected by older builds, avoiding silent loss of bypass semantics.

Evaluation skips the disabled operation and its secondary computational dependencies, while stored connections still undergo type/cycle/depth validation. Missing identity input fails explicitly. Cache keys and source provenance account for bypass state and upstream changes; unmodified older graphs retain their provenance format. Switching a bypassed Vector Math to a Scalar-output operation is rejected until it is restored.

Type on Path and Closed Path Offset retain their normal safety checks. A toggle that invalidates a retained contour binding is rolled back. Bypassed identity routes are recognized when duplicating an attached Text together with its source graph. Undo/Redo and JSON preserve the entire state.

## Verification

`tests/node-bypass.test.js` checks every supported identity, unsupported types, ignored errors, stored-cycle/type rejection, warm/cold caches, paint and character metadata, history/locks/JSON and attached-text duplication. `tests/editor-names-bypass-dom.test.js` exercises actual handlers, including stable-ID clicks through rerenders and IME drafts. `tests/editor-names-bypass.e2e.js` runs real Chromium double-click/keyboard/drag flows, visibility SVG/PNG parity, and bypass browser/CLI equality at two window sizes.

Real Chrome and unsigned Windows packaging must be confirmed for the exact development commit. Native WebView2 and native Windows IME are separate acceptance gates; synthetic composition events do not certify those environments.
