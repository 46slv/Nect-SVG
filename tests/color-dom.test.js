import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('synthetic Color controls: source display, fallback restoration, alpha validation and locks', async () => {
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
  await change(document.querySelector('#add-node'), 'Color');
  const colorId = win.nect.document.layers[0].nodes.at(-1).id;
  const outputId = win.nect.document.layers[0].nodes.find((n) => n.type === 'Fill').id;
  const field = (id, key) =>
    document.querySelector(`.graph .field[data-node="${id}"][data-key="${key}"]`);
  await change(field(colorId, 'value').querySelector('[data-color="hex"]'), '#ff8000');
  await change(field(colorId, 'value').querySelector('[data-color="alpha"]'), '0.5');
  await change(field(outputId, 'color').querySelector('[data-color="hex"]'), '#2040ff');
  await change(field(outputId, 'color').querySelector('[data-color="alpha"]'), '0.25');
  assert.deepEqual(win.nect.evaluate().path.fill, { hex: '#2040ff', alpha: 0.25 });
  document
    .querySelector(`[data-source="${colorId}"]`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  field(outputId, 'color').dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true }));
  await tick();
  assert.deepEqual(win.nect.evaluate().path.fill, { hex: '#ff8000', alpha: 0.5 });
  assert.equal(field(outputId, 'color').querySelector('[data-color="hex"]').value, '#ff8000');
  assert.equal(field(outputId, 'color').querySelector('[data-color="alpha"]').disabled, true);
  field(outputId, 'color')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.deepEqual(win.nect.evaluate().path.fill, { hex: '#2040ff', alpha: 0.25 });
  document.querySelector('[data-action="undo"]').click();
  assert.equal(win.nect.evaluate().path.fill.alpha, 0.5);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(win.nect.evaluate().path.fill.alpha, 0.25);
  assert.equal(document.querySelector('[data-fill]'), null);
  assert.equal(document.querySelector('[data-color-layer]'), null);
  await change(field(colorId, 'value').querySelector('[data-color="alpha"]'), '0');
  assert.equal(win.nect.document.layers[0].nodes.at(-1).params.value.value.alpha, 0);
  const saved = JSON.stringify(win.nect.document);
  await change(field(colorId, 'value').querySelector('[data-color="alpha"]'), '2');
  assert.equal(JSON.stringify(win.nect.document), saved);
  field(colorId, 'value').querySelector('[data-lock]').click();
  assert.equal(field(colorId, 'value').querySelector('[data-color="hex"]').disabled, true);
  assert.equal(field(colorId, 'value').querySelector('[data-color="alpha"]').disabled, true);
  win.close();
});
