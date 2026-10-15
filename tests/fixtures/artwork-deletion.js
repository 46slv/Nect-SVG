import { blankDocument, connect, guideDefaults, node, point, uid } from '../../src/core.js';
import { appendArtwork } from '../../src/artwork-creation.js';

export const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

export function deletionDocument() {
  const doc = blankDocument();
  doc.schemaVersion = 10;
  doc.name = 'Keep this document';
  doc.width = 720;
  doc.height = 480;
  doc.editor = guideDefaults();
  doc.editor.guides.push({ id: uid('guide'), axis: 'x', position: 77, locked: true });
  doc.imageAssets = {
    'image-keep': { name: 'keep.png', mime: 'image/png', width: 1, height: 1, data: imageData },
  };
  doc.layers[0].name = 'Empty reference';
  appendArtwork(doc, 'Rectangle', { at: [180, 180], name: 'Delete this artwork' });
  appendArtwork(doc, 'Circle', { at: [500, 220], name: 'Keep front artwork' });
  return doc;
}

export function unsupportedLayer(doc, kind) {
  const layer = doc.layers[1],
    [shape, paint, output] = layer.nodes;
  if (kind === 'gradient') {
    const gradient = node('Linear Gradient Fill', ...paint.position);
    layer.nodes[1] = gradient;
    output.params.path.source = gradient.id;
    connect(layer, shape.id, gradient.id, 'path');
  } else if (kind === 'large-curve') {
    const curve = node('Curve', ...shape.position);
    curve.points = Array.from({ length: 129 }, (_, i) =>
      point(
        250 + 100 * Math.cos((i * Math.PI * 2) / 129),
        220 + 100 * Math.sin((i * Math.PI * 2) / 129),
      ),
    );
    curve.params.closed.value = true;
    layer.nodes[0] = curve;
    paint.params.path.source = curve.id;
  } else if (kind === 'image') {
    const image = node('Image', 40, 50),
      imageOutput = node('Image Output', 350, 50);
    image.asset = 'image-keep';
    image.params.position.value = [120, 120];
    image.params.size.value = [160, 160];
    layer.nodes = [image, imageOutput];
    layer.output = imageOutput.id;
    connect(layer, image.id, imageOutput.id, 'path');
  }
  return layer;
}
