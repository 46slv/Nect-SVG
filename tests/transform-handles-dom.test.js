import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as makeDoc, node, connect, guideDefaults } from '../src/core.js';
test('Transform handles: source stage, scale/rotation, precise history, read-only guards and interrupted gestures', async () => {
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
    t = node('Transform'),
    r = node('Rectangle'),
    out = node('Output');
  r.params.center.value = [300, 250];
  r.params.size.value = [160, 100];
  t.params.anchor.value = [250, 200];
  t.params.offset.value = [20, 30];
  l.nodes = [t, r, out];
  l.output = out.id;
  connect(l, r.id, t.id, 'path');
  connect(l, t.id, out.id, 'path');
  d.editor = { ...guideDefaults(), snap: false };
  const load = () => {
    win.nect.load(JSON.stringify(d));
    flush();
  };
  load();
  const get = () => win.nect.document.layers[0].nodes[0];
  const saved = () => JSON.stringify(win.nect.document);
  const stage = () => document.querySelector('.canvas-stage');
  const handle = (key) => document.querySelector(`[data-transform-handle="${key}"]`);
  const geometry = () => {
    const result = win.nect.evaluate(),
      state = result.transformState(t.id);
    return transformHandleGeometry(state, pathBounds(state.input), Math.hypot(matrix.a, matrix.b));
  };
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
  const start = (key) => {
    const p = geometry()[key];
    fire(handle(key), 'pointerdown', xy(p));
    return p;
  };
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
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
  const { transformHandleGeometry, pathBounds } = await import('../src/core.js');
  assert.ok(handle('scale'));
  assert.ok(handle('rotation'));
  assert.match(document.querySelector('.hint').textContent, /Selected Transform output/);
  assert.equal(
    document.querySelector('.transform-marker-size').getAttribute('transform'),
    'scale(0.5)',
  );
  const original = saved(),
    children = JSON.stringify(win.nect.document.layers[0].nodes.slice(1));
  let g = geometry(),
    p = start('scale');
  move(p.map((v, i) => v + g.axis[i] * g.radius));
  up();
  near(get().params.scale.value, 2);
  assert.deepEqual(get().params.anchor.value, [250, 200]);
  assert.deepEqual(get().params.offset.value, [20, 30]);
  assert.equal(JSON.stringify(win.nect.document.layers[0].nodes.slice(1)), children);
  undo();
  assert.equal(saved(), original);
  assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  redo();
  near(get().params.scale.value, 2);
  undo();
  const rotate = (g, p, degrees) => {
    const a = (degrees * Math.PI) / 180,
      x = p[0] - g.pivot[0],
      y = p[1] - g.pivot[1];
    return [
      g.pivot[0] + x * Math.cos(a) - y * Math.sin(a),
      g.pivot[1] + x * Math.sin(a) + y * Math.cos(a),
    ];
  };
  g = geometry();
  p = start('rotation');
  move(rotate(g, p, 31), { shiftKey: true });
  up();
  near(get().params.rotation.value, 30);
  undo();
  // Out-and-back and click jitter are exact no-ops, including precise existing values.
  d.layers[0].nodes[0].params.scale.value = 1.123456789012345;
  d.layers[0].nodes[0].params.rotation.value = 13.9876543210123;
  load();
  for (const key of ['scale', 'rotation']) {
    let before = saved();
    g = geometry();
    p = start(key);
    fire(document, 'pointermove', [xy(p)[0] + 1, xy(p)[1] + 1]);
    up();
    assert.equal(saved(), before);
    p = start(key);
    move(key === 'scale' ? p.map((v, i) => v + g.axis[i] * 40) : rotate(g, p, 65));
    move(p);
    up();
    assert.equal(saved(), before, key + ' out/back');
    assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
    for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
      before = saved();
      g = geometry();
      p = start(key);
      move(key === 'scale' ? p.map((v, i) => v + g.axis[i] * 40) : rotate(g, p, 45));
      assert.notEqual(saved(), before);
      if (end === 'Escape')
        stage().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
      else fire(end === 'lostpointercapture' ? stage() : document, end);
      flush();
      up();
      assert.equal(saved(), before, end);
    }
  }
  // Pointer identity and navigation priority.
  let before = saved();
  g = geometry();
  p = start('scale');
  move(
    p.map((v, i) => v + g.axis[i] * 40),
    { pointerId: 8 },
  );
  fire(document, 'pointerup', [0, 0], { pointerId: 8 });
  assert.equal(saved(), before);
  move(p.map((v, i) => v + g.axis[i] * 40));
  up();
  assert.notEqual(saved(), before);
  undo();
  for (const kind of ['middle', 'space']) {
    before = saved();
    p = geometry().scale;
    if (kind === 'space')
      stage().dispatchEvent(
        new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );
    fire(handle('scale'), 'pointerdown', xy(p), { button: kind === 'middle' ? 1 : 0 });
    move(p.map((v) => v + 20));
    up();
    document.dispatchEvent(
      new win.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
    );
    assert.equal(saved(), before);
  }
  // Pending previews cannot interleave delete/history/tool/file shortcuts.
  before = saved();
  g = geometry();
  p = start('scale');
  move(p.map((v, i) => v + g.axis[i] * 40));
  const preview = saved();
  for (const [key, ctrlKey] of [
    ['Delete', false],
    ['z', true],
    ['s', true],
    ['o', true],
    ['c', false],
    ['p', false],
    ['t', false],
  ]) {
    const event = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey,
      bubbles: true,
      cancelable: true,
    });
    stage().dispatchEvent(event);
    flush();
    assert.equal(event.defaultPrevented, true);
    assert.equal(saved(), preview, key);
  }
  up();
  undo();
  assert.equal(saved(), before);
  // General affine CTM inverse, negative and zero-scale recovery.
  matrix.a = 0.4;
  matrix.b = 0.3;
  matrix.c = -0.3;
  matrix.d = 0.4;
  matrix.e = -70;
  matrix.f = 120;
  for (const scale of [-2, 0, 1e-12, -1e-12]) {
    d.layers[0].nodes[0].params.scale.value = scale;
    load();
    before = saved();
    g = geometry();
    p = start('scale');
    move(p.map((v, i) => v + g.axis[i] * g.radius));
    up();
    near(get().params.scale.value, scale + g.sign);
    undo();
    assert.equal(saved(), before);
  }
  // Each driven/locked scalar is individually read-only; its sibling remains editable.
  for (const key of ['scale', 'rotation'])
    for (const kind of ['expression', 'locked', 'source', 'layer']) {
      const copy = structuredClone(d);
      const q = d.layers[0].nodes[0].params[key];
      if (kind === 'layer') d.layers[0].locked = true;
      else if (kind === 'source') {
        const value = node('Value');
        value.params.value.value = 2;
        d.layers[0].nodes.push(value);
        connect(d.layers[0], value.id, t.id, key);
      } else q[kind] = kind === 'expression' ? '2' : true;
      load();
      before = saved();
      assert.ok(handle(key).classList.contains('readonly'));
      g = geometry();
      p = start(key);
      move(key === 'scale' ? p.map((v, i) => v + g.axis[i] * 40) : rotate(g, p, 45));
      up();
      assert.equal(saved(), before);
      Object.assign(d, copy);
    }
  // The selected stage stays independent of downstream transforms.
  d.layers[0].nodes[0].params.scale.value = 1;
  load();
  const parent = node('Transform');
  parent.params.offset.value = [300, 100];
  d.layers[0].nodes.push(parent);
  connect(d.layers[0], t.id, parent.id, 'path');
  connect(d.layers[0], parent.id, out.id, 'path');
  load();
  near(geometry().pivot[0], 270);
  assert.notDeepEqual(win.nect.evaluate().path, win.nect.evaluate().run(t.id));
  assert.match(
    document.querySelector('[data-transform-stage]').getAttribute('aria-label'),
    /before downstream/,
  );
  const exported = win.nect.export();
  assert.doesNotMatch(exported, /transform-overlay|Selected Transform/);
  const roundtrip = saved();
  win.nect.load(roundtrip);
  flush();
  assert.equal(saved(), roundtrip);
  assert.equal(win.nect.export(), exported);
  // View changes update screen-size markers immediately, before the queued frame flush.
  const markerDocument = saved(),
    inspectorInput = document.querySelector('.inspector-body input');
  const oldMatrix = { ...matrix };
  matrix.a = 2.4;
  matrix.d = 2.4;
  matrix.b = 0;
  matrix.c = 0;
  document.querySelector('[data-action="zoom-in"]').click();
  assert.equal(
    document.querySelector('.transform-marker-size').getAttribute('transform'),
    `scale(${1 / 2.4})`,
  );
  assert.equal(document.querySelector('.inspector-body input'), inspectorInput);
  assert.equal(saved(), markerDocument);
  Object.assign(matrix, oldMatrix);
  document.querySelector('[data-action="zoom-out"]').click();
  // Multi-selection hides transform controls, hidden layers also hide them.
  fire(
    document.querySelector(`.node[data-id="${r.id}"] .node-head strong`),
    'pointerdown',
    [0, 0],
    { shiftKey: true },
  );
  up();
  assert.equal(handle('scale'), null);
  d.layers[0].visible = false;
  load();
  assert.equal(handle('rotation'), null);
  win.happyDOM.abort();
});
