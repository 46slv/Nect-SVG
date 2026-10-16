# Blank artwork entry points

**New** starts an empty 960 × 540 document with one blank composition and one vector Output. It asks before replacing the current project. **+ Blank** in Layers appends the same minimal composition without changing earlier artwork. **+ Demo composition** remains an explicit way to add the Boolean starter example.

For compatibility, application launch still opens the starter demo. The public `document()` and `layer()` factories also retain their existing demo behavior. Use **New** for a clean work surface; this bounded change does not silently change the launch scene or old fixtures. The separate `blankDocument()` and `blankLayer()` factories are available to callers.

## Empty-output model

A blank composition opts in with the optional boolean `allowEmptyOutput: true`. Its designated terminal **Output** may evaluate to `{ contours: [] }` only when its PaintedPath input is literal null, has no source or source port, and has an empty expression. The saved schema remains version 2; existing projects without the flag keep their prior evaluation behavior.

The flag is validated strictly. It does not apply to Image Output, other Output nodes, Fill/Stroke, Boolean or arbitrary disconnected inputs. Missing Output/source IDs, wrong socket types, cycles and invalid expressions retain their diagnostics. Connecting a real source evaluates it normally; disconnecting the opted-in terminal returns to the intentional empty result. Disconnected graph nodes can be prepared while the terminal remains empty, then **Use as output** explicitly chooses the displayed route.

Empty geometry emits no path/group/paint element or selectable canvas hit. The blank canvas has no artwork box, source move marker, vertices or resize handles. Its Inspector says **Empty composition** and explains the next actions. Selecting the empty layer row does not pretend it is visible artwork. Graph Output selection remains available for explicit graph editing.

## History and existing work

- Cancelling New leaves the document, released/pressed Pen draft and history unchanged. Its confirmation happens before draft resolution.
- Confirming New first resolves Pen according to the existing contract: finish released valid points, discard a one-point draft, and roll back a currently pressed point. It then replaces the project in one Undo unit. Undo returns the resolved previous document and selection; Redo returns the blank document with no artwork/node selection.
- New does not claim a file has been saved. The last actual saved snapshot remains the dirty-state reference. A new blank document is unsaved until **Save JSON**; Undo to the unchanged last-saved document is clean, and Redo returns the unsaved blank document. The existing unsaved-close warning remains active.
- **+ Blank** first cancels any pressed edit/wire gesture before changing layer scope. Rejected append likewise retains the pre-gesture committed document. It is one Undo unit, works from hidden/locked/image contexts and preserves prior nodes, wires, Output, visibility, locks and assets. Candidate validation and the 100-layer limit run before append. Capacity or invalid-document rejection preserves history and selection.
- Circle/Rectangle/Polygon/Star/Text and Pen continue to create independent artwork from the blank scene. Undo removes only that creation and restores the exact empty selection. The initial blank layer remains available for explicit graph work.

## Persistence and verification

Save/reload retains the intentional empty composition. Empty SVG is the artboard element without content; PNG has transparent pixels at the selected export scale. Adding subsequent artwork and exporting the mixed document omits the empty layer without omitting valid artwork.

`tests/blank-artwork.test.js` covers factory compatibility, strict opt-in/cache behavior, reachable malformed graphs, empty export, candidate preservation, IDs, capacity and history. `tests/blank-artwork-dom.test.js` covers New/+Blank, dirty state, draft cancellation, selection, all toolbar entry points and explicit graph routing. `tests/blank-artwork.e2e.js` uses actual Chrome for New confirmation, open/pressed Pen cancellation, exact Undo/Redo, transparent SVG/PNG, cold JSON reopen, independent creation, +Blank capacity and 1280×800 / 1600×1000 layouts. Native WebView2, file dialogs and Windows IME remain separate acceptance gates.

[Editable blank document](../examples/blank-document.json).
