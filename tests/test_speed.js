const { freshCore, test, eq, ok } = require('./harness');
const { makeFakeSheets } = require('./fake_sheets');

module.exports = function () {
  console.log('\nRapidité : nombre d’appels aux services Google par page (0.14.2)');
  const ME = 'admin@entreprise.com';

  /**
   * Un Core qui lit de vraies (fausses) feuilles, un faux cache et de faux services, qui COMPTENT leurs appels. Le temps réel dépend de Google ; le nombre d'appels,
   * lui, est exact, et c'est lui qui domine dans Apps Script (chaque appel coûte entre 0,05 et 0,3 s).
   */
  function countingWorld() {
    const c = freshCore(), counts = {}, hit = (k) => { counts[k] = (counts[k] || 0) + 1; };
    const store = Object.assign({}, c.PROPERTY_OVERRIDES); c.PROPERTY_OVERRIDES = null;
    c.PropertiesService = { getScriptProperties: () => ({ getProperties: () => { hit('Properties.getProperties'); return Object.assign({}, store); }, setProperty: (k, v) => { store[k] = String(v); hit('Properties.set'); }, deleteProperty: (k) => { delete store[k]; } }) };
    c.Session = { getActiveUser: () => { hit('Session.getActiveUser'); return { getEmail: () => c.__me || ME }; }, getEffectiveUser: () => ({ getEmail: () => ME }), getScriptTimeZone: () => 'Europe/Paris' };
    c.ScriptApp = { getService: () => { hit('ScriptApp.getService'); return { getUrl: () => 'https://script.google.com/macros/s/X/exec' }; } };
    c.HtmlService = { createTemplateFromFile: () => ({ evaluate: () => { hit('Html.evaluate'); const o = { setTitle: () => o, addMetaTag: () => o }; return o; } }), createHtmlOutput: () => ({ setTitle: () => ({}) }) };
    const sheets = makeFakeSheets(); c.SpreadsheetApp = sheets; c.TABLE_PROVIDER = null; c._bookCache = {}; c._tableCache = {};
    const openById = sheets.openById; const seen = new WeakSet();
    sheets.openById = (id) => {
      hit('Sheets.openById'); const b = openById(id);
      if (!seen.has(b)) {
        seen.add(b); const gs = b.getSheetByName.bind(b);
        b.getSheetByName = (n) => {
          hit('Sheets.getSheetByName'); const sh = gs(n);
          if (sh && !seen.has(sh)) {
            seen.add(sh); ['getLastColumn', 'getLastRow'].forEach((m) => { const f = sh[m].bind(sh); sh[m] = () => { hit('Sheets.' + m); return f(); }; });
            const gr = sh.getRange.bind(sh); sh.getRange = (...a) => { const r = gr(...a); const gv = r.getValues.bind(r); r.getValues = () => { hit('Sheets.getValues'); return gv(); }; return r; };
          }
          return sh;
        };
      }
      return b;
    };
    let cache = {};
    c.CACHE_PROVIDER = { get: (k) => { hit('Cache.get'); return cache[k] === undefined ? null : cache[k]; }, getAll: (ks) => { hit('Cache.getAll'); const o = {}; ks.forEach((k) => { if (cache[k] !== undefined) o[k] = cache[k]; }); return o; }, put: (k, v) => { hit('Cache.put'); cache[k] = v; }, putAll: (o) => { hit('Cache.putAll'); Object.assign(cache, o); } };
    c.setupPpm(); c.DEMO_BUDGET_MS = 1e9; c.seedDemo_();
    const reset = () => Object.keys(counts).forEach((k) => delete counts[k]);
    const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
    const cold = () => { c.resetExecution_(); cache = {}; c._bookCache = {}; c._tableCache = {}; };
    return { c, counts, reset, total, cold, cache: () => cache, store };
  }

  /** Ouvre une page comme le ferait une nouvelle exécution ; le projet est choisi avant la mesure (sa lecture ne fait pas partie de l'ouverture). */
  const open = (w, view) => { const project = w.c.repoList('Project')[0].id; w.c.resetExecution_(); w.reset(); w.c.renderPage_({ parameter: { view, project } }); return w.total(); };
  const VIEWS = ['overview', 'gantt', 'structure', 'ressources', 'suivi', 'actualites', 'budget', 'compte', 'admin', 'copilote'];

  test('Budget d’appels : ouvrir une page avec le cache plein coûte 5 appels aux services Google, jamais plus de 6', () => {
    const w = countingWorld();
    const warm = {};
    VIEWS.forEach((v) => { w.cold(); open(w, v); warm[v] = open(w, v); });
    VIEWS.forEach((v) => ok(warm[v] <= 6, v + ' : ' + warm[v] + ' appels à chaud (budget : 6)'));
    VIEWS.forEach((v) => { w.cold(); open(w, v); open(w, v); eq(w.counts['Cache.get'] || 0, 0, v + ' : aucune table lue à part dans le cache (toutes viennent avec le préchargement groupé)'); });
    ok(Math.max(...Object.values(warm)) <= 6, 'aujourd’hui : au plus ' + Math.max(...Object.values(warm)) + ' (propriétés, identité, adresse de l’application, génération du cache, rendu de la page)');
  });

  test('Budget d’appels : avec le cache vide, une page ne dépasse pas 55 appels (Administration : 140, avec son contrôle d’installation)', () => {
    const w = countingWorld();
    VIEWS.forEach((v) => { w.cold(); const n = open(w, v); ok(n <= (v === 'admin' ? 140 : 55), v + ' : ' + n + ' appels à froid'); });
  });

  test('Une table se lit en UN appel (getDataRange) ; une écriture lit seulement les en-têtes, sans relire toute la table', () => {
    const w = countingWorld(), c = w.c;
    c._bookCache = {}; c._tableCache = {}; w.reset();
    const rows = c.sheetTable_('PlanItem').readAll();
    ok(rows.length >= 45, rows.length + ' lignes lues');
    eq([w.counts['Sheets.getValues'], w.counts['Sheets.getLastRow'] || 0, w.counts['Sheets.getLastColumn'] || 0], [1, 0, 0], 'lecture complète : un seul appel, ni dernière ligne ni dernière colonne demandées');
    c._tableCache = {}; w.reset();
    const t = c.sheetTable_('PlanItem'); t.findRow('inexistant'); t.appendRows([{ id: 'zz-1', project_id: 'p', name: 'X', item_type: 'Livrable' }]);
    ok((w.counts['Sheets.getValues'] || 0) <= 2, 'écrire ne relit pas toute la table : ' + (w.counts['Sheets.getValues'] || 0) + ' lecture(s) d’en-têtes seulement');
    eq(t.headers().length, c.tableColumns('PlanItem').length, 'les en-têtes restent ceux de la feuille');
    eq(c.sheetTable_('PlanItem').readAll().filter((r) => r.id === 'zz-1').length, 1, 'et la ligne ajoutée se relit');
  });

  test('Le cache : une lecture à froid range toutes les tables en UN appel, sans relire le numéro de génération', () => {
    const w = countingWorld(), c = w.c;
    w.cold(); open(w, 'overview');
    eq([w.counts['Cache.putAll'] || 0, w.counts['Cache.put'] || 0], [1, 0], 'un seul rangement groupé, aucun rangement table par table');
    ok((w.counts['Cache.get'] || 0) <= 2, 'numéros de génération lus en groupe, pas un par un : ' + (w.counts['Cache.get'] || 0) + ' lecture(s) isolée(s)');
    const cacheKeys = Object.keys(w.cache());
    ok(cacheKeys.filter((k) => /^gen:/.test(k)).length >= 15 && cacheKeys.filter((k) => /^rows:/.test(k)).length >= 15, 'le cache contient les tables lues : ' + cacheKeys.length + ' éléments');
    open(w, 'overview');
    eq([w.counts['Cache.putAll'] || 0, w.counts['Sheets.getValues'] || 0, w.counts['Sheets.openById'] || 0], [0, 0, 0], 'page suivante : rien ne retourne dans Sheets, rien à ranger');
  });

  test('Une écriture annule le rangement en attente : le cache ne garde jamais une table périmée', () => {
    const w = countingWorld(), c = w.c;
    w.cold(); c.resetExecution_();
    const before = c.repoList('Baseline').length; // lecture à froid : rangement en attente
    c.repoInsert('Baseline', { project_id: c.repoList('Project')[0].id, label: 'Z9', number: 9, status: 'Archivée', justification: 'essai' }, { actor: ME, source: 'test' });
    c.flushCache_();
    ok(!/^[^|]+\|[1-9]/.test(w.cache()['gen:Baseline'] || ''), 'le numéro de génération du cache indique « à relire » : ' + w.cache()['gen:Baseline']);
    c.resetExecution_();
    eq(c.repoList('Baseline').length, before + 1, 'la lecture suivante voit la ligne ajoutée (elle n’est pas servie par une table périmée)');
  });

  test('Une table courante se lit en entier une fois ; plus de lecture ligne par ligne dans Sheets', () => {
    const w = countingWorld(), c = w.c, b = c.repoList('Baseline')[0];
    w.cold(); open(w, 'overview'); // remplit le cache, comme une page déjà ouverte
    c.resetExecution_(); c._tableCache = {}; c._bookCache = {}; c.prefetchTables_(c.HOT_TABLES); w.reset();
    const hit = c.repoGet('Baseline', b.id);
    eq([hit.id, w.counts['Sheets.getValues'] || 0, w.counts['Sheets.getLastRow'] || 0], [b.id, 0, 0], 'repoGet sert la ligne depuis le cache, sans toucher à Sheets');
    c.resetExecution_(); c._tableCache = {}; c._bookCache = {}; cacheEmpty(w); w.reset();
    eq(c.repoGet('Baseline', b.id).id, b.id, 'cache vide : la table est lue entière (1 appel), pas la ligne');
    eq([w.counts['Sheets.getValues'], w.counts['Sheets.getLastRow'] || 0], [1, 0], 'une seule lecture de feuille, sans demander la dernière ligne');
    function cacheEmpty(world) { Object.keys(world.cache()).forEach((k) => delete world.cache()[k]); }
  });

  test('Identité de l’utilisateur : un appel par exécution ; une nouvelle exécution la relit (pas d’identité périmée)', () => {
    const w = countingWorld(), c = w.c;
    c.resetExecution_(); w.reset();
    [1, 2, 3, 4].forEach(() => c.currentUserEmail_());
    eq(w.counts['Session.getActiveUser'], 1, 'quatre lectures de l’identité, un seul appel');
    c.__me = 'autre@entreprise.com'; c.resetExecution_();
    eq(c.currentUserEmail_(), 'autre@entreprise.com', 'une nouvelle exécution lit l’identité à nouveau');
    c.__me = ME; w.reset(); c.uiCall('planning.catalog', {}); c.__me = 'autre@entreprise.com'; c.uiCall('planning.catalog', {});
    eq(w.counts['Session.getActiveUser'], 2, 'uiCall : un appel par exécution, donc par utilisateur');
  });

  test('Adresse de l’application : le service ScriptApp n’est interrogé qu’une fois par heure', () => {
    const w = countingWorld(), c = w.c;
    c.setProp(c.PROP.WEBAPP_URL, ''); c.setProp(c.PROP.WEBAPP_URL_AT, '0'); c.resetExecution_(); w.reset();
    const url = c.webAppUrl_();
    eq([url, w.counts['ScriptApp.getService']], ['https://script.google.com/macros/s/X/exec', 1], 'premier appel : adresse lue et mémorisée');
    c.resetExecution_(); w.reset();
    eq([c.webAppUrl_(), w.counts['ScriptApp.getService'] || 0], [url, 0], 'dans l’heure : aucun appel au service');
    c.setProp(c.PROP.WEBAPP_URL_AT, String(Date.now() - 2 * 3600000)); c.resetExecution_(); w.reset();
    c.webAppUrl_();
    eq(w.counts['ScriptApp.getService'], 1, 'une heure plus tard : elle est revérifiée (une nouvelle publication change l’adresse)');
    c.setProp(c.PROP.WEBAPP_URL, 'https://script.google.com/macros/s/ANCIENNE/exec'); c.setProp(c.PROP.WEBAPP_URL_AT, '0'); c.resetExecution_();
    eq(c.webAppUrl_(), 'https://script.google.com/macros/s/X/exec', 'si l’adresse a changé, la nouvelle remplace l’ancienne');
  });

  test('Tables demandées d’avance : toutes existent, et celles d’une page ne sont plus lues une à une', () => {
    const c = freshCore();
    Object.keys(c.PAGE_TABLES).forEach((v) => c.PAGE_TABLES[v].forEach((t) => ok(!!c.SCHEMA[t], v + ' : ' + t + ' est une table du schéma')));
    ok(c.PPM_PAGES.every((p) => c.PAGES[p.view]), 'chaque page du registre a son fichier');
    ok(c.HOT_TABLES.every((t) => c.SCHEMA[t]) && Object.keys(c.HOT_SET).length === c.HOT_TABLES.length, 'tables courantes valides et indexées');
    const w = countingWorld();
    w.cold(); open(w, 'actualites'); open(w, 'actualites');
    open(w, 'actualites');
    eq([w.counts['Cache.get'] || 0, w.counts['Cache.getAll']], [0, 2], 'Actualités : Meeting, NewsAction et NewsDigest viennent avec les autres tables, en deux appels groupés au total');
  });

  test('Chaque page ne tire du cache que les tables qu’elle lit : la liste est exacte, ni trop courte ni trop longue (0.14.2)', () => {
    const w = countingWorld(), c = w.c;
    VIEWS.forEach((v) => {
      // relevé sur une ouverture à cache vide : toute table lue passe alors par readAllCached_ (à chaud, une table servie par le préchargement n'y passe plus)
      const project = c.repoList('Project')[0].id; w.cold();
      const used = new Set(), orig = c.readAllCached_; c.readAllCached_ = function (name) { used.add(name); return orig.apply(this, arguments); };
      c.renderPage_({ parameter: { view: v, project } }); c.readAllCached_ = orig;
      eq([...used].sort(), [...c.PAGE_TABLES[v]].sort(), v + ' : tables lues = tables demandées d’avance');
    });
    const kb = (v) => { w.cold(); open(w, v); let bytes = 0; const ga = c.CACHE_PROVIDER.getAll; c.CACHE_PROVIDER.getAll = (ks) => { const o = ga(ks); Object.values(o).forEach((x) => { bytes += String(x).length; }); return o; }; open(w, v); c.CACHE_PROVIDER.getAll = ga; return bytes; };
    ok(kb('copilote') < 0.5 * kb('overview') && kb('copilote') < 60000, 'la page Copilote (3 tables) ne tire plus les tables du planning, du budget ni des actualités : ' + kb('copilote') + ' octets');
    ok(!c.PAGE_TABLES.compte.includes('BaselineItem') && !c.PAGE_TABLES.structure.includes('BaselineItem'), 'Compte et Structure ne tirent plus les écarts de baseline, la plus grosse table');
  });

  test('Déclencheur facultatif warmCache : relit les tables courantes en un appel, sous une nouvelle génération, en semaine seulement, sans jamais lever d’erreur', () => {
    const w = countingWorld(), c = w.c;
    eq(c.CACHE_TTL_S, 360, 'le cache vit 6 minutes : le déclencheur le renouvelle toutes les 5, sans trou');
    const tables = c.warmTables_();
    ok(tables.length >= 20 && !tables.includes('ChangeEvent') && !tables.includes('AiLog') && tables.includes('PlanItem') && tables.includes('NewsAction'), tables.length + ' tables, journaux volumineux exclus');
    w.cold(); open(w, 'overview');
    const genBefore = w.cache()['gen:PlanItem'];
    const realHours = c.warmHours_; c.warmHours_ = () => true; w.reset();
    const msg = c.warmCache();
    ok(/^\d+ tables rangées dans le cache/.test(msg), msg);
    eq([w.counts['Cache.putAll'], w.counts['Cache.put'] || 0], [1, 0], 'un seul appel d’écriture dans le cache pour toutes les tables');
    ok(w.cache()['gen:PlanItem'] !== genBefore && /^[^|]+\|\d+$/.test(w.cache()['gen:PlanItem']), 'chaque table reçoit une nouvelle génération : ' + genBefore + ' → ' + w.cache()['gen:PlanItem']);
    // après une pause (cache vidé) puis le déclencheur : la première page est servie à chaud
    Object.keys(w.cache()).forEach((k) => delete w.cache()[k]); c.warmCache();
    ['overview', 'gantt', 'budget', 'compte'].forEach((v) => { c._bookCache = {}; c._tableCache = {}; ok(open(w, v) <= 6, v + ' : ' + w.total() + ' appels juste après le déclencheur, comme avec un cache plein'); });
    eq(w.counts['Sheets.getValues'] || 0, 0, 'aucune lecture de feuille pour l’utilisateur');
    c._bookCache = {}; c._tableCache = {};
    ok(open(w, 'suivi') > 6 && w.counts['Sheets.getValues'] === 1, 'Suivi et Administration lisent à la demande le journal des changements, volontairement laissé hors du déclencheur (table volumineuse) : ' + w.total() + ' appels, 1 lecture de feuille');
    // heures de travail
    const at = (iso) => realHours(new Date(iso));
    eq([at('2026-10-14T10:00:00'), at('2026-10-14T05:59:00'), at('2026-10-14T21:00:00'), at('2026-10-17T10:00:00'), at('2026-10-18T10:00:00'), at('2026-10-12T06:00:00')], [true, false, false, false, false, true], 'semaine de 6 h à 21 h ; ni la nuit ni le week-end');
    // jamais d'erreur
    const c2 = countingWorld().c; c2.warmHours_ = () => true; c2.sheetTable_ = () => { throw new Error('quota Sheets dépassé'); };
    let thrown = null, out; try { out = c2.warmCache(); } catch (e) { thrown = e; }
    ok(thrown === null && /^Échec : quota Sheets dépassé/.test(out), 'une panne est dite sans lever d’erreur (pas de courriel d’échec de Google) : ' + out);
    const c3 = countingWorld(); c3.c.warmHours_ = () => false; c3.reset();
    ok(/^Hors des heures/.test(c3.c.warmCache()) && (c3.counts['Cache.putAll'] || 0) === 0 && (c3.counts['Sheets.getValues'] || 0) === 0, 'hors des heures : rien n’est lu ni écrit');
    // jamais de table périmée rangée en cas d'écriture entre-temps : la relecture range ce qui est dans les feuilles à cet instant
    const c4 = countingWorld(); c4.c.warmHours_ = () => true; c4.c.warmCache();
    c4.c.repoInsert('NewsDigest', { project_id: c4.c.repoList('Project')[0].id, digest_date: '2026-10-14', text: 'x' }, { actor: ME, source: 'test' });
    c4.c.resetExecution_();
    eq(c4.c.repoList('NewsDigest').filter((d) => d.text === 'x').length, 1, 'une écriture après le déclencheur est vue par la lecture suivante (génération invalidée)');
  });

  test('A5 pose le déclencheur warmCache toutes les 5 minutes, sans doublon', () => {
    const c = freshCore(), made = [];
    c.ScriptApp = {
      getProjectTriggers: () => made.filter((t) => !t.gone).map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => { t._t.gone = true; },
      newTrigger: (fn) => { const t = { fn }; made.push(t); const b = { timeBased: () => b, atHour: (h) => { t.hour = h; return b; }, everyDays: () => b, everyMinutes: (n) => { t.every = n; return b; }, create: () => t }; return b; }
    };
    const msg = c.installTriggers(); c.installTriggers();
    const live = made.filter((t) => !t.gone);
    eq([live.filter((t) => t.fn === 'warmCache').length, live.find((t) => t.fn === 'warmCache').every], [1, 5], 'un seul déclencheur warmCache, toutes les 5 minutes, même après deux installations');
    ok(/cache gardé plein toutes les 5 minutes en semaine de 6 h à 21 h/.test(msg), msg);
    eq(typeof c.warmCache, 'function', 'le gestionnaire est une fonction publique de l’éditeur');
  });
};
