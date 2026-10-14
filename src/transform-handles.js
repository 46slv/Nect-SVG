import { characterTransform, transformCharacterPoint } from './character-geometry.js';

// Editor-only controls in the selected Transform's output space. This is not an
// inverse of an arbitrary downstream graph; it uses the same affine as Text.
export function transformHandleGeometry(state, bounds, screenScale = 1) {
  const { anchor, offset, scale, rotation } = state;
  if (
    ![...anchor, ...offset, scale, rotation, screenScale, ...bounds.flat()].every(
      Number.isFinite,
    ) ||
    screenScale <= 0
  )
    throw Error('Transform handles need finite coordinates');
  const pivot = anchor.map((v, i) => v + offset[i]);
  const corners = [
    [bounds[0][2], bounds[1][2]],
    [bounds[0][0], bounds[1][2]],
    [bounds[0][2], bounds[1][0]],
    [bounds[0][0], bounds[1][0]],
  ];
  corners.sort(
    (a, b) =>
      Math.hypot(...b.map((v, i) => v - anchor[i])) - Math.hypot(...a.map((v, i) => v - anchor[i])),
  );
  let vector = corners[0].map((v, i) => v - anchor[i]);
  let radius = Math.hypot(...vector);
  if (radius < 1e-6) {
    vector = [100, 0];
    radius = 100;
  }
  const sign = scale < 0 ? -1 : 1;
  const axis = transformCharacterPoint(
    characterTransform([0, 0], [0, 0], sign / radius, rotation),
    vector,
  );
  const distance = Math.max(40 / screenScale, radius * Math.abs(scale));
  const point = (d) => pivot.map((v, i) => v + axis[i] * d);
  const geometry = {
    pivot,
    axis,
    radius,
    sign,
    scale: point(distance),
    rotation: point(distance + 30 / screenScale),
  };
  if (![...pivot, ...axis, ...geometry.scale, ...geometry.rotation].every(Number.isFinite))
    throw Error('Transform handles exceed finite coordinates');
  return geometry;
}
export function scaleFromHandle(original, geometry, delta) {
  const change =
    (geometry.sign * (delta[0] * geometry.axis[0] + delta[1] * geometry.axis[1])) / geometry.radius;
  if (!Number.isFinite(change)) return original;
  // Returning to the press position preserves the exact original float.
  return Math.abs(change) < 1e-12 ? original : original + change;
}
export function rotationHandleAngle(pivot, point, minRadius = 0) {
  const delta = point.map((v, i) => v - pivot[i]);
  return Math.hypot(...delta) <= minRadius
    ? null
    : (Math.atan2(delta[1], delta[0]) * 180) / Math.PI;
}
export function rotationHandleDelta(previous, next) {
  return ((next - previous + 540) % 360) - 180;
}
export function rotationFromHandle(original, delta, snap = false) {
  if (Math.abs(delta) < 1e-10) return original;
  const value = original + delta;
  return snap ? Math.round(value / 15) * 15 : value;
}
