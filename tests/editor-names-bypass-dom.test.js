import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, layer, connect, serialize } from '../src/core.js';
test('inline stable-ID names, visibility and reversible typed bypass survive selection, drafts, history and locks', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'requestAnimationFrame'])
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
      (_, p) => `from '${new URL('../src/' + p.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const tick = () => new Promise((r) => setTimeout(r, 25));
  for (let i = 0; i < 100 && !win.nect; i++) await tick();
  assert.ok(win.nect);
  const doc = newDocument(),
    l = doc.layers[0],
    shape = node('Rectangle', 40, 40),
    effect = node('Transform', 350, 40),
    fill = node('Fill', 660, 40),
    out = node('Output', 970, 40);
  shape.id = 'name-source';
  effect.id = 'name-effect';
  effect.params.offset.value = [120, 20];
  l.nodes = [shape, effect, fill, out];
  l.output = out.id;
  connect(l, shape.id, effect.id, 'path');
  connect(l, effect.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  doc.layers.push(layer('Second layer'));
  win.nect.load(serialize(doc));
  await tick();
  const saved = () => JSON.stringify(win.nect.document),
    get = (id) => win.nect.document.layers[0].nodes.find((n) => n.id === id),
    query = (s) => document.querySelector(s),
    input = () => query('[data-rename-name]');
  const key = (el, key, extra = {}) =>
    el.dispatchEvent(
      new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    );
  const type = (value) => {
    input().value = value;
    input().dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const undo = () => query('[data-action="undo"]').click(),
    redo = () => query('[data-action="redo"]').click();
  const titleClick = (id, x = 100) => {
    query(`[data-rename-node="${id}"]`).dispatchEvent(
      new win.PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: 80,
      }),
    );
    document.dispatchEvent(
      new win.PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: 80,
      }),
    );
  };
  const initial = saved(),
    originalSVG = win.nect.export();
  titleClick(effect.id);
  titleClick(effect.id);
  assert.equal(input().getAttribute('aria-label'), 'Node name');
  assert.equal(saved(), initial);
  type('  Move <日本語> & art  ');
  key(input(), 'Enter');
  assert.equal(get(effect.id).name, 'Move <日本語> & art');
  assert.equal(query('[data-rename-node="name-effect"]').textContent, 'Move <日本語> & art');
  assert.equal(query('[data-rename-node="name-effect"] img'), null);
  assert.equal(get(effect.id).id, effect.id);
  assert.deepEqual(get(effect.id).params, effect.params);
  assert.equal(win.nect.export(), originalSVG);
  const renamed = saved();
  undo();
  assert.equal(saved(), initial);
  redo();
  assert.equal(saved(), renamed);
  key(query('[data-rename-node="name-effect"]'), 'F2');
  type('cancelled');
  key(input(), 'Escape');
  assert.equal(saved(), renamed);
  key(query('[data-rename-node="name-effect"]'), 'F2');
  type('   ');
  key(input(), 'Enter');
  assert.equal(saved(), renamed);
  key(query('[data-rename-node="name-effect"]'), 'F2');
  key(input(), 'Enter');
  undo();
  assert.equal(saved(), initial);
  redo();
  key(query('[data-rename-node="name-effect"]'), 'F2');
  input().dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
  type('変換中');
  key(input(), 'Enter', { isComposing: true });
  assert.ok(input());
  assert.equal(saved(), renamed);
  input().dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
  type('変換完了');
  query('[data-action="fit"]').focus();
  await tick();
  assert.equal(get(effect.id).name, '変換完了');
  undo();
  assert.equal(saved(), renamed);
  redo();
  // Long draft survives an unrelated structural render and remains bound to its exact node.
  key(query('[data-rename-node="name-effect"]'), 'F2');
  type('A'.repeat(300));
  query('[data-collapse="name-effect"]').click();
  assert.equal(input().value, 'A'.repeat(300));
  key(input(), 'Escape');
  assert.equal(get(effect.id).name, '変換完了');
  // Unselected layer selection rerenders; the second completed click still opens its name.
  const other = doc.layers[1].id;
  query(`[data-select-layer="${other}"]`).click();
  query(`[data-select-layer="${other}"]`).click();
  assert.equal(input().getAttribute('aria-label'), 'Layer name');
  type('Background');
  key(input(), 'Enter');
  assert.equal(win.nect.document.layers[1].name, 'Background');
  query(`[data-visible="${other}"]`).click();
  assert.equal(win.nect.document.layers[1].visible, false);
  assert.equal(query(`[data-visible="${other}"]`).textContent, 'Show');
  assert.equal(query(`[data-visible="${other}"]`).getAttribute('aria-pressed'), 'false');
  assert.ok(query(`[data-layer="${other}"]`).classList.contains('is-hidden'));
  query(`[data-layer-lock="${other}"]`).click();
  key(query(`[data-select-layer="${other}"]`), 'F2');
  assert.equal(input(), null);
  query(`[data-visible="${other}"]`).click();
  assert.equal(win.nect.document.layers[1].visible, true);
  // Return to source layer, bypass the selected Transform without disconnecting or changing params.
  query(`[data-select-layer="${l.id}"]`).click();
  const beforeBypass = saved(),
    beforeSVG = win.nect.export();
  query('[data-bypass="name-effect"]').click();
  assert.equal(get(effect.id).bypassed, true);
  assert.equal(win.nect.document.schemaVersion, 10);
  assert.deepEqual(get(effect.id).params, effect.params);
  assert.notEqual(win.nect.export(), beforeSVG);
  assert.equal(query('[data-bypass="name-effect"]').getAttribute('aria-pressed'), 'true');
  assert.equal(query('[data-bypass="name-source"]').disabled, true);
  assert.match(query('[data-bypass="name-source"]').title, /identity input/);
  const bypassed = saved();
  undo();
  assert.equal(saved(), beforeBypass);
  redo();
  assert.equal(saved(), bypassed);
  titleClick(effect.id, 180);
  assert.equal(query('[data-transform-handle]'), null);
  query('[data-bypass="name-effect"]').click();
  assert.equal(get(effect.id).bypassed, undefined);
  assert.equal(win.nect.export(), beforeSVG);
  win.nect.load(bypassed);
  await tick();
  assert.equal(get(effect.id).bypassed, true);
  const locked = win.nect.document;
  locked.layers[0].locked = true;
  win.nect.load(JSON.stringify(locked));
  await tick();
  assert.equal(query('[data-bypass="name-effect"]').disabled, true);
  key(query('[data-rename-node="name-effect"]'), 'F2');
  assert.equal(input(), null);
  // Reload clears a name draft; no stale blur may rename the replacement document.
  locked.layers[0].locked = false;
  win.nect.load(JSON.stringify(locked));
  await tick();
  key(query('[data-rename-node="name-effect"]'), 'F2');
  type('stale');
  win.nect.load(initial);
  await tick();
  assert.equal(input(), null);
  assert.equal(saved(), initial);
  await win.happyDOM.close();
});
