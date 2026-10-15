// Stable editor-control identity across a structural render; no selector interpolation.
function identity(el) {
  const field = el.closest('.field[data-node]');
  return JSON.stringify({
    zone: el.closest('.inspector-body') ? 'inspector' : el.closest('.graph') ? 'graph' : 'app',
    node: el.closest('.node')?.dataset.id,
    field: field ? [field.dataset.node, field.dataset.key] : null,
    tag: el.tagName,
    id: el.id,
    label: el.getAttribute('aria-label'),
    data: { ...el.dataset },
  });
}
export function captureFocus(root) {
  const el = root.ownerDocument.activeElement;
  if (!el || !root.contains(el) || !el.matches('input,select,textarea,button,[tabindex="0"]'))
    return null;
  return {
    identity: identity(el),
    value: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
    direction: el.selectionDirection,
  };
}
export function restoreFocus(root, state) {
  if (!state) return;
  const el = [...root.querySelectorAll('input,select,textarea,button,[tabindex="0"]')].find(
    (candidate) => identity(candidate) === state.identity && !candidate.disabled,
  );
  if (!el) return;
  el.focus({ preventScroll: true });
  // Keep a draft that has not emitted change yet. Committed edits live in the model.
  if (el.matches('input:not([type=file]):not([type=checkbox]):not([type=color]),textarea'))
    el.value = state.value;
  if (state.start !== null && state.start !== undefined && el.setSelectionRange)
    try {
      el.setSelectionRange(state.start, state.end, state.direction);
    } catch {}
}
