#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
import {validateReference,evaluatePairs,compareMethods,assessRealTarget} from '../assets/benchmark-metrics.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const prefix='/AM-OC-kereso/';
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  reference:{type:'string'},output:{type:'string',default:'test-results/benchmark.json'},
  threshold:{type:'string',default:'0.95'},'require-target':{type:'boolean',default:false},help:{type:'boolean',short:'h'},
}});
if(values.help){
 console.log('Usage: node scripts/benchmark.mjs --reference /path/reference.json [--output /path/report.json] [--threshold 0.95] [--require-target] image-or-document ...');
 process.exit(0);
}
let server,browser;
try{
 if(!values.reference||!positionals.length)throw new Error('Provide --reference and at least one input image or document. Use --help for syntax.');
 const threshold=Number(values.threshold);
 if(!Number.isFinite(threshold)||threshold<=0||threshold>1)throw new Error('Threshold must be in (0, 1].');
 const reference=validateReference(JSON.parse(await readFile(values.reference,'utf8')));
 const inputs=await Promise.all(positionals.map(async filename=>{
   const bytes=await readFile(filename);
   return {name:path.basename(filename),bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
 }));
 const sources=inputs.map(({name,sha256})=>({name,sha256}));
 const hashId=source=>`${source.name}\u0000${source.sha256}`;
 const actualHashes=sources.map(hashId).sort(),expectedHashes=(reference.sources||[]).map(hashId).sort();
 const sourceHashesVerified=actualHashes.length===expectedHashes.length&&actualHashes.every((hash,i)=>hash===expectedHashes[i]);
 if(reference.sources&&!sourceHashesVerified)throw new Error('Input file names or SHA-256 hashes differ from the manually checked reference corpus.');
 const mime=filename=>({'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.heic':'image/heic','.csv':'text/csv','.txt':'text/plain','.json':'application/json','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'}[path.extname(filename).toLowerCase()]||'application/octet-stream');
 server=createServer(async(req,res)=>{
   try{
     const url=new URL(req.url,'http://localhost');
     if(!url.pathname.startsWith(prefix))return res.writeHead(404).end();
     const relative=decodeURIComponent(url.pathname.slice(prefix.length));
     if(relative==='__benchmark.html')return res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<!doctype html><html><meta charset="utf-8"><title>Local OCR benchmark</title></html>');
     const match=relative.match(/^__input\/(\d+)$/);
     if(match){
       const input=inputs[Number(match[1])];
       if(!input)return res.writeHead(404).end();
       return res.writeHead(200,{'content-type':mime(input.name),'cache-control':'no-store'}).end(input.bytes);
     }
     // Serve only the application's static assets, never arbitrary input paths.
     if(!/^(?:assets|vendor)\//.test(relative))return res.writeHead(404).end();
     const filename=path.resolve(root,relative);
     if(!filename.startsWith(`${root}${path.sep}`))return res.writeHead(403).end();
     const bytes=await readFile(filename);
     const contentType={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.gz':'application/gzip','.json':'application/json'}[path.extname(filename)]||'application/octet-stream';
     res.writeHead(200,{'content-type':contentType,'cache-control':'no-store'}).end(bytes);
   }catch{res.writeHead(404).end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();
 // A real test document is never uploaded to an external OCR service or CDN.
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')process.stderr.write(`[browser] ${message.text()}\n`);});
 await page.goto(`${origin}${prefix}__benchmark.html`);
 const started=Date.now();
 const evaluation=page.evaluate(async({names,importOptions})=>{
   const {DocumentImporter}=await import('./assets/importers.js');
   const {buildActivation}=await import('./assets/document-store.js');
   const importer=new DocumentImporter(importOptions||{}),records=[],failures=[];
   try{
     for(let i=0;i<names.length;i++){
       try{
         const response=await fetch(`./__input/${i}`);
         if(!response.ok)throw new Error(`Cannot read local input: ${response.status}`);
         const blob=await response.blob();
         const file=new File([blob],names[i],{type:blob.type});
         records.push(...await importer.read(file,{label:`${names[i]} · ${i+1}. fájl`}));
       }catch(error){failures.push({name:names[i],message:error.message});}
     }
     const activation=buildActivation(records);
     return {records,activeRecords:Object.entries(activation.database).map(([key,loc])=>({key,loc})),
       issues:importer.issues||[],failures,diagnostics:importer.diagnostics||[],
       excludedKeys:activation.excludedKeys||[]};
   }finally{await importer.close();importer.disposePreviews();}
 },{names:inputs.map(input=>input.name),importOptions:reference.importOptions||{}});
 let timer;
 const result=await Promise.race([evaluation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Benchmark exceeded 20 minutes; no successful accuracy result was recorded.')),20*60*1000);})]).finally(()=>clearTimeout(timer));
 const allCandidates=evaluatePairs(reference.reference,result.records,{threshold});
 const reliableOnly=evaluatePairs(reference.reference,result.activeRecords,{threshold});
 const target=assessRealTarget(reference,reliableOnly,{sourceHashesVerified});
 const processingErrors = result.issues.filter(issue => typeof issue === 'string' ? /(?:^|\s)HIBA:/.test(issue) : issue?.severity === 'error');
 if(result.failures.length || processingErrors.length){target.established=false;target.blockers.push('At least one input or document page failed to process.');}
 const report={schemaVersion:1,documentId:reference.documentId,kind:reference.kind,
   createdAt:new Date().toISOString(),elapsedMs:Date.now()-started,sources,
   importOptions:reference.importOptions||{},referenceReview:reference.review||null,
   allCandidates,reliableOnly,methods:compareMethods(reference.reference,result.diagnostics,{threshold}),
   realTarget:target,failures:result.failures,issues:result.issues,excludedKeys:result.excludedKeys,
   records:result.records,diagnostics:result.diagnostics,
   notes:['Exact J/location pairs are deduplicated across pages.','A wrong J assignment counts as both an extra pair and a missed reference pair.','Uncertain candidates are excluded from the active-document score; candidate recall is reported separately.','This report is not proof of accuracy on documents outside the supplied corpus.'],
 };
 const output=path.resolve(values.output);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 const percent=value=>value===null?'n/a':`${(value*100).toFixed(2)}%`;
 for(const [name,score]of [['All candidates',allCandidates],['Reliable activation',reliableOnly]])console.log(`${name}: correct=${score.truePositive}, missing=${score.falseNegative}, wrong=${score.falsePositive}; precision=${percent(score.precision)}, recall=${percent(score.recall)}, exact pairing rate=${percent(score.correctPairingRate)}`);
 console.log(`Real-document target established on this corpus: ${target.established?'YES':'NO'}`);
 for(const blocker of target.blockers)console.log(`- ${blocker}`);
 console.log(`Local report: ${output}`);
 if(values['require-target']&&!target.established)process.exitCode=2;
}catch(error){console.error(`Benchmark failed: ${error.message}`);process.exitCode=1;}
finally{
 await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
}
