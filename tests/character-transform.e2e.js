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
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const sample = await fs.readFile('examples/character-transform.json', 'utf8');
  const load = async (s = sample) => {
    await page.evaluate((s) => window.nect.load(s), s);
    await page.waitForFunction(() => window.nect.evaluate().error === null);
  };
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const read = () =>
    page.evaluate(() =>
      window.nect.document.layers[0].nodes.find((n) => n.id === 'text-horizontal'),
    );
  const mode = () => page.locator('[data-character-mode]').click();
  const select = (ids) => page.locator('[data-character-selection]').selectOption(ids);
  const field = (key) => page.locator(`.inspector-body [data-character-transform="${key}"]`);
  const undo = () => page.locator('[data-action="undo"]').click();
  const edit = async (key, value) => {
    await field(key).fill(String(value));
    await field(key).press('Tab');
  };
  await load();
  const before = await saved();
  await mode();
  await select(['c2']);
  assert.equal(await saved(), before);
  const floating = page.locator('.character-floating');
  await floating.locator('[data-character-transform="scale"]').fill('1.5');
  const stage = await page.locator('.canvas-stage').boundingBox();
  await page.mouse.click(stage.x + 8, stage.y + 8);
  await page.waitForFunction(
    () =>
      window.nect.document.layers[0].nodes.find((n) => n.id === 'text-horizontal')
        .characterPositions.transforms.c2.scale === 1.5,
  );
  assert.equal((await read()).characterPositions.transforms.c2.rotation, -18);
  const scaled = await saved();
  await undo();
  assert.equal(await saved(), before);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), scaled);
  await mode();
  await select(['c2', 'c3']);
  assert.equal(await field('scale').getAttribute('placeholder'), 'Mixed');
  await edit('rotation', 25);
  let t = await read();
  assert.equal(t.characterPositions.transforms.c2.rotation, 25);
  assert.equal(t.characterPositions.transforms.c3.rotation, 25);
  assert.equal(t.characterPositions.transforms.c2.scale, 1.5);
  assert.equal(t.characterPositions.transforms.c3.scale, 0.85);
  await undo();
  assert.equal(await saved(), scaled);
  await mode();
  await select(['c2']);
  await field('rotation').fill('80');
  await field('rotation').press('Escape');
  await field('rotation').press('Tab');
  assert.equal(await saved(), scaled);
  // Dragging a shaped character through the downstream Transform still edits only XY; Escape restores it.
  const hit = page.locator('.character-hit[data-character="c2"]').first(),
    b = await hit.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const beforeDrag = await read();
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 12, { steps: 5 });
  const duringDrag = await read();
  assert.notDeepEqual(
    duringDrag.characterPositions.offsets.c2,
    beforeDrag.characterPositions.offsets.c2,
  );
  assert.deepEqual(
    duringDrag.characterPositions.transforms,
    beforeDrag.characterPositions.transforms,
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await saved(), scaled);
  await page.locator('.inspector-body [data-character-shape-reset]').click();
  t = await read();
  assert.equal(t.characterPositions.transforms.c2, undefined);
  assert.deepEqual(t.characterPositions.offsets.c2, [8, -12]);
  await undo();
  assert.equal(await saved(), scaled);
  await mode();
  await select(['c2']);
  await page.locator('[data-action="zoom-in"]').click();
  const f = await floating.boundingBox(),
    s = await page.locator('.canvas-stage').boundingBox();
  assert.ok(
    f.x >= s.x &&
      f.y >= s.y &&
      f.x + f.width <= s.x + s.width + 1 &&
      f.y + f.height <= s.y + s.height + 1,
  );
  await page.locator('[data-action="fit"]').click();
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workflow-character-transform-horizontal.png' });
  const expectedSVG = await page.evaluate(() => window.nect.export());
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-character-transform.${ext}`);
  }
  const json = await fs.readFile('test-results/workflow-character-transform.json', 'utf8'),
    svg = await fs.readFile('test-results/workflow-character-transform.svg', 'utf8');
  assert.equal(svg, expectedSVG);
  assert.doesNotMatch(svg, /character-hit|character-pivot|character-floating/);
  assert.equal(JSON.parse(json).schemaVersion, 4);
  const png = await fs.readFile('test-results/workflow-character-transform.png');
  assert.ok(png.subarray(1, 4).equals(Buffer.from('PNG')));
  await load(json);
  assert.equal(await saved(), scaled);
  assert.equal(await page.evaluate(() => window.nect.export()), expectedSVG);
  await page.locator('.node[data-id="text-vertical"] .node-head strong').click();
  await mode();
  await select(['c2']);
  await edit('rotation', -30);
  assert.equal(await field('rotation').inputValue(), '-30');
  await page.screenshot({ path: 'test-results/workflow-character-transform-vertical.png' });
  // Real Chrome Japanese vertical + sideways Latin; use the licensed limited test fixture only for regression evidence.
  await page.evaluate(async () => {
    const { document, node, connect, setCharacterTransforms } = await import('/src/core.js'),
      { makeFontAsset } = await import('/src/fonts.js');
    const asset = makeFontAsset(
      await (await fetch('/tests/fixtures/fonts/NectJPFixture-Regular.otf')).arrayBuffer(),
      'NectJPFixture-Regular.otf',
    );
    const d = document(),
      l = d.layers[0],
      t = node('Text'),
      f = node('Fill'),
      o = node('Output');
    d.schemaVersion = 4;
    d.fontAssets = { [asset.id]: asset.asset };
    t.text = '日本A本';
    t.font = asset.id;
    t.writingMode = 'vertical-rl';
    t.params.position.value = [400, 90];
    t.params.size.value = 70;
    t.characterPositions = setCharacterTransforms(t.text, undefined, {
      c2: { rotation: 25, scale: 1.3 },
      c3: { rotation: -20, scale: 0.8 },
    });
    l.nodes = [t, f, o];
    l.output = o.id;
    connect(l, t.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
  });
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  await mode();
  await select(['c3']);
  assert.equal(await field('rotation').inputValue(), '-20');
  await page.screenshot({ path: 'test-results/workflow-character-transform-japanese.png' });
  // Verified insertion retains the adjusted repeated 本 identity; synthetic input is not native IME acceptance.
  await page.locator('[data-edit-text]').click();
  const area = page.locator('.inspector-body [data-text]');
  await area.focus();
  await area.press('Home');
  await page.keyboard.insertText('日');
  await area.press('Tab');
  await page.waitForFunction(() => window.nect.document.layers[0].nodes[0].text === '日日本A本');
  assert.equal(
    await page.evaluate(
      () => window.nect.document.layers[0].nodes[0].characterPositions.units[2].id,
    ),
    'c2',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: character rotation/uniform scale, mixed values, independent resets, exact history, draft/drag Escape, zoom, horizontal/vertical/Japanese, stable IDs, JSON/SVG/PNG. Native IME remains separate.',
  );
} finally {
  await browser.close();
}
