/**
 * PPM Core — 0.16.0 : export et import de projets par classeur Google Sheet, un onglet par objet, pour UN ou PLUSIEURS projets (et leurs programmes).
 *
 * Quatre actions, réservées au chef de projet et au-dessus pour chaque projet touché (droit `import.run`) :
 *   import.template  crée dans Drive un classeur prérempli avec ce que l'outil contient (un projet, plusieurs, tout un programme, ou tout pour l'administrateur) : c'est l'export ;
 *   import.catalog   liste les programmes et projets, avec ce que l'appelant peut exporter ;
 *   import.analyze   lit un classeur et rend un RAPPORT sans rien écrire : ce qui sera créé, modifié, laissé tel quel, et chaque erreur avec son onglet et sa ligne ;
 *   import.run       applique le plan, par lots : un lancement s'arrête avant la limite de six minutes d'Apps Script et dit s'il reste à faire ; on le relance jusqu'à « terminé ».
 *
 * ONGLETS. Programmes · Projets · Personnes · Workpackages · Livrables · Jalons · Dépendances · Budget. Une ligne = un objet ; les cinq derniers commencent par le code du PROJET.
 * Un même classeur, importé dans une installation neuve, recrée les programmes, les projets, les personnes et tout leur découpage : c'est une sauvegarde qui se relit.
 *
 * CLÉS. Un programme et un projet : leur code. Un workpackage : son code WBS (« 1 », « 1.2 »). Un livrable ou un jalon : son workpackage et son nom. Une dépendance : les deux bouts.
 * Une ligne de budget : son livrable et sa ressource. Importer deux fois le même classeur ne change donc rien. L'import ne SUPPRIME jamais rien : ce qui est dans l'outil et pas dans
 * le classeur est seulement signalé, et une personne, un programme ou un projet qui existe déjà n'est jamais écrasé (seuls le nom, le statut et le pays des jours fériés d'un projet se mettent à jour).
 *
 * SÉCURITÉ. Tout est analysé avant d'écrire : une seule erreur, et rien n'est écrit, pour aucun projet. Avant le premier lot, une COPIE de sécurité des projets existants est enregistrée dans
 * Drive (même format) ; si elle échoue, l'import est annulé. Tout passe par les actions ordinaires (programs.create, projects.create, resources.create, wbs.create, wbs.update, roles.assign,
 * dependencies.create, budget.line.save, budget.envelope.set) : mêmes droits, mêmes règles, même journal ; les changements restent « à valider » par le niveau du dessus.
 *
 * RÔLES. La colonne « Leader » ou « Owner » pose le responsable principal (Workpackage leader, Sub-workpackage leader ou Deliverable owner selon l'objet) ; « Contributors » pose des
 * Contributors. Les personnes se désignent par leur adresse e-mail (à défaut, par leur nom exact) ; celles de l'onglet Personnes qui n'existent pas encore sont créées d'abord.
 */

var IMPORT_TABS = [
  { name: 'Programmes', cols: ['Code', 'Nom', 'Statut', 'Description'], text: [0], optional: true },
  { name: 'Projets', cols: ['Code', 'Nom', 'Programme (code)', 'Statut', 'Pays des jours fériés', 'Chef de projet (e-mail)', 'Budget autorisé (€)'], text: [0, 2] },
  { name: 'Personnes', cols: ['Nom', 'E-mail', 'Type (Interne ou Externe)', 'Fonction', 'Organisation', 'Pays', 'Fournisseur', 'Taux journalier (€)'], text: [], optional: true },
  { name: 'Workpackages', cols: ['Projet', 'Code WBS', 'Parent (code WBS)', 'Nom', 'Leader (e-mail)', 'Imputation', 'Enveloppe (€)'], text: [0, 1, 2, 5] },
  { name: 'Livrables', cols: ['Projet', 'Code WBS du workpackage', 'Nom', 'Début', 'Fin', 'Owner (e-mail)', 'Contributors (e-mails séparés par « ; »)'], text: [0, 1] },
  { name: 'Jalons', cols: ['Projet', 'Code WBS du workpackage', 'Nom', 'Date', 'Catégorie', 'Owner (e-mail)', 'Contributors (e-mails séparés par « ; »)'], text: [0, 1] },
  { name: 'Dépendances', cols: ['Projet', 'Prédécesseur (WP)', 'Prédécesseur (nom)', 'Successeur (WP)', 'Successeur (nom)', 'Type (FS, SS, FF ou SF)', 'Décalage (jours)'], text: [0, 1, 3], optional: true },
  { name: 'Budget', cols: ['Projet', 'Code WBS du workpackage', 'Livrable', 'Ressource (e-mail)', 'Type (TJM ou Forfait)', 'Jours', 'Montant forfait (€)'], text: [0, 1] }
];
var IMPORT_LIMITS = { projects: 50, people: 500, workpackages: 500, items: 3000, budget: 6000 };
var IMPORT_BUDGET_MS = 240000;   // un lancement d'import.run s'arrête de lui-même après quatre minutes
var IMPORT_DRIVE = null;         // essais : { share(fileId, email), moveToProjectFolder(fileId, project) } ; sinon Drive réel

// ---------------------------------------------------------------- lecture et analyse (pures : testées hors ligne)

function importText_(v) { return String(v === null || v === undefined ? '' : v).replace(/\u00a0/g, ' ').trim(); }

/** Montant en euros : accepte « 1 200,5 », 1200.5 ; '' reste vide ; renvoie NaN si illisible ou négatif. */
function importAmount_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : NaN;
  var s = importText_(v).replace(/[\s€]/g, '').replace(',', '.');
  if (s === '') return '';
  var n = Number(s);
  return isFinite(n) && n >= 0 && /^\d+(\.\d+)?$/.test(s) ? n : NaN;
}

/** Date lue : « 2026-10-05 », « 05/10/2026 » ou une vraie date de feuille (déjà rendue en texte par normalizeValue). '' si vide, null si illisible. */
function importDate_(v) {
  var s = importText_(v);
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) || null, y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

/** Les lignes d'un onglet en objets { _row, <colonne>: texte }, lignes vides ignorées ; les en-têtes doivent être ceux du modèle. */
function importRows_(values, tab, problems) {
  if (!values || !values.length) { problems.push({ tab: tab.name, row: 1, message: 'L’onglet est vide : gardez la ligne d’en-têtes du modèle.' }); return []; }
  var head = values[0].map(importText_), idx = [];
  tab.cols.forEach(function (c, i) {
    idx[i] = head.indexOf(c);
    if (idx[i] < 0) problems.push({ tab: tab.name, row: 1, message: 'Colonne « ' + c + ' » introuvable : gardez les en-têtes du modèle, tels quels.' });
  });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1, _raw: {} }, any = false;
    tab.cols.forEach(function (c, i) {
      var raw = idx[i] < 0 ? '' : values[r][idx[i]];
      o._raw[c] = raw;
      o[c] = importText_(raw);
      if (o[c] !== '') any = true;
    });
    if (any) out.push(o);
  }
  return out;
}

/**
 * Le plan d'import. parsed : { Projet, Workpackages, Livrables, Jalons, Budget } (lignes déjà lues) ; existing : { project, wps, items, lines, people (par e-mail), roles, today }.
 * Rend { errors, warnings, plan, counts } sans rien écrire. Une erreur bloque l'import ; un avertissement s'affiche seulement.
 */
function importAnalyze_(parsed, existing) {
  var errors = [], warnings = [];
  var err = function (tab, row, msg) { errors.push({ tab: tab, row: row, message: msg }); };
  var warn = function (tab, row, msg) { warnings.push({ tab: tab, row: row, message: msg }); };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  // une personne se désigne par son e-mail ; à défaut d'adresse sur sa fiche, par son nom exact (l'export écrit alors le nom)
  var person = function (tab, row, who, label, required) {
    var e = importText_(who).toLowerCase();
    if (!e) { if (required) err(tab, row, label + ' obligatoire.'); return null; }
    if (e.indexOf('@') >= 0) {
      var p = existing.people[e];
      if (!p) { err(tab, row, label + ' : « ' + e + ' » n’est pas dans Ressources. Créez la personne dans la page Ressources, puis relancez l’analyse.'); return null; }
      return p;
    }
    var named = (existing.peopleByName || {})[norm(e)] || [];
    if (named.length === 1) return named[0];
    if (named.length > 1) { err(tab, row, label + ' : plusieurs personnes s’appellent « ' + importText_(who) + ' » : désignez-la par son adresse e-mail.'); return null; }
    err(tab, row, label + ' : « ' + importText_(who) + ' » n’est ni une adresse e-mail ni le nom d’une personne de Ressources. Créez la personne dans la page Ressources, puis relancez l’analyse.');
    return null;
  };
  var plan = { project: null, wps: [], items: [], lines: [], contributors: [] };

  // ---- projet
  var pr = parsed.Projet || [];
  if (pr.length > 1) warn('Projet', pr[1]._row, 'Une seule ligne est lue : les suivantes sont ignorées.');
  if (pr.length) {
    var a = importAmount_(pr[0]._raw['Budget autorisé (€)']);
    if (a !== a) err('Projet', pr[0]._row, 'Budget autorisé : un montant en euros, positif ou nul.');
    else plan.project = { authorized: a };
  }

  // ---- workpackages
  var wpRows = parsed.Workpackages || [], seen = {};
  if (wpRows.length > IMPORT_LIMITS.workpackages) err('Workpackages', wpRows[IMPORT_LIMITS.workpackages]._row, 'Au plus ' + IMPORT_LIMITS.workpackages + ' workpackages par import.');
  var byCode = {}; existing.wps.forEach(function (w) { byCode[String(w.wbs_code)] = w; });
  wpRows.forEach(function (r) {
    var code = r['Code WBS'], parent = r['Parent (code WBS)'], row = r._row, bad = false;
    var rawCode = r._raw['Code WBS'];
    if (!/^\d+(\.\d+)?$/.test(code)) { err('Workpackages', row, 'Code WBS « ' + code + ' » : « 1 » ou « 1.2 » (deux niveaux au plus).'); bad = true; }
    else if (typeof rawCode === 'number' && code.indexOf('.') >= 0) warn('Workpackages', row, 'Le code « ' + code + ' » a été lu comme un nombre : si vous vouliez un code se terminant par un zéro (« 1.10 »), mettez la colonne au format « Texte brut » (le modèle le fait).');
    if (code && seen[code]) { err('Workpackages', row, 'Le code « ' + code + ' » est déjà à la ligne ' + seen[code] + '.'); bad = true; }
    seen[code] = row;
    if (!parent && code.indexOf('.') > 0) parent = code.slice(0, code.lastIndexOf('.'));
    if (parent) {
      if (!/^\d+$/.test(parent)) { err('Workpackages', row, 'Parent « ' + parent + ' » : un code de workpackage de premier niveau.'); bad = true; }
      else if (code && code.indexOf(parent + '.') !== 0) { err('Workpackages', row, 'Le code « ' + code + ' » doit commencer par celui de son parent (« ' + parent + '. »).'); bad = true; }
    } else if (/\./.test(code)) { bad = true; }
    if (!r['Nom']) { err('Workpackages', row, 'Nom obligatoire.'); bad = true; }
    var leader = person('Workpackages', row, r['Leader (e-mail)'], 'Leader', false);
    var env = importAmount_(r._raw['Enveloppe (€)']);
    if (env !== env) { err('Workpackages', row, 'Enveloppe : un montant en euros, positif ou nul (ou vide : pas de plafond).'); bad = true; }
    if (bad) return;
    var ex = byCode[code] || null;
    plan.wps.push({ code: code, parent: parent || '', name: r['Nom'], leader: leader, charge: r['Imputation'], envelope: env, row: row, existing: ex });
  });
  var planCodes = {}; plan.wps.forEach(function (w) { planCodes[w.code] = w; });
  plan.wps.forEach(function (w) {
    if (w.parent && !planCodes[w.parent] && !byCode[w.parent]) err('Workpackages', w.row, 'Parent « ' + w.parent + ' » : ce workpackage n’existe ni dans le classeur ni dans le projet.');
    if (w.parent && byCode[w.parent] && !isBlank(byCode[w.parent].parent_wp_id)) err('Workpackages', w.row, 'Parent « ' + w.parent + ' » est déjà un sous-workpackage : deux niveaux au plus.');
    if (w.parent && planCodes[w.parent] && planCodes[w.parent].parent) err('Workpackages', w.row, 'Parent « ' + w.parent + ' » est déjà un sous-workpackage : deux niveaux au plus.');
    if (w.existing) {
      var exParent = w.existing.parent_wp_id ? (existing.wps.filter(function (x) { return x.id === w.existing.parent_wp_id; })[0] || {}).wbs_code : '';
      if (String(exParent || '') !== w.parent) warn('Workpackages', w.row, 'Le workpackage « ' + w.code + ' » est rattaché à « ' + (exParent || 'la racine') + ' » dans l’outil : l’import ne le déplace pas.');
    }
  });
  var wpKnown = function (code) { return code === '' || !!planCodes[code] || !!byCode[code]; };

  // ---- livrables et jalons
  var itemKeys = {};
  var itemRows = function (tabName, kind) {
    var rows = parsed[tabName] || [];
    rows.forEach(function (r) {
      var row = r._row, wpCode = r['Code WBS du workpackage'], name = r['Nom'], bad = false;
      if (wpCode && !wpKnown(wpCode)) { err(tabName, row, 'Workpackage « ' + wpCode + ' » : introuvable (ni dans l’onglet Workpackages, ni dans le projet).'); bad = true; }
      if (!name) { err(tabName, row, 'Nom obligatoire.'); bad = true; }
      var key = kind + '|' + wpCode + '|' + norm(name);
      if (name && itemKeys[key]) { err(tabName, row, '« ' + name + ' » est déjà à la ligne ' + itemKeys[key] + ' pour ce workpackage.'); bad = true; }
      itemKeys[key] = row;
      var start = '', finish = '';
      if (kind === 'Livrable') {
        start = importDate_(r['Début']); finish = importDate_(r['Fin']);
        if (start === null) { err(tabName, row, 'Début : « ' + r['Début'] + ' » n’est pas une date (aaaa-mm-jj ou jj/mm/aaaa).'); bad = true; start = ''; }
        if (finish === null) { err(tabName, row, 'Fin : « ' + r['Fin'] + ' » n’est pas une date (aaaa-mm-jj ou jj/mm/aaaa).'); bad = true; finish = ''; }
        if (start && finish && finish < start) { err(tabName, row, 'La fin (' + finish + ') précède le début (' + start + ').'); bad = true; }
        if ((start && !finish) || (!start && finish)) { err(tabName, row, 'Début et fin vont ensemble : renseignez les deux, ou aucune des deux.'); bad = true; }
        if (!start && !finish) warn(tabName, row, '« ' + name + ' » n’a pas de dates : il n’apparaîtra pas dans le Planning.');
      } else {
        var d = importDate_(r['Date']);
        if (d === null) { err(tabName, row, 'Date : « ' + r['Date'] + ' » n’est pas une date (aaaa-mm-jj ou jj/mm/aaaa).'); bad = true; d = ''; }
        if (!d) { err(tabName, row, 'La date d’un jalon est obligatoire.'); bad = true; }
        start = d; finish = d;
        var cat = r['Catégorie'];
        if (cat && MILESTONE_CATEGORIES.indexOf(cat) < 0) { err(tabName, row, 'Catégorie « ' + cat + ' » : ' + MILESTONE_CATEGORIES.join(', ') + ' (ou vide).'); bad = true; }
      }
      var owner = person(tabName, row, r['Owner (e-mail)'], 'Owner', false);
      var contributors = [];
      importText_(r['Contributors (e-mails séparés par « ; »)']).split(/[;\n,]+/).forEach(function (e) {
        e = e.trim(); if (!e) return;
        var p = person(tabName, row, e, 'Contributor', false);
        if (p && contributors.indexOf(p) < 0) contributors.push(p);
      });
      if (owner && contributors.indexOf(owner) >= 0) { warn(tabName, row, owner.name + ' est Owner et Contributor : seul le rôle d’Owner est posé.'); contributors = contributors.filter(function (p) { return p !== owner; }); }
      if (bad) return;
      var ex = existing.items.filter(function (i) {
        var w = i.wp_id ? existing.wps.filter(function (x) { return x.id === i.wp_id; })[0] : null;
        return i.item_type === kind && (w ? String(w.wbs_code) : '') === wpCode && norm(i.name) === norm(name);
      })[0] || null;
      plan.items.push({ kind: kind, wp: wpCode, name: name, start: start, finish: finish, category: kind === 'Jalon' ? r['Catégorie'] : '', owner: owner, contributors: contributors, row: row, tab: tabName, existing: ex });
    });
  };
  itemRows('Livrables', 'Livrable'); itemRows('Jalons', 'Jalon');
  if (plan.items.length > IMPORT_LIMITS.items) err('Livrables', 1, 'Au plus ' + IMPORT_LIMITS.items + ' livrables et jalons par import.');

  // ---- budget
  var lineKeys = {}, rows = parsed.Budget || [];
  if (rows.length > IMPORT_LIMITS.budget) err('Budget', rows[IMPORT_LIMITS.budget]._row, 'Au plus ' + IMPORT_LIMITS.budget + ' lignes de budget par import.');
  rows.forEach(function (r) {
    var row = r._row, wpCode = r['Code WBS du workpackage'], name = r['Livrable'], bad = false;
    var item = plan.items.filter(function (i) { return i.kind === 'Livrable' && i.wp === wpCode && norm(i.name) === norm(name); })[0] || null;
    var inProject = existing.items.filter(function (i) {
      var w = i.wp_id ? existing.wps.filter(function (x) { return x.id === i.wp_id; })[0] : null;
      return i.item_type === 'Livrable' && (w ? String(w.wbs_code) : '') === wpCode && norm(i.name) === norm(name);
    })[0] || null;
    if (!item && !inProject) { err('Budget', row, 'Livrable « ' + name + ' » (workpackage « ' + wpCode + ' ») : introuvable dans l’onglet Livrables ni dans le projet. Un jalon n’a pas de budget.'); bad = true; }
    var res = person('Budget', row, r['Ressource (e-mail)'], 'Ressource', true);
    if (!res) bad = true;
    var type = norm(r['Type (TJM ou Forfait)']);
    var days = importAmount_(r._raw['Jours']), fixed = importAmount_(r._raw['Montant forfait (€)']);
    if (type !== 'tjm' && type !== 'forfait') { err('Budget', row, 'Type « ' + r['Type (TJM ou Forfait)'] + ' » : TJM ou Forfait.'); bad = true; }
    else if (type === 'tjm') {
      if (days !== days || days === '' || days <= 0) { err('Budget', row, 'Un budget TJM demande un nombre de jours positif.'); bad = true; }
      else if (res && existing.rateOf(res) === null) { err('Budget', row, 'Aucun taux journalier pour « ' + res.name + ' » : à renseigner dans Ressources avant d’importer un budget en jours.'); bad = true; }
    } else {
      if (res && res.resource_type !== 'Externe') { err('Budget', row, '« ' + res.name + ' » est interne : un forfait est réservé aux ressources externes ; budgétez-la en jours (TJM).'); bad = true; }
      else if (fixed !== fixed || fixed === '' || fixed <= 0) { err('Budget', row, 'Un forfait demande un montant en euros positif.'); bad = true; }
    }
    var key = wpCode + '|' + norm(name) + '|' + (res ? res.id : '');
    if (res && lineKeys[key]) { err('Budget', row, 'Cette ressource a déjà une ligne sur ce livrable (ligne ' + lineKeys[key] + ').'); bad = true; }
    lineKeys[key] = row;
    if (bad) return;
    var exLine = null;
    if (inProject) exLine = existing.lines.filter(function (l) { return l.deliverable_id === inProject.id && l.resource_id === res.id; })[0] || null;
    plan.lines.push({ wp: wpCode, item: name, resource: res, type: type === 'tjm' ? 'TJM' : 'Forfait', days: days, fixed: fixed, row: row, existing: exLine });
  });

  // ---- ce qui change, ce qui reste
  var counts = { wps: { create: 0, update: 0, same: 0 }, items: { create: 0, update: 0, same: 0 }, contributors: 0, lines: { create: 0, update: 0, same: 0 }, envelope: 0 };
  plan.wps.forEach(function (w) {
    var ex = w.existing;
    if (!ex) { w.action = 'create'; }
    else {
      var diff = norm(ex.name) !== norm(w.name) || (w.leader && ex.owner_resource_id !== w.leader.id) || (w.charge !== '' && String(ex.charge_code || '') !== w.charge);
      w.action = diff ? 'update' : 'same';
    }
    counts.wps[w.action]++;
    if (w.envelope !== '' && (!ex || Number(ex.budget_allocated) !== w.envelope || isBlank(ex.budget_allocated))) counts.envelope++;
  });
  plan.items.forEach(function (i) {
    var ex = i.existing;
    if (!ex) i.action = 'create';
    else {
      var diff = (i.start !== '' && String(ex.planned_start || '') !== i.start) || (i.finish !== '' && String(ex.planned_finish || '') !== i.finish) ||
        (i.owner && ex.owner_resource_id !== i.owner.id) || (i.kind === 'Jalon' && i.category !== '' && String(ex.milestone_category || '') !== i.category);
      i.action = diff ? 'update' : 'same';
    }
    counts.items[i.action]++;
    i.contributors.forEach(function (p) {
      var has = ex && existing.roles.some(function (a) { return a.resource_id === p.id && a.scope_type === 'planitem' && a.scope_id === ex.id && a.role_code === 'CONTRIB'; });
      if (!has) counts.contributors++;
    });
  });
  plan.lines.forEach(function (l) {
    var ex = l.existing;
    if (!ex) l.action = 'create';
    else {
      var same = l.type === 'TJM' ? ex.cost_type === 'TJM' && Number(ex.planned_days) === l.days : ex.cost_type === 'Forfait' && Number(ex.fixed_amount) === l.fixed;
      l.action = same ? 'same' : 'update';
    }
    counts.lines[l.action]++;
  });
  if (plan.project && plan.project.authorized !== '' && Number(existing.project.budget_authorized) !== plan.project.authorized) counts.envelope++;
  // pas dans le classeur
  var inSheetWps = {}; plan.wps.forEach(function (w) { inSheetWps[w.code] = true; });
  var onlyInTool = existing.wps.filter(function (w) { return parsed.Workpackages && parsed.Workpackages.length && !inSheetWps[String(w.wbs_code)]; }).length;
  if (onlyInTool) warnings.push({ tab: 'Workpackages', row: 0, message: onlyInTool + ' workpackage(s) du projet ne sont pas dans le classeur : ils sont laissés tels quels (l’import ne supprime jamais rien).' });
  return { errors: errors, warnings: warnings, plan: plan, counts: counts };
}

// ---------------------------------------------------------------- accès au classeur et à l'état des projets

function importBookId_(ref) {
  var s = String(ref || '').trim();
  var m = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) || /^fake-book-\d+$/.test(s)) return s;
  throw new PpmError('VALIDATION', 'Collez le lien du classeur Google Sheet (ou son identifiant).');
}

/** Lit tous les onglets du classeur. Les onglets Projets, Workpackages, Livrables, Jalons et Budget sont obligatoires ; Programmes, Personnes et Dépendances sont facultatifs. */
function importReadBook_(ref) {
  var id = importBookId_(ref), ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e2) { who = ''; }
    throw new PpmError('VALIDATION', 'Classeur illisible. Utilisez le classeur créé par l’outil, ou partagez le vôtre en lecture avec ' + (who || 'le compte qui exécute l’outil') + '.');
  }
  var parsed = {}, problems = [];
  IMPORT_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab.name);
    if (!sh) { if (!tab.optional) problems.push({ tab: tab.name, row: 0, message: 'Onglet « ' + tab.name + ' » introuvable : gardez les onglets du modèle.' }); parsed[tab.name] = []; return; }
    var data = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues().map(function (row) { return row.map(normalizeValue); });
    parsed[tab.name] = importRows_(data, tab, problems);
  });
  return { id: id, name: ss.getName(), parsed: parsed, problems: problems };
}

function importPeopleMaps_() {
  var people = {}, peopleByName = {};
  repoList('Resource').forEach(function (r) {
    if (!isBlank(r.email)) people[String(r.email).toLowerCase()] = r;
    else { var k = String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim(); (peopleByName[k] = peopleByName[k] || []).push(r); }
  });
  return { people: people, peopleByName: peopleByName };
}

function importExisting_(project) {
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var maps = importPeopleMaps_();
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id; }), itemIds = {};
  items.forEach(function (i) { itemIds[i.id] = true; });
  return {
    project: project, wps: wps, items: items, people: maps.people, peopleByName: maps.peopleByName, today: todayStr(),
    lines: repoList('BudgetLine', function (l) { return !!itemIds[l.deliverable_id]; }),
    deps: repoList('Dependency', function (d) { return !!itemIds[d.successor_id] || !!itemIds[d.predecessor_id]; }),
    roles: repoList('RoleAssignment', function (a) { return roleActive_(a, todayStr()); }),
    rateOf: function (res) { return importRateOf_(res); }
  };
}

/** L'état d'un projet qui n'existe pas encore : rien, mais les personnes sont celles de l'outil. */
function importExistingNew_(stub) {
  var maps = importPeopleMaps_();
  return { project: stub, wps: [], items: [], people: maps.people, peopleByName: maps.peopleByName, today: todayStr(), lines: [], deps: [], roles: [], rateOf: function (res) { return importRateOf_(res); } };
}

/** Taux journalier d'une personne : celui de sa fiche, ou celui que le classeur lui donne si elle n'existe pas encore (null sans taux). */
function importRateOf_(res) {
  if (res && res._new) return res.daily_rate === '' || res.daily_rate === null || res.daily_rate === undefined ? null : Number(res.daily_rate);
  return dailyRateOf_(res, todayStr());
}

/** La personne réelle (la fiche de l'outil) derrière une personne du classeur, y compris une personne que l'import vient de créer. */
function importPersonId_(r) {
  if (!r) return '';
  if (!r._new) return r.id;
  var found = !isBlank(r.email) ? findResourceByEmail(r.email) : repoList('Resource', function (x) { return isBlank(x.email) && String(x.name).toLowerCase().replace(/\s+/g, ' ').trim() === String(r.name).toLowerCase().replace(/\s+/g, ' ').trim(); })[0];
  return found ? found.id : '';
}

function importCan_(ctx, project) {
  return !!ctx.isAdmin || can(ctx, 'import.run', { type: 'project', id: project.id });
}

function importRequire_(ctx, projectId) {
  var project = mustGet('Project', projectId);
  requireCan(ctx, 'import.run', { type: 'project', id: projectId });
  return project;
}

// ---------------------------------------------------------------- dépendances

/** Les dépendances d'un projet : par workpackage et nom de chaque bout. Un cycle, un doublon ou un élément introuvable est une erreur ; une dépendance existante différente n'est pas modifiée. */
function importAnalyzeDeps_(rows, plan, existing) {
  var errors = [], warnings = [], out = [];
  var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var wpCodeOf = {}; existing.wps.forEach(function (w) { wpCodeOf[w.id] = String(w.wbs_code); });
  var byKey = {};
  existing.items.forEach(function (i) { var k = (i.wp_id ? wpCodeOf[i.wp_id] || '' : '') + '|' + norm(i.name); if (!byKey[k]) byKey[k] = { id: i.id, name: i.name }; });
  plan.items.forEach(function (i) { var k = i.wp + '|' + norm(i.name); if (!byKey[k]) byKey[k] = { id: 'new:' + k, name: i.name, planned: true }; });
  var edges = existing.deps.map(function (d) { return { from: d.predecessor_id, to: d.successor_id }; });
  var seen = {};
  (rows || []).forEach(function (r) {
    var row = r._row, bad = false;
    var pk = r['Prédécesseur (WP)'] + '|' + norm(r['Prédécesseur (nom)']), sk = r['Successeur (WP)'] + '|' + norm(r['Successeur (nom)']);
    var pred = byKey[pk], succ = byKey[sk];
    if (!r['Prédécesseur (nom)'] || !r['Successeur (nom)']) { errors.push({ tab: 'Dépendances', row: row, message: 'Les noms du prédécesseur et du successeur sont obligatoires.' }); return; }
    if (!pred) { errors.push({ tab: 'Dépendances', row: row, message: 'Prédécesseur « ' + r['Prédécesseur (nom)'] + ' » (workpackage « ' + r['Prédécesseur (WP)'] + ' ») : introuvable dans les livrables et jalons du projet.' }); bad = true; }
    if (!succ) { errors.push({ tab: 'Dépendances', row: row, message: 'Successeur « ' + r['Successeur (nom)'] + ' » (workpackage « ' + r['Successeur (WP)'] + ' ») : introuvable dans les livrables et jalons du projet.' }); bad = true; }
    var type = String(r['Type (FS, SS, FF ou SF)'] || 'FS').toUpperCase();
    if (['FS', 'SS', 'FF', 'SF'].indexOf(type) < 0) { errors.push({ tab: 'Dépendances', row: row, message: 'Type « ' + r['Type (FS, SS, FF ou SF)'] + ' » : FS, SS, FF ou SF.' }); bad = true; }
    var lag = 0;
    if (r['Décalage (jours)'] !== '') { try { lag = checkLag_(r['Décalage (jours)']); } catch (e) { errors.push({ tab: 'Dépendances', row: row, message: 'Décalage : ' + String(e && e.message ? e.message : 'un nombre entier de jours.') }); bad = true; } }
    if (bad) return;
    if (pred.id === succ.id) { errors.push({ tab: 'Dépendances', row: row, message: 'Un élément ne peut pas dépendre de lui-même.' }); return; }
    var key = pred.id + '>' + succ.id;
    if (seen[key]) { errors.push({ tab: 'Dépendances', row: row, message: 'Cette dépendance est déjà à la ligne ' + seen[key] + '.' }); return; }
    seen[key] = row;
    var exDep = existing.deps.filter(function (d) { return d.predecessor_id === pred.id && d.successor_id === succ.id; })[0] || null;
    if (exDep) {
      if (exDep.dep_type !== type || Number(exDep.lag_days || 0) !== lag) warnings.push({ tab: 'Dépendances', row: row, message: 'Cette dépendance existe déjà avec un autre type ou décalage : elle n’est pas modifiée (supprimez-la dans le Planning pour la recréer).' });
      out.push({ pred: { wp: r['Prédécesseur (WP)'], name: r['Prédécesseur (nom)'] }, succ: { wp: r['Successeur (WP)'], name: r['Successeur (nom)'] }, type: type, lag: lag, row: row, action: 'same' });
      return;
    }
    if (wouldCreateCycle(edges, { from: pred.id, to: succ.id })) { errors.push({ tab: 'Dépendances', row: row, message: 'Cette dépendance fermerait une boucle dans le planning.' }); return; }
    edges.push({ from: pred.id, to: succ.id });
    out.push({ pred: { wp: r['Prédécesseur (WP)'], name: r['Prédécesseur (nom)'] }, succ: { wp: r['Successeur (WP)'], name: r['Successeur (nom)'] }, type: type, lag: lag, row: row, action: 'create' });
  });
  return { errors: errors, warnings: warnings, deps: out };
}

// ---------------------------------------------------------------- analyse de tout le classeur (programmes, projets, personnes, puis chaque projet)

var PROGRAM_STATUSES = ['Actif', 'En pause', 'Clos'];
var PROJECT_STATUSES = ['Préparation', 'Actif', 'En pause', 'Clos'];

/**
 * Le plan d'import de tout le classeur, sans rien écrire. opts.projectId : mode « un projet » (page WBS) : le classeur ne doit contenir que ce projet, et rien n'est créé au niveau
 * des programmes ni des projets. Sans projectId : plusieurs projets, avec création des programmes, projets et personnes qui n'existent pas encore.
 */
function importAnalyzeAll_(book, ctx, opts) {
  opts = opts || {};
  var P = book.parsed, errors = book.problems.slice(), warnings = [];
  var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var err = function (tab, row, msg) { errors.push({ tab: tab, row: row, message: msg }); };
  var warn = function (tab, row, msg) { warnings.push({ tab: tab, row: row, message: msg }); };
  var single = opts.projectId ? mustGet('Project', opts.projectId) : null;
  var maps = importPeopleMaps_();
  var lookup = function (who) {
    var e = importText_(who).toLowerCase();
    if (e.indexOf('@') >= 0) return maps.people[e] || null;
    var named = maps.peopleByName[norm(e)] || [];
    return named.length === 1 ? named[0] : null;
  };
  var programsByCode = {}; repoList('Program').forEach(function (g) { programsByCode[String(g.code)] = g; });
  var projectsByCode = {}; repoList('Project').forEach(function (x) { projectsByCode[String(x.code)] = x; });
  var out = { programs: [], projects: [], people: [], errors: errors, warnings: warnings };

  // ---- limites
  var projectRows = P.Projets || [];
  if (projectRows.length > IMPORT_LIMITS.projects) err('Projets', projectRows[IMPORT_LIMITS.projects]._row, 'Au plus ' + IMPORT_LIMITS.projects + ' projets par import.');
  if ((P.Personnes || []).length > IMPORT_LIMITS.people) err('Personnes', 1, 'Au plus ' + IMPORT_LIMITS.people + ' personnes par import.');

  // ---- personnes : celles du classeur qui n'existent pas encore sont créées ; une personne existante n'est jamais modifiée
  var canCreatePeople = !!ctx.isAdmin || can(ctx, 'resource.edit', { type: 'global' }), seenPeople = {};
  (P.Personnes || []).forEach(function (r) {
    var row = r._row, name = r['Nom'], email = r['E-mail'].toLowerCase(), bad = false;
    if (!name) { err('Personnes', row, 'Nom obligatoire.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err('Personnes', row, 'Adresse e-mail illisible : « ' + email + ' ».'); bad = true; }
    var type = r['Type (Interne ou Externe)'] || 'Interne';
    if (['Interne', 'Externe'].indexOf(type) < 0) { err('Personnes', row, 'Type « ' + type + ' » : Interne ou Externe.'); bad = true; }
    if (r['Pays'] && COUNTRIES.indexOf(r['Pays']) < 0) { err('Personnes', row, 'Pays « ' + r['Pays'] + ' » : ' + COUNTRIES.join(', ') + ' (ou vide).'); bad = true; }
    var rate = importAmount_(r._raw['Taux journalier (€)']);
    if (rate !== rate) { err('Personnes', row, 'Taux journalier : un montant en euros, positif ou nul.'); bad = true; }
    var key = email || 'nom:' + norm(name);
    if (seenPeople[key]) { err('Personnes', row, 'Cette personne est déjà à la ligne ' + seenPeople[key] + '.'); bad = true; }
    seenPeople[key] = row;
    if (bad) return;
    var existing = email ? maps.people[email] : ((maps.peopleByName[norm(name)] || []).length === 1 ? maps.peopleByName[norm(name)][0] : null);
    if (existing) { out.people.push({ name: name, email: email, action: 'same', row: row }); return; }
    if (!email && (maps.peopleByName[norm(name)] || []).length > 1) { err('Personnes', row, 'Plusieurs personnes s’appellent « ' + name + ' » : donnez une adresse e-mail.'); return; }
    if (!canCreatePeople) { err('Personnes', row, 'Créer une personne est réservé au chef de projet et aux niveaux au-dessus (page Ressources).'); return; }
    if (rate !== '' && !(ctx.isAdmin || canSetRates_(ctx))) { warn('Personnes', row, 'Le taux journalier de « ' + name + ' » est ignoré : le fixer est réservé au chef de projet et aux niveaux au-dessus.'); rate = ''; }
    var virtual = { id: 'new:' + key, _new: true, name: name, email: email, resource_type: type, country: r['Pays'], job_function: r['Fonction'], organization: r['Organisation'], supplier: r['Fournisseur'], daily_rate: rate };
    if (email) maps.people[email] = virtual; else (maps.peopleByName[norm(name)] = maps.peopleByName[norm(name)] || []).push(virtual);
    out.people.push({ name: name, email: email, action: 'create', row: row, person: virtual });
  });

  // ---- programmes
  var seenPrograms = {}, canCreateProgram = !!ctx.isAdmin || can(ctx, 'program.create', { type: 'global' });
  (P.Programmes || []).forEach(function (r) {
    var row = r._row, code = r['Code'], bad = false;
    if (!code) { err('Programmes', row, 'Code obligatoire.'); return; }
    if (!r['Nom']) { err('Programmes', row, 'Nom obligatoire.'); bad = true; }
    var status = r['Statut'] || 'Actif';
    if (PROGRAM_STATUSES.indexOf(status) < 0) { err('Programmes', row, 'Statut « ' + status + ' » : ' + PROGRAM_STATUSES.join(', ') + '.'); bad = true; }
    if (seenPrograms[code]) { err('Programmes', row, 'Le code « ' + code + ' » est déjà à la ligne ' + seenPrograms[code] + '.'); bad = true; }
    seenPrograms[code] = row;
    if (bad) return;
    var ex = programsByCode[code] || null;
    if (ex) {
      if (norm(ex.name) !== norm(r['Nom'])) warn('Programmes', row, 'Le programme « ' + code + ' » s’appelle « ' + ex.name + ' » dans l’outil : il n’est pas renommé.');
      out.programs.push({ code: code, name: r['Nom'], action: 'same', row: row });
      return;
    }
    if (single) { err('Programmes', row, 'Le programme « ' + code + ' » n’existe pas : pour créer un programme, utilisez l’import de la page Administration.'); return; }
    if (!canCreateProgram) { err('Programmes', row, 'Créer un programme est réservé à l’administrateur (ou au Program Leader).'); return; }
    out.programs.push({ code: code, name: r['Nom'], status: status, description: r['Description'], action: 'create', row: row });
  });
  var plannedPrograms = {}; out.programs.forEach(function (g) { plannedPrograms[g.code] = true; });

  // ---- projets
  var seenProjects = {}, bookProjects = [];
  projectRows.forEach(function (r) {
    var row = r._row, code = r['Code'], bad = false;
    if (!code) { err('Projets', row, 'Code obligatoire.'); return; }
    if (!r['Nom']) { err('Projets', row, 'Nom obligatoire.'); bad = true; }
    if (seenProjects[code]) { err('Projets', row, 'Le code « ' + code + ' » est déjà à la ligne ' + seenProjects[code] + '.'); bad = true; }
    seenProjects[code] = row;
    var status = r['Statut'] || 'Préparation';
    if (PROJECT_STATUSES.indexOf(status) < 0) { err('Projets', row, 'Statut « ' + status + ' » : ' + PROJECT_STATUSES.join(', ') + '.'); bad = true; }
    var holiday = r['Pays des jours fériés'] || 'FR';
    if (COUNTRIES.indexOf(holiday) < 0) { err('Projets', row, 'Pays des jours fériés « ' + holiday + ' » : ' + COUNTRIES.join(', ') + '.'); bad = true; }
    var programCode = r['Programme (code)'];
    if (programCode && !programsByCode[programCode] && !plannedPrograms[programCode]) { err('Projets', row, 'Programme « ' + programCode + ' » : introuvable (ni dans l’outil, ni dans l’onglet Programmes).'); bad = true; }
    var manager = null;
    if (r['Chef de projet (e-mail)']) {
      manager = lookup(r['Chef de projet (e-mail)']);
      if (!manager) { err('Projets', row, 'Chef de projet : « ' + r['Chef de projet (e-mail)'] + ' » n’est pas dans Ressources ni dans l’onglet Personnes.'); bad = true; }
    }
    var budget = importAmount_(r._raw['Budget autorisé (€)']);
    if (budget !== budget) { err('Projets', row, 'Budget autorisé : un montant en euros, positif ou nul.'); bad = true; }
    if (single && code !== single.code) { err('Projets', row, 'Ce classeur contient le projet « ' + code + ' », pas « ' + single.code + ' » : importez-le depuis la page Administration, ou retirez les autres projets.'); bad = true; }
    if (bad) return;
    var ex = projectsByCode[code] || null, action;
    if (ex) {
      if (!importCan_(ctx, ex)) { err('Projets', row, 'Vous ne pouvez pas importer dans le projet « ' + code + ' » : il faut être chef de projet ou au-dessus.'); return; }
      action = norm(ex.name) !== norm(r['Nom']) || ex.status !== status || String(ex.holiday_country || 'FR') !== holiday ? 'update' : 'same';
      if (programCode && String(ex.program_id || '') !== String((programsByCode[programCode] || {}).id || '')) warn('Projets', row, 'Le projet « ' + code + ' » est dans un autre programme dans l’outil : il n’est pas déplacé.');
      if (manager && importPersonId_(manager) !== ex.manager_resource_id && !manager._new) warn('Projets', row, 'Le chef de projet de « ' + code + ' » est différent dans l’outil : il n’est pas changé (se change dans la page WBS, section Rôles).');
    } else {
      var scope = programCode && programsByCode[programCode] ? { type: 'program', id: programsByCode[programCode].id } : { type: 'global' };
      if (!ctx.isAdmin && !can(ctx, 'project.create', scope)) { err('Projets', row, 'Créer le projet « ' + code + ' » est réservé au DPL du programme (ou au-dessus).'); return; }
      action = 'create';
    }
    bookProjects.push({ code: code, name: r['Nom'], programCode: programCode, status: status, holiday: holiday, manager: manager, authorized: budget, row: row, existing: ex, action: action, raw: r });
  });
  if (!projectRows.length && !book.problems.length) err('Projets', 1, 'Aucun projet dans l’onglet Projets.');
  if (single && !bookProjects.some(function (x) { return x.code === single.code; }) && projectRows.length) err('Projets', 1, 'Le projet « ' + single.code + ' » n’est pas dans l’onglet Projets.');
  var known = {}; projectRows.forEach(function (r) { known[r['Code']] = true; });
  ['Workpackages', 'Livrables', 'Jalons', 'Dépendances', 'Budget'].forEach(function (tab) {
    (P[tab] || []).forEach(function (r) {
      if (!r['Projet']) err(tab, r._row, 'Projet obligatoire : indiquez le code du projet.');
      else if (!known[r['Projet']]) err(tab, r._row, 'Projet « ' + r['Projet'] + ' » : absent de l’onglet Projets.');
    });
  });

  // ---- chaque projet : l'analyse d'un seul projet (inchangée), plus ses dépendances
  var multi = bookProjects.length > 1;
  var totals = { programs: { create: 0, same: 0 }, projects: { create: 0, update: 0, same: 0 }, people: { create: 0, same: 0 }, wps: { create: 0, update: 0, same: 0 }, items: { create: 0, update: 0, same: 0 },
    contributors: 0, lines: { create: 0, update: 0, same: 0 }, envelope: 0, deps: { create: 0, same: 0 } };
  out.programs.forEach(function (g) { totals.programs[g.action]++; });
  out.people.forEach(function (x) { totals.people[x.action]++; });
  bookProjects.forEach(function (bp) {
    totals.projects[bp.action]++;
    var rowsOf = function (tab) { return (P[tab] || []).filter(function (r) { return r['Projet'] === bp.code; }); };
    var old = {
      Projet: [{ _row: bp.row, _raw: { 'Budget autorisé (€)': bp.raw._raw['Budget autorisé (€)'] }, 'Budget autorisé (€)': bp.raw['Budget autorisé (€)'] }],
      Workpackages: rowsOf('Workpackages'), Livrables: rowsOf('Livrables'), Jalons: rowsOf('Jalons'), Budget: rowsOf('Budget')
    };
    var stub = bp.existing || { id: 'new:' + bp.code, code: bp.code, name: bp.name, budget_authorized: '', holiday_country: bp.holiday };
    var existing = bp.existing ? importExisting_(bp.existing) : importExistingNew_(stub);
    existing.people = maps.people; existing.peopleByName = maps.peopleByName;
    var res = importAnalyze_(old, existing);
    var deps = importAnalyzeDeps_(rowsOf('Dépendances'), res.plan, existing);
    var tag = function (e) { return { tab: multi ? e.tab + ' · ' + bp.code : e.tab, row: e.row, message: e.message, project: bp.code }; };
    res.errors.concat(deps.errors).forEach(function (e) { errors.push(tag(e)); });
    res.warnings.concat(deps.warnings).forEach(function (e) { warnings.push(tag(e)); });
    bp.plan = res.plan; bp.counts = res.counts; bp.deps = deps.deps;
    bp.counts.deps = { create: 0, same: 0 }; deps.deps.forEach(function (d) { bp.counts.deps[d.action]++; });
    ['wps', 'items', 'lines'].forEach(function (k) { ['create', 'update', 'same'].forEach(function (a) { totals[k][a] += bp.counts[k][a]; }); });
    totals.contributors += bp.counts.contributors; totals.envelope += bp.counts.envelope;
    totals.deps.create += bp.counts.deps.create; totals.deps.same += bp.counts.deps.same;
    out.projects.push(bp);
  });
  out.counts = totals; out.multi = multi;
  return out;
}

/** Le nombre d'opérations qui restent à faire (zéro : le classeur et l'outil sont d'accord). */
function importRemaining_(c) {
  return c.programs.create + c.projects.create + c.projects.update + c.people.create + c.wps.create + c.wps.update + c.items.create + c.items.update + c.contributors + c.lines.create + c.lines.update + c.envelope + c.deps.create;
}

function importReport_(book, all, single) {
  var c = all.counts;
  var errors = all.errors;
  return {
    project: single ? { id: single.id, code: single.code, name: single.name } : null, book: { id: book.id, name: book.name },
    ok: errors.length === 0, errors: errors.slice(0, 200), errors_count: errors.length, warnings: all.warnings.slice(0, 200), warnings_count: all.warnings.length,
    counts: c, nothing_to_do: errors.length === 0 && importRemaining_(c) === 0,
    projects: all.projects.map(function (p) { return { code: p.code, name: p.name, action: p.action, counts: p.counts }; }),
    programs: all.programs.map(function (g) { return { code: g.code, name: g.name, action: g.action }; }),
    people: all.people.map(function (x) { return { name: x.name, email: x.email, action: x.action }; })
  };
}

// ---------------------------------------------------------------- l'export : le classeur et ses lignes

var IMPORT_README = [
  ['Export et import de projets par classeur — mode d’emploi'],
  [''],
  ['Un onglet par objet : Programmes, Projets, Personnes, Workpackages, Livrables, Jalons, Dépendances, Budget. Une ligne = un objet. Ne changez ni les noms d’onglets ni les en-têtes de colonnes.'],
  ['Ce classeur est prérempli avec ce que l’outil contient : modifiez, ajoutez des lignes, puis revenez dans l’outil pour « Analyser », puis « Importer ». C’est aussi une sauvegarde : le même classeur, importé dans une installation neuve, recrée les projets.'],
  ['Chaque ligne des onglets Workpackages, Livrables, Jalons, Dépendances et Budget commence par le CODE DU PROJET (colonne « Projet »), qui doit figurer dans l’onglet Projets.'],
  [''],
  ['Programmes : le code est la clé. Projets : le code est la clé ; « Programme (code) » rattache le projet à un programme (de l’outil ou de l’onglet Programmes) ; le statut vaut Préparation, Actif, En pause ou Clos.'],
  ['Personnes : celles qui n’existent pas encore dans l’outil sont créées (adresse e-mail ou nom exact comme clé) ; une personne qui existe déjà n’est jamais modifiée. Le taux journalier n’est exporté, et pris en compte à l’import, que pour le chef de projet et les niveaux au-dessus.'],
  ['Workpackages : le code WBS (« 1 », « 1.2 ») est la clé ; le leader devient Workpackage leader (ou Sub-workpackage leader pour un sous-workpackage) ; l’enveloppe est facultative (vide : pas de plafond).'],
  ['Livrables et jalons : on les retrouve par leur workpackage et leur nom (changer un nom crée un nouvel objet). L’owner devient Deliverable owner ; les contributors se séparent par « ; ». Dates : aaaa-mm-jj ou jj/mm/aaaa.'],
  ['Dépendances : par workpackage et nom de chaque bout ; type FS, SS, FF ou SF ; décalage en jours. Une dépendance qui ferme une boucle est refusée.'],
  ['Budget : une ligne par livrable et par ressource. TJM = jours × taux de la fiche de la personne (le taux doit exister) ; Forfait = montant en euros, ressources externes seulement.'],
  [''],
  ['L’import ne supprime jamais rien : ce qui est dans l’outil et pas dans ce classeur reste en place. Importer deux fois le même classeur ne change rien. Avant d’écrire, l’outil enregistre une copie de sécurité des projets concernés.'],
  ['Ne sont pas dans le classeur : les baselines (historique figé), les risques, les réunions, les achats, le journal des modifications, les rôles autres que leader, owner et contributors.'],
  ['Les changements importés restent « à valider » par le niveau du dessus (page Suivi), comme s’ils avaient été saisis à la main.']
];

/** Les lignes de chaque onglet pour ces projets (déjà filtrés sur les droits de l'appelant). */
function importWorkbookRows_(ctx, projects) {
  var maps = importPeopleMaps_(), resById = indexBy_(repoList('Resource')), programsById = indexBy_(repoList('Program'));
  var seeRates = !!ctx.isAdmin || canSetRates_(ctx);
  var email = function (id) { var r = resById[id]; return r ? (r.email || r.name || '') : ''; };   // à défaut d'adresse sur la fiche, le nom (l'import le comprend)
  var out = { 'Programmes': [], 'Projets': [], 'Personnes': [], 'Workpackages': [], 'Livrables': [], 'Jalons': [], 'Dépendances': [], 'Budget': [] };
  var usedPeople = {}, usedPrograms = {}, use = function (id) { if (id && resById[id]) usedPeople[id] = true; return email(id); };
  var order = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  projects.forEach(function (project) {
    var ex = importExisting_(project), byId = indexBy_(ex.wps), itemById = indexBy_(ex.items);
    var wpCode = function (id) { return id && byId[id] ? String(byId[id].wbs_code) : ''; };
    var program = project.program_id ? programsById[project.program_id] : null;
    if (program) usedPrograms[program.id] = true;
    out.Projets.push([project.code, project.name, program ? program.code : '', project.status || '', project.holiday_country || '', use(project.manager_resource_id), isBlank(project.budget_authorized) ? '' : Number(project.budget_authorized)]);
    ex.wps.slice().sort(order).forEach(function (w) {
      out.Workpackages.push([project.code, String(w.wbs_code), wpCode(w.parent_wp_id), w.name, use(w.owner_resource_id), w.charge_code || '', isBlank(w.budget_allocated) ? '' : Number(w.budget_allocated)]);
    });
    var contrib = {};
    ex.roles.forEach(function (a) { if (a.scope_type === 'planitem' && a.role_code === 'CONTRIB') (contrib[a.scope_id] = contrib[a.scope_id] || []).push(use(a.resource_id)); });
    var itemOrder = function (a, b) { return wpCode(a.wp_id).localeCompare(wpCode(b.wp_id), 'fr', { numeric: true }) || String(a.planned_start || '').localeCompare(String(b.planned_start || '')) || String(a.name).localeCompare(String(b.name), 'fr'); };
    ex.items.slice().sort(itemOrder).forEach(function (i) {
      if (i.item_type === 'Livrable') out.Livrables.push([project.code, wpCode(i.wp_id), i.name, i.planned_start || '', i.planned_finish || '', use(i.owner_resource_id), (contrib[i.id] || []).filter(Boolean).join('; ')]);
      else out.Jalons.push([project.code, wpCode(i.wp_id), i.name, i.planned_finish || i.planned_start || '', i.milestone_category || '', use(i.owner_resource_id), (contrib[i.id] || []).filter(Boolean).join('; ')]);
    });
    ex.deps.forEach(function (d) {
      var pr = itemById[d.predecessor_id], su = itemById[d.successor_id];
      if (!pr || !su) return;
      out['Dépendances'].push([project.code, wpCode(pr.wp_id), pr.name, wpCode(su.wp_id), su.name, d.dep_type || 'FS', Number(d.lag_days || 0)]);
    });
    ex.lines.forEach(function (l) {
      var it = itemById[l.deliverable_id]; if (!it) return;
      out.Budget.push([project.code, wpCode(it.wp_id), it.name, use(l.resource_id), l.cost_type === 'Forfait' ? 'Forfait' : 'TJM', l.cost_type === 'TJM' && !isBlank(l.planned_days) ? Number(l.planned_days) : '', l.cost_type === 'Forfait' && !isBlank(l.fixed_amount) ? Number(l.fixed_amount) : '']);
    });
  });
  Object.keys(usedPrograms).forEach(function (id) { var g = programsById[id]; out.Programmes.push([g.code, g.name, g.status || 'Actif', g.description || '']); });
  Object.keys(usedPeople).map(function (id) { return resById[id]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }).forEach(function (r) {
    out.Personnes.push([r.name, r.email || '', r.resource_type || 'Interne', r.job_function || '', r.organization || '', r.country || '', r.supplier || '', seeRates && !isBlank(r.daily_rate) ? Number(r.daily_rate) : '']);
  });
  void maps;
  return out;
}

/** Crée le classeur dans Drive, l'écrit et le partage ; rend { id, url, name, warnings, prefilled }. Une erreur de création se propage ; un échec de partage n'est qu'un avertissement. */
function importBuildWorkbook_(ctx, projects, title, folderProject) {
  var rows = importWorkbookRows_(ctx, projects);
  var ss = SpreadsheetApp.create(title);
  var readme = ss.insertSheet('Lisez-moi');
  readme.getRange(1, 1, IMPORT_README.length, 1).setValues(IMPORT_README);
  readme.getRange(1, 1).setFontWeight('bold');
  IMPORT_TABS.forEach(function (tab) {
    var sh = ss.insertSheet(tab.name), data = rows[tab.name] || [];
    sh.getRange(1, 1, 1, tab.cols.length).setValues([tab.cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // les codes en texte brut : sinon « 1.10 » deviendrait le nombre 1,1 ; les lignes préremplies sont écrites avec l'apostrophe des colonnes de texte
    tab.text.forEach(function (c) { sh.getRange(2, c + 1, Math.max(data.length, 1) + 500, 1).setNumberFormat('@'); });
    if (data.length) sh.getRange(2, 1, data.length, tab.cols.length).setValues(data.map(function (row) { return row.map(function (v, c) { return tab.text.indexOf(c) >= 0 && v !== '' ? String(v) : v; }); }));
  });
  ['Feuille 1', 'Sheet1'].forEach(function (n) { var d = ss.getSheetByName(n); if (d && ss.getSheets().length > 1) { try { ss.deleteSheet(d); } catch (e) { /* laissée */ } } });
  var warnings = [], email = String(ctx.email || '').toLowerCase();
  try {
    if (IMPORT_DRIVE) { IMPORT_DRIVE.share(ss.getId(), email); if (IMPORT_DRIVE.moveToProjectFolder && folderProject) IMPORT_DRIVE.moveToProjectFolder(ss.getId(), folderProject); }
    else {
      var f = DriveApp.getFileById(ss.getId());
      if (email) f.addEditor(email);
      if (folderProject && !isBlank(folderProject.drive_folder_id)) { try { DriveApp.getFolderById(folderProject.drive_folder_id).addFile(f); DriveApp.getRootFolder().removeFile(f); } catch (e) { warnings.push('Le classeur est resté à la racine du Drive du compte qui exécute l’outil (dossier du projet inaccessible).'); } }
    }
  } catch (e) { warnings.push('Le classeur est créé mais n’a pas pu être partagé avec ' + email + ' : ' + String(e && e.message ? e.message : e).slice(0, 160) + ' Demandez le partage à l’administrateur.'); }
  return { id: ss.getId(), url: ss.getUrl(), name: ss.getName(), warnings: warnings, prefilled: { programmes: rows.Programmes.length, projets: rows.Projets.length, personnes: rows.Personnes.length, workpackages: rows.Workpackages.length, livrables: rows.Livrables.length, jalons: rows.Jalons.length, dependances: rows['Dépendances'].length, budget: rows.Budget.length } };
}

/**
 * Les projets à exporter : projectId, projectIds, programId (tous les projets du programme) ou all (administrateur). Chacun doit être exportable par l'appelant (chef de projet ou au-dessus) ;
 * les autres sont listés avec leur raison, sans bloquer l'export des premiers.
 */
function importSelectProjects_(p, ctx) {
  var wanted = [];
  if (!isBlank(p.projectId)) wanted = [mustGet('Project', p.projectId)];
  else if (Array.isArray(p.projectIds) && p.projectIds.length) wanted = p.projectIds.map(function (id) { return mustGet('Project', id); });
  else if (!isBlank(p.programId)) wanted = repoList('Project', function (x) { return x.program_id === p.programId; });
  else if (p.all) wanted = repoList('Project');
  else throw new PpmError('VALIDATION', 'Choisissez au moins un projet à exporter.');
  var ok = [], skipped = [];
  wanted.forEach(function (x) { if (importCan_(ctx, x)) ok.push(x); else skipped.push({ code: x.code, name: x.name, reason: 'Il faut être chef de projet ou au-dessus pour exporter ce projet.' }); });
  if (!ok.length) throw new PpmError('FORBIDDEN', 'Exporter un projet est réservé à son chef de projet et aux niveaux au-dessus.');
  if (ok.length > IMPORT_LIMITS.projects) throw new PpmError('VALIDATION', 'Au plus ' + IMPORT_LIMITS.projects + ' projets par export.');
  return { projects: ok, skipped: skipped };
}

defineAction('import.template', function (p, ctx) {
  var sel = importSelectProjects_(p, ctx);
  var title = 'PPM — ' + (sel.projects.length === 1 ? 'Export du projet ' + sel.projects[0].code : 'Export de ' + sel.projects.length + ' projets') + ' — ' + todayStr();
  var wb = importBuildWorkbook_(ctx, sel.projects, title, sel.projects.length === 1 ? sel.projects[0] : null);
  wb.skipped = sel.skipped;
  return wb;
});

/** Les programmes et projets de l'outil, avec ce que l'appelant peut exporter : pour choisir quoi exporter, et savoir ce qu'il peut créer. */
defineAction('import.catalog', function (p, ctx) {
  var programs = repoList('Program'), projects = repoList('Project');
  var view = function (x) { return { id: x.id, code: x.code, name: x.name, status: x.status || '', canExport: importCan_(ctx, x) }; };
  var byProgram = {}; projects.forEach(function (x) { (byProgram[x.program_id || ''] = byProgram[x.program_id || ''] || []).push(view(x)); });
  var order = function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); };
  return {
    programs: programs.sort(order).map(function (g) { return { id: g.id, code: g.code, name: g.name, projects: (byProgram[g.id] || []).sort(order) }; }),
    withoutProgram: (byProgram[''] || []).sort(order),
    canCreateProgram: !!ctx.isAdmin || can(ctx, 'program.create', { type: 'global' }), canCreatePeople: !!ctx.isAdmin || can(ctx, 'resource.edit', { type: 'global' })
  };
});

// ---------------------------------------------------------------- analyse

defineAction('import.analyze', function (p, ctx) {
  var single = !isBlank(p.projectId) ? importRequire_(ctx, p.projectId) : null;
  var book = importReadBook_(requireParam(p, 'book'));
  var all = importAnalyzeAll_(book, ctx, { projectId: single ? single.id : '' });
  return importReport_(book, all, single);
});

// ---------------------------------------------------------------- copie de sécurité

/** Avant le premier lot d'un import : un classeur de sauvegarde des projets qui existent déjà et que le classeur va toucher. Sans lui, pas d'import. */
function importBackup_(ctx, all) {
  var existing = all.projects.filter(function (x) { return !!x.existing; }).map(function (x) { return x.existing; });
  if (!existing.length) return null;
  try {
    var wb = importBuildWorkbook_(ctx, existing, 'PPM — Copie avant import — ' + todayStr() + ' ' + String(nowIso()).slice(11, 16), existing.length === 1 ? existing[0] : null);
    return { id: wb.id, url: wb.url, name: wb.name, projects: existing.length };
  } catch (e) {
    throw new PpmError('VALIDATION', 'La copie de sécurité n’a pas pu être créée (' + String(e && e.message ? e.message : e).slice(0, 140) + ') : l’import est annulé, rien n’a été écrit.', { rule: 'IMPORT_BACKUP' });
  }
}

// ---------------------------------------------------------------- application, par lots

/** Applique le plan d'UN projet existant (ou que l'import vient de créer). io : { step, run, applied, pid }. */
function importApplyProject_(ctx, project, bp, io) {
  var plan = bp.plan, step = io.step, run = io.run, applied = io.applied, pid = io.pid;
  var wpId = function (code) {
    if (!code) return '';
    var w = repoList('WorkPackage', function (x) { return x.project_id === project.id && String(x.wbs_code) === code; })[0];
    return w ? w.id : '';
  };
  var nm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  // 1. workpackages : premier niveau, puis sous-niveaux
  [false, true].forEach(function (subLevel) {
    plan.wps.filter(function (w) { return !!w.parent === subLevel; }).forEach(function (w) {
      step(function () {
        var cur = repoList('WorkPackage', function (x) { return x.project_id === project.id && String(x.wbs_code) === w.code; })[0];
        if (!cur) {
          run('wbs.create', { projectId: project.id, kind: 'wp', parentId: wpId(w.parent), values: { name: w.name, wbs_code: w.code, owner_resource_id: pid(w.leader), charge_code: w.charge } });
          applied.wps++;
        } else {
          var patch = {};
          if (nm(cur.name) !== nm(w.name)) patch.name = w.name;
          if (w.leader && cur.owner_resource_id !== pid(w.leader)) patch.owner_resource_id = pid(w.leader);
          if (w.charge !== '' && String(cur.charge_code || '') !== w.charge) patch.charge_code = w.charge;
          if (Object.keys(patch).length) { run('wbs.update', { kind: 'wp', id: cur.id, version: cur.version, patch: patch }); applied.wps++; }
        }
      });
    });
  });
  // 2. livrables et jalons, puis leurs contributors
  var itemOf = function (i) {
    var wid = wpId(i.wp);
    return repoList('PlanItem', function (x) { return x.project_id === project.id && x.item_type === i.kind && (x.wp_id || '') === wid && nm(x.name) === nm(i.name); })[0] || null;
  };
  plan.items.forEach(function (i) {
    step(function () {
      var cur = itemOf(i);
      if (!cur) {
        run('wbs.create', { projectId: project.id, kind: i.kind, parentId: wpId(i.wp), values: { name: i.name, planned_start: i.start, planned_finish: i.finish, milestone_category: i.category, owner_resource_id: pid(i.owner) } });
        applied.items++;
      } else {
        var patch = {};
        if (i.start !== '' && String(cur.planned_start || '') !== i.start) patch.planned_start = i.start;
        if (i.finish !== '' && String(cur.planned_finish || '') !== i.finish) patch.planned_finish = i.finish;
        if (i.owner && cur.owner_resource_id !== pid(i.owner)) patch.owner_resource_id = pid(i.owner);
        if (i.kind === 'Jalon' && i.category !== '' && String(cur.milestone_category || '') !== i.category) patch.milestone_category = i.category;
        if (Object.keys(patch).length) { run('wbs.update', { kind: 'item', id: cur.id, version: cur.version, patch: patch }); applied.items++; }
      }
    });
    i.contributors.forEach(function (c) {
      step(function () {
        var cur = itemOf(i); if (!cur) return;
        var who = pid(c);
        var has = repoList('RoleAssignment', function (a) { return a.resource_id === who && a.scope_type === 'planitem' && a.scope_id === cur.id && roleActive_(a, todayStr()) && (a.role_code === 'CONTRIB' || a.role_code === 'DO'); }).length;
        if (!has) { run('roles.assign', { values: { resource_id: who, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: cur.id } }); applied.contributors++; }
      });
    });
  });
  // 3. dépendances (les deux bouts existent maintenant)
  var anyItem = function (wp, name) {
    var wid = wpId(wp);
    return repoList('PlanItem', function (x) { return x.project_id === project.id && (x.wp_id || '') === wid && nm(x.name) === nm(name); })[0] || null;
  };
  (bp.deps || []).forEach(function (d) {
    if (d.action !== 'create') return;
    step(function () {
      var pr = anyItem(d.pred.wp, d.pred.name), su = anyItem(d.succ.wp, d.succ.name);
      if (!pr || !su) return;
      if (repoList('Dependency', function (x) { return x.predecessor_id === pr.id && x.successor_id === su.id; }).length) return;
      run('dependencies.create', { values: { predecessor_id: pr.id, successor_id: su.id, dep_type: d.type, lag_days: d.lag } });
      applied.deps++;
    });
  });
  // 4. lignes de budget
  plan.lines.forEach(function (l) {
    step(function () {
      var wid = wpId(l.wp);
      var it = repoList('PlanItem', function (x) { return x.project_id === project.id && x.item_type === 'Livrable' && (x.wp_id || '') === wid && nm(x.name) === nm(l.item); })[0];
      if (!it) return;
      var who = pid(l.resource);
      var cur = repoList('BudgetLine', function (b) { return b.deliverable_id === it.id && b.resource_id === who; })[0];
      var values = l.type === 'TJM' ? { planned_days: l.days } : { fixed_amount: l.fixed };
      if (cur) {
        var same = l.type === 'TJM' ? cur.cost_type === 'TJM' && Number(cur.planned_days) === l.days : cur.cost_type === 'Forfait' && Number(cur.fixed_amount) === l.fixed;
        if (same) return;
        run('budget.line.save', { id: cur.id, values: values });
      } else {
        run('budget.line.save', { values: Object.assign({ deliverable_id: it.id, resource_id: who }, values) });
      }
      applied.lines++;
    });
  });
  // 5. enveloppes (état final : tout en une fois)
  step(function () {
    var cur = mustGet('Project', project.id), params = { projectId: project.id }, wanted = 0;
    if (plan.project && plan.project.authorized !== '' && Number(cur.budget_authorized) !== plan.project.authorized) { params.authorized = plan.project.authorized; wanted++; }
    var allocations = [];
    plan.wps.forEach(function (w) {
      if (w.envelope === '') return;
      var wp = repoList('WorkPackage', function (x) { return x.project_id === project.id && String(x.wbs_code) === w.code; })[0];
      if (wp && (isBlank(wp.budget_allocated) || Number(wp.budget_allocated) !== w.envelope)) allocations.push({ wpId: wp.id, amount: w.envelope });
    });
    if (allocations.length) { params.allocations = allocations; wanted += allocations.length; }
    if (wanted) { run('budget.envelope.set', params); applied.envelope += wanted; }
  });
}

/**
 * Applique le plan : programmes, projets, personnes, puis chaque projet. S'arrête quand le budget de temps (`IMPORT_BUDGET_MS`) ou `maxOps` (essais) est atteint, et dit alors `done: false` :
 * relancer reprend où on s'est arrêté, puisque le plan est recalculé à chaque lancement et que ce qui est déjà fait est reconnu. Refuse tout si l'analyse a des erreurs. Au premier lancement
 * (sans `resume`), une copie de sécurité des projets existants est enregistrée d'abord : si elle échoue, rien n'est écrit.
 */
defineAction('import.run', function (p, ctx) {
  var single = !isBlank(p.projectId) ? importRequire_(ctx, p.projectId) : null;
  var opts = { projectId: single ? single.id : '' };
  var book = importReadBook_(requireParam(p, 'book'));
  var all = importAnalyzeAll_(book, ctx, opts);
  if (all.errors.length) throw new PpmError('VALIDATION', 'Le classeur a ' + all.errors.length + ' erreur(s) : lancez « Analyser » et corrigez-les avant d’importer.', { rule: 'IMPORT_ERRORS', errors: all.errors.slice(0, 20) });
  var backup = p.resume ? null : importBackup_(ctx, all);
  var started = nowMs(), ops = 0, maxOps = p.maxOps ? Number(p.maxOps) : 0;
  var applied = { programs: 0, projects: 0, people: 0, wps: 0, items: 0, contributors: 0, lines: 0, envelope: 0, deps: 0 };
  var full = function () { return (maxOps && ops >= maxOps) || nowMs() - started > IMPORT_BUDGET_MS; };
  var run = function (name, params) { ops++; return API_ACTIONS[name](params, ctx); };
  var stopped = false;
  var step = function (fn) { if (stopped) return; if (full()) { stopped = true; return; } fn(); };
  var programId = function (code) { var g = repoList('Program', function (x) { return String(x.code) === code; })[0]; return g ? g.id : ''; };
  var projectByCode = function (code) { return repoList('Project', function (x) { return String(x.code) === code; })[0] || null; };

  // 1. programmes
  all.programs.forEach(function (g) {
    if (g.action !== 'create') return;
    step(function () {
      if (programId(g.code)) return;
      run('programs.create', { values: { code: g.code, name: g.name, status: g.status, description: g.description } });
      applied.programs++;
    });
  });
  // 2. personnes (avant les projets : un chef de projet créé par le même classeur doit exister)
  all.people.forEach(function (x) {
    if (x.action !== 'create') return;
    step(function () {
      if (importPersonId_(x.person)) return;
      var v = x.person;
      var created = run('resources.create', { values: { name: v.name, email: v.email, resource_type: v.resource_type, country: v.country, job_function: v.job_function, organization: v.organization, supplier: v.supplier } });
      applied.people++;
      if (v.daily_rate !== '' && v.daily_rate !== null && v.daily_rate !== undefined) { run('people.setRate', { resourceId: created.id, daily_rate: v.daily_rate }); }
    });
  });
  // 3. projets (création, ou mise à jour du nom, du statut et du pays des jours fériés)
  all.projects.forEach(function (bp) {
    if (bp.action === 'same') return;
    step(function () {
      var cur = projectByCode(bp.code);
      if (!cur) {
        var values = { code: bp.code, name: bp.name, status: bp.status, holiday_country: bp.holiday };
        if (bp.programCode) values.program_id = programId(bp.programCode);
        if (bp.manager) values.manager_resource_id = importPersonId_(bp.manager);
        run('projects.create', { values: values });
        applied.projects++;
      } else {
        var patch = {};
        if (String(cur.name).toLowerCase().trim() !== bp.name.toLowerCase().trim()) patch.name = bp.name;
        if (cur.status !== bp.status) patch.status = bp.status;
        if (String(cur.holiday_country || 'FR') !== bp.holiday) patch.holiday_country = bp.holiday;
        if (Object.keys(patch).length) { run('projects.update', { id: cur.id, version: cur.version, patch: patch }); applied.projects++; }
      }
    });
  });
  // 4. chaque projet
  var io = { step: step, run: run, applied: applied, pid: importPersonId_ };
  all.projects.forEach(function (bp) {
    var project = projectByCode(bp.code);
    if (!project) return;       // pas encore créé (le lot s'est arrêté avant) : au lancement suivant
    importApplyProject_(ctx, project, bp, io);
  });
  var after = importAnalyzeAll_(importReadBook_(book.id), ctx, opts);
  var remaining = importRemaining_(after.counts);
  return { done: remaining === 0, stopped: stopped, applied: applied, remaining: remaining, operations: ops, counts: after.counts, backup: backup };
});
