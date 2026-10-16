import { cloneDocument, validate } from './core.js';
import { resolveArtworkMoveTarget } from './artwork-move-target.js';
import { translateArtworkMoves } from './artwork-multi-move.js';

export const artworkAlignments = [
  ['left', 'Left', 0, 0],
  ['center-x', 'Horizontal center', 0, 1],
  ['right', 'Right', 0, 2],
  ['top', 'Top', 1, 0],
  ['center-y', 'Vertical center', 1, 1],
  ['bottom', 'Bottom', 1, 2],
];

// Final Text outlines are serialized with toPathData(5) in core. Share the
// existing rendering/no-op precision with other bounds-based layout commands.
export function artworkBoundsPrecision(members) {
  return members.some(({ target }) => target.route.some((n) => n.type === 'Text'))
    ? 1e-5 + 1e-9
    : 1e-9;
}

export function resolveArtworkAlignment(doc, layerIds, options = {}) {
  const ids = [...layerIds];
  if (ids.length < 2 || ids.length > 100 || new Set(ids).size !== ids.length)
    return { supported: false, reason: 'Select 2–100 unique artwork layers to align.' };
  const members = [];
  for (const id of ids) {
    const r = resolveArtworkMoveTarget(doc, id, options);
    if (!r.supported)
      return {
        supported: false,
        reason: `${doc.layers.find((l) => l.id === id)?.name || id}: ${r.reason} No selected artwork aligned.`,
      };
    members.push({ target: r.target, bounds: r.bounds });
  }
  const bounds = [0, 1].map((axis) => {
    const min = Math.min(...members.map((m) => m.bounds[axis][0])),
      max = Math.max(...members.map((m) => m.bounds[axis][2]));
    // Halves avoid overflowing min + max for otherwise finite bounds.
    return [min, min / 2 + max / 2, max];
  });
  return { supported: true, members, bounds };
}

export function alignArtworkSelection(doc, layerIds, action, options = {}) {
  const alignment = artworkAlignments.find(([id]) => id === action);
  if (!alignment) throw Error('Choose one of the six artwork alignments.');
  // Fresh resolution, no persistent bounds/target cache or active-node geometry.
  const resolved = resolveArtworkAlignment(doc, layerIds, options);
  if (!resolved.supported) throw Error(resolved.reason);
  const [, , axis, edge] = alignment;
  // Text evaluation serializes its actual outline with toPathData(5) in core.
  // A translated glyph can move either edge by half a 1e-5 coordinate step.
  // Use that existing rendering precision only to detect an already-aligned set;
  // the first translation still uses the measured bounds without rounding.
  const precision = artworkBoundsPrecision(resolved.members);
  const edges = resolved.members.map(({ bounds }) => bounds[axis][edge]);
  if (Math.max(...edges) - Math.min(...edges) <= precision) return false;
  const moves = resolved.members.map(({ target, bounds }) => {
    const distance = resolved.bounds[axis][edge] - bounds[axis][edge];
    // Paper bounds can differ by sub-nanounit roundoff after a translation.
    const delta = [0, 0];
    delta[axis] = Math.abs(distance) <= 1e-9 ? 0 : distance;
    return { target, delta };
  });
  if (moves.every(({ delta }) => delta.every((v) => v === 0))) return false;
  // Validate the complete candidate, including stored value contracts, before
  // touching authored state. No member can be left behind on a late failure.
  const candidate = cloneDocument(doc);
  translateArtworkMoves(candidate, moves);
  try {
    validate(candidate);
    const next = resolveArtworkAlignment(candidate, layerIds, options);
    if (!next.supported) throw Error(next.reason);
  } catch (error) {
    throw Error(`${error.message} No selected artwork aligned.`);
  }
  translateArtworkMoves(doc, moves);
  return true;
}
