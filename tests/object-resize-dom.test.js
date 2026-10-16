import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as makeDoc, node, connect, guideDefaults } from '../src/core.js';
test('Object resize: direct dimensions, font size, resolved positions, history, cancellation and guards', async () => {
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
  // Text handles need the actual font, not a fixed I/O timing assumption.
  source +=
    '\nconst resizeFontDeadline = Date.now() + 5000; while (!bundledFont) { if (Date.now() >= resizeFontDeadline) throw Error("Bundled resize test font did not finish loading"); await new Promise((r) => setTimeout(r, 10)); }';
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  flush();

  const d = makeDoc(),
    l = d.layers[0],
    r = node('Rectangle'),
    out = node('Output');
  r.params.center.value = [300, 250];
  r.params.size.value = [160, 100];
  l.nodes = [r, out];
  l.output = out.id;
  connect(l, r.id, out.id, 'path');
  const load = () => {
    win.nect.load(JSON.stringify(d));
    flush();
  };
  const saved = () => JSON.stringify(win.nect.document);
  const get = () => win.nect.document.layers[0].nodes[0];
  const handle = (i = 0) => document.querySelector(`[data-object-resize="${i}"]`);
  const xy = ([x, y]) => [
    x * matrix.a + y * matrix.c + matrix.e,
    x * matrix.b + y * matrix.d + matrix.f,
  ];
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
  const start = (i = 0) => {
    const h = handle(i);
    const p = h
      .getAttribute('transform')
      .match(/translate\(([^)]+)\)/)[1]
      .split(' ')
      .map(Number);
    fire(h, 'pointerdown', xy(p));
    return p;
  };
  const move = (p) => fire(document, 'pointermove', xy(p));
  const up = () => fire(document, 'pointerup');
  const undo = () => {
    document.querySelector('[data-action="undo"]').click();
    flush();
  };
  load();
  const original = saved();
  let p = start();
  move([p[0] + 40, p[1] + 20]);
  up();
  assert.deepEqual(get().params.size.value, [240, 100]);
  assert.deepEqual(get().params.center.value, [300, 250]);
  undo();
  assert.equal(saved(), original);
  assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  p = start(1);
  move([p[0] + 40, p[1] + 30]);
  up();
  assert.deepEqual(get().params.size.value, [160, 160]);
  undo();
  for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    p = start();
    move([p[0] + 40, p[1]]);
    if (end === 'Escape')
      document
        .querySelector('.canvas-stage')
        .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
    else
      fire(end === 'lostpointercapture' ? document.querySelector('.canvas-stage') : document, end);
    flush();
    up();
    assert.equal(saved(), original, end);
  }
  p = start();
  move([p[0] + 40, p[1]]);
  move(p);
  up();
  assert.equal(saved(), original);
  p = start();
  fire(document, 'pointermove', [xy(p)[0] + 1, xy(p)[1] + 1]);
  up();
  assert.equal(saved(), original);
  // General affine screen CTM and pointer ownership.
  matrix.a = 0.4;
  matrix.b = 0.3;
  matrix.c = -0.3;
  matrix.d = 0.4;
  p = start();
  fire(document, 'pointermove', xy([p[0] + 40, p[1]]), { pointerId: 8 });
  assert.equal(saved(), original);
  move([p[0] + 40, p[1]]);
  up();
  assert.ok(Math.abs(get().params.size.value[0] - 240) < 1e-8);
  undo();
  for (const kind of ['locked', 'expression', 'source', 'layer']) {
    const backup = structuredClone(d);
    if (kind === 'layer') l.locked = true;
    else if (kind === 'source') {
      const v = node('Vector');
      v.params.value.value = [160, 100];
      l.nodes.push(v);
      connect(l, v.id, r.id, 'size');
    } else r.params.size[kind] = kind === 'locked' ? true : '160;100';
    load();
    const before = saved();
    assert.ok(handle().classList.contains('readonly'));
    p = start();
    move([p[0] + 40, p[1]]);
    up();
    assert.equal(saved(), before);
    Object.assign(d, backup);
    Object.assign(l, d.layers[0]);
    d.layers[0] = l;
    Object.assign(r, l.nodes[0]);
    l.nodes[0] = r;
  }
  // Each supported generator writes only its own dimension parameter.
  for (const type of ['Ellipse', 'Circle', 'Polygon', 'Star', 'Text']) {
    const n = node(type);
    if (type === 'Text') {
      n.text = 'Hello';
    }
    l.nodes = [n, out];
    connect(l, n.id, out.id, 'path');
    load();
    assert.ok(handle(), type);
    const before = saved(),
      key = ['Circle', 'Polygon'].includes(type)
        ? 'radius'
        : type === 'Star'
          ? 'outerRadius'
          : 'size';
    p = start();
    move([p[0] + 20, p[1]]);
    up();
    assert.notDeepEqual(get().params[key].value, n.params[key].value, type);
    const expected = JSON.parse(before);
    expected.layers[0].nodes[0].params[key].value = get().params[key].value;
    assert.deepEqual(win.nect.document, expected);
    undo();
    assert.equal(saved(), before);
    assert.doesNotMatch(win.nect.export(), /object-resize|Font size/);
  }
  // Bound anchors, driven positions, keyboard isolation and selection gating.
  l.nodes = [r, out];
  connect(l, r.id, out.id, 'path');
  r.positionReference = 'right-bottom';
  r.params.center.expression = '400;300';
  load();
  assert.match(handle().getAttribute('transform'), /240 300/);
  let before = saved();
  p = start();
  move([p[0] - 20, p[1]]);
  up();
  assert.ok(Math.abs(get().params.size.value[0] - 180) < 1e-8);
  assert.equal(get().positionReference, 'right-bottom');
  assert.equal(get().params.center.expression, '400;300');
  undo();
  assert.equal(saved(), before);
  p = start();
  move([p[0] - 20, p[1]]);
  const preview = saved();
  for (const key of ['Delete', 'z', 's', 'c']) {
    const e = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey: key === 'z' || key === 's',
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('.canvas-stage').dispatchEvent(e);
    flush();
    assert.equal(saved(), preview);
    assert.equal(e.defaultPrevented, true);
  }
  up();
  undo();
  assert.equal(saved(), before);
  for (const kind of ['middle', 'space']) {
    if (kind === 'space')
      document
        .querySelector('.canvas-stage')
        .dispatchEvent(
          new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
        );
    const h = handle(),
      point = h
        .getAttribute('transform')
        .match(/translate\(([^)]+)\)/)[1]
        .split(' ')
        .map(Number);
    fire(h, 'pointerdown', xy(point), { button: kind === 'middle' ? 1 : 0 });
    move([point[0] + 30, point[1] + 20]);
    up();
    document.dispatchEvent(
      new win.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
    );
    assert.equal(saved(), before);
  }
  fire(
    document.querySelector(`.node[data-id="${out.id}"] .node-head strong`),
    'pointerdown',
    [0, 0],
    { shiftKey: true },
  );
  up();
  assert.equal(handle(), null);
  l.visible = false;
  load();
  assert.equal(handle(), null);
  win.happyDOM.abort();
});
