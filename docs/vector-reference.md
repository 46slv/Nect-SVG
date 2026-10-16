# Same-layer Vector2 Reference prototype

Add a **Reference** node and choose a **Vector2 source · same layer** in its card or Inspector. The picker lists public Vector2 outputs only: Text **Position**, Null **Position**, Vector, Combine Vector, Vector Math operations returning Vector2, and other Reference nodes. It shows the source name, output label and stable node ID so two identically named nodes remain distinguishable. **Jump to source** selects and reveals that graph card. Expanded and collapsed Reference cards show the target and evaluated value or diagnostic.

Open [the editable sample](../examples/vector-reference-reuse.json). **Master Position reference** reads **Master title · Position**, then **Caption offset** adds [0, 90] before the caption. Move **Shared origin**, or edit its Position; both text objects follow. **Equivalent wired offset** receives the same Text Position via an ordinary wire and computes the same value for comparison. The sample uses the bundled font and requires no external asset.

## Value and coordinate contract

Reference is a non-rendering, read-only Vector2 output. It reads an existing public output; it does not copy that output's last value or provide its own fallback. Normal source evaluation, including connected input → expression → direct value priority, remains unchanged. Reference has no canvas handle or upstream write-through. A follower remains an ordinary connected input and cannot drag its reference source indirectly.

Text Position is its evaluated saved reference point before downstream Transform. It can be read without generating its font outlines. Other Vector2 outputs keep their own meaning, including direction or offset vectors. Reference does not infer world coordinates, convert spaces, follow a selected Transform branch, or use a node name as an expression. Cross-layer targets, arbitrary property paths, dynamic output types and automatic offsets are outside this slice.

## Explicit dependency and errors

Every Reference target is an explicit dependency in the same node-level graph as normal wires. Both setters reject direct or indirect cycles atomically, including cycles passing through inactive saved inputs. Reference chains obey the existing 256-node evaluation depth bound. Changing a Vector Math source to a Scalar-producing operation is rejected while a Reference reads its output.

The target is validated and evaluated before a Reference cache entry can be reused. Cache identity includes the reference descriptor and upstream output revision. Editing, retargeting, deleting and restoring a source therefore cannot return a stale cached value as a valid reference.

A new or cleared Reference displays **Reference target is not selected**. Deleting the source retains its ID and port as a dangling target and displays **Reference target is missing**. The downstream artwork fails evaluation/export when it requires that Reference; it never silently receives [0,0] or the old cached value. An unused dangling Reference is visible on its card but does not block independent artwork. Ordinary wire deletion continues to clear wires and use their retained direct/expression fallback. Neither behavior rebinds to a new node with the same name. Undo restores the source and link; Redo returns the diagnosed missing state. Clearing or choosing another target is one Undo step. Layer locks disable target edits but still allow Jump.

## Saved model and duplication

A Reference node has no ordinary input parameters. Its `reference` is either `null`, or exactly `{ "nodeId": "stable-node-id", "portId": "output" }`. `output` names the existing default output explicitly; Text Position uses `portId: "position"`. The Reference node itself keeps one default Vector2 output, so its downstream wires use the existing omitted `sourcePort` convention.

Malformed IDs/descriptors, unknown fields or ports, non-Reference nodes with reference metadata, wrong output types and existing targets in another layer are rejected on import. Genuine missing IDs remain loadable and diagnosed, allowing a document with a deleted target to be saved and repaired. Validation checks all layer ownership after reading the document, so a target in a later layer cannot masquerade as a missing same-layer node.

Old schema 1/2/3 files retain their existing migration behavior. No new schema version is needed; Reference is a new node type within the current model. Older app versions are not guaranteed to read it. Save/reload preserves IDs, port selection and dangling state.

**Duplicate** on a selected card duplicates all selected cards when multiple cards are selected (Shift-click graph headers); otherwise it copies that card alone. Internal wire and Reference node IDs are remapped to the new copies. External and dangling references keep their original targets. Copying a Text and Reference together retains the `position` port. The operation is one Undo step and does not redirect original followers.

Point-edit provenance is deliberately bounded: duplicating an edited **Path Remap** together with its directly wired source is refused before any copy is added, because generated point IDs would need a separate provenance-remapping design. Duplicate that Remap individually to keep edits against its existing source. This guard avoids silently losing edits while allowing the value/Text Position/Reference group copies in this experiment.

## Verification

- `tests/vector-reference.test.js`: public target types, effective values, dependencies, cache retarget/delete/revival, cycles through wires and inactive parameters, source-operation type protection, rename, same-name identity, dangling save/load, Undo/Redo, batch internal/external remapping, point-provenance guard, malformed/cross-layer import, legacy fixtures and ordinary-wire sample equivalence.
- `tests/vector-reference-dom.test.js`: picker and visible diagnostics, atomic cycle rollback, Jump, source edits, collapsed cards, multi/single duplicate, delete/Undo/Redo/reload, explicit clearing, locked-layer refusal and read-only navigation.
- `tests/vector-reference.e2e.js`: real Chrome picker/cycles/source update, Jump, group duplicate, collapsed labels, deletion/history/reload, rename/locks, byte-identical SVG against the ordinary-wire version, PNG export and screenshots. It is part of the existing Windows `test:e2e` suite and writes `workflow-vector-reference.json`, `.svg`, `.png`, and `vector-reference-ui.png` to CI evidence.

Local unit/DOM, formatting and production build are checked separately from browser evidence. Local Chromium launch has an established socket EPERM restriction; no repeated launch attempt was made for this slice. Chrome interaction and Windows NSIS package acceptance remain pending the exact published commit's CI. Native WebView2, IME, high-DPI and OS dialogs remain separate acceptance checks.
