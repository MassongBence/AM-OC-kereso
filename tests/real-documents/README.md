# Valódi dokumentumok mérési készlete

A felhasználó átadott két valódi fotót és egy Excelt. A kétszer kézzel ellenőrzött
fotóreferencia 251 párt tartalmaz; az Excel 13 párnál eltér. A források és a teljes
referencia helyi, verziókezelésen kívüli mappában maradnak. A nyilvános, összesített
mérés: [valódi fotós jelentés](../../docs/real-photo-evaluation.md).
A `tests/fixtures/` generált képei továbbra is szintetikusak.

A fotót és a hozzá kézzel ellenőrzött referenciát helyi, verziókezelésen kívüli
mappában tartsd, például `/tmp/amoc-real/`. Ne commitolj munkadokumentumot vagy
annak tartalmát pusztán azért, mert helyi tesztelésre érkezett. A benchmark nem
küldi a fájlt külső szolgáltatásnak; saját, loopback HTTP-kiszolgálót és helyi
Chromium/OCR-workert használ.

A referencia, SHA-256 egyeztetés, kétmenetes kézi ellenőrzés és futtatás pontos
menete: [OCR-mérési leírás](../../docs/ocr-evaluation.md).
