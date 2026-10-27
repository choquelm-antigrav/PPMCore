/**
 * PPM Core — 0.17.1 : l'EXERCICE BUDGÉTAIRE annuel.
 *
 * Chaque année, on passe d'un budget attendu PAR ÉQUIPE à une liste de livrables chiffrés par équipe qui tient dans ce budget, puis on suit l'exécution.
 *   - Avant l'été : le budget ATTENDU par équipe à 3 caractères (ex. « 1vm »), par projet. Une équipe à 4 caractères (« 1vmd », rattachée à « 1vm ») est un détail facultatif qui s'additionne
 *     dans sa parente. Le niveau se lit au NOMBRE DE CARACTÈRES du nom de l'équipe.
 *   - Septembre : les livrables, chacun avec une PART PAR ÉQUIPE en montant libre (43_Budget.gs). Pour chaque équipe : attendu · total des parts · écart.
 *   - Décembre : le budget ACCORDÉ, qui peut être réduit : l'écart avec les parts est le CLASH, résorbé en redéfinissant les livrables. Février et avril : l'accordé peut être revu.
 * On AFFICHE les écarts, on ne bloque jamais. Un exercice est en Préparation (l'année qui vient), en Exécution (l'année en cours) ou Clos ; au plus un de chaque état ; un livrable n'a
 * qu'un exercice.
 *
 * COÛT D'UN ETP. Il n'y a plus aucun taux journalier : seulement le coût annuel d'un ETP par pays et par année (administrateur). Un montant se convertit en jours par :
 *   jours = montant ÷ (coût annuel de l'ETP du pays ÷ jours ouvrés de l'année dans le pays) ; le pays est celui de l'équipe ; sans coût paramétré : null (« à paramétrer »), jamais un faux chiffre.
 *
 * Droits : exercise.read (Workpackage leader et au-dessus, en profondeur) ; exercise.edit (chef de projet et au-dessus) saisit l'attendu et l'accordé de son projet ; exercices et coût d'un ETP :
 * administrateur.
 */

// ---------------------------------------------------------------- coût d'un ETP et conversion en jours

var ETP_MEMO_ = { days: {}, cost: {} };
/** Mémo par requête (les calculs de jours ouvrés parcourent l'année) : à remettre à zéro à l'entrée d'une action. */
function etpReset_() { ETP_MEMO_ = { days: {}, cost: {} }; }

/** Les jours ouvrés d'une année dans un pays : du lundi au vendredi, sans les jours fériés du pays. */
function etpWorkingDays_(country, year) {
  var k = country + '|' + year;
  if (ETP_MEMO_.days[k] !== undefined) return ETP_MEMO_.days[k];
  var hol = loadHolidayMap(country), n = 0;
  for (var d = year + '-01-01'; d <= year + '-12-31'; d = addCalendarDays(d, 1)) if (isWorkingDay(d, hol)) n++;
  return (ETP_MEMO_.days[k] = n);
}

/** Le coût annuel d'un ETP du pays pour l'année, ou null s'il n'est pas paramétré. */
function etpCostOf_(country, year) {
  var k = country + '|' + year;
  if (ETP_MEMO_.cost[k] !== undefined) return ETP_MEMO_.cost[k];
  var row = repoList('EtpCost', function (r) { return r.country === country && Number(r.year) === Number(year); })[0];
  return (ETP_MEMO_.cost[k] = row && Number(row.annual_cost) > 0 ? Number(row.annual_cost) : null);
}

/** Un montant en jours (une décimale), ou null si le coût d'un ETP du pays et de l'année n'est pas paramétré. */
function daysFromAmount_(amount, country, year) {
  var cost = etpCostOf_(country, year), wd = etpWorkingDays_(country, year);
  if (!cost || !wd) return null;
  return Math.round(Number(amount) / (cost / wd) * 10) / 10;
}

defineAction('etp.list', function (p, ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Le coût d’un ETP est réservé à l’administrateur.');
  etpReset_();
  var rows = repoList('EtpCost').map(function (r) {
    var wd = etpWorkingDays_(r.country, Number(r.year));
    return { id: r.id, version: r.version, country: r.country, year: Number(r.year), annual_cost: Number(r.annual_cost), working_days: wd, day_cost: wd ? round2(Number(r.annual_cost) / wd) : null };   // le coût d'un jour ouvré, qui sert à convertir
  })
    .sort(function (a, b) { return a.country.localeCompare(b.country) || b.year - a.year; });
  return { costs: rows, countries: COUNTRIES };
});

defineAction('etp.set', function (p, ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Le coût d’un ETP est réservé à l’administrateur.');
  var v = p.values || {};
  if (COUNTRIES.indexOf(v.country) < 0) throw new PpmError('VALIDATION', 'Pays inconnu : ' + COUNTRIES.join(', ') + '.');
  var year = Number(v.year);
  if (isBlank(v.year) || isNaN(year) || year % 1 !== 0 || year < 2000 || year > 2100) throw new PpmError('VALIDATION', 'Année : un nombre entre 2000 et 2100.');
  var cost = Number(String(v.annual_cost).replace(',', '.'));
  if (isBlank(v.annual_cost) || isNaN(cost) || cost <= 0 || cost > 10000000) throw new PpmError('VALIDATION', 'Coût annuel d’un ETP : un nombre positif.');
  return withLock(function () {
    var same = repoList('EtpCost', function (r) { return r.country === v.country && Number(r.year) === year && r.id !== p.id; })[0];
    var values = { country: v.country, year: year, annual_cost: round2(cost) };
    if (isBlank(p.id) && same) return repoUpdate('EtpCost', same.id, values, null, ctx.actx);   // un seul coût par pays et par année : on le remplace
    if (!isBlank(p.id) && same) throw new PpmError('VALIDATION', 'Ce pays a déjà un coût pour cette année : modifiez-le.');
    return isBlank(p.id) ? repoInsert('EtpCost', values, ctx.actx) : repoUpdate('EtpCost', p.id, values, p.version, ctx.actx);
  });
});

defineAction('etp.delete', function (p, ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Le coût d’un ETP est réservé à l’administrateur.');
  return repoSoftDelete('EtpCost', requireParam(p, 'id'), p.version, ctx.actx);
});

// ---------------------------------------------------------------- les exercices

/** Le niveau budgétaire d'une équipe, lu au nombre de caractères de son nom : 3 (porte le budget), 4 (détail, s'additionne dans sa parente à 3), 0 (hors règle). */
function teamLevel_(t) { var n = String((t && t.name) || '').trim().length; return n === 3 ? 3 : (n === 4 ? 4 : 0); }

function exerciseView_(e) { return { id: e.id, version: e.version, year: Number(e.year), status: e.status }; }

defineAction('exercise.list', function (p, ctx) {
  return { exercises: repoList('Exercise').map(exerciseView_).sort(function (a, b) { return b.year - a.year; }) };
});

defineAction('exercise.create', function (p, ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Créer un exercice est réservé à l’administrateur.');
  var year = Number(p.year);
  if (isBlank(p.year) || isNaN(year) || year % 1 !== 0 || year < 2000 || year > 2100) throw new PpmError('VALIDATION', 'Année : un nombre entre 2000 et 2100.');
  return withLock(function () {
    var all = repoList('Exercise');
    if (all.some(function (e) { return Number(e.year) === year; })) throw new PpmError('VALIDATION', 'L’exercice ' + year + ' existe déjà.');
    var prep = all.filter(function (e) { return e.status === 'Préparation'; })[0];
    if (prep) throw new PpmError('VALIDATION', 'L’exercice ' + prep.year + ' est déjà en préparation : un seul à la fois (passez-le en exécution d’abord).');
    return exerciseView_(repoInsert('Exercise', { year: year, status: 'Préparation' }, ctx.actx));
  });
});

/** Préparation → Exécution (s'il n'y en a pas déjà un) → Clos. On ne revient pas en arrière. */
defineAction('exercise.setStatus', function (p, ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Changer l’état d’un exercice est réservé à l’administrateur.');
  var e = mustGet('Exercise', requireParam(p, 'id')), to = String(p.status || '');
  var next = { 'Préparation': 'Exécution', 'Exécution': 'Clos' };
  if (next[e.status] !== to) throw new PpmError('VALIDATION', 'L’exercice ' + e.year + ' est en ' + e.status.toLowerCase() + (next[e.status] ? ' : il ne peut passer qu’en ' + next[e.status].toLowerCase() + '.' : ' : on ne le rouvre pas.'));
  return withLock(function () {
    var busy = repoList('Exercise', function (x) { return x.status === to && x.id !== e.id; })[0];
    if (to === 'Exécution' && busy) throw new PpmError('VALIDATION', 'L’exercice ' + busy.year + ' est déjà en exécution : clôturez-le d’abord.');
    return exerciseView_(repoUpdate('Exercise', e.id, { status: to }, p.version, ctx.actx));
  });
});

/**
 * Contrôle de l'exercice d'une part de budget : un livrable n'a qu'un exercice (celui de sa première part) et rien ne change dans un exercice clos. Rend l'exercice concerné ou null.
 */
function exerciseForLine_(deliverable, exerciseId) {
  var current = isBlank(deliverable.exercise_id) ? null : repoGet('Exercise', deliverable.exercise_id);
  if (current && current.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + current.year + ' est clos : on n’y change plus rien.');
  if (isBlank(exerciseId)) return current;
  var ex = mustGet('Exercise', exerciseId);
  if (current && current.id !== ex.id) throw new PpmError('VALIDATION', 'Ce livrable appartient à l’exercice ' + current.year + ' : un livrable n’a qu’un exercice.');
  if (ex.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + ex.year + ' est clos : on n’y change plus rien.');
  return ex;
}

/** Rattacher un livrable à un exercice avant de le chiffrer (ou l'en retirer tant qu'il n'a aucune ligne de budget). */
defineAction('budget.deliverable.exercise', function (p, ctx) {
  var item = mustGet('PlanItem', requireParam(p, 'deliverableId'));
  if (item.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'Seul un livrable a un exercice.');
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: item.id });
  return withLock(function () {
    var hasLines = repoList('BudgetLine', function (l) { return l.deliverable_id === item.id; }).length > 0;
    var current = isBlank(item.exercise_id) ? null : repoGet('Exercise', item.exercise_id);
    if (current && current.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + current.year + ' est clos : on n’y change plus rien.');
    var target = null;
    if (!isBlank(p.exerciseId)) {
      target = mustGet('Exercise', p.exerciseId);
      if (target.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + target.year + ' est clos : on n’y change plus rien.');
    }
    if ((current ? current.id : '') === (target ? target.id : '')) return { deliverable_id: item.id, exercise_id: target ? target.id : '' };
    // un livrable chiffré AVANT l'existence des exercices (aucun exercice) peut être rattaché ; un livrable déjà dans un exercice et chiffré n'en change plus
    if (hasLines && current) throw new PpmError('VALIDATION', 'Ce livrable a déjà du budget dans l’exercice ' + current.year + ' : un livrable n’a qu’un exercice.');
    repoUpdate('PlanItem', item.id, { exercise_id: target ? target.id : '' }, null, ctx.actx);
    return { deliverable_id: item.id, exercise_id: target ? target.id : '' };
  });
});

// ---------------------------------------------------------------- le tableau d'un exercice

/**
 * Les données d'un exercice pour des projets : budgets d'équipe, livrables de l'exercice et leurs parts par équipe.
 */
function exerciseData_(ex, projectIds) {
  var inProj = {}; projectIds.forEach(function (id) { inProj[id] = true; });
  var teams = repoList('HierarchicalTeam'), items = repoList('PlanItem', function (i) { return inProj[i.project_id] && i.item_type === 'Livrable' && i.exercise_id === ex.id; });
  var itemById = indexBy_(items);
  return {
    teams: teams, teamById: indexBy_(teams), items: items, itemById: itemById,
    budgets: repoList('TeamBudget', function (b) { return b.exercise_id === ex.id && inProj[b.project_id]; }),
    lines: repoList('BudgetLine', function (l) { return l.cost_type === 'Équipe' && itemById[l.deliverable_id]; })
  };
}

/**
 * Le tableau par équipe : une ligne par équipe à 3 caractères (avec ses équipes à 4 caractères en détail), attendu · accordé · parts · écarts. Les équipes à 4 caractères sans parente à 3
 * caractères (`orphans`) et les équipes hors règle (`unruled`) sont à part, car elles ne s'additionnent nulle part. `projectId` restreint à un projet (sinon tous ceux de `data`).
 */
function exerciseTable_(ex, data, projectId) {
  var rows = {}, orphans = {}, unruled = {};
  var make = function (t) { return { team_id: t.id, name: t.name, country: t.country || 'FR', expected: null, granted: null, parts: 0, own: { expected: null, granted: null, parts: 0 }, children: {} }; };
  var locate = function (t) {
    var lvl = teamLevel_(t);
    if (lvl === 3) return { map: rows, root: t, child: null };
    if (lvl === 4) {
      var par = isBlank(t.parent_team_id) ? null : data.teamById[t.parent_team_id];
      return par && teamLevel_(par) === 3 && !isTrue(par.deleted) ? { map: rows, root: par, child: t } : { map: orphans, root: t, child: null };
    }
    return { map: unruled, root: t, child: null };
  };
  var addTo = function (rec, field, v) { rec[field] = (rec[field] === null ? 0 : rec[field]) + v; };
  var apply = function (t, field, v) {
    if (!t || isTrue(t.deleted)) return;
    var loc = locate(t), row = loc.map[loc.root.id] = loc.map[loc.root.id] || make(loc.root);
    addTo(row, field, v);
    if (loc.child) { var ch = row.children[loc.child.id] = row.children[loc.child.id] || { team_id: loc.child.id, name: loc.child.name, expected: null, granted: null, parts: 0 }; addTo(ch, field, v); }
    else addTo(row.own, field, v);
  };
  data.budgets.forEach(function (b) {
    if (projectId && b.project_id !== projectId) return;
    var t = data.teamById[b.team_id];
    if (!isBlank(b.expected)) apply(t, 'expected', Number(b.expected));
    if (!isBlank(b.granted)) apply(t, 'granted', Number(b.granted));
  });
  data.lines.forEach(function (l) {
    var it = data.itemById[l.deliverable_id];
    if (!it || (projectId && it.project_id !== projectId)) return;
    apply(data.teamById[l.team_id], 'parts', Number(l.planned_amount) || 0);
  });
  var finish = function (r) {
    var days = function (x) { return x === null ? null : daysFromAmount_(x, r.country, Number(ex.year)); };
    ['expected', 'granted', 'parts'].forEach(function (f) { if (r[f] !== null) r[f] = round2(r[f]); });
    return Object.assign(r, {
      gap_expected: r.expected === null ? null : round2(r.expected - r.parts),
      gap_granted: r.granted === null ? null : round2(r.granted - r.parts),
      clash: r.granted !== null && r.parts > r.granted,
      expected_days: days(r.expected), granted_days: days(r.granted), parts_days: days(r.parts),
      children: Object.keys(r.children).map(function (k) { return r.children[k]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); })
    });
  };
  var list = function (m) { return Object.keys(m).map(function (k) { return finish(m[k]); }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }); };
  var out = { rows: list(rows), orphans: list(orphans), unruled: list(unruled) };
  var sum = function (f) { var any = false, t = 0; out.rows.concat(out.orphans, out.unruled).forEach(function (r) { if (r[f] !== null) { any = true; t += r[f]; } }); return any ? round2(t) : null; };
  out.totals = { expected: sum('expected'), granted: sum('granted'), parts: round2(out.rows.concat(out.orphans, out.unruled).reduce(function (a, r) { return a + r.parts; }, 0)) };
  out.totals.gap_expected = out.totals.expected === null ? null : round2(out.totals.expected - out.totals.parts);
  out.totals.gap_granted = out.totals.granted === null ? null : round2(out.totals.granted - out.totals.parts);
  out.totals.clash = out.totals.granted !== null && out.totals.parts > out.totals.granted;
  return out;
}

function exerciseTeamChoices_(teams) {
  var byId = indexBy_(teams);
  return teams.filter(function (t) { return teamLevel_(t) > 0; }).map(function (t) {
    var par = isBlank(t.parent_team_id) ? null : byId[t.parent_team_id];
    return { id: t.id, name: t.name, level: teamLevel_(t), country: t.country || 'FR', parent: par ? par.name : '', orphan: teamLevel_(t) === 4 && !(par && teamLevel_(par) === 3) };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
}

defineAction('exercise.get', function (p, ctx) {
  etpReset_();
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'exercise.read', { type: 'project', id: project.id });
  var ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  var data = exerciseData_(ex, [project.id]), table = exerciseTable_(ex, data, project.id);
  var canEdit = ctx.isAdmin || can(ctx, 'exercise.edit', { type: 'project', id: project.id });
  var countries = {};
  table.rows.concat(table.orphans, table.unruled).forEach(function (r) { countries[r.country] = true; });
  return Object.assign({
    exercise: exerciseView_(ex), project: { id: project.id, code: project.code, name: project.name },
    can_edit: canEdit && ex.status !== 'Clos', can_edit_expected: canEdit && ex.status === 'Préparation', can_edit_granted: canEdit && ex.status !== 'Clos',
    teams: exerciseTeamChoices_(data.teams),
    etp_missing: Object.keys(countries).filter(function (c) { return etpCostOf_(c, Number(ex.year)) === null; }).sort(),
    deliverables: data.items.length
  }, table);
});

/** La vue d'un programme : un total par projet (ceux que l'on peut lire) et un tableau par équipe tous projets confondus. */
defineAction('exercise.program', function (p, ctx) {
  etpReset_();
  var program = mustGet('Program', requireParam(p, 'programId'));
  var ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  var projects = repoList('Project', function (x) { return x.program_id === program.id; })
    .filter(function (x) { return ctx.isAdmin || can(ctx, 'exercise.read', { type: 'project', id: x.id }); });
  if (!projects.length && !ctx.isAdmin) throw new PpmError('FORBIDDEN', 'L’exercice est réservé aux Workpackage leaders et aux niveaux au-dessus.');
  var data = exerciseData_(ex, projects.map(function (x) { return x.id; }));
  var perProject = projects.map(function (x) {
    var t = exerciseTable_(ex, data, x.id).totals;
    return { id: x.id, code: x.code, name: x.name, expected: t.expected, granted: t.granted, parts: t.parts, gap_expected: t.gap_expected, gap_granted: t.gap_granted, clash: t.clash };
  }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
  var table = exerciseTable_(ex, data, '');
  return Object.assign({ exercise: exerciseView_(ex), program: { id: program.id, code: program.code, name: program.name }, projects: perProject }, table);
});

/**
 * Saisir l'attendu et/ou l'accordé d'une équipe sur un projet. Le chef de projet et au-dessus. L'attendu se fige quand l'exercice passe en exécution ; l'accordé reste modifiable
 * (février, avril) jusqu'à la clôture. Une valeur vide efface ; une ligne sans aucune valeur disparaît.
 */
defineAction('exercise.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'exercise.edit', { type: 'project', id: project.id });
  var ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  if (ex.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + ex.year + ' est clos : on n’y change plus rien.');
  var team = mustGet('HierarchicalTeam', requireParam(p, 'teamId'));
  var lvl = teamLevel_(team);
  if (!lvl) throw new PpmError('VALIDATION', 'Le budget se saisit par équipe dont le nom a 3 ou 4 caractères (« ' + team.name + ' » en a ' + String(team.name).trim().length + ').');
  if (lvl === 4) {
    var par = isBlank(team.parent_team_id) ? null : repoGet('HierarchicalTeam', team.parent_team_id);
    if (!par || teamLevel_(par) !== 3) throw new PpmError('VALIDATION', 'L’équipe « ' + team.name + ' » (4 caractères) doit être rattachée à une équipe de 3 caractères pour s’additionner dans sa parente.');
  }
  var touched = ['expected', 'granted'].filter(function (f) { return f in p; });
  if (!touched.length) throw new PpmError('VALIDATION', 'Rien à enregistrer : donnez l’attendu ou l’accordé.');
  if (touched.indexOf('expected') >= 0 && ex.status !== 'Préparation') throw new PpmError('VALIDATION', 'Le budget attendu est figé : l’exercice ' + ex.year + ' est en ' + ex.status.toLowerCase() + '.');
  var values = {};
  touched.forEach(function (f) {
    if (isBlank(p[f])) { values[f] = ''; return; }
    var n = Number(String(p[f]).replace(',', '.'));
    if (isNaN(n) || n < 0 || n > 1e10) throw new PpmError('VALIDATION', (f === 'expected' ? 'Budget attendu' : 'Budget accordé') + ' : un nombre positif ou nul.');
    values[f] = round2(n);
  });
  return withLock(function () {
    var row = repoList('TeamBudget', function (b) { return b.exercise_id === ex.id && b.project_id === project.id && b.team_id === team.id; })[0];
    if (!row) {
      if (touched.every(function (f) { return values[f] === ''; })) return { saved: false };
      repoInsert('TeamBudget', Object.assign({ exercise_id: ex.id, project_id: project.id, team_id: team.id, expected: '', granted: '' }, values), ctx.actx);
      return { saved: true };
    }
    var next = Object.assign({ expected: row.expected, granted: row.granted }, values);
    if (isBlank(next.expected) && isBlank(next.granted)) { repoSoftDelete('TeamBudget', row.id, null, ctx.actx); return { saved: true, removed: true }; }
    repoUpdate('TeamBudget', row.id, values, null, ctx.actx);
    return { saved: true };
  });
});
