# Independent Pen artwork

**Pen / Curve** (P) creates a new independent Curve → solid Fill → Output composition. It never changes an existing Output, wire, layer visibility/lock, font or image. Starting from hidden/locked artwork, an image layer or locked Output works without unlocking or exposing it.

## Drawing and finishing

1. Click the canvas for a corner; drag the pressed point for equal, opposite Bézier handles. Existing point/endpoint snapping and Alt bypass apply in artboard coordinates, including after pan/zoom. Space/middle drag remains view navigation. Pen clicks on guides place points rather than moving guides.
2. The first point starts a visible **Curve · Draft (not saved)**. The draft is separate from the project document and history. Its graph/property preview is read-only until finished. Earlier artwork remains visible.
3. **Enter**, **Escape**, **Finish path**, or switching tools finishes an open path. Click the first anchor to close. Finishing requires at least two released points; finishing a one-point draft discards it without adding a layer or history entry. This preserves Escape's existing finish-open behavior.
4. **Cancel path** discards the entire draft. Undo while drafting also discards it, without undoing prior work or consuming Redo. After finishing, a single Undo removes the complete path; Redo restores it with its IDs, handles, paint, hierarchy and artwork selection.

Save JSON and SVG/PNG export finish any valid draft first, or discard a one-point draft, then save/export the committed document. Other document/layer/guide actions generally resolve the draft first. Whole-layer deletion, Duplicate in place and layer Forward/Backward are blocked during a live draft; they never finish, cancel or discard it. The read-only debug document/export API includes only committed artwork. Project replacement resets/discards drafts. Drafts and the Undo stack are session-only. A live draft participates in the existing unsaved browser-close warning.

Finishing or cancelling restores artboard focus. Commit selects final **Artwork · Curve**; drag it immediately to move the whole path, or use Arrow keys for 1 artboard unit (Shift+Arrow: 10). Shift drag constrains an axis; snapping and Alt bypass work through zoom/pan. Each move is a separate Undo step: first undo placement, then undo creation. Clicking blank canvas clears selection and cannot move stale artwork.

Whole-artwork Curve placement is deliberately limited to **Curve → solid Fill → Output**. It adds one common artboard delta to every authored anchor Position. Relative handles, handle modes, closure, IDs/order, graph cards, paint and connections remain unchanged. Every Position must be finite, unlocked, unconnected and expression-free; connected handles, bypassed/locked/hidden routes, gradients, transforms and general graphs remain selection-only. The resolver captures the full ordered point-ID list and rechecks route, kind, IDs/order and closure before preview/commit. Any invalid target or coordinate overflow rejects the entire move. Escape, pointer cancel, capture loss, blur and exact out-and-back restore the complete gesture without history.

This whole-artwork movement slice supports **2–128 anchors**. Above 128, the Inspector and canvas hint explain the movement-only limit before running a cold move evaluation. Nothing is truncated: the existing 10,000-point authoring/model limit, Save JSON, SVG/PNG export and source-stage point/handle editing remain available. Use the graph Curve's **Move node stage** marker for larger paths. This conservative budget bounds extra interaction work; it is not a claim of smooth native performance.

Select its graph Curve for explicit point/handle editing or the separate **Move node stage** marker. Those source-stage controls keep their existing behavior.

## Gesture interruption

Pointer cancellation, lost pointer capture or window blur **during a pressed point** rolls back that entire point and its handle preview. Earlier released points stay visibly marked Draft and can be finished or cancelled. Cancelling the first pressed point removes the draft. Later pointer moves/releases cannot resume a cancelled gesture. A finishing key/tool change during a pressed point first rolls it back, then finishes only the earlier released points. Escape during view panning continues to stop navigation without finishing Pen.

Point releases do not add history. A committed path, including closure, is one understandable Undo unit. This replaces the legacy per-point creation history; existing vertex/handle edits on committed Curve nodes retain their own per-gesture history.

## Explicit graph editing and paint

**+ Add node → Curve** adds an unconnected Curve in the current composition. It never creates a layer or changes Output. Select the Curve card to edit its anchors/handles, use **+ Point**, and choose **Use as output** only when you intend to reroute that composition. Existing locks and driven-parameter protections still apply.

Pen retains the existing solid Fill default and geometric open/closed flag. SVG fill implicitly encloses open contours; a straight two-point path has no filled area. Add/use **Stroke** explicitly for visible open-line artwork. The preview's guide/vertices are editing aids and never export.

## Bounds and evidence

A maximum of 100 document layers and 10,000 Curve points applies. Layer capacity is checked before the first point and again at commit. IDs, coordinates, assets and complete candidate document are validated before append; a rejected commit preserves prior artwork and history. No dependency, schema, permission or native-shell change is introduced.

`tests/artwork-creation.test.js` covers detached creation/commit, prior objects/assets, exact Undo/Redo/JSON, invalid data, duplicate IDs and capacity/vertex budgets. `tests/pen-artwork-dom.test.js` covers finish variants, cancellation at multiple stages, interruption, locked/hidden context, selection/focus and explicit source editing. `tests/artwork-move-target.test.js` and `tests/curve-artwork-dom.test.js` cover rigid batch placement, target invalidation, atomic rejection and retained source-stage editing. `tests/pen-artwork.e2e.js` uses actual Chrome pointers for open/closed Bézier paths, placement after finish, image/Output locks, navigation, exact SVG/PNG pixels, cold reopen, interruptions and 1280×800 / 1600×1000 affordances. Windows CI remains the actual-browser and Rust/NSIS gate. Native WebView2, native file dialogs and IME acceptance remain separate.

Open [the editable Pen example](../examples/independent-pen-artwork.json) to inspect two independent committed curves beside retained artwork.
