/**
 * PPM Core — lot 4 : simulation « et si… », synthèse chiffrée, signaux faibles (section 9).
 *
 * Tout ce fichier est déterministe : il ne fait jamais appel à Gemini. Il fournit les chiffres
 * que le copilote cite (le modèle n'en invente aucun) et fonctionne même copilote désactivé.
 * Fonctions pures, testées hors ligne.
 */

// ---------------------------------------------------------------- simulation

/**
 * Applique des hypothèses de décalage à une copie du planning et propage l'effet domino
 * aux successeurs (mêmes conventions de dépendance que dependencyViolations).
 *
 *   items   : PlanItem[] du projet, plus les voisins d'autres projets marqués external: true ;
 *   deps    : Dependency[] ;
 *   changes : [{ itemId, shiftDays }] (jours ouvrés, négatif = avancer) ou [{ itemId, finish }] ;
 *   opts    : { requirements, baselineFinish: { id: date }, projectId }.
 *
 * Un successeur n'est repoussé que si la contrainte l'exige ; rien n'est jamais avancé
 * automatiquement (H7). Un élément d'un autre projet n'est pas déplacé : l'impact est signalé.
 * Rien n'est écrit : le résultat décrit l'avant et l'après.
 */
function simulateChanges(items, deps, holFor, changes, opts) {
  opts = opts || {};
  var hol = function (it) { return holFor(it.project_id); };
  var before = {}, sim = {};
  items.forEach(function (i) {
    if (isTrue(i.deleted)) return;
    var rec = {
      id: i.id, name: i.name, item_type: i.item_type, project_id: i.project_id, external: !!i.external,
      planned_start: itemStart(i) || '', planned_finish: itemFinish(i) || '', status: i.status, progress_pct: i.progress_pct
    };
    before[i.id] = rec;
    sim[i.id] = Object.assign({}, rec);
  });
  var shift = function (it, n) {
    if (!n) return;
    var h = hol(it);
    if (!isBlank(it.planned_start)) it.planned_start = addWorkingDays(it.planned_start, n, h);
    if (!isBlank(it.planned_finish)) it.planned_finish = addWorkingDays(it.planned_finish, n, h);
  };

  var moved = {}, queue = [], notes = [];
  (changes || []).forEach(function (ch) {
    var it = sim[ch.itemId];
    if (!it) throw new PpmError('VALIDATION', 'Élément introuvable dans le périmètre simulé : ' + ch.itemId);
    if (it.external) throw new PpmError('VALIDATION', '« ' + it.name + ' » appartient à un autre projet : simulez depuis ce projet.');
    if (isBlank(it.planned_finish)) throw new PpmError('VALIDATION', '« ' + it.name + ' » n’a pas de date : rien à décaler.');
    var n;
    if (!isBlank(ch.finish)) n = workingDayOffset(it.planned_finish, String(ch.finish), hol(it));
    else n = Math.round(Number(ch.shiftDays) || 0);
    if (Math.abs(n) > 500) throw new PpmError('VALIDATION', 'Décalage trop grand (500 jours ouvrés au plus).');
    shift(it, n);
    moved[it.id] = { cause: 'hypothesis', shift: n };
    if (n < 0) notes.push('« ' + it.name + ' » avancé : ses successeurs ne sont pas avancés automatiquement (le planning n’est jamais recalculé seul).');
    queue.push(it.id);
  });

  var out = {};
  deps.forEach(function (d) { if (!isTrue(d.deleted)) (out[d.predecessor_id] = out[d.predecessor_id] || []).push(d); });
  var external = {}, guard = 0;
  while (queue.length && guard++ < 20000) {
    var p = sim[queue.shift()];
    (out[p.id] || []).forEach(function (d) {
      var s = sim[d.successor_id];
      if (!s) return;
      // On ne propage que le surcroît de contrainte dû à l'hypothèse : une dépendance déjà non respectée
      // avant l'hypothèse le reste d'autant (la simulation mesure l'effet de l'hypothèse, elle ne corrige pas le plan).
      var req = requiredDate_(d, p, s, hol(s));
      var req0 = requiredDate_(d, before[p.id], s, hol(s));
      if (!req) return;
      var floor = req0 && req0.required > req.actual ? req0.required : req.actual;
      if (floor >= req.required) return;
      var gap = workingDayOffset(floor, req.required, hol(s));
      if (s.external) {
        var prev = external[s.id];
        if (!prev || gap > prev.gap) external[s.id] = { id: s.id, name: s.name, project_id: s.project_id, gap: gap, required: req.required, actual: req.actual, because: p.name };
        return;
      }
      shift(s, gap);
      moved[s.id] = { cause: p.id, shift: ((moved[s.id] && moved[s.id].shift) || 0) + gap };
      queue.push(s.id);
    });
  }

  var already = dependencyViolations(Object.keys(before).map(function (k) { return before[k]; }), deps, holFor).length;
  if (already) {
    notes.push(already + (already > 1 ? ' dépendances étaient déjà non respectées' : ' dépendance était déjà non respectée') +
      ' avant l’hypothèse : la simulation ne les corrige pas, elle mesure seulement l’effet de l’hypothèse.');
  }

  // Résultats : éléments déplacés, fin du plan, jalons, chemin critique.
  var own = function (m) { return Object.keys(m).map(function (k) { return m[k]; }).filter(function (i) { return !i.external; }); };
  var lastFinish = function (m) { var f = ''; own(m).forEach(function (i) { if (i.planned_finish > f) f = i.planned_finish; }); return f || null; };
  var anyHol = holFor(opts.projectId || (own(before)[0] || {}).project_id);
  var endBefore = lastFinish(before), endAfter = lastFinish(sim);
  var baseFinish = opts.baselineFinish || {};
  var movedList = Object.keys(moved).map(function (id) {
    var b = before[id], a = sim[id], m = moved[id];
    return {
      id: id, name: a.name, item_type: a.item_type, cause: m.cause === 'hypothesis' ? 'hypothèse' : (sim[m.cause] ? sim[m.cause].name : ''),
      hypothesis: m.cause === 'hypothesis', before_start: b.planned_start || null, before_finish: b.planned_finish,
      start: a.planned_start || null, finish: a.planned_finish, shift: workingDayOffset(b.planned_finish, a.planned_finish, hol(a)),
      baseline_finish: baseFinish[id] || null,
      slip_vs_baseline: baseFinish[id] ? workingDayOffset(baseFinish[id], a.planned_finish, hol(a)) : null
    };
  }).sort(function (x, y) { return (y.hypothesis - x.hypothesis) || String(x.finish).localeCompare(String(y.finish)); });

  var threatened = function (m) {
    var outList = [];
    (opts.requirements || []).forEach(function (r) {
      if (isTrue(r.deleted)) return;
      var ms = m[r.milestone_id], dl = m[r.deliverable_id];
      if (!ms || !dl || ms.external || isBlank(ms.planned_finish) || isBlank(dl.planned_finish)) return;
      if (dl.status === 'Terminé' || Number(dl.progress_pct) >= 100) return;
      if (dl.planned_finish > ms.planned_finish) outList.push(ms.id + '|' + dl.id);
    });
    return outList;
  };
  var thrBefore = {}, thrAfter = threatened(sim);
  threatened(before).forEach(function (k) { thrBefore[k] = true; });
  var newlyThreatened = thrAfter.filter(function (k) { return !thrBefore[k]; }).map(function (k) {
    var ids = k.split('|');
    return { milestone: sim[ids[0]].name, milestone_date: sim[ids[0]].planned_finish, deliverable: sim[ids[1]].name, deliverable_finish: sim[ids[1]].planned_finish };
  });

  var listOf = function (m) { return Object.keys(m).map(function (k) { return m[k]; }); };
  var liveDeps = deps.filter(function (d) { return !isTrue(d.deleted); });
  var fBefore = computeFloats(listOf(before), liveDeps, holFor), fAfter = computeFloats(listOf(sim), liveDeps, holFor);
  var critBefore = {};
  fBefore.criticalIds.forEach(function (id) { critBefore[id] = true; });
  var newlyCritical = fAfter.criticalIds.filter(function (id) { return !critBefore[id] && sim[id] && !sim[id].external; })
    .map(function (id) { return sim[id].name; });

  return {
    changes: movedList.filter(function (m) { return m.hypothesis; }),
    moved: movedList,
    domino: movedList.filter(function (m) { return !m.hypothesis; }).length,
    plan_end: { before: endBefore, after: endAfter, shift: endBefore && endAfter ? workingDayOffset(endBefore, endAfter, anyHol) : null },
    milestones: movedList.filter(function (m) { return m.item_type === 'Jalon'; }),
    newly_threatened: newlyThreatened,
    external_impacts: Object.keys(external).map(function (k) { return external[k]; }),
    newly_critical: newlyCritical,
    notes: notes
  };
}

/** Date exigée par une dépendance pour le successeur, selon les dates simulées du prédécesseur. */
function requiredDate_(d, p, s, hol) {
  var lag = Math.round(Number(d.lag_days || 0));
  var ref, actual, required;
  switch (d.dep_type) {
    case 'FS':
      ref = p.planned_finish; actual = s.planned_start || s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      var offset = (p.item_type === 'Jalon' ? 0 : 1) + lag;
      required = offset === 0 ? nextWorkingDay(ref, hol) : addWorkingDays(ref, offset, hol);
      break;
    case 'SS':
      ref = p.planned_start || p.planned_finish; actual = s.planned_start || s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    case 'FF':
      ref = p.planned_finish; actual = s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    case 'SF':
      ref = p.planned_start || p.planned_finish; actual = s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    default:
      return null;
  }
  return { required: required, actual: actual };
}

// ---------------------------------------------------------------- signaux faibles

/** Mots qui annoncent souvent un glissement avant qu'il n'apparaisse dans les dates (FR, EN, DE). */
var WEAK_SIGNAL_RE = /bloqu|en attente|attend(?:ons|re) (?:le |la |les )?(?:fournisseur|retour|validation|livraison)|pas (?:encore )?re[çc]u|non re[çc]u|manque|p[ée]nurie|rupture|probl[èe]me|difficult|retard|report[ée]|suspendu|arr[êe]t[ée]?|panne|non conforme|blocked|waiting|delay|missing|issue|verz[öo]ger|warten|fehlt/i;

/**
 * Derniers commentaires d'avancement (depuis `since`) qui contiennent un mot de blocage,
 * sur des livrables non terminés. Un seul signal par livrable : le plus récent.
 */
function weakSignals_(updates, items, since) {
  var live = {};
  items.forEach(function (i) {
    if (!isTrue(i.deleted) && i.item_type === 'Livrable' && i.status !== 'Terminé' && Number(i.progress_pct) < 100) live[i.id] = i;
  });
  var last = {};
  (updates || []).forEach(function (u) {
    if (isTrue(u.deleted) || !live[u.deliverable_id] || isBlank(u.comment)) return;
    var at = String(u.declared_at || u.created_at || '');
    if (at.slice(0, 10) < since) return;
    if (!last[u.deliverable_id] || at > last[u.deliverable_id].at) last[u.deliverable_id] = { at: at, comment: String(u.comment) };
  });
  var out = [];
  Object.keys(last).forEach(function (id) {
    var m = WEAK_SIGNAL_RE.exec(last[id].comment);
    if (!m) return;
    out.push({ item: live[id], date: last[id].at.slice(0, 10), comment: truncate(last[id].comment, 200), word: m[0] });
  });
  return out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

// ---------------------------------------------------------------- synthèse chiffrée

/**
 * Faits chiffrés d'un projet, calculés par le Core : c'est tout ce que le copilote a le droit de citer.
 * data : { projects, programs, workpackages, planitems, dependencies, resources, insights, risks,
 *          requirements, progressUpdates, baseline: { row, snap } | null, pendingChanges, pendingRequests }
 * Aucun montant ni taux journalier n'y figure (section 9, garde-fous).
 */
function buildProjectBrief(data, projectId, today, holFor) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var hol = holFor(projectId);
  var res = indexBy_(data.resources);
  var name = function (id) { return !isBlank(id) && res[id] ? res[id].name : ''; };
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; });
  var floats = computeFloats(items, deps, holFor);
  var done = function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; };
  var baseItems = data.baseline ? data.baseline.snap.PlanItem : {};
  var dated = items.filter(function (i) { return !isBlank(i.planned_finish); });
  var planEnd = dated.reduce(function (a, i) { return i.planned_finish > a ? i.planned_finish : a; }, '') || null;
  var baseEnd = Object.keys(baseItems).reduce(function (a, id) { var f = baseItems[id].planned_finish; return !isBlank(f) && f > a ? f : a; }, '') || null;

  var late = items.filter(function (i) { return !done(i) && !isBlank(i.planned_finish) && i.planned_finish < today; }).map(function (i) {
    return { name: i.name, type: i.item_type, finish: i.planned_finish, days_late: workingDayOffset(i.planned_finish, today, hol), owner: name(i.owner_resource_id) };
  }).sort(function (a, b) { return b.days_late - a.days_late; });

  var horizon = addCalendarDays(today, 90);
  var req = data.requirements || [];
  var milestones = items.filter(function (i) { return i.item_type === 'Jalon' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today && i.planned_finish <= horizon; })
    .sort(function (a, b) { return a.planned_finish.localeCompare(b.planned_finish); }).slice(0, 6).map(function (m) {
      var b = baseItems[m.id];
      var threats = req.filter(function (r) { return !isTrue(r.deleted) && r.milestone_id === m.id; }).map(function (r) {
        return items.filter(function (i) { return i.id === r.deliverable_id; })[0];
      }).filter(function (dl) { return dl && !done(dl) && !isBlank(dl.planned_finish) && dl.planned_finish > m.planned_finish; });
      return {
        name: m.name, date: m.planned_finish, in_days: Math.round((parseYmd(m.planned_finish) - parseYmd(today)) / DAY_MS),
        slip_vs_baseline: b && !isBlank(b.planned_finish) ? workingDayOffset(b.planned_finish, m.planned_finish, hol) : null,
        threatened_by: threats.map(function (t) { return t.name; })
      };
    });

  var soon = addCalendarDays(today, 14);
  var dueSoon = items.filter(function (i) { return i.item_type === 'Livrable' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today && i.planned_finish <= soon; })
    .sort(function (a, b) { return a.planned_finish.localeCompare(b.planned_finish); }).slice(0, 8)
    .map(function (i) { return { name: i.name, finish: i.planned_finish, progress_pct: Number(i.progress_pct) || 0, owner: name(i.owner_resource_id), critical: !!(floats.byId[i.id] || {}).critical }; });

  var insights = (data.insights || []).filter(function (x) { return !isTrue(x.deleted) && x.project_id === projectId && x.status === 'Nouveau'; });
  var sev = function (s) { return insights.filter(function (x) { return x.severity === s; }); };
  var risks = (data.risks || []).filter(function (r) { return !isTrue(r.deleted) && r.project_id === projectId && r.status !== 'Clos' && r.kind !== 'Opportunité'; })
    .sort(function (a, b) { return (Number(b.score) || 0) - (Number(a.score) || 0); });
  var signals = weakSignals_(data.progressUpdates, items, addCalendarDays(today, -THRESHOLDS.staleProgressDays));
  var violations = dependencyViolations(items, deps, holFor).length;
  var program = !isBlank(project.program_id) ? indexBy_(data.programs || [])[project.program_id] : null;

  var facts = {
    today: today,
    project: { code: project.code, name: project.name, status: project.status || '', manager: name(project.manager_resource_id),
      program: program ? program.name : '', target_end: project.end_date || null },
    baseline: data.baseline ? { label: data.baseline.row.label || 'B' + data.baseline.row.number, frozen_on: String(data.baseline.row.decided_at || '').slice(0, 10) } : null,
    progress: {
      weighted_pct: weightedProgress_(items, holFor), items: items.length,
      done: items.filter(done).length, in_progress: items.filter(function (i) { return !done(i) && Number(i.progress_pct) > 0; }).length
    },
    schedule: {
      plan_end: planEnd, target_end: project.end_date || null,
      margin_to_target: planEnd && project.end_date ? workingDayOffset(planEnd, project.end_date, hol) : null,
      baseline_end: baseEnd, slip_vs_baseline: planEnd && baseEnd ? workingDayOffset(baseEnd, planEnd, hol) : null,
      critical_items: floats.criticalIds.length, dependency_violations: violations
    },
    late: late.slice(0, 8), late_count: late.length,
    upcoming_milestones: milestones,
    due_soon: dueSoon,
    insights: { alerte: sev('Alerte').length, vigilance: sev('Vigilance').length, info: sev('Info').length,
      top: sev('Alerte').concat(sev('Vigilance')).slice(0, 5).map(function (x) { return x.message; }) },
    risks: { open: risks.length, top: risks.slice(0, 3).map(function (r) { return { title: r.title, score: Number(r.score) || null, owner: name(r.owner_resource_id) }; }) },
    changes_pending: data.pendingChanges || 0,
    baseline_requests_pending: data.pendingRequests || 0,
    weak_signals: signals.slice(0, 5).map(function (s) { return { item: s.item.name, date: s.date, comment: s.comment }; })
  };
  return { facts: facts, lines: briefLines_(facts) };
}

/** Synthèse rédigée par le Core, sans IA : elle reprend les faits, en phrases courtes. */
function briefLines_(f) {
  var fr = function (s) { return s ? frDate_(s) : '—'; };
  var pl = function (n, one, many) { return n + ' ' + (Math.abs(n) > 1 ? many : one); };
  var out = [];
  var st = f.schedule;
  var head = 'Avancement ' + f.progress.weighted_pct + ' % (' + pl(f.progress.done, 'élément terminé', 'éléments terminés') + ' sur ' + f.progress.items + ').';
  if (st.plan_end) head += ' Fin du plan le ' + fr(st.plan_end);
  if (st.margin_to_target !== null) head += st.margin_to_target >= 0 ? ', ' + pl(st.margin_to_target, 'jour ouvré', 'jours ouvrés') + ' de marge sur la fin visée (' + fr(st.target_end) + ')' : ', ' + pl(-st.margin_to_target, 'jour ouvré', 'jours ouvrés') + ' après la fin visée (' + fr(st.target_end) + ')';
  out.push({ tone: st.margin_to_target !== null && st.margin_to_target < 0 ? 'alert' : '', text: head + (st.plan_end ? '.' : '') });
  if (f.baseline) {
    out.push({ tone: st.slip_vs_baseline > 0 ? 'alert' : '', text: st.slip_vs_baseline === null ? 'Baseline ' + f.baseline.label + ' figée le ' + fr(f.baseline.frozen_on) + '.'
      : st.slip_vs_baseline > 0 ? 'La fin du plan a glissé de ' + pl(st.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' depuis la baseline ' + f.baseline.label + '.'
        : st.slip_vs_baseline < 0 ? 'La fin du plan est en avance de ' + pl(-st.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' sur la baseline ' + f.baseline.label + '.'
          : 'La fin du plan tient la baseline ' + f.baseline.label + '.' });
  } else {
    out.push({ tone: '', text: 'Pas de baseline : les écarts ne sont pas mesurés.' });
  }
  if (f.late_count) out.push({ tone: 'alert', text: pl(f.late_count, 'élément en retard', 'éléments en retard') + ', dont « ' + f.late[0].name + ' » (' + pl(f.late[0].days_late, 'jour ouvré', 'jours ouvrés') + ').' });
  if (st.dependency_violations) out.push({ tone: 'alert', text: pl(st.dependency_violations, 'dépendance non respectée', 'dépendances non respectées') + '.' });
  f.upcoming_milestones.slice(0, 3).forEach(function (m) {
    var t = 'Jalon « ' + m.name + ' » le ' + fr(m.date) + ' (dans ' + pl(m.in_days, 'jour', 'jours') + ')';
    if (m.threatened_by.length) t += ', menacé par « ' + m.threatened_by[0] + ' »';
    else if (m.slip_vs_baseline > 0) t += ', ' + pl(m.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' après la baseline';
    out.push({ tone: m.threatened_by.length || m.slip_vs_baseline > 0 ? 'alert' : '', text: t + '.' });
  });
  if (f.weak_signals.length) out.push({ tone: 'warn', text: pl(f.weak_signals.length, 'signal faible', 'signaux faibles') + ' dans les commentaires d’avancement, dont « ' + f.weak_signals[0].item + ' » : « ' + truncate(f.weak_signals[0].comment, 90) + ' ».' });
  if (f.risks.open) out.push({ tone: '', text: pl(f.risks.open, 'risque ouvert', 'risques ouverts') + (f.risks.top[0] ? ', le plus fort : « ' + f.risks.top[0].title + ' »' : '') + '.' });
  if (f.changes_pending || f.baseline_requests_pending) {
    var bits = [];
    if (f.changes_pending) bits.push(pl(f.changes_pending, 'changement', 'changements') + ' à valider');
    if (f.baseline_requests_pending) bits.push(pl(f.baseline_requests_pending, 'demande de baseline', 'demandes de baseline') + ' en attente');
    out.push({ tone: '', text: bits.join(', ') + '.' });
  }
  return out;
}
