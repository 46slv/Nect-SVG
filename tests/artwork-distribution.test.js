import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { document, evaluate, pathBounds, History, node, connect } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { parseFont } from '../src/fonts.js';
import {
  resolveArtworkDistribution,
  distributeArtworkSelection,
} from '../src/artwork-distribution.js';
import { multiArtworkFixture } from './fixtures/artwork-multi-move.js';

const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const fonts = {
  default: parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
};
const options = { fonts };
const bounds = (doc, ids) =>
  ids.map((id) =>
    pathBounds(
      evaluate(
        doc.layers.find((l) => l.id === id),
        fonts,
        doc.imageAssets,
      ).path,
    ),
  );
const near = (a, b, precision = 1e-7) => assert.ok(Math.abs(a - b) < precision, `${a} != ${b}`);
const rectangles = (centers, axis) => {
  const doc = document();
  doc.schemaVersion = 10;
  const ids = centers.map((v, i) => {
    const at = [80 + i * 10, 80 + i * 10];
    at[axis] = v;
    return appendArtwork(doc, 'Rectangle', { at, name: `Tile ${i}` }).layerId;
  });
  doc.layers.shift();
  return { doc, ids };
};

for (const [action, axis] of [
  ['center-x', 0],
  ['center-y', 1],
]) {
  test(`${action}: final rendered centers, fixed endpoints, exact authored deltas, one Undo and repeat no-op`, () => {
    const f = multiArtworkFixture(),
      before = structuredClone(f.doc),
      bb = bounds(f.doc, f.ids),
      order = f.ids.map((id, i) => i).sort((a, b) => bb[a][axis][1] - bb[b][axis][1] || a - b),
      first = bb[order[0]][axis][1],
      last = bb[order.at(-1)][axis][1],
      expected = structuredClone(before),
      h = new History(f.doc);
    for (let rank = 1; rank < order.length - 1; rank++) {
      const i = order[rank],
        fraction = rank / (order.length - 1),
        delta = first * (1 - fraction) + last * fraction - bb[i][axis][1],
        l = expected.layers.find((l) => l.id === f.ids[i]),
        tr = l.nodes.find((n) => n.type === 'Transform'),
        n = tr || l.nodes[0],
        inputs =
          n.type === 'Curve'
            ? n.points.map((p) => p.position)
            : [
                n.params[
                  tr ? 'offset' : ['Text', 'Image'].includes(n.type) ? 'position' : 'center'
                ],
              ];
      for (const q of inputs) q.value[axis] += Math.abs(delta) <= 1e-9 ? 0 : delta;
    }
    h.apply((doc) =>
      assert.equal(distributeArtworkSelection(doc, [...f.ids].reverse(), action, options), true),
    );
    assert.deepEqual(h.doc, expected, 'only intermediate authored move positions change');
    const after = structuredClone(h.doc),
      ab = bounds(h.doc, f.ids);
    for (let rank = 0; rank < order.length; rank++) {
      const i = order[rank],
        precision = f.ids[i] === f.text.layerId ? 2e-5 : 1e-7;
      near(
        ab[i][axis][1],
        first * (1 - rank / (order.length - 1)) + (last * rank) / (order.length - 1),
        precision,
      );
      for (let edge = 0; edge < 3; edge++) near(ab[i][1 - axis][edge], bb[i][1 - axis][edge]);
      near(ab[i][axis][2] - ab[i][axis][0], bb[i][axis][2] - bb[i][axis][0], precision);
    }
    for (const index of [order[0], order.at(-1)])
      assert.deepEqual(
        h.doc.layers.find((l) => l.id === f.ids[index]),
        before.layers.find((l) => l.id === f.ids[index]),
      );
    assert.equal(h.past.length, 1);
    h.apply((doc) => assert.equal(distributeArtworkSelection(doc, f.ids, action, options), false));
    assert.equal(h.past.length, 1);
    assert.deepEqual(h.doc, after);
    h.undo();
    assert.deepEqual(h.doc, before);
    h.redo();
    assert.deepEqual(h.doc, after);
  });

  test(`${action}: ties follow document layer order regardless of selection insertion order`, () => {
    for (const centers of [
      [0, 0, 90],
      [0, 90, 90, 90],
    ]) {
      const f = rectangles(centers, axis),
        other = structuredClone(f.doc),
        before = structuredClone(f.doc);
      assert.equal(distributeArtworkSelection(f.doc, f.ids, action), true);
      assert.equal(distributeArtworkSelection(other, [...f.ids].reverse(), action), true);
      assert.deepEqual(f.doc, other);
      const ab = bounds(f.doc, f.ids);
      for (let i = 0; i < f.ids.length; i++) near(ab[i][axis][1], (i * 90) / (f.ids.length - 1));
      assert.deepEqual(f.doc.layers[0], before.layers[0]);
      assert.deepEqual(f.doc.layers.at(-1), before.layers.at(-1));
    }
  });

  test(`${action}: all coincident or already equally spaced centers are no-ops and retain Redo`, () => {
    for (const centers of [
      [20, 20, 20],
      [0, 30, 60, 90],
    ]) {
      const f = rectangles(centers, axis),
        before = structuredClone(f.doc),
        h = new History(f.doc);
      h.future.push({ sentinel: true });
      h.apply((doc) => assert.equal(distributeArtworkSelection(doc, f.ids, action), false));
      assert.deepEqual(h.doc, before);
      assert.equal(h.past.length, 0);
      assert.deepEqual(h.future, [{ sentinel: true }]);
    }
  });
}

test('unsupported mixed members, including fixed endpoints, reject all with a named reason and intact history', () => {
  const blocks = {
    locked: (l) => {
      l.locked = true;
    },
    hidden: (l) => {
      l.visible = false;
    },
    guide: (l) => {
      l.guide = true;
    },
    expression: (l) => {
      l.nodes[0].params.position.expression = '1; 2';
    },
    connected: (l) => {
      l.nodes[0].params.position.source = 'missing';
    },
    'locked input': (l) => {
      l.nodes[0].params.position.locked = true;
    },
    empty: (l) => {
      l.nodes[0].text = '';
    },
    nonfinite: (l) => {
      l.nodes[0].params.position.value = [Infinity, 0];
    },
    bypassed: (l) => {
      l.nodes[0].bypassed = true;
    },
    gradient: (l) => {
      const n = node('Linear Gradient Fill');
      l.nodes.push(n);
      connect(l, l.nodes[0].id, n.id, 'path');
      connect(l, n.id, l.output, 'path');
    },
    'empty bounds': (l) => {
      const n = node('Transform');
      n.params.scale.value = 0;
      l.nodes.push(n);
      connect(l, l.nodes[0].id, n.id, 'path');
      connect(l, n.id, l.nodes.find((n) => n.type === 'Fill').id, 'path');
    },
  };
  for (const [kind, block] of Object.entries(blocks)) {
    const f = multiArtworkFixture(),
      l = f.doc.layers.find((l) => l.id === f.text.layerId);
    block(l);
    const before = structuredClone(f.doc),
      h = new History(f.doc);
    h.future.push({ sentinel: true });
    for (const action of ['center-x', 'center-y']) {
      const r = resolveArtworkDistribution(h.doc, f.ids, options);
      assert.equal(r.supported, false, kind);
      assert.ok(r.reason.includes(l.name), kind);
      assert.throws(
        () => h.apply((doc) => distributeArtworkSelection(doc, f.ids, action, options)),
        /No selected artwork distributed/,
      );
      assert.deepEqual(h.doc, before, kind);
      assert.equal(h.past.length, 0);
      assert.deepEqual(h.future, [{ sentinel: true }]);
    }
  }
  const f = rectangles([0, 10, 90], 0);
  f.doc.layers[0].locked = true;
  assert.throws(() => distributeArtworkSelection(f.doc, f.ids, 'center-x'), /Tile 0:.*Unlock/);
});

test('cardinality, Curve move budget, nonfinite output bounds and stored-value validation are atomic', () => {
  const f = multiArtworkFixture(),
    before = structuredClone(f.doc);
  for (const ids of [
    [],
    [f.ids[0]],
    f.ids.slice(0, 2),
    [f.ids[0], f.ids[0], f.ids[1]],
    [...f.ids, 'missing'],
    Array.from({ length: 101 }, (_, i) => `layer-${i}`),
  ])
    assert.throws(() => distributeArtworkSelection(f.doc, ids, 'center-x', options));
  assert.throws(
    () => distributeArtworkSelection(f.doc, f.ids, 'gaps', options),
    /center distribution/,
  );
  assert.deepEqual(f.doc, before);
  const c = f.doc.layers.find((l) => l.id === f.curve.layerId).nodes[0];
  c.points = Array.from({ length: 129 }, (_, i) => ({
    ...structuredClone(c.points[i % 3]),
    id: `anchor-${i}`,
  }));
  assert.throws(() => distributeArtworkSelection(f.doc, f.ids, 'center-x', options), /128 anchors/);
  const invalid = rectangles([0, 10, 90], 0);
  invalid.doc.width = 100001;
  const snapshot = structuredClone(invalid.doc),
    h = new History(invalid.doc);
  h.future.push({ sentinel: true });
  assert.throws(
    () => h.apply((doc) => distributeArtworkSelection(doc, invalid.ids, 'center-x')),
    /Invalid artboard size.*No selected artwork distributed/,
  );
  assert.deepEqual(h.doc, snapshot);
  assert.equal(h.past.length, 0);
  assert.deepEqual(h.future, [{ sentinel: true }]);
  const overflow = rectangles([0, 10, 90], 0);
  overflow.doc.layers[1].nodes[0].params.size.value = [Number.MAX_VALUE, Number.MAX_VALUE];
  overflow.doc.layers[1].nodes[0].params.center.value = [Number.MAX_VALUE, Number.MAX_VALUE];
  const original = structuredClone(overflow.doc);
  assert.equal(resolveArtworkDistribution(overflow.doc, overflow.ids).supported, false);
  assert.throws(
    () => distributeArtworkSelection(overflow.doc, overflow.ids, 'center-x'),
    /No selected artwork distributed/,
  );
  assert.deepEqual(overflow.doc, original);
});
