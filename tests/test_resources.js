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
    eq([cp.project.code, cp.canEdit, cp.canRates, cp.canAssign], ['P1', true, true, true]);
    eq(cp.teams.map((t) => [t.name, t.depth, t.members]), [['Bureau d’études', 0, 0], ['Calcul', 1, 1]], 'équipes dans l’ordre de l’arborescence');
    const remi = row(cp, 'Rémi');
    eq([remi.team, remi.team_id === calc.id, remi.daily_rate, remi.rate_source, remi.resource_type], ['Calcul', true, 520, 'fiche', 'Interne']);
    eq(remi.roles.map((r) => r.code + ':' + r.scope), ['RWP:1 Conception'], 'son rôle sur le workpackage du projet');
    eq([row(cp, 'Carla').project_role, row(cp, 'Mia').project_role, remi.project_role], ['CP', 'MEMBER', ''], 'rôle de projet : chef de projet, membre, aucun (Rémi n’a qu’un rôle de workpackage)');
    eq(row(cp, 'Dora').roles.map((r) => r.code + ':' + r.scope_type), ['DPL:program'], 'rôle du programme');
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

  test('Rôle de projet : chef de projet ou membre, ancien rôle terminé, chef de projet du projet à jour, droits', () => {
    const w = world();
    const set = (who, resourceId, role, projectId) => w.raw(who, 'people.setProjectRole', { projectId: projectId || w.p1.id, resourceId, role });
    const active = (id, code) => w.c.repoList('RoleAssignment').filter((a) => a.resource_id === id && a.scope_type === 'project' && a.scope_id === w.p1.id && a.role_code === code && (!a.end_date || a.end_date >= w.c.todayStr())).length;
    const r1 = set(CP, w.mia.id, 'CP');
    ok(r1.ok, JSON.stringify(r1.error));
    eq([active(w.mia.id, 'CP'), active(w.mia.id, 'MEMBER')], [1, 0], 'Mia passe de membre à chef de projet : l’ancien rôle est terminé');
    eq([r1.data.changed, w.c.repoGet('Project', w.p1.id).manager_resource_id], [true, w.carla.id], 'le chef de projet du projet reste Carla tant qu’elle l’est');
    eq(set(CP, w.mia.id, 'CP').data.changed, false, 'sans changement, rien n’est écrit');
    eq(w.c.repoList('RoleAssignment').filter((a) => a.resource_id === w.mia.id && a.role_code === 'CP').length, 1, 'pas de doublon');
    ok(set(CP, w.carla.id, 'MEMBER').ok);
    eq(w.c.repoGet('Project', w.p1.id).manager_resource_id, w.mia.id, 'Carla n’est plus chef de projet : Mia la remplace dans la fiche du projet');
    eq(set(DPL, w.mia.id, '').data.manager_id, '', 'plus aucun chef de projet : la fiche du projet est vidée');
    eq([active(w.mia.id, 'CP'), active(w.mia.id, 'MEMBER')], [0, 0], 'aucun rôle de projet');
    ok(w.c.repoList('RoleAssignment').some((a) => a.resource_id === w.remi.id && a.role_code === 'RWP'), 'les rôles de workpackage ne bougent pas');
    ok(set(DPL, w.remi.id, 'MEMBER').ok);
    ok(w.c.repoList('RoleAssignment').some((a) => a.resource_id === w.remi.id && a.role_code === 'RWP' && a.scope_type === 'workpackage' && (!a.end_date || a.end_date >= w.c.todayStr())), 'Rémi garde son rôle de workpackage en devenant membre du projet');
    ok(/doit être une personne interne/.test(set(DPL, w.xavier.id, 'CP').error.message), 'un externe n’est pas chef de projet');
    ok(set(DPL, w.xavier.id, 'MEMBER').ok, 'mais peut être membre');
    eq(set(DPL, w.mia.id, 'PL').error.code, 'VALIDATION');
    eq(set(MEMBER, w.remi.id, 'MEMBER').error.code, 'FORBIDDEN', 'un membre n’attribue rien');
    eq(set(RWP, w.mia.id, 'MEMBER').error.code, 'FORBIDDEN');
    eq(set(CP, w.mia.id, 'CP', w.p2.id).error.code, 'FORBIDDEN', 'pas sur un projet où l’on n’a aucun droit (et Carla n’est d’ailleurs plus chef de projet de P1)');
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
};
