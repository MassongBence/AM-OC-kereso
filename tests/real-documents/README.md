# Valódi dokumentumok mérési készlete

**A felhasználó által említett valódi táblázatfotó még nem érkezett meg ebbe a
munkaterületbe. A 95%-os cél valódi dokumentumokon jelenleg nincs megmérve és nincs
igazolva.** A `tests/fixtures/` generált képeit nem nevezzük valódi tesztanyagnak.

A fotót és a hozzá kézzel ellenőrzött referenciát helyi, verziókezelésen kívüli
mappában tartsd, például `/tmp/amoc-real/`. Ne commitolj munkadokumentumot vagy
annak tartalmát pusztán azért, mert helyi tesztelésre érkezett. A benchmark nem
küldi a fájlt külső szolgáltatásnak; saját, loopback HTTP-kiszolgálót és helyi
Chromium/OCR-workert használ.

A referencia, SHA-256 egyeztetés, kétmenetes kézi ellenőrzés és futtatás pontos
menete: [OCR-mérési leírás](../../docs/ocr-evaluation.md).
