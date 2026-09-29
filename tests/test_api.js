const { freshCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nAPI JSON');

  function world() {
    const c = freshCore();
    const call = (email, action, params, extra) => c.handleRequest(Object.assign({ action, params, apiVersion: '1.0' }, extra || {}), email);
    const S = { actor: 'setup', source: 'setup' };
    const alice = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Alice', email: 'alice@entreprise.com', country: 'FR' }, S);
    c.repoInsert('Resource', { resource_type: 'Interne', name: 'Bob', email: 'bob@entreprise.com', country: 'DE' }, S);
    const prog = call('admin@entreprise.com', 'programs.create', { values: { code: 'PG', name: 'Programme' } }).data;
    const proj = call('admin@entreprise.com', 'projects.create', {
      values: { code: 'P1', name: 'Projet 1', program_id: prog.id, manager_resource_id: alice.id, status: 'Actif', holiday_country: 'FR' }
    }).data;
    c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: proj.id }, S);
    return { c, call, alice, prog, proj };
  }

  test('Domaine obligatoire, action inconnue, version d’API', () => {
    const { call } = world();
    eq(call('eve@ailleurs.com', 'ping', {}).error.code, 'FORBIDDEN');
    eq(call('alice@entreprise.com', 'nope', {}).error.code, 'NOT_FOUND');
    eq(call('alice@entreprise.com', 'ping', {}, { apiVersion: '2.0' }).error.code, 'VALIDATION');
    ok(call('alice@entreprise.com', 'ping', {}).ok);
  });

  test('Le chef de projet crée ; un utilisateur sans rôle est refusé', () => {
    const { call, proj } = world();
    const r = call('alice@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: 'Spec' } });
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.status, r.data.progress_pct], ['À faire', 0]);
    eq(call('bob@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: 'X' } }).error.code, 'FORBIDDEN');
    eq(call('alice@entreprise.com', 'projects.create', { values: { code: 'P2', name: 'Autre', program_id: '' } }).error.code, 'FORBIDDEN');
  });

  test('me.roles renvoie les affectations actives', () => {
    const { call, proj } = world();
    const me = call('alice@entreprise.com', 'me.roles', {}).data;
    eq(me.assignments, [{ role_code: 'CP', scope_type: 'project', scope_id: proj.id }]);
    eq(call('admin@entreprise.com', 'me.roles', {}).data.isAdmin, true);
  });

  test('WBS limité à deux niveaux', () => {
    const { call, proj } = world();
    const w1 = call('alice@entreprise.com', 'workpackages.create', { values: { project_id: proj.id, name: 'N1' } }).data;
    const w2 = call('alice@entreprise.com', 'workpackages.create', { values: { project_id: proj.id, name: 'N2', parent_wp_id: w1.id } }).data;
    const w3 = call('alice@entreprise.com', 'workpackages.create', { values: { project_id: proj.id, name: 'N3', parent_wp_id: w2.id } });
    eq(w3.error.code, 'VALIDATION');
  });

  test('Dépendance circulaire refusée avant écriture', () => {
    const { c, call, proj } = world();
    const mk = (n) => call('alice@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: n } }).data;
    const a = mk('A'), b = mk('B');
    ok(call('alice@entreprise.com', 'dependencies.create', { values: { predecessor_id: a.id, successor_id: b.id } }).ok);
    const r = call('alice@entreprise.com', 'dependencies.create', { values: { predecessor_id: b.id, successor_id: a.id } });
    eq([r.error.code, r.error.details.rule], ['VALIDATION', 'CYCLE']);
    eq(c.repoList('Dependency').length, 1);
  });

  test('Avancement déclaré et requête rejouée sans doublon', () => {
    const { c, call, proj } = world();
    const l = call('alice@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: 'L' } }).data;
    const r1 = call('alice@entreprise.com', 'progress.declare', { planItemId: l.id, progressPct: 60 }, { requestId: 'req-1' });
    const r2 = call('alice@entreprise.com', 'progress.declare', { planItemId: l.id, progressPct: 60 }, { requestId: 'req-1' });
    eq(r1, r2);
    eq([r1.data.progress_pct, r1.data.status], [60, 'En cours']);
    eq(c.repoList('ProgressUpdate').length, 1);
    eq(call('bob@entreprise.com', 'progress.declare', { planItemId: l.id, progressPct: 80 }).error.code, 'FORBIDDEN');
  });

  test('Verrouillage optimiste via l’API', () => {
    const { call, proj } = world();
    const l = call('alice@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: 'L' } }).data;
    ok(call('alice@entreprise.com', 'planitems.update', { id: l.id, version: 1, patch: { name: 'L bis' } }).ok);
    const r = call('alice@entreprise.com', 'planitems.update', { id: l.id, version: 1, patch: { name: 'L ter' } });
    eq([r.error.code, r.error.details.currentVersion], ['CONFLICT', 2]);
  });

  test('Fil des changements paginé sans perte ni doublon', () => {
    const { c, call, proj } = world();
    for (let i = 0; i < 4; i++) {
      call('alice@entreprise.com', 'planitems.create', { values: { project_id: proj.id, item_type: 'Livrable', name: 'L' + i } });
    }
    const total = c.repoList('ChangeEvent').filter((e) => e.project_id === proj.id).length;
    const seen = [];
    let cursor = '';
    for (let guard = 0; guard < 20; guard++) {
      const r = call('alice@entreprise.com', 'changes.since', { projectId: proj.id, cursor, limit: 2 });
      if (!r.data.length) break;
      r.data.forEach((e) => seen.push(e.id));
      cursor = r.cursor;
    }
    eq(seen.length, total);
    eq(new Set(seen).size, total);
  });

  test('Demande de rebaselining : enregistrée et chef de projet prévenu', () => {
    const { c, call, proj } = world();
    const r = call('alice@entreprise.com', 'baselines.request', { projectId: proj.id, justification: 'Glissement fournisseur' });
    eq(r.data.status, 'Demandée');
    eq(c.SENT_MAILS.map((m) => m.to), ['alice@entreprise.com']);
    eq(call('bob@entreprise.com', 'baselines.request', { projectId: proj.id, justification: 'x' }).error.code, 'FORBIDDEN');
  });
};
