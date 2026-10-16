import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('View navigation is scoped, view-only and preserves drafts, scroll, focus and IME', async () => {
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
  const q = (selector) => document.querySelector(selector);
  const stage = () => q('.canvas-stage'),
    graph = () => q('.graph-scroll');
  const click = (action) => q(`[data-action="${action}"]`).click();
  const key = (el, name, extra = {}) =>
    el.dispatchEvent(
      new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name, ...extra }),
    );
  const wheel = (el, extra = {}) => {
    const event = new win.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      ...extra,
    });
    // happy-dom does not populate inherited MouseEvent modifier fields for WheelEvent.
    for (const [name, value] of Object.entries(extra))
      Object.defineProperty(event, name, { value });
    return el.dispatchEvent(event);
  };
  const pointer = (el, type, extra = {}) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
        ...extra,
      }),
    );
  const scale = (name) => q(`[data-zoom="${name}"]`).textContent;
  const view = () => q('.artboard').style.transform;
  const saved = JSON.stringify(win.nect.document),
    svg = win.nect.export();
  click('actual-size');
  assert.equal(scale('canvas'), '100%');
  const input = q('.inspector-body input[type="number"]');
  input.focus();
  input.value = '123.456';
  q('.right').scrollTop = 321;
  click('zoom-in');
  assert.equal(input.isConnected, true, 'navigation does not rebuild controls');
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '123.456');
  assert.equal(q('.right').scrollTop, 321);
  assert.equal(scale('canvas'), '120%');
  assert.equal(scale('graph'), '100%');
  click('graph-zoom-out');
  assert.equal(scale('graph'), '83%');
  assert.equal(scale('canvas'), '120%');
  // A genuine structural render preserves the scrolling sidebar and viewport focus.
  stage().focus();
  click('guides-panel');
  assert.equal(document.activeElement, stage());
  assert.equal(q('.right').scrollTop, 321);
  click('fit');
  assert.equal(wheel(stage(), { deltaX: 20, deltaY: 40 }), false);
  assert.equal(view(), 'translate(-20px,-40px)');
  wheel(stage(), { deltaX: 0, deltaY: 2, deltaMode: 1, shiftKey: true });
  assert.equal(view(), 'translate(-52px,-40px)');
  assert.equal(wheel(graph()), true, 'plain graph wheel retains native scrolling');
  assert.equal(wheel(q('.right'), { ctrlKey: true }), true);
  assert.equal(key(document.body, '+'), true);
  assert.equal(key(document.body, '1', { ctrlKey: true }), true);
  assert.equal(key(stage(), '1', { ctrlKey: true }), false);
  assert.equal(scale('canvas'), '100%');
  key(graph(), '-', {});
  assert.equal(scale('graph'), '69%');
  key(graph(), '1', { metaKey: true });
  assert.equal(scale('graph'), '100%');
  assert.equal(
    key(q('[data-action="zoom-in"]'), ' ', { code: 'Space' }),
    true,
    'buttons keep native Space activation',
  );
  for (const selector of [
    '.guides-panel',
    '.character-floating',
    'dialog',
    'input',
    'textarea',
    'select',
    '[contenteditable]',
  ]) {
    let target = document.createElement(
      selector === 'dialog'
        ? 'dialog'
        : ['input', 'textarea', 'select'].includes(selector)
          ? selector
          : 'div',
    );
    if (selector.startsWith('.')) target.className = selector.slice(1);
    if (selector === '[contenteditable]') {
      target.setAttribute('contenteditable', '');
      target.innerHTML = '<span>Editable</span>';
    }
    stage().append(target);
    const child = target.firstElementChild || target;
    assert.equal(wheel(child, { ctrlKey: true }), true, selector);
    assert.equal(key(child, '+'), true, selector);
    target.remove();
  }
  const beforeComposition = scale('canvas');
  q('input').dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true }));
  click('zoom-in');
  wheel(stage(), { ctrlKey: true });
  key(stage(), '+');
  assert.equal(scale('canvas'), beforeComposition);
  q('input').dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(key(stage(), '+', { isComposing: true }), true);
  assert.equal(key(stage(), '+', { keyCode: 229 }), true);
  // Active pan and wire own their coordinate system. View controls cannot interleave.
  for (const kind of ['pan', 'wire', 'numeric', 'node', 'resize', 'shape']) {
    const target =
      kind === 'pan'
        ? stage()
        : kind === 'wire'
          ? q('.output')
          : kind === 'node'
            ? q('.node-head strong')
            : kind === 'resize'
              ? q('.node-resize')
              : kind === 'shape'
                ? q('[data-node-stage-move]')
                : q('input[type="number"][data-scrub-step]');
    pointer(target, 'pointerdown', { button: kind === 'pan' ? 1 : 0 });
    const before = [scale('canvas'), scale('graph'), view()];
    click('zoom-in');
    click('graph-zoom-in');
    click('fit');
    click('graph-fit');
    wheel(stage(), { ctrlKey: true });
    wheel(graph(), { ctrlKey: true });
    key(stage(), '+');
    assert.equal(
      key(graph(), ' ', { code: 'Space' }),
      false,
      'busy graph cannot native-scroll with Space',
    );
    key(graph(), '!', { shiftKey: true, code: 'Digit1' });
    assert.deepEqual([scale('canvas'), scale('graph'), view()], before, kind);
    pointer(document, 'pointercancel');
  }
  assert.equal(JSON.stringify(win.nect.document), saved);
  assert.equal(win.nect.export(), svg);
  assert.equal(q('[data-action="undo"]').disabled, true);
  click('graph-reset');
  assert.equal(scale('graph'), '100%');
  assert.deepEqual([graph().scrollLeft, graph().scrollTop], [0, 0]);
  win.happyDOM.abort();
});
