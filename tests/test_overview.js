const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nOverview projet : création, renommage et indicateurs (0.10.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };
  // Jeu : P1 (Carla CP) : A 05→09/10, B 12→23/10, C 26/10→06/11, J jalon 09/11 ; Dora DPL du programme ; P2 sans élément daté.

  test('Création d’un projet : droits, validations, chef de projet nommé, CPN unique', () => {
    const w = lot2World();
    const save = (who, values, id, version) => w.raw(who, 'projects.save', { id, version, values });
    const base = { code: 'P3', name: '  Nouveau   projet ', program_id: w.prog.id, manager_resource_id: w.carla.id, start_date: '2026-11-02', end_date: '2027-03-31', cpn: 'cpn-300', cpn_label: 'Désignation 300' };
    const r = save(DPL, base);
    ok(r.ok, JSON.stringify(r.error));
    const p3 = w.c.repoGet('Project', r.data.id);
    eq([r.data.created, p3.name, p3.code, p3.status, p3.holiday_country, p3.cpn, p3.cpn_label, p3.program_id, p3.manager_resource_id], [true, 'Nouveau projet', 'P3', 'Actif', 'FR', 'CPN-300', 'Désignation 300', w.prog.id, w.carla.id]);
    ok(w.c.repoList('RoleAssignment').some((a) => a.resource_id === w.carla.id && a.role_code === 'CP' && a.scope_type === 'project' && a.scope_id === p3.id && a.start_date === w.c.todayStr()), 'le chef de projet reçoit son rôle sur le projet');
    ok(/déjà utilisé/.test(save(DPL, Object.assign({}, base, { code: ' p3 ', cpn: '' })).error.message), 'code unique, sans tenir compte de la casse');
    ok(/CPN-300 est déjà porté/.test(save(DPL, Object.assign({}, base, { code: 'P4' })).error.message), 'un CPN ne couvre qu’un projet');
    [{ name: ' ' }, { code: '' }, { code: 'a/b?c' }, { status: 'Perdu' }, { start_date: '2027-05-01' }, { end_date: '2026-02-30' }, { manager_resource_id: w.xavier.id }, { holiday_country: 'ES' }]
      .forEach((v) => eq(save(DPL, Object.assign({}, base, { code: 'P9', cpn: '' }, v)).error.code, 'VALIDATION', JSON.stringify(v)));
    eq(save(DPL, Object.assign({}, base, { code: 'P9', cpn: '', program_id: 'inconnu' })).error.code, 'NOT_FOUND', 'programme inconnu');
    eq(save(CP, Object.assign({}, base, { code: 'P5', cpn: '' })).error.code, 'FORBIDDEN', 'un chef de projet ne crée pas de projet');
    eq(save(MEMBER, Object.assign({}, base, { code: 'P5', cpn: '' })).error.code, 'FORBIDDEN');
    ok(save(ADMIN, { code: 'P6', name: 'Sans programme' }).ok, 'l’administrateur crée un projet hors programme, sans chef de projet');
    eq(w.c.repoList('RoleAssignment').filter((a) => a.scope_type === 'project' && a.scope_id === w.c.repoList('Project').find((x) => x.code === 'P6').id).length, 0);
  });

  test('Renommer et modifier un projet : droit d’édition, code unique, version', () => {
    const w = lot2World();
    const save = (who, values, version) => w.raw(who, 'projects.save', { id: w.p1.id, version, values });
    const r = save(CP, { name: ' Nacelle moteur v2 ', code: 'NAC-1', status: 'En pause', start_date: '2026-10-01', end_date: '2027-01-29' });
    ok(r.ok, JSON.stringify(r.error));
    const p = w.c.repoGet('Project', w.p1.id);
    eq([p.name, p.code, p.status, p.start_date, p.end_date], ['Nacelle moteur v2', 'NAC-1', 'En pause', '2026-10-01', '2027-01-29']);
    eq(save(MEMBER, { name: 'X' }).error.code, 'FORBIDDEN');
    eq(save(RWP, { name: 'X' }).error.code, 'FORBIDDEN');
    ok(/déjà utilisé/.test(save(CP, { code: w.p2.code }).error.message));
    eq(save(CP, { name: 'Autre' }, 1).error.code, 'CONFLICT');
    ok(save(CP, { name: 'Nom seul' }, r.data.version).ok);
    eq(w.c.repoGet('Project', w.p1.id).code, 'NAC-1', 'ne modifier que le nom laisse le reste');
    eq([w.c.repoGet('Project', w.p1.id).program_id, w.c.repoGet('Project', w.p1.id).manager_resource_id], [p.program_id, p.manager_resource_id], 'programme et chef de projet ne changent pas ici');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Project' && e.field === 'name' && e.new_value === 'Nom seul'), 'renommage tracé');
  });

  test('Indicateur DÉLAIS : tenu, vigilance, alerte, fin visée dépassée, projet sans planning', () => {
    const w = lot2World();
    const kpi = (iso) => {
      at(w, iso);
      const d = w.c.loadOverviewData_();
      return w.c.projectKpis_(d, d.projects.find((x) => x.id === w.p1.id), w.c.todayStr(), null).time;
    };
    const t0 = kpi('2026-10-05T08:00:00Z');
    eq([t0.level, t0.headline, t0.metrics.late], ['ok', 'Planning tenu', 0]);
    const t1 = kpi('2026-10-14T08:00:00Z');
    eq([t1.level, t1.headline, t1.facts[0], /Avancement \d+ % pour \d+ % attendus/.test(t1.facts.join())], ['alert', '1 élément en retard', '1 élément en retard', true], 'Spécification est en retard et à 0 % alors que le plan en attendait 100 % : l’écart d’avancement fait passer en alerte');
    const t3 = kpi('2026-11-20T08:00:00Z');
    eq([t3.level, t3.metrics.late >= 3], ['alert', true]);
    w.c.repoUpdate('Project', w.p1.id, { end_date: '2026-11-01' }, null, w.S);
    const tb = kpi('2026-10-05T08:00:00Z');
    eq([tb.level, tb.headline, /après la fin visée \(01\/11\/2026\)/.test(tb.facts.join())], ['alert', 'La fin du plan dépasse la fin visée', true]);
    const d = w.c.loadOverviewData_();
    eq(w.c.projectKpis_(d, d.projects.find((x) => x.id === w.p2.id), '2026-10-05', null).time.level, 'none', 'un projet sans élément daté n’est pas évalué');
    // retard d'avancement face au plan : tout est dû mais rien n'avance
    const gap = w.c.timeKpi_({ project: { id: 'p', end_date: '' }, today: '2026-10-20', holFor: () => ({}), deps: [], baselineEnd: '',
      items: [{ id: 'x', project_id: 'p', item_type: 'Livrable', name: 'X', planned_start: '2026-10-01', planned_finish: '2026-10-30', progress_pct: 10, status: 'En cours' }] });
    eq([gap.level, /Avancement 10 % pour \d+ % attendus/.test(gap.facts.join())], ['alert', true], 'avancement très en deçà du plan');
    const lone = w.c.timeKpi_({ project: { id: 'p', end_date: '' }, today: '2026-10-20', holFor: () => ({}), deps: [], baselineEnd: '', items: [
      { id: 'x', project_id: 'p', item_type: 'Livrable', name: 'X', planned_start: '2026-10-01', planned_finish: '2026-10-30', progress_pct: 60, status: 'En cours' },
      { id: 'j', project_id: 'p', item_type: 'Jalon', name: 'J', planned_start: '2026-10-10', planned_finish: '2026-10-10', progress_pct: 0 }] });
    eq([lone.level, lone.headline], ['warn', '1 élément en retard'], 'un seul retard, sans écart d’avancement : vigilance');
    const slip = w.c.timeKpi_({ project: { id: 'p', end_date: '' }, today: '2026-10-05', holFor: () => ({}), deps: [], baselineEnd: '2026-10-09',
      items: [{ id: 'x', project_id: 'p', item_type: 'Livrable', name: 'X', planned_start: '2026-10-05', planned_finish: '2026-10-16', progress_pct: 0 }] });
    eq([slip.level, /sur la baseline/.test(slip.facts.join())], ['warn', true], '5 jours ouvrés après la baseline : la limite est « plus de 5 jours », donc vigilance');
    const slip6 = w.c.timeKpi_({ project: { id: 'p', end_date: '' }, today: '2026-10-05', holFor: () => ({}), deps: [], baselineEnd: '2026-10-09',
      items: [{ id: 'x', project_id: 'p', item_type: 'Livrable', name: 'X', planned_start: '2026-10-05', planned_finish: '2026-10-19', progress_pct: 0 }] });
    eq(slip6.level, 'alert', '6 jours ouvrés après la baseline : alerte');
  });

  test('Indicateur QUALITÉ : registre vide, risques élevés ou critiques, traitement en retard, jalon menacé', () => {
    const w = lot2World();
    const q = (risks, insights) => w.c.qualityKpi_({ project: { id: 'p' }, items: [], today: '2026-10-14', risks: risks || [], insights: insights || [] });
    const risk = (score, extra) => Object.assign({ kind: 'Risque', status: 'Ouvert', score: score, title: 'R' }, extra || {});
    eq([q().level, q().headline], ['none', 'Aucun risque saisi']);
    eq(q([risk(4)]).level, 'ok', 'un risque faible : maîtrisé');
    eq([q([risk(15)]).level, q([risk(15)]).facts], ['warn', ['1 risque élevé']]);
    eq([q([risk(25)]).level, q([risk(25)]).headline], ['alert', 'Risque critique ouvert']);
    eq(q([risk(15), risk(16), risk(17)]).level, 'alert', 'trois risques élevés');
    eq(q([risk(4, { treatment_due: '2026-10-01' })]).level, 'warn', 'traitement en retard');
    eq(q([risk(25, { status: 'Clos' })]).level, 'ok', 'un risque clos ne compte pas');
    eq(q([risk(25, { kind: 'Opportunité' })]).level, 'none', 'une opportunité n’est pas un risque');
    const ins = (rule) => ({ rule_code: rule, status: 'Nouveau' });
    eq(q([risk(4)], [ins('MILESTONE_THREATENED')]).level, 'alert', 'jalon menacé');
    eq(q([risk(4)], [ins('WEAK_SIGNAL')]).level, 'warn');
    eq(q([risk(4)], [{ rule_code: 'MISSING_OWNER', status: 'Accepté' }]).level, 'ok', 'un constat déjà traité ne compte pas');
  });

  test('Indicateur COÛT : non renseigné, engagé face au budget externe, dépassement, GR en retard, montants masqués', () => {
    const w = lot2World();
    const bal = (external, committed, extra) => ({ totals: { budget: { total: external, external: external, internal: 0 }, po: { count: 1, committed: committed }, overrun: committed > external }, cpns: (extra && extra.cpns) || [] });
    const c = (b, o) => w.c.costKpi_(Object.assign({ balance: b, lateGr: 0, withoutBudget: 0, showAmounts: false }, o || {}));
    eq(c(null).level, 'none');
    eq([c(bal(10000, 5000)).level, c(bal(10000, 5000)).metrics.engaged_pct], ['ok', 50]);
    eq(c(bal(10000, 8600)).level, 'warn', '86 % engagé');
    eq(c(bal(10000, 1000), { lateGr: 1 }).level, 'warn', 'GR en retard');
    eq([c(bal(10000, 12000)).level, c(bal(10000, 12000)).headline], ['alert', 'Budget externe dépassé']);
    eq(c(bal(0, 500)).level, 'alert', 'engagé sans budget externe');
    ok(!/€/.test(c(bal(10000, 5000)).facts.join()), 'sans le droit budget : aucun montant');
    ok(/5 000 € sur 10 000 €/.test(c(bal(10000, 5000), { showAmounts: true }).facts.join().replace(/\s/g, ' ')), 'avec le droit budget : les montants');
    eq(c(bal(10000, 5000, { cpns: [{ cpn: 'CPN-1', overrun: true }] })).facts.some((f) => /CPN-1 : budget externe dépassé/.test(f)), true);
    eq([w.c.overallLevel_(['ok', 'warn', 'none']), w.c.overallLevel_(['ok', 'none', 'none']), w.c.overallLevel_(['none', 'none']), w.c.overallLevel_(['warn', 'alert', 'ok'])], ['warn', 'ok', 'none', 'alert']);
  });

  test('overview.get : portefeuille, détail, droits sur les montants, droit de créer', () => {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    w.call(CP, 'rates.set', { values: { profile: 'Ingénieur', country: 'FR', daily_rate: 520, effective_date: '2026-01-01' } });
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nacelle' });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 10000 } });
    w.call(CP, 'po.save', { values: { po_number: 'CB-1', cpn: 'CPN-100', resource_id: w.xavier.id, amount: 8800, status: 'Lancée', gr_due_date: '2026-12-01' }, links: [{ deliverable_id: w.cc.id, amount: 8800 }] });
    w.c.runRules();
    const cp = w.call(CP, 'overview.get', { projectId: w.p1.id });
    eq([cp.projects.map((x) => x.code), cp.selected, cp.canCreate], [['P1', 'P2'], w.p1.id, false]);
    const p1 = cp.projects[0];
    eq([p1.name, p1.manager, p1.cpn, p1.canEdit, p1.items, p1.kpis.time.level, p1.kpis.cost.level, p1.kpis.cost.metrics.engaged_pct], ['Projet 1', 'Carla', 'CPN-100', true, 4, 'alert', 'warn', 88]);
    ok(/8 800 € sur 10 000 €/.test(p1.kpis.cost.facts.join().replace(/\s/g, ' ')), 'le chef de projet voit les montants');
    const mia = w.call(MEMBER, 'overview.get', { projectId: w.p1.id });
    ok(!/€/.test(JSON.stringify(mia.projects[0].kpis.cost.facts)) && mia.projects[0].kpis.cost.metrics.engaged_pct === 88, 'un membre voit le niveau et le pourcentage, sans montant');
    eq([mia.projects[0].canEdit, mia.canCreate], [false, false]);
    eq([cp.detail.id, cp.detail.milestones.map((m) => m.name), cp.detail.people >= 3, cp.detail.alerts.every((a) => a.severity !== 'Info')], [w.p1.id, ['Revue'], true, true]);
    eq(cp.projects[1].kpis.overall, 'none', 'un projet vide n’est pas évalué');
    eq([w.call(DPL, 'overview.get', {}).canCreate, w.call(ADMIN, 'overview.get', {}).canCreate], [true, true]);
    eq(w.call(DPL, 'overview.get', { projectId: 'inconnu' }).selected, w.p1.id, 'un projet inconnu retombe sur le premier');
    ok(cp.people.length >= 4 && cp.statuses.includes('Actif') && cp.countries.includes('FR'), 'listes pour les formulaires');
  });

  test('Préchargement de l’Overview ; accueil par défaut', () => {
    const w = lot2World();
    eq(Object.keys(w.c.preloadFor_('overview', { project: '', program: '', tab: '', mode: '', isAdmin: false }, CP)), ['overview.get|{"projectId":""}']);
    eq([w.c.PAGES.overview, w.c.loadPrefs_(CP).ui.home], ['Overview', 'overview']);
    eq(w.call(CP, 'ui.set', { home: 'budget' }).home, 'budget');
  });
};
