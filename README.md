# Nect SVG

A node-authored vector editor, designed for a **Windows desktop app**, with a reusable browser editor and headless SVG engine. Separate from Nect and Nect-Cloud.

## Run the editor

Node 22+ is recommended.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run check
```

The workspace uses a white/silver interface, lower resizable graph, right Layers/Inspector and square artboard. Each layer owns a separate graph. Circle, Ellipse, Rectangle, Curve and Text feed Boolean, Transform, Path Remap and Output. Scalar/Vector value nodes connect to matching parameter fields. Expressions support arithmetic and a small numeric function allowlist, never JavaScript evaluation.

- Pen: click corner points, drag Bézier handles, click the first point to close, Escape to finish open.
- Select a generator node, then drag the canvas to move its own parameters. Locked, connected or expression-driven positions refuse movement.
- Drag an output to a matching field. Connected inputs appear alongside that field. Drag input to empty graph space or right-click it to disconnect and restore fallback.
- JSON saves editing history/model state; SVG exports evaluated paths, not the graph.
- Undo/redo: Ctrl+Z / Ctrl+Shift+Z. Space-drag or middle-drag pans. Fit resets zoom/pan.

## Windows application

Chosen shell: **Tauri 2 + WebView2**, rather than bundling another Chromium runtime. The editor and geometry core remain JavaScript modules independent of the shell. `src-tauri/` includes a Rust host, native file dialogs, bounded reads and staged/atomic saves, CSP and an NSIS current-user installer configuration.

On a Windows development machine with the official Tauri prerequisites (Rust MSVC toolchain, Visual Studio C++ Build Tools and WebView2):

```sh
npm ci
npx @tauri-apps/cli@2 dev --config src-tauri/tauri.conf.json
npx @tauri-apps/cli@2 build --config src-tauri/tauri.conf.json
```

This scaffold is **not yet Windows-built or installer-verified**. No release or signed installer has been published. A bounded Windows CI workflow can verify compilation/NSIS and browser interactions without using the user’s computer. Native open/save and close interruption must be verified on Windows before claiming desktop readiness.

## Headless / future Nect integration

```sh
node cli/export.js project.json artwork.svg
```

The CLI validates the project, loads the bundled licensed font, evaluates it without a browser/DOM and writes an SVG. It refuses to overwrite an existing output. No service, cloud deployment or Nect integration is enabled by this repository.

For a practical editable exercise, open `examples/vr-converters.json`; it retains V curves, R Boolean/counter operations, secondary Remap and editable text in separate compositions.

See [architecture and public API](docs/architecture.md), [interaction contract](docs/interaction.md) and [verification / remaining work](docs/verification.md).

## Verification

`npm test` runs geometry, type/graph, persistence, safety and synthetic DOM integration tests. `npm run test:e2e` runs real Chromium flows against a running dev server; set `CHROMIUM_PATH` for your system executable. Synthetic DOM tests are not screenshot or real browser rendering proof.

Geometry: [Paper.js PathItem](https://paperjs.org/reference/pathitem/). Text outlines: bundled DejaVu Sans, license in `public/fonts/`. Windows setup: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [Windows installer](https://v2.tauri.app/distribute/windows-installer/).
