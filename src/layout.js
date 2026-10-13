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
