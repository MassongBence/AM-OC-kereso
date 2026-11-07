/** OCR-only suggestions, never used for typed queries or spreadsheets. Original
 * readings remain visible in review. Suffix digits are never guessed/repaired. */
export function suggestOcrText(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  let text = raw;
  // O and zero are visually ambiguous specifically in a J key's numeric part.
  if (/^J[\s-]*[\dO]{1,4}$/i.test(text)) {
    text = text.replace(/^(J[\s-]*)([\dO]+)$/i, (_, prefix, digits) => prefix + digits.replace(/O/gi, '0'));
  }
  // Restrict repairs to the namespace, never the location's numeric identifier.
  text = text.replace(/\bAM\s*-\s*(?:0OC|O0C|0C)\s*-\s*(\d{1,4})(?![A-Z0-9])/gi, 'AM-OC-$1');
  return {text, reasons: text === raw ? [] : [`OCR-javítási javaslat: „${raw}” → „${text}”. Ellenőrizd a karaktereket!`]};
}

const normalized = value => String(value ?? '').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();

// A confidence value estimates a character reading, not a document's accuracy.
// Consensus across preprocessing/segmentation methods is a conservative gate;
// it remains subject to evaluation on human-labelled, real photographs.
function codeSignature(text) {
  const value = normalized(text);
  const key = value.match(/^J\s*-?\s*(\d{1,4})$/i);
  if (key && Number(key[1]) > 0) return {kind:'key',value:`J${String(Number(key[1])).padStart(3,'0')}`};
  const pattern = /AM\s*-?\s*OC\s*-?\s*(\d{1,4})(?![A-Z0-9])/gi;
  const matches = [...value.matchAll(pattern)];
  if (!matches.length || value.replace(pattern, '').replace(/[,;\s]+/g, '')) return null;
  return {kind:'places',value:[...new Set(matches.map(match=>`AM-OC-${match[1]}`))].sort().join(', ')};
}

/** The line confidence is dictionary-sensitive (e.g. a literal zero may be
 * read as O inside a J identifier). In a detected physical cell, corroborated
 * symbol readings can instead establish the constrained code grammar. This
 * never repairs an AM location's numeric suffix or invents a missing J prefix. */
function constrainedSymbolCode(raw, symbols, boundedCell) {
  if (!boundedCell || !Array.isArray(symbols) || !symbols.length) return null;
  const glyphs=symbols.filter(symbol=>!/^\s*$/.test(String(symbol.text))).map(symbol=>({
    text:normalized(symbol.text).toUpperCase(),confidence:Number(symbol.confidence),
  }));
  if (glyphs.some(glyph=>glyph.text.length!==1 || !Number.isFinite(glyph.confidence))) return null;
  const text=normalized(raw).toUpperCase().replace(/\s/g,'');
  if (glyphs.map(glyph=>glyph.text).join('')!==text) return null;
  if (/^J[0-9O]{1,4}$/.test(text)) {
    if (glyphs[0].confidence<95 || glyphs.slice(1).some(glyph=>glyph.confidence<90)) return null;
    const digits=text.slice(1).replace(/O/g,'0');
    if (!Number(digits)) return null;
    return {kind:'key',value:`J${String(Number(digits)).padStart(3,'0')}`,minimumConfidence:Math.min(...glyphs.map(glyph=>glyph.confidence))};
  }
  const pattern=/AM-?(?:0OC|O0C|OC|0C)-?(\d{1,4})(?![A-Z0-9])/g;
  const matches=[...text.matchAll(pattern)];
  if (!matches.length || text.replace(pattern,'').replace(/[,;]/g,'')) return null;
  const suffixConfidence=[];
  for (const match of matches) {
    const digitStart=match.index+match[0].length-match[1].length;
    const prefix=glyphs.slice(match.index,digitStart);
    // Literal AM and C must be observed. The ambiguous OC namespace is fixed;
    // it is distinct from the numeric identifier that must stay unchanged.
    if (prefix[0]?.text!=='A' || prefix[1]?.text!=='M' || !prefix.some(glyph=>glyph.text==='C')) return null;
    if (prefix.some(glyph=>/[AMC]/.test(glyph.text) && glyph.confidence<95)) return null;
    const digits=glyphs.slice(digitStart,digitStart+match[1].length);
    if (digits.some(glyph=>!/^\d$/.test(glyph.text) || glyph.confidence<95)) return null;
    suffixConfidence.push(...digits.map(glyph=>glyph.confidence));
  }
  return {kind:'places',value:[...new Set(matches.map(match=>`AM-OC-${match[1]}`))].sort().join(', '),minimumConfidence:Math.min(...suffixConfidence)};
}

/** Compare OCR readings without turning a guessed repair into a trusted fact.
 * Hypotheses should use distinct method names (e.g. threshold-line / gray-line).
 * A vote represents a local OCR method, never an independent accuracy benchmark. */
export function selectOcrHypothesis(hypotheses, {minimumConfidence = 88, boundedCell = false} = {}) {
  const readings = hypotheses.map((hypothesis, index) => {
    const raw = normalized(hypothesis.text);
    const suggestion = suggestOcrText(raw);
    const originalCode = codeSignature(raw), code = codeSignature(suggestion.text);
    const opticalCode=constrainedSymbolCode(raw,hypothesis.symbols,boundedCell);
    const confidence = Number.isFinite(hypothesis.confidence) ? hypothesis.confidence : 0;
    return {method:String(hypothesis.method || `method-${index}`),raw,text:suggestion.text,
      confidence,code:code?.value || '',kind:code?.kind || '',
      corrected:Boolean(suggestion.reasons.length),exact:Boolean(originalCode && originalCode.value === code?.value),wordTrusted:Boolean(originalCode && !suggestion.reasons.length && confidence>=minimumConfidence && (!boundedCell || opticalCode?.value===code?.value)),
      variant:String(hypothesis.variant || hypothesis.method || `method-${index}`),
      symbolValidated:Boolean(opticalCode && opticalCode.value===code?.value),symbolConfidence:opticalCode?.minimumConfidence || 0,
      reasons:suggestion.reasons};
  });
  const groups = new Map();
  for (const reading of readings.filter(reading=>reading.code)) {
    const id=reading.kind+':'+reading.code;
    const group=groups.get(id) || []; group.push(reading); groups.set(id,group);
  }
  const ranked=[...groups.values()].sort((a,b)=> {
    const cleanCount=list=>new Set(list.filter(item=>item.wordTrusted).map(item=>item.method)).size;
    return cleanCount(b)-cleanCount(a) || b.length-a.length || Math.max(...b.map(item=>item.confidence))-Math.max(...a.map(item=>item.confidence));
  });
  const chosen=ranked[0] || [];
  const agreeingMethods=[...new Set(chosen.filter(item=>item.wordTrusted).map(item=>item.method))];
  const conflicts=ranked.length>1;
  const opticalSupport=chosen.filter(item=>item.symbolValidated);
  const opticalVariants=[...new Set(opticalSupport.map(item=>item.variant))];
  const symbolConsensus=opticalVariants.includes('threshold') && opticalVariants.includes('gray') && new Set(opticalSupport.map(item=>item.method)).size>=2 && !conflicts;
  const reliable=(agreeingMethods.length>=2 || symbolConsensus) && !conflicts;
  const reading=chosen.sort((a,b)=>Number(a.corrected)-Number(b.corrected)||b.confidence-a.confidence)[0] || [...readings].sort((a,b)=>b.confidence-a.confidence)[0];
  const text=chosen.length ? chosen[0].code : reading?.text || '';
  const reasons=[];
  if (!reliable && chosen.length) {
    reasons.push(conflicts ? 'Az OCR-módszerek eltérő érvényes kódot olvastak; nem megbízható eredmény.' : 'Nincs két magas biztonságú, javítatlan OCR-egyezés.');
    reasons.push(...chosen.flatMap(item=>item.reasons));
  }
  return {text,confidence:symbolConsensus ? Math.min(...opticalSupport.map(item=>item.symbolConfidence)) : chosen.length ? Math.min(...chosen.filter(item=>!reliable || item.wordTrusted).map(item=>item.confidence)) : reading?.confidence || 0,
    reasons:[...new Set(reasons)],evidence:{reliable,agreeingMethods,conflicting:conflicts,symbolConsensus,opticalVariants,
      kind:reading?.kind || '',normalizations:readings.filter(item=>item.corrected).map(item=>({method:item.method,raw:item.raw,text:item.text,reasons:item.reasons})),hypotheses:readings.map(({reasons,...item})=>item)}};
}
