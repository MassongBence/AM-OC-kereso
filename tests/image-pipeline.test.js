import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveThreshold, detectCells, estimateSkew, assignWordsToCells} from '../assets/image-pipeline.js';

function ruledTable() {
  const width = 500, height = 400, binary = new Uint8Array(width * height);
  const horizontal = (y, x0, x1) => { for (let x = x0; x <= x1; x++) binary[y * width + x] = 1; };
  for (const x of [20, 120, 450]) for (let y = 20; y <= 380; y++) binary[y * width + x] = 1;
  for (const y of [20, 180, 280, 380]) horizontal(y, 20, 450);
  horizontal(100, 120, 450); // merged J cell, two separate location rows
  return {width, height, binary};
}

test('ruled cell detection retains a vertically merged J cell', () => {
  const {binary, width, height} = ruledTable();
  const cells = detectCells(binary, width, height);
  assert.equal(cells.length, 7);
  assert.deepEqual(cells[0], {x0: 20, y0: 20, x1: 120, y1: 180});
  assert(cells.some(cell => cell.x0 === 120 && cell.y0 === 20 && cell.y1 === 100));
  assert(cells.some(cell => cell.x0 === 120 && cell.y0 === 100 && cell.y1 === 180));
});

test('no synthetic table is invented for an unruled or blank page', () => {
  assert.deepEqual(detectCells(new Uint8Array(500 * 400), 500, 400), []);
});

test('words inherit cell bounds, including tall merged key bounds; outliers remain visible', () => {
  const words = [
    {text: 'J069', bbox: {x0: 30, y0: 85, x1: 80, y1: 105}, confidence: 95},
    {text: 'AM-OC-425', bbox: {x0: 140, y0: 35, x1: 280, y1: 55}, confidence: 92},
    {text: 'AM-OC-426', bbox: {x0: 140, y0: 125, x1: 280, y1: 145}, confidence: 86},
    {text: 'AM-OC-999', bbox: {x0: 460, y0: 350, x1: 499, y1: 370}, confidence: 70},
  ];
  const {binary, width, height} = ruledTable();
  const cells = assignWordsToCells(words, detectCells(binary, width, height));
  assert.equal(cells.length, 4);
  assert.equal(cells.find(cell => cell.text === 'J069').y0, 20);
  assert.equal(cells.find(cell => cell.text === 'J069').y1, 180);
  assert.equal(cells.find(cell => cell.text === 'AM-OC-999').unbounded, true);
});

test('split OCR tokens are joined within the same cell with conservative confidence', () => {
  const cells = assignWordsToCells([
    {text: 'AM', bbox: {x0: 20, y0: 10, x1: 35, y1: 20}, confidence: 98},
    {text: 'OC-425', bbox: {x0: 40, y0: 11, x1: 90, y1: 21}, confidence: 80},
  ], [{x0: 0, y0: 0, x1: 100, y1: 30}]);
  assert.equal(cells[0].text, 'AM OC-425');
  assert.equal(cells[0].confidence, 80);
});

test('adaptive threshold recovers dark print across a gradual shadow', () => {
  const width = 200, height = 80, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, background = 120 + Math.round(120 * x / width);
    const value = y === 40 && x > 10 && x < 190 ? background - 90 : background;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = value; rgba[p + 3] = 255;
  }
  const binary = adaptiveThreshold(rgba, width, height, 15, 12);
  for (const x of [20, 80, 160]) assert.equal(binary[40 * width + x], 1);
  assert.equal(binary[20 * width + 80], 0);
});

test('skew estimate follows tilted horizontal ruling instead of matching text baselines', () => {
  const width = 600, height = 400, binary = new Uint8Array(width * height), angle = 3;
  for (const base of [40, 110, 180, 250, 320]) for (let x = 30; x < 570; x++) {
    const y = Math.round(base + Math.tan(angle * Math.PI / 180) * (x - width / 2));
    binary[y * width + x] = binary[(y + 1) * width + x] = 1;
  }
  assert(Math.abs(estimateSkew(binary, width, height) - angle) <= .3);
});
