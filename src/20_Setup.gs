/**
 * PPM Core — installation et migrations additives.
 *
 * setupPpm() est idempotent : on peut le relancer après chaque évolution du schéma.
 * Il crée ce qui manque (classeurs, feuilles, colonnes ajoutées en fin de ligne),
 * pose les validations de listes, et charge les données de référence (rôles, fériés).
 *
 * Prérequis (propriétés du script) :
 *   PPM_DOMAIN = entreprise.com
 *   PPM_ADMINS = prenom.nom@entreprise.com[,autre@entreprise.com]
 */

/**
 * Installation en une fois : à exécuter depuis l'éditeur, une seule fonction.
 * Domaine et administrateur sont déduits du compte qui installe s'ils ne sont pas déjà réglés ;
 * puis création des classeurs, déclencheurs (nuit, 7 h) et vérification.
 * Relançable sans risque (après une mise à jour, elle ajoute les nouvelles colonnes).
 */
/**
 * À exécuter depuis l'éditeur Apps Script quand « Accès réservé » s'affiche : montre le compte qui exécute, le compte détecté
 * pour un visiteur et les domaines autorisés, avec la conduite à tenir.
 */
function diagnosticAcces() {
  var effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var lines = [
    'Compte qui exécute le script : ' + (effective || '(inconnu)'),
    'Compte détecté pour l’utilisateur courant : ' + (active || '(non identifié)'),
    'Domaines autorisés (PPM_DOMAIN) : ' + (allowedDomains().join(', ') || '(aucun : à renseigner)'),
    'Administrateurs (PPM_ADMINS) : ' + (adminEmails().join(', ') || '(aucun)'),
    'Ce compte serait ' + (isAllowedEmail_(active || effective) ? 'ACCEPTÉ.' : 'REFUSÉ : ' + accessDeniedMessage_(active || effective))
  ];
  var msg = lines.join('\n');
  console.log(msg);
  return msg;
}

function installerPpm() {
  var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var notes = [];
  if (!allowedDomain()) {
    if (!me || me.indexOf('@') < 0) throw new PpmError('CONFIG', 'Adresse du compte introuvable : renseigner PPM_DOMAIN et PPM_ADMINS à la main.');
    setProp(PROP.DOMAIN, me.split('@')[1]);
    notes.push('Domaine réglé sur ' + me.split('@')[1] + ' d’après le compte qui installe (' + me + '). Si les utilisateurs se connectent avec un autre domaine, ajoutez-le à la propriété PPM_DOMAIN, séparé par une virgule ; en cas de doute, exécutez diagnosticAcces.');
  }
  if (!adminEmails().length) {
    setProp(PROP.ADMINS, me);
    notes.push('Administrateur : ' + me + ' (propriété PPM_ADMINS ; ajoutez un second administrateur séparé par une virgule).');
  }
  var out = [setupPpm(), installTriggers(), selfCheck()];
  var msg = notes.concat(out).join('\n\n') + '\n\nÉtape suivante : Déployer > Nouveau déploiement > Application Web. Pour des données d’essai : exécuter seedDemo.';
  console.log(msg);
  return msg;
}

function setupPpm() {
  if (!allowedDomain()) throw new PpmError('CONFIG', 'Renseigner la propriété du script PPM_DOMAIN avant l’installation.');
  if (!adminEmails().length) throw new PpmError('CONFIG', 'Renseigner la propriété du script PPM_ADMINS avant l’installation.');

  var data = ensureBook_(PROP.DATA_ID, 'PPM Données');
  var history = ensureBook_(PROP.HISTORY_ID, 'PPM Historique');
  var report = [];

  Object.keys(SCHEMA).forEach(function (name) {
    var ss = SCHEMA[name].book === 'data' ? data : history;
    report.push(ensureSheet_(ss, name));
  });
  [data, history].forEach(removeDefaultSheet_);

  _tableCache = {};
  seedRoles_();
  var year = Number(todayStr().slice(0, 4));
  seedHolidays_([year - 1, year, year + 1, year + 2]);

  var msg = 'Installation terminée (PPM Core ' + PPM_VERSION + ')\n' +
    'Classeur Données : ' + data.getUrl() + '\n' +
    'Classeur Historique : ' + history.getUrl() + '\n' + report.join('\n');
  console.log(msg);
  return msg;
}

function ensureBook_(propKey, title) {
  var id = getProp(propKey, '');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create(title);
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  setProp(propKey, ss.getId());
  return ss;
}

function removeDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/** Crée la feuille ou ajoute les colonnes manquantes en fin de ligne (jamais de renommage). */
function ensureSheet_(ss, name) {
  var cols = tableColumns(name);
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }

  var existing = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var missing = cols.filter(function (c) { return existing.indexOf(c) < 0; });
  if (existing.length && existing[0] !== 'id') {
    throw new PpmError('CONFIG', 'La feuille ' + name + ' doit avoir « id » en colonne A.');
  }
  if (missing.length) {
    var start = existing.length + 1;
    if (sh.getMaxColumns() < start + missing.length - 1) {
      sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - 1 - sh.getMaxColumns());
    }
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var enums = SCHEMA[name].enums || {};
  var rows = Math.max(1, sh.getMaxRows() - 1);
  Object.keys(enums).forEach(function (c) {
    var idx = headers.indexOf(c);
    if (idx < 0) return;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(enums[c], true).setAllowInvalid(false).build();
    sh.getRange(2, idx + 1, rows, 1).setDataValidation(rule);
  });
  DATE_COLS.forEach(function (c) {
    var idx = headers.indexOf(c);
    if (idx >= 0) sh.getRange(2, idx + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  });
  return (created ? '+ ' : '  ') + name + (missing.length && !created ? ' (colonnes ajoutées : ' + missing.join(', ') + ')' : '');
}

var SETUP_ACTX = { actor: 'setup', source: 'setup' };

function seedRoles_() {
  var levels = { PL: 'program', DPL: 'program', CP: 'project', RWP: 'workpackage', MEMBER: 'project' };
  ROLES.forEach(function (code) {
    if (!repoGet('Role', code)) {
      repoInsert('Role', { id: code, code: code, label: ROLE_LABELS[code], scope_level: levels[code] }, SETUP_ACTX);
    }
  });
}

/** Charge (ou met à jour) les fériés calculés ; id déterministe PAYS-ANNÉE. */
function seedHolidays_(years) {
  COUNTRIES.forEach(function (country) {
    years.forEach(function (year) {
      var id = country + '-' + year;
      var list = holidaysFor(country, year);
      var values = {
        id: id, country: country, year: year,
        label: 'Fériés ' + country + ' ' + year + (country === 'IN' ? ' (nationaux, à compléter par site)' : ''),
        dates_json: JSON.stringify(list)
      };
      var existing = repoGet('HolidaySet', id);
      if (!existing) repoInsert('HolidaySet', values, SETUP_ACTX);
    });
  });
}

/** Fériés d'un pays sur plusieurs années, lus dans HolidaySet (modifiable par site). */
function loadHolidayMap(country) {
  var map = {};
  repoList('HolidaySet', function (h) { return h.country === country; }).forEach(function (h) {
    parseJsonSafe(h.dates_json, []).forEach(function (d) { map[typeof d === 'string' ? d : d.date] = true; });
  });
  return map;
}

/** Contrôle de l'installation : feuilles, en-têtes, propriétés. */
/** Liste des problèmes d'installation (vide = conforme) : sert à selfCheck et à la page Administration. */
function checkInstall_() {
  var problems = [];
  [PROP.DATA_ID, PROP.HISTORY_ID, PROP.DOMAIN, PROP.ADMINS].forEach(function (k) {
    if (!getProp(k, '')) problems.push('Propriété manquante : ' + k);
  });
  if (!problems.length) {
    Object.keys(SCHEMA).forEach(function (name) {
      try {
        var headers = getTable(name).headers();
        tableColumns(name).forEach(function (c) {
          if (headers.indexOf(c) < 0) problems.push(name + ' : colonne manquante ' + c);
        });
      } catch (e) {
        problems.push(name + ' : ' + e.message);
      }
    });
  }
  return problems.concat(checkPageVersions_());
}

function selfCheck() {
  var problems = checkInstall_();
  var msg = problems.length ? 'À corriger :\n- ' + problems.join('\n- ') : 'Installation conforme (PPM Core ' + PPM_VERSION + ').';
  console.log(msg);
  return msg;
}

/**
 * Chaque page annonce sa version (balise meta ppm-version) : une page oubliée lors d'une mise à jour
 * est repérée ici au lieu de provoquer des erreurs incompréhensibles.
 */
function checkPageVersions_() {
  if (typeof HtmlService === 'undefined') return [];
  var out = [];
  Object.keys(PAGES).forEach(function (view) {
    var name = PAGES[view];
    try {
      var html = HtmlService.createHtmlOutputFromFile(name).getContent();
      var m = /<meta name="ppm-version" content="([^"]+)">/.exec(html);
      if (!m) out.push('Page ' + name + ' : version inconnue (fichier d’une version antérieure ?)');
      else if (m[1] !== PPM_VERSION) out.push('Page ' + name + ' en version ' + m[1] + ', le Core en ' + PPM_VERSION + ' : recopier la page.');
    } catch (e) {
      out.push('Page ' + name + ' absente : créer le fichier HTML « ' + name + ' ».');
    }
  });
  return out;
}

/**
 * Jeu de démonstration : un programme, un projet pilote, deux WP, quatre livrables,
 * un jalon, des dépendances. Le compte qui l'exécute devient chef de projet du pilote.
 */
function seedDemo() {
  var me = String(Session.getActiveUser().getEmail() || adminEmails()[0]).toLowerCase();
  var a = { actor: me, source: 'setup' };
  var res = findResourceByEmail(me) || repoInsert('Resource', {
    resource_type: 'Interne', name: me.split('@')[0], email: me, country: 'FR', capacity_days_month: 18,
    job_function: 'Chef de projet', organization: 'Bureau d’études'
  }, a);
  var prog = repoInsert('Program', { code: 'DEMO', name: 'Programme de démonstration', status: 'Actif', leader_resource_id: res.id }, a);
  var proj = repoInsert('Project', {
    code: 'PILOTE', name: 'Projet pilote', program_id: prog.id, manager_resource_id: res.id,
    status: 'Actif', holiday_country: 'FR', start_date: todayStr()
  }, a);
  repoInsert('RoleAssignment', { resource_id: res.id, role_code: 'CP', scope_type: 'project', scope_id: proj.id }, a);
  // Deux personnes fictives (sans adresse : elles ne peuvent pas se connecter) pour que l'OBS et le WBS aient du contenu.
  var conceptrice = repoInsert('Resource', { resource_type: 'Interne', name: 'Camille Durand', country: 'FR',
    job_function: 'Ingénieure structure', organization: 'Bureau d’études' }, a);
  var testeur = repoInsert('Resource', { resource_type: 'Externe', name: 'Sam Weber', country: 'DE',
    job_function: 'Responsable essais', organization: 'Sous-traitant Alpha', supplier: 'Alpha Test GmbH' }, a);
  var wp1 = repoInsert('WorkPackage', { project_id: proj.id, wbs_code: '1', name: 'Conception', owner_resource_id: conceptrice.id, charge_code: 'PIL-001' }, a);
  var wp2 = repoInsert('WorkPackage', { project_id: proj.id, wbs_code: '2', name: 'Validation', owner_resource_id: testeur.id, charge_code: 'PIL-002' }, a);
  repoInsert('RoleAssignment', { resource_id: conceptrice.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp1.id }, a);
  repoInsert('RoleAssignment', { resource_id: testeur.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp2.id }, a);
  var hol = loadHolidayMap('FR');
  var d0 = nextWorkingDay(todayStr(), hol);
  function item(wp, name, startOffset, duration, type) {
    var start = addWorkingDays(d0, startOffset, hol);
    return repoInsert('PlanItem', {
      project_id: proj.id, wp_id: wp.id, item_type: type || 'Livrable', name: name, owner_resource_id: res.id,
      planned_start: start, planned_finish: type === 'Jalon' ? start : addWorkingDays(start, duration - 1, hol),
      progress_pct: 0, status: 'À faire', milestone_category: type === 'Jalon' ? 'Revue' : ''
    }, a);
  }
  var l1 = item(wp1, 'Spécification', 0, 10);
  var l2 = item(wp1, 'Maquette', 10, 15);
  var l3 = item(wp2, 'Plan de tests', 10, 5);
  var l4 = item(wp2, 'Rapport de tests', 25, 10);
  var j1 = item(wp2, 'Revue de conception', 35, 0, 'Jalon');
  [[l1, l2], [l1, l3], [l2, l4], [l3, l4], [l4, j1]].forEach(function (p) {
    repoInsert('Dependency', { predecessor_id: p[0].id, successor_id: p[1].id, dep_type: 'FS', lag_days: 0 }, a);
  });
  [l2, l4].forEach(function (l) { repoInsert('MilestoneRequirement', { milestone_id: j1.id, deliverable_id: l.id }, a); });
  var msg = 'Démo créée : projet ' + proj.code + ' (' + proj.id + ')';
  console.log(msg);
  return msg;
}

function findResourceByEmail(email) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  var found = repoList('Resource', function (r) { return String(r.email).toLowerCase() === email; });
  return found.length ? found[0] : null;
}
