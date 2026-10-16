import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Transform pivot controls, parameter lock, group drag, history and legacy default', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'DOMPoint', 'requestAnimationFrame'])
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
  const add = async (type) => {
    await change(document.querySelector('#add-node'), type);
    return win.nect.document.layers[0].nodes.at(-1).id;
  };
  const { document: makeDoc, node, connect } = await import('../src/core.js');
  const doc = makeDoc(),
    l = doc.layers[0],
    a = node('Rectangle'),
    b = node('Circle'),
    j = node('Join Geometry'),
    t = node('Transform'),
    o = node('Output');
  l.nodes = [a, b, j, t, o];
  l.output = o.id;
  connect(l, a.id, j.id, 'a');
  connect(l, b.id, j.id, 'b');
  connect(l, j.id, t.id, 'path');
  connect(l, t.id, o.id, 'path');
  win.nect.load(JSON.stringify(doc));
  document
    .querySelector(`.node[data-id="${t.id}"] .node-head strong`)
    .dispatchEvent(
      new win.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }),
    );
  document.dispatchEvent(
    new win.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 0, clientY: 0 }),
  );
  await tick();
  const f = (key) =>
    document.querySelector(`.inspector-body .field[data-node="${t.id}"][data-key="${key}"]`);
  await change(f('anchor').querySelector('[data-value]'), '25');
  assert.deepEqual(win.nect.document.layers[0].nodes[3].params.anchor.value, [25, 0]);
  const pointer = (target, type, x, y) =>
    target.dispatchEvent(
      new win.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
    );
  const drag = async () => {
    pointer(document.querySelector('[data-node-stage-move]'), 'pointerdown', 200, 200);
    pointer(document, 'pointermove', 230, 215);
    pointer(document, 'pointerup', 230, 215);
    await tick();
  };
  const children = JSON.stringify(win.nect.document.layers[0].nodes.slice(0, 2));
  await drag();
  assert.deepEqual(win.nect.document.layers[0].nodes[3].params.offset.value, [30, 15]);
  assert.equal(JSON.stringify(win.nect.document.layers[0].nodes.slice(0, 2)), children);
  document.querySelector('[data-action="undo"]').click();
  await tick();
  assert.deepEqual(win.nect.document.layers[0].nodes[3].params.offset.value, [0, 0]);
  f('offset').querySelector('[data-lock]').click();
  await tick();
  await drag();
  assert.deepEqual(win.nect.document.layers[0].nodes[3].params.offset.value, [0, 0]);
  win.happyDOM.abort();
});
