# Type on Path: bounded retained text

## Source-grounded scope

This slice reuses Nect's retained-attachment and sampling **design**, not its DirectWrite renderer. The exact comparison baseline is [`46slv/Nect@c97d5229455a5b4db9c057d79fe0dadf2ad901a0`](https://github.com/46slv/Nect/tree/c97d5229455a5b4db9c057d79fe0dadf2ad901a0):

- [`docs/r05-c-text-path-entry.md`](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/docs/r05-c-text-path-entry.md): editable text retained separately from one explicit path/contour, whitespace-inclusive advance span, distance/normalized anchor, reverse traversal, one closed lap and detach semantics.
- [`src/shape.cpp`](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/shape.cpp): adaptive cubic leaves, arc-length inversion, one-sided knots and rigid placement at each shaped glyph's advance midpoint.
- [`tests/text_authoring_tests.cpp`](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/tests/text_authoring_tests.cpp): exact straight/vertical/reverse oracles, an independent 200,000-step curve oracle, lifecycle, stale identity, overflow and transaction guards.

[Adobe's official Type on a Path guide](https://helpx.adobe.com/illustrator/using/creating-type-path.html) describes positioning and flipping path text, baseline/ascender/descender alignment, effects and overflow UI. This implementation covers a smaller horizontal, baseline-based, rigid-glyph subset. Reverse traversal means measuring from the opposite endpoint and reversing the tangent; it is not a claim to reproduce every Illustrator flip/effect option.

## Authored contract and controls

Text optionally retains `pathAttachment: { nodeId, contourId, startMode, start, reversed }` in project schemaVersion **7**. Both IDs are explicit, same-layer IDs. The Inspector and expanded Text node list each eligible source/contour pair, including its stable ID and open/closed state. There is no name/index/first-contour lookup. Text, embedded fonts, character IDs/styles/XY/transforms and flat Position/references remain unchanged by attachment.

- `startMode` is `distance` (document px) or `normalized` (fraction of evaluated contour length); `start` is finite and bounded to ±100000. The UI converts units without moving the anchor.
- Existing Text start alignment puts the first glyph advance at that start; center/end align the full advance-cell span there. Negative tracking that places another advance before an open start rejects rather than silently shifting the first glyph. New UI attachments initialize to normalized 0/0.5/1 according to that alignment. Glyph ink overhang does not replace advance metrics.
- An open path requires the anchor and complete advance span, including all spaces, to fit. A closed path wraps finite starts but rejects spans longer than one lap. Nothing is silently clipped, dropped, repeated or laid flat on failure.
- Horizontal, single-line text is supported. Vertical, hard line breaks and RTL ranges reject explicitly. Existing font coverage, unsupported control/combining-sequence and shaping limitations still apply.
- Detached/older schema 1–6 projects keep their existing geometry and do not gain an attachment. New fields in an older schema reject. Choosing Detached removes only the attachment; original flat Position, references and character adjustments again determine the artwork. Leading is retained but has no effect on the attached single line.

## Geometry and composition

The existing opentype.js 1.3.4 layout supplies actual glyph IDs, outlines, kerning and advances. No DirectWrite code or glyph substitution is transplanted; no code-point outline replacement is introduced. Plain ligatures remain shaped glyphs. Per-character adjustments continue to require verified one-to-one mapping; attachment rejects suspended adjustments rather than showing an unadjusted fallback as valid attached text.

1. Resolve per-character font, size, physical width/height, tracking and baseline shift with the existing horizontal text layout at local `[0, 0]`. Flat visible/cross-axis references and authored Position are retained for detach, not applied to the attached layout. Position OUT still returns the authored evaluated Position.
2. Apply the existing character uniform scale and rotation about its metric advance-cell pivot, followed by local XY. These do not reflow advances. Typography width/size/tracking do reflow them. Baseline shift remains the normal-axis offset.
3. Sample the chosen evaluated cubic contour at each **unadjusted advance midpoint**. Map the intact, already-adjusted glyph rigidly into that tangent/normal frame. Local X follows the tangent and local Y follows the clockwise normal. XY does not change the sampled location or rotate later glyphs; it shifts this glyph in its own frame. Outlines are never bent.
4. Downstream Transform/paint/output operate on the same derived path used by Canvas, bounds, SVG and PNG. Text output stays unstable for downstream vertex bindings, preserving existing Path Remap rules.

Sampling uses a 0.05 px aggregate control-polygon-excess budget, depth 20 and 4096 leaves/segments per contour; exhaustion, nonfinite/zero length and unresolved tangents reject. Interior stationary derivative roots split integration first, including curves smaller than the absolute tolerance. Five-point Gauss integration on the bounded leaves plus deterministic distance inversion returns a cubic point and analytic tangent, not a polyline tangent. Forward interior knots use outgoing direction; reverse knots use incoming direction. Numerically unresolved reversing interior cusps reject even when inversion leaves a tiny nonzero derivative; stationary monotone inflections use the agreeing neighboring analytic direction. The tests independently check curved samples to 0.1 px and tangents to 1e-4.

Numeric character typography/XY/rotation/scale controls remain usable. Canvas character dragging pauses explicitly while attached because glyphs have distinct local frames. Canvas dragging/resizing of attached Text is also disabled; use its size field, start anchor, source path or downstream Transform. Detach restores ordinary canvas editing.

## Source identity and topology boundaries

The first slice accepts stable evaluated Curve/primitive contours, including valid Transform and Path Remap results. Source geometry and source transforms are sampled in their evaluated document plane and update attachment geometry through the normal dependency/cache graph. Rename/reorder do not retarget. Source deletion while dependent text remains, cycles, missing/wrong-kind/cross-layer sources and stale contour IDs reject. Deleting both source and consumer in one model transaction is possible.

Unstable generated contours, including imported path data, Text outlines, Boolean, Join Geometry, Geometry Repeater and **nonzero Closed Path Offset**, are explicitly unsupported. They are not assigned persistent IDs by their contour index. Zero Offset is the exact identity passthrough and remains eligible only when its source is eligible. A suspended Path Remap edit is propagated as a runtime diagnostic through Transform; attached text refuses it rather than sampling the partial fallback. No automatic rebind is introduced.

Duplicating Text alone retains its source/contour IDs. Duplicating source and Text together remaps the included node/contour identities; copying a source alone leaves original Text attached to the original. Existing restrictions on duplicating edited Path Remap together with its source remain in force.

Editor attach/edit/detach and source edits use candidate rollback through the existing history paths, including numeric scrubs and canvas gestures. Invalid edits do not change the document or Undo count. Loaded structurally valid but geometrically invalid projects expose their error and block visible export, so they can be repaired or detached. No renderer silently falls back to ordinary text.

## Verification and residuals

- `tests/text-path.test.js`: deterministic line/vertical/reverse/knot/seam/budget tests; 200,000-step oracle; whitespace, kerning, ligatures, typography and rigid local transforms; schema/history/cold JSON/SVG; cache/source transforms; missing/cyclic/unstable/stale sources; source-deletion/overflow rollback; duplication and Path Remap/Offset boundaries.
- `tests/text-path-dom.test.js`: actual controls, unit conversion, numeric character editing, attach/edit/detach, schema bump, locks, invalid edits, source deletion and Undo/Redo.
- `tests/text-path.e2e.js`: actual Chrome control/source-edit flow, range editing, rejection rollback, history, cold JSON/SVG and screenshot. Included in the existing exact-commit Windows development CI. Local Chromium is blocked by the host sandbox; DOM/unit results are not represented as browser results.
- `examples/type-on-path.json`: editable curved Latin sample using bundled DejaVu Sans and sparse character adjustments.

This is a development slice, not Illustrator parity or public-release readiness. Multiple lines/frames, vertical/RTL/bidi path text, arbitrary complex shaping, multiple-contour traversal, generated-contour rebind, canvas path brackets/character dragging, deform/effect modes and alternate overflow policies remain separate work. The dependency advisories recorded during the original Type on Path build were subsequently fixed by the dependency-only update; see [the current dependency evidence](dependency-security.md). That scoped dependency result is not a whole-project security assessment or native acceptance claim.
