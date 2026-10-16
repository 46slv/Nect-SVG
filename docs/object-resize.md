# Direct Shape dimensions and Text font size

Open [the editable rectangle sample](../examples/object-resize.json), then drag the labelled Width or Height square on the artboard. Select one generator to edit its own parameters. No Transform node is created, and downstream nodes are not solved backward.

- Rectangle / Ellipse: independent Width and Height. The existing Position reference remains fixed. Origin/center dimensions expand both sides; left/top anchors expand positively, right/bottom anchors negatively. Legacy signed sizes retain their signs while their displayed magnitudes change. Dimensions clamp at zero and can grow again.
- Circle / Polygon: Radius ruler, horizontal drag. Circle can reach zero; Polygon has a 0.01 minimum. A legacy negative Circle radius initially renders as zero and can recover by dragging outward.
- Star: horizontal Outer radius and vertical Inner radius rulers. Each stays within the sibling radius, considering both its evaluated value and saved fallback so the document remains reloadable even when the sibling is driven.
- Text: horizontal Font size ruler. This changes the existing scalar Size in document units, with a 0.01 minimum; it does not introduce a text-box width, change position, spacing, alignment, character offsets or character transforms. The existing Text Position reference continues to apply, including vertical text.

Radius and Font size squares are parameter rulers based at the evaluated generator Position, not claims to an exact glyph or polygon boundary. Width/Height handles sit along their corresponding reference axes. Tiny dimensions have a 40-screen-pixel minimum handle distance so collapsed artwork stays editable. Drag deltas are measured from the press point; this padding does not cause an initial jump. Controls remain constant-sized under pan and zoom, and screen-to-document mapping uses the artboard CTM.

The canvas labels, tooltips and Inspector identify the selected generator output before downstream nodes. The outline describes that same stage; a later Transform can move or rotate the final artwork elsewhere. Existing Transform Scale/Rotate controls remain the way to manipulate an already grouped/transformed path. Direct rotation is not added for generators in this change. Images, arbitrary paths and multi-selection do not gain dimension controls.

Position/center is never rewritten. Locked, connected and expression-driven dimensions remain read-only; their evaluated ruler positions still display. A driven Position does not block editing a direct dimension. Layer locks block editing and hidden layers hide controls. Middle-button or Space drag pans even over a square.

Each completed gesture creates one Undo entry; an exact out-and-back or sub-three-screen-pixel click adds none. Escape, pointer cancellation, lost capture and blur restore the pre-gesture document. Unrelated pointers and Delete/history/tool/file shortcuts cannot interrupt an active gesture. A focused numeric draft commits before capturing the gesture snapshot and remains a separate Undo entry. Dimension gestures do not use translation snapping.

No schema change or saved control state is introduced. JSON saves the existing parameters; SVG and PNG use evaluated artwork without the editor overlays.

## Verification

- `object-resize.test.js`: dimensions, signed/zero recovery, exact no-op, reference directions, connection/expression precedence, stage independence, Star driven-sibling save/reload invariants.
- `object-resize-dom.test.js`: actual UI pointer path, all six generators, per-axis values, fixed positions, affine CTM, locks/drivers, one Undo, cancel/blur/capture/Escape, pointer ownership, shortcut isolation, pan priority, hidden/multi-selection gating and SVG isolation.
- `object-resize.e2e.js`: Chrome interaction, numeric-draft history, cancellation, no-op, pan priority, locks/drivers, Text font size and editor screenshot. Included in the Windows browser suite.

Local unit/DOM/build verification does not establish browser or native acceptance. Chromium launch in this cloud executor is blocked by the sandbox's socket restriction. Exact published-commit Windows Chrome, packaging and native high-DPI/WebView2 acceptance remain separate checks.
