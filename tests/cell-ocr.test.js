import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCellInk,glyphScale,thresholdResampledInk,stretchCellGray,needsNumericKeyRetry,recognizePreparedCell} from '../assets/cell-ocr.js';

function image(width,height,background=220){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++){data[i*4]=data[i*4+1]=data[i*4+2]=background;data[i*4+3]=255;}return data;}
function ink(data,width,x0,y0,x1,y1,value=35){for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=value;}}
test('small print is scaled from glyph height rather than merged-cell height',()=>{
  assert.equal(glyphScale(12,100),5);assert.equal(glyphScale(30,100),2);assert.equal(glyphScale(60,100),1);
  assert.ok(glyphScale(6,500)<=1600/500,'wide text cannot allocate an unbounded OCR image');
});
test('ink analysis removes thin cell borders while preserving a narrow digit',()=>{
  const width=100,height=80,data=image(width,height);ink(data,width,0,0,2,80);ink(data,width,0,78,100,80);ink(data,width,30,25,33,37);ink(data,width,40,25,48,37);
  const result=analyzeCellInk(data,width,height);assert.ok(result.removed.length>=1);assert.equal(result.glyphHeight,12);assert.deepEqual(result.bounds,{x0:28,y0:23,x1:50,y1:39});
});
test('empty/low-contrast cell does not become a fabricated code candidate',()=>{
  const result=analyzeCellInk(image(80,40),80,40);assert.equal(result.bounds,null);assert.equal(result.glyphHeight,0);
});
test('high-resolution local threshold preserves separated strokes under a gradual shadow',()=>{
  const width=160,height=80,data=image(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4,v=145+Math.round(x*.5);data[p]=data[p+1]=data[p+2]=v;}
  ink(data,width,30,20,34,60,25);ink(data,width,90,20,94,60,55);
  const binary=thresholdResampledInk(data,width,height,40);assert.equal(binary[30*width+31],1);assert.equal(binary[30*width+91],1);assert.equal(binary[30*width+65],0);
});
test('a short J label inside a tall merged cell is not mistaken for a blank cell',()=>{
  const width=100,height=300,data=image(width,height,255);
  for(const x of [24,36,48,60])ink(data,width,x,140,x+4,152,30);
  const result=analyzeCellInk(data,width,height);
  assert.ok(result.bounds,'less than one percent foreground can still be valid print');
  assert.equal(result.glyphHeight,12);
  assert.deepEqual(result.bounds,{x0:22,y0:138,x1:66,y1:154});
});

test('cell-local contrast makes gray paper white without reversing ink or losing alpha',()=>{
  const input=Uint8ClampedArray.from([70,70,70,255,105,105,105,255,140,140,140,255]);
  const out=stretchCellGray(input,70,140);
  assert.deepEqual([...out],[0,0,0,255,128,128,128,255,255,255,255,255]);
  assert.equal(input[0],70,'source pixels must remain unchanged');
});
test('numeric field retry requires both the physical key column and a strong observed literal J',()=>{
  const candidate=[{text:'JOI3',symbols:[{text:'J',confidence:99},{text:'O',confidence:99},{text:'I',confidence:99},{text:'3',confidence:99}]}];
  assert.equal(needsNumericKeyRetry({column:0},candidate),true);
  assert.equal(needsNumericKeyRetry({column:1},candidate),false);
  assert.equal(needsNumericKeyRetry({},candidate),false);
  assert.equal(needsNumericKeyRetry({column:0},[{text:'OI3',symbols:[]}]),false);
  assert.equal(needsNumericKeyRetry({column:0},[{text:'JOI3',symbols:[{text:'J',confidence:80}]}]),false);
  assert.equal(needsNumericKeyRetry({column:0},[{text:'J code',symbols:[{text:'J',confidence:99}]}]),false);
});

test('border analysis never modifies source pixels or amputates an attached digit',()=>{
 const width=100,height=60,data=image(width,height);ink(data,width,0,0,100,2);
 // A digit-like vertical stroke and crossbar touch the top rule.
 ink(data,width,83,1,86,24);ink(data,width,75,12,86,15);
 ink(data,width,25,12,32,24);
 const before=Uint8ClampedArray.from(data),result=analyzeCellInk(data,width,height);
 assert.deepEqual(data,before,'analysis must not change the input');
 assert.equal(result.gray[13*width+84],35,'a touching digit remains real ink, not paper');
 assert.ok(result.bounds.x1>=86&&result.bounds.y1>=24,'crop retains the complete touching character');
 assert.ok(!result.removed.some(r=>r.x0<=84&&r.x1>84&&r.y0<=13&&r.y1>13),'no broad erased bounding box may cover digit strokes');
});


const preparedViews={gray:{variant:'gray'},threshold:{variant:'threshold'},glyphHeight:12,scale:5};
function workerStub(reading) {
 const calls=[];let parameters={};
 return {calls,async setParameters(values){parameters={...parameters,...values};},async recognize(canvas){
   const call={variant:canvas.variant,psm:parameters.tessedit_pageseg_mode,whitelist:parameters.tessedit_char_whitelist};calls.push(call);
   const text=reading(call),symbols=[...text].filter(c=>!/\s/.test(c)).map(text=>({text,confidence:99}));
   return {data:{text,confidence:95,words:[{symbols}]}};
 }};
}
test('raw-line retry leaves an already corroborated cell frozen',async()=>{
 const worker=workerStub(()=> 'AM-OC-627');
 const result=await recognizePreparedCell(worker,preparedViews,{column:1});
 assert.equal(result.text,'AM-OC-627');assert.equal(result.evidence.reliable,true);
 assert.deepEqual(worker.calls.map(c=>c.psm),['7','6']);
});
test('unresolved code gets unrestricted raw-line gray and threshold readings before any whitelist',async()=>{
 const worker=workerStub(call=>call.psm==='13'?'J056':'JOS6');
 const result=await recognizePreparedCell(worker,preparedViews,{column:0});
 assert.equal(result.text,'J056');assert.equal(result.evidence.reliable,true);
 assert.deepEqual(worker.calls.map(c=>c.psm),['7','6','6','13','13']);
 assert.ok(worker.calls.every(c=>c.whitelist===''),'raw-line retry must not constrain the answer');
});
test('raw-line retry never inserts a missing J or converts foreign namespace disagreement into trusted data',async()=>{
 const missing=workerStub(()=> '056');
 const first=await recognizePreparedCell(missing,preparedViews,{column:0});
 assert.equal(first.evidence.reliable,false);assert.notEqual(first.text,'J056');
 assert.ok(missing.calls.every(c=>c.whitelist===''),'a missing literal J cannot trigger numeric field repair');
 const foreign=workerStub(call=>call.psm==='13'?'AM-OC-604':'FR-OC-604');
 // A consistent excluded namespace does not need any retry.
 const second=await recognizePreparedCell(foreign,preparedViews,{column:1});
 assert.equal(second.evidence.reliable,false);assert.equal(foreign.calls.length,2);
 const disagreement=workerStub(call=>call.variant==='threshold'&&call.psm==='6'?'FR-OC-604':call.psm==='13'?'AM-OC-604':'AM-OC-6O4');
 const third=await recognizePreparedCell(disagreement,preparedViews,{column:1});
 assert.equal(third.text,'AM-OC-604');assert.equal(third.evidence.reliable,false);
 assert.equal(third.evidence.foreignConflict,true);
});

test('a short numeral at a crop edge is not classified as a full-height rule',()=>{
 const width=60,height=24,data=image(width,height);
 ink(data,width,0,3,2,21);ink(data,width,20,4,26,20);
 const result=analyzeCellInk(data,width,height);
 assert.equal(result.bounds.x0,0,'the left digit remains inside the OCR crop');
 assert.ok(result.bounds.y1>=21);
 assert.equal(result.gray[10*width],35);
});
