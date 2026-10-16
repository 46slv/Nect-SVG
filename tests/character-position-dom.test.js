import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import {
  document as makeDoc,
  node,
  connect,
  createCharacterPositions,
  setCharacterOffsets,
  transformCharacterPoint,
} from '../src/core.js';

test('Character position UI: transformed selection/drag, mixed fields, cancel, locks, text transaction and IME drafts', async () => {
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
  await new Promise((r) => setTimeout(r, 70));
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const doc = makeDoc(),
    l = doc.layers[0],
    text = node('Text'),
    tr = node('Transform'),
    fill = node('Fill'),
    out = node('Output');
  text.text = 'ABA';
  text.params.position.value = [100, 180];
  text.params.size.value = 50;
  tr.params.anchor.value = [80, 120];
  tr.params.offset.value = [230, 0];
  tr.params.scale.value = 2;
  tr.params.rotation.value = 90;
  l.nodes = [text, tr, fill, out];
  l.output = out.id;
  connect(l, text.id, tr.id, 'path');
  connect(l, tr.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  const load = () => win.nect.load(JSON.stringify(doc));
  load();
  // Await actual font-backed evaluation, not a fixed delay under the parallel full suite.
  for (let i = 0; i < 250 && win.nect.evaluate().error; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(win.nect.evaluate().error, null);
  const get = () => win.nect.document.layers[0].nodes.find((n) => n.id === text.id);
  const pointer = (el, type, x, y, extra = {}) =>
    el.dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 7,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  const key = (el, key, extra = {}) =>
    el.dispatchEvent(
      new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...extra }),
    );
  const mode = () => document.querySelector('[data-character-mode]').click();
  const stage = () => document.querySelector('.canvas-stage');
  const pos = (index) => {
    const result = win.nect.evaluate(),
      g = result.textLayout(text.id).characters[index],
      o = result.path.characterOccurrences[0];
    return transformCharacterPoint(o.matrix, [
      (g.bounds[0] + g.bounds[2]) / 2,
      (g.bounds[1] + g.bounds[3]) / 2,
    ]);
  };
  const select = (index, extra = {}) => {
    const p = pos(index);
    pointer(stage(), 'pointerdown', ...p, extra);
    pointer(document, 'pointerup', ...p, extra);
  };
  const undo = () => document.querySelector('[data-action="undo"]').click();
  const before = JSON.stringify(win.nect.document);
  mode();
  assert.equal(document.querySelectorAll('.character-hit').length, 3);
  select(1);
  assert.equal(
    JSON.stringify(win.nect.document),
    before,
    'selection does not allocate IDs or history',
  );
  assert.ok(document.querySelector('.character-floating'));
  const floatingInput = document.querySelector('.character-floating input');
  floatingInput.focus();
  pointer(floatingInput, 'pointerdown', 20, 20);
  // A click with vertical/text-selection jitter must not start canvas movement.
  // Activated horizontal number scrubbing is covered by character-numeric-scrub-dom.
  pointer(document, 'pointermove', 22, 30);
  pointer(document, 'pointerup', 22, 30);
  assert.equal(
    JSON.stringify(win.nect.document),
    before,
    'subthreshold floating input movement is never a whole-Text move',
  );
  assert.equal(
    document.activeElement,
    floatingInput,
    'floating input remains connected and focused after pointer release',
  );
  const floatingReset = document.querySelector('.character-floating button');
  pointer(floatingReset, 'pointerdown', 20, 20);
  pointer(document, 'pointerup', 20, 20);
  assert.equal(
    floatingReset.isConnected,
    true,
    'floating button survives pointerdown/up until its click',
  );
  // Browsers fire change on blur; keep that old control alive until the draft is committed.
  floatingInput.value = '5';
  floatingInput.addEventListener(
    'blur',
    () => floatingInput.dispatchEvent(new win.Event('change', { bubbles: true })),
    { once: true },
  );
  const commitPoint = pos(1);
  pointer(stage(), 'pointerdown', ...commitPoint);
  pointer(document, 'pointerup', ...commitPoint);
  assert.equal(
    get().characterPositions.offsets.c2[0],
    5,
    'canvas focus commits floating draft before render',
  );
  undo();
  mode();
  select(1);
  const noOpPoint = pos(1);
  pointer(stage(), 'pointerdown', ...noOpPoint);
  pointer(document, 'pointermove', noOpPoint[0] - 6, noOpPoint[1] + 8);
  pointer(document, 'pointermove', ...noOpPoint);
  pointer(document, 'pointerup', ...noOpPoint);
  assert.equal(
    JSON.stringify(win.nect.document),
    before,
    'returning first drag to zero creates no IDs/schema/history',
  );
  const p = pos(1);
  pointer(stage(), 'pointerdown', ...p);
  pointer(document, 'pointermove', p[0] - 6, p[1] + 8);
  pointer(document, 'pointerup', p[0] - 6, p[1] + 8);
  const record = get().characterPositions;
  assert.ok(Math.abs(record.offsets[record.units[1].id][0] - 4) < 1e-8);
  assert.ok(Math.abs(record.offsets[record.units[1].id][1] - 3) < 1e-8);
  assert.deepEqual(get().params.position.value, [100, 180]);
  assert.equal(win.nect.document.schemaVersion, 3);
  const completed = JSON.stringify(win.nect.document);
  for (const cancel of ['Escape', 'pointercancel', 'blur', 'lostpointercapture']) {
    const p = pos(1);
    pointer(stage(), 'pointerdown', ...p);
    pointer(document, 'pointermove', p[0] + 20, p[1] + 10);
    if (cancel === 'Escape') key(stage(), 'Escape');
    else if (cancel === 'blur') win.dispatchEvent(new win.Event('blur'));
    else pointer(cancel === 'lostpointercapture' ? stage() : document, cancel, ...p);
    pointer(document, 'pointerup', p[0] + 20, p[1] + 10);
    assert.equal(JSON.stringify(win.nect.document), completed, cancel + ' restores exact snapshot');
    assert.equal(
      document.querySelector('[data-character-mode]').getAttribute('aria-pressed'),
      'true',
    );
  }
  select(0, { shiftKey: true });
  assert.equal(document.querySelectorAll('.character-hit.selected').length, 2);
  let field = document.querySelector('.inspector-body [data-character-axis="0"]');
  assert.equal(field.placeholder, 'Mixed');
  field.value = '9';
  field.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().characterPositions.offsets.c1[0], 9);
  assert.equal(get().characterPositions.offsets.c2[0], 9);
  assert.equal(get().characterPositions.offsets.c2[1], 3);
  undo();
  assert.equal(get().characterPositions.offsets.c1, undefined);
  assert.equal(get().characterPositions.offsets.c2[1], 3);
  mode();
  select(1);
  const beforePan = JSON.stringify(win.nect.document),
    p2 = pos(1);
  key(stage(), ' ', { code: 'Space' });
  pointer(stage(), 'pointerdown', ...p2);
  pointer(document, 'pointermove', p2[0] + 30, p2[1] + 10);
  pointer(document, 'pointerup', p2[0] + 30, p2[1] + 10);
  document.dispatchEvent(
    new win.KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' }),
  );
  assert.equal(JSON.stringify(win.nect.document), beforePan);
  key(stage(), 'ArrowRight');
  assert.ok(Math.abs(get().characterPositions.offsets.c2[1] - 2.5) < 1e-8);
  // Numeric focus never causes canvas arrow nudges.
  field = document.querySelector('.inspector-body [data-character-axis="0"]');
  field.focus();
  const beforeKey = JSON.stringify(win.nect.document);
  key(field, 'ArrowRight');
  assert.equal(JSON.stringify(win.nect.document), beforeKey);
  // Actual beforeinput ranges distinguish repeated characters and preserve adjusted B.
  document.querySelector('[data-edit-text]').click();
  let area = document.querySelector('.inspector-body [data-text]');
  area.focus();
  area.setSelectionRange(0, 0);
  area.dispatchEvent(
    new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: 'A' }),
  );
  area.value = 'AABA';
  area.dispatchEvent(
    new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'A' }),
  );
  assert.equal(get().text, 'ABA', 'draft is not committed per keystroke');
  area.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().text, 'AABA');
  assert.equal(get().characterPositions.units[2].id, 'c2');
  assert.ok(get().characterPositions.offsets.c2);
  // A final composition transaction commits once, and retains untouched adjusted B.
  mode();
  area = document.querySelector('.inspector-body [data-text]');
  area.focus();
  area.setSelectionRange(0, 1);
  area.dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  area.value = 'ZABA';
  area.dispatchEvent(
    new win.InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      isComposing: true,
      data: 'Z',
    }),
  );
  assert.equal(get().text, 'AABA');
  const composingPoint = pos(1);
  pointer(stage(), 'pointerdown', ...composingPoint);
  pointer(document, 'pointerup', ...composingPoint);
  assert.equal(area.isConnected, true, 'incomplete IME keeps its original control');
  assert.equal(
    document.activeElement,
    area,
    'character gesture never steals focus from active composition',
  );
  assert.equal(get().text, 'AABA');
  area.dispatchEvent(new win.CompositionEvent('compositionend', { bubbles: true, data: 'Z' }));
  area.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().text, 'ZABA');
  assert.equal(get().characterPositions.units[2].id, 'c2');
  undo();
  assert.equal(get().text, 'AABA');
  assert.ok(get().characterPositions.offsets.c2);
  // Unknown replacement suspends; source can be saved but visible export cannot silently drop it.
  area = document.querySelector('.inspector-body [data-text]');
  area.value = 'ABAX';
  area.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.equal(get().characterPositions.basis, 'AABA');
  assert.throws(() => win.nect.export(), /suspended/);
  mode();
  assert.equal(document.querySelectorAll('.character-hit').length, 0);
  document.querySelector('[data-character-reset="all"]').click();
  assert.doesNotThrow(() => win.nect.export());
  // Driven Position remains unrelated to independent offsets. Layer lock ends the tool.
  const currentDoc = structuredClone(win.nect.document),
    t = currentDoc.layers[0].nodes.find((n) => n.id === text.id);
  t.params.position.locked = true;
  win.nect.load(JSON.stringify(currentDoc));
  mode();
  select(1);
  key(stage(), 'ArrowDown');
  assert.ok(get().characterPositions.offsets[get().characterPositions.units[1].id]);
  document.querySelector('[data-layer-lock]').click();
  assert.equal(document.querySelector('[data-character-mode]').disabled, true);
  assert.equal(document.querySelectorAll('.character-hit').length, 0);
  // Explicit instance choice for overlapping shared Text, with no guessed branch.
  const shared = structuredClone(doc),
    sl = shared.layers[0],
    second = structuredClone(tr),
    join = node('Join Geometry');
  second.id = 'second-display-transform';
  second.params.path.source = text.id;
  sl.nodes = [
    structuredClone(text),
    structuredClone(tr),
    second,
    join,
    structuredClone(fill),
    structuredClone(out),
  ];
  connect(sl, tr.id, join.id, 'a');
  connect(sl, second.id, join.id, 'b');
  connect(sl, join.id, fill.id, 'path');
  win.nect.load(JSON.stringify(shared));
  mode();
  let overlap = pos(1);
  pointer(stage(), 'pointerdown', ...overlap);
  pointer(document, 'pointerup', ...overlap);
  assert.equal(document.querySelectorAll('.character-choice [data-choice]').length, 2);
  document.querySelector('.character-choice [data-choice="1"]').click();
  assert.equal(document.querySelector('[data-character-instance]').selectedIndex, 2);
  const beforeChoice = JSON.stringify(win.nect.document);
  pointer(stage(), 'pointerdown', ...overlap);
  pointer(document, 'pointermove', overlap[0] - 6, overlap[1] + 8);
  pointer(document, 'pointerup', overlap[0] - 6, overlap[1] + 8);
  assert.notEqual(JSON.stringify(win.nect.document), beforeChoice);
  assert.deepEqual(get().characterPositions.offsets.c2, [4, 3]);
  assert.equal(document.querySelectorAll('.character-hit.selected').length, 2);
  // Unsupported final route has no original-position hit target; source numeric controls work.
  const unsupported = structuredClone(doc),
    ul = unsupported.layers[0],
    remap = node('Path Remap');
  ul.nodes.push(remap);
  connect(ul, tr.id, remap.id, 'path');
  connect(ul, remap.id, fill.id, 'path');
  win.nect.load(JSON.stringify(unsupported));
  mode();
  assert.equal(document.querySelectorAll('.character-hit').length, 0);
  assert.match(
    document.querySelector('.character-panel').textContent,
    /unavailable through Path Remap/,
  );
  let list = document.querySelector('[data-character-selection]');
  list.options[1].selected = true;
  list.dispatchEvent(new win.Event('change', { bubbles: true }));
  field = document.querySelector('.inspector-body [data-character-axis="0"]');
  field.value = '17';
  field.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.deepEqual(get().characterPositions.offsets.c2, [17, 0]);
  // Reset selected before any offset is a no-op, and whole-text same-value paste is replacement.
  load();
  mode();
  select(1);
  document.querySelector('[data-character-reset="selected"]').click();
  assert.equal(get().characterPositions, undefined);
  // Changing tools during a drag cancels the gesture before the new tool's edit.
  const toolPoint = pos(1);
  pointer(stage(), 'pointerdown', ...toolPoint);
  pointer(document, 'pointermove', toolPoint[0] + 10, toolPoint[1] + 8);
  key(stage(), 't');
  const countText = () =>
    win.nect.document.layers.flatMap((l) => l.nodes).filter((n) => n.type === 'Text').length;
  assert.equal(countText(), 2);
  pointer(document, 'pointermove', toolPoint[0] + 20, toolPoint[1] + 20);
  pointer(document, 'pointerup', toolPoint[0] + 20, toolPoint[1] + 20);
  assert.equal(countText(), 2, 'late pointer events cannot roll back the newly added Text');
  assert.equal(
    get().characterPositions,
    undefined,
    'old character drag was cancelled before tool edit',
  );
  undo();
  assert.equal(countText(), 1);
  assert.equal(get().characterPositions, undefined);
  const replacement = structuredClone(doc);
  replacement.schemaVersion = 3;
  replacement.layers[0].nodes[0].characterPositions = setCharacterOffsets('ABA', undefined, {
    c2: [9, -4],
  });
  win.nect.load(JSON.stringify(replacement));
  area = document.querySelector('.inspector-body [data-text]');
  area.focus();
  area.setSelectionRange(0, 3);
  area.dispatchEvent(
    new win.InputEvent('beforeinput', { bubbles: true, inputType: 'insertFromPaste', data: 'ABA' }),
  );
  area.dispatchEvent(
    new win.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: 'ABA' }),
  );
  area.dispatchEvent(new win.Event('change', { bubbles: true }));
  await tick();
  assert.deepEqual(get().characterPositions.offsets, {});
  assert.notEqual(get().characterPositions.units[1].id, 'c2');
  undo();
  assert.deepEqual(get().characterPositions.offsets.c2, [9, -4]);
  win.happyDOM.abort();
});
