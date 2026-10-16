import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  document,
  node,
  point,
  definitions,
  connect,
  evaluate,
  bypassContract,
  setNodeBypassed,
  setOperation,
  serialize,
  deserialize,
  validate,
  exportSVG,
  History,
  duplicateNodes,
  setTextPathAttachment,
  assertClosedOffsetChange,
  createCharacterPositions,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
const data = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const fonts = {
  default: parseFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
};
function fixture(type, painted = false) {
  const doc = document(),
    l = doc.layers[0],
    source = node(type === 'Math' ? 'Value' : type === 'Vector Math' ? 'Vector' : 'Rectangle'),
    effect = node(type),
    fill = node('Fill'),
    out = node('Output');
  fill.params.path.source = source.id;
  l.nodes = [source, fill, effect, out];
  if (['Math', 'Vector Math'].includes(type)) {
    const shape = node('Rectangle');
    l.nodes.push(shape);
    fill.params.path.source = shape.id;
  }
  l.output = out.id;
  const input = bypassContract(effect).input;
  effect.params[input].source = painted ? fill.id : source.id;
  out.params.path.source = ['Math', 'Vector Math'].includes(type) ? fill.id : effect.id;
  return { doc, l, source, effect, fill, out };
}
const supported = [
  'Boolean',
  'Join Geometry',
  'Math',
  'Vector Math',
  'Transform',
  'Path Remap',
  'Closed Path Offset',
  'Geometry Repeater',
  'Convert to Path',
  'Text to Path',
  'Fill',
  'Linear Gradient Fill',
  'Radial Gradient Fill',
  'Stroke',
];
for (const type of supported)
  test(`${type} bypass forwards its explicit compatible identity input, preserving authored state`, () => {
    const f = fixture(
      type,
      ['Fill', 'Linear Gradient Fill', 'Radial Gradient Fill', 'Stroke'].includes(type),
    );
    const before = structuredClone(f.effect),
      input = bypassContract(f.effect).input;
    setNodeBypassed(f.l, f.effect.id, true);
    const result = evaluate(f.l, fonts);
    assert.deepEqual(result.run(f.effect.id), result.run(f.effect.params[input].source));
    if (type !== 'Math')
      assert.notEqual(
        result.run(f.effect.id),
        result.run(f.effect.params[input].source),
        'object outputs are isolated clones',
      );
    setNodeBypassed(f.l, f.effect.id, false);
    assert.deepEqual(f.effect, before);
  });
// Numbers are immutable and have no distinct clone identity.
test('unsupported nodes and scalar-output Vector Math fail closed; operation changes preserve bypass state', () => {
  for (const type of Object.keys(definitions).filter((t) => !supported.includes(t))) {
    const n = node(type),
      l = { nodes: [n] };
    assert.equal(bypassContract(n).supported, false, type);
    assert.throws(() => setNodeBypassed(l, n.id, true), /identity input/);
    assert.equal(n.bypassed, undefined);
  }
  const { l, effect } = fixture('Vector Math');
  for (const operation of ['length', 'distance', 'dot']) {
    setOperation(l, effect.id, operation);
    assert.equal(bypassContract(effect).supported, false);
    assert.throws(() => setNodeBypassed(l, effect.id, true), /changes the input type/);
  }
  setOperation(l, effect.id, 'add');
  setNodeBypassed(l, effect.id, true);
  assert.throws(() => setOperation(l, effect.id, 'length'), /Restore/);
  assert.equal(effect.operation, 'add');
});
test('bypass skips broken effect parameters and secondary dependencies, then restores their errors', () => {
  for (const [type, key] of [
    ['Transform', 'scale'],
    ['Closed Path Offset', 'amount'],
    ['Fill', 'color'],
    ['Math', 'b'],
    ['Vector Math', 'b'],
  ]) {
    const { l, effect } = fixture(type);
    effect.params[key].expression = effect.params[key].type === 'Color' ? '' : 'badExpression';
    if (type === 'Fill') {
      const bad = node('Color');
      bad.params.value.value = { hex: 'bad', alpha: 1 };
      l.nodes.push(bad);
      effect.params.color.source = bad.id;
    }
    assert.throws(() => evaluate(l, fonts).run(effect.id));
    setNodeBypassed(l, effect.id, true);
    assert.doesNotThrow(() => evaluate(l, fonts).run(effect.id));
    assert.doesNotThrow(
      () => evaluate(l, fonts).run(effect.id),
      'warm cache skips ignored fields too',
    );
    setNodeBypassed(l, effect.id, false);
    assert.throws(() => evaluate(l, fonts).run(effect.id));
  }
  const { l, effect } = fixture('Boolean');
  const bad = node('Circle');
  bad.params.radius.expression = 'unknown';
  l.nodes.push(bad);
  connect(l, bad.id, effect.id, 'b');
  setNodeBypassed(l, effect.id, true);
  assert.equal(evaluate(l).error, null);
  setNodeBypassed(l, effect.id, false);
  assert.equal(evaluate(l).error, 'Expected a number');
});
test('warm/cold caches honor on/off, upstream changes, unchanged source identity, and transform handles', () => {
  const { doc, l, source, effect } = fixture('Transform');
  effect.params.offset.value = [90, 40];
  const original = evaluate(l).run(effect.id);
  setNodeBypassed(l, effect.id, true);
  doc.schemaVersion = 10;
  let result = evaluate(l);
  assert.notDeepEqual(result.run(effect.id), original);
  assert.deepEqual(result.run(effect.id), result.run(source.id));
  assert.throws(() => result.transformState(effect.id), /Restore/);
  const copied = result.run(effect.id);
  copied.contours[0].points[0].position[0] = -999;
  assert.notEqual(result.run(source.id).contours[0].points[0].position[0], -999);
  source.params.center.value = [220, 180];
  result = evaluate(l);
  assert.deepEqual(result.run(effect.id), result.run(source.id));
  assert.deepEqual(
    evaluate(deserialize(serialize(doc)).layers[0]).run(effect.id),
    result.run(effect.id),
  );
  setNodeBypassed(l, effect.id, false);
  assert.notDeepEqual(evaluate(l).run(effect.id), result.run(effect.id));
});
test('cycles, incompatible stored wires, missing identity input and unsupported serialized states cannot hide behind bypass', () => {
  const { doc, l, effect } = fixture('Transform');
  doc.schemaVersion = 10;
  setNodeBypassed(l, effect.id, true);
  assert.throws(() => connect(l, effect.id, effect.id, 'path'), /cycle/);
  const invalid = structuredClone(doc),
    copy = invalid.layers[0].nodes.find((n) => n.id === effect.id);
  copy.params.path.source = copy.id;
  assert.throws(() => validate(invalid), /cycle/);
  assert.match(evaluate(invalid.layers[0]).error, /cycle/);
  copy.params.path.source = invalid.layers[0].nodes[0].id;
  copy.params.scale.source = invalid.layers[0].nodes[0].id;
  assert.match(evaluate(invalid.layers[0]).error, /Incompatible/);
  delete effect.params.path.source;
  assert.match(evaluate(l).error, /Connect path to bypass/);
  effect.bypassed = 'yes';
  assert.throws(() => validate(doc), /boolean/);
  effect.bypassed = true;
  doc.schemaVersion = 9;
  assert.throws(() => validate(doc), /schemaVersion 10/);
  doc.schemaVersion = 10;
  delete effect.bypassed;
  l.nodes[0].bypassed = true;
  assert.throws(() => validate(doc), /Cannot bypass/);
});
test('paint bypass retains prior gradient, alpha and stroke; unpainted geometry gains no paint', () => {
  const { doc, l, source, effect, fill, out } = fixture('Stroke', true);
  fill.params.color.value = { hex: '#123456', alpha: 0.35 };
  effect.params.color.value = { hex: '#abcdef', alpha: 0.6 };
  effect.params.width.value = 12;
  const normal = exportSVG(doc);
  setNodeBypassed(l, effect.id, true);
  doc.schemaVersion = 10;
  assert.deepEqual(evaluate(l).run(effect.id), evaluate(l).run(fill.id));
  assert.notEqual(exportSVG(doc), normal);
  setNodeBypassed(l, fill.id, true);
  assert.deepEqual(evaluate(l).run(effect.id), evaluate(l).run(source.id));
  assert.match(exportSVG(doc), /fill="none"/);
  const gradient = node('Linear Gradient Fill');
  l.nodes.push(gradient);
  connect(l, source.id, gradient.id, 'path');
  connect(l, gradient.id, effect.id, 'path');
  assert.deepEqual(evaluate(l).run(effect.id), evaluate(l).run(gradient.id));
  assert.match(exportSVG(doc), /linearGradient/);
  assert.equal(out.params.path.source, effect.id);
});
test('bypass forwards exact character provenance and removes only the disabled effect transform', () => {
  const { l, source, effect } = fixture('Transform');
  const text = node('Text');
  text.text = 'AV';
  text.characterPositions = createCharacterPositions(text.text);
  l.nodes[l.nodes.indexOf(source)] = text;
  effect.params.path.source = text.id;
  l.nodes.find((n) => n.type === 'Fill').params.path.source = text.id;
  effect.params.scale.value = 2;
  effect.params.offset.value = [120, 70];
  const transformed = evaluate(l, fonts).run(effect.id).characterOccurrences;
  setNodeBypassed(l, effect.id, true);
  const result = evaluate(l, fonts);
  assert.deepEqual(
    result.run(effect.id).characterOccurrences,
    result.run(text.id).characterOccurrences,
  );
  assert.notDeepEqual(result.run(effect.id).characterOccurrences, transformed);
});
test('history, JSON, locks and no-op preserve all connections/settings and existing document shape', () => {
  const { doc, l, effect } = fixture('Transform'),
    history = new History(doc);
  const original = serialize(doc);
  history.apply(() => {
    setNodeBypassed(l, effect.id, true);
    doc.schemaVersion = 10;
  });
  const bypassed = serialize(history.doc);
  history.apply(() => setNodeBypassed(l, effect.id, true));
  assert.equal(history.past.length, 1);
  history.undo();
  assert.equal(serialize(history.doc), original);
  history.redo();
  assert.equal(serialize(history.doc), bypassed);
  assert.equal(serialize(deserialize(bypassed)), bypassed);
  history.doc.layers[0].locked = true;
  assert.throws(() => setNodeBypassed(history.doc.layers[0], effect.id, false), /locked/);
});
test('bypassed A-route Type on Path duplication remaps source contour identities without changing originals', () => {
  const doc = document(),
    l = doc.layers[0],
    curve = node('Curve'),
    join = node('Join Geometry'),
    text = node('Text'),
    fill = node('Fill'),
    out = node('Output');
  curve.points = [point(0, 200), point(1000, 200)];
  curve.params.closed.value = false;
  text.text = 'AV';
  text.params.size.value = 30;
  l.nodes = [curve, join, text, fill, out];
  l.output = out.id;
  connect(l, curve.id, join.id, 'a');
  setNodeBypassed(l, join.id, true);
  connect(l, text.id, fill.id, 'path');
  connect(l, fill.id, out.id, 'path');
  setTextPathAttachment(
    l,
    text.id,
    {
      nodeId: join.id,
      contourId: curve.id,
      start: 0,
      startMode: 'distance',
      reversed: false,
    },
    fonts,
  );
  doc.schemaVersion = 10;
  const before = structuredClone(l);
  const copies = duplicateNodes(l, [curve.id, join.id, text.id]);
  const copiedText = copies.find((n) => n.type === 'Text'),
    copiedCurve = copies.find((n) => n.type === 'Curve');
  assert.equal(copiedText.pathAttachment.contourId, copiedCurve.id);
  assert.equal(text.pathAttachment.contourId, curve.id);
  assert.doesNotThrow(() => assertClosedOffsetChange(l, before, fonts));
  assert.doesNotThrow(() => evaluate(l, fonts).run(copiedText.id));
  assert.doesNotThrow(() => validate(doc));
});
test('downstream Offset provenance ignores bypassed B but detects equal-geometry identity substitution and restore', () => {
  const { l, source, effect, out } = fixture('Join Geometry');
  const b = node('Rectangle'),
    offset = node('Closed Path Offset');
  l.nodes.push(b, offset);
  connect(l, b.id, effect.id, 'b');
  connect(l, effect.id, offset.id, 'path');
  connect(l, offset.id, out.id, 'path');
  setNodeBypassed(l, effect.id, true);
  const original = evaluate(l).run(offset.id);
  b.params.center.value = [0, 0];
  assert.deepEqual(
    evaluate(l).run(offset.id),
    original,
    'ignored secondary computation and provenance stay inactive',
  );
  b.params.center.value = [...source.params.center.value];
  b.params.size.value = [...source.params.size.value];
  connect(l, b.id, effect.id, 'a');
  const substituted = evaluate(l).run(offset.id);
  assert.notEqual(
    substituted.fingerprint,
    original.fingerprint,
    'same coordinates from a different source retain distinct provenance',
  );
  assert.deepEqual(substituted.contours, original.contours);
  // A zero-effect Transform still changes identity routing when bypass is restored.
  const transform = node('Transform');
  l.nodes.push(transform);
  connect(l, source.id, transform.id, 'path');
  connect(l, transform.id, offset.id, 'path');
  const enabled = evaluate(l).run(offset.id);
  setNodeBypassed(l, transform.id, true);
  const bypassed = evaluate(l).run(offset.id);
  assert.deepEqual(bypassed.contours, enabled.contours);
  assert.notEqual(bypassed.fingerprint, enabled.fingerprint);
  setNodeBypassed(l, transform.id, false);
  assert.deepEqual(evaluate(l).run(offset.id), enabled);
});
