import { resolveArtworkMoveTarget } from './artwork-move-target.js';

// Selection is editor state. The document keeps its independent layer graphs.
export function resolveArtworkMoveSelection(doc, layerIds, options = {}) {
  const ids = [...layerIds];
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
    return { supported: false, reason: 'Choose a nonempty set of unique artwork layers.' };
  const targets = [];
  for (const id of ids) {
    const resolved = resolveArtworkMoveTarget(doc, id, options);
    if (!resolved.supported) {
      if (ids.length === 1) return resolved;
      const name = doc.layers.find((l) => l.id === id)?.name || id;
      return {
        supported: false,
        reason: `${name}: ${resolved.reason} No selected artwork moved.`,
      };
    }
    targets.push(resolved.target);
  }
  return {
    supported: true,
    target: targets.length === 1 ? targets[0] : { scope: 'artwork-selection', targets },
  };
}

// Plan every position in every layer before the first write, including overflow
// and late Curve topology failures. Values are always based on gesture origins.
export function translateArtworkTargets(doc, target, delta) {
  const targets = target.scope === 'artwork-selection' ? target.targets : [target];
  translateArtworkMoves(
    doc,
    targets?.map((target) => ({ target, delta })),
  );
}

// Also used by selection alignment, where each artwork has its own delta.
// All members still share the same preflight and single final write boundary.
export function translateArtworkMoves(doc, moves) {
  if (!moves?.length || new Set(moves.map((m) => m.target.layerId)).size !== moves.length)
    throw Error('Choose unique artwork move targets');
  const plan = [];
  for (const { target: t, delta } of moves) {
    if (
      !Array.isArray(delta) ||
      delta.length !== 2 ||
      !Number.isFinite(delta[0]) ||
      !Number.isFinite(delta[1])
    )
      throw Error('Artwork target or delta is unavailable');
    const l = doc.layers.find((l) => l.id === t.layerId),
      n = l?.nodes.find((n) => n.id === t.nodeId);
    if (!n) throw Error('Artwork target or delta is unavailable');
    const batch = t.kind === 'curve-point-positions';
    if (
      batch &&
      (!Array.isArray(n.points) ||
        n.points.length !== t.pointIds.length ||
        n.points.some((pt, i) => pt.id !== t.pointIds[i]))
    )
      throw Error('Artwork anchor topology changed');
    const inputs = batch ? n.points.map((pt) => pt.position) : [n.params[t.parameter]],
      values = batch ? t.positions : [t.value];
    if (!Array.isArray(values) || values.length !== inputs.length)
      throw Error('Artwork translation needs every finite starting position');
    for (let i = 0; i < inputs.length; i++) {
      const value = values[i];
      if (
        !inputs[i] ||
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isFinite(value[0]) ||
        !Number.isFinite(value[1])
      )
        throw Error('Artwork translation needs every finite starting position');
      const next = value.map((v, axis) => v + delta[axis]);
      if (!next.every(Number.isFinite))
        throw Error('Artwork translation must keep every position finite');
      plan.push([inputs[i], next]);
    }
  }
  for (const [input, next] of plan) input.value = next;
}
