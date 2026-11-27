/**
 * PPM Core — 0.21.0 : le PLAN BUDGÉTAIRE, vu comme UN tableau.
 *
 * Une ligne par livrable, une colonne par équipe (plus la colonne « Externe »), le montant annuel d'une cellule est la part d'une équipe sur un livrable (BudgetLine). Tout le reste se déduit :
 *   - le total d'un workpackage, d'un sous-workpackage, d'une équipe et du projet : les SOMMES du plan (il n'y a plus d'enveloppe saisie) ;
 *   - la dotation de chaque équipe (saisie, 60_Exercise.gs) et l'écart : plan contre dotation (le « clash » quand le plan la dépasse) ;
 *   - le suivi, l'atterrissage et l'indicateur de coût (64_ExerciseTracking.gs, 45_Overview.gs) lisent le même plan.
 * Il n'y a pas de dimension de temps : un montant est annuel, et un livrable n'appartient qu'à un exercice.
 *
 * QUI. Une cellule se saisit avec le droit « budget.edit » sur le livrable (le responsable du livrable, du sous-workpackage, du workpackage, le chef de projet). Chacun ne voit que ses livrables ;
 * le chef de projet voit tout. Toute modification est un changement à valider par le niveau du dessus (54_Validation.gs).
 */

/**
 * LES VERSIONS DU PLAN BUDGÉTAIRE (0.20.0, reprises en 0.21.0). Le plan qu'on édite est la « version en cours » (brouillon). Chaque baseline du projet le FIGE (cellules livrable × équipe et dotations) : elle devient une version (V0, V1…, nommée comme la
 * baseline). Le SUIVI ne lit pas le brouillon : il lit la version de RÉFÉRENCE, c'est-à-dire la dernière baseline VALIDÉE (ou qui n'avait pas à l'être : figée au niveau le plus haut). Tant qu'une
 * nouvelle version n'est pas validée, elle n'est pas prise en compte dans le suivi. Un projet sans aucune baseline validée suit la version en cours, et la page le dit.
 */
function decompVersions_(project) {
  var rows = repoList('Baseline', function (b) { return b.project_id === project.id && isBlank(b.scope_type) && (b.status === 'Active' || b.status === 'Archivée'); })
    .sort(function (a, b) { return (Number(a.number) || 0) - (Number(b.number) || 0); });
  var frozen = {}; repoList('ChangeEvent', function (e) { return e.project_id === project.id && e.field === 'baseline_frozen'; }).forEach(function (e) { frozen[e.entity_id] = e; });
  var assignments = repoList('RoleAssignment', function (a) { return roleActive_(a, todayStr()); }), names = {}; repoList('Resource').forEach(function (r) { names[r.id] = r.name; });
  var lookup = repoLookup_(), list = rows.map(function (b) {
    var ev = frozen[b.id], validation = !ev || eventRank_(ev) <= 0 ? '' : (isTrue(ev.acknowledged) ? 'validated' : 'pending');
    return { id: b.id, label: b.label || ('B' + b.number), number: Number(b.number) || 0, status: b.status, validation: validation, decided_at: b.decided_at || '', decided_by: b.decided_by || '',
      validators: validation === 'pending' ? validatorNamesFor_(eventRank_(ev), eventScope_(ev) || { type: 'project', id: project.id }, assignments, lookup, names) : [], snapshot: true };
  });
  var ref = null; list.forEach(function (v) { if (v.validation !== 'pending') ref = v; });
  list.forEach(function (v) { v.is_reference = !!ref && ref.id === v.id; });
  return { list: list, reference: ref };
}
/** La version demandée : 'live' (ou rien) = la version en cours ; 'ref' = la version de référence du suivi (à défaut, la version en cours) ; ou l'identifiant d'une baseline du projet. */
function resolveDecompVersion_(project, wanted) {
  var vs = decompVersions_(project), w = String(wanted || 'live'), picked = null, fallback = false;
  if (w === 'ref') { picked = vs.reference; fallback = !picked; }
  else if (w !== 'live') { picked = vs.list.filter(function (v) { return v.id === w; })[0]; if (!picked) throw new PpmError('NOT_FOUND', 'Version introuvable.'); }
  return { version: picked, list: vs.list, reference: vs.reference, fallback: fallback };
}
/** Les données d'un plan : la version en cours (le dépôt) ou une version figée (l'instantané d'une baseline ; l'avancement et le statut des livrables restent ceux d'aujourd'hui). */
function decompDataset_(project, ex, version) {
  var pid = project.id, liveItems = repoList('PlanItem', function (i) { return i.project_id === pid; });
  if (version && version.snapshot) {
    var snap = loadBaselineSnapshot_(version.id), liveById = indexBy_(liveItems), lines = [];
    var wps = Object.keys(snap.WorkPackage || {}).map(function (id) { return Object.assign({ id: id, project_id: pid, version: '' }, snap.WorkPackage[id]); });
    var items = Object.keys(snap.PlanItem || {}).map(function (id) { var l = liveById[id] || {}; return Object.assign({ id: id, project_id: pid, version: '', status: l.status || '', progress_pct: l.progress_pct || 0 }, snap.PlanItem[id]); });
    Object.keys(snap.BudgetLine || {}).forEach(function (id) {
      var b = snap.BudgetLine[id];
      lines.push({ id: id, deliverable_id: b.deliverable_id, team_id: b.team_id || '', resource_id: b.resource_id || '', cost_type: b.cost_type, planned_amount: b.planned_amount, fixed_amount: b.fixed_amount });
    });
    var budgets = Object.keys(snap.TeamBudget || {}).map(function (id) { return Object.assign({ id: id, project_id: pid }, snap.TeamBudget[id]); });
    return { snapshot: true, versionInfo: version, wps: wps, items: items, lines: lines, teamBudgets: budgets, projectRec: Object.keys(snap.Project || {}).map(function (k) { return snap.Project[k]; })[0] || {} };
  }
  var ids = {}; liveItems.forEach(function (i) { ids[i.id] = true; });
  return { snapshot: false, versionInfo: null, wps: repoList('WorkPackage', function (w) { return w.project_id === pid; }), items: liveItems,
    lines: repoList('BudgetLine', function (l) { return !!ids[l.deliverable_id]; }), teamBudgets: repoList('TeamBudget', function (b) { return b.project_id === pid; }), projectRec: project };
}

/** Les données d'un exercice dans la forme de `exerciseData_` (60_Exercise.gs), lues dans la version en cours ou dans une version figée. */
function planData_(D, ex, project) {
  var teams = repoList('HierarchicalTeam');
  var items = D.items.filter(function (i) { return i.item_type === 'Livrable' && i.exercise_id === ex.id; }), itemById = indexBy_(items);
  return { teams: teams, teamById: indexBy_(teams), items: items, itemById: itemById,
    budgets: D.teamBudgets.filter(function (b) { return b.exercise_id === ex.id && b.project_id === project.id; }),
    lines: D.lines.filter(function (l) { return l.cost_type === 'Équipe' && itemById[l.deliverable_id]; }) };
}

/** L'exercice demandé, à défaut celui en exécution, à défaut celui en préparation. */
function planExercise_(p) {
  if (!isBlank(p.exerciseId)) return mustGet('Exercise', p.exerciseId);
  var all = repoList('Exercise', function (x) { return !isTrue(x.deleted); });
  var ex = all.filter(function (x) { return x.status === 'Exécution'; })[0] || all.filter(function (x) { return x.status === 'Préparation'; })[0] || null;
  if (!ex) throw new PpmError('NOT_FOUND', 'Aucun exercice : l’administrateur crée l’exercice de l’année (page Administration) avant que le budget se répartisse.');
  return ex;
}

/**
 * Le plan budgétaire d'un projet pour un exercice. `rows` : les workpackages (totaux = sommes) et leurs livrables, dans l'ordre du découpage, chacun avec ses cellules par équipe (`cells`), son
 * forfait externe, son total. `columns` : les équipes qui ont une part. `summary` : dotation · plan · écart par équipe (qui lit l'exercice). Les livrables hors de la vue de la personne sont absents.
 */
function planView_(ctx, project, ex, version, reference) {
  etpReset_();
  var access = budgetAccess_(ctx, project.id);
  if (!access.budget) throw new PpmError('FORBIDDEN', 'Le budget est réservé aux responsables de budget du projet.');
  var D = decompDataset_(project, ex, version), data = planData_(D, ex, project), wps = D.wps, wpById = indexBy_(wps);
  var canEditItem = function (i) { return access.all || can(ctx, 'budget.edit', { type: 'planitem', id: i.id }); };
  var shown = data.items.filter(canEditItem), shownById = indexBy_(shown);
  var resById = indexBy_(repoList('Resource')), teamById = data.teamById;
  var partsBy = {}, forfaitsBy = {};
  D.lines.forEach(function (l) {
    if (!shownById[l.deliverable_id]) return;
    if (l.cost_type === 'Forfait') (forfaitsBy[l.deliverable_id] = forfaitsBy[l.deliverable_id] || []).push(l);
    else (partsBy[l.deliverable_id] = partsBy[l.deliverable_id] || []).push(l);
  });
  var colIds = {};
  Object.keys(partsBy).forEach(function (id) { partsBy[id].forEach(function (l) { if (l.team_id) colIds[l.team_id] = true; }); });
  if (access.exercise) data.budgets.forEach(function (b) { if (!isBlank(b.amount)) colIds[b.team_id] = true; });
  var columns = Object.keys(colIds).map(function (id) {
    var t = teamById[id], par = t && !isBlank(t.parent_team_id) ? teamById[t.parent_team_id] : null, lvl = t ? teamLevel_(t) : 0;
    var root = lvl === 4 && par && teamLevel_(par) === 3 ? par : t;
    return { team_id: id, name: t ? t.name : '(équipe supprimée)', level: lvl, country: t ? (t.country || 'FR') : '', root_id: root ? root.id : id, root_name: root ? root.name : '' };
  }).sort(function (a, b) { return String(a.root_name).localeCompare(String(b.root_name), 'fr') || a.level - b.level || String(a.name).localeCompare(String(b.name), 'fr'); });
  // le CPN d'un livrable : celui du workpackage le plus proche qui en porte un, à défaut celui du projet
  var cpnOfWp = function (wid) { var guard = 0, w = wid ? wpById[wid] : null; while (w && guard++ < 50) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; } return normCpn_(project.cpn); };
  var delivRow = function (i) {
    var cells = {}, total = 0, ext = 0;
    (partsBy[i.id] || []).forEach(function (l) { var a = Number(l.planned_amount) || 0; cells[l.team_id] = round2((cells[l.team_id] || 0) + a); total = round2(total + a); });
    var forfaits = (forfaitsBy[i.id] || []).map(function (l) { var a = Number(l.planned_amount) || 0, r = resById[l.resource_id]; ext = round2(ext + a); return { line_id: l.id, version: l.version, resource_id: l.resource_id || '', resource: r ? r.name : '', amount: a }; });
    var owner = resById[i.owner_resource_id];
    return { kind: 'deliverable', id: i.id, version: i.version, wp_id: i.wp_id || '', cpn: cpnOfWp(i.wp_id), name: i.name, owner: owner ? owner.name : '', start: i.planned_start || null, finish: i.planned_finish || null,
      status: i.status || '', progress: Number(i.progress_pct) || 0, cells: cells, external: ext, forfaits: forfaits, total: round2(total + ext),
      can_edit: ex.status !== 'Clos' && !D.snapshot && canEditItem(i) };
  };
  var delivByWp = {}, noWp = [];
  shown.forEach(function (i) { var r = delivRow(i); if (i.wp_id && wpById[i.wp_id]) (delivByWp[i.wp_id] = delivByWp[i.wp_id] || []).push(r); else noWp.push(r); });
  var byStart = function (a, b) { return String(a.start || '9999').localeCompare(String(b.start || '9999')) || String(a.name).localeCompare(String(b.name), 'fr'); };
  var kids = {}; wps.forEach(function (w) { if (w.parent_wp_id && wpById[w.parent_wp_id]) (kids[w.parent_wp_id] = kids[w.parent_wp_id] || []).push(w); });
  var codeOrder = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  var wpVisible = function (w) { return access.all || can(ctx, 'budget.edit', { type: 'workpackage', id: w.id }); };
  var rows = [], sums = {};
  var addSum = function (acc, r) { Object.keys(r.cells).forEach(function (t) { acc.cells[t] = round2((acc.cells[t] || 0) + r.cells[t]); }); acc.external = round2(acc.external + r.external); acc.total = round2(acc.total + r.total); };
  var walk = function (w, depth) {
    var mine = (delivByWp[w.id] || []).sort(byStart), acc = { cells: {}, external: 0, total: 0 }, sub = [];
    mine.forEach(function (r) { addSum(acc, r); });
    var start = rows.length;
    rows.push(null);   // la place du workpackage : ses totaux ne sont connus qu'après ses sous-workpackages
    mine.forEach(function (r) { r.depth = depth + 1; rows.push(r); });
    (kids[w.id] || []).sort(codeOrder).forEach(function (k) { var s = walk(k, depth + 1); if (s) addSum(acc, s); });
    var any = mine.length || rows.length > start + 1 + mine.length;
    if (!any && !wpVisible(w)) { rows.splice(start, 1); return null; }
    rows[start] = { kind: 'wp', wp_id: w.id, version: w.version, code: w.wbs_code || '', name: w.name, depth: depth, parent_id: w.parent_wp_id || '', cells: acc.cells, external: acc.external, total: acc.total, cpn: w.cpn || '' };
    sums[w.id] = acc;
    return acc;
  };
  wps.filter(function (w) { return isBlank(w.parent_wp_id) || !wpById[w.parent_wp_id]; }).sort(codeOrder).forEach(function (w) { walk(w, 0); });
  if (noWp.length && access.all) {
    var accN = { cells: {}, external: 0, total: 0 };
    noWp.sort(byStart).forEach(function (r) { addSum(accN, r); });
    rows.push({ kind: 'wp', wp_id: '', version: '', code: '', name: 'Sans workpackage', depth: 0, parent_id: '', cells: accN.cells, external: accN.external, total: accN.total, cpn: '' });
    noWp.forEach(function (r) { r.depth = 1; rows.push(r); });
  }
  var totals = { cells: {}, external: 0, total: 0 };
  rows.forEach(function (r) { if (r.kind === 'deliverable') addSum(totals, r); });
  var out = {
    exercise: { id: ex.id, year: Number(ex.year), status: ex.status }, version: D.versionInfo, can_edit: ex.status !== 'Clos' && !D.snapshot,
    project: { id: project.id, code: project.code, name: project.name, version: project.version }, partial: !access.all,
    columns: columns, rows: rows, totals: totals, teams: exerciseTeamChoices_(data.teams), deliverables: shown.length
  };
  if (access.exercise) {
    out.summary = exerciseTable_(ex, data, project.id);
    var countries = {}; out.summary.rows.concat(out.summary.orphans, out.summary.unruled).forEach(function (r) { countries[r.country] = true; });
    out.etp_missing = Object.keys(countries).filter(function (c) { return etpCostOf_(c, Number(ex.year)) === null; }).sort();
    out.can_set_dotation = !D.snapshot && ex.status !== 'Clos' && (ctx.isAdmin || can(ctx, 'exercise.edit', { type: 'project', id: project.id }));
  }
  // les livrables sans exercice : à rattacher (bouton de la page) ; ils ne comptent dans aucun exercice
  out.unassigned = D.snapshot ? [] : repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable' && isBlank(i.exercise_id) && canEditItem(i); })
    .map(function (i) { return { id: i.id, name: i.name, wp: i.wp_id && wpById[i.wp_id] ? wpById[i.wp_id].name : '' }; });

  // l'évolution depuis la baseline de RÉFÉRENCE (celle que lit le suivi, 0.21.1) : ce que le plan valait quand on l'a figée, pour CET exercice.
  // `reference` : undefined = les versions n'ont pas été lues (onglets d'exploitation légers) : on se rabat sur la baseline active ; false = aucune baseline validée : pas de comparaison.
  var bl = reference === undefined ? (isBlank(project.active_baseline_id) ? null : repoGet('Baseline', project.active_baseline_id)) : (reference ? repoGet('Baseline', reference.id) : null);
  if (!D.snapshot && bl && (reference ? true : bl.status === 'Active') && isBlank(bl.scope_type)) {
    var snap = loadBaselineSnapshot_(bl.id), exOfNow = {};
    repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }).forEach(function (i) { exOfNow[i.id] = i.exercise_id || ''; });
    var inEx = function (it, id) { return ('exercise_id' in it ? it.exercise_id : exOfNow[id]) === ex.id; };
    var bitem = budgetByItem_(snap), baseTotal = 0;
    Object.keys(snap.BudgetLine || {}).forEach(function (id) { var bline = snap.BudgetLine[id], it = (snap.PlanItem || {})[bline.deliverable_id]; if (it && inEx(it, bline.deliverable_id)) baseTotal = round2(baseTotal + (Number(bline.planned_amount) || 0)); });
    out.baseline = { id: bl.id, label: bl.label || ('B' + bl.number), number: Number(bl.number) || 0, decided_at: bl.decided_at || '' };
    rows.forEach(function (r) { if (r.kind === 'deliverable') r.base = (snap.PlanItem || {})[r.id] ? { total: bitem[r.id] || 0 } : { new: true }; });
    out.totals.base_total = baseTotal; out.totals.base_known = true;
    if (out.summary) {
      var baseDot = {}, hasBase = 'TeamBudget' in snap;
      Object.keys(snap.TeamBudget || {}).forEach(function (id) { var b = snap.TeamBudget[id]; if (b.exercise_id === ex.id && !isBlank(b.amount)) baseDot[b.team_id] = round2((baseDot[b.team_id] || 0) + Number(b.amount)); });
      out.summary.base_known = hasBase;
      out.summary.rows.concat(out.summary.orphans, out.summary.unruled).forEach(function (r) {
        var s = baseDot[r.team_id] || 0, any = r.team_id in baseDot; r.children.forEach(function (c) { if (c.team_id in baseDot) { any = true; s += baseDot[c.team_id]; } });
        r.base_dotation = hasBase && any ? round2(s) : null;
      });
    }
  }
  return out;
}

/** Les versions du plan (baselines du projet) et celle que le suivi lit : à la demande, car elles lisent le journal des changements (volumineux) — le tableau, lui, s'ouvre sans. */
function planVersionsView_(ctx, project, rv) {
  var out = {};
  out.versions = rv.list.map(function (v) { return { id: v.id, label: v.label, number: v.number, status: v.status, validation: v.validation, validators: v.validators, decided_at: v.decided_at, decided_by: v.decided_by, is_reference: v.is_reference }; });
  out.reference_id = rv.reference ? rv.reference.id : '';
  out.fallback_live = rv.fallback;
  out.can_version = !!(ctx.isAdmin || can(ctx, 'baseline.manage', { type: 'project', id: project.id }));   // figer une nouvelle version = figer une baseline du projet
  var pend = rv.list.filter(function (v) { return v.validation === 'pending'; });
  out.pending_version = pend.length ? { id: pend[pend.length - 1].id, label: pend[pend.length - 1].label, validators: pend[pend.length - 1].validators } : null;
  return out;
}

defineAction('budget.plan.get', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId')), ex = planExercise_(p);
  // sans version demandée : le brouillon, sans lire baselines ni journal (la page s'ouvre en peu d'appels) ; `version` ou `withVersions` : la version, et la liste des versions
  var rv = (isBlank(p.version) && !isTrue(p.withVersions)) ? null : resolveDecompVersion_(project, p.version);
  var view = planView_(ctx, project, ex, rv ? rv.version : null, rv ? rv.reference || false : undefined);
  if (rv) Object.assign(view, planVersionsView_(ctx, project, rv));
  view.exercises = repoList('Exercise', function (x) { return !isTrue(x.deleted); }).map(exerciseView_).sort(function (a, b) { return b.year - a.year; });
  return view;
});

defineAction('budget.plan.versions', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!budgetAccess_(ctx, project.id).budget) throw new PpmError('FORBIDDEN', 'Le budget de ce projet n’est pas pour vous.');
  return planVersionsView_(ctx, project, resolveDecompVersion_(project, p.version));
});
