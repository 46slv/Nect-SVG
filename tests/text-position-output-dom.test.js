import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Text Position UI: typed sockets, source labels, cancellation, snap ownership, deletion and duplication history', async () => {
  const win = new Window({ url: 'http://localhost:5173' });
  win.document.body.innerHTML = '<div id="app"></div>';
  for (const key of ['window', 'document', 'HTMLElement', 'DOMPoint', 'requestAnimationFrame'])
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
  win.SVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => {
      let b = await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
  let source = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  source = source
    .replace("import './style.css';", '')
    .replace(
      "from './artwork-gap-distribution.js'",
      `from '${new URL('../src/artwork-gap-distribution.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-distribution.js'",
      `from '${new URL('../src/artwork-distribution.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-alignment.js'",
      `from '${new URL('../src/artwork-alignment.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-multi-move.js'",
      `from '${new URL('../src/artwork-multi-move.js', import.meta.url)}'`,
    )
    .replace("from './images.js'", `from '${new URL('../src/images.js', import.meta.url)}'`)
    .replace("from './raster.js'", `from '${new URL('../src/raster.js', import.meta.url)}'`)
    .replace("from './focus.js'", `from '${new URL('../src/focus.js', import.meta.url)}'`)
    .replace("from './layout.js'", `from '${new URL('../src/layout.js', import.meta.url)}'`)
    .replace("from './core.js'", `from '${new URL('../src/core.js', import.meta.url)}'`)
    .replace(
      "from './artwork-creation.js'",
      `from '${new URL('../src/artwork-creation.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-move-target.js'",
      `from '${new URL('../src/artwork-move-target.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-deletion.js'",
      `from '${new URL('../src/artwork-deletion.js', import.meta.url)}'`,
    )
    .replace(
      "from './artwork-ordering.js'",
      `from '${new URL('../src/artwork-ordering.js', import.meta.url)}'`,
    )
    .replace("from './svg-import.js'", `from '${new URL('../src/svg-import.js', import.meta.url)}'`)
    .replace("from './storage.js'", `from '${new URL('../src/storage.js', import.meta.url)}'`)
    .replace("from './fonts.js'", `from '${new URL('../src/fonts.js', import.meta.url)}'`);
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await new Promise((r) => setTimeout(r, 100));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const change = async (el, value) => {
    el.value = value;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const add = async (type) => {
    await change(document.querySelector('#add-node'), type);
    return win.nect.document.layers[0].nodes.at(-1).id;
  };
  const { document: makeDoc, node, connect, guideDefaults } = await import('../src/core.js');
  const doc = makeDoc(),
    l = doc.layers[0],
    a = node('Text'),
    b = node('Text'),
    fill = node('Fill'),
    out = node('Output');
  a.name = 'Master';
  a.params.position.value = [500, 300];
  a.alignment = 'end';
  b.name = 'Follower';
  b.params.position.value = [100, 200];
  b.params.position.expression = '110; 210';
  l.nodes = [a, b, fill, out];
  l.output = out.id;
  connect(l, b.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  doc.editor = {
    ...guideDefaults(),
    snap: true,
    snapGrid: false,
    snapArtboard: false,
    guides: [{ id: 'guide-master', axis: 'x', position: 520, locked: false }],
  };
  const load = () => win.nect.load(JSON.stringify(doc));
  load();
  const get = (id) => win.nect.document.layers[0].nodes.find((n) => n.id === id);
  const field = (id, key) =>
    document.querySelector(`.graph .field[data-node="${id}"][data-key="${key}"]`);
  const socket = (id, port) =>
    document.querySelector(
      `[data-source="${id}"]${port ? `[data-source-port="${port}"]` : ':not([data-source-port])'}`,
    );
  const fire = (el, type, x = 100, y = 100) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: y,
      }),
    );
  const wire = (from, to, key, port) => {
    fire(socket(from, port), 'pointerdown');
    fire(field(to, key), 'pointerup');
  };
  const position = (id) => win.nect.evaluate().run(id, 'position');
  const undo = () => document.querySelector('[data-action="undo"]').click();
  const redo = () => document.querySelector('[data-action="redo"]').click();
  const select = (id) => {
    fire(document.querySelector(`.node[data-id="${id}"] strong`), 'pointerdown');
    fire(document, 'pointerup');
  };
  assert.equal(socket(a.id).getAttribute('aria-label'), 'Master Path output');
  assert.equal(socket(a.id, 'position').getAttribute('aria-label'), 'Master Position output');
  assert.match(socket(a.id, 'position').title, /Vector2.*before downstream Transform/);
  fire(socket(a.id, 'position'), 'pointerdown');
  assert.ok(field(b.id, 'position').classList.contains('compatible'));
  assert.equal(field(b.id, 'size').classList.contains('compatible'), false);
  assert.equal(field(fill.id, 'path').classList.contains('compatible'), false);
  document
    .querySelector('.graph-scroll')
    .dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(document.querySelector('.wire-preview'), null);
  assert.equal(get(b.id).params.position.source, undefined);
  wire(a.id, b.id, 'position', 'position');
  assert.deepEqual(position(b.id), [500, 300]);
  assert.equal(get(b.id).params.position.sourcePort, 'position');
  assert.match(field(b.id, 'position').textContent, /Master Position.*connected value/);
  assert.equal(field(b.id, 'position').querySelector('[data-value]').disabled, true);
  field(b.id, 'position').querySelector('[data-connect-menu]').click();
  const menu = document.querySelector('dialog select');
  assert.ok([...menu.options].some((o) => o.value === JSON.stringify([a.id, 'position'])));
  assert.equal(
    [...menu.options].some((o) => o.value === a.id),
    false,
  );
  document.querySelector('[data-cancel]').click();
  assert.equal(document.querySelector('dialog'), null);
  assert.deepEqual(position(b.id), [500, 300]);
  // Collapse preserves both outputs, the named edge and the wire's source identity.
  document.querySelector(`[data-collapse="${a.id}"]`).click();
  assert.ok(socket(a.id));
  assert.ok(socket(a.id, 'position'));
  wire(a.id, b.id, 'position', 'position');
  field(b.id, 'position')
    .querySelector('.input')
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  assert.deepEqual(position(b.id), [110, 210]);
  undo();
  assert.deepEqual(position(b.id), [500, 300]);
  redo();
  assert.deepEqual(position(b.id), [110, 210]);
  // Menu reconnection and repeated cancel leave actual state in agreement with the UI.
  field(b.id, 'position').querySelector('[data-connect-menu]').click();
  document.querySelector('dialog select').value = JSON.stringify([a.id, 'position']);
  document.querySelector('[data-confirm]').click();
  const connected = JSON.stringify(win.nect.document);
  fire(socket(b.id, 'position'), 'pointerdown');
  fire(field(a.id, 'position'), 'pointerup');
  assert.equal(JSON.stringify(win.nect.document), connected, 'cycle rejection is atomic');
  // The source owns canvas snapping. Followers cannot write through to the source.
  select(a.id);
  fire(document.querySelector('[data-node-stage-move]'), 'pointerdown', 100, 100);
  fire(document, 'pointermove', 119, 100);
  fire(document, 'pointerup', 119, 100);
  assert.deepEqual(position(a.id), [520, 300]);
  assert.deepEqual(position(b.id), [520, 300]);
  const beforeFollower = JSON.stringify(win.nect.document);
  select(b.id);
  fire(document.querySelector('[data-node-stage-move]'), 'pointerdown', 100, 100);
  fire(document, 'pointermove', 150, 130);
  fire(document, 'pointerup', 150, 130);
  assert.equal(JSON.stringify(win.nect.document), beforeFollower);
  undo();
  assert.deepEqual(position(a.id), [500, 300]);
  redo();
  assert.deepEqual(position(b.id), [520, 300]);
  // Duplicate keeps external references; duplicating the source does not redirect followers.
  document.querySelector(`[data-duplicate="${b.id}"]`).click();
  const copy = win.nect.document.layers[0].nodes.at(-1);
  assert.equal(copy.params.position.source, a.id);
  assert.equal(copy.params.position.sourcePort, 'position');
  assert.deepEqual(position(copy.id), [520, 300]);
  undo();
  assert.equal(get(copy.id), undefined);
  redo();
  assert.equal(get(copy.id).params.position.source, a.id);
  document.querySelector(`[data-delete="${a.id}"]`).click();
  for (const id of [b.id, copy.id]) {
    assert.equal(get(id).params.position.source, undefined);
    assert.equal(get(id).params.position.sourcePort, undefined);
    assert.deepEqual(position(id), [110, 210]);
  }
  undo();
  assert.deepEqual(position(b.id), [520, 300]);
  assert.deepEqual(position(copy.id), [520, 300]);
  const saved = JSON.stringify(win.nect.document);
  win.nect.load(saved);
  assert.equal(get(b.id).params.position.sourcePort, 'position');
  assert.deepEqual(position(b.id), [520, 300]);
  // A rename changes the human label, never the stable ID reference.
  const renamed = JSON.parse(saved);
  renamed.layers[0].nodes.find((n) => n.id === a.id).name = 'Renamed source';
  win.nect.load(JSON.stringify(renamed));
  assert.match(field(b.id, 'position').textContent, /Renamed source Position/);
  assert.deepEqual(position(b.id), [520, 300]);
  const locked = JSON.parse(saved);
  locked.layers[0].nodes.find((n) => n.id === a.id).params.position.locked = true;
  win.nect.load(JSON.stringify(locked));
  const beforeLocked = JSON.stringify(win.nect.document);
  fire(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  fire(document, 'pointermove', 130, 100);
  fire(document, 'pointerup', 130, 100);
  assert.equal(JSON.stringify(win.nect.document), beforeLocked);
  win.happyDOM.abort();
});
