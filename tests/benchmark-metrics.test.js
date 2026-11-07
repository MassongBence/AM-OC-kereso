import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePairs,compareMethods,validateReference,assessRealTarget} from '../assets/benchmark-metrics.js';

const reference=[{key:'J069',loc:'AM-OC-425'},{key:'J069',loc:'AM-OC-426'},{key:'J070',loc:'AM-OC-588'}];
test('exact metrics distinguish correct, missing and wrong J assignments',()=>{
  const result=evaluatePairs(reference,[{key:'J069',loc:'AM-OC-425'},{key:'J071',loc:'AM-OC-426'}]);
  assert.equal(result.truePositive,1); assert.equal(result.falsePositive,1); assert.equal(result.falseNegative,2);
  assert.equal(result.precision,.5); assert.equal(result.recall,1/3); assert.equal(result.correctPairingRate,.25);
  assert.equal(result.meetsTarget,false); assert.deepEqual(result.wrong,[{key:'J071',loc:'AM-OC-426'}]);
});
test('multi-location predictions and repeated pages do not inflate pair counts',()=>{
  const result=evaluatePairs(reference,[{key:'69',loc:'AM-OC-425, AM-OC-426'},{key:'J069',loc:'AM-OC-425'},{key:'J070',loc:'AM-OC-588'}]);
  assert.equal(result.truePositive,3); assert.equal(result.predictedPairs,3); assert.equal(result.duplicatePairs,1);
  assert.equal(result.precision,1);assert.equal(result.recall,1);assert.equal(result.meetsTarget,true);
});
test('abstentions and orphan locations do not count as correct predictions',()=>{
  const result=evaluatePairs(reference,[{key:'',loc:'AM-OC-425'}]);
  assert.equal(result.precision,null);assert.equal(result.recall,0);assert.equal(result.falseNegative,3);
  assert.equal(result.invalidCandidates,1);assert.equal(result.meetsTarget,false);
});
test('reference is strict, canonical, nonempty and cannot contain duplicate annotations',()=>{
  for (const input of [null,{}, {documentId:'d',kind:'real',reference:[]},
    {documentId:'d',kind:'real',reference:[{key:'69',loc:'AM-OC-425'}]},
    {documentId:'d',kind:'real',reference:[{key:'J069',loc:'AM-OC-425, AM-OC-426'}]},
    {documentId:'d',kind:'real',reference:[reference[0],reference[0]]}]) assert.throws(()=>validateReference(input));
});
test('method comparison includes each method across all pages, without cherry picking',()=>{
 const result=compareMethods(reference,[{method:'threshold-6',records:[reference[0]]},{method:'gray-7',records:reference},{method:'threshold-6',records:[reference[1]]}]);
 assert.equal(result['threshold-6'].truePositive,2);assert.equal(result['threshold-6'].falseNegative,1);
 assert.equal(result['gray-7'].truePositive,3);
});
test('synthetic, unreviewed or unmatched corpora cannot establish a real 95 percent target',()=>{
 const metrics=evaluatePairs(reference,reference);
 const base={documentId:'d',kind:'real',reference,review:{status:'checked',method:'two-pass-manual'}};
 assert.equal(assessRealTarget({...base,kind:'synthetic'},metrics,{sourceHashesVerified:true}).established,false);
 assert.equal(assessRealTarget({...base,review:{}},metrics,{sourceHashesVerified:true}).established,false);
 assert.equal(assessRealTarget(base,metrics).established,false);
 assert.equal(assessRealTarget(base,metrics,{sourceHashesVerified:true}).established,true);
});
test('a high precision method still fails when too many pairs are omitted',()=>{
 const result=evaluatePairs(reference,[reference[0]]);
 assert.equal(result.precision,1);assert.equal(result.meetsTarget,false);
});
