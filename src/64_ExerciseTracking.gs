/**
 * PPM Core — 0.19.0 : le SUIVI BUDGÉTAIRE de l'exercice en exécution.
 *
 * Pendant l'année, on suit l'avancement des livrables contre le budget : pour un projet et un exercice (par défaut celui en exécution), par équipe et au total :
 *   ACCORDÉ        le budget accordé (ou, à défaut, attendu) ;
 *   PRÉVU          les parts des livrables étalées par mois (BudgetPhasing) : prévu de l'année, prévu à ce jour, prévu au-delà de l'année ;
 *   VALEUR ACQUISE les parts × l'avancement du livrable : ce que l'avancement « vaut » ; son écart au prévu à ce jour dit si l'on est en avance ou en retard sur le budget ;
 *   ENGAGÉ         les commandes d'achat engagées du projet (une PO compte en totalité le mois de son lancement ; pas de répartition par équipe).
 * Les séries mensuelles cumulées alimentent le graphique de la page Budget. Le réalisé importé et la projection de fin d'année viennent ensuite (`projection.available`).
 * Droit : exercise.read (Workpackage leader et au-dessus). Les écarts s'affichent, rien ne bloque.
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
  var today = todayStr(), year = Number(ex.year), curIdx = Number(today.slice(0, 4)) < year ? 0 : (Number(today.slice(0, 4)) > year ? 12 : Number(today.slice(5, 7)));
  var months = []; for (var m = 1; m <= 12; m++) months.push(year + '-' + (m < 10 ? '0' : '') + m);
  var idxOf = {}; months.forEach(function (mm, i) { idxOf[mm] = i + 1; });
  var data = exerciseData_(ex, [project.id]), table = exerciseTable_(ex, data, project.id);
  var lineById = indexBy_(data.lines), phasing = repoList('BudgetPhasing', function (x) { return !!lineById[x.budget_line_id]; });
  var teamRows = {};
  var row = function (team) {
    var id = team.id;
    if (!teamRows[id]) teamRows[id] = { team_id: id, name: team.name, country: team.country || 'FR', granted: null, expected: null, monthly: months.map(function () { return 0; }), planned_total: 0, ev: 0 };
    return teamRows[id];
  };
  table.rows.concat(table.orphans, table.unruled).forEach(function (r) { var t = row({ id: r.team_id, name: r.name, country: r.country }); t.granted = r.granted; t.expected = r.expected; });
  var rootOfLine = {};
  data.lines.forEach(function (l) {
    var root = exerciseRootTeam_(data, data.teamById[l.team_id]);
    if (!root) return;
    rootOfLine[l.id] = root.id;
    var t = row(root), it = data.itemById[l.deliverable_id], amount = Number(l.planned_amount) || 0;
    t.planned_total += amount;
    t.ev += amount * Math.max(0, Math.min(100, Number(it.progress_pct) || 0)) / 100;
  });
  var itemPv = {};
  phasing.forEach(function (x) {
    var l = lineById[x.budget_line_id], rid = rootOfLine[l.id], i = idxOf[x.month], amount = Number(x.amount) || 0;
    if (!rid || !i) return;
    teamRows[rid].monthly[i - 1] += amount;
    if (i <= curIdx) itemPv[l.deliverable_id] = (itemPv[l.deliverable_id] || 0) + amount;
  });
  var teams = Object.keys(teamRows).map(function (id) {
    var t = teamRows[id], pv = 0, plannedYear = 0;
    t.monthly = t.monthly.map(round2);
    t.monthly.forEach(function (v, i) { plannedYear += v; if (i + 1 <= curIdx) pv += v; });
    var base = t.granted !== null ? t.granted : t.expected;
    return { team_id: t.team_id, name: t.name, country: t.country, granted: t.granted, expected: t.expected, basis: t.granted !== null ? 'accordé' : (t.expected !== null ? 'attendu' : ''),
      planned_year: round2(plannedYear), planned_outside: round2(t.planned_total - plannedYear), planned_total: round2(t.planned_total), pv: round2(pv), ev: round2(t.ev), ev_gap: round2(t.ev - pv),
      remaining: base === null ? null : round2(base - plannedYear), clash: base !== null && plannedYear > base, monthly: t.monthly };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  var sum = function (f) { return round2(teams.reduce(function (s, t) { return s + (t[f] || 0); }, 0)); };
  var anyGranted = teams.some(function (t) { return t.granted !== null; }), anyExpected = teams.some(function (t) { return t.expected !== null; });
  var totals = { granted: anyGranted ? sum('granted') : null, expected: anyExpected ? sum('expected') : null, planned_year: sum('planned_year'), planned_outside: sum('planned_outside'), planned_total: sum('planned_total'), pv: sum('pv'), ev: sum('ev') };
  totals.ev_gap = round2(totals.ev - totals.pv);
  var base = totals.granted !== null ? totals.granted : totals.expected;
  totals.remaining = base === null ? null : round2(base - totals.planned_year);
  totals.clash = base !== null && totals.planned_year > base;
  // engagé : les commandes d'achat du projet, par mois
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var committed = committedByMonth_(projectOrders_(project.id, wps)), cm = months.map(function (mm) { return round2(committed[mm] || 0); });
  var cum = function (arr, upTo) { var s = 0; return arr.map(function (v, i) { s = round2(s + v); return upTo === null || i + 1 <= upTo ? s : null; }); };
  var plannedMonthly = months.map(function (_, i) { return round2(teams.reduce(function (s, t) { return s + t.monthly[i]; }, 0)); });
  totals.committed_to_date = round2(cm.reduce(function (s, v, i) { return i + 1 <= curIdx ? s + v : s; }, 0));
  totals.committed_year = round2(cm.reduce(function (s, v) { return s + v; }, 0));
  // livrables : prévu à ce jour, valeur acquise
  var wpById = indexBy_(wps);
  var deliverables = data.items.map(function (it) {
    var ls = data.lines.filter(function (l) { return l.deliverable_id === it.id; }), total = round2(ls.reduce(function (s, l) { return s + (Number(l.planned_amount) || 0); }, 0));
    var progress = Math.max(0, Math.min(100, Number(it.progress_pct) || 0)), pv = round2(itemPv[it.id] || 0), ev = round2(total * progress / 100), w = it.wp_id ? wpById[it.wp_id] : null;
    return { id: it.id, name: it.name, wp: w ? ((w.wbs_code ? w.wbs_code + ' ' : '') + w.name) : '', status: it.status, progress: progress, finish: it.planned_finish || '', parts: round2(total), pv: pv, ev: ev, ev_gap: round2(ev - pv),
      teams: ls.map(function (l) { var t = data.teamById[l.team_id]; return t ? t.name : ''; }).filter(Boolean).sort().join(', ') };
  }).sort(function (a, b) { return a.ev_gap - b.ev_gap || String(a.name).localeCompare(String(b.name), 'fr'); });
  return {
    exercise: { id: ex.id, year: year, status: ex.status }, project: { id: project.id, code: project.code, name: project.name }, today: today, current_month: curIdx, months: months,
    totals: totals, teams: teams, deliverables: deliverables,
    series: { planned_cum: cum(plannedMonthly, null), committed_cum: cum(cm, curIdx), granted: base, granted_basis: totals.granted !== null ? 'accordé' : (totals.expected !== null ? 'attendu' : '') },
    projection: { available: false, reason: 'Le réalisé n’est pas encore importé : la projection de fin d’année s’appuie sur lui.' }
  };
});
