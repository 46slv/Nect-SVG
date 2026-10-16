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
import { multiArtworkFixture } from './fixtures/artwork-multi-move.js';
import { guideDefaults } from '../src/guides.js';

test('Multiple independent artworks select and move as one transaction', async (t) => {
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
    '\nwindow.artworkUI = () => ({fontReady: !!bundledFont, activeLayer, selected, artworkTarget, artworkSelection: [...artworkSelection], selection: [...selection], past: history.past.length, future: history.future.length, drag: drag?.type, wiring: !!wiring});';
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const readyDeadline = Date.now() + 5000;
  while (!win.artworkUI().fontReady) {
    assert.ok(Date.now() < readyDeadline, 'Bundled font did not finish loading');
    await new Promise((r) => setTimeout(r, 10));
  }
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
  const row = (id, shift = false) => {
    $(`[data-select-layer="${id}"]`).dispatchEvent(
      new win.MouseEvent('click', { bubbles: true, shiftKey: shift }),
    );
    flush();
  };
  const selectedIds = () => [...ui().artworkSelection].sort();
  const setup = (edit = () => {}) => {
    const f = multiArtworkFixture();
    edit(f);
    load(f.doc);
    row(f.ids[0]);
    for (const id of f.ids.slice(1)) row(id, true);
    return f;
  };
  const shifted = (doc, ids, delta) => {
    const d = structuredClone(doc);
    for (const l of d.layers.filter((l) => ids.includes(l.id))) {
      const tr = l.nodes.find((n) => n.type === 'Transform');
      const n = tr || l.nodes[0];
      if (n.type === 'Curve')
        for (const p of n.points) p.position.value = p.position.value.map((v, i) => v + delta[i]);
      else {
        const q =
          n.params[tr ? 'offset' : ['Image', 'Text'].includes(n.type) ? 'position' : 'center'];
        q.value = q.value.map((v, i) => v + delta[i]);
      }
    }
    return d;
  };
  await t.test(
    'Shift adds/removes on canvas and Layers; selection is visible and leaves JSON/history/export intact',
    () => {
      const f = setup(),
        before = saved(),
        svg = win.nect.export();
      assert.deepEqual(selectedIds(), [...f.ids].sort());
      assert.equal(document.querySelectorAll('.layer.selected').length, 5);
      assert.equal(document.querySelectorAll('.artwork-selection').length, 5);
      assert.match($('.inspector-body').textContent, /5 selected/);
      assert.equal($('[data-duplicate-artwork]').disabled, true);
      fire(shape(f.ids[1]), 'pointerdown', [400, 170], { shiftKey: true });
      fire(document, 'pointerup');
      assert.equal(ui().artworkSelection.length, 4);
      fire(shape(f.ids[1]), 'pointerdown', [400, 170], { shiftKey: true });
      fire(document, 'pointerup');
      assert.deepEqual(selectedIds(), [...f.ids].sort());
      assert.equal(ui().drag, undefined);
      assert.equal(saved(), before);
      assert.equal(win.nect.export(), svg);
      assert.equal(ui().past, 0);
      key(stage(), 'Delete');
      assert.equal(saved(), before);
      assert.match($('.message').textContent, /Select one artwork/);
      row(f.ids[0]);
      assert.deepEqual(selectedIds(), [f.ids[0]]);
    },
  );
  await t.test(
    'dragging any selected member translates all five paths, with one Undo/Redo and restored selection',
    () => {
      const f = setup(),
        before = structuredClone(win.nect.document);
      fire(shape(f.ids[0]), 'pointerdown', [170, 170]);
      fire(document, 'pointermove', [195, 185], { altKey: true });
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [25, 15]));
      assert.equal(ui().artworkSelection.length, 5);
      fire(document, 'pointerup');
      assert.equal(ui().past, 1);
      const after = saved();
      selectNode(f.rect.nodeId);
      assert.deepEqual(selectedIds(), []);
      click('[data-action="undo"]');
      assert.deepEqual(win.nect.document, before);
      assert.deepEqual(selectedIds(), [...f.ids].sort());
      click('[data-action="redo"]');
      assert.equal(saved(), after);
    },
  );
  await t.test(
    'Shift held before pressing a selected member constrains the set; a click still removes only that member',
    () => {
      const f = setup(),
        before = structuredClone(win.nect.document);
      fire(shape(f.ids[0]), 'pointerdown', [170, 170], { shiftKey: true });
      assert.equal(ui().artworkSelection.length, 5);
      fire(document, 'pointermove', [195, 180], { shiftKey: true, altKey: true });
      fire(document, 'pointerup', [195, 180], { shiftKey: true });
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [25, 0]));
      assert.equal(ui().artworkSelection.length, 5);
      assert.equal(ui().past, 1);
      click('[data-action="undo"]');
      fire(shape(f.ids[0]), 'pointerdown', [170, 170], { shiftKey: true });
      fire(document, 'pointerup', [170, 170], { shiftKey: true });
      assert.equal(ui().artworkSelection.length, 4);
      assert.equal(saved(), serialize(before));
    },
  );
  await t.test(
    'Shift drag from an unselected member adds it and moves the enlarged set without dropping existing members',
    () => {
      const f = setup(),
        before = structuredClone(win.nect.document);
      row(f.ids[0]);
      fire(shape(f.ids[1]), 'pointerdown', [400, 170], { shiftKey: true });
      assert.deepEqual(selectedIds(), [f.ids[0], f.ids[1]].sort());
      fire(document, 'pointermove', [425, 180], { shiftKey: true, altKey: true });
      fire(document, 'pointerup', [425, 180], { shiftKey: true });
      assert.deepEqual(win.nect.document, shifted(before, f.ids.slice(0, 2), [25, 0]));
      assert.equal(ui().past, 1);
    },
  );
  await t.test(
    'focused arrows move 1/10 artboard units atomically across all members and history entries',
    () => {
      const f = setup(),
        before = structuredClone(win.nect.document);
      key(stage(), 'ArrowRight');
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [1, 0]));
      key(stage(), 'ArrowDown', { shiftKey: true });
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [1, 10]));
      assert.equal(ui().past, 2);
      click('[data-action="undo"]');
      click('[data-action="undo"]');
      assert.deepEqual(win.nect.document, before);
      assert.deepEqual(selectedIds(), [...f.ids].sort());
    },
  );
  await t.test(
    'Escape, pointercancel, capture loss, blur and exact out-and-back restore every record and retain Redo',
    () => {
      for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'back'])
        for (const held of [false, true]) {
          const f = setup();
          key(stage(), 'ArrowRight');
          click('[data-action="undo"]');
          const before = saved(),
            future = ui().future;
          fire(shape(f.ids[0]), 'pointerdown', [170, 170], { shiftKey: held });
          fire(document, 'pointermove', [190, 185], { altKey: true, shiftKey: held });
          if (end === 'Escape') key(stage(), 'Escape');
          else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
          else if (end === 'back') fire(document, 'pointermove', [170, 170], { altKey: true });
          else fire(stage(), end);
          fire(document, 'pointerup');
          assert.equal(saved(), before, end);
          assert.equal(ui().past, 0, end);
          assert.equal(ui().future, future, end);
          assert.deepEqual(selectedIds(), [...f.ids].sort(), end);
        }
    },
  );
  await t.test(
    'unsupported members block all dragging and arrows with a named reason; late invalidation cancels all',
    () => {
      for (const block of [
        (l) => {
          l.locked = true;
        },
        (l) => {
          l.visible = false;
        },
        (l) => {
          l.guide = true;
        },
        (l) => {
          l.nodes[0].params.position.expression = '1; 2';
        },
        (l) => {
          l.nodes[0].params.position.locked = true;
        },
      ]) {
        const f = setup((f) => block(f.doc.layers.at(-1))),
          before = saved();
        key(stage(), 'ArrowRight');
        fire(shape(f.ids[0]), 'pointerdown', [170, 170]);
        fire(document, 'pointermove', [200, 200]);
        fire(document, 'pointerup');
        assert.equal(saved(), before);
        assert.equal(ui().past, 0);
        assert.match(
          $('.artwork-move-status').textContent,
          /Embedded swatch:.*No selected artwork moved/,
        );
      }
      for (const phase of ['preview', 'commit']) {
        const f = setup(),
          before = saved();
        fire(shape(f.ids[0]), 'pointerdown', [170, 170]);
        fire(document, 'pointermove', [190, 190], { altKey: true });
        win.nect.document.layers.at(-1).locked = true;
        if (phase === 'preview') fire(document, 'pointermove', [200, 200]);
        fire(document, 'pointerup');
        assert.equal(saved(), before, phase);
        assert.equal(ui().past, 0);
      }
    },
  );
  await t.test(
    'selection uses collective bounds snapping, excludes itself, supports Alt and live Shift axis constraint',
    () => {
      const f = setup((f) => {
        f.doc.editor = {
          ...guideDefaults(),
          snap: true,
          snapArtwork: true,
          snapArtboard: false,
          snapGrid: false,
        };
      });
      const before = structuredClone(win.nect.document);
      fire(shape(f.ids[0]), 'pointerdown', [170, 170]);
      fire(document, 'pointermove', [173, 170]);
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [3, 0]));
      fire(document, 'pointermove', [190, 185], { altKey: true, shiftKey: true });
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [20, 0]));
      fire(document, 'pointermove', [190, 185], { altKey: true, shiftKey: false });
      assert.deepEqual(win.nect.document, shifted(before, f.ids, [20, 15]));
      key(stage(), 'Escape');
      fire(document, 'pointerup');
      assert.deepEqual(win.nect.document, before);
    },
  );
  await t.test(
    'fields, graph focus, modifiers, IME, modal and active gestures cannot nudge the artwork set',
    () => {
      const f = setup(),
        before = saved();
      for (const el of [$('[data-layer-name]'), $('.graph-scroll'), $('.node')])
        key(el, 'ArrowRight');
      for (const extra of [
        { isComposing: true },
        { keyCode: 229 },
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
      ])
        key(stage(), 'ArrowRight', extra);
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      document.body.append(dialog);
      key(stage(), 'ArrowRight');
      dialog.remove();
      fire(shape(f.ids[0]), 'pointerdown', [170, 170]);
      key(stage(), 'ArrowRight');
      fire(document, 'pointercancel');
      assert.equal(saved(), before);
      assert.equal(ui().past, 0);
      fire($('.artboard'), 'pointerdown', [20, 20]);
      assert.deepEqual(selectedIds(), []);
      key(stage(), 'ArrowRight');
      assert.equal(saved(), before);
      load(f.doc);
      assert.deepEqual(selectedIds(), []);
    },
  );
  win.happyDOM.abort();
});
