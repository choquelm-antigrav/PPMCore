/**
 * PPM Core — droits contextualisés (section 7).
 *
 * Un rôle posé sur un objet vaut pour tout ce qu'il contient (règle 2) :
 *   programme ⊃ projet ⊃ workpackage ⊃ sous-workpackage ⊃ livrable/jalon.
 * Les rôles se cumulent (règle 3). Huit niveaux (00_Config.gs) : PL, DPL, CP, WPL, SWPL, DO, CONTRIB, READER (implicite : lit tout, ne modifie rien).
 * Un droit est exprimé par un NIVEAU MINIMAL : ce niveau et tous ceux du dessus l'ont. Les droits d'écriture sur le WBS dépendent du type d'objet visé.
 *
 * Toutes les fonctions reçoivent un objet lookup, ce qui les rend testables :
 *   lookup.planitem(id), lookup.workpackage(id), lookup.project(id), lookup.risk(id)
 */

/**
 * Chaîne des périmètres englobants, du plus précis au plus large.
 * scope : { type: 'planitem'|'workpackage'|'project'|'program'|'risk'|'global', id }
 */
function scopeAncestors(scope, lookup) {
  var chain = [];
  var guard = 0;
  var cur = scope;
  while (cur && guard++ < 20) {
    chain.push(cur);
    cur = parentScope(cur, lookup);
  }
  return chain;
}

function parentScope(scope, lookup) {
  var rec;
  switch (scope.type) {
    case 'planitem':
      rec = lookup.planitem(scope.id);
      if (!rec) return null;
      return !isBlank(rec.wp_id) ? { type: 'workpackage', id: rec.wp_id } : { type: 'project', id: rec.project_id };
    case 'risk':
      rec = lookup.risk(scope.id);
      return rec ? { type: 'project', id: rec.project_id } : null;
    case 'workpackage':
      rec = lookup.workpackage(scope.id);
      if (!rec) return null;
      return !isBlank(rec.parent_wp_id) ? { type: 'workpackage', id: rec.parent_wp_id } : { type: 'project', id: rec.project_id };
    case 'project':
      rec = lookup.project(scope.id);
      return rec && !isBlank(rec.program_id) ? { type: 'program', id: rec.program_id } : null;
    default:
      return null;
  }
}

/** Affectations actives d'une ressource à une date donnée. */
function activeAssignments(resourceId, assignments, today) {
  return (assignments || []).filter(function (a) {
    if (isTrue(a.deleted) || a.resource_id !== resourceId) return false;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return false;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return false;
    return true;
  });
}

/** Les rôles enregistrables de rang au plus égal à celui donné : le rôle et tous ceux du dessus. */
function rolesUpTo_(rank) {
  return ASSIGNABLE_ROLES.filter(function (r) { return ROLE_RANK[r] <= rank; });
}

/**
 * Genre d'objet d'un périmètre : programme, projet, workpackage, sous-workpackage (un workpackage qui a un parent) ou livrable/jalon.
 * Sert à savoir quel rôle peut y être posé et quel niveau y modifie.
 */
function objectKindOf_(scope, lookup) {
  if (!scope) return '';
  if (scope.type === 'workpackage') {
    var w = lookup.workpackage(scope.id);
    return w && !isBlank(w.parent_wp_id) ? 'subworkpackage' : 'workpackage';
  }
  return scope.type;
}

/**
 * Rang minimal (numéro le plus haut) qui peut agir sur l'objet visé avec wbs.edit (modifier l'objet, ou créer dedans) ou wbs.delete (le supprimer) :
 * le niveau de l'objet modifie ; le niveau du dessus crée et supprime l'objet (sauf un livrable ou un jalon, que son Deliverable owner supprime aussi).
 */
function wbsRank_(action, scope, lookup) {
  var del = action === 'wbs.delete';
  switch (objectKindOf_(scope, lookup)) {
    case 'program': return 0;
    case 'project': return del ? 1 : 2;
    case 'workpackage': return del ? 2 : 3;
    case 'subworkpackage': return del ? 3 : 4;
    case 'planitem': return 5;
    default: return 2;
  }
}

/** Les rôles qui ont ce droit sur ce périmètre. */
function permissionRoles_(action, scope, lookup) {
  if ((action === 'wbs.edit' || action === 'wbs.delete') && scope && scope.type !== 'global') return rolesUpTo_(wbsRank_(action, scope, lookup));
  return PERMISSIONS[action];
}

/**
 * Code de rôle réellement appliqué : les anciens codes d'avant la 0.15.3 gardent leurs droits jusqu'à la migration (A9_MIGRER_ROLES) ;
 * le responsable de workpackage devient Workpackage leader (ou Sub-workpackage leader sur un sous-workpackage), le membre devient Contributor.
 */
function effectiveRoleCode_(a, lookup) {
  if (a.role_code === 'RWP') {
    var w = a.scope_type === 'workpackage' && lookup ? lookup.workpackage(a.scope_id) : null;
    return w && !isBlank(w.parent_wp_id) ? 'SWPL' : 'WPL';
  }
  if (a.role_code === 'MEMBER') return 'CONTRIB';
  return a.role_code;
}

function sameScope_(s, type, id) { return s.type === type && String(s.id) === String(id); }

/** Le périmètre de l'affectation est-il dans (ou égal à) la cible ? */
function assignmentWithin_(a, target, lookup) {
  return scopeAncestors({ type: a.scope_type, id: a.scope_id }, lookup).some(function (s) { return sameScope_(s, target.type, target.id); });
}

/** Affectations actives d'une ressource à une date donnée. */
function activeAssignments(resourceId, assignments, today) {
  return (assignments || []).filter(function (a) {
    if (isTrue(a.deleted) || a.resource_id !== resourceId) return false;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return false;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return false;
    return true;
  });
}

/**
 * L'utilisateur peut-il faire action sur scope ?
 * ctx : { resourceId, isAdmin, assignments (actives), lookup }
 * Hors administrateur, il faut détenir, sur le périmètre ou un périmètre qui le contient, un rôle de niveau suffisant ; pour les droits « en profondeur »
 * (PERMISSION_DEEP), un rôle détenu n'importe où dans le périmètre visé compte aussi.
 */
function can(ctx, action, scope) {
  var level = PERMISSION_LEVEL[action];
  if (!level) throw new PpmError('CONFIG', 'Action sans règle de droits : ' + action);
  if (ctx.isAdmin) return true;
  if (level === '*') return true;
  if (!ctx.resourceId) return false;

  // un risque se rattache au projet : pour un droit « en profondeur », on raisonne sur ce projet
  if (PERMISSION_DEEP[action] && scope && scope.type === 'risk') scope = parentScope(scope, ctx.lookup) || scope;
  var allowed = permissionRoles_(action, scope, ctx.lookup);
  var roles = (ctx.assignments || []).map(function (a) {
    return { code: effectiveRoleCode_(a, ctx.lookup), scope_type: a.scope_type, scope_id: a.scope_id };
  }).filter(function (a) { return allowed.indexOf(a.code) >= 0; });
  if (!roles.length) return false;

  if (!scope || scope.type === 'global') return true;

  var chain = scopeAncestors(scope, ctx.lookup);
  if (roles.some(function (a) { return chain.some(function (s) { return sameScope_(s, a.scope_type, a.scope_id); }); })) return true;
  if (PERMISSION_DEEP[action] && (scope.type === 'project' || scope.type === 'program')) {
    return roles.some(function (a) { return assignmentWithin_({ scope_type: a.scope_type, scope_id: a.scope_id }, scope, ctx.lookup); });
  }
  return false;
}

/** Variante qui lève FORBIDDEN au lieu de renvoyer faux. */
function requireCan(ctx, action, scope) {
  if (!can(ctx, action, scope)) {
    throw new PpmError('FORBIDDEN', 'Droit insuffisant pour « ' + action + ' »', { scope: scope });
  }
}

/** Meilleur rang (numéro le plus bas) détenu par l'appelant sur le périmètre ou un périmètre englobant ; 99 s'il n'en a aucun. */
function bestRankOn_(ctx, scope) {
  var chain = scopeAncestors(scope, ctx.lookup), best = 99;
  (ctx.assignments || []).forEach(function (a) {
    if (!chain.some(function (s) { return sameScope_(s, a.scope_type, a.scope_id); })) return;
    var r = ROLE_RANK[effectiveRoleCode_(a, ctx.lookup)];
    if (r !== undefined && r < best) best = r;
  });
  return best;
}

/**
 * Peut-on poser ce rôle sur cet objet ? Renvoie null si oui, sinon la raison.
 *   1. le rôle se pose sur son type d'objet et nulle part ailleurs (pas de chef de projet sur un livrable, pas de Deliverable owner sur un workpackage) ;
 *   2. c'est un niveau STRICTEMENT supérieur, détenu sur l'objet ou au-dessus, qui le pose (un livrable reçoit son Deliverable owner d'un Sub-workpackage leader ou au-dessus) ;
 *   3. Reader ne se pose pas : c'est le rôle par défaut. Le Program Leader est posé par l'administrateur (personne n'est au-dessus).
 */
function roleAssignCheck_(ctx, roleCode, scope) {
  var bad = function (code, message) { return { code: code, message: message }; };
  if (roleCode === 'READER') return bad('VALIDATION', 'Reader est le rôle par défaut de toute personne sans autre rôle : il ne se pose pas.');
  if (ASSIGNABLE_ROLES.indexOf(roleCode) < 0) return bad('VALIDATION', 'Rôle inconnu : ' + roleCode);
  var kind = objectKindOf_(scope, ctx.lookup), want = ROLE_OBJECT[roleCode];
  if (kind !== want) return bad('VALIDATION', ROLE_LABELS[roleCode] + ' se pose sur ' + OBJECT_LABELS[want] + ', pas sur ' + (OBJECT_LABELS[kind] || 'cet objet') + '.');
  if (ctx.isAdmin) return null;
  if (!(bestRankOn_(ctx, scope) < ROLE_RANK[roleCode])) {
    return bad('FORBIDDEN', roleCode === 'PL' ? 'Le Program Leader est désigné par l’administrateur.'
      : ROLE_LABELS[roleCode] + ' est désigné par un niveau supérieur au sien sur ' + OBJECT_LABELS[kind] + '.');
  }
  return null;
}

/** Même contrôle, en message seul (null si le rôle peut être posé). */
function roleAssignError_(ctx, roleCode, scope) {
  var c = roleAssignCheck_(ctx, roleCode, scope);
  return c ? c.message : null;
}

/** Les rôles que l'appelant peut poser sur cet objet. */
function assignableRolesOn_(ctx, scope) {
  return ASSIGNABLE_ROLES.filter(function (r) { return roleAssignError_(ctx, r, scope) === null; });
}

