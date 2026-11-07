import {normalizeKey, extractPlaces} from './table-core.js';

const pairId = ({key, loc}) => `${key}\u0000${loc}`;
const sorted = values => [...values].sort((a, b) => a.key.localeCompare(b.key) || a.loc.localeCompare(b.loc));
const singlePlace = value => typeof value === 'string' && /^AM-OC-\d{1,4}$/.test(value);

/** Reference data is entered from the source image, never repaired from OCR. */
export function validateReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.documentId !== 'string' || !value.documentId.trim() ||
      !['real', 'synthetic'].includes(value.kind) || !Array.isArray(value.reference) ||
      !value.reference.length || value.reference.length > 100000) {
    throw new Error('A reference needs documentId, kind (real/synthetic) and a nonempty reference array.');
  }
  const seen = new Set();
  for (const pair of value.reference) {
    if (!pair || normalizeKey(pair.key) !== pair.key || !singlePlace(pair.loc)) {
      throw new Error('Every reference item must contain a canonical J key and exactly one AM-OC location.');
    }
    const id = pairId(pair);
    if (seen.has(id)) throw new Error(`Duplicate reference pair: ${pair.key} / ${pair.loc}`);
    seen.add(id);
  }
  if (value.sources !== undefined && (!Array.isArray(value.sources) || !value.sources.length ||
    value.sources.some(source => !source || typeof source.name !== 'string' || !source.name ||
      typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)))) {
    throw new Error('Optional sources must contain name and lowercase SHA-256 for every input.');
  }
  const rotation = value.importOptions?.rotation;
  if (rotation !== undefined && ![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported reference importOptions.rotation.');
  return value;
}

function predictedPairs(records) {
  if (!Array.isArray(records)) throw new Error('Predictions must be an array.');
  const pairs = new Map();
  let invalidCandidates = 0, duplicatePairs = 0;
  for (const row of records) {
    const key = normalizeKey(row?.key), places = extractPlaces(row?.loc);
    if (!key || !places.length) { invalidCandidates++; continue; }
    for (const loc of places) {
      const pair = {key, loc}, id = pairId(pair);
      if (pairs.has(id)) duplicatePairs++;
      pairs.set(id, pair);
    }
  }
  return {pairs, invalidCandidates, duplicatePairs};
}

/** Exact pair matching counts a wrong J assignment as one extra and one missing
 * pair. No nearest-code or location-only matches, and no duplicate inflation. */
export function evaluatePairs(reference, records, {threshold = .95} = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Threshold must be in (0, 1].');
  validateReference({documentId:'metric-input',kind:'synthetic',reference});
  const expected = new Map(reference.map(pair => [pairId(pair), {key:pair.key,loc:pair.loc}]));
  const {pairs, invalidCandidates, duplicatePairs} = predictedPairs(records);
  const correct = sorted([...pairs].filter(([id]) => expected.has(id)).map(([,pair]) => pair));
  const wrong = sorted([...pairs].filter(([id]) => !expected.has(id)).map(([,pair]) => pair));
  const missing = sorted([...expected].filter(([id]) => !pairs.has(id)).map(([,pair]) => pair));
  const truePositive = correct.length, falsePositive = wrong.length, falseNegative = missing.length;
  // No prediction is an abstention, not perfect precision. Null cannot satisfy
  // an accuracy gate and recall still reports the missed reference pairs.
  const precision = pairs.size ? truePositive / pairs.size : null;
  const recall = truePositive / expected.size;
  const f1 = precision === null || !precision || !recall ? 0 : 2 * precision * recall / (precision + recall);
  const correctPairingRate = truePositive / (truePositive + falsePositive + falseNegative);
  return {
    referencePairs:expected.size, predictedPairs:pairs.size, truePositive, falsePositive, falseNegative,
    precision, recall, f1, correctPairingRate, invalidCandidates, duplicatePairs,
    threshold, meetsTarget:precision !== null && precision >= threshold && recall >= threshold && correctPairingRate >= threshold,
    correct, missing, wrong,
  };
}

export function compareMethods(reference, diagnostics, options) {
  const methods = new Map();
  for (const entry of diagnostics || []) {
    if (!entry || typeof entry.method !== 'string' || !Array.isArray(entry.records)) continue;
    methods.set(entry.method, [...(methods.get(entry.method) || []), ...entry.records]);
  }
  return Object.fromEntries([...methods].sort(([a],[b]) => a.localeCompare(b)).map(([method, records]) => [method,evaluatePairs(reference,records,options)]));
}

/** A generated or unreviewed reference can never establish the real-document
 * target. Even a checked real corpus only supports a claim about that corpus. */
export function assessRealTarget(reference, metrics, {sourceHashesVerified = false} = {}) {
  validateReference(reference);
  const checked = reference.review?.status === 'checked' && reference.review?.method === 'two-pass-manual';
  const eligible = reference.kind === 'real' && checked && sourceHashesVerified;
  return {
    established:eligible && metrics.meetsTarget,
    scope:'Only the supplied, manually checked input corpus; not general OCR accuracy.',
    blockers:[
      ...(reference.kind !== 'real' ? ['The inputs are synthetic, not real document photographs.'] : []),
      ...(!checked ? ['A completed two-pass manual reference review is not recorded.'] : []),
      ...(!sourceHashesVerified ? ['Reference source SHA-256 hashes are missing or do not match every input.'] : []),
      ...(!metrics.meetsTarget ? ['The precision, recall and exact pairing rate do not all meet the threshold.'] : []),
    ],
  };
}
