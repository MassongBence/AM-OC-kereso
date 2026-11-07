# A felismerés mérése

## Jelenlegi bizonyíték és cél

A cél legalább 95% jó párosítás jó minőségű, **valódi** dokumentumfotókon.
Az újonnan átadott két fotó 251 párosítását külön átírtuk és kétszer ellenőriztük;
az Excel 13 eltérő párja miatt nem szolgálhatott változtatás nélkül referenciaként.
A [valódi fotós jelentés](real-photo-evaluation.md) bemutatja a kiindulási és javított
mérést. A szintetikus regressziós teszt továbbra sem helyettesíti a valódi mérést.

Az alkalmazás nem vezet be fizetős felismerő szolgáltatást vagy külső
dokumentumfeltöltést. A következő mérés is teljes egészében helyben fut.

## Ellenőrzött referencia készítése

1. Őrizd meg a változatlan bemeneti fotókat/PDF-eket egy helyi mappában. Többoldalas
   dokumentációhoz az összes oldalt add meg. A forrásoldalakat és a referenciát
   külön engedély nélkül ne tedd nyilvános repositoryba.
2. Első menetben **az eredeti dokumentumot nézve**, ne az OCR-listát javítgatva,
   írd át az összes J-kód/AM–OC párt. Egy J-kód több helyéhez külön rekord tartozik.
   A függőlegesen összevont J-cella teljes tartományát olvasd le. CH–OC, FR–OC és
   C–DR helyek ne kerüljenek az AM–OC referenciába.
3. Második, külön menetben ellenőrizd vissza a teljes átírást a fotó minden
   cellájával. Lehetőleg másik személy ellenőrizze; egy személy esetén is legyen
   külön második áttekintés. Ne csak a felismert sorokat ellenőrizd, mert azzal
   a kihagyott párok láthatatlanok maradnának. Valóban olvashatatlan cellát ne
   találj ki: az ilyen fotó nem alkalmas teljes, jó minőségű referenciának.
4. Töltsd ki a `review` mezőt csak a kézi ellenőrzés után. A `kind: "real"` csak
   valódi dokumentumfotót jelölhet. Generált tesztábra `kind: "synthetic"` marad.
5. Számítsd ki minden megadott fájl SHA-256 hashét (`sha256sum kep.jpg`). A
   referencia `sources` listája az összes bemeneti fájl nevét és hashét pontosan
   egyszer tartalmazza. Ezzel a mérés nem egy később észrevétlenül átírt fájlt
   nevez ugyanannak a dokumentumnak.

Példa a referencia szerkezetére; az alábbi sorok **csak sémaminta**, nem valódi
fotóról ellenőrzött adatok:

```json
{
  "documentId": "helyi-dokumentum-azonosito",
  "kind": "real",
  "review": {
    "status": "checked",
    "method": "two-pass-manual",
    "reviewedAt": "2026-11-07",
    "note": "Teljes átírás, majd minden cella külön visszaellenőrizve."
  },
  "sources": [
    {"name": "kep.jpg", "sha256": "IDE_A_TENYLEGES_64_KARAKTERES_SHA256_ERTEK_KERUL"}
  ],
  "reference": [
    {"key": "J069", "loc": "AM-OC-425"},
    {"key": "J069", "loc": "AM-OC-426"}
  ]
}
```

A referencia nem tartalmazhat nem kanonikus kulcsot (`69` helyett `J069` kell),
ismétlődő párt vagy egy `loc` mezőben több helyet. A fájlnév/hash nem egyeztetése
megszakítja a benchmarkot. A program nem készít referenciát saját OCR-kimenetéből.

## Futtatás

A repository gyökeréből, `npm ci` után, telepített Chromium mellett:

```sh
node scripts/benchmark.mjs \
  --reference /tmp/amoc-real/reference.json \
  --output /tmp/amoc-real/report.json \
  /tmp/amoc-real/kep.jpg
```

Több fotó vagy több dokumentum esetén add meg az összes fájlt ugyanabban a
parancsban. A PDF-oldalakat a meglévő importer együtt dolgozza fel. Az importáló
beállításai opcionálisan a referencia `importOptions` mezőjében rögzíthetők,
például `{"rotation":90}`. Az alkalmazáshoz hasonlóan a benchmark is relatív
`/AM-OC-kereso/` útvonalon indítja a valódi böngészős importert, workerrel és a
verziózott helyi nyelvi modellel. Külső hálózati kérést a tesztböngésző tilt.

A `CHROMIUM_PATH` környezeti változóval megadható a böngésző elérési útja. A
jelentés nyers felismerési szöveget és párokat is tartalmazhat; kezeld ugyanúgy,
mint a forrásdokumentumot. A benchmark húsz perc után sikertelenül leáll.

CI-ben vagy helyi minőségi kapuként a `--require-target` kapcsoló kérhető: ekkor a
kilépési kód `2`, ha az ellenőrzött, hash-egyező valódi készleten nem igazolható a
cél. `1` feldolgozási/parancshibát, `0` befejezett mérést jelent. Kapcsoló nélkül
a sikeres mérés `0`-val zárul akkor is, ha a felismerés pontatlan; a jelentésben
ilyenkor is egyértelműen `established: false` látható.

## Mérőszámok és összehasonlítás

A jelentés nem helynévhalmazt vagy felismert sorok darabszámát hasonlítja össze,
hanem pontos **(J-kód, AM–OC hely)** párokat. Ismétlődő pár csak egyszer számít.
Egy téves J-hez rendelt hely egy téves és egy hiányzó párt jelent.

- `truePositive`: helyes párok száma.
- `falsePositive`: a referenciában nem szereplő, téves párok száma.
- `falseNegative`: a referenciából hiányzó párok száma, ideértve az OCR
  bizonytalanság miatt visszatartott párokat is.
- `precision = TP / (TP + FP)`: a kiadott párok közül mennyi helyes.
- `recall = TP / (TP + FN)`: az összes szükséges párból mennyi van meg.
- `correctPairingRate = TP / (TP + FP + FN)`: téves és hiányzó párokkal is
  büntetett pontos párosítási arány.
- `f1`: precision és recall harmonikus átlaga.

Nincs eredmény esetén a precision `null`, nem 100%. Hiányzó J-kódos jelölt nem
kaphat kitalált kulcsot; `invalidCandidates` alatt külön számoljuk. A hiányzó
referenciapár ekkor is csökkenti a recall értékét.

Külön eredmény készül az összes javaslatról (`allCandidates`) és a ténylegesen
aktiválható megbízható részről (`reliableOnly`). Utóbbi az alkalmazás
`buildActivation` szabályát használja: ha egy J-kódhoz feloldatlan bizonytalan
hely is tartozik, az egész J-kód visszatartásra kerül. Így a többhelyes kód
részleges felismerése nem látszik teljes találatnak.

A `methods` rész minden elérhető OCR-módszer eredményét ugyanahhoz a teljes
referenciához méri. Nem csak egy sikerült cellát vagy kiválasztott oldalt mér,
és nem válogatja össze utólag a referenciának megfelelő módszert cellánként. A
`diagnostics` rész megőrzi a módszert, nyers olvasatot, forrást és jelölteket,
amelyekkel a változatok hibái összevethetők.

A 95%-os cél kapujához **precision, recall és correctPairingRate egyaránt legalább
95%** kell a megbízhatóan aktiválható eredményben, hash-egyező, kétszer kézzel
ellenőrzött valódi forráskészleten, feldolgozási hiba nélkül. Egyetlen sikeres
fotó legfeljebb annak az egy fotónak az eredményét igazolja. Általános pontossági
állításhoz több, a használatot reprezentáló, a finomhangolástól elkülönített
valódi dokumentum és külön jelentés szükséges.

## Rögzített szintetikus regressziós mérés

A [szintetikus referencia](../tests/fixtures/synthetic-reference.json) a tiszta és a
3°-kal elforgatott/árnyékolt táblázatot tartalmazza, a források SHA-256 lenyomatával.
Mindkét oldal ugyanazt a három J/hely párt mutatja; a pontszám három **egyedi**
párra vonatkozik, az ismétlődő oldalak nem növelik a helyes találatok számát.

Újrafuttatás:

```sh
npm run benchmark:synthetic
```

A [rögzített eredmény](ocr-synthetic-result.json) a 2026-11-07-i helyi Chromium
futtatásból származik:

| Módszer | Helyes pár | Hiányzó pár | Téves pár |
| --- | ---: | ---: | ---: |
| Küszöbölt kép, blokk mód, javítatlan nyers szöveg | 0 | 3 | 0 |
| Kontrasztos szürke kép, sor mód, javítatlan nyers szöveg | 0 | 3 | 0 |
| Kontrasztos szürke kép, blokk mód, javítatlan nyers szöveg | 0 | 3 | 0 |
| Cellaszerkezet és szigorú karakteregyezés összesítve | 3 | 0 | 0 |
| Ténylegesen automatikusan aktiválható adat | 3 | 0 | 0 |

A két kép összes feldolgozása ebben a felhős Chromium-futtatásban 5,316 másodperc
volt; ez nem iPhone-on mért sebességígéret. Az OCR szótári szóbiztonsága a
`JO69` / `AM-0OC` alakok miatt alacsony lehetett. A cellakonszenzus két eltérő
képelőkészítésből származó, egyező karakterolvasatot igényel: a J előtagot és a
helyazonosító számjegyeit ténylegesen látni kell; hiányzó J nem található ki.
A rögzített OC névtér és a J számpozíciójában látható O/0 normalizálása az
optikai bizonyítékban megmarad. Ezt többek között hiányzó J, eltérő helyszám,
idegen névtér és alacsony karakterbiztonság elleni negatív tesztek védik.

Összehasonlításként a nagyobb, hivatalos angol `tessdata_best` modell is helyben
kipróbálásra került, dokumentumküldés nélkül. Az itt vizsgált karaktertévesztést
és a teljes szóra adott alacsony biztonsági értéket nem oldotta meg, így nem
növeltük vele a mobilos letöltési és memóriaigényt.

Ez a korábbi **szintetikus** regressziós bizonyíték, kis mintával. Az azóta
átadott valódi fotók külön mérési jelentést kaptak; a két eredmény nem keverhető össze.
