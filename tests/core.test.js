import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import opentype from 'opentype.js';
import {
  document,
  layer,
  node,
  point,
  evaluate,
  pathData,
  pathArea,
  connect,
  disconnect,
  serialize,
  deserialize,
  exportSVG,
  History,
  expression,
  clone,
} from '../src/core.js';
function scene() {
  let d = document();
  return [d, d.layers[0]];
}
test('Circle → Boolean Subtract → Path Remap → Output produces real hole geometry', () => {
  let [d, l] = scene(),
    circle = l.nodes[0],
    rect = l.nodes[1];
  rect.params.center.value = [350, 250];
  rect.params.size.value = [80, 80];
  let r = evaluate(l);
  assert.equal(r.error, null);
  assert.equal(r.path.contours.length, 2);
  assert.ok(Math.abs(pathArea(r.path) - (Math.PI * 120 ** 2 - 6400)) < 20);
  let svg = exportSVG(d);
  assert.match(svg, /<path/);
  assert.ok(!svg.includes('mask'));
});
test('all Boolean operations produce expected area and chain as Path', () => {
  for (const [op, area] of [
    ['union', 15000],
    ['subtract', 5000],
    ['intersect', 5000],
    ['difference', 10000],
  ]) {
    let [, l] = scene(),
      a = node('Rectangle'),
      b = node('Rectangle');
    a.params.center.value = [50, 50];
    b.params.center.value = [100, 50];
    a.params.size.value = b.params.size.value = [100, 100];
    l.nodes.splice(0, 2, a, b);
    let bool = l.nodes[2];
    bool.params.a.source = a.id;
    bool.params.b.source = b.id;
    bool.operation = op;
    assert.ok(Math.abs(pathArea(evaluate(l).path) - area) < 0.01, op);
  }
});
test('parameter source overrides fallback and disconnect restores expression', () => {
  let [, l] = scene(),
    v = node('Value'),
    circle = l.nodes[0];
  v.params.value.value = 30;
  l.nodes.push(v);
  circle.params.radius.expression = '50 + 5 * 2';
  connect(l, v.id, circle.id, 'radius');
  assert.equal(pathArea(evaluate(l).run(circle.id)).toFixed(), '2828');
  disconnect(circle, 'radius');
  assert.ok(Math.abs(pathArea(evaluate(l).run(circle.id)) - Math.PI * 60 ** 2) < 5);
  assert.equal(circle.params.radius.value, 120);
});
test('type mismatch, cycles, and locked connections are rejected atomically', () => {
  let [, l] = scene(),
    circle = l.nodes[0],
    bool = l.nodes[2],
    remap = l.nodes[3];
  assert.throws(() => connect(l, circle.id, circle.id, 'radius'), /Cannot connect/);
  assert.throws(() => connect(l, remap.id, bool.id, 'a'), /cycle/);
  assert.equal(bool.params.a.source, circle.id);
  circle.params.radius.locked = true;
  let v = node('Value');
  l.nodes.push(v);
  assert.throws(() => connect(l, v.id, circle.id, 'radius'), /locked/);
});
test('Curve keeps Bézier handles and stable vertex IDs through remap', () => {
  let [, l] = scene(),
    curve = node('Curve');
  curve.points = [point(0, 0), point(100, 0), point(100, 100)];
  curve.points[0].handleB.value = [20, 30];
  l.nodes.push(curve);
  let remap = l.nodes[3];
  remap.params.path.source = curve.id;
  remap.edits = [{ pointId: curve.points[0].id, position: [10, 20] }];
  let r = evaluate(l);
  assert.deepEqual(r.path.contours[0].points[0].position, [10, 20]);
  assert.match(pathData(r.path), /c|C/);
  curve.points[0].position.value = [5, 5];
  assert.deepEqual(evaluate(l).path.contours[0].points[0].position, [15, 25]);
});
test('Boolean remap suspends rather than misapplies edits after source change', () => {
  let [, l] = scene(),
    r = evaluate(l),
    input = r.run(l.nodes[2].id),
    pt = input.contours[0].points[0],
    remap = l.nodes[3];
  remap.edits = [{ pointId: pt.id, fingerprint: input.fingerprint, position: [10, 0] }];
  assert.equal(evaluate(l).warnings.length, 0);
  l.nodes[0].params.radius.value += 10;
  assert.ok(evaluate(l).warnings[0].includes('suspended'));
  assert.equal(remap.edits.length, 1);
});
test('JSON round trip preserves full graph, fallback, locks and SVG', () => {
  let [d, l] = scene();
  l.nodes[0].params.center.locked = true;
  let restored = deserialize(serialize(d));
  assert.deepEqual(restored, d);
  assert.equal(exportSVG(restored), exportSVG(d));
});
test('untrusted JSON and malformed fields rejected', () => {
  let [d] = scene();
  for (const mutate of [
    (x) => (x.schemaVersion = 99),
    (x) => (x.width = -1),
    (x) => (x.layers[0].nodes[0].params.radius.value = 'bad'),
    (x) => (x.layers[0].nodes[0].params.center.type = 'Scalar'),
    (x) => (x.layers[0].nodes[0].params.radius.source = 'missing'),
  ]) {
    let copy = clone(d);
    mutate(copy);
    assert.throws(() => deserialize(JSON.stringify(copy)));
  }
});
test('history transactions rollback failures and support undo/redo', () => {
  let [d] = scene(),
    h = new History(d);
  h.apply((x) => (x.width = 800));
  h.undo();
  assert.equal(h.doc.width, 960);
  h.redo();
  assert.equal(h.doc.width, 800);
  assert.throws(() =>
    h.apply((x) => {
      x.width = 20;
      throw Error('fail');
    }),
  );
  assert.equal(h.doc.width, 800);
});
test('safe expressions reject code and nonfinite output', () => {
  assert.equal(expression('max(2, 3) * 4 + sin(0)'), 12);
  assert.equal(expression('-2 * (3 + 4)'), -14);
  for (const x of ['globalThis.alert(1)', '1/0', '2 +', '2 ** 3', 'Math.random()'])
    assert.throws(() => expression(x));
});
test('independent layer graphs do not allow implicit cross-layer input', () => {
  let [d, l] = scene(),
    other = layer('Other');
  d.layers.push(other);
  assert.throws(() => connect(l, other.nodes[0].id, l.output, 'path'), /Missing/);
});
test('Text outlines preserve counters and export without DOM', () => {
  let bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url)),
    font = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    [d, l] = scene(),
    t = node('Text');
  t.text = 'O';
  l.nodes.push(t);
  l.nodes.find((n) => n.id === l.output).params.path.source = t.id;
  let r = evaluate(l, { default: font });
  assert.equal(r.error, null);
  assert.equal(r.path.contours.length, 2);
  assert.match(exportSVG(d, { default: font }), /<path/);
});
test('connected then locked parameter survives reload', () => {
  let [d, l] = scene(),
    v = node('Value');
  l.nodes.push(v);
  connect(l, v.id, l.nodes[0].id, 'radius');
  l.nodes[0].params.radius.locked = true;
  assert.deepEqual(deserialize(serialize(d)), d);
});
test('import rejects markup-bearing IDs and style-bearing positions', () => {
  for (const mutate of [
    (d) => (d.layers[0].id = 'x\"><img src=x onerror=alert(1)>'),
    (d) => (d.layers[0].nodes[0].id = 'x\" onmouseover=alert(1)'),
    (d) => (d.layers[0].nodes[0].position = ['0;\"><img src=x>', 0]),
  ]) {
    let [d] = scene();
    mutate(d);
    assert.throws(() => deserialize(serialize(d)));
  }
});
test('Transform preserves stable Curve vertex IDs after deletion', () => {
  let [, l] = scene(),
    c = node('Curve'),
    t = node('Transform'),
    r = l.nodes[3];
  l.nodes.push(c, t);
  t.params.path.source = c.id;
  r.params.path.source = t.id;
  let target = c.points[1].id;
  r.edits = [{ pointId: target, position: [5, 0] }];
  c.points.shift();
  let result = evaluate(l);
  assert.equal(result.path.contours[0].points[0].id, target);
  assert.deepEqual(result.path.contours[0].points[0].position, [455, 150]);
});
test('incremental evaluation recomputes only the changed dependency chain', () => {
  let [, l] = scene();
  let first = evaluate(l);
  assert.equal(first.stats.computed, 6);
  let again = evaluate(l);
  assert.equal(again.stats.computed, 0);
  assert.equal(again.stats.reused, 6);
  l.nodes[0].params.radius.value = 130;
  let changed = evaluate(l);
  assert.equal(changed.stats.computed, 5);
  assert.equal(changed.stats.reused, 1);
  l.nodes[0].position = [800, 800];
  assert.equal(evaluate(l).stats.computed, 0);
});
test('cached geometry cannot be mutated by a consumer', () => {
  let [, l] = scene(),
    r = evaluate(l);
  let expected = r.path.contours[0].points[0].position[0];
  r.path.contours[0].points[0].position[0] = 99999;
  assert.equal(evaluate(l).path.contours[0].points[0].position[0], expected);
});
test('node collapse state roundtrips without invalidating geometry or legacy documents', () => {
  const [doc, l] = scene();
  const before = pathData(evaluate(l).path);
  l.nodes[2].collapsed = true;
  assert.equal(evaluate(l).stats.computed, 0);
  assert.equal(pathData(evaluate(l).path), before);
  assert.equal(deserialize(serialize(doc)).layers[0].nodes[2].collapsed, true);
  delete l.nodes[2].collapsed;
  assert.equal(deserialize(serialize(doc)).layers[0].nodes[2].collapsed, undefined);
  l.nodes[2].collapsed = 'yes';
  assert.throws(() => deserialize(serialize(doc)), /collapse state/);
});
test('excessive graph depth and expression input fail cleanly', () => {
  let [, l] = scene(),
    source = l.nodes[0];
  for (let i = 0; i < 260; i++) {
    let t = node('Convert to Path');
    t.params.path.source = source.id;
    l.nodes.push(t);
    source = t;
  }
  l.nodes.find((n) => n.id === l.output).params.path.source = source.id;
  assert.match(evaluate(l).error, /depth/);
  assert.throws(() => expression('1+'.repeat(3000) + '1'), /exceeds/);
});
test('editable V/R fixture saves and continues source editing across independent layers', () => {
  let doc = deserialize(
    fs.readFileSync(new URL('../examples/vr-converters.json', import.meta.url), 'utf8'),
  );
  assert.equal(doc.layers.length, 4);
  let rLayer = doc.layers.find((x) => x.name.startsWith('R '));
  let before = pathData(evaluate(rLayer).path);
  let counter = rLayer.nodes.find((n) => n.name === 'R / counter');
  counter.params.size.value[0] += 10;
  assert.notEqual(pathData(evaluate(rLayer).path), before);
  let restored = deserialize(serialize(doc));
  assert.equal(pathData(evaluate(restored.layers[2]).path), pathData(evaluate(rLayer).path));
});
