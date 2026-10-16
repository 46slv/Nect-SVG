import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blankLayer, deserialize, exportSVG, History, node, serialize } from '../src/core.js';
import { makeFontAsset, parseFont, resolveFonts } from '../src/fonts.js';
import {
  duplicateArtworkLayers,
  resolveArtworkDuplicateSelection,
  stageArtworkDuplicates,
} from '../src/artwork-duplication.js';
import { duplicationDocument, multiDuplicationDocument } from './fixtures/artwork-duplication.js';

const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url)),
  buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  fonts = { default: parseFont(buffer) },
  options = { fonts };
const idsOf = (doc) =>
  doc.layers.flatMap((l) => [
    l.id,
    ...l.nodes.flatMap((n) => [n.id, ...n.points.map((p) => p.id)]),
  ]);

test('mixed nonadjacent batch stages purely, inserts each copy above source and preserves every original/asset', () => {
  const f = multiDuplicationDocument(),
    before = structuredClone(f.doc),
    original = [...f.doc.layers],
    assets = f.doc.imageAssets;
  const staged = stageArtworkDuplicates(f.doc, [...f.ids].reverse(), options);
  assert.deepEqual(f.doc, before);
  assert.equal(Object.isFrozen(assets['image-shared']), false);
  assert.deepEqual(
    staged.map((c) => c.sourceLayerId),
    f.ids,
  );
  const copies = duplicateArtworkLayers(f.doc, new Set([...f.ids].reverse()), options);
  assert.strictEqual(f.doc.imageAssets, assets);
  assert.equal(Object.isFrozen(assets['image-shared']), false);
  assert.deepEqual(
    f.doc.layers.filter((l) => !copies.some((c) => c.layerId === l.id)),
    before.layers,
  );
  assert.ok(original.every((l) => f.doc.layers.includes(l)));
  const allIds = idsOf(f.doc);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const c of copies) {
    const source = f.doc.layers.find((l) => l.id === c.sourceLayerId),
      copy = f.doc.layers.find((l) => l.id === c.layerId);
    assert.strictEqual(f.doc.layers[f.doc.layers.indexOf(source) + 1], copy);
    assert.equal(copy.output, c.outputNodeId);
    const svg = (l) => exportSVG({ ...f.doc, layers: [{ ...l, name: 'same' }] }, fonts);
    assert.equal(svg(copy), svg(source));
    copy.nodes[0].position[0] += 80;
    assert.deepEqual(
      source,
      before.layers.find((l) => l.id === source.id),
    );
  }
  const reopened = deserialize(serialize(f.doc));
  assert.deepEqual(reopened, f.doc);
  assert.equal(exportSVG(reopened, fonts), exportSVG(f.doc, fonts));
});

test('all supported generator routes including transforms can share one batch', () => {
  const fixtures = [
    'Circle',
    'Ellipse',
    'Rectangle',
    'Polygon',
    'Star',
    'Text',
    'Curve',
    'Image',
  ].flatMap((type) =>
    (['Curve', 'Image'].includes(type) ? [false] : [false, true]).map((transform) =>
      duplicationDocument(type, transform),
    ),
  );
  const doc = fixtures[0].doc;
  doc.layers = fixtures.map((f) => f.layer);
  const copies = duplicateArtworkLayers(
    doc,
    doc.layers.map((l) => l.id),
    options,
  );
  assert.equal(copies.length, fixtures.length);
  for (const c of copies) {
    const source = doc.layers.find((l) => l.id === c.sourceLayerId),
      copy = doc.layers.find((l) => l.id === c.layerId);
    assert.equal(
      exportSVG({ ...doc, layers: [{ ...source, name: 'same' }] }, fonts),
      exportSVG({ ...doc, layers: [{ ...copy, name: 'same' }] }, fonts),
    );
  }
});

test('late unsupported and invalid members refuse every copy without any identity or asset side effect', () => {
  for (const mutate of [
    (f) => {
      f.fixtures[3].layer.locked = true;
    },
    (f) => {
      f.fixtures[3].layer.visible = false;
    },
    (f) => {
      f.fixtures[3].layer.guide = true;
    },
    (f) => {
      f.fixtures[3].layer.nodes.push(node('Null'));
    },
    (f) => {
      f.fixtures[3].generator.params.position.locked = true;
    },
    (f) => {
      f.fixtures[1].generator.text = 'suspended';
    },
    (f) => {
      f.fixtures[2].generator.extra = { source: f.fixtures[0].generator.id };
    },
    (f) => {
      f.fixtures[3].layer.name = 'x'.repeat(100000);
    },
    (f) => {
      f.doc.width = NaN;
    },
    (f) => {
      f.doc.imageAssets['image-shared'].width = 0;
    },
  ]) {
    const f = multiDuplicationDocument();
    mutate(f);
    const before = structuredClone(f.doc),
      layers = f.doc.layers,
      originals = [...layers],
      assets = f.doc.imageAssets;
    assert.throws(() => duplicateArtworkLayers(f.doc, f.ids, options));
    assert.deepEqual(f.doc, before);
    assert.strictEqual(f.doc.layers, layers);
    assert.ok(originals.every((l, i) => layers[i] === l));
    assert.strictEqual(f.doc.imageAssets, assets);
    assert.equal(Object.isFrozen(assets['image-shared']), false);
  }
  const f = multiDuplicationDocument();
  f.fixtures[3].layer.locked = true;
  assert.match(
    resolveArtworkDuplicateSelection(f.doc, f.ids, options).reason,
    /Image original:.*Unlock the artwork layer.*No selected artwork duplicated/i,
  );
});

test('selection, total layer capacity and late UUID collisions reject atomically', () => {
  const f = multiDuplicationDocument();
  for (const ids of [[], [f.ids[0], f.ids[0]], [f.ids[0], 'missing'], null]) {
    const before = structuredClone(f.doc);
    assert.equal(resolveArtworkDuplicateSelection(f.doc, ids, options).supported, false);
    assert.throws(() => duplicateArtworkLayers(f.doc, ids, options));
    assert.deepEqual(f.doc, before);
  }
  let count = 0;
  mock.method(globalThis.crypto, 'randomUUID', () => (count++ < 4 ? `first-${count}` : 'second'));
  try {
    const before = structuredClone(f.doc);
    assert.throws(() => duplicateArtworkLayers(f.doc, f.ids, options), /collision/);
    assert.deepEqual(f.doc, before, 'late generated collision publishes no earlier copy');
  } finally {
    mock.restoreAll();
  }
  while (f.doc.layers.length < 97) f.doc.layers.push(blankLayer());
  const before = structuredClone(f.doc);
  assert.throws(() => duplicateArtworkLayers(f.doc, f.ids, options), /exceed 100/);
  assert.deepEqual(f.doc, before);
  duplicateArtworkLayers(f.doc, f.ids.slice(0, 3), options);
  assert.equal(f.doc.layers.length, 100);
});

test('one History step restores exact document; repeated batches and Redo retain exact fresh IDs', () => {
  const f = multiDuplicationDocument(),
    h = new History(f.doc),
    before = serialize(h.doc);
  let copies;
  h.apply((doc) => {
    copies = duplicateArtworkLayers(doc, f.ids, options);
  });
  const after = serialize(h.doc);
  assert.equal(h.past.length, 1);
  for (let i = 0; i < 3; i++) {
    h.undo();
    assert.equal(serialize(h.doc), before);
    h.redo();
    assert.equal(serialize(h.doc), after);
  }
  h.apply((doc) =>
    duplicateArtworkLayers(
      doc,
      copies.map((c) => c.layerId),
      options,
    ),
  );
  assert.equal(h.past.length, 2);
  assert.equal(new Set(idsOf(h.doc)).size, idsOf(h.doc).length);
  h.undo();
  assert.equal(serialize(h.doc), after);
  h.undo();
  assert.equal(serialize(h.doc), before);
});

test('batch copies share immutable embedded font/image bytes and leave authored Text local records independent', () => {
  const f = multiDuplicationDocument(),
    asset = makeFontAsset(buffer, 'Shared.ttf');
  f.doc.fontAssets = { [asset.id]: { ...asset.asset } };
  f.fixtures[1].generator.font = asset.id;
  f.fixtures[1].generator.characterPositions.styles.c1.font = asset.id;
  const fontAssets = f.doc.fontAssets,
    font = fontAssets[asset.id],
    image = f.doc.imageAssets['image-shared'];
  const copies = duplicateArtworkLayers(f.doc, f.ids, { fonts: resolveFonts(f.doc, fonts) });
  assert.strictEqual(f.doc.fontAssets, fontAssets);
  assert.strictEqual(fontAssets[asset.id], font);
  assert.strictEqual(f.doc.imageAssets['image-shared'], image);
  assert.equal(Object.isFrozen(font), false);
  assert.equal(Object.isFrozen(image), false);
  const textCopy = f.doc.layers
    .find((l) => l.id === copies[1].layerId)
    .nodes.find((n) => n.type === 'Text');
  const before = structuredClone(f.fixtures[1].generator);
  textCopy.characterPositions.styles.c1.size += 4;
  textCopy.characterPositions.offsets.c1[0] += 20;
  assert.deepEqual(f.fixtures[1].generator, before);
});
