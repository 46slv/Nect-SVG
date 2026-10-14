import test from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  guideDefaults,
  guideSettings,
  snapTranslation,
  serialize,
  deserialize,
  exportSVG,
  History,
  pathBounds,
  evaluate,
} from '../src/core.js';
const project = () => {
  const doc = document();
  doc.editor = guideDefaults();
  doc.editor.snap = true;
  return doc;
};
test('editing aids roundtrip and undo without changing SVG or old schema-v1 documents', () => {
  const doc = document(),
    svg = exportSVG(doc),
    old = serialize(doc);
  assert.equal(guideSettings(deserialize(old)).gridSize, 8);
  assert.equal(guideSettings(deserialize(old)).snap, false);
  assert.equal(serialize(deserialize(old)), old);
  const h = new History(doc);
  h.apply((d) => {
    d.editor = guideDefaults();
    d.editor.guides.push({ id: 'guide-test', axis: 'x', position: 123.5, locked: true });
    d.editor.gridVisible = true;
  });
  assert.equal(exportSVG(h.doc), svg);
  assert.deepEqual(deserialize(serialize(h.doc)), h.doc);
  h.undo();
  assert.equal(serialize(h.doc), old);
  h.redo();
  assert.equal(h.doc.editor.guides[0].position, 123.5);
});
test('invalid guides, duplicate IDs, excessive counts and unsafe settings reject on load', () => {
  for (const change of [
    (e) => e.guides.push({ id: 'guide-a', axis: 'z', position: 10, locked: false }),
    (e) => e.guides.push({ id: 'guide-a', axis: 'x', position: 100001, locked: false }),
    (e) => e.guides.push({ id: 'guide-a', axis: 'x', position: null, locked: false }),
    (e) =>
      e.guides.push(
        ...Array.from({ length: 201 }, (_, i) => ({
          id: `g-${i}`,
          axis: 'x',
          position: 10,
          locked: false,
        })),
      ),
    (e) => (e.gridSize = 0),
    (e) => (e.snap = 'yes'),
    (e) => (e.guides = {}),
  ]) {
    const d = project();
    change(d.editor);
    assert.throws(() => deserialize(serialize(d)));
  }
  const d = project();
  d.editor.guides.push({ id: d.layers[0].id, axis: 'x', position: 0, locked: false });
  assert.throws(() => deserialize(serialize(d)), /duplicate/);
});
test('snapping is screen-pixel bounded at different zooms, with Alt and master bypass', () => {
  const d = project();
  d.editor.snapGrid = false;
  d.editor.snapArtboard = false;
  d.editor.guides.push({ id: 'guide-a', axis: 'x', position: 100, locked: false });
  for (const scale of [0.25, 1, 4]) {
    assert.equal(snapTranslation(d, [[100 - 5 / scale], []], [0, 0], scale).delta[0], 5 / scale);
    assert.equal(snapTranslation(d, [[100 - 7 / scale], []], [0, 0], scale).delta[0], 0);
  }
  assert.deepEqual(snapTranslation(d, [[99], []], [0, 0], 1, true).matches, []);
  d.editor.snap = false;
  assert.deepEqual(snapTranslation(d, [[99], []], [0, 0]).matches, []);
});
test('visible locked guides snap, hidden guides do not, dragged guide excludes itself', () => {
  const d = project();
  d.editor.snapGrid = false;
  d.editor.snapArtboard = false;
  d.editor.guides.push({ id: 'guide-a', axis: 'x', position: 100, locked: true });
  assert.equal(snapTranslation(d, [[98], []], [0, 0]).delta[0], 2);
  d.editor.locked = true;
  assert.equal(snapTranslation(d, [[98], []], [0, 0]).delta[0], 2);
  assert.equal(snapTranslation(d, [[98], []], [0, 0], 1, false, 'guide-a').matches.length, 0);
  d.editor.visible = false;
  assert.equal(snapTranslation(d, [[98], []], [0, 0]).matches.length, 0);
});
test('artboard edges/center and grid apply a rigid selection translation with explicit target priority', () => {
  const d = project();
  d.editor.snapGrid = false;
  for (const position of [0, 480, 960])
    assert.equal(snapTranslation(d, [[position - 4], []], [0, 0]).delta[0], 4);
  d.editor.snapArtboard = false;
  d.editor.guides.push({ id: 'guide-a', axis: 'x', position: 103, locked: false });
  d.editor.snapGrid = true;
  assert.equal(snapTranslation(d, [[100], []], [0, 0]).delta[0], 3);
  d.editor.snapGuides = false;
  assert.equal(snapTranslation(d, [[100], []], [0, 0]).delta[0], 4);
  const b = pathBounds(evaluate(d.layers[0]).run(d.layers[0].nodes[0].id));
  assert.deepEqual(b, [
    [230, 350, 470],
    [130, 250, 370],
  ]);
  d.editor.snapGrid = false;
  d.editor.snapArtboard = true;
  assert.equal(snapTranslation(d, b, [8, 0]).delta[0], 10); // right edge to 480, not mouse grab point
});
