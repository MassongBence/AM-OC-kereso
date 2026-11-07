import {pairCells, parseCSV, parseText, normalizeKey, extractPlaces, cellGeometry} from './table-core.js';
import {recognizeCell} from './cell-ocr.js';
import {parseSpreadsheet} from './spreadsheet-import.js';
import {prepareDocument, imageFileToCanvas, assignWordsToCells} from './image-pipeline.js';

const asset = path => new URL(path, import.meta.url).href;
const scripts = new Map();
async function loadScript(path) {
  const url = asset(path);
  if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => { scripts.delete(url); script.remove(); reject(new Error('Nem tölthető be a feldolgozó könyvtár. Próbáld újra: ' + path)); };
    document.head.append(script);
  }));
  return scripts.get(url);
}

export function abortable(promise,signal) {
  if(!signal)return Promise.resolve(promise);
  return new Promise((resolve,reject)=>{
    const stop=()=>{signal.removeEventListener('abort',stop);reject(new DOMException('A feldolgozás megszakítva.','AbortError'));};
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',stop);if(signal.aborted)stop();else resolve(value);},error=>{signal.removeEventListener('abort',stop);reject(error);});
    if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
  });
}

export function validatedDatabase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Érvénytelen adatbázis.');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 20000) throw new Error('Üres vagy túl nagy adatbázis.');
  const result = {};
  for (const [key, loc] of entries) {
    if (normalizeKey(key) !== key || typeof loc !== 'string' || !validLocationList(loc)) throw new Error('Hibás J-kód vagy AM–OC hely a mentésben.');
    result[key] = extractPlaces(loc).join(', ');
  }
  return result;
}

export function validLocationList(value) {
  const text = String(value).normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
  return /^AM\s*-?\s*OC\s*-?\s*\d{1,4}(?:\s*[,;\n]\s*AM\s*-?\s*OC\s*-?\s*\d{1,4})*$/i.test(text);
}

/** A single worker per batch bounds mobile memory. Every image/PDF is sequential. */
export class DocumentImporter {
  constructor({onStatus = () => {}, rotation = 0, corners = null, signal = null} = {}) {
    this.signal=signal;this.cancelled=false;
    this.onStatus = onStatus; this.rotation = rotation; this.corners = corners; this.worker = null; this.workerPromise = null;
    this.previews = new Map(); this.issues = []; this.objectURLs = []; this.diagnostics = [];
  }
  ensureActive() {if(this.cancelled||this.signal?.aborted)throw new DOMException('A feldolgozás megszakítva.','AbortError');}
  cancel() {this.cancelled=true;this.disposePreviews();return this.close();}
  async getWorker() {
    this.ensureActive();
    if (!this.workerPromise) this.workerPromise = (async () => {
      await loadScript('../vendor/tesseract.min.js');this.ensureActive();
      this.onStatus('Képfelismerő indítása…');
      const raw=await Tesseract.createWorker('eng',1,{
        workerPath:asset('../vendor/worker.min.js'),corePath:asset('../vendor/tesseract-core-lstm.wasm.js'),langPath:asset('../vendor/lang'),workerBlobURL:false,
        logger:event=>{if(!this.cancelled&&!this.signal?.aborted&&event.status==='recognizing text')this.onStatus('Karakterfelismerés: '+Math.round((event.progress||0)*100)+'%');},
      });
      if(this.cancelled||this.signal?.aborted){await raw.terminate();this.ensureActive();}
      this.worker=raw;
      const wrap=method=>(...args)=>{this.ensureActive();return abortable(raw[method](...args),this.signal);};
      const worker={setParameters:wrap('setParameters'),recognize:wrap('recognize')};
      await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});this.ensureActive();return worker;
    })();
    return abortable(this.workerPromise,this.signal);
  }
  async savePreview(canvas, source) {
    this.ensureActive();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .75));
    this.ensureActive();if(!blob)return;
    const url = URL.createObjectURL(blob); this.objectURLs.push(url); this.previews.set(source, url);
  }
  async ocr(canvas, source) {
    this.ensureActive();
    const prepared = await prepareDocument(canvas, {rotation: this.rotation, corners: this.corners});
    try {
      this.diagnostics.push({source,method:'image-pipeline',...prepared.diagnostics});
      this.issues.push(...prepared.warnings.map(w => source + ': ' + w));
      await this.savePreview(canvas, source);
      const worker = await this.getWorker();
      let cells, data;
      if (prepared.cells.length) {
        if (prepared.cells.length > 500) throw new Error('Több mint 500 cella egy oldalon. Vágd kisebb táblázatokra.');
        cells = [];
        for (let i=0; i<prepared.cells.length; i++) {
          this.ensureActive();const box = prepared.cells[i];
          this.onStatus(source + ': cella ' + (i+1) + '/' + prepared.cells.length + ' · OCR-módszerek összehasonlítása');
          cells.push(await recognizeCell(worker,prepared,box));
        }
        for (const method of new Set(cells.flatMap(cell=>cell.evidence?.hypotheses?.map(h=>h.method)||[]))) {
          const methodCells=cells.map(cell=>{
            const hypothesis=cell.evidence.hypotheses.find(item=>item.method===method);
            return {...cell,text:hypothesis?.raw || '',confidence:hypothesis?.confidence || 0,reasons:[]};
          });
          this.diagnostics.push({source,method,reading:'raw-uncorrected',preprocessing:{angle:prepared.angle,perspective:prepared.perspective,cellCount:prepared.cells.length},records:pairCells(methodCells,{source,ocr:true})});
        }

      } else {
        await worker.setParameters({tessedit_pageseg_mode:'11'});
        ({data} = await worker.recognize(prepared.canvas, {}, {blocks:true,text:true,tsv:true}));
        const words=data.words || data.blocks?.flatMap(b=>b.paragraphs?.flatMap(p=>p.lines?.flatMap(l=>l.words||[])||[])||[]) || [];
        cells=joinTextFragments(words);
      }
      let records=pairCells(cells,{source,ocr:true,inferred:!prepared.cells.length,includeUnparsed:true});
      if (prepared.cells.length) records=attachConsensusEvidence(records,cells);
      // Text fallback remains explicitly uncertain; it invents no cell spans.
      if (!records.length && data?.text) records=parseText(data.text,{source}).map(row=>({...row,uncertain:true,reasons:[...row.reasons,'OCR: nem áll rendelkezésre megbízható cellaszerkezet.']}));
      const glyphs=cells.map(cell=>cell.evidence?.glyphHeight).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
      this.diagnostics.push({source,method:'cell-consensus',reading:'consensus-with-visible-suggestions',preprocessing:{angle:prepared.angle,perspective:prepared.perspective,cellCount:prepared.cells.length,glyphPixels:glyphs.length?{min:glyphs[0],median:glyphs[Math.floor(glyphs.length/2)],max:glyphs[glyphs.length-1],sampledCells:glyphs.length}:null},records});
      return records;
    } finally {
      prepared.canvas.width = prepared.canvas.height = 1;
      if (prepared.grayCanvas) prepared.grayCanvas.width = prepared.grayCanvas.height = 1;
    }
  }
  async read(file, options = {}) {
    this.ensureActive();const result=await abortable(this.readFile(file,options),this.signal);this.ensureActive();return result;
  }
  async readFile(file, {label = file.name} = {}) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (file.size > 60 * 1024 * 1024) throw new Error('A fájl nagyobb 60 MB-nál. Bontsd kisebb részekre.');
    if (['json','csv','txt'].includes(ext) && file.size > 5 * 1024 * 1024) throw new Error('A szöveges fájl nagyobb 5 MB-nál. Bontsd kisebb részekre.');
    if (ext === 'json') {
      const parsed = JSON.parse(await file.text());
      const db = validatedDatabase(parsed.database ?? parsed);
      return Object.entries(db).map(([key, loc]) => ({key, loc, source: label, uncertain: false, reasons: []}));
    }
    if(ext==='csv'){const parsed=parseSpreadsheet([{name:'CSV',rows:parseCSV(await file.text())}],{source:label});this.diagnostics.push({source:label,method:'digital-csv',sheets:parsed.diagnostics,duplicatePairs:parsed.duplicatePairs,records:parsed.records});this.issues.push(...parsed.warnings);return parsed.records;}
    if (ext === 'txt') return parseText(await file.text(), {source: label});
    if (ext === 'xlsx' || ext === 'xls') {
      const sheets = await readWorkbook(await file.arrayBuffer(),this.signal);
      const parsed=parseSpreadsheet(sheets,{source:label});
      this.diagnostics.push({source:label,method:'digital-workbook',sheets:parsed.diagnostics,duplicatePairs:parsed.duplicatePairs,records:parsed.records});
      this.issues.push(...parsed.warnings);return parsed.records;
    }
    if (ext === 'pdf') return this.pdf(file, label);
    if (file.type.startsWith('image/') || /^(jpg|jpeg|png|webp|heic|heif|bmp|gif|tiff?)$/.test(ext)) {
      const canvas=await imageFileToCanvas(file);
      try { this.ensureActive();this.diagnostics.push({source:label,method:'image-decode',...canvas.imageDiagnostics});return await this.ocr(canvas,label); }
      finally { canvas.width = canvas.height = 1; }
    }
    throw new Error('Nem támogatott formátum: ' + file.name);
  }
  async pdf(file, label = file.name) {
    this.ensureActive();
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = asset('../vendor/pdf.worker.min.mjs');
    const task = pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true});
    const doc = await task.promise;
    const records = [];
    try {
      if (doc.numPages > 150) throw new Error('Túl sok PDF-oldal (maximum 150). Bontsd több fájlra.');
      for (let n = 1; n <= doc.numPages; n++) {
        this.ensureActive();
        const source = label + ' · ' + n + '. oldal';
        this.onStatus(source);
        let page, canvas, prepared;
        try {
          page = await doc.getPage(n);
          const natural = page.getViewport({scale: 1});
          const scale = Math.min(2.5, 2400 / Math.max(natural.width, natural.height));
          const viewport = page.getViewport({scale});
          canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
          const content = await page.getTextContent();
          const words = content.items.filter(item => item.str?.trim()).map(item => {
            const tx = pdfjs.Util.transform(viewport.transform, item.transform);
            const height = Math.hypot(tx[2], tx[3]);
            return {text: item.str, bbox: {x0: tx[4], y0: tx[5] - height, x1: tx[4] + item.width * scale, y1: tx[5]}, confidence: 100};
          });
          const text = words.map(word => word.text).join(' ');
          const operators = await page.getOperatorList();
          const imageOps = new Set(['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat'].map(name => pdfjs.OPS[name]));
          const hasImages = operators.fnArray.some(op => imageOps.has(op));
          let textRecords = [];
          if (/\bJ\s*-?\s*\d/i.test(text) && extractPlaces(text).length && this.rotation === 0) {
            prepared = await prepareDocument(canvas, {deskew: false});
            await this.savePreview(canvas, source);
            const cells = prepared.cells.length ? assignWordsToCells(words, prepared.cells) : joinTextFragments(words);
            textRecords = pairCells(cells, {source, inferred: true});
            records.push(...textRecords);
          }
          // A single valid text pair does not prove a mixed page is complete.
          // OCR image-bearing pages too, retaining conflicting candidates for review.
          if (!textRecords.length || hasImages || this.rotation !== 0) {
            const recognized = await this.ocr(canvas, source);
            records.push(...recognized.filter(row => !textRecords.some(existing => existing.key === row.key && existing.loc === row.loc)));
            if (hasImages) this.issues.push(source + ': képet tartalmazó PDF-oldal; ellenőrizd a szöveges és képi részek teljességét.');
          }
          if (!records.some(record => record.source === source)) this.issues.push(source + ': nem ismertünk fel párokat. Ellenőrizd a teljes oldalt.');
        } catch (error) { if(error.name==='AbortError')throw error;this.issues.push(source+': HIBA: '+error.message); }
        finally {
          page?.cleanup(); if (canvas) canvas.width = canvas.height = 1;
          if (prepared) { prepared.canvas.width = prepared.canvas.height = 1; if (prepared.grayCanvas) prepared.grayCanvas.width = prepared.grayCanvas.height = 1; }
        }
      }
    } finally { await doc.destroy(); }
    return records;
  }
  async close() {
    const worker=this.worker;this.worker=null;this.workerPromise=null;
    if(worker)await worker.terminate();
  }
  disposePreviews() { this.objectURLs.forEach(url => URL.revokeObjectURL(url)); this.objectURLs = []; this.previews.clear(); }
}

/** Join split code fragments only on one baseline and within a small gap.
 * This retains uncertainty and never extends J spans to another row. */
function joinTextFragments(words) {
  // PDF text runs may contain an entire row, OCR words may contain only a prefix.
  // Approximate subdivisions are always marked as inferred by the caller.
  const tokens = words.flatMap(word => {
    const parts = [...String(word.text).matchAll(/\S+/g)], box = word.bbox;
    return parts.map(part => ({text:part[0],confidence:word.confidence,bbox:{
      x0:box.x0+(box.x1-box.x0)*part.index/word.text.length,
      x1:box.x0+(box.x1-box.x0)*(part.index+part[0].length)/word.text.length,
      y0:box.y0,y1:box.y1,
    }}));
  });
  const lines = [];
  for (const word of tokens.sort((a,b) => a.bbox.y0-b.bbox.y0 || a.bbox.x0-b.bbox.x0)) {
    const b=word.bbox;
    let line=lines.find(l => Math.abs(l.y0-b.y0)<=Math.max(3,(b.y1-b.y0)*.4));
    if (!line) { line={y0:b.y0,words:[]}; lines.push(line); }
    line.words.push(word);
  }
  const cells=[];
  for (const line of lines) {
    let group;
    for (const word of line.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)) {
      const b=word.bbox, prefix=group?.text || '';
      const incompleteKey=/^J\s*-?\s*$/i.test(prefix) && /^\d{1,4}$/.test(word.text);
      const incompletePlace=/^AM(?:\s*-?\s*O?C?)?\s*-?\s*$/i.test(prefix) && /^(?:OC-?|C-?|\d{1,4})$/i.test(word.text);
      if (group && (incompleteKey || incompletePlace) && b.x0-group.x1 < Math.max(12,(b.y1-b.y0)*1.4)) {
        group.text+=' '+word.text; group.x1=b.x1; group.y1=Math.max(group.y1,b.y1);
      } else { group={...b,text:word.text,confidence:word.confidence}; cells.push(group); }
    }
  }
  return cells;
}

function readWorkbook(buffer,signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('./workbook-worker.js'));
    const finish = (error, sheets) => { clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);worker.terminate();error?reject(error):resolve(sheets); };
    const onAbort=()=>finish(new DOMException('A feldolgozás megszakítva.','AbortError'));
    const timeout = setTimeout(() => finish(new Error('Az Excel feldolgozása túllépte a 20 másodperces időkorlátot. Bontsd kisebb munkafüzetekre.')), 20000);
    worker.onerror = () => finish(new Error('Az Excel-feldolgozó nem indítható vagy hibás fájlt kapott.'));
    worker.onmessage = ({data}) => data.error ? finish(new Error(data.error)) : finish(null, data.sheets);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();else worker.postMessage(buffer,[buffer]);
  });
}

/** Promote only an already unambiguous physical-cell match supported by clean
 * consensus in both its J cell and its location cell. No nearest-y inheritance. */
function attachConsensusEvidence(records,cells) {
  return records.map(row=> {
    const location=cells.find(cell=>cell.x0===row.bbox?.x0 && cell.y0===row.bbox?.y0 && cell.x1===row.bbox?.x1 && cell.y1===row.bbox?.y1);
    const placeBounds=location ? cellGeometry(location) : null;
    const cy=placeBounds ? (placeBounds.y0+placeBounds.y1)/2 : 0;
    const matches=location ? cells.filter(cell=>{
      const bounds=cellGeometry(cell);
      return /^J\s*-?\s*\d{1,4}$/i.test(cell.text) && normalizeKey(cell.text)===row.key &&
        (cell.laneId==null || location.laneId==null || cell.laneId===location.laneId) &&
        bounds.x1<=placeBounds.x0+1 && cy>=bounds.y0 && cy<=bounds.y1;
    }) : [];
    const nearest=matches.length ? Math.max(...matches.map(cell=>cellGeometry(cell).x1)) : -Infinity;
    const keys=matches.filter(cell=>Math.abs(cellGeometry(cell).x1-nearest)<=1);
    const geometrySafe=Boolean(row.key) && row.reasons.every(reason=>reason==='OCR: ellenőrizd az eredeti dokumentumon.');
    const reliable=geometrySafe && location?.evidence?.reliable && keys.length>0 && keys.every(key=>key.evidence?.reliable);
    return {...row,uncertain:!reliable,reasons:reliable ? [] : row.reasons,
      evidence:{reliable:Boolean(reliable),method:'cell-consensus',location:location?.evidence || null,keys:keys.map(key=>key.evidence)}};
  });
}
