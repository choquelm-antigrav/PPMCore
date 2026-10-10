/**
 * PPM Core — A7_TESTER_DANS_APPS_SCRIPT : test de contrôle à lancer DANS Apps Script, avec les vrais services Google.
 *
 * Les tests de développement tournent hors de Google, avec de faux services : ils ne voient ni les droits réels, ni le fuseau horaire du
 * script, ni les services avancés, ni les temps de réponse réels. Ce test comble ces trous. Il est en LECTURE SEULE : il n'écrit
 * aucune ligne, ne crée aucun document, n'envoie aucun mail.
 *
 * Chaque contrôle rend OK, ATTENTION (à regarder, sans bloquer) ou ÉCHEC (à corriger). Le résultat est écrit dans le journal d'exécution.
 */

/** Contrôle : rend rien ou du texte (OK), { warn: '…' } (ATTENTION) ; une exception est un ÉCHEC. */
function liveSmokeTest_(opts) {
  opts = opts || {};
  var rows = [], t0 = nowMs();
  var step = function (name, fn) {
    var s = nowMs(), status = 'OK', detail = '';
    try {
      var r = fn();
      if (r && typeof r === 'object' && r.warn) { status = 'ATTENTION'; detail = r.warn; }
      else if (typeof r === 'string') detail = r;
    } catch (e) { status = 'ÉCHEC'; detail = String(e && e.message ? e.message : e).slice(0, 220); }
    rows.push({ name: name, status: status, detail: detail, ms: nowMs() - s });
  };
  var expect = function (cond, msg) { if (!cond) throw new Error(msg); };
  // présence des services : un typeof par nom (pas d'eval)
  var present = {
    SpreadsheetApp: typeof SpreadsheetApp !== 'undefined', PropertiesService: typeof PropertiesService !== 'undefined', LockService: typeof LockService !== 'undefined',
    ScriptApp: typeof ScriptApp !== 'undefined', HtmlService: typeof HtmlService !== 'undefined', Utilities: typeof Utilities !== 'undefined', Session: typeof Session !== 'undefined',
    MailApp: typeof MailApp !== 'undefined', CalendarApp: typeof CalendarApp !== 'undefined', DriveApp: typeof DriveApp !== 'undefined', DocumentApp: typeof DocumentApp !== 'undefined',
    Calendar: typeof Calendar !== 'undefined'
  };
  var has = function (name) { return !!present[name]; };

  // ---- 1. l'environnement d'exécution
  step('Moteur JavaScript (normalize, includes, assign, dates ISO)', function () {
    expect(typeof ''.normalize === 'function' && 'é'.normalize('NFD').length === 2, 'String.normalize indisponible : le moteur V8 n’est pas activé (manifeste : runtimeVersion)');
    expect([1].includes(1) && typeof Object.assign === 'function' && typeof Promise === 'function', 'fonctions du moteur manquantes');
    expect(Date.parse('2026-10-05T01:00:00.000Z') === 1791162000000, 'lecture d’une date ISO inattendue');
  });
  step('Services Google présents', function () {
    var need = ['SpreadsheetApp', 'PropertiesService', 'LockService', 'ScriptApp', 'HtmlService', 'Utilities', 'Session'];
    var opt = ['MailApp', 'CalendarApp', 'DriveApp', 'DocumentApp'];
    var miss = need.filter(function (n) { return !has(n); }), missOpt = opt.filter(function (n) { return !has(n); });
    var all = miss.concat(missOpt);
    if (all.length) return { warn: 'absents : ' + all.join(', ') + ' (normal hors Apps Script ; dans Apps Script, les contrôles suivants échoueraient)' };
  });
  step('Fuseau horaire du script et date du jour', function () {
    if (typeof Session.getScriptTimeZone !== 'function' || typeof Utilities.formatDate !== 'function') return { warn: 'non vérifiable ici' };
    var tz = Session.getScriptTimeZone(), local = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    if (local !== todayStr()) return { warn: 'le jour de l’outil (' + todayStr() + ') diffère du jour du fuseau ' + tz + ' (' + local + ') : surveiller les échéances et les rappels' };
    return 'fuseau ' + tz + ', aujourd’hui ' + todayStr();
  });

  // ---- 2. les calculs de dates et de textes dans le vrai moteur (changements d'heure compris)
  step('Calcul des dates autour des changements d’heure (mars et octobre)', function () {
    expect(addCalendarDays('2026-03-28', 1) === '2026-03-29' && addCalendarDays('2026-03-28', 2) === '2026-03-30', 'décalage faux le jour du passage à l’heure d’été');
    expect(addCalendarDays('2026-10-24', 2) === '2026-10-26' && addCalendarDays('2026-10-25', 1) === '2026-10-26', 'décalage faux le jour du passage à l’heure d’hiver');
    expect(addCalendarDays('2026-12-31', 1) === '2027-01-01' && addCalendarDays('2028-02-28', 1) === '2028-02-29', 'fin d’année ou année bissextile fausse');
  });
  step('Lecture d’un compte rendu (dates, actions, noms, accents)', function () {
    var d = newsFindDate_('Envoyer le plan pour le 30/10', '2026-10-05');
    expect(d.date === '2026-10-30' && d.text === 'Envoyer le plan', 'date ou texte mal lus : ' + JSON.stringify(d));
    expect(newsFindDate_('le 31/02', '2026-10-05').date === '', 'une date impossible est acceptée');
    var people = { members: [{ id: 'r1', name: 'Carla Weber' }], all: [{ id: 'r1', name: 'Carla Weber' }] };
    var n = newsParseNotes_('Résumé\nRevue.\n\nDécisions\n- Go\n\nÉtapes suivantes\n- [Carla] Envoyer le planning : avant le 30/10', '2026-10-05', people);
    expect(n.decisions.length === 1 && n.actions.length === 1 && n.actions[0].owner_resource_id === 'r1' && n.actions[0].due === '2026-10-30', 'notes mal lues : ' + JSON.stringify(n));
    expect(newsMatchProject_({ title: 'Revue NACÉLLE', attendees: [] }, [{ id: 'A', keywords: ['nacelle'], members: {} }]).projectId === 'A', 'repère non reconnu sans tenir compte des accents et de la casse');
  });
  step('Registre des pages et fonctions du Core', function () {
    expect(typeof PPM_PAGES === 'object' && PPM_PAGES.length >= 10 && Object.keys(PAGES).length === PPM_PAGES.length, 'registre des pages absent ou incohérent avec ses tables');
    expect(typeof computeBalance_ === 'function' && typeof defineAction === 'function' && typeof handleRequest === 'function', 'fonctions du Core manquantes : le fichier PPM_Core.gs est-il complet ?');
    return PPM_PAGES.length + ' pages';
  });

  // ---- 3. l'installation réelle
  var me = '';
  step('Compte qui exécute le test', function () {
    me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    expect(!!me, 'adresse du compte illisible : exécuter avec un compte du domaine, pas depuis un compte de service');
    return me + (adminEmails().indexOf(me) >= 0 ? ' (administrateur)' : '') + (isAllowedEmail_(me) ? '' : ' — domaine non autorisé');
  });
  step('Installation (propriétés, feuilles, colonnes, pages)', function () {
    var p = checkInstall_();
    expect(!p.length, p.slice(0, 5).join(' | ') + (p.length > 5 ? ' | … (' + p.length + ' en tout)' : ''));
  });
  step('Version du Core et des pages', function () { return 'PPM Core ' + PPM_VERSION; });
  step('Autorisation de lire et d’écrire des Google Docs (0.12.0)', function () {
    if (!has('ScriptApp') || !ScriptApp.getAuthorizationInfo) return { warn: 'non vérifiable ici' };
    var st = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus();
    if (st !== ScriptApp.AuthorizationStatus.NOT_REQUIRED) return { warn: 'une autorisation reste à accorder : exécuter A1_INSTALLER_PPM et accepter' };
  });
  step('Déclencheurs (nuit, récapitulatif, collecte des réunions)', function () {
    if (!has('ScriptApp')) return { warn: 'non vérifiable ici' };
    var h = {}; ScriptApp.getProjectTriggers().forEach(function (t) { h[t.getHandlerFunction()] = (h[t.getHandlerFunction()] || 0) + 1; });
    var miss = [];
    if (!h.nightlyRun) miss.push('nightlyRun'); if (!h.sendDigests) miss.push('sendDigests'); if ((h.newsCollectRun || 0) < 2) miss.push('newsCollectRun (1 h et 13 h)');
    if (miss.length) return { warn: 'à poser : ' + miss.join(', ') + ' — exécuter A5_INSTALLER_DECLENCHEURS' };
    return 'nightlyRun ' + h.nightlyRun + ', sendDigests ' + h.sendDigests + ', newsCollectRun ' + h.newsCollectRun;
  });
  step('Agenda : lecture réelle de l’agenda principal (service avancé Calendar)', function () {
    if (!has('Calendar') || !Calendar.Events) return { warn: 'service avancé Calendar non activé : la collecte des réunions et les rappels sont impossibles' };
    var now = nowMs(), r = Calendar.Events.list('primary', { timeMin: new Date(now - 3600000).toISOString(), timeMax: new Date(now).toISOString(), maxResults: 1, singleEvents: true });
    expect(r && Object.prototype.hasOwnProperty.call(r, 'items'), 'réponse de l’agenda inattendue');
    return 'lecture autorisée';
  });
  step('Appels externes : Google atteignable (clé Gemini, 0.13.0)', function () {
    if (typeof UrlFetchApp === 'undefined' && !AI_FETCH) return { warn: 'non vérifiable ici' };
    var r = aiFetch_(GEMINI_BASE + '/models?pageSize=1', { method: 'get' }); // sans clé : Google doit répondre « clé manquante », ce qui prouve le droit et le réseau
    expect(r && r.code > 0 && r.code < 500, 'Google a répondu ' + (r && r.code));
    return 'Google répond (' + r.code + ', normal sans clé)';
  });
  step('Démo : contenu des projets NAC (si elle a été créée)', function () {
    if (!repoList('Program', function (p) { return p.code === 'NAC'; }).length) return 'aucune démo NAC dans ce classeur';
    var pending = getProp(PROP.DEMO_STEP, '');
    if (pending) return { warn: 'démo INTERROMPUE : ' + pending + ' étape(s) sur ' + DEMO_STEPS.length + ' faites ; relancez A2_SEED_DEMO jusqu’à « Démo complète »' };
    var v = demoVerify_();
    if (!v.ok) return { warn: 'démo incomplète (' + v.text + ') : exécutez A6_EFFACER_DEMO deux fois puis A2_SEED_DEMO' };
    return v.text;
  });
  step('Mails : quota du jour', function () {
    if (!has('MailApp') || !MailApp.getRemainingDailyQuota) return { warn: 'non vérifiable ici' };
    var q = MailApp.getRemainingDailyQuota();
    if (q < 50) return { warn: 'seulement ' + q + ' mails restants aujourd’hui' };
    return q + ' mails restants aujourd’hui';
  });

  // ---- 4. les appels de chaque page, avec ce compte, en lecture seule, chronométrés
  var call = function (action, params) {
    var s = nowMs(), r = handleRequest({ action: action, params: params || {}, apiVersion: PPM_API_VERSION }, me);
    var ms = nowMs() - s;
    if (!r.ok) {
      if (r.error && r.error.code === 'FORBIDDEN') return { data: null, ms: ms, forbidden: true };
      throw new Error(action + ' : ' + (r.error ? r.error.code + ' ' + String(r.error.message).slice(0, 120) : 'réponse vide'));
    }
    return { data: r.data, ms: ms };
  };
  var slow = function (label, ms) { return ms > 6000 ? { warn: label + ' lent : ' + ms + ' ms' } : label + ' : ' + ms + ' ms'; };
  var proj = null;
  step('Appel serveur : catalogue des projets', function () {
    var r = call('planning.catalog'); expect(r.data && Array.isArray(r.data.projects), 'catalogue illisible');
    proj = r.data.projects.filter(function (p) { return p.status !== 'Clos'; })[0] || r.data.projects[0] || null;
    var s = slow(r.data.projects.length + ' projet(s)', r.ms);
    return s;
  });
  if (proj) {
    [['Overview', 'overview.get', { projectId: proj.id }], ['OBS (rôles)', 'obs.tree', { scopeType: 'project', scopeId: proj.id }], ['WBS', 'wbs.tree', { projectId: proj.id }],
      ['Ressources', 'ressources.get', { projectId: proj.id }], ['Suivi (baselines)', 'baselines.list', { projectId: proj.id }], ['Suivi (changements)', 'changes.feed', { projectId: proj.id }],
      ['Budget (bilan)', 'budget.balance', { projectId: proj.id }], ['Actualités', 'news.get', { projectId: proj.id }]].forEach(function (c) {
      step('Appel serveur : ' + c[0] + ' (' + proj.code + ')', function () {
        var r = call(c[1], c[2]);
        if (r.forbidden) return 'accès refusé à ce compte (normal selon son rôle) : ' + r.ms + ' ms';
        return slow('réponse', r.ms);
      });
    });
  }
  step('Appel serveur : planning du projet (Gantt)', function () {
    if (!proj) return { warn: 'aucun projet : créer le projet ou lancer A2_SEED_DEMO' };
    var r = call('gantt.project', { projectId: proj.id });
    if (r.forbidden) return 'accès refusé à ce compte (normal selon son rôle)';
    return slow('réponse', r.ms);
  });
  return finish_();

  function finish_() {
    var counts = { OK: 0, ATTENTION: 0, 'ÉCHEC': 0 };
    rows.forEach(function (r) { counts[r.status]++; });
    return { rows: rows, counts: counts, ms: nowMs() - t0 };
  }
}

function liveSmokeReport_(res) {
  var icon = { OK: '✓', ATTENTION: '⚠', 'ÉCHEC': '✗' };
  var lines = res.rows.map(function (r) { return icon[r.status] + ' ' + r.status + ' · ' + r.name + (r.detail ? ' — ' + r.detail : '') + ' (' + r.ms + ' ms)'; });
  var head = 'A7 — PPM Core ' + PPM_VERSION + ' : ' + res.counts.OK + ' OK, ' + res.counts.ATTENTION + ' attention, ' + res.counts['ÉCHEC'] + ' échec en ' + Math.round(res.ms / 100) / 10 + ' s (lecture seule, rien n’a été écrit).';
  return head + '\n' + lines.join('\n');
}

function testerDansAppsScript_() {
  var rep = liveSmokeReport_(liveSmokeTest_());
  console.log(rep);
  return rep;
}

/**
 * A8_VERIFIER_ECRITURE : le SEUL test qui écrit. Dans une feuille TEMPORAIRE du classeur Données (supprimée à la fin, même en cas d'erreur),
 * il écrit des textes à risque (codes « 1.1 », « 2.10 », « =1+1 », « TRUE »…) avec la vraie couche d'écriture de l'outil, les relit, et compare.
 * Il prouve avec le vrai Google Sheets que les textes restent des textes. Aucune donnée réelle n'est touchée.
 */
function verifierEcriture_() {
  var book = openBook_('data'), name = '_ppm_test_ecriture', rows = [];
  var leftover = book.getSheetByName(name);
  if (leftover) book.deleteSheet(leftover);
  var sh = book.insertSheet(name), bad = 0;
  try {
    var headers = tableColumns('WorkPackage');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    var t = sheetTableOn_('WorkPackage', sh);
    var cases = ['1', '1.1', '2.10', '1.10', '10', '0012', '=1+1', '=IMPORTXML("http://exemple.test")', '+5', '-x', '@a', 'TRUE', 'false', '10%', '.5', '2026-10-05', '2026-11', '1/2', '12:30', '1e3',
      "'déjà", "l'apostrophe", 'texte normal', 'é€😀', 'deux\nlignes'];
    cases.forEach(function (v, i) { t.appendRows([{ id: 'essai' + i, project_id: 'p', wbs_code: v, name: v, charge_code: v, cpn: v }]); });
    var back = t.readAll();
    cases.forEach(function (v, i) {
      var r = back.filter(function (x) { return x.id === 'essai' + i; })[0] || {};
      var same = r.wbs_code === v && r.name === v && r.charge_code === v && r.cpn === v;
      if (!same) bad++;
      rows.push((same ? '✓ ' : '✗ ') + JSON.stringify(v) + (same ? '' : ' relu ' + JSON.stringify(r.wbs_code) + ' (' + typeof r.wbs_code + ')'));
    });
    var distinct = {}; back.forEach(function (r) { distinct[r.wbs_code] = true; });
    if (Object.keys(distinct).length !== cases.length) { bad++; rows.push('✗ des codes distincts se sont confondus à la relecture'); }
    // une cellule déjà devenue nombre (écrite avant la protection) doit être relue comme du texte
    sh.getRange(2 + cases.length, 1, 1, 1).setValues([['ancien']]);
    sh.getRange(2 + cases.length, headers.indexOf('wbs_code') + 1, 1, 1).setValues([[1.1]]);
    var old = t.readAll().filter(function (x) { return x.id === 'ancien'; })[0] || {};
    var oldOk = old.wbs_code === '1.1';
    if (!oldOk) bad++;
    rows.push((oldOk ? '✓ ' : '✗ ') + 'ancienne cellule numérique 1,1 relue comme texte « 1.1 »' + (oldOk ? '' : ' : ' + JSON.stringify(old.wbs_code)));
    // une colonne réelle au format « texte brut » conserverait l'apostrophe : on le signale
    var real = openBook_('data').getSheetByName('WorkPackage'), warn = '';
    if (real && typeof real.getRange(2, 1).getNumberFormat === 'function') {
      var idx = tableColumns('WorkPackage').indexOf('wbs_code');
      if (idx >= 0 && real.getRange(2, idx + 1).getNumberFormat() === '@') warn = ' ⚠ La colonne wbs_code de la feuille WorkPackage est au format « Texte brut » : l’apostrophe y serait conservée. Remettez le format « Automatique ».';
    }
  } finally {
    book.deleteSheet(sh);
  }
  var head = 'A8 — écriture dans Google Sheets (feuille temporaire, supprimée) : ' + (bad ? 'ÉCHEC, ' + bad + ' cas altéré(s)' : 'OK, ' + (rows.length) + ' contrôles, aucun cas altéré') + '.' + (typeof warn === 'string' ? warn : '');
  return head + '\n' + rows.join('\n');
}

function verifierEcritureAvecJournal_() { var r = verifierEcriture_(); console.log(r); return r; }
