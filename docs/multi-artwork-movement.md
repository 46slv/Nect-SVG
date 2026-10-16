# Move independent artwork together

## Scope and design contract

This adds one production operation: keep an explicit set of independent artwork layers and translate them together. At baseline `b9728ecd9a254a8b4046c187cc178043d23197c5`, `artworkTarget` held one layer ID; the existing node `selection` set was confined to the current graph. Independent artwork multi-selection was absent. Graph node multi-selection remains separate.

The working surface and pane positions stay unchanged. Layers rows show every selected artwork, the Inspector shows the count and active graph's layer name, and each visible final Output has a dashed selection outline. A plain canvas press on an already selected member retains the set. Shift-click toggles membership. On an already selected artwork, removal waits for release; dragging instead retains the set and constrains its axis. Holding/releasing Shift during a drag also constrains/releases its axis. Selection never changes project JSON or exported geometry.

## Practice with the editable sample

Open [multi-artwork-movement.json](../examples/multi-artwork-movement.json) using **Open**. It contains a rectangle, a star with a rotated negative-scale terminal Transform, editable Text, a closed Bezier Curve, an embedded image, and an untouched hidden reference graph.

1. Click **Silver tile**, then Shift-click the other visible artwork names in Layers. Canvas Shift-click also adds/removes the hit artwork. Click a Layers name normally to select only that layer. Click empty canvas to clear.
2. Drag any selected artwork normally to move the entire set. Hold Shift to constrain the shared delta to one artboard axis, including when Shift is already pressed over a selected member. Alt bypasses snapping. Shift-click an unselected member to add it; continuing into a drag moves the enlarged selection with the same axis constraint.
3. With the artboard focused, use Arrow keys for 1 document unit, or Shift+Arrow for 10. Zoom does not change the distance. Each accepted keydown is one Undo step.
4. Undo once to restore every moved position; Redo restores the same result and selection. Escape, pointer cancellation, capture loss and window blur restore all artwork and retain the prior Undo/Redo stacks. A click or exact out-and-back drag creates no history.
5. Save JSON and reopen to retain the independent graphs and image. The temporary selection is cleared on load. SVG/PNG contain artwork only.

## All-or-nothing movement

Each selected stable layer ID must pass the existing single-artwork resolver. Supported routes remain:

- Circle/Ellipse/Rectangle/Polygon/Star or unattached Text -> one solid Fill -> Output, optionally one existing terminal Transform before Fill.
- Direct Curve -> solid Fill -> Output, with 2–128 authored anchors.
- Direct Image -> Image Output.

Shapes edit Center, Text/Image edit Position, terminal Transforms edit Offset in final artboard axes, and Curves move every anchor Position by the same delta while retaining relative handles. No nodes are inserted or disconnected.

A hidden, guide, locked, bypassed, empty, driven, unavailable or unsupported member prevents **every** selected artwork from moving. The Inspector and status give the offending layer's name and reason. Gradients, Boolean/Repeater/Remap, Type on Path, other paint stacks, side dependencies and Curves above 128 anchors retain the previous single-move restrictions. Unsupported artwork can still join the set through Layers; remove it with Shift-click or select a single supported layer to move. No subset is silently skipped.

Pointer preview and release freshly re-resolve the entire set and compare IDs, routes and Curve topology. Every next position across every member is planned before the first write, including finite-value/overflow checks. Gesture cancellation restores the whole document snapshot. One completed drag records one History entry. Selection snapshots accompany movement history and existing artwork creation/deletion/duplication/order history. The save schema is unchanged.

Snapping uses the collective final-output bounding box and one shared delta. Every selected layer is excluded from snap targets; stationary artwork and guides retain existing priority, and Alt/Shift retain existing behavior during the move.

## Other editing paths

Graph card selection exits artwork mode and clears the artwork set. Source-stage handles, character selection, Pen and view navigation retain their existing priority. Fields, graph focus, composition/IME events, open dialogs and active gestures cannot nudge the set. Single-artwork Duplicate and F2 rename are unavailable for a set. Delete on a set displays a reason; an explicit **Delete layer** row action continues to target exactly that named row. Explicit six-way alignment to selection bounds is documented in [Artwork alignment](artwork-alignment.md). Grouping, marquee selection and batch delete/duplicate/resize remain outside this slice.

## Verification

`npm run check` includes pure model and synthetic DOM coverage. `npm run test:e2e` includes `artwork-multi-move.e2e.js` in the aggregate actual-Chrome suite: real file open, canvas/row selection, all supported route types, common drag/arrows, history/cancellation, unsupported members, snapping, focus/composition/modal/pan exclusions, JSON/SVG/PNG save/reopen and 1600x1000 / 1280x800 screenshots. Existing single-artwork/Curve resolver tests and the full previous suite remain required.

Chrome composition events do not establish native Japanese IME conversion behavior. Native WebView2, file-dialog, IME and normal-profile acceptance remain pending; no Nect native application or installer is executed on SHIRO-WS.

Local aggregate validation passed all 604 unit/DOM tests, formatting and the production build. Integration exposed asynchronous font startup assumptions in older DOM harnesses: a 250ms delayed-font probe reproduced unavailable Text before a fixed wait expired. The affected Artwork harnesses now await bundled-font readiness, and Position reference / Blank Text use bounded evaluated-output readiness. Existing geometry, history and roundtrip assertions are retained.
