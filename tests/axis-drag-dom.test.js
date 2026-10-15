import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  connect,
  guideDefaults,
  point,
  transformCharacterPoint,
} from '../src/core.js';
test('Shift artwork movement: shared axes, snap, modifiers, source coordinates, selection and cancellation', async () => {
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

  const saved = () => JSON.stringify(win.nect.document);
  const get = (id) => win.nect.document.layers[0].nodes.find((n) => n.id === id);
  const stage = () => document.querySelector('.canvas-stage');
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
  const down = (
    p,
    extra = {},
    target = document.querySelector('[data-node-stage-move]') || stage(),
  ) => fire(target, 'pointerdown', xy(p), extra);
  const move = (p, extra = {}) => fire(document, 'pointermove', xy(p), extra);
  const up = () => fire(document, 'pointerup');
  const key = (name, type = 'keydown', extra = {}) => {
    stage().dispatchEvent(new win.KeyboardEvent(type, { key: name, bubbles: true, ...extra }));
    flush();
  };
  const undo = () => {
    document.querySelector('[data-action="undo"]').click();
    flush();
  };
  const redo = () => {
    document.querySelector('[data-action="redo"]').click();
    flush();
  };
  const load = (d) => {
    win.nect.load(JSON.stringify(d));
    flush();
  };
  const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
  const project = (type) => {
    const d = makeDoc(),
      l = d.layers[0],
      n = node(type),
      out = node('Output');
    l.nodes = [n, out];
    l.output = out.id;
    let position = 'center';
    if (['Text', 'Null'].includes(type)) position = 'position';
    if (type === 'Vector') {
      position = 'value';
      n.canvasPositionHandle = true;
    }
    if (type === 'Transform') position = 'offset';
    if (n.params[position]) n.params[position].value = [250, 200];
    if (type === 'Text') {
      n.text = 'ABC';
      n.params.size.value = 50;
    }
    if (['Null', 'Vector'].includes(type)) {
      const c = node('Circle');
      l.nodes.push(c);
      connect(l, n.id, c.id, 'center');
      connect(l, c.id, out.id, 'path');
    } else if (type === 'Transform') {
      const c = node('Circle');
      l.nodes.push(c);
      connect(l, c.id, n.id, 'path');
      connect(l, n.id, out.id, 'path');
    } else connect(l, n.id, out.id, 'path');
    d.editor = {
      ...guideDefaults(),
      snap: true,
      snapGrid: false,
      snapArtboard: false,
      guides: [
        { id: 'x', axis: 'x', position: 280, locked: false },
        { id: 'y', axis: 'y', position: 202, locked: false },
      ],
    };
    return { d, l, n, out, position };
  };
  for (const type of ['Null', 'Vector', 'Text', 'Rectangle', 'Transform']) {
    const { d, n, position } = project(type);
    load(d);
    const original = saved(),
      target = () =>
        document.querySelector('[data-position-handle]') ||
        document.querySelector('[data-node-stage-move]');
    down([250, 200], { shiftKey: true }, target());
    move([279, 204], { shiftKey: true });
    const constrained = get(n.id).params[position].value;
    assert.equal(constrained[1], 200, type);
    assert.ok(Math.abs(constrained[0] - 279) <= 3, type);
    if (['Null', 'Vector'].includes(type)) assert.equal(constrained[0], 280, 'allowed axis snaps');
    assert.equal(document.querySelectorAll('.snap-match[y1="202"]').length, 0);
    move([255, 260], { shiftKey: true, altKey: true });
    near(get(n.id).params[position].value, [255, 200]);
    key('Shift', 'keyup');
    near(get(n.id).params[position].value, [255, 260]);
    key('Shift');
    near(get(n.id).params[position].value, [250, 260]);
    move([290, 210], { shiftKey: true, altKey: true });
    near(get(n.id).params[position].value, [250, 210]);
    up();
    const complete = saved();
    undo();
    assert.equal(saved(), original, type);
    assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
    redo();
    assert.equal(saved(), complete);
    undo();
    // Shift jitter, exact return, wrong pointer and all cancellation paths.
    down([250, 200], { shiftKey: true }, target());
    move([250.5, 200.5], { shiftKey: true });
    up();
    assert.equal(saved(), original);
    down([250, 200], { shiftKey: true }, target());
    move([270, 205], { shiftKey: true, altKey: true });
    move([250, 200], { shiftKey: true, altKey: true });
    up();
    assert.equal(saved(), original);
    for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
      down([250, 200], { shiftKey: true }, target());
      move([275, 208], { shiftKey: true, altKey: true });
      const preview = saved();
      fire(document, 'pointermove', xy([999, 999]), { pointerId: 4, shiftKey: true });
      assert.equal(saved(), preview);
      if (end === 'Escape') key('Escape');
      else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
      else fire(end === 'lostpointercapture' ? stage() : document, end);
      up();
      assert.equal(saved(), original, `${type}/${end}`);
    }
    for (const guard of ['locked', 'expression', 'source']) {
      const guardedDoc = structuredClone(d),
        q = guardedDoc.layers[0].nodes[0].params[position];
      if (guard === 'source') {
        const supplier = node('Vector');
        supplier.params.value.value = [250, 200];
        guardedDoc.layers[0].nodes.push(supplier);
        q.source = supplier.id;
      } else q[guard] = guard === 'locked' ? true : '250; 200';
      load(guardedDoc);
      const guarded = saved();
      down([250, 200], { shiftKey: true }, target());
      move([280, 210], { shiftKey: true });
      up();
      assert.equal(saved(), guarded, `${type}/${guard}`);
    }
  }
  // Modifier replay uses the current Alt key, even without another pointer event.
  {
    const { d, n } = project('Null');
    load(d);
    down([250, 200], {}, document.querySelector('[data-position-handle]'));
    move([279, 210]);
    key('Alt', 'keydown', { altKey: true });
    key('Shift', 'keydown', { altKey: true });
    near(get(n.id).params.position.value, [279, 200]);
    key('Escape');
    up();
    down([250, 200], { shiftKey: true }, document.querySelector('[data-position-handle]'));
    move([279, 210], { shiftKey: true, altKey: true });
    key('Alt', 'keyup');
    key('Shift', 'keyup');
    near(get(n.id).params.position.value, [280, 210]);
    key('Escape');
    up();
  }
  // Delete cannot interleave another history transaction with a pending move.
  for (const type of ['Rectangle', 'Null', 'Vector', 'Text']) {
    const { d, n, position } = project(type);
    d.editor.snap = false;
    load(d);
    const original = saved();
    down(
      [250, 200],
      { shiftKey: true },
      document.querySelector('[data-position-handle]') ||
        document.querySelector('[data-node-stage-move]'),
    );
    move([280, 205], { shiftKey: true });
    key('Delete');
    assert.ok(get(n.id), type);
    near(get(n.id).params[position].value, [280, 200]);
    up();
    undo();
    assert.equal(saved(), original);
    assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  }
  // Multiple generators retain relative positions and share one constrained displacement.
  {
    const { d, l, n, out } = project('Rectangle'),
      c = node('Circle');
    c.params.center.value = [450, 300];
    l.nodes.push(c);
    d.editor.snap = false;
    load(d);
    fire(document.querySelector(`.node[data-id="${c.id}"] .node-head`), 'pointerdown', [0, 0], {
      shiftKey: true,
    });
    up();
    const original = saved();
    down([500, 400], { shiftKey: true });
    move([520, 405], { shiftKey: true });
    up();
    near(get(n.id).params.center.value, [270, 200]);
    near(get(c.id).params.center.value, [470, 300]);
    undo();
    assert.equal(saved(), original);
  }
  // Curve anchors and retained Remap anchors share the same constraint and rollback rules.
  for (const remapped of [false, true]) {
    const d = makeDoc(),
      l = d.layers[0],
      curve = node('Curve'),
      remap = node('Path Remap'),
      out = node('Output');
    curve.points = [point(100, 100), point(200, 100), point(200, 200)];
    curve.params.closed.value = false;
    l.nodes = remapped ? [remap, curve, out] : [curve, out];
    l.output = out.id;
    if (remapped) {
      connect(l, curve.id, remap.id, 'path');
      connect(l, remap.id, out.id, 'path');
    } else connect(l, curve.id, out.id, 'path');
    load(d);
    const original = saved(),
      id = curve.points[0].id;
    const target = () => document.querySelector(`[data-point="${id}"]:not([data-handle])`);
    down([100, 100], { shiftKey: true }, target());
    move([103, 130], { shiftKey: true, altKey: true });
    up();
    near(
      remapped
        ? get(remap.id).edits[0].params.position.value
        : get(curve.id).points[0].position.value,
      remapped ? [0, 30] : [100, 130],
    );
    undo();
    assert.equal(saved(), original);
    down([100, 100], { shiftKey: true }, target());
    move([100.5, 100.5], { shiftKey: true });
    up();
    assert.equal(saved(), original, 'Remap click does not allocate edit');
    down([100, 100], { shiftKey: true }, target());
    move([130, 103], { shiftKey: true, altKey: true });
    key('Escape');
    up();
    assert.equal(saved(), original);
  }
  // Final-output character axis stays horizontal under a rotated/scaled downstream Transform.
  {
    const { d, l, n, out } = project('Text'),
      tr = node('Transform');
    d.editor.snap = false;
    tr.params.rotation.value = 90;
    tr.params.scale.value = 2;
    l.nodes.push(tr);
    connect(l, n.id, tr.id, 'path');
    connect(l, tr.id, out.id, 'path');
    load(d);
    document.querySelector('[data-character-mode]').click();
    flush();
    const pos = (i) => {
      const r = win.nect.evaluate(),
        g = r.textLayout(n.id).characters[i],
        o = r.path.characterOccurrences[0];
      return transformCharacterPoint(o.matrix, [
        (g.bounds[0] + g.bounds[2]) / 2,
        (g.bounds[1] + g.bounds[3]) / 2,
      ]);
    };
    down(pos(0));
    up();
    down(pos(1), { shiftKey: true });
    up();
    assert.equal(document.querySelectorAll('.character-hit.selected').length, 2);
    const original = saved(),
      p = pos(0);
    down(p, { shiftKey: true });
    move([p[0] + 30, p[1] + 5], { shiftKey: true });
    assert.equal(document.querySelectorAll('.character-hit.selected').length, 2);
    up();
    near(get(n.id).characterPositions.offsets.c1, [0, -15]);
    near(get(n.id).characterPositions.offsets.c2, [0, -15]);
    undo();
    assert.equal(saved(), original);
    document.querySelector('[data-character-mode]').click();
    flush();
    down(pos(0));
    up();
    down(pos(1), { shiftKey: true });
    up();
    down(pos(0), { shiftKey: true });
    up();
    assert.equal(
      document.querySelectorAll('.character-hit.selected').length,
      1,
      'Shift-click still deselects',
    );
    const q = pos(1);
    down(q, { shiftKey: true });
    move([q[0] + 30, q[1] + 4], { shiftKey: true });
    key('Escape');
    up();
    assert.equal(saved(), original);
    assert.equal(
      document.querySelectorAll('.character-hit.selected').length,
      1,
      'cancel does not apply deferred toggle',
    );
  }
  // Moving the same selected character in a distinct instance changes the active route.
  {
    const { d, l, n, out } = project('Text'),
      tr = node('Transform'),
      join = node('Join Geometry');
    d.editor.snap = false;
    tr.params.offset.value = [350, 0];
    tr.params.anchor.value = [250, 200];
    tr.params.rotation.value = 90;
    l.nodes.push(tr, join);
    connect(l, n.id, tr.id, 'path');
    connect(l, n.id, join.id, 'a');
    connect(l, tr.id, join.id, 'b');
    connect(l, join.id, out.id, 'path');
    load(d);
    document.querySelector('[data-character-mode]').click();
    flush();
    const r = win.nect.evaluate(),
      g = r.textLayout(n.id).characters[0];
    const positions = r.path.characterOccurrences.map((o) =>
      transformCharacterPoint(o.matrix, [
        (g.bounds[0] + g.bounds[2]) / 2,
        (g.bounds[1] + g.bounds[3]) / 2,
      ]),
    );
    down(positions[0]);
    up();
    down(positions[1], { shiftKey: true });
    assert.equal(
      document.querySelector('[data-character-instance]').value,
      r.path.characterOccurrences[1].route,
    );
    move([positions[1][0] + 30, positions[1][1] + 5], { shiftKey: true });
    up();
    near(get(n.id).characterPositions.offsets.c1, [0, -30]);
    key('ArrowRight');
    near(get(n.id).characterPositions.offsets.c1, [0, -31]);
  }
  win.happyDOM.abort();
});
