/**
 * PPM Core — 0.15.3 : budget par workpackage, de haut en bas.
 *
 * Le chef de projet fixe l'ENVELOPPE AUTORISÉE du projet (`Project.budget_authorized`) et la répartit entre les workpackages (`WorkPackage.budget_allocated`) ; le Workpackage
 * leader répartit à son tour la sienne entre ses sous-workpackages. Les lignes de budget des livrables (page Budget, « Budget par livrable ») restent la mesure du coût prévu :
 * la page les met en regard de l'enveloppe, workpackage par workpackage.
 *
 * RÈGLES. (0.19.2) On peut écrire des enveloppes qui DÉPASSENT la somme autorisée : celles des sous-workpackages au-delà de leur workpackage, celles des workpackages au-delà du budget du projet, le coût
 * des livrables au-delà d'une enveloppe. Rien n'est bloqué : c'est signalé par l'état « En dépassement » (en rouge), parce que ces montants sont une information vraie qu'on ne refuse pas de saisir.
 * Une seule règle reste : un sous-workpackage ne reçoit rien tant que son parent n'a pas d'enveloppe. Une enveloppe non fixée (vide) veut dire « pas de plafond », pas zéro.
 * La page Budget affiche la DÉCOMPOSITION DU BUDGET : workpackages, sous-workpackages, puis leurs livrables et jalons, dans un seul tableau (`items` de budget.envelope.get).
 *
 * QUI. Fixer l'enveloppe du projet et celles des workpackages de premier niveau : `budget.authorize` (chef de projet et au-dessus). Celle d'un sous-workpackage : un niveau strictement
 * supérieur au sien sur le workpackage parent (son Workpackage leader, et au-dessus). Chacun ne voit que ce qui relève de son budget : un Workpackage leader, son workpackage seulement.
 * Toute modification est un changement à valider par le niveau du dessus (54_Validation.gs).
 */

/** Les enveloppes ne s'écrivent que par budget.envelope.set : on les retire de ce que les écritures génériques reçoivent. */
function stripEnvelope_(obj) {
  var out = Object.assign({}, obj || {});
  delete out.budget_authorized; delete out.budget_allocated; delete out.envelopes_json;
  return out;
}

/**
 * ENVELOPES PAR EXERCICE (0.19.3). Un exercice est une année, avec ses propres livrables : l'enveloppe du projet et celle de chaque workpackage sont donc propres à un exercice, et rien d'un exercice
 * ne se mêle à l'autre (le suivi de l'année en cours et l'opération de planification de la suivante sont étanches). Stockage : `envelopes_json` { identifiant d'exercice : montant } sur le projet et sur
 * le workpackage ; les anciens champs budget_authorized et budget_allocated ne sont plus lus.
 */
/** La clé d'un exercice dans envelopes_json : « année:identifiant » (l'année se lit sans aller chercher l'exercice : le fil des changements la montre telle quelle). */
function envKey_(ex) { return String(ex.year) + ':' + ex.id; }
function envJson_(rec) { var o = parseJsonSafe(rec.envelopes_json, {}); return o && typeof o === 'object' ? o : {}; }
function envAmount_(rec, exerciseId) { var j = envJson_(rec); return Object.prototype.hasOwnProperty.call(j, exerciseId) && !isBlank(j[exerciseId]) ? Number(j[exerciseId]) : null; }
function envPatch_(rec, exerciseId, amount) {
  var j = envJson_(rec);
  if (amount === '' || amount === null || amount === undefined) delete j[exerciseId]; else j[exerciseId] = amount;
  return { envelopes_json: Object.keys(j).length ? JSON.stringify(j) : '' };
}
/** L'exercice demandé, à défaut celui en exécution, à défaut celui en préparation. */
function envelopeExercise_(p) {
  if (!isBlank(p.exerciseId)) return mustGet('Exercise', p.exerciseId);
  var all = repoList('Exercise', function (x) { return !isTrue(x.deleted); });
  var ex = all.filter(function (x) { return x.status === 'Exécution'; })[0] || all.filter(function (x) { return x.status === 'Préparation'; })[0] || null;
  if (!ex) throw new PpmError('NOT_FOUND', 'Aucun exercice : l’administrateur crée l’exercice de l’année (page Administration) avant que le budget se répartisse.');
  return ex;
}

function envNumber_(v, label) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new PpmError('VALIDATION', label + ' : un montant en euros, positif ou nul (ou vide pour « pas de plafond »).');
  return round2(n);
}

/** Peut-on fixer l'enveloppe de ce workpackage ? Un niveau strictement supérieur au sien, sur son parent (le projet pour un workpackage de premier niveau). */
function canAllocateWp_(ctx, wp) {
  if (ctx.isAdmin) return true;
  if (isBlank(wp.parent_wp_id)) return can(ctx, 'budget.authorize', { type: 'project', id: wp.project_id });
  return bestRankOn_(ctx, { type: 'workpackage', id: wp.parent_wp_id }) < ROLE_RANK.SWPL;
}

/** Coût prévu par workpackage (lui et tout ce qu'il contient) et hors workpackage, à partir des lignes de budget des livrables du projet. */
function envelopeCosts_(projectId, wpById, exerciseId) {
  var cost = {}, none = 0;
  var items = indexBy_(repoList('PlanItem', function (i) { return i.project_id === projectId && i.item_type === 'Livrable' && (isBlank(exerciseId) || i.exercise_id === exerciseId); }));
  repoList('BudgetLine', function (l) { return !!items[l.deliverable_id]; }).forEach(function (l) {
    var amount = Number(l.planned_amount) || 0, w = items[l.deliverable_id].wp_id ? wpById[items[l.deliverable_id].wp_id] : null, guard = 0;
    if (!w) { none = round2(none + amount); return; }
    while (w && guard++ < 5) { cost[w.id] = round2((cost[w.id] || 0) + amount); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
  });
  return { byWp: cost, none: none };
}

function envelopeView_(ctx, project, ex) {
  var access = budgetAccess_(ctx, project.id);
  if (!access.budget) throw new PpmError('FORBIDDEN', 'Le budget est réservé aux responsables de budget du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps), costs = envelopeCosts_(project.id, wpById, ex.id);
  var visible = function (w) { return access.all || can(ctx, 'budget.edit', { type: 'workpackage', id: w.id }); };
  var num = function (v) { return isBlank(v) ? null : Number(v); };
  var kids = {}; wps.forEach(function (w) { if (w.parent_wp_id) (kids[w.parent_wp_id] = kids[w.parent_wp_id] || []).push(w); });
  var rows = [];
  var order = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  var walk = function (w, depth) {
    if (visible(w)) {
      var alloc = envAmount_(w, envKey_(ex)), cost = costs.byWp[w.id] || 0;
      var childSum = round2((kids[w.id] || []).reduce(function (s, k) { return s + (envAmount_(k, envKey_(ex)) || 0); }, 0));
      rows.push({
        wp_id: w.id, version: w.version, code: w.wbs_code || '', name: w.name, parent_id: w.parent_wp_id && visible(wpById[w.parent_wp_id] || {}) ? w.parent_wp_id : '', depth: depth,
        allocated: alloc, cost: cost, remaining: alloc === null ? null : round2(alloc - cost), over: alloc !== null && (cost > alloc || childSum > alloc),
        over_cost: alloc !== null && cost > alloc, over_alloc: alloc !== null && (kids[w.id] || []).length > 0 && childSum > alloc,
        over_by: alloc === null ? 0 : round2(Math.max(0, cost - alloc, (kids[w.id] || []).length ? childSum - alloc : 0)),
        children_allocated: childSum, unallocated: alloc === null || !(kids[w.id] || []).length ? null : round2(alloc - childSum), canSet: canAllocateWp_(ctx, w)
      });
    }
    (kids[w.id] || []).sort(order).forEach(function (k) { walk(k, depth + 1); });
  };
  wps.filter(function (w) { return isBlank(w.parent_wp_id) || !wpById[w.parent_wp_id]; }).sort(order).forEach(function (w) { walk(w, 0); });
  var top = wps.filter(function (w) { return isBlank(w.parent_wp_id); });
  var authorized = envAmount_(project, envKey_(ex)), allocated = round2(top.reduce(function (s, w) { return s + (envAmount_(w, envKey_(ex)) || 0); }, 0));
  var total = 0; Object.keys(costs.byWp).forEach(function (k) { if (!wpById[k].parent_wp_id) total = round2(total + costs.byWp[k]); });
  total = round2(total + costs.none);
  var out = { exercise: { id: ex.id, year: Number(ex.year), status: ex.status }, can_edit: ex.status !== 'Clos', project: { id: project.id, code: project.code, name: project.name, version: project.version }, rows: rows, partial: !access.all, canSetProject: ctx.isAdmin || can(ctx, 'budget.authorize', { type: 'project', id: project.id }) };
  if (access.all) {
    out.totals = { authorized: authorized, allocated: allocated, reserve: authorized === null ? null : round2(authorized - allocated), cost: total, cost_without_wp: costs.none,
      remaining: authorized === null ? null : round2(authorized - total), over: authorized !== null && (total > authorized || allocated > authorized),
      over_cost: authorized !== null && total > authorized, over_alloc: authorized !== null && allocated > authorized,
      over_by: authorized === null ? 0 : round2(Math.max(0, total - authorized, allocated - authorized)) };
  }
  // les livrables et jalons, sous leur workpackage : la décomposition du budget. ÉTANCHE (0.19.3) : seuls les livrables DE CET EXERCICE (et les jalons de son année) y figurent ; les livrables d'un autre
  // exercice, ou sans exercice, n'y sont pas et leur coût n'est pas compté. Un livrable porte le coût de ses lignes ; un jalon n'a pas de coût.
  var wpVisible = {}; rows.forEach(function (r) { wpVisible[r.wp_id] = true; });
  var year = Number(ex.year);
  var itemList = repoList('PlanItem', function (i) {
    if (i.project_id !== project.id) return false;
    if (i.item_type === 'Livrable') return i.exercise_id === ex.id;
    return i.item_type === 'Jalon' && (isBlank(i.planned_finish) || String(i.planned_finish).slice(0, 4) === String(year));
  }).filter(function (i) { return i.wp_id ? !!wpVisible[i.wp_id] : access.all; });
  var inList = indexBy_(itemList), lineCount = {}, lineCost = {};
  var lines = repoList('BudgetLine', function (l) { return !!inList[l.deliverable_id]; });
  lines.forEach(function (l) { lineCount[l.deliverable_id] = (lineCount[l.deliverable_id] || 0) + 1; lineCost[l.deliverable_id] = round2((lineCost[l.deliverable_id] || 0) + (Number(l.planned_amount) || 0)); });
  var exById = indexBy_(repoList('Exercise')), resNames = indexBy_(repoList('Resource')), ownerName = function (id) { return isBlank(id) || !resNames[id] ? '' : resNames[id].name; };
  out.items = itemList.map(function (i) {
    var f = i.planned_finish || '';
    return { id: i.id, version: i.version, wp_id: i.wp_id || '', name: i.name, type: i.item_type, owner: ownerName(i.owner_resource_id), start: i.planned_start || null, finish: f || null,
      status: i.status || '', progress: Number(i.progress_pct) || 0, cost: i.item_type === 'Livrable' ? (lineCost[i.id] || 0) : null, lines: i.item_type === 'Livrable' ? (lineCount[i.id] || 0) : null,
      exercise_year: i.exercise_id && exById[i.exercise_id] ? Number(exById[i.exercise_id].year) : null,
      canEdit: ex.status !== 'Clos' && i.item_type === 'Livrable' && (access.all || can(ctx, 'budget.edit', { type: 'planitem', id: i.id })) };
  }).sort(function (a, b) { return String(a.start || '9999').localeCompare(String(b.start || '9999')) || String(a.name).localeCompare(String(b.name), 'fr'); });
  // les livrables sans exercice : à rattacher (bouton de la page) ; ils ne comptent dans aucun exercice
  out.unassigned = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable' && isBlank(i.exercise_id) && (access.all || can(ctx, 'budget.edit', { type: 'planitem', id: i.id })); })
    .map(function (i) { return { id: i.id, name: i.name, wp: i.wp_id && wpById[i.wp_id] ? wpById[i.wp_id].name : '' }; });

  // ---- le prévisionnel par mois et par workpackage, et la projection de fin d'année
  var months = []; for (var mi = 1; mi <= 12; mi++) months.push(year + '-' + (mi < 10 ? '0' : '') + mi);
  var monthIdx = {}; months.forEach(function (mm, i) { monthIdx[mm] = i; });
  var today = todayStr(), tYear = Number(today.slice(0, 4)), curIdx = year < tYear ? 12 : (year > tYear ? 0 : Number(today.slice(5, 7)));
  var topOf = function (wpId) { var w = wpById[wpId], g = 0; while (w && w.parent_wp_id && wpById[w.parent_wp_id] && g++ < 5) w = wpById[w.parent_wp_id]; return w || null; };
  var delivs = itemList.filter(function (i) { return i.item_type === 'Livrable'; }), delivById = indexBy_(delivs);
  var lineById = indexBy_(lines.filter(function (l) { return !!delivById[l.deliverable_id]; }));
  var phasing = repoList('BudgetPhasing', function (x) { return !!lineById[x.budget_line_id]; });
  var seriesMap = {}, planY = {}, pvY = {};
  var serie = function (d) {
    var t = d.wp_id ? topOf(d.wp_id) : null, key = t ? t.id : '';
    return seriesMap[key] = seriesMap[key] || { wp_id: key, code: t ? t.wbs_code || '' : '', name: t ? t.name : 'Hors workpackage', values: months.map(function () { return 0; }), outside: 0 };
  };
  phasing.forEach(function (x) {
    var l = lineById[x.budget_line_id], d = delivById[l.deliverable_id], sr = serie(d), amount = Number(x.amount) || 0, i = monthIdx[x.month];
    if (i === undefined) { sr.outside = round2(sr.outside + amount); return; }
    sr.values[i] = round2(sr.values[i] + amount);
    planY[d.id] = round2((planY[d.id] || 0) + amount);
    if (i + 1 <= curIdx) pvY[d.id] = round2((pvY[d.id] || 0) + amount);
  });
  var yearEnd = year + '-12-31', yearStart = year + '-01-01', dayN = function (a, b) { return Math.max(0, Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS)); };
  var perWp = {}, tot = { plan: 0, pv: 0, ev: 0, projected: 0 };
  delivs.forEach(function (d) {
    var parts = lineCost[d.id] || 0, progress = Math.max(0, Math.min(100, Number(d.progress_pct) || 0)), ev = round2(parts * progress / 100), plan = planY[d.id] || 0, pv = pvY[d.id] || 0, projected;
    if (curIdx === 0) projected = plan;                                        // l'année n'a pas commencé : le prévu
    else if (curIdx === 12 && year < tYear) projected = ev;                    // l'année est finie : ce qui a été acquis
    else {
      var remaining = round2(parts - ev), share = 1, fin = d.planned_finish || '';
      if (progress >= 100) share = 0;
      else if (fin && fin > yearEnd) share = Math.max(0, Math.min(1, dayN(today, yearEnd) / Math.max(1, dayN(today, fin))));
      projected = round2(ev + remaining * share);
    }
    var key = serie(d).wp_id, g = perWp[key] = perWp[key] || { plan: 0, pv: 0, ev: 0, projected: 0 };
    g.plan = round2(g.plan + plan); g.pv = round2(g.pv + pv); g.ev = round2(g.ev + ev); g.projected = round2(g.projected + projected);
    tot.plan = round2(tot.plan + plan); tot.pv = round2(tot.pv + pv); tot.ev = round2(tot.ev + ev); tot.projected = round2(tot.projected + projected);
  });
  var seriesList = Object.keys(seriesMap).map(function (k) { return seriesMap[k]; }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); });
  var totalMonthly = months.map(function (_, i) { return round2(seriesList.reduce(function (t, sr) { return t + sr.values[i]; }, 0)); });
  var run = 0, cumulative = totalMonthly.map(function (v) { run = round2(run + v); return run; });
  var committed = null;
  if (access.all) { var cm = committedByMonth_(projectOrders_(project.id, wps)); committed = months.map(function (mm) { return round2(cm[mm] || 0); }); }
  var envTop = {}; rows.forEach(function (r) { if (!r.parent_id) envTop[r.wp_id] = r.allocated; });
  var refBudget = out.totals ? (out.totals.authorized !== null ? out.totals.authorized : (out.totals.allocated > 0 ? out.totals.allocated : null)) : null;
  out.monthly = { year: year, months: months, current_month: curIdx, series: seriesList.map(function (sr) { return { wp_id: sr.wp_id, code: sr.code, name: sr.name, values: sr.values, total: round2(sr.values.reduce(function (t, v) { return t + v; }, 0)), outside: sr.outside }; }),
    total: totalMonthly, cumulative: cumulative, committed: committed, budget: refBudget };
  out.projection = {
    year: year, current_month: curIdx, plan_year: tot.plan, pv: tot.pv, ev: tot.ev, projected: tot.projected, budget: refBudget, gap: refBudget === null ? null : round2(refBudget - tot.projected), over: refBudget !== null && tot.projected > refBudget,
    committed_to_date: committed ? round2(committed.reduce(function (t, v, i) { return i + 1 <= curIdx ? t + v : t; }, 0)) : null,
    method: 'À l’avancement : valeur acquise à ce jour (parts × avancement) + reste à faire de chaque livrable, étalé jusqu’à sa date de fin, au plus jusqu’à la fin de l’année. Le réalisé comptable n’est pas importé.',
    by_wp: seriesList.map(function (sr) {
      var g = perWp[sr.wp_id] || { plan: 0, pv: 0, ev: 0, projected: 0 }, al = sr.wp_id && envTop[sr.wp_id] !== undefined ? envTop[sr.wp_id] : null;
      return { wp_id: sr.wp_id, code: sr.code, name: sr.name, plan: g.plan, pv: g.pv, ev: g.ev, projected: g.projected, allocated: al, gap: al === null ? null : round2(al - g.projected), over: al !== null && g.projected > al };
    })
  };

  // l'évolution depuis la baseline active du projet : ce que la décomposition valait quand on l'a figée, pour CET exercice (0.19.2 ; par exercice en 0.19.3)
  var bl = isBlank(project.active_baseline_id) ? null : repoGet('Baseline', project.active_baseline_id);
  if (bl && bl.status === 'Active' && isBlank(bl.scope_type)) {
    var snap = loadBaselineSnapshot_(bl.id), exOfNow = {};
    repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }).forEach(function (i) { exOfNow[i.id] = i.exercise_id || ''; });
    var inEx = function (it, id) { return ('exercise_id' in it ? it.exercise_id : exOfNow[id]) === ex.id; };
    var bcost = costByWpSnap_(snap, inEx), bitem = budgetByItem_(snap), bwp = snap.WorkPackage || {};
    out.baseline = { id: bl.id, label: bl.label || ('B' + bl.number), number: Number(bl.number) || 0, decided_at: bl.decided_at || '' };
    out.rows.forEach(function (r) {
      var b = bwp[r.wp_id];
      r.base = b ? { known: 'envelopes_json' in b, allocated: 'envelopes_json' in b ? envAmount_(b, envKey_(ex)) : null, cost: bcost.byWp[r.wp_id] || 0 } : { new: true };
    });
    out.items.forEach(function (x) { if (x.type === 'Livrable') x.base = (snap.PlanItem || {})[x.id] ? { cost: bitem[x.id] || 0 } : { new: true }; });
    if (out.totals) {
      var bp = Object.keys(snap.Project || {}).map(function (k) { return snap.Project[k]; })[0] || {}, costNow = 0;
      Object.keys(snap.BudgetLine || {}).forEach(function (id) { var bline = snap.BudgetLine[id], it = (snap.PlanItem || {})[bline.deliverable_id]; if (it && inEx(it, bline.deliverable_id)) costNow = round2(costNow + (Number(bline.planned_amount) || 0)); });
      out.totals.base = { known: 'envelopes_json' in bp, authorized: 'envelopes_json' in bp ? envAmount_(bp, envKey_(ex)) : null, cost: costNow };
    }
  }
  return out;
}

defineAction('budget.envelope.get', function (p, ctx) {
  return envelopeView_(ctx, mustGet('Project', requireParam(p, 'projectId')), envelopeExercise_(p));
});

/**
 * Fixe l'enveloppe du projet (`authorized`, vide = pas de plafond) et/ou celles de workpackages (`allocations` : [{ wpId, amount }], vide = pas de plafond). Tout ou rien :
 * les droits et les règles de somme se vérifient sur l'état final avant la moindre écriture.
 */
defineAction('budget.envelope.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var ex = envelopeExercise_(p);
  if (ex.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + ex.year + ' est clos : on n’y change plus le budget.');
  var allocations = Array.isArray(p.allocations) ? p.allocations : [];
  if (!('authorized' in p) && !allocations.length) throw new PpmError('VALIDATION', 'Rien à enregistrer.');
  return withLock(function () {
    var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; }), wpById = indexBy_(wps);
    var next = {}; wps.forEach(function (w) { var v0 = envAmount_(w, envKey_(ex)); next[w.id] = v0 === null ? '' : v0; });
    var changes = [];
    var authorized0 = envAmount_(project, envKey_(ex)), authorized = authorized0 === null ? '' : authorized0;
    if ('authorized' in p) {
      if (!ctx.isAdmin && !can(ctx, 'budget.authorize', { type: 'project', id: project.id })) throw new PpmError('FORBIDDEN', 'Seul le chef de projet (ou un niveau au-dessus) fixe l’enveloppe du projet.');
      var a = envNumber_(p.authorized, 'Budget autorisé');
      if (a !== authorized) { authorized = a; changes.push({ table: 'Project', id: project.id, patch: envPatch_(project, envKey_(ex), a), version: project.version }); }
    }
    allocations.forEach(function (x) {
      var w = wpById[String(x.wpId)];
      if (!w) throw new PpmError('NOT_FOUND', 'Workpackage introuvable dans ce projet : ' + x.wpId);
      if (!canAllocateWp_(ctx, w)) throw new PpmError('FORBIDDEN', 'L’enveloppe de « ' + w.name + ' » est fixée par ' + (isBlank(w.parent_wp_id) ? 'le chef de projet (ou au-dessus)' : 'son Workpackage leader (ou au-dessus)') + '.');
      var v = envNumber_(x.amount, 'Enveloppe de « ' + w.name + ' »');
      if (v !== next[w.id]) { next[w.id] = v; changes.push({ table: 'WorkPackage', id: w.id, patch: envPatch_(w, envKey_(ex), v), version: w.version }); }
    });
    // seule règle : un sous-workpackage ne reçoit rien tant que son parent n'a pas d'enveloppe (les dépassements de somme sont permis, voir l'en-tête)
    wps.filter(function (w) { return isBlank(w.parent_wp_id); }).forEach(function (w) {
      var kids = wps.filter(function (k) { return k.parent_wp_id === w.id; });
      var s = round2(kids.reduce(function (t, k) { return t + (next[k.id] === '' ? 0 : next[k.id]); }, 0));
      if (!kids.length || s === 0) return;
      if (next[w.id] === '') throw new PpmError('VALIDATION', 'Fixez d’abord l’enveloppe de « ' + w.name + ' » : ses sous-workpackages ne peuvent pas en recevoir tant qu’elle est vide.', { rule: 'ENVELOPE_PARENT_EMPTY', wp: w.id });
    });
    changes.forEach(function (c) { repoUpdate(c.table, c.id, c.patch, null, ctx.actx); });
    var fresh = mustGet('Project', project.id);
    var view = envelopeView_(ctx, fresh, ex);
    view.changed = changes.length;
    return view;
  });
});
