import { prepareImage, preflightImages, pngDimensions, rasterizeSVG } from './raster.js';
import { validateImageAssets } from './images.js';
import { captureFocus, restoreFocus } from './focus.js';
import './style.css';
import {
  appendArtwork,
  createPenArtworkDraft,
  appendPenArtwork,
  appendBlankComposition,
  resolveArtworkDuplicateTarget,
  duplicateArtworkLayer,
  resolveArtworkDuplicateSelection,
  duplicateArtworkLayers,
} from './artwork-creation.js';
import { resolveArtworkMoveTarget } from './artwork-move-target.js';
import { resolveArtworkMoveSelection, translateArtworkTargets } from './artwork-multi-move.js';
import { artworkAlignments, alignArtworkSelection } from './artwork-alignment.js';
import { artworkDistributions, distributeArtworkSelection } from './artwork-distribution.js';
import { artworkGapDistributions, distributeArtworkGaps } from './artwork-gap-distribution.js';
import { removeArtworkLayer } from './artwork-deletion.js';
import { moveArtworkLayer, resolveArtworkOrderTarget } from './artwork-ordering.js';
import {
  findFreeNodePosition,
  fitScale,
  unionBounds,
  anchoredPan,
  anchoredScroll,
  wheelPixels,
} from './layout.js';
import { importSVG } from './svg-import.js';
import { desktop, saveFile, openFile, listSystemFonts, readSystemFont } from './storage.js';
import {
  parseFont,
  makeFontAsset,
  resolveFonts,
  MAX_FONT_BYTES,
  MAX_PROJECT_BYTES,
} from './fonts.js';
import {
  document as newDocument,
  blankDocument,
  hasEmptyOutput,
  layer,
  node,
  point,
  uid,
  clone,
  cloneDocument,
  sameDocument,
  definitions,
  parameters,
  activeParameters,
  operationOptions,
  setOperation,
  bypassContract,
  setNodeBypassed,
  parseStrokeDash,
  validateStrokeStyle,
  radialSettings,
  linearGradientSettings,
  radialGradientSettings,
  closedOffsetSettings,
  assertClosedOffsetChange,
  setTextPathAttachment,
  setTextWrap,
  textPathTargets,
  parameter,
  outputType,
  outputPorts,
  vectorReferenceTargets,
  referenceTarget,
  setReference,
  duplicateNodes,
  socketCompatible,
  evaluate,
  enableRemapPoint,
  rebindRemapPoint,
  translateRemapPoints,
  pathData,
  signature,
  connect,
  disconnect,
  serialize,
  validate,
  deserialize,
  exportSVG,
  renderElement,
  History,
  constrainAxisDrag,
  scrubNumericValues,
  guideDefaults,
  guideSettings,
  snapTranslation,
  collectSnapLayerBounds,
  pathBounds,
  layoutGridDefaults,
  layoutGridLines,
  setLayoutGrid,
  characterOccurrences,
  inverseCharacterDelta,
  characterBoxPoints,
  hitCharacter,
  setCharacterOffsets,
  setCharacterStyles,
  setCharacterKerningPairs,
  characterPairFromIds,
  characterPairInRange,
  CHARACTER_STYLE_KEYS,
  characterIdsInRange,
  createCharacterPositions,
  resetCharacterOffsets,
  setCharacterTransforms,
  resetCharacterTransforms,
  resetCharacterAdjustments,
  reconcileCharacterEdit,
  objectResizeHandles,
  resizedObjectValue,
  transformHandleGeometry,
  scaleFromHandle,
  rotationHandleAngle,
  rotationHandleDelta,
  rotationFromHandle,
} from './core.js';
const app = document.querySelector('#app');
let history = new History(newDocument()),
  activeLayer = history.doc.layers[0].id,
  selected = history.doc.layers[0].nodes[0].id,
  artworkTarget = null,
  artworkSelection = new Set(),
  tool = 'select',
  zoom = 1,
  canvasFit = true,
  composing = false,
  selectedGuide = null,
  guidesOpen = false,
  layoutDraft = null,
  layoutPreview = false,
  snapMatches = [],
  pan = [0, 0],
  graphHeight = 42,
  graphZoom = 1,
  message = 'Ready • edit a generator or connect a node',
  error = false,
  fonts = {},
  bundledFont = null,
  fontRequest = null,
  fontRequestId = 0,
  systemFonts = [],
  systemFontStatus = desktop ? 'Reading Windows fonts…' : '',
  wiring = null,
  drag = null,
  penId = null,
  penDraft = null;
let savedSnapshot = serialize(history.doc),
  saveInFlight = false,
  openRequest = 0,
  imageRequest = 0,
  imagePick = null,
  pngScale = 1,
  exportInFlight = false;
let selection = new Set([selected]);
const detailsState = new Map();
const selectionHistory = new WeakMap();
function selectionSnapshot(withEditSelection = false) {
  return {
    activeLayer,
    selected,
    artworkTarget,
    artworkSelection: new Set(artworkSelection),
    selection: new Set(selection),
    ...(withEditSelection
      ? {
          restoreEditSelection: true,
          characterEdit: characterEdit ? structuredClone(characterEdit) : null,
          selectedGuide,
          remapBatches: structuredClone(remapBatches),
        }
      : {}),
  };
}
function stepHistory(redo = false) {
  const priorUI = selectionSnapshot(selectionHistory.get(history.doc)?.restoreEditSelection);
  resetTransient();
  selectionHistory.set(history.doc, priorUI);
  redo ? history.redo() : history.undo();
  const state = selectionHistory.get(history.doc);
  if (state) {
    ({ activeLayer, selected, artworkTarget } = state);
    artworkSelection = new Set(state.artworkSelection);
    selection = new Set(state.selection);
    characterEdit = state.characterEdit ? structuredClone(state.characterEdit) : null;
    if (state.restoreEditSelection) {
      selectedGuide = state.selectedGuide;
      for (const [id, batch] of structuredClone(state.remapBatches)) remapBatches.set(id, batch);
    }
  }
}
const remapBatches = new Map();
let characterEdit = null;
let nameEdit = null,
  lastNameClick = null;
const textDrafts = new Map();
const textRanges = new Map();
const textRangeKey = (el) => `${el.dataset.text}:${el.closest('.node') ? 'node' : 'inspector'}`;
function remapBatch(id) {
  if (!remapBatches.has(id)) remapBatches.set(id, { selected: new Set(), delta: [0, 0] });
  return remapBatches.get(id);
}
let renderEvaluation = null;
let snapLayerBounds = { guides: [], artwork: [] };
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const current = () =>
  penDraft?.layer || history.doc.layers.find((l) => l.id === activeLayer) || history.doc.layers[0];
const canvasLayers = () =>
  penDraft ? [...history.doc.layers, penDraft.layer] : history.doc.layers;
const selectedNode = () =>
  artworkTarget ? undefined : current().nodes.find((n) => n.id === selected);
function selectArtwork(layerId, { toggle = false, preserve = false } = {}) {
  if (!artworkTarget) artworkSelection = new Set();
  if (toggle) {
    if (artworkSelection.has(layerId)) artworkSelection.delete(layerId);
    else artworkSelection.add(layerId);
  } else if (!preserve || !artworkSelection.has(layerId)) artworkSelection = new Set([layerId]);
  activeLayer = artworkSelection.has(layerId) ? layerId : [...artworkSelection].at(-1) || layerId;
  artworkTarget = artworkSelection.size ? activeLayer : null;
  // Retain the established empty-composition UI for a plain single selection.
  if (!toggle && artworkSelection.size === 1 && hasEmptyOutput(current())) {
    artworkTarget = null;
    artworkSelection = new Set();
  }
  selected = null;
  selection = new Set();
  characterEdit = null;
  selectedGuide = null;
}
function artworkMove() {
  return artworkSelection.size === 1
    ? resolveArtworkMoveTarget(history.doc, artworkTarget, { fonts })
    : resolveArtworkMoveSelection(history.doc, artworkSelection, { fonts });
}
function sameArtworkMove(target, expected) {
  if (expected.scope === 'artwork-selection')
    return (
      target?.scope === expected.scope &&
      target.targets.length === expected.targets.length &&
      target.targets.every((t, i) => sameArtworkMove(t, expected.targets[i]))
    );
  return (
    target?.layerId === expected.layerId &&
    target?.kind === expected.kind &&
    target?.nodeId === expected.nodeId &&
    target?.parameter === expected.parameter &&
    target?.outputNodeId === expected.outputNodeId &&
    (target.kind !== 'curve-point-positions' ||
      (JSON.stringify(target.pointIds) === JSON.stringify(expected.pointIds) &&
        JSON.stringify(target.closed) === JSON.stringify(expected.closed))) &&
    JSON.stringify(target.route) === JSON.stringify(expected.route)
  );
}
function writeArtworkMove(target, delta) {
  translateArtworkTargets(history.doc, target, delta);
}
function artworkAlignmentControls(move) {
  const eligible = artworkSelection.size > 1 && move.supported;
  const reason = artworkSelection.size < 2 ? 'Select at least two artwork layers.' : move.reason;
  return `<section class="artwork-alignment" aria-label="Align artwork"><h4>Align artwork</h4><p class="artwork-align-status">${esc(eligible ? 'To selection bounds · final artwork in artboard axes.' : reason)}</p><div class="artwork-align-controls">${artworkAlignments.map(([id, label]) => `<button data-align-artwork="${id}" data-align-selection="${esc(JSON.stringify([...artworkSelection]))}" data-align-active="${esc(activeLayer)}" data-eligible="${eligible}" ${!eligible || alignmentBusy() ? 'disabled' : ''} aria-label="Align artwork ${label.toLowerCase()}" title="${esc(eligible ? `Align ${label.toLowerCase()} to selection bounds (one Undo)` : reason)}">${esc(label)}</button>`).join('')}</div></section>`;
}
function artworkDistributionControls(move) {
  const eligible = artworkSelection.size >= 3 && move.supported;
  const reason = artworkSelection.size < 3 ? 'Select at least three artwork layers.' : move.reason;
  return `<section class="artwork-distribution" aria-label="中心を等間隔"><h4>中心を等間隔</h4><p class="artwork-distribute-status">${esc(eligible ? '描画結果の中心を使用・両端固定' : reason)}</p><div class="artwork-distribute-controls">${artworkDistributions.map(([id, label]) => `<button data-distribute-artwork="${id}" data-distribute-selection="${esc(JSON.stringify([...artworkSelection]))}" data-distribute-active="${esc(activeLayer)}" data-eligible="${eligible}" ${!eligible || alignmentBusy() ? 'disabled' : ''} aria-label="中心を等間隔 ${label}" title="${esc(eligible ? `${label}の中心を等間隔に配置（両端固定・1回のUndo）` : reason)}">${esc(label)}</button>`).join('')}</div></section>`;
}
function artworkGapControls(move) {
  const eligible = artworkSelection.size >= 3 && move.supported;
  const reason = artworkSelection.size < 3 ? 'Select at least three artwork layers.' : move.reason;
  return `<section class="artwork-gap-distribution" aria-label="隙間を等間隔"><h4>隙間を等間隔</h4><p class="artwork-gap-status">${esc(eligible ? '描画結果の端を使用・外側両端固定' : reason)}</p><div class="artwork-distribute-controls">${artworkGapDistributions.map(([id, label]) => `<button data-distribute-gap="${id}" data-distribute-selection="${esc(JSON.stringify([...artworkSelection]))}" data-distribute-active="${esc(activeLayer)}" data-eligible="${eligible}" ${!eligible || alignmentBusy() ? 'disabled' : ''} aria-label="隙間を等間隔 ${label}" title="${esc(eligible ? `${label}の隙間を等間隔に配置（外側両端固定・1回のUndo）` : reason)}">${esc(label)}</button>`).join('')}</div></section>`;
}
function notify(text, bad = false) {
  message = text;
  error = bad;
  let s = document.querySelector('.status');
  if (s) {
    s.classList.toggle('error', bad);
    s.querySelector('.message').textContent = text;
  }
}
let pendingRender = null,
  needsRender = false,
  pointerActive = false;
document.addEventListener(
  'pointerdown',
  (event) => {
    pointerActive = true;
    const title = event.target.closest?.('[data-rename-node], [data-select-layer]');
    if (
      lastNameClick &&
      (!title ||
        event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        lastNameClick.layerId !== (title.dataset.selectLayer || current().id) ||
        lastNameClick.nodeId !== (title.dataset.renameNode || null))
    )
      lastNameClick = null;
  },
  true,
);
for (const event of ['pointerup', 'pointercancel'])
  document.addEventListener(
    event,
    () => {
      pointerActive = false;
      if (needsRender) scheduleRender();
    },
    true,
  );
function scheduleRender() {
  needsRender = true;
  if (pendingRender === null)
    pendingRender = setTimeout(() => {
      pendingRender = null;
      if (!pointerActive) render();
    }, 0);
}
function change(fn, text, deferRender = false) {
  if (penDraft) {
    notify('Finish or cancel the draft path before editing properties', true);
    return;
  }
  const previousUI = {
    selected,
    activeLayer,
    artworkTarget,
    artworkSelection: new Set(artworkSelection),
    selection: new Set(selection),
    penId,
  };
  try {
    if (current().locked) throw Error('Composition is locked');
    const previous = current().nodes.some(
      (n) => n.type === 'Closed Path Offset' || n.pathAttachment || n.textWrap,
    )
      ? clone(current())
      : null;
    const previousFonts = resolveFonts(history.doc, bundledFont ? { default: bundledFont } : {});
    history.apply((doc) => {
      fn(doc);
      assertClosedOffsetChange(
        current(),
        previous,
        resolveFonts(history.doc, bundledFont ? { default: bundledFont } : {}),
        history.doc.imageAssets,
        previousFonts,
      );
    });
    notify(text || 'Updated');
    if (deferRender) scheduleRender();
    else render();
  } catch (e) {
    ({ selected, activeLayer, artworkTarget, artworkSelection, selection, penId } = previousUI);
    notify(e.message, true);
    if (deferRender) scheduleRender();
    else render();
  }
}
function resetTransient() {
  discardPenDraft();
  composing = false;
  nameEdit = null;
  lastNameClick = null;
  stopGraphDrag();
  imageRequest++;
  imagePick = null;
  layoutDraft = null;
  layoutPreview = false;
  if (drag?.before) history.doc = drag.before;
  selectedGuide = null;
  snapMatches = [];
  remapBatches.clear();
  characterEdit = null;
  textDrafts.clear();
  textRanges.clear();
  closeEditorDialog(document.querySelector('.character-choice'));
  drag = null;
  wiring = null;
  penId = null;
}
// Bounds are shared by rendered controls and pointer scrubbing.
function numericLimits(n, key) {
  if (n.type === 'Radial Gradient Fill') {
    if (key === 'center') return [-100000, 100000];
    if (key === 'radius') return [0.0001, 100000];
  }
  if (n.type === 'Closed Path Offset') {
    if (key === 'miterLimit') return [1, 100];
    if (key === 'amount') return [-100000, 100000];
  }
  if (n.type === 'Stroke') {
    if (key === 'width') return [0, 100000];
    if (key === 'miterLimit') return [1, 10000];
    if (key === 'dashOffset') return [-100000, 100000];
  }
  if (n.type === 'Geometry Repeater' && key === 'count') return [1, 256];
  if (['Polygon', 'Star'].includes(n.type)) {
    if (['sides', 'points'].includes(key)) return [3, 256];
    if (key === 'radius' || key === 'outerRadius')
      return [n.type === 'Star' ? n.params.innerRadius.value : Number.MIN_VALUE, 100000];
    if (key === 'innerRadius') return [Number.MIN_VALUE, n.params.outerRadius.value];
  }
  return [-Number.MAX_VALUE, Number.MAX_VALUE];
}
function numericAttributes(n, key) {
  const [min, max] = numericLimits(n, key);
  return `${min === -Number.MAX_VALUE ? '' : `min="${min}" max="${max}"`} data-scrub-step="${key === 'scale' ? 0.01 : 1}" title="Drag horizontally to adjust; click to type"`;
}
// Character and layout controls are source edits, not graph parameter fields.
// Resolve their real targets explicitly; the floating palette has no .field wrapper.
function textNumericTarget(input) {
  const data = input.dataset;
  if (data.textLeadingValue || data.textWrapWidth)
    return {
      textKind: data.textLeadingValue ? 'leading' : 'wrap',
      nodeId: data.textLeadingValue || data.textWrapWidth,
    };
  const context = characterContext();
  if (!context) return null;
  if (data.characterKerning !== undefined) {
    const pair = pairContext(context);
    return pair && matchesPairInput(input, context, pair)
      ? {
          textKind: 'kerning',
          nodeId: context.n.id,
          ids: pair.ids,
          pairKey: pair.key,
          targetText: context.n.text,
        }
      : null;
  }
  const textKind =
      data.characterAxis !== undefined
        ? 'offset'
        : data.characterTransform
          ? 'transform'
          : data.characterStyle && data.characterStyle !== 'font'
            ? 'style'
            : null,
    rows = textKind === 'style' ? context.typographySelected : context.selected;
  if (
    !textKind ||
    !rows.length ||
    (textKind === 'style' ? context.typographyReason : context.layout.reason)
  )
    return null;
  return {
    textKind,
    nodeId: context.n.id,
    ids: rows.map((g) => g.id),
    key: data.characterTransform || data.characterStyle,
    axis: Number(data.characterAxis || 0),
    factor: ['width', 'height'].includes(data.characterStyle) ? 100 : 1,
  };
}
function textNumericState(d) {
  const n = current().nodes.find((n) => n.id === d.nodeId);
  if (n?.type !== 'Text' || (d.started && n.text !== d.sourceText)) return null;
  if (d.textKind === 'leading')
    return n.leading?.mode === 'manual' ? { n, values: [n.leading.value] } : null;
  if (d.textKind === 'wrap') return n.textWrap ? { n, values: [n.textWrap.width] } : null;
  const context = characterContext(evaluate(current(), fonts, history.doc.imageAssets));
  if (d.textKind === 'kerning') {
    const pair = pairContext(context);
    return context?.n.id === d.nodeId && n.text === d.targetText && pair?.key === d.pairKey
      ? { n, values: [pair.value], manual: pair.manual }
      : null;
  }
  if (
    context?.n.id !== d.nodeId ||
    (d.textKind === 'style' ? context.typographyReason : context.layout.reason) ||
    characterEdit.selected.size !== d.ids.length ||
    !d.ids.every((id) => characterEdit.selected.has(id))
  )
    return null;
  const selectedRows = d.textKind === 'style' ? context.typographySelected : context.selected,
    rows = d.ids.map((id) => selectedRows.find((g) => g.id === id));
  if (rows.some((g) => !g)) return null;
  return {
    n,
    rows,
    values: rows.map((g) => (d.textKind === 'offset' ? g.offset[d.axis] : g[d.key] * d.factor)),
  };
}
function moveTextNumeric(d, event, dx) {
  let state = textNumericState(d);
  if (!state) {
    cancelInteraction();
    return;
  }
  // Commit a pending typed value first, then base the gesture on that exact result.
  if (!d.started && d.capture.value !== d.capture.defaultValue) {
    const text = d.capture.value,
      expected = Number(text);
    d.capture.dispatchEvent(new window.Event('change', { bubbles: true }));
    state = textNumericState(d);
    if (
      !text.trim() ||
      !Number.isFinite(expected) ||
      !state ||
      !state.values.every(
        (value) => Math.abs(value - expected) <= 1e-12 * Math.max(1, Math.abs(expected)),
      )
    ) {
      cancelInteraction();
      return;
    }
  }
  if (!d.started) {
    d.before = cloneDocument(history.doc);
    d.sourceText = state.n.text;
    d.originalValues = state.values;
    d.originalRows = state.rows;
    d.originalManual = state.manual;
    d.originalInput =
      d.textKind === 'kerning' && !state.manual ? '' : mixedNumericDisplay(state.values);
    d.started = true;
    d.capture.setPointerCapture?.(event.pointerId);
    d.capture.classList.add('scrubbing');
  }
  event.preventDefault();
  const values = scrubNumericValues(
      d.originalValues,
      dx,
      Number(d.capture.dataset.scrubStep),
      Number(d.capture.min),
      Number(d.capture.max),
    ),
    n = state.n,
    base = d.before.layers.find((l) => l.id === d.layerId).nodes.find((n) => n.id === d.nodeId),
    property =
      d.textKind === 'leading'
        ? 'leading'
        : d.textKind === 'wrap'
          ? 'textWrap'
          : 'characterPositions',
    previous = n[property],
    schema = history.doc.schemaVersion;
  const restore = (value) => {
    if (value === undefined) delete n[property];
    else n[property] = value;
  };
  try {
    // Derive every preview from the gesture start, retaining sparse inheritance and schema
    // exactly when the pointer returns to its origin or a bound prevents any change.
    restore(base[property]);
    history.doc.schemaVersion = d.before.schemaVersion;
    if (values.some((value, i) => value !== d.originalValues[i])) {
      if (d.textKind === 'offset') {
        n.characterPositions = setCharacterOffsets(
          n.text,
          base.characterPositions,
          Object.fromEntries(
            d.originalRows.map((g, i) => [
              g.id,
              g.offset.map((v, axis) => (axis === d.axis ? values[i] : v)),
            ]),
          ),
        );
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 3);
      } else if (d.textKind === 'transform') {
        n.characterPositions = setCharacterTransforms(
          n.text,
          base.characterPositions,
          Object.fromEntries(
            d.originalRows.map((g, i) => [
              g.id,
              { rotation: g.rotation, scale: g.scale, [d.key]: values[i] },
            ]),
          ),
        );
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 4);
      } else if (d.textKind === 'style') {
        n.characterPositions = setCharacterStyles(
          n.text,
          base.characterPositions,
          Object.fromEntries(d.ids.map((id, i) => [id, { [d.key]: values[i] / d.factor }])),
        );
        history.doc.schemaVersion = Math.max(
          history.doc.schemaVersion,
          n.characterPositions.version >= 4 ? 6 : 5,
        );
      } else if (d.textKind === 'kerning') {
        n.characterPositions = setCharacterKerningPairs(n.text, base.characterPositions, {
          [d.pairKey]: values[0],
        });
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 9);
      } else if (d.textKind === 'leading') {
        n.leading = { mode: 'manual', value: values[0] };
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 6);
      } else {
        setTextWrap(current(), n.id, { width: values[0] }, fonts, history.doc.imageAssets);
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 8);
      }
      validate(history.doc);
      const result = evaluate({ ...current(), output: n.id }, fonts, history.doc.imageAssets);
      if (result.error) throw Error(result.error);
      const layout = result.textLayout(n.id);
      if (layout.reason) throw Error(layout.reason);
      assertClosedOffsetChange(
        current(),
        d.before.layers.find((l) => l.id === d.layerId),
        fonts,
        history.doc.imageAssets,
      );
    }
  } catch (error) {
    restore(previous);
    history.doc.schemaVersion = schema;
    notify(error.message, true);
    return;
  }
  d.capture.value =
    d.textKind === 'kerning' && !d.originalManual && values[0] === d.originalValues[0]
      ? ''
      : mixedNumericDisplay(values);
  updateCanvas();
}
function mixedNumericDisplay(values) {
  return values.some((value) => value !== values[0]) ? '' : String(values[0]);
}
function field(n, key, q) {
  let source = current().nodes.find((x) => x.id === q.source),
    locked = q.locked || !!q.source;
  const name =
    key === 'center' && ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star'].includes(n.type)
      ? 'Position'
      : key.includes('.')
        ? key.split('.').at(-1)
        : key;
  let control;
  let displayed = q.value;
  if (source && renderEvaluation) {
    try {
      displayed = renderEvaluation.run(source.id, q.sourcePort);
    } catch {}
  }
  if (['Path', 'PaintedPath', 'Image'].includes(q.type))
    control = `<select data-path-source aria-label="${esc(n.name + ' ' + name)}"><option value="">Connect ${q.type}…</option>${current()
      .nodes.filter((x) => socketCompatible(outputType(x), q.type) && x.id !== n.id)
      .map(
        (x) =>
          `<option value="${x.id}" ${q.source === x.id ? 'selected' : ''}>${esc(x.name)} · ${x.id.slice(-4)}</option>`,
      )
      .join('')}</select>`;
  else if (q.type === 'Color') {
    const color = displayed || { hex: current().fill, alpha: 1 };
    control = `<input type="color" data-color="hex" aria-label="${esc(n.name + ' ' + name)} color" value="${esc(color.hex)}" ${locked ? 'disabled' : ''}><input type="number" data-scrub-step="0.01" data-color="alpha" aria-label="${esc(n.name + ' ' + name)} alpha" title="Alpha: 0 transparent, 1 opaque" min="0" max="1" step="0.01" value="${color.alpha}" ${locked ? 'disabled' : ''}>`;
  } else if (q.type === 'Boolean')
    control = `<input aria-label="${esc(name)}" data-value type="checkbox" ${displayed ? 'checked' : ''} ${locked ? 'disabled' : ''}>`;
  else if (q.expression && !q.source)
    control = `<input class="expression" aria-label="${esc(name)} expression" data-expression value="${esc(q.expression)}" ${q.locked ? 'disabled' : ''}>`;
  else
    control = (q.type === 'Vector2' ? displayed : [displayed])
      .map(
        (v, i) =>
          `<input type="number" step="any" ${numericAttributes(n, key)} aria-label="${esc(n.name + ' ' + name + (q.type === 'Vector2' ? (i ? ' Y' : ' X') : ''))}" data-value data-axis="${i}" value="${Number(n.type === 'Radial Gradient Fill' ? v : (v.toFixed?.(3) ?? v))}" ${locked ? 'disabled' : ''}>`,
      )
      .join('');
  return `<div class="field ${q.source ? 'connected' : ''}" data-node="${n.id}" data-key="${esc(key)}" data-type="${q.type}"><label>${esc(name)}${n.type === 'Stroke' && key === 'width' ? ' (px)' : ''}</label><div class="field-tools">${!['Path', 'PaintedPath', 'Image'].includes(q.type) ? `<button class="mini" data-connect-menu title="Connect ${esc(name)} input" aria-label="Connect ${esc(n.name + ' ' + name)} input">↗</button>` : ''}<button class="lock" data-lock title="${q.locked ? 'Unlock' : 'Lock'} ${esc(name)}">${q.locked ? '🔒' : '○'}</button>${['Scalar', 'Vector2'].includes(q.type) ? `<button class="mini" data-fx title="Expression: Vector2 uses x; y">ƒ</button>` : ''}</div><div class="field-controls" title="${q.source ? esc('Saved fallback: ' + JSON.stringify(q.value)) : ''}">${q.source ? `<button class="socket input" title="Drag to empty space to disconnect; right-click to disconnect" aria-label="Disconnect ${esc(name)}"></button>` : ''}${control}</div>${source && !['Path', 'PaintedPath', 'Image'].includes(q.type) ? `<span class="source-name">← ${esc(source.name + (q.sourcePort ? ' ' + (outputPorts(source).find((p) => p.id === q.sourcePort)?.label || q.sourcePort) : ''))} · connected value</span>` : ''}</div>`;
}
function remapFields(n, result) {
  let input;
  try {
    if (n.params.path.source) input = result.run(n.params.path.source);
  } catch {}
  if (!input) return '<p class="muted">Connect a path to edit its vertices.</p>';
  const batch = remapBatch(n.id);
  return (
    input.contours
      .map(
        (c, ci) =>
          `<details data-detail="contour-${c.id}"><summary>Contour ${ci + 1} · ${c.points.length} vertices</summary>${c.points
            .map(
              (pt, pi) =>
                `<details data-detail="remap-${pt.id}"><summary><input type="checkbox" data-batch-point="${pt.id}" data-node="${n.id}" aria-label="Select contour ${ci + 1} point ${pi + 1} for batch edit" ${batch.selected.has(pt.id) ? 'checked' : ''}> Point ${pi + 1}</summary>${[
                  'position',
                  'handleA',
                  'handleB',
                ]
                  .map((k) => {
                    let edit = n.edits.find((e) => e.pointId === pt.id);
                    if (edit?.params) return field(n, `remap.${pt.id}.${k}`, edit.params[k]);
                    return `<div class="field"><label>Δ ${k}</label>${[0, 1].map((axis) => `<input aria-label="Remap ${pi + 1} ${k} ${axis ? 'Y' : 'X'}" type="number" step="any" data-remap="${pt.id}" data-component="${k}" data-axis="${axis}" data-node="${n.id}" value="${edit?.[k]?.[axis] || 0}">`).join('')}</div>`;
                  })
                  .join(
                    '',
                  )}${n.edits.some((e) => e.pointId === pt.id && e.params) ? '' : `<button class="mini" data-enable-remap="${pt.id}" data-node="${n.id}">Enable typed point controls</button>`}${n.edits.some((e) => e.pointId === pt.id && input.unstable && e.fingerprint !== input.fingerprint) ? `<button class="mini danger" data-rebind-remap="${pt.id}" data-node="${n.id}">Rebind retained edit to this point</button>` : ''}</details>`,
            )
            .join('')}</details>`,
      )
      .join('') +
    `<div class="batch-edit"><p>${batch.selected.size} points selected · Δ position</p><div class="field-controls">${batch.delta.map((v, axis) => `<input type="number" step="any" data-batch-axis="${axis}" data-node="${n.id}" aria-label="Batch delta ${axis ? 'Y' : 'X'}" value="${v}">`).join('')}</div><button class="mini" data-apply-batch="${n.id}">Move selected points</button><button class="mini" data-clear-batch="${n.id}">Deselect points</button></div><button class="mini" data-clear-edits="${n.id}">Clear vertex edits</button>`
  );
}
// A name edit belongs to stable document IDs, never the currently selected row.
function nameInput(kind, id) {
  return `<input class="inline-name" data-rename-name="${id}" aria-label="${kind === 'node' ? 'Node' : 'Layer'} name" value="${esc(nameEdit.value)}" maxlength="100000" spellcheck="false">`;
}
function beginNameEdit(layerId, nodeId = null) {
  if (penDraft && !finishPenDraft()) return;
  const l = history.doc.layers.find((l) => l.id === layerId),
    target = nodeId ? l?.nodes.find((n) => n.id === nodeId) : l;
  if (!target || l.locked) {
    notify('Composition is locked', true);
    return;
  }
  cancelInteraction();
  nameEdit = { layerId, nodeId, original: target.name, value: target.name, composing: false };
  lastNameClick = null;
  render();
  const input = document.querySelector('[data-rename-name]');
  input.focus({ preventScroll: true });
  input.select();
}
function finishNameEdit(commit, deferred = false) {
  const edit = nameEdit;
  if (!edit) return;
  if (commit && edit.composing) {
    edit.pendingCommit = true;
    return;
  }
  nameEdit = null;
  lastNameClick = null;
  if (commit) {
    const l = history.doc.layers.find((l) => l.id === edit.layerId),
      target = edit.nodeId ? l?.nodes.find((n) => n.id === edit.nodeId) : l,
      value = edit.value.trim();
    if (!target || l.locked || target.name !== edit.original)
      notify('Name edit cancelled: target changed or composition is locked', true);
    else if (!value) notify('Name cannot be empty', true);
    else {
      history.apply(() => {
        target.name = value;
      });
      notify('Name updated');
    }
  }
  if (deferred) scheduleRender();
  else render();
}
// Structural renders and graph pointer capture can remove the native dblclick target.
// Recognize two completed, stationary title clicks by stable IDs as well.
function nameClicked(layerId, nodeId, event) {
  const now = performance.now(),
    previous = lastNameClick;
  lastNameClick = { layerId, nodeId, time: now, x: event.clientX, y: event.clientY };
  if (
    previous &&
    previous.layerId === layerId &&
    previous.nodeId === nodeId &&
    now - previous.time < 500 &&
    Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 5
  ) {
    beginNameEdit(layerId, nodeId);
    return true;
  }
  return false;
}
function bypassControl(n, compact = false) {
  const contract = bypassContract(n),
    label = n.bypassed ? 'Restore effect' : 'Bypass effect';
  return `<button class="mini node-bypass ${n.bypassed ? 'active' : ''}" data-bypass="${n.id}" aria-label="${label}: ${esc(n.name)}" aria-pressed="${!!n.bypassed}" title="${esc(contract.reason)}" ${current().locked || !contract.supported ? 'disabled' : ''}>${compact ? (n.bypassed ? 'Bypassed' : 'Bypass') : label}</button>${compact ? '' : `<p class="font-note">${esc(contract.reason)}${n.bypassed ? ' Saved controls below apply when restored.' : ''}</p>`}`;
}
function nodeHeader(n) {
  return `<div class="node-head"><button class="node-collapse" data-collapse="${n.id}" aria-expanded="${!n.collapsed}" aria-label="Toggle ${esc(n.name)} node details" title="${n.collapsed ? 'Expand' : 'Collapse'} node">${n.collapsed ? '▸' : '▾'}</button>${nameEdit?.nodeId === n.id && nameEdit.layerId === current().id ? nameInput('node', n.id) : `<strong data-rename-node="${n.id}" tabindex="0" role="button" aria-label="Rename ${esc(n.name)}" title="Double-click or F2 to rename">${esc(n.name)}</strong>`}${bypassControl(n, true)}<span class="type-tag">${outputType(n) || 'Scalar X/Y'}</span>${outputPorts(
    n,
  )
    .map(
      (port) =>
        `<span class="output-port">${port.label}<button class="socket output" data-source="${n.id}" ${port.id ? `data-source-port="${port.id}"` : ''} aria-label="${esc(n.name + (port.label ? ' ' + port.label : ''))} output" title="${port.type} output${port.id === 'position' ? ': evaluated Text Position, before downstream Transform' : ': drag to a compatible field'}"></button></span>`,
    )
    .join('')}</div>`;
}
function compactFields(n) {
  return activeParameters(n)
    .map(
      ([key, q]) =>
        `<div class="field compact-field ${q.source ? 'connected' : ''}" data-node="${n.id}" data-key="${esc(key)}" data-type="${q.type}"><button class="socket ${q.source ? 'input' : 'available-input'}" ${q.source ? '' : 'data-connect-menu'} aria-label="${esc(n.name + ' ' + key)} input" title="${esc(key)} · ${q.type}${q.source ? ' · connected; drag or right-click to disconnect' : ' · connect input'}"></button></div>`,
    )
    .join('');
}
function textPathControls(n) {
  const attachment = n.pathAttachment,
    targets = textPathTargets(current(), n.id, fonts, history.doc.imageAssets),
    value = attachment ? JSON.stringify([attachment.nodeId, attachment.contourId]) : '',
    missing =
      attachment &&
      !targets.some((t) => t.nodeId === attachment.nodeId && t.contourId === attachment.contourId),
    disabled = current().locked ? 'disabled' : '';
  return `<section class="text-path-controls" aria-label="Type on Path"><h4>Type on Path</h4><label>Explicit path · contour<select data-text-path="${n.id}" aria-label="Type on Path contour" ${disabled}><option value="">Detached (ordinary text)</option>${missing ? `<option value="${esc(value)}" selected disabled>Unavailable: ${esc(attachment.contourId)}</option>` : ''}${targets.map((t) => `<option value="${esc(JSON.stringify([t.nodeId, t.contourId]))}" ${value === JSON.stringify([t.nodeId, t.contourId]) ? 'selected' : ''}>${esc(t.name)} · ${esc(t.contourId)} · ${t.closed ? 'closed' : 'open'}</option>`).join('')}</select></label>${attachment ? `<label>Start unit<select data-text-path-mode="${n.id}" aria-label="Type on Path start unit" ${disabled}>${['distance', 'normalized'].map((mode) => `<option value="${mode}" ${mode === attachment.startMode ? 'selected' : ''}>${mode === 'distance' ? 'Distance px' : 'Normalized (0–1)'}</option>`).join('')}</select></label><label>Start anchor<input type="number" step="any" data-text-path-start="${n.id}" aria-label="Type on Path start" value="${attachment.start}" ${disabled}></label><label class="text-path-reverse"><input type="checkbox" data-text-path-reversed="${n.id}" aria-label="Type on Path reverse" ${attachment.reversed ? 'checked' : ''} ${disabled}>Reverse traversal</label><p class="font-note">Alignment below anchors the full advance span at this start. Position and flat reference controls are retained for detach. Typography reflows advances; character rotation/scale and local XY are applied before tangent projection. Canvas character dragging is unavailable while attached.</p>` : ''}<p class="font-note">One horizontal line on one stable contour. Closed paths wrap once; overflow rejects the edit. Generated/unstable contours and suspended Path Remap edits are unavailable. Detach restores original flat Position, references and character adjustments.</p></section>`;
}
function textControls(n) {
  if (n.type !== 'Text') return '';
  return `<div class="text-controls"><div class="field"><label>Text</label><textarea rows="3" data-text="${n.id}" aria-label="Text content">${esc(n.text)}</textarea></div><button class="mini" data-style-text-range="${n.id}" ${current().locked ? 'disabled' : ''}>Style selected text</button><button class="mini" data-kern-text-cursor="${n.id}" ${current().locked ? 'disabled' : ''}>Kerning at cursor</button><p class="font-note">Highlight text above, then Style selected text. Or use Character position to select on the canvas. Font and size below are defaults; selected-character overrides stay in place.</p><div class="field"><label>Default font</label><select data-font="${n.id}" aria-label="Text font" ${fontRequest?.node === n.id ? 'disabled' : ''}><option value="default" ${n.font === 'default' ? 'selected' : ''}>DejaVu Sans (Latin)</option>${Object.entries(
    history.doc.fontAssets || {},
  )
    .map(
      ([id, asset]) =>
        `<option value="${id}" ${n.font === id ? 'selected' : ''}>${esc(asset.name)}</option>`,
    )
    .join(
      '',
    )}${desktop && systemFonts.length ? `<optgroup label="Installed Windows fonts">${systemFonts.map(([id, name, reason]) => `<option value="${esc(id)}" ${reason ? 'disabled' : ''}>${esc(name)}${reason ? ` — ${esc(reason)}` : ''}</option>`).join('')}</optgroup>` : ''}</select></div>${desktop ? `<p class="font-note" role="status">${fontRequest?.node === n.id ? 'Loading font…' : esc(systemFontStatus)}</p>` : ''}<button class="mini" data-load-font="${n.id}">Load TTF / OTF…</button><p class="font-note">Font bytes stay local and are included in saved JSON. Use a font licensed for editable embedding; check its license before sharing. File flags do not guarantee license permission.</p>${textPathControls(n)}${wrapControls(n)}${leadingControls(n)}<div class="field"><label>Writing</label><select data-writing-mode="${n.id}" aria-label="Writing direction"><option value="horizontal-tb" ${n.writingMode !== 'vertical-rl' ? 'selected' : ''}>Horizontal →</option><option value="vertical-rl" ${n.writingMode === 'vertical-rl' ? 'selected' : ''}>Vertical ↓ / columns ←</option></select></div><div class="field"><label>Position reference ${n.writingMode === 'vertical-rl' ? 'Y' : 'X'}</label><select data-text-alignment="${n.id}" aria-label="Text alignment">${['start', 'center', 'end'].map((v, i) => `<option value="${v}" ${(n.alignment || 'start') === v ? 'selected' : ''}>${(n.writingMode === 'vertical-rl' ? ['Top', 'Center', 'Bottom'] : ['Left', 'Center', 'Right'])[i]}</option>`).join('')}</select></div><div class="field"><label>Reference bounds</label><select data-reference-bounds="${n.id}" aria-label="Text reference bounds">${['visible', 'advance'].map((v) => `<option value="${v}" ${(n.referenceBounds || 'advance') === v ? 'selected' : ''}>${v === 'visible' ? 'Visible outline' : 'Advance (legacy)'}</option>`).join('')}</select></div><div class="field"><label>Position reference ${n.writingMode === 'vertical-rl' ? 'X' : 'Y'}</label><select data-cross-alignment="${n.id}" aria-label="Text cross-axis reference">${['origin', 'start', 'center', 'end'].map((v, i) => `<option value="${v}" ${(n.crossAlignment || 'origin') === v ? 'selected' : ''}>${(n.writingMode === 'vertical-rl' ? ['First column center', 'Left', 'Center', 'Right'] : ['First baseline', 'Top', 'Center', 'Bottom'])[i]}</option>`).join('')}</select></div><div class="field"><label>Automatic font kerning (horizontal)</label><input type="checkbox" data-text-kerning="${n.id}" aria-label="Text kerning" ${n.kerning !== false ? 'checked' : ''}></div><p class="font-note">Position reference holds each line/column’s chosen visible edge, or legacy advance including spaces. Cross-axis edges use the whole visible block. letterSpacing: inherited tracking in px. lineSpacing: auto-leading factor; ignored by manual leading. Enter starts a hard line or column. Wrap width adds derived horizontal lines without changing the source text. Changing a reference keeps Position fixed and moves the outline; font and size changes keep the chosen reference fixed.</p><p class="font-note">Position OUT is the evaluated Vector2 at this reference, before downstream Transform. Connect it to another Position, or Separate X/Y and Combine to keep one axis independent. Add Vector Math for an offset. Move or snap the source Text; connected followers do not edit it.</p></div>`;
}
function positionReferenceControls(n) {
  if (!['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Image'].includes(n.type)) return '';
  const options = [
    ['origin', n.type === 'Image' ? 'Origin (top left)' : 'Origin (construction center)'],
  ];
  for (const y of ['top', 'middle', 'bottom'])
    for (const x of ['left', 'center', 'right']) options.push([`${x}-${y}`, `${y} / ${x}`]);
  return `<div class="field"><label>Position reference</label><select data-position-reference="${n.id}" aria-label="Object Position reference">${options.map(([value, label]) => `<option value="${value}" ${(n.positionReference || 'origin') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><p class="font-note">Bounds exclude stroke. Position stays fixed when the reference or size changes.${n.type === 'Image' ? ' Image bounds include transparent pixels.' : ''}</p>`;
}
function referenceControls(n, result, compact = false) {
  if (n.type !== 'Reference') return '';
  const targets = vectorReferenceTargets(current(), n.id),
    value = n.reference ? JSON.stringify([n.reference.nodeId, n.reference.portId]) : '',
    target = targets.find(
      (t) => t.nodeId === n.reference?.nodeId && t.portId === n.reference?.portId,
    );
  let diagnostic = '',
    displayed = '';
  try {
    referenceTarget(current(), n);
    displayed = result
      .run(n.id)
      .map((v) => Number(v.toFixed(3)))
      .join(', ');
  } catch (e) {
    diagnostic = e.message;
  }
  const label = target
    ? `${target.name} · ${target.label}`
    : n.reference
      ? `${n.reference.nodeId} · ${n.reference.portId}`
      : 'No target selected';
  const status = `<p class="font-note reference-source ${diagnostic ? 'reference-error' : ''}" data-reference-status="${n.id}" title="${esc(n.reference ? n.reference.nodeId + ' / ' + n.reference.portId : '')}">← ${esc(label)}<br>${diagnostic ? esc(diagnostic) : `<output data-reference-value="${n.id}">[${esc(displayed)}] · Vector2</output>`}</p>`;
  const jump = target
    ? `<button class="mini" data-reference-jump="${n.id}" title="Select and reveal the source node">Jump to source</button>`
    : '';
  if (compact) return status + jump;
  return `<div class="field"><label>Vector2 source · same layer</label><select data-reference-target="${n.id}" aria-label="Reference source and output" ${current().locked ? 'disabled' : ''}><option value="" ${!n.reference ? 'selected' : ''}>Choose Vector2 output…</option>${n.reference && !target ? `<option value="${esc(value)}" selected disabled>Missing: ${esc(label)}</option>` : ''}${targets.map((t) => `<option value="${esc(JSON.stringify([t.nodeId, t.portId]))}" ${t === target ? 'selected' : ''}>${esc(t.name + ' · ' + t.label + ' · ' + t.nodeId)}</option>`).join('')}</select></div>${status}${jump}<p class="font-note">Read-only value reference by stable node and output IDs. Rename keeps the link; deleting the source leaves an explicit missing target. Text Position is before downstream Transform. Vector values keep their source meaning; no world-coordinate conversion.</p>`;
}
function offsetControls(n) {
  return n.type === 'Closed Path Offset'
    ? '<p class="font-note">Closed, ungrouped nonzero regions only. Positive expands; negative insets (empty erosion is valid). Distance is artboard px after upstream Transform. Place before Fill / Stroke. Curves become polygons (0.1 px flatten/arc tolerances, 0.0001 px grid); these are component tolerances, not a final offset error bound. Interactive cap: 256 flattened input / 512 output vertices, 8 nonzero Offset nodes. Unsupported or over-budget edits roll back.</p>'
    : '';
}
function gradientControls(n) {
  if (n.type === 'Radial Gradient Fill')
    return '<p class="font-note">Two colors in absolute artboard coordinates (px). Concentric circular ramp with radius from 0.0001 to 100000 px; center coordinates ±100000 px. No focal offsets or elliptical transform. Geometry / Transform / Repeater go before paint; repeated copies share one ramp. Each stop keeps its alpha. Save JSON to preserve the full procedural graph. Import SVG reopens our exported two-stop gradients as editable paths and paint nodes.</p>';
  return n.type === 'Linear Gradient Fill'
    ? '<p class="font-note">Two colors in absolute artboard coordinates (px). Start and end must differ. Geometry / Transform / Repeater go before paint; repeated copies share one ramp. Each stop keeps its alpha. Save JSON to preserve the full procedural graph. Import SVG reopens our exported two-stop gradients as editable paths and paint nodes.</p>'
    : '';
}
function strokeControls(n) {
  if (n.type !== 'Stroke') return '';
  return `<div class="field"><label>Line cap</label><select data-stroke-cap="${n.id}" aria-label="Stroke line cap">${['butt', 'round', 'square'].map((v) => `<option value="${v}" ${(n.strokeCap || 'butt') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Line join</label><select data-stroke-join="${n.id}" aria-label="Stroke line join">${['miter', 'round', 'bevel'].map((v) => `<option value="${v}" ${(n.strokeJoin || 'miter') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Dash / gap (px)</label><input data-stroke-dash="${n.id}" aria-label="Stroke dash pattern" value="${esc((n.strokeDash || []).join(' '))}" placeholder="Solid, or e.g. 12 6"></div><p class="font-note">Odd patterns repeat twice. Empty/none or all zero is solid. Miter limit is a ratio; dashOffset is px.</p>`;
}
function operationControls(n) {
  const options = operationOptions[n.type];
  if (!options) return '';
  return `<div class="field"><label>${n.type === 'Closed Path Offset' ? 'Join' : 'Operation'}</label><select data-operation="${n.id}" aria-label="${esc(n.name)} operation">${options.map((op) => `<option value="${op}" ${n.operation === op ? 'selected' : ''}>${op[0].toUpperCase() + op.slice(1)}</option>`).join('')}</select></div>`;
}
function expandedNodeBody(n, result) {
  return `<div class="node-body">${operationControls(n)}${strokeControls(n)}${gradientControls(n)}${offsetControls(n)}${radialControls(n)}${positionReferenceControls(n)}${transformControls(n)}${positionControllerControls(n)}${referenceControls(n, result)}${n.type === 'Join Geometry' ? '<p class="font-note">Bundle A and B without cutting or welding. Shared transforms and paint apply to both; overlapping transparent groups remain independently painted. Use Boolean Union to merge silhouettes.</p>' : ''}${n.type === 'Geometry Repeater' ? '<p class="font-note">Geometry only; place before Fill / Stroke. Linear: step per copy. Radial: rotate source around center; angle is total arc (fit) or per-copy step. ±360° fit closes the ring without duplicate endpoints. Count includes the first copy (1–256).</p>' : ''}${textControls(n)}${activeParameters(
    n,
  )
    .filter(([k]) => Object.hasOwn(n.params, k))
    .map(([k, q]) => field(n, k, q))
    .join(
      '',
    )}${n.points.map((pt, i) => `<details data-detail="${pt.id}" ${i === 0 ? 'open' : ''}><summary>Point ${i + 1} <button class="mini" data-delete-point="${pt.id}" data-node="${n.id}" title="Delete point">×</button></summary>${['position', 'handleA', 'handleB'].map((k) => field(n, `${pt.id}.${k}`, pt[k])).join('')}<select data-handle-type="${pt.id}" data-node="${n.id}" aria-label="Point ${i + 1} handle type">${['corner', 'smooth', 'symmetric'].map((t) => `<option ${pt.handleType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></details>`).join('')}${n.type === 'Curve' ? `<button class="mini" data-add-point="${n.id}">+ Point</button>` : ''}${n.type === 'Path Remap' ? remapFields(n, result) : ''}<div class="node-actions">${['Path', 'PaintedPath', 'Image'].includes(outputType(n)) && !['Output', 'Image Output'].includes(n.type) ? `<button class="mini" data-preview="${n.id}">Use as output</button>` : ''}<button class="mini" data-duplicate="${n.id}">Duplicate</button>${!['Output', 'Image Output'].includes(n.type) ? `<button class="mini danger" data-delete="${n.id}">Delete</button>` : ''}</div></div>`;
}
function nodeHTML(n, result) {
  const body = n.collapsed
    ? `<div class="node-body compact-body">${compactFields(n)}${referenceControls(n, result, true)}</div><div hidden><button data-duplicate="${n.id}">Duplicate</button>${!['Output', 'Image Output'].includes(n.type) ? `<button data-delete="${n.id}">Delete</button>` : ''}</div>`
    : expandedNodeBody(n, result);
  return `<section class="node ${n.bypassed ? 'bypassed' : ''} ${selection.has(n.id) ? 'selected' : ''} ${n.collapsed ? 'collapsed' : ''}" data-id="${n.id}" style="left:${n.position[0]}px;top:${n.position[1]}px;width:${n.width || 264}px">${nodeHeader(n)}${body}<div class="node-resize" title="Drag to resize node" aria-hidden="true"></div></section>`;
}
function render(resetView = false, artworkResolution = null) {
  if (composing || nameEdit?.composing) {
    needsRender = true;
    return;
  }
  needsRender = false;
  if (pendingRender !== null) {
    clearTimeout(pendingRender);
    pendingRender = null;
  }
  const focused = resetView ? null : captureFocus(app);
  const inspectorScroll = resetView ? 0 : document.querySelector('.right')?.scrollTop || 0;
  const guideScroll = resetView
    ? [0, 0]
    : ['.guides-panel', '.guide-list'].map(
        (selector) => document.querySelector(selector)?.scrollTop || 0,
      );
  for (const el of document.querySelectorAll('.graph details[data-detail]'))
    detailsState.set(`${el.closest('.node').dataset.id}/${el.dataset.detail}`, el.open);
  if (artworkTarget && !history.doc.layers.some((l) => l.id === artworkTarget)) {
    artworkTarget = null;
    artworkSelection = new Set();
  }
  if (selected && !current().nodes.some((n) => n.id === selected)) selected = null;
  if (penId && !current().nodes.some((n) => n.id === penId && n.type === 'Curve')) penId = null;
  if (!selection.has(selected)) selection = new Set(selected ? [selected] : []);
  selection = new Set([...selection].filter((id) => current().nodes.some((n) => n.id === id)));
  let scroll = document.querySelector('.graph-scroll'),
    oldScroll = scroll && !resetView ? [scroll.scrollLeft, scroll.scrollTop] : [0, 0];
  const doc = history.doc,
    aids = guideSettings(doc),
    l = current();
  activeLayer = l.id;
  const n = selectedNode();
  if (
    characterEdit &&
    (characterEdit.node !== n?.id || characterEdit.layer !== l.id || l.locked || !layerShown(l))
  )
    characterEdit = null;
  fonts = resolveFonts(doc, bundledFont ? { default: bundledFont } : {});
  let results = canvasLayers().map((x) => [x, evaluate(x, fonts, history.doc.imageAssets)]),
    result = results.find(([x]) => x.id === l.id)[1];
  renderEvaluation = result;
  // One synchronous status resolution for both hint and Inspector; callers may
  // reuse a just-resolved unchanged document, never a persistent cached target.
  const move = artworkTarget ? artworkResolution || artworkMove() : null;
  const duplication =
    artworkSelection.size > 1
      ? resolveArtworkDuplicateSelection(doc, artworkSelection, { fonts })
      : artworkTarget
        ? resolveArtworkDuplicateTarget(doc, artworkTarget, { fonts }, move)
        : null;
  snapLayerBounds = collectSnapLayerBounds(
    doc,
    results,
    artworkTarget ? artworkSelection : l.id,
    pathBounds,
  );
  app.innerHTML = `<header><div class="brand"><b>Nect</b><small>SVG</small></div><button data-action="new">New</button><button data-action="open">Open</button><button data-action="import-svg">Import SVG</button><button data-action="import-image">Import image</button><button data-action="save">Save JSON</button><button data-action="export">Export SVG</button><select id="png-scale" aria-label="PNG export scale">${[0.5, 1, 2, 4].map((v) => `<option value="${v}" ${pngScale === v ? 'selected' : ''}>${v}× PNG</option>`).join('')}</select><button data-action="export-png" title="Transparent artboard · ${Math.round(doc.width * pngScale)} × ${Math.round(doc.height * pngScale)} px">Export PNG</button><span class="divider"></span><button data-action="undo" ${history.past.length || penDraft ? '' : 'disabled'} title="Ctrl+Z">↶</button><button data-action="redo" ${history.future.length && !penDraft ? '' : 'disabled'} title="Ctrl+Shift+Z">↷</button><span class="spacer"></span><span class="muted">${esc(doc.name)}</span><button data-action="help">?</button></header><div class="workspace"><nav class="tools" aria-label="Tools">${[
    ['select', '↖', 'Select / move'],
    ['pen', '⌁', 'Pen / Curve'],
    ['Circle', '○', 'Add Circle'],
    ['Rectangle', '□', 'Add Rectangle'],
    ['Polygon', '⬡', 'Add Polygon'],
    ['Star', '☆', 'Add Star'],
    ['Text', 'T', 'Add Text'],
  ]
    .map(
      ([id, icon, label]) =>
        `<button data-tool="${id}" title="${label}" aria-label="${label}" class="${tool === id ? 'active' : ''}">${icon}</button>`,
    )
    .join(
      '',
    )}</nav><main class="middle"><div class="canvas-wrap"><div class="canvas-toolbar" role="toolbar" aria-label="Artboard view"><button data-action="zoom-out" aria-label="Artboard zoom out" title="Zoom out (−)">−</button><output data-zoom="canvas" aria-label="Artboard zoom"></output><button data-action="zoom-in" aria-label="Artboard zoom in" title="Zoom in (+)">+</button><button data-action="fit" title="Fit artboard (Shift+1)">Fit artboard</button><button data-action="actual-size" title="Actual size: one document unit per CSS pixel (Ctrl/Cmd+1)">100%</button><button data-action="snap" class="${aids.snap ? 'active' : ''}" aria-pressed="${aids.snap}" title="Snap to enabled guides, artwork, artboard and grid; hold Alt to bypass">Snap</button><button data-action="guides-panel" aria-expanded="${guidesOpen}">Guides</button><span>${doc.width} × ${doc.height}</span>${penDraft ? '<button data-pen-finish>Finish path</button><button data-pen-cancel>Cancel path</button>' : ''}</div>${guidesPanel()}<div class="canvas-stage" tabindex="0" aria-label="Artboard viewport" aria-describedby="canvas-navigation-hint" title="Wheel: pan · Ctrl/Cmd+wheel: zoom · Space or middle drag: pan"><svg class="artboard" viewBox="0 0 ${doc.width} ${doc.height}" aria-label="Artwork canvas">${gridOverlay()}${results
    .filter(([x, r]) => layerShown(x) && r.path && !r.error)
    .map(([x, r]) => layerShape(x, r.path))
    .join(
      '',
    )}${guidesOverlay()}${canvasOverlay(n, result)}</svg>${characterFloating()}</div><div class="hint"><span id="canvas-navigation-hint" class="navigation-hint">Space drag: pan · Ctrl/Cmd wheel: zoom</span><span>${tool === 'pen' ? 'Pen: click for corners, drag for handles; click first point to close. Enter / Escape: finish · Cancel path: discard.' : artworkTarget ? `Artwork · ${artworkSelection.size > 1 ? `${artworkSelection.size} selected` : esc(l.name)} · ${esc(move.supported ? 'Shift-click: add/remove; drag to move · Arrow: 1 unit · Shift+Arrow: 10' : move.reason)}` : n ? `Node · ${esc(n.name)} · ${n.type === 'Transform' ? 'Selected Transform output · ' : ''}before downstream nodes${selection.size > 1 ? ` + ${selection.size - 1} generators` : ``} · ${esc(l.name)}${l.locked ? ' · Locked' : ''}` : 'Select artwork on the canvas or a layer; select a graph node for source-stage editing'}</span></div></div><div class="splitter" role="separator" aria-label="Resize node graph" tabindex="0"></div><section class="graph-panel" style="height:${graphHeight}%"><div class="panel-head graph-toolbar" role="toolbar" aria-label="Node graph view"><strong>Node graph</strong><span class="muted graph-layer-name" title="${esc(l.name)}">${esc(l.name)}</span><span class="spacer"></span><select id="add-node" aria-label="Add node" ${penDraft ? 'disabled' : ''}><option value="">+ Add node</option>${Object.keys(
    definitions,
  )
    .filter((x) => !['Output', 'Image Output', 'Image'].includes(x))
    .map((x) => `<option>${x}</option>`)
    .join(
      '',
    )}</select><button data-action="graph-zoom-out" aria-label="Node graph zoom out" title="Zoom out (−)">−</button><output data-zoom="graph" aria-label="Node graph zoom"></output><button data-action="graph-zoom-in" aria-label="Node graph zoom in" title="Zoom in (+)">+</button><button data-action="graph-fit" title="Fit all nodes (Shift+1)">Fit all</button><button data-action="graph-fit-selection" title="Fit selected nodes (Shift+2)">Fit selection</button><button data-action="graph-reset" title="Reset graph to 100% and origin">Reset view</button></div><div class="graph-scroll" tabindex="0" aria-label="Node graph viewport" aria-describedby="graph-navigation-hint" title="Space, middle or Ctrl/Cmd+Shift drag: pan · Ctrl/Cmd+wheel: zoom · Ctrl/Cmd+1: actual size"><div class="graph"><svg class="wires"></svg>${penDraft ? '<div inert class="pen-graph-preview">' : ''}${l.nodes.map((x) => nodeHTML(x, result)).join('')}${penDraft ? '</div>' : ''}</div></div><div class="graph-hint" id="graph-navigation-hint">Space drag: pan · Ctrl/Cmd wheel: zoom · Shift+1: fit all · Shift+2: fit selection</div></section></main><aside class="right"><section class="layers"><div class="panel-head"><strong>Layers</strong><span class="spacer"></span><button class="mini" data-action="add-layer" title="Add the starter Boolean demo as an independent composition">+ Demo composition</button><button class="mini" data-action="add-blank-layer" aria-label="Add blank composition" title="Add a blank composition with an empty vector Output">+ Blank</button></div>${[
    ...doc.layers,
  ]
    .reverse()
    .map(
      (x) =>
        `<div class="layer ${!x.visible ? 'is-hidden' : ''} ${x.guide ? 'is-guide' : ''} ${(artworkTarget ? artworkSelection.has(x.id) : x.id === l.id) ? 'selected' : ''}" data-layer="${x.id}"><button class="layer-visibility" data-visible="${x.id}" aria-label="${x.visible ? 'Hide' : 'Show'} layer: ${esc(x.name)}" aria-pressed="${x.visible}" title="${x.visible ? 'Hide' : 'Show'} layer in canvas and export">${x.visible ? 'Hide' : 'Show'}</button>${nameEdit?.layerId === x.id && !nameEdit.nodeId ? nameInput('layer', x.id) : `<button class="name" data-select-layer="${x.id}" aria-pressed="${artworkTarget ? artworkSelection.has(x.id) : false}" title="Click to select; Shift-click to add/remove. Double-click or F2 to rename">${esc(x.name)}</button>`}<button data-layer-guide="${x.id}" class="${x.guide ? 'active' : ''}" aria-label="${x.guide ? 'Make artwork layer' : 'Make guide layer'}: ${esc(x.name)}" aria-pressed="${!!x.guide}" title="${x.guide ? 'Guide layer: excluded from SVG' : 'Convert to guide layer'}" ${x.locked ? 'disabled' : ''}>${x.guide ? 'Guide' : '◇'}</button><button data-layer-lock="${x.id}" title="Toggle layer lock">${x.locked ? '🔒' : '○'}</button><div class="layer-actions">${['backward', 'forward'].map((direction) => `<button data-order-layer="${x.id}" data-order-direction="${direction}" aria-label="${direction === 'forward' ? 'Forward' : 'Backward'} one position: ${esc(x.name)}">${direction === 'forward' ? 'Forward ↑' : 'Backward ↓'}</button>`).join('')}<button class="danger" data-delete-layer="${x.id}" aria-label="Delete layer: ${esc(x.name)}" ${x.locked || deletionBusy() ? 'disabled' : ''} title="Delete this entire layer and its graph (Undo available)">Delete layer</button></div></div>`,
    )
    .join(
      '',
    )}${penDraft ? '<div class="layer selected" data-pen-draft role="status">Curve · Draft (not saved)</div>' : ''}</section><section><div class="panel-head"><strong>Inspector</strong></div><div class="inspector-body">${penDraft ? '<p role="status">Draft curve. Finish to edit its graph and properties; Cancel path discards it.</p><div inert>' : ''}${
    n
      ? `<h3>${esc(n.name)}</h3>${bypassControl(n)}<p>Node · ${esc(n.type)} · ${outputType(n) || 'Scalar X/Y'}<br>Before downstream nodes. Use the source-stage move marker or dedicated handles to edit this node directly. Connected or locked parameters cannot be moved.</p>${['Rectangle', 'Ellipse', 'Circle', 'Polygon', 'Star', 'Text'].includes(n.type) ? `<p class="font-note">Dimension handles edit selected ${esc(n.type)} output before downstream nodes. Position and its reference stay fixed.${n.type === 'Text' ? ' Font size changes glyph size, not a layout box width.' : ''}</p>` : ''}${operationControls(n)}${strokeControls(n)}${gradientControls(n)}${offsetControls(n)}${radialControls(n)}${positionReferenceControls(n)}${transformControls(n)}${positionControllerControls(n)}${referenceControls(n, result)}${n.type === 'Join Geometry' ? '<p class="font-note">Bundle A and B without cutting or welding. Shared transforms and paint apply to both; overlapping transparent groups remain independently painted. Use Boolean Union to merge silhouettes.</p>' : ''}${n.type === 'Geometry Repeater' ? '<p class="font-note">Geometry only; place before Fill / Stroke. Linear: step per copy. Radial: rotate source around center; angle is total arc (fit) or per-copy step. ±360° fit closes the ring without duplicate endpoints. Count includes the first copy (1–256).</p>' : ''}${characterControls(n)}${textControls(n)}${activeParameters(
          n,
        )
          .filter(
            ([k, q]) =>
              Object.hasOwn(n.params, k) && !['Path', 'PaintedPath', 'Image'].includes(q.type),
          )
          .map(([k, q]) => field(n, k, q))
          .join('')}`
      : artworkTarget
        ? `<h3>Artwork · ${artworkSelection.size > 1 ? `${artworkSelection.size} selected` : esc(l.name)}</h3>${artworkAlignmentControls(move)}${artworkDistributionControls(move)}${artworkGapControls(move)}<p>Final evaluated Output in artboard coordinates.${artworkSelection.size > 1 ? ` Active layer: ${esc(l.name)}.` : ''}</p><p>Shift-click artwork or Layers names to add/remove. Click selected artwork to drag the selection together.</p><p class="artwork-move-status">${esc(move.supported ? 'Drag artwork to move. Arrow keys: 1 unit; Shift+Arrow: 10 units. Select a graph node to edit its source stage.' : move.reason)}</p><button data-duplicate-artwork="${esc(l.id)}" ${!duplication.supported || deletionBusy() ? 'disabled' : ''} title="${esc(duplication.supported ? 'Create independent copies immediately above each source at the same coordinates (one Undo)' : duplication.reason)}">Duplicate in place</button><p class="artwork-duplicate-status">${esc(duplication.supported ? 'Independent whole-layer copies at the same coordinates, each immediately above its source. Active copy follows the active source. Initial support requires a complete movable route with no extra nodes; Curve: 2–128 anchors.' : duplication.reason)}</p>`
        : hasEmptyOutput(l)
          ? '<h3>Empty composition</h3><p>Add independent artwork with a toolbar tool, or add graph nodes and explicitly Use as output. The empty Output renders nothing.</p>'
          : '<p>Select artwork or a graph node.</p>'
  }<hr style="border:0;border-top:1px solid #d8dde2"><div class="field"><label>Layer name</label><input class="string" data-layer-name value="${esc(l.name)}" aria-label="Layer name"></div><div class="field"><label>Artboard W</label><input type="number" data-dimension="width" value="${doc.width}" aria-label="Artboard width"></div><div class="field"><label>Artboard H</label><input type="number" data-dimension="height" value="${doc.height}" aria-label="Artboard height"></div>${results
    .filter(([, r]) => r.error || r.warnings.length)
    .map(
      ([x, r]) => `<p class="warning">${esc(x.name)}: ${esc(r.error || r.warnings.join(' '))}</p>`,
    )
    .join(
      '',
    )}<p>Dynamic sockets<br>Drag a node output onto a compatible field. Drag a connected input into empty graph space to disconnect. Right-click an input also disconnects.</p><p>Expressions: arithmetic, pi, sin, cos, sqrt, min/max. Vector2: x expression; y expression.</p>${penDraft ? '</div>' : ''}</div></section></aside></div><footer class="status ${error ? 'error' : ''}"><span class="message">${esc(message)}</span><span class="spacer"></span><span>Local document · ${l.nodes.length} nodes</span></footer><input id="image-file" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden><input id="font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" hidden><input id="open-file" type="file" accept=".json,application/json" hidden><input id="import-svg-file" type="file" accept=".svg,image/svg+xml" hidden>`;
  const duplicateButton = document.querySelector('[data-duplicate-artwork]');
  if (duplicateButton) {
    duplicateButton.dataset.duplicateSelection = JSON.stringify([...artworkSelection]);
    duplicateButton.dataset.eligible = String(duplication.supported);
    duplicateButton.dataset.availableTitle = duplicateButton.title;
  }
  const instanceControl = document.querySelector('[data-character-instance]');
  if (instanceControl && characterEdit) instanceControl.value = characterEdit.route || '';
  const characterList = document.querySelector('[data-character-selection]');
  if (characterList && characterEdit)
    for (const option of characterList.options)
      option.selected = characterEdit.selected.has(option.value);
  if (resetView) {
    graphZoom = 1;
    canvasFit = true;
    pan = [0, 0];
  }
  document.querySelector('.graph').style.zoom = graphZoom;
  updateGraphBounds(oldScroll);
  const gs = document.querySelector('.graph-scroll');
  gs.scrollLeft = oldScroll[0];
  gs.scrollTop = oldScroll[1];
  for (const el of document.querySelectorAll('.graph details[data-detail]')) {
    const key = `${el.closest('.node').dataset.id}/${el.dataset.detail}`;
    if (detailsState.has(key)) el.open = detailsState.get(key);
  }
  fitCanvas();
  updateNavigation();
  restoreFocus(app, focused);
  document.querySelector('.right').scrollTop = inspectorScroll;
  ['.guides-panel', '.guide-list'].forEach((selector, index) => {
    const el = document.querySelector(selector);
    if (el) el.scrollTop = guideScroll[index];
  });
  requestAnimationFrame(() => {
    updateGraphBounds();
    drawWires();
  });
}
function editGuides(fn) {
  try {
    history.apply((doc) => {
      doc.editor ||= guideDefaults();
      fn(doc.editor);
    });
    snapMatches = [];
    notify('Editing aids updated');
  } catch (err) {
    notify(err.message, true);
  }
  render();
}
function layerShown(l) {
  return l.visible && (!l.guide || guideSettings(history.doc).visible);
}
function layerShape(l, path) {
  return renderElement(
    path,
    { ...l, name: l.id },
    history.doc.imageAssets,
    `class="shape ${l.guide ? 'guide-layer-shape' : ''}"`,
    `nect-gradient-${history.doc.layers.indexOf(l)}`,
  );
}
function layoutConfig() {
  return layoutDraft || guideSettings(history.doc).layoutGrid || layoutGridDefaults();
}
function layoutPanel() {
  const a = guideSettings(history.doc),
    config = layoutConfig();
  let error = '',
    lines = [];
  try {
    lines = layoutGridLines(history.doc, config);
  } catch (e) {
    error = e.message;
  }
  const locked = a.locked || a.guides.some((g) => g.origin === 'layout' && g.locked);
  return `<div class="layout-grid-panel"><strong>Layout grid</strong><div class="layout-grid-fields">${[
    ['columns', 'Columns'],
    ['rows', 'Rows'],
    ['marginX', 'Margin X'],
    ['marginY', 'Margin Y'],
    ['gutterX', 'Gutter X'],
    ['gutterY', 'Gutter Y'],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input type="number" data-layout-field="${key}" aria-label="Layout ${label}" min="${['columns', 'rows'].includes(key) ? 1 : 0}" max="${['columns', 'rows'].includes(key) ? 40 : 100000}" step="${['columns', 'rows'].includes(key) ? 1 : 'any'}" value="${Number.isFinite(config[key]) ? config[key] : ''}"></label>`,
    )
    .join(
      '',
    )}</div><label><input type="checkbox" data-layout-preview ${layoutPreview ? 'checked' : ''}>Preview layout</label><p class="layout-grid-summary ${error ? 'warning' : ''}">${esc(error || `${lines.length} guides · artboard-based · margins on both sides`)}</p><div class="guide-add"><button data-layout-apply ${error || locked ? 'disabled' : ''}>${a.layoutGrid ? 'Update layout' : 'Create layout'}</button><button data-layout-cancel>Cancel</button><button data-layout-remove ${!a.layoutGrid || locked ? 'disabled' : ''}>Remove layout</button></div><p>Updates replace only layout guides. Manual guides stay. Unlock layout guides before updating.</p></div>`;
}
function layoutOverlay() {
  if (!layoutPreview || !guidesOpen) return '';
  try {
    return layoutGridLines(history.doc, layoutConfig())
      .map((g) => guideLine(g.axis, g.position, 'class="layout-preview"'))
      .join('');
  } catch {
    return '';
  }
}
function guidesPanel() {
  if (!guidesOpen) return '';
  const a = guideSettings(history.doc);
  return `<section class="guides-panel" aria-label="Guides and snapping"><div class="guide-toggles">${[
    ['visible', 'Show guides'],
    ['locked', 'Lock all guides'],
    ['gridVisible', 'Show grid'],
    ['snapGuides', 'Snap guides'],
    ['snapArtboard', 'Snap artboard'],
    ['snapGrid', 'Snap grid'],
    ['snapArtwork', 'Snap artwork'],
  ]
    .map(
      ([key, label]) =>
        `<label><input type="checkbox" data-guide-setting="${key}" ${a[key] ? 'checked' : ''}>${label}</label>`,
    )
    .join(
      '',
    )}</div><label>Grid spacing <input type="number" min="1" max="10000" data-guide-setting="gridSize" aria-label="Grid spacing" value="${a.gridSize}"></label>${layoutPanel()}<div class="guide-add"><button data-add-guide="y" ${a.locked ? 'disabled' : ''}>+ Horizontal</button><button data-add-guide="x" ${a.locked ? 'disabled' : ''}>+ Vertical</button></div><div class="guide-list">${a.guides.map((g, i) => `<div class="guide-row ${selectedGuide === g.id ? 'selected' : ''}"><button data-select-guide="${g.id}" aria-label="Select guide ${i + 1}" aria-pressed="${selectedGuide === g.id}">${g.origin === 'layout' ? '▦ ' : ''}${g.axis === 'x' ? 'V · X' : 'H · Y'}</button><input type="number" step="any" min="-100000" max="100000" data-guide-position="${g.id}" aria-label="Guide ${i + 1} position" value="${g.position}" ${a.locked || g.locked ? 'disabled' : ''}><button data-lock-guide="${g.id}" aria-label="${g.locked ? 'Unlock' : 'Lock'} guide ${i + 1}" aria-pressed="${g.locked}" ${a.locked ? 'disabled' : ''}>${g.locked ? '🔒' : '○'}</button><button data-delete-guide="${g.id}" aria-label="Delete guide ${i + 1}" ${a.locked || g.locked ? 'disabled' : ''}>×</button></div>`).join('')}</div><p>Drag a guide to move it. Hidden guides do not snap; locked guides still snap. Snap artwork aligns to other visible layers’ geometry edges and centers (without stroke), including locked layers. The editing layer is excluded. Alt bypasses snapping.</p></section>`;
}
function gridOverlay() {
  const a = guideSettings(history.doc);
  if (!a.gridVisible) return '';
  return `<defs><pattern id="editing-grid" width="${a.gridSize}" height="${a.gridSize}" patternUnits="userSpaceOnUse"><path d="M ${a.gridSize} 0 H 0 V ${a.gridSize}" class="editing-grid-line"/></pattern></defs><rect width="${history.doc.width}" height="${history.doc.height}" fill="url(#editing-grid)" pointer-events="none"/>`;
}
function guideLine(axis, position, attributes) {
  return `<line ${axis === 'x' ? `x1="${position}" x2="${position}" y1="0" y2="${history.doc.height}"` : `y1="${position}" y2="${position}" x1="0" x2="${history.doc.width}"`} ${attributes}/>`;
}
function guidesOverlay() {
  const a = guideSettings(history.doc);
  return (
    (a.visible
      ? a.guides
          .map(
            (g) =>
              guideLine(
                g.axis,
                g.position,
                `class="editing-guide ${selectedGuide === g.id ? 'selected' : ''} ${a.locked || g.locked ? 'locked' : ''}" data-guide="${g.id}" data-axis="${g.axis}"`,
              ) +
              guideLine(
                g.axis,
                g.position,
                `class="guide-hit ${a.locked || g.locked ? 'locked' : ''}" data-guide="${g.id}" data-axis="${g.axis}"`,
              ),
          )
          .join('')
      : '') +
    layoutOverlay() +
    snapMatches
      .map((m) =>
        guideLine(m.axis ? 'y' : 'x', m.position, `class="snap-match" data-snap-kind="${m.kind}"`),
      )
      .join('')
  );
}
function transformControls(n) {
  return n.type === 'Transform'
    ? '<p class="font-note">Shared parent: connect child paths through Join Geometry, then this Transform, then Fill / Stroke. Anchor is the scale/rotation pivot in input coordinates; offset moves the result. Select only this Transform: drag its square to scale uniformly, circle to rotate (Shift: 15°), or the Move node stage marker to move the group. Pivot stays Anchor + Offset; child parameters stay unchanged. The dashed outline and controls edit this selected Transform output, before downstream nodes. They may differ from final artwork. Gray controls are read-only.</p>'
    : '';
}
function positionControllerControls(n) {
  if (n.type === 'Vector')
    return `<div class="field"><label>Canvas position handle <input type="checkbox" data-vector-position-handle="${n.id}" aria-label="Canvas position handle" ${n.canvasPositionHandle === true ? 'checked' : ''} ${current().locked ? 'disabled' : ''}></label></div><p class="font-note">Optional: interpret Value XY as an artwork position for canvas editing. Off by default for direction, size or offset vectors. When on, select this node and drag its diamond; Alt bypasses snapping. The handle changes Value directly, before downstream Transform, and never exports. Output stays Vector2. Connected, expression-driven or locked Value is read-only on canvas.</p>`;
  return n.type === 'Null'
    ? '<p class="font-note">Position-only controller. Select this node and drag its crosshair; Alt bypasses snapping. Only the selected Null is shown, and the marker never exports. Connect Position OUT to Text, shape Position, or Vector Math. Coordinates are before downstream Transform. Connected, expression-driven or locked Position is read-only on canvas.</p>'
    : '';
}
// Only dedicated Nulls and explicitly opted-in Vectors are canvas positions.
// Both edit the same parameter shown in numeric fields; no separate point state.
function positionController(n) {
  if (n?.type === 'Null') return { key: 'position', kind: 'null', label: 'Position' };
  if (n?.type === 'Vector' && n.canvasPositionHandle === true)
    return { key: 'value', kind: 'vector', label: 'Value as canvas position' };
  return null;
}
function radialControls(n) {
  return ['Polygon', 'Star'].includes(n.type)
    ? '<p class="font-note">Closed straight-edge path. Count: 3–256. Radii: >0 to 100000 px; inner ≤ outer. Rotation: clockwise degrees from the top vertex. Count changes suspend existing vertex edits.</p>'
    : '';
}
function canvasScale() {
  const ctm = document.querySelector('.artboard')?.getScreenCTM();
  return Math.hypot(ctm?.a ?? 1, ctm?.b ?? 0) || 1;
}
function snapped(sources, delta, event, excludedGuide = null) {
  const result = snapTranslation(
    history.doc,
    sources,
    delta,
    canvasScale(),
    event.altKey,
    excludedGuide,
    snapLayerBounds.guides,
    snapLayerBounds.artwork,
  );
  snapMatches = result.matches;
  return result.delta;
}
// Apply the constraint before snapping and suppress every forbidden-axis target.
// Character drags call this before their inverse output-transform conversion.
function artworkDelta(sources, delta, event) {
  const constraint = constrainAxisDrag(
    drag,
    delta,
    [event.clientX - drag.startClient[0], event.clientY - drag.startClient[1]],
    event.shiftKey,
  );
  const allowed = sources.map((values, axis) =>
    constraint.pending || (constraint.axis !== null && constraint.axis !== axis) ? [] : values,
  );
  return snapped(allowed, constraint.delta, event);
}
const artworkDrag = () =>
  ['character', 'position-controller', 'shape', 'point', 'remap', 'artwork'].includes(drag?.type);
function captureArtworkPointer(event, capture) {
  drag.startClient = [event.clientX, event.clientY];
  drag.pointerId = event.pointerId;
  drag.capture = capture;
  capture.setPointerCapture?.(event.pointerId);
}
// Character position is a source edit, with an explicit final-output occurrence.
function characterContext(result = renderEvaluation) {
  const n = selectedNode();
  if (
    !characterEdit ||
    n?.id !== characterEdit.node ||
    current().id !== characterEdit.layer ||
    n.type !== 'Text'
  )
    return null;
  let typographyCharacters = [],
    typographyReason = null;
  try {
    const ids = new Set(characterIdsInRange(n.text, n.characterPositions, 0, n.text.length));
    const fresh = createCharacterPositions(n.text),
      record = n.characterPositions?.basis === fresh.basis ? n.characterPositions : fresh;
    const defaults = result.textDefaults(n.id);
    typographyCharacters = record.units
      .map((unit, sourceIndex) => ({
        id: unit.id,
        text: unit.text,
        sourceIndex,
        whitespace: /^\s$/.test(unit.text),
        ...defaults,
        ...(record.styles?.[unit.id] || {}),
      }))
      .filter((unit) => ids.has(unit.id));
    characterEdit.selected = new Set([...characterEdit.selected].filter((id) => ids.has(id)));
  } catch (error) {
    typographyReason = error.message;
  }
  const typographySelected = typographyCharacters.filter((unit) =>
    characterEdit.selected.has(unit.id),
  );
  try {
    const layout = result.textLayout(n.id),
      occurrences = characterOccurrences(result.path)
        .filter((o) => o.source === n.id)
        .map((o) => {
          let reason = o.reason;
          try {
            inverseCharacterDelta(o.matrix, [0, 0]);
          } catch (e) {
            reason ||= e.message;
          }
          return { ...o, reason };
        });
    const editable = occurrences.filter((o) => !o.reason);
    if (!characterEdit.route && editable.length === 1) characterEdit.route = editable[0].route;
    if (characterEdit.route && !editable.some((o) => o.route === characterEdit.route))
      characterEdit.route = null;
    return {
      n,
      typographyCharacters,
      typographySelected,
      typographyReason,
      layout,
      occurrences,
      editable,
      occurrence: editable.find((o) => o.route === characterEdit.route),
      selected: layout.characters.filter((g) => characterEdit.selected.has(g.id)),
    };
  } catch (e) {
    return {
      n,
      typographyCharacters,
      typographySelected,
      typographyReason,
      layout: { characters: [], reason: e.message },
      occurrences: [],
      editable: [],
      selected: [],
    };
  }
}
function characterFields(context, floating = false) {
  const disabled = current().locked || !context.selected.length || !!context.layout.reason;
  return `<div class="character-values">${['X', 'Y']
    .map((axis, i) => {
      const values = context.selected.map((g) => g.offset[i]),
        mixed = values.some((v) => v !== values[0]);
      return `<label>Δ${axis}<input type="number" step="any" min="-100000" max="100000" data-scrub-step="1" title="Drag horizontally to adjust; click to type" data-character-axis="${i}" aria-label="${floating ? 'Floating ' : ''}Character delta ${axis}" placeholder="${mixed ? 'Mixed' : '0'}" value="${mixed ? '' : (values[0] ?? 0)}" ${disabled ? 'disabled' : ''}></label>`;
    })
    .join(
      '',
    )}<button data-character-reset="selected" ${disabled ? 'disabled' : ''} title="Reset selected XY offsets only">Reset XY</button></div><div class="character-values character-shape-values">${[
    ['rotation', 'Rotate °', -36000, 36000, 0],
    ['scale', 'Scale ×', 0.01, 100, 1],
  ]
    .map(([key, label, min, max, fallback]) => {
      const values = context.selected.map((g) => g[key]),
        mixed = values.some((v) => v !== values[0]);
      return `<label>${label}<input type="number" step="${key === 'scale' ? '0.01' : '1'}" min="${min}" max="${max}" data-scrub-step="${key === 'scale' ? 0.01 : 1}" title="Drag horizontally to adjust; click to type" data-character-transform="${key}" aria-label="${floating ? 'Floating ' : ''}Character ${key}" placeholder="${mixed ? 'Mixed' : fallback}" value="${mixed ? '' : (values[0] ?? fallback)}" ${disabled ? 'disabled' : ''}></label>`;
    })
    .join(
      '',
    )}<button data-character-shape-reset ${disabled ? 'disabled' : ''} title="Reset selected rotation and scale only">Reset shape</button></div>`;
}
function initialManualLeading(n) {
  let distance;
  try {
    distance = renderEvaluation.textLayout(n.id)?.lineOffsets?.[1];
  } catch {
    // Missing font coverage must not prevent editing layout defaults.
  }
  if (!Number.isFinite(distance)) {
    const defaults = renderEvaluation.textDefaults(n.id);
    distance = defaults.size * defaults.lineSpacing;
  }
  return Math.min(100000, Math.max(0.01, distance));
}
function wrapControls(n) {
  const disabled = current().locked ? 'disabled' : '';
  return `<section class="text-wrap-controls" aria-label="Wrap width"><label>Horizontal line composition<select data-text-wrap="${n.id}" aria-label="Text wrap mode" ${disabled}><option value="off" ${n.textWrap ? '' : 'selected'}>Off · explicit newlines</option><option value="width" ${n.textWrap ? 'selected' : ''}>Wrap width · auto height</option></select></label>${n.textWrap ? `<label>Wrap width px<input type="number" step="any" min="0.01" max="100000" data-scrub-step="1" title="Drag horizontally to adjust; click to type" data-text-wrap-width="${n.id}" aria-label="Text wrap width" value="${n.textWrap.width}" ${disabled}></label>` : ''}<p class="font-note">Horizontal text only; detach Type on Path first. Width reflows whole Latin words and a bounded Japanese punctuation subset. Height grows automatically. Long unbreakable spans overflow visibly and export intact. Position stays fixed; no clipping or font scaling.</p></section>`;
}
function leadingControls(n) {
  const mode = n.leading?.mode || 'legacy';
  return `<div class="text-leading-controls"><label>Line / column leading<select data-text-leading="${n.id}" aria-label="Text leading mode" ${current().locked ? 'disabled' : ''}>${[
    ['legacy', 'Legacy spacing'],
    ['auto', 'Auto · font metrics'],
    ['manual', 'Manual · exact px'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${mode === value ? 'selected' : ''}>${label}</option>`,
    )
    .join(
      '',
    )}</select></label>${mode === 'manual' ? `<label>Baseline / column distance px<input type="number" step="any" min="0.01" max="100000" data-scrub-step="1" title="Drag horizontally to adjust; click to type" data-text-leading-value="${n.id}" aria-label="Text manual leading" value="${n.leading.value}" ${current().locked ? 'disabled' : ''}></label>` : ''}<p class="font-note">Auto uses adjacent font metrics and lineSpacing. Manual sets the exact baseline or column distance and can overlap. This is not paragraph spacing.</p></div>`;
}
function pairContext(context = characterContext()) {
  if (!context || context.typographyReason || context.layout.reason) return null;
  const rows = context.typographySelected;
  try {
    const ids = rows.map((g) => g.id),
      key = characterPairFromIds(context.n.text, context.n.characterPositions, ids),
      evaluated = context.layout.pairKerning?.[key];
    if (!evaluated) return null;
    const line = (index) =>
      context.layout.lines?.findIndex((l) => index >= l.sourceStart && index < l.sourceEnd);
    return {
      ...evaluated,
      key,
      ids,
      rows,
      dormant: line(rows[0].sourceIndex) !== line(rows[1].sourceIndex),
    };
  } catch {
    return null;
  }
}
function matchesPairInput(input, context, pair) {
  return (
    pair &&
    context.n.id === input.dataset.kerningNode &&
    JSON.stringify(context.n.text) === input.dataset.kerningText &&
    pair.key === input.dataset.characterKerning
  );
}
function pairKerningControls(context) {
  const pair = pairContext(context),
    disabled = current().locked || !pair;
  const shown = pair
    ? pair.rows.map((g) => (g.whitespace ? '[space]' : esc(g.text))).join(' | ')
    : 'Select exactly two adjacent characters';
  return `<section class="pair-kerning" aria-label="Pair kerning"><h4>Pair kerning</h4><p>${shown}${pair ? ` · source ${pair.rows.map((g) => g.sourceIndex + 1).join(', ')} · ${pair.manual ? 'Manual' : 'Inherited'}` : ''}</p><label>Pair kerning (1/1000 em)<input type="number" min="-100000" max="100000" step="any" data-scrub-step="1" title="Drag horizontally to adjust; click to type" data-character-kerning="${pair?.key || ''}" data-kerning-node="${esc(context.n.id)}" data-kerning-text="${esc(JSON.stringify(context.n.text))}" aria-label="Pair kerning (1/1000 em)" placeholder="${pair && !pair.manual ? `Inherited (${pair.value})` : ''}" value="${pair?.manual ? pair.value : ''}" ${disabled ? 'disabled' : ''}></label><button data-character-kerning-inherit ${disabled || !pair?.manual ? 'disabled' : ''}>Inherit pair</button>${pair?.dormant ? '<p class="font-note">At a wrap break; applies when these characters share a line.</p>' : ''}<p class="font-note">${pair ? `${Number(pair.value.toFixed(5))} units / ${Number(pair.pixels.toFixed(5))} px. ` : ''}Manual values replace this pair’s font kerning; 0 explicitly removes it. Tracking remains additive. The left character’s font size and inline scale determine the em distance. Use Kerning at cursor above or select exactly two adjacent characters.</p></section>`;
}
function updatePairKerning(target, key, value) {
  const next = setCharacterKerningPairs(target.text, target.characterPositions, { [key]: value });
  if (next !== target.characterPositions) {
    target.characterPositions = next;
    history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 9);
  }
  validate(history.doc);
  const check = evaluate({ ...current(), output: target.id }, fonts, history.doc.imageAssets);
  if (check.error) throw Error(check.error);
  if (check.textLayout(target.id).reason) throw Error(check.textLayout(target.id).reason);
}
function typographyControls(context) {
  const disabled =
    current().locked || !context.typographySelected.length || !!context.typographyReason;
  const values = context.typographySelected.map((g) => g.font);
  const mixed = values.some((v) => v !== values[0]);
  const fontValue = mixed ? '__mixed' : values[0];
  return `<section class="character-typography" aria-label="Selected character typography"><h4>Selected typography</h4>
    <label>Font<select data-character-style="font" aria-label="Selected character font" ${disabled || fontRequest ? 'disabled' : ''}>
    <option value="__mixed" disabled ${mixed ? 'selected' : ''}>Mixed</option><option value="">Inherit default font</option>
    <option value="default" ${fontValue === 'default' ? 'selected' : ''}>DejaVu Sans (Latin)</option>
    ${Object.entries(history.doc.fontAssets || {})
      .map(
        ([id, asset]) =>
          `<option value="${esc(id)}" ${fontValue === id ? 'selected' : ''}>${esc(asset.name)}</option>`,
      )
      .join('')}
    ${desktop && systemFonts.length ? `<optgroup label="Installed Windows fonts">${systemFonts.map(([id, name, reason]) => `<option value="${esc(id)}" ${reason ? 'disabled' : ''}>${esc(name)}${reason ? ` — ${esc(reason)}` : ''}</option>`).join('')}</optgroup>` : ''}</select></label>
    <button class="mini" data-load-character-font="${context.n.id}" ${disabled || fontRequest ? 'disabled' : ''}>Load font for selection…</button>
    <div class="typography-fields">${[
      ['size', 'Font size px', 0.01, 100000, 1],
      ['width', 'Horizontal width %', 1, 1000, 100],
      ['height', 'Vertical scale %', 1, 1000, 100],
      ['tracking', 'Tracking px', -100000, 100000, 1],
      ['baselineShift', 'Baseline shift px', -100000, 100000, 1],
    ]
      .map(([key, label, min, max, factor]) => {
        const vals = context.typographySelected.map((g) => g[key] * factor),
          isMixed = vals.some((v) => v !== vals[0]);
        return `<div class="typography-field"><label>${label}<input type="number" step="any" min="${min}" max="${max}" data-scrub-step="1" title="Drag horizontally to adjust; click to type" data-character-style="${key}" aria-label="Selected character ${key}" placeholder="${isMixed ? 'Mixed' : ''}" value="${isMixed ? '' : (vals[0] ?? '')}" ${disabled ? 'disabled' : ''}></label><button data-character-style-inherit="${key}" ${disabled ? 'disabled' : ''} title="Remove selected ${label} overrides" aria-label="Inherit selected ${key}">Inherit</button></div>`;
      })
      .join(
        '',
      )}</div><button data-character-style-reset ${disabled ? 'disabled' : ''}>Reset selected typography</button>
    <p class="font-note">Width and vertical scale affect screen X and Y independently; the inline scale also reflows advances. Tracking adds px after each selected character except the last in its line; it does not replace pair kerning. Positive baseline shift moves up in horizontal text or right in vertical text, before rotation/shape scale/XY. Auto leading follows the adjusted metrics.</p></section>`;
}
function updateTypography(target, ids, patch, doc = history.doc, layer = current()) {
  target.characterPositions = setCharacterStyles(
    target.text,
    target.characterPositions,
    Object.fromEntries(ids.map((id) => [id, patch])),
  );
  doc.schemaVersion = Math.max(doc.schemaVersion, target.characterPositions?.version >= 4 ? 6 : 5);
  validate(doc);
  const check = evaluate(
    { ...layer, output: target.id },
    resolveFonts(doc, bundledFont ? { default: bundledFont } : {}),
  );
  if (check.error) throw Error(check.error);
  const layout = check.textLayout(target.id);
  if (layout.reason) throw Error(layout.reason);
}
function characterControls(n) {
  if (n.type !== 'Text') return '';
  const context = characterContext();
  return `<section class="character-panel" aria-label="Character position"><div class="character-actions"><button data-character-mode="${n.id}" aria-pressed="${!!context}" ${current().locked ? 'disabled' : ''}>${context ? 'Finish character position' : 'Character position'}</button><button data-edit-text="${n.id}">Edit text</button></div>${
    context
      ? `<p>Click a character, then drag. Shift-click selects several; Shift-drag locks horizontal or vertical. Arrows move 1 px; Shift moves 10 px.</p>${context.layout.reason ? `<p class="warning">${esc(context.layout.reason)}. Undo, restore the prior text, or reset all adjustments.</p>` : ''}${!context.editable.length ? `<p class="warning">${esc(context.occurrences[0]?.reason || 'This Text does not reach the visible Output.')} Local numeric editing remains available when character mapping is valid.</p>` : ''}${context.occurrences.length > 1 ? `<p>Editing shared Text: affects ${context.occurrences.length} displayed instances.</p>` : ''}${
          context.editable.length > 1
            ? `<label>Displayed instance<select data-character-instance aria-label="Character displayed instance"><option value="">Choose an instance</option>${context.editable
                .map(
                  (o, i) =>
                    `<option value="${esc(o.route)}" ${o.route === characterEdit.route ? 'selected' : ''}>Instance ${i + 1} · ${esc(
                      o.route
                        .split('/')
                        .slice(1)
                        .map(
                          (part) =>
                            current().nodes.find((n) => part.startsWith(n.id))?.name || part,
                        )
                        .join(' → ') || 'Text',
                    )}</option>`,
                )
                .join('')}</select></label>`
            : ''
        }<label>Characters <select multiple size="${Math.min(6, Math.max(2, context.typographyCharacters.length))}" data-character-selection aria-label="Select characters">${context.typographyCharacters.map((g) => `<option value="${g.id}" ${characterEdit.selected.has(g.id) ? 'selected' : ''}>${g.sourceIndex + 1} · ${g.whitespace ? '[space]' : esc(g.text)}</option>`).join('')}</select></label><p>${context.typographySelected.length} selected${context.typographySelected.some((g) => g.whitespace) ? ' · Moving a space changes its visual position only. Use letterSpacing/kerning for spacing.' : ''}</p>${typographyControls(context)}${pairKerningControls(context)}${characterFields(context)}<button data-character-reset="all" ${current().locked ? 'disabled' : ''}>Reset all adjustments</button><p class="font-note">Local X points right; Y points down. Rotation (clockwise) and uniform scale use each normal-layout advance-cell center, then XY is added, before downstream Transform. Selected characters receive the same absolute value around their own pivots. These shape controls preserve font size and advance. Position and Position OUT stay fixed.</p>`
      : ''
  }</section>`;
}
function characterFloating() {
  const context = characterContext();
  if (!context?.selected.length || !context.occurrence) return '';
  return `<div class="character-floating" aria-label="Quick character position">${characterFields(context, true)}</div>`;
}
function positionCharacterFloating() {
  const toolbar = document.querySelector('.character-floating'),
    stage = document.querySelector('.canvas-stage'),
    svg = document.querySelector('.artboard'),
    context = characterContext();
  if (!toolbar || !stage || !context?.occurrence || !context.selected.length) return;
  const ctm = svg.getScreenCTM(),
    rect = stage.getBoundingClientRect();
  if (!ctm) return;
  const points = context.selected
    .flatMap((g) => characterBoxPoints(g, context.occurrence.matrix))
    .map((p) => new DOMPoint(...p).matrixTransform(ctm));
  const box = [
    Math.min(...points.map((p) => p.x)) - rect.left,
    Math.min(...points.map((p) => p.y)) - rect.top,
    Math.max(...points.map((p) => p.x)) - rect.left,
    Math.max(...points.map((p) => p.y)) - rect.top,
  ];
  const width = toolbar.offsetWidth || 250,
    height = toolbar.offsetHeight || 44,
    gap = 10;
  const clamp = (v, max) => Math.max(6, Math.min(Math.max(6, max - 6), v));
  const candidates = [
    [box[0], box[1] - height - gap],
    [box[0], box[3] + gap],
    [box[2] + gap, box[1]],
    [box[0] - width - gap, box[1]],
  ].map(([x, y]) => [clamp(x, stage.clientWidth - width), clamp(y, stage.clientHeight - height)]);
  const overlap = ([x, y]) =>
    Math.max(0, Math.min(x + width, box[2]) - Math.max(x, box[0])) *
    Math.max(0, Math.min(y + height, box[3]) - Math.max(y, box[1]));
  candidates.sort((a, b) => overlap(a) - overlap(b));
  // Keep the palette under the pointer while its own numeric input is captured.
  if (!(drag?.type === 'numeric' && drag.started && toolbar.contains(drag.capture))) {
    toolbar.style.left = candidates[0][0] + 'px';
    toolbar.style.top = candidates[0][1] + 'px';
  }
  for (const input of document.querySelectorAll(
    '[data-character-axis], [data-character-transform]',
  ))
    if (input !== document.activeElement && input !== drag?.capture) {
      const property = input.dataset.characterTransform,
        fallback = property === 'scale' ? 1 : 0;
      const values = context.selected.map((g) =>
          property ? g[property] : g.offset[Number(input.dataset.characterAxis)],
        ),
        mixed = values.some((v) => v !== values[0]);
      input.value = mixed ? '' : String(values[0] ?? fallback);
      input.placeholder = mixed ? 'Mixed' : String(fallback);
    }
}
function characterOverlay(result) {
  const context = characterContext(result);
  if (!context || current().locked) return '';
  return context.editable
    .map(
      (o, instance) =>
        `<g class="character-occurrence" data-character-route="${esc(o.route)}" transform="matrix(${o.matrix.join(' ')})">${context.layout.characters
          .map((g) => {
            const [x1, y1, x2, y2] = g.bounds,
              chosen = characterEdit.selected.has(g.id),
              hovered = characterEdit.hover === `${o.route}:${g.id}`;
            return `<rect class="character-hit ${chosen ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${g.whitespace ? 'whitespace' : ''}" data-character="${g.id}" data-character-instance-index="${instance}" x="${x1}" y="${y1}" width="${Math.max(0.01, x2 - x1)}" height="${Math.max(0.01, y2 - y1)}"/><path class="character-outline ${chosen ? 'selected' : ''}" d="${esc(g.path)}"/>${chosen ? `<path class="character-base" data-character-pivot="${g.id}" d="M${g.pivot[0] + g.offset[0] - 3} ${g.pivot[1] + g.offset[1]}h6 M${g.pivot[0] + g.offset[0]} ${g.pivot[1] + g.offset[1] - 3}v6"/>` : ''}`;
          })
          .join('')}</g>`,
    )
    .join('');
}
function writeCharacterChanges(changes) {
  const n = selectedNode();
  if (!n || n.type !== 'Text') throw Error('Select a Text node');
  const next = setCharacterOffsets(n.text, n.characterPositions, changes);
  if (next) {
    n.characterPositions = next;
    history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 3);
  }
}
function chooseCharacter(hit, additive = false) {
  characterEdit.route = hit.occurrence.route;
  if (additive) {
    if (characterEdit.selected.has(hit.glyph.id)) characterEdit.selected.delete(hit.glyph.id);
    else characterEdit.selected.add(hit.glyph.id);
  } else if (!characterEdit.selected.has(hit.glyph.id))
    characterEdit.selected = new Set([hit.glyph.id]);
}
function selectOverlappingCharacters(hits, additive) {
  const dialog = document.createElement('dialog');
  dialog.className = 'character-choice';
  dialog.innerHTML = `<h3>Choose overlapping character</h3><p>Each entry identifies a character and displayed instance.</p>${hits.map((hit, i) => `<button data-choice="${i}">${hit.glyph.sourceIndex + 1} · ${esc(hit.glyph.whitespace ? '[space]' : hit.glyph.text)} · Instance ${hit.instance + 1}</button>`).join('')}<button data-close-choice>Cancel</button>`;
  dialog.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choice !== undefined && characterEdit)
      chooseCharacter(hits[Number(b.dataset.choice)], additive);
    closeEditorDialog(dialog);
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
  });
  dialog.addEventListener('cancel', () => closeEditorDialog(dialog));
  showEditorDialog(dialog);
}

function objectResizeContext(n, result) {
  if (!n || n.pathAttachment || selection.size !== 1 || !selection.has(n.id)) return [];
  try {
    return objectResizeHandles(n.type, result.objectResizeState(n.id), canvasScale());
  } catch {
    return [];
  }
}
function objectResizeOverlay(n, result) {
  const handles = objectResizeContext(n, result);
  if (!handles.length) return '';
  return `<g class="object-resize-overlay" aria-label="Selected ${esc(n.type)} output before downstream nodes">${handles
    .map((h, index) => {
      const q = n.params[h.key],
        readonly = current().locked || q.locked || q.source || q.expression;
      return `<g class="object-resize-control ${readonly ? 'readonly' : ''}" data-object-resize="${index}" data-object-node="${n.id}" style="cursor:${readonly ? 'not-allowed' : h.axis ? 'ns-resize' : 'ew-resize'}" transform="translate(${h.point.join(' ')})"><title>${esc(h.label)} · selected ${esc(n.type)} output before downstream nodes${readonly ? ' · Locked or driven by an input' : ' · Drag to resize; position stays fixed'}</title><g transform="scale(${1 / canvasScale()})"><rect x="-6" y="-6" width="12" height="12"/><text x="12" y="4">${esc(h.label)} · selected ${esc(n.type)}</text></g></g>`;
    })
    .join('')}</g>`;
}

function transformContext(n, result) {
  if (n?.bypassed || n?.type !== 'Transform' || selection.size !== 1 || !selection.has(n.id))
    return null;
  const state = result.transformState(n.id);
  if (!state.input?.contours.some((c) => c.points.length)) return null;
  return {
    state,
    geometry: transformHandleGeometry(state, pathBounds(state.input), canvasScale()),
  };
}
function transformOverlay(n, result) {
  let context;
  try {
    context = transformContext(n, result);
  } catch {
    return '';
  }
  if (!context) return '';
  const { geometry: g } = context;
  const size = 1 / canvasScale();
  return `<g class="transform-overlay" data-transform-stage="${n.id}" aria-label="Selected Transform output before downstream nodes"><line x1="${g.pivot[0]}" y1="${g.pivot[1]}" x2="${g.rotation[0]}" y2="${g.rotation[1]}"/><g transform="translate(${g.pivot.join(' ')})"><g transform="scale(${size})"><path class="transform-pivot" d="M-7 0H7 M0-7V7"/><circle class="transform-pivot" r="3"/><text x="10" y="-12">Selected Transform output</text></g></g>${[
    'scale',
    'rotation',
  ]
    .map((key) => {
      const q = n.params[key],
        readonly = current().locked || q.locked || q.source || q.expression;
      return `<g class="transform-control ${readonly ? 'readonly' : ''}" data-transform-handle="${key}" data-transform-node="${n.id}" transform="translate(${g[key].join(' ')})" aria-label="${esc(n.name)} ${key}${readonly ? ' (read-only)' : ''}"><title>${key === 'scale' ? 'Uniform scale · drag along pivot ray' : 'Rotation · Shift snaps to 15°'}${readonly ? ' · Locked or driven by an input' : ''}</title><g class="transform-marker-size" transform="scale(${size})">${key === 'scale' ? '<rect x="-6" y="-6" width="12" height="12"/>' : '<circle r="7"/>'}<text x="11" y="4">${key === 'scale' ? 'Scale' : 'Rotate'}</text></g></g>`;
    })
    .join('')}</g>`;
}

function canvasOverlay(n, result) {
  if (characterEdit) return characterOverlay(result);
  if (artworkTarget) {
    return [...artworkSelection]
      .map((id) => {
        const l = history.doc.layers.find((l) => l.id === id);
        if (!l || !layerShown(l)) return '';
        const r = id === activeLayer ? result : evaluate(l, fonts, history.doc.imageAssets);
        if (
          !r.path ||
          r.error ||
          (r.path.kind !== 'image' && !r.path.contours.some((c) => c.points.length))
        )
          return '';
        const b = pathBounds(r.path);
        return `<rect class="guide artwork-selection" data-artwork-selection="${esc(id)}" x="${b[0][0]}" y="${b[1][0]}" width="${b[0][2] - b[0][0]}" height="${b[1][2] - b[1][0]}" stroke-dasharray="5 4"/>`;
      })
      .join('');
  }
  if (!n || !layerShown(current()) || n.bypassed) return '';
  let path;
  try {
    path = result.run(n.id);
  } catch {
    return '';
  }
  const controller = positionController(n);
  if (controller) {
    const { key, kind, label } = controller,
      q = n.params[key],
      readonly = current().locked || q.locked || q.source || q.expression;
    return `<g class="position-marker ${kind}-marker ${readonly ? 'readonly' : ''}" data-position-handle="${n.id}" data-${kind}-handle="${n.id}" transform="translate(${path[0]} ${path[1]})" aria-label="${esc(n.name)} ${label} handle${readonly ? ' (read-only)' : ''}"><title>${esc(n.name)} · ${label}${readonly ? ' · Locked or driven by an input' : ' · Drag to move; Alt bypasses snap'}</title><g class="position-marker-size ${kind}-marker-size">${kind === 'vector' ? '<polygon points="0,-12 12,0 0,12 -12,0"/><text x="16" y="-12">Vector XY</text>' : '<circle r="11"/>'}<path d="M-8 0H8 M0-8V8"/></g></g>`;
  }
  if (path?.kind === 'image')
    return (
      `<rect class="guide" x="${path.position[0]}" y="${path.position[1]}" width="${path.size[0]}" height="${path.size[1]}" stroke-dasharray="5 4"/>` +
      nodeStageMoveMarker(n, path)
    );
  if (outputType(n) !== 'Path') return '';
  let out =
    `<path class="node-stage-hit" data-node-stage-move="${n.id}" data-node-stage-layer="${current().id}" d="${esc(pathData(path))}"/><path class="guide" d="${esc(pathData(path))}" stroke-dasharray="5 4"/>` +
    nodeStageMoveMarker(n, path);
  if (['Curve', 'Path Remap'].includes(n.type))
    for (const pt of path.contours.flatMap((c) => c.points)) {
      for (const key of ['handleA', 'handleB']) {
        let handle = pt[key].map((v, i) => v + pt.position[i]);
        out += `<line class="guide" x1="${pt.position[0]}" y1="${pt.position[1]}" x2="${handle[0]}" y2="${handle[1]}"/><circle class="handle" data-point="${pt.id}" data-handle="${key}" cx="${handle[0]}" cy="${handle[1]}" r="4"/>`;
      }
      out += `<circle class="vertex" data-point="${pt.id}" cx="${pt.position[0]}" cy="${pt.position[1]}" r="5"/>`;
    }
  if (n.type === 'Transform') out += transformOverlay(n, result);
  out += objectResizeOverlay(n, result);
  return out;
}
function nodeStageMoveMarker(n, path) {
  if (penDraft || (path.kind !== 'image' && !path.contours?.some((c) => c.points.length)))
    return '';
  if (
    ![
      'Circle',
      'Ellipse',
      'Rectangle',
      'Polygon',
      'Star',
      'Text',
      'Curve',
      'Transform',
      'Image',
    ].includes(n.type)
  )
    return '';
  const b = pathBounds(path),
    x = b[0][1],
    y = b[1][0] - 24 / canvasScale();
  if (![x, y].every(Number.isFinite)) return '';
  return `<g class="node-stage-move" data-node-stage-move="${n.id}" data-node-stage-layer="${current().id}" transform="translate(${x} ${y}) scale(${1 / canvasScale()})" aria-label="Move selected node before downstream nodes"><title>Move selected node before downstream nodes</title><rect x="-10" y="-10" width="20" height="20" rx="3"/><path d="M-6 0H6 M0-6V6"/><text x="14" y="4">Move node stage</text></g>`;
}
let canvasFrame = null;
function updateCanvas(immediate = false) {
  if (immediate) {
    if (canvasFrame !== null) window.cancelAnimationFrame(canvasFrame);
    drawCanvas();
  } else if (canvasFrame === null) canvasFrame = requestAnimationFrame(drawCanvas);
}
function drawCanvas() {
  canvasFrame = null;
  const svg = document.querySelector('.artboard');
  if (!svg) return;
  const l = current();
  if (drag?.before) {
    try {
      assertClosedOffsetChange(
        l,
        drag.before.layers.find((x) => x.id === l.id),
        fonts,
        history.doc.imageAssets,
      );
    } catch (error) {
      cancelInteraction();
      notify(error.message, true);
      return;
    }
  }
  const r = evaluate(l, fonts, history.doc.imageAssets);
  svg.innerHTML =
    gridOverlay() +
    canvasLayers()
      .filter((x) => layerShown(x))
      .map((x) => {
        const value = x === l ? r : evaluate(x, fonts, history.doc.imageAssets);
        return value.path && !value.error ? layerShape(x, value.path) : '';
      })
      .join('') +
    guidesOverlay() +
    canvasOverlay(selectedNode(), r);
  renderEvaluation = r;
  sizePositionHandle();
  positionCharacterFloating();
}
function sizePositionHandle() {
  document
    .querySelector('.position-marker-size')
    ?.setAttribute('transform', `scale(${1 / canvasScale()})`);
}
const CANVAS_LIMITS = [0.00001, 8],
  GRAPH_LIMITS = [0.05, 2];
function zoomLabel(scale) {
  return `${Number((scale * 100).toFixed(scale < 0.01 ? 3 : scale < 0.1 ? 1 : 0))}%`;
}
function updateNavigation() {
  updateLayerDeletionControls();
  for (const [view, value, limits, prefix] of [
    ['canvas', zoom, CANVAS_LIMITS, ''],
    ['graph', graphZoom, GRAPH_LIMITS, 'graph-'],
  ]) {
    const output = document.querySelector(`[data-zoom="${view}"]`);
    if (output) {
      output.textContent = zoomLabel(value);
      output.title = `${view === 'canvas' ? 'Artboard' : 'Node graph'} actual scale · ${limits[0] * 100}–${limits[1] * 100}%`;
    }
    const minus = document.querySelector(`[data-action="${prefix}zoom-out"]`),
      plus = document.querySelector(`[data-action="${prefix}zoom-in"]`);
    if (minus) minus.disabled = value <= limits[0];
    if (plus) plus.disabled = value >= limits[1];
  }
  const fitSelection = document.querySelector('[data-action="graph-fit-selection"]');
  if (fitSelection) {
    fitSelection.disabled = !selection.size;
    fitSelection.title = selection.size
      ? 'Fit selected nodes (Shift+2)'
      : 'Select a node to fit selection';
  }
  for (const [selector, type] of [
    ['.canvas-stage', 'pan'],
    ['.graph-scroll', 'graph-pan'],
  ]) {
    const viewport = document.querySelector(selector);
    viewport?.classList.toggle('pan-ready', space && !navigationBusy());
    viewport?.classList.toggle('panning', drag?.type === type);
  }
}
function fitCanvas() {
  const stage = document.querySelector('.canvas-stage'),
    svg = document.querySelector('.artboard');
  if (!stage || !svg) return;
  // Fit follows viewport resize; manual zoom keeps its real scale and center world point.
  if (canvasFit && stage.clientWidth && stage.clientHeight)
    zoom = fitScale(history.doc, [stage.clientWidth, stage.clientHeight], 35, CANVAS_LIMITS).scale;
  const oldWidth = svg.style.width,
    oldHeight = svg.style.height;
  svg.style.width = history.doc.width * zoom + 'px';
  svg.style.height = history.doc.height * zoom + 'px';
  // Compare CSSOM-normalized values so float serialization cannot turn a pan into a redraw.
  const scaleChanged = svg.style.width !== oldWidth || svg.style.height !== oldHeight;
  svg.style.transform = `translate(${pan[0]}px,${pan[1]}px)`;
  sizePositionHandle();
  positionCharacterFloating();
  updateNavigation();
  // Keep screen-sized handles and their hit targets atomic with the new view scale.
  // Only the SVG changes; graph/input drafts and focus stay intact.
  if (selectedNode() && scaleChanged) updateCanvas(true);
}
function zoomCanvas(next, clientX, clientY) {
  const r = document.querySelector('.artboard').getBoundingClientRect();
  next = Math.max(CANVAS_LIMITS[0], Math.min(CANVAS_LIMITS[1], next));
  const center = [r.left + r.width / 2, r.top + r.height / 2];
  // A toolbar zoom anchors the viewport center, including the stage's unequal padding.
  const anchor =
    clientX === undefined ? pan.map((v) => -v) : [clientX - center[0], clientY - center[1]];
  pan = anchoredPan(pan, anchor, next / zoom);
  canvasFit = false;
  zoom = next;
  fitCanvas();
}
function fitArtboard() {
  canvasFit = true;
  pan = [0, 0];
  fitCanvas();
}
function drawWires() {
  let graph = document.querySelector('.graph'),
    svg = document.querySelector('.wires');
  if (!graph) return;
  let rect = graph.getBoundingClientRect(),
    html = '';
  for (const n of current().nodes)
    for (const [key, q] of parameters(n)) {
      if (!q.source) continue;
      let from = graph.querySelector(
          `[data-source="${q.source}"]${q.sourcePort ? `[data-source-port="${q.sourcePort}"]` : ':not([data-source-port])'}`,
        ),
        to = [...graph.querySelectorAll('.field')]
          .find((el) => el.dataset.node === n.id && el.dataset.key === key)
          ?.querySelector('.input');
      if (!from || !to) continue;
      let a = from.getBoundingClientRect(),
        b = to.getBoundingClientRect(),
        x = (a.x + a.width / 2 - rect.x) / graphZoom,
        y = (a.y + a.height / 2 - rect.y) / graphZoom,
        xx = (b.x + b.width / 2 - rect.x) / graphZoom,
        yy = (b.y + b.height / 2 - rect.y) / graphZoom;
      html += `<path class="wire" d="M${x},${y} C${x + 80},${y} ${xx - 80},${yy} ${xx},${yy}"/>`;
    }
  if (wiring?.pointer) {
    const target = wiring.disconnect && current().nodes.find((n) => n.id === wiring.node);
    const q = target ? parameter(target, wiring.key) : null;
    const source = q?.source || wiring.source,
      port = q?.sourcePort || wiring.port;
    const from = graph.querySelector(
      `[data-source="${source}"]${port ? `[data-source-port="${port}"]` : ':not([data-source-port])'}`,
    );
    if (from) {
      const a = from.getBoundingClientRect(),
        x = (a.x + a.width / 2 - rect.x) / graphZoom,
        y = (a.y + a.height / 2 - rect.y) / graphZoom,
        xx = (wiring.pointer[0] - rect.x) / graphZoom,
        yy = (wiring.pointer[1] - rect.y) / graphZoom;
      html += `<path class="wire wire-preview" d="M${x},${y} C${x + 80},${y} ${xx - 80},${yy} ${xx},${yy}"/>`;
    }
  }
  svg.innerHTML = html;
}
app.addEventListener(
  'scroll',
  (e) => {
    if (wiring && e.target.matches('.graph-scroll')) drawWires();
  },
  true,
);
function updateGraphBounds(requiredScroll = null) {
  const viewport = document.querySelector('.graph-scroll');
  requiredScroll ||= viewport ? [viewport.scrollLeft, viewport.scrollTop] : null;
  const graph = document.querySelector('.graph');
  if (!graph) return;
  const nodes = [...graph.querySelectorAll('.node')];
  graph.style.width =
    Math.max(
      2400,
      requiredScroll
        ? (Math.max(0, requiredScroll[0]) + document.querySelector('.graph-scroll').clientWidth) /
            graphZoom
        : 0,
      ...nodes.map((el) => el.offsetLeft + el.offsetWidth + 80),
    ) + 'px';
  graph.style.height =
    Math.max(
      1600,
      requiredScroll
        ? (Math.max(0, requiredScroll[1]) + document.querySelector('.graph-scroll').clientHeight) /
            graphZoom
        : 0,
      ...nodes.map((el) => el.offsetTop + el.offsetHeight + 100),
    ) + 'px';
}
function freePosition(type) {
  const measurements = {};
  for (const el of document.querySelectorAll('.graph .node'))
    measurements[el.dataset.id] = { width: el.offsetWidth, height: el.offsetHeight };
  return findFreeNodePosition(current().nodes, measurements, {
    width: 264,
    height: type === 'Curve' ? 520 : 260,
  });
}
function revealNode(id) {
  requestAnimationFrame(() =>
    document
      .querySelector(`.node[data-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  );
}
function addNode(type) {
  change(() => {
    const l = current(),
      position = freePosition(type),
      n = node(type, ...position);
    l.nodes.push(n);
    selected = n.id;
    selection = new Set([n.id]);
    artworkTarget = null;
    artworkSelection = new Set();
  }, `Added ${type}`);
  if (selected) revealNode(selected);
}
function deletionBusy() {
  return !!(penDraft || navigationBusy() || nameEdit || document.querySelector('dialog[open]'));
}
function alignmentBusy() {
  return deletionBusy() || tool !== 'select' || space;
}
function updateLayerDeletionControls() {
  const busy = deletionBusy();
  for (const button of document.querySelectorAll(
    '[data-align-artwork], [data-distribute-artwork], [data-distribute-gap]',
  ))
    button.disabled = alignmentBusy() || button.dataset.eligible !== 'true';
  for (const button of document.querySelectorAll('[data-order-layer]')) {
    const target = resolveArtworkOrderTarget(
      history.doc,
      button.dataset.orderLayer,
      button.dataset.orderDirection,
    );
    // Boundary controls stay focusable so a keyboard user keeps the same exact
    // row/direction after a swap. The handler enforces aria-disabled as well.
    button.disabled = busy || (!target.supported && target.code !== 'boundary');
    button.setAttribute('aria-disabled', String(busy || !target.supported));
    button.title = busy
      ? 'Finish or cancel the current edit before ordering a layer'
      : target.supported
        ? `Move this layer ${button.dataset.orderDirection} one paint position (Undo available)`
        : target.reason;
  }
  for (const button of document.querySelectorAll('[data-delete-layer]')) {
    const target = history.doc.layers.find((layer) => layer.id === button.dataset.deleteLayer);
    button.disabled = busy || !target || target.locked;
    button.title = busy
      ? 'Finish or cancel the current edit before deleting a layer'
      : target?.locked
        ? 'Unlock this layer before deleting it'
        : 'Delete this entire layer and its graph (Undo available)';
  }
  for (const button of document.querySelectorAll('[data-duplicate-artwork]')) {
    button.disabled =
      busy ||
      button.dataset.duplicateArtwork !== artworkTarget ||
      button.dataset.duplicateSelection !== JSON.stringify([...artworkSelection]) ||
      button.dataset.eligible !== 'true';
    if (busy) button.title = 'Finish or cancel the current edit before duplicating artwork';
    else button.title = button.dataset.availableTitle;
  }
}
// Keep modal availability tied to editor lifecycle, independent of DOM observers.
function closeEditorDialog(dialog) {
  dialog?.remove();
  updateLayerDeletionControls();
}
function showEditorDialog(dialog) {
  document.body.append(dialog);
  // Native Escape/close clears `open` before this event; explicit buttons remove directly.
  dialog.addEventListener('close', () => closeEditorDialog(dialog));
  dialog.showModal();
  updateLayerDeletionControls();
}
function deleteArtwork(layerId) {
  // Reject before taking a history snapshot or touching any detached draft.
  if (deletionBusy()) return;
  try {
    const target = history.doc.layers.find((layer) => layer.id === layerId);
    if (!target) throw Error('Layer is unavailable; select it again');
    if (target.locked) throw Error('Composition is locked');
    const priorUI = selectionSnapshot(true);
    let deleted;
    history.apply((doc) => {
      deleted = removeArtworkLayer(doc, layerId);
    });
    resetTransient();
    activeLayer = deleted.nextLayerId;
    selected = null;
    artworkTarget = null;
    artworkSelection = new Set();
    selection = new Set();
    tool = 'select';
    selectionHistory.set(history.past.at(-1), priorUI);
    selectionHistory.set(history.doc, selectionSnapshot(true));
    notify(
      deleted.replacedLastLayer ? 'Layer deleted · empty composition retained' : 'Layer deleted',
    );
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
  } catch (error) {
    notify(error.message, true);
  }
}
function duplicateArtwork(layerId, selectionKey) {
  // A stale/forced click must not finish a draft, cancel a gesture, or duplicate
  // whichever layer happens to be active after the original button was rendered.
  if (
    deletionBusy() ||
    !artworkSelection.size ||
    (selectionKey === undefined
      ? artworkSelection.size !== 1
      : selectionKey !== JSON.stringify([...artworkSelection])) ||
    artworkTarget !== layerId ||
    activeLayer !== layerId
  )
    return;
  try {
    const priorUI = selectionSnapshot(true);
    let created;
    history.apply((doc) => {
      created =
        artworkSelection.size === 1
          ? [{ sourceLayerId: layerId, ...duplicateArtworkLayer(doc, layerId, { fonts }) }]
          : duplicateArtworkLayers(doc, artworkSelection, { fonts });
    });
    const nextActive = created.find((copy) => copy.sourceLayerId === layerId).layerId;
    artworkSelection = new Set(created.map((copy) => copy.layerId));
    selectArtwork(nextActive, { preserve: true });
    tool = 'select';
    selectionHistory.set(history.past.at(-1), priorUI);
    selectionHistory.set(history.doc, selectionSnapshot(true));
    notify('Duplicated independent artwork in place');
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
  } catch (error) {
    notify(error.message, true);
  }
}
function alignArtwork(button) {
  // Reject stale or forced controls before the generic click path can finish Pen.
  if (
    !app.contains(button) ||
    alignmentBusy() ||
    button.dataset.alignActive !== activeLayer ||
    button.dataset.alignSelection !== JSON.stringify([...artworkSelection])
  )
    return;
  try {
    const priorUI = selectionSnapshot(true),
      oldPast = history.past.at(-1);
    let changed;
    history.apply((doc) => {
      changed = alignArtworkSelection(doc, artworkSelection, button.dataset.alignArtwork, {
        fonts,
      });
    });
    if (history.past.at(-1) !== oldPast) {
      selectionHistory.set(history.past.at(-1), priorUI);
      selectionHistory.set(history.doc, selectionSnapshot(true));
    }
    notify(changed ? 'Artwork aligned to selection bounds' : 'Artwork already aligned');
    render();
  } catch (error) {
    notify(error.message, true);
  }
}
function distributeArtwork(button) {
  if (
    !app.contains(button) ||
    alignmentBusy() ||
    button.dataset.distributeActive !== activeLayer ||
    button.dataset.distributeSelection !== JSON.stringify([...artworkSelection])
  )
    return;
  try {
    const priorUI = selectionSnapshot(true),
      oldPast = history.past.at(-1);
    const action = button.dataset.distributeArtwork ?? button.dataset.distributeGap;
    let changed;
    history.apply((doc) => {
      const distribute =
        button.dataset.distributeGap !== undefined
          ? distributeArtworkGaps
          : distributeArtworkSelection;
      changed = distribute(doc, artworkSelection, action, {
        fonts,
      });
    });
    if (history.past.at(-1) !== oldPast) {
      selectionHistory.set(history.past.at(-1), priorUI);
      selectionHistory.set(history.doc, selectionSnapshot(true));
    }
    const subject = button.dataset.distributeGap !== undefined ? 'gaps' : 'centers';
    notify(
      changed
        ? `Artwork ${subject} distributed equally`
        : `Artwork ${subject} already equally spaced`,
    );
    render();
  } catch (error) {
    notify(error.message, true);
  }
}
function orderArtwork(layerId, direction) {
  // This guard runs before the generic click handler can auto-finish a Pen
  // draft. Resolve the exact ID afresh even for a stale/forced DOM event.
  if (deletionBusy()) return;
  const target = resolveArtworkOrderTarget(history.doc, layerId, direction);
  if (!target.supported) return;
  const priorUI = selectionSnapshot(true);
  history.apply((doc) => moveArtworkLayer(doc, layerId, direction));
  selectionHistory.set(history.past.at(-1), priorUI);
  selectionHistory.set(history.doc, selectionSnapshot(true));
  notify(`Layer moved ${direction} one position`);
  render();
}
function createArtwork(type) {
  try {
    let created;
    const priorUI = selectionSnapshot();
    history.apply((doc) => {
      created = appendArtwork(doc, type, { at: [doc.width / 2, doc.height / 2] });
    });
    selectArtwork(created.layerId);
    selectionHistory.set(history.past.at(-1), priorUI);
    selectionHistory.set(history.doc, selectionSnapshot());
    notify(`Added independent ${type} artwork`);
    render();
    revealNode(created.nodeId);
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
  } catch (error) {
    notify(error.message, true);
  }
}
// Pen previews stay detached from history.doc. Only Finish appends a layer.
function restorePenSelection(state) {
  ({ activeLayer, selected, artworkTarget } = state);
  artworkSelection = new Set(state.artworkSelection);
  selection = new Set(state.selection);
}
function releasePenPointer() {
  if (drag?.type !== 'pen') return;
  const old = drag;
  drag = null;
  if (old.capture?.hasPointerCapture?.(old.pointerId))
    old.capture.releasePointerCapture(old.pointerId);
  pointerActive = false;
  snapMatches = [];
}
function discardPenDraft() {
  if (!penDraft) return;
  releasePenPointer();
  const prior = penDraft.priorUI;
  penDraft = null;
  penId = null;
  restorePenSelection(prior);
}
function finishPenDraft(closed = false, redraw = true) {
  // A key or tool change during a pressed point never commits its partial handles.
  if (drag?.type === 'pen') cancelInteraction();
  const draft = penDraft;
  if (!draft) return true;
  const curve = draft.layer.nodes[0];
  if (curve.points.length < 2) {
    discardPenDraft();
    tool = 'select';
    notify('One-point draft discarded; a path needs two points');
  } else {
    curve.params.closed.value = closed;
    try {
      let created;
      history.apply((doc) => {
        created = appendPenArtwork(doc, draft.layer);
      });
      penDraft = null;
      penId = null;
      tool = 'select';
      selectArtwork(created.layerId);
      selectionHistory.set(history.past.at(-1), draft.priorUI);
      selectionHistory.set(history.doc, selectionSnapshot());
      notify(`Added independent ${closed ? 'closed' : 'open'} Curve artwork`);
    } catch (error) {
      curve.params.closed.value = false;
      notify(error.message, true);
      if (redraw) render();
      return false;
    }
  }
  if (redraw) {
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
  }
  return true;
}

function confirmReplace() {
  return (
    serialize(history.doc) === savedSnapshot ||
    confirm(
      'Replace this document with unsaved changes? Cancel and Save JSON first to keep a file copy. Open/import can also be undone.',
    )
  );
}
function download(text, name, type) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
app.addEventListener('click', async (e) => {
  let b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.distributeArtwork !== undefined || d.distributeGap !== undefined) {
    distributeArtwork(b);
    return;
  }
  if (d.alignArtwork !== undefined) {
    alignArtwork(b);
    return;
  }
  if (d.orderLayer !== undefined) {
    orderArtwork(d.orderLayer, d.orderDirection);
    return;
  }
  if (d.duplicateArtwork !== undefined) {
    if (app.contains(b)) duplicateArtwork(d.duplicateArtwork, d.duplicateSelection);
    return;
  }
  // Layer deletion must never auto-finish a Pen draft or cancel a live gesture.
  if (d.deleteLayer !== undefined) {
    deleteArtwork(d.deleteLayer);
    return;
  }
  // A cancelled New must not finish, discard or otherwise mutate a live Pen draft.
  if (
    d.action === 'new' &&
    !confirm('Start a new document? Save your current JSON first to keep it.')
  )
    return;
  if (d.penCancel !== undefined) {
    discardPenDraft();
    tool = 'select';
    notify('Draft path cancelled');
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (d.penFinish !== undefined) {
    finishPenDraft();
    return;
  }
  if (penDraft && d.action === 'undo') {
    discardPenDraft();
    notify('Draft path cancelled');
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  const viewAction = /^(zoom-|graph-|fit$|actual-size$|help$)/.test(d.action || '');
  if (penDraft && !viewAction && !b.closest('[inert]') && !finishPenDraft()) return;
  if (b.closest('[inert]')) return;
  const n = selectedNode();
  if (d.bypass) {
    cancelInteraction();
    change(() => {
      const target = current().nodes.find((n) => n.id === d.bypass);
      setNodeBypassed(current(), d.bypass, !target.bypassed);
      history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 10);
      validate(history.doc);
    }, 'Node bypass updated; settings and connections retained');
    return;
  }
  if (d.styleTextRange || d.kernTextCursor) {
    const id = d.styleTextRange || d.kernTextCursor,
      el = b.closest('.text-controls')?.querySelector(`[data-text="${id}"]`),
      sourceNode = current().nodes.find((node) => node.id === id);
    const range =
      (el && textRanges.get(textRangeKey(el))) ||
      (el && { raw: el.value, start: el.selectionStart, end: el.selectionEnd });
    if (!el || !range || !sourceNode || current().locked) return;
    if (textDrafts.get(id)?.composition) {
      notify('Finish or cancel text composition first', true);
      return;
    }
    const draft = textDrafts.get(id);
    if (el.value !== sourceNode.text || (draft && draft.record !== sourceNode.characterPositions))
      el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const target = current().nodes.find((node) => node.id === id);
      if (range.raw !== target.text) throw Error('Text changed; select the range again');
      const ids = d.kernTextCursor
        ? characterPairInRange(
            target.text,
            target.characterPositions,
            range.start,
            range.end,
          ).split(':')
        : characterIdsInRange(target.text, target.characterPositions, range.start, range.end);
      if (d.kernTextCursor) {
        const layout = evaluate(current(), fonts, history.doc.imageAssets).textLayout(target.id);
        if (layout.reason) throw Error(layout.reason);
      }
      if (!ids.length) throw Error('Highlight one or more complete characters in Text first');
      artworkTarget = null;
      artworkSelection = new Set();
      selected = target.id;
      selection = new Set([target.id]);
      characterEdit = {
        node: target.id,
        layer: current().id,
        selected: new Set(ids),
        route: null,
        hover: null,
      };
      tool = 'select';
      render();
      document
        .querySelector(
          d.kernTextCursor ? '[data-character-kerning]' : '[data-character-style="font"]',
        )
        ?.focus({ preventScroll: true });
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  if (d.characterKerningInherit !== undefined) {
    const context = characterContext(),
      pair = pairContext(context);
    if (pair) change(() => updatePairKerning(context.n, pair.key, null), 'Pair kerning inherited');
    return;
  }
  if (d.characterStyleReset !== undefined || d.characterStyleInherit !== undefined) {
    const context = characterContext();
    if (!context?.typographySelected.length || context.typographyReason) return;
    const patch = d.characterStyleInherit
      ? { [d.characterStyleInherit]: null }
      : Object.fromEntries(CHARACTER_STYLE_KEYS.map((key) => [key, null]));
    change(
      () => updateTypography(selectedNode(), [...characterEdit.selected], patch),
      'Selected typography reset',
    );
    return;
  }
  if (d.characterMode) {
    cancelInteraction();
    artworkTarget = null;
    artworkSelection = new Set();
    selected = d.characterMode;
    selection = new Set([selected]);
    if (characterEdit?.node === d.characterMode) characterEdit = null;
    else if (!current().locked) {
      characterEdit = {
        node: d.characterMode,
        layer: current().id,
        selected: new Set(),
        route: null,
        hover: null,
      };
      tool = 'select';
    }
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (d.editText) {
    artworkTarget = null;
    artworkSelection = new Set();
    selected = d.editText;
    selection = new Set([selected]);
    characterEdit = null;
    render();
    document
      .querySelector(`.inspector-body [data-text="${d.editText}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (d.characterShapeReset !== undefined) {
    const context = characterContext();
    if (!context?.selected.length || context.layout.reason) return;
    change(() => {
      const target = selectedNode();
      if (target.characterPositions)
        target.characterPositions = resetCharacterTransforms(
          target.text,
          target.characterPositions,
          [...characterEdit.selected],
        );
    }, 'Character shapes reset');
    return;
  }
  if (d.characterReset) {
    change(
      () => {
        const target = selectedNode();
        if (!target || target.type !== 'Text' || !target.characterPositions) return;
        const next =
          d.characterReset === 'all'
            ? resetCharacterAdjustments(target.text, target.characterPositions)
            : resetCharacterOffsets(target.text, target.characterPositions, [
                ...characterEdit.selected,
              ]);
        if (next) {
          target.characterPositions = next;
          history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 3);
        }
      },
      d.characterReset === 'all' ? 'All character adjustments reset' : 'Character XY offsets reset',
    );
    return;
  }
  if (d.layoutCancel !== undefined) {
    layoutDraft = null;
    layoutPreview = false;
    render();
    return;
  }
  if (d.layoutApply !== undefined || d.layoutRemove !== undefined) {
    try {
      history.apply((doc) =>
        setLayoutGrid(doc, d.layoutRemove !== undefined ? null : layoutConfig(), () =>
          uid('guide'),
        ),
      );
      layoutDraft = null;
      layoutPreview = false;
      selectedGuide = null;
      snapMatches = [];
      notify(
        d.layoutRemove !== undefined
          ? 'Layout guides removed; manual guides kept'
          : 'Layout guides generated',
      );
    } catch (e) {
      notify(e.message, true);
    }
    render();
    return;
  }
  if (d.layerGuide) {
    const l = history.doc.layers.find((x) => x.id === d.layerGuide);
    if (l.locked) {
      notify('Composition is locked', true);
      return;
    }
    history.apply(() => {
      l.guide = !l.guide;
    });
    notify(
      l.guide ? 'Guide layer: visible in editor, excluded from SVG' : 'Layer restored to artwork',
    );
    render();
    return;
  }
  if (d.addGuide) {
    editGuides((a) => {
      if (a.locked) throw Error('Guides are locked');
      if (a.guides.length >= 200) throw Error('Maximum 200 guides');
      const g = {
        id: uid('guide'),
        axis: d.addGuide,
        position: history.doc[d.addGuide === 'x' ? 'width' : 'height'] / 2,
        locked: false,
      };
      a.guides.push(g);
      selectedGuide = g.id;
    });
    return;
  }
  if (d.selectGuide) {
    selectedGuide = d.selectGuide;
    render();
    return;
  }
  if (d.lockGuide || d.deleteGuide) {
    editGuides((a) => {
      const g = a.guides.find((g) => g.id === (d.lockGuide || d.deleteGuide));
      if (a.locked || (d.deleteGuide && g.locked)) throw Error('Guide is locked');
      if (d.lockGuide) g.locked = !g.locked;
      else {
        a.guides = a.guides.filter((x) => x !== g);
        if (selectedGuide === g.id) selectedGuide = null;
      }
    });
    return;
  }
  if (d.action) {
    try {
      switch (d.action) {
        case 'undo':
          stepHistory();
          render();
          break;
        case 'redo':
          stepHistory(true);
          render();
          break;
        case 'save': {
          if (saveInFlight) break;
          saveInFlight = true;
          const snapshot = serialize(history.doc);
          try {
            if (await saveFile(snapshot, 'nect-project.json', 'json')) {
              savedSnapshot = snapshot;
              notify(desktop ? 'Project JSON saved' : 'Project JSON download started');
            }
          } finally {
            saveInFlight = false;
          }
          break;
        }
        case 'export':
        case 'export-png': {
          if (exportInFlight) break;
          exportInFlight = true;
          try {
            const svg = exportSVG(history.doc, fonts);
            if (d.action === 'export') {
              if (await saveFile(svg, 'nect-artwork.svg', 'svg'))
                notify('SVG exported · transparent artboard; guides excluded');
            } else {
              const size = pngDimensions(history.doc, pngScale);
              const blob = await rasterizeSVG(svg, size);
              if (await saveFile(blob, 'nect-artwork.png', 'png'))
                notify(`PNG exported · ${size.width} × ${size.height} · transparent background`);
            }
          } finally {
            exportInFlight = false;
          }
          break;
        }
        case 'import-image':
          imagePick = { id: ++imageRequest, before: serialize(history.doc), doc: history.doc };
          document.querySelector('#image-file').value = '';
          document.querySelector('#image-file').click();
          break;
        case 'import-svg':
          if (!confirmReplace()) break;
          document.querySelector('#import-svg-file').click();
          break;
        case 'open':
          if (!confirmReplace()) break;
          if (desktop) {
            const request = ++openRequest,
              before = serialize(history.doc);
            let text = await openFile();
            if (request !== openRequest) break;
            if (serialize(history.doc) !== before)
              throw Error('Document changed while reading; open the file again');
            if (text !== null) {
              const next = deserialize(text);
              await preflightImages(next);
              if (request !== openRequest || serialize(history.doc) !== before)
                throw Error('Document changed while reading; open the file again');
              resetTransient();
              history.apply(() => (history.doc = next));
              activeLayer = next.layers[0].id;
              selected = current().nodes[0]?.id;
              artworkTarget = null;
              artworkSelection = new Set();
              savedSnapshot = serialize(next);
              render(true);
              notify('Project restored');
            }
          } else document.querySelector('#open-file').click();
          break;
        case 'new': {
          const priorUI = selectionSnapshot();
          resetTransient();
          history.apply(() => {
            history.doc = blankDocument();
          });
          activeLayer = history.doc.layers[0].id;
          selected = null;
          artworkTarget = null;
          artworkSelection = new Set();
          selection = new Set();
          tool = 'select';
          selectionHistory.set(history.past.at(-1), priorUI);
          selectionHistory.set(history.doc, selectionSnapshot());
          notify('New blank document · add artwork or graph nodes');
          render(true);
          document.querySelector('.canvas-stage').focus({ preventScroll: true });
          break;
        }
        case 'add-blank-layer': {
          // Changing layer scope must not retain an old layer's drag/wire target.
          cancelInteraction();
          const priorUI = selectionSnapshot();
          let created;
          history.apply((doc) => {
            created = appendBlankComposition(doc);
          });
          activeLayer = created.layerId;
          selected = null;
          artworkTarget = null;
          artworkSelection = new Set();
          selection = new Set();
          tool = 'select';
          selectionHistory.set(history.past.at(-1), priorUI);
          selectionHistory.set(history.doc, selectionSnapshot());
          notify('Added blank composition · Output is empty');
          render(true);
          document.querySelector('.canvas-stage').focus({ preventScroll: true });
          break;
        }
        case 'add-layer':
          history.apply((doc) => {
            let l = layer(`Composition ${doc.layers.length + 1}`);
            doc.layers.push(l);
            activeLayer = l.id;
            selected = l.nodes[0].id;
            artworkTarget = null;
            artworkSelection = new Set();
            selection = new Set([selected]);
          });
          render(true);
          break;
        case 'zoom-in':
        case 'zoom-out':
        case 'actual-size':
          if (!navigationBusy())
            zoomCanvas(
              d.action === 'actual-size' ? 1 : zoom * (d.action === 'zoom-in' ? 1.2 : 1 / 1.2),
            );
          break;
        case 'snap':
          editGuides((aids) => (aids.snap = !aids.snap));
          break;
        case 'guides-panel':
          guidesOpen = !guidesOpen;
          if (!guidesOpen) {
            layoutDraft = null;
            layoutPreview = false;
          }
          render();
          break;
        case 'fit':
          if (!navigationBusy()) fitArtboard();
          break;
        case 'graph-fit':
        case 'graph-fit-selection':
          if (!navigationBusy()) fitGraph(d.action === 'graph-fit-selection');
          break;
        case 'graph-zoom-in':
        case 'graph-zoom-out':
          if (!navigationBusy())
            zoomGraph(graphZoom * (d.action === 'graph-zoom-in' ? 1.2 : 1 / 1.2));
          break;
        case 'graph-reset':
          if (!navigationBusy()) {
            zoomGraph(1);
            document.querySelector('.graph-scroll').scrollTo(0, 0);
          }
          break;
        case 'help': {
          let dialog = document.createElement('dialog');
          dialog.innerHTML =
            '<h3>Nect SVG</h3><p>New creates a blank document; + Blank composition appends an empty vector Output. + Demo composition keeps the explicit starter Boolean example, which also remains the launch-time example. Each layer owns an independent node composition. Toolbar shapes and Text append independent artwork. Canvas or Layers selects final artwork; graph titles select a source node. Drag the node-stage outline/marker for source edits. Blank canvas clears selection. Shift-drag locks horizontal or vertical; release Shift to move freely. Focus the artboard for Arrow: 1 unit, Shift+Arrow: 10; unsupported artwork shows its reason.</p><p>Pen creates independent Curve artwork without replacing existing layers. Click for corners, drag for Bézier handles, and click the first point to close. Enter, Escape or Finish path finishes an open curve. Cancel path discards the detached draft. One-point drafts are discarded on finish. Each finished path is one Undo. Add node → Curve and Use as output remain explicit graph operations.</p><p>Connect paths to Boolean A/B, then through Path Remap, Fill / Stroke, and Output. Save JSON retains all nodes and edits; SVG is the evaluated artwork.</p><p>Ctrl+Z / Ctrl+Shift+Z: Undo / Redo. Focus either view for +/− zoom, Ctrl/Cmd+1 actual size, Shift+1 fit. Artboard: plain wheel pans; Shift+wheel pans horizontally; Ctrl/Cmd+wheel zooms at the pointer. Space + drag or middle drag pans. Fit artboard centers the artboard; 100% is one document unit per CSS pixel.</p><p>Node graph: middle drag, Ctrl/Cmd+Shift+drag or Space+drag pans; Ctrl/Cmd+wheel zooms (5–200%). Ctrl/Cmd+1 restores actual size while the graph is focused. Hold a dragged node near an edge to scroll; right/bottom grow automatically, left/top stop at the origin. Escape cancels a node drag. Fit all frames measured cards; Shift+2 fits selected cards. Reset view restores 100% at the origin. Fitting is limited to 5–200%.</p><button>Close</button>';
          dialog.querySelector('button').onclick = () => closeEditorDialog(dialog);
          showEditorDialog(dialog);
          break;
        }
      }
      // Pointer users can immediately hold Space and drag after clicking a view control.
      // Keyboard activation retains the button so Space keeps its native action.
      if (
        e.detail > 0 &&
        !navigationBusy() &&
        [
          'zoom-in',
          'zoom-out',
          'actual-size',
          'fit',
          'graph-zoom-in',
          'graph-zoom-out',
          'graph-fit',
          'graph-fit-selection',
          'graph-reset',
        ].includes(d.action)
      )
        document
          .querySelector(d.action.startsWith('graph-') ? '.graph-scroll' : '.canvas-stage')
          .focus({ preventScroll: true });
    } catch (err) {
      notify(err.message, true);
    }
    return;
  }
  if (d.loadFont || d.loadCharacterFont) {
    if (current().locked) {
      notify('Composition is locked', true);
      return;
    }
    fontRequest = {
      id: ++fontRequestId,
      layer: current().id,
      node: d.loadFont || d.loadCharacterFont,
      ...(d.loadCharacterFont ? { characters: [...(characterEdit?.selected || [])] } : {}),
      before: serialize(history.doc),
    };
    const input = document.querySelector('#font-file');
    input.dataset.fontRequest = String(fontRequest.id);
    input.value = '';
    input.click();
    return;
  }
  if (d.tool) {
    cancelInteraction();
    characterEdit = null;
    tool = d.tool;
    if (tool === 'pen') {
      penId = null;
      notify('Click the canvas to begin a curve');
      render();
    } else if (tool !== 'select') {
      createArtwork(tool);
      tool = 'select';
      render();
    } else render();
    return;
  }
  if (d.selectLayer) {
    if (
      !e.shiftKey &&
      lastNameClick?.layerId === d.selectLayer &&
      nameClicked(d.selectLayer, null, e)
    )
      return;
    resetTransient();
    selectArtwork(d.selectLayer, { toggle: e.shiftKey });
    render();
    if (!e.shiftKey) nameClicked(d.selectLayer, null, e);
    if (!nameEdit) document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (d.visible || d.layerLock) {
    history.apply((doc) => {
      let id = d.visible || d.layerLock,
        l = doc.layers.find((x) => x.id === id);
      if (d.visible) l.visible = !l.visible;
      if (d.layerLock) l.locked = !l.locked;
    });
    render();
    return;
  }
  if (d.connectMenu !== undefined) {
    let f = b.closest('.field'),
      nn = current().nodes.find((x) => x.id === f.dataset.node),
      q = parameter(nn, f.dataset.key);
    let dialog = document.createElement('dialog');
    dialog.innerHTML = `<h3>Connect ${esc(nn.name)} · ${esc(f.dataset.key)}</h3><p>Choose a ${q.type} source. Disconnect restores the saved value or expression.</p><select aria-label="Input source"><option value="">Disconnected</option>${current()
      .nodes.filter((x) => x.id !== nn.id)
      .flatMap((x) =>
        outputPorts(x)
          .filter((port) => socketCompatible(port.type, q.type))
          .map(
            (port) =>
              `<option value="${esc(port.id ? JSON.stringify([x.id, port.id]) : x.id)}" ${q.source === x.id && q.sourcePort === port.id ? 'selected' : ''}>${esc(x.name + (port.label ? ' ' + port.label : ''))} · ${x.id.slice(-4)}</option>`,
          ),
      )
      .join(
        '',
      )}</select><p><button data-confirm>Apply</button> <button data-cancel>Cancel</button></p>`;
    dialog.querySelector('[data-cancel]').onclick = () => closeEditorDialog(dialog);
    dialog.querySelector('[data-confirm]').onclick = () => {
      const source = dialog.querySelector('select').value;
      const [sourceId, sourcePort] = source.startsWith('[')
        ? JSON.parse(source)
        : [source, undefined];
      change(
        () =>
          source
            ? connect(current(), sourceId, nn.id, f.dataset.key, false, sourcePort)
            : disconnect(nn, f.dataset.key),
        'Connection updated',
      );
      closeEditorDialog(dialog);
    };
    showEditorDialog(dialog);
    return;
  }
  if (d.lock !== undefined || d.fx !== undefined) {
    let f = b.closest('.field'),
      nn = current().nodes.find((x) => x.id === f.dataset.node),
      q = parameter(nn, f.dataset.key);
    change(() => {
      if (d.lock !== undefined) q.locked = !q.locked;
      else {
        if (q.locked) throw Error('Parameter is locked');
        let next = prompt(
          'Expression (Vector2: x; y). Leave blank for direct values.',
          q.expression || '',
        );
        if (next !== null) q.expression = next;
      }
    }, 'Parameter updated');
    return;
  }
  if (d.preview)
    change(() => {
      const l = current(),
        source = l.nodes.find((n) => n.id === d.preview);
      if (outputType(source) === 'Path') {
        const paint = node('Fill', ...freePosition('Fill'));
        paint.params.path.source = source.id;
        l.nodes.push(paint);
        connect(l, paint.id, l.output, 'path');
      } else connect(l, source.id, l.output, 'path');
    }, 'Output connected');
  if (d.collapse)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.collapse);
      nn.collapsed = !nn.collapsed;
    }, 'Node display updated');
  if (d.delete)
    change(() => {
      current().nodes = current().nodes.filter((x) => x.id !== d.delete);
      for (const x of current().nodes)
        for (const [, q] of parameters(x))
          if (q.source === d.delete) {
            delete q.source;
            delete q.sourcePort;
          }
      if (selected === d.delete) selected = null;
    }, 'Node deleted');
  if (d.referenceJump) {
    const ref = current().nodes.find((n) => n.id === d.referenceJump);
    try {
      artworkTarget = null;
      artworkSelection = new Set();
      selected = referenceTarget(current(), ref).id;
      selection = new Set([selected]);
      render();
      revealNode(selected);
    } catch (e) {
      notify(e.message, true);
    }
    return;
  }
  if (d.duplicate)
    change(() => {
      const ids = selection.has(d.duplicate) && selection.size > 1 ? [...selection] : [d.duplicate],
        position =
          ids.length === 1
            ? freePosition(current().nodes.find((n) => n.id === d.duplicate).type)
            : null,
        copies = duplicateNodes(current(), ids);
      if (position) copies[0].position = position;
      artworkTarget = null;
      artworkSelection = new Set();
      selected = copies[0].id;
      selection = new Set(copies.map((n) => n.id));
    }, 'Nodes duplicated');
  if (d.addPoint)
    change(
      () =>
        current()
          .nodes.find((x) => x.id === d.addPoint)
          .points.push(point(400, 300)),
      'Point added',
    );
  if (d.deletePoint)
    change(() => {
      let nn = current().nodes.find((x) => x.id === d.node);
      nn.points = nn.points.filter((x) => x.id !== d.deletePoint);
    }, 'Point removed');
  if (d.clearBatch) {
    remapBatch(d.clearBatch).selected.clear();
    render();
  }
  if (d.applyBatch)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.applyBatch),
        batch = remapBatch(nn.id);
      translateRemapPoints(
        nn,
        evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source),
        [...batch.selected],
        batch.delta,
      );
    }, 'Selected points moved as one edit');
  if (d.rebindRemap)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.node),
        input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
      rebindRemapPoint(nn, input, d.rebindRemap);
    }, 'Retained edit explicitly rebound to the current point');
  if (d.enableRemap)
    change(() => {
      const nn = current().nodes.find((n) => n.id === d.node),
        input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
      enableRemapPoint(nn, input, d.enableRemap);
    }, 'Point Value / Expression / Node Input controls enabled');
  if (d.clearEdits)
    change(
      () => (current().nodes.find((x) => x.id === d.clearEdits).edits = []),
      'Vertex edits cleared',
    );
});
function commitFont(bytes, name, request) {
  if (fontRequest?.id !== request.id) return;
  if (serialize(history.doc) !== request.before || activeLayer !== request.layer)
    throw Error('Document changed while reading; load the font again');
  if (
    request.characters &&
    (characterEdit?.node !== request.node ||
      request.characters.join(',') !== [...(characterEdit?.selected || [])].join(','))
  )
    throw Error('Character selection changed while reading; load the font again');
  const prepared = makeFontAsset(bytes, name, history.doc.fontAssets);
  // Preflight lazy outlines and glyph coverage before touching the active document.
  const candidate = cloneDocument(history.doc);
  candidate.fontAssets = { ...candidate.fontAssets, [prepared.id]: prepared.asset };
  const candidateLayer = candidate.layers.find((l) => l.id === request.layer);
  const candidateText = candidateLayer.nodes.find(
    (n) => n.id === request.node && n.type === 'Text',
  );
  if (!candidateText) throw Error('Text node no longer exists');
  if (request.characters)
    updateTypography(
      candidateText,
      request.characters,
      { font: prepared.id },
      candidate,
      candidateLayer,
    );
  else candidateText.font = prepared.id;
  const preflight = evaluate(
    { ...candidateLayer, output: candidateText.id },
    resolveFonts(candidate, bundledFont ? { default: bundledFont } : {}),
  );
  if (preflight.error) throw Error(preflight.error);
  change(() => {
    const target = current().nodes.find((n) => n.id === request.node && n.type === 'Text');
    if (!target) throw Error('Text node no longer exists');
    history.doc.fontAssets ||= {};
    history.doc.fontAssets[prepared.id] = prepared.asset;
    if (request.characters) updateTypography(target, request.characters, { font: prepared.id });
    else target.font = prepared.id;
    serialize(history.doc); // Enforce the whole-document bound before committing.
  }, `Loaded ${prepared.asset.name} · saved JSON will include this font`);
}
async function loadInstalledFont(id, nodeId, characters) {
  if (!id) return;
  if (current().locked) {
    notify('Composition is locked', true);
    return;
  }
  const entry = systemFonts.find(([key]) => key === id);
  if (!entry || entry[2]) {
    notify('Installed font unavailable', true);
    return;
  }
  const request = (fontRequest = {
    id: ++fontRequestId,
    layer: current().id,
    node: nodeId,
    ...(characters ? { characters } : {}),
    before: serialize(history.doc),
  });
  notify(`Loading ${entry[1]}…`);
  render();
  try {
    const bytes = await readSystemFont(id);
    commitFont(bytes, entry[1], request);
  } catch (err) {
    if (fontRequest?.id === request.id)
      notify(`Font rejected; current document preserved: ${err.message || err}`, true);
  } finally {
    if (fontRequest?.id === request.id) {
      fontRequest = null;
      render();
    }
  }
}
app.addEventListener(
  'cancel',
  (e) => {
    if (e.target.id === 'font-file' && String(fontRequest?.id) === e.target.dataset.fontRequest) {
      fontRequest = null;
      render();
    }
  },
  true,
);
function textDraft(el) {
  const n = current().nodes.find((n) => n.id === el.dataset.text);
  if (!n) return null;
  let draft = textDrafts.get(n.id);
  if (!draft || draft.saved !== n.text || draft.baseRecord !== n.characterPositions) {
    draft = {
      saved: n.text,
      baseRecord: n.characterPositions,
      raw: n.text,
      record: n.characterPositions,
      snapshots: [{ raw: n.text, record: n.characterPositions }],
      cursor: 0,
      capture: null,
      composition: null,
    };
    textDrafts.set(n.id, draft);
  }
  return draft;
}
function stageTextInput(el, transaction) {
  const draft = textDraft(el);
  if (!draft) return;
  const type = transaction?.inputType;
  if (['historyUndo', 'historyRedo'].includes(type)) {
    const index = draft.cursor + (type === 'historyUndo' ? -1 : 1),
      snapshot = draft.snapshots[index];
    if (snapshot?.raw === el.value) {
      draft.cursor = index;
      draft.raw = snapshot.raw;
      draft.record = snapshot.record;
      return;
    }
  }
  if (
    draft.raw === el.value &&
    !(
      transaction?.selectionEnd > transaction?.selectionStart &&
      /^(insertText|insertFromPaste|insertFromDrop|insertReplacementText)$/.test(
        transaction?.inputType || '',
      )
    )
  )
    return;
  const updated = reconcileCharacterEdit(draft.record, {
    previousRaw: draft.raw,
    nextRaw: el.value,
    ...transaction,
  });
  draft.raw = el.value;
  draft.record = updated.record;
  draft.snapshots = draft.snapshots.slice(0, draft.cursor + 1);
  draft.snapshots.push({ raw: draft.raw, record: draft.record });
  draft.cursor++;
  if (draft.snapshots.length > 100) {
    draft.snapshots.shift();
    draft.cursor--;
  }
}
app.addEventListener(
  'select',
  (e) => {
    const el = e.target;
    if (el.matches?.('textarea[data-text]'))
      textRanges.set(textRangeKey(el), {
        raw: el.value,
        start: el.selectionStart,
        end: el.selectionEnd,
      });
  },
  true,
);
app.addEventListener('pointerdown', (e) => {
  if (e.target.closest('[data-style-text-range], [data-kern-text-cursor]')) e.preventDefault();
});
// A refused row action must not blur/commit an inline name or another live edit.
app.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target.closest('[data-order-layer]') && deletionBusy()) e.preventDefault();
  },
  true,
);
app.addEventListener('dblclick', (e) => {
  const title = e.target.closest('[data-rename-node], [data-select-layer]');
  if (title && !nameEdit)
    beginNameEdit(title.dataset.selectLayer || current().id, title.dataset.renameNode || null);
});
app.addEventListener('focusout', (e) => {
  if (e.target.matches('[data-rename-name]') && nameEdit) finishNameEdit(true, true);
});
app.addEventListener('beforeinput', (e) => {
  if (!e.target.matches('textarea[data-text]')) return;
  const el = e.target,
    draft = textDraft(el);
  if (!draft) return;
  draft.capture = {
    previousRaw: el.value,
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd,
    inputType: e.inputType,
    isComposing: e.isComposing,
  };
});
app.addEventListener('input', (e) => {
  if (e.target.matches('[data-rename-name]')) {
    if (nameEdit) nameEdit.value = e.target.value;
    return;
  }
  if (!e.target.matches('textarea[data-text]')) return;
  const draft = textDraft(e.target);
  if (!draft || draft.composition || e.isComposing) return;
  stageTextInput(e.target, draft.capture || { inputType: e.inputType });
  draft.capture = null;
});
app.addEventListener('compositionstart', (e) => {
  if (e.target.matches('[data-rename-name]')) {
    if (nameEdit) nameEdit.composing = true;
    return;
  }
  if (!e.target.matches('textarea[data-text]')) return;
  const el = e.target,
    draft = textDraft(el);
  if (!draft) return;
  draft.composition = {
    previousRaw: el.value,
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd,
  };
});
app.addEventListener('compositionend', (e) => {
  if (e.target.matches('[data-rename-name]')) {
    if (nameEdit) {
      nameEdit.value = e.target.value;
      nameEdit.composing = false;
      if (nameEdit.pendingCommit) finishNameEdit(true, true);
      else if (needsRender) scheduleRender();
    }
    return;
  }
  if (!e.target.matches('textarea[data-text]')) return;
  const draft = textDraft(e.target);
  if (!draft) return;
  const initial = draft.composition;
  draft.composition = null;
  stageTextInput(e.target, {
    ...initial,
    inputType: 'insertCompositionText',
    composition: true,
    isComposing: false,
  });
  draft.capture = null;
  if (draft.pendingCommit) {
    draft.pendingCommit = false;
    e.target.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

app.addEventListener('change', async (e) => {
  let el = e.target,
    d = el.dataset;
  if (penDraft && el.closest('[inert], #add-node')) return;
  if (penDraft && !finishPenDraft()) return;
  if (d.renameName !== undefined) return;
  if (d.text && textDrafts.get(d.text)?.composition) {
    textDrafts.get(d.text).pendingCommit = true;
    return;
  }
  if (drag?.type === 'numeric' && drag.started && el === drag.capture) return;
  if (d.characterInstance !== undefined) {
    if (characterEdit) characterEdit.route = el.value || null;
    render();
    return;
  }
  if (d.characterSelection !== undefined) {
    if (characterEdit)
      characterEdit.selected = new Set([...el.selectedOptions].map((o) => o.value));
    render();
    return;
  }
  if (d.characterKerning !== undefined) {
    const context = characterContext(),
      pair = pairContext(context);
    if (!matchesPairInput(el, context, pair)) return;
    if (!el.value.trim()) {
      notify('Enter a value or choose Inherit pair', true);
      return;
    }
    change(
      () => updatePairKerning(context.n, pair.key, Number(el.value)),
      'Pair kerning updated',
      true,
    );
    // A committed or rejected edit is no longer a draft. In particular, do not
    // let focus restoration carry a rejected path-overflow value into the render.
    const committed = selectedNode().characterPositions?.kerningPairs?.[pair.key];
    el.value = committed === undefined ? '' : String(committed);
    return;
  }
  if (d.characterStyle !== undefined) {
    const context = characterContext(),
      property = d.characterStyle;
    if (
      !context?.typographySelected.length ||
      context.typographyReason ||
      !CHARACTER_STYLE_KEYS.includes(property)
    )
      return;
    if (property === 'font' && el.value.startsWith('system-')) {
      await loadInstalledFont(el.value, context.n.id, [...characterEdit.selected]);
      return;
    }
    let value =
      property === 'font'
        ? el.value || null
        : Number(el.value) / (['width', 'height'].includes(property) ? 100 : 1);
    if (property !== 'font' && !el.value.trim()) {
      notify('Enter a value or choose Inherit', true);
      return;
    }
    change(
      () => updateTypography(selectedNode(), [...characterEdit.selected], { [property]: value }),
      'Selected typography updated',
      true,
    );
    return;
  }
  if (d.characterTransform !== undefined) {
    const context = characterContext(),
      property = d.characterTransform,
      value = Number(el.value);
    if (
      !['rotation', 'scale'].includes(property) ||
      !el.value.trim() ||
      !Number.isFinite(value) ||
      (property === 'rotation' ? Math.abs(value) > 36000 : value < 0.01 || value > 100)
    ) {
      notify('Character rotation: -36000 to 36000 degrees; uniform scale: 0.01 to 100', true);
      return;
    }
    if (context?.selected.length && !context.layout.reason)
      change(
        () => {
          const next = setCharacterTransforms(
            context.n.text,
            context.n.characterPositions,
            Object.fromEntries(
              context.selected.map((g) => [
                g.id,
                { rotation: g.rotation, scale: g.scale, [property]: value },
              ]),
            ),
          );
          if (next) {
            context.n.characterPositions = next;
            if (next.version === 2)
              history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 4);
          }
        },
        'Character shapes updated',
        true,
      );
    return;
  }
  if (d.characterAxis !== undefined) {
    const context = characterContext(),
      value = Number(el.value),
      axis = Number(d.characterAxis);
    if (!el.value.trim() || !Number.isFinite(value) || Math.abs(value) > 100000) {
      notify('Character offset must be between -100000 and 100000 px', true);
      return;
    }
    if (context?.selected.length)
      change(
        () =>
          writeCharacterChanges(
            Object.fromEntries(
              context.selected.map((g) => [g.id, g.offset.map((v, i) => (i === axis ? value : v))]),
            ),
          ),
        'Character positions updated',
        true,
      );
    return;
  }
  if (d.batchPoint) {
    const selected = remapBatch(d.node).selected;
    if (el.checked) selected.add(d.batchPoint);
    else selected.delete(d.batchPoint);
    scheduleRender();
    return;
  }
  if (d.batchAxis !== undefined) {
    const value = Number(el.value);
    if (Number.isFinite(value)) remapBatch(d.node).delta[Number(d.batchAxis)] = value;
    else notify('Expected a finite batch delta', true);
    return;
  }
  if (el.id === 'png-scale') {
    pngScale = Number(el.value);
    render();
    return;
  }
  if (el.id === 'image-file') {
    const file = el.files[0];
    if (!file) {
      imagePick = null;
      return;
    }
    const request = imagePick || {
      id: ++imageRequest,
      before: serialize(history.doc),
      doc: history.doc,
    };
    imagePick = null;
    try {
      const asset = await prepareImage(file);
      if (request.id !== imageRequest) return;
      if (history.doc !== request.doc || serialize(history.doc) !== request.before)
        throw Error('Document changed while reading; import the image again');
      history.apply((doc) => {
        const id = uid('image');
        doc.imageAssets = { ...doc.imageAssets, [id]: asset };
        validateImageAssets(doc.imageAssets);
        const l = layer(asset.name),
          n = node('Image'),
          out = node('Image Output', 380, 40);
        n.asset = id;
        const scale = Math.min(1, doc.width / asset.width, doc.height / asset.height);
        n.params.size.value = [asset.width * scale, asset.height * scale];
        n.params.position.value = [
          (doc.width - n.params.size.value[0]) / 2,
          (doc.height - n.params.size.value[1]) / 2,
        ];
        out.params.path.source = n.id;
        l.nodes = [n, out];
        l.output = out.id;
        doc.layers.push(l);
        validate(doc);
        serialize(doc);
      });
      activeLayer = history.doc.layers.at(-1).id;
      selected = current().nodes[0].id;
      artworkTarget = null;
      artworkSelection = new Set();
      selection = new Set([selected]);
      notify(`Imported ${asset.name} · embedded PNG; JSON keeps the editable image`);
      render(true);
    } catch (err) {
      notify(`Image rejected; current document preserved: ${err.message}`, true);
    }
    return;
  }
  if (d.font && el.value.startsWith('system-')) {
    await loadInstalledFont(el.value, d.font);
    return;
  }
  if (el.id === 'font-file') {
    const file = el.files[0],
      request = fontRequest;
    if (!request || (el.dataset.fontRequest && el.dataset.fontRequest !== String(request.id)))
      return;
    if (!file) {
      fontRequest = null;
      render();
      return;
    }
    try {
      if (file.size > MAX_FONT_BYTES) throw Error('Font exceeds 20 MB');
      if (!/\.(ttf|otf)$/i.test(file.name)) throw Error('Choose a static .ttf or .otf font');
      const bytes = await file.arrayBuffer();
      commitFont(bytes, file.name, request);
    } catch (err) {
      notify(`Font rejected; current document preserved: ${err.message}`, true);
    }
    if (fontRequest?.id === request.id) fontRequest = null;
    render();
    return;
  }
  if (el.id === 'open-file' || el.id === 'import-svg-file') {
    let file = el.files[0];
    if (!file) return;
    try {
      const request = ++openRequest,
        before = serialize(history.doc);
      if (file.size > (el.id === 'open-file' ? MAX_PROJECT_BYTES : 10_000_000))
        throw Error('File exceeds the supported size limit');
      let text = await file.text(),
        next = el.id === 'import-svg-file' ? importSVG(text) : deserialize(text);
      await preflightImages(next);
      if (request !== openRequest) return;
      if (serialize(history.doc) !== before)
        throw Error('Document changed while reading; open the file again');
      resetTransient();
      history.apply(() => {
        history.doc = next;
      });
      activeLayer = next.layers[0].id;
      selected = current().nodes[0]?.id;
      artworkTarget = null;
      artworkSelection = new Set();
      if (el.id === 'open-file') savedSnapshot = serialize(next);
      notify('Project restored');
      render(true);
    } catch (err) {
      notify(`Open rejected; current document preserved: ${err.message}`, true);
    }
    return;
  }
  if (d.layoutField || d.layoutPreview !== undefined) {
    if (d.layoutField)
      layoutDraft = {
        ...layoutConfig(),
        [d.layoutField]: el.value.trim() ? Number(el.value) : NaN,
      };
    else layoutPreview = el.checked;
    if (pointerActive) scheduleRender();
    else render();
    return;
  }
  if (d.guideSetting || d.guidePosition) {
    editGuides((a) => {
      if (d.guideSetting) {
        if (d.guideSetting === 'gridSize') {
          const value = Number(el.value);
          if (!el.value.trim() || !Number.isFinite(value) || value < 1 || value > 10000)
            throw Error('Grid spacing must be between 1 and 10000');
          a.gridSize = value;
        } else a[d.guideSetting] = el.checked;
      } else {
        const g = a.guides.find((g) => g.id === d.guidePosition),
          value = Number(el.value);
        if (a.locked || g.locked) throw Error('Guide is locked');
        if (!el.value.trim() || !Number.isFinite(value) || Math.abs(value) > 100000)
          throw Error('Guide position must be between -100000 and 100000');
        g.position = value;
      }
    });
    return;
  }
  if (el.id === 'add-node') {
    if (el.value) addNode(el.value);
    return;
  }
  change(
    () => {
      if (d.referenceTarget) {
        const target = el.value ? JSON.parse(el.value) : null;
        setReference(
          current(),
          d.referenceTarget,
          target ? { nodeId: target[0], portId: target[1] } : null,
        );
      } else if (d.vectorPositionHandle) {
        const n = current().nodes.find((n) => n.id === d.vectorPositionHandle);
        if (n?.type !== 'Vector') throw Error('Canvas position handle needs a Vector');
        n.canvasPositionHandle = el.checked;
      } else if (d.operation) setOperation(current(), d.operation, el.value);
      else if (d.strokeCap || d.strokeJoin || d.strokeDash) {
        const n = current().nodes.find(
          (n) => n.id === (d.strokeCap || d.strokeJoin || d.strokeDash),
        );
        if (d.strokeCap) n.strokeCap = el.value;
        else if (d.strokeJoin) n.strokeJoin = el.value;
        else n.strokeDash = parseStrokeDash(el.value);
        validateStrokeStyle(n);
      } else if (d.text) {
        const n = current().nodes.find((n) => n.id === d.text),
          draft = textDrafts.get(n.id);
        const record =
          draft &&
          draft.saved === n.text &&
          draft.baseRecord === n.characterPositions &&
          draft.raw === el.value
            ? draft.record
            : reconcileCharacterEdit(n.characterPositions, {
                previousRaw: n.text,
                nextRaw: el.value,
              }).record;
        n.text = el.value;
        if (record) n.characterPositions = record;
        else delete n.characterPositions;
        textDrafts.delete(n.id);
      } else if (d.textPath || d.textPathMode || d.textPathStart || d.textPathReversed) {
        const id = d.textPath || d.textPathMode || d.textPathStart || d.textPathReversed,
          n = current().nodes.find((n) => n.id === id);
        let attachment = n.pathAttachment ? { ...n.pathAttachment } : null;
        if (d.textPath) {
          if (!el.value) attachment = null;
          else {
            const [nodeId, contourId] = JSON.parse(el.value);
            attachment = {
              nodeId,
              contourId,
              startMode: 'normalized',
              start: { start: 0, center: 0.5, end: 1 }[n.alignment || 'start'],
              reversed: false,
            };
          }
        } else {
          if (!attachment) throw Error('Select a path contour first');
          if (d.textPathMode) {
            const length = evaluate(current(), fonts, history.doc.imageAssets).textLayout(id)
              .attachment.length;
            attachment.start *= el.value === 'normalized' ? 1 / length : length;
            attachment.startMode = el.value;
          }
          if (d.textPathStart) {
            if (!el.value.trim()) throw Error('Enter a finite start anchor');
            attachment.start = Number(el.value);
          }
          if (d.textPathReversed) attachment.reversed = el.checked;
        }
        setTextPathAttachment(current(), id, attachment, fonts, history.doc.imageAssets);
        if (attachment) history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 7);
      } else if (d.textWrap || d.textWrapWidth) {
        const id = d.textWrap || d.textWrapWidth;
        let wrap = null;
        if (d.textWrap) {
          if (!['off', 'width'].includes(el.value)) throw Error('Invalid wrap mode');
          if (el.value === 'width') wrap = { width: 320 };
        } else {
          if (!el.value.trim()) throw Error('Enter a finite wrap width');
          wrap = { width: Number(el.value) };
        }
        setTextWrap(current(), id, wrap, fonts, history.doc.imageAssets);
        if (wrap) history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 8);
        validate(history.doc);
      } else if (d.textLeading || d.textLeadingValue) {
        const n = current().nodes.find((n) => n.id === (d.textLeading || d.textLeadingValue));
        if (d.textLeading) {
          if (el.value === 'legacy') delete n.leading;
          else if (el.value === 'auto') n.leading = { mode: 'auto' };
          else if (el.value === 'manual')
            n.leading = {
              mode: 'manual',
              value: initialManualLeading(n),
            };
          else throw Error('Invalid leading mode');
        } else {
          if (n.leading?.mode !== 'manual' || !el.value.trim())
            throw Error('Enter a manual leading distance');
          n.leading = { mode: 'manual', value: Number(el.value) };
        }
        history.doc.schemaVersion = Math.max(history.doc.schemaVersion, 6);
        validate(history.doc);
      } else if (d.font) current().nodes.find((n) => n.id === d.font).font = el.value;
      else if (d.positionReference)
        current().nodes.find((n) => n.id === d.positionReference).positionReference = el.value;
      else if (d.referenceBounds)
        current().nodes.find((n) => n.id === d.referenceBounds).referenceBounds = el.value;
      else if (d.crossAlignment)
        current().nodes.find((n) => n.id === d.crossAlignment).crossAlignment = el.value;
      else if (d.textAlignment) {
        if (!['start', 'center', 'end'].includes(el.value)) throw Error('Invalid text alignment');
        current().nodes.find((n) => n.id === d.textAlignment).alignment = el.value;
      } else if (d.textKerning)
        current().nodes.find((n) => n.id === d.textKerning).kerning = el.checked;
      else if (d.writingMode)
        current().nodes.find((n) => n.id === d.writingMode).writingMode = el.value;
      else if (d.layerName !== undefined) current().name = el.value;
      else if (d.dimension) {
        let v = Number(el.value);
        if (!(v > 0 && v <= 100000)) throw Error('Artboard dimension must be between 1 and 100000');
        history.doc[d.dimension] = v;
      } else if (d.handleType) {
        let pt = current()
          .nodes.find((n) => n.id === d.node)
          .points.find((p) => p.id === d.handleType);
        if (
          el.value !== 'corner' &&
          (pt.handleA.locked || pt.handleA.source || pt.handleA.expression)
        )
          throw Error('Handle A is locked or driven; unlock before changing coupled handle mode');
        pt.handleType = el.value;
        if (el.value === 'symmetric') pt.handleA.value = pt.handleB.value.map((v) => -v);
        else if (el.value === 'smooth') {
          const length = Math.hypot(...pt.handleA.value),
            mag = Math.hypot(...pt.handleB.value);
          if (mag) pt.handleA.value = pt.handleB.value.map((v) => (-v / mag) * length);
        }
      } else if (d.remap) {
        let nn = current().nodes.find((n) => n.id === d.node),
          input = evaluate(current(), fonts, history.doc.imageAssets).run(nn.params.path.source);
        let edit = nn.edits.find((x) => x.pointId === d.remap);
        if (!edit) {
          edit = {
            pointId: d.remap,
            ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
          };
          nn.edits.push(edit);
        }
        if (!edit[d.component]) edit[d.component] = [0, 0];
        edit[d.component][Number(d.axis)] = Number(el.value);
      } else {
        let f = el.closest('.field');
        if (!f) return;
        let nn = current().nodes.find((n) => n.id === f.dataset.node),
          q = parameter(nn, f.dataset.key);
        if (q.locked) throw Error('Parameter is locked');
        if (d.pathSource !== undefined) {
          if (el.value) connect(current(), el.value, nn.id, f.dataset.key);
          else disconnect(nn, f.dataset.key);
        } else if (d.color !== undefined) {
          if (q.source) throw Error('Disconnect input before editing its fallback');
          const color = { ...(q.value || { hex: current().fill, alpha: 1 }) };
          if (d.color === 'alpha') {
            const alpha = Number(el.value);
            if (el.value === '' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1)
              throw Error('Alpha must be from 0 to 1');
            color.alpha = alpha;
          } else {
            if (!/^#[0-9a-fA-F]{6}$/.test(el.value)) throw Error('Expected color #RRGGBB');
            color.hex = el.value;
          }
          q.value = color;
        } else if (d.expression !== undefined) q.expression = el.value;
        else if (d.value !== undefined) {
          if (q.source) throw Error('Disconnect input before editing its fallback');
          let value = q.type === 'Boolean' ? el.checked : Number(el.value);
          if (
            q.type !== 'Boolean' &&
            (!Number.isFinite(value) ||
              (['Linear Gradient Fill', 'Radial Gradient Fill', 'Closed Path Offset'].includes(
                nn.type,
              ) &&
                !el.value.trim()))
          )
            throw Error('Expected a finite number');
          if (
            nn.type === 'Stroke' &&
            f.dataset.key === 'width' &&
            (el.value === '' || value < 0 || value > 100000)
          )
            throw Error('Stroke width must be from 0 to 100000 px');
          if (
            nn.type === 'Geometry Repeater' &&
            f.dataset.key === 'count' &&
            (!Number.isInteger(value) || value < 1 || value > 256)
          )
            throw Error('Repeater count must be an integer from 1 to 256');
          if (
            nn.type === 'Stroke' &&
            ((f.dataset.key === 'miterLimit' && (value < 1 || value > 10000)) ||
              (f.dataset.key === 'dashOffset' && Math.abs(value) > 100000))
          )
            throw Error('Invalid stroke miter limit or dash offset');
          if (q.type === 'Vector2') q.value[Number(d.axis)] = value;
          else q.value = value;
          if (['Polygon', 'Star'].includes(nn.type))
            radialSettings(nn.type, (key) => nn.params[key].value);
          if (nn.type === 'Linear Gradient Fill')
            linearGradientSettings((key) => nn.params[key].value);
          if (nn.type === 'Radial Gradient Fill')
            radialGradientSettings((key) => nn.params[key].value);
          if (nn.type === 'Closed Path Offset') closedOffsetSettings((key) => nn.params[key].value);
        }
      }
    },
    undefined,
    true,
  );
});
function canvasPoint(event) {
  let svg = document.querySelector('.artboard'),
    pt = new DOMPoint(event.clientX, event.clientY);
  let r = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [r.x, r.y];
}
let space = false;
const editingControl = (target) =>
  target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
function navigationExcluded(target) {
  return editingControl(target) || target.closest?.('.character-floating,.guides-panel,dialog');
}
function navigationBusy() {
  return !!(
    drag ||
    wiring ||
    composing ||
    nameEdit?.composing ||
    [...textDrafts.values()].some((d) => d.composition)
  );
}
app.addEventListener(
  'compositionstart',
  () => {
    composing = true;
    space = false;
    updateNavigation();
  },
  true,
);
app.addEventListener(
  'compositionend',
  () => {
    composing = false;
    updateLayerDeletionControls();
    if (needsRender) scheduleRender();
  },
  true,
);
// Graph navigation stays in screen pixels; document positions remain world coordinates.
let graphFrame = null;
function stopGraphDrag() {
  if (graphFrame !== null) window.cancelAnimationFrame(graphFrame);
  graphFrame = null;
  if (drag?.capture?.hasPointerCapture?.(drag.pointerId))
    drag.capture.releasePointerCapture(drag.pointerId);
}
function captureGraphPointer(e) {
  drag.pointerId = e.pointerId;
  drag.capture = document.querySelector('.graph-scroll');
  drag.capture.focus({ preventScroll: true });
  drag.capture.setPointerCapture?.(e.pointerId);
}
function graphPoint(x, y) {
  const r = document.querySelector('.graph').getBoundingClientRect();
  return [(x - r.x) / graphZoom, (y - r.y) / graphZoom];
}
function moveGraphNodes() {
  if (drag?.type !== 'node' || current().locked) return;
  const point = graphPoint(...drag.pointer);
  // Clamp the group as a unit, preserving relative spacing at the origin.
  const delta = point.map((v, i) =>
    Math.max(v - drag.startWorld[i], -Math.min(...drag.originals.map((o) => o.position[i]))),
  );
  for (const original of drag.originals) {
    const n = current().nodes.find((x) => x.id === original.id);
    n.position = original.position.map((v, i) => v + delta[i]);
    const el = document.querySelector(`.node[data-id="${n.id}"]`);
    el.style.left = n.position[0] + 'px';
    el.style.top = n.position[1] + 'px';
  }
  updateGraphBounds();
  drawWires();
}
function edgeVelocity(value, low, high) {
  const band = Math.min(64, (high - low) / 3);
  if (band <= 0) return 0;
  if (value < low + band) return -720 * Math.min(1, (low + band - value) / band) ** 2;
  if (value > high - band) return 720 * Math.min(1, (value - high + band) / band) ** 2;
  return 0;
}
function graphAutoPan(time) {
  graphFrame = null;
  if (drag?.type !== 'node' || current().locked) return;
  const dt = Math.min(0.05, Math.max(0, (time - (drag.frameTime ?? time)) / 1000));
  drag.frameTime = time;
  const viewport = document.querySelector('.graph-scroll'),
    r = viewport.getBoundingClientRect();
  const vx = edgeVelocity(drag.pointer[0], r.left, r.left + viewport.clientWidth),
    vy = edgeVelocity(drag.pointer[1], r.top, r.top + viewport.clientHeight);
  // Grow ahead of the pointer, including when the node itself is beyond the viewport.
  const graph = document.querySelector('.graph');
  if (vx > 0)
    graph.style.width =
      Math.max(graph.offsetWidth, (viewport.scrollLeft + viewport.clientWidth + 160) / graphZoom) +
      'px';
  if (vy > 0)
    graph.style.height =
      Math.max(graph.offsetHeight, (viewport.scrollTop + viewport.clientHeight + 160) / graphZoom) +
      'px';
  viewport.scrollLeft += vx * dt;
  viewport.scrollTop += vy * dt;
  moveGraphNodes();
  graphFrame = requestAnimationFrame(graphAutoPan);
}
function cancelInteraction() {
  if (drag?.type === 'pen') {
    penDraft.layer.nodes[0].points.pop();
    releasePenPointer();
    if (!penDraft.layer.nodes[0].points.length) discardPenDraft();
    notify(
      penDraft
        ? 'Point cancelled; draft retained. Finish or Cancel path.'
        : 'First point cancelled',
    );
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (!drag && !wiring) return;
  const before = drag?.before;
  const old = drag;
  drag = null;
  if (graphFrame !== null) window.cancelAnimationFrame(graphFrame);
  graphFrame = null;
  if (old?.capture?.hasPointerCapture?.(old.pointerId))
    old.capture.releasePointerCapture(old.pointerId);
  if (before) history.doc = before;
  // Do not let focus restoration retain the cancelled scrub preview as a typed draft.
  if (old?.type === 'numeric' && old.started)
    old.capture.value = old.originalInput ?? String(old.original);
  pointerActive = false;
  snapMatches = [];
  wiring = null;
  render();
}
function zoomGraph(next, clientX, clientY) {
  const viewport = document.querySelector('.graph-scroll'),
    r = viewport.getBoundingClientRect();
  next = Math.max(GRAPH_LIMITS[0], Math.min(GRAPH_LIMITS[1], next));
  const anchor = [
    clientX === undefined ? viewport.clientWidth / 2 : clientX - r.left,
    clientY === undefined ? viewport.clientHeight / 2 : clientY - r.top,
  ];
  const scroll = anchoredScroll(
    [viewport.scrollLeft, viewport.scrollTop],
    anchor,
    next / graphZoom,
  );
  graphZoom = next;
  document.querySelector('.graph').style.zoom = next;
  updateGraphBounds(scroll);
  viewport.scrollLeft = scroll[0];
  viewport.scrollTop = scroll[1];
  updateNavigation();
  drawWires();
}
function fitGraph(selectedOnly = false) {
  const viewport = document.querySelector('.graph-scroll');
  const cards = [...document.querySelectorAll('.graph .node')].filter(
    (el) => !selectedOnly || selection.has(el.dataset.id),
  );
  // Port sockets protrude beyond the card edge; reserve their visible extent too.
  const bounds = unionBounds(
    cards.map((el) => ({
      x: el.offsetLeft - 8,
      y: el.offsetTop - 8,
      width: el.offsetWidth + 16,
      height: el.offsetHeight + 16,
    })),
  );
  if (!bounds) return;
  const fit = fitScale(bounds, [viewport.clientWidth, viewport.clientHeight], 32, GRAPH_LIMITS);
  graphZoom = fit.scale;
  document.querySelector('.graph').style.zoom = graphZoom;
  // CSS zoom scales the graph margin as well as the cards.
  const scroll = [
    (bounds.x + bounds.width / 2 + 16) * graphZoom - viewport.clientWidth / 2,
    (bounds.y + bounds.height / 2 + 16) * graphZoom - viewport.clientHeight / 2,
  ];
  updateGraphBounds(scroll);
  viewport.scrollLeft = Math.max(0, scroll[0]);
  viewport.scrollTop = Math.max(0, scroll[1]);
  updateNavigation();
  drawWires();
  if (fit.limited) notify('Fit limited to 5%: some nodes may remain outside the view');
}
app.addEventListener(
  'wheel',
  (e) => {
    const viewport = e.target.closest('.canvas-stage,.graph-scroll');
    if (!viewport) return;
    // Do not move the view beneath a live edit, including native graph scrolling.
    if (navigationBusy()) {
      e.preventDefault();
      return;
    }
    if (navigationExcluded(e.target)) return;
    const delta = wheelPixels(e, [viewport.clientWidth, viewport.clientHeight]);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-Math.max(-1000, Math.min(1000, delta[1] || delta[0])) * 0.002);
      if (viewport.matches('.canvas-stage')) zoomCanvas(zoom * factor, e.clientX, e.clientY);
      else zoomGraph(graphZoom * factor, e.clientX, e.clientY);
    } else if (viewport.matches('.canvas-stage')) {
      e.preventDefault();
      canvasFit = false;
      pan = pan.map((value, axis) => value - delta[axis]);
      fitCanvas();
    }
  },
  { passive: false },
);
window.addEventListener('blur', () => {
  lastNameClick = null;
  space = false;
  cancelInteraction();
  updateNavigation();
});
app.addEventListener('lostpointercapture', (e) => {
  if (drag?.pointerId === e.pointerId) cancelInteraction();
});

app.addEventListener('pointerdown', (e) => {
  if (drag) return;
  if (penDraft && e.target.closest('[inert]')) return;
  const viewport = e.target.closest('.graph-scroll');
  const control = editingControl(e.target);
  const numeric = e.target.closest('input[type="number"][data-scrub-step]');
  if (numeric && e.button === 0 && !current().locked && !numeric.disabled && !numeric.readOnly) {
    const field = numeric.closest('.field[data-node]'),
      n = field && current().nodes.find((n) => n.id === field.dataset.node),
      q = n && parameter(n, field.dataset.key),
      textTarget = !field && textNumericTarget(numeric),
      rect = numeric.getBoundingClientRect();
    // Leave the native spinner hit area alone. A click elsewhere still focuses/selects text.
    if (
      ((q && !q.locked && !q.source && !q.expression) || textTarget) &&
      (!rect.width || e.clientX < rect.right - 18)
    ) {
      drag = {
        type: 'numeric',
        ...(textTarget || {
          nodeId: n.id,
          key: field.dataset.key,
          axis: Number(numeric.dataset.axis || 0),
          alpha: numeric.dataset.color === 'alpha',
        }),
        layerId: current().id,
        startX: e.clientX,
        pointerId: e.pointerId,
        capture: numeric,
        started: false,
      };
      return;
    }
  }

  if (
    viewport &&
    !control &&
    !navigationBusy() &&
    (e.button === 1 || (e.button === 0 && (space || (e.shiftKey && (e.ctrlKey || e.metaKey)))))
  ) {
    drag = {
      type: 'graph-pan',
      start: [e.clientX, e.clientY],
      scroll: [viewport.scrollLeft, viewport.scrollTop],
    };
    viewport.focus({ preventScroll: true });
    captureGraphPointer(e);
    updateNavigation();
    e.preventDefault();
    return;
  }
  const stage = e.target.closest('.canvas-stage');
  // Floating fields/buttons are UI, never canvas hit targets or navigation gestures.
  if (stage && e.target.closest('.character-floating')) return;
  if (stage && !control && !navigationBusy() && (e.button === 1 || (e.button === 0 && space))) {
    // View navigation takes priority over guides, shapes and Pen, including after zoom.
    canvasFit = false;
    drag = {
      type: 'pan',
      start: [e.clientX, e.clientY],
      original: [...pan],
      pointerId: e.pointerId,
      capture: stage,
    };
    stage.focus({ preventScroll: true });
    stage.setPointerCapture?.(e.pointerId);
    updateNavigation();
    e.preventDefault();
    return;
  }
  if (
    stage &&
    characterEdit &&
    !control &&
    !e.target.closest('.character-floating') &&
    e.button === 0
  ) {
    e.preventDefault();
    if (current().locked || !layerShown(current())) return;
    if ([...textDrafts.values()].some((draft) => draft.composition)) {
      notify('Finish or cancel text composition before selecting characters');
      return;
    }
    // Blur the original control before any structural render so its change commits its draft.
    stage.focus({ preventScroll: true });
    const result = evaluate(current(), fonts, history.doc.imageAssets),
      context = characterContext(result),
      pos = canvasPoint(e);
    if (!context) return;
    const hits = context.editable.flatMap((occurrence, instance) =>
      context.layout.characters
        .filter((g) => hitCharacter(g, occurrence.matrix, pos))
        .map((glyph) => ({ occurrence, glyph, instance })),
    );
    if (!hits.length) {
      characterEdit.selected.clear();
      render();
      document.querySelector('.canvas-stage').focus({ preventScroll: true });
      return;
    }
    const already = hits.filter(
      (h) => h.occurrence.route === characterEdit.route && characterEdit.selected.has(h.glyph.id),
    );
    if (hits.length > 1 && (e.shiftKey || already.length !== 1)) {
      selectOverlappingCharacters(hits, e.shiftKey);
      return;
    }
    const hit = hits.length === 1 ? hits[0] : already[0];
    // A Shift-click still toggles membership. Delay removing a selected character
    // until release, so Shift-drag can move the current selection instead.
    const toggleOnClick = e.shiftKey && characterEdit.selected.has(hit.glyph.id);
    characterEdit.route = hit.occurrence.route;
    if (!toggleOnClick) chooseCharacter(hit, e.shiftKey);
    render();
    const capture = document.querySelector('.canvas-stage');
    capture.focus({ preventScroll: true });
    if (!characterEdit.selected.size) return;
    const next = characterContext(),
      points = next.selected.flatMap((g) => characterBoxPoints(g, hit.occurrence.matrix));
    drag = {
      type: 'character',
      toggleOnClick: toggleOnClick ? hit : null,
      nodeId: next.n.id,
      route: hit.occurrence.route,
      matrix: hit.occurrence.matrix,
      start: pos,
      startClient: [e.clientX, e.clientY],
      originals: next.selected.map((g) => ({ id: g.id, offset: [...g.offset] })),
      anchors: [0, 1].map((axis) => {
        const values = points.map((p) => p[axis]),
          low = Math.min(...values),
          high = Math.max(...values);
        return [low, (low + high) / 2, high];
      }),
      before: cloneDocument(history.doc),
      pointerId: e.pointerId,
      capture,
    };
    capture.setPointerCapture?.(e.pointerId);
    return;
  }
  if (e.button !== 0) {
    if (viewport && control && e.button === 1) e.preventDefault();
    return;
  }
  if (e.target.closest('.output')) {
    const socket = e.target.closest('.output');
    let id = socket.dataset.source,
      port = socket.dataset.sourcePort;
    if (current().locked) return;
    document.querySelector('.graph-scroll').focus({ preventScroll: true });
    wiring = { source: id, port, pointer: [e.clientX, e.clientY], pointerId: e.pointerId };
    let type = outputType(
      current().nodes.find((n) => n.id === id),
      port,
    );
    document.querySelectorAll('.graph .field').forEach((f) =>
      f.classList.toggle(
        'compatible',
        socketCompatible(type, f.dataset.type) &&
          f.dataset.node !== id &&
          !parameter(
            current().nodes.find((n) => n.id === f.dataset.node),
            f.dataset.key,
          )?.locked,
      ),
    );
    updateGraphBounds();
    drawWires();
    e.preventDefault();
    return;
  }
  if (e.target.closest('.input')) {
    let f = e.target.closest('.field');
    const q = parameter(
      current().nodes.find((n) => n.id === f.dataset.node),
      f.dataset.key,
    );
    if (current().locked || q.locked) return;
    document.querySelector('.graph-scroll').focus({ preventScroll: true });
    wiring = {
      disconnect: true,
      node: f.dataset.node,
      key: f.dataset.key,
      pointer: [e.clientX, e.clientY],
      pointerId: e.pointerId,
    };
    drawWires();
    e.preventDefault();
    return;
  }
  if (e.target.closest('.splitter')) {
    drag = { type: 'split', startY: e.clientY, height: graphHeight };
    e.preventDefault();
    return;
  }
  let head = e.target.closest('.node-head');
  if (head && !e.target.closest('button') && !control) {
    artworkTarget = null;
    artworkSelection = new Set();
    selectedGuide = null;
    let id = head.closest('.node').dataset.id;
    if (e.shiftKey) {
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
      selected = selection.has(id) ? id : [...selection][0] || null;
      render();
      return;
    }
    if (!selection.has(id)) selection = new Set([id]);
    selected = id;
    if (current().locked) {
      render();
      return;
    }
    // Commit a focused field before taking the gesture rollback snapshot.
    document.querySelector('.graph-scroll').focus({ preventScroll: true });
    drag = {
      type: 'node',
      nameTarget: e.target.closest('[data-rename-node]') ? id : null,
      started: false,
      pointer: [e.clientX, e.clientY],
      startWorld: graphPoint(e.clientX, e.clientY),
      id,
      start: [e.clientX, e.clientY],
      originals: [...selection].map((id) => ({
        id,
        position: [...current().nodes.find((n) => n.id === id).position],
      })),
      before: cloneDocument(history.doc),
    };
    captureGraphPointer(e);
    document
      .querySelectorAll('.node')
      .forEach((x) => x.classList.toggle('selected', selection.has(x.dataset.id)));
    e.preventDefault();
    return;
  }
  const resized = e.target.closest('.node-resize')?.closest('.node');
  if (resized) {
    if (current().locked) return;
    drag = {
      type: 'resize',
      id: resized.dataset.id,
      startX: e.clientX,
      width: resized.offsetWidth,
      before: cloneDocument(history.doc),
    };
    e.preventDefault();
    return;
  }
  if (!stage || wiring) return;
  const guideId = e.target.dataset.guide;
  if (guideId && tool !== 'pen') {
    selectedGuide = guideId;
    const a = guideSettings(history.doc),
      g = a.guides.find((g) => g.id === guideId);
    if (a.locked || g.locked) {
      notify('Guide is locked');
      render();
      return;
    }
    drag = {
      type: 'guide',
      id: guideId,
      axis: g.axis === 'x' ? 0 : 1,
      original: g.position,
      start: canvasPoint(e),
      before: cloneDocument(history.doc),
    };
    e.preventDefault();
    updateCanvas();
    return;
  }
  selectedGuide = null;
  const dedicated = e.target.closest(
    '[data-object-resize],[data-transform-handle],[data-position-handle],[data-point],[data-node-stage-move]',
  );
  if (tool === 'select' && !dedicated) {
    if (document.querySelector('dialog[open]')) return;
    const layerId = e.target.closest('[data-layer]')?.dataset.layer;
    stage.focus({ preventScroll: true });
    if (!layerId) {
      artworkTarget = null;
      artworkSelection = new Set();
      selected = null;
      selection = new Set();
      render();
      document.querySelector('.canvas-stage').focus({ preventScroll: true });
      return;
    }
    const toggleOnClick = e.shiftKey && artworkTarget && artworkSelection.has(layerId);
    selectArtwork(layerId, { toggle: e.shiftKey && !toggleOnClick, preserve: true });
    const resolved = artworkMove();
    render(false, resolved);
    const capture = document.querySelector('.canvas-stage');
    capture.focus({ preventScroll: true });
    if (!resolved.supported) {
      if (toggleOnClick) {
        selectArtwork(layerId, { toggle: true });
        render();
        document.querySelector('.canvas-stage').focus({ preventScroll: true });
      } else notify(resolved.reason, true);
      return;
    }
    const target = resolved.target,
      bounds = [...artworkSelection].map((id) =>
        pathBounds(
          evaluate(
            history.doc.layers.find((l) => l.id === id),
            fonts,
            history.doc.imageAssets,
          ).path,
        ),
      ),
      b = [0, 1].map((axis) => {
        const min = Math.min(...bounds.map((b) => b[axis][0])),
          max = Math.max(...bounds.map((b) => b[axis][2]));
        return [min, (min + max) / 2, max];
      });
    drag = {
      type: 'artwork',
      target,
      selectionBefore: selectionSnapshot(),
      toggleOnClick: toggleOnClick ? layerId : null,
      start: canvasPoint(e),
      started: false,
      anchors: b.map((axis) => [...axis]),
      before: cloneDocument(history.doc),
    };
    captureArtworkPointer(e, capture);
    e.preventDefault();
    return;
  }
  if (tool === 'pen') {
    let pos = canvasPoint(e);
    // A new independent layer must include the old active layer as a snap target.
    if (!penDraft)
      snapLayerBounds = collectSnapLayerBounds(
        history.doc,
        canvasLayers().map((l) => [l, evaluate(l, fonts, history.doc.imageAssets)]),
        null,
        pathBounds,
      );
    pos = snapped([[pos[0]], [pos[1]]], [0, 0], e).map((v, i) => v + pos[i]);
    if (!pos.every(Number.isFinite)) return;
    if (
      penDraft &&
      e.target.dataset.point === penDraft.layer.nodes[0].points[0]?.id &&
      !e.target.dataset.handle
    ) {
      // The clicked vertex is replaced on finish. Cancel native pointer focus
      // so the newly focused artboard keeps the following keyboard action.
      e.preventDefault();
      finishPenDraft(true);
      return;
    }
    try {
      let pt;
      if (!penDraft) {
        const priorUI = selectionSnapshot(),
          layer = createPenArtworkDraft(history.doc, pos);
        penDraft = { layer, priorUI };
        penId = layer.nodes[0].id;
        activeLayer = layer.id;
        artworkTarget = null;
        artworkSelection = new Set();
        selected = penId;
        selection = new Set([selected]);
        pt = layer.nodes[0].points[0];
      } else {
        const curve = penDraft.layer.nodes[0];
        if (curve.points.length >= 10000) throw Error('Pen paths are limited to 10000 points');
        pt = point(...pos);
        curve.points.push(pt);
      }
      drag = { type: 'pen', pointId: pt.id, nodeId: penId, start: pos, pointerId: e.pointerId };
      render();
      const capture = document.querySelector('.canvas-stage');
      drag.capture = capture;
      capture.focus({ preventScroll: true });
      capture.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      if (penDraft.layer.nodes[0].points.length === 1) revealNode(penId);
      notify('Draft path · Enter / Escape: finish · Cancel path: discard');
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  if (!layerShown(current())) {
    notify('Show the active layer before editing it on the canvas', true);
    return;
  }
  if (current().locked) {
    notify('Composition is locked', true);
    return;
  }
  let pos = canvasPoint(e),
    n = selectedNode();
  const resizeHandle = e.target.closest('[data-object-resize]');
  if (resizeHandle) {
    e.preventDefault();
    stage.focus({ preventScroll: true });
    n = selectedNode();
    if (resizeHandle.dataset.objectNode !== n?.id) return;
    const handles = objectResizeContext(n, evaluate(current(), fonts, history.doc.imageAssets)),
      handle = handles[Number(resizeHandle.dataset.objectResize)],
      q = n.params[handle?.key];
    if (!handle || !q || q.locked || q.source || q.expression) {
      notify('Dimension is locked or driven by an input', true);
      return;
    }
    drag = {
      type: 'object-resize',
      nodeId: n.id,
      handle,
      key: handle.key,
      original: structuredClone(q.value),
      start: canvasPoint(e),
      startClient: [e.clientX, e.clientY],
      before: cloneDocument(history.doc),
      pointerId: e.pointerId,
      capture: stage,
      started: false,
    };
    stage.setPointerCapture?.(e.pointerId);
    return;
  }
  const transformHandle = e.target.closest('[data-transform-handle]');
  if (transformHandle && n?.type === 'Transform') {
    e.preventDefault();
    if (
      selection.size !== 1 ||
      !selection.has(n.id) ||
      transformHandle.dataset.transformNode !== n.id
    )
      return;
    // Commit any focused numeric draft before capturing the gesture state.
    stage.focus({ preventScroll: true });
    n = selectedNode();
    const key = transformHandle.dataset.transformHandle,
      q = n?.params[key];
    if (!['scale', 'rotation'].includes(key) || !q || q.locked || q.source || q.expression) {
      notify(`${key} is locked or driven by an input`, true);
      return;
    }
    try {
      const context = transformContext(n, evaluate(current(), fonts, history.doc.imageAssets));
      if (!context) return;
      const start = canvasPoint(e);
      drag = {
        type: 'transform',
        key,
        nodeId: n.id,
        geometry: context.geometry,
        start,
        startClient: [e.clientX, e.clientY],
        original: q.value,
        angle: rotationHandleAngle(context.geometry.pivot, start),
        angleDelta: 0,
        before: cloneDocument(history.doc),
        pointerId: e.pointerId,
        capture: stage,
        started: false,
      };
      stage.setPointerCapture?.(e.pointerId);
    } catch (err) {
      notify(err.message, true);
    }
    return;
  }
  const controller = positionController(n);
  if (controller) {
    // A dedicated point target never turns a click elsewhere into a controller move.
    if (e.target.closest('[data-position-handle]')?.dataset.positionHandle !== n.id) return;
    const q = n.params[controller.key];
    if (q.locked || q.source || q.expression) {
      notify(`${controller.label} is locked or driven by an input`, true);
      return;
    }
    stage.focus({ preventScroll: true });
    n = selectedNode();
    drag = {
      type: 'position-controller',
      key: controller.key,
      nodeId: n.id,
      start: canvasPoint(e),
      startClient: [e.clientX, e.clientY],
      original: [...n.params[controller.key].value],
      before: cloneDocument(history.doc),
      pointerId: e.pointerId,
      capture: stage,
      started: false,
    };
    stage.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    return;
  }
  stage.focus({ preventScroll: true });
  n = selectedNode();
  if (e.target.dataset.point && n?.type === 'Path Remap') {
    const input = evaluate(current(), fonts, history.doc.imageAssets).run(n.params.path.source),
      pointId = e.target.dataset.point,
      key = e.target.dataset.handle || 'position',
      existing = n.edits.find((e) => e.pointId === pointId);
    if (existing && input.unstable && existing.fingerprint !== input.fingerprint) {
      notify(
        'This edit is suspended. Use Rebind retained edit to this point before dragging.',
        true,
      );
      return;
    }
    if (
      existing?.params?.[key] &&
      (existing.params[key].locked ||
        existing.params[key].source ||
        existing.params[key].expression)
    ) {
      notify(`${key} is locked or driven`, true);
      return;
    }
    const before = cloneDocument(history.doc),
      edit = enableRemapPoint(n, input, pointId);
    drag = {
      type: 'remap',
      nodeId: n.id,
      pointId,
      key,
      start: pos,
      original: clone(edit.params[key].value),
      anchor: (() => {
        const p = evaluate(current(), fonts, history.doc.imageAssets)
          .run(n.id)
          .contours.flatMap((c) => c.points)
          .find((p) => p.id === pointId);
        return key === 'position' ? p.position : p.position.map((v, i) => v + p[key][i]);
      })(),
      before,
    };
    captureArtworkPointer(e, stage);
    const contour = input.contours.find((c) => c.points.some((p) => p.id === pointId));
    for (const key of [`contour-${contour.id}`, `remap-${pointId}`]) {
      const detail = document.querySelector(
        `.node[data-id="${n.id}"] details[data-detail="${key}"]`,
      );
      if (detail) detail.open = true;
    }
    return;
  }
  if (e.target.dataset.point && n?.type === 'Curve') {
    let pt = n.points.find((p) => p.id === e.target.dataset.point),
      key = e.target.dataset.handle || 'position',
      q = pt[key];
    if (q.locked || q.source || q.expression) {
      notify(`${key} is locked or driven by an input`, true);
      return;
    }
    drag = {
      type: 'point',
      nodeId: n.id,
      pointId: pt.id,
      key,
      start: pos,
      original: clone(q.value),
      anchor: (() => {
        const p = evaluate(current(), fonts, history.doc.imageAssets)
          .run(n.id)
          .contours.flatMap((c) => c.points)
          .find((p) => p.id === pt.id);
        return key === 'position' ? p.position : p.position.map((v, i) => v + p[key][i]);
      })(),
      before: cloneDocument(history.doc),
    };
    captureArtworkPointer(e, stage);
    return;
  }
  const stageMove = e.target.closest('[data-node-stage-move]');
  if (
    stageMove?.dataset.nodeStageMove !== selected ||
    stageMove?.dataset.nodeStageLayer !== current().id
  )
    return;
  const generators = current().nodes.filter((n) => selection.has(n.id));
  if (generators.some((n) => n.pathAttachment)) {
    notify(
      'Move the source path, change the start anchor, or use a downstream Transform for attached Text',
      true,
    );
    return;
  }
  if (
    generators.length &&
    !generators.some((n) => n.bypassed) &&
    ((generators.length === 1 && generators[0].type === 'Transform') ||
      generators.every((n) =>
        ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Text', 'Curve', 'Image'].includes(
          n.type,
        ),
      ))
  ) {
    const targets = generators.map((n) => {
      const keys =
        n.type === 'Curve'
          ? n.points.map((p) => `${p.id}.position`)
          : [
              n.type === 'Transform'
                ? 'offset'
                : ['Text', 'Image'].includes(n.type)
                  ? 'position'
                  : 'center',
            ];
      return { nodeId: n.id, keys, original: keys.map((k) => clone(parameter(n, k).value)) };
    });
    if (
      targets.some((t) =>
        t.keys.some((k) => {
          const q = parameter(
            current().nodes.find((n) => n.id === t.nodeId),
            k,
          );
          return q.locked || q.source || q.expression;
        }),
      )
    ) {
      notify('A selected position is locked or driven by an input', true);
      return;
    }
    const bounds = generators.map((g) =>
      pathBounds(evaluate(current(), fonts, history.doc.imageAssets).run(g.id)),
    );
    const anchors = [0, 1].map((axis) => {
      const low = Math.min(...bounds.map((b) => b[axis][0])),
        high = Math.max(...bounds.map((b) => b[axis][2]));
      return [low, (low + high) / 2, high];
    });
    drag = { type: 'shape', targets, anchors, start: pos, before: cloneDocument(history.doc) };
    captureArtworkPointer(e, stage);
  } else notify('Select generators, or one Transform to move its whole group');
});
function movePointer(e) {
  if (characterEdit && !drag && !wiring) {
    const target = e.target.closest?.('[data-character]');
    const route = target?.closest('[data-character-route]')?.dataset.characterRoute;
    characterEdit.hover = target ? `${route}:${target.dataset.character}` : null;
    document
      .querySelectorAll('.character-hit.hovered')
      .forEach((el) => el.classList.remove('hovered'));
    target?.classList.add('hovered');
  }
  if (wiring) {
    if (wiring.pointerId !== undefined && wiring.pointerId !== e.pointerId) return;
    wiring.pointer = [e.clientX, e.clientY];
    drawWires();
    return;
  }
  if (!drag || (drag.pointerId !== undefined && drag.pointerId !== e.pointerId)) return;
  if (artworkDrag())
    drag.lastPointer = {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerId: e.pointerId,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    };
  if (drag.type === 'artwork') {
    const resolved = artworkMove();
    if (!resolved.supported || !sameArtworkMove(resolved.target, drag.target)) {
      cancelInteraction();
      notify(resolved.reason || 'Artwork target changed', true);
      return;
    }
    if (
      !drag.started &&
      Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3
    )
      return;
    const pos = canvasPoint(e),
      delta = artworkDelta(
        drag.anchors,
        pos.map((v, i) => v - drag.start[i]),
        e,
      );
    if (!delta.every(Number.isFinite)) return;
    try {
      writeArtworkMove(drag.target, delta);
    } catch (error) {
      cancelInteraction();
      notify(error.message, true);
      return;
    }
    drag.started = true;
    drag.lastDelta = delta;
    updateCanvas();
    return;
  }
  if (['transform', 'object-resize'].includes(drag.type)) {
    const n = selectedNode(),
      q = n?.params[drag.key];
    if (
      n?.id !== drag.nodeId ||
      n?.bypassed ||
      selection.size !== 1 ||
      current().locked ||
      !layerShown(current()) ||
      !q ||
      q.locked ||
      q.source ||
      q.expression
    ) {
      cancelInteraction();
      return;
    }
    if (
      !drag.started &&
      Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3
    )
      return;
    const pos = canvasPoint(e);
    let next;
    if (drag.type === 'object-resize')
      next = resizedObjectValue(
        drag.original,
        drag.handle,
        pos.map((v, i) => v - drag.start[i]),
      );
    else if (drag.key === 'scale')
      next = scaleFromHandle(
        drag.original,
        drag.geometry,
        pos.map((v, i) => v - drag.start[i]),
      );
    else {
      const angle = rotationHandleAngle(drag.geometry.pivot, pos, 4 / canvasScale());
      if (angle === null) return;
      if (drag.angle !== null) drag.angleDelta += rotationHandleDelta(drag.angle, angle);
      drag.angle = angle;
      next = rotationFromHandle(drag.original, drag.angleDelta, e.shiftKey);
    }
    if (!(Array.isArray(next) ? next.every(Number.isFinite) : Number.isFinite(next))) return;
    q.value = next;
    drag.started = true;
    updateCanvas();
    return;
  }
  if (drag.type === 'position-controller') {
    const n = selectedNode(),
      q = n?.params[drag.key];
    if (
      n?.id !== drag.nodeId ||
      positionController(n)?.key !== drag.key ||
      current().locked ||
      !layerShown(current()) ||
      !q ||
      q.locked ||
      q.source ||
      q.expression
    ) {
      cancelInteraction();
      return;
    }
    if (
      !drag.started &&
      Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3
    )
      return;
    const pos = canvasPoint(e),
      delta = artworkDelta(
        [[drag.original[0]], [drag.original[1]]],
        pos.map((v, i) => v - drag.start[i]),
        e,
      ),
      next = drag.original.map((v, i) => v + delta[i]);
    if (!next.every(Number.isFinite)) return;
    q.value = next;
    drag.started = true;
    updateCanvas();
    return;
  }
  if (drag.type === 'character') {
    if (
      current().locked ||
      !layerShown(current()) ||
      characterEdit?.node !== drag.nodeId ||
      selected !== drag.nodeId
    ) {
      cancelInteraction();
      return;
    }
    if (
      Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3 &&
      !drag.started
    )
      return;
    try {
      const pos = canvasPoint(e),
        displayed = artworkDelta(
          drag.anchors,
          pos.map((v, i) => v - drag.start[i]),
          e,
        ),
        local = inverseCharacterDelta(drag.matrix, displayed);
      writeCharacterChanges(
        Object.fromEntries(drag.originals.map((g) => [g.id, g.offset.map((v, i) => v + local[i])])),
      );
      drag.started = true;
      updateCanvas();
    } catch (error) {
      cancelInteraction();
      notify(error.message, true);
    }
    return;
  }
  if (drag.type === 'numeric') {
    const d = drag,
      dx = e.clientX - d.startX;
    if (!d.started && Math.abs(dx) < 4) return;
    if (
      current().id !== d.layerId ||
      current().locked ||
      !d.capture.isConnected ||
      d.capture.disabled ||
      d.capture.readOnly
    ) {
      cancelInteraction();
      return;
    }
    if (d.textKind) {
      moveTextNumeric(d, e, dx);
      return;
    }
    // Finish any typed draft before taking the drag snapshot. It remains its own edit.
    if (!d.started && d.capture.value !== d.capture.defaultValue) {
      const text = d.capture.value,
        expected = Number(text);
      d.capture.dispatchEvent(new window.Event('change', { bubbles: true }));
      const node = current().nodes.find((n) => n.id === d.nodeId),
        q = parameter(node, d.key),
        actual = d.alpha ? q.value.alpha : q.type === 'Vector2' ? q.value[d.axis] : q.value;
      if (!text.trim() || !Number.isFinite(expected) || actual !== expected) {
        cancelInteraction();
        return;
      }
    }
    const n = current().nodes.find((n) => n.id === d.nodeId),
      q = n && parameter(n, d.key);
    if (!q || current().locked || q.locked || q.source || q.expression) {
      cancelInteraction();
      return;
    }
    if (!d.started) {
      d.before = cloneDocument(history.doc);
      d.original = d.alpha ? q.value.alpha : q.type === 'Vector2' ? q.value[d.axis] : q.value;
      d.started = true;
      d.capture.setPointerCapture?.(e.pointerId);
      d.capture.classList.add('scrubbing');
    }
    e.preventDefault();
    const [min, max] = d.alpha ? [0, 1] : numericLimits(n, d.key),
      step = Number(d.capture.dataset.scrubStep),
      // Subtract the activation threshold so a click with slight jitter never jumps.
      distance = Math.sign(dx) * Math.max(0, Math.abs(dx) - 4),
      value =
        Math.trunc(distance) === 0
          ? d.original
          : Math.max(
              min,
              Math.min(max, Number((d.original + Math.trunc(distance) * step).toPrecision(15))),
            );
    if (!Number.isFinite(value)) return;
    if (n.type === 'Linear Gradient Fill' && q.type === 'Vector2') {
      const candidate = [...q.value];
      candidate[d.axis] = value;
      try {
        linearGradientSettings((key) => (key === d.key ? candidate : n.params[key].value));
      } catch {
        return;
      }
    }
    const previousValue = clone(q.value);
    if (d.alpha) q.value.alpha = value;
    else if (q.type === 'Vector2') q.value[d.axis] = value;
    else q.value = value;
    try {
      if (n.type === 'Radial Gradient Fill') radialGradientSettings((key) => n.params[key].value);
      if (n.type === 'Closed Path Offset') closedOffsetSettings((key) => n.params[key].value);
      assertClosedOffsetChange(
        current(),
        d.before.layers.find((l) => l.id === current().id),
        fonts,
        history.doc.imageAssets,
      );
    } catch (error) {
      q.value = previousValue;
      notify(error.message, true);
      return;
    }
    d.capture.value = String(value);
    updateCanvas();
    return;
  }
  if (drag.type === 'graph-pan') {
    const viewport = document.querySelector('.graph-scroll');
    viewport.scrollLeft = drag.scroll[0] - e.clientX + drag.start[0];
    viewport.scrollTop = drag.scroll[1] - e.clientY + drag.start[1];
    return;
  }
  if (drag.type === 'resize') {
    const width = Math.max(220, Math.min(550, drag.width + (e.clientX - drag.startX) / graphZoom));
    document.querySelector(`.node[data-id="${drag.id}"]`).style.width = width + 'px';
    updateGraphBounds();
    drawWires();
    return;
  }
  if (drag.type === 'split') {
    graphHeight = Math.max(
      18,
      Math.min(
        75,
        drag.height +
          ((drag.startY - e.clientY) / document.querySelector('.middle').clientHeight) * 100,
      ),
    );
    document.querySelector('.graph-panel').style.height = graphHeight + '%';
    fitCanvas();
    return;
  }
  if (drag.type === 'pan') {
    pan = drag.original.map(
      (v, i) => v + [e.clientX - drag.start[0], e.clientY - drag.start[1]][i],
    );
    fitCanvas();
    return;
  }
  if (drag.type === 'node') {
    if (!drag.started && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < 4)
      return;
    if (!drag.started) {
      drag.started = true;
      lastNameClick = null;
      graphFrame = requestAnimationFrame(graphAutoPan);
    }
    drag.pointer = [e.clientX, e.clientY];
    moveGraphNodes();
    return;
  }
  let pos = canvasPoint(e),
    delta = pos.map((v, i) => v - drag.start[i]),
    n = current().nodes.find((x) => x.id === drag.nodeId);
  if (drag.type === 'guide') {
    const sources = [[], []];
    sources[drag.axis] = [drag.original];
    delta = snapped(sources, delta, e, drag.id);
    history.doc.editor.guides.find((g) => g.id === drag.id).position = Math.max(
      -100000,
      Math.min(100000, drag.original + delta[drag.axis]),
    );
    updateCanvas();
    return;
  }
  const anchor = drag.anchor || drag.start;
  if (artworkDrag()) {
    const targets =
      drag.type === 'shape'
        ? drag.targets
        : [
            {
              nodeId: drag.nodeId,
              keys: [`${drag.type === 'remap' ? 'remap.' : ''}${drag.pointId}.${drag.key}`],
            },
          ];
    const editable = targets.every((target) => {
      const node = current().nodes.find((n) => n.id === target.nodeId);
      return (
        node &&
        !node.pathAttachment &&
        target.keys.every((key) => {
          const q = parameter(node, key);
          return q && !q.locked && !q.source && !q.expression;
        })
      );
    });
    if (current().locked || !layerShown(current()) || !editable) {
      cancelInteraction();
      return;
    }
    if (
      e.shiftKey &&
      !drag.started &&
      Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < 3
    )
      return;
    delta = artworkDelta(drag.anchors || [[anchor[0]], [anchor[1]]], delta, e);
    drag.started = true;
    drag.lastDelta = delta;
  } else delta = snapped(drag.anchors || [[anchor[0]], [anchor[1]]], delta, e);
  if (drag.type === 'remap') {
    n.edits.find((e) => e.pointId === drag.pointId).params[drag.key].value = drag.original.map(
      (v, i) => v + delta[i],
    );
  } else if (drag.type === 'shape')
    drag.targets.forEach((t) => {
      const target = current().nodes.find((n) => n.id === t.nodeId);
      t.keys.forEach(
        (k, idx) => (parameter(target, k).value = t.original[idx].map((v, i) => v + delta[i])),
      );
    });
  else {
    let pt = n.points.find((x) => x.id === drag.pointId);
    if (drag.type === 'pen') {
      pt.handleB.value = delta;
      pt.handleA.value = delta.map((v) => -v);
      pt.handleType = 'symmetric';
    } else {
      pt[drag.key].value = drag.original.map((v, i) => v + delta[i]);
      if (drag.key !== 'position' && pt.handleType !== 'corner') {
        let other = drag.key === 'handleA' ? 'handleB' : 'handleA';
        if (!pt[other].locked && !pt[other].source && !pt[other].expression) {
          let v = pt[drag.key].value,
            len = pt.handleType === 'symmetric' ? Math.hypot(...v) : Math.hypot(...pt[other].value),
            mag = Math.hypot(...v) || 1;
          pt[other].value = v.map((x) => (-x / mag) * len);
        }
      }
    }
  }
  updateCanvas();
}
document.addEventListener('pointermove', movePointer);
document.addEventListener('pointercancel', (e) => {
  lastNameClick = null;
  const pointerId = wiring?.pointerId ?? drag?.pointerId;
  if (pointerId !== undefined && pointerId !== e.pointerId) return;
  cancelInteraction();
});
document.addEventListener('pointerup', (e) => {
  if (drag?.pointerId !== undefined && drag.pointerId !== e.pointerId) return;
  if (drag?.type === 'numeric' && drag.started) {
    const n = current().nodes.find((n) => n.id === drag.nodeId),
      q = !drag.textKind && n && parameter(n, drag.key);
    if (
      current().id !== drag.layerId ||
      current().locked ||
      !drag.capture.isConnected ||
      drag.capture.disabled ||
      drag.capture.readOnly ||
      (drag.textKind ? !textNumericState(drag) : !q || q.locked || q.source || q.expression)
    ) {
      cancelInteraction();
      return;
    }
  }
  let artworkResolution = null;
  if (drag?.type === 'artwork') {
    artworkResolution = artworkMove();
    if (!artworkResolution.supported || !sameArtworkMove(artworkResolution.target, drag.target)) {
      cancelInteraction();
      notify(artworkResolution.reason || 'Artwork target changed', true);
      return;
    }
  }
  if (wiring) {
    if (wiring.pointerId !== undefined && wiring.pointerId !== e.pointerId) return;
    let w = wiring;
    wiring = null;
    document.querySelectorAll('.compatible').forEach((x) => x.classList.remove('compatible'));
    updateGraphBounds();
    drawWires();
    let f = e.target.closest('.graph .field');
    if (w.disconnect) {
      if (!f)
        change(
          () =>
            disconnect(
              current().nodes.find((n) => n.id === w.node),
              w.key,
            ),
          'Disconnected; fallback restored',
        );
    } else if (f)
      change(
        () => connect(current(), w.source, f.dataset.node, f.dataset.key, false, w.port),
        'Connected',
      );
    return;
  }
  if (drag) {
    let d = drag;
    if (d.type === 'resize' && !current().locked) {
      const el = document.querySelector(`.node[data-id="${d.id}"]`),
        n = current().nodes.find((x) => x.id === d.id);
      n.width = Math.max(220, Math.min(550, el.offsetWidth));
    }
    drag = null;
    if (graphFrame !== null) window.cancelAnimationFrame(graphFrame);
    graphFrame = null;
    if (d.capture?.hasPointerCapture?.(d.pointerId)) d.capture.releasePointerCapture(d.pointerId);
    snapMatches = [];
    if (d.type === 'pen') {
      notify('Draft path · Enter / Escape: finish · Cancel path: discard');
      render();
      document.querySelector('.canvas-stage').focus({ preventScroll: true });
      return;
    }
    if (d.type === 'numeric' && !d.started) return;
    if (d.type === 'node' && !d.started && d.nameTarget) {
      if (nameClicked(current().id, d.nameTarget, e)) return;
    }
    if (
      ['shape', 'point', 'remap', 'artwork'].includes(d.type) &&
      (!d.started || d.lastDelta?.every((v) => v === 0))
    )
      history.doc = d.before;
    if (d.type === 'character' && d.before) {
      if (d.toggleOnClick && !d.started) chooseCharacter(d.toggleOnClick, true);
      const offsets =
        current().nodes.find((n) => n.id === d.nodeId)?.characterPositions?.offsets || {};
      if (d.originals.every((g) => g.offset.every((v, i) => v === (offsets[g.id]?.[i] || 0))))
        history.doc = d.before;
    }
    if (d.before && !sameDocument(d.before, history.doc)) {
      try {
        assertClosedOffsetChange(
          current(),
          d.before.layers.find((l) => l.id === current().id),
          fonts,
          history.doc.imageAssets,
        );
      } catch (error) {
        history.doc = d.before;
        notify(error.message, true);
        render();
        return;
      }
      history.record(d.before);
      if (d.type === 'artwork') {
        selectionHistory.set(d.before, d.selectionBefore);
        selectionHistory.set(history.doc, selectionSnapshot());
      }
      notify('Updated');
    }
    const toggledArtwork = d.type === 'artwork' && d.toggleOnClick && !d.started;
    if (toggledArtwork) selectArtwork(d.toggleOnClick, { toggle: true });
    render(false, d.type === 'artwork' && !toggledArtwork ? artworkResolution : null);
  }
});
app.addEventListener('contextmenu', (e) => {
  let input = e.target.closest('.input');
  if (input) {
    e.preventDefault();
    let f = input.closest('.field');
    change(
      () =>
        disconnect(
          current().nodes.find((n) => n.id === f.dataset.node),
          f.dataset.key,
        ),
      'Disconnected',
    );
  }
});
app.addEventListener(
  'toggle',
  () =>
    requestAnimationFrame(() => {
      updateGraphBounds();
      drawWires();
    }),
  true,
);
document.addEventListener('keydown', (e) => {
  if (navigationExcluded(e.target) || e.isComposing || e.keyCode === 229 || composing) return;
  const viewport = e.target.closest('.canvas-stage,.canvas-toolbar,.graph-scroll,.graph-toolbar');
  if (!viewport) return;
  const graph = viewport.matches('.graph-scroll,.graph-toolbar');
  const modifier = e.ctrlKey || e.metaKey;
  const fit = !modifier && e.shiftKey && (e.code === 'Digit1' || e.key === '1' || e.key === '!');
  const fitSelection =
    graph && !modifier && e.shiftKey && (e.code === 'Digit2' || e.key === '2' || e.key === '@');
  const actual = modifier && !e.shiftKey && e.key === '1';
  const zoomStep = !modifier && !e.altKey && ['+', '=', '-', '_'].includes(e.key);
  if (!fit && !fitSelection && !actual && !zoomStep) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (navigationBusy()) return;
  if (fit) graph ? fitGraph() : fitArtboard();
  else if (fitSelection) fitGraph(true);
  else if (graph) zoomGraph(actual ? 1 : graphZoom * (['+', '='].includes(e.key) ? 1.2 : 1 / 1.2));
  else zoomCanvas(actual ? 1 : zoom * (['+', '='].includes(e.key) ? 1.2 : 1 / 1.2));
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('[data-rename-name]')) {
    if (e.isComposing || e.keyCode === 229 || nameEdit?.composing) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      if (nameEdit) nameEdit.value = e.target.value;
      finishNameEdit(e.key === 'Enter');
    }
    return;
  }
  if (e.key === 'F2' && artworkTarget && e.target.matches?.('.canvas-stage')) {
    e.preventDefault();
    if (artworkSelection.size > 1) notify('Select one artwork to rename.', true);
    else beginNameEdit(artworkTarget);
    return;
  }
  if (e.key === 'F2' || (e.key === 'Enter' && e.target.matches?.('[data-rename-node]'))) {
    const title = e.target.closest?.('[data-rename-node], [data-select-layer]');
    if (title) {
      e.preventDefault();
      beginNameEdit(title.dataset.selectLayer || current().id, title.dataset.renameNode || null);
      return;
    }
  }
  if (artworkDrag() && e.key === 'Shift') {
    if (drag.lastPointer) movePointer({ ...drag.lastPointer, shiftKey: true, altKey: e.altKey });
    return;
  }
  if (drag?.type === 'numeric' && e.key === 'Escape') {
    e.preventDefault();
    cancelInteraction();
    return;
  }
  if (drag?.type === 'numeric' && drag.started) {
    e.preventDefault();
    return;
  }
  if (['pan', 'graph-pan'].includes(drag?.type) && e.key === 'Escape') {
    // Navigation is view-only: stop at the current offset without undo or selection changes.
    e.preventDefault();
    cancelInteraction();
    return;
  }
  if (
    [
      'character',
      'artwork',
      'position-controller',
      'shape',
      'point',
      'remap',
      'transform',
      'object-resize',
    ].includes(drag?.type) &&
    e.key === 'Escape'
  ) {
    e.preventDefault();
    cancelInteraction();
    return;
  }
  if (
    (artworkDrag() && e.key === 'Delete') ||
    ['transform', 'object-resize'].includes(drag?.type)
  ) {
    // A pending direct manipulation owns its document snapshot. Do not let
    // Delete interleave a second document action. Transform handles also block
    // history/tool shortcuts; artwork tools keep their existing cancel-and-switch behavior.
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (e.key === 'Escape' && e.target.dataset?.textWrapWidth) {
    const n = current().nodes.find((n) => n.id === e.target.dataset.textWrapWidth);
    e.target.value = String(n.textWrap.width);
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && e.target.dataset?.characterKerning !== undefined) {
    const pair = pairContext();
    e.target.value = pair?.manual ? String(pair.value) : '';
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && e.target.dataset?.textLeadingValue) {
    const n = current().nodes.find((n) => n.id === e.target.dataset.textLeadingValue);
    e.target.value = String(n.leading.value);
    e.preventDefault();
    return;
  }
  if (
    e.key === 'Escape' &&
    e.target.matches?.('[data-character-transform], [data-character-axis], [data-character-style]')
  ) {
    const input = e.target,
      context = characterContext();
    if (context) {
      const property = input.dataset.characterTransform || input.dataset.characterStyle,
        axis = Number(input.dataset.characterAxis);
      const values = (
        input.dataset.characterStyle ? context.typographySelected : context.selected
      ).map((g) => (property ? g[property] : g.offset[axis]));
      input.value = values.some((v) => v !== values[0])
        ? ''
        : String(
            (values[0] ?? (property === 'scale' ? 1 : 0)) *
              (['width', 'height'].includes(input.dataset.characterStyle) ? 100 : 1),
          );
      if (input.dataset.characterStyle === 'font')
        input.value = values.some((v) => v !== values[0]) ? '__mixed' : values[0];
    }
    e.preventDefault();
    return;
  }
  if (
    editingControl(e.target) ||
    e.target.closest('dialog') ||
    e.isComposing ||
    e.keyCode === 229 ||
    composing
  )
    return;
  if (
    penDraft &&
    (e.key === 'Escape' || (e.key === 'Enter' && !e.target.closest('button,[role="button"],a')))
  ) {
    e.preventDefault();
    finishPenDraft();
    return;
  }
  if (penDraft && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      notify('Finish or cancel the draft path before Redo');
      return;
    }
    discardPenDraft();
    notify('Draft path cancelled');
    render();
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (e.key === 'Delete' && deletionBusy()) {
    e.preventDefault();
    return;
  }
  if (
    characterEdit &&
    e.target.closest('.canvas-stage') &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
  ) {
    e.preventDefault();
    if (drag) return;
    const context = characterContext();
    if (!context?.occurrence || !context.selected.length) return;
    try {
      const step = e.shiftKey ? 10 : 1,
        delta = inverseCharacterDelta(context.occurrence.matrix, [
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        ]);
      change(
        () =>
          writeCharacterChanges(
            Object.fromEntries(
              context.selected.map((g) => [g.id, g.offset.map((v, i) => v + delta[i])]),
            ),
          ),
        'Character positions updated',
      );
      document.querySelector('.canvas-stage').focus({ preventScroll: true });
    } catch (err) {
      notify(err.message, true);
    }
    return;
  }
  if (
    e.target.matches?.('.canvas-stage') &&
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !characterEdit &&
    !document.querySelector('dialog[open]') &&
    !navigationBusy()
  ) {
    if (!artworkTarget) return;
    e.preventDefault();
    const resolved = artworkMove();
    if (!resolved.supported) {
      notify(resolved.reason, true);
      return;
    }
    const step = e.shiftKey ? 10 : 1,
      delta = [
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
      ];
    // No asynchronous work or document mutation intervenes before this write.
    // The next preview/key/commit still resolves independently from live state.
    const priorUI = selectionSnapshot();
    const oldPast = history.past.at(-1);
    change(() => writeArtworkMove(resolved.target, delta), 'Artwork position updated');
    if (history.past.at(-1) !== oldPast) {
      selectionHistory.set(history.past.at(-1), priorUI);
      selectionHistory.set(history.doc, selectionSnapshot());
    }
    document.querySelector('.canvas-stage').focus({ preventScroll: true });
    return;
  }
  if (e.code === 'Space' && !e.target.closest('button,[role="button"]')) {
    // A busy surface must not fall through to the browser's Space-to-scroll action.
    if (e.target.closest('.canvas-stage,.graph-scroll')) e.preventDefault();
    if (!navigationBusy()) space = true;
    updateNavigation();
  }
  if (e.key === 'Escape') {
    characterEdit = null;
    cancelInteraction();
    layoutDraft = null;
    layoutPreview = false;
    if (drag?.before) history.doc = drag.before;
    drag = null;
    snapMatches = [];
    selectedGuide = null;
    wiring = null;
    tool = 'select';
    penId = null;
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    stepHistory(e.shiftKey);
    render();
  }
  if (e.key === 'Delete' && selectedGuide) {
    editGuides((a) => {
      const guide = a.guides.find((g) => g.id === selectedGuide);
      if (!guide) return;
      if (a.locked || guide.locked) throw Error('Guide is locked');
      a.guides = a.guides.filter((g) => g.id !== selectedGuide);
      selectedGuide = null;
    });
    return;
  }
  if (e.key === 'Delete' && artworkTarget) {
    // Whole-artwork deletion is explicit, focused and independent of move support.
    // Clearing selection after success prevents a held/repeated Delete cascading.
    if (e.target.matches?.('.canvas-stage') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (artworkSelection.size > 1)
        notify('Select one artwork to delete, or use an explicit Delete layer row action.', true);
      else if (!e.repeat) deleteArtwork(artworkTarget);
    }
    return;
  }
  if (e.key === 'Delete' && !['Output', 'Image Output'].includes(selectedNode()?.type))
    document.querySelector(`[data-delete="${selected}"]`)?.click();
});
document.addEventListener('keydown', (e) => {
  if (
    editingControl(e.target) ||
    e.target.closest('dialog') ||
    e.isComposing ||
    e.keyCode === 229 ||
    composing ||
    e.repeat
  )
    return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      document.querySelector('[data-action="save"]')?.click();
    }
    if (e.key.toLowerCase() === 'o') {
      e.preventDefault();
      document.querySelector('[data-action="open"]')?.click();
    }
    return;
  }
  const keys = { v: 'select', p: 'pen', c: 'Circle', r: 'Rectangle', t: 'Text' };
  if (keys[e.key.toLowerCase()])
    document.querySelector(`[data-tool="${keys[e.key.toLowerCase()]}"]`)?.click();
});
app.addEventListener('keydown', (e) => {
  if (e.target.matches('.splitter') && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    graphHeight = Math.max(18, Math.min(75, graphHeight + (e.key === 'ArrowUp' ? 5 : -5)));
    document.querySelector('.graph-panel').style.height = graphHeight + '%';
    fitCanvas();
  }
});
document.addEventListener('keyup', (e) => {
  if (artworkDrag() && e.key === 'Shift') {
    drag.axis = null;
    if (drag.lastPointer) movePointer({ ...drag.lastPointer, shiftKey: false, altKey: e.altKey });
  }
  if (e.code === 'Space') {
    space = false;
    updateNavigation();
  }
});
window.addEventListener('resize', fitCanvas);
window.addEventListener('beforeunload', (e) => {
  if (penDraft || serialize(history.doc) !== savedSnapshot) {
    e.preventDefault();
    e.returnValue = '';
  }
});
render();
if (desktop)
  listSystemFonts()
    .then((items) => {
      systemFonts = items;
      systemFontStatus = items.length
        ? `${items.length} faces from Windows system/user Fonts folders. Selected face is embedded in JSON; variable/color fonts are unavailable.`
        : 'No Windows fonts found. Use Load TTF / OTF.';
      render();
    })
    .catch(() => {
      systemFontStatus = 'Windows font discovery unavailable. Use Load TTF / OTF.';
      render();
    });
fetch('/fonts/DejaVuSans.ttf')
  .then((r) => {
    if (!r.ok) throw Error('Bundled font unavailable');
    return r.arrayBuffer();
  })
  .then((b) => {
    bundledFont = parseFont(b);
    render();
  })
  .catch((e) => notify(e.message, true));
// Refresh actual disabled state after gesture handlers have established/released ownership.
app.addEventListener('pointerdown', updateLayerDeletionControls);
// Bubble after text/rename handlers have cleared their own composition state.
app.addEventListener('compositionend', updateLayerDeletionControls);
document.addEventListener('pointerup', updateLayerDeletionControls);
document.addEventListener('pointercancel', updateLayerDeletionControls);
// Explicit test/debug API; same model and mutations as the UI.
window.nect = {
  get document() {
    return history.doc;
  },
  evaluate: () => evaluate(current(), fonts, history.doc.imageAssets),
  load(text) {
    const d = deserialize(text);
    resetTransient();
    history = new History(d);
    activeLayer = d.layers[0].id;
    selected = current().nodes[0]?.id;
    artworkTarget = null;
    artworkSelection = new Set();
    render(true);
  },
  export: () => exportSVG(history.doc, fonts),
};
