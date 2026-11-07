import {ORIGINAL} from './original-data.js';
import {normalizeKey, extractPlaces, aggregate} from './table-core.js';
import {DocumentImporter, validatedDatabase, validLocationList} from './importers.js';

const $ = id => document.getElementById(id);
const ACTIVE = 'amoc_v3', PREVIOUS = 'amoc_previous_v1';
let db = {...ORIGINAL}, pending = [], selected = [], cameraFiles = [], importer = null, busy = false;
const status = text => { $('status').textContent = text; };
try {
  const saved = localStorage.getItem(ACTIVE);
  if (saved) db = validatedDatabase(JSON.parse(saved));
} catch { status('A helyi mentés nem olvasható. Az eredeti adatokat töltöttük be; a hibás mentést nem töröltük.'); }
function refresh() {
  const raw = $('search').value.trim(), key = normalizeKey(raw);
  $('result').textContent = !raw ? 'Írj be egy J-kódot!' : !key ? 'Érvénytelen J-kód. Például: 69 vagy J069.' : db[key] || 'Ehhez a J-kódhoz nincs találat.';
  $('count').textContent = Object.keys(db).length + ' J-kód az aktuális adatbázisban';
  $('dbStatus').textContent = Object.keys(db).length + ' J-kód betöltve';
  try { $('restorePrevious').disabled = !localStorage.getItem(PREVIOUS); } catch { $('restorePrevious').disabled = true; }
}
$('search').addEventListener('input', refresh); refresh();

function picked() { $('picked').textContent = selected.length ? selected.map(file => file.name).join(' • ') + ` (${selected.length} fájl)` : 'Nincs kijelölt fájl.'; }
$('files').addEventListener('change', event => { selected = [...event.target.files, ...cameraFiles]; picked(); });
$('cam').onclick = () => { $('camera').value = ''; $('camera').click(); };
$('camera').onchange = event => { cameraFiles.push(...event.target.files); selected = [...$('files').files, ...cameraFiles]; picked(); };
$('clearFiles').onclick = () => { selected = []; cameraFiles = []; $('files').value = ''; $('camera').value = ''; picked(); };
picked();

function clearReview() {
  pending = []; $('review').replaceChildren(); $('reviewPanel').classList.add('hide');
  $('sourcePreview').classList.add('hide'); $('previewImage').removeAttribute('src');
  $('replaceConfirm').checked = false; $('reviewStatus').textContent = '';
  importer?.disposePreviews();
}
function element(tag, text, cls) { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
function renderReview() {
  $('review').replaceChildren();
  pending.forEach((row, index) => {
    const card = element('article', '', 'candidate' + (row.uncertain ? ' uncertain' : ''));
    const fields = element('div', '', 'fields');
    for (const [field, label] of [['key', 'J-kód'], ['loc', 'AM–OC hely(ek)']]) {
      const wrap = element('div'); const id = `candidate-${index}-${field}`;
      const lab = element('label', label); lab.htmlFor = id;
      const input = element(field === 'loc' ? 'textarea' : 'input');
      if (field === 'key') { input.type = 'text'; input.autocapitalize = 'characters'; input.spellcheck = false; }
      input.id = id; input.value = row[field]; input.dataset.i = index; input.dataset.field = field;
      wrap.append(lab, input); fields.append(wrap);
    }
    card.append(fields);
    card.append(element('p', row.source + (row.row ? ' · ' + row.row + '. sor' : ''), 'small'));
    if (row.uncertain) {
      card.append(element('p', '⚠ ' + (row.reasons || []).join(' '), 'small warn'));
      const label = element('label', '', 'check'); const check = document.createElement('input');
      check.type = 'checkbox'; check.dataset.i = index; check.dataset.field = 'verified'; check.checked = !!row.verified;
      label.append(check, document.createTextNode('Ezt a párosítást az eredeti dokumentum alapján ellenőriztem.')); card.append(label);
    }
    if (importer?.previews.has(row.source)) {
      const button = element('button', 'Eredeti oldal megtekintése', 'secondary');
      button.onclick = () => { $('previewImage').src = importer.previews.get(row.source); $('previewLabel').textContent = row.source; $('sourcePreview').classList.remove('hide'); $('sourcePreview').scrollIntoView({block: 'nearest'}); };
      card.append(button);
    }
    const remove = element('button', 'Sor törlése', 'danger'); remove.dataset.del = index; card.append(remove);
    $('review').append(card);
  });
  const count = Object.keys(aggregate(pending)).length;
  const uncertain = pending.filter(row => row.uncertain).length;
  $('reviewSummary').textContent = `${pending.length} párosítási javaslat · ${count} J-kód · ${uncertain} bizonytalan sor. Jelenleg ${Object.keys(db).length} J-kód van az adatbázisban. Ellenőrizd, hogy minden oldal és minden hely szerepel-e; a felismert darabszám nem igazolja a teljességet.`;
  $('reviewPanel').classList.remove('hide');
}
$('review').addEventListener('input', event => {
  const {i, field} = event.target.dataset;
  if (i === undefined || !pending[+i]) return;
  const row = pending[+i];
  row[field] = field === 'verified' ? event.target.checked : event.target.value;
  if (field !== 'verified') {
    row.verified = false;
    const check = $('review').querySelector(`input[data-i="${i}"][data-field="verified"]`);
    if (check) check.checked = false;
    $('replaceConfirm').checked = false;
  }
});
$('review').addEventListener('click', event => {
  const {del} = event.target.dataset;
  if (del !== undefined) { pending.splice(+del, 1); $('replaceConfirm').checked = false; renderReview(); }
});
$('add').onclick = () => { pending.push({key: '', loc: '', source: 'Kézzel hozzáadva', uncertain: true, reasons: ['Kézi párosítás.']}); $('replaceConfirm').checked = false; renderReview(); };
$('cancel').onclick = () => { clearReview(); status('Az új dokumentációt elvetetted. Az adatbázis változatlan.'); };

// Write persistent state before changing the live database. Quota/private-mode
// failures leave current data intact; export remains available to the user.
function replaceDatabase(next) {
  validatedDatabase(next);
  try {
    localStorage.setItem(PREVIOUS, JSON.stringify(db));
    localStorage.setItem(ACTIVE, JSON.stringify(next));
  } catch { throw new Error('A böngésző nem tudta biztonságosan menteni az új adatokat. Az aktuális adatbázis változatlan. Mentsd le CSV- vagy JSON-fájlba, és ellenőrizd a szabad tárhelyet.'); }
  db = next; refresh();
}
$('apply').onclick = () => {
  const fail = text => { $('reviewStatus').textContent = text; $('reviewStatus').scrollIntoView({block:'nearest'}); };
  if (busy || !pending.length) return fail('Nincs jóváhagyható adat.');
  if (pending.some(row => !normalizeKey(row.key) || !validLocationList(row.loc))) return fail('Hiányzó vagy hibás J-kód / AM–OC hely van a sorok között. Javítsd vagy töröld ezeket; semmit nem hagyunk ki automatikusan.');
  if (pending.some(row => row.uncertain && !row.verified)) return fail('Minden bizonytalan párosítást ellenőrizz és jelölj meg egyenként.');
  if (!$('replaceConfirm').checked) return fail('Az adatbázis cseréjéhez jelöld be a teljes dokumentáció ellenőrzéséről szóló jelölőnégyzetet.');
  try {
    const next = aggregate(pending); replaceDatabase(next);
    clearReview(); status(`✓ ${Object.keys(db).length} J-kód jóváhagyva és mentve. Az előző adatbázis visszaállítható.`);
  } catch (error) { fail(error.message); }
};
function setBusy(value) {
  busy = value;
  for (const id of ['process', 'cam', 'camera', 'files', 'clearFiles', 'rotation', 'apply', 'add', 'cancel', 'reset', 'restorePrevious']) $(id).disabled = value;
  if (!value) refresh();
}
$('process').onclick = async () => {
  if (busy) return;
  if (!selected.length) return status('Előbb válassz fájlt vagy készíts fotót.');
  clearReview(); setBusy(true);
  importer = new DocumentImporter({onStatus: status, rotation: Number($('rotation').value)});
  $('log').textContent = ''; $('progress').classList.remove('hide'); $('progress').value = 0;
  const report = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i]; status('Feldolgozás: ' + file.name + ` (${i + 1}/${selected.length})`);
      try {
        const records = await importer.read(file, {label: file.name + ' · ' + (i + 1) + '. fájl'});
        pending.push(...records.map(row => ({...row, verified: false})));
        report.push(file.name + ': ' + records.length + ' párosítási javaslat' + (!records.length ? ' — ⚠ nem ismertünk fel adatot.' : ''));
      } catch (error) { report.push(file.name + ': HIBA: ' + error.message); }
      $('log').textContent = [...report, ...importer.issues].join('\n');
      $('progress').value = Math.round((i + 1) / selected.length * 100);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (pending.length) {
      const incomplete = importer.issues.length || report.some(line => /HIBA|⚠/.test(line));
      if (incomplete) pending.forEach(row => { row.uncertain = true; row.reasons = [...row.reasons, 'A dokumentumcsomag egy része hibás vagy hiányos. Ellenőrizd a teljességet is.']; });
      renderReview();
      status(incomplete ? '⚠ Részleges feldolgozás. Nézd át a hibákat; hiányos dokumentáció is kerülhetett az ellenőrző listába. Az adatbázis változatlan.' : 'Feldolgozás kész. Ellenőrizd az összes oldalt és párosítást, majd hagyd jóvá a cserét.');
    } else status('Nem sikerült J-kód / AM–OC párokat felismerni. Az adatbázis változatlan. Részletek a feldolgozási naplóban.');
  } catch (error) { status('Feldolgozási hiba: ' + error.message + '. Az adatbázis változatlan.'); }
  finally { try { await importer.close(); } catch { status('A képfelismerő leállt. Az adatbázis jóváhagyásig változatlan.'); } finally { setBusy(false); } }
};
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('export').onclick = () => download('AM_OC_adatok.csv', '\ufeffJ-kód;AM–OC helyek\n' + Object.entries(db).map(([key, loc]) => key + ';"' + loc.replace(/"/g, '""') + '"').join('\n'), 'text/csv;charset=utf-8');
$('backup').onclick = () => download('AM_OC_biztonsagi_mentes.json', JSON.stringify({format:'amoc-backup',version:1,createdAt:new Date().toISOString(),database:db}, null, 2), 'application/json');
$('restorePrevious').onclick = () => {
  if (!confirm('Visszaállítod az előző adatbázist? A jelenlegi adatokról helyi mentés készül.')) return;
  try { replaceDatabase(validatedDatabase(JSON.parse(localStorage.getItem(PREVIOUS)))); clearReview(); status('Az előző adatbázis visszaállítva.'); } catch (error) { status(error.message); }
};
$('reset').onclick = () => {
  if (!confirm('Visszaállítod az eredeti AM–OC adatokat? A jelenlegi adatokról helyi mentés készül.')) return;
  try { replaceDatabase({...ORIGINAL}); clearReview(); status('Eredeti adatok visszaállítva.'); } catch (error) { status(error.message); }
};
window.addEventListener('pagehide', event => { if (!event.persisted) { importer?.close().catch(() => {}); importer?.disposePreviews(); } });
