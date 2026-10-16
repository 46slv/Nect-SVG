import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as makeDoc, node, connect, setReference } from '../src/core.js';
test('Reference UI: typed picker, diagnostics, atomic cycles, jump, multi-copy, locks and delete/Undo', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = win[key];
  globalThis.requestAnimationFrame = () => 0;
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
      const b = await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await tick();
  const d = makeDoc(),
    l = d.layers[0],
    ref = node('Reference'),
    master = node('Text'),
    vector = node('Vector'),
    scalar = node('Value'),
    follower = node('Text'),
    out = node('Output');
  master.params.position.value = [120, 210];
  vector.params.value.value = [80, 90];
  l.nodes = [ref, master, vector, scalar, follower, out];
  l.output = out.id;
  connect(l, ref.id, follower.id, 'position');
  connect(l, follower.id, out.id, 'path');
  const load = async () => {
    win.nect.load(JSON.stringify(d));
    await tick();
  };
  await load();
  const saved = () => JSON.stringify(win.nect.document),
    get = (id) => win.nect.document.layers[0].nodes.find((n) => n.id === id),
    picker = () => document.querySelector('.inspector-body [data-reference-target]'),
    status = () => document.querySelector(`[data-reference-status="${ref.id}"]`),
    value = (n, port = 'output') => JSON.stringify([n.id, port]);
  const change = async (el, v) => {
    el.value = v;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const click = async (sel) => {
    document.querySelector(sel).click();
    await tick();
  };
  const select = async (id, shift = false) => {
    document
      .querySelector(`.node[data-id="${id}"] .node-head strong`)
      .dispatchEvent(
        new win.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, shiftKey: shift }),
      );
    document.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();
  };
  assert.match(status().textContent, /not selected/);
  assert.ok([...picker().options].some((o) => o.value === value(master, 'position')));
  assert.ok(
    ![...picker().options].some((o) => o.value === value(master) || o.value === value(scalar)),
  );
  await change(picker(), value(master, 'position'));
  assert.deepEqual(win.nect.evaluate().run(ref.id), [120, 210]);
  assert.match(status().textContent, /Text · Position/);
  assert.equal(document.querySelectorAll(`[data-preview="${ref.id}"]`).length, 0);
  const before = saved();
  await change(picker(), value(follower, 'position'));
  assert.equal(saved(), before);
  assert.match(document.querySelector('.status').textContent, /cycle/i);
  assert.equal(picker().value, value(master, 'position'));
  await click('[data-action="undo"]');
  assert.equal(get(ref.id).reference, null);
  await click('[data-action="redo"]');
  assert.deepEqual(get(ref.id).reference, { nodeId: master.id, portId: 'position' });
  await click(`.inspector-body [data-reference-jump="${ref.id}"]`);
  assert.equal(document.querySelector('.inspector-body h3').textContent, 'Text');
  await change(
    document.querySelector('.inspector-body [data-key="position"] [data-axis="0"]'),
    '300',
  );
  assert.deepEqual(win.nect.evaluate().run(ref.id), [300, 210]);
  await select(ref.id);
  await click(`[data-collapse="${ref.id}"]`);
  assert.match(document.querySelector(`.node[data-id="${ref.id}"]`).textContent, /Text · Position/);
  await click(`[data-collapse="${ref.id}"]`);
  // Selection duplication remaps a copied Text Position source and keeps original values independent.
  await select(master.id);
  await select(ref.id, true);
  await click(`.graph [data-duplicate="${ref.id}"]`);
  const copies = win.nect.document.layers[0].nodes.filter((n) => n.name.endsWith(' copy')),
    copiedRef = copies.find((n) => n.type === 'Reference'),
    copiedMaster = copies.find((n) => n.type === 'Text');
  assert.equal(copies.length, 2);
  assert.equal(copiedRef.reference.nodeId, copiedMaster.id);
  assert.equal(copiedRef.reference.portId, 'position');
  await click('[data-action="undo"]');
  assert.equal(win.nect.document.layers[0].nodes.length, l.nodes.length);
  await select(ref.id);
  await click(`.graph [data-duplicate="${ref.id}"]`);
  assert.equal(win.nect.document.layers[0].nodes.at(-1).reference.nodeId, master.id);
  await click('[data-action="undo"]');
  await click(`.graph [data-delete="${master.id}"]`);
  assert.match(status().textContent, /Reference target is missing/);
  assert.equal(get(ref.id).reference.nodeId, master.id);
  assert.match(win.nect.evaluate().error, /missing/);
  assert.throws(() => win.nect.export(), /missing/);
  const missing = saved();
  await click('[data-action="undo"]');
  assert.deepEqual(win.nect.evaluate().run(ref.id), [300, 210]);
  await click('[data-action="redo"]');
  assert.equal(saved(), missing);
  win.nect.load(missing);
  await tick();
  assert.match(status().textContent, /missing/);
  await change(picker(), value(vector));
  assert.deepEqual(win.nect.evaluate().run(ref.id), [80, 90]);
  await change(picker(), '');
  assert.match(status().textContent, /not selected/);
  await change(picker(), value(vector));
  const locked = JSON.parse(saved());
  locked.layers[0].locked = true;
  win.nect.load(JSON.stringify(locked));
  await tick();
  assert.equal(picker().disabled, true);
  const lockedSaved = saved();
  await change(picker(), value(follower, 'position'));
  assert.equal(saved(), lockedSaved);
  await click(`.inspector-body [data-reference-jump="${ref.id}"]`);
  assert.equal(document.querySelector('.inspector-body h3').textContent, 'Vector');
  await win.happyDOM.close();
});
