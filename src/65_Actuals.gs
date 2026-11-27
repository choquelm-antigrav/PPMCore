/**
 * PPM Core — 0.21.0 : le RÉALISÉ comptable, SAISI À LA MAIN.
 *
 * Le réalisé est la consommation réelle d'un projet par CPN, ÉQUIPE et MOIS (jamais au livrable). Pour cette première version il n'y a PAS de lien avec un fichier extérieur : le chef de projet
 * (ou au-dessus) saisit, chaque mois, ce que chaque équipe a consommé sur chaque CPN du projet. L'historique mensuel est conservé.
 *
 * RÈGLES. Une ligne `ActualLine` par (CPN, équipe, année-mois) ; saisir à nouveau la même combinaison REMPLACE le montant (un montant vide retire la ligne). Un montant peut être négatif (un avoir). On ne
 * saisit pas dans un exercice clos. L'équipe à 4 caractères compte dans sa parente à 3 dans le suivi (exerciseRootTeam_).
 * Droit : `actuals.manage` (chef de projet et au-dessus) pour saisir ; la lecture suit le budget du projet (`budgetAccess_(...).all`).
 */

function actualsMonthsOf_(year) { var out = []; for (var m = 1; m <= 12; m++) out.push(year + '-' + (m < 10 ? '0' : '') + m); return out; }
function actualsAmountNumber_(v) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/\s/g, '').replace(',', '.'));
  if (isBlank(v) || isNaN(n) || Math.abs(n) > 1e10) throw new PpmError('VALIDATION', 'Montant : un nombre (négatif pour un avoir).');
  return round2(n);
}

/** L'exercice d'une année (clos ou non) ou null. */
function actualsExerciseOf_(year) { return repoList('Exercise', function (e) { return !isTrue(e.deleted) && Number(e.year) === Number(year); })[0] || null; }

defineAction('actuals.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'actuals.manage', { type: 'project', id: project.id });
  var month = String(requireParam(p, 'month')).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PpmError('VALIDATION', 'Mois invalide : « ' + month + ' » (format AAAA-MM).');
  var team = mustGet('HierarchicalTeam', requireParam(p, 'teamId'));
  if (isTrue(team.deleted)) throw new PpmError('VALIDATION', 'Équipe introuvable.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; }), cpns = projectCpns_(project, wps).map(function (c) { return c.cpn; });
  var cpn = normCpn_(p.cpn);
  if (cpns.length && !cpn) throw new PpmError('VALIDATION', 'Choisissez le CPN : ' + cpns.join(', ') + '.');
  if (cpn && cpns.indexOf(cpn) < 0) throw new PpmError('VALIDATION', 'Le CPN ' + cpn + ' n’est pas un CPN de ce projet' + (cpns.length ? ' (' + cpns.join(', ') + ')' : ' : définissez-le d’abord') + '.');
  var ex = actualsExerciseOf_(month.slice(0, 4));
  if (ex && ex.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + ex.year + ' est clos : on n’y change plus rien.');
  var clear = isBlank(p.amount), amount = clear ? 0 : actualsAmountNumber_(p.amount);
  return withLock(function () {
    var row = repoList('ActualLine', function (l) { return l.project_id === project.id && l.month === month && l.team_id === team.id && normCpn_(l.charge_code) === cpn; })[0] || null;
    if (clear) { if (row) repoSoftDelete('ActualLine', row.id, null, ctx.actx); return { removed: !!row }; }
    if (row) { repoUpdate('ActualLine', row.id, { amount: amount }, null, ctx.actx); return { saved: true, replaced: true }; }
    repoInsert('ActualLine', { project_id: project.id, charge_code: cpn, team_id: team.id, month: month, amount: amount }, ctx.actx);
    return { saved: true, replaced: false };
  });
});

defineAction('actuals.get', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.all) throw new PpmError('FORBIDDEN', 'Le réalisé est réservé aux responsables de budget du projet.');
  var ex = planExercise_(p), today = todayStr();
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var teamById = indexBy_(repoList('HierarchicalTeam'));
  var months = actualsMonthsOf_(Number(ex.year)), inYear = {}; months.forEach(function (m) { inYear[m] = true; });
  var lines = repoList('ActualLine', function (l) { return l.project_id === project.id && inYear[l.month]; }).map(function (l) {
    var t = teamById[l.team_id];
    return { id: l.id, version: l.version, month: l.month, cpn: normCpn_(l.charge_code), team_id: l.team_id, team: t ? t.name : '(équipe supprimée)', amount: Number(l.amount) || 0 };
  }).sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : (a.team < b.team ? -1 : a.team > b.team ? 1 : 0); });
  return {
    exercise: exerciseView_(ex), project: { id: project.id, code: project.code, name: project.name },
    can_edit: ex.status !== 'Clos' && (ctx.isAdmin || can(ctx, 'actuals.manage', { type: 'project', id: project.id })),
    months: months, cpns: projectCpns_(project, wps).map(function (c) { return { cpn: c.cpn, label: c.label }; }),
    teams: exerciseTeamChoices_(repoList('HierarchicalTeam')), lines: lines, view: actualsView_(project, ex, today)
  };
});

/**
 * Le réalisé d'un projet pour un exercice (son année) : par mois, par équipe (l'équipe à 4 caractères compte dans sa parente à 3), et le cumul à ce jour. Lecture : qui voit le budget du projet.
 * `available` : au moins une ligne saisie dans l'année.
 */
function actualsView_(project, ex, today) {
  var year = Number(ex.year), months = actualsMonthsOf_(year);
  var idx = {}; months.forEach(function (mm, i) { idx[mm] = i; });
  var lines = repoList('ActualLine', function (l) { return l.project_id === project.id && idx[l.month] !== undefined; });
  var teamById = indexBy_(repoList('HierarchicalTeam')), tYear = Number(String(today).slice(0, 4)), curIdx = year < tYear ? 12 : (year > tYear ? 0 : Number(String(today).slice(5, 7)));
  var byTeam = {}, byCpn = {}, total = months.map(function () { return 0; }), last = -1, unattached = 0;
  lines.forEach(function (l) {
    var i = idx[l.month], amount = Number(l.amount) || 0, root = l.team_id ? exerciseRootTeam_({ teamById: teamById }, teamById[l.team_id]) : null;
    total[i] = round2(total[i] + amount); if (i > last) last = i;
    var ck = normCpn_(l.charge_code); byCpn[ck] = round2((byCpn[ck] || 0) + amount);
    if (!root) { unattached = round2(unattached + amount); return; }
    var t = byTeam[root.id] = byTeam[root.id] || { team_id: root.id, name: root.name, values: months.map(function () { return 0; }) };
    t.values[i] = round2(t.values[i] + amount);
  });
  var run = 0, cum = total.map(function (v, i) { run = round2(run + v); return i <= last ? run : null; });
  var toDate = 0; total.forEach(function (v, i) { if (i + 1 <= curIdx) toDate = round2(toDate + v); });
  var teams = Object.keys(byTeam).map(function (k) {
    var t = byTeam[k]; t.total = round2(t.values.reduce(function (s, v) { return s + v; }, 0)); t.to_date = round2(t.values.reduce(function (s, v, i) { return i + 1 <= curIdx ? s + v : s; }, 0)); return t;
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  return { available: lines.length > 0, year: year, months: months, monthly: total, cumulative: cum, to_date: toDate, last_month: last + 1, unattached: unattached, teams: teams,
    by_cpn: Object.keys(byCpn).sort().map(function (k) { return { cpn: k, total: byCpn[k] }; }) };
}
