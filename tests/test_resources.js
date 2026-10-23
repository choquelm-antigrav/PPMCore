const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nRessources : personnes, équipes, rôle de projet et taux (0.10.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };

  function world() {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    return w;
  }
  const row = (r, name) => r.people.find((x) => x.name === name);

  test('ressources.get : personnes, équipes, rôles dans le projet, taux visibles des seuls DPL et chefs de projet', () => {
    const w = world();
    const be = w.call(CP, 'teams.create', { values: { name: 'Bureau d’études', manager_resource_id: w.carla.id } });
    const calc = w.call(CP, 'teams.create', { values: { name: 'Calcul', parent_team_id: be.id } });
    w.call(CP, 'resources.update', { id: w.remi.id, patch: { team_id: calc.id } });
    w.call(CP, 'people.setRate', { resourceId: w.remi.id, daily_rate: 520 });
    const cp = w.call(CP, 'ressources.get', { projectId: w.p1.id });
    eq([cp.project.code, cp.canEdit, cp.canRates, cp.canAssign, cp.roleChoices], ['P1', true, true, false, []], 'un chef de projet ne pose pas un chef de projet : c’est le niveau du dessus');
    eq(cp.teams.map((t) => [t.name, t.depth, t.members]), [['Bureau d’études', 0, 0], ['Calcul', 1, 1]], 'équipes dans l’ordre de l’arborescence');
    const remi = row(cp, 'Rémi');
    eq([remi.team, remi.team_id === calc.id, remi.daily_rate, remi.rate_source, remi.resource_type], ['Calcul', true, 520, 'fiche', 'Interne']);
    eq(remi.roles.map((r) => r.code + ':' + r.scope), ['WPL:1 Conception', 'DO:2 livrables ou jalons'], 'ses rôles dans le projet : leader du workpackage, propriétaire de deux livrables (regroupés)');
    eq([row(cp, 'Carla').project_role, row(cp, 'Mia').project_role, remi.project_role], ['CP', '', ''], 'rôle de projet : chef de projet, ou rien (les autres rôles se posent sur leur objet)');
    eq(row(cp, 'Mia').roles.map((r) => r.code + ':' + r.scope), ['CONTRIB:4 livrables ou jalons'], 'Mia : Contributor de quatre livrables ou jalons, sur une seule ligne');
    eq(row(cp, 'Dora').roles.map((r) => r.code + ':' + r.scope_type), ['DPL:project'], 'DPL posée sur ce projet');
    ok(row(cp, 'Xavier').resource_type === 'Externe', 'les externes sont listés aussi');
    eq([row(cp, 'Rémi').access, row(cp, 'Xavier').access], ['ok', 'outside'], 'accès : adresse dans le domaine, ou hors domaine');
    const nomail = w.call(CP, 'resources.create', { values: { name: 'Sans adresse', resource_type: 'Interne' } });
    eq(row(w.call(CP, 'ressources.get', { projectId: w.p1.id }), 'Sans adresse').access, 'none', 'sans adresse e-mail : ne peut pas se connecter');
    eq(cp.domains, ['entreprise.com'], 'les domaines autorisés sont fournis à la page');
    void nomail;
    const mia = w.call(MEMBER, 'ressources.get', { projectId: w.p1.id });
    eq([mia.canEdit, mia.canRates, mia.canAssign, mia.roleChoices], [false, false, false, []]);
    ok(mia.people.every((x) => x.daily_rate === null && x.rate_source === ''), 'un membre ne voit aucun taux');
    eq(w.call(DPL, 'ressources.get', { projectId: w.p1.id }).canRates, true, 'le DPL voit les taux');
    eq(w.call(CP, 'ressources.get', {}).project, null, 'sans projet : la liste des personnes seulement');
    eq(w.raw(CP, 'ressources.get', { projectId: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Rôle de projet : chef de projet seulement, désigné par le niveau du dessus ; ancien rôle terminé, fiche du projet à jour, droits', () => {
    const w = world();
    const set = (who, resourceId, role, projectId) => w.raw(who, 'people.setProjectRole', { projectId: projectId || w.p1.id, resourceId, role });
    const active = (id, code) => w.c.repoList('RoleAssignment').filter((a) => a.resource_id === id && a.scope_type === 'project' && a.scope_id === w.p1.id && a.role_code === code && (!a.end_date || a.end_date >= w.c.todayStr())).length;
    eq(set(CP, w.mia.id, 'CP').error.code, 'FORBIDDEN', 'un chef de projet ne désigne pas un chef de projet (même niveau)');
    const r1 = set(DPL, w.mia.id, 'CP');
    ok(r1.ok, JSON.stringify(r1.error));
    eq([active(w.mia.id, 'CP'), r1.data.changed, w.c.repoGet('Project', w.p1.id).manager_resource_id], [1, true, w.carla.id], 'le DPL pose Mia ; le chef de projet de la fiche reste Carla tant qu’elle l’est');
    eq(set(DPL, w.mia.id, 'CP').data.changed, false, 'sans changement, rien n’est écrit');
    eq(w.c.repoList('RoleAssignment').filter((a) => a.resource_id === w.mia.id && a.role_code === 'CP').length, 1, 'pas de doublon');
    ok(set(DPL, w.carla.id, '').ok);
    eq(w.c.repoGet('Project', w.p1.id).manager_resource_id, w.mia.id, 'Carla n’est plus chef de projet : Mia la remplace dans la fiche du projet');
    eq(set(DPL, w.mia.id, '').data.manager_id, '', 'plus aucun chef de projet : la fiche du projet est vidée');
    eq([active(w.mia.id, 'CP'), active(w.carla.id, 'CP')], [0, 0], 'aucun rôle de projet');
    ok(w.c.repoList('RoleAssignment').some((a) => a.resource_id === w.remi.id && a.role_code === 'WPL'), 'les rôles de workpackage ne bougent pas');
    ok(/doit être une personne interne/.test(set(DPL, w.xavier.id, 'CP').error.message), 'un externe n’est pas chef de projet');
    eq(set(DPL, w.mia.id, 'MEMBER').error.code, 'VALIDATION', 'l’ancien rôle de membre n’existe plus : les autres rôles se posent sur leur objet');
    eq(set(DPL, w.mia.id, 'PL').error.code, 'VALIDATION');
    eq(set(MEMBER, w.remi.id, 'CP').error.code, 'FORBIDDEN', 'un Contributor ne désigne personne');
    eq(set(RWP, w.mia.id, 'CP').error.code, 'FORBIDDEN', 'un Workpackage leader non plus');
    eq(set(CP, w.mia.id, 'CP', w.p2.id).error.code, 'FORBIDDEN', 'pas sur un projet où l’on n’a aucun droit');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'RoleAssignment' && e.field === 'end_date'), 'fin de rôle tracée');
  });

  test('Taux journalier par personne : saisie, droits, bornes ; interne ou externe', () => {
    const w = world();
    const rate = (who, id, v) => w.raw(who, 'people.setRate', { resourceId: id, daily_rate: v });
    eq(rate(CP, w.remi.id, '520,50').data.daily_rate, 520.5, 'la virgule est acceptée');
    eq(rate(CP, w.xavier.id, 450).data.daily_rate, 450, 'un externe aussi');
    eq(rate(MEMBER, w.remi.id, 100).error.code, 'FORBIDDEN');
    eq(rate(RWP, w.remi.id, 100).error.code, 'FORBIDDEN');
    ['0', '-5', 'x', 100001].forEach((v) => eq(rate(CP, w.remi.id, v).error.code, 'VALIDATION', 'taux ' + v));
    eq(rate(CP, w.remi.id, '').data.daily_rate, null, 'vide : effacé');
    eq(w.c.repoGet('Resource', w.remi.id).daily_rate, '');
    eq(rate(ADMIN, w.mia.id, 600).data.daily_rate, 600, 'l’administrateur aussi');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Resource' && e.field === 'daily_rate' && e.new_value === '450'), 'tracé');
  });

  test('Budget : le taux de la fiche sert de base, figé à la création ; un externe se budgète au forfait ou en jours', () => {
    const w = world();
    const line = (v) => w.raw(CP, 'budget.line.save', { values: v });
    w.call(CP, 'people.setRate', { resourceId: w.remi.id, daily_rate: 500 });
    const a = line({ deliverable_id: w.b.id, resource_id: w.remi.id, planned_days: 10 });
    ok(a.ok, JSON.stringify(a.error));
    eq([a.data.cost_type, a.data.frozen_rate, a.data.planned_amount, a.data.external], ['TJM', 500, 5000, false], 'taux de la fiche, sans passer par la grille');
    w.call(CP, 'people.setRate', { resourceId: w.remi.id, daily_rate: 700 });
    eq(w.call(CP, 'budget.line.save', { id: a.data.id, values: { planned_days: 12 } }).planned_amount, 6000, 'le taux est figé : 12 jours à 500 €');
    eq(w.call(CP, 'budget.line.save', { id: a.data.id, values: { refresh_rate: true } }).planned_amount, 8400, 'sur demande : au nouveau taux (700 €)');
    ok(/Aucun taux journalier pour « Mia »/.test(line({ deliverable_id: w.a.id, resource_id: w.mia.id, planned_days: 2 }).error.message));
    w.call(CP, 'people.setRate', { resourceId: w.xavier.id, daily_rate: 450 });
    const x = line({ deliverable_id: w.cc.id, resource_id: w.xavier.id, planned_days: 10 });
    eq([x.data.cost_type, x.data.frozen_rate, x.data.planned_amount, x.data.external], ['TJM', 450, 4500, true], 'externe en jours × taux');
    const f = line({ deliverable_id: w.a.id, resource_id: w.xavier.id, fixed_amount: 3000 });
    eq([f.data.cost_type, f.data.planned_amount, f.data.external], ['Forfait', 3000, true], 'externe au forfait');
    const g = w.call(CP, 'budget.get', { projectId: w.p1.id });
    eq([g.totals.external, g.totals.internal, g.totals.total], [7500, 8400, 15900], 'le budget externe compte le forfait et les jours × taux des externes');
    const bal = w.call(CP, 'budget.balance', { projectId: w.p1.id });
    eq([bal.totals.budget.external, bal.totals.budget.internal], [7500, 8400]);
    const opt = w.call(CP, 'po.options', { projectId: w.p1.id });
    eq(opt.deliverables.find((d) => d.id === w.cc.id).budget_external, 4500, 'une PO se compare aussi au budget externe en jours × taux');
    eq(line({ deliverable_id: w.b.id, resource_id: w.xavier.id }).error.code, 'VALIDATION', 'ni jours ni forfait : refusé');
    // un externe sans taux ni forfait
    const y = w.c.repoInsert('Resource', { resource_type: 'Externe', name: 'Yves', email: 'yves@sous-traitant.fr', country: 'FR' }, w.S);
    ok(/Aucun taux journalier pour « Yves »/.test(line({ deliverable_id: w.b.id, resource_id: y.id, planned_days: 3 }).error.message));
    eq(w.c.repoGet('Resource', w.xavier.id).daily_rate, 450);
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
