import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';
import { importSVG, SVG_IMPORT_LIMITS } from '../src/svg-import.js';
import {
  evaluate,
  exportSVG,
  deserialize,
  serialize,
  enableRemapPoint,
  pathData,
} from '../src/core.js';
const Parser = new Window().DOMParser;
const gradient = (id = 'ramp') =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-10" y1="0" x2="110" y2="80" spreadMethod="pad" color-interpolation="sRGB"><stop offset="0" stop-color="#F00" stop-opacity="0"/><stop offset="1" stop-color="#123456" stop-opacity="0.8"/></linearGradient>`;
const shape = '<path d="M0 0H100V100H0Z M20 20V80H80V20Z" fill="url(#ramp)"/>';
const svg = (definition = gradient(), artwork = shape) =>
  `<svg viewBox="0 0 200 200"><defs>${definition}</defs>${artwork}</svg>`;
const read = (text) => importSVG(text, Parser);
const result = (doc) =>
  doc.layers.map((l) => {
    const r = evaluate(l);
    assert.equal(r.error, null);
    return {
      name: l.name,
      d: pathData(r.path),
      fill: r.path.fill,
      stroke: r.path.stroke,
      groups: new Set(r.path.contours.map((c) => c.group)).size,
    };
  });

test('safe gradient SVG becomes editable geometry, gradient and stroke nodes with transparent stops', () => {
  const doc = read(
      svg(
        gradient(),
        `<g data-layer="Painted layer" fill-opacity="0.5" stroke="#abcdef" stroke-opacity="0.3" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="7" stroke-dasharray="4 2" stroke-dashoffset="-2">${shape}</g>`,
      ),
    ),
    l = doc.layers[0],
    g = l.nodes.find((n) => n.type === 'Linear Gradient Fill'),
    r = evaluate(l);
  assert.equal(l.name, 'Painted layer');
  assert.deepEqual(
    l.nodes.map((n) => n.type),
    ['Imported Path', 'Path Remap', 'Linear Gradient Fill', 'Stroke', 'Output'],
  );
  assert.deepEqual(g.params.start.value, [-10, 0]);
  assert.deepEqual(g.params.end.value, [110, 80]);
  assert.deepEqual(g.params.startColor.value, { hex: '#FF0000', alpha: 0 });
  assert.deepEqual(g.params.endColor.value, { hex: '#123456', alpha: 0.4 });
  assert.equal(r.path.stroke.alpha, 0.3);
  assert.equal(r.path.stroke.width, 3);
  assert.equal(r.path.stroke.cap, 'round');
  assert.equal(r.path.stroke.join, 'bevel');
  assert.deepEqual(r.path.stroke.dash, [4, 2]);
  assert.equal(r.path.stroke.dashOffset, -2);
  assert.deepEqual(result(read(exportSVG(doc))), result(doc));
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const remap = l.nodes[1],
    source = r.run(l.nodes[0].id);
  enableRemapPoint(remap, source, source.contours[0].points[0].id);
  remap.edits[0].params.position.value = [3, 4];
  g.params.endColor.value = { hex: '#654321', alpha: 0.6 };
  assert.notEqual(pathData(evaluate(l).path), pathData(r.path));
  assert.equal(evaluate(l).path.fill.endColor.hex, '#654321');
});

test('exported multi-layer sample preserves separate transparent groups, strokes and ramps on reopen', () => {
  const original = deserialize(
      fs.readFileSync(new URL('../examples/linear-gradient-fill.json', import.meta.url), 'utf8'),
    ),
    imported = read(exportSVG(original));
  assert.equal(
    fs.readFileSync(new URL('../examples/linear-gradient-fill.svg', import.meta.url), 'utf8'),
    exportSVG(original),
  );
  assert.deepEqual(result(imported), result(original));
  assert.equal(imported.layers.length, original.layers.length);
  assert.ok(imported.layers.some((l) => evaluate(l).path.contours.length > 1));
  assert.ok(imported.layers.every((l) => l.nodes.some((n) => n.type === 'Linear Gradient Fill')));
  assert.deepEqual(result(read(exportSVG(imported))), result(imported));
  assert.ok(imported.layers.every((l) => l.nodes.every((n) => n.type !== 'Text')));
});

test('local forward references, shared definitions and inherited fills preserve order without cross-paint bundling', () => {
  const a = '<rect width="10" height="10"/>',
    b = '<circle r="5" fill="url(#other)"/>',
    doc = read(
      `<svg><g data-layer="A" fill="url(#ramp)">${a}${a}${b}${a}</g><defs>${gradient()}${gradient('other').replace('#123456', '#654321')}</defs></svg>`,
    );
  assert.equal(doc.layers.length, 3);
  assert.deepEqual(
    doc.layers.map((l) => evaluate(l).path.fill.endColor.hex),
    ['#123456', '#654321', '#123456'],
  );
  assert.equal(evaluate(doc.layers[0]).path.contours.length, 2);
  assert.equal(evaluate(doc.layers[2]).path.contours.length, 1);
  const groups = `<g data-layer="256 copies">${shape.repeat(256)}</g>`;
  const full = read(svg(gradient(), groups));
  assert.equal(full.layers.length, 1);
  assert.equal(new Set(evaluate(full.layers[0]).path.contours.map((c) => c.group)).size, 256);
  assert.throws(
    () => read(svg(gradient(), `<g data-layer="257">${shape.repeat(257)}</g>`)),
    /256 independent/,
  );
});

test('definition attributes, stops and endpoint limits reject rather than approximating a different gradient', () => {
  const valid = gradient();
  for (const invalid of [
    valid.replace('userSpaceOnUse', 'objectBoundingBox'),
    valid.replace(' gradientUnits="userSpaceOnUse"', ''),
    valid.replace('spreadMethod="pad"', 'spreadMethod="reflect"'),
    valid.replace(' spreadMethod="pad"', ''),
    valid.replace('color-interpolation="sRGB"', 'color-interpolation="linearRGB"'),
    valid.replace(' color-interpolation="sRGB"', ''),
    valid.replace('x1="-10"', 'x1="-10%"'),
    valid.replace('x1="-10"', 'x1="-10px"'),
    valid.replace('x1="-10"', 'x1="1e309"'),
    valid.replace('x1="-10"', 'x1="NaN"'),
    valid.replace(' x1="-10"', ''),
    valid.replace('x2="110" y2="80"', 'x2="-10" y2="0"'),
    valid.replace('x1="-10"', 'x1="-1e308"').replace('x2="110"', 'x2="1e308"'),
    valid.replace('offset="1"', 'offset="0.5"'),
    valid.replace('offset="1"', 'offset="100%"'),
    valid.replace('offset="0"', 'offset="1"'),
    valid.replace('<stop offset="1" stop-color="#123456" stop-opacity="0.8"/>', ''),
    valid.replace('</linearGradient>', '<stop offset="1" stop-color="#123456"/></linearGradient>'),
    valid.replace('stop-opacity="0.8"', 'stop-opacity="1.1"'),
    valid.replace('stop-opacity="0.8"', 'stop-opacity="-0.1"'),
    valid.replace('stop-opacity="0.8"', 'stop-opacity="50%"'),
    valid.replace('stop-opacity="0.8"', 'stop-opacity="NaN"'),
    valid.replace('stop-color="#F00"', 'stop-color="none"'),
    valid.replace('stop-color="#F00"', 'stop-color="currentColor"'),
    valid.replace('stop-color="#F00"', 'stop-color="transparent"'),
    valid.replace('stop-color="#F00"', 'stop-color="url(#other)"'),
    valid.replace('stop-color="#F00"', 'style="stop-color:red"'),
    valid.replace('id="ramp"', 'id="1ramp"'),
    valid.replace('id="ramp"', `id="${'r'.repeat(129)}"`),
  ])
    assert.throws(() => read(svg(invalid)), undefined, invalid);
  // The finite-endpoint implementation also accepts ordinary decimal exponents.
  const exponent = read(svg(valid.replace('x2="110"', 'x2="1.1e2"')));
  assert.deepEqual(evaluate(exponent.layers[0]).path.fill.end, [110, 80]);
  const inherited = read(
    svg(
      valid.replace(' stop-opacity="0.8"', ''),
      '<g fill-opacity="0.5">' + shape.replace('fill=', 'fill-opacity="0.25" fill=') + '</g>',
    ),
  );
  assert.equal(evaluate(inherited.layers[0]).path.fill.endColor.alpha, 0.25);
});

test('hostile and unsupported paint servers reject including unused definitions and attributes', () => {
  const valid = gradient();
  for (const invalid of [
    valid.replace('<linearGradient ', '<linearGradient href="#ramp" '),
    valid.replace('<linearGradient ', '<linearGradient href="https://example.com/a.svg#x" '),
    valid.replace('<linearGradient ', '<linearGradient href="data:image/svg+xml,evil" '),
    valid.replace('<linearGradient ', '<linearGradient xlink:href="#ramp" '),
    valid.replace('<linearGradient ', '<linearGradient gradientTransform="scale(2)" '),
    valid.replace('<linearGradient ', '<linearGradient onload="alert(1)" '),
    valid.replace('<linearGradient ', '<linearGradient style="color:red" '),
    valid.replace('<stop ', '<stop onclick="alert(1)" '),
    valid.replace('<stop ', '<stop href="https://example.com/" '),
    valid.replace('</linearGradient>', '<script>alert(1)</script></linearGradient>'),
    valid.replace('</linearGradient>', '<animate attributeName="x1"/></linearGradient>'),
    valid.replaceAll('linearGradient', 'radialGradient'),
    '<pattern id="ramp"/>',
    '<filter id="ramp"/>',
    '<image id="ramp" href="https://example.com/a"/>',
    valid + gradient(),
    '<g>' + valid + '</g>',
    valid.replace('<stop ', '<g><stop ').replace('/><stop', '/></g><stop'),
    valid.replace('<stop ', '<stop xmlns="https://example.com/" '),
  ])
    assert.throws(() => read(svg(invalid, '<rect width="2" height="2"/>')), undefined, invalid);
  for (const fill of [
    'url(#missing)',
    'url(https://example.com/a.svg#ramp)',
    'url(data:image/svg+xml,evil)',
    'url(#ramp) red',
    "url('#ramp')",
    'url(#ramp%00)',
    'var(--paint)',
    'context-fill',
  ])
    assert.throws(
      () => read(svg(valid, `<g fill="${fill}"></g><rect width="2" height="2"/>`)),
      undefined,
      fill,
    );
  for (const artwork of [
    shape.replace('fill=', 'stroke='),
    '<rect id="ramp" width="2" height="2"/>',
    '<g opacity="0.5">' + shape + '</g>',
    '<g transform="translate(1)">' + shape + '</g>',
    shape.replace('d=', 'filter="url(#ramp)" d='),
    '<title>' + shape + '</title>',
    '<g><defs>' + valid + '</defs>' + shape + '</g>',
  ])
    assert.throws(() => read(svg(valid, artwork)), undefined, artwork);
  assert.throws(() => read('<!DOCTYPE svg [<!ENTITY x "evil">]>' + svg()), /declarations/);
  assert.throws(
    () => read('<?xml-stylesheet href="https://example.com/a.css"?>' + svg()),
    /declarations/,
  );
  assert.throws(
    () => read(svg().replace('<svg ', '<svg xmlns="https://example.com/" ')),
    /namespace/,
  );
});

test('SVG import resource budgets bound definitions, elements, shapes, depth, path data and geometry', () => {
  const limits = SVG_IMPORT_LIMITS;
  assert.throws(() => read(' '.repeat(limits.bytes + 1)), /10 MB/);
  assert.throws(() => read('あ'.repeat(Math.floor(limits.bytes / 3) + 1)), /10 MB/);
  assert.throws(
    () =>
      read(
        svg(
          Array.from({ length: limits.gradients + 1 }, (_, i) => gradient('g' + i)).join(''),
          '<rect/>',
        ),
      ),
    /gradient budget/,
  );
  assert.throws(() => read(`<svg>${'<g/>'.repeat(limits.elements)}</svg>`), /element budget/);
  assert.throws(() => read(`<svg>${'<rect/>'.repeat(limits.shapes + 1)}</svg>`), /shape budget/);
  assert.throws(
    () => read(`<svg>${'<g>'.repeat(limits.depth)}<rect/>${'</g>'.repeat(limits.depth)}</svg>`),
    /nesting depth/,
  );
  const data = 'M0 0' + 'L1 1'.repeat(24990);
  assert.throws(() => read(`<svg>${`<path d="${data}"/>`.repeat(11)}</svg>`), /path data budget/);
  const contourBoundary = 'M0 0L1 1'.repeat(limits.contours),
    pointBoundary = 'M0 0' + 'L1 1'.repeat(limits.points / 5 - 1);
  for (const primitive of [
    '<circle r="1"/>',
    '<ellipse rx="1" ry="1"/>',
    '<rect width="1" height="1"/>',
  ]) {
    assert.throws(
      () => read(`<svg><path d="${contourBoundary}"/>${primitive}</svg>`),
      /geometry budget/,
    );
    assert.throws(
      () => read(`<svg>${`<path d="${pointBoundary}"/>`.repeat(5)}${primitive}</svg>`),
      /geometry budget/,
    );
  }
  const contours = 'M0 0L1 1'.repeat(5001);
  assert.throws(
    () => read(`<svg><path d="${contours}"/><path d="${contours}"/></svg>`),
    /geometry budget/,
  );
  assert.throws(() => read(`<svg>${`<path d="${data}"/>`.repeat(5)}</svg>`), /geometry budget/);
});
