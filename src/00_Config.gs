/**
 * PPM Core — configuration générale.
 *
 * Les valeurs métier paramétrables sont ici. Les identifiants d'environnement
 * et les secrets vont dans les propriétés du script (voir PROP), jamais dans le code.
 */

var PPM_VERSION = '0.12.0';
var PPM_API_VERSION = '1.0';

/** Colonnes techniques ajoutées à toute table « vivante » (hors historique). */
var TECH_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'deleted'];

/** Seuils par défaut (sections 5 et 9 de la spécification). */
var THRESHOLDS = {
  staleProgressDays: 30,
  dueSoonDays: 7,
  criticalSlipDays: 5,
  cpiWarn: 0.95,
  cpiAlert: 0.90,
  riskLowMax: 6,
  riskHighMin: 15
};

/** Conversion probabilité 1–5 → pourcentage (section 5.7). */
var PROBABILITY_MAP = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 };

/** Rang des rôles : on ne peut attribuer qu'un rôle de rang égal ou inférieur au sien. */
var ROLE_RANK = { PL: 0, DPL: 1, CP: 2, RWP: 3, MEMBER: 4 };

/** Rôles (section 7). MEMBER = membre affecté (affectation explicite ou ligne budgétaire). */
var ROLES = ['PL', 'DPL', 'CP', 'RWP', 'MEMBER'];

var ROLE_LABELS = {
  PL: 'Program Leader',
  DPL: 'Domain Program Leader',
  CP: 'Chef de projet',
  RWP: 'Responsable de workpackage',
  MEMBER: 'Membre affecté'
};

/**
 * Matrice des droits d'écriture (section 7).
 * '*' = tout utilisateur authentifié. L'administrateur plateforme a tous les droits.
 * Les actions de portée « global » (rate card, création de programme) sont accordées
 * si l'utilisateur détient le rôle sur n'importe quel périmètre.
 */
var PERMISSIONS = {
  'program.create':   ['PL'],
  'project.create':   ['PL', 'DPL'],
  'wbs.edit':         ['PL', 'DPL', 'CP', 'RWP'],
  'progress.declare': ['DPL', 'CP', 'RWP', 'MEMBER'],
  'baseline.manage':  ['DPL', 'CP'],
  'baseline.request': ['PL', 'DPL', 'CP', 'RWP', 'MEMBER'],
  'budget.edit':      ['PL', 'DPL', 'CP', 'RWP'],
  'cpn.edit':         ['PL', 'DPL', 'CP'],
  'po.edit':          ['PL', 'DPL', 'CP', 'RWP', 'MEMBER'],
  'ratecard.manage':  ['DPL', 'CP'],
  'actuals.manage':   ['DPL', 'CP'],
  'roles.assign':     ['PL', 'DPL', 'CP'],
  'resource.edit':    ['PL', 'DPL', 'CP'],
  'risk.create':      ['PL', 'DPL', 'CP', 'RWP', 'MEMBER'],
  'risk.edit':        ['PL', 'DPL', 'CP'],
  'changes.ack':      ['DPL', 'CP'],
  'workspace.manage': ['PL', 'DPL', 'CP'],
  'insight.decide':   ['PL', 'DPL', 'CP'],
  'news.add':         ['PL', 'DPL', 'CP'],
  'news.manage':      ['PL', 'DPL', 'CP'],
  'addon.install':    ['*']
};

/** Durée d'une tranche de traitement planifié (plafond Apps Script : 6 min par exécution). */
var JOB_SLICE_MS = 5 * 60 * 1000;

/** Clés des propriétés du script. */
var PROP = {
  DATA_ID: 'PPM_DATA_ID',
  HISTORY_ID: 'PPM_HISTORY_ID',
  DOMAIN: 'PPM_DOMAIN',
  ADMINS: 'PPM_ADMINS',
  BACKUP_FOLDER: 'PPM_BACKUP_FOLDER_ID',
  JOB_STATE: 'PPM_JOB_STATE',
  GEMINI_KEY: 'PPM_GEMINI_API_KEY',
  APPSHEET_URL: 'PPM_APPSHEET_URL',
  WEBAPP_URL: 'PPM_WEBAPP_URL',
  PROJECTS_FOLDER: 'PPM_PROJECTS_FOLDER_ID',
  AI_MODE: 'PPM_AI_MODE',
  GEMINI_KEY: 'PPM_GEMINI_API_KEY',
  GEMINI_MODEL: 'PPM_GEMINI_MODEL',
  AI_QUOTA: 'PPM_AI_DAILY_QUOTA',
  LOGO_URL: 'PPM_LOGO_URL',
  LAST_NIGHTLY: 'PPM_LAST_NIGHTLY',
  LAST_DIGEST: 'PPM_LAST_DIGEST',
  COPILOT: 'PPM_COPILOT',
  DEMO_STEP: 'PPM_DEMO_STEP',
  DEMO_CLEAN: 'PPM_DEMO_CLEAN', // horodatage de la demande de suppression de l'ancienne démo (confirmation par un second lancement)
  NEWS_LAST: 'PPM_NEWS_LAST', // fin de la dernière collecte des réunions (ISO)
  LAST_NEWS: 'PPM_LAST_NEWS', // résultat de la dernière collecte (pour l'administration)
  REMINDER_ON: 'PPM_REMINDER_ON',
  REMINDER_DAYS: 'PPM_REMINDER_DAYS'
};

/** Surcharge des propriétés pour les tests hors ligne. */
var PROPERTY_OVERRIDES = null;

function getProp(key, fallback) {
  if (PROPERTY_OVERRIDES) {
    return Object.prototype.hasOwnProperty.call(PROPERTY_OVERRIDES, key) ? PROPERTY_OVERRIDES[key] : fallback;
  }
  // Toutes les propriétés sont lues en une fois par exécution (chaque lecture isolée coûte un appel au serveur).
  if (!_propsMemo) _propsMemo = PropertiesService.getScriptProperties().getProperties() || {};
  return Object.prototype.hasOwnProperty.call(_propsMemo, key) ? _propsMemo[key] : fallback;
}
var _propsMemo = null;

function setProp(key, value) {
  if (PROPERTY_OVERRIDES) { PROPERTY_OVERRIDES[key] = value; return; }
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  if (_propsMemo) _propsMemo[key] = String(value);
}

function deleteProp(key) {
  if (PROPERTY_OVERRIDES) { delete PROPERTY_OVERRIDES[key]; return; }
  PropertiesService.getScriptProperties().deleteProperty(key);
  if (_propsMemo) delete _propsMemo[key];
}

/** Adresses des administrateurs plateforme (propriété PPM_ADMINS, séparées par des virgules). */
function adminEmails() {
  return String(getProp(PROP.ADMINS, ''))
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s.length > 0; });
}

/** Domaine autorisé (propriété PPM_DOMAIN, ex. « entreprise.com »). */
/** Domaines autorisés : PPM_DOMAIN peut en lister plusieurs, séparés par une virgule (ex. entreprise.com, filiale.com). */
/**
 * Copilote IA en suspens (décision du propriétaire) : page, lien, réglages et demandes à l'IA sont masqués et refusés tant que la propriété
 * PPM_COPILOT ne vaut pas « oui ». Rien n'est supprimé : le code et les réglages sont conservés.
 */
function copilotEnabled_() { return String(getProp(PROP.COPILOT, 'non')).toLowerCase() === 'oui'; }

function requireCopilot_() {
  if (!copilotEnabled_()) throw new PpmError('FORBIDDEN', 'Le copilote est en suspens.');
}

function allowedDomains() {
  return String(getProp(PROP.DOMAIN, '')).toLowerCase().split(/[\s,;]+/).filter(function (d) { return d; });
}

/** Une adresse est autorisée si son domaine figure parmi ceux de PPM_DOMAIN. */
function isAllowedEmail_(email) {
  var d = String(email || '').toLowerCase().split('@')[1];
  return !!d && allowedDomains().indexOf(d) >= 0;
}

/** Message d'un accès refusé : dit pourquoi et ce qu'il faut faire (le visiteur ne voit que sa propre adresse). */
function accessDeniedMessage_(email) {
  var allowed = allowedDomains();
  if (!allowed.length) return 'Le domaine n’est pas réglé : l’administrateur doit renseigner la propriété PPM_DOMAIN du script.';
  if (!email) {
    return 'Votre compte Google n’a pas pu être identifié. Ouvrez l’application avec votre compte professionnel (si plusieurs comptes Google sont connectés, utilisez une fenêtre de navigation privée) ; le propriétaire du déploiement et vous devez être dans le même domaine Google Workspace.';
  }
  return 'Votre compte (' + email + ') n’est pas dans un domaine autorisé (' + allowed.join(', ') + '). S’il s’agit bien de votre compte professionnel, l’administrateur doit ajouter votre domaine à la propriété PPM_DOMAIN (séparé par une virgule) ; sinon, ouvrez l’application avec le bon compte Google.';
}

/** Domaine principal (le premier), pour l'affichage. */
function allowedDomain() {
  return allowedDomains()[0] || '';
}
