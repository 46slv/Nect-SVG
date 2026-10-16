import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nect-wrap-browser-'));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.evaluate(async () => {
    const { document, node, point, connect } = await import('/src/core.js');
    const doc = document(),
      l = doc.layers[0],
      t = node('Text'),
      c = node('Curve'),
      fill = node('Fill'),
      out = node('Output');
    t.id = 'wrap-text';
    t.text = 'Alpha beta gamma';
    t.params.position.value = [170, 170];
    t.params.size.value = 40;
    c.id = 'wrap-path';
    c.points = [point(0, 0), point(1000, 0)];
    c.params.closed.value = false;
    l.nodes = [t, c, fill, out];
    l.output = out.id;
    connect(l, t.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    window.nect.load(JSON.stringify(doc));
  });
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  const read = () => page.evaluate(() => window.nect.document.layers[0].nodes[0]),
    saved = () => page.evaluate(() => JSON.stringify(window.nect.document)),
    field = (key) => page.locator(`.inspector-body [data-${key}]`),
    editWidth = async (value) => {
      await field('text-wrap-width').fill(String(value));
      await field('text-wrap-width').press('Tab');
      await page.waitForFunction(() => {
        const el = document.querySelector('.inspector-body [data-text-wrap-width]');
        const width = String(window.nect.document.layers[0].nodes[0].textWrap.width);
        return el?.getAttribute('value') === width && el.value === width;
      });
    },
    lines = () => page.evaluate(() => window.nect.evaluate().textLayout('wrap-text').lines);
  const original = await saved(),
    originalSVG = await page.evaluate(() => window.nect.export());
  await field('text-wrap').selectOption('width');
  assert.equal((await read()).textWrap.width, 320);
  assert.equal(await page.evaluate(() => window.nect.document.schemaVersion), 8);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), original);
  await page.locator('[data-action="redo"]').click();
  await editWidth(120);
  assert.equal((await lines()).length, 3);
  const narrow = await saved();
  await field('text-wrap-width').fill('900');
  await field('text-wrap-width').press('Escape');
  await field('text-wrap-width').press('Tab');
  assert.equal(await saved(), narrow);
  await editWidth(0);
  assert.equal(await saved(), narrow);
  await field('writing-mode').selectOption('vertical-rl');
  assert.equal(await saved(), narrow);
  assert.match(await page.locator('.status .message').innerText(), /horizontal/);
  await field('text-path').selectOption(JSON.stringify(['wrap-path', 'wrap-path']));
  assert.equal(await saved(), narrow);
  assert.match(await page.locator('.status .message').innerText(), /TEXT_WRAP_PATH/);
  await field('text').focus();
  await field('text').evaluate((el) => el.setSelectionRange(0, 5));
  await page.locator('.inspector-body [data-style-text-range]').click();
  const selectedWidth = page.locator('[data-character-style="width"]');
  await selectedWidth.fill('150');
  await selectedWidth.press('Tab');
  const identities = (await read()).characterPositions;
  assert.equal(identities.styles.c1.width, 1.5);
  const selected = () =>
    page
      .locator('[data-character-selection]')
      .evaluate((el) => [...el.selectedOptions].map((o) => o.value));
  assert.deepEqual(await selected(), ['c1', 'c2', 'c3', 'c4', 'c5']);
  await editWidth(600);
  assert.equal((await lines()).length, 1);
  assert.deepEqual((await read()).characterPositions, identities);
  assert.deepEqual(await selected(), ['c1', 'c2', 'c3', 'c4', 'c5']);
  await editWidth(120);
  assert.deepEqual((await read()).characterPositions, identities);
  await field('text-leading').selectOption('manual');
  await field('text-leading-value').fill('80');
  await field('text-leading-value').press('Tab');
  assert.deepEqual(
    await page.evaluate(() => window.nect.evaluate().textLayout('wrap-text').lineOffsets),
    [0, 80, 160],
  );
  await page.waitForFunction(() => {
    const input = document.querySelector('.inspector-body [data-text-leading-value]');
    return (
      window.nect.document.layers[0].nodes[0].leading.value === 80 &&
      input?.getAttribute('value') === '80'
    );
  });
  await field('text').focus();
  // The browser's IME events exercise draft isolation and stable-ID reconciliation; native IME is separate.
  await field('text').evaluate((el) => {
    el.setSelectionRange(6, 10);
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = 'Alpha X gamma';
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        isComposing: true,
      }),
    );
  });
  assert.equal((await read()).text, 'Alpha beta gamma');
  await field('text').evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal((await read()).text, 'Alpha X gamma');
  assert.equal((await read()).characterPositions.units[0].id, 'c1');
  const edited = await saved();
  await page.locator('[data-action="undo"]').click();
  assert.equal((await read()).text, 'Alpha beta gamma');
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), edited);
  // Return to the reviewable bilingual sample for independent core/CLI/raster evidence.
  const sample = await fs.readFile('examples/text-wrap-width.json', 'utf8');
  await page.evaluate((json) => window.nect.load(json), sample);
  const json = await saved(),
    svg = await page.evaluate(() => window.nect.export());
  assert.ok(!svg.includes('<text'));
  assert.ok(!svg.includes('text-wrap-controls'));
  assert.notEqual(svg, originalSVG);
  await fs.writeFile(path.join(dir, 'scene.json'), json);
  execFileSync(process.execPath, [
    'cli/export.js',
    path.join(dir, 'scene.json'),
    path.join(dir, 'scene.svg'),
  ]);
  const cliSVG = await fs.readFile(path.join(dir, 'scene.svg'), 'utf8');
  assert.equal(svg, cliSVG);
  const raster = await page.evaluate(
    async ({ json, cliSVG }) => {
      const { rasterizeSVG } = await import('/src/raster.js');
      const digest = async (svg) => {
        const blob = await rasterizeSVG(svg, { width: 960, height: 720 }),
          image = await createImageBitmap(blob),
          canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        return { hash, ink: rgba.some((v, i) => i % 4 === 3 && v > 0), bytes: blob.size };
      };
      const original = await digest(window.nect.export()),
        cli = await digest(cliSVG);
      window.nect.load(json);
      const reopened = await digest(window.nect.export());
      return { original, cli, reopened };
    },
    { json, cliSVG },
  );
  assert.ok(raster.original.ink);
  assert.ok(raster.original.bytes > 100);
  assert.equal(raster.original.hash, raster.cli.hash);
  assert.equal(raster.original.hash, raster.reopened.hash);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  await field('text-wrap-width').scrollIntoViewIfNeeded();
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await field('text-wrap-width').evaluate((el) => el.getBoundingClientRect().width >= 100),
    );
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-text-wrap.json', json);
  await fs.writeFile('test-results/workflow-text-wrap.svg', svg);
  await fs.writeFile(
    'test-results/workflow-text-wrap-raster.json',
    JSON.stringify(raster, null, 2),
  );
  await page.screenshot({ path: 'test-results/text-wrap-width-1600x1000.png', fullPage: true });
  const locked = JSON.parse(json);
  locked.layers[0].locked = true;
  await page.evaluate((json) => window.nect.load(json), JSON.stringify(locked));
  assert.equal(await field('text-wrap').isDisabled(), true);
  assert.equal(await field('text-wrap-width').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'Wrap width: greedy Latin/Japanese, identities, IME draft, Escape/undo, conflicts/locks, browser=CLI SVG and exact reopened RGBA passed',
  );
} catch (error) {
  console.error('Wrap browser status:', await page.locator('.status .message').innerText());
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/text-wrap-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  await fs.rm(dir, { recursive: true, force: true });
}
