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

var PROJECT_ROLE_CHOICES = [{ code: 'CP', label: 'Chef de projet' }, { code: 'MEMBER', label: 'Membre affecté' }];

function canSeeRates_(ctx) { return ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'global' }); }

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
  var data = { programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage') };
  var canRates = canSeeRates_(ctx);
  var scope = project ? { type: 'project', id: project.id } : null;
  var wpIds = {};
  if (project) data.workpackages.forEach(function (w) { if (w.project_id === project.id) wpIds[w.id] = true; });
  var roles = {};
  if (project) {
    repoList('RoleAssignment').forEach(function (a) {
      if (!isBlank(a.end_date) && String(a.end_date) < today) return;
      var hit = (a.scope_type === 'project' && a.scope_id === project.id) || (a.scope_type === 'workpackage' && wpIds[a.scope_id]) ||
        (a.scope_type === 'program' && !isBlank(project.program_id) && a.scope_id === project.program_id);
      if (!hit) return;
      var list = roles[a.resource_id] = roles[a.resource_id] || [];
      var key = a.role_code + '|' + a.scope_type + '|' + a.scope_id;
      if (list.some(function (x) { return x.key === key; })) return;
      list.push({ key: key, code: a.role_code, label: ROLE_LABELS[a.role_code] || a.role_code, scope_type: a.scope_type, scope: scopeLabel_(data, a.scope_type, a.scope_id), rank: ROLE_RANK[a.role_code] });
    });
  }
  var editAll = canEditResources_(ctx);
  var people = resources.map(function (r) {
    var mine = (roles[r.id] || []).sort(function (a, b) { return a.rank - b.rank; });
    var projectLevel = mine.filter(function (x) { return x.scope_type === 'project' && (x.code === 'CP' || x.code === 'MEMBER'); }).map(function (x) { return x.code; });
    return {
      resource_id: r.id, version: r.version, name: r.name, email: r.email || '', job_function: r.job_function || '', organization: r.organization || '',
      access: isBlank(r.email) ? 'none' : (isAllowedEmail_(r.email) ? 'ok' : 'outside'),
      resource_type: r.resource_type, supplier: r.supplier || '', country: r.country || '', capacity: isBlank(r.capacity_days_month) ? '' : Number(r.capacity_days_month),
      team_id: r.team_id || '', team: teamById[r.team_id] ? teamById[r.team_id].name : '',
      roles: mine.map(function (x) { return { code: x.code, label: x.label, scope: x.scope, scope_type: x.scope_type }; }),
      project_role: projectLevel.indexOf('CP') >= 0 ? 'CP' : projectLevel.indexOf('MEMBER') >= 0 ? 'MEMBER' : '',
      daily_rate: canRates && !isBlank(r.daily_rate) ? Number(r.daily_rate) : null,
      rate_source: canRates ? (!isBlank(r.daily_rate) ? 'fiche' : (rateFor_(r.rate_profile, r.country, today) !== null ? 'grille' : '')) : ''
    };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  var canAssign = !!scope && can(ctx, 'roles.assign', scope);
  var best = canAssign && !ctx.isAdmin ? bestRankOn_(ctx, scope) : 0;
  return {
    project: project ? { id: project.id, code: project.code, name: project.name, manager_id: project.manager_resource_id || '' } : null,
    people: people, teams: teamsFlat_(teams, resources),
    canEdit: editAll, canRates: canRates, canAssign: canAssign,
    roleChoices: canAssign ? PROJECT_ROLE_CHOICES.filter(function (c) { return ROLE_RANK[c.code] >= best; }) : [],
    countries: COUNTRIES, domains: allowedDomains()
  };
});

/** Rôle de projet d'une personne : 'CP' (chef de projet), 'MEMBER' (membre affecté) ou '' (aucun). Les rôles sur un workpackage ne bougent pas. */
defineAction('people.setProjectRole', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var person = mustGet('Resource', requireParam(p, 'resourceId'));
  var role = isBlank(p.role) ? '' : p.role;
  if (['', 'CP', 'MEMBER'].indexOf(role) < 0) throw new PpmError('VALIDATION', 'Rôle de projet inconnu : chef de projet ou membre affecté.');
  var scope = { type: 'project', id: project.id };
  requireCan(ctx, 'roles.assign', scope);
  var best = ctx.isAdmin ? 0 : bestRankOn_(ctx, scope);
  if (role && ROLE_RANK[role] < best) throw new PpmError('FORBIDDEN', 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.');
  if (role === 'CP' && person.resource_type !== 'Interne') throw new PpmError('VALIDATION', 'Le chef de projet doit être une personne interne.');
  return withLock(function () {
    var today = todayStr(), yesterday = addCalendarDays(today, -1);
    var active = repoList('RoleAssignment', function (a) {
      return a.resource_id === person.id && a.scope_type === 'project' && a.scope_id === project.id && (a.role_code === 'CP' || a.role_code === 'MEMBER') && (isBlank(a.end_date) || String(a.end_date) >= today);
    });
    var same = active.length === 1 && active[0].role_code === role;
    if (!same) {
      active.forEach(function (a) {
        if (ROLE_RANK[a.role_code] < best) throw new PpmError('FORBIDDEN', 'Vous ne pouvez pas retirer un rôle plus élevé que le vôtre.');
      });
      active.forEach(function (a) { repoUpdate('RoleAssignment', a.id, { end_date: yesterday }, null, ctx.actx); });
      if (role) repoInsert('RoleAssignment', { resource_id: person.id, role_code: role, scope_type: 'project', scope_id: project.id, start_date: today }, ctx.actx);
    }
    // le chef de projet du projet suit les affectations : celui qui n'est plus chef de projet est remplacé par un autre, ou aucun
    var cps = repoList('RoleAssignment', function (a) {
      return a.role_code === 'CP' && a.scope_type === 'project' && a.scope_id === project.id && (isBlank(a.end_date) || String(a.end_date) >= today);
    }).map(function (a) { return a.resource_id; });
    var current = repoGet('Project', project.id);
    var manager = current.manager_resource_id || '';
    if (manager && cps.indexOf(manager) < 0) manager = '';
    if (!manager && cps.length) manager = cps[0];
    if (manager !== (current.manager_resource_id || '')) repoUpdate('Project', project.id, { manager_resource_id: manager }, null, ctx.actx);
    return { role: role, manager_id: manager, changed: !same };
  });
});

/** Taux journalier d'une personne (vide pour l'effacer). Le chef de projet et le DPL seuls le voient et le fixent. */
defineAction('people.setRate', function (p, ctx) {
  if (!canSeeRates_(ctx)) throw new PpmError('FORBIDDEN', 'Les taux journaliers sont réservés au chef de projet et au DPL.');
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
