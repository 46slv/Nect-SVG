import fs from 'node:fs';
import { document, layer, node, point, serialize } from '../src/core.js';
const doc = document();
doc.name = 'V/R Converters — editable practice fixture';
doc.width = 960;
doc.height = 540;
doc.layers = [];
function composition(name, nodes, source, fill = '#293844') {
  const l = layer(name),
    output = node('Output', 1150, 80);
  output.params.path.source = source.id;
  l.nodes = [...nodes, output];
  l.output = output.id;
  l.fill = fill;
  doc.layers.push(l);
}
function polygon(name, positions, graphX = 40, graphY = 40) {
  const n = node('Curve', graphX, graphY);
  n.name = name;
  n.points = positions.map(([x, y]) => point(x, y));
  return n;
}
const v = polygon('V / editable outline', [
  [190, 130],
  [235, 130],
  [310, 315],
  [385, 130],
  [430, 130],
  [330, 370],
  [290, 370],
]);
composition('V · Curve', [v], v);
const slash = node('Rectangle');
slash.name = 'Slash / source rectangle';
slash.params.center.value = [472, 250];
slash.params.size.value = [24, 290];
const rotate = node('Transform', 350, 40);
rotate.name = 'Slash / angle';
rotate.params.path.source = slash.id;
rotate.params.rotation.value = 20;
// Rotate about origin by contract, then translate into the intended composition.
rotate.params.offset.value = [114, -140];
composition('Slash · Transform', [slash, rotate], rotate, '#718491');
const stem = node('Rectangle', 40, 40);
stem.name = 'R / stem';
stem.params.center.value = [580, 250];
stem.params.size.value = [44, 240];
const bowl = node('Ellipse', 40, 270);
bowl.name = 'R / outer bowl';
bowl.params.center.value = [647, 193];
bowl.params.size.value = [136, 126];
const join = node('Boolean', 350, 40);
join.name = 'R / stem + bowl';
join.operation = 'union';
join.params.a.source = stem.id;
join.params.b.source = bowl.id;
const counter = node('Ellipse', 350, 300);
counter.name = 'R / counter';
counter.params.center.value = [647, 193];
counter.params.size.value = [68, 48];
const cut = node('Boolean', 650, 40);
cut.name = 'R / subtract counter';
cut.params.a.source = join.id;
cut.params.b.source = counter.id;
const leg = polygon(
  'R / diagonal leg',
  [
    [604, 242],
    [650, 242],
    [719, 370],
    [669, 370],
  ],
  650,
  320,
);
const union = node('Boolean', 950, 40);
union.name = 'R / add leg';
union.operation = 'union';
union.params.a.source = cut.id;
union.params.b.source = leg.id;
const remap = node('Path Remap', 1250, 40);
remap.name = 'R / final secondary edits';
remap.params.path.source = union.id;
composition('R · Boolean / Remap', [stem, bowl, join, counter, cut, leg, union, remap], remap);
const label = node('Text');
label.name = 'Converters / editable text';
label.text = 'CONVERTERS';
label.params.position.value = [305, 440];
label.params.size.value = 43;
const outline = node('Text to Path', 350, 40);
outline.params.path.source = label.id;
composition('CONVERTERS · Text', [label, outline], outline, '#596e7c');
fs.writeFileSync(new URL('./vr-converters.json', import.meta.url), serialize(doc) + '\n');
