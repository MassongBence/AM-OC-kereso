import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSpreadsheet} from '../assets/spreadsheet-import.js';
import {pairRows,aggregate,extractPlaces} from '../assets/table-core.js';
import {buildActivation} from '../assets/document-store.js';

const sheet=(rows,options={})=>({name:'Adatok',rows,...options});
const header=['J-kód','AM–OC helyek','Mennyiség'];
const locations=records=>records.flatMap(row=>extractPlaces(row.loc).map(loc=>row.key+'|'+loc));

test('duplicate sheet representations inflated the old pair count; digital import canonicalizes pairs',()=>{
 const a=sheet([header,['J001','AM-OC-429',1],['J069','AM-OC-425, AM-OC-426',2]]);
 const b=sheet([['J-kód','AM-OC hely'],['J001','AM-OC-429'],['J069','AM-OC-425'],['J069','AM-OC-426']],{name:'Egy hely soronként'});
 assert.equal(locations([...pairRows(a.rows),...pairRows(b.rows)]).length,6,'baseline reproduces duplicate pair inflation');
 const parsed=parseSpreadsheet([a,b],{source:'control.xlsx'});
 assert.equal(parsed.records.length,3);assert.equal(parsed.duplicatePairs,3);
 assert.equal(buildActivation(parsed.records).reliable.length,3);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425, AM-OC-426'});
 assert.ok(parsed.records.every(record=>record.uncertain===false&&record.inputKind==='spreadsheet'));
 assert.ok(parsed.records.every(record=>record.provenance.length===2));
});

test('code-only auxiliary worksheets do not create hundreds of unassigned OCR-like candidates',()=>{
 const rows=[['AM-OC hely'],...Array.from({length:255},(_,i)=>[`AM-OC-${i+100}`])];
 assert.equal(pairRows(rows).length,255,'baseline emits an unassigned candidate for every auxiliary location');
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet(rows,{name:'Helylista'})]);
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].key,'J001');assert.equal(parsed.records[0].uncertain,false);
 assert.equal(parsed.diagnostics[1].mode,'ignored');assert.match(parsed.warnings[0],/kiegészítő/);
 assert.deepEqual(buildActivation(parsed.records).database,{J001:'AM-OC-429'});
});

test('declared worksheet columns exclude side notes and search widgets outside the data table',()=>{
 const parsed=parseSpreadsheet([sheet([
  ['J-kód','AM-OC hely','Helyek száma','','Kereső'],
  ['J001','AM-OC-429',1,'J-kód','AM-OC hely'],
  ['J069','AM-OC-425',1,'J999','AM-OC-999'],
 ])]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425'});
 assert.equal(parsed.diagnostics[0].ignoredLocationCells,1);
});

test('location-before-key columns are read directly instead of forced left-to-right guesses',()=>{
 const parsed=parseSpreadsheet([sheet([['AM-OC hely','J-kód','Mennyiség'],['AM-OC-429',1,99],['AM-OC-425',69,2]])]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425'});
 assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('multiple horizontal tables use their own declared key and location columns',()=>{
 const parsed=parseSpreadsheet([sheet([
 ['J-kód','AM-OC hely','','J-kód','AM-OC hely'],
 ['J001','AM-OC-429','','J069','AM-OC-425'],
 ['J002','AM-OC-551','','J070','AM-OC-588, AM-OC-424'],
 ])]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425',J002:'AM-OC-551',J070:'AM-OC-588, AM-OC-424'});
 assert.equal(parsed.records.length,5);assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('a later full table header can switch columns after the previous block',()=>{
 const parsed=parseSpreadsheet([sheet([
 ['J-kód','AM-OC hely'],['J001','AM-OC-429'],[],['','AM-OC hely','J-kód'],['','AM-OC-425','J069']
 ])]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425'});
 assert.deepEqual(parsed.diagnostics[0].headerRows,[1,4]);
});

test('vertical J merges span several places and stop exactly at their declared bottom',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J069','AM-OC-425'],['','AM-OC-426'],['','AM-OC-427'],['','AM-OC-999']],
 {merges:[{s:{r:1,c:0},e:{r:3,c:0}}]})]);
 assert.deepEqual(parsed.records.map(r=>r.key),['J069','J069','J069','']);
 assert.ok(parsed.records.slice(0,3).every(r=>!r.uncertain));assert.equal(parsed.records[3].uncertain,true);
});

test('a shared merged AM location pairs with each explicitly present J cell',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429'],['J002',''],['J003','']],
 {merges:[{s:{r:1,c:1},e:{r:3,c:1}}]})]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J002:'AM-OC-429',J003:'AM-OC-429'});
 assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('horizontal merges do not manufacture extra J columns or expose hidden covered values',()=>{
 const parsed=parseSpreadsheet([sheet([['J-kód','','AM-OC hely'],['J069','J999','AM-OC-425'],['','J998','AM-OC-426']],
 {merges:[{s:{r:0,c:0},e:{r:0,c:1}},{s:{r:1,c:0},e:{r:2,c:1}}]})]);
 assert.deepEqual(aggregate(parsed.records),{J069:'AM-OC-425, AM-OC-426'});
 assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('direct inline digital mappings do not need OCR or a fabricated key column',()=>{
 const parsed=parseSpreadsheet([sheet([['J001 → AM-OC-429'],['J069: AM-OC-425, AM-OC-426']])]);
 assert.deepEqual(aggregate(parsed.records),{J001:'AM-OC-429',J069:'AM-OC-425, AM-OC-426'});
 assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('a cell containing multiple J codes remains structurally ambiguous',()=>{
 const parsed=parseSpreadsheet([sheet([['J001 / J002 → AM-OC-429']])]);
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].key,'');assert.equal(parsed.records[0].uncertain,true);
 assert.deepEqual(buildActivation(parsed.records).database,{});
});

test('deduplicating ambiguous cells preserves every actually affected J key',()=>{
 const parsed=parseSpreadsheet([sheet([
  ['J001 / J002 → AM-OC-429'],['J003 / J004 → AM-OC-429'],
  ['J001 → AM-OC-551'],['J002 → AM-OC-552'],['J003 → AM-OC-553'],['J004 → AM-OC-554'],
 ])]);
 assert.equal(parsed.duplicatePairs,1);
 const ambiguous=parsed.records.find(row=>!row.key);
 assert.deepEqual(ambiguous.affectedKeys,['J001','J002','J003','J004']);
 assert.equal(ambiguous.uncertain,true);
 const activation=buildActivation(parsed.records);
 assert.deepEqual(activation.database,{});
 assert.deepEqual(activation.excludedKeys,['J001','J002','J003','J004']);
});

test('missing unmerged J values never inherit a previous row',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429'],['','AM-OC-555']])]);
 assert.equal(parsed.records[1].key,'');assert.equal(parsed.records[1].uncertain,true);
 assert.ok(parsed.records[1].reasons.every(r=>!r.includes('OCR')));
});

test('numeric quantities and sequence numbers cannot steal a declared J association',()=>{
 const parsed=parseSpreadsheet([sheet([['Sorszám','J-kód','Mennyiség','AM-OC hely'],[1,69,123,'AM-OC-425'],[2,70,5,'AM-OC-588']])]);
 assert.deepEqual(aggregate(parsed.records),{J069:'AM-OC-425',J070:'AM-OC-588'});
 assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('unlabelled ambiguous numeric columns remain uncertain structural data',()=>{
 const parsed=parseSpreadsheet([sheet([[1,69,'AM-OC-425'],[2,70,'AM-OC-588']])]);
 assert.ok(parsed.records.every(r=>r.uncertain));assert.deepEqual(buildActivation(parsed.records).database,{});
});

test('same digital pair represented uncertain and certain is not quarantined twice',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([['Megjegyzés J001 → AM-OC-429']],{name:'Ismételt adatok'})]);
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].uncertain,false);
 assert.equal(parsed.records[0].provenance.length,2);
 assert.deepEqual(buildActivation(parsed.records).database,{J001:'AM-OC-429'});
});

test('a genuinely incomplete digital row is not made certain by an exact duplicate elsewhere',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([header,['J001','AM-OC-429, AM-OC-4??']],{name:'Hibás adatok'})]);
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].uncertain,true);assert.equal(parsed.records[0].incomplete,true);
 assert.deepEqual(buildActivation(parsed.records).database,{});
});

test('repeated J codes and different legitimate AM locations accumulate without other namespaces',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J069','AM-OC-425 CH-OC-999'],['J069','AM-OC-426 FR-OC-800 C-DR-90 A-DR-005-X'],['J069','AM-OC-425']])]);
 assert.deepEqual(aggregate(parsed.records),{J069:'AM-OC-425, AM-OC-426'});
 assert.equal(parsed.records.length,2);assert.ok(parsed.records.every(r=>!r.uncertain));
});

test('limits and malformed/overlapping merges fail explicitly rather than allocating unbounded tables',()=>{
 assert.throws(()=>parseSpreadsheet([sheet([Array(201).fill('')])]),/nagy/);
 assert.throws(()=>parseSpreadsheet([sheet([['J001','AM-OC-429']],{merges:[{s:{r:0,c:0},e:{r:30000,c:0}}]})]),/cella/);
 assert.throws(()=>parseSpreadsheet([sheet([['J001','AM-OC-429']],{merges:[{s:{r:0,c:0},e:{r:0,c:1}},{s:{r:0,c:1},e:{r:0,c:1}}]})]),/Átfedő/);
});

test('numeric auxiliary quantities cannot quarantine a validated J001 mapping on another sheet',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([['Mennyiség','AM-OC hely'],[1,'AM-OC-555'],[2,'AM-OC-556']],{name:'Készletszámok'})]);
 assert.deepEqual(buildActivation(parsed.records).database,{J001:'AM-OC-429'});
 assert.equal(parsed.records.length,1);assert.equal(parsed.diagnostics[1].mode,'ignored');
 assert.ok(parsed.warnings.length);
});

test('unlabelled numeric auxiliary tables stay ignored beside a validated mapping, not guessed J keys',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([[1,'AM-OC-555'],[2,'AM-OC-556']],{name:'Névtelen segédadatok'})]);
 assert.deepEqual(buildActivation(parsed.records).database,{J001:'AM-OC-429'});
 assert.equal(parsed.records.length,1);assert.equal(parsed.diagnostics[1].mode,'ignored');
});

test('an empty J header on an auxiliary place list does not generate unassigned row checklists',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([['J-kód','AM-OC hely','Darab'],['','AM-OC-555',1],['','AM-OC-556',2]],{name:'Üres sablon'})]);
 assert.equal(parsed.records.length,1);assert.equal(parsed.diagnostics[1].mode,'ignored');
});

test('malformed suffix with underscore stays incomplete even when another sheet contains the valid pair',()=>{
 const parsed=parseSpreadsheet([sheet([header,['J001','AM-OC-429']]),sheet([header,['J001','AM-OC-429_']],{name:'Hibás'})]);
 assert.equal(parsed.records.length,2);assert.ok(parsed.records.some(r=>r.key==='J001'&&r.loc===''&&r.incomplete));
 assert.deepEqual(buildActivation(parsed.records).database,{});
});
