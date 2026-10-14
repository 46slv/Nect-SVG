import opentype from 'opentype.js';

const rotatePunctuation = new Set([
  ...'ーｰ―—‐‑–−〜～…‥「」『』（）〔〕［］｛｝〈〉《》【】〖〗〘〙〚〛＝',
]);
const cornerPunctuation = new Set([...'、。，．']);
const smallKana = new Set([...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ']);
const upright = (char) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u.test(
    char,
  );
function coverageIndex(coverage, id) {
  if (coverage?.format === 1) return coverage.glyphs.indexOf(id);
  if (coverage?.format === 2) {
    const range = coverage.ranges.find((r) => id >= r.start && id <= r.end);
    return range ? range.index + id - range.start : -1;
  }
  return -1;
}
const verticalLookups = new WeakMap();
function substitutions(font) {
  if (verticalLookups.has(font)) return verticalLookups.get(font);
  const gsub = font.tables?.gsub;
  // Japanese script/language first; never combine unrelated language features.
  const script = ['kana', 'hani', 'DFLT', 'latn']
    .map((tag) => gsub?.scripts?.find((s) => s.tag === tag)?.script)
    .find(Boolean);
  const lang =
    script?.langSysRecords?.find((l) => l.tag === 'JAN ')?.langSys || script?.defaultLangSys;
  const features = (lang?.featureIndexes || []).map((i) => gsub.features[i]);
  const feature = features.find((f) => f.tag === 'vrt2') || features.find((f) => f.tag === 'vert');
  const lookups = (feature?.feature.lookupListIndexes || []).map((i) => gsub.lookups[i]);
  verticalLookups.set(font, lookups);
  return lookups;
}
export function verticalGlyph(font, glyph) {
  let id = glyph.index;
  for (const lookup of substitutions(font)) {
    for (const entry of lookup.subtables) {
      const type = lookup.lookupType === 7 ? entry.lookupType : lookup.lookupType;
      const sub = lookup.lookupType === 7 ? entry.extension : entry;
      if (type !== 1)
        throw Error('Unsupported contextual vertical font substitution; choose another font');
      const index = coverageIndex(sub.coverage, id);
      if (index < 0) continue;
      id = sub.substFormat === 1 ? (id + sub.deltaGlyphId) & 0xffff : sub.substitute[index];
      break;
    }
  }
  if (!Number.isInteger(id) || !id || id >= font.numGlyphs)
    throw Error('Invalid vertical glyph substitution');
  return font.glyphs.get(id);
}
function transformed(path, transform) {
  const result = new opentype.Path();
  result.commands = path.commands.map((command) => {
    const next = { ...command };
    for (const suffix of ['', '1', '2']) {
      const x = `x${suffix}`,
        y = `y${suffix}`;
      if (x in command) [next[x], next[y]] = transform(command[x], command[y]);
    }
    return next;
  });
  return result;
}
/** Deterministic bounded Japanese/Latin layout, shared by browser and headless. */
export function layoutText(
  font,
  text,
  {
    position,
    size,
    writingMode = 'horizontal-tb',
    letterSpacing = 0,
    lineSpacing = 1.2,
    alignment = 'start',
    kerning = true,
  },
) {
  if (!['start', 'center', 'end'].includes(alignment)) throw Error('Invalid text alignment');
  if (typeof kerning !== 'boolean') throw Error('Invalid kerning setting');
  if (!Number.isFinite(size) || size <= 0 || size > 100000)
    throw Error('Text size must be between 0 and 100000');
  if (
    !Number.isFinite(letterSpacing) ||
    Math.abs(letterSpacing) > 100000 ||
    !Number.isFinite(lineSpacing) ||
    lineSpacing <= 0 ||
    lineSpacing > 100
  )
    throw Error('Invalid text spacing');
  if (!['horizontal-tb', 'vertical-rl'].includes(writingMode))
    throw Error('Unsupported writing mode');
  if (text.length > 10000) throw Error('Text exceeds 10000 characters');
  const normalized = text.replace(/\r\n?/g, '\n').normalize('NFC');
  if (/[\p{Mark}\p{Cf}\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(normalized))
    throw Error(
      'Combining sequences, variation selectors, tabs and control characters are unsupported',
    );
  const missing = [
    ...new Set([...normalized].filter((c) => c !== '\n' && !font.charToGlyphIndex(c))),
  ];
  if (missing.length)
    throw Error(
      `Missing glyphs in selected font: ${missing
        .slice(0, 8)
        .map((c) => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase()})`)
        .join(', ')}. Load a font containing these characters.`,
    );
  const path = new opentype.Path(),
    glyphs = [],
    warnings = new Set(),
    scale = size / font.unitsPerEm;
  function append(outline) {
    if (path.commands.length + outline.commands.length > 500000)
      throw Error('Text outline is too complex');
    path.extend(outline);
  }
  const lines = normalized.split('\n');
  const advances = [];
  const factor = { start: 0, center: 0.5, end: 1 }[alignment];
  for (const [line, content] of lines.entries()) {
    const commandStart = path.commands.length,
      glyphStart = glyphs.length;
    function align(advance) {
      if (!Number.isFinite(advance)) throw Error('Invalid text advance');
      advances.push(advance);
      const shift = -advance * factor;
      const axis = writingMode === 'horizontal-tb' ? 'x' : 'y';
      for (let i = commandStart; i < path.commands.length; i++)
        for (const suffix of ['', '1', '2'])
          if (axis + suffix in path.commands[i]) path.commands[i][axis + suffix] += shift;
      for (let i = glyphStart; i < glyphs.length; i++) glyphs[i][axis] += shift;
    }
    if (writingMode === 'horizontal-tb') {
      const end = font.forEachGlyph(
        content,
        position[0],
        position[1] + line * size * lineSpacing,
        size,
        { letterSpacing: letterSpacing / size, kerning },
        (glyph, x, y) => {
          append(glyph.getPath(x, y, size));
          glyphs.push({ id: glyph.index, line, x, y, rotation: 0 });
        },
      );
      align(end - position[0] - (glyphs.length > glyphStart ? letterSpacing : 0));
      continue;
    }
    const x = position[0] - line * size * lineSpacing;
    let y = position[1];
    for (const char of content) {
      const original = font.charToGlyph(char),
        alternate = verticalGlyph(font, original);
      const substituted = original.index !== alternate.index;
      const sideways = !substituted && (rotatePunctuation.has(char) || !upright(char));
      const glyph = alternate,
        raw = glyph.getPath(0, 0, size);
      let advance, outline;
      if (sideways) {
        const center = ((font.ascender + font.descender) * scale) / 2;
        outline = transformed(raw, (gx, gy) => [x - gy - center, y + gx]);
        advance = (glyph.advanceWidth || font.unitsPerEm) * scale;
      } else {
        const vertical = font.nectVertical,
          metric = vertical?.metrics[glyph.index];
        const origin =
          vertical?.origins.get(glyph.index) ??
          vertical?.defaultOrigin ??
          (metric ? glyph.getMetrics().yMax + metric.topBearing : font.ascender);
        let dx = x - ((glyph.advanceWidth || font.unitsPerEm) * scale) / 2,
          dy = y + origin * scale;
        if (!substituted && cornerPunctuation.has(char) && raw.commands.length) {
          const box = raw.getBoundingBox();
          dx = x + size * 0.1 - box.x1;
          dy = y + size * 0.1 - box.y1;
          warnings.add('Font lacks some vertical alternates; punctuation uses geometric fallback.');
        } else if (!substituted && smallKana.has(char)) {
          dx += size * 0.15;
          dy -= size * 0.15;
          warnings.add('Font lacks some vertical alternates; small kana uses geometric fallback.');
        }
        outline = transformed(raw, (gx, gy) => [gx + dx, gy + dy]);
        advance = (metric?.advance || font.unitsPerEm) * scale;
      }
      if (!substituted && rotatePunctuation.has(char))
        warnings.add(
          'Font lacks some vertical alternates; brackets/long marks rotate geometrically.',
        );
      append(outline);
      glyphs.push({
        char,
        id: glyph.index,
        originalId: original.index,
        line,
        x,
        y,
        rotation: sideways ? 90 : 0,
        substituted,
        advance,
      });
      y += advance + letterSpacing;
    }
    align(y - position[1] - (glyphs.length > glyphStart ? letterSpacing : 0));
  }
  if (path.commands.length > 500000) throw Error('Text outline is too complex');
  for (const cmd of path.commands)
    for (const [key, value] of Object.entries(cmd))
      if (key !== 'type' && !Number.isFinite(value))
        throw Error('Font produced invalid outline coordinates');
  return { path, glyphs, advances, warnings: [...warnings] };
}
