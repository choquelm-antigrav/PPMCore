/**
 * PPM Core — utilitaires communs.
 * Aucune dépendance aux services Apps Script au chargement : ces fonctions
 * sont aussi exécutées par la suite de tests hors ligne (Node).
 */

/** Erreur métier typée, renvoyée telle quelle par l'API. */
function PpmError(code, message, details) {
  this.name = 'PpmError';
  this.code = code;
  this.message = message;
  this.details = details || null;
}
PpmError.prototype = Object.create(Error.prototype);
PpmError.prototype.constructor = PpmError;

/** Horloge surchargeable pour les tests. */
var CLOCK = null;

function nowMs() {
  return CLOCK ? CLOCK() : Date.now();
}

function nowIso() {
  return new Date(nowMs()).toISOString();
}

/** Date du jour AAAA-MM-JJ, dans le fuseau du script en production. */
function todayStr() {
  if (!CLOCK && typeof Utilities !== 'undefined' && typeof Session !== 'undefined') {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return new Date(nowMs()).toISOString().slice(0, 10);
}

function newId() {
  if (typeof Utilities !== 'undefined' && Utilities.getUuid) return Utilities.getUuid();
  var s = '';
  for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
}

function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function isTrue(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Normalise une valeur lue dans Sheets : dates → AAAA-MM-JJ (ou ISO si heure non nulle),
 * vide → ''. Garantit des comparaisons stables entre lectures.
 */
function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    if (typeof Utilities !== 'undefined' && typeof Session !== 'undefined') {
      var tz = Session.getScriptTimeZone();
      var hms = Utilities.formatDate(v, tz, 'HH:mm:ss');
      return hms === '00:00:00' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
    }
    var iso = v.toISOString();
    return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : iso;
  }
  return v;
}

/** Forme texte canonique d'une valeur, pour comparer et journaliser. */
function canonical(v) {
  v = normalizeValue(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  var s = String(v);
  if (s === 'true' || s === 'false') return s.toUpperCase();
  return s;
}

function pickFields(obj, fields) {
  var out = {};
  fields.forEach(function (f) { out[f] = obj[f] === undefined ? '' : obj[f]; });
  return out;
}

/** JSON stable (ordre des champs imposé) des champs donnés. */
function stableJson(obj, fields) {
  var out = {};
  fields.forEach(function (f) { out[f] = canonical(obj[f]); });
  return JSON.stringify(out);
}

/** Empreinte de 16 caractères hexadécimaux (djb2 + sdbm), suffisante pour détecter un changement. */
function hashString(s) {
  var h1 = 5381, h2 = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = (c + (h2 << 6) + (h2 << 16) - h2) | 0;
  }
  return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
}

function parseJsonSafe(s, fallback) {
  if (isBlank(s)) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function truncate(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Envoi d'un mail simple ; en l'absence de MailApp (tests), trace dans la console. */
var SENT_MAILS = null;
function notifyUser(email, subject, body) {
  if (isBlank(email) || String(email).indexOf('@') < 0) return false;
  if (SENT_MAILS) { SENT_MAILS.push({ to: email, subject: subject, body: body }); return true; }
  if (typeof MailApp === 'undefined') { console.log('[mail] ' + email + ' — ' + subject); return false; }
  MailApp.sendEmail({ to: email, subject: '[PPM] ' + subject, body: body });
  return true;
}
