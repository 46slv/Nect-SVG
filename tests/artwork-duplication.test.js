import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  blankLayer,
  connect,
  deserialize,
  evaluate,
  exportSVG,
  History,
  guideDefaults,
  node,
  point,
  serialize,
  validate,
} from '../src/core.js';
import { makeFontAsset, parseFont, resolveFonts } from '../src/fonts.js';
import {
  resolveArtworkDuplicateTarget,
  stageArtworkDuplicate,
  duplicateArtworkLayer,
} from '../src/artwork-duplication.js';
import { duplicationDocument, richDuplicationText } from './fixtures/artwork-duplication.js';

const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url)),
  buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  fonts = { default: parseFont(buffer) },
  options = { fonts };
const supported = (f) => resolveArtworkDuplicateTarget(f.doc, f.layer.id, options);
const svg = (doc, layer) =>
  exportSVG(
    { ...structuredClone(doc), layers: [{ ...structuredClone(layer), name: 'same' }] },
    fonts,
  );
function unchangedReject(f, match) {
  const before = structuredClone(f.doc),
    layers = f.doc.layers,
    source = f.layer,
    assets = f.doc.imageAssets,
    asset = assets?.['image-shared'];
  assert.throws(() => duplicateArtworkLayer(f.doc, source.id, options), match);
  assert.deepEqual(f.doc, before);
  assert.strictEqual(f.doc.layers, layers);
  assert.ok(f.doc.layers.includes(source));
  assert.strictEqual(f.doc.imageAssets, assets);
  if (asset) assert.equal(Object.isFrozen(asset), false);
}

for (const type of [
  'Circle',
  'Ellipse',
  'Rectangle',
  'Polygon',
  'Star',
  'Text',
  'Curve',
  'Image',
]) {
  for (const transformed of type === 'Curve' || type === 'Image' ? [false] : [false, true]) {
    test(`${type}${transformed ? ' → Transform' : ''}: pure staging and exact independent layer copy`, () => {
      const f = duplicationDocument(type, transformed);
      if (type === 'Text') richDuplicationText(f.generator);
      if (type === 'Circle') {
        f.generator.params.radius.expression = '50 + 25';
        f.generator.params.radius.locked = true;
      }
      assert.equal(supported(f).supported, true, supported(f).reason);
      const before = structuredClone(f.doc),
        oldLayers = [...f.doc.layers],
        staged = stageArtworkDuplicate(f.doc, f.layer.id, options);
      assert.deepEqual(f.doc, before, 'staging is pure');
      assert.equal(Object.isFrozen(f.doc.imageAssets['image-shared']), false);
      assert.equal(staged.index, 2, 'above source in actual paint order');
      const result = duplicateArtworkLayer(f.doc, f.layer.id, options),
        copy = f.doc.layers[2];
      assert.equal(result.layerId, copy.id);
      assert.equal(result.outputNodeId, copy.output);
      assert.equal(copy.name, `${f.layer.name} copy`);
      assert.strictEqual(f.doc.layers[1], f.layer);
      assert.ok(
        oldLayers.every((l) => f.doc.layers.includes(l)),
        'original layer identities retained',
      );
      assert.deepEqual(
        f.doc.layers.filter((l) => l !== copy),
        before.layers,
      );
      const oldIds = new Set(
          before.layers.flatMap((l) => [
            l.id,
            ...l.nodes.flatMap((n) => [n.id, ...n.points.map((p) => p.id)]),
          ]),
        ),
        newIds = [copy.id, ...copy.nodes.flatMap((n) => [n.id, ...n.points.map((p) => p.id)])];
      assert.equal(new Set(newIds).size, newIds.length);
      assert.ok(newIds.every((id) => !oldIds.has(id)));
      const idMap = new Map([[f.layer.id, copy.id]]);
      f.layer.nodes.forEach((n, i) => {
        idMap.set(n.id, copy.nodes[i].id);
        n.points.forEach((p, j) => idMap.set(p.id, copy.nodes[i].points[j].id));
      });
      const expected = structuredClone(f.layer);
      expected.id = copy.id;
      expected.name += ' copy';
      expected.output = idMap.get(expected.output);
      for (const n of expected.nodes) {
        n.id = idMap.get(n.id);
        for (const p of n.points) p.id = idMap.get(p.id);
        for (const q of Object.values(n.params)) if (q.source) q.source = idMap.get(q.source);
      }
      assert.deepEqual(
        copy,
        expected,
        'all card layout, authored fields, params, locks, handles and Text-local IDs retained',
      );
      assert.equal(svg(f.doc, copy), svg(f.doc, f.layer), 'copy-only exact SVG geometry/paint');
      for (const n of copy.nodes)
        for (const q of Object.values(n.params))
          if (q.source) assert.ok(copy.nodes.some((source) => source.id === q.source));
      const copyGenerator = copy.nodes.find((n) => n.type === type);
      if (type === 'Curve') {
        copyGenerator.points[0].position.value[0] += 30;
        copyGenerator.points[0].handleA.value[1] += 7;
      } else if (type === 'Text') {
        copyGenerator.characterPositions.offsets.c1[0] += 19;
        copyGenerator.characterPositions.styles.c1.size += 3;
        copyGenerator.characterPositions.transforms.c2.rotation += 5;
        copyGenerator.characterPositions.kerningPairs['c1:c2'] -= 2;
        copyGenerator.textWrap.width += 10;
        copyGenerator.leading.value += 2;
        copyGenerator.params.position.value[0] += 30;
      } else {
        copyGenerator.params[type === 'Image' ? 'position' : 'center'].value[0] += 30;
      }
      assert.deepEqual(f.layer, before.layers[1], 'copy edits cannot mutate source records');
      assert.doesNotThrow(() => validate(structuredClone(f.doc)));
      const reopened = deserialize(serialize(f.doc));
      assert.deepEqual(reopened, f.doc);
      assert.equal(exportSVG(reopened, fonts), exportSVG(f.doc, fonts));
    });
  }
}

test('Curve closure/open state, relative handles and 128-anchor bound survive independent copies', () => {
  for (const closed of [true, false]) {
    const f = duplicationDocument('Curve');
    f.generator.params.closed.value = closed;
    for (const count of [3, 128]) {
      f.generator.points = Array.from({ length: count }, (_, i) =>
        point(
          200 + 90 * Math.cos((i * 2 * Math.PI) / count),
          220 + 80 * Math.sin((i * 2 * Math.PI) / count),
        ),
      );
      const before = structuredClone(f.layer),
        result = duplicateArtworkLayer(f.doc, f.layer.id, options),
        copy = f.doc.layers.find((l) => l.id === result.layerId),
        target = copy.nodes.find((n) => n.type === 'Curve');
      assert.equal(target.params.closed.value, closed);
      assert.equal(target.points.length, count);
      assert.equal(svg(f.doc, copy), svg(f.doc, f.layer));
      for (const p of target.points) p.position.value[0] += 10;
      assert.deepEqual(f.layer, before);
    }
  }
});

test('one History step restores exact document and Redo reuses the same copied IDs', () => {
  const f = duplicationDocument('Curve'),
    h = new History(f.doc),
    before = serialize(h.doc);
  h.apply((doc) => duplicateArtworkLayer(doc, f.layer.id, options));
  const after = serialize(h.doc);
  assert.equal(h.past.length, 1);
  for (let i = 0; i < 3; i++) {
    h.undo();
    assert.equal(serialize(h.doc), before);
    h.redo();
    assert.equal(serialize(h.doc), after);
  }
});

test('embedded fonts and images reuse exact asset objects/bytes without collection or source freeze', () => {
  const f = duplicationDocument('Text'),
    asset = makeFontAsset(buffer, 'Shared.ttf');
  richDuplicationText(f.generator);
  f.doc.fontAssets = { [asset.id]: { ...asset.asset } };
  f.generator.font = asset.id;
  f.generator.characterPositions.styles.c1.font = asset.id;
  const fontAssets = f.doc.fontAssets,
    font = fontAssets[asset.id],
    imageAssets = f.doc.imageAssets,
    image = imageAssets['image-shared'],
    before = structuredClone({ fontAssets, imageAssets });
  const loaded = resolveFonts(f.doc, fonts);
  duplicateArtworkLayer(f.doc, f.layer.id, { fonts: loaded });
  assert.strictEqual(f.doc.fontAssets, fontAssets);
  assert.strictEqual(fontAssets[asset.id], font);
  assert.strictEqual(f.doc.imageAssets, imageAssets);
  assert.strictEqual(imageAssets['image-shared'], image);
  assert.equal(Object.isFrozen(font), false);
  assert.equal(Object.isFrozen(image), false);
  assert.deepEqual({ fontAssets, imageAssets }, before);
  assert.equal(evaluate(f.doc.layers[2], loaded, imageAssets).error, null);
});

test('unsupported, malformed, cross-source and invalid asset documents fail atomically', () => {
  const cases = [
    ['locked', (f) => (f.layer.locked = true)],
    ['hidden', (f) => (f.layer.visible = false)],
    ['guide', (f) => (f.layer.guide = true)],
    ['extra node', (f) => f.layer.nodes.push(node('Null'))],
    ['Reference', (f) => f.layer.nodes.push(node('Reference'))],
    ['bypass', (f) => (f.generator.bypassed = true)],
    ['node lock', (f) => (f.output.locked = true)],
    ['position lock', (f) => (f.generator.params.center.locked = true)],
    ['position expression', (f) => (f.generator.params.center.expression = '10; 20')],
    [
      'driven paint',
      (f) => {
        const value = node('Value');
        f.layer.nodes.push(value);
        f.fill.params.color.source = value.id;
      },
    ],
    ['external source', (f) => (f.generator.extraRecord = { source: f.doc.layers[2].nodes[0].id })],
    ['invalid artboard', (f) => (f.doc.width = NaN)],
    ['duplicate global ID', (f) => (f.doc.layers[0].id = f.layer.id)],
    ['invalid card', (f) => (f.generator.position = [NaN, 20])],
    ['invalid assets', (f) => (f.doc.imageAssets['image-shared'].width = 0)],
    ['too-long copy name', (f) => (f.layer.name = 'x'.repeat(100000))],
    ['schema 1', (f) => (f.doc.schemaVersion = 1)],
    ['null assets', (f) => (f.doc.fontAssets = null)],
    ['array assets', (f) => (f.doc.imageAssets = [])],
    ['primitive asset record', (f) => (f.doc.fontAssets = { 'font-invalid': 7 })],
  ];
  for (const [name, mutate] of cases) {
    const f = duplicationDocument();
    mutate(f);
    assert.doesNotThrow(() => unchangedReject(f), name);
  }
  for (const kind of ['Stroke', 'Linear Gradient Fill', 'Radial Gradient Fill', 'Path Remap']) {
    const f = duplicationDocument(),
      n = node(kind);
    f.layer.nodes[2] = n;
    n.params.path.source = f.generator.id;
    f.output.params.path.source = n.id;
    unchangedReject(f);
  }
  const curve = duplicationDocument('Curve');
  curve.generator.points = Array.from({ length: 129 }, (_, i) =>
    point(200 + Math.cos(i) * 80, 200 + Math.sin(i) * 80),
  );
  assert.match(supported(curve).reason, /128 anchors/);
  unchangedReject(curve, /128 anchors/);
  const text = duplicationDocument('Text');
  richDuplicationText(text.generator);
  text.generator.text = 'Changed text';
  assert.equal(supported(text).code, 'suspended-characters');
  unchangedReject(text, /suspended character/);
  text.generator.pathAttachment = {
    nodeId: 'outside',
    contourId: 'outside',
    startMode: 'distance',
    start: 0,
    reversed: false,
  };
  unchangedReject(text);
  const image = duplicationDocument('Image');
  delete image.doc.imageAssets['image-shared'];
  unchangedReject(image);
});

test('UUID collisions reject before publication, including an existing global guide ID', () => {
  for (const prefix of ['layer', 'node', 'pt']) {
    const f = duplicationDocument('Curve');
    const id = `${prefix}-collision`;
    if (prefix === 'layer') f.layer.id = id;
    if (prefix === 'node') {
      const old = f.generator.id;
      f.generator.id = id;
      f.fill.params.path.source = id;
      assert.notEqual(old, id);
    }
    if (prefix === 'pt') f.generator.points[0].id = id;
    mock.method(globalThis.crypto, 'randomUUID', () => 'collision');
    try {
      unchangedReject(f, /collision/);
    } finally {
      mock.restoreAll();
    }
  }
});

test('global guide ID collisions and external sources are refused without mutation', () => {
  const f = duplicationDocument();
  f.doc.editor = guideDefaults();
  f.doc.editor.guides.push({ id: 'layer-collision', axis: 'x', position: 12, locked: true });
  mock.method(globalThis.crypto, 'randomUUID', () => 'collision');
  try {
    unchangedReject(f, /collision/);
  } finally {
    mock.restoreAll();
  }
  const external = duplicationDocument();
  external.generator.extraRecord = { nested: { source: external.doc.layers[2].nodes[0].id } };
  assert.equal(supported(external).code, 'external-source');
  unchangedReject(external, /outside/);
});

test('99 layers can duplicate to 100; at capacity rejection preserves all existing state', () => {
  const f = duplicationDocument();
  while (f.doc.layers.length < 99) f.doc.layers.push(blankLayer());
  duplicateArtworkLayer(f.doc, f.layer.id, options);
  assert.equal(f.doc.layers.length, 100);
  assert.equal(supported(f).code, 'layer-limit');
  unchangedReject(f, /100 layers/);
});
