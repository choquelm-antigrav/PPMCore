const { freshCore, test, eq, ok } = require('./harness');
const { makeFakeSheets, parseEntered } = require('./fake_sheets');

module.exports = function () {
  console.log('\nCouche réelle d’accès aux feuilles (faux Google Sheets fidèle aux conversions de saisie)');
  const ME = 'admin@entreprise.com';
  const session = { getActiveUser: () => ({ getEmail: () => ME }), getEffectiveUser: () => ({ getEmail: () => ME }), getScriptTimeZone: () => 'Europe/Paris' };

  /** Un Core qui lit et écrit de VRAIES feuilles (fausses, mais qui convertissent comme Google) au lieu des tables en mémoire. */
  function onSheets() {
    const c = freshCore();
    c.Session = session; c.SpreadsheetApp = makeFakeSheets(); c.TABLE_PROVIDER = null; c._bookCache = {}; c._tableCache = {};
    c.setupPpm();
    return c;
  }
  const inMemory = () => { const c = freshCore(); c.Session = session; return c; };

  test('Le faux Sheets reproduit bien les conversions de Google (sinon les tests suivants ne prouvent rien)', () => {
    eq([parseEntered('1'), parseEntered('1.1'), parseEntered('2.10'), parseEntered('0012')], [1, 1.1, 2.1, 12], 'les nombres écrits comme du texte deviennent des nombres, zéros perdus');
    eq([parseEntered('TRUE'), parseEntered('10%'), parseEntered('=1+1'), parseEntered('=IMPORTXML("x")')], [true, 0.1, 2, '#NAME?'], 'booléens, pourcentages et formules');
    ok(parseEntered('2026-10-05') instanceof Date && parseEntered('2026-11') instanceof Date, 'dates, y compris « mois année »');
    eq([parseEntered("'1.1"), parseEntered("'=x"), parseEntered('texte')], ['1.1', '=x', 'texte'], 'l’apostrophe force le texte et n’est pas gardée');
  });

  test('Textes à risque : écrits puis relus à l’identique (codes de workpackage, formules, booléens, dates)', () => {
    const c = onSheets(), t = c.sheetTable_('WorkPackage');
    const cases = ['1', '1.1', '2.10', '1.10', '10', '0012', '=1+1', '=IMPORTXML("http://x")', '+5', '-x', '@a', 'TRUE', 'false', '10%', '.5', '2026-10-05', '2026-11', '1/2', "'déjà", "l'apostrophe", 'texte normal', 'é€😀'];
    cases.forEach((v, i) => t.appendRows([{ id: 'wp' + i, project_id: 'p', wbs_code: v, name: v, charge_code: v, cpn: v, cpn_label: v }]));
    const back = t.readAll();
    cases.forEach((v, i) => {
      const r = back.find((x) => x.id === 'wp' + i);
      eq([r.wbs_code, r.name, r.charge_code, r.cpn, r.cpn_label], [v, v, v, v, v], 'relu à l’identique : ' + JSON.stringify(v));
      ok(typeof r.wbs_code === 'string', 'et du texte : ' + JSON.stringify(v));
    });
    ok(new Set(back.map((r) => r.wbs_code)).size === cases.length, 'aucune collision : « 2.10 » et « 2.1 », « 1.10 » et « 1.1 » restent distincts');
    ok(!back.some((r) => /^#/.test(r.name)), 'aucune formule n’a été exécutée (une cellule « =… » reste du texte)');
  });

  test('Mises à jour et recherche d’une ligne : le texte à risque survit aux réécritures', () => {
    const c = onSheets(), t = c.sheetTable_('WorkPackage');
    t.appendRows([{ id: 'a1', project_id: 'p', wbs_code: '1.10', name: 'Lot' }, { id: 'a2', project_id: 'p', wbs_code: '2', name: 'Autre' }]);
    const r = t.findRow('a2');
    ok(r > 0, 'la ligne se retrouve par son identifiant');
    t.writeRow(r, Object.assign(t.readRow(r), { wbs_code: '3.10' }));
    t.updateRows([{ row: t.findRow('a1'), obj: Object.assign(t.readRow(t.findRow('a1')), { name: '=A1' }) }]);
    eq([t.readRow(t.findRow('a2')).wbs_code, t.readRow(t.findRow('a1')).name, t.readRow(t.findRow('a1')).wbs_code], ['3.10', '=A1', '1.10'], 'réécrit sans altération');
  });

  test('Les colonnes numériques, booléennes et de dates gardent leur type', () => {
    const c = onSheets(), t = c.sheetTable_('PlanItem');
    t.appendRows([{ id: 'i1', project_id: 'p', wp_id: 'w', item_type: 'Livrable', name: 'X', planned_start: '2026-10-05', planned_finish: '2026-10-09', progress_pct: 40, status: 'À faire', deleted: false, version: 3 }]);
    const r = t.readAll()[0];
    eq([r.progress_pct, typeof r.progress_pct, r.planned_start, r.planned_finish, r.deleted, r.version], [40, 'number', '2026-10-05', '2026-10-09', false, 3], 'nombre, dates normalisées en texte, booléen');
    const rc = c.sheetTable_('Resource'); rc.appendRows([{ id: 'r1', resource_type: 'Interne', name: 'Zoé', daily_rate: 650, capacity_days_month: 18 }]);
    eq([rc.readAll()[0].daily_rate, rc.readAll()[0].capacity_days_month], [650, 18], 'taux et capacité restent des nombres');
  });

  test('Anciennes cellules : un code devenu nombre avant la protection est relu comme du texte', () => {
    const c = onSheets(), t = c.sheetTable_('WorkPackage'), sh = c.SpreadsheetApp.books['fake-book-1'].getSheetByName('WorkPackage');
    const headers = t.headers(), row = sh.getLastRow() + 1;
    const put = (col, v) => sh.getRange(row, headers.indexOf(col) + 1, 1, 1).setValues([[v]]);
    put('id', 'legacy'); put('wbs_code', 1.1); put('name', 12); put('charge_code', true);
    const r = t.readAll().find((x) => x.id === 'legacy');
    eq([r.wbs_code, r.name, r.charge_code], ['1.1', '12', 'TRUE'], 'nombres et booléens redevenus du texte (le zéro perdu de « 2.10 » ne se retrouve pas)');
  });

  test('Toute la démo sur la couche réelle donne EXACTEMENT les mêmes données qu’en mémoire (aucun type ne dérive)', () => {
    const sheets = onSheets(); sheets.DEMO_BUDGET_MS = 1e9;
    const msg = sheets.seedDemo_();
    ok(/^Démo complète/.test(msg), msg);
    const mem = inMemory(); mem.DEMO_BUDGET_MS = 1e9; mem.seedRoles_(); const y = Number(mem.todayStr().slice(0, 4)); mem.seedHolidays_([y - 1, y, y + 1, y + 2]); mem.seedDemo_();
    const strip = (r) => { const o = {}; Object.keys(r).forEach((k) => { if (k === 'id' || k === 'version' || /(created|updated)_at$/.test(k)) return; o[k] = r[k]; }); return o; };
    const norm = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'TS');
    const differing = [];
    Object.keys(mem.SCHEMA).forEach((tb) => {
      const a = mem.repoList(tb, null, { includeDeleted: true }), b = sheets.repoList(tb, null, { includeDeleted: true });
      if (a.length !== b.length) { differing.push(tb + ' : ' + a.length + ' lignes en mémoire, ' + b.length + ' sur la couche réelle'); return; }
      const key = (r) => norm(JSON.stringify(strip(r))), A = a.map(key).sort(), B = b.map(key).sort();
      const bad = A.filter((x, i) => x !== B[i]).length;
      if (bad && tb !== '_Snapshot') differing.push(tb + ' : ' + bad + ' ligne(s) différente(s)'); // _Snapshot.hash dérive d'identifiants aléatoires
    });
    eq(differing, [], 'tables différentes entre la mémoire et la couche réelle');
    const wps = sheets.repoList('WorkPackage'), items = sheets.repoList('PlanItem');
    ok(wps.length >= 20 && wps.every((w) => typeof w.wbs_code === 'string') && items.length >= 70, wps.length + ' workpackages, ' + items.length + ' livrables et jalons, codes en texte');
    ok(['1', '1.1', '2.2'].every((code) => wps.some((w) => w.wbs_code === code)), 'les codes « 1 », « 1.1 » et « 2.2 » existent en texte');
  });

  test('Sur la couche réelle, l’Overview de chaque projet de la démo a ses livrables, ses jalons et ses alertes', () => {
    const c = onSheets(); c.DEMO_BUDGET_MS = 1e9; c.seedDemo_();
    const call = (a, p) => { const r = c.handleRequest({ action: a, params: p, apiVersion: c.PPM_API_VERSION }, ME); if (!r.ok) throw new Error(a + ' ' + JSON.stringify(r.error)); return r.data; };
    const nac1 = c.repoList('Project').find((p) => p.code === 'NAC-1'), o = call('overview.get', { projectId: nac1.id });
    ok(o.detail.alerts.length >= 3 && o.detail.milestones.length >= 2, 'NAC-1 : ' + o.detail.alerts.length + ' alertes, ' + o.detail.milestones.length + ' jalons à venir');
    const w = call('wbs.tree', { projectId: nac1.id });
    ok(w.nodes.filter((n) => n.kind === 'wp').length >= 10 && w.nodes.filter((n) => n.kind === 'item').length >= 30, 'le découpage de NAC-1 est complet : ' + w.nodes.length + ' nœuds');
    const g = call('gantt.project', { projectId: nac1.id });
    ok(g.rows.length >= 40 && g.dependencies.length >= 20, 'le Gantt de NAC-1 a ses lignes datées et ses dépendances : ' + g.rows.length + ' lignes, ' + g.dependencies.length + ' dépendances');
  });

  test('A8 : écriture de textes à risque dans une feuille temporaire, relue, comparée puis supprimée', () => {
    const c = onSheets(), book = c.SpreadsheetApp.books['fake-book-1'];
    const counts = () => JSON.stringify(book.getSheets().map((sh) => [sh.name, sh.getLastRow()]));
    const before = counts();
    const msg = c.A8_VERIFIER_ECRITURE();
    ok(/^A8 — écriture dans Google Sheets \(feuille temporaire, supprimée\) : OK, \d+ contrôles, aucun cas altéré\./.test(msg), msg.split('\n')[0]);
    ok(/✓ "2\.10"/.test(msg) && /✓ "=1\+1"/.test(msg) && /✓ "TRUE"/.test(msg) && /ancienne cellule numérique 1,1 relue comme texte « 1\.1 »/.test(msg) && !/✗/.test(msg), 'chaque cas à risque est contrôlé et réussi');
    eq(book.getSheetByName('_ppm_test_ecriture'), null, 'la feuille temporaire est supprimée');
    eq(counts(), before, 'aucune donnée réelle touchée : mêmes feuilles, mêmes nombres de lignes');
  });

  test('A8 : il détecte une protection absente, nettoie même après une erreur, et signale une colonne au format « texte brut »', () => {
    const faulty = onSheets(); ['wbs_code', 'name', 'charge_code', 'cpn'].forEach((k) => { faulty.SHEET_PARSED_COLS[k] = true; }); // simule une couche qui laisse Sheets interpréter
    const m = faulty.A8_VERIFIER_ECRITURE();
    ok(/^A8 — .* : ÉCHEC, \d+ cas altéré\(s\)\./.test(m) && /✗ "2\.10" relu 2\.1 \(number\)/.test(m) && /✗ "=1\+1" relu 2/.test(m), m.split('\n').slice(0, 3).join(' | '));
    eq(faulty.SpreadsheetApp.books['fake-book-1'].getSheetByName('_ppm_test_ecriture'), null, 'même en échec, la feuille temporaire est supprimée');
    const boom = onSheets(); boom.sheetTableOn_ = () => { throw new Error('panne simulée'); };
    let err; try { boom.A8_VERIFIER_ECRITURE(); } catch (e) { err = e; }
    ok(err && /panne simulée/.test(err.message) && boom.SpreadsheetApp.books['fake-book-1'].getSheetByName('_ppm_test_ecriture') === null, 'une erreur en cours de route ne laisse aucune feuille temporaire');
    const left = onSheets(), bk = left.SpreadsheetApp.books['fake-book-1'];
    bk.insertSheet('_ppm_test_ecriture').getRange(1, 1, 1, 1).setValues([['reste d’un essai interrompu']]);
    ok(/OK/.test(left.A8_VERIFIER_ECRITURE().split('\n')[0]) && bk.getSheetByName('_ppm_test_ecriture') === null, 'un reste d’essai interrompu est remplacé puis supprimé');
    const fmt = onSheets(), shw = fmt.SpreadsheetApp.books['fake-book-1'].getSheetByName('WorkPackage');
    Object.getPrototypeOf(shw.getRange(1, 1)).getNumberFormat = function () { return this.sh.fmt.get(this.sh.key(this.r, this.c)) || 'General'; };
    shw.getRange(2, fmt.tableColumns('WorkPackage').indexOf('wbs_code') + 1, 1, 1).setNumberFormat('@');
    ok(/⚠ La colonne wbs_code de la feuille WorkPackage est au format « Texte brut »/.test(fmt.A8_VERIFIER_ECRITURE().split('\n')[0]), 'colonne réelle au format texte brut : avertissement clair');
  });
};
