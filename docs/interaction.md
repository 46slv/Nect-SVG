# Implemented interaction contract

The approved layout is a desktop-first white and silver workspace: top file controls, left tools, upper canvas, resizable lower graph, right layers and inspector. Artboard corners remain square; UI panels and controls use rounded corners and thin borders. Exact visual QA is still pending a usable real browser.

- A canvas gesture targets the selected generator explicitly. Circle/Ellipse/Rectangle edit Center, Text edits Position, Curve edits its own points. No implicit Transform is created, and no reverse-solving of downstream Boolean results occurs.
- Parameter locks, layer locks and driven positions reject direct manipulation with a reason. The node name and composition remain visible in the canvas context.
- Dynamic sockets: unconnected inputs hidden, matching fields highlighted during output drag, connected socket shown at field left. New connection replaces old. Input drag to empty graph space and input context-menu disconnect are supported. Dropdown Path selection also provides a non-drag route.
- Node header drag changes graph layout. Graph scroll and horizontal node resize are available. Curve points expand/collapse vertically, with position, relative handles and handle modes inside the generation node.
- Pen click adds a corner; drag adds symmetric handles. Clicking the starting vertex closes; Escape finishes open. Vertex/handle editing writes the same model used by the graph UI.
- Each layer has independent output, visibility, lock, fill and ordering. New composition creates its own graph.
- Numeric expressions support +, -, \*, /, %, parentheses, pi/e and sin/cos/tan/abs/sqrt/min/max/round. No variable references or arbitrary code. Dynamic node inputs provide external values.

## Deferred interaction work

Graph minimap, node insertion onto a wire, Lazy Connect and Blender gesture compatibility have not been claimed implemented. They need focused decisions/testing, not guessed keybindings. SVG import supports a documented safe subset. Browser focus continuity and rich pointer edge cases require real Chromium verification.

## Follow-on interaction pass

- Shift-click node headers for multi-selection; dragging moves selected graph cards together. Canvas drag moves selected generator parameters atomically, refusing the entire operation if a selected position is driven or locked. It never inversely solves downstream nodes.
- Snap 8 enables canvas grid snapping; Alt temporarily bypasses it.
- Each value field has a keyboard-accessible Connect menu as an alternative to dragging.
- V/P/C/R/T select tools; Ctrl+S saves, Ctrl+O opens; focused form controls retain their normal typing. Splitter arrows resize the graph. These are app bindings, not claimed Blender compatibility.
- Canvas pointer updates are coalesced into one requested frame and redraw only canvas paths/overlays, not the whole graph. No idle animation loop or expensive blur is used.
- Undo/redo and document replacement reset transient drawing/wiring state. Output routing always uses typed/cycle/lock validation. JSON file reads reject a stale completion if editing changed during the read. Browser unload warns about unsaved changes.
