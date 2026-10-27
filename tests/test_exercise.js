const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nExercice budgétaire : budget attendu et accordé par équipe, parts des livrables, écarts, clash (0.17.1)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** Équipes : 1vm (3) ⊃ 1vmd (4) ; 2ae (3, Allemagne) ; « Direction » (hors règle) ; zzzz (4 sans parente à 3). Exercices : 2026 en exécution, 2027 en préparation. Coût d'un ETP : France 2027. */
  function world() {
    const w = lot2World();
    w.team = (name, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name }, extra || {}) });
    w.vm = w.team('1vm', { country: 'FR' }); w.vmd = w.team('1vmd', { parent_team_id: w.vm.id, country: 'FR' }); w.ae = w.team('2ae', { country: 'DE' });
    w.dir = w.team('Direction'); w.zz = w.team('zzzz');
    const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2027, annual_cost: 130000 } });
    w.get = (who, projectId, exerciseId) => w.raw(who || CP, 'exercise.get', { projectId: projectId || w.p1.id, exerciseId: exerciseId || w.prep.id });
    w.set = (who, p) => w.raw(who || CP, 'exercise.set', Object.assign({ projectId: w.p1.id, exerciseId: w.prep.id }, p));
    w.part = (who, item, team, amount, exerciseId) => w.raw(who || CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: exerciseId === undefined ? w.prep.id : exerciseId });
    w.row = (data, name) => data.rows.find((r) => r.name === name);
    return w;
  }

  test('Exercices : l’administrateur seul les crée et les fait avancer ; un en préparation et un en exécution au plus ; on ne revient pas en arrière', () => {
    const w = lot2World();
    eq(w.raw(CP, 'exercise.create', { year: 2027 }).error.code, 'FORBIDDEN', 'le chef de projet ne crée pas d’exercice');
    [1999, 2101, 'x', '', 2026.5].forEach((y) => eq(w.raw(ADMIN, 'exercise.create', { year: y }).error.code, 'VALIDATION', 'année ' + y));
    const a = w.call(ADMIN, 'exercise.create', { year: 2026 });
    eq([a.year, a.status], [2026, 'Préparation'], 'un nouvel exercice est en préparation');
    ok(/déjà en préparation/.test(w.raw(ADMIN, 'exercise.create', { year: 2027 }).error.message), 'un seul exercice en préparation à la fois');
    ok(/existe déjà/.test(w.raw(ADMIN, 'exercise.create', { year: 2026 }).error.message), 'et pas deux fois la même année');
    eq(w.raw(CP, 'exercise.setStatus', { id: a.id, status: 'Exécution' }).error.code, 'FORBIDDEN');
    ok(/ne peut passer qu’en exécution/.test(w.raw(ADMIN, 'exercise.setStatus', { id: a.id, status: 'Clos' }).error.message), 'on ne saute pas d’étape');
    const exec = w.call(ADMIN, 'exercise.setStatus', { id: a.id, status: 'Exécution' });
    eq(exec.status, 'Exécution');
    const b = w.call(ADMIN, 'exercise.create', { year: 2027 });
    ok(/déjà en exécution/.test(w.raw(ADMIN, 'exercise.setStatus', { id: b.id, status: 'Exécution' }).error.message), 'un seul exercice en exécution à la fois');
    ok(/on ne le rouvre pas|ne peut passer/.test(w.raw(ADMIN, 'exercise.setStatus', { id: exec.id, status: 'Préparation' }).error.message), 'pas de retour en arrière');
    const clos = w.call(ADMIN, 'exercise.setStatus', { id: exec.id, status: 'Clos' });
    eq(clos.status, 'Clos');
    ok(/on ne le rouvre pas/.test(w.raw(ADMIN, 'exercise.setStatus', { id: clos.id, status: 'Exécution' }).error.message), 'un exercice clos ne se rouvre pas');
    ok(w.raw(ADMIN, 'exercise.setStatus', { id: b.id, status: 'Exécution' }).ok, 'l’exécution étant libre, le suivant peut y passer');
    eq(w.call(MEMBER, 'exercise.list', {}).exercises.map((e) => e.year + ' ' + e.status), ['2027 Exécution', '2026 Clos'], 'tout le monde lit la liste, la plus récente d’abord');
  });

  test('Saisie du budget attendu et accordé : chef de projet et au-dessus ; règle des 3 et 4 caractères ; l’attendu se fige à l’exécution', () => {
    const w = world();
    eq([w.set(WPL, { teamId: w.vm.id, expected: 1000 }).error.code, w.set(MEMBER, { teamId: w.vm.id, expected: 1000 }).error.code], ['FORBIDDEN', 'FORBIDDEN'], 'ni le Workpackage leader, ni un membre ne saisissent');
    ok(w.set(CP, { teamId: w.vm.id, expected: 100000 }).ok, 'le chef de projet : l’attendu d’une équipe à 3 caractères');
    ok(w.set(DPL, { teamId: w.ae.id, expected: 50000 }).ok, 'le DPL aussi (niveau du dessus)');
    ok(/3 ou 4 caractères \(« Direction » en a 9\)/.test(w.set(CP, { teamId: w.dir.id, expected: 1 }).error.message), 'une équipe dont le nom n’a pas 3 ou 4 caractères ne porte pas de budget');
    ok(/doit être rattachée à une équipe de 3 caractères/.test(w.set(CP, { teamId: w.zz.id, expected: 1 }).error.message), 'une équipe à 4 caractères sans parente à 3 : refusée');
    ok(w.set(CP, { teamId: w.vmd.id, expected: 30000 }).ok, 'une équipe à 4 caractères rattachée à une équipe à 3 : le détail');
    [-1, 'x', 1e11].forEach((v) => eq(w.set(CP, { teamId: w.vm.id, expected: v }).error.code, 'VALIDATION', 'attendu ' + v));
    eq(w.set(CP, { teamId: w.vm.id }).error.code, 'VALIDATION', 'rien à enregistrer');
    eq(w.set(CP, { teamId: 'inconnue', expected: 1 }).error.code, 'NOT_FOUND');
    eq(w.raw(CP, 'exercise.set', { projectId: w.p2.id, exerciseId: w.prep.id, teamId: w.vm.id, expected: 1 }).error.code, 'FORBIDDEN', 'pas sur le projet d’un autre');
    eq(w.c.repoList('TeamBudget').length, 3, 'trois lignes : 1vm, 2ae et 1vmd');
    ok(w.set(CP, { teamId: w.vm.id, expected: '1 234,5' }).error, 'un nombre mal écrit est refusé');
    w.set(CP, { teamId: w.vm.id, granted: 90000 });
    eq(w.row(w.get().data, '1vm').granted, 90000, 'l’accordé se saisit aussi pendant la préparation');
    w.set(CP, { teamId: w.vm.id, granted: '' });
    w.set(CP, { teamId: w.vm.id, expected: '' });
    ok(!w.c.repoList('TeamBudget').some((b) => b.team_id === w.vm.id && !w.c.isTrue(b.deleted)), 'une ligne sans attendu ni accordé disparaît');
    eq(w.set(CP, { teamId: w.vm.id, granted: '' }).data, { saved: false }, 'effacer ce qui n’existe pas ne crée rien');
    // l'exercice 2026 est en exécution : l'attendu est figé, l'accordé se révise (février, avril)
    const inExec = (p) => w.raw(CP, 'exercise.set', Object.assign({ projectId: w.p1.id, exerciseId: w.exec.id, teamId: w.ae.id }, p));
    ok(/attendu est figé/.test(inExec({ expected: 10 }).error.message), 'exécution : le budget attendu est figé');
    ok(inExec({ granted: 80000 }).ok && inExec({ granted: 70000 }).ok, 'exécution : l’accordé se révise');
    ok(w.get(CP, w.p1.id, w.exec.id).data.can_edit_granted && !w.get(CP, w.p1.id, w.exec.id).data.can_edit_expected, 'la page est prévenue de ce qui est modifiable');
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    ok(/est clos/.test(inExec({ granted: 1 }).error.message), 'clos : plus rien ne change');
    eq(w.get(CP, w.p1.id, w.exec.id).data.can_edit, false);
  });

  test('Le tableau par équipe : attendu, accordé, parts des livrables, écarts, clash, détail des équipes à 4 caractères, jours équivalents', () => {
    const w = world();
    w.set(CP, { teamId: w.vm.id, expected: 100000 }); w.set(CP, { teamId: w.vmd.id, expected: 30000 }); w.set(CP, { teamId: w.ae.id, expected: 50000 });
    ok(w.part(CP, w.a, w.vm, 40000).ok && w.part(CP, w.a, w.vmd, 20000).ok && w.part(CP, w.b, w.vm, 30000).ok && w.part(CP, w.b, w.ae, 60000).ok, 'des livrables avec leurs parts par équipe');
    const d = w.get().data, vm = w.row(d, '1vm'), ae = w.row(d, '2ae');
    eq([vm.expected, vm.parts, vm.gap_expected, vm.own.expected, vm.own.parts], [130000, 90000, 40000, 100000, 70000], '1vm : l’équipe et son détail 1vmd additionnés ; ce qui reste à répartir');
    eq(vm.children.map((c) => [c.name, c.expected, c.parts]), [['1vmd', 30000, 20000]], 'le détail à 4 caractères');
    eq([ae.expected, ae.parts, ae.gap_expected], [50000, 60000, -10000], '2ae : les parts dépassent l’attendu, écart négatif (affiché, jamais bloquant)');
    eq([d.totals.expected, d.totals.parts, d.totals.gap_expected, d.totals.granted, d.totals.clash], [180000, 150000, 30000, null, false], 'totaux ; pas encore d’accordé : pas de clash');
    ok(vm.parts_days > 0 && vm.parts_days === w.c.daysFromAmount_(90000, 'FR', 2027) && vm.expected_days === w.c.daysFromAmount_(130000, 'FR', 2027), 'équivalent en jours : coût d’un ETP de la France en 2027 (' + vm.parts_days + ' j)');
    eq([ae.parts_days, d.etp_missing], [null, ['DE']], 'l’Allemagne n’a pas de coût d’ETP en 2027 : pas d’équivalent en jours, et la page le dit');
    // l'accordé : décembre, avec un clash sur 1vm
    w.set(CP, { teamId: w.vm.id, granted: 80000 }); w.set(CP, { teamId: w.ae.id, granted: 70000 });
    const g = w.get().data, vm2 = w.row(g, '1vm'), ae2 = w.row(g, '2ae');
    eq([vm2.granted, vm2.gap_granted, vm2.clash, ae2.gap_granted, ae2.clash], [80000, -10000, true, 10000, false], 'accordé 80 000 contre 90 000 de parts : clash ; 2ae : dans l’accordé');
    eq([g.totals.granted, g.totals.gap_granted, g.totals.clash], [150000, 0, false], 'au total, rien ne dépasse : le clash est par équipe, pas masqué par le total');
    // équipes qui ne s'additionnent nulle part
    w.part(CP, w.cc, w.zz, 5000); w.part(CP, w.cc, w.dir, 7000);
    const o = w.get().data;
    eq([o.orphans.map((x) => x.name + ':' + x.parts), o.unruled.map((x) => x.name + ':' + x.parts)], [['zzzz:5000'], ['Direction:7000']], 'une équipe à 4 caractères sans parente à 3, une équipe hors règle : à part, signalées, comptées dans les parts totales');
    eq(o.totals.parts, 162000, 'les parts hors tableau comptent dans le total des livrables');
    ok(o.teams.some((t) => t.name === '1vm' && t.level === 3) && o.teams.some((t) => t.name === '1vmd' && t.level === 4 && !t.orphan) && o.teams.some((t) => t.name === 'zzzz' && t.orphan) && !o.teams.some((t) => t.name === 'Direction'), 'les équipes qu’on peut ajouter au tableau : 3 et 4 caractères, avec les orphelines marquées');
    // droits de lecture : Workpackage leader et au-dessus, au global ; en dessous rien
    eq([w.get(WPL).ok, w.get(DPL).ok, w.get(MEMBER).error.code], [true, true, 'FORBIDDEN'], 'le Workpackage leader voit l’exercice du projet, pas un membre');
    eq(w.get(WPL).data.can_edit, false, 'en lecture seule pour lui');
  });

  test('Un livrable n’a qu’un exercice : celui de sa première part ; rattacher et détacher ; un exercice clos ne bouge plus ; le budget se filtre par exercice', () => {
    const w = world();
    ok(w.part(CP, w.a, w.vm, 1000).ok, 'la première part rattache le livrable à l’exercice 2027');
    eq(w.c.repoGet('PlanItem', w.a.id).exercise_id, w.prep.id);
    ok(/n’a qu’un exercice/.test(w.part(CP, w.a, w.ae, 500, w.exec.id).error.message), 'une part dans un autre exercice : refusée');
    ok(w.part(CP, w.a, w.ae, 500).ok && w.part(CP, w.a, w.dir, 100, '').ok, 'avec le même exercice, ou sans le préciser, c’est bon');
    const assign = (who, item, ex) => w.raw(who || CP, 'budget.deliverable.exercise', { deliverableId: item.id, exerciseId: ex });
    ok(/déjà du budget/.test(assign(CP, w.a, w.exec.id).error.message), 'un livrable qui a du budget ne change pas d’exercice');
    ok(assign(CP, w.b, w.exec.id).ok && w.c.repoGet('PlanItem', w.b.id).exercise_id === w.exec.id, 'un livrable sans budget se rattache à un exercice');
    ok(assign(CP, w.b, '').ok && w.c.repoGet('PlanItem', w.b.id).exercise_id === '', 'et s’en détache tant qu’il n’a pas de budget');
    // un livrable chiffré avant l'existence des exercices (aucun exercice) peut être rattaché
    ok(w.part(CP, w.b, w.vm, 700, '').ok && w.c.repoGet('PlanItem', w.b.id).exercise_id === '', 'une part saisie sans exercice : le livrable n’en a toujours pas');
    ok(assign(CP, w.b, w.exec.id).ok && w.c.repoGet('PlanItem', w.b.id).exercise_id === w.exec.id, 'et il peut être rattaché ensuite, avec son budget');
    ok(/déjà du budget dans l’exercice 2026/.test(assign(CP, w.b, w.prep.id).error.message) && /déjà du budget dans l’exercice 2026/.test(assign(CP, w.b, '').error.message), 'mais plus changé ni retiré une fois rattaché et chiffré');
    eq(assign(MEMBER, w.b, w.exec.id).error.code, 'FORBIDDEN', 'droit : celui du budget du livrable');
    eq(assign(CP, w.j, w.exec.id).error.code, 'VALIDATION', 'un jalon n’a pas d’exercice');
    // la lecture du budget par exercice
    const all = w.call(CP, 'budget.get', { projectId: w.p1.id }), ex = w.call(CP, 'budget.get', { projectId: w.p1.id, exerciseId: w.prep.id }), none = w.call(CP, 'budget.get', { projectId: w.p1.id, exerciseId: '__none' }), other = w.call(CP, 'budget.get', { projectId: w.p1.id, exerciseId: w.exec.id });
    eq([all.lines.length, ex.lines.length, none.lines.length, other.lines.length], [4, 3, 0, 1], 'le budget d’un exercice : ses livrables seulement')
    ok(all.unassigned.some((d) => d.id === w.cc.id) && !all.unassigned.some((d) => d.id === w.a.id || d.id === w.b.id), 'les livrables sans exercice sont listés (pour être rattachés), pas ceux qui en ont un');
    eq(all.exercises.map((e) => e.year), [2027, 2026], 'et la page reçoit la liste des exercices');
    ok(ex.deliverables.find((d) => d.id === w.a.id).exercise_year === 2027, 'chaque livrable dit son exercice');
    // un exercice clos : plus de part, plus de suppression, plus de rattachement
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    ok(/est clos/.test(assign(CP, w.cc, w.exec.id).error.message), 'on ne rattache pas à un exercice clos');
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' });
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Clos' });
    const line = w.c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id);
    ok(/est clos/.test(w.part(CP, w.a, w.vmd, 10).error.message) && /est clos/.test(w.raw(CP, 'budget.line.save', { id: line.id, values: { planned_amount: 5 } }).error.message) && /est clos/.test(w.raw(CP, 'budget.line.delete', { id: line.id }).error.message), 'dans un exercice clos : ni ajout, ni modification, ni suppression de part');
  });

  test('Vue programme : un total par projet (ceux que l’on peut lire) et un tableau par équipe tous projets confondus', () => {
    const w = world();
    w.set(CP, { teamId: w.vm.id, expected: 100000 });
    w.raw(ADMIN, 'exercise.set', { projectId: w.p2.id, exerciseId: w.prep.id, teamId: w.vm.id, expected: 40000 });
    w.raw(ADMIN, 'exercise.set', { projectId: w.p2.id, exerciseId: w.prep.id, teamId: w.ae.id, expected: 10000 });
    w.part(CP, w.a, w.vm, 60000);
    const prog = (who) => w.raw(who, 'exercise.program', { programId: w.prog.id, exerciseId: w.prep.id });
    const d = prog(DPL).data;
    eq(d.projects.map((p) => p.code + ':' + p.expected + ':' + p.parts), ['P1:100000:60000', 'P2:50000:0'], 'le DPL voit les deux projets de son programme');
    eq([w.row(d, '1vm').expected, w.row(d, '1vm').parts, w.row(d, '2ae').expected, d.totals.expected], [140000, 60000, 10000, 150000], 'le tableau par équipe additionne les projets');
    eq(prog(CP).data.projects.map((p) => p.code), ['P1'], 'un chef de projet ne voit que son projet dans le programme');
    eq(prog(MEMBER).error.code, 'FORBIDDEN', 'un membre ne voit rien de l’exercice');
    ok(prog(ADMIN).ok, 'l’administrateur voit tout');
  });

  test('Coût d’un ETP et exercice : la conversion en jours d’une part suit l’année de l’exercice, pas celle des dates', () => {
    const w = world();
    // le livrable B est daté de 2026 mais son exercice est 2027 : la conversion prend le coût de 2027
    w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2026, annual_cost: 100000 } });
    const line = w.part(CP, w.b, w.vm, 10000).data;
    eq(line.days_equivalent, w.c.daysFromAmount_(10000, 'FR', 2027), 'année de l’exercice (2027) : coût 130 000 €, pas celui de 2026');
    ok(line.days_equivalent !== w.c.daysFromAmount_(10000, 'FR', 2026), 'et pas le coût de 2026 : ' + line.days_equivalent + ' j contre ' + w.c.daysFromAmount_(10000, 'FR', 2026));
    const noCost = w.part(CP, w.b, w.ae, 10000).data;
    eq(noCost.days_equivalent, null, 'sans coût d’ETP pour l’Allemagne : « à paramétrer »');
  });
};
