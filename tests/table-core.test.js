import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKey, extractPlaces, aggregate, pairRows, pairCells, parseCSV, parseText} from '../assets/table-core.js';

const cell = (text, x0, y0, x1, y1, extra = {}) => ({text, x0, y0, x1, y1, ...extra});

test('query and cell keys are normalized without matching arbitrary text or OCR substitutions', () => {
  for (const value of ['69', 69, 'J069', 'j 0069', 'J-69']) assert.equal(normalizeKey(value), 'J069');
  for (const value of ['J0', '0', 'J069 notes', 'xJ069', 'J06O', '12345', 'AM-OC-69', '', null]) assert.equal(normalizeKey(value), '');
});

test('only complete AM–OC codes are extracted and duplicate places are removed', () => {
  assert.deepEqual(extractPlaces('AM–OC–425, AM OC 426; AM-OC-425 CH-OC-12 FR-OC-15 C-DR-90'), ['AM-OC-425', 'AM-OC-426']);
  assert.deepEqual(extractPlaces('XAM-OC-123 AM-OC-123X AM-OC-12345 CH-OC-100'), []);
  assert.deepEqual(extractPlaces('AM-OC-1234 AM-OC-12345 AM-OC-123ABC AM-OC-I23 AM-0C-123 AM-OC-12O'), ['AM-OC-1234']);
});

test('a spreadsheet row pairs all locations with the nearest preceding J column', () => {
  const rows = pairRows([['J069', 'AM-OC-425', 'AM-OC-426', 'CH-OC-999'], ['J069', 'AM-OC-427'], ['J070', 'FR-OC-20']]);
  assert.deepEqual(aggregate(rows), {J069: 'AM-OC-425, AM-OC-426, AM-OC-427'});
  assert.ok(rows.every(row => !row.uncertain));
});

test('explicit vertical merge associates lower rows and stops at its lower boundary', () => {
  const rows = pairRows([['J069', 'AM-OC-425'], ['', 'AM-OC-426'], ['', 'AM-OC-427'], ['', 'AM-OC-999']],
    {merges: [{s: {r: 0, c: 0}, e: {r: 2, c: 0}}]});
  assert.deepEqual(aggregate(rows), {J069: 'AM-OC-425, AM-OC-426, AM-OC-427'});
  assert.equal(rows.at(-1).key, ''); assert.equal(rows.at(-1).uncertain, true);
});

test('malformed and enormous merge bounds cannot trigger an unbounded expansion', () => {
  for (const merge of [
    {s: {r: 0, c: 0}, e: {r: 1, c: 1000000000}},
    {s: {r: 0, c: 0}, e: {r: 30000, c: 1}},
    {s: {r: 0, c: 0}, e: {r: 1.5, c: 1}},
    {s: {r: -1, c: 0}, e: {r: 1, c: 1}},
    {s: {r: 1, c: 0}, e: {r: 0, c: 1}},
  ]) assert.throws(() => pairRows([['J069', 'AM-OC-425']], {merges: [merge]}), /cella/);
  assert.throws(() => pairRows([Array(201).fill('')]), /táblázat/);
  assert.throws(() => pairRows(Array(30001).fill([])), /táblázat/);
  assert.deepEqual(aggregate(pairRows([['J069', 'AM-OC-425']],
    {merges: [{s: {r: 0, c: 0}, e: {r: 10, c: 10}}]})), {J069: 'AM-OC-425'});
});

test('unmerged blank J cells never inherit an earlier key across blank rows or pages', () => {
  const records = pairRows([['J069', 'AM-OC-425'], [], ['', 'AM-OC-999']]);
  assert.equal(records[1].key, ''); assert.equal(records[1].uncertain, true);
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425'});
  assert.equal(pairRows([['', 'AM-OC-999']])[0].key, '');
});

test('side-by-side spreadsheet tables do not attach later codes to earlier keys', () => {
  assert.deepEqual(aggregate(pairRows([['J069', 'AM-OC-425', '', 'J070', 'AM-OC-600', 'AM-OC-601']])),
    {J069: 'AM-OC-425', J070: 'AM-OC-600, AM-OC-601'});
});

test('numeric quantities outside established J columns do not steal locations', () => {
  assert.deepEqual(aggregate(pairRows([['J069', '123', 'AM-OC-425'], ['70', '7', 'AM-OC-600']])),
    {J069: 'AM-OC-425', J070: 'AM-OC-600'});
  assert.deepEqual(aggregate(pairCells([cell('J069', 0, 0, 100, 80), cell('123', 100, 0, 200, 80),
    cell('AM-OC-425', 200, 0, 300, 80)])), {J069: 'AM-OC-425'});
});

test('bare numeric table keys without a known J column always require review', () => {
  assert.equal(pairRows([['69', 'AM-OC-425']])[0].uncertain, true);
  assert.equal(pairRows([['J-kód', 'hely'], ['69', 'AM-OC-425']])[0].uncertain, false);
  assert.equal(pairCells([cell('69', 0, 0, 100, 80), cell('AM-OC-425', 100, 0, 300, 80)])[0].uncertain, true);
});

test('tall merged J cell pairs locations above and below its text center', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 180), cell('AM-OC-425', 100, 0, 300, 60),
    cell('AM-OC-426', 100, 60, 300, 120), cell('AM-OC-427', 100, 120, 300, 180),
    cell('J070', 0, 180, 100, 240), cell('AM-OC-600', 100, 180, 300, 240)]);
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425, AM-OC-426, AM-OC-427', J070: 'AM-OC-600'});
});

test('cell pairing handles duplicate keys and ignores unrelated location namespaces', () => {
  assert.deepEqual(aggregate(pairCells([cell('J069', 0, 0, 100, 80), cell('AM-OC-425\nAM-OC-426', 100, 0, 300, 80),
    cell('J069', 0, 80, 100, 160), cell('AM-OC-425\nCH-OC-100\nFR-OC-120\nC-DR-90', 100, 80, 300, 160)])),
    {J069: 'AM-OC-425, AM-OC-426'});
});

test('side-by-side physical tables use their own J column', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 100), cell('AM-OC-425', 100, 0, 280, 100),
    cell('J070', 400, 0, 500, 100), cell('AM-OC-600', 500, 0, 700, 100)]);
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425', J070: 'AM-OC-600'});
});

test('vertically separate tables do not inherit J codes from the preceding table', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 100), cell('AM-OC-425', 100, 0, 280, 100),
    cell('J070', 0, 400, 100, 500), cell('AM-OC-600', 100, 400, 280, 500),
    cell('AM-OC-999', 100, 220, 280, 300)]);
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425', J070: 'AM-OC-600'});
  assert.equal(records.at(-1).key, '');
});

test('a location cell crossing distinct J spans remains ambiguous', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 100), cell('J070', 0, 100, 100, 200),
    cell('AM-OC-425', 100, 0, 280, 200)]);
  assert.equal(records[0].key, ''); assert.equal(records[0].uncertain, true);
});

test('cell geometry refuses nearest-height matches when the location is outside the J span', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 20), cell('AM-OC-425', 100, 50, 300, 70)]);
  assert.equal(records[0].key, ''); assert.equal(records[0].uncertain, true);
});

test('overlapping competing J cells and lower OCR confidence require review', () => {
  const ambiguous = pairCells([cell('J069', 0, 0, 100, 100), cell('J070', 0, 20, 100, 80), cell('AM-OC-425', 100, 30, 300, 60)]);
  assert.equal(ambiguous[0].key, ''); assert.equal(ambiguous[0].uncertain, true);
  const ocr = pairCells([cell('J069', 0, 0, 100, 100, {confidence: 60}), cell('AM-OC-425', 100, 0, 300, 100)], {ocr: true});
  assert.equal(ocr[0].key, 'J069'); assert.equal(ocr[0].uncertain, true); assert.ok(ocr[0].reasons.length >= 2);
});

test('invalid rectangles are ignored and inferred geometry is never called certain', () => {
  const records = pairCells([cell('J069', 0, 0, 100, 100), cell('AM-OC-425', 100, 0, 300, 100),
    cell('AM-OC-999', 10, 0, 5, 100)], {inferred: true});
  assert.equal(records.length, 1); assert.equal(records[0].uncertain, true);
});

test('CSV handles semicolons, BOM, embedded quotes and multiline fields', () => {
  assert.deepEqual(parseCSV('\uFEFFJ-kód;Helyek;Megjegyzés\r\nJ069;"AM-OC-425\nAM-OC-426";"a; b ""idézet"""\r\n'),
    [['J-kód', 'Helyek', 'Megjegyzés'], ['J069', 'AM-OC-425\nAM-OC-426', 'a; b "idézet"']]);
  assert.deepEqual(aggregate(pairRows(parseCSV('J069,"AM-OC-425, AM-OC-426"\nJ069,AM-OC-427'))), {J069: 'AM-OC-425, AM-OC-426, AM-OC-427'});
  assert.deepEqual(parseCSV('J069\tAM-OC-425'), [['J069', 'AM-OC-425']]);
  assert.throws(() => parseCSV('J069,"AM-OC-425'), /idézőjel/);
});

test('CSV delimiter detection skips leading blank rows but preserves their row positions', () => {
  const text = '\uFEFF\n \r\nJ-kód;Hely\nJ069;"AM-OC-425\nAM-OC-426"';
  const rows = parseCSV(text);
  assert.deepEqual(rows, [[''], [' '], ['J-kód', 'Hely'], ['J069', 'AM-OC-425\nAM-OC-426']]);
  const records = pairRows(rows);
  assert.equal(records[0].row, 4);
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425, AM-OC-426'});
});

test('OCR correction reasons propagate only from the paired location and its J cell', () => {
  const records = pairCells([
    cell('J069', 0, 0, 100, 100, {reasons: ['J javítás: JO69 → J069']}),
    cell('AM-OC-425', 100, 0, 300, 100, {reasons: ['Hely javítás: AM-0C-425 → AM-OC-425']}),
    cell('J070', 0, 100, 100, 200), cell('AM-OC-600', 100, 100, 300, 200),
  ]);
  assert.deepEqual(records[0].reasons, ['Hely javítás: AM-0C-425 → AM-OC-425', 'J javítás: JO69 → J069']);
  assert.equal(records[0].uncertain, true);
  assert.deepEqual(records[1].reasons, []);
  assert.equal(records[1].uncertain, false);
});

test('text fallback handles two explicit keys on one line and keeps orphans uncertain', () => {
  const records = parseText('J069 AM-OC-425; J070 AM-OC-600\nAM-OC-999\nCH-OC-100');
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425', J070: 'AM-OC-600'});
  assert.equal(records.at(-1).key, ''); assert.ok(records.every(record => record.uncertain));
});

test('plain numeric keys at the start of text lines preserve the previous TXT workflow', () => {
  const records = parseText('69 AM-OC-425\nNotes 70 AM-OC-600');
  assert.deepEqual(aggregate(records), {J069: 'AM-OC-425'});
  assert.equal(records[1].key, ''); assert.ok(records.every(row => row.uncertain));
});

test('aggregation excludes invalid records and preserves all repeated locations', () => {
  assert.deepEqual(aggregate([{key: 'J069', loc: 'AM-OC-425'}, {key: '69', loc: 'AM-OC-425, AM-OC-426'},
    {key: '', loc: 'AM-OC-999'}, {key: 'J070', loc: 'FR-OC-123'}]), {J069: 'AM-OC-425, AM-OC-426'});
});

test('numeric Excel keys use J, unaccented kod and underscored headers without treating quantities as keys', () => {
  for (const header of ['J','J-kod','J_kód','J code']) {
    const rows=pairRows([[header,'Mennyiség','Hely'],['069','2','AM-OC-425']]);
    assert.equal(rows[0].key,'J069');assert.equal(rows[0].uncertain,false);
  }
});

test('curved cell borders share logical dividers without overlapping physical crop boxes breaking pairing',()=>{
  const cells=[
    {text:'J069',x0:20,y0:20,x1:125,y1:180,laneId:'a',column:0,pairingBounds:{x0:0,y0:20,x1:100,y1:180}},
    {text:'AM-OC-425',x0:110,y0:20,x1:300,y1:100,laneId:'a',column:1,pairingBounds:{x0:100,y0:20,x1:200,y1:100}},
    {text:'AM-OC-426',x0:115,y0:100,x1:310,y1:180,laneId:'a',column:1,pairingBounds:{x0:100,y0:100,x1:200,y1:180}},
  ];
  const result=pairCells(cells);assert.deepEqual(result.map(r=>r.key),['J069','J069']);
  assert.deepEqual(result[0].bbox,{x0:110,y0:20,x1:300,y1:100});
});
test('logical cell coordinates cannot join separate table lanes or repair missing J cells',()=>{
  const rows=pairCells([
    {text:'J069',x0:20,y0:20,x1:100,y1:90,laneId:'a',column:0,pairingBounds:{x0:0,y0:20,x1:100,y1:90}},
    {text:'AM-OC-425',x0:110,y0:20,x1:300,y1:90,laneId:'b',column:1,pairingBounds:{x0:100,y0:20,x1:200,y1:90}},
  ]);
  assert.equal(rows[0].key,'');assert.equal(rows[0].uncertain,true);
});

test('unreadable physical location cells retain their known J as incomplete without inventing a location',()=>{
 const base={laneId:0};
 const cells=[{...base,column:0,text:'J069',x0:10,y0:10,x1:100,y1:100},
 {...base,column:1,text:'AM-OC-425',x0:100,y0:10,x1:220,y1:40},
 {...base,column:1,text:'AM-?C-4??',x0:100,y0:40,x1:220,y1:70},
 {...base,column:1,text:'A-DR-005-X',x0:100,y0:70,x1:220,y1:100}];
 const result=pairCells(cells,{includeUnparsed:true});
 assert.equal(result.length,2);assert.equal(result[1].key,'J069');assert.equal(result[1].loc,'');assert.equal(result[1].uncertain,true);
});
