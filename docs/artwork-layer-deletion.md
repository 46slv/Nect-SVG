# Undoable whole-artwork layer deletion

Use **Delete layer** in a Layers row to remove that exact composition and its complete node graph. The action identifies the row's stable layer ID, including when another layer is active. Hidden, guide and intentionally empty compositions can be removed this way. Locked layers must be unlocked first. A stale or ambiguous layer ID rejects without changing the document.

Alternatively, select final artwork by clicking its canvas output or Layers name, focus the artboard, then press **Delete**. This shortcut removes only that selected artwork layer. It does not guess a source node or use the movement resolver: gradients, Boolean/Remap/Repeater graphs, images and Curves above the whole-artwork movement budget are all removable. Graph-card **Delete** and **Duplicate** remain node operations.

## Transaction, selection and preservation

An accepted removal is one Undo step. Every other layer, graph, ordering, document dimension, setting and embedded font/image asset is retained; deletion does not garbage-collect assets. The active layer becomes the next surviving layer in document order, otherwise the previous one. Artwork, node, multi-node and character selection are cleared, and no neighbor node is automatically selected. Focus returns to the artboard, so a held or repeated Delete cannot cascade through neighbors. Undo restores the exact removed graph, layer order and prior artwork/node/character selection, selected guide and Remap point selection. Redo reapplies the deletion and cleared selection.

Removing the final layer replaces only that layer with the existing blank-composition factory: one intentional empty vector Output. It preserves the document name, dimensions, editor settings and all assets. Empty SVG export and normal artwork creation remain available. Removing a layer at the 100-layer limit frees one slot.

## Interruption and focus guards

Input fields, textareas, selects, contenteditable controls, IME and dialogs retain their own keyboard behavior. Whole-artwork Delete requires artboard focus, an explicit artwork selection and no Control/Command/Alt modifier. Repeated keydown events do not initiate removal. A selected guide retains keyboard Delete priority, including its own lock protection. Active pointer gestures, wiring, inline renaming, modal dialogs and detached Pen drafts block layer removal; the explicit layer buttons are disabled while an edit owns the state. In particular, pressing or dispatching a layer-delete action never finishes, commits, cancels or discards a live Pen draft.

## Verification boundary

The model tests cover exact survivor/asset preservation, locked and stale rejection, deterministic neighbors, complex graphs, last-layer export/history and capacity reuse. Synthetic DOM tests cover the explicit and keyboard actions, selection history, character selection, interrupted/repeated flows and unchanged graph-node actions. The Chrome suite produces before/after screenshots at 1600×1000 and 1280×800, saved JSON and SVG evidence, and tests busy/focus guards and capacity reuse. Run it with `node tests/artwork-deletion.e2e.js` against the dev server; it is also in `npm run test:e2e` and the Windows CI browser gate. Local process-sandbox restrictions may prevent Chromium from starting; a blocked launch is not browser verification. Native WebView2/IME acceptance remains a separate Windows gate.
