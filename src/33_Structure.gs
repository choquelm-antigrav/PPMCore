/**
 * PPM Core — lot 1 (suite) : personnes, WBS graphique, préférences d'affichage.
 *
 *  - Une personne a une fonction (job_function) et une organisation (organization).
 *  - L'organigramme OBS a été supprimé en 0.15.3 : les personnes se créent dans la page Ressources (équipes comprises), les rôles se posent sur chaque objet du WBS.
 *  - Le WBS se lit projet par projet : projet → workpackages → sous-workpackages → livrables et jalons.
 *  - Le serveur renvoie TOUS les attributs de chaque nœud ; le choix de ce qui est affiché est
 *    fait dans la page et mémorisé par utilisateur (UserSetting.view_prefs_json).
 *
 * Les fonctions build* sont pures (données déjà chargées) : elles sont testées hors ligne.
 */

// ---------------------------------------------------------------- catalogue des attributs affichables

/**
 * Pour ajouter un attribut affichable : une ligne ici, la valeur dans buildWbsTree, et l'affichage
 * dans Structure.html (fonction attrLines). Le titre du nœud est toujours affiché. (L'organigramme OBS a été supprimé en 0.15.3 : les rôles se posent dans le WBS.)
 */
var VIEW_CATALOG = {
  wbs: {
    attrs: [
      { key: 'wbs_code', label: 'Code WBS', on: true },
      { key: 'owner', label: 'Responsable (leader ou propriétaire)', on: true },
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
  var home = saved.ui && HOME_VIEWS.indexOf(saved.ui.home) >= 0 ? saved.ui.home : 'overview';
  return { wbs: normalizePrefs_('wbs', saved.wbs), ui: { theme: theme, home: home } }; // l'ancien affichage de l'organigramme (obs) n'existe plus : ses choix enregistrés sont ignorés
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
    team_id: r.team_id || '', version: r.version, canEdit: editAll || (!!ctx.resourceId && ctx.resourceId === r.id)
  };
}

function byName_(a, b) {
  return String(a.name).localeCompare(String(b.name), 'fr', { sensitivity: 'base' });
}


function scopeLabel_(data, type, id) {
  var rec = ({ program: indexBy_(data.programs), project: indexBy_(data.projects), workpackage: indexBy_(data.workpackages), planitem: indexBy_(data.planitems || []) }[type] || {})[id];
  if (!rec) return '';
  if (type === 'planitem') return rec.name;
  if (type === 'workpackage') return (rec.wbs_code ? rec.wbs_code + ' ' : '') + rec.name;
  return rec.code + ' — ' + rec.name;
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
    charge_code: '', ref: project.id, canEdit: canEdit('project', project.id), cpn: project.cpn || '', cpn_label: project.cpn_label || ''
  }, ownerOf(project.manager_resource_id), summary(items))];

  var emitWp = function (w, parentId) {
    var all = deepItems(w.id);
    var id = 'wp:' + w.id;
    nodes.push(Object.assign({
      id: id, parent: parentId, kind: 'wp', name: w.name, code: w.wbs_code || '', status: '', charge_code: w.charge_code || '',
      ref: w.id, version: w.version, owner_id: w.owner_resource_id || '', parent_ref: w.parent_wp_id || '', canEdit: canEdit('workpackage', w.id),
      cpn: w.cpn || '', cpn_label: w.cpn_label || ''
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
    canCpn: !!ctx && can(ctx, 'cpn.edit', { type: 'project', id: projectId }),
    stats: {
      wps: wps.length, items: items.length,
      depth: wps.some(function (w) { return !isBlank(w.parent_wp_id); }) ? 2 : (wps.length ? 1 : 0)
    }
  };
}

/**
 * WBS d'un programme (0.14.1) : programme → projets → workpackages → sous-workpackages. Les livrables et jalons ne sont pas dessinés (le détail se lit
 * projet par projet) mais comptent dans les valeurs de synthèse de chaque carte. Chaque carte garde le projet auquel elle appartient (project_ref),
 * pour ouvrir son WBS. programId 'none' : les projets hors programme.
 */
function buildWbsProgramTree_(data, programId, today, ctx) {
  var none = isBlank(programId) || programId === 'none';
  var program = none ? null : indexBy_(data.programs)[programId];
  if (!none && !program) throw new PpmError('NOT_FOUND', 'Programme introuvable : ' + programId);
  var resById = indexBy_(data.resources);
  var projects = data.projects.filter(function (p) { return none ? isBlank(p.program_id) : p.program_id === programId; })
    .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
  var rootId = 'program:' + (none ? 'none' : program.id);
  var nodes = [], wps = 0, items = 0, late = false, start = null, finish = null, wsum = 0, wn = 0;
  projects.forEach(function (p) {
    var t = buildWbsTree(data, p.id, today, ctx);
    wps += t.stats.wps; items += t.stats.items;
    t.nodes.forEach(function (n) {
      if (n.kind === 'item') return;
      var copy = Object.assign({}, n, { project_ref: p.id });
      if (n.kind === 'project') {
        copy.parent = rootId;
        if (n.late) late = true;
        if (n.start && (!start || n.start < start)) start = n.start;
        if (n.finish && (!finish || n.finish > finish)) finish = n.finish;
        wsum += (Number(n.progress) || 0) * Math.max(1, t.stats.items); wn += Math.max(1, t.stats.items);
      }
      nodes.push(copy);
    });
  });
  var leader = program && !isBlank(program.leader_resource_id) ? resById[program.leader_resource_id] : null;
  nodes.unshift({
    id: rootId, parent: '', kind: 'program', name: none ? 'Projets hors programme' : program.name, code: none ? '' : program.code, status: '', charge_code: '',
    ref: none ? 'none' : program.id, canEdit: false, cpn: '', cpn_label: '', owner: leader ? leader.name : '', owner_org: leader ? leader.organization || '' : '',
    owner_function: leader ? leader.job_function || '' : '', start: start, finish: finish, progress: wn ? Math.round(wsum / wn) : 0, critical: false, float: null, late: late
  });
  return {
    today: today, scope: 'program', project: null,
    program: { id: none ? '' : program.id, code: none ? '' : program.code, name: none ? 'Projets hors programme' : program.name },
    nodes: nodes, canCreate: false, canCpn: false,
    stats: { projects: projects.length, wps: wps, items: items, depth: 2 }
  };
}

// ---------------------------------------------------------------- actions de l'API

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

defineAction('wbs.tree', function (p, ctx) {
  if (isBlank(p.projectId) && !isBlank(p.programId)) return buildWbsProgramTree_(loadWbsData_(), p.programId, todayStr(), ctx);
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

function assertTeam_(values) {
  if (!isBlank(values.team_id) && !repoGet('HierarchicalTeam', values.team_id)) throw new PpmError('VALIDATION', 'Équipe introuvable.');
}

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
  assertTeam_(values);
  var created = repoInsert('Resource', values, ctx.actx);
  if (!isBlank(values.email)) sheetGrantSafe_(values.email); // la personne invitée ouvre le classeur Données dès maintenant (50_SheetAccess.gs)
  return created;
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
  assertTeam_(patch);
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
