import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import {
  document,
  node,
  layer,
  connect,
  disconnect,
  evaluate,
  exportSVG,
  renderElement,
  pathData,
  pathBounds,
  serialize,
  deserialize,
  validate,
  History,
  outputType,
  createCharacterPositions,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import { importSVG } from '../src/svg-import.js';
const Parser = new Window().DOMParser;
function scene() {
  const doc = document(),
    l = doc.layers[0],
    shape = node('Rectangle'),
    gradient = node('Linear Gradient Fill'),
    out = node('Output');
  l.nodes = [shape, gradient, out];
  l.output = out.id;
  connect(l, shape.id, gradient.id, 'path');
  connect(l, gradient.id, out.id, 'path');
  return { doc, l, shape, gradient, out };
}
function append(l, type, source) {
  const n = node(type);
  l.nodes.push(n);
  connect(l, source.id, n.id, 'path');
  return n;
}
const xml = (svg) => new Parser().parseFromString(svg, 'image/svg+xml');

test('gradient replaces only fill, preserving independent strokes, geometry, bounds and upstream cache', () => {
  const { doc, l, shape, gradient, out } = scene(),
    stroke = append(l, 'Stroke', shape);
  stroke.params.color.value = { hex: '#00ff00', alpha: 0.4 };
  stroke.params.width.value = 6;
  connect(l, stroke.id, gradient.id, 'path');
  const r = evaluate(l),
    before = r.run(stroke.id);
  assert.equal(r.error, null);
  assert.equal(r.path.fill.kind, 'linear-gradient');
  assert.deepEqual(r.path.contours, before.contours);
  assert.deepEqual(r.path.stroke, before.stroke);
  assert.deepEqual(pathBounds(r.path), pathBounds(before));
  assert.equal(pathData(r.path), pathData(before));
  assert.equal(before.fill, undefined);
  const lastStroke = append(l, 'Stroke', gradient);
  connect(l, lastStroke.id, out.id, 'path');
  assert.deepEqual(evaluate(l).path.fill, r.path.fill);
  const solid = append(l, 'Fill', lastStroke);
  connect(l, solid.id, out.id, 'path');
  assert.deepEqual(evaluate(l).path.fill, solid.params.color.value);
  assert.doesNotMatch(exportSVG(doc), /linearGradient|url\(#/);
  assert.throws(() => connect(l, solid.id, gradient.id, 'path'), /cycle/); // no mutation
});

test('gradient socket boundary accepts bare and painted paths and rejects all geometry consumers', () => {
  const { doc, l, shape, gradient, out } = scene();
  assert.equal(outputType(gradient), 'PaintedPath');
  for (const type of [
    'Boolean',
    'Join Geometry',
    'Transform',
    'Path Remap',
    'Convert to Path',
    'Text to Path',
    'Geometry Repeater',
  ]) {
    const n = node(type);
    l.nodes.push(n);
    assert.throws(
      () =>
        connect(l, gradient.id, n.id, ['Boolean', 'Join Geometry'].includes(type) ? 'a' : 'path'),
      /PaintedPath to Path/,
    );
  }
  const color = node('Color'),
    vector = node('Vector'),
    scalar = node('Value');
  l.nodes.push(color, vector, scalar);
  for (const key of ['start', 'end'])
    assert.throws(() => connect(l, color.id, gradient.id, key), /Color to Vector2/);
  for (const key of ['startColor', 'endColor'])
    assert.throws(() => connect(l, vector.id, gradient.id, key), /Vector2 to Color/);
  assert.throws(() => connect(l, scalar.id, gradient.id, 'path'), /Scalar to PaintedPath/);
  assert.throws(() => connect(l, out.id, gradient.id, 'path'), /cycle/);
  gradient.params.start.source = color.id;
  assert.throws(() => validate(doc), /Color to Vector2/);
  assert.match(evaluate(l).error, /Incompatible socket/);
  delete gradient.params.start.source;
  assert.equal(evaluate(l).error, null);
  assert.equal(evaluate(l).run(shape.id).fill, undefined);
});

test('gradient sources, expressions, saved fallbacks, locks, history and JSON retain independent values', () => {
  const { doc, l, gradient } = scene(),
    v = node('Vector'),
    c = node('Color');
  l.nodes.push(v, c);
  v.params.value.value = [10, 20];
  c.params.value.value = { hex: '#123456', alpha: 0 };
  const fallback = structuredClone(gradient.params);
  connect(l, v.id, gradient.id, 'start');
  connect(l, c.id, gradient.id, 'endColor');
  assert.deepEqual(evaluate(l).path.fill.start, [10, 20]);
  assert.equal(evaluate(l).path.fill.endColor.alpha, 0);
  assert.deepEqual(gradient.params.start.value, fallback.start.value);
  const h = new History(doc);
  h.apply(() => {
    gradient.params.start.locked = true;
  });
  assert.throws(() => disconnect(gradient, 'start'), /locked/);
  assert.throws(() => connect(l, v.id, gradient.id, 'start'), /locked/);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  h.undo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === gradient.id).params.start.locked, false);
  h.redo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === gradient.id).params.start.locked, true);
  gradient.params.start.locked = false;
  disconnect(gradient, 'start');
  disconnect(gradient, 'endColor');
  assert.deepEqual(evaluate(l).path.fill.start, fallback.start.value);
  assert.deepEqual(evaluate(l).path.fill.endColor, fallback.endColor.value);
  gradient.params.start.expression = '5 * 2; 7 + 3';
  assert.deepEqual(evaluate(l).path.fill.start, [10, 10]);
  gradient.params.end.expression = '10; 10';
  assert.match(evaluate(l).error, /finite, nonzero/);
  assert.throws(() => exportSVG(doc), /finite, nonzero/);
});

test('invalid gradient fallbacks and unsafe colors are rejected atomically, including dormant nodes', () => {
  const { doc, l, shape, gradient, out } = scene();
  connect(l, shape.id, out.id, 'path');
  const h = new History(doc),
    before = serialize(doc);
  assert.throws(
    () =>
      h.apply(() => {
        gradient.params.end.value = [...gradient.params.start.value];
        validate(doc);
      }),
    /finite, nonzero/,
  );
  assert.equal(serialize(h.doc), before);
  assert.equal(h.past.length, 0);
  for (const [key, value] of [
    ['start', [Infinity, 1]],
    ['endColor', { hex: 'url(#evil)', alpha: 1 }],
    ['startColor', { hex: '#ff0000', alpha: -1 }],
  ]) {
    const bad = deserialize(before);
    bad.layers[0].nodes.find((n) => n.id === gradient.id).params[key].value = value;
    assert.throws(() => validate(bad));
  }
});

test('one stable paint server per layer is reused for joined and repeated groups without ID collisions', () => {
  const { doc, l, shape, gradient } = scene(),
    b = node('Rectangle'),
    join = node('Join Geometry'),
    repeat = node('Geometry Repeater');
  l.nodes.push(b, join, repeat);
  connect(l, shape.id, join.id, 'a');
  connect(l, b.id, join.id, 'b');
  connect(l, join.id, repeat.id, 'path');
  repeat.params.count.value = 3;
  connect(l, repeat.id, gradient.id, 'path');
  const other = scene();
  other.l.id = '1:long-' + 'x'.repeat(170);
  other.l.name = l.name;
  doc.layers.push(other.l);
  const guide = layer('Hidden guide');
  guide.guide = true;
  doc.layers.unshift(guide);
  const first = exportSVG(doc),
    dom = xml(first),
    defs = [...dom.querySelectorAll('linearGradient')];
  assert.equal(first, exportSVG(doc));
  assert.equal(defs.length, 2);
  assert.deepEqual(
    defs.map((g) => g.id),
    ['nect-gradient-1', 'nect-gradient-2'],
  );
  assert.equal(new Set(defs.map((g) => g.id)).size, 2);
  const grouped = dom.querySelector('g');
  assert.equal(grouped.querySelectorAll('path').length, 6);
  for (const p of grouped.querySelectorAll('path'))
    assert.equal(p.getAttribute('fill'), 'url(#nect-gradient-1)');
  assert.equal(grouped.querySelectorAll('defs').length, 0);
  const result = evaluate(l);
  assert.deepEqual(result.path.contours, result.run(repeat.id).contours);
  assert.deepEqual(result.path.fill.start, gradient.params.start.value);
});

test('gradient SVG carries absolute endpoints, stop alpha, sRGB and pad without changing path or old solid markup', () => {
  const { doc, l, shape, gradient, out } = scene();
  gradient.params.start.value = [-10, 20];
  gradient.params.end.value = [110, 50];
  gradient.params.startColor.value = { hex: '#ff0000', alpha: 0 };
  gradient.params.endColor.value = { hex: '#0000ff', alpha: 0.625 };
  const dom = xml(exportSVG(doc)),
    g = dom.querySelector('linearGradient');
  for (const [k, v] of Object.entries({
    gradientUnits: 'userSpaceOnUse',
    x1: '-10',
    y1: '20',
    x2: '110',
    y2: '50',
    spreadMethod: 'pad',
    'color-interpolation': 'sRGB',
  }))
    assert.equal(g.getAttribute(k), v);
  assert.deepEqual(
    [...g.querySelectorAll('stop')].map((s) => s.getAttribute('stop-opacity')),
    ['0', '0.625'],
  );
  assert.equal(dom.querySelector('path').hasAttribute('fill-opacity'), false);
  assert.equal(dom.querySelector('path').getAttribute('d'), pathData(evaluate(l).run(shape.id)));
  assert.deepEqual(
    evaluate(importSVG(exportSVG(doc), Parser).layers[0]).path.fill,
    evaluate(l).path.fill,
  );
  const fill = append(l, 'Fill', shape);
  fill.params.color.value = { hex: '#12abEF', alpha: 0.375 };
  connect(l, fill.id, out.id, 'path');
  assert.equal(
    renderElement(evaluate(l).path, l),
    `<path  data-layer="${l.name}" d="${pathData(evaluate(l).path)}" fill="#12abEF" fill-opacity="0.375" fill-rule="nonzero"/>`,
  );
});

test('gradient paint keeps text character identity and occurrence metadata unchanged', () => {
  const { doc, l, gradient } = scene(),
    text = node('Text');
  text.text = 'AB';
  doc.schemaVersion = 3;
  text.characterPositions = createCharacterPositions(text.text);
  l.nodes.push(text);
  connect(l, text.id, gradient.id, 'path');
  const data = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
  const font = parseFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    r = evaluate(l, { default: font }),
    source = r.run(text.id);
  assert.equal(r.error, null);
  assert.ok(source.characterOccurrences.length > 0);
  assert.deepEqual(r.path.characterOccurrences, source.characterOccurrences);
  assert.deepEqual(r.path.contours, source.contours);
  assert.equal(pathData(r.path), pathData(source));
  const imported = importSVG(exportSVG(doc, { default: font }), Parser);
  assert.ok(imported.layers[0].nodes.every((n) => n.type !== 'Text'));
  assert.equal(pathData(evaluate(imported.layers[0]).path), pathData(r.path));
  assert.deepEqual(evaluate(imported.layers[0]).path.fill, r.path.fill);
});

test('editable gradient sample roundtrips with byte-identical CLI SVG', () => {
  const sample = new URL('../examples/linear-gradient-fill.json', import.meta.url),
    doc = deserialize(fs.readFileSync(sample, 'utf8'));
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-gradient-'));
  try {
    const out = path.join(temp, 'sample.svg');
    execFileSync(process.execPath, ['cli/export.js', fileURLToPath(sample), out], {
      cwd: new URL('..', import.meta.url),
    });
    assert.equal(fs.readFileSync(out, 'utf8'), exportSVG(doc));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
