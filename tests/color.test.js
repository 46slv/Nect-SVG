import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  document,
  node,
  evaluate,
  outputType,
  connect,
  disconnect,
  validate,
  serialize,
  deserialize,
  exportSVG,
  History,
} from '../src/core.js';
import { importSVG } from '../src/svg-import.js';

function setup() {
  const doc = document(),
    layer = doc.layers[0],
    color = node('Color');
  layer.nodes.push(color);
  const output = layer.nodes.find((n) => n.type === 'Fill');
  return { doc, layer, color, output };
}
test('Color is a separate validated type; only matching sockets connect', () => {
  const { doc, layer, color, output } = setup();
  assert.equal(outputType(color), 'Color');
  for (const target of [node('Vector'), node('Value'), node('Toggle')]) {
    layer.nodes.push(target);
    assert.throws(() => connect(layer, color.id, target.id, 'value'), /Cannot connect Color/);
    assert.throws(() => connect(layer, target.id, output.id, 'color'), /to Color/);
  }
  assert.throws(() => connect(layer, color.id, output.id, 'path'), /to PaintedPath/);
  assert.throws(() => connect(layer, layer.nodes[0].id, output.id, 'color'), /to Color/);
  connect(layer, color.id, output.id, 'color');
  validate(doc);
  for (const value of [
    null,
    '#112233',
    [1, 0, 0, 1],
    { hex: 'red', alpha: 1 },
    { hex: '#112233', alpha: -1 },
    { hex: '#112233', alpha: 1.01 },
    { hex: '#112233', alpha: NaN },
    { hex: '#112233', alpha: '0.5' },
    { hex: '#112233', alpha: 1, extra: true },
  ]) {
    color.params.value.value = value;
    assert.throws(() => validate(doc), /Expected Color/);
    assert.match(evaluate(layer).error, /Expected Color/);
  }
});
test('Color source takes precedence, disconnect restores fallback, and layer fill stays live', () => {
  const { layer, color, output } = setup();
  output.params.color.value = null;
  layer.fill = '#112233';
  assert.deepEqual(evaluate(layer).path.fill, { hex: '#112233', alpha: 1 });
  layer.fill = '#445566';
  assert.deepEqual(evaluate(layer).path.fill, { hex: '#445566', alpha: 1 });
  output.params.color.value = { hex: '#778899', alpha: 0.25 };
  color.params.value.value = { hex: '#ff0000', alpha: 0.5 };
  connect(layer, color.id, output.id, 'color');
  assert.deepEqual(evaluate(layer).path.fill, color.params.value.value);
  color.params.value.value.alpha = 0;
  assert.equal(evaluate(layer).path.fill.alpha, 0);
  disconnect(output, 'color');
  assert.deepEqual(evaluate(layer).path.fill, { hex: '#778899', alpha: 0.25 });
  output.params.color.value = null;
  assert.deepEqual(evaluate(layer).path.fill, { hex: '#445566', alpha: 1 });
});
test('Color chaining, cycle and lock rejection preserve graph', () => {
  const { doc, layer, color, output } = setup();
  const other = node('Color');
  layer.nodes.push(other);
  connect(layer, color.id, other.id, 'value');
  connect(layer, other.id, output.id, 'color');
  assert.deepEqual(evaluate(layer).path.fill, color.params.value.value);
  assert.throws(() => connect(layer, other.id, color.id, 'value'), /cycle/);
  assert.equal(color.params.value.source, undefined);
  output.params.color.locked = true;
  assert.throws(() => disconnect(output, 'color'), /locked/);
  assert.throws(() => connect(layer, color.id, output.id, 'color'), /locked/);
  assert.doesNotThrow(() => deserialize(serialize(doc)));
  color.params.value.expression = '1';
  assert.throws(() => validate(doc), /Color expressions/);
});
test('Color JSON and history preserve definitions; legacy v1 layer fill migrates without changing appearance', () => {
  const { doc, layer, color, output } = setup();
  const h = new History(doc);
  h.apply(() => {
    color.params.value.value = { hex: '#abcdef', alpha: 0.3 };
    connect(layer, color.id, output.id, 'color');
  });
  const saved = serialize(h.doc);
  assert.equal(serialize(deserialize(saved)), saved);
  h.undo();
  assert.equal(
    h.doc.layers[0].nodes.find((n) => n.id === output.id).params.color.source,
    undefined,
  );
  h.redo();
  assert.equal(serialize(h.doc), saved);
  const malformed = structuredClone(doc);
  malformed.layers[0].nodes.find((n) => n.id === output.id).params.color.source = layer.nodes[0].id;
  assert.throws(() => deserialize(JSON.stringify(malformed)), /to Color/);
});
test('SVG color and alpha roundtrip, inherited fill-opacity, and unsupported opacity rejection', () => {
  const { doc, layer, color, output } = setup();
  color.params.value.value = { hex: '#20c060', alpha: 0.375 };
  connect(layer, color.id, output.id, 'color');
  const svg = exportSVG(doc),
    Parser = new Window().DOMParser;
  assert.match(svg, /fill="#20c060" fill-opacity="0.375"/);
  const reopened = importSVG(svg, Parser);
  assert.deepEqual(evaluate(reopened.layers[0]).path.fill, color.params.value.value);
  const inherited = importSVG(
    '<svg fill="#112233" fill-opacity="0.25"><g><rect width="20" height="20"/><rect width="10" height="10" fill-opacity="0"/></g></svg>',
    Parser,
  );
  assert.deepEqual(
    inherited.layers.map((l) => evaluate(l).path.fill.alpha),
    [0.25, 0],
  );
  for (const attr of [
    'opacity="0.5"',
    'fill-opacity="NaN"',
    'fill-opacity="-1"',
    'fill-opacity="1.1"',
    'fill-opacity="50%"',
    'fill-opacity="0.5px"',
  ])
    assert.throws(() => importSVG(`<svg><rect width="20" height="20" ${attr}/></svg>`, Parser));
});
