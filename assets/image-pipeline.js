/**
 * Local, bounded-memory preprocessing for photographed printed tables.
 * This is a ruled-table detector, not a learned document model: missing borders,
 * severe perspective, folds and occluded text still require human review.
 */
const MAX_SIDE = 2600;

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function fittedCanvas(source, maxSide = MAX_SIDE) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = canvasOf(width * scale, height * scale);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Browser decoding applies EXIF orientation. Safari's Image fallback is needed
 * when createImageBitmap is unavailable or cannot decode a camera format. */
export async function imageFileToCanvas(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
      try { return fittedCanvas(bitmap); } finally { bitmap.close(); }
    } catch { /* Try the browser's image decoder before rejecting the file. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('A kép nem dekódolható. HEIC esetén exportáld JPEG vagy PNG formátumban.'));
    });
    return fittedCanvas(image);
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
export function detectCells(binary, width, height) {
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
    return {x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: cell.y1, text: cell.words.map(word => word.text).join(' '), confidence, bounded: true, grid: true};
  });
  return output.concat(orphans);
}

export async function prepareDocument(source, {rotation = 0, deskew = true} = {}) {
  let canvas = fittedCanvas(source);
  if (rotation) canvas = rotate(canvas, rotation);
  let angle = 0;
  if (deskew) {
    const sample = fittedCanvas(canvas, 720);
    angle = estimateSkew(canvasBinary(sample), sample.width, sample.height);
    sample.width = sample.height = 1;
  }
  if (angle) canvas = rotate(canvas, -angle);
  const binary = canvasBinary(canvas);
  const cells = detectCells(binary, canvas.width, canvas.height);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const data = context.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < binary.length; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = binary[i] ? 0 : 255;
    data.data[i * 4 + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  return {canvas, cells, angle, warnings: cells.length ? [] : ['Nem található megbízható cellaháló. A szöveg alapján javasolt párosításokat különösen ellenőrizd.']};
}
