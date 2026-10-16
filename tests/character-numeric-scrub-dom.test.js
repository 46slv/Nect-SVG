import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  connect,
  setCharacterOffsets,
  setCharacterTransforms,
  setCharacterStyles,
} from '../src/core.js';

test('actual character palette and typography inputs scrub atomically, preserve mixed differences and cancel safely', async () => {
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
    tr = node('Transform'),
    out = node('Output');
  t.text = 'ABC';
  t.params.size.value = 40;
  t.params.position.value = [100, 200];
  t.params.position.locked = true;
  tr.params.rotation.value = 90;
  tr.params.scale.value = -2;
  fixture.layers[0].nodes = [t, tr, out];
  fixture.layers[0].output = out.id;
  connect(fixture.layers[0], t.id, tr.id, 'path');
  connect(fixture.layers[0], tr.id, out.id, 'path');
  const read = () => win.nect.document.layers[0].nodes[0];
  const saved = () => JSON.stringify(win.nect.document);
  const undo = () => document.querySelector('[data-action="undo"]').click();
  const redo = () => document.querySelector('[data-action="redo"]').click();
  const empty = () => assert.equal(document.querySelector('[data-action="undo"]').disabled, true);
  const select = (ids = ['c1']) => {
    const field = document.querySelector('[data-character-selection]');
    for (const option of field.options) option.selected = ids.includes(option.value);
    field.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const mode = (ids = ['c1']) => {
    document.querySelector('[data-character-mode]').click();
    select(ids);
  };
  const load = async (setup = () => {}, ids = ['c1']) => {
    const doc = structuredClone(fixture);
    setup(doc.layers[0].nodes[0], doc);
    win.nect.load(JSON.stringify(doc));
    for (let i = 0; i < 300 && win.nect.evaluate().error; i++) await tick();
    if (!doc.layers[0].locked) mode(ids);
  };
  const field = (attribute, panel = '.character-floating') =>
    document.querySelector(`${panel} [data-${attribute}]`);
  const pointer = (el, type, x = 100, extra = {}) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: 20,
        ...extra,
      }),
    );
  const start = (el) => {
    el.focus();
    pointer(el, 'pointerdown');
  };
  const scrub = (el, dx = 14, extra = {}) => {
    start(el);
    pointer(document, 'pointermove', 100 + dx, extra);
    pointer(document, 'pointerup', 100 + dx, extra);
  };
  const keyboard = (el, key) =>
    el.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
  const value = (key, id = 'c1') => {
    const result = win.nect.evaluate(),
      glyph = result.textLayout(t.id).characters.find((g) => g.id === id);
    if (key.startsWith('axis')) return glyph.offset[Number(key.at(-1))];
    return glyph[key];
  };

  // These are the exact four input elements in the user's screenshot, in both locations.
  for (const panel of ['.character-floating', '.inspector-body']) {
    for (const [attribute, key, expected] of [
      ['character-axis="0"', 'axis0', 10],
      ['character-axis="1"', 'axis1', 10],
      ['character-transform="rotation"', 'rotation', 10],
      ['character-transform="scale"', 'scale', 1.1],
    ]) {
      await load();
      const before = saved(),
        el = field(attribute, panel);
      assert.ok(el);
      assert.equal(el.disabled, false);
      assert.equal(el.dataset.scrubStep, key === 'scale' ? '0.01' : '1');
      scrub(el);
      assert.equal(value(key), expected, `${panel} ${attribute}`);
      assert.deepEqual(read().params, t.params, 'Text Position/font size and locks stay unchanged');
      assert.equal(win.nect.document.layers[0].nodes[1].params.scale.value, -2);
      const after = saved();
      undo();
      assert.equal(saved(), before);
      empty();
      redo();
      assert.equal(saved(), after);
    }
  }

  const mixed = (n, doc) => {
    n.characterPositions = setCharacterOffsets(n.text, undefined, { c1: [2, 3], c2: [22, 33] });
    n.characterPositions = setCharacterTransforms(n.text, n.characterPositions, {
      c1: { rotation: -20, scale: 1 },
      c2: { rotation: 10, scale: 1.5 },
    });
    n.characterPositions = setCharacterStyles(n.text, n.characterPositions, {
      c1: { size: 40, width: 0.8, height: 0.9, tracking: 2, baselineShift: -3 },
      c2: { size: 60, width: 1.2, height: 1.4, tracking: 8, baselineShift: 5 },
    });
    doc.schemaVersion = 6;
  };
  for (const [attribute, key, expected] of [
    ['character-axis="0"', 'axis0', [12, 32]],
    ['character-axis="1"', 'axis1', [13, 43]],
    ['character-transform="rotation"', 'rotation', [-10, 20]],
    ['character-transform="scale"', 'scale', [1.1, 1.6]],
  ]) {
    await load(mixed, ['c1', 'c2']);
    const before = saved(),
      el = field(attribute);
    assert.equal(el.value, '');
    assert.equal(el.placeholder, 'Mixed');
    scrub(el);
    assert.deepEqual(
      ['c1', 'c2'].map((id) => value(key, id)),
      expected,
    );
    assert.equal(field(attribute).value, '');
    assert.equal(field(attribute).placeholder, 'Mixed');
    undo();
    assert.equal(saved(), before);
    empty();
  }
  // Range typography uses displayed px/% units, leaving unselected characters and other overrides alone.
  for (const [key, expected] of [
    ['size', [50, 70]],
    ['width', [0.9, 1.3]],
    ['height', [1, 1.5]],
    ['tracking', [12, 18]],
    ['baselineShift', [7, 15]],
  ]) {
    await load(mixed, ['c1', 'c2']);
    const before = saved();
    scrub(field(`character-style="${key}"`, '.inspector-body'));
    assert.deepEqual(
      ['c1', 'c2'].map((id) => read().characterPositions.styles[id][key]),
      expected,
    );
    assert.equal(read().characterPositions.styles.c3, undefined);
    assert.deepEqual(read().characterPositions.offsets, { c1: [2, 3], c2: [22, 33] });
    assert.deepEqual(read().characterPositions.transforms, {
      c1: { rotation: -20, scale: 1 },
      c2: { rotation: 10, scale: 1.5 },
    });
    undo();
    assert.equal(saved(), before);
    empty();
  }

  for (const [attribute, panel] of [
    ['character-axis="0"', '.character-floating'],
    ['character-transform="scale"', '.character-floating'],
    ['character-style="width"', '.inspector-body'],
  ]) {
    for (const ending of ['Escape', 'pointercancel', 'blur', 'lostpointercapture']) {
      await load(mixed, ['c1', 'c2']);
      const before = saved(),
        el = field(attribute, panel);
      start(el);
      pointer(document, 'pointermove', 124);
      assert.notEqual(saved(), before);
      if (ending === 'Escape') keyboard(el, 'Escape');
      else if (ending === 'blur') win.dispatchEvent(new win.Event('blur'));
      else pointer(ending === 'lostpointercapture' ? el : document, ending, 124);
      pointer(document, 'pointerup', 124);
      assert.equal(saved(), before, `${attribute} ${ending}`);
      empty();
      assert.equal(field(attribute, panel).value, '', 'cancel restores the actual Mixed display');
    }
  }

  // Zero-distance and bounded gestures retain sparse record absence, inheritance and schema exactly.
  for (const attribute of [
    'character-axis="0"',
    'character-transform="rotation"',
    'character-transform="scale"',
    'character-style="size"',
  ]) {
    await load();
    const before = saved(),
      panel = attribute.includes('style') ? '.inspector-body' : '.character-floating';
    scrub(field(attribute, panel), 3);
    assert.equal(saved(), before);
    empty();
    let el = field(attribute, panel);
    start(el);
    pointer(document, 'pointermove', 140);
    pointer(document, 'pointermove', 100);
    pointer(document, 'pointerup');
    assert.equal(saved(), before);
    empty();
    assert.equal(read().characterPositions, undefined);
    el = field(attribute, panel);
    start(el);
    pointer(document, 'pointermove', 140, { pointerId: 8 });
    pointer(document, 'pointerup', 140, { pointerId: 8 });
    assert.equal(saved(), before);
    pointer(document, 'pointerup');
    empty();
  }
  await load(
    (n, doc) => {
      n.characterPositions = setCharacterTransforms(n.text, undefined, {
        c1: { rotation: 0, scale: 99 },
        c2: { rotation: 0, scale: 100 },
      });
      doc.schemaVersion = 4;
    },
    ['c1', 'c2'],
  );
  const bounded = saved();
  scrub(field('character-transform="scale"'), 50);
  assert.equal(saved(), bounded);
  empty();
  scrub(field('character-transform="scale"'), -100004);
  assert.equal(value('scale', 'c1'), 0.01);
  assert.equal(value('scale', 'c2'), 1.01);
  undo();
  assert.equal(saved(), bounded);
  empty();

  // Click remains typeable; a typed draft followed by a drag is two independent edits.
  await load();
  let el = field('character-transform="rotation"');
  start(el);
  pointer(document, 'pointerup');
  assert.equal(document.activeElement, el);
  empty();
  el.value = '30';
  scrub(el);
  assert.equal(value('rotation'), 40);
  undo();
  assert.equal(value('rotation'), 30);
  undo();
  assert.equal(value('rotation'), 0);
  empty();
  mode(['c1', 'c2']);
  el = field('character-transform="rotation"');
  el.value = '12';
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.deepEqual(
    ['c1', 'c2'].map((id) => value('rotation', id)),
    [12, 12],
  );
  undo();
  empty();
  await load();
  el = field('character-transform="scale"');
  el.value = '0';
  scrub(el);
  assert.equal(value('scale'), 1);
  empty();
  // Artwork modifiers do not turn numeric editing into an axis-lock/snapping gesture.
  await load();
  scrub(field('character-axis="0"'), 14, { shiftKey: true, altKey: true });
  assert.equal(value('axis0'), 10);

  for (const property of ['disabled', 'readOnly']) {
    await load();
    const before = saved(),
      el = field('character-transform="scale"');
    el[property] = true;
    scrub(el);
    assert.equal(saved(), before);
    empty();
    await load();
    const beforeMove = saved(),
      active = field('character-transform="scale"');
    start(active);
    pointer(document, 'pointermove', 114);
    active[property] = true;
    pointer(document, 'pointermove', 124);
    pointer(document, 'pointerup', 124);
    assert.equal(saved(), beforeMove);
    empty();
  }
  await load();
  const detached = saved();
  el = field('character-axis="0"');
  start(el);
  pointer(document, 'pointermove', 114);
  el.remove();
  pointer(document, 'pointermove', 124);
  pointer(document, 'pointerup', 124);
  assert.equal(saved(), detached);
  empty();
  await load((n, doc) => {
    n.characterPositions = setCharacterOffsets('ABC', undefined, { c1: [2, 0] });
    n.text = 'ABCD';
    doc.schemaVersion = 3;
  });
  const suspended = saved();
  el = field('character-transform="scale"', '.inspector-body');
  assert.equal(el.disabled, true);
  scrub(el);
  assert.equal(saved(), suspended);
  empty();
  await load((n, doc) => {
    doc.layers[0].locked = true;
  });
  assert.equal(document.querySelector('[data-character-mode]').disabled, true);

  // New manual leading and wrap-width number fields use the same transaction, in px.
  for (const kind of ['leading', 'wrap']) {
    const setup = (n, doc) => {
      if (kind === 'leading') n.leading = { mode: 'manual', value: 60 };
      else n.textWrap = { width: 300 };
      doc.schemaVersion = kind === 'leading' ? 6 : 8;
    };
    await load(setup);
    const before = saved(),
      attribute = kind === 'leading' ? 'text-leading-value' : 'text-wrap-width';
    scrub(field(attribute, '.inspector-body'));
    assert.equal(
      kind === 'leading' ? read().leading.value : read().textWrap.width,
      kind === 'leading' ? 70 : 310,
    );
    assert.equal(read().text, 'ABC');
    assert.deepEqual(read().params, t.params);
    undo();
    assert.equal(saved(), before);
    empty();
    for (const ending of ['Escape', 'pointercancel', 'blur']) {
      await load(setup);
      const el = field(attribute, '.inspector-body'),
        initial = saved();
      start(el);
      pointer(document, 'pointermove', 124);
      if (ending === 'Escape') keyboard(el, 'Escape');
      else if (ending === 'blur') win.dispatchEvent(new win.Event('blur'));
      else pointer(document, ending, 124);
      pointer(document, 'pointerup', 124);
      assert.equal(saved(), initial);
      empty();
    }
  }
  await win.happyDOM.close();
});
