# Artwork bounds snapping

Enable **Snap** in the canvas toolbar, then **Guides → Snap artwork**. The new checkbox is off by default, including older saved documents where the optional `editor.snapArtwork` field is absent. The setting is saved and undoable; it does not change exported artwork.

## Targets and coordinates

- Targets are the final evaluated geometry bounds of other visible regular composition layers: left / horizontal center / right and top / vertical center / bottom. Text uses outline bounds after its layout and downstream transforms. Images use their full rectangular extent, including transparent pixels.
- Geometry bounds exclude stroke width. Curved outlines use their actual evaluated axis-aligned bounds, not just control-point coordinates. A rotated shape contributes the edges/centers of its axis-aligned bounds, not rotated edges or individual vertices.
- Locked visible layers remain useful fixed targets. Hidden, invalid/error, empty, and suspended-character outputs are excluded. Guide layers remain a separate guide-target category, controlled by Snap guides and Show guides; they never become artwork targets or export.
- The entire current editing layer is excluded, even when editing one node or one character. Nect-SVG connections are layer-local, so this also excludes dependent text/shapes driven by a dragged Null or Vector. No same-layer target graph or cross-layer dependency is introduced.

## Gesture behavior

The existing moving sources remain unchanged: generator bounds for regular shape/text/image moves, points for Curve/Remap/pen and Null/opted-in Vector, and the selected character bounds in character mode. They all use the same translation snap. Numeric typing and scrubbing do not snap. Transform scale/rotation handles keep their own existing behavior.

The nearest explicit candidate within six **screen pixels** wins on each axis, independent of zoom and pan. For equal distances, the fixed priority is manual guide, guide-layer bounds, artboard, then artwork bounds, including ties across different source anchors. Remaining equal candidates retain document/guide order and left/center/right source order. Grid is a fallback only when no explicit target is within range. Hold Alt to bypass. A multi-generator selection receives one rigid translation.

Temporary alignment lines use `data-snap-kind="artwork"`; they are canvas editing aids and never enter SVG or PNG. One completed drag is one Undo. Escape, pointer cancel, lost capture and blur keep the existing rollback contract.

## Cost and invalidation

A normal UI render already evaluates all layers. The snap target collector consumes those results once and stores only finite coordinate bounds. Pointer moves reuse this snapshot and perform no additional layer evaluation or bounds construction. During canvas-only updates, only the active (excluded) layer can change. Selection changes, target edits, visibility, guide conversion, settings, Undo/Redo, load and completed font loading trigger a full render and refresh the snapshot. Guide coordinates themselves are read live.

## Editable example and tests

Open `examples/artwork-bounds-snapping.json`. Drag the blue circle's Null crosshair near the locked gray card's edges or center (X 400 / 490 / 580, Y 160 / 250 / 340), the TYPE outline, or the red image. The circle follows its existing explicit connection. Hide a reference, hold Alt, and undo to compare.

`tests/artwork-snap.test.js` covers settings compatibility, actual shape/text/image bounds, transforms/stroke exclusion, eligibility, source exclusion, ties, six-screen-pixel tolerance and collecting 99 targets once before 1,000 snap calls. The DOM suite verifies UI invalidation, existing controller/shape flows, drag interruption/history, numeric isolation, and no extra evaluation or collection per move. The Chrome suite covers real bounds/drag/pan/zoom, persistence and SVG/PNG, saving screenshots and editable evidence in `test-results`.
