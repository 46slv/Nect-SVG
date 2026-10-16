import { blankDocument, guideDefaults, uid } from '../../src/core.js';
import { appendArtwork } from '../../src/artwork-creation.js';
import { imageData } from './artwork-deletion.js';

export function orderingDocument() {
  const doc = blankDocument();
  doc.schemaVersion = 10;
  doc.name = 'Three overlapping colors';
  doc.width = 480;
  doc.height = 320;
  doc.editor = guideDefaults();
  doc.editor.guides.push({ id: uid('guide'), axis: 'x', position: 55, locked: false });
  doc.imageAssets = {
    'image-keep': { name: 'keep.png', mime: 'image/png', width: 1, height: 1, data: imageData },
  };
  for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
    appendArtwork(doc, 'Rectangle', {
      at: [180 + index * 40, 160],
      name: ['Red back', 'Green middle', 'Blue front'][index],
    });
    const [shape, fill] = doc.layers.at(-1).nodes;
    shape.params.size.value = [240, 180];
    fill.params.color.value = { hex: color, alpha: 1 };
  }
  doc.layers.shift();
  return doc;
}
