// Legacy XLS and XLSX parsing is isolated from the UI realm. No workbook HTML,
// formulas, hyperlinks or objects are executed; only bounded arrays of text leave
// this short-lived worker. The caller terminates it on completion or timeout.
importScripts('../vendor/xlsx.full.min.js');
self.onmessage = event => {
  try {
    const workbook = XLSX.read(event.data, {type:'array', dense:true, cellFormula:false, cellHTML:false, cellStyles:false});
    if (workbook.SheetNames.length > 100) throw new Error('Túl sok munkalap (maximum 100).');
    const sheets = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      if (range.e.r > 30000 || range.e.c > 200 || (range.e.r + 1) * (range.e.c + 1) > 1000000) throw new Error('A munkalap túl nagy: ' + name);
      const merges = (sheet['!merges'] || []).map(({s,e}) => {
        if (e.r > 30000 || e.c > 200 || s.r < 0 || s.c < 0) throw new Error('Túl nagy vagy hibás cellaösszevonás.');
        return {s:{r:s.r,c:s.c},e:{r:e.r,c:e.c}};
      });
      return {name, merges, rows:XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:true,range:0}).map(row => row.map(value => String(value ?? '')))};
    });
    self.postMessage({sheets});
  } catch(error) { self.postMessage({error:error.message}); }
};
