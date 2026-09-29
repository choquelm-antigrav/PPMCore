const { freshCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nPersonnes, OBS, WBS et préférences d’affichage');

  function world() {
    const c = freshCore();
    const S = { actor: 'setup', source: 'setup' };
    const call = (email, action, params) => c.handleRequest({ action, params, apiVersion: '1.0' }, email);
    const A = 'admin@entreprise.com';
    const res = (name, extra) => c.repoInsert('Resource', Object.assign({ resource_type: 'Interne', name, country: 'FR' }, extra || {}), S);
    const team = c.repoInsert('HierarchicalTeam', { name: 'Bureau d’études' }, S);
    const anna = res('Anna', { email: 'anna@entreprise.com', job_function: 'Directrice de programme', organization: 'Maison mère' });
    const dan = res('Dan', { email: 'dan@entreprise.com', job_function: 'Responsable de domaine', organization: 'Maison mère', team_id: team.id });
    const alice = res('Alice', { email: 'alice@entreprise.com', job_function: 'Cheffe de projet', organization: 'Bureau d’études', team_id: team.id });
    const bob = res('Bob', { email: 'bob@entreprise.com', job_function: 'Planificateur', organization: 'Bureau d’études' });
    const carl = res('Carl', { resource_type: 'Externe', country: 'DE', job_function: 'Ingénieur essais', organization: 'Sous-traitant Alpha', supplier: 'Alpha GmbH' });
    const eve = res('Eve', { email: 'eve@entreprise.com' });
    const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme' } }).data;
    const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Projet 1', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } }).data;
    const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Projet 2', program_id: prog.id, status: 'Actif' } }).data;
    const role = (r, code, type, id, extra) => c.repoInsert('RoleAssignment', Object.assign({ resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, extra || {}), S);
    role(anna, 'PL', 'program', prog.id);
    role(dan, 'DPL', 'program', prog.id);
    role(alice, 'CP', 'project', p1.id);
    role(bob, 'CP', 'project', p1.id);
    const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1', owner_resource_id: alice.id, charge_code: 'C-1' } }).data;
    const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Structure', wbs_code: '1.1', parent_wp_id: w1.id, owner_resource_id: carl.id } }).data;
    role(carl, 'RWP', 'workpackage', w11.id);
    role(eve, 'MEMBER', 'project', p1.id);
    role(eve, 'MEMBER', 'workpackage', w11.id);
    return { c, call, S, A, team, anna, dan, alice, bob, carl, eve, prog, p1, p2, w1, w11 };
  }

  // ------------------------------------------------------------ personnes
  test('Fonction et organisation : saisie, nettoyage des espaces, longueur maximale', () => {
    const { c, call } = world();
    const r = call('alice@entreprise.com', 'resources.create', { values: { resource_type: 'Interne', name: 'Zoé', email: 'Zoe@Entreprise.com', job_function: '  Ingénieure   qualité ', organization: ' Alpha  ' } });
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.job_function, r.data.organization, r.data.email], ['Ingénieure qualité', 'Alpha', 'zoe@entreprise.com']);
    eq(call('alice@entreprise.com', 'resources.create', { values: { resource_type: 'Interne', name: 'Zoé bis', email: 'zoe@entreprise.com' } }).error.code, 'VALIDATION');
    eq(call('alice@entreprise.com', 'resources.create', { values: { resource_type: 'Interne', name: 'Trop long', organization: 'x'.repeat(81) } }).error.code, 'VALIDATION');
    void c;
  });

  test('Qui peut modifier une fiche : soi-même (fonction, organisation), les CP, DPL et PL pour toute fiche', () => {
    const { call, bob, eve, alice } = world();
    const get = (id) => call('alice@entreprise.com', 'resources.list', { q: id }).data.find((p) => p.resource_id === id);
    const self = call('eve@entreprise.com', 'resources.update', { id: eve.id, patch: { job_function: 'Analyste', organization: 'Alpha' } });
    ok(self.ok, JSON.stringify(self.error));
    eq([self.data.job_function, self.data.organization], ['Analyste', 'Alpha']);
    const noName = call('eve@entreprise.com', 'resources.update', { id: eve.id, patch: { name: 'Autre nom' } });
    eq(noName.error.code, 'FORBIDDEN');
    ok(/fonction et votre organisation/.test(noName.error.message), noName.error.message);
    eq(call('eve@entreprise.com', 'resources.update', { id: bob.id, patch: { job_function: 'X' } }).error.code, 'FORBIDDEN');
    ok(call('alice@entreprise.com', 'resources.update', { id: bob.id, patch: { job_function: 'Planificateur senior', country: 'DE' } }).ok);
    ok(call('dan@entreprise.com', 'resources.update', { id: alice.id, patch: { organization: 'Bureau d’études Nord' } }).ok);
    eq(call('alice@entreprise.com', 'resources.update', { id: bob.id, patch: { email: 'autre@entreprise.com' } }).error.code, 'FORBIDDEN');
    eq(call('alice@entreprise.com', 'resources.update', { id: bob.id, version: 1, patch: { job_function: 'Y' } }).error.code, 'CONFLICT');
    void get;
  });

  test('resources.list : recherche, droits d’édition, pas de profil tarifaire', () => {
    const { c, call, eve } = world();
    c.repoUpdate('Resource', eve.id, { rate_profile: 'Senior' }, null, { actor: 'x', source: 'core' });
    const asEve = call('eve@entreprise.com', 'resources.list', { q: 'alpha' }).data;
    eq(asEve.map((p) => p.name), ['Carl']);
    ok(!asEve[0].canEdit);
    const all = call('alice@entreprise.com', 'resources.list', {}).data;
    ok(all.every((p) => p.canEdit), 'un chef de projet peut modifier toutes les fiches');
    ok(all.every((p) => !('rate_profile' in p)), 'le profil tarifaire n’est pas exposé');
    eq(call('eve@entreprise.com', 'resources.list', {}).data.filter((p) => p.canEdit).map((p) => p.name), ['Eve']);
  });

  test('Fiche saisie dans AppSheet : modification, création et champ interdits annulés, avec mail', () => {
    const { c, bob, eve } = world();
    const tbl = c.getTable('Resource');
    const edit = (id, patch) => { const n = tbl.findRow(id); tbl.writeRow(n, Object.assign(tbl.readRow(n), patch)); };
    // Eve modifie sa fonction : acceptée.
    edit(eve.id, { job_function: 'Analyste' });
    eq(c.onRowChanged('Resource', eve.id, 'eve@entreprise.com'), 'UPDATED');
    eq(c.repoGet('Resource', eve.id).job_function, 'Analyste');
    // Eve change son pays en plus : le pays revient, la fonction reste.
    edit(eve.id, { job_function: 'Analyste senior', country: 'UK' });
    c.onRowChanged('Resource', eve.id, 'eve@entreprise.com');
    const e1 = c.repoGet('Resource', eve.id);
    eq([e1.job_function, e1.country], ['Analyste senior', 'FR']);
    ok(c.SENT_MAILS.some((m) => m.to === 'eve@entreprise.com' && /annulée/.test(m.subject)));
    // Eve modifie Bob : annulé.
    edit(bob.id, { organization: 'Pirate' });
    c.onRowChanged('Resource', bob.id, 'eve@entreprise.com');
    eq(c.repoGet('Resource', bob.id).organization, 'Bureau d’études');
    // Eve ajoute une personne : annulé.
    tbl.appendRows([{ id: 'new-1', resource_type: 'Interne', name: 'Intrus' }]);
    c.onRowChanged('Resource', 'new-1', 'eve@entreprise.com');
    ok(c.isTrue(c.repoGet('Resource', 'new-1').deleted));
    // Alice (chef de projet) modifie Bob : acceptée.
    edit(bob.id, { organization: 'Bureau d’études Sud' });
    c.onRowChanged('Resource', bob.id, 'alice@entreprise.com');
    eq(c.repoGet('Resource', bob.id).organization, 'Bureau d’études Sud');
  });

  // ------------------------------------------------------------ OBS par rôles
  const shape = (t) => t.nodes.map((n) => n.role_code + '@' + n.scope_label.split(' ')[0] + ':' + n.people.map((p) => p.name).join('+') + '<' + (t.nodes.find((x) => x.id === n.parent) || { role_code: '', scope_label: '' }).role_code);

  test('OBS d’un programme : chaque rôle a pour parent le rôle supérieur qui le couvre', () => {
    const { call, prog } = world();
    const t = call('alice@entreprise.com', 'obs.tree', { scopeType: 'program', scopeId: prog.id }).data;
    eq(shape(t), [
      'PL@PG:Anna<', 'DPL@PG:Dan<PL', 'CP@P1:Alice+Bob<DPL', 'RWP@1.1:Carl<CP', 'MEMBER@1.1:Eve<RWP', 'MEMBER@P1:Eve<CP'
    ]);
    eq(t.stats, { nodes: 6, people: 7 });
    const carl = t.nodes.find((n) => n.role_code === 'RWP').people[0];
    eq([carl.job_function, carl.organization, carl.resource_type, carl.country, carl.supplier], ['Ingénieur essais', 'Sous-traitant Alpha', 'Externe', 'DE', 'Alpha GmbH']);
    eq(t.nodes.find((n) => n.role_code === 'DPL').people[0].team, 'Bureau d’études');
  });

  test('OBS d’un projet ou d’un WP : les rôles au-dessus restent affichés, pas ceux d’à côté', () => {
    const { c, call, p1, p2, w11, carl } = world();
    const S = { actor: 's', source: 'setup' };
    c.repoInsert('RoleAssignment', { resource_id: carl.id, role_code: 'CP', scope_type: 'project', scope_id: p2.id }, S);
    const t = call('alice@entreprise.com', 'obs.tree', { scopeType: 'project', scopeId: p1.id }).data;
    eq(shape(t).filter((s) => s.indexOf('@P2') >= 0), [], 'le chef de projet de P2 n’apparaît pas');
    ok(t.nodes.some((n) => n.role_code === 'PL'), 'le PL du programme apparaît au-dessus');
    const w = call('alice@entreprise.com', 'obs.tree', { scopeType: 'workpackage', scopeId: w11.id }).data;
    eq(shape(w), ['PL@PG:Anna<', 'DPL@PG:Dan<PL', 'CP@P1:Alice+Bob<DPL', 'RWP@1.1:Carl<CP', 'MEMBER@1.1:Eve<RWP', 'MEMBER@P1:Eve<CP']);
    eq(call('alice@entreprise.com', 'obs.tree', { scopeType: 'project', scopeId: 'inconnu' }).error.code, 'NOT_FOUND');
    eq(call('alice@entreprise.com', 'obs.tree', { scopeType: 'planitem', scopeId: p1.id }).error.code, 'VALIDATION');
  });

  test('OBS : affectation terminée, périmètre supprimé et personne supprimée ignorés', () => {
    const { c, call, prog, dan, bob, w11 } = world();
    const S = { actor: 's', source: 'setup' };
    const ra = c.repoList('RoleAssignment', (a) => a.resource_id === dan.id)[0];
    c.repoUpdate('RoleAssignment', ra.id, { end_date: '2026-09-01' }, null, S);
    c.repoSoftDelete('Resource', bob.id, null, S);
    c.repoSoftDelete('WorkPackage', w11.id, null, S);
    const t = call('alice@entreprise.com', 'obs.tree', { scopeType: 'program', scopeId: prog.id }).data;
    eq(shape(t), ['PL@PG:Anna<', 'CP@P1:Alice<PL', 'MEMBER@P1:Eve<CP']);
  });

  // ------------------------------------------------------------ OBS par équipes
  test('OBS par équipes : hiérarchie, responsable à part, sans équipe, branche, cycle toléré', () => {
    const { c, call, S, team, dan, alice, bob } = world();
    const t2 = c.repoInsert('HierarchicalTeam', { name: 'Conception', parent_team_id: team.id, manager_resource_id: alice.id, cost_center: 'CC-10' }, S);
    const t3 = c.repoInsert('HierarchicalTeam', { name: 'Structure', parent_team_id: t2.id }, S);
    c.repoUpdate('Resource', bob.id, { team_id: t2.id }, null, S);
    c.repoUpdate('Resource', dan.id, { team_id: team.id }, null, S);
    c.repoUpdate('HierarchicalTeam', team.id, { manager_resource_id: dan.id }, null, S);
    const full = call('alice@entreprise.com', 'obs.teams', {}).data;
    eq(full.nodes.map((n) => n.name + '<' + (full.nodes.find((x) => x.id === n.parent) || { name: '' }).name), [
      'Bureau d’études<', 'Conception<Bureau d’études', 'Structure<Conception', 'Sans équipe<'
    ]);
    const conc = full.nodes.find((n) => n.name === 'Conception');
    eq([conc.manager.name, conc.members.map((m) => m.name), conc.member_count, conc.cost_center], ['Alice', ['Bob'], 1, 'CC-10']);
    const root = full.nodes.find((n) => n.name === 'Bureau d’études');
    eq(root.manager.name, 'Dan');
    ok(!root.members.some((m) => m.name === 'Dan'), 'le responsable n’est pas compté deux fois');
    eq(root.members.map((m) => m.name), ['Alice'], 'Alice dirige Conception mais appartient à l’équipe racine');
    ok(full.nodes.find((n) => n.name === 'Sans équipe').members.length >= 3);
    eq(full.teams.map((t) => t.depth), [0, 1, 2]);
    const branch = call('alice@entreprise.com', 'obs.teams', { rootTeamId: t2.id }).data;
    eq(branch.nodes.map((n) => n.name), ['Conception', 'Structure']);
    eq(branch.nodes[0].parent, '', 'la racine de la branche n’a pas de parent');
    // Cycle : Bureau d’études devient enfant de Structure.
    c.repoUpdate('HierarchicalTeam', team.id, { parent_team_id: t3.id }, null, S);
    const cyc = call('alice@entreprise.com', 'obs.teams', {}).data;
    ok(cyc.nodes.filter((n) => n.name !== 'Sans équipe').every((n) => cyc.nodes.some((x) => x.id === n.parent) || n.parent === ''), 'arbre dessinable malgré le cycle');
    eq(call('alice@entreprise.com', 'obs.teams', { rootTeamId: 'zzz' }).error.code, 'NOT_FOUND');
  });

  // ------------------------------------------------------------ WBS
  test('WBS : projet, workpackages, sous-WP, éléments ; synthèses, responsables et organisations', () => {
    const { c, call, S, p1, w1, w11, alice, carl } = world();
    const it = (name, type, s, f, wp, owner, extra) => c.repoInsert('PlanItem', Object.assign({ project_id: p1.id, wp_id: wp || '', item_type: type, name, planned_start: s, planned_finish: f, owner_resource_id: owner || '', status: 'À faire', progress_pct: 0 }, extra || {}), S);
    const a = it('Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id, alice.id, { progress_pct: 100, status: 'Terminé' });
    const b = it('Plans', 'Livrable', '2026-10-12', '2026-10-16', w11.id, carl.id, { progress_pct: 50 });
    const m = it('Revue', 'Jalon', '2026-10-19', '2026-10-19', '', alice.id);
    c.repoInsert('Dependency', { predecessor_id: a.id, successor_id: b.id, dep_type: 'FS', lag_days: 0 }, S);
    c.repoInsert('Dependency', { predecessor_id: b.id, successor_id: m.id, dep_type: 'FS', lag_days: 0 }, S);
    const t = call('bob@entreprise.com', 'wbs.tree', { projectId: p1.id });
    ok(t.ok, JSON.stringify(t.error));
    const n = t.data.nodes, by = (id) => n.find((x) => x.id === id);
    eq(n.map((x) => x.kind + ':' + x.name), ['project:Projet 1', 'wp:Conception', 'wp:Structure', 'item:Plans', 'item:Spécification', 'item:Revue']);
    eq(by('wp:' + w11.id).parent, 'wp:' + w1.id);
    eq(by('wp:' + w1.id).parent, 'project:' + p1.id);
    eq(by('item:' + m.id).parent, 'project:' + p1.id, 'un élément sans WP se rattache au projet');
    eq(by('item:' + b.id).parent, 'wp:' + w11.id);
    const wp1 = by('wp:' + w1.id);
    eq([wp1.code, wp1.owner, wp1.owner_org, wp1.charge_code, wp1.start, wp1.finish], ['1', 'Alice', 'Bureau d’études', 'C-1', '2026-10-05', '2026-10-16']);
    eq(by('wp:' + w11.id).owner_org, 'Sous-traitant Alpha');
    eq(by('item:' + b.id).critical, true);
    eq(by('project:' + p1.id).critical, true);
    eq(by('item:' + a.id).float, null, 'un livrable terminé n’a plus de marge');
    eq(t.data.stats, { wps: 2, items: 3, depth: 2 });
    eq(call('bob@entreprise.com', 'wbs.tree', { projectId: 'x' }).error.code, 'NOT_FOUND');
  });

  // ------------------------------------------------------------ préférences
  test('Préférences d’affichage : valeurs par défaut, nettoyage, mémorisation par utilisateur', () => {
    const { c, call } = world();
    const cfg = call('eve@entreprise.com', 'views.config', {}).data;
    eq(cfg.prefs.obs.attrs, ['scope', 'job_function', 'organization']);
    eq([cfg.prefs.obs.colorBy, cfg.prefs.obs.mode, cfg.prefs.wbs.colorBy, cfg.prefs.wbs.showItems], ['role', 'roles', 'kind', true]);
    eq(cfg.prefs.wbs.attrs, ['wbs_code', 'owner', 'dates', 'progress']);
    const saved = call('eve@entreprise.com', 'prefs.set', { view: 'obs', prefs: { attrs: ['email', 'organization', 'inconnu'], colorBy: 'organization', mode: 'teams' } }).data;
    eq(saved.attrs, ['organization', 'email'], 'clés inconnues écartées, ordre du catalogue');
    eq([saved.colorBy, saved.mode], ['organization', 'teams']);
    const bad = call('eve@entreprise.com', 'prefs.set', { view: 'obs', prefs: { attrs: [], colorBy: 'n’importe quoi', mode: 'x' } }).data;
    eq([bad.attrs, bad.colorBy, bad.mode], [[], 'role', 'roles'], 'liste vide autorisée (nom seul), valeurs invalides ramenées au défaut');
    call('eve@entreprise.com', 'prefs.set', { view: 'wbs', prefs: { attrs: ['charge_code'], showItems: false, colorBy: 'organization' } });
    eq(call('eve@entreprise.com', 'prefs.set', { view: 'nope', prefs: {} }).error.code, 'VALIDATION');
    const mine = call('eve@entreprise.com', 'views.config', {}).data.prefs;
    eq([mine.obs.attrs, mine.wbs.attrs, mine.wbs.showItems, mine.wbs.colorBy], [[], ['charge_code'], false, 'organization']);
    eq(call('alice@entreprise.com', 'views.config', {}).data.prefs.wbs.showItems, true, 'les choix d’un autre utilisateur ne sont pas touchés');
    eq(c.repoList('UserSetting').filter((u) => u.user_email === 'eve@entreprise.com').length, 1, 'une seule ligne par utilisateur');
  });

  test('Catalogue des attributs : clés uniques, valeurs par défaut cohérentes', () => {
    const c = freshCore();
    ['obs', 'wbs'].forEach((v) => {
      const keys = c.VIEW_CATALOG[v].attrs.map((a) => a.key);
      eq(new Set(keys).size, keys.length, 'clés uniques dans ' + v);
      ok(c.VIEW_CATALOG[v].colors.some((x) => x.key === c.VIEW_CATALOG[v].defaults.colorBy), 'couleur par défaut connue');
      ok(c.VIEW_CATALOG[v].attrs.every((a) => a.label && typeof a.on === 'boolean'));
    });
  });
};
