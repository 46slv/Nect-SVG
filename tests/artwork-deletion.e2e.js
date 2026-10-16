import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { blankLayer, document as makeDoc, node, serialize } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';
import { deletionDocument, unsupportedLayer } from './fixtures/artwork-deletion.js';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (dialog) => dialog.accept());
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document)),
  load = (doc) => page.evaluate((text) => window.nect.load(text), serialize(doc)),
  stage = () => page.locator('.canvas-stage'),
  deletion = (id) => page.locator(`[data-delete-layer="${id}"]`),
  select = (id) => page.locator(`[data-select-layer="${id}"]`).click(),
  click = (action) => page.locator(`[data-action="${action}"]`).click(),
  clear = async (expectArtboardFocus = true) => {
    assert.equal(
      await page.locator('.node.selected,.artwork-selection,.character-floating').count(),
      0,
    );
    if (expectArtboardFocus)
      assert.equal(
        await page.evaluate(() => document.activeElement.matches('.canvas-stage')),
        true,
      );
  },
  forceDelete = (id) =>
    page.evaluate(
      (id) =>
        document
          .querySelector(`[data-delete-layer="${id}"]`)
          .dispatchEvent(new MouseEvent('click', { bubbles: true })),
      id,
    ),
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
  download = async (action, name) => {
    const pending = page.waitForEvent('download');
    await click(action);
    const path = `test-results/workflow-artwork-deletion-${name}`;
    await (await pending).saveAs(path);
    return fs.readFile(path, 'utf8');
  };
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: width === 1600 ? 1000 : 800 });
    const doc = deletionDocument(),
      target = doc.layers[1],
      survivors = [doc.layers[0], doc.layers[2]];
    await load(doc);
    await page.locator(`.shape[data-layer="${target.id}"]`).click();
    assert.equal(await page.locator('.artwork-selection').count(), 1);
    assert.equal(await page.locator('.node.selected').count(), 0);
    const before = await snapshot();
    await page.screenshot({
      path: `test-results/artwork-deletion-${width}-selected.png`,
      fullPage: true,
    });
    await stage().press('Delete');
    const after = await snapshot();
    assert.deepEqual(JSON.parse(after).layers, survivors);
    assert.deepEqual({ ...JSON.parse(after), layers: [] }, { ...JSON.parse(before), layers: [] });
    assert.equal(await page.locator('.layer.selected').getAttribute('data-layer'), survivors[1].id);
    await clear();
    await stage().press('Delete');
    await stage().press('Delete');
    assert.equal(await snapshot(), after);
    await click('undo');
    assert.equal(await snapshot(), before);
    assert.equal(await page.locator('.artwork-selection').count(), 1);
    await click('redo');
    assert.equal(await snapshot(), after);
    // Toolbar history uses the existing control-focus rules, including disabled Redo.
    // Keep the cleared-selection assertion; direct layer deletion still checks native stage focus.
    await clear(false);
    const saved = await download('save', `${width}.json`),
      svg = await download('export', `${width}.svg`);
    assert.deepEqual(JSON.parse(saved), JSON.parse(after));
    assert.ok(!svg.includes(target.name));
    assert.ok(svg.includes(doc.layers[2].name));
    await page.screenshot({
      path: `test-results/artwork-deletion-${width}-after.png`,
      fullPage: true,
    });
    await page.reload();
    await page.waitForSelector('.shape');
    await load(JSON.parse(saved));
    assert.equal(await snapshot(), after);
  }

  // The action names its exact target even while another layer is active.
  for (const mode of ['hidden', 'guide', 'empty']) {
    const doc = deletionDocument(),
      target = doc.layers[0];
    if (mode === 'hidden') target.visible = false;
    if (mode === 'guide') target.guide = true;
    await load(doc);
    await select(doc.layers[2].id);
    await deletion(target.id).click();
    await clear();
    assert.deepEqual(JSON.parse(await snapshot()).layers, doc.layers.slice(1));
    await click('undo');
    assert.deepEqual(JSON.parse(await snapshot()), doc);
  }
  // Guides retain keyboard Delete priority when an artwork selection is also present.
  for (const locked of [false, true]) {
    const doc = deletionDocument(),
      guide = doc.editor.guides[0];
    guide.locked = locked;
    await load(doc);
    await select(doc.layers[1].id);
    await click('guides-panel');
    await page.locator(`[data-select-guide="${guide.id}"]`).click();
    await stage().press('Delete');
    const after = JSON.parse(await snapshot());
    assert.deepEqual(after.layers, doc.layers);
    assert.equal(after.editor.guides.length, locked ? 1 : 0);
    if (locked) assert.deepEqual(after, doc);
    await click('guides-panel');
  }
  const locked = deletionDocument(),
    lockedId = locked.layers[1].id;
  locked.layers[1].locked = true;
  await load(locked);
  await select(lockedId);
  const lockedBefore = await snapshot();
  assert.equal(await deletion(lockedId).isDisabled(), true);
  await forceDelete(lockedId);
  await stage().press('Delete');
  assert.equal(await snapshot(), lockedBefore);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);

  // Unsupported movement never limits deletion.
  for (const kind of ['complex', 'gradient', 'image', 'large-curve']) {
    const doc = kind === 'complex' ? makeDoc() : deletionDocument(),
      target = kind === 'complex' ? doc.layers[0] : unsupportedLayer(doc, kind);
    await load(doc);
    await select(target.id);
    const before = await snapshot();
    await stage().press('Delete');
    assert.ok(!JSON.parse(await snapshot()).layers.some((layer) => layer.id === target.id));
    await clear();
    await click('undo');
    assert.equal(await snapshot(), before);
  }

  const doc = deletionDocument(),
    id = doc.layers[1].id;
  await load(doc);
  await select(id);
  const before = await snapshot();
  await page.locator('.graph-scroll').press('Delete');
  await deletion(id).press('Delete');
  await stage().press('Control+Delete');
  assert.equal(await snapshot(), before);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('data-test-input', '');
    document.querySelector('#app').append(input);
  });
  await page.locator('[data-test-input]').press('Delete');
  assert.equal(await snapshot(), before);
  await stage().dispatchEvent('compositionstart', { bubbles: true });
  assert.equal(await deletion(id).isDisabled(), true);
  await forceDelete(id);
  await stage().press('Delete');
  await stage().dispatchEvent('compositionend', { bubbles: true });
  assert.equal(await snapshot(), before);
  await click('help');
  assert.equal(await deletion(id).isDisabled(), true);
  await forceDelete(id);
  await page.keyboard.press('Delete');
  assert.equal(await snapshot(), before);
  await page.locator('dialog button').click();
  assert.equal(await deletion(id).isDisabled(), false);
  await click('help');
  assert.equal(await deletion(id).isDisabled(), true);
  await page.keyboard.press('Escape');
  // Native close changes `open` before its queued close-event control refresh.
  await page.waitForFunction(
    (id) =>
      !document.querySelector('dialog[open]') &&
      document.querySelector(`[data-delete-layer="${id}"]`)?.disabled === false,
    id,
    { timeout: 2000 },
  );
  assert.equal(await deletion(id).isDisabled(), false);
  assert.equal(await snapshot(), before);

  // Real textarea composition has its own draft state, cleared during bubbling.
  const textDoc = deletionDocument(),
    text = appendArtwork(textDoc, 'Text', { at: [300, 200] });
  await load(textDoc);
  await select(text.layerId);
  await page.locator(`[data-rename-node="${text.nodeId}"]`).click();
  const textInput = page.locator(`.inspector-body [data-text="${text.nodeId}"]`),
    textBefore = await snapshot();
  await textInput.dispatchEvent('compositionstart', { bubbles: true });
  assert.equal(await deletion(text.layerId).isDisabled(), true);
  await forceDelete(text.layerId);
  await textInput.dispatchEvent('compositionend', { bubbles: true });
  assert.equal(await deletion(text.layerId).isDisabled(), false);
  assert.equal(await snapshot(), textBefore);
  await load(doc);
  await select(id);

  // A live detached Pen draft is retained, including an actively held point.
  await page.locator('[data-tool="pen"]').click();
  await point([120, 100]);
  await point([300, 180]);
  const drawing = await page.locator('.artboard').innerHTML();
  assert.equal(await deletion(id).isDisabled(), true);
  await forceDelete(id);
  await stage().press('Delete');
  assert.equal(await snapshot(), before);
  assert.equal(await page.locator('.artboard').innerHTML(), drawing);
  await page.mouse.move(...(await xy([420, 300])));
  await page.mouse.down();
  await forceDelete(id);
  await page.keyboard.press('Delete');
  assert.equal(await snapshot(), before);
  await page.mouse.up();
  assert.equal(await page.locator('[data-pen-draft]').count(), 1);
  await page.locator('[data-pen-cancel]').click();
  assert.equal(await snapshot(), before);

  // The current gesture owns its snapshot until release or cancellation.
  for (const kind of ['wire', 'node', 'artwork']) {
    await load(doc);
    await select(id);
    const target =
      kind === 'wire'
        ? page.locator('.node .output').first()
        : kind === 'node'
          ? page.locator('.node .node-head').first()
          : page.locator(`.shape[data-layer="${id}"]`);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal(await deletion(id).isDisabled(), true, kind);
    await forceDelete(id);
    await page.keyboard.press('Delete');
    assert.equal(await snapshot(), before, kind);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await snapshot(), before, kind);
    assert.equal(await deletion(id).isDisabled(), false, kind);
  }

  // Stale explicit IDs and held keys cannot cascade into the new active neighbor.
  await load(doc);
  await deletion(id).click();
  const deleted = await snapshot();
  await page.evaluate((id) => {
    const stale = document.createElement('button');
    stale.dataset.deleteLayer = id;
    stale.textContent = 'Stale target';
    document.querySelector('#app').append(stale);
    stale.click();
  }, id);
  assert.equal(await snapshot(), deleted);
  await stage().press('Delete');
  assert.equal(await snapshot(), deleted);

  const last = deletionDocument();
  last.layers = [last.layers[1]];
  await load(last);
  await select(last.layers[0].id);
  await stage().press('Delete');
  const blank = JSON.parse(await snapshot());
  assert.equal(blank.layers.length, 1);
  assert.equal(blank.layers[0].allowEmptyOutput, true);
  assert.equal(blank.layers[0].nodes.length, 1);
  assert.deepEqual({ ...blank, layers: [] }, { ...last, layers: [] });
  assert.equal(await page.locator('.shape,.warning').count(), 0);
  await clear();
  assert.equal(
    await download('export', 'last-blank.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480"></svg>',
  );
  await page.locator('[data-tool="Rectangle"]').click();
  assert.equal(JSON.parse(await snapshot()).layers.length, 2);
  assert.deepEqual(JSON.parse(await snapshot()).layers[0], blank.layers[0]);

  const full = deletionDocument();
  while (full.layers.length < 100) full.layers.push(blankLayer());
  await load(full);
  await deletion(full.layers[50].id).click();
  await page.locator('[data-tool="Circle"]').click();
  assert.equal(JSON.parse(await snapshot()).layers.length, 100);

  // Existing graph actions keep their scope; deleting a disconnected node does not delete the layer.
  const nodes = deletionDocument(),
    layer = nodes.layers[1],
    extra = node('Value', 40, 400);
  layer.nodes.push(extra);
  await load(nodes);
  await select(layer.id);
  await page.locator(`[data-duplicate="${extra.id}"]`).click();
  assert.equal(JSON.parse(await snapshot()).layers[1].nodes.length, 5);
  await page.locator(`[data-delete="${extra.id}"]`).click();
  assert.equal(JSON.parse(await snapshot()).layers.length, 3);
  assert.equal(JSON.parse(await snapshot()).layers[1].nodes.length, 4);
  assert.deepEqual(errors, []);
  console.log(
    'Whole-artwork deletion Chrome acceptance passed at 1600×1000 and 1280×800, including exact survivors/assets, history, busy rejection, blank export and capacity reuse.',
  );
} finally {
  await browser.close();
}
