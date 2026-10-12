/**
 * PPM Core — 0.14.2 : accès au classeur « Données » (Google Sheets).
 *
 * Toute personne invitée à l'outil (une fiche avec une adresse d'un domaine autorisé, créée dans la page Ressources) reçoit l'accès en ÉDITION au classeur
 * qui contient les données, et son lien est affiché dans Mon compte (et dans Administration pour les administrateurs).
 *
 * ATTENTION, choix assumé : modifier le classeur directement CONTOURNE les règles de l'outil (droits, historique, contrôle de version, vérifications) ; le cache
 * peut retarder de quelques minutes l'affichage d'une saisie. Le classeur « Historique » n'est jamais partagé.
 *
 * Règles de prudence :
 *   - l'outil ne retire QUE les accès qu'il a lui-même accordés (propriété PPM_SHEET_GRANTED) : un partage fait à la main par le propriétaire n'est jamais touché ;
 *   - un accès n'est accordé qu'à une adresse valide d'un domaine autorisé ;
 *   - le partage peut être coupé (Administration → Réglages) : les accès accordés par l'outil sont alors retirés ;
 *   - une erreur de Drive (adresse sans compte Google, quota) est rapportée mais ne bloque jamais l'outil.
 * Drive prévient chaque personne par un courriel de partage (DriveApp ne permet pas de l'éviter).
 */

var SHEET_DRIVE = null; // tests : { addEditor(email), removeEditor(email) }

function dataSheetUrl_() {
  var id = getProp(PROP.DATA_ID, '');
  return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '';
}

function sheetShareOn_() { return getProp(PROP.SHEET_SHARE, 'oui') !== 'non'; }

function sheetGranted_() {
  var l = parseJsonSafe(getProp(PROP.SHEET_GRANTED, ''), []);
  return Array.isArray(l) ? l : [];
}

function sheetSetGranted_(list) { setProp(PROP.SHEET_GRANTED, JSON.stringify(list)); }

function sheetOwnerEmail_() {
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

function sheetDrive_() {
  if (SHEET_DRIVE) return SHEET_DRIVE;
  var f = DriveApp.getFileById(getProp(PROP.DATA_ID, ''));
  return { addEditor: function (e) { f.addEditor(e); }, removeEditor: function (e) { f.removeEditor(e); } };
}

/** Une adresse valide d'un domaine autorisé. */
function sheetEligible_(email) {
  var e = String(email || '').toLowerCase().trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && isAllowedEmail_(e);
}

/** Accorde l'accès en édition (une fois : les accès déjà accordés ne sont pas redemandés à Drive). */
function sheetGrant_(email) {
  var e = String(email || '').toLowerCase().trim();
  if (!getProp(PROP.DATA_ID, '')) return { ok: false, state: 'no_sheet' };
  if (!sheetShareOn_()) return { ok: false, state: 'disabled' };
  if (!sheetEligible_(e)) return { ok: false, state: 'not_eligible' };
  if (e === sheetOwnerEmail_()) return { ok: true, state: 'owner', already: true };
  var granted = sheetGranted_();
  if (granted.indexOf(e) >= 0) return { ok: true, state: 'granted', already: true };
  try { sheetDrive_().addEditor(e); } catch (err) { return { ok: false, state: 'failed', reason: String(err && err.message ? err.message : err).slice(0, 160) }; }
  granted.push(e);
  sheetSetGranted_(granted);
  return { ok: true, state: 'granted' };
}

/** Sans jamais lever d'erreur : à employer partout où l'accès n'est qu'un plus. */
function sheetGrantSafe_(email) {
  try { return sheetGrant_(email); } catch (e) { console.error('PPM partage du classeur : ' + (e && e.message ? e.message : e)); return { ok: false, state: 'failed', reason: 'erreur inattendue' }; }
}

/** Retire un accès que l'outil avait accordé (jamais un autre). */
function sheetRevoke_(email) {
  var e = String(email || '').toLowerCase().trim(), granted = sheetGranted_(), i = granted.indexOf(e);
  if (i < 0) return { ok: true, state: 'not_granted' };
  try { sheetDrive_().removeEditor(e); } catch (err) { return { ok: false, state: 'failed', reason: String(err && err.message ? err.message : err).slice(0, 160) }; }
  granted.splice(i, 1);
  sheetSetGranted_(granted);
  return { ok: true, state: 'revoked' };
}

function sheetRevokeAll_() {
  var out = { revoked: 0, failed: [] };
  sheetGranted_().slice().forEach(function (e) {
    var r = sheetRevoke_(e);
    if (r.ok) out.revoked++; else out.failed.push({ email: e, reason: r.reason || r.state });
  });
  return out;
}

/** Les personnes qui doivent avoir l'accès : fiches avec une adresse autorisée, et administrateurs. */
function sheetDesired_() {
  var want = {};
  repoList('Resource').forEach(function (r) { if (!isBlank(r.email) && sheetEligible_(r.email)) want[String(r.email).toLowerCase().trim()] = true; });
  adminEmails().forEach(function (e) { if (sheetEligible_(e)) want[e] = true; });
  return Object.keys(want).sort();
}

/** Accorde l'accès à toutes les personnes invitées et retire celui des personnes qui ne sont plus dans l'outil (parmi ceux que l'outil avait accordés). */
function sheetSync_() {
  var out = { enabled: sheetShareOn_(), url: dataSheetUrl_(), granted: 0, already: 0, revoked: 0, failed: [], partial: false };
  if (!out.enabled || !out.url) return out;
  var want = sheetDesired_(), t0 = nowMs();
  want.forEach(function (e) {
    if (nowMs() - t0 > 240000) { out.partial = true; return; } // chaque partage prend près d'une seconde : on s'arrête avant la limite d'exécution
    var r = sheetGrant_(e);
    if (!r.ok) out.failed.push({ email: e, reason: r.reason || r.state });
    else if (r.already) out.already++;
    else out.granted++;
  });
  if (!out.partial) sheetGranted_().filter(function (e) { return want.indexOf(e) < 0; }).forEach(function (e) { if (sheetRevoke_(e).ok) out.revoked++; });
  return out;
}

/** Ce que Mon compte affiche : le lien si la personne y a accès (accordé à l'ouverture de la page si besoin), un message sinon. */
function sheetCardFor_(ctx) {
  var url = dataSheetUrl_(), on = sheetShareOn_();
  var card = { url: '', enabled: on, state: 'hidden', reason: '' };
  if (!url) return card;
  if (ctx.isAdmin) card.url = url; // l'administrateur voit toujours le lien (il est propriétaire ou peut se partager le classeur)
  if (!on) { card.state = 'disabled'; return card; }
  if (!ctx.resourceId && !ctx.isAdmin) { card.state = 'no_person'; return card; }
  var r = sheetGrantSafe_(ctx.email);
  if (r.ok) { card.url = url; card.state = 'granted'; }
  else { card.state = r.state === 'failed' ? 'failed' : 'not_eligible'; card.reason = r.reason || ''; }
  return card;
}

defineAction('admin.sheet.sync', function (p, ctx) {
  requireAdmin_(ctx);
  return sheetSync_();
});
