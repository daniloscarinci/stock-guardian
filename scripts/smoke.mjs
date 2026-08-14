#!/usr/bin/env node
/**
 * End-to-end smoke test against the production build in a real browser.
 *
 * This is the only check that exercises the parts Node cannot: the OPFS
 * SAH-pool VFS, the Web Worker, the service worker, and whether the whole thing
 * actually starts. The unit suite runs the same SQL through the same engine,
 * but it cannot tell you that `locateFile` resolved the wasm asset, or that the
 * database survives a reload.
 *
 * Drives the installed Edge (`channel: 'msedge'`) rather than downloading a
 * browser, and asserts the load-bearing claims:
 *
 *   1. The app starts and reaches an interactive dashboard.
 *   2. It is running on `opfs-sahpool` WITHOUT cross-origin isolation - the
 *      assumption the entire storage design rests on.
 *   3. Data written in one session is still there after a reload.
 *   4. A cold start with the network cut still works.
 *
 * Usage: node scripts/smoke.mjs [--headed] [--keep-open]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const BASE = `http://localhost:${String(PORT)}`;
const HEADED = process.argv.includes('--headed');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' },
);

let browser;
try {
  if (!(await waitForServer(BASE))) throw new Error('preview server did not start');
  console.log(`smoke: preview server on ${BASE}\n`);

  browser = await chromium.launch({ channel: 'msedge', headless: !HEADED });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  // ---- 1. It starts --------------------------------------------------------
  console.log('startup');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#main-content', { timeout: 30_000 });

  const heading = await page.locator('h1').first().textContent();
  check('reaches an interactive dashboard', (heading ?? '').trim().length > 0, `h1="${heading ?? ''}"`);

  const navCount = await page.locator('nav a').count();
  check('navigation is present', navCount >= 8, `${String(navCount)} links`);

  // ---- 2. The storage assumption ------------------------------------------
  console.log('\nstorage');
  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
  check('page is NOT cross-origin isolated', !isolated, 'so no COOP/COEP headers are relied on');

  const vfs = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const name of root.keys()) names.push(name);
    return names;
  });
  check(
    'OPFS holds the SAH-pool directory',
    vfs.includes('.stock-guardian'),
    `entries: ${vfs.join(', ') || '(none)'}`,
  );

  // ---- 3. Add an item ------------------------------------------------------
  console.log('\ninventory');
  await page.goto(`${BASE}/#/inventory`);
  await page.waitForSelector('#inventory-search', { timeout: 15_000 });

  const uniqueName = `Água Mineral ${String(Date.now()).slice(-6)}`;
  await page.getByRole('button', { name: /add item/i }).first().click();
  await page.waitForSelector('dialog[open]', { timeout: 10_000 });
  await page.getByLabel(/item name/i).fill(uniqueName);
  await page.getByLabel(/^quantity$/i).fill('12');
  await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click();
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10_000 });

  await page.waitForTimeout(500);
  const savedVisible = await page.getByText(uniqueName).first().isVisible();
  check('item is saved and listed', savedVisible, uniqueName);

  // ---- 4. Accent-insensitive search ---------------------------------------
  await page.locator('#inventory-search').fill('agua');
  await page.waitForTimeout(600);
  const searchHit = await page.getByText(uniqueName).first().isVisible();
  check('searching "agua" finds "Água"', searchHit);
  await page.locator('#inventory-search').fill('');
  await page.waitForTimeout(500);

  // ---- 5. Durability across a reload --------------------------------------
  console.log('\ndurability');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#inventory-search', { timeout: 20_000 });
  await page.waitForTimeout(800);
  const survived = await page.getByText(uniqueName).first().isVisible();
  check('data survives a reload', survived);

  // ---- 6. Reference catalog ------------------------------------------------
  console.log('\ncatalog');
  await page.goto(`${BASE}/#/catalog`);
  await page.waitForTimeout(1200);
  const catalogText = await page.locator('#main-content').innerText();
  check('reference catalog reports 194 items', catalogText.includes('194'), 'from the subtitle');

  // ---- 7. Contacts ---------------------------------------------------------
  console.log('\ncontacts');
  await page.goto(`${BASE}/#/contacts`);
  await page.waitForTimeout(900);

  const contactName = `Dr. José ${String(Date.now()).slice(-5)}`;
  await page.getByRole('button', { name: /add contact/i }).first().click();
  await page.waitForSelector('dialog[open]', { timeout: 10_000 });
  await page.locator('dialog[open]').getByLabel(/^name/i).first().fill(contactName);
  await page.locator('dialog[open]').getByLabel(/phone/i).first().fill('+55 11 91234-5678');
  await page.locator('dialog[open]').getByRole('button', { name: /^save$/i }).click();
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(600);

  check('contact is saved and listed', await page.getByText(contactName).first().isVisible(), contactName);

  // The same accent-folding promise the rest of the app makes.
  await page.locator('#contacts-search').fill('jose');
  await page.waitForTimeout(600);
  check('searching "jose" finds "José"', await page.getByText(contactName).first().isVisible());
  await page.locator('#contacts-search').fill('');
  await page.waitForTimeout(400);

  // ---- 8. Reports ----------------------------------------------------------
  console.log('\nreports');
  await page.goto(`${BASE}/#/reports`);
  await page.waitForTimeout(1200);

  const reportRows = await page.locator('main table tbody tr').count();
  check('inventory report renders rows', reportRows > 0, `${String(reportRows)} rows`);

  await page.getByText(/preparedness report/i).first().click();
  await page.waitForTimeout(900);
  const preparednessText = await page.locator('#main-content').innerText();
  check(
    'preparedness report shows a score',
    /\d+%/.test(preparednessText),
    'a percentage is present',
  );

  // Exporting must produce a real file, not merely not throw.
  const download = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('button', { name: /export csv/i }).first().click();
  const file = await download;
  check(
    'report exports a CSV',
    file.suggestedFilename().endsWith('.csv'),
    file.suggestedFilename(),
  );

  // ---- 9. Language switching ----------------------------------------------
  console.log('\nlanguage');
  await page.goto(`${BASE}/#/`);
  await page.waitForTimeout(500);
  await page.locator('#language-select').selectOption('pt-BR');
  await page.waitForTimeout(700);
  const ptNav = await page.locator('nav').innerText();
  check('switching to Portuguese translates the interface', ptNav.includes('Invent'), 'nav shows "Inventário"');
  const langAttribute = await page.evaluate(() => document.documentElement.lang);
  check('document language follows the setting', langAttribute === 'pt-BR', `lang="${langAttribute}"`);

  await page.locator('#language-select').selectOption('en');
  await page.waitForTimeout(500);

  // ---- 8. Cold offline start ----------------------------------------------
  console.log('\noffline');
  // Give the service worker time to finish precaching before cutting the network.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state;
  });
  await page.waitForTimeout(2000);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content', { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const offlineHeading = await page.locator('h1').first().textContent();
  check('starts with the network disconnected', (offlineHeading ?? '').trim().length > 0, `h1="${offlineHeading ?? ''}"`);

  await page.goto(`${BASE}/#/inventory`);
  await page.waitForTimeout(1200);
  const offlineData = await page.getByText(uniqueName).first().isVisible();
  check('inventory is readable offline', offlineData);

  await context.setOffline(false);

  // ---- 9. No console errors ------------------------------------------------
  console.log('\nconsole');
  const realErrors = consoleErrors.filter(
    (text) =>
      !text.includes('Failed to load resource') &&
      !text.includes('net::ERR_INTERNET_DISCONNECTED') &&
      !text.includes('net::ERR_FAILED'),
  );
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  if (process.argv.includes('--keep-open')) {
    console.log('\nsmoke: --keep-open given; leaving the browser open. Ctrl+C to finish.');
    await new Promise(() => {});
  }
} catch (error) {
  failed += 1;
  console.error(`\nsmoke: threw - ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await browser?.close().catch(() => undefined);
  server.kill();
}

console.log(`\nsmoke: ${String(passed)} passed, ${String(failed)} failed`);
process.exit(failed === 0 ? 0 : 1);
