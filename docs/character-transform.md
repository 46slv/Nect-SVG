# Per-character rotation and uniform scale

Open [the editable sample](../examples/character-transform.json), select either Text and choose **Character position**. This extends the existing source-character editing mode; the text stays editable and no character nodes or font-size changes are created.

## Controls and selection

- The Inspector and nearby two-row controls expose ΔX, ΔY, **Rotate °** and **Scale ×**. Positive rotation is clockwise in Text-local screen axes. Scale is a positive uniform multiplier, from 0.01 to 100; rotation is bounded to ±36000 degrees. Reflection and collapse to zero are intentionally excluded from this first character-shape control; existing downstream negative/zero Transform values are preserved.
- Shift-click or the character list selects multiple logical characters. Typing a numeric value sets the same absolute property on all selected characters while preserving their other properties. Horizontal number dragging adds the same delta to each selected character, retaining mixed differences. Mixed values are blank with “Mixed”. Each character rotates/scales around its own pivot, rather than a shared selection bounding box.
- **Reset XY** clears selected translations only. **Reset shape** clears selected rotation and scale only. **Reset all adjustments** clears all shapes and XY for this Text and also recovers suspended source correspondence. It does not change normal text settings or downstream Transform.
- A committed numeric edit is one Undo step; an identity/no-op edit is none. Escape in an uncommitted character number field restores its prior value. Drag inside any of the four number fields to scrub after a 4-screen-pixel dead zone: XY and rotation use 1 px/degree per screen pixel; Scale uses 0.01×. Click still focuses the field for typing, and the native spinner is unchanged. Mixed selections stop as a group at the first bound. Returning to the starting value creates no Undo or schema/record change; Escape, pointer cancellation, capture loss and window blur cancel the whole numeric gesture. The floating palette stays still during its own scrub. Numeric Shift/Alt behavior is unchanged and does not invoke artwork axis locking. Existing character dragging and arrows continue to edit XY only, including after shape edits; Escape, pointer cancellation, lost capture and blur restore the whole pre-gesture record.
- The small cross marks the selected character's pivot after XY translation. It is an editing overlay, and never appears in SVG or PNG. Rotation/scale direct canvas handles are outside this slice.

## Exact geometry contract

The evaluation order is normal shaping/advances/kerning → normal line and block alignment → per-character uniform scale and clockwise rotation → local XY → downstream nodes. Existing vertical-Latin rotation/substitution happens during normal layout, before the new shape transform. Other characters and line/column advances never move as a side effect.

The fixed pivot comes from the normal-layout advance cell, not from the possibly changing outline bounds:

- Horizontal: `(glyph.x + advance / 2, glyph.y - (font.ascender + font.descender) × fontSize / unitsPerEm / 2)`
- Vertical: `(glyph.x, glyph.y + advance / 2)`

`glyph.x/y` already include normal alignment. Changing character rotation, scale or XY cannot re-center that pivot. Changing the font/size/writing mode legitimately changes normal layout and its cell. A blank character's selection cell follows its shape transform but still contributes the original advance. All contours and Bézier control points transform together; whole-Text compound paths and paint groups are preserved. Default rotation 0 / scale 1 uses the original translation-only path exactly.

Text Position, Position OUT, font size, letter spacing and line spacing remain untouched. The source local rotation/scale stays the same after a downstream Transform; the existing final-output occurrence affine still converts displayed XY movement correctly, including negative scale. Multiple output occurrences share the same source adjustment and existing instance picker. Singular/near-zero transforms and Boolean/Remap/Repeater routes retain their existing canvas gate; valid local numeric source editing remains available.

## Persistence and source edits

Shape changes lazily upgrade the Text's `characterPositions` to record version 2, adding sparse `transforms: { [unitId]: { rotation, scale } }`. Existing basis, stable Text-local unit IDs, monotonic nextId and XY offsets are preserved. Logical identity is `(Text node ID, unit ID)`, never a glyph number. Exact zero rotation plus unit scale removes that entry. All entries are finite and bounded, reference a known non-newline logical unit, and are validated transactionally.

Record version 2 requires project schemaVersion 4. Older schema1/2 projects and schema3 XY-only records still load; untouched XY-only editing continues to use record version 1/schema3. A subsequent XY edit never downgrades a schema4 document. Earlier builds reject schema4 instead of silently losing shape edits. Resetting a current-basis v2 record retains the version; recovering an unknown basis can rebuild a v1 empty record, while the project remains schema4.

Verified text edits and final composition transactions retain unaffected logical IDs and both XY/shape maps. Deleted/replaced units lose only their own adjustments. Shape-only unknown edits suspend just like XY-only edits: normal artwork remains visible, the editable JSON can be saved, and artwork export is blocked until mapping is restored or all adjustments are reset. Native IME is a separate acceptance, not implied by synthetic composition events.

## Verification boundary

- `character-transform.test.js`: pure persistence, bounds/atomicity, separate resets, shape-only IDs/composition/suspension, horizontal/vertical Japanese/Latin command-level geometry, counters, exact identity compatibility, whitespace, schema roundtrip/history, downstream/shared provenance, paint grouping and export gate
- `character-transform-dom.test.js`: mixed fields, one Undo, no-op/draft Escape, distinct resets, all existing XY cancellation routes under negative downstream scale, locks, old XY upgrades, suspended recovery and unsupported-route numeric editing
- `numeric-scrub.test.js`, `character-numeric-scrub-dom.test.js` and `character-numeric-scrub.e2e.js`: bounded mixed deltas, actual floating/Inspector inputs, typography units, live geometry, click/type/arrows, precise cancellation/no-op/history, locks and screen-pixel behavior; see [numeric drag contract](numeric-scrubbing.md).
- `character-transform.e2e.js`: real-Chrome controls, floating commit, transformed drag Escape, mixed edits, save/reload, SVG/PNG output, horizontal/vertical/Japanese screenshots and verified text insertion; included in Windows CI's aggregate suite

Local unit/DOM/build results and exact-commit Windows Chrome/package results must be reported separately. The local execution sandbox's known Chromium socket restriction is unchanged. Actual Windows/WebView2 Japanese IME conversion, cancellation and commit remain manual acceptance.
