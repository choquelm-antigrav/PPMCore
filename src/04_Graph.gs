/**
 * PPM Core — graphe des dépendances (section 5.2).
 * Fonctions pures : aucun accès aux classeurs.
 */

/** Construit la liste d'adjacence { from: [to, …] } à partir d'arêtes {from, to}. */
function adjacency(edges) {
  var adj = {};
  edges.forEach(function (e) {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
  });
  return adj;
}

/** Existe-t-il un chemin de start à target ? (parcours en largeur, itératif) */
function hasPath(adj, start, target) {
  if (start === target) return true;
  var seen = {}, queue = [start];
  seen[start] = true;
  while (queue.length) {
    var node = queue.shift();
    var next = adj[node] || [];
    for (var i = 0; i < next.length; i++) {
      if (next[i] === target) return true;
      if (!seen[next[i]]) { seen[next[i]] = true; queue.push(next[i]); }
    }
  }
  return false;
}

/** Ajouter newEdge fermerait-il un cycle ? (vrai aussi pour une auto-dépendance) */
function wouldCreateCycle(edges, newEdge) {
  if (newEdge.from === newEdge.to) return true;
  return hasPath(adjacency(edges), newEdge.to, newEdge.from);
}

/** Renvoie un cycle existant (liste de nœuds) ou null. */
function findCycle(edges) {
  var adj = adjacency(edges);
  var state = {}, stack = [];
  var nodes = Object.keys(adj);
  for (var n = 0; n < nodes.length; n++) {
    if (state[nodes[n]]) continue;
    var work = [{ node: nodes[n], i: 0 }];
    state[nodes[n]] = 1; stack.push(nodes[n]);
    while (work.length) {
      var top = work[work.length - 1];
      var next = adj[top.node] || [];
      if (top.i < next.length) {
        var child = next[top.i++];
        if (state[child] === 1) return stack.slice(stack.indexOf(child)).concat([child]);
        if (!state[child]) { state[child] = 1; stack.push(child); work.push({ node: child, i: 0 }); }
      } else {
        state[top.node] = 2; stack.pop(); work.pop();
      }
    }
  }
  return null;
}

function itemStart(item) {
  return !isBlank(item.planned_start) ? item.planned_start : item.planned_finish;
}

function itemFinish(item) {
  return !isBlank(item.planned_finish) ? item.planned_finish : item.planned_start;
}

/**
 * Violations de dépendances sur les dates prévisionnelles.
 *   items : PlanItem[] ; deps : Dependency[] ;
 *   holFor(projectId) → dictionnaire des fériés du calendrier du successeur.
 * Conventions (jours ouvrés, décalage = lag_days) :
 *   FS : le successeur commence au plus tôt le jour ouvré suivant la fin du prédécesseur
 *        (le jour même si le prédécesseur est un jalon), + décalage ;
 *   SS : début ≥ début du prédécesseur + décalage ;
 *   FF : fin ≥ fin du prédécesseur + décalage ;
 *   SF : fin ≥ début du prédécesseur + décalage.
 * Renvoie [{ dependency_id, dep_type, predecessor_id, successor_id, field, required, actual, gap_days }].
 */
function dependencyViolations(items, deps, holFor) {
  var byId = {};
  items.forEach(function (it) { if (!isTrue(it.deleted)) byId[it.id] = it; });
  var out = [];
  deps.forEach(function (d) {
    if (isTrue(d.deleted)) return;
    var p = byId[d.predecessor_id], s = byId[d.successor_id];
    if (!p || !s) return;
    var lag = Math.round(Number(d.lag_days || 0));
    var hol = holFor ? holFor(s.project_id) : null;
    var ref, required, actual, field;
    switch (d.dep_type) {
      case 'FS':
        ref = itemFinish(p); actual = itemStart(s); field = 'planned_start';
        if (isBlank(ref) || isBlank(actual)) return;
        var offset = (p.item_type === 'Jalon' ? 0 : 1) + lag;
        required = offset === 0 ? nextWorkingDay(ref, hol) : addWorkingDays(ref, offset, hol);
        break;
      case 'SS':
        ref = itemStart(p); actual = itemStart(s); field = 'planned_start';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      case 'FF':
        ref = itemFinish(p); actual = itemFinish(s); field = 'planned_finish';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      case 'SF':
        ref = itemStart(p); actual = itemFinish(s); field = 'planned_finish';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      default:
        return;
    }
    if (actual < required) {
      out.push({
        dependency_id: d.id, dep_type: d.dep_type, predecessor_id: p.id, successor_id: s.id,
        field: field, required: required, actual: actual,
        gap_days: workingDaysBetween(actual, required, hol) - (isWorkingDay(actual, hol) ? 1 : 0)
      });
    }
  });
  return out;
}
