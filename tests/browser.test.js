import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
let browser, server, base;

before(async () => {
  // Mount below a repository name, as GitHub project Pages does. A root-only
  // smoke check would miss accidental absolute asset and worker URLs.
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/AM-OC-kereso/')) {
        res.writeHead(404).end();
        return;
      }
      const relative = pathname.slice('/AM-OC-kereso/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error('outside root');
      const content = await readFile(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/AM-OC-kereso/`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});

async function freshPage(t, options = {}) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#search').waitFor();
  t.after(() => assert.deepEqual(errors, [], 'application must not emit uncaught JavaScript errors'));
  return page;
}

const textFile = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

async function processFiles(page, files) {
  await page.locator('#files').setInputFiles(files);
  await page.locator('#process').click();
  try {
    await page.waitForFunction(() => !document.querySelector('#process').disabled, null, { timeout: 180_000 });
  } catch (error) {
    throw new Error(`${error.message}\nImport status: ${await page.locator('#status').innerText()}\nImport log: ${await page.locator('#log').innerText()}`, { cause: error });
  }
}

async function reviewAndApply(page) {
  await page.locator('#reviewPanel').waitFor({ state: 'visible' });
  for (const checkbox of await page.locator('#review input[data-field="verified"]').all()) {
    await checkbox.check();
  }
  await page.locator('#replaceConfirm').check();
  await page.locator('#apply').click();
  await page.locator('#reviewPanel').waitFor({ state: 'hidden' });
}

async function database(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('amoc_v3')));
}

test('Pages repository path loads; 69 and J069 have the same immediate result on an iPhone-sized viewport', async t => {
  const page = await freshPage(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const responses = [];
  page.on('response', res => { if (new URL(res.url()).origin === new URL(base).origin) responses.push(res.status()); });
  await page.reload();
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  await page.locator('#search').fill('J069');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  await page.locator('#search').fill('J9999');
  assert.match(await page.locator('#result').innerText(), /nincs találat/i);
  assert.equal(await page.locator('#camera').getAttribute('capture'), 'environment');
  assert.equal(await page.locator('#files').getAttribute('multiple'), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page must not overflow horizontally');
  assert.ok(responses.every(status => status < 400), 'all local assets resolve under the project subpath');
});

test('camera captures accumulate and survive later file-picker selection changes', async t => {
  const page = await freshPage(t);
  const image = await readFile(fixture('ruled-table.png'));
  await page.locator('#camera').setInputFiles({ name: 'capture-one.png', mimeType: 'image/png', buffer: image });
  await page.locator('#camera').setInputFiles({ name: 'capture-two.png', mimeType: 'image/png', buffer: image });
  assert.match(await page.locator('#picked').innerText(), /capture-one\.png.*capture-two\.png.*2 fájl/);
  await page.locator('#files').setInputFiles(textFile('first-selection.txt', 'J069 AM-OC-901'));
  let picked = await page.locator('#picked').innerText();
  assert.ok(picked.includes('capture-one.png') && picked.includes('capture-two.png') && picked.includes('first-selection.txt'));
  assert.match(picked, /3 fájl/);
  await page.locator('#files').setInputFiles(textFile('new-selection.txt', 'J070 AM-OC-902'));
  picked = await page.locator('#picked').innerText();
  assert.ok(picked.includes('capture-one.png') && picked.includes('capture-two.png') && picked.includes('new-selection.txt'));
  assert.equal(picked.includes('first-selection.txt'), false, 'only the picker selection is replaced; captures remain');
  await page.locator('#clearFiles').click();
  assert.match(await page.locator('#picked').innerText(), /Nincs kijelölt fájl/);
  assert.equal(await page.locator('#files').inputValue(), '');
  assert.equal(await page.locator('#camera').inputValue(), '');
});

test('multiple documents deduplicate repeated J codes, ignore other code families, and require explicit replacement', async t => {
  const page = await freshPage(t);
  await processFiles(page, [
    textFile('first.txt', 'J069 AM-OC-901, AM-OC-902 CH-OC-111\nJ070 AM-OC-903'),
    textFile('second.txt', 'J069 AM-OC-902, AM-OC-904 FR-OC-222 C-DR-333'),
  ]);
  await page.locator('#reviewPanel').waitFor({ state: 'visible' });
  await page.locator('#search').fill('J069');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425', 'processing cannot replace the database');
  await page.locator('#apply').click();
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425', 'replacement must require confirmation');
  await page.locator('#replaceConfirm').check();
  await page.locator('#apply').click();
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425', 'uncertain rows need their own verification');
  await page.locator('#replaceConfirm').uncheck();
  for (const checkbox of await page.locator('#review input[data-field="verified"]').all()) await checkbox.check();
  await page.locator('#apply').click();
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425', 'verified rows still require replacement confirmation');
  await reviewAndApply(page);
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-901, AM-OC-902, AM-OC-904');
  assert.deepEqual(await database(page), { J069: 'AM-OC-901, AM-OC-902, AM-OC-904', J070: 'AM-OC-903' });
  await page.reload();
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-901, AM-OC-902, AM-OC-904');
});

test('empty imports, failed files, and cancellation preserve the previous database', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('valid.txt', 'J069 AM-OC-901'));
  await reviewAndApply(page);
  const previous = await database(page);
  await processFiles(page, textFile('empty.txt', 'No J-code or AM location here.'));
  assert.deepEqual(await database(page), previous);
  assert.equal(await page.locator('#reviewPanel').isVisible(), false, 'empty import cannot expose stale review rows');
  await processFiles(page, { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  assert.deepEqual(await database(page), previous);
  assert.equal(await page.locator('#reviewPanel').isVisible(), false);
  await processFiles(page, textFile('cancelled.txt', 'J069 AM-OC-999'));
  await page.locator('#cancel').click();
  assert.deepEqual(await database(page), previous);
});

test('a partially failed file package marks successful structured imports as requiring review', async t => {
  const page = await freshPage(t);
  await processFiles(page, [
    { name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from('J-kod;Hely\nJ069;AM-OC-901') },
    { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') },
  ]);
  assert.equal(await page.locator('#reviewPanel').isVisible(), true);
  assert.match(await page.locator('#log').innerText(), /bad\.pdf.*HIBA/);
  assert.match(await page.locator('#status').innerText(), /részleges/i);
  assert.equal(await page.locator('#review input[data-field="verified"]').count(), 1,
    'a successful CSV row becomes uncertain when a file in the package failed');
  await page.locator('#replaceConfirm').check();
  await page.locator('#apply').click();
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  await reviewAndApply(page);
  assert.deepEqual(await database(page), { J069: 'AM-OC-901' });
});

test('CSV backup can be downloaded and reimported without losing multiple locations', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('valid.txt', 'J069 AM-OC-901, AM-OC-902\nJ070 AM-OC-903'));
  await reviewAndApply(page);
  const expected = await database(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'AM_OC_adatok.csv');
  const backup = await readFile(await download.path());
  assert.match(backup.toString('utf8'), /AM-OC-901, AM-OC-902/);
  await processFiles(page, { name: 'backup.csv', mimeType: 'text/csv', buffer: backup });
  await reviewAndApply(page);
  assert.deepEqual(await database(page), expected);
});

test('invalid or incomplete edited rows block the whole replacement', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('valid.txt', 'J069 AM-OC-901'));
  await reviewAndApply(page);
  const previous = await database(page);
  await processFiles(page, textFile('invalid-edit.txt', 'J069 AM-OC-999'));
  await page.locator('#review [data-field="loc"]').first().fill('AM-OC-999, CH-OC-123');
  await page.locator('#review input[data-field="verified"]').first().check();
  await page.locator('#replaceConfirm').check();
  await page.locator('#apply').click();
  assert.match(await page.locator('#reviewStatus').innerText(), /hibás/i);
  assert.deepEqual(await database(page), previous);
  await page.locator('#review [data-field="loc"]').first().fill('AM-OC-999');
  await page.locator('#review [data-field="key"]').first().fill('');
  await page.locator('#review input[data-field="verified"]').first().check();
  await page.locator('#replaceConfirm').check();
  await page.locator('#apply').click();
  assert.deepEqual(await database(page), previous, 'orphan location cannot silently replace the database');
});

test('localStorage write failure leaves both the active persisted database and live search unchanged', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('current.txt', 'J069 AM-OC-901'));
  await reviewAndApply(page);
  const previous = await database(page);
  await processFiles(page, textFile('next.txt', 'J069 AM-OC-999'));
  for (const checkbox of await page.locator('#review input[data-field="verified"]').all()) await checkbox.check();
  await page.locator('#replaceConfirm').check();
  await page.evaluate(() => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'amoc_v3') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return native.call(this, key, value);
    };
  });
  await page.locator('#apply').click();
  assert.match(await page.locator('#reviewStatus').innerText(), /változatlan/i);
  assert.deepEqual(await database(page), previous);
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-901');
  assert.equal(await page.locator('#reviewPanel').isVisible(), true);
});

test('JSON backup roundtrip and previous database restoration preserve complete location lists', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('first.txt', 'J069 AM-OC-901, AM-OC-902\nJ070 AM-OC-903'));
  await reviewAndApply(page);
  const expected = await database(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backup').click();
  const download = await downloadPromise;
  const backup = await readFile(await download.path());
  assert.deepEqual(JSON.parse(backup.toString('utf8')).database, expected);
  await processFiles(page, textFile('second.txt', 'J069 AM-OC-999'));
  await reviewAndApply(page);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restorePrevious').click();
  assert.deepEqual(await database(page), expected);
  // A downloaded backup also restores through the normal review/approval path.
  await processFiles(page, { name: 'saved.json', mimeType: 'application/json', buffer: backup });
  await reviewAndApply(page);
  assert.deepEqual(await database(page), expected);
});

test('real Excel workbook handles merged J cells and repeated keys across worksheets', async t => {
  const page = await freshPage(t);
  await processFiles(page, fixture('merged-multisheet.xlsx'));
  await reviewAndApply(page);
  assert.deepEqual(await database(page), { J069: 'AM-OC-425, AM-OC-426, AM-OC-427', J070: 'AM-OC-588' });
});

test('real two-page PDF imports both pages and flags geometric matches for review', async t => {
  const page = await freshPage(t);
  await processFiles(page, fixture('multipage.pdf'));
  await page.locator('#reviewPanel').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#review input[data-field="verified"]').count() >= 2, 'PDF coordinate inference requires explicit verification');
  await reviewAndApply(page);
  assert.deepEqual(await database(page), { J069: 'AM-OC-425', J070: 'AM-OC-588' });
});

test('real browser OCR pairs a tall merged cell in clean and skewed/shadowed synthetic photos', { timeout: 180_000 }, async t => {
  const page = await freshPage(t);
  page.setDefaultTimeout(150_000);
  // Repeated camera filenames must not make one page overwrite the other's
  // source preview. The two inputs differ in dimensions and image content.
  await processFiles(page, [
    { name: 'image.png', mimeType: 'image/png', buffer: await readFile(fixture('ruled-table.png')) },
    { name: 'image.png', mimeType: 'image/png', buffer: await readFile(fixture('ruled-table-skew-shadow.png')) },
  ]);
  assert.equal(await page.locator('#reviewPanel').isVisible(), true,
    `OCR must produce review candidates. Status: ${await page.locator('#status').innerText()} Log: ${await page.locator('#log').innerText()}`);
  assert.ok(await page.locator('#review input[data-field="verified"]').count() >= 6, 'OCR candidates must all require review');
  const previews = new Map();
  for (const button of await page.getByRole('button', { name: 'Eredeti oldal megtekintése', exact: true }).all()) {
    await button.click();
    const source = await page.locator('#previewLabel').innerText();
    const url = await page.locator('#previewImage').getAttribute('src');
    assert.ok(url?.startsWith('blob:'), 'each original page has a local source preview');
    if (previews.has(source)) assert.equal(url, previews.get(source), 'all rows from one page share that page preview');
    previews.set(source, url);
  }
  assert.equal(previews.size, 2, 'same-filename inputs retain distinct source labels');
  assert.equal(new Set(previews.values()).size, 2, 'same-filename inputs retain distinct original-image URLs');
  // Do not repair the outputs in this test: incorrect assignments must fail.
  await reviewAndApply(page);
  assert.deepEqual(await database(page), { J069: 'AM-OC-425, AM-OC-426', J070: 'AM-OC-588' });
});

test('a PDF containing text and a scanned table preserves both kinds of content', { timeout: 180_000 }, async t => {
  const page = await freshPage(t);
  page.setDefaultTimeout(150_000);
  await processFiles(page, fixture('mixed-text-scan.pdf'));
  assert.equal(await page.locator('#reviewPanel').isVisible(), true,
    `Mixed PDF must produce review candidates. Status: ${await page.locator('#status').innerText()} Log: ${await page.locator('#log').innerText()}`);
  await reviewAndApply(page);
  assert.deepEqual(await database(page), {
    J080: 'AM-OC-777', J069: 'AM-OC-425, AM-OC-426', J070: 'AM-OC-588',
  });
});
