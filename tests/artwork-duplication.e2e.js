import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { blankLayer, node, serialize } from '../src/core.js';
import { duplicationDocument, richDuplicationText } from './fixtures/artwork-duplication.js';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document)),
  load = (doc) => page.evaluate((text) => window.nect.load(text), serialize(doc)),
  select = (id) => page.locator(`[data-select-layer="${id}"]`).click(),
  click = (action) => page.locator(`[data-action="${action}"]`).click(),
  duplicate = () => page.locator('[data-duplicate-artwork]'),
  stage = () => page.locator('.canvas-stage'),
  pixels = (data, mime = 'image/svg+xml') =>
    page.evaluate(
      async ({ data, mime }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          width: canvas.width,
          height: canvas.height,
          visiblePixels: bytes.reduce(
            (count, value, index) => count + (index % 4 === 3 && value > 0 ? 1 : 0),
            0,
          ),
          hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((x) => x.toString(16).padStart(2, '0'))
            .join(''),
        };
      },
      { data: Buffer.from(data).toString('base64'), mime },
    ),
  exported = () => page.evaluate(() => window.nect.export()),
  download = async (action, name, extension) => {
    const pending = page.waitForEvent('download');
    await click(action);
    const path = `test-results/workflow-artwork-duplication-${name}.${extension}`;
    await (await pending).saveAs(path);
    return fs.readFile(path);
  },
  force = () =>
    duplicate().evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
  xy = (p) =>
    page.locator('.artboard').evaluate((svg, p) => {
      const q = new DOMPoint(...p).matrixTransform(svg.getScreenCTM());
      return [q.x, q.y];
    }, p),
  point = async (p) => {
    await page.mouse.move(...(await xy(p)));
    await page.mouse.down();
    await page.mouse.up();
  },
  move = async (p, delta) => {
    const start = await xy(p),
      end = await xy(p.map((v, i) => v + delta[i]));
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(...end, { steps: 5 });
    await page.mouse.up();
  };
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  for (const type of [
    'Circle',
    'Ellipse',
    'Rectangle',
    'Polygon',
    'Star',
    'Text',
    'Curve',
    'Image',
  ])
    for (const transformed of ['Curve', 'Image'].includes(type) ? [false] : [false, true]) {
      const f = duplicationDocument(type, transformed),
        label = type.toLowerCase() + (transformed ? '-transform' : '');
      if (type === 'Text') richDuplicationText(f.generator);
      // Keep negative scale/rotation coverage visibly inside the artboard.
      // The shared model fixture intentionally remains unchanged.
      if (transformed)
        f.layer.nodes.find((n) => n.type === 'Transform').params.offset.value = [440, 320];
      await load(f.doc);
      await select(f.layer.id);
      assert.equal(await duplicate().isEnabled(), true, label);
      const before = await snapshot();
      await duplicate().click();
      const after = await snapshot(),
        copied = JSON.parse(after),
        copy = copied.layers[2];
      assert.deepEqual(
        copied.layers.filter((l) => l.id !== copy.id),
        f.doc.layers,
      );
      assert.equal(copy.name, f.layer.name + ' copy');
      assert.equal(await page.locator('.layer.selected').getAttribute('data-layer'), copy.id);
      assert.equal(
        await page.evaluate(() => document.activeElement.matches('.canvas-stage')),
        true,
      );
      assert.equal(await page.locator('.node.selected').count(), 0);
      await click('undo');
      assert.equal(await snapshot(), before);
      assert.equal(await page.locator('.layer.selected').getAttribute('data-layer'), f.layer.id);
      await click('redo');
      assert.equal(await snapshot(), after);
      const saved = await download('save', label, 'json'),
        svg = await download('export', label, 'svg'),
        png = await download('export-png', label, 'png');
      assert.equal(JSON.stringify(JSON.parse(saved)), after);
      assert.equal(svg.toString(), await exported());
      assert.deepEqual(
        await pixels(png, 'image/png'),
        await pixels(svg),
        label + ' full scene PNG',
      );
      const originalOnly = { ...f.doc, layers: [f.layer] },
        copyOnly = { ...copied, layers: [copy] };
      await load(originalOnly);
      const originalSVG = await exported(),
        originalPixels = await pixels(originalSVG);
      assert.ok(originalPixels.visiblePixels > 0, label + ' source has visible alpha');
      await load(copyOnly);
      const copySVG = await exported();
      assert.ok((await pixels(copySVG)).visiblePixels > 0, label + ' copy has visible alpha');
      assert.equal(
        copySVG.replaceAll(copy.name, f.layer.name),
        originalSVG,
        label + ' copy-only exact SVG',
      );
      assert.deepEqual(await pixels(copySVG), originalPixels, label + ' copy-only pixels');
      // Cold reopening is independent of both session history and loaded graph selection.
      await page.reload();
      await page.waitForSelector('.shape');
      await load(JSON.parse(saved));
      await page.waitForFunction(() => !document.querySelector('.warning'));
      assert.equal(await snapshot(), after);
      assert.deepEqual(await pixels(await exported()), await pixels(png, 'image/png'));
      await select(copy.id);
      await stage().press('Shift+ArrowRight');
      const moved = JSON.parse(await snapshot());
      assert.deepEqual(
        moved.layers.find((l) => l.id === f.layer.id),
        f.layer,
        label + ' source unchanged by copy move',
      );
      assert.notDeepEqual(moved.layers[2], copy);
      await click('undo');
      assert.equal(await snapshot(), after);
    }

  // Actual pointer placement and source-stage editing remain independent after copying.
  for (const type of ['Curve', 'Text']) {
    const f = duplicationDocument(type);
    if (type === 'Text') richDuplicationText(f.generator);
    await load(f.doc);
    await select(f.layer.id);
    await duplicate().click();
    const after = JSON.parse(await snapshot()),
      copy = after.layers[2],
      generator = copy.nodes.find((n) => n.type === type);
    const interior = await page.locator(`.shape[data-layer="${copy.id}"]`).evaluate((path) => {
      const box = path.getBBox();
      for (let y = box.y + 2; y < box.y + box.height - 2; y += 2)
        for (let x = box.x + 2; x < box.x + box.width - 2; x += 2)
          if (
            [
              [0, 0],
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].every(([dx, dy]) => path.isPointInFill(new DOMPoint(x + dx, y + dy)))
          )
            return [x, y];
      throw Error('Expected a filled interior for artwork pointer placement');
    });
    await move(interior, [35, 20]);
    assert.deepEqual(JSON.parse(await snapshot()).layers[1], f.layer);
    assert.notDeepEqual(JSON.parse(await snapshot()).layers[2], copy);
    await click('undo');
    assert.equal(await snapshot(), JSON.stringify(after));
    await page.locator(`.node[data-id="${generator.id}"] .node-head strong`).click();
    if (type === 'Text') {
      const input = page.locator(`.inspector-body [data-text="${generator.id}"]`);
      await input.fill('Edited independent copy');
      await input.press('Tab');
    } else {
      const input = page.locator(
        `.graph .field[data-node="${generator.id}"][data-key="${generator.points[0].id}.position"] [data-value][data-axis="0"]`,
      );
      await input.fill('145');
      await input.press('Tab');
    }
    const edited = JSON.parse(await snapshot());
    assert.deepEqual(edited.layers[1], f.layer, type + ' source unchanged after node edit');
    assert.notDeepEqual(edited.layers[2], copy);
  }

  // Affordance and navigation checks at both desktop layouts.
  for (const [width, height] of [
    [1600, 1000],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const f = duplicationDocument();
    await load(f.doc);
    await select(f.layer.id);
    await click('actual-size');
    await click('zoom-out');
    await click('graph-zoom-in');
    await page.locator('.graph-scroll').evaluate((el) => {
      el.scrollLeft = 180;
      el.scrollTop = 100;
    });
    const view = await page.evaluate(() => ({
      canvas: document.querySelector('.artboard').getAttribute('style'),
      graph: document.querySelector('.graph').style.zoom,
      scroll: [
        document.querySelector('.graph-scroll').scrollLeft,
        document.querySelector('.graph-scroll').scrollTop,
      ],
    }));
    await page.screenshot({
      path: `test-results/artwork-duplication-${width}-selected.png`,
      fullPage: true,
    });
    await duplicate().click();
    assert.deepEqual(
      await page.evaluate(() => ({
        canvas: document.querySelector('.artboard').getAttribute('style'),
        graph: document.querySelector('.graph').style.zoom,
        scroll: [
          document.querySelector('.graph-scroll').scrollLeft,
          document.querySelector('.graph-scroll').scrollTop,
        ],
      })),
      view,
    );
    assert.equal(await duplicate().isVisible(), true);
    await page.screenshot({
      path: `test-results/artwork-duplication-${width}-copied.png`,
      fullPage: true,
    });
  }

  for (const kind of ['extra', 'locked', 'hidden', 'guide', 'stroke', 'capacity']) {
    const f = duplicationDocument();
    if (kind === 'extra') f.layer.nodes.push(node('Null'));
    if (kind === 'locked') f.layer.locked = true;
    if (kind === 'hidden') f.layer.visible = false;
    if (kind === 'guide') f.layer.guide = true;
    if (kind === 'stroke') {
      const stroke = node('Stroke');
      stroke.params.path.source = f.generator.id;
      f.layer.nodes[2] = stroke;
      f.output.params.path.source = stroke.id;
    }
    if (kind === 'capacity') while (f.doc.layers.length < 100) f.doc.layers.push(blankLayer());
    await load(f.doc);
    await select(f.layer.id);
    const before = await snapshot();
    assert.equal(await duplicate().isDisabled(), true, kind);
    await force();
    assert.equal(await snapshot(), before);
    assert.ok((await page.locator('.artwork-duplicate-status').innerText()).length);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  const f = duplicationDocument();
  await load(f.doc);
  await select(f.layer.id);
  const before = await snapshot();
  await click('help');
  assert.equal(await duplicate().isDisabled(), true);
  await force();
  assert.equal(await snapshot(), before);
  await page.locator('dialog button').click();
  assert.equal(await duplicate().isEnabled(), true);
  await stage().dispatchEvent('compositionstart');
  assert.equal(await duplicate().isDisabled(), true);
  await force();
  assert.equal(await snapshot(), before);
  await stage().dispatchEvent('compositionend');
  assert.equal(await duplicate().isEnabled(), true);
  await page.locator(`[data-select-layer="${f.layer.id}"]`).press('F2');
  assert.equal(await duplicate().isDisabled(), true);
  await force();
  assert.equal(await snapshot(), before);
  await page.locator('[data-rename-name]').press('Escape');
  await page.locator('[data-tool="pen"]').click();
  await point([100, 100]);
  await point([270, 230]);
  assert.equal(await page.locator('[data-pen-draft]').count(), 1);
  if (await duplicate().count()) {
    assert.equal(await duplicate().isDisabled(), true);
    await force();
  }
  assert.equal(await snapshot(), before);
  assert.equal(await page.locator('[data-pen-draft]').count(), 1);
  await page.locator('[data-pen-cancel]').click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS Duplicate in place: all 14 routes, exact whole-layer/source preservation, copy-only SVG/pixels, actual JSON/SVG/PNG and cold reopen, history/selection, copy pointer/nudge/source editing, navigation, 1280/1600 controls and busy/unsupported no-ops.',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/artwork-duplication-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
