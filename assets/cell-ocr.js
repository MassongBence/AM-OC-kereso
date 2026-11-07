import {adaptiveThreshold,warpPerspectivePixels} from './image-pipeline.js';
import {selectOcrHypothesis} from './ocr-suggestions.js';

const canvasOf=(width,height)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(width));c.height=Math.max(1,Math.ceil(height));return c;};

/** Infer the print scale from connected ink, excluding thin cell rulings.
 * This mask is only used to crop/measure. OCR receives preserved grayscale. */
export function analyzeCellInk(rgba,width,height) {
  const gray=new Uint8Array(width*height),hist=new Uint32Array(256);
  for(let i=0;i<gray.length;i++){const p=i*4;gray[i]=Math.round((rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114)*(rgba[p+3]/255)+255*(1-rgba[p+3]/255));hist[gray[i]]++;}
  let total=0,low=0,high=255;
  for(let i=0;i<256;i++){total+=hist[i];if(total>=Math.max(1,gray.length*.003)){low=i;break;}}
  total=0;for(let i=255;i>=0;i--){total+=hist[i];if(total>=gray.length*.15){high=i;break;}}
  if(high-low<20)return {bounds:null,glyphHeight:0,removed:[],gray};
  const threshold=low+(high-low)*.60,removed=[];
  // Rule detection is a measurement mask only. Never whiten source pixels or
  // a component's bounding rectangle: a rule can touch a real digit.
  const ruleMask=new Uint8Array(gray.length);
  const margin=Math.max(2,Math.min(4,Math.floor(Math.min(width,height)*.08)));
  for(let y=0;y<height;y++)if(y<margin||y>=height-margin){let count=0;for(let x=0;x<width;x++)if(gray[y*width+x]<threshold)count++;if(count>width*.70)for(let x=0;x<width;x++)ruleMask[y*width+x]=1;}
  for(let x=0;x<width;x++)if(x<margin||x>=width-margin){let count=0;for(let y=0;y<height;y++)if(gray[y*width+x]<threshold)count++;if(count>height*.70)for(let y=0;y<height;y++)ruleMask[y*width+x]=1;}
  const visited=new Uint8Array(gray.length),queue=new Int32Array(gray.length),components=[];
  for(let start=0;start<gray.length;start++){
    if(visited[start]||gray[start]>=threshold)continue;
    let head=0,tail=1,x0=width,y0=height,x1=-1,y1=-1,body=0;queue[0]=start;visited[start]=1;
    while(head<tail){const n=queue[head++],x=n%width,y=Math.floor(n/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);if(!ruleMask[n])body++;
      const add=next=>{if(!visited[next]&&gray[next]<threshold){visited[next]=1;queue[tail++]=next;}};
      if(x>0)add(n-1);if(x+1<width)add(n+1);if(y>0)add(n-width);if(y+1<height)add(n+width);
    }
    const spansEdge=(x1-x0+1>=width*.95)||(y1-y0+1>=height*.95);
    if(!body&&spansEdge){removed.push({x0,y0,x1:x1+1,y1:y1+1});continue;}
    // Preserve the complete component when it joins a border. Cropping to the
    // remaining mask alone would also cut off the touching character stroke.
    if(tail>=3)components.push({x0,y0,x1:x1+1,y1:y1+1,area:tail});
  }
  if(!components.length)return {bounds:null,glyphHeight:0,removed,gray};
  const heights=components.filter(c=>c.y1-c.y0>=4&&c.area>=5).map(c=>c.y1-c.y0).sort((a,b)=>a-b);
  const glyphHeight=heights.length?heights[Math.floor(heights.length*.6)]:0;
  const bounds={x0:Math.max(0,Math.min(...components.map(c=>c.x0))-2),y0:Math.max(0,Math.min(...components.map(c=>c.y0))-2),x1:Math.min(width,Math.max(...components.map(c=>c.x1))+2),y1:Math.min(height,Math.max(...components.map(c=>c.y1))+2)};
  return {bounds,glyphHeight,removed,gray,low,high};
}

export function glyphScale(glyphHeight,inkWidth,{targetHeight=60,maxWidth=1600}={}) {
  if(!Number.isFinite(glyphHeight)||glyphHeight<=0||!Number.isFinite(inkWidth)||inkWidth<=0)return 1;
  return Math.max(.5,Math.min(6,Math.max(1,targetHeight/glyphHeight),maxWidth/inkWidth));
}

/** The order matters: resample gray text first; source-resolution thresholding
 * can irreversibly close a small '6' into an '8'. */
export function thresholdResampledInk(rgba,width,height,glyphHeight) {
  return adaptiveThreshold(rgba,width,height,Math.max(15,Math.min(31,Math.round(glyphHeight*.4))),10);
}

/** Normalize each paper cell rather than treating a photographed gray paper
 * rectangle beside pure-white padding as part of the printed character. */
export function stretchCellGray(rgba,low,high) {
  const output=new Uint8ClampedArray(rgba);
  if(!Number.isFinite(low)||!Number.isFinite(high)||high-low<20)return output;
  for(let i=0;i<output.length;i+=4){const gray=(rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114);const value=Math.max(0,Math.min(255,Math.round((gray-low)*255/(high-low))));output[i]=output[i+1]=output[i+2]=value;}
  return output;
}

/** A field-specific reread still needs a physically observed literal J. It is
 * never a string substitution or a lookup of which J identifiers should exist. */
export function needsNumericKeyRetry(box,hypotheses) {
  if(box.column!==0)return false;
  return hypotheses.some(h=>{
    const text=String(h.text||'').replace(/\s/g,'').toUpperCase();
    const first=(h.symbols||[]).find(symbol=>!/^\s*$/.test(String(symbol.text)));
    return /^J[0-9OISBL]{1,4}$/.test(text)&&/[OISBL]/.test(text.slice(1))&&first?.text?.toUpperCase()==='J'&&first.confidence>=95;
  });
}

function rectifiedCell(source,box) {
  const x0=Math.max(0,Math.floor(box.x0)),y0=Math.max(0,Math.floor(box.y0)),x1=Math.min(source.width,Math.ceil(box.x1)),y1=Math.min(source.height,Math.ceil(box.y1));
  const cut=canvasOf(x1-x0,y1-y0),context=cut.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,cut.width,cut.height);
  context.drawImage(source,x0,y0,cut.width,cut.height,0,0,cut.width,cut.height);
  if(Array.isArray(box.polygon)&&box.polygon.length===4&&cut.width>6&&cut.height>6){
    const corners=box.polygon.map(p=>({x:Math.max(0,Math.min(1,(p.x-x0)/(cut.width-1))),y:Math.max(0,Math.min(1,(p.y-y0)/(cut.height-1)))}));
    try{const raw=context.getImageData(0,0,cut.width,cut.height),warp=warpPerspectivePixels(raw.data,cut.width,cut.height,corners,1800),out=canvasOf(warp.width,warp.height),outContext=out.getContext('2d',{willReadFrequently:true}),pixels=outContext.createImageData(warp.width,warp.height);pixels.data.set(warp.data);outContext.putImageData(pixels,0,0);
      // Move inside each rectified edge independently. A diagonal inset is
      // almost zero in x for a tall rowspan cell and leaves its vertical rule.
      const insetX=Math.min(4,out.width*.045),insetY=Math.min(3,out.height*.10),inner=canvasOf(out.width-2*insetX,out.height-2*insetY);
      inner.getContext('2d',{willReadFrequently:true}).drawImage(out,insetX,insetY,out.width-2*insetX,out.height-2*insetY,0,0,inner.width,inner.height);
      cut.width=cut.height=out.width=out.height=1;return inner;}catch{/* Malformed geometry stays visibly uncertain in the geometry layer. */}
  }
  // Legacy rectangles include their printed edge. Keep enough margin for tiny
  // glyphs instead of a fixed 6 px inset that can amputate small print.
  const inset=Math.min(4,cut.width*.04,cut.height*.12),out=canvasOf(cut.width-2*inset,cut.height-2*inset);
  out.getContext('2d',{willReadFrequently:true}).drawImage(cut,inset,inset,cut.width-2*inset,cut.height-2*inset,0,0,out.width,out.height);cut.width=cut.height=1;return out;
}

export function prepareCellViews(source,box) {
  const cut=rectifiedCell(source,box),context=cut.getContext('2d',{willReadFrequently:true}),raw=context.getImageData(0,0,cut.width,cut.height),ink=analyzeCellInk(raw.data,cut.width,cut.height);
  if(!ink.bounds){cut.width=cut.height=1;return null;}
  const normalized=context.getImageData(0,0,cut.width,cut.height);normalized.data.set(stretchCellGray(normalized.data,ink.low,ink.high));context.putImageData(normalized,0,0);
  const b=ink.bounds,scale=glyphScale(ink.glyphHeight,b.x1-b.x0),pad=20,width=Math.ceil((b.x1-b.x0)*scale),height=Math.ceil((b.y1-b.y0)*scale);
  const gray=canvasOf(width+pad*2,height+pad*2),grayContext=gray.getContext('2d',{willReadFrequently:true});grayContext.fillStyle='#fff';grayContext.fillRect(0,0,gray.width,gray.height);grayContext.drawImage(cut,b.x0,b.y0,b.x1-b.x0,b.y1-b.y0,pad,pad,width,height);cut.width=cut.height=1;
  const threshold=canvasOf(gray.width,gray.height),thresholdContext=threshold.getContext('2d',{willReadFrequently:true}),pixels=grayContext.getImageData(0,0,gray.width,gray.height),binary=thresholdResampledInk(pixels.data,gray.width,gray.height,ink.glyphHeight*scale);
  for(let i=0;i<binary.length;i++)pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=binary[i]?0:255;
  thresholdContext.putImageData(pixels,0,0);
  return {gray,threshold,glyphHeight:ink.glyphHeight,scale,dispose(){gray.width=gray.height=threshold.width=threshold.height=1;}};
}

const foreign=text=>/^(?:A|C)[\s-]*DR\b|^(?:CH|FR)[\s-]*OC\b/i.test(String(text).trim());
function symbolsFrom(data){const words=data.words||data.blocks?.flatMap(b=>b.paragraphs?.flatMap(p=>p.lines?.flatMap(l=>l.words||[])||[])||[])||[];return words.flatMap(word=>(word.symbols||[]).map(s=>({text:s.text,confidence:s.confidence})));}

/** Compare prepared views separately from geometry so the retry policy can be
 * tested without a camera, canvas implementation, or an OCR model download. */
export async function recognizePreparedCell(worker,prepared,box,{onStatus=()=>{}}={}) {
  const started=performance.now(),hypotheses=[];
  const recognize=async(method,variant,canvas,psm,whitelist='')=>{onStatus(method);await worker.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:whitelist});const {data}=await worker.recognize(canvas,{}, {blocks:true,text:true});hypotheses.push({method,variant,text:data.text,confidence:data.confidence,symbols:symbolsFrom(data)});};
  await recognize('gray-hires-line','gray',prepared.gray,'7');
  await recognize('local-threshold-hires-block','threshold',prepared.threshold,'6');
  let selected=selectOcrHypothesis(hypotheses,{boundedCell:true});
  const allForeign=hypotheses.every(h=>foreign(h.text));
  const codeLike=()=>hypotheses.some(h=>/[JAMO\d]/i.test(h.text));
  if(!selected.evidence.reliable&&!allForeign&&codeLike()){
    await recognize('gray-hires-block','gray',prepared.gray,'6');
    selected=selectOcrHypothesis(hypotheses,{boundedCell:true});
  }
  // Raw-line segmentation can resolve dictionary-shaped codes without a
  // whitelist. Keep already corroborated readings frozen: this retry can also
  // misread otherwise clear print, so it is never a replacement default.
  if(!selected.evidence.reliable&&!allForeign&&codeLike()){
    await recognize('gray-hires-raw-line','gray',prepared.gray,'13');
    await recognize('local-threshold-hires-raw-line','threshold',prepared.threshold,'13');
    selected=selectOcrHypothesis(hypotheses,{boundedCell:true});
    if(hypotheses.some(h=>foreign(h.text))&&selected.evidence.kind){
      selected.evidence.reliable=false;selected.evidence.foreignConflict=true;
      selected.reasons=[...new Set([...selected.reasons,'Az OCR-módszerek eltérő kódtípust olvastak; nem megbízható eredmény.'])];
    }
  }
  if(!selected.evidence.reliable&&needsNumericKeyRetry(box,hypotheses)){
    try{
      await recognize('key-numeric-gray','gray',prepared.gray,'7','J0123456789');
      await recognize('key-numeric-threshold','threshold',prepared.threshold,'7','J0123456789');
      selected=selectOcrHypothesis(hypotheses,{boundedCell:true});
      // A whitelist must never manufacture confidence in a key.
      selected.evidence.reliable=false;selected.evidence.numericFieldRetry=true;
      selected.reasons=[...new Set([...selected.reasons,'Számmezőre korlátozott OCR-javaslat; nem automatikusan megbízható adat.'])];
    }finally{await worker.setParameters({tessedit_char_whitelist:''});}
  }
  return {...box,text:selected.text,confidence:selected.confidence,reasons:selected.reasons,evidence:{...selected.evidence,glyphHeight:prepared.glyphHeight,scale:prepared.scale,elapsedMs:performance.now()-started},grid:true};
}

/** OCR stays entirely in the browser; prepared image buffers are released even
 * when recognition fails. */
export async function recognizeCell(worker,views,box,options={}) {
  const prepared=prepareCellViews(views.grayCanvas||views.canvas,box);
  if(!prepared)return {...box,text:'',confidence:0,reasons:[],evidence:{reliable:false,kind:'',hypotheses:[],blank:true}};
  try{return await recognizePreparedCell(worker,prepared,box,options);}
  finally{prepared.dispose();}
}
