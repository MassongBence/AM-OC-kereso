import {ORIGINAL} from './original-data.js';
import {normalizeKey} from './table-core.js';
import {DocumentImporter} from './importers.js';
import {imageFileToCanvas} from './image-pipeline.js';
import {DOCUMENTS_KEY,createDocument,loadDocuments,activateDocument,deleteActive,restorePrevious,buildActivation} from './document-store.js';

const $=id=>document.getElementById(id);
const MISSING='Nem található vagy nem sikerült felismerni az aktív dokumentációban.';
let state={version:1,active:null,previous:null}, storageError='', pending=[], selected=[],cameraFiles=[],busy=false,batchFailed=false;
let selectionVersion=0, timer, cache=new Map(), importers=new Set(), previews=new Map(), fileIDs=new WeakMap(),nextFileID=1;
let cornerImage=null,manualCorners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],cornerVersion=0,dragCorner=-1;
const status=text=>{$('status').textContent=text;};
try {state=loadDocuments(localStorage,ORIGINAL);} catch(error){storageError=error.message;status(storageError);}
const currentDB=()=>state.active?.database||{};
function el(tag,text,cls){const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;}
function refresh(){
 const raw=$('search').value.trim(),key=normalizeKey(raw),db=currentDB();
 $('result').textContent=!raw?'Írj be egy J-kódot!':!key?'Érvénytelen J-kód. Például: 69 vagy J069.':db[key]||MISSING;
 $('count').textContent=Object.keys(db).length+' J-kód az aktív dokumentációban';
 $('dbStatus').textContent=state.active?Object.keys(db).length+' J-kód mentve':'Nincs aktív dokumentáció';
 $('activeDocument').replaceChildren();
 if(state.active){
  $('activeDocument').append(el('p',state.active.name,'active-name'));
  $('activeDocument').append(el('p',`${Object.keys(db).length} J-kód · ${new Date(state.active.createdAt).toLocaleString('hu-HU',{timeZone:'Europe/Budapest'})}`));
  if(state.active.sources.length)$('activeDocument').append(el('p',state.active.sources.join(' • ')));
  if(state.active.excludedCount)$('activeDocument').append(el('p',`${state.active.excludedCount} bizonytalan javaslat kimaradt. A kereső csak az aktivált adatokat mutatja.`,'warn'));
 }else $('activeDocument').textContent=storageError||'Nincs aktív dokumentáció. Tölts be újat vagy állítsd vissza az előzőt.';
 $('activeRows').textContent=Object.entries(db).map(([k,v])=>`${k} → ${v}`).join('\n');
 for(const id of ['showActive','deleteActive','export','backup'])$(id).disabled=busy||!state.active||!!storageError;
 $('restorePrevious').disabled=busy||!state.previous||!!storageError;
}
$('search').addEventListener('input',refresh);refresh();
$('newDocument').onclick=()=>{clearTimeout(timer);selected=[];cameraFiles=[];$('files').value='';$('camera').value='';$('documentName').value='';selectionVersion++;clearReview();if(!busy)clearCache();picked();$('files').scrollIntoView({block:'center'});$('files').click();};
$('showActive').onclick=()=>{$('activeRows').classList.toggle('hide');$('showActive').textContent=$('activeRows').classList.contains('hide')?'Tartalom megjelenítése':'Tartalom elrejtése';};
function clearReview(){pending=[];$('reliableReview').replaceChildren();$('uncertainReview').replaceChildren();$('reviewPanel').classList.add('hide');$('sourcePreview').classList.add('hide');$('previewImage').removeAttribute('src');$('reviewStatus').textContent='';}
function clearCache(){for(const importer of importers)importer.disposePreviews();importers.clear();cache.clear();previews.clear();}
function picked(){
 $('picked').textContent=selected.length?selected.map(f=>f.name).join(' • ')+` (${selected.length} fájl)`:'Nincs kijelölt fájl.';
 if(!$('documentName').value.trim()&&selected.length)$('documentName').value=selected.length===1?selected[0].name:`${selected[0].name} + ${selected.length-1} fájl`;
 prepareCorners();
}
function queueProcess(){
 selectionVersion++;clearTimeout(timer);$('progress').dataset.state='queued';
 if(!selected.length){clearReview();$('progress').dataset.state='done';return;}
 timer=setTimeout(()=>{if(!busy)processFiles();},200);
}
$('files').onchange=e=>{selected=[...e.target.files,...cameraFiles];picked();queueProcess();};
$('cam').onclick=()=>{$('camera').value='';$('camera').click();};
$('camera').onchange=e=>{cameraFiles.push(...e.target.files);selected=[...$('files').files,...cameraFiles];picked();queueProcess();};
$('clearFiles').onclick=()=>{selected=[];cameraFiles=[];$('files').value='';$('camera').value='';picked();queueProcess();if(!busy)clearCache();};
picked();

function selection(){return buildActivation(pending.map((row,index)=>({...row,_index:index})));}
function renderReview(){
 const summary=selection(),db=summary.database;
 $('reliableReview').replaceChildren();$('uncertainReview').replaceChildren();
 for(const [key,loc] of Object.entries(db))$('reliableReview').append(el('p',`${key} → ${loc}`,'reliable-line'));
 for(const row of summary.uncertain){
  const i=row._index,card=el('article','','candidate uncertain'),fields=el('div','','fields');
  for(const [field,label] of [['key','J-kód'],['loc','AM–OC hely(ek)']]){
   const wrap=el('div'),lab=el('label',label),input=el(field==='loc'?'textarea':'input');
   input.id=`candidate-${i}-${field}`;lab.htmlFor=input.id;if(field==='key'){input.type='text';input.autocapitalize='characters';input.spellcheck=false;}
   input.value=row[field]||'';input.dataset.i=i;input.dataset.field=field;wrap.append(lab,input);fields.append(wrap);
  }
  card.append(fields,el('p',row.source+(row.row?' · '+row.row+'. sor':''),'small'),el('p','⚠ '+(row.reasons||[]).join(' '),'small warn'));
  const label=el('label','','check'),check=document.createElement('input');check.type='checkbox';check.dataset.i=i;check.dataset.field='verified';check.checked=!!row.verified;
  label.append(check,document.createTextNode('Opcionális: ezt a javított párost az eredeti dokumentumból ellenőriztem.'));card.append(label);
  const remove=el('button','Javaslat elvetése','danger');remove.dataset.del=i;card.append(remove);$('uncertainReview').append(card);
 }
 $('sourceButtons').replaceChildren();
 for(const source of new Set(pending.map(row=>row.source))){if(!previews.has(source))continue;const wrap=el('div'),button=el('button','Eredeti oldal megtekintése','secondary');wrap.append(el('p',source,'small'));button.onclick=()=>{$('previewImage').src=previews.get(source);$('previewLabel').textContent=source;$('sourcePreview').classList.remove('hide');$('sourcePreview').scrollIntoView({block:'nearest'});};wrap.append(button);$('sourceButtons').append(wrap);}
 $('reliableSummary').textContent=`${Object.keys(db).length} automatikusan aktiválható J-kód (${summary.reliable.length} párosítás)`;
 $('uncertainSummary').textContent=`${summary.uncertain.length} kimaradó, bizonytalan javaslat`;
 $('reviewSummary').textContent=`${Object.keys(db).length} megbízható J-kód aktiválható egyetlen művelettel. ${summary.uncertain.length} bizonytalan javaslat kimarad. ${summary.excludedKeys.length?summary.excludedKeys.length+' érintett J-kód teljes helylistája kimarad. ':''}A felismert darabszám nem igazolja a dokumentum teljességét.`;
 $('apply').disabled=busy||batchFailed||!Object.keys(db).length||!!storageError;
 $('reviewStatus').textContent=storageError|| (batchFailed?'Az import egy része sikertelen vagy üres. A régi dokumentáció megmaradt; töltsd be újra a teljes dokumentációt.':!Object.keys(db).length?'Nincs elég megbízható adat az aktiváláshoz. Próbálj jobb fotót vagy Excel-/PDF-forrást.':summary.uncertain.length?'Részleges felismerés: aktiváláskor csak a fenti megbízható adatok váltják le a régi dokumentációt.':'');
 $('reviewPanel').classList.remove('hide');
}
$('review').addEventListener('input',event=>{
 const {i,field}=event.target.dataset;if(i===undefined||!pending[+i])return;
 pending[+i][field]=field==='verified'?event.target.checked:event.target.value;
 if(field==='verified')renderReview();else {pending[+i].uncertain=true;pending[+i].verified=false;const check=$('review').querySelector(`input[data-i="${i}"][data-field="verified"]`);if(check)check.checked=false;$('apply').disabled=true;}
});
$('review').addEventListener('change',event=>{if(event.target.dataset.field&&event.target.dataset.field!=='verified')renderReview();});
$('review').addEventListener('click',event=>{if(event.target.dataset.del!==undefined){const i=+event.target.dataset.del;pending[i]={...pending[i],discarded:true};pending.splice(i,1);renderReview();}});
$('add').onclick=()=>{pending.push({key:'',loc:'',source:'Kézi javítás',uncertain:true,reasons:['Kézzel hozzáadott párosítás.']});renderReview();$('uncertainReview').parentElement.open=true;};
$('cancel').onclick=()=>{clearReview();status('Az új dokumentációt elvetetted. Az aktív dokumentáció változatlan.');};
$('apply').onclick=()=>{
 if(busy||batchFailed||storageError)return;
 try{
  const result=selection();
  if(!Object.keys(result.database).length)throw new Error('Nincs megbízható párosítás az aktiváláshoz.');
  const doc=createDocument({name:$('documentName').value.trim()||'Új dokumentáció',database:result.database,sources:selected.map(f=>f.name),excludedCount:result.uncertain.length});
  state=activateDocument(localStorage,state,doc);clearReview();refresh();status(`✓ ${doc.name} aktiválva. ${Object.keys(doc.database).length} J-kód kereshető; ${doc.excludedCount} bizonytalan javaslat kimaradt. Az előző dokumentáció visszaállítható.`);
 }catch(error){$('reviewStatus').textContent=error.message;}
};
function setBusy(value){busy=value;for(const id of ['process','apply','reset','deleteActive','restorePrevious'])$(id).disabled=value;refresh();}
async function processFiles({force=false}={}){
 if(busy)return;
 if(!selected.length){status('Előbb válassz fájlt vagy készíts fotót.');$('progress').dataset.state='done';return;}
 if(force)clearCache();
 const version=selectionVersion,files=[...selected];clearReview();batchFailed=false;setBusy(true);
 const corners=$('useCorners').checked&&files.length===1?manualCorners:null;
 const config=JSON.stringify({rotation:Number($('rotation').value),corners});
 const importer=new DocumentImporter({onStatus:status,rotation:Number($('rotation').value),corners});importers.add(importer);
 $('progress').classList.remove('hide');$('progress').value=0;$('progress').dataset.state='running';$('log').textContent='';const report=[];
 try{
  for(let i=0;i<files.length;i++){
   const file=files[i];if(!fileIDs.has(file))fileIDs.set(file,nextFileID++);
   const source=file.name+' · '+fileIDs.get(file)+'. fájl';status('Feldolgozás: '+file.name+` (${i+1}/${files.length})`);
   try{
    let entry=cache.get(file);if(entry?.config!==config)entry=null;
    if(!entry){const issueStart=importer.issues.length;const rows=await importer.read(file,{label:source});entry={rows,issues:importer.issues.slice(issueStart),config};cache.set(file,entry);}
    pending.push(...entry.rows.map(row=>({...row,verified:false})));
    if(!entry.rows.length||entry.issues.some(issue=>/HIBA|nem ismertünk fel párokat/i.test(issue)))batchFailed=true;
    report.push(file.name+': '+entry.rows.length+' párosítási javaslat'+(!entry.rows.length?' — üres felismerés.':''),...entry.issues);
   }catch(error){batchFailed=true;report.push(file.name+': HIBA: '+error.message);}
   for(const [name,url] of importer.previews)previews.set(name,url);
   $('log').textContent=report.join('\n');$('progress').value=Math.round((i+1)/files.length*100);
   if(version!==selectionVersion)break;
   await new Promise(resolve=>setTimeout(resolve,0));
  }
 }catch(error){batchFailed=true;status(error.message);}
 finally{
  try{await importer.close();}catch{batchFailed=true;}
  setBusy(false);
  if(version!==selectionVersion){if(selected.length){queueMicrotask(()=>processFiles());}else{clearReview();clearCache();$('progress').dataset.state='done';}return;}
  $('progress').dataset.state='done';
  if(pending.length){renderReview();status(batchFailed?'Az import hiányos vagy sikertelen. Az aktív dokumentáció változatlan.':'A feldolgozás kész. A megbízható adatokat egyetlen aktiválással használhatod.');}
  else status('Nem sikerült megbízható párosításokat felismerni. Az aktív dokumentáció változatlan.');
 }
}
$('process').onclick=()=>{selectionVersion++;processFiles({force:true});};
$('rotation').onchange=()=>{clearCache();queueProcess();};
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('export').onclick=()=>download('AM_OC_adatok.csv','\ufeffJ-kód;AM–OC helyek\n'+Object.entries(currentDB()).map(([key,loc])=>key+';"'+loc.replace(/"/g,'""')+'"').join('\n'),'text/csv;charset=utf-8');
$('backup').onclick=()=>download('AM_OC_biztonsagi_mentes.json',JSON.stringify({format:'amoc-backup',version:1,...state.active},null,2),'application/json');
$('deleteActive').onclick=()=>{if(!confirm('Törlöd az aktív dokumentációt? Előzőként visszaállítható marad.'))return;try{state=deleteActive(localStorage,state);refresh();status('Az aktív dokumentáció törölve.');}catch(e){status(e.message);}};
$('restorePrevious').onclick=()=>{if(!confirm('Visszaállítod az előző dokumentációt?'))return;try{state=restorePrevious(localStorage,state);clearReview();refresh();status('Az előző dokumentáció visszaállítva.');}catch(e){status(e.message);}};
$('reset').onclick=()=>{if(!confirm('Betöltöd az eredeti mintaadatokat?'))return;try{state=activateDocument(localStorage,state,createDocument({name:'Eredeti dokumentáció',database:ORIGINAL,sources:['Beépített eredeti adatok']}));clearReview();refresh();}catch(e){status(e.message);}};

async function prepareCorners(){
 const version=++cornerVersion;$('useCorners').checked=false;cornerImage=null;$('perspectiveCanvas').width=$('perspectiveCanvas').height=1;
 if(selected.length!==1||!selected[0].type.startsWith('image/'))return;
 try{const source=await imageFileToCanvas(selected[0]);if(version!==cornerVersion){source.width=source.height=1;return;}const canvas=$('perspectiveCanvas'),scale=Math.min(1,640/source.width);canvas.width=Math.round(source.width*scale);canvas.height=Math.round(source.height*scale);cornerImage=document.createElement('canvas');cornerImage.width=canvas.width;cornerImage.height=canvas.height;cornerImage.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);source.width=source.height=1;manualCorners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];drawCorners();}catch{/* The importer reports decoding errors with the original database intact. */}
}
function drawCorners(){const canvas=$('perspectiveCanvas');if(!cornerImage)return;const c=canvas.getContext('2d');c.drawImage(cornerImage,0,0);c.strokeStyle='#91e3b4';c.lineWidth=3;c.beginPath();manualCorners.forEach((p,i)=>i?c.lineTo(p.x*canvas.width,p.y*canvas.height):c.moveTo(p.x*canvas.width,p.y*canvas.height));c.closePath();c.stroke();manualCorners.forEach((p,i)=>{const x=Math.max(12,Math.min(canvas.width-12,p.x*canvas.width)),y=Math.max(12,Math.min(canvas.height-12,p.y*canvas.height));c.fillStyle='#91e3b4';c.beginPath();c.arc(x,y,12,0,Math.PI*2);c.fill();c.fillStyle='#10251a';c.font='bold 15px sans-serif';c.textAlign='center';c.fillText(String(i+1),x,y+5);});}
const cornerCanvas=$('perspectiveCanvas');
function pointerPoint(event){const r=cornerCanvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};}
cornerCanvas.onpointerdown=event=>{if(busy||!cornerImage)return;const p=pointerPoint(event);dragCorner=manualCorners.map(c=>Math.hypot(c.x-p.x,c.y-p.y)).indexOf(Math.min(...manualCorners.map(c=>Math.hypot(c.x-p.x,c.y-p.y))));cornerCanvas.setPointerCapture(event.pointerId);};
cornerCanvas.onpointermove=event=>{if(dragCorner<0)return;manualCorners[dragCorner]=pointerPoint(event);$('useCorners').checked=true;drawCorners();};
cornerCanvas.onpointerup=()=>{dragCorner=-1;};cornerCanvas.onpointercancel=()=>{dragCorner=-1;};
$('resetCorners').onclick=()=>{manualCorners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];$('useCorners').checked=false;drawCorners();};
if('serviceWorker' in navigator)window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js').catch(()=>{});});
window.addEventListener('pagehide',event=>{if(!event.persisted){for(const importer of importers)importer.close().catch(()=>{});clearCache();}});

window.addEventListener('storage',event=>{if(event.key===DOCUMENTS_KEY){try{state=loadDocuments(localStorage,ORIGINAL);storageError='';refresh();}catch(error){storageError=error.message;status(storageError);refresh();}}});
