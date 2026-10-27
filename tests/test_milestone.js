const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nJalon passé : déclaré explicitement par son responsable, il sort des alertes d’échéance (0.17.2)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', EXT = 'xavier@alpha-sous-traitance.com';

  /** Un jalon dont la date est dépassée (20 septembre ; aujourd'hui : 5 octobre), sous le workpackage 1 (Rémi), dont le responsable est Mia (Deliverable owner du jalon, Contributor ailleurs). */
  function world() {
    const w = lot2World();
    w.late = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Revue à date dépassée', item_type: 'Jalon', planned_start: '2026-09-20', planned_finish: '2026-09-20', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.pass = (who, p) => w.raw(who || MEMBER, 'milestone.pass', Object.assign({ id: w.late.id }, p || {}));
    w.codes = () => { w.c.runRules(); return w.c.repoList('Insight').map((i) => i.rule_code + ':' + i.target_id); };
    w.item = (id) => w.c.repoGet('PlanItem', id);
    return w;
  }

  test('Le défaut d’origine : un jalon dont la date est dépassée restait en retard pour toujours ; le responsable le déclare passé et l’alerte disparaît', () => {
    const w = world();
    ok(w.codes().includes('LATE_ITEM:' + w.late.id), 'avant : l’alerte de retard du jalon');
    eq(w.raw(MEMBER, 'progress.declare', { planItemId: w.late.id, progressPct: 100 }).error.code, 'VALIDATION', 'l’avancement ne se déclare pas sur un jalon : il n’y avait aucun moyen de l’en sortir');
    const r = w.pass(MEMBER);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.status, r.data.progress_pct, r.data.actual_finish], ['Terminé', 100, w.c.todayStr()], 'passé : terminé, 100 %, date réelle d’aujourd’hui');
    const it = w.item(w.late.id);
    eq([it.status, Number(it.progress_pct), it.actual_finish, String(it.last_progress_at).slice(0, 10)], ['Terminé', 100, w.c.todayStr(), w.c.todayStr()], 'enregistré dans le planning');
    ok(!w.codes().includes('LATE_ITEM:' + w.late.id), 'après : plus d’alerte de retard pour ce jalon');
    ok(w.c.repoList('ChangeEvent').some((e) => e.entity_id === w.late.id && /actual_finish/.test(JSON.stringify(e))), 'le passage est tracé dans le journal des changements');
    // le rouvrir : il redevient à faire, l'alerte revient
    const back = w.pass(MEMBER, { passed: false });
    eq([back.data.status, back.data.progress_pct, back.data.actual_finish], ['À faire', 0, ''], 'rouvert : à faire, sans date réelle');
    ok(w.codes().includes('LATE_ITEM:' + w.late.id), 'et l’alerte de retard revient, puisque la date est dépassée');
    // une date passée donnée
    eq(w.pass(MEMBER, { date: '2026-09-18' }).data.actual_finish, '2026-09-18', 'le jalon est passé à la date indiquée si elle est dans le passé');
  });

  test('Qui peut le déclarer : le responsable du jalon et les niveaux au-dessus, pas un Contributor, pas un externe ; contrôles de la date', () => {
    const w = world();
    eq(w.pass(EXT).error.code, 'FORBIDDEN', 'une personne hors du domaine, sans rôle : non');
    eq(w.raw(MEMBER, 'milestone.pass', { id: w.j.id }).error.code, 'FORBIDDEN', 'Mia est Contributor (pas responsable) du jalon « Revue » : non');
    ok(w.pass(WPL).ok, 'le Workpackage leader du workpackage qui contient le jalon : oui');
    ok(w.pass(CP, { passed: false }).ok && w.pass(DPL).ok, 'le chef de projet et le DPL : oui');
    eq(w.raw(WPL, 'milestone.pass', { id: w.cc.id }).error.code, 'VALIDATION', 'un livrable ne se marque pas passé');
    const future = w.pass(MEMBER, { passed: false });
    ok(future.ok);
    [['2026-12-31', 'dans le futur'], ['hier', 'illisible'], ['2026-13-45', 'impossible']].forEach((c) => eq(w.pass(MEMBER, { date: c[0] }).error.code, 'VALIDATION', 'date ' + c[1]));
    eq(w.item(w.late.id).status, 'À faire', 'une date refusée ne change rien');
    eq(w.raw(MEMBER, 'milestone.pass', { id: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Ce que le passage fait taire, et ce qu’il ne fait pas taire : retard et glissement critique cessent ; un jalon passé alors qu’un prérequis n’est pas terminé reste signalé', () => {
    const w = world();
    // glissement critique : baseline, puis le jalon « Revue » (responsable : Carla) glisse sur le chemin critique
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(CP, 'planitems.update', { id: w.j.id, patch: { planned_start: '2026-11-18', planned_finish: '2026-11-18' } });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { planned_finish: '2026-11-09' } });
    ok(w.codes().includes('CRITICAL_SLIP:' + w.j.id), 'avant : le jalon critique décalé est signalé');
    ok(w.raw(CP, 'milestone.pass', { id: w.j.id }).ok, 'le responsable du jalon (ici le chef de projet) le déclare passé');
    ok(!w.codes().includes('CRITICAL_SLIP:' + w.j.id), 'le glissement critique d’un jalon passé n’est plus signalé');
    // prérequis : le jalon exige un livrable qui n'est pas terminé
    w.c.repoInsert('MilestoneRequirement', { milestone_id: w.late.id, deliverable_id: w.b.id }, w.S);
    ok(w.pass(MEMBER).ok);
    const codes = w.codes();
    ok(!codes.includes('LATE_ITEM:' + w.late.id) && codes.includes('MILESTONE_INCOMPLETE:' + w.late.id), 'plus de retard, mais « jalon marqué atteint alors que son livrable n’est pas terminé » reste : une incohérence, pas un retard');
    // un jalon à venir n'a jamais d'alerte d'échéance, passé ou non
    ok(!w.codes().includes('LATE_ITEM:' + w.j.id), 'un jalon à venir : aucune alerte de retard');
  });

  test('Le WBS dit quel jalon on peut déclarer passé et lequel l’est déjà', () => {
    const w = world();
    w.pass(MEMBER);
    const tree = (who) => w.call(who, 'wbs.tree', { projectId: w.p1.id }).nodes;
    const node = (who, id) => tree(who).find((n) => n.ref === id);
    eq([node(MEMBER, w.late.id).canPass, node(MEMBER, w.late.id).passed_on, node(MEMBER, w.late.id).late], [true, w.c.todayStr(), false], 'le responsable : peut le rouvrir, la date du passage, plus en retard');
    eq([node(MEMBER, w.j.id).canPass, node(MEMBER, w.cc.id).canPass], [false, false], 'Mia ne peut pas déclarer le jalon « Revue » (elle n’en est pas responsable), et un livrable n’a pas de passage');
    eq([node(CP, w.j.id).canPass, node(WPL, w.late.id).canPass, node(DPL, w.late.id).canPass], [true, true, true], 'le chef de projet, le Workpackage leader et le DPL : oui');
    eq(node(CP, w.j.id).passed_on, '', 'un jalon non passé : pas de date');
  });
};
