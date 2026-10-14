# Implemented interaction contract

The approved layout is a desktop-first white and silver workspace: top file controls, left tools, upper canvas, resizable lower graph, right layers and inspector. Artboard corners remain square; UI panels and controls use rounded corners and thin borders. The initial 1600×900 Windows Chrome screenshot has been reviewed; layout refinements have dedicated browser assertions and screenshots.

- A canvas gesture targets the selected generator explicitly. Circle/Ellipse/Rectangle edit Center, Text edits Position, Curve edits its own points. No implicit Transform is created, and no reverse-solving of downstream Boolean results occurs.
- Parameter locks, layer locks and driven positions reject direct manipulation with a reason. The node name and composition remain visible in the canvas context.
- Dynamic sockets: unconnected inputs hidden, matching fields highlighted during output drag, connected socket shown at field left. New connection replaces old. Input drag to empty graph space and input context-menu disconnect are supported. Dropdown Path selection also provides a non-drag route.
- Node header drag changes graph layout. Graph scroll and horizontal node resize are available. Curve points expand/collapse vertically, with position, relative handles and handle modes inside the generation node.
- Pen click adds a corner; drag adds symmetric handles. Clicking the starting vertex closes; Escape finishes open. Vertex/handle editing writes the same model used by the graph UI.
- Each layer has independent output, visibility, lock, fill and ordering. New composition creates its own graph.
- Numeric expressions support +, -, \*, /, %, parentheses, pi/e and sin/cos/tan/abs/sqrt/min/max/round. No variable references or arbitrary code. Dynamic node inputs provide external values.

## Deferred interaction work

Graph minimap, node insertion onto a wire, Lazy Connect and Blender gesture compatibility have not been claimed implemented. They need focused decisions/testing, not guessed keybindings. SVG import supports a documented safe subset. Broader focus continuity and rich pointer edge cases still require further browser verification.

## Follow-on interaction pass

- Shift-click node headers for multi-selection; dragging moves selected graph cards together. Canvas drag moves selected generator parameters atomically, refusing the entire operation if a selected position is driven or locked. It never inversely solves downstream nodes.
- Snap 8 enables canvas grid snapping; Alt temporarily bypasses it.
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
