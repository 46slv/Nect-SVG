import test from 'node:test';
import assert from 'node:assert/strict';
import { objectResizeHandles, resizedObjectValue } from '../src/object-resize.js';
import { document, node, connect, evaluate } from '../src/core.js';

test('Direct dimension handles preserve pivots, signs, zero recovery and exact no-op', () => {
  const h = objectResizeHandles('Rectangle', { center: [20, 30], size: [-100, 0] }, 2);
  assert.deepEqual(
    h.map((h) => h.point),
    [
      [70, 30],
      [20, 50],
    ],
  );
  assert.deepEqual(resizedObjectValue([-100, 0], h[0], [20, 0]), [-140, 0]);
  assert.deepEqual(resizedObjectValue([-100, 0], h[1], [0, 20]), [-100, 40]);
  const original = [100.12345678901234, 27];
  assert.deepEqual(resizedObjectValue(original, h[0], [0, 40]), original);
  assert.deepEqual(resizedObjectValue(original, h[0], [-999, 0]), [0, 27]);
  const text = objectResizeHandles('Text', { position: [100, 200], size: 12 }, 1)[0];
  assert.deepEqual(text.point, [140, 200]);
  assert.equal(resizedObjectValue(12, text, [-100, 0]), 0.01);
  assert.equal(resizedObjectValue(12, text, [200000, 0]), 100000);
  const star = objectResizeHandles('Star', { center: [0, 0], outerRadius: 100, innerRadius: 50 });
  assert.equal(resizedObjectValue(100, star[0], [-500, 0]), 50);
  assert.equal(resizedObjectValue(50, star[1], [0, 500]), 100);
});

test('Object state uses the evaluator connection/expression precedence independently of downstream transforms', () => {
  const d = document(),
    l = d.layers[0],
    r = node('Rectangle'),
    v = node('Vector'),
    t = node('Transform'),
    out = node('Output');
  l.nodes = [r, v, t, out];
  l.output = out.id;
  v.params.value.value = [123, 456];
  r.params.center.expression = '10;20';
  r.params.size.expression = '999;999';
  connect(l, v.id, r.id, 'size');
  connect(l, r.id, t.id, 'path');
  connect(l, t.id, out.id, 'path');
  t.params.scale.value = 3;
  const result = evaluate(l);
  assert.deepEqual(result.objectResizeState(r.id).center, [10, 20]);
  assert.deepEqual(result.objectResizeState(r.id).size, [123, 456]);
  assert.throws(() => result.objectResizeState(t.id), /supported generator/);
});

test('Circle negative fallback recovers and reference-edge handles point away from a fixed anchor', () => {
  const circle = objectResizeHandles('Circle', { center: [0, 0], radius: -20 })[0];
  assert.equal(resizedObjectValue(-20, circle, [20, 0]), 20);
  assert.equal(resizedObjectValue(-20, circle, [0, 0]), -20);
  for (const [positionReference, point, direction] of [
    ['left-top', [100, 0], 1],
    ['right-bottom', [-100, 0], -1],
  ]) {
    const h = objectResizeHandles('Rectangle', {
      center: [0, 0],
      size: [100, 80],
      positionReference,
    })[0];
    assert.deepEqual(h.point, point);
    assert.deepEqual(resizedObjectValue([100, 80], h, [direction * 20, 0]), [120, 80]);
  }
});

test('Star editing respects resolved and serialized fallback sibling bounds', async () => {
  const { serialize, deserialize } = await import('../src/core.js');
  for (const driven of ['innerRadius', 'outerRadius']) {
    const d = document(),
      l = d.layers[0],
      s = node('Star'),
      v = node('Value'),
      out = node('Output');
    s.params.outerRadius.value = 100;
    s.params.innerRadius.value = 60;
    v.params.value.value = driven === 'innerRadius' ? 20 : 150;
    l.nodes = [s, v, out];
    l.output = out.id;
    connect(l, v.id, s.id, driven);
    connect(l, s.id, out.id, 'path');
    const h = objectResizeHandles('Star', evaluate(l).objectResizeState(s.id))[
      driven === 'innerRadius' ? 0 : 1
    ];
    const q = s.params[h.key];
    q.value = resizedObjectValue(q.value, h, driven === 'innerRadius' ? [-200, 0] : [0, 200]);
    assert.equal(evaluate(l).error, null);
    assert.doesNotThrow(() => deserialize(serialize(d)));
    assert.equal(q.value, driven === 'innerRadius' ? 60 : 100);
  }
});

test('Sub-pixel Star radii stay valid when the effective outer bound is below the usual minimum', () => {
  const values = {
    center: [0, 0],
    outerRadius: 0.001,
    innerRadius: 0.0005,
    fallbackOuterRadius: 0.001,
    fallbackInnerRadius: 0.0005,
  };
  const h = objectResizeHandles('Star', values)[1];
  for (const dy of [-10, 10]) {
    const next = resizedObjectValue(values.innerRadius, h, [0, dy]);
    assert.ok(next > 0 && next <= values.outerRadius);
  }
});
