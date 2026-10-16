import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  document,
  layer,
  node,
  connect,
  disconnect,
  evaluate,
  outputType,
  outputPorts,
  setReference,
  vectorReferenceTargets,
  nodeDependencies,
  setOperation,
  duplicateNodes,
  serialize,
  deserialize,
  exportSVG,
  clone,
  History,
} from '../src/core.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    source = node('Vector'),
    ref = node('Reference'),
    shape = node('Circle'),
    out = node('Output');
  source.params.value.value = [120, 210];
  l.nodes = [source, ref, shape, out];
  l.output = out.id;
  connect(l, shape.id, out.id, 'path');
  return { doc, l, source, ref, shape, out };
}
const target = (n, portId = 'output') => ({ nodeId: n.id, portId });
test('Reference offers only same-layer public Vector2 outputs and is non-rendering', () => {
  const { doc, l, source, ref, shape, out } = scene(),
    text = node('Text'),
    nullNode = node('Null'),
    scalar = node('Value'),
    math = node('Vector Math');
  l.nodes.push(text, nullNode, scalar, math);
  const choices = vectorReferenceTargets(l, ref.id);
  assert.ok(choices.some((c) => c.nodeId === text.id && c.portId === 'position'));
  assert.ok(choices.some((c) => c.nodeId === nullNode.id && c.portId === 'output'));
  assert.ok(!choices.some((c) => [shape.id, ref.id, scalar.id].includes(c.nodeId)));
  assert.equal(outputType(ref), 'Vector2');
  assert.equal(outputType(ref, 'position'), undefined);
  assert.deepEqual(outputPorts(ref), [{ id: undefined, label: '', type: 'Vector2' }]);
  assert.throws(() => evaluate(l).run(ref.id), /not selected/);
  setReference(l, ref.id, target(source));
  assert.deepEqual(evaluate(l).run(ref.id), [120, 210]);
  assert.deepEqual(nodeDependencies(ref), [{ source: source.id, sourcePort: undefined }]);
  assert.throws(() => connect(l, ref.id, out.id, 'path'), /Cannot connect/);
  assert.throws(() => setReference(l, ref.id, target(text)), /Vector2/);
  assert.throws(() => setReference(l, ref.id, target(scalar)), /Vector2/);
  const svg = exportSVG(doc);
  l.nodes = l.nodes.filter((n) => n.id !== ref.id);
  assert.equal(exportSVG(doc), svg);
});
test('Reference uses effective values, invalidates downstream caches and keeps explicit local-space semantics', () => {
  const { l, source, ref, shape } = scene(),
    text = node('Text'),
    transform = node('Transform'),
    ref2 = node('Reference');
  l.nodes.push(text, transform, ref2);
  text.params.position.expression = '2; 3';
  connect(l, source.id, text.id, 'position');
  setReference(l, ref.id, target(text, 'position'));
  setReference(l, ref2.id, target(ref));
  connect(l, ref2.id, shape.id, 'center');
  assert.deepEqual(evaluate(l).run(ref.id), [120, 210], 'connected input wins');
  const cached = evaluate(l);
  assert.equal(cached.error, null);
  assert.equal(cached.stats.computed, 0);
  source.params.value.value = [90, 180];
  assert.deepEqual(evaluate(l).run(ref2.id), [90, 180]);
  disconnect(text, 'position');
  assert.deepEqual(evaluate(l).run(ref.id), [2, 3]);
  text.params.position.expression = '';
  text.params.position.value = [7, 8];
  transform.params.offset.value = [1000, 500];
  connect(l, text.id, transform.id, 'path');
  assert.deepEqual(
    evaluate(l).run(ref.id),
    [7, 8],
    'Text Position does not need a font or downstream geometry',
  );
  assert.throws(() => setReference(l, ref.id, target(transform)), /Vector2/);
});
test('wire and Reference edges share direct, indirect and inactive-input cycle rejection atomically', () => {
  const { l, source, ref } = scene(),
    other = node('Reference'),
    math = node('Vector Math');
  l.nodes.push(other, math);
  setReference(l, ref.id, target(source));
  setReference(l, other.id, target(ref));
  let before = JSON.stringify(l);
  for (const call of [
    () => setReference(l, ref.id, target(ref)),
    () => setReference(l, ref.id, target(other)),
    () => connect(l, ref.id, source.id, 'value'),
  ]) {
    assert.throws(call, /cycle/i);
    assert.equal(JSON.stringify(l), before);
  }
  connect(l, other.id, math.id, 'b');
  setOperation(l, math.id, 'normalize');
  before = JSON.stringify(l);
  assert.throws(() => setReference(l, ref.id, target(math)), /cycle/i);
  assert.equal(JSON.stringify(l), before, 'inactive parameter dependencies retain wire semantics');
  const noWires = clone(l);
  noWires.nodes = [ref, other].map(clone);
  noWires.nodes[0].reference = target(noWires.nodes[1]);
  assert.throws(() => evaluate(noWires).run(ref.id), /cycle/i);
});
test('Vector Math source type changes cannot silently break Reference outputs', () => {
  const { l, ref } = scene(),
    math = node('Vector Math');
  l.nodes.push(math);
  setReference(l, ref.id, target(math));
  for (const operation of ['length', 'distance', 'dot']) {
    assert.throws(() => setOperation(l, math.id, operation), /Reference/);
    assert.equal(math.operation, 'add');
  }
  setReference(l, ref.id, null);
  setOperation(l, math.id, 'length');
  assert.throws(() => setReference(l, ref.id, target(math)), /Vector2/);
});
test('rename survives; delete creates a persisted explicit dangling error and Undo restores the link', () => {
  const { doc, l, source, ref, shape } = scene();
  setReference(l, ref.id, target(source));
  connect(l, ref.id, shape.id, 'center');
  evaluate(l);
  source.name = 'A renamed source';
  assert.deepEqual(evaluate(l).run(ref.id), [120, 210]);
  const history = new History(doc);
  history.apply((d) => {
    d.layers[0].nodes = d.layers[0].nodes.filter((n) => n.id !== source.id);
  });
  let missing = history.doc.layers[0];
  assert.match(evaluate(missing).error, /Reference target is missing/);
  assert.throws(() => evaluate(missing).run(ref.id), /missing/);
  const roundtrip = deserialize(serialize(history.doc));
  assert.deepEqual(
    roundtrip.layers[0].nodes.find((n) => n.id === ref.id).reference,
    target(source),
  );
  assert.throws(() => exportSVG(roundtrip), /Reference target is missing/);
  const unrelated = node('Vector');
  missing.nodes.push(unrelated);
  connect(missing, unrelated.id, shape.id, 'center');
  assert.equal(
    evaluate(missing).error,
    null,
    'dangling orphan does not prevent unrelated editing/export',
  );
  assert.throws(() => evaluate(missing).run(ref.id), /missing/);
  history.undo();
  assert.deepEqual(evaluate(history.doc.layers[0]).run(ref.id), [120, 210]);
  history.redo();
  assert.throws(() => evaluate(history.doc.layers[0]).run(ref.id), /missing/);
});
test('deletion and retargeting never reuse stale cached Reference values', () => {
  const { l, source, ref, shape } = scene(),
    other = node('Null');
  other.params.position.value = [44, 55];
  l.nodes.push(other);
  setReference(l, ref.id, target(source));
  connect(l, ref.id, shape.id, 'center');
  assert.deepEqual(evaluate(l).run(ref.id), [120, 210]);
  setReference(l, ref.id, target(other));
  assert.deepEqual(evaluate(l).run(ref.id), [44, 55]);
  l.nodes = l.nodes.filter((n) => n.id !== other.id);
  assert.match(evaluate(l).error, /missing/);
  l.nodes.push(other);
  other.params.position.value = [66, 77];
  assert.deepEqual(evaluate(l).run(ref.id), [66, 77]);
  other.type = 'Value';
  other.params = node('Value').params;
  assert.throws(() => evaluate(l).run(ref.id), /Vector2/);
});
test('batch duplicate remaps copied sources and ports while single copies retain external/dangling references', () => {
  const { doc, l, source, ref, shape } = scene(),
    external = node('Reference');
  l.nodes.push(external);
  setReference(l, ref.id, target(source));
  setReference(l, external.id, target(source));
  connect(l, ref.id, shape.id, 'center');
  const copies = duplicateNodes(l, [source.id, ref.id, shape.id]);
  assert.equal(copies[1].reference.nodeId, copies[0].id);
  assert.equal(copies[2].params.center.source, copies[1].id);
  assert.equal(external.reference.nodeId, source.id);
  copies[0].params.value.value = [8, 9];
  assert.deepEqual(evaluate(l).run(copies[1].id), [8, 9]);
  assert.deepEqual(evaluate(l).run(external.id), [120, 210]);
  const single = duplicateNodes(l, [ref.id])[0];
  assert.equal(single.reference.nodeId, source.id);
  const text = node('Text'),
    textRef = node('Reference');
  l.nodes.push(text, textRef);
  setReference(l, textRef.id, target(text, 'position'));
  const textCopies = duplicateNodes(l, [text.id, textRef.id]);
  assert.deepEqual(textCopies[1].reference, target(textCopies[0], 'position'));
  const dangling = node('Reference');
  dangling.reference = { nodeId: 'deleted-node', portId: 'output' };
  l.nodes.push(dangling);
  assert.deepEqual(duplicateNodes(l, [dangling.id])[0].reference, dangling.reference);
  assert.doesNotThrow(() => deserialize(serialize(doc)));
});
test('import validates target shape, same-layer ownership, type, ports and cycles without changing legacy files', () => {
  const { doc, l, source, ref } = scene();
  setReference(l, ref.id, target(source));
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  for (const badTarget of [
    undefined,
    {},
    { nodeId: source.id },
    { nodeId: source.id, portId: 'position' },
    { nodeId: source.id, portId: 'x' },
    { nodeId: source.id, portId: 'output', layerId: l.id },
    { nodeId: '<bad>', portId: 'output' },
    { nodeId: ref.id, portId: 'output' },
  ]) {
    const bad = clone(doc);
    bad.layers[0].nodes[1].reference = badTarget;
    assert.throws(() => deserialize(serialize(bad)));
  }
  const wrong = clone(doc);
  wrong.layers[0].nodes[0].reference = target(ref);
  assert.throws(() => deserialize(serialize(wrong)), /requires a Reference/);
  const cross = clone(doc),
    otherLayer = layer('Later layer'),
    foreign = node('Null');
  otherLayer.nodes.push(foreign);
  cross.layers.push(otherLayer);
  cross.layers[0].nodes[1].reference = target(foreign);
  assert.throws(() => deserialize(serialize(cross)), /same layer/);
  for (const version of [1, 2, 3]) {
    const old = document();
    if (version === 1) {
      const a = node('Circle'),
        o = node('Output');
      o.params.path.type = 'Path';
      o.params.path.source = a.id;
      old.layers[0].nodes = [a, o];
      old.layers[0].output = o.id;
    }
    old.schemaVersion = version;
    assert.doesNotThrow(() => deserialize(serialize(old)));
  }
});
test('group duplicate refuses copied edited point provenance atomically; individual remap retains external source', () => {
  const { l } = scene(),
    curve = node('Curve'),
    remap = node('Path Remap');
  l.nodes.push(curve, remap);
  connect(l, curve.id, remap.id, 'path');
  remap.edits = [{ pointId: curve.points[0].id, position: [33, 44] }];
  const before = JSON.stringify(l);
  assert.throws(() => duplicateNodes(l, [curve.id, remap.id]), /edited Path Remap/);
  assert.equal(JSON.stringify(l), before);
  const copy = duplicateNodes(l, [remap.id])[0];
  assert.deepEqual(evaluate(l).run(copy.id).contours[0].points[0].position, [283, 194]);
});
test('editable Reference sample matches an ordinary wire and survives save/load', () => {
  const d = deserialize(fs.readFileSync('examples/vector-reference-reuse.json', 'utf8')),
    r = evaluate(d.layers[0]);
  assert.deepEqual(r.run('reference-position'), [170, 200]);
  assert.deepEqual(r.run('reference-offset'), r.run('reference-wired'));
  assert.deepEqual(r.run('reference-caption', 'position'), [170, 290]);
  assert.equal(serialize(deserialize(serialize(d))), serialize(d));
});
