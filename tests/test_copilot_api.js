const { test, eq, ok } = require('./harness');
const { freshCore } = require('./harness');
const { makeFakeSheets } = require('./fake_sheets');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nCopilote : mode Gemini avec la clé personnelle de chaque compte (0.15.0)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const KEY_A = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', KEY_B = 'AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', KEY_SHARED = 'AIzaSyCOMMUNECOMMUNECOMMUNECOMMUNECOM';

  /** Un faux Google : liste des modèles et génération, qui note chaque appel (adresse, clé envoyée) et peut échouer à la demande. */
  function world(mode) {
    const w = lot2World(), c = w.c, calls = [], scn = { models: ['gemini-flash-latest'], gen: null, text: 'La synthèse du projet est disponible.' };
    c.setProp(c.PROP.COPILOT, 'oui'); c.setProp(c.PROP.AI_MODE, mode || 'api'); c.AI_PROVIDER = null;
    c.AI_FETCH = (url, opts) => {
      const key = (opts.headers || {})['x-goog-api-key'];
      calls.push({ url, key, kind: /\/models\?/.test(url) ? 'models' : /:generateContent$/.test(url) ? 'generate' : 'autre' });
      if (/\/models\?/.test(url)) return { code: 200, text: JSON.stringify({ models: scn.models.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }) };
      if (scn.gen) { const g = scn.gen(key, url); if (g) return g; }
      return { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: scn.text }] } }] }) };
    };
    const setKey = (who, key) => { const r = w.call(who, 'copilot.key.set', { key }); if (r.error) throw new Error(JSON.stringify(r.error)); return r; };
    const brief = (who) => w.raw(who, 'copilot.brief', { projectId: w.p1.id, ai: true });
    const status = (who) => w.call(who, 'copilot.status', { projectId: w.p1.id });
    return { w, c, calls, scn, setKey, brief, status, gen: () => calls.filter((x) => x.kind === 'generate') };
  }

  test('Le statut dit d’où vient la clé, jamais la clé elle-même ; le texte à coller prend le relais sans clé', () => {
    const x = world();
    eq([x.status(CP).key, x.status(CP).usesManual], [{ mine: false, source: 'none', last4: '' }, true], 'sans clé : aucune source, la demande passera par le texte à coller');
    x.setKey(CP, KEY_A);
    const s = x.status(CP);
    eq([s.key.source, s.key.last4, s.usesManual, s.mode], ['mine', 'AAAA', false, 'api'], 'avec sa clé : source « mine », ses quatre derniers caractères, demandes directes');
    ok(JSON.stringify(s).indexOf(KEY_A) < 0, 'la clé n’apparaît nulle part dans le statut');
    eq(x.status(DPL).key.source, 'none', 'la clé d’une personne ne sert pas aux autres');
    const m = world('manual'); m.setKey(CP, KEY_A);
    eq([m.status(CP).usesManual, m.status(CP).quota.used], [true, 0], 'mode texte à coller : toujours le copier-coller, même avec une clé');
    const off = world('off'); eq(off.status(CP).usesManual, false, 'mode désactivé : sans objet');
  });

  test('Chaque compte appelle Gemini avec SA clé : deux personnes, deux clés, aucune confusion', () => {
    const x = world(); x.setKey(CP, KEY_A); x.setKey(DPL, KEY_B); x.calls.length = 0;
    const a = x.brief(CP), b = x.brief(DPL);
    ok(a.ok && b.ok && a.data.ai.mode === 'api' && b.data.ai.mode === 'api', 'deux réponses directes de Gemini');
    eq(x.gen().map((g) => g.key), [KEY_A, KEY_B], 'la première demande part avec la clé de Carla, la seconde avec celle de Dora');
    eq(x.calls.filter((g) => g.kind === 'models').length, 0, 'aucun appel à Google pour choisir le modèle : il a été retenu à l’enregistrement de la clé');
    ok(/gemini-flash-latest:generateContent$/.test(x.gen()[0].url), 'le modèle retenu est utilisé');
    eq([x.status(CP).quota.used, x.status(DPL).quota.used], [1, 1], 'une demande décomptée pour chacun');
  });

  test('Sans clé personnelle, la personne n’est jamais bloquée : repli sur le texte à coller, sans appel à Google ni décompte du quota', () => {
    const x = world(); x.setKey(CP, KEY_A); x.calls.length = 0;
    const withKey = x.brief(CP), without = x.brief(DPL);
    eq([withKey.data.ai.mode, without.data.ai.mode, without.data.ai.fallback], ['api', 'manual', 'no_key'], 'Carla : direct ; Dora (sans clé) : texte à coller, avec la raison');
    ok(/Demande : Rédige une synthèse/.test(without.data.ai.prompt) && /Faits calculés par l’outil/.test(without.data.ai.prompt), 'le texte contient les consignes et les faits chiffrés');
    eq(x.gen().length, 1, 'un seul appel à Gemini : celui de Carla');
    eq([x.status(DPL).quota.used, x.c.repoList('AiLog').filter((l) => l.actor === DPL).map((l) => l.mode)], [0, ['manual']], 'le repli ne consomme pas le quota et se journalise en « manual »');
    const ask = x.w.call(DPL, 'copilot.ask', { projectId: x.w.p1.id, question: 'Quels risques pour la revue ?' });
    ok(ask.mode === 'manual' && ask.fallback === 'no_key' && /Livrables et jalons \(JSON\)/.test(ask.prompt) && /Demande : Quels risques pour la revue \?/.test(ask.prompt), 'une question sans clé prépare aussi le texte, avec la liste des livrables');
    ok(x.w.call(DPL, 'simulations.run', { projectId: x.w.p1.id, explain: true, changes: [{ itemId: x.w.a.id, shiftDays: 3 }] }).ai.fallback === 'no_key', 'l’explication d’une simulation de même');
  });

  test('Plus de clé commune (0.15.0) : une ancienne propriété ne sert jamais, et elle est supprimée à l’installation et chaque nuit', () => {
    const x = world(); x.c.setProp('PPM_GEMINI_API_KEY', KEY_SHARED); x.calls.length = 0;
    eq([x.status(DPL).key.source, x.status(DPL).usesManual, 'shared' in x.status(DPL).key], ['none', true, false], 'une ancienne clé commune n’est pas une source : la personne sans clé reste sans clé');
    const r = x.brief(DPL);
    eq([r.data.ai.mode, r.data.ai.fallback, x.calls.length], ['manual', 'no_key', 0], 'sa demande se prépare en texte à coller, sans rien envoyer à Google avec la clé commune');
    eq([x.c.removeSharedKey_(), x.c.getProp('PPM_GEMINI_API_KEY', ''), x.c.removeSharedKey_()], [true, '', false], 'la propriété est supprimée, une seule fois');
    x.c.setProp('PPM_GEMINI_API_KEY', KEY_SHARED); x.c.nightlyRun();
    eq(x.c.getProp('PPM_GEMINI_API_KEY', ''), '', 'le traitement de nuit la supprime aussi');
    // l'installation (A1) : même effet, et elle le dit
    const c = freshCore();
    c.Session = { getEffectiveUser: () => ({ getEmail: () => ADMIN }), getActiveUser: () => ({ getEmail: () => ADMIN }), getScriptTimeZone: () => 'Europe/Paris' };
    c.SpreadsheetApp = makeFakeSheets(); c.TABLE_PROVIDER = null; c._bookCache = {}; c._tableCache = {};
    c.setProp('PPM_GEMINI_API_KEY', KEY_SHARED);
    const msg = c.setupPpm();
    ok(/La clé Gemini commune de l’administrateur a été supprimée : les clés sont strictement personnelles/.test(msg) && c.getProp('PPM_GEMINI_API_KEY', '') === '', 'A1 supprime la clé commune et le dit');
    ok(!/clé Gemini commune/.test(c.setupPpm()), 'et ne le répète pas ensuite');
  });

  test('Le modèle est retenu une fois : un ancien enregistrement le choisit chez Google une fois, puis plus jamais', () => {
    const x = world(); x.setKey(CP, KEY_A);
    const prop = x.c.userKeyProp_(CP), rec = JSON.parse(x.c.getProp(prop, ''));
    eq(rec.m, 'gemini-flash-latest', 'enregistré avec la clé');
    x.c.setProp(prop, JSON.stringify({ k: rec.k, at: rec.at })); // un enregistrement d’avant la 0.15.0 : sans modèle
    x.calls.length = 0; x.brief(CP); x.brief(CP); x.brief(CP);
    eq(x.calls.map((g) => g.kind), ['models', 'generate', 'generate', 'generate'], 'un seul appel pour choisir le modèle, puis des demandes directes');
    eq(JSON.parse(x.c.getProp(prop, '')).m, 'gemini-flash-latest', 'le choix est retenu');
    x.w.call(CP, 'copilot.key.test', {}); x.scn.models = ['gemini-3.5-flash'];
    x.w.call(CP, 'copilot.key.test', {});
    eq(JSON.parse(x.c.getProp(prop, '')).m, 'gemini-3.5-flash', 'le test de la clé met à jour le modèle retenu');
  });

  test('Google refuse la clé, retire le modèle ou limite le débit : un message clair, jamais la clé, rien de décompté', () => {
    const x = world(); x.setKey(CP, KEY_A);
    x.scn.gen = (key) => ({ code: 403, text: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key. (' + key + ')' } }) });
    const refused = x.brief(CP);
    eq(refused.error.code, 'CONFIG', 'clé refusée : erreur de configuration, pas d’erreur interne');
    ok(/Google refuse votre clé Gemini/.test(refused.error.message) && /Connexion à Gemini/.test(refused.error.message) && /texte à coller/.test(refused.error.message), 'le message dit quoi faire : ' + refused.error.message.slice(0, 120));
    ok(refused.error.message.indexOf(KEY_A) < 0, 'la clé du message de Google est masquée');
    x.scn.gen = () => ({ code: 400, text: JSON.stringify({ error: { message: 'API_KEY_INVALID' } }) });
    eq(x.brief(CP).error.code, 'CONFIG', '400 « clé invalide » : même traitement');
    x.scn.gen = () => ({ code: 400, text: JSON.stringify({ error: { message: 'Invalid JSON payload' } }) });
    eq(x.brief(CP).error.code, 'INTERNAL', '400 sans rapport avec la clé : erreur générale');
    x.scn.gen = () => ({ code: 429, text: '{}' });
    ok(x.brief(CP).error.code === 'QUOTA' && /votre clé chez Google/.test(x.brief(CP).error.message), '429 : le quota de Google est celui de la clé de la personne');
    eq([x.status(CP).quota.used, x.c.repoList('AiLog').length], [0, 0], 'aucune demande en échec n’est décomptée ni journalisée');
    // le modèle retiré : on l’oublie, le prochain essai en choisit un autre
    x.scn.gen = () => ({ code: 404, text: JSON.stringify({ error: { message: 'model not found' } }) });
    const gone = x.brief(CP);
    ok(gone.error.code === 'CONFIG' && /ne propose plus le modèle/.test(gone.error.message), 'modèle retiré : ' + gone.error.message.slice(0, 80));
    eq(JSON.parse(x.c.getProp(x.c.userKeyProp_(CP), '')).m, '', 'le modèle retenu est oublié');
    x.scn.gen = null; x.calls.length = 0;
    eq(x.brief(CP).data.ai.mode, 'api', 'le prochain essai choisit un autre modèle et réussit');
    eq(x.calls.map((g) => g.kind), ['models', 'generate'], 'en un seul appel de choix');
  });

  test('Le quota quotidien est par personne ; la clé ne sort jamais dans les journaux ni les réponses', () => {
    const x = world(); x.c.setProp(x.c.PROP.AI_QUOTA, '2'); x.setKey(CP, KEY_A); x.setKey(DPL, KEY_B);
    x.brief(CP); x.brief(CP);
    const third = x.brief(CP);
    ok(third.error && third.error.code === 'QUOTA' && /2 demandes/.test(third.error.message), 'la troisième demande de Carla est refusée : ' + third.error.message);
    ok(x.brief(DPL).ok, 'Dora, elle, n’est pas touchée');
    const everything = JSON.stringify([x.c.repoList('AiLog'), x.status(CP), x.w.call(CP, 'copilot.key.status', {}), x.brief(DPL)]);
    ok(everything.indexOf(KEY_A) < 0 && everything.indexOf(KEY_B) < 0, 'aucune clé dans le journal des échanges, le statut ni les réponses');
    x.w.call(CP, 'copilot.key.clear', {});
    eq([x.status(CP).key.source, x.status(CP).usesManual], ['none', true], 'clé supprimée : retour au texte à coller');
  });

  test('Mode Gemini dans les réglages : « clé personnelle de chaque compte », sans clé commune', () => {
    const x = world('manual');
    const r = x.w.call(ADMIN, 'admin.set', { values: { ai_mode: 'api' } });
    eq([r.ai_mode, 'gemini_key_set' in r], ['api', false], 'mode Gemini accepté : chaque personne a la sienne, et plus aucun champ de clé commune');
    const refused = x.w.raw(ADMIN, 'admin.set', { values: { gemini_key: KEY_SHARED } });
    ok(refused.error.code === 'VALIDATION' && /strictement personnelle/.test(refused.error.message), 'une clé commune saisie par l’administrateur est refusée, avec l’explication');
    ok(/Gemini : clé personnelle de chaque compte \(accord de la DSI requis\)/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'Admin.html'), 'utf8')), 'libellé de l’écran d’Administration');
  });
};
