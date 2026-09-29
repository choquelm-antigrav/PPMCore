/**
 * PPM Core — traçabilité (sections 5.3 et 13).
 *
 * Deux chemins d'écriture existent :
 *  1. le Core (API, traitements) : repoInsert/repoUpdate journalisent eux-mêmes ;
 *  2. AppSheet, qui écrit directement dans le classeur : chaque bot appelle
 *     onRowChanged(table, id, USEREMAIL()). Le Core compare la ligne à son
 *     instantané (_Snapshot), journalise les écarts, incrémente la version et
 *     déclenche les crochets métier. Une réconciliation nocturne rattrape les
 *     appels manqués.
 */

function diffRecords(before, after, fields) {
  var out = [];
  fields.forEach(function (f) {
    var a = canonical(before ? before[f] : ''), b = canonical(after ? after[f] : '');
    if (a !== b) out.push({ field: f, oldValue: a, newValue: b });
  });
  return out;
}

/** Projet de rattachement d'une ligne, pour filtrer le fil des changements du chef de projet. */
function projectIdOf(table, rec) {
  if (!rec) return '';
  try {
    switch (table) {
      case 'Project': return rec.id;
      case 'WorkPackage': case 'PlanItem': case 'RiskOpportunity': case 'Baseline': case 'Insight':
        return rec.project_id || '';
      case 'Dependency': {
        var s = repoGet('PlanItem', rec.successor_id);
        return s ? s.project_id : '';
      }
      case 'BudgetLine': case 'ProgressUpdate': {
        var d = repoGet('PlanItem', rec.deliverable_id);
        return d ? d.project_id : '';
      }
      case 'MilestoneRequirement': {
        var m = repoGet('PlanItem', rec.milestone_id);
        return m ? m.project_id : '';
      }
      case 'RoleAssignment':
        if (rec.scope_type === 'project') return rec.scope_id;
        if (rec.scope_type === 'workpackage') {
          var w = repoGet('WorkPackage', rec.scope_id);
          return w ? w.project_id : '';
        }
        return '';
      default: return '';
    }
  } catch (e) {
    return '';
  }
}

function buildChangeEvents(table, before, after, actx) {
  var at = nowIso();
  var ref = after || before;
  var base = {
    at: at, table_name: table, entity_id: ref.id, project_id: projectIdOf(table, ref),
    actor: actx.actor, source: actx.source, acknowledged: false
  };
  if (!before) return [Object.assign({ id: newId(), field: '*', old_value: '', new_value: '(création)' }, base)];
  if (!after) return [Object.assign({ id: newId(), field: '*', old_value: '(ligne)', new_value: '(suppression)' }, base)];
  return diffRecords(before, after, businessFields(table)).map(function (d) {
    return Object.assign({
      id: newId(), field: d.field, old_value: truncate(d.oldValue, 500), new_value: truncate(d.newValue, 500)
    }, base);
  });
}

// ---------------------------------------------------------------- instantanés

function snapshotKey(table, id) {
  return table + ':' + id;
}

function snapshotGet(table, id) {
  var row = repoGet('_Snapshot', snapshotKey(table, id));
  return row ? parseJsonSafe(row.json, null) : null;
}

function snapshotPut(table, rec) {
  var fields = businessFields(table);
  var json = stableJson(rec, fields);
  var key = snapshotKey(table, rec.id);
  var t = getTable('_Snapshot');
  var obj = { id: key, table_name: table, entity_id: rec.id, hash: hashString(json), json: json, updated_at: nowIso() };
  var r = t.findRow(key);
  if (r < 0) t.appendRows([obj]); else t.writeRow(r, obj);
}

function snapshotDelete(table, id) {
  var t = getTable('_Snapshot');
  var r = t.findRow(snapshotKey(table, id));
  if (r >= 0) t.writeRow(r, { id: snapshotKey(table, id), table_name: table, entity_id: id, hash: 'DELETED', json: '', updated_at: nowIso() });
}

/** Journalise un changement et met l'instantané à jour. */
function recordChanges(table, before, after, actx) {
  var events = buildChangeEvents(table, before, after, actx);
  if (events.length) repoAppendHistory('ChangeEvent', events);
  if (after) snapshotPut(table, after); else snapshotDelete(table, before.id);
  return events.length;
}

// ---------------------------------------------------------------- AppSheet

/**
 * Point d'entrée des bots AppSheet (tâche « Call a script »).
 * Paramètres : nom de table, [id] de la ligne, USEREMAIL().
 * Renvoie CREATED | UPDATED | DELETED | UNCHANGED | IGNORED.
 */
function onRowChanged(tableName, rowId, actorEmail) {
  resetExecution_();
  if (SCHEMA[tableName]) invalidateTable_(tableName); // AppSheet a écrit directement dans la feuille
  if (!isLoggedTable(tableName)) return 'IGNORED';
  var actx = { actor: String(actorEmail || 'appsheet').toLowerCase(), source: 'appsheet' };
  return withLock(function () { return syncRow(tableName, rowId, actx); });
}

/** Compare une ligne à son instantané et applique journal, version et crochets. */
function syncRow(tableName, rowId, actx) {
  var t = getTable(tableName);
  var r = t.findRow(rowId);
  var current = r < 0 ? null : t.readRow(r);
  var snap = snapshotGet(tableName, rowId);
  var before = snap ? Object.assign({ id: rowId }, snap) : null;

  if (!current && !before) return 'IGNORED';
  if (!current) {
    recordChanges(tableName, before, null, actx);
    return 'DELETED';
  }
  if (before && !diffRecords(before, current, businessFields(tableName)).length) return 'UNCHANGED';

  var now = nowIso();
  if (isBlank(current.created_at)) { current.created_at = now; current.created_by = actx.actor; }
  if (isBlank(current.deleted)) current.deleted = false;
  if (tableName === 'ProgressUpdate' && isBlank(current.declared_at)) current.declared_at = now;
  current.updated_at = now;
  current.updated_by = actx.actor;
  current.version = Number(current.version || 0) + 1;
  applyComputed(tableName, current);
  t.writeRow(r, current);

  var problems = checkRecordQuietly(tableName, current);
  recordChanges(tableName, before, current, actx);
  runHooks(tableName, before, current, actx);
  if (problems) {
    notifyUser(actx.actor, 'Donnée à corriger dans ' + tableName,
      'La ligne ' + rowId + ' contient des valeurs invalides : ' + JSON.stringify(problems));
  }
  return before ? 'UPDATED' : 'CREATED';
}

function checkRecordQuietly(table, rec) {
  try { validateRecord(table, rec); return null; } catch (e) { return e.details || e.message; }
}

// ---------------------------------------------------------------- crochets métier

function runHooks(table, before, rec, actx) {
  if (isTrue(rec.deleted)) return;
  if (table === 'Dependency') hookDependencyCycle(rec, actx);
  if (table === 'ProgressUpdate' && !before) hookPropagateProgress(rec, actx);
  if (table === 'Baseline' && actx.source === 'appsheet' && !hookBaselineGuard(before, rec, actx)) return;
  if (table === 'Baseline' && !before && rec.status === 'Demandée') hookBaselineRequested(rec, actx);
  if (table === 'RoleAssignment' && actx.source === 'appsheet') hookRoleAssignmentGuard(before, rec, actx);
  if (table === 'Resource' && actx.source === 'appsheet') hookResourceGuard(before, rec, actx);
  if (table === 'PlanItem') hookCalendarItem(before, rec);
}

/**
 * Une attribution de rôle saisie dans AppSheet est revérifiée comme par l'API :
 * droit « roles.assign » sur le périmètre et rang au plus égal au sien (section 7).
 * Si elle n'est pas permise, elle est annulée et son auteur prévenu.
 */
function hookRoleAssignmentGuard(before, rec, actx) {
  var changed = !before || before.role_code !== rec.role_code || before.scope_type !== rec.scope_type ||
    String(before.scope_id) !== String(rec.scope_id) || before.resource_id !== rec.resource_id;
  if (!changed) return true;
  var ctx = buildContext(actx.actor);
  // La ligne contrôlée ne peut pas servir à se donner raison (auto-nomination).
  ctx.assignments = ctx.assignments.filter(function (a) { return a.id !== rec.id; });
  var scope = { type: rec.scope_type, id: rec.scope_id };
  var allowed = ctx.isAdmin || (can(ctx, 'roles.assign', scope) && ROLE_RANK[rec.role_code] >= bestRankOn_(ctx, scope));
  if (allowed) return true;
  repoUpdate('RoleAssignment', rec.id, { deleted: true }, null, { actor: 'ppm-core', source: 'core' });
  notifyUser(actx.actor, 'Attribution de rôle annulée',
    'Vous ne pouvez pas attribuer le rôle ' + rec.role_code + ' sur ce périmètre : il faut détenir le droit ' +
    'd’attribuer les rôles et un rôle au moins aussi élevé. L’attribution a été annulée.');
  return false;
}

/**
 * Dans AppSheet, une baseline ne peut qu'être DEMANDÉE : le gel (copie figée, numéro, activation) passe
 * par la page Suivi ou l'API, qui vérifient les droits. Une création dans un autre état est ramenée à
 * « Demandée » ; toute autre modification des champs de décision est annulée. Renvoie false si annulée.
 */
var BASELINE_DECISION_FIELDS = ['project_id', 'number', 'status', 'decided_by', 'decided_at', 'requested_by'];
function hookBaselineGuard(before, rec, actx) {
  var core = { actor: 'ppm-core', source: 'core' };
  if (!before) {
    var fix = {};
    if (rec.status !== 'Demandée') fix.status = 'Demandée';
    if (!isBlank(rec.number)) fix.number = '';
    if (!isBlank(rec.decided_by)) fix.decided_by = '';
    if (!isBlank(rec.decided_at)) fix.decided_at = '';
    if (String(rec.requested_by || '').toLowerCase() !== actx.actor) fix.requested_by = actx.actor;
    if (Object.keys(fix).length) {
      Object.assign(rec, repoUpdate('Baseline', rec.id, fix, null, core));
      if (fix.status) {
        notifyUser(actx.actor, 'Baseline enregistrée comme demande',
          'Votre saisie a été enregistrée comme une demande de baseline. Le chef de projet ou le DPL la fige depuis la page Suivi.');
      }
    }
    return true;
  }
  var changed = BASELINE_DECISION_FIELDS.filter(function (f) { return String(before[f] || '') !== String(rec[f] || ''); });
  if (!changed.length) return true;
  var restore = {};
  changed.forEach(function (f) { restore[f] = before[f]; });
  repoUpdate('Baseline', rec.id, restore, null, core);
  notifyUser(actx.actor, 'Modification de baseline annulée',
    'Les baselines se figent, se refusent et se réactivent depuis la page Suivi, qui contrôle les droits et fige la copie du projet. ' +
    'Votre modification (' + changed.join(', ') + ') a été annulée.');
  return false;
}

/** Toute demande de rebaselining (API ou AppSheet) prévient le chef de projet (section 5.3). */
function hookBaselineRequested(rec, actx) {
  var project = repoGet('Project', rec.project_id);
  if (!project || isBlank(project.manager_resource_id)) return;
  var manager = repoGet('Resource', project.manager_resource_id);
  if (!manager) return;
  notifyUser(manager.email, 'Demande de rebaselining — ' + project.code,
    (rec.requested_by || actx.actor) + ' demande une nouvelle baseline : ' + rec.justification);
}

/** Une dépendance qui fermerait un cycle est annulée, et son auteur prévenu (section 5.2). */
function hookDependencyCycle(dep, actx) {
  var others = repoList('Dependency', function (d) { return d.id !== dep.id; })
    .map(function (d) { return { from: d.predecessor_id, to: d.successor_id }; });
  if (!wouldCreateCycle(others, { from: dep.predecessor_id, to: dep.successor_id })) return true;
  repoUpdate('Dependency', dep.id, { deleted: true }, null, { actor: 'ppm-core', source: 'core' });
  notifyUser(actx.actor, 'Dépendance annulée',
    'La dépendance ' + dep.predecessor_id + ' → ' + dep.successor_id + ' fermait une boucle dans le planning. Elle a été annulée.');
  return false;
}

/** Une déclaration d'avancement met à jour le livrable ; la dernière déclaration fait foi (H6). */
function hookPropagateProgress(pu, actx) {
  var item = repoGet('PlanItem', pu.deliverable_id);
  if (!item || isTrue(item.deleted)) return;
  var pct = Math.max(0, Math.min(100, Number(pu.progress_pct)));
  var at = isBlank(pu.declared_at) ? nowIso() : String(pu.declared_at);
  var patch = {
    progress_pct: pct,
    last_progress_at: at,
    status: pct >= 100 ? 'Terminé' : (pct > 0 ? 'En cours' : 'À faire')
  };
  if (pct >= 100 && isBlank(item.actual_finish)) patch.actual_finish = at.slice(0, 10);
  if (pct < 100 && !isBlank(item.actual_finish)) patch.actual_finish = '';
  repoUpdate('PlanItem', item.id, patch, null, { actor: actx.actor, source: actx.source });
}

// ---------------------------------------------------------------- réconciliation

/**
 * Rattrape les écritures AppSheet non signalées. Traite les tables dans l'ordre,
 * jusqu'à l'échéance ; state = { tableIndex } permet de reprendre à la tranche suivante.
 * Renvoie true quand tout est traité.
 */
function reconcileAll(state, deadlineMs) {
  var tables = Object.keys(SCHEMA).filter(isLoggedTable);
  state.tableIndex = state.tableIndex || 0;
  var actx = { actor: 'inconnu (réconciliation)', source: 'reconciliation' };
  while (state.tableIndex < tables.length) {
    var table = tables[state.tableIndex];
    var snaps = {};
    repoList('_Snapshot', function (s) { return s.table_name === table; }).forEach(function (s) { snaps[s.entity_id] = s; });
    var fields = businessFields(table);
    var rows = getTable(table).readAll();
    for (var i = 0; i < rows.length; i++) {
      if (nowMs() > deadlineMs) return false;
      var row = rows[i];
      var s = snaps[row.id];
      delete snaps[row.id];
      if (s && s.hash !== 'DELETED' && s.hash === hashString(stableJson(row, fields))) continue;
      withLock(function () { syncRow(table, row.id, actx); });
    }
    Object.keys(snaps).forEach(function (id) {
      if (snaps[id].hash !== 'DELETED') withLock(function () { syncRow(table, id, actx); });
    });
    state.tableIndex++;
  }
  return true;
}
