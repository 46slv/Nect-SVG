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
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const screen = (point) =>
  page.locator('.artboard').evaluate((svg, point) => {
    const p = new DOMPoint(...point).matrixTransform(svg.getScreenCTM());
    return [p.x, p.y];
  }, point);
const loadFixture = (kind = 'simple') =>
  page.evaluate(async (kind) => {
    const { document, node, connect } = await import('/src/core.js');
    const { appendArtwork } = await import('/src/artwork-creation.js');
    const d = document();
    d.width = 800;
    d.height = 500;
    d.layers[0].visible = false;
    const first = appendArtwork(d, 'Rectangle', { at: [200, 200] });
    const second = appendArtwork(d, 'Circle', { at: [600, 250] });
    const l = d.layers.find((l) => l.id === first.layerId);
    l.nodes.unshift(node('Null'));
    if (kind === 'transform') {
      const tr = node('Transform');
      tr.params.scale.value = -0.8;
      tr.params.rotation.value = 25;
      tr.params.anchor.value = [200, 200];
      tr.params.offset.value = [50, 50];
      l.nodes.push(tr);
      connect(l, first.nodeId, tr.id, 'path');
      connect(l, tr.id, l.nodes.find((n) => n.type === 'Fill').id, 'path');
      first.transform = tr.id;
    } else if (kind === 'repeater') {
      const rep = node('Geometry Repeater');
      rep.params.count.value = 3;
      rep.params.step.value = [30, 0];
      l.nodes.push(rep);
      connect(l, first.nodeId, rep.id, 'path');
      connect(l, rep.id, l.nodes.find((n) => n.type === 'Fill').id, 'path');
    } else if (kind === 'gradient') {
      const paint = node('Linear Gradient Fill');
      l.nodes.push(paint);
      connect(l, first.nodeId, paint.id, 'path');
      connect(l, paint.id, l.output, 'path');
    } else if (kind === 'locked') l.locked = true;
    else if (kind === 'driven') {
      const v = node('Vector');
      v.params.value.value = [200, 200];
      l.nodes.push(v);
      connect(l, v.id, first.nodeId, 'center');
    }
    for (const layer of d.layers)
      layer.nodes.forEach((n, i) => {
        n.position = [40 + i * 310, 50];
      });
    window.nect.load(JSON.stringify(d));
    return { first, second };
  }, kind);
const position = (ids) =>
  page.evaluate((ids) => {
    const l = window.nect.document.layers.find((l) => l.id === ids.layerId);
    const n = l.nodes.find((n) => n.id === (ids.transform || ids.nodeId));
    return n.params[ids.transform ? 'offset' : 'center'].value;
  }, ids);
const drag = async (from, delta, end = 'up') => {
  const a = await screen(from),
    b = await screen(from.map((v, i) => v + delta[i]));
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move(...b, { steps: 5 });
  if (end === 'Escape') await page.keyboard.press('Escape');
  else if (end !== 'up')
    await page.evaluate((end) => {
      const stage = document.querySelector('.canvas-stage');
      if (end === 'blur') window.dispatchEvent(new Event('blur'));
      else if (end === 'capture') stage.releasePointerCapture(1);
      else stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    }, end);
  await page.mouse.up();
};
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.001, `${a} != ${b}`));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  await page.evaluate(() => {
    const d = structuredClone(window.nect.document);
    d.layers[0].locked = true;
    d.layers[0].visible = false;
    window.nect.load(JSON.stringify(d));
  });
  for (const type of ['Circle', 'Rectangle', 'Polygon', 'Star', 'Text']) {
    const before = JSON.parse(await saved());
    await page.locator(`[data-tool="${type}"]`).click();
    const after = JSON.parse(await saved());
    assert.deepEqual(after.layers.slice(0, -1), before.layers);
    assert.equal(after.layers.at(-1).nodes[0].type, type);
    assert.equal(after.layers.at(-1).nodes.length, 3);
    assert.equal(await page.locator('.node.selected').count(), 0);
    assert.match(await page.locator('.inspector-body').innerText(), /Artwork/);
    assert.equal(
      await page.locator('.canvas-stage').evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator('[data-action="undo"]').click();
    assert.deepEqual(JSON.parse(await saved()), before);
    await page.locator('[data-action="redo"]').click();
    assert.deepEqual(JSON.parse(await saved()), after);
    assert.match(await page.locator('.inspector-body').innerText(), /Artwork/);
  }
  assert.equal(await page.locator('.shape').count(), 5);
  const creationSVG = await page.evaluate(() => window.nect.export());
  assert.equal((creationSVG.match(/data-layer=/g) || []).length, 5);
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-artwork-creation.${ext}`);
  }
  const json = await fs.readFile('test-results/workflow-artwork-creation.json', 'utf8');
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await page.evaluate(() => window.nect.export()), creationSVG);
  assert.doesNotMatch(creationSVG, /node-stage|artwork-selection|data-node-stage/);
  for (const kind of ['simple', 'transform']) {
    const { first, second } = await loadFixture(kind),
      before = await saved(),
      origin = await position(first);
    const point = kind === 'transform' ? [250, 250] : [200, 200];
    await page.locator(`[data-select-layer="${first.layerId}"]`).click();
    await page.locator(`.node[data-id="${first.nodeId}"] .node-head strong`).click();
    const hitPoint = await screen(point);
    assert.equal(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-layer]')?.dataset.layer,
        hitPoint,
      ),
      first.layerId,
      'Final artwork interior stays selectable while source node is selected',
    );
    const seedBefore = await page.evaluate(
      (id) =>
        JSON.stringify(
          window.nect.document.layers.flatMap((l) => l.nodes).find((n) => n.id === id),
        ),
      first.nodeId,
    );
    await drag(point, [20, 10]);
    near(
      await position(first),
      origin.map((v, i) => v + [20, 10][i]),
    );
    near(await position(second), [600, 250]);
    if (kind === 'transform')
      assert.equal(
        await page.evaluate(
          (id) =>
            JSON.stringify(
              window.nect.document.layers.flatMap((l) => l.nodes).find((n) => n.id === id),
            ),
          first.nodeId,
        ),
        seedBefore,
        'Artwork movement never rewrites the seed',
      );
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    await page.locator(`[data-select-layer="${first.layerId}"]`).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    near(
      await position(first),
      origin.map((v, i) => v + [1, 10][i]),
    );
    await page.locator('[data-action="undo"]').click();
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    for (const end of ['Escape', 'capture', 'cancel', 'blur']) {
      await drag(point, [20, 10], end);
      assert.equal(await saved(), before, `${kind}/${end}`);
    }
    // A hit on a different layer resolves that complete layer before starting a drag.
    await drag([600, 250], [-15, 8]);
    near(await position(second), [585, 258]);
    near(await position(first), origin);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    await drag([760, 460], [-30, -20]);
    assert.equal(await saved(), before);
    await page.keyboard.press('ArrowRight');
    assert.equal(await saved(), before);
  }
  // Capture ordinary final-artwork selection separately from the intentional handle-overlap fixture.
  const practical = await loadFixture();
  await page.locator(`[data-select-layer="${practical.first.layerId}"]`).click();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-action="undo"]').click();
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-action="fit"]').click();
    await page.screenshot({
      path: `test-results/artwork-selection-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }
  for (const kind of ['repeater', 'gradient', 'locked', 'driven']) {
    const { first } = await loadFixture(kind),
      before = await saved();
    await page.locator(`[data-select-layer="${first.layerId}"]`).click();
    assert.match(
      await page.locator('.artwork-move-status').innerText(),
      /supported|Unlock|connected|connections/,
    );
    await page.keyboard.press('ArrowRight');
    await drag([200, 200], [30, 20]);
    assert.equal(await saved(), before, kind);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  const { first } = await loadFixture('transform');
  await page.locator(`[data-select-layer="${first.layerId}"]`).click();
  await page.locator(`.node[data-id="${first.nodeId}"] .node-head strong`).click();
  assert.match(await page.locator('.hint').innerText(), /Node .*before downstream nodes/);
  assert.equal(await page.locator('[data-object-resize]').count(), 2);
  assert.equal(
    await page.locator('.node-stage-hit').evaluate((el) => getComputedStyle(el).pointerEvents),
    'stroke',
  );
  assert.equal(
    await page.locator('.node-stage-hit').evaluate((el) => getComputedStyle(el).fill),
    'none',
  );
  // Exact overlap regression: the 20px marker used to cover Rotate, six screen px away.
  const overlapTransform = await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      r = node('Rectangle'),
      tr = node('Transform'),
      fill = node('Fill'),
      out = node('Output');
    d.width = 800;
    d.height = 500;
    r.params.center.value = [400, 300];
    tr.params.anchor.value = [400, 300];
    tr.params.rotation.value = -140.71059313749964;
    l.nodes = [r, tr, fill, out];
    l.output = out.id;
    connect(l, r.id, tr.id, 'path');
    connect(l, tr.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    l.nodes.forEach((n, i) => {
      n.position = [40 + i * 310, 50];
    });
    window.nect.load(JSON.stringify(d));
    return tr.id;
  });
  await page.locator(`[data-id="${overlapTransform}"] .node-head strong`).click();
  await page.locator('[data-action="actual-size"]').click();
  const controls = await page.locator('[data-transform-handle]').evaluateAll((els) =>
    els.map((el) => {
      const p = new DOMPoint(0, 0).matrixTransform(el.getScreenCTM());
      return (
        document.elementFromPoint(p.x, p.y)?.closest('[data-transform-handle]')?.dataset
          .transformHandle === el.dataset.transformHandle
      );
    }),
  );
  assert.deepEqual(controls, [true, true]);
  // At low zoom the stroke corridor remains narrow and empty artboard stays empty.
  for (let i = 0; i < 5; i++) await page.locator('[data-action="zoom-out"]').click();
  const blank = await screen([760, 460]);
  assert.equal(
    await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-node-stage-move]'),
      blank,
    ),
    false,
  );
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-action="fit"]').click();
    await page.screenshot({
      path: `test-results/artwork-workflow-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS independent artwork creation, preservation, selection, terminal-transform XY, nudge, history, interruption, read-only reasons, node-stage controls and 1280/1600 screenshots',
  );
} catch (error) {
  console.error('Artwork workflow status:', await page.locator('.status').innerText());
  await page.screenshot({ path: 'test-results/artwork-workflow-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
