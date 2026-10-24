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

  test('Fil de validation : chacun valide ce que fait un niveau strictement inférieur, une seule validation suffit, depuis la baseline active', () => {
    const w = lot2World();
    const zed = w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zed', email: 'zed@entreprise.com', country: 'FR' }, w.S);
    void zed;
    const feed = (who, extra) => w.call(who, 'changes.feed', Object.assign({ projectId: w.p1.id }, extra || {}));
    eq(feed(CP).baseline, null, 'sans baseline, le fil remonte aux soixante derniers jours (il n’y a pas de baseline à afficher)');
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(MEMBER, 'progress.declare', { planItemId: w.a.id, progressPct: 50 });                                           // niveau 6
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_start: '2026-10-13', planned_finish: '2026-10-26' } });  // niveau 3 (Workpackage leader)
    w.call(RWP, 'workpackages.update', { id: w.w1.id, patch: { name: 'Conception détaillée' } });                         // niveau 3
    w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Rapport', item_type: 'Livrable' } });         // niveau 2
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { owner_resource_id: w.remi.id } });                             // niveau 2
    const lines = (f) => f.items.map((e) => e.entity + ' | ' + e.what + ' | ' + e.field_label + ' | ' + e.old_value + ' → ' + e.new_value);

    // le chef de projet valide ce que font les niveaux en dessous de lui : l'avancement de Mia, les dates de Rémi, le nom du WP
    const cp = feed(CP);
    eq(cp.pending, 4, 'quatre changements à valider par le chef de projet');
    ok(lines(cp).includes('Spécification | modification | avancement | 0 → 50'), 'l’avancement déclaré se valide aussi : ' + lines(cp).join(' ; '));
    ok(lines(cp).includes('Calcul | modification | fin prévue | 2026-10-23 → 2026-10-26') && lines(cp).includes('WP 1 Conception détaillée | modification | nom | Conception → Conception détaillée'), lines(cp).join('\n'));
    ok(!lines(cp).some((l) => /^Rapport \| ajout/.test(l) || /^Essais \|/.test(l)), 'ses propres changements ne sont pas à lui de les valider');
    eq(cp.mine.map((e) => e.entity).sort(), ['Essais', 'Rapport'], 'il les voit dans « vos modifications en attente »');
    ok(cp.mine.every((e) => e.validator === 'Domain Program Leader'), 'avec le niveau qui doit les valider : le DPL');
    ok(cp.items.every((e) => e.actor && e.can_validate && typeof e.level === 'number'), 'auteur et niveau de chaque changement');
    // le DPL valide tout, y compris ce que fait le chef de projet
    eq(feed(DPL).pending, 6, 'le DPL : les quatre, plus les deux du chef de projet');
    // un Workpackage leader valide ce que fait un Contributor, pas ce que fait le chef de projet
    const remi = feed(RWP);
    eq([remi.pending, lines(remi)], [1, ['Spécification | modification | avancement | 0 → 50']], 'Rémi (niveau 3) valide l’avancement de Mia (niveau 6) — pas ses propres dates ni ce que fait le chef de projet');
    eq(remi.mine.map((e) => e.validator).sort(), ['Chef de projet', 'Chef de projet', 'Chef de projet'], 'ses trois changements attendent le chef de projet (nominal)');
    const mia = feed(MEMBER);
    eq([mia.pending, mia.mine.length, mia.mine[0].validator], [0, 1, 'Deliverable owner'], 'Mia (niveau 6) ne valide rien ; son avancement attend le Deliverable owner du livrable');
    eq(w.raw('zed@entreprise.com', 'changes.feed', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'sans rôle dans le projet : pas de fil');

    // droits de valider
    const ids = (f, re) => f.items.filter((e) => re.test(e.entity + ' | ' + e.field_label)).map((e) => e.id);
    const progressId = ids(cp, /^Spécification \| avancement/)[0], dateIds = ids(cp, /^Calcul \| (début|fin) prévu/), cpOwn = ids(feed(DPL), /^(Rapport|Essais)/);
    eq(w.raw(MEMBER, 'changes.ack', { ids: [progressId] }).error.code, 'FORBIDDEN', 'un Contributor ne valide rien');
    eq(w.raw(RWP, 'changes.ack', { ids: [cpOwn[0]] }).error.code, 'FORBIDDEN', 'un Workpackage leader ne valide pas ce que fait le chef de projet');
    eq(w.raw(RWP, 'changes.ack', { ids: [dateIds[0]] }).error.code, 'FORBIDDEN', 'ni ses propres dates');
    eq(w.raw(CP, 'changes.ack', { ids: [cpOwn[0]] }).error.code, 'FORBIDDEN', 'le chef de projet ne valide pas ses propres changements');
    eq(w.raw(CP, 'changes.ack', { ids: [progressId, cpOwn[0]] }).error.code, 'FORBIDDEN', 'une liste qui en contient un interdit est refusée en entier');
    eq(feed(CP).pending, 4, 'rien n’a été validé par ces refus');
    eq(w.call(RWP, 'changes.ack', { ids: [progressId] }).acknowledged, 1, 'Rémi valide l’avancement de Mia');
    eq([feed(CP).pending, feed(RWP).pending, feed(DPL).pending], [3, 0, 5], 'une seule validation suffit : l’événement disparaît pour tous les niveaux');
    eq(w.call(CP, 'changes.ack', { ids: dateIds }).acknowledged, dateIds.length, 'le chef de projet valide les dates de Rémi');
    const hist = feed(CP, { all: true });
    eq(hist.items.filter((e) => e.acknowledged).map((e) => e.acknowledged_by).sort(), [CP, CP, RWP], 'l’historique garde qui a validé (Rémi, puis le chef de projet deux fois)');
    eq(w.call(DPL, 'changes.ack', { projectId: w.p1.id, all: true }).acknowledged, 3, 'le DPL valide tout le reste d’un coup : le nom du WP et les deux changements du chef de projet');
    eq([feed(CP).pending, feed(DPL).pending], [0, 0]);
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-27' } });
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Nouvelle référence' });
    eq(feed(CP).pending, 0, 'une nouvelle baseline repart d’un fil vide');
  });

  test('Niveau de l’auteur : écrit dans le journal, administrateur et système n’ont personne au-dessus, ancien événement valable pour tout niveau', () => {
    const w = lot2World();
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    const level = (id) => w.c.repoList('ChangeEvent').filter((e) => e.entity_id === id && e.field === 'planned_finish').map((e) => e.actor_level).pop();
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-26' } });
    w.call(MEMBER, 'progress.declare', { planItemId: w.a.id, progressPct: 40 });
    eq(level(w.b.id), '3', 'Rémi, Workpackage leader : niveau 3 (son meilleur rang sur l’objet)');
    eq(w.c.repoList('ChangeEvent').filter((e) => e.entity_id === w.a.id && e.field === 'progress_pct').pop().actor_level, '6', 'Mia, Contributor : niveau 6');
    w.call('admin@entreprise.com', 'planitems.update', { id: w.cc.id, patch: { planned_finish: '2026-11-04' } });
    eq(level(w.cc.id), '0', 'l’administrateur : niveau 0, rien à valider');
    w.c.repoUpdate('PlanItem', w.j.id, { planned_finish: '2026-11-30' }, null, w.S);
    eq(level(w.j.id), '0', 'le système : niveau 0');
    ok(w.call(CP, 'changes.feed', { projectId: w.p1.id }).items.every((e) => e.level > 0), 'le fil ne montre jamais un changement du niveau 0');
    // un événement d'avant la 0.15.3 n'a pas de niveau : tout niveau qui a un rôle sur l'objet peut le valider
    const ev = w.c.repoList('ChangeEvent').find((e) => e.entity_id === w.b.id && e.field === 'planned_finish');
    w.c.getTable('ChangeEvent').updateRows([{ row: w.c.getTable('ChangeEvent').findRow(ev.id), obj: Object.assign({}, ev, { actor_level: '' }) }]);
    const sees = (who) => w.call(who, 'changes.feed', { projectId: w.p1.id }).items.some((e) => e.id === ev.id);
    eq([sees(CP), sees(RWP), sees(MEMBER)], [true, true, true], 'ancien événement sans niveau : toute personne qui a un rôle sur l’objet peut le valider (on ne sait plus qui était au-dessus de qui)');
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
