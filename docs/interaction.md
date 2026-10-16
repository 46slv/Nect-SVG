# Implemented interaction contract

The approved layout is a desktop-first white and silver workspace: top file controls, left tools, upper canvas, resizable lower graph, right layers and inspector. Artboard corners remain square; UI panels and controls use rounded corners and thin borders. The initial 1600×900 Windows Chrome screenshot has been reviewed; layout refinements have dedicated browser assertions and screenshots.

- A canvas gesture targets the selected generator explicitly. Circle/Ellipse/Rectangle edit Center, Text edits Position, Curve edits its own points. No implicit Transform is created, and no reverse-solving of downstream Boolean results occurs.
- Parameter locks, layer locks and driven positions reject direct manipulation with a reason. The node name and composition remain visible in the canvas context.
- Dynamic sockets: unconnected inputs hidden, matching fields highlighted during output drag, connected socket shown at field left. New connection replaces old. Input drag to empty graph space and input context-menu disconnect are supported. Dropdown Path selection also provides a non-drag route.
- Node header drag changes graph layout. Graph scroll and horizontal node resize are available. Curve points expand/collapse vertically, with position, relative handles and handle modes inside the generation node.
- Pen click previews a corner in a detached independent layer; drag adds symmetric handles. Clicking the starting vertex closes; Enter, Escape or Finish path finishes open. Cancel path discards it. A finished path is one Undo; one-point finish discards. During a pressed point, pointer cancellation/capture loss/blur removes that point while retaining earlier released draft points. [Lifecycle and limits](pen-artwork.md). Vertex/handle editing of an explicitly selected Curve still writes the same model as the graph UI.
- Each layer has independent output, visibility, lock, fill and ordering. New creates a blank document after confirmation; + Blank appends one intentional empty vector Output. + Demo composition and launch retain the starter demo. [Blank model, history and persistence](blank-artwork-start.md).
- Layers **Forward / Backward** swaps the exact row one paint position without changing selection, geometry or assets. Locked targets and active edits are blocked; boundary controls remain keyboard-focusable with disabled semantics and forced no-op behavior. [Safe ordering contract](artwork-layer-ordering.md).
- **Delete layer** removes its exact layer and complete graph in one Undo. Selected final artwork also supports **Delete** with artboard focus. Locks, IME, dialogs, live Pen and active gestures guard deletion; a final-layer removal retains one blank composition and preserves document settings/assets. [Whole-artwork deletion contract](artwork-layer-deletion.md).
- Numeric expressions support +, -, \*, /, %, parentheses, pi/e and sin/cos/tan/abs/sqrt/min/max/round. No variable references or arbitrary code. Dynamic node inputs provide external values.

## Deferred interaction work

Graph minimap, node insertion onto a wire, Lazy Connect and Blender gesture compatibility have not been claimed implemented. They need focused decisions/testing, not guessed keybindings. SVG import supports a documented safe subset. Broader focus continuity and rich pointer edge cases still require further browser verification.

## Follow-on interaction pass

- Shift-click node headers for multi-selection; dragging moves selected graph cards together. Canvas drag moves selected generator parameters atomically, refusing the entire operation if a selected position is driven or locked. It never inversely solves downstream nodes.
- Snap enables alignment to visible guides, artboard edges/centers, and an 8-unit grid by default; Alt temporarily bypasses it. Use Guides to configure each target and grid spacing.
- Each value field has a keyboard-accessible Connect menu as an alternative to dragging.
- V/P/C/R/T select tools; Ctrl+S saves, Ctrl+O opens; focused form controls retain their normal typing. Splitter arrows resize the graph. These are app bindings, not claimed Blender compatibility.
- Canvas pointer updates are coalesced into one requested frame and redraw only canvas paths/overlays, not the whole graph. No idle animation loop or expensive blur is used.
- Undo/redo and document replacement reset transient drawing/wiring state. Output routing always uses typed/cycle/lock validation. JSON file reads reject a stale completion if editing changed during the read. Browser unload warns about unsaved changes.

## Remap and layout refinement

- Selecting Path Remap exposes its evaluated vertices and handles on the canvas. Dragging creates/updates a per-point delta without altering the upstream generator. Each enabled point has independent Position, Handle A and Handle B Vector2 fields with value/expression/input/lock.
- Changed unstable upstream geometry suspends retained edits with a warning. Rebind is explicit to the currently identified point and undoable; saved values, expressions and connections remain unchanged. No automatic nearest-point reassignment is used.
- New node cards avoid measured existing cards. Expanding a long Curve or Remap expands graph scroll bounds. Card width is persisted separately from geometry evaluation.
- Field labels and utility actions occupy one row; Vector2 numbers occupy a full-width second row rather than wrapping around utility buttons.

## Editing continuity and replacement protection

Numeric/text drafts stay in the focused control until `change`; typing alone does not mutate history or rebuild the graph. A commit is one undo entry. Structural redraw waits for focus/pointer transitions to finish, then restores the matching graph/inspector control, draft and text selection without scrolling it. Inspector scroll is retained. Removed or disabled controls are never substituted with a different control.

Open and Import SVG ask before replacing unsaved work; Cancel preserves the project. New already requires explicit confirmation. Browser imports/open and native open remain transactional; stale asynchronous reads cannot overwrite edits made while the file dialog/read was pending. JSON stores the editable model, not the session-only undo stack. Native OS close behavior is still a Windows verification item.

Remap point checkboxes select an explicit subset for a shared Δ Position. “Move selected points” adds that delta to each selected point in one undo step; any locked, expression-driven, connected, missing or suspended target rejects the entire batch. No canvas or Blender gesture is assigned. Deselect clears only the transient selection. Undo/document replacement clears transient batch selection, while saved per-point edits remain.

## Pointer interruption and border ports

Pointer cancellation restores the document snapshot from before the active drag, clears pending wiring and redraws without adding or consuming undo/redo entries. A later pointer move or release cannot resume the cancelled gesture. Ordinary pointer release still commits one undo entry.

Graph input socket centers sit on the left card border at their value row; output sockets sit on the right header border. Disconnected inputs remain hidden, and Inspector sockets retain their inline placement. Expanded hit targets follow the socket elements, and wires use their measured centers. Cards allow their ports to overflow visibly; the graph keeps a margin around zero-position cards. A dedicated bottom-right drag handle retains horizontal resizing, while the outer graph viewport retains scrolling for tall Curve and Remap cards.

## Collapsed nodes

The title's triangle collapses or expands a node without changing its name, width, position, selection or geometry. Collapsed cards keep their output and connected input ports, with 24 px between input centers. During output dragging, compatible disconnected inputs appear temporarily so a collapsed node can be connected or rewired directly. Cancellation hides those temporary targets again. Port tooltips identify their parameter keys and types; right-click and input dragging still disconnect.

Expansion restores parameter editing and the session's per-point disclosure state. The optional Boolean `collapsed` field is saved in schemaVersion 1 JSON; older files without it open expanded. It is editor state excluded from the evaluation cache key. Collapse/expand is one undoable change and obeys the composition lock.

## Text fonts and direction

Text nodes and their Inspector expose multiline content, a shared project-font dropdown, Load TTF / OTF, and Horizontal/Vertical direction. Letter spacing and line/column spacing are typed parameters. Font load preflights a candidate and commits one undo step; cancellation, errors, locks and stale reads preserve the document. The license/embedding notice appears next to the picker. See [typography](typography.md) for origins, supported glyph behavior, persistence, limits and headless parity.

## Guides and alignment

Open **Guides** in the canvas toolbar to add horizontal (Y) or vertical (X) guides at the artboard center. Edit their numeric positions, drag a visible guide, select/delete it, or lock it individually. Delete removes the selected guide when focus is outside a text/number input. Escape or a cancelled pointer gesture restores the pre-drag document. Each completed drag is one Undo step.

Show guides and Lock all guides are independent. Hidden guides do not attract snapping. Locked guides remain snap targets but cannot be moved or deleted. Guide editing is independent of composition locks. Grid display is independent of grid snapping; spacing is configurable from 1 to 10000 document units. A maximum of 200 guides is supported, with positions between -100000 and 100000 units.

Snapping uses a six-screen-pixel threshold at every zoom. Visible guides and artboard edges/centers take priority over the background grid. The selected generators' combined bounds provide left/center/right and top/center/bottom anchors; movement applies one rigid translation, preserving their spacing and source parameters. Curve points and handle endpoints also snap. Pink lines identify the active targets while dragging. Connected, expression-driven and locked source parameters retain their existing protections. Graph nodes and wires do not snap to canvas guides.

Guides, visibility/lock settings, grid settings and snap toggles are saved in project JSON and participate in Undo/Redo. Older schema-v1 documents without editing-aid settings remain valid and start with snapping disabled and an 8-unit grid. Editing aids never appear in exported artwork SVG.

### Guide layers

In Layers, click **◇** beside a composition to turn it into a guide layer. Its button becomes **Guide** and its canvas artwork becomes a faint cyan dashed reference. Click **Guide** again to restore ordinary artwork. This is undoable and saved in JSON. Guide layers keep their editable node graphs, names, fill, ordering, independent visibility, and layer locks. Unlock a layer before converting it. **Show guides** hides both guide lines and guide layers; **Lock all guides** locks guide lines, while guide layers use their own layer lock.

Visible guide layers provide edge/center snap targets for other compositions. The active composition never snaps to itself. Hidden layers do not attract snapping. Guide layers are always excluded from SVG and headless CLI exports, even when visible; an error in a guide layer cannot block artwork export.

### Layout grids

In **Guides → Layout grid**, set Columns, Rows, Margin X/Y and Gutter X/Y. Margins apply equally to both sides of the artboard. Columns/rows accept integers from 1 to 40; margins/gutters are nonnegative document units. Cells must have positive space after margins and gutters. Zero gutters share a single boundary guide.

Enable **Preview layout** for orange, non-exporting proposal lines. Preview and draft changes do not edit the document or add Undo steps. **Create layout** generates one set of guide lines in one Undo step; **Update layout** replaces that set, preserving every manual guide. **Remove layout** removes only the generated set. Cancel, closing Guides, loading a document, or Undo/Redo clears the proposal. Layout guides carry a ▦ marker in the list and can be moved like manual guides; updating regenerates their positions from the controls. Unlock individually locked generated guides before replacing/removing their set. The combined manual/layout limit is 200 guides.

Generated guides are fixed document coordinates. After changing artboard dimensions, use Update layout to regenerate them for the new artboard. Layout grids are alignment references, not automatic object placement or responsive layout containers.

## Transform scale and rotation handles

Select one existing Transform to show its fixed Anchor + Offset pivot, uniform Scale square and Rotate circle. Controls and dashed geometry explicitly show **Selected Transform output**, before downstream nodes. They do not impersonate an arbitrary final-output branch. Scale remains Scalar, including negative/zero values; Shift snaps Rotation to 15°. Only the chosen scalar changes. Existing canvas translation still edits Offset. Read-only parameters, focus commit, single-gesture history, no-op precision and cancellation follow [the Transform handle contract](transform-canvas-handles.md). Handles never export.

## Artwork bounds snapping

Guides → **Snap artwork** optionally aligns canvas moves to other visible layers’ final geometry edges and centers. It is off by default; locked references remain targets, while hidden/error/empty outputs and the whole editing layer are excluded. Bounds do not include stroke width. The same six-screen-pixel threshold, Alt bypass, single-gesture Undo and pan priority apply. See [the contract and example](artwork-bounds-snapping.md).

## Vector2 Reference

Add **Reference**, choose a same-layer Vector2 source/output in its card or Inspector, then wire the Reference output normally. Names are labels; IDs keep the link through renames. Target/value/error labels remain visible in collapsed cards. **Jump to source** selects and reveals the source, including in locked layers. Deleted targets remain explicitly missing until Undo or retargeting; no zero or cached fallback is shown as valid. Shift-select source and Reference graph headers, then **Duplicate** to remap their internal link as one Undo step. Edited Path Remap + source group copies are refused to preserve point bindings. [Usage, scope and sample](vector-reference.md).

## Shift-constrained artwork movement

Shift-drag chooses and holds the dominant artboard axis after 3 screen pixels. Release Shift for free movement; repress it to choose again from the total gesture delta. Snapping applies only on the allowed axis, and Alt bypasses snapping without disabling the constraint. Shift-click character and graph selection remain available. Graph layout, pan, rotation and resize behavior are unchanged. See [supported targets, cancellation and tests](shift-axis-movement.md).

## Character and typography number dragging

Drag inside the floating or Inspector **ΔX**, **ΔY**, **Rotate °** and **Scale ×** fields to adjust them. Selected character size, width, vertical scale, tracking and baseline shift, plus manual leading and Wrap width, use the same transaction. Click still permits typing; the native spinner remains available. A mixed selection receives a common delta instead of being flattened to one value. Each successful gesture is one Undo; jitter, returning to the origin and motion blocked at a bound are no-ops. Escape, pointer cancellation, capture loss and window blur roll back. See [units, bounds, protections and verification](numeric-scrubbing.md).

## Independent view navigation

See [View navigation](view-navigation.md) for researched conventions, controls, limits and verification boundaries. Both displayed percentages are actual CSS-pixel scales. Artboard Fit follows viewport/splitter resize; manual zoom preserves actual scale and the world point at the view center. Graph fitting measures actual card heights/widths and reserves port overflow. Fit all/selection never rearranges or collapses cards. Reset view is explicitly 100% at the nonnegative graph origin.

Navigation changes only view state, leaving model/history/export unchanged. Pointer view-button clicks focus their viewport for immediate Space-drag; keyboard activation retains button focus and native Space activation. Navigation shortcuts are scoped to focused views/their controls. Text/IME, form fields, Guides, floating character controls and dialogs are exempt. Active edits/wires/scrubs block competing navigation, including native scrolling beneath a captured graph pointer. The actual `.right` sidebar scroll position and focused viewport survive structural renders.

Independent artwork multi-selection: Shift-click canvas artwork or Layers names, then drag a selected member or use focused-artboard arrows to translate the entire set in one Undo step. Any unsupported member blocks the complete move with a named reason. See [practice sample and operation contract](multi-artwork-movement.md).
