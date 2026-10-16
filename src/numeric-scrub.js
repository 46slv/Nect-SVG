// Screen-pixel scrubbing is independent of artboard/graph zoom and Shift-axis movement.
// A mixed selection receives one bounded delta, preserving differences between values.
export function scrubNumericValues(originals, dx, step, min, max) {
  if (
    !originals.length ||
    !originals.every(Number.isFinite) ||
    ![dx, step, min, max].every(Number.isFinite) ||
    step <= 0 ||
    min > max
  )
    throw Error('Invalid numeric scrub');
  const distance = Math.sign(dx) * Math.max(0, Math.abs(dx) - 4);
  if (!Math.trunc(distance)) return [...originals];
  const requested = Math.trunc(distance) * step,
    bounded = Math.max(
      min - Math.min(...originals),
      Math.min(max - Math.max(...originals), requested),
    );
  if (!bounded) return [...originals];
  // Remove subtraction noise at shared decimal bounds (100 - 99.9, for example).
  const precision = bounded === requested ? 15 : 12,
    delta = Number(bounded.toPrecision(precision));
  return originals.map((value) =>
    Math.max(min, Math.min(max, Number((value + delta).toPrecision(precision)))),
  );
}
