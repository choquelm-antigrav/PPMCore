const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nPlan budgétaire : un seul tableau livrable × équipe, dotation par équipe, tout le reste en découle (0.21.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** P1 : WP 1 (Spécification) ⊃ WP 1.1 (Calcul), WP 2 (Essais). Équipes 1vm, 2ae. Exercice 2027 en préparation. */
  function world() {
    const w = lot2World();
    w.vm = w.call(CP, 'teams.create', { values: { name: '1vm' } }); w.ae = w.call(CP, 'teams.create', { values: { name: '2ae' } });
    w.ex = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.cell = (who, item, team, amount) => w.raw(who || CP, 'budget.cell.set', { deliverableId: item.id, teamId: team.id, amount, exerciseId: w.ex.id });
    w.dot = (team, amount, who) => w.raw(who || CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.ex.id, teamId: team.id, amount });
    w.plan = (who, p) => w.raw(who || CP, 'budget.plan.get', Object.assign({ projectId: w.p1.id, exerciseId: w.ex.id }, p || {}));
    return w;
  }
  const dels = (v) => v.rows.filter((r) => r.kind === 'deliverable');
  const wps = (v) => v.rows.filter((r) => r.kind === 'wp');

  test('Un tableau : une ligne par livrable, une colonne par équipe, les workpackages additionnent leurs livrables et leurs sous-workpackages', () => {
    const w = world();
    ok(w.cell(CP, w.a, w.vm, 40000).ok && w.cell(CP, w.b, w.ae, 30000).ok && w.cell(CP, w.b, w.vm, 5000).ok, 'trois cellules');
    ok(w.raw(CP, 'budget.line.save', { values: { deliverable_id: w.b.id, resource_id: w.xavier.id, fixed_amount: 4000 }, exerciseId: w.ex.id }).ok, 'un forfait externe');
    const v = w.plan().data;
    eq(v.columns.map((c) => c.name), ['1vm', '2ae'], 'une colonne par équipe qui a une part');
    eq(v.rows.map((r) => r.kind + ':' + (r.code || r.name)), ['wp:1', 'deliverable:Spécification', 'wp:1.1', 'deliverable:Calcul', 'wp:2'], 'l’arbre du WBS, les livrables sous leur workpackage');
    const wp1 = wps(v)[0], wp11 = wps(v)[1], calc = dels(v).find((r) => r.name === 'Calcul');
    eq([calc.cells[w.ae.id], calc.cells[w.vm.id], calc.external, calc.total], [30000, 5000, 4000, 39000], 'une ligne de livrable : ses cellules, son externe, son total');
    eq([wp11.total, wp1.total, wp1.cells[w.vm.id], wp1.external], [39000, 79000, 45000, 4000], 'un workpackage additionne ses livrables ET ses sous-workpackages');
    eq([v.totals.total, v.totals.external, v.totals.cells[w.vm.id], v.totals.cells[w.ae.id]], [79000, 4000, 45000, 30000], 'le total du projet');
    eq(dels(v).map((r) => r.depth), [1, 2], 'la profondeur sert à l’indentation');
    ok(!JSON.stringify(v).match(/frozen_rate|phasing|envelope|authorized/), 'ni taux, ni étalement, ni enveloppe : un montant par cellule');
  });

  test('La dotation est saisie par équipe ; le tableau par équipe rapproche dotation et plan ; la page sait ce qu’on peut modifier', () => {
    const w = world();
    w.dot(w.vm, 100000); w.cell(CP, w.a, w.vm, 40000); w.cell(CP, w.b, w.ae, 30000);
    const v = w.plan().data, r = (n) => v.summary.rows.find((x) => x.name === n);
    eq([r('1vm').dotation, r('1vm').parts, r('1vm').gap, r('2ae').dotation, r('2ae').clash], [100000, 40000, 60000, null, false], 'dotation, plan et écart par équipe ; une équipe sans dotation n’a pas de clash');
    eq([v.can_set_dotation, v.can_edit, w.plan(WPL).data.can_set_dotation], [true, true, false], 'seul le chef de projet (et au-dessus) fixe la dotation');
    eq(dels(w.plan(WPL).data).map((d) => d.can_edit), [true, true].slice(0, dels(w.plan(WPL).data).length), 'le Workpackage leader modifie les cellules de son périmètre');
    eq(w.plan(MEMBER).error.code, 'FORBIDDEN', 'un membre ne lit pas le plan');
    w.dot(w.vm, 100000); w.dot(w.ae, 10000);
    const c = w.plan().data.summary;
    eq([c.rows.find((x) => x.name === '1vm').clash, c.rows.find((x) => x.name === '2ae').clash, c.totals.clash], [false, true, false], '2ae : 30 000 de plan pour 10 000 de dotation (clash par équipe) ; le total ne le masque pas');
  });

  test('Cellules : un montant vide retire la part ; le livrable prend l’exercice de sa première cellule ; un exercice clos est en lecture seule', () => {
    const w = world();
    w.cell(CP, w.a, w.vm, 1000);
    eq(w.c.repoGet('PlanItem', w.a.id).exercise_id, w.ex.id, 'rattaché à l’exercice');
    w.cell(CP, w.a, w.vm, 2500);
    eq(w.c.repoList('BudgetLine').map((l) => l.planned_amount), [2500], 'une seule part par livrable et par équipe');
    w.cell(CP, w.a, w.vm, '');
    eq(w.c.repoList('BudgetLine').filter((l) => !w.c.isTrue(l.deleted)).length, 0, 'vidée : la part disparaît');
    w.cell(CP, w.a, w.vm, 700);
    w.call(ADMIN, 'exercise.setStatus', { id: w.ex.id, status: 'Exécution' }); w.call(ADMIN, 'exercise.setStatus', { id: w.ex.id, status: 'Clos' });
    const v = w.plan().data;
    eq([v.can_edit, dels(v).every((d) => d.can_edit === false), v.can_set_dotation], [false, true, false], 'clos : ni cellule ni dotation');
    ok(/clos/.test(w.cell(CP, w.a, w.vm, 5).error.message) && /clos/.test(w.dot(w.vm, 5).error.message), 'et les écritures sont refusées');
  });

  test('Un livrable sans workpackage a sa ligne à part ; les livrables sans exercice sont proposés', () => {
    const w = world();
    const orphan = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Orphelin', item_type: 'Livrable', planned_start: '2026-10-12', planned_finish: '2026-10-20', owner_resource_id: w.carla.id } });
    w.cell(CP, orphan, w.vm, 800);
    const v = w.plan().data;
    eq(wps(v).map((r) => r.name).pop(), 'Sans workpackage', 'regroupés sous « Sans workpackage »');
    eq(wps(v).pop().total, 800);
    const none = w.plan(CP, { exerciseId: w.ex.id }).data;
    ok(none.unassigned.some((d) => d.name === 'Calcul') && !none.unassigned.some((d) => d.id === orphan.id), 'les livrables sans exercice, pour être rattachés');
  });

  test('Les changements de cellule et de dotation passent par le fil de validation du niveau du dessus', () => {
    const w = world();
    ok(w.cell(WPL, w.a, w.vm, 1200).ok, 'le Workpackage leader saisit une cellule de son WP');
    const feed = w.call(CP, 'changes.feed', { projectId: w.p1.id, all: true });
    ok(feed.items.some((i) => i.table === 'BudgetLine'), 'le chef de projet voit la ligne de budget à valider : ' + feed.items.map((i) => i.table).join(','));
    w.dot(w.vm, 9000);
    const dpl = w.call('dora@entreprise.com', 'changes.feed', { projectId: w.p1.id, all: true });
    ok(dpl.items.some((i) => i.table === 'TeamBudget' && i.entity === 'Dotation de 1vm' && i.validator === 'Domain Program Leader'), 'la dotation posée par le chef de projet est tracée (« Dotation de 1vm ») et validée par le niveau du dessus');
  });
};
