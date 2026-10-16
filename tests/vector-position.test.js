import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  document,
  node,
  connect,
  disconnect,
  evaluate,
  outputType,
  outputPorts,
  serialize,
  deserialize,
  exportSVG,
  clone,
  History,
} from '../src/core.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    v = node('Vector'),
    origin = node('Null'),
    c = node('Circle'),
    out = node('Output');
  l.nodes = [v, origin, c, out];
  l.output = out.id;
  connect(l, v.id, c.id, 'center');
  connect(l, c.id, out.id, 'path');
  return { doc, l, v, origin, c, out };
}
test('Vector canvas display is opt-in editor state, preserving evaluation, ports, source priority and SVG', () => {
  const { doc, l, v, origin, out } = scene(),
    svg = exportSVG(doc);
  assert.equal(v.canvasPositionHandle, false);
  assert.equal(outputType(v), 'Vector2');
  assert.deepEqual(outputPorts(v), [{ id: undefined, label: '', type: 'Vector2' }]);
  const result = evaluate(l).run(v.id);
  v.canvasPositionHandle = true;
  assert.deepEqual(evaluate(l).run(v.id), result);
  assert.equal(exportSVG(doc), svg);
  v.params.value.expression = '-3.5; 0.125';
  assert.deepEqual(evaluate(l).run(v.id), [-3.5, 0.125]);
  connect(l, origin.id, v.id, 'value');
  assert.deepEqual(evaluate(l).run(v.id), [300, 250]);
  origin.params.position.value = [99.123456789, 0.0000123];
  assert.deepEqual(evaluate(l).run(v.id), [99.123456789, 0.0000123]);
  disconnect(v, 'value');
  assert.deepEqual(evaluate(l).run(v.id), [-3.5, 0.125]);
  v.params.value.expression = '';
  assert.deepEqual(evaluate(l).run(v.id), result);
  assert.throws(() => connect(l, v.id, out.id, 'path'), /Cannot connect/);
  connect(l, origin.id, v.id, 'value');
  const before = serialize(doc);
  assert.throws(() => connect(l, v.id, origin.id, 'position'), /cycle/i);
  assert.equal(serialize(doc), before);
});
test('Vector handle mode preserves math, Text Position, axis reuse and downstream Transform contracts', () => {
  const { l, v, c } = scene(),
    text = node('Text'),
    separate = node('Separate Vector'),
    combine = node('Combine Vector'),
    math = node('Vector Math'),
    transform = node('Transform');
  l.nodes.push(text, separate, combine, math, transform);
  v.canvasPositionHandle = true;
  v.params.value.value = [120.25, 85.5];
  connect(l, v.id, text.id, 'position');
  connect(l, v.id, separate.id, 'vector');
  connect(l, separate.id, combine.id, 'x', false, 'x');
  combine.params.y.value = 300;
  connect(l, v.id, math.id, 'a');
  math.params.b.value = [10, 20];
  connect(l, c.id, transform.id, 'path');
  transform.params.offset.value = [50, 20];
  transform.params.scale.value = 2;
  assert.deepEqual(evaluate(l).run(text.id, 'position'), [120.25, 85.5]);
  assert.deepEqual(evaluate(l).run(combine.id), [120.25, 300]);
  assert.deepEqual(evaluate(l).run(math.id), [130.25, 105.5]);
  evaluate(l).run(transform.id);
  assert.deepEqual(evaluate(l).run(v.id), [120.25, 85.5]);
  math.operation = 'dot';
  assert.equal(evaluate(l).run(math.id), 2912.5);
  v.canvasPositionHandle = false;
  assert.equal(evaluate(l).run(math.id), 2912.5);
});
test('Vector handle setting roundtrips, undoes and validates without migrating legacy vectors', () => {
  const { doc, v } = scene();
  delete v.canvasPositionHandle;
  const legacy = serialize(doc);
  for (const version of [1, 2, 3]) {
    const old = clone(doc);
    old.schemaVersion = version;
    if (version === 1)
      old.layers[0].nodes.find((n) => n.type === 'Output').params.path.type = 'Path';
    assert.equal(deserialize(serialize(old)).layers[0].nodes[0].canvasPositionHandle, undefined);
  }
  assert.equal(serialize(deserialize(legacy)), legacy);
  const h = new History(doc);
  h.apply((d) => (d.layers[0].nodes[0].canvasPositionHandle = true));
  assert.equal(deserialize(serialize(h.doc)).layers[0].nodes[0].canvasPositionHandle, true);
  h.undo();
  assert.equal(serialize(h.doc), legacy);
  h.redo();
  assert.equal(h.doc.layers[0].nodes[0].canvasPositionHandle, true);
  for (const value of ['true', 1, null, {}, []]) {
    const bad = clone(doc);
    bad.layers[0].nodes[0].canvasPositionHandle = value;
    assert.throws(() => deserialize(JSON.stringify(bad)), /canvas position handle/);
  }
  const wrongType = clone(doc);
  wrongType.layers[0].nodes[1].canvasPositionHandle = true;
  assert.throws(() => deserialize(JSON.stringify(wrongType)), /canvas position handle/);
  const sample = deserialize(fs.readFileSync('examples/vector-position-reuse.json', 'utf8'));
  assert.equal(sample.layers[0].nodes[0].canvasPositionHandle, true);
  assert.deepEqual(evaluate(sample.layers[0]).run('vector-origin'), [250, 200]);
  assert.deepEqual(evaluate(sample.layers[0]).run('vector-offset'), [250, 310]);
});
