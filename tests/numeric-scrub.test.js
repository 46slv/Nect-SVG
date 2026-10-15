import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubNumericValues } from '../src/numeric-scrub.js';

test('numeric scrub uses screen pixels, activation dead zone and explicit units', () => {
  assert.deepEqual(scrubNumericValues([14.2195], 14, 1, -100000, 100000), [24.2195]);
  assert.deepEqual(scrubNumericValues([0], -14, 1, -36000, 36000), [-10]);
  assert.deepEqual(scrubNumericValues([1], 24, 0.01, 0.01, 100), [1.2]);
  assert.deepEqual(scrubNumericValues([80, 120], 14, 1, 1, 1000), [90, 130]);
  for (const dx of [-4.9, -3, 0, 3, 4.9]) {
    const original = [0.12345678901234567, 1.2345678901234567];
    assert.deepEqual(scrubNumericValues(original, dx, 1, -100000, 100000), original);
  }
});

test('mixed scrubs clamp one common delta and retain exact no-op values', () => {
  assert.deepEqual(scrubNumericValues([1, 99.9], 1000, 0.01, 0.01, 100), [1.1, 100]);
  assert.deepEqual(scrubNumericValues([0.1, 1.5], -1000, 0.01, 0.01, 100), [0.01, 1.41]);
  assert.deepEqual(scrubNumericValues([2, 100], 50, 0.01, 0.01, 100), [2, 100]);
  const original = [0.12345678901234567, 100];
  assert.deepEqual(scrubNumericValues(original, 50, 0.01, 0.01, 100), original);
  assert.deepEqual(scrubNumericValues([0], 1e308, 1, -100000, 100000), [100000]);
});

test('non-finite values and invalid numeric scrub contracts are rejected', () => {
  for (const args of [
    [[], 10, 1, 0, 100],
    [[NaN], 10, 1, 0, 100],
    [[1], Infinity, 1, 0, 100],
    [[1], 10, 0, 0, 100],
    [[1], 10, -1, 0, 100],
    [[1], 10, 1, 100, 0],
  ])
    assert.throws(() => scrubNumericValues(...args), /Invalid numeric scrub/);
});
