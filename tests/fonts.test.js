import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseFont,
  makeFontAsset,
  resolveFonts,
  validateFontAssets,
  MAX_FONT_BYTES,
} from '../src/fonts.js';
import { layoutText } from '../src/text-layout.js';
import {
  document,
  node,
  clone,
  evaluate,
  exportSVG,
  serialize,
  deserialize,
  History,
} from '../src/core.js';
const bytes = (name = 'NectJPFixture-Regular.otf') => {
  const b = fs.readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
function scene(format = 'otf') {
  const doc = document(),
    text = node('Text'),
    out = node('Output');
  const imported = makeFontAsset(bytes(`NectJPFixture-Regular.${format}`), `fixture.${format}`);
  doc.fontAssets = { [imported.id]: imported.asset };
  text.font = imported.id;
  text.text = '「日本。、」ABC12\n（文章）123';
  text.writingMode = 'vertical-rl';
  text.params.position.value = [700, 20];
  text.params.size.value = 40;
  out.params.path.source = text.id;
  doc.layers[0].nodes = [text, out];
  doc.layers[0].output = out.id;
  return { doc, text, font: imported.font };
}
test('static OTF/CFF and TTF/glyf Japanese fonts produce finite outlines and real vertical alternates', () => {
  for (const format of ['otf', 'ttf']) {
    const { doc, font } = scene(format);
    const layout = layoutText(font, '「日本。、」ーぁABC12\n（文章）123', {
      position: [700, 20],
      size: 40,
      writingMode: 'vertical-rl',
    });
    assert.deepEqual(layout.warnings, []);
    for (const char of '「。、」ーぁ（）') {
      const glyph = layout.glyphs.find((g) => g.char === char);
      assert.equal(glyph.substituted, true, char);
      assert.equal(glyph.rotation, 0, char);
    }
    for (const char of '日本文章')
      assert.equal(layout.glyphs.find((g) => g.char === char).rotation, 0);
    for (const char of 'ABC123') {
      const glyph = layout.glyphs.find((g) => g.char === char);
      assert.equal(glyph.rotation, 90);
      assert.equal(glyph.id, glyph.originalId);
    }
    assert.ok(layout.glyphs.find((g) => g.line === 1).x < layout.glyphs[0].x);
    const firstColumn = layout.glyphs.filter((g) => g.line === 0);
    assert.ok(firstColumn.every((g, i) => i === 0 || g.y > firstColumn[i - 1].y));
    assert.equal(evaluate(doc.layers[0], resolveFonts(doc)).error, null);
    assert.match(exportSVG(doc), /<path/);
    assert.doesNotMatch(exportSVG(doc), /<text|NaN|Infinity/);
  }
});
test('spacing affects vertical advance and right-to-left columns; empty lines and spaces retain advance', () => {
  const font = parseFont(bytes());
  const options = {
    position: [300, 20],
    size: 50,
    writingMode: 'vertical-rl',
    letterSpacing: 7,
    lineSpacing: 1.8,
  };
  const { glyphs } = layoutText(font, '日 本\n\n語', options);
  assert.equal(glyphs[1].y - glyphs[0].y, 57);
  assert.ok(glyphs[2].y > glyphs[1].y);
  assert.equal(glyphs[3].line, 2);
  assert.equal(glyphs[3].x, 120);
  assert.equal(glyphs[3].y, 20);
  const horizontal = layoutText(font, '日本\n語', { ...options, writingMode: 'horizontal-tb' });
  assert.equal(horizontal.glyphs[1].x - horizontal.glyphs[0].x, 57);
  assert.equal(horizontal.glyphs[2].y, 110);
  assert.equal(layoutText(font, '', options).path.commands.length, 0);
});
test('JSON embeds exact reusable font bytes and preserves SVG including after editing new text', () => {
  const { doc, text } = scene();
  const restored = deserialize(serialize(doc));
  assert.equal(exportSVG(restored), exportSVG(doc));
  restored.layers[0].nodes[0].text = '世界の麺';
  assert.throws(() => exportSVG(restored), /Missing glyphs/); // The fixture deliberately lacks の.
  restored.layers[0].nodes[0].text = '世界麺';
  assert.match(exportSVG(restored), /<path/);
  const imported = makeFontAsset(bytes(), 'renamed-copy.otf', doc.fontAssets);
  assert.equal(imported.id, text.font);
  assert.equal(Object.keys(doc.fontAssets).length, 1);
});
test('headless CLI uses saved font assets and produces byte-identical SVG without system fonts', () => {
  const { doc } = scene();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nect-font-test-'));
  try {
    const input = path.join(temp, 'project.json'),
      output = path.join(temp, 'output.svg');
    fs.writeFileSync(input, serialize(doc));
    const result = spawnSync(process.execPath, ['cli/export.js', input, output], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), exportSVG(doc));
    const repeated = spawnSync(process.execPath, ['cli/export.js', input, output], {
      encoding: 'utf8',
    });
    assert.equal(repeated.status, 1); // Existing output is never overwritten.
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('missing glyphs, uncombined marks and unsupported selectors fail without silently replacing text', () => {
  const font = parseFont(bytes()),
    opts = { position: [0, 0], size: 50 };
  for (const text of ['🦊', 'Ж', '\uFE0F', 'a\u0305', '\t'])
    assert.throws(() => layoutText(font, text, opts), /Missing glyphs|unsupported/);
  assert.equal(
    layoutText(font, 'カ\u3099', opts).path.toPathData(5),
    layoutText(font, 'ガ', opts).path.toPathData(5),
  );
});
test('invalid/missing font assets and malformed writing modes reject the candidate transactionally', () => {
  const { doc } = scene(),
    history = new History(doc),
    before = serialize(doc);
  for (const mutate of [
    (d) => {
      d.fontAssets = {};
    },
    (d) => {
      d.fontAssets[Object.keys(d.fontAssets)[0]].data = 'not base64';
    },
    (d) => {
      d.fontAssets[Object.keys(d.fontAssets)[0]].data = btoa('invalid font');
    },
    (d) => {
      d.layers[0].nodes[0].writingMode = 'sideways-lr';
    },
  ]) {
    const candidate = clone(doc);
    mutate(candidate);
    assert.throws(() =>
      history.apply(() => {
        history.doc = deserialize(JSON.stringify(candidate));
      }),
    );
    assert.equal(serialize(history.doc), before);
  }
});
test('malformed, oversized, collection, variable, color and restricted fonts are explicitly rejected', () => {
  assert.throws(() => parseFont(new ArrayBuffer(MAX_FONT_BYTES + 1)), /20 MB/);
  assert.throws(() => parseFont(new Uint8Array(30).buffer), /TTF\/OTF/);
  const mutateTable = (tag, fn) => {
    const b = bytes(),
      v = new DataView(b);
    for (let i = 0; i < v.getUint16(4); i++) {
      const p = 12 + i * 16,
        found = String.fromCharCode(...new Uint8Array(b, p, 4));
      if (found === tag) {
        fn(v, p, v.getUint32(p + 8));
        return b;
      }
    }
    throw Error('Test table missing');
  };
  for (const fsType of [2, 4, 0x200])
    assert.throws(
      () => parseFont(mutateTable('OS/2', (v, p, o) => v.setUint16(o + 8, fsType))),
      /restricts/,
    );
  for (const [tag, expected] of [
    ['fvar', /Variable/],
    ['COLR', /Color/],
  ])
    assert.throws(
      () =>
        parseFont(
          mutateTable('GPOS', (v, p) =>
            [...tag].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0))),
          ),
        ),
      expected,
    );
  assert.throws(
    () => parseFont(mutateTable('cmap', (v, p) => v.setUint32(p + 8, 0xffffffff))),
    /bounds/,
  );
  const { doc } = scene(),
    asset = Object.values(doc.fontAssets)[0];
  assert.throws(
    () =>
      validateFontAssets(
        Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`font-${i}`, asset])),
      ),
    /maximum 8/,
  );
});
test('legacy Text nodes migrate default spacing without changing text or horizontal SVG', () => {
  const { doc } = scene();
  const text = doc.layers[0].nodes[0];
  text.writingMode = 'horizontal-tb';
  const before = exportSVG(doc);
  delete text.writingMode;
  delete text.params.letterSpacing;
  delete text.params.lineSpacing;
  const restored = deserialize(JSON.stringify(doc));
  assert.equal(exportSVG(restored), before);
  assert.equal(restored.layers[0].nodes[0].params.lineSpacing.value, 1.2);
});
test('font/direction/spacing changes invalidate text and downstream cache but node position does not', () => {
  const { doc, text } = scene(),
    layer = doc.layers[0],
    fonts = resolveFonts(doc);
  evaluate(layer, fonts);
  assert.equal(evaluate(layer, fonts).stats.computed, 0);
  text.writingMode = 'horizontal-tb';
  assert.equal(evaluate(layer, fonts).stats.computed, 2);
  text.params.letterSpacing.value = 4;
  assert.equal(evaluate(layer, fonts).stats.computed, 2);
  text.position[0] += 100;
  assert.equal(evaluate(layer, fonts).stats.computed, 0);
  fonts[text.font] = parseFont(bytes('NectJPFixture-Regular.ttf'));
  assert.equal(evaluate(layer, fonts).stats.computed, 2);
});

test('history shares frozen font assets across ordinary edits and preserves independent document maps', () => {
  const { doc, text } = scene(),
    history = new History(doc),
    asset = doc.fontAssets[text.font];
  for (let i = 0; i < 10; i++)
    history.apply((d) => {
      d.name = `Edit ${i}`;
    });
  assert.equal(history.past.length, 10);
  assert.ok(history.past.every((d) => d.fontAssets[text.font] === asset));
  assert.ok(history.past.every((d) => d.fontAssets !== history.doc.fontAssets));
  assert.ok(Object.isFrozen(asset));
  assert.throws(() => {
    asset.data = 'corrupt';
  }, TypeError);
  const svg = exportSVG(history.doc);
  history.undo();
  history.redo();
  assert.equal(exportSVG(history.doc), svg);
});

test('malformed TrueType lazy glyph offsets reject before being saved as an asset', () => {
  const b = bytes('NectJPFixture-Regular.ttf'),
    v = new DataView(b),
    tables = {};
  for (let i = 0; i < v.getUint16(4); i++) {
    const p = 12 + i * 16,
      tag = String.fromCharCode(...new Uint8Array(b, p, 4));
    tables[tag] = v.getUint32(p + 8);
  }
  const long = v.getInt16(tables.head + 50);
  if (long) v.setUint32(tables.loca + 4, 0xffffffff);
  else v.setUint16(tables.loca + 2, 0xffff);
  assert.throws(() => makeFontAsset(b, 'broken.ttf'), /glyph bounds/);
});
