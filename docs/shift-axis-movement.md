# Shift-constrained artwork movement

Hold **Shift** while dragging artwork to restrict movement to an artboard horizontal or vertical axis. The first movement of at least **3 screen pixels** chooses the larger absolute artboard displacement (an exact diagonal chooses horizontal). The chosen axis stays fixed while Shift remains held, even if the pointer crosses the other diagonal or reverses direction.

- Release Shift to restore free movement from the gesture's original pointer position. Press Shift again to choose the dominant direction of the current total displacement. Key changes refresh the preview immediately; they do not start another history edit.
- Snapping still works along the allowed axis. The perpendicular coordinate stays exactly at its original value, and no misleading perpendicular snap line appears. **Alt+Shift** disables snapping while retaining the axis constraint.
- Zoom and pan change the view, not the artboard axes or the screen-space activation threshold. Source controls retain their existing meaning before downstream geometry transforms. Character editing constrains the displayed output delta before converting it back into local character XY, so rotated/scaled text still moves along the visible artboard axis.

## Supported movement

- Selected shape generators, including Text/Image Position, Circle/Ellipse/Rectangle/Polygon/Star centers and whole Curves; selected generator groups retain their relative positions.
- One selected Transform's Offset (move the group).
- Null Position and explicitly enabled Vector canvas-position handles.
- Curve and Path Remap anchors and existing Bézier handle movement.
- Selected characters in Character position mode. Shift-click continues to add/remove characters. Shift-drag on an already selected character preserves and moves the current selection; removing that character is deferred until a click with no drag. Ambiguous overlapping instances still use the existing chooser.

A completed gesture is one Undo step. Escape, pointer cancellation, lost capture or focus loss restores the document snapshot. Shift-click jitter does not modify the model; returning to the starting value without a snap creates no history. Composition/parameter locks, connected inputs and expressions remain read-only. Canceling a selected-character Shift-drag does not apply its deferred deselection.

## Unchanged gestures and storage

This is artwork movement, not node-graph layout movement. Graph node Shift-click selection, graph panning, artboard Space/middle panning, guide drags, numeric scrubbing, resize and Transform scale/rotation retain their existing behavior. Shift rotation still snaps to 15°. Pen creation is unchanged.

The selected axis is transient gesture state. It adds no JSON properties, schema change or export metadata. Editable JSON saves the actual source coordinates; SVG uses the same evaluated geometry as before.

## Verification

- `tests/axis-drag.test.js`: threshold, stable direction, reverse/cross-diagonal movement, release/repress and artboard axes under screen transforms.
- `tests/axis-drag-dom.test.js`: shared controllers/generators/Transform, grouped positions, Curve/Remap anchors, rotated multi-character editing, snap-axis filtering, locks/drivers, exact history and cancellation.
- `tests/axis-drag.e2e.js`: real Chromium modifier keys and pointer capture, allowed-axis snapping, immediate Shift toggles, pan/zoom, transformed multi-character selection and cancellation. It runs in the full browser CI suite.

Synthetic DOM checks alone are not proof of browser or native WebView2 interaction. Native Windows acceptance remains a separate step.
