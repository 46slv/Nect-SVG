import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { captureFocus, restoreFocus } from '../src/focus.js';
test('focus restoration distinguishes graph/inspector and retains text selection without stale targets', () => {
  const win = new Window();
  const root = win.document.body;
  const markup =
    '<div class="graph"><div class="field" data-node="n" data-key="text"><input aria-label="Text" value="graph"></div></div><div class="inspector-body"><div class="field" data-node="n" data-key="text"><input aria-label="Text" value="inspector"></div></div>';
  root.innerHTML = markup;
  const input = root.querySelector('.inspector-body input');
  input.focus();
  input.value = 'draft value';
  input.setSelectionRange(2, 7);
  const snapshot = captureFocus(root);
  root.innerHTML = markup;
  restoreFocus(root, snapshot);
  assert.equal(win.document.activeElement, root.querySelector('.inspector-body input'));
  assert.equal(win.document.activeElement.value, 'draft value');
  assert.equal(win.document.activeElement.selectionStart, 2);
  assert.equal(win.document.activeElement.selectionEnd, 7);
  root.querySelector('.inspector-body input').remove();
  restoreFocus(root, snapshot);
  assert.notEqual(win.document.activeElement, root.querySelector('.graph input'));
});
