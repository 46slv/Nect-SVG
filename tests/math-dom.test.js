import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('synthetic math UI: distinct X/Y sockets, menus, active fields, collapse, disconnect and history', async () => {
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
  const v = await add('Vector'),
    separate = await add('Separate Vector'),
    math = await add('Math'),
    combine = await add('Combine Vector');
  const field = (id, key) =>
    document.querySelector(`.graph .field[data-node="${id}"][data-key="${key}"]`);
  const operation = () => document.querySelector(`.graph [data-operation="${math}"]`);
  const wire = async (from, to, key, port) => {
    document
      .querySelector(`[data-source="${from}"]${port ? `[data-source-port="${port}"]` : ''}`)
      .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    assert.ok(document.querySelector('.wire-preview'));
    document.dispatchEvent(
      new win.PointerEvent('pointermove', { bubbles: true, clientX: 123, clientY: 234 }),
    );
    assert.match(document.querySelector('.wire-preview').getAttribute('d'), /123,234$/);
    field(to, key).dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, button: 0 }));
    await tick();
  };
  await wire(v, separate, 'vector');
  await wire(separate, math, 'a', 'x');
  await wire(math, combine, 'x');
  await wire(separate, combine, 'y', 'y');
  assert.deepEqual(win.nect.evaluate().run(combine), [300, 250]);
  assert.equal(field(math, 'a').querySelector('[data-value]').value, '300');
  await change(field(math, 'b').querySelector('[data-value]'), '5');
  assert.deepEqual(win.nect.evaluate().run(combine), [305, 250]);
  await change(operation(), 'abs');
  assert.equal(field(math, 'b'), null);
  assert.equal(field(math, 'min'), null);
  await change(operation(), 'clamp');
  assert.ok(field(math, 'min'));
  assert.ok(field(math, 'max'));
  assert.equal(field(math, 'b'), null);
  await change(operation(), 'add');
  assert.equal(field(math, 'b').querySelector('[data-value]').value, '5');
  field(math, 'a').querySelector('[data-connect-menu]').click();
  const menu = document.querySelector('dialog select');
  assert.ok([...menu.options].some((o) => o.value === JSON.stringify([separate, 'x'])));
  assert.ok([...menu.options].some((o) => o.value === JSON.stringify([separate, 'y'])));
  menu.value = JSON.stringify([separate, 'y']);
  document.querySelector('[data-confirm]').click();
  await tick();
  assert.deepEqual(win.nect.evaluate().run(combine), [255, 250]);
  document.querySelector(`[data-collapse="${separate}"]`).click();
  assert.equal(
    document.querySelectorAll(`[data-source="${separate}"][data-source-port]`).length,
    2,
  );
  await wire(separate, math, 'a', 'x');
  assert.deepEqual(win.nect.evaluate().run(combine), [305, 250]);
  field(math, 'a')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.deepEqual(win.nect.evaluate().run(combine), [5, 250]);
  document.querySelector('[data-action="undo"]').click();
  assert.deepEqual(win.nect.evaluate().run(combine), [305, 250]);
  document.querySelector('[data-action="redo"]').click();
  assert.deepEqual(win.nect.evaluate().run(combine), [5, 250]);
  win.nect.load(JSON.stringify(win.nect.document));
  assert.deepEqual(win.nect.evaluate().run(combine), [5, 250]);
  const vm = await add('Vector Math');
  await wire(vm, v, 'value');
  const vmOp = () => document.querySelector(`.graph [data-operation="${vm}"]`);
  const beforeReject = JSON.stringify(win.nect.document);
  await change(vmOp(), 'length');
  assert.equal(JSON.stringify(win.nect.document), beforeReject);
  assert.equal(vmOp().value, 'add');
  field(v, 'value')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  await change(vmOp(), 'length');
  assert.equal(field(vm, 'b'), null);
  assert.equal(field(vm, 'scale'), null);
  await wire(vm, combine, 'x');
  await change(vmOp(), 'normalize');
  assert.equal(win.nect.document.layers[0].nodes.find((n) => n.id === vm).operation, 'length');
  assert.equal(vmOp().querySelector('option[selected]').value, 'length');
  field(combine, 'x')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  await change(vmOp(), 'scale');
  assert.ok(field(vm, 'scale'));
  assert.equal(field(vm, 'b'), null);
  const beforeCancel = JSON.stringify(win.nect.document);
  document
    .querySelector(`[data-source="${separate}"][data-source-port="y"]`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  assert.ok(document.querySelector('.wire-preview'));
  document
    .querySelector('.graph-scroll')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.wire-preview'), null);
  assert.equal(JSON.stringify(win.nect.document), beforeCancel);
  win.close();
});
