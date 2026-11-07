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

import {selectOcrHypothesis} from '../assets/ocr-suggestions.js';
test('two high-confidence uncorrected methods can produce a reliable local consensus', () => {
  const selected=selectOcrHypothesis([{method:'threshold',text:'J069',confidence:95},{method:'gray',text:'J069',confidence:93}]);
  assert.equal(selected.text,'J069'); assert.equal(selected.evidence.reliable,true); assert.equal(selected.evidence.agreeingMethods.length,2);
});
test('correction agreement and low confidence cannot make an OCR suggestion reliable', () => {
  for (const text of ['JO69','AM-0OC-425']) {
    const selected=selectOcrHypothesis([{method:'threshold',text,confidence:99},{method:'gray',text,confidence:99}]);
    assert.equal(selected.evidence.reliable,false); assert.ok(selected.reasons.some(reason=>reason.includes(text)));
  }
  assert.equal(selectOcrHypothesis([{method:'threshold',text:'J069',confidence:87},{method:'gray',text:'J069',confidence:99}]).evidence.reliable,false);
});
test('valid disagreements remain uncertain instead of majority voting them into facts', () => {
  const selected=selectOcrHypothesis([{method:'a',text:'AM-OC-425',confidence:99},{method:'b',text:'AM-OC-425',confidence:99},{method:'c',text:'AM-OC-426',confidence:70}]);
  assert.equal(selected.evidence.reliable,false); assert.equal(selected.evidence.conflicting,true);
});
test('the same method cannot be counted twice and arbitrary prose is never a reliable code', () => {
  assert.equal(selectOcrHypothesis([{method:'a',text:'J069',confidence:99},{method:'a',text:'J069',confidence:99}]).evidence.reliable,false);
  assert.equal(selectOcrHypothesis([{method:'a',text:'CH-OC-425',confidence:99},{method:'b',text:'CH-OC-425',confidence:99}]).evidence.reliable,false);
  assert.equal(selectOcrHypothesis([{method:'a',text:'J069 extra',confidence:99},{method:'b',text:'J069 extra',confidence:99}]).evidence.reliable,false);
});
test('multiple AM locations compare as a complete set, not a matching first location', () => {
  const selected=selectOcrHypothesis([{method:'a',text:'AM-OC-425, AM-OC-426',confidence:96},{method:'b',text:'AM-OC-426\nAM-OC-425',confidence:95}]);
  assert.equal(selected.evidence.reliable,true); assert.equal(selected.text,'AM-OC-425, AM-OC-426');
  assert.equal(selectOcrHypothesis([{method:'a',text:'AM-OC-425, AM-OC-426',confidence:96},{method:'b',text:'AM-OC-425',confidence:95}]).evidence.reliable,false);
});

const symbolsFor=(text, confidence=98)=>[...text].map(text=>({text,confidence}));
const glyphVotes=(text,confidence=30)=>[
  {method:'threshold-block',variant:'threshold',text,confidence,symbols:symbolsFor(text)},
  {method:'gray-line',variant:'gray',text,confidence,symbols:symbolsFor(text)},
];
test('physical-cell grammar can use strong symbols while preserving fixed-prefix normalizations', () => {
  for(const [raw,expected] of [['JO69','J069'],['AM-0OC-425','AM-OC-425'],['AM-0C-426','AM-OC-426'],['AM-OC-588','AM-OC-588']]) {
    const selected=selectOcrHypothesis(glyphVotes(raw),{boundedCell:true});
    assert.equal(selected.text,expected);assert.equal(selected.evidence.reliable,true);assert.equal(selected.evidence.symbolConsensus,true);
    if(raw!==expected)assert.ok(selected.evidence.normalizations.some(item=>item.raw===raw));
  }
});
test('glyph grammar cannot invent missing J, repair AM digits, or accept foreign prefixes', () => {
  for(const raw of ['069','AM-OC-42O','CH-0C-425','FR-OC-425','C-DR-425']) assert.equal(selectOcrHypothesis(glyphVotes(raw),{boundedCell:true}).evidence.reliable,false,raw);
});
test('high word confidence cannot override weak identifier symbols in physical cells', () => {
  const votes=glyphVotes('AM-OC-425',99);votes[0].symbols.at(-1).confidence=80;votes[1].symbols.at(-1).confidence=80;
  assert.equal(selectOcrHypothesis(votes,{boundedCell:true}).evidence.reliable,false);
  const keys=glyphVotes('JO69',99);keys.forEach(vote=>{vote.symbols[0].confidence=80;});
  assert.equal(selectOcrHypothesis(keys,{boundedCell:true}).evidence.reliable,false);
});
test('symbol consensus needs threshold and grayscale plus distinct methods and unanimous identifier values', () => {
  const duplicate=glyphVotes('JO69');duplicate[1].method=duplicate[0].method;
  assert.equal(selectOcrHypothesis(duplicate,{boundedCell:true}).evidence.reliable,false);
  const sameVariant=glyphVotes('JO69');sameVariant[1].variant='threshold';
  assert.equal(selectOcrHypothesis(sameVariant,{boundedCell:true}).evidence.reliable,false);
  const conflict=glyphVotes('AM-0OC-425');conflict[1].text='AM-0OC-426';conflict[1].symbols=symbolsFor(conflict[1].text);
  assert.equal(selectOcrHypothesis(conflict,{boundedCell:true}).evidence.reliable,false);
});
test('symbol evidence must align with the observed text and a physical cell', () => {
  const votes=glyphVotes('JO69');votes[1].symbols.pop();
  assert.equal(selectOcrHypothesis(votes,{boundedCell:true}).evidence.reliable,false);
  assert.equal(selectOcrHypothesis(glyphVotes('JO69')).evidence.reliable,false);
});
