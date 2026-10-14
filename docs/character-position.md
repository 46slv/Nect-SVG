# Character position prototype

One editable Text stores independent local X/Y offsets. No character nodes or layers are created. Open [the editable sample](../examples/character-position-prototype.json), select either Text, and choose **Character position** in the Inspector.

## Editing

- Click a displayed character and drag. Shift-click adds/removes members of the same Text. The box includes all its contours and holes. Spaces have advance-cell targets; their movement does not change the following text's advance.
- Overlapping characters/instances open an explicit choice. Once chosen, a subsequent drag targets that choice. Shift-click opens the choice again. The Inspector's character list also selects difficult targets.
- Nearby ΔX/ΔY and Inspector fields edit the same source values. Mixed selection values show “Mixed”; setting one axis preserves each character's other axis. **Reset XY** clears selected offsets; **Reset shape** clears selected rotation/scale. **Reset all adjustments** clears both and also recovers a suspended text mapping.
- In the focused artboard, arrows move 1 artwork unit in displayed axes; Shift moves 10. Fields retain native keyboard behavior. Dragging snaps in displayed coordinates; Alt bypasses snapping. Space/middle drag keeps navigation priority.
- Escape during a drag, pointer cancellation, lost capture or window blur restores the pre-gesture model. Escape when idle leaves Character position. Selection clicks and pan/zoom create no document history. Each completed drag or field edit adds one Undo entry.
- **Edit text** focuses the ordinary textarea. Beforeinput ranges preserve identities outside verified edits, including repeated letters, line breaks and a final composition transaction. Draft input does not commit each keystroke. Unknown edits retain active offsets in a suspended state rather than attaching them to guessed characters. Undo, restore the original content or Reset all resolves this state.

## Position and output contract

Layout order is normalization, normal shaping/advances/kerning, line/column alignment, block alignment, then optional character rotation/uniform scale around a fixed advance-cell center, then independent character translations. The adjustments never re-anchor the block. Other characters, Text Position and Position OUT stay fixed. Pixel offsets remain the same when font size or writing mode changes. Local X is right and local Y is down, before downstream transforms, including for rotated vertical Latin glyphs.

Final-output occurrence metadata follows Text → Transform / Join Geometry → Fill / Stroke / Output and the existing passthrough Convert to Path / Text to Path nodes. Transform anchors, nested transforms and negative scale use the same affine order as geometry. The chosen occurrence's inverse linear transform converts displayed movement to source offsets. The same Text in several branches is a shared source: editing it affects every occurrence, with an explicit count and instance choice.

Boolean, Path Remap and Geometry Repeater outputs disable direct canvas editing with a reason. Singular/near-zero transforms and unrendered Text have no misleading original-position overlay. Local numeric editing remains available when source character correspondence is valid. Layer locks prevent edits; a locked/connected Text Position does not lock independent character offsets.

Whole-Text CompoundPaths and paint groups are retained. Glyph outlines/bounds are runtime editing data, not extra painted elements. SVG/PNG/headless output uses the same adjusted outline geometry; overlays never export. Text Position's isolated cache does not depend on character offsets.

## Persistence and bounded support

An XY-only Text's optional `characterPositions` record contains version 1, normalized `basis`, stable Text-local `{id,text}` units, sparse bounded XY `offsets`, and a monotonic `nextId`. Identity is `(Text node ID, unit ID)`, not an array index or font glyph ID. Whole-node duplication preserves independent copies. Evaluation never allocates persistent identity; first nonzero adjustment does so in the document edit.

Documents containing XY-only v1 records use schemaVersion 3. Character shape edits add record version 2 and schemaVersion 4, with all earlier formats still readable. See [rotation and uniform scale](character-transform.md) for pivot, separate resets and compatibility. Older v1/v2 files still load unchanged; older builds reject v3 instead of silently losing positioning. Offset values are finite and bounded to ±100000 px. Records with duplicate IDs, invalid basis reconstruction, unknown/newline references or invalid vectors are rejected transactionally.

Horizontal editing is limited to Japanese/Latin plus neutral characters whose emitted glyph count **and ordered glyph identities** match the normalized source. Existing typography options are unchanged. Vertical editing uses the existing explicit per-character layout. General bidi/complex shaping/ligature clusters are not claimed supported. If active adjustments cannot be mapped, normal text remains visible with a suspension warning, the editable project can be saved, and visible artwork export is blocked until corrected/reset.

## Verification

Automated coverage is in `character-identity.test.js`, `character-position.test.js`, `character-position-dom.test.js`, and `character-position.e2e.js`. The Chrome suite saves horizontal/vertical screenshots plus editable JSON, SVG and PNG evidence in the Windows development artifact.

Synthetic composition tests verify event/transaction handling only. Native Japanese IME conversion, composition cancellation and commit in Windows/WebView2 require a separate interactive acceptance. Local Chromium is unavailable in the current execution sandbox (known socket EPERM); actual browser evidence must come from the Windows workflow. A successful build is not native IME acceptance.
