const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nSuivi budgétaire de l’exercice en exécution : prévu, valeur acquise, engagé, séries mensuelles (0.19.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  /**
   * Aujourd'hui : 5 octobre 2026 (mois 10). Exercice 2026 en exécution, 2027 en préparation. Équipes 1vm ⊃ 1vmd, 2ae. Accordé : 1vm 80 000, 2ae 60 000.
   * Parts : Spécification (5–9 oct) 1vm 20 000 ; Calcul (12–23 oct) 1vm 30 000, 1vmd 10 000 et 2ae 40 000 ; Essais (26 oct–6 nov) 2ae 10 000.
   */
  function world() {
    const w = lot2World();
    w.team = (name, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name }, extra || {}) });
    w.vm = w.team('1vm'); w.vmd = w.team('1vmd', { parent_team_id: w.vm.id }); w.ae = w.team('2ae');
    const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.set = (ex, team, f, v) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: ex.id, teamId: team.id, [f]: v });
    w.part = (ex, item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: ex.id });
    w.set(w.exec, w.vm, 'granted', 80000); w.set(w.exec, w.ae, 'granted', 60000);
    w.part(w.exec, w.a, w.vm, 20000); w.part(w.exec, w.b, w.vm, 30000); w.part(w.exec, w.b, w.vmd, 10000); w.part(w.exec, w.b, w.ae, 40000); w.part(w.exec, w.cc, w.ae, 10000);
    w.track = (who, p) => w.raw(who || CP, 'exercise.tracking', Object.assign({ projectId: w.p1.id }, p || {}));
    w.team$ = (d, name) => d.teams.find((t) => t.name === name);
    return w;
  }
  // le prévu à ce jour recalculé à partir des échéanciers eux-mêmes, indépendamment du module testé
  const phasingOf = (w, item) => w.c.repoList('BudgetLine').filter((l) => l.deliverable_id === item.id).flatMap((l) => w.c.repoList('BudgetPhasing').filter((x) => x.budget_line_id === l.id));
  const sumTo = (list, m) => list.filter((x) => Number(String(x.month).slice(5)) <= m).reduce((s, x) => s + Number(x.amount), 0);

  test('Le suivi par équipe : accordé, prévu de l’année, prévu à ce jour, reste ; les équipes à 4 caractères comptent dans leur parente', () => {
    const w = world(), r = w.track();
    ok(r.ok, JSON.stringify(r.error));
    const d = r.data;
    eq([d.exercise.year, d.exercise.status, d.current_month, d.months.length, d.months[0], d.months[11]], [2026, 'Exécution', 10, 12, '2026-01', '2026-12'], 'l’exercice en exécution par défaut, au mois d’octobre');
    const vm = w.team$(d, '1vm'), ae = w.team$(d, '2ae');
    eq([vm.granted, vm.planned_total, vm.planned_year, vm.remaining, vm.clash], [80000, 60000, 60000, 20000, false], '1vm : 30 000 + 20 000 + 10 000 de 1vmd (comptés dans 1vm) ; il reste 20 000 sur l’accordé');
    eq([ae.granted, ae.planned_year, ae.remaining, ae.clash], [60000, 50000, 10000, false], '2ae');
    ok(!d.teams.some((t) => t.name === '1vmd'), 'l’équipe à 4 caractères n’a pas de ligne : elle est dans 1vm');
    // le prévu à ce jour = les échéanciers jusqu'au mois courant
    const all = [w.a, w.b, w.cc].flatMap((i) => phasingOf(w, i));
    eq(d.totals.pv, Math.round(sumTo(all, 10) * 100) / 100, 'le prévu à ce jour est la somme des échéanciers jusqu’en octobre');
    eq(d.totals.planned_year, 110000, 'prévu de l’année : toutes les parts tiennent dans l’année');
    eq([d.totals.granted, d.totals.remaining, d.totals.clash, d.totals.planned_outside], [140000, 30000, false, 0], 'totaux : accordé 140 000, il reste 30 000');
    eq(vm.monthly.reduce((s, x) => s + x, 0), vm.planned_year, 'les douze mois de l’équipe additionnent son prévu de l’année');
    ok(vm.monthly[9] > 0 && vm.monthly[0] === 0 && vm.monthly[11] === 0, 'le prévu de 1vm est en octobre, rien en janvier ni en décembre');
  });

  test('Valeur acquise : les parts × l’avancement du livrable ; son écart au prévu à ce jour dit l’avance ou le retard', () => {
    const w = world();
    eq(w.track().data.totals.ev, 0, 'aucun avancement déclaré : rien d’acquis');
    w.call(MEMBER, 'progress.declare', { planItemId: w.b.id, progressPct: 50, comment: 'mi-parcours' });
    w.call(CP, 'progress.declare', { planItemId: w.a.id, progressPct: 100 });
    const d = w.track().data, vm = w.team$(d, '1vm'), ae = w.team$(d, '2ae');
    eq([vm.ev, ae.ev, d.totals.ev], [20000 + 0.5 * 40000, 0.5 * 40000, 20000 + 0.5 * 40000 + 0.5 * 40000], '1vm : Spécification finie (20 000) + la moitié de Calcul (30 000 + 10 000 de 1vmd) ; 2ae : la moitié de 40 000');
    const dl = (n) => d.deliverables.find((x) => x.name === n);
    eq([dl('Calcul').parts, dl('Calcul').progress, dl('Calcul').ev, dl('Spécification').ev, dl('Essais').ev], [80000, 50, 40000, 20000, 0], 'par livrable : parts, avancement, valeur acquise');
    eq(dl('Calcul').teams, '1vm, 1vmd, 2ae', 'les équipes qui y ont une part');
    eq(dl('Essais').pv, Math.round(sumTo(phasingOf(w, w.cc), 10) * 100) / 100, 'le prévu à ce jour d’un livrable : ses échéanciers jusqu’en octobre seulement');
    ok(dl('Essais').pv > 0 && dl('Essais').pv < dl('Essais').parts, 'Essais court d’octobre à novembre : une partie seulement est due à ce jour');
    eq(dl('Calcul').ev_gap, Math.round((40000 - dl('Calcul').pv) * 100) / 100, 'écart = valeur acquise − prévu à ce jour');
    ok(d.deliverables[0].ev_gap <= d.deliverables[d.deliverables.length - 1].ev_gap, 'les livrables les plus en retard d’abord');
    eq(Math.round((d.totals.ev_gap - (d.totals.ev - d.totals.pv)) * 100), 0, 'l’écart du total est cohérent');
  });

  test('Engagé : les commandes d’achat du projet, par mois, cumulées jusqu’au mois courant', () => {
    const w = world();
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'Nacelle' });
    const po = (n, amount, launched) => w.call(CP, 'po.save', { values: { po_number: n, cpn: 'CPN-100', resource_id: w.xavier.id, amount, status: 'Lancée', launched_on: launched, gr_due_date: '2026-12-01' } });
    po('CB-1', 5000, '2026-03-10'); po('CB-2', 7000, '2026-09-02');
    w.call(CP, 'po.save', { values: { po_number: 'CB-3', cpn: 'CPN-100', resource_id: w.xavier.id, amount: 900, status: 'À faire', gr_due_date: '2026-12-01' } });   // pas engagée
    const d = w.track().data;
    eq([d.totals.committed_to_date, d.totals.committed_year], [12000, 12000], 'seules les PO engagées comptent : 5 000 en mars, 7 000 en septembre');
    eq([d.series.committed_cum[1], d.series.committed_cum[2], d.series.committed_cum[8], d.series.committed_cum[9], d.series.committed_cum[10]], [0, 5000, 12000, 12000, null], 'cumul : 5 000 dès mars, 12 000 dès septembre, rien au-delà du mois courant');
    eq(d.series.planned_cum[11], 110000, 'le prévu cumulé finit à 110 000');
  });

  test('Clash au suivi, prévu hors année, exercice choisi, droits', () => {
    const w = world();
    w.set(w.exec, w.ae, 'granted', 30000);                                                          // 2ae : 50 000 de parts pour 30 000 accordés
    const d = w.track().data;
    eq([w.team$(d, '2ae').clash, w.team$(d, '2ae').remaining, d.totals.clash, d.totals.remaining], [true, -20000, false, 0], 'clash de 2ae (50 000 de parts pour 30 000 accordés), invisible au total (110 000 accordés pour 110 000 prévus) : le clash se lit par équipe');
    // un livrable à cheval sur deux années : une partie du prévu est hors année
    const long = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Long', item_type: 'Livrable', planned_start: '2026-12-01', planned_finish: '2027-02-26', wp_id: w.w2.id, owner_resource_id: w.carla.id } });
    w.part(w.exec, long, w.vm, 30000);
    const d2 = w.track().data;
    ok(d2.totals.planned_outside > 0 && d2.totals.planned_year + d2.totals.planned_outside === d2.totals.planned_total, 'le prévu au-delà de l’année est compté à part : ' + d2.totals.planned_outside);
    // un autre exercice
    const p2 = w.track(CP, { exerciseId: w.prep.id }).data;
    eq([p2.exercise.year, p2.current_month, p2.totals.pv, p2.teams.length], [2027, 0, 0, 0], 'l’exercice 2027, pas encore commencé : rien à ce jour');
    eq(w.track(WPL).ok, true, 'le Workpackage leader lit le suivi');
    eq(w.track(MEMBER).error.code, 'FORBIDDEN', 'un Contributor ne le lit pas');
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    eq(w.track().error.code, 'NOT_FOUND', 'sans exercice en exécution : on le dit');
    eq(w.track(CP, { exerciseId: w.exec.id }).ok, true, 'un exercice clos se suit encore par son identifiant');
    eq(w.track().error.message.indexOf('Aucun exercice en exécution') === 0, true);
  });

  test('La projection de fin d’année annonce qu’elle attend le réalisé', () => {
    const w = world(), d = w.track().data;
    eq(d.projection.available, false, 'pas de réalisé importé : pas de projection');
    ok(/réalisé/.test(d.projection.reason));
  });
};
