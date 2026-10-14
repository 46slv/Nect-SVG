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
  if (editor.layoutGrid !== undefined) validateLayoutGrid(editor.layoutGrid);
  for (const guide of editor.guides) {
    if (guide.origin !== undefined && guide.origin !== 'layout')
      throw Error('Invalid guide origin');
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
  layerBounds = [],
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
    if (settings.snapGuides && settings.visible)
      for (const bounds of layerBounds)
        for (const position of bounds[axis]) candidates.push({ position, kind: 'guide-layer' });
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

export const layoutGridDefaults = () => ({
  columns: 3,
  rows: 3,
  marginX: 40,
  marginY: 40,
  gutterX: 20,
  gutterY: 20,
});
export function validateLayoutGrid(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw Error('Invalid layout grid');
  for (const key of ['columns', 'rows'])
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 40)
      throw Error('Columns and rows must be integers from 1 to 40');
  for (const key of ['marginX', 'marginY', 'gutterX', 'gutterY'])
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100000)
      throw Error('Margins and gutters must be between 0 and 100000');
}
// A single generated set is replaced atomically; manual guides are never removed.
export function layoutGridLines(doc, config) {
  validateLayoutGrid(config);
  const lines = [];
  for (const [axis, size, count, margin, gutter] of [
    ['x', doc.width, config.columns, config.marginX, config.gutterX],
    ['y', doc.height, config.rows, config.marginY, config.gutterY],
  ]) {
    const cell = (size - 2 * margin - (count - 1) * gutter) / count;
    if (!Number.isFinite(cell) || cell <= 0)
      throw Error('Margins and gutters leave no space for cells');
    const positions = new Set();
    for (let i = 0; i < count; i++) {
      positions.add(Number((margin + i * (cell + gutter)).toFixed(6)));
      positions.add(Number((margin + i * (cell + gutter) + cell).toFixed(6)));
    }
    for (const position of positions) lines.push({ axis, position });
  }
  return lines;
}
export function setLayoutGrid(doc, config, makeId) {
  const a = doc.editor || guideDefaults();
  if (a.locked || a.guides.some((g) => g.origin === 'layout' && g.locked))
    throw Error('Unlock layout guides before replacing or removing them');
  const manual = a.guides.filter((g) => g.origin !== 'layout');
  const lines = config ? layoutGridLines(doc, config) : [];
  if (manual.length + lines.length > 200)
    throw Error('Maximum 200 guides; remove some guides or reduce the layout');
  const generated = lines.map((g) => ({ ...g, id: makeId(), locked: false, origin: 'layout' }));
  doc.editor = a;
  a.guides = [...manual, ...generated];
  if (config) a.layoutGrid = { ...config };
  else delete a.layoutGrid;
}
