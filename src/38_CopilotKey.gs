/**
 * PPM Core — 0.13.0 : clé Gemini personnelle.
 *
 * Chaque personne crée sa propre clé dans Google AI Studio et la colle dans la page Copilote ; l'outil l'utilise ensuite pour les demandes
 * de cette personne seulement. La clé :
 *   - est rangée dans les propriétés PRIVÉES du script (jamais dans une feuille que l'équipe peut ouvrir), sous un nom dérivé de l'adresse
 *     par une empreinte SHA-256 : l'adresse n'apparaît pas dans le nom ;
 *   - n'est JAMAIS renvoyée à une page ni écrite dans un journal : on ne montre que ses quatre derniers caractères ;
 *   - est vérifiée auprès de Google avant d'être gardée (une clé refusée n'est pas enregistrée).
 * Le modèle n'est plus figé : il se choisit dans la liste que Google renvoie pour la clé (les modèles changent souvent).
 */

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
var GEMINI_KEYS_URL = 'https://aistudio.google.com/apikey';
var AI_FETCH = null; // tests : function (url, options) → { code, text }

// ---------------------------------------------------------------- empreinte (SHA-256, sans service Google)

function utf8Bytes_(s) {
  var out = [], i, c, d;
  s = String(s);
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; } }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

var SHA256_K_ = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3,
  0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814,
  0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

/** SHA-256 en hexadécimal (texte codé en UTF-8). */
function sha256Hex_(msg) {
  var bytes = utf8Bytes_(msg), len = bytes.length, h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], i, j, t1, t2;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var hi = Math.floor(len / 0x20000000), lo = (len << 3) >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (i = 0; i < bytes.length; i += 64) {
    var w = [];
    for (j = 0; j < 16; j++) w[j] = (bytes[i + 4 * j] << 24) | (bytes[i + 4 * j + 1] << 16) | (bytes[i + 4 * j + 2] << 8) | bytes[i + 4 * j + 3];
    for (j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (j = 0; j < 64; j++) {
      t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K_[j] + w[j]) | 0;
      t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
}

// ---------------------------------------------------------------- stockage privé de la clé de chaque personne

/** Nom de la propriété privée d'une personne : 32 caractères hexadécimaux de l'empreinte de son adresse (128 bits, sans collision pratique). */
function userKeyProp_(email) { return 'PPM_UK_' + sha256Hex_(String(email || '').toLowerCase().trim()).slice(0, 32); }

function userKeyGet_(email) {
  if (!String(email || '').trim()) return null;
  var raw = getProp(userKeyProp_(email), '');
  if (!raw) return null;
  var o = parseJsonSafe(raw, null);
  return o && o.k ? o : null;
}

function userKeySet_(email, key) { setProp(userKeyProp_(email), JSON.stringify({ k: key, at: todayStr() })); }

/** Ce qu'on a le droit de montrer : jamais la clé, seulement s'il y en a une et ses quatre derniers caractères. */
function userKeyStatus_(email) {
  var o = userKeyGet_(email);
  return { has: !!o, last4: o ? String(o.k).slice(-4) : '', saved_on: o ? o.at : '' };
}

// ---------------------------------------------------------------- appels à Google

function aiFetch_(url, options) {
  if (AI_FETCH) return AI_FETCH(url, options);
  var o = { muteHttpExceptions: true };
  Object.keys(options || {}).forEach(function (k) { o[k] = options[k]; });
  var r = UrlFetchApp.fetch(url, o);
  return { code: r.getResponseCode(), text: r.getContentText() };
}

/** Message d'erreur de Google, sans jamais laisser passer la clé. */
function googleMessage_(json, text, key) {
  var m = (json && json.error && json.error.message) || String(text || '').slice(0, 200) || 'réponse vide';
  m = String(m);
  if (key) m = m.split(key).join('…');
  return truncate(m.replace(/\s+/g, ' ').trim(), 200);
}

/** Le modèle à utiliser parmi ceux que Google propose pour cette clé : l'alias « gemini-flash-latest » s'il existe, sinon le « flash » le plus récent. */
function geminiPickModel_(models) {
  var names = (models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (m) { return String(m.name).replace(/^models\//, ''); });
  if (names.indexOf('gemini-flash-latest') >= 0) return 'gemini-flash-latest';
  // versions comparées par rangs entiers (3.10 est plus récent que 3.9), et non comme des nombres décimaux
  var cmp = function (a, b) { var x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || ((x[1] || 0) - (y[1] || 0)); };
  var best = '', bestV = '';
  names.forEach(function (n) { var m = /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(n); if (m && (!bestV || cmp(m[1], bestV) > 0)) { bestV = m[1]; best = n; } });
  if (best) return best;
  var plain = names.filter(function (n) { return /^gemini-/.test(n) && !/(image|tts|live|audio|embedding|lite|preview|exp|thinking)/.test(n); });
  return plain.filter(function (n) { return /flash/.test(n); })[0] || plain[0] || ''; // jamais un modèle d'image, de voix ou d'embeddings : il ne rédige pas
}

/**
 * Vérifie une clé auprès de Google : (1) la liste des modèles, qui prouve que la clé est acceptée ; (2) si demandé, une toute petite génération.
 * Rend { ok, refused, model, message, steps: [{ name, ok, ms, detail }] } ; refused = Google a rejeté la clé elle-même (400, 401, 403).
 */
function geminiProbe_(key, opts) {
  opts = opts || {};
  var steps = [], t0 = nowMs(), r, json, model = '';
  try {
    r = aiFetch_(GEMINI_BASE + '/models?pageSize=200', { method: 'get', headers: { 'x-goog-api-key': key } });
  } catch (err) {
    var m0 = googleMessage_(null, err && err.message ? err.message : err, key);
    steps.push({ name: 'Joindre Google', ok: false, ms: nowMs() - t0, detail: m0 });
    return { ok: false, refused: false, model: '', message: 'Google est injoignable depuis l’outil (' + m0 + ')', steps: steps };
  }
  json = parseJsonSafe(r.text, {});
  if (r.code === 400 || r.code === 401 || r.code === 403) {
    var m1 = googleMessage_(json, r.text, key);
    steps.push({ name: 'Clé acceptée par Google', ok: false, ms: nowMs() - t0, detail: m1 });
    return { ok: false, refused: true, model: '', message: m1, steps: steps };
  }
  if (r.code >= 300) {
    var m2 = r.code === 429 ? 'quota de Google atteint, réessayez plus tard' : 'Google a répondu ' + r.code + ' : ' + googleMessage_(json, r.text, key);
    steps.push({ name: 'Clé acceptée par Google', ok: false, ms: nowMs() - t0, detail: m2 });
    return { ok: false, refused: false, model: '', message: m2, steps: steps };
  }
  model = geminiPickModel_(json.models);
  steps.push({ name: 'Clé acceptée par Google', ok: true, ms: nowMs() - t0, detail: (json.models || []).length + ' modèle(s) accessible(s)' });
  if (!model) {
    steps.push({ name: 'Modèle de génération', ok: false, ms: 0, detail: 'aucun modèle Gemini ne permet de générer du texte avec cette clé' });
    return { ok: false, refused: false, model: '', message: 'aucun modèle Gemini utilisable avec cette clé', steps: steps };
  }
  steps.push({ name: 'Modèle choisi', ok: true, ms: 0, detail: model });
  if (opts.generate) {
    var t1 = nowMs();
    try {
      var g = aiFetch_(GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Réponds uniquement par le mot : OK' }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } })
      });
      var gj = parseJsonSafe(g.text, {});
      if (g.code >= 300) {
        var m3 = g.code === 429 ? 'quota de Google atteint, réessayez plus tard' : 'Google a répondu ' + g.code + ' : ' + googleMessage_(gj, g.text, key);
        steps.push({ name: 'Petite question à Gemini', ok: false, ms: nowMs() - t1, detail: m3 });
        return { ok: false, refused: false, model: model, message: m3, steps: steps };
      }
      var parts = (((gj.candidates || [])[0] || {}).content || {}).parts || [];
      var txt = parts.filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('').trim();
      steps.push({ name: 'Petite question à Gemini', ok: true, ms: nowMs() - t1, detail: txt ? 'réponse reçue' : 'réponse vide (la clé fonctionne)' });
    } catch (err2) {
      var m4 = googleMessage_(null, err2 && err2.message ? err2.message : err2, key);
      steps.push({ name: 'Petite question à Gemini', ok: false, ms: nowMs() - t1, detail: m4 });
      return { ok: false, refused: false, model: model, message: m4, steps: steps };
    }
  }
  return { ok: true, refused: false, model: model, message: '', steps: steps };
}

/** Le fournisseur d'IA de cette personne : sa clé d'abord, à défaut la clé commune de l'administrateur ; modèle réglé par l'administrateur, sinon choisi chez Google. */
function geminiProviderFor_(ctx) {
  var mine = ctx && ctx.email ? userKeyGet_(ctx.email) : null;
  var key = mine ? mine.k : getProp(PROP.GEMINI_KEY, '');
  if (!key) throw new PpmError('CONFIG', 'Pas de clé Gemini : ouvrez la page Copilote et enregistrez votre clé.');
  var model = getProp(PROP.GEMINI_MODEL, '');
  if (!model) {
    var probe = geminiProbe_(key, {});
    if (!probe.model) throw new PpmError('CONFIG', 'Aucun modèle Gemini utilisable' + (probe.message ? ' (' + probe.message + ')' : '') + ' : vérifiez votre clé dans la page Copilote.');
    model = probe.model;
  }
  return geminiRest_(key, model);
}

// ---------------------------------------------------------------- actions de la page Copilote

defineAction('copilot.key.status', function (p, ctx) {
  requireCopilot_();
  var s = userKeyStatus_(ctx.email);
  s.keys_url = GEMINI_KEYS_URL;
  return s;
});

defineAction('copilot.key.set', function (p, ctx) {
  requireCopilot_();
  var key = String(p.key === undefined || p.key === null ? '' : p.key).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!key) throw new PpmError('VALIDATION', 'Collez d’abord votre clé dans la case.');
  if (/\s/.test(key)) throw new PpmError('VALIDATION', 'La clé ne contient ni espace ni retour à la ligne : recopiez-la en entier, sans rien ajouter.');
  if (!/^[A-Za-z0-9._~+\/=-]{20,300}$/.test(key)) {
    throw new PpmError('VALIDATION', 'Ce texte ne ressemble pas à une clé Gemini (20 à 300 caractères : lettres, chiffres, tirets). Vérifiez que vous avez copié la clé, et non la page.');
  }
  var probe = geminiProbe_(key, {});
  if (probe.refused) throw new PpmError('VALIDATION', 'Google refuse cette clé (' + probe.message + '). Créez-en une nouvelle sur la page de Google, puis recollez-la.');
  userKeySet_(ctx.email, key);
  var out = userKeyStatus_(ctx.email);
  out.keys_url = GEMINI_KEYS_URL;
  out.tested = probe.ok;
  out.model = probe.model || '';
  out.warning = probe.ok ? '' : 'Clé enregistrée, mais le test auprès de Google n’a pas abouti (' + probe.message + '). Réessayez plus tard avec « Tester ma clé ».';
  return out;
});

defineAction('copilot.key.test', function (p, ctx) {
  requireCopilot_();
  var mine = userKeyGet_(ctx.email);
  if (!mine) throw new PpmError('VALIDATION', 'Aucune clé enregistrée : collez-en une d’abord.');
  var probe = geminiProbe_(mine.k, { generate: true });
  return { ok: probe.ok, refused: probe.refused, model: probe.model, message: probe.message, steps: probe.steps };
});

defineAction('copilot.key.clear', function (p, ctx) {
  requireCopilot_();
  if (userKeyGet_(ctx.email)) deleteProp(userKeyProp_(ctx.email));
  var out = userKeyStatus_(ctx.email);
  out.keys_url = GEMINI_KEYS_URL;
  return out;
});
