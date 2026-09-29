/**
 * PPM Core — API JSON (section 12).
 *
 * Déploiement : web app, « Exécuter en tant que : moi (compte propriétaire) »,
 * « Accès : tous les utilisateurs du domaine ».
 * Requête : POST { action, params, apiVersion, requestId, addonId? }
 * Réponse : { ok: true, data, cursor? } | { ok: false, error: { code, message, details } }
 *
 * handleRequest() est pur vis-à-vis du transport : les tests l'appellent directement.
 */

var API_ACTIONS = {};
var IDEMPOTENCY_STORE = null; // tests : objet en mémoire ; production : CacheService
var IDEMPOTENCY_TTL_S = 21600; // 6 h, maximum du cache Apps Script

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: { code: 'VALIDATION', message: 'Corps JSON invalide.' } });
  }
  return jsonOut_(handleRequest(body, currentUserEmail_()));
}

function doGet(e) {
  if (e && e.parameter && e.parameter.view) return renderPage_(e);
  return jsonOut_({ ok: true, data: { service: 'ppm-core', version: PPM_VERSION, apiVersion: PPM_API_VERSION } });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function currentUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function handleRequest(body, actorEmail, opts) {
  if (!(opts && opts.keepMemo)) resetExecution_();
  try {
    body = body || {};
    var email = String(actorEmail || '').toLowerCase();
    var domain = allowedDomain();
    if (!email || !domain || email.split('@')[1] !== domain) {
      throw new PpmError('FORBIDDEN', 'Accès réservé aux comptes du domaine.');
    }
    var major = String(body.apiVersion || PPM_API_VERSION).split('.')[0];
    if (major !== PPM_API_VERSION.split('.')[0]) {
      throw new PpmError('VALIDATION', 'Version d’API non prise en charge : ' + body.apiVersion);
    }
    var handler = API_ACTIONS[body.action];
    if (!handler) throw new PpmError('NOT_FOUND', 'Action inconnue : ' + body.action);

    var cacheKey = body.requestId ? 'req:' + email + ':' + body.requestId : null;
    if (cacheKey) {
      var cached = idempotencyGet_(cacheKey);
      if (cached) return cached;
    }
    prefetchTables_(HOT_TABLES);
    var t0 = Date.now();
    var ctx = buildContext(email, body.addonId);
    var result = handler(body.params || {}, ctx);
    if (!TABLE_PROVIDER) console.log('PPM ' + body.action + ' : ' + (Date.now() - t0) + ' ms');
    var response = { ok: true, data: result && result.__page ? result.items : result };
    if (result && result.__page && result.cursor) response.cursor = result.cursor;
    if (cacheKey) idempotencyPut_(cacheKey, response);
    return response;
  } catch (err) {
    if (err instanceof PpmError || (err && err.name === 'PpmError')) {
      return { ok: false, error: { code: err.code, message: err.message, details: err.details || null } };
    }
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'INTERNAL', message: 'Erreur interne.', details: null } };
  }
}

function idempotencyGet_(key) {
  if (IDEMPOTENCY_STORE) return IDEMPOTENCY_STORE[key] || null;
  var v = CacheService.getScriptCache().get(key);
  return v ? JSON.parse(v) : null;
}

function idempotencyPut_(key, response) {
  if (IDEMPOTENCY_STORE) { IDEMPOTENCY_STORE[key] = response; return; }
  var s = JSON.stringify(response);
  if (s.length < 90000) CacheService.getScriptCache().put(key, s, IDEMPOTENCY_TTL_S);
}

/** Contexte de l'appelant : ressource, rôles actifs, droits. */
function buildContext(email, addonId) {
  var resource = findResourceByEmail(email);
  var today = todayStr();
  var ctx = {
    email: email,
    resource: resource,
    resourceId: resource ? resource.id : null,
    isAdmin: adminEmails().indexOf(email) >= 0,
    assignments: resource ? activeAssignments(resource.id, repoList('RoleAssignment'), today) : [],
    lookup: repoLookup_(),
    actx: { actor: email, source: addonId ? 'addon:' + addonId : 'api' }
  };
  return ctx;
}

function repoLookup_() {
  var cache = {};
  function get(table, id) {
    var k = table + ':' + id;
    if (!(k in cache)) cache[k] = repoGet(table, id);
    return cache[k];
  }
  var lookup = {
    planitem: function (id) { return get('PlanItem', id); },
    workpackage: function (id) { return get('WorkPackage', id); },
    project: function (id) { return get('Project', id); },
    risk: function (id) { return get('RiskOpportunity', id); },
    budgetMember: function (resourceId, itemId) {
      var viaBudget = repoList('BudgetLine', function (b) {
        return b.deliverable_id === itemId && b.resource_id === resourceId;
      }).length > 0;
      return viaBudget || activeAssignmentsFor_(resourceId, itemId, lookup);
    }
  };
  return lookup;
}

/** Un MEMBER affecté explicitement sur le projet ou un WP englobant compte aussi. */
function activeAssignmentsFor_(resourceId, itemId, lookup) {
  var chain = scopeAncestors({ type: 'planitem', id: itemId }, lookup);
  return repoList('RoleAssignment', function (a) {
    return a.resource_id === resourceId && a.role_code === 'MEMBER' &&
      chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
  }).length > 0;
}

// ---------------------------------------------------------------- outils

function requireParam(params, name) {
  if (isBlank(params[name])) throw new PpmError('VALIDATION', 'Paramètre obligatoire : ' + name);
  return params[name];
}

function mustGet(table, id) {
  var rec = repoGet(table, id);
  if (!rec || isTrue(rec.deleted)) throw new PpmError('NOT_FOUND', table + ' introuvable : ' + id);
  return rec;
}

/** Pagination par curseur (décalage opaque). */
function paginate(rows, params) {
  var limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
  var offset = Number(params.cursor) || 0;
  var items = rows.slice(offset, offset + limit);
  return { __page: true, items: items, cursor: offset + limit < rows.length ? String(offset + limit) : null };
}

function defineAction(name, fn) {
  API_ACTIONS[name] = fn;
}

// ---------------------------------------------------------------- actions : général

defineAction('ping', function () {
  return { version: PPM_VERSION, apiVersion: PPM_API_VERSION, time: nowIso() };
});

defineAction('me.roles', function (p, ctx) {
  return {
    email: ctx.email, isAdmin: ctx.isAdmin, resource: ctx.resource,
    assignments: ctx.assignments.map(function (a) {
      return { role_code: a.role_code, scope_type: a.scope_type, scope_id: a.scope_id };
    })
  };
});

// ---------------------------------------------------------------- actions : structure

defineAction('programs.list', function (p) { return paginate(repoList('Program'), p); });

defineAction('programs.create', function (p, ctx) {
  requireCan(ctx, 'program.create', { type: 'global' });
  return repoInsert('Program', p.values || {}, ctx.actx);
});

defineAction('projects.list', function (p) {
  return paginate(repoList('Project', function (r) { return isBlank(p.programId) || r.program_id === p.programId; }), p);
});

defineAction('projects.get', function (p) { return mustGet('Project', requireParam(p, 'id')); });

defineAction('projects.create', function (p, ctx) {
  var v = p.values || {};
  requireCan(ctx, 'project.create', isBlank(v.program_id) ? { type: 'global' } : { type: 'program', id: v.program_id });
  if (!isBlank(v.program_id)) mustGet('Program', v.program_id);
  return repoInsert('Project', v, ctx.actx);
});

defineAction('projects.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('Project', id);
  requireCan(ctx, 'wbs.edit', { type: 'project', id: id });
  return repoUpdate('Project', id, p.patch || {}, p.version, ctx.actx);
});

defineAction('workpackages.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  return paginate(repoList('WorkPackage', function (w) { return w.project_id === projectId; }), p);
});

defineAction('workpackages.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('Project', requireParam(v, 'project_id'));
  if (!isBlank(v.parent_wp_id)) {
    var parent = mustGet('WorkPackage', v.parent_wp_id);
    if (!isBlank(parent.parent_wp_id)) throw new PpmError('VALIDATION', 'Le WBS est limité à deux niveaux.');
    if (parent.project_id !== v.project_id) throw new PpmError('VALIDATION', 'Le WP parent appartient à un autre projet.');
  }
  requireCan(ctx, 'wbs.edit', isBlank(v.parent_wp_id) ? { type: 'project', id: v.project_id } : { type: 'workpackage', id: v.parent_wp_id });
  return repoInsert('WorkPackage', v, ctx.actx);
});

defineAction('workpackages.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('WorkPackage', id);
  requireCan(ctx, 'wbs.edit', { type: 'workpackage', id: id });
  var patch = Object.assign({}, p.patch || {});
  delete patch.project_id;
  return repoUpdate('WorkPackage', id, patch, p.version, ctx.actx);
});

defineAction('workpackages.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('WorkPackage', id);
  requireCan(ctx, 'wbs.edit', { type: 'workpackage', id: id });
  return repoSoftDelete('WorkPackage', id, p.version, ctx.actx);
});

defineAction('planitems.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  return paginate(repoList('PlanItem', function (i) { return i.project_id === projectId; }), p);
});

defineAction('planitems.get', function (p) { return mustGet('PlanItem', requireParam(p, 'id')); });

defineAction('planitems.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('Project', requireParam(v, 'project_id'));
  if (!isBlank(v.wp_id) && mustGet('WorkPackage', v.wp_id).project_id !== v.project_id) {
    throw new PpmError('VALIDATION', 'Le WP appartient à un autre projet.');
  }
  requireCan(ctx, 'wbs.edit', isBlank(v.wp_id) ? { type: 'project', id: v.project_id } : { type: 'workpackage', id: v.wp_id });
  var values = Object.assign({ status: 'À faire', progress_pct: 0 }, v);
  return repoInsert('PlanItem', values, ctx.actx);
});

defineAction('planitems.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('PlanItem', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: id });
  var patch = Object.assign({}, p.patch || {});
  ['project_id', 'progress_pct', 'status', 'last_progress_at'].forEach(function (k) { delete patch[k]; });
  return repoUpdate('PlanItem', id, patch, p.version, ctx.actx);
});

defineAction('planitems.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('PlanItem', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: id });
  return repoSoftDelete('PlanItem', id, p.version, ctx.actx);
});

defineAction('dependencies.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  var ids = {};
  repoList('PlanItem', function (i) { return i.project_id === projectId; }).forEach(function (i) { ids[i.id] = true; });
  return paginate(repoList('Dependency', function (d) { return ids[d.successor_id] || ids[d.predecessor_id]; }), p);
});

defineAction('dependencies.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('PlanItem', requireParam(v, 'predecessor_id'));
  mustGet('PlanItem', requireParam(v, 'successor_id'));
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: v.successor_id });
  var edges = repoList('Dependency').map(function (d) { return { from: d.predecessor_id, to: d.successor_id }; });
  if (wouldCreateCycle(edges, { from: v.predecessor_id, to: v.successor_id })) {
    throw new PpmError('VALIDATION', 'Cette dépendance fermerait une boucle dans le planning.', { rule: 'CYCLE' });
  }
  return repoInsert('Dependency', Object.assign({ dep_type: 'FS', lag_days: 0 }, v), ctx.actx);
});

defineAction('dependencies.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  var d = mustGet('Dependency', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id });
  return repoSoftDelete('Dependency', id, p.version, ctx.actx);
});

// ---------------------------------------------------------------- actions : avancement, baselines

defineAction('progress.declare', function (p, ctx) {
  var itemId = requireParam(p, 'planItemId');
  var item = mustGet('PlanItem', itemId);
  if (item.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'L’avancement se déclare sur un livrable.');
  requireCan(ctx, 'progress.declare', { type: 'planitem', id: itemId });
  repoInsert('ProgressUpdate', {
    deliverable_id: itemId, resource_id: ctx.resourceId || '', declared_at: nowIso(),
    progress_pct: requireParam(p, 'progressPct'), comment: p.comment || ''
  }, ctx.actx);
  return repoGet('PlanItem', itemId);
});

defineAction('baselines.request', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  mustGet('Project', projectId);
  requireCan(ctx, 'baseline.request', { type: 'project', id: projectId });
  var rec = repoInsert('Baseline', {
    project_id: projectId, justification: requireParam(p, 'justification'),
    label: p.label || '', requested_by: ctx.email, status: 'Demandée'
  }, ctx.actx);
  return rec;
});

// ---------------------------------------------------------------- actions : traçabilité, alertes

defineAction('changes.since', function (p) {
  // Curseur « at|id » : ordre total, aucun événement perdu entre deux pages.
  var parts = String(p.cursor || '').split('|');
  var cAt = parts[0] || '', cId = parts[1] || '';
  var rows = repoList('ChangeEvent', function (e) {
    var after = String(e.at) > cAt || (String(e.at) === cAt && String(e.id) > cId);
    return after && (isBlank(p.projectId) || e.project_id === p.projectId);
  }).sort(function (a, b) {
    var ka = a.at + '|' + a.id, kb = b.at + '|' + b.id;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  var limit = Math.max(1, Math.min(1000, Number(p.limit) || 200));
  var items = rows.slice(0, limit);
  var last = items.length ? items[items.length - 1] : null;
  return { __page: true, items: items, cursor: last ? last.at + '|' + last.id : (p.cursor || null) };
});

defineAction('insights.list', function (p) {
  return paginate(repoList('Insight', function (i) {
    return (isBlank(p.projectId) || i.project_id === p.projectId) && (isBlank(p.status) || i.status === p.status);
  }), p);
});
