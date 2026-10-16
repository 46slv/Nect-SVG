import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate, pathBounds, History, node, connect } from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import {
  artworkAlignments,
  alignArtworkSelection,
  resolveArtworkAlignment,
} from '../src/artwork-alignment.js';
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

for (const [action, , axis, edge] of artworkAlignments) {
  test(`${action}: align actual shape, rotated negative-scale star, Text, Curve and Image bounds in one history entry`, () => {
    const f = multiArtworkFixture(),
      before = structuredClone(f.doc),
      bb = bounds(f.doc, f.ids),
      h = new History(f.doc);
    const min = Math.min(...bb.map((b) => b[axis][0])),
      max = Math.max(...bb.map((b) => b[axis][2]));
    const destination = [min, min / 2 + max / 2, max][edge];
    const expected = structuredClone(before);
    expected.layers
      .filter((l) => f.ids.includes(l.id))
      .forEach((l) => {
        const index = f.ids.indexOf(l.id),
          delta = destination - bb[index][axis][edge];
        const tr = l.nodes.find((n) => n.type === 'Transform'),
          n = tr || l.nodes[0];
        const inputs =
          n.type === 'Curve'
            ? n.points.map((p) => p.position)
            : [
                n.params[
                  tr ? 'offset' : ['Text', 'Image'].includes(n.type) ? 'position' : 'center'
                ],
              ];
        for (const input of inputs) input.value[axis] += Math.abs(delta) <= 1e-9 ? 0 : delta;
      });
    h.apply((doc) => assert.equal(alignArtworkSelection(doc, f.ids, action, options), true));
    assert.deepEqual(
      h.doc,
      expected,
      'every authored value equals the delta from actual final bounds',
    );
    const after = structuredClone(h.doc),
      ab = bounds(h.doc, f.ids);
    ab.forEach((b, i) => {
      // Core Text shapes with toPathData(5); preserve that existing contract.
      const precision = f.ids[i] === f.text.layerId ? 2e-5 : 1e-7;
      near(b[axis][edge], destination, precision);
      for (let j = 0; j < 3; j++) near(b[1 - axis][j], bb[i][1 - axis][j]);
      near(b[axis][2] - b[axis][0], bb[i][axis][2] - bb[i][axis][0], precision);
    });
    assert.deepEqual(h.doc.layers[0], before.layers[0]);
    assert.deepEqual(h.doc.imageAssets, before.imageAssets);
    assert.equal(h.past.length, 1);
    h.apply((doc) => assert.equal(alignArtworkSelection(doc, f.ids, action, options), false));
    assert.equal(h.past.length, 1);
    assert.deepEqual(h.doc, after);
    h.undo();
    assert.deepEqual(h.doc, before);
    h.redo();
    assert.deepEqual(h.doc, after);
  });
}

test('any unsupported member rejects the entire set with its name and reason; no document/history/redo mutation', () => {
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
    'empty Text': (l) => {
      l.nodes[0].text = '';
    },
    'nonfinite position': (l) => {
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
    for (const [action] of artworkAlignments) {
      const r = resolveArtworkAlignment(f.doc, f.ids, options);
      assert.equal(r.supported, false, kind);
      assert.ok(r.reason.includes(l.name), kind);
      assert.throws(
        () => h.apply((doc) => alignArtworkSelection(doc, f.ids, action, options)),
        /No selected artwork aligned/,
      );
      assert.deepEqual(h.doc, before, kind);
      assert.equal(h.past.length, 0);
      assert.deepEqual(h.future, [{ sentinel: true }]);
    }
  }
});

test('Curve budget, invalid selection and invalid action preserve all authored data', () => {
  const f = multiArtworkFixture(),
    c = f.doc.layers.find((l) => l.id === f.curve.layerId).nodes[0];
  c.points = Array.from({ length: 129 }, (_, i) => ({
    ...structuredClone(c.points[i % 3]),
    id: `anchor-${i}`,
  }));
  const before = structuredClone(f.doc);
  assert.throws(() => alignArtworkSelection(f.doc, f.ids, 'left', options), /128 anchors/);
  for (const ids of [[], [f.ids[0]], [f.ids[0], f.ids[0]], [...f.ids, 'missing']])
    assert.throws(() => alignArtworkSelection(f.doc, ids, 'left', options));
  assert.throws(() => alignArtworkSelection(f.doc, f.ids, 'distribute', options), /six/);
  assert.deepEqual(f.doc, before);
});
