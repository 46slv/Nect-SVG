# Nect SVG

A node-authored vector editor, designed for a **Windows desktop app**, with a reusable browser editor and headless SVG engine. Separate from Nect and Nect-Cloud.

## Run the editor

Node 22+ is recommended.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run check
```

The workspace uses a white/silver interface, lower resizable graph, right Layers/Inspector and square artboard. Each layer owns a separate graph. Circle, Ellipse, Rectangle, Curve and Text feed Boolean, Transform, Path Remap and Output. Scalar/Vector/Boolean/Color value nodes connect to matching parameter fields. Expressions support arithmetic and a small numeric function allowlist, never JavaScript evaluation.

- Pen: click corner points, drag Bézier handles, click the first point to close, Escape to finish open.
- Select a generator node, then drag the canvas to move its own parameters. Locked, connected or expression-driven positions refuse movement.
- Node graph navigation: middle-button drag, Ctrl/Cmd+Shift+drag or Space+drag pans; Ctrl/Cmd+wheel zooms (25–200%). Ctrl/Cmd+1 restores actual size while the graph is focused; Home resets zoom and scroll. Plain wheel/two-finger scrolling remains available. Form controls do not start graph navigation.
- Drag nodes near a graph edge to scroll continuously, even with the pointer outside the panel. Right/bottom bounds grow with the drag; left/top stop at the existing nonnegative origin. Escape, pointer cancellation or focus loss rolls back the drag. A completed drag is one Undo step, and JSON keeps world positions.
- Drag an output to a matching field. Connected inputs appear alongside that field. Drag input to empty graph space or right-click it to disconnect and restore fallback.
- Color: add a Color node, choose its color and alpha (0–1), then connect it to Output → fill. Disconnect restores the saved Output fallback; “Use layer fill” returns to the original layer color. SVG and transparent PNG retain alpha.
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

See [architecture and public API](docs/architecture.md), [interaction contract](docs/interaction.md) and [verification / remaining work](docs/verification.md).

## Verification

`npm test` runs geometry, type/graph, persistence, safety and synthetic DOM integration tests. `npm run test:csp` builds the production bundle and checks startup in Chromium with the unchanged native Tauri CSP, including a control that confirms JavaScript evaluation remains blocked. `npm run test:e2e` runs that production CSP check followed by real Chromium flows against a running dev server; set `CHROMIUM_PATH` for your system executable. Synthetic DOM tests are not screenshot or real browser rendering proof.

Geometry: [Paper.js PathItem](https://paperjs.org/reference/pathitem/). Text outlines: bundled DejaVu Sans, license in `public/fonts/`. Windows setup: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/).

## Image workflow

Export transparent SVG or PNG (0.5×–4×) from the same artboard scene. Import local PNG/JPEG into an Image composition, move/resize it, and save embedded assets in editable JSON. Image sockets remain separate from Path operations. See [export, limits and roundtrip boundaries](docs/image-export.md).
