/**
 * PPM Core — lot 1 (suite) : personnes, OBS et WBS graphiques, préférences d'affichage.
 *
 *  - Une personne a une fonction (job_function) et une organisation (organization).
 *  - L'OBS se lit de deux façons : par rôles (qui pilote quoi, du Program Leader aux
 *    membres) ou par équipes hiérarchiques (HierarchicalTeam).
 *  - Le WBS se lit projet par projet : projet → workpackages → sous-workpackages → livrables et jalons.
 *  - Le serveur renvoie TOUS les attributs de chaque nœud ; le choix de ce qui est affiché est
 *    fait dans la page et mémorisé par utilisateur (UserSetting.view_prefs_json).
 *
 * Les fonctions build* sont pures (données déjà chargées) : elles sont testées hors ligne.
 */

// ---------------------------------------------------------------- catalogue des attributs affichables

/**
 * Pour ajouter un attribut affichable : une ligne ici, la valeur dans build*Tree, et l'affichage
 * dans Structure.html (fonction attrLines). Le nom (personne) et le titre du nœud sont toujours affichés.
 */
var VIEW_CATALOG = {
  obs: {
    attrs: [
      { key: 'scope', label: 'Périmètre du rôle (en-tête)', on: true },
      { key: 'job_function', label: 'Fonction', on: true },
      { key: 'organization', label: 'Organisation', on: true },
      { key: 'email', label: 'E-mail', on: false },
      { key: 'team', label: 'Équipe hiérarchique', on: false },
      { key: 'country', label: 'Pays', on: false },
      { key: 'resource_type', label: 'Interne ou externe', on: false },
      { key: 'supplier', label: 'Fournisseur', on: false },
      { key: 'capacity', label: 'Capacité (jours par mois)', on: false },
      { key: 'cost_center', label: 'Centre de coût (vue par équipes)', on: false },
      { key: 'members', label: 'Membres de l’équipe (vue par équipes)', on: false }
    ],
    colors: [
      { key: 'role', label: 'Rôle' },
      { key: 'organization', label: 'Organisation' },
      { key: 'resource_type', label: 'Interne ou externe' },
      { key: 'none', label: 'Aucune' }
    ],
    modes: ['roles', 'teams'],
    defaults: { colorBy: 'role', mode: 'roles' }
  },
  wbs: {
    attrs: [
      { key: 'wbs_code', label: 'Code WBS', on: true },
      { key: 'owner', label: 'Responsable', on: true },
      { key: 'owner_org', label: 'Organisation du responsable', on: false },
      { key: 'dates', label: 'Dates prévues', on: true },
      { key: 'progress', label: 'Avancement', on: true },
      { key: 'status', label: 'Statut', on: false },
      { key: 'charge_code', label: 'Code d’imputation', on: false },
      { key: 'float', label: 'Marge et chemin critique', on: false }
    ],
    colors: [
      { key: 'kind', label: 'Type de nœud' },
      { key: 'organization', label: 'Organisation du responsable' },
      { key: 'none', label: 'Aucune' }
    ],
    defaults: { colorBy: 'kind', showItems: true }
  }
};

function defaultPrefs_(view) {
  var cat = VIEW_CATALOG[view];
  var prefs = Object.assign({}, cat.defaults);
  prefs.attrs = cat.attrs.filter(function (a) { return a.on; }).map(function (a) { return a.key; });
  return prefs;
}

/** Ramène des préférences quelconques à une forme valide : clés inconnues ignorées, manquantes par défaut. */
function normalizePrefs_(view, raw) {
  var cat = VIEW_CATALOG[view];
  var out = defaultPrefs_(view);
  raw = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(raw.attrs)) {
    var wanted = {};
    raw.attrs.forEach(function (k) { wanted[String(k)] = true; });
    out.attrs = cat.attrs.map(function (a) { return a.key; }).filter(function (k) { return wanted[k]; });
  }
  if (cat.colors.some(function (c) { return c.key === raw.colorBy; })) out.colorBy = raw.colorBy;
  if (view === 'obs' && cat.modes.indexOf(raw.mode) >= 0) out.mode = raw.mode;
  if (view === 'wbs' && typeof raw.showItems === 'boolean') out.showItems = raw.showItems;
  return out;
}

function userSettingRow_(email) {
  var rows = repoList('UserSetting', function (u) { return String(u.user_email).toLowerCase() === email; });
  return rows.length ? rows[0] : null;
}

function loadPrefs_(email) {
  var row = userSettingRow_(email);
  var saved = row ? parseJsonSafe(row.view_prefs_json, {}) : {};
  var theme = saved.ui && ['light', 'dark', 'auto'].indexOf(saved.ui.theme) >= 0 ? saved.ui.theme : 'auto';
  var home = saved.ui && HOME_VIEWS.indexOf(saved.ui.home) >= 0 ? saved.ui.home : 'gantt';
  return { obs: normalizePrefs_('obs', saved.obs), wbs: normalizePrefs_('wbs', saved.wbs), ui: { theme: theme, home: home } };
}

// ---------------------------------------------------------------- personnes

/** Champs d'une personne visibles par tous. rate_profile n'en fait pas partie (visibilité des TJM : question ouverte). */
var RESOURCE_WRITABLE = ['resource_type', 'name', 'team_id', 'country', 'job_function', 'organization', 'supplier', 'capacity_days_month'];
var RESOURCE_SELF_WRITABLE = ['job_function', 'organization'];

function canEditResources_(ctx) {
  return ctx.isAdmin || can(ctx, 'resource.edit', { type: 'global' });
}

function personCard_(r, teamsById, ctx, editAll) {
  var team = !isBlank(r.team_id) ? teamsById[r.team_id] : null;
  return {
    resource_id: r.id, name: r.name, email: r.email || '',
    job_function: r.job_function || '', organization: r.organization || '',
    team: team ? team.name : '', country: r.country || '', resource_type: r.resource_type || '',
    supplier: r.supplier || '', capacity: isBlank(r.capacity_days_month) ? '' : Number(r.capacity_days_month),
    version: r.version, canEdit: editAll || (!!ctx.resourceId && ctx.resourceId === r.id)
  };
}

function byName_(a, b) {
  return String(a.name).localeCompare(String(b.name), 'fr', { sensitivity: 'base' });
}

// ---------------------------------------------------------------- OBS par rôles

function scopeLabel_(data, type, id) {
  var rec = ({ program: indexBy_(data.programs), project: indexBy_(data.projects), workpackage: indexBy_(data.workpackages) }[type] || {})[id];
  if (!rec) return '';
  if (type === 'workpackage') return (rec.wbs_code ? rec.wbs_code + ' ' : '') + rec.name;
  return rec.code + ' — ' + rec.name;
}

/**
 * Arbre des rôles autour d'un périmètre : les rôles du périmètre et de ce qu'il contient,
 * plus ceux des périmètres qui le contiennent (pour que la hiérarchie soit complète).
 * Un nœud = un rôle sur un périmètre, avec ses titulaires. Son parent est le rôle immédiatement
 * supérieur qui couvre son périmètre (par exemple un chef de projet a pour parent le DPL du programme).
 */
function buildObsTree(data, scopeType, scopeId, today, ctx) {
  if (!SCOPE_TABLE[scopeType]) throw new PpmError('VALIDATION', 'Périmètre invalide : ' + scopeType);
  var rootLabel = scopeLabel_(data, scopeType, scopeId);
  if (!rootLabel) throw new PpmError('NOT_FOUND', 'Périmètre introuvable : ' + scopeId);

  var lookup = memoryLookup(data);
  var resById = indexBy_(data.resources), teamsById = indexBy_(data.teams);
  var editAll = canEditResources_(ctx);
  var mine = {};
  scopeAncestors({ type: scopeType, id: scopeId }, lookup).forEach(function (s) { mine[s.type + ':' + s.id] = true; });

  var groups = {}, order = [];
  data.assignments.forEach(function (a) {
    if (isTrue(a.deleted)) return;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var res = resById[a.resource_id];
    if (!res || isTrue(res.deleted)) return;
    var label = scopeLabel_(data, a.scope_type, a.scope_id);
    if (!label) return; // périmètre supprimé
    var chain = scopeAncestors({ type: a.scope_type, id: a.scope_id }, lookup);
    var below = chain.some(function (s) { return s.type === scopeType && String(s.id) === String(scopeId); });
    if (!below && !mine[a.scope_type + ':' + a.scope_id]) return;

    var key = a.role_code + '|' + a.scope_type + '|' + a.scope_id;
    if (!groups[key]) {
      groups[key] = {
        id: 'role:' + key, parent: '', role_code: a.role_code, role_label: ROLE_LABELS[a.role_code] || a.role_code,
        rank: ROLE_RANK[a.role_code], scope_type: a.scope_type, scope_id: a.scope_id, scope_label: label,
        chain: chain, people: [], seen: {}
      };
      order.push(key);
    }
    var g = groups[key];
    if (g.seen[res.id]) return;
    g.seen[res.id] = true;
    g.people.push(personCard_(res, teamsById, ctx, editAll));
  });

  var list = order.map(function (k) { return groups[k]; });
  list.forEach(function (g) {
    var best = null;
    list.forEach(function (h) {
      if (h === g || h.rank >= g.rank) return;
      var at = -1;
      g.chain.forEach(function (s, i) { if (at < 0 && s.type === h.scope_type && String(s.id) === String(h.scope_id)) at = i; });
      if (at < 0) return;
      if (!best || h.rank > best.h.rank || (h.rank === best.h.rank && at < best.at) ||
          (h.rank === best.h.rank && at === best.at && h.id < best.h.id)) best = { h: h, at: at };
    });
    g.parent = best ? best.h.id : '';
  });

  list.sort(function (a, b) {
    return (a.rank - b.rank) || a.scope_label.localeCompare(b.scope_label, 'fr') || 0;
  });
  var people = 0;
  var nodes = list.map(function (g) {
    g.people.sort(byName_);
    people += g.people.length;
    return {
      id: g.id, parent: g.parent, role_code: g.role_code, role_label: g.role_label,
      scope_type: g.scope_type, scope_id: g.scope_id, scope_label: g.scope_label, people: g.people
    };
  });
  return {
    mode: 'roles', scope: { type: scopeType, id: scopeId, label: rootLabel }, nodes: nodes,
    canEditAll: editAll, stats: { nodes: nodes.length, people: people }
  };
}

// ---------------------------------------------------------------- OBS par équipes

/**
 * Arbre des équipes hiérarchiques (HierarchicalTeam). rootTeamId limite à une branche.
 * Les personnes sans équipe sont regroupées dans un nœud « Sans équipe » (vue complète seulement).
 */
function buildTeamTree(data, rootTeamId, ctx) {
  var teams = data.teams.filter(function (t) { return !isTrue(t.deleted); });
  var byId = indexBy_(teams);
  var resources = data.resources.filter(function (r) { return !isTrue(r.deleted); });
  var resById = indexBy_(resources);
  var editAll = canEditResources_(ctx);

  // Un cycle dans les parents est traité comme une racine, pour que l'arbre reste dessinable.
  var parentOf = {};
  teams.forEach(function (t) {
    var p = !isBlank(t.parent_team_id) && byId[t.parent_team_id] ? t.parent_team_id : '';
    var cur = p, guard = 0, cyclic = false;
    while (cur && guard++ < 100) {
      if (cur === t.id) { cyclic = true; break; }
      var up = byId[cur] && !isBlank(byId[cur].parent_team_id) ? byId[cur].parent_team_id : '';
      cur = byId[up] ? up : '';
    }
    parentOf[t.id] = cyclic ? '' : p;
  });

  var depthOf = function (id) { var d = 0, cur = parentOf[id]; while (cur && d < 100) { d++; cur = parentOf[cur]; } return d; };
  var pathOf = function (id) { var names = [], cur = id, g = 0; while (cur && g++ < 100) { names.unshift(byId[cur].name); cur = parentOf[cur]; } return names.join(' / '); };

  if (!isBlank(rootTeamId) && !byId[rootTeamId]) throw new PpmError('NOT_FOUND', 'Équipe introuvable : ' + rootTeamId);
  var inBranch = function (id) {
    if (isBlank(rootTeamId)) return true;
    var cur = id, g = 0;
    while (cur && g++ < 100) { if (cur === rootTeamId) return true; cur = parentOf[cur]; }
    return false;
  };

  var membersOf = {}, unassigned = [];
  resources.forEach(function (r) {
    if (!isBlank(r.team_id) && byId[r.team_id]) (membersOf[r.team_id] = membersOf[r.team_id] || []).push(r);
    else unassigned.push(r);
  });
  var card = function (r) { return personCard_(r, byId, ctx, editAll); };

  var nodes = teams.filter(function (t) { return inBranch(t.id); }).map(function (t) {
    var mgr = !isBlank(t.manager_resource_id) ? resById[t.manager_resource_id] : null;
    var members = (membersOf[t.id] || []).filter(function (r) { return !mgr || r.id !== mgr.id; }).map(card).sort(byName_);
    return {
      id: 'team:' + t.id, parent: parentOf[t.id] && inBranch(parentOf[t.id]) && t.id !== rootTeamId ? 'team:' + parentOf[t.id] : '',
      team_id: t.id, name: t.name, cost_center: t.cost_center || '', manager: mgr ? card(mgr) : null,
      members: members, member_count: members.length, sort: pathOf(t.id)
    };
  }).sort(function (a, b) { return a.sort.localeCompare(b.sort, 'fr'); });
  nodes.forEach(function (n) { delete n.sort; });

  if (isBlank(rootTeamId) && unassigned.length) {
    nodes.push({
      id: 'team:none', parent: '', team_id: '', name: 'Sans équipe', cost_center: '', manager: null,
      members: unassigned.map(card).sort(byName_), member_count: unassigned.length
    });
  }
  return {
    mode: 'teams', root_team_id: rootTeamId || '', nodes: nodes, canEditAll: editAll,
    teams: teams.map(function (t) { return { id: t.id, name: t.name, depth: depthOf(t.id), path: pathOf(t.id) }; })
      .sort(function (a, b) { return a.path.localeCompare(b.path, 'fr'); }),
    stats: { nodes: nodes.length, people: resources.length }
  };
}

// ---------------------------------------------------------------- WBS

/** Marges du projet (les éléments liés d'autres projets sont des contraintes fixes). */
function floatsForProject_(data, projectId, items, holFor) {
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var all = indexBy_(data.planitems);
  var deps = data.dependencies.filter(function (d) { return ids[d.predecessor_id] || ids[d.successor_id]; });
  var ext = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) {
      if (!ids[id] && all[id]) ext[id] = Object.assign({}, all[id], { external: true });
    });
  });
  return computeFloats(items.concat(Object.keys(ext).map(function (k) { return ext[k]; })), deps, holFor);
}

/**
 * Arbre du WBS d'un projet : projet → WP → sous-WP → livrables et jalons.
 * Les WP portent des valeurs de synthèse (dates, avancement pondéré, chemin critique).
 */
function buildWbsTree(data, projectId, today, ctx) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var holFor = holidayResolver(data);
  var resById = indexBy_(data.resources);
  var who = function (id) { return !isBlank(id) && resById[id] ? resById[id] : null; };

  var items = data.planitems.filter(function (i) { return i.project_id === projectId; });
  var wps = data.workpackages.filter(function (w) { return w.project_id === projectId; });
  var wpById = indexBy_(wps);
  var floats = floatsForProject_(data, projectId, items, holFor);
  var fl = function (id) { return floats.byId[id] || {}; };
  // Droit de modifier chaque carte (wbs.edit sur son périmètre) : la page n'affiche des boutons que là où c'est permis.
  var canEdit = function (type, id) { return !!ctx && can(ctx, 'wbs.edit', { type: type, id: id }); };
  var depCount = {};
  (data.dependencies || []).forEach(function (d) {
    depCount[d.predecessor_id] = (depCount[d.predecessor_id] || 0) + 1;
    depCount[d.successor_id] = (depCount[d.successor_id] || 0) + 1;
  });

  var childrenOfWp = {}, itemsOfWp = {};
  wps.forEach(function (w) {
    var p = !isBlank(w.parent_wp_id) && wpById[w.parent_wp_id] ? w.parent_wp_id : '';
    (childrenOfWp[p] = childrenOfWp[p] || []).push(w);
  });
  items.forEach(function (i) {
    var k = !isBlank(i.wp_id) && wpById[i.wp_id] ? i.wp_id : '';
    (itemsOfWp[k] = itemsOfWp[k] || []).push(i);
  });
  var deepItems = function (wpId) {
    var acc = (itemsOfWp[wpId] || []).slice();
    (childrenOfWp[wpId] || []).forEach(function (c) { acc = acc.concat(deepItems(c.id)); });
    return acc;
  };
  var summary = function (its) {
    var sp = span_(its), minFloat = null, crit = false;
    its.forEach(function (i) {
      var f = fl(i.id);
      if (f.critical) crit = true;
      if (f.float !== null && f.float !== undefined && (minFloat === null || f.float < minFloat)) minFloat = f.float;
    });
    return {
      start: sp.start, finish: sp.finish, progress: weightedProgress_(its, holFor), critical: crit, float: minFloat,
      late: its.some(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; })
    };
  };
  var ownerOf = function (id) {
    var r = who(id);
    return { owner: r ? r.name : '', owner_org: r ? r.organization || '' : '', owner_function: r ? r.job_function || '' : '' };
  };

  var rootId = 'project:' + project.id;
  var nodes = [Object.assign({
    id: rootId, parent: '', kind: 'project', name: project.name, code: project.code, status: project.status || '',
    charge_code: '', ref: project.id, canEdit: canEdit('project', project.id)
  }, ownerOf(project.manager_resource_id), summary(items))];

  var emitWp = function (w, parentId) {
    var all = deepItems(w.id);
    var id = 'wp:' + w.id;
    nodes.push(Object.assign({
      id: id, parent: parentId, kind: 'wp', name: w.name, code: w.wbs_code || '', status: '', charge_code: w.charge_code || '',
      ref: w.id, version: w.version, owner_id: w.owner_resource_id || '', parent_ref: w.parent_wp_id || '', canEdit: canEdit('workpackage', w.id)
    }, ownerOf(w.owner_resource_id), summary(all)));
    (childrenOfWp[w.id] || []).slice().sort(byWbs_).forEach(function (c) { emitWp(c, id); });
    (itemsOfWp[w.id] || []).slice().sort(byStartThenName_).forEach(function (i) { emitItem(i, id); });
  };
  var emitItem = function (i, parentId) {
    var f = fl(i.id);
    nodes.push(Object.assign({
      id: 'item:' + i.id, parent: parentId, kind: 'item', item_type: i.item_type, name: i.name, code: '',
      status: i.status || '', charge_code: '',
      start: itemStart(i) || null, finish: itemFinish(i) || null, progress: Number(i.progress_pct) || 0,
      critical: !!f.critical, float: f.float === undefined ? null : f.float,
      late: !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today,
      ref: i.id, version: i.version, owner_id: i.owner_resource_id || '', wp_ref: i.wp_id || '', raw_start: i.planned_start || '', raw_finish: i.planned_finish || '',
      milestone_category: i.milestone_category || '', dep_count: depCount[i.id] || 0, canEdit: canEdit('planitem', i.id)
    }, ownerOf(i.owner_resource_id)));
  };
  (childrenOfWp[''] || []).slice().sort(byWbs_).forEach(function (w) { emitWp(w, rootId); });
  (itemsOfWp[''] || []).slice().sort(byStartThenName_).forEach(function (i) { emitItem(i, rootId); });

  var program = !isBlank(project.program_id) ? indexBy_(data.programs)[project.program_id] : null;
  return {
    today: today,
    project: { id: project.id, code: project.code, name: project.name, program_id: project.program_id || '',
      program_name: program ? program.name : '' },
    nodes: nodes,
    canCreate: canEdit('project', projectId),
    stats: {
      wps: wps.length, items: items.length,
      depth: wps.some(function (w) { return !isBlank(w.parent_wp_id); }) ? 2 : (wps.length ? 1 : 0)
    }
  };
}

// ---------------------------------------------------------------- actions de l'API

function loadObsData_() {
  return {
    programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage'),
    resources: repoList('Resource'), assignments: repoList('RoleAssignment'), teams: repoList('HierarchicalTeam')
  };
}

function loadWbsData_() {
  return {
    programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'), dependencies: repoList('Dependency'), resources: repoList('Resource'),
    holidaySets: repoList('HolidaySet')
  };
}

defineAction('views.config', function (p, ctx) {
  return { catalog: VIEW_CATALOG, prefs: loadPrefs_(ctx.email) };
});

defineAction('prefs.set', function (p, ctx) {
  var view = requireParam(p, 'view');
  if (!VIEW_CATALOG[view]) throw new PpmError('VALIDATION', 'Vue inconnue : ' + view);
  var saved = {};
  var row = userSettingRow_(ctx.email);
  if (row) saved = parseJsonSafe(row.view_prefs_json, {});
  saved[view] = normalizePrefs_(view, p.prefs);
  var json = JSON.stringify(saved);
  if (row) repoUpdate('UserSetting', row.id, { view_prefs_json: json }, null, ctx.actx);
  else repoInsert('UserSetting', { user_email: ctx.email, view_prefs_json: json }, ctx.actx);
  return saved[view];
});

/** Réglages d'interface de l'utilisateur (thème jour, nuit ou celui de l'ordinateur). */
defineAction('ui.set', function (p, ctx) {
  if (p.theme === undefined && p.home === undefined) throw new PpmError('VALIDATION', 'Rien à enregistrer.');
  if (p.theme !== undefined && ['light', 'dark', 'auto'].indexOf(p.theme) < 0) throw new PpmError('VALIDATION', 'Thème attendu : light, dark ou auto.');
  if (p.home !== undefined && HOME_VIEWS.indexOf(p.home) < 0) throw new PpmError('VALIDATION', 'Page d’accueil inconnue.');
  var row = userSettingRow_(ctx.email);
  var saved = row ? parseJsonSafe(row.view_prefs_json, {}) : {};
  saved.ui = Object.assign({}, saved.ui || {});
  if (p.theme !== undefined) saved.ui.theme = p.theme;
  if (p.home !== undefined) saved.ui.home = p.home;
  if (row) repoUpdate('UserSetting', row.id, { view_prefs_json: JSON.stringify(saved) }, null, ctx.actx);
  else repoInsert('UserSetting', { user_email: ctx.email, view_prefs_json: JSON.stringify(saved) }, ctx.actx);
  return loadPrefs_(ctx.email).ui;
});

defineAction('obs.tree', function (p, ctx) {
  return buildObsTree(loadObsData_(), requireParam(p, 'scopeType'), requireParam(p, 'scopeId'), todayStr(), ctx);
});

defineAction('obs.teams', function (p, ctx) {
  return buildTeamTree(loadObsData_(), p.rootTeamId || '', ctx);
});

defineAction('wbs.tree', function (p, ctx) {
  return buildWbsTree(loadWbsData_(), requireParam(p, 'projectId'), todayStr(), ctx);
});

// ---- personnes

defineAction('resources.list', function (p, ctx) {
  var editAll = canEditResources_(ctx);
  var q = String(p.q || '').toLowerCase();
  var teams = indexBy_(repoList('HierarchicalTeam'));
  var rows = repoList('Resource', function (r) {
    return !q || [r.name, r.email, r.job_function, r.organization].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
  }).map(function (r) { return personCard_(r, teams, ctx, editAll); }).sort(byName_);
  return paginate(rows, p);
});

function cleanResourceValues_(values, allowed) {
  var out = {};
  Object.keys(values || {}).forEach(function (k) {
    if (allowed.indexOf(k) >= 0) out[k] = values[k];
  });
  return out;
}

defineAction('resources.create', function (p, ctx) {
  requireCan(ctx, 'resource.edit', { type: 'global' });
  var v = p.values || {};
  var values = cleanResourceValues_(v, RESOURCE_WRITABLE.concat(['email']));
  if (!isBlank(values.email)) {
    values.email = String(values.email).toLowerCase();
    if (findResourceByEmail(values.email)) throw new PpmError('VALIDATION', 'Cette adresse est déjà utilisée par une autre personne.');
    values = fillFromDirectory_(values); // nom, fonction, organisation depuis l'annuaire s'ils manquent
  }
  return repoInsert('Resource', values, ctx.actx);
});

defineAction('resources.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  var res = mustGet('Resource', id);
  var editAll = canEditResources_(ctx);
  var self = !!ctx.resourceId && ctx.resourceId === res.id;
  if (!editAll && !self) throw new PpmError('FORBIDDEN', 'Vous ne pouvez modifier que votre propre fiche.');
  var allowed = editAll ? RESOURCE_WRITABLE : RESOURCE_SELF_WRITABLE;
  var patch = cleanResourceValues_(p.patch, allowed);
  var refused = Object.keys(p.patch || {}).filter(function (k) { return allowed.indexOf(k) < 0; });
  if (refused.length) {
    throw new PpmError('FORBIDDEN', 'Champ(s) non modifiable(s) par vous : ' + refused.join(', ') +
      (editAll ? '' : ' (vous pouvez modifier votre fonction et votre organisation).'));
  }
  return repoUpdate('Resource', id, patch, p.version, ctx.actx);
});

/**
 * Fiche saisie dans AppSheet : mêmes règles que l'API. Un membre modifie sa fonction et son organisation ;
 * PL, DPL et chef de projet modifient toute fiche. Sinon la modification est annulée et son auteur prévenu.
 */
function hookResourceGuard(before, rec, actx) {
  var ctx = buildContext(actx.actor);
  if (canEditResources_(ctx)) return true;
  var self = !!ctx.resourceId && ctx.resourceId === rec.id;
  var core = { actor: 'ppm-core', source: 'core' };
  if (!before) {
    repoUpdate('Resource', rec.id, { deleted: true }, null, core);
    notifyUser(actx.actor, 'Création de fiche annulée',
      'Seuls un Program Leader, un DPL ou un chef de projet peuvent ajouter une personne. La fiche « ' + rec.name + ' » a été annulée.');
    return false;
  }
  var changed = diffRecords(before, rec, businessFields('Resource')).map(function (d) { return d.field; });
  var illegal = changed.filter(function (f) { return !(self && RESOURCE_SELF_WRITABLE.indexOf(f) >= 0); });
  if (!illegal.length) return true;
  var restore = {};
  illegal.forEach(function (f) { restore[f] = before[f]; });
  repoUpdate('Resource', rec.id, restore, null, core);
  notifyUser(actx.actor, 'Modification de fiche annulée',
    'Vous ne pouvez pas modifier ' + (self ? 'ces champs de votre fiche' : 'la fiche de ' + rec.name) + ' (' + illegal.join(', ') + '). ' +
    (self ? 'Votre fonction et votre organisation restent modifiables.' : 'Demandez à votre chef de projet ou DPL.'));
  return false;
}
