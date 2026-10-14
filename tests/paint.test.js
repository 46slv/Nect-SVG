import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  document,
  node,
  connect,
  evaluate,
  exportSVG,
  serialize,
  deserialize,
  validate,
  History,
  outputType,
  socketCompatible,
} from '../src/core.js';
import { importSVG } from '../src/svg-import.js';

function scene() {
  const doc = document(),
    l = doc.layers[0],
    shape = node('Rectangle'),
    out = node('Output');
  l.nodes = [shape, out];
  l.output = out.id;
  connect(l, shape.id, out.id, 'path');
  return { doc, l, shape, out };
}
function append(l, type, source) {
  const n = node(type);
  l.nodes.push(n);
  connect(l, source.id, n.id, 'path');
  return n;
}
test('bare geometry is unpainted; Fill and Stroke preserve independent channels without mutating branches', () => {
  const { doc, l, shape, out } = scene();
  assert.match(exportSVG(doc), /fill="none"/);
  const fill = append(l, 'Fill', shape),
    stroke = append(l, 'Stroke', fill),
    fill2 = append(l, 'Fill', stroke);
  fill.params.color.value = { hex: '#ff0000', alpha: 0.25 };
  stroke.params.color.value = { hex: '#00ff00', alpha: 0.5 };
  stroke.params.width.value = 8;
  fill2.params.color.value = { hex: '#0000ff', alpha: 0 };
  connect(l, fill2.id, out.id, 'path');
  const r = evaluate(l);
  assert.equal(r.error, null);
  assert.deepEqual(r.path.fill, fill2.params.color.value);
  assert.deepEqual(r.path.stroke, {
    hex: '#00ff00',
    alpha: 0.5,
    width: 8,
    cap: 'butt',
    join: 'miter',
    dash: [],
    miterLimit: 4,
    dashOffset: 0,
  });
  assert.equal(r.run(shape.id).fill, undefined);
  assert.equal(r.run(shape.id).stroke, undefined);
  assert.equal(r.run(fill.id).stroke, undefined);
  assert.deepEqual(r.run(fill.id).fill, fill.params.color.value);
  assert.deepEqual(evaluate(l).path, r.path);
  assert.match(
    exportSVG(doc),
    /fill="#0000ff" fill-opacity="0".*stroke="#00ff00" stroke-opacity="0.5" stroke-width="8"/,
  );
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const again = append(l, 'Stroke', fill2);
  again.params.width.value = 0;
  connect(l, again.id, out.id, 'path');
  assert.equal(evaluate(l).path.stroke.width, 0);
  assert.deepEqual(evaluate(l).path.fill, fill2.params.color.value);
});
test('paint order permits geometry then paint; typed compatibility is shared, and geometry rejects PaintedPath', () => {
  const { l, shape, out } = scene();
  const transform = append(l, 'Transform', shape),
    stroke = append(l, 'Stroke', transform),
    fill = append(l, 'Fill', stroke);
  assert.equal(outputType(fill), 'PaintedPath');
  assert.equal(socketCompatible('Path', 'PaintedPath'), true);
  assert.equal(socketCompatible('PaintedPath', 'Path'), false);
  for (const type of ['Transform', 'Path Remap', 'Convert to Path', 'Text to Path', 'Boolean']) {
    const n = node(type);
    l.nodes.push(n);
    assert.throws(
      () => connect(l, stroke.id, n.id, type === 'Boolean' ? 'a' : 'path'),
      /Cannot connect PaintedPath to Path/,
    );
  }
  connect(l, fill.id, out.id, 'path');
  assert.equal(evaluate(l).error, null);
  assert.throws(() => connect(l, out.id, stroke.id, 'path'), /cycle/);
});
test('Stroke color sources and width sources preserve fallback, zero, locks, and history', () => {
  const { doc, l, shape, out } = scene(),
    stroke = append(l, 'Stroke', shape),
    color = node('Color'),
    width = node('Value');
  l.nodes.push(color, width);
  connect(l, stroke.id, out.id, 'path');
  color.params.value.value = { hex: '#123456', alpha: 0 };
  width.params.value.value = 0;
  connect(l, color.id, stroke.id, 'color');
  connect(l, width.id, stroke.id, 'width');
  const h = new History(doc);
  h.apply(() => {
    stroke.params.width.locked = true;
  });
  assert.equal(evaluate(l).path.stroke.width, 0);
  assert.equal(evaluate(l).path.stroke.alpha, 0);
  assert.throws(() => connect(l, width.id, stroke.id, 'width'), /locked/);
  assert.doesNotThrow(() => deserialize(serialize(doc)));
  h.undo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === stroke.id).params.width.locked, false);
  h.redo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === stroke.id).params.width.locked, true);
  for (const bad of [-1, 100001, Infinity, NaN]) {
    width.params.value.value = bad;
    assert.ok(evaluate(l).error);
  }
});
function legacy(fill) {
  const { doc, l, shape, out } = scene();
  doc.schemaVersion = 1;
  l.fill = '#123456';
  out.params.path.type = 'Path';
  if (fill !== undefined) out.params.fill = structuredClone(fill);
  return { doc, l, shape, out };
}
test('v1 migration preserves IDs, Color binding, fallback and lock, and is idempotent', () => {
  for (const value of [null, { hex: '#abcdef', alpha: 0.375 }]) {
    const q = { type: 'Color', value, expression: '', locked: true },
      { doc, l, out } = legacy(q),
      color = node('Color');
    l.nodes.push(color);
    out.params.fill.source = color.id;
    const loaded = deserialize(JSON.stringify(doc)),
      migrated = loaded.layers[0],
      o = migrated.nodes.find((n) => n.id === out.id),
      f = migrated.nodes.find((n) => n.id === o.params.path.source);
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(f.type, 'Fill');
    assert.deepEqual(f.params.color, out.params.fill);
    assert.equal(migrated.id, l.id);
    assert.equal(migrated.output, out.id);
    assert.deepEqual(evaluate(migrated).path.fill, color.params.value.value);
    delete f.params.color.source;
    assert.deepEqual(evaluate(migrated).path.fill, value || { hex: '#123456', alpha: 1 });
    const saved = serialize(loaded);
    assert.equal(serialize(deserialize(saved)), saved);
  }
});
test('old missing fill migrates to live layer fallback and old Output geometry consumers keep working', () => {
  const { doc, l, shape, out } = legacy();
  const transform = node('Transform'),
    out2 = node('Output');
  transform.params.path.source = out.id;
  transform.params.offset.value = [10, 20];
  out2.params.path.type = 'Path';
  out2.params.path.source = transform.id;
  l.nodes.push(transform, out2);
  l.output = out2.id;
  const migrated = deserialize(JSON.stringify(doc)).layers[0];
  assert.equal(migrated.nodes.find((n) => n.id === transform.id).params.path.source, shape.id);
  assert.equal(evaluate(migrated).error, null);
  assert.deepEqual(evaluate(migrated).path.fill, { hex: '#123456', alpha: 1 });
  migrated.fill = '#654321';
  assert.equal(evaluate(migrated).path.fill.hex, '#654321');
});
test('migration enforces post-insertion limits and rejects invalid legacy Color data', () => {
  const { doc, l, out } = legacy();
  while (l.nodes.length < 2000) l.nodes.push(node('Value'));
  assert.throws(() => deserialize(JSON.stringify(doc)), /2000/);
  const bad = legacy({
    type: 'Color',
    value: { hex: 'red', alpha: 1 },
    expression: '',
    locked: false,
  });
  assert.throws(() => deserialize(JSON.stringify(bad.doc)), /Expected Color/);
  const v2 = scene();
  v2.out.params.fill = { type: 'Color', value: null, expression: '', locked: false };
  assert.throws(() => validate(v2.doc), /Unexpected parameter/);
});
test('SVG import/export supports inherited solid strokes, open paths and explicit zero, rejects unsupported styling', () => {
  const Parser = new Window().DOMParser;
  const svg =
    '<svg width="100" height="100" fill="none" stroke="#f00" stroke-opacity="0.5" stroke-width="8px"><g><path d="M10 10L90 90"/><rect x="10" y="10" width="20" height="20" fill="#00f" fill-opacity="0" stroke-width="0"/></g></svg>';
  const d = importSVG(svg, Parser),
    [a, b] = d.layers.map((l) => evaluate(l).path);
  assert.equal(a.contours[0].closed, false);
  assert.equal(a.fill, undefined);
  assert.deepEqual(a.stroke, {
    hex: '#ff0000',
    alpha: 0.5,
    width: 8,
    cap: 'butt',
    join: 'miter',
    dash: [],
    miterLimit: 4,
    dashOffset: 0,
  });
  assert.equal(b.fill.alpha, 0);
  assert.equal(b.stroke.width, 0);
  const again = importSVG(exportSVG(d), Parser);
  assert.deepEqual(
    again.layers.map((l) => {
      const p = evaluate(l).path;
      return [p.fill, p.stroke];
    }),
    d.layers.map((l) => {
      const p = evaluate(l).path;
      return [p.fill, p.stroke];
    }),
  );
  for (const attr of [
    'stroke="url(#g)"',
    'style="stroke:red"',
    'stroke-dasharray="2 -3"',
    'stroke-linecap="invalid"',
    'stroke-linejoin="invalid"',
    'opacity="0.5"',
    'stroke-opacity="1.1"',
    'stroke-width="-1"',
    'stroke-width="Infinity"',
    'stroke-width="100001"',
  ])
    assert.throws(() => importSVG(`<svg><path d="M0 0L10 10" ${attr}/></svg>`, Parser));
});
