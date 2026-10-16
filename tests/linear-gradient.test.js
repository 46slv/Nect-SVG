import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLinearGradientFill,
  validateLinearGradientFill,
  renderLinearGradientFill,
} from '../src/linear-gradient.js';

const inputs = () => ({
  start: [10, 20],
  end: [110, 20],
  startColor: { hex: '#12abEF', alpha: 1 },
  endColor: { hex: '#345678', alpha: 0.375 },
});
const descriptor = () => ({ kind: 'linear-gradient', ...inputs() });

test('linear gradient creation preserves horizontal, vertical, diagonal and reversed endpoints', () => {
  for (const [start, end] of [
    [
      [10, 20],
      [110, 20],
    ],
    [
      [10, 20],
      [10, 120],
    ],
    [
      [-2.5, 3.25],
      [40.5, -7.75],
    ],
    [
      [110, 20],
      [10, 20],
    ],
    [
      [10, 120],
      [10, 20],
    ],
    [
      [40.5, -7.75],
      [-2.5, 3.25],
    ],
  ]) {
    const options = { ...inputs(), start, end },
      fill = createLinearGradientFill(options);
    assert.deepEqual(fill, { kind: 'linear-gradient', ...options });
    assert.equal(validateLinearGradientFill(fill), undefined);
    const { definition } = renderLinearGradientFill(fill, 'gradient-1');
    assert.ok(
      definition.includes(`x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}"`),
    );
  }
});

test('creation defensively copies every vector and color, even when inputs alias', () => {
  const options = inputs(),
    before = structuredClone(options),
    fill = createLinearGradientFill(options);
  for (const key of Object.keys(options)) assert.notEqual(fill[key], options[key]);
  options.start[0] = 90;
  options.end[1] = 90;
  options.startColor.alpha = 0;
  options.endColor.hex = '#000000';
  assert.deepEqual(fill, { kind: 'linear-gradient', ...before });
  fill.start[1] = -10;
  fill.end[0] = -10;
  fill.startColor.hex = '#ffffff';
  fill.endColor.alpha = 1;
  assert.deepEqual(options.start, [90, 20]);
  assert.deepEqual(options.end, [110, 90]);
  assert.deepEqual(options.startColor, { hex: '#12abEF', alpha: 0 });
  assert.deepEqual(options.endColor, { hex: '#000000', alpha: 0.375 });
  const color = { hex: '#123456', alpha: 0.5 },
    aliased = createLinearGradientFill({ ...inputs(), startColor: color, endColor: color });
  assert.notEqual(aliased.startColor, aliased.endColor);
  aliased.startColor.alpha = 0;
  assert.equal(aliased.endColor.alpha, 0.5);
  assert.equal(color.alpha, 0.5);
});

test('validation and rendering leave frozen input untouched and return independent results', () => {
  const fill = descriptor(),
    before = structuredClone(fill);
  for (const key of ['start', 'end', 'startColor', 'endColor']) Object.freeze(fill[key]);
  Object.freeze(fill);
  assert.doesNotThrow(() => validateLinearGradientFill(fill));
  const first = renderLinearGradientFill(fill, 'gradient-1'),
    second = renderLinearGradientFill(fill, 'gradient-1');
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  assert.deepEqual(fill, before);
});

test('SVG markup is deterministic, with two fixed stops and independent stop opacity', () => {
  const fill = descriptor();
  assert.deepEqual(renderLinearGradientFill(fill, 'gradient-1'), {
    definition:
      '<linearGradient id="gradient-1" gradientUnits="userSpaceOnUse" ' +
      'x1="10" y1="20" x2="110" y2="20" spreadMethod="pad" color-interpolation="sRGB">' +
      '<stop offset="0" stop-color="#12abEF" stop-opacity="1"/>' +
      '<stop offset="1" stop-color="#345678" stop-opacity="0.375"/>' +
      '</linearGradient>',
    paint: 'url(#gradient-1)',
  });
  for (const startAlpha of [0, 1, 0.125])
    for (const endAlpha of [0, 1, 0.625]) {
      const options = inputs();
      options.startColor.alpha = startAlpha;
      options.endColor.alpha = endAlpha;
      const { definition } = renderLinearGradientFill(createLinearGradientFill(options), 'g');
      assert.ok(definition.includes(`stop-color="#12abEF" stop-opacity="${startAlpha}"`));
      assert.ok(definition.includes(`stop-color="#345678" stop-opacity="${endAlpha}"`));
      assert.equal((definition.match(/<stop /g) || []).length, 2);
      assert.doesNotMatch(definition, /<defs|gradientTransform|fill-opacity|href|style=/);
    }
  renderLinearGradientFill(fill, 'unrelated-id');
  assert.deepEqual(
    renderLinearGradientFill(fill, 'gradient-1'),
    renderLinearGradientFill(fill, 'gradient-1'),
  );
});

test('input and descriptor shapes reject missing, extra and inherited fields', () => {
  for (const bad of [undefined, null, false, 1, 'gradient', [], () => {}]) {
    assert.throws(() => createLinearGradientFill(bad), /Invalid linear gradient inputs/);
    assert.throws(() => validateLinearGradientFill(bad), /Invalid linear gradient fill/);
    assert.throws(() => renderLinearGradientFill(bad, 'g'), /Invalid linear gradient fill/);
  }
  for (const key of Object.keys(inputs())) {
    const options = inputs(),
      fill = descriptor();
    delete options[key];
    delete fill[key];
    assert.throws(() => createLinearGradientFill(options), /Invalid linear gradient inputs/);
    assert.throws(() => validateLinearGradientFill(fill), /Invalid linear gradient fill/);
  }
  for (const extra of ['stops', 'id', 'opacity', Symbol('extra')]) {
    assert.throws(() => createLinearGradientFill({ ...inputs(), [extra]: 1 }), /Invalid/);
    assert.throws(() => validateLinearGradientFill({ ...descriptor(), [extra]: 1 }), /Invalid/);
  }
  for (const kind of [undefined, null, 'linearGradient', 'radial-gradient', 1])
    assert.throws(() => validateLinearGradientFill({ ...inputs(), kind }), /Invalid/);
  assert.throws(() => validateLinearGradientFill(Object.create(descriptor())), /Invalid/);
  assert.throws(() => createLinearGradientFill(Object.create(inputs())), /Invalid/);
  assert.throws(
    () => validateLinearGradientFill(Object.defineProperty(descriptor(), 'extra', { value: 1 })),
    /Invalid/,
  );
});

test('both endpoints require dense two-number vectors without extra keys', () => {
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
  for (const bad of [NaN, Infinity, -Infinity, '0', null, undefined, true, {}, 0n])
    invalid.push([bad, 0], [0, bad]);
  for (const key of ['start', 'end'])
    for (const bad of invalid) {
      assert.throws(
        () => createLinearGradientFill({ ...inputs(), [key]: bad }),
        /Expected Vector2/,
      );
      assert.throws(
        () => validateLinearGradientFill({ ...descriptor(), [key]: bad }),
        /Expected Vector2/,
      );
      assert.throws(
        () => renderLinearGradientFill({ ...descriptor(), [key]: bad }, 'g'),
        /Expected Vector2/,
      );
    }
});

test('coincident endpoints and nonfinite differences or lengths are rejected', () => {
  for (const [start, end] of [
    [
      [0, 0],
      [0, 0],
    ],
    [
      [-0, 0],
      [0, -0],
    ],
    [
      [5.5, -2],
      [5.5, -2],
    ],
    [
      [-Number.MAX_VALUE, 0],
      [Number.MAX_VALUE, 0],
    ],
    [
      [0, -Number.MAX_VALUE],
      [0, Number.MAX_VALUE],
    ],
    [
      [0, 0],
      [Number.MAX_VALUE, Number.MAX_VALUE],
    ],
  ]) {
    const options = { ...inputs(), start, end },
      fill = { kind: 'linear-gradient', ...options };
    assert.throws(() => createLinearGradientFill(options), /finite, nonzero distance/);
    assert.throws(() => validateLinearGradientFill(fill), /finite, nonzero distance/);
    assert.throws(() => renderLinearGradientFill(fill, 'g'), /finite, nonzero distance/);
  }
  for (const end of [
    [Number.MIN_VALUE, 0],
    [0, Number.MIN_VALUE],
    [Number.MAX_VALUE, 0],
  ])
    assert.doesNotThrow(() => createLinearGradientFill({ ...inputs(), start: [0, 0], end }));
});

test('both colors use exactly hex #RRGGBB and a finite numeric alpha from zero to one', () => {
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
    for (const bad of invalid) {
      assert.throws(() => createLinearGradientFill({ ...inputs(), [key]: bad }), /Expected Color/);
      assert.throws(
        () => validateLinearGradientFill({ ...descriptor(), [key]: bad }),
        /Expected Color/,
      );
      assert.throws(
        () => renderLinearGradientFill({ ...descriptor(), [key]: bad }, 'g'),
        /Expected Color/,
      );
    }
});

test('SVG IDs are explicit, bounded ASCII identifiers safe in XML and local paint URLs', () => {
  const fill = descriptor();
  for (const id of ['g', '_', 'gradient-1', '_Gradient.2-3', 'g'.repeat(128)]) {
    const rendered = renderLinearGradientFill(fill, id);
    assert.ok(rendered.definition.startsWith(`<linearGradient id="${id}" `));
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
    assert.throws(() => renderLinearGradientFill(fill, id), /Invalid linear gradient ID/);
});

test('rendering uses a validated snapshot when caller properties are accessors', () => {
  const fill = descriptor();
  let reads = 0;
  Object.defineProperty(fill.startColor, 'hex', {
    enumerable: true,
    get: () => (++reads === 1 ? '#123456' : '\"/><script/>'),
  });
  const rendered = renderLinearGradientFill(fill, 'g');
  assert.equal(reads, 1);
  assert.ok(rendered.definition.includes('stop-color="#123456"'));
  assert.doesNotMatch(rendered.definition, /script/);
});
