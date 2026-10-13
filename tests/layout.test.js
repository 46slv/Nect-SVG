import test from 'node:test';
import assert from 'node:assert/strict';
import { findFreeNodePosition, intersects } from '../src/layout.js';
test('new nodes avoid occupied cards, including expanded tall Curves', () => {
  let nodes = [
      { id: 'a', position: [40, 40], width: 264 },
      { id: 'b', position: [352, 40], width: 264 },
    ],
    measurements = { a: { width: 264, height: 1400 }, b: { width: 264, height: 250 } };
  const [x, y] = findFreeNodePosition(nodes, measurements, { width: 264, height: 520 });
  for (const n of nodes)
    assert.equal(
      intersects(
        { x, y, width: 264, height: 520 },
        { x: n.position[0], y: n.position[1], ...measurements[n.id] },
      ),
      false,
    );
  assert.ok(y >= 0);
});
