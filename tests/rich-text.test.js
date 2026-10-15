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
  createCharacterPositions,
  setCharacterStyles,
  resetCharacterStyles,
  setCharacterOffsets,
  setCharacterTransforms,
  resetCharacterAdjustments,
  resetCharacterOffsets,
  reconcileCharacterEdit,
  characterIdsInRange,
  characterPositionStatus,
  History,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { parseFont, makeFontAsset, resolveFonts } from '../src/fonts.js';
const bytes = (file) => {
  const b = fs.readFileSync(new URL(file, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const latin = parseFont(bytes('../public/fonts/DejaVuSans.ttf'));
const jpBytes = bytes('./fixtures/fonts/NectJPFixture-Regular.otf');
const jp = parseFont(jpBytes);
const options = { position: [100, 200], size: 40, fonts: { default: latin, 'font-jp': jp } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const layout = (text, styles, extra = {}) =>
  layoutText(latin, text, {
    ...options,
    ...extra,
    characterPositions: setCharacterStyles(text, undefined, styles),
  });
function scene() {
  const doc = document(),
    l = doc.layers[0],
    t = node('Text'),
    out = node('Output');
  t.text = 'ABA';
  t.params.position.value = [100, 200];
  t.params.size.value = 40;
  l.nodes = [t, out];
  l.output = out.id;
  connect(l, t.id, out.id, 'path');
  return { doc, l, t, out };
}
test('rich typography patches are sparse, atomic, bounded, inheritable and independent of shape and XY', () => {
  assert.equal(setCharacterStyles('ABA', undefined, { c2: { size: null } }), undefined);
  const xy = setCharacterOffsets('ABA', undefined, { c2: [5, 9] });
  let record = setCharacterStyles('ABA', xy, { c2: { font: 'default', size: 70, width: 1.5 } });
  assert.equal(record.version, 3);
  assert.deepEqual(record.offsets, xy.offsets);
  assert.deepEqual(record.transforms, {});
  assert.equal(setCharacterStyles('ABA', record, { c2: { width: 1.5 } }), record);
  record = setCharacterTransforms('ABA', record, { c2: { rotation: 15, scale: 2 } });
  assert.equal(record.version, 3);
  assert.deepEqual(record.styles.c2, { font: 'default', size: 70, width: 1.5 });
  for (const patch of [
    { font: 'system-evil' },
    { font: {} },
    { size: 0 },
    { size: Infinity },
    { size: 100001 },
    { width: 0 },
    { width: 10.01 },
    { width: NaN },
    { kerning: 5 },
  ])
    assert.throws(() => setCharacterStyles('ABA', record, { c1: { size: 55 }, c2: patch }));
  assert.equal(record.styles.c1, undefined);
  assert.throws(() => setCharacterStyles('A\nB', undefined, { c2: { size: 10 } }), /non-newline/);
  const inherited = setCharacterStyles('ABA', record, { c2: { size: null } });
  assert.deepEqual(inherited.styles.c2, { font: 'default', width: 1.5 });
  const reset = resetCharacterStyles('ABA', record, ['c2']);
  assert.deepEqual(reset.styles, {});
  assert.deepEqual(reset.transforms, record.transforms);
  assert.deepEqual(reset.offsets, record.offsets);
  const all = resetCharacterAdjustments('ABA', record);
  assert.deepEqual(all.styles, {});
  assert.deepEqual(all.transforms, {});
  assert.deepEqual(all.offsets, {});
});
test('textarea ranges map UTF-16 to stable NFC/scalar identities and reject partial characters', () => {
  const raw = 'A𠮷か\u3099\r\nB',
    record = createCharacterPositions(raw);
  assert.deepEqual(characterIdsInRange(raw, record, 1, 3), ['c2']);
  assert.deepEqual(characterIdsInRange(raw, record, 3, 5), ['c3']);
  assert.deepEqual(characterIdsInRange(raw, record, 0, raw.length), ['c1', 'c2', 'c3', 'c5']);
  for (const [start, end] of [
    [1, 2],
    [3, 4],
    [5, 6],
    [-1, 2],
    [0, 99],
  ])
    assert.throws(() => characterIdsInRange(raw, record, start, end));
  assert.deepEqual(characterIdsInRange(raw, record, 3, 3), []);
});
test('verified insertion, replacement, deletion and IME retain styles only on surviving identities', () => {
  const record = setCharacterStyles('ABA', undefined, { c2: { size: 70, width: 1.4 } });
  const tx = {
    previousRaw: 'ABA',
    nextRaw: 'あABA',
    selectionStart: 0,
    selectionEnd: 0,
    inputType: 'insertCompositionText',
  };
  assert.equal(reconcileCharacterEdit(record, { ...tx, isComposing: true }).record, record);
  const next = reconcileCharacterEdit(record, { ...tx, composition: true }).record;
  assert.deepEqual(
    next.units.map((u) => u.id),
    ['c4', 'c1', 'c2', 'c3'],
  );
  assert.deepEqual(next.styles, record.styles);
  assert.equal(next.styles.c4, undefined, 'new characters inherit Text defaults');
  const replacement = reconcileCharacterEdit(record, {
    previousRaw: 'ABA',
    nextRaw: 'ABA',
    selectionStart: 1,
    selectionEnd: 2,
    inputType: 'insertFromPaste',
  }).record;
  assert.deepEqual(replacement.styles, {});
  assert.equal(replacement.units[1].id, 'c4');
  const removed = reconcileCharacterEdit(record, {
    previousRaw: 'ABA',
    nextRaw: 'AA',
    selectionStart: 1,
    selectionEnd: 2,
    inputType: 'deleteContentBackward',
  }).record;
  assert.deepEqual(removed.styles, {});
  const unknown = reconcileCharacterEdit(record, { previousRaw: 'ABA', nextRaw: 'AABA' });
  assert.equal(unknown.status, 'suspended');
  assert.equal(characterPositionStatus('AABA', record).suspended, true);
  assert.throws(() => resetCharacterOffsets('AABA', record), /reset all/);
  assert.throws(() => characterIdsInRange('AABA', record, 0, 1), /suspended/);
  assert.deepEqual(resetCharacterAdjustments('AABA', record).basis, 'AABA');
});
test('a single font override validates only its own characters and exports the actual mixed outlines', () => {
  const result = layout('A日A', { c2: { font: 'font-jp' } });
  assert.equal(result.characterReason, null);
  assert.equal(result.characters[1].font, 'font-jp');
  assert.equal(result.characters[0].font, 'default');
  assert.throws(() => layout('A日A', {}), /Missing glyphs/);
  assert.throws(() => layout('A日A', { c1: { font: 'font-jp' } }), /Missing glyphs/);
  assert.throws(() => layout('ABA', { c2: { font: 'font-missing' } }), /unavailable/);
});
test('range size changes em geometry and advance, while glyph shape scale remains post-layout', () => {
  const base = layout('ABA', {}),
    rich = layout('ABA', { c2: { size: 80 } });
  near(rich.characters[0].base[0], base.characters[0].base[0]);
  near(rich.glyphs[1].advance, base.glyphs[1].advance * 2);
  near(rich.characters[2].base[0] - base.characters[2].base[0], base.glyphs[1].advance);
  near(
    rich.characters[1].pivot[1],
    200 - ((latin.ascender + latin.descender) * 80) / latin.unitsPerEm / 2,
  );
  let record = setCharacterStyles('ABA', undefined, { c2: { size: 80 } });
  record = setCharacterTransforms('ABA', record, { c2: { rotation: 20, scale: 2 } });
  const shaped = layoutText(latin, 'ABA', { ...options, characterPositions: record });
  assert.deepEqual(shaped.advances, rich.advances);
  assert.deepEqual(shaped.characters[2].base, rich.characters[2].base);
});
test('horizontal width stretches selected ink AND advance, including spaces, without scaling tracking', () => {
  const base = layout('A BA', {}, { letterSpacing: 6, kerning: false });
  const rich = layout(
    'A BA',
    { c2: { width: 2 }, c3: { width: 1.5 } },
    { letterSpacing: 6, kerning: false },
  );
  near(rich.glyphs[1].advance, base.glyphs[1].advance * 2);
  near(rich.characters[2].base[0] - base.characters[2].base[0], base.glyphs[1].advance);
  near(
    rich.characters[3].base[0] - base.characters[3].base[0],
    base.glyphs[1].advance + base.glyphs[2].advance * 0.5,
  );
  near(
    (rich.characters[2].bounds[2] - rich.characters[2].bounds[0]) /
      (base.characters[2].bounds[2] - base.characters[2].bounds[0]),
    1.5,
  );
  near(rich.characters[1].bounds[2] - rich.characters[1].bounds[0], rich.glyphs[1].advance);
});
test('equal font/size runs preserve kerning across width changes and preserve unsupported ligature shaping', () => {
  const base = layout('AV', {}),
    wide = layout('AV', { c1: { width: 2 } });
  near(wide.characters[1].base[0] - 100, (base.characters[1].base[0] - 100) * 2);
  const plain = layoutText(latin, 'ffi', options),
    styled = layout('ffi', { c1: { width: 2 } });
  assert.deepEqual(
    styled.glyphs.map((g) => g.id),
    plain.glyphs.map((g) => g.id),
  );
  const shapedFont = Object.create(latin);
  shapedFont.forEachGlyph = (text, ...args) =>
    latin.forEachGlyph(text === 'ffi' ? 'fi' : text, ...args);
  const unsupported = layoutText(shapedFont, 'ffi', {
    ...options,
    characterPositions: setCharacterStyles('ffi', undefined, { c1: { width: 2 } }),
  });
  assert.ok(unsupported.characterReason);
  assert.equal(unsupported.characterSuspended, true);
  const normal = layoutText(shapedFont, 'ffi', options);
  assert.deepEqual(unsupported.path.commands, normal.path.commands);
  assert.deepEqual(unsupported.advances, normal.advances);
});
test('rich sizes use safe adjacent baseline metrics; legacy fixed line spacing is byte-stable', () => {
  const base = layout('A\nB', {}),
    rich = layout('A\nB', { c1: { size: 120 } });
  near(base.characters[1].base[1] - base.characters[0].base[1], 48);
  assert.ok(rich.characters[1].bounds[1] >= rich.characters[0].bounds[3]);
  const nextLarge = layout('A\nB', { c3: { size: 120 } });
  assert.ok(nextLarge.characters[1].bounds[1] >= nextLarge.characters[0].bounds[3]);
});
test('vertical mixed styles retain substitutions, per-character metrics and screen-X width without changing vertical advance', () => {
  const text = '日 A',
    base = layoutText(jp, text, { ...options, fontId: 'font-jp', writingMode: 'vertical-rl' });
  const record = setCharacterStyles(text, undefined, {
    c1: { width: 2 },
    c2: { size: 80 },
    c3: { font: 'default' },
  });
  const rich = layoutText(jp, text, {
    ...options,
    fontId: 'font-jp',
    writingMode: 'vertical-rl',
    characterPositions: record,
  });
  near(rich.glyphs[0].advance, base.glyphs[0].advance);
  near(
    rich.characters[0].bounds[2] - rich.characters[0].bounds[0],
    (base.characters[0].bounds[2] - base.characters[0].bounds[0]) * 2,
  );
  assert.equal(rich.characters[1].size, 80);
  assert.equal(rich.characters[2].font, 'default');
});
test('visible and advance reference anchors remain fixed after range typography reflow', () => {
  for (const alignment of ['start', 'center', 'end']) {
    const factor = { start: 0, center: 0.5, end: 1 }[alignment];
    const result = layout(
      'ABA',
      { c2: { size: 70, width: 1.7 } },
      { alignment, referenceBounds: 'visible' },
    );
    const b = result.path.getBoundingBox();
    near(b.x1 + (b.x2 - b.x1) * factor, 100);
    const advance = layout('ABA', { c2: { size: 70, width: 1.7 } }, { alignment });
    near(advance.characters[0].base[0], 100 - advance.advances[0] * factor);
  }
});
test('schema5 JSON, history, shared embedded fonts and CLI reproduce rich SVG exactly', () => {
  const { doc, l, t } = scene();
  const asset = makeFontAsset(jpBytes, 'NectJP.otf');
  doc.fontAssets = { [asset.id]: asset.asset };
  doc.schemaVersion = 5;
  t.text = 'A日A';
  t.characterPositions = setCharacterStyles(t.text, undefined, {
    c2: { font: asset.id, size: 70, width: 1.4 },
  });
  validate(doc);
  const fonts = resolveFonts(doc, { default: latin });
  const svg = exportSVG(doc, fonts);
  const restored = deserialize(serialize(doc));
  assert.equal(exportSVG(restored, resolveFonts(restored, { default: latin })), svg);
  const history = new History(deserialize(serialize(doc))),
    before = serialize(history.doc);
  history.apply(() => {
    const target = history.doc.layers[0].nodes[0];
    target.characterPositions = setCharacterStyles(target.text, target.characterPositions, {
      c2: { width: 1.8 },
    });
  });
  const after = serialize(history.doc);
  history.undo();
  assert.equal(serialize(history.doc), before);
  history.redo();
  assert.equal(serialize(history.doc), after);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-rich-'));
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
  const bad = structuredClone(doc);
  bad.schemaVersion = 4;
  assert.throws(() => validate(bad), /schemaVersion 5/);
  const missing = structuredClone(doc);
  missing.fontAssets = {};
  assert.throws(() => validate(missing), /Missing character font asset/);
  assert.equal(evaluate(l, fonts).textLayout(t.id).characters[1].font, asset.id);
});
test('range font object changes invalidate the text path cache without invalidating Position OUT', () => {
  const { l, t } = scene();
  t.characterPositions = setCharacterStyles(t.text, undefined, { c2: { font: 'font-other' } });
  const first = evaluate(l, { default: latin, 'font-other': latin });
  assert.equal(first.error, null);
  const second = evaluate(l, { default: latin, 'font-other': jp });
  assert.equal(second.error, null);
  assert.ok(second.stats.computed > 0);
  assert.notEqual(
    second.textLayout(t.id).characters[1].path,
    first.textLayout(t.id).characters[1].path,
  );
});
