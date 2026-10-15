# Selected-character typography

Text supports a different **font**, **font size**, **horizontal width**, **vertical scale**, **tracking**, and **baseline shift** on one character or a selected range. Text-level **Auto / Manual leading** controls baseline or column distance. These are typography inputs, evaluated before line layout and the existing per-character XY/rotation/uniform shape scale.

## Editing

1. Select Text and highlight one or more complete characters in its Text field.
2. Click **Style selected text**. Alternatively, enter Character position mode and choose characters on the canvas or in the multi-select character list (Shift selects a range in the list).
3. Under **Selected typography**, choose an embedded/installed font, or **Load font for selection…**, then set **Font size px**, **Horizontal width %**, **Vertical scale %**, **Tracking px**, or **Baseline shift px**. Each numeric field has its own full-width row and **Inherit** button.
4. Mixed selections show Mixed. A value applies absolutely to every selected character. A field’s **Inherit** button, **Inherit default font**, or **Reset selected typography** remove only the relevant overrides. XY/rotation/shape scale remain intact.

Under Text, **Line / column leading** chooses **Legacy spacing**, **Auto · font metrics**, or **Manual · exact px**. Manual exposes the baseline/column distance field. This setting applies to the complete Text node, not only its selected range; it is not paragraph spacing.

The original Text font, size and letterSpacing are defaults. Explicit selected-character overrides remain when those defaults change. One completed range edit is one Undo entry. Escape cancels an uncommitted numeric draft. Layer locks block every typography edit. Typography selection does not require a visible glyph, so missing Japanese glyphs can be repaired by assigning a font to only that range.

Font files use the existing static TTF/OTF validation, asset-size limits and embedding-permission checks. Selected font requests capture the document and selected stable character IDs; changing either while a font is loading rejects that result. Font bytes are embedded in JSON for deterministic reopen/export. A font's metadata flags are not a substitute for checking its license before sharing.

## Geometry and layout contract

- Font size is in document px, greater than zero and at most 100000. It changes outline metrics and advance.
- Horizontal width is 1–1000%, with 100% as the default. In horizontal text it scales each glyph's X outline and horizontal advance, including spaces and kerning, so following characters reflow. Tracking remains an extra absolute px gap and is not scaled.
- Vertical scale is 1–1000%, with 100% as the default. In horizontal text it scales **screen Y** about each baseline, including its metric center and whitespace cell; horizontal advance is unchanged. In vertical text it scales screen Y about each glyph’s inline origin **and its vertical advance**, including rotated Latin glyphs and spaces.
- In vertical text horizontal width scales **screen X** about the column center; vertical advance is unchanged. Width and vertical scale are independent physical-axis controls, not the post-layout uniform shape scale.
- Tracking is an absolute -100000…100000 px gap **after** each selected character. It replaces that character’s inherited letterSpacing; it is not added to letterSpacing and is never multiplied by width/height. Tracking after the last character in a line/column is excluded from advance/alignment. It carries across font/size boundaries, not newlines. Tracking is not pair kerning: the font’s existing kerning is still applied when enabled.
- Baseline shift is -100000…100000 px. Positive values move the typographic baseline up in horizontal text or the column origin right in vertical text. It changes the glyph origin and pivot before post-layout shape transforms and XY. It does not move following inline characters; auto leading considers it when placing adjacent lines/columns. Free XY remains a separate post-layout translation.
- Adjacent characters with the same resolved font and size are shaped together. Width changes preserve that shaping and kerning. Font/size boundaries break kerning. Unsupported one-to-many or reordered character/glyph mappings suspend the saved adjustments: normal unadjusted artwork is shown and visible export is blocked. No guessed glyph correspondence is saved.
- Every character's pivot, advance and whitespace hit cell use its resolved font and size. Existing shape scale/rotation are applied around the new normal-layout cell center, then XY offsets are added, before downstream Transform.
- Legacy unstyled text retains exactly its fixed baseline/column spacing. Text with explicit typography overrides uses safe adjacent-line metrics: horizontal baseline distance is the greater of the largest adjacent em × lineSpacing and previous descent + next ascent. Vertical column distance uses the largest adjacent em × horizontal width × max(1, lineSpacing). Empty lines use Text defaults. This remains the **Legacy spacing** behavior when no leading mode is saved. **Auto** uses the same adjacent metrics even on unstyled text and includes vertical scale and cross-axis baseline shifts. **Manual** uses the exact positive distance (up to 100000 px), including empty lines/columns; it ignores lineSpacing and may intentionally overlap glyphs. Rotation, uniform shape scale and free XY do not change leading.
- Start/center/end visible or advance references and cross-axis references are calculated after typography reflow. Text Position and Position OUT do not change. SVG and PNG contain the same evaluated outlines, without editable `<text>` or UI overlays.

## Persistence and edits

Font/size/width-only projects retain schemaVersion 5. Editing tracking, baseline shift, vertical scale or explicit leading requires schemaVersion 6. `characterPositions.version: 3` extends the existing stable-ID record with sparse `styles: { c2: { font, size, width } }` alongside XY offsets and transforms. `characterPositions.version: 4` adds `height`, `tracking`, and `baselineShift` to sparse styles. Text nodes optionally save `leading: { mode: "auto" }` or `leading: { mode: "manual", value: 90 }`. Removing leading restores legacy behavior. Version 1–3 records and schema 1–5 projects still load; older record/schema versions containing newer features are rejected rather than silently stripping them.

A style's omitted properties inherit Text defaults. The pure patch helper accepts null to remove a property. Saved font references must resolve to the bundled default or a real embedded asset. Values, keys, target IDs and newline exclusions are validated atomically.

Textarea UTF-16 selections map through verified code-point, NFC and CRLF boundaries. Partial surrogate pairs/combining sequences/newline pairs are rejected. Newline units remain structural. Verified insert/delete/replace/IME transactions retain styles on surviving IDs; newly inserted characters inherit Text defaults, including replacement text. Unknown edits suspend rather than reassign styles heuristically. Undo restores text, IDs and styles together.

## Verification and current limits

- `tests/rich-text.test.js`: range mapping, sparse/inherited values, validation, ID reconciliation/IME, per-range glyph coverage, mixed metrics, width advances/tracking/kerning, suspended shaping, vertical behavior, references, history, JSON/CLI SVG parity and font-cache invalidation.
- `tests/typography-spacing.test.js`: range tracking/kerning, shifted/scaled metrics, upright/sideways/space advances, auto/manual/empty-line leading, schema6, cache invalidation, history and CLI parity.
- `tests/rich-text-dom.test.js`: actual controls, selected-only font loading, mixed values, inheritance, Escape, Undo/Redo, stale async selection, typed-text reconciliation, missing-glyph repair, composition and locks.
- `tests/rich-text.e2e.js`: Chrome selection and file picker, range controls, history, glyph repair, JSON/SVG equality, PNG rasterization and a screenshot. Included in Windows CI.

This is a bounded rich-text implementation, not Illustrator/After Effects parity. Paragraph styles/justification, fixed-height text boxes and advanced wrapping, tabs, advanced path text beyond the [bounded Type on Path slice](type-on-path.md), OpenType feature UI, arbitrary grapheme/complex-script shaping, variable/color fonts and text animation remain separate work. Existing limitations on combining marks that do not compose under NFC, selectors, control characters and unsupported shaping remain explicit.

`examples/rich-text-range.json` is an editable Latin/Japanese sample with embedded limited Nect JP test fixture data. The fixture's license is [SIL OFL](../tests/fixtures/fonts/OFL.txt); its coverage and origin are documented in [the fixture README](../tests/fixtures/fonts/README.md).

`examples/typography-spacing.json` extends the editable embedded Latin/Japanese fixture with range tracking, baseline shift, independent vertical scale and manual leading. The same SIL OFL fixture license applies.

Horizontal width-dependent composition is available through [Wrap width · auto height](text-wrap.md). It uses the selected typography before fitting, derives physical lines without source edits, and applies the existing leading afterward.

Manual per-pair overrides are available through [Pair kerning](pair-kerning.md), separately from tracking. Pair values replace the metric adjustment and keep tracking additive; selected typography reset leaves them intact.
