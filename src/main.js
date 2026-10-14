import { prepareImage, preflightImages, pngDimensions, rasterizeSVG } from './raster.js';
import { validateImageAssets } from './images.js';
import { captureFocus, restoreFocus } from './focus.js';
import './style.css';
import { findFreeNodePosition } from './layout.js';
import { importSVG } from './svg-import.js';
import { desktop, saveFile, openFile } from './storage.js';
import {
  parseFont,
  makeFontAsset,
  resolveFonts,
  MAX_FONT_BYTES,
  MAX_PROJECT_BYTES,
} from './fonts.js';
import {
  document as newDocument,
  layer,
  node,
  point,
  uid,
  clone,
  cloneDocument,
  sameDocument,
  definitions,
  parameters,
  parameter,
  outputType,
  evaluate,
  enableRemapPoint,
  rebindRemapPoint,
  translateRemapPoints,
  pathData,
  signature,
  connect,
  disconnect,
  serialize,
  validate,
  deserialize,
  exportSVG,
  renderElement,
  History,
  guideDefaults,
  guideSettings,
  snapTranslation,
  pathBounds,
  layoutGridDefaults,
  layoutGridLines,
  setLayoutGrid,
} from './core.js';
const app = document.querySelector('#app');
let history = new History(newDocument()),
  activeLayer = history.doc.layers[0].id,
  selected = history.doc.layers[0].nodes[0].id,
  tool = 'select',
  zoom = 1,
  selectedGuide = null,
  guidesOpen = false,
  layoutDraft = null,
  layoutPreview = false,
  snapMatches = [],
  pan = [0, 0],
  graphHeight = 42,
  message = 'Ready • edit a generator or connect a node',
  error = false,
  fonts = {},
  bundledFont = null,
  fontRequest = null,
  fontRequestId = 0,
  wiring = null,
  drag = null,
  penId = null;
let savedSnapshot = serialize(history.doc),
  saveInFlight = false,
  openRequest = 0,
  imageRequest = 0,
  imagePick = null,
  pngScale = 1,
  exportInFlight = false;
let selection = new Set([selected]);
const detailsState = new Map();
const remapBatches = new Map();
function remapBatch(id) {
  if (!remapBatches.has(id)) remapBatches.set(id, { selected: new Set(), delta: [0, 0] });
  return remapBatches.get(id);
}
let renderEvaluation = null;
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const current = () => history.doc.layers.find((l) => l.id === activeLayer) || history.doc.layers[0];
const selectedNode = () => current().nodes.find((n) => n.id === selected);
function notify(text, bad = false) {
  message = text;
  error = bad;
  let s = document.querySelector('.status');
  if (s) {
    s.classList.toggle('error', bad);
    s.querySelector('.message').textContent = text;
  }
}
let pendingRender = null,
  needsRender = false,
  pointerActive = false;
document.addEventListener(
  'pointerdown',
  () => {
    pointerActive = true;
  },
  true,
);
for (const event of ['pointerup', 'pointercancel'])
  document.addEventListener(
    event,
    () => {
      pointerActive = false;
      if (needsRender) scheduleRender();
    },
    true,
  );
function scheduleRender() {
  needsRender = true;
  if (pendingRender === null)
    pendingRender = setTimeout(() => {
      pendingRender = null;
      if (!pointerActive) render();
    }, 0);
}
function change(fn, text, deferRender = false) {
  const previousUI = { selected, activeLayer, selection: new Set(selection), penId };
  try {
    if (current().locked) throw Error('Composition is locked');
    history.apply(fn);
    notify(text || 'Updated');
    if (deferRender) scheduleRender();
    else render();
  } catch (e) {
    ({ selected, activeLayer, selection, penId } = previousUI);
    notify(e.message, true);
    if (deferRender) scheduleRender();
    else render();
  }
}
function resetTransient() {
  imageRequest++;
  imagePick = null;
  layoutDraft = null;
  layoutPreview = false;
  if (drag?.before) history.doc = drag.before;
  selectedGuide = null;
  snapMatches = [];
  remapBatches.clear();
  drag = null;
  wiring = null;
  penId = null;
}
function field(n, key, q) {
  let source = current().nodes.find((x) => x.id === q.source),
    locked = q.locked || !!q.source;
  const name = key.includes('.') ? key.split('.').at(-1) : key;
  let control;
  let displayed = q.value;
  if (source && renderEvaluation) {
    try {
      displayed = renderEvaluation.run(source.id);
    } catch {}
  }
  if (['Path', 'Image'].includes(q.type))
    control = `<select data-path-source aria-label="${esc(n.name + ' ' + name)}"><option value="">Connect ${q.type}…</option>${current()
      .nodes.filter((x) => outputType(x) === q.type && x.id !== n.id)
      .map(
        (x) =>
          `<option value="${x.id}" ${q.source === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.id.slice(-4)}</option>`,
      )
      .join('')}</select>`;
  else if (q.type === 'Boolean')
    control = `<input aria-label="${esc(name)}" data-value type="checkbox" ${displayed ? 'checked' : ''} ${locked ? 'disabled' : ''}>`;
  else if (q.expression && !q.source)
    control = `<input class="expression" aria-label="${esc(name)} expression" data-expression value="${esc(q.expression)}" ${q.locked ? 'disabled' : ''}>`;
  else
    control = (q.type === 'Vector2' ? displayed : [displayed])
      .map(
        (v, i) =>
          `<input type="number" step="any" aria-label="${esc(n.name + ' ' + name + (q.type === 'Vector2' ? (i ? ' Y' : ' X') : ''))}" data-value data-axis="${i}" value="${Number(v.toFixed?.(3) ?? v)}" ${locked ? 'disabled' : ''}>`,
      )
      .join('');
  return `<div class="field ${q.source ? 'connected' : ''}" data-node="${n.id}" data-key="${esc(key)}" data-type="${q.type}"><label>${esc(name)}</label><div class="field-tools">${!['Path', 'Image'].includes(q.type) ? `<button class="mini" data-connect-menu title="Connect ${esc(name)} input" aria-label="Connect ${esc(n.name + ' ' + name)} input">↗</button>` : ''}<button class="lock" data-lock title="${q.locked ? 'Unlock' : 'Lock'} ${esc(name)}">${q.locked ? '🔒' : '○'}</button>${['Scalar', 'Vector2'].includes(q.type) ? `<button class="mini" data-fx title="Expression: Vector2 uses x; y">ƒ</button>` : ''}</div><div class="field-controls" title="${q.source ? esc('Saved fallback: ' + JSON.stringify(q.value)) : ''}">${q.source ? `<button class="socket input" title="Drag to empty space to disconnect; right-click to disconnect" aria-label="Disconnect ${esc(name)}"></button>` : ''}${control}</div>${source && !['Path', 'Image'].includes(q.type) ? `<span class="source-name">← ${esc(source.name)} · connected value</span>` : ''}</div>`;
}
function remapFields(n, result) {
  let input;
  try {
    if (n.params.path.source) input = result.run(n.params.path.source);
  } catch {}
  if (!input) return '<p class="muted">Connect a path to edit its vertices.</p>';
  const batch = remapBatch(n.id);
  return (
    input.contours
      .map(
        (c, ci) =>
          `<details data-detail="contour-${c.id}"><summary>Contour ${ci + 1} · ${c.points.length} vertices</summary>${c.points
            .map(
              (pt, pi) =>
                `<details data-detail="remap-${pt.id}"><summary><input type="checkbox" data-batch-point="${pt.id}" data-node="${n.id}" aria-label="Select contour ${ci + 1} point ${pi + 1} for batch edit" ${batch.selected.has(pt.id) ? 'checked' : ''}> Point ${pi + 1}</summary>${[
                  'position',
                  'handleA',
                  'handleB',
                ]
                  .map((k) => {
                    let edit = n.edits.find((e) => e.pointId === pt.id);
                    if (edit?.params) return field(n, `remap.${pt.id}.${k}`, edit.params[k]);
                    return `<div class="field"><label>Δ ${k}</label>${[0, 1].map((axis) => `<input aria-label="Remap ${pi + 1} ${k} ${axis ? 'Y' : 'X'}" type="number" step="any" data-remap="${pt.id}" data-component="${k}" data-axis="${axis}" data-node="${n.id}" value="${edit?.[k]?.[axis] || 0}">`).join('')}</div>`;
                  })
                  .join(
                    '',
                  )}${n.edits.some((e) => e.pointId === pt.id && e.params) ? '' : `<button class="mini" data-enable-remap="${pt.id}" data-node="${n.id}">Enable typed point controls</button>`}${n.edits.some((e) => e.pointId === pt.id && input.unstable && e.fingerprint !== input.fingerprint) ? `<button class="mini danger" data-rebind-remap="${pt.id}" data-node="${n.id}">Rebind retained edit to this point</button>` : ''}</details>`,
            )
            .join('')}</details>`,
      )
      .join('') +
    `<div class="batch-edit"><p>${batch.selected.size} points selected · Δ position</p><div class="field-controls">${batch.delta.map((v, axis) => `<input type="number" step="any" data-batch-axis="${axis}" data-node="${n.id}" aria-label="Batch delta ${axis ? 'Y' : 'X'}" value="${v}">`).join('')}</div><button class="mini" data-apply-batch="${n.id}">Move selected points</button><button class="mini" data-clear-batch="${n.id}">Deselect points</button></div><button class="mini" data-clear-edits="${n.id}">Clear vertex edits</button>`
  );
}
function nodeHeader(n) {
  return `<div class="node-head"><button class="node-collapse" data-collapse="${n.id}" aria-expanded="${!n.collapsed}" aria-label="Toggle ${esc(n.name)} node details" title="${n.collapsed ? 'Expand' : 'Collapse'} node">${n.collapsed ? '▸' : '▾'}</button><strong>${esc(n.name)}</strong><span class="type-tag">${outputType(n)}</span><button class="socket output" data-source="${n.id}" aria-label="${esc(n.name)} output" title="Drag output to a compatible field"></button></div>`;
}
function compactFields(n) {
  return parameters(n)
    .map(
      ([key, q]) =>
        `<div class="field compact-field ${q.source ? 'connected' : ''}" data-node="${n.id}" data-key="${esc(key)}" data-type="${q.type}"><button class="socket ${q.source ? 'input' : 'available-input'}" ${q.source ? '' : 'data-connect-menu'} aria-label="${esc(n.name + ' ' + key)} input" title="${esc(key)} · ${q.type}${q.source ? ' · connected; drag or right-click to disconnect' : ' · connect input'}"></button></div>`,
    )
    .join('');
}
function textControls(n) {
  if (n.type !== 'Text') return '';
  return `<div class="text-controls"><div class="field"><label>Text</label><textarea rows="3" data-text="${n.id}" aria-label="Text content">${esc(n.text)}</textarea></div><div class="field"><label>Font</label><select data-font="${n.id}" aria-label="Text font"><option value="default" ${n.font === 'default' ? 'selected' : ''}>DejaVu Sans (Latin)</option>${Object.entries(
    history.doc.fontAssets || {},
  )
    .map(
      ([id, asset]) =>
        `<option value="${id}" ${n.font === id ? 'selected' : ''}>${esc(asset.name)}</option>`,
    )
    .join(
      '',
    )}</select></div><button class="mini" data-load-font="${n.id}">Load TTF / OTF…</button><p class="font-note">Font bytes stay local and are included in saved JSON. Use a font licensed for editable embedding; check its license before sharing. File flags do not guarantee license permission.</p><div class="field"><label>Writing</label><select data-writing-mode="${n.id}" aria-label="Writing direction"><option value="horizontal-tb" ${n.writingMode !== 'vertical-rl' ? 'selected' : ''}>Horizontal →</option><option value="vertical-rl" ${n.writingMode === 'vertical-rl' ? 'selected' : ''}>Vertical ↓ / columns ←</option></select></div><p class="font-note">letterSpacing: extra px per glyph. lineSpacing: × text size. Enter starts a new line or column. Vertical position is the first column center/top.</p></div>`;
}
function expandedNodeBody(n, result) {
  return `<div class="node-body">${n.type === 'Boolean' ? `<div class="field"><label>Operation</label><select data-operation="${n.id}">${['union', 'subtract', 'intersect', 'difference'].map((op) => `<option ${n.operation === op ? 'selected' : ''}>${op}</option>`).join('')}</select></div>` : ''}${textControls(n)}${Object.entries(
    n.params,
  )
    .map(([k, q]) => field(n, k, q))
    .join(
      '',
    )}${n.points.map((pt, i) => `<details data-detail="${pt.id}" ${i === 0 ? 'open' : ''}><summary>Point ${i + 1} <button class="mini" data-delete-point="${pt.id}" data-node="${n.id}" title="Delete point">×</button></summary>${['position', 'handleA', 'handleB'].map((k) => field(n, `${pt.id}.${k}`, pt[k])).join('')}<select data-handle-type="${pt.id}" data-node="${n.id}" aria-label="Point ${i + 1} handle type">${['corner', 'smooth', 'symmetric'].map((t) => `<option ${pt.handleType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></details>`).join('')}${n.type === 'Curve' ? `<button class="mini" data-add-point="${n.id}">+ Point</button>` : ''}${n.type === 'Path Remap' ? remapFields(n, result) : ''}<div class="node-actions">${['Path', 'Image'].includes(outputType(n)) && !['Output', 'Image Output'].includes(n.type) ? `<button class="mini" data-preview="${n.id}">Use as output</button>` : ''}<button class="mini" data-duplicate="${n.id}">Duplicate</button>${!['Output', 'Image Output'].includes(n.type) ? `<button class="mini danger" data-delete="${n.id}">Delete</button>` : ''}</div></div>`;
}
function nodeHTML(n, result) {
  const body = n.collapsed
    ? `<div class="node-body compact-body">${compactFields(n)}</div><div hidden><button data-duplicate="${n.id}">Duplicate</button>${!['Output', 'Image Output'].includes(n.type) ? `<button data-delete="${n.id}">Delete</button>` : ''}</div>`
    : expandedNodeBody(n, result);
  return `<section class="node ${selection.has(n.id) ? 'selected' : ''} ${n.collapsed ? 'collapsed' : ''}" data-id="${n.id}" style="left:${n.position[0]}px;top:${n.position[1]}px;width:${n.width || 264}px">${nodeHeader(n)}${body}<div class="node-resize" title="Drag to resize node" aria-hidden="true"></div></section>`;
}
function render(resetView = false) {
  needsRender = false;
  if (pendingRender !== null) {
    clearTimeout(pendingRender);
    pendingRender = null;
  }
  const focused = resetView ? null : captureFocus(app);
  const inspectorScroll = resetView ? 0 : document.querySelector('.inspector-body')?.scrollTop || 0;
  const guideScroll = resetView
    ? [0, 0]
    : ['.guides-panel', '.guide-list'].map(
        (selector) => document.querySelector(selector)?.scrollTop || 0,
      );
  for (const el of document.querySelectorAll('.graph details[data-detail]'))
    detailsState.set(`${el.closest('.node').dataset.id}/${el.dataset.detail}`, el.open);
  if (selected && !current().nodes.some((n) => n.id === selected)) selected = null;
  if (penId && !current().nodes.some((n) => n.id === penId && n.type === 'Curve')) penId = null;
  if (!selection.has(selected)) selection = new Set(selected ? [selected] : []);
  selection = new Set([...selection].filter((id) => current().nodes.some((n) => n.id === id)));
  let scroll = document.querySelector('.graph-scroll'),
    oldScroll = scroll && !resetView ? [scroll.scrollLeft, scroll.scrollTop] : [0, 0];
  const doc = history.doc,
    aids = guideSettings(doc),
    l = current();
  activeLayer = l.id;
  const n = selectedNode();
  fonts = resolveFonts(doc, bundledFont ? { default: bundledFont } : {});
  let results = doc.layers.map((x) => [x, evaluate(x, fonts, history.doc.imageAssets)]),
    result = results.find(([x]) => x.id === l.id)[1];
  renderEvaluation = result;
  app.innerHTML = `<header><div class="brand"><b>Nect</b><small>SVG</small></div><button data-action="new">New</button><button data-action="open">Open</button><button data-action="import-svg">Import SVG</button><button data-action="import-image">Import image</button><button data-action="save">Save JSON</button><button data-action="export">Export SVG</button><select id="png-scale" aria-label="PNG export scale">${[0.5, 1, 2, 4].map((v) => `<option value="${v}" ${pngScale === v ? 'selected' : ''}>${v}× PNG</option>`).join('')}</select><button data-action="export-png" title="Transparent artboard · ${Math.round(doc.width * pngScale)} × ${Math.round(doc.height * pngScale)} px">Export PNG</button><span class="divider"></span><button data-action="undo" ${history.past.length ? '' : 'disabled'} title="Ctrl+Z">↶</button><button data-action="redo" ${history.future.length ? '' : 'disabled'} title="Ctrl+Shift+Z">↷</button><span class="spacer"></span><span class="muted">${esc(doc.name)}</span><button data-action="help">?</button></header><div class="workspace"><nav class="tools" aria-label="Tools">${[
    ['select', '↖', 'Select / move'],
    ['pen', '⌁', 'Pen / Curve'],
    ['Circle', '○', 'Add Circle'],
    ['Rectangle', '□', 'Add Rectangle'],
    ['Text', 'T', 'Add Text'],
  ]
    .map(
      ([id, icon, label]) =>
        `<button data-tool="${id}" title="${label}" aria-label="${label}" class="${tool === id ? 'active' : ''}">${icon}</button>`,
    )
    .join(
      '',
    )}</nav><main class="middle"><div class="canvas-wrap"><div class="canvas-toolbar"><button data-action="zoom-out" aria-label="Zoom out">−</button><span>${Math.round(zoom * 100)}%</span><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="fit">Fit</button><button data-action="snap" class="${aids.snap ? 'active' : ''}" aria-pressed="${aids.snap}" title="Snap to guides, artboard and grid; hold Alt to bypass">Snap</button><button data-action="guides-panel" aria-expanded="${guidesOpen}">Guides</button><span>${doc.width} × ${doc.height}</span></div>${guidesPanel()}<div class="canvas-stage"><svg class="artboard" viewBox="0 0 ${doc.width} ${doc.height}" aria-label="Artwork canvas">${gridOverlay()}${results
    .filter(([x, r]) => layerShown(x) && r.path && !r.error)
    .map(([x, r]) => layerShape(x, r.path))
    .join(
      '',
    )}${guidesOverlay()}${canvasOverlay(n, result)}</svg></div><div class="hint">${tool === 'pen' ? 'Pen: click for a corner, drag for handles; click first point to close. Escape finishes.' : n ? `Editing ${esc(n.name)}${selection.size > 1 ? ` + ${selection.size - 1} generators` : ``} · ${esc(l.name)}${l.locked ? ' · Locked' : ''}` : 'Select a generator to edit its original parameters'}</div></div><div class="splitter" role="separator" aria-label="Resize node graph" tabindex="0"></div><section class="graph-panel" style="height:${graphHeight}%"><div class="panel-head"><strong>Node graph</strong><span class="muted">${esc(l.name)}</span><span class="spacer"></span><select id="add-node" aria-label="Add node"><option value="">+ Add node</option>${Object.keys(
    definitions,
  )
    .filter((x) => !['Output', 'Image Output', 'Image'].includes(x))
    .map((x) => `<option>${x}</option>`)
    .join(
      '',
    )}</select><button data-action="graph-fit" title="Scroll to graph origin">Home</button></div><div class="graph-scroll"><div class="graph"><svg class="wires"></svg>${l.nodes.map((x) => nodeHTML(x, result)).join('')}</div></div></section></main><aside class="right"><section class="layers"><div class="panel-head"><strong>Layers</strong><span class="spacer"></span><button class="mini" data-action="add-layer">+ Composition</button></div>${[
    ...doc.layers,
  ]
    .reverse()
    .map(
      (x) =>
        `<div class="layer ${x.guide ? 'is-guide' : ''} ${x.id === l.id ? 'selected' : ''}" data-layer="${x.id}"><button data-visible="${x.id}" title="Toggle visibility">${x.visible ? '◉' : '○'}</button><button class="name" data-select-layer="${x.id}">${esc(x.name)}</button><button data-layer-guide="${x.id}" class="${x.guide ? 'active' : ''}" aria-label="${x.guide ? 'Make artwork layer' : 'Make guide layer'}: ${esc(x.name)}" aria-pressed="${!!x.guide}" title="${x.guide ? 'Guide layer: excluded from SVG' : 'Convert to guide layer'}" ${x.locked ? 'disabled' : ''}>${x.guide ? 'Guide' : '◇'}</button><button data-layer-lock="${x.id}" title="Toggle layer lock">${x.locked ? '🔒' : '○'}</button><button data-up-layer="${x.id}" title="Move layer up">↑</button></div>`,
    )
    .join(
      '',
    )}</section><section><div class="panel-head"><strong>Inspector</strong></div><div class="inspector-body">${
    n
      ? `<h3>${esc(n.name)}</h3><p>${esc(n.type)} · ${outputType(n)}<br>Canvas changes this selected generator directly. Connected or locked parameters cannot be moved.</p>${textControls(n)}${Object.entries(
          n.params,
        )
          .filter(([, q]) => !['Path', 'Image'].includes(q.type))
          .map(([k, q]) => field(n, k, q))
          .join('')}`
      : '<p>Select a node.</p>'
  }<hr style="border:0;border-top:1px solid #d8dde2"><div class="field"><label>Layer name</label><input class="string" data-layer-name value="${esc(l.name)}" aria-label="Layer name"></div><div class="field"><label>Fill</label><input type="color" data-fill value="${esc(l.fill)}" aria-label="Layer fill"></div><div class="field"><label>Artboard W</label><input type="number" data-dimension="width" value="${doc.width}" aria-label="Artboard width"></div><div class="field"><label>Artboard H</label><input type="number" data-dimension="height" value="${doc.height}" aria-label="Artboard height"></div>${results
    .filter(([, r]) => r.error || r.warnings.length)
    .map(
      ([x, r]) => `<p class="warning">${esc(x.name)}: ${esc(r.error || r.warnings.join(' '))}</p>`,
    )
    .join(
      '',
    )}<p>Dynamic sockets<br>Drag a node output onto a compatible field. Drag a connected input into empty graph space to disconnect. Right-click an input also disconnects.</p><p>Expressions: arithmetic, pi, sin, cos, sqrt, min/max. Vector2: x expression; y expression.</p></div></section></aside></div><footer class="status ${error ? 'error' : ''}"><span class="message">${esc(message)}</span><span class="spacer"></span><span>Local document · ${l.nodes.length} nodes</span></footer><input id="image-file" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden><input id="font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" hidden><input id="open-file" type="file" accept=".json,application/json" hidden><input id="import-svg-file" type="file" accept=".svg,image/svg+xml" hidden>`;
  const gs = document.querySelector('.graph-scroll');
  gs.scrollLeft = oldScroll[0];
  gs.scrollTop = oldScroll[1];
  for (const el of document.querySelectorAll('.graph details[data-detail]')) {
    const key = `${el.closest('.node').dataset.id}/${el.dataset.detail}`;
    if (detailsState.has(key)) el.open = detailsState.get(key);
  }
  fitCanvas();
  restoreFocus(app, focused);
  document.querySelector('.inspector-body').scrollTop = inspectorScroll;
  ['.guides-panel', '.guide-list'].forEach((selector, index) => {
    const el = document.querySelector(selector);
    if (el) el.scrollTop = guideScroll[index];
  });
  requestAnimationFrame(() => {
    updateGraphBounds();
    drawWires();
  });
}
function editGuides(fn) {
  try {
    history.apply((doc) => {
      doc.editor ||= guideDefaults();
      fn(doc.editor);
    });
    snapMatches = [];
    notify('Editing aids updated');
  } catch (err) {
    notify(err.message, true);
  }
  render();
}
function layerShown(l) {
  return l.visible && (!l.guide || guideSettings(history.doc).visible);
}
function layerShape(l, path) {
  return renderElement(
    path,
    { ...l, name: l.id },
    history.doc.imageAssets,
    `class="shape ${l.guide ? 'guide-layer-shape' : ''}"`,
  );
}
function layoutConfig() {
  return layoutDraft || guideSettings(history.doc).layoutGrid || layoutGridDefaults();
}
function layoutPanel() {
  const a = guideSettings(history.doc),
    config = layoutConfig();
  let error = '',
    lines = [];
  try {
    lines = layoutGridLines(history.doc, config);
  } catch (e) {
    error = e.message;
  }
  const locked = a.locked || a.guides.some((g) => g.origin === 'layout' && g.locked);
  return `<div class="layout-grid-panel"><strong>Layout grid</strong><div class="layout-grid-fields">${[
    ['columns', 'Columns'],
    ['rows', 'Rows'],
    ['marginX', 'Margin X'],
    ['marginY', 'Margin Y'],
    ['gutterX', 'Gutter X'],
    ['gutterY', 'Gutter Y'],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input type="number" data-layout-field="${key}" aria-label="Layout ${label}" min="${['columns', 'rows'].includes(key) ? 1 : 0}" max="${['columns', 'rows'].includes(key) ? 40 : 100000}" step="${['columns', 'rows'].includes(key) ? 1 : 'any'}" value="${Number.isFinite(config[key]) ? config[key] : ''}"></label>`,
    )
    .join(
      '',
    )}</div><label><input type="checkbox" data-layout-preview ${layoutPreview ? 'checked' : ''}>Preview layout</label><p class="layout-grid-summary ${error ? 'warning' : ''}">${esc(error || `${lines.length} guides · artboard-based · margins on both sides`)}</p><div class="guide-add"><button data-layout-apply ${error || locked ? 'disabled' : ''}>${a.layoutGrid ? 'Update layout' : 'Create layout'}</button><button data-layout-cancel>Cancel</button><button data-layout-remove ${!a.layoutGrid || locked ? 'disabled' : ''}>Remove layout</button></div><p>Updates replace only layout guides. Manual guides stay. Unlock layout guides before updating.</p></div>`;
}
function layoutOverlay() {
  if (!layoutPreview || !guidesOpen) return '';
  try {
    return layoutGridLines(history.doc, layoutConfig())
      .map((g) => guideLine(g.axis, g.position, 'class="layout-preview"'))
      .join('');
  } catch {
    return '';
  }
}
function guidesPanel() {
  if (!guidesOpen) return '';
  const a = guideSettings(history.doc);
  return `<section class="guides-panel" aria-label="Guides and snapping"><div class="guide-toggles">${[
    ['visible', 'Show guides'],
    ['locked', 'Lock all guides'],
    ['gridVisible', 'Show grid'],
    ['snapGuides', 'Snap guides'],
    ['snapArtboard', 'Snap artboard'],
    ['snapGrid', 'Snap grid'],
  ]
    .map(
      ([key, label]) =>
        `<label><input type="checkbox" data-guide-setting="${key}" ${a[key] ? 'checked' : ''}>${label}</label>`,
    )
    .join(
      '',
    )}</div><label>Grid spacing <input type="number" min="1" max="10000" data-guide-setting="gridSize" aria-label="Grid spacing" value="${a.gridSize}"></label>${layoutPanel()}<div class="guide-add"><button data-add-guide="y" ${a.locked ? 'disabled' : ''}>+ Horizontal</button><button data-add-guide="x" ${a.locked ? 'disabled' : ''}>+ Vertical</button></div><div class="guide-list">${a.guides.map((g, i) => `<div class="guide-row ${selectedGuide === g.id ? 'selected' : ''}"><button data-select-guide="${g.id}" aria-label="Select guide ${i + 1}" aria-pressed="${selectedGuide === g.id}">${g.origin === 'layout' ? '▦ ' : ''}${g.axis === 'x' ? 'V · X' : 'H · Y'}</button><input type="number" step="any" min="-100000" max="100000" data-guide-position="${g.id}" aria-label="Guide ${i + 1} position" value="${g.position}" ${a.locked || g.locked ? 'disabled' : ''}><button data-lock-guide="${g.id}" aria-label="${g.locked ? 'Unlock' : 'Lock'} guide ${i + 1}" aria-pressed="${g.locked}" ${a.locked ? 'disabled' : ''}>${g.locked ? '🔒' : '○'}</button><button data-delete-guide="${g.id}" aria-label="Delete guide ${i + 1}" ${a.locked || g.locked ? 'disabled' : ''}>×</button></div>`).join('')}</div><p>Drag a guide to move it. Hidden guides do not snap; locked guides still snap. Alt bypasses snapping.</p></section>`;
}
function gridOverlay() {
  const a = guideSettings(history.doc);
  if (!a.gridVisible) return '';
  return `<defs><pattern id="editing-grid" width="${a.gridSize}" height="${a.gridSize}" patternUnits="userSpaceOnUse"><path d="M ${a.gridSize} 0 H 0 V ${a.gridSize}" class="editing-grid-line"/></pattern></defs><rect width="${history.doc.width}" height="${history.doc.height}" fill="url(#editing-grid)" pointer-events="none"/>`;
}
function guideLine(axis, position, attributes) {
  return `<line ${axis === 'x' ? `x1="${position}" x2="${position}" y1="0" y2="${history.doc.height}"` : `y1="${position}" y2="${position}" x1="0" x2="${history.doc.width}"`} ${attributes}/>`;
}
function guidesOverlay() {
  const a = guideSettings(history.doc);
  return (
    (a.visible
      ? a.guides
          .map(
            (g) =>
              guideLine(
                g.axis,
                g.position,
                `class="editing-guide ${selectedGuide === g.id ? 'selected' : ''} ${a.locked || g.locked ? 'locked' : ''}" data-guide="${g.id}" data-axis="${g.axis}"`,
              ) +
              guideLine(
                g.axis,
                g.position,
                `class="guide-hit ${a.locked || g.locked ? 'locked' : ''}" data-guide="${g.id}" data-axis="${g.axis}"`,
              ),
          )
          .join('')
      : '') +
    layoutOverlay() +
    snapMatches
      .map((m) =>
        guideLine(m.axis ? 'y' : 'x', m.position, `class="snap-match" data-snap-kind="${m.kind}"`),
      )
      .join('')
  );
}
function canvasScale() {
  const ctm = document.querySelector('.artboard').getScreenCTM();
  return Math.hypot(ctm?.a ?? 1, ctm?.b ?? 0) || 1;
}
function snapped(sources, delta, event, excludedGuide = null) {
  const result = snapTranslation(
    history.doc,
    sources,
    delta,
    canvasScale(),
    event.altKey,
    excludedGuide,
    history.doc.layers
      .filter((l) => l.guide && layerShown(l) && l.id !== activeLayer)
      .flatMap((l) => {
        const r = evaluate(l, fonts, history.doc.imageAssets);
        return !r.error &&
          (r.path?.kind === 'image' || r.path?.contours.some((c) => c.points.length > 0))
          ? [pathBounds(r.path)]
          : [];
      }),
  );
  snapMatches = result.matches;
  return result.delta;
}
function canvasOverlay(n, result) {
  if (!n || !layerShown(current())) return '';
  let path;
  try {
    path = result.run(n.id);
  } catch {
    return '';
  }
  if (path?.kind === 'image')
    return `<rect class="guide" x="${path.position[0]}" y="${path.position[1]}" width="${path.size[0]}" height="${path.size[1]}" stroke-dasharray="5 4"/>`;
  if (outputType(n) !== 'Path') return '';
  let out = `<path class="guide" d="${esc(pathData(path))}" stroke-dasharray="5 4"/>`;
  if (['Curve', 'Path Remap'].includes(n.type))
    for (const pt of path.contours.flatMap((c) => c.points)) {
      for (const key of ['handleA', 'handleB']) {
        let handle = pt[key].map((v, i) => v + pt.position[i]);
        out += `<line class="guide" x1="${pt.position[0]}" y1="${pt.position[1]}" x2="${handle[0]}" y2="${handle[1]}"/><circle class="handle" data-point="${pt.id}" data-handle="${key}" cx="${handle[0]}" cy="${handle[1]}" r="4"/>`;
      }
      out += `<circle class="vertex" data-point="${pt.id}" cx="${pt.position[0]}" cy="${pt.position[1]}" r="5"/>`;
    }
  return out;
}
let canvasFrame = null;
function updateCanvas() {
  if (canvasFrame !== null) return;
  canvasFrame = requestAnimationFrame(() => {
    canvasFrame = null;
    const svg = document.querySelector('.artboard');
    if (!svg) return;
    const l = current(),
      r = evaluate(l, fonts, history.doc.imageAssets);
    svg.innerHTML =
      gridOverlay() +
      history.doc.layers
        .filter((x) => layerShown(x))
        .map((x) => {
          const value = x === l ? r : evaluate(x, fonts, history.doc.imageAssets);
          return value.path && !value.error ? layerShape(x, value.path) : '';
        })
        .join('') +
      guidesOverlay() +
      canvasOverlay(selectedNode(), r);
  });
}
function fitCanvas() {
  let stage = document.querySelector('.canvas-stage'),
    svg = document.querySelector('.artboard');
  if (!stage || !svg) return;
  let scale =
    Math.min(
      (stage.clientWidth - 70) / history.doc.width,
      (stage.clientHeight - 70) / history.doc.height,
    ) * zoom;
  svg.style.width = history.doc.width * scale + 'px';
  svg.style.height = history.doc.height * scale + 'px';
  svg.style.transform = `translate(${pan[0]}px,${pan[1]}px)`;
}
function drawWires() {
  let graph = document.querySelector('.graph'),
    svg = document.querySelector('.wires');
  if (!graph) return;
  let rect = graph.getBoundingClientRect(),
    html = '';
  for (const n of current().nodes)
    for (const [key, q] of parameters(n)) {
      if (!q.source) continue;
      let from = graph.querySelector(`[data-source="${q.source}"]`),
        to = [...graph.querySelectorAll('.field')]
          .find((el) => el.dataset.node === n.id && el.dataset.key === key)
          ?.querySelector('.input');
      if (!from || !to) continue;
      let a = from.getBoundingClientRect(),
        b = to.getBoundingClientRect(),
        x = a.x + a.width / 2 - rect.x,
        y = a.y + a.height / 2 - rect.y,
        xx = b.x + b.width / 2 - rect.x,
        yy = b.y + b.height / 2 - rect.y;
      html += `<path class="wire" d="M${x},${y} C${x + 80},${y} ${xx - 80},${yy} ${xx},${yy}"/>`;
    }
  svg.innerHTML = html;
}
function updateGraphBounds() {
  const graph = document.querySelector('.graph');
  if (!graph) return;
  const nodes = [...graph.querySelectorAll('.node')];
  graph.style.width =
    Math.max(2400, ...nodes.map((el) => el.offsetLeft + el.offsetWidth + 80)) + 'px';
  graph.style.height =
    Math.max(1600, ...nodes.map((el) => el.offsetTop + el.offsetHeight + 100)) + 'px';
}
function freePosition(type) {
  const measurements = {};
  for (const el of document.querySelectorAll('.graph .node'))
    measurements[el.dataset.id] = { width: el.offsetWidth, height: el.offsetHeight };
  return findFreeNodePosition(current().nodes, measurements, {
    width: 264,
    height: type === 'Curve' ? 520 : 260,
  });
}
function revealNode(id) {
  requestAnimationFrame(() =>
    document
      .querySelector(`.node[data-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  );
}
function addNode(type, preview = false) {
  change(() => {
    const l = current(),
      position = freePosition(type),
      n = node(type, ...position);
    l.nodes.push(n);
    selected = n.id;
    if (preview) connect(l, n.id, l.output, 'path');
  }, `Added ${type}`);
  if (selected) revealNode(selected);
}
function confirmReplace() {
  return (
    serialize(history.doc) === savedSnapshot ||
    confirm(
      'Replace this document with unsaved changes? Cancel and Save JSON first to keep a file copy. Open/import can also be undone.',
    )
  );
}
function download(text, name, type) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
app.addEventListener('click', async (e) => {
  let b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset,
    n = selectedNode();
  if (d.layoutCancel !== undefined) {
    layoutDraft = null;
    layoutPreview = false;
    render();
    return;
  }
  if (d.layoutApply !== undefined || d.layoutRemove !== undefined) {
    try {
      history.apply((doc) =>
        setLayoutGrid(doc, d.layoutRemove !== undefined ? null : layoutConfig(), () =>
          uid('guide'),
        ),
      );
      layoutDraft = null;
      layoutPreview = false;
      selectedGuide = null;
      snapMatches = [];
      notify(
        d.layoutRemove !== undefined
          ? 'Layout guides removed; manual guides kept'
          : 'Layout guides generated',
      );
    } catch (e) {
      notify(e.message, true);
    }
    render();
    return;
  }
  if (d.layerGuide) {
    const l = history.doc.layers.find((x) => x.id === d.layerGuide);
    if (l.locked) {
      notify('Composition is locked', true);
      return;
    }
    history.apply(() => {
      l.guide = !l.guide;
    });
    notify(
      l.guide ? 'Guide layer: visible in editor, excluded from SVG' : 'Layer restored to artwork',
    );
    render();
    return;
  }
  if (d.addGuide) {
    editGuides((a) => {
      if (a.locked) throw Error('Guides are locked');
      if (a.guides.length >= 200) throw Error('Maximum 200 guides');
      const g = {
        id: uid('guide'),
        axis: d.addGuide,
        position: history.doc[d.addGuide === 'x' ? 'width' : 'height'] / 2,
        locked: false,
      };
      a.guides.push(g);
      selectedGuide = g.id;
    });
    return;
  }
  if (d.selectGuide) {
    selectedGuide = d.selectGuide;
    render();
    return;
  }
  if (d.lockGuide || d.deleteGuide) {
    editGuides((a) => {
      const g = a.guides.find((g) => g.id === (d.lockGuide || d.deleteGuide));
      if (a.locked || (d.deleteGuide && g.locked)) throw Error('Guide is locked');
      if (d.lockGuide) g.locked = !g.locked;
      else {
        a.guides = a.guides.filter((x) => x !== g);
        if (selectedGuide === g.id) selectedGuide = null;
      }
    });
    return;
  }
  if (d.action) {
    try {
      switch (d.action) {
        case 'undo':
          resetTransient();
          history.undo();
          render();
          break;
        case 'redo':
          resetTransient();
          history.redo();
          render();
          break;
        case 'save': {
          if (saveInFlight) break;
          saveInFlight = true;
          const snapshot = serialize(history.doc);
          try {
            if (await saveFile(snapshot, 'nect-project.json', 'json')) {
              savedSnapshot = snapshot;
              notify(desktop ? 'Project JSON saved' : 'Project JSON download started');
            }
          } finally {
            saveInFlight = false;
          }
          break;
        }
        case 'export':
        case 'export-png': {
          if (exportInFlight) break;
          exportInFlight = true;
          try {
            const svg = exportSVG(history.doc, fonts);
            if (d.action === 'export') {
              if (await saveFile(svg, 'nect-artwork.svg', 'svg'))
                notify('SVG exported · transparent artboard; guides excluded');
            } else {
              const size = pngDimensions(history.doc, pngScale);
              const blob = await rasterizeSVG(svg, size);
              if (await saveFile(blob, 'nect-artwork.png', 'png'))
                notify(`PNG exported · ${size.width} × ${size.height} · transparent background`);
            }
          } finally {
            exportInFlight = false;
          }
          break;
        }
        case 'import-image':
          imagePick = { id: ++imageRequest, before: serialize(history.doc), doc: history.doc };
          document.querySelector('#image-file').value = '';
          document.querySelector('#image-file').click();
          break;
        case 'import-svg':
          if (!confirmReplace()) break;
          document.querySelector('#import-svg-file').click();
          break;
        case 'open':
          if (!confirmReplace()) break;
          if (desktop) {
            const request = ++openRequest,
              before = serialize(history.doc);
            let text = await openFile();
            if (request !== openRequest) break;
            if (serialize(history.doc) !== before)
              throw Error('Document changed while reading; open the file again');
            if (text !== null) {
              const next = deserialize(text);
              await preflightImages(next);
              if (request !== openRequest || serialize(history.doc) !== before)
                throw Error('Document changed while reading; open the file again');
              resetTransient();
              history.apply(() => (history.doc = next));
              activeLayer = next.layers[0].id;
              selected = current().nodes[0]?.id;
              savedSnapshot = serialize(next);
              render(true);
              notify('Project restored');
            }
          } else document.querySelector('#open-file').click();
          break;
        case 'new':
          if (confirm('Start a new document? Save your current JSON first to keep it.')) {
            resetTransient();
            history = new History(newDocument());
            activeLayer = current().id;
            selected = current().nodes[0].id;
            render(true);
          }
          break;
        case 'add-layer':
          history.apply((doc) => {
            let l = layer(`Composition ${doc.layers.length + 1}`);
            doc.layers.push(l);
            activeLayer = l.id;
            selected = l.nodes[0].id;
          });
          render(true);
          break;
        case 'zoom-in':
          zoom = Math.min(8, zoom * 1.2);
          render();
          break;
        case 'zoom-out':
          zoom = Math.max(0.15, zoom / 1.2);
          render();
          break;
        case 'snap':
          editGuides((aids) => (aids.snap = !aids.snap));
          break;
        case 'guides-panel':
          guidesOpen = !guidesOpen;
          if (!guidesOpen) {
            layoutDraft = null;
            layoutPreview = false;
          }
          render();
          break;
        case 'fit':
          zoom = 1;
          pan = [0, 0];
          render();
          break;
        case 'graph-fit':
          document.querySelector('.graph-scroll').scrollTo(0, 0);
          break;
        case 'help': {
          let dialog = document.createElement('dialog');
          dialog.innerHTML =
            '<h3>Nect SVG</h3><p>Each layer owns an independent node composition. Select a node to edit its parameters or move its source shape on the canvas.</p><p>Add a Curve with the Pen tool. Click for corners, drag for Bézier handles, and click the first point to close. Escape finishes an open curve.</p><p>Connect paths to Boolean A/B, then through Path Remap to Output. Save JSON retains all nodes and edits; SVG is the evaluated artwork.</p><p>Ctrl+Z / Ctrl+Shift+Z: Undo / Redo. Space + drag or middle drag: pan. Use Fit to reset.</p><button>Close</button>';
          dialog.querySelector('button').onclick = () => dialog.remove();
          document.body.append(dialog);
          dialog.showModal();
          break;
        }
      }
    } catch (err) {
      notify(err.message, true);
    }
    return;
  }
  if (d.loadFont) {
    if (current().locked) {
      notify('Composition is locked', true);
      return;
    }
    fontRequest = {
      id: ++fontRequestId,
      layer: current().id,
      node: d.loadFont,
      before: serialize(history.doc),
    };
    const input = document.querySelector('#font-file');
    input.value = '';
    input.click();
    return;
  }
  if (d.tool) {
    tool = d.tool;
    if (tool === 'pen') {
      penId = null;
      notify('Click the canvas to begin a curve');
      render();
    } else if (tool !== 'select') {
      addNode(tool, true);
      tool = 'select';
      render();
    } else render();
    return;
  }
  if (d.selectLayer) {
    resetTransient();
    activeLayer = d.selectLayer;
    selected = current().nodes[0]?.id;
    render(true);
    return;
  }
  if (d.visible || d.layerLock || d.upLayer) {
    history.apply((doc) => {
      let id = d.visible || d.layerLock || d.upLayer,
        l = doc.layers.find((x) => x.id === id);
      if (d.visible) l.visible = !l.visible;
      if (d.layerLock) l.locked = !l.locked;
      if (d.upLayer) {
        let i = doc.layers.indexOf(l);
        if (i < doc.layers.length - 1)
          [doc.layers[i], doc.layers[i + 1]] = [doc.layers[i + 1], doc.layers[i]];
      }
    });
    render();
    return;
  }
  if (d.connectMenu !== undefined) {
    let f = b.closest('.field'),
      nn = current().nodes.find((x) => x.id === f.dataset.node),
      q = parameter(nn, f.dataset.key);
    let dialog = document.createElement('dialog');
    dialog.innerHTML = `<h3>Connect ${esc(nn.name)} · ${esc(f.dataset.key)}</h3><p>Choose a ${q.type} source. Disconnect restores the saved value or expression.</p><select aria-label="Input source"><option value="">Disconnected</option>${current()
      .nodes.filter((x) => x.id !== nn.id && outputType(x) === q.type)
      .map(
        (x) =>
          `<option value="${x.id}" ${q.source === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.id.slice(-4)}</option>`,
      )
      .join(
        '',
      )}</select><p><button data-confirm>Apply</button> <button data-cancel>Cancel</button></p>`;
    dialog.querySelector('[data-cancel]').onclick = () => dialog.remove();
    dialog.querySelector('[data-confirm]').onclick = () => {
      const source = dialog.querySelector('select').value;
      change(
        () =>
          source ? connect(current(), source, nn.id, f.dataset.key) : disconnect(nn, f.dataset.key),
        'Connection updated',
      );
      dialog.remove();
    };
    document.body.append(dialog);
    dialog.showModal();
    return;
  }
  if (d.lock !== undefined || d.fx !== undefined) {
    let f = b.closest('.field'),
      nn = current().nodes.find((x) => x.id === f.dataset.node),
      q = parameter(nn, f.dataset.key);
    change(() => {
      if (d.lock !== undefined) q.locked = !q.locked;
      else {
        if (q.locked) throw Error('Parameter is locked');
        let next = prompt(
          'Expression (Vector2: x; y). Leave blank for direct values.',
          q.expression || '',
        );
        if (next !== null) q.expression = next;
      }
    }, 'Parameter updated');
    return;
  }
  if (d.preview)
    change(() => connect(current(), d.preview, current().output, 'path'), 'Output connected');
  if (d.collapse)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.collapse);
      nn.collapsed = !nn.collapsed;
    }, 'Node display updated');
  if (d.delete)
    change(() => {
      current().nodes = current().nodes.filter((x) => x.id !== d.delete);
      for (const x of current().nodes)
        for (const [, q] of parameters(x)) if (q.source === d.delete) delete q.source;
      if (selected === d.delete) selected = null;
    }, 'Node deleted');
  if (d.duplicate)
    change(() => {
      let copy = clone(current().nodes.find((x) => x.id === d.duplicate));
      copy.id = uid('node');
      copy.position = freePosition(copy.type);
      copy.name += ' copy';
      for (const pt of copy.points) pt.id = uid('point');
      current().nodes.push(copy);
      selected = copy.id;
    }, 'Node duplicated');
  if (d.addPoint)
    change(
      () =>
        current()
          .nodes.find((x) => x.id === d.addPoint)
          .points.push(point(400, 300)),
      'Point added',
    );
  if (d.deletePoint)
    change(() => {
      let nn = current().nodes.find((x) => x.id === d.node);
      nn.points = nn.points.filter((x) => x.id !== d.deletePoint);
    }, 'Point removed');
  if (d.clearBatch) {
    remapBatch(d.clearBatch).selected.clear();
    render();
  }
  if (d.applyBatch)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.applyBatch),
        batch = remapBatch(nn.id);
      translateRemapPoints(
        nn,
        evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source),
        [...batch.selected],
        batch.delta,
      );
    }, 'Selected points moved as one edit');
  if (d.rebindRemap)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.node),
        input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
      rebindRemapPoint(nn, input, d.rebindRemap);
    }, 'Retained edit explicitly rebound to the current point');
  if (d.enableRemap)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.node),
        input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
      enableRemapPoint(nn, input, d.enableRemap);
    }, 'Point Value / Expression / Node Input controls enabled');
  if (d.clearEdits)
    change(
      () => (current().nodes.find((x) => x.id === d.clearEdits).edits = []),
      'Vertex edits cleared',
    );
});
app.addEventListener('change', async (e) => {
  let el = e.target,
    d = el.dataset;
  if (d.batchPoint) {
    const selected = remapBatch(d.node).selected;
    if (el.checked) selected.add(d.batchPoint);
    else selected.delete(d.batchPoint);
    scheduleRender();
    return;
  }
  if (d.batchAxis !== undefined) {
    const value = Number(el.value);
    if (Number.isFinite(value)) remapBatch(d.node).delta[Number(d.batchAxis)] = value;
    else notify('Expected a finite batch delta', true);
    return;
  }
  if (el.id === 'png-scale') {
    pngScale = Number(el.value);
    render();
    return;
  }
  if (el.id === 'image-file') {
    const file = el.files[0];
    if (!file) {
      imagePick = null;
      return;
    }
    const request = imagePick || {
      id: ++imageRequest,
      before: serialize(history.doc),
      doc: history.doc,
    };
    imagePick = null;
    try {
      const asset = await prepareImage(file);
      if (request.id !== imageRequest) return;
      if (history.doc !== request.doc || serialize(history.doc) !== request.before)
        throw Error('Document changed while reading; import the image again');
      history.apply((doc) => {
        const id = uid('image');
        doc.imageAssets = { ...doc.imageAssets, [id]: asset };
        validateImageAssets(doc.imageAssets);
        const l = layer(asset.name),
          n = node('Image'),
          out = node('Image Output', 380, 40);
        n.asset = id;
        const scale = Math.min(1, doc.width / asset.width, doc.height / asset.height);
        n.params.size.value = [asset.width * scale, asset.height * scale];
        n.params.position.value = [
          (doc.width - n.params.size.value[0]) / 2,
          (doc.height - n.params.size.value[1]) / 2,
        ];
        out.params.path.source = n.id;
        l.nodes = [n, out];
        l.output = out.id;
        doc.layers.push(l);
        validate(doc);
        serialize(doc);
      });
      activeLayer = history.doc.layers.at(-1).id;
      selected = current().nodes[0].id;
      selection = new Set([selected]);
      notify(`Imported ${asset.name} · embedded PNG; JSON keeps the editable image`);
      render(true);
    } catch (err) {
      notify(`Image rejected; current document preserved: ${err.message}`, true);
    }
    return;
  }
  if (el.id === 'font-file') {
    const file = el.files[0],
      request = fontRequest;
    if (!file || !request) return;
    try {
      if (file.size > MAX_FONT_BYTES) throw Error('Font exceeds 20 MB');
      if (!/\.(ttf|otf)$/i.test(file.name)) throw Error('Choose a static .ttf or .otf font');
      const bytes = await file.arrayBuffer();
      if (fontRequest?.id !== request.id) return;
      if (serialize(history.doc) !== request.before || activeLayer !== request.layer)
        throw Error('Document changed while reading; load the font again');
      const prepared = makeFontAsset(bytes, file.name, history.doc.fontAssets);
      // Preflight lazy outlines and glyph coverage before touching the active document.
      const candidate = cloneDocument(history.doc);
      candidate.fontAssets = { ...candidate.fontAssets, [prepared.id]: prepared.asset };
      const candidateLayer = candidate.layers.find((l) => l.id === request.layer);
      const candidateText = candidateLayer.nodes.find(
        (n) => n.id === request.node && n.type === 'Text',
      );
      if (!candidateText) throw Error('Text node no longer exists');
      candidateText.font = prepared.id;
      const preflight = evaluate(
        { ...candidateLayer, output: candidateText.id },
        resolveFonts(candidate, bundledFont ? { default: bundledFont } : {}),
      );
      if (preflight.error) throw Error(preflight.error);
      change(() => {
        const target = current().nodes.find((n) => n.id === request.node && n.type === 'Text');
        if (!target) throw Error('Text node no longer exists');
        history.doc.fontAssets ||= {};
        history.doc.fontAssets[prepared.id] = prepared.asset;
        target.font = prepared.id;
        serialize(history.doc); // Enforce the whole-document bound before committing.
      }, `Loaded ${prepared.asset.name} · saved JSON will include this font`);
    } catch (err) {
      notify(`Font rejected; current document preserved: ${err.message}`, true);
    }
    if (fontRequest?.id === request.id) fontRequest = null;
    return;
  }
  if (el.id === 'open-file' || el.id === 'import-svg-file') {
    let file = el.files[0];
    if (!file) return;
    try {
      const request = ++openRequest,
        before = serialize(history.doc);
      if (file.size > (el.id === 'open-file' ? MAX_PROJECT_BYTES : 10_000_000))
        throw Error('File exceeds the supported size limit');
      let text = await file.text(),
        next = el.id === 'import-svg-file' ? importSVG(text) : deserialize(text);
      await preflightImages(next);
      if (request !== openRequest) return;
      if (serialize(history.doc) !== before)
        throw Error('Document changed while reading; open the file again');
      resetTransient();
      history.apply(() => {
        history.doc = next;
      });
      activeLayer = next.layers[0].id;
      selected = current().nodes[0]?.id;
      if (el.id === 'open-file') savedSnapshot = serialize(next);
      notify('Project restored');
      render(true);
    } catch (err) {
      notify(`Open rejected; current document preserved: ${err.message}`, true);
    }
    return;
  }
  if (d.layoutField || d.layoutPreview !== undefined) {
    if (d.layoutField)
      layoutDraft = {
        ...layoutConfig(),
        [d.layoutField]: el.value.trim() ? Number(el.value) : NaN,
      };
    else layoutPreview = el.checked;
    if (pointerActive) scheduleRender();
    else render();
    return;
  }
  if (d.guideSetting || d.guidePosition) {
    editGuides((a) => {
      if (d.guideSetting) {
        if (d.guideSetting === 'gridSize') {
          const value = Number(el.value);
          if (!el.value.trim() || !Number.isFinite(value) || value < 1 || value > 10000)
            throw Error('Grid spacing must be between 1 and 10000');
          a.gridSize = value;
        } else a[d.guideSetting] = el.checked;
      } else {
        const g = a.guides.find((g) => g.id === d.guidePosition),
          value = Number(el.value);
        if (a.locked || g.locked) throw Error('Guide is locked');
        if (!el.value.trim() || !Number.isFinite(value) || Math.abs(value) > 100000)
          throw Error('Guide position must be between -100000 and 100000');
        g.position = value;
      }
    });
    return;
  }
  if (el.id === 'add-node') {
    if (el.value) addNode(el.value);
    return;
  }
  change(
    () => {
      if (d.operation) current().nodes.find((n) => n.id === d.operation).operation = el.value;
      else if (d.text) current().nodes.find((n) => n.id === d.text).text = el.value;
      else if (d.font) current().nodes.find((n) => n.id === d.font).font = el.value;
      else if (d.writingMode)
        current().nodes.find((n) => n.id === d.writingMode).writingMode = el.value;
      else if (d.layerName !== undefined) current().name = el.value;
      else if (d.fill !== undefined) current().fill = el.value;
      else if (d.dimension) {
        let v = Number(el.value);
        if (!(v > 0 && v <= 100000)) throw Error('Artboard dimension must be between 1 and 100000');
        history.doc[d.dimension] = v;
      } else if (d.handleType) {
        let pt = current()
          .nodes.find((n) => n.id === d.node)
          .points.find((p) => p.id === d.handleType);
        if (
          el.value !== 'corner' &&
          (pt.handleA.locked || pt.handleA.source || pt.handleA.expression)
        )
          throw Error('Handle A is locked or driven; unlock before changing coupled handle mode');
        pt.handleType = el.value;
        if (el.value === 'symmetric') pt.handleA.value = pt.handleB.value.map((v) => -v);
        else if (el.value === 'smooth') {
          const length = Math.hypot(...pt.handleA.value),
            mag = Math.hypot(...pt.handleB.value);
          if (mag) pt.handleA.value = pt.handleB.value.map((v) => (-v / mag) * length);
        }
      } else if (d.remap) {
        let nn = current().nodes.find((n) => n.id === d.node),
          input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
        let edit = nn.edits.find((x) => x.pointId === d.remap);
        if (!edit) {
          edit = {
            pointId: d.remap,
            ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
          };
          nn.edits.push(edit);
        }
        if (!edit[d.component]) edit[d.component] = [0, 0];
        edit[d.component][Number(d.axis)] = Number(el.value);
      } else {
        let f = el.closest('.field');
        if (!f) return;
        let nn = current().nodes.find((n) => n.id === f.dataset.node),
          q = parameter(nn, f.dataset.key);
        if (q.locked) throw Error('Parameter is locked');
        if (d.pathSource !== undefined) {
          if (el.value) connect(current(), el.value, nn.id, f.dataset.key);
          else disconnect(nn, f.dataset.key);
        } else if (d.expression !== undefined) q.expression = el.value;
        else if (d.value !== undefined) {
          if (q.source) throw Error('Disconnect input before editing its fallback');
          let value = q.type === 'Boolean' ? el.checked : Number(el.value);
          if (q.type !== 'Boolean' && !Number.isFinite(value))
            throw Error('Expected a finite number');
          if (q.type === 'Vector2') q.value[Number(d.axis)] = value;
          else q.value = value;
        }
      }
    },
    undefined,
    true,
  );
});
function canvasPoint(event) {
  let svg = document.querySelector('.artboard'),
    pt = new DOMPoint(event.clientX, event.clientY);
  let r = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [r.x, r.y];
}
let space = false;
app.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.output')) {
    let id = e.target.closest('.output').dataset.source;
    wiring = { source: id };
    let type = outputType(current().nodes.find((n) => n.id === id));
    document
      .querySelectorAll('.graph .field')
      .forEach((f) =>
        f.classList.toggle('compatible', f.dataset.type === type && f.dataset.node !== id),
      );
    updateGraphBounds();
    drawWires();
    e.preventDefault();
    return;
  }
  if (e.target.closest('.input')) {
    let f = e.target.closest('.field');
    wiring = { disconnect: true, node: f.dataset.node, key: f.dataset.key };
    e.preventDefault();
    return;
  }
  if (e.target.closest('.splitter')) {
    drag = { type: 'split', startY: e.clientY, height: graphHeight };
    e.preventDefault();
    return;
  }
  let head = e.target.closest('.node-head');
  if (head && !e.target.closest('button')) {
    selectedGuide = null;
    let id = head.closest('.node').dataset.id;
    if (e.shiftKey) {
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
      selected = selection.has(id) ? id : [...selection][0] || null;
      render();
      return;
    }
    if (!selection.has(id)) selection = new Set([id]);
    selected = id;
    const n = selectedNode();
    drag = {
      type: 'node',
      id,
      start: [e.clientX, e.clientY],
      originals: [...selection].map((id) => ({
        id,
        position: [...current().nodes.find((n) => n.id === id).position],
      })),
      before: cloneDocument(history.doc),
    };
    document
      .querySelectorAll('.node')
      .forEach((x) => x.classList.toggle('selected', selection.has(x.dataset.id)));
    e.preventDefault();
    return;
  }
  const resized = e.target.closest('.node-resize')?.closest('.node');
  if (resized) {
    if (current().locked) return;
    drag = {
      type: 'resize',
      id: resized.dataset.id,
      startX: e.clientX,
      width: resized.offsetWidth,
      before: cloneDocument(history.doc),
    };
    e.preventDefault();
    return;
  }
  let stage = e.target.closest('.canvas-stage');
  if (!stage) return;
  if (space || e.button === 1) {
    drag = { type: 'pan', start: [e.clientX, e.clientY], original: [...pan] };
    e.preventDefault();
    return;
  }
  const guideId = e.target.dataset.guide;
  if (guideId) {
    selectedGuide = guideId;
    const a = guideSettings(history.doc),
      g = a.guides.find((g) => g.id === guideId);
    if (a.locked || g.locked) {
      notify('Guide is locked');
      render();
      return;
    }
    drag = {
      type: 'guide',
      id: guideId,
      axis: g.axis === 'x' ? 0 : 1,
      original: g.position,
      start: canvasPoint(e),
      before: cloneDocument(history.doc),
    };
    e.preventDefault();
    updateCanvas();
    return;
  }
  selectedGuide = null;
  if (tool === 'select' && e.target.dataset.layer && e.target.dataset.layer !== activeLayer) {
    activeLayer = e.target.dataset.layer;
    selected = current().nodes[0]?.id;
    render();
    return;
  }
  if (!layerShown(current())) {
    notify('Show the active layer before editing it on the canvas', true);
    return;
  }
  if (current().locked) {
    notify('Composition is locked', true);
    return;
  }
  let pos = canvasPoint(e),
    n = selectedNode();
  if (tool === 'pen') {
    if (current().nodes.find((x) => x.id === current().output).params.path.type !== 'Path') {
      notify('Pen needs a vector composition; add or select a vector layer first', true);
      return;
    }
    pos = snapped([[pos[0]], [pos[1]]], [0, 0], e).map((v, i) => v + pos[i]);
    if (
      penId &&
      e.target.dataset.point === current().nodes.find((x) => x.id === penId)?.points[0]?.id
    ) {
      change(() => {
        const q = current().nodes.find((x) => x.id === penId).params.closed;
        if (q.locked || q.source || q.expression)
          throw Error('Closed parameter is locked or driven');
        q.value = true;
      }, 'Curve closed');
      penId = null;
      tool = 'select';
      render();
      return;
    }
    let before = cloneDocument(history.doc);
    if (!penId) {
      if (current().nodes.find((x) => x.id === current().output).params.path.locked) {
        notify('Output Path is locked; unlock it before starting a new pen path', true);
        return;
      }
      let nn = node('Curve', ...freePosition('Curve'));
      nn.points = [];
      nn.params.closed.value = false;
      current().nodes.push(nn);
      penId = nn.id;
      selected = nn.id;
      connect(current(), nn.id, current().output, 'path');
    }
    let nn = current().nodes.find((x) => x.id === penId),
      pt = point(...pos);
    nn.points.push(pt);
    drag = { type: 'pen', pointId: pt.id, nodeId: nn.id, start: pos, before };
    render();
    if (nn.points.length === 1) revealNode(nn.id);
    return;
  }
  if (e.target.dataset.point && n?.type === 'Path Remap') {
    const input = evaluate(current(), fonts, history.doc.imageAssets).run(n.params.path.source),
      pointId = e.target.dataset.point,
      key = e.target.dataset.handle || 'position',
      existing = n.edits.find((e) => e.pointId === pointId);
    if (existing && input.unstable && existing.fingerprint !== input.fingerprint) {
      notify(
        'This edit is suspended. Use Rebind retained edit to this point before dragging.',
        true,
      );
      return;
    }
    if (
      existing?.params?.[key] &&
      (existing.params[key].locked ||
        existing.params[key].source ||
        existing.params[key].expression)
    ) {
      notify(`${key} is locked or driven`, true);
      return;
    }
    const before = cloneDocument(history.doc),
      edit = enableRemapPoint(n, input, pointId);
    drag = {
      type: 'remap',
      nodeId: n.id,
      pointId,
      key,
      start: pos,
      original: clone(edit.params[key].value),
      anchor: (() => {
        const p = evaluate(current(), fonts, history.doc.imageAssets)
          .run(n.id)
          .contours.flatMap((c) => c.points)
          .find((p) => p.id === pointId);
        return key === 'position' ? p.position : p.position.map((v, i) => v + p[key][i]);
      })(),
      before,
    };
    const contour = input.contours.find((c) => c.points.some((p) => p.id === pointId));
    for (const key of [`contour-${contour.id}`, `remap-${pointId}`]) {
      const detail = document.querySelector(
        `.node[data-id="${n.id}"] details[data-detail="${key}"]`,
      );
      if (detail) detail.open = true;
    }
    return;
  }
  if (e.target.dataset.point && n?.type === 'Curve') {
    let pt = n.points.find((p) => p.id === e.target.dataset.point),
      key = e.target.dataset.handle || 'position',
      q = pt[key];
    if (q.locked || q.source || q.expression) {
      notify(`${key} is locked or driven by an input`, true);
      return;
    }
    drag = {
      type: 'point',
      nodeId: n.id,
      pointId: pt.id,
      key,
      start: pos,
      original: clone(q.value),
      anchor: (() => {
        const p = evaluate(current(), fonts, history.doc.imageAssets)
          .run(n.id)
          .contours.flatMap((c) => c.points)
          .find((p) => p.id === pt.id);
        return key === 'position' ? p.position : p.position.map((v, i) => v + p[key][i]);
      })(),
      before: cloneDocument(history.doc),
    };
    return;
  }
  const generators = current().nodes.filter((n) => selection.has(n.id));
  if (
    generators.length &&
    generators.every((n) =>
      ['Circle', 'Ellipse', 'Rectangle', 'Text', 'Curve', 'Image'].includes(n.type),
    )
  ) {
    const targets = generators.map((n) => {
      const keys =
        n.type === 'Curve'
          ? n.points.map((p) => `${p.id}.position`)
          : [['Text', 'Image'].includes(n.type) ? 'position' : 'center'];
      return { nodeId: n.id, keys, original: keys.map((k) => clone(parameter(n, k).value)) };
    });
    if (
      targets.some((t) =>
        t.keys.some((k) => {
          const q = parameter(
            current().nodes.find((n) => n.id === t.nodeId),
            k,
          );
          return q.locked || q.source || q.expression;
        }),
      )
    ) {
      notify('A selected position is locked or driven by an input', true);
      return;
    }
    const bounds = generators.map((g) =>
      pathBounds(evaluate(current(), fonts, history.doc.imageAssets).run(g.id)),
    );
    const anchors = [0, 1].map((axis) => {
      const low = Math.min(...bounds.map((b) => b[axis][0])),
        high = Math.max(...bounds.map((b) => b[axis][2]));
      return [low, (low + high) / 2, high];
    });
    drag = { type: 'shape', targets, anchors, start: pos, before: cloneDocument(history.doc) };
  } else notify('Select only shape, Text, Image or Curve generators to move them');
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.type === 'resize') {
    const width = Math.max(220, Math.min(550, drag.width + e.clientX - drag.startX));
    document.querySelector(`.node[data-id="${drag.id}"]`).style.width = width + 'px';
    updateGraphBounds();
    drawWires();
    return;
  }
  if (drag.type === 'split') {
    graphHeight = Math.max(
      18,
      Math.min(
        75,
        drag.height +
          ((drag.startY - e.clientY) / document.querySelector('.middle').clientHeight) * 100,
      ),
    );
    document.querySelector('.graph-panel').style.height = graphHeight + '%';
    fitCanvas();
    return;
  }
  if (drag.type === 'pan') {
    pan = drag.original.map(
      (v, i) => v + [e.clientX - drag.start[0], e.clientY - drag.start[1]][i],
    );
    fitCanvas();
    return;
  }
  if (drag.type === 'node') {
    if (current().locked) return;
    for (const original of drag.originals) {
      const n = current().nodes.find((x) => x.id === original.id);
      n.position = original.position.map((v, i) =>
        Math.max(0, v + [e.clientX - drag.start[0], e.clientY - drag.start[1]][i]),
      );
      const el = document.querySelector(`.node[data-id="${n.id}"]`);
      el.style.left = n.position[0] + 'px';
      el.style.top = n.position[1] + 'px';
    }
    drawWires();
    return;
  }
  let pos = canvasPoint(e),
    delta = pos.map((v, i) => v - drag.start[i]),
    n = current().nodes.find((x) => x.id === drag.nodeId);
  if (drag.type === 'guide') {
    const sources = [[], []];
    sources[drag.axis] = [drag.original];
    delta = snapped(sources, delta, e, drag.id);
    history.doc.editor.guides.find((g) => g.id === drag.id).position = Math.max(
      -100000,
      Math.min(100000, drag.original + delta[drag.axis]),
    );
    updateCanvas();
    return;
  }
  const anchor = drag.anchor || drag.start;
  delta = snapped(drag.anchors || [[anchor[0]], [anchor[1]]], delta, e);
  if (drag.type === 'remap') {
    n.edits.find((e) => e.pointId === drag.pointId).params[drag.key].value = drag.original.map(
      (v, i) => v + delta[i],
    );
  } else if (drag.type === 'shape')
    drag.targets.forEach((t) => {
      const target = current().nodes.find((n) => n.id === t.nodeId);
      t.keys.forEach(
        (k, idx) => (parameter(target, k).value = t.original[idx].map((v, i) => v + delta[i])),
      );
    });
  else {
    let pt = n.points.find((x) => x.id === drag.pointId);
    if (drag.type === 'pen') {
      pt.handleB.value = delta;
      pt.handleA.value = delta.map((v) => -v);
      pt.handleType = 'symmetric';
    } else {
      pt[drag.key].value = drag.original.map((v, i) => v + delta[i]);
      if (drag.key !== 'position' && pt.handleType !== 'corner') {
        let other = drag.key === 'handleA' ? 'handleB' : 'handleA';
        if (!pt[other].locked && !pt[other].source && !pt[other].expression) {
          let v = pt[drag.key].value,
            len = pt.handleType === 'symmetric' ? Math.hypot(...v) : Math.hypot(...pt[other].value),
            mag = Math.hypot(...v) || 1;
          pt[other].value = v.map((x) => (-x / mag) * len);
        }
      }
    }
  }
  updateCanvas();
});
document.addEventListener('pointercancel', () => {
  if (!drag && !wiring) return;
  if (drag?.before) history.doc = drag.before;
  drag = null;
  snapMatches = [];
  wiring = null;
  render();
});
document.addEventListener('pointerup', (e) => {
  if (wiring) {
    let w = wiring;
    wiring = null;
    document.querySelectorAll('.compatible').forEach((x) => x.classList.remove('compatible'));
    updateGraphBounds();
    drawWires();
    let f = e.target.closest('.graph .field');
    if (w.disconnect) {
      if (!f)
        change(
          () =>
            disconnect(
              current().nodes.find((n) => n.id === w.node),
              w.key,
            ),
          'Disconnected; fallback restored',
        );
    } else if (f)
      change(() => connect(current(), w.source, f.dataset.node, f.dataset.key), 'Connected');
    return;
  }
  if (drag) {
    let d = drag;
    if (d.type === 'resize' && !current().locked) {
      const el = document.querySelector(`.node[data-id="${d.id}"]`),
        n = current().nodes.find((x) => x.id === d.id);
      n.width = Math.max(220, Math.min(550, el.offsetWidth));
    }
    drag = null;
    snapMatches = [];
    if (d.before && !sameDocument(d.before, history.doc)) {
      history.record(d.before);
      notify('Updated');
    }
    render();
  }
});
app.addEventListener('contextmenu', (e) => {
  let input = e.target.closest('.input');
  if (input) {
    e.preventDefault();
    let f = input.closest('.field');
    change(
      () =>
        disconnect(
          current().nodes.find((n) => n.id === f.dataset.node),
          f.dataset.key,
        ),
      'Disconnected',
    );
  }
});
app.addEventListener(
  'toggle',
  () =>
    requestAnimationFrame(() => {
      updateGraphBounds();
      drawWires();
    }),
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select')) return;
  if (e.code === 'Space') {
    space = true;
    e.preventDefault();
  }
  if (e.key === 'Escape') {
    layoutDraft = null;
    layoutPreview = false;
    if (drag?.before) history.doc = drag.before;
    drag = null;
    snapMatches = [];
    selectedGuide = null;
    wiring = null;
    tool = 'select';
    penId = null;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    resetTransient();
    e.shiftKey ? history.redo() : history.undo();
    render();
  }
  if (e.key === 'Delete' && selectedGuide) {
    editGuides((a) => {
      const guide = a.guides.find((g) => g.id === selectedGuide);
      if (!guide) return;
      if (a.locked || guide.locked) throw Error('Guide is locked');
      a.guides = a.guides.filter((g) => g.id !== selectedGuide);
      selectedGuide = null;
    });
    return;
  }
  if (e.key === 'Delete' && !['Output', 'Image Output'].includes(selectedNode()?.type))
    document.querySelector(`[data-delete="${selected}"]`)?.click();
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select') || e.repeat) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      document.querySelector('[data-action="save"]')?.click();
    }
    if (e.key.toLowerCase() === 'o') {
      e.preventDefault();
      document.querySelector('[data-action="open"]')?.click();
    }
    return;
  }
  const keys = { v: 'select', p: 'pen', c: 'Circle', r: 'Rectangle', t: 'Text' };
  if (keys[e.key.toLowerCase()])
    document.querySelector(`[data-tool="${keys[e.key.toLowerCase()]}"]`)?.click();
});
app.addEventListener('keydown', (e) => {
  if (e.target.matches('.splitter') && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    graphHeight = Math.max(18, Math.min(75, graphHeight + (e.key === 'ArrowUp' ? 5 : -5)));
    document.querySelector('.graph-panel').style.height = graphHeight + '%';
    fitCanvas();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') space = false;
});
window.addEventListener('resize', fitCanvas);
window.addEventListener('beforeunload', (e) => {
  if (serialize(history.doc) !== savedSnapshot) {
    e.preventDefault();
    e.returnValue = '';
  }
});
render();
fetch('/fonts/DejaVuSans.ttf')
  .then((r) => {
    if (!r.ok) throw Error('Bundled font unavailable');
    return r.arrayBuffer();
  })
  .then((b) => {
    bundledFont = parseFont(b);
    render();
  })
  .catch((e) => notify(e.message, true));
// Explicit test/debug API; same model and mutations as the UI.
window.nect = {
  get document() {
    return history.doc;
  },
  evaluate: () => evaluate(current(), fonts, history.doc.imageAssets),
  load(text) {
    const d = deserialize(text);
    resetTransient();
    history = new History(d);
    activeLayer = d.layers[0].id;
    selected = current().nodes[0]?.id;
    render(true);
  },
  export: () => exportSVG(history.doc, fonts),
};
