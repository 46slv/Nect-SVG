import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  const ids = await page.evaluate(async () => {
    const { document, node, connect, layer } = await import('/src/core.js');
    const d = document();
    d.name = 'Radial mark and anchored typography';
    d.width = 900;
    d.height = 540;
    const l = d.layers[0],
      r = node('Rectangle', 40, 40),
      rep = node('Geometry Repeater', 340, 40),
      fill = node('Fill', 650, 40),
      out = node('Output', 960, 40);
    r.params.center.value = [450, 125];
    r.params.size.value = [20, 80];
    rep.operation = 'radial-fit';
    rep.params.count.value = 12;
    rep.params.center.value = [450, 250];
    fill.params.color.value = { hex: '#286b82', alpha: 1 };
    l.nodes = [r, rep, fill, out];
    l.output = out.id;
    connect(l, r.id, rep.id, 'path');
    connect(l, rep.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    const t = layer('Typography'),
      text = node('Text', 40, 40),
      tf = node('Fill', 380, 40),
      to = node('Output', 680, 40);
    text.text = 'NECT\nGeometry + type';
    text.params.position.value = [450, 440];
    text.params.size.value = 36;
    text.alignment = 'center';
    t.nodes = [text, tf, to];
    t.output = to.id;
    connect(t, text.id, tf.id, 'path');
    connect(t, tf.id, to.id, 'path');
    d.layers.push(t);
    window.nect.load(JSON.stringify(d));
    return { rep: rep.id, text: text.id, layer: t.id };
  });
  const inspect = async (id) =>
    page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
  await inspect(ids.rep);
  const field = (key) =>
    page.locator(`.inspector-body .field[data-node="${ids.rep}"][data-key="${key}"]`);
  const count = field('count').locator('[data-value]');
  await count.fill('8');
  await count.press('Tab');
  assert.equal(await page.evaluate(() => window.nect.evaluate().path.contours.length), 8);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.evaluate(() => window.nect.evaluate().path.contours.length), 12);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await page.evaluate(() => window.nect.evaluate().path.contours.length), 8);
  await page.locator(`.inspector-body [data-operation="${ids.rep}"]`).selectOption('linear');
  assert.equal(await field('angle').count(), 0);
  assert.equal(await field('step').count(), 1);
  await page.locator(`.inspector-body [data-operation="${ids.rep}"]`).selectOption('radial-fit');
  assert.equal(await field('angle').locator('[data-value]').inputValue(), '360');
  await count.fill('0');
  await count.press('Tab');
  await page.waitForFunction(
    (id) =>
      window.nect.document.layers[0].nodes.find((n) => n.id === id).params.count.value === 8 &&
      document.querySelector(
        `.inspector-body .field[data-node="${id}"][data-key="count"] [data-value]`,
      )?.value === '8',
    ids.rep,
  );
  assert.equal(await count.inputValue(), '8');
  await page.evaluate(({ layer }) => {
    document.querySelector(`[data-select-layer="${layer}"]`).click();
  }, ids);
  await inspect(ids.text);
  const align = () => page.locator(`.inspector-body [data-text-alignment="${ids.text}"]`);
  assert.equal(await align().inputValue(), 'center');
  await align().selectOption('end');
  assert.equal(
    await page.locator(`.graph [data-text-alignment="${ids.text}"]`).inputValue(),
    'end',
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await align().inputValue(), 'center');
  await page.locator(`.inspector-body [data-text-kerning="${ids.text}"]`).uncheck();
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[1].nodes.find((n) => n.id === id).kerning,
      ids.text,
    ),
    false,
  );
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const wait = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await wait).saveAs(`test-results/workflow-creation.${ext}`);
  }
  const saved = await fs.readFile('test-results/workflow-creation.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), saved);
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[1].nodes[0].alignment),
    'center',
  );
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[1].params.count.value),
    8,
  );
  await page.screenshot({ path: 'test-results/workflow-creation-editor.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS creation: radial/linear UI, history, invalid count, text anchor+kerning parity, JSON/SVG/PNG artifacts',
  );
} finally {
  await browser.close();
}
