/** Nect Japanese/Latin break subset v1. This is deliberately not full UAX #14/kinsoku. */
export const WRAP_OPEN = '([{（［｛「『【〔〈《〖〘〚';
export const WRAP_NONSTART =
  ')]}）］｝」』】〕〉》〗〙〛、。，．！？!?.,:;：；ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーｰ々ゝゞヽヾ〻';
const opening = new Set([...WRAP_OPEN]),
  nonstart = new Set([...WRAP_NONSTART]);
const separator = (char) => char === ' ' || char === '\u3000';
const japanese = (char) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(char);
const known = (char) =>
  japanese(char) ||
  /^[\p{Script=Latin}\p{Number}]$/u.test(char) ||
  opening.has(char) ||
  nonstart.has(char);
export function validateTextWrap(wrap, writingMode = 'horizontal-tb', pathAttachment) {
  if (wrap === undefined) return;
  if (
    !wrap ||
    typeof wrap !== 'object' ||
    Array.isArray(wrap) ||
    Object.keys(wrap).length !== 1 ||
    !Object.hasOwn(wrap, 'width') ||
    !Number.isFinite(wrap.width) ||
    wrap.width <= 0 ||
    wrap.width > 100000
  )
    throw Error(
      'TEXT_WRAP_WIDTH: Wrap width must be a positive finite distance of at most 100000 px',
    );
  if (writingMode !== 'horizontal-tb')
    throw Error('TEXT_WRAP_MODE: Wrap width supports horizontal text only');
  if (pathAttachment !== undefined)
    throw Error('TEXT_WRAP_PATH: Detach Type on Path before enabling Wrap width');
}
/** Scalar source spans: a hard newline belongs to neither line; soft breaks consume no unit. */
export function hardTextLines(chars) {
  const lines = [];
  let sourceStart = 0;
  for (let i = 0; i <= chars.length; i++)
    if (i === chars.length || chars[i] === '\n') {
      lines.push({
        sourceStart,
        sourceEnd: i,
        fitEnd: i,
        breakKind: i === chars.length ? 'end' : 'hard',
      });
      sourceStart = i + 1;
    }
  return lines;
}
/** Each boundary is visited once. Whole separator runs stay with the preceding source span. */
export function wrapOpportunities(chars, start, end) {
  const boundaries = [];
  for (let i = start; i < end; ) {
    if (separator(chars[i])) {
      const fitEnd = i;
      while (i < end && separator(chars[i])) i++;
      if (i < end && fitEnd > start && !opening.has(chars[fitEnd - 1]) && !nonstart.has(chars[i]))
        boundaries.push({ sourceEnd: i, fitEnd });
      continue;
    }
    const next = i + 1;
    if (
      next < end &&
      !separator(chars[next]) &&
      known(chars[i]) &&
      known(chars[next]) &&
      (japanese(chars[i]) || japanese(chars[next])) &&
      !opening.has(chars[i]) &&
      !nonstart.has(chars[next])
    )
      boundaries.push({ sourceEnd: next, fitEnd: next });
    i++;
  }
  boundaries.push({ sourceEnd: end, fitEnd: end });
  return boundaries;
}
/** Greedy sequential span fitting: signed tracking need not produce monotonic candidate widths. */
export function composeTextLines(chars, width, measure) {
  const lines = [];
  for (const hard of hardTextLines(chars)) {
    const boundaries = wrapOpportunities(chars, hard.sourceStart, hard.sourceEnd);
    let start = hard.sourceStart,
      atomStart = hard.sourceStart,
      accepted = null,
      atomOverflow = false;
    const emit = (boundary, kind) => {
      const advance = measure(start, boundary.fitEnd);
      if (!Number.isFinite(advance)) throw Error('TEXT_WRAP_ADVANCE: Invalid composed advance');
      lines.push({
        sourceStart: start,
        ...boundary,
        breakKind: kind,
        advance,
        overflow: atomOverflow || advance > width + 1e-7,
      });
      start = boundary.sourceEnd;
    };
    for (const boundary of boundaries) {
      const atomAdvance = measure(atomStart, boundary.fitEnd);
      if (!Number.isFinite(atomAdvance)) throw Error('TEXT_WRAP_ADVANCE: Invalid span advance');
      atomStart = boundary.sourceEnd;
      const advance = measure(start, boundary.fitEnd);
      if (!Number.isFinite(advance)) throw Error('TEXT_WRAP_ADVANCE: Invalid composed advance');
      if (accepted && advance > width + 1e-7) {
        emit(accepted, 'soft');
        accepted = null;
        atomOverflow = false;
      }
      atomOverflow ||= atomAdvance > width + 1e-7;
      // An indivisible span always makes progress, even when wider than the budget.
      accepted = boundary;
    }
    emit(accepted, hard.breakKind);
  }
  return lines;
}
