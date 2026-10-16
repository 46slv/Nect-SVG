# Nect SVG

A node-authored vector editor, designed for a **Windows desktop app**, with a reusable browser editor and headless SVG engine. Separate from Nect and Nect-Cloud.

## Rich text

Select one character or a range to change its font, font size, horizontal width, vertical scale, tracking or baseline shift with real text reflow. Text-level Auto/Manual leading controls baseline or column distance. Use **Style selected text** below Text, or select characters on the canvas. [Editing guide, semantics and limits](docs/rich-text.md) · [Editable sample](examples/rich-text-range.json) · [Spacing/leading sample](examples/typography-spacing.json).

Horizontal **Wrap width · auto height** composes Latin words and a bounded Japanese punctuation subset without changing source text or stable character IDs. Long unbreakable spans remain visible and export intact. [Contract and limits](docs/text-wrap.md) · [Editable sample](examples/text-wrap-width.json).

## Run the editor

Node 22+ is recommended.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run check
```

The workspace uses a white/silver interface, lower resizable graph, right Layers/Inspector and square artboard. Each layer owns a separate graph. Circle, Ellipse, Rectangle, Curve and Text feed Boolean, Transform and Path Remap, then explicit Fill / Stroke nodes and Output. Scalar/Vector/Boolean/Color value nodes connect to matching parameter fields. Expressions support arithmetic and a small numeric function allowlist, never JavaScript evaluation.

- **New** creates a blank document; **+ Blank** appends an empty composition. Both preserve explicit graph editing, independent creation and Undo. Launch retains the starter demo, also available via **+ Demo composition**. [Blank-start contract](docs/blank-artwork-start.md).
- Circle, Rectangle, Polygon, Star and Text toolbar tools append independent artwork at the artboard center, preserving every previous layer. Select final artwork on the canvas or in Layers, then drag or use Arrow keys (1 unit; Shift: 10). Unsupported graphs show why whole-artwork movement is unavailable. [Creation, selection and safe placement contract](docs/artwork-workflow.md).
- Pen previews a new independent Curve artwork without rerouting earlier work. + Add node → Curve remains explicit current-composition graph editing; + Demo composition adds the starter Boolean example.
- Pen: click corner points, drag Bézier handles, click the first point to close. Enter, Escape or Finish path finishes open; Cancel path discards the draft. Each finished path is one Undo. [Draft and editing contract](docs/pen-artwork.md).
- Select a generator graph node, then drag its source-stage outline or Move node stage marker to move its own parameters. Hold **Shift** to lock horizontal/vertical from the initial movement; release it to move freely. This also covers Null/Vector position handles, Curve/Remap anchors and selected characters. [Gesture details and boundaries](docs/shift-axis-movement.md). Locked, connected or expression-driven positions refuse movement.
- Select one existing Transform for uniform Scale and Rotate canvas handles (Shift: 15° rotation). The fixed pivot is Anchor + Offset; children stay editable. Controls explicitly show the selected Transform output before downstream nodes. See [the handle contract and example](docs/transform-canvas-handles.md).
- Double-click a layer name or node title to rename it inline (F2 also works). **Hide / Show** controls layer visibility; **Bypass** temporarily skips a compatible node effect while preserving its wires and settings. [Behavior and supported identities](docs/names-visibility-bypass.md) · [Editable sample](examples/node-bypass.json).
- Layers **Forward / Backward** moves its exact row one paint position, preserving selection, graphs and assets in one Undo. Locked targets and active edits are protected. [Safe layer-ordering contract](docs/artwork-layer-ordering.md).
- View navigation: artboard and graph have independent − / actual % / + controls. **Fit artboard** centers the artboard; **100%** means one document unit per CSS pixel. **Fit all / Fit selection** frame measured graph cards, including expanded heights; **Reset view** restores graph 100% at its origin. Ctrl/Cmd+wheel zooms at the pointer; Space or middle drag pans (graph also accepts Ctrl/Cmd+Shift+drag). Plain two-axis wheel pans the artboard, Shift+wheel horizontally; graph keeps native scroll. Focus a view for +/−, Ctrl/Cmd+1 actual size, Shift+1 fit, Shift+2 graph selection. Form fields and floating controls retain their input behavior. [View semantics, limits and UI research](docs/view-navigation.md).
- Drag nodes near a graph edge to scroll continuously, even with the pointer outside the panel. Right/bottom bounds grow with the drag; left/top stop at the existing nonnegative origin. Escape, pointer cancellation or focus loss rolls back the drag. A completed drag is one Undo step, and JSON keeps world positions.
- Drag an output to a matching field. A blue dashed preview wire follows the pointer from the selected output, including Separate X/Y and collapsed nodes; Escape, pointer cancellation or focus loss clears it. Connected inputs appear alongside that field. Drag input to empty graph space or right-click it to disconnect and restore fallback.
- Math and XY: Vector → Separate Vector exposes distinct X/Y Scalar outputs. Adjust either axis with Math, then use Combine Vector to rebuild a 2D position or size. Math supports Add, Subtract, Multiply, Divide, Min, Max, Abs and Clamp. Only active inputs are shown/evaluated; switching operations preserves hidden values and connections. Divide by zero returns 0; nonfinite values and reversed Clamp bounds are errors.
- Vector Math: 2D componentwise Add/Subtract/Multiply/Divide, Scale, Normalize, Length, Distance and Dot. Length/Distance/Dot return Scalar; the others return Vector2. Operation changes that would break any existing connection are rejected without removing wires. Zero-length Normalize returns [0, 0].
- Paint: geometry owns size and position; Fill owns color/alpha and Stroke owns color/alpha/width (px). Connect geometry → Fill → Stroke → Output, or use Stroke alone for an outline. Each paint node preserves the other channel; the last node of the same kind wins. Geometry operations go before paint. A bare Path connected directly to Output has no implicit paint. Shape tools and “Use as output” add an explicit Fill for convenience.
- Closed Path Offset: signed expansion/inset of ungrouped closed nonzero regions, miter/true-bevel/round joins, zero passthrough and valid empty erosion. Put it before paint; unsupported and over-budget edits roll back. [Bounded contract and editable sample](docs/closed-path-offset.md).
- Linear Gradient Fill: two Color stops with independent alpha, Start/End Vector2 in absolute artboard px. Add it after geometry (including Transform / Repeater), before Output. Copies share one spatial ramp; Stroke is preserved. Editable JSON reopens the full graph; the safe SVG importer reopens the exported two-stop gradient artwork as editable paths and paint nodes. See [the contract and sample](docs/linear-gradient-fill.md).
- Radial Gradient Fill: two alpha-aware Color stops in an absolute artboard circle, with typed center/radius controls. Geometry and Stroke survive; mixed linear/radial SVG and PNG use shared rendering. Own exported SVG reopens safely as editable paths and paint. See [the bounded contract and sample](docs/radial-gradient-fill.md).
- Color: a Color node connects to Fill or Stroke → color. Disconnect restores the saved paint fallback. SVG and transparent PNG retain independent fill/stroke alpha. Older JSON projects migrate to explicit Fill nodes when opened, preserving appearance and connections; save explicitly to keep the new version.
- Windows Text inspectors automatically list faces from standard system/user Fonts folders, including static TTC/OTC faces; selecting a face embeds only that font. Variable/color faces are disabled. Browser/manual file loading remains available.
- Text supports local static TTF/OTF loading, Japanese outlines, multiline text, horizontal/vertical writing, letter spacing and line/column spacing. Saved JSON embeds the font for later editing; check its license before sharing. See [typography and limits](docs/typography.md).
- Manual pair kerning: put the caret between adjacent characters and choose **Kerning at cursor**, or select exactly two adjacent characters. Values use 1/1000 em, replace font kerning and keep tracking additive; explicit zero and inheritance are distinct. Horizontal, vertical, Wrap width and Type on Path share the same layout. [Contract and editable sample](docs/pair-kerning.md).
- Type on Path: retain one horizontal line on an explicit stable contour, with distance/normalized start, reverse and start/center/end alignment. Typography and local character adjustments stay editable; unsupported modes and overflow reject. [Bounded contract and editable sample](docs/type-on-path.md).
- Independent artwork copy: select final artwork and choose **Duplicate in place** in the Inspector. Complete movable shape/Text, direct Curve (2–128 anchors) and Image routes receive fresh graph IDs at the same coordinates, immediately above the source, with one-step Undo. Unsupported/extra-node graphs show a reason. Graph-card Duplicate stays a node operation. [Bounded duplication contract](docs/artwork-duplication.md).
- Whole-artwork deletion: use **Delete layer** in Layers, or select final artwork and press **Delete** with the artboard focused. One Undo restores the whole graph and selection; existing layers, settings and assets survive. Removing the last layer retains a blank composition. Locked layers and active edits are protected. [Deletion contract](docs/artwork-layer-deletion.md).
- JSON saves the current editable model (the Undo/Redo stack is session-only); SVG exports evaluated paths, not the graph.
- Undo/redo: Ctrl+Z / Ctrl+Shift+Z. Space-drag or middle-drag pans. Fit resets zoom/pan.

## Windows application

Chosen shell: **Tauri 2 + WebView2**, rather than bundling another Chromium runtime. The editor and geometry core remain JavaScript modules independent of the shell. `src-tauri/` includes a Rust host, native file dialogs, bounded reads and staged/atomic saves, CSP and an NSIS current-user installer configuration.

On a Windows development machine with the official Tauri prerequisites (Rust MSVC toolchain, Visual Studio C++ Build Tools and WebView2):

```sh
npm ci
npx @tauri-apps/cli@2 dev --config src-tauri/tauri.conf.json
npx @tauri-apps/cli@2 build --config src-tauri/tauri.conf.json
```

Windows CI has passed Rust/Tauri compilation, NSIS packaging and actual Chrome interactions. The unsigned development installer is an ephemeral CI artifact, not a published release. Native WebView2 interaction, open/save and close interruption must still be verified on Windows before claiming desktop readiness. See the exact runs and boundaries in [verification](docs/verification.md).

## Headless / future Nect integration

```sh
node cli/export.js project.json artwork.svg
```

The CLI validates the project, loads its embedded fonts and the bundled licensed font, evaluates it without a browser/DOM and writes an SVG. It refuses to overwrite an existing output. No service, cloud deployment or Nect integration is enabled by this repository.

For a practical editable exercise, open `examples/vr-converters.json`; it retains V curves, R Boolean/counter operations, secondary Remap and editable text in separate compositions.

See the consolidated [product specification](docs/product-spec.md), [architecture and public API](docs/architecture.md), [interaction contract](docs/interaction.md) and [verification / remaining work](docs/verification.md).

## Verification

`npm test` runs geometry, type/graph, persistence, safety and synthetic DOM integration tests. `npm run test:csp` builds the production bundle and checks startup in Chromium with the unchanged native Tauri CSP, including a control that confirms JavaScript evaluation remains blocked. `npm run test:e2e` runs that production CSP check followed by real Chromium flows against a running dev server; set `CHROMIUM_PATH` for your system executable. Synthetic DOM tests are not screenshot or real browser rendering proof.

Geometry: [Paper.js PathItem](https://paperjs.org/reference/pathitem/). Text outlines: bundled DejaVu Sans, license in `public/fonts/`. Windows setup: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/).

## Image workflow

Export transparent SVG or PNG (0.5×–4×) from the same artboard scene. Import local PNG/JPEG into an Image composition, move/resize it, and save embedded assets in editable JSON. Image sockets remain separate from Path operations. See [export, limits and roundtrip boundaries](docs/image-export.md).

Artwork alignment: enable **Guides → Snap artwork** to align to other visible shape, text and image layers. Try [the editable snapping example](examples/artwork-bounds-snapping.json); see [bounds, priority and compatibility](docs/artwork-bounds-snapping.md).

### Same-layer Vector2 Reference

Add **Reference** to reuse a Text Position, Null or other Vector2 output without a long source wire. The picker shows stable source identity and output, with **Jump to source**, cycle protection and explicit missing-target diagnostics. Try [the editable comparison sample](examples/vector-reference-reuse.json); [scope, persistence and tests](docs/vector-reference.md) describe the current prototype.

### Per-character shape editing

In **Character position**, adjust **Rotate °** and **Scale ×** alongside XY without changing font size, advances or Text Position. Drag inside any of these four numeric fields in the floating palette or Inspector; click to type. Selected typography and leading/wrap width numbers also support dragging. [Numeric drag behavior](docs/numeric-scrubbing.md). Mixed selections use each character’s fixed cell pivot; separate XY/shape resets keep intent clear. Try [the editable character-shape sample](examples/character-transform.json) and see [pivot, schema4 and verification boundaries](docs/character-transform.md).

Independent artwork multi-selection: Shift-click canvas artwork or Layers names, then drag a selected member or use focused-artboard arrows to translate the entire set in one Undo step. Any unsupported member blocks the complete move with a named reason. See [practice sample and operation contract](docs/multi-artwork-movement.md).

Select multiple artworks and use Inspector **Align artwork** for left/center/right or top/center/bottom alignment to the selection's final rendered bounds. Each operation is atomic and one Undo; unsupported members show a named reason and block the whole set. [日本語操作説明・契約](docs/artwork-alignment.md) · [Editable sample](examples/artwork-alignment.json).

Select three or more artworks and use Inspector **中心を等間隔** → **横方向 / 縦方向** to space their final rendered centers equally. Both endpoint centers stay fixed; ties follow document layer order. One Undo restores all changes. [日本語操作ガイド](docs/artwork-distribution.md) · [Editable sample](examples/artwork-distribution.json).

Select three or more artworks and use Inspector **隙間を等間隔** → **横方向 / 縦方向** to space final edge-to-edge gaps equally, preserving the two physical outer endpoints and artwork sizes. Negative gaps allow overlap; unstable order changes are refused atomically. [日本語操作ガイド](docs/artwork-gap-distribution.md) · [Editable sample](examples/artwork-gap-distribution.json).

複数Artworkの同じ位置への複製は [操作ガイド](docs/artwork-multi-duplication.md) と [編集用サンプル](examples/artwork-multi-duplication.json) を参照してください。
