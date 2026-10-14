import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  document,
  node,
  connect,
  evaluate,
  validate,
  serialize,
  deserialize,
  exportSVG,
  parseStrokeDash,
  History,
} from '../src/core.js';
import { importSVG } from '../src/svg-import.js';
function scene() {
  const doc = document(),
    l = doc.layers[0],
    curve = node('Curve'),
    s = node('Stroke'),
    out = node('Output');
  curve.params.closed.value = false;
  l.nodes = [curve, s, out];
  l.output = out.id;
  connect(l, curve.id, s.id, 'path');
  connect(l, s.id, out.id, 'path');
  return { doc, l, s };
}
test('stroke cap, join, dash, miter and offset render and roundtrip inherited SVG', () => {
  const { doc, l, s } = scene();
  s.strokeCap = 'round';
  s.strokeJoin = 'bevel';
  s.strokeDash = [12, 3, 0];
  s.params.miterLimit.value = 8;
  s.params.dashOffset.value = -7;
  const paint = evaluate(l).path.stroke;
  assert.deepEqual(paint.dash, [12, 3, 0]);
  const svg = exportSVG(doc);
  assert.match(
    svg,
    /stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="8" stroke-dasharray="12 3 0" stroke-dashoffset="-7"/,
  );
  const imported = importSVG(svg, new Window().DOMParser);
  assert.deepEqual(evaluate(imported.layers[0]).path.stroke, paint);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const inherited = importSVG(
    '<svg width="100" height="100" fill="none" stroke="red" stroke-linecap="square" stroke-linejoin="round" stroke-miterlimit="6" stroke-dasharray="2px,3,4" stroke-dashoffset="-5px"><g><path d="M0 0L100 0"/><path d="M0 20L100 20" stroke-dasharray="none" stroke-linecap="butt"/></g></svg>',
    new Window().DOMParser,
  );
  assert.deepEqual(evaluate(inherited.layers[0]).path.stroke, {
    hex: '#ff0000',
    alpha: 1,
    width: 1,
    cap: 'square',
    join: 'round',
    dash: [2, 3, 4],
    miterLimit: 6,
    dashOffset: -5,
  });
  assert.deepEqual(evaluate(inherited.layers[1]).path.stroke.dash, []);
  assert.equal(evaluate(inherited.layers[1]).path.stroke.cap, 'butt');
});
test('legacy Stroke defaults migrate without losing paint, locks, history or numeric connections', () => {
  const { doc, l, s } = scene();
  delete s.params.miterLimit;
  delete s.params.dashOffset;
  validate(doc);
  assert.equal(s.params.miterLimit.value, 4);
  assert.equal(s.params.dashOffset.value, 0);
  assert.equal(evaluate(l).path.stroke.cap, 'butt');
  const v = node('Value');
  v.params.value.value = -12;
  l.nodes.push(v);
  connect(l, v.id, s.id, 'dashOffset');
  assert.equal(evaluate(l).path.stroke.dashOffset, -12);
  s.params.dashOffset.locked = true;
  assert.throws(() => connect(l, v.id, s.id, 'dashOffset'), /locked/);
  const h = new History(doc);
  h.apply(() => {
    s.strokeCap = 'round';
    s.strokeDash = [0, 0];
  });
  assert.match(exportSVG(doc), /stroke-dasharray="0 0"/);
  h.undo();
  assert.equal(evaluate(h.doc.layers[0]).path.stroke.cap, 'butt');
  h.redo();
  assert.equal(evaluate(h.doc.layers[0]).path.stroke.cap, 'round');
});
test('invalid stroke styles reject strict SVG, JSON and runtime values before export', () => {
  for (const value of [
    '-1 2',
    '2% 3',
    '1,,2',
    '1,',
    ',1',
    '1e999',
    'NaN',
    'Infinity',
    '1 '.repeat(33),
    '100001',
  ])
    assert.throws(() => parseStrokeDash(value), /Dash|dash/);
  assert.deepEqual(parseStrokeDash(''), []);
  assert.deepEqual(parseStrokeDash('none'), []);
  assert.deepEqual(parseStrokeDash('0 10 5'), [0, 10, 5]);
  for (const attr of [
    'stroke-linecap="triangle"',
    'stroke-linejoin="arcs"',
    'stroke-miterlimit="0"',
    'stroke-miterlimit="4px"',
    'stroke-dasharray="3 -1"',
    'stroke-dashoffset="2%"',
    'stroke-dashoffset="100001"',
  ])
    assert.throws(() =>
      importSVG(`<svg><path d="M0 0L10 0" ${attr}/></svg>`, new Window().DOMParser),
    );
  const { doc, l, s } = scene();
  s.strokeCap = '"/><script>';
  assert.throws(() => validate(doc), /cap/);
  assert.match(evaluate(l).error, /cap/);
  assert.throws(() => exportSVG(doc));
  delete s.strokeCap;
  s.params.miterLimit.value = 0.5;
  assert.throws(() => validate(doc), /miter/);
  assert.match(evaluate(l).error, /Miter/);
  s.params.miterLimit.value = 4;
  s.params.dashOffset.expression = '100001';
  assert.match(evaluate(l).error, /offset/);
});
