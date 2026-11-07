// Run from the repository root: node tests/fixtures/generate.mjs
// Synthetic inputs only; keep their expected semantics in README.md.
import fs from 'node:fs/promises';
import XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';

const save = (name, bytes) => fs.writeFile(new URL(name, import.meta.url), bytes);
const workbook = XLSX.utils.book_new();
const first = XLSX.utils.aoa_to_sheet([
  ['J-kod', 'Hely'], ['J069', 'AM-OC-425'], ['', 'AM-OC-426'],
  ['J070', 'AM-OC-588'], ['J070', 'CH-OC-999'],
]);
first['!merges'] = [XLSX.utils.decode_range('A2:A3')];
XLSX.utils.book_append_sheet(workbook, first, 'Elso');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['J-kod', 'Hely'], ['J069', 'AM-OC-427'], ['J070', 'FR-OC-888, C-DR-777'],
]), 'Masodik');
await save('merged-multisheet.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [key, place] of [['J069', 'AM-OC-425'], ['J070', 'AM-OC-588']]) {
  const page = pdf.addPage([612, 792]);
  page.drawText(key, { x: 60, y: 730, size: 16, font });
  page.drawText(place, { x: 210, y: 730, size: 16, font });
}
await save('multipage.pdf', await pdf.save());

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 800);
    ctx.strokeStyle = 'black'; ctx.lineWidth = 4;
    function line(x0, y0, x1, y1) {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    for (const x of [50, 300, 800, 1150]) line(x, 60, x, 660);
    for (const y of [60, 160, 460, 660]) line(50, y, 1150, y);
    line(300, 310, 1150, 310);
    ctx.fillStyle = 'black'; ctx.font = 'bold 40px Arial';
    ctx.fillText('J code', 85, 125); ctx.fillText('Location', 345, 125); ctx.fillText('Other', 855, 125);
    ctx.font = '44px Arial';
    for (const [text, x, y] of [['J069', 100, 325], ['AM-OC-425', 345, 250], ['AM-OC-426', 345, 400], ['J070', 100, 570], ['AM-OC-588', 345, 570]]) ctx.fillText(text, x, y);
    ctx.font = '32px Arial';
    for (const [text, y] of [['CH-OC-999', 250], ['FR-OC-888', 400], ['C-DR-777', 570]]) ctx.fillText(text, 840, y);
    const distorted = document.createElement('canvas');
    distorted.width = 1400; distorted.height = 1000;
    const out = distorted.getContext('2d');
    out.fillStyle = 'white'; out.fillRect(0, 0, 1400, 1000);
    out.translate(700, 500); out.rotate(3 * Math.PI / 180); out.drawImage(canvas, -600, -400);
    out.setTransform(1, 0, 0, 1, 0, 0);
    const gradient = out.createLinearGradient(0, 0, 1400, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0.03)'); gradient.addColorStop(.55, 'rgba(0,0,0,0.32)'); gradient.addColorStop(1, 'rgba(0,0,0,0.06)');
    out.fillStyle = gradient; out.fillRect(0, 0, 1400, 1000);
    return [canvas.toDataURL(), distorted.toDataURL()];
  });
  for (const [index, name] of ['ruled-table.png', 'ruled-table-skew-shadow.png'].entries()) {
    await save(name, Buffer.from(images[index].split(',')[1], 'base64'));
  }
  const mixed = await PDFDocument.create();
  const mixedFont = await mixed.embedFont(StandardFonts.Helvetica);
  const mixedPage = mixed.addPage([612, 792]);
  mixedPage.drawText('J080', { x: 60, y: 730, size: 16, font: mixedFont });
  mixedPage.drawText('AM-OC-777', { x: 210, y: 730, size: 16, font: mixedFont });
  const scan = await mixed.embedPng(Buffer.from(images[0].split(',')[1], 'base64'));
  mixedPage.drawImage(scan, { x: 30, y: 40, width: 550, height: 550 * 800 / 1200 });
  await save('mixed-text-scan.pdf', await mixed.save());
} finally {
  await browser.close();
}
