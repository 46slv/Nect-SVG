import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { layoutText } from '../src/text-layout.js';
import {
  composeTextLines,
  wrapOpportunities,
  validateTextWrap,
  WRAP_OPEN,
  WRAP_NONSTART,
} from '../src/text-wrap.js';
import { parseFont } from '../src/fonts.js';
import {
  document,
  node,
  point,
  connect,
  clone,
  evaluate,
  validate,
  serialize,
  deserialize,
  exportSVG,
  setTextWrap,
  setTextPathAttachment,
  assertTextPathChange,
  duplicateNodes,
  History,
  setCharacterStyles,
  setCharacterOffsets,
  setCharacterTransforms,
  reconcileCharacterEdit,
} from '../src/core.js';
const loadFont = (name) => {
  const b = fs.readFileSync(new URL(name, import.meta.url));
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const font = loadFont('../public/fonts/DejaVuSans.ttf');
const jp = loadFont('./fixtures/fonts/NectJPFixture-Regular.otf');
const defaults = { position: [100, 200], size: 40 };
const layout = (text, width, options = {}, activeFont = font) =>
  layoutText(activeFont, text, {
    ...defaults,
    ...options,
    ...(width === undefined ? {} : { textWrap: { width } }),
  });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const parts = (text, result) =>
  result.lines.map((l) =>
    [...text.replace(/\r\n?/g, '\n').normalize('NFC')].slice(l.sourceStart, l.sourceEnd).join(''),
  );
function scene() {
  const doc = document(),
    t = node('Text'),
    c = node('Curve'),
    fill = node('Fill'),
    out = node('Output');
  const layer = doc.layers[0];
  t.text = 'Alpha beta gamma';
  t.params.size.value = 40;
  t.params.position.value = [100, 200];
  c.points = [point(0, 0), point(1000, 0)];
  c.params.closed.value = false;
  layer.nodes = [t, c, fill, out];
  layer.output = out.id;
  connect(layer, t.id, fill.id, 'path');
  connect(layer, fill.id, out.id, 'path');
  return { doc, t, c, layer };
}
test('strict wrap schema, horizontal/path conflicts and atomic setters preserve source/settings', () => {
  for (const wrap of [
    null,
    [],
    {},
    { width: 0 },
    { width: -1 },
    { width: Infinity },
    { width: NaN },
    { width: '12' },
    { width: 100001 },
    { width: 30, height: 40 },
  ])
    assert.throws(() => validateTextWrap(wrap), /TEXT_WRAP_WIDTH/);
  validateTextWrap({ width: 1e-8 });
  validateTextWrap({ width: 100000 });
  const { doc, t, c, layer } = scene();
  const before = clone(t);
  t.writingMode = 'vertical-rl';
  assert.throws(() => setTextWrap(layer, t.id, { width: 90 }, { default: font }), /MODE/);
  assert.equal(t.textWrap, undefined);
  Object.assign(t, before);
  setTextWrap(layer, t.id, { width: 90 }, { default: font });
  assert.throws(() => validate(doc), /schemaVersion 8/);
  doc.schemaVersion = 8;
  validate(doc);
  const saved = serialize(doc);
  assert.throws(
    () =>
      setTextPathAttachment(
        layer,
        t.id,
        { nodeId: c.id, contourId: c.id, startMode: 'distance', start: 0, reversed: false },
        { default: font },
      ),
    /TEXT_WRAP_PATH/,
  );
  assert.equal(serialize(doc), saved);
  for (const change of [
    (d) => (d.schemaVersion = 7),
    (d) => (d.layers[0].nodes[0].writingMode = 'vertical-rl'),
    (d) => (d.layers[0].nodes[1].textWrap = { width: 1 }),
    (d) => (d.layers[0].nodes[0].textWrap.extra = true),
  ]) {
    const bad = clone(doc);
    change(bad);
    assert.throws(() => validate(bad));
  }
  for (let version = 2; version <= 7; version++) {
    const old = clone(doc);
    old.schemaVersion = version;
    delete old.layers[0].nodes[0].textWrap;
    validate(old);
  }
  layer.locked = true;
  assert.throws(() => setTextWrap(layer, t.id, null, { default: font }), /locked/);
});
test('Latin greedy spans retain spaces and scalar IDs, exclude soft separators and allow overflow export', () => {
  const text = 'Alpha   beta gamma',
    result = layout(text, 120);
  assert.deepEqual(parts(text, result), ['Alpha   ', 'beta ', 'gamma']);
  assert.deepEqual(
    result.lines.map((l) => l.breakKind),
    ['soft', 'soft', 'end'],
  );
  assert.equal(result.lines[0].fitEnd, 5);
  assert.deepEqual(
    result.characters.map((c) => c.sourceIndex),
    [...text].map((_, i) => i),
  );
  assert.deepEqual(
    result.characters.map((c) => c.id),
    [...text].map((_, i) => `c${i + 1}`),
  );
  near(result.advances[0], layout('Alpha').advances[0]);
  near(result.characters[8].base[0], 100);
  for (const width of [0.001, 10, 80]) {
    const long = layout('Supercal word', width);
    assert.deepEqual(parts('Supercal word', long), ['Supercal ', 'word']);
    assert.equal(long.characters.length, 13);
    assert.match(long.warnings.join(), /overflow/);
  }
  const { doc, t } = scene();
  doc.schemaVersion = 8;
  t.textWrap = { width: 1 };
  assert.match(exportSVG(doc, { default: font }), /<path/);
});
test('explicit/empty lines, CRLF/NFC, leading/trailing spaces and nonbreaking spaces keep their semantics', () => {
  const text = '  A  B  \r\n\r\n   \n',
    result = layout(text, 50);
  assert.deepEqual(parts(text, result), ['  A  ', 'B  ', '', '   ', '']);
  assert.deepEqual(
    result.lines.map((l) => l.breakKind),
    ['soft', 'hard', 'hard', 'hard', 'end'],
  );
  near(result.advances[1], layout('B  ').advances[0]);
  near(result.advances[3], layout('   ').advances[0]);
  assert.equal(result.characters.length, 11);
  assert.deepEqual(parts('   ', layout('   ', 0.01)), ['   ']);
  assert.deepEqual(parts('A\u00a0B C\u202fD', layout('A\u00a0B C\u202fD', 10)), [
    'A\u00a0B ',
    'C\u202fD',
  ]);
  assert.deepEqual(
    layout('e\u0301 A', 30).characters.map((c) => c.text),
    ['é', ' ', 'A'],
  );
  for (const text of ['A\u2028B', 'A\u2029B']) assert.throws(() => layout(text, 100), /SEPARATOR/);
  for (const text of ['A\tB', 'A\u0304\u0301'])
    assert.throws(() => layout(text, 100), /unsupported/);
});
test('named Japanese/Latin subset preserves bracket, punctuation, small-kana and long-mark groups', () => {
  const text = '日本「語、」あゃーア。ABC12日本',
    result = layout(text, 41, {}, jp);
  assert.deepEqual(parts(text, result), [
    '日',
    '本',
    '「語、」',
    'あゃー',
    'ア。ABC12',
    '日',
    '本',
  ]);
  const open = new Set([...WRAP_OPEN]),
    nonstart = new Set([...WRAP_NONSTART]);
  for (const line of result.lines.filter((l) => l.breakKind === 'soft')) {
    assert.equal(open.has([...text][line.sourceEnd - 1]), false);
    assert.equal(nonstart.has([...text][line.sourceEnd]), false);
  }
  for (const char of WRAP_NONSTART)
    assert.equal(wrapOpportunities([...('日' + char)], 0, 2).length, 1, char);
  for (const char of WRAP_OPEN)
    assert.equal(wrapOpportunities([...(char + '日')], 0, 2).length, 1, char);
  for (const text of ['日—日', '日\u00a0日', '日\u202f日', 'A—B', 'α日', '日α', '「  日', '日  。'])
    assert.equal(wrapOpportunities([...text], 0, [...text].length).length, 1, text);
});
test('shared shaping matches hard-line endpoint advances, with kerning/terminal tracking and style-run boundaries', () => {
  const kern = Object.create(font);
  kern.position = { getDefaultScriptName: () => 'latn', getKerningTables: () => null };
  kern.getKerningValue = () => -100;
  const text = 'AV AV AV',
    styles = {
      c1: { width: 1.3, tracking: 9 },
      c2: { tracking: 700 },
      c4: { size: 45 },
      c5: { width: 0.6 },
      c7: { font: 'font-jp' },
    };
  const record = setCharacterStyles(text, undefined, styles);
  const result = layout(
    text,
    100,
    { characterPositions: record, fonts: { 'font-jp': jp }, letterSpacing: 3 },
    kern,
  );
  for (const span of result.lines) {
    const content = [...text].slice(span.sourceStart, span.fitEnd).join('');
    const localStyles = Object.fromEntries(
      Object.entries(styles)
        .filter(([id]) => +id.slice(1) - 1 >= span.sourceStart && +id.slice(1) - 1 < span.fitEnd)
        .map(([id, value]) => [`c${+id.slice(1) - span.sourceStart}`, value]),
    );
    const expected = layout(
      content,
      undefined,
      {
        characterPositions: setCharacterStyles(content, undefined, localStyles),
        fonts: { 'font-jp': jp },
        letterSpacing: 3,
      },
      kern,
    );
    near(result.advances[result.lines.indexOf(span)], expected.advances[0]);
    const actual = result.characters.filter(
      (c) => c.sourceIndex >= span.sourceStart && c.sourceIndex < span.fitEnd,
    );
    actual.forEach((c, i) => near(c.base[0], expected.characters[i].base[0]));
  }
  const noKern = layout('AV AV', 1000, { kerning: false }, kern),
    withKern = layout('AV AV', 1000, {}, kern);
  assert.ok(noKern.advances[0] > withKern.advances[0]);
});
test('signed tracking uses deterministic sequential greedy candidates without monotonic assumptions', () => {
  const text = 'A B C D';
  const record = setCharacterStyles(text, undefined, {
    c2: { tracking: -120 },
    c4: { tracking: 80 },
  });
  const first = layout(text, 40, { characterPositions: record });
  assert.deepEqual(
    parts(text, first),
    parts(text, layout(text, 40, { characterPositions: record })),
  );
  assert.ok(first.advances.some((v) => v < 0));
  let calls = 0;
  const lines = composeTextLines([...text], 10, (s, e) => {
    calls++;
    return e - s;
  });
  assert.equal(lines.length, 1);
  assert.ok(calls <= 2 * text.length);
});
test('an overlong indivisible span warns even when later negative tracking reduces aggregate advance', () => {
  const text = 'ABC DEF';
  const result = layout(text, 60, {
    characterPositions: setCharacterStyles(text, undefined, { c4: { tracking: -200 } }),
  });
  assert.equal(result.lines.length, 1);
  assert.ok(result.advances[0] < 60);
  assert.equal(result.lines[0].overflow, true);
  assert.match(result.warnings.join(), /overflow/);
  assert.equal(result.characters.length, text.length);
});
test('typography reflows, derived leading uses mixed metrics, and post-layout adjustments never affect fitting', () => {
  const text = 'AA AA AA',
    base = layout(text, 135);
  const rich = setCharacterStyles(text, undefined, {
    c1: { size: 70, width: 1.4 },
    c4: { height: 2, baselineShift: 12 },
  });
  const result = layout(text, 135, { characterPositions: rich, leading: { mode: 'auto' } });
  assert.notDeepEqual(result.lines, base.lines);
  const crossOnly = setCharacterStyles(text, undefined, { c4: { height: 2, baselineShift: 12 } });
  assert.deepEqual(layout(text, 135, { characterPositions: crossOnly }).lines, base.lines);
  assert.ok(result.lineOffsets[1] > 48);
  const shifted = setCharacterOffsets(
    text,
    setCharacterTransforms(text, rich, { c1: { rotation: 80, scale: 5 } }),
    { c1: [800, -200] },
  );
  const after = layout(text, 135, { characterPositions: shifted, leading: { mode: 'auto' } });
  assert.deepEqual(after.lines, result.lines);
  assert.deepEqual(after.lineOffsets, result.lineOffsets);
  const manual = layout(text + '\n\nAA', 80, {
    characterPositions: undefined,
    leading: { mode: 'manual', value: 17 },
    lineSpacing: 9,
  });
  assert.deepEqual(
    manual.lineOffsets,
    manual.lines.map((_, i) => i * 17),
  );
});
test('every alignment/reference combination preserves anchors and matches equivalent hard composed outlines', () => {
  for (const alignment of ['start', 'center', 'end'])
    for (const referenceBounds of ['advance', 'visible'])
      for (const crossAlignment of ['origin', 'start', 'center', 'end']) {
        const opts = { alignment, referenceBounds, crossAlignment, leading: { mode: 'auto' } };
        const wrapped = layout('AA BB CC', 80, opts),
          explicit = layout('AA\nBB\nCC', undefined, opts);
        assert.equal(wrapped.path.toPathData(5), explicit.path.toPathData(5));
        assert.deepEqual(wrapped.lineOffsets, explicit.lineOffsets);
        const { doc, t, layer } = scene();
        doc.schemaVersion = 8;
        t.textWrap = { width: 80 };
        Object.assign(t, opts);
        assert.deepEqual(evaluate(layer, { default: font }).run(t.id, 'position'), [100, 200]);
      }
});
test('ambiguous shaping and other scripts reject wrapped layout rather than exporting unwrapped content', () => {
  for (const text of ['αβ', '한글']) {
    if ([...text].every((c) => font.charToGlyphIndex(c)))
      assert.throws(() => layout(text, 300), /MAPPING/);
  }
  const { doc, t, layer } = scene();
  doc.schemaVersion = 8;
  t.text = 'ffi';
  const shaped = Object.create(font);
  shaped.forEachGlyph = (text, ...args) => font.forEachGlyph(text === 'ffi' ? 'fi' : text, ...args);
  const before = serialize(doc);
  assert.throws(() => setTextWrap(layer, t.id, { width: 100 }, { default: shaped }), /MAPPING/);
  assert.equal(serialize(doc), before);
  t.textWrap = { width: 100 };
  assert.throws(() => exportSVG(doc, { default: shaped }), /MAPPING/);
});
test('history, cache, duplication, source edits and IME preserve stable IDs across reflow and reopen', () => {
  const { doc, t, layer } = scene();
  doc.schemaVersion = 8;
  t.characterPositions = setCharacterStyles(t.text, undefined, { c1: { width: 1.3 } });
  const h = new History(doc),
    original = serialize(doc),
    ids = clone(t.characterPositions);
  const beforeEval = evaluate(layer, { default: font });
  beforeEval.run(t.id);
  h.apply(() => setTextWrap(layer, t.id, { width: 140 }, { default: font }));
  const narrow = serialize(h.doc),
    narrowSVG = exportSVG(h.doc, { default: font });
  assert.deepEqual(t.characterPositions, ids);
  t.textWrap.width = 141;
  const afterEval = evaluate(layer, { default: font });
  afterEval.run(t.id);
  assert.ok(afterEval.stats.computed > 0);
  t.textWrap.width = 140;
  h.undo();
  assert.equal(serialize(h.doc), original);
  h.redo();
  assert.equal(serialize(h.doc), narrow);
  assert.equal(exportSVG(deserialize(narrow), { default: font }), narrowSVG);
  const live = h.doc.layers[0].nodes[0],
    l = h.doc.layers[0];
  setTextWrap(l, live.id, { width: 500 }, { default: font });
  assert.deepEqual(live.characterPositions, ids);
  const copies = duplicateNodes(l, [live.id]),
    copied = copies[0];
  assert.deepEqual(copied.textWrap, live.textWrap);
  assert.notEqual(copied.textWrap, live.textWrap);
  assert.deepEqual(copied.characterPositions, ids);
  const transaction = {
    previousRaw: live.text,
    nextRaw: 'Alpha X gamma',
    selectionStart: 6,
    selectionEnd: 10,
    inputType: 'insertText',
  };
  const provisional = reconcileCharacterEdit(ids, { ...transaction, isComposing: true });
  assert.equal(provisional.record, ids);
  const edited = reconcileCharacterEdit(ids, { ...transaction, composition: true });
  assert.equal(edited.record.units[0].id, ids.units[0].id);
  assert.deepEqual(edited.record.styles.c1, ids.styles.c1);
  live.text = transaction.nextRaw;
  live.characterPositions = edited.record;
  assert.ok(evaluate(l, { default: font }).textLayout(live.id).characters.length);
});
test('off-output invalid edit rollback preserves source, settings and history', () => {
  const { doc, t, layer } = scene();
  doc.schemaVersion = 8;
  t.textWrap = { width: 100 };
  layer.nodes.find((n) => n.type === 'Fill').params.path.source = layer.nodes.find(
    (n) => n.type === 'Curve',
  ).id;
  const h = new History(doc),
    before = serialize(doc);
  assert.throws(
    () =>
      h.apply(() => {
        const prior = clone(layer);
        t.writingMode = 'vertical-rl';
        assertTextPathChange(layer, prior, { default: font });
      }),
    /MODE/,
  );
  assert.equal(serialize(h.doc), before);
  assert.equal(h.past.length, 0);
});
test('10000-unit stress shapes each scalar once and uses bounded candidate work', () => {
  const text = 'A '.repeat(5000),
    instrumented = Object.create(font);
  let calls = 0,
    units = 0;
  instrumented.forEachGlyph = function (value, ...args) {
    calls++;
    units += [...value].length;
    return font.forEachGlyph(value, ...args);
  };
  const result = layout(text, 60, {}, instrumented);
  assert.equal(units, 10000);
  assert.equal(calls, 1);
  assert.equal(result.characters.length, 10000);
  assert.ok(result.lines.length > 1000);
  let measurements = 0;
  const composed = composeTextLines([...text], 3, (s, e) => {
    measurements++;
    return e - s;
  });
  assert.ok(measurements < 15000);
  assert.equal(composed.at(-1).sourceEnd, 10000);
});
test('browser/core export and CLI use the same wrapped outlines, with exact JSON roundtrip', () => {
  const { doc, t } = scene();
  doc.schemaVersion = 8;
  t.textWrap = { width: 140 };
  t.leading = { mode: 'manual', value: 65 };
  t.characterPositions = setCharacterStyles(t.text, undefined, {
    c1: { width: 1.2, height: 1.1 },
    c7: { tracking: -2 },
  });
  const json = serialize(doc),
    expected = exportSVG(doc, { default: font });
  assert.equal(serialize(deserialize(json)), json);
  assert.equal(exportSVG(deserialize(json), { default: font }), expected);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-wrap-'));
  try {
    fs.writeFileSync(path.join(dir, 'scene.json'), json);
    execFileSync(process.execPath, [
      'cli/export.js',
      path.join(dir, 'scene.json'),
      path.join(dir, 'scene.svg'),
    ]);
    assert.equal(fs.readFileSync(path.join(dir, 'scene.svg'), 'utf8'), expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('wrap absence exactly preserves pre-schema8 horizontal, vertical and styled geometry records', () => {
  // Captured from the immutable pre-wrap layout at the radial baseline, not regenerated by this implementation.
  const cases = [
    ['AV A  \nB\n', font, {}, 'f995a2da4af867be14c75e03fe30d4038c4ae0ec19b737ac5ede31e0b6b5a7fa'],
    [
      '日本「語、」\nABC',
      jp,
      { writingMode: 'vertical-rl' },
      'da306f9ff64f1ce15ba84c2833af2e065cfed5d76b2bf172c6a60de48ec45abc',
    ],
    [
      'AA BB\nCC',
      font,
      {
        alignment: 'end',
        referenceBounds: 'visible',
        crossAlignment: 'center',
        characterPositions: setCharacterStyles('AA BB\nCC', undefined, {
          c1: { width: 1.3, tracking: -2, height: 1.2 },
          c7: { size: 67, baselineShift: 11 },
        }),
      },
      '710af9184e0d5d7664deba985ed3b554409e6ad7d2d2fd4db7ee5593795b2dc7',
    ],
  ];
  for (const [text, font, options, expected] of cases) {
    const r = layout(text, undefined, options, font);
    assert.equal(
      createHash('sha256')
        .update(
          JSON.stringify({
            path: r.path.commands,
            glyphs: r.glyphs,
            characters: r.characters,
            advances: r.advances,
            lineOffsets: r.lineOffsets,
          }),
        )
        .digest('hex'),
      expected,
    );
  }
});
