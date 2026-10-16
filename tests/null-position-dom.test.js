import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as makeDoc, node, connect, guideDefaults } from '../src/core.js';
test('Null UI: point-only drag, snap, pan/zoom mapping, history, interruptions, typed wires, readonly and persistence', async () => {
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
    e: 80,
    f: 40,
    inverse() {
      return { a: 1 / this.a, b: 0, e: -this.e / this.a, f: -this.f / this.a };
    },
  };
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform(m) {
      return { x: this.x * m.a + m.e, y: this.y * m.a + m.f };
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
    a = node('Null'),
    c = node('Circle'),
    v = node('Vector'),
    out = node('Output');
  a.params.position.value = [300, 250];
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
  const marker = () => document.querySelector('[data-null-handle]');
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
  const xy = ([x, y]) => [x * matrix.a + matrix.e, y * matrix.a + matrix.f];
  const start = () => {
    const p = xy(pos());
    fire(marker(), 'pointerdown', ...p);
    return p;
  };
  const move = (p, dx, dy, extra = {}) =>
    fire(document, 'pointermove', p[0] + dx * matrix.a, p[1] + dy * matrix.a, extra);
  const up = () => fire(document, 'pointerup');
  const undo = () => {
    document.querySelector('[data-action="undo"]').click();
    flush();
  };
  const redo = () => {
    document.querySelector('[data-action="redo"]').click();
    flush();
  };
  assert.ok(marker());
  assert.equal(document.querySelector('.null-marker-size').getAttribute('transform'), 'scale(0.5)');
  assert.equal(
    document.querySelector(`[data-source="${a.id}"]`).getAttribute('aria-label'),
    'Null Position output',
  );
  assert.equal(document.querySelector(`[data-preview="${a.id}"]`), null);
  let before = saved();
  fire(stage(), 'pointerdown', ...xy([600, 400]));
  move(xy([600, 400]), 30, 20);
  up();
  assert.equal(saved(), before, 'empty canvas does not move Null');
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
  matrix.a = 0.5;
  matrix.e = -100;
  matrix.f = 90;
  win.dispatchEvent(new win.Event('resize'));
  p = start();
  move(p, 38, -20, { altKey: true });
  up();
  assert.deepEqual(pos(), [338, 230]);
  undo();
  const field = (id, key) =>
    document.querySelector(`.graph .field[data-node="${id}"][data-key="${key}"]`);
  fire(document.querySelector(`[data-source="${v.id}"]`), 'pointerdown');
  fire(field(a.id, 'position'), 'pointerup');
  assert.deepEqual(pos(), [400, 200]);
  assert.equal(marker().classList.contains('readonly'), true);
  before = saved();
  p = start();
  move(p, 30, 20);
  up();
  assert.equal(saved(), before);
  assert.equal(get(a.id).params.position.source, v.id);
  field(a.id, 'position')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  flush();
  assert.deepEqual(pos(), [300, 250]);
  undo();
  assert.deepEqual(pos(), [400, 200]);
  redo();
  for (const lock of ['parameter', 'expression', 'layer']) {
    load();
    if (lock === 'parameter') get(a.id).params.position.locked = true;
    else if (lock === 'expression') get(a.id).params.position.expression = '5; 9';
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
  assert.equal(copy.type, 'Null');
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
  assert.doesNotMatch(win.nect.export(), /null-marker|Position handle/);
  win.happyDOM.abort();
});
