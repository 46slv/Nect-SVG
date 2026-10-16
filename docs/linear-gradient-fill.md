# Linear Gradient Fill

Add **Linear Gradient Fill** from the node menu. Connect a shape through any geometry operations, then through this node and optionally Stroke to Output. The graph and inspector expose the same controls:

- `path`: PaintedPath input, also accepting an unpainted Path through the existing compatibility rule.
- `start` / `end`: Vector2 in absolute artboard px, including negative coordinates. Each accepts a direct value, Vector2 expression or Vector2 source and a lock. Their resolved distance must be finite and nonzero.
- `startColor` / `endColor`: the existing Color type, `#RRGGBB` plus independent alpha from 0 to 1. Color nodes, fallback restoration on disconnect and locks work as for solid Fill. Color expressions are unsupported.
- Output: PaintedPath. No new socket type or conversion is introduced.

The two stops are fixed at 0 and 1. This node replaces only the fill channel, preserving stroke, contours, independent groups, character IDs/occurrences, fingerprints and bounds. A later solid Fill replaces this gradient; a later Stroke preserves it. Place Boolean, Join Geometry, Transform, Path Remap and Geometry Repeater **before** painting: those geometry inputs continue to reject PaintedPath.

## Coordinates and export

Endpoints are evaluated in artboard coordinates where paint is applied, after upstream geometry operations. Transforming or repeating geometry does not transform or repeat the paint server. All upstream repeated copies share one spatial ramp. Joined/repeated independent contour groups remain separately painted (transparent overlaps may become denser), but reuse one gradient definition.

Canvas, SVG and PNG use the same SVG renderer. It emits a scene-local deterministic ID per top-level layer, a single `<defs><linearGradient>` definition for that layer, `gradientUnits="userSpaceOnUse"`, `spreadMethod="pad"`, explicit `color-interpolation="sRGB"` and independent stop-opacity attributes. Layer names and user-controlled IDs cannot collide with these allocated paint IDs. PNG rasterizes the same SVG scene. Existing solid fill/stroke markup is unchanged.

Save **editable JSON** to reopen this graph, including sources, fallbacks, expressions and locks. SVG is the evaluated artwork. The safe SVG importer reopens the exact supported exported subset as Imported Path → Path Remap → Linear Gradient Fill → optional Stroke → Output. Endpoint/color/alpha controls and remapped geometry are editable; the original procedural graph, sources, expressions, locks and text are not recovered. Outlined SVG text becomes paths, not editable Text nodes. A rejected import leaves the current project intact. No new JSON schema version is required for the typed node; older applications reject its unknown node type rather than silently changing the artwork.

The first version deliberately has two stops and a linear ramp. A separate [Radial Gradient Fill](radial-gradient-fill.md) supports a bounded concentric circle with its own safe SVG reopening. Extra stops, midpoint controls, freeform gradients, gradient strokes, per-copy ramps and on-canvas endpoint handles remain separate work.

## Safe SVG reopening contract

Import [the exported SVG sample](../examples/linear-gradient-fill.svg) with **Import SVG**. The importer validates a detached XML document before changing the open project. It accepts only root-level `defs` containing direct `linearGradient` definitions (or the separately specified concentric radial subset) with unique bounded ASCII IDs, explicit `userSpaceOnUse`, finite distinct unitless endpoints, explicit `pad` and `sRGB`, and exactly two direct stops at literal offsets `0` then `1`. Stop colors use the existing `#RGB`, `#RRGGBB`, black/white/red/blue/green whitelist; stop-opacity is 0–1 (default 1). Only exact local `url(#id)` fills resolve, including forward references. Each imported paint owns independent editable endpoint/color values even if source shapes shared a definition.

Inherited fill-opacity is folded once into both stop alphas. Solid stroke and its independent opacity, width, cap/join, dash, miter limit and offset survive. Layer names, shape order, compound holes and separate same-paint contour groups survive; overlapping transparent groups remain separately painted, not unioned. Group/object opacity remains unsupported because it is not equivalent to per-shape or per-stop opacity.

All definitions, including unused ones, are validated. Duplicate/missing IDs, external URLs/data URLs, href/xlink inheritance and cycles, scripts/events, CSS/style, gradient/shape transforms, unsupported radial definitions or gradient strokes, more stops, percentages/alternate units, implicit endpoint/default gradient modes, masks/filters, foreign namespaces and unsupported nesting reject the complete import. No fallback color or silent approximation is used. The parser never hands untrusted markup to a browser element or Paper's SVG importer. Nect's broader SVG importer and arbitrary Illustrator SVG are not implied by this subset.

Budgets: 10 MB UTF-8; 4,096 elements; nesting depth 64; 256 definitions; 2,048 shapes; 1,000,000 aggregate path characters (existing 100,000 per path); 10,000 contours and 100,000 points in aggregate across paths and primitives. Existing project limits still apply, including 100 resulting layers, 2,000 nodes per layer and 256 independent paths per joined group. Exceeding a budget rejects atomically. JSON remains the full project format.

The import adaptation follows Nect's [two-phase local reference checks](https://github.com/46slv/Nect/blob/ee79ebf93f953d217de182188ee963760117916e/src/desktop/svg_import.cpp#L321-L438), restricted to our existing two-stop node, and the [SVG2 paint-server definitions](https://www.w3.org/TR/SVG2/pservers.html). SVG2 permits a broader language, including inherited paint servers, percentage coordinates, multiple stops and degenerate gradients; rejecting those here is intentional.

## Source adaptation and verification

The SVG paint-server structure follows the existing [Nect SVG exporter](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/src/io.cpp#L3193-L3215) and [gradient tests](https://github.com/46slv/Nect/blob/c97d5229455a5b4db9c057d79fe0dadf2ad901a0/tests/gradient_tests.cpp#L403-L438). Nect-SVG adapts that structure to its absolute artboard coordinates, Color alpha, typed Path/PaintedPath boundary and grouped renderer; it does not copy Nect's full renderer or claim Illustrator parity.

- `tests/linear-gradient.test.js`: strict immutable descriptor validation, defensive copies, finite/distinct endpoints, two-stop alpha markup and safe explicit IDs.
- `tests/linear-gradient-pipeline.test.js`: paint order, source/fallback/locks/history, type errors, invalid inputs, group ID reuse, multi-layer IDs, geometry/character metadata, supported SVG gradient reopen and JSON/CLI parity.
- `tests/gradient-import.test.js`: sample roundtrip, editable gradient/remap, forward/shared references, 256-group boundaries, hostile/unused definitions, namespace/structure validation and resource budgets.
- `tests/linear-gradient-dom.test.js`: graph/inspector controls, direct edits, validation rollback, typed menus, locks, disconnect restoration, actual file-open atomic refusal, repeated imports and one-step Undo/Redo.
- `tests/linear-gradient.e2e.js`: real Chrome controls, exported SVG/transparent PNG color and alpha samples, group reuse, multi-layer separation, saved JSON reload, SVG reopen, full RGBA SHA-256 equality for original/reopened SVG/PNG, post-import editing, late-invalid/malformed XML refusal, no external resource requests, one-step Undo/Redo and screenshot. Included in Windows CI; a configured test is not itself a successful run.

Open `examples/linear-gradient-fill.json` for a shared ramp across five repeated rectangles, independent-alpha stops and a diagonal gradient with stroke.
