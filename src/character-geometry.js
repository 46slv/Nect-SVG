// Runtime-only display provenance. No paint/contour groups or persistent character IDs.
export const identityMatrix = () => [1, 0, 0, 1, 0, 0];
export function multiplyMatrices(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function characterTransform(anchor, offset, scale, rotation) {
  const angle = rotation * (Math.PI / 180),
    a = scale * Math.cos(angle),
    b = scale * Math.sin(angle),
    c = -b,
    d = a;
  return [
    a,
    b,
    c,
    d,
    offset[0] + anchor[0] - a * anchor[0] - c * anchor[1],
    offset[1] + anchor[1] - b * anchor[0] - d * anchor[1],
  ];
}
export function transformCharacterPoint(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
function inverseCharacterLinear(m, delta, bounded) {
  const det = m[0] * m[3] - m[1] * m[2],
    norm = Math.max(...m.slice(0, 4).map(Math.abs));
  if (
    !m.every(Number.isFinite) ||
    norm < 1e-6 ||
    !Number.isFinite(det) ||
    Math.abs(det) < 1e-12 * Math.max(1, norm * norm)
  )
    throw Error('Character dragging is unavailable for a singular or near-zero Transform');
  const result = [
    (m[3] * delta[0] - m[2] * delta[1]) / det,
    (-m[1] * delta[0] + m[0] * delta[1]) / det,
  ];
  if (!result.every((v) => Number.isFinite(v) && (!bounded || Math.abs(v) <= 100000)))
    throw Error('Character movement exceeds ±100000 px');
  return result.map((v) => Number(v.toFixed(10)));
}
export function inverseCharacterDelta(matrix, delta) {
  return inverseCharacterLinear(matrix, delta, true);
}
export function characterOccurrences(path) {
  return path?.characterOccurrences || [];
}
export function routeCharacters(path, edge, matrix, reason) {
  return characterOccurrences(path).map((occurrence) => ({
    ...occurrence,
    route: `${occurrence.route}/${edge}`,
    matrix: matrix ? multiplyMatrices(matrix, occurrence.matrix) : occurrence.matrix,
    reason: occurrence.reason || reason || null,
  }));
}
export function characterBoxPoints(glyph, matrix) {
  const [x1, y1, x2, y2] = glyph.bounds;
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ].map((p) => transformCharacterPoint(matrix, p));
}
export function hitCharacter(glyph, matrix, point) {
  try {
    const local = inverseCharacterLinear(
        matrix,
        [point[0] - matrix[4], point[1] - matrix[5]],
        false,
      ),
      [x1, y1, x2, y2] = glyph.bounds;
    return local[0] >= x1 && local[0] <= x2 && local[1] >= y1 && local[1] <= y2;
  } catch {
    return false;
  }
}
