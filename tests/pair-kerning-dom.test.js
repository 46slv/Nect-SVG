import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  point,
  connect,
  setCharacterOffsets,
  setCharacterTransforms,
  setCharacterStyles,
  setCharacterKerningPairs,
} from '../src/core.js';

test('pair kerning controls: caret/range identity, sparse history, scrub/cancel, reset, mapping, wrap and lock', async () => {
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
      (_, path) => `from '${new URL('../src/' + path.slice(2), import.meta.url)}'`,
    );
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const tick = () => new Promise((r) => setTimeout(r, 15));
  for (let i = 0; i < 300 && (!win.nect || win.nect.evaluate().error); i++) await tick();
  assert.equal(win.nect.evaluate().error, null);
  const fixture = makeDoc(),
    t = node('Text'),
    out = node('Output');
  t.text = 'AVA';
  t.params.size.value = 40;
  t.params.position.value = [100, 200];
  fixture.layers[0].nodes = [t, out];
  fixture.layers[0].output = out.id;
  connect(fixture.layers[0], t.id, out.id, 'path');
  const read = () => win.nect.document.layers[0].nodes[0],
    saved = () => JSON.stringify(win.nect.document);
  const q = (selector) => document.querySelector(selector),
    field = () => q('[data-character-kerning]');
  const undo = () => q('[data-action="undo"]').click(),
    redo = () => q('[data-action="redo"]').click();
  const empty = () => assert.equal(q('[data-action="undo"]').disabled, true);
  const load = async (setup = () => {}) => {
    const doc = structuredClone(fixture);
    setup(doc.layers[0].nodes[0], doc);
    win.nect.load(JSON.stringify(doc));
    for (let i = 0; i < 300 && win.nect.evaluate().error; i++) await tick();
  };
  const range = (start, end = start, panel = '.inspector-body') => {
    const el = q(`${panel} [data-text]`);
    el.setSelectionRange(start, end);
    el.dispatchEvent(new win.Event('select', { bubbles: true }));
    q(`${panel} [data-kern-text-cursor]`).click();
  };
  const choose = (...ids) => {
    const el = q('[data-character-selection]');
    for (const o of el.options) o.selected = ids.includes(o.value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const edit = async (value) => {
    const el = field();
    el.value = String(value);
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  };
  const pointer = (el, type, x = 100) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: 20,
      }),
    );
  const start = () => {
    const el = field();
    el.focus();
    pointer(el, 'pointerdown');
    return el;
  };
  const scrub = (dx = 14) => {
    start();
    pointer(document, 'pointermove', 100 + dx);
    pointer(document, 'pointerup', 100 + dx);
  };
  await load();
  const initial = saved();
  range(1);
  assert.equal(saved(), initial);
  assert.equal(field().value, '');
  empty();
  assert.ok(field(), q('.message').textContent);
  assert.equal(field().disabled, false);
  assert.equal(field().value, '');
  assert.equal(field().placeholder, 'Inherited (0)');
  assert.match(q('.pair-kerning').textContent, /A \| V/);
  await edit(0);
  assert.deepEqual(read().characterPositions.kerningPairs, { 'c1:c2': 0 });
  assert.equal(field().value, '0');
  assert.equal(win.nect.document.schemaVersion, 9);
  const zero = saved();
  undo();
  assert.equal(saved(), initial);
  range(1);
  assert.equal(field().value, '');
  empty();
  redo();
  assert.equal(saved(), zero);
  range(1);
  await edit(0);
  assert.equal(saved(), zero);
  undo();
  assert.equal(saved(), initial);
  range(1);
  assert.equal(field().value, '');
  empty();
  range(1);
  await edit(-123.5);
  const manual = saved();
  assert.equal(read().characterPositions.kerningPairs['c1:c2'], -123.5);
  for (const bad of ['', 'NaN', 100001, -100001]) {
    await edit(bad);
    assert.equal(saved(), manual);
  }
  field().value = '88';
  field().dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert.equal(field().value, '-123.5');
  q('[data-character-style-reset]').click();
  assert.equal(saved(), manual, 'Typography reset leaves pairs intact');
  q('[data-character-kerning-inherit]').click();
  assert.deepEqual(read().characterPositions.kerningPairs, {});
  undo();
  assert.equal(saved(), manual);
  range(1);
  q('[data-character-reset="all"]').click();
  assert.deepEqual(read().characterPositions.kerningPairs, {});
  undo();
  assert.equal(saved(), manual);
  range(1);
  for (const ids of [['c1'], ['c1', 'c3'], ['c1', 'c2', 'c3']]) {
    choose(...ids);
    assert.equal(field().disabled, true);
  }
  choose('c2', 'c3');
  assert.equal(field().disabled, false);
  assert.match(q('.pair-kerning').textContent, /V \| A/);
  for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'selection']) {
    await load();
    range(1);
    const before = saved(),
      el = start();
    pointer(document, 'pointermove', 124);
    assert.notEqual(saved(), before);
    if (cancel === 'Escape')
      el.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    else if (cancel === 'blur') win.dispatchEvent(new win.Event('blur'));
    else if (cancel === 'selection') choose('c2', 'c3');
    else pointer(cancel === 'lostpointercapture' ? el : document, cancel, 124);
    pointer(document, 'pointerup', 124);
    assert.equal(saved(), before, cancel);
    assert.equal(field().value, '', cancel);
    empty();
  }
  await load();
  range(1);
  scrub(2);
  assert.equal(saved(), initial);
  assert.equal(field().value, '');
  empty();
  let el = start();
  pointer(document, 'pointermove', 124);
  pointer(document, 'pointermove', 100);
  pointer(document, 'pointerup', 100);
  assert.equal(saved(), initial);
  assert.equal(field().value, '');
  empty();
  scrub();
  assert.equal(read().characterPositions.kerningPairs['c1:c2'], 10);
  const dragged = saved();
  undo();
  assert.equal(saved(), initial);
  range(1);
  assert.equal(field().value, '');
  empty();
  redo();
  assert.equal(saved(), dragged);
  await load();
  range(1);
  field().value = '0';
  scrub();
  assert.equal(read().characterPositions.kerningPairs['c1:c2'], 10);
  undo();
  assert.equal(read().characterPositions.kerningPairs['c1:c2'], 0);
  range(1);
  assert.equal(field().value, '0');
  undo();
  assert.equal(saved(), initial);
  range(1);
  assert.equal(field().value, '');
  empty();
  // A pending draft belongs to the old pair; a stored textarea caret cannot transfer it.
  await load();
  range(2);
  choose('c1', 'c2');
  field().focus();
  field().value = '123';
  q('.inspector-body [data-kern-text-cursor]').click();
  assert.equal(field().dataset.characterKerning, 'c2:c3');
  assert.equal(field().value, '');
  assert.equal(read().characterPositions, undefined);
  empty();
  // Draft reconciliation must occur before resolving the captured pair, including graph mirrors.
  await load();
  el = q('.node [data-text]');
  el.setSelectionRange(0, 0);
  el.dispatchEvent(new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }));
  el.value = 'XAVA';
  el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  range(2, 2, '.node');
  assert.equal(read().text, 'XAVA');
  await edit(20);
  assert.deepEqual(read().characterPositions.kerningPairs, { 'c2:c3': 20 });
  // Active composition and stale captures cannot retarget an existing pair editor.
  await load();
  el = q('.inspector-body [data-text]');
  el.setSelectionRange(1, 1);
  el.dispatchEvent(new win.Event('select', { bubbles: true }));
  el.dispatchEvent(new win.Event('compositionstart', { bubbles: true }));
  q('.inspector-body [data-kern-text-cursor]').click();
  assert.match(q('.message').textContent, /Finish or cancel/);
  assert.equal(read().characterPositions, undefined);
  el.dispatchEvent(new win.Event('compositionend', { bubbles: true }));
  await load();
  el = q('.inspector-body [data-text]');
  el.setSelectionRange(1, 1);
  el.dispatchEvent(new win.Event('select', { bubbles: true }));
  el.value = 'XAVA';
  q('.inspector-body [data-kern-text-cursor]').click();
  assert.match(q('.message').textContent, /Text changed/);
  assert.equal(read().characterPositions, undefined);
  for (const [text, at] of [
    ['AVA', 0],
    ['AVA', 3],
    ['A\nV', 1],
    ['A𠮷V', 2],
  ]) {
    await load((n) => {
      n.text = text;
    });
    range(at);
    assert.equal(read().characterPositions, undefined);
    assert.match(q('.message').textContent, /cursor|adjacent|complete/);
  }
  await load((n, d) => {
    n.text = 'A V';
    n.textWrap = { width: 40 };
    d.schemaVersion = 9;
    n.characterPositions = setCharacterKerningPairs(n.text, undefined, { 'c2:c3': 300 });
  });
  range(2);
  assert.match(q('.pair-kerning').textContent, /At a wrap break/);
  assert.equal(field().disabled, false);
  await edit(250);
  assert.equal(read().characterPositions.kerningPairs['c2:c3'], 250);
  el = q('.inspector-body [data-text-wrap-width]');
  el.value = '300';
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(read().textWrap.width, 300);
  assert.equal(win.nect.evaluate().textLayout(t.id).lines.length, 1);
  assert.doesNotMatch(q('.pair-kerning').textContent, /At a wrap break/);
  assert.equal(read().characterPositions.kerningPairs['c2:c3'], 250);
  // Rejected path edits restore inherited, explicit zero and authored values,
  // even if focus restoration runs while the numeric input remains focused.
  for (const committed of [undefined, 0, -100]) {
    await load((n, d) => {
      const curve = node('Curve');
      curve.points = [point(0, 200), point(500, 200)];
      curve.params.closed.value = false;
      d.layers[0].nodes.push(curve);
      n.pathAttachment = {
        nodeId: curve.id,
        contourId: curve.id,
        startMode: 'distance',
        start: 0,
        reversed: false,
      };
      d.schemaVersion = 7;
      if (committed !== undefined) {
        n.characterPositions = setCharacterKerningPairs(n.text, undefined, { 'c1:c2': committed });
        d.schemaVersion = 9;
      }
    });
    range(1);
    const pathBefore = saved(),
      previousField = field(),
      expected = committed === undefined ? '' : String(committed);
    previousField.focus();
    previousField.value = '-100000';
    previousField.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(saved(), pathBefore);
    assert.match(q('.message').textContent, /TEXT_PATH_/);
    assert.equal(previousField.value, expected);
    await tick();
    assert.equal(previousField.isConnected, false);
    assert.equal(field().value, expected);
    assert.equal(document.activeElement, field());
    empty();
    field().value = '-100000';
    field().dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.equal(field().value, expected);
    assert.equal(saved(), pathBefore);
    empty();
  }
  // Raw CRLF survives the numeric field's target identity without HTML normalization.
  await load((n) => {
    n.text = 'AV\r\nAV';
  });
  q('[data-character-mode]').click();
  choose('c1', 'c2');
  await edit(30);
  assert.deepEqual(read().characterPositions.kerningPairs, { 'c1:c2': 30 });
  // Pair-only suspended state blocks editing; Reset all remains an explicit recovery.
  await load((n, d) => {
    n.characterPositions = setCharacterKerningPairs(n.text, undefined, { 'c1:c2': 0 });
    n.text = 'XAVA';
    d.schemaVersion = 9;
  });
  q('[data-character-mode]').click();
  assert.equal(field().disabled, true);
  q('[data-character-reset="all"]').click();
  assert.equal(read().characterPositions.basis, 'XAVA');
  assert.equal(win.nect.evaluate().textLayout(t.id).suspended, false);
  await load((n, d) => {
    d.layers[0].locked = true;
  });
  assert.equal(q('.inspector-body [data-kern-text-cursor]').disabled, true);
  assert.equal(q('[data-character-mode]').disabled, true);
  await win.happyDOM.close();
});
