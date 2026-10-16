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
  globalThis.readInstalledTestFont = async (id) => {
    calls++;
    return buffer(
      id === 'system-2'
        ? '../public/fonts/DejaVuSans.ttf'
        : './fixtures/fonts/NectJPFixture-Regular.otf',
    );
  };
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      /import \{ desktop, saveFile, openFile, listSystemFonts, readSystemFont \} from '.\/storage.js';/,
      `const desktop = true, saveFile = async () => true, openFile = async () => null, listSystemFonts = async () => [['system-0', 'Japanese fixture', null], ['system-1', 'Variable face', 'Variable fonts unsupported'], ['system-2', 'DejaVu Sans', null]], readSystemFont = (id) => globalThis.readInstalledTestFont(id);`,
    );
  for (const name of [
    'artwork-creation',
    'artwork-move-target',
    'artwork-multi-move',
    'artwork-alignment',
    'artwork-distribution',
    'artwork-gap-distribution',
    'artwork-deletion',
    'artwork-ordering',
    'core',
    'focus',
    'layout',
    'svg-import',
    'fonts',
    'images',
    'raster',
  ])
    source = source.replace(
      `from './${name}.js'`,
      `from '${new URL(`../src/${name}.js`, import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const until = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'Timed out waiting for font operation');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await until(() => !!win.nect);
  assert.equal(calls, 0);
  const doc = newDocument(),
    text = node('Text'),
    out = node('Output');
  text.text = 'Abg 123';
  out.params.path.source = text.id;
  doc.layers[0].nodes = [text, out];
  doc.layers[0].output = out.id;
  win.nect.load(serialize(doc));
  const snapshot = () => JSON.stringify(win.nect.document);
  const select = (id = 'system-0') => {
    document.querySelector('.message').textContent = '';
    const el = document.querySelector('.inspector-body [data-font]');
    el.value = id;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  assert.equal(document.querySelector('[data-font] option[value="system-1"]').disabled, true);
  assert.equal(
    document.querySelectorAll('.inspector-body select[aria-label="Text font"]').length,
    1,
  );
  assert.equal(document.querySelectorAll('[data-system-font]').length, 0);
  const before = snapshot();
  select();
  await until(() => /Loaded /.test(document.querySelector('.message').textContent));
  assert.equal(calls, 1);
  assert.equal(win.nect.evaluate().error, null);
  assert.equal(Object.keys(win.nect.document.fontAssets).length, 1);
  const saved = snapshot(),
    svg = win.nect.export();
  select();
  await until(() => /Loaded /.test(document.querySelector('.message').textContent));
  assert.equal(snapshot(), saved);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(snapshot(), before);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(win.nect.export(), svg);
  win.nect.load(saved);
  assert.equal(win.nect.export(), svg);
  // Switching installed fonts must change actual outline geometry, not just labels.
  const firstPath = JSON.stringify(win.nect.evaluate().path);
  select('system-2');
  await until(() => /Loaded DejaVu/.test(document.querySelector('.message').textContent));
  const second = snapshot(),
    secondSvg = win.nect.export();
  assert.notEqual(JSON.stringify(win.nect.evaluate().path), firstPath);
  assert.notEqual(secondSvg, svg);
  assert.equal(
    document.querySelector('.inspector-body [data-font] option[selected]').value,
    win.nect.document.layers[0].nodes.find((n) => n.type === 'Text').font,
  );
  document.querySelector('[data-action="undo"]').click();
  assert.equal(win.nect.export(), svg);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(win.nect.export(), secondSvg);
  win.nect.load(second);
  assert.equal(win.nect.export(), secondSvg);
  let finish;
  globalThis.readInstalledTestFont = () =>
    new Promise((r) => {
      finish = r;
    });
  select();
  assert.equal(document.querySelector('.inspector-body [data-font]').disabled, true);
  assert.match(
    document.querySelector('.inspector-body [role="status"]').textContent,
    /Loading font/,
  );
  const textarea = document.querySelector('.inspector-body [data-text]');
  textarea.value = '世界';
  textarea.dispatchEvent(new win.Event('change', { bubbles: true }));
  const changed = snapshot();
  finish(await buffer('./fixtures/fonts/NectJPFixture-Regular.otf'));
  await until(() => /Document changed/.test(document.querySelector('.message').textContent));
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Document changed/);
  globalThis.readInstalledTestFont = async () => {
    throw Error('Font file was removed');
  };
  select();
  await until(() => /Font file was removed/.test(document.querySelector('.message').textContent));
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Font file was removed/);
  assert.equal(document.querySelector('.inspector-body [data-font]').disabled, false);
  assert.equal(
    document.querySelector('.inspector-body [data-font] option[selected]').value,
    win.nect.document.layers[0].nodes.find((n) => n.type === 'Text').font,
  );
  globalThis.readInstalledTestFont = async () => new ArrayBuffer(12);
  select();
  await until(() => /Font rejected/.test(document.querySelector('.message').textContent));
  assert.equal(snapshot(), changed);
  assert.match(document.querySelector('.message').textContent, /Font rejected/);
  win.happyDOM.abort();
});
