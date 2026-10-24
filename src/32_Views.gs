/**
 * PPM Core — vues du lot 1 : Gantt projet, vue programme, attribution des rôles.
 *
 * Les tables sont lues UNE fois par requête puis traitées en mémoire : une lecture
 * de feuille coûte cher en Apps Script, un appel par élément serait trop lent.
 * Les fonctions build* sont pures (testées hors ligne) ; les actions de l'API les
 * alimentent. La page web « Gantt » appelle le Core par uiCall(), donc avec
 * exactement les mêmes contrôles de droits que l'API.
 */

// ---------------------------------------------------------------- chargement

function loadPlanningData_() {
  return {
    programs: repoList('Program'),
    projects: repoList('Project'),
    workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'),
    resources: repoList('Resource'),
    assignments: repoList('RoleAssignment'),
    budgetLines: repoList('BudgetLine'),
    holidaySets: repoList('HolidaySet')
  };
}

function indexBy_(rows) {
  var m = {};
  (rows || []).forEach(function (r) { m[r.id] = r; });
  return m;
}

/** Même interface que repoLookup_(), mais sur des données déjà chargées. */
function memoryLookup(data) {
  var items = indexBy_(data.planitems), wps = indexBy_(data.workpackages), projects = indexBy_(data.projects);
  var lookup = {
    planitem: function (id) { return items[id] || null; },
    workpackage: function (id) { return wps[id] || null; },
    project: function (id) { return projects[id] || null; },
    risk: function () { return null; },
    budgetMember: function (resourceId, itemId) {
      if ((data.budgetLines || []).some(function (b) { return b.deliverable_id === itemId && b.resource_id === resourceId; })) return true;
      var chain = scopeAncestors({ type: 'planitem', id: itemId }, lookup);
      return (data.assignments || []).some(function (a) {
        return a.resource_id === resourceId && a.role_code === 'MEMBER' &&
          chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
      });
    }
  };
  return lookup;
}

/** holFor(projectId) à partir des HolidaySet déjà chargés. */
function holidayResolver(data) {
  var byCountry = {};
  (data.holidaySets || []).forEach(function (h) {
    var m = byCountry[h.country] || (byCountry[h.country] = {});
    parseJsonSafe(h.dates_json, []).forEach(function (d) { m[typeof d === 'string' ? d : d.date] = true; });
  });
  var projects = indexBy_(data.projects);
  return function (projectId) {
    var p = projects[projectId];
    return byCountry[(p && p.holiday_country) || 'FR'] || {};
  };
}

function resourceName_(data, id) {
  if (isBlank(id)) return '';
  var r = (data._resById || (data._resById = indexBy_(data.resources)))[id];
  return r ? r.name : '';
}

function isDone_(it) {
  return it.status === 'Terminé' || Number(it.progress_pct) >= 100;
}

/** Avancement pondéré par la durée (jours ouvrés) des livrables. */
function weightedProgress_(items, holFor) {
  var w = 0, acc = 0;
  items.forEach(function (it) {
    if (it.item_type !== 'Livrable') return;
    var d = Math.max(1, itemDuration(it, holFor(it.project_id)));
    w += d;
    acc += d * Math.min(100, Math.max(0, Number(it.progress_pct) || 0));
  });
  return w ? Math.round(acc / w) : 0;
}

function span_(items) {
  var s = '', f = '';
  items.forEach(function (it) {
    var a = itemStart(it), b = itemFinish(it);
    if (!isBlank(a) && (!s || a < s)) s = a;
    if (!isBlank(b) && (!f || b > f)) f = b;
  });
  return { start: s || null, finish: f || null };
}

function byStartThenName_(a, b) {
  var sa = itemStart(a) || '9999', sb = itemStart(b) || '9999';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return String(a.name).localeCompare(String(b.name));
}

function byWbs_(a, b) {
  var ka = String(a.wbs_code || ''), kb = String(b.wbs_code || '');
  if (ka !== kb) return ka.localeCompare(kb, undefined, { numeric: true });
  return String(a.name).localeCompare(String(b.name));
}

// ---------------------------------------------------------------- Gantt projet

/**
 * data : loadPlanningData_() ; ctx : contexte de l'appelant (droits) ; today : AAAA-MM-JJ.
 * Renvoie les lignes du Gantt dans l'ordre d'affichage (WP, sous-WP, éléments),
 * les dépendances, les violations et le chemin critique.
 */
function buildProjectGantt(data, projectId, ctx, today) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var holFor = holidayResolver(data);
  var lookup = memoryLookup(data);
  var uctx = Object.assign({}, ctx, { lookup: lookup });

  var items = data.planitems.filter(function (i) { return i.project_id === projectId; });
  var itemIds = {};
  items.forEach(function (i) { itemIds[i.id] = true; });

  // Dépendances touchant le projet ; voisins des autres projets en contraintes fixes.
  var allItems = indexBy_(data.planitems), projById = indexBy_(data.projects);
  var deps = data.dependencies.filter(function (d) { return itemIds[d.predecessor_id] || itemIds[d.successor_id]; });
  var externals = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) {
      if (!itemIds[id] && allItems[id]) externals[id] = Object.assign({}, allItems[id], { external: true });
    });
  });
  var extList = Object.keys(externals).map(function (k) { return externals[k]; });

  var floats = computeFloats(items.concat(extList), deps, holFor);
  var violations = dependencyViolations(items.concat(extList), deps, holFor);
  var violatedDep = {}, violatedItem = {};
  violations.forEach(function (v) { violatedDep[v.dependency_id] = true; violatedItem[v.successor_id] = true; });

  // Baseline active (data.baseline = { row, snap }) : dates figées et glissement de chaque élément.
  var base = data.baseline || null;
  var baseItems = base ? base.snap.PlanItem : {};
  var hol = holFor(projectId);
  function baselineOf(it) {
    if (!base) return {};
    var b = baseItems[it.id];
    if (!b) return { added: true };
    var slip = !isBlank(b.planned_finish) && !isBlank(itemFinish(it)) ? workingDayOffset(b.planned_finish, itemFinish(it), hol) : null;
    return { baseline_start: b.planned_start || b.planned_finish || null, baseline_finish: b.planned_finish || null, slip: slip };
  }

  function itemRow(it, level) {
    var f = floats.byId[it.id] || {};
    return Object.assign({
      kind: 'item', id: it.id, name: it.name, item_type: it.item_type, wp_id: it.wp_id || '', level: level,
      start: itemStart(it) || null, finish: itemFinish(it) || null,
      progress: Number(it.progress_pct) || 0, status: it.status || '', owner: resourceName_(data, it.owner_resource_id),
      critical: !!f.critical, float: f.float === undefined ? null : f.float, late_finish: f.lateFinish || null,
      late: !isDone_(it) && !isBlank(itemFinish(it)) && itemFinish(it) < today,
      violated: !!violatedItem[it.id], version: it.version,
      mine: !isBlank(it.owner_resource_id) && it.owner_resource_id === uctx.resourceId, // « les miens » : responsable de l'élément (0.15.2)
      canEdit: can(uctx, 'wbs.edit', { type: 'planitem', id: it.id }),
      canDeclare: it.item_type === 'Livrable' && can(uctx, 'progress.declare', { type: 'planitem', id: it.id })
    }, baselineOf(it));
  }

  // Arborescence WBS (deux niveaux).
  var wps = data.workpackages.filter(function (w) { return w.project_id === projectId; });
  var wpIds = {};
  wps.forEach(function (w) { wpIds[w.id] = true; });
  var childrenOf = {}, itemsOf = {};
  wps.forEach(function (w) {
    var parent = !isBlank(w.parent_wp_id) && wpIds[w.parent_wp_id] ? w.parent_wp_id : '';
    (childrenOf[parent] = childrenOf[parent] || []).push(w);
  });
  items.forEach(function (it) {
    var k = !isBlank(it.wp_id) && wpIds[it.wp_id] ? it.wp_id : '';
    (itemsOf[k] = itemsOf[k] || []).push(it);
  });

  function deepItems(wpId) {
    var acc = (itemsOf[wpId] || []).slice();
    (childrenOf[wpId] || []).forEach(function (c) { acc = acc.concat(deepItems(c.id)); });
    return acc;
  }

  var rows = [];
  function emitWp(w, level) {
    var all = deepItems(w.id);
    var sp = span_(all);
    var bsp = base ? span_(all.filter(function (i) { return baseItems[i.id]; }).map(function (i) { return baseItems[i.id]; })) : {};
    rows.push({
      kind: 'wp', id: 'wp:' + w.id, wp_id: w.id, name: w.name, wbs_code: w.wbs_code || '', level: level,
      start: sp.start, finish: sp.finish, progress: weightedProgress_(all, holFor),
      baseline_start: bsp.start || null, baseline_finish: bsp.finish || null,
      owner: resourceName_(data, w.owner_resource_id),
      critical: all.some(function (i) { return floats.byId[i.id] && floats.byId[i.id].critical; }),
      late: all.some(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; })
    });
    (itemsOf[w.id] || []).slice().sort(byStartThenName_).forEach(function (it) { rows.push(itemRow(it, level + 1)); });
    (childrenOf[w.id] || []).slice().sort(byWbs_).forEach(function (c) { emitWp(c, level + 1); });
  }
  (childrenOf[''] || []).slice().sort(byWbs_).forEach(function (w) { emitWp(w, 0); });
  if ((itemsOf[''] || []).length) {
    var loose = itemsOf[''];
    var sp = span_(loose);
    rows.push({ kind: 'wp', id: 'wp:none', wp_id: '', name: 'Hors workpackage', wbs_code: '', level: 0,
      start: sp.start, finish: sp.finish, progress: weightedProgress_(loose, holFor), owner: '', critical: false, late: false });
    loose.slice().sort(byStartThenName_).forEach(function (it) { rows.push(itemRow(it, 1)); });
  }
  extList.sort(byStartThenName_).forEach(function (it) {
    var p = projById[it.project_id];
    rows.push({
      kind: 'external', id: it.id, name: it.name, item_type: it.item_type, level: 0,
      project_code: p ? p.code : '', project_id: it.project_id,
      start: itemStart(it) || null, finish: itemFinish(it) || null,
      progress: Number(it.progress_pct) || 0, status: it.status || '', canEdit: false, canDeclare: false
    });
  });

  var names = {};
  items.concat(extList).forEach(function (i) { names[i.id] = i.name; });
  var itemRows = rows.filter(function (r) { return r.kind === 'item'; });
  var program = !isBlank(project.program_id) ? indexBy_(data.programs)[project.program_id] : null;
  var baselineInfo = null;
  if (base) {
    var live = {};
    items.forEach(function (i) { live[i.id] = true; });
    var baseEnd = '';
    Object.keys(baseItems).forEach(function (id) { var d = baseItems[id].planned_finish; if (!isBlank(d) && d > baseEnd) baseEnd = d; });
    baselineInfo = {
      id: base.row.id, label: base.row.label || ('B' + base.row.number), decided_at: base.row.decided_at || '',
      slipped: itemRows.filter(function (r) { return r.slip > 0; }).length,
      added: itemRows.filter(function (r) { return r.added; }).length,
      removed: Object.keys(baseItems).filter(function (id) { return !live[id]; }).length,
      end: baseEnd || null, end_slip: baseEnd && floats.anchor ? workingDayOffset(baseEnd, floats.anchor, hol) : null
    };
  }

  return {
    today: today,
    anchor: floats.anchor,
    project: {
      id: project.id, code: project.code, name: project.name, status: project.status,
      program_id: project.program_id || '', program_name: program ? program.name : '',
      holiday_country: project.holiday_country || 'FR', start_date: project.start_date || '', end_date: project.end_date || '',
      manager: resourceName_(data, project.manager_resource_id)
    },
    canEditProject: can(uctx, 'wbs.edit', { type: 'project', id: projectId }),
    baseline: baselineInfo,
    rows: rows,
    dependencies: deps.filter(function (d) { return names[d.predecessor_id] && names[d.successor_id]; }).map(function (d) {
      return { id: d.id, version: d.version, from: d.predecessor_id, to: d.successor_id, type: d.dep_type, lag: Number(d.lag_days) || 0, violated: !!violatedDep[d.id] };
    }),
    violations: violations.map(function (v) {
      return Object.assign({}, v, { predecessor_name: names[v.predecessor_id], successor_name: names[v.successor_id] });
    }),
    stats: {
      items: itemRows.length,
      critical: itemRows.filter(function (r) { return r.critical; }).length,
      late: itemRows.filter(function (r) { return r.late; }).length,
      violations: violations.length,
      progress: weightedProgress_(items, holFor),
      beyondEnd: !isBlank(project.end_date) && !!floats.anchor && floats.anchor > project.end_date
    }
  };
}

// ---------------------------------------------------------------- vue programme

/**
 * Une ligne par projet (période, avancement, alertes, jalons) et les dépendances
 * entre projets. Le chemin critique est calculé sur l'ensemble du programme.
 * programId vide = projets hors programme.
 */
function buildProgramView(data, programId, today) {
  var program = programId ? indexBy_(data.programs)[programId] : null;
  if (programId && !program) throw new PpmError('NOT_FOUND', 'Programme introuvable : ' + programId);
  var holFor = holidayResolver(data);
  var projects = data.projects.filter(function (p) {
    return programId ? p.program_id === programId : isBlank(p.program_id);
  }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
  var projIds = {};
  projects.forEach(function (p) { projIds[p.id] = true; });
  var items = data.planitems.filter(function (i) { return projIds[i.project_id]; });
  var itemById = indexBy_(items);
  var deps = data.dependencies.filter(function (d) { return itemById[d.predecessor_id] && itemById[d.successor_id]; });
  var floats = computeFloats(items, deps, holFor);
  var violations = dependencyViolations(items, deps, holFor);
  var violatedDep = {};
  violations.forEach(function (v) { violatedDep[v.dependency_id] = true; });

  var rows = projects.map(function (p) {
    var its = items.filter(function (i) { return i.project_id === p.id; });
    var sp = span_(its);
    return {
      id: p.id, code: p.code, name: p.name, status: p.status || '', manager: resourceName_(data, p.manager_resource_id),
      start: sp.start || p.start_date || null, finish: sp.finish || p.end_date || null,
      end_date: p.end_date || '', progress: weightedProgress_(its, holFor),
      items: its.length,
      late: its.filter(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; }).length,
      critical: its.filter(function (i) { return floats.byId[i.id] && floats.byId[i.id].critical; }).length,
      violations: violations.filter(function (v) { return itemById[v.successor_id].project_id === p.id; }).length,
      milestones: its.filter(function (i) { return i.item_type === 'Jalon' && !isBlank(itemFinish(i)); })
        .sort(byStartThenName_).map(function (m) {
          return { id: m.id, name: m.name, date: itemFinish(m), status: m.status || '', critical: !!(floats.byId[m.id] && floats.byId[m.id].critical) };
        })
    };
  });

  var crossDeps = deps.filter(function (d) {
    return itemById[d.predecessor_id].project_id !== itemById[d.successor_id].project_id;
  }).map(function (d) {
    var a = itemById[d.predecessor_id], b = itemById[d.successor_id];
    return {
      id: d.id, type: d.dep_type, from_project: a.project_id, to_project: b.project_id,
      from_item: a.name, to_item: b.name, violated: !!violatedDep[d.id]
    };
  });

  return {
    today: today,
    anchor: floats.anchor,
    program: program ? { id: program.id, code: program.code, name: program.name, status: program.status || '',
      leader: resourceName_(data, program.leader_resource_id) } : { id: '', code: '', name: 'Projets hors programme', status: '', leader: '' },
    projects: rows,
    crossDependencies: crossDeps,
    stats: {
      projects: rows.length,
      late: rows.reduce(function (s, r) { return s + r.late; }, 0),
      violations: violations.length,
      crossDependencies: crossDeps.length
    }
  };
}

// ---------------------------------------------------------------- rôles

// ---------------------------------------------------------------- actions de l'API

defineAction('planning.catalog', function (p, ctx) {
  var projects = repoList('Project');
  var programs = repoList('Program');
  return {
    programs: programs.map(function (p) { return { id: p.id, code: p.code, name: p.name, status: p.status || '' }; }),
    // programmes dont la personne peut voir la vue consolidée (PL, DPL ; l'administrateur les voit tous) : les pages Actualités, Suivi et Budget ajoutent alors « Programme … »
    program_view: (ctx ? programs.filter(function (g) { return can(ctx, 'program.view', { type: 'program', id: g.id }); }) : []).map(function (g) { return g.id; }),
    projects: projects.map(function (p) {
      return { id: p.id, code: p.code, name: p.name, status: p.status || '', program_id: p.program_id || '' };
    })
  };
});

defineAction('gantt.project', function (p, ctx) {
  var data = loadPlanningData_();
  var projectId = requireParam(p, 'projectId');
  data.baseline = activeBaselineOf_(indexBy_(data.projects)[projectId]);
  return buildProjectGantt(data, projectId, ctx, todayStr());
});

defineAction('gantt.program', function (p) {
  return buildProgramView(loadPlanningData_(), p.programId || '', todayStr());
});

var SCOPE_TABLE = { program: 'Program', project: 'Project', workpackage: 'WorkPackage', planitem: 'PlanItem' };

/**
 * Pose un rôle sur un objet. Règles (05_Rbac.gs, roleAssignCheck_) : le rôle se pose sur son type d'objet et nulle part ailleurs ; c'est un niveau strictement
 * supérieur, détenu sur l'objet ou au-dessus, qui le pose. Reader ne se pose pas. Plusieurs personnes peuvent détenir le même rôle sur un objet.
 */
defineAction('roles.assign', function (p, ctx) {
  var v = p.values || {};
  var type = requireParam(v, 'scope_type');
  if (!SCOPE_TABLE[type]) throw new PpmError('VALIDATION', 'Périmètre invalide : ' + type);
  mustGet(SCOPE_TABLE[type], requireParam(v, 'scope_id'));
  mustGet('Resource', requireParam(v, 'resource_id'));
  var scope = { type: type, id: v.scope_id };
  var problem = roleAssignCheck_(ctx, v.role_code, scope);
  if (problem) throw new PpmError(problem.code, problem.message);
  var dup = repoList('RoleAssignment', function (a) {
    return a.resource_id === v.resource_id && a.role_code === v.role_code && a.scope_type === type &&
      String(a.scope_id) === String(v.scope_id) && (isBlank(a.end_date) || String(a.end_date) >= todayStr());
  });
  if (dup.length) throw new PpmError('VALIDATION', 'Ce rôle est déjà attribué à cette personne sur ce périmètre.');
  return withLock(function () {
    var rec = repoInsert('RoleAssignment', {
      resource_id: v.resource_id, role_code: v.role_code, scope_type: type, scope_id: v.scope_id,
      start_date: v.start_date || todayStr(), end_date: v.end_date || ''
    }, ctx.actx);
    var kind = objectKindOf_(scope, ctx.lookup);
    if (PRINCIPAL_ROLE[kind] === v.role_code) syncPrincipal_(kind, v.scope_id, ctx.actx);
    return rec;
  });
});

/** Fin d'une affectation : on renseigne la date de fin (hier), sans supprimer, pour garder l'historique. */
defineAction('roles.end', function (p, ctx) {
  var id = requireParam(p, 'id');
  var a = mustGet('RoleAssignment', id);
  var scope = { type: a.scope_type, id: a.scope_id };
  if (!ctx.isAdmin && !(bestRankOn_(ctx, scope) < ROLE_RANK[effectiveRoleCode_(a, ctx.lookup)])) {
    throw new PpmError('FORBIDDEN', 'Un rôle se retire depuis un niveau supérieur au sien.');
  }
  return withLock(function () {
    var rec = repoUpdate('RoleAssignment', id, { end_date: addCalendarDays(todayStr(), -1) }, p.version, ctx.actx);
    var kind = objectKindOf_(scope, ctx.lookup);
    if (PRINCIPAL_ROLE[kind] && (a.role_code === PRINCIPAL_ROLE[kind] || (a.role_code === 'RWP' && PRINCIPAL_ROLE[kind] !== 'DO'))) syncPrincipal_(kind, a.scope_id, ctx.actx);
    return rec;
  });
});
