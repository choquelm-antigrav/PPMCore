const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');

module.exports = function () {
  console.log('\nExercice budgétaire : export et import par classeur Google Sheet (0.17.4)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const TB = 'Budget par équipe', TP = 'Parts des livrables';

  /** Équipes 1vm ⊃ 1vmd, 2ae, « Direction » (hors règle) ; exercices 2026 (exécution) et 2027 (préparation) ; budgets et parts déjà saisis sur le projet P1. */
  function world() {
    const w = lot2World();
    w.c.SpreadsheetApp = makeFakeSheets();
    w.c.IMPORT_DRIVE = { share: (id, email) => (w.shared = w.shared || []).push([id, email]), moveToProjectFolder() {} };
    w.team = (name, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name }, extra || {}) });
    w.vm = w.team('1vm'); w.vmd = w.team('1vmd', { parent_team_id: w.vm.id }); w.ae = w.team('2ae'); w.dir = w.team('Direction');
    const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    const set = (team, f, v) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.prep.id, teamId: team.id, [f]: v });
    set(w.vm, 'expected', 100000); set(w.vmd, 'expected', 30000); set(w.ae, 'expected', 50000); set(w.vm, 'granted', 80000);
    const part = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: w.prep.id });
    part(w.a, w.vm, 40000); part(w.a, w.vmd, 20000); part(w.b, w.vm, 30000); part(w.b, w.ae, 60000);
    w.tpl = (who, ex) => w.call(who || CP, 'exercise.import.template', { exerciseId: (ex || w.prep).id });
    w.analyze = (t, who, ex) => w.raw(who || CP, 'exercise.import.analyze', { exerciseId: (ex || w.prep).id, book: t.id || t });
    w.run = (t, who, ex, extra) => w.raw(who || CP, 'exercise.import.run', Object.assign({ exerciseId: (ex || w.prep).id, book: t.id || t }, extra || {}));
    w.book = (t) => w.c.SpreadsheetApp.openById(t.id || t);
    w.rowsOf = (t, tab) => w.book(t).getSheetByName(tab).getDataRange().getValues();
    w.add = (t, tab, rows) => { const sh = w.book(t).getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
    w.cell = (t, tab, match, col, v) => { const rows = w.rowsOf(t, tab); const r = rows.findIndex((x, i) => i > 0 && match(x)) + 1; if (!r) throw new Error('ligne introuvable'); w.book(t).getSheetByName(tab).getRange(r, col).setValue(v); };
    w.table = (ex) => w.call(CP, 'exercise.get', { projectId: w.p1.id, exerciseId: (ex || w.prep).id });   // les données du tableau
    return w;
  }
  const msgs = (rep) => (rep.errors || []).map((e) => e.tab + ' l.' + e.row + ' : ' + e.message);
  const state = (w) => JSON.stringify([w.c.repoList('TeamBudget').map((b) => [b.team_id, b.expected, b.granted]), w.c.repoList('BudgetLine').map((l) => [l.deliverable_id, l.team_id, l.planned_amount])]);

  test('Export : le classeur reprend l’exercice (budget par équipe, parts des livrables avec leur code WBS), partagé avec la personne ; relu tel quel, il ne change rien', () => {
    const w = world(), t = w.tpl();
    eq(w.book(t).getSheets().map((s) => s.getName()), ['Lisez-moi', TB, TP], 'deux onglets et le mode d’emploi');
    eq(t.prefilled, { budgets: 3, parts: 4 });
    eq(w.shared, [[t.id, CP]], 'partagé avec la personne qui l’a demandé');
    eq(w.rowsOf(t, TB), [['Projet', 'Équipe', 'Attendu (€)', 'Accordé (€)'], ['P1', '1vm', 100000, 80000], ['P1', '1vmd', 30000, ''], ['P1', '2ae', 50000, '']], 'attendu et accordé par projet et par équipe');
    eq(w.rowsOf(t, TP).slice(1).map((r) => r.join('|')), ['P1|1|Spécification|1vm|40000', 'P1|1|Spécification|1vmd|20000', 'P1|1.1|Calcul|1vm|30000', 'P1|1.1|Calcul|2ae|60000'], 'les parts, avec le code WBS du workpackage du livrable');
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok && rep.data.nothing_to_do, 'le classeur non modifié ne change rien : ' + JSON.stringify(rep.data && rep.data.counts));
  });

  test('Droits : celui qui saisit l’exercice, et seulement sur ses projets', () => {
    const w = world();
    eq([w.raw(WPL, 'exercise.import.template', { exerciseId: w.prep.id }).error.code, w.raw(MEMBER, 'exercise.import.template', { exerciseId: w.prep.id }).error.code], ['FORBIDDEN', 'FORBIDDEN'], 'un Workpackage leader ou un Contributor ne génère pas de classeur (il lit, il ne saisit pas)');
    const t = w.tpl();
    eq([w.analyze(t, WPL).error.code, w.run(t, MEMBER).error.code], ['FORBIDDEN', 'FORBIDDEN']);
    ok(w.analyze(t, DPL).ok && w.analyze(t, ADMIN).ok, 'le DPL et l’administrateur le peuvent');
    // P2 : Carla n'en est pas la cheffe ; l'administrateur oui
    w.call(ADMIN, 'exercise.set', { projectId: w.p2.id, exerciseId: w.prep.id, teamId: w.vm.id, expected: 7000 });
    eq(w.rowsOf(w.tpl(CP), TB).length, 4, 'l’export de la cheffe de P1 ne contient pas P2');
    ok(w.rowsOf(w.tpl(ADMIN), TB).some((r) => r[0] === 'P2' && r[2] === 7000), 'celui de l’administrateur le contient');
    const t2 = w.tpl(); w.add(t2, TB, [['P2', '1vm', 9000, '']]);
    ok(/Projet « P2 » : saisir son exercice est réservé/.test(msgs(w.analyze(t2).data).join('\n')), 'une ligne d’un projet dont on n’a pas la charge : refusée');
    eq(w.raw(CP, 'exercise.import.template', { exerciseId: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Analyse : chaque erreur dit son onglet et sa ligne ; rien n’est écrit', () => {
    const w = world(), t = w.tpl(), before = state(w);
    w.add(t, TB, [
      ['P9', '1vm', 1, ''],                         // l.5 projet inconnu
      ['P1', 'Fantôme', 1, ''],                     // l.6 équipe inconnue
      ['P1', 'Direction', 1, ''],                   // l.7 équipe hors règle
      ['P1', '2ae', 'cher', ''],                    // l.8 montant illisible (et doublon de 2ae)
      ['P1', '1VM', 5, ''],                         // l.9 doublon (sans casse)
      ['P1', '', 1, 1],                             // l.10 équipe manquante
      ['', '1vm', 1, 1]                             // l.11 projet manquant
    ]);
    w.add(t, TP, [
      ['P1', '9', 'Spécification', '1vm', 100],     // l.6 workpackage inconnu
      ['P1', '1', 'Inconnu', '1vm', 100],           // l.7 livrable inconnu
      ['P1', '1', 'Spécification', '1vm', 100],     // l.8 doublon (l.2 du classeur : même part)
      ['P1', '1.1', 'Calcul', 'ae', 100],           // l.9 équipe inconnue
      ['P1', '1.1', 'Calcul', '2ae', 0],            // l.10 montant nul
      ['P1', '2', 'Essais', 'Direction', 5000]      // l.11 équipe hors règle : accepté avec un avertissement
    ]);
    const rep = w.analyze(t).data, m = msgs(rep).join('\n');
    eq(rep.ok, false);
    ok(/Budget par équipe l\.5 : Projet « P9 » : introuvable/.test(m) && /l\.6 : Équipe « Fantôme » : introuvable/.test(m), 'projet et équipe inconnus\n' + m);
    ok(/l\.7 : Le budget se saisit par équipe dont le nom a 3 ou 4 caractères \(« Direction » en a 9\)/.test(m), 'équipe hors règle');
    ok(/l\.8 : Attendu : un montant en euros positif ou nul/.test(m) && /l\.8 : Cette équipe est déjà à la ligne 4 pour ce projet/.test(m) && /l\.9 : Cette équipe est déjà à la ligne 2 pour ce projet/.test(m), 'montant illisible, doublons (même sans respecter la casse)');
    ok(/l\.10 : Équipe obligatoire/.test(m) && /l\.11 : Projet obligatoire/.test(m), 'équipe et projet manquants');
    ok(/Parts des livrables l\.6 : Workpackage « 9 » : introuvable dans P1/.test(m) && /l\.7 : Livrable « Inconnu » : introuvable dans le workpackage 1 \(il doit exister/.test(m), 'workpackage et livrable inconnus');
    ok(/Parts des livrables l\.8 : Cette équipe a déjà une part sur ce livrable \(ligne 2\)/.test(m), 'une part déjà présente dans le classeur (ligne 2 : celle de l’export) : doublon');
    ok(/l\.9 : Équipe « ae » : introuvable/.test(m) && /l\.10 : Montant : un montant en euros positif/.test(m), 'équipe inconnue, montant nul');
    ok(rep.warnings.some((x) => x.tab === TP && x.row === 11 && /hors règle/.test(x.message)), 'une part sur une équipe hors règle : acceptée, avec un avertissement');
    eq(state(w), before, 'l’analyse n’écrit rien');
    const bad = w.run(t);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_ERRORS'], 'importer un classeur en erreur : refusé en entier');
    eq(state(w), before, 'sans rien écrire');
    const t2 = w.tpl(); w.book(t2).getSheetByName(TB).getRange(1, 3).setValue('Montant');
    ok(/Colonne « Attendu \(€\) » introuvable/.test(msgs(w.analyze(t2).data).join('\n')), 'en-tête renommé : on dit lequel');
    const t3 = w.tpl(); w.book(t3).deleteSheet(w.book(t3).getSheetByName(TP));
    ok(w.analyze(t3).data.ok, 'l’onglet des parts est facultatif');
    const t4 = w.tpl(); w.book(t4).deleteSheet(w.book(t4).getSheetByName(TB));
    ok(/Onglet « Budget par équipe » introuvable/.test(msgs(w.analyze(t4).data).join('\n')), 'l’onglet du budget est obligatoire');
    eq(w.analyze('fake-book-999').error.code, 'VALIDATION', 'classeur introuvable');
  });

  test('Import : les valeurs du classeur sont appliquées (modifiées, ajoutées) ; une cellule vide ne change rien ; rien n’est supprimé ; copie de sécurité avant de modifier ; relancé, rien ne change', () => {
    const w = world(), t = w.tpl();
    w.cell(t, TB, (r) => r[1] === '1vm', 3, 120000);                       // l'attendu de 1vm monte
    w.cell(t, TB, (r) => r[1] === '1vm', 4, '');                           // cellule vidée : l'accordé de 1vm n'est PAS effacé
    w.cell(t, TB, (r) => r[1] === '2ae', 3, '');                           // attendu de 2ae vidé : il reste à 50 000
    w.cell(t, TB, (r) => r[1] === '2ae', 4, 40000);                        // son accordé est ajouté
    w.cell(t, TP, (r) => r[2] === 'Calcul' && r[3] === '2ae', 5, 55000);   // une part modifiée
    w.add(t, TP, [['P1', '2', 'Essais', '1vm', 12000]]);                   // une part nouvelle, sur un livrable sans exercice
    const rep = w.analyze(t).data;
    ok(rep.ok, JSON.stringify(msgs(rep)));
    eq(rep.counts, { budgets: { create: 0, update: 2, same: 1 }, parts: { create: 1, update: 1, same: 3 } }, 'à faire : deux budgets modifiés, une part modifiée, une part créée ; trois parts inchangées');
    const r = w.run(t);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.remaining, !!r.data.backup, r.data.applied], [true, 0, true, { budgets: 2, parts: 2 }], 'terminé ; une copie de sécurité a été faite avant de modifier des valeurs existantes');
    ok(/Copie avant import de l’exercice 2027/.test(r.data.backup.name) && w.rowsOf(r.data.backup, TB).some((x) => x[1] === '1vm' && x[2] === 100000), 'la copie contient l’état d’AVANT l’import (attendu de 1vm : 100 000 €)');
    const d = w.table(), vm = d.rows.find((x) => x.name === '1vm'), ae = d.rows.find((x) => x.name === '2ae');
    eq([vm.own.expected, vm.granted, ae.expected, ae.granted, ae.parts], [120000, 80000, 50000, 40000, 55000], 'attendu de 1vm modifié ; son accordé gardé (cellule vide) ; l’accordé de 2ae ajouté, son attendu gardé ; la part de 2ae modifiée');
    eq(w.c.repoGet('PlanItem', w.cc.id).exercise_id, w.prep.id, 'le livrable « Essais » est rattaché à l’exercice par sa première part');
    const again = w.run(t, CP, undefined, { resume: true });
    eq([again.data.done, again.data.operations], [true, 0], 'relancé : aucune opération');
    ok(w.analyze(t).data.nothing_to_do, 'l’analyse suivante : rien à faire');
    // rien n'est supprimé : une ligne retirée du classeur reste dans l'outil
    const t2 = w.tpl(); w.book(t2).getSheetByName(TP).getRange(2, 1, 1, 5).setValues([['', '', '', '', '']]);
    const snap = state(w);
    w.run(t2, CP, undefined, { resume: true });
    eq(state(w), snap, 'une ligne retirée du classeur n’est pas supprimée dans l’outil : l’import ne supprime jamais rien');
  });

  test('Sans modification de valeurs existantes : pas de copie de sécurité ; par lots, la reprise donne le même résultat ; copie impossible : rien n’est écrit', () => {
    const w = world(), spare = w.team('3xx');
    const t = w.tpl(); w.add(t, TB, [['P1', '3xx', 1000, 500]]);
    const r = w.run(t);
    ok(r.ok && r.data.done, JSON.stringify(r.error));
    eq([r.data.backup, w.table().rows.find((x) => x.name === '3xx').expected], [null, 1000], 'rien que des créations : pas de copie de sécurité, il n’y a rien à protéger');
    // par lots
    const w1 = world(), w2 = world();
    const prepare = (ww) => { const x = ww.team('3xx'); const tt = ww.tpl(); ww.add(tt, TB, [['P1', '3xx', 1000, 500]]); ww.add(tt, TP, [['P1', '2', 'Essais', '1vm', 9000], ['P1', '2', 'Essais', '2ae', 4000]]); ww.cell(tt, TB, (q) => q[1] === '2ae', 3, 51000); ww.cell(tt, TB, (q) => q[1] === '1vm', 3, 101000); void x; return tt; };
    const ta = prepare(w1), tb = prepare(w2);
    w1.run(ta, CP, undefined, { resume: true });
    let created = 0; const origCreate = w2.c.SpreadsheetApp.create; w2.c.SpreadsheetApp.create = (...a) => { created++; return origCreate(...a); };
    let lot = w2.run(tb, CP, undefined, { maxOps: 1 }), n = 1;
    ok(lot.ok && lot.data.stopped && !lot.data.done && lot.data.remaining > 0 && lot.data.operations === 1, 'premier lot : une opération, il dit qu’il reste à faire (' + (lot.data && lot.data.remaining) + ')');
    while (!lot.data.done && n < 30) { lot = w2.run(tb, CP, undefined, { maxOps: 1, resume: true }); n++; }
    ok(lot.data.done && n > 2, 'terminé en ' + n + ' lots');
    eq(created, 1, 'une seule copie de sécurité sur l’ensemble des lots (deux attendus sont modifiés : il en reste un à modifier au second lot, sans nouvelle copie)');
    w2.c.SpreadsheetApp.create = origCreate;
    eq(state(w2).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').length, state(w1).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID').length, 'même quantité de données qu’un import en un seul lancement');
    eq(w2.table().totals, w1.table().totals, 'mêmes totaux (attendu, accordé, parts) qu’un import en un seul lancement');
    // copie impossible
    const w3 = world(), t3 = w3.tpl(); w3.cell(t3, TB, (q) => q[1] === '1vm', 3, 111111);
    const create = w3.c.SpreadsheetApp.create; w3.c.SpreadsheetApp.create = () => { throw new Error('Drive indisponible'); };
    const before = state(w3), bad = w3.run(t3);
    eq([bad.error.code, bad.error.details.rule, state(w3)], ['VALIDATION', 'IMPORT_BACKUP', before], 'copie impossible : import annulé, rien n’a été écrit');
    w3.c.SpreadsheetApp.create = create;
  });

  test('Exercice en exécution : l’attendu est figé (une valeur identique est acceptée), l’accordé se révise', () => {
    const w = world();
    w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.exec.id, teamId: w.vm.id, granted: 70000 });
    const t = w.tpl(CP, w.exec);
    eq(w.rowsOf(t, TB).slice(1), [['P1', '1vm', '', 70000]], 'l’export de l’exercice en exécution');
    w.cell(t, TB, (r) => r[1] === '1vm', 4, 65000);
    ok(w.analyze(t, CP, w.exec).data.ok, 'réviser l’accordé (février, avril) : permis');
    w.cell(t, TB, (r) => r[1] === '1vm', 3, 1000);
    ok(/Attendu : il est figé, l’exercice 2026 est en exécution/.test(msgs(w.analyze(t, CP, w.exec).data).join('\n')), 'toucher à l’attendu : refusé');
    w.cell(t, TB, (r) => r[1] === '1vm', 3, '');
    const r = w.run(t, CP, w.exec);
    ok(r.ok && r.data.done, JSON.stringify(r.error));
    eq(w.table(w.exec).rows[0].granted, 65000, 'accordé révisé, l’attendu intact');
    // l'exercice en préparation passe en exécution avec son attendu déjà saisi : le même classeur, avec la même valeur, ne gêne pas
    const t2 = w.tpl(); w.cell(t2, TB, (r) => r[1] === '1vm', 4, 85000);
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' });
    const rep = w.analyze(t2).data;
    ok(rep.ok && rep.counts.budgets.update === 1, 'en exécution : l’attendu identique du classeur est accepté, seul l’accordé change : ' + JSON.stringify(msgs(rep)));
    ok(w.run(t2).ok && w.table().rows.find((x) => x.name === '1vm').granted === 85000 && w.table().rows.find((x) => x.name === '1vm').own.expected === 100000, 'et il est appliqué sans toucher à l’attendu');
  });

  test('Exercice clos : toute modification est refusée', () => {
    const w = world(), t = w.tpl();
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' });
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Clos' });
    w.cell(t, TB, (r) => r[1] === '1vm', 4, 1);
    w.cell(t, TP, (r) => r[2] === 'Calcul' && r[3] === '2ae', 5, 1);
    const m = msgs(w.analyze(t).data).join('\n');
    ok(/Budget par équipe l\.2 : L’exercice 2027 est clos/.test(m) && /Parts des livrables l\.5 : L’exercice 2027 est clos/.test(m), 'exercice clos : budget et parts refusés\n' + m);
  });

  test('Un livrable d’un autre exercice : refusé ; un livrable chiffré avant les exercices peut être rattaché par l’import', () => {
    const w = world();
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, team_id: w.vm.id, planned_amount: 100 }, exerciseId: w.exec.id });
    const t = w.tpl(); w.add(t, TP, [['P1', '2', 'Essais', '2ae', 500]]);
    ok(/Le livrable « Essais » appartient à l’exercice 2026 : un livrable n’a qu’un exercice/.test(msgs(w.analyze(t).data).join('\n')), 'le livrable d’un autre exercice : refusé');
    const w2 = world();
    w2.c.repoInsert('BudgetLine', { deliverable_id: w2.cc.id, team_id: w2.vm.id, cost_type: 'Équipe', planned_amount: 100, phasing_mode: 'auto', is_external: false }, w2.S);   // chiffré avant les exercices : aucun exercice
    const t2 = w2.tpl(); w2.add(t2, TP, [['P1', '2', 'Essais', 'ae', 1]]);
    w2.cell(t2, TP, (r) => r[3] === 'ae', 4, '2ae');
    const r = w2.run(t2);
    ok(r.ok, JSON.stringify(r.error));
    eq(w2.c.repoGet('PlanItem', w2.cc.id).exercise_id, w2.prep.id, 'rattaché à l’exercice par l’import');
  });
};
