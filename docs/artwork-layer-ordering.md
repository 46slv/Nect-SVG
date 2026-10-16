# Safe one-position layer ordering

Each Layers row has **Forward ↑** and **Backward ↓** controls. Forward swaps that exact stable-ID layer with the next layer in document paint order, placing it one position nearer the front and one row higher in the reversed Layers list. Backward swaps it one position nearer the back. The control works on its own row even when another layer is selected; it never selects the row or its first graph node.

Ordering only permutes the existing layer array. It does not evaluate movement eligibility, rewrite geometry, insert nodes, regenerate IDs, change graph layout or collect assets. Hidden, guide, intentionally empty, image, gradient, Boolean, Remap, Repeater and other complex graphs can be ordered. All layer/node/parameter/character records, references, paint, font/image assets, settings and document dimensions remain exact. A locked target cannot move. An unlocked target may cross a locked neighbor because the neighboring layer record is unchanged.

An accepted adjacent swap is one Undo step. Undo/Redo restores the exact order and the existing artwork, node/multi-node, character, selected-guide and Remap-point selections. Artboard pan/zoom, graph zoom/scroll and sidebar scroll are retained. Keyboard focus stays on the exact row and direction after rendering, including when that direction reaches its boundary.

## Disabled and interrupted actions

At the front/back boundary, the corresponding control is visibly disabled and exposes `aria-disabled="true"`, while remaining keyboard-focusable. Pointer, Enter, Space and forced/stale events are enforced as no-ops by the handler, preserving both Undo and Redo. Busy/locked controls additionally use native disabled state. Accessible names identify direction, one-position scope and the layer name.

A live Pen draft, pointer gesture, wire, numeric scrub, inline rename, IME composition or open editor dialog blocks ordering. The handler checks these conditions before generic Pen auto-finish and resolves the ID/direction again at action time. Refusal never finishes, cancels or commits the edit. A pointer attempt cannot blur/commit an inline rename. Missing/ambiguous IDs and invalid directions reject without changing the document, selection or history.

This slice adds no drag reordering, front/back commands, new shortcuts, multi-layer ordering or schema change.

## Verification boundary

`tests/artwork-ordering.test.js` covers exact adjacent permutations, record/asset identity, both directions, capacity/boundary/stale/invalid/locked refusal, crossing a locked neighbor, geometry-independent graphs, History, SVG paint order and exact JSON reopen. `tests/artwork-ordering-dom.test.js` executes the actual delegated click handler, covering all selection modes, same-control focus, view retention, no-op Redo preservation, a detached two-point Pen draft and pointer/wire/scrub/rename/IME/dialog lifecycle guards.

`tests/artwork-ordering.e2e.js` is registered in the full Windows browser gate. It verifies red/green/blue overlap in actual canvas screenshots, native keyboard focus/disabled behavior, actual JSON/SVG/PNG downloads and SVG/JSON reopen, exact RGBA equality, both 1280×800 and 1600×1000 controls/screenshots, locks, complex/hidden/guide/empty records and interrupted edits. Local Chromium remains blocked by the established process-sandbox restriction; prepared coverage is not a local browser pass. Observe the exact published commit's Windows Chrome/CSP/Rust/NSIS result separately. Native WebView2/IME/file-dialog acceptance remains separate.
