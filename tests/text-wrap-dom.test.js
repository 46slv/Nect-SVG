import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, point, serialize } from '../src/core.js';
const buffer = async (path) => {
  const b = await fs.readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('Wrap width controls preserve source, range IDs, IME, history and atomic rejection through interrupted flows', async () => {
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
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, p) => `from '${new URL('../src/' + p.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const until = async (fn) => {
    const limit = Date.now() + 6000;
    while (!fn()) {
      assert.ok(Date.now() < limit, 'Timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));
  await until(() => !!win.nect);
  const doc = newDocument(),
    t = node('Text'),
    c = node('Curve'),
    out = node('Output');
  t.text = 'Alpha beta gamma';
  t.params.size.value = 40;
  t.params.position.value = [100, 250];
  c.points = [point(0, 0), point(1000, 0)];
  c.params.closed.value = false;
  out.params.path.source = t.id;
  doc.layers[0].nodes = [t, c, out];
  doc.layers[0].output = out.id;
  win.nect.load(serialize(doc));
  await until(() => win.nect.evaluate().error === null);
  const saved = () => JSON.stringify(win.nect.document),
    text = () => win.nect.document.layers[0].nodes[0],
    control = (key) => document.querySelector(`.inspector-body [data-${key}]`),
    change = async (key, value) => {
      const el = control(key);
      el.value = value;
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      await tick();
    },
    undo = () => document.querySelector('[data-action="undo"]').click(),
    redo = () => document.querySelector('[data-action="redo"]').click();
  const before = saved(),
    initialSVG = win.nect.export();
  await change('text-wrap', 'width');
  assert.equal(win.nect.document.schemaVersion, 8);
  assert.deepEqual(text().textWrap, { width: 320 });
  assert.equal(text().text, 'Alpha beta gamma');
  undo();
  assert.equal(saved(), before);
  redo();
  await change('text-wrap-width', '120');
  assert.equal(win.nect.evaluate().textLayout(t.id).lines.length, 3);
  const narrow = saved();
  undo();
  assert.equal(text().textWrap.width, 320);
  redo();
  assert.equal(saved(), narrow);
  const width = control('text-wrap-width');
  width.value = '900';
  width.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(width.value, '120');
  width.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(saved(), narrow);
  for (const value of ['', '0', '-1', '100001']) {
    await change('text-wrap-width', value);
    assert.equal(saved(), narrow);
  }
  await change('writing-mode', 'vertical-rl');
  assert.equal(saved(), narrow);
  assert.match(document.querySelector('.status .message').textContent, /horizontal/);
  await change('text-path', JSON.stringify([c.id, c.id]));
  assert.equal(saved(), narrow);
  assert.match(document.querySelector('.status .message').textContent, /TEXT_WRAP_PATH/);
  const ta = control('text');
  ta.setSelectionRange(0, 5);
  ta.dispatchEvent(new win.Event('select', { bubbles: true }));
  document.querySelector('.inspector-body [data-style-text-range]').click();
  // Use the dedicated numeric style field rather than depending on selector order.
  const style = document.querySelector('[data-character-style="width"]');
  style.value = '150';
  style.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(text().characterPositions.styles.c1.width, 1.5);
  const record = JSON.stringify(text().characterPositions);
  const selected = () =>
    [...document.querySelector('[data-character-selection]').selectedOptions].map((o) => o.value);
  assert.deepEqual(selected(), ['c1', 'c2', 'c3', 'c4', 'c5']);
  await change('text-wrap-width', '600');
  assert.equal(JSON.stringify(text().characterPositions), record);
  assert.deepEqual(selected(), ['c1', 'c2', 'c3', 'c4', 'c5']);
  await change('text-wrap-width', '120');
  assert.equal(JSON.stringify(text().characterPositions), record);
  // Provisional IME remains a draft; final composition reconciles the original captured range once.
  const input = control('text');
  input.setSelectionRange(6, 10);
  input.dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'Alpha X gamma';
  input.dispatchEvent(
    new win.InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      isComposing: true,
    }),
  );
  assert.equal(text().text, 'Alpha beta gamma');
  input.dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(text().text, 'Alpha X gamma');
  assert.equal(text().characterPositions.units[0].id, 'c1');
  assert.equal(text().characterPositions.styles.c1.width, 1.5);
  const edited = saved();
  undo();
  assert.equal(text().text, 'Alpha beta gamma');
  redo();
  assert.equal(saved(), edited);
  win.nect.load(edited);
  assert.equal(saved(), edited);
  await change('text-wrap', 'off');
  assert.equal(text().textWrap, undefined);
  undo();
  assert.equal(saved(), edited);
  const locked = JSON.parse(edited);
  locked.layers[0].locked = true;
  win.nect.load(JSON.stringify(locked));
  assert.equal(control('text-wrap').disabled, true);
  assert.equal(control('text-wrap-width').disabled, true);
  const lockedBefore = saved();
  await change('text-wrap-width', '500');
  assert.equal(saved(), lockedBefore);
  assert.notEqual(initialSVG, win.nect.export());
  await win.happyDOM.close();
});
