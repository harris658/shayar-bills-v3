(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  function isValidYMD(year, month, day) {
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
  }

  function parseDate(s) {
    s = String(s || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)))
      return isValidYMD(Number(m[1]), Number(m[2]), Number(m[3])) ? s : null;
    if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)))
      return isValidYMD(Number(m[3]), Number(m[2]), Number(m[1]))
        ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
        : null;
    if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/)))
      return isValidYMD(2000 + Number(m[3]), Number(m[2]), Number(m[1]))
        ? `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
        : null;
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/))) {
      const mo = MON[m[2].toLowerCase()];
      if (mo && isValidYMD(Number(m[3]), Number(mo), Number(m[1])))
        return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

  function parseAmount(s) {
    const cleaned = String(s == null ? '' : s).replace(/[₹,\s]/g, '');
    if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  function applyMapping(rows, mapping) {
    const out = [];
    for (let i = mapping.headerRows || 0; i < rows.length; i++) {
      const r = rows[i];
      const txn_date = parseDate(r[mapping.dateCol]);
      const amount = parseAmount(r[mapping.amountCol]);
      if (!txn_date || !(amount > 0)) continue;
      out.push({
        txn_date, amount,
        ref: String(r[mapping.refCol] == null ? '' : r[mapping.refCol]).trim(),
        description: String(r[mapping.descCol] == null ? '' : r[mapping.descCol]).trim()
      });
    }
    return out;
  }

  const key = (t) => `${t.ref}|${Number(t.amount)}|${t.txn_date}`;
  function dedupe(txns, existing) {
    const seen = new Set(existing.map(key));
    return txns.filter((t) => {
      if (seen.has(key(t))) return false;
      seen.add(key(t));
      return true;
    });
  }

  function fileToRows(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      return file.text().then(parseCSV);
    }
    return file.arrayBuffer().then((buf) => {
      // cellDates+cellText:false+dateNF force date cells to ISO strings.
      // Without them, cells carrying Excel's default date format (real SBI
      // exports do) render as m/d/yy US order, which parseDate misreads as
      // D/M/YY — silently swapping day/month or dropping days > 12.
      const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellText: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
    });
  }

  const MAP_KEY = 'stb.stmt.mapping';
  function saveMapping(m) { try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch (e) {} }
  function loadMapping() {
    try { return JSON.parse(localStorage.getItem(MAP_KEY)) || null; } catch (e) { return null; }
  }

  STB.statement = { parseCSV, parseDate, parseAmount, applyMapping, dedupe,
    fileToRows, saveMapping, loadMapping };
})();
