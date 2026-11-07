// Repository-relative app shell. Uploaded documents and OCR results are never
// network requests and are never added to this cache. localStorage owns data.
const VERSION='amoc-shell-4';
const SHELL=['./','./index.html','./manifest.webmanifest','./assets/app.js','./assets/style.css','./assets/original-data.js','./assets/document-store.js','./assets/table-core.js','./assets/importers.js','./assets/image-pipeline.js','./assets/ocr-suggestions.js','./assets/cell-ocr.js','./assets/workbook-worker.js','./assets/spreadsheet-import.js','./assets/icon.svg','./assets/apple-touch-icon.png','./vendor/pdf.min.mjs','./vendor/pdf.worker.min.mjs','./vendor/tesseract.min.js','./vendor/worker.min.js','./vendor/tesseract-core-lstm.wasm.js','./vendor/lang/eng.traineddata.gz','./vendor/xlsx.full.min.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL))));
// Wait for existing pages to close before switching code generations.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('amoc-shell-')&&key!==VERSION).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 const url=new URL(event.request.url),scope=new URL('./',self.location.href);
 if(!url.pathname.startsWith(scope.pathname))return;
 const isShell=SHELL.some(path=>new URL(path,scope).pathname===url.pathname);
 if(!isShell&&event.request.mode!=='navigate')return;
 // A page and its modules stay in the same cached code generation. New SW
 // installs a complete shell, then activates only after old pages close.
 event.respondWith(caches.open(VERSION).then(async cache=>{
  const cached=await cache.match(event.request);if(cached)return cached;
  return fetch(event.request);
 }));
});
