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

test('Committed Curve artwork placement is rigid, atomic and independent', async (t) => {
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
    'finished open/closed Bezier moves immediately as one rigid batch, then creation undoes separately',
    () => {
      for (const closed of [false, true]) {
        const before = committedCurve(closed),
          id = before.layers.at(-1).id;
        assert.equal(ui().artworkTarget, id);
        assert.match($('.artwork-move-status').textContent, /Drag artwork/);
        fire(shape(id), 'pointerdown', [180, 180]);
        fire(document, 'pointermove', [197.25, 168.5], { altKey: true });
        fire(document, 'pointerup');
        movedCurve(before, [17.25, -11.5]);
        assert.equal(ui().past, 2);
        const after = saved(),
          svg = win.nect.export();
        click('[data-action="undo"]');
        assert.deepEqual(win.nect.document, before);
        assert.equal(ui().artworkTarget, id);
        click('[data-action="undo"]');
        assert.equal(win.nect.document.layers.length, 1);
        click('[data-action="redo"]');
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assert.equal(ui().artworkTarget, id);
        load(JSON.parse(after));
        assert.equal(saved(), after);
        assert.equal(win.nect.export(), svg);
      }
    },
  );
  await t.test(
    'Curve 1/10-unit arrows and Shift drag use the existing artboard coordinate contract',
    () => {
      const before = committedCurve(),
        id = before.layers.at(-1).id;
      key(stage(), 'ArrowRight');
      movedCurve(before, [1, 0]);
      key(stage(), 'ArrowDown', { shiftKey: true });
      movedCurve(before, [1, 10]);
      click('[data-action="undo"]');
      click('[data-action="undo"]');
      assert.deepEqual(win.nect.document, before);
      fire(shape(id), 'pointerdown', [180, 180]);
      fire(document, 'pointermove', [210, 187], { shiftKey: true, altKey: true });
      fire(document, 'pointerup');
      movedCurve(before, [30, 0]);
      click('[data-action="undo"]');
      fire($('.artboard'), 'pointerdown', [900, 500]);
      fire(document, 'pointerup');
      key(stage(), 'ArrowRight');
      assert.deepEqual(win.nect.document, before);
    },
  );
  await t.test(
    'Curve movement Escape/cancel/lostcapture/blur and out-and-back restore the complete path',
    () => {
      for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'out-and-back']) {
        const before = committedCurve(true),
          id = before.layers.at(-1).id;
        fire(shape(id), 'pointerdown', [180, 180]);
        const capture = stage();
        fire(document, 'pointermove', [205, 197], { altKey: true });
        assert.notDeepEqual(win.nect.document, before);
        if (end === 'Escape') key(stage(), 'Escape');
        else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
        else if (end === 'out-and-back')
          fire(document, 'pointermove', [180, 180], { altKey: true });
        else fire(end === 'lostpointercapture' ? capture : document, end);
        fire(document, 'pointerup');
        fire(document, 'pointermove', [230, 220], { altKey: true });
        assert.deepEqual(win.nect.document, before, end);
        assert.equal(ui().past, 1, end);
        assert.equal(ui().drag, undefined);
      }
    },
  );
  await t.test(
    'changed Curve IDs/order/closure/routes and invalid late Positions roll back before preview or commit',
    () => {
      for (const phase of ['preview', 'commit'])
        for (const mutate of [
          (l, n) => {
            n.points.reverse();
          },
          (l, n) => {
            n.points.pop();
          },
          (l, n) => {
            delete n.points[1].id;
          },
          (l, n) => {
            n.points[1].id = n.points[0].id;
          },
          (l, n) => {
            n.points[2].position.value = [NaN, 1];
          },
          (l, n) => {
            n.points[2].position.locked = true;
          },
          (l, n) => {
            n.points[2].position.source = 'missing-source';
          },
          (l, n) => {
            n.points[2].position.expression = '1; 2';
          },
          (l, n) => {
            n.params.closed.value = !n.params.closed.value;
          },
          (l) => {
            l.nodes[1].params.path.source = 'missing-source';
          },
          (l) => {
            l.nodes[1].bypassed = true;
          },
        ]) {
          const before = committedCurve(),
            id = before.layers.at(-1).id;
          fire(shape(id), 'pointerdown', [180, 180]);
          fire(document, 'pointermove', [190, 190], { altKey: true });
          const l = win.nect.document.layers.at(-1);
          mutate(l, l.nodes[0]);
          if (phase === 'preview') fire(document, 'pointermove', [205, 210], { altKey: true });
          else fire(document, 'pointerup');
          assert.deepEqual(win.nect.document, before, phase);
          assert.equal(ui().past, 1);
          assert.equal(ui().drag, undefined);
        }
      const before = committedCurve(),
        descriptor = win.curveMoveProbe.resolve().target;
      assert.equal(
        win.curveMoveProbe.same({ ...descriptor, kind: 'shape-center' }, descriptor),
        false,
      );
      assert.equal(
        win.curveMoveProbe.same(
          { ...descriptor, pointIds: [...descriptor.pointIds].reverse() },
          descriptor,
        ),
        false,
      );
      assert.deepEqual(win.nect.document, before);
    },
  );
  await t.test(
    'Curve snapping changes one common delta for all anchors and Alt bypasses it',
    () => {
      const d = committedCurve(),
        l = d.layers.at(-1),
        b = pathBounds(evaluate(l).path);
      d.editor = {
        ...guideDefaults(),
        snap: true,
        snapArtboard: false,
        snapGrid: false,
        guides: [{ id: 'guide-curve-move', axis: 'x', position: b[0][1] + 20, locked: false }],
      };
      for (const bypass of [false, true]) {
        load(d);
        click(`[data-select-layer="${l.id}"]`);
        fire(shape(l.id), 'pointerdown', [180, 180]);
        fire(document, 'pointermove', [199, 195], { altKey: bypass });
        assert.equal(!!$('.snap-match'), !bypass);
        fire(document, 'pointerup');
        movedCurve(d, [bypass ? 19 : 20, 15]);
      }
    },
  );
  await t.test('batch coordinate overflow and missing late targets never partially write', () => {
    const before = committedCurve(),
      target = win.curveMoveProbe.resolve().target;
    target.positions[0] = [0, 0];
    target.positions[1] = [0, 0];
    target.positions[2] = [Number.MAX_VALUE, 0];
    assert.throws(() => win.curveMoveProbe.write(target, [Number.MAX_VALUE, 0]), /finite/);
    assert.deepEqual(win.nect.document, before);
    assert.throws(
      () =>
        win.curveMoveProbe.write({ ...target, positions: target.positions.slice(0, 2) }, [1, 2]),
      /every finite/,
    );
    assert.deepEqual(win.nect.document, before);
    const sparse = target.positions.slice();
    delete sparse[2];
    for (const positions of [
      sparse,
      [
        [0, 0],
        [0, 0],
        [, 10],
      ],
    ]) {
      assert.throws(() => win.curveMoveProbe.write({ ...target, positions }, [1, 2]), /finite/);
      assert.deepEqual(win.nect.document, before);
    }
    assert.throws(() => win.curveMoveProbe.write(target, [, 1]), /delta/);
    assert.deepEqual(win.nect.document, before);
    const q = win.nect.document.layers.at(-1).nodes[0].points[2].position;
    delete win.nect.document.layers.at(-1).nodes[0].points[2].position;
    const invalid = structuredClone(win.nect.document);
    assert.throws(() => win.curveMoveProbe.write(target, [1, 2]), /finite/);
    assert.deepEqual(win.nect.document, invalid);
    win.nect.document.layers.at(-1).nodes[0].points[2].position = q;
    assert.deepEqual(win.nect.document, before);
  });
  await t.test(
    'Curve node-stage anchor/handle edits remain distinct after whole-artwork placement',
    () => {
      committedCurve(true);
      const l = win.nect.document.layers.at(-1),
        id = l.nodes[0].id;
      selectNode(id);
      assert.equal(ui().artworkTarget, null);
      const before = structuredClone(win.nect.document),
        p = l.nodes[0].points[1];
      fire($(`[data-point="${p.id}"][data-handle="handleB"]`), 'pointerdown', [280, 210]);
      fire(document, 'pointermove', [290, 220], { altKey: true });
      fire(document, 'pointerup');
      const n = win.nect.document.layers.at(-1).nodes[0];
      assert.deepEqual(
        n.points.map((pt) => pt.position),
        before.layers.at(-1).nodes[0].points.map((pt) => pt.position),
      );
      assert.notDeepEqual(n.points[1].handleB, before.layers.at(-1).nodes[0].points[1].handleB);
      click('[data-action="undo"]');
      assert.deepEqual(win.nect.document, before);
      fire($('[data-node-stage-move]'), 'pointerdown', [180, 180]);
      fire(document, 'pointermove', [190, 200], { altKey: true });
      fire(document, 'pointerup');
      movedCurve(before, [10, 20]);
      assert.equal(ui().artworkTarget, null);
    },
  );

  win.happyDOM.abort();
});
