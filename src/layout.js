export function intersects(a, b, gap = 24) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
export function findFreeNodePosition(nodes, measurements = {}, size = { width: 264, height: 420 }) {
  const boxes = nodes.map((n) => ({
    x: n.position[0],
    y: n.position[1],
    width: measurements[n.id]?.width || n.width || 264,
    height: measurements[n.id]?.height || 260,
  }));
  for (let row = 0; row < 200; row++)
    for (let column = 0; column < 8; column++) {
      const candidate = { x: 40 + column * 312, y: 40 + row * 312, ...size };
      if (boxes.every((box) => !intersects(candidate, box))) return [candidate.x, candidate.y];
    }
  return [40, Math.max(0, ...boxes.map((b) => b.y + b.height)) + 40];
}

// View geometry is in CSS pixels. None of these helpers mutate document coordinates.
export function fitScale(bounds, viewport, padding = 32, limits = [0.05, 2]) {
  const available = viewport.map((size) => Math.max(1, size - padding * 2));
  const ideal = Math.min(
    available[0] / Math.max(1, bounds.width),
    available[1] / Math.max(1, bounds.height),
  );
  return { scale: Math.max(limits[0], Math.min(limits[1], ideal)), limited: ideal < limits[0] };
}
export function unionBounds(boxes) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
export function anchoredPan(pan, anchorFromCenter, ratio) {
  return pan.map((value, axis) => value + anchorFromCenter[axis] * (1 - ratio));
}
export function anchoredScroll(scroll, anchor, ratio) {
  return scroll.map((value, axis) => (value + anchor[axis]) * ratio - anchor[axis]);
}
export function wheelPixels(event, viewport) {
  const unit = event.deltaMode === 1 ? [16, 16] : event.deltaMode === 2 ? viewport : [1, 1];
  const delta = [event.deltaX * unit[0], event.deltaY * unit[1]];
  return event.shiftKey && !delta[0] ? [delta[1], 0] : delta;
}
