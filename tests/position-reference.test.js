import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import { layoutText } from '../src/text-layout.js';
import {
  document,
  node,
  connect,
  evaluate,
  pathBounds,
  pathData,
  validate,
  serialize,
  deserialize,
  History,
} from '../src/core.js';
const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00002, `${a} != ${b}`);
function scene(type = 'Text') {
  const doc = document(),
    l = doc.layers[0],
    n = node(type),
    out = node(type === 'Image' ? 'Image Output' : 'Output');
  l.nodes = [n, out];
  l.output = out.id;
  connect(l, n.id, out.id, 'path');
  return { doc, l, n, out };
}
test('visible right references align different text, fonts and sizes at precisely the same Position', () => {
  const second = new opentype.Font({
    familyName: 'Test',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({
        name: 'A',
        unicode: 65,
        advanceWidth: 800,
        path: Object.assign(new opentype.Path(), {
          commands: [
            { type: 'M', x: 35, y: 0 },
            { type: 'L', x: 620, y: 0 },
            { type: 'L', x: 400, y: 750 },
            { type: 'Z' },
          ],
        }),
      }),
    ],
  });
  second.kerningPairs = {};
  for (const [f, text, size] of [
    [font, 'Nect', 100],
    [font, 'small subtitle', 24],
    [second, 'AAA', 53],
  ]) {
    const { l, n } = scene();
    n.text = text;
    n.alignment = 'end';
    n.params.size.value = size;
    n.params.position.value = [500, 300];
    const result = evaluate(l, { default: f });
    assert.equal(result.error, null);
    near(pathBounds(result.path)[0][2], 500);
  }
});
test('multiline and vertical visible references hold every line/column and whole-block bottom/right', () => {
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const options = {
      position: [500, 300],
      size: 45,
      alignment: 'end',
      crossAlignment: 'end',
      referenceBounds: 'visible',
      writingMode,
    };
    for (const text of ['Nect\nsubtitle', 'A\nA much longer line']) {
      const r = layoutText(font, text, options),
        bounds = r.path.getBoundingBox();
      near(bounds.x2, 500);
      near(bounds.y2, 300);
      for (let line = 0; line < 2; line++) {
        // Each run separately reaches the same inline reference as the multiline result.
        const single = layoutText(font, text.split('\n')[line], options).path.getBoundingBox();
        near(
          writingMode === 'horizontal-tb' ? single.x2 : single.y2,
          writingMode === 'horizontal-tb' ? 500 : 300,
        );
      }
    }
  }
  for (const text of ['', '   ', '\n\n']) {
    const result = layoutText(font, text, {
      position: [500, 300],
      size: 20,
      alignment: 'end',
      crossAlignment: 'end',
      referenceBounds: 'visible',
    });
    assert.ok(result.glyphs.every((g) => Number.isFinite(g.x) && Number.isFinite(g.y)));
    assert.ok(!/NaN|Infinity/.test(result.path.toPathData()));
  }
});
test('missing text reference fields preserve legacy advance SVG exactly, including negative spacing', () => {
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const { doc, l, n } = scene();
    delete n.referenceBounds;
    delete n.crossAlignment;
    n.writingMode = writingMode;
    n.alignment = 'end';
    n.text = 'Nect \n  A';
    n.params.letterSpacing.value = -30;
    const before = pathData(evaluate(l, { default: font }).path);
    n.referenceBounds = 'advance';
    n.crossAlignment = 'origin';
    assert.equal(pathData(evaluate(l, { default: font }).path), before);
    const loaded = deserialize(serialize(doc));
    assert.equal(pathData(evaluate(loaded.layers[0], { default: font }).path), before);
  }
});
test('shape bounds reference holds resized geometry, preserves legacy asymmetric origin and invalidates cache', () => {
  for (const type of ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star']) {
    const { doc, l, n } = scene(type);
    if (type === 'Polygon') n.params.sides.value = 3;
    const before = pathData(evaluate(l).path);
    n.positionReference = 'origin';
    assert.equal(pathData(evaluate(l).path), before);
    n.params.center.value = [500, 300];
    n.positionReference = 'right-bottom';
    let r = evaluate(l);
    near(pathBounds(r.path)[0][2], 500);
    near(pathBounds(r.path)[1][2], 300);
    assert.equal(evaluate(l).stats.computed, 0);
    if (n.params.size) n.params.size.value = [310, 90];
    else n.params[type === 'Star' ? 'outerRadius' : 'radius'].value = 150;
    r = evaluate(l);
    near(pathBounds(r.path)[0][2], 500);
    near(pathBounds(r.path)[1][2], 300);
    const old = pathData(r.path);
    n.positionReference = 'left-top';
    assert.notEqual(pathData(evaluate(l).path), old);
    validate(doc);
  }
});
test('image reference uses full rectangle; driven Position, history, JSON and malformed fields', () => {
  const { doc, l, n } = scene('Image');
  n.asset = 'image-test';
  doc.imageAssets = {
    'image-test': {
      name: 'red.png',
      mime: 'image/png',
      width: 1,
      height: 1,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    },
  };
  const v = node('Vector');
  v.params.value.value = [500, 300];
  l.nodes.push(v);
  connect(l, v.id, n.id, 'position');
  n.positionReference = 'right-bottom';
  for (const size of [
    [100, 50],
    [320, 240],
  ]) {
    n.params.size.value = size;
    const b = pathBounds(evaluate(l, {}, doc.imageAssets).path);
    near(b[0][2], 500);
    near(b[1][2], 300);
  }
  const h = new History(doc);
  h.apply((d) => {
    d.layers[0].nodes[0].positionReference = 'left-top';
  });
  h.undo();
  assert.equal(h.doc.layers[0].nodes[0].positionReference, 'right-bottom');
  h.redo();
  assert.equal(h.doc.layers[0].nodes[0].positionReference, 'left-top');
  const loaded = deserialize(serialize(doc));
  assert.equal(loaded.layers[0].nodes[0].positionReference, 'left-top');
  n.positionReference = ['right-bottom'];
  assert.throws(() => validate(doc), /Position reference/);
  n.positionReference = 'invalid';
  assert.throws(() => validate(doc), /Position reference/);
});
