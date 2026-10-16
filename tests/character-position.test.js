import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import opentype from 'opentype.js';
import {
  document,
  node,
  connect,
  evaluate,
  validate,
  serialize,
  deserialize,
  exportSVG,
  pathData,
  pathBounds,
  History,
  enableRemapPoint,
  createCharacterPositions,
  setCharacterOffsets,
  resetCharacterOffsets,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { makeFontAsset, parseFont } from '../src/fonts.js';
import {
  identityMatrix,
  multiplyMatrices,
  characterTransform,
  transformCharacterPoint,
  inverseCharacterDelta,
  characterBoxPoints,
  hitCharacter,
} from '../src/character-geometry.js';

function readBytes(relative) {
  const bytes = fs.readFileSync(new URL(relative, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
const font = opentype.parse(readBytes('../public/fonts/DejaVuSans.ttf'));
const japaneseBytes = readBytes('./fixtures/fonts/NectJPFixture-Regular.otf');
const japaneseFont = parseFont(japaneseBytes);
const fonts = { default: font };
const options = { position: [240, 170], size: 48 };
const near = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 0.00002, `${message}: ${actual} != ${expected}`);
const nearVector = (actual, expected, message = '') => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => near(value, expected[index], message));
};
function adjusted(raw, index, delta) {
  const record = createCharacterPositions(raw);
  return setCharacterOffsets(raw, record, { [record.units[index].id]: delta });
}
function commandsFor(layout, index) {
  const glyph = layout.glyphs[index];
  return layout.path.commands.slice(glyph.commandStart, glyph.commandEnd);
}
function assertTranslated(actual, original, delta) {
  assert.equal(actual.length, original.length);
  actual.forEach((command, index) => {
    assert.equal(command.type, original[index].type);
    assert.deepEqual(Object.keys(command), Object.keys(original[index]));
    for (const [key, value] of Object.entries(command)) {
      if (key === 'type') continue;
      near(value, original[index][key] + delta[key.startsWith('x') ? 0 : 1], key);
    }
  });
}
function scene(raw = 'ABC') {
  const doc = document(),
    layer = doc.layers[0],
    text = node('Text'),
    out = node('Output');
  text.text = raw;
  text.params.position.value = [...options.position];
  text.params.size.value = options.size;
  layer.nodes = [text, out];
  layer.output = out.id;
  connect(layer, text.id, out.id, 'path');
  const add = (type, source) => {
    const next = node(type);
    layer.nodes.push(next);
    if (source) connect(layer, source.id, next.id, 'path');
    return next;
  };
  return { doc, layer, text, out, add };
}
function moveText(doc, text, index, delta) {
  doc.schemaVersion = 3;
  const current = text.characterPositions || createCharacterPositions(text.text);
  text.characterPositions = setCharacterOffsets(text.text, current, {
    [current.units[index].id]: delta,
  });
}

// Compare every command, including all contours and Bezier control points, rather than
// only checking a bounding box that could hide shifted neighbors or missing counters.
test('one character offset moves all its contours independently and leaves advances/base layout fixed', () => {
  const raw = 'ABC';
  const original = layoutText(font, raw, options);
  const record = adjusted(raw, 1, [12, -7]);
  const saved = JSON.stringify(record);
  const moved = layoutText(font, raw, { ...options, characterPositions: record });
  assert.equal(moved.characterReason, null);
  assert.equal(moved.characterSuspended, false);
  assert.deepEqual(moved.advances, original.advances);
  assert.deepEqual(moved.glyphs, original.glyphs);
  for (let index = 0; index < 3; index++) {
    assertTranslated(
      commandsFor(moved, index),
      commandsFor(original, index),
      index === 1 ? [12, -7] : [0, 0],
    );
    assert.deepEqual(moved.characters[index].base, original.characters[index].base);
  }
  assert.ok(
    commandsFor(original, 1).filter((command) => command.type === 'M').length >= 3,
    'B retains both counters and its outer contour',
  );
  assert.deepEqual(moved.characters[1].offset, [12, -7]);
  nearVector(
    moved.characters[1].bounds,
    original.characters[1].bounds.map((v, i) => v + (i % 2 ? -7 : 12)),
  );
  assert.equal(
    JSON.stringify(record),
    saved,
    'evaluation must not allocate IDs or mutate saved offsets',
  );
  assert.equal(
    layoutText(font, raw, { ...options, characterPositions: record }).path.toPathData(5),
    moved.path.toPathData(5),
    'evaluation must not accumulate the same offset',
  );
});

test('terminal offsets apply after right/center, visible/advance and block alignment in both writing modes', () => {
  const raw = 'ABC\n\nAV';
  const record = adjusted(raw, 2, [37, -19]);
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    for (const alignment of ['center', 'end']) {
      for (const referenceBounds of ['advance', 'visible']) {
        for (const crossAlignment of ['start', 'center', 'end']) {
          const settings = { ...options, writingMode, alignment, referenceBounds, crossAlignment };
          const base = layoutText(font, raw, settings);
          const moved = layoutText(font, raw, { ...settings, characterPositions: record });
          const label = [writingMode, alignment, referenceBounds, crossAlignment].join('/');
          assert.deepEqual(moved.advances, base.advances, label);
          assert.deepEqual(moved.glyphs, base.glyphs, label);
          moved.glyphs.forEach((glyph, index) =>
            assertTranslated(
              commandsFor(moved, index),
              commandsFor(base, index),
              glyph.sourceIndex === 2 ? [37, -19] : [0, 0],
            ),
          );
        }
      }
    }
  }
});

test('font size, kerning, spacing and writing direction reflow the base but retain local pixel offsets', () => {
  // Exercise a controlled nonzero pair through the unchanged full-run OpenType layout.
  const kerningFont = Object.create(font);
  kerningFont.position = Object.create(font.position);
  kerningFont.position.getKerningTables = () => undefined;
  kerningFont.getKerningValue = (left, right) =>
    left.index === font.charToGlyphIndex('A') && right.index === font.charToGlyphIndex('V')
      ? -120
      : 0;
  const raw = 'AVA';
  const record = adjusted(raw, 1, [12, -7]);
  for (const size of [24, 96]) {
    for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
      for (const kerning of [false, true]) {
        for (const letterSpacing of [0, 9]) {
          const settings = {
            ...options,
            size,
            writingMode,
            kerning,
            letterSpacing,
            alignment: 'end',
            referenceBounds: 'visible',
          };
          const base = layoutText(kerningFont, raw, settings);
          const moved = layoutText(kerningFont, raw, { ...settings, characterPositions: record });
          assert.deepEqual(moved.advances, base.advances);
          assertTranslated(commandsFor(moved, 1), commandsFor(base, 1), [12, -7]);
          assert.deepEqual(
            moved.characters.map((character) => character.id),
            record.units.map((unit) => unit.id),
          );
          assert.deepEqual(moved.characters[1].offset, [12, -7]);
        }
      }
    }
  }
  const unkerned = layoutText(kerningFont, raw, { ...options, kerning: false });
  const kerned = layoutText(kerningFont, raw, { ...options, kerning: true });
  assert.notEqual(
    unkerned.glyphs[1].x,
    kerned.glyphs[1].x,
    'the fixture exercises real pair kerning',
  );
});

test('vertical Japanese alternates and sideways Latin move in shared XY axes without rotating the offset', () => {
  const raw = '「日A。、」';
  const record = createCharacterPositions(raw);
  const movedRecord = setCharacterOffsets(
    raw,
    record,
    Object.fromEntries(record.units.map((unit) => [unit.id, [11, -6]])),
  );
  const settings = { ...options, writingMode: 'vertical-rl' };
  const base = layoutText(japaneseFont, raw, settings);
  const moved = layoutText(japaneseFont, raw, { ...settings, characterPositions: movedRecord });
  assert.equal(base.glyphs.find((glyph) => glyph.char === 'A').rotation, 90);
  assert.equal(base.glyphs.find((glyph) => glyph.char === '「').substituted, true);
  assert.deepEqual(moved.glyphs, base.glyphs);
  base.glyphs.forEach((_, index) =>
    assertTranslated(commandsFor(moved, index), commandsFor(base, index), [11, -6]),
  );
});

test('whitespace has an independently movable hit cell, no ink or advance effect, and newlines stay structural', () => {
  const raw = 'A \n\nB';
  const record = adjusted(raw, 1, [25, 13]);
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const settings = { ...options, writingMode, lineSpacing: 1.7 };
    const base = layoutText(font, raw, settings);
    const moved = layoutText(font, raw, { ...settings, characterPositions: record });
    assert.deepEqual(
      moved.characters.map((character) => [character.text, character.sourceIndex]),
      [
        ['A', 0],
        [' ', 1],
        ['B', 4],
      ],
    );
    assert.equal(moved.path.toPathData(5), base.path.toPathData(5));
    assert.deepEqual(moved.advances, base.advances);
    assert.equal(moved.glyphs[2].line, 2);
    const space = moved.characters[1];
    assert.equal(space.whitespace, true);
    assert.equal(space.path, '');
    assert.ok(space.bounds[2] > space.bounds[0] && space.bounds[3] > space.bounds[1]);
    nearVector(
      space.bounds,
      base.characters[1].bounds.map((v, i) => v + (i % 2 ? 13 : 25)),
    );
    const center = [
      (space.bounds[0] + space.bounds[2]) / 2,
      (space.bounds[1] + space.bounds[3]) / 2,
    ];
    assert.equal(hitCharacter(space, identityMatrix(), center), true);
  }
});

test('NFC and newline normalization preserve the same character IDs and adjusted outlines without rewriting raw text', () => {
  const raw = 'カ\u3099\r\nA';
  const record = adjusted(raw, 2, [8, -4]);
  const before = JSON.stringify(record);
  const original = layoutText(japaneseFont, raw, { ...options, characterPositions: record });
  const normalized = layoutText(japaneseFont, 'ガ\nA', { ...options, characterPositions: record });
  assert.equal(original.path.toPathData(5), normalized.path.toPathData(5));
  assert.deepEqual(
    original.characters.map((character) => [character.id, character.text, character.sourceIndex]),
    [
      [record.units[0].id, 'ガ', 0],
      [record.units[2].id, 'A', 2],
    ],
  );
  assert.equal(JSON.stringify(record), before);
  for (const unsupported of ['a\u0305', '\uFE0F', '\t'])
    assert.throws(() => layoutText(font, unsupported, options), /unsupported/);
});

function alteredShaper(kind) {
  const controlled = Object.create(font);
  controlled.forEachGlyph = (raw, x, y, size, settings, callback) => {
    const emitted = [];
    const advance = font.forEachGlyph(raw, x, y, size, settings, (...args) => emitted.push(args));
    if (kind === 'count') emitted.pop();
    if (kind === 'identity') [emitted[0][0], emitted[1][0]] = [emitted[1][0], emitted[0][0]];
    emitted.forEach((args) => callback(...args));
    return advance;
  };
  return controlled;
}

test('shaping count mismatch and same-count glyph identity reorder both disable editing without changing shaping', () => {
  const raw = 'AB';
  for (const kind of ['count', 'identity']) {
    const controlled = alteredShaper(kind);
    const unadjusted = layoutText(controlled, raw, options);
    const moved = layoutText(controlled, raw, {
      ...options,
      characterPositions: adjusted(raw, 0, [20, 4]),
    });
    assert.equal(unadjusted.glyphs.length, kind === 'count' ? 1 : 2);
    assert.match(unadjusted.characterReason, /one-to-one|mapping/);
    assert.equal(unadjusted.characterSuspended, false);
    assert.deepEqual(unadjusted.characters, []);
    assert.equal(moved.path.toPathData(5), unadjusted.path.toPathData(5));
    assert.equal(moved.characterSuspended, true);
    assert.match(moved.warnings.join(' '), /suspended/i);
    assert.deepEqual(moved.characters, []);
  }
  const unsupportedScript = layoutText(font, 'Ж', options);
  assert.ok(
    unsupportedScript.path.commands.length,
    'existing rendering still works for out-of-scope scripts',
  );
  assert.match(unsupportedScript.characterReason, /mapping/);
  assert.equal(unsupportedScript.characterSuspended, false);
});

test('active unresolved character offsets save intact but visible exports fail until reset or mapping recovery', () => {
  const { doc, layer, text, add, out } = scene('AB');
  moveText(doc, text, 0, [18, 3]);
  const fill = add('Fill', text);
  connect(layer, fill.id, out.id, 'path');
  const saved = serialize(doc);
  for (const kind of ['count', 'identity']) {
    const controlledFonts = { default: alteredShaper(kind) };
    const result = evaluate(layer, controlledFonts);
    assert.equal(result.error, null);
    assert.equal(result.textLayout(text.id).suspended, true);
    assert.equal(result.path.characterOccurrences[0].suspended, true);
    assert.throws(() => exportSVG(doc, controlledFonts), /suspended/i);
    assert.equal(serialize(doc), saved);
    assert.equal(serialize(deserialize(saved)), saved);
  }
  assert.doesNotThrow(
    () => exportSVG(doc, fonts),
    'the same retained offset resumes under a resolvable font',
  );
  text.text = 'ABA';
  assert.equal(evaluate(layer, fonts).textLayout(text.id).suspended, true);
  assert.throws(() => exportSVG(doc, fonts), /suspended/i);
  text.characterPositions = resetCharacterOffsets(text.text, text.characterPositions);
  assert.equal(evaluate(layer, fonts).textLayout(text.id).suspended, false);
  assert.doesNotThrow(() => exportSVG(doc, fonts));
});

test('offset changes invalidate Text Path but leave Position OUT and Position-linked followers cached', () => {
  const { doc, layer, text, add, out } = scene();
  const follower = add('Text');
  follower.text = 'Follower';
  connect(layer, text.id, follower.id, 'position', false, 'position');
  connect(layer, follower.id, out.id, 'path');
  const initial = evaluate(layer, fonts);
  const followerPath = pathData(initial.path);
  const originalSourcePath = pathData(initial.run(text.id));
  assert.equal(evaluate(layer, fonts).stats.computed, 0);
  const position = [...text.params.position.value];
  moveText(doc, text, 1, [12, -7]);
  const changed = evaluate(layer, fonts);
  assert.equal(changed.stats.computed, 0, 'Position-only consumers must not recompute');
  assert.equal(pathData(changed.path), followerPath);
  assert.deepEqual(changed.run(text.id, 'position'), position);
  assert.deepEqual(text.params.position.value, position);
  assert.notEqual(pathData(changed.run(text.id)), originalSourcePath);
  assert.equal(evaluate(layer, fonts).stats.computed, 0);
  text.font = 'unavailable';
  assert.deepEqual(evaluate(layer).run(text.id, 'position'), position);
});

test('connected and locked Text Position does not prevent independent character offsets or change its source', () => {
  const { doc, layer, text, add } = scene();
  const vector = add('Vector');
  vector.params.value.value = [410, 220];
  connect(layer, vector.id, text.id, 'position');
  text.params.position.locked = true;
  const source = serialize(vector),
    position = serialize(text.params.position);
  const before = pathData(evaluate(layer, fonts).path);
  moveText(doc, text, 1, [12, -7]);
  const result = evaluate(layer, fonts);
  assert.notEqual(pathData(result.path), before);
  assert.deepEqual(result.run(text.id, 'position'), [410, 220]);
  assert.equal(serialize(vector), source);
  assert.equal(serialize(text.params.position), position);
});

test('final visible bounds include adjusted ink while Position OUT remains the unadjusted reference', () => {
  const { doc, layer, text } = scene();
  text.alignment = 'end';
  text.referenceBounds = 'visible';
  text.crossAlignment = 'end';
  const original = evaluate(layer, fonts);
  const originalBounds = pathBounds(original.path);
  near(originalBounds[0][2], text.params.position.value[0]);
  near(originalBounds[1][2], text.params.position.value[1]);
  moveText(doc, text, 2, [75, 20]);
  const moved = evaluate(layer, fonts);
  near(pathBounds(moved.path)[0][2], originalBounds[0][2] + 75);
  assert.ok(pathBounds(moved.path)[1][2] > originalBounds[1][2]);
  assert.deepEqual(moved.run(text.id, 'position'), options.position);
});

test('direct, converted and painted Text preserve one source occurrence and add no per-character paint groups', () => {
  const { doc, layer, text, add, out } = scene('BBO');
  let current = text;
  for (const type of ['Convert to Path', 'Text to Path', 'Fill', 'Stroke'])
    current = add(type, current);
  connect(layer, current.id, out.id, 'path');
  const before = evaluate(layer, fonts);
  const originalContours = before.path.contours.length;
  assert.equal((exportSVG(doc, fonts).match(/<path /g) || []).length, 1);
  moveText(doc, text, 1, [-22, 11]);
  const result = evaluate(layer, fonts);
  assert.equal(result.path.characterOccurrences.length, 1);
  assert.equal(result.path.characterOccurrences[0].source, text.id);
  assert.equal(result.path.characterOccurrences[0].reason, null);
  assert.deepEqual(result.path.characterOccurrences[0].matrix, identityMatrix());
  assert.equal(result.textLayout(text.id).characters.length, 3);
  assert.equal(result.path.contours.length, originalContours);
  assert.ok(result.path.contours.every((contour) => contour.group === undefined));
  const svg = exportSVG(doc, fonts);
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.doesNotMatch(svg, /<text|characterOccurrences|characterPositions/);
});

test('nested anchored, rotated and negative-scale matrices agree with evaluated geometry and inverse artboard deltas', () => {
  const { layer, text, add, out } = scene('B');
  const first = add('Transform', text),
    second = add('Transform', first);
  first.params.anchor.value = [70, 40];
  first.params.offset.value = [31, -14];
  first.params.scale.value = 2;
  first.params.rotation.value = 90;
  second.params.anchor.value = [-20, 60];
  second.params.offset.value = [-8, 17];
  second.params.scale.value = -0.75;
  second.params.rotation.value = 35;
  connect(layer, second.id, out.id, 'path');
  const result = evaluate(layer, fonts);
  assert.equal(result.error, null);
  const source = result.run(text.id),
    displayed = result.path;
  const matrix = displayed.characterOccurrences[0].matrix;
  const expected = multiplyMatrices(
    characterTransform(second.params.anchor.value, second.params.offset.value, -0.75, 35),
    characterTransform(first.params.anchor.value, first.params.offset.value, 2, 90),
  );
  nearVector(matrix, expected);
  displayed.contours.forEach((contour, ci) =>
    contour.points.forEach((point, pi) =>
      nearVector(
        point.position,
        transformCharacterPoint(matrix, source.contours[ci].points[pi].position),
      ),
    ),
  );
  const localDelta = inverseCharacterDelta(matrix, [20, -13]);
  const point = source.contours[0].points[0].position;
  const mappedStart = transformCharacterPoint(matrix, point);
  const mappedEnd = transformCharacterPoint(
    matrix,
    point.map((value, axis) => value + localDelta[axis]),
  );
  nearVector(
    mappedEnd.map((value, axis) => value - mappedStart[axis]),
    [20, -13],
  );
  nearVector(
    inverseCharacterDelta(characterTransform([45, 29], [108, -91], 2, 90), [20, 0]),
    [0, -10],
  );
  nearVector(
    inverseCharacterDelta(characterTransform([45, 29], [108, -91], -2, 90), [20, 0]),
    [0, 10],
  );
});

test('Join retains distinct input-edge routes for shared Text and all occurrences respond to one source adjustment', () => {
  const { doc, layer, text, add, out } = scene('AB');
  const left = add('Transform', text),
    right = add('Transform', text),
    join = add('Join Geometry');
  left.params.offset.value = [-120, 0];
  right.params.offset.value = [80, 50];
  right.params.rotation.value = 90;
  connect(layer, left.id, join.id, 'a');
  connect(layer, right.id, join.id, 'b');
  connect(layer, join.id, out.id, 'path');
  const orphan = add('Text');
  orphan.text = 'Orphan';
  const base = evaluate(layer, fonts);
  const before = structuredClone(base.path.contours);
  assert.equal(base.path.characterOccurrences.length, 2);
  assert.equal(
    new Set(base.path.characterOccurrences.map((occurrence) => occurrence.route)).size,
    2,
  );
  assert.ok(
    base.path.characterOccurrences.some((occurrence) => occurrence.route.includes(`${join.id}:a`)),
  );
  assert.ok(
    base.path.characterOccurrences.some((occurrence) => occurrence.route.includes(`${join.id}:b`)),
  );
  assert.ok(base.path.characterOccurrences.every((occurrence) => occurrence.source === text.id));
  assert.equal(new Set(base.path.contours.map((contour) => contour.group)).size, 2);
  moveText(doc, text, 0, [9, -4]);
  const moved = evaluate(layer, fonts);
  assert.notDeepEqual(moved.path.contours, before);
  const sourceBefore = base.run(text.id),
    sourceAfter = moved.run(text.id);
  const count = sourceBefore.contours.length;
  for (const [branch, occurrence] of moved.path.characterOccurrences.entries()) {
    for (let index = 0; index < count; index++) {
      moved.path.contours[branch * count + index].points.forEach((point, pi) =>
        nearVector(
          point.position,
          transformCharacterPoint(
            occurrence.matrix,
            sourceAfter.contours[index].points[pi].position,
          ),
        ),
      );
    }
  }
  assert.equal((exportSVG(doc, fonts).match(/<path /g) || []).length, 2);
});

test('unsupported Remap, Repeater and Boolean routes retain shared source data while supported Join branches remain editable', () => {
  for (const type of ['Path Remap', 'Geometry Repeater', 'Boolean']) {
    const { doc, layer, text, add, out } = scene('AB');
    moveText(doc, text, 0, [9, 2]);
    const unsupported = add(type);
    if (type === 'Boolean') {
      const rectangle = add('Rectangle');
      unsupported.operation = 'union';
      connect(layer, text.id, unsupported.id, 'a');
      connect(layer, rectangle.id, unsupported.id, 'b');
    } else connect(layer, text.id, unsupported.id, 'path');
    const join = add('Join Geometry');
    connect(layer, text.id, join.id, 'a');
    connect(layer, unsupported.id, join.id, 'b');
    connect(layer, join.id, out.id, 'path');
    const result = evaluate(layer, fonts);
    assert.equal(result.error, null, type);
    const occurrences = result.path.characterOccurrences;
    assert.equal(occurrences.length, 2, type);
    assert.equal(occurrences.filter((occurrence) => !occurrence.reason).length, 1, type);
    assert.match(occurrences.find((occurrence) => occurrence.reason).reason, new RegExp(type));
    assert.ok(occurrences.every((occurrence) => occurrence.source === text.id));
    assert.equal(result.textLayout(text.id).reason, null);
    assert.deepEqual(result.textLayout(text.id).characters[0].offset, [9, 2]);
    assert.doesNotThrow(
      () => exportSVG(doc, fonts),
      'unsupported canvas routing does not suspend successfully applied source offsets',
    );
  }
});

test('singular, near-zero, nonfinite and excessive inverse deltas reject instead of returning a guessed drag', () => {
  for (const matrix of [
    [0, 0, 0, 0, 10, 20],
    [1, 1, 1, 1, 0, 0],
    [1e-8, 0, 0, 1e-8, 0, 0],
    [1, 0, 0, 1e-15, 0, 0],
    [NaN, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, Infinity, 0],
  ])
    assert.throws(() => inverseCharacterDelta(matrix, [20, 10]), /singular|near-zero/);
  assert.throws(() => inverseCharacterDelta(identityMatrix(), [100001, 0]), /100000/);
  assert.throws(() => inverseCharacterDelta(identityMatrix(), [Infinity, 0]), /100000/);
  nearVector(
    inverseCharacterDelta([1, 0, 0, 1, 10000, -20000], [20, 10]),
    [20, 10],
    'translation never enters a delta',
  );
});

test('character boxes and hit tests use the selected displayed affine occurrence including negative scale', () => {
  const character = layoutText(font, 'B', options).characters[0];
  const matrix = characterTransform([40, 70], [60, -20], -1.5, 35);
  const corners = characterBoxPoints(character, matrix);
  const [x1, y1, x2, y2] = character.bounds;
  [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ].forEach((point, index) => nearVector(corners[index], transformCharacterPoint(matrix, point)));
  assert.equal(
    hitCharacter(
      character,
      matrix,
      transformCharacterPoint(matrix, [(x1 + x2) / 2, (y1 + y2) / 2]),
    ),
    true,
  );
  assert.equal(
    hitCharacter(character, matrix, transformCharacterPoint(matrix, [x2 + 20, y2 + 20])),
    false,
  );
  assert.equal(hitCharacter(character, [0, 0, 0, 0, 0, 0], [0, 0]), false);
});

test('character offset changes keep Text unstable and suspend downstream retained vertex edits', () => {
  const { doc, layer, text, add, out } = scene('AB');
  const remap = add('Path Remap', text);
  connect(layer, remap.id, out.id, 'path');
  const source = evaluate(layer, fonts).run(text.id);
  const edit = enableRemapPoint(remap, source, source.contours[0].points[0].id);
  edit.params.position.value = [3, 4];
  assert.deepEqual(evaluate(layer, fonts).warnings, []);
  moveText(doc, text, 1, [9, -2]);
  const result = evaluate(layer, fonts);
  assert.equal(result.run(text.id).unstable, true);
  assert.notEqual(result.run(text.id).fingerprint, source.fingerprint);
  assert.match(result.warnings.join(' '), /vertex edit suspended/);
  assert.equal(remap.edits.length, 1);
});

test('schema 3 roundtrip, duplicate Text and undo/redo retain independent offsets without persistent runtime metadata', () => {
  const { doc, layer, text, add, out } = scene();
  moveText(doc, text, 1, [12, -7]);
  const copied = structuredClone(text);
  copied.id = node('Text').id;
  layer.nodes.push(copied);
  const join = add('Join Geometry');
  connect(layer, text.id, join.id, 'a');
  connect(layer, copied.id, join.id, 'b');
  connect(layer, join.id, out.id, 'path');
  const before = serialize(doc),
    svg = exportSVG(doc, fonts);
  assert.equal(serialize(deserialize(before)), before);
  assert.equal(exportSVG(deserialize(before), fonts), svg);
  const history = new History(doc);
  history.apply((current) => {
    const changed = current.layers[0].nodes.find((item) => item.id === copied.id);
    moveText(current, changed, 1, [-6, 14]);
  });
  assert.deepEqual(text.characterPositions.offsets.c2, [12, -7]);
  assert.deepEqual(copied.characterPositions.offsets.c2, [-6, 14]);
  const after = serialize(history.doc);
  history.undo();
  assert.equal(serialize(history.doc), before);
  history.redo();
  assert.equal(serialize(history.doc), after);
  evaluate(history.doc.layers[0], fonts).textLayout(text.id);
  assert.doesNotMatch(
    serialize(history.doc),
    /characterOccurrences|sourceIndex|commandStart|characterReason/,
  );
});

test('malformed records and feature-bearing old schemas fail transactionally without replacing the open document', () => {
  const { doc } = scene('AB\nC');
  doc.schemaVersion = 3;
  const text = doc.layers[0].nodes[0];
  text.characterPositions = adjusted(text.text, 0, [12, -7]);
  const history = new History(doc),
    before = serialize(doc);
  const invalid = [
    (d, n) => {
      n.characterPositions.units[1].id = n.characterPositions.units[0].id;
    },
    (d, n) => {
      n.characterPositions.offsets.unknown = [1, 2];
    },
    (d, n) => {
      n.characterPositions.offsets.c3 = [1, 2];
    },
    (d, n) => {
      n.characterPositions.offsets.c1 = [null, 2];
    },
    (d, n) => {
      n.characterPositions.offsets.c1 = [100001, 2];
    },
    (d, n) => {
      n.characterPositions.basis = 'ABCD';
    },
    (d, n) => {
      n.characterPositions.version = 2;
    },
    (d, n) => {
      n.characterPositions.nextId = 1;
    },
    (d, n) => {
      n.characterPositions.units.push({ id: 'c10', text: 'X' });
    },
    (d, n) => {
      d.layers[0].nodes[1].characterPositions = n.characterPositions;
      delete n.characterPositions;
    },
    (d) => {
      d.schemaVersion = 2;
    },
    (d) => {
      d.schemaVersion = 1;
    },
  ];
  for (const mutate of invalid) {
    const candidate = structuredClone(doc);
    mutate(candidate, candidate.layers[0].nodes[0]);
    assert.throws(
      () =>
        history.apply(() => {
          history.doc = deserialize(JSON.stringify(candidate));
        }),
      /character|schemaVersion|basis|offset|ID/i,
    );
    assert.equal(serialize(history.doc), before);
    assert.equal(history.past.length, 0);
  }
  const candidate = structuredClone(doc);
  candidate.layers[0].nodes[0].characterPositions.offsets.c1 = [NaN, Infinity];
  assert.throws(() => validate(candidate), /finite/);
});

test('old v1/v2 projects and zero-offset records preserve preexisting outline geometry', () => {
  const { doc, layer, text } = scene('AV B');
  const original = pathData(evaluate(layer, fonts).path);
  const version2 = deserialize(serialize(doc));
  assert.equal(version2.schemaVersion, 2);
  assert.equal(pathData(evaluate(version2.layers[0], fonts).path), original);
  const legacy = structuredClone(doc);
  legacy.schemaVersion = 1;
  legacy.layers[0].nodes.find((item) => item.type === 'Output').params.path.type = 'Path';
  const version1 = deserialize(serialize(legacy));
  assert.equal(pathData(evaluate(version1.layers[0], fonts).path), original);
  assert.equal(
    version1.layers[0].nodes.find((item) => item.id === text.id).characterPositions,
    undefined,
  );
  doc.schemaVersion = 3;
  text.characterPositions = createCharacterPositions(text.text);
  assert.equal(pathData(evaluate(layer, fonts).path), original);
});

test('headless export reproduces adjusted embedded-font outlines byte-for-byte', () => {
  const { doc, layer, text } = scene('日本ABC');
  const asset = makeFontAsset(japaneseBytes, 'character-position-fixture.otf');
  doc.fontAssets = { [asset.id]: asset.asset };
  text.font = asset.id;
  text.writingMode = 'vertical-rl';
  moveText(doc, text, 2, [12, -7]);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-character-position-'));
  try {
    const input = path.join(temporary, 'project.json'),
      output = path.join(temporary, 'output.svg');
    fs.writeFileSync(input, serialize(doc));
    const result = spawnSync(process.execPath, ['cli/export.js', input, output], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), exportSVG(doc));
    assert.equal(
      evaluate(layer, { [asset.id]: asset.font }).textLayout(text.id).characters.length,
      5,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('supplementary code points remain one selectable character with the correct following logical ID', () => {
  const raw = 'A😀B';
  assert.ok(font.charToGlyphIndex('😀'), 'the fixture contains a supplementary code point');
  const record = adjusted(raw, 1, [12, -7]);
  const base = layoutText(font, raw, options);
  const moved = layoutText(font, raw, { ...options, characterPositions: record });
  assert.equal(moved.characterReason, null);
  assert.deepEqual(
    moved.characters.map((character) => [character.id, character.text, character.sourceIndex]),
    [
      ['c1', 'A', 0],
      ['c2', '😀', 1],
      ['c3', 'B', 2],
    ],
  );
  assertTranslated(commandsFor(moved, 1), commandsFor(base, 1), [12, -7]);
  assertTranslated(commandsFor(moved, 2), commandsFor(base, 2), [0, 0]);
});

test('a stale unadjusted basis never exposes duplicate or incorrectly reused character IDs', () => {
  const record = {
    version: 1,
    basis: 'AB',
    units: [
      { id: 'c3', text: 'A' },
      { id: 'c4', text: 'B' },
    ],
    offsets: {},
    nextId: 5,
  };
  const before = JSON.stringify(record);
  const layout = layoutText(font, 'ABC', { ...options, characterPositions: record });
  assert.equal(layout.characterReason, null);
  assert.equal(layout.characterSuspended, false);
  assert.equal(new Set(layout.characters.map((character) => character.id)).size, 3);
  assert.deepEqual(
    layout.characters.map((character) => character.text),
    ['A', 'B', 'C'],
  );
  assert.equal(JSON.stringify(record), before);
});

test('cached source character metadata cannot be corrupted by an earlier evaluation result', () => {
  const { layer, text } = scene('AB');
  const result = evaluate(layer, fonts);
  const original = structuredClone(result.textLayout(text.id));
  const exposed = result.textLayout(text.id);
  // Either immutable return values or defensive copies satisfy the cache boundary.
  try {
    exposed.characters[0].bounds[0] += 12345;
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
  try {
    exposed.characters[0].offset[0] = 77;
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
  assert.deepEqual(evaluate(layer, fonts).textLayout(text.id), original);
});

test('hit testing allows valid distant source positions transformed into view', () => {
  const glyph = { bounds: [100010, 60, 100050, 100] };
  assert.equal(hitCharacter(glyph, [1, 0, 0, 1, -100000, 0], [30, 80]), true);
  assert.equal(hitCharacter(glyph, [1, 0, 0, 1, -100000, 0], [80, 80]), false);
  assert.throws(() => inverseCharacterDelta([1, 0, 0, 1, 0, 0], [100001, 0]), /100000/);
});

test('display provenance matches Paper rotation even at large finite angles', () => {
  for (const rotation of [1e16, 1e20, -1e20]) {
    const { layer, text, out, add } = scene('A'),
      tr = add('Transform', text);
    tr.params.anchor.value = [120, 80];
    tr.params.offset.value = [30, -20];
    tr.params.rotation.value = rotation;
    connect(layer, tr.id, out.id, 'path');
    const result = evaluate(layer, fonts),
      source = result.run(text.id),
      matrix = result.path.characterOccurrences[0].matrix;
    source.contours.forEach((contour, ci) =>
      contour.points.forEach((point, pi) =>
        nearVector(
          result.path.contours[ci].points[pi].position,
          transformCharacterPoint(matrix, point.position),
        ),
      ),
    );
  }
});
