import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import {
  document,
  node,
  connect,
  disconnect,
  evaluate,
  outputType,
  outputPorts,
  pathBounds,
  pathData,
  serialize,
  deserialize,
  validate,
  History,
  exportSVG,
  clone,
} from '../src/core.js';
const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const fonts = { default: font };
function scene() {
  const doc = document(),
    l = doc.layers[0],
    a = node('Text'),
    b = node('Text'),
    out = node('Output');
  l.nodes = [a, b, out];
  l.output = out.id;
  connect(l, b.id, out.id, 'path');
  const add = (type) => {
    const n = node(type);
    l.nodes.push(n);
    return n;
  };
  return { doc, l, a, b, out, add };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00002, `${a} != ${b}`);

test('Text exposes legacy Path and typed Position; Position evaluates independently of font/outline', () => {
  const { l, a, b } = scene();
  assert.deepEqual(outputPorts(a), [
    { id: undefined, label: 'Path', type: 'Path' },
    { id: 'position', label: 'Position', type: 'Vector2' },
  ]);
  assert.equal(outputType(a), 'Path');
  assert.equal(outputType(a, 'position'), 'Vector2');
  for (const bad of ['path', 'x', 'y', 'Position', '']) assert.equal(outputType(a, bad), undefined);
  connect(l, a.id, b.id, 'position', false, 'position');
  a.params.position.value = [410, 220];
  const result = evaluate(l); // No fonts: Path fails, but the coordinate remains usable.
  assert.match(result.error, /Font/);
  assert.deepEqual(result.run(a.id, 'position'), [410, 220]);
  assert.deepEqual(result.run(b.id, 'position'), [410, 220]);
  assert.throws(() => result.run(a.id), /Font/);
  assert.throws(() => result.run(a.id, 'bogus'), /socket/);
  assert.equal(evaluate(l, fonts).error, null);
});

test('Position follows source > expression > direct and has isolated, port-aware cache invalidation', () => {
  const { l, a, b, add } = scene(),
    v = add('Vector');
  a.params.position.value = [90, 80];
  a.params.position.expression = '20*3; 40+2';
  v.params.value.value = [300, 150];
  connect(l, v.id, a.id, 'position');
  connect(l, a.id, b.id, 'position', false, 'position');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [300, 150]);
  assert.equal(evaluate(l, fonts).stats.computed, 0);
  v.params.value.value = [330, 170];
  let result = evaluate(l, fonts);
  assert.deepEqual(result.run(b.id, 'position'), [330, 170]);
  near(pathBounds(result.run(b.id))[0][0], 330);
  disconnect(a, 'position');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [60, 42]);
  a.params.position.expression = '';
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [90, 80]);
  // A's glyph settings are not dependencies of A.Position. Its follower path stays cached.
  evaluate(l, fonts);
  a.text = 'A different length';
  a.params.size.value = 120;
  a.alignment = 'end';
  a.crossAlignment = 'end';
  a.font = 'unavailable-font';
  result = evaluate(l, fonts);
  assert.equal(result.error, null);
  assert.equal(result.stats.computed, 0);
  assert.deepEqual(result.run(a.id, 'position'), [90, 80]);
  assert.throws(() => result.run(a.id), /Font/);
  a.params.position.expression = '1/0; 2';
  assert.throws(() => evaluate(l, fonts).run(a.id, 'position'), /finite/);
});

test('XY reuse, X-only with independent Y and scalar/vector offsets compose through existing nodes', () => {
  const { l, a, b, add } = scene(),
    separate = add('Separate Vector'),
    math = add('Math'),
    combine = add('Combine Vector'),
    offset = add('Vector Math');
  a.params.position.value = [500, 200];
  connect(l, a.id, separate.id, 'vector', false, 'position');
  connect(l, separate.id, math.id, 'a', false, 'x');
  math.params.b.value = 15;
  connect(l, math.id, combine.id, 'x');
  combine.params.y.expression = '300+20';
  connect(l, combine.id, b.id, 'position');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [515, 320]);
  a.params.position.value = [600, 100];
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [615, 320]);
  combine.params.y.expression = '';
  combine.params.y.value = 410;
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [615, 410]);
  const y = add('Value');
  y.params.value.value = 270;
  connect(l, y.id, combine.id, 'y');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [615, 270]);
  connect(l, a.id, offset.id, 'a', false, 'position');
  offset.params.b.value = [-30, 55];
  connect(l, offset.id, b.id, 'position');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [570, 155]);
  connect(l, a.id, b.id, 'position', false, 'position');
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [600, 100]);
});

test('Position reference belongs to each Text and excludes downstream or branched Transform', () => {
  const { l, a, b, add, out } = scene(),
    join = add('Join Geometry'),
    t = add('Transform'),
    branch = add('Transform');
  a.params.position.value = [500, 300];
  a.alignment = 'end';
  a.crossAlignment = 'end';
  b.text = 'follower';
  b.params.size.value = 24;
  b.alignment = 'start';
  b.crossAlignment = 'start';
  connect(l, a.id, b.id, 'position', false, 'position');
  connect(l, a.id, join.id, 'a');
  connect(l, b.id, join.id, 'b');
  connect(l, join.id, t.id, 'path');
  t.params.offset.value = [40, -20];
  connect(l, a.id, branch.id, 'path');
  branch.params.offset.value = [-120, 80];
  connect(l, t.id, out.id, 'path');
  const result = evaluate(l, fonts);
  near(pathBounds(result.run(a.id))[0][2], 500);
  near(pathBounds(result.run(a.id))[1][2], 300);
  near(pathBounds(result.run(b.id))[0][0], 500);
  near(pathBounds(result.run(b.id))[1][0], 300);
  near(pathBounds(result.run(branch.id))[0][2], 380);
  assert.deepEqual(result.run(a.id, 'position'), [500, 300]);
  assert.deepEqual(result.run(b.id, 'position'), [500, 300]);
  const before = result.run(join.id).contours.flatMap((c) => c.points);
  const after = result.run(t.id).contours.flatMap((c) => c.points);
  after.forEach((p, i) =>
    p.position.forEach((v, axis) => near(v, before[i].position[axis] + [40, -20][axis])),
  );
  a.referenceBounds = 'advance';
  a.writingMode = 'vertical-rl';
  assert.deepEqual(evaluate(l, fonts).run(a.id, 'position'), [500, 300]);
});

test('Text Position rejects self/indirect/math cycles and wrong types atomically, respecting locks', () => {
  const { doc, l, a, b, add, out } = scene(),
    separate = add('Separate Vector'),
    combine = add('Combine Vector');
  connect(l, a.id, b.id, 'position', false, 'position');
  let before = serialize(doc);
  for (const [from, to, key, port] of [
    [a.id, a.id, 'position', 'position'],
    [b.id, a.id, 'position', 'position'],
    [a.id, out.id, 'path', 'position'],
    [a.id, b.id, 'position', undefined],
    [a.id, b.id, 'size', 'position'],
  ]) {
    assert.throws(() => connect(l, from, to, key, false, port), /cycle|Cannot connect/);
    assert.equal(serialize(doc), before);
  }
  connect(l, b.id, separate.id, 'vector', false, 'position');
  connect(l, separate.id, combine.id, 'x', false, 'x');
  before = serialize(doc);
  assert.throws(() => connect(l, combine.id, a.id, 'position'), /cycle/);
  assert.equal(serialize(doc), before);
  b.params.position.locked = true;
  assert.throws(() => disconnect(b, 'position'), /locked/);
  assert.throws(() => connect(l, combine.id, b.id, 'position'), /locked/);
  assert.doesNotThrow(() => validate(doc));
  const invalid = clone(doc);
  invalid.layers[0].nodes[0].params.position.source = b.id;
  invalid.layers[0].nodes[0].params.position.sourcePort = 'position';
  assert.throws(() => deserialize(serialize(invalid)), /cycle/);
});

test('stable IDs survive rename, history and JSON; unknown/wrong source ports fail; legacy Path stays identical', () => {
  const { doc, l, a, b, add } = scene();
  const legacy = serialize(doc),
    oldPath = pathData(evaluate(l, fonts).path);
  assert.equal(pathData(evaluate(deserialize(legacy).layers[0], fonts).path), oldPath);
  connect(l, a.id, b.id, 'position', false, 'position');
  a.name = 'Renamed master';
  assert.deepEqual(evaluate(l, fonts).run(b.id, 'position'), [200, 300]);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const h = new History(doc);
  h.apply((d) =>
    disconnect(
      d.layers[0].nodes.find((n) => n.id === b.id),
      'position',
    ),
  );
  h.undo();
  assert.equal(
    h.doc.layers[0].nodes.find((n) => n.id === b.id).params.position.sourcePort,
    'position',
  );
  h.redo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === b.id).params.position.source, undefined);
  const scalar = add('Value');
  for (const patch of [
    { sourcePort: 'unknown' },
    { sourcePort: 'x' },
    { source: scalar.id, sourcePort: 'position' },
    { source: undefined, sourcePort: 'position' },
  ]) {
    const bad = clone(doc);
    Object.assign(bad.layers[0].nodes.find((n) => n.id === b.id).params.position, patch);
    assert.throws(() => deserialize(serialize(bad)), /port|Cannot connect/);
  }
});

test('editable sample demonstrates XY, X-only, offset and joined Transform with finite painted SVG', () => {
  const doc = deserialize(
    fs.readFileSync(new URL('../examples/text-position-reuse.json', import.meta.url), 'utf8'),
  );
  const l = doc.layers[0],
    result = evaluate(l, fonts);
  assert.equal(result.error, null);
  assert.deepEqual(result.run('text-master', 'position'), [720, 150]);
  assert.deepEqual(result.run('text-xy', 'position'), [720, 150]);
  assert.deepEqual(result.run('text-x-only', 'position'), [720, 260]);
  assert.deepEqual(result.run('text-offset', 'position'), [720, 330]);
  assert.match(exportSVG(doc, fonts), /fill="#36434e"/);
  assert.doesNotMatch(exportSVG(doc, fonts), /NaN|Infinity/);
});
