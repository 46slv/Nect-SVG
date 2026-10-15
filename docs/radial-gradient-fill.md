# Radial Gradient Fill

Add **Radial Gradient Fill** from the node menu after geometry operations and before Output. Connect a Path or PaintedPath to `path`; the node replaces only fill and outputs PaintedPath. Stroke, compound holes, independent contour groups, bounds, fingerprints and character identity/occurrences remain unchanged. A later solid or linear Fill replaces the radial paint; a later Stroke preserves it.

Graph and inspector share these typed controls:

- `center`: Vector2 in absolute artboard px, each component from −100000 to 100000.
- `radius`: Scalar, from 0.0001 to 100000 px, inclusive.
- `startColor` / `endColor`: Color (`#RRGGBB` plus independent alpha 0–1), at fixed stop offsets 0 and 1. RGB is retained even when alpha is zero.
- Direct values, compatible source nodes, saved disconnect fallbacks, locks, Undo/Redo and JSON roundtrip use the existing parameter system. Center and radius also accept typed expressions; Color expressions remain unsupported. Invalid direct edits roll back; invalid resolved values produce an explicit evaluation/export error.

The 0.0001 px minimum and coordinate/radius caps are deliberate application limits, not SVG validity rules. Zero-radius SVG has degenerate semantics and is outside this subset. No new JSON schema version is needed; older applications reject the unknown node type.

## Artboard coordinates and shared rendering

The ramp is a concentric circle: at distance `d` from center, the interpolation fraction is `min(d / radius, 1)`. The outer color is held outside the circle (`pad`). Geometry / Transform / Repeater must come **before** painting. Upstream transformed or repeated geometry does not move, scale or duplicate the paint server. All copies share the same artboard-space circle. Joined independent paths are painted separately, retaining denser transparent overlaps; they are not unioned.

Canvas, SVG and transparent PNG use the same SVG scene renderer. One deterministic scene-local gradient ID is allocated per top-level layer, shared across its contour groups. Mixed linear/radial layers cannot collide, even with duplicate layer names or user IDs. Radial output explicitly writes `gradientUnits="userSpaceOnUse"`, `cx/cy/r`, `fx=cx`, `fy=cy`, `fr="0"`, `spreadMethod="pad"`, `color-interpolation="sRGB"`, and two independent `stop-opacity` values. PNG rasterizes that same scene.

There is no focal offset, focal-circle radius, elliptical/aspect-ratio transform, angle, extra stop, midpoint, gradient stroke, freeform gradient, perceptual interpolation, per-copy paint or on-canvas radial handle. The center may be offset relative to a shape while remaining concentric with its own outer circle. General Illustrator SVG is not an accepted input contract.

## Safe SVG reopening

Open [the editable JSON sample](../examples/radial-gradient-fill.json) to retain the complete procedural graph. Import [the exported SVG sample](../examples/radial-gradient-fill.svg) to reopen evaluated artwork as Imported Path → Path Remap → Radial Gradient Fill → optional Stroke → Output. The sample includes a shared circular ramp across five repeated rectangles, a transparent-center ellipse with independent stroke, and a linear ramp in the same scene. SVG reopening does not reconstruct procedural sources, expressions, locks or editable text.

The detached XML parser accepts root-level `defs` with direct `radialGradient` or the existing supported `linearGradient` definitions. Radial definitions must contain every attribute emitted above with finite unitless numeric coordinates, bounded radius/center, numeric equality of fx/cx and fy/cy, fr=0, and exactly two direct stops with literal offsets `0` then `1`. Colors retain the existing solid hex/basic named-color whitelist; stop opacity is 0–1 (default 1). Only exact local `url(#id)` fills resolve, including forward references. IDs are unique across all elements. Each imported paint has independent editable values even when multiple shapes use one source definition.

Inherited fill-opacity is folded once into both stop alphas. Independent stroke alpha/width/cap/join/dash/miter/offset, layer order/names, compound holes and separately painted groups survive. Object/group opacity remains unsupported. No focal defaults are silently assumed, and unused definitions are validated too.

Existing namespace, attribute, structure and resource guards are unchanged. External URLs/data URLs, href/xlink inheritance or cycles, scripts/events, CSS/style, all shape/group/gradient transforms, missing/duplicate references, gradient strokes, percentage units, alternate spread/interpolation modes and unsupported focal values reject the whole import. Parsing never hands untrusted markup to a rendered browser element or Paper's SVG importer. Failed file imports leave the project and Undo/Redo state intact.

Linear and radial definitions share the existing budgets: 10 MB UTF-8, 4096 elements, depth 64, 256 gradients, 2048 shapes, 1000000 aggregate path characters (100000 per path), 10000 contours and 100000 points. Project limits, including 100 layers and 256 independently painted paths per joined group, still apply. Unsupported files are rejected rather than approximated.

## Research and adaptation

[SVG2 radial paint servers](https://www.w3.org/TR/SVG2/pservers.html#RadialGradients) define outer and starting circles and unpremultiplied component interpolation. `userSpaceOnUse` still follows a referencing element's coordinate system, so transforms are rejected to retain this absolute-artboard circular contract. [SVG2 color interpolation and fill opacity](https://www.w3.org/TR/SVG2/painting.html#ColorInterpolationProperty) distinguish sRGB interpolation, per-stop alpha and fill opacity. [SVG1.1](https://www.w3.org/TR/SVG11/pservers.html#RadialGradients) defines a zero-radius fallback; refusing it here is intentional.

At pinned Nect commit `c97d5229455a5b4db9c057d79fe0dadf2ad901a0`, [shape evaluation](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/shape.cpp#L452-L466), [SVG export](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/io.cpp#L3193-L3215) and [radial tests](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/tests/gradient_tests.cpp#L457-L460) provide the reusable paint model. Native Nect maps start to center and endpoint distance to radius, with user-space/pad/sRGB and independent alpha. This implementation uses a direct radius control and the existing typed Color interface.

The [pinned native importer](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/desktop/svg_import.cpp#L358-L410) rejects all focal attributes, including explicit concentric ones. Nect-SVG intentionally requires explicit fx/fy/fr for its own roundtrip. Accordingly, these files are not claimed to roundtrip directly through that native importer. Nect also supports broader stop counts and transformed artwork; none of that is silently copied into this subset.

Adobe's [radial-gradient controls](https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-gradients/create-and-apply-radial-gradients.html) include additional aspect ratio, angle, focal-point and origin controls. The reusable portion here is circular, concentric, two-stop Classic interpolation. Adobe says [Perceptual gradients rasterize on SVG export](https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-gradients/control-perceptual-interpolation-in-gradients.html). This is documentation-based research; Illustrator execution/visual equivalence has not been performed.

## Verification

- `radial-gradient.test.js`: strict descriptor shape, copies, accessors, finite bounded center/radius, color/alpha, explicit safe ID and deterministic markup.
- `radial-gradient-pipeline.test.js`: paint order, typed source/fallback/lock/expression/history behavior, invalid dormant values, unchanged geometry/groups/text metadata, mixed paint IDs, SVG reopen and sample CLI/JSON parity.
- `radial-gradient-import.test.js`: forward/shared references, editable remapped paths, independent alpha/stroke, compound holes, mixed paint grouping, minimum radius, hostile/unused definitions and aggregate gradient budget.
- `radial-gradient-dom.test.js`: graph/inspector controls, radius validation/cancelled scrub, source menus, fallback/lock/history and atomic file import/repeated Undo/Redo.
- `radial-gradient.e2e.js`: real Chrome controls, analytical circular RGB/alpha and pad samples, equal-distance points, transparent independent overlaps, mixed linear/radial ID separation, full RGBA SHA-256 equality across SVG/PNG and their reopened copies, JSON reload, hostile import refusal, external-request/page-error checks and screenshot.
- `production-csp.e2e.js`: mixed radial/linear sample in the production bundle under native CSP, with eval still blocked.

Browser assertions are configured in the existing Windows workflow. Configuration is not a passed run; actual results belong to the exact published commit. Native WebView2 interaction, signed installation and release readiness remain separate unverified gates. Dependencies are unchanged, retaining the previous Vite/HappyDOM advisory fixes.
