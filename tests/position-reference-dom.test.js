import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Position reference controls preserve values, history, text edits and connected geometry', async () => {
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
  const { document: makeDoc, node, connect, pathBounds } = await import('../src/core.js');
  const doc = makeDoc(),
    l = doc.layers[0],
    t = node('Text'),
    out = node('Output');
  t.text = 'Nect';
  t.alignment = 'end';
  t.params.position.value = [500, 300];
  l.nodes = [t, out];
  l.output = out.id;
  connect(l, t.id, out.id, 'path');
  win.nect.load(JSON.stringify(doc));
  // Font I/O/parsing is asynchronous; elapsed time does not prove Text is ready.
  const readyDeadline = Date.now() + 5000;
  while (win.nect.evaluate().error !== null) {
    assert.ok(Date.now() < readyDeadline, win.nect.evaluate().error);
    await tick();
  }
  const control = (selector) => document.querySelector('.inspector-body ' + selector);
  const bound = () => pathBounds(win.nect.evaluate().path);
  assert.ok(Math.abs(bound()[0][2] - 500) < 0.00002);
  assert.equal(document.querySelectorAll('.inspector-body [data-text-alignment]').length, 1);
  await change(control('[data-text]'), 'Small subtitle');
  await change(control('[data-key="size"] [data-value]'), '24');
  assert.ok(Math.abs(bound()[0][2] - 500) < 0.00002);
  await change(control('[data-cross-alignment]'), 'end');
  assert.ok(Math.abs(bound()[1][2] - 300) < 0.00002);
  document.querySelector('[data-action="undo"]').click();
  await tick();
  assert.equal(control('[data-cross-alignment]').value, 'origin');
  document.querySelector('[data-action="redo"]').click();
  await tick();
  assert.equal(win.nect.document.layers[0].nodes[0].crossAlignment, 'end');
  assert.equal(control('[data-cross-alignment] option[selected]').value, 'end');
  await change(control('[data-reference-bounds]'), 'advance');
  assert.ok(Math.abs(bound()[0][2] - 500) > 0.01);
  const id = await add('Rectangle');
  const rect = () => win.nect.document.layers[0].nodes.find((n) => n.id === id);
  const original = structuredClone(rect().params.center.value);
  await change(control('[data-position-reference]'), 'right-bottom');
  assert.deepEqual(rect().params.center.value, original);
  let b = pathBounds(win.nect.evaluate().run(id));
  assert.equal(b[0][2], original[0]);
  assert.equal(b[1][2], original[1]);
  await change(control('[data-key="size"] [data-value]'), '300');
  b = pathBounds(win.nect.evaluate().run(id));
  assert.equal(b[0][2], original[0]);
  assert.equal(control('[data-key="center"] label').textContent, 'Position');
  const saved = JSON.stringify(win.nect.document);
  win.nect.load(saved);
  assert.equal(
    win.nect.document.layers[0].nodes.find((n) => n.id === id).positionReference,
    'right-bottom',
  );
  win.happyDOM.abort();
});
