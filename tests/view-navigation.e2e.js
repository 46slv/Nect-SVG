import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const stage = page.locator('.canvas-stage'),
  graph = page.locator('.graph-scroll');
const click = (action) => page.locator(`[data-action="${action}"]`).click();
const scale = () => page.locator('.artboard').evaluate((el) => el.getScreenCTM().a);
const graphScale = () => page.locator('.graph').evaluate((el) => Number(el.style.zoom));
const saved = () =>
  page.evaluate(() => [
    JSON.stringify(window.nect.document),
    window.nect.export(),
    document.querySelector('[data-action="undo"]').disabled,
  ]);
const scroll = () => graph.evaluate((el) => [el.scrollLeft, el.scrollTop]);
const center = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [r.left + el.clientWidth / 2, r.top + el.clientHeight / 2];
  });
const artPoint = (p) =>
  page.locator('.artboard').evaluate((el, p) => {
    const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM().inverse());
    return [q.x, q.y];
  }, p);
const graphPoint = (p) =>
  page.locator('.graph').evaluate((el, p) => {
    const r = el.getBoundingClientRect(),
      z = Number(el.style.zoom);
    return [(p[0] - r.left) / z, (p[1] - r.top) / z];
  }, p);
const near = (a, b, epsilon = 1) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${a} ≈ ${b}`));
async function wheelAt(locator, dx, dy, modifier) {
  const p = await center(locator);
  await page.mouse.move(...p);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.wheel(dx, dy);
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(60);
}
async function truthful() {
  const actual = await scale(),
    label = await page.locator('[data-zoom="canvas"]').textContent();
  assert.ok(Math.abs(parseFloat(label) / 100 - actual) <= 0.005, `${label} reports ${actual}`);
}
async function fitVisible(selector = '.node') {
  const data = await graph.evaluate((el, selector) => {
    const r = el.getBoundingClientRect();
    return {
      view: { x: r.x, y: r.y, width: el.clientWidth, height: el.clientHeight },
      cards: [...el.querySelectorAll(selector)].map((card) => {
        const b = card.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }),
    };
  }, selector);
  assert.ok(data.cards.length);
  for (const b of data.cards) {
    assert.ok(b.x >= data.view.x && b.y >= data.view.y, JSON.stringify(data));
    assert.ok(
      b.x + b.width <= data.view.x + data.view.width + 1 &&
        b.y + b.height <= data.view.y + data.view.height + 1,
      JSON.stringify(data),
    );
  }
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(400);
  await fs.mkdir('test-results', { recursive: true });
  const ids = await page.evaluate(async () => {
    const { document: make, node } = await import('/src/core.js');
    const d = make(),
      rect = node('Rectangle', 100, 70),
      text = node('Text', 530, 130),
      out = node('Output', 1450, 60);
    text.text = 'View navigation';
    out.params.path.source = rect.id;
    out.collapsed = true;
    d.layers[0].nodes = [rect, text, out];
    d.layers[0].output = out.id;
    window.nect.load(JSON.stringify(d));
    return [rect.id, text.id, out.id];
  });
  await page.waitForTimeout(100);
  const original = await saved();
  await truthful();
  await click('actual-size');
  assert.equal(await scale(), 1);
  assert.equal(
    await stage.evaluate((el) => el === document.activeElement),
    true,
    'pointer view buttons focus their surface',
  );
  // Actual mouse wheel, pointer anchor and independent graph state.
  let p = await center(stage),
    before = await artPoint(p);
  await wheelAt(stage, 0, -110, 'Control');
  near(await artPoint(p), before, 0.01);
  assert.equal(await graphScale(), 1);
  await truthful();
  const rectBefore = await page.locator('.artboard').boundingBox();
  await wheelAt(stage, 30, 45);
  const rectAfter = await page.locator('.artboard').boundingBox();
  near([rectAfter.x - rectBefore.x, rectAfter.y - rectBefore.y], [-30, -45], 0.01);
  // Shift-only vertical wheel has explicit horizontal semantics.
  const beforeShift = await page.locator('.artboard').boundingBox();
  await stage.dispatchEvent('wheel', { deltaX: 0, deltaY: 25, shiftKey: true });
  const afterShift = await page.locator('.artboard').boundingBox();
  near([afterShift.x - beforeShift.x, afterShift.y - beforeShift.y], [-25, 0], 0.01);
  // The center world point survives toolbar zoom and viewport resize in manual mode.
  await click('actual-size');
  const centerWorld = async () => {
    const r = await stage.boundingBox();
    return artPoint([r.x + r.width / 2, r.y + r.height / 2 + 10]);
  };
  before = await centerWorld();
  await click('zoom-in');
  near(await centerWorld(), before, 0.01);
  await page.setViewportSize({ width: 1280, height: 800 });
  near(await centerWorld(), before, 0.01);
  assert.ok(Math.abs((await scale()) - 1.2) < 1e-6);
  // Fit follows resizing; manual 100% does not.
  await click('fit');
  const smallFit = await scale();
  await truthful();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(
    (previous) => document.querySelector('.artboard')?.getScreenCTM()?.a > previous,
    smallFit,
    { timeout: 5000 },
  );
  assert.ok((await scale()) > smallFit);
  await truthful();
  await click('actual-size');
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await scale(), 1);
  // Graph anchor away from the deliberate nonnegative origin clamp.
  await click('graph-reset');
  await graph.evaluate((el) => {
    el.scrollLeft = 400;
    el.scrollTop = 200;
  });
  p = await center(graph);
  before = await graphPoint(p);
  await wheelAt(graph, 0, -100, 'Control');
  near(await graphPoint(p), before, 1);
  assert.equal(await scale(), 1);
  before = await graphPoint(await center(graph));
  await click('graph-zoom-in');
  near(await graphPoint(await center(graph)), before, 1);
  // Full measured expanded Text height must fit, not only the title or 2400x1600 floor.
  await click('graph-fit');
  await fitVisible();
  assert.ok((await graphScale()) < 1);
  await click('graph-fit-selection');
  await fitVisible('.node.selected');
  // Centering a far-edge selection survives unrelated structural redraw and a frame.
  await page.locator(`.node[data-id="${ids[2]}"] .node-head strong`).click();
  await click('graph-fit-selection');
  const centeredScroll = await scroll();
  const centeredCard = await page.locator(`.node[data-id="${ids[2]}"]`).boundingBox();
  await click('guides-panel');
  await page.waitForTimeout(80);
  near(await scroll(), centeredScroll, 1);
  const afterRenderCard = await page.locator(`.node[data-id="${ids[2]}"]`).boundingBox();
  near([afterRenderCard.x, afterRenderCard.y], [centeredCard.x, centeredCard.y], 1);
  await click('guides-panel');
  await page
    .locator(`.node[data-id="${ids[2]}"] .node-head strong`)
    .click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('[data-action="graph-fit-selection"]').isDisabled(), true);
  await graph.focus();
  await page.keyboard.press('Shift+2');
  await click('graph-fit');
  await page.locator(`.node[data-id="${ids[0]}"] .node-head strong`).click();
  // Focus-scoped keyboard shortcuts and native button Space.
  await stage.focus();
  await page.keyboard.press('Control+1');
  assert.equal(await scale(), 1);
  await page.keyboard.press('+');
  assert.ok(Math.abs((await scale()) - 1.2) < 1e-6);
  await page.keyboard.press('Shift+1');
  await truthful();
  await graph.focus();
  await page.keyboard.press('Control+1');
  assert.equal(await graphScale(), 1);
  await page.keyboard.press('Shift+1');
  await fitVisible();
  await page.keyboard.press('Shift+2');
  await fitVisible('.node.selected');
  const zoomButton = page.locator('[data-action="zoom-in"]');
  await zoomButton.focus();
  const oldScale = await scale(),
    oldInlineWidth = await page.locator('.artboard').evaluate((el) => parseFloat(el.style.width));
  await page.keyboard.press('Space');
  const nextScale = await scale(),
    documentWidth = await page.evaluate(() => window.nect.document.width);
  const nextInlineWidth = await page
    .locator('.artboard')
    .evaluate((el) => parseFloat(el.style.width));
  assert.ok(
    Math.abs(nextInlineWidth - oldInlineWidth * 1.2) < 0.001,
    JSON.stringify({ oldInlineWidth, nextInlineWidth }),
  );
  // Compare rendered distance: CSS subpixel layout rounds a fitted SVG before/after zoom.
  // This still rejects missed activation or a visible scale error (tolerance 0.1 CSS px).
  assert.ok(
    Math.abs(nextScale - oldScale * 1.2) * documentWidth < 0.1,
    JSON.stringify({
      oldScale,
      nextScale,
      expected: oldScale * 1.2,
      documentWidth,
      errorPx: Math.abs(nextScale - oldScale * 1.2) * documentWidth,
    }),
  );
  assert.equal(await zoomButton.evaluate((el) => el === document.activeElement), true);
  // No document/history/export effects from any preceding view operation.
  assert.deepEqual(await saved(), original);
  // Toolbar readability at both supported sizes and fitted evidence.
  for (const [width, height] of [
    [1280, 800],
    [1600, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await click('fit');
    await click('graph-fit');
    await fitVisible();
    await truthful();
    const layout = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.canvas-toolbar button,.graph-toolbar button,.graph-toolbar select,.graph-toolbar output',
        ),
      ].map((el) => {
        const a = el.getBoundingClientRect(),
          b = el.closest('[role="toolbar"]').getBoundingClientRect();
        return {
          text: el.textContent,
          visible: a.width > 0 && a.x >= b.x && a.right <= b.right + 1,
        };
      }),
    );
    assert.ok(
      layout.every((el) => el.visible),
      JSON.stringify(layout),
    );
    await page.screenshot({ path: `test-results/view-navigation-${width}x${height}.png` });
  }
  // Tall Inspector retains actual sidebar scroll and typed drafts on view updates/rerender.
  await click('graph-reset');
  await page.locator(`.node[data-id="${ids[1]}"] .node-head strong`).click();
  const textarea = page.locator('.inspector-body textarea');
  await textarea.fill('Uncommitted draft');
  await page.locator('.right').evaluate((el) => {
    el.scrollTop = 350;
  });
  const sidebar = await page.locator('.right').evaluate((el) => el.scrollTop);
  assert.ok(sidebar > 0);
  await stage.dispatchEvent('wheel', { ctrlKey: true, deltaY: -80, clientX: 350, clientY: 200 });
  assert.equal(await textarea.inputValue(), 'Uncommitted draft');
  assert.equal(await textarea.evaluate((el) => el === document.activeElement), true);
  assert.equal(await page.locator('.right').evaluate((el) => el.scrollTop), sidebar);
  // IME simulation: no browser navigation on the surface, no input wheel interception.
  await textarea.dispatchEvent('compositionstart', { data: 'あ' });
  const duringIME = await scale();
  await stage.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await page.locator('[data-action="zoom-in"]').evaluate((el) => el.click());
  assert.equal(await scale(), duringIME);
  await textarea.dispatchEvent('compositionend', { data: 'あ' });
  await textarea.fill('View navigation');
  await textarea.press('Tab');
  await page.waitForTimeout(100);
  await page.locator('.right').evaluate((el) => {
    el.scrollTop = 350;
  });
  const beforeRender = await page.locator('.right').evaluate((el) => el.scrollTop);
  await click('guides-panel');
  assert.equal(await page.locator('.right').evaluate((el) => el.scrollTop), beforeRender);
  // Busy wheel over an actual node field cannot native-scroll beneath a scrub.
  await click('graph-reset');
  const numeric = page
    .locator(`.node[data-id="${ids[0]}"] input[type="number"][data-scrub-step]`)
    .first();
  await numeric.scrollIntoViewIfNeeded();
  const b = await numeric.boundingBox();
  await page.mouse.move(b.x + 10, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 25, b.y + b.height / 2);
  const busyScroll = await scroll(),
    busyScale = await graphScale();
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(60);
  assert.deepEqual(await scroll(), busyScroll);
  await graph.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  assert.equal(await graphScale(), busyScale);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Large valid artboards never zoom in on a zoom-out gesture after fitting below 1%.
  await page.evaluate(() => {
    const d = structuredClone(window.nect.document);
    d.width = 100000;
    d.height = 100000;
    window.nect.load(JSON.stringify(d));
  });
  const tiny = await scale();
  assert.ok(tiny < 0.01);
  await stage.focus();
  await page.keyboard.press('-');
  assert.ok((await scale()) < tiny);
  await click('fit');
  await stage.dispatchEvent('wheel', { ctrlKey: true, deltaY: 100, clientX: 300, clientY: 200 });
  assert.ok((await scale()) < tiny);
  assert.deepEqual(errors, []);
  console.log(
    'View navigation Chrome: truthful scale, anchors, fit, resize, scoped input/IME, sidebar, busy guards, unchanged output and 1280/1600 layout passed',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/view-navigation-failure.png' }).catch(() => {});
  const state = await page
    .evaluate(() => ({
      viewport: [innerWidth, innerHeight],
      artboard: document.querySelector('.artboard')?.getBoundingClientRect().toJSON(),
      scale: document.querySelector('.artboard')?.getScreenCTM().a,
      canvasLabel: document.querySelector('[data-zoom="canvas"]')?.textContent,
      graphZoom: document.querySelector('.graph')?.style.zoom,
      graphScroll: [
        document.querySelector('.graph-scroll')?.scrollLeft,
        document.querySelector('.graph-scroll')?.scrollTop,
      ],
      focus: {
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label'),
      },
    }))
    .catch(() => ({}));
  await fs.writeFile(
    'test-results/workflow-view-navigation-failure.json',
    JSON.stringify({ error: error.message, state }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
