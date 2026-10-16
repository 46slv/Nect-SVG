// Run after native Windows tests. Never archive or redistribute installed font bytes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { makeFontAsset, resolveFonts } from '../src/fonts.js';
import { document, node, evaluate, serialize, deserialize } from '../src/core.js';
const path = new URL('../src-tauri/target/native-japanese-font-smoke.ttf', import.meta.url);
let bytes;
try {
  bytes = await fs.readFile(path);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.log(
    'NOT RUN: installed Japanese TTC parser/layout smoke; runner has no known Japanese TTC. Native Windows acceptance remains pending.',
  );
  process.exit(0);
}
try {
  const b = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { id, asset } = makeFontAsset(b, 'Installed Japanese font');
  const d = document(),
    t = node('Text'),
    o = node('Output');
  t.font = id;
  t.text = '日本語。ー';
  d.fontAssets = { [id]: asset };
  o.params.path.source = t.id;
  d.layers[0].nodes = [t, o];
  d.layers[0].output = o.id;
  for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    t.writingMode = writingMode;
    const result = evaluate(d.layers[0], resolveFonts(d));
    assert.equal(result.error, null);
    assert.ok(result.path.contours.length > 0);
    const restored = deserialize(serialize(d));
    assert.equal(evaluate(restored.layers[0], resolveFonts(restored)).error, null);
  }
  console.log(
    `PASS: installed Japanese TTC face ${asset.name}; extraction, embedding, Japanese horizontal/vertical outlines and JSON reload.`,
  );
} finally {
  await fs.unlink(path);
}
