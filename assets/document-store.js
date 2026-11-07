import {normalizeKey, extractPlaces, aggregate} from './table-core.js';

export const DOCUMENTS_KEY = 'amoc_documents_v1';
const LEGACY_ACTIVE = 'amoc_v3';
const LEGACY_PREVIOUS = 'amoc_previous_v1';
const MAX_ENTRIES = 20000;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => value === null ? null : JSON.parse(JSON.stringify(value));
function failure(message, code, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = code;
  return error;
}

function completeLocations(value) {
  if (typeof value !== 'string') return false;
  const text = value.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').trim();
  return /^AM\s*-?\s*OC\s*-?\s*\d{1,4}(?:\s*[,;\n]\s*AM\s*-?\s*OC\s*-?\s*\d{1,4})*$/i.test(text);
}

/** A saved active document always has data. No document is represented by null,
 * not an empty database that could be confused with missing/corrupt storage. */
function database(value, {normalize = false} = {}) {
  if (!isObject(value)) throw new Error('Érvénytelen dokumentációs adatbázis.');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_ENTRIES) throw new Error('Üres vagy túl nagy dokumentációs adatbázis.');
  const groups = new Map();
  for (const [rawKey, locations] of entries) {
    const key = normalizeKey(rawKey);
    if (!key || (!normalize && key !== rawKey) || !completeLocations(locations)) {
      throw new Error('Hibás J-kód vagy AM–OC hely a dokumentációban.');
    }
    groups.set(key, [...new Set([...(groups.get(key) || []), ...extractPlaces(locations)])]);
  }
  return Object.fromEntries([...groups].map(([key, locations]) => [key, locations.join(', ')]));
}

export function createDocument({name, database: data, sources = [], excludedCount = 0, createdAt} = {}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 300) throw new Error('Adj meg legfeljebb 300 karakteres dokumentációnevet.');
  if (!Array.isArray(sources) || sources.length > 1000 || sources.some(source => typeof source !== 'string' || source.length > 1000)) {
    throw new Error('Érvénytelen dokumentumforrások.');
  }
  if (!Number.isSafeInteger(excludedCount) || excludedCount < 0) throw new Error('Érvénytelen kihagyott találatszám.');
  const date = createdAt === undefined ? new Date().toISOString() : createdAt;
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) throw new Error('Érvénytelen dokumentációs dátum.');
  return {
    name: name.trim(), database: database(data, {normalize: true}),
    createdAt: new Date(date).toISOString(), sources: [...new Set(sources)], excludedCount,
  };
}

function validateDocument(value) {
  if (value === null) return null;
  if (!isObject(value) || typeof value.createdAt !== 'string' || !Array.isArray(value.sources) || !Number.isSafeInteger(value.excludedCount)) throw new Error('Hibás dokumentációs bejegyzés vagy hiányzó dokumentációs metaadat.');
  // Stored keys are stricter than flexible keys accepted at creation/import.
  database(value.database);
  return createDocument(value);
}
function validateState(value) {
  if (!isObject(value) || value.version !== 1 || !Object.hasOwn(value, 'active') || !Object.hasOwn(value, 'previous')) {
    throw new Error('Ismeretlen vagy hibás dokumentációs mentés.');
  }
  return {version: 1, active: validateDocument(value.active), previous: validateDocument(value.previous)};
}

/** Reads and migrates legacy values in memory, preserving both legacy keys.
 * A malformed saved value is a recoverable external problem: callers must show
 * the error, not overwrite it with the original bundled database. */
export function loadDocuments(storage, original) {
  let raw, legacyActive, legacyPrevious;
  try {
    raw = storage.getItem(DOCUMENTS_KEY);
    if (raw === null) {
      legacyActive = storage.getItem(LEGACY_ACTIVE);
      legacyPrevious = storage.getItem(LEGACY_PREVIOUS);
    }
  } catch (cause) {
    throw failure('A böngésző helyi dokumentációs tárhelye nem olvasható. A mentett adatokat nem módosítottuk.', 'STORAGE_UNAVAILABLE', cause);
  }
  try {
    if (raw !== null) return validateState(JSON.parse(raw));
    if (legacyActive !== null || legacyPrevious !== null) {
      return {
        version: 1,
        active: legacyActive === null ? null : createDocument({name: 'Korábban mentett dokumentáció', database: database(JSON.parse(legacyActive)), sources: ['Korábbi helyi mentés']}),
        previous: legacyPrevious === null ? null : createDocument({name: 'Előző dokumentáció', database: database(JSON.parse(legacyPrevious)), sources: ['Korábbi helyi mentés']}),
      };
    }
    return {version: 1, active: createDocument({name: 'Eredeti dokumentáció', database: original, sources: ['Beépített eredeti adatok']}), previous: null};
  } catch (cause) {
    throw failure('A mentett dokumentáció sérült vagy nem támogatott. Nem töröltük és nem írtuk felül; állíts vissza egy biztonsági mentést.', 'CORRUPT_DOCUMENT_STORAGE', cause);
  }
}

/** One setItem is the commit point. Browser localStorage guarantees an atomic
 * value replacement; callers update live state only after this returns. */
export function saveDocuments(storage, state) {
  const validated = validateState(state);
  const serialized = JSON.stringify(validated);
  try { storage.setItem(DOCUMENTS_KEY, serialized); }
  catch (cause) {
    throw failure('A böngésző nem tudta menteni a dokumentációt. Az aktív és az előző dokumentáció változatlan maradt. Ellenőrizd a szabad tárhelyet, és készíts biztonsági mentést.', 'STORAGE_WRITE_FAILED', cause);
  }
  return validated;
}

export function activateDocument(storage, state, document) {
  const current = validateState(state);
  const next = {version: 1, active: validateDocument(document), previous: copy(current.active ?? current.previous)};
  if (!next.active) throw new Error('Üres dokumentáció nem aktiválható.');
  return saveDocuments(storage, next);
}

export function deleteActive(storage, state) {
  const current = validateState(state);
  if (!current.active) return current;
  return saveDocuments(storage, {version: 1, active: null, previous: copy(current.active)});
}

export function restorePrevious(storage, state) {
  const current = validateState(state);
  if (!current.previous) throw new Error('Nincs visszaállítható előző dokumentáció.');
  return saveDocuments(storage, {version: 1, active: copy(current.previous), previous: copy(current.active)});
}

/** Automatically collect complete reliable keys. If any unresolved candidate
 * references a J key, withhold that entire key rather than show a partial set of
 * locations as complete. Orphan AM–OC candidates never inherit/invent a J code.
 * Human review is explicit, not a bulk "make uncertain results reliable" flag. */
export function buildActivation(records) {
  if (!Array.isArray(records) || records.length > 100000) throw new Error('Hibás vagy túl nagy felismerési lista.');
  const prepared = records.map(row => {
    const valid = isObject(row) && Boolean(normalizeKey(row.key)) && completeLocations(row.loc);
    const resolved = valid && (row.uncertain === false || row.verified === true);
    return {row, valid, resolved, key: isObject(row) ? normalizeKey(row.key) : ''};
  });
  const excludedKeys=new Set(prepared.filter(item=>!item.resolved).flatMap(item=>[item.key,...(Array.isArray(item.row?.affectedKeys)?item.row.affectedKeys.map(normalizeKey):[])]).filter(Boolean));
  const reliable = [], uncertain = [];
  for (const item of prepared) {
    if (item.resolved && !excludedKeys.has(item.key)) reliable.push({...item.row, key: item.key});
    else uncertain.push({...(isObject(item.row) ? item.row : {}),
      ...(item.resolved && excludedKeys.has(item.key) ? {uncertain: true, reasons: [...(Array.isArray(item.row.reasons) ? item.row.reasons : []), 'Ehhez a J-kódhoz további, még bizonytalan hely is tartozik; a teljes J-kód kimarad az aktiválásból.']} : {}),
    });
  }
  return {database: aggregate(reliable), reliable, uncertain, excludedKeys: [...excludedKeys]};
}
