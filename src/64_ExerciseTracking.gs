/**
 * PPM Core — 0.21.0 : le SUIVI BUDGÉTAIRE de l'exercice en exécution, lu dans le plan budgétaire.
 *
 * Pour un projet et un exercice (par défaut celui en exécution), par équipe et au total, tout vient du MÊME tableau livrable × équipe :
 *   DOTATION       le montant donné à l'équipe (60_Exercise.gs) ;
 *   PLAN           le total des parts de l'équipe sur les livrables de l'exercice ;
 *   VALEUR ACQUISE les parts × l'avancement du livrable : ce que l'avancement « vaut » ;
 *   RÉALISÉ        ce que l'équipe a consommé (saisi à la main, 65_Actuals.gs), cumulé à ce jour et sur l'année ;
 *   ATTERRISSAGE   réalisé à ce jour + reste à faire (plan − valeur acquise) : où l'équipe finit l'année, contre sa dotation ;
 *   ENGAGÉ         les commandes d'achat engagées du projet, face au budget externe (colonne Externe du plan) : pas de répartition par équipe.
 * Le réalisé n'est comparé qu'au niveau de l'équipe (et du projet) : il n'est pas suivi au livrable. Droit : exercise.read. Les écarts s'affichent, rien ne bloque.
 */

/** L'équipe qui porte la ligne dans le tableau : l'équipe à 3 caractères, la parente d'une équipe à 4 caractères, sinon l'équipe elle-même (hors règle ou orpheline). */
function exerciseRootTeam_(data, team) {
  if (!team) return null;
  var lvl = teamLevel_(team);
  if (lvl === 4 && !isBlank(team.parent_team_id)) { var par = data.teamById[team.parent_team_id]; if (par && teamLevel_(par) === 3 && !isTrue(par.deleted)) return par; }
  return team;
}

defineAction('exercise.tracking', function (p, ctx) {
  etpReset_();
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'exercise.read', { type: 'project', id: project.id });
  var ex = !isBlank(p.exerciseId) ? mustGet('Exercise', p.exerciseId) : repoList('Exercise', function (e) { return e.status === 'Exécution'; })[0];
  if (!ex) throw new PpmError('NOT_FOUND', 'Aucun exercice en exécution : le suivi budgétaire porte sur l’année en cours.');
  var today = todayStr(), year = Number(ex.year);
  // une version du plan (une baseline) : le suivi lit la version de référence (cellules et dotations figées), pas le brouillon
  var rv = isBlank(p.version) ? null : resolveDecompVersion_(project, p.version);
  var D = decompDataset_(project, ex, rv && rv.version ? rv.version : null), data = planData_(D, ex, project);
  var table = exerciseTable_(ex, data, project.id);
  var teamRows = {};
  var row = function (team) {
    if (!teamRows[team.id]) teamRows[team.id] = { team_id: team.id, name: team.name, country: team.country || 'FR', dotation: null, plan: 0, ev: 0 };
    return teamRows[team.id];
  };
  table.rows.concat(table.orphans, table.unruled).forEach(function (r) { row({ id: r.team_id, name: r.name, country: r.country }).dotation = r.dotation; });
  data.lines.forEach(function (l) {
    var root = exerciseRootTeam_(data, data.teamById[l.team_id]);
    if (!root) return;
    var t = row(root), it = data.itemById[l.deliverable_id], amount = Number(l.planned_amount) || 0;
    t.plan += amount;
    t.ev += amount * Math.max(0, Math.min(100, Number(it.progress_pct) || 0)) / 100;
  });
  // le réalisé de l'année, par équipe : une équipe qui a consommé sans avoir de part de livrable apparaît aussi
  var act = actualsView_(project, ex, today), actBy = {};
  act.teams.forEach(function (t) { actBy[t.team_id] = t; });
  act.teams.forEach(function (t) { if (!teamRows[t.team_id]) row({ id: t.team_id, name: t.name, country: '' }); });
  var teams = Object.keys(teamRows).map(function (id) {
    var t = teamRows[id], a = actBy[id] || null, plan = round2(t.plan), ev = round2(t.ev);
    var actualToDate = act.available ? (a ? a.to_date : 0) : null, actualYear = act.available ? (a ? a.total : 0) : null;
    var landing = act.available ? round2(actualToDate + Math.max(0, plan - ev)) : null;
    return { team_id: t.team_id, name: t.name, country: t.country, dotation: t.dotation, plan: plan, ev: ev, progress_pct: plan > 0 ? Math.round(ev / plan * 100) : null,
      actual_to_date: actualToDate, actual_year: actualYear, consumed_pct: act.available && plan > 0 ? Math.round(actualToDate / plan * 100) : null,
      landing: landing, remaining: t.dotation === null ? null : round2(t.dotation - (landing === null ? plan : landing)),
      clash: t.dotation !== null && plan > t.dotation, over: t.dotation !== null && landing !== null && landing > t.dotation };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  var sum = function (f) { return round2(teams.reduce(function (s, t) { return s + (t[f] || 0); }, 0)); };
  var anyDot = teams.some(function (t) { return t.dotation !== null; });
  var totals = { dotation: anyDot ? sum('dotation') : null, plan: sum('plan'), ev: sum('ev'), actual_to_date: act.available ? act.to_date : null, actual_year: act.available ? sum('actual_year') : null, actual_unattached: act.unattached };
  totals.progress_pct = totals.plan > 0 ? Math.round(totals.ev / totals.plan * 100) : null;
  totals.consumed_pct = act.available && totals.plan > 0 ? Math.round(totals.actual_to_date / totals.plan * 100) : null;
  totals.landing = act.available ? round2(sum('landing') + act.unattached) : null;
  totals.remaining = totals.dotation === null ? null : round2(totals.dotation - (totals.landing === null ? totals.plan : totals.landing));
  totals.clash = totals.dotation !== null && totals.plan > totals.dotation;
  totals.over = totals.dotation !== null && totals.landing !== null && totals.landing > totals.dotation;
  // externe : les forfaits du plan face aux commandes d'achat engagées de l'année
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var itemIds = {}; data.items.forEach(function (i) { itemIds[i.id] = true; });
  var external = round2(D.lines.filter(function (l) { return l.cost_type === 'Forfait' && itemIds[l.deliverable_id]; }).reduce(function (s, l) { return s + (Number(l.planned_amount) || 0); }, 0));
  var committed = round2(projectOrders_(project.id, wps).filter(function (o) { return PO_COMMITTED.indexOf(o.status) >= 0 && poYear_(o) === year; }).reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0));
  totals.external = { plan: external, committed: committed, remaining: round2(external - committed), over: committed > external + 0.005 };
  // livrables : plan, valeur acquise
  var wpById = indexBy_(wps);
  var deliverables = data.items.map(function (it) {
    var ls = data.lines.filter(function (l) { return l.deliverable_id === it.id; }), total = round2(ls.reduce(function (s, l) { return s + (Number(l.planned_amount) || 0); }, 0));
    var progress = Math.max(0, Math.min(100, Number(it.progress_pct) || 0)), w = it.wp_id ? wpById[it.wp_id] : null;
    return { id: it.id, name: it.name, wp: w ? ((w.wbs_code ? w.wbs_code + ' ' : '') + w.name) : '', status: it.status, progress: progress, finish: it.planned_finish || '', plan: total, ev: round2(total * progress / 100),
      teams: ls.map(function (l) { var t = data.teamById[l.team_id]; return t ? t.name : ''; }).filter(Boolean).sort().join(', ') };
  }).sort(function (a, b) { return b.plan - a.plan || String(a.name).localeCompare(String(b.name), 'fr'); });
  return {
    exercise: { id: ex.id, year: year, status: ex.status }, project: { id: project.id, code: project.code, name: project.name }, today: today, version: D.versionInfo ? { id: D.versionInfo.id, label: D.versionInfo.label } : null,
    totals: totals, teams: teams, deliverables: deliverables, actuals: { available: act.available, months: act.months, monthly: act.monthly, cumulative: act.cumulative, last_month: act.last_month, by_cpn: act.by_cpn },
    projection: { available: act.available, reason: act.available ? '' : 'Aucun réalisé saisi pour ' + year + ' : l’atterrissage s’appuie sur lui.' }
  };
});
