const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');
const { freshCore } = require('./harness');

module.exports = function () {
  console.log('\nExport et import de projets par classeur Google Sheet, un onglet par objet (0.16.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';

  function world() {
    const w = lot2World();
    w.c.SpreadsheetApp = makeFakeSheets();
    w.shared = [];
    w.c.IMPORT_DRIVE = { share: (id, email) => w.shared.push([id, email]), moveToProjectFolder() {} };
    w.team = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'FR' } });   // l'équipe des parts de budget (0.17.1 : plus de taux journalier)
    const e0 = w.call(ADMIN, 'exercise.create', { year: 2026 });   // les enveloppes et les livrables chiffrés de l'import appartiennent à l'exercice en exécution (0.19.3)
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    w.template = (who, extra) => w.call(who || CP, 'import.template', Object.assign({ projectId: w.p1.id }, extra || {}));
    w.book = (t) => w.c.SpreadsheetApp.openById(t.id || t);
    w.analyze = (t, who, extra) => w.raw(who || CP, 'import.analyze', Object.assign({ projectId: w.p1.id, book: t.id || t }, extra || {}));
    w.run = (t, who, extra) => w.raw(who || CP, 'import.run', Object.assign({ projectId: w.p1.id, book: t.id || t }, extra || {}));
    /** Ajoute des lignes à un onglet du classeur (après les lignes existantes). */
    w.add = (t, tab, rows) => { const sh = w.book(t).getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
    w.setCell = (t, tab, row, col, v) => w.book(t).getSheetByName(tab).getRange(row, col).setValue(v);
    w.rowsOf = (t, tab) => w.book(t).getSheetByName(tab).getDataRange().getValues();
    return w;
  }
  const msgs = (rep) => rep.errors.map((e) => e.tab + ' l.' + e.row + ' : ' + e.message);
  const TABS = ['Lisez-moi', 'Programmes', 'Projets', 'Personnes', 'Workpackages', 'Livrables', 'Jalons', 'Dépendances', 'Budget'];

  test('Export d’un projet : un onglet par objet, prérempli, partagé avec la personne ; relu tel quel, il ne change rien', () => {
    const w = world(), t = w.template();
    eq(w.book(t).getSheets().map((s) => s.getName()), TABS, 'un onglet par objet, plus le mode d’emploi ; la feuille par défaut a disparu');
    eq(t.prefilled, { programmes: 1, projets: 1, personnes: 3, workpackages: 3, livrables: 3, jalons: 1, dependances: 3, budget: 0 }, 'prérempli : le programme, le projet, les trois personnes citées, le découpage et les trois dépendances');
    eq(w.shared, [[t.id, CP]], 'partagé avec la personne qui l’a demandé');
    eq(w.rowsOf(t, 'Projets')[1].slice(0, 6), ['P1', 'Projet 1', 'PG', 'Actif', 'FR', 'carla@entreprise.com'], 'le projet, son programme et son chef de projet');
    const wp = w.rowsOf(t, 'Workpackages');
    eq(wp[0], ['Projet', 'Code WBS', 'Parent (code WBS)', 'Nom', 'Leader (e-mail)', 'Imputation', 'Enveloppe (€)']);
    eq(wp.slice(1).map((r) => [r[0], String(r[1]), String(r[2]), r[3]]), [['P1', '1', '', 'Conception'], ['P1', '1.1', '1', 'Calcul'], ['P1', '2', '', 'Essais']], 'codes et parents tels que dans l’outil');
    eq(w.rowsOf(t, 'Dépendances').slice(1).map((r) => r[2] + '→' + r[4]), ['Spécification→Calcul', 'Calcul→Essais', 'Essais→Revue'], 'les dépendances, par les noms de leurs deux bouts');
    ok(t.url.indexOf(t.id) > 0 && w.template(CP).id !== t.id, 'un lien, et un nouveau classeur à chaque demande');
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok && rep.data.nothing_to_do, 'le classeur non modifié ne change rien : ' + JSON.stringify(rep.data && rep.data.counts));
  });

  test('Plusieurs projets (page Administration) : l’administrateur exporte tout un programme ou une sélection', () => {
    const w = world();
    w.call(ADMIN, 'wbs.create', { projectId: w.p2.id, kind: 'wp', values: { name: 'Qualification', wbs_code: '1' } });
    const all = w.template(ADMIN, { projectId: '', programId: w.prog.id });
    eq(w.rowsOf(all, 'Projets').slice(1).map((r) => r[0]), ['P1', 'P2'], 'tous les projets du programme, dans un classeur');
    eq(w.rowsOf(all, 'Programmes').slice(1).map((r) => r[0]), ['PG'], 'avec leur programme, une seule fois');
    ok(w.rowsOf(all, 'Workpackages').slice(1).some((r) => r[0] === 'P2' && r[3] === 'Qualification'), 'et le découpage de chacun');
    eq(w.template(ADMIN, { projectId: '', projectIds: [w.p2.id] }).prefilled.projets, 1, 'ou une sélection de projets');
    eq(w.raw(ADMIN, 'import.template', {}).error.code, 'VALIDATION', 'sans choix : on le dit');
    const cat = w.call(ADMIN, 'import.catalog', {});
    eq([cat.programs.map((g) => g.code), cat.programs[0].projects.map((x) => x.code + ':' + x.canExport), cat.canCreateProgram], [['PG'], ['P1:true', 'P2:true'], true], 'le catalogue : tous les projets exportables, et la création de programme');
  });

  test('Droits : chef de projet et au-dessus seulement', () => {
    const w = world(), t = w.template();
    eq(w.raw(WPL, 'import.template', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'un Workpackage leader ne génère pas de classeur');
    eq(w.analyze(t, WPL).error.code, 'FORBIDDEN', 'ni n’analyse');
    eq(w.run(t, WPL).error.code, 'FORBIDDEN', 'ni n’importe');
    eq(w.analyze(t, 'mia@entreprise.com').error.code, 'FORBIDDEN', 'un Contributor non plus');
    ok(w.analyze(t, DPL).ok && w.template(DPL).id, 'le DPL le peut');
    ok(w.analyze(t, ADMIN).ok, 'et l’administrateur');
  });

  test('Analyse : chaque erreur dit son onglet et sa ligne, rien n’est écrit', () => {
    const w = world(), t = w.template();
    w.add(t, 'Workpackages', [
      ['P1', '3', '', 'Industrialisation', 'inconnu@entreprise.com', '', ''],       // l.5 : personne inconnue
      ['P1', '2', '', 'Doublon de code', '', '', ''],                               // l.6 : code déjà pris
      ['P1', '9.1', '9', 'Orphelin', '', '', ''],                                   // l.7 : parent introuvable
      ['P1', 'x'.repeat(21), '', 'Code trop long', '', '', ''],                    // l.8
      ['P1', '5', '', '', '', '', 'beaucoup'],                                      // l.9 : nom manquant, montant illisible
      ['P1', '4.1', '2', 'Code libre', '', '', ''],                                 // l.10 : le code ne commence pas par celui du parent : accepté (le code est une étiquette)
      ['P9', '6', '', 'Projet inconnu', '', '', ''],                                // l.11 : projet absent de l'onglet Projets
      ['', '7', '', 'Sans projet', '', '', '']                                      // l.12 : projet manquant
    ]);
    w.add(t, 'Livrables', [
      ['P1', '1', 'Rapport', '2026-12-10', '2026-12-01', '', ''],                    // fin avant début
      ['P1', '77', 'Perdu', '2026-12-01', '2026-12-02', '', ''],                     // workpackage introuvable
      ['P1', '1', 'Sans fin', '2026-12-01', '', '', ''],                             // début sans fin
      ['P1', '1', 'Date folle', '31/02/2026', '2026-12-02', '', ''],                 // 31 février
      ['P1', '1', 'Spécification', '2026-10-05', '2026-10-09', '', '']               // doublon dans le même workpackage
    ]);
    w.add(t, 'Jalons', [['P1', '', 'Revue sans date', '', 'Revue', ''], ['P1', '', 'Revue inconnue', '2026-12-01', 'Secret', '']]);
    w.add(t, 'Dépendances', [
      ['P1', '1', 'Spécification', '', 'Fantôme', 'FS', 0],                            // successeur introuvable
      ['P1', '1', 'Spécification', '1', 'Spécification', 'FS', 0],                     // lui-même
      ['P1', '', 'Revue', '1', 'Spécification', 'FS', 0],                              // ferme une boucle : Spécification → … → Revue
      ['P1', '1', 'Spécification', '2', 'Essais', 'ZZ', 0]                             // type inconnu
    ]);
    w.add(t, 'Budget', [
      ['P1', '1', 'Spécification', 'xavier@alpha-sous-traitance.com', 'Heures', 500],          // type inconnu
      ['P1', '1', 'Spécification', 'Équipe fantôme', 'Équipe', 500],                            // équipe introuvable
      ['P1', '1', 'Spécification', 'mia@entreprise.com', 'Forfait', 1000],                      // forfait interne
      ['P1', '1', 'Introuvable', 'T1A', 'Équipe', 300]                                          // livrable inconnu
    ]);
    const before = JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine', 'Dependency'].map((x) => w.c.repoList(x).length));
    const rep = w.analyze(t).data, m = msgs(rep).join('\n');
    eq(rep.ok, false);
    ok(/Workpackages l\.5 : Leader : « inconnu@entreprise\.com » n’est pas dans Ressources/.test(m), 'personne inconnue, avec la marche à suivre\n' + m);
    ok(/Workpackages l\.6 : Le code « 2 » est déjà à la ligne 4/.test(m), 'doublon de code, avec la ligne de l’autre');
    ok(/Workpackages l\.7 : Parent « 9 » : ce workpackage n’existe ni/.test(m), 'parent introuvable');
    ok(/Workpackages l\.8 : Code WBS « x{21} » : 20 caractères au plus/.test(m), 'code trop long (la règle de la page WBS : 20 caractères)');
    ok(/Workpackages l\.9 : Nom obligatoire/.test(m) && /Workpackages l\.9 : Enveloppe : un montant/.test(m), 'nom manquant et montant illisible, sur la même ligne');
    ok(!/Workpackages l\.10/.test(m), 'un code qui ne commence pas par celui de son parent est accepté : la hiérarchie vient de la colonne Parent, pas du code');
    ok(/Workpackages l\.11 : Projet « P9 » : absent de l’onglet Projets/.test(m) && /Workpackages l\.12 : Projet obligatoire/.test(m), 'projet inconnu ou manquant');
    ok(/Livrables l\.5 : La fin \(2026-12-01\) précède le début/.test(m), 'fin avant début');
    ok(/Livrables l\.6 : Workpackage « 77 » : introuvable/.test(m), 'workpackage introuvable');
    ok(/Livrables l\.7 : Début et fin vont ensemble/.test(m), 'début sans fin');
    ok(/Livrables l\.8 : Début : « 31\/02\/2026 » n’est pas une date/.test(m), 'le 31 février');
    ok(/Livrables l\.9 : « Spécification » est déjà à la ligne 2/.test(m), 'doublon de livrable dans le même workpackage');
    ok(/Jalons l\.3 : La date d’un jalon est obligatoire/.test(m) && /Jalons l\.4 : Catégorie « Secret »/.test(m), 'jalons : date et catégorie');
    ok(/Dépendances l\.5 : Successeur « Fantôme »/.test(m), 'dépendance : élément introuvable');
    ok(/Dépendances l\.6 : Un élément ne peut pas dépendre de lui-même/.test(m), 'dépendance : sur lui-même');
    ok(/Dépendances l\.7 : Cette dépendance fermerait une boucle/.test(m), 'dépendance : une boucle dans le planning');
    ok(/Dépendances l\.8 : Type « ZZ »/.test(m), 'dépendance : type inconnu');
    ok(/Budget l\.2 : Type « Heures »/.test(m), 'type de budget inconnu');
    ok(/Budget l\.3 : Équipe « Équipe fantôme » : introuvable/.test(m), 'équipe inconnue : on dit d’importer d’abord la structure des équipes');
    ok(/Budget l\.4 : « Mia » est interne : un forfait est réservé/.test(m), 'forfait interne refusé');
    ok(/Budget l\.5 : Livrable « Introuvable »/.test(m), 'livrable inconnu');
    eq(JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine', 'Dependency'].map((x) => w.c.repoList(x).length)), before, 'l’analyse n’écrit rien');
    const bad = w.run(t);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_ERRORS'], 'importer un classeur en erreur est refusé en entier');
    eq(JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine', 'Dependency'].map((x) => w.c.repoList(x).length)), before, 'sans rien écrire');
  });

  test('Codes de workpackage libres (« wp1.2 »…) : un export non modifié se réimporte sans erreur, comme la page WBS les accepte ; les absents du classeur sont nommés', () => {
    const w = world();
    // des workpackages créés dans la page WBS avec des codes libres : ni « 1 » ni « 1.2 »
    const top = w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Voilure', wbs_code: 'wp1' } });
    w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', parentId: top.id, values: { name: 'Nervures', wbs_code: 'wp1.2' } });
    w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Fuselage', wbs_code: 'wp1.3' } });          // un point dans le code, mais au premier niveau
    w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Train', wbs_code: 'WP-A' } });
    const t = w.template();
    const rep = w.analyze(t).data;
    eq([rep.ok, rep.errors, rep.warnings.filter((x) => /Workpackage|workpackage/.test(x.message))], [true, [], []], 'aucune erreur ni avertissement sur les workpackages d’un export non modifié : ' + JSON.stringify(msgs(rep)));
    ok(rep.nothing_to_do, 'et rien à importer : ' + JSON.stringify(rep.counts));
    // le code ne fixe pas la hiérarchie : « wp1.3 » reste au premier niveau, « wp1.2 » sous « wp1 »
    const rows = w.rowsOf(t, 'Workpackages').slice(1).map((r) => r[1] + '>' + r[2]);
    ok(rows.includes('wp1.2>wp1') && rows.includes('wp1.3>') && rows.includes('WP-A>'), 'l’export écrit le parent de chacun : ' + rows.join(' | '));
    // un nouveau workpackage « X.n » se range sous « X » s'il existe, sinon il est au premier niveau
    w.add(t, 'Workpackages', [['P1', 'wp1.9', '', 'Carénage', '', '', ''], ['P1', 'zz.4', '', 'Orphelin', '', '', '']]);
    const rep2 = w.analyze(t).data;
    ok(rep2.ok, JSON.stringify(msgs(rep2)));
    ok(w.run(t).ok, 'importé');
    const wp = (code) => w.c.repoList('WorkPackage').find((x) => x.project_id === w.p1.id && String(x.wbs_code) === code);
    eq([wp('wp1.9').parent_wp_id === wp('wp1').id, wp('zz.4').parent_wp_id || ''], [true, ''], 'wp1.9 sous wp1 (qui existe) ; zz.4 au premier niveau (zz n’existe pas)');
    // les vraies erreurs restent : code trop long, parent inconnu, sous-niveau de sous-niveau, son propre parent
    const t2 = w.template();
    w.add(t2, 'Workpackages', [['P1', 'x'.repeat(21), '', 'Trop long', '', '', ''], ['P1', 'n1', 'inconnu', 'Parent inconnu', '', '', ''], ['P1', 'n2', 'wp1.2', 'Niveau trois', '', '', ''], ['P1', 'n3', 'n3', 'Son propre parent', '', '', '']]);
    const m = msgs(w.analyze(t2).data).join('\n');
    ok(/20 caractères au plus/.test(m) && /ce workpackage n’existe ni dans le classeur ni dans le projet/.test(m) && /est lui-même un sous-workpackage : l’outil n’a que deux niveaux/.test(m) && /ne peut pas être son propre parent/.test(m), 'les vraies erreurs sont dites clairement\n' + m);
    // les absents du classeur sont nommés
    const t3 = w.template(); w.book(t3).getSheetByName('Workpackages').getRange(2, 1, 1, 7).setValues([['', '', '', '', '', '', '']]);
    const warn = w.analyze(t3).data.warnings.find((x) => /n’apparaissent pas dans l’onglet Workpackages/.test(x.message));
    ok(warn && /\(.*\)/.test(warn.message) && /laissés tels quels/.test(warn.message), 'workpackages absents : leurs codes sont nommés : ' + (warn && warn.message));
  });

  test('Analyse : en-têtes modifiés, onglet manquant, classeur illisible', () => {
    const w = world(), t = w.template();
    w.setCell(t, 'Workpackages', 1, 4, 'Intitulé');
    const m = msgs(w.analyze(t).data).join('\n');
    ok(/Workpackages l\.1 : Colonne « Nom » introuvable/.test(m), 'en-tête renommé : on dit lequel\n' + m);
    w.book(t).deleteSheet(w.book(t).getSheetByName('Jalons'));
    ok(/Jalons l\.0 : Onglet « Jalons » introuvable/.test(msgs(w.analyze(t).data).join('\n')), 'onglet obligatoire supprimé');
    const t2 = w.template();
    w.book(t2).deleteSheet(w.book(t2).getSheetByName('Dépendances'));
    w.book(t2).deleteSheet(w.book(t2).getSheetByName('Personnes'));
    ok(w.analyze(t2).data.ok, 'les onglets facultatifs (Programmes, Personnes, Dépendances) peuvent manquer');
    eq(w.analyze('fake-book-999').error.code, 'VALIDATION', 'classeur introuvable');
    ok(/Classeur illisible/.test(w.analyze('fake-book-999').error.message), 'avec une explication');
    eq(w.analyze('pas un lien').error.code, 'VALIDATION', 'ni lien ni identifiant');
    ok(w.analyze('https://docs.google.com/spreadsheets/d/' + t.id + '/edit#gid=0').ok, 'un lien complet est compris');
  });

  /** Un classeur qui ajoute une personne, un workpackage et son sous-workpackage, des livrables, un jalon, des dépendances, des contributors, du budget et des enveloppes. */
  function filled(w) {
    const t = w.template();
    w.setCell(t, 'Projets', 2, 7, 20000);
    w.add(t, 'Personnes', [['Nina Roux', 'nina@entreprise.com', 'Interne', 'Ingénieure outillage', 'Bureau d’études', 'FR', '', 'T1A']]);
    w.add(t, 'Workpackages', [
      ['P1', '3', '', 'Industrialisation', 'dora@entreprise.com', 'IMP-3', 9000],
      ['P1', '3.1', '', 'Outillage', 'nina@entreprise.com', '', 4000]
    ]);
    w.add(t, 'Livrables', [
      ['P1', '3', 'Gammes', '2026-11-09', '2026-11-20', 'remi@entreprise.com', 'mia@entreprise.com; carla@entreprise.com'],
      ['P1', '3.1', 'Gabarits', '10/11/2026', '27/11/2026', 'nina@entreprise.com', '']
    ]);
    w.add(t, 'Jalons', [['P1', '3', 'Revue d’industrialisation', '2026-11-30', 'Revue', 'carla@entreprise.com']]);
    w.add(t, 'Dépendances', [['P1', '3', 'Gammes', '3.1', 'Gabarits', 'FS', 2], ['P1', '3.1', 'Gabarits', '3', 'Revue d’industrialisation', 'FS', 0]]);
    w.add(t, 'Budget', [
      ['P1', '3', 'Gammes', 'T1A', 'Équipe', 3000],                                              // la part de l’équipe : un montant libre
      ['P1', '3', 'Gammes', 'xavier@alpha-sous-traitance.com', 'Forfait', 1500],
      ['P1', '3.1', 'Gabarits', 'T1A', 'Équipe', 1600]
    ]);
    // existant modifié : une date de livrable, le nom d'un workpackage
    w.book(t).getSheetByName('Livrables').getRange(4, 5).setValue('2026-11-13');   // « Essais » : fin 2026-11-06 → 2026-11-13
    w.book(t).getSheetByName('Workpackages').getRange(4, 4).setValue('Essais en vol');
    return t;
  }

  test('Analyse du classeur rempli : le plan chiffré, sans erreur', () => {
    const w = world(), t = filled(w);
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok, JSON.stringify(rep.error || msgs(rep.data)));
    const c = rep.data.counts;
    eq(c.people, { create: 1, same: 3 }, 'une personne à créer ; les trois autres du classeur existent déjà');
    eq(c.wps, { create: 2, update: 1, same: 2 }, 'deux workpackages à créer, un à renommer');
    eq([c.items.create, c.items.update, c.contributors], [3, 1, 2], 'trois livrables ou jalons à créer, une date à changer, deux contributors à poser');
    eq([c.lines.create, c.envelope, c.deps.create, c.deps.same], [3, 3, 2, 3], 'trois lignes de budget, trois enveloppes, deux dépendances à créer (trois déjà là)');
    eq(rep.data.nothing_to_do, false);
  });

  test('Import : tout est créé par les actions ordinaires (droits, rôles, budget, dépendances, enveloppes, personne), puis relancé il ne change plus rien', () => {
    const w = world(), t = filled(w);
    const r = w.run(t);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.remaining], [true, 0], 'terminé, plus rien à faire');
    const nina = w.c.findResourceByEmail('nina@entreprise.com');
    ok(nina && nina.name === 'Nina Roux' && nina.team_id === w.team.id, 'la personne du classeur est créée, dans l’équipe qui existe déjà');
    const wp = (code) => w.c.repoList('WorkPackage').find((x) => String(x.wbs_code) === code && x.project_id === w.p1.id);
    const wp3 = wp('3'), wp31 = wp('3.1');
    eq([wp3.name, wp3.owner_resource_id, wp3.charge_code, wp31.parent_wp_id, wp31.owner_resource_id, wp('2').name], ['Industrialisation', w.dora.id, 'IMP-3', wp3.id, nina.id, 'Essais en vol'], 'workpackages créés (un sous-workpackage rattaché à son parent), un renommé');
    const roles = (scope, id) => w.c.repoList('RoleAssignment').filter((a) => a.scope_type === scope && a.scope_id === id && (!a.end_date || a.end_date >= w.c.todayStr())).map((a) => a.role_code + ':' + a.resource_id).sort();
    eq(roles('workpackage', wp3.id), ['WPL:' + w.dora.id], 'le leader d’un workpackage devient Workpackage leader');
    eq(roles('workpackage', wp31.id), ['SWPL:' + nina.id], 'celui d’un sous-workpackage, y compris une personne créée par le classeur, devient Sub-workpackage leader');
    const item = (name) => w.c.repoList('PlanItem').find((x) => x.name === name);
    const gammes = item('Gammes');
    eq([gammes.planned_start, gammes.planned_finish, gammes.wp_id], ['2026-11-09', '2026-11-20', wp3.id], 'livrable créé, rattaché, daté');
    eq(item('Essais').planned_finish, '2026-11-13', 'la date d’un livrable existant est modifiée');
    eq(roles('planitem', gammes.id), ['CONTRIB:' + w.carla.id, 'CONTRIB:' + w.mia.id, 'DO:' + w.remi.id].sort(), 'Deliverable owner et contributors posés');
    eq([item('Gabarits').planned_start, item('Gabarits').planned_finish], ['2026-11-10', '2026-11-27'], 'dates au format jj/mm/aaaa comprises');
    eq([item('Revue d’industrialisation').item_type, item('Revue d’industrialisation').milestone_category], ['Jalon', 'Revue'], 'jalon créé');
    eq(item('Calcul').planned_finish, '2026-10-23', 'un livrable non touché reste en place');
    const dep = w.c.repoList('Dependency').find((d) => d.predecessor_id === gammes.id && d.successor_id === item('Gabarits').id);
    eq([!!dep, dep && dep.dep_type, dep && Number(dep.lag_days)], [true, 'FS', 2], 'dépendance créée, avec son décalage');
    eq(w.c.repoList('BudgetLine').filter((l) => l.deliverable_id === gammes.id).map((l) => l.cost_type + ':' + l.planned_amount).sort(), ['Forfait:1500', 'Équipe:3000'], 'budget de Gammes : la part de l’équipe et un forfait externe');
    eq(w.c.repoList('BudgetLine').filter((l) => l.deliverable_id === item('Gabarits').id).map((l) => l.planned_amount), [1600], 'et la part de l’équipe sur Gabarits');
    const envOf = (rec) => w.c.envAmount_(rec, w.c.envKey_(w.exec));
    eq([envOf(w.c.repoGet('Project', w.p1.id)), envOf(w.c.repoGet('WorkPackage', wp3.id)), envOf(w.c.repoGet('WorkPackage', wp31.id))], [20000, 9000, 4000], 'enveloppes posées (celles de l’exercice en exécution)');
    // idempotence
    const events = w.c.repoList('ChangeEvent').length, rows = ['WorkPackage', 'PlanItem', 'BudgetLine', 'RoleAssignment', 'Dependency', 'Resource'].map((x) => w.c.repoList(x).length);
    const again = w.run(t, CP, { resume: true });
    eq([again.data.done, again.data.operations], [true, 0], 'relancé : aucune opération');
    eq(['WorkPackage', 'PlanItem', 'BudgetLine', 'RoleAssignment', 'Dependency', 'Resource'].map((x) => w.c.repoList(x).length), rows, 'aucune ligne en plus');
    eq(w.c.repoList('ChangeEvent').length, events, 'ni aucun événement de journal');
    ok(w.analyze(t).data.nothing_to_do, 'l’analyse suivante : rien à faire');
  });

  test('Une personne sans adresse sur sa fiche se désigne par son nom exact ; l’export écrit son nom ; un nom ambigu est refusé', () => {
    const w = world();
    const ana = w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Ana Sans-Adresse', country: 'FR' }, w.S);
    w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Jean Dupont', country: 'FR' }, w.S);
    w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'jean  dupont', country: 'FR' }, w.S);
    w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { owner_resource_id: ana.id } });
    const t = w.template();
    eq(w.rowsOf(t, 'Workpackages').find((r) => String(r[1]) === '2')[4], 'Ana Sans-Adresse', 'l’export écrit le nom de qui n’a pas d’adresse');
    ok(w.analyze(t).data.nothing_to_do, 'et le classeur exporté se ré-importe sans erreur ni changement');
    w.add(t, 'Workpackages', [['P1', '3', '', 'Test', 'ana   sans-adresse', '', ''], ['P1', '4', '', 'Ambigu', 'Jean Dupont', '', ''], ['P1', '5', '', 'Inconnu', 'Personne Inconnue', '', '']]);
    const m = msgs(w.analyze(t).data).join('\n');
    ok(!/l\.5/.test(m), 'le nom est reconnu sans tenir compte de la casse ni des espaces en trop');
    ok(/Workpackages l\.6 : Leader : plusieurs personnes s’appellent « Jean Dupont » : désignez-la par son adresse e-mail/.test(m), 'deux personnes du même nom : refusé, avec la marche à suivre\n' + m);
    ok(/Workpackages l\.7 : Leader : « Personne Inconnue » n’est ni une adresse e-mail ni le nom d’une personne/.test(m), 'un nom inconnu : refusé');
  });

  test('Personnes du classeur : créées si elles manquent, jamais modifiées si elles existent ; erreurs lisibles', () => {
    const w = world(), t = w.template();
    w.add(t, 'Personnes', [
      ['Zoé Martin', 'zoe@entreprise.com', 'Externe', 'Ingénieure', 'Alpha', 'FR', 'Alpha SAS', 'T1A'],
      ['Faux Mail', 'pas-un-mail', 'Interne', '', '', '', '', ''],
      ['Type Fou', 'type@entreprise.com', 'Stagiaire', '', '', '', '', ''],
      ['Pays Fou', 'pays@entreprise.com', 'Interne', '', '', 'ZZ', '', '']
    ]);
    const m = msgs(w.analyze(t).data).join('\n');
    ok(/Personnes l\.6 : Adresse e-mail illisible/.test(m) && /Personnes l\.7 : Type « Stagiaire »/.test(m) && /Personnes l\.8 : Pays « ZZ »/.test(m) && !/Taux/.test(m), 'erreurs par ligne\n' + m);
    const ok1 = w.template();
    w.add(ok1, 'Personnes', [['Zoé Martin', 'zoe@entreprise.com', 'Externe', 'Ingénieure', 'Alpha', 'FR', 'Alpha SAS', 'T1A']]);
    // Rémi existe déjà : sa ligne du classeur est changée, la fiche de l'outil ne l'est pas
    const remiRow = w.rowsOf(ok1, 'Personnes').findIndex((r) => r[1] === 'remi@entreprise.com') + 1;
    w.setCell(ok1, 'Personnes', remiRow, 4, 'Fonction inventée');
    const r = w.run(ok1);
    ok(r.ok, JSON.stringify(r.error));
    const zoe = w.c.findResourceByEmail('zoe@entreprise.com');
    eq([zoe.resource_type, zoe.organization, zoe.supplier, zoe.team_id], ['Externe', 'Alpha', 'Alpha SAS', w.team.id], 'la personne est créée avec ses informations et son équipe');
    ok(w.c.repoGet('Resource', w.remi.id).job_function !== 'Fonction inventée', 'une personne qui existe déjà n’est jamais modifiée par l’import');
  });

  test('Seul l’administrateur importe et exporte plusieurs projets (page Administration) ; un chef de projet le fait pour son projet depuis la page WBS', () => {
    const w = world(), t = w.template(ADMIN, { projectId: '', programId: w.prog.id });
    [['chef de projet', CP], ['DPL', DPL], ['Workpackage leader', WPL]].forEach(([nom, who]) => {
      eq([w.raw(who, 'import.template', { programId: w.prog.id }).error.code, w.raw(who, 'import.template', { projectIds: [w.p1.id] }).error.code, w.raw(who, 'import.analyze', { book: t.id }).error.code, w.raw(who, 'import.run', { book: t.id }).error.code, w.raw(who, 'import.catalog', {}).error.code],
        ['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN'], nom + ' : ni export, ni analyse, ni import, ni catalogue de plusieurs projets');
    });
    const msg = w.raw(CP, 'import.analyze', { book: t.id }).error.message;
    ok(/réservés à l’administrateur/.test(msg) && /page WBS/.test(msg), 'le message dit pourquoi et où aller : ' + msg);
    const mine = w.template(CP);
    ok(w.analyze(mine, CP).ok && w.analyze(mine, CP).data.ok, 'un chef de projet exporte et analyse SON projet (page WBS, avec projectId)');
    w.add(t, 'Programmes', [['NEW', 'Nouveau programme', 'Actif', 'Créé par l’import']]);
    w.add(t, 'Projets', [['N1', 'Projet nouveau', 'NEW', 'Préparation', 'FR', '', ''], ['N2', 'Projet dans PG', 'PG', 'Préparation', 'FR', '', '']]);
    const asAdmin = w.raw(ADMIN, 'import.analyze', { book: t.id });
    ok(asAdmin.ok && asAdmin.data.ok, JSON.stringify(asAdmin.error || msgs(asAdmin.data)));
    eq([asAdmin.data.counts.programs.create, asAdmin.data.counts.projects.create], [1, 2], 'l’administrateur : un programme et deux projets à créer');
    // en mode un projet (page WBS), un classeur qui contient d'autres projets est refusé
    const single = w.analyze(t, ADMIN).data, m3 = msgs(single).join('\n');
    ok(!single.ok && /Projets l\.3 : Ce classeur contient le projet « P2 », pas « P1 »/.test(m3) && /Programmes l\.3 : Le programme « NEW » n’existe pas : pour créer un programme, utilisez l’import de la page Administration/.test(m3) && /Projets l\.4 : Ce classeur contient le projet « N1 »/.test(m3) && /Projets l\.5 : Ce classeur contient le projet « N2 »/.test(m3), 'mode un projet : rien d’autre que ce projet\n' + m3);
  });

  test('Programme de plusieurs projets créé par un classeur, puis relancé : rien de plus', () => {
    const w = world(), t = w.template(ADMIN, { projectId: '', programId: w.prog.id });
    w.add(t, 'Programmes', [['NEW', 'Nouveau programme', 'Actif', '']]);
    w.add(t, 'Projets', [['N1', 'Projet nouveau 1', 'NEW', 'Actif', 'FR', 'carla@entreprise.com', 5000], ['N2', 'Projet nouveau 2', 'NEW', 'Préparation', 'DE', '', '']]);
    w.add(t, 'Workpackages', [['N1', '1', '', 'Étude', 'remi@entreprise.com', '', 3000]]);
    w.add(t, 'Livrables', [['N1', '1', 'Dossier', '2026-11-02', '2026-11-13', 'remi@entreprise.com', '']]);
    w.add(t, 'Jalons', [['N1', '1', 'Fin étude', '2026-11-13', '', '']]);
    w.add(t, 'Dépendances', [['N1', '1', 'Dossier', '1', 'Fin étude', 'FS', 0]]);
    const r = w.raw(ADMIN, 'import.run', { book: t.id });
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.remaining], [true, 0], 'terminé');
    const prog = w.c.repoList('Program').find((g) => g.code === 'NEW');
    const n1 = w.c.repoList('Project').find((x) => x.code === 'N1'), n2 = w.c.repoList('Project').find((x) => x.code === 'N2');
    ok(prog && prog.name === 'Nouveau programme', 'le programme est créé');
    eq([n1.program_id, n2.program_id, n1.manager_resource_id, n1.status, n2.status, n2.holiday_country, w.c.envAmount_(n1, w.c.envKey_(w.exec))], [prog.id, prog.id, w.carla.id, 'Actif', 'Préparation', 'DE', 5000], 'deux projets dans le nouveau programme, avec leur chef de projet, statut, pays et budget autorisé');
    eq(w.c.repoList('WorkPackage').filter((x) => x.project_id === n1.id).map((x) => x.name + ':' + x.owner_resource_id), ['Étude:' + w.remi.id], 'le découpage du premier projet');
    eq(w.c.repoList('Dependency').filter((d) => w.c.repoGet('PlanItem', d.successor_id).project_id === n1.id).length, 1, 'et sa dépendance');
    eq(w.c.repoList('Program').map((g) => g.code).sort(), ['NEW', 'PG'], 'deux programmes dans l’outil');
    const before = ['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'RoleAssignment'].map((x) => w.c.repoList(x).length);
    const again = w.raw(ADMIN, 'import.run', { book: t.id, resume: true });
    eq([again.data.done, again.data.operations], [true, 0], 'relancé : aucune opération');
    eq(['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'RoleAssignment'].map((x) => w.c.repoList(x).length), before);
  });

  test('Aller-retour : l’export de plusieurs projets, importé dans une installation neuve, recrée exactement les mêmes données', () => {
    const w = world();
    // un second projet riche : workpackage, livrables, jalon, dépendance, budget, enveloppe
    const wp = w.call(ADMIN, 'wbs.create', { projectId: w.p2.id, kind: 'wp', values: { name: 'Qualification', wbs_code: '1', owner_resource_id: w.remi.id, charge_code: 'Q-1' } });
    const wpId = (wp.record || wp).id;
    const it = (name, type, s, f, owner) => w.call(ADMIN, 'wbs.create', { projectId: w.p2.id, kind: type, parentId: wpId, values: { name, planned_start: s, planned_finish: f, owner_resource_id: owner } });
    it('Plan de qualification', 'Livrable', '2026-11-02', '2026-11-13', w.mia.id); it('Essai final', 'Livrable', '2026-11-16', '2026-11-27', w.remi.id); it('Qualifié', 'Jalon', '2026-11-27', '2026-11-27', w.carla.id);
    const items2 = w.c.repoList('PlanItem').filter((i) => i.project_id === w.p2.id);
    w.call(ADMIN, 'dependencies.create', { values: { predecessor_id: items2.find((i) => i.name === 'Plan de qualification').id, successor_id: items2.find((i) => i.name === 'Essai final').id, dep_type: 'SS', lag_days: 3 } });
    w.call(ADMIN, 'budget.line.save', { values: { deliverable_id: items2.find((i) => i.name === 'Essai final').id, team_id: w.team.id, planned_amount: 4000 } });
    w.call(ADMIN, 'budget.line.save', { values: { deliverable_id: items2.find((i) => i.name === 'Plan de qualification').id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 2500 } });
    w.call(ADMIN, 'budget.envelope.set', { projectId: w.p2.id, authorized: 10000, allocations: [{ wpId: wpId, amount: 7000 }] });
    w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, authorized: 30000 });
    const book = w.template(ADMIN, { projectId: '', all: true });
    // installation neuve : même faux Sheets, aucune donnée
    const d = freshCore();
    d.Session = { getActiveUser: () => ({ getEmail: () => ADMIN }), getEffectiveUser: () => ({ getEmail: () => ADMIN }), getScriptTimeZone: () => 'Europe/Paris' };
    d.SpreadsheetApp = w.c.SpreadsheetApp; d.IMPORT_DRIVE = { share() {}, moveToProjectFolder() {} };
    const call = (a, p) => { const r = d.handleRequest({ action: a, params: p, apiVersion: d.PPM_API_VERSION }, ADMIN); if (!r.ok) throw new Error(a + ' : ' + JSON.stringify(r.error)); return r.data; };
    const dEx = call('exercise.create', { year: 2026 }); call('exercise.setStatus', { id: dEx.id, status: 'Exécution' });   // les enveloppes de l'import sont celles de l'exercice en exécution (0.19.3)
    // la structure des équipes d'abord (les parts de budget désignent des équipes qui doivent exister) : classeur dédié exporté de l'ancienne installation
    const tbook = w.call(ADMIN, 'teams.import.template', {});
    let tr = call('teams.import.run', { book: tbook.id }), tn = 1;
    while (!tr.done && tn < 20) { tr = call('teams.import.run', { book: tbook.id, resume: true }); tn++; }
    ok(tr.done, 'structure des équipes importée d’abord');
    const rep = call('import.analyze', { book: book.id });
    ok(rep.ok, JSON.stringify(rep.errors.slice(0, 3)));
    eq([rep.counts.programs.create, rep.counts.projects.create, rep.counts.people.create], [1, 2, 4], 'dans l’installation neuve : un programme, deux projets, les personnes à créer');
    let r = call('import.run', { book: book.id }), n = 1;
    while (!r.done && n < 20) { r = call('import.run', { book: book.id, resume: true }); n++; }
    ok(r.done, 'importé en ' + n + ' lancement(s)');
    // les mêmes données, comparées par leurs noms et leurs e-mails
    const sig = (c) => {
      const email = (id) => (id && c.repoGet('Resource', id) ? (c.repoGet('Resource', id).email || c.repoGet('Resource', id).name) : '');
      const wpName = (id) => (id ? String(c.repoGet('WorkPackage', id).wbs_code) : '');
      const lines = [], used = {};
      const who = (id) => { if (id) used[id] = true; return email(id); };
      c.repoList('Program').forEach((g) => lines.push('G|' + g.code + '|' + g.name + '|' + (g.status || 'Actif')));
      c.repoList('Project').forEach((p) => lines.push('P|' + p.code + '|' + p.name + '|' + (p.program_id ? c.repoGet('Program', p.program_id).code : '') + '|' + p.status + '|' + p.holiday_country + '|' + who(p.manager_resource_id) + '|' + Number(c.envAmount_(p, c.envKey_(c.repoList('Exercise').find((e) => e.status === 'Exécution'))) || 0)));
      c.repoList('WorkPackage').forEach((x) => lines.push('W|' + c.repoGet('Project', x.project_id).code + '|' + x.wbs_code + '|' + wpName(x.parent_wp_id) + '|' + x.name + '|' + who(x.owner_resource_id) + '|' + (x.charge_code || '') + '|' + Number(c.envAmount_(x, c.envKey_(c.repoList('Exercise').find((e) => e.status === 'Exécution'))) || 0)));
      c.repoList('PlanItem').forEach((i) => lines.push('I|' + c.repoGet('Project', i.project_id).code + '|' + wpName(i.wp_id) + '|' + i.name + '|' + i.item_type + '|' + i.planned_start + '|' + i.planned_finish + '|' + who(i.owner_resource_id) + '|' + (i.milestone_category || '')));
      c.repoList('Dependency').forEach((x) => lines.push('D|' + c.repoGet('PlanItem', x.predecessor_id).name + '|' + c.repoGet('PlanItem', x.successor_id).name + '|' + x.dep_type + '|' + Number(x.lag_days || 0)));
      c.repoList('BudgetLine').forEach((l) => lines.push('B|' + c.repoGet('PlanItem', l.deliverable_id).name + '|' + (l.cost_type === 'Équipe' ? 'T:' + c.repoGet('HierarchicalTeam', l.team_id).name : who(l.resource_id)) + '|' + l.cost_type + '|' + Number(l.fixed_amount || 0) + '|' + Number(l.planned_amount || 0)));
      // les rôles que le classeur porte : leader, owner et contributors (les rôles de projet et de programme ne s'exportent pas : voir « Lisez-moi »)
      c.repoList('RoleAssignment').filter((a) => !a.end_date && (a.scope_type === 'planitem' || a.scope_type === 'workpackage')).forEach((a) => lines.push('A|' + a.role_code + '|' + (a.scope_type === 'planitem' ? c.repoGet('PlanItem', a.scope_id).name : 'WP ' + c.repoGet('WorkPackage', a.scope_id).wbs_code) + '|' + who(a.resource_id)));
      // les personnes citées par les projets (une personne que rien ne cite, comme un DPL, n'est pas dans le classeur)
      c.repoList('Resource').filter((r) => used[r.id]).forEach((r) => lines.push('R|' + r.name + '|' + (r.email || '') + '|' + r.resource_type + '|' + (r.job_function || '') + '|' + (r.team_id ? c.repoGet('HierarchicalTeam', r.team_id).name : '')));
      return lines.sort();
    };
    const src = sig(w.c), dst = sig(d);
    eq(dst.filter((l) => !src.includes(l)), [], 'rien dans l’installation neuve qui ne soit dans l’ancienne');
    eq(src.filter((l) => !dst.includes(l)), [], 'et rien dans l’ancienne qui manque dans la neuve');
    ok(src.length >= 35 && src.some((l) => l.startsWith('A|CONTRIB')) && src.some((l) => l.startsWith('A|DO')) && src.some((l) => l.startsWith('A|WPL')), src.length + ' lignes comparées (programme, projets, personnes, workpackages, éléments, dépendances, budget, enveloppes, rôles de leader, owner et contributors)');
    const second = call('import.analyze', { book: book.id });
    ok(second.nothing_to_do, 'l’installation neuve est à jour : rien à faire');
  });

  test('Copie de sécurité : enregistrée avant le premier lot des projets qui existent ; sans elle, rien n’est écrit', () => {
    const w = world(), t = filled(w);
    const finishBefore = w.c.repoList('PlanItem').find((i) => i.name === 'Essais').planned_finish;
    const r = w.run(t, CP, { maxOps: 1 });
    ok(r.ok && r.data.backup && /Copie avant import/.test(r.data.backup.name) && r.data.backup.projects === 1, 'le premier lot rend le lien de la copie : ' + JSON.stringify(r.data && r.data.backup));
    const livrables = w.rowsOf(r.data.backup, 'Livrables').slice(1).find((x) => x[2] === 'Essais');
    eq(String(w.c.normalizeValue(livrables[4])).slice(0, 10), finishBefore, 'la copie contient l’état d’AVANT l’import (la date de fin de « Essais » n’avait pas encore changé)');
    ok(w.shared.some((s) => s[0] === r.data.backup.id && s[1] === CP), 'et elle est partagée avec la personne');
    const r2 = w.run(t, CP, { maxOps: 1, resume: true });
    eq(r2.data.backup, null, 'les lots suivants n’en refont pas');
    // sans copie possible : l'import est annulé
    const w2 = world(), t2 = filled(w2);
    const create = w2.c.SpreadsheetApp.create;
    w2.c.SpreadsheetApp.create = () => { throw new Error('Drive indisponible'); };
    const rows = ['WorkPackage', 'PlanItem', 'Resource'].map((x) => w2.c.repoList(x).length);
    const bad = w2.run(t2);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_BACKUP'], 'copie impossible : import annulé');
    eq(['WorkPackage', 'PlanItem', 'Resource'].map((x) => w2.c.repoList(x).length), rows, 'rien n’a été écrit');
    w2.c.SpreadsheetApp.create = create;
    // un projet entièrement nouveau n'a rien à sauvegarder ; les projets existants du classeur, si
    const w3 = world(), t3 = w3.template(ADMIN, { projectId: '', programId: w3.prog.id });
    w3.add(t3, 'Projets', [['N1', 'Projet neuf', 'PG', 'Préparation', 'FR', '', '']]);
    const only = w3.raw(ADMIN, 'import.run', { book: t3.id });
    ok(only.ok && only.data.backup && only.data.backup.projects === 2, 'les deux projets existants du classeur sont sauvegardés (le nouveau, non)');
  });

  test('Par lots : un lancement s’arrête avant la limite, dit qu’il reste à faire, et la reprise donne le même résultat', () => {
    const w = world(), t = filled(w), ref = world(), tr = filled(ref);
    ref.run(tr);
    let r = w.run(t, CP, { maxOps: 3 }), runs = 1;
    ok(r.ok && r.data.stopped && !r.data.done && r.data.remaining > 0 && r.data.operations === 3, 'premier lancement : trois opérations, il dit qu’il reste à faire (' + (r.data && r.data.remaining) + ')');
    while (!r.data.done && runs < 40) { r = w.run(t, CP, { maxOps: 3, resume: true }); runs++; }
    ok(r.data.done && runs > 3, 'terminé en ' + runs + ' lancements');
    const sig = (x) => ['WorkPackage', 'PlanItem', 'BudgetLine', 'Dependency'].map((tb) => x.c.repoList(tb).map((o) => [o.wbs_code, o.name, o.planned_start, o.planned_finish, o.planned_amount, tb === 'WorkPackage' ? x.c.envAmount_(o, x.c.envKey_(x.exec)) : '', o.dep_type, o.lag_days].join('|')).sort().join(';')).join('#');
    eq(sig(w), sig(ref), 'mêmes données qu’un import en un seul lancement');
    const roles = (x) => x.c.repoList('RoleAssignment').filter((a) => !a.end_date).map((a) => a.role_code).sort().join();
    eq(roles(w), roles(ref), 'mêmes rôles');
  });

  test('Le budget de temps arrête réellement un lancement', () => {
    const w = world(), t = filled(w);
    w.c.IMPORT_BUDGET_MS = -1;
    const r = w.run(t);
    ok(r.ok && r.data.stopped && r.data.operations === 0 && r.data.remaining > 0 && !r.data.done, 'sans temps, aucune opération et « reste à faire » : ' + JSON.stringify(r.data && { s: r.data.stopped, o: r.data.operations, r: r.data.remaining }));
  });

  test('Les changements importés restent à valider par le niveau du dessus, comme à la main ; rien n’est supprimé', () => {
    const w = world(), t = filled(w);
    w.run(t);
    const feed = (who) => w.call(who, 'changes.feed', { projectId: w.p1.id });
    ok(feed(CP).mine.some((e) => /Gammes|Gabarits|Industrialisation/.test(e.entity)), 'le chef de projet voit ses changements importés en attente du DPL');
    ok(feed(DPL).items.some((e) => /Gammes/.test(e.entity) && e.can_validate), 'le DPL peut les valider');
    // un livrable retiré du classeur reste dans l'outil : l'import ne supprime jamais rien
    const sh = w.book(t).getSheetByName('Livrables');
    sh.getRange(2, 1, 1, 7).setValues([['', '', '', '', '', '', '']]);
    const before = w.c.repoList('PlanItem').length;
    w.run(t, CP, { resume: true });
    eq(w.c.repoList('PlanItem').length, before, 'une ligne vidée dans le classeur ne supprime rien dans l’outil');
    ok(w.c.repoList('PlanItem').some((i) => i.name === 'Spécification' && !w.c.isTrue(i.deleted)), '« Spécification » est toujours là');
  });
};
