/**
 * PPM Core — 0.8.0 : dépendances, rôles, personnes et équipes depuis les pages.
 *
 * Complète 41_Edit.gs (WBS) pour que l'outil se passe d'AppSheet :
 *   - deps.item, dependencies.update : les liens d'un élément, avec les candidats possibles (même programme) ;
 *   - roles.options : les rôles et périmètres que l'utilisateur peut attribuer (jamais plus haut que le sien) ;
 *   - people.remove : retrait d'une personne sans laisser de trace bancale (rôles terminés, responsabilités libérées) ;
 *   - teams.* : équipes hiérarchiques, sans boucle, supprimables seulement vides.
 * L'attribution et la fin d'un rôle passent par roles.assign / roles.end (32_Views.gs), les membres d'équipe par resources.update.
 */

var TEAM_NAME_MAX = 80;

// ---------------------------------------------------------------- dépendances

function depItemView_(it, projects, wps) {
  var wp = it.wp_id ? wps[it.wp_id] : null;
  return {
    id: it.id, name: it.name, item_type: it.item_type, project_id: it.project_id,
    project_code: projects[it.project_id] ? projects[it.project_id].code : '', finish: it.planned_finish || '',
    wp: wp ? (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name : ''
  };
}

/** Liens d'un élément (amont et aval) et éléments avec lesquels on peut en créer, dans le même programme. */
defineAction('deps.item', function (p, ctx) {
  var id = requireParam(p, 'itemId');
  var item = mustGet('PlanItem', id);
  var projects = indexBy_(repoList('Project'));
  var wps = indexBy_(repoList('WorkPackage'));
  var items = indexBy_(repoList('PlanItem'));
  var programId = projects[item.project_id] ? projects[item.project_id].program_id : '';
  var preds = [], succs = [], linked = {};
  linked[id] = true;
  repoList('Dependency', function (d) { return d.predecessor_id === id || d.successor_id === id; }).forEach(function (d) {
    var incoming = d.successor_id === id;
    var other = items[incoming ? d.predecessor_id : d.successor_id];
    if (!other) return;
    linked[other.id] = true;
    (incoming ? preds : succs).push({
      id: d.id, version: d.version, dep_type: d.dep_type, lag_days: Number(d.lag_days) || 0,
      other: depItemView_(other, projects, wps), canEdit: can(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id })
    });
  });
  var canEdit = can(ctx, 'wbs.edit', { type: 'planitem', id: id });
  var candidates = [], truncated = false;
  Object.keys(items).forEach(function (k) {
    var o = items[k];
    if (linked[o.id]) return;
    var pr = projects[o.project_id];
    if (!pr || (o.project_id !== item.project_id && (isBlank(programId) || pr.program_id !== programId))) return;
    candidates.push(Object.assign(depItemView_(o, projects, wps), { can_edit: can(ctx, 'wbs.edit', { type: 'planitem', id: o.id }) }));
  });
  candidates.sort(function (a, b) {
    return (Number(b.project_id === item.project_id) - Number(a.project_id === item.project_id)) ||
      String(a.project_code).localeCompare(String(b.project_code), 'fr') || String(a.name).localeCompare(String(b.name), 'fr');
  });
  if (candidates.length > 400) { candidates = candidates.slice(0, 400); truncated = true; }
  return {
    item: depItemView_(item, projects, wps), canEdit: canEdit, predecessors: preds, successors: succs,
    candidates: canEdit || candidates.some(function (c) { return c.can_edit; }) ? candidates : [], truncated: truncated
  };
});

defineAction('dependencies.update', function (p, ctx) {
  var d = mustGet('Dependency', requireParam(p, 'id'));
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id });
  var patch = p.patch || {}, out = {};
  if ('dep_type' in patch) {
    if (['FS', 'SS', 'FF', 'SF'].indexOf(patch.dep_type) < 0) throw new PpmError('VALIDATION', 'Type de lien inconnu : FS, SS, FF ou SF.');
    out.dep_type = patch.dep_type;
  }
  if ('lag_days' in patch) out.lag_days = checkLag_(patch.lag_days);
  return repoUpdate('Dependency', d.id, out, p.version, ctx.actx);
});

function checkLag_(v) {
  var n = isBlank(v) ? 0 : Number(v);
  if (isNaN(n) || Math.floor(n) !== n || n < -365 || n > 365) throw new PpmError('VALIDATION', 'Décalage : un nombre entier de jours ouvrés entre -365 et 365.');
  return n;
}

// ---------------------------------------------------------------- rôles

/** Ce que l'utilisateur peut attribuer : les périmètres où il a le droit, avec le rang minimal des rôles qu'il peut donner. */
defineAction('roles.options', function (p, ctx) {
  var out = [];
  var projects = indexBy_(repoList('Project'));
  var push = function (type, id, label) {
    var scope = { type: type, id: id };
    if (!can(ctx, 'roles.assign', scope)) return;
    out.push({ type: type, id: id, label: label, min_rank: ctx.isAdmin ? 0 : bestRankOn_(ctx, scope) });
  };
  repoList('Program').forEach(function (g) { push('program', g.id, g.code + ' — ' + g.name); });
  repoList('Project').forEach(function (x) { push('project', x.id, x.code + ' — ' + x.name); });
  repoList('WorkPackage').forEach(function (w) {
    push('workpackage', w.id, (w.wbs_code ? w.wbs_code + ' ' : '') + w.name + ' (' + (projects[w.project_id] ? projects[w.project_id].code : '?') + ')');
  });
  return {
    roles: ROLES.map(function (c) { return { code: c, label: ROLE_LABELS[c] || c, rank: ROLE_RANK[c] }; }),
    scopes: out.slice(0, 600)
  };
});

// ---------------------------------------------------------------- personnes

/**
 * Personnes sans aucun rôle en cours, nulle part : celles qu'on vient de créer et qu'il reste à positionner dans l'organigramme.
 * Renvoyées avec l'organigramme (par rôles comme par équipes) pour être proposées à l'attribution d'un rôle.
 */
function unplacedPeople_(data, ctx, today) {
  var has = {};
  (data.assignments || []).forEach(function (a) { if (isBlank(a.end_date) || String(a.end_date) >= today) has[a.resource_id] = true; });
  var teamsById = indexBy_(data.teams || []), editAll = canEditResources_(ctx);
  var list = (data.resources || []).filter(function (r) { return !isTrue(r.deleted) && !has[r.id]; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  return { total: list.length, people: list.slice(0, 60).map(function (r) { return personCard_(r, teamsById, ctx, editAll); }) };
}

/**
 * Retire une personne : ses rôles se terminent, elle cesse de diriger une équipe, ses responsabilités sont libérées
 * (les éléments et workpackages qu'elle portait redeviennent « à désigner » et remontent dans les constats).
 * dryRun = true : annonce ce qui se passerait, sans rien changer.
 */
defineAction('people.remove', function (p, ctx) {
  if (!canEditResources_(ctx)) throw new PpmError('FORBIDDEN', 'Seuls un Program Leader, un DPL ou un chef de projet retirent une personne.');
  var id = requireParam(p, 'id');
  var r = mustGet('Resource', id);
  if (ctx.resourceId && ctx.resourceId === id) throw new PpmError('VALIDATION', 'Vous ne pouvez pas retirer votre propre fiche.');
  var today = todayStr();
  var roles = repoList('RoleAssignment', function (a) { return a.resource_id === id && (isBlank(a.end_date) || String(a.end_date) >= today); });
  var teams = repoList('HierarchicalTeam', function (t) { return t.manager_resource_id === id; });
  var wps = repoList('WorkPackage', function (w) { return w.owner_resource_id === id; });
  var items = repoList('PlanItem', function (i) { return i.owner_resource_id === id; });
  var summary = { name: r.name, roles: roles.length, teams: teams.length, wps: wps.length, items: items.length };
  if (p.dryRun) return Object.assign({ dryRun: true }, summary);
  return withLock(function () {
    var yesterday = addCalendarDays(today, -1);
    roles.forEach(function (a) { repoUpdate('RoleAssignment', a.id, { end_date: yesterday }, null, ctx.actx); });
    teams.forEach(function (t) { repoUpdate('HierarchicalTeam', t.id, { manager_resource_id: '' }, null, ctx.actx); });
    wps.forEach(function (w) { repoUpdate('WorkPackage', w.id, { owner_resource_id: '' }, null, ctx.actx); });
    items.forEach(function (i) { repoUpdate('PlanItem', i.id, { owner_resource_id: '' }, null, ctx.actx); });
    repoSoftDelete('Resource', id, p.version, ctx.actx);
    return Object.assign({ dryRun: false }, summary);
  });
});

// ---------------------------------------------------------------- équipes hiérarchiques

function requireTeamEditor_(ctx) {
  if (!canEditResources_(ctx)) throw new PpmError('FORBIDDEN', 'Seuls un Program Leader, un DPL ou un chef de projet gèrent les équipes.');
}

function teamName_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le nom de l’équipe est obligatoire.');
  if (s.length > TEAM_NAME_MAX) throw new PpmError('VALIDATION', 'Le nom de l’équipe est limité à ' + TEAM_NAME_MAX + ' caractères.');
  return s;
}

function teamParent_(parentId, selfId) {
  if (isBlank(parentId)) return '';
  var teams = indexBy_(repoList('HierarchicalTeam'));
  if (!teams[parentId]) throw new PpmError('VALIDATION', 'Équipe parente introuvable.');
  if (selfId) {
    var cur = parentId, guard = 0;
    while (cur && guard++ < 100) {
      if (cur === selfId) throw new PpmError('VALIDATION', 'Une équipe ne peut pas être placée sous elle-même ni sous l’une de ses sous-équipes.');
      cur = teams[cur] && !isBlank(teams[cur].parent_team_id) ? teams[cur].parent_team_id : '';
    }
  }
  return parentId;
}

function teamManager_(id) {
  if (isBlank(id)) return '';
  var r = repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Responsable d’équipe introuvable.');
  return String(id);
}

defineAction('teams.create', function (p, ctx) {
  requireTeamEditor_(ctx);
  var v = p.values || {};
  return repoInsert('HierarchicalTeam', {
    name: teamName_(v.name), parent_team_id: teamParent_(v.parent_team_id, ''), manager_resource_id: teamManager_(v.manager_resource_id),
    cost_center: wbsShortText_(v.cost_center, 40, 'Centre de coût')
  }, ctx.actx);
});

defineAction('teams.update', function (p, ctx) {
  requireTeamEditor_(ctx);
  var id = requireParam(p, 'id');
  mustGet('HierarchicalTeam', id);
  var patch = p.patch || {}, out = {};
  if ('name' in patch) out.name = teamName_(patch.name);
  if ('parent_team_id' in patch) out.parent_team_id = teamParent_(patch.parent_team_id, id);
  if ('manager_resource_id' in patch) out.manager_resource_id = teamManager_(patch.manager_resource_id);
  if ('cost_center' in patch) out.cost_center = wbsShortText_(patch.cost_center, 40, 'Centre de coût');
  return repoUpdate('HierarchicalTeam', id, out, p.version, ctx.actx);
});

/** Une équipe ne se supprime que vide : ni membres, ni sous-équipes (on les déplace d'abord). */
defineAction('teams.delete', function (p, ctx) {
  requireTeamEditor_(ctx);
  var id = requireParam(p, 'id');
  mustGet('HierarchicalTeam', id);
  var members = repoList('Resource', function (r) { return r.team_id === id; }).length;
  var subs = repoList('HierarchicalTeam', function (t) { return t.parent_team_id === id; }).length;
  if (members || subs) {
    throw new PpmError('VALIDATION', 'Cette équipe compte ' + members + ' membre(s) et ' + subs + ' sous-équipe(s) : déplacez-les d’abord.', { rule: 'NOT_EMPTY', members: members, teams: subs });
  }
  return repoSoftDelete('HierarchicalTeam', id, p.version, ctx.actx);
});
