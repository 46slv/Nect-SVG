# Nect SVG

A node-authored vector editor, designed for a **Windows desktop app**, with a reusable browser editor and headless SVG engine. Separate from Nect and Nect-Cloud.

## Run the editor

Node 22+ is recommended.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run check
```

The workspace uses a white/silver interface, lower resizable graph, right Layers/Inspector and square artboard. Each layer owns a separate graph. Circle, Ellipse, Rectangle, Curve and Text feed Boolean, Transform and Path Remap, then explicit Fill / Stroke nodes and Output. Scalar/Vector/Boolean/Color value nodes connect to matching parameter fields. Expressions support arithmetic and a small numeric function allowlist, never JavaScript evaluation.

- Pen: click corner points, drag Bézier handles, click the first point to close, Escape to finish open.
- Select a generator node, then drag the canvas to move its own parameters. Locked, connected or expression-driven positions refuse movement.
- Select one existing Transform for uniform Scale and Rotate canvas handles (Shift: 15° rotation). The fixed pivot is Anchor + Offset; children stay editable. Controls explicitly show the selected Transform output before downstream nodes. See [the handle contract and example](docs/transform-canvas-handles.md).
- Node graph navigation: middle-button drag, Ctrl/Cmd+Shift+drag or Space+drag pans; Ctrl/Cmd+wheel zooms (25–200%). Ctrl/Cmd+1 restores actual size while the graph is focused; Home resets zoom and scroll. Plain wheel/two-finger scrolling remains available. Form controls do not start graph navigation.
- Drag nodes near a graph edge to scroll continuously, even with the pointer outside the panel. Right/bottom bounds grow with the drag; left/top stop at the existing nonnegative origin. Escape, pointer cancellation or focus loss rolls back the drag. A completed drag is one Undo step, and JSON keeps world positions.
- Drag an output to a matching field. A blue dashed preview wire follows the pointer from the selected output, including Separate X/Y and collapsed nodes; Escape, pointer cancellation or focus loss clears it. Connected inputs appear alongside that field. Drag input to empty graph space or right-click it to disconnect and restore fallback.
- Math and XY: Vector → Separate Vector exposes distinct X/Y Scalar outputs. Adjust either axis with Math, then use Combine Vector to rebuild a 2D position or size. Math supports Add, Subtract, Multiply, Divide, Min, Max, Abs and Clamp. Only active inputs are shown/evaluated; switching operations preserves hidden values and connections. Divide by zero returns 0; nonfinite values and reversed Clamp bounds are errors.
- Vector Math: 2D componentwise Add/Subtract/Multiply/Divide, Scale, Normalize, Length, Distance and Dot. Length/Distance/Dot return Scalar; the others return Vector2. Operation changes that would break any existing connection are rejected without removing wires. Zero-length Normalize returns [0, 0].
- Paint: geometry owns size and position; Fill owns color/alpha and Stroke owns color/alpha/width (px). Connect geometry → Fill → Stroke → Output, or use Stroke alone for an outline. Each paint node preserves the other channel; the last node of the same kind wins. Geometry operations go before paint. A bare Path connected directly to Output has no implicit paint. Shape tools and “Use as output” add an explicit Fill for convenience.
- Color: a Color node connects to Fill or Stroke → color. Disconnect restores the saved paint fallback. SVG and transparent PNG retain independent fill/stroke alpha. Older JSON projects migrate to explicit Fill nodes when opened, preserving appearance and connections; save explicitly to keep the new version.
- Windows Text inspectors automatically list faces from standard system/user Fonts folders, including static TTC/OTC faces; selecting a face embeds only that font. Variable/color faces are disabled. Browser/manual file loading remains available.
- Text supports local static TTF/OTF loading, Japanese outlines, multiline text, horizontal/vertical writing, letter spacing and line/column spacing. Saved JSON embeds the font for later editing; check its license before sharing. See [typography and limits](docs/typography.md).
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

In **Character position**, adjust **Rotate °** and **Scale ×** alongside XY without changing font size, advances or Text Position. Mixed selections use each character’s fixed cell pivot; separate XY/shape resets keep intent clear. Try [the editable character-shape sample](examples/character-transform.json) and see [pivot, schema4 and verification boundaries](docs/character-transform.md).
