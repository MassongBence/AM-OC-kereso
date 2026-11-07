# AM–OC kereső

Sötét témájú, mobilon is használható webalkalmazás J-kódokhoz tartozó AM–OC
helyek keresésére. Egyszerre egy dokumentáció aktív. A dokumentumok feldolgozása
helyben, a böngészőben történik; nincs külső dokumentumfeltöltés vagy fizetős
felismerő szolgáltatás.

## Keresés és dokumentációváltás

1. A főképernyő keresőjébe `69`, `069` vagy `J069` írható. Mindegyik ugyanarra a
   J-kódra keres, és az aktív dokumentációban szereplő összes kapcsolódó AM–OC
   helyet mutatja. Hiányzó vagy visszatartott kódnál a szöveg:
   **„Nem található vagy nem sikerült felismerni az aktív dokumentációban.”**
2. Az **Új dokumentáció** résznél adj nevet, válassz fájlokat, vagy készíts fotót.
   A feldolgozás fájlválasztás és fényképezés után automatikusan elindul.
   A kameraképek egymás után hozzáadhatók; több fotó a fájlválasztóban egyszerre
   is kijelölhető. A már feldolgozott, változatlan beállítású fájlok eredményét a
   jelenlegi munkamenet újrahasználja.
3. A **Dokumentáció aktiválása** egyetlen művelettel lecseréli a régi
   dokumentációt az automatikusan elfogadható eredményre. Nincs kötelező
   soronkénti jóváhagyás és nincs külön kötelező ellenőrzőlista. Aktiválásig a
   régi dokumentáció kereshető marad. Sikertelen vagy üres fájlt tartalmazó
   importcsomag nem aktiválható; az előző adatokat nem törli.

A megbízhatónak minősített és a bizonytalan találatok külön, lenyitható listában
jelennek meg. A bizonytalan javaslatok nem kerülnek biztos eredményként az aktív
keresőbe. Ha egy J-kódhoz akár egy feloldatlan bizonytalan hely is tartozik,
**az egész J-kód kimarad**, a már jól olvasott helyeivel együtt: egy részleges
helylista sem látszhat teljes találatnak. A kimaradó javaslatok száma látható.
A felismert darabszám nem bizonyítja a dokumentum teljességét.

A kézi javítás opcionális, a lenyitható eszközök között érhető el. Csak az eredeti
dokumentumból egyértelműen ellenőrzött párosítást jelölj ellenőrzöttnek. A rendszer
nem talál ki hiányzó J-kódot. Az eredeti képes oldal a forrásoldalak listájából
megnyitható.

Támogatott bemenet: a böngésző által dekódolható kép, PDF, XLSX, XLS, CSV, TXT és
az alkalmazás JSON biztonsági mentése. Minden PDF-oldal és Excel-munkalap együtt
kerül a dokumentációba. A HEIC/HEIF támogatása a böngésző dekódolójától függ;
sikertelen megnyitáskor exportálj JPEG- vagy PNG-képet.

## Aktív dokumentáció és mentés

Az **Aktív dokumentáció** panel megmutatja a nevet, időpontot, forrásfájlokat,
J-kódok számát és a kihagyott bizonytalan javaslatok számát. A teljes aktív tartalom
külön megjeleníthető. Az **Aktív törlése** kiüríti a keresőt, az **Előző
visszaállítása** visszahozza a korábbi dokumentációt. Törlés után újratöltve sem
jelennek meg maguktól az eredeti mintaadatok. Az eredeti adatok külön, opcionális
művelettel tölthetők vissza.

Az aktív és az előző dokumentáció egyetlen `amoc_documents_v1` helyi mentésben
van. Az állapotváltás egy atomikus tárolási művelet; sikertelen mentés esetén az
aktív és az előző dokumentáció is megmarad. A korábbi `amoc_v3` és
`amoc_previous_v1` adatok migrációja megőrzi a régi értékeket. Sérült mentés nem
váltható észrevétlenül az eredeti adatbázisra.

A CSV-export és a dokumentáció metaadatait is tartalmazó JSON-mentés letölthető,
majd az importfolyamaton keresztül visszatölthető. A böngésző webhelyadatainak
vagy helyi tárhelyének törlése ezeket a helyi adatokat is törli. Fontos
dokumentációváltás előtt tölts le biztonsági mentést.

## Képfelismerés és pontosság

- Excelben a tényleges cellák és deklarált összevonások adják a párosítás alapját.
  Az ismétlődő J-kódok helyei összeadódnak, az ismétlődő helyek egyszer szerepelnek.
  Üres, össze nem vont J-cella nem örökli automatikusan az előző sor J-kódját.
  Az XLSX/XLS és CSV külön digitális feldolgozást használ, OCR-biztonsági küszöb
  nélkül. Az oszlopfejlécek szerinti párosítás fordított oszlopsorrenddel is működik;
  a kiegészítő helylisták és mennyiségi oszlopok nem válnak J-kódokká. A hiányos
  vagy kétértelmű digitális kapcsolat ettől még bizonytalan marad.
- Nagy fotón az OCR legfeljebb 4096 képpontos hosszabb oldalt és 8 millió pixelt
  használ; a cellaháló külön, legfeljebb 2600 képpontos mintán készül és visszavetül
  az OCR-képre. A 640 képpontos előnézet nem az OCR bemenete. A képet a feldolgozás
  nem tömöríti újra JPEG-ként; a böngésző alkalmazza a tájolási metaadatot.
- Fényképen automatikus négyszögkeresés, valódi projektív transzformáció
  (homográfia), kis szögű dőléskorrekció, kontrasztjavítás és adaptív küszöbölés
  készíti elő a táblázatot. Ha az automatikus igazítás nem elég, egy fotón a négy
  sarok kézzel kijelölhető a **Képigazítás és újrafeldolgozás** alatt. A
  **Újrafeldolgozás** a beállításokat újra alkalmazza. Több fájl mindegyike saját
  automatikus igazítást kap.
- A cellahatárok oszloponként kerülnek felismerésre, így egy több sor magas
  J-cella teljes tartománya párosítható több szomszédos AM–OC cellához. A rendszer
  nem kizárólag a szövegsorok azonos magasságára támaszkodik.
- A görbült táblázatvonalakat helyi, összefüggő cellabelsők és külön oszlopnyomok
  követik. A margók és a táblázatok közti rések nem válnak adatsorrá. A fizikai
  képkivágás és a közös osztóvonalon mért logikai cellatartomány külön megmarad.
- A keretfelismerés mérési maszkot készít, nem festi fehérre az egész folt
  befoglaló téglalapját. Így a kerethez érő számjegy sem törlődik. A szürke
  betűk helyi kontrasztjavítást és betűméret szerinti nagyítást kapnak a
  küszöbölés előtt; bizonytalan olvasatnál nyerssor-mód is próbálkozik.
- A cellák több helyi OCR-változaton mennek át: küszöbölt képen blokkfelismerés,
  szürkeárnyalatos képen sorfelismerés, szükség esetén további blokkfelismerés.
  A módszerek olvasata és biztonsági értéke összehasonlításra kerül. Egymással
  ütköző kódok és alá nem támasztott javítási javaslatok bizonytalanok maradnak.
  Fizikai cellán belül a karakterenkénti optikai biztonság és a küszöbölt / szürke
  változat egyezése is használható: a J előtagot ténylegesen látni kell, az AM–OC
  numerikus helyazonosítója nem javítható találgatással. Az O/0 és a rögzített
  névtér normalizálása, valamint a nyers olvasatok a mérési bizonyítékban megmaradnak; a helyazonosító
  számjegyeit nem találgatjuk.
- PDF-ben a szöveges elemek koordinátái és a renderelt cellahatárok használhatók.
  Szkennelt és képet is tartalmazó oldalak OCR-t is kapnak. Cellaháló nélküli
  becsült párosítás nem válik biztos táblázatcellává.
- A CH–OC, FR–OC és C–DR kódok kimaradnak. Hiányzó J-kód helyett nincs automatikus
  továbbörökítés vagy kitalált kulcs.

A felületen használt „megbízható” minősítés konzervatív feldolgozási szabály,
**nem bemért 95%-os pontossági garancia**. Az OCR biztonsági értékei és több
változat egyetértése sem helyettesítik a teljes valódi referencia mérését.
Erős perspektíva, gyűrődés, hiányzó rács, elmosódás vagy takart szöveg továbbra is
felismerési hibát okozhat.

Két valódi dokumentumfotó és a hozzájuk adott Excel összevetése megtörtént.
A fotókon 251 egyedi pár van; az Excellel 238 egyezik, és 13 pár eltér mindkét
irányban. A fotókból külön, kétszeri vizuális átírással készült referencia.
A valódi eredményeket és korlátokat a [fotós mérési jelentés](docs/real-photo-evaluation.md)
rögzíti. A legalább 95%-os teljes felismerési cél nincs teljesítettként feltüntetve.
A [mérési útmutató](docs/ocr-evaluation.md) külön kezeli a nyers jelölteket és a
ténylegesen automatikusan aktiválható adatokat.

Az Excel- és kamerafolyamat további javításának külön eredményei és a hiányzó
új iPhone-felvételek miatti korlátok: [importmérési jelentés](docs/digital-camera-import.md).
A **Beolvasás adatai** alatt helyben letölthető a jelenlegi import fájllenyomata,
képmérete, feldolgozási módja és összesítése. A jelentés nem tartalmaz fotópixeleket
vagy felismert adatpárokat. A **Kijelölés törlése** a folyamatban levő importot is
megszakítja, törli az előnézetet és az import gyorsítótárát; a későn beérkező
korábbi eredmények nem jelennek meg az új importban.

Ha a valós mintákon a helyi megoldás nem elegendő, további, tanított
táblázatfelismerő megoldás összehasonlítása szükséges. Fizetős szolgáltatás vagy
külső dokumentumküldés külön jóváhagyás nélkül nem kerül az alkalmazásba.
Nyilvános GitHub Pages JavaScript nem tárolhat titkos szolgáltatási API-kulcsot.

## iPhone-főképernyő és offline használat

A relatív webalkalmazás-manifest, az Apple-webalkalmazás-metaadatok és a
180 × 180 képpontos Apple-ikon támogatják a Safari **Főképernyőhöz adás**
műveletét. A kereső és a sötét mobilfelület marad az elsődleges használati mód.
Valódi iPhone/Safari készülékes teszt továbbra is szükséges; a Chromium
mobilnézetes ellenőrzése nem helyettesíti ezt.

Az ugyanerről a webhelyről működő service worker az alkalmazásfájlokat, a helyi
OCR/PDF-könyvtárakat és a nyelvi modellt gyorsítótárazza. A teljes első sikeres
betöltés és a service worker települése után a gyorsítótárazott alkalmazás
hálózat nélkül is használható. Az első betöltéshez hálózat kell; a böngésző
később tárhelyet is felszabadíthat, ezért az offline elérhetőségre nem szabad
biztonsági mentésként támaszkodni. A feltöltött dokumentumokat az alkalmazás
nem küldi hálózatra és nem teszi a service worker gyorsítótárába; az aktivált
adatok a helyi dokumentációs tárhelyen vannak.

## Helyi fejlesztés és tesztelés

A kiszolgáláshoz Python 3 elegendő; nincs alkalmazásbuild. A repository gyökeréből:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

A `file://` megnyitás helyett HTTP-kiszolgálót használj a modulok és workerek
miatt. A service worker HTTPS-en vagy helyi fejlesztési gépen működik.
A fejlesztői tesztekhez Node.js 24 és npm szükséges:

```sh
npm ci
npm test
npx playwright install --with-deps chromium
CHROMIUM_PATH="$(node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath());')" npm run test:browser
```

Meglévő Chromium esetén a `CHROMIUM_PATH` annak elérési útjára állítható. A
böngészős tesztek saját HTTP-kiszolgálót indítanak. A párosítási, képelőkészítési,
dokumentációs állapotváltási és mérőszámtesztek mellett az import, az aktiválás,
a mentés és a helyi OCR folyamata is ellenőrizhető. A futtatás tényleges
összesítését kell használni a sikeres, sikertelen vagy kihagyott esetek számához.

A [tesztadatok leírása](tests/fixtures/README.md) ismerteti a generált Excel-,
PDF- és képes példákat. Ezek nem ügyféldokumentumok vagy terepi mintafotók.
A valódi mintákhoz használható mérés a [külön útmutatóban](docs/ocr-evaluation.md)
található.

## GitHub Pages

Az alkalmazás statikus fájlokból működik. Az `index.html`, `manifest.webmanifest`,
`sw.js`, `assets/` és `vendor/` együtt szolgálandó ki. A relatív modul-, worker-,
modell- és service worker-útvonalak a repository nevét tartalmazó projektútvonalon
is használhatók. A böngészős tesztek `/AM-OC-kereso/` alatti kiszolgálással
ellenőrizhetik ezt; a helyi teszt nem jelenti az új verzió éles telepítését.

A tesztworkflow nem telepít vagy merge-el automatikusan. A változás külön
branchről, Pull Requesten keresztül kerülhet a `main` ágba.

## Feldolgozó könyvtárak

A futáshoz szükséges könyvtárak és nyelvi adatok a `vendor/` mappában vannak
verziózva; futáskor nem kell CDN-ről betölteni a felismerő motort.

- PDF.js `4.10.38`, legacy modulváltozat.
- Tesseract.js `5.1.1`, Tesseract.js Core `5.1.1`, nem SIMD-es LSTM WebAssembly
  változat beágyazott WASM-adattal; angol nyelvi adatcsomag `1.0.0`.
- SheetJS `0.18.5` a régi XLS és az XLSX támogatásához. Ehhez a verzióhoz ismert
  biztonsági advisories tartoznak. A parser rövid életű, 20 másodperc után
  leállított Workerben fut, korlátozott méretű szöveges táblázatot ad át, és nem
  futtat képleteket vagy munkafüzet-HTML-t. Az elkülönítés nem javítja meg a
  könyvtár ismert upstream hibáit; a parser frissítése további feladat.

Az eredeti licencek a `vendor/LICENSE.*` fájlokban találhatók. Újratelepítés és a
vendorfájlok/SHA-256 manifest előállítása:

```sh
npm ci
npm run vendor
git diff -- vendor/
```

Verzióváltáskor ellenőrizd a licenceket, a manifestet és az import/OCR teszteket.
A CI ellenőrzi, hogy a lockfile-ból újra előállított vendor megegyezik-e a tárolt
példányokkal.
