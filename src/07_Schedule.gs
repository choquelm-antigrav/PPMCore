/**
 * PPM Core — marges et chemin critique (section 5.2, lot 1).
 * Fonctions pures : aucun accès aux classeurs.
 *
 * Le planning n'est jamais recalculé (H7) : on part des dates saisies et on calcule,
 * pour chaque élément, la date de fin au plus tard qui ne retarde ni un successeur
 * ni la fin du plan. La marge totale est l'écart, en jours ouvrés, entre la fin
 * prévue et cette fin au plus tard.
 *   marge > 0 : l'élément peut glisser d'autant sans rien décaler ;
 *   marge = 0 : il est sur le chemin critique ;
 *   marge < 0 : il retarde déjà un successeur (dépendance violée).
 *
 * Conventions de dépendance identiques à dependencyViolations (04_Graph.gs).
 */

/** Nombre de pas en jours ouvrés pour aller de a à b (0 si a = b, négatif si b < a). */
function workingDayOffset(a, b, hol) {
  if (a === b) return 0;
  var sign = b > a ? 1 : -1;
  var n = 0;
  var d = a;
  while (d !== b) {
    d = addCalendarDays(d, sign);
    if (isWorkingDay(d, hol)) n++;
  }
  return sign * n;
}

/** Durée en jours ouvrés, bornes incluses ; 0 pour un jalon. */
function itemDuration(item, hol) {
  if (item.item_type === 'Jalon') return 0;
  var s = itemStart(item), f = itemFinish(item);
  if (isBlank(s) || isBlank(f)) return 0;
  return Math.max(1, workingDaysBetween(s, f, hol));
}

/** Début au plus tard correspondant à une fin au plus tard, pour une durée donnée. */
function lateStartFrom(lf, dur, hol) {
  return dur <= 1 ? lf : addWorkingDays(lf, -(dur - 1), hol);
}

/** Fin au plus tard correspondant à un début au plus tard. */
function lateFinishFrom(ls, dur, hol) {
  return dur <= 1 ? ls : addWorkingDays(ls, dur - 1, hol);
}

/**
 * items  : PlanItem[] du périmètre (projet ou programme), plus d'éventuels voisins
 *          d'autres projets marqués external: true (leurs dates sont des contraintes fixes).
 * deps   : Dependency[] ;
 * holFor(projectId) → fériés du calendrier du projet de l'élément ;
 * opts.anchor : date de fin de référence (par défaut la fin prévue la plus tardive du périmètre).
 *
 * Renvoie { anchor, byId: { id: { lateFinish, lateStart, float, critical } }, criticalIds }.
 * Les éléments sans dates, terminés ou externes n'ont pas de marge (float null).
 */
function computeFloats(items, deps, holFor, opts) {
  opts = opts || {};
  var byId = {}, list = [];
  items.forEach(function (it) {
    if (isTrue(it.deleted)) return;
    byId[it.id] = it;
    list.push(it);
  });
  var dated = function (it) { return !isBlank(itemStart(it)) && !isBlank(itemFinish(it)); };

  var anchor = opts.anchor || '';
  if (!anchor) {
    list.forEach(function (it) {
      if (!it.external && dated(it) && itemFinish(it) > anchor) anchor = itemFinish(it);
    });
  }

  // Successeurs de chaque élément (dépendances entre éléments connus seulement).
  var succ = {}, indeg = {};
  list.forEach(function (it) { succ[it.id] = []; indeg[it.id] = 0; });
  (deps || []).forEach(function (d) {
    if (isTrue(d.deleted) || !byId[d.predecessor_id] || !byId[d.successor_id]) return;
    succ[d.predecessor_id].push(d);
    indeg[d.successor_id]++;
  });

  // Ordre topologique (Kahn), puis parcours à rebours.
  var order = [], queue = [];
  list.forEach(function (it) { if (indeg[it.id] === 0) queue.push(it.id); });
  var remaining = {};
  Object.keys(indeg).forEach(function (k) { remaining[k] = indeg[k]; });
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    succ[id].forEach(function (d) {
      if (--remaining[d.successor_id] === 0) queue.push(d.successor_id);
    });
  }
  // Un cycle résiduel (normalement impossible) : ses éléments restent sans marge.

  var late = {};
  for (var k = order.length - 1; k >= 0; k--) {
    var it = byId[order[k]];
    if (!dated(it)) continue;
    var hol = holFor ? holFor(it.project_id) : null;
    var dur = itemDuration(it, hol);

    if (it.external) {
      late[it.id] = { lateStart: itemStart(it), lateFinish: itemFinish(it) };
      continue;
    }

    var lf = anchor || itemFinish(it);
    succ[it.id].forEach(function (d) {
      var s = late[d.successor_id];
      if (!s) return; // successeur sans dates : pas de contrainte
      var shol = holFor ? holFor(byId[d.successor_id].project_id) : null;
      var lag = Math.round(Number(d.lag_days || 0));
      var limit;
      switch (d.dep_type) {
        case 'FS':
          var offset = (it.item_type === 'Jalon' ? 0 : 1) + lag;
          limit = offset === 0 ? s.lateStart : addWorkingDays(s.lateStart, -offset, shol);
          break;
        case 'SS':
          limit = lateFinishFrom(addWorkingDays(s.lateStart, -lag, shol), dur, hol);
          break;
        case 'FF':
          limit = addWorkingDays(s.lateFinish, -lag, shol);
          break;
        case 'SF':
          limit = lateFinishFrom(addWorkingDays(s.lateFinish, -lag, shol), dur, hol);
          break;
        default:
          return;
      }
      if (limit < lf) lf = limit;
    });
    late[it.id] = { lateStart: lateStartFrom(lf, dur, hol), lateFinish: lf };
  }

  var result = {}, criticalIds = [];
  list.forEach(function (it) {
    var l = late[it.id];
    var done = it.status === 'Terminé' || Number(it.progress_pct) >= 100;
    if (!l || it.external || done) {
      result[it.id] = { lateStart: l ? l.lateStart : null, lateFinish: l ? l.lateFinish : null, float: null, critical: false };
      return;
    }
    var hol = holFor ? holFor(it.project_id) : null;
    var fl = workingDayOffset(itemFinish(it), l.lateFinish, hol);
    var critical = fl <= 0;
    result[it.id] = { lateStart: l.lateStart, lateFinish: l.lateFinish, float: fl, critical: critical };
    if (critical) criticalIds.push(it.id);
  });
  return { anchor: anchor || null, byId: result, criticalIds: criticalIds };
}
