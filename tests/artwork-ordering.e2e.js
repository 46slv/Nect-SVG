import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { blankLayer, document as makeDoc, serialize } from '../src/core.js';
import { orderingDocument } from './fixtures/artwork-ordering.js';
import { unsupportedLayer } from './fixtures/artwork-deletion.js';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
const load = (doc) => page.evaluate((text) => window.nect.load(text), serialize(doc)),
  snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document)),
  click = (action) => page.locator(`[data-action="${action}"]`).click(),
  select = (id) => page.locator(`[data-select-layer="${id}"]`).click(),
  order = (id, direction = 'forward') =>
    page.locator(`[data-order-layer="${id}"][data-order-direction="${direction}"]`),
  force = (id, direction = 'forward') =>
    page.evaluate(
      ({ id, direction }) => {
        const button = document.createElement('button');
        button.dataset.orderLayer = id;
        button.dataset.orderDirection = direction;
        document.querySelector('#app').append(button);
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.remove();
      },
      { id, direction },
    ),
  xy = (point) =>
    page.locator('.artboard').evaluate((svg, point) => {
      const p = new DOMPoint(...point).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    }, point),
  view = () =>
    page.evaluate(() => ({
      canvas: document.querySelector('.artboard').getAttribute('style'),
      graph: document.querySelector('.graph').style.zoom,
      scroll: [
        document.querySelector('.graph-scroll').scrollLeft,
        document.querySelector('.graph-scroll').scrollTop,
      ],
      active: document.querySelector('.layer.selected').dataset.layer,
      nodes: [...document.querySelectorAll('.node.selected')].map((n) => n.dataset.id),
      artwork: document.querySelectorAll('.artwork-selection').length,
    })),
  pixels = (bytes, mime = 'image/svg+xml', points = [[230, 140]]) =>
    page.evaluate(
      async ({ data, mime, points }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return {
          size: [canvas.width, canvas.height],
          hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))]
            .map((x) => x.toString(16).padStart(2, '0'))
            .join(''),
          samples: points.map(([x, y]) => [
            ...context.getImageData(Math.round(x), Math.round(y), 1, 1).data,
          ]),
        };
      },
      { data: Buffer.from(bytes).toString('base64'), mime, points },
    ),
  canvasColor = async () =>
    (await pixels(await page.screenshot(), 'image/png', [await xy([230, 140])])).samples[0],
  exported = () => page.evaluate(() => window.nect.export()),
  download = async (action, name, extension) => {
    const pending = page.waitForEvent('download');
    await click(action);
    const path = `test-results/workflow-artwork-ordering-${name}.${extension}`;
    await (await pending).saveAs(path);
    return fs.readFile(path);
  };
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  for (const [width, height] of [
    [1600, 1000],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    const doc = orderingDocument(),
      target = doc.layers[1],
      active = doc.layers[0];
    await load(doc);
    await select(active.id);
    await click('zoom-out');
    await click('graph-zoom-in');
    await page.locator('.graph-scroll').evaluate((el) => {
      el.scrollLeft = 60;
      el.scrollTop = 70;
    });
    const before = await snapshot(),
      prior = await view();
    assert.deepEqual(
      await canvasColor(),
      [0, 0, 255, 255],
      'actual canvas begins blue in triple overlap',
    );
    for (const direction of ['forward', 'backward']) {
      assert.equal(await order(target.id, direction).getAttribute('aria-disabled'), 'false');
      assert.equal(
        await order(target.id, direction).getAttribute('aria-label'),
        `${direction === 'forward' ? 'Forward' : 'Backward'} one position: ${target.name}`,
      );
      const bounds = await order(target.id, direction).boundingBox();
      assert.ok(
        bounds && bounds.x >= width - 274 && bounds.x + bounds.width <= width,
        'controls fit sidebar',
      );
    }
    await page.screenshot({
      path: `test-results/artwork-ordering-${width}-before.png`,
      fullPage: true,
    });
    await order(target.id).focus();
    await order(target.id).press('Enter');
    const after = await snapshot();
    assert.deepEqual(JSON.parse(after).layers, [doc.layers[0], doc.layers[2], target]);
    assert.deepEqual(await view(), prior);
    assert.equal(await order(target.id).evaluate((el) => document.activeElement === el), true);
    assert.equal(await order(target.id).getAttribute('aria-disabled'), 'true');
    assert.equal(await order(target.id).evaluate((el) => el.disabled), false);
    assert.deepEqual(await canvasColor(), [0, 255, 0, 255], 'actual canvas responds to Forward');
    for (const key of ['Enter', 'Space']) {
      await order(target.id).press(key);
      assert.equal(await snapshot(), after, 'disabled boundary keyboard activation is a no-op');
      assert.equal(await order(target.id).evaluate((el) => document.activeElement === el), true);
    }
    await order(target.id).click({ force: true });
    assert.equal(await snapshot(), after, 'disabled boundary pointer activation is a no-op');
    for (let i = 0; i < 2; i++) {
      await click('undo');
      assert.equal(await snapshot(), before);
      assert.deepEqual(await view(), prior);
      await force(doc.layers[0].id, 'backward');
      await force(doc.layers[2].id, 'forward');
      await force('stale-layer');
      await force(target.id, 'up');
      assert.equal(await snapshot(), before);
      assert.equal(await page.locator('[data-action="redo"]').isEnabled(), true);
      await click('redo');
      assert.equal(await snapshot(), after);
      assert.deepEqual(await view(), prior);
    }
    const saved = await download('save', String(width), 'json'),
      svg = await download('export', String(width), 'svg'),
      png = await download('export-png', String(width), 'png');
    assert.equal(JSON.stringify(JSON.parse(saved)), after);
    const svgPixels = await pixels(svg);
    assert.deepEqual(svgPixels.samples[0], [0, 255, 0, 255]);
    assert.deepEqual(await pixels(png, 'image/png'), svgPixels);
    const positions = JSON.parse(after).layers.map((layer) =>
      svg.indexOf(`data-layer="${layer.name}"`),
    );
    assert.ok(positions.every((index) => index >= 0));
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
    );
    await page.screenshot({
      path: `test-results/artwork-ordering-${width}-after.png`,
      fullPage: true,
    });
    await page.reload();
    await page.waitForSelector('.shape');
    await load(JSON.parse(saved));
    assert.equal(await snapshot(), after);
    assert.deepEqual(await pixels(await exported()), svgPixels);
    assert.deepEqual(await canvasColor(), [0, 255, 0, 255]);
    await order(target.id, 'backward').focus();
    await order(target.id, 'backward').press('Space');
    assert.equal(await snapshot(), before);
    assert.equal(
      await order(target.id, 'backward').evaluate((el) => document.activeElement === el),
      true,
    );
    assert.deepEqual(await canvasColor(), [0, 0, 255, 255], 'actual canvas responds to Backward');
    // Reopen the exported SVG through the existing import path and compare all pixels.
    await page.evaluate(async (svg) => {
      const { importSVG } = await import('/src/svg-import.js');
      window.nect.load(JSON.stringify(importSVG(svg)));
    }, svg.toString());
    assert.deepEqual(await pixels(await exported()), svgPixels);
    const guideDoc = orderingDocument();
    guideDoc.layers[1].guide = true;
    await load(guideDoc);
    const controls = await page
      .locator(`.layer[data-layer="${guideDoc.layers[1].id}"]`)
      .evaluate((row) => {
        const guide = row.querySelector('[data-layer-guide]').getBoundingClientRect(),
          lock = row.querySelector('[data-layer-lock]').getBoundingClientRect();
        return {
          guideRight: guide.right,
          lockLeft: lock.left,
          rowRight: row.getBoundingClientRect().right,
          guideTextFits:
            row.querySelector('[data-layer-guide]').scrollWidth <=
            row.querySelector('[data-layer-guide]').clientWidth,
        };
      });
    assert.ok(
      controls.guideRight <= controls.lockLeft &&
        controls.rowRight <= width &&
        controls.guideTextFits,
      'Guide label does not overlap lock control',
    );
  }

  const locked = orderingDocument(),
    target = locked.layers[1];
  target.locked = true;
  await load(locked);
  let before = await snapshot();
  assert.equal(await order(target.id).evaluate((el) => el.disabled), true);
  await force(target.id);
  assert.equal(await snapshot(), before);
  target.locked = false;
  locked.layers[2].locked = true;
  await load(locked);
  await order(target.id).click();
  assert.deepEqual(JSON.parse(await snapshot()).layers[1], locked.layers[2]);
  for (const kind of ['hidden', 'guide', 'empty', 'complex', 'gradient', 'large-curve', 'image']) {
    const doc = kind === 'complex' ? makeDoc() : orderingDocument();
    let target = doc.layers[0];
    if (kind === 'complex') doc.layers.push(blankLayer());
    if (kind === 'hidden') target.visible = false;
    if (kind === 'guide') target.guide = true;
    if (kind === 'empty') {
      target = blankLayer();
      doc.layers[0] = target;
    }
    if (['gradient', 'large-curve', 'image'].includes(kind)) target = unsupportedLayer(doc, kind);
    await load(doc);
    const before = await snapshot(),
      index = doc.layers.indexOf(target);
    await order(target.id).click();
    assert.deepEqual(JSON.parse(await snapshot()).layers[index + 1], target, kind);
    await click('undo');
    assert.equal(await snapshot(), before, kind);
  }
  // Actual two-point detached Pen draft is neither committed nor cancelled.
  const busy = orderingDocument(),
    id = busy.layers[1].id;
  await load(busy);
  await select(id);
  await page.locator('[data-tool="pen"]').click();
  for (const p of [
    [90, 90],
    [150, 120],
  ])
    await page.mouse.click(...(await xy(p)));
  before = await snapshot();
  const draft = await page.locator('[data-pen-draft]').textContent(),
    preview = await page.locator('.artboard').innerHTML();
  assert.equal(await order(id).evaluate((el) => el.disabled), true);
  await force(id);
  assert.equal(await snapshot(), before);
  assert.equal(await page.locator('[data-pen-draft]').textContent(), draft);
  assert.equal(await page.locator('.artboard').innerHTML(), preview);
  await page.locator('[data-pen-cancel]').click();
  assert.equal(await page.locator('[data-action="undo"]').isEnabled(), false);
  // Active pointer/wire/numeric gestures retain ownership on forced row events.
  for (const kind of ['wire', 'node', 'artwork', 'numeric']) {
    await load(busy);
    await select(id);
    const shape = busy.layers[1].nodes[0];
    if (kind === 'numeric')
      await page.locator(`.node[data-id="${shape.id}"] .node-head strong`).click();
    const locator =
      kind === 'wire'
        ? page.locator('.node .output').first()
        : kind === 'node'
          ? page.locator('.node .node-head').first()
          : kind === 'numeric'
            ? page
                .locator(`.node[data-id="${shape.id}"] input[type="number"][data-scrub-step]`)
                .first()
            : page.locator(`.shape[data-layer="${id}"]`);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    before = await snapshot();
    assert.equal(await order(id).evaluate((el) => el.disabled), true, kind);
    await force(id);
    assert.equal(await snapshot(), before, kind);
    await page.mouse.up();
  }
  await load(busy);
  await select(id);
  await page.locator(`[data-select-layer="${id}"]`).press('F2');
  const rename = page.locator('[data-rename-name]');
  await rename.fill('Uncommitted name');
  before = await snapshot();
  const refusedControl = await order(id).boundingBox();
  await page.mouse.click(
    refusedControl.x + refusedControl.width / 2,
    refusedControl.y + refusedControl.height / 2,
  );
  assert.equal(await snapshot(), before, 'disabled pointer attempt does not blur/commit rename');
  assert.equal(await rename.inputValue(), 'Uncommitted name');
  await force(id);
  assert.equal(await snapshot(), before);
  assert.equal(await rename.inputValue(), 'Uncommitted name');
  await rename.press('Escape');
  for (const event of ['compositionstart', 'compositionend']) {
    await page.locator('.canvas-stage').dispatchEvent(event, { bubbles: true });
    if (event === 'compositionstart') {
      assert.equal(await order(id).evaluate((el) => el.disabled), true);
      await force(id);
      assert.equal(await snapshot(), before);
    }
  }
  for (const native of [false, true]) {
    await click('help');
    await force(id);
    assert.equal(await snapshot(), before);
    if (native) await page.locator('dialog').evaluate((dialog) => dialog.close());
    else await page.locator('dialog button').click();
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-order-layer="${id}"]`).disabled,
      id,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS safe layer ordering: 3-color actual canvas, Forward/Backward keyboard focus, SVG/PNG/reopen, exact order/selection/history, boundary/Redo, locks, complex/hidden/guide/empty records, live Pen and edit guards, 1280/1600 controls.',
  );
} finally {
  await browser.close();
}
