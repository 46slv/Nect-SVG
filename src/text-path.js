import opentype from 'opentype.js';

const id = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,180}$/;
export function validateTextPathAttachment(attachment) {
  if (attachment === undefined) return;
  if (
    !attachment ||
    typeof attachment !== 'object' ||
    Array.isArray(attachment) ||
    Object.keys(attachment).sort().join(',') !== 'contourId,nodeId,reversed,start,startMode' ||
    !id.test(attachment.nodeId) ||
    !id.test(attachment.contourId) ||
    typeof attachment.nodeId !== 'string' ||
    typeof attachment.contourId !== 'string' ||
    !['distance', 'normalized'].includes(attachment.startMode) ||
    !Number.isFinite(attachment.start) ||
    Math.abs(attachment.start) > 100000 ||
    typeof attachment.reversed !== 'boolean'
  )
    throw Error(
      'TEXT_PATH_ATTACHMENT: Select explicit path/contour IDs and a finite start within ±100000',
    );
}
export function validateTextPathMode(text, writingMode) {
  if (writingMode && writingMode !== 'horizontal-tb')
    throw Error('TEXT_PATH_MODE: Type on Path supports horizontal text only');
  if (/[\r\n\u2028\u2029]/u.test(text))
    throw Error('TEXT_PATH_MULTILINE: Type on Path supports one line only');
  if (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(text))
    throw Error('TEXT_PATH_DIRECTION: Right-to-left text is unsupported');
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => a.map((v, i) => (v + b[i]) / 2);
function position(c, t) {
  const u = 1 - t;
  return [0, 1].map(
    (i) => u ** 3 * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t ** 3 * c[3][i],
  );
}
function derivative(c, t) {
  const u = 1 - t;
  return [0, 1].map(
    (i) =>
      3 *
      (u * u * (c[1][i] - c[0][i]) + 2 * u * t * (c[2][i] - c[1][i]) + t * t * (c[3][i] - c[2][i])),
  );
}
// Five-point Gauss integration inside adaptively bounded cubic leaves.
function arc(c, a, b) {
  const mid = (a + b) / 2,
    half = (b - a) / 2;
  return (
    half *
    [
      [0, 0.5688888888888889],
      [-0.5384693101056831, 0.4786286704993665],
      [0.5384693101056831, 0.4786286704993665],
      [-0.906179845938664, 0.2369268850561891],
      [0.906179845938664, 0.2369268850561891],
    ].reduce((sum, [x, w]) => sum + w * Math.hypot(...derivative(c, mid + half * x)), 0)
  );
}
function split(c, t = 0.5) {
  const mix = (a, b) => (t === 0.5 ? midpoint(a, b) : a.map((v, i) => v + (b[i] - v) * t)),
    a = mix(c[0], c[1]),
    b = mix(c[1], c[2]),
    d = mix(c[2], c[3]),
    e = mix(a, b),
    f = mix(b, d),
    g = mix(e, f);
  return [
    [c[0], a, e, g],
    [g, f, d, c[3]],
  ];
}
// Split at simultaneous derivative roots even when the entire tiny curve fits
// the absolute flatness tolerance. This keeps cusp arc lengths and samples
// meaningful at every coordinate scale instead of integrating across |speed|.
function stationaryParameters(c) {
  const candidates = [];
  for (const i of [0, 1]) {
    const d0 = c[1][i] - c[0][i],
      d1 = c[2][i] - c[1][i],
      d2 = c[3][i] - c[2][i],
      a = d0 - 2 * d1 + d2,
      b = 2 * (d1 - d0),
      d = d0,
      magnitude = Math.max(Math.abs(a), Math.abs(b), Math.abs(d));
    if (!magnitude) continue;
    if (Math.abs(a) <= Number.EPSILON * magnitude * 8) {
      if (b) candidates.push(-d / b);
      continue;
    }
    let discriminant = b * b - 4 * a * d;
    if (discriminant < -Number.EPSILON * magnitude * magnitude * 16) continue;
    discriminant = Math.max(0, discriminant);
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    candidates.push(...(discriminant === 0 ? [-b / (2 * a)] : [q / a, d / q]));
  }
  // Either axis can carry the well-conditioned simple root. A double root in
  // the other axis can round to two inaccurate candidates, so verify both axes.
  const scale = Math.max(...[0, 1, 2].map((i) => distance(c[i], c[i + 1]))),
    roots = [
      ...new Set(
        candidates.filter(
          (t) => t > 0 && t < 1 && Math.hypot(...derivative(c, t)) <= scale * 1e-10,
        ),
      ),
    ].sort((a, b) => a - b),
    result = [];
  for (const root of roots) {
    const previous = result.at(-1);
    if (previous !== undefined && root - previous <= 1e-10) {
      if (Math.hypot(...derivative(c, root)) < Math.hypot(...derivative(c, previous)))
        result[result.length - 1] = root;
    } else result.push(root);
  }
  return result;
}
/** Evaluated cubic controls, 0.05 px aggregate flatness budget, 20 levels / 4096 leaves. */
export function buildTextPathSampler(contour) {
  if (!contour || !Array.isArray(contour.points) || contour.points.length < 2)
    throw Error('TEXT_PATH_ZERO_LENGTH: The selected contour needs two points and nonzero length');
  const count = contour.points.length - (contour.closed ? 0 : 1);
  if (count > 4096) throw Error('TEXT_PATH_BUDGET: Path sampling exceeds 4096 segments');
  const cubics = [],
    leaves = [],
    stationary = [];
  let length = 0,
    leafCount = 0;
  function append(c, original, a, b, tolerance, depth) {
    const chord = distance(c[0], c[3]),
      polygon = distance(c[0], c[1]) + distance(c[1], c[2]) + distance(c[2], c[3]);
    if (!Number.isFinite(polygon)) throw Error('TEXT_PATH_NONFINITE: Invalid path controls');
    if (polygon - chord <= tolerance) {
      if (++leafCount > 4096) throw Error('TEXT_PATH_BUDGET: Path sampling exceeds 4096 leaves');
      const size = arc(original.controls, a, b),
        end = length + size;
      if (end > length) {
        leaves.push({ cubic: original, a, b, start: length, end });
        length = end;
      }
      return;
    }
    if (depth >= 20)
      throw Error('TEXT_PATH_BUDGET: Path sampling cannot meet its 0.05 px tolerance');
    const [left, right] = split(c),
      middle = (a + b) / 2;
    append(left, original, a, middle, tolerance / 2, depth + 1);
    append(right, original, middle, b, tolerance / 2, depth + 1);
  }
  for (let i = 0; i < count; i++) {
    const a = contour.points[i],
      b = contour.points[(i + 1) % contour.points.length];
    for (const p of [a, b])
      for (const key of ['position', 'handleA', 'handleB'])
        if (!Array.isArray(p[key]) || p[key].length !== 2 || !p[key].every(Number.isFinite))
          throw Error('TEXT_PATH_NONFINITE: Invalid path controls');
    const controls = [
      a.position,
      a.position.map((v, k) => v + a.handleB[k]),
      b.position.map((v, k) => v + b.handleA[k]),
      b.position,
    ];
    const cubic = { controls, start: length };
    const roots = stationaryParameters(controls),
      breaks = [...roots, 1],
      stops = [];
    let remaining = controls,
      from = 0;
    for (const to of breaks) {
      const [part, rest] =
        to === 1 ? [remaining, null] : split(remaining, (to - from) / (1 - from));
      append(part, cubic, from, to, 0.05 / count / breaks.length, 0);
      if (to !== 1) stops.push({ cubic, t: to, distance: length });
      remaining = rest;
      from = to;
    }
    cubic.end = length;
    if (length > cubic.start) {
      cubics.push(cubic);
      stationary.push(
        ...stops.filter((stop) => stop.distance > cubic.start && stop.distance < cubic.end),
      );
    }
  }
  if (!Number.isFinite(length) || length <= 0)
    throw Error('TEXT_PATH_ZERO_LENGTH: Selected contour has zero or invalid length');
  return { length, closed: !!contour.closed, cubics, leaves, stationary };
}
export function sampleTextPath(sampler, distanceValue, reversed = false) {
  const { length, closed, cubics, leaves } = sampler;
  if (!Number.isFinite(distanceValue)) throw Error('TEXT_PATH_RANGE: Invalid sample distance');
  let resolved = distanceValue;
  if (closed) resolved = ((resolved % length) + length) % length;
  else if (resolved < 0 || resolved > length)
    throw Error('TEXT_PATH_RANGE: Sample outside open contour');
  const along = reversed ? length - resolved : resolved,
    epsilon = Math.min(0.005, Number.EPSILON * 8 * Math.max(1, along, length)),
    near = (a, b) => Math.abs(a - b) <= epsilon;
  const stop = sampler.stationary.find((point) => near(point.distance, along));
  let cubic = stop?.cubic,
    t = stop?.t;
  if (stop) {
    /* A stationary sample is resolved or rejected below. */
  } else if (reversed) {
    cubic = cubics.find((c) => near(c.end, along));
    if (cubic) t = 1;
    else if (near(along, 0)) {
      cubic = closed ? cubics.at(-1) : cubics[0];
      t = closed ? 1 : 0;
    }
  } else {
    cubic = cubics.find((c) => near(c.start, along));
    if (cubic) t = 0;
    else if (near(along, length)) {
      cubic = cubics.at(-1);
      t = 1;
    }
  }
  if (!cubic) {
    const leaf = leaves.find((l) => along < l.end) || leaves.at(-1);
    cubic = leaf.cubic;
    const wanted = Math.max(0, Math.min(leaf.end - leaf.start, along - leaf.start));
    let low = leaf.a,
      high = leaf.b;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (arc(cubic.controls, leaf.a, mid) < wanted) low = mid;
      else high = mid;
    }
    t = (low + high) / 2;
  }
  let tangent = derivative(cubic.controls, t);
  if (Math.hypot(...tangent) === 0 && (t === 0 || t === 1)) {
    const c = cubic.controls;
    const candidates =
      t === 0
        ? [c[1], c[2], c[3]].map((p) => p.map((v, i) => v - c[0][i]))
        : [c[2], c[1], c[0]].map((p) => p.map((v, i) => c[3][i] - v));
    tangent = candidates.find((p) => Math.hypot(...p) > 0) || tangent;
  }
  // Arc inversion can land a few ulps beside a stationary point. A tiny
  // derivative there must not arbitrarily choose one side of a reversing cusp.
  // A stationary monotone inflection is resolvable only when both neighboring
  // analytic directions agree; use that common direction rather than roundoff.
  const scale = Math.max(
    ...[0, 1, 2].map((i) => distance(cubic.controls[i], cubic.controls[i + 1])),
  );
  if (t > 0 && t < 1 && Math.hypot(...tangent) <= scale * 1e-7) {
    const delta = Math.min(1e-4, t / 2, (1 - t) / 2),
      before = derivative(cubic.controls, t - delta),
      after = derivative(cubic.controls, t + delta),
      beforeNorm = Math.hypot(...before),
      afterNorm = Math.hypot(...after),
      agreement =
        beforeNorm && afterNorm
          ? (before[0] * after[0] + before[1] * after[1]) / beforeNorm / afterNorm
          : -1;
    if (!Number.isFinite(agreement) || agreement < 1 - 1e-6)
      throw Error('TEXT_PATH_TANGENT: Numerically unresolved interior cusp');
    tangent = after.map((v) => v / afterNorm);
  }
  const norm = Math.hypot(...tangent);
  if (!Number.isFinite(norm) || norm === 0)
    throw Error('TEXT_PATH_TANGENT: No resolvable path tangent');
  tangent = tangent.map((v) => (v / norm) * (reversed ? -1 : 1));
  return { position: position(cubic.controls, t), tangent, distance: resolved };
}
/** Preserve shaped advances and rigid outlines. Character XY/rotation/scale precede projection. */
export function projectTextPath(layout, contour, attachment, alignment = 'start') {
  validateTextPathAttachment(attachment);
  if (layout.characterSuspended)
    throw Error('TEXT_PATH_MAPPING: Resolve suspended character adjustments before attaching');
  const sampler = buildTextPathSampler(contour),
    { length } = sampler;
  let spanStart = 0,
    spanEnd = 0;
  for (const glyph of layout.glyphs) {
    if (![glyph.x, glyph.y, glyph.advance].every(Number.isFinite) || glyph.advance < 0)
      throw Error('TEXT_PATH_ADVANCE: Invalid shaped advance');
    spanStart = Math.min(spanStart, glyph.x);
    spanEnd = Math.max(spanEnd, glyph.x + glyph.advance);
  }
  const anchor = attachment.start * (attachment.startMode === 'normalized' ? length : 1),
    first = anchor - { start: 0, center: (spanStart + spanEnd) / 2, end: spanEnd }[alignment];
  if (![anchor, first].every(Number.isFinite))
    throw Error('TEXT_PATH_RANGE: Invalid aligned start');
  if (
    sampler.closed
      ? spanEnd - spanStart > length + 1e-8
      : anchor < 0 ||
        anchor > length ||
        first + spanStart < -1e-8 ||
        first + spanEnd > length + 1e-8
  )
    throw Error(
      'TEXT_PATH_OVERFLOW: The full text advance, including spaces, must fit within one contour lap',
    );
  const path = new opentype.Path(),
    characters = [],
    placements = [],
    bySource = new Map(layout.characters.map((c) => [c.sourceIndex, c]));
  for (const glyph of layout.glyphs) {
    let sampleDistance = first + glyph.x + glyph.advance / 2;
    if (!sampler.closed) sampleDistance = Math.max(0, Math.min(length, sampleDistance));
    const sample = sampleTextPath(sampler, sampleDistance, attachment.reversed),
      [tx, ty] = sample.tangent,
      map = ([x, y]) => [
        sample.position[0] + tx * (x - glyph.x - glyph.advance / 2) - ty * y,
        sample.position[1] + ty * (x - glyph.x - glyph.advance / 2) + tx * y,
      ];
    const outline = new opentype.Path();
    outline.commands = layout.path.commands
      .slice(glyph.commandStart, glyph.commandEnd)
      .map((command) => {
        const next = { ...command };
        for (const suffix of ['', '1', '2'])
          if ('x' + suffix in next)
            [next['x' + suffix], next['y' + suffix]] = map([
              next['x' + suffix],
              next['y' + suffix],
            ]);
        return next;
      });
    path.extend(outline);
    placements.push({ ...sample, advance: glyph.advance, baseline: map([glyph.x, 0]) });
    const character = bySource.get(glyph.sourceIndex);
    if (character) {
      const box = outline.getBoundingBox();
      let bounds = [box.x1, box.y1, box.x2, box.y2];
      if (character.whitespace) {
        const [x1, y1, x2, y2] = character.bounds,
          corners = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
          ].map(map);
        bounds = [
          Math.min(...corners.map((p) => p[0])),
          Math.min(...corners.map((p) => p[1])),
          Math.max(...corners.map((p) => p[0])),
          Math.max(...corners.map((p) => p[1])),
        ];
      }
      characters.push({
        ...character,
        base: map(character.base),
        pivot: map(character.pivot),
        bounds,
        path: outline.toPathData(5),
      });
    }
  }
  for (const command of path.commands)
    for (const [key, value] of Object.entries(command))
      if (key !== 'type' && (!Number.isFinite(value) || Math.abs(value) > 1e9))
        throw Error('TEXT_PATH_NONFINITE: Projected outline exceeds coordinate limits');
  return {
    ...layout,
    path,
    characters,
    attachment: { ...attachment, length, span: spanEnd - spanStart },
    placements,
  };
}
