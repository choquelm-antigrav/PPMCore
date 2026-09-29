const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBaselines, écarts et fil des changements (lot 2)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';

  test('Demande par un membre, gel par le chef de projet : B0 active, copie figée complète', () => {
    const w = lot2World();
    const req = w.call(MEMBER, 'baselines.request', { projectId: w.p1.id, justification: 'Planning validé en revue de lancement' });
    eq(req.status, 'Demandée');
    ok(w.c.SENT_MAILS.some((m) => m.to === CP && /rebaselining/.test(m.subject)), 'le chef de projet est prévenu');
    eq(w.raw(MEMBER, 'baselines.create', { projectId: w.p1.id, requestId: req.id }).error.code, 'FORBIDDEN');
    eq(w.raw(RWP, 'baselines.create', { projectId: w.p1.id, requestId: req.id }).error.code, 'FORBIDDEN');
    const b0 = w.call(CP, 'baselines.create', { projectId: w.p1.id, requestId: req.id });
    eq([b0.id, b0.number, b0.label, b0.status, b0.justification, b0.requested_by, b0.decided_by, b0.items],
      [req.id, 0, 'B0', 'Active', 'Planning validé en revue de lancement', MEMBER, CP, 4]);
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, b0.id);
    const rows = w.c.repoList('BaselineItem', (r) => r.baseline_id === b0.id);
    const byType = {};
    rows.forEach((r) => { byType[r.entity_type] = (byType[r.entity_type] || 0) + 1; });
    eq(byType, { Project: 1, WorkPackage: 3, PlanItem: 4, Dependency: 3 });
    const snapB = JSON.parse(rows.find((r) => r.entity_id === w.b.id).snapshot_json);
    eq([snapB.planned_start, snapB.planned_finish, snapB.owner_resource_id], ['2026-10-12', '2026-10-23', w.remi.id]);
    const list = w.call(CP, 'baselines.list', { projectId: w.p1.id });
    eq([list.canManage, list.canRequest, list.canAck, list.baselines.length, list.baselines[0].items], [true, true, true, 1, 4]);
    const asMember = w.call(MEMBER, 'baselines.list', { projectId: w.p1.id });
    eq([asMember.canManage, asMember.canRequest, asMember.canAck], [false, true, false]);
    ok(w.call(DPL, 'baselines.list', { projectId: w.p1.id }).canManage, 'le DPL peut aussi figer');
  });

  test('Gel refusé : sans justification, projet vide, demande déjà traitée', () => {
    const w = lot2World();
    eq(w.raw(CP, 'baselines.create', { projectId: w.p1.id, justification: '  ' }).error.code, 'VALIDATION');
    const empty = w.raw('admin@entreprise.com', 'baselines.create', { projectId: w.p2.id, justification: 'x' });
    eq(empty.error.code, 'VALIDATION');
    ok(/Rien à figer/.test(empty.error.message));
    const req = w.call(MEMBER, 'baselines.request', { projectId: w.p1.id, justification: 'a' });
    w.call(CP, 'baselines.create', { projectId: w.p1.id, requestId: req.id });
    eq(w.raw(CP, 'baselines.create', { projectId: w.p1.id, requestId: req.id }).error.code, 'VALIDATION');
  });

  test('Écarts : glissement en jours ouvrés, ajouts, retraits, changement de responsable', () => {
    const w = lot2World();
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    const B = w.c.repoGet('PlanItem', w.b.id);
    w.call(RWP, 'planitems.update', { id: w.b.id, version: B.version, patch: { planned_finish: '2026-10-28' } });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { owner_resource_id: w.remi.id } });
    w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Rapport', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-06' } });
    w.call(CP, 'planitems.delete', { id: w.a.id });
    const d = w.call(CP, 'baselines.diff', { projectId: w.p1.id });
    eq([d.totals.slipped, d.totals.max_slip, d.totals.added, d.totals.removed, d.totals.owner_changes, d.totals.end_slip],
      [1, 3, 1, 1, 1, 0]);
    const by = (n) => d.items.find((i) => i.name === n);
    eq([by('Calcul').state, by('Calcul').base_finish, by('Calcul').finish, by('Calcul').slip], ['changed', '2026-10-23', '2026-10-28', 3]);
    eq([by('Essais').state, by('Essais').base_owner_name, by('Essais').owner_name, by('Essais').slip], ['changed', 'Carla', 'Rémi', 0]);
    eq([by('Rapport').state, by('Spécification').state, by('Revue').state], ['added', 'removed', 'same']);
    eq(d.items[0].name, 'Calcul', 'les éléments modifiés viennent en tête, du plus gros glissement au plus petit');
    eq([d.baseline.label, d.compareTo], ['B0', null]);
  });

  test('Écarts de budget visibles seulement par ceux qui gèrent le budget', () => {
    const w = lot2World();
    const line = w.c.repoInsert('BudgetLine', { deliverable_id: w.cc.id, resource_id: w.carla.id, cost_type: 'Forfait', fixed_amount: 1000 }, w.S);
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.c.repoUpdate('BudgetLine', line.id, { fixed_amount: 1500 }, null, w.S);
    const cp = w.call(CP, 'baselines.diff', { projectId: w.p1.id });
    eq([cp.seeBudget, cp.totals.budget_base, cp.totals.budget, cp.totals.budget_delta], [true, 1000, 1500, 500]);
    eq(cp.items.find((i) => i.name === 'Essais').budget_delta, 500);
    const member = w.call(MEMBER, 'baselines.diff', { projectId: w.p1.id });
    eq(member.seeBudget, false);
    ok(!('budget_delta' in member.totals) && !('budget' in member.items[0]), 'aucun montant pour un simple membre');
  });

  test('B1 archive B0 ; comparer deux baselines ; réactiver avec un motif', () => {
    const w = lot2World();
    const b0 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
    const b1 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Replanification après revue', label: 'B1 (revue)' });
    eq([b1.number, b1.label, w.c.repoGet('Baseline', b0.id).status], [1, 'B1 (revue)', 'Archivée']);
    const between = w.call(CP, 'baselines.diff', { projectId: w.p1.id, baselineId: b0.id, compareTo: b1.id });
    eq([between.totals.slipped, between.totals.max_slip, between.compareTo.label], [1, 3, 'B1 (revue)']);
    const now = w.call(CP, 'baselines.diff', { projectId: w.p1.id });
    eq([now.baseline.label, now.totals.slipped, now.items.every((i) => i.state === 'same')], ['B1 (revue)', 0, true]);
    eq(w.raw(CP, 'baselines.activate', { id: b0.id }).error.code, 'VALIDATION', 'motif obligatoire');
    eq(w.raw(CP, 'baselines.activate', { id: b1.id, reason: 'x' }).error.code, 'VALIDATION', 'déjà active');
    eq(w.raw(MEMBER, 'baselines.activate', { id: b0.id, reason: 'x' }).error.code, 'FORBIDDEN');
    w.call(CP, 'baselines.activate', { id: b0.id, reason: 'Le client refuse le nouveau planning' });
    eq([w.c.repoGet('Baseline', b0.id).status, w.c.repoGet('Baseline', b1.id).status, w.c.repoGet('Project', w.p1.id).active_baseline_id],
      ['Active', 'Archivée', b0.id]);
    ok(w.c.repoList('ChangeEvent').some((e) => e.field === 'motif' && /client refuse/.test(e.new_value)), 'motif gardé au journal');
    const b2 = w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Nouvelle version' });
    eq(b2.number, 2, 'la numérotation continue après une réactivation');
  });

  test('AppSheet : une baseline ne peut qu’être demandée ; les champs de décision sont protégés', () => {
    const w = lot2World();
    const t = w.c.getTable('Baseline');
    // Création directe « Active » dans AppSheet : ramenée à une demande.
    t.appendRows([{ id: 'bl-1', project_id: w.p1.id, justification: 'Je fige moi-même', status: 'Active', number: 0, decided_by: MEMBER }]);
    w.c.onRowChanged('Baseline', 'bl-1', MEMBER);
    const r = w.c.repoGet('Baseline', 'bl-1');
    eq([r.status, r.number, r.decided_by, r.requested_by], ['Demandée', '', '', MEMBER]);
    ok(w.c.SENT_MAILS.some((m) => m.to === MEMBER && /enregistrée comme demande/.test(m.subject)));
    ok(w.c.SENT_MAILS.some((m) => m.to === CP && /rebaselining/.test(m.subject)), 'le chef de projet est prévenu de la demande');
    eq(w.c.repoList('BaselineItem').length, 0, 'aucune copie figée');
    // Passage à « Active » à la main, même par le chef de projet : annulé (il faut passer par la page Suivi).
    const n = t.findRow('bl-1');
    t.writeRow(n, Object.assign(t.readRow(n), { status: 'Active' }));
    eq(w.c.onRowChanged('Baseline', 'bl-1', CP), 'UPDATED');
    eq(w.c.repoGet('Baseline', 'bl-1').status, 'Demandée');
    ok(w.c.SENT_MAILS.some((m) => m.to === CP && /annulée/.test(m.subject)));
    // La justification reste modifiable.
    t.writeRow(n, Object.assign(t.readRow(n), { justification: 'Retard fournisseur confirmé' }));
    w.c.onRowChanged('Baseline', 'bl-1', MEMBER);
    eq(w.c.repoGet('Baseline', 'bl-1').justification, 'Retard fournisseur confirmé');
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, '');
  });

  test('Refus d’une demande, avec motif', () => {
    const w = lot2World();
    const req = w.call(MEMBER, 'baselines.request', { projectId: w.p1.id, justification: 'Je voudrais décaler' });
    eq(w.raw(CP, 'baselines.refuse', { id: req.id }).error.code, 'VALIDATION');
    eq(w.raw(MEMBER, 'baselines.refuse', { id: req.id, reason: 'x' }).error.code, 'FORBIDDEN');
    const r = w.call(CP, 'baselines.refuse', { id: req.id, reason: 'Le retard se rattrape sur le WP 2' });
    eq([r.status, r.decided_by], ['Refusée', CP]);
    eq(w.raw(CP, 'baselines.refuse', { id: req.id, reason: 'x' }).error.code, 'VALIDATION');
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, '', 'un refus ne crée pas de baseline');
  });

  test('Fil des changements : seulement les données figées, depuis la baseline active, jusqu’à validation', () => {
    const w = lot2World();
    eq(w.call(CP, 'changes.feed', { projectId: w.p1.id }).baseline, null, 'pas de fil sans baseline');
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(MEMBER, 'progress.declare', { planItemId: w.a.id, progressPct: 50 });
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_start: '2026-10-13', planned_finish: '2026-10-26' } });
    w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Rapport', item_type: 'Livrable' } });
    w.call(RWP, 'workpackages.update', { id: w.w1.id, patch: { name: 'Conception détaillée' } });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { owner_resource_id: w.remi.id } });
    const feed = w.call(CP, 'changes.feed', { projectId: w.p1.id });
    eq(feed.pending, 5, 'avancement déclaré exclu : ce n’est pas une donnée figée');
    const lines = feed.items.map((e) => e.entity + ' | ' + e.what + ' | ' + e.field_label + ' | ' + e.old_value + ' → ' + e.new_value);
    ok(lines.includes('Essais | modification | responsable | Carla → Rémi'), lines.join('\n'));
    ok(lines.includes('WP 1 Conception détaillée | modification | nom | Conception → Conception détaillée'), lines.join('\n'));
    ok(lines.includes('Calcul | modification | fin prévue | 2026-10-23 → 2026-10-26'), lines.join('\n'));
    ok(lines.some((l) => l.startsWith('Rapport | ajout')), lines.join('\n'));
    ok(feed.items.every((e) => e.actor), 'auteur de chaque changement');
    eq(w.raw(MEMBER, 'changes.feed', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    eq(w.raw(RWP, 'changes.feed', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'le fil est l’outil du pilotage du projet');
    eq(w.raw(RWP, 'changes.ack', { ids: [feed.items[0].id] }).error.code, 'FORBIDDEN');
    eq(w.call(CP, 'changes.ack', { ids: [feed.items[0].id, feed.items[1].id] }).acknowledged, 2);
    const after = w.call(CP, 'changes.feed', { projectId: w.p1.id });
    eq(after.pending, 3);
    const hist = w.call(CP, 'changes.feed', { projectId: w.p1.id, all: true });
    eq([hist.items.length, hist.items.filter((e) => e.acknowledged).length], [5, 2]);
    eq(hist.items.find((e) => e.acknowledged).acknowledged_by, CP);
    eq(w.call(DPL, 'changes.ack', { projectId: w.p1.id, all: true }).acknowledged, 3, 'le DPL peut tout valider');
    eq(w.call(CP, 'changes.feed', { projectId: w.p1.id }).pending, 0);
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-27' } });
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Nouvelle référence' });
    eq(w.call(CP, 'changes.feed', { projectId: w.p1.id }).pending, 0, 'une nouvelle baseline repart d’un fil vide');
  });

  test('Gantt : dates de la baseline, glissement et éléments ajoutés', () => {
    const w = lot2World();
    const before = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    eq([before.baseline, 'baseline_finish' in before.rows.find((r) => r.id === w.b.id)], [null, false]);
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
    const d = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Rapport', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-06' } });
    const g = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    const row = (id) => g.rows.find((r) => r.id === id);
    eq([row(w.b.id).baseline_start, row(w.b.id).baseline_finish, row(w.b.id).slip], ['2026-10-12', '2026-10-23', 3]);
    eq([row(w.j.id).baseline_finish, row(w.j.id).slip], ['2026-11-09', 0]);
    eq(row(d.id).added, true);
    eq([row('wp:' + w.w1.id).baseline_start, row('wp:' + w.w1.id).baseline_finish], ['2026-10-05', '2026-10-23']);
    eq([g.baseline.label, g.baseline.slipped, g.baseline.added, g.baseline.removed, g.baseline.end], ['B0', 1, 1, 0, '2026-11-09']);
  });

  test('Moteur de règles : glissement critique au-delà de 5 jours ouvrés, projet sans baseline', () => {
    const w = lot2World();
    const codes = () => w.c.repoList('Insight').map((i) => i.rule_code + ':' + i.target_id);
    w.c.runRules();
    ok(codes().includes('NO_BASELINE:' + w.p1.id), 'projet actif et planifié sans baseline signalé');
    ok(!codes().includes('NO_BASELINE:' + w.p2.id), 'projet sans dates : rien à signaler');
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(CP, 'planitems.update', { id: w.j.id, patch: { planned_start: '2026-11-18', planned_finish: '2026-11-18' } });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { planned_finish: '2026-11-09' } });
    w.c.runRules();
    const ins = w.c.repoList('Insight');
    ok(!codes().includes('NO_BASELINE:' + w.p1.id));
    const slip = ins.find((i) => i.rule_code === 'CRITICAL_SLIP' && i.target_id === w.j.id);
    ok(slip, 'jalon critique décalé de 6 jours ouvrés (le 11 novembre est férié) : ' + codes().join(', '));
    ok(/6 jours ouvrés après la baseline/.test(slip.message), slip.message);
    ok(!ins.some((i) => i.rule_code === 'CRITICAL_SLIP' && i.target_id === w.cc.id), '1 jour de glissement : sous le seuil');
  });
};
