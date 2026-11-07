import {normalizeKey} from './table-core.js';

const clean=value=>String(value??'').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-').trim();
const label=value=>clean(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const keyHeader=value=>/^(?:j|jkod|jcode|jszam)$/.test(label(value));
const nonKeyHeader=value=>/^(?:mennyiseg|darab|db|darabszam|helyekszama|sorszam|quantity|count|amount|index|ordinal|no|nr)$/.test(label(value));
const placeHeader=value=>/^(?:amoc|amochely|amochelyek|amoclocation|amoclocations|hely|helyek|location|locations)$/.test(label(value));
const explicitKey=value=>/^J\s*-?\s*\d{1,4}$/i.test(clean(value)) ? normalizeKey(value) : '';
const unique=values=>[...new Set(values)];
const digitalPlaces=value=>unique([...clean(value).matchAll(/(?:^|[^A-Z0-9])AM\s*-?\s*OC\s*-?\s*(\d{1,4})(?![A-Z0-9?_])/gi)].map(match=>`AM-OC-${match[1]}`));

function inlineKeys(value){
 return unique([...clean(value).matchAll(/(?:^|[^A-Z0-9])J\s*-?\s*(\d{1,4})(?![A-Z0-9])/gi)].map(match=>normalizeKey(match[1])).filter(Boolean));
}
function malformedPlace(value){
 const text=clean(value), markers=[...text.matchAll(/(?:^|[^A-Z0-9])AM\s*-?\s*OC(?:\s*-?)/gi)].length;
 const full=[...text.matchAll(/(?:^|[^A-Z0-9])AM\s*-?\s*OC\s*-?\s*\d{1,4}(?![A-Z0-9?_])/gi)].length;
 return markers>full;
}
function expandedRows(sheet){
 const input=sheet.rows||[],merges=sheet.merges||[];
 if(!Array.isArray(input)||input.length>30000||!Array.isArray(merges)||merges.length>30000)throw new Error('Túl nagy vagy hibás digitális táblázat.');
 const width=Math.max(0,...input.map(row=>Array.isArray(row)?row.length:0));
 if(width>200||input.length*width>1000000)throw new Error('Túl nagy digitális táblázat.');
 const rows=input.map(row=>Array.from(row||[],clean)),occupied=new Set();
 for(const merge of merges){
  if(!merge?.s||!merge?.e||![merge.s.r,merge.s.c,merge.e.r,merge.e.c].every(Number.isInteger)||merge.s.r<0||merge.s.c<0||merge.e.r<merge.s.r||merge.e.c<merge.s.c||merge.e.r>=30000||merge.e.c>=200)throw new Error('Hibás összevont digitális cella.');
  const value=rows[merge.s.r]?.[merge.s.c]||'';
  const data=Boolean(normalizeKey(value)||digitalPlaces(value).length||inlineKeys(value).length);
  for(let r=merge.s.r;r<=Math.min(merge.e.r,rows.length-1);r++)for(let c=merge.s.c;c<=Math.min(merge.e.c,width-1);c++){
   const id=r*200+c;if(occupied.has(id))throw new Error('Átfedő összevont digitális cellák.');occupied.add(id);
   // Covered values are not visible Excel cells. Only the anchor column carries
   // a vertical merge; horizontal merges never manufacture additional key columns.
   rows[r][c]=(c===merge.s.c&&(r===merge.s.r||data))?value:'';
  }
 }
 return rows;
}
function headerSchema(row){
 const keys=[],places=[];row.forEach((value,col)=>{if(keyHeader(value))keys.push(col);if(placeHeader(value))places.push(col);});
 if(!keys.length||!places.length)return null;
 const roles=[...keys.map(col=>({col,kind:'key'})),...places.map(col=>({col,kind:'place'}))].sort((a,b)=>a.col-b.col);
 const forward=roles[0].kind==='key';
 const groups=[];let group=-1,previous=-2;
 for(let c=0;c<row.length;c++)if(row[c]){if(c>previous+1)group++;groups[c]=group;previous=c;}
 const owners=new Map();
 for(const col of places){
  let choices=keys.filter(key=>groups[key]===groups[col]);if(!choices.length)choices=keys;
  if(choices.length===1){owners.set(col,choices[0]);continue;}
  const direction=choices.filter(key=>forward?key<col:key>col).sort((a,b)=>forward?b-a:a-b);
  owners.set(col,direction[0]??null);
 }
 return{keys,places,owners};
}
function sourceLocation(source,name,row,keyColumn,locationColumn){
 return {source:source?`${source} · ${name}`:name,row:row+1,provenance:[{sheet:name,row:row+1,keyColumn:keyColumn+1,locationColumn:locationColumn+1}]};
}
function candidate(key,loc,context,reasons=[],extra={}){
 return{key,loc,...context,inputKind:'spreadsheet',uncertain:reasons.length>0,reasons,...extra};
}
function deduplicate(records){
 const result=new Map();let duplicates=0;
 for(const row of records){
  const id=`${row.key}\0${row.loc}`;
  if(!result.has(id)){result.set(id,row);continue;}
  duplicates++;const prior=result.get(id),provenance=[...prior.provenance,...row.provenance];
  const incomplete=prior.incomplete||row.incomplete;
  const affectedKeys=unique([...(prior.affectedKeys||[]),...(row.affectedKeys||[])]);
  const chosen=!row.uncertain&&prior.uncertain&&!incomplete?row:prior;
  result.set(id,{...chosen,provenance,uncertain:incomplete||Boolean(prior.uncertain&&row.uncertain),
   reasons:incomplete?unique([...prior.reasons,...row.reasons]):chosen.uncertain?unique([...prior.reasons,...row.reasons]):[],
   ...(affectedKeys.length?{affectedKeys}:{}),
   ...(incomplete?{incomplete:true}:{})});
 }
 return{records:[...result.values()],duplicates};
}

/** Digital workbook parsing has no OCR confidence model. A complete mapping is
 * established by cell values, declared headers and merges, then deduplicated.
 * Genuinely missing/ambiguous structure remains explicit rather than guessed. */
export function parseSpreadsheet(sheets,{source=''}={}){
 if(!Array.isArray(sheets)||sheets.length>100)throw new Error('Hibás vagy túl nagy munkafüzet.');
 const records=[],diagnostics=[],warnings=[];
 for(let sn=0;sn<sheets.length;sn++){
  const sheet=sheets[sn],name=String(sheet.name||`Munkalap ${sn+1}`),rows=expandedRows(sheet);
  const explicitColumns=new Set(),declaredColumns=new Set(),numericColumns=new Set();
  let hasPlaces=false;
  rows.forEach(row=>row.forEach((value,col)=>{
   if(explicitKey(value))explicitColumns.add(col);if(keyHeader(value))declaredColumns.add(col);
   if(normalizeKey(value)&&!explicitKey(value))numericColumns.add(col);
   if(digitalPlaces(value).length||(malformedPlace(value)&&!placeHeader(value)))hasPlaces=true;
  }));
  const diagnostic={sheet:name,rows:rows.length,mode:'ignored',rawCandidates:0,ignoredLocationCells:0,headerRows:[]};
  const hasInline=rows.some(row=>row.some(value=>inlineKeys(value).length&&digitalPlaces(value).length));
  if(!hasPlaces||(!explicitColumns.size&&!declaredColumns.size&&!numericColumns.size&&!hasInline)){
   diagnostic.reason=hasPlaces?'Nincs J-kódos adatkapcsolat; kiegészítő helylista kihagyva.':'Nincs AM–OC adatkapcsolat.';
   diagnostics.push(diagnostic);if(hasPlaces)warnings.push(`${name}: ${diagnostic.reason}`);continue;
  }
  let schema=null;
  const keyColumns=new Set([...explicitColumns,...declaredColumns]);
  const inferredNumeric=!keyColumns.size;
  const fallbackKeys=inferredNumeric?new Set([...numericColumns].filter(col=>!rows.some(row=>nonKeyHeader(row[col])))):keyColumns;
  const actualDeclared=[...declaredColumns].some(col=>rows.some(row=>normalizeKey(row[col])||inlineKeys(row[col]).length));
  if((inferredNumeric&&!fallbackKeys.size&&!hasInline)||(!inferredNumeric&&!explicitColumns.size&&!actualDeclared&&!hasInline)){
   diagnostic.reason='Nincs kitöltött J-kódos adatkapcsolat; kiegészítő helylista kihagyva.';diagnostics.push(diagnostic);warnings.push(`${name}: ${diagnostic.reason}`);continue;
  }
  const start=records.length;
  for(let r=0;r<rows.length;r++){
   const row=rows[r],header=headerSchema(row);
   const hasCurrentData=schema&&(schema.keys.some(col=>normalizeKey(row[col])||inlineKeys(row[col]).length)||schema.places.some(col=>digitalPlaces(row[col]).length));
   if(header&&!hasCurrentData){schema=header;diagnostic.headerRows.push(r+1);continue;}
   const roleKeys=schema?.keys||[...fallbackKeys];
   const validKeys=roleKeys.map(col=>({col,key:normalizeKey(row[col]),inline:inlineKeys(row[col])})).filter(item=>item.key);
   const ownedPlaces=schema?.places||row.map((_,col)=>col);
   const inlineConsumed=new Set();
   // A direct "J001 → AM-OC-429" digital cell is structurally self-contained.
   for(let c=0;c<row.length;c++){
    const keys=inlineKeys(row[c]),places=digitalPlaces(row[c]);if(!keys.length||!places.length)continue;
    if(schema&&!schema.keys.includes(c)&&!schema.places.includes(c))continue;
    const remainder=clean(row[c]).replace(/(?:^|[^A-Z0-9])J\s*-?\s*\d{1,4}(?![A-Z0-9])/gi,'').replace(/(?:^|[^A-Z0-9])AM\s*-?\s*OC\s*-?\s*\d{1,4}(?![A-Z0-9])/gi,'').replace(/[\s,;:=→|/]+/g,'');
    const reasons=keys.length===1?[]:['A digitális cellában több J-kód szerepel; nincs egyértelmű párosítás.'];
    if(remainder)reasons.push('Vegyes leíró szöveg a digitális cellában; nincs igazolt önálló adatpár.');
    if(malformedPlace(row[c]))reasons.push('Hibás vagy hiányos AM–OC kód a digitális cellában.');
    for(const loc of places)records.push(candidate(keys.length===1?keys[0]:'',loc,sourceLocation(source,name,r,c,c),reasons,{...(malformedPlace(row[c])?{incomplete:true}:{}),...(keys.length>1?{affectedKeys:keys}:{})}));
    inlineConsumed.add(c);
   }
   for(let c=0;c<row.length;c++){
    if(inlineConsumed.has(c))continue;
    const places=digitalPlaces(row[c]),malformed=malformedPlace(row[c]);if(!places.length&&!malformed)continue;
    if(!ownedPlaces.includes(c)){if(places.length)diagnostic.ignoredLocationCells++;continue;}
    const leftKeys=validKeys.filter(item=>item.col<c);
    let owner=schema?schema.owners.get(c):inferredNumeric?(leftKeys.length===1?leftKeys[0].col:undefined):leftKeys.at(-1)?.col;
    const key=owner===undefined||owner===null?'':normalizeKey(row[owner]);
    const ambiguousKeys=owner===undefined||owner===null?[]:inlineKeys(row[owner]);
    const reasons=[];
    if(!key)reasons.push(ambiguousKeys.length>1?'Több J-kód egy digitális kulcscellában.':'Hiányzó J-cellához tartozó digitális helyadat; nincs automatikus továbbörökítés.');
    if(inferredNumeric&&!schema)reasons.push('A számadat J-kód szerepe nincs oszlopfejléccel vagy J-jelöléssel igazolva.');
    if(malformed)reasons.push('Hibás vagy hiányos AM–OC kód a digitális helycellában.');
    const context=sourceLocation(source,name,r,owner??c,c);
    const extras={...(malformed?{incomplete:true}:{}),...(inferredNumeric&&!schema?{unlabelledNumeric:true}:{}),...(ambiguousKeys.length>1?{affectedKeys:ambiguousKeys}:{})};
    if(places.length)for(const loc of places)records.push(candidate(key,loc,context,reasons,extras));
    else if(key)records.push(candidate(key,'',context,reasons,{...extras,incomplete:true}));
   }
  }
  diagnostic.mode=diagnostic.headerRows.length?'header-defined':inferredNumeric?'unlabelled-numeric':'explicit-key-column';
  diagnostic.rawCandidates=records.length-start;diagnostics.push(diagnostic);
 }
 // An unlabelled numeric auxiliary sheet must not reinterpret counts/serials
 // as J identifiers and thereby quarantine a validated mapping on another sheet.
 // A standalone unidentified numeric table is still reported as structural
 // uncertainty; with a validated table present it stays an ignored worksheet.
 const validatedTable=records.some(row=>row.uncertain===false&&!row.unlabelledNumeric);
 let selected=records;
 if(validatedTable){
  const excluded=new Set(records.filter(row=>row.unlabelledNumeric).map(row=>row.provenance[0].sheet));
  selected=records.filter(row=>!row.unlabelledNumeric);
  for(const name of excluded){const d=diagnostics.find(item=>item.sheet===name);if(d){d.mode='ignored';d.reason='A fejléc nélküli számadatok J-kód szerepe nem igazolt; kiegészítő lap kihagyva.';}warnings.push(`${name}: ${d?.reason||'Nem igazolt számadatok kihagyva.'}`);}
 }
 const combined=deduplicate(selected);
 return{records:combined.records,diagnostics,warnings,duplicatePairs:combined.duplicates};
}
