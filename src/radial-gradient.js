// A two-stop fill in absolute artboard coordinates. Geometry and ID allocation
// belong to the caller; this module has no DOM, graph or rendering dependencies.
const inputKeys = ['center', 'radius', 'startColor', 'endColor'];
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
    throw Error(`Expected Vector2 for radial gradient ${name}`);
  const x = value[0],
    y = value[1];
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000)
    throw Error(`Expected Vector2 for radial gradient ${name}`);
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

export function createRadialGradientFill(options) {
  if (!hasExactKeys(options, inputKeys)) throw Error('Invalid radial gradient inputs');
  const center = copyVector(options.center, 'center'),
    radius = options.radius,
    startColor = copyColor(options.startColor),
    endColor = copyColor(options.endColor);
  if (!Number.isFinite(radius) || radius < 0.0001 || radius > 100000)
    throw Error('Radial gradient radius must be finite and from 0.0001 to 100000 px');
  return { kind: 'radial-gradient', center, radius, startColor, endColor };
}

function copyFill(fill) {
  if (!hasExactKeys(fill, fillKeys) || fill.kind !== 'radial-gradient')
    throw Error('Invalid radial gradient fill');
  return createRadialGradientFill({
    center: fill.center,
    radius: fill.radius,
    startColor: fill.startColor,
    endColor: fill.endColor,
  });
}

// Throws for invalid data without normalizing or changing the supplied fill.
export function validateRadialGradientFill(fill) {
  copyFill(fill);
}

export function renderRadialGradientFill(fill, id) {
  const { center, radius, startColor, endColor } = copyFill(fill);
  // Restrict IDs to a bounded ASCII subset safe in both XML and a local URL.
  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 128 ||
    !/^[A-Za-z_]/.test(id) ||
    /[^A-Za-z0-9_.-]/.test(id)
  )
    throw Error('Invalid radial gradient ID');
  return {
    definition:
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${center[0]}" cy="${center[1]}" r="${radius}" ` +
      `fx="${center[0]}" fy="${center[1]}" fr="0" ` +
      'spreadMethod="pad" color-interpolation="sRGB">' +
      `<stop offset="0" stop-color="${startColor.hex}" stop-opacity="${startColor.alpha}"/>` +
      `<stop offset="1" stop-color="${endColor.hex}" stop-opacity="${endColor.alpha}"/>` +
      '</radialGradient>',
    paint: `url(#${id})`,
  };
}
