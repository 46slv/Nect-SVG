import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('synthetic editor DOM: sockets, pen, handles, multi-selection, locks, undo and reload', async () => {
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
    .replace("from './layout.js'", `from '${new URL('../src/layout.js', import.meta.url)}'`)
    .replace("from './core.js'", `from '${new URL('../src/core.js', import.meta.url)}'`)
    .replace("from './svg-import.js'", `from '${new URL('../src/svg-import.js', import.meta.url)}'`)
    .replace("from './storage.js'", `from '${new URL('../src/storage.js', import.meta.url)}'`)
    .replace("from 'opentype.js'", `from '${import.meta.resolve('opentype.js')}'`);
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 100));
  let doc = win.nect.document,
    circle = doc.layers[0].nodes[0];
  assert.equal(document.querySelectorAll('.node').length, 5);
  assert.ok(document.querySelector('.shape').getAttribute('d'));
  let radius = document.querySelector(
    `.graph [data-node="${circle.id}"][data-key="radius"] [data-value]`,
  );
  radius.value = '60';
  radius.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value, 60);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value, 120);
  let add = document.querySelector('#add-node');
  add.value = 'Value';
  add.dispatchEvent(new win.Event('change', { bubbles: true }));
  let value = win.nect.document.layers[0].nodes.at(-1);
  document
    .querySelector(`[data-source="${value.id}"]`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  document
    .querySelector(`.graph [data-node="${circle.id}"][data-key="radius"]`)
    .dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true }));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source, value.id);
  assert.equal(
    document.querySelectorAll(`.graph [data-node="${circle.id}"][data-key="radius"] .input`).length,
    1,
  );
  document
    .querySelector(`.graph [data-node="${circle.id}"][data-key="radius"] .input`)
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source, undefined);
  let old = win.nect.export(),
    serialized = JSON.stringify(win.nect.document);
  win.nect.load(serialized);
  assert.equal(win.nect.export(), old);
  assert.throws(() => win.nect.load('{"schemaVersion":99}'));
  assert.equal(win.nect.export(), old);
  document.querySelector('[data-action="add-layer"]').click();
  assert.equal(win.nect.document.layers.length, 2);
  assert.equal(document.querySelectorAll('.layer').length, 2);
  const pointer = (target, type, x = 0, y = 0, extra = {}) =>
    target.dispatchEvent(
      new win.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }),
    );
  // Synthetic identity CTM exercises the actual event handlers, not browser layout.
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointerup', 100, 100);
  pointer(document.querySelector('.artboard'), 'pointerdown', 300, 100);
  pointer(document, 'pointermove', 330, 130);
  pointer(document, 'pointerup', 330, 130);
  pointer(document.querySelector('.artboard'), 'pointerdown', 200, 300);
  pointer(document, 'pointerup', 200, 300);
  let curve = win.nect.document.layers[1].nodes.find((n) => n.type === 'Curve');
  assert.equal(curve.points.length, 3);
  assert.deepEqual(curve.points[1].handleB.value, [30, 30]);
  pointer(
    document.querySelector(`.vertex[data-point="${curve.points[0].id}"]`),
    'pointerdown',
    100,
    100,
  );
  pointer(document, 'pointerup', 100, 100);
  assert.equal(curve.params.closed.value, true);
  curve.points[0].position.locked = true;
  pointer(
    document.querySelector(`.vertex[data-point="${curve.points[0].id}"]`),
    'pointerdown',
    100,
    100,
  );
  pointer(document, 'pointermove', 150, 150);
  pointer(document, 'pointerup', 150, 150);
  assert.deepEqual(curve.points[0].position.value, [100, 100]);
  let [circle2, rectangle2] = win.nect.document.layers[1].nodes;
  pointer(document.querySelector(`.node[data-id="${circle2.id}"] .node-head`), 'pointerdown');
  pointer(document, 'pointerup');
  pointer(
    document.querySelector(`.node[data-id="${rectangle2.id}"] .node-head`),
    'pointerdown',
    0,
    0,
    { shiftKey: true },
  );
  pointer(document, 'pointerup');
  assert.equal(document.querySelectorAll('.node.selected').length, 2);
  const centers = [...circle2.params.center.value, ...rectangle2.params.center.value];
  pointer(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 110, 120);
  pointer(document, 'pointerup', 110, 120);
  assert.deepEqual(circle2.params.center.value, [centers[0] + 10, centers[1] + 20]);
  assert.deepEqual(rectangle2.params.center.value, [centers[2] + 10, centers[3] + 20]);
  rectangle2.params.center.locked = true;
  const unchanged = JSON.stringify(win.nect.document);
  pointer(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 150, 150);
  pointer(document, 'pointerup', 150, 150);
  assert.equal(JSON.stringify(win.nect.document), unchanged);
  // Undoing a pen-created node must not leave a stale drawing target.
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 400, 100);
  pointer(document, 'pointerup', 400, 100);
  document.querySelector('[data-action="undo"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 410, 110);
  pointer(document, 'pointerup', 410, 110);
  assert.deepEqual(win.nect.document.layers[1].nodes.at(-1).points[0].position.value, [410, 110]);
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  add = document.querySelector('#add-node');
  add.value = 'Transform';
  add.dispatchEvent(new win.Event('change', { bubbles: true }));
  let transform = win.nect.document.layers[1].nodes.at(-1),
    outputId = win.nect.document.layers[1].output;
  let pathSelect = document.querySelector(
    `.node[data-id="${transform.id}"] [data-key="path"] select`,
  );
  pathSelect.value = outputId;
  pathSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  let beforeCycle = JSON.stringify(win.nect.document);
  document.querySelector(`[data-preview="${transform.id}"]`).click();
  assert.equal(JSON.stringify(win.nect.document), beforeCycle);
  assert.match(document.querySelector('.message').textContent, /cycle/);
  document.querySelector(`.node[data-id="${outputId}"] [data-key="path"] [data-lock]`).click();
  let lockedOutput = JSON.stringify(win.nect.document);
  document.querySelector('[data-tool="Circle"]').click();
  assert.equal(JSON.stringify(win.nect.document), lockedOutput);
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 50, 50);
  pointer(document, 'pointerup', 50, 50);
  assert.equal(JSON.stringify(win.nect.document), lockedOutput);
  await win.happyDOM.close();
});
