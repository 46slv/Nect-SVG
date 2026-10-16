import { multiArtworkFixture } from './artwork-multi-move.js';

export function gapArtworkFixture() {
  const f = multiArtworkFixture();
  f.doc.name = 'Artwork equal gaps';
  f.doc.width = 1200;
  f.doc.height = 800;
  f.doc.layers.find((l) => l.id === f.rect.layerId).nodes[0].params.center.value = [130, 115];
  f.doc.layers
    .find((l) => l.id === f.star.layerId)
    .nodes.find((n) => n.id === f.star.transform).params.offset.value = [0, 130];
  f.doc.layers.find((l) => l.id === f.text.layerId).nodes[0].params.position.value = [470, 420];
  for (const pt of f.doc.layers.find((l) => l.id === f.curve.layerId).nodes[0].points)
    pt.position.value = [pt.position.value[0] + 280, pt.position.value[1] + 240];
  f.doc.layers.at(-1).nodes[0].params.position.value = [1090, 700];
  return f;
}
