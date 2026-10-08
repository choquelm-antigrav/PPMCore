const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nDépendances, rôles, personnes et équipes (0.8.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  // Jeu : WP 1 ⊃ 1.1 ; WP 2 ; A, B (dans 1.1), C (dans 2), J ; A→B→C→J ; Carla CP de P1, Rémi RWP du WP 1, Mia membre, Dora DPL du programme.

  test('Dépendances d’un élément : amont, aval, candidats du programme, droits par lien', () => {
    const w = lot2World();
    const other = w.call(ADMIN, 'planitems.create', { values: { project_id: w.p2.id, name: 'Moule', item_type: 'Livrable', planned_finish: '2026-11-30' } });
    const d = w.call(CP, 'deps.item', { itemId: w.b.id });
    eq([d.item.name, d.canEdit, d.predecessors.map((x) => x.other.name + ':' + x.dep_type), d.successors.map((x) => x.other.name)], ['Calcul', true, ['Spécification:FS'], ['Essais']]);
    const names = d.candidates.map((c) => c.name);
    ok(names.includes('Revue') && names.includes('Moule'), 'candidats : le projet et les autres projets du programme');
    ok(!names.includes('Calcul') && !names.includes('Spécification') && !names.includes('Essais'), 'ni lui-même, ni les éléments déjà liés');
    eq(d.candidates[0].project_code, 'P1', 'les éléments du projet viennent d’abord');
    eq(d.candidates.find((c) => c.name === 'Moule').can_edit, false, 'Carla n’a pas la main sur le projet P2');
    const mia = w.call(MEMBER, 'deps.item', { itemId: w.b.id });
    eq([mia.canEdit, mia.candidates, mia.predecessors[0].canEdit], [false, [], false], 'un membre lit les liens sans pouvoir en créer');
    eq(w.raw(CP, 'deps.item', { itemId: 'inconnu' }).error.code, 'NOT_FOUND');
    void other;
  });

  test('Créer, modifier, retirer une dépendance : boucles, doublons, soi-même, bornes du décalage', () => {
    const w = lot2World();
    const make = (who, v) => w.raw(who, 'dependencies.create', { values: v });
    ok(make(CP, { predecessor_id: w.a.id, successor_id: w.j.id, dep_type: 'SS', lag_days: 2 }).ok, 'un lien de plus, en début-début avec 2 jours');
    ok(/existe déjà/.test(make(CP, { predecessor_id: w.a.id, successor_id: w.j.id, dep_type: 'FS' }).error.message));
    ok(/lui-même/.test(make(CP, { predecessor_id: w.a.id, successor_id: w.a.id, dep_type: 'FS' }).error.message));
    ok(/boucle/.test(make(CP, { predecessor_id: w.j.id, successor_id: w.a.id, dep_type: 'FS' }).error.message), 'J→A fermerait une boucle');
    ok(/entre -365 et 365/.test(make(CP, { predecessor_id: w.cc.id, successor_id: w.a.id, dep_type: 'FS', lag_days: 400 }).error.message));
    ok(/entre -365 et 365/.test(make(CP, { predecessor_id: w.j.id, successor_id: w.b.id, dep_type: 'FS', lag_days: 1.5 }).error.message));
    eq(make(MEMBER, { predecessor_id: w.b.id, successor_id: w.j.id, dep_type: 'FS' }).error.code, 'FORBIDDEN');
    const dep = w.call(CP, 'deps.item', { itemId: w.j.id }).predecessors.find((x) => x.other.name === 'Spécification');
    const up = w.call(CP, 'dependencies.update', { id: dep.id, version: dep.version, patch: { dep_type: 'FF', lag_days: -1 } });
    eq([up.dep_type, up.lag_days], ['FF', -1]);
    eq(w.raw(CP, 'dependencies.update', { id: dep.id, version: 1, patch: { lag_days: 3 } }).error.code, 'CONFLICT');
    eq(w.raw(CP, 'dependencies.update', { id: dep.id, patch: { dep_type: 'XX' } }).error.code, 'VALIDATION');
    eq(w.raw(MEMBER, 'dependencies.update', { id: dep.id, patch: { lag_days: 0 } }).error.code, 'FORBIDDEN');
    w.call(CP, 'dependencies.delete', { id: dep.id });
    eq(w.call(CP, 'deps.item', { itemId: w.j.id }).predecessors.map((x) => x.other.name), ['Essais']);
  });

  test('Rôles attribuables : périmètres où l’on peut agir, rang minimal, terminer toutes les lignes d’une affectation', () => {
    const w = lot2World();
    const cp = w.call(CP, 'roles.options', {});
    eq(cp.roles.map((r) => r.code), w.c.ROLES);
    eq(cp.scopes.map((s) => s.type + ':' + s.label).sort(), ['project:P1 — Projet 1', 'workpackage:1 Conception (P1)', 'workpackage:1.1 Calcul (P1)', 'workpackage:2 Essais (P1)'].sort(), 'un chef de projet : son projet et ses WP, pas le programme');
    eq([...new Set(cp.scopes.map((s) => s.min_rank))], [w.c.ROLE_RANK.CP], 'il ne donne pas de rôle plus élevé que le sien');
    const admin = w.call(ADMIN, 'roles.options', {});
    ok(admin.scopes.some((s) => s.type === 'program') && admin.scopes.every((s) => s.min_rank === 0), 'l’administrateur : tout, sans limite de rang');
    eq(w.call(MEMBER, 'roles.options', {}).scopes, [], 'un membre n’attribue rien');
    eq(w.call(RWP, 'roles.options', {}).scopes, [], 'un responsable de WP non plus');
    eq(w.call(DPL, 'roles.options', {}).scopes.some((s) => s.type === 'program'), true);
    // l'organigramme indique droits et identifiants d'affectation
    w.c.repoInsert('RoleAssignment', { resource_id: w.mia.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id }, w.S); // doublon volontaire
    const tree = w.call(CP, 'obs.tree', { scopeType: 'project', scopeId: w.p1.id });
    const node = tree.nodes.find((n) => n.role_code === 'MEMBER' && n.scope_type === 'project');
    eq([node.canAssign, node.min_rank, node.people[0].name, node.people[0].assignment_ids.length], [true, w.c.ROLE_RANK.CP, 'Mia', 2], 'les deux lignes d’une même affectation sont regroupées');
    ok(tree.nodes.find((n) => n.role_code === 'DPL').canAssign === false, 'le rôle du programme : pas modifiable par un chef de projet');
    node.people[0].assignment_ids.forEach((id) => w.call(CP, 'roles.end', { id }));
    ok(!w.call(CP, 'obs.tree', { scopeType: 'project', scopeId: w.p1.id }).nodes.some((n) => n.role_code === 'MEMBER' && n.scope_type === 'project'), 'après les avoir terminées, Mia n’apparaît plus sur ce rôle');
    const before = w.call(CP, 'roles.assign', { values: { resource_id: w.mia.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: w.w2.id } });
    eq([before.role_code, before.start_date], ['RWP', w.c.todayStr()]);
    eq(w.raw(CP, 'roles.assign', { values: { resource_id: w.mia.id, role_code: 'DPL', scope_type: 'project', scope_id: w.p1.id } }).error.code, 'FORBIDDEN', 'pas de rôle plus haut que le sien');
  });

  test('Retrait d’une personne : annonce préalable, rôles terminés, responsabilités libérées, droits', () => {
    const w = lot2World();
    w.c.repoUpdate('HierarchicalTeam', w.c.repoInsert('HierarchicalTeam', { name: 'BE' }, w.S).id, { manager_resource_id: w.remi.id }, null, w.S);
    const dry = w.call(CP, 'people.remove', { id: w.remi.id, dryRun: true });
    eq(dry, { dryRun: true, name: 'Rémi', roles: 1, teams: 1, wps: 1, items: 2 });
    ok(!w.c.isTrue(w.c.repoGet('Resource', w.remi.id).deleted), 'l’annonce ne change rien');
    eq(w.raw(MEMBER, 'people.remove', { id: w.remi.id }).error.code, 'FORBIDDEN');
    ok(/propre fiche/.test(w.raw(CP, 'people.remove', { id: w.carla.id }).error.message));
    const done = w.call(CP, 'people.remove', { id: w.remi.id });
    eq([done.dryRun, done.roles, done.teams, done.wps, done.items], [false, 1, 1, 1, 2]);
    ok(w.c.isTrue(w.c.repoGet('Resource', w.remi.id).deleted), 'la fiche n’est plus active');
    eq([w.c.repoGet('WorkPackage', w.w1.id).owner_resource_id, w.c.repoGet('PlanItem', w.a.id).owner_resource_id, w.c.repoGet('PlanItem', w.b.id).owner_resource_id], ['', '', ''], 'responsabilités libérées');
    eq(w.c.repoList('HierarchicalTeam').map((t) => t.manager_resource_id), [''], 'plus responsable d’équipe');
    eq(w.c.repoList('RoleAssignment').filter((a) => a.resource_id === w.remi.id && (!a.end_date || a.end_date >= w.c.todayStr())).length, 0, 'rôles terminés');
    ok(!w.call(CP, 'resources.list', {}).some((p) => p.resource_id === w.remi.id), 'disparue des listes');
    w.c.runRules();
    ok(w.c.repoList('Insight').some((i) => i.rule_code === 'MISSING_OWNER' && i.target_id === w.a.id), 'ses livrables ressortent comme « sans responsable »');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Resource' && e.entity_id === w.remi.id && e.field === 'deleted'), 'retrait tracé');
  });

  test('Équipes : création, sous-équipes sans boucle, responsable, membres, suppression seulement vide', () => {
    const w = lot2World();
    const team = (v) => w.call(CP, 'teams.create', { values: v });
    const be = team({ name: '  Bureau d’études ', cost_center: 'CC-1', manager_resource_id: w.carla.id });
    eq([be.name, be.cost_center, be.manager_resource_id, be.parent_team_id], ['Bureau d’études', 'CC-1', w.carla.id, '']);
    const calc = team({ name: 'Calcul', parent_team_id: be.id });
    const fat = team({ name: 'Fatigue', parent_team_id: calc.id });
    eq(w.raw(CP, 'teams.create', { values: { name: ' ' } }).error.code, 'VALIDATION');
    ok(/introuvable/.test(w.raw(CP, 'teams.create', { values: { name: 'X', parent_team_id: 'zzz' } }).error.message));
    ok(/introuvable/.test(w.raw(CP, 'teams.create', { values: { name: 'X', manager_resource_id: 'zzz' } }).error.message));
    ok(/sous elle-même/.test(w.raw(CP, 'teams.update', { id: be.id, patch: { parent_team_id: fat.id } }).error.message), 'pas de boucle : le BE sous Fatigue');
    ok(/sous elle-même/.test(w.raw(CP, 'teams.update', { id: be.id, patch: { parent_team_id: be.id } }).error.message));
    const up = w.call(CP, 'teams.update', { id: fat.id, version: fat.version, patch: { parent_team_id: be.id, name: 'Fatigue et durabilité', manager_resource_id: w.mia.id } });
    eq([up.parent_team_id, up.name, up.manager_resource_id], [be.id, 'Fatigue et durabilité', w.mia.id]);
    eq(w.raw(CP, 'teams.update', { id: fat.id, version: 1, patch: { name: 'Périmé' } }).error.code, 'CONFLICT');
    ['teams.create', 'teams.update', 'teams.delete'].forEach((a) => eq(w.raw(MEMBER, a, { values: { name: 'x' }, id: be.id, patch: {} }).error.code, 'FORBIDDEN', a + ' refusé à un membre'));
    // membres : passent par resources.update, l'équipe doit exister
    w.call(CP, 'resources.update', { id: w.remi.id, patch: { team_id: calc.id } });
    eq(w.raw(CP, 'resources.update', { id: w.remi.id, patch: { team_id: 'zzz' } }).error.message, 'Équipe introuvable.');
    eq(w.raw(CP, 'resources.create', { values: { name: 'Nouveau', resource_type: 'Interne', team_id: 'zzz' } }).error.code, 'VALIDATION');
    const tree = w.call(CP, 'obs.teams', {});
    const nCalc = tree.nodes.find((n) => n.name === 'Calcul');
    eq([nCalc.parent_team_id, nCalc.version >= 1, nCalc.members.map((m) => m.name)], [be.id, true, ['Rémi']]);
    eq(tree.nodes.find((n) => n.name === 'Bureau d’études').manager_id, w.carla.id);
    const refused = w.raw(CP, 'teams.delete', { id: calc.id });
    eq([refused.error.code, refused.error.details], ['VALIDATION', { rule: 'NOT_EMPTY', members: 1, teams: 0 }]);
    w.call(CP, 'resources.update', { id: w.remi.id, patch: { team_id: '' } });
    ok(w.call(CP, 'teams.delete', { id: calc.id }).deleted, 'vide : supprimée');
    ok(/1 sous-équipe/.test(w.raw(CP, 'teams.delete', { id: be.id }).error.message), 'l’équipe mère refuse tant qu’elle a des sous-équipes');
    eq(w.raw(CP, 'teams.delete', { id: 'zzz' }).error.code, 'NOT_FOUND');
  });

  test('Ressources à positionner : une personne créée sans rôle apparaît dans l’organigramme, jusqu’à ce qu’on lui en donne un', () => {
    const w = lot2World();
    const names = (r) => r.unplaced.people.map((p) => p.name);
    const nina = w.call(CP, 'resources.create', { values: { name: 'Nina Roux', resource_type: 'Interne', email: 'nina@entreprise.com' } });
    const roles = () => w.call(CP, 'obs.tree', { scopeType: 'project', scopeId: w.p1.id });
    ok(names(roles()).includes('Nina Roux'), 'une personne créée est proposée dans l’organigramme par rôles');
    ok(names(w.call(CP, 'obs.teams', {})).includes('Nina Roux'), 'et dans la vue par équipes');
    ok(!names(roles()).includes('Mia') && !names(roles()).includes('Rémi'), 'celles qui ont un rôle n’y sont pas');
    const card = roles().unplaced.people.find((p) => p.name === 'Nina Roux');
    eq([card.resource_type, card.canEdit, card.email, card.team_id], ['Interne', true, 'nina@entreprise.com', ''], 'carte complète, modifiable par le pilotage');
    eq(roles().unplaced.total, roles().unplaced.people.length, 'le total compte toutes les personnes sans rôle');
    // avoir une équipe ne suffit pas : il faut un rôle
    const team = w.call(CP, 'teams.create', { values: { name: 'Calcul' } });
    w.call(CP, 'resources.update', { id: nina.id, patch: { team_id: team.id } });
    ok(names(roles()).includes('Nina Roux'), 'une personne dans une équipe, sans rôle, reste à positionner');
    // un rôle la positionne
    const a = w.call(CP, 'roles.assign', { values: { resource_id: nina.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id } });
    ok(!names(roles()).includes('Nina Roux'), 'avec un rôle, elle n’est plus à positionner');
    ok(roles().nodes.some((n) => n.role_code === 'MEMBER' && n.people.some((x) => x.name === 'Nina Roux')), 'et elle figure sur la carte de son rôle');
    // un rôle terminé la remet à positionner
    w.call(CP, 'roles.end', { id: a.id });
    ok(names(roles()).includes('Nina Roux'), 'rôle terminé : de nouveau à positionner');
    // retirée : plus proposée
    w.call(CP, 'people.remove', { id: nina.id });
    ok(!names(roles()).includes('Nina Roux'), 'une personne retirée n’est plus proposée');
    // un membre voit la liste sans pouvoir modifier
    const other = w.call(CP, 'resources.create', { values: { name: 'Paul Roy', resource_type: 'Externe' } });
    const mia = w.call(MEMBER, 'obs.tree', { scopeType: 'project', scopeId: w.p1.id });
    eq([names(mia).includes('Paul Roy'), mia.unplaced.people.find((p) => p.name === 'Paul Roy').canEdit], [true, false], 'un membre la voit, sans pouvoir la modifier');
    // la page Ressources les signale aussi
    const rg = w.call(CP, 'ressources.get', { projectId: w.p1.id });
    eq([rg.people.find((p) => p.name === 'Paul Roy').unplaced, rg.people.find((p) => p.name === 'Rémi').unplaced], [true, false], 'Ressources : « à positionner » pour qui n’a aucun rôle');
    void other;
  });
};
