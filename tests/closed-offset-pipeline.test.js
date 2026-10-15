import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  document,
  node,
  connect,
  disconnect,
  evaluate,
  pathBounds,
  pathArea,
  serialize,
  deserialize,
  exportSVG,
  enableRemapPoint,
  rebindRemapPoint,
  History,
  clone,
  assertClosedOffsetChange,
  OFFSET_EDITOR_LIMITS,
} from '../src/core.js';
import { offsetClosedPathDetailed, OffsetError, OFFSET_LIMITS } from '../src/closed-offset.js';

function fixture() {
  const doc = document(),
    l = doc.layers[0],
    r = node('Rectangle'),
    offset = node('Closed Path Offset'),
    fill = node('Fill'),
    stroke = node('Stroke'),
    out = node('Output');
  l.nodes = [r, offset, fill, stroke, out];
  l.output = out.id;
  r.params.center.value = [50, 30];
  r.params.size.value = [100, 60];
  connect(l, r.id, offset.id, 'path');
  connect(l, offset.id, fill.id, 'path');
  connect(l, fill.id, stroke.id, 'path');
  connect(l, stroke.id, out.id, 'path');
  return { doc, l, r, offset, fill, stroke, out };
}
function polygon(count, radius = 100) {
  return {
    contours: [
      {
        closed: true,
        id: 'source',
        points: Array.from({ length: count }, (_, i) => ({
          id: `p${i}`,
          position: [
            radius * Math.cos((i * 2 * Math.PI) / count),
            radius * Math.sin((i * 2 * Math.PI) / count),
          ],
          handleA: [0, 0],
          handleB: [0, 0],
        })),
      },
    ],
  };
}

test('Offset Path sockets, joins, signed distance, paint order, erosion and JSON roundtrip', () => {
  const { doc, l, r, offset, fill, stroke, out } = fixture();
  let result = evaluate(l);
  assert.equal(result.error, null);
  assert.deepEqual(pathBounds(result.path), [
    [-10, 50, 110],
    [-10, 30, 70],
  ]);
  assert.equal(pathArea(result.path), 9600);
  assert.equal(result.path.fill.hex, '#36434e');
  assert.equal(result.path.stroke.width, 2);
  assert.equal(result.run(offset.id).fill, undefined);
  assert.throws(() => connect(l, fill.id, offset.id, 'path'), /Cannot connect PaintedPath to Path/);
  const image = node('Image'),
    color = node('Color'),
    vector = node('Vector');
  l.nodes.push(color, vector);
  assert.throws(
    () => connect({ ...l, nodes: [...l.nodes, image] }, image.id, offset.id, 'path'),
    /Cannot connect Image/,
  );
  assert.throws(() => connect(l, color.id, offset.id, 'amount'), /Cannot connect Color/);
  assert.throws(() => connect(l, vector.id, offset.id, 'miterLimit'), /Cannot connect Vector2/);
  offset.operation = 'bevel';
  assert.equal(pathArea(evaluate(l).path), 9400);
  offset.operation = 'miter';
  offset.params.miterLimit.value = 1;
  assert.equal(pathArea(evaluate(l).path), 9400);
  offset.operation = 'round';
  assert.ok(pathArea(evaluate(l).path) > 9400);
  offset.params.amount.value = -10;
  offset.operation = 'miter';
  offset.params.miterLimit.value = 4;
  assert.equal(pathArea(evaluate(l).path), 3200);
  const saved = serialize(doc),
    svg = exportSVG(doc);
  assert.deepEqual(deserialize(saved), doc);
  assert.equal(exportSVG(deserialize(saved)), svg);
  assert.match(svg, /stroke-width="2"/);
  offset.params.amount.value = -30;
  assert.deepEqual(evaluate(l).run(offset.id).contours, []);
  assert.doesNotThrow(() => exportSVG(doc));
  offset.params.amount.value = 0;
  result = evaluate(l);
  assert.equal(result.run(offset.id), result.run(r.id));
  result = evaluate(l);
  assert.equal(result.run(offset.id), result.run(r.id));
  assert.equal(out.params.path.source, stroke.id);
});

test('Offset Scalar inputs, expression precedence, disconnect fallbacks, locks and validation', () => {
  const { doc, l, offset } = fixture(),
    value = node('Value');
  l.nodes.push(value);
  value.params.value.value = -10;
  connect(l, value.id, offset.id, 'amount');
  assert.equal(pathArea(evaluate(l).path), 3200);
  assert.equal(offset.params.amount.value, 10);
  disconnect(offset, 'amount');
  offset.params.amount.expression = '5 + 5';
  assert.equal(pathArea(evaluate(l).path), 9600);
  offset.params.amount.expression = '0.00001';
  assert.match(evaluate(l).error, /0.0001/);
  offset.params.amount.expression = '';
  offset.params.miterLimit.locked = true;
  assert.throws(() => connect(l, value.id, offset.id, 'miterLimit'), /locked/);
  for (const [key, value] of [
    ['amount', 0.00001],
    ['miterLimit', 0],
    ['miterLimit', 101],
  ]) {
    const bad = clone(doc);
    bad.layers[0].nodes[1].params[key].value = value;
    assert.throws(() => deserialize(JSON.stringify(bad)), /Offset/);
  }
  const bad = clone(doc);
  bad.layers[0].nodes[1].operation = 'square';
  assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid operation/);
});

test('Offset amount is measured after upstream Transform and before downstream paint/transform', () => {
  const { l, r, offset } = fixture(),
    t = node('Transform');
  l.nodes.push(t);
  t.params.scale.value = 2;
  connect(l, r.id, t.id, 'path');
  connect(l, t.id, offset.id, 'path');
  assert.deepEqual(pathBounds(evaluate(l).path), [
    [-10, 100, 210],
    [-10, 60, 130],
  ]);
  assert.equal(pathArea(evaluate(l).path), 30800);
});

test('Offset rejects unsupported source geometry explicitly and leaves it untouched', () => {
  const { l, r, offset } = fixture(),
    c = node('Curve'),
    j = node('Join Geometry');
  l.nodes.push(c, j);
  connect(l, c.id, offset.id, 'path');
  c.params.closed.value = false;
  assert.match(evaluate(l).error, /closed contours/);
  offset.params.amount.value = 0;
  assert.equal(evaluate(l).error, null);
  offset.params.amount.value = 10;
  connect(l, r.id, j.id, 'a');
  connect(l, c.id, j.id, 'b');
  connect(l, j.id, offset.id, 'path');
  assert.match(evaluate(l).error, /Grouped geometry/);
  const before = JSON.stringify(l);
  assert.throws(() => evaluate(l).run(offset.id), OffsetError);
  assert.equal(JSON.stringify(l), before);
});

test('Offset Remap suspends for coordinate, topology, source identity and upstream reroute changes', () => {
  const { doc, l, r, offset, fill } = fixture(),
    remap = node('Path Remap'),
    same = node('Rectangle'),
    transform = node('Transform');
  same.params = clone(r.params);
  l.nodes.push(remap, same, transform);
  connect(l, offset.id, remap.id, 'path');
  connect(l, remap.id, fill.id, 'path');
  const input = evaluate(l).run(offset.id),
    id = input.contours[0].points[0].id;
  enableRemapPoint(remap, input, id).params.position.value = [4, 0];
  assert.equal(evaluate(l).warnings.length, 0);
  const old = clone(l);
  offset.params.amount.value = 11;
  assert.match(evaluate(l).warnings[0], /suspended/);
  Object.assign(l, old);
  const h = new History(doc),
    get = () => h.doc.layers[0],
    off = () => get().nodes.find((n) => n.id === offset.id);
  h.apply(() => (off().operation = 'bevel'));
  assert.match(evaluate(get()).warnings[0], /suspended/);
  h.undo();
  h.apply(() => connect(get(), same.id, offset.id, 'path'));
  assert.match(evaluate(get()).warnings[0], /suspended/);
  h.undo();
  h.apply(() => {
    connect(get(), r.id, transform.id, 'path');
    connect(get(), transform.id, offset.id, 'path');
  });
  const currentRemap = get().nodes.find((n) => n.id === remap.id);
  rebindRemapPoint(currentRemap, evaluate(get()).run(offset.id), id);
  assert.equal(evaluate(get()).warnings.length, 0);
  // Same geometry and same immediate Transform node, different upstream generator.
  h.apply(() => connect(get(), same.id, transform.id, 'path'));
  assert.match(evaluate(get()).warnings[0], /suspended/);
  const saved = serialize(h.doc);
  assert.match(evaluate(deserialize(saved).layers[0]).warnings[0], /suspended/);
  h.undo();
  assert.equal(evaluate(get()).warnings.length, 0);
  h.redo();
  assert.match(evaluate(get()).warnings[0], /suspended/);
});

test('Offset failures and history are atomic; repeated cached evaluation does not rerun geometry', () => {
  const { doc, l, r, offset } = fixture(),
    h = new History(doc),
    before = serialize(doc),
    old = clone(l);
  assert.throws(
    () =>
      h.apply(() => {
        offset.params.amount.value = 1e9;
        assertClosedOffsetChange(l, old);
      }),
    /safe integer envelope/,
  );
  assert.equal(serialize(h.doc), before);
  assert.equal(h.past.length, 0);
  const live = h.doc.layers[0];
  evaluate(live);
  assert.equal(evaluate(live).stats.computed, 0);
  h.apply(() => {
    live.nodes[1].params.amount.value = -10;
    assertClosedOffsetChange(live, old);
  });
  assert.equal(h.past.length, 1);
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  assert.equal(pathArea(evaluate(h.doc.layers[0]).path), 3200);
  // Disconnecting a source is still allowed while constructing the graph.
  const prior = clone(h.doc.layers[0]);
  disconnect(h.doc.layers[0].nodes[1], 'path');
  assert.doesNotThrow(() => assertClosedOffsetChange(h.doc.layers[0], prior));
});

test('Editor work budgets only tighten the qualified kernel, reject huge joins before execution', () => {
  for (const key of Object.keys(OFFSET_EDITOR_LIMITS))
    assert.ok(OFFSET_EDITOR_LIMITS[key] <= OFFSET_LIMITS[key]);
  for (const limits of [
    { scale: 1 },
    { flattenedVertices: 2049 },
    { pairChecks: Infinity },
    { outputVertices: 0 },
  ])
    assert.throws(() => offsetClosedPathDetailed(polygon(4), 1, {}, limits), /only tighten/);
  assert.throws(
    () => offsetClosedPathDetailed(polygon(257), 1, {}, OFFSET_EDITOR_LIMITS),
    /exceeds 256/,
  );
  assert.throws(
    () => offsetClosedPathDetailed(polygon(256), 1000, { join: 'round' }, OFFSET_EDITOR_LIMITS),
    /estimated join work/,
  );
  assert.throws(() => offsetClosedPathDetailed(polygon(4), 1, {}, { pairChecks: 1 }), /work limit/);
  assert.throws(
    () => offsetClosedPathDetailed(polygon(4), 1, {}, { outputVertices: 3 }),
    /output exceeds 3/,
  );
});

test('Measured editor boundary work remains practically bounded on 256-vertex fixtures', () => {
  const times = [],
    diagnostics = [];
  for (const count of [4, 128, 256])
    for (const amount of [2, -2])
      for (const join of ['miter', 'bevel', 'round']) {
        const start = performance.now(),
          r = offsetClosedPathDetailed(polygon(count), amount, { join }, OFFSET_EDITOR_LIMITS);
        times.push(performance.now() - start);
        diagnostics.push(r.diagnostics);
        assert.ok(r.diagnostics.topologyPairChecks <= OFFSET_EDITOR_LIMITS.pairChecks);
        assert.ok(r.diagnostics.outputVertices <= OFFSET_EDITOR_LIMITS.outputVertices);
        assert.equal(r.diagnostics.finalOffsetErrorBound, null);
      }
  // A coarse regression alarm, deliberately not a real-time/cancellation guarantee.
  assert.ok(Math.max(...times) < 2000, `Offset fixture took ${Math.max(...times)} ms`);
  console.log(
    `Offset editor boundary fixtures: max ${Math.max(...times).toFixed(1)} ms; max pair checks ${Math.max(...diagnostics.map((d) => d.topologyPairChecks))}`,
  );
});

test('More than 8 nonzero Offset nodes fail consistently, even after partial caching', () => {
  const { l, r, fill } = fixture();
  let source = r.id;
  for (let i = 0; i < 9; i++) {
    const n = node('Closed Path Offset');
    n.params.amount.value = 1;
    l.nodes.push(n);
    connect(l, source, n.id, 'path');
    source = n.id;
  }
  connect(l, source, fill.id, 'path');
  for (let i = 0; i < 3; i++) assert.match(evaluate(l).error, /At most 8/);
});

test('Editable Offset sample roundtrips and exports all supported joins/holes', async () => {
  const fs = await import('node:fs/promises');
  const doc = deserialize(
    await fs.readFile(new URL('../examples/closed-path-offset.json', import.meta.url), 'utf8'),
  );
  for (const l of doc.layers) assert.equal(evaluate(l).error, null);
  assert.equal(exportSVG(deserialize(serialize(doc))), exportSVG(doc));
});

test('Offset provenance respects Text Position port boundaries and ignores unrelated dangling outline inputs', () => {
  const { doc, l, r, offset } = fixture(),
    text = node('Text'),
    ref = node('Reference'),
    separate = node('Separate Vector');
  ref.reference = { nodeId: 'deleted-vector', portId: 'output' };
  l.nodes.push(text, ref, separate);
  connect(l, ref.id, separate.id, 'vector');
  connect(l, separate.id, text.id, 'size', false, 'x');
  connect(l, text.id, r.id, 'center', false, 'position');
  const restored = deserialize(serialize(doc)),
    live = restored.layers[0],
    result = evaluate(live);
  assert.equal(result.error, null);
  assert.deepEqual(result.run(text.id, 'position'), [200, 300]);
  const before = result.run(offset.id).fingerprint;
  // Neither identity nor value changes in this unobserved outline route affect the binding.
  live.nodes.find((n) => n.id === ref.id).reference.nodeId = 'another-deleted-vector';
  live.nodes.find((n) => n.id === text.id).text = 'Changed unused outline';
  assert.equal(evaluate(live).error, null);
  assert.equal(evaluate(live).run(offset.id).fingerprint, before);
  live.nodes.find((n) => n.id === text.id).params.position.value = [201, 300];
  assert.notEqual(evaluate(live).run(offset.id).fingerprint, before);
});

test('Offset provenance includes destination input names for equal-geometry upstream reroutes', () => {
  const { l, r, offset, fill } = fixture(),
    transform = node('Transform'),
    v = node('Vector'),
    remap = node('Path Remap');
  v.params.value.value = [0, 0];
  l.nodes.push(transform, v, remap);
  connect(l, r.id, transform.id, 'path');
  connect(l, transform.id, offset.id, 'path');
  connect(l, v.id, transform.id, 'offset');
  connect(l, offset.id, remap.id, 'path');
  connect(l, remap.id, fill.id, 'path');
  const input = evaluate(l).run(offset.id),
    id = input.contours[0].points[0].id;
  enableRemapPoint(remap, input, id).params.position.value = [4, 0];
  assert.equal(evaluate(l).warnings.length, 0);
  disconnect(transform, 'offset');
  connect(l, v.id, transform.id, 'anchor');
  const rerouted = evaluate(l);
  assert.deepEqual(rerouted.run(offset.id).contours, input.contours);
  assert.notEqual(rerouted.run(offset.id).fingerprint, input.fingerprint);
  assert.match(rerouted.warnings[0], /suspended/);
});
