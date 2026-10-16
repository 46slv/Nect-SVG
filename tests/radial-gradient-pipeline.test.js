import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import {
  document,
  node,
  layer,
  connect,
  disconnect,
  evaluate,
  exportSVG,
  renderElement,
  pathData,
  pathBounds,
  serialize,
  deserialize,
  validate,
  History,
  outputType,
  createCharacterPositions,
  radialGradientSettings,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import { importSVG } from '../src/svg-import.js';
import { createRadialGradientFill } from '../src/radial-gradient.js';
const Parser = new Window().DOMParser;
const xml = (svg) => new Parser().parseFromString(svg, 'image/svg+xml');

function scene(type = 'Radial Gradient Fill') {
  const doc = document(),
    l = doc.layers[0],
    shape = node('Rectangle'),
    gradient = node(type),
    out = node('Output');
  l.nodes = [shape, gradient, out];
  l.output = out.id;
  connect(l, shape.id, gradient.id, 'path');
  connect(l, gradient.id, out.id, 'path');
  return { doc, l, shape, gradient, out };
}
function append(l, type, source) {
  const n = node(type);
  l.nodes.push(n);
  connect(l, source.id, n.id, 'path');
  return n;
}
// Compare actual independently painted geometry, not regenerated node or point IDs.
function artwork(doc) {
  return doc.layers
    .filter((l) => l.visible && !l.guide)
    .map((l) => {
      const r = evaluate(l);
      assert.equal(r.error, null);
      const groups = new Map();
      for (const c of r.path.contours) {
        const key = c.group ?? '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      return {
        name: l.name,
        geometry: pathData(r.path),
        groups: [...groups.values()].map((contours) => pathData({ contours })),
        bounds: pathBounds(r.path),
        fill: r.path.fill,
        stroke: r.path.stroke,
      };
    });
}

test('radial node exposes typed paint inputs and shared settings with independent colors', () => {
  const { gradient } = scene(),
    params = gradient.params;
  assert.equal(outputType(gradient), 'PaintedPath');
  assert.deepEqual(Object.fromEntries(Object.entries(params).map(([key, q]) => [key, q.type])), {
    path: 'PaintedPath',
    center: 'Vector2',
    radius: 'Scalar',
    startColor: 'Color',
    endColor: 'Color',
  });
  const reads = [];
  const fill = radialGradientSettings((key) => {
    reads.push(key);
    return params[key].value;
  });
  assert.deepEqual(reads, ['center', 'radius', 'startColor', 'endColor']);
  assert.deepEqual(
    fill,
    createRadialGradientFill(Object.fromEntries(reads.map((key) => [key, params[key].value]))),
  );
  assert.notEqual(fill.center, params.center.value);
  assert.notEqual(fill.startColor, params.startColor.value);
  assert.notEqual(fill.endColor, params.endColor.value);
});

test('radial paint preserves stroke, geometry, bounds, fingerprints and upstream cached branches', () => {
  const { doc, l, shape, gradient, out } = scene(),
    stroke = append(l, 'Stroke', shape);
  stroke.params.color.value = { hex: '#00ff00', alpha: 0.4 };
  stroke.params.width.value = 6;
  stroke.strokeCap = 'round';
  stroke.strokeJoin = 'bevel';
  stroke.strokeDash = [4, 2];
  stroke.params.dashOffset.value = -2;
  connect(l, stroke.id, gradient.id, 'path');
  const r = evaluate(l),
    source = r.run(stroke.id),
    snapshot = structuredClone(source);
  assert.equal(r.error, null);
  assert.equal(r.path.fill.kind, 'radial-gradient');
  assert.deepEqual(r.path.contours, source.contours);
  assert.deepEqual(r.path.stroke, source.stroke);
  assert.deepEqual(pathBounds(r.path), pathBounds(source));
  assert.equal(pathData(r.path), pathData(source));
  assert.equal(r.path.fingerprint, source.fingerprint);
  assert.equal(r.path.unstable, source.unstable);
  assert.equal(source.fill, undefined);
  assert.equal(evaluate(l).stats.computed, 0);
  gradient.params.radius.value *= 2;
  const updated = evaluate(l);
  assert.equal(updated.error, null);
  assert.deepEqual(updated.run(stroke.id), snapshot);
  assert.deepEqual(updated.path.contours, snapshot.contours);
  assert.equal(updated.path.fingerprint, snapshot.fingerprint);
  assert.notEqual(updated.path.fill.radius, r.path.fill.radius);
  const lastStroke = append(l, 'Stroke', gradient);
  connect(l, lastStroke.id, out.id, 'path');
  assert.deepEqual(evaluate(l).path.fill, updated.path.fill);
  const solid = append(l, 'Fill', lastStroke);
  connect(l, solid.id, out.id, 'path');
  assert.deepEqual(evaluate(l).path.fill, solid.params.color.value);
  assert.doesNotMatch(exportSVG(doc), /radialGradient|url\(#/);
  assert.throws(() => connect(l, solid.id, gradient.id, 'path'), /cycle/);
});

test('linear and radial fills replace one another without leaking stale paint servers', () => {
  const { doc, l, shape, gradient, out } = scene(),
    linear = append(l, 'Linear Gradient Fill', shape);
  connect(l, linear.id, gradient.id, 'path');
  const radialResult = evaluate(l);
  assert.equal(radialResult.error, null);
  assert.equal(radialResult.run(linear.id).fill.kind, 'linear-gradient');
  assert.equal(radialResult.path.fill.kind, 'radial-gradient');
  assert.equal(xml(exportSVG(doc)).querySelectorAll('radialGradient').length, 1);
  assert.equal(xml(exportSVG(doc)).querySelectorAll('linearGradient').length, 0);
  const lastLinear = append(l, 'Linear Gradient Fill', gradient);
  connect(l, lastLinear.id, out.id, 'path');
  assert.equal(evaluate(l).path.fill.kind, 'linear-gradient');
  assert.equal(xml(exportSVG(doc)).querySelectorAll('linearGradient').length, 1);
  assert.equal(xml(exportSVG(doc)).querySelectorAll('radialGradient').length, 0);
  assert.deepEqual(artwork(importSVG(exportSVG(doc), Parser)), artwork(doc));
});

test('radial socket boundaries accept paths and reject incompatible geometry and value types', () => {
  const { doc, l, shape, gradient, out } = scene();
  for (const type of [
    'Boolean',
    'Join Geometry',
    'Transform',
    'Path Remap',
    'Convert to Path',
    'Text to Path',
    'Geometry Repeater',
    'Closed Path Offset',
  ]) {
    const n = node(type);
    l.nodes.push(n);
    assert.throws(
      () =>
        connect(l, gradient.id, n.id, ['Boolean', 'Join Geometry'].includes(type) ? 'a' : 'path'),
      /PaintedPath to Path/,
    );
  }
  const color = node('Color'),
    vector = node('Vector'),
    scalar = node('Value');
  l.nodes.push(color, vector, scalar);
  assert.throws(() => connect(l, color.id, gradient.id, 'center'), /Color to Vector2/);
  assert.throws(() => connect(l, vector.id, gradient.id, 'radius'), /Vector2 to Scalar/);
  for (const key of ['startColor', 'endColor'])
    assert.throws(() => connect(l, vector.id, gradient.id, key), /Vector2 to Color/);
  assert.throws(() => connect(l, scalar.id, gradient.id, 'path'), /Scalar to PaintedPath/);
  assert.throws(() => connect(l, out.id, gradient.id, 'path'), /cycle/);
  gradient.params.center.source = color.id;
  assert.throws(() => validate(doc), /Color to Vector2/);
  assert.match(evaluate(l).error, /Incompatible socket/);
  delete gradient.params.center.source;
  assert.equal(evaluate(l).error, null);
  assert.equal(evaluate(l).run(shape.id).fill, undefined);
});

test('radial sources, expressions, fallbacks, locks, history and JSON keep independent editable values', () => {
  const { doc, l, gradient } = scene(),
    v = node('Vector'),
    c = node('Color'),
    s = node('Value');
  l.nodes.push(v, c, s);
  v.params.value.value = [10, 20];
  c.params.value.value = { hex: '#123456', alpha: 0 };
  s.params.value.value = 37.5;
  const fallback = structuredClone(gradient.params);
  connect(l, v.id, gradient.id, 'center');
  connect(l, s.id, gradient.id, 'radius');
  connect(l, c.id, gradient.id, 'endColor');
  assert.deepEqual(evaluate(l).path.fill.center, [10, 20]);
  assert.equal(evaluate(l).path.fill.radius, 37.5);
  assert.equal(evaluate(l).path.fill.endColor.alpha, 0);
  for (const key of ['center', 'radius', 'endColor'])
    assert.deepEqual(gradient.params[key].value, fallback[key].value);
  const h = new History(doc);
  h.apply(() => {
    gradient.params.radius.locked = true;
  });
  assert.throws(() => disconnect(gradient, 'radius'), /locked/);
  assert.throws(() => connect(l, s.id, gradient.id, 'radius'), /locked/);
  const saved = serialize(doc);
  assert.equal(serialize(deserialize(saved)), saved);
  assert.deepEqual(artwork(deserialize(saved)), artwork(doc));
  h.undo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === gradient.id).params.radius.locked, false);
  h.redo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === gradient.id).params.radius.locked, true);
  gradient.params.radius.locked = false;
  for (const key of ['center', 'radius', 'endColor']) {
    disconnect(gradient, key);
    assert.deepEqual(evaluate(l).path.fill[key], fallback[key].value);
  }
  gradient.params.center.expression = '5 * 2; 7 + 3';
  gradient.params.radius.expression = '5 * 7.5';
  assert.deepEqual(evaluate(l).path.fill.center, [10, 10]);
  assert.equal(evaluate(l).path.fill.radius, 37.5);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
});

test('radial invalid resolved expressions and socket values fail without emitting SVG', () => {
  for (const [key, expression] of [
    ['radius', '0'],
    ['radius', '-1'],
    ['radius', '0.00001'],
    ['radius', '100001'],
    ['radius', '1 / 0'],
    ['radius', 'window.alert(1)'],
    ['center', '100001; 0'],
    ['center', '0; -100001'],
    ['center', '1; 2; 3'],
    ['center', '1 / 0; 0'],
    ['startColor', '1'],
  ]) {
    const { doc, l, gradient } = scene();
    gradient.params[key].expression = expression;
    assert.ok(evaluate(l).error, `${key}: ${expression}`);
    assert.throws(() => exportSVG(doc), undefined, `${key}: ${expression}`);
  }
  const { doc, l, gradient } = scene(),
    scalar = node('Value'),
    vector = node('Vector');
  l.nodes.push(scalar, vector);
  connect(l, scalar.id, gradient.id, 'radius');
  for (const value of [0, -1, 0.00001, 100001]) {
    scalar.params.value.value = value;
    assert.ok(evaluate(l).error);
    assert.throws(() => exportSVG(doc));
  }
  scalar.params.value.value = 20;
  connect(l, vector.id, gradient.id, 'center');
  vector.params.value.value = [-100001, 0];
  assert.ok(evaluate(l).error);
  assert.throws(() => exportSVG(doc));
});

test('radial invalid fallbacks reject atomically, including dormant and connected parameters', () => {
  const { doc, l, shape, gradient, out } = scene();
  connect(l, shape.id, out.id, 'path');
  const h = new History(doc),
    before = serialize(doc);
  assert.throws(() =>
    h.apply(() => {
      gradient.params.radius.value = 0;
      validate(doc);
    }),
  );
  assert.equal(serialize(h.doc), before);
  assert.equal(h.past.length, 0);
  for (const [key, value] of [
    ['radius', 0],
    ['radius', -1],
    ['radius', 0.00001],
    ['radius', 100001],
    ['radius', Infinity],
    ['center', [Infinity, 1]],
    ['center', [0, 100001]],
    ['endColor', { hex: 'url(#evil)', alpha: 1 }],
    ['startColor', { hex: '#ff0000', alpha: -1 }],
  ]) {
    const bad = deserialize(before),
      badLayer = bad.layers[0],
      badGradient = badLayer.nodes.find((n) => n.id === gradient.id);
    badGradient.params[key].value = value;
    assert.throws(() => validate(bad));
    // A valid source must not make an invalid saved fallback persistable.
    const source = node(key === 'radius' ? 'Value' : key === 'center' ? 'Vector' : 'Color');
    badLayer.nodes.push(source);
    connect(badLayer, source.id, badGradient.id, key);
    assert.throws(() => validate(bad));
    assert.throws(() => deserialize(serialize(bad)));
  }
});

test('radial and linear layers allocate unique deterministic paint servers reused across independent groups', () => {
  const { doc, l, shape, gradient } = scene(),
    b = node('Rectangle'),
    join = node('Join Geometry'),
    repeat = node('Geometry Repeater');
  l.nodes.push(b, join, repeat);
  b.params.center.value = [410, 250];
  connect(l, shape.id, join.id, 'a');
  connect(l, b.id, join.id, 'b');
  connect(l, join.id, repeat.id, 'path');
  repeat.params.count.value = 3;
  connect(l, repeat.id, gradient.id, 'path');
  gradient.params.center.value = [-10, 35];
  gradient.params.startColor.value.alpha = 0.25;
  const linear = scene('Linear Gradient Fill'),
    radial = scene();
  linear.l.id = '1:long-' + 'x'.repeat(170);
  linear.l.name = l.name;
  radial.l.name = l.name;
  doc.layers.push(linear.l, radial.l);
  const guide = layer('Hidden guide');
  guide.guide = true;
  doc.layers.unshift(guide);
  const first = exportSVG(doc),
    dom = xml(first),
    defs = [...dom.querySelectorAll('radialGradient,linearGradient')];
  assert.equal(first, exportSVG(doc));
  assert.deepEqual(
    defs.map((g) => g.id),
    ['nect-gradient-1', 'nect-gradient-2', 'nect-gradient-3'],
  );
  assert.deepEqual(
    defs.map((g) => g.localName),
    ['radialGradient', 'linearGradient', 'radialGradient'],
  );
  const grouped = dom.querySelector('g');
  assert.equal(grouped.querySelectorAll('path').length, 6);
  for (const p of grouped.querySelectorAll('path'))
    assert.equal(p.getAttribute('fill'), 'url(#nect-gradient-1)');
  assert.equal(grouped.querySelectorAll('defs').length, 0);
  const r = evaluate(l);
  assert.deepEqual(r.path.contours, r.run(repeat.id).contours);
  assert.match(r.path.fingerprint, /^sha256:/);
  assert.equal(r.path.fingerprint, r.run(repeat.id).fingerprint);
  assert.equal(r.path.unstable, true);
  assert.deepEqual(r.path.fill.center, [-10, 35]);
  const imported = importSVG(first, Parser);
  assert.deepEqual(artwork(imported), artwork(doc));
  assert.deepEqual(artwork(importSVG(exportSVG(imported), Parser)), artwork(imported));
});

test('radial SVG exports absolute concentric settings, stop alpha and unchanged solid markup', () => {
  const { doc, l, shape, gradient, out } = scene();
  gradient.params.center.value = [-10, 20];
  gradient.params.radius.value = 110.5;
  gradient.params.startColor.value = { hex: '#ff0000', alpha: 0 };
  gradient.params.endColor.value = { hex: '#0000ff', alpha: 0.625 };
  const dom = xml(exportSVG(doc)),
    g = dom.querySelector('radialGradient');
  for (const [key, value] of Object.entries({
    gradientUnits: 'userSpaceOnUse',
    cx: '-10',
    cy: '20',
    r: '110.5',
    fx: '-10',
    fy: '20',
    fr: '0',
    spreadMethod: 'pad',
    'color-interpolation': 'sRGB',
  }))
    assert.equal(g.getAttribute(key), value);
  assert.deepEqual(
    [...g.querySelectorAll('stop')].map((s) => [
      s.getAttribute('offset'),
      s.getAttribute('stop-opacity'),
    ]),
    [
      ['0', '0'],
      ['1', '0.625'],
    ],
  );
  assert.equal(dom.querySelector('path').hasAttribute('fill-opacity'), false);
  assert.equal(dom.querySelector('path').getAttribute('d'), pathData(evaluate(l).run(shape.id)));
  assert.deepEqual(artwork(importSVG(exportSVG(doc), Parser)), artwork(doc));
  for (const radius of [0.0001, 100000]) {
    gradient.params.radius.value = radius;
    gradient.params.center.value = [-100000, 100000];
    assert.deepEqual(artwork(importSVG(exportSVG(doc), Parser)), artwork(doc));
  }
  const fill = append(l, 'Fill', shape);
  fill.params.color.value = { hex: '#12abEF', alpha: 0.375 };
  connect(l, fill.id, out.id, 'path');
  assert.equal(
    renderElement(evaluate(l).path, l),
    `<path  data-layer="${l.name}" d="${pathData(evaluate(l).path)}" fill="#12abEF" fill-opacity="0.375" fill-rule="nonzero"/>`,
  );
});

test('radial paint keeps text character identity, occurrence metadata, bounds and fingerprints', () => {
  const { doc, l, gradient } = scene(),
    text = node('Text');
  text.text = 'AB';
  doc.schemaVersion = 3;
  text.characterPositions = createCharacterPositions(text.text);
  l.nodes.push(text);
  connect(l, text.id, gradient.id, 'path');
  const data = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
  const font = parseFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
    r = evaluate(l, { default: font }),
    source = r.run(text.id);
  assert.equal(r.error, null);
  assert.ok(source.characterOccurrences.length > 0);
  assert.deepEqual(r.path.characterOccurrences, source.characterOccurrences);
  assert.deepEqual(r.path.contours, source.contours);
  assert.equal(r.path.fingerprint, source.fingerprint);
  assert.deepEqual(pathBounds(r.path), pathBounds(source));
  assert.equal(pathData(r.path), pathData(source));
  const imported = importSVG(exportSVG(doc, { default: font }), Parser);
  assert.ok(imported.layers[0].nodes.every((n) => n.type !== 'Text'));
  assert.equal(pathData(evaluate(imported.layers[0]).path), pathData(r.path));
  assert.deepEqual(evaluate(imported.layers[0]).path.fill, r.path.fill);
});

const definition =
  '<radialGradient id="ramp" gradientUnits="userSpaceOnUse" cx="10" cy="20" r="100" fx="10" fy="20" fr="0" spreadMethod="pad" color-interpolation="sRGB"><stop offset="0" stop-color="#ff0000" stop-opacity="0"/><stop offset="1" stop-color="#123456" stop-opacity="0.8"/></radialGradient>';
const svg = (g = definition, shape = '<rect width="10" height="10" fill="url(#ramp)"/>') =>
  `<svg><defs>${g}</defs>${shape}</svg>`;

test('radial import retains independent stop opacity, stroke settings and inherited local fill', () => {
  const imported = importSVG(
      svg(
        definition,
        '<g data-layer="Radial" fill="url(#ramp)" fill-opacity="0.5" stroke="#abcdef" stroke-opacity="0.3" stroke-width="3"><rect width="10" height="10"/><rect x="5" width="10" height="10"/></g>',
      ),
      Parser,
    ),
    r = evaluate(imported.layers[0]);
  assert.equal(imported.layers.length, 1);
  assert.deepEqual(r.path.fill, {
    kind: 'radial-gradient',
    center: [10, 20],
    radius: 100,
    startColor: { hex: '#ff0000', alpha: 0 },
    endColor: { hex: '#123456', alpha: 0.4 },
  });
  assert.equal(r.path.stroke.alpha, 0.3);
  assert.equal(r.path.stroke.width, 3);
  assert.equal(new Set(r.path.contours.map((c) => c.group)).size, 2);
  assert.deepEqual(artwork(importSVG(exportSVG(imported), Parser)), artwork(imported));
});

test('radial import rejects unsupported focus, inner radius, units, paint servers and unsafe unused definitions', () => {
  for (const bad of [
    definition.replace('fx="10"', 'fx="11"'),
    definition.replace('fy="20"', 'fy="21"'),
    definition.replace('fr="0"', 'fr="1"'),
    definition.replace(' fx="10"', ''),
    definition.replace(' fy="20"', ''),
    definition.replace(' fr="0"', ''),
    definition.replace(' r="100"', ''),
    definition.replace(' cx="10"', ''),
    definition.replace(' cy="20"', ''),
    ...['0', '-1', '0.00001', '100001', 'NaN', '1e309', '50%', '10px'].map((r) =>
      definition.replace('r="100"', `r="${r}"`),
    ),
    definition.replace('cx="10"', 'cx="100001"').replace('fx="10"', 'fx="100001"'),
    definition.replace('userSpaceOnUse', 'objectBoundingBox'),
    definition.replace(' gradientUnits="userSpaceOnUse"', ''),
    definition.replace('spreadMethod="pad"', 'spreadMethod="reflect"'),
    definition.replace(' spreadMethod="pad"', ''),
    definition.replace('color-interpolation="sRGB"', 'color-interpolation="linearRGB"'),
    definition.replace(' color-interpolation="sRGB"', ''),
    definition.replace('offset="1"', 'offset="0.5"'),
    definition.replace('offset="1"', 'offset="100%"'),
    definition.replace('<stop offset="1" stop-color="#123456" stop-opacity="0.8"/>', ''),
    definition.replace(
      '</radialGradient>',
      '<stop offset="1" stop-color="#ffffff"/></radialGradient>',
    ),
    definition.replace('stop-opacity="0.8"', 'stop-opacity="1.1"'),
    definition.replace('stop-color="#ff0000"', 'stop-color="url(#evil)"'),
    definition.replace('<radialGradient ', '<radialGradient href="#ramp" '),
    definition.replace('<radialGradient ', '<radialGradient gradientTransform="scale(2)" '),
    definition.replace('<radialGradient ', '<radialGradient onload="alert(1)" '),
    definition.replace('<radialGradient ', '<radialGradient style="color:red" '),
    definition.replace('<stop ', '<stop onclick="alert(1)" '),
    definition.replace('</radialGradient>', '<script>alert(1)</script></radialGradient>'),
    definition + definition,
  ]) {
    assert.throws(() => importSVG(svg(bad), Parser), undefined, bad);
    assert.throws(
      () => importSVG(svg(bad, '<rect width="2" height="2"/>'), Parser),
      undefined,
      bad,
    );
  }
  for (const fill of [
    'url(#missing)',
    'url(https://example.com/a.svg#ramp)',
    'url(#ramp) red',
    "url('#ramp')",
  ])
    assert.throws(() =>
      importSVG(svg(definition, `<rect width="2" height="2" fill="${fill}"/>`), Parser),
    );
  assert.throws(() =>
    importSVG(svg(definition, '<rect width="2" height="2" stroke="url(#ramp)"/>'), Parser),
  );
});

test('editable radial sample matches committed SVG, roundtrips independent groups and exports byte-identically through CLI', () => {
  const sample = new URL('../examples/radial-gradient-fill.json', import.meta.url),
    doc = deserialize(fs.readFileSync(sample, 'utf8'));
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  assert.equal(
    fs.readFileSync(new URL('../examples/radial-gradient-fill.svg', import.meta.url), 'utf8'),
    exportSVG(doc),
  );
  assert.ok(doc.layers.some((l) => l.nodes.some((n) => n.type === 'Radial Gradient Fill')));
  const imported = importSVG(exportSVG(doc), Parser);
  assert.deepEqual(artwork(imported), artwork(doc));
  assert.deepEqual(artwork(importSVG(exportSVG(imported), Parser)), artwork(imported));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-radial-gradient-'));
  try {
    const out = path.join(temp, 'sample.svg');
    execFileSync(process.execPath, ['cli/export.js', fileURLToPath(sample), out], {
      cwd: new URL('..', import.meta.url),
    });
    assert.equal(fs.readFileSync(out, 'utf8'), exportSVG(doc));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
