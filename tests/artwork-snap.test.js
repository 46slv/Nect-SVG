import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  document,
  layer,
  node,
  connect,
  evaluate,
  pathBounds,
  guideDefaults,
  collectSnapLayerBounds,
  snapTranslation,
  serialize,
  deserialize,
  exportSVG,
  History,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
const fontBytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const font = parseFont(
  fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
);
const image = {
  name: 'red.png',
  mime: 'image/png',
  width: 1,
  height: 1,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
};
function project() {
  const doc = document();
  doc.editor = {
    ...guideDefaults(),
    snap: true,
    snapArtwork: true,
    snapArtboard: false,
    snapGrid: false,
  };
  return doc;
}
function target(doc, type = 'Rectangle') {
  const l = layer(type),
    n = node(type),
    out = node(type === 'Image' ? 'Image Output' : 'Output');
  l.nodes = [n, out];
  l.output = out.id;
  if (type === 'Image') {
    n.asset = 'image-test';
    doc.imageAssets = { 'image-test': image };
    n.params.position.value = [40, 70];
    n.params.size.value = [160, 80];
  }
  connect(l, n.id, out.id, 'path');
  doc.layers.push(l);
  return { l, n, out };
}
const collect = (doc, bounds = pathBounds) =>
  collectSnapLayerBounds(
    doc,
    doc.layers.map((l) => [l, evaluate(l, { default: font }, doc.imageAssets)]),
    doc.layers[0].id,
    bounds,
  );
const snap = (doc, sources, targets, delta = [0, 0], scale = 1, bypass = false) =>
  snapTranslation(doc, sources, delta, scale, bypass, null, targets.guides, targets.artwork);

test('artwork setting is opt-in, old JSON stays unchanged, validates and undoes independently of artwork', () => {
  const d = document();
  d.editor = guideDefaults();
  delete d.editor.snapArtwork;
  const old = serialize(d),
    svg = exportSVG(d);
  assert.equal(serialize(deserialize(old)), old);
  assert.equal(guideDefaults().snapArtwork, false);
  const h = new History(d);
  h.apply((doc) => {
    doc.editor.snapArtwork = true;
  });
  assert.equal(exportSVG(h.doc), svg);
  assert.deepEqual(deserialize(serialize(h.doc)), h.doc);
  h.undo();
  assert.equal(serialize(h.doc), old);
  h.redo();
  assert.equal(h.doc.editor.snapArtwork, true);
  for (const value of ['true', 1, null, []]) {
    d.editor.snapArtwork = value;
    assert.throws(() => deserialize(serialize(d)), /artwork snap/);
  }
});

test('regular shape, actual text outlines and image bounds expose both edges and center', () => {
  for (const type of ['Rectangle', 'Text', 'Image']) {
    const d = project(),
      { l } = target(d, type),
      collected = collect(d);
    assert.equal(collected.artwork.length, 1);
    const b = pathBounds(evaluate(l, { default: font }, d.imageAssets).path);
    assert.deepEqual(collected.artwork[0], b);
    for (let i = 0; i < 3; i++) {
      const result = snap(d, [[b[0][i] - 3], [b[1][i] + 4]], collected);
      assert.deepEqual(result.delta, [3, -4]);
      assert.deepEqual(
        result.matches.map((m) => m.kind),
        ['artwork', 'artwork'],
      );
    }
  }
});

test('targets use final evaluated Transform bounds, not raw generator parameters or stroke width', () => {
  const d = project(),
    { l, n, out } = target(d),
    transform = node('Transform'),
    stroke = node('Stroke');
  transform.params.scale.value = 1.5;
  transform.params.rotation.value = 37;
  transform.params.offset.value = [91, 17];
  stroke.params.width.value = 80;
  l.nodes.push(transform, stroke);
  connect(l, n.id, transform.id, 'path');
  connect(l, transform.id, stroke.id, 'path');
  connect(l, stroke.id, out.id, 'path');
  const r = evaluate(l),
    collected = collect(d);
  assert.deepEqual(collected.artwork[0], pathBounds(r.path));
  assert.notDeepEqual(collected.artwork[0], pathBounds(r.run(n.id)));
  stroke.params.width.value = 1;
  assert.deepEqual(collect(d).artwork, collected.artwork);
});

test('active layer and all its driven followers never target themselves; hidden/error/empty outputs are skipped, locked targets remain', () => {
  const d = project(),
    active = d.layers[0],
    controller = node('Null');
  active.nodes.push(controller);
  connect(active, controller.id, active.nodes[0].id, 'center');
  assert.deepEqual(collect(d), { guides: [], artwork: [] });
  const { l, n } = target(d);
  l.locked = true;
  assert.equal(collect(d).artwork.length, 1);
  l.visible = false;
  assert.equal(collect(d).artwork.length, 0);
  l.visible = true;
  n.params.size.expression = '1/0; 10';
  assert.equal(collect(d).artwork.length, 0);
  n.params.size.expression = '';
  l.nodes.find((x) => x.id === l.output).params.path.source = undefined;
  assert.equal(collect(d).artwork.length, 0);
});

test('guide layers remain export-excluded guide targets and hide independently of regular artwork', () => {
  const d = project(),
    { l } = target(d),
    { l: artwork } = target(d, 'Image');
  l.guide = true;
  assert.equal(collect(d).guides.length, 1);
  assert.equal(collect(d).artwork.length, 1);
  d.editor.visible = false;
  assert.equal(collect(d).guides.length, 0);
  assert.equal(collect(d).artwork.length, 1);
  d.editor.snapArtwork = false;
  assert.equal(collect(d).artwork.length, 0);
  assert.equal(artwork.visible, true);
  d.editor.visible = true;
  d.editor.snapGuides = false;
  assert.equal(collect(d).guides.length, 0);
});

test('suspended text, malformed nonfinite bounds and disabled snapping do not enter targets', () => {
  const d = project(),
    { l } = target(d),
    path = evaluate(l).path;
  const run = (p) =>
    collectSnapLayerBounds(d, [[l, { path: p, error: null }]], d.layers[0].id, pathBounds);
  assert.deepEqual(run({ ...path, characterOccurrences: [{ suspended: true }] }).artwork, []);
  assert.deepEqual(
    collect(d, () => [
      [NaN, 1, 2],
      [1, 2, 3],
    ]).artwork,
    [],
  );
  let calls = 0;
  d.editor.snap = false;
  assert.deepEqual(
    collect(d, (p) => {
      calls++;
      return pathBounds(p);
    }),
    { guides: [], artwork: [] },
  );
  assert.equal(calls, 0);
});

test('six screen pixels, Alt, exact-source translation and independent axes remain unchanged', () => {
  const d = project(),
    targets = {
      guides: [],
      artwork: [
        [
          [100, 200, 300],
          [100, 200, 300],
        ],
      ],
    };
  for (const scale of [0.25, 1, 4]) {
    assert.equal(snap(d, [[100 - 6 / scale], []], targets, [0, 0], scale).delta[0], 6 / scale);
    assert.equal(snap(d, [[100 - 6.01 / scale], []], targets, [0, 0], scale).delta[0], 0);
  }
  assert.deepEqual(snap(d, [[80, 120], [70]], targets, [17, 29]).delta, [20, 30]);
  assert.deepEqual(snap(d, [[98], [98]], targets, [0, 0], 1, true).delta, [0, 0]);
  d.editor.snap = false;
  assert.deepEqual(snap(d, [[98], [98]], targets).matches, []);
});

test('nearest explicit target wins; ties use manual guide, guide layer, artboard, artwork before grid across source order', () => {
  const d = project(),
    targets = { guides: [[[102, 300, 500], []]], artwork: [[[98, 600, 700], []]] };
  d.editor.guides.push({ id: 'manual', axis: 'x', position: 101, locked: false });
  assert.equal(snap(d, [[100], []], targets).matches[0].kind, 'guide');
  d.editor.guides[0].position = 102;
  assert.equal(snap(d, [[100], []], targets).matches[0].kind, 'guide');
  d.editor.guides = [];
  assert.equal(snap(d, [[100], []], targets).matches[0].kind, 'guide-layer');
  d.editor.snapArtboard = true;
  assert.equal(snap(d, [[100, 2], []], { ...targets, guides: [] }).matches[0].kind, 'artboard');
  d.editor.snapArtboard = false;
  d.editor.snapGrid = true;
  assert.equal(snap(d, [[100], []], { ...targets, guides: [] }).matches[0].kind, 'artwork');
  d.editor.guides = [{ id: 'manual', axis: 'x', position: 202, locked: false }];
  assert.equal(snap(d, [[100, 200], []], { ...targets, guides: [] }).matches[0].kind, 'guide');
  d.editor.guides[0].position = 204;
  assert.equal(snap(d, [[100, 200], []], { ...targets, guides: [] }).matches[0].kind, 'artwork');
});

test('100 layers collect once, then 1000 pointer snapshots do not repeat geometry bounds work', () => {
  const d = project();
  for (let i = 0; i < 99; i++) target(d);
  let calls = 0;
  const targets = collect(d, (p) => {
    calls++;
    return pathBounds(p);
  });
  assert.equal(calls, 99);
  for (let i = 0; i < 1000; i++) snap(d, [[300], [200]], targets, [i / 100, 0]);
  assert.equal(calls, 99);
});
