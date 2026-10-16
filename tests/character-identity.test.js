import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCharacterText,
  createCharacterPositions,
  validateCharacterPositions,
  hasCharacterOffsets,
  characterPositionStatus,
  setCharacterOffsets,
  resetCharacterOffsets,
  reconcileCharacterEdit,
  MAX_CHARACTER_OFFSET,
} from '../src/character-identity.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
function adjusted(raw, index = 1, value = [12, -7]) {
  const initial = createCharacterPositions(raw);
  return setCharacterOffsets(raw, initial, { [initial.units[index].id]: value });
}
function edit(
  record,
  previousRaw,
  nextRaw,
  start,
  end = start,
  inputType = 'insertText',
  extra = {},
) {
  return reconcileCharacterEdit(record, {
    previousRaw,
    nextRaw,
    selectionStart: start,
    selectionEnd: end,
    inputType,
    ...extra,
  });
}
const ids = (record) => record.units.map((unit) => unit.id);

// These tests exercise logical identities, not grapheme/glyph or font correspondence.
test('normalization agrees for CRLF, CR, NFC and surrogate pairs without NFKC', () => {
  const raw = 'カ\u3099\r\nＡ\r😀';
  assert.equal(normalizeCharacterText(raw), 'ガ\nＡ\n😀');
  const record = createCharacterPositions(raw);
  assert.deepEqual(
    record.units.map((unit) => unit.text),
    ['ガ', '\n', 'Ａ', '\n', '😀'],
  );
  assert.deepEqual(ids(record), ['c1', 'c2', 'c3', 'c4', 'c5']);
  assert.equal(record.nextId, 6);
  assert.equal(validateCharacterPositions(record), record);
  assert.equal(record.basis, 'ガ\nＡ\n😀');
});

test('legacy/no-offset fast path allocates no identity through edits, composition or zero change', () => {
  assert.equal(createCharacterPositions('').nextId, 1);
  assert.equal(validateCharacterPositions(undefined), undefined);
  assert.equal(hasCharacterOffsets(undefined), false);
  assert.deepEqual(characterPositionStatus('ABC', undefined), {
    active: false,
    suspended: false,
    reason: null,
  });
  for (const inputType of ['insertText', 'historyUndo', 'unknown', undefined]) {
    const result = edit(undefined, 'AA', 'AAA', undefined, undefined, inputType);
    assert.equal(result.record, undefined);
    assert.equal(result.status, 'applied');
  }
  assert.equal(setCharacterOffsets('ABC', undefined, {}), undefined);
  assert.equal(setCharacterOffsets('ABC', undefined, { c2: [0, -0] }), undefined);
  assert.equal(resetCharacterOffsets('ABC', undefined), undefined);
  assert.equal(
    edit(undefined, 'A', 'あ', 0, 1, 'insertCompositionText', { isComposing: true }).record,
    undefined,
  );
});

test('absolute offset writes are lazy, sparse, bounded, independent and immutable', () => {
  const changes = { c2: [12, -7] };
  const record = setCharacterOffsets('ABC', undefined, changes);
  changes.c2[0] = 999;
  assert.deepEqual(record.offsets, { c2: [12, -7] });
  assert.equal(hasCharacterOffsets(record), true);
  assert.equal(characterPositionStatus('ABC', record).suspended, false);
  assert.equal(setCharacterOffsets('ABC', record, { c2: [12, -7] }), record);
  const next = setCharacterOffsets('ABC', record, {
    c1: [-MAX_CHARACTER_OFFSET, MAX_CHARACTER_OFFSET],
    c2: [12, 5],
  });
  assert.deepEqual(record.offsets, { c2: [12, -7] });
  assert.deepEqual(next.offsets, { c1: [-100000, 100000], c2: [12, 5] });
  const reset = setCharacterOffsets('ABC', next, { c2: [0, 0] });
  assert.deepEqual(reset.offsets, { c1: [-100000, 100000] });
  assert.deepEqual(ids(reset), ids(record));
});

test('AA insertion uses captured start/end to preserve the adjusted occurrence', () => {
  const record = adjusted('AA');
  const beginning = edit(record, 'AA', 'AAA', 0);
  const ending = edit(record, 'AA', 'AAA', 2);
  const middle = edit(record, 'AA', 'AAA', 1);
  assert.equal(beginning.status, 'applied');
  assert.deepEqual(ids(beginning.record), ['c3', 'c1', 'c2']);
  assert.deepEqual(ids(ending.record), ['c1', 'c2', 'c3']);
  assert.deepEqual(ids(middle.record), ['c1', 'c3', 'c2']);
  for (const result of [beginning, ending, middle]) {
    assert.deepEqual(result.record.offsets, { c2: [12, -7] });
    assert.equal(result.record.nextId, 4);
  }
  assert.deepEqual(ids(record), ['c1', 'c2']);
});

test('ambiguous repeated-text edits and native history without a snapshot suspend instead of diff guessing', () => {
  const record = adjusted('AA');
  for (const transaction of [
    { previousRaw: 'AA', nextRaw: 'AAA' },
    { previousRaw: 'AA', nextRaw: 'AAA', selectionStart: 0, selectionEnd: 0 },
    {
      previousRaw: 'AA',
      nextRaw: 'AAA',
      selectionStart: 2,
      selectionEnd: 2,
      inputType: 'historyUndo',
    },
    {
      previousRaw: 'AA',
      nextRaw: 'AAA',
      selectionStart: 0,
      selectionEnd: 0,
      inputType: 'historyRedo',
    },
    {
      previousRaw: 'AA',
      nextRaw: 'AAA',
      selectionStart: 0.5,
      selectionEnd: 0.5,
      inputType: 'insertText',
    },
  ]) {
    const result = reconcileCharacterEdit(record, transaction);
    assert.equal(result.status, 'suspended');
    assert.equal(result.record, record);
    assert.match(result.reason, /suspended/);
  }
  assert.equal(characterPositionStatus('AAA', record).suspended, true);
  assert.equal(validateCharacterPositions(record), record);
});

test('backward/forward deletion derives its window from the captured caret, including repeated units', () => {
  const record = adjusted('AAA');
  const backward = edit(record, 'AAA', 'AA', 2, 2, 'deleteContentBackward');
  assert.deepEqual(ids(backward.record), ['c1', 'c3']);
  assert.deepEqual(backward.record.offsets, {});
  const forward = edit(record, 'AAA', 'AA', 2, 2, 'deleteContentForward');
  assert.deepEqual(ids(forward.record), ['c1', 'c2']);
  assert.deepEqual(forward.record.offsets, { c2: [12, -7] });
  const before = edit(record, 'AAA', 'AA', 1, 1, 'deleteContentBackward');
  assert.deepEqual(ids(before.record), ['c2', 'c3']);
});

test('word and selected deletion use verified raw extent and reject unexplained side edits', () => {
  const record = adjusted('one two', 6);
  const word = edit(record, 'one two', 'two', 4, 4, 'deleteWordBackward');
  assert.deepEqual(ids(word.record), ['c5', 'c6', 'c7']);
  assert.deepEqual(word.record.offsets, { c7: [12, -7] });
  const forward = edit(record, 'one two', 'two', 0, 0, 'deleteWordForward');
  assert.deepEqual(ids(forward.record), ids(word.record));
  const cut = edit(record, 'one two', 'two', 0, 4, 'deleteByCut');
  assert.deepEqual(ids(cut.record), ids(word.record));
  assert.equal(edit(record, 'one two', 'two', 0, 0, 'deleteByCut').status, 'suspended');
  assert.equal(edit(record, 'one two', 'new two', 0, 4, 'deleteByCut').status, 'suspended');
  assert.equal(edit(record, 'one two', 'one XtwZ', 4, 4).status, 'suspended');
});

test('paste/replacement creates new zeroed units, retains untouched identities, and never recycles IDs', () => {
  const record = adjusted('ABC');
  const replace = edit(record, 'ABC', 'AXYC', 1, 2, 'insertFromPaste');
  assert.deepEqual(ids(replace.record), ['c1', 'c4', 'c5', 'c3']);
  assert.deepEqual(replace.record.offsets, {});
  const again = edit(replace.record, 'AXYC', 'ABYC', 1, 2, 'insertReplacementText');
  assert.deepEqual(ids(again.record), ['c1', 'c6', 'c5', 'c3']);
  assert.equal(again.record.nextId, 7);
  const all = edit(record, 'ABC', 'CBA', 0, 3, 'insertFromPaste');
  assert.deepEqual(ids(all.record), ['c4', 'c5', 'c6']);
  assert.deepEqual(all.record.offsets, {});
  const deletion = edit(record, 'ABC', '', 0, 3, 'deleteContentBackward');
  assert.deepEqual(deletion.record.units, []);
  assert.equal(deletion.record.nextId, 4);
});

test('inserted line breaks, blank lines and spaces retain adjusted characters without newline offsets', () => {
  const record = adjusted('AB');
  const next = edit(record, 'AB', 'A\n\n B', 1, 1, 'insertFromPaste');
  assert.deepEqual(
    next.record.units.map((unit) => unit.text),
    ['A', '\n', '\n', ' ', 'B'],
  );
  assert.deepEqual(ids(next.record), ['c1', 'c3', 'c4', 'c5', 'c2']);
  assert.deepEqual(next.record.offsets, { c2: [12, -7] });
  assert.throws(() => setCharacterOffsets('A\n\n B', next.record, { c3: [1, 2] }), /newline/);
  const space = setCharacterOffsets('A\n\n B', next.record, { c5: [3, 4] });
  assert.deepEqual(space.offsets.c5, [3, 4]);
});

test('CRLF-only and canonical-only representation changes keep all identities and adjustments', () => {
  const original = adjusted('ガ\r\nA', 0);
  const changes = [
    ['ガ\r\nA', 'カ\u3099\nA'],
    ['カ\u3099\nA', 'ガ\rA'],
    ['ガ\rA', 'カ\u3099\r\nA'],
  ];
  for (const [previousRaw, nextRaw] of changes) {
    const result = edit(original, previousRaw, nextRaw, undefined);
    assert.equal(result.record, original);
    assert.equal(result.status, 'unchanged');
  }
});

test('UTF-16 raw indices map across NFC and CRLF to the correct later character', () => {
  const raw = 'カ\u3099\r\nAB';
  const record = adjusted(raw, 3);
  const inserted = edit(record, raw, 'カ\u3099\r\nAXB', 5);
  assert.deepEqual(ids(inserted.record), ['c1', 'c2', 'c3', 'c5', 'c4']);
  assert.deepEqual(inserted.record.offsets, { c4: [12, -7] });
  const newline = edit(record, raw, 'カ\u3099AB', 4, 4, 'deleteContentBackward');
  assert.deepEqual(ids(newline.record), ['c1', 'c3', 'c4']);
  assert.deepEqual(newline.record.offsets, { c4: [12, -7] });
});

test('normalization expands the affected window when a new mark composes across its left boundary', () => {
  const record = setCharacterOffsets('カA', undefined, { c1: [9, 2], c2: [12, -7] });
  const result = edit(record, 'カA', 'カ\u3099A', 1);
  assert.equal(result.record.basis, 'ガA');
  assert.deepEqual(ids(result.record), ['c3', 'c2']);
  assert.deepEqual(result.record.offsets, { c2: [12, -7] });
});

test('normalization expands the affected window when replacement changes a starter before a mark', () => {
  const raw = 'カ\u3099A';
  const record = setCharacterOffsets(raw, undefined, { c1: [9, 2], c2: [12, -7] });
  const result = edit(record, raw, 'ハ\u3099A', 0, 1);
  assert.equal(result.record.basis, 'バA');
  assert.deepEqual(ids(result.record), ['c3', 'c2']);
  assert.deepEqual(result.record.offsets, { c2: [12, -7] });
});

test('Hangul normalization at both replacement boundaries is verified rather than index-rebound', () => {
  const record = adjusted('\u1100\u1161X', 1);
  const added = edit(record, '\u1100\u1161X', '\u1100\u1161\u11a8X', 2);
  assert.equal(added.record.basis, '각X');
  assert.deepEqual(ids(added.record), ['c3', 'c2']);
  assert.deepEqual(added.record.offsets, { c2: [12, -7] });
  const replaced = edit(record, '\u1100\u1161X', '\u1102\u1161X', 0, 1);
  assert.equal(replaced.record.basis, '나X');
  assert.deepEqual(ids(replaced.record), ['c3', 'c2']);
});

test('CRLF boundaries expand safely when an insertion splits the raw newline pair', () => {
  const record = adjusted('A\r\nB', 2);
  const result = edit(record, 'A\r\nB', 'A\rX\nB', 2);
  assert.equal(result.record.basis, 'A\nX\nB');
  assert.deepEqual(ids(result.record), ['c1', 'c4', 'c5', 'c6', 'c3']);
  assert.deepEqual(result.record.offsets, { c3: [12, -7] });
});

test('surrogate pairs stay atomic for insertion/deletion and split selections suspend', () => {
  const record = adjusted('A😀B', 2);
  const insert = edit(record, 'A😀B', 'A😀XB', 3);
  assert.deepEqual(ids(insert.record), ['c1', 'c2', 'c4', 'c3']);
  const backward = edit(record, 'A😀B', 'AB', 3, 3, 'deleteContentBackward');
  assert.deepEqual(ids(backward.record), ['c1', 'c3']);
  const forward = edit(record, 'A😀B', 'AB', 1, 1, 'deleteContentForward');
  assert.deepEqual(ids(forward.record), ['c1', 'c3']);
  assert.equal(edit(record, 'A😀B', 'AXB', 1, 2).status, 'suspended');
  assert.deepEqual(backward.record.offsets, { c3: [12, -7] });
});

test('IME fragments are provisional and final verified replacement commits identity only once', () => {
  const raw = 'AかなB';
  const record = adjusted(raw, 3);
  for (const fragment of ['AkB', 'AかB', 'A漢B', 'A漢字B']) {
    const result = edit(record, raw, fragment, 1, 3, 'insertCompositionText', {
      isComposing: true,
    });
    assert.equal(result.record, record);
    assert.equal(result.status, 'provisional');
    assert.equal(record.nextId, 5);
  }
  const final = edit(record, 'A漢B', 'A漢字B', 2, 2, 'insertFromComposition', {
    isComposing: false,
    composition: { previousRaw: raw, selectionStart: 1, selectionEnd: 3 },
  });
  assert.equal(final.status, 'applied');
  assert.deepEqual(ids(final.record), ['c1', 'c5', 'c6', 'c4']);
  assert.deepEqual(final.record.offsets, { c4: [12, -7] });
  const noType = reconcileCharacterEdit(record, {
    previousRaw: raw,
    nextRaw: 'A漢字B',
    selectionStart: 1,
    selectionEnd: 3,
    composition: true,
  });
  assert.deepEqual(noType.record, final.record);
  const cancelled = edit(record, raw, raw, 1, 3, 'insertCompositionText', { composition: true });
  assert.equal(cancelled.record, record);
  assert.equal(cancelled.status, 'unchanged');
});

test('IME final value must still match the captured outer text and range', () => {
  const record = adjusted('AかなB', 3);
  const result = edit(record, 'AかなB', 'X漢字B', 1, 3, 'insertFromComposition', {
    composition: true,
  });
  assert.equal(result.status, 'suspended');
  assert.equal(result.record, record);
});

test('unadjusted unknown edits receive fresh IDs and stale empty records accept runtime c1 IDs', () => {
  const record = createCharacterPositions('AA');
  const next = edit(record, 'AA', 'AAA', undefined, undefined, 'historyUndo');
  assert.equal(next.status, 'applied');
  assert.deepEqual(ids(next.record), ['c3', 'c4', 'c5']);
  const changed = setCharacterOffsets('B', record, { c1: [9, 2] });
  assert.equal(changed.basis, 'B');
  assert.deepEqual(changed.offsets, { c1: [9, 2] });
});

test('suspended state cannot rebind on further edits; restoring exact normalized basis recovers it', () => {
  const record = adjusted('AA');
  const result = edit(record, 'AAA', 'AAAX', 3);
  assert.equal(result.status, 'suspended');
  assert.equal(result.record, record);
  assert.throws(() => setCharacterOffsets('AAA', record, { c1: [5, 2] }), /suspended/);
  const recovered = edit(record, 'AAA', 'AA', 3, 3, 'deleteContentBackward');
  assert.equal(recovered.status, 'unchanged');
  assert.equal(recovered.record, record);
  assert.equal(characterPositionStatus('AA', record).suspended, false);
});

test('reset selected/all preserves original data and reset-all recovers a suspended basis', () => {
  const record = setCharacterOffsets('AB', undefined, { c1: [1, 2], c2: [3, 4] });
  assert.equal(resetCharacterOffsets('AB', record, []), record);
  const selected = resetCharacterOffsets('AB', record, ['c2']);
  assert.deepEqual(selected.offsets, { c1: [1, 2] });
  assert.deepEqual(resetCharacterOffsets('AB', record).offsets, {});
  const recovered = resetCharacterOffsets('ABC', record);
  assert.equal(recovered.basis, 'ABC');
  assert.deepEqual(recovered.offsets, {});
  assert.equal(characterPositionStatus('ABC', recovered).suspended, false);
  assert.deepEqual(record.offsets, { c1: [1, 2], c2: [3, 4] });
  assert.throws(() => resetCharacterOffsets('AB', record, ['c999']), /unknown/);
});

test('invalid records are rejected transactionally, including duplicate IDs, sparse vectors and unknown references', () => {
  const good = adjusted('A\nB', 2);
  const invalid = [
    null,
    [],
    {},
    { ...good, version: 2 },
    { ...good, nextId: 3 },
    { ...good, nextId: Infinity },
    { ...good, surprise: true },
  ];
  for (const change of [
    (value) => {
      value.units[2].id = value.units[0].id;
    },
    (value) => {
      value.units[0].id = '__proto__';
    },
    (value) => {
      value.units[0].text = 'AA';
    },
    (value) => {
      value.units[0].text = '\ud800';
    },
    (value) => {
      value.basis = 'Different';
    },
    (value) => {
      value.basis = 'カ\u3099';
    },
    (value) => {
      value.offsets = [];
    },
    (value) => {
      value.offsets.c99 = [1, 2];
    },
    (value) => {
      value.offsets.c2 = [1, 2];
    },
    (value) => {
      value.offsets.c3 = [Infinity, 2];
    },
    (value) => {
      value.offsets.c3 = [NaN, 2];
    },
    (value) => {
      value.offsets.c3 = ['2', 2];
    },
    (value) => {
      value.offsets.c3 = [1];
    },
    (value) => {
      value.offsets.c3 = new Array(2);
    },
    (value) => {
      value.offsets.c3 = [100001, 0];
    },
    (value) => {
      value.units.length = 10001;
    },
  ]) {
    const value = copy(good);
    change(value);
    invalid.push(value);
  }
  const saved = JSON.stringify(good);
  for (const value of invalid) assert.throws(() => validateCharacterPositions(value));
  assert.throws(() => setCharacterOffsets(good.basis, good, { c1: [5, 2], c3: [Infinity, 2] }));
  assert.equal(JSON.stringify(good), saved);
  assert.equal(validateCharacterPositions(JSON.parse(saved)).basis, good.basis);
});

test('bad raw text, malformed transactions and text budgets are rejected explicitly', () => {
  for (const value of [null, undefined, 1, {}, 'X'.repeat(10001), '\ud800', '\udc00'])
    assert.throws(() => normalizeCharacterText(value));
  assert.equal(createCharacterPositions('X'.repeat(10000)).units.length, 10000);
  assert.throws(() => createCharacterPositions('\u0344'.repeat(10000)), /Normalized/);
  assert.throws(() => reconcileCharacterEdit(undefined, null));
  assert.throws(() => reconcileCharacterEdit(undefined, { previousRaw: 'A', nextRaw: null }));
  assert.throws(() => edit(undefined, 'A', 'B', 0, 1, 'insertText', { isComposing: 'true' }));
  assert.throws(() => edit(undefined, 'A', 'B', 0, 1, 'insertText', { composition: 1 }));
});

test('pure staged records can be restored by caller draft/app undo and duplicated independently', () => {
  const original = adjusted('ABC');
  const snapshot = copy(original);
  const result = edit(original, 'ABC', 'AXC', 1, 2);
  assert.deepEqual(result.record.offsets, {});
  assert.deepEqual(original, snapshot);
  const duplicated = copy(original);
  const moved = setCharacterOffsets('ABC', duplicated, { c2: [50, 20] });
  assert.deepEqual(original.offsets, { c2: [12, -7] });
  assert.deepEqual(moved.offsets, { c2: [50, 20] });
  assert.deepEqual(snapshot.offsets, { c2: [12, -7] });
});

test('bounded randomized verified replacements preserve valid records across Unicode normalization boundaries', () => {
  let seed = 123456;
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const alphabet = [
    'A',
    'A',
    'B',
    'カ',
    '\u3099',
    '\u0301',
    '\u0327',
    '\u1100',
    '\u1161',
    '\u11a8',
    '\r',
    '\n',
    '😀',
  ];
  for (let attempt = 0; attempt < 500; attempt++) {
    const pieces = Array.from({ length: random(10) + 1 }, () => alphabet[random(alphabet.length)]);
    const raw = pieces.join('');
    let record = createCharacterPositions(raw);
    const target = record.units.find((unit) => unit.text !== '\n');
    if (!target) continue;
    record = setCharacterOffsets(raw, record, { [target.id]: [1, 2] });
    const snapshot = copy(record);
    const startUnit = random(pieces.length + 1);
    const endUnit = startUnit + random(pieces.length - startUnit + 1);
    const inserted = Array.from(
      { length: random(4) },
      () => alphabet[random(alphabet.length)],
    ).join('');
    const start = pieces.slice(0, startUnit).join('').length;
    const end = pieces.slice(0, endUnit).join('').length;
    const nextRaw = raw.slice(0, start) + inserted + raw.slice(end);
    const result = edit(record, raw, nextRaw, start, end, 'insertFromPaste');
    assert.notEqual(result.status, 'suspended', JSON.stringify({ raw, nextRaw, start, end }));
    assert.equal(validateCharacterPositions(result.record).basis, normalizeCharacterText(nextRaw));
    for (const unit of result.record.units) {
      const previous = record.units.find((old) => old.id === unit.id);
      if (previous) assert.equal(previous.text, unit.text);
      else assert.equal(Object.hasOwn(result.record.offsets, unit.id), false);
    }
    assert.deepEqual(record, snapshot);
  }
});

test('same-value whole-text paste and selected-character replacement get new IDs and zero offsets', () => {
  const record = adjusted('ABA');
  const all = edit(record, 'ABA', 'ABA', 0, 3, 'insertFromPaste');
  assert.equal(all.status, 'applied');
  assert.deepEqual(ids(all.record), ['c4', 'c5', 'c6']);
  assert.deepEqual(all.record.offsets, {});
  for (const inputType of ['insertText', 'insertFromPaste', 'insertReplacementText']) {
    const selected = edit(record, 'ABA', 'ABA', 1, 2, inputType);
    assert.equal(selected.status, 'applied');
    assert.deepEqual(ids(selected.record), ['c1', 'c4', 'c3']);
    assert.deepEqual(selected.record.offsets, {});
  }
  const unadjusted = edit(record, 'ABA', 'ABA', 0, 1, 'insertFromPaste');
  assert.deepEqual(ids(unadjusted.record), ['c4', 'c2', 'c3']);
  assert.deepEqual(unadjusted.record.offsets, { c2: [12, -7] });
  assert.deepEqual(ids(record), ['c1', 'c2', 'c3']);
  assert.deepEqual(record.offsets, { c2: [12, -7] });
});

test('same-value no-ops and cancelled IME preserve IDs while explicit replacement intent can override', () => {
  const record = adjusted('ABA');
  for (const result of [
    edit(record, 'ABA', 'ABA', 1, 1, 'insertText'),
    edit(record, 'ABA', 'ABA', 1, 2, 'historyUndo'),
    edit(record, 'ABA', 'ABA', 1, 2, 'insertCompositionText'),
    edit(record, 'ABA', 'ABA', 1, 2, 'insertFromComposition', { composition: true }),
    reconcileCharacterEdit(record, { previousRaw: 'ABA', nextRaw: 'ABA' }),
  ]) {
    assert.equal(result.status, 'unchanged');
    assert.equal(result.record, record);
  }
  const explicit = edit(record, 'ABA', 'ABA', 1, 2, 'insertFromComposition', {
    composition: true,
    forceReplacement: true,
  });
  assert.deepEqual(ids(explicit.record), ['c1', 'c4', 'c3']);
  assert.deepEqual(explicit.record.offsets, {});
  assert.equal(edit(undefined, 'ABA', 'ABA', 0, 3, 'insertFromPaste').record, undefined);
  assert.throws(
    () => edit(record, 'ABA', 'ABA', 1, 2, 'insertText', { forceReplacement: 'yes' }),
    /intent/,
  );
});

test('selected canonical/CRLF representation changes preserve identity unless explicitly replacements', () => {
  const raw = 'ガ\r\nA';
  const nextRaw = 'カ\u3099\nA';
  const record = adjusted(raw, 0);
  const representation = edit(record, raw, nextRaw, 0, raw.length, 'insertReplacementText');
  assert.equal(representation.status, 'unchanged');
  assert.equal(representation.record, record);
  const replacement = edit(record, raw, nextRaw, 0, raw.length, 'insertFromPaste', {
    forceReplacement: true,
  });
  assert.equal(replacement.status, 'applied');
  assert.deepEqual(ids(replacement.record), ['c4', 'c5', 'c6']);
  assert.deepEqual(replacement.record.offsets, {});
});
