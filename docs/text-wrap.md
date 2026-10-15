# Wrap width · auto height

Text can compose horizontal lines to an optional **Wrap width** without adding newlines to the editable source. Choose **Horizontal line composition → Wrap width · auto height** under Text, then enter a positive width up to 100000 document px. New settings start at 320 px. The [editable sample](../examples/text-wrap-width.json) compares Latin words, Japanese punctuation groups and an intentionally overflowing word.

Width controls line composition. Height grows with content. There is no frame height, clipping, truncation, ellipsis or automatic font scaling. An indivisible span wider than the width remains intact and shows a visible overflow warning; export retains all its outlines. Width is an advance budget, not an ink-containment promise. Font overhangs, visible-outline references and post-layout character adjustments may extend beyond it.

## Composition and spaces

The named **Nect Japanese/Latin break subset v1** separates legal boundaries from greedy fitting. It is not complete Unicode UAX #14, Japanese kinsoku or Adobe/DirectWrite pixel parity.

- A complete run of ASCII U+0020 or ideographic U+3000 spaces provides a boundary after that run, unless it would strand an opening bracket or start the next line with a prohibited character.
- Boundaries around Han, hiragana and katakana are allowed when both neighbors are Japanese, Latin letters/numbers or members of the named punctuation tables below. Contiguous Latin words/numbers stay intact. Unknown punctuation and other-script runs remain conservatively unbroken. For example `ア。ABC12` stays together because the boundary between the punctuation and Latin has no Han/kana neighbor.
- No break immediately after `([{（［｛「『【〔〈《〖〘〚`.
- No break immediately before `)]}）］｝」』】〕〉》〗〙〛、。，．！？!?.,:;：；ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーｰ々ゝゞヽヾ〻`.
- NBSP U+00A0 and narrow NBSP U+202F never create a break. No emergency splitting violates the bracket/nonstarter rules, even at tiny widths.
- Existing CRLF/CR and NFC normalization is retained. Explicit newlines, consecutive blank lines and a trailing newline retain their meaning. U+2028/U+2029, tabs, unsupported combining marks, variation selectors and control characters reject wrapped layout explicitly.

Candidates are visited in source order. If the next complete span exceeds the width, the last accepted boundary ends the line. The first indivisible span always makes progress, including an overlong span. Signed negative tracking is retained; the algorithm does not use binary search or assume candidate advances increase monotonically. A later negative-tracking span does not retroactively undo an earlier greedy break. Each indivisible span also keeps its own overflow diagnostic even if a negative gap brings the whole line’s signed endpoint back inside the width.

Every source space and stable character ID is retained. At a soft break, the complete separator run belongs to the preceding line but is excluded from that line's fitting/alignment advance. Its character records and whitespace selection cells remain editable. Explicitly leading spaces retain their advance; trailing spaces at an explicit newline or end of text keep the previous behavior. All-space hard lines remain one line. No soft empty line is created from a separator-only prefix.

## Typography, anchors and source identity

Fonts/styles are resolved first. Each contiguous equal-font/size run within a hard line is shaped once. The verified per-character records feed both constant-time candidate measurement and actual wrapped rendering. Font kerning, font size, horizontal width and tracking affect composition; font/size boundaries stop kerning, while width-only changes preserve it. Terminal tracking and a pair contribution against the following line are excluded. Unsupported one-to-many/reordered shaping and other unverified mappings reject Wrap width; the engine does not silently disable ligatures or fall back to unwrapped export.

Vertical scale and baseline shift affect existing adjacent-line metrics, not horizontal fitting. Leading is computed after wrapping: **Auto** uses adjacent font metrics, **Manual** sets the exact baseline distance, and **Legacy** retains existing unstyled fixed spacing/rich-text metric behavior. Empty lines keep their metric defaults. Free character XY, rotation and uniform shape scale are applied afterward and never change fitting or leading.

Start/center/end advance or visible-outline references act on each composed line; cross-axis references act on the entire composed block. Position and Position OUT stay unchanged. Wrap width has no canvas resize handles in this slice.

Soft lines are derived records with normalized scalar `sourceStart`, `sourceEnd`, `fitEnd` and `breakKind` (`soft`, `hard`, `end`). They never insert newline IDs into source text, the character basis or its units. Width changes preserve IDs, styles, selection and source. Verified text edits/IME retain the existing reconciliation rules. Duplicates deep-copy wrap settings and retain Text-local character identities.

## Persistence, safety and export

Text optionally saves `textWrap: { width: 320 }`. It requires schemaVersion 8; character-record versions are unchanged. Projects without the setting retain their earlier schema and exact old geometry. Schemas 1–7 still load. Unknown keys, nonfinite/out-of-range widths, non-Text placement, vertical writing and Type on Path conflicts reject atomically. Settings are never automatically detached or discarded. Disable wrapping explicitly before attaching a path or switching to vertical writing.

Enable/disable, width changes and range style changes are one Undo step each. Escape restores the uncommitted width draft. Locked compositions block edits. Evaluation caching includes the wrap setting. Invalid changes also roll back when wrapped text is not the displayed Output. Width overflow is a warning, while unsupported/invalid composition blocks visible artwork export.

Editable JSON retains the original text, wrap setting, fonts and adjustments. Browser SVG, CLI SVG and PNG share evaluated outline geometry. SVG contains paths rather than editable paragraph text; reopening an SVG preserves outlined artwork, not this Text model. The sample embeds the limited Japanese fixture under [SIL OFL](../tests/fixtures/fonts/OFL.txt); see its [coverage/provenance](../tests/fixtures/fonts/README.md).

## Verification and boundaries

- `tests/text-wrap.test.js`: strict schema/conflicts; Latin/Japanese rules; CRLF/NFC/blank/space/NBSP cases; tiny widths and overflow; shared shaping endpoint oracles; signed tracking; mixed typography/leading; all anchors; ambiguous shaping; stable IDs/history/duplication/cache/IME; off-output rollback; exact pre-wrap geometry hashes; JSON/core/CLI equality.
- The 10000-unit stress regression asserts one shaping call and exactly 10000 shaped units, with bounded candidate measurement count, rather than a machine-specific timing threshold.
- `tests/text-wrap-dom.test.js`: actual controls, Escape, repeated width changes, range selection, composed drafts, Undo/Redo, conflicting edits, cold reopen and locks.
- `tests/text-wrap.e2e.js`: actual Chromium controls, range edits, synthetic browser IME lifecycle, interrupted inputs, conflict rollback, responsive fields, browser/CLI SVG equality, byte-identical full-RGBA raster hashes after reopen and a bilingual screenshot. Included in Windows CI; a prepared test is not a pass until observed.

Deferred: fixed-height boxes/overset, vertical wrapping, paragraph-specific styles/alignment, justification, hyphenation, indents/paragraph spacing, threading, arbitrary-shaped areas, complete Unicode breaking, complex-script shaping/bidi, and native Windows IME/high-DPI acceptance.

Design references: [Illustrator area type](https://helpx.adobe.com/in/illustrator/desktop/design-with-text/add-manage-text/add-text-to-vector-artwork.html), [After Effects paragraph text](https://helpx.adobe.com/after-effects/desktop/add-text/create-and-edit-text-layers/creating-editing-text-layers.html), [UAX #14 revision 57](https://www.unicode.org/reports/tr14/tr14-57.html), [Illustrator composition policies](https://helpx.adobe.com/illustrator/desktop/design-with-text/fonts-and-scripts/mojikumi-and-kinsoku-settings.html), and [Nect's DirectWrite wrapping/overflow behavior](https://github.com/46slv/Nect/blob/c97d522/src/text.cpp#L698-L789). These establish scope and behavior; no native backend was ported.
