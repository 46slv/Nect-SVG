import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Window } from 'happy-dom';
import {
  document,
  node,
  layer,
  evaluate,
  exportSVG,
  exportScene,
  validate,
  serialize,
  deserialize,
  History,
  cloneDocument,
  pathBounds,
  connect,
} from '../src/core.js';
import {
  validateImageAssets,
  decodeImage,
  pngSize,
  checkImageSize,
  sourceImageSize,
} from '../src/images.js';
import { importSVG } from '../src/svg-import.js';
import { pngDimensions } from '../src/raster.js';
const data =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
function imageDoc() {
  const doc = document(),
    n = node('Image'),
    out = node('Image Output'),
    l = layer('Embedded <red>');
  doc.imageAssets = {
    'image-test': { name: 'red.png', mime: 'image/png', width: 1, height: 1, data },
  };
  n.asset = 'image-test';
  n.params.position.value = [12, 23];
  n.params.size.value = [45, 67];
  out.params.path.source = n.id;
  l.nodes = [n, out];
  l.output = out.id;
  doc.layers.push(l);
  return { doc, l, n, out };
}
test('embedded Image evaluates independently, serializes, exports and shares immutable assets through Undo', () => {
  const { doc, l, n } = imageDoc();
  validate(doc);
  const r = evaluate(l, {}, doc.imageAssets);
  assert.equal(r.error, null);
  assert.deepEqual(pathBounds(r.path), [
    [12, 34.5, 57],
    [23, 56.5, 90],
  ]);
  assert.match(exportSVG(doc), /<image .*x="12" y="23" width="45" height="67"/);
  assert.match(exportSVG(doc), /data:image\/png;base64,/);
  assert.equal(exportSVG(deserialize(serialize(doc))), exportSVG(doc));
  assert.strictEqual(cloneDocument(doc).imageAssets['image-test'], doc.imageAssets['image-test']);
  const history = new History(doc),
    original = exportSVG(doc);
  history.apply((d) => (d.layers[1].nodes[0].params.position.value = [2, 3]));
  assert.notEqual(exportSVG(history.doc), original);
  history.undo();
  assert.equal(exportSVG(history.doc), original);
  history.redo();
  assert.notEqual(exportSVG(history.doc), original);
  n.params.size.value = [-1, 2];
  assert.match(evaluate(l, {}, doc.imageAssets).error, /size must be positive/);
});
test('Image cannot enter Path-only Boolean, Transform, Remap or Output, even through forged JSON', () => {
  const { doc, l, n, out } = imageDoc();
  for (const type of ['Boolean', 'Transform', 'Path Remap', 'Output']) {
    const target = node(type);
    l.nodes.push(target);
    assert.throws(
      () => connect(l, n.id, target.id, type === 'Boolean' ? 'a' : 'path'),
      /Cannot connect Image to (?:Painted)?Path/,
    );
  }
  const circle = node('Circle');
  l.nodes.push(circle);
  assert.throws(() => connect(l, circle.id, out.id, 'path'), /Cannot connect Path to Image/);
  const target = l.nodes.find((n) => n.type === 'Boolean');
  target.params.a.source = n.id;
  assert.throws(() => deserialize(serialize(doc)), /Cannot connect Image to (?:Painted)?Path/);
});
test('Image assets enforce format, dimensions, aggregate bytes and local-only data', () => {
  const { doc } = imageDoc();
  for (const patch of [
    { mime: 'image/svg+xml' },
    { data: 'https://example.com/x.png' },
    { width: 2 },
    { data: data.slice(0, -8) },
  ]) {
    const candidate = structuredClone(doc);
    Object.assign(candidate.imageAssets['image-test'], patch);
    assert.throws(() => validate(candidate));
  }
  const corrupt = decodeImage(data);
  corrupt[41] ^= 1;
  assert.throws(() => pngSize(corrupt), /checksum/);
  assert.deepEqual(pngSize(decodeImage(data)), { width: 1, height: 1 });
  assert.equal(sourceImageSize(decodeImage(data).buffer).mime, 'image/png');
  assert.throws(() => sourceImageSize(new TextEncoder().encode('<svg/>').buffer), /PNG or JPEG/);
  assert.throws(() => checkImageSize(8193, 1));
  assert.throws(() => checkImageSize(5000, 5000));
  assert.throws(() => validateImageAssets([]));
  const missing = structuredClone(doc);
  delete missing.imageAssets;
  assert.throws(() => validate(missing), /Missing image asset/);
});
test('all exports use an artboard scene excluding hidden and guide images, with no editor markup', () => {
  const { doc, l } = imageDoc();
  doc.width = 320;
  doc.height = 240;
  const visible = exportSVG(doc);
  assert.match(visible, /width="320" height="240" viewBox="0 0 320 240"/);
  assert.doesNotMatch(visible, /class=|selection|grid|background/);
  assert.equal(exportScene(doc).length, 2);
  l.guide = true;
  assert.doesNotMatch(exportSVG(doc), /<image/);
  l.guide = false;
  l.visible = false;
  assert.doesNotMatch(exportSVG(doc), /<image/);
  assert.deepEqual(pngDimensions(doc, 2), { width: 640, height: 480 });
  assert.throws(() => pngDimensions(doc, 0));
  assert.throws(() => pngDimensions({ ...doc, width: 8192, height: 8192 }, 1));
});
test('real SVG file roundtrip preserves vector artboard and layers; raster SVG import explicitly refuses', async () => {
  const win = new Window();
  const doc = document();
  doc.width = 777;
  doc.height = 333;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nect-export-'));
  try {
    await fs.writeFile(path.join(dir, 'input.json'), serialize(doc));
    execFileSync(process.execPath, [
      'cli/export.js',
      path.join(dir, 'input.json'),
      path.join(dir, 'art.svg'),
    ]);
    const svg = await fs.readFile(path.join(dir, 'art.svg'), 'utf8');
    const restored = importSVG(svg, win.DOMParser);
    assert.equal(restored.width, 777);
    assert.equal(restored.height, 333);
    assert.equal(restored.layers[0].name, doc.layers[0].name);
    assert.equal(evaluate(restored.layers[0]).error, null);
    assert.throws(
      () => importSVG(exportSVG(imageDoc().doc), win.DOMParser),
      /Unsupported SVG element: image/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
