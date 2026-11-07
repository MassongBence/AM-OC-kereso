import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
await mkdir('vendor/lang', {recursive: true});
const files = [
 ['xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js'],
 ['xlsx/LICENSE', 'LICENSE.xlsx'],
 ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
 ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
 ['pdfjs-dist/LICENSE', 'LICENSE.pdfjs'],
 ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
 ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
 ['tesseract.js/LICENSE.md', 'LICENSE.tesseract'],
 ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
 ['tesseract.js-core/LICENSE', 'LICENSE.tesseract-core'],
 ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
 ['@tesseract.js-data/eng/package.json', 'eng-package.json'],
];
const hashes = {};
for (const [src, dest] of files) {
 await copyFile(`node_modules/${src}`, `vendor/${dest}`);
 hashes[dest] = createHash('sha256').update(await readFile(`vendor/${dest}`)).digest('hex');
}
await writeFile('vendor/manifest.json', JSON.stringify({versions:{xlsx:'0.18.5',pdfjs:'4.10.38',tesseract:'5.1.1',tesseractCore:'5.1.1',eng:'1.0.0'},sha256:hashes}, null, 2)+'\n');
