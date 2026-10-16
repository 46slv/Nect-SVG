import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('Artboard pan owns its pointer and leaves artwork and history unchanged', async () => {
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
  const fire = (el, type, x = 100, y = 100, button = 1, pointerId = 1) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button,
        pointerId,
      }),
    );
  const key = (el, type, code) =>
    el.dispatchEvent(
      new win.KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        code,
        key: code === 'Space' ? ' ' : code,
      }),
    );
  const stage = () => document.querySelector('.canvas-stage');
  const view = () => document.querySelector('.artboard').style.transform;
  const fit = () => document.querySelector('[data-action="fit"]').click();
  const saved = JSON.stringify(win.nect.document);
  const selected = () => [...document.querySelectorAll('.node.selected')].map((n) => n.dataset.id);
  const selection = selected();
  const intact = () => {
    assert.equal(JSON.stringify(win.nect.document), saved);
    assert.deepEqual(selected(), selection);
    assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  };
  for (const button of [1, 0]) {
    fit();
    document.querySelector('[data-action="zoom-in"]').click();
    if (!button) key(document.body, 'keydown', 'Space');
    fire(document.querySelector('.shape'), 'pointerdown', 100, 100, button);
    fire(document, 'pointermove', 160, 130, button, 2);
    assert.equal(view(), 'translate(0px,0px)');
    fire(document, 'pointerup', 160, 130, button, 2);
    fire(document, 'pointercancel', 160, 130, button, 2);
    fire(document, 'pointermove', 160, 130, button);
    assert.equal(view(), 'translate(60px,30px)');
    fire(document, 'pointerup', 160, 130, button);
    key(document.body, 'keyup', 'Space');
    fire(document, 'pointermove', 200, 200, button);
    assert.equal(view(), 'translate(60px,30px)');
    intact();
  }
  for (const end of ['pointercancel', 'lostpointercapture', 'Escape', 'blur']) {
    fit();
    fire(stage(), 'pointerdown');
    fire(document, 'pointermove', 125, 140);
    if (end === 'Escape') key(stage(), 'keydown', end);
    else if (end === 'blur') win.dispatchEvent(new win.Event('blur'));
    else fire(end === 'lostpointercapture' ? stage() : document, end, 125, 140);
    fire(document, 'pointermove', 200, 200);
    assert.equal(view(), 'translate(25px,40px)', end + ' retains current view and stops');
    intact();
  }
  fit();
  fire(stage(), 'pointerdown', 100, 100, 2);
  fire(document, 'pointermove', 200, 200, 2);
  fire(document, 'pointerup', 200, 200, 2);
  assert.equal(view(), 'translate(0px,0px)');
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    const el = document.createElement(tag);
    if (tag === 'div') {
      el.contentEditable = 'true';
      el.innerHTML = '<span>editable child</span>';
    }
    document.body.append(el);
    const target = el.firstElementChild || el;
    assert.equal(key(target, 'keydown', 'Space'), true, 'typing Space remains unprevented');
    // With a typing Space held, canvas left drag cannot become a pan.
    const doc = JSON.stringify(win.nect.document);
    fire(stage(), 'pointerdown', 100, 100, 0);
    fire(document, 'pointermove', 120, 120, 0);
    fire(document, 'pointerup', 120, 120, 0);
    assert.equal(view(), 'translate(0px,0px)');
    win.nect.load(doc);
    key(target, 'keyup', 'Space');
    el.remove();
  }
  fit();
  document.querySelector('[data-tool="pen"]').click();
  const penBefore = JSON.stringify(win.nect.document);
  fire(stage(), 'pointerdown');
  fire(document, 'pointermove', 130, 120);
  key(stage(), 'keydown', 'Escape');
  fire(document, 'pointerup', 130, 120);
  assert.equal(JSON.stringify(win.nect.document), penBefore);
  assert.equal(document.querySelector('[data-tool="pen"]').classList.contains('active'), true);
  document.querySelector('[data-tool="select"]').click();
  fit();
  const socket = document.querySelector('.output');
  fire(socket, 'pointerdown', 100, 100, 0);
  fire(stage(), 'pointerdown', 100, 100, 1, 2);
  fire(document, 'pointermove', 140, 120, 1, 2);
  assert.equal(view(), 'translate(0px,0px)', 'wiring cannot start a competing artboard pan');
  fire(document, 'pointercancel', 100, 100, 0);
  win.happyDOM.abort();
});
