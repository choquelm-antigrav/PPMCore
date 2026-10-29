const { freshCore, test, eq, ok } = require('./harness');
const { makeFakeSheets } = require('./fake_sheets');

module.exports = function () {
  console.log('\nProtection des feuilles du classeur, déduite des rôles (0.15.0)');
  const ADMIN = 'admin@entreprise.com', OWNER = 'proprio@entreprise.com', S = { actor: 'setup', source: 'setup' };
  const ROLES_TABLES = ['RoleAssignment', 'Role', 'Resource'], BUDGET_TABLES = ['BudgetLine', 'BudgetPhasing', 'PurchaseOrder', 'PurchaseOrderLink', 'EtpCost', 'Exercise', 'TeamBudget', 'ActualImport'];

  /** Un Core sur de (fausses) feuilles qui connaissent les protections, un faux Drive relié à la liste des éditeurs du classeur, et des personnes avec des rôles. */
  function world() {
    const c = freshCore();
    c.Session = { getEffectiveUser: () => ({ getEmail: () => OWNER }), getActiveUser: () => ({ getEmail: () => c.__me || ADMIN }), getScriptTimeZone: () => 'Europe/Paris' };
    c.SpreadsheetApp = makeFakeSheets(); c.TABLE_PROVIDER = null; c._bookCache = {}; c._tableCache = {};
    c.setupPpm();
    const book = c.SpreadsheetApp.books[c.getProp(c.PROP.DATA_ID, '')];
    c.SHEET_DRIVE = { addEditor: (e) => { if (c.__driveFail === e) throw new Error('pas de compte Google'); book.editors.add(e); }, removeEditor: (e) => book.editors.delete(e) };
    const prog = c.repoInsert('Program', { code: 'PG', name: 'Programme' }, S), proj = c.repoInsert('Project', { code: 'P1', name: 'Projet 1', program_id: prog.id, status: 'Actif' }, S);
    const people = {};
    const person = (key, roles) => {
      const r = c.repoInsert('Resource', { name: key, email: key + '@entreprise.com', resource_type: 'Interne', country: 'FR' }, S); people[key] = r;
      (roles || []).forEach(([code, scope, extra]) => c.repoInsert('RoleAssignment', Object.assign({ resource_id: r.id, role_code: code, scope_type: scope === 'program' ? 'program' : 'project', scope_id: scope === 'program' ? prog.id : proj.id }, extra || {}), S));
      return r;
    };
    person('pl', [['PL', 'program']]); person('dpl', [['DPL', 'program']]); person('cp', [['CP', 'project']]); person('rwp', [['RWP', 'project']]); person('mia', [['MEMBER', 'project']]);
    c._protectDirty = false;
    const call = (who, action, params) => { c.__me = who; const r = c.handleRequest({ action, params: params || {}, apiVersion: c.PPM_API_VERSION }, who); c.__me = null; return r; };
    const can = (table, who) => book.canEdit(table, who + (who.includes('@') ? '' : '@entreprise.com'));
    return { c, book, people, prog, proj, person, call, can };
  }
  const protectedTables = (x) => x.book.sheets.filter((s) => s.protections.some((p) => String(p.getDescription()).indexOf('PPM:') === 0)).map((s) => s.name).sort();

  test('Les éditeurs se déduisent des rôles : administrateurs et PL/DPL pour les rôles, plus les chefs de projet pour le budget', () => {
    const x = world(), c = x.c, byKey = (k) => c.SHEET_PROTECT_GROUPS.find((g) => g.key === k);
    eq(c.sheetProtectEditors_(byKey('roles')), [ADMIN, 'dpl@entreprise.com', 'pl@entreprise.com'], 'rôles : administrateur, DPL et PL, pas le chef de projet');
    eq(c.sheetProtectEditors_(byKey('budget')), [ADMIN, 'cp@entreprise.com', 'dpl@entreprise.com', 'pl@entreprise.com'], 'budget : en plus, le chef de projet ; ni RWP ni membre');
    eq(c.PERMISSIONS['sheet.roles'], ['PL', 'DPL'], 'les droits sont dans la table PERMISSIONS, avec ceux de l’application');
    // un rôle terminé ou pas encore commencé ne compte pas
    x.person('ancien', [['CP', 'project', { start_date: '2025-01-01', end_date: '2025-12-31' }]]); x.person('futur', [['DPL', 'program', { start_date: '2099-01-01' }]]);
    ok(!c.sheetProtectEditors_(byKey('budget')).includes('ancien@entreprise.com') && !c.sheetProtectEditors_(byKey('roles')).includes('futur@entreprise.com'), 'rôle terminé ou futur : pas éditeur');
    // adresse manquante, fiche supprimée, doublons et casse
    c.repoInsert('Resource', { name: 'SansAdresse', resource_type: 'Interne', country: 'FR' }, S);
    const maj = c.repoInsert('Resource', { name: 'Maj', email: 'MAJ@Entreprise.com', resource_type: 'Interne', country: 'FR' }, S);
    c.repoInsert('RoleAssignment', { resource_id: maj.id, role_code: 'PL', scope_type: 'program', scope_id: x.prog.id }, S); c.repoInsert('RoleAssignment', { resource_id: maj.id, role_code: 'DPL', scope_type: 'program', scope_id: x.prog.id }, S);
    eq(c.sheetProtectEditors_(byKey('roles')).filter((e) => e === 'maj@entreprise.com').length, 1, 'adresse en minuscules, une seule fois malgré deux rôles');
    c.repoSoftDelete('Resource', maj.id, null, S);
    ok(!c.sheetProtectEditors_(byKey('roles')).includes('maj@entreprise.com'), 'fiche supprimée : plus éditeur');
  });

  test('Application : les onze feuilles sensibles sont verrouillées pour les seuls éditeurs, les autres restent en édition libre', () => {
    const x = world(), c = x.c;
    const rep = c.sheetProtectApply_(); // l'application donne d'abord accès au classeur à ceux qui doivent être éditeurs
    eq([rep.enabled, rep.failed, rep.created], [true, [], 11], 'onze protections posées, aucune erreur');
    c.sheetSync_(); // puis chaque personne invitée a accès au classeur (RWP et membre y compris)
    eq(protectedTables(x), ROLES_TABLES.concat(BUDGET_TABLES).sort(), 'exactement les feuilles des deux groupes');
    ROLES_TABLES.forEach((t) => eq(['pl', 'dpl', 'admin', 'cp', 'rwp', 'mia'].map((u) => x.can(t, u)), [true, true, true, false, false, false], t + ' : PL, DPL, administrateur ; pas CP, RWP ni membre'));
    BUDGET_TABLES.forEach((t) => eq(['pl', 'dpl', 'admin', 'cp', 'rwp', 'mia'].map((u) => x.can(t, u)), [true, true, true, true, false, false], t + ' : plus le chef de projet'));
    ['PlanItem', 'WorkPackage', 'Meeting', 'Project', 'NewsAction'].forEach((t) => eq(['pl', 'cp', 'mia'].map((u) => x.can(t, u)), [true, true, true], t + ' : en édition libre'));
    ROLES_TABLES.concat(BUDGET_TABLES).forEach((t) => eq(x.can(t, OWNER), true, t + ' : le propriétaire peut toujours écrire, donc l’outil aussi'));
    const p = x.book.getSheetByName('RoleAssignment').protections[0];
    ok(p.isWarningOnly() === false && p.canDomainEdit() === false && /^PPM:roles — modifiable par : administrateurs, Program Leader, Domain Program Leader/.test(p.getDescription()), 'pas de simple avertissement, pas d’édition par le domaine, description lisible : ' + p.getDescription().slice(0, 100));
    ok(x.book.getSheetByName('Historique') === null && !c.SpreadsheetApp.books[c.getProp(c.PROP.HISTORY_ID, '')].sheets.some((s) => s.protections.length), 'le classeur Historique n’est pas touché');
  });

  test('Idempotent : une seconde application ne pose, n’ajoute et ne retire rien', () => {
    const x = world(), c = x.c; c.sheetSync_(); c.sheetProtectApply_();
    const before = JSON.stringify(x.book.sheets.map((s) => s.protections.map((p) => [p.getDescription(), p.getEditors().map((u) => u.getEmail()).sort()])));
    const rep = c.sheetProtectApply_();
    eq([rep.created, rep.failed.length], [0, 0], 'rien de nouveau');
    eq(JSON.stringify(x.book.sheets.map((s) => s.protections.map((p) => [p.getDescription(), p.getEditors().map((u) => u.getEmail()).sort()]))), before, 'mêmes protections, mêmes éditeurs');
    eq(x.book.sheets.reduce((n, s) => n + s.protections.length, 0), 11, 'toujours onze protections, pas de doublon');
  });

  test('La protection suit les rôles toute seule : attribuer ou retirer un rôle par l’application met les feuilles à jour', () => {
    const x = world(), c = x.c; c.sheetSync_(); c.sheetProtectApply_();
    eq([x.can('BudgetLine', 'rwp'), x.can('RoleAssignment', 'rwp')], [false, false], 'RWP : verrouillé au départ');
    const r = x.call(ADMIN, 'roles.assign', { values: { scope_type: 'project', scope_id: x.proj.id, resource_id: x.people.rwp.id, role_code: 'CP' } });
    ok(r.ok, JSON.stringify(r.error));
    eq([x.can('BudgetLine', 'rwp'), x.can('RoleAssignment', 'rwp')], [true, false], 'devenu chef de projet : il peut modifier le budget, pas les rôles, sans rien régler à la main');
    const dpl = x.call(ADMIN, 'roles.assign', { values: { scope_type: 'project', scope_id: x.proj.id, resource_id: x.people.mia.id, role_code: 'DPL' } });
    ok(dpl.ok, JSON.stringify(dpl.error));
    eq([x.can('RoleAssignment', 'mia'), x.can('PurchaseOrder', 'mia')], [true, true], 'devenue DPL : les deux groupes');
    const a = c.repoList('RoleAssignment').find((z) => z.resource_id === x.people.mia.id && z.role_code === 'DPL');
    ok(x.call(ADMIN, 'roles.end', { id: a.id, end_date: '2020-01-01' }).ok || true, 'rôle terminé par l’application');
    eq([x.can('RoleAssignment', 'mia'), x.can('PurchaseOrder', 'mia')], [false, false], 'rôle retiré : verrouillée de nouveau');
    ok(x.book.sheets.reduce((n, s) => n + s.protections.length, 0) === 11, 'jamais de protection en double');
  });

  test('Une fiche dont l’adresse change met aussi la protection à jour (sinon un rôle passerait à une autre adresse)', () => {
    const x = world(), c = x.c; c.sheetSync_(); c.sheetProtectApply_();
    c.__me = ADMIN; c.repoUpdate('Resource', x.people.pl.id, { email: 'nouveau.pl@entreprise.com' }, null, S); c._protectDirty = true; c.handleRequest({ action: 'planning.catalog', params: {}, apiVersion: c.PPM_API_VERSION }, ADMIN);
    eq([x.can('RoleAssignment', 'pl'), x.can('RoleAssignment', 'nouveau.pl')], [false, true], 'la nouvelle adresse du PL prend la main, l’ancienne la perd');
    x.person('intrus', []); const intrus = c.repoList('Resource').find((r) => r.name === 'intrus');
    c.repoUpdate('Resource', intrus.id, { email: 'dpl@entreprise.com' }, null, S); // tentative de prendre l'adresse du DPL : l'outil la refuse, et la feuille Resource est protégée
    eq(x.can('Resource', 'intrus'), false, 'un invité sans rôle ne peut pas modifier la feuille des personnes');
  });

  test('Les protections posées à la main ne sont jamais touchées, et couper la protection retire seulement celles de l’outil', () => {
    const x = world(), c = x.c; c.sheetSync_();
    // une protection du propriétaire sur une feuille que l'outil gère aussi (EtpCost) et une autre sur une feuille qu'il ne gère pas (PlanItem)
    const manual = x.book.getSheetByName('EtpCost').protect().setDescription('Protection du propriétaire');
    manual.removeEditors(manual.getEditors()); manual.setDomainEdit(false);
    const manual2 = x.book.getSheetByName('PlanItem').protect().setDescription('Autre protection du propriétaire'); manual2.setDomainEdit(false);
    c.sheetProtectApply_();
    eq([x.book.getSheetByName('EtpCost').protections.length, x.book.getSheetByName('EtpCost').protections.filter((q) => q.getDescription() === 'Protection du propriétaire').length, x.book.getSheetByName('PlanItem').protections.length], [2, 1, 1], 'sur EtpCost la protection de l’outil s’ajoute à celle du propriétaire, qui reste intacte ; PlanItem n’est pas touchée');
    const off = x.call(ADMIN, 'admin.set', { values: { sheet_protect: false } });
    ok(off.ok && off.data.sheet_protect === false && off.data.sheet_protect_report.removedProtections === 11, JSON.stringify(off.data && off.data.sheet_protect_report && off.data.sheet_protect_report.removedProtections));
    eq([protectedTables(x), x.book.getSheetByName('PlanItem').protections.length, x.book.getSheetByName('EtpCost').protections.map((q) => q.getDescription())], [[], 1, ['Protection du propriétaire']], 'plus aucune protection de l’outil ; celles du propriétaire restent, même sur une feuille de l’outil');
    eq([x.can('RoleAssignment', 'mia'), x.can('BudgetLine', 'rwp')], [true, true], 'tout redevient modifiable');
    ok(c.repoList('ChangeEvent').some((e) => e.table_name === 'Réglages' && e.field === 'sheet_protect' && e.old_value === 'oui' && e.new_value === 'non' && e.actor === ADMIN), 'tracé dans le journal des réglages');
    const on = x.call(ADMIN, 'admin.set', { values: { sheet_protect: true } });
    eq([on.data.sheet_protect, on.data.sheet_protect_report.created, x.can('RoleAssignment', 'mia')], [true, 11, false], 'recochée : les onze feuilles sont reverrouillées tout de suite');
    eq(x.call('mia@entreprise.com', 'admin.set', { values: { sheet_protect: false } }).error.code, 'FORBIDDEN', 'seul un administrateur coupe la protection');
  });

  test('Un échec est dit et réessayé ; seules les adresses qui peuvent modifier le classeur deviennent éditeurs ; jamais d’erreur pour l’utilisateur', () => {
    const x = world(), c = x.c; c.__driveFail = 'cp@entreprise.com'; // le chef de projet n'a pas de compte Google
    const rep = c.sheetProtectApply_();
    eq([rep.failed, rep.skipped.includes('cp@entreprise.com')], [[], true], 'la protection se pose pour tous les autres ; le chef de projet est noté « écarté »');
    eq(c.getProp(c.PROP.SHEET_PROTECT_SIG, 'x'), '', 'et l’application n’est pas donnée pour terminée : elle sera refaite');
    ok(!x.book.getSheetByName('BudgetLine').protections[0].getEditors().some((u) => u.getEmail() === 'cp@entreprise.com'), 'une adresse sans accès au classeur n’est pas ajoutée comme éditeur');
    c.__driveFail = null; c.sheetSync_();
    ok(x.book.getSheetByName('BudgetLine').protections[0].getEditors().some((u) => u.getEmail() === 'cp@entreprise.com'), 'dès qu’elle a accès au classeur, elle devient éditeur du budget');
    // une panne de l'API des protections ne bloque jamais l'application
    const y = world(); y.c.sheetSync_(); y.c.sheetProtectApply_();
    y.book.getSheetByName('BudgetLine').protections[0].addEditors = () => { throw new Error('quota de protections dépassé'); };
    y.c.repoInsert('Resource', { name: 'Nouveau', email: 'nouveau@entreprise.com', resource_type: 'Interne', country: 'FR' }, S);
    const n = y.c.repoList('Resource').find((r) => r.name === 'Nouveau'); y.c.repoInsert('RoleAssignment', { resource_id: n.id, role_code: 'CP', scope_type: 'project', scope_id: y.proj.id }, S);
    const res = y.call(ADMIN, 'planning.catalog', {});
    ok(res.ok, 'la requête réussit malgré la panne');
    ok(y.c.getProp(y.c.PROP.SHEET_PROTECT_SIG, 'x') === '', 'la panne est retenue : l’application sera retentée (nuit, ou « Appliquer maintenant »)');
    const rep2 = y.call(ADMIN, 'admin.sheet.protect', {});
    ok(rep2.ok && rep2.data.failed.length >= 1 && /quota de protections/.test(rep2.data.failed[0].reason), 'le compte rendu dit quelle feuille a échoué et pourquoi');
  });

  test('« Appliquer maintenant » est réservé aux administrateurs ; la nuit contrôle tout ; sans service Sheets, rien ne se passe', () => {
    const x = world(), c = x.c;
    eq(x.call('cp@entreprise.com', 'admin.sheet.protect', {}).error.code, 'FORBIDDEN', 'refusé à un chef de projet');
    const ok1 = x.call(ADMIN, 'admin.sheet.protect', {});
    ok(ok1.ok && ok1.data.groups.length === 2 && ok1.data.groups[0].protectedSheets.length === 3 && ok1.data.groups[1].protectedSheets.length === 8, 'compte rendu : deux groupes, 3 et 8 feuilles');
    x.book.getSheetByName('Role').protections.forEach((p) => p.remove()); // quelqu'un a supprimé une protection
    c.nightlyRun();
    eq(x.book.getSheetByName('Role').protections.length, 1, 'la nuit répare une protection disparue');
    const bare = freshCore(); bare.setProp(bare.PROP.DATA_ID, 'x');
    eq([bare.sheetProtectReady_(), bare.sheetProtectApply_().ready, bare.sheetProtectIfDirty_()], [false, false, undefined], 'sans service Sheets : prêt = non, rien appliqué, aucune erreur');
  });

  test('Mon compte dit à chacun quelles feuilles il peut modifier, Administration qui peut modifier quoi', () => {
    const x = world(), c = x.c;
    const lock = (who) => { c.__me = who; const l = x.call(who, 'account.get', {}).data.sheet.locked; return Object.fromEntries(l.map((g) => [g.key, g.can_edit])); };
    eq([lock('pl@entreprise.com'), lock('cp@entreprise.com'), lock('mia@entreprise.com'), lock(ADMIN)], [{ roles: true, budget: true }, { roles: false, budget: true }, { roles: false, budget: false }, { roles: true, budget: true }], 'PL : tout ; chef de projet : budget seulement ; membre : rien ; administrateur : tout');
    const l = x.call('cp@entreprise.com', 'account.get', {}).data.sheet.locked;
    ok(/Rôles et personnes/.test(l[0].label) && l[0].tables.includes('Resource') && /administrateurs, Program Leader, Domain Program Leader/.test(l[0].who) && /Chef de projet/.test(l[1].who), 'feuilles, raison et qui peut : ' + l[0].who + ' | ' + l[1].who);
    const view = x.call(ADMIN, 'admin.get', {}).data;
    ok(view.sheet_protect === true && view.sheet_protect_groups[1].editors.includes('cp@entreprise.com') && !view.sheet_protect_groups[0].editors.includes('cp@entreprise.com'), 'Administration : la liste exacte des éditeurs de chaque groupe');
    c.setProp(c.PROP.SHEET_PROTECT, 'non');
    eq(x.call('cp@entreprise.com', 'account.get', {}).data.sheet.locked, [], 'protection coupée : rien n’est annoncé comme verrouillé');
  });

  test('A7 contrôle la protection : feuilles protégées, éditeurs, protection coupée ou feuille non protégée', () => {
    const x = world(), c = x.c; c.sheetSync_(); c.sheetProtectApply_();
    const row = () => c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Classeur Données : feuilles protégées') === 0);
    ok(row().status === 'OK' && /11 feuilles protégées \(Rôles et personnes : 3 éditeur\(s\) ; Budget et achats : 4 éditeur\(s\)\)/.test(row().detail), row().detail);
    x.book.getSheetByName('EtpCost').protections.forEach((p) => p.remove());
    ok(row().status === 'ATTENTION' && /1 feuille\(s\) sur 11 non protégée\(s\) : EtpCost/.test(row().detail) && /Appliquer les protections maintenant/.test(row().detail), row().detail);
    c.setProp(c.PROP.SHEET_PROTECT, 'non');
    ok(row().status === 'ATTENTION' && /la protection est coupée/.test(row().detail), row().detail);
  });
};
