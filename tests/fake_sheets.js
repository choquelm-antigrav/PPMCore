/**
 * Faux Google Sheets pour tester la VRAIE couche d'accès aux feuilles (sheetTable_), que le banc d'essai contourne d'habitude avec des
 * tables en mémoire. Il reproduit ce que Sheets fait de ce qu'on écrit avec setValues, comme une saisie au clavier :
 *   - « 1 », « 1.1 », « 2.10 », « 0012 » deviennent des NOMBRES (1, 1.1, 2.1, 12) : « 2.10 » et « 2.1 » se confondent ;
 *   - « 10 % » devient 0,1 ; « TRUE » devient un booléen ; « 2026-10-05 » et « 2026-11 » deviennent des DATES ;
 *   - un texte qui commence par « = » devient une FORMULE (évaluée) ;
 *   - une apostrophe au début force le texte et n'est pas conservée ; un format « @ » sur la cellule fait de même.
 * Les nombres, booléens et dates écrits comme tels restent ce qu'ils sont.
 * Tout ce qui n'est pas simulé (mise en forme, validation…) est accepté sans effet.
 */
function parseEntered(v) {
  if (typeof v !== 'string') return v === null || v === undefined ? '' : v;
  if (v === '') return '';
  if (v[0] === "'") return v.slice(1);
  if (v[0] === '=') {
    if (/^=[\d+\-*\/().\s]+$/.test(v)) { try { return Function('"use strict"; return (' + v.slice(1) + ');')(); } catch (e) { return '#ERROR!'; } }
    return '#NAME?';
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[+-]?\d+(\.\d+)?%$/.test(v)) return Number(v.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(v)) return v.toUpperCase() === 'TRUE';
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return d; return v; }
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m && +m[2] >= 1 && +m[2] <= 12) return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(v);
  if (m) { const d = new Date(v); if (!isNaN(d.getTime())) return d; }
  return v;
}

function makeFakeSheets() {
  const books = {};
  let seq = 0;
  const noop = () => proxy();
  const proxy = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => proxy() });

  class Sheet {
    constructor(name) { this.name = name; this.cells = new Map(); this.fmt = new Map(); this.maxRows = 1000; this.maxCols = 26; this.stats = { reads: 0, writes: 0 }; }
    key(r, c) { return r + ',' + c; }
    getName() { return this.name; }
    getLastRow() { let m = 0; this.cells.forEach((v, k) => { if (v !== '' && v !== null) m = Math.max(m, +k.split(',')[0]); }); return m; }
    getLastColumn() { let m = 0; this.cells.forEach((v, k) => { if (v !== '' && v !== null) m = Math.max(m, +k.split(',')[1]); }); return m; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertColumnsAfter(after, n) { this.maxCols += n; }
    setFrozenRows() {}
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    appendRow(values) { const r = this.getLastRow() + 1; this.getRange(r, 1, 1, values.length).setValues([values]); }
  }

  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    getRow() { return this.r; }
    getColumn() { return this.c; }
    getNumRows() { return this.nr; }
    getNumColumns() { return this.nc; }
    getValues() {
      this.sh.stats.reads++;
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = this.sh.cells.get(this.sh.key(this.r + i, this.c + j)); row.push(v === undefined || v === null ? '' : v); } out.push(row); }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vs) {
      this.sh.stats.writes++;
      for (let i = 0; i < vs.length; i++) {
        for (let j = 0; j < vs[i].length; j++) {
          const r = this.r + i, c = this.c + j, k = this.sh.key(r, c);
          if (r > this.sh.maxRows) this.sh.maxRows = r + 100;
          if (c > this.sh.maxCols) this.sh.maxCols = c;
          const v = vs[i][j];
          this.sh.cells.set(k, this.sh.fmt.get(k) === '@' ? (v === null || v === undefined ? '' : v) : parseEntered(v));
        }
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.cells.delete(this.sh.key(this.r + i, this.c + j)); return this; }
    setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.fmt.set(this.sh.key(this.r + i, this.c + j), f); return this; }
    createTextFinder(text) {
      const self = this; let entire = false;
      const f = {
        matchEntireCell(b) { entire = !!b; return f; },
        findNext() {
          for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) {
            const v = self.sh.cells.get(self.sh.key(self.r + i, self.c + j));
            if (v !== undefined && v !== '' && (entire ? String(v) === text : String(v).indexOf(text) >= 0)) return new Range(self.sh, self.r + i, self.c + j, 1, 1);
          }
          return null;
        }
      };
      return f;
    }
    setFontWeight() { return this; }
    setDataValidation() { return this; }
  }

  class Spreadsheet {
    constructor(title) { this.id = 'fake-book-' + (++seq); this.title = title; this.sheets = [new Sheet('Feuille 1')]; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getName() { return this.title; }
    setSpreadsheetTimeZone() { return this; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  }

  const app = {
    create: (title) => { const b = new Spreadsheet(title); books[b.id] = b; return b; },
    openById: (id) => { if (!books[id]) throw new Error('Spreadsheet introuvable : ' + id); return books[id]; },
    newDataValidation: noop,
    books
  };
  return app;
}

module.exports = { makeFakeSheets, parseEntered };
