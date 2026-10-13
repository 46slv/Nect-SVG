# Verification record

2026-10-13, initial operable vertical implementation.

## Passed

- `npm test`: 25 tests across core, strict SVG import and synthetic DOM integration.
- Real cubic Bézier Boolean four operations and hole area; Curve handles; downstream Path output.
- Typed socket connection, cycle rejection, fallback/expression restoration, locked-edge reload.
- Safe Remap suspension after changed Boolean geometry; stable identity through Transform.
- JSON roundtrip, malformed version/type/IDs/positions rejection, transaction rollback and undo/redo.
- Headless Text outline counter preservation with licensed DejaVu Sans.
- Synthetic DOM: initial render, parameter propagation, undo, socket connect/disconnect, layers, saved reload, invalid-load preservation.
- `npm run build`: production bundle succeeds.

## Local execution boundary

Real Chromium test script exists in `tests/editor.e2e.js`, but no browser assertions ran in this environment. Chromium exits before opening a page because its process singleton socket receives `Operation not permitted`; an escalation attempt produced the same runtime restriction. A separate available cloud browser could not reach this workspace's localhost (connection refused). No public tunnel or deployment was created to circumvent the boundary.

Windows build and Chrome results are recorded below. Native WebView2 rendering, dialogs and close/save interruption flows remain unverified. No Windows SDK was installed in the constrained shared workspace.

## Acceptance remaining

- Broader 1920×1080 and smaller-window browser layout review.
- Native Windows file durability and app interaction verification.
- Broader SVG compatibility and keyboard focus continuity review.
- V/R Converters fixture is implemented and headless-exported; interactive practical review remains.
- Incremental cache and depth bound are covered; cloud worker isolation remains.
- More geometry edge cases: tangencies, degenerate contours, extreme coordinates, text/font topology change rebind.

A passing synthetic DOM or headless test is not equivalent to a real browser or Windows pass. This initial implementation is not a release-ready product.

## Follow-on checks

The synthetic DOM pass also covers pen points/handles/closing, multi-generator movement, atomic lock rejection, Undo while drawing, rejected Output cycle and locked Output auto-routing. Own SVG export/import roundtrip, compound holes, unsafe/unsupported SVG rejection, cache invalidation and defensive isolation are tested.

`examples/vr-converters.json` is an editable practice fixture, not a final approved logo. Its headless SVG was rasterized with Inkscape and visually inspected for shapes, counters, layering and label placement. That is **output geometry proof only**, not an editor screenshot.

A bounded Windows-only GitHub Actions workflow is prepared: standard public-repository Windows runner, contents:read, 35-minute timeout, per-branch concurrency cancellation, 1-day development artifact retention, no release/deploy. Its actual build/Chrome results must be recorded after the run; configuration alone is not a pass.

## Windows CI attempt 1

Run [38426140626](https://github.com/46slv/Nect-SVG/actions/runs/38426140626) at commit `c793a278492baf06a321269629e9c7654ef4f214` failed at Prettier: Windows checkout converted text to CRLF while the repository format is LF. Installation passed. Tests, Chrome interaction and Rust/NSIS stages were **skipped**, not failed or passed. `.gitattributes` now specifies LF for text and marks binary assets explicitly. Dependency advisory status is tracked in [dependency-security.md](dependency-security.md).

## Windows CI observed success

Run [38427148348](https://github.com/46slv/Nect-SVG/actions/runs/38427148348), commit `47d7aa056993c36e255e333bba301677cc910bc5`, passed formatting, 25 tests, production build, actual Windows Chrome interactions, Tauri Rust build and NSIS packaging. The 1600×900 browser screenshot was visually inspected. The unsigned installer is 2,370,367 bytes, retained as a one-day development artifact. This proves packaging, not native WebView2 interaction. Screenshot review exposed card overlap and cramped Vector2 controls; the subsequent changes address these locally.

The follow-on tests cover typed Remap position/handle expressions, connections and fallback restoration, source-change suspension, explicit rebind and undo/redo/JSON preservation, Toggle closure, and measured card placement. Extended Chrome coverage verifies those interactions and captures initial, Remap and tall-Curve scroll layouts. Until its CI run succeeds, this extended suite is prepared rather than observed.

Run [38432755637](https://github.com/46slv/Nect-SVG/actions/runs/38432755637), commit `8acee2b10a397d5f8528c394fd028d6fa8a636f6`, passed all stages: 30 tests, build, extended actual Chrome interactions and NSIS. Initial, Remap and tall-Curve screenshots were inspected: Vector2 controls are aligned and adequately wide, new cards do not overlap, and the Curve footer is reachable. The installer is 2,370,227 bytes. Remap fields continue below the viewport and remain scrollable. The subsequent focus/unsaved-document tests require their own observed run.
