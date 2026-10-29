/**
 * PPM Core — 0.15.0 : protection des feuilles sensibles du classeur « Données », déduite des rôles.
 *
 * Deux groupes de feuilles sont verrouillés en ÉDITION (la lecture reste ouverte à qui ouvre le classeur : voir la note en fin de fichier) :
 *   - « Rôles et personnes » (RoleAssignment, Role, Resource) : modifiables par les Program Leader, Domain Program Leader et administrateurs.
 *     Resource en fait partie : une personne est reconnue par l'adresse de sa fiche, la modifier reviendrait à prendre le rôle d'une autre.
 *   - « Budget et achats » (BudgetLine, BudgetPhasing, PurchaseOrder, PurchaseOrderLink, EtpCost, Exercise, TeamBudget, ActualImport) : en plus, les chefs de projet.
 *
 * Personne ne gère ces accès à la main : la liste de ceux qui peuvent modifier chaque groupe se DÉDUIT des rôles actifs (droits `sheet.roles` et `sheet.budget` de
 * la table PERMISSIONS, 00_Config.gs) et des administrateurs, et se recalcule seule quand un rôle ou une fiche change (hook de invalidateTable_), la nuit, et à la demande.
 * Les droits portent sur le rôle tenu n'importe où (PL ou DPL d'un programme, chef de projet d'un projet) : une protection de feuille ne peut pas être plus fine.
 *
 * Le propriétaire du script (qui exécute l'outil) peut toujours écrire : les écritures de l'outil ne sont donc jamais bloquées. Les feuilles de l'outil protégées sont repérées par
 * leur description (« PPM: »), les protections posées à la main ne sont jamais touchées. Les autres feuilles (planning, actualités…) restent en édition libre.
 */

var _protectDirty = false;

var SHEET_PROTECT_GROUPS = [
  { key: 'roles', label: 'Rôles et personnes', perm: 'sheet.roles', tables: ['RoleAssignment', 'Role', 'Resource'],
    why: 'qui a quel rôle, et à quelle adresse correspond chaque personne (donc qui est qui)' },
  { key: 'budget', label: 'Budget et achats', perm: 'sheet.budget', tables: ['BudgetLine', 'BudgetPhasing', 'PurchaseOrder', 'PurchaseOrderLink', 'EtpCost', 'Exercise', 'TeamBudget', 'ActualImport'],
    why: 'lignes de budget, étalement, commandes d’achat et grilles de taux' }
];

function sheetProtectOn_() { return getProp(PROP.SHEET_PROTECT, 'oui') !== 'non'; }

/** Prêt à agir : un classeur Données et le service Sheets (absents dans la plupart des essais). */
function sheetProtectReady_() { return typeof SpreadsheetApp !== 'undefined' && !!getProp(PROP.DATA_ID, ''); }

/** Les adresses qui peuvent modifier un groupe : administrateurs, et personnes ayant un rôle actif du droit du groupe, où que ce soit. */
function sheetProtectEditors_(group) {
  var roles = PERMISSIONS[group.perm] || [], today = todayStr(), byId = indexBy_(repoList('Resource')), out = {};
  adminEmails().forEach(function (e) { out[e] = true; });
  repoList('RoleAssignment').forEach(function (a) {
    if (roles.indexOf(a.role_code) < 0) return;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var r = byId[a.resource_id];
    if (r && !isBlank(r.email)) out[String(r.email).toLowerCase().trim()] = true;
  });
  return Object.keys(out).sort();
}

function sheetProtectDesc_(group) {
  var names = { PL: 'Program Leader', DPL: 'Domain Program Leader', CP: 'chef de projet' };
  return 'PPM:' + group.key + ' — modifiable par : administrateurs, ' + (PERMISSIONS[group.perm] || []).map(function (r) { return names[r] || r; }).join(', ') + ' (déduit des rôles ; ne pas modifier à la main)';
}

function sheetProtectSig_() {
  var o = { on: sheetProtectOn_(), g: {} };
  SHEET_PROTECT_GROUPS.forEach(function (g) { o.g[g.key] = sheetProtectEditors_(g); });
  return sha256Hex_(JSON.stringify(o)).slice(0, 24);
}

function sheetProtectOwn_(sh) {
  var list = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET), mine = null;
  list.forEach(function (p) { if (!mine && String(p.getDescription()).indexOf('PPM:') === 0) mine = p; });
  return mine;
}

/** Pose (ou ajuste) la protection d'une feuille pour qu'elle n'ait pour éditeurs que les adresses voulues et le propriétaire. */
function sheetProtectOne_(sh, group, want, owner) {
  var p = sheetProtectOwn_(sh), created = false;
  if (!p) { p = sh.protect(); created = true; }
  p.setDescription(sheetProtectDesc_(group));
  p.setWarningOnly(false);
  if (owner) { try { p.addEditor(owner); } catch (e) { /* déjà éditeur */ } } // le propriétaire d'abord : comme Google le recommande avant de retirer les autres
  var current = p.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
  var toAdd = want.filter(function (e) { return current.indexOf(e) < 0; });
  var toRemove = current.filter(function (e) { return want.indexOf(e) < 0 && e !== owner; });
  if (toAdd.length) p.addEditors(toAdd);
  if (toRemove.length) p.removeEditors(toRemove);
  if (p.canDomainEdit && p.canDomainEdit()) p.setDomainEdit(false); // sinon tout le domaine garderait la main
  return { created: created, added: toAdd.length, removed: toRemove.length };
}

/** Retire les protections posées par l'outil (jamais celles posées à la main). */
function sheetProtectRemoveOwn_(sh) {
  var n = 0;
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (String(p.getDescription()).indexOf('PPM:') === 0) { p.remove(); n++; } });
  return n;
}

/**
 * Applique (ou retire, si la protection est coupée) les protections de toutes les feuilles. Rend un compte rendu ; ne lève jamais d'erreur.
 * La signature des éditeurs n'est mémorisée que si tout a réussi : un échec est donc réessayé à la prochaine occasion.
 */
function sheetProtectApply_() {
  var out = { enabled: sheetProtectOn_(), ready: sheetProtectReady_(), groups: [], failed: [], skipped: [], created: 0, removedProtections: 0 };
  if (!out.ready) return out;
  var book = openBook_('data'), owner = sheetOwnerEmail_();
  SHEET_PROTECT_GROUPS.forEach(function (group) {
    var editors = sheetProtectEditors_(group), want = [];
    // un éditeur de protection doit pouvoir modifier le classeur : les autres sont notés « écartés » et l'application sera refaite quand ils y auront accès
    if (out.enabled) editors.forEach(function (e) { if (e === owner || sheetGrantSafe_(e).ok) want.push(e); else out.skipped.push(e); });
    if (out.enabled && owner && want.indexOf(owner) < 0) want.push(owner);
    var g = { key: group.key, label: group.label, tables: group.tables.slice(), editors: editors, protectedSheets: [] };
    group.tables.forEach(function (table) {
      try {
        var sh = book.getSheetByName(table);
        if (!sh) { out.failed.push({ table: table, reason: 'feuille absente' }); return; }
        if (!out.enabled) { out.removedProtections += sheetProtectRemoveOwn_(sh); return; }
        var r = sheetProtectOne_(sh, group, want, owner);
        if (r.created) out.created++;
        g.protectedSheets.push(table);
      } catch (e) {
        out.failed.push({ table: table, reason: String(e && e.message ? e.message : e).slice(0, 160) });
      }
    });
    out.groups.push(g);
  });
  // la signature n'est mémorisée que si TOUT est en place : aucun échec, et aucun éditeur voulu écarté faute d'accès au classeur (sinon, il ne serait jamais ajouté ensuite)
  if (!out.failed.length && !out.skipped.length) setProp(PROP.SHEET_PROTECT_SIG, sheetProtectSig_());
  else setProp(PROP.SHEET_PROTECT_SIG, ''); // à refaire à la prochaine occasion
  return out;
}

/** Un rôle ou une fiche a changé pendant cette requête : si la liste des éditeurs a changé, les protections sont mises à jour (quelques secondes). Jamais d'erreur. */
function sheetProtectIfDirty_() {
  if (!_protectDirty) return;
  _protectDirty = false;
  try {
    if (!sheetProtectReady_()) return;
    if (sheetProtectSig_() === getProp(PROP.SHEET_PROTECT_SIG, '')) return;
    sheetProtectApply_();
  } catch (e) {
    console.error('PPM protection du classeur : ' + (e && e.message ? e.message : e));
    try { setProp(PROP.SHEET_PROTECT_SIG, ''); } catch (e2) { /* rien de plus à faire */ }
  }
}

/** Ce que Mon compte montre : pour chaque groupe, si la personne peut modifier ses feuilles. */
function sheetLockedFor_(ctx) {
  if (!sheetProtectOn_()) return [];
  return SHEET_PROTECT_GROUPS.map(function (g) {
    var editors = sheetProtectEditors_(g);
    return { key: g.key, label: g.label, tables: g.tables.slice(), why: g.why, can_edit: !!ctx.email && editors.indexOf(ctx.email) >= 0,
      who: 'administrateurs, ' + (PERMISSIONS[g.perm] || []).map(function (r) { return ROLE_LABELS[r] || r; }).join(', ') };
  });
}

/** Ce qu'Administration montre : les groupes, leurs feuilles et ceux qui peuvent les modifier. */
function sheetProtectView_() {
  return SHEET_PROTECT_GROUPS.map(function (g) {
    return { key: g.key, label: g.label, tables: g.tables.slice(), why: g.why, editors: sheetProtectEditors_(g),
      roles: (PERMISSIONS[g.perm] || []).map(function (r) { return ROLE_LABELS[r] || r; }) };
  });
}

defineAction('admin.sheet.protect', function (p, ctx) {
  requireAdmin_(ctx);
  return sheetProtectApply_();
});

/*
 * LIMITE À CONNAÎTRE : une protection de feuille n'interdit que la MODIFICATION. Toute personne qui peut ouvrir le classeur peut encore LIRE ces feuilles : rôles, taux
 * journaliers (feuille Resource) et budgets. Pour les cacher, il faudrait ne pas partager ces données (classeur séparé, ou classeur de consultation généré sans elles).
 */
