import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainAxisDrag } from '../src/axis-drag.js';

test('Shift waits for three screen pixels, chooses an artboard axis and freezes it', () => {
  const state = {};
  assert.deepEqual(constrainAxisDrag(state, [20, 10], [2, 1], true), {
    delta: [0, 0],
    axis: null,
    pending: true,
  });
  assert.deepEqual(constrainAxisDrag(state, [30, 10], [3, 1], true).delta, [30, 0]);
  assert.deepEqual(constrainAxisDrag(state, [5, 90], [0.5, 9], true).delta, [5, 0]);
  assert.deepEqual(constrainAxisDrag(state, [-40, 99], [-4, 9.9], true).delta, [-40, 0]);
  assert.deepEqual(constrainAxisDrag(state, [0, 0], [0, 0], true).delta, [0, 0]);
});

test('release and repress use total unsnapped origin-relative movement without accumulated drift', () => {
  const state = {};
  constrainAxisDrag(state, [40, 10], [40, 10], true);
  assert.deepEqual(constrainAxisDrag(state, [12, 70], [12, 70], false).delta, [12, 70]);
  assert.deepEqual(constrainAxisDrag(state, [12, 70], [12, 70], true).delta, [0, 70]);
  assert.deepEqual(constrainAxisDrag(state, [90, 5], [90, 5], true).delta, [0, 5]);
});

test('zoom and rotated screen matrices only affect activation, never artboard axis choice', () => {
  for (const scale of [0.125, 1, 8]) {
    const state = {};
    assert.equal(constrainAxisDrag(state, [40, 60], [60 * scale, -40 * scale], true).axis, 1);
  }
  assert.equal(constrainAxisDrag({}, [-3, 3], [-3, 3], true).axis, 0);
});

test('unmodified movement is exact, copied and free even below threshold', () => {
  const input = [0.123456789, -0.987654321],
    state = { axis: 1 };
  const result = constrainAxisDrag(state, input, input, false);
  assert.deepEqual(result.delta, input);
  assert.notEqual(result.delta, input);
  assert.equal(state.axis, null);
});
