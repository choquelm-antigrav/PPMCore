const { freshCore, loadCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nMarges et chemin critique');
  const c = loadCore();
  const L = (id, s, f, extra) => Object.assign({ id, project_id: 'P', item_type: 'Livrable', name: id, planned_start: s, planned_finish: f }, extra || {});
  const J = (id, d, extra) => Object.assign({ id, project_id: 'P', item_type: 'Jalon', name: id, planned_start: d, planned_finish: d }, extra || {});
  const D = (from, to, type, lag) => ({ id: from + '>' + to, predecessor_id: from, successor_id: to, dep_type: type || 'FS', lag_days: lag || 0 });
  const floatsOf = (r) => Object.fromEntries(Object.entries(r.byId).map(([k, v]) => [k, v.float]));

  test('Chaîne tendue critique, élément en avance avec marge', () => {
    // Semaine du lundi 5 octobre 2026 ; A → B → M tendu, C et D ont de la marge.
    const items = [L('A', '2026-10-05', '2026-10-09'), L('B', '2026-10-12', '2026-10-16'), J('M', '2026-10-19'),
      L('C', '2026-10-05', '2026-10-07'), L('D', '2026-10-05', '2026-10-06')];
    const r = c.computeFloats(items, [D('A', 'B'), D('B', 'M'), D('C', 'B')], null);
    eq(r.anchor, '2026-10-19');
    eq(floatsOf(r), { A: 0, B: 0, M: 0, C: 2, D: 9 });
    eq(r.criticalIds.slice().sort(), ['A', 'B', 'M']);
  });

  test('Dépendance violée : marge négative, le reste se détend', () => {
    const items = [L('B', '2026-10-12', '2026-10-16'), J('M', '2026-10-19'), L('E', '2026-10-14', '2026-10-20')];
    const r = c.computeFloats(items, [D('B', 'M'), D('E', 'M')], null);
    // La fin du plan devient le 20 (fin de E) : M peut glisser au 20, E devrait finir le 19.
    eq(r.anchor, '2026-10-20');
    eq(r.byId.E.float, -1, 'E finit trop tard pour son successeur');
    eq(r.byId.M.float, 1);
    eq(r.byId.B.float, 1);
    eq(r.criticalIds, ['E']);
  });

  test('SS avec décalage et FF', () => {
    const items = [L('P1', '2026-10-05', '2026-10-09'), L('Q', '2026-10-07', '2026-10-16'), L('R', '2026-10-05', '2026-10-14')];
    const r = c.computeFloats(items, [D('P1', 'Q', 'SS', 2), D('R', 'Q', 'FF', 0)], null);
    eq(floatsOf(r), { P1: 0, Q: 0, R: 2 });
  });

  test('Voisin d’un autre projet : contrainte fixe, sans marge propre', () => {
    const items = [L('Z', '2026-10-05', '2026-10-16'), L('Y', '2026-10-05', '2026-10-08'),
      L('X', '2026-10-12', '2026-10-30', { project_id: 'AUTRE', external: true })];
    const r = c.computeFloats(items, [D('Y', 'X')], null);
    eq(r.anchor, '2026-10-16', 'le voisin externe ne fixe pas la fin du plan');
    eq(r.byId.Y.float, 1);
    eq(r.byId.X.float, null);
  });

  test('Terminé ou sans dates : pas de marge ; fériés du calendrier respectés', () => {
    const hol = c.holidayMap(c.holidaysFor('FR', 2026));
    const items = [L('T', '2026-11-02', '2026-11-06', { status: 'Terminé' }), L('N', '2026-11-09', '2026-11-10'),
      L('S', '2026-11-12', '2026-11-13'), L('V', '', '')];
    const r = c.computeFloats(items, [D('T', 'N'), D('N', 'S'), D('V', 'S')], () => hol);
    eq(r.byId.T.float, null);
    eq(r.byId.V.float, null);
    eq(r.byId.N.float, 0, 'le 11 novembre est férié : N est collé à S');
    eq(c.workingDayOffset('2026-11-10', '2026-11-12', hol), 1);
    eq(c.workingDayOffset('2026-11-12', '2026-11-10', hol), -1);
  });

  console.log('\nVues du lot 1 (Gantt, programme, organisation)');

  function world() {
    const c = freshCore();
    const call = (email, action, params) => c.handleRequest({ action, params, apiVersion: '1.0' }, email);
    const S = { actor: 'setup', source: 'setup' };
    const alice = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Alice', email: 'alice@entreprise.com', country: 'FR' }, S);
    const bob = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Bob', email: 'bob@entreprise.com', country: 'DE' }, S);
    const dan = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Dan', email: 'dan@entreprise.com', country: 'FR' }, S);
    const A = 'admin@entreprise.com';
    const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme' } }).data;
    const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Projet 1', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id, end_date: '2026-10-16' } }).data;
    const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Projet 2', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } }).data;
    c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
    c.repoInsert('RoleAssignment', { resource_id: dan.id, role_code: 'DPL', scope_type: 'program', scope_id: prog.id }, S);
    const wp = (project, name, code, parent) => call(A, 'workpackages.create', { values: { project_id: project.id, name, wbs_code: code, parent_wp_id: parent || '' } }).data;
    const item = (project, name, type, s, f, wpId, extra) => call(A, 'planitems.create', { values: Object.assign({ project_id: project.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wpId || '', owner_resource_id: alice.id }, extra || {}) }).data;
    const dep = (a, b, type) => call(A, 'dependencies.create', { values: { predecessor_id: a.id, successor_id: b.id, dep_type: type || 'FS' } }).data;

    const w2 = wp(p1, 'Essais', '2');
    const w1 = wp(p1, 'Conception', '1');
    const w11 = wp(p1, 'Structure', '1.1', w1.id);
    const spec = item(p1, 'Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id);
    const plan = item(p1, 'Plans structure', 'Livrable', '2026-10-12', '2026-10-16', w11.id);
    const test = item(p1, 'Essai statique', 'Livrable', '2026-10-12', '2026-10-13', w2.id);
    const rev = item(p1, 'Revue CDR', 'Jalon', '2026-10-19', '2026-10-19', '');
    const late = item(p1, 'Note de calcul', 'Livrable', '2026-09-21', '2026-10-02', w1.id);
    const outil = item(p2, 'Outillage', 'Livrable', '2026-10-01', '2026-10-14', '');
    dep(spec, plan); dep(plan, rev); dep(outil, test);
    return { c, call, A, alice, bob, dan, prog, p1, p2, w1, w11, w2, spec, plan, test, rev, late, outil };
  }

  test('Gantt projet : ordre WBS, chemin critique, retard, voisin externe', () => {
    const { call, p1, spec, plan, rev, late, test, outil } = world();
    const g = call('alice@entreprise.com', 'gantt.project', { projectId: p1.id });
    ok(g.ok, JSON.stringify(g.error));
    const d = g.data;
    eq(d.rows.map((r) => r.kind + ':' + r.name), [
      'wp:Conception', 'item:Note de calcul', 'item:Spécification', 'wp:Structure', 'item:Plans structure',
      'wp:Essais', 'item:Essai statique', 'wp:Hors workpackage', 'item:Revue CDR', 'external:Outillage'
    ]);
    eq(d.rows.find((r) => r.name === 'Structure').level, 1);
    const row = (id) => d.rows.find((r) => r.id === id);
    eq([row(spec.id).critical, row(plan.id).critical, row(rev.id).critical], [true, true, true]);
    eq(row(late.id).late, true);
    eq(row(test.id).violated, true, 'l’outillage de P2 finit après le début de l’essai');
    eq(row(outil.id).project_code, 'P2');
    eq(d.anchor, '2026-10-19');
    eq(d.stats.beyondEnd, true, 'la revue tombe après la date de fin du projet');
    eq(d.dependencies.length, 3);
    eq(d.rows[0].start, '2026-09-21');
    eq(d.rows[0].finish, '2026-10-16', 'le WP parent couvre son sous-WP');
  });

  test('Gantt projet : droits d’édition calculés par élément', () => {
    const { call, p1, spec } = world();
    const asAlice = call('alice@entreprise.com', 'gantt.project', { projectId: p1.id }).data;
    const asBob = call('bob@entreprise.com', 'gantt.project', { projectId: p1.id }).data;
    ok(asAlice.canEditProject);
    ok(asAlice.rows.find((r) => r.id === spec.id).canEdit);
    ok(!asBob.canEditProject);
    ok(!asBob.rows.find((r) => r.id === spec.id).canEdit);
    ok(!asBob.rows.find((r) => r.id === spec.id).canDeclare);
  });

  test('Déplacement depuis le Gantt : violation signalée, aucune date propagée', () => {
    const { call, p1, spec, plan } = world();
    const cur = call('alice@entreprise.com', 'planitems.get', { id: spec.id }).data;
    const r = call('alice@entreprise.com', 'planitems.update', { id: spec.id, version: cur.version, patch: { planned_start: '2026-10-07', planned_finish: '2026-10-13' } });
    ok(r.ok, JSON.stringify(r.error));
    const d = call('alice@entreprise.com', 'gantt.project', { projectId: p1.id }).data;
    const v = d.violations.filter((x) => x.predecessor_name === 'Spécification');
    eq(v.length, 1);
    eq([v[0].successor_name, v[0].required, v[0].gap_days], ['Plans structure', '2026-10-14', 2]);
    eq(d.rows.find((x) => x.id === plan.id).start, '2026-10-12', 'le successeur n’a pas bougé (H7)');
    eq(d.rows.find((x) => x.id === spec.id).float, -2);
  });

  test('Vue programme : projets, jalons, dépendances entre projets', () => {
    const { call, prog, p1, p2 } = world();
    const v = call('bob@entreprise.com', 'gantt.program', { programId: prog.id });
    ok(v.ok, JSON.stringify(v.error));
    const d = v.data;
    eq(d.projects.map((p) => p.code), ['P1', 'P2']);
    const r1 = d.projects.find((p) => p.id === p1.id);
    eq([r1.start, r1.finish, r1.late], ['2026-09-21', '2026-10-19', 1]);
    eq(r1.milestones.map((m) => m.name), ['Revue CDR']);
    eq(d.crossDependencies.length, 1);
    eq([d.crossDependencies[0].from_project, d.crossDependencies[0].to_project], [p2.id, p1.id]);
    eq(d.crossDependencies[0].violated, true, 'l’outillage finit le 14, l’essai commence le 12');
    eq(d.projects.find((p) => p.id === p2.id).items, 1);
  });

  test('Organisation : attribution par rang, doublon refusé, fin d’affectation', () => {
    const { call, prog, p1, bob, dan } = world();
    const asAlice = (a, p) => call('alice@entreprise.com', a, p);
    const r = asAlice('roles.assign', { values: { resource_id: bob.id, role_code: 'MEMBER', scope_type: 'project', scope_id: p1.id } });
    ok(r.ok, JSON.stringify(r.error));
    eq(asAlice('roles.assign', { values: { resource_id: bob.id, role_code: 'MEMBER', scope_type: 'project', scope_id: p1.id } }).error.code, 'VALIDATION');
    eq(asAlice('roles.assign', { values: { resource_id: bob.id, role_code: 'DPL', scope_type: 'project', scope_id: p1.id } }).error.code, 'FORBIDDEN');
    eq(asAlice('roles.assign', { values: { resource_id: bob.id, role_code: 'CP', scope_type: 'program', scope_id: prog.id } }).error.code, 'FORBIDDEN');
    ok(call('dan@entreprise.com', 'roles.assign', { values: { resource_id: bob.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id } }).ok);

    const obs = call('bob@entreprise.com', 'obs.list', { scopeType: 'program', scopeId: prog.id }).data;
    eq(obs.map((o) => o.role_code + ':' + o.resource_name), ['DPL:Dan', 'CP:Alice', 'CP:Bob', 'MEMBER:Bob']);

    const member = obs.find((o) => o.role_code === 'MEMBER');
    ok(asAlice('roles.end', { id: member.id, version: member.version }).ok);
    const after = call('bob@entreprise.com', 'obs.list', { scopeType: 'project', scopeId: p1.id }).data;
    eq(after.map((o) => o.role_code + ':' + o.resource_name), ['CP:Alice', 'CP:Bob']);
    eq(call('eve@entreprise.com', 'roles.end', { id: after[0].id, version: after[0].version }).error.code, 'FORBIDDEN');
    void dan;
  });

  test('Catalogue et appel depuis la page web (uiCall)', () => {
    const { c, prog } = world();
    c.Session = { getActiveUser: () => ({ getEmail: () => 'Bob@Entreprise.com' }) };
    const cat = c.uiCall('planning.catalog', {});
    ok(cat.ok);
    eq(cat.data.programs.map((p) => p.id), [prog.id]);
    eq(cat.data.projects.length, 2);
    c.Session = { getActiveUser: () => ({ getEmail: () => '' }) };
    eq(c.uiCall('ping', {}).error.code, 'FORBIDDEN', 'compte hors domaine ou non identifié');
  });

  test('Amorce de la page : JSON sans échappement possible hors du script', () => {
    const c = loadCore();
    const out = c.safeJsonForScript({ project: '</script><script>alert(1)</script>' });
    ok(out.indexOf('<') < 0 && out.indexOf('>') < 0, out);
    eq(JSON.parse(out).project, '</script><script>alert(1)</script>');
    eq(c.cleanId_('abc-12_3"><x'), 'abc-12_3x');
  });

  test('Rôle attribué dans AppSheet : auto-nomination et rang contrôlés par le Core', () => {
    const { c, prog, p1, alice, bob } = world();
    const tbl = c.getTable('RoleAssignment');
    const add = (vals) => { const id = 'ra-' + Math.random().toString(36).slice(2); tbl.appendRows([Object.assign({ id }, vals)]); return id; };
    // Alice (CP de P1) se nomme DPL du programme dans AppSheet : annulé.
    const self = add({ resource_id: alice.id, role_code: 'DPL', scope_type: 'program', scope_id: prog.id });
    eq(c.onRowChanged('RoleAssignment', self, 'alice@entreprise.com'), 'CREATED');
    ok(c.isTrue(c.repoGet('RoleAssignment', self).deleted), 'auto-nomination annulée');
    ok(c.SENT_MAILS.some((m) => m.to === 'alice@entreprise.com' && /annulée/.test(m.subject)), 'auteur prévenu');
    // Alice nomme Bob membre de P1 : accepté.
    const okId = add({ resource_id: bob.id, role_code: 'MEMBER', scope_type: 'project', scope_id: p1.id });
    c.onRowChanged('RoleAssignment', okId, 'alice@entreprise.com');
    ok(!c.isTrue(c.repoGet('RoleAssignment', okId).deleted), 'attribution légitime conservée');
  });
};
