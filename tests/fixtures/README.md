# Import regression fixtures

These fixtures are generated test documents, not field photographs or an OCR
accuracy benchmark. They contain no customer data.

Regenerate them from the repository root with
`node tests/fixtures/generate.mjs` after `npm ci` (Chromium is required).

- `merged-multisheet.xlsx` is a minimal standards-based OOXML workbook. On its
  first worksheet `A2:A3` is a merged `J069` cell covering `AM-OC-425` and
  `AM-OC-426`. A second worksheet repeats `J069` with `AM-OC-427`. `J070` has
  `AM-OC-588`; `CH-OC-999`, `FR-OC-888`, and `C-DR-777` must be ignored.
- `multipage.pdf` is a two-page PDF with actual text objects using Helvetica.
  Page 1 contains `J069 → AM-OC-425`; page 2 contains `J070 → AM-OC-588`.
  There are no grid lines, so any geometric pairing must require review.
- `ruled-table.png` is a canvas-generated printed table with a vertically
  centered merged `J069` cell spanning `AM-OC-425` and `AM-OC-426`, followed
  by `J070 → AM-OC-588`. Adjacent cells contain the excluded code families.
- `ruled-table-skew-shadow.png` applies a three-degree rotation and a synthetic
  lighting gradient to that image. It exercises preprocessing on a controlled
  input and does not represent the range of real camera distortion or folds.
- `mixed-text-scan.pdf` combines real PDF text `J080 → AM-OC-777` with the
  rasterized ruled table. Its import must retain both the text and image pairs;
  finding extractable text alone is insufficient evidence of complete import.

The browser suite serves the application below `/AM-OC-kereso/`, matching a
GitHub project Pages URL. Passing it validates static relative paths and local
import behavior; it does not prove a production Pages deployment has occurred.
