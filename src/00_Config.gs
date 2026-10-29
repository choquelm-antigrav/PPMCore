/**
 * PPM Core — configuration générale.
 *
 * Les valeurs métier paramétrables sont ici. Les identifiants d'environnement
 * et les secrets vont dans les propriétés du script (voir PROP), jamais dans le code.
 */

var PPM_VERSION = '0.19.4';
var PPM_API_VERSION = '1.0';

/** Colonnes techniques ajoutées à toute table « vivante » (hors historique). */
var TECH_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'deleted'];

/** Seuils par défaut (sections 5 et 9 de la spécification). */
var THRESHOLDS = {
  staleProgressDays: 30,
  dueSoonDays: 7,
  milestoneStaleDays: 7,        // un jalon échu depuis plus de N jours sans avoir été déclaré passé est signalé à ceux qui pilotent le projet (récapitulatif du matin)
  criticalSlipDays: 5,
  cpiWarn: 0.95,
  cpiAlert: 0.90,
  riskLowMax: 6,
  riskHighMin: 15
};

/** Conversion probabilité 1–5 → pourcentage (section 5.7). */
var PROBABILITY_MAP = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 };

/**
 * Huit niveaux de responsabilité (0.15.3). Le numéro le plus BAS est le niveau le plus haut ; un niveau a les droits de ceux du dessous (règle 2).
 *   0 Program Leader (programme) · 1 Domain Program Leader (plusieurs projets) · 2 Chef de projet (un projet) · 3 Workpackage leader (un workpackage)
 *   4 Sub-workpackage leader (un sous-workpackage) · 5 Deliverable owner (un livrable ou un jalon) · 6 Contributor (avancement d'un livrable ou d'un jalon)
 *   7 Reader : rôle PAR DÉFAUT de toute personne sans autre rôle, jamais enregistré ; lit tout, ne modifie rien.
 * Les rôles se cumulent (règle 3) : on peut être Contributor d'un livrable et Workpackage leader d'un autre workpackage.
 */
var ROLE_RANK = { PL: 0, DPL: 1, CP: 2, WPL: 3, SWPL: 4, DO: 5, CONTRIB: 6, READER: 7 };

var ROLES = ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB', 'READER'];

/** Rôles qu'on enregistre (READER est implicite). */
var ASSIGNABLE_ROLES = ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB'];

var ROLE_LABELS = {
  PL: 'Program Leader',
  DPL: 'Domain Program Leader',
  CP: 'Chef de projet',
  WPL: 'Workpackage leader',
  SWPL: 'Sub-workpackage leader',
  DO: 'Deliverable owner',
  CONTRIB: 'Contributor',
  READER: 'Reader'
};

/** Sur quel type d'objet chaque rôle se pose, et nulle part ailleurs : pas de chef de projet sur un livrable, pas de Deliverable owner sur un workpackage. */
var ROLE_OBJECT = { PL: 'program', DPL: 'project', CP: 'project', WPL: 'workpackage', SWPL: 'subworkpackage', DO: 'planitem', CONTRIB: 'planitem' };
var OBJECT_LABELS = { program: 'un programme', project: 'un projet', workpackage: 'un workpackage', subworkpackage: 'un sous-workpackage', planitem: 'un livrable ou un jalon' };

/** Anciens codes (avant 0.15.3), reconnus seulement par la migration. */
var LEGACY_ROLE_CODES = ['RWP', 'MEMBER'];

/**
 * Droits d'écriture, exprimés par NIVEAU MINIMAL : le rôle indiqué et tous ceux du dessus l'ont, sur l'objet où le rôle est posé et tout ce qu'il contient.
 * 'wbs.edit' et 'wbs.delete' ont ici un niveau de base, affiné selon le type d'objet visé (voir wbsLevel_ dans 05_Rbac.gs).
 * L'administrateur plateforme a tous les droits. Les actions de portée « global » sont accordées si l'on détient le rôle sur n'importe quel périmètre.
 */
var PERMISSION_LEVEL = {
  'program.create':   'PL',
  'sheet.roles':      'DPL',     // modifier DIRECTEMENT dans le classeur les feuilles Rôles et personnes (la protection du classeur en découle : 51_SheetProtect.gs)
  'sheet.budget':     'CP',      // idem pour les feuilles Budget et achats
  'program.view':     'DPL',     // vues consolidées de tous les projets d'un programme (Actualités, Suivi, Budget)
  'project.create':   'DPL',
  'wbs.edit':         'DO',      // modifier un objet, ou créer dedans : le niveau exact dépend de l'objet (projet CP, workpackage WPL, sous-workpackage SWPL, livrable DO)
  'wbs.delete':       'DO',      // supprimer un objet : projet DPL, workpackage CP, sous-workpackage WPL, livrable ou jalon DO
  'progress.declare': 'CONTRIB',
  'milestone.pass':   'DO',      // déclarer un jalon passé (ou le rouvrir) : le responsable du jalon (Deliverable owner) et les niveaux au-dessus
  'baseline.manage':  'CP',
  'baseline.request': 'CONTRIB',
  'budget.edit':      'WPL',
  'import.run':      'CP',            // importer le WBS par classeur (56_Import.gs)
  'budget.authorize': 'CP',            // fixer l'enveloppe autorisée du projet et la répartir entre les workpackages (un sous-workpackage : par son Workpackage leader)
  'cpn.edit':         'CP',
  'po.edit':          'CONTRIB',
  'exercise.read':    'WPL',     // voir l'exercice budgétaire (60_Exercise.gs), en entier, au global
  'exercise.edit':    'CP',      // saisir le budget attendu et accordé par équipe d'un projet
  'actuals.manage':   'CP',
  'roles.assign':     'DO',      // poser un rôle : le niveau exact dépend du rôle posé (voir roleAssignError_ dans 05_Rbac.gs)
  'resource.edit':    'CP',      // créer et modifier les personnes (page Ressources)
  'risk.create':      'CONTRIB',
  'risk.edit':        'CP',
  'changes.ack':      'CP',
  'workspace.manage': 'CP',
  'insight.decide':   'CP',
  'news.add':         'CP',
  'news.manage':      'CP',
  'sensitive.read':   'WPL',     // lire les comptes rendus de réunion (le budget se lit avec budget.edit, sur son périmètre : un WPL voit celui de son workpackage) ; tout le reste se lit sans rôle
  'addon.install':    '*'
};

/**
 * Droits « en profondeur » : un rôle détenu n'importe où DANS le périmètre visé compte (un Contributor sur un livrable peut demander une baseline pour son projet,
 * un DPL posé sur des projets voit les vues consolidées de leur programme).
 */
var PERMISSION_DEEP = {
  'baseline.request': true, 'po.edit': true, 'risk.create': true, 'sensitive.read': true, 'exercise.read': true,
  'program.view': true, 'project.create': true
};

/** Les rôles autorisés par droit, déduits des niveaux (conservé pour la protection du classeur et les libellés). */
var PERMISSIONS = (function () {
  var out = {};
  Object.keys(PERMISSION_LEVEL).forEach(function (action) {
    var min = PERMISSION_LEVEL[action];
    out[action] = min === '*' ? ['*'] : ASSIGNABLE_ROLES.filter(function (r) { return ROLE_RANK[r] <= ROLE_RANK[min]; });
  });
  return out;
})();

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
  APPSHEET_URL: 'PPM_APPSHEET_URL',
  WEBAPP_URL: 'PPM_WEBAPP_URL',
  PROJECTS_FOLDER: 'PPM_PROJECTS_FOLDER_ID',
  AI_MODE: 'PPM_AI_MODE',
  GEMINI_MODEL: 'PPM_GEMINI_MODEL',
  AI_QUOTA: 'PPM_AI_DAILY_QUOTA',
  LOGO_URL: 'PPM_LOGO_URL',
  LAST_NIGHTLY: 'PPM_LAST_NIGHTLY',
  LAST_DIGEST: 'PPM_LAST_DIGEST',
  COPILOT: 'PPM_COPILOT',
  SHEET_PROTECT: 'PPM_SHEET_PROTECT',         // « non » : les feuilles sensibles du classeur ne sont plus verrouillées (oui par défaut)
  SHEET_PROTECT_SIG: 'PPM_SHEET_PROTECT_SIG', // empreinte des éditeurs appliqués : vide = à refaire
  SHEET_SHARE: 'PPM_SHEET_SHARE',     // « non » : le classeur Données n'est plus partagé avec les personnes invitées (oui par défaut)
  SHEET_GRANTED: 'PPM_SHEET_GRANTED', // adresses à qui l'OUTIL a accordé l'accès (JSON) : seules celles-là sont retirées par lui
  WEBAPP_URL_AT: 'PPM_WEBAPP_URL_AT', // dernière vérification de l'adresse de la web app (ms) : pas d'appel à ScriptApp à chaque page
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
