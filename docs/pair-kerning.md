# Manual pair kerning

Text supports a bounded manual spacing override between two adjacent source characters, including spaces. It complements the existing [selected-character typography](rich-text.md), [Wrap width](text-wrap.md), [Type on Path](type-on-path.md) and [numeric dragging](numeric-scrubbing.md). It does not add an optical-kerning engine or complex-script shaping.

## Editing

1. Put the caret between two complete characters in the Text field and click **Kerning at cursor**. This works in both the Inspector and the node's Text controls. The pending text draft is committed/reconciled before the pair is selected.
2. Alternatively, select exactly two adjacent characters in the Text field, on the canvas or in the character list. The **Pair kerning** panel identifies the actual pair, source positions and **Inherited** or **Manual** state. One, three or nonadjacent selected characters do not choose a pair.
3. Set **Pair kerning (1/1000 em)**, or drag the number horizontally. Fractions are accepted; each drag step is one unit. The permitted range is -100000 through 100000. An inherited input stays empty, with its resolved metric adjustment shown in the placeholder and panel; typing 0 therefore always authors explicit zero. Starting a drag uses the resolved inherited value. A simple click still permits typing.
4. **Inherit pair** removes only this pair's override. Entering **0** saves an explicit zero, disabling that boundary's metric kerning. **Reset selected typography** leaves pairs intact; **Reset all adjustments** clears them along with character styles, shapes and XY offsets.

A complete typed edit or scrub is one Undo step. A gesture returning to its starting value restores the original sparse record and schema without adding history. Escape, pointer cancellation, lost capture, focus loss and selection/node/layer changes cancel the preview. Invalid changes roll back together with history/schema. Locks block editing. The target's two stable IDs are fixed for a gesture, rather than following a changed selection.

Beginning/end of text, hard-newline boundaries, split surrogate/NFC/CRLF boundaries, active composition, stale captured text and suspended or unverified glyph mapping are rejected. Native IME acceptance still requires a Windows WebView2 check; automated synthetic composition tests are not proof of native IME behavior.

## Exact units and geometry

A manual number replaces the automatic metric component at that boundary. The left character's tracking is then added exactly once, independently, in its existing document-pixel units.

- Horizontal manual gap = value / 1000 × left resolved font size × left horizontal width.
- Vertical manual gap = value / 1000 × left resolved font size × left vertical scale.
- Absent pair: existing font kerning remains when supported and enabled. Equal resolved font/size runs shape together, even when width differs. Font/size boundaries have no inherited metric kerning.
- Manual values work across mixed-font and mixed-size boundaries. The left-owner em convention is a Nect choice; it does not claim identical mixed-size behavior to Adobe.
- **Automatic font kerning (horizontal)** affects inherited metric kerning only. Manual values remain effective when it is off. Vertical inheritance keeps the existing no-font-pair-kerning behavior.

The engine derives the natural adjustment from actual shaped displacement after removing the intrinsic left advance and global letter spacing. One shared boundary resolver is used by normal horizontal, wrapped horizontal and vertical layout. A manual pair never splits a shaping run or changes the shaped glyph IDs. Glyph intrinsic advance, outline and advance-cell pivot are unchanged; the next origin and following layout move. This is spacing between origins, not an absolute visible-outline clearance.

Negative gaps may overlap glyphs or produce negative total line advance. Logical order is retained. Advance alignment stays signed; visible alignment uses actual outline bounds. Baseline shift, physical width/height, local shape transforms, XY offsets and downstream transforms retain their established order. Position and Position OUT stay fixed.

## Line breaks and path text

An authored hard newline prevents pair storage. Soft wrapping preserves both IDs and the saved override. When a soft break separates them the pair is dormant; the panel says **At a wrap break; applies when these characters share a line.** Widening or editing the text can reunite them without reauthoring the pair.

Wrapping uses the same adjusted shaped prefix origins for fitting and drawing. Candidate width is the last intrinsic advance plus last origin minus first origin, excluding the outgoing/incoming boundary contribution. The existing trailing-separator fitting behavior remains. No gap becomes indentation on the next line, and signed widths still use the sequential greedy algorithm rather than a monotonic-width assumption.

Type on Path receives this adjusted horizontal layout and follows the existing tangent projection. Detaching retains pair values. Intrinsic advances remain nonnegative even when origins decrease. Open-start/end excursions or occupation beyond one closed lap reject atomically, including previews and off-output Text edits. Existing single-line/horizontal/path restrictions remain.

## Stable identity, persistence and safety

The sparse field is `characterPositions.kerningPairs`, for example `{ "c2:c3": -80 }`. Keys are ordered adjacent non-newline stable source IDs in the saved basis, not glyph indices, source offsets or character strings. Pair edits require record version 5 and project schemaVersion 9. Older projects and records stay unchanged on selection/evaluation, and retain their exact previous geometry. Strict validation rejects malformed keys, unknown/nonadjacent/reversed/newline endpoints, nonfinite/out-of-range values and newer fields under old versions. Version 5 requires its pair object, including when empty. Explicit zero is active authored state.

Verified text edits preserve a pair only while its original endpoint IDs remain immediately adjacent in order. Insertion outside a pair retains it; insertion between, hard-newline insertion, replacement or deletion of either endpoint removes it. Newly adjacent characters do not inherit another pair, and deleting an intervening insertion later does not resurrect its removed override. Undo can restore it. Existing repeated-text replacement and NFC/CRLF/IME identity rules remain authoritative. Unknown source edits suspend saved pair state without guessing or discarding it, including pair-only zero records. An XY-only reset cannot erase this suspended state; Reset all adjustments is explicit recovery.

Unverified ligature/reordered mapping with a pair-only record gets the existing unadjusted fallback and blocks visible export. Wrap width continues to reject unsupported mappings rather than exporting an unwrapped approximation. The source record remains intact. Evaluation caches include the entire authored record; Position OUT cache entries cannot replace current Text path/layout metadata.

JSON retains source, IDs, pair overrides, fonts and other typography. Browser SVG, PNG and CLI share outlined geometry. SVG is not promised to reopen as editable Text. No dependencies or native text backend were changed.

## Evidence and scope

- `tests/pair-kerning.test.js`: strict records/schema, caret boundaries, verified identity changes and suspension, metric/manual-zero/tracking oracles, mixed font/size/scales, vertical, wrapping, unsupported mapping/export, signed alignment, path rollback, reset, cache, history and exact JSON/CLI SVG parity.
- `tests/pair-kerning-dom.test.js`: actual UI handlers for caret/range selection, graph drafts, numeric values/history/cancellation, no-op schema, reset, IME refusal, stale capture, dormant wrap pairs, suspension recovery and locks.
- `tests/pair-kerning.e2e.js`: real Chrome pointer dragging, focus/typing/cancellation, wrap dormancy, vertical/path rollback, draft/IME handlers, JSON/browser/CLI parity and screenshot. It is included in the existing Windows workflow; a prepared script is not a pass until observed.
- `examples/pair-kerning.json`: editable comparison of inheritance, manual zero/negative/positive spacing, mixed size, vertical spacing and wrap dormancy. It uses the bundled Latin font and contains no external font dependency.

Adobe grounding: [Illustrator line and character spacing](https://helpx.adobe.com/illustrator/using/line-character-spacing.html), [After Effects Character panel](https://helpx.adobe.com/after-effects/desktop/add-text/formatting-characters-and-paragraphs/formatting-characters-character-panel.html), and [After Effects CharacterRange](https://developer.adobe.com/after-effects/uxp/after-effects-api/characterrange). These ground pair-vs-range distinction, manual-plus-tracking behavior and 1/1000-em units; Nect's pair UI and mixed-style convention are explicitly bounded. Native Nect's [TextSource](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/include/nect/core.hpp) and [DirectWrite layout](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/text.cpp) were reference context, not a code transplant.

Deferred: optical kerning, arbitrary grapheme clusters/complex shaping/bidi, vertical OpenType kerning, tsume, tate-chuu-yoko, vertical wrapping and complete Illustrator/After Effects parity.
