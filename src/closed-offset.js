import { EndType, JoinType } from 'clipper2-ts';
import { NectClipperOffset } from './clipper-adapter.js';

export const OFFSET_LIMITS = Object.freeze({
  contours: 256,
  sourcePoints: 32768,
  flattenedVertices: 2048,
  subdivisionNodes: 65536,
  subdivisionDepth: 24,
  pairChecks: 8000000,
  estimatedJoinVertices: 100000,
  outputVertices: 4096,
  coordinateMagnitude: 1e12,
  integerMagnitude: 2 ** 30,
  scale: 10000,
});

export class OffsetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OffsetError';
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new OffsetError(code, message);
};
const check = (ok, code, message) => {
  if (!ok) fail(code, message);
};
const same = (a, b) => a.x === b.x && a.y === b.y;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const midpoint = (a, b) => ({ x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 });
const magnitude = (p) => Math.max(Math.abs(p.x), Math.abs(p.y));
const sign = (v) => (v < 0n ? -1 : v > 0n ? 1 : 0);

function vector(value, label) {
  check(
    Array.isArray(value) &&
      value.length === 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]),
    'OFFSET_GEOMETRY',
    `${label} must be a finite Vector2`,
  );
  check(
    value.every((n) => Math.abs(n) <= OFFSET_LIMITS.coordinateMagnitude),
    'OFFSET_RANGE',
    `${label} exceeds coordinate magnitude 1e12`,
  );
  return { x: value[0], y: value[1] };
}
function pointDistance(p, a, b) {
  const v = sub(b, a);
  const lengthSquared = dot(v, v);
  const t = lengthSquared ? Math.max(0, Math.min(1, dot(sub(p, a), v) / lengthSquared)) : 0;
  return Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y);
}
const exactX = (p) => p.exactX ?? BigInt(p.x);
const exactY = (p) => p.exactY ?? BigInt(p.y);
function orientation(a, b, c) {
  return sign(
    (exactX(b) - exactX(a)) * (exactY(c) - exactY(a)) -
      (exactY(b) - exactY(a)) * (exactX(c) - exactX(a)),
  );
}
// Final world-coordinate conversion can lose a narrow feature even when the
// local integer output is valid. Represent the actual returned IEEE doubles
// exactly as integers on one dyadic grid, then revalidate their topology.
function exactWorldRings(contours) {
  const view = new DataView(new ArrayBuffer(8));
  const dyadic = (value) => {
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    const exponent = Number((bits >> 52n) & 0x7ffn);
    const fraction = bits & ((1n << 52n) - 1n);
    const mantissa = (exponent ? (1n << 52n) | fraction : fraction) * (bits >> 63n ? -1n : 1n);
    return { mantissa, exponent: exponent ? exponent - 1075 : -1074 };
  };
  let minimumExponent = 0;
  const rings = contours.map((c) => ({
    points: c.points.map(({ position: [x, y] }) => {
      const dx = dyadic(x),
        dy = dyadic(y);
      if (dx.mantissa !== 0n) minimumExponent = Math.min(minimumExponent, dx.exponent);
      if (dy.mantissa !== 0n) minimumExponent = Math.min(minimumExponent, dy.exponent);
      return { x, y, dx, dy };
    }),
  }));
  for (const ring of rings)
    for (const p of ring.points) {
      p.exactX = p.dx.mantissa << BigInt(p.dx.exponent - minimumExponent);
      p.exactY = p.dy.mantissa << BigInt(p.dy.exponent - minimumExponent);
    }
  return rings;
}
function onSegment(p, a, b) {
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
function intersects(a, b, c, d) {
  const o1 = orientation(a, b, c),
    o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a),
    o4 = orientation(c, d, b);
  return (
    (o1 * o2 < 0 && o3 * o4 < 0) ||
    (o1 === 0 && onSegment(c, a, b)) ||
    (o2 === 0 && onSegment(d, a, b)) ||
    (o3 === 0 && onSegment(a, c, d)) ||
    (o4 === 0 && onSegment(b, c, d))
  );
}
function segmentDistance(a, b, c, d) {
  if (intersects(a, b, c, d)) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
function twiceArea(points) {
  const o = points[0];
  let area = 0n;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area +=
      (exactX(a) - exactX(o)) * (exactY(b) - exactY(o)) -
      (exactY(a) - exactY(o)) * (exactX(b) - exactX(o));
  }
  return area;
}
function contains(point, points) {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const turn = orientation(a, b, point);
    if (a.y <= point.y && b.y > point.y && turn > 0) winding++;
    if (a.y > point.y && b.y <= point.y && turn < 0) winding--;
  }
  return winding !== 0;
}

export const OFFSET_EDITOR_LIMITS = Object.freeze({
  contours: 32,
  sourcePoints: 256,
  flattenedVertices: 256,
  subdivisionNodes: 4096,
  pairChecks: 300000,
  estimatedJoinVertices: 4096,
  outputVertices: 512,
});
function restrictedLimits(overrides) {
  check(
    overrides && typeof overrides === 'object' && !Array.isArray(overrides),
    'OFFSET_OPTIONS',
    'Offset work limits must be an object',
  );
  for (const [key, value] of Object.entries(overrides)) {
    check(
      Object.hasOwn(OFFSET_EDITOR_LIMITS, key) &&
        Number.isInteger(value) &&
        value > 0 &&
        value <= OFFSET_LIMITS[key],
      'OFFSET_OPTIONS',
      'Offset work limits may only tighten qualified budgets',
    );
  }
  return { ...OFFSET_LIMITS, ...overrides };
}
function newBudget(limits) {
  return { limits, nodes: 0, vertices: 0, pairs: 0, maxError: 0 };
}
function countPair(budget) {
  check(
    ++budget.pairs <= budget.limits.pairChecks,
    'OFFSET_LIMIT',
    'Offset topology work limit exceeded',
  );
}
function leafMonotone(controls, floatGuard) {
  const direction = sub(controls[3], controls[0]);
  if (dot(direction, direction) === 0) return false;
  const projectionGuard = 4 * floatGuard * Math.hypot(direction.x, direction.y);
  return controls
    .slice(1)
    .every((p, i) => same(p, controls[i]) || dot(sub(p, controls[i]), direction) > projectionGuard);
}
function flattenCubic(controls, tolerance, floatGuard, budget, leaves, depth = 0) {
  check(
    ++budget.nodes <= budget.limits.subdivisionNodes,
    'OFFSET_LIMIT',
    'Offset cubic subdivision work limit exceeded',
  );
  const [a, b, c, d] = controls;
  const error = Math.max(pointDistance(b, a, d), pointDistance(c, a, d));
  if (error <= tolerance && leafMonotone(controls, floatGuard)) {
    check(
      ++budget.vertices <= budget.limits.flattenedVertices,
      'OFFSET_LIMIT',
      `Offset flattened input exceeds ${budget.limits.flattenedVertices} vertices`,
    );
    budget.maxError = Math.max(budget.maxError, error);
    leaves.push({ controls, error });
    return;
  }
  check(
    depth < OFFSET_LIMITS.subdivisionDepth,
    'OFFSET_LIMIT',
    'Offset cubic subdivision depth exceeds 24',
  );
  const ab = midpoint(a, b),
    bc = midpoint(b, c),
    cd = midpoint(c, d);
  const abc = midpoint(ab, bc),
    bcd = midpoint(bc, cd),
    m = midpoint(abc, bcd);
  flattenCubic([a, ab, abc, m], tolerance, floatGuard, budget, leaves, depth + 1);
  flattenCubic([m, bcd, cd, d], tolerance, floatGuard, budget, leaves, depth + 1);
}

// Adjacent Bezier leaves must admit a separating line through the common end.
// This is conservative: uncertain near-cusps are rejected rather than silently
// accepting an intersection hidden by flattening. Bernstein convexity supplies
// the separation certificate. Exact common endpoint controls may be ignored.
function certifyAdjacent(first, second, floatGuard) {
  const p = first.controls[3];
  const incoming = sub(p, first.controls[0]),
    outgoing = sub(second.controls[3], p);
  const il = Math.hypot(incoming.x, incoming.y),
    ol = Math.hypot(outgoing.x, outgoing.y);
  const axis = { x: incoming.x / il + outgoing.x / ol, y: incoming.y / il + outgoing.y / ol };
  const length = Math.hypot(axis.x, axis.y);
  check(length > 1e-10, 'OFFSET_GEOMETRY', 'Offset rejects reversing or touching adjacent edges');
  axis.x /= length;
  axis.y /= length;
  const previous = first.controls.slice(0, 3).filter((q) => !same(q, p));
  const next = second.controls.slice(1).filter((q) => !same(q, p));
  check(
    previous.every((q) => dot(sub(q, p), axis) < -floatGuard) &&
      next.every((q) => dot(sub(q, p), axis) > floatGuard),
    'OFFSET_UNCERTAIN_TOPOLOGY',
    'Adjacent cubic branches cannot be certified disjoint; refine or simplify the source',
  );
}
function edgeBox(a, b, radius) {
  return {
    left: Math.min(a.x, b.x) - radius,
    right: Math.max(a.x, b.x) + radius,
    top: Math.min(a.y, b.y) - radius,
    bottom: Math.max(a.y, b.y) + radius,
  };
}
function boxesOverlap(a, b) {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}
function validateRings(rings, budget, input) {
  const edges = [];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r],
      n = ring.points.length;
    check(n >= 3, 'OFFSET_GEOMETRY', 'Offset needs at least three distinct vertices');
    ring.area = twiceArea(ring.points);
    check(ring.area !== 0n, 'OFFSET_GEOMETRY', 'Offset contour has zero signed area');
    for (let i = 0; i < n; i++) {
      const a = ring.points[i],
        b = ring.points[(i + 1) % n],
        c = ring.points[(i + 2) % n];
      check(!same(a, b), 'OFFSET_PRECISION', 'An edge collapsed at the 0.0001-unit grid');
      check(
        orientation(a, b, c) !== 0 || dot(sub(b, a), sub(c, b)) > 0,
        'OFFSET_GEOMETRY',
        'Offset rejects reversing or overlapping adjacent edges',
      );
      const radius = input ? ring.leaves[i].error * OFFSET_LIMITS.scale + ring.gridGuard : 0;
      edges.push({ r, i, n, a, b, radius, box: edgeBox(a, b, radius) });
    }
  }
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      countPair(budget);
      const b = edges[j];
      if (a.r === b.r && ((a.i + 1) % a.n === b.i || (b.i + 1) % a.n === a.i)) continue;
      if (!boxesOverlap(a.box, b.box)) continue;
      check(
        !intersects(a.a, a.b, b.a, b.b),
        'OFFSET_GEOMETRY',
        'Offset boundaries may not cross or touch',
      );
      if (input && a.radius + b.radius > 0) {
        check(
          segmentDistance(a.a, a.b, b.a, b.b) > a.radius + b.radius + 1e-5,
          'OFFSET_UNCERTAIN_TOPOLOGY',
          'Boundaries are too close to certify at the selected flattening tolerance',
        );
      }
    }
  }
}
function normalizeNonzero(rings) {
  const absolute = (n) => (n < 0n ? -n : n);
  const ordered = [...rings].sort((a, b) =>
    absolute(a.area) > absolute(b.area) ? -1 : absolute(a.area) < absolute(b.area) ? 1 : 0,
  );
  const active = [];
  for (let i = 0; i < ordered.length; i++) {
    const ring = ordered[i];
    let parent = null;
    for (let j = 0; j < i; j++) {
      const candidate = ordered[j];
      if (
        (!parent || absolute(candidate.area) < absolute(parent.area)) &&
        contains(ring.points[0], candidate.points)
      )
        parent = candidate;
    }
    const outside = parent?.winding ?? 0;
    ring.winding = outside + sign(ring.area);
    if ((outside === 0) === (ring.winding === 0)) continue;
    const wantedSign = outside === 0 ? 1 : -1;
    active.push(sign(ring.area) === wantedSign ? ring.points : [...ring.points].reverse());
  }
  return active;
}
function canonicalOutputTopology(rings) {
  const absolute = (n) => (n < 0n ? -n : n);
  const order = rings
    .map((_, i) => i)
    .sort((a, b) =>
      absolute(rings[a].area) > absolute(rings[b].area)
        ? -1
        : absolute(rings[a].area) < absolute(rings[b].area)
          ? 1
          : 0,
    );
  const topology = new Array(rings.length);
  for (let i = 0; i < order.length; i++) {
    const index = order[i],
      ring = rings[index];
    let parent = -1;
    for (let j = 0; j < i; j++) {
      const candidate = order[j];
      if (
        (parent < 0 || absolute(rings[candidate].area) < absolute(rings[parent].area)) &&
        contains(ring.points[0], rings[candidate].points)
      )
        parent = candidate;
    }
    const expectedSign = parent < 0 ? 1 : -topology[parent].sign;
    check(
      sign(ring.area) === expectedSign,
      'OFFSET_GEOMETRY',
      'Offset kernel produced an orphan hole or inconsistent boundary winding',
    );
    topology[index] = { parent, sign: sign(ring.area) };
  }
  return topology;
}
function parameters(amount, options) {
  check(Number.isFinite(amount), 'OFFSET_AMOUNT', 'Offset amount must be finite');
  check(
    options && typeof options === 'object' && !Array.isArray(options),
    'OFFSET_OPTIONS',
    'Offset options must be an object',
  );
  const {
    join = 'miter',
    miterLimit = 4,
    flattenTolerance = 0.1,
    arcTolerance = 0.1,
    fillRule = 'nonzero',
    prefix = 'offset',
  } = options;
  check(
    ['miter', 'bevel', 'round'].includes(join),
    'OFFSET_OPTIONS',
    'Offset join must be miter, bevel or round',
  );
  check(
    Number.isFinite(miterLimit) && miterLimit >= 1 && miterLimit <= 100,
    'OFFSET_OPTIONS',
    'Offset miter limit must be between 1 and 100',
  );
  check(
    fillRule === 'nonzero',
    'OFFSET_UNSUPPORTED',
    'Offset currently supports only nonzero winding',
  );
  check(
    Number.isFinite(flattenTolerance) &&
      flattenTolerance >= 0.001 &&
      flattenTolerance <= 1 &&
      Number.isFinite(arcTolerance) &&
      arcTolerance >= 0.001 &&
      arcTolerance <= 1,
    'OFFSET_OPTIONS',
    'Offset tolerances must be between 0.001 and 1 document units',
  );
  check(
    typeof prefix === 'string' && prefix.length > 0 && prefix.length <= 256,
    'OFFSET_OPTIONS',
    'Offset output prefix must be a nonempty string of at most 256 characters',
  );
  return { join, miterLimit, flattenTolerance, arcTolerance, prefix };
}

/** Pure Nect-SVG Path -> Path operation. Zero is an exact identity, even on open
 * paths; nonzero requires one ungrouped valid nonzero-winding region collection.
 * All controls are Paper-style relative handleA/handleB vectors. Output has
 * straight derived segments, never reuses source point identity, and may be empty.
 */
export function offsetClosedPath(path, amount, options = {}, workLimits = {}) {
  return offsetClosedPathDetailed(path, amount, options, workLimits).path;
}
export function offsetClosedPathDetailed(path, amount, options = {}, workLimits = {}) {
  check(Number.isFinite(amount), 'OFFSET_AMOUNT', 'Offset amount must be finite');
  if (amount === 0) return { path, diagnostics: { exactPassthrough: true } };
  const opts = parameters(amount, options),
    limits = restrictedLimits(workLimits),
    budget = newBudget(limits);
  check(
    path && Array.isArray(path.contours) && path.kind === undefined,
    'OFFSET_GEOMETRY',
    'Offset requires a Nect-SVG Path',
  );
  check(
    path.contours.length <= limits.contours,
    'OFFSET_LIMIT',
    `Offset compound exceeds ${limits.contours} contours`,
  );
  check(
    Array.from(path.contours).every((c) => c && typeof c === 'object'),
    'OFFSET_GEOMETRY',
    'Offset contours must be a dense array of contour objects',
  );
  check(
    path.contours.every((c) => c.group === undefined),
    'OFFSET_UNSUPPORTED',
    'Grouped geometry must be resolved into separate region instances before Offset',
  );
  if (path.contours.length === 0)
    return { path: { contours: [] }, diagnostics: { emptyInput: true } };
  let sourceCount = 0,
    origin = null,
    maxLocal = 0;
  const prepared = path.contours.map((contour) => {
    check(
      contour.closed === true,
      'OFFSET_OPEN_PATH',
      'Offset requires explicitly closed contours',
    );
    check(
      Array.isArray(contour.points) && contour.points.length >= 2,
      'OFFSET_GEOMETRY',
      'Offset requires nondegenerate contours',
    );
    sourceCount += contour.points.length;
    check(
      sourceCount <= limits.sourcePoints,
      'OFFSET_LIMIT',
      `Offset source exceeds ${limits.sourcePoints} points`,
    );
    return Array.from(contour.points, (p) => {
      check(p && typeof p === 'object', 'OFFSET_GEOMETRY', 'Offset point is invalid');
      const anchor = vector(p.position, 'Point position'),
        incoming = vector(p.handleA, 'Incoming handle'),
        outgoing = vector(p.handleB, 'Outgoing handle');
      if (!origin) origin = anchor;
      const local = sub(anchor, origin);
      const control = (handle) => {
        const result = { x: local.x + handle.x, y: local.y + handle.y };
        check(
          (handle.x === 0 || result.x !== local.x) && (handle.y === 0 || result.y !== local.y),
          'OFFSET_PRECISION',
          'A nonzero authored handle component was lost while forming cubic controls',
        );
        return result;
      };
      const values = [local, control(incoming), control(outgoing)];
      for (const point of values) maxLocal = Math.max(maxLocal, magnitude(point));
      return values;
    });
  });
  const reach = Math.abs(amount) * (opts.join === 'miter' ? opts.miterLimit : 1);
  check(
    (maxLocal + reach + 1) * limits.scale < limits.integerMagnitude,
    'OFFSET_RANGE',
    'Offset local geometry and join reach exceed the safe integer envelope',
  );
  check(
    Math.abs(amount) * limits.scale >= 1,
    'OFFSET_PRECISION',
    'Nonzero Offset amount must be at least 0.0001 document units',
  );
  // Includes local subtraction, handle addition and bounded de Casteljau work.
  // This floating-point guard is separate from the geometric flatness bound.
  const floatGuard = 256 * Number.EPSILON * Math.max(1, maxLocal, magnitude(origin));
  check(
    floatGuard < opts.flattenTolerance / 4,
    'OFFSET_PRECISION',
    'World coordinates are too large for the requested flattening tolerance',
  );
  const gridGuard = Math.SQRT1_2 + floatGuard * limits.scale;
  const rings = prepared.map((points) => {
    const leaves = [];
    for (let i = 0; i < points.length; i++) {
      const current = points[i],
        next = points[(i + 1) % points.length];
      check(
        !same(current[0], next[0]) || !same(current[2], current[0]) || !same(next[1], next[0]),
        'OFFSET_GEOMETRY',
        'Offset rejects zero-length source edges',
      );
      flattenCubic(
        [current[0], current[2], next[1], next[0]],
        opts.flattenTolerance - floatGuard,
        floatGuard,
        budget,
        leaves,
      );
    }
    for (let i = 0; i < leaves.length; i++)
      certifyAdjacent(leaves[i], leaves[(i + 1) % leaves.length], floatGuard);
    return {
      leaves,
      gridGuard,
      points: leaves.map(({ controls: [a] }) => ({
        x: Math.round(a.x * limits.scale),
        y: Math.round(a.y * limits.scale),
      })),
    };
  });
  validateRings(rings, budget, true);
  const active = normalizeNonzero(rings);
  // Keep an explicit <= pi/2 arc step even for tiny offsets, avoiding NaN in
  // Clipper's acos when a user tolerance exceeds the radius.
  const arcTolerance = Math.min(opts.arcTolerance, Math.abs(amount) / 4);
  const circleSteps =
    opts.join === 'round'
      ? Math.ceil(Math.PI / Math.acos(1 - arcTolerance / Math.abs(amount))) + 2
      : 3;
  const estimate = budget.vertices * circleSteps;
  check(
    Number.isFinite(estimate) && estimate <= limits.estimatedJoinVertices,
    'OFFSET_LIMIT',
    `Offset estimated join work exceeds ${limits.estimatedJoinVertices} vertices`,
  );
  const engine = new NectClipperOffset(opts.miterLimit, arcTolerance * limits.scale);
  engine.addPaths(
    active,
    { miter: JoinType.Miter, bevel: JoinType.Bevel, round: JoinType.Round }[opts.join],
    EndType.Polygon,
  );
  const solution = [];
  try {
    engine.execute(amount * limits.scale, solution);
  } catch {
    fail('OFFSET_KERNEL', 'The pinned offset kernel could not produce a result');
  }
  check(
    amount < 0 || active.length === 0 || solution.length > 0,
    'OFFSET_GEOMETRY',
    'Positive Offset unexpectedly produced an empty region',
  );
  let outputCount = 0;
  for (const ring of solution) {
    outputCount += ring.length;
    check(
      outputCount <= limits.outputVertices,
      'OFFSET_LIMIT',
      `Offset output exceeds ${limits.outputVertices} vertices`,
    );
    for (const p of ring)
      check(
        Number.isSafeInteger(p.x) &&
          Number.isSafeInteger(p.y) &&
          magnitude(p) < limits.integerMagnitude,
        'OFFSET_RANGE',
        'Offset output is outside the safe integer envelope',
      );
  }
  const outputRings = solution.map((points) => ({ points }));
  validateRings(outputRings, budget, false);
  const integerTopology = canonicalOutputTopology(outputRings);
  const contours = solution.map((ring, ci) => ({
    id: `${opts.prefix}:c${ci}`,
    closed: true,
    points: ring.map((p, pi) => {
      const position = [p.x / limits.scale + origin.x, p.y / limits.scale + origin.y];
      vector(position, 'Offset output');
      return { id: `${opts.prefix}:c${ci}:p${pi}`, position, handleA: [0, 0], handleB: [0, 0] };
    }),
  }));
  try {
    const restored = exactWorldRings(contours);
    validateRings(restored, budget, false);
    check(
      JSON.stringify(canonicalOutputTopology(restored)) === JSON.stringify(integerTopology),
      'OFFSET_PRECISION',
      'World-coordinate restoration changed output nesting or winding',
    );
  } catch (error) {
    if (error instanceof OffsetError && error.code === 'OFFSET_LIMIT') throw error;
    fail('OFFSET_PRECISION', 'World-coordinate restoration cannot preserve a valid output region');
  }
  return {
    path: { contours },
    diagnostics: {
      exactPassthrough: false,
      inputContours: rings.length,
      activeBoundaries: active.length,
      flattenedVertices: budget.vertices,
      outputVertices: outputCount,
      subdivisionNodes: budget.nodes,
      topologyPairChecks: budget.pairs,
      estimatedJoinVertices: estimate,
      gridSize: 1 / limits.scale,
      cubicFlatteningMaxError: budget.maxError + floatGuard,
      inputQuantizationMaxError: Math.SQRT1_2 / limits.scale,
      arcSagittaMaxError: opts.join === 'round' ? arcTolerance : 0,
      offsetConstructionRoundingMaxError: Math.SQRT1_2 / limits.scale,
      // Cleanup intersects already-rounded construction edges. Acute intersections
      // can amplify rounding; this is not a bound on the final offset boundary.
      finalOffsetErrorBound: null,
      floatingPointGuard: floatGuard,
      kernel: 'clipper2-ts@2.0.1-18 + Nect true-bevel adapter',
    },
  };
}
