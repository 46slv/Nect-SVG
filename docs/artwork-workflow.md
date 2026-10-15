# Independent artwork and safe placement

The left toolbar’s **Circle, Rectangle, Polygon, Star and Text** buttons add a new independent artwork layer at the document center. Each new layer has a generator → solid Fill → Output graph. Existing layers, connections, paint, visibility, locks and assets stay intact, including when the previously active layer is hidden or locked. Creation is one Undo step. The pure creation helper also supports Ellipse; Ellipse remains available through graph node creation rather than a separate toolbar button.

**+ Add node** adds an unconnected node to the current layer’s graph. **+ Demo composition** adds the existing starter Boolean example. **Pen / Curve** remains the legacy current-composition graph tool: starting a curve routes that composition’s Output to the new curve’s Fill. This release does not add a blank-composition or scene/group model.

## Two explicit edit targets

- Click rendered artwork or its Layers row to select **Artwork · layer name**. Its dashed box represents the final evaluated Output. Graph card order never selects a source or decides how artwork moves.
- Click a graph card title to enter **Node · node name · before downstream nodes**. The dashed source outline, narrow stroke-only hit corridor and **Move node stage** marker edit that explicit node or selected generator set. Dimension, Transform, point, position-controller and character handles retain their own source-stage semantics and higher hit priority.
- Click empty artboard space to clear selection. Dragging empty space never moves the previously selected generator or artwork. Space/middle drag remains view navigation.
- Selection, view changes and editor overlays do not change JSON or exported artwork. Undo/Redo restores the selection associated with independent artwork creation.

## Supported whole-artwork movement

Artwork drag and focused-artboard Arrow keys use the same conservative resolver. The supported graph is one Circle/Ellipse/Rectangle/Polygon/Star or unattached Text → solid Fill → Output, optionally with one existing Transform immediately before Fill. A direct Image → Image Output is also supported. Disconnected nodes do not affect target choice.

Dragging translates the final artwork in artboard units through the current canvas transform. Hold Shift to constrain one axis; release Shift to move freely. Existing snapping and Alt bypass apply to pointer placement. Arrows move 1 document unit, or 10 with Shift, without snapping and independently of zoom. Each accepted keydown is one Undo step. Character editing takes priority. Fields, IME, dialogs, graph focus and active gestures do not invoke artwork nudging.

A terminal Transform edits only its Offset in final artboard axes, including under rotation and negative scale. Direct shapes edit Center; direct Text/Image edit Position. No node is inserted and no input is disconnected.

Other graphs remain selectable with a visible movement-unavailable reason. In particular, Boolean, Repeater, Remap, extra paint stacks, gradients, Type on Path, output-affecting non-path dependencies, bypassed routes, empty output and locked/driven positions are outside the safe capsule. Gradient coordinates are artboard-space, so moving geometry alone would change its paint.

A completed pointer drag is one Undo step. Exact no-op/out-and-back gestures create no history. Escape, pointer cancellation, capture loss and window blur roll back the entire gesture. The target is resolved again during preview and before commit; an invalidated target is cancelled.

## Verification boundary

Core tests cover six creation-helper types, atomic rejection, prior-layer/asset preservation and exact supported/refused movement routes. Synthetic DOM tests cover five toolbar tools, scope separation, placement, 1/10-unit nudging, no-op/cancel history, selection restoration, busy/focus/IME exclusions and capacity failure. Actual Chrome acceptance includes creation/export/reopen, final-artwork movement through terminal Transform, another-layer dragging, read-only reasons, source-stage handle priority and 1280×800 / 1600×1000 screenshots. Windows CI is the actual-browser and native packaging gate; synthetic DOM is not rendering proof. Native WebView2/IME and native file-dialog acceptance remain separate gates.
