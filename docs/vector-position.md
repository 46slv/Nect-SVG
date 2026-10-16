# Vector canvas position handle prototype

Open [the editable Vector sample](../examples/vector-position-reuse.json), or add a **Vector** and turn on **Canvas position handle** in its card or Inspector. Select the Vector to show a teal diamond labeled **Vector XY**. Drag the diamond to edit the same **Value X/Y** used by the number fields and output. The matching [Null sample](../examples/null-position-reuse.json) provides the same artwork and wiring pattern for comparison.

## Explicit position use

A Vector remains a general Vector2 value. Handle mode is **off by default**, including in older documents. Direction, size, scale and offset vectors do not acquire a canvas point automatically. Turning the display setting on or off changes neither the value, its output type nor any connections. Enable it when you intentionally want to treat this value as an artwork coordinate.

The marker uses source artwork coordinates, before any downstream Transform. An offset vector can still be displayed as a point if explicitly enabled, but the marker does not infer an object's final location. For a dedicated named Position controller use Null. No new Vector output port, Reference node or Transform handle is added here.

## Shared editing behavior

Null and opted-in Vector use one position-handle interaction path: CTM-based coordinate conversion, fixed screen-size marker, the existing six-screen-pixel snap threshold, and Alt bypass. The snap anchor is the value itself. Visible guides, artboard/grid options and visible guide-layer bounds remain the available targets. Snapping updates Value; it does not make a new dependency.

Only the selected controller's marker is displayed. A blank-canvas click does not move it. Multiple selected graph cards do not create a group move through the dedicated marker. Middle/Space drag pans the view even over the marker.

A completed drag is one Undo entry. Click jitter and an unchanged out-and-back gesture preserve the original floating-point values and add no history. Escape, pointer cancellation, lost capture and window blur restore the pre-gesture document. A numeric draft commits before the gesture snapshot and remains its own Undo entry. Numeric edits and handle edits write the same `params.value`, without a second position store.

Connected, expression-driven or parameter-locked values show a gray read-only marker at the evaluated value. Layer lock also blocks editing and the display toggle. Hidden compositions show no marker. Dragging never changes a connected source, saved fallback, expression or lock. Input priority stays connected source → expression → direct Value. Selected-only behavior does not suppress or alter downstream evaluation.

## Persistence and export

The optional node field `canvasPositionHandle` is a Boolean allowed only on Vector. Missing means off; malformed types reject on load. The display mode is saved, undoable and copied when duplicating the Vector. Normal node identity, connections, deletion and history rules continue unchanged. Existing v1/v2/v3 files remain readable, and projects without character offsets stay schemaVersion 2. There is no migration of ordinary Vector values or output sockets.

The diamond and label are editor overlays. SVG and PNG contain only evaluated artwork. Turning the display setting off leaves both exports identical. Use project JSON to preserve the opt-in setting and editable graph.

## Verification

- `vector-position.test.js`: opt-in/default/legacy persistence, malformed settings, unchanged ports/evaluation/export, normal priority/cycles, Text Position and Separate/Combine/Vector Math reuse, downstream Transform independence and history.
- `vector-position-dom.test.js`: shared drag/snap, precise six-screen-pixel boundary, zoom/pan and affine CTM, high-precision no-op, toggle/history, numeric source agreement, interruptions, pointer identity, read-only guards, duplication/deletion and Null coexistence.
- `vector-position.e2e.js`: real Chrome opt-in/selection, drag/snap/Alt, history, capture/blur/Escape cancellation, zoom/pan, numeric draft commit, precision jitter, read-only values, save/reload, screenshots and matching PNG bytes with the marker enabled/disabled. The Windows workflow invokes this in the existing full browser suite.

Local unit/DOM checks are not real browser evidence. This execution environment has a known Chromium socket EPERM restriction; no repeated launch attempts are made. Actual Chrome and NSIS results must be verified against the published commit. Native WebView2, high-DPI and OS dialog acceptance remain separate checks.
