// A two-stop fill in absolute artboard coordinates. Geometry and ID allocation
// belong to the caller; this module has no DOM, graph or rendering dependencies.
const inputKeys = ['start', 'end', 'startColor', 'endColor'];
const fillKeys = ['kind', ...inputKeys];

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function copyVector(value, name) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    Reflect.ownKeys(value).length !== 3 ||
    !Object.hasOwn(value, 0) ||
    !Object.hasOwn(value, 1)
  )
    throw Error(`Expected Vector2 for linear gradient ${name}`);
  const x = value[0],
    y = value[1];
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw Error(`Expected Vector2 for linear gradient ${name}`);
  return [x, y];
}

function copyColor(value) {
  if (!hasExactKeys(value, ['hex', 'alpha']))
    throw Error('Expected Color with hex #RRGGBB and alpha from 0 to 1');
  const { hex, alpha } = value;
  if (
    typeof hex !== 'string' ||
    hex.length !== 7 ||
    !/^#[0-9a-fA-F]{6}$/.test(hex) ||
    !Number.isFinite(alpha) ||
    alpha < 0 ||
    alpha > 1
  )
    throw Error('Expected Color with hex #RRGGBB and alpha from 0 to 1');
  return { hex, alpha };
}

export function createLinearGradientFill(options) {
  if (!hasExactKeys(options, inputKeys)) throw Error('Invalid linear gradient inputs');
  const start = copyVector(options.start, 'start'),
    end = copyVector(options.end, 'end'),
    startColor = copyColor(options.startColor),
    endColor = copyColor(options.endColor),
    dx = end[0] - start[0],
    dy = end[1] - start[1],
    length = Math.hypot(dx, dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(length) || length === 0)
    throw Error('Linear gradient endpoints must have a finite, nonzero distance');
  return { kind: 'linear-gradient', start, end, startColor, endColor };
}

function copyFill(fill) {
  if (!hasExactKeys(fill, fillKeys) || fill.kind !== 'linear-gradient')
    throw Error('Invalid linear gradient fill');
  return createLinearGradientFill({
    start: fill.start,
    end: fill.end,
    startColor: fill.startColor,
    endColor: fill.endColor,
  });
}

// Throws for invalid data without normalizing or changing the supplied fill.
export function validateLinearGradientFill(fill) {
  copyFill(fill);
}

export function renderLinearGradientFill(fill, id) {
  const { start, end, startColor, endColor } = copyFill(fill);
  // Restrict IDs to a bounded ASCII subset safe in both XML and a local URL.
  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 128 ||
    !/^[A-Za-z_]/.test(id) ||
    /[^A-Za-z0-9_.-]/.test(id)
  )
    throw Error('Invalid linear gradient ID');
  return {
    definition:
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" ` +
      'spreadMethod="pad" color-interpolation="sRGB">' +
      `<stop offset="0" stop-color="${startColor.hex}" stop-opacity="${startColor.alpha}"/>` +
      `<stop offset="1" stop-color="${endColor.hex}" stop-opacity="${endColor.alpha}"/>` +
      '</linearGradient>',
    paint: `url(#${id})`,
  };
}
