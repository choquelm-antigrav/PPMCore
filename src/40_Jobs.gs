/**
 * PPM Core — traitements planifiés (section 3, mesures de conception).
 *
 * Chaque nuit : réconciliation du journal, contrôles du moteur de règles, synchronisation
 * Agenda et Drive, compléments depuis l'annuaire, sauvegarde des classeurs.
 * Chaque matin de semaine (7 h) : mail récapitulatif (36_Digest.gs). Chaque étape s'exécute par tranches de 5 minutes
 * au plus (plafond Apps Script : 6 min) ; l'état est gardé dans les propriétés
 * du script et une tranche suivante est programmée une minute plus tard.
 * Un seul déclencheur de reprise existe à la fois (plafond : 20 déclencheurs).
 */

var NIGHTLY_STEPS = ['reconcile', 'rules', 'workspace', 'directory', 'backup'];
var BACKUP_RETENTION_DAYS = 30;
var JOB_ACTX = { actor: 'ppm-core', source: 'core' };

/** À exécuter une fois après setupPpm() : traitement nocturne (2 h) et récapitulatif du matin (7 h). */
function installTriggers() {
  deleteTriggers_('warmCache');
  deleteTriggers_('nightlyRun');
  deleteTriggers_('continueNightly');
  deleteTriggers_('sendDigests');
  deleteTriggers_('newsCollectRun');
  ScriptApp.newTrigger('nightlyRun').timeBased().atHour(2).everyDays(1).create();
  ScriptApp.newTrigger('sendDigests').timeBased().atHour(7).everyDays(1).create();
  ScriptApp.newTrigger('newsCollectRun').timeBased().atHour(1).everyDays(1).create();
  ScriptApp.newTrigger('newsCollectRun').timeBased().atHour(13).everyDays(1).create();
  ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(5).create();
  return 'Déclencheurs installés : collecte des réunions à 1 h et à 13 h, traitement nocturne à 2 h, récapitulatif à 7 h (fuseau du script), cache gardé plein toutes les 5 minutes en semaine de 6 h à 21 h.';
}

// ---------------------------------------------------------------- cache gardé plein (facultatif)

/** Tables relues par le déclencheur : celles de toutes les pages, hors journaux volumineux (leur lecture reste à la demande). */
function warmTables_() {
  var seen = {}, out = [];
  Object.keys(PAGE_TABLES).forEach(function (v) {
    PAGE_TABLES[v].forEach(function (n) { if (!seen[n] && n !== 'ChangeEvent' && n !== 'AiLog') { seen[n] = true; out.push(n); } });
  });
  return out;
}

/** En semaine, de 6 h à 21 h (fuseau du script) : la nuit et le week-end, personne n'attend une page. */
function warmHours_(date) {
  var d = date || new Date(), hour, dow;
  if (typeof Utilities !== 'undefined' && typeof Session !== 'undefined' && Session.getScriptTimeZone) {
    var tz = Session.getScriptTimeZone();
    hour = Number(Utilities.formatDate(d, tz, 'H')); dow = Number(Utilities.formatDate(d, tz, 'u')); // 1 = lundi … 7 = dimanche
  } else { hour = d.getHours(); dow = d.getDay() === 0 ? 7 : d.getDay(); }
  return dow <= 5 && hour >= 6 && hour < 21;
}

/**
 * Relit les tables courantes dans les feuilles et les range dans le cache sous une NOUVELLE génération, en un seul appel d'écriture : la page suivante, même la première
 * après une pause, trouve un cache plein. Une lecture déjà en cours n'est pas perturbée (elle garde la génération qu'elle a lue).
 */
function refreshCache_() {
  resetExecution_();
  var cache = scriptCache_();
  if (!cache) return 'Pas de cache disponible.';
  var names = warmTables_(), t0 = nowMs();
  names.forEach(function (n) {
    var table = TABLE_PROVIDER ? TABLE_PROVIDER(n) : sheetTable_(n);
    _genSeen[n] = '';
    cachePutRows_(cache, n, JSON.stringify(table.readAll()));
  });
  flushCache_();
  return names.length + ' tables rangées dans le cache en ' + (nowMs() - t0) + ' ms.';
}

/** Déclencheur facultatif (A5_INSTALLER_DECLENCHEURS) : ne lève jamais d'erreur, pour ne pas déclencher les courriels d'échec de Google. */
function warmCache() {
  try {
    if (!warmHours_()) return 'Hors des heures de travail : rien à faire.';
    var r = refreshCache_();
    console.log('PPM warmCache : ' + r);
    return r;
  } catch (e) {
    console.error('PPM warmCache : ' + (e && e.message ? e.message : e));
    return 'Échec : ' + (e && e.message ? e.message : e);
  }
}

function deleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

function nightlyRun() {
  resetExecution_();
  invalidateAllTables_(); // la nuit repart de ce qui est réellement dans les feuilles
  try { sheetSync_(); } catch (e) { console.error('PPM partage du classeur : ' + (e && e.message ? e.message : e)); } // les personnes invitées dans la journée ont leur accès ; ceux qui sont partis le perdent
  setProp(PROP.JOB_STATE, JSON.stringify({ step: 0, startedAt: nowIso() }));
  continueNightly();
}

function continueNightly() {
  resetExecution_();
  if (typeof ScriptApp !== 'undefined') deleteTriggers_('continueNightly');
  var state = parseJsonSafe(getProp(PROP.JOB_STATE, ''), null);
  if (!state) return 'Aucun traitement en cours.';
  var deadline = nowMs() + JOB_SLICE_MS - 30000;
  try {
    state.times = state.times || {};
    while (state.step < NIGHTLY_STEPS.length) {
      var stepName = NIGHTLY_STEPS[state.step], t0 = nowMs();
      var done = runNightlyStep(stepName, state, deadline);
      state.times[stepName] = (state.times[stepName] || 0) + (nowMs() - t0);
      if (!done) {
        setProp(PROP.JOB_STATE, JSON.stringify(state));
        if (typeof ScriptApp !== 'undefined') {
          ScriptApp.newTrigger('continueNightly').timeBased().after(60 * 1000).create();
        }
        return 'Tranche terminée, reprise programmée (étape ' + NIGHTLY_STEPS[state.step] + ').';
      }
      state.step++;
      state.cursor = null;
    }
    recordNightly_(state, true, '', '');
    deleteProp(PROP.JOB_STATE);
    return 'Traitement nocturne terminé.';
  } catch (err) {
    recordNightly_(state, false, NIGHTLY_STEPS[state.step], err && err.message ? err.message : err);
    deleteProp(PROP.JOB_STATE);
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Échec du traitement nocturne', String(err && err.stack ? err.stack : err));
    });
    throw err;
  }
}

/** Garde le résultat du dernier traitement de nuit (affiché par la page Administration). */
function recordNightly_(state, ok, failedStep, error) {
  setProp(PROP.LAST_NIGHTLY, JSON.stringify({
    startedAt: state.startedAt || '', endedAt: nowIso(), ok: ok, failedStep: failedStep || '',
    error: error ? truncate(String(error), 300) : '',
    steps: NIGHTLY_STEPS.map(function (n) { return { name: n, ms: (state.times || {})[n] || 0 }; })
  }));
}

function runNightlyStep(name, state, deadline) {
  switch (name) {
    case 'reconcile':
      state.cursor = state.cursor || {};
      return reconcileAll(state.cursor, deadline);
    case 'rules':
      runRules();
      return true;
    case 'workspace':
      state.cursor = state.cursor || {};
      return syncWorkspaceAll(state.cursor, deadline);
    case 'directory':
      refreshPeopleFromDirectory();
      return true;
    case 'backup':
      if (typeof DriveApp !== 'undefined') backupBooks_();
      return true;
    default:
      return true;
  }
}

/** Exécute le moteur de règles et réécrit les Insights (les décisions « Accepté/Ignoré » sont conservées). */
function runRules() {
  var data = {
    projects: repoList('Project'),
    workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'),
    requirements: repoList('MilestoneRequirement'),
    risks: repoList('RiskOpportunity'),
    progressUpdates: repoList('ProgressUpdate', function (u) { return String(u.declared_at || u.created_at || '') >= addCalendarDays(todayStr(), -THRESHOLDS.staleProgressDays); })
  };
  var countryOf = {};
  data.projects.forEach(function (p) { countryOf[p.id] = p.holiday_country || 'FR'; });
  var holCache = {};
  var holFor = function (projectId) {
    var c = countryOf[projectId] || 'FR';
    if (!holCache[c]) holCache[c] = loadHolidayMap(c);
    return holCache[c];
  };
  addBaselineContext_(data, holFor);
  data.poFindings = poFindings_(poRuleInputs_(), todayStr());
  var fresh = evaluateRules(data, todayStr(), holFor);
  var merged = mergeInsights(repoList('Insight', null, { includeDeleted: true }), fresh, JOB_ACTX.actor);
  withLock(function () { getTable('Insight').replaceAll(merged); });
  return fresh.length;
}

/** Dates figées de la baseline active et chemin critique, pour la règle de glissement critique. */
function addBaselineContext_(data, holFor) {
  var active = {};
  data.projects.forEach(function (p) {
    if (!isTrue(p.deleted) && !isBlank(p.active_baseline_id) && p.status !== 'Clos') active[p.active_baseline_id] = p.id;
  });
  data.baselineFinish = {};
  data.critical = {};
  if (!Object.keys(active).length) return;
  repoList('BaselineItem', function (r) { return active[r.baseline_id] && r.entity_type === 'PlanItem'; }).forEach(function (r) {
    var s = parseJsonSafe(r.snapshot_json, {});
    if (!isBlank(s.planned_finish)) data.baselineFinish[r.entity_id] = s.planned_finish;
  });
  Object.keys(active).forEach(function (bid) {
    var pid = active[bid];
    var items = data.planitems.filter(function (i) { return i.project_id === pid && !isTrue(i.deleted); });
    var ids = {};
    items.forEach(function (i) { ids[i.id] = true; });
    var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; });
    computeFloats(items, deps, holFor).criticalIds.forEach(function (id) { data.critical[id] = true; });
  });
}

function backupBooks_() {
  var folderId = getProp(PROP.BACKUP_FOLDER, '');
  var folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.createFolder('PPM Sauvegardes');
    setProp(PROP.BACKUP_FOLDER, folder.getId());
  }
  var stamp = todayStr();
  [PROP.DATA_ID, PROP.HISTORY_ID].forEach(function (k) {
    var file = DriveApp.getFileById(getProp(k, ''));
    file.makeCopy(file.getName() + ' — ' + stamp, folder);
  });
  var limit = nowMs() - BACKUP_RETENTION_DAYS * DAY_MS;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < limit) f.setTrashed(true);
  }
}
