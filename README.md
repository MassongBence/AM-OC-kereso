# AM–OC kereső

Mobilon is használható, statikus webalkalmazás J-kódokhoz tartozó AM–OC helyek
keresésére és nyomtatott táblázatok ellenőrzött beolvasására. A meglévő eredeti
adatbázist tartalmazza; a dokumentumok feldolgozása a böngészőben történik.

## Használat

1. A keresőbe `69`, `069` vagy `J069` írható; mindegyik ugyanazt a J-kódot jelenti.
   Az összes hozzá tartozó AM–OC hely megjelenik.
2. Válassz több képet vagy dokumentumot, illetve a **Fotó készítése** gombbal
   használd a telefon kameráját. Újabb fényképezéssel további képet adhatsz a
   kijelöléshez. A fájlválasztóval egyszerre több fotó is kijelölhető.
3. A támogatott formátumok: a böngésző által dekódolható képek, PDF, XLSX, XLS,
   CSV, TXT és az alkalmazás JSON biztonsági mentése. Minden PDF-oldal és minden
   Excel-munkalap külön feldolgozódik. A HEIC/HEIF támogatása a böngésző
   képdekódolójától függ; sikertelen megnyitáskor exportálj JPEG- vagy PNG-képet.
4. Az ellenőrző képernyőn javítsd a hibás adatokat, egészítsd ki a hiányzó
   J-kódokat, vagy töröld a használhatatlan sorokat. A sárgával jelölt bizonytalan
   párokat egyenként ellenőrizni kell. A képes forrást az adott sorból megnyithatod.
5. Ellenőrizd az oldalak és helyek teljességét is, majd külön jelöléssel hagyd jóvá
   az aktuális adatbázis cseréjét. A felismert sorok száma nem bizonyítja, hogy
   minden adatot sikerült beolvasni. Hiba vagy hiányos sor esetén nincs automatikus
   adatbáziscsere és nincs érvénytelen sorok csendes elhagyása.

Jóváhagyáskor az előző adatbázis is megmarad, és visszaállítható. A CSV-export és
a teljes JSON-mentés letölthető, majd ugyanazon importfolyamaton keresztül
visszatölthető. A helyi adatbázis a böngésző tárhelyén van; a webhelyadatok
törlése ezt is törli. Fontos dokumentumváltás előtt tölts le biztonsági mentést.

## Felismerés és korlátok

- Excelben a cellák és a deklarált cellaösszevonások adják a párosítás alapját.
  Az ismétlődő J-kódok helyei összeadódnak, az ismétlődő AM–OC helyek egyszer
  szerepelnek. Üres, össze nem vont J-cella nem örökli automatikusan az előző
  sor J-kódját.
- Képeknél helyi adaptív küszöbölés csökkenti az egyenetlen megvilágítás hatását,
  kis szögű dőléskorrekció és táblázatvonal-felismerés keresi a cellahatárokat.
  A megtalált cellák külön OCR-felismerést kapnak, így a motor a szomszédos
  cellák szövege helyett az adott cella tartalmát olvassa.
  Egy több sor magas J-cella teljes függőleges tartománya használható a mellette
  lévő helycellákhoz; a párosítás nem csak a szövegsorok azonos magasságát nézi.
- PDF-ben a szöveges elemek koordinátái és a renderelt cellahatárok használhatók.
  A képet tartalmazó, illetve szkennelt oldalak OCR-t is kapnak; a vegyes
  szöveges/képi dokumentumok teljességét külön ellenőrizni kell.
- Cellaháló nélkül a szöveg és becsült koordináták csak bizonytalan javaslatot
  adnak. Nem állítunk elő kitalált, több sort átfogó cellákat. A nem párosítható
  AM–OC helyek hiányzó J-kóddal kerülnek az ellenőrző listába.
- A CH–OC, FR–OC és C–DR helyeket figyelmen kívül hagyjuk. A hibás OCR-karaktereket
  nem alakítjuk át csendben számjegyekké. Néhány szűk körű, gyakori OCR-hibához
  külön javítási javaslat készül: az érintett párnál az eredeti felismert szöveg és
  a javasolt alak is látható. A helyazonosító számsorát nem találgatjuk.
  Minden OCR-eredmény és becsült cellapárosítás emberi ellenőrzést igényel.

Ez a megoldás a korábbi, szövegsorok közelségére támaszkodó felismerést
cellaszerkezettel és képelőkészítéssel egészíti ki. Erős perspektivikus torzulást,
gyűrődést, takarást, elmosódást és hiányzó táblázatvonalakat nem javít
megbízhatóan. A szintetikus regressziós tesztek meghatározott példákat ellenőriznek;
nem mérnek általános vagy valós dokumentumokon elért felismerési pontosságot.
Valódi iPhone-on, Safari alatt a kamerás folyamat és a nagy dokumentumok
memóriaigénye még külön készülékes ellenőrzést igényel. A mobilnézetet Chromium
iPhone-méretű emulációja ellenőrzi.

Ha a valós dokumentumok minősége ezt igényli, következő lépésként tanított
dokumentum-/táblázatfelismerő szolgáltatással lehet összehasonlítani a helyi
eredményeket, címkézett mintákon. Ehhez külön backend, biztonságos hitelesítés és
a dokumentumküldés felhasználói kezelése szükséges; titkos API-kulcsot nem lehet
nyilvános GitHub Pages JavaScriptbe tenni. A jelenlegi alkalmazás nem használ
ilyen külső szolgáltatást.

## Helyi fejlesztés és tesztelés

A kiszolgáláshoz Python 3 elegendő; nincs alkalmazásbuild:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

A `file://` megnyitás helyett HTTP-kiszolgálót használj, mert a modulok és az
OCR/PDF workerek így töltődnek be megfelelően. A fejlesztői tesztekhez Node.js 24
és npm szükséges:

```sh
npm ci
npm test
npx playwright install --with-deps chromium
CHROMIUM_PATH="$(node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath());')" npm run test:browser
```

Ha a Chromium már telepítve van, a `CHROMIUM_PATH` annak elérési útjára állítható.
A böngészős tesztek saját HTTP-kiszolgálót indítanak, kézzel indított szerver nem
kell hozzájuk. A tesztek a tiszta párosítási logikát, összevont és ismétlődő
J-cellákat, több helyet, hibás és bizonytalan adatokat, importot, jóváhagyást,
tárhelyhibát, mentést és a helyi OCR-t vizsgálják.

A [tesztadatok leírása](tests/fixtures/README.md) ismerteti a generált Excel-,
PDF- és képes példákat. Ezek nem ügyféldokumentumok vagy terepi mintafotók.

## GitHub Pages

Az alkalmazás közvetlenül statikus fájlokból működik. Az `index.html`, `assets/`
és `vendor/` együtt szolgálandó ki. Minden modul, PDF/OCR worker és nyelvi adat
relatív útvonallal töltődik, ezért a repository nevét tartalmazó projektútvonal
is támogatott. A böngészős teszt ezt `/AM-OC-kereso/` alatti kiszolgálással
ellenőrzi, valódi OCR-workerrel is. Ez kompatibilitási ellenőrzés; nem igazolja,
hogy az új verzió már éles GitHub Pages telepítésen fut.

A tesztworkflow nem telepít és nem tesz közzé webhelyet. A meglévő Pages
beállítás és a `main` publikálási folyamata változatlan marad.

## Feldolgozó könyvtárak

A böngészős futáshoz szükséges könyvtárak és nyelvi adatok a `vendor/` mappában
vannak verziózva. A dokumentum nem kerül külső OCR-backendhez, és futáskor nem
kell CDN-ről betölteni a felismerő motort. A kezdeti webhelybetöltéshez hálózat
szükséges; nincs offline-gyorsítótárazást garantáló service worker.

- PDF.js `4.10.38`, legacy modulváltozat.
- Tesseract.js `5.1.1`, Tesseract.js Core `5.1.1`, nem SIMD-es LSTM WebAssembly
  változat, beágyazott WASM-adattal; angol nyelvi adatcsomag `1.0.0`.
- SheetJS `0.18.5` a régi XLS és az XLSX támogatásához. Ehhez a verzióhoz ismert
  biztonsági advisories tartoznak. A parser rövid életű, 20 másodperc után
  leállított Workerben fut, korlátozott méretű szöveges táblázatot ad át, és nem
  futtat képleteket vagy munkafüzet-HTML-t. Az elkülönítés nem javítja meg a
  könyvtár ismert upstream hibáit; a parser frissítése külön további feladat.

Az eredeti licencek a `vendor/LICENSE.*` fájlokban találhatók. A függőségek a
lockfile alapján telepíthetők újra; a vendorfájlok és SHA-256 manifest frissítése:

```sh
npm ci
npm run vendor
git diff -- vendor/
```

Verzióváltáskor ellenőrizd a licenceket, a manifestet és a teljes böngészős
import/OCR tesztet. A CI ellenőrzi, hogy a lockfile-ból újra előállított vendor
fájlok megegyeznek-e a repositoryban tárolt példányokkal.
