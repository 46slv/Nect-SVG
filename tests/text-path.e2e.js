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
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
const controls = () => page.locator('.inspector-body');
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const input = (label) => controls().getByRole('spinbutton', { name: label, exact: true });
const write = async (label, value) => {
  await input(label).fill(String(value));
  await input(label).press('Tab');
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForFunction(() => window.nect && window.nect.evaluate().error === null);
  const ids = await page.evaluate(async () => {
    const {
      document,
      node,
      point,
      connect,
      setCharacterStyles,
      setCharacterOffsets,
      setCharacterTransforms,
    } = await import('/src/core.js');
    const doc = document(),
      l = doc.layers[0],
      text = node('Text', 350, 40),
      curve = node('Curve', 40, 40),
      fill = node('Fill', 660, 40),
      out = node('Output', 970, 40),
      offset = node('Closed Path Offset', 40, 650),
      circle = node('Circle', 350, 650);
    doc.schemaVersion = 6;
    doc.width = 800;
    doc.height = 400;
    text.text = 'TYPE ON PATH';
    text.params.size.value = 44;
    text.params.position.value = [80, 330];
    text.characterPositions = setCharacterStyles(text.text, undefined, {
      c1: { width: 1.3, baselineShift: 3 },
      c4: { tracking: 8 },
      c5: { width: 1.5 },
    });
    text.characterPositions = setCharacterOffsets(text.text, text.characterPositions, {
      c2: [3, -2],
    });
    text.characterPositions = setCharacterTransforms(text.text, text.characterPositions, {
      c2: { rotation: 8, scale: 1.1 },
    });
    curve.points = [point(70, 240), point(730, 240)];
    curve.points[0].handleB.value = [150, -230];
    curve.points[1].handleA.value = [-150, -230];
    curve.params.closed.value = false;
    fill.params.color.value = { hex: '#6554c0', alpha: 1 };
    l.nodes = [curve, text, fill, out, circle, offset];
    l.output = out.id;
    connect(l, text.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    connect(l, circle.id, offset.id, 'path');
    window.nect.load(JSON.stringify(doc));
    return { text: text.id, curve: curve.id, circle: circle.id, offset: offset.id };
  });
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  await inspect(ids.text);
  const detached = await saved(),
    flatSVG = await page.evaluate(() => window.nect.export());
  const select = () =>
    controls().getByRole('combobox', { name: 'Type on Path contour', exact: true });
  assert.equal(await select().locator(`option[value*="${ids.offset}"]`).count(), 0);
  await select().selectOption(JSON.stringify([ids.curve, ids.curve]));
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).pathAttachment.contourId,
      ids.text,
    ),
    ids.curve,
  );
  assert.equal(await page.evaluate(() => window.nect.document.schemaVersion), 7);
  const attached = await saved();
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), detached);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), attached);
  await write('Type on Path start', 0.5);
  await controls()
    .getByRole('combobox', { name: 'Text alignment', exact: true })
    .selectOption('center');
  await controls().getByRole('checkbox', { name: 'Type on Path reverse', exact: true }).check();
  const reversed = await page.evaluate(
    (id) => window.nect.evaluate().textLayout(id).placements[0].tangent,
    ids.text,
  );
  assert.ok(reversed[0] < 0);
  await controls().getByRole('checkbox', { name: 'Type on Path reverse', exact: true }).uncheck();
  const aligned = await saved();
  await write('Type on Path start', -10);
  assert.equal(await saved(), aligned);
  assert.match(await page.locator('.status .message').innerText(), /OVERFLOW/);
  await controls()
    .getByRole('combobox', { name: 'Writing direction', exact: true })
    .selectOption('vertical-rl');
  assert.equal(await saved(), aligned);
  assert.match(await page.locator('.status .message').innerText(), /horizontal/);
  const textArea = () => controls().getByRole('textbox', { name: 'Text content', exact: true });
  await textArea().fill('TYPE\nON PATH');
  await textArea().press('Tab');
  assert.equal(await saved(), aligned);
  assert.match(await page.locator('.status .message').innerText(), /one line/);
  await textArea().fill('A'.repeat(100));
  await textArea().press('Tab');
  assert.equal(await saved(), aligned);
  // Numeric source movement and transformed geometry refresh without changing text IDs.
  await inspect(ids.curve);
  // Curve points live in the expanded graph node, not in the Inspector.
  const field = page
    .locator('.graph')
    .locator(
      `[data-node="${ids.curve}"][data-key="${await page.evaluate((id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).points[0].id, ids.curve)}.position"]`,
    );
  await field.locator('[data-value][data-axis="1"]').fill('260');
  await field.locator('[data-value][data-axis="1"]').press('Tab');
  const editedSource = await saved();
  assert.notEqual(editedSource, aligned);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), aligned);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), editedSource);
  await page.locator(`.graph [data-delete="${ids.curve}"]`).click();
  assert.equal(await saved(), editedSource);
  assert.match(await page.locator('.status .message').innerText(), /Missing source/);
  await inspect(ids.text);
  // Select a text range and use existing numeric character controls while attached.
  await textArea().evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 1);
  });
  await controls().locator('[data-style-text-range]').click();
  await controls().getByRole('spinbutton', { name: 'Character delta X', exact: true }).fill('6');
  await controls().getByRole('spinbutton', { name: 'Character delta X', exact: true }).press('Tab');
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).characterPositions.offsets
          .c1[0],
      ids.text,
    ),
    6,
  );
  assert.match(await controls().innerText(), /Canvas character dragging is unavailable/);
  const currentSVG = await page.evaluate(() => window.nect.export());
  assert.notEqual(currentSVG, flatSVG);
  const beforeUnit = await saved();
  await controls()
    .getByRole('combobox', { name: 'Type on Path start unit', exact: true })
    .selectOption('distance');
  assert.equal(await page.evaluate(() => window.nect.export()), currentSVG);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), beforeUnit);
  // Cold reload from local persisted JSON, independently of Undo history.
  const roundtrip = await saved();
  await page.evaluate((json) => window.nect.load(json), roundtrip);
  await inspect(ids.text);
  assert.equal(await saved(), roundtrip);
  assert.equal(await page.evaluate(() => window.nect.export()), currentSVG);
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-text-path.json', roundtrip);
  await fs.writeFile('test-results/workflow-text-path.svg', currentSVG);
  await page.screenshot({ path: 'test-results/type-on-path-1600x1000.png', fullPage: true });
  await select().selectOption('');
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).pathAttachment,
      ids.text,
    ),
    undefined,
  );
  assert.deepEqual(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).params.position.value,
      ids.text,
    ),
    [80, 330],
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), roundtrip);
  assert.deepEqual(errors, []);
  console.log(
    'Type on Path: attach, explicit contour, start/alignment/reverse, typography/XY, rejection rollback, source edits, Undo/Redo, detach and JSON/SVG cold reopen passed',
  );
} catch (error) {
  console.error('Text path browser status:', await page.locator('.status .message').innerText());
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/type-on-path-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
