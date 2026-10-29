const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBudget par workpackage : enveloppe autorisée, répartition, coût mis en regard (0.15.3)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';

  // WP 1 ⊃ 1.1 ; WP 2 ; A (WP 1) 1 000 €, B (1.1) 600 €, C (WP 2) 400 € : 2 000 € de coût prévu
  function world() {
    const w = lot2World();
    const line = (item, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: amount } });
    line(w.a, 1000); line(w.b, 600); line(w.cc, 400);
    w.env = (who) => w.call(who || CP, 'budget.envelope.get', { projectId: w.p1.id });
    w.set = (who, params) => w.raw(who || CP, 'budget.envelope.set', Object.assign({ projectId: w.p1.id }, params));
    w.row = (view, wp) => view.rows.find((r) => r.wp_id === wp.id);
    return w;
  }

  test('Lecture : l’arbre des workpackages, le coût de chacun (sous-workpackages compris), rien de fixé au départ', () => {
    const w = world(), v = w.env();
    eq(v.rows.map((r) => r.code + ':' + r.depth), ['1:0', '1.1:1', '2:0'], 'arbre dans l’ordre du WBS');
    eq(v.rows.map((r) => r.cost), [1600, 600, 400], 'le coût d’un workpackage comprend ses sous-workpackages');
    eq([v.totals.cost, v.totals.authorized, v.totals.reserve, v.totals.over], [2000, null, null, false], 'rien n’est fixé : pas de plafond, pas de réserve');
    ok(v.rows.every((r) => r.allocated === null && r.remaining === null && !r.over), 'une enveloppe vide n’est pas zéro : pas de reste, pas de dépassement');
    ok(v.canSetProject && !v.partial, 'le chef de projet voit tout et peut fixer');
  });

  test('Répartition : le chef de projet fixe l’enveloppe et la répartit ; un dépassement par les lignes de budget est signalé, pas refusé', () => {
    const w = world();
    const r = w.set(CP, { authorized: 3000, allocations: [{ wpId: w.w1.id, amount: 2000 }, { wpId: w.w2.id, amount: 300 }] });
    ok(r.ok, JSON.stringify(r.error));
    const v = r.data;
    eq([v.totals.authorized, v.totals.reserve, v.totals.remaining, v.changed], [3000, 700, 1000, 3], 'budget autorisé 3 000, réparti 2 300, réserve 700, reste 1 000 sur le coût prévu');
    eq([w.row(v, w.w1).remaining, w.row(v, w.w1).over], [400, false]);
    eq([w.row(v, w.w2).remaining, w.row(v, w.w2).over], [-100, true], 'WP 2 : 400 € de coût pour 300 € d’enveloppe : « dépassé »');
    const lineC = w.c.repoList('BudgetLine').find((l) => l.deliverable_id === w.cc.id);
    eq(w.call(CP, 'budget.line.save', { id: lineC.id, values: { fixed_amount: 900 } }).planned_amount, 900, 'la saisie d’une ligne qui dépasse l’enveloppe n’est pas bloquée');
    eq(w.env().totals.over, false, 'le projet tient encore : 2 900 € pour 3 000 €');
    const again = w.set(CP, { authorized: 3000 });
    eq(again.data.changed, 0, 'enregistrer la même valeur ne change rien');
    eq(w.set(CP, { authorized: '' }).data.totals.authorized, null, 'vide : plus de plafond');
  });

  test('Dépassements permis : écrire des enveloppes au-delà de la somme autorisée est accepté et signalé « en dépassement » ; seule règle : pas d’enveloppe de sous-workpackage sans celle de son parent', () => {
    const w = world();
    ok(w.set(CP, { authorized: 3000, allocations: [{ wpId: w.w1.id, amount: 2000 }] }).ok);
    let r = w.set(CP, { allocations: [{ wpId: w.w2.id, amount: 1500 }] });                           // 3 500 € répartis pour 3 000 € autorisés
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.totals.allocated, r.data.totals.over, r.data.totals.over_alloc, r.data.totals.over_cost, r.data.totals.over_by], [3500, true, true, false, 500], 'les workpackages dépassent le budget autorisé : accepté, « en dépassement » de 500 €');
    r = w.set(CP, { allocations: [{ wpId: w.w11.id, amount: 2500 }] });                              // le sous-workpackage dépasse son parent (2 000 €)
    ok(r.ok, JSON.stringify(r.error));
    const row1 = w.row(r.data, w.w1);
    eq([row1.over, row1.over_alloc, row1.over_cost, row1.over_by], [true, true, false, 500], 'un sous-workpackage au-delà de son parent : accepté ; le parent est « en dépassement » de 500 €');
    ok(w.set(CP, { authorized: 1500 }).ok && w.set(CP, { allocations: [{ wpId: w.w1.id, amount: 400 }, { wpId: w.w11.id, amount: 500 }] }).ok, 'baisser le budget autorisé ou le parent sous ce qui est réparti : accepté aussi');
    const v = w.env();
    eq([w.row(v, w.w1).over, w.row(v, w.w1).over_by, v.totals.over], [true, 1200, true], 'le coût prévu de 1 600 € dépasse l’enveloppe de 400 € : 1 200 €');
    ok(!w.row(w.env(), w.w2).over || w.row(w.env(), w.w2).over_cost === false, 'un workpackage dans son enveloppe n’est pas en dépassement par erreur');
    // la seule règle qui reste
    const fresh = world();
    const e = fresh.set(CP, { allocations: [{ wpId: fresh.w11.id, amount: 100 }] }).error;
    eq(e.details.rule, 'ENVELOPE_PARENT_EMPTY', 'pas d’enveloppe pour un sous-workpackage dont le parent n’en a pas');
    ok(fresh.set(CP, { allocations: [{ wpId: fresh.w1.id, amount: 1000 }, { wpId: fresh.w11.id, amount: 1000 }] }).ok, 'les deux dans le même envoi : parent d’abord, c’est l’état final qui compte');
    eq([fresh.set(CP, { authorized: -5 }).error.code, fresh.set(CP, { authorized: 'abc' }).error.code, fresh.set(CP, {}).error.code, fresh.set(CP, { allocations: [{ wpId: 'inconnu', amount: 1 }] }).error.code], ['VALIDATION', 'VALIDATION', 'VALIDATION', 'NOT_FOUND']);
    eq(fresh.set(CP, { authorized: '1 500,5' }).error.code, 'VALIDATION', 'un montant avec des espaces est refusé plutôt que deviné');
    eq(fresh.set(CP, { authorized: '2500,5' }).data.totals.authorized, 2500.5, 'la virgule décimale est comprise');
  });

  test('Décomposition du budget : les livrables et jalons sont sous leur workpackage, le coût d’un livrable est celui de ses lignes, un jalon n’a pas de coût', () => {
    const w = world();
    w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Revue de décomposition', item_type: 'Jalon', planned_start: '2026-11-02', planned_finish: '2026-11-02', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    const v = w.env(), it = (n) => v.items.find((x) => x.name === n);
    ok(Array.isArray(v.items) && v.items.length >= 4, 'la vue contient les livrables et les jalons : ' + v.items.map((x) => x.name).join(', '));
    eq([it('Spécification').type, it('Spécification').wp_id === w.w1.id, it('Spécification').cost, it('Spécification').lines, it('Spécification').canEdit], ['Livrable', true, 1000, 1, true], 'un livrable : son workpackage, le coût de ses lignes, le nombre de lignes, modifiable par un responsable de budget');
    eq([it('Calcul').wp_id === w.w11.id, it('Calcul').cost], [true, 600], 'sous le sous-workpackage qui le contient');
    const m = it('Revue de décomposition');
    eq([m.type, m.cost, m.lines, m.canEdit], ['Jalon', null, null, false], 'un jalon : pas de coût, pas de ligne, pas de bouton de coût');
    const wpl = w.env(WPL);
    ok(wpl.items.every((x) => !x.wp_id || wpl.rows.some((r) => r.wp_id === x.wp_id)), 'un Workpackage leader ne voit que les éléments de ses workpackages');
    // le filtre par livrable de budget.get : toutes les lignes d'un livrable, quel que soit l'exercice
    const g = w.call(CP, 'budget.get', { projectId: w.p1.id, deliverableId: w.a.id });
    eq([g.lines.length, g.lines[0].deliverable_id === w.a.id, g.deliverables.length], [1, true, 1], 'budget.get avec deliverableId : un seul livrable et ses lignes');
  });

  test('Qui fixe quoi : le projet et les workpackages par le chef de projet, un sous-workpackage par son Workpackage leader ; chacun ne voit que son budget', () => {
    const w = world();
    w.set(CP, { authorized: 3000, allocations: [{ wpId: w.w1.id, amount: 2000 }] });
    eq(w.set(WPL, { authorized: 5000 }).error.code, 'FORBIDDEN', 'un Workpackage leader ne fixe pas l’enveloppe du projet');
    eq(w.set(WPL, { allocations: [{ wpId: w.w1.id, amount: 2500 }] }).error.code, 'FORBIDDEN', 'ni la sienne : elle lui est donnée par le niveau du dessus');
    eq(w.set(WPL, { allocations: [{ wpId: w.w2.id, amount: 100 }] }).error.code, 'FORBIDDEN', 'ni celle d’un workpackage qui n’est pas le sien');
    const ok1 = w.set(WPL, { allocations: [{ wpId: w.w11.id, amount: 900 }] });
    ok(ok1.ok, JSON.stringify(ok1.error));
    const v = ok1.data;
    eq([v.partial, v.totals, v.rows.map((r) => r.code)], [true, undefined, ['1', '1.1']], 'le Workpackage leader répartit la sienne entre ses sous-workpackages ; il ne voit que son workpackage : ni le projet, ni la réserve, ni WP 2');
    eq(v.rows.map((r) => r.canSet), [false, true], 'et sait ce qu’il peut modifier');
    eq([v.rows[1].parent_id, v.rows[0].unallocated], [w.w1.id, 1100], 'le sous-workpackage est rattaché à son parent ; reste à répartir : 1 100 €');
  });

  test('Accès : sans responsabilité de budget, rien ; le DPL fixe tout ; les écritures génériques ne touchent pas aux enveloppes', () => {
    const w = world();
    eq(w.raw(MEMBER, 'budget.envelope.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'un Contributor ne voit pas le budget');
    eq(w.raw(MEMBER, 'budget.envelope.set', { projectId: w.p1.id, authorized: 10 }).error.code, 'FORBIDDEN');
    ok(w.set(DPL, { authorized: 4000, allocations: [{ wpId: w.w2.id, amount: 500 }] }).ok, 'le DPL fixe aussi');
    w.call(CP, 'workpackages.update', { id: w.w2.id, patch: { name: 'Essais en vol', budget_allocated: 99999 } });
    w.call(CP, 'projects.update', { id: w.p1.id, patch: { budget_authorized: 99999 } });
    w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { budget_allocated: 77777 } });
    eq([w.c.repoGet('WorkPackage', w.w2.id).budget_allocated, w.c.repoGet('Project', w.p1.id).budget_authorized, w.c.repoGet('WorkPackage', w.w2.id).name], [500, 4000, 'Essais en vol'], 'les champs d’enveloppe écrits par une mise à jour ordinaire sont ignorés, le reste passe');
    const created = w.call(CP, 'workpackages.create', { values: { project_id: w.p1.id, name: 'Nouveau', budget_allocated: 5000 } });
    eq(w.c.repoGet('WorkPackage', created.id).budget_allocated || '', '', 'même à la création');
  });

  test('Chaque modification d’enveloppe est un changement à valider par le niveau du dessus', () => {
    const w = world();
    w.set(CP, { authorized: 3000, allocations: [{ wpId: w.w1.id, amount: 2000 }] });                 // niveau 2 (chef de projet)
    w.set(WPL, { allocations: [{ wpId: w.w11.id, amount: 900 }] });                                   // niveau 3 (Workpackage leader)
    const feed = (who) => w.call(who, 'changes.feed', { projectId: w.p1.id });
    const labels = (f) => f.items.map((e) => e.entity + ' | ' + e.field_label + ' | ' + e.old_value + ' → ' + e.new_value).sort();
    ok(labels(feed(CP)).some((l) => /^WP 1\.1 Calcul \| enveloppe budgétaire \| .* → 900$/.test(l)), 'le chef de projet valide l’enveloppe posée par le Workpackage leader : ' + labels(feed(CP)).join(' ; '));
    ok(!labels(feed(CP)).some((l) => /budget autorisé/.test(l)), 'mais pas la sienne');
    ok(labels(feed(DPL)).some((l) => /^Projet \| budget autorisé \| .* → 3000$/.test(l)) && labels(feed(DPL)).some((l) => /^WP 1 Conception \| enveloppe budgétaire/.test(l)), 'le DPL valide celles du chef de projet : ' + labels(feed(DPL)).join(' ; '));
    eq(feed(CP).mine.map((e) => e.field_label).filter((l) => /budget autorisé|enveloppe/.test(l)).sort(), ['budget autorisé', 'enveloppe budgétaire'], 'et le chef de projet les voit « en attente » chez le DPL');
  });
};
