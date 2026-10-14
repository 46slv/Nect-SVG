import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  connect,
  setCharacterOffsets,
  setCharacterTransforms,
  transformCharacterPoint,
} from '../src/core.js';
test('character shape UI: mixed absolute edits, separate resets, history, draft Escape, transformed XY cancel, mapping and locks', async () => {
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
  win.SVGElement.prototype.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
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
  await new Promise((r) => setTimeout(r, 70));
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const doc = makeDoc(),
    l = doc.layers[0],
    t = node('Text'),
    tr = node('Transform'),
    out = node('Output');
  t.text = 'ABA';
  t.params.position.value = [100, 180];
  t.params.size.value = 50;
  t.params.position.locked = true;
  tr.params.anchor.value = [80, 120];
  tr.params.offset.value = [230, 0];
  tr.params.scale.value = -2;
  tr.params.rotation.value = 90;
  l.nodes = [t, tr, out];
  l.output = out.id;
  connect(l, t.id, tr.id, 'path');
  connect(l, tr.id, out.id, 'path');
  const load = (d = doc) => win.nect.load(JSON.stringify(d)),
    get = () => win.nect.document.layers[0].nodes.find((n) => n.id === t.id);
  const saved = () => JSON.stringify(win.nect.document),
    mode = () => document.querySelector('[data-character-mode]').click();
  const undo = () => document.querySelector('[data-action="undo"]').click(),
    redo = () => document.querySelector('[data-action="redo"]').click();
  const select = (...ids) => {
    const el = document.querySelector('[data-character-selection]');
    for (const o of el.options) o.selected = ids.includes(o.value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const field = (key) =>
    document.querySelector(`.inspector-body [data-character-transform="${key}"]`);
  const edit = async (key, value) => {
    const el = field(key);
    el.value = String(value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const pointer = (el, type, x, y, extra = {}) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  const key = (el, value) =>
    el.dispatchEvent(
      new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value }),
    );
  load();
  // Await actual font-backed evaluation, not a fixed delay under the parallel full suite.
  for (let i = 0; i < 250 && win.nect.evaluate().error; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(win.nect.evaluate().error, null);
  const initial = saved();
  mode();
  select('c2');
  assert.equal(saved(), initial);
  assert.equal(
    field('rotation').disabled,
    false,
    'locked Text Position does not lock character shape',
  );
  assert.equal(document.querySelectorAll('[data-character-pivot="c2"]').length, 1);
  await edit('rotation', 30);
  assert.deepEqual(get().characterPositions.transforms, { c2: { rotation: 30, scale: 1 } });
  assert.equal(win.nect.document.schemaVersion, 4);
  const rotated = saved();
  undo();
  assert.equal(saved(), initial);
  redo();
  assert.equal(saved(), rotated);
  mode();
  select('c2');
  await edit('scale', 1.5);
  assert.deepEqual(get().characterPositions.transforms.c2, { rotation: 30, scale: 1.5 });
  const shaped = saved();
  assert.equal(get().params.size.value, 50);
  assert.deepEqual(get().params.position.value, [100, 180]);
  select('c1', 'c2');
  assert.equal(field('scale').placeholder, 'Mixed');
  assert.equal(field('rotation').placeholder, 'Mixed');
  await edit('rotation', -15);
  assert.deepEqual(get().characterPositions.transforms, {
    c1: { rotation: -15, scale: 1 },
    c2: { rotation: -15, scale: 1.5 },
  });
  undo();
  assert.equal(saved(), shaped);
  mode();
  select('c2');
  const draft = field('rotation');
  draft.focus();
  draft.value = '70';
  key(draft, 'Escape');
  assert.equal(draft.value, '30');
  draft.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(saved(), shaped);
  for (const value of [0, -1, 101, '']) {
    await edit('scale', value);
    assert.equal(saved(), shaped);
  }
  // Existing XY gesture still targets source offsets under negative/rotated downstream transforms.
  for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    const result = win.nect.evaluate(),
      g = result.textLayout(t.id).characters[1],
      o = result.path.characterOccurrences[0];
    const p = transformCharacterPoint(o.matrix, [
      (g.bounds[0] + g.bounds[2]) / 2,
      (g.bounds[1] + g.bounds[3]) / 2,
    ]);
    const stage = document.querySelector('.canvas-stage');
    pointer(stage, 'pointerdown', ...p, { altKey: true });
    pointer(document, 'pointermove', p[0] + 18, p[1] + 12, { altKey: true });
    assert.equal(win.nect.document.schemaVersion, 4);
    assert.deepEqual(get().characterPositions.transforms.c2, { rotation: 30, scale: 1.5 });
    if (cancel === 'Escape') key(document.querySelector('.canvas-stage'), 'Escape');
    else if (cancel === 'blur') win.dispatchEvent(new win.Event('blur'));
    else
      pointer(
        cancel === 'lostpointercapture' ? document.querySelector('.canvas-stage') : document,
        cancel,
        ...p,
      );
    pointer(document, 'pointerup', ...p);
    assert.equal(saved(), shaped, cancel);
  }
  const x = document.querySelector('.inspector-body [data-character-axis="0"]');
  x.value = '12';
  x.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(win.nect.document.schemaVersion, 4);
  assert.deepEqual(get().characterPositions.offsets.c2, [12, 0]);
  const withXY = saved();
  document.querySelector('.inspector-body [data-character-shape-reset]').click();
  assert.deepEqual(get().characterPositions.transforms, {});
  assert.deepEqual(get().characterPositions.offsets.c2, [12, 0]);
  undo();
  assert.equal(saved(), withXY);
  mode();
  select('c2');
  document.querySelector('.inspector-body [data-character-reset="selected"]').click();
  assert.deepEqual(get().characterPositions.offsets, {});
  assert.deepEqual(get().characterPositions.transforms.c2, { rotation: 30, scale: 1.5 });
  const roundtrip = saved();
  load(JSON.parse(roundtrip));
  assert.equal(saved(), roundtrip);
  // Shape-only unverified source edit blocks export and offers explicit full recovery.
  const unknown = JSON.parse(roundtrip);
  unknown.layers[0].nodes[0].text = 'AABA';
  load(unknown);
  mode();
  assert.match(document.querySelector('.character-panel').textContent, /suspended/);
  assert.equal(field('rotation').disabled, true);
  assert.throws(() => win.nect.export(), /suspended/);
  document.querySelector('[data-character-reset="all"]').click();
  assert.equal(get().characterPositions.basis, 'AABA');
  assert.doesNotThrow(() => win.nect.export());
  for (const type of ['singular', 'remap']) {
    const blocked = JSON.parse(roundtrip),
      bl = blocked.layers[0];
    if (type === 'singular') bl.nodes[1].params.scale.value = 0;
    else {
      const remap = node('Path Remap');
      bl.nodes.push(remap);
      connect(bl, tr.id, remap.id, 'path');
      connect(bl, remap.id, out.id, 'path');
    }
    load(blocked);
    mode();
    assert.equal(document.querySelectorAll('.character-hit').length, 0);
    select('c2');
    assert.equal(field('rotation').disabled, false);
    await edit('rotation', 10);
    assert.equal(get().characterPositions.transforms.c2.rotation, 10);
  }
  const locked = JSON.parse(roundtrip);
  locked.layers[0].locked = true;
  load(locked);
  assert.equal(document.querySelector('[data-character-mode]').disabled, true);
  // Legacy XY record is upgraded only by a non-identity shape edit; zero writes are no-op.
  const old = structuredClone(doc);
  old.schemaVersion = 3;
  old.layers[0].nodes[0].characterPositions = setCharacterOffsets('ABA', undefined, { c2: [2, 3] });
  load(old);
  mode();
  select('c2');
  const oldSaved = saved();
  await edit('rotation', 0);
  assert.equal(saved(), oldSaved);
  await edit('scale', 2);
  assert.equal(get().characterPositions.version, 2);
  assert.deepEqual(get().characterPositions.offsets.c2, [2, 3]);
  await win.happyDOM.close();
});
