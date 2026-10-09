/**
 * PPM Core — rendu des pages web : tables déduites du registre (00_Pages.gs), préchargement des données du premier écran,
 * assemblage d'une page (renderPage_), inclusion des parties communes. Les vues du planning restent dans 32_Views.gs.
 */

// ---------------------------------------------------------------- page web

/** Appel depuis la page (google.script.run) : mêmes contrôles que l'API JSON. */
function uiCall(action, params, requestId) {
  return handleRequest({ action: action, params: params || {}, apiVersion: PPM_API_VERSION, requestId: requestId || null },
    currentUserEmail_());
}

/** Tables déduites du registre des pages (00_Pages.gs) : ne pas les écrire à la main. */
var PAGES = {}, PAGE_TITLES = {}, PAGE_TABS = {};
PPM_PAGES.forEach(function (p) { PAGES[p.view] = p.file; PAGE_TITLES[p.view] = p.title; PAGE_TABS[p.view] = p.tabs; });

/** JSON à clés triées : la page et le serveur calculent la même clé pour les mêmes paramètres. */
function stableJson_(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson_).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJson_(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Données du premier écran, calculées pendant la construction de la page : la page s'affiche sans
 * attendre d'autres allers-retours. Clé = action + paramètres, exactement ceux que la page enverra.
 * Chaque réponse garde la forme de l'API ({ ok, data } ou { ok: false, error }).
 */
function preloadFor_(view, boot, email) {
  var pre = {};
  var put = function (action, params) {
    var res = handleRequest({ action: action, params: params, apiVersion: PPM_API_VERSION }, email, { keepMemo: true });
    pre[action + '|' + stableJson_(params)] = res;
    return res;
  };
  if (view === 'compte') { put('account.get', {}); return pre; }
  if (view === 'copilote') { put('copilot.key.status', {}); return pre; } // la page ne parle que de la clé de la personne : ni catalogue ni projet
  if (view === 'overview') { put('overview.get', { projectId: boot.project || '' }); return pre; }
  if (view === 'admin') { if (boot.isAdmin) { put('admin.get', {}); put('admin.health', {}); put('admin.holidays', {}); put('admin.logs', {}); } return pre; }
  if (view === 'budget') {
    var bcat = put('planning.catalog', {});
    var bfirst = boot.project || (bcat.ok ? ((bcat.data.projects.filter(function (x) { return x.status !== 'Clos'; })[0] || bcat.data.projects[0] || {}).id || '') : '');
    if (bfirst) {
      var acc = put('budget.access', { projectId: bfirst });
      if (acc.ok) { // plus d'onglets : toutes les zones auxquelles on a droit se chargent avec la page
        if (acc.data.all) put('budget.balance', { projectId: bfirst });
        if (acc.data.po) { put('po.list', { projectId: bfirst }); put('po.list', { scope: 'outside' }); }
        if (acc.data.budget) put('budget.get', { projectId: bfirst });
      }
    }
    return pre;
  }
  var cat = put('planning.catalog', {});
  if (!cat.ok) return pre;
  var open = cat.data.projects.filter(function (p) { return p.status !== 'Clos'; })[0] || cat.data.projects[0] || {};
  var first = boot.project || open.id || '';
  if (view === 'gantt') {
    if (boot.program) put('gantt.program', { programId: boot.program === 'none' ? '' : boot.program });
    else if (first) put('gantt.project', { projectId: first });
  } else if (view === 'structure') {
    var cfg = put('views.config', {});
    if (!cfg.ok) return pre;
    var mode = boot.mode || cfg.data.prefs.obs.mode || 'roles';
    if (boot.program) {
      if (mode === 'teams') put('obs.teams', { rootTeamId: '' });
      else put('obs.tree', { scopeType: 'program', scopeId: boot.program === 'none' ? '' : boot.program });
    } else if (first) {
      put('wbs.tree', { projectId: first });
      if (mode === 'teams') put('obs.teams', { rootTeamId: '' });
      else put('obs.tree', { scopeType: 'project', scopeId: first });
    }
  } else if (view === 'suivi' && first) {
    var list = put('baselines.list', { projectId: first });
    if (list.ok) {
      if (list.data.canReadFeed) { put('changes.feed', { projectId: first, limit: 1 }); put('changes.feed', { projectId: first, all: false }); }
      if (list.data.project.active_baseline_id) put('baselines.diff', { projectId: first });
      put('workspace.status', { projectId: first });
    }
  } else if (view === 'ressources' && first) {
    put('ressources.get', { projectId: first });
  } else if (view === 'actualites' && first) {
    put('news.get', { projectId: first });
  }
  return pre;
}

/** JSON insérable dans une balise <script> : aucune séquence ne peut fermer la balise. */
function safeJsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Identifiant venu de l'URL : caractères d'identifiant seulement. */
function cleanId_(v) {
  return String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function renderPage_(e) {
  resetExecution_();
  var view = e.parameter.view;
  if (view === 'copilote' && !copilotEnabled_()) view = 'overview'; // copilote en suspens : on arrive sur l'Overview
  if (!PAGES[view]) {
    return HtmlService.createHtmlOutput('<p>Vue inconnue.</p>').setTitle('PPM');
  }
  var t = HtmlService.createTemplateFromFile(PAGES[view]);
  var boot = {
    project: cleanId_(e.parameter.project),
    program: cleanId_(e.parameter.program),
    tab: PAGE_TABS[view].indexOf(e.parameter.tab) >= 0 ? e.parameter.tab : PAGE_TABS[view][0],
    mode: e.parameter.mode === 'teams' ? 'teams' : (e.parameter.mode === 'roles' ? 'roles' : ''),
    baseUrl: webAppUrl_(),
    appsheetUrl: getProp(PROP.APPSHEET_URL, ''),
    logoUrl: /^https:\/\//.test(getProp(PROP.LOGO_URL, '')) ? getProp(PROP.LOGO_URL, '') : '',
    view: view,
    version: PPM_VERSION
  };
  var theme = '', home = 'overview';
  try { var ui = loadPrefs_(currentUserEmail_()).ui; theme = ui.theme; home = ui.home; } catch (err) { theme = ''; }
  t.theme = theme === 'dark' || theme === 'light' ? theme : 'auto';
  if (home === 'copilote' && !copilotEnabled_()) home = 'overview';
  boot.home = home;
  boot.copilot = copilotEnabled_();
  boot.isAdmin = adminEmails().indexOf(currentUserEmail_()) >= 0;
  try { var bctx = buildContext(currentUserEmail_()); boot.canBudget = boot.isAdmin || (isInternalUser_(bctx) && (bctx.assignments || []).length > 0); } catch (err) { boot.canBudget = boot.isAdmin; }
  var t0 = Date.now();
  try {
    boot.preload = preloadFor_(view, boot, currentUserEmail_());
  } catch (err) {
    boot.preload = {}; // la page refera ses appels elle-même
  }
  boot.serverMs = Date.now() - t0;
  t.boot = safeJsonForScript(boot);
  return t.evaluate()
    .setTitle(PAGE_TITLES[view])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** URL de la web app, pour les liens entre pages. Vide hors Apps Script (tests). */
function webAppUrl_() {
  var saved = getProp(PROP.WEBAPP_URL, '');
  try {
    var url = typeof ScriptApp !== 'undefined' ? String(ScriptApp.getService().getUrl() || '') : '';
    if (url && /\/exec$/.test(url) && url !== saved) setProp(PROP.WEBAPP_URL, url);
    return url || saved;
  } catch (err) {
    return saved;
  }
}

/** Insère un fichier HTML dans un modèle : <?!= include('Style') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
