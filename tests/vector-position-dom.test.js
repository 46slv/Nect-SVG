import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as makeDoc, node, connect, guideDefaults } from '../src/core.js';
test('Vector UI: opt-in position handle, exact source values, shared snap/drag/history, locks, selection and persistence', async () => {
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
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 80));
  flush();
  const d = makeDoc(),
    l = d.layers[0],
    a = node('Vector'),
    c = node('Circle'),
    v = node('Vector'),
    out = node('Output');
  a.params.value.value = [300, 250];
  c.params.center.value = [100, 100];
  v.params.value.value = [400, 200];
  l.nodes = [a, c, v, out];
  l.output = out.id;
  connect(l, c.id, out.id, 'path');
  connect(l, a.id, c.id, 'center');
  d.editor = {
    ...guideDefaults(),
    snap: true,
    snapGrid: false,
    snapArtboard: false,
    guides: [{ id: 'null-x', axis: 'x', position: 320, locked: false }],
  };
  const load = () => {
    win.nect.load(JSON.stringify(d));
    flush();
  };
  load();
  const get = (id) => win.nect.document.layers[0].nodes.find((n) => n.id === id),
    pos = () => win.nect.evaluate().run(a.id),
    saved = () => JSON.stringify(win.nect.document);
  const marker = () => document.querySelector('[data-vector-handle]');
  const stage = () => document.querySelector('.canvas-stage');
  const fire = (el, type, x = 0, y = 0, extra = {}) => {
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        button: 0,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
    flush();
  };
  const xy = ([x, y]) => [
    x * matrix.a + y * matrix.c + matrix.e,
    x * matrix.b + y * matrix.d + matrix.f,
  ];
  const start = () => {
    const p = xy(pos());
    fire(marker(), 'pointerdown', ...p);
    return p;
  };
  const move = (p, dx, dy, extra = {}) =>
    fire(
      document,
      'pointermove',
      p[0] + dx * matrix.a + dy * matrix.c,
      p[1] + dx * matrix.b + dy * matrix.d,
      extra,
    );
  const up = () => fire(document, 'pointerup');
  const undo = () => {
    document.querySelector('[data-action="undo"]').click();
    flush();
  };
  const redo = () => {
    document.querySelector('[data-action="redo"]').click();
    flush();
  };
  const toggle = () => document.querySelector('.inspector-body [data-vector-position-handle]');
  const setMode = async (enabled) => {
    toggle().checked = enabled;
    toggle().dispatchEvent(new win.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    flush();
  };
  assert.equal(marker(), null, 'ordinary Vector remains an ordinary value');
  const original = saved(),
    originalSVG = win.nect.export();
  await setMode(true);
  assert.equal(get(a.id).canvasPositionHandle, true);
  assert.ok(marker());
  assert.equal(win.nect.export(), originalSVG, 'display mode adds no artwork');
  undo();
  assert.equal(saved(), original);
  assert.equal(marker(), null);
  redo();
  assert.ok(marker());
  await setMode(false);
  assert.equal(marker(), null);
  undo();
  assert.ok(marker());
  d.layers[0].nodes[0].canvasPositionHandle = true;
  load();
  assert.equal(
    document.querySelector('.vector-marker-size').getAttribute('transform'),
    'scale(0.5)',
  );
  assert.equal(
    document.querySelector(`[data-source="${a.id}"]`).getAttribute('aria-label'),
    'Vector output',
  );
  assert.equal(document.querySelector(`[data-preview="${a.id}"]`), null);
  let before = saved();
  fire(stage(), 'pointerdown', ...xy([600, 400]));
  move(xy([600, 400]), 30, 20);
  up();
  assert.equal(saved(), before, 'empty canvas does not move Vector');
  // Empty canvas clears selection; explicitly re-enter the controller node.
  fire(document.querySelector(`.node[data-id="${a.id}"] .node-head`), 'pointerdown');
  up();
  let p = start();
  fire(document, 'pointermove', p[0] + 1, p[1] + 1);
  up();
  assert.equal(saved(), before, 'click jitter is not a drag');
  p = start();
  move(p, 19, 11);
  assert.deepEqual(pos(), [320, 261]);
  assert.equal(document.querySelector('[data-snap-kind="guide"]') !== null, true);
  up();
  assert.deepEqual(pos(), [320, 261]);
  assert.deepEqual(win.nect.evaluate().run(c.id).contours[0].points.length > 0, true);
  undo();
  assert.equal(saved(), before, 'entire drag is exactly one undo');
  redo();
  assert.deepEqual(pos(), [320, 261]);
  undo();
  p = start();
  move(p, 19, 11, { altKey: true });
  up();
  assert.deepEqual(pos(), [319, 261]);
  undo();
  // Every interruption rolls back preview and leaves history untouched.
  for (const interrupt of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    before = saved();
    p = start();
    move(p, 50, 25, { altKey: true });
    assert.notEqual(saved(), before);
    if (interrupt === 'Escape')
      stage().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (interrupt === 'blur') win.dispatchEvent(new win.Event('blur'));
    else fire(interrupt === 'lostpointercapture' ? stage() : document, interrupt);
    flush();
    up();
    assert.equal(saved(), before, interrupt);
  }
  // Different pointer cannot mutate or end the active gesture.
  p = start();
  move(p, 20, 10, { pointerId: 8 });
  fire(document, 'pointerup', 0, 0, { pointerId: 8 });
  assert.deepEqual(pos(), [300, 250]);
  move(p, 30, 20, { altKey: true });
  up();
  assert.deepEqual(pos(), [330, 270]);
  undo();
  // Navigation takes precedence even directly over the point.
  before = saved();
  p = xy(pos());
  fire(marker(), 'pointerdown', ...p, { button: 1 });
  move(p, 30, 20, { button: 1 });
  up();
  assert.equal(saved(), before);
  // Zoom/pan inverse mapping uses CTM, not graph/canvas offsets.
  matrix.a = matrix.d = 0.5;
  matrix.e = -100;
  matrix.f = 90;
  win.dispatchEvent(new win.Event('resize'));
  p = start();
  move(p, 38, -20, { altKey: true });
  up();
  assert.deepEqual(pos(), [338, 230]);
  undo();
  // Exactly six screen pixels, independent of canvas scale.
  for (const scale of [0.5, 2]) {
    matrix.a = matrix.d = scale;
    load();
    p = start();
    move(p, 20 - 5.9 / scale, 20, {});
    up();
    assert.equal(pos()[0], 320);
    undo();
    p = start();
    move(p, 20 - 6.1 / scale, 20, {});
    up();
    assert.ok(Math.abs(pos()[0] - (320 - 6.1 / scale)) < 1e-10);
    undo();
  }
  // Full inverse affine mapping, with a fractional source and out-and-back no-op.
  Object.assign(matrix, { a: 0.6, b: 0.8, c: -0.8, d: 0.6, e: -103.125, f: 91.75 });
  get(a.id).params.value.value = [300.123456789, 250.987654321];
  win.nect.load(saved());
  flush();
  before = saved();
  p = start();
  move(p, 33.25, -19.75, { altKey: true });
  up();
  assert.ok(Math.abs(pos()[0] - 333.373456789) < 1e-10);
  assert.ok(Math.abs(pos()[1] - 231.237654321) < 1e-10);
  undo();
  assert.equal(saved(), before);
  p = start();
  move(p, 33.25, -19.75, { altKey: true });
  fire(document, 'pointermove', ...p, { altKey: true });
  up();
  assert.equal(saved(), before, 'return to start preserves every source digit');
  assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  Object.assign(matrix, { a: 2, b: 0, c: 0, d: 2, e: 80, f: 40 });
  load();
  // A numeric commit updates the same value and immediately moves the marker.
  const numeric = document.querySelector(
    '.inspector-body .field[data-key="value"] [data-axis="0"]',
  );
  numeric.value = '310.123456789';
  numeric.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  flush();
  assert.deepEqual(pos(), [310.123456789, 250]);
  assert.match(marker().getAttribute('transform'), /310.123456789/);
  undo();
  const field = (id, key) =>
    document.querySelector(`.graph .field[data-node="${id}"][data-key="${key}"]`);
  fire(document.querySelector(`[data-source="${v.id}"]`), 'pointerdown');
  fire(field(a.id, 'value'), 'pointerup');
  assert.deepEqual(pos(), [400, 200]);
  assert.equal(marker().classList.contains('readonly'), true);
  before = saved();
  p = start();
  move(p, 30, 20);
  up();
  assert.equal(saved(), before);
  assert.equal(get(a.id).params.value.source, v.id);
  field(a.id, 'value')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  flush();
  assert.deepEqual(pos(), [300, 250]);
  undo();
  assert.deepEqual(pos(), [400, 200]);
  redo();
  for (const lock of ['parameter', 'expression', 'layer']) {
    load();
    if (lock === 'parameter') get(a.id).params.value.locked = true;
    else if (lock === 'expression') get(a.id).params.value.expression = '5; 9';
    else win.nect.document.layers[0].locked = true;
    win.nect.load(saved());
    flush();
    before = saved();
    p = start();
    move(p, 60, 40);
    up();
    assert.equal(saved(), before, lock);
  }
  load();
  document.querySelector(`[data-duplicate="${a.id}"]`).click();
  flush();
  const copy = win.nect.document.layers[0].nodes.at(-1);
  assert.equal(copy.type, 'Vector');
  assert.equal(copy.canvasPositionHandle, true);
  assert.equal(marker().dataset.vectorHandle, copy.id);
  assert.equal(document.querySelectorAll('[data-position-handle]').length, 1);
  assert.equal(get(c.id).params.center.source, a.id);
  const roundtrip = saved();
  win.nect.load(roundtrip);
  flush();
  assert.equal(saved(), roundtrip);
  document.querySelector(`[data-delete="${a.id}"]`).click();
  flush();
  assert.equal(get(c.id).params.center.source, undefined);
  undo();
  assert.equal(get(c.id).params.center.source, a.id);
  load();
  win.nect.document.layers[0].visible = false;
  win.nect.load(saved());
  flush();
  assert.equal(marker(), null);
  load();
  const nullNode = node('Null');
  win.nect.document.layers[0].nodes.unshift(nullNode);
  win.nect.load(saved());
  flush();
  assert.equal(marker(), null, 'only selected controller appears');
  assert.equal(document.querySelectorAll('[data-null-handle]').length, 1);
  assert.doesNotMatch(win.nect.export(), /vector-marker|Value as canvas position handle|Vector XY/);
  win.happyDOM.abort();
});
