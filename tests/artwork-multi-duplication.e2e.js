import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { serialize } from '../src/core.js';
import { multiDuplicationDocument } from './fixtures/artwork-duplication.js';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document)),
  load = (doc) => page.evaluate((text) => window.nect.load(text), serialize(doc)),
  click = (action) => page.locator(`[data-action="${action}"]`).click(),
  duplicate = () => page.locator('[data-duplicate-artwork]'),
  selection = () =>
    page.locator('.layer.selected').evaluateAll((els) => els.map((el) => el.dataset.layer).sort()),
  active = () => duplicate().getAttribute('data-duplicate-artwork'),
  choose = async (ids) => {
    for (const [i, id] of ids.entries())
      await page.locator(`[data-select-layer="${id}"]`).click({ modifiers: i ? ['Shift'] : [] });
  },
  force = () =>
    duplicate().evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
  download = async (action, suffix, extension) => {
    const pending = page.waitForEvent('download');
    await click(action);
    const path = `test-results/workflow-artwork-multi-duplication-${suffix}.${extension}`;
    await (await pending).saveAs(path);
    return fs.readFile(path);
  };
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  assert.equal(await page.getByRole('button', { name: 'New document', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Open JSON', exact: true }).count(), 1);
  for (const [width, height] of [
    [1600, 1000],
    [1280, 800],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    const f = multiDuplicationDocument(),
      order = [f.ids[2], f.ids[0], f.ids[3], f.ids[1]];
    await load(f.doc);
    await choose(order);
    const before = await snapshot();
    assert.equal(await duplicate().isEnabled(), true);
    assert.equal(
      await page.locator('.artwork-duplicate-status').innerText(),
      'Each copy above its source. One Undo.',
    );
    const position = await duplicate().boundingBox();
    assert.ok(
      position.y + position.height < height - 29,
      `${width} primary duplication action is visible without scrolling`,
    );
    assert.ok(
      !/Dynamic sockets|Final evaluated Output in artboard coordinates|Initial support/.test(
        await page.locator('.inspector-body').innerText(),
      ),
    );
    await duplicate().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/artwork-multi-duplication-${width}-before.png`,
      fullPage: true,
    });
    // Actual pointer click is required at every layout, including the smallest one.
    await duplicate().click();
    const after = await snapshot(),
      doc = JSON.parse(after),
      copies = doc.layers.filter((l) => !f.doc.layers.some((s) => s.id === l.id));
    assert.equal(copies.length, 4);
    assert.equal(await active(), copies[1].id);
    assert.deepEqual(await selection(), copies.map((l) => l.id).sort());
    assert.equal(await page.locator('.node.selected').count(), 0);
    assert.equal(await page.locator('.artwork-selection').count(), 4);
    assert.equal(
      await page.locator('.canvas-stage').evaluate((el) => document.activeElement === el),
      true,
    );
    assert.deepEqual(
      doc.layers.filter((l) => !copies.some((c) => c.id === l.id)),
      f.doc.layers,
    );
    f.ids.forEach((id, i) =>
      assert.equal(doc.layers[doc.layers.findIndex((l) => l.id === id) + 1].id, copies[i].id),
    );
    for (let i = 0; i < 2; i++) {
      await click('undo');
      assert.equal(await snapshot(), before);
      assert.deepEqual(await selection(), [...f.ids].sort());
      assert.equal(await active(), f.ids[1]);
      await click('redo');
      assert.equal(await snapshot(), after);
      assert.deepEqual(await selection(), copies.map((l) => l.id).sort());
      assert.equal(await active(), copies[1].id);
    }
    await duplicate().click();
    const twice = await snapshot();
    assert.equal(JSON.parse(twice).layers.length, f.doc.layers.length + 8);
    await click('undo');
    assert.equal(await snapshot(), after);
    await click('redo');
    assert.equal(await snapshot(), twice);
    await click('undo');
    // A cancelled multi-artwork gesture keeps the exact copies and selection.
    const box = await page.locator(`.shape[data-layer="${copies[0].id}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 9);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await snapshot(), after);
    assert.deepEqual(await selection(), copies.map((l) => l.id).sort());
    await duplicate().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/artwork-multi-duplication-${width}-copied.png`,
      fullPage: true,
    });
    const saved = await download('save', width, 'json'),
      svg = await download('export', width, 'svg');
    assert.equal(JSON.stringify(JSON.parse(saved)), after);
    assert.equal(svg.toString(), await page.evaluate(() => window.nect.export()));
    assert.equal((svg.toString().match(/<image /g) || []).length, 2);
    // Open the downloaded file through the actual file input after a cold reload.
    await page.reload();
    await page.waitForSelector('.shape');
    await page
      .locator('#open-file')
      .setInputFiles({ name: `batch-${width}.json`, mimeType: 'application/json', buffer: saved });
    await page.waitForFunction(
      (count) => window.nect.document.layers.length === count,
      doc.layers.length,
    );
    assert.equal(await snapshot(), after);
    assert.equal(await page.evaluate(() => window.nect.export()), svg.toString());
    await choose(copies.map((l) => l.id));
    await page.locator('.canvas-stage').press('Shift+ArrowRight');
    const moved = JSON.parse(await snapshot());
    assert.deepEqual(
      moved.layers.filter((l) => f.ids.includes(l.id)),
      f.fixtures.map((f) => f.layer),
    );
    assert.notEqual(await snapshot(), after);
    await click('undo');
    assert.equal(await snapshot(), after);
  }
  const f = multiDuplicationDocument();
  await load(f.doc);
  await choose([f.ids[0], f.ids[3]]);
  const before = await snapshot(),
    selected = await selection();
  await duplicate().evaluate((el) => {
    window.staleBatchDuplicate = el.cloneNode(true);
  });
  for (const mode of ['modal', 'ime', 'rename', 'pen']) {
    if (mode === 'modal') await click('help');
    if (mode === 'ime') await page.locator('.canvas-stage').dispatchEvent('compositionstart');
    if (mode === 'rename') await page.locator(`[data-select-layer="${f.ids[3]}"]`).press('F2');
    if (mode === 'pen') {
      await page.locator('[data-tool="pen"]').click();
      const b = await page.locator('.artboard').boundingBox();
      await page.mouse.click(b.x + 20, b.y + 20);
    }
    const editingSelection = await selection();
    if (mode !== 'pen') assert.deepEqual(editingSelection, selected);
    if (mode === 'pen') {
      assert.equal(await duplicate().count(), 0, 'Pen draft replaces artwork Inspector');
      assert.equal(await page.locator('[data-pen-draft]').count(), 1);
      await page.evaluate(() => {
        const stale = window.staleBatchDuplicate;
        document.querySelector('.inspector-body').append(stale);
        stale.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        stale.remove();
      });
      assert.equal(
        await page.locator('[data-pen-draft]').count(),
        1,
        'forced stale control cannot finish draft',
      );
    } else {
      assert.equal(await duplicate().isDisabled(), true, mode);
      await force();
    }
    assert.equal(await snapshot(), before, mode);
    assert.deepEqual(
      await selection(),
      editingSelection,
      mode + ' forced control preserves current edit selection',
    );
    if (mode === 'modal') await page.locator('dialog button').click();
    if (mode === 'ime') await page.locator('.canvas-stage').dispatchEvent('compositionend');
    if (mode === 'rename') await page.locator('[data-rename-name]').press('Escape');
    if (mode === 'pen') await page.locator('[data-pen-cancel]').click();
  }
  // Unsupported late selection member must refuse both copies and leave Undo empty.
  f.fixtures[3].layer.locked = true;
  await load(f.doc);
  await choose([f.ids[0], f.ids[3]]);
  assert.equal(await duplicate().isDisabled(), true);
  assert.match(
    await page.locator('.artwork-duplicate-status').innerText(),
    /Image original:.*Unlock the artwork layer/,
  );
  const rejected = await snapshot();
  await force();
  assert.equal(await snapshot(), rejected);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS multi-Artwork duplication: mixed routes, per-source stacking, mapped active/selection, one Undo/Redo, repeated/cancelled flows, 1600/1280/1024 pointer controls, save/file reopen/SVG, independent copied-set move and busy/unsupported guards.',
  );
} catch (error) {
  await page.screenshot({
    path: 'test-results/artwork-multi-duplication-failure.png',
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
