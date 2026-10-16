import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import { createHash } from 'node:crypto';
import { fingerprint } from '../src/fingerprint.js';
import {
  document,
  node,
  connect,
  evaluate,
  validate,
  serialize,
  deserialize,
  exportSVG,
  History,
  activeParameters,
  setOperation,
  enableRemapPoint,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import { layoutText } from '../src/text-layout.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    shape = node('Curve'),
    repeat = node('Geometry Repeater'),
    fill = node('Fill'),
    out = node('Output');
  l.nodes = [shape, repeat, fill, out];
  l.output = out.id;
  connect(l, shape.id, repeat.id, 'path');
  connect(l, repeat.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  return { doc, l, shape, repeat, fill, out };
}
test('linear geometry repeater preserves open curves, handles, unique IDs and paint boundary', () => {
  const { doc, l, shape, repeat, fill } = scene();
  shape.params.closed.value = false;
  shape.points[0].handleB.value = [20, -10];
  repeat.params.count.value = 3;
  repeat.params.step.value = [12, -5];
  const r = evaluate(l);
  assert.equal(r.error, null);
  assert.equal(r.path.contours.length, 3);
  assert.deepEqual(r.path.contours[2].points[0].position, [274, 140]);
  assert.deepEqual(r.path.contours[2].points[0].handleB, [20, -10]);
  assert.equal(r.path.contours[2].closed, false);
  assert.equal(new Set(r.path.contours.flatMap((c) => c.points.map((p) => p.id))).size, 9);
  assert.deepEqual(r.run(shape.id).contours[0].points[0].position, [250, 150]);
  assert.throws(() => connect(l, fill.id, repeat.id, 'path'), /PaintedPath/);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  assert.match(exportSVG(doc), /<path/);
  assert.equal(evaluate(l).stats.computed, 0);
});
test('radial fit has full-ring versus inclusive arc semantics and rotates relative handles', () => {
  const { l, shape, repeat } = scene();
  repeat.params.count.value = 4;
  repeat.params.center.value = [250, 150];
  shape.points[0].handleB.value = [20, 0];
  setOperation(l, repeat.id, 'radial-fit');
  let r = evaluate(l);
  assert.equal(r.error, null);
  const handle = r.path.contours[1].points[0].handleB;
  assert.ok(Math.abs(handle[0]) < 1e-9);
  assert.equal(handle[1], 20);
  repeat.params.angle.value = 180;
  r = evaluate(l);
  assert.ok(Math.abs(r.path.contours[3].points[0].handleB[0] + 20) < 1e-9);
  repeat.params.count.value = 1;
  repeat.params.startAngle.value = 90;
  r = evaluate(l);
  assert.ok(Math.abs(r.path.contours[0].points[0].handleB[0]) < 1e-9);
  repeat.params.count.value = 3;
  repeat.params.angle.value = -45;
  repeat.params.startAngle.value = 0;
  setOperation(l, repeat.id, 'radial-step');
  r = evaluate(l);
  assert.ok(Math.abs(r.path.contours[2].points[0].handleB[1] + 20) < 1e-9);
  assert.deepEqual(
    activeParameters(repeat).map(([k]) => k),
    ['path', 'count', 'center', 'startAngle', 'angle'],
  );
});
test('repeater count, fit arc, finite outputs and nested expansion are bounded, history retains hidden values', () => {
  const { doc, l, repeat, shape } = scene();
  for (const count of [0, 1.1, 257]) {
    repeat.params.count.value = count;
    assert.match(evaluate(l).error, /count/);
    assert.throws(() => validate(doc), /count/);
  }
  repeat.params.count.value = 2;
  repeat.params.step.value = [Number.MAX_VALUE, 0];
  assert.equal(evaluate(l).error, null);
  repeat.params.count.value = 3;
  assert.match(evaluate(l).error, /finite|Invalid|Expected/);
  repeat.params.step.value = [60, 0];
  repeat.operation = 'radial-fit';
  repeat.params.angle.value = 361;
  assert.match(evaluate(l).error, /arc/);
  repeat.params.angle.value = 360;
  repeat.operation = 'linear';
  repeat.params.count.value = 256;
  const second = node('Geometry Repeater');
  l.nodes.push(second);
  connect(l, repeat.id, second.id, 'path');
  second.params.count.value = 256;
  assert.throws(() => evaluate(l).run(second.id), /budget/);
  const h = new History(doc);
  h.apply(() => setOperation(l, repeat.id, 'radial-step'));
  h.undo();
  assert.equal(h.doc.layers[0].nodes[1].operation, 'linear');
  h.redo();
  assert.equal(h.doc.layers[0].nodes[1].operation, 'radial-step');
  assert.deepEqual(shape.points[0].position.value, [250, 150]);
});
const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
test('text anchors use signed shaped advance, whitespace and per-line/column shifts without trailing tracking', () => {
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const opts = {
      position: [200, 100],
      size: 40,
      letterSpacing: 7,
      lineSpacing: 1.5,
      writingMode,
    };
    const start = layoutText(font, 'AV \nA\n', opts);
    const center = layoutText(font, 'AV \nA\n', { ...opts, alignment: 'center' });
    const end = layoutText(font, 'AV \nA\n', { ...opts, alignment: 'end' });
    const axis = writingMode === 'horizontal-tb' ? 'x' : 'y';
    for (let i = 0; i < start.glyphs.length; i++) {
      const g = start.glyphs[i];
      assert.ok(Math.abs(center.glyphs[i][axis] - (g[axis] - start.advances[g.line] / 2)) < 1e-8);
      assert.ok(Math.abs(end.glyphs[i][axis] - (g[axis] - start.advances[g.line])) < 1e-8);
    }
    assert.equal(start.advances[2], 0);
    const single = layoutText(font, 'A', opts),
      noTracking = layoutText(font, 'A', { ...opts, letterSpacing: 0 });
    assert.equal(single.advances[0], noTracking.advances[0]);
    const negative = layoutText(font, 'AA', { ...opts, letterSpacing: -1000, alignment: 'end' });
    assert.ok(negative.advances[0] < 0);
  }
  const kernFont = new opentype.Font({
    familyName: 'Test',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ index: 0, name: '.notdef', advanceWidth: 600 }),
      new opentype.Glyph({ index: 1, name: 'A', unicode: 65, advanceWidth: 600 }),
      new opentype.Glyph({ index: 2, name: 'V', unicode: 86, advanceWidth: 600 }),
    ],
  });
  kernFont.kerningPairs = { '1,2': -100 };
  const on = layoutText(kernFont, 'AV', { position: [0, 0], size: 100 }),
    off = layoutText(kernFont, 'AV', { position: [0, 0], size: 100, kerning: false });
  assert.ok(on.advances[0] < off.advances[0]);
  assert.throws(
    () => layoutText(font, 'A', { position: [0, 0], size: 40, alignment: 'justify' }),
    /alignment/,
  );
});
test('text anchor defaults, cache invalidation, validation, JSON and history preserve editable choices', () => {
  const doc = document(),
    l = doc.layers[0],
    text = node('Text'),
    fill = node('Fill'),
    out = node('Output');
  l.nodes = [text, fill, out];
  l.output = out.id;
  connect(l, text.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  const fonts = { default: font };
  const start = evaluate(l, fonts).path;
  delete text.alignment;
  delete text.kerning;
  assert.deepEqual(evaluate(l, fonts).path, start);
  const h = new History(doc);
  h.apply(() => {
    text.alignment = 'end';
    text.kerning = false;
  });
  assert.notDeepEqual(evaluate(l, fonts).path, start);
  assert.equal(deserialize(serialize(doc)).layers[0].nodes[0].alignment, 'end');
  assert.match(exportSVG(doc, fonts), /<path/);
  h.undo();
  assert.deepEqual(evaluate(h.doc.layers[0], fonts).path, start);
  h.redo();
  assert.equal(h.doc.layers[0].nodes[0].alignment, 'end');
  text.alignment = 'justify';
  assert.throws(() => validate(doc), /alignment/);
  text.alignment = 'start';
  text.kerning = 1;
  assert.throws(() => validate(doc), /kerning/);
});

test('bounded fingerprints match SHA-256 and nested repeated Remap survives JSON', () => {
  for (const value of ['', 'abc', '日本語', 'x'.repeat(100000)])
    assert.equal(fingerprint(value), 'sha256:' + createHash('sha256').update(value).digest('hex'));
  const { doc, l, repeat, fill } = scene();
  repeat.params.count.value = 256;
  let source = repeat;
  for (const count of [8, 1, 1]) {
    const next = node('Geometry Repeater');
    next.params.count.value = count;
    l.nodes.push(next);
    connect(l, source.id, next.id, 'path');
    source = next;
  }
  const remap = node('Path Remap');
  l.nodes.push(remap);
  connect(l, source.id, remap.id, 'path');
  connect(l, remap.id, fill.id, 'path');
  const before = evaluate(l).run(source.id);
  assert.equal(before.fingerprint.length, 71);
  assert.ok(before.contours[0].points[0].id.length < 181);
  enableRemapPoint(remap, before, before.contours[0].points[0].id);
  assert.doesNotThrow(() => deserialize(serialize(doc)));
  repeat.params.step.value = [61, 0];
  assert.notEqual(evaluate(l).run(source.id).fingerprint, before.fingerprint);
  assert.match(evaluate(l).warnings.join(' '), /suspended/);
});
