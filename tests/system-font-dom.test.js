import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, serialize } from '../src/core.js';
const buffer = async (path) => {
  const b = await fs.readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('installed font selection is lazy, atomic, reusable and stale-safe', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'DOMPoint', 'requestAnimationFrame'])
    globalThis[key] = key === 'requestAnimationFrame' ? () => 0 : win[key];
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: () => buffer('../public/fonts/DejaVuSans.ttf'),
  });
  let calls = 0;
  globalThis.readInstalledTestFont = async () => {
    calls++;
    return buffer('./fixtures/fonts/NectJPFixture-Regular.otf');
  };
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      /import \{ desktop, saveFile, openFile, listSystemFonts, readSystemFont \} from '.\/storage.js';/,
      `const desktop = true, saveFile = async () => true, openFile = async () => null, listSystemFonts = async () => [['system-0', 'Japanese fixture', null], ['system-1', 'Variable face', 'Variable fonts unsupported']], readSystemFont = (id) => globalThis.readInstalledTestFont(id);`,
    );
  for (const name of ['core', 'focus', 'layout', 'svg-import', 'fonts', 'images', 'raster'])
    source = source.replace(
      `from './${name}.js'`,
      `from '${new URL(`../src/${name}.js`, import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const settle = () => new Promise((r) => setTimeout(r, 30));
  await settle();
  assert.equal(calls, 0);
  const doc = newDocument(),
    text = node('Text'),
    out = node('Output');
  text.text = '日本語';
  out.params.path.source = text.id;
  doc.layers[0].nodes = [text, out];
  doc.layers[0].output = out.id;
  win.nect.load(serialize(doc));
  const snapshot = () => JSON.stringify(win.nect.document);
  const select = (id = 'system-0') => {
    const el = document.querySelector('.inspector-body [data-system-font]');
    el.value = id;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  assert.equal(
    document.querySelector('[data-system-font] option[value="system-1"]').disabled,
    true,
  );
  const before = snapshot();
  select();
  await settle();
  assert.equal(calls, 1);
  assert.equal(win.nect.evaluate().error, null);
  assert.equal(Object.keys(win.nect.document.fontAssets).length, 1);
  const saved = snapshot(),
    svg = win.nect.export();
  select();
  await settle();
  assert.equal(snapshot(), saved);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(snapshot(), before);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(win.nect.export(), svg);
  win.nect.load(saved);
  assert.equal(win.nect.export(), svg);
  let finish;
  globalThis.readInstalledTestFont = () =>
    new Promise((r) => {
      finish = r;
    });
  select();
  const textarea = document.querySelector('.inspector-body [data-text]');
  textarea.value = '世界';
  textarea.dispatchEvent(new win.Event('change', { bubbles: true }));
  const changed = snapshot();
  finish(await buffer('./fixtures/fonts/NectJPFixture-Regular.otf'));
  await settle();
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Document changed/);
  globalThis.readInstalledTestFont = async () => {
    throw Error('Font file was removed');
  };
  select();
  await settle();
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Font file was removed/);
  globalThis.readInstalledTestFont = async () => new ArrayBuffer(12);
  select();
  await settle();
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Font rejected/);
  win.happyDOM.abort();
});
