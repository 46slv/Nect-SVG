import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { document, evaluate, pathBounds, History, node, connect } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { parseFont } from '../src/fonts.js';
import { distributeArtworkGaps } from '../src/artwork-gap-distribution.js';
import { multiArtworkFixture } from './fixtures/artwork-multi-move.js';
import { gapArtworkFixture } from './fixtures/artwork-gap-distribution.js';

const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const fonts = {
  default: parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
};
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
const near = (a, b, precision = 3e-5) => assert.ok(Math.abs(a - b) <= precision, `${a} != ${b}`);
const rectangles = (edges, axis) => {
  const doc = document();
  doc.schemaVersion = 10;
  const ids = edges.map(([min, max], i) => {
    const at = [80, 80];
    at[axis] = min / 2 + max / 2;
    const id = appendArtwork(doc, 'Rectangle', { at, name: `Tile ${i}` }).layerId;
    doc.layers.at(-1).nodes[0].params.size.value[axis] = max - min;
    return id;
  });
  doc.layers.shift();
  return { doc, ids };
};

for (const [action, axis] of [
  ['gap-x', 0],
  ['gap-y', 1],
]) {
  test(`${action}: unequal final shape/Text/negative-scale Transform/Bezier/Image bounds, one Undo and no-op Redo`, () => {
    const f = gapArtworkFixture(),
      before = structuredClone(f.doc),
      bb = bounds(f.doc, f.ids),
      h = new History(f.doc);
    const first = bb.map((b, i) => i).sort((a, b) => bb[a][axis][0] - bb[b][axis][0])[0];
    const last = bb.map((b, i) => i).sort((a, b) => bb[b][axis][2] - bb[a][axis][2])[0];
    h.apply((doc) =>
      assert.equal(distributeArtworkGaps(doc, [...f.ids].reverse(), action, { fonts }), true),
    );
    const after = structuredClone(h.doc),
      ab = bounds(h.doc, f.ids);
    const ordered = [
      first,
      ...f.ids
        .map((_, i) => i)
        .filter((i) => i !== first && i !== last)
        .sort((a, b) => bb[a][axis][0] - bb[b][axis][0]),
      last,
    ];
    const gaps = ordered.slice(1).map((i, rank) => ab[i][axis][0] - ab[ordered[rank]][axis][2]);
    for (const gap of gaps) near(gap, gaps[0]);
    for (const i of [first, last])
      assert.deepEqual(
        h.doc.layers.find((l) => l.id === f.ids[i]),
        before.layers.find((l) => l.id === f.ids[i]),
      );
    // Compare the complete source model: only authored movement inputs change.
    const expected = structuredClone(before);
    for (let i = 0; i < f.ids.length; i++) {
      near(ab[i][axis][2] - ab[i][axis][0], bb[i][axis][2] - bb[i][axis][0]);
      for (let edge = 0; edge < 3; edge++) near(ab[i][1 - axis][edge], bb[i][1 - axis][edge]);
      const l = expected.layers.find((l) => l.id === f.ids[i]);
      const n = l.nodes.find((n) => n.type === 'Transform') || l.nodes[0];
      const inputs =
        n.type === 'Curve'
          ? n.points.map((p) => p.position)
          : [
              n.params[
                n.type === 'Transform'
                  ? 'offset'
                  : ['Text', 'Image'].includes(n.type)
                    ? 'position'
                    : 'center'
              ],
            ];
      // Derive the authored delta from its unchanged move route, independently
      // of glyph outline rounding in the final bounds.
      const nextNode = h.doc.layers.find((x) => x.id === l.id).nodes.find((x) => x.id === n.id);
      const nextInputs =
        n.type === 'Curve'
          ? nextNode.points.map((p) => p.position)
          : [nextNode.params[Object.keys(n.params).find((key) => n.params[key] === inputs[0])]];
      near(nextInputs[0].value[axis] - inputs[0].value[axis], ab[i][axis][0] - bb[i][axis][0]);
      const delta = nextInputs[0].value[axis] - inputs[0].value[axis];
      for (const q of inputs) q.value[axis] += delta;
    }
    assert.deepEqual(h.doc, expected);
    assert.equal(h.past.length, 1);
    h.future.push({ sentinel: true });
    for (let repeat = 0; repeat < 3; repeat++)
      h.apply((doc) => assert.equal(distributeArtworkGaps(doc, f.ids, action, { fonts }), false));
    assert.deepEqual(h.doc, after);
    assert.equal(h.past.length, 1);
    assert.deepEqual(h.future, [{ sentinel: true }]);
    h.future = [];
    h.undo();
    assert.deepEqual(h.doc, before);
    h.redo();
    assert.deepEqual(h.doc, after);
    const reopened = JSON.parse(JSON.stringify(h.doc));
    assert.equal(distributeArtworkGaps(reopened, f.ids, action, { fonts }), false);
  });

  test(`${action}: exact unequal sizes, zero and negative gaps, outer endpoint ties and click-order independence`, () => {
    for (const [edges, expected] of [
      [
        [
          [0, 20],
          [30, 70],
          [180, 190],
          [300, 330],
        ],
        [
          [0, 20],
          [290 / 3, 410 / 3],
          [640 / 3, 670 / 3],
          [300, 330],
        ],
      ],
      [
        [
          [0, 20],
          [30, 70],
          [60, 90],
        ],
        [
          [0, 20],
          [20, 60],
          [60, 90],
        ],
      ],
      [
        [
          [0, 50],
          [60, 140],
          [100, 150],
        ],
        [
          [0, 50],
          [35, 115],
          [100, 150],
        ],
      ],
      [
        [
          [0, 30],
          [0, 30],
          [90, 120],
        ],
        [
          [0, 30],
          [45, 75],
          [90, 120],
        ],
      ],
      [
        [
          [0, 30],
          [90, 120],
          [90, 120],
        ],
        [
          [0, 30],
          [45, 75],
          [90, 120],
        ],
      ],
    ]) {
      const f = rectangles(edges, axis),
        other = structuredClone(f.doc),
        before = structuredClone(f.doc);
      assert.equal(distributeArtworkGaps(f.doc, f.ids, action), true);
      assert.equal(distributeArtworkGaps(other, [...f.ids].reverse(), action), true);
      assert.deepEqual(f.doc, other);
      bounds(f.doc, f.ids).forEach((b, i) => {
        near(b[axis][0], expected[i][0]);
        near(b[axis][2], expected[i][1]);
      });
      assert.deepEqual(f.doc.layers[0], before.layers[0]);
      assert.deepEqual(f.doc.layers.at(-1), before.layers.at(-1));
      assert.equal(distributeArtworkGaps(f.doc, f.ids, action), false);
    }
    const f = rectangles(
      [
        [0, 20],
        [120, 250],
        [150, 170],
      ],
      axis,
    );
    const end = structuredClone(f.doc.layers[1]);
    distributeArtworkGaps(f.doc, f.ids, action);
    assert.deepEqual(f.doc.layers[1], end, 'right/bottom outer edge wins over last leading edge');
  });

  test(`${action}: coincident equal bounds are no-op; ambiguous or order-reversing overlap rejects atomically`, () => {
    const coincident = rectangles(
      [
        [0, 30],
        [0, 30],
        [0, 30],
      ],
      axis,
    );
    assert.equal(distributeArtworkGaps(coincident.doc, coincident.ids, action), false);
    for (const edges of [
      [
        [0, 200],
        [30, 60],
        [90, 120],
      ],
      [
        [0, 100],
        [0, 10],
        [0, 100],
      ],
    ]) {
      const f = rectangles(edges, axis),
        before = structuredClone(f.doc),
        h = new History(f.doc);
      h.future.push({ sentinel: true });
      assert.throws(
        () => h.apply((doc) => distributeArtworkGaps(doc, f.ids, action)),
        /outer|order/,
      );
      assert.deepEqual(h.doc, before);
      assert.equal(h.past.length, 0);
      assert.deepEqual(h.future, [{ sentinel: true }]);
    }
  });
}

test('gap distribution revalidates all selected routes, cardinality, stored values and overflow before any source write', () => {
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
    bypassed: (l) => {
      l.nodes[0].bypassed = true;
    },
    empty: (l) => {
      l.nodes[0].text = '';
    },
    nonfinite: (l) => {
      l.nodes[0].params.position.value = [Infinity, 0];
    },
    gradient: (l) => {
      const n = node('Linear Gradient Fill');
      l.nodes.push(n);
      connect(l, l.nodes[0].id, n.id, 'path');
      connect(l, n.id, l.output, 'path');
    },
  };
  for (const [kind, block] of Object.entries(blocks)) {
    const f = multiArtworkFixture(),
      l = f.doc.layers.find((l) => l.id === f.text.layerId);
    block(l);
    const before = structuredClone(f.doc),
      h = new History(f.doc);
    h.future.push({ sentinel: true });
    for (const action of ['gap-x', 'gap-y']) {
      assert.throws(
        () => h.apply((doc) => distributeArtworkGaps(doc, f.ids, action, { fonts })),
        /Editable label:.*No selected artwork distributed/,
        kind,
      );
      assert.deepEqual(h.doc, before);
      assert.equal(h.past.length, 0);
      assert.deepEqual(h.future, [{ sentinel: true }]);
    }
  }
  const f = multiArtworkFixture(),
    before = structuredClone(f.doc);
  for (const ids of [
    [],
    f.ids.slice(0, 2),
    [f.ids[0], f.ids[0], f.ids[1]],
    [...f.ids, 'missing'],
    Array.from({ length: 101 }, (_, i) => `layer-${i}`),
  ])
    assert.throws(() => distributeArtworkGaps(f.doc, ids, 'gap-x', { fonts }));
  assert.throws(
    () => distributeArtworkGaps(f.doc, f.ids, 'center-x', { fonts }),
    /gap distribution/,
  );
  assert.deepEqual(f.doc, before);
  const curve = f.doc.layers.find((l) => l.id === f.curve.layerId).nodes[0];
  curve.points = Array.from({ length: 129 }, (_, i) => ({
    ...structuredClone(curve.points[i % 3]),
    id: `anchor-${i}`,
  }));
  assert.throws(() => distributeArtworkGaps(f.doc, f.ids, 'gap-x', { fonts }), /128 anchors/);
  const invalid = rectangles(
    [
      [0, 20],
      [30, 70],
      [300, 330],
    ],
    0,
  );
  invalid.doc.width = 100001;
  const snapshot = structuredClone(invalid.doc);
  assert.throws(
    () => distributeArtworkGaps(invalid.doc, invalid.ids, 'gap-x'),
    /Invalid artboard size.*No selected artwork distributed/,
  );
  assert.deepEqual(invalid.doc, snapshot);
  const overflow = rectangles(
    [
      [0, 20],
      [30, 70],
      [300, 330],
    ],
    0,
  );
  overflow.doc.layers[1].nodes[0].params.center.value = [Number.MAX_VALUE, Number.MAX_VALUE];
  overflow.doc.layers[1].nodes[0].params.size.value = [Number.MAX_VALUE, Number.MAX_VALUE];
  const original = structuredClone(overflow.doc);
  assert.throws(
    () => distributeArtworkGaps(overflow.doc, overflow.ids, 'gap-x'),
    /No selected artwork distributed/,
  );
  assert.deepEqual(overflow.doc, original);
});

test('many Text bounds use adjacent gap precision without accumulating a second history step', () => {
  for (const [count, initialSeed] of [
    [12, 57621],
    [40, 57621],
    [30, 57626],
  ]) {
    let seed = initialSeed;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (const [action, axis] of [
      ['gap-x', 0],
      ['gap-y', 1],
    ]) {
      const doc = document();
      doc.schemaVersion = 10;
      const ids = Array.from({ length: count }, (_, i) => {
        const at = [i * 250 + rand(), 100 + rand()];
        if (axis === 1) at.reverse();
        const id = appendArtwork(doc, 'Text', { at }).layerId;
        const n = doc.layers.at(-1).nodes[0];
        n.text = 'Letter';
        n.params.size.value = 10 + rand() * 30;
        return id;
      });
      doc.layers.shift();
      const h = new History(doc);
      h.apply((d) => assert.equal(distributeArtworkGaps(d, ids, action, { fonts }), true));
      const after = structuredClone(h.doc),
        ab = bounds(h.doc, ids);
      const gaps = ab.slice(1).map((b, i) => b[axis][0] - ab[i][axis][2]);
      assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 4.0004e-5);
      h.future.push({ sentinel: true });
      for (let repeat = 0; repeat < 5; repeat++)
        h.apply((d) =>
          assert.equal(distributeArtworkGaps(d, [...ids].reverse(), action, { fonts }), false),
        );
      assert.deepEqual(h.doc, after);
      assert.equal(h.past.length, 1);
      assert.deepEqual(h.future, [{ sentinel: true }]);
      const reopened = JSON.parse(JSON.stringify(h.doc));
      assert.equal(distributeArtworkGaps(reopened, ids, action, { fonts }), false);
    }
  }
});
