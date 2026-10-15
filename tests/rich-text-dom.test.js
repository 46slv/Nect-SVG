import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, serialize } from '../src/core.js';
const buffer = async (path) => {
  const b = await fs.readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('selected typography UI: range capture, atomic font/size/width, mixed/inherit, Escape, history, stale font loads, composition and locks', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'DOMPoint',
    'Event',
    'requestAnimationFrame',
  ])
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
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: () => buffer('../public/fonts/DejaVuSans.ttf'),
  });
  let reader = () => buffer('./fixtures/fonts/NectJPFixture-Regular.otf');
  globalThis.readRichFont = () => reader();
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      /import \{ desktop, saveFile, openFile, listSystemFonts, readSystemFont \} from '.\/storage.js';/,
      `const desktop=true, saveFile=async()=>true, openFile=async()=>null, listSystemFonts=async()=>[['system-0','Japanese fixture',null]], readSystemFont=()=>globalThis.readRichFont();`,
    )
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, p) => `from '${new URL('../src/' + p.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const until = async (fn) => {
    const until = Date.now() + 6000;
    while (!fn()) {
      assert.ok(Date.now() < until, 'Timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await until(() => !!win.nect);
  const doc = newDocument(),
    t = node('Text'),
    out = node('Output');
  t.text = 'ABA';
  t.params.size.value = 40;
  out.params.path.source = t.id;
  doc.layers[0].nodes = [t, out];
  doc.layers[0].output = out.id;
  win.nect.load(serialize(doc));
  await until(() => win.nect.evaluate().error === null);
  const get = () => win.nect.document.layers[0].nodes[0],
    saved = () => JSON.stringify(win.nect.document);
  const field = (key) => document.querySelector(`[data-character-style="${key}"]`);
  const edit = async (key, value) => {
    const el = field(key);
    el.value = String(value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const choose = (...ids) => {
    const el = document.querySelector('[data-character-selection]');
    for (const o of el.options) o.selected = ids.includes(o.value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const range = (from, to) => {
    const el = document.querySelector('.inspector-body [data-text]');
    el.setSelectionRange(from, to);
    el.dispatchEvent(new win.Event('select', { bubbles: true }));
    document.querySelector('[data-style-text-range]').click();
  };
  const undo = () => document.querySelector('[data-action="undo"]').click(),
    redo = () => document.querySelector('[data-action="redo"]').click();
  const initial = saved();
  range(1, 2);
  assert.equal(saved(), initial);
  assert.equal(document.querySelector('[data-character-selection]').selectedOptions[0].value, 'c2');
  await edit('size', 80);
  assert.deepEqual(get().characterPositions.styles, { c2: { size: 80 } });
  assert.equal(win.nect.document.schemaVersion, 5);
  const enlarged = saved();
  undo();
  assert.equal(saved(), initial);
  redo();
  assert.equal(saved(), enlarged);
  range(1, 2);
  await edit('font', 'system-0');
  await until(() => Object.keys(win.nect.document.fontAssets || {}).length === 1);
  assert.equal(get().font, 'default');
  const font = get().characterPositions.styles.c2.font;
  assert.ok(font.startsWith('font-'));
  assert.equal(get().characterPositions.styles.c1, undefined);
  choose('c1', 'c2');
  assert.equal(field('size').placeholder, 'Mixed');
  assert.equal(field('font').value, '__mixed');
  await edit('width', 150);
  assert.equal(get().characterPositions.styles.c1.width, 1.5);
  assert.equal(get().characterPositions.styles.c2.width, 1.5);
  assert.equal(get().characterPositions.styles.c2.size, 80);
  const wide = saved();
  await edit('width', 0);
  assert.equal(saved(), wide);
  const width = field('width');
  width.value = '200';
  width.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert.equal(width.value, '150');
  width.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(saved(), wide);
  choose('c2');
  document.querySelector('[data-character-style-inherit="size"]').click();
  assert.equal(get().characterPositions.styles.c2.size, undefined);
  assert.equal(get().characterPositions.styles.c2.font, font);
  undo();
  range(1, 2);
  assert.equal(get().characterPositions.styles.c2.size, 80);
  // A delayed installed-font request must not follow a changed range, even when JSON is unchanged.
  let release;
  reader = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const beforeStale = saved();
  const picker = field('font');
  picker.value = 'system-0';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(() => !!release);
  choose('c1');
  release(await buffer('../public/fonts/DejaVuSans.ttf'));
  await until(() => /selection changed/.test(document.querySelector('.message').textContent));
  assert.equal(saved(), beforeStale);
  // Typography reset leaves existing unrelated selection styles intact, and is one undo action.
  choose('c2');
  document.querySelector('[data-character-style-reset]').click();
  assert.equal(get().characterPositions.styles.c2, undefined);
  assert.equal(get().characterPositions.styles.c1.width, 1.5);
  undo();
  assert.equal(saved(), beforeStale);
  // Text-input selection and styles reconcile together, preserving the existing B identity.
  const text = document.querySelector('.inspector-body [data-text]');
  text.setSelectionRange(0, 0);
  text.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }));
  text.value = 'XABA';
  text.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  text.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().characterPositions.units[2].id, 'c2');
  assert.equal(get().characterPositions.styles.c2.size, 80);
  undo();
  assert.equal(saved(), beforeStale);
  const textarea = document.querySelector('.inspector-body [data-text]');
  textarea.setSelectionRange(1, 2);
  textarea.dispatchEvent(new win.Event('compositionstart', { bubbles: true }));
  document.querySelector('[data-style-text-range]').click();
  assert.match(document.querySelector('.message').textContent, /Finish or cancel/);
  textarea.dispatchEvent(new win.Event('compositionend', { bubbles: true }));
  // Same-value paste is still an identity replacement, even without a native change event.
  win.nect.load(beforeStale);
  range(1, 2);
  const equal = document.querySelector('.inspector-body [data-text]');
  equal.setSelectionRange(1, 2);
  equal.dispatchEvent(
    new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertFromPaste' }),
  );
  equal.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  equal.setSelectionRange(1, 2);
  equal.dispatchEvent(new win.Event('select', { bubbles: true }));
  document.querySelector('[data-style-text-range]').click();
  assert.equal(get().characterPositions.units[1].id, 'c4');
  assert.equal(get().characterPositions.styles.c2, undefined);
  await edit('size', 90);
  const insertion = document.querySelector('.inspector-body [data-text]');
  insertion.setSelectionRange(0, 0);
  insertion.dispatchEvent(
    new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
  );
  insertion.value = 'XABA';
  insertion.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  insertion.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().characterPositions.styles.c4.size, 90);
  // Cancel must release the chooser request and allow a different range to retry.
  range(1, 2);
  const beforeCancel = saved();
  document.querySelector('[data-load-character-font]').click();
  document.querySelector('#font-file').dispatchEvent(new win.Event('cancel', { bubbles: false }));
  choose('c4');
  assert.equal(field('font').disabled, false);
  assert.equal(document.querySelector('[data-load-character-font]').disabled, false);
  document.querySelector('[data-load-character-font]').click();
  document.querySelector('#font-file').dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(field('font').disabled, false);
  assert.equal(saved(), beforeCancel);
  // Missing glyphs must be repairable by a range font without assigning that font to all text.
  const uncovered = structuredClone(doc);
  uncovered.layers[0].nodes[0].text = 'A日';
  win.nect.load(JSON.stringify(uncovered));
  assert.match(win.nect.evaluate().error, /Missing glyphs/);
  range(1, 2);
  assert.equal(field('font').disabled, false);
  reader = () => buffer('./fixtures/fonts/NectJPFixture-Regular.otf');
  await edit('font', 'system-0');
  await until(() => win.nect.evaluate().error === null);
  assert.equal(get().font, 'default');
  assert.equal(get().characterPositions.styles.c1, undefined);
  assert.ok(get().characterPositions.styles.c2.font.startsWith('font-'));
  const locked = structuredClone(win.nect.document);
  locked.layers[0].locked = true;
  win.nect.load(JSON.stringify(locked));
  assert.equal(document.querySelector('[data-style-text-range]').disabled, true);
  assert.equal(document.querySelector('[data-character-mode]').disabled, true);
  await win.happyDOM.close();
});
