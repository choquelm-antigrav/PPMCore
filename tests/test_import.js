const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');

module.exports = function () {
  console.log('\nImport du WBS par classeur Google Sheet, un onglet par objet (0.15.3)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';

  function world() {
    const w = lot2World();
    w.c.SpreadsheetApp = makeFakeSheets();
    w.shared = [];
    w.c.IMPORT_DRIVE = { share: (id, email) => w.shared.push([id, email]), moveToProjectFolder() {} };
    w.call(CP, 'people.setRate', { resourceId: w.remi.id, daily_rate: 500 });
    w.template = (who) => w.call(who || CP, 'import.template', { projectId: w.p1.id });
    w.book = (t) => w.c.SpreadsheetApp.openById(t.id);
    w.analyze = (t, who) => w.raw(who || CP, 'import.analyze', { projectId: w.p1.id, book: t.id || t });
    w.run = (t, who, extra) => w.raw(who || CP, 'import.run', Object.assign({ projectId: w.p1.id, book: t.id || t }, extra || {}));
    /** Ajoute des lignes à un onglet du classeur (après les lignes existantes). */
    w.add = (t, tab, rows) => { const sh = w.book(t).getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
    w.setCell = (t, tab, row, col, v) => w.book(t).getSheetByName(tab).getRange(row, col).setValue(v);
    return w;
  }
  const msgs = (rep) => rep.errors.map((e) => e.tab + ' l.' + e.row + ' : ' + e.message);

  test('Modèle : un onglet par objet, prérempli avec le projet (donc aussi un export), partagé avec la personne', () => {
    const w = world(), t = w.template();
    eq(w.book(t).getSheets().map((s) => s.getName()), ['Lisez-moi', 'Projet', 'Workpackages', 'Livrables', 'Jalons', 'Budget'], 'un onglet par objet, plus le mode d’emploi ; la feuille par défaut a disparu');
    eq(t.prefilled, { workpackages: 3, livrables: 3, jalons: 1, budget: 0 }, 'prérempli : 3 workpackages, 3 livrables, 1 jalon');
    eq(w.shared, [[t.id, CP]], 'partagé avec la personne qui l’a demandé');
    const wp = w.book(t).getSheetByName('Workpackages').getDataRange().getValues();
    eq(wp[0], ['Code WBS', 'Parent (code WBS)', 'Nom', 'Leader (e-mail)', 'Imputation', 'Enveloppe (€)']);
    eq(wp.slice(1).map((r) => [String(r[0]), String(r[1]), r[2]]), [['1', '', 'Conception'], ['1.1', '1', 'Calcul'], ['2', '', 'Essais']], 'codes et parents tels que dans l’outil');
    eq(wp[1][3], 'remi@entreprise.com', 'le leader est désigné par son e-mail');
    ok(t.url.indexOf(t.id) > 0 && w.template(CP).id !== t.id, 'un lien, et un nouveau classeur à chaque demande');
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok && rep.data.nothing_to_do, 'le modèle non modifié ne change rien : ' + JSON.stringify(rep.data && rep.data.counts));
  });

  test('Droits : chef de projet et au-dessus seulement', () => {
    const w = world(), t = w.template();
    ['import.template'].forEach((a) => eq(w.raw(WPL, a, { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'un Workpackage leader ne génère pas de modèle'));
    eq(w.analyze(t, WPL).error.code, 'FORBIDDEN', 'ni n’analyse');
    eq(w.run(t, WPL).error.code, 'FORBIDDEN', 'ni n’importe');
    eq(w.analyze(t, MEMBER).error.code, 'FORBIDDEN', 'un Contributor non plus');
    ok(w.analyze(t, DPL).ok && w.template(DPL).id, 'le DPL le peut');
    ok(w.analyze(t, 'admin@entreprise.com').ok, 'et l’administrateur');
  });

  test('Analyse : chaque erreur dit son onglet et sa ligne, rien n’est écrit', () => {
    const w = world(), t = w.template();
    w.add(t, 'Workpackages', [
      ['3', '', 'Industrialisation', 'inconnu@entreprise.com', '', ''],       // l.5 : personne inconnue
      ['2', '', 'Doublon de code', '', '', ''],                               // l.6 : code déjà pris
      ['9.1', '9', 'Orphelin', '', '', ''],                                   // l.7 : parent introuvable
      ['x', '', 'Code illisible', '', '', ''],                                // l.8
      ['5', '', '', '', '', 'beaucoup'],                                      // l.9 : nom manquant, montant illisible
      ['4.1', '2', 'Mal numéroté', '', '', '']                                // l.10 : le code ne commence pas par celui du parent
    ]);
    w.add(t, 'Livrables', [
      ['1', 'Rapport', '2026-12-10', '2026-12-01', '', ''],                    // fin avant début
      ['77', 'Perdu', '2026-12-01', '2026-12-02', '', ''],                     // workpackage introuvable
      ['1', 'Sans fin', '2026-12-01', '', '', ''],                             // début sans fin
      ['1', 'Date folle', '31/02/2026', '2026-12-02', '', ''],                 // 31 février
      ['1', 'Spécification', '2026-10-05', '2026-10-09', '', '']               // doublon dans le même workpackage (déjà dans le modèle)
    ]);
    w.add(t, 'Jalons', [['', 'Revue sans date', '', 'Revue', ''], ['', 'Revue inconnue', '2026-12-01', 'Secret', '']]);
    w.add(t, 'Budget', [
      ['1', 'Spécification', 'xavier@alpha-sous-traitance.com', 'Heures', '', ''],       // type inconnu
      ['1', 'Spécification', 'mia@entreprise.com', 'TJM', '5', ''],                       // Mia n'a pas de taux
      ['1', 'Spécification', 'mia@entreprise.com', 'Forfait', '', '1000'],                // forfait interne
      ['1', 'Introuvable', 'remi@entreprise.com', 'TJM', '3', '']                         // livrable inconnu
    ]);
    const before = JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine'].map((x) => w.c.repoList(x).length));
    const rep = w.analyze(t).data, m = msgs(rep).join('\n');
    eq(rep.ok, false);
    ok(/Workpackages l\.5 : Leader : « inconnu@entreprise\.com » n’est pas dans Ressources/.test(m), 'personne inconnue, avec la marche à suivre\n' + m);
    ok(/Workpackages l\.6 : Le code « 2 » est déjà à la ligne 4/.test(m), 'doublon de code, avec la ligne de l’autre');
    ok(/Workpackages l\.7 : Parent « 9 » : ce workpackage n’existe ni/.test(m), 'parent introuvable');
    ok(/Workpackages l\.10 : Le code « 4\.1 » doit commencer par celui de son parent/.test(m), 'code qui ne commence pas par celui du parent');
    ok(/Workpackages l\.8 : Code WBS « x »/.test(m), 'code illisible');
    ok(/Workpackages l\.9 : Nom obligatoire/.test(m) && /Workpackages l\.9 : Enveloppe : un montant/.test(m), 'nom manquant et montant illisible, sur la même ligne');
    ok(/Livrables l\.5 : La fin \(2026-12-01\) précède le début/.test(m), 'fin avant début');
    ok(/Livrables l\.6 : Workpackage « 77 » : introuvable/.test(m), 'workpackage introuvable');
    ok(/Livrables l\.7 : Début et fin vont ensemble/.test(m), 'début sans fin');
    ok(/Livrables l\.8 : Début : « 31\/02\/2026 » n’est pas une date/.test(m), 'le 31 février');
    ok(/Livrables l\.9 : « Spécification » est déjà à la ligne 2/.test(m), 'doublon de livrable dans le même workpackage');
    ok(/Jalons l\.3 : La date d’un jalon est obligatoire/.test(m) && /Jalons l\.4 : Catégorie « Secret »/.test(m), 'jalons : date et catégorie');
    ok(/Budget l\.2 : Type « Heures »/.test(m), 'type de budget inconnu');
    ok(/Budget l\.3 : Aucun taux journalier pour « Mia »/.test(m), 'taux manquant : à renseigner avant');
    ok(/Budget l\.4 : « Mia » est interne : un forfait est réservé/.test(m), 'forfait interne refusé');
    ok(/Budget l\.5 : Livrable « Introuvable »/.test(m), 'livrable inconnu');
    eq(JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine'].map((x) => w.c.repoList(x).length)), before, 'l’analyse n’écrit rien');
    const bad = w.run(t);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_ERRORS'], 'importer un classeur en erreur est refusé en entier');
    eq(JSON.stringify(['WorkPackage', 'PlanItem', 'BudgetLine'].map((x) => w.c.repoList(x).length)), before, 'sans rien écrire');
  });

  test('Analyse : en-têtes modifiés, onglet manquant, classeur illisible', () => {
    const w = world(), t = w.template();
    w.setCell(t, 'Workpackages', 1, 3, 'Intitulé');
    const m = msgs(w.analyze(t).data).join('\n');
    ok(/Workpackages l\.1 : Colonne « Nom » introuvable/.test(m), 'en-tête renommé : on dit lequel\n' + m);
    w.book(t).deleteSheet(w.book(t).getSheetByName('Jalons'));
    ok(/Jalons l\.0 : Onglet « Jalons » introuvable/.test(msgs(w.analyze(t).data).join('\n')), 'onglet supprimé');
    eq(w.analyze('fake-book-999').error.code, 'VALIDATION', 'classeur introuvable');
    ok(/Classeur illisible/.test(w.analyze('fake-book-999').error.message), 'avec une explication');
    eq(w.analyze('pas un lien').error.code, 'VALIDATION', 'ni lien ni identifiant');
    ok(w.analyze('https://docs.google.com/spreadsheets/d/' + t.id + '/edit#gid=0').ok, 'un lien complet est compris');
  });

  /** Un classeur qui ajoute un workpackage et son sous-workpackage, des livrables, un jalon, des contributors, du budget et des enveloppes. */
  function filled(w) {
    const t = w.template();
    w.setCell(t, 'Projet', 2, 1, 20000);
    w.add(t, 'Workpackages', [
      ['3', '', 'Industrialisation', 'dora@entreprise.com', 'IMP-3', 9000],
      ['3.1', '', 'Outillage', 'mia@entreprise.com', '', 4000]
    ]);
    w.add(t, 'Livrables', [
      ['3', 'Gammes', '2026-11-09', '2026-11-20', 'remi@entreprise.com', 'mia@entreprise.com; carla@entreprise.com'],
      ['3.1', 'Gabarits', '10/11/2026', '27/11/2026', 'mia@entreprise.com', '']
    ]);
    w.add(t, 'Jalons', [['3', 'Revue d’industrialisation', '2026-11-30', 'Revue', 'carla@entreprise.com']]);
    w.add(t, 'Budget', [
      ['3', 'Gammes', 'remi@entreprise.com', 'TJM', 6, ''],                                   // 6 j × 500 € = 3 000 €
      ['3', 'Gammes', 'xavier@alpha-sous-traitance.com', 'Forfait', '', 1500]
    ]);
    // existant modifié : une date de livrable, le nom d'un workpackage
    w.book(t).getSheetByName('Livrables').getRange(4, 4).setValue('2026-11-13');   // « Essais » : fin 2026-11-06 → 2026-11-13
    w.book(t).getSheetByName('Workpackages').getRange(4, 3).setValue('Essais en vol');
    return t;
  }

  test('Analyse du classeur rempli : le plan chiffré, sans erreur', () => {
    const w = world(), t = filled(w);
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok, JSON.stringify(rep.error || msgs(rep.data)));
    eq(rep.data.counts.wps, { create: 2, update: 1, same: 2 }, 'deux workpackages à créer, un à renommer');
    eq([rep.data.counts.items.create, rep.data.counts.items.update, rep.data.counts.contributors], [3, 1, 2], 'trois livrables ou jalons à créer, une date à changer, deux contributors à poser');
    eq([rep.data.counts.lines.create, rep.data.counts.envelope], [2, 3], 'deux lignes de budget, trois enveloppes (projet et deux workpackages)');
    eq(rep.data.nothing_to_do, false);
  });

  test('Import : tout est créé par les actions ordinaires (droits, rôles, budget, enveloppes), puis relancé il ne change plus rien', () => {
    const w = world(), t = filled(w);
    const r = w.run(t);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.remaining], [true, 0], 'terminé, plus rien à faire');
    const wp = (code) => w.c.repoList('WorkPackage').find((x) => String(x.wbs_code) === code && x.project_id === w.p1.id);
    const wp3 = wp('3'), wp31 = wp('3.1');
    eq([wp3.name, wp3.owner_resource_id, wp3.charge_code, wp31.parent_wp_id, wp('2').name], ['Industrialisation', w.dora.id, 'IMP-3', wp3.id, 'Essais en vol'], 'workpackages créés (un sous-workpackage rattaché à son parent), un renommé');
    const roles = (scope, id) => w.c.repoList('RoleAssignment').filter((a) => a.scope_type === scope && a.scope_id === id && (!a.end_date || a.end_date >= w.c.todayStr())).map((a) => a.role_code + ':' + a.resource_id).sort();
    eq(roles('workpackage', wp3.id), ['WPL:' + w.dora.id], 'le leader d’un workpackage devient Workpackage leader');
    eq(roles('workpackage', wp31.id), ['SWPL:' + w.mia.id], 'celui d’un sous-workpackage devient Sub-workpackage leader');
    const item = (name) => w.c.repoList('PlanItem').find((x) => x.name === name);
    const gammes = item('Gammes');
    eq([gammes.planned_start, gammes.planned_finish, gammes.wp_id], ['2026-11-09', '2026-11-20', wp3.id], 'livrable créé, rattaché, daté');
    eq(item('Essais').planned_finish, '2026-11-13', 'la date d’un livrable existant est modifiée');
    eq(roles('planitem', gammes.id), ['CONTRIB:' + w.carla.id, 'CONTRIB:' + w.mia.id, 'DO:' + w.remi.id].sort(), 'Deliverable owner et contributors posés');
    eq([item('Gabarits').planned_start, item('Gabarits').planned_finish], ['2026-11-10', '2026-11-27'], 'dates au format jj/mm/aaaa comprises');
    eq([item('Revue d’industrialisation').item_type, item('Revue d’industrialisation').milestone_category, item('Revue d’industrialisation').planned_finish], ['Jalon', 'Revue', '2026-11-30'], 'jalon créé');
    eq(item('Calcul').planned_finish, '2026-10-23', 'un livrable non touché reste en place');
    const lines = w.c.repoList('BudgetLine').filter((l) => l.deliverable_id === gammes.id).map((l) => l.cost_type + ':' + l.planned_amount).sort();
    eq(lines, ['Forfait:1500', 'TJM:3000'], 'lignes de budget : 6 jours à 500 € et un forfait externe');
    eq([Number(w.c.repoGet('Project', w.p1.id).budget_authorized), Number(wp3.budget_allocated || w.c.repoGet('WorkPackage', wp3.id).budget_allocated), Number(w.c.repoGet('WorkPackage', wp31.id).budget_allocated)], [20000, 9000, 4000], 'enveloppes posées');
    // idempotence
    const events = w.c.repoList('ChangeEvent').length, rows = ['WorkPackage', 'PlanItem', 'BudgetLine', 'RoleAssignment'].map((x) => w.c.repoList(x).length);
    const again = w.run(t);
    eq([again.data.done, again.data.operations, again.data.applied], [true, 0, { wps: 0, items: 0, contributors: 0, lines: 0, envelope: 0 }], 'relancé : aucune opération');
    eq(['WorkPackage', 'PlanItem', 'BudgetLine', 'RoleAssignment'].map((x) => w.c.repoList(x).length), rows, 'aucune ligne en plus');
    eq(w.c.repoList('ChangeEvent').length, events, 'ni aucun événement de journal');
    ok(w.analyze(t).data.nothing_to_do, 'l’analyse suivante : rien à faire');
  });

  test('Les changements importés restent à valider par le niveau du dessus, comme à la main ; rien n’est supprimé', () => {
    const w = world(), t = filled(w);
    w.run(t);
    const feed = (who) => w.call(who, 'changes.feed', { projectId: w.p1.id });
    ok(feed(CP).mine.some((e) => /Gammes|Gabarits|Industrialisation/.test(e.entity)), 'le chef de projet voit ses changements importés en attente du DPL');
    ok(feed(DPL).items.some((e) => /Gammes/.test(e.entity) && e.can_validate), 'le DPL peut les valider');
    // un livrable retiré du classeur reste dans l'outil : l'import ne supprime jamais rien
    const sh = w.book(t).getSheetByName('Livrables');
    sh.getRange(2, 1, 1, 6).setValues([['', '', '', '', '', '']]);
    const rep = w.analyze(t).data;
    ok(rep.ok, msgs(rep).join('\n'));
    const before = w.c.repoList('PlanItem').length;
    w.run(t);
    eq(w.c.repoList('PlanItem').length, before, 'une ligne vidée dans le classeur ne supprime rien dans l’outil');
    ok(w.c.repoList('PlanItem').some((i) => i.name === 'Spécification' && !w.c.isTrue(i.deleted)), '« Spécification » est toujours là');
  });

  test('Par lots : un lancement s’arrête avant la limite, dit qu’il reste à faire, et la reprise donne le même résultat', () => {
    const w = world(), t = filled(w), ref = world(), tr = filled(ref);
    ref.run(tr);
    let r = w.run(t, CP, { maxOps: 3 }), runs = 1;
    ok(r.ok && r.data.stopped && !r.data.done && r.data.remaining > 0 && r.data.operations === 3, 'premier lancement : trois opérations, il dit qu’il reste à faire (' + (r.data && r.data.remaining) + ')');
    while (!r.data.done && runs < 30) { r = w.run(t, CP, { maxOps: 3 }); runs++; }
    ok(r.data.done && runs > 2, 'terminé en ' + runs + ' lancements');
    const sig = (x) => ['WorkPackage', 'PlanItem', 'BudgetLine'].map((tb) => x.c.repoList(tb).map((o) => [o.wbs_code, o.name, o.planned_start, o.planned_finish, o.planned_amount, o.budget_allocated].join('|')).sort().join(';')).join('#');
    eq(sig(w), sig(ref), 'mêmes données qu’un import en un seul lancement');
    const roles = (x) => x.c.repoList('RoleAssignment').filter((a) => !a.end_date).map((a) => a.role_code).sort().join();
    eq(roles(w), roles(ref), 'mêmes rôles');
    w.c.IMPORT_BUDGET_MS = -1;
    const timed = w.run(t);
    eq([timed.data.done, timed.data.operations], [true, 0], 'le budget de temps épuisé n’empêche pas un import déjà terminé de se dire terminé');
  });

  test('Le budget de temps arrête réellement un lancement', () => {
    const w = world(), t = filled(w);
    w.c.IMPORT_BUDGET_MS = -1;
    const r = w.run(t);
    ok(r.ok && r.data.stopped && r.data.operations === 0 && r.data.remaining > 0 && !r.data.done, 'sans temps, aucune opération et « reste à faire » : ' + JSON.stringify(r.data && { s: r.data.stopped, o: r.data.operations, r: r.data.remaining }));
  });
};
