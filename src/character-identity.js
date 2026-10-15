/** Stable Text-local logical identities; all helpers are pure document-edit operations. */
export const CHARACTER_POSITION_VERSION = 1;
export const MAX_CHARACTER_TEXT_LENGTH = 10000;
export const MAX_CHARACTER_OFFSET = 100000;
export const CHARACTER_TRANSFORM_VERSION = 2;
export const CHARACTER_STYLE_VERSION = 3;
export const CHARACTER_SPACING_VERSION = 4;
export const CHARACTER_KERNING_VERSION = 5;
export const MAX_PAIR_KERNING = 100000;
export const CHARACTER_STYLE_KEYS = [
  'font',
  'size',
  'width',
  'height',
  'tracking',
  'baselineShift',
];
export const MIN_CHARACTER_SCALE = 0.01;
export const MAX_CHARACTER_SCALE = 100;
export const MAX_CHARACTER_ROTATION = 36000;
function shapeTransform(value) {
  if (
    !plainObject(value) ||
    Object.keys(value).some((key) => !['rotation', 'scale'].includes(key)) ||
    !Number.isFinite(value.rotation) ||
    Math.abs(value.rotation) > MAX_CHARACTER_ROTATION ||
    !Number.isFinite(value.scale) ||
    value.scale < MIN_CHARACTER_SCALE ||
    value.scale > MAX_CHARACTER_SCALE
  )
    throw Error(
      'Character shape requires rotation from -36000 to 36000 degrees and uniform scale from 0.01 to 100',
    );
}
const own = (object, key) => Object.hasOwn(object, key);
const plainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const scalar = (text) => {
  const units = [...text];
  return (
    units.length === 1 &&
    !(text.length === 1 && text.charCodeAt(0) >= 0xd800 && text.charCodeAt(0) <= 0xdfff)
  );
};
function rawText(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_CHARACTER_TEXT_LENGTH)
    throw Error('Character text must be a string of at most 10000 UTF-16 units');
  for (const char of raw)
    if (!scalar(char)) throw Error('Character text contains a lone surrogate');
  return raw;
}
/** Matches layout normalization, without changing the saved source text. */
export function normalizeCharacterText(raw) {
  const normalized = rawText(raw).replace(/\r\n?/g, '\n').normalize('NFC');
  if (normalized.length > MAX_CHARACTER_TEXT_LENGTH)
    throw Error('Normalized character text exceeds 10000 UTF-16 units');
  return normalized;
}
function vector(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    ![value[0], value[1]].every(
      (component) => Number.isFinite(component) && Math.abs(component) <= MAX_CHARACTER_OFFSET,
    )
  )
    throw Error('Character offsets must be finite XY values from -100000 to 100000');
}
/** A mismatched basis is valid saved data: its adjustments are suspended, not discarded. */
export function validateCharacterPositions(record) {
  if (record === undefined) return record;
  if (
    !plainObject(record) ||
    Object.keys(record).some(
      (key) =>
        ![
          'version',
          'basis',
          'units',
          'offsets',
          'nextId',
          ...(record.version >= 2 ? ['transforms'] : []),
          ...(record.version >= 3 ? ['styles'] : []),
          ...(record.version >= 5 ? ['kerningPairs'] : []),
        ].includes(key),
    ) ||
    ![
      CHARACTER_POSITION_VERSION,
      CHARACTER_TRANSFORM_VERSION,
      CHARACTER_STYLE_VERSION,
      CHARACTER_SPACING_VERSION,
      CHARACTER_KERNING_VERSION,
    ].includes(record.version) ||
    (record.version >= CHARACTER_TRANSFORM_VERSION && !plainObject(record.transforms)) ||
    (record.version >= CHARACTER_STYLE_VERSION && !plainObject(record.styles)) ||
    (record.version >= CHARACTER_KERNING_VERSION && !plainObject(record.kerningPairs)) ||
    !Number.isSafeInteger(record.nextId) ||
    record.nextId < 1 ||
    !Array.isArray(record.units) ||
    record.units.length > MAX_CHARACTER_TEXT_LENGTH ||
    !plainObject(record.offsets)
  )
    throw Error('Invalid character position record');
  if (normalizeCharacterText(record.basis) !== record.basis)
    throw Error('Character position basis must be normalized');
  const ids = new Map();
  for (const unit of record.units) {
    if (
      !plainObject(unit) ||
      Object.keys(unit).some((key) => !['id', 'text'].includes(key)) ||
      typeof unit.id !== 'string' ||
      !/^c[1-9]\d{0,15}$/.test(unit.id) ||
      !Number.isSafeInteger(Number(unit.id.slice(1))) ||
      Number(unit.id.slice(1)) >= record.nextId ||
      ids.has(unit.id) ||
      typeof unit.text !== 'string' ||
      !scalar(unit.text)
    )
      throw Error('Invalid or duplicate character unit ID/text');
    ids.set(unit.id, unit.text);
  }
  if (record.units.map((unit) => unit.text).join('') !== record.basis)
    throw Error('Character units do not reconstruct their basis');
  const entries = Object.entries(record.offsets);
  if (entries.length > record.units.length) throw Error('Too many character offsets');
  for (const [id, value] of entries) {
    if (!ids.has(id) || ids.get(id) === '\n')
      throw Error('Character offset must reference a known non-newline unit');
    vector(value);
  }
  for (const [id, value] of Object.entries(record.transforms || {})) {
    if (!ids.has(id) || ids.get(id) === '\n')
      throw Error('Character shape must reference a known non-newline unit');
    shapeTransform(value);
  }
  for (const [id, style] of Object.entries(record.styles || {})) {
    if (!ids.has(id) || ids.get(id) === '\n')
      throw Error('Character style must reference a known non-newline unit');
    validateCharacterStyle(style);
    if (
      record.version < CHARACTER_SPACING_VERSION &&
      ['height', 'tracking', 'baselineShift'].some((key) => own(style, key))
    )
      throw Error('Character spacing requires characterPositions version 4');
  }
  const adjacent = adjacentPairKeys(record.units);
  for (const [key, value] of Object.entries(record.kerningPairs || {})) {
    if (!adjacent.has(key))
      throw Error('Pair kerning must reference ordered adjacent non-newline IDs');
    validatePairValue(value);
  }
  return record;
}
function adjacentPairKeys(units) {
  return new Set(
    units.slice(0, -1).flatMap((left, index) => {
      const right = units[index + 1];
      return left.text !== '\n' && right.text !== '\n' ? [`${left.id}:${right.id}`] : [];
    }),
  );
}
function validatePairValue(value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_PAIR_KERNING)
    throw Error('Pair kerning must be from -100000 to 100000 units (1/1000 em)');
}
/** Two source IDs are the target, never glyph indices or a remembered caret offset. */
export function characterPairFromIds(raw, record, ids) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character adjustments are suspended; restore text or reset all adjustments first');
  const current = record?.basis === basis ? record : allocate(basis);
  if (
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    ids.some((id) => typeof id !== 'string') ||
    !adjacentPairKeys(current.units).has(ids.join(':'))
  )
    throw Error('Select exactly two adjacent non-newline characters for pair kerning');
  return ids.join(':');
}
/** A caret or exactly two selected source units, with atomic UTF-16/NFC/CRLF boundaries. */
export function characterPairInRange(raw, record, start, end) {
  characterIdsInRange(raw, record, start, end); // Shared strict boundary/suspension validation.
  const basis = normalizeCharacterText(raw),
    units = record?.basis === basis ? record.units : allocate(basis).units,
    from = [...normalize(raw.slice(0, start))].length,
    to = [...normalize(raw.slice(0, end))].length;
  const pair = start === end ? units.slice(Math.max(0, from - 1), from + 1) : units.slice(from, to);
  if ((start === end && (!from || from >= units.length)) || pair.length !== 2)
    throw Error(
      'Place the cursor between two characters or select exactly two adjacent characters',
    );
  return characterPairFromIds(
    raw,
    record,
    pair.map((unit) => unit.id),
  );
}
/** Sparse manual values replace metric kerning. Null inherits; explicit zero remains authored. */
export function setCharacterKerningPairs(raw, record, changes) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (!plainObject(changes)) throw Error('Invalid pair kerning changes');
  const entries = Object.entries(changes);
  if (!entries.length) return record;
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character adjustments are suspended; restore text or reset all adjustments first');
  const current = record?.basis === basis ? record : allocate(basis),
    adjacent = adjacentPairKeys(current.units);
  for (const [key, value] of entries) {
    if (!adjacent.has(key))
      throw Error('Pair kerning must reference ordered adjacent non-newline IDs');
    if (value !== null) validatePairValue(value);
  }
  const kerningPairs = { ...current.kerningPairs };
  let changed = false;
  for (const [key, value] of entries) {
    if (value === null) {
      if (own(kerningPairs, key)) {
        delete kerningPairs[key];
        changed = true;
      }
    } else if (!own(kerningPairs, key) || kerningPairs[key] !== value) {
      kerningPairs[key] = value === 0 ? 0 : value;
      changed = true;
    }
  }
  return changed
    ? {
        ...current,
        version: CHARACTER_KERNING_VERSION,
        transforms: { ...current.transforms },
        styles: { ...current.styles },
        kerningPairs,
      }
    : record;
}
function validateCharacterStyle(style, patch = false) {
  if (!plainObject(style) || Object.keys(style).some((key) => !CHARACTER_STYLE_KEYS.includes(key)))
    throw Error('Invalid character typography style');
  for (const [key, value] of Object.entries(style)) {
    if (patch && value === null) continue;
    if (
      key === 'font' &&
      (typeof value !== 'string' || !/^(default|font-[a-zA-Z0-9_-]{1,100})$/.test(value))
    )
      throw Error('Invalid character font reference');
    if (key === 'size' && (!Number.isFinite(value) || value <= 0 || value > 100000))
      throw Error('Character font size must be greater than 0 and at most 100000 px');
    if (
      ['width', 'height'].includes(key) &&
      (!Number.isFinite(value) || value < 0.01 || value > 10)
    )
      throw Error('Character horizontal width and vertical scale must be from 1% to 1000%');
    if (
      ['tracking', 'baselineShift'].includes(key) &&
      (!Number.isFinite(value) || Math.abs(value) > 100000)
    )
      throw Error('Character tracking and baseline shift must be from -100000 to 100000 px');
  }
}
/** Sparse typography overrides. Null removes a property and restores inheritance. */
export function setCharacterStyles(raw, record, changes) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (!plainObject(changes)) throw Error('Invalid character style changes');
  const entries = Object.entries(changes);
  if (!entries.length) return record;
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character adjustments are suspended; restore text or reset all adjustments first');
  const current = record?.basis === basis ? record : allocate(basis);
  const units = new Map(current.units.map((unit) => [unit.id, unit.text]));
  for (const [id, style] of entries) {
    if (!units.has(id) || units.get(id) === '\n')
      throw Error('Character style must reference a known non-newline unit');
    validateCharacterStyle(style, true);
  }
  const styles = { ...current.styles };
  let changed = false;
  for (const [id, patch] of entries) {
    const before = styles[id] || {},
      next = { ...before };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    if (CHARACTER_STYLE_KEYS.every((key) => before[key] === next[key])) continue;
    changed = true;
    if (Object.keys(next).length) styles[id] = next;
    else delete styles[id];
  }
  return changed
    ? {
        ...current,
        version: Math.max(
          current.version,
          Object.values(styles).some((style) =>
            ['height', 'tracking', 'baselineShift'].some((key) => own(style, key)),
          )
            ? CHARACTER_SPACING_VERSION
            : CHARACTER_STYLE_VERSION,
        ),
        transforms: { ...current.transforms },
        styles,
      }
    : record;
}
export function resetCharacterStyles(raw, record, ids) {
  validateCharacterPositions(record);
  if (!record) return record;
  const selected = ids === undefined ? Object.keys(record.styles || {}) : ids;
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string'))
    throw Error('Invalid character typography reset selection');
  return setCharacterStyles(
    raw,
    record,
    Object.fromEntries(
      selected.map((id) => [
        id,
        Object.fromEntries(CHARACTER_STYLE_KEYS.map((key) => [key, null])),
      ]),
    ),
  );
}
/** Map a textarea UTF-16 range only at proven scalar/NFC/newline boundaries. */
export function characterIdsInRange(raw, record, start, end) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (
    !scalarBoundary(raw, start) ||
    !scalarBoundary(raw, end) ||
    start > end ||
    !normalizationBoundary(raw, start, basis) ||
    !normalizationBoundary(raw, end, basis)
  )
    throw Error('Select complete characters, including combining marks and newline pairs');
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character adjustments are suspended; restore text or reset all adjustments first');
  const units = record?.basis === basis ? record.units : allocate(basis).units;
  const from = [...normalize(raw.slice(0, start))].length;
  const to = [...normalize(raw.slice(0, end))].length;
  return units
    .slice(from, to)
    .filter((unit) => unit.text !== '\n')
    .map((unit) => unit.id);
}
function allocate(basis, start = 1) {
  let nextId = start;
  const units = [...basis].map((text) => {
    if (!Number.isSafeInteger(nextId + 1)) throw Error('Character ID allocation exhausted');
    return { id: `c${nextId++}`, text };
  });
  return { version: CHARACTER_POSITION_VERSION, basis, units, offsets: {}, nextId };
}
/** Call only in an explicit document/draft edit, never while evaluating geometry. */
export function createCharacterPositions(raw) {
  return allocate(normalizeCharacterText(raw));
}
export function hasCharacterOffsets(record) {
  validateCharacterPositions(record);
  return !!record && Object.values(record.offsets).some(([x, y]) => x !== 0 || y !== 0);
}
export function hasCharacterAdjustments(record) {
  return (
    hasCharacterOffsets(record) ||
    (!!record && Object.keys(record.kerningPairs || {}).length > 0) ||
    (!!record && Object.values(record.styles || {}).some((style) => Object.keys(style).length)) ||
    (!!record &&
      Object.values(record.transforms || {}).some(
        ({ rotation, scale }) => rotation !== 0 || scale !== 1,
      ))
  );
}
export function characterPositionStatus(raw, record) {
  const basis = normalizeCharacterText(raw);
  const active = hasCharacterAdjustments(record);
  const suspended = active && record.basis !== basis;
  return {
    active,
    suspended,
    reason: suspended
      ? 'Character positions are suspended because the text changed without a verified edit. Undo, restore the previous text, or reset all character adjustments.'
      : null,
  };
}
/** Apply absolute local XY values; zero entries are removed. No record is allocated for a no-op. */
export function setCharacterOffsets(raw, record, changes) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (!plainObject(changes)) throw Error('Invalid character offset changes');
  const entries = Object.entries(changes);
  if (!entries.length) return record;
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character positions are suspended; restore text or reset all adjustments first');
  const current = record?.basis === basis ? record : allocate(basis);
  const units = new Map(current.units.map((unit) => [unit.id, unit.text]));
  // Validate the entire transaction before allocating or changing its result.
  for (const [id, value] of entries) {
    if (!units.has(id) || units.get(id) === '\n')
      throw Error('Character offset must reference a known non-newline unit');
    vector(value);
  }
  const offsets = { ...current.offsets };
  let changed = false;
  for (const [id, value] of entries) {
    const next = value.map((component) => (component === 0 ? 0 : component));
    const before = offsets[id] || [0, 0];
    if (before[0] === next[0] && before[1] === next[1]) continue;
    changed = true;
    if (next[0] === 0 && next[1] === 0) delete offsets[id];
    else offsets[id] = next;
  }
  if (!changed) return record;
  return { ...current, offsets };
}
/** With no IDs, clear all positions and recover a suspended record against the current text. */
export function resetCharacterOffsets(raw, record, ids) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')))
    throw Error('Invalid character reset selection');
  if (!record) {
    if (ids?.length) throw Error('Cannot reset unknown character IDs');
    return record;
  }
  if (ids === undefined && record.basis !== basis) {
    if (
      Object.values(record.transforms || {}).some(
        ({ rotation, scale }) => rotation !== 0 || scale !== 1,
      ) ||
      Object.values(record.styles || {}).some((style) => Object.keys(style).length) ||
      Object.keys(record.kerningPairs || {}).length > 0
    )
      throw Error('Character adjustments are suspended; reset all adjustments to recover mapping');
    return allocate(basis, record.nextId);
  }
  const known = new Map(record.units.map((unit) => [unit.id, unit.text]));
  if (ids?.some((id) => !known.has(id) || known.get(id) === '\n'))
    throw Error('Cannot reset unknown or newline character IDs');
  const removed = ids || Object.keys(record.offsets);
  if (!removed.some((id) => own(record.offsets, id))) return record;
  const offsets = { ...record.offsets };
  for (const id of removed) delete offsets[id];
  return { ...record, offsets };
}
/** Absolute shape values in each character's own cell. Never modifies XY or font size. */
export function setCharacterTransforms(raw, record, changes) {
  validateCharacterPositions(record);
  const basis = normalizeCharacterText(raw);
  if (!plainObject(changes)) throw Error('Invalid character shape changes');
  const entries = Object.entries(changes);
  if (!entries.length) return record;
  if (record && record.basis !== basis && hasCharacterAdjustments(record))
    throw Error('Character adjustments are suspended; restore text or reset all adjustments first');
  const current = record?.basis === basis ? record : allocate(basis);
  const units = new Map(current.units.map((unit) => [unit.id, unit.text]));
  for (const [id, value] of entries) {
    if (!units.has(id) || units.get(id) === '\n')
      throw Error('Character shape must reference a known non-newline unit');
    shapeTransform(value);
  }
  const transforms = { ...current.transforms };
  let changed = false;
  for (const [id, value] of entries) {
    const before = transforms[id] || { rotation: 0, scale: 1 };
    if (before.rotation === value.rotation && before.scale === value.scale) continue;
    changed = true;
    if (value.rotation === 0 && value.scale === 1) delete transforms[id];
    else transforms[id] = { rotation: value.rotation || 0, scale: value.scale };
  }
  return changed
    ? { ...current, version: Math.max(current.version, CHARACTER_TRANSFORM_VERSION), transforms }
    : record;
}
export function resetCharacterTransforms(raw, record, ids) {
  validateCharacterPositions(record);
  if (!record) return record;
  const selected = ids === undefined ? Object.keys(record.transforms || {}) : ids;
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string'))
    throw Error('Invalid character shape reset selection');
  return setCharacterTransforms(
    raw,
    record,
    Object.fromEntries(selected.map((id) => [id, { rotation: 0, scale: 1 }])),
  );
}
/** Explicit full reset is the only shape+XY recovery operation for unknown source edits. */
export function resetCharacterAdjustments(raw, record) {
  validateCharacterPositions(record);
  if (!record) return record;
  const basis = normalizeCharacterText(raw);
  if (record.basis !== basis) return allocate(basis, record.nextId);
  const next = resetCharacterOffsets(raw, record);
  const reset = resetCharacterStyles(raw, resetCharacterTransforms(raw, next));
  return setCharacterKerningPairs(
    raw,
    reset,
    Object.fromEntries(Object.keys(reset.kerningPairs || {}).map((key) => [key, null])),
  );
}
function scalarBoundary(raw, at) {
  if (!Number.isInteger(at) || at < 0 || at > raw.length) return false;
  if (!at || at === raw.length) return true;
  const before = raw.charCodeAt(at - 1),
    after = raw.charCodeAt(at);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function previousBoundary(raw, at) {
  let result = at - 1;
  if (!scalarBoundary(raw, result)) result--;
  return result;
}
function nextBoundary(raw, at) {
  return at + (raw.codePointAt(at) > 0xffff ? 2 : 1);
}
const normalize = (text) => text.replace(/\r\n?/g, '\n').normalize('NFC');
function normalizationBoundary(raw, at, basis) {
  // Keep CRLF atomic even where the two independently normalized pieces would happen to match.
  if (raw[at - 1] === '\r' && raw[at] === '\n') return false;
  return normalize(raw.slice(0, at)) + normalize(raw.slice(at)) === basis;
}
/** Establish the replacement from the captured cursor, never a repeated-text diff heuristic. */
function verifiedReplacement(previousRaw, nextRaw, start, end, inputType, composition) {
  if (!scalarBoundary(previousRaw, start) || !scalarBoundary(previousRaw, end) || start > end)
    return null;
  if (typeof inputType !== 'string') {
    if (!composition) return null;
    inputType = '';
  }
  const deleting = inputType.startsWith('delete');
  const inserting = inputType.startsWith('insert');
  if (!deleting && !inserting && !composition) return null;
  if (deleting && start === end) {
    const removed = previousRaw.length - nextRaw.length;
    if (removed <= 0) return null;
    if (/Backward$/.test(inputType)) start -= removed;
    else if (/Forward$/.test(inputType)) end += removed;
    else return null;
  }
  if (!scalarBoundary(previousRaw, start) || !scalarBoundary(previousRaw, end)) return null;
  const insertedLength = nextRaw.length - (previousRaw.length - (end - start));
  if (insertedLength < 0 || (deleting && insertedLength !== 0)) return null;
  const nextEnd = start + insertedLength;
  if (!scalarBoundary(nextRaw, start) || !scalarBoundary(nextRaw, nextEnd)) return null;
  if (
    previousRaw.slice(0, start) !== nextRaw.slice(0, start) ||
    previousRaw.slice(end) !== nextRaw.slice(nextEnd)
  )
    return null;
  return { start, end, nextEnd };
}
function affectedWindow(previousRaw, nextRaw, oldBasis, nextBasis, replacement) {
  let left = replacement.start,
    right = replacement.end;
  const delta = replacement.nextEnd - replacement.end;
  // NFC can combine through either boundary. Expand only the verified edit's neighboring
  // raw scalar boundaries until independently normalized pieces exactly reconstruct both runs.
  while (
    !normalizationBoundary(previousRaw, left, oldBasis) ||
    !normalizationBoundary(nextRaw, left, nextBasis)
  ) {
    left = previousBoundary(previousRaw, left);
    // Avoid repeatedly normalizing a long combining sequence while walking its interior.
    while (left > 0 && /\p{Mark}/u.test(String.fromCodePoint(previousRaw.codePointAt(left))))
      left = previousBoundary(previousRaw, left);
  }
  while (
    !normalizationBoundary(previousRaw, right, oldBasis) ||
    !normalizationBoundary(nextRaw, right + delta, nextBasis)
  ) {
    right = nextBoundary(previousRaw, right);
    while (
      right < previousRaw.length &&
      /\p{Mark}/u.test(String.fromCodePoint(previousRaw.codePointAt(right)))
    )
      right = nextBoundary(previousRaw, right);
  }
  const prefix = normalize(previousRaw.slice(0, left));
  const suffix = normalize(previousRaw.slice(right));
  const oldMiddle = normalize(previousRaw.slice(left, right));
  const newMiddle = normalize(nextRaw.slice(left, right + delta));
  if (prefix + oldMiddle + suffix !== oldBasis || prefix + newMiddle + suffix !== nextBasis)
    return null;
  return { prefixCount: [...prefix].length, suffixCount: [...suffix].length, newMiddle };
}
/**
 * Reconcile one beforeinput/input transaction against an explicitly captured UTF-16 selection.
 * Result.record is staged beside the textarea draft; the caller commits text+record together.
 * During IME, isComposing:true always returns the original record without allocating IDs.
 * The final call uses the initial composition selection/raw, either directly or in composition.
 * A verified ordinary insertion over selected text is a replacement even when raw text is equal.
 * Canonical/newline-only representation changes and unchanged IME final values preserve identity.
 * A caller with explicit replacement intent can set forceReplacement:true for those equal cases.
 * Native textarea undo/redo must supply a proven caller snapshot; an unknown history edit suspends.
 */
export function reconcileCharacterEdit(record, transaction) {
  validateCharacterPositions(record);
  if (!plainObject(transaction)) throw Error('Invalid character edit transaction');
  let { previousRaw, nextRaw, selectionStart, selectionEnd, inputType, isComposing, composition } =
    transaction;
  const { forceReplacement = false } = transaction;
  if (typeof forceReplacement !== 'boolean') throw Error('Invalid character replacement intent');
  if (isComposing !== undefined && typeof isComposing !== 'boolean')
    throw Error('Invalid character composition state');
  if (composition !== undefined && typeof composition !== 'boolean' && !plainObject(composition))
    throw Error('Invalid character composition transaction');
  if (plainObject(composition)) {
    previousRaw = composition.previousRaw;
    selectionStart = composition.selectionStart;
    selectionEnd = composition.selectionEnd;
  }
  if (typeof previousRaw !== 'string' || typeof nextRaw !== 'string')
    throw Error('Character edit requires previous and next raw text');
  if (isComposing) return { record, status: 'provisional', reason: null };
  const oldBasis = normalizeCharacterText(previousRaw),
    nextBasis = normalizeCharacterText(nextRaw);
  if (!record)
    return { record, status: oldBasis === nextBasis ? 'unchanged' : 'applied', reason: null };
  const replacement = verifiedReplacement(
    previousRaw,
    nextRaw,
    selectionStart,
    selectionEnd,
    inputType,
    composition,
  );
  // Equal content alone cannot distinguish a selected-range paste from doing nothing. The
  // captured replacement proves which IDs to discard, including repeated/same-value text.
  // Keep pure representation changes and IME cancellation stable unless the caller explicitly
  // knows this was a replacement rather than cancellation/canonical source normalization.
  const equivalentReplacement =
    record.basis === oldBasis &&
    replacement &&
    replacement.end > replacement.start &&
    (forceReplacement ||
      (previousRaw === nextRaw &&
        !composition &&
        inputType?.startsWith('insert') &&
        !inputType.includes('Composition')));
  if (record.basis === nextBasis && !equivalentReplacement)
    return { record, status: 'unchanged', reason: null };
  function unresolved(reason) {
    if (!hasCharacterAdjustments(record))
      return { record: allocate(nextBasis, record.nextId), status: 'applied', reason: null };
    return { record, status: 'suspended', reason };
  }
  if (record.basis !== oldBasis)
    return unresolved(
      'Character positions remain suspended until the saved text is restored or all adjustments are reset.',
    );
  if (!replacement)
    return unresolved(
      'Character positions are suspended because this text edit could not be verified. Undo, restore the previous text, or reset all adjustments.',
    );
  const affected = affectedWindow(previousRaw, nextRaw, oldBasis, nextBasis, replacement);
  if (!affected)
    return unresolved(
      'Character positions are suspended because normalization crosses an unverified text boundary.',
    );
  const { prefixCount, suffixCount, newMiddle } = affected;
  const allocated = allocate(newMiddle, record.nextId);
  const units = [
    ...record.units.slice(0, prefixCount),
    ...allocated.units,
    ...(suffixCount ? record.units.slice(-suffixCount) : []),
  ];
  const retained = new Set(units.map((unit) => unit.id));
  const offsets = Object.fromEntries(
    Object.entries(record.offsets).filter(([id]) => retained.has(id)),
  );
  const next = { ...record, basis: nextBasis, units, offsets, nextId: allocated.nextId };
  if (record.transforms)
    next.transforms = Object.fromEntries(
      Object.entries(record.transforms).filter(([id]) => retained.has(id)),
    );
  if (record.styles)
    next.styles = Object.fromEntries(
      Object.entries(record.styles).filter(([id]) => retained.has(id)),
    );
  if (record.kerningPairs) {
    const adjacent = adjacentPairKeys(units);
    next.kerningPairs = Object.fromEntries(
      Object.entries(record.kerningPairs).filter(([key]) => adjacent.has(key)),
    );
  }
  validateCharacterPositions(next);
  return { record: next, status: 'applied', reason: null };
}
