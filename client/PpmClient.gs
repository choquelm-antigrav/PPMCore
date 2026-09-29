/**
 * PpmClient — bibliothèque cliente pour les addons (section 10).
 *
 * À copier dans le projet Apps Script de l'addon. Propriété du script à renseigner :
 *   PPM_CORE_URL = URL /exec de la web app du Core
 * Scopes à déclarer dans le manifeste de l'addon :
 *   https://www.googleapis.com/auth/script.external_request
 *   https://www.googleapis.com/auth/drive.readonly   (jeton accepté par une web app « domaine »)
 *
 * L'addon agit avec les droits de l'utilisateur qui l'exécute : jamais plus.
 */
var PPM_ADDON_ID = ''; // identifiant du manifest de l'addon

function ppmCall(action, params) {
  var url = PropertiesService.getScriptProperties().getProperty('PPM_CORE_URL');
  if (!url) throw new Error('Propriété PPM_CORE_URL manquante.');
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      action: action, params: params || {}, apiVersion: '1.0',
      requestId: Utilities.getUuid(), addonId: PPM_ADDON_ID
    }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  var text = res.getContentText();
  var body;
  try { body = JSON.parse(text); } catch (e) {
    throw new Error('Réponse inattendue du Core (HTTP ' + res.getResponseCode() + ') : vérifier l’URL et les scopes.');
  }
  if (!body.ok) {
    var err = new Error(body.error.message);
    err.code = body.error.code;
    err.details = body.error.details;
    throw err;
  }
  return body.cursor ? { items: body.data, cursor: body.cursor } : body.data;
}

/** Exemple : livrables en retard d'un projet. */
function exempleLivrablesEnRetard(projectId) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var res = ppmCall('planitems.list', { projectId: projectId, limit: 500 });
  var items = res.items || res;
  return items.filter(function (i) {
    return i.item_type === 'Livrable' && i.status !== 'Terminé' && i.planned_finish && i.planned_finish < today;
  });
}
