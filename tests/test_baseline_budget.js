const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBaseline : elle fige la décomposition du budget et garde la trace de son évolution (0.19.2)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';

  /** Budget autorisé 10 000 ; enveloppes WP 1 : 2 000, WP 2 : 1 000 ; lignes : Spécification 800 et Calcul 500 (forfaits) ; une baseline B0 figée là-dessus. */
  function world() {
    const w = lot2World();
    const e0 = w.call('admin@entreprise.com', 'exercise.create', { year: 2026 });
    w.exec = w.call('admin@entreprise.com', 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    const line = (item, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: amount }, exerciseId: w.exec.id });
    w.l1 = line(w.a, 800); w.l2 = line(w.b, 500);
    w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, authorized: 10000, allocations: [{ wpId: w.w1.id, amount: 2000 }, { wpId: w.w2.id, amount: 1000 }] });
    w.b0 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning et budget initiaux', label: 'P1_0' });
    w.dec = (who, p) => w.raw(who || CP, 'baselines.decomposition', Object.assign({ projectId: w.p1.id }, p || {}));
    // des changements après la baseline : deux enveloppes (projet, WP 1), une ligne modifiée (+200), une retirée (−500), une ajoutée (+1 500 sur WP 2)
    w.change = () => {
      w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, authorized: 12000, allocations: [{ wpId: w.w1.id, amount: 2500 }] });
      w.call(CP, 'budget.line.save', { id: w.l1.id, version: w.l1.version, values: { fixed_amount: 1000 } });
      w.call(CP, 'budget.line.delete', { id: w.l2.id, version: w.c.repoGet('BudgetLine', w.l2.id).version });
      w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 1500 }, exerciseId: w.exec.id });
    };
    return w;
  }

  test('La baseline fige le budget autorisé, l’enveloppe de chaque workpackage, l’exercice des livrables et les lignes de coût', () => {
    const w = world(), snap = w.c.loadBaselineSnapshot_(w.b0.id);
    const proj = Object.keys(snap.Project).map((k) => snap.Project[k])[0];
    const envOf = (rec) => w.c.envAmount_(rec, w.c.envKey_(w.exec));
    eq([envOf(proj), envOf(snap.WorkPackage[w.w1.id]), 'exercise_id' in snap.PlanItem[w.a.id]], [10000, 2000, true], 'budget autorisé, enveloppe d’un workpackage et exercice du livrable sont dans l’instantané');
    eq(Object.keys(snap.BudgetLine).length, 2, 'les deux lignes de coût aussi');
  });

  test('Ce qui a bougé depuis la baseline : enveloppes, coût par workpackage, lignes ajoutées, retirées ou modifiées', () => {
    const w = world();
    eq(w.dec().data.decomposition.totals, { envelope_changes: 0, line_changes: 0, cost_base: 1300, cost: 1300, cost_delta: 0, over: 0 }, 'juste après la baseline : aucun écart');
    w.change();
    const d = w.dec().data.decomposition, wp = (x) => d.wps.find((r) => r.wp_id === x.id);
    eq([d.project.known, d.project.base_authorized, d.project.authorized, d.project.changed], [true, 10000, 12000, true], 'le budget autorisé : 10 000 → 12 000');
    eq([wp(w.w1).base_allocated, wp(w.w1).allocated, wp(w.w1).allocated_changed, wp(w.w1).base_cost, wp(w.w1).cost, wp(w.w1).cost_delta, wp(w.w1).state], [2000, 2500, true, 1300, 1000, -300, 'changed'], 'WP 1 : enveloppe 2 000 → 2 500 ; coût 1 300 → 1 000 (−500 ligne retirée, +200 ligne modifiée)');
    eq([wp(w.w2).cost, wp(w.w2).cost_delta, wp(w.w2).over, wp(w.w2).allocated_changed, wp(w.w2).state], [1500, 1500, true, false, 'changed'], 'WP 2 : 1 500 € de coût pour 1 000 € d’enveloppe : en dépassement ; son enveloppe n’a pas bougé, son coût si');
    eq(d.lines.map((l) => l.deliverable + ':' + l.state + ':' + l.base_amount + '>' + l.amount).sort(), ['Calcul:removed:500>null', 'Essais:added:null>1500', 'Spécification:changed:800>1000'], 'les lignes ajoutées, retirées ou modifiées, par livrable');
    eq(d.lines.find((l) => l.deliverable === 'Essais').target, 'Xavier', 'chaque ligne dit sa ressource ou son équipe');
    eq([d.totals.envelope_changes, d.totals.line_changes, d.totals.cost_delta, d.totals.over], [2, 3, 1200, 1], 'deux enveloppes changées (le projet et WP 1), trois lignes, +1 200 € de coût, un workpackage en dépassement');
  });

  test('Qui la lit : ceux qui voient le budget du projet', () => {
    const w = world();
    w.change();
    ok(w.dec(CP).ok && w.dec(DPL).ok, 'le chef de projet et le DPL');
    eq([w.dec(WPL).error.code, w.dec(MEMBER).error.code], ['FORBIDDEN', 'FORBIDDEN'], 'ni un Workpackage leader, ni un Contributor (ils n’ont pas le budget du projet)');
    const noBase = lot2World();
    eq(noBase.raw(CP, 'baselines.decomposition', { projectId: noBase.p1.id }).data, { baseline: null, decomposition: null, see_budget: false }, 'sans baseline : rien à comparer, sans erreur');
  });

  test('Une baseline figée avant la 0.19.2 n’a pas ces champs : l’écart le dit au lieu d’inventer une valeur', () => {
    const w = world();
    // on retire des instantanés les champs ajoutés par la 0.19.2, comme dans une baseline ancienne
    const real = w.c.loadBaselineSnapshot_;
    w.c.loadBaselineSnapshot_ = (id) => {
      const snap = real(id);
      Object.keys(snap.Project).forEach((k) => { delete snap.Project[k].envelopes_json; });
      Object.keys(snap.WorkPackage).forEach((k) => { delete snap.WorkPackage[k].envelopes_json; });
      Object.keys(snap.PlanItem).forEach((k) => { delete snap.PlanItem[k].exercise_id; });
      return snap;
    };
    w.change();
    const d = w.dec().data.decomposition, wp1 = d.wps.find((r) => r.wp_id === w.w1.id);
    eq([d.project.known, d.project.changed, wp1.known, wp1.base_allocated, wp1.allocated_changed], [false, false, false, null, false], 'budget autorisé et enveloppes : « non figés à l’époque », aucun écart inventé');
    eq([wp1.base_cost, wp1.cost_delta, d.lines.length], [1300, -300, 3], 'les lignes de coût, elles, étaient déjà figées : leur écart est calculé');
  });

  test('Suivre l’évolution d’une baseline à l’autre : deux baselines comparées entre elles', () => {
    const w = world();
    w.change();
    const b1 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Budget revu', label: 'P1_1' });
    const d = w.dec(CP, { baselineId: w.b0.id, compareTo: b1.id }).data;
    eq([d.baseline.label, d.compareTo.label, d.decomposition.totals.cost_delta, d.decomposition.totals.line_changes, d.decomposition.project.authorized], ['P1_0', 'P1_1', 1200, 3, 12000], 'B0 → B1 : ce qui a changé entre les deux baselines');
    eq(w.dec(CP, { baselineId: b1.id }).data.decomposition.totals.cost_delta, 0, 'B1 contre l’état actuel : plus d’écart');
  });

  test('Traçabilité : les changements de la décomposition entrent dans le fil de validation, comme ceux du planning', () => {
    const w = world();
    w.change();
    const fresh = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable neuf', item_type: 'Livrable', planned_start: '2027-02-01', planned_finish: '2027-02-12', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.deliverable.exercise', { deliverableId: fresh.id, exerciseId: w.call('admin@entreprise.com', 'exercise.create', { year: 2027 }).id });
    const feed = w.call(DPL, 'changes.feed', { projectId: w.p1.id });
    const fields = feed.items.map((i) => i.field + ':' + i.table);
    ok(fields.includes('envelopes_json:Project') && fields.includes('envelopes_json:WorkPackage'), 'budget autorisé et enveloppe d’un workpackage : à valider par le niveau du dessus : ' + fields.join(' | '));
    ok(fields.some((f) => /:BudgetLine$/.test(f)), 'les lignes de coût aussi');
    ok(feed.items.some((i) => i.field === 'exercise_id' && i.field_label === 'exercice'), 'et le rattachement d’un livrable à un exercice');
    const env = feed.items.find((i) => i.field === 'envelopes_json' && i.table === 'WorkPackage');
    eq([env.field_label, env.what, /exercice 2026 : 2500 €/.test(env.new_value)], ['enveloppes budgétaires', 'modification', true], 'libellé lisible : l’exercice et le montant');
  });

  test('La décomposition affiche, pour chaque workpackage et livrable, ce qu’elle valait à la baseline', () => {
    const w = world();
    w.change();
    const v = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id }), row = (x) => v.rows.find((r) => r.wp_id === x.id), it = (n) => v.items.find((i) => i.name === n);
    eq([v.baseline.label, v.baseline.number], ['P1_0', 0], 'la baseline de référence');
    eq([row(w.w1).base.allocated, row(w.w1).base.cost, row(w.w2).base.cost, v.totals.base.authorized, v.totals.base.cost], [2000, 1300, 0, 10000, 1300], 'enveloppe et coût figés de chaque workpackage ; budget autorisé et coût total figés du projet');
    const apparu = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable apparu', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-13', wp_id: w.w2.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.deliverable.exercise', { deliverableId: apparu.id, exerciseId: w.exec.id });
    const v2 = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id }), it2 = (n) => v2.items.find((i) => i.name === n);
    eq([it2('Spécification').base.cost, it2('Essais').base.cost, it2('Livrable apparu').base.new], [800, 0, true], 'un livrable : son coût figé (0 s’il n’en avait pas) ; un livrable apparu depuis la baseline : « nouveau »');
    const none = lot2World();
    none.call('admin@entreprise.com', 'exercise.create', { year: 2026 });
    eq(none.call(CP, 'budget.envelope.get', { projectId: none.p1.id }).baseline, undefined, 'sans baseline : pas de colonne d’évolution');
  });
};
