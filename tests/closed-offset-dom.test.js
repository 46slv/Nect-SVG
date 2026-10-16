import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Closed Path Offset controls, failure rollback, scrubbing, typed inputs, locks and history', async () => {
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
  const { document: makeDoc, node, connect } = await import('../src/core.js');
  const doc = makeDoc(),
    l = doc.layers[0],
    r = node('Rectangle'),
    offset = node('Closed Path Offset'),
    fill = node('Fill'),
    out = node('Output'),
    value = node('Value'),
    vector = node('Vector'),
    curve = node('Curve');
  r.params.center.value = [50, 30];
  r.params.size.value = [100, 60];
  value.params.value.value = -10;
  curve.params.closed.value = false;
  l.nodes = [r, offset, fill, out, value, vector, curve];
  l.output = out.id;
  connect(l, r.id, offset.id, 'path');
  connect(l, offset.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  win.nect.load(JSON.stringify(doc));
  const saved = () => JSON.stringify(win.nect.document),
    val = (key) =>
      win.nect.document.layers[0].nodes.find((n) => n.id === offset.id).params[key].value;
  const field = (key) =>
    document.querySelector(`.graph .field[data-node="${offset.id}"][data-key="${key}"]`);
  const input = (key) => field(key).querySelector('[data-value]');
  const join = () => document.querySelector(`.graph [data-operation="${offset.id}"]`);
  assert.ok(
    [...document.querySelector('#add-node').options].some((x) => x.value === 'Closed Path Offset'),
  );
  assert.equal(field('path').dataset.type, 'Path');
  assert.equal(field('amount').dataset.type, 'Scalar');
  document
    .querySelector(`.node[data-id="${offset.id}"] .node-head strong`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
  document.dispatchEvent(
    new win.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }),
  );
  assert.match(document.querySelector('.inspector-body').textContent, /256 flattened/);
  await change(input('amount'), '-10');
  assert.equal(val('amount'), -10);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(val('amount'), 10);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(val('amount'), -10);
  await change(join(), 'bevel');
  assert.equal(
    win.nect.document.layers[0].nodes.find((n) => n.id === offset.id).operation,
    'bevel',
  );
  document.querySelector('[data-action="undo"]').click();
  for (const [key, bad] of [
    ['amount', ''],
    ['amount', '0.00001'],
    ['amount', '1000000000'],
    ['miterLimit', '101'],
  ]) {
    const before = saved(),
      svg = win.nect.export();
    await change(input(key), bad);
    assert.equal(saved(), before);
    assert.equal(win.nect.export(), svg);
  }
  const before = saved();
  await change(field('path').querySelector('select'), curve.id);
  assert.equal(saved(), before);
  assert.match(document.querySelector('.status .message').textContent, /closed/);
  field('amount').querySelector('[data-connect-menu]').click();
  assert.equal(document.querySelector(`dialog option[value="${vector.id}"]`), null);
  document.querySelector('dialog select').value = value.id;
  document.querySelector('dialog [data-confirm]').click();
  assert.equal(input('amount').disabled, true);
  assert.equal(val('amount'), -10);
  field('amount')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  await tick();
  assert.equal(input('amount').disabled, false);
  field('amount').querySelector('[data-lock]').click();
  assert.equal(input('amount').disabled, true);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(input('amount').disabled, false);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(input('amount').disabled, true);
  field('amount').querySelector('[data-lock]').click();
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
  const numericSnapshot = saved();
  pointer(input('amount'), 'pointerdown', 100);
  pointer(document, 'pointermove', 120);
  pointer(document, 'pointerup', 120);
  assert.equal(val('amount'), 6);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(saved(), numericSnapshot);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(val('amount'), 6);
  for (const cancel of ['Escape', 'pointercancel', 'blur']) {
    const baseline = saved();
    pointer(input('amount'), 'pointerdown', 100);
    pointer(document, 'pointermove', 120);
    if (cancel === 'Escape')
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (cancel === 'blur') win.dispatchEvent(new win.Event('blur'));
    else pointer(document, 'pointercancel', 120);
    assert.equal(saved(), baseline);
  }
  // Out-of-envelope drag never commits or replaces the last valid preview.
  const stable = saved(),
    svg = win.nect.export();
  pointer(input('amount'), 'pointerdown', 100);
  pointer(document, 'pointermove', 100000);
  pointer(document, 'pointerup', 100000);
  assert.equal(saved(), stable);
  assert.equal(win.nect.export(), svg);
  await change(input('amount'), '-30');
  assert.equal(win.nect.evaluate().path.contours.length, 0);
  await change(input('amount'), '0');
  assert.equal(win.nect.evaluate().path.contours.length, 1);
  const json = saved(),
    exported = win.nect.export();
  win.nect.load(json);
  assert.equal(saved(), json);
  assert.equal(win.nect.export(), exported);
  // First-time embedding changes available fonts inside the same transaction.
  const textDoc = makeDoc(),
    textLayer = textDoc.layers[0],
    text = node('Text'),
    textOffset = node('Closed Path Offset'),
    textFill = node('Fill'),
    textOut = node('Output');
  text.text = 'I';
  textOffset.params.amount.value = 1;
  textLayer.nodes = [text, textOffset, textFill, textOut];
  textLayer.output = textOut.id;
  connect(textLayer, text.id, textOffset.id, 'path');
  connect(textLayer, textOffset.id, textFill.id, 'path');
  connect(textLayer, textFill.id, textOut.id, 'path');
  win.nect.load(JSON.stringify(textDoc));
  assert.equal(win.nect.evaluate().error, null);
  const fontBefore = saved();
  document.querySelector('.inspector-body [data-load-font]').click();
  const fontInput = document.querySelector('#font-file'),
    bytes = await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
  Object.defineProperty(fontInput, 'files', {
    configurable: true,
    value: [
      {
        name: 'embedded.ttf',
        size: bytes.byteLength,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      },
    ],
  });
  fontInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Object.keys(win.nect.document.fontAssets || {}).length, 1);
  assert.equal(win.nect.evaluate().error, null);
  const fontAfter = saved();
  document.querySelector('[data-action="undo"]').click();
  assert.equal(saved(), fontBefore);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(saved(), fontAfter);
  assert.equal(win.nect.evaluate().error, null);
  win.close();
});
