/**
 * PPM Core — 0.10.0 : page « Overview Projet ».
 *
 *  - projects.save : crée un projet (avec son chef de projet) ou modifie son nom, son code, son statut et ses dates.
 *  - overview.get  : portefeuille des projets et détail du projet choisi, avec trois indicateurs visuels :
 *      DÉLAIS  (« on time »)    : retards, dépendances non respectées, glissement sur la baseline, fin visée, avancement réel face au plan ;
 *      QUALITÉ (« on quality ») : risques ouverts (score), traitements en retard, jalons menacés, signaux faibles, livrables sans responsable ;
 *      COÛT    (« on cost »)    : PO engagées face au budget externe par CPN, GR en retard ; les montants ne se voient qu'avec le droit budget.
 *    Chaque indicateur est Maîtrisé, en Vigilance, en Alerte ou Non renseigné. L'ensemble reprend le pire des trois.
 *  L'indicateur Qualité est une mesure de maîtrise (risques, jalons), faute de mesure de qualité propre dans l'outil : à affiner.
 * Fonctions pures : timeKpi_, qualityKpi_, costKpi_, overallLevel_.
 */

var PROJECT_STATUSES = ['Préparation', 'Actif', 'En pause', 'Clos'];
var KPI_LABELS = { ok: 'Maîtrisé', warn: 'Vigilance', alert: 'Alerte', none: 'Non renseigné' };
var KPI_RISK_CRITICAL = 20;

function pl_(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

// ---------------------------------------------------------------- indicateurs (fonctions pures)

/** Avancement attendu à la date du jour : pour chaque livrable, part du temps écoulé entre son début et sa fin, pondérée par sa durée. */
function plannedProgress_(items, today, holFor) {
  var w = 0, acc = 0;
  items.forEach(function (it) {
    if (it.item_type !== 'Livrable' || isBlank(it.planned_finish)) return;
    var d = Math.max(1, itemDuration(it, holFor(it.project_id)));
    var start = it.planned_start || it.planned_finish, finish = it.planned_finish;
    var pct = today >= finish ? 100 : today <= start ? 0 : 100 * (parseYmd(today) - parseYmd(start)) / Math.max(DAY_MS, parseYmd(finish) - parseYmd(start));
    w += d; acc += d * pct;
  });
  return w ? Math.round(acc / w) : 0;
}

/** DÉLAIS : data = { project, items, deps, baselineEnd, today, holFor }. */
function timeKpi_(d) {
  var items = d.items.filter(function (i) { return !isTrue(i.deleted); });
  if (!items.some(function (i) { return !isBlank(i.planned_finish); })) {
    return { level: 'none', label: KPI_LABELS.none, headline: 'Pas encore de planning daté', facts: [], metrics: { late: 0, violations: 0, progress_pct: 0, planned_pct: 0 } };
  }
  var hol = d.holFor(d.project.id);
  var done = function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; };
  var late = items.filter(function (i) { return !done(i) && !isBlank(i.planned_finish) && i.planned_finish < d.today; }).length;
  var violations = dependencyViolations(items, d.deps, d.holFor).length;
  var planEnd = items.reduce(function (a, i) { return !isBlank(i.planned_finish) && i.planned_finish > a ? i.planned_finish : a; }, '');
  var target = d.project.end_date || '';
  var beyond = !!target && planEnd > target;
  var slip = d.baselineEnd && planEnd ? workingDayOffset(d.baselineEnd, planEnd, hol) : null;
  var progress = weightedProgress_(items, d.holFor), planned = plannedProgress_(items, d.today, d.holFor), gap = planned - progress;
  var level = 'ok';
  if (late >= 1 || (slip !== null && slip > 0) || violations > 0 || gap >= 5) level = 'warn';
  if (beyond || (slip !== null && slip > THRESHOLDS.criticalSlipDays) || late >= 3 || gap >= 15) level = 'alert';
  var facts = [];
  if (late) facts.push(pl_(late, 'élément en retard', 'éléments en retard'));
  if (violations) facts.push(pl_(violations, 'dépendance non respectée', 'dépendances non respectées'));
  if (slip) facts.push('Fin du plan ' + (slip > 0 ? '+' : '−') + pl_(Math.abs(slip), 'jour ouvré', 'jours ouvrés') + ' sur la baseline');
  if (beyond) facts.push('Fin du plan après la fin visée (' + frDate_(target) + ')');
  if (gap >= 5) facts.push('Avancement ' + progress + ' % pour ' + planned + ' % attendus');
  var headline = level === 'ok' ? 'Planning tenu' : (beyond ? 'La fin du plan dépasse la fin visée' : late ? pl_(late, 'élément en retard', 'éléments en retard') : slip > 0 ? 'Fin du plan en glissement' : violations ? 'Dépendances à revoir' : 'Avancement en deçà du plan');
  return { level: level, label: KPI_LABELS[level], headline: headline, facts: facts, metrics: { late: late, violations: violations, slip: slip, plan_end: planEnd || null, target_end: target || null, progress_pct: progress, planned_pct: planned } };
}

/** QUALITÉ (maîtrise) : data = { project, risks, insights, items, today }. */
function qualityKpi_(d) {
  var risks = d.risks.filter(function (r) { return !isTrue(r.deleted) && r.kind !== 'Opportunité'; });
  var open = risks.filter(function (r) { return r.status !== 'Clos'; });
  var score = function (r) { return Number(r.score) || 0; };
  var high = open.filter(function (r) { return score(r) >= THRESHOLDS.riskHighMin; }).length;
  var critical = open.filter(function (r) { return score(r) >= KPI_RISK_CRITICAL; }).length;
  var overdue = open.filter(function (r) { return !isBlank(r.treatment_due) && String(r.treatment_due) < d.today; }).length;
  var count = function (rule) { return d.insights.filter(function (x) { return !isTrue(x.deleted) && x.status === 'Nouveau' && x.rule_code === rule; }).length; };
  var threatened = count('MILESTONE_THREATENED'), weak = count('WEAK_SIGNAL'), ownerless = count('MISSING_OWNER');
  var metrics = { open_risks: open.length, high_risks: high, critical_risks: critical, overdue_treatments: overdue, threatened_milestones: threatened, weak_signals: weak, no_owner: ownerless };
  if (!risks.length && !threatened && !weak && !ownerless) {
    return { level: 'none', label: KPI_LABELS.none, headline: 'Aucun risque saisi', facts: ['Le registre des risques est vide : la maîtrise ne peut pas être évaluée.'], metrics: metrics };
  }
  var level = 'ok';
  if (high > 0 || overdue > 0 || weak > 0 || ownerless > 0) level = 'warn';
  if (critical > 0 || threatened > 0 || high >= 3) level = 'alert';
  var facts = [];
  if (critical) facts.push(pl_(critical, 'risque critique', 'risques critiques'));
  if (high - critical > 0) facts.push(pl_(high - critical, 'risque élevé', 'risques élevés'));
  if (threatened) facts.push(pl_(threatened, 'jalon menacé', 'jalons menacés'));
  if (overdue) facts.push(pl_(overdue, 'traitement de risque en retard', 'traitements de risque en retard'));
  if (weak) facts.push(pl_(weak, 'signal faible dans les commentaires', 'signaux faibles dans les commentaires'));
  if (ownerless) facts.push(pl_(ownerless, 'livrable sans responsable', 'livrables sans responsable'));
  var headline = level === 'ok' ? 'Risques sous contrôle' : critical ? 'Risque critique ouvert' : threatened ? 'Jalon menacé' : high >= 3 ? 'Plusieurs risques élevés' : 'Points de vigilance';
  return { level: level, label: KPI_LABELS[level], headline: headline, facts: facts, metrics: metrics };
}

/** COÛT : data = { balance (bilan par CPN ou null), lateGr, withoutBudget, showAmounts }. Aucun montant si showAmounts est faux. */
function costKpi_(d) {
  var b = d.balance;
  if (!b || (!b.totals.budget.total && !b.totals.po.count)) {
    return { level: 'none', label: KPI_LABELS.none, headline: 'Budget non renseigné', facts: [], metrics: { engaged_pct: null } };
  }
  var ext = b.totals.budget.external, committed = b.totals.po.committed;
  var pct = ext > 0 ? Math.round(100 * committed / ext) : null;
  var cpnOverrun = b.cpns.some(function (g) { return g.overrun && g.budget && g.budget.external > 0; }); // les analyses se font par CPN : un seul dépassement compte
  var overrun = b.totals.overrun || cpnOverrun || (ext === 0 && committed > 0);
  var level = 'ok';
  if ((pct !== null && pct >= 85) || d.lateGr > 0) level = 'warn';
  if (overrun) level = 'alert';
  var facts = [];
  if (pct !== null) facts.push('Engagé : ' + pct + ' % du budget externe' + (d.showAmounts ? ' (' + eurAmount_(committed) + ' sur ' + eurAmount_(ext) + ')' : ''));
  if (ext === 0 && committed > 0) facts.push('Des PO sont engagées sans budget externe');
  b.cpns.filter(function (g) { return g.overrun && g.cpn; }).forEach(function (g) { facts.push('CPN ' + g.cpn + ' : budget externe dépassé'); });
  if (d.lateGr) facts.push(pl_(d.lateGr, 'GR en retard', 'GR en retard'));
  if (d.withoutBudget) facts.push(pl_(d.withoutBudget, 'livrable sans budget', 'livrables sans budget'));
  var headline = level === 'ok' ? 'Budget externe maîtrisé' : overrun ? (cpnOverrun && !b.totals.overrun ? 'Budget externe dépassé sur un CPN' : 'Budget externe dépassé') : d.lateGr ? 'GR en retard' : 'Budget externe bientôt consommé';
  return { level: level, label: KPI_LABELS[level], headline: headline, facts: facts, metrics: { engaged_pct: pct, late_gr: d.lateGr, without_budget: d.withoutBudget } };
}

function eurAmount_(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' €'; }

/** Le pire des trois, en ignorant « non renseigné » (qui ne l'emporte que s'il n'y a rien d'autre). */
function overallLevel_(levels) {
  var order = { none: 0, ok: 1, warn: 2, alert: 3 }, worst = 'none';
  levels.forEach(function (l) { if (order[l] > order[worst]) worst = l; });
  return worst;
}

// ---------------------------------------------------------------- données

function loadOverviewData_() {
  var data = {
    projects: repoList('Project'), programs: repoList('Program'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'), resources: repoList('Resource'), insights: repoList('Insight'), risks: repoList('RiskOpportunity'),
    lines: repoList('BudgetLine'), orders: attachLinks_(repoList('PurchaseOrder')), holidaySets: repoList('HolidaySet')
  };
  data.holFor = holidayResolver(data);
  return data;
}

function baselineEndOf_(project) {
  var b = activeBaselineOf_(project);
  if (!b) return '';
  var end = '';
  Object.keys(b.snap.PlanItem || {}).forEach(function (id) { var f = b.snap.PlanItem[id].planned_finish; if (!isBlank(f) && f > end) end = f; });
  return end;
}

/** Indicateurs d'un projet à partir des données déjà chargées. */
function projectKpis_(data, project, today, ctx) {
  var items = data.planitems.filter(function (i) { return i.project_id === project.id; });
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var deps = data.dependencies.filter(function (x) { return ids[x.predecessor_id] && ids[x.successor_id]; });
  var wps = data.workpackages.filter(function (w) { return w.project_id === project.id; });
  var lines = data.lines.filter(function (l) { return ids[l.deliverable_id]; });
  var pos = projectOrdersFrom_(data.orders, project, wps);
  var deliverables = items.filter(function (i) { return i.item_type === 'Livrable'; });
  var hasLine = {}; lines.forEach(function (l) { hasLine[l.deliverable_id] = true; });
  var balance = lines.length || pos.length ? computeBalance_({ project: project, wps: wps, items: deliverables, lines: lines, pos: pos }) : null;
  var lateGr = pos.filter(function (o) { return o.status === 'Lancée' && !isBlank(o.gr_due_date) && String(o.gr_due_date) < today; }).length;
  var showAmounts = !!ctx && (ctx.isAdmin || can(ctx, 'budget.edit', { type: 'project', id: project.id }));
  var time = timeKpi_({ project: project, items: items, deps: deps, baselineEnd: baselineEndOf_(project), today: today, holFor: data.holFor });
  var quality = qualityKpi_({ project: project, risks: data.risks.filter(function (r) { return r.project_id === project.id; }), insights: data.insights.filter(function (x) { return x.project_id === project.id; }), items: items, today: today });
  var cost = costKpi_({ balance: balance, lateGr: lateGr, withoutBudget: lines.length ? deliverables.filter(function (i) { return !hasLine[i.id]; }).length : 0, showAmounts: showAmounts });
  return { time: time, quality: quality, cost: cost, overall: overallLevel_([time.level, quality.level, cost.level]) };
}

/** PO d'un projet à partir d'une liste déjà chargée (même règle que projectOrders_ : par CPN du projet et de ses sous-projets). */
function projectOrdersFrom_(orders, project, wps) {
  var set = {};
  projectCpns_(project, wps).forEach(function (c) { set[c.cpn] = true; });
  return orders.filter(function (o) { return set[normCpn_(o.cpn)]; });
}

function projectSummary_(data, project, today, ctx) {
  var res = indexBy_(data.resources), programs = indexBy_(data.programs);
  var manager = res[project.manager_resource_id];
  var items = data.planitems.filter(function (i) { return i.project_id === project.id && !isTrue(i.deleted); });
  var done = items.filter(function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; }).length;
  return {
    id: project.id, code: project.code, name: project.name, status: project.status || '', version: project.version,
    program: project.program_id && programs[project.program_id] ? programs[project.program_id].name : '',
    manager: manager ? manager.name : '', cpn: project.cpn || '', cpn_label: project.cpn_label || '',
    start_date: project.start_date || '', target_end: project.end_date || '', items: items.length, done: done,
    canEdit: !!ctx && can(ctx, 'wbs.edit', { type: 'project', id: project.id }),
    kpis: projectKpis_(data, project, today, ctx)
  };
}

// ---------------------------------------------------------------- actions

/** Portefeuille (tous les projets) et détail du projet demandé (ou du premier projet actif). */
defineAction('overview.get', function (p, ctx) {
  var today = todayStr();
  var data = loadOverviewData_();
  var order = { Actif: 0, 'Préparation': 1, 'En pause': 2, Clos: 3 };
  var projects = data.projects.slice().sort(function (a, b) {
    return ((order[a.status] === undefined ? 1 : order[a.status]) - (order[b.status] === undefined ? 1 : order[b.status])) || String(a.code).localeCompare(String(b.code), 'fr', { numeric: true });
  });
  var summaries = projects.map(function (pr) { return projectSummary_(data, pr, today, ctx); });
  var chosen = summaries.filter(function (s) { return s.id === p.projectId; })[0] || summaries[0] || null;
  var detail = null;
  if (chosen) {
    var pr = indexBy_(data.projects)[chosen.id];
    var items = data.planitems.filter(function (i) { return i.project_id === pr.id && !isTrue(i.deleted); });
    var done = function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; };
    var horizon = addCalendarDays(today, 90);
    detail = {
      id: chosen.id,
      milestones: items.filter(function (i) { return i.item_type === 'Jalon' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today && i.planned_finish <= horizon; })
        .sort(function (a, b) { return String(a.planned_finish).localeCompare(String(b.planned_finish)); }).slice(0, 4)
        .map(function (m) { return { name: m.name, date: m.planned_finish, in_days: Math.round((parseYmd(m.planned_finish) - parseYmd(today)) / DAY_MS) }; }),
      alerts: data.insights.filter(function (x) { return x.project_id === pr.id && !isTrue(x.deleted) && x.status === 'Nouveau' && x.severity !== 'Info'; })
        .sort(function (a, b) { return (a.severity === 'Alerte' ? 0 : 1) - (b.severity === 'Alerte' ? 0 : 1); }).slice(0, 5)
        .map(function (x) { return { severity: x.severity, message: x.message }; }),
      people: projectMemberIds_({ projects: data.projects, workpackages: data.workpackages, planitems: data.planitems, resources: data.resources, assignments: repoList('RoleAssignment') }, pr.id, today).length
    };
  }
  var programs = data.programs.map(function (g) { return { id: g.id, code: g.code, name: g.name }; });
  var canCreate = ctx.isAdmin || can(ctx, 'project.create', { type: 'global' });
  return { today: today, projects: summaries, selected: chosen ? chosen.id : '', detail: detail, programs: programs, canCreate: canCreate,
    people: data.resources.filter(function (r) { return r.resource_type === 'Interne'; }).map(function (r) { return { id: r.id, name: r.name }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }), countries: COUNTRIES, statuses: PROJECT_STATUSES };
});

function projectCode_(v, currentId) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le code du projet est obligatoire.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,19}$/.test(s)) throw new PpmError('VALIDATION', 'Code invalide : 20 caractères au plus, lettres, chiffres, espace, point, tiret, barre oblique.');
  if (repoList('Project', function (x) { return x.id !== currentId && String(x.code).toLowerCase() === s.toLowerCase(); }).length) {
    throw new PpmError('VALIDATION', 'Le code ' + s + ' est déjà utilisé par un autre projet.');
  }
  return s;
}

/**
 * Crée un projet (droit project.create), avec son chef de projet s'il est désigné ; ou modifie nom, code, statut et dates d'un projet
 * existant (droit d'édition du projet). id vide = création.
 */
defineAction('projects.save', function (p, ctx) {
  var v = p.values || {};
  var cur = isBlank(p.id) ? null : mustGet('Project', p.id);
  return withLock(function () {
    var out = {};
    if (!cur || 'name' in v) out.name = wbsName_(v.name);
    if (!cur || 'code' in v) out.code = projectCode_(v.code, cur ? cur.id : '');
    if ('status' in v || !cur) {
      var st = isBlank(v.status) ? 'Actif' : v.status;
      if (PROJECT_STATUSES.indexOf(st) < 0) throw new PpmError('VALIDATION', 'Statut inconnu : ' + PROJECT_STATUSES.join(', ') + '.');
      out.status = st;
    }
    var start = 'start_date' in v ? wbsDate_(v.start_date, 'Début') : (cur ? cur.start_date || '' : '');
    var end = 'end_date' in v ? wbsDate_(v.end_date, 'Fin visée') : (cur ? cur.end_date || '' : '');
    if (start && end && start > end) throw new PpmError('VALIDATION', 'La fin visée ne peut pas précéder le début.');
    if ('start_date' in v || !cur) out.start_date = start;
    if ('end_date' in v || !cur) out.end_date = end;
    if (cur) {
      requireCan(ctx, 'wbs.edit', { type: 'project', id: cur.id });
      var rec0 = repoUpdate('Project', cur.id, out, p.version, ctx.actx);
      return { id: rec0.id, version: rec0.version, code: rec0.code, name: rec0.name, created: false };
    }
    if (!isBlank(v.program_id)) mustGet('Program', v.program_id);
    requireCan(ctx, 'project.create', isBlank(v.program_id) ? { type: 'global' } : { type: 'program', id: v.program_id });
    var manager = '';
    if (!isBlank(v.manager_resource_id)) {
      var m = repoGet('Resource', v.manager_resource_id);
      if (!m || isTrue(m.deleted) || m.resource_type !== 'Interne') throw new PpmError('VALIDATION', 'Le chef de projet doit être une personne interne.');
      manager = m.id;
    }
    var country = isBlank(v.holiday_country) ? 'FR' : v.holiday_country;
    if (COUNTRIES.indexOf(country) < 0) throw new PpmError('VALIDATION', 'Pays inconnu : ' + COUNTRIES.join(', ') + '.');
    var cpn = checkCpnValue_(v.cpn);
    assertCpnFree_(cpn, '');
    var rec = repoInsert('Project', Object.assign(out, {
      program_id: isBlank(v.program_id) ? '' : v.program_id, manager_resource_id: manager, holiday_country: country,
      cpn: cpn, cpn_label: cpn ? wbsShortText_(v.cpn_label, 120, 'Désignation du CPN') : ''
    }), ctx.actx);
    if (manager) repoInsert('RoleAssignment', { resource_id: manager, role_code: 'CP', scope_type: 'project', scope_id: rec.id, start_date: todayStr() }, ctx.actx);
    return { id: rec.id, version: rec.version, code: rec.code, name: rec.name, created: true };
  });
});
