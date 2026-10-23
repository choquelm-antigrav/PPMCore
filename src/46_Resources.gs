/**
 * PPM Core — 0.10.0 : page « Ressources ».
 *
 * Un seul écran pour les personnes, les équipes, le rôle dans le projet et le taux journalier :
 *   - ressources.get        : personnes (avec leur équipe, leurs rôles dans le projet choisi, leur taux si on y a droit) et équipes ;
 *   - people.setProjectRole : « Chef de projet » ou « Membre » sur un projet (met fin à l'ancien rôle de projet, garde le chef de projet du projet à jour) ;
 *   - people.setRate        : taux journalier d'une personne, interne ou externe (réservé au chef de projet et au DPL).
 * Le taux saisi sur la fiche remplace la grille profil × pays × date, qui ne sert plus que de secours.
 * La création et la modification des personnes et des équipes passent par resources.* et teams.* (42_Org.gs).
 */

var PROJECT_ROLE_CHOICES = [{ code: 'CP', label: 'Chef de projet' }]; // les autres rôles se posent sur leur objet, dans le WBS

/** Les tarifs journaliers se lisent à partir du Workpackage leader ; les fixer reste réservé au chef de projet et au-dessus (ratecard.manage). */
function canSeeRates_(ctx) { return ctx.isAdmin || can(ctx, 'sensitive.read', { type: 'global' }); }
function canSetRates_(ctx) { return ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'global' }); }

/** Équipes à plat, dans l'ordre de l'arborescence, avec leur profondeur et leur nombre de membres. */
function teamsFlat_(teams, resources) {
  var byParent = {}, count = {};
  resources.forEach(function (r) { if (!isBlank(r.team_id)) count[r.team_id] = (count[r.team_id] || 0) + 1; });
  teams.forEach(function (t) { var k = isBlank(t.parent_team_id) ? '' : t.parent_team_id; (byParent[k] = byParent[k] || []).push(t); });
  var res = indexBy_(resources), out = [], seen = {};
  var walk = function (parent, depth) {
    (byParent[parent] || []).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }).forEach(function (t) {
      if (seen[t.id]) return;
      seen[t.id] = true;
      var mgr = res[t.manager_resource_id];
      out.push({ id: t.id, version: t.version, name: t.name, parent_team_id: t.parent_team_id || '', depth: depth, cost_center: t.cost_center || '',
        manager_id: t.manager_resource_id || '', manager: mgr ? mgr.name : '', members: count[t.id] || 0 });
      walk(t.id, depth + 1);
    });
  };
  walk('', 0);
  teams.forEach(function (t) { if (!seen[t.id]) { seen[t.id] = true; out.push({ id: t.id, version: t.version, name: t.name, parent_team_id: '', depth: 0, cost_center: t.cost_center || '', manager_id: '', manager: '', members: count[t.id] || 0 }); } });
  return out;
}

defineAction('ressources.get', function (p, ctx) {
  var project = isBlank(p.projectId) ? null : mustGet('Project', p.projectId);
  var today = todayStr();
  var resources = repoList('Resource'), teams = repoList('HierarchicalTeam');
  var teamById = indexBy_(teams);
  var data = { programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem') };
  var canRates = canSeeRates_(ctx);
  var scope = project ? { type: 'project', id: project.id } : null;
  var wpIds = {};
  var itemIds = {};
  if (project) data.workpackages.forEach(function (w) { if (w.project_id === project.id) wpIds[w.id] = true; });
  if (project) data.planitems.forEach(function (i) { if (i.project_id === project.id) itemIds[i.id] = true; });
  var placed = {};
  repoList('RoleAssignment').forEach(function (a) { if (isBlank(a.end_date) || String(a.end_date) >= today) placed[a.resource_id] = true; });
  var roles = {};
  if (project) {
    repoList('RoleAssignment').forEach(function (a) {
      if (!isBlank(a.end_date) && String(a.end_date) < today) return;
      var hit = (a.scope_type === 'project' && a.scope_id === project.id) || (a.scope_type === 'workpackage' && wpIds[a.scope_id]) || (a.scope_type === 'planitem' && itemIds[a.scope_id]) ||
        (a.scope_type === 'program' && !isBlank(project.program_id) && a.scope_id === project.program_id);
      if (!hit) return;
      var list = roles[a.resource_id] = roles[a.resource_id] || [];
      if (a.scope_type === 'planitem') { // plusieurs livrables ou jalons avec le même rôle : une seule ligne, avec leur nombre
        var grouped = list.filter(function (x) { return x.code === a.role_code && x.scope_type === 'planitem'; })[0];
        if (grouped) { grouped.n++; grouped.scope = countLabel_(grouped.n, 'livrable ou jalon', 'livrables ou jalons'); return; }
        list.push({ key: a.role_code + '|planitem', n: 1, code: a.role_code, label: ROLE_LABELS[a.role_code] || a.role_code, scope_type: 'planitem', scope: '1 livrable ou jalon', rank: ROLE_RANK[a.role_code] });
        return;
      }
      var key = a.role_code + '|' + a.scope_type + '|' + a.scope_id;
      if (list.some(function (x) { return x.key === key; })) return;
      list.push({ key: key, code: a.role_code, label: ROLE_LABELS[a.role_code] || a.role_code, scope_type: a.scope_type, scope: scopeLabel_(data, a.scope_type, a.scope_id), rank: ROLE_RANK[a.role_code] });
    });
  }
  // livrables et jalons de chaque personne : ceux dont elle est responsable (dans le projet choisi, sinon dans tous) ; et ceux des workpackages où elle
  // a un rôle de responsable ou de membre actif sans en être responsable elle-même (« contribue à »)
  var owned = {}, wpItems = {};
  repoList('PlanItem', function (i) { return !project || i.project_id === project.id; }).forEach(function (i) {
    if (!isBlank(i.owner_resource_id)) { var o = owned[i.owner_resource_id] = owned[i.owner_resource_id] || { d: 0, m: 0 }; if (i.item_type === 'Jalon') o.m++; else o.d++; }
    if (!isBlank(i.wp_id)) (wpItems[i.wp_id] = wpItems[i.wp_id] || []).push(i);
  });
  var contrib = {}, itemById = {};
  repoList('PlanItem', function (i) { return !project || i.project_id === project.id; }).forEach(function (i) { itemById[i.id] = i; });
  repoList('RoleAssignment').forEach(function (a) {
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var set = contrib[a.resource_id] = contrib[a.resource_id] || {};
    if (a.scope_type === 'planitem' && ['DO', 'CONTRIB'].indexOf(a.role_code) >= 0) { var it = itemById[a.scope_id]; if (it && it.owner_resource_id !== a.resource_id) set[it.id] = true; return; }
    if (a.scope_type !== 'workpackage' || ['WPL', 'SWPL', 'RWP', 'MEMBER'].indexOf(a.role_code) < 0) return;
    (wpItems[a.scope_id] || []).forEach(function (i) { if (i.owner_resource_id !== a.resource_id) set[i.id] = true; });
  });
  var editAll = canEditResources_(ctx);
  var people = resources.map(function (r) {
    var mine = (roles[r.id] || []).sort(function (a, b) { return a.rank - b.rank; });
    var projectLevel = mine.filter(function (x) { return x.scope_type === 'project' && x.code === 'CP'; }).map(function (x) { return x.code; });
    return {
      resource_id: r.id, version: r.version, name: r.name, email: r.email || '', job_function: r.job_function || '', organization: r.organization || '',
      unplaced: !placed[r.id],
      deliverables: (owned[r.id] || {}).d || 0, milestones: (owned[r.id] || {}).m || 0, contributes: Object.keys(contrib[r.id] || {}).length,
      access: isBlank(r.email) ? 'none' : (isAllowedEmail_(r.email) ? 'ok' : 'outside'),
      resource_type: r.resource_type, supplier: r.supplier || '', country: r.country || '', capacity: isBlank(r.capacity_days_month) ? '' : Number(r.capacity_days_month),
      team_id: r.team_id || '', team: teamById[r.team_id] ? teamById[r.team_id].name : '',
      roles: mine.map(function (x) { return { code: x.code, label: x.label, scope: x.scope, scope_type: x.scope_type }; }),
      project_role: projectLevel.indexOf('CP') >= 0 ? 'CP' : '',
      daily_rate: canRates && !isBlank(r.daily_rate) ? Number(r.daily_rate) : null,
      rate_source: canRates ? (!isBlank(r.daily_rate) ? 'fiche' : (rateFor_(r.rate_profile, r.country, today) !== null ? 'grille' : '')) : ''
    };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  var assignable = scope ? assignableRolesOn_(ctx, scope) : [];
  var canAssign = assignable.indexOf('CP') >= 0;
  return {
    project: project ? { id: project.id, code: project.code, name: project.name, manager_id: project.manager_resource_id || '' } : null,
    people: people, teams: teamsFlat_(teams, resources),
    canEdit: editAll, canRates: canRates, canAssign: canAssign,
    roleChoices: PROJECT_ROLE_CHOICES.filter(function (c) { return assignable.indexOf(c.code) >= 0; }),
    countries: COUNTRIES, domains: allowedDomains()
  };
});

/** Rôle de projet d'une personne : 'CP' (chef de projet) ou '' (aucun). Les autres rôles se posent sur leur objet, dans le WBS ; ceux d'un workpackage ou d'un livrable ne bougent pas ici. */
defineAction('people.setProjectRole', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var person = mustGet('Resource', requireParam(p, 'resourceId'));
  var role = isBlank(p.role) ? '' : p.role;
  if (['', 'CP'].indexOf(role) < 0) throw new PpmError('VALIDATION', 'Rôle de projet inconnu : seul le chef de projet se pose sur un projet depuis cette page.');
  var scope = { type: 'project', id: project.id };
  var problem = roleAssignCheck_(ctx, 'CP', scope);
  if (problem) throw new PpmError(problem.code, problem.message);
  if (role === 'CP' && person.resource_type !== 'Interne') throw new PpmError('VALIDATION', 'Le chef de projet doit être une personne interne.');
  return withLock(function () {
    var today = todayStr(), yesterday = addCalendarDays(today, -1);
    var active = repoList('RoleAssignment', function (a) {
      return a.resource_id === person.id && a.scope_type === 'project' && a.scope_id === project.id && a.role_code === 'CP' && (isBlank(a.end_date) || String(a.end_date) >= today);
    });
    var same = active.length === 1 && role === 'CP';
    if (!same) {
      active.forEach(function (a) { repoUpdate('RoleAssignment', a.id, { end_date: yesterday }, null, ctx.actx); });
      if (role) repoInsert('RoleAssignment', { resource_id: person.id, role_code: role, scope_type: 'project', scope_id: project.id, start_date: today }, ctx.actx);
    }
    // le chef de projet de la fiche projet suit les affectations : celui qui n'est plus chef de projet est remplacé par un autre, ou aucun
    syncPrincipal_('project', project.id, ctx.actx);
    return { role: role, manager_id: repoGet('Project', project.id).manager_resource_id || '', changed: !same };
  });
});

/** Taux journalier d'une personne (vide pour l'effacer). Le chef de projet et le DPL seuls le voient et le fixent. */
defineAction('people.setRate', function (p, ctx) {
  if (!canSetRates_(ctx)) throw new PpmError('FORBIDDEN', 'Fixer les taux journaliers est réservé au chef de projet et aux niveaux au-dessus.');
  var r = mustGet('Resource', requireParam(p, 'resourceId'));
  var value = '';
  if (!(p.daily_rate === null || p.daily_rate === undefined || String(p.daily_rate).trim() === '')) {
    var n = Number(String(p.daily_rate).replace(',', '.'));
    if (isNaN(n) || n <= 0 || n > 100000) throw new PpmError('VALIDATION', 'Taux journalier : un nombre positif en euros par jour.');
    value = round2(n);
  }
  repoUpdate('Resource', r.id, { daily_rate: value }, p.version, ctx.actx);
  return { resource_id: r.id, daily_rate: value === '' ? null : value };
});
