import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate, pathBounds, serialize, deserialize } from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import { guideDefaults, collectSnapLayerBounds } from '../src/guides.js';
import { resolveArtworkMoveSelection, translateArtworkTargets } from '../src/artwork-multi-move.js';
import { multiArtworkFixture } from './fixtures/artwork-multi-move.js';
const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const fonts = {
  default: parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
};
const resolve = (f) => resolveArtworkMoveSelection(f.doc, new Set(f.ids), { fonts });
test('independent shape, transformed star, Text, Curve and Image move rigidly without changing any other record', () => {
  const f = multiArtworkFixture(),
    before = structuredClone(f.doc),
    result = resolve(f);
  assert.equal(result.supported, true, result.reason);
  const bounds = f.ids.map((id) =>
    pathBounds(
      evaluate(
        f.doc.layers.find((l) => l.id === id),
        fonts,
        f.doc.imageAssets,
      ).path,
    ),
  );
  translateArtworkTargets(f.doc, result.target, [23, -17]);
  f.ids.forEach((id, i) => {
    const b = pathBounds(
      evaluate(
        f.doc.layers.find((l) => l.id === id),
        fonts,
        f.doc.imageAssets,
      ).path,
    );
    b.forEach((axis, a) =>
      axis.forEach((v, j) => assert.ok(Math.abs(v - bounds[i][a][j] - [23, -17][a]) < 1e-6)),
    );
  });
  // Invert from a fresh origin, then compare every document record.
  translateArtworkTargets(f.doc, resolve(f).target, [-23, 17]);
  assert.deepEqual(f.doc, before);
  assert.deepEqual(deserialize(serialize(f.doc)), deserialize(serialize(before)));
});
test('one locked, hidden, guide, driven or unavailable member rejects the entire selection', () => {
  for (const block of [
    (l) => {
      l.locked = true;
    },
    (l) => {
      l.visible = false;
    },
    (l) => {
      l.guide = true;
    },
    (l) => {
      l.nodes[0].params.position.locked = true;
    },
    (l) => {
      l.nodes[0].params.position.expression = '10; 20';
    },
    (l) => {
      l.nodes[0].asset = 'missing';
    },
  ]) {
    const f = multiArtworkFixture();
    block(f.doc.layers.at(-1));
    const before = serialize(f.doc),
      r = resolve(f);
    assert.equal(r.supported, false);
    assert.match(r.reason, /Embedded swatch:.*No selected artwork moved/);
    assert.equal(serialize(f.doc), before);
  }
});
test('a late overflow, missing layer, changed Curve topology or sparse value never leaves earlier artwork moved', () => {
  for (const corrupt of [
    (t) => {
      t.targets.at(-1).value = [Number.MAX_VALUE, 0];
    },
    (t) => {
      t.targets.at(-1).layerId = 'missing';
    },
    (t) => {
      t.targets.at(-2).pointIds.reverse();
    },
    (t) => {
      t.targets.at(-1).value = [, 1];
    },
  ]) {
    const f = multiArtworkFixture(),
      r = resolve(f),
      before = serialize(f.doc);
    corrupt(r.target);
    assert.throws(() => translateArtworkTargets(f.doc, r.target, [Number.MAX_VALUE, 0]));
    assert.equal(serialize(f.doc), before);
  }
});
test('snapping excludes every selected artwork, retaining stationary artwork and guide targets', () => {
  const f = multiArtworkFixture();
  f.doc.editor = { ...guideDefaults(), snap: true, snapArtwork: true };
  const all = f.doc.layers.map((l) => [l, evaluate(l, fonts, f.doc.imageAssets)]);
  assert.equal(collectSnapLayerBounds(f.doc, all, new Set(f.ids), pathBounds).artwork.length, 0);
  assert.equal(
    collectSnapLayerBounds(f.doc, all, new Set(f.ids.slice(0, -1)), pathBounds).artwork.length,
    1,
  );
});
