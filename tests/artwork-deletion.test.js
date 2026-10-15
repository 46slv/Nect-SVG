import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  blankLayer,
  document,
  exportSVG,
  hasEmptyOutput,
  History,
  serialize,
  deserialize,
  validate,
} from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { removeArtworkLayer } from '../src/artwork-deletion.js';
import { resolveArtworkMoveTarget } from '../src/artwork-move-target.js';
import { deletionDocument, unsupportedLayer } from './fixtures/artwork-deletion.js';

const fontData = fs
  .readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url))
  .toString('base64');
const withoutLayers = (doc) => serialize({ ...doc, layers: [] });

test('whole-layer deletion retains exact survivors, paint order, settings and all asset identities', () => {
  const doc = deletionDocument();
  doc.fontAssets = {
    'font-keep': { name: 'DejaVu Sans', fileName: 'DejaVuSans.ttf', data: fontData },
  };
  const before = serialize(doc),
    layers = doc.layers,
    survivors = [layers[0], layers[2]],
    assets = [
      doc.fontAssets,
      doc.imageAssets,
      doc.fontAssets['font-keep'],
      doc.imageAssets['image-keep'],
    ],
    target = layers[1],
    result = removeArtworkLayer(doc, target.id);
  assert.deepEqual(result, {
    removedLayerId: target.id,
    nextLayerId: survivors[1].id,
    replacedLastLayer: false,
  });
  assert.strictEqual(doc.layers, layers);
  survivors.forEach((layer, i) => assert.strictEqual(doc.layers[i], layer));
  assert.deepEqual(
    doc.layers,
    JSON.parse(before).layers.filter((layer) => layer.id !== target.id),
  );
  assert.equal(withoutLayers(doc), withoutLayers(JSON.parse(before)));
  [
    doc.fontAssets,
    doc.imageAssets,
    doc.fontAssets['font-keep'],
    doc.imageAssets['image-keep'],
  ].forEach((asset, i) => assert.strictEqual(asset, assets[i]));
  assert.equal(Object.isFrozen(assets[2]), false);
  assert.equal(Object.isFrozen(assets[3]), false);
  assert.doesNotThrow(() => validate(structuredClone(doc)));
});

test('exact IDs choose deterministic next/previous neighbors; hidden, guide and empty layers are removable', () => {
  for (const index of [0, 1, 2]) {
    const doc = deletionDocument(),
      target = doc.layers[index],
      expected = doc.layers[index + 1]?.id || doc.layers[index - 1].id;
    target.visible = false;
    target.guide = true;
    const before = serialize(doc);
    assert.equal(removeArtworkLayer(doc, target.id).nextLayerId, expected);
    assert.deepEqual(
      doc.layers,
      JSON.parse(before).layers.filter((layer) => layer.id !== target.id),
    );
  }
});

test('locked, missing, repeated and ambiguous IDs reject without changing document or assets', () => {
  const doc = deletionDocument(),
    target = doc.layers[1];
  target.locked = true;
  for (const id of [target.id, 'stale-layer', '', null, undefined]) {
    const before = serialize(doc),
      layers = doc.layers;
    assert.throws(() => removeArtworkLayer(doc, id));
    assert.equal(serialize(doc), before);
    assert.strictEqual(doc.layers, layers);
    assert.equal(Object.isFrozen(doc.imageAssets['image-keep']), false);
  }
  target.locked = false;
  removeArtworkLayer(doc, target.id);
  const after = serialize(doc);
  assert.throws(() => removeArtworkLayer(doc, target.id), /unavailable/);
  assert.equal(serialize(doc), after);
  doc.layers[1].id = doc.layers[0].id;
  const ambiguous = serialize(doc);
  assert.throws(() => removeArtworkLayer(doc, doc.layers[0].id), /unavailable/);
  assert.equal(serialize(doc), ambiguous);
  for (const invalid of [null, {}, { layers: [] }, { layers: Array(101).fill(blankLayer()) }])
    assert.throws(() => removeArtworkLayer(invalid, 'layer'));
});

test('deletion is independent of movement/evaluation support, including complex, gradient, image and large Curve graphs', () => {
  for (const kind of ['complex', 'gradient', 'image', 'large-curve']) {
    const doc = kind === 'complex' ? document() : deletionDocument(),
      target = kind === 'complex' ? doc.layers[0] : unsupportedLayer(doc, kind),
      before = serialize(doc);
    if (kind !== 'image') assert.equal(resolveArtworkMoveTarget(doc, target.id).supported, false);
    removeArtworkLayer(doc, target.id);
    assert.ok(!doc.layers.some((layer) => layer.id === target.id));
    assert.equal(withoutLayers(doc), withoutLayers(JSON.parse(before)));
    assert.doesNotThrow(() => validate(structuredClone(doc)));
    assert.doesNotThrow(() => exportSVG(doc));
  }
});

test('one history transaction restores exact graph/order and last-layer replacement preserves document and assets', () => {
  const doc = deletionDocument();
  doc.layers = [doc.layers[1]];
  doc.fontAssets = {
    'font-keep': { name: 'DejaVu Sans', fileName: 'DejaVuSans.ttf', data: fontData },
  };
  const history = new History(doc),
    before = serialize(doc),
    id = doc.layers[0].id;
  history.apply((doc) => removeArtworkLayer(doc, id));
  const after = serialize(history.doc),
    blank = history.doc.layers[0];
  assert.equal(history.past.length, 1);
  assert.equal(history.doc.layers.length, 1);
  assert.notEqual(blank.id, id);
  assert.equal(hasEmptyOutput(blank), true);
  assert.equal(blank.nodes.length, 1);
  assert.equal(withoutLayers(history.doc), withoutLayers(JSON.parse(before)));
  assert.equal(
    exportSVG(history.doc),
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480"></svg>',
  );
  assert.equal(serialize(deserialize(after)), after);
  history.undo();
  assert.deepEqual(history.doc, JSON.parse(before));
  history.redo();
  assert.equal(serialize(history.doc), after);
  appendArtwork(history.doc, 'Circle', { at: [200, 200] });
  assert.strictEqual(history.doc.layers[0], blank);
  assert.equal(history.doc.layers.length, 2);
});

test('deleting at 100-layer capacity frees exactly one slot for normal artwork creation', () => {
  const doc = deletionDocument();
  while (doc.layers.length < 100) doc.layers.push(blankLayer());
  assert.throws(() => appendArtwork(doc, 'Circle', { at: [200, 200] }), /100/);
  const before = serialize(doc),
    id = doc.layers[50].id;
  removeArtworkLayer(doc, id);
  assert.equal(doc.layers.length, 99);
  assert.deepEqual(
    doc.layers,
    JSON.parse(before).layers.filter((layer) => layer.id !== id),
  );
  appendArtwork(doc, 'Circle', { at: [200, 200] });
  assert.equal(doc.layers.length, 100);
  assert.doesNotThrow(() => validate(structuredClone(doc)));
});
