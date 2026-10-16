import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { blankLayer, document as makeDoc, serialize } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { deletionDocument, unsupportedLayer } from './fixtures/artwork-deletion.js';

test('whole-artwork layer deletion is exact, undoable and safely scoped in the editor', async (t) => {
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
    '\nwindow.deletionUI = () => ({activeLayer, selected, artworkTarget, selection: [...selection], characterEdit: characterEdit ? { ...characterEdit, selected: [...characterEdit.selected] } : null, selectedGuide, remapBatches: [...remapBatches].map(([id, batch]) => [id, { selected: [...batch.selected], delta: [...batch.delta] }]), past: history.past.length, future: history.future.length, drag: drag?.type, wiring: !!wiring, draft: penDraft?.layer}); window.testDeleteLayer = deleteArtwork; window.testCharacterChooser = () => { const c = characterContext(); const hit = { glyph: c.layout.characters[0], occurrence: c.editable[0], instance: 0 }; selectOverlappingCharacters([hit, { ...hit, instance: 1 }]); };';
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
    ui = () => win.deletionUI(),
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
    deletion = (id) => $(`[data-delete-layer="${id}"]`),
    assertClear = () => {
      assert.equal(ui().selected, null);
      assert.equal(ui().artworkTarget, null);
      assert.deepEqual(ui().selection, []);
      assert.equal(ui().characterEdit, null);
      assert.equal(
        document.querySelectorAll('.node.selected,.artwork-selection,.character-floating').length,
        0,
      );
    };

  await t.test(
    'focused-artboard Delete removes the selected entire layer, one history step, exact Undo/Redo and no repeat cascade',
    () => {
      const doc = deletionDocument(),
        target = doc.layers[1];
      load(doc);
      select(target.id);
      const before = saved(),
        prior = ui();
      assert.equal(document.activeElement, stage());
      key(stage(), 'Delete');
      const after = saved();
      assert.deepEqual(
        win.nect.document.layers,
        doc.layers.filter((layer) => layer.id !== target.id),
      );
      assert.equal(ui().activeLayer, doc.layers[2].id);
      assert.equal(ui().past, prior.past + 1);
      assertClear();
      for (let i = 0; i < 3; i++) key(stage(), 'Delete', { repeat: i > 0 });
      assert.equal(saved(), after);
      assert.equal(ui().past, prior.past + 1);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
      assert.equal(ui().artworkTarget, target.id);
      assert.equal(ui().activeLayer, prior.activeLayer);
      click('[data-action="redo"]');
      assert.equal(saved(), after);
      assertClear();
    },
  );

  await t.test(
    'explicit exact-ID action deletes inactive hidden/guide/empty layers and clears a multi-node or character selection',
    () => {
      for (const mode of ['hidden', 'guide', 'empty']) {
        const doc = deletionDocument(),
          target = doc.layers[0],
          active = doc.layers[1];
        if (mode === 'hidden') target.visible = false;
        if (mode === 'guide') target.guide = true;
        load(doc);
        select(active.id);
        selectNode(active.nodes[0].id);
        selectNode(active.nodes[1].id, { shiftKey: true });
        const prior = ui(),
          before = saved();
        click(`[data-delete-layer="${target.id}"]`);
        assert.deepEqual(win.nect.document.layers, doc.layers.slice(1));
        assertClear();
        assert.equal(ui().activeLayer, active.id);
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.equal(ui().activeLayer, prior.activeLayer);
        assert.equal(ui().selected, prior.selected);
        assert.deepEqual(ui().selection, prior.selection);
      }
      const doc = deletionDocument(),
        created = appendArtwork(doc, 'Text', { at: [300, 200] });
      load(doc);
      select(created.layerId);
      selectNode(created.nodeId);
      click(`[data-character-mode="${created.nodeId}"]`);
      const options = [...$('[data-character-selection]').options];
      options[0].selected = true;
      $('[data-character-selection]').dispatchEvent(new win.Event('change', { bubbles: true }));
      flush();
      const prior = ui(),
        before = saved();
      assert.ok(prior.characterEdit.selected.length);
      click(`[data-delete-layer="${created.layerId}"]`);
      const after = saved();
      assertClear();
      for (let i = 0; i < 2; i++) {
        click('[data-action="undo"]');
        assert.equal(saved(), before);
        assert.deepEqual(ui().characterEdit, prior.characterEdit);
        click('[data-action="redo"]');
        assert.equal(saved(), after);
        assertClear();
      }
    },
  );

  await t.test(
    'guide selection retains Delete ownership, including locked-guide protection',
    () => {
      for (const locked of [false, true]) {
        const doc = deletionDocument(),
          guide = doc.editor.guides[0];
        guide.locked = locked;
        load(doc);
        select(doc.layers[1].id);
        click('[data-action="guides-panel"]');
        click(`[data-select-guide="${guide.id}"]`);
        const before = structuredClone(win.nect.document),
          prior = ui();
        assert.equal(prior.artworkTarget, doc.layers[1].id);
        key(stage(), 'Delete');
        assert.deepEqual(win.nect.document.layers, before.layers);
        assert.equal(win.nect.document.editor.guides.length, locked ? 1 : 0);
        assert.equal(ui().past, prior.past + (locked ? 0 : 1));
        if (locked) assert.deepEqual(win.nect.document, before);
        click('[data-action="guides-panel"]');
      }
    },
  );

  await t.test(
    'explicit deletion restores guide and Remap point selections across Undo/Redo',
    () => {
      const doc = deletionDocument(),
        guide = doc.editor.guides[0],
        target = doc.layers[1];
      load(doc);
      select(target.id);
      click('[data-action="guides-panel"]');
      click(`[data-select-guide="${guide.id}"]`);
      const priorGuide = ui();
      click(`[data-delete-layer="${target.id}"]`);
      assert.equal(ui().selectedGuide, null);
      click('[data-action="undo"]');
      assert.equal(ui().selectedGuide, priorGuide.selectedGuide);
      click('[data-action="redo"]');
      assert.equal(ui().selectedGuide, null);
      click('[data-action="guides-panel"]');
      const remapDoc = makeDoc(),
        added = appendArtwork(remapDoc, 'Circle', { at: [100, 100] }),
        remap = remapDoc.layers[0].nodes.find((node) => node.type === 'Path Remap');
      load(remapDoc);
      selectNode(remap.id);
      const checkbox = $('[data-batch-point]');
      checkbox.checked = true;
      checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
      const delta = $('[data-batch-axis="0"]');
      delta.value = '12';
      delta.dispatchEvent(new win.Event('change', { bubbles: true }));
      const prior = ui();
      assert.ok(prior.remapBatches.some(([, batch]) => batch.selected.length));
      click(`[data-delete-layer="${added.layerId}"]`);
      assert.ok(ui().remapBatches.every(([, batch]) => !batch.selected.length));
      for (let i = 0; i < 2; i++) {
        click('[data-action="undo"]');
        assert.deepEqual(ui().remapBatches, prior.remapBatches);
        click('[data-action="redo"]');
        assert.ok(ui().remapBatches.every(([, batch]) => !batch.selected.length));
      }
    },
  );

  await t.test(
    'locked rejection and stale/repeated explicit IDs never change history or select/delete a neighbor',
    () => {
      const doc = deletionDocument(),
        target = doc.layers[1];
      target.locked = true;
      load(doc);
      select(target.id);
      const before = saved(),
        prior = ui();
      assert.equal(deletion(target.id).disabled, true);
      key(stage(), 'Delete');
      win.testDeleteLayer(target.id);
      win.testDeleteLayer('stale-layer');
      assert.equal(saved(), before);
      assert.deepEqual(ui(), prior);
      target.locked = false;
      load(doc);
      click(`[data-delete-layer="${target.id}"]`);
      const after = saved(),
        post = ui();
      win.testDeleteLayer(target.id);
      assert.equal(saved(), after);
      assert.deepEqual(ui(), post);
    },
  );

  await t.test(
    'fields, contenteditable, graph/button focus, modifiers, IME and dialogs never invoke artwork deletion',
    async () => {
      const doc = deletionDocument(),
        id = doc.layers[1].id;
      load(doc);
      select(id);
      const before = saved(),
        prior = ui();
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      $('#app').append(editable);
      for (const el of [
        $('[data-layer-name]'),
        $('.graph-scroll'),
        deletion(id),
        editable,
        document.body,
      ])
        key(el, 'Delete');
      for (const extra of [
        { isComposing: true },
        { keyCode: 229 },
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { repeat: true },
      ])
        key(stage(), 'Delete', extra);
      stage().dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
      assert.equal(deletion(id).disabled, true);
      win.testDeleteLayer(id);
      key(stage(), 'Delete');
      stage().dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
      assert.equal(saved(), before);
      assert.equal(ui().past, prior.past);
      click('[data-action="help"]');
      const dialog = $('dialog[open]');
      assert.ok(dialog);
      try {
        assert.equal(deletion(id).disabled, true);
        win.testDeleteLayer(id);
        key(stage(), 'Delete');
        key(dialog, 'Delete');
        assert.equal(saved(), before);
        dialog.querySelector('button').click();
      } finally {
        if (dialog.open) dialog.close();
        dialog.remove();
      }
      assert.equal(deletion(id).disabled, false);
      click('[data-action="help"]');
      const reopened = $('dialog[open]');
      try {
        assert.equal(deletion(id).disabled, true);
        reopened.close();
        await waitFor(() => !deletion(id).disabled, 'Native close releases layer deletion');
      } finally {
        if (reopened.open) reopened.close();
        reopened.remove();
      }
      assert.equal(saved(), before);
    },
  );

  await t.test(
    'connection and character-choice dialog lifecycles disable and release deletion deterministically',
    async () => {
      const doc = deletionDocument(),
        target = doc.layers[1];
      load(doc);
      select(target.id);
      const before = saved();
      for (const action of ['cancel', 'apply', 'close']) {
        click(`.graph [data-node="${target.nodes[0].id}"][data-key="center"] [data-connect-menu]`);
        const dialog = $('dialog[open]');
        assert.ok(dialog);
        try {
          assert.equal(deletion(target.id).disabled, true);
          win.testDeleteLayer(target.id);
          assert.equal(saved(), before);
          if (action === 'close') dialog.close();
          else
            dialog.querySelector(action === 'cancel' ? '[data-cancel]' : '[data-confirm]').click();
          await waitFor(
            () => !deletion(target.id).disabled,
            'Connection dialog releases layer deletion',
          );
          assert.equal(saved(), before);
        } finally {
          if (dialog.open) dialog.close();
          dialog.remove();
        }
      }
      const textDoc = deletionDocument(),
        text = appendArtwork(textDoc, 'Text', { at: [300, 200] });
      load(textDoc);
      select(text.layerId);
      selectNode(text.nodeId);
      click(`[data-character-mode="${text.nodeId}"]`);
      const textBefore = saved();
      for (const action of ['choice', 'cancel', 'close', 'reset']) {
        win.testCharacterChooser();
        const dialog = $('.character-choice[open]');
        assert.ok(dialog);
        try {
          assert.equal(deletion(text.layerId).disabled, true);
          win.testDeleteLayer(text.layerId);
          assert.equal(saved(), textBefore);
          if (action === 'choice') dialog.querySelector('[data-choice="0"]').click();
          if (action === 'cancel')
            dialog.dispatchEvent(new win.Event('cancel', { cancelable: true }));
          if (action === 'close') dialog.close();
          if (action === 'reset') load(textDoc);
          await waitFor(
            () => !deletion(text.layerId).disabled,
            'Character dialog releases layer deletion',
          );
          assert.equal(saved(), textBefore);
        } finally {
          if (dialog.open) dialog.close();
          dialog.remove();
        }
      }
    },
  );

  await t.test(
    'textarea IME completion releases disabled deletion controls after draft composition clears',
    async () => {
      const doc = deletionDocument(),
        added = appendArtwork(doc, 'Text', { at: [300, 200] });
      load(doc);
      select(added.layerId);
      selectNode(added.nodeId);
      const input = $(`[data-text="${added.nodeId}"]`),
        before = saved();
      input.dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
      assert.equal(deletion(added.layerId).disabled, true);
      win.testDeleteLayer(added.layerId);
      assert.equal(saved(), before);
      input.dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
      await Promise.resolve();
      assert.equal(deletion(added.layerId).disabled, false);
      assert.equal(saved(), before);
    },
  );

  await t.test(
    'live Pen draft, wire and node/artboard gestures disable explicit deletion without finishing or cancelling the edit',
    () => {
      const doc = deletionDocument(),
        id = doc.layers[1].id;
      load(doc);
      select(id);
      const before = saved(),
        past = ui().past;
      click('[data-tool="pen"]');
      fire($('.artboard'), 'pointerdown');
      fire(document, 'pointerup');
      fire($('.artboard'), 'pointerdown', { clientX: 300, clientY: 250 });
      fire(document, 'pointerup');
      const draft = structuredClone(ui().draft);
      assert.equal(deletion(id).disabled, true);
      win.testDeleteLayer(id);
      key(stage(), 'Delete');
      assert.equal(saved(), before);
      assert.deepEqual(ui().draft, draft);
      assert.equal(ui().past, past);
      click('[data-pen-cancel]');
      for (const kind of ['wire', 'node', 'artwork']) {
        load(doc);
        select(id);
        const el =
          kind === 'wire'
            ? $('.node .output')
            : kind === 'node'
              ? $('.node .node-head')
              : $(`.shape[data-layer="${id}"]`);
        fire(el, 'pointerdown');
        const ownership = ui(),
          gesture = saved();
        assert.ok(ownership.drag || ownership.wiring, kind);
        assert.equal(deletion(id).disabled, true, kind);
        win.testDeleteLayer(id);
        key(stage(), 'Delete');
        assert.equal(saved(), gesture, kind);
        assert.equal(ui().drag, ownership.drag);
        assert.equal(ui().wiring, ownership.wiring);
        fire(document, 'pointerup');
        assert.equal(deletion(id).disabled, false, kind);
      }
    },
  );

  await t.test(
    'complex, gradient, image and over-movement-budget Curve deletion needs no move target',
    () => {
      for (const kind of ['complex', 'gradient', 'image', 'large-curve']) {
        const doc = kind === 'complex' ? makeDoc() : deletionDocument(),
          target = kind === 'complex' ? doc.layers[0] : unsupportedLayer(doc, kind);
        load(doc);
        select(target.id);
        const before = saved();
        key(stage(), 'Delete');
        assert.ok(!win.nect.document.layers.some((layer) => layer.id === target.id), kind);
        assertClear();
        click('[data-action="undo"]');
        assert.equal(saved(), before, kind);
        assert.equal(ui().artworkTarget, target.id);
      }
    },
  );

  await t.test(
    'last-layer deletion retains settings/assets, empty export and normal new artwork; capacity is reusable',
    () => {
      const doc = deletionDocument();
      doc.layers = [doc.layers[1]];
      load(doc);
      select(doc.layers[0].id);
      const before = saved();
      key(stage(), 'Delete');
      const blank = structuredClone(win.nect.document),
        after = saved();
      assert.equal(blank.layers.length, 1);
      assert.equal(blank.layers[0].allowEmptyOutput, true);
      assert.equal(blank.layers[0].nodes.length, 1);
      assert.deepEqual({ ...blank, layers: [] }, { ...doc, layers: [] });
      assertClear();
      assert.match(win.nect.export(), /viewBox="0 0 720 480"><\/svg>$/);
      key(stage(), 'Delete');
      assert.equal(saved(), after);
      click('[data-action="undo"]');
      assert.equal(saved(), before);
      click('[data-action="redo"]');
      assert.equal(saved(), after);
      click('[data-tool="Rectangle"]');
      assert.equal(win.nect.document.layers.length, 2);
      assert.deepEqual(win.nect.document.layers[0], blank.layers[0]);
      const full = deletionDocument();
      while (full.layers.length < 100) full.layers.push(blankLayer());
      load(full);
      click(`[data-delete-layer="${full.layers[50].id}"]`);
      click('[data-tool="Circle"]');
      assert.equal(win.nect.document.layers.length, 100);
    },
  );

  await t.test('node-stage Delete and Duplicate retain their existing graph-only behavior', () => {
    const doc = deletionDocument(),
      layer = doc.layers[1],
      id = layer.nodes[0].id;
    load(doc);
    select(layer.id);
    selectNode(id);
    const before = saved();
    click(`[data-duplicate="${id}"]`);
    assert.equal(win.nect.document.layers.length, 3);
    assert.equal(win.nect.document.layers[1].nodes.length, 4);
    click('[data-action="undo"]');
    assert.equal(saved(), before);
    selectNode(id);
    key($('.graph-scroll'), 'Delete');
    assert.equal(win.nect.document.layers.length, 3);
    assert.equal(win.nect.document.layers[1].nodes.length, 2);
    assert.ok(win.nect.document.layers[1].nodes.some((node) => node.type === 'Output'));
  });
  await win.happyDOM.close();
});
