import test from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  node,
  connect,
  evaluate,
  validate,
  serialize,
  deserialize,
  History,
  enableRemapPoint,
} from '../src/core.js';
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
function scene() {
  const doc = document(),
    l = doc.layers[0],
    a = node('Curve'),
    b = node('Rectangle'),
    join = node('Join Geometry'),
    t = node('Transform'),
    out = node('Output');
  a.points[0].position.value = [10, 20];
  a.points[0].handleB.value = [2, 0];
  l.nodes = [a, b, join, t, out];
  l.output = out.id;
  connect(l, a.id, join.id, 'a');
  connect(l, b.id, join.id, 'b');
  connect(l, join.id, t.id, 'path');
  connect(l, t.id, out.id, 'path');
  return { doc, l, a, b, join, t, out };
}
test('shared Transform anchor is input-space pivot, with stable groups and handles; nested parents compose', () => {
  const { l, a, join, t, out } = scene(),
    original = structuredClone(a);
  t.params.anchor.value = [5, 5];
  t.params.scale.value = 2;
  t.params.rotation.value = 90;
  t.params.offset.value = [3, 4];
  const r = evaluate(l),
    input = r.run(join.id),
    path = r.run(t.id);
  assert.equal(r.error, null);
  near(path.contours[0].points[0].position, [-22, 19]);
  near(path.contours[0].points[0].handleB, [0, 4]);
  assert.deepEqual(a, original);
  assert.deepEqual(
    path.contours.map((c) => [c.id, c.group, c.points.map((p) => p.id)]),
    input.contours.map((c) => [c.id, c.group, c.points.map((p) => p.id)]),
  );
  assert.equal(path.fingerprint, input.fingerprint);
  const parent = node('Transform');
  l.nodes.push(parent);
  parent.params.offset.value = [100, 50];
  parent.params.scale.value = 0.5;
  connect(l, t.id, parent.id, 'path');
  connect(l, parent.id, out.id, 'path');
  near(evaluate(l).path.contours[0].points[0].position, [89, 59.5]);
  assert.equal(evaluate(l).stats.computed, 0);
});
test('legacy Transform runtime and JSON retain origin pivot; expression/socket/undo/redo work', () => {
  const { doc, l, t } = scene();
  t.params.scale.value = 2;
  t.params.rotation.value = 90;
  const old = evaluate(l).path;
  delete t.params.anchor;
  assert.deepEqual(evaluate(l).path, old);
  validate(doc);
  assert.deepEqual(t.params.anchor.value, [0, 0]);
  assert.deepEqual(evaluate(deserialize(serialize(doc)).layers[0]).path, old);
  const h = new History(doc);
  h.apply(() => {
    t.params.anchor.expression = '5;5';
  });
  assert.notDeepEqual(evaluate(l).path, old);
  h.undo();
  assert.deepEqual(evaluate(h.doc.layers[0]).path, old);
  h.redo();
  assert.equal(h.doc.layers[0].nodes[3].params.anchor.expression, '5;5');
  t.params.anchor.expression = '';
  const v = node('Vector');
  v.params.value.value = [5, 5];
  l.nodes.push(v);
  connect(l, v.id, t.id, 'anchor');
  near(evaluate(l).run(t.id).contours[0].points[0].position, [-25, 15]);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
});
test('anchored transform preserves imported holes and Remap identity for stable children', () => {
  const { l, a, t, join } = scene();
  a.type = 'Imported Path';
  a.params = {};
  a.points = [];
  a.rawPath = 'M0 0L100 0L100 100L0 100Z M20 20L20 80L80 80L80 20Z';
  connect(l, a.id, t.id, 'path');
  const remap = node('Path Remap');
  l.nodes.push(remap);
  connect(l, t.id, remap.id, 'path');
  const path = evaluate(l).run(t.id),
    edit = enableRemapPoint(remap, path, path.contours[0].points[0].id);
  edit.params.position.value = [2, 3];
  t.params.anchor.value = [50, 50];
  t.params.rotation.value = 30;
  assert.equal(evaluate(l).run(t.id).contours.length, 2);
  assert.equal(evaluate(l).run(remap.id).contours.length, 2);
  // Imported Path carries a source fingerprint, which transform must preserve.
  assert.equal(evaluate(l).run(t.id).fingerprint, path.fingerprint);
  assert.deepEqual(evaluate(l).warnings, []);
});
