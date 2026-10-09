/**
 * PPM Core — A6_EFFACER_ANCIENNE_DEMO : suppression de l'ancienne démo (programme DEMO), en deux lancements, par suppression douce.
 */

// ---------------------------------------------------------------- remplacer l'ancienne démo (A6_EFFACER_ANCIENNE_DEMO)

/** L'ancienne démo (jusqu'en 0.10.0) : programme « DEMO », projet « PILOTE » et deux personnes fictives sans adresse. */
var OLD_DEMO_PROGRAM = 'DEMO';
var OLD_DEMO_PEOPLE = [['Camille Durand', 'Ingénieure structure', 'Bureau d’études'], ['Sam Weber', 'Responsable essais', 'Sous-traitant Alpha']];
var OLD_DEMO_CONFIRM_MS = 10 * 60 * 1000; // la confirmation (second lancement) doit venir dans les dix minutes

function oldDemoNote_() {
  return repoList('Program', function (p) { return p.code === OLD_DEMO_PROGRAM; }).length
    ? ' Attention : l’ancienne démo (programme ' + OLD_DEMO_PROGRAM + ') est toujours là ; A6_EFFACER_ANCIENNE_DEMO la supprime.' : '';
}

/**
 * Tout ce qui dépend de l'ancienne démo, sans rien modifier : le programme DEMO, ses projets et tout ce qui s'y rattache (découpage, planning,
 * dépendances, budget, achats, baselines, risques, rôles), puis les deux personnes fictives si plus rien d'autre ne s'y rapporte.
 * Renvoie les lignes à supprimer par table, dans l'ordre où les supprimer (les dépendantes d'abord).
 */
function oldDemoInventory_() {
  var idsOf = function (rows) { var m = {}; rows.forEach(function (r) { m[r.id] = true; }); return m; };
  var programs = repoList('Program', function (p) { return p.code === OLD_DEMO_PROGRAM; }), programIds = idsOf(programs);
  var projects = repoList('Project', function (p) { return programIds[p.program_id]; }), projectIds = idsOf(projects);
  var inProject = function (r) { return projectIds[r.project_id]; };
  var wps = repoList('WorkPackage', inProject), wpIds = idsOf(wps);
  var items = repoList('PlanItem', inProject), itemIds = idsOf(items);
  var del = {};
  del.Dependency = repoList('Dependency', function (x) { return itemIds[x.predecessor_id] || itemIds[x.successor_id]; });
  del.MilestoneRequirement = repoList('MilestoneRequirement', function (x) { return itemIds[x.milestone_id] || itemIds[x.deliverable_id]; });
  del.BudgetLine = repoList('BudgetLine', function (x) { return itemIds[x.deliverable_id]; });
  var lineIds = idsOf(del.BudgetLine);
  del.BudgetPhasing = repoList('BudgetPhasing', function (x) { return lineIds[x.budget_line_id]; });
  del.ProgressUpdate = repoList('ProgressUpdate', function (x) { return itemIds[x.deliverable_id]; });
  var linkRows = repoList('PurchaseOrderLink'), mine = linkRows.filter(function (x) { return itemIds[x.deliverable_id]; });
  del.PurchaseOrderLink = mine;
  // une commande disparaît seulement si tous ses liens pointent vers des livrables de l'ancienne démo
  var poIds = {}; mine.forEach(function (x) { poIds[x.po_id] = true; });
  linkRows.forEach(function (x) { if (!itemIds[x.deliverable_id]) delete poIds[x.po_id]; });
  del.PurchaseOrder = repoList('PurchaseOrder', function (x) { return poIds[x.id]; });
  del.RiskOpportunity = repoList('RiskOpportunity', inProject);
  del.Insight = repoList('Insight', inProject);
  del.Baseline = repoList('Baseline', inProject);
  var scopeIds = {};
  [programIds, projectIds, wpIds, itemIds].forEach(function (m) { Object.keys(m).forEach(function (k) { scopeIds[k] = true; }); });
  del.RoleAssignment = repoList('RoleAssignment', function (x) { return scopeIds[x.scope_id]; });
  del.PlanItem = items; del.WorkPackage = wps; del.Project = projects; del.Program = programs;
  // les personnes fictives : sans adresse, reconnues par nom, fonction et organisation, et plus citées nulle part ailleurs
  var gone = {}; Object.keys(del).forEach(function (t) { gone[t] = idsOf(del[t]); });
  var cited = {};
  var cite = function (rows, table, cols) { rows.forEach(function (r) { if (gone[table] && gone[table][r.id]) return; cols.forEach(function (c) { if (!isBlank(r[c])) cited[r[c]] = true; }); }); };
  cite(repoList('RoleAssignment'), 'RoleAssignment', ['resource_id']);
  cite(repoList('WorkPackage'), 'WorkPackage', ['owner_resource_id']);
  cite(repoList('PlanItem'), 'PlanItem', ['owner_resource_id']);
  cite(repoList('Project'), 'Project', ['manager_resource_id']);
  cite(repoList('Program'), 'Program', ['leader_resource_id']);
  cite(repoList('BudgetLine'), 'BudgetLine', ['resource_id']);
  cite(repoList('PurchaseOrder'), 'PurchaseOrder', ['resource_id', 'owner_resource_id']);
  cite(repoList('ProgressUpdate'), 'ProgressUpdate', ['resource_id']);
  cite(repoList('RiskOpportunity'), 'RiskOpportunity', ['owner_resource_id']);
  cite(repoList('HierarchicalTeam'), 'HierarchicalTeam', ['manager_resource_id']);
  var kept = [];
  del.Resource = repoList('Resource', function (r) {
    var sig = OLD_DEMO_PEOPLE.some(function (p) { return r.name === p[0] && r.job_function === p[1] && r.organization === p[2]; });
    if (!sig || !isBlank(r.email)) return false;
    if (cited[r.id]) { kept.push(r.name); return false; }
    return true;
  });
  var order = ['Dependency', 'MilestoneRequirement', 'BudgetPhasing', 'BudgetLine', 'PurchaseOrderLink', 'PurchaseOrder', 'ProgressUpdate', 'RiskOpportunity', 'Insight',
    'Baseline', 'RoleAssignment', 'PlanItem', 'WorkPackage', 'Project', 'Program', 'Resource'];
  var total = 0; order.forEach(function (t) { total += del[t].length; });
  return { del: del, order: order, total: total, kept: kept };
}

var OLD_DEMO_LABELS = { // [au singulier, au pluriel]
  Program: ['programme', 'programmes'], Project: ['projet', 'projets'], WorkPackage: ['workpackage', 'workpackages'], PlanItem: ['livrable ou jalon', 'livrables ou jalons'],
  Dependency: ['dépendance', 'dépendances'], MilestoneRequirement: ['exigence de jalon', 'exigences de jalon'], BudgetLine: ['ligne de budget', 'lignes de budget'],
  BudgetPhasing: ['étalement', 'étalements'], PurchaseOrder: ['commande d’achat', 'commandes d’achat'], PurchaseOrderLink: ['lien de commande', 'liens de commande'],
  ProgressUpdate: ['mise à jour d’avancement', 'mises à jour d’avancement'], RiskOpportunity: ['risque ou opportunité', 'risques ou opportunités'], Insight: ['constat', 'constats'],
  Baseline: ['baseline', 'baselines'], RoleAssignment: ['rôle', 'rôles'], Resource: ['personne fictive', 'personnes fictives']
};

function oldDemoSummary_(inv) {
  return inv.order.filter(function (t) { return inv.del[t].length; }).map(function (t) {
    var n = inv.del[t].length;
    return n + ' ' + OLD_DEMO_LABELS[t][n > 1 ? 1 : 0];
  }).join(', ');
}

/**
 * A6_EFFACER_ANCIENNE_DEMO : supprime l'ancienne démo (programme DEMO). Deux lancements : le premier dit seulement ce qui serait supprimé et ne touche à rien ;
 * le second, dans les dix minutes, supprime. Suppression « douce » comme partout dans l'outil : les lignes restent dans les feuilles, marquées supprimées
 * (on les rétablit en vidant la colonne « deleted »). Les personnes avec une adresse, les autres programmes et projets ne sont jamais touchés.
 */
function effacerAncienneDemo_() {
  var me = String(Session.getActiveUser().getEmail() || adminEmails()[0] || '').toLowerCase();
  if (adminEmails().indexOf(me) < 0) throw new PpmError('FORBIDDEN', 'Seul un administrateur peut supprimer l’ancienne démo.');
  var inv = oldDemoInventory_(), msg;
  if (!inv.total) {
    deleteProp(PROP.DEMO_CLEAN);
    msg = 'Aucune ancienne démo (programme ' + OLD_DEMO_PROGRAM + ') à supprimer.';
    console.log(msg);
    return msg;
  }
  var asked = Number(getProp(PROP.DEMO_CLEAN, '0')) || 0, now = Date.now();
  if (!asked || now - asked > OLD_DEMO_CONFIRM_MS) {
    setProp(PROP.DEMO_CLEAN, String(now));
    msg = 'Rien n’est supprimé pour l’instant. L’ancienne démo (programme ' + OLD_DEMO_PROGRAM + ') comprend : ' + oldDemoSummary_(inv) + '.' +
      (inv.kept.length ? ' Conservées car citées ailleurs : ' + inv.kept.join(', ') + '.' : '') +
      ' Pour confirmer la suppression, relancez A6_EFFACER_ANCIENNE_DEMO dans les 10 minutes.';
    console.log(msg);
    return msg;
  }
  var a = { actor: me, source: 'setup' };
  inv.order.forEach(function (t) { inv.del[t].forEach(function (r) { repoSoftDelete(t, r.id, null, a); }); });
  deleteProp(PROP.DEMO_CLEAN);
  msg = 'Ancienne démo supprimée : ' + oldDemoSummary_(inv) + '. Lancez maintenant A2_SEED_DEMO pour créer la nouvelle démo.';
  console.log(msg);
  return msg;
}
