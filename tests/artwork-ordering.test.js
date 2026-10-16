import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  blankLayer,
  document as makeDoc,
  deserialize,
  exportSVG,
  History,
  serialize,
  validate,
} from '../src/core.js';
import { moveArtworkLayer, resolveArtworkOrderTarget } from '../src/artwork-ordering.js';
import { resolveArtworkMoveTarget } from '../src/artwork-move-target.js';
import { deletionDocument, unsupportedLayer } from './fixtures/artwork-deletion.js';
import { orderingDocument } from './fixtures/artwork-ordering.js';

test('Forward/Backward swap exactly adjacent records and preserve every asset, setting and record identity', () => {
  const doc = orderingDocument();
  doc.fontAssets = {
    'font-keep': {
      name: 'DejaVu Sans',
      fileName: 'DejaVuSans.ttf',
      data: fs
        .readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url))
        .toString('base64'),
    },
  };
  const before = serialize(doc),
    array = doc.layers,
    records = [...array],
    assets = [
      doc.fontAssets,
      doc.fontAssets['font-keep'],
      doc.imageAssets,
      doc.imageAssets['image-keep'],
    ];
  assert.deepEqual(moveArtworkLayer(doc, records[1].id, 'forward'), {
    moved: true,
    layerId: records[1].id,
    direction: 'forward',
  });
  assert.strictEqual(doc.layers, array);
  [records[0], records[2], records[1]].forEach((record, index) =>
    assert.strictEqual(doc.layers[index], record),
  );
  records.forEach((record, index) => assert.deepEqual(record, JSON.parse(before).layers[index]));
  assert.equal(serialize({ ...doc, layers: [] }), serialize({ ...JSON.parse(before), layers: [] }));
  [
    doc.fontAssets,
    doc.fontAssets['font-keep'],
    doc.imageAssets,
    doc.imageAssets['image-keep'],
  ].forEach((asset, index) => assert.strictEqual(asset, assets[index]));
  moveArtworkLayer(doc, records[1].id, 'backward');
  assert.equal(serialize(doc), before);
  validate(structuredClone(doc));
});

test('missing/ambiguous IDs, invalid directions, invalid documents and locked targets reject atomically', () => {
  for (const [id, direction, mutate] of [
    [null, 'forward'],
    ['', 'backward'],
    ['missing', 'forward'],
    ['@target', 'up'],
    ['@target', 1],
    ['@target', undefined],
    ['@target', 'forward', (doc) => (doc.layers[1].locked = true)],
    ['@target', 'backward', (doc) => (doc.layers[2].id = doc.layers[1].id)],
  ]) {
    const doc = orderingDocument();
    mutate?.(doc);
    const layerId = id === '@target' ? doc.layers[1].id : id,
      before = serialize(doc);
    assert.equal(resolveArtworkOrderTarget(doc, layerId, direction).supported, false);
    assert.throws(() => moveArtworkLayer(doc, layerId, direction));
    assert.equal(serialize(doc), before);
  }
  for (const doc of [null, {}, { layers: [] }, { layers: Array(101).fill({ id: 'layer' }) }])
    assert.throws(() => moveArtworkLayer(doc, 'layer', 'forward'));
});

test('boundary attempts and repeated stale operations are no-ops preserving Redo; one accepted swap is one exact Undo', () => {
  const doc = orderingDocument(),
    records = [...doc.layers],
    history = new History(doc),
    before = serialize(doc);
  history.apply((d) => moveArtworkLayer(d, records[1].id, 'forward'));
  const after = serialize(history.doc);
  assert.equal(history.past.length, 1);
  history.undo();
  assert.equal(serialize(history.doc), before);
  for (let i = 0; i < 3; i++) {
    for (const [id, direction] of [
      [records[0].id, 'backward'],
      [records[2].id, 'forward'],
    ]) {
      history.apply((d) => assert.equal(moveArtworkLayer(d, id, direction).moved, false));
      assert.equal(history.past.length, 0);
      assert.equal(history.future.length, 1);
      assert.equal(serialize(history.doc), before);
    }
    assert.throws(() => moveArtworkLayer(history.doc, 'stale', 'forward'));
  }
  history.redo();
  assert.equal(serialize(history.doc), after);
  assert.equal(history.past.length, 1);
  const single = { layers: [blankLayer()] };
  for (const direction of ['forward', 'backward'])
    assert.equal(moveArtworkLayer(single, single.layers[0].id, direction).moved, false);
});

test('crossing a locked neighbor is allowed without changing it; geometry eligibility never restricts ordering', () => {
  const doc = orderingDocument(),
    target = doc.layers[1],
    neighbor = doc.layers[2];
  neighbor.locked = true;
  const before = structuredClone(neighbor);
  moveArtworkLayer(doc, target.id, 'forward');
  assert.strictEqual(doc.layers[1], neighbor);
  assert.deepEqual(neighbor, before);
  for (const kind of ['hidden', 'guide', 'empty', 'complex', 'gradient', 'large-curve', 'image']) {
    const d = kind === 'complex' ? makeDoc() : deletionDocument();
    if (kind === 'complex') d.layers.push(blankLayer());
    let layer = d.layers[0];
    if (kind === 'hidden') layer.visible = false;
    else if (kind === 'guide') layer.guide = true;
    else if (['gradient', 'large-curve', 'image'].includes(kind)) layer = unsupportedLayer(d, kind);
    if (kind !== 'image')
      assert.equal(resolveArtworkMoveTarget(d, layer.id).supported, false, kind);
    const records = [...d.layers],
      snapshot = serialize(d),
      index = records.indexOf(layer);
    moveArtworkLayer(d, layer.id, 'forward');
    assert.strictEqual(d.layers[index + 1], layer, kind);
    for (const record of records)
      assert.deepEqual(
        record,
        JSON.parse(snapshot).layers.find((l) => l.id === record.id),
        kind,
      );
  }
});

test('paint order changes in SVG and exact project reload without changing the schema or artwork', () => {
  const doc = orderingDocument(),
    before = serialize(doc),
    target = doc.layers[1];
  moveArtworkLayer(doc, target.id, 'forward');
  const svg = exportSVG(doc),
    names = doc.layers.map((l) => l.name),
    offsets = names.map((name) => svg.indexOf(`data-layer="${name}"`));
  assert.ok(offsets.every((offset) => offset >= 0));
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    offsets,
  );
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  moveArtworkLayer(doc, target.id, 'backward');
  assert.equal(serialize(doc), before);
});
