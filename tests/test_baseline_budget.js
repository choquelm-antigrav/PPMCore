const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBaseline : elle fige le plan budgétaire (cellules et dotations) et garde la trace de son évolution (0.21.0)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** Exercice 2026 en exécution ; dotations 1vm 5 000 et 2ae 2 000 ; cellules : Spécification 800 (1vm) et Calcul 500 (2ae) ; une baseline B0 figée là-dessus. */
  function world() {
    const w = lot2World();
    const e0 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    w.vm = w.call(CP, 'teams.create', { values: { name: '1vm' } }); w.ae = w.call(CP, 'teams.create', { values: { name: '2ae' } }); w.xx = w.call(CP, 'teams.create', { values: { name: '3xx' } });
    w.dot = (team, amount) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.exec.id, teamId: team.id, amount });
    w.cell = (item, team, amount) => w.call(CP, 'budget.cell.set', { deliverableId: item.id, teamId: team.id, amount, exerciseId: w.exec.id });
    w.dot(w.vm, 5000); w.dot(w.ae, 2000); w.cell(w.a, w.vm, 800); w.cell(w.b, w.ae, 500);
    w.b0 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning et budget initiaux', label: 'P1_0' });
    w.dec = (who, p) => w.raw(who || CP, 'baselines.plan', Object.assign({ projectId: w.p1.id, exerciseId: w.exec.id }, p || {}));
    // des changements après la baseline : dotation 1vm +1 000, 2ae retirée, 3xx ajoutée ; cellules : une modifiée (+200), une retirée (−500), une ajoutée (+1 500 sur WP 2)
    w.change = () => { w.dot(w.vm, 6000); w.dot(w.ae, ''); w.dot(w.xx, 300); w.cell(w.a, w.vm, 1000); w.cell(w.b, w.ae, ''); w.cell(w.cc, w.ae, 1500); };
    return w;
  }

  test('La baseline fige les cellules, les dotations d’équipe et l’exercice des livrables', () => {
    const w = world(), snap = w.c.loadBaselineSnapshot_(w.b0.id);
    const dots = Object.keys(snap.TeamBudget).map((k) => snap.TeamBudget[k].amount).sort();
    eq([dots, 'exercise_id' in snap.PlanItem[w.a.id], Object.keys(snap.BudgetLine).length], [[2000, 5000], true, 2], 'dotations, exercice du livrable et cellules sont dans l’instantané');
    ok(!JSON.stringify(snap).match(/envelopes_json|budget_authorized|phasing/), 'ni enveloppe, ni étalement : ils n’existent plus');
  });

  test('Ce qui a bougé depuis la baseline : dotations, plan par workpackage, cellules ajoutées, retirées ou modifiées', () => {
    const w = world();
    eq(w.dec().data.plan.totals, { line_changes: 0, dotation_changes: 0, cost_base: 1300, cost: 1300, cost_delta: 0 }, 'juste après la baseline : aucun écart');
    w.change();
    const d = w.dec().data.plan, wp = (x) => d.wps.find((r) => r.wp_id === x.id);
    eq([wp(w.w1).base_cost, wp(w.w1).cost, wp(w.w1).cost_delta, wp(w.w1).state], [1300, 1000, -300, 'changed'], 'WP 1 : 1 300 → 1 000 (−500 cellule retirée, +200 cellule modifiée)');
    eq([wp(w.w2).base_cost, wp(w.w2).cost, wp(w.w2).cost_delta, wp(w.w2).state], [0, 1500, 1500, 'changed'], 'WP 2 : 1 500 € de plan de plus');
    eq(d.lines.map((l) => l.deliverable + ':' + l.state + ':' + l.base_amount + '>' + l.amount).sort(), ['Calcul:removed:500>null', 'Essais:added:null>1500', 'Spécification:changed:800>1000'], 'les cellules ajoutées, retirées ou modifiées, par livrable');
    eq(d.lines.find((l) => l.deliverable === 'Essais').target, '2ae', 'chaque cellule dit son équipe');
    eq(d.dotations.map((x) => x.team + ':' + x.state + ':' + x.base_amount + '>' + x.amount).sort(), ['1vm:changed:5000>6000', '2ae:removed:2000>null', '3xx:added:null>300'], 'les dotations changées, retirées ou ajoutées');
    eq([d.totals.line_changes, d.totals.dotation_changes, d.totals.cost_delta], [3, 3, 1200], 'trois cellules, trois dotations, +1 200 € de plan');
  });

  test('Qui la lit : ceux qui voient le budget du projet', () => {
    const w = world();
    w.change();
    ok(w.dec(CP).ok && w.dec(DPL).ok, 'le chef de projet et le DPL');
    eq([w.dec(WPL).error.code, w.dec(MEMBER).error.code], ['FORBIDDEN', 'FORBIDDEN'], 'ni un Workpackage leader, ni un Contributor (ils n’ont pas le budget du projet)');
    const noBase = lot2World();
    eq(noBase.raw(CP, 'baselines.plan', { projectId: noBase.p1.id }).data, { baseline: null, plan: null, see_budget: false }, 'sans baseline : rien à comparer, sans erreur');
    eq(w.raw(CP, 'baselines.decomposition', { projectId: w.p1.id }).error.code, 'NOT_FOUND', 'l’ancienne comparaison n’existe plus');
  });

  test('Suivre l’évolution d’une baseline à l’autre : deux baselines comparées entre elles', () => {
    const w = world();
    w.change();
    const b1 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Budget revu', label: 'P1_1' });
    const d = w.dec(CP, { baselineId: w.b0.id, compareTo: b1.id }).data;
    eq([d.baseline.label, d.compareTo.label, d.plan.totals.cost_delta, d.plan.totals.line_changes, d.plan.totals.dotation_changes], ['P1_0', 'P1_1', 1200, 3, 3], 'B0 → B1 : ce qui a changé entre les deux baselines');
    eq(w.dec(CP, { baselineId: b1.id }).data.plan.totals.cost_delta, 0, 'B1 contre l’état actuel : plus d’écart');
  });

  test('Traçabilité : les changements du plan entrent dans le fil de validation, comme ceux du planning', () => {
    const w = world();
    w.change();
    const fresh = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable neuf', item_type: 'Livrable', planned_start: '2027-02-01', planned_finish: '2027-02-12', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.deliverable.exercise', { deliverableId: fresh.id, exerciseId: w.call(ADMIN, 'exercise.create', { year: 2027 }).id });
    const feed = w.call(DPL, 'changes.feed', { projectId: w.p1.id });
    const tables = feed.items.map((i) => i.table);
    ok(tables.includes('TeamBudget') && tables.includes('BudgetLine'), 'les dotations et les cellules : à valider par le niveau du dessus : ' + tables.join(' | '));
    ok(feed.items.some((i) => i.field === 'exercise_id' && i.field_label === 'exercice'), 'et le rattachement d’un livrable à un exercice');
    const dot = feed.items.find((i) => i.table === 'TeamBudget' && i.field === 'amount');
    eq([dot.entity, dot.field_label, dot.what, dot.old_value, dot.new_value], ['Dotation de 1vm', 'dotation', 'modification', '5000', '6000'], 'libellé lisible : l’équipe, l’ancien et le nouveau montant');
  });

  test('Le tableau affiche, pour chaque workpackage, livrable et équipe, ce qu’il valait à la baseline', () => {
    const w = world();
    w.change();
    const v = w.call(CP, 'budget.plan.get', { projectId: w.p1.id, exerciseId: w.exec.id });
    const row = (x, name) => v.rows.find((r) => r.kind === 'deliverable' && r.name === name);
    eq([v.baseline.label, v.baseline.number], ['P1_0', 0], 'la baseline de référence');
    eq([row(v, 'Spécification').base.total, row(v, 'Essais').base.total, v.totals.base_total], [800, 0, 1300], 'le plan figé de chaque livrable (0 s’il n’en avait pas) et du projet');
    eq(v.summary.rows.map((r) => r.name + ':' + r.base_dotation), ['1vm:5000', '2ae:2000', '3xx:null'], 'la dotation figée de chaque équipe (null : n’en avait pas)');
    const apparu = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable apparu', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-13', wp_id: w.w2.id, owner_resource_id: w.mia.id } });
    w.cell(apparu, w.vm, 10);
    const v2 = w.call(CP, 'budget.plan.get', { projectId: w.p1.id, exerciseId: w.exec.id });
    eq(v2.rows.find((r) => r.name === 'Livrable apparu').base.new, true, 'un livrable apparu depuis la baseline : « nouveau »');
    const none = lot2World();
    none.call(ADMIN, 'exercise.create', { year: 2026 });
    eq(none.call(CP, 'budget.plan.get', { projectId: none.p1.id }).baseline, undefined, 'sans baseline : pas de colonne d’évolution');
  });
};
