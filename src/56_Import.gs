/**
 * PPM Core — 0.15.3 : import (et export) du WBS par classeur Google Sheet, un onglet par objet.
 *
 * Trois actions, réservées au chef de projet et au-dessus (droit `import.run`) :
 *   import.template  crée dans Drive un classeur MODÈLE, prérempli avec ce que le projet contient déjà (donc aussi un export), et le partage avec la personne ;
 *   import.analyze   lit un classeur et rend un RAPPORT sans rien écrire : ce qui sera créé, modifié, laissé tel quel, et chaque erreur avec son onglet et sa ligne ;
 *   import.run       applique le plan, par lots : un lancement s'arrête avant la limite de six minutes d'Apps Script et dit s'il reste à faire ; on le relance jusqu'à « terminé ».
 *
 * ONGLETS. Projet (budget autorisé) · Workpackages · Livrables · Jalons · Budget. Une ligne = un objet. Les personnes se désignent par leur ADRESSE E-MAIL et doivent déjà exister
 * dans Ressources (l'import ne crée jamais de personne : les personnes se créent dans la page Ressources).
 *
 * CLÉS. Un workpackage se retrouve par son code WBS (« 1 », « 1.2 »). Un livrable ou un jalon, par son workpackage et son nom ; une ligne de budget, par son livrable et sa
 * ressource. Importer deux fois le même classeur ne change donc rien. L'import ne SUPPRIME jamais rien : ce qui est dans l'outil et pas dans le classeur est seulement signalé.
 *
 * RÔLES. La colonne « Leader » ou « Owner » pose le responsable principal (Workpackage leader, Sub-workpackage leader ou Deliverable owner selon l'objet) ; « Contributors » pose des
 * Contributors. Tout passe par les actions ordinaires (wbs.create, wbs.update, roles.assign, budget.line.save, budget.envelope.set) : mêmes droits, mêmes règles, même journal ;
 * les changements restent donc « à valider » par le niveau du dessus, comme s'ils avaient été saisis à la main.
 */

var IMPORT_TABS = [
  { name: 'Projet', cols: ['Budget autorisé (€)'], text: [] },
  { name: 'Workpackages', cols: ['Code WBS', 'Parent (code WBS)', 'Nom', 'Leader (e-mail)', 'Imputation', 'Enveloppe (€)'], text: [0, 1, 4] },
  { name: 'Livrables', cols: ['Code WBS du workpackage', 'Nom', 'Début', 'Fin', 'Owner (e-mail)', 'Contributors (e-mails séparés par « ; »)'], text: [0] },
  { name: 'Jalons', cols: ['Code WBS du workpackage', 'Nom', 'Date', 'Catégorie', 'Owner (e-mail)'], text: [0] },
  { name: 'Budget', cols: ['Code WBS du workpackage', 'Livrable', 'Ressource (e-mail)', 'Type (TJM ou Forfait)', 'Jours', 'Montant forfait (€)'], text: [0] }
];
var IMPORT_LIMITS = { workpackages: 500, items: 3000, budget: 6000 };
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
      if (kind === 'Livrable') {
        importText_(r['Contributors (e-mails séparés par « ; »)']).split(/[;\n,]+/).forEach(function (e) {
          e = e.trim(); if (!e) return;
          var p = person(tabName, row, e, 'Contributor', false);
          if (p && contributors.indexOf(p) < 0) contributors.push(p);
        });
        if (owner && contributors.indexOf(owner) >= 0) { warn(tabName, row, owner.name + ' est Owner et Contributor : seul le rôle d’Owner est posé.'); contributors = contributors.filter(function (p) { return p !== owner; }); }
      } else if (r._raw['Contributors']) { /* sans objet pour un jalon */ }
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

// ---------------------------------------------------------------- accès au classeur et à l'état du projet

function importBookId_(ref) {
  var s = String(ref || '').trim();
  var m = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) || /^fake-book-\d+$/.test(s)) return s;
  throw new PpmError('VALIDATION', 'Collez le lien du classeur Google Sheet (ou son identifiant).');
}

function importReadBook_(ref) {
  var id = importBookId_(ref), ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e2) { who = ''; }
    throw new PpmError('VALIDATION', 'Classeur illisible. Utilisez le classeur créé par l’outil, ou partagez le vôtre en lecture avec ' + (who || 'le compte qui exécute l’outil') + '.');
  }
  var parsed = {}, problems = [];
  IMPORT_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab.name);
    if (!sh) { if (tab.name !== 'Projet') problems.push({ tab: tab.name, row: 0, message: 'Onglet « ' + tab.name + ' » introuvable : gardez les onglets du modèle.' }); parsed[tab.name] = []; return; }
    var data = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues().map(function (row) { return row.map(normalizeValue); });
    parsed[tab.name] = importRows_(data, tab, problems);
  });
  return { id: id, name: ss.getName(), parsed: parsed, problems: problems };
}

function importExisting_(project) {
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var people = {}, peopleByName = {};
  repoList('Resource').forEach(function (r) {
    if (!isBlank(r.email)) people[String(r.email).toLowerCase()] = r;
    else { var k = String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim(); (peopleByName[k] = peopleByName[k] || []).push(r); }
  });
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id; }), itemIds = {};
  items.forEach(function (i) { itemIds[i.id] = true; });
  return {
    project: project, wps: wps, items: items, people: people, peopleByName: peopleByName, today: todayStr(),
    lines: repoList('BudgetLine', function (l) { return !!itemIds[l.deliverable_id]; }),
    roles: repoList('RoleAssignment', function (a) { return roleActive_(a, todayStr()); }),
    rateOf: function (res) { return dailyRateOf_(res, todayStr()); }
  };
}

function importReport_(project, book, result, problems) {
  var errors = problems.concat(result.errors);
  var c = result.counts;
  return {
    project: { id: project.id, code: project.code, name: project.name }, book: { id: book.id, name: book.name },
    ok: errors.length === 0, errors: errors.slice(0, 200), errors_count: errors.length, warnings: result.warnings.slice(0, 200), warnings_count: result.warnings.length,
    counts: c, nothing_to_do: errors.length === 0 && c.wps.create + c.wps.update + c.items.create + c.items.update + c.contributors + c.lines.create + c.lines.update + c.envelope === 0
  };
}

function importRequire_(ctx, projectId) {
  var project = mustGet('Project', projectId);
  requireCan(ctx, 'import.run', { type: 'project', id: projectId });
  return project;
}

// ---------------------------------------------------------------- le modèle (et l'export)

function importTemplateRows_(project) {
  var ex = importExisting_(project), byId = indexBy_(ex.wps), resById = indexBy_(repoList('Resource'));
  var email = function (id) { var r = resById[id]; return r ? (r.email || r.name || '') : ''; };   // à défaut d'adresse sur la fiche, le nom (l'import le comprend)
  var order = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  var wpCode = function (id) { return id && byId[id] ? String(byId[id].wbs_code) : ''; };
  var out = {
    'Projet': [[isBlank(project.budget_authorized) ? '' : Number(project.budget_authorized)]],
    'Workpackages': ex.wps.slice().sort(order).map(function (w) { return [String(w.wbs_code), wpCode(w.parent_wp_id), w.name, email(w.owner_resource_id), w.charge_code || '', isBlank(w.budget_allocated) ? '' : Number(w.budget_allocated)]; }),
    'Livrables': [], 'Jalons': [], 'Budget': []
  };
  var contrib = {};
  ex.roles.forEach(function (a) { if (a.scope_type === 'planitem' && a.role_code === 'CONTRIB') (contrib[a.scope_id] = contrib[a.scope_id] || []).push(email(a.resource_id)); });
  var itemOrder = function (a, b) { return wpCode(a.wp_id).localeCompare(wpCode(b.wp_id), 'fr', { numeric: true }) || String(a.planned_start || '').localeCompare(String(b.planned_start || '')) || String(a.name).localeCompare(String(b.name), 'fr'); };
  ex.items.slice().sort(itemOrder).forEach(function (i) {
    if (i.item_type === 'Livrable') out.Livrables.push([wpCode(i.wp_id), i.name, i.planned_start || '', i.planned_finish || '', email(i.owner_resource_id), (contrib[i.id] || []).filter(Boolean).join('; ')]);
    else out.Jalons.push([wpCode(i.wp_id), i.name, i.planned_finish || i.planned_start || '', i.milestone_category || '', email(i.owner_resource_id)]);
  });
  var itemById = indexBy_(ex.items);
  ex.lines.forEach(function (l) {
    var it = itemById[l.deliverable_id]; if (!it) return;
    out.Budget.push([wpCode(it.wp_id), it.name, email(l.resource_id), l.cost_type === 'Forfait' ? 'Forfait' : 'TJM', l.cost_type === 'TJM' && !isBlank(l.planned_days) ? Number(l.planned_days) : '', l.cost_type === 'Forfait' && !isBlank(l.fixed_amount) ? Number(l.fixed_amount) : '']);
  });
  return out;
}

var IMPORT_README = [
  ['Import du WBS par classeur — mode d’emploi'],
  [''],
  ['Un onglet par objet : Projet, Workpackages, Livrables, Jalons, Budget. Une ligne = un objet. Ne changez ni les noms d’onglets ni les en-têtes de colonnes.'],
  ['Ce classeur est prérempli avec ce que le projet contient déjà : modifiez, ajoutez des lignes, puis revenez dans l’outil (page WBS › Importer) pour « Analyser », puis « Importer ».'],
  [''],
  ['Les personnes se désignent par leur adresse e-mail (à défaut d’adresse sur leur fiche, par leur nom exact) et doivent déjà exister dans la page Ressources : l’import ne crée jamais de personne.'],
  ['Workpackages : le code WBS (« 1 », « 1.2 ») est la clé ; le leader devient Workpackage leader (ou Sub-workpackage leader pour un sous-workpackage) ; l’enveloppe est facultative (vide : pas de plafond).'],
  ['Livrables et jalons : on les retrouve par leur workpackage et leur nom (changer un nom crée un nouvel objet). L’owner devient Deliverable owner ; les contributors se séparent par « ; ». Dates : aaaa-mm-jj ou jj/mm/aaaa.'],
  ['Budget : une ligne par livrable et par ressource. TJM = jours × taux de la fiche de la personne (le taux doit exister) ; Forfait = montant en euros, ressources externes seulement.'],
  ['L’import ne supprime jamais rien : ce qui est dans l’outil et pas dans ce classeur reste en place. Importer deux fois le même classeur ne change rien.'],
  ['Les changements importés restent « à valider » par le niveau du dessus (page Suivi), comme s’ils avaient été saisis à la main.']
];

defineAction('import.template', function (p, ctx) {
  var project = importRequire_(ctx, requireParam(p, 'projectId'));
  var rows = importTemplateRows_(project);
  var ss = SpreadsheetApp.create('PPM — Import du WBS — ' + project.code + ' — ' + todayStr());
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
  var warnings = [];
  var email = String(ctx.email || '').toLowerCase();
  try {
    if (IMPORT_DRIVE) { IMPORT_DRIVE.share(ss.getId(), email); if (IMPORT_DRIVE.moveToProjectFolder) IMPORT_DRIVE.moveToProjectFolder(ss.getId(), project); }
    else {
      var f = DriveApp.getFileById(ss.getId());
      if (email) f.addEditor(email);
      if (!isBlank(project.drive_folder_id)) { try { DriveApp.getFolderById(project.drive_folder_id).addFile(f); DriveApp.getRootFolder().removeFile(f); } catch (e) { warnings.push('Le classeur est resté à la racine du Drive du compte qui exécute l’outil (dossier du projet inaccessible).'); } }
    }
  } catch (e) { warnings.push('Le classeur est créé mais n’a pas pu être partagé avec ' + email + ' : ' + String(e && e.message ? e.message : e).slice(0, 160) + ' Demandez le partage à l’administrateur.'); }
  return { id: ss.getId(), url: ss.getUrl(), name: ss.getName(), prefilled: { workpackages: rows.Workpackages.length, livrables: rows.Livrables.length, jalons: rows.Jalons.length, budget: rows.Budget.length }, warnings: warnings };
});

// ---------------------------------------------------------------- analyse

defineAction('import.analyze', function (p, ctx) {
  var project = importRequire_(ctx, requireParam(p, 'projectId'));
  var book = importReadBook_(requireParam(p, 'book'));
  var result = importAnalyze_(book.parsed, importExisting_(project));
  return importReport_(project, book, result, book.problems);
});

// ---------------------------------------------------------------- application, par lots

/**
 * Applique le plan. S'arrête quand le budget de temps (`IMPORT_BUDGET_MS`) ou `maxOps` (essais) est atteint, et dit alors `done: false` : relancer reprend où on s'est arrêté, puisque
 * le plan est recalculé à chaque lancement et que ce qui est déjà fait est reconnu. Refuse tout si l'analyse a des erreurs.
 */
defineAction('import.run', function (p, ctx) {
  var project = importRequire_(ctx, requireParam(p, 'projectId'));
  var book = importReadBook_(requireParam(p, 'book'));
  var existing = importExisting_(project);
  var result = importAnalyze_(book.parsed, existing);
  var errors = book.problems.concat(result.errors);
  if (errors.length) throw new PpmError('VALIDATION', 'Le classeur a ' + errors.length + ' erreur(s) : lancez « Analyser » et corrigez-les avant d’importer.', { rule: 'IMPORT_ERRORS', errors: errors.slice(0, 20) });
  var plan = result.plan, started = nowMs(), ops = 0, maxOps = p.maxOps ? Number(p.maxOps) : 0, applied = { wps: 0, items: 0, contributors: 0, lines: 0, envelope: 0 };
  var full = function () { return (maxOps && ops >= maxOps) || nowMs() - started > IMPORT_BUDGET_MS; };
  var run = function (name, params) { ops++; return API_ACTIONS[name](params, ctx); };
  var stopped = false;
  var step = function (fn) { if (stopped) return; if (full()) { stopped = true; return; } fn(); };
  var wpId = function (code) {
    if (!code) return '';
    var w = repoList('WorkPackage', function (x) { return x.project_id === project.id && String(x.wbs_code) === code; })[0];
    return w ? w.id : '';
  };
  var ownerId = function (r) { return r ? r.id : ''; };

  // 1. workpackages : premier niveau, puis sous-niveaux
  [false, true].forEach(function (subLevel) {
    plan.wps.filter(function (w) { return !!w.parent === subLevel; }).forEach(function (w) {
      step(function () {
        var cur = repoList('WorkPackage', function (x) { return x.project_id === project.id && String(x.wbs_code) === w.code; })[0];
        if (!cur) {
          run('wbs.create', { projectId: project.id, kind: 'wp', parentId: wpId(w.parent), values: { name: w.name, wbs_code: w.code, owner_resource_id: ownerId(w.leader), charge_code: w.charge } });
          applied.wps++;
        } else {
          var patch = {};
          if (String(cur.name).toLowerCase().trim() !== w.name.toLowerCase().trim()) patch.name = w.name;
          if (w.leader && cur.owner_resource_id !== w.leader.id) patch.owner_resource_id = w.leader.id;
          if (w.charge !== '' && String(cur.charge_code || '') !== w.charge) patch.charge_code = w.charge;
          if (Object.keys(patch).length) { run('wbs.update', { kind: 'wp', id: cur.id, version: cur.version, patch: patch }); applied.wps++; }
        }
      });
    });
  });
  // 2. livrables et jalons, puis leurs contributors
  var itemOf = function (i) {
    var wid = wpId(i.wp);
    return repoList('PlanItem', function (x) { return x.project_id === project.id && x.item_type === i.kind && (x.wp_id || '') === wid && x.name.toLowerCase().replace(/\s+/g, ' ').trim() === i.name.toLowerCase().replace(/\s+/g, ' ').trim(); })[0] || null;
  };
  plan.items.forEach(function (i) {
    step(function () {
      var cur = itemOf(i);
      if (!cur) {
        var rec = run('wbs.create', { projectId: project.id, kind: i.kind, parentId: wpId(i.wp), values: { name: i.name, planned_start: i.start, planned_finish: i.finish, milestone_category: i.category, owner_resource_id: ownerId(i.owner) } });
        applied.items++;
        cur = rec.record;
      } else {
        var patch = {};
        if (i.start !== '' && String(cur.planned_start || '') !== i.start) patch.planned_start = i.start;
        if (i.finish !== '' && String(cur.planned_finish || '') !== i.finish) patch.planned_finish = i.finish;
        if (i.owner && cur.owner_resource_id !== i.owner.id) patch.owner_resource_id = i.owner.id;
        if (i.kind === 'Jalon' && i.category !== '' && String(cur.milestone_category || '') !== i.category) patch.milestone_category = i.category;
        if (Object.keys(patch).length) { run('wbs.update', { kind: 'item', id: cur.id, version: cur.version, patch: patch }); applied.items++; }
      }
    });
    i.contributors.forEach(function (c) {
      step(function () {
        var cur = itemOf(i); if (!cur) return;
        var has = repoList('RoleAssignment', function (a) { return a.resource_id === c.id && a.scope_type === 'planitem' && a.scope_id === cur.id && roleActive_(a, todayStr()) && (effectiveRoleCode_(a, ctx.lookup) === 'CONTRIB' || a.role_code === 'DO'); }).length;
        if (!has) { run('roles.assign', { values: { resource_id: c.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: cur.id } }); applied.contributors++; }
      });
    });
  });
  // 3. lignes de budget
  plan.lines.forEach(function (l) {
    step(function () {
      var wid = wpId(l.wp);
      var it = repoList('PlanItem', function (x) { return x.project_id === project.id && x.item_type === 'Livrable' && (x.wp_id || '') === wid && x.name.toLowerCase().replace(/\s+/g, ' ').trim() === l.item.toLowerCase().replace(/\s+/g, ' ').trim(); })[0];
      if (!it) return;
      var cur = repoList('BudgetLine', function (b) { return b.deliverable_id === it.id && b.resource_id === l.resource.id; })[0];
      var values = l.type === 'TJM' ? { planned_days: l.days } : { fixed_amount: l.fixed };
      if (cur) {
        var same = l.type === 'TJM' ? cur.cost_type === 'TJM' && Number(cur.planned_days) === l.days : cur.cost_type === 'Forfait' && Number(cur.fixed_amount) === l.fixed;
        if (same) return;
        run('budget.line.save', { id: cur.id, values: values });
      } else {
        run('budget.line.save', { values: Object.assign({ deliverable_id: it.id, resource_id: l.resource.id }, values) });
      }
      applied.lines++;
    });
  });
  // 4. enveloppes (état final : tout en une fois)
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
  var after = importAnalyze_(importReadBook_(book.id).parsed, importExisting_(mustGet('Project', project.id))).counts;
  var remaining = after.wps.create + after.wps.update + after.items.create + after.items.update + after.contributors + after.lines.create + after.lines.update + after.envelope;
  return { done: remaining === 0, stopped: stopped, applied: applied, remaining: remaining, operations: ops, counts: after };
});
