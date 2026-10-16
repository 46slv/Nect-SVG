import { characterPositionStatus, uid, validate } from './core.js';
import { candidateDocument } from './artwork-candidate.js';
import { resolveArtworkMoveTarget } from './artwork-move-target.js';

const unsupported = (code, reason) => ({ supported: false, code, reason });
function hasExternalSource(value, nodeIds) {
  if (!value || typeof value !== 'object') return false;
  if (value.source !== undefined && !nodeIds.has(value.source)) return true;
  return Object.values(value).some((child) => hasExternalSource(child, nodeIds));
}

/**
 * Whole-layer eligibility is deliberately narrower than artwork movement:
 * every node must belong to its complete supported route. An optional already
 * resolved move is for the current synchronous UI render only; staging always
 * resolves afresh. No document, asset record or evaluation cache is mutated.
 */
export function resolveArtworkDuplicateTarget(doc, layerId, options = {}, movement) {
  try {
    if (!doc || !Array.isArray(doc.layers) || doc.layers.length < 1)
      return unsupported('invalid-document', 'Choose artwork in a valid document.');
    if (doc.layers.length >= 100)
      return unsupported('layer-limit', 'Duplicate in place requires fewer than 100 layers.');
    if (doc.schemaVersion === 1)
      return unsupported(
        'legacy-document',
        'Upgrade the legacy project before duplicating artwork.',
      );
    const move = movement || resolveArtworkMoveTarget(doc, layerId, options);
    if (!move.supported)
      return unsupported(
        move.code,
        `Duplicate in place uses artwork-move eligibility. ${move.reason}`,
      );
    const layer = doc.layers.find((layer) => layer.id === layerId),
      route = new Set(move.target.route.map(({ nodeId }) => nodeId));
    if (!layer || route.size !== layer.nodes.length || layer.nodes.some((n) => !route.has(n.id)))
      return unsupported(
        'extra-nodes',
        'Duplicate in place initially requires a complete supported route with no disconnected or extra nodes.',
      );
    if (hasExternalSource(layer, route))
      return unsupported(
        'external-source',
        'An artwork source points outside the supported copy route.',
      );
    for (const n of layer.nodes) {
      if (
        !Array.isArray(n.points) ||
        !Array.isArray(n.edits) ||
        n.edits.length ||
        (n.type !== 'Curve' && n.points.length) ||
        n.reference ||
        n.pathAttachment
      )
        return unsupported(
          'unsupported-records',
          'This artwork contains unsupported graph records.',
        );
      if (n.type === 'Text' && characterPositionStatus(n.text, n.characterPositions).suspended)
        return unsupported(
          'suspended-characters',
          'Restore or reset suspended character adjustments before duplicating artwork.',
        );
    }
    return { supported: true, target: move.target };
  } catch (error) {
    return unsupported('invalid-artwork', error.message || 'The artwork is unavailable.');
  }
}

/**
 * Pure staging: deep-copy the complete layer, remap graph/Curve IDs, and validate
 * an asset-safe isolated candidate before returning anything commit-ready.
 * Text-local character IDs intentionally stay local; their records are deep copies.
 * Immutable font/image assets remain referenced by their existing IDs and bytes.
 */
export function stageArtworkDuplicate(doc, layerId, { fonts = {}, imageAssets } = {}) {
  const eligibility = resolveArtworkDuplicateTarget(doc, layerId, { fonts, imageAssets });
  if (!eligibility.supported) throw Error(eligibility.reason);
  const source = doc.layers.find((layer) => layer.id === layerId),
    index = doc.layers.indexOf(source) + 1,
    layer = copyArtwork(source, occupiedArtworkIds(doc));
  const candidate = candidateDocument(doc);
  // Validation may normalize legacy records. Keep it on a separate clone so the
  // committed copy retains every authored parameter and graph layout exactly.
  candidate.layers.splice(index, 0, structuredClone(layer));
  validate(candidate);
  return { layer, index, layerId: layer.id, outputNodeId: layer.output };
}

function occupiedArtworkIds(doc) {
  const occupied = new Set();
  for (const guide of doc.editor?.guides || []) occupied.add(guide.id);
  for (const l of doc.layers) {
    occupied.add(l.id);
    for (const n of l.nodes) {
      occupied.add(n.id);
      for (const pt of n.points) occupied.add(pt.id);
    }
  }
  return occupied;
}

function copyArtwork(source, occupied) {
  const layer = structuredClone(source),
    ids = new Map();
  function fresh(old, prefix) {
    const id = uid(prefix);
    if (occupied.has(id) || ids.has(old)) throw Error('Duplicate artwork ID collision');
    occupied.add(id);
    ids.set(old, id);
    return id;
  }
  layer.id = fresh(source.id, 'layer');
  for (const n of layer.nodes) {
    n.id = fresh(n.id, 'node');
    for (const pt of n.points) pt.id = fresh(pt.id, 'pt');
  }
  layer.output = ids.get(source.output);
  layer.name = `${source.name} copy`;
  const nodeIds = new Set(source.nodes.map((n) => n.id));
  function remapSources(value) {
    if (!value || typeof value !== 'object') return;
    if (value.source !== undefined) {
      if (!nodeIds.has(value.source)) throw Error('Artwork source points outside the copy');
      value.source = ids.get(value.source);
    }
    for (const child of Object.values(value)) remapSources(child);
  }
  remapSources(layer);
  return layer;
}

/** Resolve every member afresh; one unsupported artwork refuses the entire set. */
export function resolveArtworkDuplicateSelection(doc, layerIds, options = {}) {
  try {
    const ids = [...layerIds];
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
      return unsupported('invalid-selection', 'Choose a nonempty set of unique artwork layers.');
    if (!Array.isArray(doc?.layers))
      return unsupported('invalid-document', 'Choose artwork in a valid document.');
    if (doc.layers.length + ids.length > 100)
      return unsupported(
        'layer-limit',
        `Duplicating ${ids.length} artwork layers would exceed 100 layers. No selected artwork duplicated.`,
      );
    for (const id of ids) {
      const resolved = resolveArtworkDuplicateTarget(doc, id, options);
      if (!resolved.supported) {
        const name = doc.layers.find((l) => l.id === id)?.name || id;
        return unsupported(
          resolved.code,
          `${name}: ${resolved.reason} No selected artwork duplicated.`,
        );
      }
    }
    const selected = new Set(ids);
    return {
      supported: true,
      layerIds: doc.layers.filter((l) => selected.has(l.id)).map((l) => l.id),
    };
  } catch (error) {
    return unsupported(
      'invalid-selection',
      error.message || 'The artwork selection is unavailable.',
    );
  }
}

/**
 * Each copy sits immediately above its own source, matching single duplication.
 * Source and copy relative paint order is stable, independent of click order.
 * All copies share one occupied-ID set and one isolated candidate validation.
 */
export function stageArtworkDuplicates(doc, layerIds, options) {
  const eligibility = resolveArtworkDuplicateSelection(doc, layerIds, options);
  if (!eligibility.supported) throw Error(eligibility.reason);
  const occupied = occupiedArtworkIds(doc),
    selected = new Set(eligibility.layerIds),
    copies = [];
  doc.layers.forEach((source, index) => {
    if (!selected.has(source.id)) return;
    const layer = copyArtwork(source, occupied);
    copies.push({
      sourceLayerId: source.id,
      layer,
      index: index + 1 + copies.length,
      layerId: layer.id,
      outputNodeId: layer.output,
    });
  });
  const candidate = candidateDocument(doc);
  for (const copy of copies) candidate.layers.splice(copy.index, 0, structuredClone(copy.layer));
  validate(candidate);
  return copies;
}

/** Caller owns a single History transaction and selection snapshot. */
export function duplicateArtworkLayers(doc, layerIds, options) {
  const copies = stageArtworkDuplicates(doc, layerIds, options);
  for (const copy of copies) doc.layers.splice(copy.index, 0, copy.layer);
  return copies.map(({ sourceLayerId, layerId, outputNodeId }) => ({
    sourceLayerId,
    layerId,
    outputNodeId,
  }));
}

/** Caller owns the one History transaction and final-artwork selection. */
export function duplicateArtworkLayer(doc, layerId, options) {
  const staged = stageArtworkDuplicate(doc, layerId, options);
  doc.layers.splice(staged.index, 0, staged.layer);
  return { layerId: staged.layerId, outputNodeId: staged.outputNodeId };
}
