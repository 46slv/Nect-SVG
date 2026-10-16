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
} from '../src/core.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    a = node('Null'),
    b = node('Null'),
    c = node('Circle'),
    out = node('Output');
  l.nodes = [a, b, c, out];
  l.output = out.id;
  connect(l, c.id, out.id, 'path');
  return { doc, l, a, b, c, out };
}
test('Null is a non-rendering Position Vector2 source with normal input priority and typed sockets', () => {
  const { l, a, b, c, out } = scene();
  assert.deepEqual(outputPorts(a), [{ id: undefined, label: 'Position', type: 'Vector2' }]);
  assert.equal(outputType(a), 'Vector2');
  assert.equal(outputType(a, 'bogus'), undefined);
  assert.deepEqual(evaluate(l).run(a.id), [300, 250]);
  a.params.position.expression = '10*2; 40+3';
  connect(l, a.id, b.id, 'position');
  connect(l, b.id, c.id, 'center');
  assert.deepEqual(evaluate(l).run(b.id), [20, 43]);
  b.params.position.expression = '1; 2';
  assert.deepEqual(evaluate(l).run(b.id), [20, 43]);
  disconnect(b, 'position');
  assert.deepEqual(evaluate(l).run(b.id), [1, 2]);
  b.params.position.expression = '';
  assert.deepEqual(evaluate(l).run(b.id), [300, 250]);
  for (const [source, target, key] of [
    [a.id, out.id, 'path'],
    [c.id, a.id, 'position'],
    [a.id, c.id, 'radius'],
  ])
    assert.throws(() => connect(l, source, target, key), /Cannot connect/);
  connect(l, a.id, b.id, 'position');
  const before = JSON.stringify(l);
  assert.throws(() => connect(l, b.id, a.id, 'position'), /cycle/i);
  assert.equal(JSON.stringify(l), before);
  assert.throws(() => connect(l, a.id, a.id, 'position'), /cycle|itself/i);
});
test('Null output invalidates followers, composes with existing Vector Math, and does not export marker geometry', () => {
  const { doc, l, a, c } = scene(),
    math = node('Vector Math'),
    text = node('Text');
  l.nodes.push(math, text);
  math.params.b.value = [10, 30];
  connect(l, a.id, math.id, 'a');
  connect(l, math.id, c.id, 'center');
  connect(l, a.id, text.id, 'position');
  assert.deepEqual(evaluate(l).run(text.id, 'position'), [300, 250]);
  assert.deepEqual(evaluate(l).run(math.id), [310, 280]);
  a.params.position.value = [120, 80];
  assert.deepEqual(evaluate(l).run(math.id), [130, 110]);
  assert.deepEqual(evaluate(l).run(text.id, 'position'), [120, 80]);
  const svg = exportSVG(doc);
  assert.doesNotMatch(svg, /null-marker|Position handle|crosshair/);
  const literal = clone(doc),
    ll = literal.layers[0],
    circle = ll.nodes.find((n) => n.id === c.id);
  disconnect(circle, 'center');
  circle.params.center.value = [130, 110];
  ll.nodes = ll.nodes.filter((n) => !['Null', 'Vector Math', 'Text'].includes(n.type));
  assert.equal(exportSVG(literal), svg, 'Null adds no artwork at all');
});
test('Null persists defaults, named identity and connections; malformed files and old projects remain safe', () => {
  const { doc, l, a, b } = scene();
  a.name = 'Layout origin';
  connect(l, a.id, b.id, 'position');
  const loaded = deserialize(serialize(doc));
  assert.deepEqual(evaluate(loaded.layers[0]).run(b.id), [300, 250]);
  assert.equal(loaded.layers[0].nodes[0].name, 'Layout origin');
  for (const mutate of [
    (d) => (d.layers[0].nodes[0].params.position.value = [1]),
    (d) => (d.layers[0].nodes[1].params.position.sourcePort = 'position'),
    (d) => (d.layers[0].nodes[0].params.position.source = b.id),
  ]) {
    const bad = clone(doc);
    mutate(bad);
    assert.throws(() => deserialize(JSON.stringify(bad)));
  }
  assert.equal(deserialize(serialize(document())).schemaVersion, 2);
  const sample = deserialize(fs.readFileSync('examples/null-position-reuse.json', 'utf8'));
  assert.deepEqual(evaluate(sample.layers[0]).run('null-origin'), [250, 200]);
  assert.deepEqual(evaluate(sample.layers[0]).run('null-offset'), [250, 310]);
});
