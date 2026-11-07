import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

let browser,source;
before(async()=>{
  source=await readFile(new URL('../assets/image-pipeline.js',import.meta.url),'utf8');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
});
after(async()=>{await browser?.close();});
async function pageWithPipeline(t){
  const page=await browser.newPage();t.after(()=>page.close());
  await page.setContent('<!doctype html><html lang="hu"></html>');
  await page.addScriptTag({type:'module',content:source+'\nwindow.cameraPipeline={imageFileToCanvas,prepareDocument};'});
  await page.waitForFunction(()=>!!window.cameraPipeline);return page;
}

test('phone-resolution JPEG keeps source detail for OCR while geometry and previews are bounded separately', {timeout:60_000},async t=>{
  const page=await pageWithPipeline(t);
  const actual=await page.evaluate(async()=>{
    const input=document.createElement('canvas');input.width=4032;input.height=3024;
    const c=input.getContext('2d');c.fillStyle='white';c.fillRect(0,0,input.width,input.height);
    c.fillStyle='black';c.font='24px Arial';c.fillText('J069 AM-OC-425',120,140);
    c.strokeStyle='black';c.lineWidth=3;
    for(const x of[200,900,3000]){c.beginPath();c.moveTo(x,300);c.lineTo(x,2800);c.stroke();}
    for(const y of[300,1200,2100,2800]){c.beginPath();c.moveTo(200,y);c.lineTo(3000,y);c.stroke();}
    c.beginPath();c.moveTo(900,650);c.lineTo(3000,650);c.stroke();
    const blob=await new Promise(resolve=>input.toBlob(resolve,'image/jpeg',.96));
    const file=new File([blob],'camera.jpg',{type:'image/jpeg'});
    input.width=input.height=1;
    // Any conversion back to JPEG in decoding/preprocessing would be a failure.
    HTMLCanvasElement.prototype.toBlob=()=>{throw new Error('Unexpected recompression');};
    HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('Unexpected recompression');};
    const preview=await cameraPipeline.imageFileToCanvas(file,{maxSide:640,maxPixels:640*640});
    const decoded=await cameraPipeline.imageFileToCanvas(file);
    const legacy=await cameraPipeline.imageFileToCanvas(file,{maxSide:2600,maxPixels:2600*2600});
    const glyphHeight=canvas=>{const sx=canvas.width/4032,sy=canvas.height/3024;
      const image=canvas.getContext('2d').getImageData(Math.floor(110*sx),Math.floor(105*sy),Math.ceil(240*sx),Math.ceil(40*sy));
      let first=image.height,last=-1;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4]<100){first=Math.min(first,y);last=Math.max(last,y);}return last-first+1;};
    const retainedGlyphHeight=glyphHeight(decoded),legacyGlyphHeight=glyphHeight(legacy);
    const prepared=await cameraPipeline.prepareDocument(decoded,{deskew:false,perspective:false});
    const result={preview:[preview.width,preview.height],decoded:[decoded.width,decoded.height],
      glyphHeight:retainedGlyphHeight,legacyGlyphHeight,input:decoded.imageDiagnostics,diagnostics:prepared.diagnostics,
      output:[prepared.grayCanvas.width,prepared.grayCanvas.height],cells:prepared.cells.length,
      firstCell:prepared.cells[0]};
    for(const canvas of[preview,decoded,legacy,prepared.canvas,prepared.grayCanvas])canvas.width=canvas.height=1;
    return result;
  });
  assert.deepEqual(actual.preview,[640,480]);
  assert.deepEqual(actual.decoded,[3266,2449]);
  assert.deepEqual(actual.output,actual.decoded,'OCR source must not shrink to the geometry sample');
  assert.equal(actual.input.originalWidth,4032);assert.equal(actual.input.originalHeight,3024);
  assert.equal(actual.input.jpegReencoded,false);assert.equal(actual.diagnostics.jpegReencoded,false);
  assert.equal(actual.diagnostics.geometry.width,2600);
  assert(actual.glyphHeight>actual.legacyGlyphHeight,'the same photographed small print retains more pixels than the2600px control');
  assert.equal(actual.cells,7);
  assert(actual.firstCell.x0>150&&actual.firstCell.x0<175,'physical cell bounds map back from the2600px geometry sample');
});

function orientation6JPEG(jpeg){
  const segment=Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
  return Buffer.concat([jpeg.subarray(0,2),segment,jpeg.subarray(2)]);
}

test('EXIF orientation is applied once by both bitmap and browser image fallback routes',async t=>{
  const page=await pageWithPipeline(t);
  const jpeg=Buffer.from(await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=120;c.height=60;const ctx=c.getContext('2d');
    ctx.fillStyle='red';ctx.fillRect(0,0,60,60);ctx.fillStyle='blue';ctx.fillRect(60,0,60,60);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.98));return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  const result=await page.evaluate(async bytes=>{
    const file=new File([new Uint8Array(bytes)],'oriented.jpg',{type:'image/jpeg'});
    const bitmap=await cameraPipeline.imageFileToCanvas(file);
    const originalBitmap=window.createImageBitmap;window.createImageBitmap=undefined;
    let fallback;try{fallback=await cameraPipeline.imageFileToCanvas(file);}finally{window.createImageBitmap=originalBitmap;}
    const inspect=canvas=>{const c=canvas.getContext('2d');return{width:canvas.width,height:canvas.height,decoder:canvas.imageDiagnostics.decoder,top:[...c.getImageData(30,20,1,1).data],bottom:[...c.getImageData(30,100,1,1).data]};};
    return{bitmap:inspect(bitmap),fallback:inspect(fallback)};
  },[...orientation6JPEG(jpeg)]);
  for(const route of[result.bitmap,result.fallback]){
    assert.deepEqual([route.width,route.height],[60,120]);
    assert(route.top[0]>220&&route.top[2]<40,'left source red becomes top after clockwise EXIF rotation');
    assert(route.bottom[2]>220&&route.bottom[0]<40);
  }
  assert.equal(result.bitmap.decoder,'createImageBitmap');assert.equal(result.fallback.decoder,'HTMLImageElement');
});

test('existing2048px photos keep their dimensions and the existing preprocessing path',async t=>{
  const page=await pageWithPipeline(t);
  const result=await page.evaluate(async()=>{
    const original=document.createElement('canvas');original.width=1536;original.height=2048;
    original.getContext('2d').fillStyle='#fff';original.getContext('2d').fillRect(0,0,1536,2048);
    const blob=await new Promise(r=>original.toBlob(r,'image/png'));original.width=original.height=1;
    const decoded=await cameraPipeline.imageFileToCanvas(new File([blob],'old.png',{type:'image/png'}));
    const prepared=await cameraPipeline.prepareDocument(decoded,{deskew:false,perspective:false});
    return{decoded:[decoded.width,decoded.height],prepared:[prepared.canvas.width,prepared.canvas.height],
      resized:decoded.imageDiagnostics.resized,view:prepared.diagnostics.ocr.view,geometry:prepared.diagnostics.geometry};
  });
  assert.deepEqual(result.decoded,[1536,2048]);assert.deepEqual(result.prepared,[1536,2048]);
  assert.equal(result.resized,false);assert.equal(result.view,'contrast-grayscale');assert.equal(result.geometry.scaleToOcrX,1);
});
