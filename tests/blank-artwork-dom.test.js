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
import { appendArtwork, appendBlankComposition } from '../src/artwork-creation.js';

test('New and explicit blank compositions are safe empty artwork entry points', async (t) => {
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
    '\nwindow.artworkUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], past: history.past.length, future: history.future.length, drag: drag?.type, tool, draft: penDraft?.layer, dirty: serialize(history.doc) !== savedSnapshot}); window.markPenSaved = () => { savedSnapshot = serialize(history.doc); };';
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 80));
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
  let confirmed = true;
  globalThis.confirm = () => confirmed;
  const seed = () => makeDoc();
  const newBlank = () => click('[data-action="new"]');
  const penPoint = (p, release = true) => {
    fire($('.artboard'), 'pointerdown', p);
    if (release) fire(document, 'pointerup', p);
  };
  const endPen = () => click('[data-pen-cancel]');
  const newDoc = () => {
    confirmed = true;
    load(seed());
    newBlank();
    assert.equal(win.nect.document.layers[0].nodes.length, 1);
    return saved();
  };
  await t.test(
    'launch demo stays compatible; New is blank, focused, undoable and honestly unsaved',
    () => {
      load(seed());
      win.markPenSaved();
      const original = saved(),
        prior = ui();
      assert.equal(win.nect.document.layers[0].nodes.length, 6);
      assert.equal(ui().dirty, false);
      confirmed = true;
      newBlank();
      const blank = saved();
      assert.equal(win.nect.document.layers.length, 1);
      assert.equal($('.shape'), null);
      assert.equal($('.vertex'), null);
      assert.equal($('.node-stage-move'), null);
      assert.equal($('.artwork-selection'), null);
      assert.equal($('.warning'), null);
      assert.equal(ui().selected, null);
      assert.equal(ui().artworkTarget, null);
      assert.deepEqual(ui().selection, []);
      assert.equal(ui().past, 1);
      assert.equal(ui().dirty, true);
      assert.match($('.inspector-body').textContent, /Empty composition/);
      assert.equal(document.activeElement, stage());
      click('[data-action="undo"]');
      assert.equal(saved(), original);
      assert.equal(ui().dirty, false);
      assert.equal(ui().selected, prior.selected);
      assert.equal(ui().activeLayer, prior.activeLayer);
      click('[data-action="redo"]');
      assert.equal(saved(), blank);
      assert.equal(ui().selected, null);
      assert.equal(ui().dirty, true);
      win.markPenSaved();
      const event = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    },
  );
  await t.test(
    'cancelled New preserves released and actively pressed Pen drafts and all history',
    () => {
      for (const count of [0, 1, 3])
        for (const pressed of [false, true]) {
          load(seed());
          click('[data-tool="pen"]');
          for (let i = 0; i < count; i++) penPoint([100 + i * 80, 100 + i * 20]);
          if (pressed) {
            penPoint([500, 300], false);
            fire(document, 'pointermove', [530, 320]);
          }
          const before = saved(),
            prior = structuredClone(ui());
          confirmed = false;
          newBlank();
          assert.equal(saved(), before);
          assert.deepEqual(ui(), prior);
          if (ui().draft) endPen();
          else click('[data-tool="select"]');
        }
    },
  );
  await t.test(
    'confirmed New resolves Pen first and Undo returns its completed path and artwork selection',
    () => {
      load(seed());
      confirmed = true;
      click('[data-tool="pen"]');
      penPoint([100, 100]);
      penPoint([300, 200]);
      newBlank();
      assert.equal(win.nect.document.layers.length, 1);
      assert.equal(ui().draft, undefined);
      assert.equal(ui().past, 2);
      click('[data-action="undo"]');
      assert.equal(win.nect.document.layers.length, 2);
      const l = win.nect.document.layers.at(-1);
      assert.equal(l.nodes[0].type, 'Curve');
      assert.equal(l.nodes[0].points.length, 2);
      assert.equal(ui().artworkTarget, l.id);
      click('[data-action="redo"]');
      assert.equal($('.shape'), null);
      assert.equal(ui().selected, null);
    },
  );
  await t.test(
    'all toolbar shapes and Pen work independently from New and restore exact blank state',
    () => {
      for (const tool of ['Circle', 'Rectangle', 'Polygon', 'Star', 'Text', 'pen']) {
        const before = newDoc(),
          empty = structuredClone(win.nect.document.layers[0]);
        click(`[data-tool="${tool}"]`);
        if (tool === 'pen') {
          penPoint([250, 100]);
          penPoint([420, 160]);
          key(stage(), 'Enter');
        }
        const after = saved();
        assert.equal(win.nect.document.layers.length, 2);
        assert.deepEqual(win.nect.document.layers[0], empty);
        assert.ok($('.shape'));
        assert.equal(ui().artworkTarget, win.nect.document.layers.at(-1).id);
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.equal($('.shape'), null);
        assert.equal(ui().selected, null);
        assert.equal(ui().artworkTarget, null);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        load(JSON.parse(after));
        assert.equal(saved(), after);
      }
    },
  );
  await t.test(
    '+Blank appends from locked hidden artwork and preserves both selection history and demo access',
    () => {
      const d = seed();
      d.layers[0].locked = true;
      d.layers[0].visible = false;
      load(d);
      const before = saved(),
        prior = ui();
      click('[data-action="add-blank-layer"]');
      const after = saved(),
        blank = win.nect.document.layers.at(-1);
      assert.deepEqual(win.nect.document.layers[0], JSON.parse(before).layers[0]);
      assert.equal(blank.nodes.length, 1);
      assert.equal(blank.allowEmptyOutput, true);
      assert.equal(blank.locked, false);
      assert.equal(blank.visible, true);
      assert.equal($('.shape'), null);
      assert.equal(ui().selected, null);
      assert.equal(ui().artworkTarget, null);
      click(`[data-select-layer="${blank.id}"]`);
      assert.equal(ui().artworkTarget, null);
      assert.equal($('.artwork-selection'), null);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
      assert.equal(ui().selected, prior.selected);
      click('[data-action="redo"]');
      assert.equal(saved(), after);
      click('[data-action="add-layer"]');
      assert.equal(win.nect.document.layers.at(-1).nodes.length, 6);
      assert.equal(win.nect.document.layers.length, 3);
    },
  );
  await t.test('blank graph creation remains disconnected until explicit Use as output', () => {
    newDoc();
    const l = win.nect.document.layers[0],
      output = structuredClone(l.nodes[0]);
    const add = $('#add-node');
    add.value = 'Curve';
    add.dispatchEvent(new win.Event('change', { bubbles: true }));
    flush();
    const source = win.nect.document.layers[0].nodes.at(-1);
    assert.equal($('.shape'), null);
    assert.deepEqual(win.nect.document.layers[0].nodes[0], output);
    assert.equal(win.nect.evaluate().error, null);
    assert.equal(win.nect.document.layers.length, 1);
    click(`[data-preview="${source.id}"]`);
    assert.ok($('.shape'));
    assert.equal(win.nect.document.layers.length, 1);
    assert.equal(win.nect.evaluate().error, null);
    click('[data-action="undo"]');
    assert.equal($('.shape'), null);
  });
  await t.test(
    '+Blank cancels live source/graph/wire gestures before switching layer scope',
    () => {
      for (const kind of ['source', 'node', 'wire', 'pan']) {
        load(seed());
        const before = saved(),
          source = win.nect.document.layers[0].nodes[0];
        if (kind === 'source') fire($('[data-node-stage-move]'), 'pointerdown', [100, 100]);
        if (kind === 'node')
          fire($(`.node[data-id="${source.id}"] .node-head`), 'pointerdown', [100, 100]);
        if (kind === 'wire') fire($(`[data-source="${source.id}"]`), 'pointerdown', [100, 100]);
        if (kind === 'pan') fire(stage(), 'pointerdown', [100, 100], { button: 1 });
        fire(document, 'pointermove', [140, 125]);
        if (kind === 'source' || kind === 'node') assert.notEqual(saved(), before);
        click('[data-action="add-blank-layer"]');
        assert.equal(ui().drag, undefined);
        assert.equal(ui().draft, undefined);
        assert.deepEqual(win.nect.document.layers[0], JSON.parse(before).layers[0]);
        assert.equal(ui().past, 1);
        const after = saved();
        fire(document, 'pointermove', [220, 180]);
        fire(document, 'pointerup');
        assert.equal(saved(), after);
        click('[data-action="undo"]');
        assert.equal(saved(), before);
      }
      const d = seed();
      while (d.layers.length < 100) appendBlankComposition(d);
      load(d);
      const before = saved();
      fire($('[data-node-stage-move]'), 'pointerdown', [100, 100]);
      fire(document, 'pointermove', [140, 125]);
      click('[data-action="add-blank-layer"]');
      assert.equal(saved(), before, 'capacity failure retains the pre-gesture committed document');
      assert.equal(ui().drag, undefined);
      assert.equal(ui().past, 0);
    },
  );
  await t.test('+Blank capacity failure is atomic in document, history and UI selection', () => {
    const d = seed();
    while (d.layers.length < 100) appendBlankComposition(d);
    load(d);
    const before = saved(),
      prior = structuredClone(ui());
    click('[data-action="add-blank-layer"]');
    assert.equal(saved(), before);
    assert.deepEqual(ui(), prior);
    assert.match($('.message').textContent, /100/);
  });
  win.happyDOM.abort();
});
