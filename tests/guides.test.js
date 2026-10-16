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
  layoutGridDefaults,
  layoutGridLines,
  setLayoutGrid,
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

test('guide layers roundtrip, undo, and exclude all geometry and errors from SVG output', () => {
  const d = document(),
    original = exportSVG(d),
    h = new History(d);
  h.apply((doc) => {
    doc.layers[0].guide = true;
  });
  assert.ok(!exportSVG(h.doc).includes('<path'));
  assert.equal(deserialize(serialize(h.doc)).layers[0].guide, true);
  h.undo();
  assert.equal(exportSVG(h.doc), original);
  h.redo();
  assert.ok(!exportSVG(h.doc).includes('<path'));
  h.doc.layers[0].nodes[0].params.radius.expression = '1/0';
  assert.doesNotThrow(() => exportSVG(h.doc));
  h.doc.layers[0].guide = 'yes';
  assert.throws(() => deserialize(serialize(h.doc)), /layer state/);
});

test('layout grid creates exact margins/gutters, deduplicates shared boundaries, and updates one set atomically', () => {
  const d = project(),
    c = { columns: 3, rows: 2, marginX: 30, marginY: 20, gutterX: 15, gutterY: 10 };
  const lines = layoutGridLines(d, c);
  assert.deepEqual(
    lines.filter((g) => g.axis === 'x').map((g) => g.position),
    [30, 320, 335, 625, 640, 930],
  );
  assert.deepEqual(
    lines.filter((g) => g.axis === 'y').map((g) => g.position),
    [20, 265, 275, 520],
  );
  assert.equal(layoutGridLines(d, { ...c, gutterX: 0, gutterY: 0 }).length, 7);
  d.editor.guides.push({ id: 'manual', axis: 'x', position: 17, locked: true });
  const before = serialize(d),
    svg = exportSVG(d),
    h = new History(d);
  let count = 0;
  const id = () => `layout-${++count}`;
  h.apply((doc) => setLayoutGrid(doc, c, id));
  assert.equal(h.doc.editor.guides.length, 11);
  assert.equal(h.past.length, 1);
  assert.equal(exportSVG(h.doc), svg);
  assert.deepEqual(deserialize(serialize(h.doc)), h.doc);
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  h.apply((doc) => setLayoutGrid(doc, { ...c, columns: 4 }, id));
  assert.equal(h.doc.editor.guides.length, 13);
  assert.equal(h.doc.editor.guides[0].id, 'manual');
  h.apply((doc) => setLayoutGrid(doc, null, id));
  assert.deepEqual(h.doc.editor.guides, [{ id: 'manual', axis: 'x', position: 17, locked: true }]);
  assert.equal(h.doc.editor.layoutGrid, undefined);
  h.undo();
  assert.equal(h.doc.editor.guides.length, 13);
});

test('invalid or oversized layouts and locked generated guides fail without partial writes', () => {
  const d = project(),
    c = layoutGridDefaults();
  let count = 0;
  const id = () => `layout-${++count}`;
  for (const bad of [
    { columns: 0 },
    { rows: 1.2 },
    { columns: 41 },
    { marginX: -1 },
    { gutterY: NaN },
    { marginY: 300 },
    { gutterX: 900 },
  ]) {
    const before = serialize(d);
    assert.throws(() => setLayoutGrid(d, { ...c, ...bad }, id));
    assert.equal(serialize(d), before);
  }
  setLayoutGrid(d, c, id);
  d.editor.guides[0].locked = true;
  const before = serialize(d);
  for (const config of [null, c]) assert.throws(() => setLayoutGrid(d, config, id), /Unlock/);
  assert.equal(serialize(d), before);
  d.editor.guides[0].locked = false;
  d.editor.guides.push(
    ...Array.from({ length: 195 }, (_, i) => ({
      id: `manual-${i}`,
      axis: 'x',
      position: i,
      locked: false,
    })),
  );
  const full = serialize(d);
  assert.throws(() => setLayoutGrid(d, c, id), /Maximum/);
  assert.equal(serialize(d), full);
  const invalid = project();
  invalid.editor.layoutGrid = { ...c, rows: '3' };
  assert.throws(() => deserialize(serialize(invalid)), /integers/);
});

test('visible guide layer bounds snap edges and centers with hidden and Alt bypass', () => {
  const d = project();
  d.editor.snapGrid = false;
  d.editor.snapArtboard = false;
  const bounds = [
    [
      [10, 50, 90],
      [20, 60, 100],
    ],
  ];
  assert.deepEqual(snapTranslation(d, [[48], [98]], [0, 0], 1, false, null, bounds).delta, [2, 2]);
  assert.equal(
    snapTranslation(d, [[48], []], [0, 0], 1, false, null, bounds).matches[0].kind,
    'guide-layer',
  );
  assert.deepEqual(snapTranslation(d, [[48], [98]], [0, 0], 1, true, null, bounds).delta, [0, 0]);
  d.editor.visible = false;
  assert.deepEqual(snapTranslation(d, [[48], [98]], [0, 0], 1, false, null, bounds).delta, [0, 0]);
});
