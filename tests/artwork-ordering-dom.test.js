import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { blankLayer, document as makeDoc, node, serialize } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { orderingDocument } from './fixtures/artwork-ordering.js';
import { unsupportedLayer } from './fixtures/artwork-deletion.js';

test('layer ordering is a stable-ID permutation with exact selection, focus and interruption safety', async (t) => {
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
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
    inverse() {
      return this;
    },
  };
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform() {
      return { x: this.x, y: this.y };
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
    '\nwindow.orderingUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], characterEdit: characterEdit ? { ...characterEdit, selected: [...characterEdit.selected] } : null, selectedGuide, remapBatches: [...remapBatches].map(([id, batch]) => [id, { selected: [...batch.selected], delta: [...batch.delta] }]), past: history.past.length, future: history.future.length, drag: drag?.type, wiring: !!wiring, draft: penDraft?.layer, nameEdit, zoom, pan: [...pan], graphZoom});  window.testBeginName = beginNameEdit;';
  // These suites synchronously create/evaluate Text after startup. Await the
  // font condition inside the test module, rather than racing filesystem I/O.
  source +=
    '\nconst fontTestDeadline = Date.now() + 5000; while (!bundledFont) { if (Date.now() >= fontTestDeadline) throw Error("Bundled test font did not finish loading"); await new Promise((r) => setTimeout(r, 10)); }';
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  flush();
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 2000;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(condition(), message);
  };
  const $ = (s) => document.querySelector(s),
    stage = () => $('.canvas-stage'),
    ui = () => win.orderingUI(),
    saved = () => serialize(win.nect.document),
    load = (doc) => {
      win.nect.load(serialize(doc));
      flush();
    },
    click = (selector) => {
      $(selector).click();
      flush();
    },
    key = (el, name, extra = {}) => {
      const e = new win.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: name,
        ...extra,
      });
      el.dispatchEvent(e);
      flush();
      return e.defaultPrevented;
    },
    fire = (el, type, extra = {}) => {
      el.dispatchEvent(
        new win.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 3,
          button: 0,
          clientX: 180,
          clientY: 180,
          ...extra,
        }),
      );
      flush();
    },
    select = (id) => click(`[data-select-layer="${id}"]`),
    selectNode = (id, extra = {}) => {
      fire($(`.node[data-id="${id}"] .node-head`), 'pointerdown', extra);
      fire(document, 'pointerup');
    },
    order = (id, direction = 'forward') =>
      $(`[data-order-layer="${id}"][data-order-direction="${direction}"]`),
    force = (id, direction = 'forward') => {
      const button = document.createElement('button');
      button.dataset.orderLayer = id;
      button.dataset.orderDirection = direction;
      $('#app').append(button);
      button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      button.remove();
      flush();
    },
    selectionState = () => {
      const { past, future, ...state } = ui();
      return state;
    };

  await t.test(
    'inactive row changes only order, retains focused control and views, one exact Undo/Redo',
    () => {
      const doc = orderingDocument(),
        target = doc.layers[1],
        active = doc.layers[0];
      load(doc);
      select(active.id);
      click('[data-action="actual-size"]');
      click('[data-action="zoom-in"]');
      click('[data-action="graph-zoom-in"]');
      $('.graph-scroll').scrollLeft = 120;
      $('.graph-scroll').scrollTop = 80;
      $('.right').scrollTop = 30;
      const before = saved(),
        prior = selectionState(),
        past = ui().past;
      const control = order(target.id);
      assert.equal(control.getAttribute('aria-label'), `Forward one position: ${target.name}`);
      assert.equal(control.getAttribute('aria-disabled'), 'false');
      control.focus();
      control.click();
      flush();
      const after = saved();
      assert.deepEqual(
        win.nect.document.layers.map((l) => l.id),
        [active.id, doc.layers[2].id, target.id],
      );
      assert.deepEqual(selectionState(), prior);
      assert.equal(ui().past, past + 1);
      assert.equal(document.activeElement, order(target.id));
      assert.equal(order(target.id).getAttribute('aria-disabled'), 'true');
      assert.equal(order(target.id).disabled, false, 'boundary is focusable disabled semantics');
      assert.deepEqual(
        [$('.graph-scroll').scrollLeft, $('.graph-scroll').scrollTop, $('.right').scrollTop],
        [120, 80, 30],
      );
      for (let i = 0; i < 2; i++) {
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.deepEqual(selectionState(), prior);
        const redo = ui().future;
        force(doc.layers[0].id, 'backward');
        force(doc.layers[2].id, 'forward');
        force('stale-layer');
        force(target.id, 'up');
        assert.equal(saved(), before);
        assert.equal(ui().future, redo);
        assert.equal(ui().past, past);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assert.deepEqual(selectionState(), prior);
      }
      const post = ui();
      for (let i = 0; i < 3; i++) force(target.id);
      assert.equal(saved(), after);
      assert.deepEqual(ui(), post);
      order(target.id, 'backward').focus();
      order(target.id, 'backward').click();
      flush();
      assert.equal(saved(), before);
      assert.equal(document.activeElement, order(target.id, 'backward'));
    },
  );

  await t.test(
    'artwork, node/multi-node, character, guide and Remap selections survive ordering and history',
    () => {
      for (const mode of ['artwork', 'node', 'multi', 'character', 'guide', 'remap', 'empty']) {
        const doc = mode === 'remap' ? makeDoc() : orderingDocument();
        const target =
          mode === 'remap'
            ? appendArtwork(doc, 'Circle', { at: [100, 100] }).layerId
            : doc.layers[1].id;
        let text;
        if (mode === 'character') text = appendArtwork(doc, 'Text', { at: [200, 160] });
        load(doc);
        if (mode === 'remap') {
          const remap = doc.layers[0].nodes.find((n) => n.type === 'Path Remap');
          selectNode(remap.id);
          const box = $('[data-batch-point]');
          box.checked = true;
          box.dispatchEvent(new win.Event('change', { bubbles: true }));
          assert.ok(ui().remapBatches.some(([, batch]) => batch.selected.length));
        } else if (mode === 'empty') {
          const blank = blankLayer();
          doc.layers.push(blank);
          load(doc);
          select(blank.id);
        } else if (mode === 'character') {
          select(text.layerId);
          selectNode(text.nodeId);
          click(`[data-character-mode="${text.nodeId}"]`);
          $('[data-character-selection]').options[0].selected = true;
          $('[data-character-selection]').dispatchEvent(new win.Event('change', { bubbles: true }));
          flush();
          assert.ok(ui().characterEdit.selected.length);
        } else {
          select(doc.layers[0].id);
          if (mode === 'node' || mode === 'multi') selectNode(doc.layers[0].nodes[0].id);
          if (mode === 'multi') selectNode(doc.layers[0].nodes[1].id, { shiftKey: true });
          if (mode === 'guide') {
            click('[data-action="guides-panel"]');
            click(`[data-select-guide="${doc.editor.guides[0].id}"]`);
          }
        }
        const before = saved(),
          prior = selectionState(),
          past = ui().past;
        // Remap fixture's added layer is at the front, so send it backward.
        order(target, mode === 'remap' ? 'backward' : 'forward').click();
        flush();
        const after = saved();
        assert.notEqual(after, before, mode);
        assert.equal(ui().past, past + 1, mode);
        assert.deepEqual(selectionState(), prior, mode);
        for (let i = 0; i < 2; i++) {
          click('[data-action="undo"]');
          assert.equal(saved(), before, mode);
          assert.deepEqual(selectionState(), prior, mode);
          click('[data-action="redo"]');
          assert.equal(saved(), after, mode);
          assert.deepEqual(selectionState(), prior, mode);
        }
        if (mode === 'guide') click('[data-action="guides-panel"]');
      }
    },
  );

  await t.test(
    'locked target cannot move; crossing locked neighbors and all geometry-independent records works',
    () => {
      const doc = orderingDocument(),
        target = doc.layers[1];
      target.locked = true;
      load(doc);
      const before = saved(),
        prior = ui();
      assert.equal(order(target.id).disabled, true);
      assert.equal(order(target.id).getAttribute('aria-disabled'), 'true');
      force(target.id);
      assert.equal(saved(), before);
      assert.deepEqual(ui(), prior);
      target.locked = false;
      doc.layers[2].locked = true;
      load(doc);
      force(target.id);
      assert.deepEqual(win.nect.document.layers[1], doc.layers[2]);
      for (const mode of [
        'hidden',
        'guide',
        'empty',
        'complex',
        'gradient',
        'large-curve',
        'image',
      ]) {
        const d = mode === 'complex' ? makeDoc() : orderingDocument();
        let t = d.layers[0];
        if (mode === 'complex') d.layers.push(blankLayer());
        if (mode === 'hidden') t.visible = false;
        if (mode === 'guide') t.guide = true;
        if (mode === 'empty') {
          t = blankLayer();
          d.layers[0] = t;
        }
        if (['gradient', 'large-curve', 'image'].includes(mode)) t = unsupportedLayer(d, mode);
        load(d);
        const prior = saved(),
          index = d.layers.indexOf(t);
        assert.equal(order(t.id).getAttribute('aria-disabled'), 'false', mode);
        order(t.id).click();
        flush();
        assert.deepEqual(win.nect.document.layers[index + 1], t, mode);
        click('[data-action="undo"]');
        assert.equal(saved(), prior, mode);
      }
    },
  );

  await t.test(
    'live detached Pen and pointer/wire/scrub ownership remain byte-for-byte unchanged on forced click',
    () => {
      const doc = orderingDocument(),
        target = doc.layers[1];
      load(doc);
      select(target.id);
      click('[data-tool="pen"]');
      fire($('.artboard'), 'pointerdown');
      fire(document, 'pointerup');
      fire($('.artboard'), 'pointerdown', { clientX: 300, clientY: 260 });
      fire(document, 'pointerup');
      const before = saved(),
        draft = structuredClone(ui());
      assert.equal(draft.draft.nodes[0].points.length, 2);
      assert.equal(order(target.id).disabled, true);
      force(target.id);
      assert.equal(saved(), before);
      assert.deepEqual(ui(), draft, 'does not finish, cancel or mutate draft/selection/history');
      click('[data-pen-cancel]');
      for (const kind of ['wire', 'node', 'artwork', 'numeric']) {
        load(doc);
        select(target.id);
        if (kind === 'numeric') selectNode(target.nodes[0].id);
        const el =
          kind === 'wire'
            ? $('.node .output')
            : kind === 'node'
              ? $('.node .node-head')
              : kind === 'numeric'
                ? $(`.node[data-id="${target.nodes[0].id}"] input[type="number"][data-scrub-step]`)
                : $(`.shape[data-layer="${target.id}"]`);
        fire(el, 'pointerdown');
        const text = saved(),
          prior = ui();
        assert.ok(prior.drag || prior.wiring, kind);
        assert.equal(order(target.id).disabled, true, kind);
        force(target.id);
        assert.equal(saved(), text, kind);
        assert.deepEqual(ui(), prior, kind);
        fire(document, 'pointerup');
      }
    },
  );

  await t.test(
    'rename pointer default, IME and editor dialog lifecycle reject without committing the edit',
    async () => {
      const doc = orderingDocument(),
        target = doc.layers[1];
      load(doc);
      select(target.id);
      win.testBeginName(target.id);
      flush();
      const input = $('[data-rename-name]');
      input.value = 'Uncommitted name';
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      const before = saved(),
        prior = ui();
      const down = new win.PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        button: 0,
      });
      order(target.id).dispatchEvent(down);
      assert.equal(down.defaultPrevented, true, 'refused row action cannot blur inline rename');
      force(target.id);
      assert.equal(saved(), before);
      assert.deepEqual(ui(), prior);
      fire(document, 'pointerup');
      key(input, 'Escape');
      assert.equal(order(target.id).disabled, false);
      stage().dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
      const ime = ui();
      assert.equal(order(target.id).disabled, true);
      force(target.id);
      assert.equal(saved(), before);
      assert.deepEqual(ui(), ime);
      stage().dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
      assert.equal(order(target.id).disabled, false);
      for (const close of ['button', 'native']) {
        click('[data-action="help"]');
        const dialog = $('dialog[open]'),
          current = ui();
        assert.equal(order(target.id).disabled, true);
        force(target.id);
        assert.equal(saved(), before);
        assert.deepEqual(ui(), current);
        if (close === 'button') dialog.querySelector('button').click();
        else dialog.close();
        await waitFor(() => !order(target.id).disabled, 'dialog close releases ordering');
      }
    },
  );
  await win.happyDOM.close();
});
