/**
 * PPM Core — 0.15.3 (phase 4) : validation par le niveau du dessus.
 *
 * RÈGLE 1 : une création, une modification ou une suppression d'un objet du WBS part tout de suite (comme aujourd'hui) et reste « à valider » dans la page Suivi jusqu'à ce
 * qu'un niveau STRICTEMENT supérieur à celui de son auteur, sur cet objet, la valide. Une seule validation suffit.
 *
 * NIVEAU DE L'AUTEUR. Il est enregistré dans chaque événement du journal au moment du changement (`ChangeEvent.actor_level`) : le meilleur rang que l'auteur détient sur l'objet
 * ou au-dessus (0 Program Leader … 6 Contributor, 99 sans rôle). Un administrateur ou le système (installation, migration, traitements de nuit) vaut 0 : personne au-dessus,
 * rien à valider. Un événement antérieur à la 0.15.3 n'a pas de niveau : il compte comme 99, et tout niveau qui a un rôle sur l'objet peut le valider.
 * Le fil, l'accusé et les compteurs lisent tous cette même valeur : ils ne peuvent pas se contredire.
 *
 * QUI VALIDE. Toute personne dont le meilleur rang sur l'objet est strictement inférieur à celui de l'auteur ; le validateur « nominal » affiché est le niveau présent juste
 * au-dessus dans la chaîne (un Deliverable owner est validé par son Sub-workpackage leader, ou son Workpackage leader s'il n'y en a pas, etc.).
 *
 * QU'EST-CE QUI SE VALIDE. Les données figées par les baselines (BASELINE_FIELDS : dates, responsables, noms, dépendances, lignes de budget, créations et suppressions)
 * et l'avancement déclaré d'un livrable (`PlanItem.progress_pct`).
 */

var VALIDATION_EXTRA_FIELDS = { PlanItem: ['progress_pct'] };
var VALIDATION_WINDOW_DAYS = 60;   // sans baseline active, le fil remonte aux 60 derniers jours

/** L'événement porte-t-il sur une donnée à valider ? */
function isValidatableEvent_(e) {
  if (isBaselinedEvent_(e)) return true;
  return (VALIDATION_EXTRA_FIELDS[e.table_name] || []).indexOf(e.field) >= 0;
}

/** Niveau de l'auteur d'un événement : 0 = rien à valider ; 99 = sans rôle ou événement ancien. */
function eventRank_(e) {
  return isBlank(e.actor_level) ? 99 : Number(e.actor_level);
}

/** Périmètre de l'objet d'un changement : projet, workpackage ou livrable (une dépendance se rattache à son successeur, une ligne de budget à son livrable). */
function changeScope_(table, rec) {
  if (!rec) return null;
  switch (table) {
    case 'Project': return { type: 'project', id: rec.id };
    case 'WorkPackage': return { type: 'workpackage', id: rec.id };
    case 'PlanItem': return { type: 'planitem', id: rec.id };
    case 'Dependency': return rec.successor_id ? { type: 'planitem', id: rec.successor_id } : null;
    case 'BudgetLine': return rec.deliverable_id ? { type: 'planitem', id: rec.deliverable_id } : null;
    default: return null;
  }
}

/** Périmètre d'un événement du journal, retrouvé même si l'objet a été supprimé depuis. */
function eventScope_(e) {
  var rec = null;
  try { rec = repoList(e.table_name, function (r) { return r.id === e.entity_id; }, { includeDeleted: true })[0] || null; } catch (err) { rec = null; }
  return changeScope_(e.table_name, rec) || (e.project_id ? { type: 'project', id: e.project_id } : null);
}

/**
 * Niveau avec lequel une personne agit sur un objet, à écrire dans l'événement : 0 pour un administrateur ou le système, sinon son meilleur rang sur l'objet ou au-dessus,
 * 99 si elle n'a aucun rôle. '' quand la table n'est pas un objet du WBS (rien à valider).
 */
function actorLevelOf_(actor, table, rec) {
  var email = String(actor || '').toLowerCase();
  if (email.indexOf('@') < 0 || adminEmails().indexOf(email) >= 0) return '0';
  var scope = changeScope_(table, rec);
  if (!scope) return '';
  var person = findResourceByEmail(email);
  if (!person) return '99';
  var lookup = repoLookup_(), best = 99;
  var chain = scopeAncestors(scope, lookup);
  activeAssignments(person.id, repoList('RoleAssignment'), todayStr()).forEach(function (a) {
    if (!chain.some(function (s) { return sameScope_(s, a.scope_type, a.scope_id); })) return;
    var r = ROLE_RANK[effectiveRoleCode_(a, lookup)];
    if (r !== undefined && r < best) best = r;
  });
  return String(best);
}

/** Meilleur rang (numéro le plus bas) que donnent ces affectations sur une chaîne de périmètres ; 99 sans rôle. Fonction pure. */
function bestRankIn_(assignments, chain, lookup) {
  var best = 99;
  (assignments || []).forEach(function (a) {
    if (!chain.some(function (s) { return sameScope_(s, a.scope_type, a.scope_id); })) return;
    var r = ROLE_RANK[effectiveRoleCode_(a, lookup)];
    if (r !== undefined && r < best) best = r;
  });
  return best;
}

/** Cette personne peut-elle valider cet événement ? (niveau strictement supérieur à celui de l'auteur, sur l'objet) */
function canValidateEvent_(ctx, e, scope) {
  var rank = eventRank_(e);
  if (rank <= 0) return false;                    // un administrateur, un Program Leader ou le système : personne au-dessus
  if (ctx.isAdmin) return true;
  if (!scope) return false;
  return bestRankOn_(ctx, scope) < rank;
}

/**
 * Le niveau qui doit valider (validateur nominal) : le niveau présent juste au-dessus de l'auteur dans la chaîne de l'objet. Renvoie son libellé, ou '' si personne
 * n'est posé au-dessus (seul l'administrateur peut alors valider).
 */
function nominalValidator_(e, scope, assignments, lookup) {
  var rank = eventRank_(e);
  if (!scope || rank <= 0) return '';
  var chain = scopeAncestors(scope, lookup), best = -1;
  assignments.forEach(function (a) {
    if (!chain.some(function (s) { return sameScope_(s, a.scope_type, a.scope_id); })) return;
    var r = ROLE_RANK[effectiveRoleCode_(a, lookup)];
    if (r !== undefined && r < rank && r > best) best = r;
  });
  if (best < 0) return '';
  return ROLES.filter(function (c) { return ROLE_RANK[c] === best; }).map(function (c) { return ROLE_LABELS[c]; })[0] || '';
}

/** Date de départ du fil d'un projet : la baseline active, ou les soixante derniers jours. */
function validationSince_(project) {
  var active = !isBlank(project.active_baseline_id) ? repoGet('Baseline', project.active_baseline_id) : null;
  if (active && active.status === 'Active') return { baseline: active, since: String(active.decided_at) };
  return { baseline: null, since: addCalendarDays(todayStr(), -VALIDATION_WINDOW_DAYS) };
}

/**
 * Combien de changements cette personne peut-elle valider dans ce projet ? (mail récapitulatif) Mêmes critères que le fil : fenêtre, données à valider, niveau de l'auteur strictement
 * supérieur au sien sur l'objet. ctx : { resourceId, isAdmin, assignments, lookup } ; data : { changeEvents, planitems, workpackages }. Une dépendance ou une ligne de budget compte au
 * niveau du projet (le récapitulatif ne charge pas ces tables).
 */
function pendingChangesFor_(ctx, data, project) {
  var since = validationSince_(project).since;
  var scopeType = { Project: 'project', WorkPackage: 'workpackage', PlanItem: 'planitem' };
  var n = 0;
  (data.changeEvents || []).forEach(function (e) {
    if (e.project_id !== project.id || isTrue(e.acknowledged) || String(e.at) < since || !isValidatableEvent_(e)) return;
    var rank = eventRank_(e);
    if (rank <= 0) return;
    var scope = scopeType[e.table_name] ? { type: scopeType[e.table_name], id: e.entity_id } : { type: 'project', id: project.id };
    if (ctx.isAdmin || bestRankIn_(ctx.assignments, scopeAncestors(scope, ctx.lookup), ctx.lookup) < rank) n++;
  });
  return n;
}
