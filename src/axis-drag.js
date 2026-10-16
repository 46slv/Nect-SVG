// Axis choice is gesture state only; it never enters the editable document.
// Deltas are in artboard coordinates. The threshold is measured in screen pixels.
export function constrainAxisDrag(state, delta, screenDelta, shift) {
  if (!shift) {
    state.axis = null;
    return { delta: [...delta], axis: null, pending: false };
  }
  if (state.axis == null) {
    if (Math.hypot(...screenDelta) < 3) return { delta: [0, 0], axis: null, pending: true };
    // Exact diagonals deterministically choose horizontal. Once chosen, crossing
    // the diagonal or reversing direction cannot change the held axis.
    state.axis = Math.abs(delta[0]) >= Math.abs(delta[1]) ? 0 : 1;
  }
  return {
    delta: delta.map((v, i) => (i === state.axis ? v : 0)),
    axis: state.axis,
    pending: false,
  };
}
