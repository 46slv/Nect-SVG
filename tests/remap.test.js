import test from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  node,
  evaluate,
  enableRemapPoint,
  connect,
  disconnect,
  serialize,
  deserialize,
  rebindRemapPoint,
  translateRemapPoints,
  History,
} from '../src/core.js';
test('Remap individual position and handle support expression, typed input and fallback after disconnect', () => {
  let doc = document(),
    l = doc.layers[0],
    curve = node('Curve'),
    vector = node('Vector'),
    remap = l.nodes[3];
  l.nodes.push(curve, vector);
  remap.params.path.source = curve.id;
  const input = evaluate(l).run(curve.id),
    target = input.contours[0].points[0];
  const edit = enableRemapPoint(remap, input, target.id);
  edit.params.position.value = [2, 3];
  edit.params.position.expression = '10+5; 8';
  assert.deepEqual(evaluate(l).path.contours[0].points[0].position, [265, 158]);
  vector.params.value.value = [20, 30];
  connect(l, vector.id, remap.id, `remap.${target.id}.position`);
  assert.deepEqual(evaluate(l).path.contours[0].points[0].position, [270, 180]);
  disconnect(remap, `remap.${target.id}.position`);
  assert.deepEqual(evaluate(l).path.contours[0].points[0].position, [265, 158]);
  edit.params.handleA.expression = '-5; 20';
  assert.deepEqual(evaluate(l).path.contours[0].points[0].handleA, [-5, 20]);
  assert.deepEqual(deserialize(serialize(doc)), doc);
});
test('Boolean Remap typed edits retain source guards and lock behavior', () => {
  let doc = document(),
    l = doc.layers[0],
    remap = l.nodes[3],
    input = evaluate(l).run(l.nodes[2].id),
    pt = input.contours[0].points[0];
  let edit = enableRemapPoint(remap, input, pt.id);
  edit.params.position.value = [8, 0];
  let v = node('Vector');
  l.nodes.push(v);
  edit.params.position.locked = true;
  assert.throws(() => connect(l, v.id, remap.id, `remap.${pt.id}.position`), /locked/);
  l.nodes[0].params.radius.value += 5;
  assert.match(evaluate(l).warnings[0], /suspended/);
  assert.equal(remap.edits.length, 1);
});
test('Boolean-valued Toggle connects to Curve closure with fallback restoration', () => {
  let doc = document(),
    l = doc.layers[0],
    curve = node('Curve'),
    toggle = node('Toggle');
  l.nodes.push(curve, toggle);
  toggle.params.value.value = false;
  connect(l, toggle.id, curve.id, 'closed');
  assert.equal(evaluate(l).run(curve.id).contours[0].closed, false);
  disconnect(curve, 'closed');
  assert.equal(evaluate(l).run(curve.id).contours[0].closed, true);
});

test('explicit Remap rebind preserves definitions through undo, redo and reload', () => {
  const h = new History(document());
  const layer = () => h.doc.layers[0];
  const remap = () => layer().nodes[3];
  const input = () => evaluate(layer()).run(layer().nodes[2].id);
  const id = input().contours[0].points[0].id;
  enableRemapPoint(remap(), input(), id).params.position.expression = '4; 6';
  h.apply(() => {
    layer().nodes[0].params.radius.value += 5;
  });
  const suspended = serialize(h.doc);
  assert.ok(evaluate(layer()).warnings.length);
  h.apply(() => rebindRemapPoint(remap(), input(), id));
  assert.equal(evaluate(layer()).warnings.length, 0);
  const rebound = serialize(h.doc);
  h.undo();
  assert.equal(serialize(h.doc), suspended);
  h.redo();
  assert.equal(serialize(h.doc), rebound);
  assert.deepEqual(deserialize(rebound), h.doc);
  assert.equal(remap().edits[0].params.position.expression, '4; 6');
});

test('batch Remap translation is atomic, typed and one undoable edit', () => {
  const h = new History(document());
  const l = h.doc.layers[0],
    remap = l.nodes[3],
    curve = node('Curve');
  l.nodes.push(curve);
  remap.params.path.source = curve.id;
  const input = evaluate(l).run(curve.id),
    ids = input.contours[0].points.slice(0, 2).map((p) => p.id);
  const before = serialize(h.doc);
  h.apply(() => translateRemapPoints(remap, input, ids, [5, -7]));
  assert.deepEqual(
    evaluate(l).path.contours[0].points[0].position,
    input.contours[0].points[0].position.map((v, i) => v + [5, -7][i]),
  );
  assert.equal(remap.edits.length, 2);
  const after = serialize(h.doc);
  assert.deepEqual(deserialize(after), h.doc);
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  assert.equal(serialize(h.doc), after);
  for (const protection of ['locked', 'expression', 'source']) {
    const blocked = structuredClone(remap);
    blocked.edits[1].params.position[protection] = protection === 'locked' ? true : 'driven';
    const snapshot = JSON.stringify(blocked);
    assert.throws(() => translateRemapPoints(blocked, input, ids, [4, 4]), /locked or driven/);
    assert.equal(JSON.stringify(blocked), snapshot);
  }
});
test('batch Remap rejects suspended, missing and nonfinite targets without partial edits', () => {
  const l = document().layers[0],
    remap = l.nodes[3],
    input = evaluate(l).run(l.nodes[2].id);
  const ids = input.contours[0].points.slice(0, 2).map((p) => p.id);
  enableRemapPoint(remap, input, ids[1]);
  const before = JSON.stringify(remap);
  assert.throws(
    () => translateRemapPoints(remap, { ...input, fingerprint: 'changed' }, ids, [1, 2]),
    /suspended/,
  );
  assert.throws(() => translateRemapPoints(remap, input, [ids[0], 'missing'], [1, 2]), /Missing/);
  assert.throws(() => translateRemapPoints(remap, input, ids, [Infinity, 2]), /Vector2/);
  assert.equal(JSON.stringify(remap), before);
});
