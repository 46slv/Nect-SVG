import { connect, node, point, uid, validate, blankLayer } from './core.js';

import { candidateDocument } from './artwork-candidate.js';
export {
  resolveArtworkDuplicateTarget,
  duplicateArtworkLayer,
  resolveArtworkDuplicateSelection,
  duplicateArtworkLayers,
} from './artwork-duplication.js';

export const ARTWORK_TYPES = Object.freeze([
  'Circle',
  'Ellipse',
  'Rectangle',
  'Polygon',
  'Star',
  'Text',
]);

/**
 * Append independent artwork, without replacing any existing graph output.
 * `at` is an explicit artboard-space center (shapes) or Position (Text).
 * Callers own selection and wrap one call in one History.apply transaction.
 */
export function appendArtwork(doc, type, { at, name = type } = {}) {
  if (!ARTWORK_TYPES.includes(type)) throw Error('Unsupported artwork type');
  if (!Array.isArray(at) || at.length !== 2 || !Number.isFinite(at[0]) || !Number.isFinite(at[1]))
    throw Error('Artwork position must be an explicit finite artboard point');
  if (typeof name !== 'string' || name.length > 100000) throw Error('Invalid artwork name');
  assertArtworkDocument(doc);

  const candidate = candidateDocument(doc),
    generator = node(type, 40, 50),
    artwork = artworkLayer(generator, name);
  generator.params[type === 'Text' ? 'position' : 'center'].value = [...at];
  candidate.layers.push(artwork);
  validate(candidate);

  // Preserve existing objects and any legacy fields normalized on the candidate.
  doc.layers.push(artwork);
  return { layerId: artwork.id, nodeId: generator.id };
}

function assertArtworkDocument(doc) {
  if (!doc || !Array.isArray(doc.layers) || doc.layers.length < 1)
    throw Error('Invalid artwork document');
  if (doc.layers.length >= 100) throw Error('Artwork requires fewer than 100 existing layers');
  // Validation migrates version 1 in place. Creation must never silently upgrade
  // the existing document; its normal open/import path owns that migration.
  if (doc.schemaVersion === 1) throw Error('Upgrade schemaVersion 1 before creating artwork');
}

function artworkLayer(generator, name) {
  const fill = node('Fill', 350, 50),
    output = node('Output', 660, 50),
    artwork = {
      id: uid('layer'),
      name,
      visible: true,
      locked: false,
      fill: '#36434e',
      nodes: [generator, fill, output],
      output: output.id,
    };
  connect(artwork, generator.id, fill.id, 'path');
  connect(artwork, fill.id, output.id, 'path');
  return artwork;
}

/** Detached preview: it is never part of document persistence or history. */
export function createPenArtworkDraft(doc, at) {
  assertArtworkDocument(doc);
  if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite))
    throw Error('Pen position must be an explicit finite artboard point');
  const curve = node('Curve', 40, 50);
  curve.points = [point(...at)];
  curve.params.closed.value = false;
  const artwork = artworkLayer(curve, 'Curve'),
    candidate = candidateDocument(doc);
  candidate.layers.push(artwork);
  validate(candidate);
  return artwork;
}

/** One caller-owned History.apply commits a finished, detached Pen path. */
export function appendPenArtwork(doc, draft) {
  assertArtworkDocument(doc);
  const artwork = structuredClone(draft),
    curve = artwork?.nodes?.[0];
  if (curve?.type !== 'Curve' || curve.points.length < 2)
    throw Error('A finished Pen path needs at least two points');
  const candidate = candidateDocument(doc);
  candidate.layers.push(artwork);
  validate(candidate);
  doc.layers.push(artwork);
  return { layerId: artwork.id, nodeId: curve.id };
}

/** Append an intentional blank composition with candidate-only validation. */
export function appendBlankComposition(doc, { name } = {}) {
  assertArtworkDocument(doc);
  if (name === undefined) name = `Composition ${doc.layers.length + 1}`;
  if (typeof name !== 'string' || name.length > 100000) throw Error('Invalid composition name');
  const artwork = blankLayer(name),
    candidate = candidateDocument(doc);
  candidate.layers.push(artwork);
  validate(candidate);
  doc.layers.push(artwork);
  return { layerId: artwork.id, nodeId: artwork.output };
}
