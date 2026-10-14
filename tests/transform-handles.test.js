import test from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  node,
  connect,
  evaluate,
  pathBounds,
  serialize,
  deserialize,
  exportSVG,
  transformHandleGeometry,
  scaleFromHandle,
  rotationHandleAngle,
  rotationHandleDelta,
  rotationFromHandle,
  characterTransform,
  transformCharacterPoint,
} from '../src/core.js';
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
const bounds = [
  [10, 30, 50],
  [20, 45, 70],
];
const state = { anchor: [10, 20], offset: [100, 50], scale: 2, rotation: 90 };
test('Transform handles share the character affine, fixed anchor+offset pivot and uniform corner ray', () => {
  const g = transformHandleGeometry(state, bounds, 2);
  near(g.pivot, [110, 70]);
  near(
    g.scale,
    transformCharacterPoint(
      characterTransform(state.anchor, state.offset, state.scale, state.rotation),
      [50, 70],
    ),
  );
  near(
    g.rotation.map((v, i) => v - g.scale[i]),
    g.axis.map((v) => v * 15),
  );
  assert.ok(
    Math.abs(
      scaleFromHandle(
        2,
        g,
        g.axis.map((v) => v * g.radius),
      ) - 3,
    ) < 1e-12,
  );
  assert.equal(scaleFromHandle(2, g, [0, 0]), 2);
  assert.equal(scaleFromHandle(2, g, [-g.axis[1] * 100, g.axis[0] * 100]), 2);
});
test('Negative, zero and near-zero Transform scales recover without division by current scale', () => {
  for (const scale of [-2, 0, 1e-15, -1e-15]) {
    const g = transformHandleGeometry({ ...state, scale }, bounds, 0.25);
    assert.ok([...g.scale, ...g.rotation].every(Number.isFinite));
    assert.ok(Math.hypot(...g.scale.map((v, i) => v - g.pivot[i])) >= 160 - 1e-9);
    assert.ok(
      Math.abs(
        scaleFromHandle(
          scale,
          g,
          g.axis.map((v) => v * g.radius),
        ) -
          (scale + g.sign),
      ) < 1e-12,
    );
    const precise = 0.123456789012345;
    assert.equal(scaleFromHandle(precise, g, [0, 0]), precise);
  }
  const collapsed = transformHandleGeometry({ ...state, anchor: [10, 20] }, [
    [10, 10, 10],
    [20, 20, 20],
  ]);
  assert.equal(collapsed.radius, 100);
  assert.ok(Number.isFinite(scaleFromHandle(0, collapsed, [50, 50])));
});
test('Rotation unwraps the ±180 boundary, accumulates turns, snaps absolute 15° and preserves exact no-op', () => {
  assert.equal(rotationHandleDelta(179, -179), 2);
  assert.equal(rotationHandleDelta(-179, 179), -2);
  assert.equal(rotationHandleAngle([4, 5], [4, 5], 1), null);
  assert.equal(rotationHandleAngle([4, 5], [4, 15]), 90);
  assert.equal(rotationFromHandle(13, 19, true), 30);
  assert.equal(rotationFromHandle(13, 19), 32);
  assert.equal(rotationFromHandle(720.123456789012, 1e-12, true), 720.123456789012);
  let total = 0,
    last = 0;
  for (const angle of [90, 179, -90, 0, 90, 179, -90, 0]) {
    total += rotationHandleDelta(last, angle);
    last = angle;
  }
  assert.equal(total, 720);
});
test('Nonfinite handle coordinates fail safely', () => {
  assert.throws(() => transformHandleGeometry({ ...state, scale: Infinity }, bounds), /finite/);
  assert.throws(() => transformHandleGeometry(state, bounds, 0), /finite/);
  const g = transformHandleGeometry(state, bounds);
  assert.equal(scaleFromHandle(2, g, [Infinity, 0]), 2);
});
test('Selected Transform state uses evaluator precedence, cache, legacy anchor and its own stage', () => {
  const d = document(),
    l = d.layers[0],
    r = node('Rectangle'),
    t = node('Transform'),
    parent = node('Transform'),
    o = node('Output'),
    v = node('Vector'),
    scalar = node('Value');
  l.nodes = [r, t, parent, o, v, scalar];
  l.output = o.id;
  connect(l, r.id, t.id, 'path');
  connect(l, t.id, parent.id, 'path');
  connect(l, parent.id, o.id, 'path');
  t.params.anchor.expression = '20;30';
  t.params.offset.expression = '7;9';
  t.params.scale.expression = '3';
  scalar.params.value.value = -2;
  connect(l, scalar.id, t.id, 'scale');
  v.params.value.value = [100, 200];
  connect(l, v.id, t.id, 'offset');
  parent.params.offset.value = [500, 100];
  const a = evaluate(l),
    s = a.transformState(t.id),
    before = serialize(d);
  assert.deepEqual(s.anchor, [20, 30]);
  assert.deepEqual(s.offset, [100, 200]);
  assert.equal(s.scale, -2);
  near(transformHandleGeometry(s, pathBounds(s.input)).pivot, [120, 230]);
  assert.notDeepEqual(a.run(t.id), a.path);
  assert.deepEqual(evaluate(l).transformState(t.id), s, 'cache exposes same state');
  assert.equal(serialize(d), before, 'no editor geometry persisted');
  assert.equal(exportSVG(deserialize(before)), exportSVG(d));
  delete t.params.anchor;
  assert.deepEqual(evaluate(l).transformState(t.id).anchor, [0, 0]);
  assert.throws(() => evaluate(l).transformState(r.id), /Select a Transform/);
});
