const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nSuivi budgétaire de l’exercice en exécution : dotation, plan, valeur acquise, réalisé, atterrissage (0.21.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  /**
   * Aujourd'hui : 5 octobre 2026 (mois 10). Exercice 2026 en exécution, 2027 en préparation. Équipes 1vm ⊃ 1vmd, 2ae. Dotation : 1vm 80 000, 2ae 60 000.
   * Parts : Spécification 1vm 20 000 ; Calcul 1vm 30 000, 1vmd 10 000 et 2ae 40 000 ; Essais 2ae 10 000. Le CPN du projet : CPN-100.
   */
  function world() {
    const w = lot2World();
    w.team = (name, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name }, extra || {}) });
    w.vm = w.team('1vm'); w.vmd = w.team('1vmd', { parent_team_id: w.vm.id }); w.ae = w.team('2ae');
    const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.set = (ex, team, v) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: ex.id, teamId: team.id, amount: v });
    w.part = (ex, item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: ex.id });
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'Nacelle' });
    w.set(w.exec, w.vm, 80000); w.set(w.exec, w.ae, 60000);
    w.part(w.exec, w.a, w.vm, 20000); w.part(w.exec, w.b, w.vm, 30000); w.part(w.exec, w.b, w.vmd, 10000); w.part(w.exec, w.b, w.ae, 40000); w.part(w.exec, w.cc, w.ae, 10000);
    w.track = (who, p) => w.raw(who || CP, 'exercise.tracking', Object.assign({ projectId: w.p1.id }, p || {}));
    w.team$ = (d, name) => d.teams.find((t) => t.name === name);
    w.actual = (team, month, amount, cpn, who) => w.raw(who || CP, 'actuals.set', { projectId: w.p1.id, cpn: cpn === undefined ? 'CPN-100' : cpn, teamId: team.id, month, amount });
    return w;
  }

  test('Le suivi par équipe : dotation, plan, reste ; les équipes à 4 caractères comptent dans leur parente', () => {
    const w = world(), r = w.track();
    ok(r.ok, JSON.stringify(r.error));
    const d = r.data;
    eq([d.exercise.year, d.exercise.status, d.today], [2026, 'Exécution', '2026-10-05'], 'l’exercice en exécution par défaut, au 5 octobre');
    const vm = w.team$(d, '1vm'), ae = w.team$(d, '2ae');
    eq([vm.dotation, vm.plan, vm.remaining, vm.clash], [80000, 60000, 20000, false], '1vm : 30 000 + 20 000 + 10 000 de 1vmd (comptés dans 1vm) ; il reste 20 000 sur la dotation');
    eq([ae.dotation, ae.plan, ae.remaining, ae.clash], [60000, 50000, 10000, false], '2ae');
    ok(!d.teams.some((t) => t.name === '1vmd'), 'l’équipe à 4 caractères n’a pas de ligne : elle est dans 1vm');
    eq([d.totals.dotation, d.totals.plan, d.totals.remaining, d.totals.clash], [140000, 110000, 30000, false], 'totaux : dotation 140 000, plan 110 000, il reste 30 000');
    eq([vm.landing, d.totals.landing, vm.actual_to_date], [null, null, null], 'sans réalisé saisi : pas d’atterrissage, le reste se lit sur le plan');
    ok(!JSON.stringify(d).match(/monthly_plan|pv\b|committed_cum|phasing/), 'plus de prévisionnel mensuel');
  });

  test('Valeur acquise : les parts × l’avancement du livrable', () => {
    const w = world();
    eq(w.track().data.totals.ev, 0, 'aucun avancement déclaré : rien d’acquis');
    w.call(MEMBER, 'progress.declare', { planItemId: w.b.id, progressPct: 50, comment: 'mi-parcours' });
    w.call(CP, 'progress.declare', { planItemId: w.a.id, progressPct: 100 });
    const d = w.track().data, vm = w.team$(d, '1vm'), ae = w.team$(d, '2ae');
    eq([vm.ev, ae.ev, d.totals.ev], [20000 + 0.5 * 40000, 0.5 * 40000, 20000 + 0.5 * 40000 + 0.5 * 40000], '1vm : Spécification finie (20 000) + la moitié de Calcul (30 000 + 10 000 de 1vmd) ; 2ae : la moitié de 40 000');
    eq([vm.progress_pct, d.totals.progress_pct], [67, 55], 'avancement pondéré par les montants');
    const dl = (n) => d.deliverables.find((x) => x.name === n);
    eq([dl('Calcul').plan, dl('Calcul').progress, dl('Calcul').ev, dl('Spécification').ev, dl('Essais').ev], [80000, 50, 40000, 20000, 0], 'par livrable : plan, avancement, valeur acquise');
    eq(dl('Calcul').teams, '1vm, 1vmd, 2ae', 'les équipes qui y ont une part');
    eq(d.deliverables.map((x) => x.name)[0], 'Calcul', 'les plus gros livrables d’abord');
  });

  test('Réalisé saisi à la main : à ce jour, sur l’année ; atterrissage = réalisé + reste à faire ; l’équipe à 4 caractères compte dans sa parente', () => {
    const w = world();
    w.call(MEMBER, 'progress.declare', { planItemId: w.b.id, progressPct: 50, comment: '' });
    w.call(CP, 'progress.declare', { planItemId: w.a.id, progressPct: 100 });
    ok(w.actual(w.vm, '2026-03', 10000).ok && w.actual(w.vmd, '2026-05', 2000).ok && w.actual(w.vm, '2026-11', 3000).ok, 'trois saisies : mars, mai (1vmd) et novembre (à venir)');
    const d = w.track().data, vm = w.team$(d, '1vm');
    eq([vm.actual_to_date, vm.actual_year, vm.consumed_pct], [12000, 15000, 20], '1vm : 12 000 à ce jour (mars + mai de 1vmd), 15 000 sur l’année (novembre compris)');
    eq([vm.ev, vm.landing, vm.remaining, vm.over], [40000, 12000 + (60000 - 40000), 80000 - 32000, false], 'atterrissage : 12 000 déjà consommés + 20 000 restant à faire = 32 000, contre 80 000');
    const ae = w.team$(d, '2ae');
    eq([ae.actual_to_date, ae.landing], [0, 50000 - 20000], '2ae : rien de consommé, l’atterrissage est le reste à faire');
    eq([d.totals.actual_to_date, d.totals.actual_year, d.totals.landing], [12000, 15000, 32000 + 30000], 'totaux');
    eq(d.actuals.available, true); eq(d.projection.available, true);
    eq([d.actuals.monthly[2], d.actuals.monthly[4], d.actuals.monthly[10], d.actuals.cumulative[2], d.actuals.cumulative[10], d.actuals.cumulative[11]], [10000, 2000, 3000, 10000, 15000, null], 'série mensuelle et cumul, jusqu’au dernier mois saisi');
    eq(d.actuals.by_cpn, [{ cpn: 'CPN-100', total: 15000 }], 'le réalisé par CPN');
    // un dépassement : la dotation de 2ae est ramenée à 30 000 ; 25 000 consommés à ce jour et 30 000 restant à faire
    w.set(w.exec, w.ae, 30000); w.actual(w.ae, '2026-06', 25000);
    const e = w.team$(w.track().data, '2ae');
    eq([e.clash, e.landing, e.over, e.remaining], [true, 55000, true, -25000], '2ae : plan 50 000 et atterrissage 55 000 contre 30 000 de dotation');
  });

  test('Saisie du réalisé : droits, CPN du projet, remplacement, avoir, exercice clos', () => {
    const w = world();
    eq(w.actual(w.vm, '2026-03', 1000, 'CPN-100', MEMBER).error.code, 'FORBIDDEN', 'un Contributor ne saisit pas');
    eq(w.actual(w.vm, '2026-03', 1000, 'CPN-100', WPL).error.code, 'FORBIDDEN', 'le Workpackage leader non plus : c’est la comptabilité du projet');
    eq(w.actual(w.vm, '2026-03', 1000, 'CPN-999').error.code, 'VALIDATION', 'un CPN qui n’est pas celui du projet : refusé');
    eq(w.actual(w.vm, '2026-3', 1000).error.code, 'VALIDATION', 'mois invalide');
    eq(w.actual(w.vm, '2026-03', 'abc').error.code, 'VALIDATION', 'montant illisible');
    w.actual(w.vm, '2026-03', '1 000,5'.replace(' ', ''));
    w.actual(w.vm, '2026-03', 4000);
    eq(w.c.repoList('ActualLine').map((l) => l.amount), [4000], 'saisir à nouveau le même CPN, la même équipe et le même mois REMPLACE le montant');
    w.actual(w.vm, '2026-03', -500);
    eq(w.c.repoList('ActualLine').map((l) => l.amount), [-500], 'un avoir est un montant négatif');
    eq(w.actual(w.vm, '2026-03', '').data, { removed: true }, 'un montant vide retire la ligne');
    eq(w.c.repoList('ActualLine').filter((l) => !w.c.isTrue(l.deleted)).length, 0);
    w.actual(w.vm, '2026-04', 700);
    const g = w.call(CP, 'actuals.get', { projectId: w.p1.id });
    eq([g.can_edit, g.months.length, g.lines.map((l) => l.team + ':' + l.month + ':' + l.amount), g.cpns.map((c) => c.cpn)], [true, 12, ['1vm:2026-04:700'], ['CPN-100']], 'la page reçoit les lignes saisies, les mois et les CPN');
    eq(w.raw(MEMBER, 'actuals.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'le réalisé n’est lu que par ceux qui voient le budget du projet');
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    ok(/clos/.test(w.actual(w.vm, '2026-05', 1).error.message), 'un exercice clos ne bouge plus');
  });

  test('Externe : les forfaits du plan face aux commandes d’achat engagées', () => {
    const w = world();
    ok(w.call(CP, 'budget.line.save', { values: { deliverable_id: w.a.id, resource_id: w.xavier.id, fixed_amount: 20000 }, exerciseId: w.exec.id }).id, 'un forfait externe de 20 000 sur Spécification');
    const po = (n, amount, launched, status) => w.call(CP, 'po.save', { values: { po_number: n, cpn: 'CPN-100', resource_id: w.xavier.id, amount, status: status || 'Lancée', launched_on: launched, gr_due_date: '2026-12-01' } });
    po('CB-1', 5000, '2026-03-10'); po('CB-2', 7000, '2026-09-02'); po('CB-3', 900, '', 'À faire');   // la dernière n'est pas engagée
    const d = w.track().data;
    eq(d.totals.external, { plan: 20000, committed: 12000, remaining: 8000, over: false }, 'forfaits 20 000, engagé 12 000 : il reste 8 000');
    eq(d.totals.plan, 110000, 'le forfait n’entre pas dans le plan des équipes, il se suit à part');
    po('CB-4', 9000, '2026-10-01');
    eq(w.track().data.totals.external.over, true, 'au-delà du forfait : signalé');
  });

  test('Clash au suivi, exercice choisi, droits', () => {
    const w = world();
    w.set(w.exec, w.ae, 30000);                                                                     // 2ae : 50 000 de plan pour 30 000 de dotation
    const d = w.track().data;
    eq([w.team$(d, '2ae').clash, w.team$(d, '2ae').remaining, d.totals.clash, d.totals.remaining], [true, -20000, false, 0], 'clash de 2ae, invisible au total (110 000 de dotation pour 110 000 de plan) : il se lit par équipe');
    const p2 = w.track(CP, { exerciseId: w.prep.id }).data;
    eq([p2.exercise.year, p2.teams.length, p2.totals.plan, p2.totals.dotation], [2027, 0, 0, null], 'l’exercice 2027 : rien encore');
    eq(w.track(WPL).ok, true, 'le Workpackage leader lit le suivi');
    eq(w.track(MEMBER).error.code, 'FORBIDDEN', 'un Contributor ne le lit pas');
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    eq(w.track().error.code, 'NOT_FOUND', 'sans exercice en exécution : on le dit');
    eq(w.track(CP, { exerciseId: w.exec.id }).ok, true, 'un exercice clos se suit encore par son identifiant');
    eq(w.track().error.message.indexOf('Aucun exercice en exécution') === 0, true);
  });

  test('L’atterrissage attend le réalisé', () => {
    const w = world(), d = w.track().data;
    eq(d.projection.available, false, 'aucun réalisé saisi : pas d’atterrissage');
    ok(/réalisé/.test(d.projection.reason));
  });
};
