import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('synthetic editor DOM: sockets, pen, handles, multi-selection, locks, undo and reload', async () => {
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
  let doc = win.nect.document,
    circle = doc.layers[0].nodes[0];
  assert.equal(document.querySelectorAll('.node').length, 6);
  assert.ok(document.querySelector('.shape').getAttribute('d'));
  let radius = document.querySelector(
    `.graph [data-node="${circle.id}"][data-key="radius"] [data-value]`,
  );
  radius.value = '60';
  radius.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value, 60);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value, 120);
  let add = document.querySelector('#add-node');
  add.value = 'Value';
  add.dispatchEvent(new win.Event('change', { bubbles: true }));
  let value = win.nect.document.layers[0].nodes.at(-1);
  document
    .querySelector(`[data-source="${value.id}"]`)
    .dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  document
    .querySelector(`.graph [data-node="${circle.id}"][data-key="radius"]`)
    .dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true }));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source, value.id);
  assert.equal(
    document.querySelectorAll(`.graph [data-node="${circle.id}"][data-key="radius"] .input`).length,
    1,
  );
  document
    .querySelector(`.graph [data-node="${circle.id}"][data-key="radius"] .input`)
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source, undefined);
  let old = win.nect.export(),
    serialized = JSON.stringify(win.nect.document);
  document.querySelector('.graph-scroll').scrollLeft = 250;
  document.querySelector('.graph-scroll').scrollTop = 500;
  win.nect.load(serialized);
  assert.equal(document.querySelector('.graph-scroll').scrollLeft, 0);
  assert.equal(document.querySelector('.graph-scroll').scrollTop, 0);
  assert.equal(win.nect.export(), old);
  assert.throws(() => win.nect.load('{"schemaVersion":99}'));
  assert.equal(win.nect.export(), old);
  document.querySelector('[data-action="add-layer"]').click();
  assert.equal(win.nect.document.layers.length, 2);
  assert.equal(document.querySelectorAll('.layer').length, 2);
  const pointer = (target, type, x = 0, y = 0, extra = {}) =>
    target.dispatchEvent(
      new win.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }),
    );
  // Synthetic identity CTM exercises the actual event handlers, not browser layout.
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointerup', 100, 100);
  pointer(document.querySelector('.artboard'), 'pointerdown', 300, 100);
  pointer(document, 'pointermove', 330, 130);
  pointer(document, 'pointerup', 330, 130);
  pointer(document.querySelector('.artboard'), 'pointerdown', 200, 300);
  pointer(document, 'pointerup', 200, 300);
  assert.equal(win.nect.document.layers.length, 2, 'unfinished Pen stays detached');
  const firstVertex = document.querySelector('.vertex').dataset.point;
  pointer(document.querySelector(`.vertex[data-point="${firstVertex}"]`), 'pointerdown', 100, 100);
  pointer(document, 'pointerup', 100, 100);
  let curve = win.nect.document.layers.at(-1).nodes[0];
  assert.equal(curve.points.length, 3);
  assert.deepEqual(curve.points[1].handleB.value, [30, 30]);
  assert.equal(curve.params.closed.value, true);
  pointer(document.querySelector(`.node[data-id="${curve.id}"] .node-head`), 'pointerdown');
  pointer(document, 'pointerup');
  curve.points[0].position.locked = true;
  pointer(
    document.querySelector(`.vertex[data-point="${curve.points[0].id}"]`),
    'pointerdown',
    100,
    100,
  );
  pointer(document, 'pointermove', 150, 150);
  pointer(document, 'pointerup', 150, 150);
  assert.deepEqual(curve.points[0].position.value, [100, 100]);
  document.querySelector(`[data-select-layer="${win.nect.document.layers[1].id}"]`).click();
  let [circle2, rectangle2] = win.nect.document.layers[1].nodes;
  pointer(document.querySelector(`.node[data-id="${circle2.id}"] .node-head`), 'pointerdown');
  pointer(document, 'pointerup');
  pointer(
    document.querySelector(`.node[data-id="${rectangle2.id}"] .node-head`),
    'pointerdown',
    0,
    0,
    { shiftKey: true },
  );
  pointer(document, 'pointerup');
  assert.equal(document.querySelectorAll('.node.selected').length, 2);
  const centers = [...circle2.params.center.value, ...rectangle2.params.center.value];
  pointer(document.querySelector('[data-node-stage-move]'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 110, 120);
  pointer(document, 'pointerup', 110, 120);
  assert.deepEqual(circle2.params.center.value, [centers[0] + 10, centers[1] + 20]);
  assert.deepEqual(rectangle2.params.center.value, [centers[2] + 10, centers[3] + 20]);
  rectangle2.params.center.locked = true;
  const unchanged = JSON.stringify(win.nect.document);
  pointer(document.querySelector('[data-node-stage-move]'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 150, 150);
  pointer(document, 'pointerup', 150, 150);
  assert.equal(JSON.stringify(win.nect.document), unchanged);
  // Undoing a pen-created node must not leave a stale drawing target.
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 400, 100);
  pointer(document, 'pointerup', 400, 100);
  document.querySelector('[data-action="undo"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 410, 110);
  pointer(document, 'pointerup', 410, 110);
  assert.equal(document.querySelector('.vertex').getAttribute('cx'), '410');
  document
    .querySelector('.canvas-stage')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  add = document.querySelector('#add-node');
  add.value = 'Fill';
  add.dispatchEvent(new win.Event('change', { bubbles: true }));
  let transform = win.nect.document.layers[1].nodes.at(-1),
    outputId = win.nect.document.layers[1].output;
  let pathSelect = document.querySelector(
    `.node[data-id="${transform.id}"] [data-key="path"] select`,
  );
  pathSelect.value = outputId;
  pathSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  let beforeCycle = JSON.stringify(win.nect.document);
  document.querySelector(`[data-preview="${transform.id}"]`).click();
  assert.equal(JSON.stringify(win.nect.document), beforeCycle);
  assert.match(document.querySelector('.message').textContent, /cycle/);
  document.querySelector(`.node[data-id="${outputId}"] [data-key="path"] [data-lock]`).click();
  let lockedOutput = JSON.stringify(win.nect.document);
  document.querySelector('[data-tool="Circle"]').click();
  assert.equal(win.nect.document.layers.length, JSON.parse(lockedOutput).layers.length + 1);
  assert.deepEqual(win.nect.document.layers.slice(0, -1), JSON.parse(lockedOutput).layers);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(JSON.stringify(win.nect.document), lockedOutput);
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 50, 50);
  pointer(document, 'pointerup', 50, 50);
  assert.equal(JSON.stringify(win.nect.document), lockedOutput);

  // Cancellation rolls back provisional edits without consuming undo or redo history.
  win.nect.load(serialized);
  document.querySelector('[data-tool="select"]').click();
  radius = document.querySelector(
    `.graph [data-node="${circle.id}"][data-key="radius"] [data-value]`,
  );
  radius.value = '75';
  radius.dispatchEvent(new win.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const committed = JSON.stringify(win.nect.document);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(JSON.stringify(win.nect.document), serialized);
  const cancelAndCheck = (before) => {
    pointer(document, 'pointercancel');
    assert.equal(JSON.stringify(win.nect.document), before);
    pointer(document, 'pointermove', 700, 600);
    pointer(document, 'pointerup', 700, 600);
    assert.equal(JSON.stringify(win.nect.document), before);
  };
  pointer(document.querySelector('[data-node-stage-move]'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 150, 170);
  assert.notEqual(JSON.stringify(win.nect.document), serialized);
  cancelAndCheck(serialized);
  assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  assert.equal(document.querySelector('[data-action="redo"]').disabled, false);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(JSON.stringify(win.nect.document), committed);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(JSON.stringify(win.nect.document), serialized);

  // Node layout uses the same transaction boundary; a cancelled move cannot resume.
  pointer(document.querySelector(`.node[data-id="${circle.id}"] .node-head`), 'pointerdown');
  pointer(document, 'pointermove', 80, 60);
  assert.notEqual(JSON.stringify(win.nect.document), serialized);
  cancelAndCheck(serialized);

  // A cancelled first Pen point removes its new node and restores Output routing.
  document.querySelector('[data-tool="pen"]').click();
  pointer(document.querySelector('.artboard'), 'pointerdown', 100, 100);
  pointer(document, 'pointermove', 130, 120);
  cancelAndCheck(serialized);
  pointer(document.querySelector('.artboard'), 'pointerdown', 200, 100);
  pointer(document, 'pointerup', 200, 100);
  assert.equal(JSON.stringify(win.nect.document), serialized, 'released point is still a draft');
  pointer(document.querySelector('.artboard'), 'pointerdown', 300, 150);
  pointer(document, 'pointerup', 300, 150);
  document
    .querySelector('.canvas-stage')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const firstPoint = JSON.stringify(win.nect.document);
  assert.deepEqual(win.nect.document.layers.at(-1).nodes[0].points[0].position.value, [200, 100]);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(JSON.stringify(win.nect.document), serialized);
  document.querySelector('[data-action="redo"]').click();
  assert.equal(JSON.stringify(win.nect.document), firstPoint);

  // Cancelling a vertex move preserves the prior committed Pen history.
  const penNodeId = win.nect.document.layers.at(-1).nodes[0].id;
  pointer(document.querySelector(`.node[data-id="${penNodeId}"] .node-head`), 'pointerdown');
  pointer(document, 'pointerup');
  document
    .querySelector('.canvas-stage')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const vertex = document.querySelector('.vertex');
  pointer(vertex, 'pointerdown', 200, 100);
  pointer(document, 'pointermove', 230, 140);
  assert.notEqual(JSON.stringify(win.nect.document), firstPoint);
  cancelAndCheck(firstPoint);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(JSON.stringify(win.nect.document), serialized);

  // Cancelling a connection clears its highlight and ignores a later target release.
  win.nect.load(serialized);
  pointer(document.querySelector(`[data-source="${value.id}"]`), 'pointerdown');
  assert.ok(document.querySelectorAll('.compatible').length > 0);
  pointer(document, 'pointercancel');
  assert.equal(document.querySelectorAll('.compatible').length, 0);
  pointer(
    document.querySelector(`.graph [data-node="${circle.id}"][data-key="radius"]`),
    'pointerup',
  );
  assert.equal(JSON.stringify(win.nect.document), serialized);
  assert.equal(document.querySelector('[data-action="undo"]').disabled, true);

  // Collapsing is persisted editor state; compact inputs keep their original graph keys.
  const bool = win.nect.document.layers[0].nodes.find((n) => n.type === 'Boolean');
  const boolPosition = [...bool.position];
  const beforeCollapse = win.nect.export();
  const selectedBefore = document.querySelector('.node.selected').dataset.id;
  document.querySelector(`[data-collapse="${bool.id}"]`).click();
  assert.equal(win.nect.document.layers[0].nodes.find((n) => n.id === bool.id).collapsed, true);
  assert.equal(
    document.querySelector(`.node[data-id="${bool.id}"]`).classList.contains('collapsed'),
    true,
  );
  assert.equal(document.querySelectorAll(`.node[data-id="${bool.id}"] .input`).length, 2);
  assert.equal(document.querySelector(`.node[data-id="${bool.id}"] select`), null);
  assert.equal(document.querySelector('.node.selected').dataset.id, selectedBefore);
  assert.equal(win.nect.export(), beforeCollapse);
  document.querySelector('[data-action="undo"]').click();
  assert.equal(win.nect.document.layers[0].nodes.find((n) => n.id === bool.id).collapsed, false);
  document.querySelector('[data-action="redo"]').click();
  pointer(document.querySelector(`[data-source="${circle.id}"]`), 'pointerdown');
  pointer(document.querySelector(`.graph [data-node="${bool.id}"][data-key="b"]`), 'pointerup');
  assert.equal(
    win.nect.document.layers[0].nodes.find((n) => n.id === bool.id).params.b.source,
    circle.id,
  );
  const collapsedSaved = JSON.stringify(win.nect.document);
  win.nect.load(collapsedSaved);
  assert.equal(
    document.querySelector(`[data-collapse="${bool.id}"]`).getAttribute('aria-expanded'),
    'false',
  );
  document
    .querySelector(`.graph [data-node="${bool.id}"][data-key="b"] .input`)
    .dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true }));
  assert.equal(
    document.querySelector(`.graph [data-node="${bool.id}"][data-key="b"] .input`),
    null,
  );
  const rectangleId = win.nect.document.layers[0].nodes.find((n) => n.type === 'Rectangle').id;
  pointer(document.querySelector(`[data-source="${rectangleId}"]`), 'pointerdown');
  const available = document.querySelector(`.graph [data-node="${bool.id}"][data-key="b"]`);
  assert.equal(available.classList.contains('compatible'), true);
  pointer(available, 'pointerup');
  assert.equal(document.querySelectorAll(`.node[data-id="${bool.id}"] .input`).length, 2);
  document.querySelector(`[data-collapse="${bool.id}"]`).click();
  assert.ok(document.querySelector(`.node[data-id="${bool.id}"] [data-operation]`));
  assert.deepEqual(
    win.nect.document.layers[0].nodes.find((n) => n.id === bool.id).position,
    boolPosition,
  );
  assert.equal(win.nect.document.layers[0].nodes.find((n) => n.id === bool.id).width, bool.width);
  await win.happyDOM.close();
});
