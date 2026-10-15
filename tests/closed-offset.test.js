import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  offsetClosedPath,
  offsetClosedPathDetailed,
  OffsetError,
  OFFSET_LIMITS,
} from '../src/closed-offset.js';
import { ClipperOffset, EndType, JoinType } from 'clipper2-ts';
import { NectClipperOffset } from '../src/clipper-adapter.js';

const point = (position, i = 0) => ({
  id: `source-p${i}`,
  position,
  handleA: [0, 0],
  handleB: [0, 0],
});
const polygon = (positions, reverse = false) => ({
  id: 'source-c',
  closed: true,
  points: (reverse ? [...positions].reverse() : positions).map(point),
});
const rect = (x = 0, y = 0, w = 100, h = 60, reverse = false) =>
  polygon(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    reverse,
  );
const path = (...contours) => ({ contours });
const area = (p) =>
  Math.abs(
    p.contours.reduce((total, c) => {
      const [ox, oy] = c.points[0].position;
      return (
        total +
        c.points.reduce((s, a, i) => {
          const b = c.points[(i + 1) % c.points.length];
          return (
            s +
            (a.position[0] - ox) * (b.position[1] - oy) -
            (a.position[1] - oy) * (b.position[0] - ox)
          );
        }, 0) /
          2
      );
    }, 0),
  );
const bounds = (p) => {
  const positions = p.contours.flatMap((c) => c.points.map((p) => p.position));
  return [
    Math.min(...positions.map((p) => p[0])),
    Math.min(...positions.map((p) => p[1])),
    Math.max(...positions.map((p) => p[0])),
    Math.max(...positions.map((p) => p[1])),
  ];
};
const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
const rejects = (code, fn) =>
  assert.throws(
    fn,
    (e) =>
      e instanceof OffsetError && (Array.isArray(code) ? code.includes(e.code) : e.code === code),
  );
const freeze = (x) => {
  if (x && typeof x === 'object') {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }
  return x;
};
function circle(r = 50, cx = 0, cy = 0) {
  const k = ((4 * (Math.SQRT2 - 1)) / 3) * r;
  return {
    closed: true,
    points: [
      [
        [r + cx, cy],
        [0, -k],
        [0, k],
      ],
      [
        [cx, r + cy],
        [k, 0],
        [-k, 0],
      ],
      [
        [-r + cx, cy],
        [0, k],
        [0, -k],
      ],
      [
        [cx, -r + cy],
        [-k, 0],
        [k, 0],
      ],
    ].map(([position, handleA, handleB], i) => ({ id: `circle-${i}`, position, handleA, handleB })),
  };
}

test('pinned offset/engine source integrity and private runtime seam', () => {
  const root = new URL('../node_modules/clipper2-ts/', import.meta.url);
  assert.equal(
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).dependencies[
      'clipper2-ts'
    ],
    '2.0.1-18',
  );
  assert.equal(JSON.parse(readFileSync(new URL('package.json', root))).version, '2.0.1-18');
  for (const [file, expected] of Object.entries({
    'Core.js': '1e5b1482ca2efe4c0248417f643aeadd4e1534c0c8ecd0de6adc9ee332f7767a',
    'Engine.js': '84b49914d16013d9ef3fac00bb685f6e9c361a36652e63b1c0055ef6f3f13761',
    'Offset.js': 'ae8a8c8a3d92fa38475b262c5b010def77f92a90401f0d44b02bd4ca65a1ac9b',
  }))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`dist/${file}`, root)))
        .digest('hex'),
      expected,
    );
  for (const method of ['doBevel', 'doMiter', 'doSquare'])
    assert.equal(typeof ClipperOffset.prototype[method], 'function');
});
test('Nect 100x60 rectangle +10 oracle', () => {
  const p = offsetClosedPath(path(rect()), 10);
  assert.deepEqual(bounds(p), [-10, -10, 110, 70]);
  near(area(p), 9600);
});
test('Nect inward rectangle oracle and exact/full erosion', () => {
  near(area(offsetClosedPath(path(rect()), -10)), 3200);
  for (const amount of [-30, -31, -100])
    assert.deepEqual(offsetClosedPath(path(rect()), amount), { contours: [] });
  assert.deepEqual(offsetClosedPath({ contours: [] }, 10), { contours: [] });
  assert.deepEqual(offsetClosedPath(offsetClosedPath(path(rect()), -100), 5), { contours: [] });
});
test('true bevel oracle, miter threshold and low limit', () => {
  near(area(offsetClosedPath(path(rect()), 10, { join: 'bevel' })), 9400);
  near(area(offsetClosedPath(path(rect()), 10, { miterLimit: 1 })), 9400);
  near(area(offsetClosedPath(path(rect()), 10, { miterLimit: 1.4 })), 9400);
  near(area(offsetClosedPath(path(rect()), 10, { miterLimit: Math.SQRT2 })), 9600);
  near(area(offsetClosedPath(path(rect()), 10, { miterLimit: 2 })), 9600);
});
test('stock square fallback is demonstrably different and adapter is isolated', () => {
  const input = [
    [
      { x: 0, y: 0 },
      { x: 1000000, y: 0 },
      { x: 1000000, y: 600000 },
      { x: 0, y: 600000 },
    ],
  ];
  const base = new ClipperOffset(1),
    adapter = new NectClipperOffset(1);
  const a = [],
    b = [];
  for (const engine of [base, adapter]) engine.addPaths(input, JoinType.Miter, EndType.Polygon);
  base.execute(100000, a);
  adapter.execute(100000, b);
  assert.notDeepEqual(a, b);
  assert.equal(ClipperOffset.prototype.doSquare.name, 'doSquare');
});
test('round rectangle bounds and arc-sagitta approximation', () => {
  const { path: p, diagnostics: d } = offsetClosedPathDetailed(path(rect()), 10, { join: 'round' });
  assert.deepEqual(bounds(p), [-10, -10, 110, 70]);
  near(area(p), 9200 + 100 * Math.PI, 5);
  assert.equal(d.arcSagittaMaxError, 0.1);
  assert.ok(d.outputVertices <= d.estimatedJoinVertices);
  // Every rounded corner edge has radius-10 endpoints and <= declared sagitta.
  for (const c of p.contours)
    for (let i = 0; i < c.points.length; i++) {
      const a = c.points[i].position,
        b = c.points[(i + 1) % c.points.length].position;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 20) continue;
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2;
      const center = [
        mx < 0 ? 0 : mx > 100 ? 100 : mx < 50 ? 0 : 100,
        my < 0 ? 0 : my > 60 ? 60 : my < 30 ? 0 : 60,
      ];
      assert.ok(10 - Math.hypot(mx - center[0], my - center[1]) <= 0.1001);
    }
});
test('tiny round offset is finite and does not silently pass through', () => {
  const p = offsetClosedPath(path(rect()), 0.0001, { join: 'round' });
  assert.equal(bounds(p)[0], -0.0001);
  for (const c of p.contours)
    for (const p of c.points) assert.ok(p.position.every(Number.isFinite));
});
test('holes expand/contract in the opposite direction to their shell', () => {
  const source = path(rect(0, 0, 100, 100), rect(30, 30, 40, 40, true));
  near(area(offsetClosedPath(source, 5)), 12100 - 900);
  near(area(offsetClosedPath(source, -5)), 8100 - 2500);
  const filled = offsetClosedPath(source, 25);
  assert.equal(filled.contours.length, 1);
  near(area(filled), 22500);
  assert.deepEqual(offsetClosedPath(source, -15), { contours: [] });
});
test('nonzero semantics ignore nested same-sign contours', () => {
  const source = path(rect(0, 0, 100, 100), rect(20, 20, 60, 60), rect(30, 30, 40, 40, true));
  const r = offsetClosedPathDetailed(source, 5);
  assert.equal(r.diagnostics.activeBoundaries, 1);
  near(area(r.path), 12100);
});
test('nested shell/hole/island and reverse winding are equivalent', () => {
  const source = path(rect(0, 0, 200, 200), rect(30, 30, 140, 140, true), rect(70, 70, 60, 60));
  const reversed = structuredClone(source);
  reversed.contours.forEach((c) => c.points.reverse());
  for (const input of [source, reversed]) {
    const r = offsetClosedPath(input, 5);
    assert.equal(r.contours.length, 3);
    near(area(r), 44100 - 16900 + 4900);
  }
});
test('disjoint mixed-winding shells normalize and merge when expanded', () => {
  const source = path(rect(0, 0, 10, 10), rect(30, 0, 10, 10, true));
  near(area(offsetClosedPath(source, 2)), 392);
  assert.equal(offsetClosedPath(source, 2).contours.length, 2);
  assert.equal(offsetClosedPath(source, 12).contours.length, 1);
  near(area(offsetClosedPath(source, 12)), 64 * 34);
});
test('concave L and erosion splitting use clipping cleanup', () => {
  const l = path(
    polygon([
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ]),
  );
  near(area(offsetClosedPath(l, 10)), 10800);
  near(area(offsetClosedPath(l, -10)), 2800);
  const dumbbell = path(
    polygon([
      [0, 0],
      [40, 0],
      [40, 15],
      [60, 15],
      [60, 0],
      [100, 0],
      [100, 40],
      [60, 40],
      [60, 25],
      [40, 25],
      [40, 40],
      [0, 40],
    ]),
  );
  const result = offsetClosedPath(dumbbell, -6);
  assert.equal(result.contours.length, 2);
  near(area(result), 1568);
});
test('four-cubic circle supports signed offset with bounded flattening', () => {
  for (const [amount, radius] of [
    [10, 60],
    [-10, 40],
  ]) {
    const { path: p, diagnostics: d } = offsetClosedPathDetailed(path(circle()), amount, {
      join: 'round',
    });
    const b = bounds(p);
    b.forEach((v, i) => near(v, i < 2 ? -radius : radius, 0.15));
    assert.ok(d.cubicFlatteningMaxError <= 0.1);
    assert.ok(d.flattenedVertices > 4 && d.flattenedVertices <= OFFSET_LIMITS.flattenedVertices);
    assert.ok(d.subdivisionNodes <= OFFSET_LIMITS.subdivisionNodes);
    assert.ok(d.topologyPairChecks <= OFFSET_LIMITS.pairChecks);
  }
});
test('finer curve tolerance reduces measured flatness and increases sampling', () => {
  const a = offsetClosedPathDetailed(path(circle()), 10, { join: 'round' }).diagnostics;
  const b = offsetClosedPathDetailed(path(circle()), 10, {
    join: 'round',
    flattenTolerance: 0.01,
  }).diagnostics;
  assert.ok(b.cubicFlatteningMaxError <= 0.01);
  assert.ok(b.cubicFlatteningMaxError < a.cubicFlatteningMaxError);
  assert.ok(b.flattenedVertices > a.flattenedVertices);
});
test('zero is exact identity including open paths, handles, ids and metadata', () => {
  const source = freeze({
    contours: [{ ...circle(), closed: false, group: 'a' }],
    extra: { token: 123 },
  });
  assert.equal(offsetClosedPath(source, 0), source);
  assert.equal(offsetClosedPath(source, -0), source);
  assert.equal(offsetClosedPath(source, 0, { join: 'unsupported' }), source);
});
test('no input mutation on success or failure; derived IDs and zero handles', () => {
  const source = freeze(path(rect(), rect(20, 20, 10, 10, true))),
    before = JSON.stringify(source);
  const result = offsetClosedPath(source, 2, { prefix: 'operation-123' });
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(result, source);
  for (const c of result.contours)
    for (const p of c.points) {
      assert.ok(p.id.startsWith('operation-123:'));
      assert.deepEqual(p.handleA, [0, 0]);
      assert.deepEqual(p.handleB, [0, 0]);
    }
  rejects('OFFSET_RANGE', () => offsetClosedPath(source, 1e10));
  assert.equal(JSON.stringify(source), before);
});
test('large translated artwork retains area and bounds', () => {
  const origin = 1e9,
    source = path(rect(origin, origin));
  const result = offsetClosedPath(source, 10);
  assert.deepEqual(bounds(result), [origin - 10, origin - 10, origin + 110, origin + 70]);
  near(area(result), 9600);
});
test('open, grouped, nonzero-only and non-Path inputs have explicit errors', () => {
  rejects('OFFSET_OPEN_PATH', () => offsetClosedPath(path({ ...rect(), closed: false }), 10));
  rejects('OFFSET_UNSUPPORTED', () => offsetClosedPath(path({ ...rect(), group: 0 }), 10));
  rejects('OFFSET_UNSUPPORTED', () => offsetClosedPath(path(rect()), 10, { fillRule: 'evenodd' }));
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath({ kind: 'image', contours: [] }, 10));
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath(null, 10));
});
test('self-crossing, self-touching, overlapping and cross-contour touching reject', () => {
  for (const positions of [
    [
      [0, 0],
      [100, 100],
      [0, 100],
      [100, 0],
    ],
    [
      [0, 0],
      [100, 100],
      [0, 100],
      [70, 0],
    ],
    [
      [0, 0],
      [100, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ],
    [
      [0, 0],
      [50, 50],
      [100, 0],
      [100, 100],
      [50, 50],
      [0, 100],
    ],
  ])
    rejects(['OFFSET_GEOMETRY', 'OFFSET_UNCERTAIN_TOPOLOGY'], () =>
      offsetClosedPath(path(polygon(positions)), 10),
    );
  for (const other of [rect(100, 0), rect(90, 20), rect(100, 60)])
    rejects('OFFSET_GEOMETRY', () => offsetClosedPath(path(rect(), other), 10));
});
test('curved crossing and tangency cannot hide inside coarse flattening', () => {
  rejects(['OFFSET_GEOMETRY', 'OFFSET_UNCERTAIN_TOPOLOGY'], () =>
    offsetClosedPath(path(circle(10), circle(10, 15)), 1),
  );
  rejects(['OFFSET_GEOMETRY', 'OFFSET_UNCERTAIN_TOPOLOGY'], () =>
    offsetClosedPath(path(circle(10), circle(10, 20)), 1),
  );
});
test('near-touching geometry rejects rather than making precision assumptions', () => {
  rejects('OFFSET_UNCERTAIN_TOPOLOGY', () => offsetClosedPath(path(rect(), rect(100.0001, 0)), 10));
});
test('degenerate and grid-collapsed inputs are rejected', () => {
  for (const points of [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0.00001, 0],
      [1, 1],
      [0, 1],
    ],
  ])
    rejects(['OFFSET_GEOMETRY', 'OFFSET_PRECISION', 'OFFSET_UNCERTAIN_TOPOLOGY'], () =>
      offsetClosedPath(path(polygon(points)), 1),
    );
});
test('NaN, infinity, invalid handles/options, out-of-range and subgrid amounts reject', () => {
  for (const amount of [NaN, Infinity, -Infinity, '10'])
    rejects('OFFSET_AMOUNT', () => offsetClosedPath(path(rect()), amount));
  for (const opts of [
    { join: 'square' },
    { miterLimit: 0.5 },
    { miterLimit: 101 },
    { arcTolerance: 0 },
    { flattenTolerance: 0.00001 },
    null,
  ])
    rejects('OFFSET_OPTIONS', () => offsetClosedPath(path(rect()), 10, opts));
  const broken = path(rect());
  broken.contours[0].points[0].handleA = [NaN, 0];
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath(broken, 10));
  rejects('OFFSET_PRECISION', () => offsetClosedPath(path(rect()), 0.00001));
  rejects('OFFSET_RANGE', () => offsetClosedPath(path(rect(0, 0, 1e8, 60)), 10));
  rejects('OFFSET_RANGE', () => offsetClosedPath(path(rect(1e13, 0)), 10));
  rejects('OFFSET_RANGE', () => offsetClosedPath(path(rect()), 1e6));
});
test('contour, source/flattened vertices and join-work limits are bounded', () => {
  rejects('OFFSET_LIMIT', () =>
    offsetClosedPath(path(...Array.from({ length: 257 }, () => rect())), 1),
  );
  const ring = (n) =>
    polygon(
      Array.from({ length: n }, (_, i) => [
        100 * Math.cos((i / n) * 2 * Math.PI),
        100 * Math.sin((i / n) * 2 * Math.PI),
      ]),
    );
  rejects('OFFSET_LIMIT', () => offsetClosedPath(path(ring(32769)), 1));
  rejects('OFFSET_LIMIT', () => offsetClosedPath(path(ring(2049)), 1));
  rejects('OFFSET_LIMIT', () =>
    offsetClosedPath(path(ring(100)), 10000, { join: 'round', arcTolerance: 0.001 }),
  );
});
test('deterministic repeated evaluations', () => {
  const source = path(circle(), rect(-10, -10, 20, 20, true));
  assert.deepEqual(
    offsetClosedPath(source, 4, { join: 'round' }),
    offsetClosedPath(source, 4, { join: 'round' }),
  );
});
test('regular convex polygon miter oracles over many sizes/rotations', () => {
  for (let n = 3; n <= 24; n++)
    for (const angle of [0, 0.137]) {
      const radius = 30 + n * 3,
        amount = 2;
      const source = path(
        polygon(
          Array.from({ length: n }, (_, i) => [
            radius * Math.cos((i * 2 * Math.PI) / n + angle),
            radius * Math.sin((i * 2 * Math.PI) / n + angle),
          ]),
        ),
      );
      const before = (n * radius * radius * Math.sin((2 * Math.PI) / n)) / 2;
      const perimeter = n * 2 * radius * Math.sin(Math.PI / n);
      const cornerTerm = n * Math.tan(Math.PI / n) * amount * amount;
      near(area(offsetClosedPath(source, amount)), before + perimeter * amount + cornerTerm, 0.08);
      near(area(offsetClosedPath(source, -amount)), before - perimeter * amount + cornerTerm, 0.08);
    }
});
test('sparse input arrays reject with structured errors', () => {
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath({ contours: Array(1) }, 1));
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath(path({ closed: true, points: Array(3) }), 1));
  const p = path(rect());
  p.contours[0].points[0].position = Array(2);
  rejects('OFFSET_GEOMETRY', () => offsetClosedPath(p, 1));
});
test('acute-inset error is not misrepresented as a single rounding bound', () => {
  const { path: p, diagnostics: d } = offsetClosedPathDetailed(
    path(
      polygon([
        [0, 0],
        [100, 0],
        [50, 1],
      ]),
    ),
    -0.1,
  );
  const expected = 0.1 * (50 + Math.hypot(50, 1));
  assert.ok(Math.abs(bounds(p)[0] - expected) > d.offsetConstructionRoundingMaxError);
  assert.equal(d.finalOffsetErrorBound, null);
  assert.equal(d.outputRoundingMaxError, undefined);
});
test('microscopic authored self-loop is not erased by rounded handle addition', () => {
  const source = path(
    polygon([
      [0, 0],
      [99, 0],
      [99, 101],
      [100, 100],
      [101, 100],
      [101, 102],
      [0, 102],
    ]),
  );
  const e = 1e-8;
  source.contours[0].points[3].handleB = [-0.3 * e * e, e * e];
  source.contours[0].points[4].handleA = [-1, -e];
  rejects('OFFSET_PRECISION', () => offsetClosedPath(source, 1));
});
test('world-coordinate restoration cannot return a collapsed thin region', () => {
  const o = 1e12 - 1000;
  const source = path(rect(o, o, 1.00048828125, 2));
  rejects('OFFSET_PRECISION', () =>
    offsetClosedPath(source, -0.500234140625, { flattenTolerance: 1 }),
  );
});
test('near-erosion kernel residue cannot masquerade as a filled orphan hole', () => {
  const source = path(
    polygon([
      [999999990000, 999999990000],
      [999999990199.8632, 999999990007.3983],
      [999999990099.8945, 999999990004.6984],
    ]),
  );
  rejects('OFFSET_GEOMETRY', () =>
    offsetClosedPath(source, -0.499977500624961, { flattenTolerance: 1 }),
  );
});
