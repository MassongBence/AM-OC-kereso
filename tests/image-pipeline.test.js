import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveThreshold, detectCells, estimateSkew, assignWordsToCells, contrastGrayscale, validatePerspectiveCorners, perspectiveHomography, warpPerspectivePixels, detectPerspectiveQuad} from '../assets/image-pipeline.js';

function ruledTable() {
  const width = 500, height = 400, binary = new Uint8Array(width * height);
  const horizontal = (y, x0, x1) => { for (let x = x0; x <= x1; x++) binary[y * width + x] = 1; };
  for (const x of [20, 120, 450]) for (let y = 20; y <= 380; y++) binary[y * width + x] = 1;
  for (const y of [20, 180, 280, 380]) horizontal(y, 20, 450);
  horizontal(100, 120, 450); // merged J cell, two separate location rows
  return {width, height, binary};
}

test('ruled cell detection retains a vertically merged J cell', () => {
  const {binary, width, height} = ruledTable();
  const cells = detectCells(binary, width, height);
  assert.equal(cells.length, 7);
  assert.deepEqual(cells[0], {x0: 20, y0: 20, x1: 120, y1: 180});
  assert(cells.some(cell => cell.x0 === 120 && cell.y0 === 20 && cell.y1 === 100));
  assert(cells.some(cell => cell.x0 === 120 && cell.y0 === 100 && cell.y1 === 180));
});

test('no synthetic table is invented for an unruled or blank page', () => {
  assert.deepEqual(detectCells(new Uint8Array(500 * 400), 500, 400), []);
});

test('words inherit cell bounds, including tall merged key bounds; outliers remain visible', () => {
  const words = [
    {text: 'J069', bbox: {x0: 30, y0: 85, x1: 80, y1: 105}, confidence: 95},
    {text: 'AM-OC-425', bbox: {x0: 140, y0: 35, x1: 280, y1: 55}, confidence: 92},
    {text: 'AM-OC-426', bbox: {x0: 140, y0: 125, x1: 280, y1: 145}, confidence: 86},
    {text: 'AM-OC-999', bbox: {x0: 460, y0: 350, x1: 499, y1: 370}, confidence: 70},
  ];
  const {binary, width, height} = ruledTable();
  const cells = assignWordsToCells(words, detectCells(binary, width, height));
  assert.equal(cells.length, 4);
  assert.equal(cells.find(cell => cell.text === 'J069').y0, 20);
  assert.equal(cells.find(cell => cell.text === 'J069').y1, 180);
  assert.equal(cells.find(cell => cell.text === 'AM-OC-999').unbounded, true);
});

test('split OCR tokens are joined within the same cell with conservative confidence', () => {
  const cells = assignWordsToCells([
    {text: 'AM', bbox: {x0: 20, y0: 10, x1: 35, y1: 20}, confidence: 98},
    {text: 'OC-425', bbox: {x0: 40, y0: 11, x1: 90, y1: 21}, confidence: 80},
  ], [{x0: 0, y0: 0, x1: 100, y1: 30}]);
  assert.equal(cells[0].text, 'AM OC-425');
  assert.equal(cells[0].confidence, 80);
});

test('adaptive threshold recovers dark print across a gradual shadow', () => {
  const width = 200, height = 80, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, background = 120 + Math.round(120 * x / width);
    const value = y === 40 && x > 10 && x < 190 ? background - 90 : background;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = value; rgba[p + 3] = 255;
  }
  const binary = adaptiveThreshold(rgba, width, height, 15, 12);
  for (const x of [20, 80, 160]) assert.equal(binary[40 * width + x], 1);
  assert.equal(binary[20 * width + 80], 0);
});

test('skew estimate follows tilted horizontal ruling instead of matching text baselines', () => {
  const width = 600, height = 400, binary = new Uint8Array(width * height), angle = 3;
  for (const base of [40, 110, 180, 250, 320]) for (let x = 30; x < 570; x++) {
    const y = Math.round(base + Math.tan(angle * Math.PI / 180) * (x - width / 2));
    binary[y * width + x] = binary[(y + 1) * width + x] = 1;
  }
  assert(Math.abs(estimateSkew(binary, width, height) - angle) <= .3);
});


test('perspective mapping rectifies four actual corners instead of an axis-aligned crop', () => {
  const corners=[{x:.2,y:.1},{x:.8,y:.2},{x:.95,y:.9},{x:.05,y:.9}];
  const h=perspectiveHomography(corners);
  for (const [index,[u,v]] of [[0,[0,0]],[1,[1,0]],[2,[1,1]],[3,[0,1]]]) {
    const d=h[6]*u+h[7]*v+1;
    assert(Math.abs((h[0]*u+h[1]*v+h[2])/d-corners[index].x)<1e-8);
    assert(Math.abs((h[3]*u+h[4]*v+h[5])/d-corners[index].y)<1e-8);
  }
  const width=101,height=101,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;data[p]=x;data[p+1]=y;data[p+3]=255;}
  const warped=warpPerspectivePixels(data,width,height,corners);
  for(const [i,[x,y]] of [[0,[0,0]],[1,[warped.width-1,0]],[2,[warped.width-1,warped.height-1]],[3,[0,warped.height-1]]]) {
    const p=(y*warped.width+x)*4;
    assert(Math.abs(warped.data[p]-corners[i].x*100)<=1);
    assert(Math.abs(warped.data[p+1]-corners[i].y*100)<=1);
  }
});

test('perspective input rejects crossed, off-image, degenerate and tiny quadrilaterals', () => {
  for(const corners of [null,[{x:0,y:0}], [{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}], [{x:-.1,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}], [{x:.1,y:.1},{x:.11,y:.1},{x:.11,y:.11},{x:.1,y:.11}]]) assert.throws(()=>validatePerspectiveCorners(corners));
});

test('contrast view preserves white empty documents and independently stretches gray print', () => {
  const white=new Uint8ClampedArray(400).fill(255);
  assert.deepEqual(contrastGrayscale(white,10,10),white);
  const source=new Uint8ClampedArray(100*4);
  for(let i=0;i<100;i++){source[i*4]=source[i*4+1]=source[i*4+2]=i<50?100:220;source[i*4+3]=255;}
  const result=contrastGrayscale(source,10,10);
  assert.equal(result[0],0);assert.equal(result[200],255);
});

test('automatic perspective uses supported ruled borders and refuses a missing edge', () => {
  const width=600,height=450,binary=new Uint8Array(width*height);
  const quad=[{x:70,y:45},{x:520,y:80},{x:560,y:405},{x:35,y:405}];
  function line(a,b,canvas=binary){const steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2);for(let n=0;n<=steps;n++){const x=Math.round(a.x+(b.x-a.x)*n/steps),y=Math.round(a.y+(b.y-a.y)*n/steps);for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(xx>=0&&xx<width&&yy>=0&&yy<height)canvas[yy*width+xx]=1;}}
  for(let i=0;i<4;i++)line(quad[i],quad[(i+1)%4]);
  const detected=detectPerspectiveQuad(binary,width,height);
  assert.ok(detected,'four ruled borders should be detected');
  detected.corners.forEach((p,i)=>{assert(Math.abs(p.x*(width-1)-quad[i].x)<7);assert(Math.abs(p.y*(height-1)-quad[i].y)<7);});
  assert(detected.quality>=.86);
  const missing=new Uint8Array(width*height);for(let i=0;i<3;i++)line(quad[i],quad[(i+1)%4],missing);
  assert.equal(detectPerspectiveQuad(missing,width,height),null);
});

test('detected perspective correction restores a grid with a vertically merged key cell', () => {
  const width=600,height=450,binary=new Uint8Array(width*height);
  const quad=[{x:70,y:45},{x:520,y:80},{x:560,y:405},{x:35,y:405}];
  const h=perspectiveHomography(quad.map(p=>({x:p.x/(width-1),y:p.y/(height-1)})));
  const map=(u,v)=>{const d=h[6]*u+h[7]*v+1;return{x:(h[0]*u+h[1]*v+h[2])/d*(width-1),y:(h[3]*u+h[4]*v+h[5])/d*(height-1)};};
  const line=(a,b)=>{const steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2);for(let n=0;n<=steps;n++){const x=Math.round(a.x+(b.x-a.x)*n/steps),y=Math.round(a.y+(b.y-a.y)*n/steps);for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(xx>=0&&xx<width&&yy>=0&&yy<height)binary[yy*width+xx]=1;}};
  for(const u of[0,.25,1])line(map(u,0),map(u,1));
  for(const v of[0,.5,.75,1])line(map(0,v),map(1,v));
  line(map(.25,.25),map(1,.25));
  const rgba=new Uint8ClampedArray(width*height*4).fill(255);
  for(let i=0;i<binary.length;i++)rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=binary[i]?0:255;
  const detected=detectPerspectiveQuad(binary,width,height);
  const warped=warpPerspectivePixels(rgba,width,height,detected.corners);
  const cells=detectCells(adaptiveThreshold(warped.data,warped.width,warped.height),warped.width,warped.height);
  assert.equal(cells.length,7);
  const key=cells[0];
  assert(key.y1-key.y0>warped.height*.45,'merged J cell should span two location rows');
  assert.equal(cells.filter(cell=>cell.x0>key.x0&&cell.y1<key.y1+3).length,2);
});
