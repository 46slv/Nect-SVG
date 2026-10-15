import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, point, serialize } from '../src/core.js';
const buffer = async (path) => {
  const b = await fs.readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('Type on Path controls attach/edit/detach atomically with schema, locks, source identity and history', async () => {
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
  t.text = 'TYPE';
  t.params.size.value = 40;
  t.params.position.value = [100, 250];
  c.points = [point(30, 100), point(630, 100)];
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
      if (typeof value === 'boolean') el.checked = value;
      else el.value = value;
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      await tick();
    },
    undo = () => document.querySelector('[data-action="undo"]').click(),
    redo = () => document.querySelector('[data-action="redo"]').click();
  const before = saved(),
    flatSVG = win.nect.export();
  await change('text-path', JSON.stringify([c.id, c.id]));
  assert.equal(win.nect.document.schemaVersion, 7);
  assert.equal(text().pathAttachment.nodeId, c.id);
  assert.notEqual(win.nect.export(), flatSVG);
  const attached = saved();
  undo();
  assert.equal(saved(), before);
  redo();
  assert.equal(saved(), attached);
  await change('text-path-start', '.5');
  await change('text-alignment', 'center');
  const centered = saved(),
    currentSVG = win.nect.export();
  await change('text-path-mode', 'distance');
  assert.ok(Math.abs(text().pathAttachment.start - 300) < 1e-7);
  assert.equal(win.nect.export(), currentSVG);
  await change('text-path-reversed', true);
  assert.ok(win.nect.evaluate().textLayout(t.id).placements[0].tangent[0] < 0);
  const reversed = saved();
  await change('text-path-start', '-999');
  assert.equal(saved(), reversed);
  assert.match(document.querySelector('.status .message').textContent, /OVERFLOW/);
  await change('text-path-start', '');
  assert.equal(saved(), reversed);
  await change('writing-mode', 'vertical-rl');
  assert.equal(saved(), reversed);
  assert.match(document.querySelector('.status .message').textContent, /horizontal/);
  await change('text', 'A\nB');
  assert.equal(saved(), reversed);
  assert.match(document.querySelector('.status .message').textContent, /one line/);
  const ta = control('text');
  ta.setSelectionRange(0, 1);
  ta.dispatchEvent(new win.Event('select', { bubbles: true }));
  document.querySelector('.inspector-body [data-style-text-range]').click();
  await change('character-axis', '9');
  assert.equal(text().characterPositions.offsets.c1[0], 9);
  assert.match(
    document.querySelector('.inspector-body').textContent,
    /Canvas character dragging is unavailable/,
  );
  const adjusted = saved();
  await change('text-path', '');
  assert.equal(text().pathAttachment, undefined);
  assert.deepEqual(text().params.position.value, [100, 250]);
  undo();
  assert.equal(saved(), adjusted);
  win.nect.load(adjusted);
  assert.equal(saved(), adjusted);
  document.querySelector(`.graph [data-delete="${c.id}"]`).click();
  assert.equal(saved(), adjusted);
  assert.match(document.querySelector('.status .message').textContent, /Missing source/);
  const locked = JSON.parse(adjusted);
  locked.layers[0].locked = true;
  win.nect.load(JSON.stringify(locked));
  assert.equal(control('text-path').disabled, true);
  assert.equal(control('text-path-start').disabled, true);
  assert.notEqual(centered, attached);
  await win.happyDOM.close();
});
