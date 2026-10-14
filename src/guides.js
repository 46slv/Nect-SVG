// Editing aids are document state, but never geometry or SVG output.
export const guideDefaults = () => ({
  guides: [],
  visible: true,
  locked: false,
  gridVisible: false,
  gridSize: 8,
  snap: false,
  snapGuides: true,
  snapArtboard: true,
  snapGrid: true,
});
export const guideSettings = (doc) => doc.editor || guideDefaults();
export function validateGuides(editor, validateId) {
  if (editor === undefined) return;
  if (!editor || typeof editor !== 'object' || Array.isArray(editor))
    throw Error('Invalid editor settings');
  for (const key of [
    'visible',
    'locked',
    'gridVisible',
    'snap',
    'snapGuides',
    'snapArtboard',
    'snapGrid',
  ])
    if (typeof editor[key] !== 'boolean') throw Error('Invalid guide setting');
  if (!Number.isFinite(editor.gridSize) || editor.gridSize < 1 || editor.gridSize > 10000)
    throw Error('Grid spacing must be between 1 and 10000');
  if (!Array.isArray(editor.guides) || editor.guides.length > 200)
    throw Error('Too many guides (maximum 200)');
  for (const guide of editor.guides) {
    validateId(guide.id);
    if (
      !['x', 'y'].includes(guide.axis) ||
      !Number.isFinite(guide.position) ||
      Math.abs(guide.position) > 100000 ||
      typeof guide.locked !== 'boolean'
    )
      throw Error('Invalid guide');
  }
}
// Sources are coordinates of the original point or selected generators' bounds.
// Return a single translation per axis so a multi-selection never deforms.
export function snapTranslation(
  doc,
  sources,
  delta,
  scale = 1,
  bypass = false,
  excludedGuide = null,
) {
  const settings = guideSettings(doc),
    matches = [],
    result = [...delta];
  if (!settings.snap || bypass) return { delta: result, matches };
  const threshold = 6 / Math.max(0.0001, Number.isFinite(scale) ? scale : 1);
  for (let axis = 0; axis < 2; axis++) {
    const candidates = [];
    if (settings.snapGuides && settings.visible)
      for (const guide of settings.guides)
        if (guide.axis === (axis ? 'y' : 'x') && guide.id !== excludedGuide)
          candidates.push({ position: guide.position, kind: 'guide' });
    if (settings.snapArtboard)
      for (const position of [
        0,
        doc[axis ? 'height' : 'width'] / 2,
        doc[axis ? 'height' : 'width'],
      ])
        candidates.push({ position, kind: 'artboard' });
    let best = null;
    const consider = (source, candidate) => {
      const correction = candidate.position - (source + delta[axis]);
      if (
        Math.abs(correction) <= threshold &&
        (!best || Math.abs(correction) < Math.abs(best.correction))
      )
        best = { ...candidate, correction, axis };
    };
    for (const source of sources[axis])
      for (const candidate of candidates) consider(source, candidate);
    // Explicit alignment targets win over the background grid within the snap radius.
    if (!best && settings.snapGrid)
      for (const source of sources[axis])
        consider(source, {
          position: Math.round((source + delta[axis]) / settings.gridSize) * settings.gridSize,
          kind: 'grid',
        });
    if (best) {
      result[axis] += best.correction;
      matches.push(best);
    }
  }
  return { delta: result, matches };
}
