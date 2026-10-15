import { definitions, evaluate, outputType, pathBounds, socketCompatible } from './core.js';

const shapes = new Set(['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star']);
const gradients = new Set(['Linear Gradient Fill', 'Radial Gradient Fill']);
const finitePoint = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const unsupported = (code, reason) => ({ supported: false, code, reason });

/**
 * Resolve a final artwork layer, never the currently selected graph node.
 *
 * Deliberately bounded to generator -> Fill -> Output, optionally with ONE
 * existing Transform immediately before Fill, or Image -> Image Output.
 * All non-path inputs in that capsule must be literal, so no reference/data
 * branch can turn a translation into a simultaneous size, pivot or paint edit.
 * Disconnected nodes do not choose the target and are never modified.
 *
 * Hidden, guide and locked layers, bypassed route nodes, attached Text, gradients,
 * other paint stacks and arbitrary geometry graphs are selection-only here.
 * Parameter locks protect the edited parameter; unchanged parameters may be locked.
 *
 * Success describes adding an ARTBOARD-SPACE XY delta to one Vector2 value.
 * Transform offset is applied AFTER scale/rotation by core, including negative
 * scale. No inverse matrix or source-stage movement is involved. Zero scale /
 * other empty outputs are refused. This does not insert nodes, apply a delta,
 * update selection or own History. Callers must re-resolve before committing.
 * Pass the same loaded fonts/image assets used to render the final artwork.
 */
export function resolveArtworkMoveTarget(doc, layerId, { fonts = {}, imageAssets } = {}) {
  if (!doc || !Array.isArray(doc.layers) || typeof layerId !== 'string')
    return unsupported('invalid-artwork', 'Choose an artwork layer by its stable ID.');
  const matches = doc.layers.filter((layer) => layer?.id === layerId);
  if (matches.length !== 1)
    return unsupported('missing-artwork', 'The artwork layer is missing or its ID is ambiguous.');
  const layer = matches[0];
  if (layer.locked !== false)
    return unsupported('locked-artwork', 'Unlock the artwork layer before moving it.');
  if (layer.visible !== true || layer.guide)
    return unsupported('hidden-artwork', 'Only visible, non-guide artwork can be moved.');
  if (!Array.isArray(layer.nodes) || layer.nodes.length > 2000)
    return unsupported('invalid-graph', 'The artwork graph is unavailable.');
  const byId = new Map();
  for (const n of layer.nodes) {
    if (!n || typeof n.id !== 'string' || byId.has(n.id))
      return unsupported('invalid-graph', 'Artwork node IDs must be present and unique.');
    byId.set(n.id, n);
  }
  const output = byId.get(layer.output);
  if (!output || !['Output', 'Image Output'].includes(output.type))
    return unsupported('missing-output', 'The final artwork Output is unavailable.');

  // Follow named, typed sockets only. This is not a first-input graph walk.
  function pathSource(n, type) {
    const q = n.params?.path;
    if (
      !q ||
      q.type !== type ||
      q.value !== null ||
      typeof q.source !== 'string' ||
      q.sourcePort !== undefined ||
      q.expression !== ''
    )
      return null;
    const source = byId.get(q.source);
    return source && socketCompatible(outputType(source), type) ? source : null;
  }
  const last = pathSource(output, output.type === 'Output' ? 'PaintedPath' : 'Image');
  if (!last)
    return unsupported('missing-source', 'Connect a supported source to the final Output.');
  if (gradients.has(last.type))
    return unsupported(
      'artboard-gradient',
      'Whole-artwork movement through an artboard-space gradient is not supported.',
    );

  let generator, transform, target, parameter, kind, route;
  if (output.type === 'Image Output') {
    if (last.type !== 'Image')
      return unsupported('unsupported-graph', 'Only a direct Image to Image Output is supported.');
    generator = target = last;
    parameter = 'position';
    kind = 'image-position';
    route = [generator, output];
  } else {
    if (last.type !== 'Fill')
      return unsupported(
        'unsupported-graph',
        'Only a single solid Fill before Output is supported.',
      );
    generator = pathSource(last, 'PaintedPath');
    if (!generator)
      return unsupported('missing-source', 'The solid Fill needs a supported geometry source.');
    if (gradients.has(generator.type))
      return unsupported(
        'artboard-gradient',
        'Whole-artwork movement through an artboard-space gradient is not supported.',
      );
    if (generator.type === 'Transform') {
      transform = generator;
      generator = pathSource(transform, 'Path');
    }
    if (!generator || (!shapes.has(generator.type) && generator.type !== 'Text'))
      return unsupported(
        'unsupported-graph',
        'Move is supported only for a direct shape or unattached Text, optionally through one terminal Transform.',
      );
    if (generator.type === 'Text' && generator.pathAttachment != null)
      return unsupported('attached-text', 'Detach Type on Path before using this artwork move.');
    target = transform || generator;
    parameter = transform ? 'offset' : generator.type === 'Text' ? 'position' : 'center';
    kind = transform
      ? 'terminal-transform-offset'
      : generator.type === 'Text'
        ? 'text-position'
        : 'shape-center';
    route = transform ? [generator, transform, last, output] : [generator, last, output];
  }

  for (const n of route) {
    if (n.locked === true)
      return unsupported('locked-node', 'A node in the artwork route is locked.');
    if (n.bypassed !== undefined && typeof n.bypassed !== 'boolean')
      return unsupported('invalid-bypass', 'The artwork has an invalid bypass state.');
    if (n.bypassed)
      return unsupported(
        'bypassed-route',
        'Restore bypassed artwork nodes before moving the artwork.',
      );
  }
  const q = target.params?.[parameter];
  if (!q || q.type !== 'Vector2' || !finitePoint(q.value))
    return unsupported('invalid-position', 'The artwork position must be a finite Vector2.');
  if (q.locked !== false)
    return unsupported('locked-position', 'The artwork move parameter is locked.');
  if (q.source !== undefined || q.sourcePort !== undefined)
    return unsupported('driven-position', 'The artwork move parameter is connected to a source.');
  if (q.expression !== '')
    return unsupported('expression-position', 'The artwork move parameter has an expression.');

  // This exact slice deliberately refuses ALL output-affecting non-path
  // connections, including Reference -> Separate/Math -> a size/pivot/paint
  // input. Do not assume a reference is harmless because it is off the main
  // path. Disconnected references cannot affect this final Output.
  for (const n of route) {
    const expected = definitions[n.type];
    if (
      !n.params ||
      Object.keys(n.params).some((key) => !Object.hasOwn(expected, key)) ||
      Object.keys(expected).some((key) => !n.params[key])
    )
      return unsupported('invalid-parameters', 'The artwork capsule has unexpected parameters.');
    for (const [key, input] of Object.entries(n.params)) {
      if (!input || input.type !== expected[key].type || typeof input.locked !== 'boolean')
        return unsupported(
          'invalid-parameters',
          'The artwork capsule has invalid parameter types.',
        );
      if (key === 'path') continue;
      if (input.source !== undefined || input.sourcePort !== undefined)
        return unsupported(
          'side-dependency',
          'Output-affecting non-path connections or references are outside this safe move capsule.',
        );
      if (typeof input.expression !== 'string')
        return unsupported('invalid-parameters', 'The artwork capsule has an invalid expression.');
    }
  }

  // Core evaluation diagnoses unavailable fonts/assets, invalid dimensions,
  // invalid expressions and stored bypass/type errors. Work on an isolated
  // clone so neither document state nor its evaluation cache is touched.
  let value, bounds;
  try {
    const result = evaluate(structuredClone(layer), fonts, imageAssets ?? doc.imageAssets ?? {});
    if (result.error) return unsupported('unavailable-output', result.error);
    value = result.path;
    if (!value || (value.kind !== 'image' && !value.contours?.some((c) => c.points.length)))
      return unsupported('empty-output', 'The final artwork has no movable geometry.');
    bounds = pathBounds(value);
    if (!bounds.flat().every(Number.isFinite))
      return unsupported('invalid-output', 'The final artwork bounds are not finite.');
    if (bounds.some(([min, , max]) => max <= min))
      return unsupported('empty-output', 'The final artwork has no nonzero area.');
    if (value.kind !== 'image' && (!value.fill || value.fill.alpha <= 0))
      return unsupported('empty-output', 'The final artwork has no visible solid Fill.');
  } catch (error) {
    return unsupported('unavailable-output', error.message || 'The final artwork is unavailable.');
  }

  return {
    supported: true,
    target: {
      scope: 'artwork',
      kind,
      layerId,
      outputNodeId: output.id,
      nodeId: target.id,
      parameter,
      parameterType: 'Vector2',
      parameterPath: ['params', parameter, 'value'],
      coordinateSpace: 'artboard',
      value: [...q.value],
      route: route.map((n) => ({ nodeId: n.id, type: n.type })),
    },
  };
}
