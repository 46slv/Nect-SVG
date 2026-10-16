# Local fonts and Japanese text

## Use it

1. Add/select a Text node. The node and Inspector both have a multiline Text field.
2. Choose **Load TTF / OTF…**, then select a static outline font containing the required characters. The bundled DejaVu Sans does not contain Japanese. Fonts are shared across all Text nodes in that project through the Font dropdown.
3. Set Writing to **Vertical ↓ / columns ←** for Japanese vertical layout, or Horizontal for the existing baseline layout. Enter creates a new line/column. Horizontal [Wrap width · auto height](text-wrap.md) optionally adds derived lines. Vertical wrapping and clipping are unsupported.
4. `size` is in artwork pixels. `letterSpacing` adds pixels after each glyph; `lineSpacing` is a multiplier of size. They are ordinary Scalar parameters, so expression, connection, lock and undo work as on other fields.
5. Save JSON retains editable text and full font bytes. Reopening can display **and edit new characters** without selecting the font again. SVG export contains paths only. The same project exports through `node cli/export.js project.json artwork.svg` without installed system fonts.

In horizontal mode, Position is the first line's left baseline. In vertical mode it is the first column's horizontal center and top. Changing direction deliberately keeps these numeric coordinates; it does not guess a new position to preserve the old bounding box. Space glyphs retain advance; blank lines retain line/column spacing.

## Scope and layout

`src/text-layout.js` is the shared browser/headless implementation. It normalizes CR/LF and NFC for evaluation without rewriting saved source text. CJK is upright; half-width Latin and digits are individually rotated clockwise. Full-width Latin stays upright. Columns progress from right to left.

For the selected font's Japanese `kana`/`hani` script, then default/Latin script, the engine selects the `JAN ` language when available and applies `vrt2`, or `vert` when `vrt2` is absent. Single-glyph GSUB formats 1/2 and their extension lookup are supported. Thus punctuation, brackets, long vowel marks and small kana use the font's actual vertical alternate outlines instead of rotating the whole text block. Unsupported contextual vertical substitutions produce an error. `vhea`/`vmtx` advances and `VORG` origins are read from original bytes; TrueType origin falls back to glyph yMax plus top bearing.

Fonts without vertical metrics use an em advance and ascender origin. When no alternate exists for Japanese corner punctuation, small kana, brackets or long marks, bounded geometric placement/rotation is used with a visible warning. This is a practical Japanese/Latin subset, not a complete Unicode vertical-orientation/shaping implementation and not pixel parity with Windows DirectWrite. No ruby, tate-chu-yoko, vertical wrapping, complete kinsoku, bidirectional/complex-script layout guarantee or variable axes are provided. Horizontal [Wrap width](text-wrap.md) and bounded [Type on Path](type-on-path.md) are separate, mutually exclusive modes. Uncombined marks, variation selectors, joiners, tabs and control characters are explicitly rejected; precomposed Japanese dakuten/handakuten work through NFC. Missing glyphs identify characters/code points rather than silently displaying `.notdef` or substituting another font.

Nect's reference is the Windows DirectWrite path implementation at [src/text.cpp, 7afcab8](https://github.com/46slv/Nect/blob/7afcab8d5767de25740e63286064a6c3502590b3/src/text.cpp) and its [Japanese vertical oracle](https://github.com/46slv/Nect/blob/7afcab8d5767de25740e63286064a6c3502590b3/tests/japanese_vertical_oracle_tests.cpp#L247-L287). That native backend is not copied or linked into this JavaScript engine. The mixed-orientation model also follows the relevant [W3C writing-modes description](https://www.w3.org/TR/css-writing-modes/#text-orientation).

## Font bytes, permissions and limits

No font discovery service, upload or external request is used. The file chooser reads local bytes; only the user's explicit JSON save includes them in a local file/download. User-selected fonts are never automatically added to this repository. Check a font's license before embedding or sharing a project: OS/2 flags are only a technical check and do not guarantee permission under its full license.

Manual file picker / project assets accept static `.ttf` TrueType outlines and `.otf` CFF/TrueType outlines. The manual picker rejects TTC/OTC collections; the Windows installed-font route below extracts one static face first. WOFF/WOFF2, variable fonts/CFF2 and color/bitmap fonts are rejected explicitly. Restricted, preview/print-only and bitmap-only embedding flags are rejected. File/table/TrueType glyph location bounds are checked before use; the active Text is evaluated with a candidate font before import commits. Parser isolation for hostile untrusted fonts remains future hardening, not a multi-tenant service claim.

- One font: at most 20,000,000 bytes
- A project: at most 8 imported fonts, 32,000,000 combined raw font bytes
- Project JSON: at most 50,000,000 UTF-8 bytes across browser, CLI and native open/save
- Text: at most 10,000 UTF-16 code units per node; 500,000 generated path commands
- Duplicate file bytes reuse the same asset, regardless of filename
- Parsed font cache: at most 8 entries / 32 MB raw bytes
- Undo: immutable font asset records are shared, not copied per edit; the usual 100-step bound also drops oldest history above 96 MB of distinct raw font assets

Cancellation, corrupt or unsupported files, missing required glyphs, lock state, a newer import, and document changes during an asynchronous read leave the active project untouched. Font import is one undoable transaction. New/open/undo/redo re-resolve fonts from that document's own assets. Invalid asset data and dangling font IDs reject a candidate JSON before replacement. Text with missing glyphs remains editable and may be saved; SVG export refuses an erroneous visible composition.

## Schema and headless contract

Optional root `fontAssets` maps safe `font-…` IDs to `{ name, fileName, data }`, where data is the complete base64 font. Text `font` references an asset or the built-in `default`. Optional Text `writingMode` is `horizontal-tb` (legacy default) or `vertical-rl`. Text adds Scalar `letterSpacing` (0) and `lineSpacing` (1.2). Schema-v1 files missing those two parameters are migrated on load; other unknown parameters and invalid directions still fail validation.

`parseFont(arrayBuffer)` parses validated local font bytes. `makeFontAsset(bytes, fileName, existing)` prepares/deduplicates an asset; callers commit it atomically. `resolveFonts(document, supplied)` provides the parsed font map consumed by `evaluate`. `exportSVG` resolves embedded assets automatically. Asset objects are frozen after validation and shared by `cloneDocument`/History snapshots. They must be replaced rather than mutated.

Changing text, selected font, direction, size or spacing invalidates Text and downstream geometry. Moving/collapsing a graph card does not. Text remains unstable-topology path geometry: downstream retained Remap edits suspend when outlines change, preserving the existing explicit-rebind contract.

## Test fonts

`tests/fixtures/fonts/` contains small **test-only** renamed derivatives of Noto Sans CJK JP 2.004, both standalone CFF OTF and real quadratic TrueType TTF, with OFL 1.1, provenance, hashes and a reproducible fontTools script. They contain only a limited regression character set and are not an end-user Japanese font. Their licensing does not establish permission for any user's fonts.

## Windows installed fonts

The Windows desktop app discovers the conventional system `%WINDIR%\\Fonts` and per-user `%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts` directories automatically. The Text inspector has one **Font** selector for the bundled font, fonts already embedded in the project, and an **Installed Windows fonts** group. Selecting an installed font automatically loads and applies it without finding a file or clicking a second control. The selector keeps the active font visible, shows loading status, and restores the active choice on failure. Internal full names identify styles. Discovery reads bounded metadata only; the selected face alone is embedded, undoable, and portable in saved JSON. Restart to discover newly installed fonts. Registered fonts stored elsewhere are not enumerated; use the manual TTF/OTF picker. The browser keeps its manual picker.

Static TTF/OTF and individual static TTC/OTC collection faces are supported by this native route. It reconstructs a standalone SFNT, retains original OS/2 embedding flags and vertical/layout tables, recomputes offsets/checksums, and drops the now-invalid DSIG. Variable/CFF2 and color/bitmap faces are shown disabled with a reason. Existing parser/license checks still reject restricted embedding, malformed outlines or missing characters before any document mutation. Installation does not grant redistribution rights: check the actual font license before sharing a project.

Bounds: 4,096 directory entries per root, 4,096 displayed faces, 256 faces per collection, 256 tables per face, 64 KiB name metadata, 128 MB source container and 20 MB extracted face. Existing 8-font / 32 MB combined assets / 50 MB project limits still apply. Native IPC accepts only catalog-issued opaque IDs and rechecks the canonical allowed directory; it does not expose arbitrary path reading or broaden app permissions. Invalid or unreadable files are skipped. Windows native acceptance remains distinct from CI packaging and synthetic UI tests.

## Inline anchors and explicit kerning

Text `alignment` is `start` (legacy default), `center`, or `end`. This is a point/baseline anchor for each explicit line or column, not a constrained paragraph frame. In legacy advance mode it measures the actual emitted run once, including whitespace advances and between-glyph tracking but excluding trailing tracking. Horizontal placement shifts X; vertical placement shifts Y while retaining right-to-left column spacing. Negative tracking uses the signed advance, including zero/negative spans. Empty lines have advance zero. Wrap width optionally composes horizontal lines with a bounded break subset; justification, complete kinsoku and automatic font fallback remain unsupported.

`kerning` defaults to true, preserving the existing horizontal OpenType renderer behavior. The new checkbox can disable it; vertical layout is unchanged. Both choices participate in evaluation caching, editable JSON and Undo / Redo, and SVG/PNG still use the same outline geometry. See product-spec section 13 for provenance and acceptance boundaries.

## Object Position references

Text uses its existing `alignment` (`start`, `center`, `end`) as the inline Position reference: Left/Center/Right for horizontal text, Top/Center/Bottom for vertical text. New Text nodes set `referenceBounds: "visible"`: the actual shaped Bézier ink bounds are measured independently for each nonempty line/column, so different text and font sizes share exactly the same visible right edge when their X Positions match. Whitespace-only lines fall back to finite advance placement. `referenceBounds: "advance"` preserves the previous advance-width behavior, including whitespace and signed tracking. Missing `referenceBounds` means `advance`, so saved legacy projects do not move.

`crossAlignment` is `origin` (first horizontal baseline / first vertical column center), `start`, `center`, or `end`. Non-origin values align the whole block's visible cross-axis bounds: Top/Center/Bottom horizontally, Left/Center/Right vertically. Missing values mean `origin`. Cross-axis bounds exclude empty lines. This setting is independent of inline visible/advance measurement.

Changing a reference keeps the numeric Position unchanged and repositions the geometry. Editing text, font, or size keeps the chosen reference fixed. There is one inline reference control, reusing alignment, rather than a second conflicting text anchor. Position OUT exposes the unchanged reference Vector2. Optional Wrap width retains these anchors; no bounded-height paragraph frame is introduced. Transform's Anchor remains the separate transform pivot.

## Independent character position prototype

The Inspector's Character position mode keeps one editable Text and applies sparse per-character local XY offsets after normal layout/alignment. It supports final-output editing through Transform and Join Geometry, bounded stable identity across verified textarea edits, cancellation, mixed numerical controls and reset. Unsupported shaping/routes do not show guessed targets. Active unresolved adjustments block artwork export while preserving editable JSON. See [Character position](character-position.md) and its [editable sample](../examples/character-position-prototype.json). Native Windows IME acceptance is reported separately from synthetic tests.

The same mode now includes per-character rotation and uniform scale, using stable logical identities and a fixed normal-layout cell center. These shape adjustments preserve advance, font size and Text Position; Reset XY and Reset shape are independent. Shape records use schema4 while older XY records remain readable. See [character shape contract](character-transform.md) and [editable example](../examples/character-transform.json).

## Range typography (schemas 5–6)

Selected characters now support sparse font, size, horizontal-width, vertical-scale, tracking and baseline-shift overrides before shaping/layout. Text-level Auto/Manual leading is also available. This extends the whole-Text controls and post-layout character transforms; see [Selected-character typography](rich-text.md) for selection, inheritance, vertical semantics, line metrics, schema details and explicit remaining limits.
