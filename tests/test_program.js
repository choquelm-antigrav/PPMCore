const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nVues programme consolidées : Actualités, Suivi, Budget (0.14.1)');
  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const S = { actor: 'setup', source: 'setup' };

  function world() {
    const w = lot2World();
    let t = Date.parse('2026-10-14T08:00:00Z'); w.c.CLOCK = () => (t += 1);
    return w;
  }
  const ACTIONS = ['news.program', 'suivi.program', 'budget.program'];

  test('Droits : Program Leader, Domain Program Leader et administrateur ; personne d’autre, ni les autres programmes', () => {
    const w = world();
    ACTIONS.forEach((a) => {
      ok(w.call(DPL, a, { programId: w.prog.id }).projects.length === 2, a + ' : le DPL voit ses deux projets');
      ok(w.call(ADMIN, a, { programId: w.prog.id }).projects.length === 2, a + ' : l’administrateur aussi');
      [CP, RWP, MEMBER].forEach((who) => eq(w.raw(who, a, { programId: w.prog.id }).error.code, 'FORBIDDEN', a + ' : refusé à ' + who));
      eq(w.raw(DPL, a, { programId: 'inconnu' }).error.code, 'NOT_FOUND', a + ' : programme inconnu');
      eq(w.raw(DPL, a, {}).error.code, 'VALIDATION', a + ' : paramètre obligatoire');
    });
    const other = w.call(ADMIN, 'programs.create', { values: { code: 'PG2', name: 'Autre programme' } });
    ACTIONS.forEach((a) => eq(w.raw(DPL, a, { programId: other.id }).error.code, 'FORBIDDEN', a + ' : le DPL d’un programme ne voit pas un autre programme'));
    const cat = (who) => w.call(who, 'planning.catalog', {}).program_view;
    eq([cat(DPL), cat(ADMIN).sort(), cat(CP), cat(MEMBER)], [[w.prog.id], [w.prog.id, other.id].sort(), [], []], 'le catalogue dit à chacun quels programmes il peut consolider');
  });

  test('Actualités du programme : une ligne par projet, les réunions récentes et les actions ouvertes de tous les projets', () => {
    const w = world(), c = w.c;
    const meet = (project, title, held_on, status, extra) => c.repoInsert('Meeting', Object.assign({ project_id: project ? project.id : '', source: 'Manuel', held_on, title, status, participants: 'Carla, Rémi' }, extra || {}), S);
    const m1 = meet(w.p1, 'Revue P1 A', '2026-10-12', 'Publiée'), m2 = meet(w.p1, 'Revue P1 B', '2026-10-01', 'Publiée'), m3 = meet(w.p2, 'Revue P2', '2026-08-01', 'Publiée');
    meet(null, 'Réunion à classer', '2026-10-13', 'À trier', { candidates: w.p1.id + ',' + w.p2.id });
    const act = (project, meeting, text, due, status, owner) => c.repoInsert('NewsAction', { project_id: project.id, meeting_id: meeting.id, text, due_date: due, status, owner_resource_id: owner ? owner.id : '' }, S);
    act(w.p1, m1, 'Envoyer le plan', '2026-10-10', 'Proposée', w.remi); act(w.p1, m1, 'Valider le budget', '2026-10-30', 'Contestée', w.carla); act(w.p1, m2, 'Déjà fait', '2026-10-05', 'Faite', w.remi);
    act(w.p2, m3, 'Relancer le fournisseur', '2026-11-15', 'Acceptée', null);
    c.repoInsert('NewsDigest', { project_id: w.p1.id, digest_date: '2026-10-14', text: 'x' }, S);
    const d = w.call(DPL, 'news.program', { programId: w.prog.id });
    const r1 = d.projects.find((x) => x.code === 'P1'), r2 = d.projects.find((x) => x.code === 'P2');
    eq([r1.meetings_30d, r1.last_meeting, r1.actions_open, r1.actions_overdue, r1.actions_contested, r1.to_sort, r1.digest_today], [2, '2026-10-12', 2, 1, 1, 1, true], 'P1 : 2 réunions, 2 actions ouvertes dont 1 en retard et 1 contestée, 1 à classer, synthèse du jour');
    eq([r2.meetings_30d, r2.last_meeting, r2.actions_open, r2.actions_overdue, r2.to_sort, r2.digest_today], [0, '2026-08-01', 1, 0, 1, false], 'P2 : aucune réunion récente, 1 action ouverte, 1 à classer');
    eq([d.totals.meetings_30d, d.totals.actions_open, d.totals.actions_overdue, d.totals.actions_contested, d.totals.to_sort], [2, 3, 1, 1, 1], 'totaux : la réunion à classer n’est comptée qu’une fois');
    eq(d.recent.map((m) => m.title), ['Revue P1 A', 'Revue P1 B'], 'réunions des 14 derniers jours, la plus récente d’abord, avec leur projet');
    eq(d.actions.map((a) => a.project_code + ':' + a.text + ':' + a.overdue), ['P1:Envoyer le plan:true', 'P1:Valider le budget:false', 'P2:Relancer le fournisseur:false'], 'actions ouvertes de tous les projets, par échéance, la faite exclue');
    eq(d.actions[0].owner, 'Rémi', 'le responsable de chaque action est nommé');
  });

  test('Suivi du programme : baseline active, dérives, demandes et changements par projet', () => {
    const w = world(), c = w.c;
    let d = w.call(DPL, 'suivi.program', { programId: w.prog.id });
    eq([d.totals.without_baseline, d.projects.map((p) => p.baseline)], [2, ['', '']], 'sans baseline : rien n’est comparé');
    w.call(CP, 'baselines.create', { projectId: w.p1.id, label: 'B0', justification: 'Lancement' });
    c.repoUpdate('PlanItem', w.b.id, { planned_finish: '2026-10-30' }, null, S); // « Calcul » prévu le 23/10 : glisse de 5 jours ouvrés
    d = w.call(DPL, 'suivi.program', { programId: w.prog.id });
    const r1 = d.projects.find((p) => p.code === 'P1'), direct = w.call(CP, 'baselines.diff', { projectId: w.p1.id }).totals;
    eq([r1.baseline, r1.compared, r1.slipped, r1.max_slip, r1.end_slip, r1.end], [ 'B0', direct.compared, direct.slipped, direct.max_slip, direct.end_slip, direct.end], 'la ligne du projet reprend exactement baselines.diff');
    ok(r1.slipped >= 1 && r1.max_slip >= 1, 'une dérive est comptée : ' + r1.slipped + ' élément(s), jusqu’à ' + r1.max_slip + ' jours');
    eq(r1.pending_changes, w.call(DPL, 'changes.feed', { projectId: w.p1.id }).pending, 'changements en attente : ceux du fil du projet, vu par le DPL qui consulte le programme (la baseline figée par le chef de projet en fait partie)');
    eq([d.totals.without_baseline, d.totals.slipped], [1, r1.slipped], 'totaux : 1 projet sans baseline');
    const req = w.call(CP, 'baselines.request', { projectId: w.p1.id, justification: 'Replanifier après le retard de calcul' });
    d = w.call(DPL, 'suivi.program', { programId: w.prog.id });
    eq([d.projects.find((p) => p.code === 'P1').requested, d.totals.requested], [1, 1], 'une demande de baseline en attente est comptée');
    ok(req && d.projects.find((p) => p.code === 'P1').baselines === 2, 'et le nombre de baselines suit');
  });

  test('Budget du programme : une ligne par projet identique à son bilan, et les totaux', () => {
    const w = world();
    const d = w.call(DPL, 'budget.program', { programId: w.prog.id });
    d.projects.forEach((p) => {
      const b = w.call(ADMIN, 'budget.balance', { projectId: p.id }).totals;
      eq([p.budget_total, p.budget_internal, p.budget_external, p.po_planned, p.po_committed, p.po_received, p.po_closed, p.po_count, p.remaining_external, p.overrun, p.restricted],
        [b.budget.total, b.budget.internal, b.budget.external, b.po.planned, b.po.committed, b.po.received, b.po.closed, b.po.count, b.remaining_external, !!b.overrun, false], p.code + ' : la ligne reprend le bilan du projet');
    });
    const sum = (k) => d.projects.reduce((s, p) => s + p[k], 0);
    eq([d.totals.budget_total, d.totals.po_committed, d.totals.remaining_external, d.totals.overruns, d.totals.restricted], [sum('budget_total'), sum('po_committed'), sum('remaining_external'), 0, 0], 'totaux = somme des projets');
    eq(d.projects.map((p) => p.code), ['P1', 'P2'], 'projets triés par code');
    eq(d.program.code, w.prog.code, 'le programme est nommé');
  });
};
