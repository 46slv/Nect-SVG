import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  document,
  node,
  connect,
  evaluate,
  serialize,
  deserialize,
  validate,
  exportSVG,
  setCharacterStyles,
  resetCharacterStyles,
  setCharacterOffsets,
  setCharacterTransforms,
  validateCharacterPositions,
  reconcileCharacterEdit,
  History,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { parseFont } from '../src/fonts.js';
const bytes = (file) => {
  const b = fs.readFileSync(new URL(file, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const font = parseFont(bytes('../public/fonts/DejaVuSans.ttf'));
const jp = parseFont(bytes('./fixtures/fonts/NectJPFixture-Regular.otf'));
const defaults = { position: [100, 200], size: 40 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const layout = (text, styles = {}, options = {}) =>
  layoutText(font, text, {
    ...defaults,
    ...options,
    characterPositions: setCharacterStyles(text, undefined, styles),
  });
function scene() {
  const doc = document(),
    t = node('Text'),
    out = node('Output'),
    layer = doc.layers[0];
  t.text = 'ABA\nAB';
  t.params.position.value = [100, 200];
  t.params.size.value = 40;
  layer.nodes = [t, out];
  layer.output = out.id;
  connect(layer, t.id, out.id, 'path');
  return { doc, t, layer };
}
test('spacing styles upgrade only when needed, validate atomically, and reset without touching shape or XY', () => {
  let record = setCharacterStyles('A B', undefined, { c1: { size: 50 } });
  assert.equal(record.version, 3);
  record = setCharacterOffsets('A B', record, { c2: [7, 9] });
  record = setCharacterTransforms('A B', record, { c2: { rotation: 20, scale: 2 } });
  record = setCharacterStyles('A B', record, {
    c2: { tracking: -5, baselineShift: 10, height: 1.5 },
  });
  assert.equal(record.version, 4);
  validateCharacterPositions(record);
  assert.equal(setCharacterStyles('A B', record, { c2: { height: 1.5 } }), record);
  for (const patch of [
    { height: 0 },
    { height: 10.01 },
    { height: NaN },
    { tracking: Infinity },
    { tracking: 100001 },
    { baselineShift: -100001 },
    { baselineShift: '4' },
    { kerning: 1 },
  ])
    assert.throws(() => setCharacterStyles('A B', record, { c1: { height: 2 }, c2: patch }));
  assert.equal(record.styles.c1.height, undefined);
  assert.throws(() => validateCharacterPositions({ ...record, version: 3 }), /version 4/);
  const reset = resetCharacterStyles('A B', record, ['c2']);
  assert.deepEqual(reset.styles, { c1: { size: 50 } });
  assert.deepEqual(reset.offsets, record.offsets);
  assert.deepEqual(reset.transforms, record.transforms);
});
test('range tracking replaces inherited px gaps, preserves pair kerning, and excludes line-end tracking', () => {
  const base = layout('AV A', {}, { letterSpacing: 6 });
  const styled = layout(
    'AV A',
    {
      c1: { tracking: 20, width: 2 },
      c2: { tracking: -4 },
      c3: { tracking: 0 },
      c4: { tracking: 900 },
    },
    { letterSpacing: 6 },
  );
  near(styled.characters[1].base[0] - 100, (base.characters[1].base[0] - 100 - 6) * 2 + 20);
  const delta = base.characters[1].base[0] - 100 - 6 + 14;
  near(styled.characters[2].base[0] - base.characters[2].base[0], delta - 10);
  near(styled.characters[3].base[0] - base.characters[3].base[0], delta - 16);
  const noLast = layout(
    'AV A',
    { c1: { tracking: 20, width: 2 }, c2: { tracking: -4 }, c3: { tracking: 0 } },
    { letterSpacing: 6 },
  );
  assert.deepEqual(styled.advances, noLast.advances);
  assert.deepEqual(styled.path.commands, noLast.path.commands);
  const kernFont = Object.create(font);
  kernFont.position = { getDefaultScriptName: () => 'latn', getKerningTables: () => null };
  kernFont.getKerningValue = () => -100;
  const record = setCharacterStyles('AV', undefined, { c1: { tracking: 20, width: 2 } });
  const noKern = layoutText(kernFont, 'AV', {
    ...defaults,
    characterPositions: record,
    kerning: false,
  });
  const kern = layoutText(kernFont, 'AV', { ...defaults, characterPositions: record });
  near(noKern.characters[1].base[0] - kern.characters[1].base[0], (100 / font.unitsPerEm) * 40 * 2);
});
test('tracking carries across font-size run boundaries but not newlines and inherits after reset', () => {
  const text = 'AB\nA',
    base = layout(text, { c2: { size: 70 } }, { letterSpacing: 3 });
  const rich = layout(
    text,
    { c1: { tracking: 12 }, c2: { size: 70, tracking: 500 }, c4: { tracking: 100 } },
    { letterSpacing: 3 },
  );
  near(rich.characters[1].base[0] - base.characters[1].base[0], 9);
  near(rich.advances[0] - base.advances[0], 9);
  assert.deepEqual(rich.characters[2].base, base.characters[2].base);
  const inherited = setCharacterStyles(
    text,
    setCharacterStyles(text, undefined, { c1: { tracking: 12 }, c2: { size: 70 } }),
    { c1: { tracking: null } },
  );
  assert.deepEqual(
    layoutText(font, text, { ...defaults, letterSpacing: 3, characterPositions: inherited }).path
      .commands,
    base.path.commands,
  );
});
test('physical vertical scale stretches horizontal ink and whitespace about the baseline without changing advance', () => {
  const base = layout('A B'),
    rich = layout('A B', { c1: { height: 2 }, c2: { height: 1.5 } });
  assert.deepEqual(rich.advances, base.advances);
  assert.deepEqual(rich.characters[2].base, base.characters[2].base);
  near(
    rich.characters[0].bounds[3] - rich.characters[0].bounds[1],
    2 * (base.characters[0].bounds[3] - base.characters[0].bounds[1]),
  );
  near(rich.characters[0].pivot[1] - 200, 2 * (base.characters[0].pivot[1] - 200));
  near(
    rich.characters[1].bounds[3] - rich.characters[1].bounds[1],
    1.5 * (base.characters[1].bounds[3] - base.characters[1].bounds[1]),
  );
});
test('baseline shift moves the typography origin before shape transforms and stays independent of free XY', () => {
  const base = layout('AB'),
    rich = layout('AB', { c1: { baselineShift: 15 } });
  assert.deepEqual(rich.advances, base.advances);
  assert.deepEqual(rich.characters[1].base, base.characters[1].base);
  near(rich.characters[0].base[1], 185);
  near(rich.characters[0].bounds[1], base.characters[0].bounds[1] - 15);
  near(rich.characters[0].pivot[1], base.characters[0].pivot[1] - 15);
  let record = setCharacterStyles('AB', undefined, { c1: { baselineShift: 15, height: 1.5 } });
  record = setCharacterTransforms('AB', record, { c1: { rotation: 90, scale: 2 } });
  const shaped = layoutText(font, 'AB', { ...defaults, characterPositions: record });
  record = setCharacterOffsets('AB', record, { c1: [7, 9] });
  const moved = layoutText(font, 'AB', { ...defaults, characterPositions: record });
  assert.deepEqual(moved.characters[0].base, shaped.characters[0].base);
  near(moved.characters[0].bounds[0] - shaped.characters[0].bounds[0], 7);
  near(moved.characters[0].bounds[1] - shaped.characters[0].bounds[1], 9);
});
test('vertical upright, sideways and whitespace scale screen Y and advance, tracking stays absolute, positive baseline moves right', () => {
  const text = '日 A',
    options = { ...defaults, writingMode: 'vertical-rl' };
  const base = layoutText(jp, text, options);
  const rich = layoutText(jp, text, {
    ...options,
    characterPositions: setCharacterStyles(text, undefined, {
      c1: { height: 2, baselineShift: 12, tracking: 7 },
      c2: { height: 1.5 },
      c3: { height: 1.3, width: 2 },
    }),
  });
  near(rich.glyphs[0].advance, base.glyphs[0].advance * 2);
  near(rich.characters[0].base[0], 112);
  near(
    rich.characters[0].bounds[3] - rich.characters[0].bounds[1],
    2 * (base.characters[0].bounds[3] - base.characters[0].bounds[1]),
  );
  near(rich.characters[1].base[1] - base.characters[1].base[1], base.glyphs[0].advance + 7);
  near(
    rich.characters[2].base[1] - base.characters[2].base[1],
    base.glyphs[0].advance + 7 + base.glyphs[1].advance * 0.5,
  );
  near(
    rich.characters[2].bounds[3] - rich.characters[2].bounds[1],
    1.3 * (base.characters[2].bounds[3] - base.characters[2].bounds[1]),
  );
  near(
    rich.characters[2].bounds[2] - rich.characters[2].bounds[0],
    2 * (base.characters[2].bounds[2] - base.characters[2].bounds[0]),
  );
});
test('explicit auto leading uses scaled metrics and baseline shifts; manual leading preserves exact distances including blank lines', () => {
  const text = 'A\nB',
    styles = { c1: { height: 2, baselineShift: -80 }, c3: { baselineShift: 70 } };
  const auto = layout(text, styles, { leading: { mode: 'auto' }, lineSpacing: 0.1 });
  assert.ok(auto.characters[1].bounds[1] >= auto.characters[0].bounds[3]);
  const manual = layout(
    'A\n\nB',
    { c1: { height: 2 }, c4: { size: 90 } },
    { leading: { mode: 'manual', value: 25 }, lineSpacing: 9 },
  );
  near(manual.characters[1].base[1] - manual.characters[0].base[1], 50);
  const plain = layout(text, {}, { lineSpacing: 0.1 }),
    safe = layout(text, {}, { lineSpacing: 0.1, leading: { mode: 'auto' } });
  near(plain.characters[1].base[1] - plain.characters[0].base[1], 4);
  assert.ok(safe.characters[1].bounds[1] >= safe.characters[0].bounds[3]);
});
test('vertical auto leading accounts for cross-axis shift and width, manual column distance is exact', () => {
  const options = { ...defaults, writingMode: 'vertical-rl', lineSpacing: 0.1 };
  const styles = { c1: { width: 2, baselineShift: -50 }, c3: { baselineShift: 60 } };
  const auto = layout('A\nB', styles, { ...options, leading: { mode: 'auto' } });
  assert.ok(auto.characters[1].bounds[2] <= auto.characters[0].bounds[0]);
  const manual = layout('A\n\nB', {}, { ...options, leading: { mode: 'manual', value: 27 } });
  near(manual.characters[1].base[0] - manual.characters[0].base[0], -54);
});
test('leading and new style features require schema6, reject malformed data and invalidate geometry cache only', () => {
  const { doc, t, layer } = scene();
  t.leading = { mode: 'manual', value: 70 };
  assert.throws(() => validate(doc), /schemaVersion 6/);
  doc.schemaVersion = 6;
  validate(doc);
  const first = evaluate(layer, { default: font });
  const before = first.textLayout(t.id).characters.at(-1).base[1];
  const origin = first.run(t.id, 'position');
  t.leading.value = 90;
  const second = evaluate(layer, { default: font });
  near(second.textLayout(t.id).characters.at(-1).base[1] - before, 20);
  assert.deepEqual(second.run(t.id, 'position'), origin);
  for (const bad of [
    null,
    {},
    'auto',
    { mode: 'auto', value: 20 },
    { mode: 'manual' },
    { mode: 'manual', value: 0 },
    { mode: 'manual', value: Infinity },
    { mode: 'manual', value: 100001 },
    { mode: 'other' },
  ]) {
    t.leading = bad;
    assert.throws(() => validate(doc));
    assert.throws(() => layout('AB', {}, { leading: bad }));
  }
  delete t.leading;
  t.characterPositions = setCharacterStyles(t.text, undefined, { c1: { tracking: 4 } });
  doc.schemaVersion = 5;
  assert.throws(() => validate(doc), /schemaVersion 6/);
});
test('spacing survives stable-ID edit/undo and JSON/CLI export with exact outlines', () => {
  const { doc, t } = scene();
  doc.schemaVersion = 6;
  t.leading = { mode: 'manual', value: 95 };
  t.characterPositions = setCharacterStyles(t.text, undefined, {
    c2: { tracking: 12, baselineShift: 8, height: 1.4, width: 1.2 },
  });
  const svg = exportSVG(doc, { default: font });
  assert.equal(exportSVG(deserialize(serialize(doc)), { default: font }), svg);
  const history = new History(deserialize(serialize(doc))),
    before = serialize(history.doc);
  history.apply(() => {
    const target = history.doc.layers[0].nodes[0];
    const next = 'X' + target.text;
    target.characterPositions = reconcileCharacterEdit(target.characterPositions, {
      previousRaw: target.text,
      nextRaw: next,
      selectionStart: 0,
      selectionEnd: 0,
      inputType: 'insertText',
    }).record;
    target.text = next;
  });
  assert.deepEqual(
    history.doc.layers[0].nodes[0].characterPositions.styles,
    t.characterPositions.styles,
  );
  history.undo();
  assert.equal(serialize(history.doc), before);
  history.redo();
  assert.equal(history.doc.layers[0].nodes[0].characterPositions.units[2].id, 'c2');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-spacing-'));
  try {
    fs.writeFileSync(path.join(dir, 'input.json'), serialize(doc));
    execFileSync(process.execPath, [
      'cli/export.js',
      path.join(dir, 'input.json'),
      path.join(dir, 'out.svg'),
    ]);
    assert.equal(fs.readFileSync(path.join(dir, 'out.svg'), 'utf8'), svg);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
