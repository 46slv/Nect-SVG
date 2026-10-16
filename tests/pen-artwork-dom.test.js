import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  connect,
  serialize,
  evaluate,
  pathBounds,
} from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';

test('Pen draft creation is independent, atomic and interruptible', async (t) => {
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
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  source +=
    '\nwindow.artworkUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], past: history.past.length, future: history.future.length, drag: drag?.type, tool, draft: penDraft?.layer}); window.markPenSaved = () => { savedSnapshot = serialize(history.doc); };';
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
    const event = new win.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 3,
      button: 0,
      clientX: screen[0],
      clientY: screen[1],
      ...extra,
    });
    el.dispatchEvent(event);
    flush();
    return event;
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

  await t.test(
    'empty activation and one-point finish never create a layer or consume history',
    () => {
      for (const finish of ['Enter', 'Escape', 'button', 'tool']) {
        load(seed());
        const before = saved(),
          prior = ui();
        start();
        assert.equal(saved(), before);
        assert.equal(ui().past, 0);
        assert.ok($('[data-pen-draft]'));
        assert.equal($('#add-node').disabled, true);
        assert.equal(curve().points.length, 1);
        if (finish === 'button') click('[data-pen-finish]');
        else if (finish === 'tool') click('[data-tool="select"]');
        else key(stage(), finish);
        assert.equal(saved(), before, finish);
        assert.equal(ui().past, 0);
        assert.equal(ui().draft, undefined);
        assert.equal(ui().activeLayer, prior.activeLayer);
        assert.equal(ui().selected, prior.selected);
        assert.equal(document.activeElement, stage());
      }
    },
  );
  await t.test(
    'released Bezier points remain detached; finish is one history unit and restores scope',
    () => {
      for (const finish of ['Enter', 'Escape', 'button', 'tool', 'close']) {
        const d = seed();
        d.layers[0].locked = true;
        d.layers[0].visible = false;
        d.layers[0].nodes.find((n) => n.id === d.layers[0].output).params.path.locked = true;
        load(d);
        const before = saved(),
          prior = ui(),
          oldSVG = win.nect.export();
        start();
        add([250, 180], [280, 210]);
        add([180, 260]);
        const preview = structuredClone(curve());
        assert.deepEqual(preview.points[1].handleB.value, [30, 30]);
        assert.deepEqual(preview.points[1].handleA.value, [-30, -30]);
        assert.equal(saved(), before);
        assert.equal(win.nect.export(), oldSVG);
        if (finish === 'button') click('[data-pen-finish]');
        else if (finish === 'tool') click('[data-tool="select"]');
        else if (finish === 'close') {
          const event = fire($('.vertex'), 'pointerdown', [100, 100]);
          assert.equal(
            event.defaultPrevented,
            true,
            'closing anchor must cancel native focus on removed SVG',
          );
          fire(document, 'pointerup', [100, 100]);
        } else key(stage(), finish);
        const after = saved(),
          l = win.nect.document.layers.at(-1);
        assert.equal(win.nect.document.layers.length, 2);
        assert.deepEqual(win.nect.document.layers[0], JSON.parse(before).layers[0]);
        assert.equal(l.nodes[0].id, preview.id);
        assert.equal(l.nodes[0].params.closed.value, finish === 'close');
        assert.equal(ui().past, 1);
        assert.equal(ui().artworkTarget, l.id);
        assert.equal(ui().selected, null);
        assert.equal(document.activeElement, stage());
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.equal(ui().activeLayer, prior.activeLayer);
        assert.equal(ui().selected, prior.selected);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assert.equal(ui().artworkTarget, l.id);
        load(JSON.parse(after));
        assert.equal(saved(), after);
      }
    },
  );
  await t.test(
    'Cancel and Undo discard all released or pressed points without touching redo',
    () => {
      for (const count of [1, 2, 3])
        for (const end of ['cancel', 'undo', 'key']) {
          load(seed());
          click('[data-tool="Circle"]');
          click('[data-action="undo"]');
          const before = saved(),
            prior = ui();
          start();
          for (let i = 1; i < count; i++)
            add([200 + i * 20, 150 + i * 20], [210 + i * 20, 160 + i * 20]);
          if (end === 'cancel') click('[data-pen-cancel]');
          else if (end === 'undo') click('[data-action="undo"]');
          else key(stage(), 'z', { ctrlKey: true });
          assert.equal(saved(), before);
          assert.equal(ui().draft, undefined);
          assert.equal(ui().past, prior.past);
          assert.equal(ui().future, prior.future);
          assert.equal(ui().activeLayer, prior.activeLayer);
          assert.equal(ui().artworkTarget, prior.artworkTarget);
          fire(document, 'pointermove', [500, 500]);
          fire(document, 'pointerup');
          assert.equal(saved(), before);
        }
    },
  );
  await t.test(
    'interruption rolls back only the pressed point; first-point rollback removes draft',
    () => {
      for (const released of [0, 1, 2])
        for (const end of ['cancel', 'capture', 'blur']) {
          load(seed());
          const before = saved();
          click('[data-tool="pen"]');
          for (let i = 0; i < released; i++) add([100 + i * 70, 100 + i * 30]);
          const prior = ui().draft && structuredClone(curve().points);
          fire($('.artboard'), 'pointerdown', [400, 300]);
          fire(document, 'pointermove', [430, 320]);
          if (end === 'cancel') fire(document, 'pointercancel');
          else if (end === 'capture') fire(stage(), 'lostpointercapture');
          else win.dispatchEvent(new win.Event('blur'));
          assert.equal(saved(), before);
          assert.equal(ui().past, 0);
          assert.equal(ui().drag, undefined);
          if (!released) assert.equal(ui().draft, undefined);
          else assert.deepEqual(curve().points, prior);
          fire(document, 'pointerup');
          if (released === 2) {
            key(stage(), 'Escape');
            assert.equal(win.nect.document.layers.length, 2);
            assert.equal(win.nect.document.layers.at(-1).nodes[0].points.length, 2);
          }
        }
    },
  );
  await t.test(
    'Escape during pressed third point rolls it back then preserves the released path',
    () => {
      load(seed());
      start();
      add();
      fire($('.artboard'), 'pointerdown', [350, 300]);
      fire(document, 'pointermove', [390, 330]);
      key(stage(), 'Escape');
      assert.equal(win.nect.document.layers.length, 2);
      assert.equal(win.nect.document.layers.at(-1).nodes[0].points.length, 2);
      assert.equal(ui().past, 1);
    },
  );
  await t.test(
    'focused buttons retain native Enter and both view pans own Escape before Pen',
    () => {
      for (const action of ['pen-cancel', 'pen-finish', 'action="undo"', 'tool="select"']) {
        load(seed());
        const before = saved();
        start();
        add();
        const button = $(`[data-${action}]`);
        button.focus();
        assert.equal(
          key(button, 'Enter'),
          false,
          'native button activation must not be intercepted',
        );
        assert.ok(ui().draft);
        button.click();
        flush();
        assert.equal(ui().draft, undefined);
        assert.equal(
          win.nect.document.layers.length,
          action === 'pen-finish' || action === 'tool="select"' ? 2 : 1,
        );
        if (action === 'pen-cancel' || action === 'action="undo"') assert.equal(saved(), before);
      }
      for (const view of ['.canvas-stage', '.graph-scroll']) {
        load(seed());
        const before = saved();
        start();
        add();
        const draft = structuredClone(curve().points);
        fire($(view), 'pointerdown', [250, 250], { button: 1 });
        assert.equal(ui().drag, view === '.canvas-stage' ? 'pan' : 'graph-pan');
        fire(document, 'pointermove', [280, 270]);
        key($(view), 'Escape');
        assert.equal(ui().drag, undefined);
        assert.deepEqual(curve().points, draft);
        assert.equal(ui().tool, 'pen');
        assert.equal(saved(), before);
        fire(document, 'pointerup');
        key(stage(), 'Escape');
        assert.equal(win.nect.document.layers.length, 2, 'ordinary Escape still finishes the path');
      }
    },
  );
  await t.test(
    'keyboard layer rename resolves the draft before creating a separate history edit',
    () => {
      load(seed());
      const before = saved(),
        original = win.nect.document.layers[0].id;
      start();
      add();
      const title = $(`[data-select-layer="${original}"]`);
      title.focus();
      key(title, 'F2');
      assert.equal(ui().draft, undefined);
      assert.equal(win.nect.document.layers.length, 2);
      assert.equal(ui().past, 1);
      const finished = saved(),
        input = $('[data-rename-name]');
      input.value = 'Renamed original';
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      key(input, 'Enter');
      assert.equal(win.nect.document.layers[0].name, 'Renamed original');
      assert.equal(ui().past, 2);
      click('[data-action="undo"]');
      assert.equal(saved(), finished);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
    },
  );
  await t.test(
    'draft has no move marker and participates in the existing unsaved-close warning',
    () => {
      load(seed());
      win.markPenSaved();
      const clean = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(clean);
      assert.equal(clean.defaultPrevented, false);
      start();
      add();
      assert.equal($('.node-stage-move'), null);
      const draft = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(draft);
      assert.equal(draft.defaultPrevented, true);
      click('[data-pen-cancel]');
      const cancelled = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(cancelled);
      assert.equal(cancelled.defaultPrevented, false);
    },
  );
  await t.test('capacity failure, point limit and explicit graph editing are bounded', () => {
    const d = seed();
    while (d.layers.length < 100) appendArtwork(d, 'Circle', { at: [10, 20] });
    load(d);
    const before = saved(),
      prior = ui();
    start();
    assert.equal(saved(), before);
    assert.equal(ui().draft, undefined);
    assert.equal(ui().activeLayer, prior.activeLayer);
    assert.match($('.message').textContent, /100/);
    load(seed());
    start();
    const p = curve().points[0];
    curve().points = Array.from({ length: 10000 }, (_, i) => ({
      ...structuredClone(p),
      id: 'point-limit-' + i,
    }));
    fire($('.artboard'), 'pointerdown', [400, 300]);
    assert.equal(curve().points.length, 10000);
    assert.equal(ui().drag, undefined);
    assert.match($('.message').textContent, /10000/);
    click('[data-pen-cancel]');
    const original = saved(),
      output = structuredClone(win.nect.document.layers[0].nodes.at(-1));
    const el = $('#add-node');
    el.value = 'Curve';
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    flush();
    assert.equal(win.nect.document.layers.length, 1);
    assert.equal(ui().draft, undefined);
    assert.deepEqual(
      win.nect.document.layers[0].nodes.find((n) => n.id === output.id),
      output,
    );
    const n = win.nect.document.layers[0].nodes.at(-1);
    assert.equal(n.type, 'Curve');
    click(`[data-add-point="${n.id}"]`);
    assert.equal(win.nect.document.layers[0].nodes.at(-1).points.length, 4);
    assert.notEqual(saved(), original);
  });
  win.happyDOM.abort();
});
