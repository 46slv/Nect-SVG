# Character position editing: research and prototype contract

Status: research and prototype contract, 2026-10-14. The user approved researching this direction and trying an implementation. This contract was written before source implementation; the resulting prototype and verification limits are described in [Character position](character-position.md). Acceptance conditions below define the target and are not, by themselves, claims of observed passes.

## Decision

Keep one editable Text node. Add a **Character position** mode that selects and moves characters on the displayed artwork, with a small nearby control and the existing right Inspector. Store reversible per-character X/Y offsets inside that Text, not in separate layers or one node per character.

The prototype moves a selected character's rendered outline after ordinary text layout. It does not change the following characters' advances. Tracking, automatic kerning and whole-Text Position remain separate controls. The prototype does not add per-character rotation, scale, animation, manual pair kerning, wrapping, a paragraph frame, or a new general shaping engine.

The decisive usability requirement is **editing where the text is displayed after supported downstream transforms**. Adding handles at the original generator position would not solve the user's concern.

## Evidence from existing tools and standards

These are documented facts, followed by design implications. Documentation alone does not establish runtime parity, nor does it specify how every application preserves adjustments after arbitrary content edits.

| Source                                                                                                                                                                              | Documented behavior                                                                                                                                                     | Implication for this prototype                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Illustrator Touch Type](https://helpx.adobe.com/illustrator/using/tool-techniques/touch-type-tool.html)                                                                            | A character can be selected directly, then moved, rotated or scaled using its bounding box. Overlap is permitted.                                                       | Use a character box and direct movement. Rotation/scale can be separate later work.                                                                                        |
| [Illustrator line and character spacing](https://helpx.adobe.com/illustrator/using/line-character-spacing.html)                                                                     | Baseline shift, pair kerning and range tracking are distinct controls.                                                                                                  | Do not call independent XY movement kerning or tracking.                                                                                                                   |
| [Illustrator text transformation](https://helpx.adobe.com/illustrator/desktop/design-with-text/edit-format-text/transform-text.html)                                                | Type orientation, character transformation and whole-object transformation are distinct operations.                                                                     | Separate writing mode, glyph orientation and downstream transform coordinates.                                                                                             |
| [InDesign baseline adjustment](https://helpx.adobe.com/indesign/desktop/format-and-style-text/tabs-indents-and-spacing/adjust-text-baseline.html)                                   | Baseline shift changes selected characters' position without changing leading.                                                                                          | A local visual adjustment need not reflow neighboring lines.                                                                                                               |
| [InDesign kerning and tracking](https://helpx.adobe.com/indesign/desktop/format-and-style-text/tabs-indents-and-spacing/about-kerning-and-tracking.html)                            | Kerning is pair-specific; tracking applies across a selected range.                                                                                                     | Keep the existing spacing model intact.                                                                                                                                    |
| [After Effects text animation](https://helpx.adobe.com/after-effects/desktop/animating-text/text-animation/animating-text.html)                                                     | A selector chooses affected characters; Position can be adjusted numerically or by dragging in the Composition panel.                                                   | Direct manipulation and numerical controls should write the same underlying adjustment. A selector-based animator is not required for this prototype.                      |
| [After Effects Character panel](https://helpx.adobe.com/after-effects/desktop/add-text/formatting-characters-and-paragraphs/formatting-characters-character-panel.html)             | Positive baseline shift goes upward in horizontal text and rightward in vertical text.                                                                                  | A semantic baseline control changes axes with writing direction. Our control is explicitly local X/Y, not baseline shift.                                                  |
| [Figma text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)                                                                              | Letter spacing can apply to a text selection; type properties live in the right sidebar.                                                                                | Use contextual selection plus Inspector detail instead of expanding a graph card into hundreds of fields. The reviewed page does not establish free XY character dragging. |
| [Sketch text](https://www.sketch.com/docs/designing/text/)                                                                                                                          | Double-click enters text editing; formatting appears in the Inspector. Outlining produces character shapes and loses ordinary text editing.                             | Make edit modes obvious and retain the source string. Do not require destructive outlining.                                                                                |
| [Affinity tracking/kerning](https://www.affinity.studio/blog/tracking-kerning-leading-typography-essentials)                                                                        | Pair kerning uses a caret between letters; tracking uses a selected range.                                                                                              | Selection intent must be explicit; a spacing gesture must not masquerade as non-flow movement.                                                                             |
| [Inkscape keyboard reference: kerning and shifting](https://inkscape.org/sl/doc/keys.html)                                                                                          | With a selection, opposite adjustments at its boundaries move only selected text. Without a selection, the remainder of a line moves.                                   | Show the selected target clearly. Default movement must never unexpectedly shift the remainder of the line.                                                                |
| [SVG 2 text](https://www.w3.org/TR/SVG2/text.html)                                                                                                                                  | dx/dy update the current text position and can affect subsequent glyphs. Position lists, ligatures, whitespace and addressable characters have specific semantics.      | Raw SVG dx/dy lists are not the model for independent visual offsets. Continue Nect's shared outline evaluation/export.                                                    |
| [CSS Transforms Level 1](https://www.w3.org/TR/css-transforms-1/)                                                                                                                   | Transforms create coordinate systems; descendants of SVG text-content elements are excluded from transformable elements.                                                | Do not assume per-tspan transforms provide a portable solution. Transform the controlled outline geometry and invert the actual displayed coordinate mapping.              |
| [Unicode UAX #29](https://www.unicode.org/reports/tr29/) and [HarfBuzz clusters](https://harfbuzz.github.io/clusters.html)                                                          | User-perceived graphemes and shaping clusters are different concepts. Ligatures can span several graphemes.                                                             | Separate logical identity from rendered glyph identity; do not infer movable boundaries from string length alone.                                                          |
| [Unicode UAX #15](https://www.unicode.org/reports/tr15/)                                                                                                                            | Canonical normalization can change sequences; compatibility normalization can erase distinctions such as width variants.                                                | Preserve the source string and the existing NFC evaluation policy. Do not add NFKC.                                                                                        |
| [HTML text selection](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#textFieldSelection) and [Input Events Level 2](https://www.w3.org/TR/input-events-2/) | Textarea selection uses UTF-16 code-unit offsets; textarea target ranges are empty. IME has composition-specific input events. Input Events Level 2 is a Working Draft. | Capture textarea selection and actual edit transactions; do not assume getTargetRanges gives textarea spans or treat each composition update as a committed edit.          |

No reviewed product documentation establishes a complete, reliable rule for offset retention across repeated characters, replacement, IME, normalization and shaping changes. The contract below is Nect's explicit design, not a claim about those products.

## Existing Nect-SVG facts

- `src/text-layout.js` shares layout between browser and headless export. It normalizes CR/LF and NFC for evaluation without rewriting saved text, lays out explicit lines/columns, handles the existing bounded Japanese vertical subset, and rejects unsupported marks, selectors and controls.
- Horizontal layout calls `font.forEachGlyph`. Vertical layout iterates normalized code points and applies known per-character vertical substitutions/orientation. Current glyph records do not expose source-text ranges.
- `src/core.js` flattens Text's layout into a CompoundPath and discards the glyph records. Font glyph numbers and generated contour/point identifiers are not durable character identities.
- Text Path is unstable topology. Existing retained Path Remap edits suspend when source geometry changes. It edits vertices, not a semantically complete character.
- `canvasOverlay` in `src/main.js` displays `result.run(selectedNode.id)`, rather than the Text's downstream Output occurrence. Whole-generator dragging also edits original generator parameters.
- Text Position OUT is a separately evaluated input value. It is independent of font generation and downstream Transform. The new feature must preserve that contract.
- `docs/interaction.md` preserves focused text drafts until change/commit, with one undo record. New identity tracking must not force whole-app redraws or commit unfinished IME text.

### Limited read-only shaping probe

On this checkout, `opentype.js` is pinned to 1.3.4. A read-only Node probe using bundled DejaVu Sans produced individual glyphs for `fi`, `ffi` and `office` through current `layoutText`; explicitly enabling `liga` in `font.stringToGlyphs` produced the expected fused glyphs. `AA` reused glyph number 36 for both occurrences. This confirms that a font glyph number cannot identify a character occurrence, and that changing feature options could change correspondence. It does not prove all fonts/scripts have one-to-one mappings.

The prototype must preserve current shaping options. Do not silently enable/disable ligatures or upgrade the shaping dependency as part of this work.

## 1. User interaction

### Modes and placement

1. Keep ordinary whole-object selection and text-content editing distinct from **Character position**.
2. A visible Inspector action enters Character position for the selected Text. Double-clicking its displayed occurrence can provide the same entry; retain an explicit **Edit text** action that focuses the existing textarea.
3. In Character position, click a character to select it; Shift-click adds/removes characters within that same Text. Clicking an already selected member starts group movement without discarding the selection.
4. Draw only hover/selection boxes and a subtle base-position marker. Do not show a field for every character or a forest of Bezier vertices.
5. A small floating control near the selection contains `Delta X`, `Delta Y`, and reset. Clamp it to the canvas viewport; it must not cover the selected glyph or go offscreen near an edge. The right Inspector has the same values, selected text/character count and **Reset selected positions** / **Reset all positions**.
6. Mixed selections show a mixed state. A group drag adds the same local delta to each member; a numerical absolute value sets that axis for each selected member. Never silently flatten the other axis.
7. Arrow keys in the focused character-edit canvas nudge by 1 artwork unit in the displayed artboard axes, Shift+Arrow by 10, using the same inverse mapping as dragging. Arrow keys in textarea/numeric fields retain native behavior. Zoom must not change these model distances.
8. Escape cancels an active gesture. When idle, Escape exits Character position. Pointer cancellation, lost capture, window blur, undo, document/layer replacement and entering another tool cancel transient state safely.
9. Pan/zoom are view-only and must not modify offsets or history. Space/middle-drag must keep their existing navigation precedence.

### Selection geometry

- Hit testing uses the mapped character occurrence, not the entire Text bounding box or an unrelated contour.
- A glyph with multiple contours, including holes, is one selectable unit.
- Spaces have an advance-cell hit area and a faint selected placeholder. Moving a space changes only its stored visual position; it does not change the text's advance. The UI must say that spacing is controlled by letterSpacing/kerning.
- Newlines are structural and not draggable; blank lines/columns retain existing spacing.
- A character already overlapping another must remain selectable via a small overlap choice/cycle affordance. Do not silently choose a different Text or instance.
- Full custom in-canvas caret editing, paragraph selection and a rich text editor are outside this prototype. The existing textarea remains the content editor.

## 2. Positioning semantics

Evaluation order is fixed:

1. Normalize for layout using the existing CR/LF and NFC rules.
2. Shape and calculate advances, kerning, letterSpacing, lineSpacing and vertical orientation using the existing engine.
3. Resolve the existing per-line/column reference alignment and block cross-axis alignment.
4. Apply each character's independent local XY translation to all of its outline commands.
5. Calculate final geometry/bounds and continue through the graph.

The offset is in pre-downstream-Transform artwork pixels: X right, Y down. A vertical glyph's internal 90-degree rotation does not rotate these axes. Changing font size retains the same pixel offset; changing writing mode retains XY instead of guessing a conversion. Font/size/spacing/writing-mode edits recalculate the base layout and then reapply valid offsets.

Moving B in ABC must leave A and C at their previous positions, apart from an explicitly changed parent transform or base layout parameter. It must not mutate advances, kerning, Text Position, a connected Position source or Transform Anchor.

### Reference and bounds rule

Position references describe the **unadjusted base layout** when character offsets exist. Character movement may take the final visible left/right/top/bottom edge away from that reference. Position OUT still returns the same evaluated Position input.

Do not re-anchor the entire Text after character movement: moving the terminal character of a right-aligned line would otherwise move other characters in the opposite direction and can make the selected character appear stationary. Do not compensate by changing Text Position, because that would move Position-linked followers.

The UI note is explicit: "Character offsets are applied after alignment. Position stays fixed; adjusted outlines can extend beyond that reference."

Final visible bounds, preview, snapping candidates and SVG/PNG output reflect the adjusted outlines. Whitespace remains excluded from ink bounds; its advance hit cells remain available for editing. No-offset documents retain their existing geometry and exports.

## 3. Logical identity and persistent data

### Model contract

Store one optional versioned character-adjustment record on each Text. It contains:

- a normalized basis string, produced by the same normalization function as layout;
- an ordered list of stable logical-unit records, each with a Text-local ID and its source unit text;
- sparse finite `[dx, dy]` values keyed by those IDs, with omitted values equal to zero.

The exact property names can follow repository conventions. The invariants are mandatory: the unit text reconstructs the stored basis; IDs are unique within the Text; offsets refer only to known non-newline IDs; no array index, font glyph ID or path point ID is a persistent identity.

For the existing accepted Japanese/Latin subset, a normalized supported logical unit will ordinarily be one code point. The structure must not claim that every Unicode code point is a grapheme or that every grapheme is a glyph. Store original source text separately and maintain UTF-16/raw-to-normalized range mapping for textarea edits. NFC-equivalent source representations and CR/LF-only changes preserve identity when the normalized text is unchanged.

Creation may allocate identity lazily on first character adjustment. Identity allocation must happen in an explicit document edit, never inside evaluation. Duplicate Text nodes can copy Text-local IDs because the identity is the pair `(Text node ID, unit ID)`; the copy's later edits remain independent.

### Runtime correspondence gate

- Vertical mode has an explicit source iteration and can attach the logical unit to its known substituted/rotated glyph.
- Horizontal prototype support is limited to the existing Japanese/Latin editing scope and neutral characters with verified one-to-one logical-to-emitted-glyph correspondence in source order. Check actual glyph count and direct glyph identity, not count alone. Do not claim general bidirectional/complex-script editing merely because a particular output happens to have the same count. Preserve the existing complete-run layout so kerning is not lost by shaping each character independently.
- If the engine produces a ligature, reordered run, substituted sequence or another mapping the prototype cannot prove, show that the affected run cannot currently be edited character-by-character. Do not split the glyph, fabricate a cluster map or turn off typography features invisibly.
- Text without active offsets continues rendering under the existing engine even if the new edit gate is unavailable.
- Existing offsets whose mapping becomes unresolvable are retained and visibly suspended. Saving the editable project remains possible. A visible composition with unapplied active character offsets must not export silently; export reports the unresolved mapping until it is restored or the user resets the affected adjustment.

This is a bounded first prototype. General shaping-cluster selection and deliberate discretionary-ligature breaking require a later shaping contract.

### Text-edit retention

Use actual input transactions whenever available:

1. During an edit session, capture previous raw value, `selectionStart`/`selectionEnd`, input type and composition state. Stage an identity map alongside the existing textarea draft; do not mutate the saved document on every keystroke.
2. Verify each proposed replacement against the actual next value. Map the edit window through newline normalization/NFC, expanding to affected neighboring logical-unit boundaries if normalization can combine across the boundary.
3. Preserve IDs and offsets outside the verified affected range. New/replaced units get new IDs and zero offsets. Deleted units disappear from the committed current state; Undo restores them and their offsets.
4. A line break inserted before an adjusted character changes its line/column but not its identity. Identical repeated letters are distinguished by the captured edit location.
5. Treat an IME composition as one provisional transaction. Commit the final text and identity together, once. Do not allocate lasting IDs or show missing-glyph errors for each intermediate composition fragment.
6. Native textarea undo/redo during a draft must restore the corresponding staged identity snapshot where provable. App-level Undo/Redo after commit restores the full model in one step.
7. If the changed region cannot be established, do not guess from a longest-common-prefix/suffix match alone. For example, `AA` to `AAA` cannot establish whether the new A was inserted at the start or end. If offsets exist and identity cannot be recovered, retain the old basis/adjustments in a suspended state with a visible recovery/reset message. Unadjusted text can simply get a fresh identity map.

Whole-text replacement is a replacement, not automatic style inheritance: replaced characters start at zero. Copy/paste into the plain textarea copies content, not hidden character adjustments. Normal whole-node duplication preserves adjustments.

The minimal recovery options are Undo, restore the prior text, or explicitly reset all character positions to the current text. Automatic fuzzy rebinding is not part of this prototype.

## 4. Displayed occurrence and transform editing

Maintain two identities separately:

- source identity: Text node and logical-unit ID;
- displayed occurrence: the route/instance from that Text to the selected layer's current Output, plus its accumulated affine transform.

The runtime must not recover source characters by reversing contour IDs. Join rewrites geometry IDs, while the same Text can appear in multiple branches.

Initial supported display paths are Text through Fill/Stroke/Output, the current passthrough Convert to Path / Text to Path nodes, Transform and Join Geometry, with a finite invertible cumulative transform. Only occurrences actually reaching the current visible Output receive character overlays. Include Join input-edge identity (`a`/`b`) in the occurrence route. A supported branch remains editable when an unrelated unsupported branch also feeds the Join.

Pointer movement is converted from screen to artboard coordinates using the current artboard transform, then from the chosen displayed occurrence to Text-local delta using the inverse linear part of the accumulated affine transform. Translation and pivot affect displayed points; they must not be added to a delta vector. Use the same evaluated values and transform order as the geometry evaluator. Apply snapping in displayed artboard coordinates before inverse-transforming the delta; retain Alt bypass. Negative scale is valid when the mapping remains invertible.

One drag has a fixed source selection and chosen occurrence route. Multiple displayed occurrences of that source update together because the source adjustment is shared. Show "Editing shared Text: affects N displayed instances." If overlapping occurrences cannot be distinguished, require an explicit occurrence choice instead of taking an arbitrary branch. Do not average deltas across several transformed occurrences.

Boolean results, topology-changing Path Remap and Repeater copies are outside final-output direct editing in the first prototype. Unsupported routes and singular/near-singular transforms show a specific reason and no misleading original-position overlay. Character selection via the textarea/Inspector and local numeric adjustment can remain available when source mapping is valid, but it must clearly state that canvas direct editing is unavailable for that output route. Do not change the graph's Output merely to enable editing.

Resolved source and display metadata should be bounded and runtime-only. Avoid duplicating full glyph outlines at every graph node; use immutable cached source layout plus occurrence references/transforms where practical. Metadata must invalidate with text, font, geometry, routing and relevant parameter changes; pan/zoom/selection alone must not invalidate text geometry.

Keep the existing whole-Text CompoundPath and paint grouping. Do not assign a rendering `contour.group` to each character: that could change Join/paint/alpha behavior. Instead, record per-glyph `commandStart`/`commandEnd` in layout, apply offsets to those ranges after current alignment, and derive independent editing hit paths as side data. Changing edit metadata must not split exported paint elements or alter overlapping-character compositing.

## 5. Locks, validation and compatibility

- Layer lock prevents character mutation. A lock or connection on Text Position does not automatically lock an independent character offset; this feature never writes through to that Position source. Explain that distinction in tests and the UI.
- The initial offsets are local direct values, without per-character sockets/expressions/locks. Their future extension must not require a new node for each character.
- Enforce finite bounded offsets using the existing artwork-coordinate policy. Bound unit/offset counts by the current Text length/geometry budgets; reject duplicate IDs, unknown references, invalid basis reconstruction and malformed records transactionally.
- Include character data in Text Path cache keys. Do not add it to Text Position OUT's isolated key/dependencies.
- Undo records a completed drag or numerical change once. Cancel/no-op does not add history. Selection, mode and occurrence route are transient and excluded from saved geometry.
- Saving/reloading and browser/headless exports use the same adjustment evaluation. Do not export SVG `<text>` as a shortcut; preserve the current deterministic outline-export contract.
- The first project containing this render-affecting feature should use a new supported document schema version (proposed v3), so old builds fail explicitly instead of silently rendering without offsets. Read old v1/v2 documents with zero adjustments and unchanged geometry. Final migration mechanics must be checked against the publisher's current branch before implementation.
- Keep source-generator unstable-topology behavior for downstream Path Remap. Character offset changes must not make retained point edits bind to a different outline accidentally.

## 6. Acceptance conditions

All of the following are prototype acceptance gates, not claims of observed passes.

### Core/layout/serialization

1. Moving only B in `ABC` by `(12, -7)` shifts every B contour exactly, preserves its holes, and leaves A/C glyph positions, advances, Text Position and Position OUT unchanged.
2. A right-aligned terminal glyph moves when dragged; its siblings do not counter-move. Repeat for center alignment, visible/advance references, cross-axis reference, multiple lines and vertical columns.
3. Automatic kerning and letterSpacing remain unchanged by offsets; changing them recomputes base positions and reapplies the saved offset.
4. Font/size changes preserve valid IDs and pixel offsets. Switching writing direction retains XY and preserves the existing punctuation/Latin orientation behavior.
5. Insert/delete before the adjusted character, repeated `AA` insertion at both ends, replacement of the adjusted character, newlines, blank lines and spaces meet the retention contract. No index-based reassignment occurs.
6. `ガ` and `カ` plus combining dakuten normalize consistently; changing only canonical representation does not lose adjustment. Unsupported selectors/combining sequences retain existing explicit failures. A supported surrogate-pair character is never split by UTF-16 indexing.
7. A controlled ligature/reordering fixture fails the correspondence gate without altering shaping; normal one-to-one text remains editable. Active unresolvable offsets are retained, visible and not silently omitted from export.
8. Duplicate Text, Undo/Redo, save/reload, old project migration and headless SVG match. Invalid schemas/IDs/counts/non-finite offsets preserve the currently open project.
9. Bounds update from moved outlines. Text Position OUT remains usable without a font and stays cached when only character offsets change.

### Transform/provenance

10. Direct Text, painted Text, Text through one Transform, nested pivoted rotations/scales and Text in a Join group all show boxes on the final displayed glyphs and convert drags correctly.
11. Scale 2 plus 90-degree rotation maps a 20-unit screen/artboard-axis drag to the expected local delta. Test negative scale, pan/zoom and a non-origin pivot independently.
12. Multiple routes preserve distinct occurrence identities. Editing one occurrence updates the shared source and all instances, with an explicit indicator. An orphan/unrendered Text has no final-output hit target.
13. Unsupported Boolean/Remap/Repeater routes and zero/near-zero scale never show a falsely editable overlay or mutate a guessed upstream target.

### Real UI and interruption

14. Character selection, Shift multi-selection, hit testing for holes/overlap/spaces, dragging, numerical edits, reset, arrow nudges and Undo work without creating nodes/layers.
15. Small controls remain on-screen at artboard edges and at tested canvas zoom levels; they do not cover the selected glyph. The graph and Inspector remain usable with long text.
16. Escape, pointercancel, lost capture, blur, document/layer replacement, undo during an interaction and repeated entry/exit restore/cancel correctly. Later pointerup cannot resurrect an old gesture.
17. Pan and graph navigation retain priority; keyboard shortcuts do not steal textarea/numeric entry. Focus, drafts, text selection and Inspector scroll survive ordinary redraws.
18. Actual Japanese IME composition, cancellation, conversion and commit preserve content and unaffected offsets with one committed undo step. Synthetic composition tests are not a substitute for native Windows/WebView2 IME acceptance; report that stage separately if unavailable.
19. Run focused tests, the repository's aggregate `npm run check`, real-browser e2e and the existing Windows packaging workflow on the final implementation. Inspect screenshots of transformed horizontal and vertical text. Report passed, failed and not-run stages distinctly.

## 7. Delivery order and stop conditions

1. Integrate after the concurrent publication/CI changes have a stable source checkpoint. Do not overwrite that work.
2. Implement/test logical identity, the edit transaction helper and pure offset evaluation first.
3. Add runtime occurrence mapping and inverse-transform tests before adding direct dragging.
4. Add mode/selection/Inspector controls and browser interruption tests.
5. Add one small horizontal/vertical transformed-text example, then run complete acceptance and publish through the already-authorized development workflow.

Stop and report a concrete blocker if the chosen mapping cannot prove the source character, the display route is unsupported, a required transform cannot be inverted, or final verification is unavailable. A smaller honest prototype is preferable to apparently editable but mis-targeted text.

Do not widen this implementation to a full Unicode shaper, manual kerning engine, per-glyph scale/rotation, paragraph compositor, general arbitrary-graph inverse solver or dependency upgrade. Those are separate possible extensions after the user tries the positioning workflow.
