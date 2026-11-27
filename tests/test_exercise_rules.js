const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nConstats du moteur de règles sur l’exercice (0.21.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** Équipes 1vm, 2ae ; exercice 2027 en préparation ; sur P1 : dotation 1vm 100 000 et 2ae 50 000 ; parts : Spécification 1vm 40 000, Calcul 1vm 30 000 et 2ae 40 000 (rien ne dépasse). */
  function world() {
    const w = lot2World();
    w.team = (name) => w.call(CP, 'teams.create', { values: { name } });
    w.vm = w.team('1vm'); w.ae = w.team('2ae');
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.set = (team, v) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.prep.id, teamId: team.id, amount: v });
    w.part = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: w.prep.id });
    w.set(w.vm, 100000); w.set(w.ae, 50000);
    w.part(w.a, w.vm, 40000); w.part(w.b, w.vm, 30000); w.part(w.b, w.ae, 40000);
    w.found = (today) => w.c.exerciseFindings_(today || w.c.todayStr());
    w.codes = () => { w.c.runRules(); return w.c.repoList('Insight').filter((i) => i.status === 'Nouveau' && /^EXERCISE_/.test(i.rule_code)).map((i) => i.rule_code); };
    return w;
  }
  const rules = (list) => list.map((f) => f.rule).sort();

  test('Rien à signaler tant que tout tient ; aucun montant dans un constat', () => {
    const w = world();
    eq(w.found(), [], 'dotations non dépassées, chaque équipe dotée : aucun constat');
    eq(w.codes(), [], 'et le moteur n’en écrit aucun');
  });

  test('Clash : un plan au-dessus de la dotation est une alerte ; elle disparaît quand l’écart est résorbé', () => {
    const w = world();
    w.set(w.vm, 60000);                                                             // parts de 1vm : 70 000
    const f = w.found();
    eq(rules(f), ['EXERCISE_CLASH'], 'un seul constat : le clash de 1vm');
    eq([f[0].severity, f[0].targetType, /1vm/.test(f[0].message), /dotation/.test(f[0].message), /Redéfinir les livrables/.test(f[0].suggestion)], ['Alerte', 'ExerciseTeam', true, true, true], 'gravité Alerte, l’équipe nommée, la marche à suivre');
    ok(!/€|\d{5,}/.test(f[0].message + f[0].suggestion), 'aucun montant dans le constat (il part dans le récapitulatif du matin) : ' + f[0].message);
    w.set(w.vm, 70000);
    eq(w.found(), [], 'dotation égale aux parts : plus de constat');
    w.set(w.vm, 60000); w.c.runRules();
    const ins = w.c.repoList('Insight').find((i) => i.rule_code === 'EXERCISE_CLASH');
    ok(ins && ins.status === 'Nouveau' && ins.severity === 'Alerte', 'le moteur écrit l’alerte');
    w.set(w.vm, 75000); w.c.runRules();
    ok(!w.c.repoList('Insight').some((i) => i.rule_code === 'EXERCISE_CLASH' && i.status === 'Nouveau'), 'écart résorbé : le constat disparaît tout seul au passage suivant');
    // ignoré, il n'est pas recréé
    w.set(w.vm, 60000); w.c.runRules();
    const again = w.c.repoList('Insight').find((i) => i.rule_code === 'EXERCISE_CLASH' && i.status === 'Nouveau');
    w.call(CP, 'insights.decide', { id: again.id, decision: 'Ignoré', note: 'connu' });
    w.c.runRules();
    eq(w.c.repoList('Insight').filter((i) => i.rule_code === 'EXERCISE_CLASH' && i.status === 'Nouveau').length, 0, 'un constat ignoré n’est pas recréé');
  });

  test('Équipe sans dotation, équipe sans livrable', () => {
    const w = world();
    w.part(w.cc, w.ae, 20000);                                                      // 2ae : 60 000 de parts pour 50 000 de dotation
    eq(rules(w.found()), ['EXERCISE_CLASH'], 'les parts de 2ae dépassent sa dotation');
    const spare = w.team('3xx');
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, team_id: spare.id, planned_amount: 1000 }, exerciseId: w.prep.id });
    eq(rules(w.found()), ['EXERCISE_CLASH', 'EXERCISE_UNFUNDED'], '3xx a des parts mais pas de dotation');
    const g5 = w.team('5gg'); w.set(g5, 5000);
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.a.id, team_id: g5.id, planned_amount: 1000 }, exerciseId: w.prep.id });
    ok(!w.found().some((x) => x.rule === 'EXERCISE_UNFUNDED' && /5gg/.test(x.message)), 'une équipe dotée n’est pas « sans dotation »');
    const t4 = w.team('4yy'); w.set(t4, 9000);
    const f = w.found();
    ok(f.some((x) => x.rule === 'EXERCISE_NO_PARTS' && x.severity === 'Info' && /4yy/.test(x.message)), '4yy a une dotation mais aucun livrable chiffré (les livrables ont commencé) : Info');
    // en exécution, le « sans livrable » n'a plus de sens ; restent le clash et les équipes sans dotation
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' });
    ok(!rules(w.found()).includes('EXERCISE_NO_PARTS') && rules(w.found()).includes('EXERCISE_UNFUNDED') && rules(w.found()).includes('EXERCISE_CLASH'), 'exercice en exécution : plus de « sans livrable », le clash et l’équipe sans dotation restent');
  });

  test('« Pas de livrable » ne se signale qu’une fois les livrables commencés', () => {
    const w = lot2World();
    w.call(CP, 'teams.create', { values: { name: '1vm' } });
    const vm = w.c.repoList('HierarchicalTeam').find((t) => t.name === '1vm');
    const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: prep.id, teamId: vm.id, amount: 100000 });
    eq(w.c.exerciseFindings_(w.c.todayStr()), [], 'en juin : une dotation et aucun livrable, c’est normal : rien à signaler');
  });

  test('Équipes hors règle : parts ou dotation sur un nom de 3 ou 4 caractères manquant ; quatre caractères sans parente', () => {
    const w = world();
    const dir = w.team('Direction'), zz = w.team('zzzz');
    w.part(w.cc, dir, 5000); w.part(w.cc, zz, 3000);
    const f = w.found().filter((x) => x.rule === 'EXERCISE_TEAM_RULE');
    eq(f.length, 2, 'deux équipes à régulariser');
    ok(f.some((x) => /Direction/.test(x.message) && /n’a pas 3 ou 4 caractères/.test(x.message)) && f.some((x) => /zzzz/.test(x.message) && /pas d’équipe parente à 3 caractères/.test(x.message)), 'chacune avec sa raison : ' + f.map((x) => x.message).join(' | '));
  });


  test('Qui lit ces constats : l’exercice à partir du Workpackage leader ; un projet clos n’en a plus', () => {
    const w = world();
    w.set(w.vm, 60000);
    w.c.runRules();
    const list = (who) => w.call(who, 'insights.list', { projectId: w.p1.id }).map((i) => i.rule_code);
    ok(list(CP).includes('EXERCISE_CLASH'), 'la cheffe de projet lit le clash');
    ok(list(WPL).includes('EXERCISE_CLASH'), 'le Workpackage leader lit l’exercice');
    ok(!list(MEMBER).some((c) => /^EXERCISE_/.test(c)), 'un Contributor ne lit pas les constats de l’exercice : ' + list(MEMBER).join(','));
    const alerts = (who) => w.call(who, 'overview.get', { projectId: w.p1.id }).detail.alerts.map((a) => a.message);
    ok(alerts(CP).some((m) => /Clash/.test(m)) && !alerts(MEMBER).some((m) => /Clash/.test(m)), 'l’Overview montre le clash à la cheffe de projet, pas à un Contributor');
    w.c.repoUpdate('Project', w.p1.id, { status: 'Clos' }, null, w.S);
    eq(w.found(), [], 'un projet clos n’a plus de constat');
    w.c.repoUpdate('Project', w.p1.id, { status: 'Actif' }, null, w.S);
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' }); w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Clos' });
    ok(!rules(w.found()).some((r) => /^EXERCISE_/.test(r)), 'un exercice clos n’a plus de constat');
  });
};
