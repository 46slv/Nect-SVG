// Generator-local dimension controls. These never invert downstream transforms.
export function objectResizeHandles(type, values, screenScale = 1) {
  const center = values[type === 'Text' ? 'position' : 'center'];
  if (!center || !Number.isFinite(screenScale) || screenScale <= 0) return [];
  const padding = 40 / screenScale;
  const handle = (key, axis, value, label, factor = 1, min = 0, max = 100000) => ({
    key,
    axis,
    label,
    factor,
    min,
    max,
    point: center.map((v, i) => v + (i === axis ? Math.max(padding, Math.abs(value) / factor) : 0)),
  });
  if (type === 'Rectangle' || type === 'Ellipse') {
    const reference = (values.positionReference || 'origin').split('-');
    return values.size.map((v, axis) => {
      const edge = reference[axis],
        reverse = ['right', 'bottom'].includes(edge),
        factor = ['left', 'right', 'top', 'bottom'].includes(edge) ? 1 : 2,
        h = handle('size', axis, v, axis ? 'Height' : 'Width', factor);
      h.direction = reverse ? -1 : 1;
      h.point[axis] = center[axis] + h.direction * Math.max(padding, Math.abs(v) / factor);
      return h;
    });
  }
  if (type === 'Text') return [handle('size', 0, values.size, 'Font size', 1, 0.01)];
  if (type === 'Circle' || type === 'Polygon')
    return [
      handle('radius', 0, Math.max(0, values.radius), 'Radius', 1, type === 'Circle' ? 0 : 0.01),
    ];
  if (type === 'Star')
    return [
      handle(
        'outerRadius',
        0,
        values.outerRadius,
        'Outer radius',
        1,
        Math.max(values.innerRadius, values.fallbackInnerRadius ?? 0),
      ),
      handle(
        'innerRadius',
        1,
        values.innerRadius,
        'Inner radius',
        1,
        Math.min(0.01, values.outerRadius, values.fallbackOuterRadius ?? 100000),
        Math.min(values.outerRadius, values.fallbackOuterRadius ?? 100000),
      ),
    ];
  return [];
}
export function resizedObjectValue(original, handle, delta) {
  const vector = Array.isArray(original),
    old = vector ? original[handle.axis] : original;
  const distance = delta[handle.axis] * handle.factor * (handle.direction || 1);
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-10) return structuredClone(original);
  // Preserve legacy signed dimensions while editing their displayed magnitude.
  const value =
    (vector && old < 0 ? -1 : 1) *
    Math.max(
      handle.min,
      Math.min(handle.max, (vector ? Math.abs(old) : Math.max(0, old)) + distance),
    );
  return vector ? original.map((v, i) => (i === handle.axis ? value : v)) : value;
}
