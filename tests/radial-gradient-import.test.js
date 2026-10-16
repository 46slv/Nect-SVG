import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { importSVG, SVG_IMPORT_LIMITS } from '../src/svg-import.js';
import {
  evaluate,
  exportSVG,
  serialize,
  deserialize,
  pathData,
  enableRemapPoint,
} from '../src/core.js';
const Parser = new Window().DOMParser;
const gradient = (id = 'ramp') =>
  `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="-10" cy="20" r="80" fx="-10" fy="20" fr="0" spreadMethod="pad" color-interpolation="sRGB"><stop offset="0" stop-color="#F00" stop-opacity="0.25"/><stop offset="1" stop-color="#123456" stop-opacity="0.8"/></radialGradient>`;
const shape = '<path d="M0 0H100V100H0Z M20 20V80H80V20Z" fill="url(#ramp)"/>';
const svg = (definition = gradient(), artwork = shape) =>
  `<svg viewBox="0 0 200 200"><defs>${definition}</defs>${artwork}</svg>`;
const read = (source) => importSVG(source, Parser);

test('radial own-export subset retains fill alpha, independent stroke and editable geometry through repeated reopening', () => {
  const source = svg(
      gradient(),
      `<g data-layer="Radial holes" fill-opacity="0.5" stroke="#abcdef" stroke-opacity="0.3" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="7" stroke-dasharray="4 2" stroke-dashoffset="-2">${shape}</g>`,
    ),
    doc = read(source),
    l = doc.layers[0],
    g = l.nodes.find((n) => n.type === 'Radial Gradient Fill'),
    r = evaluate(l);
  assert.deepEqual(
    l.nodes.map((n) => n.type),
    ['Imported Path', 'Path Remap', 'Radial Gradient Fill', 'Stroke', 'Output'],
  );
  assert.equal(l.name, 'Radial holes');
  assert.deepEqual(r.path.fill, {
    kind: 'radial-gradient',
    center: [-10, 20],
    radius: 80,
    startColor: { hex: '#FF0000', alpha: 0.125 },
    endColor: { hex: '#123456', alpha: 0.4 },
  });
  assert.deepEqual(r.path.stroke, {
    hex: '#abcdef',
    alpha: 0.3,
    width: 3,
    cap: 'round',
    join: 'bevel',
    dash: [4, 2],
    miterLimit: 7,
    dashOffset: -2,
  });
  assert.equal(r.path.contours.length, 2);
  const exported = exportSVG(doc),
    reopened = read(exported);
  assert.equal(exportSVG(reopened), exported);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  assert.deepEqual(evaluate(reopened.layers[0]).path.fill, r.path.fill);
  const remap = l.nodes[1],
    original = r.run(l.nodes[0].id);
  enableRemapPoint(remap, original, original.contours[0].points[0].id);
  remap.edits[0].params.position.value = [3, 4];
  g.params.radius.value = 60;
  assert.notEqual(pathData(evaluate(l).path), pathData(r.path));
  assert.equal(evaluate(l).path.fill.radius, 60);
});

test('radial forward/shared references are independent editable values and do not bundle mixed paint', () => {
  const linear =
      '<linearGradient id="linear" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0" spreadMethod="pad" color-interpolation="sRGB"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>',
    doc = read(
      `<svg><g data-layer="Mixed"><rect width="10" height="10" fill="url(#ramp)"/><rect x="5" width="10" height="10" fill="url(#ramp)"/><rect width="10" height="10" fill="url(#linear)"/>${shape}</g><defs>${gradient()}${linear}</defs></svg>`,
    );
  assert.equal(doc.layers.length, 3);
  assert.deepEqual(
    doc.layers.map((l) => evaluate(l).path.fill.kind),
    ['radial-gradient', 'linear-gradient', 'radial-gradient'],
  );
  assert.equal(new Set(evaluate(doc.layers[0]).path.contours.map((c) => c.group)).size, 2);
  doc.layers[0].nodes.find((n) => n.type === 'Radial Gradient Fill').params.startColor.value.alpha =
    0;
  assert.equal(evaluate(doc.layers[2]).path.fill.startColor.alpha, 0.25);
  assert.equal(evaluate(read(exportSVG(doc)).layers[2]).path.fill.startColor.alpha, 0.25);
});

test('radial import refuses unsupported geometry, implicit defaults, inheritance and malformed paint atomically', () => {
  const valid = gradient();
  const invalids = [
    ...[
      'cx',
      'cy',
      'r',
      'fx',
      'fy',
      'fr',
      'gradientUnits',
      'spreadMethod',
      'color-interpolation',
    ].map((key) => valid.replace(new RegExp(` ${key}="[^"]*"`), '')),
    ...['0', '-1', '0.00001', '100001', '1e309', 'NaN', '10%', '10px'].map((r) =>
      valid.replace('r="80"', `r="${r}"`),
    ),
    valid.replaceAll('="-10"', '="-100001"'),
    valid.replace('fx="-10"', 'fx="-9"'),
    valid.replace('fy="20"', 'fy="21"'),
    valid.replace('fr="0"', 'fr="1"'),
    valid.replace('userSpaceOnUse', 'objectBoundingBox'),
    valid.replace('pad', 'reflect'),
    valid.replace('sRGB', 'linearRGB'),
    valid.replace('offset="1"', 'offset="0.5"'),
    valid.replace('offset="0"', 'offset="1"'),
    valid.replace('</radialGradient>', '<stop offset="1" stop-color="#fff"/></radialGradient>'),
    valid.replace('stop-opacity="0.8"', 'stop-opacity="1.1"'),
    valid.replace('stop-color="#F00"', 'stop-color="currentColor"'),
    ...[
      'href="#ramp"',
      'href="https://example.invalid/paint.svg#x"',
      'xlink:href="#ramp"',
      'gradientTransform="scale(2,1)"',
      'style="color:red"',
      'onload="alert(1)"',
      'x1="0"',
    ].map((attr) => valid.replace('<radialGradient ', `<radialGradient ${attr} `)),
    valid.replace('</radialGradient>', '<script>alert(1)</script></radialGradient>'),
    valid.replace('<stop ', '<stop xmlns="https://example.invalid" '),
    valid + valid,
  ];
  for (const invalid of invalids) {
    assert.throws(() => read(svg(invalid)), undefined, invalid);
    assert.throws(
      () => read(svg(invalid, '<rect width="1" height="1"/>')),
      undefined,
      `unused: ${invalid}`,
    );
  }
  for (const artwork of [
    shape.replace('fill=', 'stroke='),
    shape.replace('d=', 'transform="scale(2,1)" d='),
    '<g opacity="0.5">' + shape + '</g>',
    '<g transform="scale(2)">' + shape + '</g>',
    shape.replace('#ramp', '#missing'),
    '<rect id="ramp"/>',
    shape + '<rect onload="alert(1)"/>',
  ])
    assert.throws(() => read(svg(valid, artwork)));
});

test('radial and linear definitions share the existing aggregate budget; minimum radius survives decimal serialization', () => {
  assert.throws(
    () =>
      read(
        svg(
          Array.from({ length: SVG_IMPORT_LIMITS.gradients + 1 }, (_, i) => gradient('g' + i)).join(
            '',
          ),
          '<rect/>',
        ),
      ),
    /gradient budget/,
  );
  const minimum = read(svg(gradient().replace('r="80"', 'r="1e-4"')));
  assert.equal(evaluate(minimum.layers[0]).path.fill.radius, 0.0001);
  assert.equal(evaluate(read(exportSVG(minimum)).layers[0]).path.fill.radius, 0.0001);
});
