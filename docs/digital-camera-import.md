# Excel- és kamerafolyamat: reprodukció és mérés

Kiindulás: `main`, `30dea45` (PR #3 merge), fejlesztési branch:
`fix/digital-import-camera-pipeline`. A korábban félbemaradt módosítások
megmaradtak. A projekt és a meglévő OCR-motor folytatása, új szolgáltatás nélkül.

## Milyen bemenet állt rendelkezésre

Megmaradt a korábban csatolt két 1536 × 2048 képpontos fotó,
`referencia_excel.xlsx`, a fotók 251 kétszer ellenőrzött referencia-párja és a
korábbi teljes OCR-futtatás. Az éles hibát adó **`am.xlsx` és az alkalmazás
kamerájával újonnan készített fotók nem álltak rendelkezésre**. Emiatt az éles
127/315/255 és 16/19/112 darabszám pontos reprodukciója nem történt meg.

Az Excel és a régi fotók külön referencia: 238 pár közös, 13 csak az Excelben és
13 csak a fotókon szerepel. Az Excel-importot az Excel átírásához, a kamerás
felismerést a kétszer vizuálisan ellenőrzött fotóreferenciához hasonlítottuk.
Az Excel importhűségének eredménye nem használható fotós OCR-pontosságként.

## Excel-hibák és javítás

A korábbi `pairRows` az összes munkalapból adott javaslatokat: egy különálló,
J-oszlop nélküli helylistából is minden helyet bizonytalan rekordnak vett.
Egy 255 soros kiegészítő helylista ezt a hibamechanizmust reprodukálja; ez
regressziós példa, nem az ismeretlen `am.xlsx` rekonstruált tartalma.
A duplikált lapok felfújták a megjelenített darabszámot is.

Az új digitális parser az értékeket, a deklarált J-/helyoszlopokat és az
összevonásokat olvassa. Nem használ OCR-biztonsági értéket. Kezeli a fordított
oszlopsorrendet, egymás melletti táblázatokat, több helyet, ismétlődő J-kódot és
mindkét oldalon függőlegesen összevont cellát. A teljesen azonos párok egyszer
szerepelnek, a forráscella adatai megmaradnak. A mennyiségek, sorszámok és
önálló kiegészítő helylisták nem hoznak létre kitalált J-kódokat.

A ténylegesen hiányzó vagy kétértelmű kapcsolat, illetve a sérült kód továbbra
is bizonytalan. Több J-kódot tartalmazó cellából nincs automatikus párosítás;
minden ténylegesen érintett J-kód kimarad a teljes helylistájával. Duplikálás
nem tüntetheti el a hiányosságot vagy az érintett kulcsok egy részét.

### Valódi Excel-kontroll

A megmaradt munkafüzet két lapja ugyanazt a 251 párt tartalmazza: 190 és
253 sor, összevonás nélkül. A korábbi útvonal 439 rekordot, azokban 502
párelőfordulást adott, 251 egyedi párral. Az új útvonal 251 rekordot ad,
251 ismétlődő párelőfordulást összevon. Mindkettőnél 0 bizonytalan volt ezen
a konkrét fájlon; az éles 255 bizonytalan eredmény ezen nem reprodukálható.

A teljes, böngészőbeli Workbook Worker → import → aktiválási lista mérés:

| Kontroll | J-kód | Helyes pár | Hiányzó | Téves | Bizonytalan |
|---|---:|---:|---:|---:|---:|
| `referencia_excel.xlsx` | 188 | 251 | 0 | 0 | 0 |

`J001 → AM-OC-429` megbízható. A mérés az elmentett, külön Excel-átíráshoz
viszonyított importhűség; nem független OCR-validáció és nem általános
100%-os felismerési garancia.

## Fájlkiválasztás és megszakítás

A korábbi Clear egy függőben levő OCR-betöltés vagy fájlolvasás befejezéséig
foglalt állapotban hagyhatta a felületet, az új import erre várt. Három
böngészős regressziós teszt a `main` változaton ezt reprodukálta. Nem sikerült
bizonyítani, hogy ez okozta az éles Excel darabszámait.

Most minden import saját megszakítható munkát és eredménylistát kap.
A kijelölés törlése vagy cseréje azonnal leválasztja a korábbi munkát,
üríti a hozzá tartozó eredményeket és jelentést, és az új import elindulhat.
A későn befejeződő fájlolvasás/OCR-indítás nem írhatja felül az új listát;
a későn létrejövő OCR-worker megszűnik. Az új automatikus dokumentumnév is a
jelenlegi kijelölést követi. A kézzel adott név megmarad.

A helyi aktív és előző adatbázist az import és a kijelölés törlése nem módosítja.
Csak az aktiválás ment. Nincs kötelező soronkénti jóváhagyás, és a bizonytalan
adatok nem kapnak automatikusan megbízható minősítést.

## Kamerafolyamat

Az alkalmazás a natív képfájl-választót/kamerát használja. A kapott kép
felbontását és a kamerán belüli tömörítést a készülék/böngésző határozza meg;
az új képek nélkül ezek éles értéke nem ismert. Az alkalmazás korábban minden
képet 2600 képpontos hosszabb oldalra csökkentett, így egy 12 MP-es kép apró
szövege már az OCR előtt részletet veszített.

Most külön méretkeretet kapnak a feldolgozási lépések:

- Dekódolás/OCR: legfeljebb 4096 képpontos hosszabb oldal, 8 millió pixel.
- Cellageometria: legfeljebb 2600 képpontos minta; a poligonok és a logikai
  sorhatárok az OCR-kép koordinátáiba vetülnek vissza. Az oszlopazonosítók
  megőrzik a táblázatok közötti elkülönítést.
- Sarokkijelölő előnézet: legfeljebb 640 pixel, külön az OCR-képtől.

Nincs JPEG-újratömörítés az OCR előtt. A böngésző által már alkalmazott EXIF
tájolást nem forgatjuk meg másodszor. A perspektíva- és dőléskorrekció, a helyi
kontrasztjavítás, a kerethez érő számjegyek megőrzése és a konzervatív
OCR-egyezési szabályok megmaradnak.

Ugyanannak a generált 4032 × 3024 JPEG-nek a méretpróbája: korábban
2600 × 1950, most 3266 × 2449 OCR-pixel; a mintakarakter 11 helyett 13 pixel
magas. Ez **részletmegőrzési regressziós próba, nem valódi fotós pontosságmérés**.
A két meglévő, 2048 pixeles kontrollfotó feldolgozott képe és cellageometriája
bitazonos a korábbi útvonallal. Az új iPhone-fotókon és fizikai Safariban a
pontos eredmény, futásidő és memóriahasználat még nincs ellenőrizve.

### Teljes valódi OCR-kontroll, újrafuttatva

| Bemenet, értékelési szint | Helyes | Hiányzó | Téves |
|---|---:|---:|---:|
| Fotó 1, minden javaslat | 83 | 2 | 0 |
| Fotó 2, minden javaslat | 142 | 24 | 6 |
| Együtt, minden javaslat | 225 | 26 | 6 |
| Fotó 1, automatikus aktiválás | 43 | 42 | 0 |
| Fotó 2, automatikus aktiválás | 60 | 106 | 0 |
| Együtt, automatikus aktiválás | 103 | 148 | 0 |

A javaslatok precizitása 97,40%, lefedettsége 89,64%, pontos párosítási aránya
87,55% (`helyes / (referencia + téves)`). Az automatikusan aktiválható rész
precizitása 100%, lefedettsége csak 41,04%. Ezek ugyanazok a darabszámok, mint
a korábbi kontrollon: ezen a két kisebb fotón nincs pontosságjavulás.
A teljes futás 100,938 másodperc, korábban 103,478 másodperc volt ezen a felhős
Chromium-gépen; ez nem igazol iPhone-os gyorsulást. Feldolgozási hiba nem volt.

A kimaradást továbbra is okozza alacsony OCR-biztonság (111 rekord), elégtelen
OCR-egyezés (87), ütköző érvényes kódolvasat (19), az AM-cellát lefedő J-cella
hiánya (15) és a kapcsolódó helycella olvashatatlansága (13). Ezek átfedő okok.
A részben bizonytalan J-kód teljes kizárása tovább csökkenti az aktiválható
részt. A bizonytalanság elrejtése helyett ezek a találatok kimaradnak.
**A 95%-os teljes automatikus cél nem teljesült.**

## Ellenőrzések és reprodukció

- `npm test`: 118/118 sikeres.
- `npm run test:browser`: 27/27 sikeres, `/AM-OC-kereso/` Pages-útvonalon.
- `npm run vendor` után a verziózott vendor változatlan; `git diff --check` tiszta.
- Böngészős teszt: összevont és ismétlődő Excel-lapok, kiegészítő mennyiségi
  lap, `J001 → AM-OC-429`, 0 OCR-kérés, kijelöléstörlés, egyetlen aktiválás.
- Böngészős teszt: késleltetett valódi OCR-betöltés és fájlolvasás megszakítása,
  utólagos eredmények kizárása, aktív adatok megőrzése.
- Képtesztek: EXIF mindkét dekódoló útvonalon egyszer, nagy kép részletei,
  külön előnézet, visszavetített összevont cellák, változatlan kisebb képek.
- PDF-regresszió: többoldalas, képi és szöveges/képi vegyes dokumentum.
- Pages/PWA-regresszió: relatív worker/modulútvonalak és offline újratöltés.
  Ez nem az új verzió éles telepítésének vagy fizikai iPhone-nak a tesztje.

```sh
node scripts/benchmark.mjs --reference /workspace/ocr-real-input/photos-verified-reference.json --output test-results/camera-control.json /workspace/ocr-real-input/foto_1.jpg /workspace/ocr-real-input/foto_2.jpg
```

Számszerű, bemeneti lenyomatokat is tartalmazó összesítés:
[digital-camera-results.json](digital-camera-results.json). Az eredeti képek,
az Excel és a teljes, adatpárokat tartalmazó helyi mérés nem kerülnek Gitbe.

A felület helyben exportálható **Beolvasás adatai** jelentése a fájl SHA-256
lenyomatát, méretét, dekódolási és OCR-képméreteit, geometriáját, perspektíva-
korrekcióját és módszerenkénti összesítését tartalmazza. Így megkülönböztethető
az eltérő bemeneti fotó és az eltérő feldolgozás. Képpixelek és felismert párok
nincsenek benne; fájlnév és böngészőazonosító igen. Az alkalmazás nem küldi el.
