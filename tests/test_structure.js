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
    role(dan, 'DPL', 'project', p1.id);
    role(bob, 'CP', 'project', p1.id); // Alice est chef de projet par la fiche du projet (manager_resource_id)
    const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1', owner_resource_id: alice.id, charge_code: 'C-1' } }).data;
    const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Structure', wbs_code: '1.1', parent_wp_id: w1.id, owner_resource_id: carl.id } }).data;
    // Alice est Workpackage leader du WP 1 et Carl Sub-WP leader du sous-WP 1.1 par leur fiche de workpackage ; Eve n'a aucun rôle (Reader)
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

  test('resources.list : recherche, droits d’édition, aucun taux ni profil tarifaire', () => {
    const { c, call, eve } = world();
    const asEve = call('eve@entreprise.com', 'resources.list', { q: 'alpha' }).data;
    eq(asEve.map((p) => p.name), ['Carl']);
    ok(!asEve[0].canEdit);
    const all = call('alice@entreprise.com', 'resources.list', {}).data;
    ok(all.every((p) => p.canEdit), 'un chef de projet peut modifier toutes les fiches');
    ok(all.every((p) => !('rate_profile' in p) && !('daily_rate' in p)), 'ni profil tarifaire ni taux : ils n’existent plus');
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

  // ------------------------------------------------------------ OBS par rôles : les essais de l'organigramme par rôles sont retirés avec l'OBS (0.15.3, phase 3)

  // ------------------------------------------------------------ préférences
  test('Préférences d’affichage : valeurs par défaut, nettoyage, mémorisation par utilisateur', () => {
    const { c, call } = world();
    const cfg = call('eve@entreprise.com', 'views.config', {}).data;
    eq([cfg.prefs.obs, Object.keys(cfg.catalog)], [undefined, ['wbs']], 'plus d’affichage d’organigramme : seulement le découpage');
    eq([cfg.prefs.wbs.colorBy, cfg.prefs.wbs.showItems], ['kind', true]);
    eq(cfg.prefs.wbs.attrs, ['wbs_code', 'owner', 'dates', 'progress']);
    const saved = call('eve@entreprise.com', 'prefs.set', { view: 'wbs', prefs: { attrs: ['charge_code', 'dates', 'inconnu'], colorBy: 'n’importe quoi', showItems: 'x' } }).data;
    eq([saved.attrs, saved.colorBy, saved.showItems], [['dates', 'charge_code'], 'kind', true], 'clés inconnues écartées, ordre du catalogue, valeurs invalides ramenées au défaut');
    eq(call('eve@entreprise.com', 'prefs.set', { view: 'obs', prefs: {} }).error.code, 'VALIDATION', 'l’organigramme n’existe plus');
    call('eve@entreprise.com', 'prefs.set', { view: 'wbs', prefs: { attrs: ['charge_code'], showItems: false, colorBy: 'organization' } });
    eq(call('eve@entreprise.com', 'prefs.set', { view: 'nope', prefs: {} }).error.code, 'VALIDATION');
    const mine = call('eve@entreprise.com', 'views.config', {}).data.prefs;
    eq([mine.wbs.attrs, mine.wbs.showItems, mine.wbs.colorBy], [['charge_code'], false, 'organization']);
    eq(call('alice@entreprise.com', 'views.config', {}).data.prefs.wbs.showItems, true, 'les choix d’un autre utilisateur ne sont pas touchés');
    eq(c.repoList('UserSetting').filter((u) => u.user_email === 'eve@entreprise.com').length, 1, 'une seule ligne par utilisateur');
  });

  test('Catalogue des attributs : clés uniques, valeurs par défaut cohérentes', () => {
    const c = freshCore();
    ['wbs'].forEach((v) => {
      const keys = c.VIEW_CATALOG[v].attrs.map((a) => a.key);
      eq(new Set(keys).size, keys.length, 'clés uniques dans ' + v);
      ok(c.VIEW_CATALOG[v].colors.some((x) => x.key === c.VIEW_CATALOG[v].defaults.colorBy), 'couleur par défaut connue');
      ok(c.VIEW_CATALOG[v].attrs.every((a) => a.label && typeof a.on === 'boolean'));
    });
  });
};
