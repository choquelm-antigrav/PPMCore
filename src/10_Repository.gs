/**
 * PPM Core — accès aux données.
 *
 * Un « adaptateur de table » cache Sheets derrière une interface simple :
 *   headers(), readAll(), findRow(id) → n° de ligne (≥ 2) ou -1,
 *   readRow(n), writeRow(n, obj), appendRows(objs), replaceAll(objs)
 * Les tests remplacent l'adaptateur par une version en mémoire (TABLE_PROVIDER).
 *
 * Toute écriture du Core passe par repoInsert / repoUpdate : verrou, version
 * (verrouillage optimiste), champs calculés, contrôle, journal et crochets métier.
 */

var TABLE_PROVIDER = null;
var _tableCache = {};
var _bookCache = {};

function getTable(name) {
  return cachedTable_(name, function () {
    if (TABLE_PROVIDER) return TABLE_PROVIDER(name);
    if (!_tableCache[name]) _tableCache[name] = sheetTable_(name);
    return _tableCache[name];
  });
}

// ---------------------------------------------------------------- cache des lectures (performance)
//
// Lire une table dans Sheets coûte 2 à 3 appels au serveur (0,1 à 0,3 s chacun). Deux niveaux évitent de relire :
//   - mémoire de l'exécution : une table n'est lue qu'une fois par requête ;
//   - cache du script (CacheService), partagé entre requêtes : la table y est rangée par morceaux, sous un
//     numéro de génération. Toute écriture par le Core change la génération (la table sera relue) ;
//     une saisie AppSheet fait de même via onRowChanged. Par sécurité, rien n'y reste plus de 5 minutes.
// Les lectures ponctuelles (findRow, readRow) vont toujours dans Sheets.

var CACHE_PROVIDER = null;      // tests : faux cache { get, getAll, put, putAll }
var CACHE_TTL_S = 300;
var CACHE_CHUNK = 90000;        // un élément du cache est limité à 100 Ko
var CACHE_MAX_CHUNKS = 20;      // au-delà (~1,8 Mo), la table n'est pas mise en cache
var _rowsMemo = {};

function scriptCache_() {
  if (CACHE_PROVIDER) return CACHE_PROVIDER;
  if (TABLE_PROVIDER || typeof CacheService === 'undefined') return null;
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

/** Début d'une exécution (requête, page, déclencheur) : on oublie ce qui a été lu par la précédente. */
function resetExecution_() {
  _rowsMemo = {};
  _propsMemo = null;
}

function cachedTable_(name, base) {
  var touched = function () { invalidateTable_(name); };
  return {
    name: name,
    headers: function () { return base().headers(); },
    readAll: function () { return readAllCached_(name, base); },
    findRow: function (id) { return base().findRow(id); },
    readRow: function (n) { return base().readRow(n); },
    writeRow: function (n, o) { base().writeRow(n, o); touched(); },
    appendRows: function (objs) { base().appendRows(objs); touched(); },
    updateRows: function (list) { base().updateRows(list); touched(); },
    replaceAll: function (objs) { base().replaceAll(objs); touched(); },
    get _rows() { return base()._rows; } // tests : accès direct aux lignes en mémoire
  };
}

function newGen_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readAllCached_(name, base) {
  // Tests sans faux cache : lecture directe (ils modifient parfois les lignes en mémoire sans passer par le Core).
  if (TABLE_PROVIDER && !CACHE_PROVIDER) return base().readAll();
  if (_rowsMemo[name] !== undefined) return JSON.parse(_rowsMemo[name]);
  var cache = scriptCache_();
  var json = cache ? cacheGetRows_(cache, name) : null;
  if (json === null) {
    json = JSON.stringify(base().readAll());
    if (cache) cachePutRows_(cache, name, json);
  }
  _rowsMemo[name] = json;
  return JSON.parse(json);
}

/** Valeur « génération|nombre de morceaux » ; nombre -1 = table à relire. */
function parseGen_(v) {
  if (!v) return null;
  var i = String(v).lastIndexOf('|');
  return { gen: String(v).slice(0, i), n: Number(String(v).slice(i + 1)) };
}

function chunkKeys_(name, gen, n) {
  var keys = [];
  for (var i = 0; i < n; i++) keys.push('rows:' + name + ':' + gen + ':' + i);
  return keys;
}

function cacheGetRows_(cache, name) {
  try {
    var g = parseGen_(cache.get('gen:' + name));
    if (!g || !(g.n > 0)) return null;
    var keys = chunkKeys_(name, g.gen, g.n);
    var parts = cache.getAll(keys);
    var out = '';
    for (var i = 0; i < keys.length; i++) {
      if (parts[keys[i]] === undefined || parts[keys[i]] === null) return null;
      out += parts[keys[i]];
    }
    return out;
  } catch (e) {
    return null;
  }
}

function cachePutRows_(cache, name, json) {
  try {
    var n = Math.max(1, Math.ceil(json.length / CACHE_CHUNK));
    if (n > CACHE_MAX_CHUNKS) return;
    var g = parseGen_(cache.get('gen:' + name));
    var gen = g ? g.gen : newGen_();
    var values = {};
    chunkKeys_(name, gen, n).forEach(function (k, i) { values[k] = json.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK); });
    cache.putAll(values, CACHE_TTL_S);
    cache.put('gen:' + name, gen + '|' + n, CACHE_TTL_S);
  } catch (e) {
    /* le cache est une optimisation : une panne ne doit jamais bloquer une lecture */
  }
}

/** Après une écriture : la table sera relue dans Sheets, par cette exécution comme par les suivantes. */
function invalidateTable_(name) {
  delete _rowsMemo[name];
  var cache = scriptCache_();
  if (!cache) return;
  try { cache.put('gen:' + name, newGen_() + '|-1', CACHE_TTL_S); } catch (e) { /* voir cachePutRows_ */ }
}

/** Invalide toutes les tables (réconciliation nocturne, restauration, installation). */
function invalidateAllTables_() {
  Object.keys(SCHEMA).forEach(invalidateTable_);
}

/**
 * Remplit la mémoire de l'exécution avec les tables déjà en cache, en deux appels au lieu de deux par table.
 * Les tables absentes du cache seront lues dans Sheets au premier usage.
 */
function prefetchTables_(names) {
  var cache = scriptCache_();
  if (!cache) return;
  try {
    var todo = names.filter(function (n) { return _rowsMemo[n] === undefined && SCHEMA[n]; });
    if (!todo.length) return;
    var gens = cache.getAll(todo.map(function (n) { return 'gen:' + n; }));
    var want = {}, keys = [];
    todo.forEach(function (n) {
      var g = parseGen_(gens['gen:' + n]);
      if (!g || !(g.n > 0)) return;
      want[n] = chunkKeys_(n, g.gen, g.n);
      keys = keys.concat(want[n]);
    });
    if (!keys.length) return;
    var parts = cache.getAll(keys);
    Object.keys(want).forEach(function (n) {
      var out = '';
      for (var i = 0; i < want[n].length; i++) {
        var v = parts[want[n][i]];
        if (v === undefined || v === null) return;
        out += v;
      }
      _rowsMemo[n] = out;
    });
  } catch (e) {
    /* voir cachePutRows_ */
  }
}

/** Tables lues par presque toutes les requêtes des pages. */
var HOT_TABLES = ['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'Resource', 'RoleAssignment',
  'HierarchicalTeam', 'HolidaySet', 'UserSetting', 'Baseline', 'Insight', 'MilestoneRequirement', 'RiskOpportunity',
  'Role', 'BudgetLine', 'BaselineItem'];

function bookId_(book) {
  var id = getProp(book === 'data' ? PROP.DATA_ID : PROP.HISTORY_ID, '');
  if (!id) throw new PpmError('CONFIG', 'Classeurs non initialisés : exécuter setupPpm().');
  return id;
}

function openBook_(book) {
  if (!_bookCache[book]) _bookCache[book] = SpreadsheetApp.openById(bookId_(book));
  return _bookCache[book];
}

/**
 * Colonnes dont Google Sheets doit INTERPRÉTER la saisie : nombres, booléens, dates et horodatages. Toutes les autres sont du TEXTE.
 * Sheets traite ce que setValues écrit comme une saisie au clavier : « 1 » devient le nombre 1, « 1.1 » le nombre 1,1, « 2.10 » le nombre 2,1
 * (« 2.10 » et « 2.1 » se confondent), « TRUE » un booléen, « 2026-11 » une date, et « =… » une FORMULE exécutée (injection). Pour les colonnes de
 * texte, un texte à risque est donc écrit avec une apostrophe au début, que Sheets n'enregistre pas ; à la lecture, un nombre trouvé dans une
 * colonne de texte (cellule écrite avant cette protection) redevient du texte.
 */
var SHEET_PARSED_COLS = {};
['ac', 'amount', 'bac', 'capacity_days_month', 'cpi', 'daily_rate', 'days', 'eac', 'ev', 'financial_value', 'fixed_amount', 'frozen_rate', 'impact', 'lag_days', 'number',
  'planned_amount', 'planned_days', 'probability', 'progress_pct', 'pv', 'reminder_days', 'score', 'spi', 'version', 'year', 'deleted', 'acknowledged', 'enabled',
  'is_external', 'news_on', 'reminder_off', 'unverified', 'status_date', 'at'].concat(DATE_COLS).forEach(function (c) { SHEET_PARSED_COLS[c] = true; });

function sheetParsedCol_(h) { return !!SHEET_PARSED_COLS[h] || /_at$/.test(h) || /_on$/.test(h); }

/** Un texte que Sheets risque d'interpréter : formule, signe, chiffre ou point au début, booléen, ou apostrophe déjà là. */
function sheetNeedsQuote_(v) { return /^[=+\-@'.\d]/.test(v) || /^(true|false)$/i.test(v); }

function sheetTable_(name) {
  var def = SCHEMA[name];
  if (!def) throw new PpmError('NOT_FOUND', 'Table inconnue : ' + name);
  var sh = openBook_(def.book).getSheetByName(name);
  if (!sh) throw new PpmError('CONFIG', 'Feuille manquante : ' + name + ' (relancer setupPpm).');
  return sheetTableOn_(name, sh);
}

/** La table d'un schéma sur une feuille donnée (A8_VERIFIER_ECRITURE l'emploie sur une feuille temporaire). */
function sheetTableOn_(name, sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var isText = headers.map(function (h) { return !sheetParsedCol_(h); });

  function toObj(row) {
    var o = {};
    headers.forEach(function (h, i) {
      var v = normalizeValue(row[i]);
      if (isText[i]) { if (typeof v === 'number') v = String(v); else if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE'; }
      o[h] = v;
    });
    return o;
  }
  function toRow(obj) {
    return headers.map(function (h, i) {
      var v = obj[h];
      if (v === undefined || v === null) return '';
      return isText[i] && typeof v === 'string' && sheetNeedsQuote_(v) ? "'" + v : v;
    });
  }
  function dataRows() { return Math.max(0, sh.getLastRow() - 1); }

  return {
    name: name,
    headers: function () { return headers.slice(); },
    readAll: function () {
      var n = dataRows();
      if (n === 0) return [];
      return sh.getRange(2, 1, n, headers.length).getValues().map(toObj);
    },
    findRow: function (id) {
      if (isBlank(id) || dataRows() === 0) return -1;
      var cell = sh.getRange(2, 1, dataRows(), 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
      return cell ? cell.getRow() : -1;
    },
    readRow: function (r) { return toObj(sh.getRange(r, 1, 1, headers.length).getValues()[0]); },
    writeRow: function (r, obj) { sh.getRange(r, 1, 1, headers.length).setValues([toRow(obj)]); },
    appendRows: function (objs) {
      if (!objs.length) return;
      sh.getRange(sh.getLastRow() + 1, 1, objs.length, headers.length).setValues(objs.map(toRow));
    },
    /** Réécrit plusieurs lignes ; les lignes consécutives partent en une seule écriture. */
    updateRows: function (list) {
      var sorted = list.slice().sort(function (a, b) { return a.row - b.row; });
      var i = 0;
      while (i < sorted.length) {
        var j = i;
        while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++;
        var chunk = sorted.slice(i, j + 1);
        sh.getRange(chunk[0].row, 1, chunk.length, headers.length).setValues(chunk.map(function (c) { return toRow(c.obj); }));
        i = j + 1;
      }
    },
    replaceAll: function (objs) {
      var n = dataRows();
      if (n > 0) sh.getRange(2, 1, n, headers.length).clearContent();
      if (objs.length) sh.getRange(2, 1, objs.length, headers.length).setValues(objs.map(toRow));
    }
  };
}

/** Verrou de script ré-entrant : une seule écriture à la fois, sans auto-blocage. */
var _lockDepth = 0;
function withLock(fn) {
  if (_lockDepth > 0 || TABLE_PROVIDER || typeof LockService === 'undefined') {
    _lockDepth++;
    try { return fn(); } finally { _lockDepth--; }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new PpmError('BUSY', 'Le système est occupé, réessayez dans un instant.');
  _lockDepth++;
  try { return fn(); } finally { _lockDepth--; lock.releaseLock(); }
}

// ---------------------------------------------------------------- lecture

function repoGet(table, id) {
  if (_rowsMemo[table] !== undefined && !isBlank(id)) {
    var hit = JSON.parse(_rowsMemo[table]).filter(function (r) { return String(r.id) === String(id); })[0];
    if (hit) return hit;
  }
  var t = getTable(table);
  var r = t.findRow(id);
  return r < 0 ? null : t.readRow(r);
}

function repoList(table, filter, opts) {
  var rows = getTable(table).readAll();
  if (isLiveTable(table) && !(opts && opts.includeDeleted)) {
    rows = rows.filter(function (r) { return !isTrue(r.deleted); });
  }
  return filter ? rows.filter(filter) : rows;
}

// ---------------------------------------------------------------- écriture

/** actx : { actor: e-mail, source: 'api' | 'appsheet' | 'core' | 'setup' | 'addon:<id>' } */
function repoInsert(table, values, actx) {
  return withLock(function () {
    var def = SCHEMA[table];
    if (!def) throw new PpmError('NOT_FOUND', 'Table inconnue : ' + table);
    var rec = {};
    tableColumns(table).forEach(function (c) { rec[c] = ''; });
    Object.keys(values || {}).forEach(function (k) {
      if (def.cols.indexOf(k) >= 0) rec[k] = values[k] === null || values[k] === undefined ? '' : values[k];
    });
    if (isBlank(rec.id)) rec.id = newId();
    applyComputed(table, rec);
    validateRecord(table, rec);
    var t = getTable(table);
    if (t.findRow(rec.id) >= 0) throw new PpmError('CONFLICT', 'Identifiant déjà utilisé : ' + rec.id);
    if (isLiveTable(table)) {
      var now = nowIso();
      rec.created_at = now; rec.created_by = actx.actor;
      rec.updated_at = now; rec.updated_by = actx.actor;
      rec.version = 1; rec.deleted = false;
    }
    t.appendRows([rec]);
    if (isLoggedTable(table)) recordChanges(table, null, rec, actx);
    if (isLiveTable(table)) runHooks(table, null, rec, actx);
    return rec;
  });
}

/**
 * Mise à jour partielle. expectedVersion (facultatif) protège contre l'écrasement
 * d'une modification concurrente : si la ligne a changé depuis la lecture → CONFLICT.
 */
function repoUpdate(table, id, patch, expectedVersion, actx) {
  return withLock(function () {
    var def = SCHEMA[table];
    if (!isLiveTable(table)) throw new PpmError('VALIDATION', 'Table en ajout seul : ' + table);
    var t = getTable(table);
    var r = t.findRow(id);
    if (r < 0) throw new PpmError('NOT_FOUND', table + ' introuvable : ' + id);
    var before = t.readRow(r);
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '' &&
        Number(expectedVersion) !== Number(before.version)) {
      throw new PpmError('CONFLICT', 'La ligne a été modifiée entre-temps.', { currentVersion: Number(before.version) });
    }
    var after = Object.assign({}, before);
    var writable = def.cols.concat(['deleted']);
    Object.keys(patch || {}).forEach(function (k) {
      if (k !== 'id' && writable.indexOf(k) >= 0) after[k] = patch[k] === null || patch[k] === undefined ? '' : patch[k];
    });
    applyComputed(table, after);
    validateRecord(table, after);
    if (!diffRecords(before, after, businessFields(table)).length) return before;
    after.version = Number(before.version || 0) + 1;
    after.updated_at = nowIso();
    after.updated_by = actx.actor;
    t.writeRow(r, after);
    if (isLoggedTable(table)) recordChanges(table, before, after, actx);
    runHooks(table, before, after, actx);
    return after;
  });
}

function repoSoftDelete(table, id, expectedVersion, actx) {
  return repoUpdate(table, id, { deleted: true }, expectedVersion, actx);
}

/** Ajout en lot dans une table d'historique (sans contrôle ligne à ligne). */
function repoAppendHistory(table, recs) {
  if (isLiveTable(table)) throw new PpmError('VALIDATION', 'Table vivante : utiliser repoInsert.');
  if (recs.length) getTable(table).appendRows(recs);
}
