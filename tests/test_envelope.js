const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBudget par workpackage : enveloppe autorisée, répartition, coût mis en regard (0.15.3)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';

  // WP 1 ⊃ 1.1 ; WP 2 ; A (WP 1) 1 000 €, B (1.1) 600 €, C (WP 2) 400 € : 2 000 € de coût prévu
  function world() {
    const w = lot2World();
    const e0 = w.call('admin@entreprise.com', 'exercise.create', { year: 2026 });
    w.exec = w.call('admin@entreprise.com', 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    const line = (item, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: amount }, exerciseId: w.exec.id });
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
    w.call(CP, 'workpackages.update', { id: w.w2.id, patch: { name: 'Essais en vol', budget_allocated: 99999, envelopes_json: '{"x":1}' } });
    w.call(CP, 'projects.update', { id: w.p1.id, patch: { budget_authorized: 99999 } });
    w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { budget_allocated: 77777 } });
    const envOf = (rec) => w.c.envAmount_(rec, w.c.envKey_(w.exec));
    eq([envOf(w.c.repoGet('WorkPackage', w.w2.id)), envOf(w.c.repoGet('Project', w.p1.id)), w.c.repoGet('WorkPackage', w.w2.id).name], [500, 4000, 'Essais en vol'], 'les champs d’enveloppe écrits par une mise à jour ordinaire sont ignorés, le reste passe');
    const created = w.call(CP, 'workpackages.create', { values: { project_id: w.p1.id, name: 'Nouveau', budget_allocated: 5000 } });
    eq(w.c.repoGet('WorkPackage', created.id).budget_allocated || w.c.repoGet('WorkPackage', created.id).envelopes_json || '', '', 'même à la création');
  });

  test('Chaque modification d’enveloppe est un changement à valider par le niveau du dessus', () => {
    const w = world();
    w.set(CP, { authorized: 3000, allocations: [{ wpId: w.w1.id, amount: 2000 }] });                 // niveau 2 (chef de projet)
    w.set(WPL, { allocations: [{ wpId: w.w11.id, amount: 900 }] });                                   // niveau 3 (Workpackage leader)
    const feed = (who) => w.call(who, 'changes.feed', { projectId: w.p1.id });
    const labels = (f) => f.items.map((e) => e.entity + ' | ' + e.field_label + ' | ' + e.old_value + ' → ' + e.new_value).sort();
    ok(labels(feed(CP)).some((l) => /^WP 1\.1 Calcul \| enveloppes budgétaires \| .* → exercice 2026 : 900 €$/.test(l)), 'le chef de projet valide l’enveloppe posée par le Workpackage leader : ' + labels(feed(CP)).join(' ; '));
    ok(!labels(feed(CP)).some((l) => /budget autorisé/.test(l)), 'mais pas la sienne');
    ok(labels(feed(DPL)).some((l) => /^Projet \| enveloppes budgétaires \| .* → exercice 2026 : 3000 €$/.test(l)) && labels(feed(DPL)).some((l) => /^WP 1 Conception \| enveloppes budgétaires/.test(l)), 'le DPL valide celles du chef de projet : ' + labels(feed(DPL)).join(' ; '));
    eq(feed(CP).mine.map((e) => e.field_label).filter((l) => /budget autorisé|enveloppe/.test(l)).sort(), ['enveloppes budgétaires', 'enveloppes budgétaires'], 'et le chef de projet les voit « en attente » chez le DPL');
  });

  test('ÉTANCHÉITÉ : l’enveloppe, les livrables et les coûts d’un exercice ne se mêlent pas à ceux d’un autre', () => {
    const w = world(), ADMIN = 'admin@entreprise.com';
    const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    // un livrable de l'exercice 2027, avec son coût ; les trois de 2026 (A 1 000, B 600, C 400) restent dans l'exercice en exécution
    const next = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable 2027', item_type: 'Livrable', planned_start: '2027-03-01', planned_finish: '2027-03-12', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: next.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 300 }, exerciseId: prep.id });
    const e26 = w.env(), e27 = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: prep.id });
    eq([e26.exercise.year, e27.exercise.year], [2026, 2027], 'sans exercice demandé : celui en exécution ; sinon celui demandé');
    eq([e26.totals.cost, e27.totals.cost], [2000, 300], 'le coût de chaque exercice : 2 000 € de livrables 2026, 300 € pour 2027, rien de l’un dans l’autre');
    ok(e26.items.every((x) => x.name !== 'Livrable 2027') && e27.items.every((x) => x.type !== 'Livrable' || x.name === 'Livrable 2027'), 'les livrables de 2027 ne sont pas dans la décomposition de 2026 et réciproquement');
    eq([w.row(e26, w.w1).cost, w.row(e27, w.w1).cost], [1600, 300], 'le coût d’un workpackage ne compte que les livrables de son exercice');
    // l'enveloppe est PAR exercice : fixer l'une ne touche pas l'autre
    ok(w.set(CP, { authorized: 5000, allocations: [{ wpId: w.w1.id, amount: 2000 }] }).ok, 'enveloppe 2026');
    ok(w.set(CP, { exerciseId: prep.id, authorized: 9000, allocations: [{ wpId: w.w1.id, amount: 800 }] }).ok, 'enveloppe 2027');
    const a26 = w.env(), a27 = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: prep.id });
    eq([a26.totals.authorized, a27.totals.authorized, w.row(a26, w.w1).allocated, w.row(a27, w.w1).allocated], [5000, 9000, 2000, 800], 'chaque exercice a son budget autorisé et son enveloppe de workpackage');
    eq([w.row(a26, w.w1).over, w.row(a27, w.w1).over], [false, false], 'les états sont propres à l’exercice (1 600 € dans 2 000 € ; 300 € dans 800 €)');
    w.set(CP, { exerciseId: prep.id, allocations: [{ wpId: w.w1.id, amount: 100 }] });
    eq([w.row(w.env(), w.w1).allocated, w.row(w.env(), w.w1).over, w.row(w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: prep.id }), w.w1).over], [2000, false, true], 'réduire l’enveloppe 2027 met 2027 en dépassement, et laisse 2026 comme elle était');
    // un livrable sans exercice ne compte dans aucun : il est proposé au rattachement
    const orphan = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Sans exercice', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-06', wp_id: w.w2.id, owner_resource_id: w.mia.id } });
    const v = w.env();
    eq([v.totals.cost, v.items.some((x) => x.id === orphan.id), v.unassigned.some((x) => x.id === orphan.id)], [2000, false, true], 'le livrable sans exercice : hors décomposition, hors coût, proposé au rattachement');
    // un exercice clos ne se modifie plus
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    eq(w.set(CP, { exerciseId: w.exec.id, authorized: 1 }).error.code, 'VALIDATION', 'enveloppe d’un exercice clos : refusée');
    eq(w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: w.exec.id }).can_edit, false, 'et signalée en lecture seule');
  });

  test('Bilan par CPN et achats : ceux de l’exercice demandé seulement (année de la commande, livrables de l’exercice)', () => {
    const w = world(), ADMIN = 'admin@entreprise.com';
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'Nacelle' });
    const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    const next = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable 2027', item_type: 'Livrable', planned_start: '2027-03-01', planned_finish: '2027-03-12', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: next.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 300 }, exerciseId: prep.id });
    const po = (n, amount, launched) => w.call(CP, 'po.save', { values: { po_number: n, cpn: 'CPN-100', resource_id: w.xavier.id, amount, status: 'Lancée', launched_on: launched, gr_due_date: launched.slice(0, 4) + '-12-01' } });
    po('CB-26', 700, '2026-03-10'); po('CB-27', 900, '2027-02-10');
    const bal = (ex) => w.call(CP, 'budget.balance', { projectId: w.p1.id, exerciseId: ex.id });
    const b26 = bal(w.exec), b27 = bal(prep);
    eq([b26.totals.budget.external, b27.totals.budget.external], [2000, 300], 'le budget externe de chaque exercice : celui de ses livrables');
    eq([b26.totals.po.committed, b27.totals.po.committed], [700, 900], 'les engagements : les commandes lancées dans l’année de l’exercice');
    const list = (ex) => w.call(CP, 'po.list', { projectId: w.p1.id, exerciseId: ex.id }).orders.map((o) => o.po_number);
    eq([list(w.exec), list(prep)], [['CB-26'], ['CB-27']], 'la liste des achats : les commandes de l’année');
    eq(w.call(CP, 'po.list', { projectId: w.p1.id }).orders.length, 2, 'sans exercice : toutes (compatibilité)');
  });

  test('Prévisionnel par mois et par workpackage, projection de fin d’année à l’avancement', () => {
    const w = world();
    const v = w.env(), m = v.monthly;
    eq([m.year, m.months.length, m.months[0], m.months[11], m.current_month], [2026, 12, '2026-01', '2026-12', 10], 'les douze mois de l’exercice, au mois d’octobre');
    const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
    eq([sum(m.total), m.cumulative[11], sum(m.series.map((x) => x.total)) ], [2000, 2000, 2000], 'le prévu de l’année : 2 000 € ; la somme des workpackages, le total par mois et le cumul concordent');
    eq(m.series.map((x) => x.code + ':' + x.total), ['1:1600', '2:400'], 'une série par workpackage de premier niveau (les sous-workpackages comptent dans leur parent)');
    const pj = v.projection;
    eq([pj.plan_year, pj.ev, pj.projected, pj.over], [2000, 0, 2000, false], 'aucun avancement, tout dans l’année : la projection est le prévu');
    // un livrable à cheval sur deux années, à 0 % : seule la part qui tient d'ici fin d'année est projetée
    const long = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Long', item_type: 'Livrable', planned_start: '2026-12-01', planned_finish: '2027-02-26', wp_id: w.w2.id, owner_resource_id: w.mia.id } });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: long.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 3000 }, exerciseId: w.exec.id });
    const v2 = w.env();
    eq(v2.projection.projected, 2000 + 1812.5, 'à 0 % : 3 000 € × 87 jours restants d’ici fin d’année / 144 jours jusqu’à sa fin = 1 812,50 €');
    ok(v2.monthly.series.find((x) => x.code === '2').outside > 0, 'et la part de son prévu qui tombe en 2027 est comptée à part, hors du graphique de l’année');
    // l'avancement change la projection : Spécification terminé (800 déjà acquis, rien à faire)
    w.call(CP, 'progress.declare', { planItemId: w.a.id, progressPct: 100 });
    w.call(CP, 'progress.declare', { planItemId: w.b.id, progressPct: 50 });
    const v3 = w.env();
    eq([v3.projection.ev, v3.projection.projected], [1000 + 300, 1000 + 600 + 400 + 1812.5], 'valeur acquise : 1 000 (fini) + 300 (moitié de 600) ; projection : l’acquis + le reste à faire d’ici fin d’année');
    // budget de référence et écart : le budget autorisé de l'exercice
    w.set(CP, { authorized: 6000, allocations: [{ wpId: w.w1.id, amount: 1800 }, { wpId: w.w2.id, amount: 5000 }] });
    const v4 = w.env();
    eq([v4.projection.budget, v4.projection.gap, v4.projection.over], [6000, 6000 - 3812.5, false], 'écart à la projection : budget autorisé − projeté');
    const bw = v4.projection.by_wp.find((x) => x.code === '1'), bw2 = v4.projection.by_wp.find((x) => x.code === '2');
    eq([bw.allocated, bw.projected, bw.over, bw2.projected], [1800, 1600, false, 2212.5], 'par workpackage : projection, enveloppe, état');
    ok(v4.monthly.budget === 6000 && Array.isArray(v4.monthly.committed), 'le graphique a son budget de référence et l’engagé du projet');
  });

  test('Les valeurs d’avant (enveloppes saisies avant qu’elles soient par exercice) sont proposées, jamais comptées', () => {
    const w = world();
    w.c.repoUpdate('Project', w.p1.id, { budget_authorized: 7000 }, null, w.S);
    w.c.repoUpdate('WorkPackage', w.w1.id, { budget_allocated: 2500 }, null, w.S);
    let v = w.env();
    eq([v.legacy.authorized, v.legacy.by_wp[w.w1.id], v.legacy.by_wp[w.w2.id]], [7000, 2500, undefined], 'les anciennes valeurs sont rendues à la page, là où l’exercice n’a pas de valeur à lui');
    eq([v.totals.authorized, w.row(v, w.w1).allocated], [null, null], 'mais elles ne comptent dans aucun calcul : l’exercice n’a pas de budget tant qu’on ne les adopte pas');
    w.set(CP, { allocations: [{ wpId: w.w1.id, amount: 3000 }] });
    v = w.env();
    eq([v.legacy.by_wp[w.w1.id], v.legacy.authorized], [undefined, 7000], 'dès que l’exercice a sa valeur, l’ancienne n’est plus proposée pour ce workpackage (le budget autorisé reste proposé : il n’a pas été saisi)');
    const prep = w.call('admin@entreprise.com', 'exercise.create', { year: 2027 });
    const o = w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: prep.id });
    eq([o.legacy.authorized, o.legacy.by_wp[w.w1.id], w.row(o, w.w1).allocated], [7000, 2500, null], 'l’autre exercice se voit proposer les mêmes valeurs d’avant, sans rien en commun avec 2026');
    eq(w.row(w.call(CP, 'budget.envelope.get', { projectId: w.p1.id, exerciseId: w.exec.id }), w.w1).allocated, 3000, 'et 2026 garde la sienne');
  });
};
