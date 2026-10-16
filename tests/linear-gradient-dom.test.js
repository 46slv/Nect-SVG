import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Linear Gradient Fill controls, typed sources, fallback, invalid endpoint rollback, scrub guards and history', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'DOMPoint',
    'DOMParser',
    'requestAnimationFrame',
  ])
    globalThis[key] = key === 'requestAnimationFrame' ? () => 0 : win[key];
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform() {
      return this;
    }
  };
  win.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => {
      let b = await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      "from './artwork-gap-distribution.js'",
      `from '${new URL('../src/artwork-gap-distribution.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-distribution.js'",
      `from '${new URL('../src/artwork-distribution.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-alignment.js'",
      `from '${new URL('../src/artwork-alignment.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-multi-move.js'",
      `from '${new URL('../src/artwork-multi-move.js', import.meta.url)}'`,
    )
    .replace("from './images.js'", `from '${new URL('../src/images.js', import.meta.url)}'`)
    .replace("from './raster.js'", `from '${new URL('../src/raster.js', import.meta.url)}'`)
    .replace("from './focus.js'", `from '${new URL('../src/focus.js', import.meta.url)}'`)
    .replace("from './layout.js'", `from '${new URL('../src/layout.js', import.meta.url)}'`)
    .replace("from './core.js'", `from '${new URL('../src/core.js', import.meta.url)}'`)
    .replace(
      "from './artwork-creation.js'",
      `from '${new URL('../src/artwork-creation.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-move-target.js'",
      `from '${new URL('../src/artwork-move-target.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-deletion.js'",
      `from '${new URL('../src/artwork-deletion.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-ordering.js'",
      `from '${new URL('../src/artwork-ordering.js', import.meta.url)}'`,
    )
    .replace("from './svg-import.js'", `from '${new URL('../src/svg-import.js', import.meta.url)}'`)
    .replace("from './storage.js'", `from '${new URL('../src/storage.js', import.meta.url)}'`)
    .replace("from './fonts.js'", `from '${new URL('../src/fonts.js', import.meta.url)}'`);
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 100));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const change = async (el, value) => {
    el.value = value;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const { document: makeDoc, node, connect } = await import('../src/core.js');
  const doc = makeDoc(),
    l = doc.layers[0],
    r = node('Rectangle'),
    g = node('Linear Gradient Fill'),
    o = node('Output'),
    v = node('Vector'),
    c = node('Color');
  l.nodes = [r, g, o, v, c];
  l.output = o.id;
  connect(l, r.id, g.id, 'path');
  connect(l, g.id, o.id, 'path');
  v.params.value.value = [40, 80];
  c.params.value.value = { hex: '#00ff00', alpha: 0.25 };
  win.nect.load(JSON.stringify(doc));
  const field = (key, panel = '.graph') =>
    document.querySelector(`${panel} .field[data-node="${g.id}"][data-key="${key}"]`);
  const input = (key, axis = 0) => field(key).querySelector(`[data-axis="${axis}"]`);
  const saved = () => JSON.stringify(win.nect.document);
  const val = (key) =>
    win.nect.document.layers[0].nodes.find((n) => n.id === g.id).params[key].value;
  assert.ok(
    [...document.querySelector('#add-node').options].some(
      (x) => x.value === 'Linear Gradient Fill',
    ),
  );
  document
    .querySelector(`.node[data-id="${g.id}"] .node-head strong`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
  document.dispatchEvent(
    new win.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }),
  );
  assert.equal(field('path').dataset.type, 'PaintedPath');
  assert.match(
    document.querySelector('.inspector-body').textContent,
    /Import SVG reopens our exported two-stop gradients/,
  );
  assert.doesNotMatch(
    document.querySelector('.inspector-body').textContent,
    /SVG gradient import is not supported/,
  );
  assert.match(document.querySelector('.inspector-body').textContent, /absolute artboard/);
  assert.equal(document.querySelectorAll('.artboard linearGradient').length, 1);
  for (const key of ['start', 'end']) assert.equal(field(key).dataset.type, 'Vector2');
  for (const key of ['startColor', 'endColor']) assert.equal(field(key).dataset.type, 'Color');
  await change(input('start'), '125');
  assert.equal(val('start')[0], 125);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(val('start')[0], 200);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(val('start')[0], 125);
  const before = saved();
  await change(input('end'), '125');
  assert.equal(saved(), before);
  await change(input('start'), '');
  assert.equal(saved(), before);
  // Dragging precisely onto the other endpoint keeps the last valid value.
  const pointer = (el, type, x) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: 20,
      }),
    );
  pointer(input('end'), 'pointerdown', 100);
  pointer(document, 'pointermove', 100 - (500 - 125) - 4);
  pointer(document, 'pointerup', 100 - (500 - 125) - 4);
  assert.equal(val('end')[0], 500);
  assert.equal(saved(), before);
  // Source connection menus only list Vector2 for endpoints and Color for stops.
  field('start').querySelector('[data-connect-menu]').click();
  assert.equal(document.querySelector(`dialog option[value="${c.id}"]`), null);
  document.querySelector('dialog select').value = v.id;
  document.querySelector('dialog [data-confirm]').click();
  assert.equal(input('start').disabled, true);
  assert.equal(input('start').value, '40');
  assert.equal(val('start')[0], 125);
  field('start')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.equal(input('start').value, '125');
  field('endColor').querySelector('[data-connect-menu]').click();
  assert.equal(document.querySelector(`dialog option[value="${v.id}"]`), null);
  document.querySelector('dialog select').value = c.id;
  document.querySelector('dialog [data-confirm]').click();
  assert.equal(field('endColor').querySelector('[data-color="alpha"]').disabled, true);
  assert.equal(win.nect.evaluate().path.fill.endColor.alpha, 0.25);
  field('endColor')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.equal(win.nect.evaluate().path.fill.endColor.alpha, 1);
  field('start').querySelector('[data-lock]').click();
  assert.equal(input('start').disabled, true);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(input('start').disabled, false);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(input('start').disabled, true);
  field('start').querySelector('[data-lock]').click();
  await change(field('startColor').querySelector('[data-color="alpha"]'), '0');
  assert.equal(win.nect.evaluate().path.fill.startColor.alpha, 0);
  assert.equal(document.querySelector('linearGradient stop').getAttribute('stop-opacity'), '0');
  const alphaSaved = saved();
  await change(field('startColor').querySelector('[data-color="alpha"]'), '1.1');
  assert.equal(saved(), alphaSaved);
  const json = saved(),
    svg = win.nect.export();
  win.nect.load(json);
  assert.equal(saved(), json);
  assert.equal(win.nect.export(), svg);
  // Exercise the real file-open handler, including one-step history and late
  // rejection. A parser success alone must never imply the UI changed atomically.
  const importFile = async (text) => {
    const input = document.querySelector('#import-svg-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ name: 'gradient.svg', size: text.length, text: async () => text }],
    });
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  await importFile(svg);
  const imported = saved();
  assert.notEqual(imported, json);
  assert.ok(win.nect.document.layers[0].nodes.some((n) => n.type === 'Linear Gradient Fill'));
  assert.equal(win.nect.export(), svg);
  for (const invalid of [
    svg.replace('spreadMethod="pad"', 'spreadMethod="reflect"'),
    svg.replace('</svg>', '<rect onload="alert(1)"/></svg>'),
    svg.replace('<linearGradient ', '<linearGradient href="#loop" '),
    svg.replace('url(#nect-gradient-0)', 'url(#missing)'),
  ]) {
    await importFile(invalid);
    assert.match(document.querySelector('.status .message').textContent, /Open rejected/);
    assert.equal(saved(), imported);
  }
  document.querySelector('[data-action="undo"]').click();
  assert.equal(saved(), json);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(saved(), imported);
  await importFile(svg);
  assert.notEqual(saved(), imported); // Fresh node IDs, independently editable graph.
  document.querySelector('[data-action="undo"]').click();
  assert.equal(saved(), imported);
  win.close();
});
