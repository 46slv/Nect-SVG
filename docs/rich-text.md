# Selected-character typography

Text now supports a different **font**, **font size**, and **horizontal width percentage** on one character or a selected range. These are typography inputs, evaluated before line layout and the existing per-character XY/rotation/uniform shape scale.

## Editing

1. Select Text and highlight one or more complete characters in its Text field.
2. Click **Style selected text**. Alternatively, enter Character position mode and choose characters on the canvas or in the multi-select character list (Shift selects a range in the list).
3. Under **Selected typography**, choose an embedded/installed font, or **Load font for selection…**, then set **Font size px** or **Horizontal width %**.
4. Mixed selections show Mixed. A value applies absolutely to every selected character. **Inherit size**, **Inherit width**, **Inherit default font**, or **Reset selected typography** remove only the relevant overrides. XY/rotation/shape scale remain intact.

The original Text font and size are defaults. Explicit selected-character overrides remain when those defaults change. One completed range edit is one Undo entry. Escape cancels an uncommitted numeric draft. Layer locks block every typography edit. Typography selection does not require a visible glyph, so missing Japanese glyphs can be repaired by assigning a font to only that range.

Font files use the existing static TTF/OTF validation, asset-size limits and embedding-permission checks. Selected font requests capture the document and selected stable character IDs; changing either while a font is loading rejects that result. Font bytes are embedded in JSON for deterministic reopen/export. A font's metadata flags are not a substitute for checking its license before sharing.

## Geometry and layout contract

- Font size is in document px, greater than zero and at most 100000. It changes outline metrics and advance.
- Horizontal width is 1–1000%, with 100% as the default. In horizontal text it scales each glyph's X outline and horizontal advance, including spaces and kerning, so following characters reflow. Tracking remains an extra absolute px gap and is not scaled.
- In vertical text width scales **screen X** about the column center; vertical advance is unchanged. This is an explicit physical-horizontal-width control, not inline vertical scaling.
- Adjacent characters with the same resolved font and size are shaped together. Width changes preserve that shaping and kerning. Font/size boundaries break kerning. Unsupported one-to-many or reordered character/glyph mappings suspend the saved adjustments: normal unadjusted artwork is shown and visible export is blocked. No guessed glyph correspondence is saved.
- Every character's pivot, advance and whitespace hit cell use its resolved font and size. Existing shape scale/rotation are applied around the new normal-layout cell center, then XY offsets are added, before downstream Transform.
- Legacy unstyled text retains exactly its fixed baseline/column spacing. Text with explicit typography overrides uses safe adjacent-line metrics: horizontal baseline distance is the greater of the largest adjacent em × lineSpacing and previous descent + next ascent. Vertical column distance uses the largest adjacent em × horizontal width × max(1, lineSpacing). Empty lines use Text defaults. This first release does not expose a separate manual-leading/auto-leading switch.
- Start/center/end visible or advance references and cross-axis references are calculated after typography reflow. Text Position and Position OUT do not change. SVG and PNG contain the same evaluated outlines, without editable `<text>` or UI overlays.

## Persistence and edits

Projects gain schemaVersion 5 only when typography is edited. `characterPositions.version: 3` extends the existing stable-ID record with sparse `styles: { c2: { font, size, width } }` alongside XY offsets and transforms. Version 1/2 records and schema 1–4 projects still load; older schema values containing the new feature are rejected rather than silently stripping it.

A style's omitted properties inherit Text defaults. The pure patch helper accepts null to remove a property. Saved font references must resolve to the bundled default or a real embedded asset. Values, keys, target IDs and newline exclusions are validated atomically.

Textarea UTF-16 selections map through verified code-point, NFC and CRLF boundaries. Partial surrogate pairs/combining sequences/newline pairs are rejected. Newline units remain structural. Verified insert/delete/replace/IME transactions retain styles on surviving IDs; newly inserted characters inherit Text defaults, including replacement text. Unknown edits suspend rather than reassign styles heuristically. Undo restores text, IDs and styles together.

## Verification and current limits

- `tests/rich-text.test.js`: range mapping, sparse/inherited values, validation, ID reconciliation/IME, per-range glyph coverage, mixed metrics, width advances/tracking/kerning, suspended shaping, vertical behavior, references, history, JSON/CLI SVG parity and font-cache invalidation.
- `tests/rich-text-dom.test.js`: actual controls, selected-only font loading, mixed values, inheritance, Escape, Undo/Redo, stale async selection, typed-text reconciliation, missing-glyph repair, composition and locks.
- `tests/rich-text.e2e.js`: Chrome selection and file picker, range controls, history, glyph repair, JSON/SVG equality, PNG rasterization and a screenshot. Included in Windows CI.

This is the first rich-text slice, not Illustrator/After Effects parity. Range tracking/kerning overrides, baseline shift, independent vertical scale, paragraph styles/justification, text boxes/wrapping, tabs, path text, auto/manual leading controls, OpenType feature UI, arbitrary grapheme/complex-script shaping, variable/color fonts and text animation remain separate work. Existing limitations on combining marks that do not compose under NFC, selectors, control characters and unsupported shaping remain explicit.

`examples/rich-text-range.json` is an editable Latin/Japanese sample with embedded limited Nect JP test fixture data. The fixture's license is [SIL OFL](../tests/fixtures/fonts/OFL.txt); its coverage and origin are documented in [the fixture README](../tests/fixtures/fonts/README.md).
