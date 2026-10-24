/**
 * PPM Core — lot 2 : baselines, écarts, fil des changements du chef de projet (section 5.3).
 *
 *  - Une baseline fige, pour un projet : dates et responsables des livrables et jalons, WP,
 *    dépendances, budget et étalement, périmètre (liste des PlanItems). Copie dans BaselineItem.
 *  - Tout membre du projet peut DEMANDER une baseline ; seul le chef de projet (ou le DPL) la FIGE,
 *    avec une justification. Une seule est active ; les anciennes restent consultables et comparables.
 *  - Les écarts se calculent à la demande, en comparant deux instantanés de même forme :
 *    la baseline et l'état courant (ou deux baselines entre elles).
 *  - Toute modification d'une donnée figée reste dans le fil du chef de projet jusqu'à son acquittement.
 *
 * Les fonctions projectSnapshot_, diffSnapshots et buildChangeFeed sont pures (testées hors ligne).
 */

/** Champs figés par table. La même liste définit ce qui entre dans le fil des changements. */
var BASELINE_FIELDS = {
  Project: ['start_date', 'end_date', 'holiday_country'],
  WorkPackage: ['name', 'wbs_code', 'parent_wp_id', 'owner_resource_id', 'charge_code'],
  PlanItem: ['name', 'item_type', 'wp_id', 'owner_resource_id', 'planned_start', 'planned_finish', 'milestone_category'],
  Dependency: ['predecessor_id', 'successor_id', 'dep_type', 'lag_days'],
  BudgetLine: ['deliverable_id', 'resource_id', 'cost_type', 'planned_days', 'frozen_rate', 'fixed_amount', 'planned_amount']
};

var FIELD_LABELS = {
  start_date: 'début du projet', end_date: 'fin visée', holiday_country: 'calendrier',
  name: 'nom', wbs_code: 'code WBS', parent_wp_id: 'WP parent', owner_resource_id: 'responsable', charge_code: 'imputation',
  item_type: 'type', wp_id: 'workpackage', planned_start: 'début prévu', planned_finish: 'fin prévue',
  milestone_category: 'catégorie de jalon', predecessor_id: 'prédécesseur', successor_id: 'successeur',
  dep_type: 'type de lien', lag_days: 'décalage', deliverable_id: 'livrable', resource_id: 'ressource',
  cost_type: 'type de coût', planned_days: 'jours prévus', frozen_rate: 'taux figé', fixed_amount: 'forfait',
  planned_amount: 'montant prévu', progress_pct: 'avancement', baseline_frozen: 'baseline figée', budget_authorized: 'budget autorisé', budget_allocated: 'enveloppe budgétaire', deleted: 'suppression', '*': 'création ou suppression'
};

// ---------------------------------------------------------------- instantanés

/** data : { projects, workpackages, planitems, dependencies, budgetLines, phasing } (lignes vivantes). */
function projectSnapshot_(data, projectId, scope) {
  var snap = { Project: {}, WorkPackage: {}, PlanItem: {}, Dependency: {}, BudgetLine: {} };
  var project = indexBy_(data.projects)[projectId];
  if (project) snap.Project[project.id] = pickFields(project, BASELINE_FIELDS.Project);
  data.workpackages.forEach(function (w) {
    if (w.project_id === projectId) snap.WorkPackage[w.id] = pickFields(w, BASELINE_FIELDS.WorkPackage);
  });
  data.planitems.forEach(function (i) {
    if (i.project_id === projectId) snap.PlanItem[i.id] = pickFields(i, BASELINE_FIELDS.PlanItem);
  });
  data.dependencies.forEach(function (d) {
    if (snap.PlanItem[d.successor_id]) snap.Dependency[d.id] = pickFields(d, BASELINE_FIELDS.Dependency);
  });
  var phasing = {};
  (data.phasing || []).forEach(function (ph) {
    (phasing[ph.budget_line_id] = phasing[ph.budget_line_id] || []).push({ month: ph.month, amount: Number(ph.amount) || 0 });
  });
  (data.budgetLines || []).forEach(function (b) {
    if (!snap.PlanItem[b.deliverable_id]) return;
    var rec = pickFields(b, BASELINE_FIELDS.BudgetLine);
    rec.phasing = (phasing[b.id] || []).sort(function (x, y) { return String(x.month) < String(y.month) ? -1 : 1; });
    snap.BudgetLine[b.id] = rec;
  });
  if (scope && scope.type === 'workpackage') {
    return restrictSnapshotToWps_(snap, wpSubtreeIds_(data.workpackages.filter(function (w) { return w.project_id === projectId; }), scope.id));
  }
  return snap;
}

function snapshotToRows_(baselineId, snap) {
  var rows = [];
  Object.keys(snap).forEach(function (type) {
    Object.keys(snap[type]).forEach(function (id) {
      rows.push({ id: newId(), baseline_id: baselineId, entity_type: type, entity_id: id, snapshot_json: JSON.stringify(snap[type][id]) });
    });
  });
  return rows;
}

function rowsToSnapshot_(rows) {
  var snap = { Project: {}, WorkPackage: {}, PlanItem: {}, Dependency: {}, BudgetLine: {} };
  rows.forEach(function (r) {
    if (!snap[r.entity_type]) snap[r.entity_type] = {};
    snap[r.entity_type][r.entity_id] = parseJsonSafe(r.snapshot_json, {});
  });
  return snap;
}

function loadSnapshotData_() {
  return {
    projects: repoList('Project'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'), budgetLines: repoList('BudgetLine'), phasing: repoList('BudgetPhasing')
  };
}

function loadBaselineSnapshot_(baselineId) {
  return rowsToSnapshot_(repoList('BaselineItem', function (r) { return r.baseline_id === baselineId; }));
}

/** Baseline active d'un projet et son instantané, ou null. */
function activeBaselineOf_(project) {
  if (!project || isBlank(project.active_baseline_id)) return null;
  var b = repoGet('Baseline', project.active_baseline_id);
  if (!b || isTrue(b.deleted) || b.status !== 'Active') return null;
  return { row: b, snap: loadBaselineSnapshot_(b.id) };
}

// ---------------------------------------------------------------- écarts

function budgetByItem_(snap) {
  var out = {};
  Object.keys(snap.BudgetLine || {}).forEach(function (id) {
    var b = snap.BudgetLine[id];
    out[b.deliverable_id] = round2((out[b.deliverable_id] || 0) + (Number(b.planned_amount) || 0));
  });
  return out;
}

function lastFinish_(snap) {
  var f = '';
  Object.keys(snap.PlanItem).forEach(function (id) {
    var d = snap.PlanItem[id].planned_finish;
    if (!isBlank(d) && d > f) f = d;
  });
  return f || null;
}

/**
 * Compare deux instantanés de même forme. hol : fériés du calendrier du projet.
 * Glissement en jours ouvrés : positif = plus tard que la référence.
 */
function diffSnapshots(base, cur, hol) {
  var ids = {};
  Object.keys(base.PlanItem).concat(Object.keys(cur.PlanItem)).forEach(function (id) { ids[id] = true; });
  var bBudget = budgetByItem_(base), cBudget = budgetByItem_(cur);
  var shift = function (a, b) { return !isBlank(a) && !isBlank(b) ? workingDayOffset(a, b, hol) : null; };
  var items = Object.keys(ids).map(function (id) {
    var b = base.PlanItem[id] || null, c = cur.PlanItem[id] || null;
    var ref = c || b;
    var row = {
      id: id, name: ref.name, item_type: ref.item_type, wp_id: ref.wp_id || '',
      base_start: b ? b.planned_start || null : null, base_finish: b ? b.planned_finish || null : null,
      start: c ? c.planned_start || null : null, finish: c ? c.planned_finish || null : null,
      base_owner: b ? b.owner_resource_id || '' : '', owner: c ? c.owner_resource_id || '' : '',
      base_budget: bBudget[id] || 0, budget: cBudget[id] || 0
    };
    row.budget_delta = round2(row.budget - row.base_budget);
    if (!b) { row.state = 'added'; row.slip = null; row.start_shift = null; return row; }
    if (!c) { row.state = 'removed'; row.slip = null; row.start_shift = null; return row; }
    row.slip = shift(b.planned_finish, c.planned_finish);
    row.start_shift = shift(b.planned_start, c.planned_start);
    row.owner_changed = row.base_owner !== row.owner;
    row.renamed = String(b.name) !== String(c.name);
    row.moved = String(b.wp_id || '') !== String(c.wp_id || '');
    var datesChanged = String(b.planned_finish || '') !== String(c.planned_finish || '') ||
      String(b.planned_start || '') !== String(c.planned_start || '');
    row.state = datesChanged || row.owner_changed || row.renamed || row.moved || row.budget_delta !== 0 ? 'changed' : 'same';
    return row;
  });
  var order = { added: 1, changed: 0, removed: 2, same: 3 };
  items.sort(function (x, y) {
    return (order[x.state] - order[y.state]) || ((y.slip || 0) - (x.slip || 0)) ||
      String(x.base_finish || x.finish || '').localeCompare(String(y.base_finish || y.finish || '')) ||
      String(x.name).localeCompare(String(y.name));
  });
  var endBase = lastFinish_(base), endCur = lastFinish_(cur);
  var sum = function (m) { return round2(Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0)); };
  var slips = items.filter(function (i) { return i.slip !== null; }).map(function (i) { return i.slip; });
  var budgetBase = sum(bBudget), budgetCur = sum(cBudget);
  return {
    items: items,
    totals: {
      compared: items.length,
      slipped: items.filter(function (i) { return i.slip > 0; }).length,
      advanced: items.filter(function (i) { return i.slip < 0; }).length,
      max_slip: slips.length ? Math.max.apply(null, slips.concat([0])) : 0,
      added: items.filter(function (i) { return i.state === 'added'; }).length,
      removed: items.filter(function (i) { return i.state === 'removed'; }).length,
      owner_changes: items.filter(function (i) { return i.owner_changed; }).length,
      end_base: endBase, end: endCur, end_slip: endBase && endCur ? workingDayOffset(endBase, endCur, hol) : null,
      budget_base: budgetBase, budget: budgetCur, budget_delta: round2(budgetCur - budgetBase)
    }
  };
}

// ---------------------------------------------------------------- fil des changements

/** Champs figés mais calculés : ils bougent avec le champ saisi, inutile de les montrer deux fois dans le fil. */
var FEED_COMPUTED = { BudgetLine: ['planned_amount'] };

/** Un événement entre dans le fil s'il touche une donnée figée : création, suppression ou champ figé saisi. */
function isBaselinedEvent_(e) {
  var fields = BASELINE_FIELDS[e.table_name];
  if (!fields) return false;
  if ((FEED_COMPUTED[e.table_name] || []).indexOf(e.field) >= 0) return false;
  return e.field === '*' || e.field === 'deleted' || fields.indexOf(e.field) >= 0;
}

/**
 * Fil d'un projet : événements sur des données figées, postérieurs à la baseline active.
 * names : { resource: {id: nom}, item: {id: nom}, wp: {id: nom} } pour rendre les valeurs lisibles.
 */
function buildChangeFeed(events, projectId, since, names, opts) {
  opts = opts || {};
  var label = function (table, id) {
    if (table === 'PlanItem') return names.item[id] || '(élément supprimé)';
    if (table === 'WorkPackage') return names.wp[id] ? 'WP ' + names.wp[id] : '(WP supprimé)';
    if (table === 'Project') return 'Projet';
    if (table === 'Dependency') return names.dep[id] || 'Dépendance';
    if (table === 'BudgetLine') return names.budget[id] ? 'Budget de ' + names.budget[id] : 'Ligne budgétaire';
    if (table === 'Baseline') return names.baseline[id] || 'Baseline';
    return table;
  };
  var human = function (field, v) {
    if (isBlank(v)) return '';
    if (field === 'owner_resource_id' || field === 'resource_id') return names.resource[v] || v;
    if (field === 'wp_id' || field === 'parent_wp_id') return names.wp[v] || v;
    if (field === 'predecessor_id' || field === 'successor_id' || field === 'deliverable_id') return names.item[v] || v;
    if (field === 'deleted') return isTrue(v) ? 'supprimé' : 'actif';
    return String(v);
  };
  var rows = events.filter(function (e) {
    return e.project_id === projectId && String(e.at) >= since && (opts.eligible || isBaselinedEvent_)(e) &&
      (opts.all || !isTrue(e.acknowledged));
  }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)); });
  return rows.map(function (e) {
    var what;
    if (e.field === 'baseline_frozen') what = 'baseline';
    else if (e.field === '*') what = e.new_value === '(création)' ? 'ajout' : 'suppression';
    else if (e.field === 'deleted') what = isTrue(e.new_value) ? 'suppression' : 'rétablissement';
    else what = 'modification';
    return {
      id: e.id, at: e.at, actor: e.actor, actor_name: names.byEmail ? names.byEmail[String(e.actor).toLowerCase()] || '' : '', source: e.source, table: e.table_name, entity_id: e.entity_id,
      entity: label(e.table_name, e.entity_id), what: what, field: e.field,
      field_label: FIELD_LABELS[e.field] || e.field,
      old_value: human(e.field, e.old_value), new_value: human(e.field, e.new_value),
      acknowledged: isTrue(e.acknowledged), acknowledged_by: e.acknowledged_by || '', level: eventRank_(e)
    };
  });
}

/** Noms lisibles pour le fil et les journaux. Les noms de baselines (qui lisent trois tables de plus) ne sont chargés que si on les demande : le fil de validation, pas les journaux de l'administration. */
function feedNames_(withBaselines) {
  var names = { resource: {}, item: {}, wp: {}, dep: {}, budget: {}, byEmail: {}, baseline: {} };
  repoList('Resource', null, { includeDeleted: true }).forEach(function (r) {
    names.resource[r.id] = r.name;
    if (!isBlank(r.email)) names.byEmail[String(r.email).toLowerCase()] = r.name;
  });
  repoList('PlanItem', null, { includeDeleted: true }).forEach(function (i) { names.item[i.id] = i.name; });
  repoList('WorkPackage', null, { includeDeleted: true }).forEach(function (w) { names.wp[w.id] = (w.wbs_code ? w.wbs_code + ' ' : '') + w.name; });
  repoList('Dependency', null, { includeDeleted: true }).forEach(function (d) {
    names.dep[d.id] = (names.item[d.predecessor_id] || '?') + ' → ' + (names.item[d.successor_id] || '?');
  });
  repoList('BudgetLine', null, { includeDeleted: true }).forEach(function (b) { names.budget[b.id] = names.item[b.deliverable_id] || ''; });
  if (withBaselines) {
    var projectsById = indexBy_(repoList('Project', null, { includeDeleted: true })), wpsById = indexBy_(repoList('WorkPackage', null, { includeDeleted: true }));
    repoList('Baseline', null, { includeDeleted: true }).forEach(function (bl) {
      names.baseline[bl.id] = 'Baseline ' + (bl.label || (bl.number !== '' ? 'B' + bl.number : '')) + ' · ' + baselineScopeLabel_(baselineScope_(bl), projectsById[bl.project_id], wpsById);
    });
  }
  return names;
}

/**
 * Nombre de changements à valider par projet (mail récapitulatif, compteurs, Copilote) : ceux qu'un chef de projet peut valider, c'est-à-dire faits par un niveau
 * en dessous du sien. Mêmes critères que le fil (changes.feed) : mêmes données, même fenêtre, même niveau d'auteur.
 */
function pendingChangeCounts_(projects, events) {
  var since = {};
  projects.forEach(function (p) { since[p.id] = validationSince_(p).since; });
  var counts = {};
  events.forEach(function (e) {
    if (!(e.project_id in since) || isTrue(e.acknowledged) || String(e.at) < since[e.project_id] || !isValidatableEvent_(e)) return;
    if (eventRank_(e) <= ROLE_RANK.CP) return;
    counts[e.project_id] = (counts[e.project_id] || 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------- actions

function baselineView_(b, counts) {
  return {
    id: b.id, number: b.number === '' ? null : Number(b.number), label: b.label || '', status: b.status,
    justification: b.justification || '', requested_by: b.requested_by || '', decided_by: b.decided_by || '',
    decided_at: b.decided_at || '', created_at: b.created_at || '', version: b.version, items: counts[b.id] || 0,
    scope_type: baselineScope_(b).type, scope_id: baselineScope_(b).id
  };
}

function noteEvent_(table, id, projectId, text, ctx) {
  repoAppendHistory('ChangeEvent', [{
    id: newId(), at: nowIso(), table_name: table, entity_id: id, project_id: projectId, field: 'motif',
    old_value: '', new_value: truncate(text, 500), actor: ctx.actx.actor, source: ctx.actx.source,
    acknowledged: true, acknowledged_by: '', acknowledged_at: ''
  }]);
}

defineAction('baselines.list', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = { type: 'project', id: projectId };
  var rows = repoList('Baseline', function (b) { return b.project_id === projectId; });
  var ids = {};
  rows.forEach(function (b) { ids[b.id] = true; });
  var counts = {};
  repoList('BaselineItem', function (r) { return ids[r.baseline_id] && r.entity_type === 'PlanItem'; })
    .forEach(function (r) { counts[r.baseline_id] = (counts[r.baseline_id] || 0) + 1; });
  var rank = { 'Demandée': 0, 'Active': 1, 'Archivée': 2, 'Refusée': 3 };
  rows.sort(function (a, b) {
    return (rank[a.status] - rank[b.status]) || ((Number(b.number) || -1) - (Number(a.number) || -1)) ||
      String(b.created_at).localeCompare(String(a.created_at));
  });
  var wpById = indexBy_(repoList('WorkPackage', function (w) { return w.project_id === projectId; }));
  var frozenEvents = {};
  repoList('ChangeEvent', function (e) { return e.project_id === projectId && e.field === 'baseline_frozen'; }).forEach(function (e) { frozenEvents[e.entity_id] = e; });
  var scopes = baselineScopes_(ctx, project, rows);
  return {
    project: { id: project.id, code: project.code, name: project.name, active_baseline_id: project.active_baseline_id || '',
      calendar_id: project.calendar_id || '', drive_folder_id: project.drive_folder_id || '' },
    baselines: rows.map(function (b) {
      var v = baselineView_(b, counts), ev = frozenEvents[b.id];
      v.scope_label = baselineScopeLabel_(baselineScope_(b), project, wpById);
      v.validation = !ev || eventRank_(ev) <= 0 ? '' : b.status === 'Refusée' ? 'refused' : isTrue(ev.acknowledged) ? 'validated' : 'pending';
      v.validated_by = ev && isTrue(ev.acknowledged) ? ev.acknowledged_by || '' : '';
      v.author_level = ev ? eventRank_(ev) : null;
      return v;
    }),
    scopes: scopes,
    canBaseline: scopes.some(function (s) { return s.canCreate; }),
    canManage: can(ctx, 'baseline.manage', scope),
    canRequest: can(ctx, 'baseline.request', scope),
    canAck: can(ctx, 'changes.ack', scope),
    canReadFeed: can(ctx, 'baseline.request', scope),
    canWorkspace: can(ctx, 'workspace.manage', scope),
    seeBudget: can(ctx, 'budget.edit', scope)
  };
});

/**
 * Fige l'état courant d'un PÉRIMÈTRE (le projet par défaut ; scopeType = 'workpackage' + scopeId pour un workpackage ou un sous-workpackage). Avec requestId, la demande devient la
 * baseline (sa justification et son périmètre sont repris). La baseline figée devient la référence active de SON périmètre ; la précédente du même périmètre est archivée. Elle reste
 * « à valider » par le niveau du dessus (58_ScopeBaselines.gs).
 */
defineAction('baselines.create', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = scopeFromParams_(p, projectId);
  return withLock(function () {
    var request = null;
    if (!isBlank(p.requestId)) {
      request = mustGet('Baseline', p.requestId);
      if (request.project_id !== projectId || request.status !== 'Demandée') {
        throw new PpmError('VALIDATION', 'Cette demande n’est plus en attente.');
      }
      scope = baselineScope_(request);
    }
    requireBaselineScope_(ctx, scope);
    var justification = String(p.justification || (request ? request.justification : '') || '').trim();
    if (!justification) throw new PpmError('VALIDATION', 'La justification est obligatoire.');
    var data = loadSnapshotData_();
    var snap = projectSnapshot_(data, projectId, scope);
    if (!Object.keys(snap.PlanItem).length) {
      throw new PpmError('VALIDATION', scope.type === 'project' ? 'Rien à figer : le projet n’a encore aucun livrable ni jalon.' : 'Rien à figer : ce périmètre n’a encore aucun livrable ni jalon.');
    }
    var all = repoList('Baseline', function (b) { return b.project_id === projectId && sameBaselineScope_(baselineScope_(b), scope); });
    var frozen = all.filter(function (b) { return b.status === 'Active' || b.status === 'Archivée'; });
    var previous = frozen.filter(function (b) { return b.status === 'Active'; })[0] || null;
    var previousSnap = previous ? loadBaselineSnapshot_(previous.id) : null;
    var number = frozen.length ? Math.max.apply(null, frozen.map(function (b) { return Number(b.number) || 0; })) + 1 : 0;
    var values = {
      number: number, label: String(p.label || '').trim() || 'B' + number, justification: justification,
      status: 'Active', decided_by: ctx.email, decided_at: nowIso(),
      scope_type: scope.type === 'project' ? '' : 'workpackage', scope_id: scope.type === 'project' ? '' : scope.id
    };
    var rec = request
      ? repoUpdate('Baseline', request.id, values, p.version, ctx.actx)
      : repoInsert('Baseline', Object.assign({ project_id: projectId, requested_by: ctx.email }, values), ctx.actx);
    repoAppendHistory('BaselineItem', snapshotToRows_(rec.id, snap));
    frozen.forEach(function (b) {
      if (b.status === 'Active') repoUpdate('Baseline', b.id, { status: 'Archivée' }, null, ctx.actx);
    });
    setActiveBaseline_(scope, rec.id, ctx);
    var wpById = indexBy_(data.workpackages);
    announceBaseline_(rec, baselineSummary_(rec, scope, previousSnap, snap, project, baselineScopeLabel_(scope, project, wpById)), ctx);
    return baselineView_(rec, { [rec.id]: Object.keys(snap.PlanItem).length });
  });
});

/** Réactive une baseline archivée (motif obligatoire, conservé dans le journal). */
defineAction('baselines.activate', function (p, ctx) {
  var b = mustGet('Baseline', requireParam(p, 'id'));
  var scope = baselineScope_(b);
  requireBaselineScope_(ctx, scope);
  var reason = String(p.reason || '').trim();
  if (!reason) throw new PpmError('VALIDATION', 'Le motif est obligatoire.');
  if (b.status !== 'Archivée') throw new PpmError('VALIDATION', 'Seule une baseline archivée peut être réactivée.');
  return withLock(function () {
    repoList('Baseline', function (x) { return x.project_id === b.project_id && x.status === 'Active' && sameBaselineScope_(baselineScope_(x), scope); }).forEach(function (x) {
      repoUpdate('Baseline', x.id, { status: 'Archivée' }, null, ctx.actx);
    });
    var rec = repoUpdate('Baseline', b.id, { status: 'Active', decided_by: ctx.email, decided_at: nowIso() }, p.version, ctx.actx);
    setActiveBaseline_(scope, b.id, ctx);
    noteEvent_('Baseline', b.id, b.project_id, 'Réactivation : ' + reason, ctx);
    return baselineView_(rec, {});
  });
});

/** Refuse une demande de baseline (motif obligatoire ; le demandeur le voit dans son récapitulatif). */
defineAction('baselines.refuse', function (p, ctx) {
  var b = mustGet('Baseline', requireParam(p, 'id'));
  requireBaselineScope_(ctx, baselineScope_(b));
  var reason = String(p.reason || '').trim();
  if (!reason) throw new PpmError('VALIDATION', 'Le motif du refus est obligatoire.');
  if (b.status !== 'Demandée') throw new PpmError('VALIDATION', 'Cette demande n’est plus en attente.');
  var rec = repoUpdate('Baseline', b.id, { status: 'Refusée', decided_by: ctx.email, decided_at: nowIso() }, p.version, ctx.actx);
  noteEvent_('Baseline', b.id, b.project_id, 'Refus : ' + reason, ctx);
  return baselineView_(rec, {});
});

/**
 * Écarts entre la baseline (active par défaut) et l'état courant, ou entre deux baselines (compareTo).
 * Les montants ne sont renvoyés qu'à ceux qui ont le droit de modifier le budget du projet.
 */
defineAction('baselines.diff', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = scopeFromParams_(p, projectId);
  var against = p.against === 'project' && scope.type === 'workpackage';     // les écarts d'un workpackage contre la référence du PROJET
  var baseId;
  if (against) baseId = project.active_baseline_id;
  else if (!isBlank(p.baselineId)) baseId = p.baselineId;
  else baseId = scope.type === 'project' ? project.active_baseline_id : (repoGet('WorkPackage', scope.id) || {}).active_baseline_id;
  var names = {};
  repoList('Resource', null, { includeDeleted: true }).forEach(function (r) { names[r.id] = r.name; });
  var wpNames = {};
  repoList('WorkPackage', null, { includeDeleted: true }).forEach(function (w) { wpNames[w.id] = (w.wbs_code ? w.wbs_code + ' ' : '') + w.name; });
  var wpRows = repoList('WorkPackage', function (w) { return w.project_id === projectId; });
  var scopeInfo = { type: scope.type, id: scope.id, label: baselineScopeLabel_(scope, project, indexBy_(wpRows)) };
  if (isBlank(baseId)) return { baseline: null, compareTo: null, items: [], totals: null, scope: scopeInfo };
  var base = mustGet('Baseline', baseId);
  if (base.project_id !== projectId || (base.status !== 'Active' && base.status !== 'Archivée')) {
    throw new PpmError('VALIDATION', 'Cette baseline n’est pas figée pour ce projet.');
  }
  var baseScope = baselineScope_(base);
  if (!against && !isBlank(p.baselineId) && isBlank(p.scopeType)) { scope = baseScope; scopeInfo = { type: scope.type, id: scope.id, label: baselineScopeLabel_(scope, project, indexBy_(wpRows)) }; }
  if (!against && !sameBaselineScope_(baseScope, scope)) throw new PpmError('VALIDATION', 'Cette baseline porte sur un autre périmètre que celui demandé.');
  var data = loadSnapshotData_();
  var cur, other = null;
  if (!isBlank(p.compareTo)) {
    other = mustGet('Baseline', p.compareTo);
    if (other.project_id !== projectId) throw new PpmError('VALIDATION', 'Les deux baselines doivent appartenir au même projet.');
    if (!sameBaselineScope_(baselineScope_(other), scope)) throw new PpmError('VALIDATION', 'Les deux baselines doivent porter sur le même périmètre.');
    cur = loadBaselineSnapshot_(other.id);
  } else {
    cur = projectSnapshot_(data, projectId, scope);
  }
  var baseSnap = loadBaselineSnapshot_(base.id);
  if (against) baseSnap = restrictSnapshotToWps_(baseSnap, snapshotWpSet_(baseSnap, wpRows, scope.id));
  var d = diffSnapshots(baseSnap, cur, loadHolidayMap(project.holiday_country || 'FR'));
  var seeBudget = can(ctx, 'budget.edit', scope.type === 'project' ? { type: 'project', id: projectId } : scope);
  d.items.forEach(function (i) {
    i.base_owner_name = names[i.base_owner] || ''; i.owner_name = names[i.owner] || '';
    i.wp_name = wpNames[i.wp_id] || '';
    if (!seeBudget) { delete i.base_budget; delete i.budget; delete i.budget_delta; }
  });
  if (!seeBudget) { delete d.totals.budget_base; delete d.totals.budget; delete d.totals.budget_delta; }
  d.baseline = baselineView_(base, {});
  d.compareTo = other ? baselineView_(other, {}) : null;
  d.seeBudget = seeBudget;
  d.scope = scopeInfo;
  d.against = against ? 'project' : '';
  return d;
});

/**
 * Fil de validation (0.15.3) : les changements d'objets du WBS (données figées et avancement) qui attendent la validation d'un niveau supérieur à celui de leur auteur.
 * Chacun voit ce qu'il peut valider (un niveau strictement supérieur à l'auteur, sur l'objet) ; `mine` : ses propres changements en attente, avec le niveau qui doit les valider.
 */
defineAction('changes.feed', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = { type: 'project', id: projectId };
  if (!can(ctx, 'baseline.request', scope)) throw new PpmError('FORBIDDEN', 'Le fil des changements est réservé aux personnes qui ont un rôle dans le projet.');
  var win = validationSince_(project);
  var events = repoList('ChangeEvent', function (e) { return e.project_id === projectId; });
  var names = feedNames_(true);
  var all = buildChangeFeed(events, projectId, win.since, names, { all: true, eligible: isValidatableEvent_ });
  var byId = {}; events.forEach(function (e) { byId[e.id] = e; });
  var assignments = repoList('RoleAssignment', function (a) { return roleActive_(a, todayStr()); });
  var scopes = {};
  var scopeOf = function (id) { return scopes[id] || (scopes[id] = eventScope_(byId[id])); };
  var viewer = String(ctx.email || '').toLowerCase();
  var items = [], mine = [], pending = 0;
  all.forEach(function (it) {
    var e = byId[it.id], sc = scopeOf(it.id);
    if (eventRank_(e) <= 0) return;                                  // rien à valider : l'auteur est tout en haut, ou c'est le système
    it.validator = nominalValidator_(e, sc, assignments, ctx.lookup);
    it.can_validate = canValidateEvent_(ctx, e, sc);
    if (!it.acknowledged && String(it.actor).toLowerCase() === viewer && !it.can_validate) mine.push(it);
    if (!it.can_validate) return;
    if (!it.acknowledged) pending++;
    items.push(it);
  });
  var limit = Math.max(1, Math.min(500, Number(p.limit) || 200));
  var shown = (p.all ? items : items.filter(function (x) { return !x.acknowledged; })).slice(0, limit);
  return {
    baseline: win.baseline ? baselineView_(win.baseline, {}) : null, since: win.since, canAck: pending > 0 || items.length > 0 || ctx.isAdmin,
    pending: pending, items: shown, mine: mine.slice(0, 50), mine_count: mine.length
  };
});

/**
 * Validation : ids (liste), ou projectId + all = true (tout ce que la personne peut valider dans le projet). On ne valide que ce qu'un niveau strictement inférieur
 * a fait sur l'objet (l'administrateur valide tout) ; une liste d'ids qui en contient un autre est refusée en entier.
 */
defineAction('changes.ack', function (p, ctx) {
  var t = getTable('ChangeEvent');
  return withLock(function () {
    var rows = t.readAll();
    var wanted = {}, explicit = !p.all;
    if (p.all) {
      var projectId = requireParam(p, 'projectId');
      var project = mustGet('Project', projectId);
      var since = validationSince_(project).since;
      rows.forEach(function (e) {
        if (e.project_id === projectId && !isTrue(e.acknowledged) && String(e.at) >= since && isValidatableEvent_(e)) wanted[e.id] = true;
      });
    } else {
      (p.ids || []).slice(0, 1000).forEach(function (id) { wanted[String(id)] = true; });
    }
    var now = nowIso(), updates = [];
    rows.forEach(function (e, i) {
      if (!wanted[e.id] || isTrue(e.acknowledged)) return;
      if (!canValidateEvent_(ctx, e, eventScope_(e))) {
        if (explicit) throw new PpmError('FORBIDDEN', 'On ne valide que ce qu’un niveau inférieur au sien a fait : ici, un changement de ' + (e.actor || 'quelqu’un') + ' que vous n’avez pas le niveau de valider.');
        return;
      }
      updates.push({ row: i + 2, obj: Object.assign({}, e, { acknowledged: true, acknowledged_by: ctx.email, acknowledged_at: now }) });
    });
    if (updates.length) t.updateRows(updates);
    return { acknowledged: updates.length };
  });
});
