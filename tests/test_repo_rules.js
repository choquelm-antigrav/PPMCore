const { freshCore, test, eq, ok, throwsCode } = require('./harness');

module.exports = function () {
  console.log('\nDépôt et journal');
  const A = { actor: 'cp@entreprise.com', source: 'api' };
  const events = (c) => c.getTable('ChangeEvent')._rows;

  test('Création : version 1, événement de création, instantané', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'Projet X', status: 'Actif' }, A);
    eq([p.version, p.created_by, p.deleted], [1, 'cp@entreprise.com', false]);
    eq(events(c).map((e) => [e.field, e.new_value, e.project_id]), [['*', '(création)', p.id]]);
    ok(c.snapshotGet('Project', p.id), 'instantané présent');
  });

  test('Modification : diff par champ, version, conflit', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'Projet X' }, A);
    const p2 = c.repoUpdate('Project', p.id, { name: 'Projet Y', code: 'X1' }, 1, A);
    eq(p2.version, 2);
    const last = events(c).slice(-1)[0];
    eq([last.field, last.old_value, last.new_value], ['name', 'Projet X', 'Projet Y']);
    throwsCode(() => c.repoUpdate('Project', p.id, { name: 'Z' }, 1, A), 'CONFLICT');
    const same = c.repoUpdate('Project', p.id, { name: 'Projet Y' }, 2, A);
    eq([same.version, events(c).length], [2, 2], 'aucune écriture si rien ne change');
  });

  test('Contrôles et champs calculés', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'P' }, A);
    throwsCode(() => c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable' }, A), 'VALIDATION');
    throwsCode(() => c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Tâche', name: 'n' }, A), 'VALIDATION');
    throwsCode(() => c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'n', progress_pct: 150 }, A), 'VALIDATION');
    throwsCode(() => c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'n', planned_finish: '05/10/2026' }, A), 'VALIDATION');
    const r = c.repoInsert('RiskOpportunity', { project_id: p.id, kind: 'Risque', title: 'r', probability: 4, impact: 3 }, A);
    eq(r.score, 12);
    const j = c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Jalon', name: 'J', planned_finish: '2026-11-02' }, A);
    eq(j.planned_start, '2026-11-02');
    const b = c.repoInsert('BudgetLine', { deliverable_id: j.id, resource_id: 'r', cost_type: 'TJM', planned_days: 10, frozen_rate: 650.5 }, A);
    eq(b.planned_amount, 6505);
  });

  test('Chemin AppSheet : création, modification, inchangé, suppression', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'P' }, A);
    const t = c.getTable('PlanItem');
    t.appendRows([{ id: 'as-1', project_id: p.id, item_type: 'Livrable', name: 'Plan', planned_finish: '2026-11-02' }]);
    eq(c.onRowChanged('PlanItem', 'as-1', 'Alice@Entreprise.com'), 'CREATED');
    let row = c.repoGet('PlanItem', 'as-1');
    eq([row.version, row.created_by], [1, 'alice@entreprise.com']);
    t._rows[t.findRow('as-1') - 2].planned_finish = '2026-11-09';
    eq(c.onRowChanged('PlanItem', 'as-1', 'alice@entreprise.com'), 'UPDATED');
    row = c.repoGet('PlanItem', 'as-1');
    eq(row.version, 2);
    const ev = events(c).slice(-1)[0];
    eq([ev.field, ev.old_value, ev.new_value, ev.source, ev.project_id], ['planned_finish', '2026-11-02', '2026-11-09', 'appsheet', p.id]);
    eq(c.onRowChanged('PlanItem', 'as-1', 'alice@entreprise.com'), 'UNCHANGED');
    t._rows.splice(t.findRow('as-1') - 2, 1);
    eq(c.onRowChanged('PlanItem', 'as-1', 'alice@entreprise.com'), 'DELETED');
    eq(events(c).slice(-1)[0].new_value, '(suppression)');
    eq(c.onRowChanged('Insight', 'x', 'a@entreprise.com'), 'IGNORED');
  });

  test('Dépendance saisie dans AppSheet qui ferme un cycle : annulée et auteur prévenu', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'P' }, A);
    const a = c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'A' }, A);
    const b = c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'B' }, A);
    c.repoInsert('Dependency', { predecessor_id: a.id, successor_id: b.id, dep_type: 'FS' }, A);
    c.getTable('Dependency').appendRows([{ id: 'loop', predecessor_id: b.id, successor_id: a.id, dep_type: 'FS' }]);
    c.onRowChanged('Dependency', 'loop', 'bob@entreprise.com');
    ok(c.isTrue(c.repoGet('Dependency', 'loop').deleted), 'dépendance annulée');
    eq(c.SENT_MAILS.map((m) => [m.to, m.subject]), [['bob@entreprise.com', '[PPM✴️] Dépendance annulée']]);
  });

  test('Déclaration d’avancement : la dernière fait foi', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'P' }, A);
    const l = c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'L', progress_pct: 0, status: 'À faire' }, A);
    c.repoInsert('ProgressUpdate', { deliverable_id: l.id, progress_pct: 100, declared_at: '2026-10-05T09:00:00.000Z' }, A);
    let it = c.repoGet('PlanItem', l.id);
    eq([it.progress_pct, it.status, it.actual_finish], [100, 'Terminé', '2026-10-05']);
    c.repoInsert('ProgressUpdate', { deliverable_id: l.id, progress_pct: 40 }, A);
    it = c.repoGet('PlanItem', l.id);
    eq([it.progress_pct, it.status, it.actual_finish], [40, 'En cours', '']);
  });

  test('Avancement et demande de baseline saisis dans AppSheet', () => {
    const c = freshCore();
    const cp = c.repoInsert('Resource', { resource_type: 'Interne', name: 'CP', email: 'cp@entreprise.com' }, A);
    const p = c.repoInsert('Project', { code: 'X1', name: 'P', manager_resource_id: cp.id }, A);
    const l = c.repoInsert('PlanItem', { project_id: p.id, item_type: 'Livrable', name: 'L' }, A);
    c.getTable('ProgressUpdate').appendRows([{ id: 'pu1', deliverable_id: l.id, progress_pct: 30 }]);
    eq(c.onRowChanged('ProgressUpdate', 'pu1', 'dev@entreprise.com'), 'CREATED');
    ok(c.repoGet('ProgressUpdate', 'pu1').declared_at, 'horodatage posé par le Core');
    eq(c.repoGet('PlanItem', l.id).progress_pct, 30);
    c.getTable('Baseline').appendRows([{ id: 'b1', project_id: p.id, justification: 'Retard', status: 'Demandée', requested_by: 'dev@entreprise.com' }]);
    c.onRowChanged('Baseline', 'b1', 'dev@entreprise.com');
    eq(c.SENT_MAILS.map((m) => m.to), ['cp@entreprise.com']);
  });

  test('Réconciliation : rattrape une écriture AppSheet non signalée', () => {
    const c = freshCore();
    const p = c.repoInsert('Project', { code: 'X1', name: 'P' }, A);
    const t = c.getTable('Project');
    t._rows[0].name = 'Renommé hors bot';
    t.appendRows([{ id: 'orphan', code: 'X2', name: 'Créé hors bot' }]);
    const before = events(c).length;
    ok(c.reconcileAll({}, Date.parse('2030-01-01')), 'terminé');
    const added = events(c).slice(before).map((e) => e.entity_id + ':' + e.field);
    eq(added.sort(), [p.id + ':name', 'orphan:*'].sort());
    eq(c.repoGet('Project', p.id).version, 2);
  });

  console.log('\nMoteur de règles');

  const base = () => ({
    projects: [{ id: 'P1', status: 'Actif' }, { id: 'P9', status: 'Clos' }],
    workpackages: [{ id: 'W1', project_id: 'P1', name: 'WP vide' }, { id: 'W2', project_id: 'P1', name: 'WP plein' }],
    planitems: [
      { id: 'L1', project_id: 'P1', wp_id: 'W2', item_type: 'Livrable', name: 'En retard', owner_resource_id: 'r', planned_finish: '2026-10-01', progress_pct: 50, status: 'En cours', last_progress_at: '2026-09-30T10:00:00Z' },
      { id: 'L2', project_id: 'P1', wp_id: 'W2', item_type: 'Livrable', name: 'Oublié', owner_resource_id: 'r', planned_finish: '2026-12-01', progress_pct: 20, status: 'En cours', last_progress_at: '2026-08-01T10:00:00Z' },
      { id: 'L3', project_id: 'P1', wp_id: 'W2', item_type: 'Livrable', name: 'Sans responsable', planned_finish: '2026-12-20', progress_pct: 0 },
      { id: 'J1', project_id: 'P1', wp_id: 'W2', item_type: 'Jalon', name: 'Revue', owner_resource_id: 'r', planned_start: '2026-11-30', planned_finish: '2026-11-30' },
      { id: 'X1', project_id: 'P9', item_type: 'Livrable', name: 'Projet clos', planned_finish: '2020-01-01', progress_pct: 0 }
    ],
    dependencies: [],
    requirements: [{ id: 'm1', milestone_id: 'J1', deliverable_id: 'L2' }],
    risks: [{ id: 'R1', project_id: 'P1', kind: 'Risque', title: 'Fournisseur', status: 'Ouvert', review_date: '2026-09-01' }]
  });

  test('Constats attendus, projet clos ignoré', () => {
    const c = freshCore();
    const found = c.evaluateRules(base(), '2026-10-05', null).map((i) => i.rule_code + ':' + i.target_id).sort();
    eq(found, ['EMPTY_WP:W1', 'LATE_ITEM:L1', 'MILESTONE_THREATENED:J1', 'MISSING_OWNER:L3', 'NO_BASELINE:P1', 'RISK_OVERDUE:R1', 'STALE_PROGRESS:L2'].sort());
  });

  test('Fusion : « Ignoré » conservé, « Nouveau » mis à jour, résolu supprimé', () => {
    const c = freshCore();
    const fresh = c.evaluateRules(base(), '2026-10-05', null);
    const existing = [
      { id: 'i1', rule_code: 'LATE_ITEM', target_id: 'L1', status: 'Ignoré' },
      { id: 'i2', rule_code: 'MISSING_OWNER', target_id: 'L3', status: 'Nouveau', version: 1 },
      { id: 'i3', rule_code: 'MISSING_OWNER', target_id: 'L9', status: 'Nouveau', version: 1 }
    ];
    const merged = c.mergeInsights(existing, fresh, 'ppm-core');
    const byKey = Object.fromEntries(merged.map((m) => [m.rule_code + ':' + m.target_id, m]));
    eq(byKey['LATE_ITEM:L1'].status, 'Ignoré');
    eq([byKey['MISSING_OWNER:L3'].id, byKey['MISSING_OWNER:L3'].version], ['i2', 2]);
    ok(!byKey['MISSING_OWNER:L9'], 'constat résolu retiré');
    eq(merged.length, fresh.length);
  });
};
