/**
 * Local, bounded-memory preprocessing for photographed printed tables.
 * This is a ruled-table detector, not a learned document model: missing borders,
 * severe perspective, folds and occluded text still require human review.
 */
const MAX_SIDE = 4096;
const MAX_PIXELS = 8_000_000;
const GEOMETRY_SIDE = 2600;

/** Canvas memory is bounded independently from aspect ratio. Original image
 * bytes are not recompressed; this is a single documented resize budget. */
export function imageDimensions(width,height,{maxSide=MAX_SIDE,maxPixels=MAX_PIXELS}={}) {
  if(![width,height,maxSide,maxPixels].every(Number.isFinite)||width<=0||height<=0||maxSide<1||maxPixels<1)throw new Error('Érvénytelen képméret.');
  const scale=Math.min(1,maxSide/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));
  let w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(w*h>maxPixels){if(w>=h)w=Math.max(1,Math.floor(maxPixels/h));else h=Math.max(1,Math.floor(maxPixels/w));}
  return {width:w,height:h,scaleX:w/width,scaleY:h/height};
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function fittedCanvas(source, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const size=imageDimensions(width,height,{maxSide,maxPixels});
  const canvas=canvasOf(size.width,size.height);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(source,0,0,canvas.width,canvas.height);
  return canvas;
}

function decodedCanvas(image,file,route,options) {
  const originalWidth=image.width||image.naturalWidth,originalHeight=image.height||image.naturalHeight;
  const canvas=fittedCanvas(image,options.maxSide??MAX_SIDE,options.maxPixels??MAX_PIXELS);
  canvas.imageDiagnostics={decoder:route,orientation:'browser-from-image',mimeType:file.type||'',fileBytes:file.size,
    originalWidth,originalHeight,decodedWidth:canvas.width,decodedHeight:canvas.height,
    scaleX:canvas.width/originalWidth,scaleY:canvas.height/originalHeight,
    resized:canvas.width!==originalWidth||canvas.height!==originalHeight,jpegReencoded:false,
    maxSide:options.maxSide??MAX_SIDE,maxPixels:options.maxPixels??MAX_PIXELS};
  return canvas;
}

/** Browser decoding applies EXIF orientation. Safari's Image fallback is needed
 * when createImageBitmap is unavailable or cannot decode a camera format. */
export async function imageFileToCanvas(file, options = {}) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
      try { return decodedCanvas(bitmap,file,'createImageBitmap',options); } finally { bitmap.close(); }
    } catch { /* Try the browser's image decoder before rejecting the file. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('A kép nem dekódolható. HEIC esetén exportáld JPEG vagy PNG formátumban.'));
      image.src=url;
    });
    return decodedCanvas(image,file,'HTMLImageElement',options);
  } finally { URL.revokeObjectURL(url); }
}

function rotate(source, degrees) {
  if (Math.abs(degrees) < 0.025) return source;
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians)), sine = Math.abs(Math.sin(radians));
  const canvas = canvasOf(source.width * cosine + source.height * sine, source.width * sine + source.height * cosine);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians); context.drawImage(source, -source.width / 2, -source.height / 2);
  return fittedCanvas(canvas);
}

/** Integral-image local threshold normalizes gradual shadows without making
 * assumptions about a single page-wide exposure. One Uint32 integral is used. */
export function adaptiveThreshold(rgba, width, height, radius = 22, bias = 12) {
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      const alpha = rgba[p + 3] / 255;
      const value = Math.round((rgba[p] * .299 + rgba[p + 1] * .587 + rgba[p + 2] * .114) * alpha + 255 * (1 - alpha));
      gray[i] = value; sum += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const binary = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      const sum = integral[bottom * stride + right] - integral[top * stride + right] - integral[bottom * stride + left] + integral[top * stride + left];
      binary[y * width + x] = gray[y * width + x] < sum / ((right - left) * (bottom - top)) - bias ? 1 : 0;
    }
  }
  return binary;
}

function canvasBinary(canvas) {
  const data = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height);
  return adaptiveThreshold(data.data, canvas.width, canvas.height);
}

/** Estimate small in-plane skew by horizontal projection concentration.
 * Sparse samples keep the search independent of the full camera resolution. */
export function estimateSkew(binary, width, height, maxDegrees = 7) {
  const points = [];
  for (let y = 3; y < height - 3; y += 2) {
    for (let x = 3; x < width - 3; x += 2) {
      if (binary[y * width + x]) points.push([x - width / 2, y]);
    }
  }
  if (points.length < 150) return 0;
  function score(angle) {
    const tangent = Math.tan(angle * Math.PI / 180), padding = Math.ceil(width * .14);
    const projection = new Uint32Array(height + padding * 2);
    for (const [x, y] of points) projection[Math.round(y - tangent * x) + padding]++;
    let value = 0;
    for (const count of projection) value += count * count;
    return value;
  }
  let best = 0, bestScore = score(0);
  for (let angle = -maxDegrees; angle <= maxDegrees; angle += .5) {
    const value = score(angle);
    if (value > bestScore) { best = angle; bestScore = value; }
  }
  const coarse = best;
  for (let angle = coarse - .4; angle <= coarse + .4; angle += .1) {
    const value = score(angle);
    if (value > bestScore) { best = angle; bestScore = value; }
  }
  // Weak changes on an unruled/sparse page are insufficient evidence of skew.
  return bestScore > score(0) * 1.08 ? Math.round(best * 10) / 10 : 0;
}

function centers(indices, gap = 3) {
  const output = []; let group = [];
  for (const index of indices) {
    if (group.length && index - group[group.length - 1] > gap) { output.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length)); group = []; }
    group.push(index);
  }
  if (group.length) output.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length));
  return output;
}

/** Find long vertical dividers, then horizontal separators independently in
 * each column. A J cell without internal horizontal lines retains its full
 * height while neighboring location cells may have several row separators. */
function detectStraightCells(binary, width, height) {
  const candidates = [];
  const minRun = Math.max(35, Math.round(height * .12));
  for (let x = 0; x < width; x++) {
    let run = 0, longest = 0, missing = 0;
    for (let y = 0; y < height; y++) {
      const dark = binary[y * width + x] || (x > 0 && binary[y * width + x - 1]) || (x + 1 < width && binary[y * width + x + 1]);
      if (dark) { run++; missing = 0; }
      else if (++missing <= 2) run++;
      else { longest = Math.max(longest, run); run = 0; }
    }
    if (Math.max(longest, run) >= minRun) candidates.push(x);
  }
  const dividers = centers(candidates);
  if (dividers.length < 3 || dividers.length > 40) return [];
  const cells = [];
  for (let column = 0; column < dividers.length - 1; column++) {
    const x0 = dividers[column], x1 = dividers[column + 1], span = x1 - x0;
    if (span < 24) continue;
    const rows = [];
    for (let y = 0; y < height; y++) {
      let ink = 0;
      for (let x = x0 + 3; x <= x1 - 3; x++) {
        if (binary[y * width + x] || (y > 0 && binary[(y - 1) * width + x]) || (y + 1 < height && binary[(y + 1) * width + x])) ink++;
      }
      if (ink >= (span - 5) * .76) rows.push(y);
    }
    const separators = centers(rows);
    for (let i = 0; i < separators.length - 1; i++) {
      const y0 = separators[i], y1 = separators[i + 1];
      if (y1 - y0 >= 18) cells.push({x0, y0, x1, y1});
    }
  }
  return cells.length >= 2 ? cells : [];
}

/** A small closing is used for geometry only. OCR keeps the original pixels. */
function closeRuleGaps(binary,width,height) {
  const dilated=new Uint8Array(binary.length),closed=new Uint8Array(binary.length);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x;
    if(binary[p]||binary[p-1]||binary[p+1]||binary[p-width]||binary[p-width-1]||binary[p-width+1]||binary[p+width]||binary[p+width-1]||binary[p+width+1])dilated[p]=1;
  }
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x;
    if(dilated[p]&&dilated[p-1]&&dilated[p+1]&&dilated[p-width]&&dilated[p-width-1]&&dilated[p-width+1]&&dilated[p+width]&&dilated[p+width-1]&&dilated[p+width+1])closed[p]=1;
  }
  return closed;
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};

/** Enclosed white interiors follow curved/sloped printed borders naturally.
 * They seed column tracks; text holes and the outside page are rejected. */
function interiorSeeds(binary,width,height) {
  const closed=closeRuleGaps(binary,width,height),seen=new Uint8Array(binary.length),queue=new Uint32Array(binary.length),seeds=[];
  for(let start=0;start<closed.length;start++){
    if(closed[start]||seen[start])continue;
    let head=0,tail=1,minX=width,maxX=0,minY=height,maxY=0;
    queue[0]=start;seen[start]=1;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/width),x=p-y*width;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(x>0&&!closed[p-1]&&!seen[p-1]){seen[p-1]=1;queue[tail++]=p-1;}
      if(x+1<width&&!closed[p+1]&&!seen[p+1]){seen[p+1]=1;queue[tail++]=p+1;}
      if(y>0&&!closed[p-width]&&!seen[p-width]){seen[p-width]=1;queue[tail++]=p-width;}
      if(y+1<height&&!closed[p+width]&&!seen[p+width]){seen[p+width]=1;queue[tail++]=p+width;}
    }
    const w=maxX-minX+1,h=maxY-minY+1;
    if(minX===0||minY===0||maxX===width-1||maxY===height-1||w<28||h<10||tail<350||tail>width*height*.3||tail/(w*h)<.63)continue;
    seeds.push({x0:minX-1,y0:minY-1,x1:maxX+1,y1:maxY+1,left:minX-1,right:maxX+1,cy:(minY+maxY)/2});
  }
  return seeds;
}
function trackPosition(track,y){
  const points=track.points;
  let a=points[0],b=points[1]||a;
  for(let i=1;i<points.length;i++){if(points[i].cy>=y){a=points[i-1];b=points[i];break;}a=points[Math.max(0,i-1)];b=points[i];}
  const distance=b.cy-a.cy,t=distance?Math.max(-2,Math.min(3,(y-a.cy)/distance)):0;
  const interpolate=field=>a[field]+Math.max(-.3,Math.min(.3,distance?(b[field]-a[field])/distance:0))*(distance*t);
  return {left:interpolate('left'),right:interpolate('right')};
}
function seedTracks(seeds){
  const tracks=[];
  for(const seed of [...seeds].sort((a,b)=>a.cy-b.cy||a.left-b.left)){
    const center=(seed.left+seed.right)/2,w=seed.right-seed.left;
    const choices=tracks.map(track=>{const p=trackPosition(track,seed.cy),tw=p.right-p.left;return{track,d:Math.abs((p.left+p.right)/2-center),tw};})
      .filter(item=>item.tw>0&&w/item.tw>.55&&w/item.tw<1.8&&item.d<Math.max(12,Math.min(w,item.tw)*.47)).sort((a,b)=>a.d-b.d);
    const track=choices[0]?.track||{points:[]};if(!choices.length)tracks.push(track);track.points.push(seed);
  }
  tracks.forEach(track=>track.points.sort((a,b)=>a.cy-b.cy));
  return tracks.filter(track=>track.points.length>=2).sort((a,b)=>median(a.points.map(p=>p.left))-median(b.points.map(p=>p.left)));
}
function nearRule(binary,width,height,x,y,radius){
  let best=-1,bestScore=-Infinity;
  for(let xx=Math.max(1,Math.round(x-radius));xx<=Math.min(width-2,Math.round(x+radius));xx++){
    if(!binary[y*width+xx])continue;
    let support=0;for(let dy=-3;dy<=3;dy++){const yy=y+dy;if(yy>=0&&yy<height&&(binary[yy*width+xx]||binary[yy*width+xx-1]||binary[yy*width+xx+1]))support++;}
    const score=support*2-Math.abs(xx-x)*.45;
    if(support>=4&&score>bestScore){bestScore=score;best=xx;}
  }
  return best;
}
/** Follow one printed horizontal rule, rather than require identical y at every x. */
function traceRule(binary,width,height,centerX,centerY,left,right){
  const follow=direction=>{
    let y=centerY,gaps=0,covered=0,lastX=centerX;
    const end=direction<0?left+2:right-2;
    for(let x=centerX+direction*2;direction<0?x>=end:x<=end;x+=direction*2){
      let chosen=-1;
      for(const dy of [0,-1,1,-2,2]){const yy=y+dy;if(yy>0&&yy<height-1&&(binary[yy*width+Math.round(x)]||binary[yy*width+Math.round(x)+direction])){chosen=yy;break;}}
      if(chosen<0){if(++gaps>2)break;}else{y=chosen;gaps=0;covered++;lastX=x;}
      if(Math.abs(y-centerY)>(right-left)*.25)break;
    }
    return{y,x:lastX,covered};
  };
  const l=follow(-1),r=follow(1),span=right-left;
  if(l.x-left>Math.max(6,span*.08)||right-r.x>Math.max(6,span*.08))return null;
  return{y:centerY,leftY:l.y,rightY:r.y,quality:(l.covered+r.covered)*2/span};
}
function tracedTrackCells(track,binary,width,height){
  const traceSide=side=>{
    const values=new Float32Array(height),found=new Uint8Array(height),anchor=Math.round(track.points[0].cy);
    const seed=trackPosition(track,anchor)[side];
    for(const direction of [-1,1]){
      let previous=seed,lastSeen=anchor;
      for(let y=anchor;y>0&&y<height-1;y+=direction){
        const predicted=trackPosition(track,y),span=predicted.right-predicted.left;
        const continued=Math.abs(y-lastSeen)<=5,outside=y<track.points[0].cy||y>track.points[track.points.length-1].cy;
        const center=continued&&outside?previous:predicted[side];
        const position=nearRule(binary,width,height,center,y,continued&&outside?4:Math.max(6,Math.min(12,span*.12)));
        if(position>=0){values[y]=position;found[y]=1;previous=position;lastSeen=y;}
        else values[y]=predicted[side];
      }
    }
    return{values,found};
  };
  const leftTrace=traceSide('left'),rightTrace=traceSide('right'),leftAt=leftTrace.values,rightAt=rightTrace.values,present=new Uint8Array(height),rules=[];
  for(let y=1;y<height-1;y++){
    if(leftTrace.found[y]&&rightTrace.found[y]&&rightAt[y]-leftAt[y]>=24)present[y]=1;
    const center=Math.round((leftAt[y]+rightAt[y])/2);
    if(center>0&&center<width-1&&binary[y*width+center]){const rule=traceRule(binary,width,height,center,y,leftAt[y],rightAt[y]);if(rule&&rule.quality>.7)rules.push(rule);}
  }
  const grouped=[];
  for(const rule of rules){const prev=grouped[grouped.length-1];if(prev&&rule.y-prev.y<=3){if(rule.quality>prev.quality)grouped[grouped.length-1]=rule;}else grouped.push(rule);}
  // Each open end must be supported by both vertical printed borders. A blank
  // gutter cannot create a cell merely by inheriting a previous text row.
  const runs=[];let start=-1,last=-1,gap=0;
  for(let y=1;y<height;y++){
    if(present[y]){if(start<0)start=y;last=y;gap=0;}
    else if(start>=0&&++gap>4){if(last-start>=12)runs.push([start,last]);start=-1;}
  }
  if(start>=0&&last-start>=12)runs.push([start,last]);
  const cells=[];
  for(const [start,end]of runs){
    const bounds=grouped.filter(rule=>rule.y>=start-4&&rule.y<=end+4).map(rule=>({...rule}));
    if(!bounds.length)continue;
    const edgeEnd=(trace,from,direction)=>{let last=from,gap=0;for(let y=from;y>0&&y<height-1;y+=direction){if(trace.found[y]){last=y;gap=0;}else if(++gap>4)break;}return last;};
    if(bounds[0].y-start>6)bounds.unshift({y:start,leftY:edgeEnd(leftTrace,start,-1),rightY:edgeEnd(rightTrace,start,-1),open:true});
    if(end-bounds[bounds.length-1].y>6)bounds.push({y:end,leftY:edgeEnd(leftTrace,end,1),rightY:edgeEnd(rightTrace,end,1),open:true});
    for(let i=0;i+1<bounds.length;i++){
      const top=bounds[i],bottom=bounds[i+1];if(bottom.y-top.y<10)continue;
      let support=0;for(let y=Math.max(1,top.y);y<=Math.min(height-1,bottom.y);y++)support+=present[y];
      if(support/(bottom.y-top.y+1)<.7)continue;
      const at=(values,y)=>values[Math.max(1,Math.min(height-2,Math.round(y)))];
      const polygon=[{x:at(leftAt,top.leftY),y:top.leftY},{x:at(rightAt,top.rightY),y:top.rightY},{x:at(rightAt,bottom.rightY),y:bottom.rightY},{x:at(leftAt,bottom.leftY),y:bottom.leftY}];
      const x0=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p.x)))),x1=Math.min(width,Math.ceil(Math.max(...polygon.map(p=>p.x)))),y0=Math.max(0,Math.min(top.leftY,top.rightY)),y1=Math.min(height,Math.max(bottom.leftY,bottom.rightY));
      if(x1-x0<24||y1-y0<10)continue;
      cells.push({x0,y0,x1,y1,polygon,topRule:top,bottomRule:bottom,openTop:Boolean(top.open),openBottom:Boolean(bottom.open),ruleSupport:support/(bottom.y-top.y+1)});
    }
  }
  return cells;
}
/** Local connected rule geometry survives independent table lanes and folds.
 * Logical bounds refer to each lane's shared divider; crop bounds remain actual. */
export function detectCurvedCells(binary,width,height){
  const tracks=seedTracks(interiorSeeds(binary,width,height));if(tracks.length<2)return[];
  const adjacent=(a,b)=>{
    const ys=a.points.flatMap(p=>b.points.filter(q=>Math.min(p.y1,q.y1)>Math.max(p.y0,q.y0)).map(q=>(Math.max(p.y0,q.y0)+Math.min(p.y1,q.y1))/2));
    if(!ys.length)return false;
    const distances=ys.map(y=>{const pa=trackPosition(a,y),pb=trackPosition(b,y);return Math.abs(pa.right-pb.left);});
    return median(distances)<=10;
  };
  const lanes=[];let current=[];
  for(const track of tracks){if(current.length&&!adjacent(current[current.length-1],track)){if(current.length>=2)lanes.push(current);current=[];}current.push(track);}
  if(current.length>=2)lanes.push(current);
  const result=[];
  lanes.forEach((lane,laneId)=>lane.forEach((track,column)=>{
    const cells=tracedTrackCells(track,binary,width,height);
    for(const cell of cells){
      // In two-column J/location lanes both logical y coordinates are measured
      // at the shared middle border, including when horizontal lines slope.
      const side=column%2===0?'rightY':'leftY';
      result.push({...cell,laneId,column,pairingBounds:{x0:laneId*1000+column*100,x1:laneId*1000+(column+1)*100,y0:cell.topRule[side],y1:cell.bottomRule[side]}});
    }
  }));
  return result;
}

export function detectCells(binary,width,height){
  const straight=detectStraightCells(binary,width,height);
  // Keep exact simple vector/PDF grids cheap. Tall page/gutter rectangles are
  // evidence that fixed-x tracing has confused separate physical tables.
  if(straight.length&&straight.every(cell=>cell.y1-cell.y0<=height*.6&&cell.x1-cell.x0<=width*.85))return straight;
  return detectCurvedCells(binary,width,height);
}

export function assignWordsToCells(words, cells) {
  const groups = cells.map(cell => ({...cell, words: []})), orphans = [];
  for (const word of words) {
    const box = word.bbox || word;
    const x = (box.x0 + box.x1) / 2, y = (box.y0 + box.y1) / 2;
    const matches = groups.filter(cell => x > cell.x0 && x < cell.x1 && y > cell.y0 && y < cell.y1);
    if (matches.length === 1) matches[0].words.push(word);
    else orphans.push({...box, text: word.text, confidence: word.confidence, unbounded: true, grid: false});
  }
  const output = groups.filter(cell => cell.words.length).map(cell => {
    // OCR already has a reading order. Sort spatially only when words are on
    // different baselines, preserving same-line left-to-right fragments.
    cell.words.sort((a, b) => {
      const aa = a.bbox || a, bb = b.bbox || b;
      return Math.abs(aa.y0 - bb.y0) > Math.max(aa.y1 - aa.y0, bb.y1 - bb.y0) * .6 ? aa.y0 - bb.y0 : aa.x0 - bb.x0;
    });
    const confidence = Math.min(...cell.words.map(word => word.confidence ?? 0));
    const {words: groupedWords, ...geometry} = cell;
    return {...geometry, text: groupedWords.map(word => word.text).join(' '), confidence, bounded: true, grid: true};
  });
  return output.concat(orphans);
}

/** Contrast-stretched grayscale is an independent OCR view, not a binary copy. */
export function contrastGrayscale(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height), histogram = new Uint32Array(256);
  for (let i=0; i<gray.length; i++) {
    const p=i*4, alpha=rgba[p+3]/255;
    gray[i]=Math.round((rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114)*alpha+255*(1-alpha));
    histogram[gray[i]]++;
  }
  let count=0,low=0,high=255;
  for (let i=0;i<256;i++) { count+=histogram[i]; if (count>=gray.length*.01) {low=i;break;} }
  count=0;
  for (let i=255;i>=0;i--) {count+=histogram[i];if(count>=gray.length*.01){high=i;break;}}
  if(high-low<32){low=0;high=255;}
  const output=new Uint8ClampedArray(rgba.length), span=high-low;
  for (let i=0;i<gray.length;i++) {
    const value=Math.max(0,Math.min(255,Math.round((gray[i]-low)*255/span)));
    output[i*4]=output[i*4+1]=output[i*4+2]=value;output[i*4+3]=255;
  }
  return output;
}

/** Clockwise TL/TR/BR/BL normalized corners; reject crossed or tiny quadrilaterals. */
export function validatePerspectiveCorners(corners) {
  if (!Array.isArray(corners)||corners.length!==4||corners.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)) throw new Error('A perspektívakorrekcióhoz négy, a képen belüli sarok szükséges.');
  const result=corners.map(p=>({x:p.x,y:p.y}));
  let area=0;
  for (let i=0;i<4;i++) {
    const a=result[i],b=result[(i+1)%4],c=result[(i+2)%4];
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if (cross<=.0001) throw new Error('A sarkok sorrendje: bal felső, jobb felső, jobb alsó, bal alsó. A négyszög nem keresztezheti önmagát.');
    area+=a.x*b.y-b.x*a.y;
  }
  if (area/2<.025) throw new Error('Túl kicsi a kijelölt dokumentum.');
  return result;
}

/** Solve a projective mapping from a unit output rectangle to the input quad. */
export function perspectiveHomography(corners) {
  const points=validatePerspectiveCorners(corners), uv=[[0,0],[1,0],[1,1],[0,1]], matrix=[];
  for (let i=0;i<4;i++) {
    const [u,v]=uv[i],{x,y}=points[i];
    matrix.push([u,v,1,0,0,0,-u*x,-v*x,x]);
    matrix.push([0,0,0,u,v,1,-u*y,-v*y,y]);
  }
  for (let col=0;col<8;col++) {
    let pivot=col;
    for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
    if(Math.abs(matrix[pivot][col])<1e-10)throw new Error('Nem számítható a perspektívakorrekció.');
    [matrix[pivot],matrix[col]]=[matrix[col],matrix[pivot]];
    const scale=matrix[col][col];for(let n=col;n<9;n++)matrix[col][n]/=scale;
    for(let row=0;row<8;row++)if(row!==col){const f=matrix[row][col];for(let n=col;n<9;n++)matrix[row][n]-=f*matrix[col][n];}
  }
  return matrix.map(row=>row[8]);
}

/** Inverse mapping with bilinear interpolation: pixels are genuinely rectified. */
export function warpPerspectivePixels(rgba,width,height,corners,maxSide=MAX_SIDE,maxPixels=MAX_PIXELS) {
  const points=validatePerspectiveCorners(corners), distance=(a,b)=>Math.hypot((a.x-b.x)*(width-1),(a.y-b.y)*(height-1));
  let outputWidth=Math.max(2,Math.round((distance(points[0],points[1])+distance(points[3],points[2]))/2));
  let outputHeight=Math.max(2,Math.round((distance(points[0],points[3])+distance(points[1],points[2]))/2));
  const scale=Math.min(1,maxSide/Math.max(outputWidth,outputHeight),Math.sqrt(maxPixels/(outputWidth*outputHeight)));
  outputWidth=Math.max(2,Math.round(outputWidth*scale));outputHeight=Math.max(2,Math.round(outputHeight*scale));
  if(outputWidth*outputHeight>maxPixels){if(outputWidth>=outputHeight)outputWidth=Math.max(2,Math.floor(maxPixels/outputHeight));else outputHeight=Math.max(2,Math.floor(maxPixels/outputWidth));}
  const h=perspectiveHomography(points),output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  for(let y=0;y<outputHeight;y++)for(let x=0;x<outputWidth;x++){
    const u=x/(outputWidth-1),v=y/(outputHeight-1),den=h[6]*u+h[7]*v+1;
    const sx=Math.max(0,Math.min(width-1,(h[0]*u+h[1]*v+h[2])/den*(width-1)));
    const sy=Math.max(0,Math.min(height-1,(h[3]*u+h[4]*v+h[5])/den*(height-1)));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=sx-x0,dy=sy-y0,p=(y*outputWidth+x)*4;
    for(let channel=0;channel<3;channel++)output[p+channel]=rgba[(y0*width+x0)*4+channel]*(1-dx)*(1-dy)+rgba[(y0*width+x1)*4+channel]*dx*(1-dy)+rgba[(y1*width+x0)*4+channel]*(1-dx)*dy+rgba[(y1*width+x1)*4+channel]*dx*dy;
    output[p+3]=255;
  }
  return {data:output,width:outputWidth,height:outputHeight};
}

function perspectiveCanvas(source,corners) {
  const context=source.getContext('2d',{willReadFrequently:true});
  const pixels=context.getImageData(0,0,source.width,source.height);
  const warped=warpPerspectivePixels(pixels.data,source.width,source.height,corners);
  const output=canvasOf(warped.width,warped.height),outContext=output.getContext('2d',{willReadFrequently:true});
  const image=outContext.createImageData(warped.width,warped.height);image.data.set(warped.data);outContext.putImageData(image,0,0);
  return output;
}

/** Conservative line-based quad detector. It requires four strongly supported
 * ruled edges; no page boundary or missing corner is fabricated from text. */
export function detectPerspectiveQuad(binary,width,height) {
  const points=[];
  for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2)if(binary[y*width+x])points.push([x,y]);
  if(points.length<150)return null;
  function lines(vertical) {
    const extent=vertical?width:height,along=vertical?height:width,pad=Math.ceil(along*.4), candidates=[];
    for(let degree=-18;degree<=18;degree+=1){
      const slope=Math.tan(degree*Math.PI/180),hist=new Uint32Array(extent+pad*2);
      for(const [x,y]of points){const b=Math.round((vertical?x:y)-slope*(vertical?y:x))+pad;if(b>=0&&b<hist.length)hist[b]++;}
      for(let b=2;b<hist.length-2;b++)if(hist[b]>=Math.max(15,along*.12)&&hist[b]>=hist[b-1]&&hist[b]>=hist[b+1]){
        const intercept=b-pad,center=intercept+slope*along/2;
        if(center>extent*.01&&center<extent*.99)candidates.push({slope,intercept,center,score:hist[b]});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    const distinct=[];
    for(const candidate of candidates)if(!distinct.some(line=>Math.abs(line.center-candidate.center)<6)){distinct.push(candidate);if(distinct.length===10)break;}
    return distinct.sort((a,b)=>a.center-b.center);
  }
  const horizontal=lines(false),vertical=lines(true);
  if(horizontal.length<2||vertical.length<2)return null;
  const intersect=(h,v)=>{const x=(v.intercept+v.slope*h.intercept)/(1-v.slope*h.slope);return{x,y:h.intercept+h.slope*x};};
  function support(a,b){let ink=0;const samples=120;for(let i=0;i<=samples;i++){const x=Math.round(a.x+(b.x-a.x)*i/samples),y=Math.round(a.y+(b.y-a.y)*i/samples);let found=false;for(let yy=Math.max(0,y-2);yy<=Math.min(height-1,y+2)&&!found;yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(width-1,x+2);xx++)if(binary[yy*width+xx]){found=true;break;}if(found)ink++;}return ink/(samples+1);}
  let best=null;
  for(let top=0;top<horizontal.length-1;top++)for(let bottom=top+1;bottom<horizontal.length;bottom++){
    if(horizontal[bottom].center-horizontal[top].center<height*.4)continue;
    for(let left=0;left<vertical.length-1;left++)for(let right=left+1;right<vertical.length;right++){
      if(vertical[right].center-vertical[left].center<width*.4)continue;
      const quad=[intersect(horizontal[top],vertical[left]),intersect(horizontal[top],vertical[right]),intersect(horizontal[bottom],vertical[right]),intersect(horizontal[bottom],vertical[left])];
      if(quad.some(p=>p.x<0||p.x>width-1||p.y<0||p.y>height-1))continue;
      const normalized=quad.map(p=>({x:p.x/(width-1),y:p.y/(height-1)}));
      try{validatePerspectiveCorners(normalized);}catch{continue;}
      let area=0;for(let i=0;i<4;i++)area+=quad[i].x*quad[(i+1)%4].y-quad[(i+1)%4].x*quad[i].y;area/=2;
      if(area<width*height*.25)continue;
      const quality=Math.min(...quad.map((p,i)=>support(p,quad[(i+1)%4])));
      if(quality<.86)continue;
      const score=area*quality;
      if(!best||score>best.score)best={corners:normalized,score,quality};
    }
  }
  return best;
}

/** Keep crop polygons in OCR pixels and topology x identifiers in their own
 * lane coordinate system. Only logical y positions represent physical pixels. */
export function scaleCellGeometry(cells,scaleX,scaleY) {
  return cells.map(cell=>{
    const result={...cell,x0:cell.x0*scaleX,x1:cell.x1*scaleX,y0:cell.y0*scaleY,y1:cell.y1*scaleY};
    if(cell.polygon)result.polygon=cell.polygon.map(p=>({x:p.x*scaleX,y:p.y*scaleY}));
    if(cell.pairingBounds)result.pairingBounds={...cell.pairingBounds,y0:cell.pairingBounds.y0*scaleY,y1:cell.pairingBounds.y1*scaleY};
    for(const key of ['topRule','bottomRule'])if(cell[key])result[key]={...cell[key],y:cell[key].y*scaleY,leftY:cell[key].leftY*scaleY,rightY:cell[key].rightY*scaleY};
    return result;
  });
}

export async function prepareDocument(source, {rotation = 0, deskew = true, corners = null, perspective = true} = {}) {
  let canvas=fittedCanvas(source),perspectiveInfo={applied:false,mode:'none',corners:null};
  if(corners){
    const validated=validatePerspectiveCorners(corners),previous=canvas;canvas=perspectiveCanvas(canvas,validated);previous.width=previous.height=1;
    perspectiveInfo={applied:true,mode:'manual',corners:validated};
  }else if(perspective&&deskew){
    const sample=fittedCanvas(canvas,720),quad=detectPerspectiveQuad(canvasBinary(sample),sample.width,sample.height);sample.width=sample.height=1;
    if(quad){
      const q=quad.corners,dx=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),top=dx(q[0],q[1]),bottom=dx(q[3],q[2]),left=dx(q[0],q[3]),right=dx(q[1],q[2]);
      // Pure rotation is handled by deskew; avoid resampling an already flat grid.
      if(Math.max(top/bottom,bottom/top,left/right,right/left)>1.045){const previous=canvas;canvas=perspectiveCanvas(canvas,q);previous.width=previous.height=1;perspectiveInfo={applied:true,mode:'auto',corners:q,edgeSupport:quad.quality};}
    }
  }
  if(rotation){const previous=canvas;canvas=rotate(canvas,rotation);if(previous!==canvas)previous.width=previous.height=1;}
  let angle=0;
  if(deskew){const sample=fittedCanvas(canvas,720);angle=estimateSkew(canvasBinary(sample),sample.width,sample.height);sample.width=sample.height=1;}
  if(angle){const previous=canvas;canvas=rotate(canvas,-angle);if(previous!==canvas)previous.width=previous.height=1;}
  const dimensions={width:canvas.width,height:canvas.height};
  const highResolution=Math.max(canvas.width,canvas.height)>GEOMETRY_SIDE;
  if(highResolution){
    // Detect topology on a smaller page, but crop each OCR cell from the
    // retained source pixels. Local cell OCR performs grayscale normalization.
    const geometry=fittedCanvas(canvas,GEOMETRY_SIDE),geometryWidth=geometry.width,geometryHeight=geometry.height;
    const cells=scaleCellGeometry(detectCells(canvasBinary(geometry),geometryWidth,geometryHeight),canvas.width/geometryWidth,canvas.height/geometryHeight);
    geometry.width=geometry.height=1;
    return {canvas,grayCanvas:canvas,cells,angle,perspective:perspectiveInfo,
      diagnostics:{input:source.imageDiagnostics||{originalWidth:source.width,originalHeight:source.height},prepared:dimensions,
        geometry:{width:geometryWidth,height:geometryHeight,scaleToOcrX:canvas.width/geometryWidth,scaleToOcrY:canvas.height/geometryHeight},
        ocr:{...dimensions,view:'source-with-cell-local-normalization'},cellCount:cells.length,laneCount:new Set(cells.filter(c=>c.laneId!=null).map(c=>c.laneId)).size,
        angle,perspective:perspectiveInfo,jpegReencoded:false},
      warnings:cells.length?[]:['Nem található megbízható cellaháló. A szöveg alapján javasolt párosításokat különösen ellenőrizd.']};
  }
  const context=canvas.getContext('2d',{willReadFrequently:true}),pixels=context.getImageData(0,0,canvas.width,canvas.height);
  const grayCanvas=canvasOf(canvas.width,canvas.height),grayContext=grayCanvas.getContext('2d',{willReadFrequently:true}),grayImage=grayContext.createImageData(canvas.width,canvas.height);
  grayImage.data.set(contrastGrayscale(pixels.data,canvas.width,canvas.height));grayContext.putImageData(grayImage,0,0);
  const binary=adaptiveThreshold(pixels.data,canvas.width,canvas.height),cells=detectCells(binary,canvas.width,canvas.height),data=context.createImageData(canvas.width,canvas.height);
  for(let i=0;i<binary.length;i++){data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=binary[i]?0:255;data.data[i*4+3]=255;}
  context.putImageData(data,0,0);
  return {canvas,grayCanvas,cells,angle,perspective:perspectiveInfo,diagnostics:{input:source.imageDiagnostics||{originalWidth:source.width,originalHeight:source.height},prepared:dimensions,geometry:{...dimensions,scaleToOcrX:1,scaleToOcrY:1},ocr:{...dimensions,view:'contrast-grayscale'},cellCount:cells.length,laneCount:new Set(cells.filter(c=>c.laneId!=null).map(c=>c.laneId)).size,angle,perspective:perspectiveInfo,jpegReencoded:false},warnings:cells.length?[]:['Nem található megbízható cellaháló. A szöveg alapján javasolt párosításokat különösen ellenőrizd.']};
}
