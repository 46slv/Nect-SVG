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
  exportSVG,
  outputType,
} from '../src/core.js';
function scene(type) {
  const doc = document(),
    l = doc.layers[0],
    shape = node(type),
    fill = node('Fill'),
    out = node('Output');
  l.nodes = [shape, fill, out];
  l.output = out.id;
  connect(l, shape.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  shape.params.center.value = [200, 200];
  return { doc, l, shape, fill };
}
for (const type of ['Polygon', 'Star']) {
  test(type + ' exact geometry, typed composition, stable IDs, cache, JSON and history', () => {
    const { doc, l, shape, fill } = scene(type),
      key = type === 'Polygon' ? 'sides' : 'points';
    shape.params[key].value = 4;
    let result = evaluate(l),
      points = result.path.contours[0].points;
    assert.equal(result.error, null);
    assert.equal(outputType(shape), 'Path');
    assert.equal(points.length, type === 'Star' ? 8 : 4);
    assert.deepEqual(points[0].position, [200, 80]);
    assert.ok(
      points.every((p) => p.handleA.every((v) => v === 0) && p.handleB.every((v) => v === 0)),
    );
    assert.equal(result.path.contours[0].closed, true);
    assert.equal(evaluate(l).stats.computed, 0);
    const ids = points.map((p) => p.id);
    shape.params.rotation.expression = '90';
    shape.params.center.value = [300, 200];
    result = evaluate(l);
    assert.deepEqual(result.path.contours[0].points[0].position, [420, 200]);
    assert.deepEqual(
      result.path.contours[0].points.map((p) => p.id),
      ids,
    );
    assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
    const h = new History(doc);
    h.apply(() => {
      shape.params[key].value = 5;
    });
    assert.notDeepEqual(
      evaluate(l).path.contours[0].points.map((p) => p.id),
      ids,
    );
    h.undo();
    assert.deepEqual(
      evaluate(h.doc.layers[0]).path.contours[0].points.map((p) => p.id),
      ids,
    );
    h.redo();
    assert.equal(h.doc.layers[0].nodes[0].params[key].value, 5);
    for (const operation of ['Boolean', 'Join Geometry', 'Geometry Repeater']) {
      const op = node(operation),
        other = node('Circle');
      l.nodes.push(op, other);
      if (operation === 'Geometry Repeater') connect(l, shape.id, op.id, 'path');
      else {
        connect(l, shape.id, op.id, 'a');
        connect(l, other.id, op.id, 'b');
      }
      connect(l, op.id, fill.id, 'path');
      assert.equal(evaluate(l).error, null);
      assert.match(exportSVG(doc), /<path/);
    }
    const stroke = node('Stroke');
    l.nodes.push(stroke);
    connect(l, fill.id, stroke.id, 'path');
    assert.ok(evaluate(l).run(stroke.id).stroke);
  });
  test(type + ' bounded literals, resolved expressions/sockets and Remap suspension', () => {
    const { doc, l, shape, fill } = scene(type),
      key = type === 'Polygon' ? 'sides' : 'points';
    for (const invalid of [0, 2, 3.5, 257, Infinity]) {
      shape.params[key].value = invalid;
      assert.throws(() => validate(doc));
      assert.ok(evaluate(l).error);
    }
    shape.params[key].value = 5;
    shape.params[key].expression = '257';
    assert.match(evaluate(l).error, /integer/);
    shape.params[key].expression = '';
    const value = node('Value');
    l.nodes.push(value);
    connect(l, value.id, shape.id, key);
    value.params.value.value = 2;
    assert.match(evaluate(l).error, /integer/);
    value.params.value.value = 256;
    assert.equal(evaluate(l).error, null);
    delete shape.params[key].source;
    for (const radius of [0, -1, 100001]) {
      shape.params[type === 'Star' ? 'outerRadius' : 'radius'].value = radius;
      assert.throws(() => validate(doc), /Radii|innerRadius/);
      assert.ok(evaluate(l).error);
    }
    shape.params[type === 'Star' ? 'outerRadius' : 'radius'].value = 120;
    if (type === 'Star') {
      shape.params.innerRadius.value = 121;
      assert.match(evaluate(l).error, /innerRadius/);
      shape.params.innerRadius.value = 60;
    }
    const remap = node('Path Remap');
    l.nodes.push(remap);
    connect(l, shape.id, remap.id, 'path');
    connect(l, remap.id, fill.id, 'path');
    const path = evaluate(l).run(shape.id),
      id = path.contours[0].points[0].id;
    enableRemapPoint(remap, path, id).params.position.value = [10, 0];
    shape.params.rotation.value = 30;
    assert.deepEqual(evaluate(l).warnings, []);
    shape.params[key].value = 6;
    assert.match(evaluate(l).warnings.join(' '), /suspended/);
    assert.deepEqual(evaluate(l).run(remap.id).contours, evaluate(l).run(shape.id).contours);
    assert.equal(remap.edits[0].pointId, id);
    assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  });
}
