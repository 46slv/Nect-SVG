import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  document,
  node,
  connect,
  evaluate,
  exportSVG,
  deserialize,
  serialize,
  parsePath,
  pathArea,
  enableRemapPoint,
} from '../src/core.js';
import { importSVG } from '../src/svg-import.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    a = node('Imported Path'),
    b = node('Imported Path'),
    join = node('Join Geometry'),
    fill = node('Fill'),
    out = node('Output');
  a.rawPath = 'M0 0L100 0L100 100L0 100Z M20 20L20 80L80 80L80 20Z';
  b.rawPath = 'M50 0L50 100L150 100L150 0Z';
  l.nodes = [a, b, join, fill, out];
  l.output = out.id;
  connect(l, a.id, join.id, 'a');
  connect(l, b.id, join.id, 'b');
  connect(l, join.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  fill.params.color.value.alpha = 0.5;
  return { doc, l, a, b, join, fill, out };
}
test('Join preserves independent holes and opposite-winding overlaps as separate paths', () => {
  const { doc, l, a, b, join } = scene();
  const r = evaluate(l);
  assert.equal(r.error, null);
  assert.equal(r.path.contours.length, 3);
  assert.equal(new Set(r.path.contours.map((c) => c.group)).size, 2);
  const svg = exportSVG(doc);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.equal((svg.match(/fill-opacity="0.5"/g) || []).length, 2);
  assert.match(svg, /<g /);
  assert.equal(evaluate(l).run(a.id).contours.length, 2);
  assert.equal(evaluate(l).run(b.id).contours.length, 1);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const parsed = importSVG(svg, new Window().DOMParser);
  assert.equal(parsed.layers.length, 1);
  assert.equal(evaluate(parsed.layers[0]).path.contours.length, 3);
  assert.equal(pathArea(r.path), 13200);
  const same = node('Join Geometry');
  l.nodes.push(same);
  connect(l, a.id, same.id, 'a');
  connect(l, a.id, same.id, 'b');
  const repeated = evaluate(l).run(same.id);
  assert.equal(new Set(repeated.contours.flatMap((c) => c.points.map((p) => p.id))).size, 16);
  assert.throws(
    () => connect(l, l.nodes.find((n) => n.type === 'Fill').id, join.id, 'a'),
    /PaintedPath/,
  );
});
test('Join groups survive shared Transform, Remap and Repeater; changed sources suspend edits', () => {
  const { doc, l, a, join, fill } = scene();
  const transform = node('Transform'),
    remap = node('Path Remap'),
    repeat = node('Geometry Repeater');
  l.nodes.push(transform, remap, repeat);
  connect(l, join.id, transform.id, 'path');
  connect(l, transform.id, remap.id, 'path');
  connect(l, remap.id, repeat.id, 'path');
  connect(l, repeat.id, fill.id, 'path');
  repeat.params.count.value = 2;
  transform.params.offset.value = [10, 15];
  let r = evaluate(l);
  assert.equal(r.error, null);
  assert.equal(new Set(r.path.contours.map((c) => c.group)).size, 4);
  assert.equal((exportSVG(doc).match(/<path /g) || []).length, 4);
  const input = r.run(transform.id);
  enableRemapPoint(remap, input, input.contours[0].points[0].id);
  remap.edits[0].params.position.value = [3, 4];
  assert.doesNotThrow(() => deserialize(serialize(doc)));
  a.rawPath = 'M0 0L110 0L110 100L0 100Z';
  assert.match(evaluate(l).warnings.join(' '), /suspended/);
  repeat.params.count.value = 129;
  assert.match(evaluate(l).error, /256 independent groups/);
});
test('Boolean unions grouped operands before area operations without changing Join geometry', () => {
  const { l, join, fill } = scene();
  const clip = node('Rectangle'),
    boolean = node('Boolean');
  clip.params.center.value = [75, 50];
  clip.params.size.value = [150, 100];
  boolean.operation = 'intersect';
  l.nodes.push(clip, boolean);
  connect(l, join.id, boolean.id, 'a');
  connect(l, clip.id, boolean.id, 'b');
  connect(l, boolean.id, fill.id, 'path');
  const r = evaluate(l);
  assert.equal(r.error, null);
  assert.equal(pathArea(r.path), 13200);
  assert.ok(r.path.contours.every((c) => c.group === undefined));
  assert.equal(new Set(r.run(join.id).contours.map((c) => c.group)).size, 2);
});

test('exported same-paint groups roundtrip above the layer limit using balanced Join trees', () => {
  const { doc, l, join, fill } = scene();
  const repeat = node('Geometry Repeater');
  l.nodes.push(repeat);
  connect(l, join.id, repeat.id, 'path');
  connect(l, repeat.id, fill.id, 'path');
  for (const count of [51, 128]) {
    repeat.params.count.value = count;
    const svg = exportSVG(doc);
    const restored = importSVG(svg, new Window().DOMParser);
    assert.equal(restored.layers.length, 1);
    const sources = restored.layers[0].nodes.filter((n) => n.type === 'Imported Path');
    assert.equal(new Set(sources.map((n) => JSON.stringify(n.position))).size, sources.length);
    const r = evaluate(restored.layers[0]);
    assert.equal(r.error, null);
    assert.equal(new Set(r.path.contours.map((c) => c.group)).size, count * 2);
    assert.equal((exportSVG(restored).match(/<path /g) || []).length, count * 2);
  }
});

test('untagged SVG shape names remain distinct after grouped-import support', () => {
  const doc = importSVG(
    '<svg><rect width="10" height="10"/><circle r="4"/></svg>',
    new Window().DOMParser,
  );
  assert.deepEqual(
    doc.layers.map((l) => l.name),
    ['Imported 1', 'Imported 2'],
  );
});
