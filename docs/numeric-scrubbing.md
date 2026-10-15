# Character and typography numeric dragging

The floating character palette's **ΔX**, **ΔY**, **Rotate °** and **Scale ×** inputs now use the same gesture lifecycle as graph/Inspector numeric inputs. Their Inspector copies are supported too. The original defect had two parts: the character inputs lacked the scrub opt-in, and the generic pointer handler assumed every opted-in input was a graph parameter inside a `.field[data-node]` wrapper. The floating palette has no such wrapper. Explicit Text/character target resolution now connects the real number inputs to model previews and the existing document transaction.

## Interaction contract

- Press inside the number, then move horizontally. A 4-screen-pixel dead zone preserves clicking and small hand jitter. The native right-side spinner hit area keeps its normal behavior.
- XY, rotation, size, tracking, baseline shift, manual leading and Wrap width advance by 1 displayed unit per screen pixel after activation. Uniform Scale advances by 0.01×. Selected horizontal width and vertical scale advance by 1 percentage point, converting to stored multipliers only when writing the model.
- Screen-pixel sensitivity stays the same across graph/artboard zoom. Existing numeric Shift/Alt behavior is unchanged; these inputs do not participate in artwork axis constraints or snapping.
- Click still focuses the field for typing and keyboard arrows. Typing applies one absolute value to all selected characters. A scrub adds a common delta to the original values, preserving differences in mixed selections. “Mixed” stays visible. The first selected value to reach a bound stops the group so their differences are retained.
- The floating palette stays in place while its number is being dragged, although the artwork previews live. It repositions after the gesture.
- A completed changed gesture produces one Undo. A pending typed value commits first as its own edit; the subsequent drag can be undone separately. No-op motion, returning to the origin and movement already blocked at a bound add no Undo, sparse overrides, character records or schema upgrades.
- Escape, pointercancel, lost capture and window blur restore the exact pre-gesture document and visible value, including a blank Mixed field. Late pointer events cannot revive the gesture. A different pointer cannot move or commit it.

## Supported fields and bounds

| Fields                                     | Display units      | Bounds           |
| ------------------------------------------ | ------------------ | ---------------- |
| Character ΔX / ΔY                          | local px           | −100000 … 100000 |
| Character Rotate                           | clockwise degrees  | −36000 … 36000   |
| Character Scale                            | uniform multiplier | 0.01 … 100       |
| Selected font size                         | px                 | 0.01 … 100000    |
| Selected horizontal width / vertical scale | percent            | 1 … 1000         |
| Selected tracking / baseline shift         | px                 | −100000 … 100000 |
| Manual leading / Wrap width                | px                 | 0.01 … 100000    |

Character edits retain Text Position/Position OUT, downstream transforms, unselected characters and unrelated properties. Selected typography still has its existing layout/reflow semantics. Character changes remain source-local under downstream rotation/reflection. Local numeric edits remain possible when the source mapping is valid but the output route does not allow canvas character manipulation.

The input must remain connected to the DOM, editable and enabled, and the same document layer/source/character selection must remain active. Composition locks and suspended character correspondence refuse edits. The existing graph parameter guards for locks, connections and expressions remain in force; a locked/driven Text Position does not lock its independent character overrides. Invalid layout/path/offset previews roll back to the previous valid preview. These checks apply before preview and before commit.

## Verification

- `tests/numeric-scrub.test.js`: threshold, units, finite inputs, mixed common-delta bounds and decimal/precision no-ops.
- `tests/character-numeric-scrub-dom.test.js`: actual rendered floating/Inspector fields, per-field and mixed edits, typography units, history/no-op/sparse record identity, pending draft, interruptions, readonly/disabled/detached protection, suspended correspondence, locked composition, leading and wrap width.
- `tests/character-numeric-scrub.e2e.js`: actual Chrome mouse hits on the input elements, both palettes, mixed typography, click/type/native arrows, interrupted gestures, pinned palette, zoom/modifiers and JSON/SVG persistence. Included in `npm run test:e2e`, with `test-results/workflow-character-numeric-scrub.png` as browser evidence when executed.
- Existing numeric-scrub, character-transform, rich-text, text-wrap and Shift-axis suites guard previous semantics.

Synthetic DOM results do not prove browser rendering. The known local Chrome sandbox restriction remains; actual Chrome evidence must come from the exact-commit Windows CI run. Native WebView2 acceptance remains separate.
