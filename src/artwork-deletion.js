import { blankLayer } from './core.js';

/**
 * Remove exactly one composition and its complete graph. This model-only helper
 * never evaluates artwork or collects assets. Callers own selection and history.
 * The neighbor is the next layer in document order, otherwise the previous one.
 */
export function removeArtworkLayer(doc, layerId) {
  if (!doc || !Array.isArray(doc.layers) || doc.layers.length < 1 || doc.layers.length > 100)
    throw Error('Invalid artwork document');
  if (typeof layerId !== 'string' || !layerId) throw Error('Choose an existing layer to delete');
  const matches = doc.layers.filter((layer) => layer.id === layerId);
  if (matches.length !== 1) throw Error('Layer is unavailable; select it again');
  const target = matches[0],
    index = doc.layers.indexOf(target);
  if (target.locked) throw Error('Composition is locked');

  const replacement = doc.layers.length === 1 ? blankLayer() : null,
    nextLayerId = replacement?.id || doc.layers[index + 1]?.id || doc.layers[index - 1].id;
  doc.layers.splice(index, 1, ...(replacement ? [replacement] : []));
  return { removedLayerId: layerId, nextLayerId, replacedLastLayer: !!replacement };
}
