import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import {
  document,
  node,
  connect,
  evaluate,
  serialize,
  deserialize,
  validate,
  exportSVG,
  pathData,
  createCharacterPositions,
  setCharacterOffsets,
  setCharacterTransforms,
  resetCharacterOffsets,
  resetCharacterTransforms,
  resetCharacterAdjustments,
  validateCharacterPositions,
  characterPositionStatus,
  reconcileCharacterEdit,
  characterTransform,
  transformCharacterPoint,
  inverseCharacterDelta,
  History,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { parseFont } from '../src/fonts.js';
const bytes = (relative) => {
  const b = fs.readFileSync(new URL(relative, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const font = opentype.parse(bytes('../public/fonts/DejaVuSans.ttf'));
const japanese = parseFont(bytes('./fixtures/fonts/NectJPFixture-Regular.otf'));
const options = { position: [240, 170], size: 48 };
const commands = (layout, index) => {
  const g = layout.glyphs[index];
  return layout.path.commands.slice(g.commandStart, g.commandEnd);
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function scene() {
  const doc = document(),
    l = doc.layers[0],
    t = node('Text'),
    tr = node('Transform'),
    fill = node('Fill'),
    out = node('Output');
  t.text = 'ABA';
  t.params.position.value = [240, 170];
  t.params.size.value = 48;
  l.nodes = [t, tr, fill, out];
  l.output = out.id;
  connect(l, t.id, tr.id, 'path');
  connect(l, tr.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  return { doc, l, t, tr, fill, out };
}
test('character shape values are lazy, sparse, bounded, atomic and independent of XY', () => {
  assert.equal(
    setCharacterTransforms('ABA', undefined, { c2: { rotation: 0, scale: 1 } }),
    undefined,
  );
  const xy = setCharacterOffsets('ABA', undefined, { c2: [12, -7] }),
    before = JSON.stringify(xy);
  const shape = setCharacterTransforms('ABA', xy, { c2: { rotation: 35, scale: 1.5 } });
  assert.equal(shape.version, 2);
  assert.equal(JSON.stringify(xy), before);
  assert.deepEqual(shape.offsets, xy.offsets);
  assert.deepEqual(shape.units, xy.units);
  assert.equal(setCharacterTransforms('ABA', shape, { c2: { rotation: 35, scale: 1.5 } }), shape);
  for (const value of [
    { rotation: NaN, scale: 1 },
    { rotation: 36001, scale: 1 },
    { rotation: 0, scale: 0 },
    { rotation: 0, scale: -1 },
    { rotation: 0, scale: 100.01 },
    { rotation: 0, scale: Infinity },
    { scale: 1 },
    { rotation: 0, scale: 1, x: 2 },
  ])
    assert.throws(() =>
      setCharacterTransforms('ABA', shape, { c1: { rotation: 20, scale: 2 }, c2: value }),
    );
  assert.deepEqual(shape.transforms, { c2: { rotation: 35, scale: 1.5 } });
  assert.throws(
    () => setCharacterTransforms('A\nB', undefined, { c2: { rotation: 1, scale: 1 } }),
    /non-newline/,
  );
  assert.throws(
    () => setCharacterTransforms('ABA', undefined, { c5: { rotation: 1, scale: 1 } }),
    /known/,
  );
  assert.deepEqual(resetCharacterOffsets('ABA', shape).transforms, shape.transforms);
  assert.deepEqual(resetCharacterTransforms('ABA', shape, ['c2']).offsets, xy.offsets);
  assert.deepEqual(resetCharacterTransforms('ABA', shape, ['c2']).transforms, {});
  const cleared = resetCharacterAdjustments('ABA', shape);
  assert.deepEqual(cleared.offsets, {});
  assert.deepEqual(cleared.transforms, {});
});
test('shape-only repeated text and IME edits preserve stable IDs or suspend without guessing', () => {
  const record = setCharacterTransforms('AA', undefined, { c2: { rotation: -25, scale: 1.7 } });
  const transaction = {
    previousRaw: 'AA',
    nextRaw: 'あAA',
    selectionStart: 0,
    selectionEnd: 0,
    inputType: 'insertCompositionText',
  };
  assert.equal(
    reconcileCharacterEdit(record, { ...transaction, isComposing: true }).record,
    record,
  );
  const committed = reconcileCharacterEdit(record, { ...transaction, composition: true });
  assert.deepEqual(
    committed.record.units.map((u) => u.id),
    ['c3', 'c1', 'c2'],
  );
  assert.deepEqual(committed.record.transforms, record.transforms);
  const unknown = reconcileCharacterEdit(record, { previousRaw: 'AA', nextRaw: 'AAA' });
  assert.equal(unknown.status, 'suspended');
  assert.equal(unknown.record, record);
  assert.equal(characterPositionStatus('AAA', record).suspended, true);
  assert.throws(() => setCharacterOffsets('AAA', record, { c2: [5, 0] }), /suspended/);
  assert.throws(
    () => setCharacterTransforms('AAA', record, { c2: { rotation: 0, scale: 1 } }),
    /suspended/,
  );
  assert.throws(() => resetCharacterOffsets('AAA', record), /reset all adjustments/);
  const recovered = resetCharacterAdjustments('AAA', record);
  assert.equal(recovered.basis, 'AAA');
  assert.ok(recovered.units.every((u) => Number(u.id.slice(1)) >= record.nextId));
  const removed = reconcileCharacterEdit(record, {
    previousRaw: 'AA',
    nextRaw: 'A',
    selectionStart: 1,
    selectionEnd: 2,
    inputType: 'deleteContentBackward',
  });
  assert.deepEqual(removed.record.transforms, {});
});
test('shape transforms all contours and control points around fixed advance-cell pivots after alignment, before XY', () => {
  for (const [activeFont, raw] of [
    [font, 'ABA'],
    [japanese, '日本A本'],
  ])
    for (const writingMode of ['horizontal-tb', 'vertical-rl'])
      for (const referenceBounds of ['visible', 'advance'])
        for (const crossAlignment of ['origin', 'center', 'end']) {
          const settings = {
            ...options,
            writingMode,
            alignment: 'end',
            referenceBounds,
            crossAlignment,
          };
          const original = layoutText(activeFont, raw, settings);
          const record = setCharacterTransforms(
            raw,
            setCharacterOffsets(raw, undefined, { c2: [12, -7] }),
            { c2: { rotation: 37, scale: 1.6 } },
          );
          const changed = layoutText(activeFont, raw, { ...settings, characterPositions: record });
          assert.deepEqual(changed.glyphs, original.glyphs);
          assert.deepEqual(changed.advances, original.advances);
          changed.glyphs.forEach((g, index) => {
            assert.deepEqual(changed.characters[index].pivot, original.characters[index].pivot);
            if (index !== 1) {
              assert.deepEqual(commands(changed, index), commands(original, index));
              return;
            }
            const pivot = original.characters[index].pivot;
            if (writingMode === 'horizontal-tb') {
              near(pivot[0], g.x + g.advance / 2);
              near(
                pivot[1],
                g.y -
                  ((activeFont.ascender + activeFont.descender) * options.size) /
                    activeFont.unitsPerEm /
                    2,
              );
            } else assert.deepEqual(pivot, [g.x, g.y + g.advance / 2]);
            const matrix = characterTransform(pivot, [12, -7], 1.6, 37);
            commands(changed, index).forEach((command, i) => {
              const before = commands(original, index)[i];
              assert.equal(command.type, before.type);
              for (const suffix of ['', '1', '2'])
                if ('x' + suffix in command) {
                  const p = transformCharacterPoint(matrix, [
                    before['x' + suffix],
                    before['y' + suffix],
                  ]);
                  near(command['x' + suffix], p[0]);
                  near(command['y' + suffix], p[1]);
                }
            });
          });
          assert.equal(
            layoutText(activeFont, raw, {
              ...settings,
              characterPositions: record,
            }).path.toPathData(5),
            changed.path.toPathData(5),
          );
        }
});
test('identity shape exactly preserves old XY geometry; vertical Latin and whitespace keep advances', () => {
  const raw = 'A B',
    xy = setCharacterOffsets(raw, undefined, { c2: [12, -7] });
  const emptyShapes = { ...xy, version: 2, transforms: { c1: { rotation: 0, scale: 1 } } };
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const old = layoutText(font, raw, { ...options, writingMode, characterPositions: xy });
    const identical = layoutText(font, raw, {
      ...options,
      writingMode,
      characterPositions: emptyShapes,
    });
    assert.deepEqual(identical.path.commands, old.path.commands);
    const record = setCharacterTransforms(raw, xy, {
      c1: { rotation: 45, scale: 0.5 },
      c2: { rotation: 90, scale: 2 },
    });
    const next = layoutText(font, raw, { ...options, writingMode, characterPositions: record });
    assert.deepEqual(next.advances, old.advances);
    assert.deepEqual(next.glyphs, old.glyphs);
    assert.deepEqual(commands(next, 2), commands(old, 2));
    assert.equal(next.characters[1].path, '');
    assert.ok(next.characters[1].bounds.every(Number.isFinite));
    assert.equal(next.glyphs[0].rotation, writingMode === 'vertical-rl' ? 90 : 0);
  }
});
test('schema4 shape roundtrip is independent, transactional and refuses feature-bearing older schemas', () => {
  const { doc, t } = scene();
  doc.schemaVersion = 4;
  t.characterPositions = setCharacterTransforms(t.text, undefined, {
    c2: { rotation: 35, scale: 1.5 },
  });
  assert.deepEqual(deserialize(serialize(doc)), doc);
  const h = new History(doc),
    before = serialize(doc);
  h.apply(() => {
    h.doc.layers[0].nodes[0].characterPositions = setCharacterTransforms(
      t.text,
      t.characterPositions,
      { c2: { rotation: -15, scale: 0.8 } },
    );
  });
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  assert.notEqual(serialize(h.doc), before);
  const bads = [
    { ...t.characterPositions, version: 1 },
    { ...t.characterPositions, transforms: { unknown: { rotation: 0, scale: 1 } } },
    { ...t.characterPositions, transforms: [] },
    { ...t.characterPositions, transforms: { c2: { rotation: Infinity, scale: 1 } } },
  ];
  for (const record of bads) assert.throws(() => validateCharacterPositions(record));
  for (const schemaVersion of [2, 3])
    assert.throws(() => validate({ ...structuredClone(doc), schemaVersion }), /schemaVersion/);
  for (const schemaVersion of [2, 3]) {
    const old = structuredClone(doc);
    old.schemaVersion = schemaVersion;
    delete old.layers[0].nodes[0].characterPositions;
    assert.doesNotThrow(() => deserialize(serialize(old)));
  }
});
test('shape edits retain paint, shared occurrences, downstream negative transforms and isolated Position OUT', () => {
  const { doc, l, t, tr, fill, out } = scene(),
    fonts = { default: font };
  tr.params.anchor.value = [100, 100];
  tr.params.rotation.value = 27;
  tr.params.scale.value = -2;
  tr.params.offset.value = [40, 12];
  const second = node('Transform'),
    join = node('Join Geometry');
  l.nodes.push(second, join);
  second.params.offset.value = [0, 110];
  connect(l, t.id, second.id, 'path');
  connect(l, tr.id, join.id, 'a');
  connect(l, second.id, join.id, 'b');
  connect(l, join.id, fill.id, 'path');
  const base = evaluate(l, fonts),
    position = base.run(t.id, 'position'),
    basePaint = exportSVG(doc, fonts);
  doc.schemaVersion = 4;
  t.characterPositions = setCharacterTransforms(t.text, undefined, {
    c2: { rotation: 22, scale: 1.3 },
  });
  const changed = evaluate(l, fonts),
    svg = exportSVG(doc, fonts);
  assert.deepEqual(changed.run(t.id, 'position'), position);
  assert.deepEqual(t.params.position.value, [240, 170]);
  assert.equal(t.params.size.value, 48);
  assert.equal(changed.path.characterOccurrences.length, 2);
  assert.equal(changed.path.characterOccurrences[0].source, t.id);
  assert.equal((svg.match(/<path /g) || []).length, (basePaint.match(/<path /g) || []).length);
  assert.doesNotMatch(svg, /character-hit|character-pivot|character-floating/);
  assert.notEqual(svg, basePaint);
  const occurrence = changed.path.characterOccurrences[0];
  assert.ok(inverseCharacterDelta(occurrence.matrix, [1, 2]).every(Number.isFinite));
  const shapePath = pathData(changed.path);
  assert.equal(pathData(evaluate(l, fonts).path), shapePath);
  tr.params.scale.value = 0;
  const singular = evaluate(l, fonts).path.characterOccurrences[0];
  assert.throws(() => inverseCharacterDelta(singular.matrix, [1, 0]), /singular/);
  t.text = 'AABA';
  assert.equal(evaluate(l, fonts).textLayout(t.id).suspended, true);
  assert.throws(() => exportSVG(doc, fonts), /suspended/);
});
test('unsupported shaping suspends shape-only adjustments and preserves normal visible geometry', () => {
  const altered = Object.create(font),
    original = font.forEachGlyph.bind(font);
  altered.forEachGlyph = (...args) => {
    const callback = args.pop();
    return original(...args, (glyph, x, y) => callback(font.charToGlyph('B'), x, y));
  };
  const record = setCharacterTransforms('AA', undefined, { c2: { rotation: 20, scale: 2 } });
  const layout = layoutText(altered, 'AA', { ...options, characterPositions: record });
  assert.match(layout.characterReason, /one-to-one/);
  assert.equal(layout.characterSuspended, true);
  assert.deepEqual(layout.characters, []);
  assert.ok(layout.path.commands.length);
});
