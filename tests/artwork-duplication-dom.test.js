import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { blankLayer, node, serialize } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import {
  duplicationDocument,
  richDuplicationText,
  multiDuplicationDocument,
} from './fixtures/artwork-duplication.js';

test('Duplicate in place is independent, undoable, selection-scoped and interruption-safe', async (t) => {
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
    '\nwindow.duplicationUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], characterEdit: characterEdit ? { ...characterEdit, selected: [...characterEdit.selected] } : null, selectedGuide, remapBatches: [...remapBatches].map(([id, batch]) => [id, { selected: [...batch.selected], delta: [...batch.delta] }]), past: history.past.length, future: history.future.length, drag: drag?.type, wiring: !!wiring, draft: penDraft?.layer, nameEdit, zoom, pan: [...pan], graphZoom}); window.testDuplicateArtwork = duplicateArtwork; window.testBeginName = beginNameEdit;';
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
    ui = () => win.duplicationUI(),
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
    duplicate = () => $('[data-duplicate-artwork]'),
    force = (id) => {
      win.testDuplicateArtwork(id);
      flush();
    };

  await t.test(
    'every initial route offers selected Artwork duplication, inserts above source and restores selection/history',
    () => {
      for (const [type, transformed] of [
        ['Circle', false],
        ['Ellipse', true],
        ['Rectangle', true],
        ['Polygon', false],
        ['Star', true],
        ['Text', false],
        ['Text', true],
        ['Curve', false],
        ['Image', false],
      ]) {
        const f = duplicationDocument(type, transformed);
        if (type === 'Text') richDuplicationText(f.generator);
        load(f.doc);
        select(f.layer.id);
        const before = saved(),
          prior = ui();
        assert.ok(duplicate());
        assert.equal(duplicate().disabled, false, type);
        assert.equal(duplicate().textContent, 'Duplicate in place');
        assert.equal(
          $('.artwork-duplicate-status').textContent,
          'Each copy above its source. One Undo.',
        );
        assert.ok(
          duplicate().compareDocumentPosition($('.artwork-alignment')) &
            win.Node.DOCUMENT_POSITION_FOLLOWING,
          'duplication is reachable before alignment controls',
        );
        click('[data-duplicate-artwork]');
        const after = saved(),
          copy = win.nect.document.layers[2];
        assert.deepEqual(
          win.nect.document.layers.filter((l) => l.id !== copy.id),
          f.doc.layers,
        );
        assert.equal(copy.name, f.layer.name + ' copy');
        assert.equal(ui().activeLayer, copy.id);
        assert.equal(ui().artworkTarget, copy.id);
        assert.equal(ui().selected, null);
        assert.deepEqual(ui().selection, []);
        assert.equal(document.activeElement, stage());
        assert.equal(ui().past, prior.past + 1);
        assert.equal($('.artwork-selection').getAttribute('data-layer'), null);
        force(f.layer.id);
        assert.equal(saved(), after, 'stale explicit button cannot duplicate prior source');
        for (let i = 0; i < 2; i++) {
          click('[data-action="undo"]');
          assert.equal(saved(), before);
          assert.equal(ui().artworkTarget, f.layer.id);
          click('[data-action="redo"]');
          assert.equal(saved(), after);
          assert.equal(ui().artworkTarget, copy.id);
        }
        stage().focus();
        key(stage(), 'ArrowRight');
        assert.deepEqual(
          win.nect.document.layers.find((l) => l.id === f.layer.id),
          f.layer,
          'nudging the copy leaves the source exact',
        );
        assert.equal(ui().past, prior.past + 2);
        click('[data-action="undo"]');
        assert.equal(saved(), after);
        click('[data-action="undo"]');
        assert.equal(saved(), before);
      }
    },
  );

  await t.test(
    'graph-node Duplicate stays graph-only and no artwork action exists in node or empty selection',
    () => {
      const f = duplicationDocument();
      load(f.doc);
      select(f.layer.id);
      selectNode(f.generator.id);
      assert.equal(duplicate(), null);
      const before = saved();
      force(f.layer.id);
      assert.equal(saved(), before);
      click(`[data-duplicate="${f.generator.id}"]`);
      assert.equal(win.nect.document.layers.length, 3);
      assert.equal(win.nect.document.layers[1].nodes.length, 4);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
      select(f.doc.layers[0].id);
      assert.equal(duplicate(), null);
    },
  );

  await t.test(
    'navigation and canvas/graph zoom and scroll are preserved without revealing a new node',
    () => {
      const f = duplicationDocument();
      load(f.doc);
      select(f.layer.id);
      click('[data-action="actual-size"]');
      click('[data-action="zoom-in"]');
      click('[data-action="graph-zoom-in"]');
      $('.graph-scroll').scrollLeft = 180;
      $('.graph-scroll').scrollTop = 130;
      const prior = ui(),
        scroll = [$('.graph-scroll').scrollLeft, $('.graph-scroll').scrollTop];
      click('[data-duplicate-artwork]');
      assert.equal(ui().zoom, prior.zoom);
      assert.equal(ui().graphZoom, prior.graphZoom);
      assert.deepEqual(ui().pan, prior.pan);
      assert.deepEqual([$('.graph-scroll').scrollLeft, $('.graph-scroll').scrollTop], scroll);
    },
  );

  await t.test(
    'read-only, disconnected/complex, suspended Text and 100-layer cases give reasons and force no-op history',
    () => {
      const variants = [
        (f) => (f.layer.locked = true),
        (f) => (f.layer.visible = false),
        (f) => (f.layer.guide = true),
        (f) => f.layer.nodes.push(node('Null')),
        (f) => (f.fill.bypassed = true),
        (f) => {
          const n = node('Stroke');
          n.params.path.source = f.generator.id;
          f.layer.nodes[2] = n;
          f.output.params.path.source = n.id;
        },
        (f) => {
          while (f.doc.layers.length < 100) f.doc.layers.push(blankLayer());
        },
      ];
      for (const mutate of variants) {
        const f = duplicationDocument();
        mutate(f);
        load(f.doc);
        select(f.layer.id);
        const before = saved(),
          prior = ui();
        assert.ok(duplicate().disabled);
        assert.ok($('.artwork-duplicate-status').textContent.length);
        force(f.layer.id);
        assert.equal(saved(), before);
        assert.deepEqual(ui(), prior);
      }
      const f = duplicationDocument('Text');
      richDuplicationText(f.generator);
      f.generator.text = 'unverified change';
      load(f.doc);
      select(f.layer.id);
      assert.ok(duplicate().disabled);
      assert.match($('.artwork-duplicate-status').textContent, /suspended character/);
    },
  );

  await t.test(
    'live Pen, wire, artwork/graph/numeric gestures reject without finishing or cancelling ownership',
    () => {
      const f = duplicationDocument();
      load(f.doc);
      select(f.layer.id);
      const before = saved(),
        past = ui().past;
      click('[data-tool="pen"]');
      fire($('.artboard'), 'pointerdown');
      fire(document, 'pointerup');
      fire($('.artboard'), 'pointerdown', { clientX: 300, clientY: 260 });
      fire(document, 'pointerup');
      const draft = structuredClone(ui().draft);
      force(f.layer.id);
      assert.equal(saved(), before);
      assert.equal(ui().past, past);
      assert.deepEqual(ui().draft, draft);
      click('[data-pen-cancel]');
      for (const kind of ['wire', 'node', 'artwork', 'numeric']) {
        load(f.doc);
        select(f.layer.id);
        if (kind === 'numeric') selectNode(f.generator.id);
        const el =
          kind === 'wire'
            ? $('.node .output')
            : kind === 'node'
              ? $('.node .node-head')
              : kind === 'numeric'
                ? $(`.node[data-id="${f.generator.id}"] input[type="number"][data-scrub-step]`)
                : $(`.shape[data-layer="${f.layer.id}"]`);
        fire(el, 'pointerdown');
        const prior = ui(),
          text = saved();
        assert.ok(prior.drag || prior.wiring, kind);
        if (duplicate()) assert.equal(duplicate().disabled, true, kind);
        force(f.layer.id);
        assert.equal(saved(), text, kind);
        assert.equal(ui().drag, prior.drag);
        assert.equal(ui().wiring, prior.wiring);
        fire(document, 'pointerup');
      }
    },
  );

  await t.test(
    'rename, IME and dialog lifecycle disables/re-enables the same explicit artwork action',
    async () => {
      const f = duplicationDocument();
      load(f.doc);
      select(f.layer.id);
      let before = saved(),
        prior = ui();
      win.testBeginName(f.layer.id);
      flush();
      assert.equal(duplicate().disabled, true);
      const edit = structuredClone(ui().nameEdit);
      force(f.layer.id);
      assert.equal(saved(), before);
      assert.deepEqual(ui().nameEdit, edit);
      key($('[data-rename-name]'), 'Escape');
      assert.equal(duplicate().disabled, false);
      stage().dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
      assert.equal(duplicate().disabled, true);
      force(f.layer.id);
      assert.equal(saved(), before);
      assert.equal(ui().past, prior.past);
      stage().dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
      assert.equal(duplicate().disabled, false);
      for (const close of ['button', 'native']) {
        click('[data-action="help"]');
        const dialog = $('dialog[open]');
        try {
          assert.equal(duplicate().disabled, true);
          force(f.layer.id);
          assert.equal(saved(), before);
          if (close === 'button') dialog.querySelector('button').click();
          else dialog.close();
          await waitFor(() => !duplicate().disabled, 'Dialog closing releases duplication');
        } finally {
          dialog.remove();
        }
      }
    },
  );
  await t.test(
    'batch selection, active copy, exact history and stale controls with unchanged active item',
    () => {
      const f = multiDuplicationDocument();
      load(f.doc);
      const add = (id) => {
        $(`[data-select-layer="${id}"]`).dispatchEvent(
          new win.MouseEvent('click', { bubbles: true, shiftKey: true }),
        );
        flush();
      };
      const selectedLayers = () =>
        [...document.querySelectorAll('.layer.selected')].map((l) => l.dataset.layer).sort();
      select(f.ids[2]);
      add(f.ids[0]);
      add(f.ids[3]);
      add(f.ids[1]);
      const before = saved(),
        prior = ui(),
        originalSelection = selectedLayers(),
        stale = duplicate().cloneNode(true);
      assert.equal(duplicate().disabled, false);
      click('[data-duplicate-artwork]');
      const after = saved(),
        copies = win.nect.document.layers.filter((l) => !f.doc.layers.some((s) => s.id === l.id));
      assert.equal(copies.length, 4);
      assert.equal(ui().past, prior.past + 1);
      assert.deepEqual(selectedLayers(), copies.map((l) => l.id).sort());
      assert.equal(
        ui().activeLayer,
        copies[1].id,
        'active maps to former active source, not first or last paint position',
      );
      assert.equal(ui().artworkTarget, copies[1].id);
      assert.deepEqual(ui().selection, []);
      assert.equal(ui().selected, null);
      for (let i = 0; i < 2; i++) {
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.deepEqual(selectedLayers(), originalSelection);
        assert.equal(ui().activeLayer, prior.activeLayer);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assert.deepEqual(selectedLayers(), copies.map((l) => l.id).sort());
        assert.equal(ui().activeLayer, copies[1].id);
      }
      click('[data-duplicate-artwork]');
      assert.equal(ui().past, prior.past + 2);
      click('[data-action="undo"]');
      assert.equal(saved(), after);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
      // Toggle a nonactive source out, then restore the previous active source.
      add(f.ids[0]);
      add(f.ids[1]);
      add(f.ids[1]);
      assert.equal(ui().activeLayer, prior.activeLayer);
      document.querySelector('.inspector-body').append(stale);
      const historyBefore = ui().past,
        remaining = selectedLayers();
      stale.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      flush();
      assert.equal(saved(), before);
      assert.equal(ui().past, historyBefore);
      assert.deepEqual(selectedLayers(), remaining);
      stale.remove();
    },
  );

  await t.test(
    'batch refusal, IME, modal, rename and live gesture preserve all selected artwork and redo',
    () => {
      const f = multiDuplicationDocument();
      const choose = () => {
        select(f.ids[0]);
        $(`[data-select-layer="${f.ids[3]}"]`).dispatchEvent(
          new win.MouseEvent('click', { bubbles: true, shiftKey: true }),
        );
        flush();
      };
      const forceBatch = () => {
        duplicate().dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        flush();
      };
      f.fixtures[3].layer.locked = true;
      load(f.doc);
      choose();
      const before = saved(),
        prior = ui();
      assert.equal(duplicate().disabled, true);
      assert.match(
        $('.artwork-duplicate-status').textContent,
        /Image original:.*Unlock the artwork layer/i,
      );
      forceBatch();
      assert.equal(saved(), before);
      assert.deepEqual(ui(), prior);
      f.fixtures[3].layer.locked = false;
      load(f.doc);
      choose();
      click('[data-duplicate-artwork]');
      click('[data-action="undo"]');
      const original = saved(),
        past = ui().past,
        future = ui().future;
      for (const mode of ['ime', 'modal', 'rename', 'gesture']) {
        if (mode === 'ime')
          stage().dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
        if (mode === 'modal') click('[data-action="help"]');
        if (mode === 'rename') {
          win.testBeginName(f.ids[3]);
          flush();
        }
        if (mode === 'gesture') fire($(`.shape[data-layer="${f.ids[3]}"]`), 'pointerdown');
        assert.equal(duplicate().disabled, true, mode);
        forceBatch();
        assert.equal(saved(), original, mode);
        assert.equal(ui().past, past);
        assert.equal(ui().future, future);
        if (mode === 'ime')
          stage().dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
        if (mode === 'modal') {
          $('dialog[open] button').click();
          flush();
        }
        if (mode === 'rename') key($('[data-rename-name]'), 'Escape');
        if (mode === 'gesture') fire(document, 'pointercancel');
        assert.equal(duplicate().disabled, false, mode);
      }
    },
  );
  await win.happyDOM.close();
});
