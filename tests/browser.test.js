import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import XLSX from 'xlsx';
import { createHash } from 'node:crypto';

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
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  try {
    await page.waitForFunction(() => document.querySelector('#progress').dataset.state === 'done' && !document.querySelector('#process').disabled, null, { timeout: 180_000 });
  } catch (error) {
    throw new Error(`${error.message}\nImport status: ${await page.locator('#status').innerText()}\nImport log: ${await page.locator('#log').innerText()}`, { cause: error });
  }
}

async function reviewAndApply(page, { verifyUncertain = true } = {}) {
  await page.locator('#reviewPanel').waitFor({ state: 'visible' });
  if (verifyUncertain) {
    const details = page.locator('#uncertainReview');
    if (await details.evaluate(el => el.tagName === 'DETAILS')) await details.evaluate(el => { el.open = true; });
    // Locators are rebuilt after every checkbox because the summary can rerender.
    for (let i = 0; i < 1000; i++) {
      await page.locator('#review details').evaluateAll(items => items.forEach(item => { item.open = true; }));
      const unchecked = page.locator('#review input[data-field="verified"]:not(:checked)');
      if (!(await unchecked.count())) break;
      // A verified row immediately moves out of the uncertain list; click does
      // not require the removed checkbox to remain mounted after the action.
      await unchecked.first().click();
    }
  }
  await page.locator('#apply').click();
  await page.locator('#reviewPanel').waitFor({ state: 'hidden' });
}

async function documents(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('amoc_documents_v1')));
}

async function database(page) {
  return (await documents(page))?.active?.database ?? null;
}

const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const noMatch = 'Nem található vagy nem sikerült felismerni az aktív dokumentációban.';

test('Pages path and iPhone viewport preserve immediate 69/069/J069 lookup and exact unknown-code explanation', async t => {
  const page = await freshPage(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const responses = [];
  page.on('response', res => { if (new URL(res.url()).origin === new URL(base).origin) responses.push(res.status()); });
  await page.reload();
  for (const query of ['69', '069', 'J069']) {
    await page.locator('#search').fill(query);
    assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  }
  await page.locator('#search').fill('J9999');
  assert.equal(await page.locator('#result').innerText(), noMatch);
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
  assert.equal(picked.includes('first-selection.txt'), false);
  await page.locator('#clearFiles').click();
  assert.match(await page.locator('#picked').innerText(), /Nincs kijelölt fájl/);
  assert.equal(await page.locator('#files').inputValue(), '');
  assert.equal(await page.locator('#camera').inputValue(), '');
});

test('upload automatically processes more than 59 structured reliable pairs and activates in one click with document metadata and no row checklist', async t => {
  const page = await freshPage(t);
  const rows = Array.from({length: 60}, (_, i) => `J${String(i + 1).padStart(3, '0')};AM-OC-${900 + i}`);
  await page.locator('#documentName').fill('Heti dokumentáció');
  await processFiles(page, csvFile('weekly.csv', 'J-kód;Hely\n' + rows.join('\n')));
  assert.equal(await page.locator('#reviewPanel').isVisible(), true);
  assert.equal(await page.locator('#reliableReview input[data-field="verified"]').count(), 0, 'reliable matches do not require individual approval');
  await page.locator('#search').fill('1');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-429', 'import cannot activate itself');
  await reviewAndApply(page, {verifyUncertain: false});
  assert.equal(Object.keys(await database(page)).length, 60);
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-900');
  assert.match(await page.locator('#activeDocument').innerText(), /Heti dokumentáció/);
  await page.reload();
  await page.locator('#search').fill('J060');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-959');
});

test('multiple reliable files aggregate repeated J codes and ignore foreign code families in one activation', async t => {
  const page = await freshPage(t);
  await processFiles(page, [
    csvFile('first.csv', 'J-kód;Hely\nJ069;AM-OC-901, AM-OC-902 CH-OC-111\nJ070;AM-OC-903'),
    csvFile('second.csv', 'J-kód;Hely\nJ069;AM-OC-902, AM-OC-904 FR-OC-222 C-DR-333'),
  ]);
  await page.locator('#search').fill('J069');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  await reviewAndApply(page, {verifyUncertain: false});
  assert.deepEqual(await database(page), {J069:'AM-OC-901, AM-OC-902, AM-OC-904', J070:'AM-OC-903'});
});

test('uncertain matches stay separate, never invent keys, and quarantine all locations of a partly unresolved J code', async t => {
  const page = await freshPage(t);
  await processFiles(page, [
    csvFile('certain.csv', 'J-kód;Hely\nJ069;AM-OC-901\nJ070;AM-OC-903'),
    textFile('uncertain.txt', 'J069 AM-OC-902\nAM-OC-999'),
  ]);
  assert.ok(await page.locator('#uncertainReview input[data-field="verified"]').count() >= 2);
  await reviewAndApply(page, {verifyUncertain:false});
  assert.deepEqual(await database(page), {J070:'AM-OC-903'}, 'uncertain same-key continuation cannot turn a partial J code into a certain result');
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), noMatch);
  await page.locator('#search').fill('70');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-903');
});

test('all-uncertain text results require optional source verification, not automatic bulk promotion', async t => {
  const page = await freshPage(t);
  await processFiles(page, textFile('typed.txt', 'J069 AM-OC-901, AM-OC-902'));
  assert.equal(await page.locator('#apply').isDisabled(), true);
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
  await reviewAndApply(page);
  assert.deepEqual(await database(page), {J069:'AM-OC-901, AM-OC-902'});
});

test('empty imports, failed files, and cancellation preserve active documentation', async t => {
  const page = await freshPage(t);
  await processFiles(page, csvFile('valid.csv', 'J-kód;Hely\nJ069;AM-OC-901'));
  await reviewAndApply(page, {verifyUncertain:false});
  const previous=await database(page);
  await processFiles(page, textFile('empty.txt', 'No J-code or AM location here.'));
  assert.deepEqual(await database(page), previous);
  assert.equal(await page.locator('#reviewPanel').isVisible(), false);
  await processFiles(page, {name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
  assert.deepEqual(await database(page), previous);
  assert.equal(await page.locator('#reviewPanel').isVisible(), false);
  await processFiles(page, csvFile('cancel.csv', 'J-kód;Hely\nJ069;AM-OC-999'));
  await page.locator('#cancel').click();
  assert.deepEqual(await database(page), previous);
});

test('a fatal failure in any uploaded file prevents a partial package from replacing the active document', async t => {
  const page=await freshPage(t);
  await processFiles(page, [
    csvFile('good.csv', 'J-kód;Hely\nJ069;AM-OC-901'),
    {name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')},
  ]);
  assert.match(await page.locator('#log').innerText(), /bad\.pdf.*HIBA/);
  assert.equal(await page.locator('#apply').isDisabled(), true, 'a failed page/file cannot be approved away by checking a row');
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(), 'AM-OC-425');
});

test('CSV backup roundtrip preserves multiple places', async t => {
  const page=await freshPage(t);
  await processFiles(page,csvFile('current.csv','J-kód;Hely\nJ069;AM-OC-901, AM-OC-902\nJ070;AM-OC-903'));
  await reviewAndApply(page,{verifyUncertain:false});
  const expected=await database(page);
  const pendingDownload=page.waitForEvent('download'); await page.locator('#export').click();
  const download=await pendingDownload;
  assert.equal(download.suggestedFilename(),'AM_OC_adatok.csv');
  const backup=await readFile(await download.path());
  await processFiles(page,{name:'backup.csv',mimeType:'text/csv',buffer:backup});
  await reviewAndApply(page,{verifyUncertain:false});
  assert.deepEqual(await database(page),expected);
});

test('invalid manually verified data cannot become an active pair', async t => {
  const page=await freshPage(t);
  await processFiles(page,textFile('invalid-edit.txt','J069 AM-OC-999'));
  await page.locator('#review details').evaluateAll(items => items.forEach(item => { item.open = true; }));
  await page.locator('#review [data-field="loc"]').first().fill('AM-OC-999, CH-OC-123');
  await page.locator('#review input[data-field="verified"]').first().check();
  assert.equal(await page.locator('#apply').isDisabled(),true);
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(),'AM-OC-425');
});

test('atomic storage write failure preserves both active and previous documentation', async t => {
  const page=await freshPage(t);
  await processFiles(page,csvFile('current.csv','J-kód;Hely\nJ069;AM-OC-901'));
  await reviewAndApply(page,{verifyUncertain:false});
  const previous=await documents(page);
  await processFiles(page,csvFile('next.csv','J-kód;Hely\nJ069;AM-OC-999'));
  await page.evaluate(()=>{
    const native=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key==='amoc_documents_v1') throw new DOMException('Synthetic quota failure','QuotaExceededError');
      return native.call(this,key,value);
    };
  });
  await page.locator('#apply').click();
  assert.deepEqual(await documents(page),previous);
  await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(),'AM-OC-901');
  assert.equal(await page.locator('#reviewPanel').isVisible(),true);
});

test('delete active documentation persists an empty state through reload and allows previous restoration', async t=>{
  const page=await freshPage(t);
  await processFiles(page,csvFile('current.csv','J-kód;Hely\nJ069;AM-OC-901'));
  await reviewAndApply(page,{verifyUncertain:false});
  page.once('dialog',dialog=>dialog.accept()); await page.locator('#deleteActive').click();
  assert.equal((await documents(page)).active,null);
  await page.reload(); await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(),noMatch,'deletion must not resurrect original/legacy documentation');
  page.once('dialog',dialog=>dialog.accept()); await page.locator('#restorePrevious').click();
  assert.deepEqual(await database(page),{J069:'AM-OC-901'});
});

test('legacy saved data migrates without losing locations or restoring deleted records', async t=>{
  const page=await freshPage(t);
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('amoc_v3',JSON.stringify({J069:'AM-OC-901, AM-OC-902'}));});
  await page.reload(); await page.locator('#search').fill('069');
  assert.equal(await page.locator('#result').innerText(),'AM-OC-901, AM-OC-902');
  page.once('dialog',dialog=>dialog.accept()); await page.locator('#deleteActive').click();
  await page.reload(); await page.locator('#search').fill('69');
  assert.equal(await page.locator('#result').innerText(),noMatch);
});

test('JSON backup and previous restoration preserve complete location lists', async t=>{
  const page=await freshPage(t);
  await processFiles(page,csvFile('first.csv','J-kód;Hely\nJ069;AM-OC-901, AM-OC-902\nJ070;AM-OC-903'));
  await reviewAndApply(page,{verifyUncertain:false});
  const expected=await database(page);
  const waiting=page.waitForEvent('download'); await page.locator('#backup').click();
  const backup=await readFile(await (await waiting).path());
  assert.deepEqual(JSON.parse(backup.toString('utf8')).database,expected);
  await processFiles(page,csvFile('second.csv','J-kód;Hely\nJ069;AM-OC-999'));
  await reviewAndApply(page,{verifyUncertain:false});
  page.once('dialog',dialog=>dialog.accept()); await page.locator('#restorePrevious').click();
  assert.deepEqual(await database(page),expected);
  await processFiles(page,{name:'saved.json',mimeType:'application/json',buffer:backup});
  await reviewAndApply(page,{verifyUncertain:false});
  assert.deepEqual(await database(page),expected);
});

test('actual XLSX parser preserves merged J cells and repeated keys across worksheets',async t=>{
  const page=await freshPage(t); await processFiles(page,fixture('merged-multisheet.xlsx'));
  await reviewAndApply(page,{verifyUncertain:false});
  assert.deepEqual(await database(page),{J069:'AM-OC-425, AM-OC-426, AM-OC-427',J070:'AM-OC-588'});
});

test('Excel replaces a cleared selection, deduplicates equivalent sheets, and uses no OCR uncertainty or engine',async t=>{
  const page=await freshPage(t,{serviceWorkers:'block'}),ocrRequests=[];
  page.on('request',request=>{if(/tesseract|eng\.traineddata|\/worker\.min\.js/.test(request.url()))ocrRequests.push(request.url());});
  await processFiles(page,csvFile('old-selection.csv','J-kód;Hely\nJ999;AM-OC-999'));
  await page.locator('#clearFiles').click();
  assert.equal(await page.locator('#reviewPanel').isVisible(),false);
  const workbook=XLSX.utils.book_new();
  const merged=XLSX.utils.aoa_to_sheet([
    ['J-kód','AM–OC helyek'],['J001','AM-OC-429'],['J003','AM-OC-581'],['','AM-OC-582'],['J001','AM-OC-430'],
  ]);
  merged['!merges']=[{s:{r:2,c:0},e:{r:3,c:0}}];
  XLSX.utils.book_append_sheet(workbook,merged,'Összevont');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['AM-OC','J-kód'],['AM-OC-429',1],['AM-OC-581',3],['AM-OC-582',3],['AM-OC-430',1],
  ]),'Ismételt');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Sorszám','Mennyiség','Hely'],[1,3,'AM-OC-999'],
  ]),'Darabszámok');
  const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  await processFiles(page,{name:'current.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
  assert.equal(await page.locator('#reliableSummary').innerText(),'2 automatikusan aktiválható J-kód (4 párosítás)');
  assert.equal(await page.locator('#uncertainSummary').innerText(),'0 kimaradó, bizonytalan javaslat');
  assert.doesNotMatch(await page.locator('#review').textContent(),/J999|old-selection/);
  assert.equal(await page.locator('#documentName').inputValue(),'current.xlsx');
  assert.equal(await database(page),null,'import leaves the saved active database untouched until activation');
  await page.locator('#search').fill('1');
  assert.equal(await page.locator('#result').innerText(),'AM-OC-429');
  await page.locator('#exportDiagnostics').evaluate(el=>el.closest('details').open=true);
  const waiting=page.waitForEvent('download');await page.locator('#exportDiagnostics').click();
  const download=await waiting,report=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(download.suggestedFilename(),'AM_OC_beolvasasi_adatok.json');
  assert.equal(report.files.length,1);
  assert.equal(report.files[0].name,'current.xlsx');
  assert.equal(report.files[0].sha256,createHash('sha256').update(buffer).digest('hex'));
  assert.equal(report.files[0].records,4);
  const digital=report.files[0].diagnostics.find(entry=>entry.method==='digital-workbook');
  assert.equal(digital.duplicatePairs,4);
  assert.equal(digital.uncertainRecords,0);
  assert.equal('records' in digital,false,'diagnostics omit imported J/location values');
  assert.deepEqual(ocrRequests,[],'a structured workbook must not initialize or fetch OCR');
  await reviewAndApply(page,{verifyUncertain:false});
  assert.deepEqual(await database(page),{J001:'AM-OC-429, AM-OC-430',J003:'AM-OC-581, AM-OC-582'});
});

test('two-page synthetic PDF keeps both pages and optional verification of inferred matches',async t=>{
  const page=await freshPage(t); await processFiles(page,fixture('multipage.pdf'));
  await reviewAndApply(page);
  assert.deepEqual(await database(page),{J069:'AM-OC-425',J070:'AM-OC-588'});
});

test('local OCR preserves merged pairs in synthetic clean/skewed photos without leaking document uploads', {timeout:240_000}, async t=>{
  const page=await freshPage(t); page.setDefaultTimeout(180_000);
  const external=[];
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
  await processFiles(page,[
    {name:'image.png',mimeType:'image/png',buffer:await readFile(fixture('ruled-table.png'))},
    {name:'image.png',mimeType:'image/png',buffer:await readFile(fixture('ruled-table-skew-shadow.png'))},
  ]);
  assert.equal(await page.locator('#reviewPanel').isVisible(),true,`OCR must produce candidates; status: ${await page.locator('#status').innerText()}`);
  await page.locator('#review details').evaluateAll(items => items.forEach(item => { item.open = true; }));
  const previews=new Map();
  for(const button of await page.getByRole('button',{name:'Eredeti oldal megtekintése',exact:true}).all()){
    await button.click();
    const source=await page.locator('#previewLabel').innerText(),url=await page.locator('#previewImage').getAttribute('src');
    assert.ok(url?.startsWith('blob:'));
    if(previews.has(source))assert.equal(url,previews.get(source));previews.set(source,url);
  }
  assert.equal(previews.size,2);assert.equal(new Set(previews.values()).size,2);
  await reviewAndApply(page);
  assert.deepEqual(await database(page),{J069:'AM-OC-425, AM-OC-426',J070:'AM-OC-588'});
  assert.deepEqual(external,[],'all OCR assets must be local; documents must never be uploaded');
});

test('synthetic PDF with text and a scanned table preserves both contents', {timeout:240_000}, async t=>{
  const page=await freshPage(t); page.setDefaultTimeout(180_000);
  await processFiles(page,fixture('mixed-text-scan.pdf'));
  assert.equal(await page.locator('#reviewPanel').isVisible(),true,`Mixed PDF status: ${await page.locator('#status').innerText()}`);
  await reviewAndApply(page);
  assert.deepEqual(await database(page),{J080:'AM-OC-777',J069:'AM-OC-425, AM-OC-426',J070:'AM-OC-588'});
});


test('installed app manifest and cached Pages shell preserve the active document on offline reload', {timeout:60_000}, async t=>{
  const page=await freshPage(t);
  const manifestURL=await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest=await page.evaluate(async href=>{
    const url=new URL(href,document.baseURI);const response=await fetch(url);return {url:url.href,data:await response.json()};
  },manifestURL);
  assert.equal(manifest.data.display,'standalone');
  assert.equal(new URL(manifest.data.start_url,manifest.url).href,base);
  assert.equal(new URL(manifest.data.scope,manifest.url).href,base);
  assert.ok(manifest.data.icons.length>0);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  // The worker intentionally waits for an existing page generation to close.
  // Reload after first installation obtains its controller without skipWaiting.
  await page.reload();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await processFiles(page,csvFile('offline.csv','J-kód;Hely\nJ069;AM-OC-901, AM-OC-902'));
  await reviewAndApply(page,{verifyUncertain:false});
  const expected=await database(page);
  await page.context().setOffline(true);
  await page.reload();
  await page.locator('#search').fill('J069');
  assert.equal(await page.locator('#result').innerText(),'AM-OC-901, AM-OC-902');
  assert.deepEqual(await database(page),expected);
  await page.context().setOffline(false);
});

test('starting a new document clears previous camera selections before automatic import', {timeout:60_000}, async t=>{
  const page=await freshPage(t);
  await page.locator('#camera').setInputFiles(fixture('ruled-table.png'));
  await page.waitForFunction(()=>document.querySelector('#progress').dataset.state==='done',null,{timeout:30_000});
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator('#newDocument').click();
  const chooser=await chooserPromise;
  await chooser.setFiles(csvFile('replacement.csv','J-kód;Hely\nJ123;AM-OC-321'));
  await page.waitForFunction(()=>document.querySelector('#progress').dataset.state==='done',null,{timeout:30_000});
  assert.match(await page.locator('#picked').innerText(),/replacement.csv/);
  assert.doesNotMatch(await page.locator('#picked').innerText(),/ruled-table/);
  assert.equal(await page.locator('#documentName').inputValue(),'replacement.csv');
  await reviewAndApply(page,{verifyUncertain:false});
  assert.deepEqual(await database(page),{J123:'AM-OC-321'});
});
