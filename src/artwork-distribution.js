import { cloneDocument, validate } from './core.js';
import { resolveArtworkMoveTarget } from './artwork-move-target.js';
import { translateArtworkMoves } from './artwork-multi-move.js';
import { artworkBoundsPrecision } from './artwork-alignment.js';

export const artworkDistributions = [
  ['center-x', '横方向', 0],
  ['center-y', '縦方向', 1],
];

export function resolveArtworkDistribution(doc, layerIds, options = {}) {
  const ids = [...layerIds];
  if (ids.length < 3 || ids.length > 100 || new Set(ids).size !== ids.length)
    return {
      supported: false,
      reason: 'Select 3–100 unique artwork layers to distribute centers.',
    };
  const members = [];
  for (const id of ids) {
    const resolved = resolveArtworkMoveTarget(doc, id, options);
    if (!resolved.supported)
      return {
        supported: false,
        reason: `${doc.layers.find((l) => l.id === id)?.name || id}: ${resolved.reason} No selected artwork distributed.`,
      };
    members.push({ target: resolved.target, bounds: resolved.bounds });
  }
  return { supported: true, members };
}

export function distributeArtworkSelection(doc, layerIds, action, options = {}) {
  const distribution = artworkDistributions.find(([id]) => id === action);
  if (!distribution) throw Error('Choose horizontal or vertical artwork center distribution.');
  // Resolve the entire selection afresh, including the fixed endpoints.
  const ids = [...layerIds],
    resolved = resolveArtworkDistribution(doc, ids, options);
  if (!resolved.supported) throw Error(resolved.reason);
  const axis = distribution[2],
    order = new Map(doc.layers.map((l, i) => [l.id, i]));
  const members = resolved.members.toSorted(
    (a, b) =>
      a.bounds[axis][1] - b.bounds[axis][1] ||
      order.get(a.target.layerId) - order.get(b.target.layerId),
  );
  const first = members[0].bounds[axis][1],
    last = members.at(-1).bounds[axis][1];
  const moves = members.slice(1, -1).map(({ target, bounds }, i) => {
    const fraction = (i + 1) / (members.length - 1);
    // Convex interpolation avoids overflowing last - first for finite bounds.
    const distance = first * (1 - fraction) + last * fraction - bounds[axis][1];
    const delta = [0, 0];
    delta[axis] = Math.abs(distance) <= 1e-9 ? 0 : distance;
    return { target, delta };
  });
  if (moves.every(({ delta }) => Math.abs(delta[axis]) <= artworkBoundsPrecision(members)))
    return false;
  // Use the same all-position preflight and stored-value validation as alignment.
  // Neither an invalid middle member nor a late output failure can partially write.
  const candidate = cloneDocument(doc);
  try {
    translateArtworkMoves(candidate, moves);
    validate(candidate);
    const next = resolveArtworkDistribution(candidate, ids, options);
    if (!next.supported) throw Error(next.reason);
  } catch (error) {
    throw Error(`${error.message} No selected artwork distributed.`);
  }
  translateArtworkMoves(doc, moves);
  return true;
}
