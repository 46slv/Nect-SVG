import { document, node, point, connect } from '../../src/core.js';
import {
  appendArtwork,
  createPenArtworkDraft,
  appendPenArtwork,
} from '../../src/artwork-creation.js';

export function multiArtworkFixture() {
  const doc = document();
  doc.name = 'Independent artwork placement';
  doc.schemaVersion = 10;
  doc.width = 800;
  doc.height = 500;
  doc.layers = [];
  // Keep a harmless, unselected reference graph to prove unrelated data survives.
  const reference = document().layers[0];
  reference.name = 'Hidden reference';
  reference.visible = false;
  doc.layers.push(reference);
  const rect = appendArtwork(doc, 'Rectangle', { at: [170, 170], name: 'Silver tile' });
  const rectNode = doc.layers.at(-1).nodes[0];
  rectNode.params.size.value = [120, 90];
  doc.layers.at(-1).nodes[1].params.color.value = { hex: '#7c929d', alpha: 1 };
  const star = appendArtwork(doc, 'Star', { at: [400, 170], name: 'Transformed star' });
  const layer = doc.layers.at(-1),
    tr = node('Transform', 350, 50);
  tr.params.anchor.value = [400, 170];
  tr.params.rotation.value = 20;
  tr.params.scale.value = -0.8;
  tr.params.offset.value = [0, 0];
  layer.nodes.splice(1, 0, tr);
  layer.nodes.forEach((n, i) => {
    n.position = [40 + i * 310, 50];
  });
  connect(layer, star.nodeId, tr.id, 'path');
  connect(layer, tr.id, layer.nodes.find((n) => n.type === 'Fill').id, 'path');
  const text = appendArtwork(doc, 'Text', { at: [120, 340], name: 'Editable label' });
  doc.layers.at(-1).nodes[0].text = 'MOVE TOGETHER';
  doc.layers.at(-1).nodes[0].params.size.value = 25;
  const draft = createPenArtworkDraft(doc, [510, 300]);
  draft.name = 'Bezier swatch';
  draft.nodes[0].points = [point(510, 300), point(650, 290), point(620, 380)];
  draft.nodes[0].points[1].handleA.value = [-40, -30];
  draft.nodes[0].points[1].handleB.value = [30, 30];
  draft.nodes[0].params.closed.value = true;
  const curve = appendPenArtwork(doc, draft);
  const image = node('Image'),
    output = node('Image Output', 350, 50);
  image.asset = 'image-swatch';
  image.params.position.value = [650, 150];
  image.params.size.value = [50, 50];
  const imageLayer = {
    id: 'layer-image-swatch',
    name: 'Embedded swatch',
    visible: true,
    locked: false,
    fill: '#36434e',
    nodes: [image, output],
    output: output.id,
  };
  doc.imageAssets = {
    'image-swatch': {
      name: 'swatch.png',
      mime: 'image/png',
      width: 1,
      height: 1,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    },
  };
  connect(imageLayer, image.id, output.id, 'path');
  doc.layers.push(imageLayer);
  return {
    doc,
    ids: [rect.layerId, star.layerId, text.layerId, curve.layerId, imageLayer.id],
    rect,
    star: { ...star, transform: tr.id },
    text,
    curve,
  };
}
