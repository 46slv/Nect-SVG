# Closed Path Offset

**Path → Path**, before Fill / Linear Gradient Fill / Stroke. This first bounded version offsets one ungrouped collection of closed nonzero-winding regions. It does not implement open-path stroke expansion or silently merge independently painted groups.

Open [the editable sample](../examples/closed-path-offset.json) for miter, true bevel, round and a negative inset with a counter. Select the Offset node and change `amount`, `miterLimit` or **Join**. Scalar sources and expressions drive both numeric controls. Disconnect restores the saved fallback; parameter locks and layer locks apply. Each completed edit or scrub is one Undo step; Escape, pointer cancellation or focus loss cancels a scrub. JSON retains the graph and settings; SVG/PNG contain the evaluated result.

## Distance, joins and geometry

- Positive `amount` expands filled areas and contracts holes. Negative values inset filled areas and expand holes. Full erosion is a valid empty result, never a substituted original shape.
- Distance is measured in evaluated artboard px, after upstream transforms. A downstream Transform scales the offset result too. Put paint after all geometry operations. A PaintedPath or Image socket cannot feed Offset.
- `amount = 0` returns the exact input geometry, IDs, handles and metadata without flattening, including open/grouped inputs. Nonzero amounts have magnitude at least 0.0001 px.
- Joins: **miter**, **bevel**, **round**. Miter limit is a ratio from 1 to 100. Over-limit miters use a true bevel, not Clipper's square fallback. Miter limit is retained for all join modes.
- Cubics become closed polygons with zero handles and new derived IDs. Disjoint ungrouped regions can merge during expansion; regions can split during erosion. Source geometry remains editable and unchanged.
- Explicitly open, crossing, touching, overlapping or degenerate boundaries are rejected. Grouped Join Geometry output is rejected: offset its individual inputs before joining. Repeater output without contour groups can be admitted only if its boundaries satisfy the same non-touching region contract. Use Offset before Repeater when each copy should retain its own geometry.
- Source changes, upstream source reroutes (even identical coordinates), Offset settings or resulting topology changes suspend downstream Path Remap edits. Definitions stay saved and can be explicitly rebound. Nonzero Offset also disables direct canvas character editing through that route. Zero bypass preserves the original route and identities.

## Precision and work limits

Fixed kernel grid: **0.0001 px**. Cubic flattening and round-arc tolerances are **0.1 px** in the node. Round tolerance is additionally capped at `abs(amount) / 4`. These are component approximations, **not a universal final offset error bound**: acute intersections/miters and topology changes can amplify error. Tightly spaced curves or large-coordinate restoration can be rejected if topology cannot be certified. No contour is silently simplified to make it pass.

The reusable pure kernel retains its independently qualified limits: 2048 flattened input vertices, 4096 output vertices, 8 million edge-pair checks and 100000 estimated join vertices. The synchronous editor and CLI graph use stricter admission/work limits:

- 32 input contours and 256 authored points
- 256 flattened input vertices; 4096 subdivision nodes; depth at most 24
- 300000 combined input/output topology edge-pair checks
- 4096 estimated construction/join vertices, checked before engine execution
- 512 output vertices, checked before output topology validation
- At most 8 nonzero Offset nodes in one evaluated graph, including cached nodes

These limits reject work explicitly; they do not change tolerance or drop vertices. They can only tighten the qualified kernel budgets. Coordinate/handle magnitude is at most 1e12; the local geometry plus maximal join reach and 1 px margin must remain below approximately 107374 px. Actual admitted ranges can be smaller because of precision/topology guards.

Accepted 4/128/256-vertex regular-polygon fixtures at both signs and all three joins measured about 4 ms maximum in the implementation workspace (2026-10-15). The regression alarm is intentionally coarse (2 seconds per fixture), not a latency promise. Worst-case runtime is not proven. The kernel is synchronous and has **no hard cancellation or wall-time guarantee**. The editor checks before retaining a numeric preview, before replacing a gesture preview, and before committing gesture history. Unsupported/over-budget geometry keeps the previous document/preview; imported invalid graphs show explicit diagnostics. Disconnected inputs remain allowed while wiring a graph.

## Dependency and implementation contract

The geometry engine is exactly `clipper2-ts@2.0.1-18`, no runtime transitive dependencies or WASM initialization. The [Boost Software License notice](../public/licenses/clipper2-ts-BSL-1.0.txt) is distributed in the production `licenses/` assets.

`src/clipper-adapter.js` overrides runtime-private `doSquare` and `doMiter` to provide true bevel policy. This is a deliberate maintenance risk. Tests pin SHA-256 hashes of the dependency's Core.js, Engine.js and Offset.js; updates require requalification. Do not change the exact pin or apply property mangling across this seam. The production build keeps the unchanged native CSP, with no eval or remote code loading.

The pure APIs `offsetClosedPath` and `offsetClosedPathDetailed` are in `src/closed-offset.js`. The detailed result separates cubic flatness, grid displacement, arc sagitta and construction rounding; `finalOffsetErrorBound` remains null. The optional fourth argument only tightens counted work limits; it cannot change the grid/range/depth constants or expand qualified limits. The input is never mutated, including failures. A zero amount bypasses options/work-limit validation and returns the original object.

Stable error codes include OFFSET_AMOUNT, OFFSET_OPTIONS, OFFSET_OPEN_PATH, OFFSET_UNSUPPORTED, OFFSET_GEOMETRY, OFFSET_UNCERTAIN_TOPOLOGY, OFFSET_PRECISION, OFFSET_RANGE, OFFSET_LIMIT and OFFSET_KERNEL. Source validation uses exact integer orientation; final restored floating-point coordinates are revalidated on an exact dyadic grid.

## Verification boundaries

The retained 31 kernel tests cover rectangle area/bounds oracles, holes/winding, curve flattening, erosion/splitting, topology/precision rejection, limits, immutability and pinned source hashes. Application tests add typed inputs, paint retention, transform space, provenance-safe Remap, JSON/export, atomic history, locks, repeated/cache behavior, bounded work and sample roundtrip. Synthetic DOM exercises controls and repeated/cancelled/rejected scrubs. Real Chrome and production-CSP scripts execute the sample and verify alpha pixels.

Local Chromium launch is blocked in this workspace by `process_singleton_posix` socket permission, before any browser assertions. Actual Chrome/CSP execution and Windows packaging require the exact commit's CI. Native WebView2 interaction is a separate unverified acceptance step. This feature is bounded geometry processing, not a claim of complete Illustrator or native Nect offset equivalence.
