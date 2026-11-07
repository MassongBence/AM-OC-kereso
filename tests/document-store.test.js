import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOCUMENTS_KEY, createDocument, loadDocuments, saveDocuments, activateDocument, deleteActive, restorePrevious, buildActivation} from '../assets/document-store.js';

const original = {J069: 'AM-OC-425', J070: 'AM-OC-588'};
const doc = (name, data = {J001:'AM-OC-123'}) => createDocument({name, database:data, createdAt:'2026-11-07T12:00:00Z'});
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,String(value)), values};
}

test('first load uses original only when no document state has ever been saved', () => {
  const storage=memoryStorage();
  const state=loadDocuments(storage,original);
  assert.deepEqual(state.active.database,original); assert.equal(state.previous,null);
  assert.equal(storage.values.size,0,'read must not write migration/fallback');
});

test('document metadata and normalized duplicate keys are retained without mutating inputs', () => {
  const data={'69':'AM-OC-425','J069':'AM-OC-426, AM-OC-425'};
  const result=createDocument({name:'  November  ',database:data,sources:['photo.jpg','photo.jpg'],excludedCount:3,createdAt:'2026-11-07T12:00:00+01:00'});
  assert.deepEqual(result,{name:'November',database:{J069:'AM-OC-425, AM-OC-426'},createdAt:'2026-11-07T11:00:00.000Z',sources:['photo.jpg'],excludedCount:3});
  assert.equal(data['69'],'AM-OC-425');
});

test('empty and malformed active documents cannot replace an existing document', () => {
  for (const data of [{},{J069:'AM-OC-425, garbage'},{J069:'CH-OC-425'},{JO69:'AM-OC-425'}]) assert.throws(()=>doc('Bad',data));
  assert.throws(()=>createDocument({name:'',database:original}));
  assert.throws(()=>createDocument({name:'A',database:original,excludedCount:-1}));
  assert.throws(()=>createDocument({name:'A',database:original,createdAt:'not-date'}));
  const storage=memoryStorage(), state=loadDocuments(storage,original);
  assert.throws(()=>activateDocument(storage,state,null)); assert.equal(storage.values.size,0);
});

test('legacy active/previous databases migrate together without overwriting legacy values', () => {
  const legacy={amoc_v3:JSON.stringify({J001:'AM-OC-123'}),amoc_previous_v1:JSON.stringify(original)};
  const storage=memoryStorage(legacy), state=loadDocuments(storage,original);
  assert.deepEqual(state.active.database,{J001:'AM-OC-123'}); assert.deepEqual(state.previous.database,original);
  const saved=saveDocuments(storage,state);
  assert.deepEqual(loadDocuments(storage,original),saved);
  for (const [key,value] of Object.entries(legacy)) assert.equal(storage.getItem(key),value);
});

test('legacy previous without active does not silently load the original database', () => {
  const state=loadDocuments(memoryStorage({amoc_previous_v1:JSON.stringify(original)}),original);
  assert.equal(state.active,null); assert.deepEqual(state.previous.database,original);
});

test('activation, deletion, reload and previous restoration preserve the document and its metadata', () => {
  const storage=memoryStorage(); let state=loadDocuments(storage,original);
  const next=doc('New document'); state=activateDocument(storage,state,next);
  assert.deepEqual(state.active,next); assert.deepEqual(state.previous.database,original);
  state=deleteActive(storage,state); assert.equal(state.active,null); assert.deepEqual(state.previous,next);
  state=loadDocuments(storage,original); assert.equal(state.active,null,'deletion tombstone must survive reload');
  state=restorePrevious(storage,state); assert.deepEqual(state.active,next); assert.equal(state.previous,null);
  assert.deepEqual(loadDocuments(storage,original),state);
});

test('restoring previous swaps whole documents including names, sources and excluded counts', () => {
  const storage=memoryStorage(); const first=doc('First'), second=createDocument({name:'Second',database:original,sources:['page1'],excludedCount:4});
  const state=saveDocuments(storage,{version:1,active:second,previous:first});
  const restored=restorePrevious(storage,state);
  assert.deepEqual(restored.active,first); assert.deepEqual(restored.previous,second);
  assert.deepEqual(restorePrevious(storage,restored),state);
});

test('quota failure is atomic for persisted active and previous state and caller objects', () => {
  const storage=memoryStorage(); const before=saveDocuments(storage,{version:1,active:doc('Current'),previous:doc('Backup',original)});
  const serialized=storage.getItem(DOCUMENTS_KEY), copied=JSON.stringify(before);
  let writes=0; storage.setItem=()=>{writes++; throw new Error('quota');};
  for (const action of [()=>activateDocument(storage,before,doc('New')),()=>deleteActive(storage,before),()=>restorePrevious(storage,before)]) {
    assert.throws(action,error=>error.code==='STORAGE_WRITE_FAILED');
    assert.equal(storage.getItem(DOCUMENTS_KEY),serialized); assert.equal(JSON.stringify(before),copied);
  }
  assert.equal(writes,3,'each operation has one atomic commit point');
});

test('corrupt storage is reported without replacing it with originals or legacy values', () => {
  for (const bad of ['broken JSON','null','{}',JSON.stringify({version:2,active:null,previous:null}),JSON.stringify({version:1,active:{database:{}},previous:null})]) {
    const storage=memoryStorage({[DOCUMENTS_KEY]:bad,amoc_v3:JSON.stringify(original)});
    assert.throws(()=>loadDocuments(storage,original),error=>error.code==='CORRUPT_DOCUMENT_STORAGE');
    assert.equal(storage.getItem(DOCUMENTS_KEY),bad);
  }
  assert.throws(()=>loadDocuments(memoryStorage({amoc_v3:'broken'}),original),error=>error.code==='CORRUPT_DOCUMENT_STORAGE');
});

test('storage access errors never masquerade as an empty first visit', () => {
  assert.throws(()=>loadDocuments({getItem:()=>{throw new Error('disabled');}},original),error=>error.code==='STORAGE_UNAVAILABLE');
});

test('restore without previous reports a specific error and does not write', () => {
  const storage=memoryStorage(), state=loadDocuments(storage,original);
  assert.throws(()=>restorePrevious(storage,state),/Nincs visszaállítható/); assert.equal(storage.values.size,0);
});

test('reliable duplicate/multiple locations aggregate while uncertain keys are quarantined as a whole', () => {
  const result=buildActivation([
    {key:'69',loc:'AM-OC-425',uncertain:false},
    {key:'J069',loc:'AM-OC-426',uncertain:true},
    {key:'J070',loc:'AM-OC-588, AM-OC-588',uncertain:false},
    {key:'J070',loc:'AM-OC-589',uncertain:false},
    {key:'',loc:'AM-OC-999',uncertain:true},
  ]);
  assert.deepEqual(result.database,{J070:'AM-OC-588, AM-OC-589'}); assert.deepEqual(result.excludedKeys,['J069']);
  assert.equal(result.reliable.length,2); assert.equal(result.uncertain.length,3);
  assert.match(result.uncertain[0].reasons[0],/teljes J-kód kimarad/);
});

test('explicit human verification includes complete corrected uncertainty but never invalid/orphan records', () => {
  const result=buildActivation([
    {key:'J069',loc:'AM-OC-425',uncertain:false},
    {key:'J069',loc:'AM-OC-426',uncertain:true,verified:true},
    {key:'',loc:'AM-OC-999',uncertain:true,verified:true},
    {key:'J070',loc:'AM-OC-588, garbage',uncertain:false,verified:true},
    {key:'J071',loc:'AM-OC-500'}, // Unclassified records cannot silently become reliable.
  ]);
  assert.deepEqual(result.database,{J069:'AM-OC-425, AM-OC-426'});
  assert.deepEqual(result.excludedKeys,['J070','J071']); assert.equal(result.uncertain.length,3);
});

test('activation selection is pure, and invalid certain records do not erase other complete keys', () => {
  const records=[{key:'J069',loc:'AM-OC-425',uncertain:false},{key:'J070',loc:'CH-OC-999',uncertain:false}];
  const before=JSON.stringify(records), result=buildActivation(records);
  assert.deepEqual(result.database,{J069:'AM-OC-425'}); assert.equal(JSON.stringify(records),before);
  assert.deepEqual(buildActivation([]),{database:{},reliable:[],uncertain:[],excludedKeys:[]});
});

test('a digital ambiguous cell quarantines its actually printed keys without inventing a pairing',()=>{
 const result=buildActivation([
  {key:'J001',loc:'AM-OC-429',uncertain:false},
  {key:'J002',loc:'AM-OC-551',uncertain:false},
  {key:'J003',loc:'AM-OC-581',uncertain:false},
  {key:'',loc:'AM-OC-999',affectedKeys:['J001','J002'],uncertain:true},
 ]);
 assert.deepEqual(result.database,{J003:'AM-OC-581'});
 assert.deepEqual(result.excludedKeys.sort(),['J001','J002']);
});
