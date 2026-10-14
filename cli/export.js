#!/usr/bin/env node
import fs from 'node:fs/promises';
import { parseFont, MAX_PROJECT_BYTES } from '../src/fonts.js';
import { deserialize, exportSVG } from '../src/core.js';
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node cli/export.js project.json artwork.svg');
  process.exit(1);
}
try {
  if ((await fs.stat(input)).size > MAX_PROJECT_BYTES) throw Error('Project exceeds 50 MB');
  const project = deserialize(await fs.readFile(input, 'utf8'));
  const bytes = await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
  const fonts = {
    default: parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
  const svg = exportSVG(project, fonts);
  await fs.writeFile(output, svg, { flag: 'wx' });
  console.log(
    `Exported ${project.layers.filter((x) => x.visible && !x.guide).length} visible compositions to ${output}`,
  );
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
