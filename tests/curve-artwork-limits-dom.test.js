import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  point,
  connect,
  serialize,
  evaluate,
  pathBounds,
} from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { guideDefaults } from '../src/guides.js';

test('Curve movement budget and fresh synchronous resolution stay explicit', async (t) => {
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
    inverse: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: -40, f: -20 }),
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
      'import { resolveArtworkMoveTarget }',
      'import { resolveArtworkMoveTarget as rawResolveArtworkMoveTarget }',
    )
    .replace(
      'const app =',
      'const resolveArtworkMoveTarget = (...args) => { window.curveResolveCalls = (window.curveResolveCalls || 0) + 1; return rawResolveArtworkMoveTarget(...args); }; const app =',
    )
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  source +=
    '\nwindow.artworkUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], past: history.past.length, future: history.future.length, drag: drag?.type, tool, draft: penDraft?.layer}); window.markPenSaved = () => { savedSnapshot = serialize(history.doc); }; window.curveMoveProbe = { resolve: artworkMove, write: writeArtworkMove, same: sameArtworkMove };';
  // These suites synchronously create/evaluate Text after startup. Await the
  // font condition inside the test module, rather than racing filesystem I/O.
  source +=
    '\nconst fontTestDeadline = Date.now() + 5000; while (!bundledFont) { if (Date.now() >= fontTestDeadline) throw Error("Bundled test font did not finish loading"); await new Promise((r) => setTimeout(r, 10)); }';
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  flush();
  const $ = (s) => document.querySelector(s),
    stage = () => $('.canvas-stage');
  const saved = () => serialize(win.nect.document),
    ui = () => win.artworkUI();
  const load = (d) => {
    win.nect.load(serialize(d));
    flush();
  };
  const click = (s) => {
    $(s).click();
    flush();
  };
  const xy = ([x, y]) => [x * 2 + 80, y * 2 + 40];
  const fire = (el, type, p = [0, 0], extra = {}) => {
    const screen = xy(p);
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        button: 0,
        clientX: screen[0],
        clientY: screen[1],
        ...extra,
      }),
    );
    flush();
  };
  const key = (el, name, extra = {}) => {
    const e = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: name,
      ...extra,
    });
    el.dispatchEvent(e);
    flush();
    return e.defaultPrevented;
  };
  const selectNode = (id) => {
    fire($(`.node[data-id="${id}"] .node-head`), 'pointerdown');
    fire(document, 'pointerup');
  };
  const shape = (id) => $(`.shape[data-layer="${id}"]`);
  const seed = () => {
    const d = makeDoc();
    d.layers[0].name = 'Keep original';
    return d;
  };
  const start = (p = [100, 100]) => {
    click('[data-tool="pen"]');
    fire($('.artboard'), 'pointerdown', p);
    fire(document, 'pointerup', p);
  };
  const add = (p = [250, 200], handles) => {
    fire($('.artboard'), 'pointerdown', p);
    if (handles) fire(document, 'pointermove', handles);
    fire(document, 'pointerup', handles || p);
  };
  const curve = () => ui().draft.nodes[0];

  const committedCurve = (closed = false) => {
    load(seed());
    start([100, 100]);
    add([250, 180], [280, 210]);
    add([180, 260]);
    if (closed) fire($('.vertex'), 'pointerdown', [100, 100]);
    else key(stage(), 'Enter');
    return structuredClone(win.nect.document);
  };
  const movedCurve = (before, delta) => {
    const expected = structuredClone(before);
    expected.layers.at(-1).nodes[0].points.forEach((pt) => {
      pt.position.value = pt.position.value.map((v, axis) => v + delta[axis]);
    });
    assert.deepEqual(win.nect.document, expected);
  };
  await t.test(
    'synchronous artwork status/gesture work resolves once without persistent target caching',
    () => {
      const before = committedCurve(),
        id = before.layers.at(-1).id;
      let calls = win.curveResolveCalls;
      click(`[data-select-layer="${id}"]`);
      assert.equal(win.curveResolveCalls - calls, 1);
      calls = win.curveResolveCalls;
      fire(shape(id), 'pointerdown', [180, 180]);
      assert.equal(win.curveResolveCalls - calls, 1);
      calls = win.curveResolveCalls;
      fire(document, 'pointermove', [195, 190], { altKey: true });
      assert.equal(win.curveResolveCalls - calls, 1);
      calls = win.curveResolveCalls;
      fire(document, 'pointerup');
      assert.equal(win.curveResolveCalls - calls, 1);
      calls = win.curveResolveCalls;
      key(stage(), 'ArrowRight');
      assert.equal(
        win.curveResolveCalls - calls,
        2,
        'one pre-write guard and one fresh post-write render status',
      );
    },
  );
  await t.test(
    'above 128 anchors whole-artwork movement is visibly refused while source edit/save/export retain all points',
    () => {
      const d = committedCurve(true),
        l = d.layers.at(-1),
        n = l.nodes[0];
      n.points = Array.from({ length: 129 }, (_, i) =>
        point(
          200 + Math.cos((i * Math.PI * 2) / 129) * 80,
          200 + Math.sin((i * Math.PI * 2) / 129) * 80,
        ),
      );
      l.nodes.forEach((n) => {
        n.collapsed = true;
      });
      load(d);
      click(`[data-select-layer="${l.id}"]`);
      assert.match($('.artwork-move-status').textContent, /128 anchors.*graph Curve.*Save\/export/);
      const before = saved(),
        svg = win.nect.export();
      key(stage(), 'ArrowRight');
      fire(shape(l.id), 'pointerdown', [200, 200]);
      fire(document, 'pointermove', [220, 220]);
      fire(document, 'pointerup');
      assert.equal(saved(), before);
      assert.equal(ui().past, 0);
      load(JSON.parse(before));
      assert.equal(saved(), before);
      assert.equal(win.nect.export(), svg);
      assert.equal(evaluate(win.nect.document.layers.at(-1)).path.contours[0].points.length, 129);
      click(`[data-select-layer="${l.id}"]`);
      selectNode(n.id);
      fire($('[data-node-stage-move]'), 'pointerdown', [200, 200]);
      fire(document, 'pointermove', [210, 220], { altKey: true });
      fire(document, 'pointerup');
      movedCurve(d, [10, 20]);
      assert.equal(ui().artworkTarget, null);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
    },
  );
  win.happyDOM.abort();
});
