// Pure document pairing. No browser APIs: this module is also exercised by node:test.
const clean = value => String(value ?? '').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
const unique = values => [...new Set(values)];

/** A key must fill the whole cell/query. Never silently repair OCR digits. */
export function normalizeKey(value) {
  const match = clean(value).match(/^(?:J\s*-?\s*)?(\d{1,4})$/i);
  return match && Number(match[1]) > 0 ? `J${String(Number(match[1])).padStart(3, '0')}` : '';
}

export function extractPlaces(value) {
  const text = clean(value);
  // Boundaries exclude prefixes like XAM-OC and partial matches such as AM-OC-12A.
  return unique([...text.matchAll(/(?:^|[^A-Z0-9])AM\s*-?\s*OC\s*-?\s*(\d{1,4})(?![A-Z0-9])/gi)]
    .map(match => `AM-OC-${match[1]}`));
}

function record(key, places, options = {}, reasons = []) {
  return {key, loc: unique(places).join(', '), source: options.source || '',
    uncertain: Boolean(options.ocr || reasons.length),
    reasons: unique([...(options.ocr ? ['OCR: ellenőrizd az eredeti dokumentumon.'] : []), ...reasons])};
}

/**
 * Merge repeated keys without replacing earlier locations. Invalid rows are excluded;
 * callers must validate/review them before using this as a replacement database.
 */
export function aggregate(records) {
  const groups = new Map();
  for (const row of records) {
    const key = normalizeKey(row.key);
    const locations = extractPlaces(row.loc);
    if (!key || !locations.length) continue;
    groups.set(key, unique([...(groups.get(key) || []), ...locations]));
  }
  return Object.fromEntries([...groups].map(([key, locations]) => [key, locations.join(', ')]));
}

/**
 * Spreadsheet/CSV pairing. Explicit merged cells are expanded only inside their
 * declared bounds. Blank rows and unmerged blanks never inherit a previous key.
 */
export function pairRows(rows, {merges = [], source = ''} = {}) {
  if (!Array.isArray(rows) || rows.length > 30000 || !Array.isArray(merges) || merges.length > 30000) {
    throw new Error('Túl nagy vagy hibás táblázat.');
  }
  const columnCount = Math.max(0, ...rows.map(row => Array.isArray(row) ? row.length : 0));
  if (columnCount > 200 || rows.length * columnCount > 1000000) throw new Error('Túl nagy táblázat.');
  const expanded = rows.map(row => Array.from(row || [], clean));
  for (const merge of merges) {
    if (!merge?.s || !merge?.e || ![merge.s.r, merge.s.c, merge.e.r, merge.e.c].every(Number.isInteger) ||
        merge.s.r < 0 || merge.s.c < 0 || merge.e.r >= 30000 || merge.e.c >= 200 ||
        merge.e.r < merge.s.r || merge.e.c < merge.s.c) throw new Error('Hibás vagy túl nagy összevont cella.');
    const origin = expanded[merge.s.r]?.[merge.s.c] || '';
    if (!normalizeKey(origin)) continue;
    for (let r = merge.s.r; r <= Math.min(merge.e.r, rows.length - 1); r++) {
      expanded[r] ||= [];
      for (let c = merge.s.c; c <= Math.min(merge.e.c, columnCount - 1); c++) {
        if (!expanded[r][c]) expanded[r][c] = origin;
      }
    }
  }
  // Once a J column is identified, unrelated numeric columns (quantities, page
  // numbers, etc.) must not become J keys merely because they contain digits.
  const keyColumns = new Set();
  expanded.forEach(row => row.forEach((text, col) => {
    if (/^J\s*-?\s*\d{1,4}$/i.test(text) || /^J(?:[\s_-]*(?:k[oó]d|code))?$/i.test(text)) keyColumns.add(col);
  }));
  const output = [];
  expanded.forEach((row, rowIndex) => {
    const keys = row.map((text, col) => ({key: normalizeKey(text), col}))
      .filter(cell => cell.key && (!keyColumns.size || keyColumns.has(cell.col)));
    row.forEach((text, col) => {
      const locations = extractPlaces(text);
      if (!locations.length) return;
      const left = keys.filter(cell => cell.col < col);
      const nearest = left.at(-1);
      // Never attach a location to a key on its right or in the preceding row.
      const reasons = nearest ? [] : ['Hiányzó J-cellához tartozó AM–OC hely; nincs automatikus továbbörökítés.'];
      if (nearest && !keyColumns.size) reasons.push('Számból becsült J-kód: nem azonosítható J-oszlop vagy fejléc.');
      output.push({...record(nearest?.key || '', locations, {source}, reasons), row: rowIndex + 1});
    });
  });
  return output;
}

/** Parse CSV/TSV with BOM, escaped quotes, embedded delimiters and newlines. */
export function parseCSV(value) {
  const text = String(value ?? '').replace(/^\uFEFF/, '');
  // Inspect the first nonblank record, retaining leading blank rows in the
  // parsed result so spreadsheet-style row numbers still describe the input.
  const sniff = text.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '');
  const candidates = [',', ';', '\t'];
  let quoted = false;
  const counts = [0, 0, 0];
  for (let i = 0; i < sniff.length; i++) {
    if (sniff[i] === '"') {
      if (quoted && sniff[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && /[\r\n]/.test(sniff[i])) break;
    else if (!quoted) {
      const n = candidates.indexOf(sniff[i]);
      if (n >= 0) counts[n]++;
    }
  }
  const delimiter = candidates[counts.indexOf(Math.max(...counts))];
  const rows = [];
  let row = [], cell = ''; quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell.length === 0) quoted = !quoted;
      else cell += ch;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cell += ch;
  }
  if (quoted) throw new Error('Lezáratlan idézőjel a CSV-fájlban.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Plain text has no trustworthy cell spans: retain this limitation in review. */
export function parseText(value, {source = ''} = {}) {
  const output = [];
  clean(value).split(/\r?\n/).forEach((line, index) => {
    const tokens = [...line.matchAll(/(?:^|[^A-Z0-9])J\s*-?\s*(\d{1,4})(?![A-Z0-9])/gi)];
    if (!tokens.length) {
      const places = extractPlaces(line);
      // Preserve the original plain numeric-key text import, but only at the
      // start of a line and always with a review warning about absent cells.
      const numeric = line.match(/^\s*(\d{1,4})(?=\s|[;\t])\s*/);
      if (places.length) output.push({...record(numeric ? normalizeKey(numeric[1]) : '', places, {source},
        [numeric ? 'Szöveges import: a cellahatárok nem állnak rendelkezésre.' : 'Szöveges sor J-kód nélkül.']), row: index + 1});
      return;
    }
    tokens.forEach((token, i) => {
      const start = token.index + token[0].length;
      const end = tokens[i + 1]?.index ?? line.length;
      const places = extractPlaces(line.slice(start, end));
      if (places.length) output.push({...record(normalizeKey(token[1]), places, {source},
        ['Szöveges import: a cellahatárok nem állnak rendelkezésre.']), row: index + 1});
    });
  });
  return output;
}

const validBox = cell => [cell.x0, cell.y0, cell.x1, cell.y1].every(Number.isFinite) &&
  cell.x1 > cell.x0 && cell.y1 > cell.y0;
const middle = cell => (cell.y0 + cell.y1) / 2;

/**
 * Pair actual cell rectangles, including rowspan cells. A location must be inside
 * its J-cell's vertical span and to its right in the same table lane. No nearest-y
 * fallback: without a containing cell the candidate is left unassigned for review.
 * Callers supplying word/PDF boxes should set ocr:true or inferred:true.
 */
export function pairCells(cells, options = {}) {
  const boxes = cells.filter(validBox).map(cell => ({...cell, text: clean(cell.text)}));
  const explicitKeyColumns = boxes.filter(cell => /^J\s*-?\s*\d{1,4}$/i.test(cell.text));
  const keys = boxes.map(cell => ({...cell, key: normalizeKey(cell.text)}))
    .filter(cell => cell.key && (!explicitKeyColumns.length || /^J/i.test(cell.text) ||
      explicitKeyColumns.some(key => Math.abs(key.x0 - cell.x0) < 2 && Math.abs(key.x1 - cell.x1) < 2)));
  const output = [];
  for (const cell of boxes) {
    const places = extractPlaces(cell.text);
    if (!places.length) continue;
    const cy = middle(cell);
    const matches = keys.filter(key => {
      // A 15% text-height tolerance handles minor OCR baseline/border errors, but
      // never extends a merged span into the next row based on its nearest text.
      const tolerance = Math.min(cell.y1 - cell.y0, key.y1 - key.y0) * 0.15;
      return key.x1 <= cell.x0 + 1 && cy >= key.y0 - tolerance && cy <= key.y1 + tolerance;
    });
    const nearestX = matches.length ? Math.max(...matches.map(key => key.x1)) : -Infinity;
    const candidates = matches.filter(key => Math.abs(key.x1 - nearestX) <= 1);
    // A location cell that spans two different J cells is not resolved by its
    // center point. Preserve it as ambiguous rather than choosing the middle J.
    const crossedKeys = keys.filter(key => Math.abs(key.x1 - nearestX) <= 1 &&
      Math.min(cell.y1, key.y1) - Math.max(cell.y0, key.y0) > Math.min(cell.y1 - cell.y0, key.y1 - key.y0) * .2);
    // A different J column between the source and location is a table boundary,
    // even if that column's current row has no vertically matching key.
    const blocked = candidates.some(key => keys.some(other =>
      other.x0 > key.x1 + 1 && other.x0 < cell.x0 && other.x1 <= cell.x0 + 1));
    const keyValues = unique(candidates.map(key => key.key));
    const ambiguous = keyValues.length !== 1 || blocked || unique(crossedKeys.map(key => key.key)).length > 1;
    const reasons = [
      ...(Array.isArray(cell.reasons) ? cell.reasons : []),
      ...candidates.flatMap(key => Array.isArray(key.reasons) ? key.reasons : []),
    ].filter(reason => typeof reason === 'string');
    if (ambiguous) reasons.push(candidates.length ? 'Többértelmű cellapárosítás vagy másik táblázatoszlop.' :
      'Nincs az AM–OC cellát lefedő J-cella.');
    if (!ambiguous && !explicitKeyColumns.length) reasons.push('Számból becsült J-kód: nincs J-jelölésű cella.');
    if (options.inferred) reasons.push('Becsült cellahatárok; ellenőrizd a párosítást.');
    if (cell.confidence !== undefined && cell.confidence < 85 || candidates.some(key => key.confidence !== undefined && key.confidence < 85)) {
      reasons.push('Alacsony OCR-biztonság.');
    }
    output.push({...record(ambiguous ? '' : keyValues[0], places, options, reasons),
      bbox: {x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: cell.y1}});
  }
  return output;
}
