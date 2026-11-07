import {pairRows, pairCells, parseCSV, parseText, normalizeKey, extractPlaces} from './table-core.js';
import {suggestOcrText} from './ocr-suggestions.js';
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
  constructor({onStatus = () => {}, rotation = 0} = {}) {
    this.onStatus = onStatus; this.rotation = rotation; this.worker = null; this.workerPromise = null;
    this.previews = new Map(); this.issues = []; this.objectURLs = [];
  }
  async getWorker() {
    if (!this.workerPromise) this.workerPromise = (async () => {
      await loadScript('../vendor/tesseract.min.js');
      this.onStatus('Képfelismerő indítása…');
      this.worker = await Tesseract.createWorker('eng', 1, {
        workerPath: asset('../vendor/worker.min.js'),
        corePath: asset('../vendor/tesseract-core-lstm.wasm.js'),
        langPath: asset('../vendor/lang'),
        workerBlobURL: false,
        logger: event => { if (event.status === 'recognizing text') this.onStatus('Karakterfelismerés: ' + Math.round((event.progress || 0) * 100) + '%'); },
      });
      await this.worker.setParameters({tessedit_pageseg_mode: '11', preserve_interword_spaces: '1'});
      return this.worker;
    })();
    return this.workerPromise;
  }
  async savePreview(canvas, source) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .75));
    if (!blob) return;
    const url = URL.createObjectURL(blob); this.objectURLs.push(url); this.previews.set(source, url);
  }
  async ocr(canvas, source) {
    const prepared = await prepareDocument(canvas, {rotation: this.rotation});
    try {
      this.issues.push(...prepared.warnings.map(w => source + ': ' + w));
      await this.savePreview(canvas, source);
      const worker = await this.getWorker();
      let cells, data;
      if (prepared.cells.length) {
        if (prepared.cells.length > 500) throw new Error('Több mint 500 cella egy oldalon. Vágd kisebb táblázatokra.');
        cells = [];
        await worker.setParameters({tessedit_pageseg_mode:'6'});
        for (let i=0; i<prepared.cells.length; i++) {
          const box = prepared.cells[i];
          this.onStatus(source + ': cella ' + (i+1) + '/' + prepared.cells.length);
          const inset = Math.min(6, (box.x1-box.x0)/10, (box.y1-box.y0)/10);
          const width=Math.max(1,box.x1-box.x0-2*inset), height=Math.max(1,box.y1-box.y0-2*inset);
          const crop=document.createElement('canvas'); crop.width=Math.ceil(width+24); crop.height=Math.ceil(height+24);
          const context=crop.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,crop.width,crop.height);
          context.drawImage(prepared.canvas,box.x0+inset,box.y0+inset,width,height,12,12,width,height);
          try {
            const result=await worker.recognize(crop,{}, {text:true});
            const suggestion=suggestOcrText(result.data.text);
            cells.push({...box,text:suggestion.text,confidence:result.data.confidence,reasons:suggestion.reasons,grid:true});
          } finally { crop.width=crop.height=1; }
        }
      } else {
        await worker.setParameters({tessedit_pageseg_mode:'11'});
        ({data} = await worker.recognize(prepared.canvas, {}, {blocks:true,text:true,tsv:true}));
        const words=data.words || data.blocks?.flatMap(b=>b.paragraphs?.flatMap(p=>p.lines?.flatMap(l=>l.words||[])||[])||[]) || [];
        cells=joinTextFragments(words);
      }
      let records=pairCells(cells,{source,ocr:true,inferred:!prepared.cells.length});
      // Text fallback remains explicitly uncertain; it invents no cell spans.
      if (!records.length && data?.text) records=parseText(data.text,{source}).map(row=>({...row,uncertain:true,reasons:[...row.reasons,'OCR: nem áll rendelkezésre megbízható cellaszerkezet.']}));
      return records;
    } finally { prepared.canvas.width = prepared.canvas.height = 1; }
  }
  async read(file, {label = file.name} = {}) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (file.size > 60 * 1024 * 1024) throw new Error('A fájl nagyobb 60 MB-nál. Bontsd kisebb részekre.');
    if (['json','csv','txt'].includes(ext) && file.size > 5 * 1024 * 1024) throw new Error('A szöveges fájl nagyobb 5 MB-nál. Bontsd kisebb részekre.');
    if (ext === 'json') {
      const parsed = JSON.parse(await file.text());
      const db = validatedDatabase(parsed.database ?? parsed);
      return Object.entries(db).map(([key, loc]) => ({key, loc, source: label, uncertain: false, reasons: []}));
    }
    if (ext === 'csv') return pairRows(parseCSV(await file.text()), {source: label});
    if (ext === 'txt') return parseText(await file.text(), {source: label});
    if (ext === 'xlsx' || ext === 'xls') {
      const sheets = await readWorkbook(await file.arrayBuffer());
      const records = [];
      for (const {name, rows, merges} of sheets) {
        records.push(...pairRows(rows, {merges, source: label + ' · ' + name}));
      }
      return records;
    }
    if (ext === 'pdf') return this.pdf(file, label);
    if (file.type.startsWith('image/') || /^(jpg|jpeg|png|webp|heic|heif|bmp|gif|tiff?)$/.test(ext)) {
      const canvas = await imageFileToCanvas(file);
      try { return await this.ocr(canvas, label); }
      finally { canvas.width = canvas.height = 1; }
    }
    throw new Error('Nem támogatott formátum: ' + file.name);
  }
  async pdf(file, label = file.name) {
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = asset('../vendor/pdf.worker.min.mjs');
    const task = pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true});
    const doc = await task.promise;
    const records = [];
    try {
      if (doc.numPages > 150) throw new Error('Túl sok PDF-oldal (maximum 150). Bontsd több fájlra.');
      for (let n = 1; n <= doc.numPages; n++) {
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
        } catch (error) { this.issues.push(source + ': HIBA: ' + error.message); }
        finally {
          page?.cleanup(); if (canvas) canvas.width = canvas.height = 1;
          if (prepared) prepared.canvas.width = prepared.canvas.height = 1;
        }
      }
    } finally { await doc.destroy(); }
    return records;
  }
  async close() {
    if (this.worker) await this.worker.terminate();
    this.worker = null; this.workerPromise = null;
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

function readWorkbook(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('./workbook-worker.js'));
    const finish = (error, sheets) => { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(sheets); };
    const timeout = setTimeout(() => finish(new Error('Az Excel feldolgozása túllépte a 20 másodperces időkorlátot. Bontsd kisebb munkafüzetekre.')), 20000);
    worker.onerror = () => finish(new Error('Az Excel-feldolgozó nem indítható vagy hibás fájlt kapott.'));
    worker.onmessage = ({data}) => data.error ? finish(new Error(data.error)) : finish(null, data.sheets);
    worker.postMessage(buffer, [buffer]);
  });
}
