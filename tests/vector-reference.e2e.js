import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sample = await fs.readFile('examples/vector-reference-reuse.json', 'utf8'),
  saved = () => page.evaluate(() => JSON.stringify(window.nect.document)),
  load = async (s = sample) => {
    await page.evaluate((s) => window.nect.load(s), s);
    await page.waitForFunction(() => window.nect.evaluate().error === null);
  },
  picker = () => page.locator('.inspector-body [data-reference-target]'),
  choose = (id, port = 'output') => picker().selectOption(JSON.stringify([id, port])),
  undo = () => page.locator('[data-action="undo"]').click(),
  redo = () => page.locator('[data-action="redo"]').click(),
  select = (id) => page.locator(`.node[data-id="${id}"] .node-head strong`).click(),
  read = (id) => page.evaluate((id) => window.nect.evaluate().run(id), id);
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await load();
  assert.deepEqual(await read('reference-position'), [170, 200]);
  assert.deepEqual(await read('reference-offset'), await read('reference-wired'));
  assert.equal(await picker().inputValue(), JSON.stringify(['reference-title', 'position']));
  assert.match(
    await page.locator('.inspector-body [data-reference-status]').innerText(),
    /Master title · Position/,
  );
  assert.equal(await page.locator('[data-preview="reference-position"]').count(), 0);
  const original = await saved(),
    svg = await page.evaluate(() => window.nect.export());
  await choose('reference-origin');
  assert.deepEqual(await read('reference-position'), [170, 200]);
  await undo();
  assert.equal(await saved(), original);
  await redo();
  await undo();
  await choose('reference-caption', 'position');
  assert.equal(await saved(), original);
  assert.match(await page.locator('.status').innerText(), /cycle/i);
  assert.equal(await picker().inputValue(), JSON.stringify(['reference-title', 'position']));
  await page.locator('.inspector-body [data-reference-jump]').click();
  assert.equal(await page.locator('.inspector-body h3').innerText(), 'Master title');
  await select('reference-origin');
  const x = page.locator('.inspector-body [data-key="position"] [data-axis="0"]');
  await x.fill('240');
  await x.press('Tab');
  assert.deepEqual(await read('reference-position'), [240, 200]);
  assert.deepEqual(await read('reference-offset'), [240, 290]);
  await undo();
  assert.equal(await saved(), original);
  // Duplicate source+Reference together, then verify the copied link targets the copied stable ID.
  await select('reference-title');
  await page
    .locator('.node[data-id="reference-position"] .node-head strong')
    .click({ modifiers: ['Shift'] });
  await page.locator('.graph [data-duplicate="reference-position"]').click();
  const copies = await page.evaluate(() =>
    window.nect.document.layers[0].nodes.filter((n) => n.name.endsWith(' copy')),
  );
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.find((n) => n.type === 'Reference').reference, {
    nodeId: copies.find((n) => n.type === 'Text').id,
    portId: 'position',
  });
  await undo();
  assert.equal(await saved(), original);
  await select('reference-position');
  await page.locator('[data-collapse="reference-position"]').click();
  assert.match(
    await page.locator('.node[data-id="reference-position"]').innerText(),
    /Master title · Position/,
  );
  await undo();
  // Deletion retains the missing ID; save/reload cannot substitute an unrelated source or stale cache.
  await page.locator('.graph [data-delete="reference-title"]').click();
  assert.match(
    await page.locator('.inspector-body [data-reference-status]').innerText(),
    /missing/,
  );
  const missing = await saved();
  assert.match(
    await page.evaluate(() => window.nect.evaluate().error),
    /Reference target is missing/,
  );
  await undo();
  assert.equal(await saved(), original);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  await redo();
  assert.equal(await saved(), missing);
  await page.evaluate((s) => window.nect.load(s), missing);
  assert.match(
    await page.locator('.inspector-body [data-reference-status]').innerText(),
    /missing/,
  );
  await load();
  // Stable identity survives display-name changes and JSON roundtrip.
  const renamed = JSON.parse(original);
  renamed.layers[0].nodes.find((n) => n.id === 'reference-title').name = 'Renamed master';
  await load(JSON.stringify(renamed));
  assert.match(
    await page.locator('.inspector-body [data-reference-status]').innerText(),
    /Renamed master · Position/,
  );
  assert.deepEqual(await read('reference-position'), [170, 200]);
  const locked = JSON.parse(await saved());
  locked.layers[0].locked = true;
  await load(JSON.stringify(locked));
  assert.equal(await picker().isDisabled(), true);
  await page.locator('.inspector-body [data-reference-jump]').click();
  assert.equal(await page.locator('.inspector-body h3').innerText(), 'Renamed master');
  await load();
  // The identical ordinary-wire graph exports the same artwork without Reference geometry.
  const direct = JSON.parse(original);
  direct.layers[0].nodes.find((n) => n.id === 'reference-offset').params.a.source =
    'reference-title';
  direct.layers[0].nodes.find((n) => n.id === 'reference-offset').params.a.sourcePort = 'position';
  direct.layers[0].nodes = direct.layers[0].nodes.filter((n) => n.id !== 'reference-position');
  await load(JSON.stringify(direct));
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  await load();
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-vector-reference.json', await saved());
  await fs.writeFile('test-results/workflow-vector-reference.svg', svg);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-png"]').click();
  const download = await downloadPromise;
  await download.saveAs('test-results/workflow-vector-reference.png');
  const png = await fs.readFile('test-results/workflow-vector-reference.png');
  assert.equal(png.readUInt32BE(16), 960);
  assert.equal(png.readUInt32BE(20), 540);
  assert.ok(png.length > 1000);
  await page.screenshot({ path: 'test-results/vector-reference-ui.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Reference picker/cycles/source update/duplicate/delete/history/roundtrip/locks/SVG equivalence/PNG',
  );
} finally {
  await browser.close();
}
