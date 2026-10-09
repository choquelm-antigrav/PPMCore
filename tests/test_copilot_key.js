const nodeCrypto = require('crypto');
const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nClé Gemini personnelle (0.13.0)');
  const CP = 'carla@entreprise.com', MIA = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';
  const KEY_A = 'AIzaSyD-aBcDeFgHiJkLmNoPqRsTuVwXyZ01234', KEY_B = 'AQ.Ab8RN6Kexample_key-0123456789zzzz';
  const enabled = (w) => { w.c.setProp(w.c.PROP.COPILOT, 'oui'); return w; };

  /** Faux Google : enregistre chaque appel et répond selon le scénario. */
  function fakeGoogle(w, scenario) {
    const calls = [];
    w.c.AI_FETCH = (url, opts) => {
      calls.push({ url, opts });
      const key = (opts.headers || {})['x-goog-api-key'];
      if (scenario.throwNetwork) throw new Error('DNS lookup failed pour ' + key);
      if (/\/models\?/.test(url)) {
        if (scenario.listCode) return { code: scenario.listCode, text: JSON.stringify({ error: { message: scenario.listMessage || 'API key not valid. Please pass a valid API key. (' + key + ')' } }) };
        return { code: 200, text: JSON.stringify({ models: scenario.models || [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };
      }
      if (/:generateContent$/.test(url)) {
        if (scenario.genCode) return { code: scenario.genCode, text: JSON.stringify({ error: { message: 'model overloaded' } }) };
        return { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
      }
      return { code: 404, text: '{}' };
    };
    return calls;
  }

  test('Empreinte SHA-256 : identique à celle de Node sur tous les cas limites du remplissage', () => {
    const w = lot2World(), c = w.c;
    const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(57), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000), 'é€😀 accents', 'mia@entreprise.com', 'x'.repeat(119), 'x'.repeat(120)];
    cases.forEach((s) => eq(c.sha256Hex_(s), nodeCrypto.createHash('sha256').update(s, 'utf8').digest('hex'), 'SHA-256 de ' + JSON.stringify(s.slice(0, 20)) + ' (' + s.length + ' caractères)'));
    eq(c.sha256Hex_('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'vecteur officiel');
  });

  test('Nom de la propriété privée : stable, sans casse, sans l’adresse, sous la limite de taille', () => {
    const c = lot2World().c;
    const p = c.userKeyProp_('Mia@Entreprise.com');
    eq(p, c.userKeyProp_(' mia@entreprise.com '), 'sans tenir compte de la casse ni des espaces');
    ok(/^PPM_UK_[0-9a-f]{32}$/.test(p) && p.length <= 40, p);
    ok(/^[0-9a-f]{32}$/.test(p.replace('PPM_UK_', '')), 'le nom n’est qu’une empreinte : ni l’adresse ni le domaine ne s’y lisent');
    ok(c.userKeyProp_('carla@entreprise.com') !== p, 'une propriété par personne');
  });

  test('Choix du modèle : l’alias « latest », sinon le « flash » le plus récent, sans les variantes spéciales', () => {
    const c = lot2World().c, m = (names) => names.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] }));
    eq(c.geminiPickModel_(m(['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'])), 'gemini-flash-latest');
    eq(c.geminiPickModel_(m(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash', 'gemini-3.8-pro'])), 'gemini-3.8-flash', 'le « flash » le plus récent');
    eq(c.geminiPickModel_(m(['gemini-3.9-flash', 'gemini-3.10-flash', 'gemini-3.2-flash'])), 'gemini-3.10-flash', '3.10 est plus récent que 3.9 : versions comparées par rangs entiers, pas comme des nombres décimaux');
    eq(c.geminiPickModel_(m(['gemini-9-flash', 'gemini-10-flash'])), 'gemini-10-flash', 'et 10 plus récent que 9');
    eq(c.geminiPickModel_(m(['gemini-3.8-flash-image', 'gemini-3.8-flash-lite', 'gemini-2.5-flash-preview-tts', 'gemini-3.5-pro'])), 'gemini-3.5-pro', 'ni image, ni lite, ni tts : à défaut, un modèle Gemini quelconque');
    eq(c.geminiPickModel_([{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['embedContent'] }]), '', 'un modèle qui ne génère pas n’est pas choisi');
    eq(c.geminiPickModel_([]), '');
    eq(c.geminiPickModel_(undefined), '');
  });

  test('Enregistrer sa clé : vérifiée chez Google, gardée en privé, jamais renvoyée ni journalisée', () => {
    const w = enabled(lot2World()), calls = fakeGoogle(w, {});
    const r = w.call(MIA, 'copilot.key.set', { key: KEY_A });
    eq([r.has, r.last4, r.tested, r.model, r.warning], [true, KEY_A.slice(-4), true, 'gemini-flash-latest', ''], 'enregistrée, testée, modèle choisi chez Google');
    ok(!JSON.stringify(r).includes(KEY_A), 'la réponse ne contient pas la clé');
    ok(!JSON.stringify(w.call(MIA, 'copilot.key.status', {})).includes(KEY_A), 'ni l’état');
    eq(w.c.getProp(w.c.userKeyProp_(MIA), '').includes(KEY_A), true, 'elle est bien rangée dans la propriété privée de Mia');
    // la clé ne voyage que dans l'en-tête, jamais dans l'adresse appelée
    ok(calls.length === 1 && calls[0].opts.headers['x-goog-api-key'] === KEY_A && !calls[0].url.includes(KEY_A), 'envoyée dans l’en-tête x-goog-api-key, pas dans l’adresse');
    // nulle part ailleurs : ni les feuilles, ni les journaux, ni les autres propriétés
    const everywhere = JSON.stringify([w.c.repoList('ChangeEvent'), w.c.repoList('Resource'), w.c.repoList('Project'), Object.keys(w.c.PROP).filter((k) => /^(?!.*UK_)/.test(k)).map((k) => w.c.getProp(w.c.PROP[k], null))]);
    ok(!everywhere.includes(KEY_A), 'la clé n’apparaît ni dans les feuilles, ni dans le journal des changements, ni dans les réglages');
    eq(w.call(MIA, 'copilot.key.status', {}).keys_url, 'https://aistudio.google.com/apikey', 'le lien officiel de création est fourni par le serveur');
  });

  test('Chaque personne a sa clé : aucune fuite de l’une vers l’autre', () => {
    const w = enabled(lot2World()); fakeGoogle(w, {});
    w.call(MIA, 'copilot.key.set', { key: KEY_A });
    eq([w.call(CP, 'copilot.key.status', {}).has, w.call(MIA, 'copilot.key.status', {}).has], [false, true], 'Carla n’a pas la clé de Mia');
    w.call(CP, 'copilot.key.set', { key: KEY_B });
    eq([w.call(CP, 'copilot.key.status', {}).last4, w.call(MIA, 'copilot.key.status', {}).last4], [KEY_B.slice(-4), KEY_A.slice(-4)], 'chacune la sienne');
    w.call(CP, 'copilot.key.clear', {});
    eq([w.call(CP, 'copilot.key.status', {}).has, w.call(MIA, 'copilot.key.status', {}).has], [false, true], 'supprimer la sienne ne touche pas celle de l’autre');
    eq(w.c.userKeyGet_(MIA).k, KEY_A);
    eq(w.c.userKeyGet_(''), null, 'sans adresse : aucune clé');
    eq(w.c.userKeyGet_('inconnu@entreprise.com'), null);
  });

  test('Une clé mal collée est refusée avec des mots simples, avant tout appel à Google', () => {
    const w = enabled(lot2World()), calls = fakeGoogle(w, {});
    const msg = (key) => w.raw(MIA, 'copilot.key.set', { key }).error;
    ok(/Collez d’abord/.test(msg('').message) && msg('').code === 'VALIDATION', 'vide');
    ok(/Collez d’abord/.test(msg('   ').message), 'espaces seuls');
    ok(/ni espace ni retour/.test(msg('AIzaSyD-aBcDeFgHiJk LmNoPqRsTuVwXyZ01234').message), 'espace au milieu');
    ok(/ni espace ni retour/.test(msg('AIzaSyD-aBcDeFgHiJkLmNoPqRsTuV\nwXyZ01234').message), 'retour à la ligne au milieu');
    ok(/ne ressemble pas à une clé/.test(msg('court').message), 'trop court');
    ok(/ne ressemble pas à une clé/.test(msg('https://aistudio.google.com/apikey?x=' + 'a'.repeat(30)).message), 'une adresse web collée à la place de la clé');
    ok(/ne ressemble pas à une clé/.test(msg('é'.repeat(30)).message), 'caractères accentués');
    eq(calls.length, 0, 'aucun appel à Google pour un texte qui ne peut pas être une clé');
    eq(w.call(MIA, 'copilot.key.status', {}).has, false, 'rien d’enregistré');
    // guillemets ou espaces autour d'une clé correcte : nettoyés
    const w2 = enabled(lot2World()); fakeGoogle(w2, {});
    eq(w2.call(MIA, 'copilot.key.set', { key: '  "' + KEY_A + '"\n' }).last4, KEY_A.slice(-4), 'guillemets et espaces de copier-coller retirés');
    eq(w2.c.userKeyGet_(MIA).k, KEY_A, 'et la clé gardée est la bonne, nue');
  });

  test('Google refuse la clé : rien n’est enregistré, le message ne recopie jamais la clé', () => {
    [[400, 'API key not valid. Please pass a valid API key.'], [403, 'Requests from this API key are blocked.'], [401, 'invalid authentication']].forEach(([code, message]) => {
      const w = enabled(lot2World()); fakeGoogle(w, { listCode: code, listMessage: message + ' ' + KEY_A });
      const e = w.raw(MIA, 'copilot.key.set', { key: KEY_A }).error;
      ok(e.code === 'VALIDATION' && /Google refuse cette clé/.test(e.message) && /Créez-en une nouvelle/.test(e.message), code + ' : ' + e.message);
      ok(!e.message.includes(KEY_A), code + ' : le message ne contient pas la clé');
      eq(w.call(MIA, 'copilot.key.status', {}).has, false, code + ' : rien d’enregistré');
    });
  });

  test('Google injoignable, surchargé ou lent : la clé est gardée, avec un avertissement clair', () => {
    [[{ throwNetwork: true }, /injoignable/], [{ listCode: 429 }, /quota de Google/], [{ listCode: 503, listMessage: 'unavailable' }, /Google a répondu 503/]].forEach(([scenario, re]) => {
      const w = enabled(lot2World()); fakeGoogle(w, scenario);
      const r = w.call(MIA, 'copilot.key.set', { key: KEY_A });
      eq([r.has, r.tested], [true, false], 'enregistrée sans avoir pu être testée');
      ok(re.test(r.warning) && /Tester ma clé/.test(r.warning), r.warning);
      ok(!r.warning.includes(KEY_A) && !JSON.stringify(r).includes(KEY_A), 'sans recopier la clé');
    });
  });

  test('« Tester ma clé » : trois étapes lisibles, avec leur durée, et un échec dit à quelle étape', () => {
    const w = enabled(lot2World()); fakeGoogle(w, {});
    eq(w.raw(MIA, 'copilot.key.test', {}).error.code, 'VALIDATION', 'sans clé : on demande d’en coller une');
    w.call(MIA, 'copilot.key.set', { key: KEY_A });
    const ok1 = w.call(MIA, 'copilot.key.test', {});
    eq([ok1.ok, ok1.model, ok1.steps.map((s) => s.name), ok1.steps.every((s) => s.ok), ok1.steps.every((s) => typeof s.ms === 'number')], [true, 'gemini-flash-latest', ['Clé acceptée par Google', 'Modèle choisi', 'Petite question à Gemini'], true, true]);
    ok(!JSON.stringify(ok1).includes(KEY_A), 'le résultat ne contient pas la clé');
    fakeGoogle(w, { genCode: 500 });
    const bad = w.call(MIA, 'copilot.key.test', {});
    eq([bad.ok, bad.steps.filter((s) => !s.ok).map((s) => s.name)], [false, ['Petite question à Gemini']], 'la clé est valable, la génération a échoué : on le dit');
    ok(/Google a répondu 500/.test(bad.message), bad.message);
    fakeGoogle(w, { listCode: 403, listMessage: 'key revoked' });
    const revoked = w.call(MIA, 'copilot.key.test', {});
    eq([revoked.ok, revoked.refused, revoked.steps[0].ok], [false, true, false], 'clé révoquée depuis : refusée dès la première étape');
    fakeGoogle(w, { models: [{ name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] });
    const none = w.call(MIA, 'copilot.key.test', {});
    ok(!none.ok && /aucun modèle/.test(none.message), 'aucun modèle utilisable : dit clairement');
  });

  test('Copilote suspendu : aucune action de clé ne répond', () => {
    const w = lot2World(); w.c.setProp(w.c.PROP.COPILOT, 'non'); fakeGoogle(w, {});
    ['copilot.key.status', 'copilot.key.set', 'copilot.key.test', 'copilot.key.clear'].forEach((a) => {
      const r = w.raw(MIA, a, { key: KEY_A });
      eq([a, r.error.code, r.error.message], [a, 'FORBIDDEN', 'Le copilote est en suspens.']);
    });
    eq(w.c.getProp(w.c.userKeyProp_(MIA), ''), '', 'et rien n’a été enregistré');
  });

  test('Utilisation de la clé : celle de la personne d’abord, sinon la clé commune, modèle de l’administrateur ou choisi chez Google', () => {
    const w = enabled(lot2World()); const calls = fakeGoogle(w, {});
    const gen = (email) => { const prov = w.c.geminiProviderFor_({ email }); calls.length = 0; prov.generate({ system: 's', contents: [{ role: 'user', parts: [{ text: 'q' }] }] }); return { name: prov.name, last: calls[calls.length - 1] }; };
    let thrown; try { w.c.geminiProviderFor_({ email: MIA }); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'CONFIG' && /page Copilote/.test(thrown.message), 'sans aucune clé : on renvoie vers la page Copilote');
    w.c.setProp(w.c.PROP.GEMINI_KEY, KEY_B);
    w.c.setProp(w.c.PROP.GEMINI_MODEL, 'gemini-choisi-par-admin');
    let g = gen(MIA);
    eq([g.name, g.last.opts.headers['x-goog-api-key']], ['gemini:gemini-choisi-par-admin', KEY_B], 'sans clé personnelle : la clé commune, au modèle de l’administrateur, sans appel de liste');
    ok(/gemini-choisi-par-admin:generateContent$/.test(g.last.url) && !g.last.url.includes(KEY_B), 'adresse du modèle, sans la clé');
    w.call(MIA, 'copilot.key.set', { key: KEY_A });
    g = gen(MIA);
    eq(g.last.opts.headers['x-goog-api-key'], KEY_A, 'avec sa clé personnelle : c’est la sienne qui part');
    eq(gen(CP).last.opts.headers['x-goog-api-key'], KEY_B, 'et Carla, sans clé personnelle, reste sur la clé commune');
    w.c.setProp(w.c.PROP.GEMINI_MODEL, '');
    g = gen(MIA);
    eq(g.name, 'gemini:gemini-flash-latest', 'sans modèle réglé : choisi chez Google avec la clé de la personne');
    // le tout passe par la demande du copilote : le quota, le garde-fou des chiffres et le journal restent en place
    w.c.AI_PROVIDER = null; w.c.setProp(w.c.PROP.AI_MODE, 'api');
    const r = w.c.runAi_({ email: MIA, actx: { actor: MIA, source: 'test' } }, w.p1.id, 'test', 'Dis OK', { x: 1 }, {});
    eq([r.mode, r.model], ['api', 'gemini:gemini-flash-latest'], 'runAi_ utilise le fournisseur de la personne');
    ok(!JSON.stringify(w.c.repoList('AiLog')).includes(KEY_A) && !JSON.stringify(w.c.repoList('AiLog')).includes(KEY_B), 'et le journal des échanges ne contient aucune clé');
  });

  test('Administration : activer ou suspendre le copilote d’un clic, tracé, réservé aux administrateurs', () => {
    const w = lot2World(); w.c.setProp(w.c.PROP.COPILOT, 'non');
    eq(w.call(ADMIN, 'admin.get', {}).copilot_enabled, false, 'suspendu au départ');
    const on = w.call(ADMIN, 'admin.set', { values: { copilot_enabled: true } });
    eq([on.copilot_enabled, w.c.copilotEnabled_(), on.changed.length], [true, true, 1], 'activé');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Réglages' && e.field === 'copilot' && e.old_value === 'non' && e.new_value === 'oui' && e.actor === ADMIN), 'trace : avant, après, auteur');
    eq(w.call(ADMIN, 'admin.set', { values: { copilot_enabled: true } }).changed.length, 0, 'sans changement : rien de tracé');
    eq(w.raw(MIA, 'admin.set', { values: { copilot_enabled: false } }).error.code, 'FORBIDDEN', 'un simple membre ne peut pas');
    eq(w.c.copilotEnabled_(), true, 'et rien n’a bougé');
    const off = w.call(ADMIN, 'admin.set', { values: { copilot_enabled: false } });
    eq([off.copilot_enabled, w.c.copilotEnabled_()], [false, false], 'suspendu à nouveau');
    fakeGoogle(w, {});
    eq(w.raw(MIA, 'copilot.key.status', {}).error.code, 'FORBIDDEN', 'suspendu : les actions de clé se ferment');
    w.call(ADMIN, 'admin.set', { values: { copilot_enabled: true } });
    ok(w.raw(MIA, 'copilot.key.status', {}).ok, 'réactivé : elles répondent');
  });
};
