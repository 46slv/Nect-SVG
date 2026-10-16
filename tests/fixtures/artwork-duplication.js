import {
  blankDocument,
  connect,
  node,
  point,
  setCharacterOffsets,
  setCharacterStyles,
  setCharacterTransforms,
  setCharacterKerningPairs,
} from '../../src/core.js';
import { appendArtwork } from '../../src/artwork-creation.js';
import { imageData } from './artwork-deletion.js';

export function duplicationDocument(type = 'Rectangle', transformed = false) {
  const doc = blankDocument();
  doc.schemaVersion = 10;
  doc.width = 720;
  doc.height = 480;
  doc.imageAssets = {
    'image-shared': { name: 'red.png', mime: 'image/png', width: 1, height: 1, data: imageData },
  };
  const added = appendArtwork(doc, type === 'Curve' || type === 'Image' ? 'Rectangle' : type, {
      at: [210, 210],
      name: `${type} original`,
    }),
    layer = doc.layers.find((l) => l.id === added.layerId);
  let [generator, fill, output] = layer.nodes;
  if (type === 'Image') {
    generator = node('Image', 71, 63);
    output = node('Image Output', 730, 111);
    generator.asset = 'image-shared';
    generator.params.position.value = [100, 110];
    generator.params.size.value = [180, 140];
    layer.nodes = [output, generator];
    layer.output = output.id;
    connect(layer, generator.id, output.id, 'path');
  } else {
    if (type === 'Curve') {
      generator = node('Curve', 71, 63);
      generator.points = [point(110, 140), point(280, 120), point(260, 290)];
      generator.params.closed.value = true;
      generator.points[0].handleType = 'smooth';
      generator.points[0].handleA.value = [-20, 15];
      generator.points[0].handleB.value = [32, -24];
      generator.points[1].handleType = 'symmetric';
      generator.points[1].handleA.value = [-22, -15];
      generator.points[1].handleB.value = [22, 15];
      layer.nodes[0] = generator;
      fill.params.path.source = generator.id;
    }
    if (transformed) {
      const transform = node('Transform', 370, 210);
      transform.params.offset.value = [320, 30];
      transform.params.scale.value = -0.8;
      transform.params.rotation.value = 12;
      connect({ ...layer, nodes: [...layer.nodes, transform] }, generator.id, transform.id, 'path');
      fill.params.path.source = transform.id;
      layer.nodes = [output, transform, fill, generator];
    } else layer.nodes = [output, generator, fill];
    fill.params.color.value = { hex: '#e03070', alpha: 0.65 };
    fill.params.color.locked = true;
  }
  generator.name = 'Authored source card';
  generator.width = 300;
  generator.collapsed = false;
  appendArtwork(doc, 'Circle', { at: [570, 320], name: 'Keep front artwork' });
  return { doc, layer, generator, fill, output };
}

export function richDuplicationText(generator) {
  generator.text = 'AV Alpha beta';
  generator.params.size.value = 40;
  generator.leading = { mode: 'manual', value: 59 };
  generator.textWrap = { width: 250 };
  generator.characterPositions = setCharacterOffsets(generator.text, undefined, { c1: [5, -3] });
  generator.characterPositions = setCharacterTransforms(
    generator.text,
    generator.characterPositions,
    {
      c2: { rotation: 15, scale: 1.2 },
    },
  );
  generator.characterPositions = setCharacterStyles(generator.text, generator.characterPositions, {
    c1: { size: 45, width: 1.1, height: 0.9, tracking: 3, baselineShift: -2 },
  });
  generator.characterPositions = setCharacterKerningPairs(
    generator.text,
    generator.characterPositions,
    { 'c1:c2': -4.25 },
  );
}

export function multiDuplicationDocument() {
  const types = ['Rectangle', 'Text', 'Curve', 'Image'];
  const fixtures = types.map((type) => duplicationDocument(type));
  richDuplicationText(fixtures[1].generator);
  const doc = fixtures[0].doc;
  // A visible, unselected separator makes nonadjacent insertion observable.
  doc.layers = [
    doc.layers[0],
    fixtures[0].layer,
    doc.layers[2],
    ...fixtures.slice(1).map((f) => f.layer),
  ];
  doc.name = 'Artwork batch duplication';
  fixtures[1].generator.params.position.value = [330, 110];
  fixtures[2].generator.points.forEach((p) => {
    p.position.value[0] += 280;
    p.position.value[1] += 140;
  });
  fixtures[3].generator.params.position.value = [90, 310];
  fixtures[3].generator.params.size.value = [110, 85];
  return { doc, fixtures, ids: fixtures.map((f) => f.layer.id) };
}
