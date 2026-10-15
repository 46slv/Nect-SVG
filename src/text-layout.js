import opentype from 'opentype.js';
import { validateTextWrap, hardTextLines, composeTextLines } from './text-wrap.js';
import {
  normalizeCharacterText,
  characterPositionStatus,
  hasCharacterAdjustments,
} from './character-identity.js';
import { characterTransform, transformCharacterPoint } from './character-geometry.js';

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
/** Shape once per hard-line/font/size run. Fitting and rendering reuse these exact records.
 * Positions include pair kerning/tracking; an endpoint uses its own advance, never the
 * next pair's contribution. Prefix differences make every candidate measurement O(1).
 */
function shapeWrapRuns(chars, resolved, letterSpacing, kerning, boundaryStep) {
  const records = Array(chars.length);
  for (const line of hardTextLines(chars)) {
    let cursor = 0;
    for (let from = line.sourceStart; from < line.sourceEnd; ) {
      const style = resolved[from];
      let to = from + 1;
      while (
        to < line.sourceEnd &&
        resolved[to].font === style.font &&
        resolved[to].size === style.size
      )
        to++;
      const shaped = [];
      style.font.forEachGlyph(
        chars.slice(from, to).join(''),
        0,
        0,
        style.size,
        { letterSpacing: letterSpacing / style.size, kerning },
        (glyph, x) => shaped.push({ glyph, x }),
      );
      if (
        shaped.length !== to - from ||
        shaped.some(
          ({ glyph }, i) =>
            glyph.index !== style.font.charToGlyphIndex(chars[from + i]) ||
            !/^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Common}]$/u.test(
              chars[from + i],
            ),
        )
      )
        throw Error(
          'TEXT_WRAP_MAPPING: Wrap width requires a verified one-to-one Japanese/Latin character mapping',
        );
      for (let i = 0; i < shaped.length; i++) {
        const { glyph, x } = shaped[i],
          entry = resolved[from + i];
        const advance =
          (glyph.advanceWidth || 0) * (entry.size / entry.font.unitsPerEm) * entry.width;
        const shapedAdvance =
          i + 1 < shaped.length ? (shaped[i + 1].x - x - letterSpacing) * entry.width : advance;
        const step =
          boundaryStep(from + i, advance, shapedAdvance, 'horizontal-tb') + entry.tracking;
        records[from + i] = { glyph, x: cursor, advance };
        cursor += step;
        if (!Number.isFinite(cursor)) throw Error('TEXT_WRAP_ADVANCE: Invalid shaped advance');
      }
      from = to;
    }
  }
  return {
    records,
    measure: (start, end) =>
      end > start ? records[end - 1].x - records[start].x + records[end - 1].advance : 0,
  };
}
/** Explicit leading is optional: absence preserves the pre-schema6 spacing contract. */
export function validateLeading(leading) {
  if (leading === undefined) return;
  if (
    !leading ||
    typeof leading !== 'object' ||
    Array.isArray(leading) ||
    !['auto', 'manual'].includes(leading.mode) ||
    Object.keys(leading).some(
      (key) => !(leading.mode === 'manual' ? ['mode', 'value'] : ['mode']).includes(key),
    ) ||
    (leading.mode === 'manual' &&
      (!Number.isFinite(leading.value) || leading.value <= 0 || leading.value > 100000))
  )
    throw Error('Leading must be auto or manual with a positive distance of at most 100000 px');
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
    leading,
    textWrap,
    alignment = 'start',
    kerning = true,
    referenceBounds = 'advance',
    crossAlignment = 'origin',
    characterPositions,
    fonts = {},
    fontId = 'default',
  },
) {
  validateLeading(leading);
  validateTextWrap(textWrap, writingMode);
  if (!['start', 'center', 'end'].includes(alignment)) throw Error('Invalid text alignment');
  if (!['visible', 'advance'].includes(referenceBounds))
    throw Error('Invalid text reference bounds');
  if (!['origin', 'start', 'center', 'end'].includes(crossAlignment))
    throw Error('Invalid cross-axis reference');
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
  const normalized = normalizeCharacterText(text);
  if (textWrap && /[\u2028\u2029]/u.test(normalized))
    throw Error(
      'TEXT_WRAP_SEPARATOR: Unicode line and paragraph separators are unsupported; use Enter',
    );
  if (/[\p{Mark}\p{Cf}\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(normalized))
    throw Error(
      'Combining sequences, variation selectors, tabs and control characters are unsupported',
    );
  const status = characterPositionStatus(text, characterPositions);
  const styles =
    !status.suspended && characterPositions?.basis === normalized
      ? characterPositions.styles || {}
      : {};
  const resolved = [...normalized].map((char, index) => {
    const unit = characterPositions?.basis === normalized ? characterPositions.units[index] : null;
    const style = styles[unit?.id] || {};
    const activeFont = style.font ? (style.font === fontId ? font : fonts[style.font]) : font;
    if (!activeFont) throw Error(`Character font ${style.font} is unavailable`);
    if (char !== '\n' && !activeFont.charToGlyphIndex(char))
      throw Error(
        `Missing glyphs in selected font: ${char} (U+${char.codePointAt(0).toString(16).toUpperCase()}). Load a font containing this character.`,
      );
    return {
      font: activeFont,
      fontId: style.font || fontId,
      size: style.size ?? size,
      width: style.width ?? 1,
      height: style.height ?? 1,
      tracking: style.tracking ?? letterSpacing,
      baselineShift: style.baselineShift ?? 0,
    };
  });
  const path = new opentype.Path(),
    glyphs = [],
    warnings = new Set();
  function append(outline) {
    if (path.commands.length + outline.commands.length > 500000)
      throw Error('Text outline is too complex');
    path.extend(outline);
  }
  const sourceChars = [...normalized];
  const pairs =
    !status.suspended && characterPositions?.basis === normalized
      ? characterPositions.kerningPairs || {}
      : {};
  const pairKerning = {};
  // Shared boundary rule: replace only the metric component. Each caller adds tracking
  // in its legacy arithmetic order so projects without pair edits stay byte-compatible.
  const boundaryStep = (index, advance, shapedAdvance, mode) => {
    const units = characterPositions?.basis === normalized ? characterPositions.units : null,
      key = `${units?.[index]?.id || `c${index + 1}`}:${units?.[index + 1]?.id || `c${index + 2}`}`,
      style = resolved[index] || resolved.at(-1),
      em = style.size * (mode === 'horizontal-tb' ? style.width : style.height),
      manual = Object.hasOwn(pairs, key),
      gap = manual ? (pairs[key] / 1000) * em : shapedAdvance - advance;
    if (sourceChars[index] !== '\n' && sourceChars[index + 1] && sourceChars[index + 1] !== '\n')
      pairKerning[key] = {
        value: manual ? pairs[key] : em === 0 ? 0 : (gap / em) * 1000,
        pixels: gap,
        manual,
      };
    return manual ? advance + gap : shapedAdvance;
  };
  const shapedWrap = textWrap
    ? shapeWrapRuns(sourceChars, resolved, letterSpacing, kerning, boundaryStep)
    : null;
  const lineSpans = textWrap
    ? composeTextLines(sourceChars, textWrap.width, shapedWrap.measure)
    : hardTextLines(sourceChars);
  const lines = lineSpans.map((line) =>
    sourceChars.slice(line.sourceStart, line.sourceEnd).join(''),
  );
  if (lineSpans.some((line) => line.overflow))
    warnings.add(
      'Wrap width overflow: an unbreakable span exceeds the width; all artwork is retained.',
    );
  // Legacy text retains its exact fixed baseline spacing. Rich text uses the largest
  // adjacent line metrics, so a larger selected character does not collide with the next line.
  const lineOffsets = [0];
  if (leading?.mode === 'manual') {
    for (let i = 1; i < lines.length; i++) lineOffsets[i] = i * leading.value;
  } else if (leading?.mode === 'auto' || Object.keys(styles).length) {
    const metrics = lines.map((content, line) => {
      const index = lineSpans[line].sourceStart;
      const count = [...content].length;
      const entries = count
        ? resolved.slice(index, index + count)
        : [{ font, size, width: 1, height: 1, baselineShift: 0 }];
      return {
        em: Math.max(size, ...entries.map((entry) => entry.size * entry.height)),
        ascent: Math.max(
          ...entries.map(
            (entry) =>
              (entry.font.ascender / entry.font.unitsPerEm) * entry.size * entry.height +
              entry.baselineShift,
          ),
        ),
        descent: Math.max(
          ...entries.map(
            (entry) =>
              (-entry.font.descender / entry.font.unitsPerEm) * entry.size * entry.height -
              entry.baselineShift,
          ),
        ),
        cross: Math.max(size, ...entries.map((entry) => entry.size * entry.width)),
        left: Math.max(
          ...entries.map((entry) => (entry.size * entry.width) / 2 - entry.baselineShift),
        ),
        right: Math.max(
          ...entries.map((entry) => (entry.size * entry.width) / 2 + entry.baselineShift),
        ),
      };
    });
    for (let i = 1; i < lines.length; i++) {
      const previous = metrics[i - 1],
        current = metrics[i];
      const distance =
        writingMode === 'horizontal-tb'
          ? Math.max(
              Math.max(previous.em, current.em) * lineSpacing,
              previous.descent + current.ascent,
            )
          : Math.max(
              Math.max(previous.cross, current.cross) * Math.max(1, lineSpacing),
              previous.left + current.right,
            );
      lineOffsets[i] = lineOffsets[i - 1] + distance;
    }
  } else for (let i = 1; i < lines.length; i++) lineOffsets[i] = i * size * lineSpacing;
  let mappingReason = null;
  const advances = [];
  const factor = { start: 0, center: 0.5, end: 1 }[alignment];
  for (const [line, content] of lines.entries()) {
    const commandStart = path.commands.length,
      glyphStart = glyphs.length,
      chars = [...content],
      lineSourceStart = lineSpans[line].sourceStart;
    function align(advance) {
      if (!Number.isFinite(advance)) throw Error('Invalid text advance');
      advances.push(advance);
      const axis = writingMode === 'horizontal-tb' ? 'x' : 'y';
      let shift = -advance * factor;
      if (referenceBounds === 'visible' && path.commands.length > commandStart) {
        const linePath = new opentype.Path();
        linePath.commands = path.commands.slice(commandStart);
        const box = linePath.getBoundingBox();
        const min = box[axis + '1'],
          max = box[axis + '2'];
        if (Number.isFinite(min) && Number.isFinite(max))
          shift = position[axis === 'x' ? 0 : 1] - (min + (max - min) * factor);
      }
      for (let i = commandStart; i < path.commands.length; i++)
        for (const suffix of ['', '1', '2'])
          if (axis + suffix in path.commands[i]) path.commands[i][axis + suffix] += shift;
      for (let i = glyphStart; i < glyphs.length; i++) glyphs[i][axis] += shift;
    }
    if (shapedWrap) {
      const span = lineSpans[line];
      for (let i = span.sourceStart; i < span.sourceEnd; i++) {
        const style = resolved[i],
          record = shapedWrap.records[i],
          glyph = record.glyph;
        const cursor = position[0] + record.x - shapedWrap.records[span.sourceStart].x;
        const baseline = position[1] + lineOffsets[line] - style.baselineShift;
        const start = path.commands.length,
          raw = glyph.getPath(cursor, baseline, style.size);
        append(
          style.width === 1 && style.height === 1
            ? raw
            : transformed(raw, (gx, gy) => [
                cursor + (gx - cursor) * style.width,
                baseline + (gy - baseline) * style.height,
              ]),
        );
        glyphs.push({
          id: glyph.index,
          char: sourceChars[i],
          sourceIndex: i,
          line,
          x: cursor,
          y: baseline,
          rotation: 0,
          advance:
            (((glyph.advanceWidth || style.font.unitsPerEm) * style.size) / style.font.unitsPerEm) *
            style.width,
          fontId: style.fontId,
          size: style.size,
          width: style.width,
          height: style.height,
          tracking: style.tracking,
          baselineShift: style.baselineShift,
          metricCenter:
            ((style.font.ascender + style.font.descender) * style.size * style.height) /
            style.font.unitsPerEm /
            2,
          commandStart: start,
          commandEnd: path.commands.length,
        });
      }
      align(span.advance);
      continue;
    }
    if (writingMode === 'horizontal-tb') {
      let end = position[0];
      // Shape contiguous equal font/size runs. Width is applied after shaping, so changing
      // only width preserves kerning inside the run. Font/size boundaries break kerning.
      for (let from = 0; from < chars.length; ) {
        const style = resolved[lineSourceStart + from];
        let to = from + 1;
        while (
          to < chars.length &&
          resolved[lineSourceStart + to].font === style.font &&
          resolved[lineSourceStart + to].size === style.size
        )
          to++;
        let originalX = end,
          cursor = end,
          previousWidth = 1;
        const runGlyphs = [],
          runAdvances = [],
          runStart = end;
        const runEnd = style.font.forEachGlyph(
          chars.slice(from, to).join(''),
          runStart,
          position[1] + lineOffsets[line],
          style.size,
          { letterSpacing: letterSpacing / style.size, kerning },
          (glyph, x, y) => {
            if (runGlyphs.length) {
              const previous = runGlyphs.at(-1);
              cursor +=
                boundaryStep(
                  previous.sourceIndex,
                  runAdvances.at(-1),
                  (x - originalX - letterSpacing) * previousWidth,
                  writingMode,
                ) + previous.tracking;
            }
            const index = from + runGlyphs.length,
              characterStyle = resolved[lineSourceStart + index] || style,
              width = characterStyle.width,
              height = characterStyle.height,
              baseline = y - characterStyle.baselineShift,
              start = path.commands.length;
            const raw = glyph.getPath(cursor, baseline, style.size);
            append(
              width === 1 && height === 1
                ? raw
                : transformed(raw, (gx, gy) => [
                    cursor + (gx - cursor) * width,
                    baseline + (gy - baseline) * height,
                  ]),
            );
            const info = {
              id: glyph.index,
              char: chars[index],
              sourceIndex: lineSourceStart + index,
              line,
              x: cursor,
              y: baseline,
              rotation: 0,
              advance:
                (((glyph.advanceWidth || style.font.unitsPerEm) * style.size) /
                  style.font.unitsPerEm) *
                width,
              fontId: characterStyle.fontId,
              size: style.size,
              width,
              height,
              tracking: characterStyle.tracking,
              baselineShift: characterStyle.baselineShift,
              metricCenter:
                ((style.font.ascender + style.font.descender) * style.size * height) /
                style.font.unitsPerEm /
                2,
              commandStart: start,
              commandEnd: path.commands.length,
            };
            glyphs.push(info);
            runGlyphs.push(info);
            // Legacy selection cells use an em fallback for zero-width glyphs. Boundary
            // replacement must instead use the true font advance, including literal zero.
            runAdvances.push(
              (((glyph.advanceWidth ?? 0) * style.size) / style.font.unitsPerEm) * width,
            );
            originalX = x;
            previousWidth = width;
          },
        );
        end = runGlyphs.length
          ? cursor +
            boundaryStep(
              runGlyphs.at(-1).sourceIndex,
              runAdvances.at(-1),
              (runEnd - originalX - letterSpacing) * previousWidth,
              writingMode,
            ) +
            runGlyphs.at(-1).tracking
          : runEnd;
        if (
          runGlyphs.length !== to - from ||
          runGlyphs.some((g, i) => g.id !== style.font.charToGlyphIndex(chars[from + i])) ||
          chars
            .slice(from, to)
            .some(
              (char) =>
                !/^[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}]$/u.test(
                  char,
                ),
            )
        )
          mappingReason =
            'This shaped run has no verified one-to-one Japanese/Latin character mapping';
        from = to;
      }
      align(end - position[0] - (glyphs.length > glyphStart ? glyphs.at(-1).tracking : 0));
      continue;
    }
    const x = position[0] - lineOffsets[line];
    let y = position[1];
    for (const char of content) {
      const style = resolved[lineSourceStart + glyphs.length - glyphStart],
        activeFont = style.font,
        activeSize = style.size,
        localScale = activeSize / activeFont.unitsPerEm;
      const original = activeFont.charToGlyph(char),
        alternate = verticalGlyph(activeFont, original);
      const substituted = original.index !== alternate.index;
      const sideways = !substituted && (rotatePunctuation.has(char) || !upright(char));
      const glyph = alternate,
        raw = glyph.getPath(0, 0, activeSize);
      let advance, outline;
      if (sideways) {
        const center = ((activeFont.ascender + activeFont.descender) * localScale) / 2;
        outline = transformed(raw, (gx, gy) => [x - gy - center, y + gx]);
        advance = (glyph.advanceWidth || activeFont.unitsPerEm) * localScale;
      } else {
        const vertical = activeFont.nectVertical,
          metric = vertical?.metrics[glyph.index];
        const origin =
          vertical?.origins.get(glyph.index) ??
          vertical?.defaultOrigin ??
          (metric ? glyph.getMetrics().yMax + metric.topBearing : activeFont.ascender);
        let dx = x - ((glyph.advanceWidth || activeFont.unitsPerEm) * localScale) / 2,
          dy = y + origin * localScale;
        if (!substituted && cornerPunctuation.has(char) && raw.commands.length) {
          const box = raw.getBoundingBox();
          dx = x + activeSize * 0.1 - box.x1;
          dy = y + activeSize * 0.1 - box.y1;
          warnings.add('Font lacks some vertical alternates; punctuation uses geometric fallback.');
        } else if (!substituted && smallKana.has(char)) {
          dx += activeSize * 0.15;
          dy -= activeSize * 0.15;
          warnings.add('Font lacks some vertical alternates; small kana uses geometric fallback.');
        }
        outline = transformed(raw, (gx, gy) => [gx + dx, gy + dy]);
        advance = (metric?.advance || activeFont.unitsPerEm) * localScale;
      }
      if (!substituted && rotatePunctuation.has(char))
        warnings.add(
          'Font lacks some vertical alternates; brackets/long marks rotate geometrically.',
        );
      const start = path.commands.length;
      // Physical X/Y scales are independent; only inline (screen Y) scale affects advance.
      append(
        style.width === 1 && style.height === 1 && style.baselineShift === 0
          ? outline
          : transformed(outline, (gx, gy) => [
              x + (gx - x) * style.width + style.baselineShift,
              y + (gy - y) * style.height,
            ]),
      );
      glyphs.push({
        sourceIndex: lineSourceStart + glyphs.length - glyphStart,
        commandStart: start,
        commandEnd: path.commands.length,
        char,
        id: glyph.index,
        originalId: original.index,
        line,
        x: x + style.baselineShift,
        y,
        rotation: sideways ? 90 : 0,
        substituted,
        fontId: style.fontId,
        size: activeSize,
        width: style.width,
        height: style.height,
        tracking: style.tracking,
        baselineShift: style.baselineShift,
        metricCenter: ((activeFont.ascender + activeFont.descender) * localScale) / 2,
        advance: advance * style.height,
      });
      y +=
        boundaryStep(
          glyphs.at(-1).sourceIndex,
          advance * style.height,
          advance * style.height,
          writingMode,
        ) + style.tracking;
    }
    align(y - position[1] - (glyphs.length > glyphStart ? glyphs.at(-1).tracking : 0));
  }
  if (mappingReason && (Object.keys(styles).length || Object.keys(pairs).length)) {
    // Never attach a logical character's width/font/size to an unverified shaped glyph.
    // Keep the saved record intact, show normal unadjusted artwork, and block export.
    const normal = layoutText(font, text, {
      position,
      size,
      writingMode,
      letterSpacing,
      lineSpacing,
      leading,
      alignment,
      kerning,
      referenceBounds,
      crossAlignment,
      fonts,
      fontId,
    });
    return {
      ...normal,
      characters: [],
      characterReason: mappingReason,
      characterSuspended: true,
      warnings: [
        ...normal.warnings,
        `Character typography suspended: ${mappingReason}. Undo, restore text, or Reset all adjustments before export.`,
      ],
    };
  }
  if (crossAlignment !== 'origin' && path.commands.length) {
    const axis = writingMode === 'horizontal-tb' ? 'y' : 'x';
    const box = path.getBoundingBox();
    const min = box[axis + '1'],
      max = box[axis + '2'];
    const crossFactor = { start: 0, center: 0.5, end: 1 }[crossAlignment];
    const shift = position[axis === 'x' ? 0 : 1] - (min + (max - min) * crossFactor);
    if (Number.isFinite(shift)) {
      for (const command of path.commands)
        for (const suffix of ['', '1', '2'])
          if (axis + suffix in command) command[axis + suffix] += shift;
      for (const glyph of glyphs) glyph[axis] += shift;
    }
  }
  const reason = status.suspended ? status.reason : mappingReason;
  const suspended = !!reason && hasCharacterAdjustments(characterPositions);
  if (suspended)
    warnings.add(
      `Character positions suspended: ${reason}. Undo, restore text, or Reset all adjustments before export.`,
    );
  const characters = [];
  if (!reason)
    for (const glyph of glyphs) {
      const unit =
        characterPositions?.basis === normalized
          ? characterPositions.units[glyph.sourceIndex]
          : null;
      const id = unit?.id || `c${glyph.sourceIndex + 1}`;
      const offset = characterPositions?.offsets[id] || [0, 0];
      const base = [glyph.x, glyph.y];
      // Fixed normal-layout advance-cell center, never the changing outline bounds.
      const pivot =
        writingMode === 'horizontal-tb'
          ? [glyph.x + glyph.advance / 2, glyph.y - glyph.metricCenter]
          : [glyph.x, glyph.y + glyph.advance / 2];
      const shape = characterPositions?.transforms?.[id] || { rotation: 0, scale: 1 };
      const matrix = characterTransform(pivot, offset, shape.scale, shape.rotation);
      const identityShape = shape.rotation === 0 && shape.scale === 1;
      const adjust = (point) =>
        identityShape
          ? [point[0] + offset[0], point[1] + offset[1]]
          : transformCharacterPoint(matrix, point);
      for (let i = glyph.commandStart; i < glyph.commandEnd; i++)
        for (const suffix of ['', '1', '2']) {
          const command = path.commands[i];
          if ('x' + suffix in command) {
            [command['x' + suffix], command['y' + suffix]] = adjust([
              command['x' + suffix],
              command['y' + suffix],
            ]);
          }
        }
      const outline = new opentype.Path();
      outline.commands = path.commands.slice(glyph.commandStart, glyph.commandEnd);
      const box = outline.getBoundingBox(),
        whitespace = !outline.commands.length;
      let bounds = [box.x1, box.y1, box.x2, box.y2];
      if (whitespace) {
        const [x, y] = base;
        const size = glyph.size;
        const cell =
          writingMode === 'horizontal-tb'
            ? [
                x,
                y - size * glyph.height * 0.8,
                x + Math.max(glyph.advance, size * 0.2),
                y + size * glyph.height * 0.2,
              ]
            : [
                x - size * glyph.width * 0.5,
                y,
                x + size * glyph.width * 0.5,
                y + Math.max(glyph.advance, size * glyph.height * 0.2),
              ];
        const corners = [
          [cell[0], cell[1]],
          [cell[2], cell[1]],
          [cell[2], cell[3]],
          [cell[0], cell[3]],
        ].map(adjust);
        bounds = [
          Math.min(...corners.map((p) => p[0])),
          Math.min(...corners.map((p) => p[1])),
          Math.max(...corners.map((p) => p[0])),
          Math.max(...corners.map((p) => p[1])),
        ];
      }
      characters.push({
        id,
        text: glyph.char,
        font: glyph.fontId,
        size: glyph.size,
        width: glyph.width,
        height: glyph.height,
        tracking: glyph.tracking,
        baselineShift: glyph.baselineShift,
        sourceIndex: glyph.sourceIndex,
        bounds,
        base,
        pivot,
        rotation: shape.rotation,
        scale: shape.scale,
        offset: [...offset],
        whitespace,
        path: outline.toPathData(5),
      });
    }
  if (path.commands.length > 500000) throw Error('Text outline is too complex');
  for (const cmd of path.commands)
    for (const [key, value] of Object.entries(cmd))
      if (key !== 'type' && !Number.isFinite(value))
        throw Error('Font produced invalid outline coordinates');
  return {
    path,
    glyphs,
    advances,
    lineOffsets,
    lines: lineSpans,
    pairKerning,
    warnings: [...warnings],
    characters,
    characterReason: reason,
    characterSuspended: suspended,
  };
}
