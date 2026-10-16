# Independent artwork and safe placement

Use **New** for a blank document or **+ Blank** for a minimal empty composition. Application launch and **+ Demo composition** retain the explicit starter demo. [Empty Output and history contract](blank-artwork-start.md).

The left toolbar’s **Circle, Rectangle, Polygon, Star and Text** buttons add a new independent artwork layer at the document center. Each new layer has a generator → solid Fill → Output graph. Existing layers, connections, paint, visibility, locks and assets stay intact, including when the previously active layer is hidden or locked. Creation is one Undo step. The pure creation helper also supports Ellipse; Ellipse remains available through graph node creation rather than a separate toolbar button.

**+ Add node** adds an unconnected node to the current layer’s graph. **+ Demo composition** adds the existing starter Boolean example. **Pen / Curve** now previews and commits a new independent Curve → Fill → Output layer. Enter, Escape or Finish path finishes open; clicking the first anchor closes. Cancel path discards the detached draft. See [Pen lifecycle and limits](pen-artwork.md). Blank compositions keep the existing one-layer/one-graph model; no scene/group model is added.

## Two explicit edit targets

- Click rendered artwork or its Layers row to select **Artwork · layer name**. Its dashed box represents the final evaluated Output. Graph card order never selects a source or decides how artwork moves.
- Click a graph card title to enter **Node · node name · before downstream nodes**. The dashed source outline, narrow stroke-only hit corridor and **Move node stage** marker edit that explicit node or selected generator set. Dimension, Transform, point, position-controller and character handles retain their own source-stage semantics and higher hit priority.
- Click empty artboard space to clear selection. Dragging empty space never moves the previously selected generator or artwork. Space/middle drag remains view navigation.
- Selection, view changes and editor overlays do not change JSON or exported artwork. Undo/Redo restores the selection associated with independent artwork creation.

## Whole-artwork deletion

Use **Delete layer** in a Layers row, or select artwork and press **Delete** with the artboard focused. One Undo restores the entire layer, graph, paint order and selection. Locked layers reject; hidden, guide and empty layers can use the explicit row action. Surviving layers, settings and assets are retained. The final layer becomes an intentional empty Output, preserving the document. Live Pen drafts and active edits disable deletion. [Deletion and focus contract](artwork-layer-deletion.md).

## Supported whole-artwork movement

Artwork drag and focused-artboard Arrow keys use the same conservative resolver. The supported graph is one Circle/Ellipse/Rectangle/Polygon/Star or unattached Text → solid Fill → Output, optionally with one existing Transform immediately before Fill. Direct Curve → solid Fill → Output and Image → Image Output are also supported. Disconnected nodes do not affect target choice.

Dragging translates the final artwork in artboard units through the current canvas transform. Hold Shift to constrain one axis; release Shift to move freely. Existing snapping and Alt bypass apply to pointer placement. Arrows move 1 document unit, or 10 with Shift, without snapping and independently of zoom. Each accepted keydown is one Undo step. Character editing takes priority. Fields, IME, dialogs, graph focus and active gestures do not invoke artwork nudging.

A terminal Transform edits only its Offset in final artboard axes, including under rotation and negative scale. Direct shapes edit Center; direct Text/Image edit Position. Direct Curve moves all authored anchor Positions by one common delta, retaining relative handles, modes and closure. Its full ordered point IDs and all literal/unlocked Positions must remain valid. Whole-artwork Curve movement supports up to 128 anchors; larger curves show a reason and retain existing graph source editing, Save and export without truncation. No node is inserted and no input is disconnected. See [Curve placement boundaries](pen-artwork.md).

Other graphs remain selectable with a visible movement-unavailable reason. In particular, Boolean, Repeater, Remap, extra paint stacks, gradients, Type on Path, output-affecting non-path dependencies, bypassed routes, empty output and locked/driven positions are outside the safe capsule. Gradient coordinates are artboard-space, so moving geometry alone would change its paint.

A completed pointer drag is one Undo step. Exact no-op/out-and-back gestures create no history. Escape, pointer cancellation, capture loss and window blur roll back the entire gesture. The target is resolved again during preview and before commit; an invalidated target is cancelled.

## Verification boundary

Core tests cover six creation-helper types, atomic rejection, prior-layer/asset preservation and exact supported/refused movement routes. Synthetic DOM tests cover five toolbar tools, scope separation, placement, 1/10-unit nudging, no-op/cancel history, selection restoration, busy/focus/IME exclusions and capacity failure. Actual Chrome acceptance includes creation/export/reopen, final-artwork movement through terminal Transform, another-layer dragging, read-only reasons, source-stage handle priority and 1280×800 / 1600×1000 screenshots. Windows CI is the actual-browser and native packaging gate; synthetic DOM is not rendering proof. Native WebView2/IME and native file-dialog acceptance remain separate gates.

## Independent copy in place

Select final artwork and choose **Duplicate in place** in the Inspector to create an independent layer immediately above its source, at exactly the same coordinates. Initial support requires the entire layer to match a supported movement route, with no extra nodes; Curve is limited to 2–128 anchors. Undo restores the prior selection and Redo restores the same copy IDs. Active edits block the action. See the [full duplication contract](artwork-duplication.md).

## Safe layer ordering

Use each Layers row's **Forward / Backward** to move that exact layer one paint position. This preserves the current selection and every graph/asset record; it is independent of whole-artwork movement eligibility. Locked targets and active edits are blocked. See the [full ordering contract](artwork-layer-ordering.md).

Independent artwork multi-selection: Shift-click canvas artwork or Layers names, then drag a selected member or use focused-artboard arrows to translate the entire set in one Undo step. Any unsupported member blocks the complete move with a named reason. See [practice sample and operation contract](multi-artwork-movement.md).
