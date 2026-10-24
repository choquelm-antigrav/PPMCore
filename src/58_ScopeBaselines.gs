/**
 * PPM Core — 0.15.5 : baselines par périmètre (projet, workpackage ou sous-workpackage), en parallèle.
 *
 * Chaque baseline porte un PÉRIMÈTRE : le projet (ancienne baseline, sans périmètre enregistré), un workpackage ou un sous-workpackage ; jamais un livrable. Elle fige ce périmètre
 * et tout ce qu'il contient (sous-workpackages, livrables, jalons, dépendances, lignes de budget). Il y a UNE baseline active PAR PÉRIMÈTRE, une numérotation et un historique par
 * périmètre. Les références sont PARALLÈLES : la baseline du projet reste la référence des vues projet et programme et aucun niveau inférieur ne peut la remplacer ; la baseline d'un
 * workpackage est la référence locale de ce workpackage, et ses écarts restent calculables contre la référence du projet (changes « hors référence projet » visibles des niveaux du dessus).
 *
 * QUI. Figer une baseline demande de pouvoir MODIFIER l'objet visé (même rang que wbs.edit : projet = chef de projet, workpackage = Workpackage leader, sous-workpackage = Sub-workpackage
 * leader, et les niveaux au-dessus). Un Contributor ou un Deliverable owner peut seulement en DEMANDER une (baselines.request), que traite qui peut figer ce périmètre.
 *
 * INFORMER. Une baseline figée est active tout de suite et reste « à valider » : l'événement `baseline_frozen` du journal porte le niveau de son auteur et apparaît dans « Changements à
 * valider » du niveau du dessus, avec le résumé de ce qui a bougé. Ce niveau peut la valider, ou la refuser (changes.reject) : la baseline passe à « Refusée » et la précédente du
 * même périmètre redevient active. Aucun mail nouveau : le récapitulatif du matin compte déjà les changements à valider de chacun.
 */

/** Le périmètre d'une baseline : { type: 'project'|'workpackage', id }. */
function baselineScope_(b) {
  return b && b.scope_type === 'workpackage' && !isBlank(b.scope_id) ? { type: 'workpackage', id: b.scope_id } : { type: 'project', id: b.project_id };
}
function sameBaselineScope_(a, b) { return a.type === b.type && String(a.id) === String(b.id); }

/** Un workpackage et tous ses descendants, sous forme d'ensemble d'identifiants. */
function wpSubtreeIds_(wps, rootId) {
  var kids = {};
  wps.forEach(function (w) { if (w.parent_wp_id) (kids[w.parent_wp_id] = kids[w.parent_wp_id] || []).push(w.id); });
  var out = {}, stack = [rootId], guard = 0;
  while (stack.length && guard++ < 5000) {
    var id = stack.pop();
    if (out[id]) continue;
    out[id] = true;
    (kids[id] || []).forEach(function (k) { stack.push(k); });
  }
  return out;
}

/** Restreint un instantané à un ensemble de workpackages : eux, leurs livrables et jalons, les dépendances dont le successeur est gardé, les lignes de budget de ces livrables. */
function restrictSnapshotToWps_(snap, wpSet) {
  var out = { Project: {}, WorkPackage: {}, PlanItem: {}, Dependency: {}, BudgetLine: {} };
  Object.keys(snap.WorkPackage || {}).forEach(function (id) { if (wpSet[id]) out.WorkPackage[id] = snap.WorkPackage[id]; });
  Object.keys(snap.PlanItem || {}).forEach(function (id) { var w = snap.PlanItem[id].wp_id; if (w && wpSet[w]) out.PlanItem[id] = snap.PlanItem[id]; });
  Object.keys(snap.Dependency || {}).forEach(function (id) { if (out.PlanItem[snap.Dependency[id].successor_id]) out.Dependency[id] = snap.Dependency[id]; });
  Object.keys(snap.BudgetLine || {}).forEach(function (id) { if (out.PlanItem[snap.BudgetLine[id].deliverable_id]) out.BudgetLine[id] = snap.BudgetLine[id]; });
  return out;
}

/** Les workpackages d'un périmètre dans un instantané ancien : ceux d'aujourd'hui et ceux que cet instantané avait sous la même racine (créés ou supprimés depuis). */
function snapshotWpSet_(snap, currentWps, rootId) {
  var set = wpSubtreeIds_(currentWps, rootId), kids = {};
  Object.keys(snap.WorkPackage || {}).forEach(function (id) { var p = snap.WorkPackage[id].parent_wp_id; if (p) (kids[p] = kids[p] || []).push(id); });
  var stack = [rootId], guard = 0;
  while (stack.length && guard++ < 5000) { var id = stack.pop(); set[id] = true; (kids[id] || []).forEach(function (k) { stack.push(k); }); }
  return set;
}

function baselineScopeLabel_(scope, project, wpById) {
  if (scope.type === 'project') return 'Projet ' + (project ? project.code : '');
  var w = wpById[scope.id];
  return w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : '(workpackage supprimé)';
}

/** Valide et rend le périmètre demandé (scopeType / scopeId) : le projet par défaut ; un workpackage doit appartenir au projet. */
function scopeFromParams_(p, projectId) {
  if (isBlank(p.scopeType) || p.scopeType === 'project') return { type: 'project', id: projectId };
  if (p.scopeType !== 'workpackage') throw new PpmError('VALIDATION', 'Périmètre invalide : une baseline porte sur un projet, un workpackage ou un sous-workpackage, jamais sur un livrable.');
  var w = repoGet('WorkPackage', requireParam(p, 'scopeId'));
  if (!w || isTrue(w.deleted) || w.project_id !== projectId) throw new PpmError('VALIDATION', 'Ce workpackage n’appartient pas à ce projet.');
  return { type: 'workpackage', id: w.id };
}

/** Peut-on figer une baseline sur ce périmètre ? Il faut pouvoir en modifier l'objet. */
function canBaselineScope_(ctx, scope) {
  if (scope.type === 'project') return can(ctx, 'baseline.manage', scope);
  var w = repoGet('WorkPackage', scope.id);
  return !!w && !isTrue(w.deleted) && can(ctx, 'wbs.edit', scope);
}
function requireBaselineScope_(ctx, scope) {
  if (!canBaselineScope_(ctx, scope)) throw new PpmError('FORBIDDEN', 'Vous ne pouvez figer une baseline que sur un périmètre dont vous pouvez modifier les objets : le projet, un workpackage ou un sous-workpackage.');
}

/** Les périmètres de ce projet, dans l'ordre du WBS : { type, id, label, depth, canCreate, active }. */
function baselineScopes_(ctx, project, baselines) {
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; }), wpById = indexBy_(wps);
  var order = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  var activeOf = function (scope) {
    return baselines.filter(function (b) { return b.status === 'Active' && sameBaselineScope_(baselineScope_(b), scope); })[0] || null;
  };
  var out = [], add = function (scope, depth) {
    var a = activeOf(scope);
    out.push({ type: scope.type, id: scope.id, label: baselineScopeLabel_(scope, project, wpById), depth: depth, canCreate: canBaselineScope_(ctx, scope), active: a ? { id: a.id, label: a.label || 'B' + a.number, number: Number(a.number), decided_at: a.decided_at || '' } : null });
  };
  add({ type: 'project', id: project.id }, 0);
  var kids = {}; wps.forEach(function (w) { if (w.parent_wp_id) (kids[w.parent_wp_id] = kids[w.parent_wp_id] || []).push(w); });
  wps.filter(function (w) { return isBlank(w.parent_wp_id) || !wpById[w.parent_wp_id]; }).sort(order).forEach(function (w) {
    add({ type: 'workpackage', id: w.id }, 1);
    (kids[w.id] || []).sort(order).forEach(function (k) { add({ type: 'workpackage', id: k.id }, 2); });
  });
  return out;
}

/** Fait pointer le périmètre sur sa baseline active (vide : plus de référence). */
function setActiveBaseline_(scope, baselineId, ctx) {
  repoUpdate(scope.type === 'project' ? 'Project' : 'WorkPackage', scope.id, { active_baseline_id: baselineId }, null, ctx.actx);
}

/** Résumé d'une baseline qui vient d'être figée, en regard de la précédente du même périmètre : ce qui est écrit dans « Changements à valider ». */
function baselineSummary_(rec, scope, previousSnap, snap, project, label) {
  var parts = ['« ' + label + ' » figée' + (rec.number !== '' ? ' (B' + rec.number + ')' : '')];
  if (previousSnap) {
    var t = diffSnapshots(previousSnap, snap, loadHolidayMap(project.holiday_country || 'FR')).totals;
    var bits = [];
    if (t.end_slip) bits.push('fin ' + (t.end_slip > 0 ? '+' : '') + t.end_slip + ' j ouvrés');
    if (t.slipped || t.advanced) bits.push((t.slipped + t.advanced) + ' date(s) déplacée(s)');
    if (t.added) bits.push(t.added + ' ajout(s)');
    if (t.removed) bits.push(t.removed + ' retrait(s)');
    if (t.budget_delta) bits.push('budget ' + (t.budget_delta > 0 ? '+' : '') + t.budget_delta + ' €');
    parts.push(bits.length ? 'depuis la précédente : ' + bits.join(', ') : 'aucun écart avec la précédente');
  } else parts.push('première baseline de ce périmètre');
  parts.push('justification : ' + String(rec.justification || '').slice(0, 160));
  return truncate(parts.join(' — '), 500);
}

/** L'événement « baseline figée » du journal : c'est lui qui se valide (ou se refuse) dans la page Suivi. */
function announceBaseline_(rec, text, ctx) {
  var level = ctx.actx.actor_level !== undefined ? String(ctx.actx.actor_level) : actorLevelOf_(ctx.actx.actor, 'Baseline', rec);
  repoAppendHistory('ChangeEvent', [{
    id: newId(), at: nowIso(), table_name: 'Baseline', entity_id: rec.id, project_id: rec.project_id, field: 'baseline_frozen',
    old_value: '', new_value: text, actor: ctx.actx.actor, source: ctx.actx.source, acknowledged: false, actor_level: level
  }]);
}

/**
 * Le niveau du dessus REFUSE une baseline figée par un niveau inférieur : elle passe à « Refusée », la précédente du même périmètre redevient la référence active (ou le périmètre
 * se retrouve sans référence s'il n'y en avait pas), et l'événement est traité. Même droit que valider : un niveau strictement supérieur à l'auteur, sur le périmètre.
 */
defineAction('changes.reject', function (p, ctx) {
  var id = requireParam(p, 'id');
  var reason = String(p.reason || '').trim();
  if (!reason) throw new PpmError('VALIDATION', 'Le motif du refus est obligatoire.');
  var t = getTable('ChangeEvent');
  return withLock(function () {
    var rows = t.readAll(), idx = -1;
    rows.forEach(function (e, i) { if (e.id === id) idx = i; });
    if (idx < 0) throw new PpmError('NOT_FOUND', 'Changement introuvable.');
    var e = rows[idx];
    if (e.field !== 'baseline_frozen') throw new PpmError('VALIDATION', 'Seule une baseline figée se refuse : les autres changements se corrigent à la main.');
    if (isTrue(e.acknowledged)) throw new PpmError('VALIDATION', 'Ce changement est déjà traité.');
    if (!canValidateEvent_(ctx, e, eventScope_(e))) throw new PpmError('FORBIDDEN', 'On ne refuse que ce qu’un niveau inférieur au sien a figé.');
    var b = repoGet('Baseline', e.entity_id);
    if (!b || b.status !== 'Active') throw new PpmError('VALIDATION', 'Cette baseline n’est plus la référence active de son périmètre : rien à refuser.');
    var scope = baselineScope_(b);
    repoUpdate('Baseline', b.id, { status: 'Refusée', decided_by: ctx.email, decided_at: nowIso() }, null, ctx.actx);
    var prev = repoList('Baseline', function (x) { return x.project_id === b.project_id && x.status === 'Archivée' && sameBaselineScope_(baselineScope_(x), scope); })
      .sort(function (a, c) { return (Number(c.number) || 0) - (Number(a.number) || 0); })[0] || null;
    if (prev) repoUpdate('Baseline', prev.id, { status: 'Active', decided_by: ctx.email, decided_at: nowIso() }, null, ctx.actx);
    setActiveBaseline_(scope, prev ? prev.id : '', ctx);
    t.updateRows([{ row: idx + 2, obj: Object.assign({}, e, { acknowledged: true, acknowledged_by: ctx.email, acknowledged_at: nowIso() }) }]);
    noteEvent_('Baseline', b.id, b.project_id, 'Refus de la baseline figée : ' + reason + (prev ? ' (retour à ' + (prev.label || 'B' + prev.number) + ')' : ' (le périmètre n’a plus de référence)'), ctx);
    return { rejected: b.id, restored: prev ? prev.id : null };
  });
});
