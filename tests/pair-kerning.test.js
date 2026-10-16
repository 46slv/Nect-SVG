import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  document,
  node,
  point,
  connect,
  evaluate,
  serialize,
  deserialize,
  validate,
  exportSVG,
  setCharacterKerningPairs,
  characterPairInRange,
  characterPairFromIds,
  createCharacterPositions,
  validateCharacterPositions,
  hasCharacterAdjustments,
  resetCharacterOffsets,
  resetCharacterAdjustments,
  resetCharacterStyles,
  setCharacterStyles,
  setCharacterTransforms,
  setCharacterOffsets,
  reconcileCharacterEdit,
  characterPositionStatus,
  History,
  setTextPathAttachment,
  assertTextPathChange,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { parseFont } from '../src/fonts.js';
const bytes = (name) => {
  const b = fs.readFileSync(new URL(name, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const font = parseFont(bytes('../public/fonts/DejaVuSans.ttf'));
const jp = parseFont(bytes('./fixtures/fonts/NectJPFixture-Regular.otf'));
const fonts = { default: font, 'font-jp': jp };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const layout = (text = 'AV', pairs = {}, options = {}) =>
  layoutText(font, text, {
    position: [0, 0],
    size: 40,
    fonts,
    ...options,
    characterPositions: setCharacterKerningPairs(text, options.characterPositions, pairs),
  });
function scene() {
  const doc = document(),
    l = doc.layers[0],
    t = node('Text'),
    out = node('Output');
  t.text = 'AVA';
  t.params.size.value = 40;
  t.params.position.value = [100, 200];
  l.nodes = [t, out];
  l.output = out.id;
  connect(l, t.id, out.id, 'path');
  return { doc, l, t, out };
}
test('pair records are sparse, version gated, immutable and explicit zero is active', () => {
  assert.equal(setCharacterKerningPairs('AV', undefined, { 'c1:c2': null }), undefined);
  const old = createCharacterPositions('AV');
  const record = setCharacterKerningPairs('AV', old, { 'c1:c2': 0 });
  assert.equal(old.version, 1);
  assert.equal(record.version, 5);
  assert.equal(hasCharacterAdjustments(record), true);
  assert.deepEqual(record.kerningPairs, { 'c1:c2': 0 });
  assert.equal(setCharacterKerningPairs('AV', record, { 'c1:c2': 0 }), record);
  assert.deepEqual(setCharacterKerningPairs('AV', record, { 'c1:c2': null }).kerningPairs, {});
  for (const value of [NaN, Infinity, -Infinity, 100001, -100001, '0', {}, undefined])
    assert.throws(() => setCharacterKerningPairs('AV', record, { 'c1:c2': value }));
  for (const key of ['c2:c1', 'c1:c1', 'c1:c3', 'c01:c2', 'c1:c2:', 'constructor', '__proto__']) {
    assert.throws(() => setCharacterKerningPairs('AV', record, Object.fromEntries([[key, 10]])));
  }
  for (const text of ['A\nV', '\nV', 'A\n'])
    assert.throws(() => setCharacterKerningPairs(text, undefined, { 'c1:c2': 0 }));
  for (const version of [1, 2, 3, 4])
    assert.throws(() => validateCharacterPositions({ ...record, version }));
  for (const kerningPairs of [null, [], 1, undefined])
    assert.throws(() => validateCharacterPositions({ ...record, kerningPairs }));
  const { doc, t } = scene();
  t.characterPositions = setCharacterKerningPairs(t.text, undefined, { 'c1:c2': -80.5 });
  for (let version = 2; version < 9; version++) {
    doc.schemaVersion = version;
    assert.throws(() => validate(doc));
  }
  doc.schemaVersion = 9;
  validate(doc);
});
test('caret and exact-pair selections use normalized scalar boundaries and ordered adjacent IDs', () => {
  const raw = 'A𠮷か\u3099\r\nV',
    rec = createCharacterPositions(raw);
  assert.equal(characterPairInRange(raw, rec, 1, 1), 'c1:c2');
  assert.equal(characterPairInRange(raw, rec, 1, 5), 'c2:c3');
  assert.equal(characterPairInRange(raw, rec, 3, 3), 'c2:c3');
  for (const range of [
    [0, 0],
    [8, 8],
    [2, 2],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
    [0, 5],
    [0, 1],
    [-1, 1],
    [0, 99],
  ])
    assert.throws(() => characterPairInRange(raw, rec, ...range), JSON.stringify(range));
  for (const ids of [[], ['c1'], ['c1', 'c3'], ['c2', 'c1'], ['c1', 'c2', 'c3'], ['c3', 'c5']])
    assert.throws(() => characterPairFromIds(raw, rec, ids));
  assert.equal(characterPairInRange('A V', undefined, 1, 1), 'c1:c2');
});
test('verified edits retain only original adjacent pairs and never resurrect or transfer them', () => {
  const record = setCharacterKerningPairs('AVAV', undefined, { 'c1:c2': -80, 'c3:c4': 0 });
  const edit = (nextRaw, start, end, inputType = 'insertText', extra = {}) =>
    reconcileCharacterEdit(record, {
      previousRaw: 'AVAV',
      nextRaw,
      selectionStart: start,
      selectionEnd: end,
      inputType,
      ...extra,
    });
  assert.deepEqual(edit('XAVAV', 0, 0).record.kerningPairs, record.kerningPairs);
  assert.deepEqual(edit('AVAVX', 4, 4).record.kerningPairs, record.kerningPairs);
  for (const [raw, start, end, type] of [
    ['AXVAV', 1, 1, 'insertText'],
    ['A\nVAV', 1, 1, 'insertText'],
    ['VAV', 0, 1, 'deleteContentBackward'],
    ['AAV', 1, 2, 'deleteContentBackward'],
    ['AVAV', 1, 2, 'insertFromPaste'],
  ])
    assert.deepEqual(edit(raw, start, end, type).record.kerningPairs, { 'c3:c4': 0 });
  const inserted = edit('AXVAV', 1, 1).record;
  assert.deepEqual(
    reconcileCharacterEdit(inserted, {
      previousRaw: 'AXVAV',
      nextRaw: 'AVAV',
      selectionStart: 1,
      selectionEnd: 2,
      inputType: 'deleteContentBackward',
    }).record.kerningPairs,
    { 'c3:c4': 0 },
  );
  assert.equal(edit('AVAV', 1, 2, 'insertCompositionText', { composition: true }).record, record);
  assert.equal(edit('AXVAV', 1, 1, 'insertCompositionText', { isComposing: true }).record, record);
  assert.deepEqual(
    edit('AXVAV', 1, 1, 'insertCompositionText', { composition: true }).record.kerningPairs,
    { 'c3:c4': 0 },
  );
  const raw = 'か\u3099AV\r\nAV',
    normalized = 'がAV\nAV';
  const n = setCharacterKerningPairs(raw, undefined, { 'c2:c3': 1, 'c5:c6': 2 });
  assert.equal(reconcileCharacterEdit(n, { previousRaw: raw, nextRaw: normalized }).record, n);
  const changed = reconcileCharacterEdit(n, {
    previousRaw: raw,
    nextRaw: 'か\u3099XAV\r\nAV',
    selectionStart: 2,
    selectionEnd: 2,
    inputType: 'insertText',
  }).record;
  assert.deepEqual(changed.kerningPairs, n.kerningPairs);
});
test('pair-only unknown edits suspend including zero, and XY reset cannot erase recovery state', () => {
  const record = setCharacterKerningPairs('AV', undefined, { 'c1:c2': 0 });
  const unknown = reconcileCharacterEdit(record, { previousRaw: 'AV', nextRaw: 'AAV' });
  assert.equal(unknown.status, 'suspended');
  assert.equal(unknown.record, record);
  assert.equal(characterPositionStatus('AAV', record).suspended, true);
  assert.throws(() => resetCharacterOffsets('AAV', record), /reset all/);
  assert.throws(() => setCharacterKerningPairs('AAV', record, { 'c1:c2': 4 }), /suspended/);
  assert.throws(() => characterPairInRange('AAV', record, 1, 1), /suspended/);
  assert.equal(hasCharacterAdjustments(resetCharacterAdjustments('AAV', record)), false);
  const suspended = layoutText(font, 'AAV', {
    position: [0, 0],
    size: 40,
    characterPositions: record,
  });
  assert.equal(suspended.characterSuspended, true);
  assert.deepEqual(suspended.path.commands, layout('AAV').path.commands);
});
test('manual AV zero replaces metrics; tracking adds once; automatic off leaves manual spacing intact', () => {
  const kern = Object.create(font);
  kern.position = { getDefaultScriptName: () => 'latn', getKerningTables: () => null };
  kern.getKerningValue = () => -100;
  const metric = (pairs = {}, options = {}) =>
    layoutText(kern, 'AV', {
      position: [0, 0],
      size: 40,
      ...options,
      characterPositions: setCharacterKerningPairs('AV', undefined, pairs),
    });
  const inherited = metric(),
    zero = metric({ 'c1:c2': 0 }),
    positive = metric({ 'c1:c2': 100 }),
    negative = metric({ 'c1:c2': -100 });
  assert.ok(inherited.glyphs[1].x < zero.glyphs[1].x);
  near(zero.glyphs[1].x, zero.glyphs[0].advance);
  near(positive.glyphs[1].x - zero.glyphs[1].x, 4);
  near(negative.glyphs[1].x - zero.glyphs[1].x, -4);
  assert.deepEqual(
    positive.glyphs.map((g) => g.advance),
    inherited.glyphs.map((g) => g.advance),
  );
  const record = setCharacterStyles('AV', undefined, { c1: { tracking: 7 } });
  const tracked = layout('AV', { 'c1:c2': -80 }, { characterPositions: record, letterSpacing: 9 });
  near(tracked.glyphs[1].x, tracked.glyphs[0].advance - 3.2 + 7);
  assert.deepEqual(
    metric({ 'c1:c2': -80 }, { kerning: false }).path.commands,
    metric({ 'c1:c2': -80 }).path.commands,
  );
  near(layout('AV', {}, { kerning: false }).glyphs[1].x, zero.glyphs[1].x);
});
test('pair em uses only left resolved size/inline scale across mixed font/size boundaries and preserves shaping runs', () => {
  for (const right of [{ size: 80 }, { font: 'font-jp' }]) {
    const text = right.font ? 'A日' : 'AV';
    const record = setCharacterStyles(text, undefined, {
      c1: { size: 50, width: 2, tracking: 3 },
      c2: { ...right, width: 3, height: 2 },
    });
    const base = layout(text, {}, { characterPositions: record });
    const edited = layout(text, { 'c1:c2': 125.5 }, { characterPositions: record });
    near(edited.glyphs[1].x - base.glyphs[1].x, 12.55);
    assert.equal(edited.glyphs[0].advance, base.glyphs[0].advance);
  }
  let calls = 0;
  const spy = Object.create(font);
  spy.forEachGlyph = (...args) => {
    calls++;
    return font.forEachGlyph(...args);
  };
  layoutText(spy, 'AVA', {
    position: [0, 0],
    size: 40,
    characterPositions: setCharacterKerningPairs('AVA', undefined, { 'c1:c2': 0, 'c2:c3': 10 }),
  });
  assert.equal(calls, 1);
});
test('vertical pairs preserve upright/sideways substitutions and use left height, with independent tracking', () => {
  for (const text of ['日A', 'A日', '日 日']) {
    const rec = setCharacterStyles(text, undefined, {
      c1: { height: 1.5, width: 3, tracking: 2 },
      c2: { height: 2 },
    });
    const opts = {
      position: [0, 0],
      size: 40,
      writingMode: 'vertical-rl',
      characterPositions: rec,
    };
    const base = layoutText(jp, text, opts);
    const edited = layoutText(jp, text, {
      ...opts,
      characterPositions: setCharacterKerningPairs(text, rec, { 'c1:c2': -100 }),
    });
    near(edited.glyphs[1].y - base.glyphs[1].y, -6);
    assert.deepEqual(
      edited.glyphs.map((g) => [g.id, g.rotation, g.advance]),
      base.glyphs.map((g) => [g.id, g.rotation, g.advance]),
    );
    assert.equal(edited.pairKerning['c1:c2'].pixels, -6);
  }
});
test('wrapped prefix measurement excludes outgoing/incoming gaps and soft breaks retain dormant pairs', () => {
  const text = 'A V',
    record = setCharacterKerningPairs(text, undefined, { 'c2:c3': 300 });
  const small = layoutText(font, text, {
    position: [0, 0],
    size: 40,
    textWrap: { width: 40 },
    characterPositions: record,
  });
  assert.equal(small.lines.length, 2);
  near(small.glyphs[2].x, 0);
  near(small.lines[0].advance, small.glyphs[0].advance);
  const large = layoutText(font, text, {
    position: [0, 0],
    size: 40,
    textWrap: { width: 200 },
    characterPositions: record,
  });
  const plain = layoutText(font, text, { position: [0, 0], size: 40, characterPositions: record });
  assert.deepEqual(large.path.commands, plain.path.commands);
  assert.equal(large.lines.length, 1);
  near(large.glyphs[2].x, plain.glyphs[2].x);
  assert.deepEqual(record.kerningPairs, { 'c2:c3': 300 });
  const trailing = layout('A  V', { 'c1:c2': 400, 'c3:c4': 800 }, { textWrap: { width: 40 } });
  near(trailing.lines[0].advance, trailing.glyphs[0].advance);
  near(trailing.glyphs[3].x, 0);
});
test('pair-only unverified mapping keeps unadjusted fallback and blocks visible export', () => {
  const shaped = Object.create(font);
  shaped.forEachGlyph = (text, ...args) => font.forEachGlyph(text === 'ffi' ? 'fi' : text, ...args);
  const record = setCharacterKerningPairs('ffi', undefined, { 'c1:c2': 0 });
  const edited = layoutText(shaped, 'ffi', {
    position: [0, 0],
    size: 40,
    characterPositions: record,
  });
  const base = layoutText(shaped, 'ffi', { position: [0, 0], size: 40 });
  assert.equal(edited.characterSuspended, true);
  assert.deepEqual(edited.path.commands, base.path.commands);
  assert.deepEqual(edited.advances, base.advances);
  const { doc, t } = scene();
  t.text = 'ffi';
  t.characterPositions = record;
  doc.schemaVersion = 9;
  assert.throws(() => exportSVG(doc, { default: shaped }), /suspended/i);
  assert.throws(
    () =>
      layoutText(shaped, 'ffi', {
        position: [0, 0],
        size: 40,
        textWrap: { width: 300 },
        characterPositions: record,
      }),
    /TEXT_WRAP_MAPPING/,
  );
});
test('negative pair advances preserve logical order and signed/visible alignment with post-layout transforms', () => {
  const rec = setCharacterKerningPairs('AVA', undefined, { 'c1:c2': -2000, 'c2:c3': -2000 });
  const base = layoutText(font, 'AVA', { position: [100, 200], size: 40, characterPositions: rec });
  assert.ok(base.advances[0] < 0);
  assert.ok(base.glyphs[2].x < base.glyphs[1].x);
  for (const alignment of ['start', 'center', 'end']) {
    const factor = { start: 0, center: 0.5, end: 1 }[alignment];
    const result = layoutText(font, 'AVA', {
      position: [100, 200],
      size: 40,
      alignment,
      characterPositions: rec,
    });
    near(result.glyphs[0].x, 100 - result.advances[0] * factor);
    const visible = layoutText(font, 'AVA', {
      position: [100, 200],
      size: 40,
      alignment,
      referenceBounds: 'visible',
      characterPositions: rec,
    });
    const b = visible.path.getBoundingBox();
    near(b.x1 + (b.x2 - b.x1) * factor, 100);
  }
  const shape = setCharacterTransforms('AVA', rec, { c1: { rotation: 30, scale: 2 } }),
    xy = setCharacterOffsets('AVA', shape, { c1: [5, 7] });
  assert.deepEqual(
    layoutText(font, 'AVA', { position: [100, 200], size: 40, characterPositions: xy }).advances,
    base.advances,
  );
  assert.deepEqual(resetCharacterStyles('AVA', rec).kerningPairs, rec.kerningPairs);
  assert.deepEqual(resetCharacterAdjustments('AVA', xy).kerningPairs, {});
});
test('Type on Path consumes pair layout, retains intrinsic advances, detaches and atomically rejects excursions', () => {
  const { doc, l, t } = scene();
  doc.schemaVersion = 9;
  const curve = node('Curve');
  curve.points = [point(0, 0), point(600, 0)];
  curve.params.closed.value = false;
  l.nodes.push(curve);
  t.characterPositions = setCharacterKerningPairs(t.text, undefined, { 'c1:c2': -100 });
  const att = {
    nodeId: curve.id,
    contourId: curve.id,
    startMode: 'distance',
    start: 100,
    reversed: false,
  };
  setTextPathAttachment(l, t.id, att, fonts);
  const result = evaluate(l, fonts);
  assert.equal(result.error, null);
  const plain = layoutText(font, t.text, {
    position: [0, 0],
    size: 40,
    characterPositions: t.characterPositions,
  });
  const placed = result.textLayout(t.id);
  near(
    placed.placements[1].distance - placed.placements[0].distance,
    plain.glyphs[1].x - plain.glyphs[0].x + (plain.glyphs[1].advance - plain.glyphs[0].advance) / 2,
  );
  const history = new History(doc),
    before = serialize(history.doc);
  assert.throws(
    () =>
      history.apply((d) => {
        const layer = d.layers[0],
          target = layer.nodes[0],
          previous = structuredClone(layer);
        target.characterPositions = setCharacterKerningPairs(
          target.text,
          target.characterPositions,
          { 'c1:c2': -100000 },
        );
        assertTextPathChange(layer, previous, fonts);
      }),
    /TEXT_PATH_/,
  );
  assert.equal(serialize(history.doc), before);
  const restored = history.doc.layers[0];
  setTextPathAttachment(restored, t.id, null, fonts);
  assert.deepEqual(restored.nodes[0].characterPositions.kerningPairs, { 'c1:c2': -100 });
  assert.equal(evaluate(restored, fonts).error, null);
});
test('pair schema9 roundtrip/cache/Position OUT/history and CLI outlines agree exactly', () => {
  const { doc, l, t } = scene(),
    initial = serialize(doc),
    h = new History(doc);
  const original = evaluate(l, fonts),
    position = original.run(t.id, 'position'),
    originalCharacters = structuredClone(original.textLayout(t.id).characters);
  h.apply((d) => {
    d.schemaVersion = 9;
    const n = d.layers[0].nodes[0];
    n.characterPositions = setCharacterKerningPairs(n.text, n.characterPositions, {
      'c1:c2': 0,
      'c2:c3': -123.75,
    });
  });
  const saved = serialize(h.doc),
    svg = exportSVG(h.doc, fonts);
  assert.equal(exportSVG(deserialize(saved), fonts), svg);
  h.undo();
  assert.equal(serialize(h.doc), initial);
  h.redo();
  assert.equal(serialize(h.doc), saved);
  const changed = evaluate(h.doc.layers[0], fonts);
  assert.deepEqual(changed.run(t.id, 'position'), position);
  assert.notDeepEqual(changed.textLayout(t.id).characters, originalCharacters);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-pair-'));
  try {
    fs.writeFileSync(path.join(dir, 'input.json'), saved);
    execFileSync(
      process.execPath,
      ['cli/export.js', path.join(dir, 'input.json'), path.join(dir, 'output.svg')],
      { cwd: new URL('..', import.meta.url) },
    );
    assert.equal(fs.readFileSync(path.join(dir, 'output.svg'), 'utf8'), svg);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-run width retains shaped metrics until manual replacement; right scale never changes left pair em', () => {
  const kern = Object.create(font);
  kern.position = { getDefaultScriptName: () => 'latn', getKerningTables: () => null };
  kern.getKerningValue = () => -100;
  for (const rightWidth of [0.5, 3]) {
    const record = setCharacterStyles('AV', undefined, {
      c1: { width: 2, tracking: 7 },
      c2: { width: rightWidth },
    });
    const opts = { position: [0, 0], size: 40, characterPositions: record, letterSpacing: 5 };
    const inherited = layoutText(kern, 'AV', opts);
    const zero = layoutText(kern, 'AV', {
      ...opts,
      characterPositions: setCharacterKerningPairs('AV', record, { 'c1:c2': 0 }),
    });
    const manual = layoutText(kern, 'AV', {
      ...opts,
      characterPositions: setCharacterKerningPairs('AV', record, { 'c1:c2': 125.5 }),
    });
    near(inherited.glyphs[1].x, inherited.glyphs[0].advance - (100 / kern.unitsPerEm) * 40 * 2 + 7);
    near(zero.glyphs[1].x, zero.glyphs[0].advance + 7);
    near(manual.glyphs[1].x, manual.glyphs[0].advance + 10.04 + 7);
    const wrapped = layoutText(kern, 'AV', {
      ...opts,
      textWrap: { width: 1000 },
      characterPositions: setCharacterKerningPairs('AV', record, { 'c1:c2': 125.5 }),
    });
    assert.deepEqual(wrapped.path.commands, manual.path.commands);
  }
});

test('normalization that replaces a pair endpoint removes only that affected pair', () => {
  const record = setCharacterKerningPairs('かVAV', undefined, { 'c1:c2': 0, 'c3:c4': -50 });
  const changed = reconcileCharacterEdit(record, {
    previousRaw: 'かVAV',
    nextRaw: 'か\u3099VAV',
    selectionStart: 1,
    selectionEnd: 1,
    inputType: 'insertText',
  });
  assert.equal(changed.record.basis, 'がVAV');
  assert.deepEqual(changed.record.kerningPairs, { 'c3:c4': -50 });
  assert.notEqual(changed.record.units[0].id, 'c1');
});

test('decreasing origins may fit a path; open under/overflow and closed-lap overflow reject atomically', () => {
  const { doc, l, t } = scene();
  doc.schemaVersion = 9;
  const c = node('Curve');
  c.points = [point(0, 0), point(150, 0), point(150, 150), point(0, 150)];
  c.params.closed.value = false;
  l.nodes.push(c);
  t.characterPositions = setCharacterKerningPairs(t.text, undefined, { 'c1:c2': -1000 });
  const att = { nodeId: c.id, contourId: c.id, startMode: 'distance', start: 100, reversed: false };
  setTextPathAttachment(l, t.id, att, fonts);
  assert.equal(evaluate(l, fonts).error, null);
  const h = new History(doc),
    before = serialize(h.doc);
  const attempt = (value, closed = false) =>
    h.apply((d) => {
      const layer = d.layers[0],
        previous = structuredClone(layer),
        text = layer.nodes[0];
      layer.nodes.at(-1).params.closed.value = closed;
      text.characterPositions = setCharacterKerningPairs(text.text, text.characterPositions, {
        'c1:c2': value,
      });
      assertTextPathChange(layer, previous, fonts);
    });
  for (const [value, closed] of [
    [-100000, false],
    [100000, false],
    [100000, true],
  ]) {
    assert.throws(() => attempt(value, closed), /TEXT_PATH_/);
    assert.equal(serialize(h.doc), before);
    assert.equal(h.past.length, 0);
  }
});

test('editable pair sample validates, cold-reopens and exports without external fonts', () => {
  const json = fs.readFileSync(new URL('../examples/pair-kerning.json', import.meta.url), 'utf8');
  const sample = deserialize(json);
  assert.equal(sample.schemaVersion, 9);
  assert.equal(sample.layers.length, 7);
  const svg = exportSVG(sample, fonts);
  assert.match(svg, /<path/);
  assert.equal(exportSVG(deserialize(serialize(sample)), fonts), svg);
});

test('zero-advance glyphs use the true boundary advance and match roomy wrapped layout', () => {
  const text = '\uFFFCA';
  assert.equal(font.charToGlyph(text[0]).advanceWidth, 0);
  const base = layout(text),
    zero = layout(text, { 'c1:c2': 0 }),
    manual = layout(text, { 'c1:c2': 125 });
  near(base.glyphs[1].x, 0);
  near(base.pairKerning['c1:c2'].value, 0);
  near(zero.glyphs[1].x, 0);
  near(manual.glyphs[1].x, 5);
  assert.equal(
    zero.glyphs[0].advance,
    base.glyphs[0].advance,
    'Legacy selection cell metadata remains compatible',
  );
  for (const value of [0, 125, -125]) {
    const normal = layout(text, { 'c1:c2': value });
    const wrapped = layout(text, { 'c1:c2': value }, { textWrap: { width: 200 } });
    assert.deepEqual(wrapped.path.commands, normal.path.commands);
    near(wrapped.lines[0].advance, normal.advances[0]);
  }
});

test('underflowed em keeps inherited pair display and numeric starting value finite', () => {
  const record = setCharacterStyles('AV', undefined, { c1: { width: 0.01 } });
  const result = layoutText(font, 'AV', {
    position: [0, 0],
    size: Number.MIN_VALUE,
    characterPositions: record,
  });
  assert.equal(result.pairKerning['c1:c2'].value, 0);
  assert.equal(Number.isFinite(result.pairKerning['c1:c2'].pixels), true);
});
