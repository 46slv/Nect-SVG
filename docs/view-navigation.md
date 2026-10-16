# View navigation

## UI research and bounded decision

The existing desktop-first white/silver layout remains: upper artboard, resizable lower node graph, Layers/Inspector at right. Prior 1280×800 and 1600×1000 screenshots showed an artboard labeled “100%” whose actual CSS scale was smaller, a clipped graph with only an origin-reset “Home” control, and long expanded cards whose headers could leave the viewport. The code also restored a non-scrolling Inspector inner element rather than the scrolling sidebar.

Patterns were checked against primary product documentation:

- [Figma zoom/view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options): zoom, fit and selection framing.
- [Adobe Illustrator viewing artwork](https://helpx.adobe.com/illustrator/using/viewing-artwork.html): explicit actual-size versus fit and pan.
- [Blender node introduction](https://docs.blender.org/manual/en/4.4/interface/controls/nodes/introduction.html): node-editor pan, Frame All and Frame Selected. Direct retrieval was unavailable; official search excerpts supported these navigation patterns.
- [DaVinci Resolve 20 Fusion Visual Effects training](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Fusion-Visual-Effects.pdf?_v=1757574012000), pp. 24–25: context-specific view zoom, pan, actual size and fit.

These are adapted interaction patterns, not a compatibility claim or a broad redesign. No panel zoom, permanent Hand tool, minimap, node rearrangement or canvas-selection fitting is added. Canvas selection fitting remains deferred until bounds for selected source outputs, transforms and character instances are consistently verified.

## Artboard

- − / % / + displays real scale: 100% is one SVG document unit per CSS pixel, independent of device pixel ratio.
- **Fit artboard** centers the entire artboard with 35 CSS px available margin; it recomputes when the viewport/splitter changes. **100%** sets actual size.
- Manual zoom preserves its actual scale and the world coordinate at the viewport center on resize. Buttons zoom about that center; Ctrl/Cmd+wheel zooms about the pointer.
- Plain wheel/two-finger motion pans both axes. Shift with a vertical wheel pans horizontally. Space+left drag and middle drag remain available over artwork, guides and Pen mode.
- Scale limits are 0.001–800%, including very large valid artboards. Fit and manual limits agree; zoom-out never increases scale. The percentage shows additional decimals below 1%.

## Node graph

- − / % / +, **Fit all**, **Fit selection**, and **Reset view** are visible. Fit selection is disabled when no node is selected.
- Actual card width/height and 8 world-px port allowance define the fitted union. The 2400×1600 scrolling floor is not treated as content. Fit requests 32 screen-px padding, subject to the existing nonnegative scroll origin.
- Limits are 5–200%. A fit below 5% reports that some nodes may remain outside the view instead of pretending to contain the graph. Reset view means 100% at scroll origin, while Ctrl/Cmd+1 preserves the center anchor.
- Space, middle or Ctrl/Cmd+Shift drag pans. Plain wheel remains native two-axis scrolling. Ctrl/Cmd+wheel zooms about the pointer, normalizing pixel/line/page delta modes.
- Existing edge-autopan, expandable right/bottom bounds, nonnegative positions and one-gesture undo remain unchanged. Extra scroll extent required for centering survives unrelated rerenders and card disclosure changes.

## Focus and editing safety

Focus a viewport or its view controls for +/−, Ctrl/Cmd+1 actual size, Shift+1 fit, and Shift+2 graph Fit selection. Pointer-clicking a view control returns focus to its viewport; keyboard activation leaves the control focused. Space on a focused button keeps its native action. Viewports have a visible focus outline, concise gesture hints and grab/grabbing states.

Inputs, textareas, selects, contenteditable descendants, floating character controls, Guides and dialogs retain their input behavior. Navigation does not rebuild the document UI, discard drafts/carets, change selection, add undo entries, mark the document dirty or alter SVG/PNG export dimensions. IME composition and active node/object/resize/wire/scrub gestures block competing navigation. Busy graph gestures also block wheel-driven native scrolling beneath the captured pointer. Ordinary document rerenders preserve the actual sidebar scroll and focused viewport.

## Verification

Pure geometry and synthetic DOM tests cover fit bounds/limits, anchor equations, wheel normalization, scoped shortcuts, exempt controls, composition, busy navigation, unchanged document/history/SVG, drafts and sidebar/focus restoration. `tests/view-navigation.e2e.js` adds real Chrome checks for actual CTM percentage/100%, cursor/center anchors, independent views, fit card height, resize, both 1280×800 and 1600×1000 layouts, real wheel gestures, sidebar editing continuity, busy scrub scroll and sub-1% zoom direction. Existing navigation/editing regression suites remain part of the full Chrome command.

Local Chromium cannot launch because its socket operation is restricted. New Chrome checks and screenshots must be verified on the exact Windows CI commit before a browser pass is claimed. Native WebView2, physical high-DPI devices, trackpad pinch and real Japanese IME are separate unverified checks; synthetic composition events are not native IME evidence.
