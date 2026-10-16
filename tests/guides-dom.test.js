import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, guideDefaults, layer, node, connect } from '../src/core.js';
test('guide UI add/edit/drag/delete/locks/history/cancel preserves geometry and focused inputs', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'requestAnimationFrame'])
    globalThis[key] = key === 'requestAnimationFrame' ? () => 0 : win[key];
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform() {
      return this;
    }
  };
  win.SVGElement.prototype.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
  globalThis.fetch = async () => ({ ok: false });
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source.replace("import './style.css';", '');
  for (const name of [
    'core',
    'artwork-creation',
    'artwork-move-target',
    'artwork-multi-move',
    'artwork-alignment',
    'artwork-distribution',
    'artwork-gap-distribution',
    'artwork-deletion',
    'artwork-ordering',
    'focus',
    'layout',
    'svg-import',
    'storage',
    'fonts',
    'images',
    'raster',
  ])
    source = source.replace(
      `from './${name}.js'`,
      `from '${new URL(`../src/${name}.js`, import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const $ = (q) => document.querySelector(q),
    click = (q) => $(q).click(),
    get = () => win.nect.document;
  const pointer = (target, type, x, y) =>
    target.dispatchEvent(
      new win.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
    );
  const key = (target, value) =>
    target.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: value }));
  const edit = (q, value) => {
    const el = $(q);
    el.value = String(value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const svg = win.nect.export();
  click('[data-action="guides-panel"]');
  click('[data-add-guide="x"]');
  click('[data-add-guide="y"]');
  assert.equal(get().editor.guides.length, 2);
  assert.equal(win.nect.export(), svg);
  const id = get().editor.guides[0].id;
  edit(`[data-guide-position="${id}"]`, 210.5);
  assert.equal(get().editor.guides[0].position, 210.5);
  const input = $(`[data-guide-position="${id}"]`);
  input.focus();
  key(input, 'Delete');
  assert.equal(get().editor.guides.length, 2);
  pointer($(`[data-guide="${id}"]`), 'pointerdown', 210.5, 100);
  pointer(document, 'pointermove', 240.5, 100);
  pointer(document, 'pointerup', 240.5, 100);
  assert.equal(get().editor.guides[0].position, 240.5);
  assert.equal(win.nect.export(), svg);
  click('[data-action="undo"]');
  assert.equal(get().editor.guides[0].position, 210.5);
  click('[data-action="redo"]');
  assert.equal(get().editor.guides[0].position, 240.5);
  for (const cancel of ['pointercancel', 'Escape']) {
    const before = JSON.stringify(get());
    pointer($(`[data-guide="${id}"]`), 'pointerdown', 240.5, 100);
    pointer(document, 'pointermove', 280, 100);
    if (cancel === 'Escape') key(document.body, 'Escape');
    else pointer(document, cancel, 280, 100);
    pointer(document, 'pointermove', 300, 100);
    pointer(document, 'pointerup', 300, 100);
    assert.equal(JSON.stringify(get()), before);
  }
  click(`[data-lock-guide="${id}"]`);
  assert.ok($(`[data-guide-position="${id}"]`).disabled);
  const before = JSON.stringify(get());
  pointer($(`[data-guide="${id}"]`), 'pointerdown', 240.5, 100);
  pointer(document, 'pointermove', 280, 100);
  pointer(document, 'pointerup', 280, 100);
  assert.equal(JSON.stringify(get()), before);
  click(`[data-lock-guide="${id}"]`);
  click(`[data-select-guide="${id}"]`);
  click('[data-action="guides-panel"]');
  key(document.body, 'Delete');
  assert.equal(get().editor.guides.length, 1);
  click('[data-action="undo"]');
  assert.equal(get().editor.guides.length, 2);
  const saved = JSON.stringify(get());
  win.nect.load(saved);
  assert.equal(JSON.stringify(get()), saved);
  assert.equal(win.nect.export(), svg);
  // Guide editing is independent of a locked composition; source geometry remains protected.
  get().layers[0].locked = true;
  click('[data-action="guides-panel"]');
  edit(`[data-guide-position="${id}"]`, 200);
  assert.equal(get().editor.guides[0].position, 200);
  // A grabbed shape snaps its actual edge, with one rigid translation and one undo.
  const d = newDocument();
  d.editor = guideDefaults();
  d.editor.snap = true;
  d.editor.snapGrid = false;
  d.editor.snapArtboard = false;
  d.editor.guides.push({ id: 'test-guide', axis: 'x', position: 480, locked: true });
  win.nect.load(JSON.stringify(d));
  pointer($('[data-node-stage-move]'), 'pointerdown', 300, 250);
  pointer(document, 'pointermove', 308, 250);
  pointer(document, 'pointerup', 308, 250);
  assert.deepEqual(get().layers[0].nodes[0].params.center.value, [360, 250]);
  click('[data-action="undo"]');
  assert.deepEqual(get().layers[0].nodes[0].params.center.value, [350, 250]);
  const interruption = newDocument();
  interruption.editor = guideDefaults();
  interruption.editor.guides.push({
    id: 'interrupt-guide',
    axis: 'x',
    position: 200,
    locked: false,
  });
  win.nect.load(JSON.stringify(interruption));
  const pristine = JSON.stringify(get());
  pointer($('[data-guide="interrupt-guide"]'), 'pointerdown', 200, 100);
  pointer(document, 'pointermove', 250, 100);
  document.body.dispatchEvent(
    new win.KeyboardEvent('keydown', { bubbles: true, key: 'z', ctrlKey: true }),
  );
  pointer(document, 'pointerup', 250, 100);
  assert.equal(JSON.stringify(get()), pristine);
  assert.ok($('[data-action="undo"]').disabled);
  // Undo and redo cancel the provisional gesture before applying the existing history.
  if (!$('[data-add-guide="x"]')) click('[data-action="guides-panel"]');
  edit('[data-guide-position="interrupt-guide"]', 220);
  pointer($('[data-guide="interrupt-guide"]'), 'pointerdown', 220, 100);
  pointer(document, 'pointermove', 270, 100);
  document.body.dispatchEvent(
    new win.KeyboardEvent('keydown', { bubbles: true, key: 'z', ctrlKey: true }),
  );
  pointer(document, 'pointerup', 270, 100);
  assert.equal(get().editor.guides[0].position, 200);
  pointer($('[data-guide="interrupt-guide"]'), 'pointerdown', 200, 100);
  pointer(document, 'pointermove', 260, 100);
  document.body.dispatchEvent(
    new win.KeyboardEvent('keydown', { bubbles: true, key: 'z', ctrlKey: true, shiftKey: true }),
  );
  pointer(document, 'pointerup', 260, 100);
  assert.equal(get().editor.guides[0].position, 220);
  click('[data-action="undo"]');
  assert.equal(get().editor.guides[0].position, 200);
  // Guide layers keep graph editing and independent visibility/lock controls.
  win.nect.load(JSON.stringify(newDocument()));
  const artwork = win.nect.export(),
    layerId = get().layers[0].id;
  click(`[data-layer-guide="${layerId}"]`);
  assert.equal(get().layers[0].guide, true);
  assert.ok($('.guide-layer-shape'));
  assert.ok(!win.nect.export().includes('<path'));
  click('[data-action="undo"]');
  assert.equal(win.nect.export(), artwork);
  click('[data-action="redo"]');
  assert.equal(get().layers[0].guide, true);
  click(`[data-layer-lock="${layerId}"]`);
  assert.ok($(`[data-layer-guide="${layerId}"]`).disabled);
  click(`[data-layer-lock="${layerId}"]`);
  click(`[data-visible="${layerId}"]`);
  assert.equal($('.guide-layer-shape'), null);
  assert.equal($('.artboard .guide'), null);
  const hiddenLayer = JSON.stringify(get());
  pointer($('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 140, 100);
  pointer(document, 'pointerup', 140, 100);
  assert.equal(JSON.stringify(get()), hiddenLayer);
  click(`[data-visible="${layerId}"]`);
  if (!$('[data-add-guide="x"]')) click('[data-action="guides-panel"]');
  click('[data-guide-setting="visible"]');
  assert.equal($('.guide-layer-shape'), null);
  const hiddenGuides = JSON.stringify(get());
  pointer($('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 140, 100);
  pointer(document, 'pointerup', 140, 100);
  assert.equal(JSON.stringify(get()), hiddenGuides);
  click('[data-guide-setting="visible"]');
  assert.ok($('.guide-layer-shape'));
  click(`[data-layer-guide="${layerId}"]`);
  assert.equal(win.nect.export(), artwork);
  click('[data-add-guide="x"]');
  const manualId = get().editor.guides[0].id,
    initial = JSON.stringify(get());
  $('.guides-panel').scrollTop = 120;
  $('.guide-list').scrollTop = 20;
  edit('[data-layout-field="columns"]', 4);
  assert.equal($('.guides-panel').scrollTop, 120);
  assert.equal($('.guide-list').scrollTop, 20);
  edit('[data-layout-field="rows"]', 2);
  click('[data-layout-preview]');
  assert.equal(document.querySelectorAll('.layout-preview').length, 12);
  assert.equal(JSON.stringify(get()), initial);
  assert.equal(win.nect.export(), artwork);
  click('[data-layout-cancel]');
  assert.equal(document.querySelectorAll('.layout-preview').length, 0);
  assert.equal(JSON.stringify(get()), initial);
  edit('[data-layout-field="columns"]', 4);
  edit('[data-layout-field="rows"]', 2);
  click('[data-layout-apply]');
  assert.equal(get().editor.guides.length, 13);
  assert.equal(get().editor.guides[0].id, manualId);
  click('[data-action="undo"]');
  assert.equal(JSON.stringify(get()), initial);
  click('[data-action="redo"]');
  assert.equal(get().editor.guides.length, 13);
  edit('[data-layout-field="columns"]', 2);
  click('[data-layout-apply]');
  assert.equal(get().editor.guides.length, 9);
  edit('[data-layout-field="marginX"]', 900);
  const valid = JSON.stringify(get());
  assert.ok($('[data-layout-apply]').disabled);
  click('[data-layout-preview]');
  assert.equal(document.querySelectorAll('.layout-preview').length, 0);
  assert.equal(JSON.stringify(get()), valid);
  click('[data-layout-cancel]');
  const generatedId = get().editor.guides[1].id;
  click(`[data-lock-guide="${generatedId}"]`);
  assert.ok($('[data-layout-remove]').disabled);
  assert.ok($('[data-layout-apply]').disabled);
  click(`[data-lock-guide="${generatedId}"]`);
  click('[data-layout-remove]');
  assert.deepEqual(
    get().editor.guides.map((g) => g.id),
    [manualId],
  );
  click('[data-action="undo"]');
  assert.equal(get().editor.guides.length, 9);
  const layoutSaved = JSON.stringify(get());
  win.nect.load(layoutSaved);
  assert.equal(JSON.stringify(get()), layoutSaved);
  assert.equal(win.nect.export(), artwork);
  if (!$('[data-add-guide="x"]')) click('[data-action="guides-panel"]');
  click('[data-layout-preview]');
  click('[data-action="guides-panel"]');
  assert.equal(document.querySelectorAll('.layout-preview').length, 0);
  const emptyTarget = newDocument();
  emptyTarget.editor = guideDefaults();
  emptyTarget.editor.snap = true;
  emptyTarget.editor.snapArtboard = false;
  emptyTarget.editor.snapGrid = false;
  emptyTarget.layers[0].nodes[0].params.center.value = [124, 250];
  const emptyGuide = layer('Empty guide'),
    curve = node('Curve');
  curve.points = [];
  emptyGuide.nodes.push(curve);
  connect(emptyGuide, curve.id, emptyGuide.output, 'path');
  emptyGuide.guide = true;
  emptyTarget.layers.push(emptyGuide);
  win.nect.load(JSON.stringify(emptyTarget));
  pointer($('[data-node-stage-move]'), 'pointerdown', 50, 250);
  pointer(document, 'pointermove', 52, 250);
  pointer(document, 'pointerup', 52, 250);
  assert.equal(get().layers[0].nodes[0].params.center.value[0], 126);
  // View-shortcut exclusions must not disable existing guide-edit shortcuts.
  if (!$('[data-add-guide="x"]')) click('[data-action="guides-panel"]');
  click('[data-add-guide="x"]');
  const guideId = get().editor.guides[0].id;
  click(`[data-select-guide="${guideId}"]`);
  const guideButton = $(`[data-select-guide="${guideId}"]`);
  const navKey = new win.KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
  guideButton.dispatchEvent(navKey);
  assert.equal(navKey.defaultPrevented, false);
  const commands = [];
  const interceptCommand = (e) => {
    if (['save', 'open'].includes(e.target.dataset.action)) {
      commands.push(e.target.dataset.action);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  document.addEventListener('click', interceptCommand, true);
  for (const key of ['s', 'o']) {
    const event = new win.KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    guideButton.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'app command keeps browser shortcut scoped');
  }
  document.removeEventListener('click', interceptCommand, true);
  assert.deepEqual(commands, ['save', 'open']);
  guideButton.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
  );
  assert.equal(get().editor.guides.length, 0);
  click('[data-action="undo"]');
  assert.equal(get().editor.guides[0].id, guideId);
  win.happyDOM.abort();
});
