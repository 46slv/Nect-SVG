# Null Position controller prototype

Add **Null** from **+ Add node**, or open [the editable sample](../examples/null-position-reuse.json). Select its graph card to show a small crosshair on the artboard. Drag the crosshair to change its Position. Clicking elsewhere on the canvas does not move it. Only the selected Null is shown, keeping unrelated controllers out of the artwork.

## Position contract

- Null has one Vector2 input, **Position**, and one default Vector2 output labeled **Position**. It creates no Path, paint, SVG element, or PNG mark. The crosshair belongs exclusively to the editor overlay.
- The output is the evaluated Position, with the normal priority: connected source, then expression, then direct XY fallback. It can drive Text Position, shape Position/center, another Null or existing Vector Math / Separate Vector / Combine Vector inputs.
- Coordinates are source artwork coordinates before downstream Transform, independent of zoom and pan. A transformed follower can therefore be displayed elsewhere; the Null never guesses a post-Transform position or silently edits an upstream controller.
- Use Vector Math to add an offset, or Separate/Combine to share one axis. There is no implicit parent, rotation, scale, grouping or Reference node in this experiment. The separate [opt-in Vector handle](vector-position.md) uses the same point interaction and snap implementation while retaining the existing Vector Value contract.

## Editing and safety

The crosshair stays the same screen size through zoom. Its center is the snap anchor, using the existing visible guides, artboard/grid options and visible guide-layer bounds. Alt bypasses snap. Snapping writes the current coordinate and does not create a persistent dependency on the guide.

Only the crosshair starts a Null drag. A click or tiny pointer jitter changes no model/history. One completed drag adds one Undo entry; Escape, pointer cancellation, capture loss and window blur restore the pre-gesture model. Space/middle drag retains navigation priority and changes only the view. A typed Position draft commits before a canvas gesture and keeps its own Undo entry.

A connected, expression-driven or parameter-locked Position shows a gray read-only marker. Locked compositions prevent editing too. Dragging does not disconnect inputs, replace expressions, change fallbacks or write through to a source. Hidden compositions show no marker. Multiple selected graph cards do not create a group move through this dedicated handle; it edits the active Null only.

## Persistence and compatibility

Null uses the existing node ID, parameter, connection, duplication, deletion and history formats. Its single default output does not store a new named source port. The sample uses schemaVersion 2; projects with character offsets remain schemaVersion 3. Older v1/v2/v3 documents continue to load. Older builds that do not know Null reject the unknown node rather than silently removing it; backward reading of this new node is not promised.

Duplicate creates an independent controller and does not redirect existing followers. Normal deletion disconnects followers and restores their saved expression/direct fallback; Undo restores the controller and connections. Self/indirect cycles and incompatible sockets are rejected atomically.

## Verification

`null-position.test.js` covers evaluation, source priority, cache invalidation, typed connections/cycles, persistence, invalid files and identical SVG with/without an unused controller. `null-position-dom.test.js` covers UI drag ownership, CTM mapping, snap/Alt, interruptions, one-step history, navigation, locks, input protection, duplication and deletion. `null-position.e2e.js` exercises actual Chrome and saves JSON/SVG/PNG plus editor screenshots in the Windows development artifact.

Local synthetic DOM tests do not substitute for actual browser capture/layout behavior. Local Chromium has a known socket EPERM restriction in this environment; real Chrome and installer verification are established by the exact published commit's Windows workflow, not by the existence of this document.
