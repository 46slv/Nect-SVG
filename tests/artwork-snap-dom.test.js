import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { node, pathBounds } from '../src/core.js';
test('Artwork snap UI: target invalidation, controller/shape/text integration, history and gesture cache', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  let pending = [];
  for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = win[key];
  globalThis.requestAnimationFrame = (fn) => {
    pending.push(fn);
    return pending.length;
  };
  const flush = () => {
    const jobs = pending;
    pending = [];
    jobs.forEach((fn) => fn(0));
  };
  const matrix = {
    a: 2,
    b: 0,
    c: 0,
    d: 2,
    e: 80,
    f: 40,
    inverse() {
      const { a, b, c, d, e, f } = this,
        det = a * d - b * c;
      return {
        a: d / det,
        b: -b / det,
        c: -c / det,
        d: a / det,
        e: (c * f - d * e) / det,
        f: (b * e - a * f) / det,
      };
    },
  };
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform(m) {
      return { x: this.x * m.a + this.y * m.c + m.e, y: this.x * m.b + this.y * m.d + m.f };
    }
  };
  win.SVGElement.prototype.getScreenCTM = () => matrix;
  win.SVGSVGElement.prototype.getScreenCTM = () => matrix;
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
    .replace('  evaluate,', '  evaluate as actualEvaluate,')
    .replace(
      '  collectSnapLayerBounds,',
      '  collectSnapLayerBounds as actualCollectSnapLayerBounds,',
    )
    .replace(
      'const app =',
      `const evaluate = (...args) => { window.snapEvaluationCalls = (window.snapEvaluationCalls || 0) + 1; return actualEvaluate(...args); };
const collectSnapLayerBounds = (...args) => { window.snapBoundsCollections = (window.snapBoundsCollections || 0) + 1; return actualCollectSnapLayerBounds(...args); };
const app =`,
    )
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 80));
  flush();
  const sample = JSON.parse(
    await fs.readFile(new URL('../examples/artwork-bounds-snapping.json', import.meta.url), 'utf8'),
  );
  let d = structuredClone(sample);
  const load = () => {
    win.nect.load(JSON.stringify(d));
    flush();
  };
  const saved = () => JSON.stringify(win.nect.document);
  const get = () => win.nect.document.layers[0].nodes[0];
  const pos = () => get().params.position.value;
  const stage = () => document.querySelector('.canvas-stage');
  const marker = () => document.querySelector('[data-position-handle]');
  const fire = (el, type, p = [0, 0], extra = {}) => {
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        button: 0,
        clientX: p[0],
        clientY: p[1],
        ...extra,
      }),
    );
    flush();
  };
  const xy = ([x, y]) => [x * matrix.a + matrix.e, y * matrix.d + matrix.f];
  const start = () => fire(marker(), 'pointerdown', xy(pos()));
  const move = (p, extra = {}) => fire(document, 'pointermove', xy(p), extra);
  const up = () => fire(document, 'pointerup');
  const undo = () => {
    document.querySelector('[data-action="undo"]').click();
    flush();
  };
  const redo = () => {
    document.querySelector('[data-action="redo"]').click();
    flush();
  };
  const toggle = async (key, on) => {
    if (!document.querySelector('[data-guide-setting]'))
      document.querySelector('[data-action="guides-panel"]').click();
    const el = document.querySelector(`[data-guide-setting="${key}"]`);
    el.checked = on;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    flush();
  };
  load();
  let before = saved(),
    art = win.nect.export();
  start();
  const collections = win.snapBoundsCollections;
  win.snapEvaluationCalls = 0;
  move([398, 158]);
  assert.deepEqual(pos(), [400, 160]);
  assert.ok(document.querySelector('[data-snap-kind="artwork"]'));
  assert.equal(win.snapBoundsCollections, collections, 'no target bounds recollection during drag');
  assert.equal(
    win.snapEvaluationCalls,
    d.layers.length,
    'only existing canvas render evaluates, snapping adds none',
  );
  move([488, 248]);
  assert.deepEqual(pos(), [490, 250]);
  move([578, 338]);
  assert.deepEqual(pos(), [580, 340]);
  assert.equal(win.snapBoundsCollections, collections);
  up();
  const after = saved();
  undo();
  assert.equal(saved(), before);
  assert.equal(win.nect.export(), art);
  assert.equal(
    document.querySelector('[data-action="undo"]').disabled,
    true,
    'one gesture is one Undo',
  );
  redo();
  assert.equal(saved(), after);
  undo();
  start();
  move([398, 158], { altKey: true });
  up();
  assert.deepEqual(pos(), [398, 158]);
  undo();
  for (const scale of [0.5, 2]) {
    matrix.a = matrix.d = scale;
    matrix.e = -80;
    matrix.f = 90;
    load();
    start();
    move([400 - 5.9 / scale, 180]);
    up();
    assert.equal(pos()[0], 400);
    undo();
    start();
    move([400 - 6.1 / scale, 180]);
    up();
    assert.ok(Math.abs(pos()[0] - (400 - 6.1 / scale)) < 1e-9);
    undo();
  }
  matrix.a = matrix.d = 2;
  for (const key of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    load();
    before = saved();
    start();
    move([398, 158]);
    if (key === 'Escape')
      stage().dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }));
    else if (key === 'blur') win.dispatchEvent(new win.Event('blur'));
    else fire(key === 'lostpointercapture' ? stage() : document, key);
    flush();
    up();
    assert.equal(saved(), before, key);
    assert.equal(document.querySelector('[data-snap-kind]'), null);
  }
  load();
  before = saved();
  fire(marker(), 'pointerdown', xy(pos()), { button: 1 });
  move([398, 158], { button: 1 });
  up();
  assert.equal(saved(), before, 'pan owns marker gestures');
  // Changing a target's visibility refreshes the cached target snapshot immediately.
  document.querySelector('[data-visible="layer-snap-reference"]').click();
  flush();
  start();
  move([398, 158]);
  up();
  assert.equal(pos()[0], 398);
  undo();
  document.querySelector('[data-visible="layer-snap-reference"]').click();
  flush();
  start();
  move([398, 158]);
  up();
  assert.deepEqual(pos(), [400, 160]);
  undo();
  await toggle('snapArtwork', false);
  start();
  move([398, 158]);
  up();
  assert.deepEqual(pos(), [398, 158]);
  undo();
  await toggle('snapArtwork', true);
  await toggle('visible', false);
  start();
  move([398, 158]);
  up();
  assert.deepEqual(pos(), [400, 160], 'hide guides does not hide artwork targets');
  undo();
  before = saved();
  win.nect.load(before);
  flush();
  assert.equal(win.nect.document.editor.snapArtwork, true);
  // Numeric entry stays literal even when close to an enabled target.
  const input = document.querySelector('.inspector-body [data-key="position"] [data-axis="0"]');
  input.value = '399';
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  flush();
  assert.equal(pos()[0], 399);
  // A final output invalidated by an expression is omitted, not snapped to an old result.
  d = structuredClone(sample);
  d.layers[1].nodes[0].params.size.expression = '1/0; 180';
  load();
  start();
  move([398, 158]);
  up();
  assert.equal(pos()[0], 398);
  // All output in the active layer is excluded, including the controller's follower.
  d = structuredClone(sample);
  d.layers = d.layers.slice(0, 1);
  load();
  start();
  move([162, 222]);
  up();
  assert.deepEqual(pos(), [162, 222]);
  // Vector shares the point-snap path without adding geometry or changing its output type.
  d = structuredClone(sample);
  const v = node('Vector');
  v.id = 'snap-origin';
  v.canvasPositionHandle = true;
  v.params.value.value = [160, 220];
  d.layers[0].nodes[0] = v;
  load();
  fire(marker(), 'pointerdown', xy([160, 220]));
  move([398, 158]);
  up();
  assert.deepEqual(get().params.value.value, [400, 160]);
  // Ordinary shapes snap their evaluated edge, preserving their size.
  d = structuredClone(sample);
  const c = d.layers[0].nodes[1];
  delete c.params.center.source;
  c.params.center.value = [160, 220];
  d.layers[0].nodes.shift();
  load();
  fire(document.querySelector('.shape[data-layer]'), 'pointerdown', xy([160, 220]));
  move([368, 218]);
  up();
  assert.deepEqual(get().params.center.value, [370, 220]);
  assert.equal(get().params.radius.value, 30);
  // Text uses its outline edge as the source, and Image uses its rectangular edge.
  d = structuredClone(sample);
  const text = node('Text');
  text.id = 'snap-circle';
  text.text = 'XY';
  text.params.position.value = [160, 220];
  text.params.size.value = 40;
  d.layers[0].nodes.splice(0, 2, text);
  load();
  const textRight = pathBounds(win.nect.evaluate().run(text.id))[0][2];
  fire(document.querySelector('.shape[data-layer]'), 'pointerdown', xy([160, 220]));
  move([160 + 400 - textRight - 2, 220]);
  up();
  assert.ok(Math.abs(get().params.position.value[0] - (160 + 400 - textRight)) < 1e-9);
  d = structuredClone(sample);
  const image = node('Image'),
    imageOut = node('Image Output');
  image.asset = 'image-snap-asset';
  image.params.position.value = [160, 220];
  image.params.size.value = [80, 60];
  imageOut.params.path.source = image.id;
  d.layers[0].nodes = [image, imageOut];
  d.layers[0].output = imageOut.id;
  load();
  fire(document.querySelector('.shape[data-layer]'), 'pointerdown', xy([180, 240]));
  move([338, 240]);
  up();
  assert.equal(get().params.position.value[0], 320);
  assert.deepEqual(get().params.size.value, [80, 60]);
  assert.ok(!win.nect.export().includes('snap-match'));
  win.happyDOM.abort();
});
