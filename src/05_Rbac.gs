/**
 * PPM Core — droits contextualisés (section 7).
 *
 * Un droit détenu sur un périmètre vaut pour tout ce qu'il contient :
 *   programme ⊃ projet ⊃ workpackage (⊃ sous-WP) ⊃ livrable/jalon.
 * Les rôles se cumulent. Un « membre affecté » (MEMBER) l'est par affectation
 * explicite ou par une ligne budgétaire sur le livrable.
 *
 * Toutes les fonctions reçoivent un objet lookup, ce qui les rend testables :
 *   lookup.planitem(id), lookup.workpackage(id), lookup.project(id), lookup.risk(id)
 *   lookup.budgetMember(resourceId, planItemId) → booléen
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

/**
 * L'utilisateur peut-il faire action sur scope ?
 * ctx : { resourceId, isAdmin, assignments (actives), lookup }
 */
function can(ctx, action, scope) {
  var allowed = PERMISSIONS[action];
  if (!allowed) throw new PpmError('CONFIG', 'Action sans règle de droits : ' + action);
  if (ctx.isAdmin) return true;
  if (allowed.indexOf('*') >= 0) return true;
  if (!ctx.resourceId) return false;

  var roles = ctx.assignments || [];

  if (!scope || scope.type === 'global') {
    return roles.some(function (a) { return allowed.indexOf(a.role_code) >= 0; });
  }

  var chain = scopeAncestors(scope, ctx.lookup);
  var granted = roles.some(function (a) {
    if (allowed.indexOf(a.role_code) < 0) return false;
    return chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
  });
  if (granted) return true;

  // Membre affecté par une ligne budgétaire sur le livrable visé.
  if (allowed.indexOf('MEMBER') >= 0 && scope.type === 'planitem' && ctx.lookup.budgetMember) {
    return ctx.lookup.budgetMember(ctx.resourceId, scope.id) === true;
  }
  return false;
}

/** Variante qui lève FORBIDDEN au lieu de renvoyer faux. */
function requireCan(ctx, action, scope) {
  if (!can(ctx, action, scope)) {
    throw new PpmError('FORBIDDEN', 'Droit insuffisant pour « ' + action + ' »', { scope: scope });
  }
}
