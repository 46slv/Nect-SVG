import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  connect,
  deserialize,
  document,
  evaluate,
  exportSVG,
  guideDefaults,
  History,
  node,
  outputType,
  serialize,
  uid,
  validate,
} from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import {
  ARTWORK_TYPES,
  appendArtwork,
  createPenArtworkDraft,
  appendPenArtwork,
} from '../src/artwork-creation.js';

const fontBytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url)),
  fonts = {
    default: parseFont(
      fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
    ),
  },
  png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

function oldArtwork() {
  const doc = document(),
    old = doc.layers[0];
  doc.schemaVersion = 10;
  doc.name = 'Preserve my work';
  doc.editor = guideDefaults();
  doc.editor.guides.push({ id: uid('guide'), axis: 'x', position: 60, locked: true });
  old.name = 'Old Boolean artwork';
  old.locked = true;
  old.nodes[0].params.center.locked = true;
  old.nodes[0].params.radius.expression = '60 + 60';
  old.nodes[0].position = [83, 121];
  old.nodes[0].collapsed = true;
  old.nodes[0].width = 320;
  old.nodes[4].bypassed = false;
  const value = node('Value', 12, 710);
  value.params.value.value = 140;
  old.nodes.push(value);
  connect(old, value.id, old.nodes[0].id, 'radius');
  return doc;
}

function withoutLast(doc) {
  return serialize({ ...doc, layers: doc.layers.slice(0, -1) });
}

function layerFor(doc, result) {
  const layer = doc.layers.find((l) => l.id === result.layerId);
  assert.ok(layer);
  assert.equal(layer.nodes[0].id, result.nodeId);
  return layer;
}

test('every supported tool appends exactly one minimal, typed, independently editable artwork', () => {
  assert.deepEqual(ARTWORK_TYPES, ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Text']);
  assert.ok(Object.isFrozen(ARTWORK_TYPES));
  for (const type of ARTWORK_TYPES) {
    const doc = oldArtwork(),
      before = serialize(doc),
      layers = doc.layers,
      old = doc.layers[0],
      oldNodes = [...old.nodes],
      at = [123.5, -48.25],
      result = appendArtwork(doc, type, { at }),
      artwork = layerFor(doc, result),
      [generator, fill, output] = artwork.nodes;
    assert.equal(doc.layers.length, 2, type);
    assert.strictEqual(doc.layers, layers);
    assert.strictEqual(doc.layers[0], old);
    assert.ok(oldNodes.every((n, i) => n === old.nodes[i]));
    assert.equal(withoutLast(doc), before, `${type}: old document serialization is exact`);
    assert.equal(artwork, doc.layers.at(-1), `${type}: append is frontmost paint order`);
    assert.equal(artwork.name, type);
    assert.equal(artwork.visible, true);
    assert.equal(artwork.locked, false);
    assert.equal(artwork.nodes.length, 3);
    assert.deepEqual(
      artwork.nodes.map((n) => n.type),
      [type, 'Fill', 'Output'],
    );
    assert.equal(artwork.output, output.id);
    assert.equal(fill.params.path.source, generator.id);
    assert.equal(output.params.path.source, fill.id);
    assert.equal(outputType(generator), 'Path');
    assert.equal(outputType(fill), 'PaintedPath');
    assert.equal(outputType(output), 'PaintedPath');
    const position = generator.params[type === 'Text' ? 'position' : 'center'];
    assert.deepEqual(position.value, at);
    assert.notStrictEqual(position.value, at);
    assert.equal(position.locked, false);
    assert.equal(position.expression, '');
    assert.equal(position.source, undefined);
    assert.deepEqual(fill.params.color.value, { hex: '#36434e', alpha: 1 });
    assert.equal(evaluate(artwork, fonts).error, null);
    assert.doesNotThrow(() => validate(structuredClone(doc)));
    at[0] = 999;
    assert.equal(position.value[0], 123.5, 'caller coordinates cannot mutate artwork later');
    position.value[0] = 222;
    assert.equal(withoutLast(doc), before, 'editing new artwork does not mutate previous art');
  }
});

test('new layers retain explicit names and shapes keep node-default dimensions/settings', () => {
  for (const type of ARTWORK_TYPES) {
    const doc = oldArtwork(),
      defaults = node(type),
      result = appendArtwork(doc, type, { at: [20, 30], name: '図形 <&> custom' }),
      artwork = layerFor(doc, result),
      generator = artwork.nodes[0],
      key = type === 'Text' ? 'position' : 'center';
    assert.equal(artwork.name, '図形 <&> custom');
    assert.equal(generator.name, type);
    for (const [parameter, value] of Object.entries(defaults.params))
      if (parameter !== key) assert.deepEqual(generator.params[parameter], value);
    assert.equal(generator.text, defaults.text);
    assert.equal(generator.font, 'default');
  }
});

test('repeated independent creation preserves every old layer, graph wire, lock and output', () => {
  const doc = oldArtwork(),
    ids = new Set();
  for (let i = 0; i < 30; i++) {
    const before = serialize(doc),
      result = appendArtwork(doc, ARTWORK_TYPES[i % ARTWORK_TYPES.length], { at: [i, i * 2] });
    assert.equal(withoutLast(doc), before);
    const artwork = layerFor(doc, result);
    for (const id of [artwork.id, ...artwork.nodes.map((n) => n.id)]) {
      assert.equal(ids.has(id), false);
      ids.add(id);
    }
  }
  const allIds = doc.layers.flatMap((l) => [l.id, ...l.nodes.map((n) => n.id)]);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(doc.layers[0].locked, true);
});

test('caller-owned History records creation as one change and restores exact Undo/Redo documents', () => {
  const history = new History(oldArtwork()),
    before = serialize(history.doc);
  let result;
  history.apply((doc) => {
    result = appendArtwork(doc, 'Circle', { at: [400, 300] });
  });
  const after = serialize(history.doc);
  assert.equal(history.past.length, 1);
  assert.equal(history.future.length, 0);
  history.undo();
  assert.equal(serialize(history.doc), before);
  history.redo();
  assert.equal(serialize(history.doc), after);
  layerFor(history.doc, result);
  history.undo();
  history.apply((doc) => appendArtwork(doc, 'Text', { at: [120, 150] }));
  assert.equal(history.future.length, 0);
  assert.equal(history.past.length, 1);
});

test('JSON reopen and SVG export retain all previous artwork alongside every new generator', () => {
  const doc = oldArtwork(),
    oldSVG = exportSVG(doc, fonts),
    oldElements = oldSVG.slice(oldSVG.indexOf('>') + 1, oldSVG.lastIndexOf('</svg>')),
    oldJSON = serialize(doc);
  for (const type of ARTWORK_TYPES) appendArtwork(doc, type, { at: [200, 230] });
  const saved = serialize(doc),
    reopened = deserialize(saved),
    svg = exportSVG(reopened, fonts);
  assert.equal(serialize(reopened), saved);
  assert.equal(serialize({ ...reopened, layers: reopened.layers.slice(0, 1) }), oldJSON);
  assert.ok(svg.includes(oldElements), 'old exported paths and paint are byte-for-byte retained');
  assert.equal((svg.match(/<path /g) || []).length, 7);
  assert.equal(exportSVG(doc, fonts), svg);
  assert.match(svg, /data-layer="Text"/);
});

test('preserves font/image assets, identities and original mutability on success and rejection', () => {
  for (const valid of [true, false]) {
    const doc = oldArtwork();
    doc.fontAssets = {
      'font-existing': {
        name: 'DejaVu Sans',
        fileName: 'DejaVuSans.ttf',
        data: fontBytes.toString('base64'),
      },
    };
    doc.imageAssets = {
      'image-existing': { name: 'red.png', mime: 'image/png', width: 1, height: 1, data: png },
    };
    if (!valid) doc.width = -1;
    const before = serialize(doc),
      fontAssets = doc.fontAssets,
      imageAssets = doc.imageAssets,
      font = fontAssets['font-existing'],
      image = imageAssets['image-existing'];
    assert.equal(Object.isFrozen(font), false);
    assert.equal(Object.isFrozen(image), false);
    if (valid) {
      appendArtwork(doc, 'Rectangle', { at: [100, 200] });
      assert.equal(withoutLast(doc), before);
    } else {
      assert.throws(() => appendArtwork(doc, 'Rectangle', { at: [100, 200] }), /artboard/);
      assert.equal(serialize(doc), before);
    }
    assert.strictEqual(doc.fontAssets, fontAssets);
    assert.strictEqual(doc.imageAssets, imageAssets);
    assert.strictEqual(doc.fontAssets['font-existing'], font);
    assert.strictEqual(doc.imageAssets['image-existing'], image);
    assert.equal(Object.isFrozen(font), false);
    assert.equal(Object.isFrozen(image), false);
  }
});

test('preserves all supported current schemas and rejects implicit schema1 migration atomically', () => {
  for (let version = 2; version <= 10; version++) {
    const doc = document();
    doc.schemaVersion = version;
    const before = serialize(doc);
    appendArtwork(doc, 'Text', { at: [0, 0] });
    assert.equal(doc.schemaVersion, version);
    assert.equal(withoutLast(doc), before);
  }
  const legacy = document();
  legacy.schemaVersion = 1;
  const before = serialize(legacy);
  assert.throws(() => appendArtwork(legacy, 'Circle', { at: [0, 0] }), /Upgrade schemaVersion 1/);
  assert.equal(serialize(legacy), before);
});

test('validating a candidate does not copy legacy normalization into existing nodes', () => {
  const doc = document(),
    text = node('Text');
  delete text.params.letterSpacing;
  delete text.params.lineSpacing;
  doc.layers[0].nodes.push(text);
  const before = serialize(doc);
  appendArtwork(doc, 'Ellipse', { at: [30, 50] });
  assert.equal(withoutLast(doc), before);
  assert.equal(Object.hasOwn(text.params, 'letterSpacing'), false);
  assert.equal(Object.hasOwn(text.params, 'lineSpacing'), false);
});

test('100-layer model limit is checked without modifying a document at capacity', () => {
  const doc = document();
  for (let i = 1; i < 99; i++) appendArtwork(doc, 'Circle', { at: [i, i] });
  assert.equal(doc.layers.length, 99);
  appendArtwork(doc, 'Text', { at: [10, 10] });
  assert.equal(doc.layers.length, 100);
  const before = serialize(doc);
  assert.throws(() => appendArtwork(doc, 'Star', { at: [10, 10] }), /100/);
  assert.equal(serialize(doc), before);
});

test('unsupported tools, invalid positions/names and malformed existing documents fail atomically', () => {
  const attempts = [
    (d) => appendArtwork(d, 'Curve', { at: [10, 20] }),
    (d) => appendArtwork(d, 'Pen', { at: [10, 20] }),
    (d) => appendArtwork(d, 'Image', { at: [10, 20] }),
    (d) => appendArtwork(d, 'Fill', { at: [10, 20] }),
    (d) => appendArtwork(d, 'Circle'),
    ...[null, [], [1], [1, 2, 3], [NaN, 1], [1, Infinity], ['1', 2], Array(2)].map(
      (at) => (d) => appendArtwork(d, 'Circle', { at }),
    ),
    ...[null, 5, {}, 'x'.repeat(100001)].map(
      (name) => (d) => appendArtwork(d, 'Text', { at: [10, 20], name }),
    ),
  ];
  for (const attempt of attempts) {
    const doc = oldArtwork(),
      before = serialize(doc);
    assert.throws(() => attempt(doc));
    assert.equal(serialize(doc), before);
  }
  for (const breakDocument of [
    (d) => (d.width = 0),
    (d) => (d.layers[0].nodes[0].params.radius.value = Infinity),
    (d) => (d.layers[0].output = 'missing-output'),
    (d) => (d.layers[0].nodes[0].id = d.layers[0].nodes[1].id),
    (d) => (d.layers[0].nodes[4].params.path.source = 'missing-source'),
    (d) => (d.schemaVersion = 11),
    (d) => (d.layers = []),
  ]) {
    const doc = oldArtwork();
    breakDocument(doc);
    const before = serialize(doc);
    assert.throws(() => appendArtwork(doc, 'Circle', { at: [10, 20] }));
    assert.equal(serialize(doc), before);
  }
});

test('hidden or guide-only locked old layers cannot hide or lock newly appended artwork', () => {
  const doc = oldArtwork();
  doc.layers[0].visible = false;
  doc.layers[0].guide = true;
  const before = serialize(doc),
    result = appendArtwork(doc, 'Star', { at: [150, 150] }),
    artwork = layerFor(doc, result);
  assert.equal(withoutLast(doc), before);
  assert.equal(artwork.visible, true);
  assert.equal(artwork.locked, false);
  assert.equal(artwork.guide, undefined);
  assert.equal((exportSVG(doc, fonts).match(/<path /g) || []).length, 1);
});

test('an unexpected UUID collision rejects the whole creation before append', () => {
  const doc = oldArtwork(),
    before = serialize(doc),
    originalUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
  let first = true;
  const uuid = mock.method(globalThis.crypto, 'randomUUID', () => {
    if (first) {
      first = false;
      return doc.layers[0].nodes[0].id.slice('node-'.length);
    }
    return originalUUID();
  });
  try {
    assert.throws(() => appendArtwork(doc, 'Circle', { at: [10, 20] }), /duplicate ID/);
    assert.equal(serialize(doc), before);
  } finally {
    uuid.mock.restore();
  }
});

test('malformed asset containers and records reject without freezing source records', () => {
  for (const key of ['fontAssets', 'imageAssets'])
    for (const value of [null, [], [{ name: 'mutable' }], { broken: { name: 'mutable' } }]) {
      const doc = oldArtwork();
      doc[key] = value;
      const before = serialize(doc),
        objects = value ? Object.values(value).filter((a) => a && typeof a === 'object') : [];
      assert.throws(() => appendArtwork(doc, 'Circle', { at: [10, 20] }));
      assert.equal(serialize(doc), before);
      assert.strictEqual(doc[key], value);
      assert.ok(objects.every((asset) => !Object.isFrozen(asset)));
    }
});

test('Pen preview is detached and finished paths append atomically as one independent layer', () => {
  const doc = oldArtwork(),
    before = serialize(doc),
    oldLayer = doc.layers[0],
    draft = createPenArtworkDraft(doc, [72.25, 81.5]),
    curve = draft.nodes[0];
  assert.equal(serialize(doc), before);
  assert.strictEqual(doc.layers[0], oldLayer);
  assert.equal(curve.params.closed.value, false);
  assert.deepEqual(curve.points[0].position.value, [72.25, 81.5]);
  assert.throws(() => appendPenArtwork(doc, draft), /two points/);
  assert.equal(serialize(doc), before);
  curve.points.push(node('Curve').points[1]);
  curve.points[0].handleA.value = [-12, -15];
  curve.points[0].handleB.value = [12, 15];
  const h = new History(doc);
  let ids;
  h.apply((d) => {
    ids = appendPenArtwork(d, draft);
  });
  const after = serialize(h.doc);
  assert.equal(withoutLast(h.doc), before);
  assert.strictEqual(doc.layers[0], oldLayer);
  assert.equal(h.past.length, 1);
  assert.equal(layerFor(h.doc, ids).nodes.length, 3);
  assert.notStrictEqual(layerFor(h.doc, ids), draft);
  curve.points[0].position.value[0] = 999;
  assert.equal(serialize(h.doc), after, 'detached preview cannot mutate committed artwork');
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  assert.equal(serialize(h.doc), after);
  assert.equal(serialize(deserialize(after)), after);
});

test('Pen rejects capacity, duplicate IDs, invalid points and over-budget drafts without mutation', () => {
  const doc = oldArtwork(),
    draft = createPenArtworkDraft(doc, [10, 20]);
  draft.nodes[0].points.push(node('Curve').points[1]);
  for (const breakDraft of [
    (d) => {
      d.nodes[0].points[1].id = d.nodes[0].points[0].id;
    },
    (d) => {
      d.nodes[0].points[1].position.value[0] = Infinity;
    },
    (d) => {
      d.nodes[0].points = Array.from({ length: 10001 }, () => node('Curve').points[0]);
    },
    (d) => {
      d.id = doc.layers[0].id;
    },
  ]) {
    const broken = structuredClone(draft),
      before = serialize(doc);
    breakDraft(broken);
    assert.throws(() => appendPenArtwork(doc, broken));
    assert.equal(serialize(doc), before);
  }
  const atCapacity = oldArtwork();
  while (atCapacity.layers.length < 100) appendArtwork(atCapacity, 'Circle', { at: [20, 30] });
  const before = serialize(atCapacity);
  assert.throws(() => createPenArtworkDraft(atCapacity, [10, 20]), /100/);
  assert.throws(() => appendPenArtwork(atCapacity, draft), /100/);
  assert.equal(serialize(atCapacity), before);
});

test('Pen creation keeps mutable asset records and locked/hidden outputs untouched', () => {
  const doc = oldArtwork();
  doc.layers[0].visible = false;
  doc.layers[0].nodes.at(-2).params.path.locked = true;
  doc.imageAssets = {
    'image-existing': { name: 'red', mime: 'image/png', width: 1, height: 1, data: png },
  };
  const asset = doc.imageAssets['image-existing'],
    before = serialize(doc),
    draft = createPenArtworkDraft(doc, [100, 100]);
  draft.nodes[0].points.push(node('Curve').points[1]);
  draft.nodes[0].params.closed.value = true;
  appendPenArtwork(doc, draft);
  assert.equal(withoutLast(doc), before);
  assert.strictEqual(doc.imageAssets['image-existing'], asset);
  assert.equal(Object.isFrozen(asset), false);
  assert.equal(doc.layers.at(-1).visible, true);
  assert.equal(doc.layers.at(-1).locked, false);
});
