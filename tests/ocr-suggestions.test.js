import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestOcrText} from '../assets/ocr-suggestions.js';
test('OCR-only suggestions keep raw ambiguous readings visible', () => {
  for (const [input, expected] of [['JO69','J069'],['JO70','J070'],['AM-0OC-425','AM-OC-425'],['AM-0C-426','AM-OC-426']]) {
    const result=suggestOcrText(input); assert.equal(result.text,expected); assert.ok(result.reasons[0].includes(input));
  }
});
test('suggestions never repair location suffix digits, other code families or arbitrary prose', () => {
  for (const input of ['CH-0C-425','FR-OC-888','C-DR-777','AM-OC-42O','see JO69','J069','AM-OC-588']) assert.deepEqual(suggestOcrText(input),{text:input,reasons:[]});
});
