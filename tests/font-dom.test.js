import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { document as newDocument, node, serialize } from '../src/core.js';
const buffer = async (path) => {
  const b = await fs.readFile(new URL(path, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('synthetic font UI preserves cancellation/errors/stale edits and commits reusable embedded fonts atomically', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'DOMPoint', 'requestAnimationFrame'])
    globalThis[key] = key === 'requestAnimationFrame' ? () => 0 : win[key];
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: () => buffer('../public/fonts/DejaVuSans.ttf'),
  });
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
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
  await settle();
  const doc = newDocument(),
    text = node('Text'),
    out = node('Output');
  text.text = '日本語';
  out.params.path.source = text.id;
  doc.layers[0].nodes = [text, out];
  doc.layers[0].output = out.id;
  win.nect.load(serialize(doc));
  const snapshot = () => JSON.stringify(win.nect.document);
  function start(files) {
    document.querySelector('.inspector-body [data-load-font]').click();
    const input = document.querySelector('#font-file');
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  const before = snapshot();
  start([]);
  await settle();
  assert.equal(snapshot(), before);
  start([{ name: 'broken.otf', size: 20, arrayBuffer: async () => new ArrayBuffer(20) }]);
  await settle();
  assert.equal(snapshot(), before);
  assert.match(document.querySelector('.message').textContent, /Font rejected/);
  const otf = await buffer('./fixtures/fonts/NectJPFixture-Regular.otf');
  const fontFile = { name: 'font.otf', size: otf.byteLength, arrayBuffer: async () => otf };
  start([fontFile]);
  await settle();
  assert.equal(Object.keys(win.nect.document.fontAssets).length, 1);
  assert.equal(win.nect.evaluate().error, null);
  const imported = snapshot(),
    importedSVG = win.nect.export();
  start([fontFile]);
  await settle();
  assert.equal(snapshot(), imported);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(snapshot(), before);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(win.nect.export(), importedSVG);
  const direction = document.querySelector('.inspector-body [data-writing-mode]');
  direction.value = 'vertical-rl';
  direction.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
  assert.notEqual(win.nect.export(), importedSVG);
  const saved = snapshot(),
    svg = win.nect.export();
  win.nect.load(saved);
  assert.equal(win.nect.export(), svg);
  let finish;
  start([
    {
      ...fontFile,
      arrayBuffer: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  ]);
  const textarea = document.querySelector('.inspector-body [data-text]');
  textarea.value = '世界麺';
  textarea.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
  const changed = snapshot();
  finish(otf);
  await settle();
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Document changed while reading/);
  // A valid font lacking the active Japanese glyphs must not replace the working font.
  const latin = await buffer('../public/fonts/DejaVuSans.ttf');
  start([{ name: 'latin.ttf', size: latin.byteLength, arrayBuffer: async () => latin }]);
  await settle();
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Missing glyphs/);
  // Import into a locked composition is not allowed to open or change it.
  win.nect.document.layers[0].locked = true;
  document.querySelector('.inspector-body [data-load-font]').click();
  assert.match(document.querySelector('.message').textContent, /locked/);
  await win.happyDOM.close();
});
