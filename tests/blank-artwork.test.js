import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  layer,
  blankDocument,
  blankLayer,
  hasEmptyOutput,
  node,
  point,
  connect,
  disconnect,
  evaluate,
  exportSVG,
  exportScene,
  renderElement,
  serialize,
  deserialize,
  validate,
  History,
} from '../src/core.js';
import {
  appendArtwork,
  appendBlankComposition,
  createPenArtworkDraft,
  appendPenArtwork,
} from '../src/artwork-creation.js';
const oldDoc = () => {
  const d = document();
  d.layers[0].locked = true;
  d.layers[0].visible = false;
  d.layers[0].nodes[0].params.radius.expression = '100 + 20';
  d.layers[0].nodes.at(-1).params.path.locked = true;
  d.imageAssets = {
    'image-preserved': {
      name: 'Reference',
      mime: 'image/png',
      width: 1,
      height: 1,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    },
  };
  return d;
};
test('blank factories keep the existing demo/model contract and create only one intentional Output', () => {
  assert.equal(document().layers[0].nodes.length, 6);
  assert.equal(layer().nodes.length, 6);
  const d = blankDocument(),
    l = d.layers[0],
    out = l.nodes[0];
  assert.equal(d.schemaVersion, 2);
  assert.equal(d.layers.length, 1);
  assert.equal(l.allowEmptyOutput, true);
  assert.equal(l.nodes.length, 1);
  assert.equal(out.type, 'Output');
  assert.equal(l.output, out.id);
  assert.equal(out.params.path.value, null);
  assert.equal(out.params.path.source, undefined);
  assert.equal(hasEmptyOutput(l), true);
  const before = serialize(d);
  assert.doesNotThrow(() => validate(d));
  assert.equal(serialize(d), before);
  assert.deepEqual(evaluate(l).path, { contours: [] });
  assert.equal(evaluate(l).error, null);
  assert.equal(serialize(deserialize(before)), before);
});
test('empty-output exemption is explicit, terminal, vector-only and cache-sensitive', () => {
  const l = blankLayer(),
    out = l.nodes[0];
  assert.equal(evaluate(l).error, null);
  delete l.allowEmptyOutput;
  assert.equal(hasEmptyOutput(l), false);
  assert.match(evaluate(l).error, /Connect a PaintedPath/);
  l.allowEmptyOutput = false;
  assert.match(evaluate(l).error, /Connect a PaintedPath/);
  l.allowEmptyOutput = true;
  assert.equal(evaluate(l).error, null);
  const other = node('Output');
  l.nodes.push(other);
  l.output = other.id;
  const r = evaluate(l);
  assert.equal(r.error, null);
  assert.throws(() => r.run(out.id), /Connect a PaintedPath/);
  l.output = out.id;
  assert.equal(evaluate(l).error, null);
  out.params.path.expression = 'missing_path_expression';
  assert.equal(hasEmptyOutput(l), false);
  assert.ok(evaluate(l).error);
  out.params.path.expression = '';
  out.params.path.sourcePort = 'position';
  assert.equal(hasEmptyOutput(l), false);
  assert.ok(evaluate(l).error);
});
test('empty permission never hides missing, wrong-type or disconnected reachable graph inputs', () => {
  const d = blankDocument(),
    l = d.layers[0],
    out = l.nodes[0],
    fill = node('Fill'),
    shape = node('Rectangle');
  l.nodes.push(fill, shape);
  connect(l, fill.id, out.id, 'path');
  assert.equal(hasEmptyOutput(l), false);
  assert.match(evaluate(l).error, /Connect a PaintedPath/);
  connect(l, shape.id, fill.id, 'path');
  assert.equal(evaluate(l).error, null);
  disconnect(out, 'path');
  assert.deepEqual(evaluate(l).path, { contours: [] });
  assert.throws(() => evaluate(l).run(fill.id + '-missing'), /Missing/);
  out.params.path.source = 'node-missing';
  assert.ok(evaluate(l).error);
  assert.throws(() => validate(d));
  out.params.path.source = shape.id;
  assert.ok(evaluate(l).error === null, 'Path is intentionally compatible with painted path');
  const value = node('Value');
  l.nodes.push(value);
  out.params.path.source = value.id;
  assert.match(evaluate(l).error, /Incompatible/);
  assert.throws(() => validate(d), /Cannot connect/);
});
test('malformed opt-ins and Image Output opt-ins reject rather than creating silent blanks', () => {
  for (const bad of [null, 0, 1, 'true', {}, []]) {
    const d = blankDocument();
    d.layers[0].allowEmptyOutput = bad;
    assert.throws(() => deserialize(serialize(d)), /Invalid layer state/);
  }
  const d = blankDocument(),
    l = d.layers[0],
    out = node('Image Output');
  l.nodes = [out];
  l.output = out.id;
  assert.equal(hasEmptyOutput(l), false);
  assert.match(evaluate(l).error, /Connect a Image/);
  assert.throws(() => validate(d), /vector Output/);
  l.allowEmptyOutput = false;
  assert.doesNotThrow(() => validate(d));
});
test('empty scenes export the exact transparent artboard without phantom path/group/paint elements', () => {
  const d = blankDocument(),
    scene = exportScene(d);
  assert.equal(scene.length, 1);
  assert.deepEqual(scene[0].value, { contours: [] });
  assert.equal(renderElement(scene[0].value, d.layers[0]), '');
  assert.equal(
    exportSVG(d),
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"></svg>',
  );
  const malformed = { contours: [], fill: { hex: 'invalid', alpha: 1 } };
  assert.throws(
    () => renderElement(malformed, d.layers[0]),
    /Color/,
    'empty geometry does not suppress paint validation',
  );
});
test('append blank preserves every existing object, output, lock and asset and commits one history unit', () => {
  const d = oldDoc(),
    before = serialize(d),
    old = d.layers[0],
    asset = d.imageAssets['image-preserved'],
    nodes = [...old.nodes],
    ids = appendBlankComposition(d, { name: 'Blank work' }),
    l = d.layers.at(-1);
  assert.equal(serialize({ ...d, layers: d.layers.slice(0, -1) }), before);
  assert.strictEqual(d.layers[0], old);
  assert.strictEqual(d.imageAssets['image-preserved'], asset);
  assert.equal(Object.isFrozen(asset), false);
  assert.ok(nodes.every((n, i) => n === old.nodes[i]));
  assert.equal(l.name, 'Blank work');
  assert.equal(l.visible, true);
  assert.equal(l.locked, false);
  assert.equal(l.nodes.length, 1);
  assert.equal(l.output, ids.nodeId);
  assert.equal(l.id, ids.layerId);
  const h = new History(oldDoc()),
    original = serialize(h.doc);
  h.apply((d) => appendBlankComposition(d));
  const after = serialize(h.doc);
  assert.equal(h.past.length, 1);
  h.undo();
  assert.equal(serialize(h.doc), original);
  h.redo();
  assert.equal(serialize(h.doc), after);
});
test('blank append checks capacity, invalid existing graphs, names and duplicate IDs atomically', () => {
  const d = oldDoc();
  while (d.layers.length < 99) appendBlankComposition(d);
  appendBlankComposition(d);
  const before = serialize(d);
  assert.equal(d.layers.length, 100);
  assert.throws(() => appendBlankComposition(d), /100/);
  assert.equal(serialize(d), before);
  for (const breakDoc of [
    (q) => {
      q.width = 0;
    },
    (q) => {
      q.layers[0].output = 'missing';
    },
  ]) {
    const q = oldDoc();
    breakDoc(q);
    const before = serialize(q);
    assert.throws(() => appendBlankComposition(q));
    assert.equal(serialize(q), before);
  }
  for (const name of [null, 3, {}, 'a'.repeat(100001)]) {
    const q = oldDoc(),
      before = serialize(q);
    assert.throws(() => appendBlankComposition(q, { name }));
    assert.equal(serialize(q), before);
  }
  const q = oldDoc(),
    original = serialize(q),
    uuid = mock.method(globalThis.crypto, 'randomUUID', () => q.layers[0].nodes[0].id.slice(5));
  try {
    assert.throws(() => appendBlankComposition(q), /duplicate ID/);
    assert.equal(serialize(q), original);
  } finally {
    uuid.mock.restore();
  }
});
test('blank and independent shapes/Pen coexist, round-trip, export and Undo without demo insertion', () => {
  const h = new History(blankDocument()),
    before = serialize(h.doc);
  for (const type of ['Circle', 'Rectangle', 'Polygon', 'Star'])
    h.apply((d) => appendArtwork(d, type, { at: [200, 200] }));
  const draft = createPenArtworkDraft(h.doc, [300, 100]);
  draft.nodes[0].points.push(point(420, 200), point(350, 300));
  draft.nodes[0].params.closed.value = true;
  h.apply((d) => appendPenArtwork(d, draft));
  const after = serialize(h.doc),
    svg = exportSVG(h.doc);
  assert.equal((svg.match(/<path /g) || []).length, 5);
  assert.equal(h.doc.layers[0].nodes.length, 1);
  assert.equal(serialize(deserialize(after)), after);
  for (let i = 0; i < 5; i++) h.undo();
  assert.equal(serialize(h.doc), before);
  for (let i = 0; i < 5; i++) h.redo();
  assert.equal(serialize(h.doc), after);
  assert.equal(exportSVG(h.doc), svg);
});
