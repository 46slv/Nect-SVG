import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRadialGradientFill,
  validateRadialGradientFill,
  renderRadialGradientFill,
} from '../src/radial-gradient.js';

const inputs = () => ({
  center: [10, 20],
  radius: 100,
  startColor: { hex: '#12abEF', alpha: 1 },
  endColor: { hex: '#345678', alpha: 0.375 },
});
const descriptor = () => ({ kind: 'radial-gradient', ...inputs() });

function rejectsEverywhere(key, value) {
  assert.throws(() => createRadialGradientFill({ ...inputs(), [key]: value }));
  assert.throws(() => validateRadialGradientFill({ ...descriptor(), [key]: value }));
  assert.throws(() => renderRadialGradientFill({ ...descriptor(), [key]: value }, 'g'));
}

test('radial creation preserves absolute centers and positive bounded radii without normalization', () => {
  for (const center of [
    [10, 20],
    [0, 0],
    [-2.5, 3.25],
    [-100000, 100000],
  ])
    for (const radius of [0.0001, 0.125, 100, 100000]) {
      const options = { ...inputs(), center, radius },
        fill = createRadialGradientFill(options);
      assert.deepEqual(fill, { kind: 'radial-gradient', ...options });
      assert.equal(validateRadialGradientFill(fill), undefined);
      const { definition } = renderRadialGradientFill(fill, 'gradient-1');
      for (const [key, value] of Object.entries({
        cx: center[0],
        cy: center[1],
        r: radius,
        fx: center[0],
        fy: center[1],
        fr: 0,
      }))
        assert.ok(definition.includes(`${key}="${value}"`));
    }
});

test('radial creation defensively copies the center and independent colors, including aliased inputs', () => {
  const options = inputs(),
    before = structuredClone(options),
    fill = createRadialGradientFill(options);
  for (const key of ['center', 'startColor', 'endColor']) assert.notEqual(fill[key], options[key]);
  options.center[0] = 90;
  options.radius = 1;
  options.startColor.alpha = 0;
  options.endColor.hex = '#000000';
  assert.deepEqual(fill, { kind: 'radial-gradient', ...before });
  fill.center[1] = -10;
  fill.radius = 50;
  fill.startColor.hex = '#ffffff';
  fill.endColor.alpha = 1;
  assert.deepEqual(options.center, [90, 20]);
  assert.equal(options.radius, 1);
  assert.deepEqual(options.startColor, { hex: '#12abEF', alpha: 0 });
  assert.deepEqual(options.endColor, { hex: '#000000', alpha: 0.375 });
  const color = { hex: '#123456', alpha: 0.5 },
    aliased = createRadialGradientFill({ ...inputs(), startColor: color, endColor: color });
  assert.notEqual(aliased.startColor, aliased.endColor);
  aliased.startColor.alpha = 0;
  assert.equal(aliased.endColor.alpha, 0.5);
  assert.equal(color.alpha, 0.5);
});

test('radial validation and rendering leave frozen inputs untouched and return independent results', () => {
  const fill = descriptor(),
    before = structuredClone(fill);
  for (const key of ['center', 'startColor', 'endColor']) Object.freeze(fill[key]);
  Object.freeze(fill);
  assert.doesNotThrow(() => validateRadialGradientFill(fill));
  const first = renderRadialGradientFill(fill, 'gradient-1'),
    second = renderRadialGradientFill(fill, 'gradient-1');
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.deepEqual(fill, before);
});

test('radial SVG has deterministic explicit concentric geometry and two independently transparent stops', () => {
  const fill = descriptor();
  assert.deepEqual(renderRadialGradientFill(fill, 'gradient-1'), {
    definition:
      '<radialGradient id="gradient-1" gradientUnits="userSpaceOnUse" ' +
      'cx="10" cy="20" r="100" fx="10" fy="20" fr="0" spreadMethod="pad" color-interpolation="sRGB">' +
      '<stop offset="0" stop-color="#12abEF" stop-opacity="1"/>' +
      '<stop offset="1" stop-color="#345678" stop-opacity="0.375"/>' +
      '</radialGradient>',
    paint: 'url(#gradient-1)',
  });
  for (const startAlpha of [0, 1, 0.125])
    for (const endAlpha of [0, 1, 0.625]) {
      const options = inputs();
      options.startColor.alpha = startAlpha;
      options.endColor.alpha = endAlpha;
      const { definition } = renderRadialGradientFill(createRadialGradientFill(options), 'g');
      assert.ok(definition.includes(`stop-color="#12abEF" stop-opacity="${startAlpha}"`));
      assert.ok(definition.includes(`stop-color="#345678" stop-opacity="${endAlpha}"`));
      assert.equal((definition.match(/<stop /g) || []).length, 2);
      assert.doesNotMatch(definition, /<defs|gradientTransform|fill-opacity|href|style=/);
    }
  const before = renderRadialGradientFill(fill, 'gradient-1');
  renderRadialGradientFill(fill, 'unrelated-id');
  assert.deepEqual(renderRadialGradientFill(fill, 'gradient-1'), before);
});

test('radial input and descriptor shapes reject missing, extra and inherited fields', () => {
  for (const bad of [undefined, null, false, 1, 'gradient', [], () => {}]) {
    assert.throws(() => createRadialGradientFill(bad));
    assert.throws(() => validateRadialGradientFill(bad));
    assert.throws(() => renderRadialGradientFill(bad, 'g'));
  }
  for (const key of Object.keys(inputs())) {
    const options = inputs(),
      fill = descriptor();
    delete options[key];
    delete fill[key];
    assert.throws(() => createRadialGradientFill(options));
    assert.throws(() => validateRadialGradientFill(fill));
  }
  for (const extra of ['stops', 'id', 'opacity', 'focal', 'innerRadius', Symbol('extra')]) {
    assert.throws(() => createRadialGradientFill({ ...inputs(), [extra]: 1 }));
    assert.throws(() => validateRadialGradientFill({ ...descriptor(), [extra]: 1 }));
  }
  for (const kind of [undefined, null, 'radialGradient', 'linear-gradient', 1])
    assert.throws(() => validateRadialGradientFill({ ...inputs(), kind }));
  assert.throws(() => validateRadialGradientFill(Object.create(descriptor())));
  assert.throws(() => createRadialGradientFill(Object.create(inputs())));
  assert.throws(() =>
    validateRadialGradientFill(Object.defineProperty(descriptor(), 'extra', { value: 1 })),
  );
});

test('radial center requires a dense two-number vector within the bounded artboard coordinate subset', () => {
  const invalid = [
    null,
    undefined,
    1,
    '0,0',
    {},
    { 0: 0, 1: 0, length: 2 },
    [],
    [0],
    [0, 0, 0],
    new Array(2),
    [0, ,],
    new Float64Array([0, 0]),
    Object.assign([0, 0], { extra: true }),
    Object.assign([0, 0], { [Symbol('extra')]: true }),
  ];
  for (const bad of [
    NaN,
    Infinity,
    -Infinity,
    100000.01,
    -100000.01,
    Number.MAX_VALUE,
    '0',
    null,
    undefined,
    true,
    {},
    0n,
  ])
    invalid.push([bad, 0], [0, bad]);
  for (const bad of invalid) rejectsEverywhere('center', bad);
});

test('radial radius rejects zero, negative, nonfinite, excessive and nonnumeric values', () => {
  for (const bad of [
    0,
    -0,
    -Number.MIN_VALUE,
    Number.MIN_VALUE,
    0.00009999,
    -1,
    100000.01,
    Number.MAX_VALUE,
    NaN,
    Infinity,
    -Infinity,
    '100',
    null,
    undefined,
    true,
    {},
    [],
    [1],
    1n,
  ])
    rejectsEverywhere('radius', bad);
});

test('radial colors require exact hex #RRGGBB and numeric alpha from zero to one', () => {
  const invalid = [
    null,
    undefined,
    '#112233',
    [1, 0, 0, 1],
    {},
    { hex: '#112233' },
    { alpha: 1 },
    { hex: '#112233', alpha: 1, extra: true },
    { hex: '#112233', alpha: 1, [Symbol('extra')]: true },
    Object.create({ hex: '#112233', alpha: 1 }),
    Object.defineProperty({ hex: '#112233', alpha: 1 }, 'extra', { value: 1 }),
  ];
  for (const hex of [
    'red',
    '#123',
    '#12345678',
    '112233',
    '#12GG00',
    '#112233\n',
    '#112233\r',
    '#112233 ',
    ' #112233',
    '<script>',
    'url(#evil)',
    null,
    112233,
  ])
    invalid.push({ hex, alpha: 1 });
  for (const alpha of [
    NaN,
    Infinity,
    -Infinity,
    -0.01,
    1.01,
    '0.5',
    null,
    undefined,
    false,
    {},
    0n,
  ])
    invalid.push({ hex: '#112233', alpha });
  for (const key of ['startColor', 'endColor'])
    for (const bad of invalid) rejectsEverywhere(key, bad);
});

test('radial IDs are explicit bounded ASCII identifiers safe in XML and local paint URLs', () => {
  const fill = descriptor();
  for (const id of ['g', '_', 'gradient-1', '_Gradient.2-3', 'g'.repeat(128)]) {
    const rendered = renderRadialGradientFill(fill, id);
    assert.ok(rendered.definition.startsWith(`<radialGradient id="${id}" `));
    assert.equal(rendered.paint, `url(#${id})`);
  }
  for (const id of [
    undefined,
    null,
    0,
    {},
    ['g'],
    new String('g'),
    '',
    'g'.repeat(129),
    '1gradient',
    '-gradient',
    '.gradient',
    ' gradient',
    'gradient ',
    'g\n',
    'g\r',
    'g\t',
    'g\u0000',
    'g\u2028',
    'グラデーション',
    'g" onload="alert(1)',
    "g'",
    '<g>',
    'g&name;',
    'g:id',
    '#g',
    'https://example.com/g',
    'url(#g)',
    'g) red',
    'g/g',
    'g\\g',
    'g%20',
  ])
    assert.throws(() => renderRadialGradientFill(fill, id));
});

test('radial rendering snapshots accessor-backed geometry and colors once before interpolation', () => {
  const fill = descriptor(),
    reads = { radius: 0, center: 0, hex: 0, alpha: 0 };
  Object.defineProperty(fill, 'radius', {
    enumerable: true,
    get: () => (++reads.radius === 1 ? 100 : Infinity),
  });
  Object.defineProperty(fill.center, '0', {
    enumerable: true,
    get: () => (++reads.center === 1 ? 10 : '"/><script/>'),
  });
  Object.defineProperty(fill.startColor, 'hex', {
    enumerable: true,
    get: () => (++reads.hex === 1 ? '#123456' : '"/><script/>'),
  });
  Object.defineProperty(fill.endColor, 'alpha', {
    enumerable: true,
    get: () => (++reads.alpha === 1 ? 0.375 : '"/><script/>'),
  });
  const rendered = renderRadialGradientFill(fill, 'g');
  assert.deepEqual(reads, { radius: 1, center: 1, hex: 1, alpha: 1 });
  assert.ok(rendered.definition.includes('cx="10"'));
  assert.ok(rendered.definition.includes('r="100"'));
  assert.ok(rendered.definition.includes('stop-color="#123456"'));
  assert.ok(rendered.definition.includes('stop-opacity="0.375"'));
  assert.doesNotMatch(rendered.definition, /script|Infinity/);
});
