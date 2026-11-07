import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const image=fileURLToPath(new URL('./fixtures/ruled-table.png',import.meta.url));
const csv=(name,text)=>({name,mimeType:'text/csv',buffer:Buffer.from(text)});
const replacement=()=>csv('only-current.csv','J-kód;Hely\nJ123;AM-OC-321');
let browser,server,base;
before(async()=>{
 server=createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(!pathname.startsWith('/AM-OC-kereso/'))return res.writeHead(404).end();
   const name=path.resolve(root,pathname.slice('/AM-OC-kereso/'.length)||'index.html');
   if(!name.startsWith(root+path.sep))return res.writeHead(403).end();
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
   res.writeHead(200,{'content-type':types[path.extname(name)]||'application/octet-stream'}).end(await readFile(name));
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}/AM-OC-kereso/`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
async function fresh(t,{slowRead=false}={}){
 // Do not allow background shell installation to consume the intentionally
 // delayed dependency; this suite tests imports, independently of SW caching.
 const context=await browser.newContext({serviceWorkers:'block'});t.after(()=>context.close());
 if(slowRead)await context.addInitScript(()=>{
  const original=File.prototype.text;
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  window.__releaseFirstRead=release;
  File.prototype.text=async function(){
   if(this.name==='held.csv'&&!window.__heldReadStarted){
    window.__heldReadStarted=true;
    await held;
    const actual=await original.call(this);
    window.__heldReadFinished=true;
    return actual;
   }
   return original.call(this);
  };
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 t.after(()=>assert.deepEqual(errors,[],'cancelled imports must not produce uncaught errors'));
 await page.goto(base);return page;
}
async function done(page,timeout=5000){
 await page.waitForFunction(()=>document.querySelector('#progress').dataset.state==='done'&&!document.querySelector('#process').disabled,null,{timeout});
}
async function assertReplacement(page){
 assert.equal(await page.locator('#reviewPanel').isVisible(),true);
 assert.equal(await page.locator('#uncertainReview .candidate').count(),0);
 assert.match(await page.locator('#reliableReview').textContent(),/J123.*AM-OC-321/);
 assert.doesNotMatch(await page.locator('#reliableReview').textContent(),/J069|AM-OC-425|J070|AM-OC-588/);
 assert.doesNotMatch(await page.locator('#log').innerText(),/ruled-table|held\.csv/);
 assert.equal(await page.locator('#documentName').inputValue(),'only-current.csv');
 assert.equal(await page.locator('#apply').isDisabled(),false);
}

test('clear during blocked real OCR lets a new digital import finish before the old dependency loads', {timeout:30_000},async t=>{
 const page=await fresh(t);
 let release,hit;
 const gate=new Promise(resolve=>{release=resolve;});
 const requested=new Promise(resolve=>{hit=resolve;});
 let routeFinished;
 const fulfilled=new Promise(resolve=>{routeFinished=resolve;});
 await page.route('**/vendor/tesseract.min.js',async route=>{
  const actual=await route.fetch();hit();
  try{await gate;await route.fulfill({response:actual});}catch{/* context can close after a test failure */}finally{routeFinished();}
 });
 try{
  await page.locator('#camera').setInputFiles(image);
  await requested;
  await page.locator('#clearFiles').click();
  await page.locator('#files').setInputFiles(replacement());
  // This is a responsiveness requirement, not an OCR speed threshold: the
  // pending dependency is deliberately never released until CSV is finished.
  await done(page);
  await assertReplacement(page);
  assert.equal(await page.evaluate(()=>localStorage.getItem('amoc_documents_v1')),null,'selection/import alone must not replace the active document');
  release();await fulfilled;await page.waitForLoadState('networkidle');
  assert.equal(page.workers().length,0,'a cancelled OCR initialization must not leave a worker alive after its resources settle');
  await assertReplacement(page);
  await page.locator('#apply').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('amoc_documents_v1')).active.database),{J123:'AM-OC-321'});
 }finally{release();}
});

test('clear of a delayed actual file read resets UI immediately and late results stay discarded', {timeout:20_000},async t=>{
 const page=await fresh(t,{slowRead:true});
 try{
  await page.locator('#files').setInputFiles(csv('held.csv','J-kód;Hely\nJ069;AM-OC-999'));
  await page.waitForFunction(()=>window.__heldReadStarted);
  await page.locator('#clearFiles').click();
  await done(page);
  assert.equal(await page.locator('#reviewPanel').isVisible(),false);
  assert.equal(await page.locator('#log').innerText(),'');
  assert.equal(await page.locator('#sourceButtons').textContent(),'');
  assert.match(await page.locator('#picked').innerText(),/Nincs kijelölt fájl/);
  await page.evaluate(()=>window.__releaseFirstRead());
  await page.waitForFunction(()=>window.__heldReadFinished);
  assert.equal(await page.locator('#reviewPanel').isVisible(),false);
  assert.equal(await page.locator('#log').innerText(),'');
  assert.equal(await page.evaluate(()=>localStorage.getItem('amoc_documents_v1')),null);
 }finally{await page.evaluate(()=>window.__releaseFirstRead()).catch(()=>{});}
});

test('rapid replacement never publishes the cancelled file after its read eventually resolves', {timeout:20_000},async t=>{
 const page=await fresh(t,{slowRead:true});
 try{
  await page.locator('#files').setInputFiles(csv('held.csv','J-kód;Hely\nJ069;AM-OC-999'));
  await page.waitForFunction(()=>window.__heldReadStarted);
  await page.locator('#files').setInputFiles(replacement());
  await done(page);
  await assertReplacement(page);
  await page.evaluate(()=>window.__releaseFirstRead());
  await page.waitForFunction(()=>window.__heldReadFinished);
  await assertReplacement(page);
  await page.locator('#apply').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('amoc_documents_v1')).active.database),{J123:'AM-OC-321'});
 }finally{await page.evaluate(()=>window.__releaseFirstRead()).catch(()=>{});}
});
