import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, guideDefaults } from '../src/core.js';
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
  for (const name of ['core', 'focus', 'layout', 'svg-import', 'storage', 'fonts'])
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
  pointer($('.shape'), 'pointerdown', 300, 250);
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
  win.happyDOM.abort();
});
