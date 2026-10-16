# Independent artwork duplication in place

Select final **Artwork · layer name** on the canvas or in Layers, then choose **Duplicate in place** in the Inspector. It creates one independent whole-layer copy at the exact same artwork coordinates, immediately above the source in paint order and the reversed Layers list. The new layer is named **original name copy** and selected as final artwork; focus returns to the artboard. There is no new keyboard shortcut.

## Bounded initial support

This first slice requires the complete graph to be one of:

- Circle, Ellipse, Rectangle, Polygon, Star or unattached Text → optional single existing Transform → solid Fill → Output
- Curve → solid Fill → Output, with 2–128 authored anchors
- Image → Image Output

It reuses whole-artwork movement eligibility: visible, unlocked ordinary layers; unlocked, non-bypassed route nodes; a valid nonempty visible output; literal/unlocked movement Positions; and no output-affecting non-path data connections. Every layer node must belong to that route. Disconnected extras, Reference/data branches, Boolean/Remap/Repeater graphs, gradients, Stroke, Type on Path and suspended character adjustments are outside initial support. The Inspector disables the action and explains the reason. Source graph editing, Save and export retain their existing capabilities. The Curve limit is an initial whole-artwork interaction budget, not a new model or export limit.

## Copy and transaction guarantees

The copy has fresh layer, node and authored Curve-point IDs. Its Output and every internal parameter source are remapped to the copied nodes; no connection may point outside the copy. Node/card names, order, layout, collapsed state and width are retained. All parameter values, expressions and locks, Curve closure/anchor order/relative handles/handle modes, and Text layout settings are retained.

Text-local character IDs intentionally retain their values because they are scoped to their Text node. Character offsets, transforms, typography styles, manual pair kerning, Wrap width and leading are deep independent records. Editing or moving either artwork cannot modify the other's records. Font and image asset IDs/immutable bytes are reused; duplication neither duplicates their bytes nor collects unused assets.

A pure staging helper first builds the copy and validates a detached candidate using asset-safe wrappers. Only a fully valid candidate can be inserted. The original layer and all other document objects/order/settings/assets remain untouched. Invalid records, collisions, missing assets or the 100-layer capacity reject before insertion. A document with 99 layers can accept one copy.

One Undo removes the entire copy and restores the prior selection. Redo restores the same copy with the same IDs and final-artwork selection. Artboard pan/zoom and graph zoom/scroll are retained. Existing graph-card **Duplicate** stays a node operation.

## Interruption guards

A live Pen draft, pointer gesture, wire, numeric scrub, inline rename, IME composition or open editor dialog blocks the action. A forced or stale click cannot finish/cancel the current edit, duplicate a previously selected layer, or add a history entry. Finish or cancel the current edit first.

## Verification boundary

`tests/artwork-duplication.test.js` covers every initial route, pure staging, exact copy-only SVG equivalence, source/asset preservation, global ID remapping/collisions, rich Text and Curve edit independence, 128-anchor/capacity boundaries, atomic refusal and History/JSON reopen. The actual-handler synthetic DOM suite covers final-artwork selection, one-step Undo/Redo, independent nudging, graph-node isolation, navigation and interruption/unsupported guards.

`tests/artwork-duplication.e2e.js` is registered in the full Windows browser gate. It checks all 14 supported routes, actual save/SVG/PNG downloads and cold reopen, exact copy-only pixels, pointer placement/source editing, 1280×800 and 1600×1000 affordances and busy/no-op behavior. Local Chromium launch is blocked by the environment's process-singleton socket restriction; prepared browser coverage is not a local browser pass. Exact-commit Windows Chrome/CSP/Rust/NSIS results must be observed separately. Native WebView2/IME and file-dialog acceptance remain separate gates.
