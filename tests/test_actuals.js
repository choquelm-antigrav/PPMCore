const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');

module.exports = function () {
  console.log('\nRéalisé comptable : import mensuel de l’onglet « CUC Total Cost », par équipe et par mois (0.20.1)');
  const CP = 'carla@entreprise.com', ADMIN = 'admin@entreprise.com', DPL = 'dora@entreprise.com';

  /** Projet P1 (CPN-100), workpackage 2 (CPN-200) ; équipes 1vm ⊃ 1vmd et Zeta (centre de coût GRP-9) ; exercice 2026 en exécution ; aujourd'hui : 5 octobre 2026. */
  function world() {
    const w = lot2World();
    w.c.SpreadsheetApp = makeFakeSheets();
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'Nacelle' });
    w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-200', cpn_label: 'Essais' } });
    w.vm = w.call(CP, 'teams.create', { values: { name: '1vm' } });
    w.vmd = w.call(CP, 'teams.create', { values: { name: '1vmd', parent_team_id: w.vm.id } });
    w.zeta = w.call(CP, 'teams.create', { values: { name: 'Zeta', cost_center: 'GRP-9' } });
    const e0 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    /** Un classeur de la finance : 2 lignes de titre, l'en-tête en ligne 3, 30 colonnes ; J, L, T, U, W. */
    w.book = (rows, opts) => {
      const o = Object.assign({ sheet: 'CUC Total Cost' }, opts || {});
      const ss = w.c.SpreadsheetApp.create('Actuals ' + (w.n = (w.n || 0) + 1)), sh = ss.insertSheet(o.sheet);
      const grid = [['Extraction finance'], ['Période'], Array.from({ length: 30 }, (_, i) => i === 9 ? 'WBS élément' : i === 11 ? 'cost center group' : i === 19 ? 'Month' : i === 20 ? 'Year' : i === 22 ? 'Actuals' : 'col' + i)];
      if (o.header === false) grid.pop();
      rows.forEach((r) => { const line = Array.from({ length: 30 }, () => ''); line[9] = r[0]; line[11] = r[1]; line[19] = r[2]; line[20] = r[3]; line[22] = r[4]; grid.push(line); });
      sh.getRange(1, 1, grid.length, 30).setValues(grid.map((g) => g.length === 30 ? g : g.concat(Array.from({ length: 30 - g.length }, () => ''))));
      return ss.getId();
    };
    w.analyze = (id, who) => w.raw(who || ADMIN, 'actuals.import.analyze', { book: id });
    w.run = (id, extra, who) => w.raw(who || ADMIN, 'actuals.import.run', Object.assign({ book: id }, extra || {}));
    w.lines = () => w.c.repoList('ActualLine');
    return w;
  }
  const ROWS = [
    ['CPN-100', '1vm', 'mars', 2026, 1000], ['CPN-100', '1vm', 3, 2026, 500],            // même clé : 1 500
    ['CPN-100', 'GRP-9', '03', 2026, '200,50'],                                          // l'équipe se retrouve par son centre de coût
    ['CPN-200', '1vm', 'Apr', 2026, '1 300'],                                            // le CPN d'un workpackage rattache au projet
    ['CPN-100', '1vmd', 'avr.', 2026, 400],                                              // une équipe à 4 caractères
    ['CPN-100', 'Inconnue', 3, 2026, 50],                                                // équipe inconnue
    ['', '', '', '', ''],                                                                // ligne vide
    ['CPN-999', '1vm', 3, 2026, 7000],                                                   // CPN inconnu
    ['CPN-100', '1vm', 'xx', 2026, 10], ['CPN-100', '1vm', 3, 2026, 'n/a']
  ];

  test('Lecture des cellules : mois (nombre, nom français ou anglais, date), année, montant signé', () => {
    const c = world().c;
    eq(['mars', 'Mar', '03', 3, 'févr.', 'DÉC', 'sept', new Date(2026, 5, 15), '13', 'x', ''].map((v) => c.actualsMonth_(v)), [3, 3, 3, 3, 2, 12, 9, 6, null, null, null], 'le mois');
    eq([2026, '2026', ' 2026 ', 1999, 'abc'].map((v) => c.actualsYear_(v)), [2026, 2026, 2026, null, null], 'l’année');
    eq([12345.5, '12 345,67', '(300)', '-5', '1\u00a0000', '€ 5', 'abc', ''].map((v) => c.actualsAmount_(v)), [12345.5, 12345.67, -300, -5, 1000, 5, null, null], 'le montant (un avoir est négatif, le signe € est ignoré)');
  });

  test('Analyse : cumul par CPN, équipe et mois ; rattachement au projet par le CPN du projet ou d’un workpackage, à l’équipe par son nom ou son centre de coût ; tout ce qui ne l’est pas est signalé', () => {
    const w = world(), r = w.analyze(w.book(ROWS));
    ok(r.ok, JSON.stringify(r.error));
    const d = r.data;
    eq([d.header_row, d.rows_read, d.rows_ignored, d.rows_blank, d.counts, d.months, d.total], [3, 7, 2, 1, { create: 5, update: 0, same: 0 }, { from: '2026-03', to: '2026-04' }, 3450.5], 'sept lignes lues (dont un CPN inconnu), deux ignorées (mois, montant), une vide ; cinq lignes de réalisé à créer ; de mars à avril');
    eq(d.unknown_cpn, [{ cpn: 'CPN-999', rows: 1, ambiguous: false }], 'le CPN inconnu est nommé');
    eq(d.unknown_team, [{ team: 'Inconnue', rows: 1 }], 'l’équipe inconnue aussi');
    ok(d.warnings.some((x) => /CPN-999/.test(x)) && d.warnings.some((x) => /Inconnue/.test(x)) && d.warnings.some((x) => /2 ligne\(s\) ignorée\(s\)/.test(x)), 'les avertissements : ' + d.warnings.join(' | '));
    eq(w.lines().length, 0, 'l’analyse n’écrit rien');
    eq(w.analyze(w.book(ROWS), 'carla@entreprise.com').error.code, 'FORBIDDEN', 'et elle est réservée à l’administrateur (comme l’import)');
  });

  test('Structure du fichier : onglet absent, en-têtes absents, classeur vide', () => {
    const w = world();
    ok(/Onglet « CUC Total Cost » introuvable/.test(w.analyze(w.book(ROWS, { sheet: 'Autre' })).error.message), 'onglet absent');
    ok(/En-têtes introuvables/.test(w.analyze(w.book(ROWS, { header: false })).error.message), 'en-têtes absents : la colonne J doit s’appeler « WBS élément »');
    const none = w.analyze(w.book([['CPN-999', '1vm', 3, 2026, 5]]));
    ok(none.ok && none.data.ok === false && /Aucune ligne exploitable/.test(none.data.errors[0].message), 'aucun CPN connu : rien d’exploitable, et on le dit');
    eq(w.run(w.book([['CPN-999', '1vm', 3, 2026, 5]])).error.code, 'VALIDATION', 'importer un tel classeur : refusé');
  });

  test('Import : les lignes sont créées ; un second fichier REMPLACE les montants des mois repris, ajoute les nouveaux, ne supprime rien ; importer deux fois ne change rien', () => {
    const w = world(), id = w.book(ROWS), r = w.run(id);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.applied, w.lines().length], [true, { create: 5, update: 0 }, 5], 'cinq lignes de réalisé');
    const by = (m, cc) => w.lines().find((l) => l.month === m && l.cost_center === cc);
    eq([by('2026-03', '1vm').amount, by('2026-03', '1vm').match_status, by('2026-03', 'GRP-9').team_id === w.zeta.id, by('2026-03', 'Inconnue').match_status, by('2026-04', '1vm').project_id === w.p1.id, by('2026-04', '1vm').wp_id === w.w2.id], [1500, 'Rattaché', true, 'Équipe inconnue', true, true], 'cumul 1 500 € ; équipe par centre de coût ; équipe inconnue ; le CPN du workpackage 2 rattache au projet');
    const imp = w.c.repoList('ActualImport');
    eq([imp.length, imp[0].status, imp[0].period, imp[0].imported_by], [1, 'Publié', '2026-03..2026-04', ADMIN], 'l’import est tracé');
    const again = w.run(id);
    eq([again.data.done, again.data.operations, w.lines().length, w.c.repoList('ActualImport').length], [true, 0, 5, 1], 'le même fichier : rien ne change');
    ok(w.analyze(id).data.nothing_to_do, 'et l’analyse le dit');
    // le fichier du mois suivant : reprend mars (corrigé), avril, et ajoute mai
    const next = w.book([['CPN-100', '1vm', 'mars', 2026, 1800], ['CPN-200', '1vm', 'Apr', 2026, '1 300'], ['CPN-100', '1vm', 'mai', 2026, 900]]);
    const n = w.analyze(next).data;
    eq(n.counts, { create: 1, update: 1, same: 1 }, 'mars corrigé (à remplacer), avril identique, mai nouveau');
    ok(w.run(next).ok);
    eq([by('2026-03', '1vm').amount, w.lines().find((l) => l.month === '2026-05').amount, w.lines().length], [1800, 900, 6], 'mars remplacé par 1 800 € (pas additionné) ; mai ajouté ; les lignes des autres équipes de mars et d’avril, absentes du nouveau fichier, sont gardées');
    eq(w.c.repoList('ActualImport').length, 2, 'un import par fichier');
  });

  test('Par lots : un lancement qui s’arrête dit ce qui reste, et la reprise donne le même résultat', () => {
    const w = world(), id = w.book(ROWS);
    let r = w.run(id, { maxOps: 2 }), n = 1;
    ok(r.ok && r.data.stopped && !r.data.done && r.data.remaining === 3 && r.data.operations === 2, 'premier lot : 2 lignes, il en reste 3');
    while (!r.data.done && n < 10) { r = w.run(id, { maxOps: 2 }); n++; }
    eq([r.data.done, n, w.lines().length, w.c.repoList('ActualImport').length, w.c.repoList('ActualImport')[0].status], [true, 3, 5, 1, 'Publié'], 'trois lots, cinq lignes, un seul import, publié à la fin');
  });

  test('Le réalisé se lit avec le budget : par mois, cumul à ce jour, par équipe (une équipe à 4 caractères compte dans sa parente) ; la projection se lit aussi sur lui', () => {
    const w = world();
    w.run(w.book(ROWS));
    const v = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id }), a = v.actuals;
    eq([a.available, a.year, a.months.length, a.last_month, a.to_date, a.unattached], [true, 2026, 12, 4, 1500 + 200.5 + 1300 + 400 + 50, 50], 'réalisé du projet en 2026, jusqu’à avril ; 50 € sans équipe connue');
    eq([a.monthly[2], a.monthly[3], a.cumulative[3], a.cumulative[4]], [1750.5, 1700, 3450.5, null], 'mars 1 750,50 € (1 500 + 200,50 + 50), avril 1 700 € ; cumul ; rien au-delà du dernier mois');
    eq(a.teams.map((t) => t.name + ':' + t.total), ['1vm:3200', 'Zeta:200.5'], 'par équipe : 1vmd (400 €) est comptée dans 1vm (1 500 + 1 300 + 400)');
    ok(v.projection.actual_to_date === a.to_date && v.projection.projected_actual >= a.to_date, 'la projection sur le réalisé : réalisé à ce jour + reste à faire de l’année : ' + v.projection.projected_actual);
    eq(w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: w.call(ADMIN, 'exercise.create', { year: 2027 }).id }).actuals.available, false, 'étanche : l’exercice 2027 n’a aucun réalisé de 2026');
    ok(w.raw('remi@entreprise.com', 'budget.envelope.get', { projectId: w.p1.id }).data.actuals === null || w.raw('remi@entreprise.com', 'budget.envelope.get', { projectId: w.p1.id }).data.actuals === undefined, 'un responsable de workpackage ne voit pas le réalisé du projet entier');
    const trk = w.call(CP, 'exercise.tracking', { projectId: w.p1.id, exerciseId: w.exec.id });
    eq([trk.teams.find((t) => t.name === '1vm').actual_to_date, trk.teams.find((t) => t.name === 'Zeta').actual_to_date, trk.totals.actual_to_date], [3200, 200.5, 3450.5], 'le suivi par équipe affiche le réalisé de chaque équipe, même celle qui n’a aucune part de livrable (Zeta)');
  });
};
