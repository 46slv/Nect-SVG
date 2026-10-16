import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, unionBounds, anchoredPan, anchoredScroll, wheelPixels } from '../src/layout.js';
test('fit uses measured content, padding and finite limits rather than the graph floor', () => {
  const bounds = unionBounds([
    { x: 40, y: 10, width: 300, height: 1600 },
    { x: 750, y: 40, width: 220, height: 100 },
  ]);
  assert.deepEqual(bounds, { x: 40, y: 10, width: 930, height: 1600 });
  assert.deepEqual(fitScale(bounds, [1000, 400]), { scale: 336 / 1600, limited: false });
  assert.deepEqual(fitScale({ width: 100000, height: 1 }, [1000, 400]), {
    scale: 0.05,
    limited: true,
  });
  assert.equal(fitScale({ width: 1, height: 1 }, [1000, 400]).scale, 2);
  assert.equal(unionBounds([]), null);
});
test('zoom anchors preserve CSS pixel location across pan, scroll and independent ratios', () => {
  assert.deepEqual(anchoredPan([30, -10], [140, -80], 2), [-110, 70]);
  assert.deepEqual(anchoredScroll([400, 250], [100, 80], 0.5), [150, 85]);
  assert.deepEqual(anchoredPan([30, -10], [-30, 10], 2), [60, -20]);
});
test('wheel pixels normalize line and page delta modes and Shift vertical into horizontal', () => {
  const event = { deltaX: 2, deltaY: 3, deltaMode: 0 };
  assert.deepEqual(wheelPixels(event, [100, 200]), [2, 3]);
  assert.deepEqual(wheelPixels({ ...event, deltaMode: 1 }, [100, 200]), [32, 48]);
  assert.deepEqual(wheelPixels({ ...event, deltaMode: 2 }, [100, 200]), [200, 600]);
  assert.deepEqual(wheelPixels({ ...event, deltaX: 0, shiftKey: true }, [100, 200]), [3, 0]);
  assert.deepEqual(wheelPixels({ ...event, shiftKey: true }, [100, 200]), [2, 3]);
});
