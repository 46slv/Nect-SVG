import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const field = (id, key) =>
  page.locator(`.inspector-body .field[data-node="${id}"][data-key="${key}"]`);
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
async function download(action, file) {
  const wait = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  await (await wait).saveAs(file);
  return fs.readFile(file);
}
async function pixels(data, mime) {
  return page.evaluate(
    async ({ data, mime }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const x = c.getContext('2d');
      x.drawImage(image, 0, 0);
      const digest = await crypto.subtle.digest(
        'SHA-256',
        x.getImageData(0, 0, c.width, c.height).data,
      );
      return {
        rgbaSha256: [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
        size: [c.width, c.height],
        points: [
          [30, 60],
          [70, 60],
          [110, 60],
          [130, 60],
          [150, 60],
          [190, 60],
          [230, 60],
          [270, 60],
          [310, 60],
          [50, 160],
          [130, 160],
          [210, 160],
          [310, 160],
          [15, 60],
          [0, 0],
          [170, 60],
          [100, 60],
          [100, 30],
          [130, 60],
          [100, 90],
          [70, 60],
          [200, 60],
        ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]),
      };
    },
    { data: data.toString('base64'), mime },
  );
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  // The public menu creates the node with all five typed inputs.
  await page.locator('#add-node').selectOption('Radial Gradient Fill');
  const added = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Radial Gradient Fill').id,
  );
  await inspect(added);
  assert.equal(await field(added, 'center').getAttribute('data-type'), 'Vector2');
  assert.equal(await field(added, 'radius').getAttribute('data-type'), 'Scalar');
  assert.equal(await field(added, 'endColor').getAttribute('data-type'), 'Color');
  assert.match(await page.locator('.inspector-body').innerText(), /absolute artboard/);
  const ids = await page.evaluate(async () => {
    const { document, node, layer, connect } = await import('/src/core.js');
    const d = document();
    d.width = 340;
    d.height = 220;
    d.name = 'Gradient pixel verification';
    const l = d.layers[0],
      a = node('Rectangle', 40, 40),
      b = node('Rectangle', 40, 370),
      j = node('Join Geometry', 350, 40),
      g = node('Radial Gradient Fill', 660, 40),
      s = node('Stroke', 970, 40),
      o = node('Output', 1280, 40),
      v = node('Vector', 660, 460),
      c = node('Color', 970, 460),
      t = node('Transform', 350, 460);
    a.params.center.value = [100, 60];
    a.params.size.value = [160, 80];
    b.params.center.value = [240, 60];
    b.params.size.value = [160, 80];
    g.params.center.value = [100.5, 60.5];
    g.params.radius.value = 100;
    g.params.startColor.value = { hex: '#ff0000', alpha: 0.25 };
    g.params.endColor.value = { hex: '#0000ff', alpha: 0.75 };
    s.params.width.value = 10;
    s.params.color.value = { hex: '#00ff00', alpha: 1 };
    v.params.value.value = [0, 60];
    c.params.value.value = { hex: '#ffff00', alpha: 1 };
    l.nodes = [a, b, j, g, s, o, v, c, t];
    l.output = o.id;
    connect(l, a.id, j.id, 'a');
    connect(l, b.id, j.id, 'b');
    connect(l, j.id, g.id, 'path');
    connect(l, g.id, s.id, 'path');
    connect(l, s.id, o.id, 'path');
    connect(l, a.id, t.id, 'path');
    const l2 = layer(l.name),
      r = node('Rectangle'),
      repeat = node('Geometry Repeater'),
      g2 = node('Linear Gradient Fill'),
      o2 = node('Output');
    r.params.center.value = [50, 160];
    r.params.size.value = [60, 60];
    repeat.params.count.value = 4;
    repeat.params.step.value = [80, 0];
    g2.params.start.value = [20, 160];
    g2.params.end.value = [320, 160];
    g2.params.startColor.value = { hex: '#00ff00', alpha: 1 };
    g2.params.endColor.value = { hex: '#000000', alpha: 1 };
    l2.nodes = [r, repeat, g2, o2];
    l2.output = o2.id;
    connect(l2, r.id, repeat.id, 'path');
    connect(l2, repeat.id, g2.id, 'path');
    connect(l2, g2.id, o2.id, 'path');
    d.layers.push(l2);
    window.nect.load(JSON.stringify(d));
    return { a: a.id, g: g.id, s: s.id, t: t.id, v: v.id, c: c.id };
  });
  await inspect(ids.t);
  const options = await page
    .locator(`.graph .field[data-node="${ids.t}"][data-key="path"]`)
    .locator('option')
    .evaluateAll((els) => els.map((el) => el.value));
  assert.ok(options.includes(ids.a));
  assert.ok(!options.includes(ids.g));
  await inspect(ids.g);
  const before = await page.evaluate(() => JSON.stringify(window.nect.document));
  await field(ids.g, 'radius').locator('[data-value]').fill('0');
  await field(ids.g, 'radius').locator('[data-value]').press('Tab');
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), before);
  // Connect value nodes through real menus; mismatched types are absent, fallbacks survive.
  await field(ids.g, 'center').locator('[data-connect-menu]').click();
  assert.equal(await page.locator(`dialog option[value="${ids.c}"]`).count(), 0);
  await page.locator('dialog select').selectOption(ids.v);
  await page.locator('dialog [data-confirm]').click();
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().isDisabled(), true);
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().inputValue(), '0');
  await field(ids.g, 'center').locator('.socket.input').click({ button: 'right' });
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().inputValue(), '100.5');
  await field(ids.g, 'endColor').locator('[data-connect-menu]').click();
  assert.equal(await page.locator(`dialog option[value="${ids.v}"]`).count(), 0);
  await page.locator('dialog select').selectOption(ids.c);
  await page.locator('dialog [data-confirm]').click();
  assert.equal(
    await field(ids.g, 'endColor').locator('[data-color="hex"]').inputValue(),
    '#ffff00',
  );
  await field(ids.g, 'endColor').locator('.socket.input').click({ button: 'right' });
  assert.equal(
    await field(ids.g, 'endColor').locator('[data-color="hex"]').inputValue(),
    '#0000ff',
  );
  await field(ids.g, 'center').locator('[data-lock]').click();
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().isDisabled(), true);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().isDisabled(), false);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await field(ids.g, 'center').locator('[data-value]').first().isDisabled(), true);
  await field(ids.g, 'center').locator('[data-lock]').click();
  await field(ids.g, 'startColor').locator('[data-color="alpha"]').fill('0');
  await field(ids.g, 'startColor').locator('[data-color="alpha"]').press('Tab');
  await page.waitForFunction(
    () =>
      document.querySelector('.artboard radialGradient stop')?.getAttribute('stop-opacity') === '0',
  );
  assert.equal(
    await page
      .locator('.artboard radialGradient')
      .first()
      .locator('stop')
      .first()
      .getAttribute('stop-opacity'),
    '0',
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(
    await field(ids.g, 'startColor').locator('[data-color="alpha"]').inputValue(),
    '0.25',
  );
  const json = await download('save', 'test-results/workflow-radial-gradient.json'),
    svg = await download('export', 'test-results/workflow-radial-gradient.svg'),
    png = await download('export-png', 'test-results/workflow-radial-gradient.png');
  const pngPixels = await pixels(png, 'image/png'),
    svgPixels = await pixels(svg, 'image/svg+xml');
  await fs.writeFile(
    'test-results/workflow-radial-gradient-pixels.json',
    JSON.stringify({ pngPixels, svgPixels }, null, 2),
  );
  assert.deepEqual(pngPixels, svgPixels);
  assert.deepEqual(pngPixels.size, [340, 220]);
  // Color/alpha follow an absolute circular ramp. Past the radius, pad holds the last stop.
  const coords = [30, 70, 110, 130, 150, 190, 230, 270, 310];
  for (const [i, x] of coords.entries()) {
    const t = Math.min(Math.abs(x - 100) / 100, 1),
      actual = pngPixels.points[i],
      expected = [255 * (1 - t), 0, 255 * t, 255 * (0.25 + 0.5 * t)];
    actual.forEach((v, k) =>
      assert.ok(Math.abs(v - expected[k]) <= 3, `${x} channel ${k}: ${actual} vs ${expected}`),
    );
  }
  for (const [i, x] of [50, 130, 210, 310].entries()) {
    const actual = pngPixels.points[9 + i],
      expected = 255 * (1 - (x + 0.5 - 20) / 300);
    assert.ok(Math.abs(actual[1] - expected) <= 2);
    assert.equal(actual[3], 255);
  }
  assert.deepEqual(pngPixels.points[13], [0, 255, 0, 255]);
  assert.deepEqual(pngPixels.points[14], [0, 0, 0, 0]);
  const overlapT = 0.7,
    overlapAlpha = 0.25 + 0.5 * overlapT;
  assert.ok(Math.abs(pngPixels.points[15][3] - 255 * (1 - (1 - overlapAlpha) ** 2)) <= 2);
  assert.ok(Math.abs(pngPixels.points[16][3] - 255 * 0.25) <= 1);
  // At alpha 0.25, one premultiplied byte becomes about four unpremultiplied
  // RGB units. Compare the center in premultiplied space within one byte;
  // SVG/PNG and reopened-scene RGBA digests still require exact equality.
  const centerPixel = pngPixels.points[16];
  centerPixel
    .slice(0, 3)
    .forEach((channel, i) =>
      assert.ok(Math.abs((channel * centerPixel[3]) / 255 - (i === 0 ? 255 * 0.25 : 0)) <= 1),
    );
  for (const point of pngPixels.points.slice(17, 21))
    point.forEach((channel, i) => assert.ok(Math.abs(channel - pngPixels.points[17][i]) <= 2));
  assert.deepEqual(pngPixels.points[21], pngPixels.points[8]);
  const dom = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('.artboard radialGradient, .artboard linearGradient')].map(
      (el) => el.id,
    ),
    refs: [...document.querySelectorAll('.artboard .shape')][0].querySelectorAll('path').length,
    paths: [...document.querySelectorAll('.artboard path[fill^="url"]')].map((el) =>
      el.getAttribute('fill'),
    ),
  }));
  assert.deepEqual(dom.ids, ['nect-gradient-0', 'nect-gradient-1']);
  assert.equal(dom.refs, 2);
  assert.equal(dom.paths.filter((x) => x === 'url(#nect-gradient-0)').length, 2);
  await page.locator('[data-layer-name]').fill('Changed after save');
  await page.locator('[data-layer-name]').press('Tab');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].name),
    'Changed after save',
  );
  // Renaming schedules a structural render. Await its layer-list text before resolving
  // the hidden file input, otherwise that input may detach during setInputFiles.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.layer .name')].some(
      (el) => el.textContent === 'Changed after save',
    ),
  );
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'gradient.json', mimeType: 'application/json', buffer: json });
  await page.waitForFunction(
    () => document.querySelector('.status .message')?.textContent === 'Project restored',
  );
  assert.deepEqual(await page.evaluate(() => window.nect.document), JSON.parse(json));
  const reopened = await page.evaluate(() => window.nect.export());
  assert.equal(reopened, svg.toString());
  // Reopen our evaluated gradient artwork through the actual SVG file control.
  const saved = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page
    .locator('#import-svg-file')
    .setInputFiles({ name: 'gradient.svg', mimeType: 'image/svg+xml', buffer: svg });
  await page.waitForFunction(() =>
    window.nect.document.layers.every((l) => l.nodes.some((n) => n.type === 'Imported Path')),
  );
  const imported = await page.evaluate(() => JSON.stringify(window.nect.document));
  const importedTypes = await page.evaluate(() =>
    window.nect.document.layers.map((l) => l.nodes.map((n) => n.type)),
  );
  assert.equal(importedTypes.length, 2);
  assert.ok(importedTypes[0].includes('Radial Gradient Fill'));
  assert.ok(importedTypes[1].includes('Linear Gradient Fill'));
  assert.ok(importedTypes[0].includes('Join Geometry'));
  // An ungrouped Repeater exports one compound path; only the explicit Join
  // layer exports independently painted paths requiring an imported Join tree.
  const importedGeometry = await page.evaluate(async () => {
    const { evaluate } = await import('/src/core.js');
    return window.nect.document.layers.map((l) => {
      const path = evaluate(l).path;
      return {
        sources: l.nodes.filter((n) => n.type === 'Imported Path').length,
        contours: path.contours.length,
        groups: new Set(path.contours.map((c) => c.group)).size,
      };
    });
  });
  assert.deepEqual(importedGeometry, [
    { sources: 2, contours: 2, groups: 2 },
    { sources: 1, contours: 4, groups: 1 },
  ]);
  const importedSvg = await download(
    'export',
    'test-results/workflow-radial-gradient-reopened.svg',
  );
  const importedPng = await download(
    'export-png',
    'test-results/workflow-radial-gradient-reopened.png',
  );
  const reopenedSvgPixels = await pixels(importedSvg, 'image/svg+xml');
  const reopenedPngPixels = await pixels(importedPng, 'image/png');
  assert.deepEqual(reopenedSvgPixels, svgPixels); // Full RGBA digest, not just a few points.
  assert.deepEqual(reopenedPngPixels, pngPixels);
  const importedGradient = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Radial Gradient Fill').id,
  );
  await inspect(importedGradient);
  await field(importedGradient, 'endColor').locator('[data-color="hex"]').fill('#fedcba');
  await field(importedGradient, 'endColor').locator('[data-color="hex"]').press('Tab');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.artboard radialGradient stop:last-child')
        ?.getAttribute('stop-color') === '#fedcba',
  );
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(
    (snapshot) => JSON.stringify(window.nect.document) === snapshot,
    imported,
  );
  // Rejected imports create no history entry, never fetch a paint resource, and
  // do not replace the document even when invalid content occurs after good paths.
  const attemptedResources = [];
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) attemptedResources.push(request.url());
  });
  const rejected = [
    svg
      .toString()
      .replace(
        '<radialGradient ',
        '<radialGradient href="https://example.invalid/paint.svg#ramp" ',
      ),
    svg.toString().replace('<radialGradient ', '<radialGradient gradientTransform="scale(2)" '),
    svg.toString().replace('fx="100.5"', 'fx="101.5"'),
    svg.toString().replace('fr="0"', 'fr="1"'),
    svg.toString().replace('r="100"', 'r="0"'),
    svg.toString().replace('url(#nect-gradient-0)', 'url(#missing)'),
    svg.toString().replace('stop-opacity="0.75"', 'stop-opacity="2"'),
    svg.toString().replace('spreadMethod="pad"', 'spreadMethod="repeat"'),
    svg.toString().replace('offset="1"', 'offset="0.5"'),
    svg.toString().replace('</svg>', '<rect onload="alert(1)"/></svg>'),
    svg
      .toString()
      .replace('</svg>', '<defs><radialGradient href="#cycle" id="cycle"/></defs></svg>'),
    svg.toString().replace('</svg>', '<g></svg>'),
    svg.toString().replace('<radialGradient ', '<radialGradient id="duplicate" '),
    svg.toString().replace('</svg>', '<unknown/></svg>'),
  ];
  for (const [index, invalid] of rejected.entries()) {
    await page.evaluate(() => {
      document.querySelector('.status .message').textContent = 'Checking rejected import';
    });
    await page.locator('#import-svg-file').setInputFiles({
      name: `rejected-${index}.svg`,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(invalid),
    });
    await page.waitForFunction(() =>
      document.querySelector('.status .message')?.textContent.includes('Open rejected'),
    );
    assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), imported);
  }
  assert.deepEqual(attemptedResources, []);
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(
    (snapshot) => JSON.stringify(window.nect.document) === snapshot,
    saved,
  );
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(
    (snapshot) => JSON.stringify(window.nect.document) === snapshot,
    imported,
  );
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'gradient.json', mimeType: 'application/json', buffer: json });
  await page.waitForFunction(
    () => document.querySelector('.status .message')?.textContent === 'Project restored',
  );
  await inspect(ids.g);
  await page.screenshot({
    path: 'test-results/radial-gradient-clean-preview-1600x1000.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/workflow-radial-gradient-evidence.json',
    JSON.stringify(
      {
        pngPixels,
        svgPixels,
        dom,
        typedMenus: true,
        disconnectFallback: true,
        locksHistory: true,
        jsonReload: true,
        svgReopened: true,
        reopenedSvgPixels,
        reopenedPngPixels,
        importedTypes,
        importedGeometry,
        rejectedImportCases: rejected.length,
        rejectedImportsAtomic: true,
        importUndoRedo: true,
        attemptedResources,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Radial Gradient Fill: real controls, type guards, fallbacks, locks/history, JSON/SVG/PNG, safe radial SVG reopen, atomic hostile rejection and full RGBA parity verified.',
  );
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    status: document.querySelector('.status .message')?.textContent,
    layer: window.nect?.document.layers[0].name,
    files: [...(document.querySelector('#open-file')?.files || [])].map((f) => f.name),
  }));
  console.error('Radial gradient failure diagnostic:', JSON.stringify(diagnostic));
  await fs.writeFile(
    'test-results/workflow-radial-gradient-failure.json',
    JSON.stringify(diagnostic, null, 2),
  );
  await page.screenshot({ path: 'test-results/radial-gradient-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
