import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

// Serve the actual production bundle with the native app's unmodified policy.
// Vite's dev server does not exercise this restriction.
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const csp = config.app.security.csp;
assert.ok(csp.includes("script-src 'self'"));
assert.ok(!csp.includes("'unsafe-eval'"));
const root = resolve('dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};
const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  if (req.url === '/csp-probe.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(`try {
      new Function('return 1')();
      document.body.dataset.evalProbe = 'allowed';
    } catch (error) {
      document.body.dataset.evalProbe = error.name;
    }`);
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  const response = await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(response.headers()['content-security-policy'], csp);
  await page.waitForFunction(() => window.nect && document.querySelector('.shape'), null, {
    timeout: 10000,
  });
  assert.ok((await page.locator('#app > *').count()) > 0);
  assert.ok((await page.locator('.graph .node').count()) > 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);

  // Exercise the new typed Color path in the actual production bundle too.
  await page.locator('#add-node').selectOption('Color');
  const colorId = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1).id);
  await page.locator('.inspector-body [data-color="hex"]').evaluate((el) => {
    el.value = '#ff8000';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => window.nect.document.layers[0].nodes.at(-1).params.value.value.hex === '#ff8000',
  );
  await page.locator('.inspector-body [data-color="alpha"]').fill('0.5');
  await page.locator('.inspector-body [data-color="alpha"]').press('Tab');
  const outputId = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Fill').id,
  );
  await page.locator(`.graph .node[data-id="${outputId}"] .node-head strong`).click();
  await page.locator('.inspector-body [data-key="color"] [data-connect-menu]').click();
  await page.locator('dialog select').selectOption(colorId);
  await page.locator('dialog [data-confirm]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('.shape')?.getAttribute('fill') === '#ff8000' &&
      document.querySelector('.shape')?.getAttribute('fill-opacity') === '0.5',
  );
  assert.match(
    await page.evaluate(() => window.nect.export()),
    /fill="#ff8000" fill-opacity="0.5"/,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);

  // Execute the pinned geometry engine in the production bundle under native CSP.
  const offsetSample = await readFile('examples/closed-path-offset.json', 'utf8');
  await page.evaluate((sample) => window.nect.load(sample), offsetSample);
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  assert.equal(await page.locator('.artboard .shape').count(), 4);
  assert.match(await page.evaluate(() => window.nect.export()), /fill="#2f6fa3"/);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);

  // Render both gradient types together through the production-only module graph.
  const radialSample = await readFile('examples/radial-gradient-fill.json', 'utf8');
  await page.evaluate((sample) => window.nect.load(sample), radialSample);
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  await page.waitForFunction(
    () => document.querySelectorAll('.artboard radialGradient').length === 2,
  );
  assert.equal(await page.locator('.artboard linearGradient').count(), 1);
  assert.match(await page.evaluate(() => window.nect.export()), /<radialGradient/);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);

  // A same-origin script proves Chromium really enforces the eval restriction.
  await page.addScriptTag({ url: '/csp-probe.js' });
  assert.equal(await page.locator('body').getAttribute('data-eval-probe'), 'EvalError');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/production-csp-startup.png', fullPage: true });
  await writeFile(
    'test-results/workflow-production-csp.json',
    JSON.stringify(
      {
        csp,
        startup: 'rendered',
        closedOffset: 'miter, bevel, round and erosion sample rendered/exported',
        color: 'typed source with alpha rendered and exported',
        radialGradient: 'two concentric radial ramps plus linear paint rendered/exported',
        pageErrors: errors,
        evalProbe: 'EvalError',
      },
      null,
      2,
    ),
  );
  console.log('Production bundle starts and renders under native CSP; eval remains blocked.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
