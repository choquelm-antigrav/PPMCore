/**
 * PPM Core — 0.17.0 : la STRUCTURE DES ÉQUIPES, dans un classeur Google Sheet dédié.
 *
 * Les équipes sont communes à tous les projets : les mêmes personnes, réparties dans les mêmes équipes, travaillent sur plusieurs projets. On les décrit donc UNE fois, dans un classeur à part,
 * et on les importe ; ensuite, créer une ressource lui attribue une équipe qui existe déjà (page Ressources), et chaque projet n'affiche que les équipes dont au moins un membre y participe.
 * On peut toujours créer des équipes à la main en plus.
 *
 * Trois actions, réservées à qui gère les équipes (droit `resource.edit` : chef de projet et au-dessus) :
 *   teams.import.template  crée dans Drive un classeur prérempli avec la structure actuelle (c'est aussi l'export) et le partage avec la personne ;
 *   teams.import.analyze   lit un classeur et rend un RAPPORT sans rien écrire (chaque erreur avec son onglet et sa ligne) ;
 *   teams.import.run       applique le plan, par lots reprenables ; copie de sécurité avant le premier lot si des équipes ou des personnes existantes vont changer.
 *
 * ONGLETS. Équipes : Équipe · Équipe parente · Responsable (e-mail) · Centre de coût. Membres (facultatif) : Équipe · Nom · E-mail · Type · Fonction · Organisation · Pays · Fournisseur.
 * CLÉS. Une équipe : son NOM (sans tenir compte des accents ni de la casse ; l'équipe parente se désigne par son nom). Une personne : son e-mail, ou à défaut son nom exact.
 *
 * RÈGLES. L'import crée les équipes et les personnes qui manquent. Il ne SUPPRIME rien et n'ÉCRASE rien : une équipe qui existe déjà n'a que ses champs VIDES complétés (équipe parente,
 * responsable, centre de coût) ; une personne sans équipe reçoit celle du classeur, une personne déjà dans une autre équipe n'est pas déplacée (c'est signalé). Une boucle dans la structure
 * est une erreur. Tout est analysé avant d'écrire : une seule erreur et rien n'est écrit.
 */

var TEAM_IMPORT_TABS = [
  { name: 'Équipes', cols: ['Équipe', 'Équipe parente', 'Responsable (e-mail)', 'Centre de coût', 'Pays'], text: [] },
  { name: 'Membres', cols: ['Équipe', 'Nom', 'E-mail', 'Type (Interne ou Externe)', 'Fonction', 'Organisation', 'Pays', 'Fournisseur'], text: [], optional: true }
];
var TEAM_IMPORT_LIMITS = { teams: 500, members: 3000 };

/** La clé d'un nom d'équipe : sans tenir compte des accents, de la casse ni des espaces en trop. */
function teamNorm_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function teamImportReadBook_(ref) {
  var id = importBookId_(ref), ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e2) { who = ''; }
    throw new PpmError('VALIDATION', 'Classeur illisible. Utilisez le classeur créé par l’outil, ou partagez le vôtre en lecture avec ' + (who || 'le compte qui exécute l’outil') + '.');
  }
  var parsed = {}, problems = [];
  TEAM_IMPORT_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab.name);
    if (!sh) { if (!tab.optional) problems.push({ tab: tab.name, row: 0, message: 'Onglet « ' + tab.name + ' » introuvable : gardez les onglets du modèle.' }); parsed[tab.name] = []; return; }
    var data = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues().map(function (row) { return row.map(normalizeValue); });
    parsed[tab.name] = importRows_(data, tab, problems);
  });
  return { id: id, name: ss.getName(), parsed: parsed, problems: problems };
}

/** Le plan d'import, sans rien écrire. */
function teamsImportAnalyze_(book, ctx) {
  var P = book.parsed, errors = book.problems.slice(), warnings = [];
  var err = function (tab, row, msg) { errors.push({ tab: tab, row: row, message: msg }); };
  var warn = function (tab, row, msg) { warnings.push({ tab: tab, row: row, message: msg }); };
  var teams = repoList('HierarchicalTeam'), toolByName = {}, toolById = indexBy_(teams);
  teams.forEach(function (t) { var k = teamNorm_(t.name); (toolByName[k] = toolByName[k] || []).push(t); });
  var maps = importPeopleMaps_();
  var canCreatePeople = canEditResources_(ctx);
  var rowsT = P['Équipes'] || [], rowsM = P['Membres'] || [];
  if (rowsT.length > TEAM_IMPORT_LIMITS.teams) err('Équipes', rowsT[TEAM_IMPORT_LIMITS.teams]._row, 'Au plus ' + TEAM_IMPORT_LIMITS.teams + ' équipes par import.');
  if (rowsM.length > TEAM_IMPORT_LIMITS.members) err('Membres', rowsM[TEAM_IMPORT_LIMITS.members]._row, 'Au plus ' + TEAM_IMPORT_LIMITS.members + ' membres par import.');

  // ---- 1. les équipes du classeur (leurs noms d'abord : les membres s'y rattachent)
  var planned = {}, order = [];
  rowsT.forEach(function (r) {
    var row = r._row, name = '';
    try { name = teamName_(r['Équipe']); } catch (e) { err('Équipes', row, e.message); return; }
    var key = teamNorm_(name);
    if (planned[key]) { err('Équipes', row, 'L’équipe « ' + name + ' » est déjà à la ligne ' + planned[key].row + '.'); return; }
    var same = toolByName[key] || [];
    if (same.length > 1) { err('Équipes', row, 'Plusieurs équipes de l’outil s’appellent « ' + name + ' » : renommez-en une avant d’importer.'); return; }
    if (r['Centre de coût'].length > 40) { err('Équipes', row, 'Centre de coût : 40 caractères au plus.'); return; }
    if (r['Pays'] && COUNTRIES.indexOf(r['Pays']) < 0) { err('Équipes', row, 'Pays « ' + r['Pays'] + ' » : ' + COUNTRIES.join(', ') + ' (ou vide : la France).'); return; }
    planned[key] = { name: name, key: key, row: row, parentText: r['Équipe parente'], managerText: r['Responsable (e-mail)'], cost: r['Centre de coût'], country: r['Pays'], existing: same[0] || null };
    order.push(planned[key]);
  });
  var teamKnown = function (name) { var k = teamNorm_(name); return !!planned[k] || (toolByName[k] || []).length > 0; };

  // ---- 2. les membres : personnes à créer, à rattacher, ou déjà en place
  var members = [], seenM = {};
  rowsM.forEach(function (r) {
    var row = r._row, teamName = r['Équipe'], name = r['Nom'], email = r['E-mail'].toLowerCase(), bad = false;
    if (!teamName) { err('Membres', row, 'Équipe obligatoire.'); return; }
    var tkey = teamNorm_(teamName);
    if (!teamKnown(teamName)) { err('Membres', row, 'Équipe « ' + teamName + ' » : introuvable (ni dans l’onglet Équipes, ni dans l’outil).'); bad = true; }
    else if (!planned[tkey] && (toolByName[tkey] || []).length > 1) { err('Membres', row, 'Plusieurs équipes de l’outil s’appellent « ' + teamName + ' » : renommez-en une avant d’importer.'); bad = true; }
    if (!name && !email) { err('Membres', row, 'Nom ou adresse e-mail obligatoire.'); return; }
    var existing = null;
    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err('Membres', row, 'Adresse e-mail illisible : « ' + email + ' ».'); bad = true; }
      else existing = maps.people[email] || null;
    } else {
      var named = maps.peopleByName[teamNorm_(name)] || [];
      if (named.length === 1) existing = named[0];
      else if (named.length > 1) { err('Membres', row, 'Plusieurs personnes s’appellent « ' + name + ' » : donnez une adresse e-mail.'); bad = true; }
    }
    var key = email || 'nom:' + teamNorm_(name);
    if (seenM[key]) { err('Membres', row, 'Cette personne est déjà à la ligne ' + seenM[key] + '.'); bad = true; }
    seenM[key] = row;
    if (bad) return;
    if (existing) {
      var cur = existing.team_id ? toolById[existing.team_id] : null, action = 'same';
      if (!cur) action = 'assign';
      else if (teamNorm_(cur.name) !== tkey) warn('Membres', row, (existing.name || name) + ' est déjà dans l’équipe « ' + cur.name + ' » : elle n’est pas déplacée.');
      members.push({ teamKey: tkey, teamName: teamName, person: existing, action: action, row: row });
      return;
    }
    var type = r['Type (Interne ou Externe)'] || 'Interne';
    if (!name) { err('Membres', row, 'Nom obligatoire pour créer une personne.'); return; }
    if (['Interne', 'Externe'].indexOf(type) < 0) { err('Membres', row, 'Type « ' + type + ' » : Interne ou Externe.'); return; }
    if (r['Pays'] && COUNTRIES.indexOf(r['Pays']) < 0) { err('Membres', row, 'Pays « ' + r['Pays'] + ' » : ' + COUNTRIES.join(', ') + ' (ou vide).'); return; }
    if (!canCreatePeople) { err('Membres', row, 'Créer une personne est réservé au chef de projet et aux niveaux au-dessus.'); return; }
    var virtual = { id: 'new:' + key, _new: true, name: name, email: email, resource_type: type, country: r['Pays'], job_function: r['Fonction'], organization: r['Organisation'], supplier: r['Fournisseur'] };
    if (email) maps.people[email] = virtual; else (maps.peopleByName[teamNorm_(name)] = maps.peopleByName[teamNorm_(name)] || []).push(virtual);
    members.push({ teamKey: tkey, teamName: teamName, person: virtual, action: 'create', row: row });
  });

  // ---- 3. équipes : parent, responsable, boucles, ce qui sera créé ou complété
  var managerOf = function (text) {
    var e = String(text).toLowerCase().trim();
    if (e.indexOf('@') >= 0) return maps.people[e] || null;
    var named = maps.peopleByName[teamNorm_(e)] || [];
    return named.length === 1 ? named[0] : null;
  };
  order.forEach(function (pt) {
    if (pt.parentText) {
      var pk = teamNorm_(pt.parentText);
      if (pk === pt.key) err('Équipes', pt.row, 'Une équipe ne peut pas être sa propre équipe parente.');
      else if (!planned[pk] && !(toolByName[pk] || []).length) err('Équipes', pt.row, 'Équipe parente « ' + pt.parentText + ' » : introuvable (ni dans le classeur, ni dans l’outil).');
      else if (!planned[pk] && toolByName[pk].length > 1) err('Équipes', pt.row, 'Plusieurs équipes de l’outil s’appellent « ' + pt.parentText + ' » : renommez-en une avant d’importer.');
      else pt.parentKey = pk;
    }
    if (pt.managerText) {
      var m = managerOf(pt.managerText);
      if (!m) err('Équipes', pt.row, 'Responsable : « ' + pt.managerText + ' » n’est pas dans Ressources ni dans l’onglet Membres.');
      else pt.manager = m;
    }
  });
  // la structure telle qu'elle sera : le parent de l'outil s'il existe (on n'écrase rien), sinon celui du classeur
  var effParent = function (key) {
    var tool = (toolByName[key] || [])[0], pt = planned[key];
    if (tool && tool.parent_team_id && toolById[tool.parent_team_id]) return teamNorm_(toolById[tool.parent_team_id].name);
    return pt && pt.parentKey ? pt.parentKey : '';
  };
  order.forEach(function (pt) {
    var cur = pt.key, g = 0;
    while (cur && g++ < 300) { cur = effParent(cur); if (cur === pt.key) { err('Équipes', pt.row, 'Cette équipe se retrouverait sous elle-même : la structure contient une boucle.'); break; } }
  });
  order.forEach(function (pt) {
    var ex = pt.existing;
    if (!ex) { pt.action = 'create'; pt.fills = []; return; }
    var fills = [];
    if (pt.parentKey) {
      var par = (toolByName[pt.parentKey] || [])[0];
      if (!ex.parent_team_id) fills.push('parent');
      else if (!par || par.id !== ex.parent_team_id) warn('Équipes', pt.row, 'L’équipe « ' + pt.name + ' » a un autre parent dans l’outil : il n’est pas changé.');
    }
    if (pt.manager) {
      if (!ex.manager_resource_id) fills.push('manager');
      else if (pt.manager._new || ex.manager_resource_id !== pt.manager.id) warn('Équipes', pt.row, 'L’équipe « ' + pt.name + ' » a un autre responsable dans l’outil : il n’est pas changé.');
    }
    if (pt.cost) {
      if (!ex.cost_center) fills.push('cost');
      else if (ex.cost_center !== pt.cost) warn('Équipes', pt.row, 'L’équipe « ' + pt.name + ' » a un autre centre de coût dans l’outil : il n’est pas changé.');
    }
    if (pt.country) {
      if (!ex.country) fills.push('country');
      else if (ex.country !== pt.country) warn('Équipes', pt.row, 'L’équipe « ' + pt.name + ' » a un autre pays dans l’outil : il n’est pas changé.');
    }
    pt.fills = fills; pt.action = fills.length ? 'update' : 'same';
  });
  var counts = { teams: { create: 0, update: 0, same: 0 }, members: { create: 0, assign: 0, same: 0 } };
  order.forEach(function (pt) { counts.teams[pt.action]++; });
  members.forEach(function (m) { counts.members[m.action]++; });
  var onlyInTool = teams.filter(function (t) { return !planned[teamNorm_(t.name)]; }).length;
  if (onlyInTool && rowsT.length) warn('Équipes', 0, onlyInTool + ' équipe(s) de l’outil ne sont pas dans le classeur : elles sont laissées telles quelles (l’import ne supprime jamais rien).');
  return { errors: errors, warnings: warnings, planned: order, plannedByKey: planned, members: members, counts: counts };
}

function teamsImportRemaining_(c) { return c.teams.create + c.teams.update + c.members.create + c.members.assign; }

function teamsImportReport_(book, a) {
  return {
    book: { id: book.id, name: book.name }, ok: a.errors.length === 0, errors: a.errors.slice(0, 200), errors_count: a.errors.length,
    warnings: a.warnings.slice(0, 200), warnings_count: a.warnings.length, counts: a.counts,
    nothing_to_do: a.errors.length === 0 && teamsImportRemaining_(a.counts) === 0
  };
}

// ---------------------------------------------------------------- l'export (le modèle prérempli)

var TEAM_IMPORT_README = [
  ['Structure des équipes — mode d’emploi'],
  [''],
  ['Deux onglets : Équipes (la structure) et Membres (qui est dans quelle équipe, facultatif). Ne changez ni les noms d’onglets ni les en-têtes de colonnes.'],
  ['Ce classeur est prérempli avec les équipes actuelles de l’outil : modifiez-le, ajoutez des lignes, puis revenez dans la page Ressources (Importer des équipes) pour « Analyser », puis « Importer ».'],
  [''],
  ['Équipes : le nom est la clé (sans tenir compte des accents ni de la casse) ET le niveau budgétaire : 3 caractères = l’équipe porte le budget de l’exercice, 4 caractères = un détail rattaché à son équipe parente à 3 caractères. « Équipe parente » désigne une autre équipe par son nom ; laissez vide pour une équipe de premier niveau. Le responsable se désigne par son e-mail. Le pays sert à convertir un montant en jours (coût d’un ETP) ; vide : la France.'],
  ['Membres : une ligne par personne et par équipe. Une personne qui n’existe pas encore est créée (nom obligatoire ; type Interne ou Externe) ; une personne sans équipe reçoit celle du classeur ; une personne déjà dans une autre équipe n’est pas déplacée.'],
  [''],
  ['L’import ne supprime jamais rien et n’écrase jamais rien : une équipe qui existe déjà n’a que ses champs vides complétés. Importer deux fois le même classeur ne change rien.'],
  ['Les équipes sont communes à tous les projets. Chaque projet n’affiche, dans la page Ressources, que les équipes dont au moins un membre y participe ; on peut aussi créer des équipes à la main.']
];

function teamExportRows_() {
  var teams = repoList('HierarchicalTeam'), resources = repoList('Resource'), resById = indexBy_(resources), teamById = indexBy_(teams);
  var flat = teamsFlat_(teams, resources), rank = {};
  var contact = function (id) { var r = resById[id]; return r ? (r.email || r.name || '') : ''; };
  var out = { 'Équipes': [], 'Membres': [] };
  flat.forEach(function (t, i) {
    rank[t.id] = i;
    var parent = t.parent_team_id && teamById[t.parent_team_id] ? teamById[t.parent_team_id].name : '';
    out['Équipes'].push([t.name, parent, contact(t.manager_id), t.cost_center || '', t.country || '']);
  });
  resources.filter(function (r) { return !isBlank(r.team_id) && teamById[r.team_id]; })
    .sort(function (a, b) { return (rank[a.team_id] - rank[b.team_id]) || String(a.name).localeCompare(String(b.name), 'fr'); })
    .forEach(function (r) { out['Membres'].push([teamById[r.team_id].name, r.name, r.email || '', r.resource_type || 'Interne', r.job_function || '', r.organization || '', r.country || '', r.supplier || '']); });
  return out;
}

/** Crée le classeur dans Drive, l'écrit et le partage ; un échec de création se propage, un échec de partage n'est qu'un avertissement. */
function teamBuildWorkbook_(ctx, title) {
  var rows = teamExportRows_();
  var ss = SpreadsheetApp.create(title);
  var readme = ss.insertSheet('Lisez-moi');
  readme.getRange(1, 1, TEAM_IMPORT_README.length, 1).setValues(TEAM_IMPORT_README);
  readme.getRange(1, 1).setFontWeight('bold');
  TEAM_IMPORT_TABS.forEach(function (tab) {
    var sh = ss.insertSheet(tab.name), data = rows[tab.name] || [];
    sh.getRange(1, 1, 1, tab.cols.length).setValues([tab.cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (data.length) sh.getRange(2, 1, data.length, tab.cols.length).setValues(data);
  });
  ['Feuille 1', 'Sheet1'].forEach(function (n) { var d = ss.getSheetByName(n); if (d && ss.getSheets().length > 1) { try { ss.deleteSheet(d); } catch (e) { /* laissée */ } } });
  var warnings = [], email = String(ctx.email || '').toLowerCase();
  try {
    if (IMPORT_DRIVE) IMPORT_DRIVE.share(ss.getId(), email);
    else if (email) DriveApp.getFileById(ss.getId()).addEditor(email);
  } catch (e) { warnings.push('Le classeur est créé mais n’a pas pu être partagé avec ' + email + ' : ' + String(e && e.message ? e.message : e).slice(0, 160) + ' Demandez le partage à l’administrateur.'); }
  return { id: ss.getId(), url: ss.getUrl(), name: ss.getName(), warnings: warnings, prefilled: { equipes: rows['Équipes'].length, membres: rows['Membres'].length } };
}

defineAction('teams.import.template', function (p, ctx) {
  requireTeamEditor_(ctx);
  return teamBuildWorkbook_(ctx, 'PPM — Structure des équipes — ' + todayStr());
});

// ---------------------------------------------------------------- analyse

defineAction('teams.import.analyze', function (p, ctx) {
  requireTeamEditor_(ctx);
  var book = teamImportReadBook_(requireParam(p, 'book'));
  return teamsImportReport_(book, teamsImportAnalyze_(book, ctx));
});

// ---------------------------------------------------------------- application, par lots

/**
 * Applique le plan : équipes (les parents d'abord), personnes (créées avec leur équipe, ou rattachées), puis les champs vides des équipes (parent, responsable, centre de coût). S'arrête au
 * budget de temps ou à `maxOps` (essais) et dit `done: false` ; relancer reprend, le plan étant recalculé. Au premier lancement (sans `resume`), une copie de sécurité est enregistrée si des
 * équipes ou des personnes EXISTANTES vont changer ; si elle échoue, rien n'est écrit.
 */
defineAction('teams.import.run', function (p, ctx) {
  requireTeamEditor_(ctx);
  var book = teamImportReadBook_(requireParam(p, 'book'));
  var all = teamsImportAnalyze_(book, ctx);
  if (all.errors.length) throw new PpmError('VALIDATION', 'Le classeur a ' + all.errors.length + ' erreur(s) : lancez « Analyser » et corrigez-les avant d’importer.', { rule: 'IMPORT_ERRORS', errors: all.errors.slice(0, 20) });
  var backup = null;
  if (!p.resume && all.counts.teams.update + all.counts.members.assign > 0) {
    try {
      var wb = teamBuildWorkbook_(ctx, 'PPM — Copie avant import d’équipes — ' + todayStr() + ' ' + String(nowIso()).slice(11, 16));
      backup = { id: wb.id, url: wb.url, name: wb.name };
    } catch (e) {
      throw new PpmError('VALIDATION', 'La copie de sécurité n’a pas pu être créée (' + String(e && e.message ? e.message : e).slice(0, 140) + ') : l’import est annulé, rien n’a été écrit.', { rule: 'IMPORT_BACKUP' });
    }
  }
  var started = nowMs(), ops = 0, maxOps = p.maxOps ? Number(p.maxOps) : 0, stopped = false;
  var applied = { teams: 0, people: 0, assigned: 0, filled: 0 };
  var full = function () { return (maxOps && ops >= maxOps) || nowMs() - started > IMPORT_BUDGET_MS; };
  var run = function (name, params) { ops++; return API_ACTIONS[name](params, ctx); };
  var step = function (fn) { if (stopped) return; if (full()) { stopped = true; return; } fn(); };
  var toolTeam = function (key) { return repoList('HierarchicalTeam', function (t) { return teamNorm_(t.name) === key; })[0] || null; };
  var depthOf = function (pt) { var d = 0, cur = pt, g = 0; while (cur && cur.parentKey && all.plannedByKey[cur.parentKey] && g++ < 300) { d++; cur = all.plannedByKey[cur.parentKey]; } return d; };

  // 1. les équipes qui manquent, les parents d'abord
  all.planned.filter(function (pt) { return pt.action === 'create'; }).sort(function (a, b) { return depthOf(a) - depthOf(b); }).forEach(function (pt) {
    step(function () {
      if (toolTeam(pt.key)) return;
      var values = { name: pt.name, cost_center: pt.cost, country: pt.country };
      if (pt.parentKey) { var par = toolTeam(pt.parentKey); if (par) values.parent_team_id = par.id; }
      run('teams.create', { values: values });
      applied.teams++;
    });
  });
  // 2. les personnes : créées avec leur équipe, ou rattachées
  all.members.forEach(function (m) {
    if (m.action === 'same') return;
    step(function () {
      var team = toolTeam(m.teamKey);
      if (!team) return;
      var who = importPersonId_(m.person);
      if (m.action === 'create' && !who) {
        var v = m.person;
        run('resources.create', { values: { name: v.name, email: v.email, resource_type: v.resource_type, country: v.country, job_function: v.job_function, organization: v.organization, supplier: v.supplier, team_id: team.id } });
        applied.people++;
        return;
      }
      if (!who) return;
      var cur = repoGet('Resource', who);
      if (cur && isBlank(cur.team_id)) { run('resources.update', { id: cur.id, version: cur.version, patch: { team_id: team.id } }); applied.assigned++; }
    });
  });
  // 3. les champs vides des équipes : parent, responsable (les personnes existent maintenant), centre de coût
  all.planned.forEach(function (pt) {
    step(function () {
      var cur = toolTeam(pt.key);
      if (!cur) return;
      var patch = {};
      if (pt.parentKey && isBlank(cur.parent_team_id)) { var par = toolTeam(pt.parentKey); if (par) patch.parent_team_id = par.id; }
      if (pt.manager && isBlank(cur.manager_resource_id)) { var mid = importPersonId_(pt.manager); if (mid) patch.manager_resource_id = mid; }
      if (pt.cost && isBlank(cur.cost_center)) patch.cost_center = pt.cost;
      if (pt.country && isBlank(cur.country)) patch.country = pt.country;
      if (Object.keys(patch).length) { run('teams.update', { id: cur.id, version: cur.version, patch: patch }); applied.filled++; }
    });
  });
  var after = teamsImportAnalyze_(teamImportReadBook_(book.id), ctx);
  var remaining = teamsImportRemaining_(after.counts);
  return { done: remaining === 0, stopped: stopped, applied: applied, remaining: remaining, operations: ops, counts: after.counts, backup: backup };
});
