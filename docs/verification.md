# Verification record

2026-10-13, initial operable vertical implementation.

## Passed

- `npm test`: 15 core regression tests plus one synthetic DOM integration test.
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
- SVG import, multi-selection and snapping; more accessible graph connection workflow.
- V/R Converters editable logo fixture and practical flow review.
- Cross-evaluation incremental caching and bounded evaluation for future cloud adapter.
- More geometry edge cases: tangencies, degenerate contours, extreme coordinates, text/font topology change rebind.

A passing synthetic DOM or headless test is not equivalent to a real browser or Windows pass. This initial implementation is not a release-ready product.
