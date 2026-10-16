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

test('Artwork creation and placement use independent layers and explicit, safe edit targets', async (t) => {
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
    '\nwindow.artworkUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], past: history.past.length, future: history.future.length, drag: drag?.type, wiring: !!wiring});';
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
  const fixture = ({ transform = false, unrelated = true } = {}) => {
    const d = makeDoc();
    d.layers = [];
    // appendArtwork requires an existing layer; keep the existing demo as a hidden reference.
    const original = makeDoc().layers[0];
    original.visible = false;
    d.layers.push(original);
    const ids = appendArtwork(d, 'Rectangle', { at: [300, 200] });
    const l = d.layers.at(-1),
      generator = l.nodes[0],
      fill = l.nodes[1];
    if (transform) {
      const tr = node('Transform');
      tr.params.scale.value = -2;
      tr.params.rotation.value = 35;
      tr.params.offset.value = [400, 300];
      l.nodes.push(tr);
      connect(l, generator.id, tr.id, 'path');
      connect(l, tr.id, fill.id, 'path');
      ids.transform = tr.id;
    }
    if (unrelated) l.nodes.unshift(node('Null'));
    return { d, l, generator, ids };
  };
  const position = (ids) => {
    const l = win.nect.document.layers.find((l) => l.id === ids.layerId);
    return l.nodes.find((n) => n.id === (ids.transform || ids.nodeId)).params[
      ids.transform ? 'offset' : 'center'
    ].value;
  };
  await t.test(
    'toolbar appends five independent artworks from locked/hidden context with one Undo and restored selection',
    () => {
      const d = makeDoc();
      d.layers[0].locked = true;
      d.layers[0].visible = false;
      d.layers[0].guide = true;
      load(d);
      let old = saved();
      for (const type of ['Circle', 'Rectangle', 'Polygon', 'Star', 'Text']) {
        const before = JSON.parse(old),
          prior = ui();
        click(`[data-tool="${type}"]`);
        assert.deepEqual(win.nect.document.layers.slice(0, -1), before.layers);
        const added = win.nect.document.layers.at(-1),
          id = added.id;
        assert.equal(added.nodes.length, 3);
        assert.equal(added.nodes[0].type, type);
        assert.deepEqual(added.nodes[0].params[type === 'Text' ? 'position' : 'center'].value, [
          d.width / 2,
          d.height / 2,
        ]);
        assert.equal(ui().artworkTarget, id);
        assert.equal(ui().selected, null);
        assert.deepEqual(ui().selection, []);
        assert.equal(document.querySelectorAll('.node.selected').length, 0);
        assert.equal(document.activeElement, stage());
        assert.equal(ui().past, prior.past + 1);
        const after = saved();
        click('[data-action="undo"]');
        assert.equal(saved(), old);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assert.equal(ui().artworkTarget, id);
        assert.equal(ui().activeLayer, id);
        old = after;
      }
      const svg = win.nect.export();
      assert.equal((svg.match(/data-layer=/g) || []).length, 5);
      load(JSON.parse(old));
      assert.equal(saved(), old);
      assert.equal(win.nect.export(), svg);
    },
  );
  await t.test('layer limit rejection preserves document, history, selection and view', () => {
    const { d } = fixture();
    while (d.layers.length < 100) appendArtwork(d, 'Circle', { at: [20, 20] });
    load(d);
    click(`[data-select-layer="${d.layers[0].id}"]`);
    const before = saved(),
      state = ui(),
      view = $('.artboard').style.transform;
    click('[data-tool="Circle"]');
    assert.equal(saved(), before);
    assert.deepEqual(ui(), state);
    assert.equal($('.artboard').style.transform, view);
    assert.match($('.message').textContent, /100 existing layers/);
  });
  await t.test(
    'layer selection ignores node order; arrows are document units and Undo is exact',
    () => {
      const { d, ids } = fixture();
      load(d);
      const before = saved();
      click(`[data-select-layer="${ids.layerId}"]`);
      assert.equal(ui().selected, null);
      assert.equal(ui().artworkTarget, ids.layerId);
      assert.equal(saved(), before);
      assert.equal(key(stage(), 'ArrowRight'), true);
      assert.deepEqual(position(ids), [301, 200]);
      assert.equal(key(stage(), 'ArrowDown', { shiftKey: true }), true);
      assert.deepEqual(position(ids), [301, 210]);
      assert.equal(ui().past, 2);
      click('[data-action="undo"]');
      click('[data-action="undo"]');
      assert.equal(saved(), before);
    },
  );
  await t.test(
    'canvas artwork hit moves its complete terminal Transform rather than unrelated Null or seed',
    () => {
      const { d, ids } = fixture({ transform: true });
      load(d);
      const before = saved(),
        seed = structuredClone(d.layers[1].nodes.find((n) => n.id === ids.nodeId));
      const bounds = pathBounds(evaluate(d.layers[1]).path);
      const p = [bounds[0][1], bounds[1][1]];
      fire(shape(ids.layerId), 'pointerdown', p);
      fire(document, 'pointermove', [p[0] + 12, p[1] - 7]);
      fire(document, 'pointerup');
      assert.deepEqual(position(ids), [412, 293]);
      assert.deepEqual(
        win.nect.document.layers[1].nodes.find((n) => n.id === ids.nodeId),
        seed,
      );
      assert.equal(ui().past, 1);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
    },
  );
  await t.test(
    'every interruption and exact out-and-back preserves history and the entire document',
    () => {
      for (const end of ['Escape', 'cancel', 'capture', 'blur', 'return']) {
        const { d, ids } = fixture();
        load(d);
        const before = saved();
        fire(shape(ids.layerId), 'pointerdown', [300, 200]);
        fire(document, 'pointermove', [320, 205], { shiftKey: true });
        assert.deepEqual(position(ids), [320, 200]);
        if (end === 'Escape') key(stage(), 'Escape');
        else if (end === 'cancel') fire(document, 'pointercancel');
        else if (end === 'capture') fire(stage(), 'lostpointercapture');
        else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
        else fire(document, 'pointermove', [300, 200]);
        fire(document, 'pointerup');
        assert.equal(saved(), before, end);
        assert.equal(ui().past, 0, end);
      }
    },
  );
  await t.test(
    'blank canvas clears scope, then neither dragging nor Arrow edits stale artwork',
    () => {
      const { d, ids } = fixture();
      load(d);
      click(`[data-select-layer="${ids.layerId}"]`);
      const before = saved();
      fire($('.artboard'), 'pointerdown', [900, 500]);
      fire(document, 'pointermove', [920, 520]);
      fire(document, 'pointerup');
      assert.equal(ui().artworkTarget, null);
      assert.equal(ui().selected, null);
      key(stage(), 'ArrowRight');
      assert.equal(saved(), before);
      assert.equal(ui().past, 0);
    },
  );
  await t.test(
    'unsupported Boolean/repeater/gradient, locks and driven positions are selectable without fallback',
    () => {
      for (const kind of ['demo', 'repeater', 'gradient', 'locked', 'driven', 'bypass']) {
        let { d, l, ids } = fixture();
        if (kind === 'demo') {
          d = makeDoc();
          l = d.layers[0];
          ids.layerId = l.id;
        }
        if (kind === 'locked') l.locked = true;
        if (kind === 'driven') {
          const v = node('Vector');
          l.nodes.push(v);
          connect(l, v.id, ids.nodeId, 'center');
        }
        if (kind === 'bypass') {
          d.schemaVersion = 10;
          l.nodes.find((n) => n.type === 'Fill').bypassed = true;
        }
        if (kind === 'gradient') {
          const g = node('Linear Gradient Fill');
          l.nodes.push(g);
          connect(l, ids.nodeId, g.id, 'path');
          connect(l, g.id, l.output, 'path');
        }
        if (kind === 'repeater') {
          const r = node('Geometry Repeater');
          l.nodes.push(r);
          connect(l, ids.nodeId, r.id, 'path');
          connect(l, r.id, l.nodes.find((n) => n.type === 'Fill').id, 'path');
        }
        load(d);
        const before = saved();
        click(`[data-select-layer="${ids.layerId}"]`);
        assert.ok($('.artwork-move-status').textContent.length);
        key(stage(), 'ArrowRight');
        fire(shape(ids.layerId), 'pointerdown', [300, 200]);
        fire(document, 'pointermove', [340, 220]);
        fire(document, 'pointerup');
        assert.equal(saved(), before, kind);
        assert.equal(ui().past, 0, kind);
        assert.equal(ui().artworkTarget, ids.layerId);
      }
    },
  );
  await t.test(
    'graph node and duplicate explicitly leave artwork mode; +Add node never rewires Output',
    () => {
      const { d, ids } = fixture();
      load(d);
      click(`[data-select-layer="${ids.layerId}"]`);
      const output = structuredClone(
        win.nect.document.layers[1].nodes.find((n) => n.id === win.nect.document.layers[1].output),
      );
      const add = $('#add-node');
      add.value = 'Circle';
      add.dispatchEvent(new win.Event('change', { bubbles: true }));
      flush();
      assert.equal(ui().artworkTarget, null);
      assert.equal(win.nect.document.layers.length, 2);
      assert.deepEqual(
        win.nect.document.layers[1].nodes.find((n) => n.id === output.id),
        output,
      );
      click(`[data-select-layer="${ids.layerId}"]`);
      click(`[data-duplicate="${ids.nodeId}"]`);
      assert.equal(ui().artworkTarget, null);
      assert.notEqual(ui().selected, ids.nodeId);
      selectNode(ids.nodeId);
      assert.ok($('[data-node-stage-move]'));
      assert.match($('.hint').textContent, /Node .*before downstream nodes/);
      const before = saved();
      fire($('[data-node-stage-move]'), 'pointerdown', [100, 100]);
      fire(document, 'pointermove', [110, 120]);
      fire(document, 'pointerup');
      assert.deepEqual(position(ids), [310, 220]);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
    },
  );
  await t.test(
    'nudge excludes fields, graph focus, IME, modifiers, live pointer and wire gestures',
    () => {
      const { d, ids } = fixture();
      load(d);
      click(`[data-select-layer="${ids.layerId}"]`);
      const before = saved();
      for (const el of [$('input[data-layer-name]'), $('.graph-scroll'), $('[data-action="fit"]')])
        assert.equal(key(el, 'ArrowRight'), false);
      for (const extra of [
        { isComposing: true },
        { keyCode: 229 },
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
      ])
        assert.equal(key(stage(), 'ArrowRight', extra), false);
      fire(shape(ids.layerId), 'pointerdown', [300, 200]);
      key(stage(), 'ArrowRight');
      fire(document, 'pointercancel');
      assert.equal(saved(), before);
      fire($('.output'), 'pointerdown');
      key(stage(), 'ArrowRight');
      fire(document, 'pointercancel');
      assert.equal(saved(), before);
      assert.equal(ui().past, 0);
    },
  );
  win.happyDOM.abort();
});
