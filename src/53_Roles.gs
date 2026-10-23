/**
 * PPM Core — 0.15.3 : rôles par niveau (suite de 05_Rbac.gs et 00_Config.gs).
 *
 * RESPONSABLE PRINCIPAL. Les colonnes `owner_resource_id` (workpackage, élément) et `manager_resource_id` (projet) sont lues partout (synthèse du matin, Copilote,
 * baselines, agenda, constats « sans responsable »). Elles sont conservées et deviennent le « principal » de l'objet : la première personne qui détient le rôle de
 * l'objet (Chef de projet, Workpackage leader, Sub-workpackage leader, Deliverable owner), ou vide s'il n'y en a plus. Poser un rôle met la colonne à jour ;
 * écrire la colonne par l'ancien chemin (formulaire du WBS, API, page Vue d'ensemble) pose le rôle, avec les mêmes règles.
 *
 * MIGRATION. rolesMigrate_ reprend les données d'avant la 0.15.3 (A9_MIGRER_ROLES) : additive pour les nouvelles lignes, jamais destructrice (les anciens rôles sont terminés,
 * pas supprimés), relançable, avec une simulation.
 */

/** Le rôle que porte le responsable principal de chaque genre d'objet. */
var PRINCIPAL_ROLE = { project: 'CP', workpackage: 'WPL', subworkpackage: 'SWPL', planitem: 'DO' };

var PRINCIPAL_TABLE = { project: 'Project', workpackage: 'WorkPackage', subworkpackage: 'WorkPackage', planitem: 'PlanItem' };
var PRINCIPAL_SCOPE_TYPE = { project: 'project', workpackage: 'workpackage', subworkpackage: 'workpackage', planitem: 'planitem' };

/** « 1 livrable ou jalon », « 4 livrables ou jalons » : le nombre et le bon nombre grammatical. */
function countLabel_(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

function principalColumn_(kind) { return kind === 'project' ? 'manager_resource_id' : 'owner_resource_id'; }

function roleActive_(a, today) {
  return !isTrue(a.deleted) && (isBlank(a.end_date) || String(a.end_date) >= today);
}

/** Les affectations actives de ce rôle (et de son ancien code) sur ce périmètre, dans l'ordre où elles ont été posées. */
function roleHolders_(code, scopeType, scopeId, today) {
  var legacy = code === 'WPL' || code === 'SWPL' ? 'RWP' : '';
  return repoList('RoleAssignment', function (a) {
    return (a.role_code === code || (legacy && a.role_code === legacy)) && a.scope_type === scopeType && String(a.scope_id) === String(scopeId) && roleActive_(a, today);
  }).sort(function (a, b) {
    return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));
  });
}

/** Le principal d'un objet = la première personne qui détient son rôle, vide sinon. Ne réécrit que si la valeur change. */
function syncPrincipal_(kind, id, actx) {
  var table = PRINCIPAL_TABLE[kind], rec = repoGet(table, id);
  if (!rec || isTrue(rec.deleted)) return;
  var holders = roleHolders_(PRINCIPAL_ROLE[kind], PRINCIPAL_SCOPE_TYPE[kind], id, todayStr());
  var col = principalColumn_(kind), cur = rec[col] || '';
  var want = holders.some(function (h) { return h.resource_id === cur; }) ? cur : (holders.length ? holders[0].resource_id : '');
  if (String(cur) !== String(want)) { var patch = {}; patch[col] = want; repoUpdate(table, id, patch, null, actx); }
}

/**
 * Avant d'écrire un responsable par l'ancien chemin : il faut pouvoir désigner ce rôle (un niveau strictement supérieur au rôle, sur l'objet ou au-dessus).
 * chainScope = l'objet lui-même, ou son parent quand l'objet n'existe pas encore.
 */
function assertCanSetPrincipal_(ctx, kind, chainScope, oldOwner, newOwner) {
  if (String(oldOwner || '') === String(newOwner || '')) return;
  var role = PRINCIPAL_ROLE[kind];
  if (ctx.isAdmin || bestRankOn_(ctx, chainScope) < ROLE_RANK[role]) return;
  throw new PpmError('FORBIDDEN', 'Désigner le ' + ROLE_LABELS[role] + ' relève d’un niveau supérieur au vôtre sur cet objet.', { role: role });
}

/** Après l'écriture de la colonne par l'ancien chemin : le rôle suit (l'ancien principal perd le sien, le nouveau le reçoit). */
function applyPrincipal_(actx, kind, id, oldOwner, newOwner) {
  if (String(oldOwner || '') === String(newOwner || '')) return;
  var role = PRINCIPAL_ROLE[kind], st = PRINCIPAL_SCOPE_TYPE[kind], today = todayStr(), yesterday = addCalendarDays(today, -1);
  var holders = roleHolders_(role, st, id, today);
  if (!isBlank(oldOwner)) {
    holders.filter(function (h) { return h.resource_id === oldOwner; }).forEach(function (h) { repoUpdate('RoleAssignment', h.id, { end_date: yesterday }, null, actx); });
  }
  if (!isBlank(newOwner) && !holders.some(function (h) { return h.resource_id === newOwner; })) {
    repoInsert('RoleAssignment', { resource_id: newOwner, role_code: role, scope_type: st, scope_id: id, start_date: today }, actx);
  }
}

/**
 * Un DPL qui crée un projet en devient le DPL (il est posé sur ses projets, pas sur le programme). Un Program Leader ou un administrateur n'en a pas besoin.
 */
function autoAssignCreatorDpl_(ctx, project) {
  if (ctx.isAdmin || !ctx.resourceId || isBlank(project.program_id)) return;
  var programScope = { type: 'program', id: project.program_id };
  var isPl = (ctx.assignments || []).some(function (a) {
    return effectiveRoleCode_(a, ctx.lookup) === 'PL' && sameScope_(programScope, a.scope_type, a.scope_id);
  });
  if (isPl) return;
  var already = roleHolders_('DPL', 'project', project.id, todayStr()).some(function (h) { return h.resource_id === ctx.resourceId; });
  if (!already) repoInsert('RoleAssignment', { resource_id: ctx.resourceId, role_code: 'DPL', scope_type: 'project', scope_id: project.id, start_date: todayStr() }, ctx.actx);
}

/**
 * Meilleur rang (numéro le plus bas) d'une personne dans un projet : un rôle sur le projet, sur l'un de ses workpackages ou de ses livrables, ou sur son programme ;
 * le chef de projet de la fiche projet compte pour Chef de projet. 99 si elle n'a aucun rôle dans ce projet. data : { workpackages, planitems, assignments }.
 */
function personRankInProject_(data, personId, project, today) {
  var best = project.manager_resource_id === personId ? ROLE_RANK.CP : 99;
  var wpById = indexBy_(data.workpackages || []), itemById = indexBy_(data.planitems || []);
  (data.assignments || []).forEach(function (a) {
    if (a.resource_id !== personId || !roleActive_(a, today)) return;
    var pid = a.scope_type === 'project' ? a.scope_id : a.scope_type === 'workpackage' ? (wpById[a.scope_id] || {}).project_id : a.scope_type === 'planitem' ? (itemById[a.scope_id] || {}).project_id : '';
    var inProgram = a.scope_type === 'program' && !isBlank(project.program_id) && String(a.scope_id) === String(project.program_id);
    if (pid !== project.id && !inProgram) return;
    var code = a.role_code === 'RWP' ? ((wpById[a.scope_id] || {}).parent_wp_id ? 'SWPL' : 'WPL') : a.role_code === 'MEMBER' ? 'CONTRIB' : a.role_code;
    var r = ROLE_RANK[code];
    if (r !== undefined && r < best) best = r;
  });
  return best;
}

/** Cette personne peut-elle lire budgets, tarifs et comptes rendus de ce projet ? (Workpackage leader et au-dessus.) */
function personReadsSensitive_(data, personId, project, today) {
  return personRankInProject_(data, personId, project, today) <= ROLE_RANK[PERMISSION_LEVEL['sensitive.read']];
}

// ---------------------------------------------------------------- migration

/**
 * Reprend les rôles et les responsables d'avant la 0.15.3 :
 *   - DPL posé sur le programme → DPL posé sur chacun de ses projets (l'ancienne ligne est terminée) ;
 *   - responsable de workpackage (RWP) → Workpackage leader, ou Sub-workpackage leader sur un sous-workpackage (le code change sur place) ;
 *   - membre (MEMBER) posé sur un projet, un workpackage ou un programme → Contributor sur chaque livrable et jalon de ce périmètre (l'ancienne ligne est terminée) ;
 *   - responsable d'un élément → Deliverable owner ; d'un workpackage → Workpackage ou Sub-workpackage leader ; chef de projet de la fiche projet → Chef de projet ;
 *   - personne ayant une ligne budgétaire sur un livrable sans y avoir de rôle → Contributor de ce livrable.
 * Additive et relançable. dryRun = true : compte seulement, n'écrit rien.
 */
function rolesMigrate_(actx, dryRun) {
  var today = todayStr(), yesterday = addCalendarDays(today, -1);
  var out = { dpl: 0, wpl: 0, contrib: 0, owners: 0, managers: 0, budget: 0, ended: 0, already: 0, skipped: 0, dryRun: !!dryRun };
  var projects = repoList('Project'), wps = repoList('WorkPackage'), items = repoList('PlanItem');
  var wpById = indexBy_(wps), resById = indexBy_(repoList('Resource'));
  var rows = repoList('RoleAssignment').map(function (a) {
    return { id: a.id, resource_id: a.resource_id, role_code: a.role_code, scope_type: a.scope_type, scope_id: a.scope_id, end_date: a.end_date, deleted: a.deleted, version: a.version };
  });
  function has(resId, code, type, id) {
    return rows.some(function (a) { return roleActive_(a, today) && a.resource_id === resId && a.role_code === code && a.scope_type === type && String(a.scope_id) === String(id); });
  }
  function hasAny(resId, codes, type, id) { return codes.some(function (c) { return has(resId, c, type, id); }); }
  function add(counter, resId, code, type, id) {
    if (has(resId, code, type, id)) { out.already++; return; }
    out[counter]++;
    var row = { resource_id: resId, role_code: code, scope_type: type, scope_id: id, end_date: '', deleted: false };
    if (!dryRun) { var rec = repoInsert('RoleAssignment', Object.assign({ start_date: today }, row), actx); row.id = rec.id; row.version = rec.version; }
    rows.push(row);
  }
  function end(a) { out.ended++; a.end_date = yesterday; if (!dryRun) repoUpdate('RoleAssignment', a.id, { end_date: yesterday }, null, actx); }
  function wpDescendants(wpId) {
    var ids = {}; ids[wpId] = true;
    wps.forEach(function (w) { if (w.parent_wp_id === wpId) ids[w.id] = true; });
    return ids;
  }
  var liveItems = items.filter(function (i) { return !isTrue(i.deleted); });

  // 1. DPL posé sur un programme
  rows.filter(function (a) { return a.role_code === 'DPL' && a.scope_type === 'program' && roleActive_(a, today) && resById[a.resource_id]; }).forEach(function (a) {
    projects.filter(function (p) { return !isTrue(p.deleted) && String(p.program_id) === String(a.scope_id); }).forEach(function (p) { add('dpl', a.resource_id, 'DPL', 'project', p.id); });
    end(a);
  });
  // 2. responsable de workpackage → Workpackage leader / Sub-workpackage leader
  rows.filter(function (a) { return a.role_code === 'RWP' && roleActive_(a, today); }).forEach(function (a) {
    var w = a.scope_type === 'workpackage' ? wpById[a.scope_id] : null;
    if (!w || isTrue(w.deleted) || !resById[a.resource_id]) { out.skipped++; return; }
    var code = !isBlank(w.parent_wp_id) ? 'SWPL' : 'WPL';
    if (has(a.resource_id, code, 'workpackage', w.id)) { out.already++; end(a); return; }
    out.wpl++; a.role_code = code;
    if (!dryRun) repoUpdate('RoleAssignment', a.id, { role_code: code }, null, actx);
  });
  // 3. membre → Contributor de chaque livrable et jalon du périmètre
  rows.filter(function (a) { return a.role_code === 'MEMBER' && roleActive_(a, today) && resById[a.resource_id]; }).forEach(function (a) {
    var inScope;
    if (a.scope_type === 'project') inScope = function (i) { return i.project_id === a.scope_id; };
    else if (a.scope_type === 'workpackage') { var ids = wpDescendants(a.scope_id); inScope = function (i) { return !!ids[i.wp_id]; }; }
    else if (a.scope_type === 'program') { var pids = {}; projects.forEach(function (p) { if (String(p.program_id) === String(a.scope_id)) pids[p.id] = true; }); inScope = function (i) { return !!pids[i.project_id]; }; }
    else { out.skipped++; return; }
    liveItems.filter(inScope).forEach(function (i) { if (!hasAny(a.resource_id, ['DO'], 'planitem', i.id)) add('contrib', a.resource_id, 'CONTRIB', 'planitem', i.id); });
    end(a);
  });
  // 4. les responsables d'aujourd'hui deviennent des rôles
  liveItems.forEach(function (i) {
    if (!isBlank(i.owner_resource_id) && resById[i.owner_resource_id]) add('owners', i.owner_resource_id, 'DO', 'planitem', i.id);
  });
  wps.filter(function (w) { return !isTrue(w.deleted); }).forEach(function (w) {
    if (!isBlank(w.owner_resource_id) && resById[w.owner_resource_id]) add('owners', w.owner_resource_id, !isBlank(w.parent_wp_id) ? 'SWPL' : 'WPL', 'workpackage', w.id);
  });
  projects.filter(function (p) { return !isTrue(p.deleted); }).forEach(function (p) {
    if (!isBlank(p.manager_resource_id) && resById[p.manager_resource_id]) add('managers', p.manager_resource_id, 'CP', 'project', p.id);
  });
  // 5. une ligne budgétaire sur un livrable fait de la personne un contributeur de ce livrable
  repoList('BudgetLine').forEach(function (b) {
    if (isBlank(b.resource_id) || isBlank(b.deliverable_id) || !resById[b.resource_id]) return;
    var it = liveItems.filter(function (i) { return i.id === b.deliverable_id; })[0];
    if (!it || hasAny(b.resource_id, ['DO', 'CONTRIB'], 'planitem', it.id)) return;
    add('budget', b.resource_id, 'CONTRIB', 'planitem', it.id);
  });
  return out;
}

function migrerRoles_(dryRun) {
  var email = ''; try { email = currentUserEmail_(); } catch (e) { /* hors Apps Script (essais) : l'auteur sera « migration » */ }
  return withLock(function () {
    var r = rolesMigrate_({ actor: email || 'migration', source: 'migration' }, dryRun);
    return (dryRun ? 'Simulation (rien n’a été écrit) : ' : 'Migration faite : ') + r.dpl + ' DPL posé(s) sur des projets, ' + r.wpl + ' responsable(s) de workpackage converti(s), '
      + r.contrib + ' Contributor(s) posé(s) sur des livrables ou jalons, ' + r.owners + ' responsable(s) devenu(s) Deliverable owner ou leader de workpackage, '
      + r.managers + ' chef(s) de projet, ' + r.budget + ' contributeur(s) d’après le budget ; ' + r.ended + ' ancienne(s) ligne(s) terminée(s), '
      + r.already + ' déjà en place, ' + r.skipped + ' ignorée(s).';
  });
}
