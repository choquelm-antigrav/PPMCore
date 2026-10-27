const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nRessources : personnes, équipes, rôle de projet (0.10.0) ; plus aucun taux journalier (0.17.1)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };

  function world() {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    return w;
  }
  const row = (r, name) => r.people.find((x) => x.name === name);

  test('ressources.get : personnes, équipes, rôles dans le projet ; aucun taux ni profil tarifaire nulle part', () => {
    const w = world();
    const be = w.call(CP, 'teams.create', { values: { name: 'Bureau d’études', manager_resource_id: w.carla.id } });
    const calc = w.call(CP, 'teams.create', { values: { name: 'Calcul', parent_team_id: be.id } });
    w.call(CP, 'resources.update', { id: w.remi.id, patch: { team_id: calc.id } });
    const cp = w.call(CP, 'ressources.get', { projectId: w.p1.id });
    eq([cp.project.code, cp.canEdit, cp.canRates, cp.canSetRates, cp.canAssign, cp.roleChoices], ['P1', true, undefined, undefined, undefined, undefined], 'les rôles ne se posent plus depuis cette page : ils se posent dans le WBS');
    eq(cp.teams.map((t) => [t.name, t.depth, t.members]), [['Bureau d’études', 0, 0], ['Calcul', 1, 1]], 'équipes dans l’ordre de l’arborescence');
    const remi = row(cp, 'Rémi');
    eq([remi.team, remi.team_id === calc.id, remi.resource_type, 'daily_rate' in remi, 'rate_source' in remi], ['Calcul', true, 'Interne', false, false], 'plus de taux sur la fiche d’une personne');
    eq(remi.roles.map((r) => r.code + ':' + r.scope), ['WPL:1 Conception', 'DO:2 livrables ou jalons'], 'ses rôles dans le projet : leader du workpackage, propriétaire de deux livrables (regroupés)');
    eq([row(cp, 'Carla').roles.map((r) => r.code).join(), row(cp, 'Mia').roles.map((r) => r.code).join(), row(cp, 'Xavier').roles.length], ['CP,WPL,DO', 'CONTRIB', 0], 'les rôles de chacun, en lecture seule (Xavier : aucun, donc Reader)');
    eq(row(cp, 'Mia').roles.map((r) => r.code + ':' + r.scope), ['CONTRIB:4 livrables ou jalons'], 'Mia : Contributor de quatre livrables ou jalons, sur une seule ligne');
    eq(row(cp, 'Dora').roles.map((r) => r.code + ':' + r.scope_type), ['DPL:project'], 'DPL posée sur ce projet');
    ok(row(cp, 'Xavier').resource_type === 'Externe', 'les externes sont listés aussi');
    eq([row(cp, 'Rémi').access, row(cp, 'Xavier').access], ['ok', 'outside'], 'accès : adresse dans le domaine, ou hors domaine');
    const nomail = w.call(CP, 'resources.create', { values: { name: 'Sans adresse', resource_type: 'Interne' } });
    eq(row(w.call(CP, 'ressources.get', { projectId: w.p1.id }), 'Sans adresse').access, 'none', 'sans adresse e-mail : ne peut pas se connecter');
    eq(cp.domains, ['entreprise.com'], 'les domaines autorisés sont fournis à la page');
    void nomail;
    const mia = w.call(MEMBER, 'ressources.get', { projectId: w.p1.id });
    eq(mia.canEdit, false, 'un Contributor ne modifie aucune fiche');
    ok(!JSON.stringify([cp, mia, w.call(DPL, 'ressources.get', { projectId: w.p1.id })]).match(/daily_rate|rate_source|rate_profile|canRates/), 'aucun taux dans ce que la page reçoit, pour personne');
    eq(w.call(CP, 'ressources.get', {}).project, null, 'sans projet : la liste des personnes seulement');
    eq(w.raw(CP, 'ressources.get', { projectId: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Plus de taux journalier : l’action, le champ et le profil n’existent plus ; le pays d’une équipe sert à convertir un montant en jours', () => {
    const w = world();
    ['people.setRate', 'rates.list', 'rates.set', 'rates.delete', 'rates.people', 'rates.assign'].forEach((a) => eq(w.raw(ADMIN, a, {}).error.code, 'NOT_FOUND', a + ' n’existe plus'));
    const schema = w.c.SCHEMA;
    ok(!schema.Resource.cols.includes('daily_rate') && !schema.Resource.cols.includes('rate_profile') && !schema.RateCard && !schema.BudgetLine.cols.includes('frozen_rate') && !schema.BudgetLine.cols.includes('planned_days'), 'ni dans les colonnes des personnes, ni grille de taux, ni taux figé ou jours sur une ligne de budget');
    const team = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'DE' } });
    eq(w.c.repoGet('HierarchicalTeam', team.id).country, 'DE', 'une équipe a un pays');
    eq(w.raw(CP, 'teams.create', { values: { name: 'T2B', country: 'ES' } }).error.code, 'VALIDATION', 'un pays inconnu est refusé');
    eq(w.call(CP, 'teams.update', { id: team.id, patch: { country: '' } }).country, '', 'le pays se vide : la France par défaut');
    eq(w.call(CP, 'ressources.get', { projectId: w.p1.id }).allTeams.find((t) => t.id === team.id).level, 3, 'la page reçoit le niveau budgétaire de chaque équipe (3 caractères)');
  });

  test('Budget : une part d’équipe en montant libre, un externe au forfait ; le budget externe compte les forfaits', () => {
    const w = world();
    const line = (v) => w.raw(CP, 'budget.line.save', { values: v });
    const t1 = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'FR' } });
    const a = line({ deliverable_id: w.b.id, team_id: t1.id, planned_amount: 5000 });
    ok(a.ok, JSON.stringify(a.error));
    eq([a.data.cost_type, a.data.planned_amount, a.data.external, a.data.team.country], ['Équipe', 5000, false, 'FR'], 'une part d’équipe : un montant, interne');
    eq(w.call(CP, 'budget.line.save', { id: a.data.id, values: { planned_amount: 6000 } }).planned_amount, 6000, 'le montant se modifie librement (pas de taux figé)');
    const f = line({ deliverable_id: w.a.id, resource_id: w.xavier.id, fixed_amount: 3000 });
    eq([f.data.cost_type, f.data.planned_amount, f.data.external], ['Forfait', 3000, true], 'externe au forfait');
    const x = line({ deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 4500 });
    eq(x.data.planned_amount, 4500);
    eq(line({ deliverable_id: w.b.id, resource_id: w.xavier.id }).error.code, 'VALIDATION', 'ni montant ni forfait : refusé');
    ok(/ressource externe/.test(line({ deliverable_id: w.b.id, resource_id: w.remi.id, fixed_amount: 100 }).error.message), 'un forfait avec un interne : refusé, le budget interne se saisit par équipe');
    const g = w.call(CP, 'budget.get', { projectId: w.p1.id });
    eq([g.totals.external, g.totals.internal, g.totals.total], [7500, 6000, 13500], 'le budget externe compte les forfaits ; l’interne, les parts d’équipe');
    const bal = w.call(CP, 'budget.balance', { projectId: w.p1.id });
    eq([bal.totals.budget.external, bal.totals.budget.internal], [7500, 6000]);
    const opt = w.call(CP, 'po.options', { projectId: w.p1.id });
    eq(opt.deliverables.find((d) => d.id === w.cc.id).budget_external, 4500, 'une PO se compare au budget externe (forfaits) du livrable');
  });

  test('ressources.get : livrables et jalons de chaque personne (dont elle est responsable) et ceux auxquels elle contribue (0.14.0)', () => {
    const w = world(), S = { actor: 'setup', source: 'setup' };
    const get = (projectId) => w.call(CP, 'ressources.get', projectId === undefined ? {} : { projectId });
    const n = (r, name) => { const x = row(r, name); return [x.deliverables, x.milestones, x.contributes]; };
    let r = get(w.p1.id);
    eq([n(r, 'Rémi'), n(r, 'Carla'), n(r, 'Mia'), n(r, 'Dora')], [[2, 0, 0], [1, 1, 0], [0, 0, 4], [0, 0, 0]], 'responsable de : Rémi 2 livrables ; Carla 1 livrable et 1 jalon ; Mia, Contributor des quatre, y contribue sans en être responsable');
    // on repart de zéro : les rôles de Contributor de Mia se terminent
    w.c.repoList('RoleAssignment').filter((a) => a.resource_id === w.mia.id).forEach((a) => w.c.repoUpdate('RoleAssignment', a.id, { end_date: '2026-10-01' }, null, S));
    eq(n(get(w.p1.id), 'Mia'), [0, 0, 0], 'rôles terminés : plus de contribution');
    // Mia devient Workpackage leader du workpackage 1 : elle contribue à ses livrables dont elle n'est pas responsable (« Spécification »)
    const roleMia = w.c.repoInsert('RoleAssignment', { resource_id: w.mia.id, role_code: 'WPL', scope_type: 'workpackage', scope_id: w.w1.id }, S);
    r = get(w.p1.id);
    eq(n(r, 'Mia'), [0, 0, 1], 'leader du workpackage 1 : contribue à 1 livrable (le seul qui s’y trouve directement)');
    eq(n(r, 'Rémi'), [2, 0, 0], 'Rémi est leader du workpackage 1 mais responsable de son seul livrable : il ne « contribue » pas à ce qui est à lui');
    // un livrable de plus dans ce workpackage, confié à Carla : Mia et Rémi y contribuent
    w.call(ADMIN, 'planitems.create', { values: { project_id: w.p1.id, name: 'Dossier', item_type: 'Livrable', planned_start: '2026-10-05', planned_finish: '2026-10-09', wp_id: w.w1.id, owner_resource_id: w.carla.id } });
    r = get(w.p1.id);
    eq([n(r, 'Mia'), n(r, 'Rémi'), n(r, 'Carla')], [[0, 0, 2], [2, 0, 1], [2, 1, 0]], 'Mia contribue à 2, Rémi à 1 ; Carla en possède maintenant 2 (et 1 jalon)');
    // un rôle terminé ne compte plus
    w.c.repoUpdate('RoleAssignment', roleMia.id, { end_date: '2026-10-01' }, null, S);
    eq(n(get(w.p1.id), 'Mia'), [0, 0, 0], 'rôle terminé : plus de contribution');
    // portée : un autre projet ne compte rien ; sans projet, tous les projets comptent
    eq([n(get(w.p2.id), 'Rémi'), n(get(w.p2.id), 'Carla')], [[0, 0, 0], [0, 0, 0]], 'projet vide : aucun livrable');
    eq(n(get(), 'Carla'), [2, 1, 0], 'sans projet choisi : tous les projets');
  });
};
