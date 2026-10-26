const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');
const { freshCore } = require('./harness');

module.exports = function () {
  console.log('\nStructure des équipes : import par classeur dédié, équipes du projet = équipes dont un membre participe (0.17.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', DPL = 'dora@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  function world() {
    const w = lot2World();
    w.c.SpreadsheetApp = makeFakeSheets();
    w.shared = [];
    w.c.IMPORT_DRIVE = { share: (id, email) => w.shared.push([id, email]), moveToProjectFolder() {} };
    w.template = (who) => w.call(who || CP, 'teams.import.template', {});
    w.book = (t) => w.c.SpreadsheetApp.openById(t.id || t);
    w.analyze = (t, who) => w.raw(who || CP, 'teams.import.analyze', { book: t.id || t });
    w.run = (t, who, extra) => w.raw(who || CP, 'teams.import.run', Object.assign({ book: t.id || t }, extra || {}));
    w.add = (t, tab, rows) => { const sh = w.book(t).getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
    w.setCell = (t, tab, row, col, v) => w.book(t).getSheetByName(tab).getRange(row, col).setValue(v);
    w.rowsOf = (t, tab) => w.book(t).getSheetByName(tab).getDataRange().getValues();
    w.team = (name) => w.c.repoList('HierarchicalTeam').find((x) => x.name === name);
    w.mk = (name, parent, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name, parent_team_id: parent ? parent.id : '' }, extra || {}) });
    w.put = (person, team) => w.call(CP, 'resources.update', { id: person.id, patch: { team_id: team.id } });
    return w;
  }
  const msgs = (rep) => rep.errors.map((e) => e.tab + ' l.' + e.row + ' : ' + e.message);
  const rows = (w) => ['HierarchicalTeam', 'Resource'].map((x) => w.c.repoList(x).length);

  test('Liste de droite d’un projet : seulement les équipes dont un membre participe, avec leurs parents pour l’arborescence ; la liste complète sert aux formulaires', () => {
    const w = world();
    const be = w.mk('Bureau d’études'), calc = w.mk('Calcul', be), dir = w.mk('Direction'), ext = w.mk('Sous-traitants'), vide = w.mk('Équipe vide'), prog = w.mk('Programme');
    w.put(w.remi, calc); w.put(w.mia, calc); w.put(w.carla, dir); w.put(w.xavier, ext);
    // Pat n'a qu'un rôle de programme : elle ne participe pas au projet ; Xavier n'a aucun rôle ; Rémi est Workpackage leader, Mia Contributor, Carla cheffe de projet
    const pat = w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Pat Programme', email: 'pat@entreprise.com', country: 'FR', team_id: prog.id }, w.S);
    w.c.repoInsert('RoleAssignment', { resource_id: pat.id, role_code: 'PL', scope_type: 'program', scope_id: w.prog.id }, w.S);
    const get = (projectId) => w.call(CP, 'ressources.get', { projectId: projectId || '' });
    const g = get(w.p1.id);
    eq(g.teams.map((t) => t.name + ':' + t.participants + (t.context ? ':parent' : '')), ['Bureau d’études:0:parent', 'Calcul:2', 'Direction:1'], 'les équipes qui ont un participant, et le parent « Bureau d’études » pour garder l’arborescence (marqué comme simple parent)');
    eq(g.teamsMode, 'project');
    eq(g.allTeams.map((t) => t.name), ['Bureau d’études', 'Calcul', 'Direction', 'Équipe vide', 'Programme', 'Sous-traitants'], 'la liste complète reste disponible pour les formulaires : toutes les équipes existantes, dans l’ordre de l’arborescence');
    ok(!g.teams.some((t) => /Sous-traitants|Équipe vide|Programme/.test(t.name)), 'ni l’équipe d’un sous-traitant sans rôle, ni une équipe vide, ni celle qui n’a qu’un rôle de programme');
    eq(g.people.filter((p) => p.participates).map((p) => p.name).sort(), ['Carla', 'Dora', 'Mia', 'Rémi'], 'chaque personne dit si elle participe au projet (Dora est DPL du projet) ; Pat, qui n’a qu’un rôle de programme, non');
    // un rôle sur un livrable du projet suffit : l'équipe apparaît
    w.c.repoInsert('RoleAssignment', { resource_id: w.xavier.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: w.a.id }, w.S);
    ok(get(w.p1.id).teams.some((t) => t.name === 'Sous-traitants' && t.participants === 1), 'un rôle posé sur un livrable du projet fait participer la personne : son équipe apparaît');
    eq(get(w.p2.id).teams.map((t) => t.name), [], 'un autre projet, sans participant : aucune équipe');
    const none = get('');
    eq([none.teamsMode, none.teams.length === none.allTeams.length, none.teams.some((t) => t.context)], ['all', true, false], 'sans projet choisi : toutes les équipes, comme avant');
    // un responsable de workpackage compte, même sans rôle posé
    w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zoé Sansrôle', email: 'zoe@entreprise.com', country: 'FR', team_id: vide.id }, w.S);
    const zoe = w.c.findResourceByEmail('zoe@entreprise.com');
    w.c.repoUpdate('WorkPackage', w.w2.id, { owner_resource_id: zoe.id }, null, w.S);
    ok(get(w.p1.id).teams.some((t) => t.name === 'Équipe vide' && t.participants === 1), 'le responsable d’un workpackage du projet participe, même sans rôle posé');
  });

  test('Export : un classeur prérempli avec la structure actuelle, partagé avec la personne ; relu tel quel, il ne change rien', () => {
    const w = world();
    const be = w.mk('Bureau d’études', null, { cost_center: 'CC-10' }), calc = w.mk('Calcul', be, { manager_resource_id: w.remi.id });
    w.put(w.remi, calc); w.put(w.mia, calc); w.put(w.carla, be);
    const t = w.template();
    eq(w.book(t).getSheets().map((s) => s.getName()), ['Lisez-moi', 'Équipes', 'Membres'], 'deux onglets et le mode d’emploi');
    eq(t.prefilled, { equipes: 2, membres: 3 });
    eq(w.shared, [[t.id, CP]], 'partagé avec la personne qui l’a demandé');
    eq(w.rowsOf(t, 'Équipes'), [['Équipe', 'Équipe parente', 'Responsable (e-mail)', 'Centre de coût'], ['Bureau d’études', '', '', 'CC-10'], ['Calcul', 'Bureau d’études', 'remi@entreprise.com', '']], 'la structure, dans l’ordre de l’arborescence, le responsable par son e-mail');
    eq(w.rowsOf(t, 'Membres').slice(1).map((r) => r[0] + '|' + r[1]), ['Bureau d’études|Carla', 'Calcul|Mia', 'Calcul|Rémi'], 'les membres de chaque équipe');
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok && rep.data.nothing_to_do, 'le classeur non modifié ne change rien : ' + JSON.stringify(rep.data && rep.data.counts));
  });

  test('Droits : ceux qui gèrent les équipes (chef de projet et au-dessus) seulement', () => {
    const w = world(), t = w.template();
    eq(w.raw(WPL, 'teams.import.template', {}).error.code, 'FORBIDDEN', 'un Workpackage leader ne génère pas de classeur');
    eq(w.analyze(t, WPL).error.code, 'FORBIDDEN', 'ni n’analyse');
    eq(w.run(t, WPL).error.code, 'FORBIDDEN', 'ni n’importe');
    eq(w.analyze(t, MEMBER).error.code, 'FORBIDDEN', 'un Contributor non plus');
    ok(w.analyze(t, DPL).ok && w.analyze(t, ADMIN).ok && w.analyze(t, CP).ok, 'le chef de projet, le DPL et l’administrateur le peuvent');
  });

  test('Analyse : chaque erreur dit son onglet et sa ligne ; rien n’est écrit', () => {
    const w = world(), t = w.template();
    w.add(t, 'Équipes', [
      ['Bureau d’études', '', '', ''],                       // l.2 : ok
      ['bureau  d’ÉTUDES', '', '', ''],                      // l.3 : même nom (sans accent ni casse ni espace en trop)
      ['', '', '', ''],                                      // l.4 : sans nom → ligne vide ignorée, voir plus bas
      ['Boucle A', 'Boucle B', '', ''],                      // l.5
      ['Boucle B', 'Boucle A', '', ''],                      // l.6 : boucle A ↔ B
      ['Seule', 'Seule', '', ''],                            // l.7 : sa propre parente
      ['Orpheline', 'Fantôme', '', ''],                      // l.8 : parente introuvable
      ['Chef inconnu', '', 'inconnu@entreprise.com', ''],    // l.9 : responsable introuvable
      ['Coût long', '', '', 'x'.repeat(41)]                  // l.10
    ]);
    w.add(t, 'Membres', [
      ['Équipe fantôme', 'Zoé Martin', 'zoe@entreprise.com', 'Interne', '', '', 'FR', ''],      // équipe introuvable
      ['Bureau d’études', 'Faux Mail', 'pas-un-mail', 'Interne', '', '', '', ''],
      ['Bureau d’études', 'Type Fou', 'type@entreprise.com', 'Stagiaire', '', '', '', ''],
      ['Bureau d’études', 'Pays Fou', 'pays@entreprise.com', 'Interne', '', '', 'ZZ', ''],
      ['Bureau d’études', 'Nina Roux', 'nina@entreprise.com', 'Interne', '', '', 'FR', ''],
      ['Bureau d’études', 'Nina Bis', 'nina@entreprise.com', 'Interne', '', '', 'FR', ''],      // même e-mail : doublon
      ['', 'Sans équipe', 'sans@entreprise.com', 'Interne', '', '', '', '']                      // équipe manquante
    ]);
    const before = rows(w);
    const rep = w.analyze(t).data, m = msgs(rep).join('\n');
    eq(rep.ok, false);
    ok(/Équipes l\.3 : L’équipe « bureau d’ÉTUDES » est déjà à la ligne 2/.test(m), 'deux noms qui ne diffèrent que par l’accent, la casse ou l’espacement : doublon\n' + m);
    ok(/Équipes l\.7 : Une équipe ne peut pas être sa propre équipe parente/.test(m), 'sa propre parente');
    ok(/Équipes l\.8 : Équipe parente « Fantôme » : introuvable/.test(m), 'parente introuvable');
    ok(/Équipes l\.9 : Responsable : « inconnu@entreprise\.com » n’est pas dans Ressources/.test(m), 'responsable introuvable');
    ok(/Équipes l\.10 : Centre de coût : 40 caractères au plus/.test(m), 'centre de coût trop long');
    ok(/Équipes l\.5 : Cette équipe se retrouverait sous elle-même/.test(m) && /Équipes l\.6 : Cette équipe se retrouverait sous elle-même/.test(m), 'boucle dans la structure, signalée sur les deux lignes');
    ok(/Membres l\.2 : Équipe « Équipe fantôme » : introuvable/.test(m), 'équipe d’un membre introuvable');
    ok(/Membres l\.3 : Adresse e-mail illisible/.test(m) && /Membres l\.4 : Type « Stagiaire »/.test(m) && /Membres l\.5 : Pays « ZZ »/.test(m), 'e-mail, type, pays');
    ok(/Membres l\.7 : Cette personne est déjà à la ligne 6/.test(m) && /Membres l\.8 : Équipe obligatoire/.test(m), 'doublon de personne, équipe manquante');
    eq(rows(w), before, 'l’analyse n’écrit rien');
    const bad = w.run(t);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_ERRORS'], 'importer un classeur en erreur est refusé en entier');
    eq(rows(w), before, 'sans rien écrire');
    // en-têtes et onglets
    const t2 = w.template();
    w.setCell(t2, 'Équipes', 1, 2, 'Parent');
    ok(/Équipes l\.1 : Colonne « Équipe parente » introuvable/.test(msgs(w.analyze(t2).data).join('\n')), 'en-tête renommé : on dit lequel');
    const t3 = w.template(); w.book(t3).deleteSheet(w.book(t3).getSheetByName('Membres'));
    ok(w.analyze(t3).data.ok, 'l’onglet Membres est facultatif');
    const t4 = w.template(); w.book(t4).deleteSheet(w.book(t4).getSheetByName('Équipes'));
    ok(/Onglet « Équipes » introuvable/.test(msgs(w.analyze(t4).data).join('\n')), 'l’onglet Équipes est obligatoire');
    eq(w.analyze('fake-book-999').error.code, 'VALIDATION', 'classeur introuvable');
  });

  function structure(w) {
    const t = w.template();
    w.add(t, 'Équipes', [
      ['Bureau d’études', '', '', 'CC-10'],
      ['Calcul', 'Bureau d’études', 'remi@entreprise.com', ''],
      ['Essais', 'bureau d’ETUDES', 'nina@entreprise.com', 'CC-11']        // le parent sans accent ni casse ; le responsable est créé par le même classeur
    ]);
    w.add(t, 'Membres', [
      ['Calcul', 'Mia', 'mia@entreprise.com', 'Interne', '', '', '', ''],             // existante, sans équipe : rattachée
      ['Calcul', 'Nina Roux', 'nina@entreprise.com', 'Interne', 'Ingénieure', 'Bureau d’études', 'FR', ''],   // créée
      ['Essais', 'Xavier', 'xavier@alpha-sous-traitance.com', 'Externe', '', '', '', '']
    ]);
    return t;
  }

  test('Import : équipes créées avec leur structure, personnes créées ou rattachées, responsable créé par le même classeur ; relancé, rien ne change', () => {
    const w = world(), t = structure(w);
    const rep = w.analyze(t);
    ok(rep.ok && rep.data.ok, JSON.stringify(rep.error || msgs(rep.data)));
    eq(rep.data.counts, { teams: { create: 3, update: 0, same: 0 }, members: { create: 1, assign: 2, same: 0 } }, 'trois équipes à créer, une personne à créer, deux à rattacher');
    const r = w.run(t);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.done, r.data.remaining, !!r.data.backup], [true, 0, true], 'terminé ; une copie de sécurité a été faite d’abord, car deux personnes qui existent déjà reçoivent une équipe');
    const w0 = world(), t0 = w0.template();
    w0.add(t0, 'Équipes', [['Nouvelle équipe', '', '', '']]); w0.add(t0, 'Membres', [['Nouvelle équipe', 'Nina Roux', 'nina@entreprise.com', 'Interne', '', '', 'FR', '']]);
    const only = w0.run(t0);
    ok(only.ok && only.data.done && only.data.backup === null, 'rien que des créations (une équipe, une personne neuve) : pas de copie de sécurité, il n’y a rien à protéger');
    const be = w.team('Bureau d’études'), calc = w.team('Calcul'), essais = w.team('Essais'), nina = w.c.findResourceByEmail('nina@entreprise.com');
    eq([calc.parent_team_id, essais.parent_team_id, be.cost_center, essais.cost_center], [be.id, be.id, 'CC-10', 'CC-11'], 'la structure : Calcul et Essais sous Bureau d’études, avec leurs centres de coût');
    eq([calc.manager_resource_id, essais.manager_resource_id], [w.remi.id, nina.id], 'les responsables, dont une personne créée par le même classeur');
    eq([w.c.repoGet('Resource', w.mia.id).team_id, w.c.repoGet('Resource', w.xavier.id).team_id, nina && nina.team_id, nina && nina.job_function], [calc.id, essais.id, calc.id, 'Ingénieure'], 'Mia et Xavier sont rattachés, Nina est créée dans son équipe');
    const before = [rows(w), w.c.repoList('ChangeEvent').length];
    const again = w.run(t, CP, { resume: true });
    eq([again.data.done, again.data.operations], [true, 0], 'relancé : aucune opération');
    eq([rows(w), w.c.repoList('ChangeEvent').length], before, 'aucune ligne ni événement en plus');
    ok(w.analyze(t).data.nothing_to_do, 'l’analyse suivante : rien à faire');
  });

  test('Rien n’est écrasé ni supprimé : champs vides complétés, personne déjà dans une autre équipe non déplacée, équipes de l’outil absentes du classeur laissées', () => {
    const w = world();
    const be = w.mk('Bureau d’études'), calc = w.mk('Calcul'), seule = w.mk('Équipe seulement dans l’outil', null, { cost_center: 'CC-9' });
    w.c.repoUpdate('HierarchicalTeam', calc.id, { cost_center: 'CC-OUTIL', manager_resource_id: w.mia.id }, null, w.S);
    w.put(w.remi, seule);
    const t = w.template();
    // le classeur propose d'autres valeurs : Calcul sous Bureau d'études (parent vide dans l'outil : complété), un autre centre de coût et un autre responsable (refusés), Rémi dans Calcul (déjà ailleurs)
    const rowsT = w.rowsOf(t, 'Équipes');
    const calcRow = rowsT.findIndex((r) => r[0] === 'Calcul') + 1;
    w.setCell(t, 'Équipes', calcRow, 2, 'Bureau d’études'); w.setCell(t, 'Équipes', calcRow, 3, 'carla@entreprise.com'); w.setCell(t, 'Équipes', calcRow, 4, 'CC-CLASSEUR');
    const remiRow = w.rowsOf(t, 'Membres').findIndex((r) => r[2] === 'remi@entreprise.com') + 1;
    w.setCell(t, 'Membres', remiRow, 1, 'Calcul');
    const rep = w.analyze(t).data, m = msgs({ errors: rep.warnings }).join('\n');
    ok(rep.ok, JSON.stringify(rep.errors));
    ok(/Équipes l\.\d : L’équipe « Calcul » a un autre responsable dans l’outil/.test(m) && /Équipes l\.\d : L’équipe « Calcul » a un autre centre de coût dans l’outil/.test(m) && /Rémi est déjà dans l’équipe « Équipe seulement dans l’outil » : elle n’est pas déplacée/.test(m), 'les différences sont signalées, pas appliquées\n' + m);
    ok(!/a un autre parent/.test(m), 'le parent vide de l’outil se complète sans avertissement');
    const r = w.run(t);
    ok(r.ok && r.data.backup && /Copie avant import d’équipes/.test(r.data.backup.name), 'des équipes existantes changent : une copie de sécurité est enregistrée d’abord : ' + JSON.stringify(r.data && r.data.backup));
    const after = w.c.repoGet('HierarchicalTeam', calc.id);
    eq([after.parent_team_id, after.cost_center, after.manager_resource_id], [be.id, 'CC-OUTIL', w.mia.id], 'le parent vide est complété ; le centre de coût et le responsable déjà renseignés ne sont pas écrasés');
    eq(w.c.repoGet('Resource', w.remi.id).team_id, seule.id, 'Rémi n’est pas déplacé');
    ok(w.c.repoList('HierarchicalTeam').some((x) => x.id === seule.id && !w.c.isTrue(x.deleted)), 'l’équipe absente du classeur reste');
    const bk = w.rowsOf(r.data.backup, 'Équipes').slice(1).find((x) => x[0] === 'Calcul');
    eq([bk[1], bk[3]], ['', 'CC-OUTIL'], 'la copie contient l’état d’AVANT l’import (Calcul sans parent)');
  });

  test('Copie de sécurité : sans elle, rien n’est écrit ; par lots, la reprise donne le même résultat', () => {
    const w = world(), calc = w.mk('Calcul');
    const t = w.template(); const calcRow = w.rowsOf(t, 'Équipes').findIndex((r) => r[0] === 'Calcul') + 1;
    w.setCell(t, 'Équipes', calcRow, 4, 'CC-NEUF'); w.add(t, 'Équipes', [['Nouvelle', '', '', '']]);
    const create = w.c.SpreadsheetApp.create;
    w.c.SpreadsheetApp.create = () => { throw new Error('Drive indisponible'); };
    const before = rows(w);
    const bad = w.run(t);
    eq([bad.error.code, bad.error.details.rule], ['VALIDATION', 'IMPORT_BACKUP'], 'copie impossible : import annulé');
    eq(rows(w), before, 'rien n’a été écrit');
    w.c.SpreadsheetApp.create = create;
    ok(w.run(t, CP, { resume: true }).ok, 'avec resume, pas de copie demandée (les lots suivants)');
    // par lots
    const w2 = world(), t2 = structure(w2), ref = world(), tr = structure(ref);
    ref.run(tr);
    let r = w2.run(t2, CP, { maxOps: 2 }), runs = 1;
    ok(r.ok && r.data.stopped && !r.data.done && r.data.remaining > 0 && r.data.operations === 2, 'premier lot : deux opérations, il dit qu’il reste à faire (' + (r.data && r.data.remaining) + ')');
    while (!r.data.done && runs < 40) { r = w2.run(t2, CP, { maxOps: 2, resume: true }); runs++; }
    ok(r.data.done && runs > 2, 'terminé en ' + runs + ' lots');
    const sig = (x) => x.c.repoList('HierarchicalTeam').map((q) => q.name + '|' + (q.parent_team_id ? x.c.repoGet('HierarchicalTeam', q.parent_team_id).name : '') + '|' + (q.manager_resource_id ? x.c.repoGet('Resource', q.manager_resource_id).name : '') + '|' + q.cost_center).concat(x.c.repoList('Resource').map((q) => q.name + '>' + (q.team_id ? x.c.repoGet('HierarchicalTeam', q.team_id).name : ''))).sort().join(';');
    eq(sig(w2), sig(ref), 'mêmes équipes et mêmes personnes qu’un import en un seul lancement');
    w2.c.IMPORT_BUDGET_MS = -1;
    const timed = w2.run(t2, CP, { resume: true });
    ok(timed.ok && timed.data.done && timed.data.operations === 0, 'un import déjà terminé se dit terminé même sans temps');
  });

  test('Aller-retour : la structure exportée, importée dans une installation neuve, recrée les mêmes équipes et les mêmes personnes dans leurs équipes', () => {
    const w = world();
    const be = w.mk('Bureau d’études', null, { cost_center: 'CC-10' }), calc = w.mk('Calcul', be, { manager_resource_id: w.remi.id }), ess = w.mk('Essais', be);
    w.put(w.remi, calc); w.put(w.mia, calc); w.put(w.carla, be); w.put(w.xavier, ess);
    const book = w.template();
    const d = freshCore();
    d.Session = { getActiveUser: () => ({ getEmail: () => ADMIN }), getEffectiveUser: () => ({ getEmail: () => ADMIN }), getScriptTimeZone: () => 'Europe/Paris' };
    d.SpreadsheetApp = w.c.SpreadsheetApp; d.IMPORT_DRIVE = { share() {}, moveToProjectFolder() {} };
    const call = (a, p) => { const r = d.handleRequest({ action: a, params: p, apiVersion: d.PPM_API_VERSION }, ADMIN); if (!r.ok) throw new Error(a + ' : ' + JSON.stringify(r.error)); return r.data; };
    const rep = call('teams.import.analyze', { book: book.id });
    ok(rep.ok, JSON.stringify(rep.errors.slice(0, 3)));
    eq(rep.counts, { teams: { create: 3, update: 0, same: 0 }, members: { create: 4, assign: 0, same: 0 } }, 'dans l’installation neuve : trois équipes et quatre personnes à créer');
    let r = call('teams.import.run', { book: book.id }), n = 1;
    while (!r.done && n < 20) { r = call('teams.import.run', { book: book.id, resume: true }); n++; }
    ok(r.done, 'importé en ' + n + ' lot(s)');
    const sig = (c) => c.repoList('HierarchicalTeam').map((q) => 'T|' + q.name + '|' + (q.parent_team_id ? c.repoGet('HierarchicalTeam', q.parent_team_id).name : '') + '|' + (q.manager_resource_id ? c.repoGet('Resource', q.manager_resource_id).email : '') + '|' + (q.cost_center || ''))
      .concat(c.repoList('Resource').filter((q) => q.team_id).map((q) => 'R|' + q.name + '|' + (q.email || '') + '|' + q.resource_type + '|' + c.repoGet('HierarchicalTeam', q.team_id).name)).sort();
    const src = sig(w.c), dst = sig(d);
    eq(dst.filter((l) => !src.includes(l)), [], 'rien dans l’installation neuve qui ne soit dans l’ancienne');
    eq(src.filter((l) => !dst.includes(l)), [], 'et rien dans l’ancienne qui manque dans la neuve');
    ok(src.length === 7, src.length + ' lignes comparées (trois équipes, quatre personnes)');
    ok(call('teams.import.analyze', { book: book.id }).nothing_to_do, 'l’installation neuve est à jour');
  });

  test('Créer une personne dans une équipe qui existe déjà ; les équipes créées à la main restent possibles ; l’import de projets rattache les personnes créées à une équipe importée', () => {
    const w = world(), calc = w.mk('Calcul');
    const made = w.call(CP, 'resources.create', { values: { name: 'Léa Durand', email: 'lea@entreprise.com', resource_type: 'Interne', team_id: calc.id } });
    eq(w.c.repoGet('Resource', made.id).team_id, calc.id, 'une ressource créée est attribuée à une équipe existante');
    eq(w.raw(CP, 'resources.create', { values: { name: 'Faux', resource_type: 'Interne', team_id: 'inconnue' } }).error.message, 'Équipe introuvable.', 'une équipe qui n’existe pas est refusée');
    const hand = w.call(CP, 'teams.create', { values: { name: 'Équipe à la main', parent_team_id: calc.id } });
    ok(hand.id && w.c.repoGet('HierarchicalTeam', hand.id).parent_team_id === calc.id, 'on peut toujours créer des équipes à la main, sous une équipe importée ou non');
    // l'import de projets : la colonne Équipe de l'onglet Personnes
    const t = w.call(CP, 'import.template', { projectId: w.p1.id });
    const sh = w.book(t).getSheetByName('Personnes');
    const header = w.book(t).getSheetByName('Personnes').getRange(1, 1, 1, 9).getValues()[0];
    eq(header[8], 'Équipe', 'l’onglet Personnes a une colonne Équipe');
    sh.getRange(sh.getLastRow() + 1, 1, 2, 9).setValues([['Nina Roux', 'nina@entreprise.com', 'Interne', '', '', 'FR', '', '', 'calcul'], ['Omar Test', 'omar@entreprise.com', 'Interne', '', '', 'FR', '', '', 'Équipe inconnue']]);
    const rep = w.raw(CP, 'import.analyze', { projectId: w.p1.id, book: t.id }).data;
    ok(rep.ok && /Personnes l\.\d+ : Équipe « Équipe inconnue » : introuvable, « Omar Test » est créée sans équipe/.test(msgs({ errors: rep.warnings }).join('\n')), 'une équipe inconnue : avertissement, la personne est créée sans équipe');
    const r = w.raw(CP, 'import.run', { projectId: w.p1.id, book: t.id });
    ok(r.ok, JSON.stringify(r.error));
    eq([w.c.findResourceByEmail('nina@entreprise.com').team_id, w.c.findResourceByEmail('omar@entreprise.com').team_id || ''], [calc.id, ''], 'la personne créée par l’import de projets reçoit l’équipe importée (sans tenir compte de la casse) ; l’inconnue, aucune');
    w.put(w.remi, calc);
    const again = w.call(CP, 'import.template', { projectId: w.p1.id });
    ok(w.rowsOf(again, 'Personnes').some((x) => x[1] === 'remi@entreprise.com' && x[8] === 'Calcul'), 'et l’export des projets écrit l’équipe de chaque personne');
  });
};
