# Valódi OCR-mérés

A két fotó 251 párosítása kétszeri vizuális átírással és a 13 vitatott eset külön újraellenőrzésével lett rögzítve. A referencia nem az OCR kimenetéből készült. Az Excel két lapja egymással egyezik, de a fotókkal csak 238 pár közös: 13 pár csak a fotókon, másik 13 csak az Excelben szerepel (16 érintett J-kód).

## Jelöltek

| Futtatás | Helyes | Hiányzó | Téves |
|---|---:|---:|---:|
| Korábbi változat, együtt | 94 | 157 | 20 |
| Javított változat, együtt | 225 | 26 | 6 |
| foto_1.jpg | 83 | 2 | 0 |
| foto_2.jpg | 142 | 24 | 6 |

## Egyetlen aktiválással bekerülő adatok

A bizonytalan párok és a velük részben bizonytalan J-kódok teljes helylistája kimarad. Nem kell az összes sort kézzel jóváhagyni; a megbízhatónak minősített rész egy művelettel aktiválható.

| Futtatás | Helyes | Hiányzó | Téves |
|---|---:|---:|---:|
| Korábbi változat | 22 | 229 | 1 |
| Javított változat | 103 | 148 | 0 |

A legalább 95%-os teljes párosítási cél nem teljesült. Ez a két, fejlesztés közben használt fotó nem általános pontossági garancia vagy külön tartott validációs készlet.

## Miért hibázott

- Az egész képen keresett egyenes oszlopvonalak nem követték a gyűrött papírt; a táblázatok közti réseket is cellának vehették. A javítás helyi, görbült vonalakat és 67 / 125 valódi J-cellát követ.
- Az összevont cella közepének szövegmagassága eltérhet a hozzá tartozó helyekétől. Közös logikai cellahatárok biztosítják a kapcsolatot, a fizikai képkivágás megmarad.
- A kereteltávolítás egy teljes befoglaló téglalapot festett fehérre; a hozzáérő számjegyből is törölhetett. A javítás nem festi át ezeket a forráspixeleket, és megtartja a kerethez érő teljes karakterfoltot.
- A kis szöveg korai binarizálása például 604-ből 804-et hozhatott létre. Szürke kép, helyi kontraszt és betűméret-alapú nagyítás előzi meg a küszöbölést.
- A megmaradt hibák kis felbontású betűk, árnyékok, keretmaradványok és egymásnak ellentmondó OCR-olvasatok. A PSM13 nyerssor-mód csak bizonytalan eseteknél próbálkozik; nem váltja le a már megerősített olvasatot.

## Reprodukció

A referencia, a képek, az Excel, a részletes hibapárok és az ellenőrzött javított Excel helyi mappában maradnak; a repository nem teszi közzé az eredeti dokumentumokat.

```sh
node scripts/benchmark.mjs --reference /workspace/ocr-real-input/photos-verified-reference.json --output test-results/real.json /workspace/ocr-real-input/foto_1.jpg /workspace/ocr-real-input/foto_2.jpg
```

A számszerű összesítés és a bemeneti / kódlenyomatok: [real-photo-results.json](real-photo-results.json).

## Módszerválasztás és korlát

A fejlesztés közben 42 vegyes fizikai cellán (39 J-/AM–OC cella és 3 idegen/üres
cella) külön módszerpróba is készült. A korábbi sor-/blokkmód 37 helyes és 2
nem értelmezhető kódot adott; a feltételes nyerssoros újraolvasás 38 helyes és 1
nem értelmezhető kódot. Ebben a részpróbában nem keletkezett téves érvényes kód.
Az általános, minden olvasatot lecserélő PSM13 viszont rosszabb lett: 37 helyes,
1 téves és 1 nem értelmezhető kód, ezért csak a bizonytalan cellák kapják ezt az
újrapróbálkozást. A részpróba cellákat, a fő mérés teljes J–hely párokat értékel;
a két pontszám nem cserélhető fel.

A nagyobb angol float modell és a külön, régi Tesseract-motor helyben történő
összehasonlítása nem igazolt akkora többletet, amely új modell letöltését és
mobilos memóriaigényét indokolná. Nem került be fizetős szolgáltatás vagy külső
dokumentumfeltöltés. A 95%-os automatikus teljességhez további, elkülönített
valódi tesztanyag és egy erősebb, helyben futtatható dokumentumfelismerő modell
összehasonlítása szükséges; a jelenlegi Tesseract-szabályok lazításával nem
állítunk elő mesterségesen biztosnak nevezett adatokat.

A két fotó kiindulási futása 78,75 másodperc, a végső, több újrapróbálkozást
használó futás 103,48 másodperc volt ezen a felhős Chromium-gépen. Ez nem fizikai
iPhone-on mért sebesség. A fájlok hozzáadásakor a már elkészült eredményeket az
alkalmazás újrahasználja; a megbízható cellákra nem futtatja a további OCR-módot.
