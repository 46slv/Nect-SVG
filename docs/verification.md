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

## Not yet observed

Real Chromium test script exists in `tests/editor.e2e.js`, but no browser assertions ran in this environment. Chromium exits before opening a page because its process singleton socket receives `Operation not permitted`; an escalation attempt produced the same runtime restriction. A separate available cloud browser could not reach this workspace's localhost (connection refused). No public tunnel or deployment was created to circumvent the boundary.

Windows Rust/Tauri build, NSIS installer, WebView2 rendering, native dialogs and close/save interruption flows remain unverified. No Windows SDK was installed in the constrained shared workspace.

## Acceptance remaining

- Real browser 1600×900 / 1920×1080 screenshot and interaction review.
- Windows build and native file durability verification.
- Broader SVG compatibility and keyboard focus continuity review.
- V/R Converters fixture is implemented and headless-exported; interactive practical review remains.
- Incremental cache and depth bound are covered; cloud worker isolation remains.
- More geometry edge cases: tangencies, degenerate contours, extreme coordinates, text/font topology change rebind.

A passing synthetic DOM or headless test is not equivalent to a real browser or Windows pass. This initial implementation is not a release-ready product.

## Follow-on checks

The synthetic DOM pass also covers pen points/handles/closing, multi-generator movement, atomic lock rejection, Undo while drawing, rejected Output cycle and locked Output auto-routing. Own SVG export/import roundtrip, compound holes, unsafe/unsupported SVG rejection, cache invalidation and defensive isolation are tested.

`examples/vr-converters.json` is an editable practice fixture, not a final approved logo. Its headless SVG was rasterized with Inkscape and visually inspected for shapes, counters, layering and label placement. That is **output geometry proof only**, not an editor screenshot.

A bounded Windows-only GitHub Actions workflow is prepared: standard public-repository Windows runner, contents:read, 35-minute timeout, per-branch concurrency cancellation, 1-day development artifact retention, no release/deploy. Its actual build/Chrome results must be recorded after the run; configuration alone is not a pass.
