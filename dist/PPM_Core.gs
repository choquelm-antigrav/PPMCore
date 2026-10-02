/**
 * PPM Core 0.9.1 — fichier unique à installer (fabriqué par tools/build.js, empreinte 707bf4305691).
 * NE PAS MODIFIER ICI : modifier les sources (dossier src/), puis refabriquer.
 * Contient, dans cet ordre : 00_Config.gs, 01_Schema.gs, 02_Util.gs, 03_Calendar.gs, 04_Graph.gs, 05_Rbac.gs, 06_Rules.gs, 07_Schedule.gs, 10_Repository.gs, 11_ChangeLog.gs, 20_Setup.gs, 30_Api.gs, 32_Views.gs, 33_Structure.gs, 34_Baselines.gs, 35_Workspace.gs, 36_Digest.gs, 37_Simulation.gs, 38_Copilot.gs, 39_Account.gs, 40_Jobs.gs, 41_Edit.gs, 42_Org.gs, 43_Budget.gs, 44_Orders.gs.
 */

// ======================================================================
// 00_Config.gs
// ======================================================================

/**
 * PPM Core — configuration générale.
 *
 * Les valeurs métier paramétrables sont ici. Les identifiants d'environnement
 * et les secrets vont dans les propriétés du script (voir PROP), jamais dans le code.
 */

var PPM_VERSION = '0.9.1';
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
function allowedDomain() {
  return String(getProp(PROP.DOMAIN, '')).trim().toLowerCase();
}

// ======================================================================
// 01_Schema.gs
// ======================================================================

/**
 * PPM Core — schéma des tables (section 4 de la spécification).
 *
 * Une feuille par table, ligne 1 = noms de colonnes, colonne A = id (clé AppSheet).
 * book : 'data' (classeur Données, source AppSheet) ou 'history' (classeur Historique).
 * tech : false = table en ajout seul, sans colonnes techniques.
 * log  : false = modifications non journalisées dans ChangeEvent.
 *
 * Règle d'évolution (section 11) : on ajoute des colonnes EN FIN de liste,
 * on ne renomme ni ne supprime jamais sans script de migration approuvé.
 */

var COUNTRIES = ['FR', 'DE', 'UK', 'IN'];

/** Statuts d'une commande d'achat (PO) : à faire, lancée (engagée), GR (good receipt : prestation réceptionnée), terminée (soldée). */
var PO_STATUSES = ['À faire', 'Lancée', 'GR', 'Terminée'];

var SCHEMA = {
  // ---------- Classeur Données : structure (WBS) ----------
  Program: {
    book: 'data',
    cols: ['id', 'code', 'name', 'leader_resource_id', 'status', 'description'],
    required: ['code', 'name'],
    enums: { status: ['Actif', 'En pause', 'Clos'] }
  },
  Project: {
    book: 'data',
    cols: ['id', 'code', 'name', 'program_id', 'manager_resource_id', 'status', 'holiday_country',
      'start_date', 'end_date', 'active_baseline_id', 'drive_folder_id', 'calendar_id', 'cpn', 'cpn_label'],
    required: ['code', 'name'],
    enums: { status: ['Préparation', 'Actif', 'En pause', 'Clos'], holiday_country: COUNTRIES }
  },
  WorkPackage: {
    book: 'data',
    cols: ['id', 'project_id', 'parent_wp_id', 'wbs_code', 'name', 'owner_resource_id', 'charge_code', 'cpn', 'cpn_label'],
    required: ['project_id', 'name']
  },
  PlanItem: {
    book: 'data',
    cols: ['id', 'project_id', 'wp_id', 'item_type', 'name', 'owner_resource_id', 'planned_start',
      'planned_finish', 'actual_finish', 'progress_pct', 'status', 'milestone_category', 'drive_url',
      'calendar_event_id', 'last_progress_at'],
    required: ['project_id', 'item_type', 'name'],
    enums: {
      item_type: ['Livrable', 'Jalon'],
      status: ['À faire', 'En cours', 'Terminé'],
      milestone_category: ['Revue', 'Client', 'Interne']
    }
  },
  MilestoneRequirement: {
    book: 'data',
    cols: ['id', 'milestone_id', 'deliverable_id'],
    required: ['milestone_id', 'deliverable_id']
  },
  Dependency: {
    book: 'data',
    cols: ['id', 'predecessor_id', 'successor_id', 'dep_type', 'lag_days'],
    required: ['predecessor_id', 'successor_id', 'dep_type'],
    enums: { dep_type: ['FS', 'SS', 'FF', 'SF'] }
  },

  // ---------- Classeur Données : personnes et OBS ----------
  Resource: {
    book: 'data',
    cols: ['id', 'resource_type', 'name', 'email', 'team_id', 'rate_profile', 'supplier',
      'capacity_days_month', 'country', 'job_function', 'organization'],
    required: ['resource_type', 'name'],
    enums: { resource_type: ['Interne', 'Externe'], country: COUNTRIES }
  },
  HierarchicalTeam: {
    book: 'data',
    cols: ['id', 'name', 'parent_team_id', 'manager_resource_id', 'cost_center'],
    required: ['name']
  },
  HolidaySet: {
    book: 'data',
    cols: ['id', 'country', 'year', 'label', 'dates_json'],
    required: ['country', 'year'],
    enums: { country: COUNTRIES }
  },
  Role: {
    book: 'data',
    cols: ['id', 'code', 'label', 'scope_level'],
    required: ['code']
  },
  RoleAssignment: {
    book: 'data',
    cols: ['id', 'resource_id', 'role_code', 'scope_type', 'scope_id', 'start_date', 'end_date'],
    required: ['resource_id', 'role_code', 'scope_type', 'scope_id'],
    enums: { role_code: ROLES, scope_type: ['program', 'project', 'workpackage'] }
  },

  // ---------- Classeur Données : budget ----------
  RateCard: {
    book: 'data',
    cols: ['id', 'profile', 'country', 'daily_rate', 'effective_date'],
    required: ['profile', 'country', 'daily_rate'],
    enums: { country: COUNTRIES }
  },
  BudgetLine: {
    book: 'data',
    cols: ['id', 'deliverable_id', 'resource_id', 'cost_type', 'planned_days', 'frozen_rate',
      'fixed_amount', 'planned_amount', 'phasing_mode'],
    required: ['deliverable_id', 'resource_id', 'cost_type'],
    enums: { cost_type: ['TJM', 'Forfait'] }
  },
  /** Commande d'achat auprès d'une ressource externe. Rattachée à un projet par son CPN ; engagée en une fois à son lancement. */
  PurchaseOrder: {
    book: 'data',
    cols: ['id', 'po_number', 'cpn', 'resource_id', 'owner_resource_id', 'description', 'start_date', 'end_date', 'amount',
      'status', 'gr_due_date', 'launched_on', 'gr_on', 'closed_on'],
    required: ['po_number', 'cpn', 'resource_id', 'amount', 'status'],
    enums: { status: PO_STATUSES }
  },
  PurchaseOrderLink: {
    book: 'data',
    cols: ['id', 'po_id', 'deliverable_id', 'amount'],
    required: ['po_id', 'deliverable_id', 'amount']
  },
  BudgetPhasing: {
    book: 'data',
    cols: ['id', 'budget_line_id', 'month', 'amount'],
    required: ['budget_line_id', 'month']
  },
  ProgressUpdate: {
    book: 'data',
    cols: ['id', 'deliverable_id', 'resource_id', 'declared_at', 'progress_pct', 'comment'],
    required: ['deliverable_id', 'progress_pct']
  },
  ActualImport: {
    book: 'data',
    cols: ['id', 'period', 'source_file_id', 'mapping_json', 'status', 'imported_by'],
    enums: { status: ['Brouillon', 'Contrôlé', 'Publié', 'Remplacé'] }
  },

  // ---------- Classeur Données : risques, baselines, IA ----------
  RiskOpportunity: {
    book: 'data',
    cols: ['id', 'project_id', 'kind', 'title', 'description', 'linked_item_id', 'financial_value',
      'probability', 'impact', 'score', 'owner_resource_id', 'strategy', 'review_date',
      'treatment_due', 'status'],
    required: ['project_id', 'kind', 'title'],
    enums: {
      kind: ['Risque', 'Opportunité'],
      status: ['Ouvert', 'En traitement', 'Clos'],
      strategy: ['Éviter', 'Réduire', 'Transférer', 'Accepter', 'Exploiter', 'Partager', 'Améliorer']
    }
  },
  Baseline: {
    book: 'data',
    cols: ['id', 'project_id', 'number', 'label', 'justification', 'requested_by', 'status',
      'decided_by', 'decided_at'],
    required: ['project_id', 'justification'],
    enums: { status: ['Demandée', 'Active', 'Archivée', 'Refusée'] }
  },
  Insight: {
    book: 'data',
    log: false,
    cols: ['id', 'project_id', 'rule_code', 'severity', 'target_type', 'target_id', 'message',
      'suggestion', 'status', 'generated_on', 'decided_by', 'decided_at', 'decision_note'],
    enums: { severity: ['Info', 'Vigilance', 'Alerte'], status: ['Nouveau', 'Accepté', 'Ignoré'] }
  },

  // ---------- Classeur Données : addons et préférences ----------
  Addon: {
    book: 'data',
    cols: ['id', 'name', 'url', 'manifest_json', 'author_email', 'visibility', 'review_status'],
    required: ['name', 'url', 'manifest_json'],
    enums: { visibility: ['Privé', 'Partagé', 'Catalogue'], review_status: ['Non revu', 'Approuvé', 'Refusé'] }
  },
  AddonInstallation: {
    book: 'data',
    cols: ['id', 'addon_id', 'user_email', 'enabled'],
    required: ['addon_id', 'user_email']
  },
  AddonRecord: {
    book: 'data',
    cols: ['id', 'addon_id', 'collection', 'entity_type', 'entity_id', 'data_json'],
    required: ['addon_id', 'collection', 'entity_type', 'entity_id']
  },
  UserSetting: {
    book: 'data',
    cols: ['id', 'user_email', 'language', 'notify_frequency', 'view_prefs_json', 'calendar_invites', 'reminder_days', 'reminder_off'],
    enums: { language: ['FR', 'EN', 'DE'], notify_frequency: ['Quotidien', 'Hebdomadaire', 'Aucun'] }
  },

  // ---------- Classeur Historique (ajout seul) ----------
  ChangeEvent: {
    book: 'history', tech: false,
    cols: ['id', 'at', 'table_name', 'entity_id', 'project_id', 'field', 'old_value', 'new_value',
      'actor', 'source', 'acknowledged', 'acknowledged_by', 'acknowledged_at']
  },
  BaselineItem: {
    book: 'history', tech: false,
    cols: ['id', 'baseline_id', 'entity_type', 'entity_id', 'snapshot_json']
  },
  ActualLine: {
    book: 'history', tech: false,
    cols: ['id', 'import_id', 'month', 'charge_code', 'resource_ref', 'cost_center', 'days', 'amount',
      'matched_wp_id', 'matched_deliverable_id', 'match_status']
  },
  EvmSnapshot: {
    book: 'history', tech: false,
    cols: ['id', 'scope_type', 'scope_id', 'status_date', 'bac', 'pv', 'ev', 'ac', 'cpi', 'spi', 'eac']
  },
  /** Journal du copilote (section 9, garde-fous) : chaque demande à l'IA, sa réponse et l'avis de l'utilisateur. */
  AiLog: {
    book: 'history', tech: false,
    cols: ['id', 'at', 'actor', 'project_id', 'purpose', 'mode', 'prompt', 'response', 'unverified', 'feedback', 'feedback_at']
  },
  /** Liens vers les objets Workspace (événement d'agenda, dossier Drive) : identifiant externe et empreinte du dernier envoi. */
  SyncLink: {
    book: 'history', tech: false,
    cols: ['id', 'kind', 'entity_id', 'project_id', 'container_id', 'external_id', 'hash', 'synced_at']
  },
  _Snapshot: {
    book: 'history', tech: false,
    cols: ['id', 'table_name', 'entity_id', 'hash', 'json', 'updated_at']
  }
};

/** Colonnes de référence → table cible (types Ref dans AppSheet). */
var REF_TARGETS = {
  program_id: 'Program', project_id: 'Project', wp_id: 'WorkPackage', parent_wp_id: 'WorkPackage',
  leader_resource_id: 'Resource', manager_resource_id: 'Resource', owner_resource_id: 'Resource',
  resource_id: 'Resource', team_id: 'HierarchicalTeam', parent_team_id: 'HierarchicalTeam',
  milestone_id: 'PlanItem', deliverable_id: 'PlanItem', predecessor_id: 'PlanItem',
  successor_id: 'PlanItem', linked_item_id: 'PlanItem', budget_line_id: 'BudgetLine',
  active_baseline_id: 'Baseline', baseline_id: 'Baseline', addon_id: 'Addon', import_id: 'ActualImport'
};

var DATE_COLS = ['start_date', 'end_date', 'planned_start', 'planned_finish', 'actual_finish',
  'review_date', 'treatment_due', 'effective_date', 'generated_on'];

/** Longueur maximale des libellés libres (fonction, organisation). */
var TEXT_MAX_LENGTH = { job_function: 80, organization: 80 };

var NUMBER_RULES = {
  progress_pct: { min: 0, max: 100 },
  probability: { min: 1, max: 5, integer: true },
  impact: { min: 1, max: 5, integer: true },
  lag_days: { integer: true },
  planned_days: { min: 0 },
  daily_rate: { min: 0 },
  capacity_days_month: { min: 0 },
  fixed_amount: { min: 0 },
  financial_value: {}
};

function isLiveTable(table) {
  return SCHEMA[table] && SCHEMA[table].tech !== false;
}

function isLoggedTable(table) {
  return isLiveTable(table) && SCHEMA[table].log !== false;
}

/** Colonnes physiques d'une table (métier + techniques le cas échéant). */
function tableColumns(table) {
  var def = SCHEMA[table];
  if (!def) throw new PpmError('NOT_FOUND', 'Table inconnue : ' + table);
  return def.tech === false ? def.cols.slice() : def.cols.concat(TECH_COLS);
}

/** Champs suivis par le journal : colonnes métier hors id, plus l'indicateur de suppression. */
function businessFields(table) {
  var def = SCHEMA[table];
  var fields = def.cols.filter(function (c) { return c !== 'id'; });
  if (def.tech !== false) fields.push('deleted');
  return fields;
}

/** Champs calculés par le Core (section 5). */
function applyComputed(table, rec) {
  if (table === 'Resource') {
    // Fonction et organisation : espaces superflus retirés, pour que « Alpha » et « Alpha  » ne fassent pas deux valeurs.
    ['job_function', 'organization'].forEach(function (c) {
      if (typeof rec[c] === 'string') rec[c] = rec[c].replace(/\s+/g, ' ').trim();
    });
  }
  if (table === 'RiskOpportunity') {
    var p = Number(rec.probability), i = Number(rec.impact);
    rec.score = (p >= 1 && i >= 1) ? p * i : '';
  }
  if (table === 'BudgetLine') {
    if (rec.cost_type === 'TJM') {
      var days = Number(rec.planned_days || 0), rate = Number(rec.frozen_rate || 0);
      rec.planned_amount = round2(days * rate);
    } else if (rec.cost_type === 'Forfait') {
      rec.planned_amount = round2(Number(rec.fixed_amount || 0));
    }
  }
  if (table === 'PlanItem' && rec.item_type === 'Jalon' && !isBlank(rec.planned_finish) && isBlank(rec.planned_start)) {
    rec.planned_start = rec.planned_finish;
  }
  return rec;
}

/** Contrôle d'un enregistrement complet. Lève PpmError('VALIDATION') avec la liste des problèmes. */
function validateRecord(table, rec) {
  var def = SCHEMA[table];
  var problems = [];
  (def.required || []).forEach(function (c) {
    if (isBlank(rec[c])) problems.push({ field: c, issue: 'obligatoire' });
  });
  Object.keys(def.enums || {}).forEach(function (c) {
    var v = rec[c];
    if (!isBlank(v) && def.enums[c].indexOf(String(v)) < 0) {
      problems.push({ field: c, issue: 'valeur non autorisée : ' + v });
    }
  });
  def.cols.forEach(function (c) {
    var v = rec[c];
    if (isBlank(v)) return;
    if (DATE_COLS.indexOf(c) >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      problems.push({ field: c, issue: 'date attendue au format AAAA-MM-JJ' });
    }
    if (TEXT_MAX_LENGTH[c] && String(v).length > TEXT_MAX_LENGTH[c]) {
      problems.push({ field: c, issue: 'maximum ' + TEXT_MAX_LENGTH[c] + ' caractères' });
    }
    var rule = NUMBER_RULES[c];
    if (rule) {
      var n = Number(v);
      if (isNaN(n)) { problems.push({ field: c, issue: 'nombre attendu' }); return; }
      if (rule.integer && Math.floor(n) !== n) problems.push({ field: c, issue: 'entier attendu' });
      if (rule.min !== undefined && n < rule.min) problems.push({ field: c, issue: 'minimum ' + rule.min });
      if (rule.max !== undefined && n > rule.max) problems.push({ field: c, issue: 'maximum ' + rule.max });
    }
  });
  if (table === 'Dependency' && !isBlank(rec.predecessor_id) && rec.predecessor_id === rec.successor_id) {
    problems.push({ field: 'successor_id', issue: 'un élément ne peut pas dépendre de lui-même' });
  }
  if (problems.length) {
    throw new PpmError('VALIDATION', 'Données invalides pour ' + table, problems);
  }
  return true;
}

// ======================================================================
// 02_Util.gs
// ======================================================================

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

// ======================================================================
// 03_Calendar.gs
// ======================================================================

/**
 * PPM Core — calendriers de jours ouvrés (H8 : France, Allemagne, Royaume-Uni, Inde).
 *
 * Toutes les dates sont des chaînes AAAA-MM-JJ, calculées en UTC pour éviter
 * tout décalage de fuseau. Les jours fériés sont calculés (Pâques par l'algorithme
 * grégorien anonyme), pas saisis à la main.
 *
 * Périmètre volontairement national :
 *  - FR : fériés légaux nationaux (hors Alsace-Moselle). Le lundi de Pentecôte est inclus ;
 *         si l'entreprise en fait sa journée de solidarité travaillée, le retirer du HolidaySet.
 *  - DE : fériés fédéraux uniquement (les fériés des Länder sont à ajouter par site).
 *  - UK : Angleterre et Pays de Galles, avec reports quand un férié tombe un week-end.
 *         Les fériés exceptionnels (événements royaux) sont à ajouter à la main.
 *  - IN : les trois fériés nationaux ; le reste varie selon l'État et se complète par site.
 */

var DAY_MS = 86400000;

function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new PpmError('VALIDATION', 'Date invalide : ' + s);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addCalendarDays(s, n) {
  return fmtYmd(parseYmd(s) + n * DAY_MS);
}

/** 0 = dimanche … 6 = samedi. */
function weekdayOf(s) {
  return new Date(parseYmd(s)).getUTCDay();
}

function ymd(year, month, day) {
  return fmtYmd(Date.UTC(year, month - 1, day));
}

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function easterSunday(year) {
  var a = year % 19;
  var b = Math.floor(year / 100), c = year % 100;
  var d = Math.floor(b / 4), e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** n-ième jour de semaine du mois (n = -1 : le dernier). weekday : 0 = dimanche. */
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    var first = ymd(year, month, 1);
    var offset = (weekday - weekdayOf(first) + 7) % 7;
    return addCalendarDays(first, offset + (n - 1) * 7);
  }
  var last = fmtYmd(Date.UTC(year, month, 0));
  var back = (weekdayOf(last) - weekday + 7) % 7;
  return addCalendarDays(last, -back);
}

function isWeekend(s) {
  var d = weekdayOf(s);
  return d === 0 || d === 6;
}

/**
 * Applique la règle britannique de report : un férié tombant un week-end passe
 * au premier jour de semaine libre suivant (en tenant compte des autres fériés).
 */
function withUkSubstitutes(list) {
  var taken = {};
  list.forEach(function (h) { if (!isWeekend(h.date)) taken[h.date] = true; });
  return list.map(function (h) {
    if (!isWeekend(h.date)) return h;
    var d = h.date;
    do { d = addCalendarDays(d, 1); } while (isWeekend(d) || taken[d]);
    taken[d] = true;
    return { date: d, label: h.label + ' (report)' };
  });
}

/** Liste des fériés d'un pays pour une année : [{date, label}], triée. */
function holidaysFor(country, year) {
  var E = easterSunday(year);
  var list;
  switch (country) {
    case 'FR':
      list = [
        { date: ymd(year, 1, 1), label: 'Jour de l’an' },
        { date: addCalendarDays(E, 1), label: 'Lundi de Pâques' },
        { date: ymd(year, 5, 1), label: 'Fête du Travail' },
        { date: ymd(year, 5, 8), label: 'Victoire 1945' },
        { date: addCalendarDays(E, 39), label: 'Ascension' },
        { date: addCalendarDays(E, 50), label: 'Lundi de Pentecôte' },
        { date: ymd(year, 7, 14), label: 'Fête nationale' },
        { date: ymd(year, 8, 15), label: 'Assomption' },
        { date: ymd(year, 11, 1), label: 'Toussaint' },
        { date: ymd(year, 11, 11), label: 'Armistice 1918' },
        { date: ymd(year, 12, 25), label: 'Noël' }
      ];
      break;
    case 'DE':
      list = [
        { date: ymd(year, 1, 1), label: 'Neujahr' },
        { date: addCalendarDays(E, -2), label: 'Karfreitag' },
        { date: addCalendarDays(E, 1), label: 'Ostermontag' },
        { date: ymd(year, 5, 1), label: 'Tag der Arbeit' },
        { date: addCalendarDays(E, 39), label: 'Christi Himmelfahrt' },
        { date: addCalendarDays(E, 50), label: 'Pfingstmontag' },
        { date: ymd(year, 10, 3), label: 'Tag der Deutschen Einheit' },
        { date: ymd(year, 12, 25), label: '1. Weihnachtstag' },
        { date: ymd(year, 12, 26), label: '2. Weihnachtstag' }
      ];
      break;
    case 'UK':
      list = withUkSubstitutes([
        { date: ymd(year, 1, 1), label: 'New Year’s Day' },
        { date: addCalendarDays(E, -2), label: 'Good Friday' },
        { date: addCalendarDays(E, 1), label: 'Easter Monday' },
        { date: nthWeekdayOfMonth(year, 5, 1, 1), label: 'Early May bank holiday' },
        { date: nthWeekdayOfMonth(year, 5, 1, -1), label: 'Spring bank holiday' },
        { date: nthWeekdayOfMonth(year, 8, 1, -1), label: 'Summer bank holiday' },
        { date: ymd(year, 12, 25), label: 'Christmas Day' },
        { date: ymd(year, 12, 26), label: 'Boxing Day' }
      ]);
      break;
    case 'IN':
      list = [
        { date: ymd(year, 1, 26), label: 'Republic Day' },
        { date: ymd(year, 8, 15), label: 'Independence Day' },
        { date: ymd(year, 10, 2), label: 'Gandhi Jayanti' }
      ];
      break;
    default:
      throw new PpmError('VALIDATION', 'Pays sans calendrier : ' + country);
  }
  return list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/** Transforme une liste de dates (ou de {date}) en dictionnaire de recherche. */
function holidayMap(list) {
  var map = {};
  (list || []).forEach(function (h) { map[typeof h === 'string' ? h : h.date] = true; });
  return map;
}

function isWorkingDay(s, hol) {
  return !isWeekend(s) && !(hol && hol[s]);
}

/** Premier jour ouvré à partir de s (s inclus). */
function nextWorkingDay(s, hol) {
  var d = s;
  while (!isWorkingDay(d, hol)) d = addCalendarDays(d, 1);
  return d;
}

/**
 * Avance (ou recule si n < 0) de n jours ouvrés. n = 0 renvoie s inchangé.
 */
function addWorkingDays(s, n, hol) {
  var step = n < 0 ? -1 : 1, count = Math.abs(n), d = s;
  while (count > 0) {
    d = addCalendarDays(d, step);
    if (isWorkingDay(d, hol)) count--;
  }
  return d;
}

/**
 * Nombre de jours ouvrés entre a et b, bornes incluses (négatif si b < a).
 */
function workingDaysBetween(a, b, hol) {
  if (a === b) return isWorkingDay(a, hol) ? 1 : 0;
  var sign = b < a ? -1 : 1;
  var from = sign > 0 ? a : b, to = sign > 0 ? b : a;
  var n = 0;
  for (var d = from; d <= to; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, hol)) n++;
  }
  return sign * n;
}

// ======================================================================
// 04_Graph.gs
// ======================================================================

/**
 * PPM Core — graphe des dépendances (section 5.2).
 * Fonctions pures : aucun accès aux classeurs.
 */

/** Construit la liste d'adjacence { from: [to, …] } à partir d'arêtes {from, to}. */
function adjacency(edges) {
  var adj = {};
  edges.forEach(function (e) {
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push(e.to);
  });
  return adj;
}

/** Existe-t-il un chemin de start à target ? (parcours en largeur, itératif) */
function hasPath(adj, start, target) {
  if (start === target) return true;
  var seen = {}, queue = [start];
  seen[start] = true;
  while (queue.length) {
    var node = queue.shift();
    var next = adj[node] || [];
    for (var i = 0; i < next.length; i++) {
      if (next[i] === target) return true;
      if (!seen[next[i]]) { seen[next[i]] = true; queue.push(next[i]); }
    }
  }
  return false;
}

/** Ajouter newEdge fermerait-il un cycle ? (vrai aussi pour une auto-dépendance) */
function wouldCreateCycle(edges, newEdge) {
  if (newEdge.from === newEdge.to) return true;
  return hasPath(adjacency(edges), newEdge.to, newEdge.from);
}

/** Renvoie un cycle existant (liste de nœuds) ou null. */
function findCycle(edges) {
  var adj = adjacency(edges);
  var state = {}, stack = [];
  var nodes = Object.keys(adj);
  for (var n = 0; n < nodes.length; n++) {
    if (state[nodes[n]]) continue;
    var work = [{ node: nodes[n], i: 0 }];
    state[nodes[n]] = 1; stack.push(nodes[n]);
    while (work.length) {
      var top = work[work.length - 1];
      var next = adj[top.node] || [];
      if (top.i < next.length) {
        var child = next[top.i++];
        if (state[child] === 1) return stack.slice(stack.indexOf(child)).concat([child]);
        if (!state[child]) { state[child] = 1; stack.push(child); work.push({ node: child, i: 0 }); }
      } else {
        state[top.node] = 2; stack.pop(); work.pop();
      }
    }
  }
  return null;
}

function itemStart(item) {
  return !isBlank(item.planned_start) ? item.planned_start : item.planned_finish;
}

function itemFinish(item) {
  return !isBlank(item.planned_finish) ? item.planned_finish : item.planned_start;
}

/**
 * Violations de dépendances sur les dates prévisionnelles.
 *   items : PlanItem[] ; deps : Dependency[] ;
 *   holFor(projectId) → dictionnaire des fériés du calendrier du successeur.
 * Conventions (jours ouvrés, décalage = lag_days) :
 *   FS : le successeur commence au plus tôt le jour ouvré suivant la fin du prédécesseur
 *        (le jour même si le prédécesseur est un jalon), + décalage ;
 *   SS : début ≥ début du prédécesseur + décalage ;
 *   FF : fin ≥ fin du prédécesseur + décalage ;
 *   SF : fin ≥ début du prédécesseur + décalage.
 * Renvoie [{ dependency_id, dep_type, predecessor_id, successor_id, field, required, actual, gap_days }].
 */
function dependencyViolations(items, deps, holFor) {
  var byId = {};
  items.forEach(function (it) { if (!isTrue(it.deleted)) byId[it.id] = it; });
  var out = [];
  deps.forEach(function (d) {
    if (isTrue(d.deleted)) return;
    var p = byId[d.predecessor_id], s = byId[d.successor_id];
    if (!p || !s) return;
    var lag = Math.round(Number(d.lag_days || 0));
    var hol = holFor ? holFor(s.project_id) : null;
    var ref, required, actual, field;
    switch (d.dep_type) {
      case 'FS':
        ref = itemFinish(p); actual = itemStart(s); field = 'planned_start';
        if (isBlank(ref) || isBlank(actual)) return;
        var offset = (p.item_type === 'Jalon' ? 0 : 1) + lag;
        required = offset === 0 ? nextWorkingDay(ref, hol) : addWorkingDays(ref, offset, hol);
        break;
      case 'SS':
        ref = itemStart(p); actual = itemStart(s); field = 'planned_start';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      case 'FF':
        ref = itemFinish(p); actual = itemFinish(s); field = 'planned_finish';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      case 'SF':
        ref = itemStart(p); actual = itemFinish(s); field = 'planned_finish';
        if (isBlank(ref) || isBlank(actual)) return;
        required = addWorkingDays(ref, lag, hol);
        break;
      default:
        return;
    }
    if (actual < required) {
      out.push({
        dependency_id: d.id, dep_type: d.dep_type, predecessor_id: p.id, successor_id: s.id,
        field: field, required: required, actual: actual,
        gap_days: workingDaysBetween(actual, required, hol) - (isWorkingDay(actual, hol) ? 1 : 0)
      });
    }
  });
  return out;
}

// ======================================================================
// 05_Rbac.gs
// ======================================================================

/**
 * PPM Core — droits contextualisés (section 7).
 *
 * Un droit détenu sur un périmètre vaut pour tout ce qu'il contient :
 *   programme ⊃ projet ⊃ workpackage (⊃ sous-WP) ⊃ livrable/jalon.
 * Les rôles se cumulent. Un « membre affecté » (MEMBER) l'est par affectation
 * explicite ou par une ligne budgétaire sur le livrable.
 *
 * Toutes les fonctions reçoivent un objet lookup, ce qui les rend testables :
 *   lookup.planitem(id), lookup.workpackage(id), lookup.project(id), lookup.risk(id)
 *   lookup.budgetMember(resourceId, planItemId) → booléen
 */

/**
 * Chaîne des périmètres englobants, du plus précis au plus large.
 * scope : { type: 'planitem'|'workpackage'|'project'|'program'|'risk'|'global', id }
 */
function scopeAncestors(scope, lookup) {
  var chain = [];
  var guard = 0;
  var cur = scope;
  while (cur && guard++ < 20) {
    chain.push(cur);
    cur = parentScope(cur, lookup);
  }
  return chain;
}

function parentScope(scope, lookup) {
  var rec;
  switch (scope.type) {
    case 'planitem':
      rec = lookup.planitem(scope.id);
      if (!rec) return null;
      return !isBlank(rec.wp_id) ? { type: 'workpackage', id: rec.wp_id } : { type: 'project', id: rec.project_id };
    case 'risk':
      rec = lookup.risk(scope.id);
      return rec ? { type: 'project', id: rec.project_id } : null;
    case 'workpackage':
      rec = lookup.workpackage(scope.id);
      if (!rec) return null;
      return !isBlank(rec.parent_wp_id) ? { type: 'workpackage', id: rec.parent_wp_id } : { type: 'project', id: rec.project_id };
    case 'project':
      rec = lookup.project(scope.id);
      return rec && !isBlank(rec.program_id) ? { type: 'program', id: rec.program_id } : null;
    default:
      return null;
  }
}

/** Affectations actives d'une ressource à une date donnée. */
function activeAssignments(resourceId, assignments, today) {
  return (assignments || []).filter(function (a) {
    if (isTrue(a.deleted) || a.resource_id !== resourceId) return false;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return false;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return false;
    return true;
  });
}

/**
 * L'utilisateur peut-il faire action sur scope ?
 * ctx : { resourceId, isAdmin, assignments (actives), lookup }
 */
function can(ctx, action, scope) {
  var allowed = PERMISSIONS[action];
  if (!allowed) throw new PpmError('CONFIG', 'Action sans règle de droits : ' + action);
  if (ctx.isAdmin) return true;
  if (allowed.indexOf('*') >= 0) return true;
  if (!ctx.resourceId) return false;

  var roles = ctx.assignments || [];

  if (!scope || scope.type === 'global') {
    return roles.some(function (a) { return allowed.indexOf(a.role_code) >= 0; });
  }

  var chain = scopeAncestors(scope, ctx.lookup);
  var granted = roles.some(function (a) {
    if (allowed.indexOf(a.role_code) < 0) return false;
    return chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
  });
  if (granted) return true;

  // Membre affecté par une ligne budgétaire sur le livrable visé.
  if (allowed.indexOf('MEMBER') >= 0 && scope.type === 'planitem' && ctx.lookup.budgetMember) {
    return ctx.lookup.budgetMember(ctx.resourceId, scope.id) === true;
  }
  return false;
}

/** Variante qui lève FORBIDDEN au lieu de renvoyer faux. */
function requireCan(ctx, action, scope) {
  if (!can(ctx, action, scope)) {
    throw new PpmError('FORBIDDEN', 'Droit insuffisant pour « ' + action + ' »', { scope: scope });
  }
}

// ======================================================================
// 06_Rules.gs
// ======================================================================

/**
 * PPM Core — moteur de règles déterministe (section 9).
 *
 * Produit des constats chiffrés et rattachés à une entité. Aucune IA ici :
 * Gemini ne fera que hiérarchiser et expliquer ces constats (lot 4), et
 * l'IA ne fait jamais d'action directe (H7).
 *
 * evaluateRules(data, today, holFor) → Insight[] (sans id ni statut)
 *   data : { projects, workpackages, planitems, dependencies, requirements, risks,
 *            baselineFinish?: { planItemId: date figée }, critical?: { planItemId: true } }
 */

function evaluateRules(data, today, holFor) {
  var out = [];
  var live = function (r) { return !isTrue(r.deleted); };
  var projects = (data.projects || []).filter(live);
  var activeProject = {};
  projects.forEach(function (p) { if (p.status !== 'Clos') activeProject[p.id] = p; });
  var items = (data.planitems || []).filter(function (i) { return live(i) && activeProject[i.project_id]; });
  var itemById = {};
  items.forEach(function (i) { itemById[i.id] = i; });

  function push(projectId, rule, severity, targetType, targetId, message, suggestion) {
    out.push({
      project_id: projectId, rule_code: rule, severity: severity, target_type: targetType,
      target_id: targetId, message: message, suggestion: suggestion, generated_on: today
    });
  }

  items.forEach(function (it) {
    var done = it.status === 'Terminé' || Number(it.progress_pct) >= 100;
    var label = (it.item_type === 'Jalon' ? 'Le jalon' : 'Le livrable') + ' « ' + it.name + ' »';

    if (!done && !isBlank(it.planned_finish) && it.planned_finish < today) {
      push(it.project_id, 'LATE_ITEM', 'Alerte', 'PlanItem', it.id,
        label + ' devait être terminé le ' + it.planned_finish + ' (avancement ' + (Number(it.progress_pct) || 0) + ' %).',
        'Déclarer l’avancement ou mettre à jour la prévision ; si le retard est confirmé, vérifier l’impact sur les successeurs.');
    }
    if (isBlank(it.owner_resource_id)) {
      push(it.project_id, 'MISSING_OWNER', 'Vigilance', 'PlanItem', it.id,
        label + ' n’a pas de responsable.', 'Désigner un responsable.');
    }
    if (isBlank(it.planned_finish)) {
      push(it.project_id, 'MISSING_DATE', 'Vigilance', 'PlanItem', it.id,
        label + ' n’a pas de date prévue.', 'Renseigner la date de fin prévue.');
    }
    if (it.item_type === 'Livrable' && !done && Number(it.progress_pct) > 0) {
      var last = !isBlank(it.last_progress_at) ? String(it.last_progress_at).slice(0, 10)
        : (!isBlank(it.created_at) ? String(it.created_at).slice(0, 10) : '');
      if (last && addCalendarDays(last, THRESHOLDS.staleProgressDays) < today) {
        push(it.project_id, 'STALE_PROGRESS', 'Vigilance', 'PlanItem', it.id,
          label + ' n’a pas été mis à jour depuis le ' + last + '.',
          'Relancer le responsable pour une déclaration d’avancement.');
      }
    }
  });

  // Glissement critique (section 9) : prévision au-delà de la baseline de plus de N jours ouvrés, sur le chemin critique.
  var baseFinish = data.baselineFinish || {}, critical = data.critical || {};
  items.forEach(function (it) {
    var bf = baseFinish[it.id];
    if (!bf || isBlank(it.planned_finish) || !critical[it.id] || it.status === 'Terminé' || Number(it.progress_pct) >= 100) return;
    var slip = workingDayOffset(bf, it.planned_finish, holFor(it.project_id));
    if (slip > THRESHOLDS.criticalSlipDays) {
      push(it.project_id, 'CRITICAL_SLIP', 'Alerte', 'PlanItem', it.id,
        (it.item_type === 'Jalon' ? 'Le jalon' : 'Le livrable') + ' « ' + it.name + ' », sur le chemin critique, finit le ' + it.planned_finish +
        ' : ' + slip + ' jours ouvrés après la baseline (' + bf + ').',
        'Chercher à rattraper le retard (renfort, re-séquencement) ou, s’il est acté, demander une nouvelle baseline.');
    }
  });

  // Signaux faibles : un commentaire d'avancement récent annonce un blocage avant que la date ne glisse.
  weakSignals_(data.progressUpdates || [], items.filter(function (i) { return activeProject[i.project_id]; }),
    addCalendarDays(today, -THRESHOLDS.staleProgressDays)).forEach(function (sig) {
    push(sig.item.project_id, 'WEAK_SIGNAL', 'Vigilance', 'PlanItem', sig.item.id,
      'Signal faible sur « ' + sig.item.name + ' » : le commentaire d’avancement du ' + sig.date + ' dit « ' + sig.comment + ' ».',
      'Vérifier avec le responsable si la date de fin tient toujours.');
  });

  // Commandes d'achat : GR à faire, PO à lancer, dépassement du budget externe (calculés par poFindings_, sans montant).
  (data.poFindings || []).forEach(function (f) {
    if (activeProject[f.projectId]) push(f.projectId, f.rule, f.severity, f.targetType, f.targetId, f.message, f.suggestion);
  });

  // Projet actif, planifié, sans baseline : les écarts ne peuvent pas être mesurés.
  projects.forEach(function (p) {
    if (p.status !== 'Actif' || !isBlank(p.active_baseline_id)) return;
    var dated = items.some(function (i) { return i.project_id === p.id && !isBlank(i.planned_finish); });
    if (dated) {
      push(p.id, 'NO_BASELINE', 'Info', 'Project', p.id,
        'Le projet « ' + p.name + ' » n’a pas de baseline : ses écarts ne sont pas mesurés.',
        'Figer la baseline B0 depuis la page Suivi, une fois le planning validé.');
    }
  });

  dependencyViolations(items, (data.dependencies || []).filter(live), holFor).forEach(function (v) {
    var s = itemById[v.successor_id], p = itemById[v.predecessor_id];
    push(s.project_id, 'DEPENDENCY_VIOLATION', 'Alerte', 'Dependency', v.dependency_id,
      '« ' + s.name + ' » (' + v.actual + ') est placé avant la date permise par « ' + p.name + ' » (' +
      v.required + ', lien ' + v.dep_type + ').',
      'Décaler « ' + s.name + ' » de ' + v.gap_days + ' jour(s) ouvré(s) ou revoir la dépendance ; décision du chef de projet.');
  });

  (data.requirements || []).filter(live).forEach(function (r) {
    var ms = itemById[r.milestone_id], dl = itemById[r.deliverable_id];
    if (!ms || !dl) return;
    var dlDone = dl.status === 'Terminé' || Number(dl.progress_pct) >= 100;
    if (dlDone) return;
    if (!isBlank(ms.actual_finish)) {
      push(ms.project_id, 'MILESTONE_INCOMPLETE', 'Alerte', 'PlanItem', ms.id,
        'Le jalon « ' + ms.name + ' » est marqué atteint alors que « ' + dl.name + ' » n’est pas terminé.',
        'Vérifier le passage du jalon ou terminer le livrable requis.');
    } else if (!isBlank(dl.planned_finish) && !isBlank(ms.planned_finish) && dl.planned_finish > ms.planned_finish) {
      push(ms.project_id, 'MILESTONE_THREATENED', 'Alerte', 'PlanItem', ms.id,
        'Le jalon « ' + ms.name + ' » (' + ms.planned_finish + ') est menacé : « ' + dl.name + ' » finit le ' + dl.planned_finish + '.',
        'Accélérer le livrable, décaler le jalon ou retirer le livrable des prérequis.');
    }
  });

  (data.risks || []).filter(function (r) { return live(r) && activeProject[r.project_id] && r.status !== 'Clos'; })
    .forEach(function (r) {
      var late = [];
      if (!isBlank(r.review_date) && r.review_date < today) late.push('revue prévue le ' + r.review_date);
      if (!isBlank(r.treatment_due) && r.treatment_due < today) late.push('traitement attendu le ' + r.treatment_due);
      if (late.length) {
        push(r.project_id, 'RISK_OVERDUE', 'Vigilance', 'RiskOpportunity', r.id,
          (r.kind === 'Opportunité' ? 'L’opportunité' : 'Le risque') + ' « ' + r.title + ' » est en retard : ' + late.join(', ') + '.',
          'Revoir la fiche avec son responsable et mettre à jour les dates.');
      }
    });

  var wpHasContent = {};
  items.forEach(function (i) { if (!isBlank(i.wp_id)) wpHasContent[i.wp_id] = true; });
  (data.workpackages || []).filter(live).forEach(function (w) {
    if (!isBlank(w.parent_wp_id)) wpHasContent[w.parent_wp_id] = true;
  });
  (data.workpackages || []).filter(function (w) { return live(w) && activeProject[w.project_id]; }).forEach(function (w) {
    if (!wpHasContent[w.id]) {
      push(w.project_id, 'EMPTY_WP', 'Info', 'WorkPackage', w.id,
        'Le workpackage « ' + w.name + ' » ne contient aucun livrable ni jalon.',
        'Ajouter ses livrables ou le supprimer.');
    }
  });

  return out;
}

/**
 * Fusionne les constats du jour avec les Insights existants.
 * Clé = rule_code + target_id.
 *   - un constat déjà « Ignoré » ou « Accepté » n'est pas recréé ;
 *   - un « Nouveau » existant est mis à jour (même id) ;
 *   - un « Nouveau » qui n'est plus constaté disparaît (le problème est résolu).
 * Renvoie la liste complète à écrire.
 */
function mergeInsights(existing, fresh, actor) {
  var byKey = {};
  var kept = [];
  (existing || []).forEach(function (e) {
    if (isTrue(e.deleted)) return;
    if (e.status === 'Nouveau') byKey[e.rule_code + '|' + e.target_id] = e;
    else kept.push(e);
  });
  var closedKeys = {};
  kept.forEach(function (e) { closedKeys[e.rule_code + '|' + e.target_id] = true; });
  var now = nowIso();
  var result = kept.slice();
  fresh.forEach(function (f) {
    var key = f.rule_code + '|' + f.target_id;
    if (closedKeys[key]) return;
    var prev = byKey[key];
    var rec = Object.assign({}, f, {
      id: prev ? prev.id : newId(),
      status: 'Nouveau',
      created_at: prev ? prev.created_at : now,
      created_by: prev ? prev.created_by : actor,
      updated_at: now,
      updated_by: actor,
      version: prev ? Number(prev.version || 1) + 1 : 1,
      deleted: false
    });
    result.push(rec);
  });
  return result;
}

// ======================================================================
// 07_Schedule.gs
// ======================================================================

/**
 * PPM Core — marges et chemin critique (section 5.2, lot 1).
 * Fonctions pures : aucun accès aux classeurs.
 *
 * Le planning n'est jamais recalculé (H7) : on part des dates saisies et on calcule,
 * pour chaque élément, la date de fin au plus tard qui ne retarde ni un successeur
 * ni la fin du plan. La marge totale est l'écart, en jours ouvrés, entre la fin
 * prévue et cette fin au plus tard.
 *   marge > 0 : l'élément peut glisser d'autant sans rien décaler ;
 *   marge = 0 : il est sur le chemin critique ;
 *   marge < 0 : il retarde déjà un successeur (dépendance violée).
 *
 * Conventions de dépendance identiques à dependencyViolations (04_Graph.gs).
 */

/** Nombre de pas en jours ouvrés pour aller de a à b (0 si a = b, négatif si b < a). */
function workingDayOffset(a, b, hol) {
  if (a === b) return 0;
  var sign = b > a ? 1 : -1;
  var n = 0;
  var d = a;
  while (d !== b) {
    d = addCalendarDays(d, sign);
    if (isWorkingDay(d, hol)) n++;
  }
  return sign * n;
}

/** Durée en jours ouvrés, bornes incluses ; 0 pour un jalon. */
function itemDuration(item, hol) {
  if (item.item_type === 'Jalon') return 0;
  var s = itemStart(item), f = itemFinish(item);
  if (isBlank(s) || isBlank(f)) return 0;
  return Math.max(1, workingDaysBetween(s, f, hol));
}

/** Début au plus tard correspondant à une fin au plus tard, pour une durée donnée. */
function lateStartFrom(lf, dur, hol) {
  return dur <= 1 ? lf : addWorkingDays(lf, -(dur - 1), hol);
}

/** Fin au plus tard correspondant à un début au plus tard. */
function lateFinishFrom(ls, dur, hol) {
  return dur <= 1 ? ls : addWorkingDays(ls, dur - 1, hol);
}

/**
 * items  : PlanItem[] du périmètre (projet ou programme), plus d'éventuels voisins
 *          d'autres projets marqués external: true (leurs dates sont des contraintes fixes).
 * deps   : Dependency[] ;
 * holFor(projectId) → fériés du calendrier du projet de l'élément ;
 * opts.anchor : date de fin de référence (par défaut la fin prévue la plus tardive du périmètre).
 *
 * Renvoie { anchor, byId: { id: { lateFinish, lateStart, float, critical } }, criticalIds }.
 * Les éléments sans dates, terminés ou externes n'ont pas de marge (float null).
 */
function computeFloats(items, deps, holFor, opts) {
  opts = opts || {};
  var byId = {}, list = [];
  items.forEach(function (it) {
    if (isTrue(it.deleted)) return;
    byId[it.id] = it;
    list.push(it);
  });
  var dated = function (it) { return !isBlank(itemStart(it)) && !isBlank(itemFinish(it)); };

  var anchor = opts.anchor || '';
  if (!anchor) {
    list.forEach(function (it) {
      if (!it.external && dated(it) && itemFinish(it) > anchor) anchor = itemFinish(it);
    });
  }

  // Successeurs de chaque élément (dépendances entre éléments connus seulement).
  var succ = {}, indeg = {};
  list.forEach(function (it) { succ[it.id] = []; indeg[it.id] = 0; });
  (deps || []).forEach(function (d) {
    if (isTrue(d.deleted) || !byId[d.predecessor_id] || !byId[d.successor_id]) return;
    succ[d.predecessor_id].push(d);
    indeg[d.successor_id]++;
  });

  // Ordre topologique (Kahn), puis parcours à rebours.
  var order = [], queue = [];
  list.forEach(function (it) { if (indeg[it.id] === 0) queue.push(it.id); });
  var remaining = {};
  Object.keys(indeg).forEach(function (k) { remaining[k] = indeg[k]; });
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    succ[id].forEach(function (d) {
      if (--remaining[d.successor_id] === 0) queue.push(d.successor_id);
    });
  }
  // Un cycle résiduel (normalement impossible) : ses éléments restent sans marge.

  var late = {};
  for (var k = order.length - 1; k >= 0; k--) {
    var it = byId[order[k]];
    if (!dated(it)) continue;
    var hol = holFor ? holFor(it.project_id) : null;
    var dur = itemDuration(it, hol);

    if (it.external) {
      late[it.id] = { lateStart: itemStart(it), lateFinish: itemFinish(it) };
      continue;
    }

    var lf = anchor || itemFinish(it);
    succ[it.id].forEach(function (d) {
      var s = late[d.successor_id];
      if (!s) return; // successeur sans dates : pas de contrainte
      var shol = holFor ? holFor(byId[d.successor_id].project_id) : null;
      var lag = Math.round(Number(d.lag_days || 0));
      var limit;
      switch (d.dep_type) {
        case 'FS':
          var offset = (it.item_type === 'Jalon' ? 0 : 1) + lag;
          limit = offset === 0 ? s.lateStart : addWorkingDays(s.lateStart, -offset, shol);
          break;
        case 'SS':
          limit = lateFinishFrom(addWorkingDays(s.lateStart, -lag, shol), dur, hol);
          break;
        case 'FF':
          limit = addWorkingDays(s.lateFinish, -lag, shol);
          break;
        case 'SF':
          limit = lateFinishFrom(addWorkingDays(s.lateFinish, -lag, shol), dur, hol);
          break;
        default:
          return;
      }
      if (limit < lf) lf = limit;
    });
    late[it.id] = { lateStart: lateStartFrom(lf, dur, hol), lateFinish: lf };
  }

  var result = {}, criticalIds = [];
  list.forEach(function (it) {
    var l = late[it.id];
    var done = it.status === 'Terminé' || Number(it.progress_pct) >= 100;
    if (!l || it.external || done) {
      result[it.id] = { lateStart: l ? l.lateStart : null, lateFinish: l ? l.lateFinish : null, float: null, critical: false };
      return;
    }
    var hol = holFor ? holFor(it.project_id) : null;
    var fl = workingDayOffset(itemFinish(it), l.lateFinish, hol);
    var critical = fl <= 0;
    result[it.id] = { lateStart: l.lateStart, lateFinish: l.lateFinish, float: fl, critical: critical };
    if (critical) criticalIds.push(it.id);
  });
  return { anchor: anchor || null, byId: result, criticalIds: criticalIds };
}

// ======================================================================
// 10_Repository.gs
// ======================================================================

/**
 * PPM Core — accès aux données.
 *
 * Un « adaptateur de table » cache Sheets derrière une interface simple :
 *   headers(), readAll(), findRow(id) → n° de ligne (≥ 2) ou -1,
 *   readRow(n), writeRow(n, obj), appendRows(objs), replaceAll(objs)
 * Les tests remplacent l'adaptateur par une version en mémoire (TABLE_PROVIDER).
 *
 * Toute écriture du Core passe par repoInsert / repoUpdate : verrou, version
 * (verrouillage optimiste), champs calculés, contrôle, journal et crochets métier.
 */

var TABLE_PROVIDER = null;
var _tableCache = {};
var _bookCache = {};

function getTable(name) {
  return cachedTable_(name, function () {
    if (TABLE_PROVIDER) return TABLE_PROVIDER(name);
    if (!_tableCache[name]) _tableCache[name] = sheetTable_(name);
    return _tableCache[name];
  });
}

// ---------------------------------------------------------------- cache des lectures (performance)
//
// Lire une table dans Sheets coûte 2 à 3 appels au serveur (0,1 à 0,3 s chacun). Deux niveaux évitent de relire :
//   - mémoire de l'exécution : une table n'est lue qu'une fois par requête ;
//   - cache du script (CacheService), partagé entre requêtes : la table y est rangée par morceaux, sous un
//     numéro de génération. Toute écriture par le Core change la génération (la table sera relue) ;
//     une saisie AppSheet fait de même via onRowChanged. Par sécurité, rien n'y reste plus de 5 minutes.
// Les lectures ponctuelles (findRow, readRow) vont toujours dans Sheets.

var CACHE_PROVIDER = null;      // tests : faux cache { get, getAll, put, putAll }
var CACHE_TTL_S = 300;
var CACHE_CHUNK = 90000;        // un élément du cache est limité à 100 Ko
var CACHE_MAX_CHUNKS = 20;      // au-delà (~1,8 Mo), la table n'est pas mise en cache
var _rowsMemo = {};

function scriptCache_() {
  if (CACHE_PROVIDER) return CACHE_PROVIDER;
  if (TABLE_PROVIDER || typeof CacheService === 'undefined') return null;
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

/** Début d'une exécution (requête, page, déclencheur) : on oublie ce qui a été lu par la précédente. */
function resetExecution_() {
  _rowsMemo = {};
  _propsMemo = null;
}

function cachedTable_(name, base) {
  var touched = function () { invalidateTable_(name); };
  return {
    name: name,
    headers: function () { return base().headers(); },
    readAll: function () { return readAllCached_(name, base); },
    findRow: function (id) { return base().findRow(id); },
    readRow: function (n) { return base().readRow(n); },
    writeRow: function (n, o) { base().writeRow(n, o); touched(); },
    appendRows: function (objs) { base().appendRows(objs); touched(); },
    updateRows: function (list) { base().updateRows(list); touched(); },
    replaceAll: function (objs) { base().replaceAll(objs); touched(); },
    get _rows() { return base()._rows; } // tests : accès direct aux lignes en mémoire
  };
}

function newGen_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readAllCached_(name, base) {
  // Tests sans faux cache : lecture directe (ils modifient parfois les lignes en mémoire sans passer par le Core).
  if (TABLE_PROVIDER && !CACHE_PROVIDER) return base().readAll();
  if (_rowsMemo[name] !== undefined) return JSON.parse(_rowsMemo[name]);
  var cache = scriptCache_();
  var json = cache ? cacheGetRows_(cache, name) : null;
  if (json === null) {
    json = JSON.stringify(base().readAll());
    if (cache) cachePutRows_(cache, name, json);
  }
  _rowsMemo[name] = json;
  return JSON.parse(json);
}

/** Valeur « génération|nombre de morceaux » ; nombre -1 = table à relire. */
function parseGen_(v) {
  if (!v) return null;
  var i = String(v).lastIndexOf('|');
  return { gen: String(v).slice(0, i), n: Number(String(v).slice(i + 1)) };
}

function chunkKeys_(name, gen, n) {
  var keys = [];
  for (var i = 0; i < n; i++) keys.push('rows:' + name + ':' + gen + ':' + i);
  return keys;
}

function cacheGetRows_(cache, name) {
  try {
    var g = parseGen_(cache.get('gen:' + name));
    if (!g || !(g.n > 0)) return null;
    var keys = chunkKeys_(name, g.gen, g.n);
    var parts = cache.getAll(keys);
    var out = '';
    for (var i = 0; i < keys.length; i++) {
      if (parts[keys[i]] === undefined || parts[keys[i]] === null) return null;
      out += parts[keys[i]];
    }
    return out;
  } catch (e) {
    return null;
  }
}

function cachePutRows_(cache, name, json) {
  try {
    var n = Math.max(1, Math.ceil(json.length / CACHE_CHUNK));
    if (n > CACHE_MAX_CHUNKS) return;
    var g = parseGen_(cache.get('gen:' + name));
    var gen = g ? g.gen : newGen_();
    var values = {};
    chunkKeys_(name, gen, n).forEach(function (k, i) { values[k] = json.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK); });
    cache.putAll(values, CACHE_TTL_S);
    cache.put('gen:' + name, gen + '|' + n, CACHE_TTL_S);
  } catch (e) {
    /* le cache est une optimisation : une panne ne doit jamais bloquer une lecture */
  }
}

/** Après une écriture : la table sera relue dans Sheets, par cette exécution comme par les suivantes. */
function invalidateTable_(name) {
  delete _rowsMemo[name];
  var cache = scriptCache_();
  if (!cache) return;
  try { cache.put('gen:' + name, newGen_() + '|-1', CACHE_TTL_S); } catch (e) { /* voir cachePutRows_ */ }
}

/** Invalide toutes les tables (réconciliation nocturne, restauration, installation). */
function invalidateAllTables_() {
  Object.keys(SCHEMA).forEach(invalidateTable_);
}

/**
 * Remplit la mémoire de l'exécution avec les tables déjà en cache, en deux appels au lieu de deux par table.
 * Les tables absentes du cache seront lues dans Sheets au premier usage.
 */
function prefetchTables_(names) {
  var cache = scriptCache_();
  if (!cache) return;
  try {
    var todo = names.filter(function (n) { return _rowsMemo[n] === undefined && SCHEMA[n]; });
    if (!todo.length) return;
    var gens = cache.getAll(todo.map(function (n) { return 'gen:' + n; }));
    var want = {}, keys = [];
    todo.forEach(function (n) {
      var g = parseGen_(gens['gen:' + n]);
      if (!g || !(g.n > 0)) return;
      want[n] = chunkKeys_(n, g.gen, g.n);
      keys = keys.concat(want[n]);
    });
    if (!keys.length) return;
    var parts = cache.getAll(keys);
    Object.keys(want).forEach(function (n) {
      var out = '';
      for (var i = 0; i < want[n].length; i++) {
        var v = parts[want[n][i]];
        if (v === undefined || v === null) return;
        out += v;
      }
      _rowsMemo[n] = out;
    });
  } catch (e) {
    /* voir cachePutRows_ */
  }
}

/** Tables lues par presque toutes les requêtes des pages. */
var HOT_TABLES = ['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'Resource', 'RoleAssignment',
  'HierarchicalTeam', 'HolidaySet', 'UserSetting', 'Baseline', 'Insight', 'MilestoneRequirement', 'RiskOpportunity',
  'Role', 'BudgetLine', 'BaselineItem'];

function bookId_(book) {
  var id = getProp(book === 'data' ? PROP.DATA_ID : PROP.HISTORY_ID, '');
  if (!id) throw new PpmError('CONFIG', 'Classeurs non initialisés : exécuter setupPpm().');
  return id;
}

function openBook_(book) {
  if (!_bookCache[book]) _bookCache[book] = SpreadsheetApp.openById(bookId_(book));
  return _bookCache[book];
}

function sheetTable_(name) {
  var def = SCHEMA[name];
  if (!def) throw new PpmError('NOT_FOUND', 'Table inconnue : ' + name);
  var sh = openBook_(def.book).getSheetByName(name);
  if (!sh) throw new PpmError('CONFIG', 'Feuille manquante : ' + name + ' (relancer setupPpm).');
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  function toObj(row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = normalizeValue(row[i]); });
    return o;
  }
  function toRow(obj) {
    return headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  }
  function dataRows() { return Math.max(0, sh.getLastRow() - 1); }

  return {
    name: name,
    headers: function () { return headers.slice(); },
    readAll: function () {
      var n = dataRows();
      if (n === 0) return [];
      return sh.getRange(2, 1, n, headers.length).getValues().map(toObj);
    },
    findRow: function (id) {
      if (isBlank(id) || dataRows() === 0) return -1;
      var cell = sh.getRange(2, 1, dataRows(), 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
      return cell ? cell.getRow() : -1;
    },
    readRow: function (r) { return toObj(sh.getRange(r, 1, 1, headers.length).getValues()[0]); },
    writeRow: function (r, obj) { sh.getRange(r, 1, 1, headers.length).setValues([toRow(obj)]); },
    appendRows: function (objs) {
      if (!objs.length) return;
      sh.getRange(sh.getLastRow() + 1, 1, objs.length, headers.length).setValues(objs.map(toRow));
    },
    /** Réécrit plusieurs lignes ; les lignes consécutives partent en une seule écriture. */
    updateRows: function (list) {
      var sorted = list.slice().sort(function (a, b) { return a.row - b.row; });
      var i = 0;
      while (i < sorted.length) {
        var j = i;
        while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++;
        var chunk = sorted.slice(i, j + 1);
        sh.getRange(chunk[0].row, 1, chunk.length, headers.length).setValues(chunk.map(function (c) { return toRow(c.obj); }));
        i = j + 1;
      }
    },
    replaceAll: function (objs) {
      var n = dataRows();
      if (n > 0) sh.getRange(2, 1, n, headers.length).clearContent();
      if (objs.length) sh.getRange(2, 1, objs.length, headers.length).setValues(objs.map(toRow));
    }
  };
}

/** Verrou de script ré-entrant : une seule écriture à la fois, sans auto-blocage. */
var _lockDepth = 0;
function withLock(fn) {
  if (_lockDepth > 0 || TABLE_PROVIDER || typeof LockService === 'undefined') {
    _lockDepth++;
    try { return fn(); } finally { _lockDepth--; }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new PpmError('BUSY', 'Le système est occupé, réessayez dans un instant.');
  _lockDepth++;
  try { return fn(); } finally { _lockDepth--; lock.releaseLock(); }
}

// ---------------------------------------------------------------- lecture

function repoGet(table, id) {
  if (_rowsMemo[table] !== undefined && !isBlank(id)) {
    var hit = JSON.parse(_rowsMemo[table]).filter(function (r) { return String(r.id) === String(id); })[0];
    if (hit) return hit;
  }
  var t = getTable(table);
  var r = t.findRow(id);
  return r < 0 ? null : t.readRow(r);
}

function repoList(table, filter, opts) {
  var rows = getTable(table).readAll();
  if (isLiveTable(table) && !(opts && opts.includeDeleted)) {
    rows = rows.filter(function (r) { return !isTrue(r.deleted); });
  }
  return filter ? rows.filter(filter) : rows;
}

// ---------------------------------------------------------------- écriture

/** actx : { actor: e-mail, source: 'api' | 'appsheet' | 'core' | 'setup' | 'addon:<id>' } */
function repoInsert(table, values, actx) {
  return withLock(function () {
    var def = SCHEMA[table];
    if (!def) throw new PpmError('NOT_FOUND', 'Table inconnue : ' + table);
    var rec = {};
    tableColumns(table).forEach(function (c) { rec[c] = ''; });
    Object.keys(values || {}).forEach(function (k) {
      if (def.cols.indexOf(k) >= 0) rec[k] = values[k] === null || values[k] === undefined ? '' : values[k];
    });
    if (isBlank(rec.id)) rec.id = newId();
    applyComputed(table, rec);
    validateRecord(table, rec);
    var t = getTable(table);
    if (t.findRow(rec.id) >= 0) throw new PpmError('CONFLICT', 'Identifiant déjà utilisé : ' + rec.id);
    if (isLiveTable(table)) {
      var now = nowIso();
      rec.created_at = now; rec.created_by = actx.actor;
      rec.updated_at = now; rec.updated_by = actx.actor;
      rec.version = 1; rec.deleted = false;
    }
    t.appendRows([rec]);
    if (isLoggedTable(table)) recordChanges(table, null, rec, actx);
    if (isLiveTable(table)) runHooks(table, null, rec, actx);
    return rec;
  });
}

/**
 * Mise à jour partielle. expectedVersion (facultatif) protège contre l'écrasement
 * d'une modification concurrente : si la ligne a changé depuis la lecture → CONFLICT.
 */
function repoUpdate(table, id, patch, expectedVersion, actx) {
  return withLock(function () {
    var def = SCHEMA[table];
    if (!isLiveTable(table)) throw new PpmError('VALIDATION', 'Table en ajout seul : ' + table);
    var t = getTable(table);
    var r = t.findRow(id);
    if (r < 0) throw new PpmError('NOT_FOUND', table + ' introuvable : ' + id);
    var before = t.readRow(r);
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '' &&
        Number(expectedVersion) !== Number(before.version)) {
      throw new PpmError('CONFLICT', 'La ligne a été modifiée entre-temps.', { currentVersion: Number(before.version) });
    }
    var after = Object.assign({}, before);
    var writable = def.cols.concat(['deleted']);
    Object.keys(patch || {}).forEach(function (k) {
      if (k !== 'id' && writable.indexOf(k) >= 0) after[k] = patch[k] === null || patch[k] === undefined ? '' : patch[k];
    });
    applyComputed(table, after);
    validateRecord(table, after);
    if (!diffRecords(before, after, businessFields(table)).length) return before;
    after.version = Number(before.version || 0) + 1;
    after.updated_at = nowIso();
    after.updated_by = actx.actor;
    t.writeRow(r, after);
    if (isLoggedTable(table)) recordChanges(table, before, after, actx);
    runHooks(table, before, after, actx);
    return after;
  });
}

function repoSoftDelete(table, id, expectedVersion, actx) {
  return repoUpdate(table, id, { deleted: true }, expectedVersion, actx);
}

/** Ajout en lot dans une table d'historique (sans contrôle ligne à ligne). */
function repoAppendHistory(table, recs) {
  if (isLiveTable(table)) throw new PpmError('VALIDATION', 'Table vivante : utiliser repoInsert.');
  if (recs.length) getTable(table).appendRows(recs);
}

// ======================================================================
// 11_ChangeLog.gs
// ======================================================================

/**
 * PPM Core — traçabilité (sections 5.3 et 13).
 *
 * Deux chemins d'écriture existent :
 *  1. le Core (API, traitements) : repoInsert/repoUpdate journalisent eux-mêmes ;
 *  2. AppSheet, qui écrit directement dans le classeur : chaque bot appelle
 *     onRowChanged(table, id, USEREMAIL()). Le Core compare la ligne à son
 *     instantané (_Snapshot), journalise les écarts, incrémente la version et
 *     déclenche les crochets métier. Une réconciliation nocturne rattrape les
 *     appels manqués.
 */

function diffRecords(before, after, fields) {
  var out = [];
  fields.forEach(function (f) {
    var a = canonical(before ? before[f] : ''), b = canonical(after ? after[f] : '');
    if (a !== b) out.push({ field: f, oldValue: a, newValue: b });
  });
  return out;
}

/** Projet de rattachement d'une ligne, pour filtrer le fil des changements du chef de projet. */
function projectIdOf(table, rec) {
  if (!rec) return '';
  try {
    switch (table) {
      case 'Project': return rec.id;
      case 'WorkPackage': case 'PlanItem': case 'RiskOpportunity': case 'Baseline': case 'Insight':
        return rec.project_id || '';
      case 'Dependency': {
        var s = repoGet('PlanItem', rec.successor_id);
        return s ? s.project_id : '';
      }
      case 'BudgetLine': case 'ProgressUpdate': {
        var d = repoGet('PlanItem', rec.deliverable_id);
        return d ? d.project_id : '';
      }
      case 'PurchaseOrder': {
        var owner = cpnOwner_(rec.cpn);
        return owner ? owner.project.id : '';
      }
      case 'MilestoneRequirement': {
        var m = repoGet('PlanItem', rec.milestone_id);
        return m ? m.project_id : '';
      }
      case 'RoleAssignment':
        if (rec.scope_type === 'project') return rec.scope_id;
        if (rec.scope_type === 'workpackage') {
          var w = repoGet('WorkPackage', rec.scope_id);
          return w ? w.project_id : '';
        }
        return '';
      default: return '';
    }
  } catch (e) {
    return '';
  }
}

function buildChangeEvents(table, before, after, actx) {
  var at = nowIso();
  var ref = after || before;
  var base = {
    at: at, table_name: table, entity_id: ref.id, project_id: projectIdOf(table, ref),
    actor: actx.actor, source: actx.source, acknowledged: false
  };
  if (!before) return [Object.assign({ id: newId(), field: '*', old_value: '', new_value: '(création)' }, base)];
  if (!after) return [Object.assign({ id: newId(), field: '*', old_value: '(ligne)', new_value: '(suppression)' }, base)];
  return diffRecords(before, after, businessFields(table)).map(function (d) {
    return Object.assign({
      id: newId(), field: d.field, old_value: truncate(d.oldValue, 500), new_value: truncate(d.newValue, 500)
    }, base);
  });
}

// ---------------------------------------------------------------- instantanés

function snapshotKey(table, id) {
  return table + ':' + id;
}

function snapshotGet(table, id) {
  var row = repoGet('_Snapshot', snapshotKey(table, id));
  return row ? parseJsonSafe(row.json, null) : null;
}

function snapshotPut(table, rec) {
  var fields = businessFields(table);
  var json = stableJson(rec, fields);
  var key = snapshotKey(table, rec.id);
  var t = getTable('_Snapshot');
  var obj = { id: key, table_name: table, entity_id: rec.id, hash: hashString(json), json: json, updated_at: nowIso() };
  var r = t.findRow(key);
  if (r < 0) t.appendRows([obj]); else t.writeRow(r, obj);
}

function snapshotDelete(table, id) {
  var t = getTable('_Snapshot');
  var r = t.findRow(snapshotKey(table, id));
  if (r >= 0) t.writeRow(r, { id: snapshotKey(table, id), table_name: table, entity_id: id, hash: 'DELETED', json: '', updated_at: nowIso() });
}

/** Journalise un changement et met l'instantané à jour. */
function recordChanges(table, before, after, actx) {
  var events = buildChangeEvents(table, before, after, actx);
  if (events.length) repoAppendHistory('ChangeEvent', events);
  if (after) snapshotPut(table, after); else snapshotDelete(table, before.id);
  return events.length;
}

// ---------------------------------------------------------------- AppSheet

/**
 * Point d'entrée des bots AppSheet (tâche « Call a script »).
 * Paramètres : nom de table, [id] de la ligne, USEREMAIL().
 * Renvoie CREATED | UPDATED | DELETED | UNCHANGED | IGNORED.
 */
function onRowChanged(tableName, rowId, actorEmail) {
  resetExecution_();
  if (SCHEMA[tableName]) invalidateTable_(tableName); // AppSheet a écrit directement dans la feuille
  if (!isLoggedTable(tableName)) return 'IGNORED';
  var actx = { actor: String(actorEmail || 'appsheet').toLowerCase(), source: 'appsheet' };
  return withLock(function () { return syncRow(tableName, rowId, actx); });
}

/** Compare une ligne à son instantané et applique journal, version et crochets. */
function syncRow(tableName, rowId, actx) {
  var t = getTable(tableName);
  var r = t.findRow(rowId);
  var current = r < 0 ? null : t.readRow(r);
  var snap = snapshotGet(tableName, rowId);
  var before = snap ? Object.assign({ id: rowId }, snap) : null;

  if (!current && !before) return 'IGNORED';
  if (!current) {
    recordChanges(tableName, before, null, actx);
    return 'DELETED';
  }
  if (before && !diffRecords(before, current, businessFields(tableName)).length) return 'UNCHANGED';

  var now = nowIso();
  if (isBlank(current.created_at)) { current.created_at = now; current.created_by = actx.actor; }
  if (isBlank(current.deleted)) current.deleted = false;
  if (tableName === 'ProgressUpdate' && isBlank(current.declared_at)) current.declared_at = now;
  current.updated_at = now;
  current.updated_by = actx.actor;
  current.version = Number(current.version || 0) + 1;
  applyComputed(tableName, current);
  t.writeRow(r, current);

  var problems = checkRecordQuietly(tableName, current);
  recordChanges(tableName, before, current, actx);
  runHooks(tableName, before, current, actx);
  if (problems) {
    notifyUser(actx.actor, 'Donnée à corriger dans ' + tableName,
      'La ligne ' + rowId + ' contient des valeurs invalides : ' + JSON.stringify(problems));
  }
  return before ? 'UPDATED' : 'CREATED';
}

function checkRecordQuietly(table, rec) {
  try { validateRecord(table, rec); return null; } catch (e) { return e.details || e.message; }
}

// ---------------------------------------------------------------- crochets métier

function runHooks(table, before, rec, actx) {
  if (isTrue(rec.deleted)) return;
  if (table === 'Dependency') hookDependencyCycle(rec, actx);
  if (table === 'ProgressUpdate' && !before) hookPropagateProgress(rec, actx);
  if (table === 'Baseline' && actx.source === 'appsheet' && !hookBaselineGuard(before, rec, actx)) return;
  if (table === 'Baseline' && !before && rec.status === 'Demandée') hookBaselineRequested(rec, actx);
  if (table === 'RoleAssignment' && actx.source === 'appsheet') hookRoleAssignmentGuard(before, rec, actx);
  if (table === 'Resource' && actx.source === 'appsheet') hookResourceGuard(before, rec, actx);
  if (table === 'PlanItem') { hookCalendarItem(before, rec); hookRephase(before, rec); }
}

/**
 * Une attribution de rôle saisie dans AppSheet est revérifiée comme par l'API :
 * droit « roles.assign » sur le périmètre et rang au plus égal au sien (section 7).
 * Si elle n'est pas permise, elle est annulée et son auteur prévenu.
 */
function hookRoleAssignmentGuard(before, rec, actx) {
  var changed = !before || before.role_code !== rec.role_code || before.scope_type !== rec.scope_type ||
    String(before.scope_id) !== String(rec.scope_id) || before.resource_id !== rec.resource_id;
  if (!changed) return true;
  var ctx = buildContext(actx.actor);
  // La ligne contrôlée ne peut pas servir à se donner raison (auto-nomination).
  ctx.assignments = ctx.assignments.filter(function (a) { return a.id !== rec.id; });
  var scope = { type: rec.scope_type, id: rec.scope_id };
  var allowed = ctx.isAdmin || (can(ctx, 'roles.assign', scope) && ROLE_RANK[rec.role_code] >= bestRankOn_(ctx, scope));
  if (allowed) return true;
  repoUpdate('RoleAssignment', rec.id, { deleted: true }, null, { actor: 'ppm-core', source: 'core' });
  notifyUser(actx.actor, 'Attribution de rôle annulée',
    'Vous ne pouvez pas attribuer le rôle ' + rec.role_code + ' sur ce périmètre : il faut détenir le droit ' +
    'd’attribuer les rôles et un rôle au moins aussi élevé. L’attribution a été annulée.');
  return false;
}

/**
 * Dans AppSheet, une baseline ne peut qu'être DEMANDÉE : le gel (copie figée, numéro, activation) passe
 * par la page Suivi ou l'API, qui vérifient les droits. Une création dans un autre état est ramenée à
 * « Demandée » ; toute autre modification des champs de décision est annulée. Renvoie false si annulée.
 */
var BASELINE_DECISION_FIELDS = ['project_id', 'number', 'status', 'decided_by', 'decided_at', 'requested_by'];
function hookBaselineGuard(before, rec, actx) {
  var core = { actor: 'ppm-core', source: 'core' };
  if (!before) {
    var fix = {};
    if (rec.status !== 'Demandée') fix.status = 'Demandée';
    if (!isBlank(rec.number)) fix.number = '';
    if (!isBlank(rec.decided_by)) fix.decided_by = '';
    if (!isBlank(rec.decided_at)) fix.decided_at = '';
    if (String(rec.requested_by || '').toLowerCase() !== actx.actor) fix.requested_by = actx.actor;
    if (Object.keys(fix).length) {
      Object.assign(rec, repoUpdate('Baseline', rec.id, fix, null, core));
      if (fix.status) {
        notifyUser(actx.actor, 'Baseline enregistrée comme demande',
          'Votre saisie a été enregistrée comme une demande de baseline. Le chef de projet ou le DPL la fige depuis la page Suivi.');
      }
    }
    return true;
  }
  var changed = BASELINE_DECISION_FIELDS.filter(function (f) { return String(before[f] || '') !== String(rec[f] || ''); });
  if (!changed.length) return true;
  var restore = {};
  changed.forEach(function (f) { restore[f] = before[f]; });
  repoUpdate('Baseline', rec.id, restore, null, core);
  notifyUser(actx.actor, 'Modification de baseline annulée',
    'Les baselines se figent, se refusent et se réactivent depuis la page Suivi, qui contrôle les droits et fige la copie du projet. ' +
    'Votre modification (' + changed.join(', ') + ') a été annulée.');
  return false;
}

/** Toute demande de rebaselining (API ou AppSheet) prévient le chef de projet (section 5.3). */
function hookBaselineRequested(rec, actx) {
  var project = repoGet('Project', rec.project_id);
  if (!project || isBlank(project.manager_resource_id)) return;
  var manager = repoGet('Resource', project.manager_resource_id);
  if (!manager) return;
  notifyUser(manager.email, 'Demande de rebaselining — ' + project.code,
    (rec.requested_by || actx.actor) + ' demande une nouvelle baseline : ' + rec.justification);
}

/** Une dépendance qui fermerait un cycle est annulée, et son auteur prévenu (section 5.2). */
function hookDependencyCycle(dep, actx) {
  var others = repoList('Dependency', function (d) { return d.id !== dep.id; })
    .map(function (d) { return { from: d.predecessor_id, to: d.successor_id }; });
  if (!wouldCreateCycle(others, { from: dep.predecessor_id, to: dep.successor_id })) return true;
  repoUpdate('Dependency', dep.id, { deleted: true }, null, { actor: 'ppm-core', source: 'core' });
  notifyUser(actx.actor, 'Dépendance annulée',
    'La dépendance ' + dep.predecessor_id + ' → ' + dep.successor_id + ' fermait une boucle dans le planning. Elle a été annulée.');
  return false;
}

/** Une déclaration d'avancement met à jour le livrable ; la dernière déclaration fait foi (H6). */
function hookPropagateProgress(pu, actx) {
  var item = repoGet('PlanItem', pu.deliverable_id);
  if (!item || isTrue(item.deleted)) return;
  var pct = Math.max(0, Math.min(100, Number(pu.progress_pct)));
  var at = isBlank(pu.declared_at) ? nowIso() : String(pu.declared_at);
  var patch = {
    progress_pct: pct,
    last_progress_at: at,
    status: pct >= 100 ? 'Terminé' : (pct > 0 ? 'En cours' : 'À faire')
  };
  if (pct >= 100 && isBlank(item.actual_finish)) patch.actual_finish = at.slice(0, 10);
  if (pct < 100 && !isBlank(item.actual_finish)) patch.actual_finish = '';
  repoUpdate('PlanItem', item.id, patch, null, { actor: actx.actor, source: actx.source });
}

// ---------------------------------------------------------------- réconciliation

/**
 * Rattrape les écritures AppSheet non signalées. Traite les tables dans l'ordre,
 * jusqu'à l'échéance ; state = { tableIndex } permet de reprendre à la tranche suivante.
 * Renvoie true quand tout est traité.
 */
function reconcileAll(state, deadlineMs) {
  var tables = Object.keys(SCHEMA).filter(isLoggedTable);
  state.tableIndex = state.tableIndex || 0;
  var actx = { actor: 'inconnu (réconciliation)', source: 'reconciliation' };
  while (state.tableIndex < tables.length) {
    var table = tables[state.tableIndex];
    var snaps = {};
    repoList('_Snapshot', function (s) { return s.table_name === table; }).forEach(function (s) { snaps[s.entity_id] = s; });
    var fields = businessFields(table);
    var rows = getTable(table).readAll();
    for (var i = 0; i < rows.length; i++) {
      if (nowMs() > deadlineMs) return false;
      var row = rows[i];
      var s = snaps[row.id];
      delete snaps[row.id];
      if (s && s.hash !== 'DELETED' && s.hash === hashString(stableJson(row, fields))) continue;
      withLock(function () { syncRow(table, row.id, actx); });
    }
    Object.keys(snaps).forEach(function (id) {
      if (snaps[id].hash !== 'DELETED') withLock(function () { syncRow(table, id, actx); });
    });
    state.tableIndex++;
  }
  return true;
}

// ======================================================================
// 20_Setup.gs
// ======================================================================

/**
 * PPM Core — installation et migrations additives.
 *
 * setupPpm() est idempotent : on peut le relancer après chaque évolution du schéma.
 * Il crée ce qui manque (classeurs, feuilles, colonnes ajoutées en fin de ligne),
 * pose les validations de listes, et charge les données de référence (rôles, fériés).
 *
 * Prérequis (propriétés du script) :
 *   PPM_DOMAIN = entreprise.com
 *   PPM_ADMINS = prenom.nom@entreprise.com[,autre@entreprise.com]
 */

/**
 * Installation en une fois : à exécuter depuis l'éditeur, une seule fonction.
 * Domaine et administrateur sont déduits du compte qui installe s'ils ne sont pas déjà réglés ;
 * puis création des classeurs, déclencheurs (nuit, 7 h) et vérification.
 * Relançable sans risque (après une mise à jour, elle ajoute les nouvelles colonnes).
 */
function installerPpm() {
  var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var notes = [];
  if (!allowedDomain()) {
    if (!me || me.indexOf('@') < 0) throw new PpmError('CONFIG', 'Adresse du compte introuvable : renseigner PPM_DOMAIN et PPM_ADMINS à la main.');
    setProp(PROP.DOMAIN, me.split('@')[1]);
    notes.push('Domaine réglé sur ' + me.split('@')[1] + ' (propriété PPM_DOMAIN).');
  }
  if (!adminEmails().length) {
    setProp(PROP.ADMINS, me);
    notes.push('Administrateur : ' + me + ' (propriété PPM_ADMINS ; ajoutez un second administrateur séparé par une virgule).');
  }
  var out = [setupPpm(), installTriggers(), selfCheck()];
  var msg = notes.concat(out).join('\n\n') + '\n\nÉtape suivante : Déployer > Nouveau déploiement > Application Web. Pour des données d’essai : exécuter seedDemo.';
  console.log(msg);
  return msg;
}

function setupPpm() {
  if (!allowedDomain()) throw new PpmError('CONFIG', 'Renseigner la propriété du script PPM_DOMAIN avant l’installation.');
  if (!adminEmails().length) throw new PpmError('CONFIG', 'Renseigner la propriété du script PPM_ADMINS avant l’installation.');

  var data = ensureBook_(PROP.DATA_ID, 'PPM Données');
  var history = ensureBook_(PROP.HISTORY_ID, 'PPM Historique');
  var report = [];

  Object.keys(SCHEMA).forEach(function (name) {
    var ss = SCHEMA[name].book === 'data' ? data : history;
    report.push(ensureSheet_(ss, name));
  });
  [data, history].forEach(removeDefaultSheet_);

  _tableCache = {};
  seedRoles_();
  var year = Number(todayStr().slice(0, 4));
  seedHolidays_([year - 1, year, year + 1, year + 2]);

  var msg = 'Installation terminée (PPM Core ' + PPM_VERSION + ')\n' +
    'Classeur Données : ' + data.getUrl() + '\n' +
    'Classeur Historique : ' + history.getUrl() + '\n' + report.join('\n');
  console.log(msg);
  return msg;
}

function ensureBook_(propKey, title) {
  var id = getProp(propKey, '');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create(title);
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  setProp(propKey, ss.getId());
  return ss;
}

function removeDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/** Crée la feuille ou ajoute les colonnes manquantes en fin de ligne (jamais de renommage). */
function ensureSheet_(ss, name) {
  var cols = tableColumns(name);
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }

  var existing = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var missing = cols.filter(function (c) { return existing.indexOf(c) < 0; });
  if (existing.length && existing[0] !== 'id') {
    throw new PpmError('CONFIG', 'La feuille ' + name + ' doit avoir « id » en colonne A.');
  }
  if (missing.length) {
    var start = existing.length + 1;
    if (sh.getMaxColumns() < start + missing.length - 1) {
      sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - 1 - sh.getMaxColumns());
    }
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var enums = SCHEMA[name].enums || {};
  var rows = Math.max(1, sh.getMaxRows() - 1);
  Object.keys(enums).forEach(function (c) {
    var idx = headers.indexOf(c);
    if (idx < 0) return;
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(enums[c], true).setAllowInvalid(false).build();
    sh.getRange(2, idx + 1, rows, 1).setDataValidation(rule);
  });
  DATE_COLS.forEach(function (c) {
    var idx = headers.indexOf(c);
    if (idx >= 0) sh.getRange(2, idx + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  });
  return (created ? '+ ' : '  ') + name + (missing.length && !created ? ' (colonnes ajoutées : ' + missing.join(', ') + ')' : '');
}

var SETUP_ACTX = { actor: 'setup', source: 'setup' };

function seedRoles_() {
  var levels = { PL: 'program', DPL: 'program', CP: 'project', RWP: 'workpackage', MEMBER: 'project' };
  ROLES.forEach(function (code) {
    if (!repoGet('Role', code)) {
      repoInsert('Role', { id: code, code: code, label: ROLE_LABELS[code], scope_level: levels[code] }, SETUP_ACTX);
    }
  });
}

/** Charge (ou met à jour) les fériés calculés ; id déterministe PAYS-ANNÉE. */
function seedHolidays_(years) {
  COUNTRIES.forEach(function (country) {
    years.forEach(function (year) {
      var id = country + '-' + year;
      var list = holidaysFor(country, year);
      var values = {
        id: id, country: country, year: year,
        label: 'Fériés ' + country + ' ' + year + (country === 'IN' ? ' (nationaux, à compléter par site)' : ''),
        dates_json: JSON.stringify(list)
      };
      var existing = repoGet('HolidaySet', id);
      if (!existing) repoInsert('HolidaySet', values, SETUP_ACTX);
    });
  });
}

/** Fériés d'un pays sur plusieurs années, lus dans HolidaySet (modifiable par site). */
function loadHolidayMap(country) {
  var map = {};
  repoList('HolidaySet', function (h) { return h.country === country; }).forEach(function (h) {
    parseJsonSafe(h.dates_json, []).forEach(function (d) { map[typeof d === 'string' ? d : d.date] = true; });
  });
  return map;
}

/** Contrôle de l'installation : feuilles, en-têtes, propriétés. */
/** Liste des problèmes d'installation (vide = conforme) : sert à selfCheck et à la page Administration. */
function checkInstall_() {
  var problems = [];
  [PROP.DATA_ID, PROP.HISTORY_ID, PROP.DOMAIN, PROP.ADMINS].forEach(function (k) {
    if (!getProp(k, '')) problems.push('Propriété manquante : ' + k);
  });
  if (!problems.length) {
    Object.keys(SCHEMA).forEach(function (name) {
      try {
        var headers = getTable(name).headers();
        tableColumns(name).forEach(function (c) {
          if (headers.indexOf(c) < 0) problems.push(name + ' : colonne manquante ' + c);
        });
      } catch (e) {
        problems.push(name + ' : ' + e.message);
      }
    });
  }
  return problems.concat(checkPageVersions_());
}

function selfCheck() {
  var problems = checkInstall_();
  var msg = problems.length ? 'À corriger :\n- ' + problems.join('\n- ') : 'Installation conforme (PPM Core ' + PPM_VERSION + ').';
  console.log(msg);
  return msg;
}

/**
 * Chaque page annonce sa version (balise meta ppm-version) : une page oubliée lors d'une mise à jour
 * est repérée ici au lieu de provoquer des erreurs incompréhensibles.
 */
function checkPageVersions_() {
  if (typeof HtmlService === 'undefined') return [];
  var out = [];
  Object.keys(PAGES).forEach(function (view) {
    var name = PAGES[view];
    try {
      var html = HtmlService.createHtmlOutputFromFile(name).getContent();
      var m = /<meta name="ppm-version" content="([^"]+)">/.exec(html);
      if (!m) out.push('Page ' + name + ' : version inconnue (fichier d’une version antérieure ?)');
      else if (m[1] !== PPM_VERSION) out.push('Page ' + name + ' en version ' + m[1] + ', le Core en ' + PPM_VERSION + ' : recopier la page.');
    } catch (e) {
      out.push('Page ' + name + ' absente : créer le fichier HTML « ' + name + ' ».');
    }
  });
  return out;
}

/**
 * Jeu de démonstration : un programme, un projet pilote, deux WP, quatre livrables,
 * un jalon, des dépendances. Le compte qui l'exécute devient chef de projet du pilote.
 */
function seedDemo() {
  var me = String(Session.getActiveUser().getEmail() || adminEmails()[0]).toLowerCase();
  var a = { actor: me, source: 'setup' };
  var res = findResourceByEmail(me) || repoInsert('Resource', {
    resource_type: 'Interne', name: me.split('@')[0], email: me, country: 'FR', capacity_days_month: 18,
    job_function: 'Chef de projet', organization: 'Bureau d’études'
  }, a);
  var prog = repoInsert('Program', { code: 'DEMO', name: 'Programme de démonstration', status: 'Actif', leader_resource_id: res.id }, a);
  var proj = repoInsert('Project', {
    code: 'PILOTE', name: 'Projet pilote', program_id: prog.id, manager_resource_id: res.id,
    status: 'Actif', holiday_country: 'FR', start_date: todayStr()
  }, a);
  repoInsert('RoleAssignment', { resource_id: res.id, role_code: 'CP', scope_type: 'project', scope_id: proj.id }, a);
  // Deux personnes fictives (sans adresse : elles ne peuvent pas se connecter) pour que l'OBS et le WBS aient du contenu.
  var conceptrice = repoInsert('Resource', { resource_type: 'Interne', name: 'Camille Durand', country: 'FR',
    job_function: 'Ingénieure structure', organization: 'Bureau d’études' }, a);
  var testeur = repoInsert('Resource', { resource_type: 'Externe', name: 'Sam Weber', country: 'DE',
    job_function: 'Responsable essais', organization: 'Sous-traitant Alpha', supplier: 'Alpha Test GmbH' }, a);
  var wp1 = repoInsert('WorkPackage', { project_id: proj.id, wbs_code: '1', name: 'Conception', owner_resource_id: conceptrice.id, charge_code: 'PIL-001' }, a);
  var wp2 = repoInsert('WorkPackage', { project_id: proj.id, wbs_code: '2', name: 'Validation', owner_resource_id: testeur.id, charge_code: 'PIL-002' }, a);
  repoInsert('RoleAssignment', { resource_id: conceptrice.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp1.id }, a);
  repoInsert('RoleAssignment', { resource_id: testeur.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp2.id }, a);
  var hol = loadHolidayMap('FR');
  var d0 = nextWorkingDay(todayStr(), hol);
  function item(wp, name, startOffset, duration, type) {
    var start = addWorkingDays(d0, startOffset, hol);
    return repoInsert('PlanItem', {
      project_id: proj.id, wp_id: wp.id, item_type: type || 'Livrable', name: name, owner_resource_id: res.id,
      planned_start: start, planned_finish: type === 'Jalon' ? start : addWorkingDays(start, duration - 1, hol),
      progress_pct: 0, status: 'À faire', milestone_category: type === 'Jalon' ? 'Revue' : ''
    }, a);
  }
  var l1 = item(wp1, 'Spécification', 0, 10);
  var l2 = item(wp1, 'Maquette', 10, 15);
  var l3 = item(wp2, 'Plan de tests', 10, 5);
  var l4 = item(wp2, 'Rapport de tests', 25, 10);
  var j1 = item(wp2, 'Revue de conception', 35, 0, 'Jalon');
  [[l1, l2], [l1, l3], [l2, l4], [l3, l4], [l4, j1]].forEach(function (p) {
    repoInsert('Dependency', { predecessor_id: p[0].id, successor_id: p[1].id, dep_type: 'FS', lag_days: 0 }, a);
  });
  [l2, l4].forEach(function (l) { repoInsert('MilestoneRequirement', { milestone_id: j1.id, deliverable_id: l.id }, a); });
  var msg = 'Démo créée : projet ' + proj.code + ' (' + proj.id + ')';
  console.log(msg);
  return msg;
}

function findResourceByEmail(email) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  var found = repoList('Resource', function (r) { return String(r.email).toLowerCase() === email; });
  return found.length ? found[0] : null;
}

// ======================================================================
// 30_Api.gs
// ======================================================================

/**
 * PPM Core — API JSON (section 12).
 *
 * Déploiement : web app, « Exécuter en tant que : moi (compte propriétaire) »,
 * « Accès : tous les utilisateurs du domaine ».
 * Requête : POST { action, params, apiVersion, requestId, addonId? }
 * Réponse : { ok: true, data, cursor? } | { ok: false, error: { code, message, details } }
 *
 * handleRequest() est pur vis-à-vis du transport : les tests l'appellent directement.
 */

var API_ACTIONS = {};
var IDEMPOTENCY_STORE = null; // tests : objet en mémoire ; production : CacheService
var IDEMPOTENCY_TTL_S = 21600; // 6 h, maximum du cache Apps Script

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: { code: 'VALIDATION', message: 'Corps JSON invalide.' } });
  }
  return jsonOut_(handleRequest(body, currentUserEmail_()));
}

function doGet(e) {
  if (e && e.parameter && e.parameter.view) return renderPage_(e);
  return jsonOut_({ ok: true, data: { service: 'ppm-core', version: PPM_VERSION, apiVersion: PPM_API_VERSION } });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function currentUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function handleRequest(body, actorEmail, opts) {
  if (!(opts && opts.keepMemo)) resetExecution_();
  try {
    body = body || {};
    var email = String(actorEmail || '').toLowerCase();
    var domain = allowedDomain();
    if (!email || !domain || email.split('@')[1] !== domain) {
      throw new PpmError('FORBIDDEN', 'Accès réservé aux comptes du domaine.');
    }
    var major = String(body.apiVersion || PPM_API_VERSION).split('.')[0];
    if (major !== PPM_API_VERSION.split('.')[0]) {
      throw new PpmError('VALIDATION', 'Version d’API non prise en charge : ' + body.apiVersion);
    }
    var handler = API_ACTIONS[body.action];
    if (!handler) throw new PpmError('NOT_FOUND', 'Action inconnue : ' + body.action);

    var cacheKey = body.requestId ? 'req:' + email + ':' + body.requestId : null;
    if (cacheKey) {
      var cached = idempotencyGet_(cacheKey);
      if (cached) return cached;
    }
    prefetchTables_(HOT_TABLES);
    var t0 = Date.now();
    var ctx = buildContext(email, body.addonId);
    var result = handler(body.params || {}, ctx);
    if (!TABLE_PROVIDER) console.log('PPM ' + body.action + ' : ' + (Date.now() - t0) + ' ms');
    var response = { ok: true, data: result && result.__page ? result.items : result };
    if (result && result.__page && result.cursor) response.cursor = result.cursor;
    if (cacheKey) idempotencyPut_(cacheKey, response);
    return response;
  } catch (err) {
    if (err instanceof PpmError || (err && err.name === 'PpmError')) {
      return { ok: false, error: { code: err.code, message: err.message, details: err.details || null } };
    }
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'INTERNAL', message: 'Erreur interne.', details: null } };
  }
}

function idempotencyGet_(key) {
  if (IDEMPOTENCY_STORE) return IDEMPOTENCY_STORE[key] || null;
  var v = CacheService.getScriptCache().get(key);
  return v ? JSON.parse(v) : null;
}

function idempotencyPut_(key, response) {
  if (IDEMPOTENCY_STORE) { IDEMPOTENCY_STORE[key] = response; return; }
  var s = JSON.stringify(response);
  if (s.length < 90000) CacheService.getScriptCache().put(key, s, IDEMPOTENCY_TTL_S);
}

/** Contexte de l'appelant : ressource, rôles actifs, droits. */
function buildContext(email, addonId) {
  var resource = findResourceByEmail(email);
  var today = todayStr();
  var ctx = {
    email: email,
    resource: resource,
    resourceId: resource ? resource.id : null,
    isAdmin: adminEmails().indexOf(email) >= 0,
    assignments: resource ? activeAssignments(resource.id, repoList('RoleAssignment'), today) : [],
    lookup: repoLookup_(),
    actx: { actor: email, source: addonId ? 'addon:' + addonId : 'api' }
  };
  return ctx;
}

function repoLookup_() {
  var cache = {};
  function get(table, id) {
    var k = table + ':' + id;
    if (!(k in cache)) cache[k] = repoGet(table, id);
    return cache[k];
  }
  var lookup = {
    planitem: function (id) { return get('PlanItem', id); },
    workpackage: function (id) { return get('WorkPackage', id); },
    project: function (id) { return get('Project', id); },
    risk: function (id) { return get('RiskOpportunity', id); },
    budgetMember: function (resourceId, itemId) {
      var viaBudget = repoList('BudgetLine', function (b) {
        return b.deliverable_id === itemId && b.resource_id === resourceId;
      }).length > 0;
      return viaBudget || activeAssignmentsFor_(resourceId, itemId, lookup);
    }
  };
  return lookup;
}

/** Un MEMBER affecté explicitement sur le projet ou un WP englobant compte aussi. */
function activeAssignmentsFor_(resourceId, itemId, lookup) {
  var chain = scopeAncestors({ type: 'planitem', id: itemId }, lookup);
  return repoList('RoleAssignment', function (a) {
    return a.resource_id === resourceId && a.role_code === 'MEMBER' &&
      chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
  }).length > 0;
}

// ---------------------------------------------------------------- outils

function requireParam(params, name) {
  if (isBlank(params[name])) throw new PpmError('VALIDATION', 'Paramètre obligatoire : ' + name);
  return params[name];
}

function mustGet(table, id) {
  var rec = repoGet(table, id);
  if (!rec || isTrue(rec.deleted)) throw new PpmError('NOT_FOUND', table + ' introuvable : ' + id);
  return rec;
}

/** Pagination par curseur (décalage opaque). */
function paginate(rows, params) {
  var limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
  var offset = Number(params.cursor) || 0;
  var items = rows.slice(offset, offset + limit);
  return { __page: true, items: items, cursor: offset + limit < rows.length ? String(offset + limit) : null };
}

function defineAction(name, fn) {
  API_ACTIONS[name] = fn;
}

// ---------------------------------------------------------------- actions : général

defineAction('ping', function () {
  return { version: PPM_VERSION, apiVersion: PPM_API_VERSION, time: nowIso() };
});

defineAction('me.roles', function (p, ctx) {
  return {
    email: ctx.email, isAdmin: ctx.isAdmin, resource: ctx.resource,
    assignments: ctx.assignments.map(function (a) {
      return { role_code: a.role_code, scope_type: a.scope_type, scope_id: a.scope_id };
    })
  };
});

// ---------------------------------------------------------------- actions : structure

defineAction('programs.list', function (p) { return paginate(repoList('Program'), p); });

defineAction('programs.create', function (p, ctx) {
  requireCan(ctx, 'program.create', { type: 'global' });
  return repoInsert('Program', p.values || {}, ctx.actx);
});

defineAction('projects.list', function (p) {
  return paginate(repoList('Project', function (r) { return isBlank(p.programId) || r.program_id === p.programId; }), p);
});

defineAction('projects.get', function (p) { return mustGet('Project', requireParam(p, 'id')); });

defineAction('projects.create', function (p, ctx) {
  var v = p.values || {};
  requireCan(ctx, 'project.create', isBlank(v.program_id) ? { type: 'global' } : { type: 'program', id: v.program_id });
  if (!isBlank(v.program_id)) mustGet('Program', v.program_id);
  return repoInsert('Project', v, ctx.actx);
});

defineAction('projects.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('Project', id);
  requireCan(ctx, 'wbs.edit', { type: 'project', id: id });
  return repoUpdate('Project', id, p.patch || {}, p.version, ctx.actx);
});

defineAction('workpackages.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  return paginate(repoList('WorkPackage', function (w) { return w.project_id === projectId; }), p);
});

defineAction('workpackages.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('Project', requireParam(v, 'project_id'));
  if (!isBlank(v.parent_wp_id)) {
    var parent = mustGet('WorkPackage', v.parent_wp_id);
    if (!isBlank(parent.parent_wp_id)) throw new PpmError('VALIDATION', 'Le WBS est limité à deux niveaux.');
    if (parent.project_id !== v.project_id) throw new PpmError('VALIDATION', 'Le WP parent appartient à un autre projet.');
  }
  requireCan(ctx, 'wbs.edit', isBlank(v.parent_wp_id) ? { type: 'project', id: v.project_id } : { type: 'workpackage', id: v.parent_wp_id });
  return repoInsert('WorkPackage', v, ctx.actx);
});

defineAction('workpackages.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('WorkPackage', id);
  requireCan(ctx, 'wbs.edit', { type: 'workpackage', id: id });
  var patch = Object.assign({}, p.patch || {});
  delete patch.project_id;
  return repoUpdate('WorkPackage', id, patch, p.version, ctx.actx);
});

defineAction('workpackages.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('WorkPackage', id);
  requireCan(ctx, 'wbs.edit', { type: 'workpackage', id: id });
  return repoSoftDelete('WorkPackage', id, p.version, ctx.actx);
});

defineAction('planitems.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  return paginate(repoList('PlanItem', function (i) { return i.project_id === projectId; }), p);
});

defineAction('planitems.get', function (p) { return mustGet('PlanItem', requireParam(p, 'id')); });

defineAction('planitems.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('Project', requireParam(v, 'project_id'));
  if (!isBlank(v.wp_id) && mustGet('WorkPackage', v.wp_id).project_id !== v.project_id) {
    throw new PpmError('VALIDATION', 'Le WP appartient à un autre projet.');
  }
  requireCan(ctx, 'wbs.edit', isBlank(v.wp_id) ? { type: 'project', id: v.project_id } : { type: 'workpackage', id: v.wp_id });
  var values = Object.assign({ status: 'À faire', progress_pct: 0 }, v);
  return repoInsert('PlanItem', values, ctx.actx);
});

defineAction('planitems.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('PlanItem', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: id });
  var patch = Object.assign({}, p.patch || {});
  ['project_id', 'progress_pct', 'status', 'last_progress_at'].forEach(function (k) { delete patch[k]; });
  return repoUpdate('PlanItem', id, patch, p.version, ctx.actx);
});

defineAction('planitems.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  mustGet('PlanItem', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: id });
  return repoSoftDelete('PlanItem', id, p.version, ctx.actx);
});

defineAction('dependencies.list', function (p) {
  var projectId = requireParam(p, 'projectId');
  var ids = {};
  repoList('PlanItem', function (i) { return i.project_id === projectId; }).forEach(function (i) { ids[i.id] = true; });
  return paginate(repoList('Dependency', function (d) { return ids[d.successor_id] || ids[d.predecessor_id]; }), p);
});

defineAction('dependencies.create', function (p, ctx) {
  var v = p.values || {};
  mustGet('PlanItem', requireParam(v, 'predecessor_id'));
  mustGet('PlanItem', requireParam(v, 'successor_id'));
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: v.successor_id });
  if (v.predecessor_id === v.successor_id) throw new PpmError('VALIDATION', 'Un élément ne peut pas dépendre de lui-même.');
  if (repoList('Dependency', function (d) { return d.predecessor_id === v.predecessor_id && d.successor_id === v.successor_id; }).length) {
    throw new PpmError('VALIDATION', 'Cette dépendance existe déjà.');
  }
  if ('lag_days' in v) v.lag_days = checkLag_(v.lag_days);
  var edges = repoList('Dependency').map(function (d) { return { from: d.predecessor_id, to: d.successor_id }; });
  if (wouldCreateCycle(edges, { from: v.predecessor_id, to: v.successor_id })) {
    throw new PpmError('VALIDATION', 'Cette dépendance fermerait une boucle dans le planning.', { rule: 'CYCLE' });
  }
  return repoInsert('Dependency', Object.assign({ dep_type: 'FS', lag_days: 0 }, v), ctx.actx);
});

defineAction('dependencies.delete', function (p, ctx) {
  var id = requireParam(p, 'id');
  var d = mustGet('Dependency', id);
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id });
  return repoSoftDelete('Dependency', id, p.version, ctx.actx);
});

// ---------------------------------------------------------------- actions : avancement, baselines

defineAction('progress.declare', function (p, ctx) {
  var itemId = requireParam(p, 'planItemId');
  var item = mustGet('PlanItem', itemId);
  if (item.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'L’avancement se déclare sur un livrable.');
  requireCan(ctx, 'progress.declare', { type: 'planitem', id: itemId });
  repoInsert('ProgressUpdate', {
    deliverable_id: itemId, resource_id: ctx.resourceId || '', declared_at: nowIso(),
    progress_pct: requireParam(p, 'progressPct'), comment: p.comment || ''
  }, ctx.actx);
  return repoGet('PlanItem', itemId);
});

defineAction('baselines.request', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  mustGet('Project', projectId);
  requireCan(ctx, 'baseline.request', { type: 'project', id: projectId });
  var rec = repoInsert('Baseline', {
    project_id: projectId, justification: requireParam(p, 'justification'),
    label: p.label || '', requested_by: ctx.email, status: 'Demandée'
  }, ctx.actx);
  return rec;
});

// ---------------------------------------------------------------- actions : traçabilité, alertes

defineAction('changes.since', function (p) {
  // Curseur « at|id » : ordre total, aucun événement perdu entre deux pages.
  var parts = String(p.cursor || '').split('|');
  var cAt = parts[0] || '', cId = parts[1] || '';
  var rows = repoList('ChangeEvent', function (e) {
    var after = String(e.at) > cAt || (String(e.at) === cAt && String(e.id) > cId);
    return after && (isBlank(p.projectId) || e.project_id === p.projectId);
  }).sort(function (a, b) {
    var ka = a.at + '|' + a.id, kb = b.at + '|' + b.id;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  var limit = Math.max(1, Math.min(1000, Number(p.limit) || 200));
  var items = rows.slice(0, limit);
  var last = items.length ? items[items.length - 1] : null;
  return { __page: true, items: items, cursor: last ? last.at + '|' + last.id : (p.cursor || null) };
});

defineAction('insights.list', function (p) {
  return paginate(repoList('Insight', function (i) {
    return (isBlank(p.projectId) || i.project_id === p.projectId) && (isBlank(p.status) || i.status === p.status);
  }), p);
});

// ======================================================================
// 32_Views.gs
// ======================================================================

/**
 * PPM Core — vues du lot 1 : Gantt projet, vue programme, organisation (OBS).
 *
 * Les tables sont lues UNE fois par requête puis traitées en mémoire : une lecture
 * de feuille coûte cher en Apps Script, un appel par élément serait trop lent.
 * Les fonctions build* sont pures (testées hors ligne) ; les actions de l'API les
 * alimentent. La page web « Gantt » appelle le Core par uiCall(), donc avec
 * exactement les mêmes contrôles de droits que l'API.
 */

// ---------------------------------------------------------------- chargement

function loadPlanningData_() {
  return {
    programs: repoList('Program'),
    projects: repoList('Project'),
    workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'),
    resources: repoList('Resource'),
    assignments: repoList('RoleAssignment'),
    budgetLines: repoList('BudgetLine'),
    holidaySets: repoList('HolidaySet')
  };
}

function indexBy_(rows) {
  var m = {};
  (rows || []).forEach(function (r) { m[r.id] = r; });
  return m;
}

/** Même interface que repoLookup_(), mais sur des données déjà chargées. */
function memoryLookup(data) {
  var items = indexBy_(data.planitems), wps = indexBy_(data.workpackages), projects = indexBy_(data.projects);
  var lookup = {
    planitem: function (id) { return items[id] || null; },
    workpackage: function (id) { return wps[id] || null; },
    project: function (id) { return projects[id] || null; },
    risk: function () { return null; },
    budgetMember: function (resourceId, itemId) {
      if ((data.budgetLines || []).some(function (b) { return b.deliverable_id === itemId && b.resource_id === resourceId; })) return true;
      var chain = scopeAncestors({ type: 'planitem', id: itemId }, lookup);
      return (data.assignments || []).some(function (a) {
        return a.resource_id === resourceId && a.role_code === 'MEMBER' &&
          chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
      });
    }
  };
  return lookup;
}

/** holFor(projectId) à partir des HolidaySet déjà chargés. */
function holidayResolver(data) {
  var byCountry = {};
  (data.holidaySets || []).forEach(function (h) {
    var m = byCountry[h.country] || (byCountry[h.country] = {});
    parseJsonSafe(h.dates_json, []).forEach(function (d) { m[typeof d === 'string' ? d : d.date] = true; });
  });
  var projects = indexBy_(data.projects);
  return function (projectId) {
    var p = projects[projectId];
    return byCountry[(p && p.holiday_country) || 'FR'] || {};
  };
}

function resourceName_(data, id) {
  if (isBlank(id)) return '';
  var r = (data._resById || (data._resById = indexBy_(data.resources)))[id];
  return r ? r.name : '';
}

function isDone_(it) {
  return it.status === 'Terminé' || Number(it.progress_pct) >= 100;
}

/** Avancement pondéré par la durée (jours ouvrés) des livrables. */
function weightedProgress_(items, holFor) {
  var w = 0, acc = 0;
  items.forEach(function (it) {
    if (it.item_type !== 'Livrable') return;
    var d = Math.max(1, itemDuration(it, holFor(it.project_id)));
    w += d;
    acc += d * Math.min(100, Math.max(0, Number(it.progress_pct) || 0));
  });
  return w ? Math.round(acc / w) : 0;
}

function span_(items) {
  var s = '', f = '';
  items.forEach(function (it) {
    var a = itemStart(it), b = itemFinish(it);
    if (!isBlank(a) && (!s || a < s)) s = a;
    if (!isBlank(b) && (!f || b > f)) f = b;
  });
  return { start: s || null, finish: f || null };
}

function byStartThenName_(a, b) {
  var sa = itemStart(a) || '9999', sb = itemStart(b) || '9999';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return String(a.name).localeCompare(String(b.name));
}

function byWbs_(a, b) {
  var ka = String(a.wbs_code || ''), kb = String(b.wbs_code || '');
  if (ka !== kb) return ka.localeCompare(kb, undefined, { numeric: true });
  return String(a.name).localeCompare(String(b.name));
}

// ---------------------------------------------------------------- Gantt projet

/**
 * data : loadPlanningData_() ; ctx : contexte de l'appelant (droits) ; today : AAAA-MM-JJ.
 * Renvoie les lignes du Gantt dans l'ordre d'affichage (WP, sous-WP, éléments),
 * les dépendances, les violations et le chemin critique.
 */
function buildProjectGantt(data, projectId, ctx, today) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var holFor = holidayResolver(data);
  var lookup = memoryLookup(data);
  var uctx = Object.assign({}, ctx, { lookup: lookup });

  var items = data.planitems.filter(function (i) { return i.project_id === projectId; });
  var itemIds = {};
  items.forEach(function (i) { itemIds[i.id] = true; });

  // Dépendances touchant le projet ; voisins des autres projets en contraintes fixes.
  var allItems = indexBy_(data.planitems), projById = indexBy_(data.projects);
  var deps = data.dependencies.filter(function (d) { return itemIds[d.predecessor_id] || itemIds[d.successor_id]; });
  var externals = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) {
      if (!itemIds[id] && allItems[id]) externals[id] = Object.assign({}, allItems[id], { external: true });
    });
  });
  var extList = Object.keys(externals).map(function (k) { return externals[k]; });

  var floats = computeFloats(items.concat(extList), deps, holFor);
  var violations = dependencyViolations(items.concat(extList), deps, holFor);
  var violatedDep = {}, violatedItem = {};
  violations.forEach(function (v) { violatedDep[v.dependency_id] = true; violatedItem[v.successor_id] = true; });

  // Baseline active (data.baseline = { row, snap }) : dates figées et glissement de chaque élément.
  var base = data.baseline || null;
  var baseItems = base ? base.snap.PlanItem : {};
  var hol = holFor(projectId);
  function baselineOf(it) {
    if (!base) return {};
    var b = baseItems[it.id];
    if (!b) return { added: true };
    var slip = !isBlank(b.planned_finish) && !isBlank(itemFinish(it)) ? workingDayOffset(b.planned_finish, itemFinish(it), hol) : null;
    return { baseline_start: b.planned_start || b.planned_finish || null, baseline_finish: b.planned_finish || null, slip: slip };
  }

  function itemRow(it, level) {
    var f = floats.byId[it.id] || {};
    return Object.assign({
      kind: 'item', id: it.id, name: it.name, item_type: it.item_type, wp_id: it.wp_id || '', level: level,
      start: itemStart(it) || null, finish: itemFinish(it) || null,
      progress: Number(it.progress_pct) || 0, status: it.status || '', owner: resourceName_(data, it.owner_resource_id),
      critical: !!f.critical, float: f.float === undefined ? null : f.float, late_finish: f.lateFinish || null,
      late: !isDone_(it) && !isBlank(itemFinish(it)) && itemFinish(it) < today,
      violated: !!violatedItem[it.id], version: it.version,
      canEdit: can(uctx, 'wbs.edit', { type: 'planitem', id: it.id }),
      canDeclare: it.item_type === 'Livrable' && can(uctx, 'progress.declare', { type: 'planitem', id: it.id })
    }, baselineOf(it));
  }

  // Arborescence WBS (deux niveaux).
  var wps = data.workpackages.filter(function (w) { return w.project_id === projectId; });
  var wpIds = {};
  wps.forEach(function (w) { wpIds[w.id] = true; });
  var childrenOf = {}, itemsOf = {};
  wps.forEach(function (w) {
    var parent = !isBlank(w.parent_wp_id) && wpIds[w.parent_wp_id] ? w.parent_wp_id : '';
    (childrenOf[parent] = childrenOf[parent] || []).push(w);
  });
  items.forEach(function (it) {
    var k = !isBlank(it.wp_id) && wpIds[it.wp_id] ? it.wp_id : '';
    (itemsOf[k] = itemsOf[k] || []).push(it);
  });

  function deepItems(wpId) {
    var acc = (itemsOf[wpId] || []).slice();
    (childrenOf[wpId] || []).forEach(function (c) { acc = acc.concat(deepItems(c.id)); });
    return acc;
  }

  var rows = [];
  function emitWp(w, level) {
    var all = deepItems(w.id);
    var sp = span_(all);
    var bsp = base ? span_(all.filter(function (i) { return baseItems[i.id]; }).map(function (i) { return baseItems[i.id]; })) : {};
    rows.push({
      kind: 'wp', id: 'wp:' + w.id, wp_id: w.id, name: w.name, wbs_code: w.wbs_code || '', level: level,
      start: sp.start, finish: sp.finish, progress: weightedProgress_(all, holFor),
      baseline_start: bsp.start || null, baseline_finish: bsp.finish || null,
      owner: resourceName_(data, w.owner_resource_id),
      critical: all.some(function (i) { return floats.byId[i.id] && floats.byId[i.id].critical; }),
      late: all.some(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; })
    });
    (itemsOf[w.id] || []).slice().sort(byStartThenName_).forEach(function (it) { rows.push(itemRow(it, level + 1)); });
    (childrenOf[w.id] || []).slice().sort(byWbs_).forEach(function (c) { emitWp(c, level + 1); });
  }
  (childrenOf[''] || []).slice().sort(byWbs_).forEach(function (w) { emitWp(w, 0); });
  if ((itemsOf[''] || []).length) {
    var loose = itemsOf[''];
    var sp = span_(loose);
    rows.push({ kind: 'wp', id: 'wp:none', wp_id: '', name: 'Hors workpackage', wbs_code: '', level: 0,
      start: sp.start, finish: sp.finish, progress: weightedProgress_(loose, holFor), owner: '', critical: false, late: false });
    loose.slice().sort(byStartThenName_).forEach(function (it) { rows.push(itemRow(it, 1)); });
  }
  extList.sort(byStartThenName_).forEach(function (it) {
    var p = projById[it.project_id];
    rows.push({
      kind: 'external', id: it.id, name: it.name, item_type: it.item_type, level: 0,
      project_code: p ? p.code : '', project_id: it.project_id,
      start: itemStart(it) || null, finish: itemFinish(it) || null,
      progress: Number(it.progress_pct) || 0, status: it.status || '', canEdit: false, canDeclare: false
    });
  });

  var names = {};
  items.concat(extList).forEach(function (i) { names[i.id] = i.name; });
  var itemRows = rows.filter(function (r) { return r.kind === 'item'; });
  var program = !isBlank(project.program_id) ? indexBy_(data.programs)[project.program_id] : null;
  var baselineInfo = null;
  if (base) {
    var live = {};
    items.forEach(function (i) { live[i.id] = true; });
    var baseEnd = '';
    Object.keys(baseItems).forEach(function (id) { var d = baseItems[id].planned_finish; if (!isBlank(d) && d > baseEnd) baseEnd = d; });
    baselineInfo = {
      id: base.row.id, label: base.row.label || ('B' + base.row.number), decided_at: base.row.decided_at || '',
      slipped: itemRows.filter(function (r) { return r.slip > 0; }).length,
      added: itemRows.filter(function (r) { return r.added; }).length,
      removed: Object.keys(baseItems).filter(function (id) { return !live[id]; }).length,
      end: baseEnd || null, end_slip: baseEnd && floats.anchor ? workingDayOffset(baseEnd, floats.anchor, hol) : null
    };
  }

  return {
    today: today,
    anchor: floats.anchor,
    project: {
      id: project.id, code: project.code, name: project.name, status: project.status,
      program_id: project.program_id || '', program_name: program ? program.name : '',
      holiday_country: project.holiday_country || 'FR', start_date: project.start_date || '', end_date: project.end_date || '',
      manager: resourceName_(data, project.manager_resource_id)
    },
    canEditProject: can(uctx, 'wbs.edit', { type: 'project', id: projectId }),
    baseline: baselineInfo,
    rows: rows,
    dependencies: deps.filter(function (d) { return names[d.predecessor_id] && names[d.successor_id]; }).map(function (d) {
      return { id: d.id, from: d.predecessor_id, to: d.successor_id, type: d.dep_type, lag: Number(d.lag_days) || 0, violated: !!violatedDep[d.id] };
    }),
    violations: violations.map(function (v) {
      return Object.assign({}, v, { predecessor_name: names[v.predecessor_id], successor_name: names[v.successor_id] });
    }),
    stats: {
      items: itemRows.length,
      critical: itemRows.filter(function (r) { return r.critical; }).length,
      late: itemRows.filter(function (r) { return r.late; }).length,
      violations: violations.length,
      progress: weightedProgress_(items, holFor),
      beyondEnd: !isBlank(project.end_date) && !!floats.anchor && floats.anchor > project.end_date
    }
  };
}

// ---------------------------------------------------------------- vue programme

/**
 * Une ligne par projet (période, avancement, alertes, jalons) et les dépendances
 * entre projets. Le chemin critique est calculé sur l'ensemble du programme.
 * programId vide = projets hors programme.
 */
function buildProgramView(data, programId, today) {
  var program = programId ? indexBy_(data.programs)[programId] : null;
  if (programId && !program) throw new PpmError('NOT_FOUND', 'Programme introuvable : ' + programId);
  var holFor = holidayResolver(data);
  var projects = data.projects.filter(function (p) {
    return programId ? p.program_id === programId : isBlank(p.program_id);
  }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
  var projIds = {};
  projects.forEach(function (p) { projIds[p.id] = true; });
  var items = data.planitems.filter(function (i) { return projIds[i.project_id]; });
  var itemById = indexBy_(items);
  var deps = data.dependencies.filter(function (d) { return itemById[d.predecessor_id] && itemById[d.successor_id]; });
  var floats = computeFloats(items, deps, holFor);
  var violations = dependencyViolations(items, deps, holFor);
  var violatedDep = {};
  violations.forEach(function (v) { violatedDep[v.dependency_id] = true; });

  var rows = projects.map(function (p) {
    var its = items.filter(function (i) { return i.project_id === p.id; });
    var sp = span_(its);
    return {
      id: p.id, code: p.code, name: p.name, status: p.status || '', manager: resourceName_(data, p.manager_resource_id),
      start: sp.start || p.start_date || null, finish: sp.finish || p.end_date || null,
      end_date: p.end_date || '', progress: weightedProgress_(its, holFor),
      items: its.length,
      late: its.filter(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; }).length,
      critical: its.filter(function (i) { return floats.byId[i.id] && floats.byId[i.id].critical; }).length,
      violations: violations.filter(function (v) { return itemById[v.successor_id].project_id === p.id; }).length,
      milestones: its.filter(function (i) { return i.item_type === 'Jalon' && !isBlank(itemFinish(i)); })
        .sort(byStartThenName_).map(function (m) {
          return { id: m.id, name: m.name, date: itemFinish(m), status: m.status || '', critical: !!(floats.byId[m.id] && floats.byId[m.id].critical) };
        })
    };
  });

  var crossDeps = deps.filter(function (d) {
    return itemById[d.predecessor_id].project_id !== itemById[d.successor_id].project_id;
  }).map(function (d) {
    var a = itemById[d.predecessor_id], b = itemById[d.successor_id];
    return {
      id: d.id, type: d.dep_type, from_project: a.project_id, to_project: b.project_id,
      from_item: a.name, to_item: b.name, violated: !!violatedDep[d.id]
    };
  });

  return {
    today: today,
    anchor: floats.anchor,
    program: program ? { id: program.id, code: program.code, name: program.name, status: program.status || '',
      leader: resourceName_(data, program.leader_resource_id) } : { id: '', code: '', name: 'Projets hors programme', status: '', leader: '' },
    projects: rows,
    crossDependencies: crossDeps,
    stats: {
      projects: rows.length,
      late: rows.reduce(function (s, r) { return s + r.late; }, 0),
      violations: violations.length,
      crossDependencies: crossDeps.length
    }
  };
}

// ---------------------------------------------------------------- organisation (OBS)

/** Rôles actifs sur un périmètre et sur ce qu'il contient (programme → projets → WP). */
function buildObs(data, scopeType, scopeId, today) {
  var projects = indexBy_(data.projects), wps = indexBy_(data.workpackages), programs = indexBy_(data.programs);
  var inScope = function (a) {
    if (a.scope_type === scopeType && String(a.scope_id) === String(scopeId)) return true;
    if (scopeType === 'program') {
      if (a.scope_type === 'project') return projects[a.scope_id] && projects[a.scope_id].program_id === scopeId;
      if (a.scope_type === 'workpackage') {
        var w = wps[a.scope_id];
        return w && projects[w.project_id] && projects[w.project_id].program_id === scopeId;
      }
    }
    if (scopeType === 'project' && a.scope_type === 'workpackage') return wps[a.scope_id] && wps[a.scope_id].project_id === scopeId;
    if (scopeType === 'workpackage' && a.scope_type === 'workpackage') {
      return wps[a.scope_id] && wps[a.scope_id].parent_wp_id === scopeId;
    }
    return false;
  };
  var label = function (type, id) {
    if (type === 'program') return programs[id] ? programs[id].code + ' — ' + programs[id].name : id;
    if (type === 'project') return projects[id] ? projects[id].code + ' — ' + projects[id].name : id;
    if (type === 'workpackage') return wps[id] ? ((wps[id].wbs_code ? wps[id].wbs_code + ' ' : '') + wps[id].name) : id;
    return id;
  };
  var rank = { program: 0, project: 1, workpackage: 2 };
  var roleRank = { PL: 0, DPL: 1, CP: 2, RWP: 3, MEMBER: 4 };
  return data.assignments.filter(function (a) {
    if (isTrue(a.deleted)) return false;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return false;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return false;
    return inScope(a);
  }).map(function (a) {
    return {
      id: a.id, version: a.version, role_code: a.role_code, role_label: ROLE_LABELS[a.role_code] || a.role_code,
      scope_type: a.scope_type, scope_id: a.scope_id, scope_label: label(a.scope_type, a.scope_id),
      resource_id: a.resource_id, resource_name: resourceName_(data, a.resource_id),
      start_date: a.start_date || '', end_date: a.end_date || ''
    };
  }).sort(function (a, b) {
    return (rank[a.scope_type] - rank[b.scope_type]) || a.scope_label.localeCompare(b.scope_label) ||
      (roleRank[a.role_code] - roleRank[b.role_code]) || a.resource_name.localeCompare(b.resource_name);
  });
}

// ---------------------------------------------------------------- actions de l'API

defineAction('planning.catalog', function () {
  var projects = repoList('Project');
  return {
    programs: repoList('Program').map(function (p) { return { id: p.id, code: p.code, name: p.name, status: p.status || '' }; }),
    projects: projects.map(function (p) {
      return { id: p.id, code: p.code, name: p.name, status: p.status || '', program_id: p.program_id || '' };
    })
  };
});

defineAction('gantt.project', function (p, ctx) {
  var data = loadPlanningData_();
  var projectId = requireParam(p, 'projectId');
  data.baseline = activeBaselineOf_(indexBy_(data.projects)[projectId]);
  return buildProjectGantt(data, projectId, ctx, todayStr());
});

defineAction('gantt.program', function (p) {
  return buildProgramView(loadPlanningData_(), p.programId || '', todayStr());
});

defineAction('obs.list', function (p) {
  var type = requireParam(p, 'scopeType');
  if (['program', 'project', 'workpackage'].indexOf(type) < 0) throw new PpmError('VALIDATION', 'Périmètre invalide : ' + type);
  return buildObs(loadPlanningData_(), type, requireParam(p, 'scopeId'), todayStr());
});

var SCOPE_TABLE = { program: 'Program', project: 'Project', workpackage: 'WorkPackage' };

defineAction('roles.assign', function (p, ctx) {
  var v = p.values || {};
  var type = requireParam(v, 'scope_type');
  if (!SCOPE_TABLE[type]) throw new PpmError('VALIDATION', 'Périmètre invalide : ' + type);
  mustGet(SCOPE_TABLE[type], requireParam(v, 'scope_id'));
  mustGet('Resource', requireParam(v, 'resource_id'));
  if (ROLES.indexOf(v.role_code) < 0) throw new PpmError('VALIDATION', 'Rôle inconnu : ' + v.role_code);
  requireCan(ctx, 'roles.assign', { type: type, id: v.scope_id });
  // On n'attribue pas un rôle plus élevé que le sien sur ce périmètre (un CP ne nomme pas un DPL).
  if (!ctx.isAdmin && ROLE_RANK[v.role_code] < bestRankOn_(ctx, { type: type, id: v.scope_id })) {
    throw new PpmError('FORBIDDEN', 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre sur ce périmètre.');
  }
  var dup = repoList('RoleAssignment', function (a) {
    return a.resource_id === v.resource_id && a.role_code === v.role_code && a.scope_type === type &&
      String(a.scope_id) === String(v.scope_id) && (isBlank(a.end_date) || String(a.end_date) >= todayStr());
  });
  if (dup.length) throw new PpmError('VALIDATION', 'Ce rôle est déjà attribué à cette personne sur ce périmètre.');
  return repoInsert('RoleAssignment', {
    resource_id: v.resource_id, role_code: v.role_code, scope_type: type, scope_id: v.scope_id,
    start_date: v.start_date || todayStr(), end_date: v.end_date || ''
  }, ctx.actx);
});

/** Meilleur rang détenu par l'appelant sur le périmètre ou un périmètre englobant. */
function bestRankOn_(ctx, scope) {
  var chain = scopeAncestors(scope, ctx.lookup);
  var best = 99;
  ctx.assignments.forEach(function (a) {
    var covers = chain.some(function (s) { return s.type === a.scope_type && String(s.id) === String(a.scope_id); });
    if (covers && ROLE_RANK[a.role_code] < best) best = ROLE_RANK[a.role_code];
  });
  return best;
}

/** Fin d'une affectation : on renseigne la date de fin (hier), sans supprimer, pour garder l'historique. */
defineAction('roles.end', function (p, ctx) {
  var id = requireParam(p, 'id');
  var a = mustGet('RoleAssignment', id);
  requireCan(ctx, 'roles.assign', { type: a.scope_type, id: a.scope_id });
  if (!ctx.isAdmin && ROLE_RANK[a.role_code] < bestRankOn_(ctx, { type: a.scope_type, id: a.scope_id })) {
    throw new PpmError('FORBIDDEN', 'Vous ne pouvez pas retirer un rôle plus élevé que le vôtre.');
  }
  return repoUpdate('RoleAssignment', id, { end_date: addCalendarDays(todayStr(), -1) }, p.version, ctx.actx);
});

// ---------------------------------------------------------------- page web

/** Appel depuis la page (google.script.run) : mêmes contrôles que l'API JSON. */
function uiCall(action, params, requestId) {
  return handleRequest({ action: action, params: params || {}, apiVersion: PPM_API_VERSION, requestId: requestId || null },
    currentUserEmail_());
}

var PAGES = { gantt: 'Gantt', structure: 'Structure', suivi: 'Suivi', copilote: 'Copilote', compte: 'Compte', admin: 'Admin', budget: 'Budget' };
var PAGE_TITLES = { gantt: 'PPM — Planning', structure: 'PPM — Structure', suivi: 'PPM — Suivi', copilote: 'PPM — Copilote', compte: 'PPM — Mon compte', admin: 'PPM — Administration', budget: 'PPM — Budget' };
var PAGE_TABS = { gantt: [''], structure: ['obs', 'wbs'], suivi: ['ecarts', 'changes', 'baselines', 'workspace'], copilote: ['synthese', 'simulation', 'questions', 'suggestions'],
  compte: ['fiche', 'notifications', 'affichage'], admin: ['reglages', 'sante', 'feries', 'journaux'], budget: ['bilan', 'po', 'budget', 'taux'] };

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
  if (view === 'admin') { if (boot.isAdmin) put('admin.get', {}); return pre; }
  if (view === 'budget') {
    var bcat = put('planning.catalog', {});
    var bfirst = boot.project || (bcat.ok ? ((bcat.data.projects.filter(function (x) { return x.status !== 'Clos'; })[0] || bcat.data.projects[0] || {}).id || '') : '');
    if (bfirst) put('budget.access', { projectId: bfirst });
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
      if (boot.tab === 'wbs') put('wbs.tree', { projectId: first });
      else if (mode === 'teams') put('obs.teams', { rootTeamId: '' });
      else put('obs.tree', { scopeType: 'project', scopeId: first });
    }
  } else if (view === 'suivi' && first) {
    var list = put('baselines.list', { projectId: first });
    if (list.ok) {
      if (list.data.canReadFeed) put('changes.feed', { projectId: first, limit: 1 });
      if (boot.tab === 'ecarts' && list.data.project.active_baseline_id) put('baselines.diff', { projectId: first });
    }
  } else if (view === 'copilote' && first) {
    put('copilot.status', { projectId: first });
    if (boot.tab === 'synthese') put('copilot.brief', { projectId: first });
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
  var theme = '', home = 'gantt';
  try { var ui = loadPrefs_(currentUserEmail_()).ui; theme = ui.theme; home = ui.home; } catch (err) { theme = ''; }
  t.theme = theme === 'dark' || theme === 'light' ? theme : 'auto';
  boot.home = home;
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

// ======================================================================
// 33_Structure.gs
// ======================================================================

/**
 * PPM Core — lot 1 (suite) : personnes, OBS et WBS graphiques, préférences d'affichage.
 *
 *  - Une personne a une fonction (job_function) et une organisation (organization).
 *  - L'OBS se lit de deux façons : par rôles (qui pilote quoi, du Program Leader aux
 *    membres) ou par équipes hiérarchiques (HierarchicalTeam).
 *  - Le WBS se lit projet par projet : projet → workpackages → sous-workpackages → livrables et jalons.
 *  - Le serveur renvoie TOUS les attributs de chaque nœud ; le choix de ce qui est affiché est
 *    fait dans la page et mémorisé par utilisateur (UserSetting.view_prefs_json).
 *
 * Les fonctions build* sont pures (données déjà chargées) : elles sont testées hors ligne.
 */

// ---------------------------------------------------------------- catalogue des attributs affichables

/**
 * Pour ajouter un attribut affichable : une ligne ici, la valeur dans build*Tree, et l'affichage
 * dans Structure.html (fonction attrLines). Le nom (personne) et le titre du nœud sont toujours affichés.
 */
var VIEW_CATALOG = {
  obs: {
    attrs: [
      { key: 'scope', label: 'Périmètre du rôle (en-tête)', on: true },
      { key: 'job_function', label: 'Fonction', on: true },
      { key: 'organization', label: 'Organisation', on: true },
      { key: 'email', label: 'E-mail', on: false },
      { key: 'team', label: 'Équipe hiérarchique', on: false },
      { key: 'country', label: 'Pays', on: false },
      { key: 'resource_type', label: 'Interne ou externe', on: false },
      { key: 'supplier', label: 'Fournisseur', on: false },
      { key: 'capacity', label: 'Capacité (jours par mois)', on: false },
      { key: 'cost_center', label: 'Centre de coût (vue par équipes)', on: false },
      { key: 'members', label: 'Membres de l’équipe (vue par équipes)', on: false }
    ],
    colors: [
      { key: 'role', label: 'Rôle' },
      { key: 'organization', label: 'Organisation' },
      { key: 'resource_type', label: 'Interne ou externe' },
      { key: 'none', label: 'Aucune' }
    ],
    modes: ['roles', 'teams'],
    defaults: { colorBy: 'role', mode: 'roles' }
  },
  wbs: {
    attrs: [
      { key: 'wbs_code', label: 'Code WBS', on: true },
      { key: 'owner', label: 'Responsable', on: true },
      { key: 'owner_org', label: 'Organisation du responsable', on: false },
      { key: 'dates', label: 'Dates prévues', on: true },
      { key: 'progress', label: 'Avancement', on: true },
      { key: 'status', label: 'Statut', on: false },
      { key: 'charge_code', label: 'Code d’imputation', on: false },
      { key: 'float', label: 'Marge et chemin critique', on: false }
    ],
    colors: [
      { key: 'kind', label: 'Type de nœud' },
      { key: 'organization', label: 'Organisation du responsable' },
      { key: 'none', label: 'Aucune' }
    ],
    defaults: { colorBy: 'kind', showItems: true }
  }
};

function defaultPrefs_(view) {
  var cat = VIEW_CATALOG[view];
  var prefs = Object.assign({}, cat.defaults);
  prefs.attrs = cat.attrs.filter(function (a) { return a.on; }).map(function (a) { return a.key; });
  return prefs;
}

/** Ramène des préférences quelconques à une forme valide : clés inconnues ignorées, manquantes par défaut. */
function normalizePrefs_(view, raw) {
  var cat = VIEW_CATALOG[view];
  var out = defaultPrefs_(view);
  raw = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(raw.attrs)) {
    var wanted = {};
    raw.attrs.forEach(function (k) { wanted[String(k)] = true; });
    out.attrs = cat.attrs.map(function (a) { return a.key; }).filter(function (k) { return wanted[k]; });
  }
  if (cat.colors.some(function (c) { return c.key === raw.colorBy; })) out.colorBy = raw.colorBy;
  if (view === 'obs' && cat.modes.indexOf(raw.mode) >= 0) out.mode = raw.mode;
  if (view === 'wbs' && typeof raw.showItems === 'boolean') out.showItems = raw.showItems;
  return out;
}

function userSettingRow_(email) {
  var rows = repoList('UserSetting', function (u) { return String(u.user_email).toLowerCase() === email; });
  return rows.length ? rows[0] : null;
}

function loadPrefs_(email) {
  var row = userSettingRow_(email);
  var saved = row ? parseJsonSafe(row.view_prefs_json, {}) : {};
  var theme = saved.ui && ['light', 'dark', 'auto'].indexOf(saved.ui.theme) >= 0 ? saved.ui.theme : 'auto';
  var home = saved.ui && HOME_VIEWS.indexOf(saved.ui.home) >= 0 ? saved.ui.home : 'gantt';
  return { obs: normalizePrefs_('obs', saved.obs), wbs: normalizePrefs_('wbs', saved.wbs), ui: { theme: theme, home: home } };
}

// ---------------------------------------------------------------- personnes

/** Champs d'une personne visibles par tous. rate_profile n'en fait pas partie (visibilité des TJM : question ouverte). */
var RESOURCE_WRITABLE = ['resource_type', 'name', 'team_id', 'country', 'job_function', 'organization', 'supplier', 'capacity_days_month'];
var RESOURCE_SELF_WRITABLE = ['job_function', 'organization'];

function canEditResources_(ctx) {
  return ctx.isAdmin || can(ctx, 'resource.edit', { type: 'global' });
}

function personCard_(r, teamsById, ctx, editAll) {
  var team = !isBlank(r.team_id) ? teamsById[r.team_id] : null;
  return {
    resource_id: r.id, name: r.name, email: r.email || '',
    job_function: r.job_function || '', organization: r.organization || '',
    team: team ? team.name : '', country: r.country || '', resource_type: r.resource_type || '',
    supplier: r.supplier || '', capacity: isBlank(r.capacity_days_month) ? '' : Number(r.capacity_days_month),
    team_id: r.team_id || '', version: r.version, canEdit: editAll || (!!ctx.resourceId && ctx.resourceId === r.id)
  };
}

function byName_(a, b) {
  return String(a.name).localeCompare(String(b.name), 'fr', { sensitivity: 'base' });
}

// ---------------------------------------------------------------- OBS par rôles

function scopeLabel_(data, type, id) {
  var rec = ({ program: indexBy_(data.programs), project: indexBy_(data.projects), workpackage: indexBy_(data.workpackages) }[type] || {})[id];
  if (!rec) return '';
  if (type === 'workpackage') return (rec.wbs_code ? rec.wbs_code + ' ' : '') + rec.name;
  return rec.code + ' — ' + rec.name;
}

/**
 * Arbre des rôles autour d'un périmètre : les rôles du périmètre et de ce qu'il contient,
 * plus ceux des périmètres qui le contiennent (pour que la hiérarchie soit complète).
 * Un nœud = un rôle sur un périmètre, avec ses titulaires. Son parent est le rôle immédiatement
 * supérieur qui couvre son périmètre (par exemple un chef de projet a pour parent le DPL du programme).
 */
function buildObsTree(data, scopeType, scopeId, today, ctx) {
  if (!SCOPE_TABLE[scopeType]) throw new PpmError('VALIDATION', 'Périmètre invalide : ' + scopeType);
  var rootLabel = scopeLabel_(data, scopeType, scopeId);
  if (!rootLabel) throw new PpmError('NOT_FOUND', 'Périmètre introuvable : ' + scopeId);

  var lookup = memoryLookup(data);
  var resById = indexBy_(data.resources), teamsById = indexBy_(data.teams);
  var editAll = canEditResources_(ctx);
  var mine = {};
  scopeAncestors({ type: scopeType, id: scopeId }, lookup).forEach(function (s) { mine[s.type + ':' + s.id] = true; });

  var groups = {}, order = [];
  data.assignments.forEach(function (a) {
    if (isTrue(a.deleted)) return;
    if (!isBlank(a.start_date) && String(a.start_date) > today) return;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var res = resById[a.resource_id];
    if (!res || isTrue(res.deleted)) return;
    var label = scopeLabel_(data, a.scope_type, a.scope_id);
    if (!label) return; // périmètre supprimé
    var chain = scopeAncestors({ type: a.scope_type, id: a.scope_id }, lookup);
    var below = chain.some(function (s) { return s.type === scopeType && String(s.id) === String(scopeId); });
    if (!below && !mine[a.scope_type + ':' + a.scope_id]) return;

    var key = a.role_code + '|' + a.scope_type + '|' + a.scope_id;
    if (!groups[key]) {
      groups[key] = {
        id: 'role:' + key, parent: '', role_code: a.role_code, role_label: ROLE_LABELS[a.role_code] || a.role_code,
        rank: ROLE_RANK[a.role_code], scope_type: a.scope_type, scope_id: a.scope_id, scope_label: label,
        chain: chain, people: [], seen: {}
      };
      order.push(key);
    }
    var g = groups[key];
    if (g.seen[res.id]) { g.seen[res.id].assignment_ids.push(a.id); return; } // la même affectation en double : on garde toutes les lignes pour pouvoir les terminer ensemble
    var card = personCard_(res, teamsById, ctx, editAll);
    card.assignment_ids = [a.id];
    g.seen[res.id] = card;
    g.people.push(card);
  });

  var list = order.map(function (k) { return groups[k]; });
  list.forEach(function (g) {
    var best = null;
    list.forEach(function (h) {
      if (h === g || h.rank >= g.rank) return;
      var at = -1;
      g.chain.forEach(function (s, i) { if (at < 0 && s.type === h.scope_type && String(s.id) === String(h.scope_id)) at = i; });
      if (at < 0) return;
      if (!best || h.rank > best.h.rank || (h.rank === best.h.rank && at < best.at) ||
          (h.rank === best.h.rank && at === best.at && h.id < best.h.id)) best = { h: h, at: at };
    });
    g.parent = best ? best.h.id : '';
  });

  list.sort(function (a, b) {
    return (a.rank - b.rank) || a.scope_label.localeCompare(b.scope_label, 'fr') || 0;
  });
  var people = 0;
  var nodes = list.map(function (g) {
    g.people.sort(byName_);
    people += g.people.length;
    return {
      id: g.id, parent: g.parent, role_code: g.role_code, role_label: g.role_label,
      scope_type: g.scope_type, scope_id: g.scope_id, scope_label: g.scope_label, people: g.people,
      rank: g.rank, canAssign: !!ctx && can(ctx, 'roles.assign', { type: g.scope_type, id: g.scope_id }),
      min_rank: ctx && !ctx.isAdmin ? bestRankOn_(ctx, { type: g.scope_type, id: g.scope_id }) : 0
    };
  });
  return {
    mode: 'roles', scope: { type: scopeType, id: scopeId, label: rootLabel }, nodes: nodes,
    canEditAll: editAll, stats: { nodes: nodes.length, people: people }
  };
}

// ---------------------------------------------------------------- OBS par équipes

/**
 * Arbre des équipes hiérarchiques (HierarchicalTeam). rootTeamId limite à une branche.
 * Les personnes sans équipe sont regroupées dans un nœud « Sans équipe » (vue complète seulement).
 */
function buildTeamTree(data, rootTeamId, ctx) {
  var teams = data.teams.filter(function (t) { return !isTrue(t.deleted); });
  var byId = indexBy_(teams);
  var resources = data.resources.filter(function (r) { return !isTrue(r.deleted); });
  var resById = indexBy_(resources);
  var editAll = canEditResources_(ctx);

  // Un cycle dans les parents est traité comme une racine, pour que l'arbre reste dessinable.
  var parentOf = {};
  teams.forEach(function (t) {
    var p = !isBlank(t.parent_team_id) && byId[t.parent_team_id] ? t.parent_team_id : '';
    var cur = p, guard = 0, cyclic = false;
    while (cur && guard++ < 100) {
      if (cur === t.id) { cyclic = true; break; }
      var up = byId[cur] && !isBlank(byId[cur].parent_team_id) ? byId[cur].parent_team_id : '';
      cur = byId[up] ? up : '';
    }
    parentOf[t.id] = cyclic ? '' : p;
  });

  var depthOf = function (id) { var d = 0, cur = parentOf[id]; while (cur && d < 100) { d++; cur = parentOf[cur]; } return d; };
  var pathOf = function (id) { var names = [], cur = id, g = 0; while (cur && g++ < 100) { names.unshift(byId[cur].name); cur = parentOf[cur]; } return names.join(' / '); };

  if (!isBlank(rootTeamId) && !byId[rootTeamId]) throw new PpmError('NOT_FOUND', 'Équipe introuvable : ' + rootTeamId);
  var inBranch = function (id) {
    if (isBlank(rootTeamId)) return true;
    var cur = id, g = 0;
    while (cur && g++ < 100) { if (cur === rootTeamId) return true; cur = parentOf[cur]; }
    return false;
  };

  var membersOf = {}, unassigned = [];
  resources.forEach(function (r) {
    if (!isBlank(r.team_id) && byId[r.team_id]) (membersOf[r.team_id] = membersOf[r.team_id] || []).push(r);
    else unassigned.push(r);
  });
  var card = function (r) { return personCard_(r, byId, ctx, editAll); };

  var nodes = teams.filter(function (t) { return inBranch(t.id); }).map(function (t) {
    var mgr = !isBlank(t.manager_resource_id) ? resById[t.manager_resource_id] : null;
    var members = (membersOf[t.id] || []).filter(function (r) { return !mgr || r.id !== mgr.id; }).map(card).sort(byName_);
    return {
      id: 'team:' + t.id, parent: parentOf[t.id] && inBranch(parentOf[t.id]) && t.id !== rootTeamId ? 'team:' + parentOf[t.id] : '',
      team_id: t.id, name: t.name, cost_center: t.cost_center || '', manager: mgr ? card(mgr) : null,
      version: t.version, parent_team_id: parentOf[t.id] || '', manager_id: mgr ? mgr.id : '',
      members: members, member_count: members.length, sort: pathOf(t.id)
    };
  }).sort(function (a, b) { return a.sort.localeCompare(b.sort, 'fr'); });
  nodes.forEach(function (n) { delete n.sort; });

  if (isBlank(rootTeamId) && unassigned.length) {
    nodes.push({
      id: 'team:none', parent: '', team_id: '', name: 'Sans équipe', cost_center: '', manager: null,
      members: unassigned.map(card).sort(byName_), member_count: unassigned.length
    });
  }
  return {
    mode: 'teams', root_team_id: rootTeamId || '', nodes: nodes, canEditAll: editAll,
    teams: teams.map(function (t) { return { id: t.id, name: t.name, depth: depthOf(t.id), path: pathOf(t.id) }; })
      .sort(function (a, b) { return a.path.localeCompare(b.path, 'fr'); }),
    stats: { nodes: nodes.length, people: resources.length }
  };
}

// ---------------------------------------------------------------- WBS

/** Marges du projet (les éléments liés d'autres projets sont des contraintes fixes). */
function floatsForProject_(data, projectId, items, holFor) {
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var all = indexBy_(data.planitems);
  var deps = data.dependencies.filter(function (d) { return ids[d.predecessor_id] || ids[d.successor_id]; });
  var ext = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) {
      if (!ids[id] && all[id]) ext[id] = Object.assign({}, all[id], { external: true });
    });
  });
  return computeFloats(items.concat(Object.keys(ext).map(function (k) { return ext[k]; })), deps, holFor);
}

/**
 * Arbre du WBS d'un projet : projet → WP → sous-WP → livrables et jalons.
 * Les WP portent des valeurs de synthèse (dates, avancement pondéré, chemin critique).
 */
function buildWbsTree(data, projectId, today, ctx) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var holFor = holidayResolver(data);
  var resById = indexBy_(data.resources);
  var who = function (id) { return !isBlank(id) && resById[id] ? resById[id] : null; };

  var items = data.planitems.filter(function (i) { return i.project_id === projectId; });
  var wps = data.workpackages.filter(function (w) { return w.project_id === projectId; });
  var wpById = indexBy_(wps);
  var floats = floatsForProject_(data, projectId, items, holFor);
  var fl = function (id) { return floats.byId[id] || {}; };
  // Droit de modifier chaque carte (wbs.edit sur son périmètre) : la page n'affiche des boutons que là où c'est permis.
  var canEdit = function (type, id) { return !!ctx && can(ctx, 'wbs.edit', { type: type, id: id }); };
  var depCount = {};
  (data.dependencies || []).forEach(function (d) {
    depCount[d.predecessor_id] = (depCount[d.predecessor_id] || 0) + 1;
    depCount[d.successor_id] = (depCount[d.successor_id] || 0) + 1;
  });

  var childrenOfWp = {}, itemsOfWp = {};
  wps.forEach(function (w) {
    var p = !isBlank(w.parent_wp_id) && wpById[w.parent_wp_id] ? w.parent_wp_id : '';
    (childrenOfWp[p] = childrenOfWp[p] || []).push(w);
  });
  items.forEach(function (i) {
    var k = !isBlank(i.wp_id) && wpById[i.wp_id] ? i.wp_id : '';
    (itemsOfWp[k] = itemsOfWp[k] || []).push(i);
  });
  var deepItems = function (wpId) {
    var acc = (itemsOfWp[wpId] || []).slice();
    (childrenOfWp[wpId] || []).forEach(function (c) { acc = acc.concat(deepItems(c.id)); });
    return acc;
  };
  var summary = function (its) {
    var sp = span_(its), minFloat = null, crit = false;
    its.forEach(function (i) {
      var f = fl(i.id);
      if (f.critical) crit = true;
      if (f.float !== null && f.float !== undefined && (minFloat === null || f.float < minFloat)) minFloat = f.float;
    });
    return {
      start: sp.start, finish: sp.finish, progress: weightedProgress_(its, holFor), critical: crit, float: minFloat,
      late: its.some(function (i) { return !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today; })
    };
  };
  var ownerOf = function (id) {
    var r = who(id);
    return { owner: r ? r.name : '', owner_org: r ? r.organization || '' : '', owner_function: r ? r.job_function || '' : '' };
  };

  var rootId = 'project:' + project.id;
  var nodes = [Object.assign({
    id: rootId, parent: '', kind: 'project', name: project.name, code: project.code, status: project.status || '',
    charge_code: '', ref: project.id, canEdit: canEdit('project', project.id), cpn: project.cpn || '', cpn_label: project.cpn_label || ''
  }, ownerOf(project.manager_resource_id), summary(items))];

  var emitWp = function (w, parentId) {
    var all = deepItems(w.id);
    var id = 'wp:' + w.id;
    nodes.push(Object.assign({
      id: id, parent: parentId, kind: 'wp', name: w.name, code: w.wbs_code || '', status: '', charge_code: w.charge_code || '',
      ref: w.id, version: w.version, owner_id: w.owner_resource_id || '', parent_ref: w.parent_wp_id || '', canEdit: canEdit('workpackage', w.id),
      cpn: w.cpn || '', cpn_label: w.cpn_label || ''
    }, ownerOf(w.owner_resource_id), summary(all)));
    (childrenOfWp[w.id] || []).slice().sort(byWbs_).forEach(function (c) { emitWp(c, id); });
    (itemsOfWp[w.id] || []).slice().sort(byStartThenName_).forEach(function (i) { emitItem(i, id); });
  };
  var emitItem = function (i, parentId) {
    var f = fl(i.id);
    nodes.push(Object.assign({
      id: 'item:' + i.id, parent: parentId, kind: 'item', item_type: i.item_type, name: i.name, code: '',
      status: i.status || '', charge_code: '',
      start: itemStart(i) || null, finish: itemFinish(i) || null, progress: Number(i.progress_pct) || 0,
      critical: !!f.critical, float: f.float === undefined ? null : f.float,
      late: !isDone_(i) && !isBlank(itemFinish(i)) && itemFinish(i) < today,
      ref: i.id, version: i.version, owner_id: i.owner_resource_id || '', wp_ref: i.wp_id || '', raw_start: i.planned_start || '', raw_finish: i.planned_finish || '',
      milestone_category: i.milestone_category || '', dep_count: depCount[i.id] || 0, canEdit: canEdit('planitem', i.id)
    }, ownerOf(i.owner_resource_id)));
  };
  (childrenOfWp[''] || []).slice().sort(byWbs_).forEach(function (w) { emitWp(w, rootId); });
  (itemsOfWp[''] || []).slice().sort(byStartThenName_).forEach(function (i) { emitItem(i, rootId); });

  var program = !isBlank(project.program_id) ? indexBy_(data.programs)[project.program_id] : null;
  return {
    today: today,
    project: { id: project.id, code: project.code, name: project.name, program_id: project.program_id || '',
      program_name: program ? program.name : '' },
    nodes: nodes,
    canCreate: canEdit('project', projectId),
    canCpn: !!ctx && can(ctx, 'cpn.edit', { type: 'project', id: projectId }),
    stats: {
      wps: wps.length, items: items.length,
      depth: wps.some(function (w) { return !isBlank(w.parent_wp_id); }) ? 2 : (wps.length ? 1 : 0)
    }
  };
}

// ---------------------------------------------------------------- actions de l'API

function loadObsData_() {
  return {
    programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage'),
    resources: repoList('Resource'), assignments: repoList('RoleAssignment'), teams: repoList('HierarchicalTeam')
  };
}

function loadWbsData_() {
  return {
    programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'), dependencies: repoList('Dependency'), resources: repoList('Resource'),
    holidaySets: repoList('HolidaySet')
  };
}

defineAction('views.config', function (p, ctx) {
  return { catalog: VIEW_CATALOG, prefs: loadPrefs_(ctx.email) };
});

defineAction('prefs.set', function (p, ctx) {
  var view = requireParam(p, 'view');
  if (!VIEW_CATALOG[view]) throw new PpmError('VALIDATION', 'Vue inconnue : ' + view);
  var saved = {};
  var row = userSettingRow_(ctx.email);
  if (row) saved = parseJsonSafe(row.view_prefs_json, {});
  saved[view] = normalizePrefs_(view, p.prefs);
  var json = JSON.stringify(saved);
  if (row) repoUpdate('UserSetting', row.id, { view_prefs_json: json }, null, ctx.actx);
  else repoInsert('UserSetting', { user_email: ctx.email, view_prefs_json: json }, ctx.actx);
  return saved[view];
});

/** Réglages d'interface de l'utilisateur (thème jour, nuit ou celui de l'ordinateur). */
defineAction('ui.set', function (p, ctx) {
  if (p.theme === undefined && p.home === undefined) throw new PpmError('VALIDATION', 'Rien à enregistrer.');
  if (p.theme !== undefined && ['light', 'dark', 'auto'].indexOf(p.theme) < 0) throw new PpmError('VALIDATION', 'Thème attendu : light, dark ou auto.');
  if (p.home !== undefined && HOME_VIEWS.indexOf(p.home) < 0) throw new PpmError('VALIDATION', 'Page d’accueil inconnue.');
  var row = userSettingRow_(ctx.email);
  var saved = row ? parseJsonSafe(row.view_prefs_json, {}) : {};
  saved.ui = Object.assign({}, saved.ui || {});
  if (p.theme !== undefined) saved.ui.theme = p.theme;
  if (p.home !== undefined) saved.ui.home = p.home;
  if (row) repoUpdate('UserSetting', row.id, { view_prefs_json: JSON.stringify(saved) }, null, ctx.actx);
  else repoInsert('UserSetting', { user_email: ctx.email, view_prefs_json: JSON.stringify(saved) }, ctx.actx);
  return loadPrefs_(ctx.email).ui;
});

defineAction('obs.tree', function (p, ctx) {
  return buildObsTree(loadObsData_(), requireParam(p, 'scopeType'), requireParam(p, 'scopeId'), todayStr(), ctx);
});

defineAction('obs.teams', function (p, ctx) {
  return buildTeamTree(loadObsData_(), p.rootTeamId || '', ctx);
});

defineAction('wbs.tree', function (p, ctx) {
  return buildWbsTree(loadWbsData_(), requireParam(p, 'projectId'), todayStr(), ctx);
});

// ---- personnes

defineAction('resources.list', function (p, ctx) {
  var editAll = canEditResources_(ctx);
  var q = String(p.q || '').toLowerCase();
  var teams = indexBy_(repoList('HierarchicalTeam'));
  var rows = repoList('Resource', function (r) {
    return !q || [r.name, r.email, r.job_function, r.organization].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
  }).map(function (r) { return personCard_(r, teams, ctx, editAll); }).sort(byName_);
  return paginate(rows, p);
});

function assertTeam_(values) {
  if (!isBlank(values.team_id) && !repoGet('HierarchicalTeam', values.team_id)) throw new PpmError('VALIDATION', 'Équipe introuvable.');
}

function cleanResourceValues_(values, allowed) {
  var out = {};
  Object.keys(values || {}).forEach(function (k) {
    if (allowed.indexOf(k) >= 0) out[k] = values[k];
  });
  return out;
}

defineAction('resources.create', function (p, ctx) {
  requireCan(ctx, 'resource.edit', { type: 'global' });
  var v = p.values || {};
  var values = cleanResourceValues_(v, RESOURCE_WRITABLE.concat(['email']));
  if (!isBlank(values.email)) {
    values.email = String(values.email).toLowerCase();
    if (findResourceByEmail(values.email)) throw new PpmError('VALIDATION', 'Cette adresse est déjà utilisée par une autre personne.');
    values = fillFromDirectory_(values); // nom, fonction, organisation depuis l'annuaire s'ils manquent
  }
  assertTeam_(values);
  return repoInsert('Resource', values, ctx.actx);
});

defineAction('resources.update', function (p, ctx) {
  var id = requireParam(p, 'id');
  var res = mustGet('Resource', id);
  var editAll = canEditResources_(ctx);
  var self = !!ctx.resourceId && ctx.resourceId === res.id;
  if (!editAll && !self) throw new PpmError('FORBIDDEN', 'Vous ne pouvez modifier que votre propre fiche.');
  var allowed = editAll ? RESOURCE_WRITABLE : RESOURCE_SELF_WRITABLE;
  var patch = cleanResourceValues_(p.patch, allowed);
  var refused = Object.keys(p.patch || {}).filter(function (k) { return allowed.indexOf(k) < 0; });
  if (refused.length) {
    throw new PpmError('FORBIDDEN', 'Champ(s) non modifiable(s) par vous : ' + refused.join(', ') +
      (editAll ? '' : ' (vous pouvez modifier votre fonction et votre organisation).'));
  }
  assertTeam_(patch);
  return repoUpdate('Resource', id, patch, p.version, ctx.actx);
});

/**
 * Fiche saisie dans AppSheet : mêmes règles que l'API. Un membre modifie sa fonction et son organisation ;
 * PL, DPL et chef de projet modifient toute fiche. Sinon la modification est annulée et son auteur prévenu.
 */
function hookResourceGuard(before, rec, actx) {
  var ctx = buildContext(actx.actor);
  if (canEditResources_(ctx)) return true;
  var self = !!ctx.resourceId && ctx.resourceId === rec.id;
  var core = { actor: 'ppm-core', source: 'core' };
  if (!before) {
    repoUpdate('Resource', rec.id, { deleted: true }, null, core);
    notifyUser(actx.actor, 'Création de fiche annulée',
      'Seuls un Program Leader, un DPL ou un chef de projet peuvent ajouter une personne. La fiche « ' + rec.name + ' » a été annulée.');
    return false;
  }
  var changed = diffRecords(before, rec, businessFields('Resource')).map(function (d) { return d.field; });
  var illegal = changed.filter(function (f) { return !(self && RESOURCE_SELF_WRITABLE.indexOf(f) >= 0); });
  if (!illegal.length) return true;
  var restore = {};
  illegal.forEach(function (f) { restore[f] = before[f]; });
  repoUpdate('Resource', rec.id, restore, null, core);
  notifyUser(actx.actor, 'Modification de fiche annulée',
    'Vous ne pouvez pas modifier ' + (self ? 'ces champs de votre fiche' : 'la fiche de ' + rec.name) + ' (' + illegal.join(', ') + '). ' +
    (self ? 'Votre fonction et votre organisation restent modifiables.' : 'Demandez à votre chef de projet ou DPL.'));
  return false;
}

// ======================================================================
// 34_Baselines.gs
// ======================================================================

/**
 * PPM Core — lot 2 : baselines, écarts, fil des changements du chef de projet (section 5.3).
 *
 *  - Une baseline fige, pour un projet : dates et responsables des livrables et jalons, WP,
 *    dépendances, budget et étalement, périmètre (liste des PlanItems). Copie dans BaselineItem.
 *  - Tout membre du projet peut DEMANDER une baseline ; seul le chef de projet (ou le DPL) la FIGE,
 *    avec une justification. Une seule est active ; les anciennes restent consultables et comparables.
 *  - Les écarts se calculent à la demande, en comparant deux instantanés de même forme :
 *    la baseline et l'état courant (ou deux baselines entre elles).
 *  - Toute modification d'une donnée figée reste dans le fil du chef de projet jusqu'à son acquittement.
 *
 * Les fonctions projectSnapshot_, diffSnapshots et buildChangeFeed sont pures (testées hors ligne).
 */

/** Champs figés par table. La même liste définit ce qui entre dans le fil des changements. */
var BASELINE_FIELDS = {
  Project: ['start_date', 'end_date', 'holiday_country'],
  WorkPackage: ['name', 'wbs_code', 'parent_wp_id', 'owner_resource_id', 'charge_code'],
  PlanItem: ['name', 'item_type', 'wp_id', 'owner_resource_id', 'planned_start', 'planned_finish', 'milestone_category'],
  Dependency: ['predecessor_id', 'successor_id', 'dep_type', 'lag_days'],
  BudgetLine: ['deliverable_id', 'resource_id', 'cost_type', 'planned_days', 'frozen_rate', 'fixed_amount', 'planned_amount']
};

var FIELD_LABELS = {
  start_date: 'début du projet', end_date: 'fin visée', holiday_country: 'calendrier',
  name: 'nom', wbs_code: 'code WBS', parent_wp_id: 'WP parent', owner_resource_id: 'responsable', charge_code: 'imputation',
  item_type: 'type', wp_id: 'workpackage', planned_start: 'début prévu', planned_finish: 'fin prévue',
  milestone_category: 'catégorie de jalon', predecessor_id: 'prédécesseur', successor_id: 'successeur',
  dep_type: 'type de lien', lag_days: 'décalage', deliverable_id: 'livrable', resource_id: 'ressource',
  cost_type: 'type de coût', planned_days: 'jours prévus', frozen_rate: 'taux figé', fixed_amount: 'forfait',
  planned_amount: 'montant prévu', deleted: 'suppression', '*': 'création ou suppression'
};

// ---------------------------------------------------------------- instantanés

/** data : { projects, workpackages, planitems, dependencies, budgetLines, phasing } (lignes vivantes). */
function projectSnapshot_(data, projectId) {
  var snap = { Project: {}, WorkPackage: {}, PlanItem: {}, Dependency: {}, BudgetLine: {} };
  var project = indexBy_(data.projects)[projectId];
  if (project) snap.Project[project.id] = pickFields(project, BASELINE_FIELDS.Project);
  data.workpackages.forEach(function (w) {
    if (w.project_id === projectId) snap.WorkPackage[w.id] = pickFields(w, BASELINE_FIELDS.WorkPackage);
  });
  data.planitems.forEach(function (i) {
    if (i.project_id === projectId) snap.PlanItem[i.id] = pickFields(i, BASELINE_FIELDS.PlanItem);
  });
  data.dependencies.forEach(function (d) {
    if (snap.PlanItem[d.successor_id]) snap.Dependency[d.id] = pickFields(d, BASELINE_FIELDS.Dependency);
  });
  var phasing = {};
  (data.phasing || []).forEach(function (ph) {
    (phasing[ph.budget_line_id] = phasing[ph.budget_line_id] || []).push({ month: ph.month, amount: Number(ph.amount) || 0 });
  });
  (data.budgetLines || []).forEach(function (b) {
    if (!snap.PlanItem[b.deliverable_id]) return;
    var rec = pickFields(b, BASELINE_FIELDS.BudgetLine);
    rec.phasing = (phasing[b.id] || []).sort(function (x, y) { return String(x.month) < String(y.month) ? -1 : 1; });
    snap.BudgetLine[b.id] = rec;
  });
  return snap;
}

function snapshotToRows_(baselineId, snap) {
  var rows = [];
  Object.keys(snap).forEach(function (type) {
    Object.keys(snap[type]).forEach(function (id) {
      rows.push({ id: newId(), baseline_id: baselineId, entity_type: type, entity_id: id, snapshot_json: JSON.stringify(snap[type][id]) });
    });
  });
  return rows;
}

function rowsToSnapshot_(rows) {
  var snap = { Project: {}, WorkPackage: {}, PlanItem: {}, Dependency: {}, BudgetLine: {} };
  rows.forEach(function (r) {
    if (!snap[r.entity_type]) snap[r.entity_type] = {};
    snap[r.entity_type][r.entity_id] = parseJsonSafe(r.snapshot_json, {});
  });
  return snap;
}

function loadSnapshotData_() {
  return {
    projects: repoList('Project'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'), budgetLines: repoList('BudgetLine'), phasing: repoList('BudgetPhasing')
  };
}

function loadBaselineSnapshot_(baselineId) {
  return rowsToSnapshot_(repoList('BaselineItem', function (r) { return r.baseline_id === baselineId; }));
}

/** Baseline active d'un projet et son instantané, ou null. */
function activeBaselineOf_(project) {
  if (!project || isBlank(project.active_baseline_id)) return null;
  var b = repoGet('Baseline', project.active_baseline_id);
  if (!b || isTrue(b.deleted) || b.status !== 'Active') return null;
  return { row: b, snap: loadBaselineSnapshot_(b.id) };
}

// ---------------------------------------------------------------- écarts

function budgetByItem_(snap) {
  var out = {};
  Object.keys(snap.BudgetLine || {}).forEach(function (id) {
    var b = snap.BudgetLine[id];
    out[b.deliverable_id] = round2((out[b.deliverable_id] || 0) + (Number(b.planned_amount) || 0));
  });
  return out;
}

function lastFinish_(snap) {
  var f = '';
  Object.keys(snap.PlanItem).forEach(function (id) {
    var d = snap.PlanItem[id].planned_finish;
    if (!isBlank(d) && d > f) f = d;
  });
  return f || null;
}

/**
 * Compare deux instantanés de même forme. hol : fériés du calendrier du projet.
 * Glissement en jours ouvrés : positif = plus tard que la référence.
 */
function diffSnapshots(base, cur, hol) {
  var ids = {};
  Object.keys(base.PlanItem).concat(Object.keys(cur.PlanItem)).forEach(function (id) { ids[id] = true; });
  var bBudget = budgetByItem_(base), cBudget = budgetByItem_(cur);
  var shift = function (a, b) { return !isBlank(a) && !isBlank(b) ? workingDayOffset(a, b, hol) : null; };
  var items = Object.keys(ids).map(function (id) {
    var b = base.PlanItem[id] || null, c = cur.PlanItem[id] || null;
    var ref = c || b;
    var row = {
      id: id, name: ref.name, item_type: ref.item_type, wp_id: ref.wp_id || '',
      base_start: b ? b.planned_start || null : null, base_finish: b ? b.planned_finish || null : null,
      start: c ? c.planned_start || null : null, finish: c ? c.planned_finish || null : null,
      base_owner: b ? b.owner_resource_id || '' : '', owner: c ? c.owner_resource_id || '' : '',
      base_budget: bBudget[id] || 0, budget: cBudget[id] || 0
    };
    row.budget_delta = round2(row.budget - row.base_budget);
    if (!b) { row.state = 'added'; row.slip = null; row.start_shift = null; return row; }
    if (!c) { row.state = 'removed'; row.slip = null; row.start_shift = null; return row; }
    row.slip = shift(b.planned_finish, c.planned_finish);
    row.start_shift = shift(b.planned_start, c.planned_start);
    row.owner_changed = row.base_owner !== row.owner;
    row.renamed = String(b.name) !== String(c.name);
    row.moved = String(b.wp_id || '') !== String(c.wp_id || '');
    var datesChanged = String(b.planned_finish || '') !== String(c.planned_finish || '') ||
      String(b.planned_start || '') !== String(c.planned_start || '');
    row.state = datesChanged || row.owner_changed || row.renamed || row.moved || row.budget_delta !== 0 ? 'changed' : 'same';
    return row;
  });
  var order = { added: 1, changed: 0, removed: 2, same: 3 };
  items.sort(function (x, y) {
    return (order[x.state] - order[y.state]) || ((y.slip || 0) - (x.slip || 0)) ||
      String(x.base_finish || x.finish || '').localeCompare(String(y.base_finish || y.finish || '')) ||
      String(x.name).localeCompare(String(y.name));
  });
  var endBase = lastFinish_(base), endCur = lastFinish_(cur);
  var sum = function (m) { return round2(Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0)); };
  var slips = items.filter(function (i) { return i.slip !== null; }).map(function (i) { return i.slip; });
  var budgetBase = sum(bBudget), budgetCur = sum(cBudget);
  return {
    items: items,
    totals: {
      compared: items.length,
      slipped: items.filter(function (i) { return i.slip > 0; }).length,
      advanced: items.filter(function (i) { return i.slip < 0; }).length,
      max_slip: slips.length ? Math.max.apply(null, slips.concat([0])) : 0,
      added: items.filter(function (i) { return i.state === 'added'; }).length,
      removed: items.filter(function (i) { return i.state === 'removed'; }).length,
      owner_changes: items.filter(function (i) { return i.owner_changed; }).length,
      end_base: endBase, end: endCur, end_slip: endBase && endCur ? workingDayOffset(endBase, endCur, hol) : null,
      budget_base: budgetBase, budget: budgetCur, budget_delta: round2(budgetCur - budgetBase)
    }
  };
}

// ---------------------------------------------------------------- fil des changements

/** Champs figés mais calculés : ils bougent avec le champ saisi, inutile de les montrer deux fois dans le fil. */
var FEED_COMPUTED = { BudgetLine: ['planned_amount'] };

/** Un événement entre dans le fil s'il touche une donnée figée : création, suppression ou champ figé saisi. */
function isBaselinedEvent_(e) {
  var fields = BASELINE_FIELDS[e.table_name];
  if (!fields) return false;
  if ((FEED_COMPUTED[e.table_name] || []).indexOf(e.field) >= 0) return false;
  return e.field === '*' || e.field === 'deleted' || fields.indexOf(e.field) >= 0;
}

/**
 * Fil d'un projet : événements sur des données figées, postérieurs à la baseline active.
 * names : { resource: {id: nom}, item: {id: nom}, wp: {id: nom} } pour rendre les valeurs lisibles.
 */
function buildChangeFeed(events, projectId, since, names, opts) {
  opts = opts || {};
  var label = function (table, id) {
    if (table === 'PlanItem') return names.item[id] || '(élément supprimé)';
    if (table === 'WorkPackage') return names.wp[id] ? 'WP ' + names.wp[id] : '(WP supprimé)';
    if (table === 'Project') return 'Projet';
    if (table === 'Dependency') return names.dep[id] || 'Dépendance';
    if (table === 'BudgetLine') return names.budget[id] ? 'Budget de ' + names.budget[id] : 'Ligne budgétaire';
    return table;
  };
  var human = function (field, v) {
    if (isBlank(v)) return '';
    if (field === 'owner_resource_id' || field === 'resource_id') return names.resource[v] || v;
    if (field === 'wp_id' || field === 'parent_wp_id') return names.wp[v] || v;
    if (field === 'predecessor_id' || field === 'successor_id' || field === 'deliverable_id') return names.item[v] || v;
    if (field === 'deleted') return isTrue(v) ? 'supprimé' : 'actif';
    return String(v);
  };
  var rows = events.filter(function (e) {
    return e.project_id === projectId && String(e.at) >= since && isBaselinedEvent_(e) &&
      (opts.all || !isTrue(e.acknowledged));
  }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)); });
  return rows.map(function (e) {
    var what;
    if (e.field === '*') what = e.new_value === '(création)' ? 'ajout' : 'suppression';
    else if (e.field === 'deleted') what = isTrue(e.new_value) ? 'suppression' : 'rétablissement';
    else what = 'modification';
    return {
      id: e.id, at: e.at, actor: e.actor, actor_name: names.byEmail ? names.byEmail[String(e.actor).toLowerCase()] || '' : '', source: e.source, table: e.table_name, entity_id: e.entity_id,
      entity: label(e.table_name, e.entity_id), what: what, field: e.field,
      field_label: FIELD_LABELS[e.field] || e.field,
      old_value: human(e.field, e.old_value), new_value: human(e.field, e.new_value),
      acknowledged: isTrue(e.acknowledged), acknowledged_by: e.acknowledged_by || ''
    };
  });
}

function feedNames_() {
  var names = { resource: {}, item: {}, wp: {}, dep: {}, budget: {}, byEmail: {} };
  repoList('Resource', null, { includeDeleted: true }).forEach(function (r) {
    names.resource[r.id] = r.name;
    if (!isBlank(r.email)) names.byEmail[String(r.email).toLowerCase()] = r.name;
  });
  repoList('PlanItem', null, { includeDeleted: true }).forEach(function (i) { names.item[i.id] = i.name; });
  repoList('WorkPackage', null, { includeDeleted: true }).forEach(function (w) { names.wp[w.id] = (w.wbs_code ? w.wbs_code + ' ' : '') + w.name; });
  repoList('Dependency', null, { includeDeleted: true }).forEach(function (d) {
    names.dep[d.id] = (names.item[d.predecessor_id] || '?') + ' → ' + (names.item[d.successor_id] || '?');
  });
  repoList('BudgetLine', null, { includeDeleted: true }).forEach(function (b) { names.budget[b.id] = names.item[b.deliverable_id] || ''; });
  return names;
}

/** Nombre de changements à valider par projet (pour le mail récapitulatif et les compteurs). */
function pendingChangeCounts_(projects, events) {
  var since = {};
  projects.forEach(function (p) {
    if (isBlank(p.active_baseline_id)) return;
    var b = repoGet('Baseline', p.active_baseline_id);
    if (b && b.status === 'Active') since[p.id] = String(b.decided_at || '');
  });
  var counts = {};
  events.forEach(function (e) {
    if (!(e.project_id in since) || isTrue(e.acknowledged) || String(e.at) < since[e.project_id] || !isBaselinedEvent_(e)) return;
    counts[e.project_id] = (counts[e.project_id] || 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------- actions

function baselineView_(b, counts) {
  return {
    id: b.id, number: b.number === '' ? null : Number(b.number), label: b.label || '', status: b.status,
    justification: b.justification || '', requested_by: b.requested_by || '', decided_by: b.decided_by || '',
    decided_at: b.decided_at || '', created_at: b.created_at || '', version: b.version, items: counts[b.id] || 0
  };
}

function noteEvent_(table, id, projectId, text, ctx) {
  repoAppendHistory('ChangeEvent', [{
    id: newId(), at: nowIso(), table_name: table, entity_id: id, project_id: projectId, field: 'motif',
    old_value: '', new_value: truncate(text, 500), actor: ctx.actx.actor, source: ctx.actx.source,
    acknowledged: true, acknowledged_by: '', acknowledged_at: ''
  }]);
}

defineAction('baselines.list', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = { type: 'project', id: projectId };
  var rows = repoList('Baseline', function (b) { return b.project_id === projectId; });
  var ids = {};
  rows.forEach(function (b) { ids[b.id] = true; });
  var counts = {};
  repoList('BaselineItem', function (r) { return ids[r.baseline_id] && r.entity_type === 'PlanItem'; })
    .forEach(function (r) { counts[r.baseline_id] = (counts[r.baseline_id] || 0) + 1; });
  var rank = { 'Demandée': 0, 'Active': 1, 'Archivée': 2, 'Refusée': 3 };
  rows.sort(function (a, b) {
    return (rank[a.status] - rank[b.status]) || ((Number(b.number) || -1) - (Number(a.number) || -1)) ||
      String(b.created_at).localeCompare(String(a.created_at));
  });
  return {
    project: { id: project.id, code: project.code, name: project.name, active_baseline_id: project.active_baseline_id || '',
      calendar_id: project.calendar_id || '', drive_folder_id: project.drive_folder_id || '' },
    baselines: rows.map(function (b) { return baselineView_(b, counts); }),
    canManage: can(ctx, 'baseline.manage', scope),
    canRequest: can(ctx, 'baseline.request', scope),
    canAck: can(ctx, 'changes.ack', scope),
    canReadFeed: can(ctx, 'changes.ack', scope) || can(ctx, 'wbs.edit', scope),
    canWorkspace: can(ctx, 'workspace.manage', scope),
    seeBudget: can(ctx, 'budget.edit', scope)
  };
});

/**
 * Fige l'état courant du projet. Avec requestId, la demande devient la baseline (sa justification est reprise
 * si aucune n'est donnée). La baseline figée devient active ; la précédente est archivée.
 */
defineAction('baselines.create', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  mustGet('Project', projectId);
  requireCan(ctx, 'baseline.manage', { type: 'project', id: projectId });
  return withLock(function () {
    var request = null;
    if (!isBlank(p.requestId)) {
      request = mustGet('Baseline', p.requestId);
      if (request.project_id !== projectId || request.status !== 'Demandée') {
        throw new PpmError('VALIDATION', 'Cette demande n’est plus en attente.');
      }
    }
    var justification = String(p.justification || (request ? request.justification : '') || '').trim();
    if (!justification) throw new PpmError('VALIDATION', 'La justification est obligatoire.');
    var snap = projectSnapshot_(loadSnapshotData_(), projectId);
    if (!Object.keys(snap.PlanItem).length) {
      throw new PpmError('VALIDATION', 'Rien à figer : le projet n’a encore aucun livrable ni jalon.');
    }
    var all = repoList('Baseline', function (b) { return b.project_id === projectId; });
    var frozen = all.filter(function (b) { return b.status === 'Active' || b.status === 'Archivée'; });
    var number = frozen.length ? Math.max.apply(null, frozen.map(function (b) { return Number(b.number) || 0; })) + 1 : 0;
    var values = {
      number: number, label: String(p.label || '').trim() || 'B' + number, justification: justification,
      status: 'Active', decided_by: ctx.email, decided_at: nowIso()
    };
    var rec = request
      ? repoUpdate('Baseline', request.id, values, p.version, ctx.actx)
      : repoInsert('Baseline', Object.assign({ project_id: projectId, requested_by: ctx.email }, values), ctx.actx);
    repoAppendHistory('BaselineItem', snapshotToRows_(rec.id, snap));
    frozen.forEach(function (b) {
      if (b.status === 'Active') repoUpdate('Baseline', b.id, { status: 'Archivée' }, null, ctx.actx);
    });
    repoUpdate('Project', projectId, { active_baseline_id: rec.id }, null, ctx.actx);
    return baselineView_(rec, { [rec.id]: Object.keys(snap.PlanItem).length });
  });
});

/** Réactive une baseline archivée (motif obligatoire, conservé dans le journal). */
defineAction('baselines.activate', function (p, ctx) {
  var b = mustGet('Baseline', requireParam(p, 'id'));
  requireCan(ctx, 'baseline.manage', { type: 'project', id: b.project_id });
  var reason = String(p.reason || '').trim();
  if (!reason) throw new PpmError('VALIDATION', 'Le motif est obligatoire.');
  if (b.status !== 'Archivée') throw new PpmError('VALIDATION', 'Seule une baseline archivée peut être réactivée.');
  return withLock(function () {
    repoList('Baseline', function (x) { return x.project_id === b.project_id && x.status === 'Active'; }).forEach(function (x) {
      repoUpdate('Baseline', x.id, { status: 'Archivée' }, null, ctx.actx);
    });
    var rec = repoUpdate('Baseline', b.id, { status: 'Active', decided_by: ctx.email, decided_at: nowIso() }, p.version, ctx.actx);
    repoUpdate('Project', b.project_id, { active_baseline_id: b.id }, null, ctx.actx);
    noteEvent_('Baseline', b.id, b.project_id, 'Réactivation : ' + reason, ctx);
    return baselineView_(rec, {});
  });
});

/** Refuse une demande de baseline (motif obligatoire ; le demandeur le voit dans son récapitulatif). */
defineAction('baselines.refuse', function (p, ctx) {
  var b = mustGet('Baseline', requireParam(p, 'id'));
  requireCan(ctx, 'baseline.manage', { type: 'project', id: b.project_id });
  var reason = String(p.reason || '').trim();
  if (!reason) throw new PpmError('VALIDATION', 'Le motif du refus est obligatoire.');
  if (b.status !== 'Demandée') throw new PpmError('VALIDATION', 'Cette demande n’est plus en attente.');
  var rec = repoUpdate('Baseline', b.id, { status: 'Refusée', decided_by: ctx.email, decided_at: nowIso() }, p.version, ctx.actx);
  noteEvent_('Baseline', b.id, b.project_id, 'Refus : ' + reason, ctx);
  return baselineView_(rec, {});
});

/**
 * Écarts entre la baseline (active par défaut) et l'état courant, ou entre deux baselines (compareTo).
 * Les montants ne sont renvoyés qu'à ceux qui ont le droit de modifier le budget du projet.
 */
defineAction('baselines.diff', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var baseId = p.baselineId || project.active_baseline_id;
  var names = {};
  repoList('Resource', null, { includeDeleted: true }).forEach(function (r) { names[r.id] = r.name; });
  var wpNames = {};
  repoList('WorkPackage', null, { includeDeleted: true }).forEach(function (w) { wpNames[w.id] = (w.wbs_code ? w.wbs_code + ' ' : '') + w.name; });
  if (isBlank(baseId)) return { baseline: null, compareTo: null, items: [], totals: null };
  var base = mustGet('Baseline', baseId);
  if (base.project_id !== projectId || (base.status !== 'Active' && base.status !== 'Archivée')) {
    throw new PpmError('VALIDATION', 'Cette baseline n’est pas figée pour ce projet.');
  }
  var cur, other = null;
  if (!isBlank(p.compareTo)) {
    other = mustGet('Baseline', p.compareTo);
    if (other.project_id !== projectId) throw new PpmError('VALIDATION', 'Les deux baselines doivent appartenir au même projet.');
    cur = loadBaselineSnapshot_(other.id);
  } else {
    cur = projectSnapshot_(loadSnapshotData_(), projectId);
  }
  var d = diffSnapshots(loadBaselineSnapshot_(base.id), cur, loadHolidayMap(project.holiday_country || 'FR'));
  var seeBudget = can(ctx, 'budget.edit', { type: 'project', id: projectId });
  d.items.forEach(function (i) {
    i.base_owner_name = names[i.base_owner] || ''; i.owner_name = names[i.owner] || '';
    i.wp_name = wpNames[i.wp_id] || '';
    if (!seeBudget) { delete i.base_budget; delete i.budget; delete i.budget_delta; }
  });
  if (!seeBudget) { delete d.totals.budget_base; delete d.totals.budget; delete d.totals.budget_delta; }
  d.baseline = baselineView_(base, {});
  d.compareTo = other ? baselineView_(other, {}) : null;
  d.seeBudget = seeBudget;
  return d;
});

/** Fil du chef de projet : changements de données figées depuis la baseline active. */
defineAction('changes.feed', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  var scope = { type: 'project', id: projectId };
  var canAck = can(ctx, 'changes.ack', scope);
  if (!canAck && !can(ctx, 'wbs.edit', scope)) {
    throw new PpmError('FORBIDDEN', 'Le fil des changements est réservé à l’équipe de pilotage du projet.');
  }
  var active = !isBlank(project.active_baseline_id) ? repoGet('Baseline', project.active_baseline_id) : null;
  if (!active || active.status !== 'Active') return { baseline: null, canAck: canAck, items: [], pending: 0 };
  var events = repoList('ChangeEvent', function (e) { return e.project_id === projectId; });
  var names = feedNames_();
  var all = buildChangeFeed(events, projectId, String(active.decided_at), names, { all: true });
  var pending = all.filter(function (e) { return !e.acknowledged; });
  var limit = Math.max(1, Math.min(500, Number(p.limit) || 200));
  return {
    baseline: baselineView_(active, {}), canAck: canAck, pending: pending.length,
    items: (p.all ? all : pending).slice(0, limit)
  };
});

/** Acquittement : ids (liste) ou projectId + all = true (tout le fil en attente). */
defineAction('changes.ack', function (p, ctx) {
  var t = getTable('ChangeEvent');
  return withLock(function () {
    var rows = t.readAll();
    var wanted = {};
    if (p.all) {
      var projectId = requireParam(p, 'projectId');
      var project = mustGet('Project', projectId);
      var active = !isBlank(project.active_baseline_id) ? repoGet('Baseline', project.active_baseline_id) : null;
      var since = active ? String(active.decided_at) : '9999';
      rows.forEach(function (e) {
        if (e.project_id === projectId && !isTrue(e.acknowledged) && String(e.at) >= since && isBaselinedEvent_(e)) wanted[e.id] = true;
      });
    } else {
      (p.ids || []).slice(0, 1000).forEach(function (id) { wanted[String(id)] = true; });
    }
    var checked = {}, now = nowIso(), updates = [];
    rows.forEach(function (e, i) {
      if (!wanted[e.id] || isTrue(e.acknowledged)) return;
      if (!(e.project_id in checked)) checked[e.project_id] = !!e.project_id && can(ctx, 'changes.ack', { type: 'project', id: e.project_id });
      if (!checked[e.project_id]) throw new PpmError('FORBIDDEN', 'Seuls le chef de projet et le DPL valident les changements.');
      updates.push({ row: i + 2, obj: Object.assign({}, e, { acknowledged: true, acknowledged_by: ctx.email, acknowledged_at: now }) });
    });
    if (updates.length) t.updateRows(updates);
    return { acknowledged: updates.length };
  });
});

// ======================================================================
// 35_Workspace.gs
// ======================================================================

/**
 * PPM Core — lot 2 : intégration Google Workspace (section 8).
 *
 *  - Agenda Google par projet : un événement « journée entière » par jalon et par échéance de livrable,
 *    tenu à jour quand un élément est créé, déplacé ou supprimé. Partagé en lecture aux membres du projet.
 *    Sur option, le responsable d'un livrable est invité à son échéance (réglage personnel).
 *  - Dossier Drive par projet, un sous-dossier par WP (les sous-WP sont imbriqués), partagé aux membres.
 *    Un WP supprimé ne supprime jamais son dossier : les fichiers restent.
 *  - Annuaire : complète nom, fonction et organisation d'une personne à partir de son adresse ;
 *    import d'une liste de personnes depuis une feuille Google Sheets.
 *
 * Tous les appels passent par l'adaptateur ws_() : en production les services Google (compte propriétaire),
 * dans les tests un faux (variable WORKSPACE). Les identifiants externes et l'empreinte du dernier envoi
 * sont gardés dans la table SyncLink : une mise à jour modifie l'existant au lieu de dupliquer,
 * et rien n'est renvoyé si rien n'a changé.
 */

var WORKSPACE = null;

function ws_() {
  return WORKSPACE || realWorkspace_();
}

/** Date AAAA-MM-JJ → Date à minuit dans le fuseau du script (ce qu'attend un événement « journée entière »). */
function localDate_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function realWorkspace_() {
  var hasCalendar = typeof CalendarApp !== 'undefined';
  var hasDrive = typeof DriveApp !== 'undefined';
  return {
    available: hasCalendar && hasDrive,
    calendar: {
      create: function (name) {
        return CalendarApp.createCalendar(name, { timeZone: Session.getScriptTimeZone(), summary: 'Jalons et échéances, tenus à jour par PPM.' }).getId();
      },
      url: function (id) { return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(id); },
      upsert: function (calId, eventId, ev) {
        var cal = CalendarApp.getCalendarById(calId);
        if (!cal) throw new PpmError('CONFIG', 'Agenda introuvable : ' + calId);
        var e = eventId ? cal.getEventById(eventId) : null;
        if (e) {
          e.setTitle(ev.title);
          e.setAllDayDate(localDate_(ev.date));
          e.setDescription(ev.description);
          var have = {};
          e.getGuestList().forEach(function (g) { have[g.getEmail().toLowerCase()] = true; });
          ev.guests.forEach(function (g) { if (!have[g]) e.addGuest(g); });
          Object.keys(have).forEach(function (g) { if (ev.guests.indexOf(g) < 0) e.removeGuest(g); });
          return e.getId();
        }
        return cal.createAllDayEvent(ev.title, localDate_(ev.date),
          { description: ev.description, guests: ev.guests.join(','), sendInvites: false }).getId();
      },
      remove: function (calId, eventId) {
        var cal = CalendarApp.getCalendarById(calId);
        var e = cal ? cal.getEventById(eventId) : null;
        if (e) e.deleteEvent();
      },
      /** Partage en lecture (service avancé Calendar) ; -1 si le service n'est pas activé. */
      share: function (calId, emails) {
        if (typeof Calendar === 'undefined' || !Calendar.Acl) return -1;
        var have = {};
        (Calendar.Acl.list(calId).items || []).forEach(function (r) {
          if (r.scope && r.scope.type === 'user') have[String(r.scope.value).toLowerCase()] = true;
        });
        var added = 0;
        emails.forEach(function (m) {
          if (have[m]) return;
          Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: m } }, calId, { sendNotifications: false });
          added++;
        });
        return added;
      }
    },
    drive: {
      root: function () {
        var id = getProp(PROP.PROJECTS_FOLDER, '');
        if (id) return id;
        id = DriveApp.createFolder('PPM Projets').getId();
        setProp(PROP.PROJECTS_FOLDER, id);
        return id;
      },
      url: function (id) { return 'https://drive.google.com/drive/folders/' + id; },
      /** Crée le dossier, ou renomme et déplace le dossier existant ; renvoie son identifiant. */
      ensureFolder: function (parentId, name, folderId) {
        var parent = DriveApp.getFolderById(parentId);
        if (folderId) {
          try {
            var f = DriveApp.getFolderById(folderId);
            if (!f.isTrashed()) {
              if (f.getName() !== name) f.setName(name);
              var inParent = false, it = f.getParents();
              while (it.hasNext()) if (it.next().getId() === parentId) inParent = true;
              if (!inParent) f.moveTo(parent);
              return f.getId();
            }
          } catch (err) { /* dossier supprimé ou inaccessible : recréé */ }
        }
        return parent.createFolder(name).getId();
      },
      share: function (folderId, emails) {
        var f = DriveApp.getFolderById(folderId);
        var have = {};
        f.getEditors().forEach(function (u) { have[u.getEmail().toLowerCase()] = true; });
        try { have[f.getOwner().getEmail().toLowerCase()] = true; } catch (err) { /* Drive partagé : pas de propriétaire */ }
        var missing = emails.filter(function (m) { return !have[m]; });
        if (missing.length) f.addEditors(missing);
        return missing.length;
      }
    },
    directory: {
      /** Annuaire du domaine (service avancé Admin SDK, facultatif) ; null si indisponible. */
      lookup: function (email) {
        if (typeof AdminDirectory === 'undefined') return null;
        try {
          var u = AdminDirectory.Users.get(email, { viewType: 'domain_public' });
          var org = (u.organizations || [])[0] || {};
          return { name: u.name ? u.name.fullName || '' : '', job_function: org.title || '', organization: org.department || '' };
        } catch (err) {
          return null;
        }
      }
    }
  };
}

// ---------------------------------------------------------------- liens (table SyncLink)

function loadLinks_() {
  var t = getTable('SyncLink');
  var byId = {};
  t.readAll().forEach(function (r, i) { byId[r.id] = { row: i + 2, rec: r }; });
  return { table: t, byId: byId, dirty: {}, fresh: [] };
}

function setLink_(links, id, values) {
  var cur = links.byId[id];
  var rec = Object.assign({ id: id }, cur ? cur.rec : {}, values, { synced_at: nowIso() });
  if (cur) { cur.rec = rec; links.dirty[id] = cur; } else { links.byId[id] = { row: -1, rec: rec }; links.fresh.push(rec); }
}

function saveLinks_(links) {
  var updates = Object.keys(links.dirty).map(function (id) { return { row: links.dirty[id].row, obj: links.dirty[id].rec }; });
  if (updates.length) links.table.updateRows(updates);
  if (links.fresh.length) links.table.appendRows(links.fresh);
  links.dirty = {};
  links.fresh = [];
}

// ---------------------------------------------------------------- membres d'un projet

/**
 * Adresses du domaine qui travaillent sur le projet : chef de projet, rôles sur le projet, ses WP ou son programme,
 * responsables de WP et de livrables. Personnes supprimées ou sans adresse du domaine exclues.
 */
function projectMembers_(data, projectId, today) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) return [];
  var wpIds = {};
  data.workpackages.forEach(function (w) { if (w.project_id === projectId) wpIds[w.id] = true; });
  var people = {};
  if (!isBlank(project.manager_resource_id)) people[project.manager_resource_id] = true;
  data.workpackages.forEach(function (w) { if (wpIds[w.id] && !isBlank(w.owner_resource_id)) people[w.owner_resource_id] = true; });
  data.planitems.forEach(function (i) { if (i.project_id === projectId && !isBlank(i.owner_resource_id)) people[i.owner_resource_id] = true; });
  (data.assignments || []).forEach(function (a) {
    if (isTrue(a.deleted)) return;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var hit = (a.scope_type === 'project' && a.scope_id === projectId) || (a.scope_type === 'workpackage' && wpIds[a.scope_id]) ||
      (a.scope_type === 'program' && !isBlank(project.program_id) && a.scope_id === project.program_id);
    if (hit) people[a.resource_id] = true;
  });
  var domain = allowedDomain();
  var res = indexBy_(data.resources);
  var out = {};
  Object.keys(people).forEach(function (id) {
    var r = res[id];
    if (!r || isTrue(r.deleted) || isBlank(r.email)) return;
    var m = String(r.email).toLowerCase();
    if (!domain || m.split('@')[1] === domain) out[m] = true;
  });
  return Object.keys(out).sort();
}

// ---------------------------------------------------------------- agenda

/** Événements voulus pour un projet : un par jalon et par échéance de livrable datés. */
function desiredEvents_(data, project, baseUrl) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages);
  var invites = {};
  (data.settings || []).forEach(function (s) { if (isTrue(s.calendar_invites)) invites[String(s.user_email).toLowerCase()] = true; });
  var out = {};
  data.planitems.forEach(function (i) {
    if (i.project_id !== project.id || isTrue(i.deleted) || isBlank(i.planned_finish)) return;
    var done = i.status === 'Terminé' || Number(i.progress_pct) >= 100;
    var owner = res[i.owner_resource_id];
    var wp = wps[i.wp_id];
    var title = (done ? '✓ ' : '') + (i.item_type === 'Jalon' ? '◆ ' : 'Échéance · ') + project.code + ' · ' + i.name;
    var lines = ['Projet ' + project.code + ' — ' + project.name];
    if (wp) lines.push('Workpackage ' + (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name);
    if (owner) lines.push('Responsable : ' + owner.name);
    if (i.item_type === 'Livrable' && !isBlank(i.planned_start)) lines.push('Début prévu : ' + i.planned_start);
    if (baseUrl) lines.push('Planning : ' + baseUrl + '?view=gantt&project=' + project.id);
    lines.push('Événement tenu à jour par PPM : les modifications faites ici seront écrasées.');
    var guests = [];
    if (owner && !isBlank(owner.email) && invites[String(owner.email).toLowerCase()]) guests.push(String(owner.email).toLowerCase());
    out[i.id] = { title: title, date: i.planned_finish, description: lines.join('\n'), guests: guests };
  });
  return out;
}

function syncProjectCalendar_(data, project, links, report, baseUrl) {
  if (isBlank(project.calendar_id)) return;
  var wanted = desiredEvents_(data, project, baseUrl);
  Object.keys(wanted).forEach(function (itemId) {
    try {
      syncOneEvent_(project, itemId, wanted[itemId], links, report);
    } catch (err) {
      report.errors.push('Agenda, « ' + wanted[itemId].title + ' » : ' + (err && err.message ? err.message : err));
    }
  });
  Object.keys(links.byId).forEach(function (id) {
    var l = links.byId[id].rec;
    if (l.kind !== 'calendar' || l.project_id !== project.id || isBlank(l.external_id) || wanted[l.entity_id]) return;
    try {
      ws_().calendar.remove(l.container_id, l.external_id);
      setLink_(links, id, { external_id: '', hash: 'REMOVED' });
      report.removed++;
    } catch (err) {
      report.errors.push('Agenda, suppression : ' + (err && err.message ? err.message : err));
    }
  });
  syncProjectReminders_(data, project, links, report, baseUrl);
}

/** Crée ou met à jour un événement ; ne fait rien si son contenu n'a pas changé depuis le dernier envoi. */
function syncOneEvent_(project, itemId, ev, links, report, kind) {
  kind = kind || 'calendar';
  var id = (kind === 'reminder' ? 'rem:' : 'cal:') + itemId;
  var link = links.byId[id] ? links.byId[id].rec : null;
  var hash = hashString(project.calendar_id + '|' + JSON.stringify(ev));
  var sameCal = link && link.container_id === project.calendar_id && !isBlank(link.external_id);
  if (sameCal && link.hash === hash) return;
  var eventId = ws_().calendar.upsert(project.calendar_id, sameCal ? link.external_id : '', ev);
  setLink_(links, id, { kind: kind, entity_id: itemId, project_id: project.id, container_id: project.calendar_id, external_id: eventId, hash: hash });
  report[sameCal ? 'updated' : 'created']++;
}

// ---------------------------------------------------------------- rappels avant livraison

var REMINDER_DEFAULT_DAYS = 10;

/** Réglage de l'administrateur : rappels actifs (par défaut oui) et délai par défaut en jours ouvrés (par défaut 10). */
function reminderDefaults_() {
  var on = String(getProp(PROP.REMINDER_ON, 'oui')).toLowerCase() !== 'non';
  var d = Number(getProp(PROP.REMINDER_DAYS, String(REMINDER_DEFAULT_DAYS)));
  return { on: on, days: d >= 1 && d <= 60 && Math.floor(d) === d ? d : REMINDER_DEFAULT_DAYS };
}

/** Rappel voulu pour une personne : null si désactivé (par l'administrateur ou par elle), sinon son délai (le sien, à défaut celui par défaut). */
function reminderFor_(setting) {
  var def = reminderDefaults_();
  if (!def.on || (setting && isTrue(setting.reminder_off))) return null;
  var d = setting && !isBlank(setting.reminder_days) ? Number(setting.reminder_days) : def.days;
  return { days: d >= 1 && d <= 60 ? d : def.days };
}

function reminderSettingsView_(row) {
  return {
    reminder_off: !!(row && isTrue(row.reminder_off)),
    reminder_days: row && !isBlank(row.reminder_days) ? Number(row.reminder_days) : null,
    reminder_default: reminderDefaults_()
  };
}

/**
 * Un rappel par livrable non terminé, daté N jours ouvrés avant sa livraison, dans l'agenda du projet, avec son responsable invité :
 * il apparaît dans le Google Agenda du responsable. (Une vraie tâche Google ne peut pas être créée dans la liste d'un autre utilisateur.)
 * Un rappel déjà créé dont la date est passée est conservé ; on n'en crée pas de nouveau pour une date passée.
 */
function desiredReminders_(data, project, today, links, baseUrl) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages), settings = {};
  (data.settings || []).forEach(function (s) { settings[String(s.user_email).toLowerCase()] = s; });
  var hol = loadHolidayMap(project.holiday_country || 'FR');
  var domain = allowedDomain();
  var out = {};
  data.planitems.forEach(function (i) {
    if (i.project_id !== project.id || isTrue(i.deleted) || i.item_type !== 'Livrable' || isBlank(i.planned_finish)) return;
    if (i.status === 'Terminé' || Number(i.progress_pct) >= 100) return;
    var owner = res[i.owner_resource_id];
    if (!owner || isTrue(owner.deleted) || isBlank(owner.email)) return;
    var email = String(owner.email).toLowerCase();
    if (domain && email.split('@')[1] !== domain) return;
    var rem = reminderFor_(settings[email]);
    if (!rem) return;
    var date = addWorkingDays(i.planned_finish, -rem.days, hol);
    var link = links && links.byId['rem:' + i.id] ? links.byId['rem:' + i.id].rec : null;
    if (date < today && !(link && !isBlank(link.external_id))) return;
    var wp = wps[i.wp_id];
    var lines = ['Livrable à préparer : la livraison est prévue le ' + frDate_(i.planned_finish) + ' (dans ' + rem.days + ' jours ouvrés).',
      'Projet ' + project.code + ' — ' + project.name];
    if (wp) lines.push('Workpackage ' + (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name);
    if (baseUrl) lines.push('Planning : ' + baseUrl + '?view=gantt&project=' + project.id);
    lines.push('Rappel tenu à jour par PPM : les modifications faites ici seront écrasées.');
    out[i.id] = { title: 'Rappel livraison · ' + project.code + ' · ' + i.name, date: date, description: lines.join('\n'), guests: [email] };
  });
  return out;
}

function removeReminder_(links, itemId, report) {
  var l = links.byId['rem:' + itemId];
  if (!l || isBlank(l.rec.external_id)) return;
  ws_().calendar.remove(l.rec.container_id, l.rec.external_id);
  setLink_(links, 'rem:' + itemId, { external_id: '', hash: 'REMOVED' });
  report.removed = (report.removed || 0) + 1;
}

function syncProjectReminders_(data, project, links, report, baseUrl) {
  var wanted = desiredReminders_(data, project, todayStr(), links, baseUrl);
  Object.keys(wanted).forEach(function (itemId) {
    try {
      syncOneEvent_(project, itemId, wanted[itemId], links, report, 'reminder');
    } catch (err) {
      report.errors.push('Rappel, « ' + wanted[itemId].title + ' » : ' + (err && err.message ? err.message : err));
    }
  });
  Object.keys(links.byId).forEach(function (id) {
    var l = links.byId[id].rec;
    if (l.kind !== 'reminder' || l.project_id !== project.id || isBlank(l.external_id) || wanted[l.entity_id]) return;
    try {
      removeReminder_(links, l.entity_id, report);
    } catch (err) {
      report.errors.push('Rappel, suppression : ' + (err && err.message ? err.message : err));
    }
  });
}

/**
 * Mise à jour immédiate de l'événement d'un élément (création ou déplacement), sans attendre la nuit.
 * Une panne de l'agenda ne bloque jamais la saisie : la synchronisation nocturne rattrape (et gère les suppressions).
 */
function hookCalendarItem(before, rec) {
  var fields = ['name', 'planned_finish', 'item_type', 'owner_resource_id', 'status', 'wp_id'];
  var crossedDone = !!before && ((Number(before.progress_pct) >= 100) !== (Number(rec.progress_pct) >= 100));
  if (before && !crossedDone && !fields.some(function (f) { return String(before[f]) !== String(rec[f]); })) return;
  try {
    if (!ws_().available) return;
    var project = repoGet('Project', rec.project_id);
    if (!project || isBlank(project.calendar_id)) return;
    var data = { planitems: [rec], resources: repoList('Resource'), workpackages: repoList('WorkPackage'), settings: repoList('UserSetting') };
    var baseUrl = getProp(PROP.WEBAPP_URL, '');
    var links = loadLinks_();
    var wanted = desiredEvents_(data, project, baseUrl);
    if (wanted[rec.id]) syncOneEvent_(project, rec.id, wanted[rec.id], links, { created: 0, updated: 0 });
    if (rec.item_type === 'Livrable' || (before && before.item_type === 'Livrable')) {
      var rem = desiredReminders_(data, project, todayStr(), links, baseUrl);
      if (rem[rec.id]) syncOneEvent_(project, rec.id, rem[rec.id], links, { created: 0, updated: 0 }, 'reminder');
      else removeReminder_(links, rec.id, { removed: 0 });
    }
    saveLinks_(links);
  } catch (err) {
    console.error('Agenda : ' + (err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------- Drive

function folderName_(s) {
  return String(s).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sans nom';
}

function syncProjectDrive_(data, project, links, report) {
  if (isBlank(project.drive_folder_id)) return;
  var w = ws_();
  var wps = data.workpackages.filter(function (x) { return x.project_id === project.id && !isTrue(x.deleted); });
  var byId = indexBy_(wps);
  var depth = function (x) { var d = 0, c = x; while (c && !isBlank(c.parent_wp_id) && byId[c.parent_wp_id] && d < 20) { d++; c = byId[c.parent_wp_id]; } return d; };
  wps.sort(function (a, b) { return depth(a) - depth(b) || byWbs_(a, b); });
  var folderOf = {};
  wps.forEach(function (x) {
    var parentFolder = !isBlank(x.parent_wp_id) && folderOf[x.parent_wp_id] ? folderOf[x.parent_wp_id] : project.drive_folder_id;
    var name = folderName_((x.wbs_code ? x.wbs_code + ' ' : '') + x.name);
    var id = 'drive:' + x.id;
    var link = links.byId[id] ? links.byId[id].rec : null;
    var hash = hashString(parentFolder + '|' + name);
    if (link && !isBlank(link.external_id) && link.hash === hash) { folderOf[x.id] = link.external_id; return; }
    try {
      var fid = w.drive.ensureFolder(parentFolder, name, link ? link.external_id : '');
      folderOf[x.id] = fid;
      setLink_(links, id, { kind: 'drive', entity_id: x.id, project_id: project.id, container_id: parentFolder, external_id: fid, hash: hash });
      report.folders++;
    } catch (err) {
      report.errors.push('Drive, « ' + name + ' » : ' + (err && err.message ? err.message : err));
    }
  });
}

/** Agenda, dossiers et partages d'un projet. */
function syncProjectWorkspace_(project, data, links) {
  var report = { created: 0, updated: 0, removed: 0, folders: 0, shared: 0, errors: [] };
  var w = ws_();
  if (!w.available) { report.errors.push('Services Google indisponibles.'); return report; }
  data = data || loadWorkspaceData_();
  var own = !links;
  links = links || loadLinks_();
  var baseUrl = getProp(PROP.WEBAPP_URL, '');
  syncProjectCalendar_(data, project, links, report, baseUrl);
  syncProjectDrive_(data, project, links, report);
  var members = projectMembers_(data, project.id, todayStr());
  if (!isBlank(project.calendar_id)) {
    try {
      var n = w.calendar.share(project.calendar_id, members);
      if (n < 0) report.errors.push('Partage de l’agenda : activer le service avancé « Google Calendar API » (voir le README).');
      else report.shared += n;
    } catch (err) { report.errors.push('Partage de l’agenda : ' + (err && err.message ? err.message : err)); }
  }
  if (!isBlank(project.drive_folder_id)) {
    try { report.shared += w.drive.share(project.drive_folder_id, members); } catch (err) {
      report.errors.push('Partage du dossier : ' + (err && err.message ? err.message : err));
    }
  }
  if (own) saveLinks_(links);
  report.members = members.length;
  return report;
}

function loadWorkspaceData_() {
  return {
    projects: repoList('Project'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    resources: repoList('Resource'), assignments: repoList('RoleAssignment'), settings: repoList('UserSetting')
  };
}

/** Traitement nocturne : tous les projets reliés à Workspace, par tranches. */
function syncWorkspaceAll(state, deadlineMs) {
  if (!ws_().available) return true;
  var data = loadWorkspaceData_();
  var projects = data.projects.filter(function (p) {
    return p.status !== 'Clos' && (!isBlank(p.calendar_id) || !isBlank(p.drive_folder_id));
  }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  state.index = state.index || 0;
  var links = loadLinks_();
  var errors = [];
  while (state.index < projects.length) {
    if (nowMs() > deadlineMs) { saveLinks_(links); return false; }
    var r = syncProjectWorkspace_(projects[state.index], data, links);
    r.errors.forEach(function (e) { errors.push(projects[state.index].code + ' : ' + e); });
    state.index++;
  }
  saveLinks_(links);
  if (errors.length) {
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Synchronisation Agenda et Drive : ' + errors.length + ' erreur(s)', errors.slice(0, 50).join('\n'));
    });
  }
  return true;
}

function workspaceStatus_(project, report) {
  var w = ws_();
  return {
    project_id: project.id,
    calendar_id: project.calendar_id || '', calendar_url: project.calendar_id && w.calendar.url ? w.calendar.url(project.calendar_id) : '',
    drive_folder_id: project.drive_folder_id || '', drive_url: project.drive_folder_id && w.drive.url ? w.drive.url(project.drive_folder_id) : '',
    report: report || null
  };
}

defineAction('workspace.status', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var st = workspaceStatus_(project, null);
  st.canManage = can(ctx, 'workspace.manage', { type: 'project', id: project.id });
  st.available = ws_().available;
  return st;
});

/** Crée l'agenda et le dossier du projet s'ils n'existent pas, puis synchronise (réservé au pilotage du projet). */
defineAction('workspace.enable', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  requireCan(ctx, 'workspace.manage', { type: 'project', id: projectId });
  var w = ws_();
  if (!w.available) throw new PpmError('CONFIG', 'Les services Google Agenda et Drive ne sont pas disponibles.');
  var patch = {};
  if (p.calendar !== false && isBlank(project.calendar_id)) patch.calendar_id = w.calendar.create('PPM · ' + project.code + ' ' + project.name);
  if (p.drive !== false && isBlank(project.drive_folder_id)) {
    patch.drive_folder_id = w.drive.ensureFolder(w.drive.root(), folderName_(project.code + ' — ' + project.name), '');
  }
  if (Object.keys(patch).length) project = repoUpdate('Project', projectId, patch, null, ctx.actx);
  return workspaceStatus_(project, syncProjectWorkspace_(project));
});

defineAction('workspace.sync', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'workspace.manage', { type: 'project', id: project.id });
  return workspaceStatus_(project, syncProjectWorkspace_(project));
});

// ---------------------------------------------------------------- annuaire et import de personnes

/** Complète une fiche à partir de l'annuaire, sans jamais écraser une valeur saisie. */
function fillFromDirectory_(values) {
  if (isBlank(values.email)) return values;
  var found = ws_().directory.lookup(String(values.email).toLowerCase());
  if (!found) return values;
  var out = Object.assign({}, values);
  ['name', 'job_function', 'organization'].forEach(function (k) {
    if (isBlank(out[k]) && !isBlank(found[k])) out[k] = String(found[k]).slice(0, TEXT_MAX_LENGTH[k] || 200);
  });
  if (isBlank(out.resource_type)) out.resource_type = 'Interne';
  return out;
}

/** Nuit : complète les fiches incomplètes à partir de l'annuaire (au plus 200 par nuit). */
function refreshPeopleFromDirectory() {
  if (!WORKSPACE && typeof AdminDirectory === 'undefined') return 0;
  var n = 0;
  repoList('Resource', function (r) { return !isBlank(r.email) && (isBlank(r.job_function) || isBlank(r.organization)); })
    .slice(0, 200).forEach(function (r) {
      var filled = fillFromDirectory_(r);
      var patch = {};
      ['job_function', 'organization'].forEach(function (k) { if (filled[k] !== r[k]) patch[k] = filled[k]; });
      if (Object.keys(patch).length) { repoUpdate('Resource', r.id, patch, null, { actor: 'ppm-core', source: 'annuaire' }); n++; }
    });
  return n;
}

var PEOPLE_HEADERS = {
  name: ['nom', 'name', 'nom complet', 'full name', 'prenom nom', 'personne'],
  email: ['e-mail', 'email', 'mail', 'adresse', 'adresse e-mail', 'courriel'],
  job_function: ['fonction', 'poste', 'job', 'title', 'job title', 'metier'],
  organization: ['organisation', 'organization', 'service', 'departement', 'department', 'societe', 'entreprise'],
  country: ['pays', 'country'],
  resource_type: ['type', 'interne/externe', 'interne ou externe'],
  supplier: ['fournisseur', 'supplier'],
  team: ['equipe', 'team']
};

function normHeader_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fusionne une liste de personnes (tableau de lignes, la première = en-têtes) avec les fiches existantes.
 * Clé : l'adresse e-mail, sinon le nom exact. Les fiches existantes ne sont complétées que sur les champs vides.
 * Renvoie { create: [valeurs], update: [{ id, patch }], skipped: [motifs] }.
 */
function mergePeople_(rows, existing, teams) {
  var out = { create: [], update: [], skipped: [] };
  if (!rows || rows.length < 2) return out;
  var col = {};
  rows[0].forEach(function (h, i) {
    var n = normHeader_(h);
    Object.keys(PEOPLE_HEADERS).forEach(function (k) { if (!(k in col) && PEOPLE_HEADERS[k].indexOf(n) >= 0) col[k] = i; });
  });
  if (!('name' in col) && !('email' in col)) { out.skipped.push('Ni colonne « Nom » ni colonne « E-mail » en première ligne.'); return out; }
  var byEmail = {}, byName = {}, teamByName = {};
  existing.forEach(function (r) {
    if (!isBlank(r.email)) byEmail[String(r.email).toLowerCase()] = r;
    byName[normHeader_(r.name)] = r;
  });
  (teams || []).forEach(function (t) { teamByName[normHeader_(t.name)] = t.id; });
  var seen = {};
  rows.slice(1).forEach(function (row, i) {
    var v = {};
    Object.keys(col).forEach(function (k) { var x = row[col[k]]; if (!isBlank(x)) v[k] = String(x).replace(/\s+/g, ' ').trim(); });
    if (isBlank(v.name) && isBlank(v.email)) return;
    if (v.email) v.email = v.email.toLowerCase();
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) { out.skipped.push('Ligne ' + (i + 2) + ' : adresse invalide « ' + v.email + ' ».'); return; }
    if (v.country) { v.country = v.country.toUpperCase(); if (v.country === 'GB') v.country = 'UK'; if (COUNTRIES.indexOf(v.country) < 0) delete v.country; }
    if (v.resource_type) v.resource_type = /ext/i.test(v.resource_type) ? 'Externe' : 'Interne';
    if (v.team) { var tid = teamByName[normHeader_(v.team)]; if (tid) v.team_id = tid; else out.skipped.push('Ligne ' + (i + 2) + ' : équipe inconnue « ' + v.team + ' » (ignorée).'); delete v.team; }
    ['job_function', 'organization'].forEach(function (k) { if (v[k]) v[k] = v[k].slice(0, TEXT_MAX_LENGTH[k]); });
    var key = v.email || 'nom:' + normHeader_(v.name);
    if (seen[key]) { out.skipped.push('Ligne ' + (i + 2) + ' : doublon.'); return; }
    seen[key] = true;
    var cur = (v.email && byEmail[v.email]) || (!v.email && byName[normHeader_(v.name)]) || null;
    if (cur) {
      var patch = {};
      Object.keys(v).forEach(function (k) { if (k !== 'email' && isBlank(cur[k])) patch[k] = v[k]; });
      if (Object.keys(patch).length) out.update.push({ id: cur.id, patch: patch });
      return;
    }
    if (isBlank(v.name)) { out.skipped.push('Ligne ' + (i + 2) + ' : nom manquant pour ' + v.email + '.'); return; }
    if (!v.resource_type) v.resource_type = 'Interne';
    out.create.push(v);
  });
  return out;
}

/**
 * À exécuter depuis l'éditeur (administrateur) : importe les personnes d'une feuille Google Sheets.
 * Colonnes reconnues en première ligne : Nom, E-mail, Fonction, Organisation, Pays, Type, Fournisseur, Équipe.
 */
function importPeopleFromSheet(url) {
  if (!url) throw new PpmError('VALIDATION', 'Passer l’adresse de la feuille : importPeopleFromSheet("https://docs.google.com/…")');
  var rows = SpreadsheetApp.openByUrl(url).getSheets()[0].getDataRange().getDisplayValues();
  var m = mergePeople_(rows, repoList('Resource'), repoList('HierarchicalTeam'));
  var actx = { actor: String(Session.getActiveUser().getEmail() || 'admin').toLowerCase(), source: 'import' };
  m.create.forEach(function (v) { repoInsert('Resource', fillFromDirectory_(v), actx); });
  m.update.forEach(function (u) { repoUpdate('Resource', u.id, u.patch, null, actx); });
  var msg = m.create.length + ' personne(s) créée(s), ' + m.update.length + ' complétée(s).' +
    (m.skipped.length ? '\nIgnoré :\n- ' + m.skipped.join('\n- ') : '');
  console.log(msg);
  return msg;
}

// ======================================================================
// 36_Digest.gs
// ======================================================================

/**
 * PPM Core — lot 2 : mail récapitulatif (section 8, Gmail).
 *
 * Un seul mail par personne : chaque matin de semaine (réglage « Quotidien », par défaut),
 * le lundi seulement (« Hebdomadaire »), ou jamais (« Aucun »). Il est calculé à partir de l'état
 * des données, sans file d'attente : ce qui est réglé depuis la veille n'y figure plus.
 *
 *   - Mes livrables et jalons : en retard, à échéance dans les 7 jours, avancement non déclaré depuis 30 jours ;
 *   - Pilotage (chef de projet, DPL) : changements à valider, demandes de baseline, alertes du moteur de règles ;
 *   - Mes demandes de baseline tranchées depuis le dernier récapitulatif.
 *
 * Seules les adresses du domaine reçoivent un récapitulatif. buildDigests est pure (testée hors ligne).
 */

var DIGEST_MAX_LINES = 12;

function escHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function frDate_(s) {
  if (isBlank(s)) return '';
  var p = String(s).slice(0, 10).split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

/**
 * data : { projects, planitems, resources, assignments, settings, insights, baselines, workpackages,
 *          pendingChanges: { projectId: n } }
 * opts : { baseUrl, weekly: true le lundi (les réglages « Hebdomadaire » reçoivent alors leur mail), onlyEmail }
 * Renvoie [{ to, subject, text, html, counts }] ; une personne sans rien à signaler ne reçoit rien.
 */
function buildDigests(data, today, opts) {
  opts = opts || {};
  var domain = allowedDomain();
  var projects = indexBy_(data.projects);
  var live = function (r) { return !isTrue(r.deleted); };
  var activeProject = function (id) { var p = projects[id]; return p && live(p) && p.status !== 'Clos'; };
  var settings = {};
  (data.settings || []).forEach(function (s) { settings[String(s.user_email).toLowerCase()] = s; });
  var lookup = memoryLookup(data);
  var soon = addCalendarDays(today, THRESHOLDS.dueSoonDays);
  var staleLimit = addCalendarDays(today, -THRESHOLDS.staleProgressDays);
  var link = function (view, projectId, extra) {
    return opts.baseUrl ? opts.baseUrl + '?view=' + view + '&project=' + projectId + (extra || '') : '';
  };
  var out = [];

  data.resources.filter(live).forEach(function (r) {
    if (isBlank(r.email)) return;
    var email = String(r.email).toLowerCase();
    if (domain && email.split('@')[1] !== domain) return;
    if (opts.onlyEmail && opts.onlyEmail !== email) return;
    var freq = (settings[email] && settings[email].notify_frequency) || 'Quotidien';
    if (!opts.onlyEmail) {
      if (freq === 'Aucun') return;
      if (freq === 'Hebdomadaire' && !opts.weekly) return;
    }
    var windowStart = freq === 'Hebdomadaire' ? addCalendarDays(today, -7) : addCalendarDays(today, -1);
    var sections = [];

    // 1. Mes livrables et jalons
    var mine = data.planitems.filter(function (i) {
      return live(i) && i.owner_resource_id === r.id && activeProject(i.project_id) && !isDone_(i);
    });
    var late = [], due = [], stale = [];
    mine.forEach(function (i) {
      var f = i.planned_finish;
      var p = projects[i.project_id];
      var line = { text: p.code + ' · ' + i.name, date: f, url: link('gantt', i.project_id) };
      if (!isBlank(f) && f < today) late.push(line);
      else if (!isBlank(f) && f <= soon) due.push(line);
      if (i.item_type === 'Livrable' && Number(i.progress_pct) > 0) {
        var last = !isBlank(i.last_progress_at) ? String(i.last_progress_at).slice(0, 10) : String(i.created_at || '').slice(0, 10);
        if (last && last < staleLimit) stale.push({ text: p.code + ' · ' + i.name, date: last, url: link('gantt', i.project_id) });
      }
    });
    var byDate = function (a, b) { return String(a.date).localeCompare(String(b.date)); };
    if (late.length) sections.push({ title: 'En retard', tone: 'alert', lines: late.sort(byDate).map(function (l) { return Object.assign(l, { note: 'fin prévue le ' + frDate_(l.date) }); }) });
    if (due.length) sections.push({ title: 'À échéance dans les ' + THRESHOLDS.dueSoonDays + ' jours', lines: due.sort(byDate).map(function (l) { return Object.assign(l, { note: 'le ' + frDate_(l.date) }); }) });
    if (stale.length) sections.push({ title: 'Avancement à déclarer', lines: stale.sort(byDate).map(function (l) { return Object.assign(l, { note: 'dernière déclaration le ' + frDate_(l.date) }); }) });

    // 1b. Mes GR à faire : PO lancées dont la date de GR attendue est passée ou approche (aucun montant dans le mail)
    var resNames = {};
    data.resources.forEach(function (x) { resNames[x.id] = x.name; });
    var grLines = (data.purchaseOrders || []).filter(function (o) {
      return live(o) && o.status === 'Lancée' && !isBlank(o.gr_due_date) && String(o.gr_due_date) <= soon &&
        (o.owner_resource_id === r.id || (isBlank(o.owner_resource_id) && String(o.created_by || '').toLowerCase() === email));
    }).sort(function (a, b) { return String(a.gr_due_date).localeCompare(String(b.gr_due_date)); }).map(function (o) {
      var late = String(o.gr_due_date) < today, pid = (data.cpnProject || {})[normCpn_(o.cpn)];
      return { text: 'PO ' + o.po_number + (resNames[o.resource_id] ? ' · ' + resNames[o.resource_id] : ''), tone: late ? 'alert' : '',
        note: late ? 'GR à faire, attendue depuis le ' + frDate_(o.gr_due_date) : 'GR attendue le ' + frDate_(o.gr_due_date), url: pid ? link('budget', pid, '&tab=po') : '' };
    });
    if (grLines.length) sections.push({ title: 'Bons de réception (GR) à faire', tone: grLines.some(function (l) { return l.tone === 'alert'; }) ? 'alert' : '', lines: grLines });

    // 2. Pilotage : projets dont la personne valide les changements (chef de projet, DPL)
    var ctx = { resourceId: r.id, isAdmin: false, assignments: activeAssignments(r.id, data.assignments, today), lookup: lookup };
    var pilot = data.projects.filter(function (p) {
      return activeProject(p.id) && (p.manager_resource_id === r.id || can(ctx, 'changes.ack', { type: 'project', id: p.id }));
    }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
    var pilotLines = [];
    pilot.forEach(function (p) {
      var n = (data.pendingChanges || {})[p.id] || 0;
      if (n) pilotLines.push({ text: p.code + ' · ' + n + (n > 1 ? ' changements' : ' changement') + ' sur des données figées', note: 'à valider', url: link('suivi', p.id, '&tab=changes') });
      (data.baselines || []).filter(function (b) { return live(b) && b.project_id === p.id && b.status === 'Demandée'; }).forEach(function (b) {
        pilotLines.push({ text: p.code + ' · demande de baseline de ' + b.requested_by, note: truncate(b.justification, 140), url: link('suivi', p.id, '&tab=baselines') });
      });
      var ins = (data.insights || []).filter(function (x) { return live(x) && x.project_id === p.id && x.status === 'Nouveau'; });
      var alerts = ins.filter(function (x) { return x.severity === 'Alerte'; });
      alerts.slice(0, 3).forEach(function (x) { pilotLines.push({ text: p.code + ' · ' + x.message, tone: 'alert', url: link('gantt', p.id) }); });
      var others = ins.length - Math.min(3, alerts.length);
      if (others > 0) pilotLines.push({ text: p.code + ' · ' + others + (others > 1 ? ' autres constats' : ' autre constat') + ' du moteur de règles', url: link('suivi', p.id) });
    });
    if (pilotLines.length) sections.push({ title: 'Pilotage de vos projets', lines: pilotLines });

    // 3. Mes demandes de baseline tranchées
    var decided = (data.baselines || []).filter(function (b) {
      return live(b) && String(b.requested_by).toLowerCase() === email && String(b.decided_by).toLowerCase() !== email &&
        (b.status === 'Refusée' || b.status === 'Active' || b.status === 'Archivée') && String(b.decided_at).slice(0, 10) >= windowStart;
    });
    if (decided.length) {
      sections.push({ title: 'Vos demandes de baseline', lines: decided.map(function (b) {
        var p = projects[b.project_id] || { code: '' };
        return { text: p.code + ' · ' + (b.status === 'Refusée' ? 'refusée' : 'acceptée : ' + (b.label || 'B' + b.number)), note: 'par ' + b.decided_by, url: link('suivi', b.project_id, '&tab=baselines') };
      }) });
    }

    if (!sections.length && !opts.onlyEmail) return;
    var count = sections.reduce(function (a, s) { return a + s.lines.length; }, 0);
    var subject = (freq === 'Hebdomadaire' && !opts.onlyEmail ? 'Votre point de la semaine' : 'Votre point du ' + frDate_(today)) +
      (count ? ' — ' + count + (count > 1 ? ' éléments' : ' élément') : '');
    out.push(Object.assign({ to: email, subject: subject, counts: { lines: count, late: late.length } }, renderDigest_(r, sections, opts)));
  });
  return out;
}

/** Les constats du moteur de règles citent des dates AAAA-MM-JJ : on les écrit à la française. */
function frDatesIn_(s) {
  return String(s).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

function renderDigest_(person, sections, opts) {
  var text = ['Bonjour ' + person.name + ',', ''];
  var html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2A33;max-width:640px">',
    '<p>Bonjour ' + escHtml_(person.name) + ',</p>'];
  if (!sections.length) {
    text.push('Rien à signaler aujourd’hui.');
    html.push('<p>Rien à signaler aujourd’hui.</p>');
  }
  sections.forEach(function (s) {
    text.push(s.title.toUpperCase());
    html.push('<h3 style="font-size:15px;margin:18px 0 6px;color:' + (s.tone === 'alert' ? '#B3261E' : '#2B3A48') + '">' + escHtml_(s.title) + '</h3><ul style="margin:0;padding-left:18px">');
    s.lines.slice(0, DIGEST_MAX_LINES).forEach(function (l) {
      l.text = frDatesIn_(l.text);
      text.push('- ' + l.text + (l.note ? ' (' + l.note + ')' : '') + (l.url ? '\n  ' + l.url : ''));
      var label = escHtml_(l.text);
      html.push('<li style="margin:3px 0' + (l.tone === 'alert' ? ';color:#B3261E' : '') + '">' +
        (l.url ? '<a href="' + escHtml_(l.url) + '" style="color:inherit">' + label + '</a>' : label) +
        (l.note ? ' <span style="color:#5B6B7A">— ' + escHtml_(l.note) + '</span>' : '') + '</li>');
    });
    if (s.lines.length > DIGEST_MAX_LINES) {
      var more = s.lines.length - DIGEST_MAX_LINES;
      text.push('- … et ' + more + ' autre(s)');
      html.push('<li style="color:#5B6B7A">… et ' + more + ' autre(s)</li>');
    }
    html.push('</ul>');
    text.push('');
  });
  var foot = 'Ce récapitulatif remplace les notifications une à une. Fréquence : Mon compte, onglet Notifications.';
  text.push(foot);
  html.push('<p style="margin-top:22px;font-size:12px;color:#5B6B7A">' + escHtml_(foot) +
    (opts.baseUrl ? ' <a href="' + escHtml_(opts.baseUrl + '?view=compte&tab=notifications') + '" style="color:#5B6B7A">Ouvrir</a>' : '') + '</p></div>');
  return { text: text.join('\n'), html: html.join('') };
}

function loadDigestData_() {
  var projects = repoList('Project');
  return {
    projects: projects, planitems: repoList('PlanItem'), resources: repoList('Resource'),
    assignments: repoList('RoleAssignment'), settings: repoList('UserSetting'), insights: repoList('Insight'),
    baselines: repoList('Baseline'), workpackages: repoList('WorkPackage'), budgetLines: repoList('BudgetLine'),
    pendingChanges: pendingChangeCounts_(projects, repoList('ChangeEvent')),
    purchaseOrders: repoList('PurchaseOrder', function (o) { return o.status === 'Lancée'; }),
    cpnProject: (function () { var m = {}, idx = cpnIndex_(); Object.keys(idx).forEach(function (k) { m[k] = idx[k].project.id; }); return m; })()
  };
}

/** Envoi d'un mail au format texte et HTML ; capturé dans les tests. */
function sendMail_(to, subject, text, html) {
  if (SENT_MAILS) { SENT_MAILS.push({ to: to, subject: subject, body: text, html: html }); return true; }
  if (typeof MailApp === 'undefined') { console.log('[mail] ' + to + ' — ' + subject); return false; }
  MailApp.sendEmail({ to: to, subject: '[PPM] ' + subject, body: text, htmlBody: html, name: 'PPM' });
  return true;
}

/** Déclencheur du matin (7 h, jours de semaine) : un mail par personne concernée, dans la limite du quota du jour. */
function sendDigests() {
  resetExecution_();
  var today = todayStr();
  var wd = weekdayOf(today);
  if (wd === 0 || wd === 6) return 'Week-end : pas de récapitulatif.';
  var digests = buildDigests(loadDigestData_(), today, { baseUrl: getProp(PROP.WEBAPP_URL, ''), weekly: wd === 1 });
  var quota = typeof MailApp !== 'undefined' ? MailApp.getRemainingDailyQuota() : Infinity;
  var sent = 0, skipped = 0;
  digests.forEach(function (d) {
    if (sent >= quota - 20) { skipped++; return; } // garde une marge pour les alertes du jour
    if (sendMail_(d.to, d.subject, d.text, d.html)) sent++;
  });
  if (skipped) {
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Récapitulatifs non envoyés', skipped + ' récapitulatif(s) non envoyé(s) : quota de mails du jour atteint.');
    });
  }
  setProp(PROP.LAST_DIGEST, JSON.stringify({ at: nowIso(), sent: sent, skipped: skipped }));
  var msg = sent + ' récapitulatif(s) envoyé(s)' + (skipped ? ', ' + skipped + ' reporté(s) (quota).' : '.');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- réglages personnels et aperçu

defineAction('settings.get', function (p, ctx) {
  var row = userSettingRow_(ctx.email);
  return {
    notify_frequency: (row && row.notify_frequency) || 'Quotidien',
    calendar_invites: !!(row && isTrue(row.calendar_invites)),
    reminder_off: reminderSettingsView_(row).reminder_off, reminder_days: reminderSettingsView_(row).reminder_days, reminder_default: reminderDefaults_(),
    email: ctx.email, hasResource: !!ctx.resourceId
  };
});

defineAction('settings.set', function (p, ctx) {
  var patch = {};
  if (p.notify_frequency !== undefined) {
    if (['Quotidien', 'Hebdomadaire', 'Aucun'].indexOf(p.notify_frequency) < 0) throw new PpmError('VALIDATION', 'Fréquence inconnue.');
    patch.notify_frequency = p.notify_frequency;
  }
  if (p.calendar_invites !== undefined) patch.calendar_invites = !!p.calendar_invites;
  if (p.reminder_off !== undefined) patch.reminder_off = !!p.reminder_off;
  if (p.reminder_days !== undefined) {
    if (p.reminder_days === null || String(p.reminder_days).trim() === '') patch.reminder_days = '';
    else {
      var n = Number(p.reminder_days);
      if (isNaN(n) || Math.floor(n) !== n || n < 1 || n > 60) throw new PpmError('VALIDATION', 'Délai du rappel : un nombre entier de jours ouvrés entre 1 et 60.');
      patch.reminder_days = n;
    }
  }
  var row = userSettingRow_(ctx.email);
  if (row) repoUpdate('UserSetting', row.id, patch, null, ctx.actx);
  else repoInsert('UserSetting', Object.assign({ user_email: ctx.email }, patch), ctx.actx);
  return API_ACTIONS['settings.get']({}, ctx);
});

/** Aperçu de son propre récapitulatif ; send = true l'envoie aussitôt à soi-même (pour essayer). */
defineAction('digest.preview', function (p, ctx) {
  var list = buildDigests(loadDigestData_(), todayStr(), { baseUrl: getProp(PROP.WEBAPP_URL, ''), onlyEmail: ctx.email });
  if (!list.length) {
    return { subject: '', html: '', text: '', empty: true, sent: false,
      reason: ctx.resourceId ? 'Votre adresse n’est pas dans le domaine.' : 'Aucune fiche de personne n’a votre adresse : créez-la dans AppSheet.' };
  }
  var d = list[0];
  var sent = p.send ? sendMail_(d.to, d.subject + ' (essai)', d.text, d.html) : false;
  return { subject: d.subject, html: d.html, text: d.text, empty: d.counts.lines === 0, sent: sent };
});

// ======================================================================
// 37_Simulation.gs
// ======================================================================

/**
 * PPM Core — lot 4 : simulation « et si… », synthèse chiffrée, signaux faibles (section 9).
 *
 * Tout ce fichier est déterministe : il ne fait jamais appel à Gemini. Il fournit les chiffres
 * que le copilote cite (le modèle n'en invente aucun) et fonctionne même copilote désactivé.
 * Fonctions pures, testées hors ligne.
 */

// ---------------------------------------------------------------- simulation

/**
 * Applique des hypothèses de décalage à une copie du planning et propage l'effet domino
 * aux successeurs (mêmes conventions de dépendance que dependencyViolations).
 *
 *   items   : PlanItem[] du projet, plus les voisins d'autres projets marqués external: true ;
 *   deps    : Dependency[] ;
 *   changes : [{ itemId, shiftDays }] (jours ouvrés, négatif = avancer) ou [{ itemId, finish }] ;
 *   opts    : { requirements, baselineFinish: { id: date }, projectId }.
 *
 * Un successeur n'est repoussé que si la contrainte l'exige ; rien n'est jamais avancé
 * automatiquement (H7). Un élément d'un autre projet n'est pas déplacé : l'impact est signalé.
 * Rien n'est écrit : le résultat décrit l'avant et l'après.
 */
function simulateChanges(items, deps, holFor, changes, opts) {
  opts = opts || {};
  var hol = function (it) { return holFor(it.project_id); };
  var before = {}, sim = {};
  items.forEach(function (i) {
    if (isTrue(i.deleted)) return;
    var rec = {
      id: i.id, name: i.name, item_type: i.item_type, project_id: i.project_id, external: !!i.external,
      planned_start: itemStart(i) || '', planned_finish: itemFinish(i) || '', status: i.status, progress_pct: i.progress_pct
    };
    before[i.id] = rec;
    sim[i.id] = Object.assign({}, rec);
  });
  var shift = function (it, n) {
    if (!n) return;
    var h = hol(it);
    if (!isBlank(it.planned_start)) it.planned_start = addWorkingDays(it.planned_start, n, h);
    if (!isBlank(it.planned_finish)) it.planned_finish = addWorkingDays(it.planned_finish, n, h);
  };

  var moved = {}, queue = [], notes = [];
  (changes || []).forEach(function (ch) {
    var it = sim[ch.itemId];
    if (!it) throw new PpmError('VALIDATION', 'Élément introuvable dans le périmètre simulé : ' + ch.itemId);
    if (it.external) throw new PpmError('VALIDATION', '« ' + it.name + ' » appartient à un autre projet : simulez depuis ce projet.');
    if (isBlank(it.planned_finish)) throw new PpmError('VALIDATION', '« ' + it.name + ' » n’a pas de date : rien à décaler.');
    var n;
    if (!isBlank(ch.finish)) n = workingDayOffset(it.planned_finish, String(ch.finish), hol(it));
    else n = Math.round(Number(ch.shiftDays) || 0);
    if (Math.abs(n) > 500) throw new PpmError('VALIDATION', 'Décalage trop grand (500 jours ouvrés au plus).');
    shift(it, n);
    moved[it.id] = { cause: 'hypothesis', shift: n };
    if (n < 0) notes.push('« ' + it.name + ' » avancé : ses successeurs ne sont pas avancés automatiquement (le planning n’est jamais recalculé seul).');
    queue.push(it.id);
  });

  var out = {};
  deps.forEach(function (d) { if (!isTrue(d.deleted)) (out[d.predecessor_id] = out[d.predecessor_id] || []).push(d); });
  var external = {}, guard = 0;
  while (queue.length && guard++ < 20000) {
    var p = sim[queue.shift()];
    (out[p.id] || []).forEach(function (d) {
      var s = sim[d.successor_id];
      if (!s) return;
      // On ne propage que le surcroît de contrainte dû à l'hypothèse : une dépendance déjà non respectée
      // avant l'hypothèse le reste d'autant (la simulation mesure l'effet de l'hypothèse, elle ne corrige pas le plan).
      var req = requiredDate_(d, p, s, hol(s));
      var req0 = requiredDate_(d, before[p.id], s, hol(s));
      if (!req) return;
      var floor = req0 && req0.required > req.actual ? req0.required : req.actual;
      if (floor >= req.required) return;
      var gap = workingDayOffset(floor, req.required, hol(s));
      if (s.external) {
        var prev = external[s.id];
        if (!prev || gap > prev.gap) external[s.id] = { id: s.id, name: s.name, project_id: s.project_id, gap: gap, required: req.required, actual: req.actual, because: p.name };
        return;
      }
      shift(s, gap);
      moved[s.id] = { cause: p.id, shift: ((moved[s.id] && moved[s.id].shift) || 0) + gap };
      queue.push(s.id);
    });
  }

  var already = dependencyViolations(Object.keys(before).map(function (k) { return before[k]; }), deps, holFor).length;
  if (already) {
    notes.push(already + (already > 1 ? ' dépendances étaient déjà non respectées' : ' dépendance était déjà non respectée') +
      ' avant l’hypothèse : la simulation ne les corrige pas, elle mesure seulement l’effet de l’hypothèse.');
  }

  // Résultats : éléments déplacés, fin du plan, jalons, chemin critique.
  var own = function (m) { return Object.keys(m).map(function (k) { return m[k]; }).filter(function (i) { return !i.external; }); };
  var lastFinish = function (m) { var f = ''; own(m).forEach(function (i) { if (i.planned_finish > f) f = i.planned_finish; }); return f || null; };
  var anyHol = holFor(opts.projectId || (own(before)[0] || {}).project_id);
  var endBefore = lastFinish(before), endAfter = lastFinish(sim);
  var baseFinish = opts.baselineFinish || {};
  var movedList = Object.keys(moved).map(function (id) {
    var b = before[id], a = sim[id], m = moved[id];
    return {
      id: id, name: a.name, item_type: a.item_type, cause: m.cause === 'hypothesis' ? 'hypothèse' : (sim[m.cause] ? sim[m.cause].name : ''),
      hypothesis: m.cause === 'hypothesis', before_start: b.planned_start || null, before_finish: b.planned_finish,
      start: a.planned_start || null, finish: a.planned_finish, shift: workingDayOffset(b.planned_finish, a.planned_finish, hol(a)),
      baseline_finish: baseFinish[id] || null,
      slip_vs_baseline: baseFinish[id] ? workingDayOffset(baseFinish[id], a.planned_finish, hol(a)) : null
    };
  }).sort(function (x, y) { return (y.hypothesis - x.hypothesis) || String(x.finish).localeCompare(String(y.finish)); });

  var threatened = function (m) {
    var outList = [];
    (opts.requirements || []).forEach(function (r) {
      if (isTrue(r.deleted)) return;
      var ms = m[r.milestone_id], dl = m[r.deliverable_id];
      if (!ms || !dl || ms.external || isBlank(ms.planned_finish) || isBlank(dl.planned_finish)) return;
      if (dl.status === 'Terminé' || Number(dl.progress_pct) >= 100) return;
      if (dl.planned_finish > ms.planned_finish) outList.push(ms.id + '|' + dl.id);
    });
    return outList;
  };
  var thrBefore = {}, thrAfter = threatened(sim);
  threatened(before).forEach(function (k) { thrBefore[k] = true; });
  var newlyThreatened = thrAfter.filter(function (k) { return !thrBefore[k]; }).map(function (k) {
    var ids = k.split('|');
    return { milestone: sim[ids[0]].name, milestone_date: sim[ids[0]].planned_finish, deliverable: sim[ids[1]].name, deliverable_finish: sim[ids[1]].planned_finish };
  });

  var listOf = function (m) { return Object.keys(m).map(function (k) { return m[k]; }); };
  var liveDeps = deps.filter(function (d) { return !isTrue(d.deleted); });
  var fBefore = computeFloats(listOf(before), liveDeps, holFor), fAfter = computeFloats(listOf(sim), liveDeps, holFor);
  var critBefore = {};
  fBefore.criticalIds.forEach(function (id) { critBefore[id] = true; });
  var newlyCritical = fAfter.criticalIds.filter(function (id) { return !critBefore[id] && sim[id] && !sim[id].external; })
    .map(function (id) { return sim[id].name; });

  return {
    changes: movedList.filter(function (m) { return m.hypothesis; }),
    moved: movedList,
    domino: movedList.filter(function (m) { return !m.hypothesis; }).length,
    plan_end: { before: endBefore, after: endAfter, shift: endBefore && endAfter ? workingDayOffset(endBefore, endAfter, anyHol) : null },
    milestones: movedList.filter(function (m) { return m.item_type === 'Jalon'; }),
    newly_threatened: newlyThreatened,
    external_impacts: Object.keys(external).map(function (k) { return external[k]; }),
    newly_critical: newlyCritical,
    notes: notes
  };
}

/** Date exigée par une dépendance pour le successeur, selon les dates simulées du prédécesseur. */
function requiredDate_(d, p, s, hol) {
  var lag = Math.round(Number(d.lag_days || 0));
  var ref, actual, required;
  switch (d.dep_type) {
    case 'FS':
      ref = p.planned_finish; actual = s.planned_start || s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      var offset = (p.item_type === 'Jalon' ? 0 : 1) + lag;
      required = offset === 0 ? nextWorkingDay(ref, hol) : addWorkingDays(ref, offset, hol);
      break;
    case 'SS':
      ref = p.planned_start || p.planned_finish; actual = s.planned_start || s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    case 'FF':
      ref = p.planned_finish; actual = s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    case 'SF':
      ref = p.planned_start || p.planned_finish; actual = s.planned_finish;
      if (isBlank(ref) || isBlank(actual)) return null;
      required = addWorkingDays(ref, lag, hol);
      break;
    default:
      return null;
  }
  return { required: required, actual: actual };
}

// ---------------------------------------------------------------- signaux faibles

/** Mots qui annoncent souvent un glissement avant qu'il n'apparaisse dans les dates (FR, EN, DE). */
var WEAK_SIGNAL_RE = /bloqu|en attente|attend(?:ons|re) (?:le |la |les )?(?:fournisseur|retour|validation|livraison)|pas (?:encore )?re[çc]u|non re[çc]u|manque|p[ée]nurie|rupture|probl[èe]me|difficult|retard|report[ée]|suspendu|arr[êe]t[ée]?|panne|non conforme|blocked|waiting|delay|missing|issue|verz[öo]ger|warten|fehlt/i;

/**
 * Derniers commentaires d'avancement (depuis `since`) qui contiennent un mot de blocage,
 * sur des livrables non terminés. Un seul signal par livrable : le plus récent.
 */
function weakSignals_(updates, items, since) {
  var live = {};
  items.forEach(function (i) {
    if (!isTrue(i.deleted) && i.item_type === 'Livrable' && i.status !== 'Terminé' && Number(i.progress_pct) < 100) live[i.id] = i;
  });
  var last = {};
  (updates || []).forEach(function (u) {
    if (isTrue(u.deleted) || !live[u.deliverable_id] || isBlank(u.comment)) return;
    var at = String(u.declared_at || u.created_at || '');
    if (at.slice(0, 10) < since) return;
    if (!last[u.deliverable_id] || at > last[u.deliverable_id].at) last[u.deliverable_id] = { at: at, comment: String(u.comment) };
  });
  var out = [];
  Object.keys(last).forEach(function (id) {
    var m = WEAK_SIGNAL_RE.exec(last[id].comment);
    if (!m) return;
    out.push({ item: live[id], date: last[id].at.slice(0, 10), comment: truncate(last[id].comment, 200), word: m[0] });
  });
  return out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
}

// ---------------------------------------------------------------- synthèse chiffrée

/**
 * Faits chiffrés d'un projet, calculés par le Core : c'est tout ce que le copilote a le droit de citer.
 * data : { projects, programs, workpackages, planitems, dependencies, resources, insights, risks,
 *          requirements, progressUpdates, baseline: { row, snap } | null, pendingChanges, pendingRequests }
 * Aucun montant ni taux journalier n'y figure (section 9, garde-fous).
 */
function buildProjectBrief(data, projectId, today, holFor) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var hol = holFor(projectId);
  var res = indexBy_(data.resources);
  var name = function (id) { return !isBlank(id) && res[id] ? res[id].name : ''; };
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; });
  var floats = computeFloats(items, deps, holFor);
  var done = function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; };
  var baseItems = data.baseline ? data.baseline.snap.PlanItem : {};
  var dated = items.filter(function (i) { return !isBlank(i.planned_finish); });
  var planEnd = dated.reduce(function (a, i) { return i.planned_finish > a ? i.planned_finish : a; }, '') || null;
  var baseEnd = Object.keys(baseItems).reduce(function (a, id) { var f = baseItems[id].planned_finish; return !isBlank(f) && f > a ? f : a; }, '') || null;

  var late = items.filter(function (i) { return !done(i) && !isBlank(i.planned_finish) && i.planned_finish < today; }).map(function (i) {
    return { name: i.name, type: i.item_type, finish: i.planned_finish, days_late: workingDayOffset(i.planned_finish, today, hol), owner: name(i.owner_resource_id) };
  }).sort(function (a, b) { return b.days_late - a.days_late; });

  var horizon = addCalendarDays(today, 90);
  var req = data.requirements || [];
  var milestones = items.filter(function (i) { return i.item_type === 'Jalon' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today && i.planned_finish <= horizon; })
    .sort(function (a, b) { return a.planned_finish.localeCompare(b.planned_finish); }).slice(0, 6).map(function (m) {
      var b = baseItems[m.id];
      var threats = req.filter(function (r) { return !isTrue(r.deleted) && r.milestone_id === m.id; }).map(function (r) {
        return items.filter(function (i) { return i.id === r.deliverable_id; })[0];
      }).filter(function (dl) { return dl && !done(dl) && !isBlank(dl.planned_finish) && dl.planned_finish > m.planned_finish; });
      return {
        name: m.name, date: m.planned_finish, in_days: Math.round((parseYmd(m.planned_finish) - parseYmd(today)) / DAY_MS),
        slip_vs_baseline: b && !isBlank(b.planned_finish) ? workingDayOffset(b.planned_finish, m.planned_finish, hol) : null,
        threatened_by: threats.map(function (t) { return t.name; })
      };
    });

  var soon = addCalendarDays(today, 14);
  var dueSoon = items.filter(function (i) { return i.item_type === 'Livrable' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today && i.planned_finish <= soon; })
    .sort(function (a, b) { return a.planned_finish.localeCompare(b.planned_finish); }).slice(0, 8)
    .map(function (i) { return { name: i.name, finish: i.planned_finish, progress_pct: Number(i.progress_pct) || 0, owner: name(i.owner_resource_id), critical: !!(floats.byId[i.id] || {}).critical }; });

  var insights = (data.insights || []).filter(function (x) { return !isTrue(x.deleted) && x.project_id === projectId && x.status === 'Nouveau'; });
  var sev = function (s) { return insights.filter(function (x) { return x.severity === s; }); };
  var risks = (data.risks || []).filter(function (r) { return !isTrue(r.deleted) && r.project_id === projectId && r.status !== 'Clos' && r.kind !== 'Opportunité'; })
    .sort(function (a, b) { return (Number(b.score) || 0) - (Number(a.score) || 0); });
  var signals = weakSignals_(data.progressUpdates, items, addCalendarDays(today, -THRESHOLDS.staleProgressDays));
  var violations = dependencyViolations(items, deps, holFor).length;
  var program = !isBlank(project.program_id) ? indexBy_(data.programs || [])[project.program_id] : null;

  var facts = {
    today: today,
    project: { code: project.code, name: project.name, status: project.status || '', manager: name(project.manager_resource_id),
      program: program ? program.name : '', target_end: project.end_date || null },
    baseline: data.baseline ? { label: data.baseline.row.label || 'B' + data.baseline.row.number, frozen_on: String(data.baseline.row.decided_at || '').slice(0, 10) } : null,
    progress: {
      weighted_pct: weightedProgress_(items, holFor), items: items.length,
      done: items.filter(done).length, in_progress: items.filter(function (i) { return !done(i) && Number(i.progress_pct) > 0; }).length
    },
    schedule: {
      plan_end: planEnd, target_end: project.end_date || null,
      margin_to_target: planEnd && project.end_date ? workingDayOffset(planEnd, project.end_date, hol) : null,
      baseline_end: baseEnd, slip_vs_baseline: planEnd && baseEnd ? workingDayOffset(baseEnd, planEnd, hol) : null,
      critical_items: floats.criticalIds.length, dependency_violations: violations
    },
    late: late.slice(0, 8), late_count: late.length,
    upcoming_milestones: milestones,
    due_soon: dueSoon,
    insights: { alerte: sev('Alerte').length, vigilance: sev('Vigilance').length, info: sev('Info').length,
      top: sev('Alerte').concat(sev('Vigilance')).slice(0, 5).map(function (x) { return x.message; }) },
    risks: { open: risks.length, top: risks.slice(0, 3).map(function (r) { return { title: r.title, score: Number(r.score) || null, owner: name(r.owner_resource_id) }; }) },
    changes_pending: data.pendingChanges || 0,
    baseline_requests_pending: data.pendingRequests || 0,
    weak_signals: signals.slice(0, 5).map(function (s) { return { item: s.item.name, date: s.date, comment: s.comment }; })
  };
  return { facts: facts, lines: briefLines_(facts) };
}

/** Synthèse rédigée par le Core, sans IA : elle reprend les faits, en phrases courtes. */
function briefLines_(f) {
  var fr = function (s) { return s ? frDate_(s) : '—'; };
  var pl = function (n, one, many) { return n + ' ' + (Math.abs(n) > 1 ? many : one); };
  var out = [];
  var st = f.schedule;
  var head = 'Avancement ' + f.progress.weighted_pct + ' % (' + pl(f.progress.done, 'élément terminé', 'éléments terminés') + ' sur ' + f.progress.items + ').';
  if (st.plan_end) head += ' Fin du plan le ' + fr(st.plan_end);
  if (st.margin_to_target !== null) head += st.margin_to_target >= 0 ? ', ' + pl(st.margin_to_target, 'jour ouvré', 'jours ouvrés') + ' de marge sur la fin visée (' + fr(st.target_end) + ')' : ', ' + pl(-st.margin_to_target, 'jour ouvré', 'jours ouvrés') + ' après la fin visée (' + fr(st.target_end) + ')';
  out.push({ tone: st.margin_to_target !== null && st.margin_to_target < 0 ? 'alert' : '', text: head + (st.plan_end ? '.' : '') });
  if (f.baseline) {
    out.push({ tone: st.slip_vs_baseline > 0 ? 'alert' : '', text: st.slip_vs_baseline === null ? 'Baseline ' + f.baseline.label + ' figée le ' + fr(f.baseline.frozen_on) + '.'
      : st.slip_vs_baseline > 0 ? 'La fin du plan a glissé de ' + pl(st.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' depuis la baseline ' + f.baseline.label + '.'
        : st.slip_vs_baseline < 0 ? 'La fin du plan est en avance de ' + pl(-st.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' sur la baseline ' + f.baseline.label + '.'
          : 'La fin du plan tient la baseline ' + f.baseline.label + '.' });
  } else {
    out.push({ tone: '', text: 'Pas de baseline : les écarts ne sont pas mesurés.' });
  }
  if (f.late_count) out.push({ tone: 'alert', text: pl(f.late_count, 'élément en retard', 'éléments en retard') + ', dont « ' + f.late[0].name + ' » (' + pl(f.late[0].days_late, 'jour ouvré', 'jours ouvrés') + ').' });
  if (st.dependency_violations) out.push({ tone: 'alert', text: pl(st.dependency_violations, 'dépendance non respectée', 'dépendances non respectées') + '.' });
  f.upcoming_milestones.slice(0, 3).forEach(function (m) {
    var t = 'Jalon « ' + m.name + ' » le ' + fr(m.date) + ' (dans ' + pl(m.in_days, 'jour', 'jours') + ')';
    if (m.threatened_by.length) t += ', menacé par « ' + m.threatened_by[0] + ' »';
    else if (m.slip_vs_baseline > 0) t += ', ' + pl(m.slip_vs_baseline, 'jour ouvré', 'jours ouvrés') + ' après la baseline';
    out.push({ tone: m.threatened_by.length || m.slip_vs_baseline > 0 ? 'alert' : '', text: t + '.' });
  });
  if (f.weak_signals.length) out.push({ tone: 'warn', text: pl(f.weak_signals.length, 'signal faible', 'signaux faibles') + ' dans les commentaires d’avancement, dont « ' + f.weak_signals[0].item + ' » : « ' + truncate(f.weak_signals[0].comment, 90) + ' ».' });
  if (f.risks.open) out.push({ tone: '', text: pl(f.risks.open, 'risque ouvert', 'risques ouverts') + (f.risks.top[0] ? ', le plus fort : « ' + f.risks.top[0].title + ' »' : '') + '.' });
  if (f.changes_pending || f.baseline_requests_pending) {
    var bits = [];
    if (f.changes_pending) bits.push(pl(f.changes_pending, 'changement', 'changements') + ' à valider');
    if (f.baseline_requests_pending) bits.push(pl(f.baseline_requests_pending, 'demande de baseline', 'demandes de baseline') + ' en attente');
    out.push({ tone: '', text: bits.join(', ') + '.' });
  }
  return out;
}

// ======================================================================
// 38_Copilot.gs
// ======================================================================

/**
 * PPM Core — lot 4 : copilote (section 9).
 *
 * Trois modes, réglés par la propriété du script PPM_AI_MODE (H12) :
 *   off    (par défaut) : aucune IA. Synthèse chiffrée, simulation, signaux faibles et suggestions
 *                         du moteur de règles restent disponibles : ils ne dépendent pas de Gemini.
 *   manual : le Core prépare un texte (consignes, faits chiffrés, question) que l'utilisateur colle
 *            lui-même dans Gemini (Workspace). Rien ne part automatiquement.
 *   api    : appel direct de l'API Gemini avec la clé PPM_GEMINI_API_KEY et le modèle PPM_GEMINI_MODEL,
 *            à n'activer qu'une fois le canal validé par la DSI.
 *
 * Garde-fous : l'IA ne reçoit que les faits nécessaires (aucun montant, aucun taux, aucune adresse) ;
 * elle ne lit les données que par des fonctions en lecture seule ; elle n'écrit jamais ;
 * tout chiffre de sa réponse absent des données du Core est signalé ; chaque échange est journalisé
 * (AiLog) avec l'avis de l'utilisateur ; un quota quotidien limite les appels par personne.
 */

var AI_PROVIDER = null; // tests : faux modèle { name, generate(req) → { text, calls, raw } }

function aiMode_() {
  var m = String(getProp(PROP.AI_MODE, 'off') || 'off').toLowerCase().trim();
  return ['off', 'manual', 'api'].indexOf(m) >= 0 ? m : 'off';
}

function aiQuota_() {
  var q = Number(getProp(PROP.AI_QUOTA, '30'));
  return q > 0 ? Math.floor(q) : 30;
}

function aiProvider_() {
  if (AI_PROVIDER) return AI_PROVIDER;
  var key = getProp(PROP.GEMINI_KEY, ''), model = getProp(PROP.GEMINI_MODEL, '');
  if (!key || !model) {
    throw new PpmError('CONFIG', 'Mode « api » : renseigner PPM_GEMINI_API_KEY et PPM_GEMINI_MODEL dans les propriétés du script.');
  }
  return geminiRest_(key, model);
}

/** API Gemini (REST generateContent). Les parties renvoyées par le modèle sont rejouées telles quelles. */
function geminiRest_(key, model) {
  return {
    name: 'gemini:' + model,
    generate: function (req) {
      var body = { contents: req.contents, generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (req.tools && req.tools.length) body.tools = [{ functionDeclarations: req.tools }];
      var r;
      try {
        r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
          payload: JSON.stringify(body), muteHttpExceptions: true
        });
      } catch (err) {
        throw new PpmError('CONFIG', 'Appel à Gemini impossible (autorisation « script.external_request » ajoutée au manifeste ?) : ' + (err && err.message ? err.message : err));
      }
      var code = r.getResponseCode();
      var json = parseJsonSafe(r.getContentText(), {});
      if (code === 429) throw new PpmError('QUOTA', 'Gemini : quota atteint, réessayer plus tard.');
      if (code >= 300) throw new PpmError('INTERNAL', 'Gemini a répondu ' + code + ' : ' + truncate((json.error && json.error.message) || r.getContentText(), 300));
      var parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      return {
        raw: parts,
        text: parts.filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join(''),
        calls: parts.filter(function (x) { return x.functionCall; }).map(function (x) { return { name: x.functionCall.name, args: x.functionCall.args || {} }; })
      };
    }
  };
}

// ---------------------------------------------------------------- garde-fou des chiffres

function normNum_(n) {
  var v = Number(String(n).replace(',', '.'));
  return isNaN(v) ? String(n) : String(v);
}

/**
 * Tout nombre du texte doit figurer dans les sources (faits du Core, résultats des fonctions, question).
 * Les numéros de liste en début de ligne sont ignorés. Les dates JJ/MM/AAAA se vérifient composante par composante.
 */
function checkGrounding(text, sources) {
  var allowed = {};
  sources.forEach(function (s) {
    (String(typeof s === 'string' ? s : JSON.stringify(s)).match(/\d+(?:[.,]\d+)?/g) || []).forEach(function (n) { allowed[normNum_(n)] = true; });
  });
  var seen = {}, unverified = [];
  (String(text || '').replace(/^\s*(?:[-*•]\s*)?\d{1,2}[.)]\s/gm, '').match(/\d+(?:[.,]\d+)?/g) || []).forEach(function (n) {
    var k = normNum_(n);
    if (!allowed[k] && !seen[k]) { seen[k] = true; unverified.push(n); }
  });
  return { ok: !unverified.length, unverified: unverified };
}

// ---------------------------------------------------------------- journal et quota

function aiUsedToday_(email) {
  var today = todayStr();
  return repoList('AiLog', function (l) { return l.actor === email && l.mode === 'api' && String(l.at).slice(0, 10) === today; }).length;
}

function logAi_(ctx, projectId, purpose, mode, prompt, response, unverified) {
  var rec = {
    id: newId(), at: nowIso(), actor: ctx.email, project_id: projectId || '', purpose: purpose, mode: mode,
    prompt: truncate(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), 45000),
    response: truncate(response || '', 20000), unverified: (unverified || []).join(' '), feedback: '', feedback_at: ''
  };
  repoAppendHistory('AiLog', [rec]);
  return rec.id;
}

var AI_SYSTEM = [
  'Tu es le copilote PMO de l’outil PPM d’un bureau d’études aéronautique. Tu aides un chef de projet à piloter.',
  'Règles impératives :',
  '1. Tu ne cites que des chiffres et des dates présents dans les faits fournis ou dans les résultats des fonctions. Tu ne calcules aucun nouveau chiffre.',
  '2. Si une information manque, dis-le simplement ; n’invente rien.',
  '3. Tu ne modifies rien : tu proposes, le chef de projet décide.',
  '4. Réponds en français, en phrases courtes, sans jargon ; dates au format JJ/MM/AAAA.'
].join('\n');

/** Texte à coller dans Gemini (mode manual) : consignes, faits, demande. */
function manualPrompt_(task, facts, extra) {
  return [AI_SYSTEM, '', 'Faits calculés par l’outil (JSON) :', JSON.stringify(facts, null, 1), extra ? '\n' + extra : '', '', 'Demande : ' + task].join('\n');
}

/**
 * Point d'entrée commun : selon le mode, renvoie le texte à copier (manual) ou la réponse du modèle (api).
 * sources : données autorisées pour le garde-fou des chiffres.
 */
function runAi_(ctx, projectId, purpose, task, facts, opts) {
  opts = opts || {};
  var mode = aiMode_();
  if (mode === 'off') {
    throw new PpmError('CONFIG', 'Le copilote IA n’est pas activé (propriété PPM_AI_MODE). Les synthèses chiffrées, simulations et suggestions restent disponibles.');
  }
  if (mode === 'manual' && !AI_PROVIDER) {
    var prompt = manualPrompt_(task, facts, opts.extra);
    var id = logAi_(ctx, projectId, purpose, 'manual', prompt, '', []);
    return { mode: 'manual', prompt: prompt, logId: id };
  }
  if (aiUsedToday_(ctx.email) >= aiQuota_()) throw new PpmError('QUOTA', 'Quota du copilote atteint pour aujourd’hui (' + aiQuota_() + ' demandes).');
  var provider = aiProvider_();
  var contents = [{ role: 'user', parts: [{ text: 'Faits calculés par l’outil (JSON) :\n' + JSON.stringify(facts) + (opts.extra ? '\n\n' + opts.extra : '') + '\n\nDemande : ' + task }] }];
  var sources = [facts, task, opts.extra || ''];
  var steps = [];
  var res;
  for (var turn = 0; turn < 6; turn++) {
    res = provider.generate({ system: AI_SYSTEM, contents: contents, tools: opts.tools ? opts.tools.declarations : null });
    if (!res.calls || !res.calls.length || !opts.tools) break;
    contents.push({ role: 'model', parts: res.raw && res.raw.length ? res.raw : res.calls.map(function (c) { return { functionCall: { name: c.name, args: c.args } }; }) });
    contents.push({ role: 'user', parts: res.calls.map(function (c) {
      var out;
      try {
        var h = opts.tools.handlers[c.name];
        out = h ? h(c.args || {}) : { error: 'Fonction inconnue : ' + c.name };
      } catch (err) {
        out = { error: err && err.message ? err.message : String(err) };
      }
      steps.push(c.name);
      sources.push(out);
      var json = JSON.stringify(out);
      return { functionResponse: { name: c.name, response: { content: json.length > 20000 ? truncate(json, 20000) : out } } };
    }) });
  }
  var text = String((res && res.text) || '').trim() || 'Pas de réponse du modèle.';
  var g = checkGrounding(text, sources);
  var logId = logAi_(ctx, projectId, purpose, 'api', { system: AI_SYSTEM, contents: contents }, text, g.unverified);
  return { mode: 'api', text: text, unverified: g.unverified, steps: steps, logId: logId, model: provider.name };
}

// ---------------------------------------------------------------- données d'un projet

function loadCopilotData_(projectId) {
  var projects = repoList('Project');
  var project = indexBy_(projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var events = repoList('ChangeEvent', function (e) { return e.project_id === projectId; });
  var data = {
    projects: projects, programs: repoList('Program'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'), resources: repoList('Resource'), insights: repoList('Insight'),
    risks: repoList('RiskOpportunity'), requirements: repoList('MilestoneRequirement'), holidaySets: repoList('HolidaySet'),
    progressUpdates: repoList('ProgressUpdate', function (u) { return String(u.declared_at || u.created_at || '') >= addCalendarDays(todayStr(), -THRESHOLDS.staleProgressDays); }),
    baseline: activeBaselineOf_(project),
    pendingChanges: pendingChangeCounts_([project], events)[projectId] || 0,
    pendingRequests: repoList('Baseline', function (b) { return b.project_id === projectId && b.status === 'Demandée'; }).length
  };
  data.holFor = holidayResolver(data);
  return data;
}

/** Hypothèses de simulation, périmètre du projet plus ses voisins externes. */
function runSimulation_(data, projectId, changes) {
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && (ids[d.predecessor_id] || ids[d.successor_id]); });
  var all = indexBy_(data.planitems);
  var ext = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) { if (!ids[id] && all[id] && !isTrue(all[id].deleted)) ext[id] = Object.assign({}, all[id], { external: true }); });
  });
  var baseFinish = {};
  if (data.baseline) Object.keys(data.baseline.snap.PlanItem).forEach(function (id) { baseFinish[id] = data.baseline.snap.PlanItem[id].planned_finish; });
  var r = simulateChanges(items.concat(Object.keys(ext).map(function (k) { return ext[k]; })), deps, data.holFor, changes,
    { requirements: data.requirements, baselineFinish: baseFinish, projectId: projectId });
  var projects = indexBy_(data.projects);
  r.external_impacts.forEach(function (e) { e.project = projects[e.project_id] ? projects[e.project_id].code : ''; });
  if (data.baseline) {
    var base = '';
    Object.keys(baseFinish).forEach(function (id) { if (!isBlank(baseFinish[id]) && baseFinish[id] > base) base = baseFinish[id]; });
    r.plan_end.baseline = base || null;
    r.plan_end.slip_vs_baseline = base && r.plan_end.after ? workingDayOffset(base, r.plan_end.after, data.holFor(projectId)) : null;
  }
  return r;
}

/** Fonctions en lecture seule proposées au modèle pour répondre aux questions. */
function copilotTools_(data, projectId, brief) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages);
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var floats = computeFloats(items, data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; }), data.holFor);
  var today = todayStr();
  var view = function (i) {
    var f = floats.byId[i.id] || {};
    return { id: i.id, name: i.name, type: i.item_type, workpackage: wps[i.wp_id] ? (wps[i.wp_id].wbs_code ? wps[i.wp_id].wbs_code + ' ' : '') + wps[i.wp_id].name : '',
      start: i.planned_start || null, finish: i.planned_finish || null, progress_pct: Number(i.progress_pct) || 0, status: i.status || '',
      owner: res[i.owner_resource_id] ? res[i.owner_resource_id].name : '', float_days: f.float === undefined ? null : f.float, critical: !!f.critical };
  };
  var findItem = function (ref) {
    var r = String(ref || '').toLowerCase().trim();
    return items.filter(function (i) { return i.id === ref; })[0] || items.filter(function (i) { return String(i.name).toLowerCase() === r; })[0] ||
      items.filter(function (i) { return String(i.name).toLowerCase().indexOf(r) >= 0; })[0] || null;
  };
  return {
    declarations: [
      { name: 'get_brief', description: 'Faits chiffrés du projet : avancement, fin du plan, baseline, retards, jalons, alertes, risques.', parameters: { type: 'object', properties: {} } },
      { name: 'list_items', description: 'Livrables et jalons du projet avec dates, avancement, responsable, marge et chemin critique.',
        parameters: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'late', 'critical', 'milestones', 'open'] } } } },
      { name: 'simulate_shift', description: 'Simule le décalage d’un livrable ou jalon (en jours ouvrés) et renvoie l’effet sur les successeurs, les jalons et la fin du plan. N’enregistre rien.',
        parameters: { type: 'object', properties: { item: { type: 'string', description: 'nom ou identifiant' }, shift_days: { type: 'integer' } }, required: ['item', 'shift_days'] } },
      { name: 'list_risks', description: 'Risques ouverts du projet.', parameters: { type: 'object', properties: {} } },
      { name: 'list_alerts', description: 'Constats du moteur de règles en attente de décision.', parameters: { type: 'object', properties: {} } }
    ],
    handlers: {
      get_brief: function () { return brief.facts; },
      list_items: function (a) {
        var f = a.filter || 'all';
        var list = items.filter(function (i) {
          var done = i.status === 'Terminé' || Number(i.progress_pct) >= 100;
          if (f === 'late') return !done && !isBlank(i.planned_finish) && i.planned_finish < today;
          if (f === 'critical') return (floats.byId[i.id] || {}).critical;
          if (f === 'milestones') return i.item_type === 'Jalon';
          if (f === 'open') return !done;
          return true;
        });
        return { count: list.length, items: list.slice(0, 80).map(view) };
      },
      simulate_shift: function (a) {
        var it = findItem(a.item);
        if (!it) return { error: 'Élément introuvable : ' + a.item };
        var r = runSimulation_(data, projectId, [{ itemId: it.id, shiftDays: a.shift_days }]);
        return { item: it.name, shift_days: Number(a.shift_days), plan_end: r.plan_end, moved: r.moved.slice(0, 20).map(function (m) {
          return { name: m.name, before_finish: m.before_finish, finish: m.finish, shift: m.shift, cause: m.cause };
        }), newly_threatened: r.newly_threatened, external_impacts: r.external_impacts, newly_critical: r.newly_critical };
      },
      list_risks: function () {
        return (data.risks || []).filter(function (r) { return !isTrue(r.deleted) && r.project_id === projectId && r.status !== 'Clos'; }).slice(0, 30).map(function (r) {
          return { title: r.title, kind: r.kind, probability: r.probability, impact: r.impact, score: r.score, strategy: r.strategy, status: r.status,
            owner: res[r.owner_resource_id] ? res[r.owner_resource_id].name : '', treatment_due: r.treatment_due || null };
        });
      },
      list_alerts: function () {
        return (data.insights || []).filter(function (x) { return !isTrue(x.deleted) && x.project_id === projectId && x.status === 'Nouveau'; })
          .slice(0, 30).map(function (x) { return { severity: x.severity, message: x.message, suggestion: x.suggestion }; });
      }
    }
  };
}

// ---------------------------------------------------------------- actions

defineAction('copilot.status', function (p, ctx) {
  var mode = aiMode_();
  return {
    mode: mode, model: mode === 'api' ? getProp(PROP.GEMINI_MODEL, '') : '',
    quota: { used: mode === 'api' ? aiUsedToday_(ctx.email) : 0, limit: aiQuota_() },
    canDecide: isBlank(p.projectId) ? false : can(ctx, 'insight.decide', { type: 'project', id: p.projectId })
  };
});

/** Synthèse du projet : faits et phrases du Core ; ai = true ajoute la rédaction du copilote (ou le texte à copier). */
defineAction('copilot.brief', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var data = loadCopilotData_(projectId);
  var brief = buildProjectBrief(data, projectId, todayStr(), data.holFor);
  if (!p.ai) return { facts: brief.facts, lines: brief.lines, ai: null };
  var ai = runAi_(ctx, projectId, 'synthese',
    'Rédige une synthèse de l’état du projet pour son chef de projet : 5 à 8 lignes, d’abord les points d’attention, puis 2 ou 3 actions possibles.', brief.facts);
  return { facts: brief.facts, lines: brief.lines, ai: ai };
});

/** Simulation « et si… » : changes = [{ itemId, shiftDays } | { itemId, finish }]. Rien n'est enregistré. */
defineAction('simulations.run', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  if (!Array.isArray(p.changes) || !p.changes.length || p.changes.length > 20) {
    throw new PpmError('VALIDATION', 'Indiquez entre 1 et 20 hypothèses de décalage.');
  }
  var data = loadCopilotData_(projectId);
  var r = runSimulation_(data, projectId, p.changes);
  if (p.explain) {
    r.ai = runAi_(ctx, projectId, 'simulation',
      'Explique au chef de projet les conséquences de cette hypothèse en 4 à 6 lignes : ce qui bouge, ce qui est menacé, ce qu’il pourrait faire.',
      { hypotheses: r.changes, resultat: { fin_du_plan: r.plan_end, elements_decales: r.moved, jalons_menaces: r.newly_threatened, autres_projets: r.external_impacts, nouveaux_critiques: r.newly_critical } });
  }
  return r;
});

/** Question en langage naturel : le modèle consulte les données par des fonctions en lecture seule. */
defineAction('copilot.ask', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var question = String(p.question || '').trim();
  if (!question) throw new PpmError('VALIDATION', 'Posez une question.');
  if (question.length > 1000) throw new PpmError('VALIDATION', 'Question trop longue (1 000 caractères au plus).');
  var data = loadCopilotData_(projectId);
  var brief = buildProjectBrief(data, projectId, todayStr(), data.holFor);
  var tools = copilotTools_(data, projectId, brief);
  if (aiMode_() === 'manual' && !AI_PROVIDER) {
    var items = tools.handlers.list_items({ filter: 'all' });
    return runAi_(ctx, projectId, 'question', question, brief.facts, { extra: 'Livrables et jalons (JSON) :\n' + JSON.stringify(items) });
  }
  return runAi_(ctx, projectId, 'question', question, { projet: brief.facts.project, aujourd_hui: brief.facts.today }, { tools: tools });
});

/** Avis de l'utilisateur sur une réponse du copilote (mesure de la pertinence). */
defineAction('copilot.feedback', function (p, ctx) {
  var id = requireParam(p, 'logId');
  var t = getTable('AiLog');
  var n = t.findRow(id);
  if (!n) throw new PpmError('NOT_FOUND', 'Échange introuvable.');
  var rec = t.readRow(n);
  if (rec.actor !== ctx.email) throw new PpmError('FORBIDDEN', 'Seul l’auteur de la demande donne son avis.');
  t.writeRow(n, Object.assign(rec, { feedback: p.useful ? 'utile' : 'pas utile', feedback_at: nowIso() }));
  return { ok: true };
});

/** Décision sur une suggestion du moteur de règles : Accepté ou Ignoré, avec une note facultative. */
defineAction('insights.decide', function (p, ctx) {
  var ins = mustGet('Insight', requireParam(p, 'id'));
  requireCan(ctx, 'insight.decide', { type: 'project', id: ins.project_id });
  if (['Accepté', 'Ignoré'].indexOf(p.decision) < 0) throw new PpmError('VALIDATION', 'Décision attendue : Accepté ou Ignoré.');
  if (ins.status !== 'Nouveau') throw new PpmError('VALIDATION', 'Cette suggestion a déjà été traitée.');
  return repoUpdate('Insight', ins.id, { status: p.decision, decided_by: ctx.email, decided_at: nowIso(), decision_note: truncate(String(p.note || ''), 500) }, p.version, ctx.actx);
});

/** Suggestions du projet et taux d'acceptation, par règle, plus l'avis sur les réponses de l'IA. */
defineAction('copilot.suggestions', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var all = repoList('Insight', function (x) { return x.project_id === projectId; });
  var order = { Alerte: 0, Vigilance: 1, Info: 2 };
  var pending = all.filter(function (x) { return x.status === 'Nouveau'; })
    .sort(function (a, b) { return (order[a.severity] - order[b.severity]) || String(a.message).localeCompare(String(b.message)); });
  var byRule = {};
  all.forEach(function (x) {
    var r = byRule[x.rule_code] = byRule[x.rule_code] || { rule: x.rule_code, pending: 0, accepted: 0, ignored: 0 };
    if (x.status === 'Nouveau') r.pending++; else if (x.status === 'Accepté') r.accepted++; else r.ignored++;
  });
  var logs = repoList('AiLog', function (l) { return l.project_id === projectId && l.mode === 'api'; });
  var decided = all.filter(function (x) { return x.status !== 'Nouveau'; });
  return {
    canDecide: can(ctx, 'insight.decide', { type: 'project', id: projectId }),
    pending: pending.map(function (x) { return { id: x.id, version: x.version, rule: x.rule_code, severity: x.severity, message: x.message, suggestion: x.suggestion, target_type: x.target_type, target_id: x.target_id }; }),
    recent: decided.sort(function (a, b) { return String(b.decided_at || b.updated_at).localeCompare(String(a.decided_at || a.updated_at)); }).slice(0, 20)
      .map(function (x) { return { rule: x.rule_code, message: x.message, status: x.status, decided_by: x.decided_by || x.updated_by, decided_at: x.decided_at || x.updated_at, note: x.decision_note || '' }; }),
    stats: {
      rules: Object.keys(byRule).sort().map(function (k) { return byRule[k]; }),
      accept_rate: decided.length ? Math.round(100 * decided.filter(function (x) { return x.status === 'Accepté'; }).length / decided.length) : null,
      ai_answers: logs.length, ai_useful: logs.filter(function (l) { return l.feedback === 'utile'; }).length,
      ai_not_useful: logs.filter(function (l) { return l.feedback === 'pas utile'; }).length
    }
  };
});

// ======================================================================
// 39_Account.gs
// ======================================================================

/**
 * PPM Core — 0.6.0 : « Mon compte » et « Administration ».
 *
 * Mon compte (tout utilisateur) : sa fiche (fonction, organisation), ses rôles en lecture seule, ses notifications,
 * ses choix d'affichage (thème, page d'accueil). La modification de la fiche passe par resources.update (mêmes droits).
 *
 * Administration (administrateurs seulement, propriété PPM_ADMINS) : réglages jusque-là cachés dans les propriétés
 * du script, état de santé, jours fériés, journaux. Garde-fous :
 *   - la clé Gemini se saisit mais ne se relit jamais (on sait seulement qu'elle existe) ;
 *   - on ne peut pas se retirer soi-même de la liste des administrateurs (jamais d'outil sans administrateur) ;
 *   - toute valeur est validée avant d'être écrite ; chaque réglage modifié est tracé (journal, sans la valeur des secrets).
 * Le manifeste et le déploiement restent dans l'éditeur Apps Script.
 */

var HOME_VIEWS = ['gantt', 'structure', 'suivi', 'copilote'];
var ADMIN_EMAIL_RE_ = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
var TRIGGER_LIST = null; // tests : () => [noms des fonctions déclenchées]

function requireAdmin_(ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Réservé aux administrateurs de l’outil.');
}

// ---------------------------------------------------------------- Mon compte

defineAction('account.get', function (p, ctx) {
  var data = { programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage') };
  var res = ctx.resourceId ? repoGet('Resource', ctx.resourceId) : null;
  var teams = indexBy_(repoList('HierarchicalTeam'));
  var row = userSettingRow_(ctx.email);
  var roles = (ctx.assignments || []).map(function (a) {
    return {
      role_code: a.role_code, role_label: ROLE_LABELS[a.role_code] || a.role_code, rank: ROLE_RANK[a.role_code],
      scope_type: a.scope_type, scope_id: a.scope_id, scope_label: scopeLabel_(data, a.scope_type, a.scope_id),
      since: a.start_date || '', until: a.end_date || ''
    };
  }).filter(function (r) { return r.scope_label; }).reduce(function (acc, r) {
    var k = r.role_code + '|' + r.scope_type + '|' + r.scope_id;
    var i = acc.index[k];
    if (i === undefined) { acc.index[k] = acc.list.length; acc.list.push(r); }
    else if (r.since && (!acc.list[i].since || r.since < acc.list[i].since)) acc.list[i].since = r.since;
    return acc;
  }, { list: [], index: {} }).list.sort(function (a, b) {
    return (a.rank - b.rank) || String(a.scope_label).localeCompare(String(b.scope_label), 'fr');
  });
  return {
    email: ctx.email, isAdmin: ctx.isAdmin,
    person: res ? personCard_(res, teams, ctx, false) : null,
    roles: roles,
    settings: Object.assign({ notify_frequency: (row && row.notify_frequency) || 'Quotidien', calendar_invites: !!(row && isTrue(row.calendar_invites)) }, reminderSettingsView_(row)),
    ui: loadPrefs_(ctx.email).ui
  };
});

// ---------------------------------------------------------------- Administration : réglages

function adminView_() {
  return {
    admins: adminEmails(), domain: allowedDomain(),
    ai_mode: aiMode_(), ai_model: getProp(PROP.GEMINI_MODEL, ''), ai_quota: aiQuota_(),
    gemini_key_set: !!getProp(PROP.GEMINI_KEY, ''),
    reminder_on: reminderDefaults_().on, reminder_days: reminderDefaults_().days,
    appsheet_url: getProp(PROP.APPSHEET_URL, ''), logo_url: getProp(PROP.LOGO_URL, ''),
    projects_folder_id: getProp(PROP.PROJECTS_FOLDER, ''),
    backup_folder_id: getProp(PROP.BACKUP_FOLDER, ''), webapp_url: getProp(PROP.WEBAPP_URL, '')
  };
}

function checkHttpsUrl_(label, value) {
  var s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return '';
  if (s.length > 500 || !/^https:\/\/[^\s"'<>\\]+$/.test(s)) {
    throw new PpmError('VALIDATION', label + ' : une adresse https:// valide est attendue (sans espace ni guillemet).');
  }
  return s;
}

/**
 * Valide un lot de réglages et calcule ce qui changerait, sans rien écrire.
 * cur : adminView_() ; actor : adresse de l'administrateur qui modifie.
 * Renvoie { props: { CLÉ_PROPRIÉTÉ: valeur | null (= supprimer) }, audit: [{ field, old, new }] }.
 */
function validateAdminSettings_(v, cur, actor) {
  v = v || {};
  var props = {}, audit = [];
  var change = function (field, propKey, oldVal, newVal, shown) {
    if (String(oldVal) === String(newVal === null ? '' : newVal)) return;
    props[propKey] = newVal === null ? null : String(newVal);
    audit.push({ field: field, old: shown ? shown[0] : String(oldVal), new: shown ? shown[1] : String(newVal === null ? '' : newVal) });
  };

  if (v.admins !== undefined) {
    var raw = Array.isArray(v.admins) ? v.admins : String(v.admins).split(/[\s,;]+/);
    var seen = {}, list = [];
    raw.forEach(function (m) {
      m = String(m).trim().toLowerCase();
      if (m && !seen[m]) { seen[m] = true; list.push(m); }
    });
    if (!list.length) throw new PpmError('VALIDATION', 'Il faut au moins un administrateur.');
    if (list.length > 10) throw new PpmError('VALIDATION', 'Dix administrateurs au plus.');
    list.forEach(function (m) {
      if (!ADMIN_EMAIL_RE_.test(m)) throw new PpmError('VALIDATION', 'Adresse invalide : ' + m);
      if (cur.domain && m.split('@')[1] !== cur.domain) throw new PpmError('VALIDATION', 'Adresse hors du domaine ' + cur.domain + ' : ' + m);
    });
    if (list.indexOf(actor) < 0) {
      throw new PpmError('VALIDATION', 'Vous ne pouvez pas vous retirer vous-même des administrateurs : demandez à un autre administrateur de le faire.');
    }
    change('admins', PROP.ADMINS, cur.admins.join(','), list.join(','));
  }

  var mode = v.ai_mode !== undefined ? String(v.ai_mode) : cur.ai_mode;
  var model = v.ai_model !== undefined ? String(v.ai_model).trim() : cur.ai_model;
  var keySet = cur.gemini_key_set;
  if (['off', 'manual', 'api'].indexOf(mode) < 0) throw new PpmError('VALIDATION', 'Mode du copilote inconnu : off, manual ou api.');
  if (model && !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new PpmError('VALIDATION', 'Nom de modèle invalide (lettres, chiffres, point, tiret, deux-points).');
  if (v.clear_gemini_key && !isBlank(v.gemini_key)) throw new PpmError('VALIDATION', 'Remplacer et supprimer la clé en même temps n’a pas de sens.');
  if (v.clear_gemini_key) {
    if (keySet) change('gemini_key', PROP.GEMINI_KEY, 'définie', null, ['définie', 'supprimée']);
    keySet = false;
  }
  if (!isBlank(v.gemini_key)) {
    var k = String(v.gemini_key).trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(k)) throw new PpmError('VALIDATION', 'Clé Gemini invalide : 20 à 200 caractères, lettres, chiffres, tiret ou souligné.');
    props[PROP.GEMINI_KEY] = k;
    audit.push({ field: 'gemini_key', old: keySet ? 'définie' : 'aucune', new: 'remplacée' });
    keySet = true;
  }
  if (mode === 'api' && (!keySet || !model)) {
    throw new PpmError('VALIDATION', 'Le mode « api » demande une clé Gemini et le nom du modèle (à n’activer qu’avec l’accord de la DSI).');
  }
  change('ai_mode', PROP.AI_MODE, cur.ai_mode, mode);
  change('ai_model', PROP.GEMINI_MODEL, cur.ai_model, model);
  if (v.ai_quota !== undefined) {
    var q = Number(v.ai_quota);
    if (!(q >= 1 && q <= 500) || Math.floor(q) !== q) throw new PpmError('VALIDATION', 'Quota : un nombre entier de 1 à 500 demandes par personne et par jour.');
    change('ai_quota', PROP.AI_QUOTA, cur.ai_quota, q);
  }
  if (v.reminder_on !== undefined) change('reminder_on', PROP.REMINDER_ON, cur.reminder_on ? 'oui' : 'non', v.reminder_on ? 'oui' : 'non');
  if (v.reminder_days !== undefined) {
    var rd = Number(v.reminder_days);
    if (isBlank(v.reminder_days) || isNaN(rd) || Math.floor(rd) !== rd || rd < 1 || rd > 60) throw new PpmError('VALIDATION', 'Délai du rappel : un nombre entier de jours ouvrés entre 1 et 60.');
    change('reminder_days', PROP.REMINDER_DAYS, cur.reminder_days, rd);
  }
  if (v.appsheet_url !== undefined) change('appsheet_url', PROP.APPSHEET_URL, cur.appsheet_url, checkHttpsUrl_('Adresse AppSheet', v.appsheet_url));
  if (v.logo_url !== undefined) change('logo_url', PROP.LOGO_URL, cur.logo_url, checkHttpsUrl_('Adresse du logo', v.logo_url));
  if (v.projects_folder_id !== undefined) {
    var f = String(v.projects_folder_id).trim();
    if (f && !/^[A-Za-z0-9_-]{10,80}$/.test(f)) throw new PpmError('VALIDATION', 'Identifiant de dossier invalide (le texte qui suit /folders/ dans l’adresse du dossier Drive).');
    change('projects_folder_id', PROP.PROJECTS_FOLDER, cur.projects_folder_id, f);
  }
  // Une valeur vidée supprime la propriété plutôt que d'en garder une vide.
  Object.keys(props).forEach(function (k2) { if (props[k2] === '' && k2 !== PROP.GEMINI_KEY) props[k2] = null; });
  return { props: props, audit: audit };
}

function applyAdminSettings_(result) {
  Object.keys(result.props).forEach(function (k) {
    if (result.props[k] === null) deleteProp(k); else setProp(k, result.props[k]);
  });
}

defineAction('admin.get', function (p, ctx) {
  requireAdmin_(ctx);
  return adminView_();
});

defineAction('admin.set', function (p, ctx) {
  requireAdmin_(ctx);
  var r = validateAdminSettings_(p.values, adminView_(), ctx.email);
  applyAdminSettings_(r);
  var at = nowIso();
  repoAppendHistory('ChangeEvent', r.audit.map(function (a) {
    return { id: newId(), at: at, table_name: 'Réglages', entity_id: 'PPM', project_id: '', field: a.field, old_value: a.old, new_value: a.new,
      actor: ctx.actx.actor, source: ctx.actx.source, acknowledged: true, acknowledged_by: '', acknowledged_at: '' };
  }));
  var out = adminView_();
  out.changed = r.audit.map(function (a) { return a.field; });
  return out;
});

// ---------------------------------------------------------------- Administration : santé

/** Fonctions déclenchées par les déclencheurs du projet ; null si la liste est indisponible (hors Apps Script). */
function listTriggers_() {
  if (TRIGGER_LIST) return TRIGGER_LIST();
  if (typeof ScriptApp === 'undefined') return null;
  try {
    return ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  } catch (e) {
    return null;
  }
}

defineAction('admin.health', function (p, ctx) {
  requireAdmin_(ctx);
  var checks = checkInstall_();
  var handlers = listTriggers_();
  var triggers = null;
  if (handlers) {
    triggers = { nightlyRun: 0, sendDigests: 0, continueNightly: 0 };
    handlers.forEach(function (h) { if (h in triggers) triggers[h]++; });
    if (!triggers.nightlyRun) checks.push('Déclencheur nocturne absent : exécuter installTriggers.');
    if (!triggers.sendDigests) checks.push('Déclencheur du récapitulatif de 7 h absent : exécuter installTriggers.');
    if (triggers.nightlyRun > 1 || triggers.sendDigests > 1) checks.push('Déclencheurs en double : relancer installTriggers (il les recrée proprement).');
  }
  var today = todayStr();
  var night = parseJsonSafe(getProp(PROP.LAST_NIGHTLY, ''), null);
  if (night && !night.ok) checks.push('Le dernier traitement nocturne a échoué à l’étape « ' + (night.failedStep || '?') + ' » : ' + (night.error || ''));
  var digest = parseJsonSafe(getProp(PROP.LAST_DIGEST, ''), null);
  var running = parseJsonSafe(getProp(PROP.JOB_STATE, ''), null);
  return {
    version: PPM_VERSION, apiVersion: PPM_API_VERSION, today: today,
    checks: checks, ok: !checks.length,
    night: night, running: running ? { step: NIGHTLY_STEPS[running.step] || '', startedAt: running.startedAt || '' } : null,
    digest: digest, triggers: triggers,
    mail_quota: typeof MailApp !== 'undefined' ? MailApp.getRemainingDailyQuota() : null,
    ai: { mode: aiMode_(), used_today: repoList('AiLog', function (l) { return l.mode === 'api' && String(l.at).slice(0, 10) === today; }).length, per_person_limit: aiQuota_() },
    cache: !!scriptCache_(),
    counts: {
      programs: repoList('Program').length, projects: repoList('Project').length, items: repoList('PlanItem').length,
      people: repoList('Resource').length, administrators: adminEmails().length
    }
  };
});

// ---------------------------------------------------------------- Administration : journaux

defineAction('admin.logs', function (p, ctx) {
  requireAdmin_(ctx);
  var limit = Math.max(10, Math.min(200, Math.floor(Number(p.limit)) || 60));
  var names = feedNames_();
  var projects = indexBy_(repoList('Project', null, { includeDeleted: true }));
  var label = function (e) {
    if (e.table_name === 'PlanItem') return names.item[e.entity_id] || 'Élément';
    if (e.table_name === 'WorkPackage') return names.wp[e.entity_id] ? 'WP ' + names.wp[e.entity_id] : 'WP';
    if (e.table_name === 'Resource') return names.resource[e.entity_id] || 'Personne';
    if (e.table_name === 'Project') return projects[e.entity_id] ? projects[e.entity_id].code : 'Projet';
    return e.table_name === 'Réglages' ? 'Réglages de l’outil' : e.table_name;
  };
  var byRecent = function (a, b) { return String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)); };
  var changes = repoList('ChangeEvent').sort(byRecent).slice(0, limit).map(function (e) {
    return { at: e.at, actor: e.actor, source: e.source, what: label(e), table: e.table_name, field: e.field,
      old_value: truncate(e.old_value, 120), new_value: truncate(e.new_value, 120) };
  });
  var ai = repoList('AiLog').sort(byRecent).slice(0, Math.min(limit, 50)).map(function (l) {
    return { at: l.at, actor: l.actor, purpose: l.purpose, mode: l.mode, unverified: l.unverified || '', feedback: l.feedback || '', excerpt: truncate(l.response, 160) };
  });
  return { changes: changes, ai: ai };
});

// ---------------------------------------------------------------- Administration : jours fériés

function holidaySetView_(h) {
  var dates = parseJsonSafe(h.dates_json, []).map(function (d) { return typeof d === 'string' ? { date: d, name: '' } : { date: d.date, name: d.name || '' }; });
  return { id: h.id, country: h.country, year: Number(h.year), label: h.label || '', count: dates.length, dates: dates, version: h.version };
}

function holidayList_() {
  return repoList('HolidaySet').map(holidaySetView_).sort(function (a, b) {
    return String(a.country).localeCompare(String(b.country)) || (a.year - b.year);
  });
}

defineAction('admin.holidays', function (p, ctx) {
  requireAdmin_(ctx);
  return { sets: holidayList_(), countries: COUNTRIES };
});

defineAction('admin.holidays.seed', function (p, ctx) {
  requireAdmin_(ctx);
  var years = (Array.isArray(p.years) ? p.years : []).map(Number);
  if (!years.length || years.length > 6 || years.some(function (y) { return !(y >= 2020 && y <= 2045) || Math.floor(y) !== y; })) {
    throw new PpmError('VALIDATION', 'Indiquez de 1 à 6 années entre 2020 et 2045.');
  }
  seedHolidays_(years);
  return { sets: holidayList_(), countries: COUNTRIES };
});

/** Remplace les dates d'un jeu de fériés (ajustement par site). dates : [{ date: 'AAAA-MM-JJ', name }]. */
defineAction('admin.holidays.set', function (p, ctx) {
  requireAdmin_(ctx);
  var set = mustGet('HolidaySet', requireParam(p, 'id'));
  var seen = {}, out = [];
  (Array.isArray(p.dates) ? p.dates : []).forEach(function (d) {
    var date = String(d && d.date !== undefined ? d.date : d).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    var real = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || real.getUTCFullYear() !== +m[1] || real.getUTCMonth() !== +m[2] - 1 || real.getUTCDate() !== +m[3]) {
      throw new PpmError('VALIDATION', 'Date invalide : « ' + date + ' » (format AAAA-MM-JJ).');
    }
    if (+m[1] !== Number(set.year)) throw new PpmError('VALIDATION', 'Ce jeu concerne ' + set.year + ' : « ' + date + ' » est d’une autre année.');
    if (seen[date]) return;
    seen[date] = true;
    out.push({ date: date, name: truncate(String((d && d.name) || ''), 60) });
  });
  if (out.length > 40) throw new PpmError('VALIDATION', 'Quarante jours fériés au plus par année.');
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var rec = repoUpdate('HolidaySet', set.id, { dates_json: JSON.stringify(out) }, p.version, ctx.actx);
  return holidaySetView_(rec);
});

// ======================================================================
// 40_Jobs.gs
// ======================================================================

/**
 * PPM Core — traitements planifiés (section 3, mesures de conception).
 *
 * Chaque nuit : réconciliation du journal, contrôles du moteur de règles, synchronisation
 * Agenda et Drive, compléments depuis l'annuaire, sauvegarde des classeurs.
 * Chaque matin de semaine (7 h) : mail récapitulatif (36_Digest.gs). Chaque étape s'exécute par tranches de 5 minutes
 * au plus (plafond Apps Script : 6 min) ; l'état est gardé dans les propriétés
 * du script et une tranche suivante est programmée une minute plus tard.
 * Un seul déclencheur de reprise existe à la fois (plafond : 20 déclencheurs).
 */

var NIGHTLY_STEPS = ['reconcile', 'rules', 'workspace', 'directory', 'backup'];
var BACKUP_RETENTION_DAYS = 30;
var JOB_ACTX = { actor: 'ppm-core', source: 'core' };

/** À exécuter une fois après setupPpm() : traitement nocturne (2 h) et récapitulatif du matin (7 h). */
function installTriggers() {
  deleteTriggers_('nightlyRun');
  deleteTriggers_('continueNightly');
  deleteTriggers_('sendDigests');
  ScriptApp.newTrigger('nightlyRun').timeBased().atHour(2).everyDays(1).create();
  ScriptApp.newTrigger('sendDigests').timeBased().atHour(7).everyDays(1).create();
  return 'Déclencheurs installés : traitement nocturne à 2 h, récapitulatif à 7 h (fuseau du script).';
}

function deleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

function nightlyRun() {
  resetExecution_();
  invalidateAllTables_(); // la nuit repart de ce qui est réellement dans les feuilles
  setProp(PROP.JOB_STATE, JSON.stringify({ step: 0, startedAt: nowIso() }));
  continueNightly();
}

function continueNightly() {
  resetExecution_();
  if (typeof ScriptApp !== 'undefined') deleteTriggers_('continueNightly');
  var state = parseJsonSafe(getProp(PROP.JOB_STATE, ''), null);
  if (!state) return 'Aucun traitement en cours.';
  var deadline = nowMs() + JOB_SLICE_MS - 30000;
  try {
    state.times = state.times || {};
    while (state.step < NIGHTLY_STEPS.length) {
      var stepName = NIGHTLY_STEPS[state.step], t0 = nowMs();
      var done = runNightlyStep(stepName, state, deadline);
      state.times[stepName] = (state.times[stepName] || 0) + (nowMs() - t0);
      if (!done) {
        setProp(PROP.JOB_STATE, JSON.stringify(state));
        if (typeof ScriptApp !== 'undefined') {
          ScriptApp.newTrigger('continueNightly').timeBased().after(60 * 1000).create();
        }
        return 'Tranche terminée, reprise programmée (étape ' + NIGHTLY_STEPS[state.step] + ').';
      }
      state.step++;
      state.cursor = null;
    }
    recordNightly_(state, true, '', '');
    deleteProp(PROP.JOB_STATE);
    return 'Traitement nocturne terminé.';
  } catch (err) {
    recordNightly_(state, false, NIGHTLY_STEPS[state.step], err && err.message ? err.message : err);
    deleteProp(PROP.JOB_STATE);
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Échec du traitement nocturne', String(err && err.stack ? err.stack : err));
    });
    throw err;
  }
}

/** Garde le résultat du dernier traitement de nuit (affiché par la page Administration). */
function recordNightly_(state, ok, failedStep, error) {
  setProp(PROP.LAST_NIGHTLY, JSON.stringify({
    startedAt: state.startedAt || '', endedAt: nowIso(), ok: ok, failedStep: failedStep || '',
    error: error ? truncate(String(error), 300) : '',
    steps: NIGHTLY_STEPS.map(function (n) { return { name: n, ms: (state.times || {})[n] || 0 }; })
  }));
}

function runNightlyStep(name, state, deadline) {
  switch (name) {
    case 'reconcile':
      state.cursor = state.cursor || {};
      return reconcileAll(state.cursor, deadline);
    case 'rules':
      runRules();
      return true;
    case 'workspace':
      state.cursor = state.cursor || {};
      return syncWorkspaceAll(state.cursor, deadline);
    case 'directory':
      refreshPeopleFromDirectory();
      return true;
    case 'backup':
      if (typeof DriveApp !== 'undefined') backupBooks_();
      return true;
    default:
      return true;
  }
}

/** Exécute le moteur de règles et réécrit les Insights (les décisions « Accepté/Ignoré » sont conservées). */
function runRules() {
  var data = {
    projects: repoList('Project'),
    workpackages: repoList('WorkPackage'),
    planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'),
    requirements: repoList('MilestoneRequirement'),
    risks: repoList('RiskOpportunity'),
    progressUpdates: repoList('ProgressUpdate', function (u) { return String(u.declared_at || u.created_at || '') >= addCalendarDays(todayStr(), -THRESHOLDS.staleProgressDays); })
  };
  var countryOf = {};
  data.projects.forEach(function (p) { countryOf[p.id] = p.holiday_country || 'FR'; });
  var holCache = {};
  var holFor = function (projectId) {
    var c = countryOf[projectId] || 'FR';
    if (!holCache[c]) holCache[c] = loadHolidayMap(c);
    return holCache[c];
  };
  addBaselineContext_(data, holFor);
  data.poFindings = poFindings_(poRuleInputs_(), todayStr());
  var fresh = evaluateRules(data, todayStr(), holFor);
  var merged = mergeInsights(repoList('Insight', null, { includeDeleted: true }), fresh, JOB_ACTX.actor);
  withLock(function () { getTable('Insight').replaceAll(merged); });
  return fresh.length;
}

/** Dates figées de la baseline active et chemin critique, pour la règle de glissement critique. */
function addBaselineContext_(data, holFor) {
  var active = {};
  data.projects.forEach(function (p) {
    if (!isTrue(p.deleted) && !isBlank(p.active_baseline_id) && p.status !== 'Clos') active[p.active_baseline_id] = p.id;
  });
  data.baselineFinish = {};
  data.critical = {};
  if (!Object.keys(active).length) return;
  repoList('BaselineItem', function (r) { return active[r.baseline_id] && r.entity_type === 'PlanItem'; }).forEach(function (r) {
    var s = parseJsonSafe(r.snapshot_json, {});
    if (!isBlank(s.planned_finish)) data.baselineFinish[r.entity_id] = s.planned_finish;
  });
  Object.keys(active).forEach(function (bid) {
    var pid = active[bid];
    var items = data.planitems.filter(function (i) { return i.project_id === pid && !isTrue(i.deleted); });
    var ids = {};
    items.forEach(function (i) { ids[i.id] = true; });
    var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; });
    computeFloats(items, deps, holFor).criticalIds.forEach(function (id) { data.critical[id] = true; });
  });
}

function backupBooks_() {
  var folderId = getProp(PROP.BACKUP_FOLDER, '');
  var folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.createFolder('PPM Sauvegardes');
    setProp(PROP.BACKUP_FOLDER, folder.getId());
  }
  var stamp = todayStr();
  [PROP.DATA_ID, PROP.HISTORY_ID].forEach(function (k) {
    var file = DriveApp.getFileById(getProp(k, ''));
    file.makeCopy(file.getName() + ' — ' + stamp, folder);
  });
  var limit = nowMs() - BACKUP_RETENTION_DAYS * DAY_MS;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < limit) f.setTrashed(true);
  }
}

// ======================================================================
// 41_Edit.gs
// ======================================================================

/**
 * PPM Core — 0.7.0 : création et édition du WBS depuis les pages (workpackages, sous-workpackages, livrables, jalons).
 *
 * Les actions génériques (workpackages.*, planitems.*) restent disponibles pour l'API ; les pages passent par ces trois
 * actions, qui ajoutent ce qu'un écran exige :
 *   - numérotation automatique des codes WBS (3, puis 3.1, 3.2…), unicité dans le projet ;
 *   - deux niveaux de workpackage au plus, jamais de boucle, tout rattachement dans le même projet ;
 *   - dates contrôlées (la fin ne précède pas le début ; un jalon n'a qu'une date) ;
 *   - suppression sans orphelin : un workpackage non vide ne se supprime qu'avec son contenu (cascade explicite), et la
 *     suppression d'un élément retire aussi ses dépendances et ses exigences de jalon.
 * Les droits sont ceux de wbs.edit sur le périmètre concerné (et sur la destination d'un déplacement).
 * Rien n'est supprimé pour de bon : les lignes sont marquées supprimées et restent dans le journal.
 */

var WBS_NAME_MAX = 120;
var WBS_KINDS = ['wp', 'Livrable', 'Jalon'];
var MILESTONE_CATEGORIES = ['Revue', 'Client', 'Interne'];

function wbsName_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le nom est obligatoire.');
  if (s.length > WBS_NAME_MAX) throw new PpmError('VALIDATION', 'Le nom est limité à ' + WBS_NAME_MAX + ' caractères.');
  return s;
}

function wbsShortText_(v, max, label) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new PpmError('VALIDATION', label + ' : ' + max + ' caractères au plus.');
  return s;
}

function wbsOwner_(id) {
  if (isBlank(id)) return '';
  var r = repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Responsable introuvable : la personne a peut-être été supprimée.');
  return String(id);
}

function wbsDate_(v, label) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  var d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new PpmError('VALIDATION', label + ' : date invalide « ' + s + ' » (format AAAA-MM-JJ).');
  }
  return s;
}

/** Début et fin d'un élément après contrôle. Un jalon n'a qu'une date (début = fin). */
function wbsDates_(type, start, finish) {
  var s = wbsDate_(start, 'Début'), f = wbsDate_(finish, type === 'Jalon' ? 'Date' : 'Fin');
  if (type === 'Jalon') { var d = f || s; return { planned_start: d, planned_finish: d }; }
  if (s && f && s > f) throw new PpmError('VALIDATION', 'La fin ne peut pas précéder le début.');
  return { planned_start: s, planned_finish: f };
}

function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Prochain code libre : 3 au premier niveau, 3.1 sous le WP 3. wps : workpackages vivants du projet. */
function nextWbsCode_(wps, parent) {
  var parentId = parent ? parent.id : '';
  var siblings = wps.filter(function (w) { return String(w.parent_wp_id || '') === parentId; });
  var prefix = parent && !isBlank(parent.wbs_code) ? String(parent.wbs_code) + '.' : '';
  var re = new RegExp('^' + escapeRe_(prefix) + '(\\d+)$');
  var max = 0;
  siblings.forEach(function (w) { var m = re.exec(String(w.wbs_code || '')); if (m && Number(m[1]) > max) max = Number(m[1]); });
  var used = {};
  wps.forEach(function (w) { if (!isBlank(w.wbs_code)) used[String(w.wbs_code)] = true; });
  var n = max + 1;
  while (used[prefix + n]) n++; // le père sans code, ou un code libre déjà pris ailleurs
  return prefix + n;
}

function checkWbsCode_(wps, code, exceptId) {
  var c = wbsShortText_(code, 20, 'Code WBS');
  if (c && wps.some(function (w) { return w.id !== exceptId && String(w.wbs_code || '') === c; })) {
    throw new PpmError('VALIDATION', 'Le code WBS « ' + c + ' » est déjà utilisé dans ce projet.');
  }
  return c;
}

function projectWps_(projectId) {
  return repoList('WorkPackage', function (w) { return w.project_id === projectId; });
}

/** Parent d'un workpackage : premier niveau uniquement, même projet, pas lui-même. Renvoie le WP parent ou null (racine). */
function wbsParentWp_(parentId, projectId, selfId) {
  if (isBlank(parentId)) return null;
  var parent = mustGet('WorkPackage', parentId);
  if (parent.project_id !== projectId) throw new PpmError('VALIDATION', 'Le workpackage parent appartient à un autre projet.');
  if (selfId && parent.id === selfId) throw new PpmError('VALIDATION', 'Un workpackage ne peut pas être son propre parent.');
  if (!isBlank(parent.parent_wp_id)) throw new PpmError('VALIDATION', 'Le WBS est limité à deux niveaux de workpackages.');
  return parent;
}

function wbsScope_(kindOrType, id) { return { type: kindOrType, id: id }; }

// ---------------------------------------------------------------- création

defineAction('wbs.create', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var kind = requireParam(p, 'kind');
  if (WBS_KINDS.indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp, Livrable ou Jalon.');
  var v = p.values || {};
  mustGet('Project', projectId);
  var parentId = p.parentId || '';
  return withLock(function () {
    var name = wbsName_(v.name);
    var owner = wbsOwner_(v.owner_resource_id);
    var parent = null;
    if (kind === 'wp') {
      parent = wbsParentWp_(parentId, projectId, '');
      requireCan(ctx, 'wbs.edit', parent ? wbsScope_('workpackage', parent.id) : wbsScope_('project', projectId));
      var wps = projectWps_(projectId);
      var code = isBlank(v.wbs_code) ? nextWbsCode_(wps, parent) : checkWbsCode_(wps, v.wbs_code, '');
      var newWp = {
        project_id: projectId, parent_wp_id: parent ? parent.id : '', wbs_code: code, name: name, owner_resource_id: owner,
        charge_code: wbsShortText_(v.charge_code, 40, 'Code d’imputation')
      };
      applyWpCpn_(ctx, { project_id: projectId, parent_wp_id: parent ? parent.id : '', cpn: '', cpn_label: '', id: '' }, v, newWp);
      var rec = repoInsert('WorkPackage', newWp, ctx.actx);
      return { kind: 'wp', id: rec.id, record: rec };
    }
    if (!isBlank(parentId)) {
      parent = mustGet('WorkPackage', parentId);
      if (parent.project_id !== projectId) throw new PpmError('VALIDATION', 'Le workpackage appartient à un autre projet.');
    }
    requireCan(ctx, 'wbs.edit', parent ? wbsScope_('workpackage', parent.id) : wbsScope_('project', projectId));
    var cat = String(v.milestone_category || '');
    if (cat && (kind !== 'Jalon' || MILESTONE_CATEGORIES.indexOf(cat) < 0)) throw new PpmError('VALIDATION', 'Catégorie de jalon inconnue : Revue, Client ou Interne.');
    var dates = wbsDates_(kind, v.planned_start, v.planned_finish);
    var item = repoInsert('PlanItem', {
      project_id: projectId, wp_id: parent ? parent.id : '', item_type: kind, name: name, owner_resource_id: owner,
      planned_start: dates.planned_start, planned_finish: dates.planned_finish, milestone_category: cat,
      status: 'À faire', progress_pct: 0
    }, ctx.actx);
    return { kind: 'item', id: item.id, record: item };
  });
});

// ---------------------------------------------------------------- modification et déplacement

defineAction('wbs.update', function (p, ctx) {
  var kind = requireParam(p, 'kind');
  if (['wp', 'item'].indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp ou item.');
  var id = requireParam(p, 'id');
  var patch = p.patch || {};
  return withLock(function () {
    var out = {};
    if (kind === 'wp') {
      var w = mustGet('WorkPackage', id);
      requireCan(ctx, 'wbs.edit', wbsScope_('workpackage', id));
      var wps = projectWps_(w.project_id);
      if ('name' in patch) out.name = wbsName_(patch.name);
      if ('owner_resource_id' in patch) out.owner_resource_id = wbsOwner_(patch.owner_resource_id);
      if ('charge_code' in patch) out.charge_code = wbsShortText_(patch.charge_code, 40, 'Code d’imputation');
      if ('wbs_code' in patch) out.wbs_code = checkWbsCode_(wps, patch.wbs_code, id);
      applyWpCpn_(ctx, w, patch, out);
      if ('parent_wp_id' in patch && String(patch.parent_wp_id || '') !== String(w.parent_wp_id || '')) {
        var np = wbsParentWp_(patch.parent_wp_id, w.project_id, id);
        if (np && wps.some(function (c) { return c.parent_wp_id === id; })) {
          throw new PpmError('VALIDATION', 'Ce workpackage a des sous-workpackages : il ne peut pas devenir lui-même un sous-niveau (deux niveaux au plus).');
        }
        requireCan(ctx, 'wbs.edit', np ? wbsScope_('workpackage', np.id) : wbsScope_('project', w.project_id));
        out.parent_wp_id = np ? np.id : '';
        // un déplacement renumérote, sauf si un code est imposé
        if (!('wbs_code' in patch)) out.wbs_code = nextWbsCode_(wps.filter(function (x) { return x.id !== id; }), np);
      }
      return { kind: 'wp', id: id, record: repoUpdate('WorkPackage', id, out, p.version, ctx.actx) };
    }
    var it = mustGet('PlanItem', id);
    requireCan(ctx, 'wbs.edit', wbsScope_('planitem', id));
    if ('name' in patch) out.name = wbsName_(patch.name);
    if ('owner_resource_id' in patch) out.owner_resource_id = wbsOwner_(patch.owner_resource_id);
    if ('planned_start' in patch || 'planned_finish' in patch) {
      var d = wbsDates_(it.item_type,
        'planned_start' in patch ? patch.planned_start : it.planned_start, 'planned_finish' in patch ? patch.planned_finish : it.planned_finish);
      out.planned_start = d.planned_start;
      out.planned_finish = d.planned_finish;
    }
    if ('milestone_category' in patch) {
      var cat = String(patch.milestone_category || '');
      if (cat && (it.item_type !== 'Jalon' || MILESTONE_CATEGORIES.indexOf(cat) < 0)) throw new PpmError('VALIDATION', 'Catégorie de jalon inconnue : Revue, Client ou Interne.');
      out.milestone_category = cat;
    }
    if ('wp_id' in patch && String(patch.wp_id || '') !== String(it.wp_id || '')) {
      var dest = null;
      if (!isBlank(patch.wp_id)) {
        dest = mustGet('WorkPackage', patch.wp_id);
        if (dest.project_id !== it.project_id) throw new PpmError('VALIDATION', 'Le workpackage de destination appartient à un autre projet.');
      }
      requireCan(ctx, 'wbs.edit', dest ? wbsScope_('workpackage', dest.id) : wbsScope_('project', it.project_id));
      out.wp_id = dest ? dest.id : '';
    }
    return { kind: 'item', id: id, record: repoUpdate('PlanItem', id, out, p.version, ctx.actx) };
  });
});

// ---------------------------------------------------------------- suppression sans orphelin

/** Retire les dépendances et exigences de jalon qui touchent un élément ; renvoie leur nombre. */
function detachItem_(itemId, actx) {
  var deps = repoList('Dependency', function (d) { return d.predecessor_id === itemId || d.successor_id === itemId; });
  deps.forEach(function (d) { repoSoftDelete('Dependency', d.id, null, actx); });
  var reqs = repoList('MilestoneRequirement', function (r) { return r.milestone_id === itemId || r.deliverable_id === itemId; });
  reqs.forEach(function (r) { repoSoftDelete('MilestoneRequirement', r.id, null, actx); });
  // Budget et répartition des PO du livrable : la ligne de budget et ses mois, le lien de PO (le montant de la PO reste, « non affecté »).
  repoList('BudgetLine', function (l) { return l.deliverable_id === itemId; }).forEach(function (l) {
    repoList('BudgetPhasing', function (x) { return x.budget_line_id === l.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, actx); });
    repoSoftDelete('BudgetLine', l.id, null, actx);
  });
  repoList('PurchaseOrderLink', function (l) { return l.deliverable_id === itemId; }).forEach(function (l) { repoSoftDelete('PurchaseOrderLink', l.id, null, actx); });
  return { dependencies: deps.length, requirements: reqs.length };
}

/** Contenu d'un workpackage : ses sous-workpackages et tous les éléments du niveau et des sous-niveaux. */
function wpContent_(wpId, projectId) {
  var kids = projectWps_(projectId).filter(function (w) { return w.parent_wp_id === wpId; });
  var wpIds = {};
  wpIds[wpId] = true;
  kids.forEach(function (k) { wpIds[k.id] = true; });
  var items = repoList('PlanItem', function (i) { return i.project_id === projectId && wpIds[i.wp_id]; });
  return { wps: kids, items: items };
}

defineAction('wbs.delete', function (p, ctx) {
  var kind = requireParam(p, 'kind');
  if (['wp', 'item'].indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp ou item.');
  var id = requireParam(p, 'id');
  return withLock(function () {
    var res = { kind: kind, id: id, deleted: { wps: 0, items: 0, dependencies: 0, requirements: 0 } };
    var add = function (c) { res.deleted.dependencies += c.dependencies; res.deleted.requirements += c.requirements; };
    if (kind === 'item') {
      mustGet('PlanItem', id);
      requireCan(ctx, 'wbs.edit', wbsScope_('planitem', id));
      add(detachItem_(id, ctx.actx));
      repoSoftDelete('PlanItem', id, p.version, ctx.actx);
      res.deleted.items = 1;
      return res;
    }
    var w = mustGet('WorkPackage', id);
    requireCan(ctx, 'wbs.edit', wbsScope_('workpackage', id));
    var content = wpContent_(id, w.project_id);
    if ((content.wps.length || content.items.length) && !p.cascade) {
      throw new PpmError('VALIDATION', 'Ce workpackage contient ' + content.wps.length + ' sous-workpackage(s) et ' + content.items.length +
        ' élément(s) : déplacez-les, ou confirmez la suppression avec leur contenu.', { rule: 'NOT_EMPTY', wps: content.wps.length, items: content.items.length });
    }
    content.items.forEach(function (i) {
      requireCan(ctx, 'wbs.edit', wbsScope_('planitem', i.id));
      add(detachItem_(i.id, ctx.actx));
      repoSoftDelete('PlanItem', i.id, null, ctx.actx);
      res.deleted.items++;
    });
    content.wps.forEach(function (k) { repoSoftDelete('WorkPackage', k.id, null, ctx.actx); res.deleted.wps++; });
    repoSoftDelete('WorkPackage', id, p.version, ctx.actx);
    res.deleted.wps++;
    return res;
  });
});

// ======================================================================
// 42_Org.gs
// ======================================================================

/**
 * PPM Core — 0.8.0 : dépendances, rôles, personnes et équipes depuis les pages.
 *
 * Complète 41_Edit.gs (WBS) pour que l'outil se passe d'AppSheet :
 *   - deps.item, dependencies.update : les liens d'un élément, avec les candidats possibles (même programme) ;
 *   - roles.options : les rôles et périmètres que l'utilisateur peut attribuer (jamais plus haut que le sien) ;
 *   - people.remove : retrait d'une personne sans laisser de trace bancale (rôles terminés, responsabilités libérées) ;
 *   - teams.* : équipes hiérarchiques, sans boucle, supprimables seulement vides.
 * L'attribution et la fin d'un rôle passent par roles.assign / roles.end (32_Views.gs), les membres d'équipe par resources.update.
 */

var TEAM_NAME_MAX = 80;

// ---------------------------------------------------------------- dépendances

function depItemView_(it, projects, wps) {
  var wp = it.wp_id ? wps[it.wp_id] : null;
  return {
    id: it.id, name: it.name, item_type: it.item_type, project_id: it.project_id,
    project_code: projects[it.project_id] ? projects[it.project_id].code : '', finish: it.planned_finish || '',
    wp: wp ? (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name : ''
  };
}

/** Liens d'un élément (amont et aval) et éléments avec lesquels on peut en créer, dans le même programme. */
defineAction('deps.item', function (p, ctx) {
  var id = requireParam(p, 'itemId');
  var item = mustGet('PlanItem', id);
  var projects = indexBy_(repoList('Project'));
  var wps = indexBy_(repoList('WorkPackage'));
  var items = indexBy_(repoList('PlanItem'));
  var programId = projects[item.project_id] ? projects[item.project_id].program_id : '';
  var preds = [], succs = [], linked = {};
  linked[id] = true;
  repoList('Dependency', function (d) { return d.predecessor_id === id || d.successor_id === id; }).forEach(function (d) {
    var incoming = d.successor_id === id;
    var other = items[incoming ? d.predecessor_id : d.successor_id];
    if (!other) return;
    linked[other.id] = true;
    (incoming ? preds : succs).push({
      id: d.id, version: d.version, dep_type: d.dep_type, lag_days: Number(d.lag_days) || 0,
      other: depItemView_(other, projects, wps), canEdit: can(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id })
    });
  });
  var canEdit = can(ctx, 'wbs.edit', { type: 'planitem', id: id });
  var candidates = [], truncated = false;
  Object.keys(items).forEach(function (k) {
    var o = items[k];
    if (linked[o.id]) return;
    var pr = projects[o.project_id];
    if (!pr || (o.project_id !== item.project_id && (isBlank(programId) || pr.program_id !== programId))) return;
    candidates.push(Object.assign(depItemView_(o, projects, wps), { can_edit: can(ctx, 'wbs.edit', { type: 'planitem', id: o.id }) }));
  });
  candidates.sort(function (a, b) {
    return (Number(b.project_id === item.project_id) - Number(a.project_id === item.project_id)) ||
      String(a.project_code).localeCompare(String(b.project_code), 'fr') || String(a.name).localeCompare(String(b.name), 'fr');
  });
  if (candidates.length > 400) { candidates = candidates.slice(0, 400); truncated = true; }
  return {
    item: depItemView_(item, projects, wps), canEdit: canEdit, predecessors: preds, successors: succs,
    candidates: canEdit || candidates.some(function (c) { return c.can_edit; }) ? candidates : [], truncated: truncated
  };
});

defineAction('dependencies.update', function (p, ctx) {
  var d = mustGet('Dependency', requireParam(p, 'id'));
  requireCan(ctx, 'wbs.edit', { type: 'planitem', id: d.successor_id });
  var patch = p.patch || {}, out = {};
  if ('dep_type' in patch) {
    if (['FS', 'SS', 'FF', 'SF'].indexOf(patch.dep_type) < 0) throw new PpmError('VALIDATION', 'Type de lien inconnu : FS, SS, FF ou SF.');
    out.dep_type = patch.dep_type;
  }
  if ('lag_days' in patch) out.lag_days = checkLag_(patch.lag_days);
  return repoUpdate('Dependency', d.id, out, p.version, ctx.actx);
});

function checkLag_(v) {
  var n = isBlank(v) ? 0 : Number(v);
  if (isNaN(n) || Math.floor(n) !== n || n < -365 || n > 365) throw new PpmError('VALIDATION', 'Décalage : un nombre entier de jours ouvrés entre -365 et 365.');
  return n;
}

// ---------------------------------------------------------------- rôles

/** Ce que l'utilisateur peut attribuer : les périmètres où il a le droit, avec le rang minimal des rôles qu'il peut donner. */
defineAction('roles.options', function (p, ctx) {
  var out = [];
  var projects = indexBy_(repoList('Project'));
  var push = function (type, id, label) {
    var scope = { type: type, id: id };
    if (!can(ctx, 'roles.assign', scope)) return;
    out.push({ type: type, id: id, label: label, min_rank: ctx.isAdmin ? 0 : bestRankOn_(ctx, scope) });
  };
  repoList('Program').forEach(function (g) { push('program', g.id, g.code + ' — ' + g.name); });
  repoList('Project').forEach(function (x) { push('project', x.id, x.code + ' — ' + x.name); });
  repoList('WorkPackage').forEach(function (w) {
    push('workpackage', w.id, (w.wbs_code ? w.wbs_code + ' ' : '') + w.name + ' (' + (projects[w.project_id] ? projects[w.project_id].code : '?') + ')');
  });
  return {
    roles: ROLES.map(function (c) { return { code: c, label: ROLE_LABELS[c] || c, rank: ROLE_RANK[c] }; }),
    scopes: out.slice(0, 600)
  };
});

// ---------------------------------------------------------------- personnes

/**
 * Retire une personne : ses rôles se terminent, elle cesse de diriger une équipe, ses responsabilités sont libérées
 * (les éléments et workpackages qu'elle portait redeviennent « à désigner » et remontent dans les constats).
 * dryRun = true : annonce ce qui se passerait, sans rien changer.
 */
defineAction('people.remove', function (p, ctx) {
  if (!canEditResources_(ctx)) throw new PpmError('FORBIDDEN', 'Seuls un Program Leader, un DPL ou un chef de projet retirent une personne.');
  var id = requireParam(p, 'id');
  var r = mustGet('Resource', id);
  if (ctx.resourceId && ctx.resourceId === id) throw new PpmError('VALIDATION', 'Vous ne pouvez pas retirer votre propre fiche.');
  var today = todayStr();
  var roles = repoList('RoleAssignment', function (a) { return a.resource_id === id && (isBlank(a.end_date) || String(a.end_date) >= today); });
  var teams = repoList('HierarchicalTeam', function (t) { return t.manager_resource_id === id; });
  var wps = repoList('WorkPackage', function (w) { return w.owner_resource_id === id; });
  var items = repoList('PlanItem', function (i) { return i.owner_resource_id === id; });
  var summary = { name: r.name, roles: roles.length, teams: teams.length, wps: wps.length, items: items.length };
  if (p.dryRun) return Object.assign({ dryRun: true }, summary);
  return withLock(function () {
    var yesterday = addCalendarDays(today, -1);
    roles.forEach(function (a) { repoUpdate('RoleAssignment', a.id, { end_date: yesterday }, null, ctx.actx); });
    teams.forEach(function (t) { repoUpdate('HierarchicalTeam', t.id, { manager_resource_id: '' }, null, ctx.actx); });
    wps.forEach(function (w) { repoUpdate('WorkPackage', w.id, { owner_resource_id: '' }, null, ctx.actx); });
    items.forEach(function (i) { repoUpdate('PlanItem', i.id, { owner_resource_id: '' }, null, ctx.actx); });
    repoSoftDelete('Resource', id, p.version, ctx.actx);
    return Object.assign({ dryRun: false }, summary);
  });
});

// ---------------------------------------------------------------- équipes hiérarchiques

function requireTeamEditor_(ctx) {
  if (!canEditResources_(ctx)) throw new PpmError('FORBIDDEN', 'Seuls un Program Leader, un DPL ou un chef de projet gèrent les équipes.');
}

function teamName_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le nom de l’équipe est obligatoire.');
  if (s.length > TEAM_NAME_MAX) throw new PpmError('VALIDATION', 'Le nom de l’équipe est limité à ' + TEAM_NAME_MAX + ' caractères.');
  return s;
}

function teamParent_(parentId, selfId) {
  if (isBlank(parentId)) return '';
  var teams = indexBy_(repoList('HierarchicalTeam'));
  if (!teams[parentId]) throw new PpmError('VALIDATION', 'Équipe parente introuvable.');
  if (selfId) {
    var cur = parentId, guard = 0;
    while (cur && guard++ < 100) {
      if (cur === selfId) throw new PpmError('VALIDATION', 'Une équipe ne peut pas être placée sous elle-même ni sous l’une de ses sous-équipes.');
      cur = teams[cur] && !isBlank(teams[cur].parent_team_id) ? teams[cur].parent_team_id : '';
    }
  }
  return parentId;
}

function teamManager_(id) {
  if (isBlank(id)) return '';
  var r = repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Responsable d’équipe introuvable.');
  return String(id);
}

defineAction('teams.create', function (p, ctx) {
  requireTeamEditor_(ctx);
  var v = p.values || {};
  return repoInsert('HierarchicalTeam', {
    name: teamName_(v.name), parent_team_id: teamParent_(v.parent_team_id, ''), manager_resource_id: teamManager_(v.manager_resource_id),
    cost_center: wbsShortText_(v.cost_center, 40, 'Centre de coût')
  }, ctx.actx);
});

defineAction('teams.update', function (p, ctx) {
  requireTeamEditor_(ctx);
  var id = requireParam(p, 'id');
  mustGet('HierarchicalTeam', id);
  var patch = p.patch || {}, out = {};
  if ('name' in patch) out.name = teamName_(patch.name);
  if ('parent_team_id' in patch) out.parent_team_id = teamParent_(patch.parent_team_id, id);
  if ('manager_resource_id' in patch) out.manager_resource_id = teamManager_(patch.manager_resource_id);
  if ('cost_center' in patch) out.cost_center = wbsShortText_(patch.cost_center, 40, 'Centre de coût');
  return repoUpdate('HierarchicalTeam', id, out, p.version, ctx.actx);
});

/** Une équipe ne se supprime que vide : ni membres, ni sous-équipes (on les déplace d'abord). */
defineAction('teams.delete', function (p, ctx) {
  requireTeamEditor_(ctx);
  var id = requireParam(p, 'id');
  mustGet('HierarchicalTeam', id);
  var members = repoList('Resource', function (r) { return r.team_id === id; }).length;
  var subs = repoList('HierarchicalTeam', function (t) { return t.parent_team_id === id; }).length;
  if (members || subs) {
    throw new PpmError('VALIDATION', 'Cette équipe compte ' + members + ' membre(s) et ' + subs + ' sous-équipe(s) : déplacez-les d’abord.', { rule: 'NOT_EMPTY', members: members, teams: subs });
  }
  return repoSoftDelete('HierarchicalTeam', id, p.version, ctx.actx);
});

// ======================================================================
// 43_Budget.gs
// ======================================================================

/**
 * PPM Core — 0.9.0 : budget, taux, CPN (lot 3, première partie).
 *
 *  - CPN : code financier d'un projet, avec sa désignation. Un workpackage de premier niveau (le « sous-projet »)
 *    peut porter le sien. Un CPN ne couvre qu'un seul projet, au maximum. Les analyses budgétaires se font par CPN.
 *  - Grille de taux (RateCard) : taux journalier par profil et par pays, avec date d'effet. Réservée au chef de projet
 *    et au DPL (décision par défaut, à relâcher si besoin).
 *  - Lignes de budget par livrable : ressource interne = jours × taux (taux FIGÉ à la création de la ligne) ;
 *    ressource externe = forfait. Étalement automatique (interne : au prorata des jours ouvrés de chaque mois ;
 *    externe : en totalité le mois de la livraison), modifiable à la main.
 *  - Bilan par CPN : budget (interne, externe) face aux commandes d'achat engagées (44_Orders.gs).
 * Fonctions de calcul pures : phasingFor_, computeBalance_.
 */

var CPN_RE = /^[A-Z0-9][A-Z0-9 ._\/-]{0,29}$/;

// ---------------------------------------------------------------- CPN

function normCpn_(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase(); }

function checkCpnValue_(v) {
  var c = normCpn_(v);
  if (!c) return '';
  if (!CPN_RE.test(c)) throw new PpmError('VALIDATION', 'CPN invalide : 30 caractères au plus, lettres, chiffres, espace, point, tiret, barre oblique.');
  return c;
}

/** CPN → { project, wp } : le projet (et le workpackage, s'il est porté par un sous-projet) qui l'utilise. */
function cpnIndex_() {
  var idx = {}, projects = repoList('Project'), byId = indexBy_(projects);
  projects.forEach(function (p) { var k = normCpn_(p.cpn); if (k && !idx[k]) idx[k] = { project: p, wp: null }; });
  repoList('WorkPackage').forEach(function (w) {
    var k = normCpn_(w.cpn);
    if (k && !idx[k] && byId[w.project_id]) idx[k] = { project: byId[w.project_id], wp: w };
  });
  return idx;
}

function cpnOwner_(cpn) {
  var k = normCpn_(cpn);
  return k ? cpnIndex_()[k] || null : null;
}

function assertCpnFree_(cpn, projectId) {
  if (!cpn) return;
  var o = cpnIndex_()[cpn];
  if (o && o.project.id !== projectId) {
    throw new PpmError('VALIDATION', 'Le CPN ' + cpn + ' est déjà porté par le projet ' + o.project.code + ' : un CPN ne couvre qu’un seul projet.');
  }
}

/** CPN d'un projet : le sien et ceux de ses sous-projets, sans doublon. */
function projectCpns_(project, wps) {
  var out = [], seen = {};
  var add = function (cpn, label, source) {
    var k = normCpn_(cpn);
    if (!k) return;
    if (!seen[k]) { seen[k] = { cpn: k, label: label || '', sources: [] }; out.push(seen[k]); }
    if (label && !seen[k].label) seen[k].label = label;
    seen[k].sources.push(source);
  };
  add(project.cpn, project.cpn_label, 'Projet');
  wps.forEach(function (w) { add(w.cpn, w.cpn_label, (w.wbs_code ? w.wbs_code + ' ' : '') + w.name); });
  return out;
}

/** Changer ou retirer un CPN est refusé tant que des commandes d'achat s'y rattachent (elles ne seraient plus reliées au projet). */
function assertCpnRemovable_(projectId, oldCpn, remaining) {
  var k = normCpn_(oldCpn);
  if (!k || remaining.indexOf(k) >= 0) return;
  var n = repoList('PurchaseOrder', function (o) { return normCpn_(o.cpn) === k; }).length;
  if (n) throw new PpmError('VALIDATION', n + ' commande(s) d’achat portent le CPN ' + k + ' : supprimez-les ou conservez ce CPN.');
}

defineAction('cpn.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'cpn.edit', { type: 'project', id: project.id });
  var cpn = checkCpnValue_(p.cpn);
  var label = cpn ? wbsShortText_(p.cpn_label, 120, 'Désignation du CPN') : '';
  assertCpnFree_(cpn, project.id);
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var remaining = projectCpns_({ cpn: cpn, cpn_label: label }, wps).map(function (x) { return x.cpn; });
  assertCpnRemovable_(project.id, project.cpn, remaining);
  return repoUpdate('Project', project.id, { cpn: cpn, cpn_label: label }, p.version, ctx.actx);
});

/** Sous-projet : un workpackage de premier niveau porte un CPN (utilisé par wbs.create et wbs.update). */
function applyWpCpn_(ctx, wp, values, out) {
  if (!('cpn' in values) && !('cpn_label' in values)) return;
  var cpn = 'cpn' in values ? checkCpnValue_(values.cpn) : normCpn_(wp.cpn);
  var label = cpn ? ('cpn_label' in values ? wbsShortText_(values.cpn_label, 120, 'Désignation du CPN') : (wp.cpn_label || '')) : '';
  if (cpn === normCpn_(wp.cpn) && label === String(wp.cpn_label || '')) return;
  if (cpn && !isBlank(wp.parent_wp_id)) throw new PpmError('VALIDATION', 'Seul un workpackage de premier niveau (sous-projet) porte un CPN.');
  requireCan(ctx, 'cpn.edit', { type: 'project', id: wp.project_id });
  assertCpnFree_(cpn, wp.project_id);
  var project = mustGet('Project', wp.project_id);
  var others = repoList('WorkPackage', function (w) { return w.project_id === wp.project_id && w.id !== wp.id; });
  var remaining = projectCpns_(project, others).map(function (x) { return x.cpn; });
  if (cpn) remaining.push(cpn);
  assertCpnRemovable_(wp.project_id, wp.cpn, remaining);
  out.cpn = cpn;
  out.cpn_label = label;
}

// ---------------------------------------------------------------- grille de taux

function rateFor_(profile, country, onDate) {
  var p = String(profile || '').toLowerCase().trim();
  var rows = repoList('RateCard', function (r) { return String(r.profile).toLowerCase().trim() === p && r.country === country; })
    .filter(function (r) { return isBlank(r.effective_date) || String(r.effective_date) <= onDate; })
    .sort(function (a, b) { return String(b.effective_date || '').localeCompare(String(a.effective_date || '')); });
  return rows.length ? Number(rows[0].daily_rate) : null;
}

function requireRates_(ctx) {
  if (!ctx.isAdmin && !can(ctx, 'ratecard.manage', { type: 'global' })) throw new PpmError('FORBIDDEN', 'Les taux journaliers sont réservés au chef de projet et au DPL.');
}

defineAction('rates.list', function (p, ctx) {
  requireRates_(ctx);
  var rows = repoList('RateCard').map(function (r) {
    return { id: r.id, version: r.version, profile: r.profile, country: r.country, daily_rate: Number(r.daily_rate), effective_date: r.effective_date || '' };
  }).sort(function (a, b) { return String(a.profile).localeCompare(String(b.profile), 'fr') || String(a.country).localeCompare(String(b.country)) || String(b.effective_date).localeCompare(String(a.effective_date)); });
  var profiles = {};
  rows.forEach(function (r) { profiles[r.profile] = true; });
  repoList('Resource').forEach(function (r) { if (!isBlank(r.rate_profile)) profiles[r.rate_profile] = true; });
  return { rates: rows, profiles: Object.keys(profiles).sort(function (a, b) { return a.localeCompare(b, 'fr'); }), countries: COUNTRIES };
});

defineAction('rates.set', function (p, ctx) {
  requireRates_(ctx);
  var v = p.values || {};
  var profile = wbsShortText_(v.profile, 60, 'Profil');
  if (!profile) throw new PpmError('VALIDATION', 'Le profil est obligatoire.');
  if (COUNTRIES.indexOf(v.country) < 0) throw new PpmError('VALIDATION', 'Pays inconnu : ' + COUNTRIES.join(', ') + '.');
  var rate = Number(v.daily_rate);
  if (isBlank(v.daily_rate) || isNaN(rate) || rate <= 0 || rate > 100000) throw new PpmError('VALIDATION', 'Taux journalier : un nombre positif.');
  var date = wbsDate_(v.effective_date, 'Date d’effet');
  var values = { profile: profile, country: v.country, daily_rate: round2(rate), effective_date: date };
  var dup = repoList('RateCard', function (r) {
    return r.id !== p.id && String(r.profile).toLowerCase() === profile.toLowerCase() && r.country === v.country && String(r.effective_date || '') === date;
  });
  if (dup.length) throw new PpmError('VALIDATION', 'Ce profil a déjà un taux pour ce pays à cette date d’effet : modifiez-le.');
  return isBlank(p.id) ? repoInsert('RateCard', values, ctx.actx) : repoUpdate('RateCard', p.id, values, p.version, ctx.actx);
});

defineAction('rates.delete', function (p, ctx) {
  requireRates_(ctx);
  return repoSoftDelete('RateCard', requireParam(p, 'id'), p.version, ctx.actx);
});

/** Profil tarifaire des personnes internes (réservé à ceux qui gèrent les taux). */
defineAction('rates.people', function (p, ctx) {
  requireRates_(ctx);
  return repoList('Resource').filter(function (r) { return r.resource_type === 'Interne'; }).map(function (r) {
    return { resource_id: r.id, name: r.name, country: r.country || '', rate_profile: r.rate_profile || '', version: r.version };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
});

defineAction('rates.assign', function (p, ctx) {
  requireRates_(ctx);
  var r = mustGet('Resource', requireParam(p, 'resource_id'));
  return repoUpdate('Resource', r.id, { rate_profile: wbsShortText_(p.rate_profile, 60, 'Profil') }, p.version, ctx.actx);
});

// ---------------------------------------------------------------- étalement (fonction pure)

function monthOf_(d) { return String(d).slice(0, 7); }

/** Étalement d'une ligne : [{ month, amount }], somme = montant planifié. hol : jours fériés du calendrier du projet. */
function phasingFor_(line, deliverable, hol) {
  var amount = round2(Number(line.planned_amount) || 0);
  var start = deliverable.planned_start || '', finish = deliverable.planned_finish || '';
  if (!amount || (!start && !finish)) return [];
  if (line.cost_type === 'Forfait' || !start || !finish) return [{ month: monthOf_(finish || start), amount: amount }];
  var counts = {}, total = 0, months = [];
  for (var d = start; d <= finish; d = addCalendarDays(d, 1)) {
    if (!isWorkingDay(d, hol)) continue;
    var m = monthOf_(d);
    if (!counts[m]) { counts[m] = 0; months.push(m); }
    counts[m]++; total++;
  }
  if (!total) return [{ month: monthOf_(finish), amount: amount }];
  var out = [], acc = 0;
  months.forEach(function (m, i) {
    var a = i === months.length - 1 ? round2(amount - acc) : round2(amount * counts[m] / total);
    acc = round2(acc + a);
    out.push({ month: m, amount: a });
  });
  return out;
}

function holidaysOfProject_(projectId) {
  var project = repoGet('Project', projectId);
  return loadHolidayMap((project && project.holiday_country) || 'FR');
}

/** Remplace l'étalement d'une ligne (mode auto : recalculé depuis les dates du livrable). */
function writePhasing_(line, months, actx) {
  repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, actx); });
  months.forEach(function (m) { repoInsert('BudgetPhasing', { budget_line_id: line.id, month: m.month, amount: m.amount }, actx); });
}

function rephaseLine_(line, deliverable, actx) {
  writePhasing_(line, phasingFor_(line, deliverable, holidaysOfProject_(deliverable.project_id)), actx);
}

/** Les dates d'un livrable changent : les lignes en étalement automatique suivent. Ne bloque jamais la saisie. */
function hookRephase(before, rec) {
  try {
    if (rec.item_type !== 'Livrable' || !before) return;
    if (String(before.planned_start || '') === String(rec.planned_start || '') && String(before.planned_finish || '') === String(rec.planned_finish || '')) return;
    var actx = { actor: 'ppm-core', source: 'core' };
    repoList('BudgetLine', function (l) { return l.deliverable_id === rec.id && l.phasing_mode !== 'manuel'; }).forEach(function (l) { rephaseLine_(l, rec, actx); });
  } catch (err) {
    console.error('Étalement : ' + (err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------- lignes de budget

function budgetNumber_(v, label, max) {
  var n = Number(v);
  if (isBlank(v) || isNaN(n) || n < 0 || n > (max || 1e9)) throw new PpmError('VALIDATION', label + ' : un nombre positif ou nul.');
  return n;
}

function lineView_(l, ctx, phasing, resById, projectId) {
  var res = resById[l.resource_id];
  var seeRate = ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'project', id: projectId });
  return {
    id: l.id, version: l.version, deliverable_id: l.deliverable_id,
    resource: { id: l.resource_id, name: res ? res.name : '', type: res ? res.resource_type : '' },
    cost_type: l.cost_type, planned_days: isBlank(l.planned_days) ? null : Number(l.planned_days),
    frozen_rate: seeRate && !isBlank(l.frozen_rate) ? Number(l.frozen_rate) : null,
    fixed_amount: isBlank(l.fixed_amount) ? null : Number(l.fixed_amount), planned_amount: Number(l.planned_amount) || 0,
    phasing_mode: l.phasing_mode === 'manuel' ? 'manuel' : 'auto',
    phasing: (phasing || []).map(function (x) { return { month: x.month, amount: Number(x.amount) || 0 }; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; })
  };
}

defineAction('budget.line.save', function (p, ctx) {
  var v = p.values || {};
  var isUpdate = !isBlank(p.id);
  var line = isUpdate ? mustGet('BudgetLine', p.id) : null;
  var deliverable = mustGet('PlanItem', isUpdate ? line.deliverable_id : requireParam(v, 'deliverable_id'));
  if (deliverable.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'Le budget se rattache à un livrable, pas à un jalon.');
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  return withLock(function () {
    var resId = 'resource_id' in v ? v.resource_id : (line ? line.resource_id : requireParam(v, 'resource_id'));
    var res = repoGet('Resource', resId);
    if (!res || isTrue(res.deleted)) throw new PpmError('VALIDATION', 'Ressource introuvable.');
    if (repoList('BudgetLine', function (l) { return l.deliverable_id === deliverable.id && l.resource_id === resId && (!line || l.id !== line.id); }).length) {
      throw new PpmError('VALIDATION', 'Cette ressource a déjà une ligne sur ce livrable : modifiez-la.');
    }
    var out = { resource_id: resId };
    var resourceChanged = !line || line.resource_id !== resId;
    if (res.resource_type === 'Externe') {
      var amount = budgetNumber_('fixed_amount' in v ? v.fixed_amount : (line ? line.fixed_amount : ''), 'Forfait');
      Object.assign(out, { cost_type: 'Forfait', fixed_amount: round2(amount), planned_days: '', frozen_rate: '', planned_amount: round2(amount) });
    } else {
      var days = budgetNumber_('planned_days' in v ? v.planned_days : (line ? line.planned_days : ''), 'Jours prévus', 100000);
      var rate = line && !resourceChanged && !v.refresh_rate && line.cost_type === 'TJM' ? Number(line.frozen_rate) : null;
      if (rate === null || isNaN(rate)) {
        rate = rateFor_(res.rate_profile, res.country, todayStr());
        if (rate === null) {
          throw new PpmError('VALIDATION', 'Aucun taux journalier pour le profil « ' + (res.rate_profile || 'non renseigné') + ' » (pays ' + (res.country || '?') +
            ') : à renseigner dans l’onglet Taux, réservé au chef de projet et au DPL.');
        }
      }
      Object.assign(out, { cost_type: 'TJM', planned_days: days, frozen_rate: rate, planned_amount: round2(days * rate), fixed_amount: '' });
    }
    var amountChanged = !line || Number(line.planned_amount) !== out.planned_amount;
    if (!line || amountChanged || line.phasing_mode !== 'manuel') out.phasing_mode = 'auto';
    var rec = line ? repoUpdate('BudgetLine', line.id, out, p.version, ctx.actx)
      : repoInsert('BudgetLine', Object.assign({ deliverable_id: deliverable.id }, out), ctx.actx);
    if (out.phasing_mode === 'auto') rephaseLine_(rec, deliverable, ctx.actx);
    var phasing = repoList('BudgetPhasing', function (x) { return x.budget_line_id === rec.id; });
    return lineView_(rec, ctx, phasing, indexBy_([res]), deliverable.project_id);
  });
});

defineAction('budget.line.delete', function (p, ctx) {
  var line = mustGet('BudgetLine', requireParam(p, 'id'));
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: line.deliverable_id });
  return withLock(function () {
    repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, ctx.actx); });
    repoSoftDelete('BudgetLine', line.id, p.version, ctx.actx);
    return { deleted: true };
  });
});

/** Étalement à la main : la somme doit égaler le montant planifié de la ligne. mode = 'auto' revient au calcul. */
defineAction('budget.phasing.set', function (p, ctx) {
  var line = mustGet('BudgetLine', requireParam(p, 'lineId'));
  var deliverable = mustGet('PlanItem', line.deliverable_id);
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  return withLock(function () {
    if (p.mode === 'auto') {
      var rec0 = repoUpdate('BudgetLine', line.id, { phasing_mode: 'auto' }, null, ctx.actx);
      rephaseLine_(rec0, deliverable, ctx.actx);
      return { mode: 'auto', months: repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).map(function (x) { return { month: x.month, amount: Number(x.amount) }; }) };
    }
    var seen = {}, months = [], sum = 0;
    (Array.isArray(p.months) ? p.months : []).forEach(function (m) {
      var month = String(m && m.month || '').trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PpmError('VALIDATION', 'Mois invalide : « ' + month + ' » (format AAAA-MM).');
      if (seen[month]) throw new PpmError('VALIDATION', 'Le mois ' + month + ' est indiqué deux fois.');
      seen[month] = true;
      var a = budgetNumber_(m.amount, 'Montant de ' + month);
      months.push({ month: month, amount: round2(a) });
      sum = round2(sum + a);
    });
    if (!months.length) throw new PpmError('VALIDATION', 'Indiquez au moins un mois.');
    if (Math.abs(sum - Number(line.planned_amount)) > 0.005) {
      throw new PpmError('VALIDATION', 'La somme des mois (' + sum + ') doit égaler le montant de la ligne (' + Number(line.planned_amount) + ').');
    }
    months.sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    repoUpdate('BudgetLine', line.id, { phasing_mode: 'manuel' }, null, ctx.actx);
    writePhasing_(line, months, ctx.actx);
    return { mode: 'manuel', months: months };
  });
});

// ---------------------------------------------------------------- vues : accès, lignes, bilan

function budgetAccess_(ctx, projectId) {
  var scope = { type: 'project', id: projectId };
  var all = can(ctx, 'budget.edit', scope);
  var hasWp = !all && repoList('PlanItem', function (i) { return i.project_id === projectId && i.item_type === 'Livrable'; })
    .some(function (i) { return can(ctx, 'budget.edit', { type: 'planitem', id: i.id }); });
  return {
    budget: all || hasWp, all: all, po: ctx.isAdmin || all || canPoView_(ctx, projectId),
    rates: ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'global' }), cpn: can(ctx, 'cpn.edit', scope)
  };
}

defineAction('budget.access', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var a = budgetAccess_(ctx, project.id);
  return Object.assign({ project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '', version: project.version } }, a);
});

/** Lignes de budget d'un projet, par livrable, avec étalement ; les lignes hors périmètre de l'utilisateur sont masquées. */
defineAction('budget.get', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.budget) throw new PpmError('FORBIDDEN', 'Le budget est réservé aux responsables de budget du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps);
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var editable = {};
  items.forEach(function (i) { if (access.all || can(ctx, 'budget.edit', { type: 'planitem', id: i.id })) editable[i.id] = true; });
  var lines = repoList('BudgetLine', function (l) { return editable[l.deliverable_id]; });
  var lineIds = {}; lines.forEach(function (l) { lineIds[l.id] = true; });
  var phasing = {};
  repoList('BudgetPhasing', function (x) { return lineIds[x.budget_line_id]; }).forEach(function (x) { (phasing[x.budget_line_id] = phasing[x.budget_line_id] || []).push(x); });
  var resById = indexBy_(repoList('Resource'));
  var views = lines.map(function (l) { return lineView_(l, ctx, phasing[l.id], resById, project.id); });
  var topWp = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && w.parent_wp_id && wpById[w.parent_wp_id] && guard++ < 5) w = wpById[w.parent_wp_id];
    return w;
  };
  var byId = indexBy_(items);
  var months = {}, byWp = {};
  views.forEach(function (l) {
    l.phasing.forEach(function (m) { months[m.month] = round2((months[m.month] || 0) + m.amount); });
    var it = byId[l.deliverable_id], w = it ? topWp(it) : null, key = w ? w.id : '';
    var g = byWp[key] = byWp[key] || { wp_id: key, code: w ? w.wbs_code || '' : '', name: w ? w.name : 'Sans workpackage', internal: 0, external: 0, total: 0 };
    if (l.cost_type === 'Forfait') g.external = round2(g.external + l.planned_amount); else g.internal = round2(g.internal + l.planned_amount);
    g.total = round2(g.internal + g.external);
  });
  var withBudget = {}; lines.forEach(function (l) { withBudget[l.deliverable_id] = true; });
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(project.cpn);
  };
  var wpLabel = function (item) { var w = item.wp_id ? wpById[item.wp_id] : null; return w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : ''; };
  var deliverables = items.filter(function (i) { return editable[i.id]; }).map(function (i) {
    return { id: i.id, name: i.name, wp: wpLabel(i), cpn: cpnOf(i), start: i.planned_start || null, finish: i.planned_finish || null, has_budget: !!withBudget[i.id] };
  }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); });
  var total = 0, ext = 0;
  views.forEach(function (l) { total = round2(total + l.planned_amount); if (l.cost_type === 'Forfait') ext = round2(ext + l.planned_amount); });
  return {
    project: { id: project.id, code: project.code, name: project.name }, partial: !access.all,
    lines: views, deliverables: deliverables,
    totals: { total: total, external: ext, internal: round2(total - ext), by_wp: Object.keys(byWp).map(function (k) { return byWp[k]; }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); }) },
    months: Object.keys(months).sort().map(function (m) { return { month: m, planned: months[m] }; }),
    missing: { deliverables_without_budget: deliverables.filter(function (d) { return !d.has_budget; }).length, undated_lines: views.filter(function (l) { return !l.phasing.length; }).length }
  };
});

// ---------------------------------------------------------------- bilan par CPN (fonction pure)

var PO_COMMITTED = ['Lancée', 'GR', 'Terminée'];

/**
 * d : { project, wps, items, lines, pos: [{ cpn, status, amount, launched_on }] }.
 * Un livrable relève du CPN de son premier workpackage ancêtre qui en porte un, à défaut de celui du projet.
 * Les PO relèvent du CPN qu'elles portent. Engagé = lancée + GR + terminée, en une fois (aucun étalement).
 */
function computeBalance_(d) {
  var wpById = indexBy_(d.wps), itemById = indexBy_(d.items);
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(d.project.cpn);
  };
  var groups = {}, order = [];
  var group = function (cpn, label) {
    var k = cpn || '';
    if (!groups[k]) {
      groups[k] = { cpn: k, label: label || '', sources: [], budget: { total: 0, internal: 0, external: 0 }, po: { planned: 0, committed: 0, received: 0, closed: 0, count: 0 } };
      order.push(k);
    }
    if (label && !groups[k].label) groups[k].label = label;
    return groups[k];
  };
  projectCpns_(d.project, d.wps).forEach(function (c) { var g = group(c.cpn, c.label); g.sources = c.sources; });
  d.lines.forEach(function (l) {
    var it = itemById[l.deliverable_id];
    if (!it) return;
    var g = group(cpnOf(it), ''), a = Number(l.planned_amount) || 0;
    g.budget.total += a;
    if (l.cost_type === 'Forfait') g.budget.external += a; else g.budget.internal += a;
  });
  d.pos.forEach(function (po) {
    var g = group(normCpn_(po.cpn), ''), a = Number(po.amount) || 0;
    g.po.count++;
    if (po.status === 'À faire') g.po.planned += a;
    if (PO_COMMITTED.indexOf(po.status) >= 0) g.po.committed += a;
    if (po.status === 'GR' || po.status === 'Terminée') g.po.received += a;
    if (po.status === 'Terminée') g.po.closed += a;
  });
  var tot = { budget: { total: 0, internal: 0, external: 0 }, po: { planned: 0, committed: 0, received: 0, closed: 0, count: 0 } };
  var cpns = order.map(function (k) {
    var g = groups[k];
    ['total', 'internal', 'external'].forEach(function (f) { g.budget[f] = round2(g.budget[f]); tot.budget[f] = round2(tot.budget[f] + g.budget[f]); });
    ['planned', 'committed', 'received', 'closed'].forEach(function (f) { g.po[f] = round2(g.po[f]); tot.po[f] = round2(tot.po[f] + g.po[f]); });
    tot.po.count += g.po.count;
    g.remaining_external = round2(g.budget.external - g.po.committed);
    g.overrun = g.po.committed > g.budget.external + 0.005;
    return g;
  }).sort(function (a, b) { return (a.cpn === '') - (b.cpn === '') || a.cpn.localeCompare(b.cpn); });
  return { cpns: cpns, totals: Object.assign(tot, { remaining_external: round2(tot.budget.external - tot.po.committed), overrun: tot.po.committed > tot.budget.external + 0.005 }) };
}

/** Engagements par mois : chaque PO engagée compte en totalité le mois de son lancement. */
function committedByMonth_(pos) {
  var out = {};
  pos.forEach(function (po) {
    if (PO_COMMITTED.indexOf(po.status) < 0 || isBlank(po.launched_on)) return;
    var m = monthOf_(po.launched_on);
    out[m] = round2((out[m] || 0) + (Number(po.amount) || 0));
  });
  return out;
}

defineAction('budget.balance', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.all) throw new PpmError('FORBIDDEN', 'Le bilan du projet est réservé à ses responsables de budget.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var lines = repoList('BudgetLine', function (l) { return ids[l.deliverable_id]; });
  var pos = projectOrders_(project.id, wps);
  var bal = computeBalance_({ project: project, wps: wps, items: items, lines: lines, pos: pos });
  var planned = {};
  repoList('BudgetPhasing', function (x) { return lines.some(function (l) { return l.id === x.budget_line_id; }); }).forEach(function (x) { planned[x.month] = round2((planned[x.month] || 0) + Number(x.amount)); });
  var committed = committedByMonth_(pos), months = {};
  Object.keys(planned).concat(Object.keys(committed)).forEach(function (m) { months[m] = true; });
  return Object.assign({
    project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '' },
    months: Object.keys(months).sort().map(function (m) { return { month: m, planned: planned[m] || 0, committed: committed[m] || 0 }; })
  }, bal);
});

// ======================================================================
// 44_Orders.gs
// ======================================================================

/**
 * PPM Core — 0.9.0 : commandes d'achat (PO).
 *
 * Une PO est passée auprès d'une ressource EXTERNE. Elle porte un CPN saisi à la main et un numéro unique saisi à la main
 * (celui de Click and Buy). Si son CPN est celui d'un projet de l'outil (ou d'un de ses sous-projets), elle impacte le bilan
 * budgétaire de ce projet ; sinon elle est simplement enregistrée, sans effet sur aucun budget de l'outil.
 *
 * Quatre statuts : À faire (prévisionnel, rien d'engagé), Lancée (engagée), GR (good receipt : prestation réceptionnée),
 * Terminée (soldée). L'engagement se fait EN UNE FOIS, en totalité, à la date de lancement : aucun étalement.
 * Chaque PO indique la date à laquelle la GR doit être faite ; à l'approche de cette date, puis au-delà, un rappel part
 * dans le récapitulatif quotidien de son responsable et un constat apparaît pour le pilotage.
 *
 * Le montant se répartit entre un ou plusieurs livrables du projet, montants réglables (leur somme égale celui de la PO).
 * Droits : toute personne INTERNE nommée dans l'équipe du projet crée et modifie les PO de ce projet.
 * Aucun montant n'apparaît dans les constats, les mails ni les demandes à l'IA.
 */

var PO_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
var PO_ORDER = { 'À faire': 0, 'Lancée': 1, 'GR': 2, 'Terminée': 3 };

// ---------------------------------------------------------------- droits

function isInternalUser_(ctx) {
  if (ctx.isAdmin) return true;
  if (!ctx.resourceId) return false;
  var r = repoGet('Resource', ctx.resourceId);
  return !!r && !isTrue(r.deleted) && r.resource_type === 'Interne';
}

/** Nommé dans l'équipe du projet : un rôle sur le projet (ou au-dessus), ou sur l'un de ses workpackages. */
function namedInProject_(ctx, projectId) {
  if (can(ctx, 'po.edit', { type: 'project', id: projectId })) return true;
  var wpIds = {};
  repoList('WorkPackage', function (w) { return w.project_id === projectId; }).forEach(function (w) { wpIds[w.id] = true; });
  return (ctx.assignments || []).some(function (a) { return a.scope_type === 'workpackage' && wpIds[a.scope_id]; });
}

function canPoEdit_(ctx, projectId) {
  if (ctx.isAdmin) return true;
  if (!isInternalUser_(ctx)) return false;
  return projectId ? namedInProject_(ctx, projectId) : (ctx.assignments || []).length > 0;
}

function canPoView_(ctx, projectId) {
  return canPoEdit_(ctx, projectId) || can(ctx, 'budget.edit', { type: 'project', id: projectId });
}

// ---------------------------------------------------------------- validations

function poNumber_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le numéro de PO est obligatoire (celui de Click and Buy).');
  if (!PO_NUMBER_RE.test(s)) throw new PpmError('VALIDATION', 'Numéro de PO invalide : 40 caractères au plus, lettres, chiffres, espace, point, tiret, barre oblique.');
  return s;
}

function poStatus_(s) {
  if (PO_STATUSES.indexOf(s) < 0) throw new PpmError('VALIDATION', 'Statut inconnu : ' + PO_STATUSES.join(', ') + '.');
  return s;
}

function poAmount_(v) {
  var n = Number(v);
  if (isBlank(v) || isNaN(n) || n <= 0 || n > 1e9) throw new PpmError('VALIDATION', 'Montant : un nombre strictement positif.');
  return round2(n);
}

/** Dates propres à chaque statut : l'engagement date du lancement, la réception de la GR, le solde de la clôture. */
function poDates_(status, cur, v, today) {
  var pick = function (key, label) { return key in v ? wbsDate_(v[key], label) : (cur ? String(cur[key] || '') : ''); };
  var launched = pick('launched_on', 'Date de lancement'), grOn = pick('gr_on', 'Date de GR'), closed = pick('closed_on', 'Date de clôture');
  if (status === 'À faire') { launched = ''; grOn = ''; closed = ''; }
  else {
    if (!launched) launched = today;
    if (status === 'Lancée') { grOn = ''; closed = ''; }
    else {
      if (!grOn) grOn = today;
      if (status === 'GR') closed = ''; else if (!closed) closed = today;
    }
  }
  if (grOn && grOn < launched) throw new PpmError('VALIDATION', 'La GR ne peut pas précéder le lancement de la PO.');
  if (closed && grOn && closed < grOn) throw new PpmError('VALIDATION', 'La clôture ne peut pas précéder la GR.');
  return { launched_on: launched, gr_on: grOn, closed_on: closed };
}

function poExternalResource_(id) {
  var r = isBlank(id) ? null : repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Ressource externe introuvable.');
  if (r.resource_type !== 'Externe') throw new PpmError('VALIDATION', 'Une PO est passée auprès d’une ressource externe : « ' + r.name + ' » est interne.');
  return r;
}

function poOwner_(id, ctx) {
  var target = isBlank(id) ? ctx.resourceId : id;
  if (isBlank(target)) return '';
  var r = repoGet('Resource', target);
  if (!r || isTrue(r.deleted) || r.resource_type !== 'Interne') throw new PpmError('VALIDATION', 'Le responsable de la GR doit être une personne interne.');
  return String(target);
}

/** Répartition entre livrables du projet : montants réglables, somme égale au montant de la PO. */
function poLinks_(links, project, amount) {
  if (!links.length) return [];
  if (!project) throw new PpmError('VALIDATION', 'Ce CPN ne correspond à aucun projet de l’outil : la PO ne peut pas être répartie sur des livrables.');
  var items = indexBy_(repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }));
  var seen = {}, out = [], sum = 0;
  links.forEach(function (l) {
    var it = items[l && l.deliverable_id];
    if (!it) throw new PpmError('VALIDATION', 'Livrable introuvable dans le projet ' + project.code + '.');
    if (seen[it.id]) throw new PpmError('VALIDATION', 'Le livrable « ' + it.name + ' » est indiqué deux fois.');
    seen[it.id] = true;
    var a = round2(budgetNumber_(l.amount, 'Montant du livrable « ' + it.name + ' »'));
    out.push({ deliverable_id: it.id, amount: a });
    sum = round2(sum + a);
  });
  if (Math.abs(sum - amount) > 0.005) throw new PpmError('VALIDATION', 'La somme des montants par livrable (' + sum + ') doit égaler le montant de la PO (' + amount + ').');
  return out;
}

// ---------------------------------------------------------------- lecture

function attachLinks_(pos) {
  var byId = {};
  pos.forEach(function (o) { o.links = []; byId[o.id] = o; });
  repoList('PurchaseOrderLink', function (l) { return byId[l.po_id]; }).forEach(function (l) {
    byId[l.po_id].links.push({ id: l.id, deliverable_id: l.deliverable_id, amount: Number(l.amount) || 0 });
  });
  return pos;
}

/** PO d'un projet : celles dont le CPN est celui du projet ou d'un de ses sous-projets. */
function projectOrders_(projectId, wps) {
  var project = repoGet('Project', projectId);
  var set = {};
  projectCpns_(project, wps).forEach(function (c) { set[c.cpn] = true; });
  return attachLinks_(repoList('PurchaseOrder', function (o) { return set[normCpn_(o.cpn)]; }));
}

function grFlag_(o, today) {
  if (o.status !== 'Lancée' || isBlank(o.gr_due_date)) return '';
  if (String(o.gr_due_date) < today) return 'late';
  return String(o.gr_due_date) <= addCalendarDays(today, THRESHOLDS.dueSoonDays) ? 'soon' : '';
}

defineAction('po.options', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!canPoView_(ctx, project.id)) throw new PpmError('FORBIDDEN', 'Les commandes d’achat sont réservées aux personnes internes nommées dans l’équipe du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps);
  var lines = repoList('BudgetLine', function (l) { return l.cost_type === 'Forfait'; });
  var ext = {};
  lines.forEach(function (l) { ext[l.deliverable_id] = round2((ext[l.deliverable_id] || 0) + (Number(l.planned_amount) || 0)); });
  var resources = repoList('Resource');
  return {
    cpns: projectCpns_(project, wps),
    externals: resources.filter(function (r) { return r.resource_type === 'Externe'; }).map(function (r) { return { id: r.id, name: r.name, supplier: r.supplier || '' }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }),
    internals: resources.filter(function (r) { return r.resource_type === 'Interne'; }).map(function (r) { return { id: r.id, name: r.name }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }),
    deliverables: repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }).map(function (i) {
      var w = i.wp_id ? wpById[i.wp_id] : null;
      return { id: i.id, name: i.name, wp: w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : '', budget_external: ext[i.id] || 0 };
    }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); }),
    canEdit: canPoEdit_(ctx, project.id)
  };
});

function orderView_(o, env, today) {
  var res = env.resById[o.resource_id], owner = env.resById[o.owner_resource_id];
  var links = o.links.map(function (l) { var it = env.itemById[l.deliverable_id]; return { deliverable_id: l.deliverable_id, name: it ? it.name : '(supprimé)', amount: l.amount }; });
  var allocated = round2(o.links.reduce(function (a, l) { return a + l.amount; }, 0));
  var warnings = [];
  var committed = PO_COMMITTED.indexOf(o.status) >= 0;
  if (env.project && o.links.length && Math.abs(allocated - Number(o.amount)) > 0.005) warnings.push('Répartition incomplète : ' + round2(Number(o.amount) - allocated) + ' non affecté à un livrable.');
  if (env.project && !o.links.length) warnings.push('Aucun livrable lié : le montant pèse sur le CPN sans être rattaché à un livrable.');
  o.links.forEach(function (l) {
    var it = env.itemById[l.deliverable_id];
    if (!it) return;
    var e = env.external[it.id] || 0;
    if (l.amount > 0 && e === 0) warnings.push('Le livrable « ' + it.name + ' » n’a pas de budget externe.');
    else if (committed && (env.committed[it.id] || 0) > e + 0.005) warnings.push('Le budget externe du livrable « ' + it.name + ' » est dépassé.');
    if (env.cpnOf && env.cpnOf(it) && env.cpnOf(it) !== normCpn_(o.cpn)) warnings.push('Le livrable « ' + it.name + ' » relève du CPN ' + env.cpnOf(it) + ', pas de ' + normCpn_(o.cpn) + '.');
  });
  if (o.status === 'À faire' && !isBlank(o.start_date) && String(o.start_date) <= today) warnings.push('À lancer : l’activité a commencé le ' + o.start_date + '.');
  return {
    id: o.id, version: o.version, po_number: o.po_number, cpn: normCpn_(o.cpn), cpn_label: env.cpnLabels ? env.cpnLabels[normCpn_(o.cpn)] || '' : '',
    resource: { id: o.resource_id, name: res ? res.name : '(supprimée)', supplier: res ? res.supplier || '' : '' },
    owner: { id: o.owner_resource_id || '', name: owner ? owner.name : '' }, description: o.description || '',
    start_date: o.start_date || '', end_date: o.end_date || '', amount: Number(o.amount) || 0, status: o.status,
    gr_due_date: o.gr_due_date || '', launched_on: o.launched_on || '', gr_on: o.gr_on || '', closed_on: o.closed_on || '',
    gr_flag: grFlag_(o, today), links: links, unallocated: round2(Number(o.amount) - allocated), warnings: warnings, created_by: o.created_by || ''
  };
}

function projectEnv_(project, wps, pos) {
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var itemById = indexBy_(items), wpById = indexBy_(wps);
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var external = {}, committed = {};
  repoList('BudgetLine', function (l) { return ids[l.deliverable_id] && l.cost_type === 'Forfait'; }).forEach(function (l) { external[l.deliverable_id] = round2((external[l.deliverable_id] || 0) + (Number(l.planned_amount) || 0)); });
  pos.forEach(function (o) { if (PO_COMMITTED.indexOf(o.status) >= 0) o.links.forEach(function (l) { committed[l.deliverable_id] = round2((committed[l.deliverable_id] || 0) + l.amount); }); });
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(project.cpn);
  };
  var labels = {};
  projectCpns_(project, wps).forEach(function (c) { labels[c.cpn] = c.label; });
  return { project: project, resById: indexBy_(repoList('Resource')), itemById: itemById, external: external, committed: committed, cpnOf: cpnOf, cpnLabels: labels, wpById: wpById, items: items };
}

/** PO d'un projet (par CPN), avec la consommation par livrable ; ou, avec scope = 'outside', mes PO sans projet dans l'outil. */
defineAction('po.list', function (p, ctx) {
  var today = todayStr();
  if (p.scope === 'outside') {
    if (!canPoEdit_(ctx, '')) throw new PpmError('FORBIDDEN', 'Réservé aux personnes internes nommées dans une équipe.');
    var idx = cpnIndex_();
    var mine = attachLinks_(repoList('PurchaseOrder', function (o) {
      return !idx[normCpn_(o.cpn)] && (ctx.isAdmin || String(o.created_by || '').toLowerCase() === ctx.email || (ctx.resourceId && o.owner_resource_id === ctx.resourceId));
    }));
    var env0 = { project: null, resById: indexBy_(repoList('Resource')), itemById: {}, external: {}, committed: {} };
    return { orders: mine.map(function (o) { return orderView_(o, env0, today); }).sort(function (a, b) { return String(a.po_number).localeCompare(String(b.po_number)); }) };
  }
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!canPoView_(ctx, project.id)) throw new PpmError('FORBIDDEN', 'Les commandes d’achat sont réservées aux personnes internes nommées dans l’équipe du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var pos = projectOrders_(project.id, wps);
  var env = projectEnv_(project, wps, pos);
  var orders = pos.map(function (o) { return orderView_(o, env, today); }).sort(function (a, b) {
    return (PO_ORDER[a.status] - PO_ORDER[b.status]) || String(a.gr_due_date || '9999').localeCompare(String(b.gr_due_date || '9999')) || String(a.po_number).localeCompare(String(b.po_number));
  });
  var planned = {};
  pos.forEach(function (o) { if (o.status === 'À faire') o.links.forEach(function (l) { planned[l.deliverable_id] = round2((planned[l.deliverable_id] || 0) + l.amount); }); });
  var deliverables = env.items.filter(function (i) { return env.external[i.id] || env.committed[i.id] || planned[i.id]; }).map(function (i) {
    var w = i.wp_id ? env.wpById[i.wp_id] : null, e = env.external[i.id] || 0, c = env.committed[i.id] || 0;
    return { id: i.id, name: i.name, wp: w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : '', cpn: env.cpnOf(i), budget_external: e, committed: c, planned: planned[i.id] || 0, remaining: round2(e - c), overrun: c > e + 0.005 };
  }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); });
  return { project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '' }, orders: orders, deliverables: deliverables, canEdit: canPoEdit_(ctx, project.id) };
});

// ---------------------------------------------------------------- écriture

function replaceLinks_(poId, links, actx) {
  repoList('PurchaseOrderLink', function (l) { return l.po_id === poId; }).forEach(function (l) { repoSoftDelete('PurchaseOrderLink', l.id, null, actx); });
  links.forEach(function (l) { repoInsert('PurchaseOrderLink', { po_id: poId, deliverable_id: l.deliverable_id, amount: l.amount }, actx); });
}

/** Crée ou modifie une PO. values : numéro, CPN, ressource externe, période, montant, statut, échéance de GR, responsable de la GR… */
defineAction('po.save', function (p, ctx) {
  var v = p.values || {};
  var cur = isBlank(p.id) ? null : mustGet('PurchaseOrder', p.id);
  var today = todayStr();
  return withLock(function () {
    var number = !cur || 'po_number' in v ? poNumber_(v.po_number) : cur.po_number;
    if (repoList('PurchaseOrder', function (o) { return (!cur || o.id !== cur.id) && String(o.po_number).toLowerCase() === number.toLowerCase(); }).length) {
      throw new PpmError('VALIDATION', 'Le numéro de PO ' + number + ' existe déjà : il est unique.');
    }
    var cpn = !cur || 'cpn' in v ? checkCpnValue_(v.cpn) : normCpn_(cur.cpn);
    if (!cpn) throw new PpmError('VALIDATION', 'Le CPN est obligatoire.');
    var owner = cpnOwner_(cpn), project = owner ? owner.project : null;
    var before = cur ? cpnOwner_(cur.cpn) : null;
    if (!canPoEdit_(ctx, project ? project.id : '') || (before && !canPoEdit_(ctx, before.project.id))) {
      throw new PpmError('FORBIDDEN', project ? 'Seules les personnes internes nommées dans l’équipe du projet ' + project.code + ' créent ou modifient ses PO.'
        : 'Seules les personnes internes nommées dans une équipe créent une PO.');
    }
    var resource = poExternalResource_('resource_id' in v || !cur ? v.resource_id : cur.resource_id);
    var status = !cur || 'status' in v ? poStatus_(isBlank(v.status) ? 'À faire' : v.status) : cur.status;
    var amount = !cur || 'amount' in v ? poAmount_(v.amount) : Number(cur.amount);
    var start = 'start_date' in v ? wbsDate_(v.start_date, 'Début d’activité') : (cur ? cur.start_date || '' : '');
    var end = 'end_date' in v ? wbsDate_(v.end_date, 'Fin d’activité') : (cur ? cur.end_date || '' : '');
    if (start && end && start > end) throw new PpmError('VALIDATION', 'La fin d’activité ne peut pas précéder son début.');
    var due = 'gr_due_date' in v ? wbsDate_(v.gr_due_date, 'Date de GR attendue') : (cur ? cur.gr_due_date || '' : '');
    if (!due && (status === 'À faire' || status === 'Lancée')) throw new PpmError('VALIDATION', 'La date à laquelle la GR doit être faite est obligatoire : elle déclenche le rappel.');
    var dates = poDates_(status, cur, v, today);
    var links = Array.isArray(p.links) ? poLinks_(p.links, project, amount) : null;
    if (links === null && cur) {
      var existing = repoList('PurchaseOrderLink', function (l) { return l.po_id === cur.id; });
      if (existing.length && (Number(cur.amount) !== amount || (before && project && before.project.id !== project.id))) {
        throw new PpmError('VALIDATION', 'Le montant ou le CPN a changé : ajustez la répartition entre livrables.');
      }
    }
    var values = {
      po_number: number, cpn: cpn, resource_id: resource.id, owner_resource_id: poOwner_('owner_resource_id' in v ? v.owner_resource_id : (cur ? cur.owner_resource_id : ''), ctx),
      description: wbsShortText_('description' in v ? v.description : (cur ? cur.description : ''), 300, 'Description'),
      start_date: start, end_date: end, amount: amount, status: status, gr_due_date: due,
      launched_on: dates.launched_on, gr_on: dates.gr_on, closed_on: dates.closed_on
    };
    var rec = cur ? repoUpdate('PurchaseOrder', cur.id, values, p.version, ctx.actx) : repoInsert('PurchaseOrder', values, ctx.actx);
    if (links !== null) replaceLinks_(rec.id, links, ctx.actx);
    var stored = attachLinks_([rec])[0];
    var env = project ? projectEnv_(project, repoList('WorkPackage', function (w) { return w.project_id === project.id; }), projectOrders_(project.id, repoList('WorkPackage', function (w) { return w.project_id === project.id; })))
      : { project: null, resById: indexBy_(repoList('Resource')), itemById: {}, external: {}, committed: {} };
    var view = orderView_(stored, env, today);
    view.project = project ? { id: project.id, code: project.code, name: project.name } : null;
    return view;
  });
});

/** Changement de statut en un geste (les dates d'engagement, de GR et de clôture suivent). */
defineAction('po.status', function (p, ctx) {
  var o = mustGet('PurchaseOrder', requireParam(p, 'id'));
  poStatus_(p.status);
  var owner = cpnOwner_(o.cpn);
  if (!canPoEdit_(ctx, owner ? owner.project.id : '')) throw new PpmError('FORBIDDEN', 'Seules les personnes internes nommées dans l’équipe du projet modifient ses PO.');
  var dates = poDates_(p.status, o, {}, todayStr());
  var rec = repoUpdate('PurchaseOrder', o.id, Object.assign({ status: p.status }, dates), p.version, ctx.actx);
  return { id: rec.id, version: rec.version, status: rec.status, launched_on: rec.launched_on || '', gr_on: rec.gr_on || '', closed_on: rec.closed_on || '' };
});

defineAction('po.delete', function (p, ctx) {
  var o = mustGet('PurchaseOrder', requireParam(p, 'id'));
  var owner = cpnOwner_(o.cpn);
  var creator = String(o.created_by || '').toLowerCase() === ctx.email;
  var manager = owner ? can(ctx, 'cpn.edit', { type: 'project', id: owner.project.id }) : false;
  if (!ctx.isAdmin && !manager && !(creator && canPoEdit_(ctx, owner ? owner.project.id : ''))) {
    throw new PpmError('FORBIDDEN', 'Une PO se supprime par son auteur ou par le pilotage du projet.');
  }
  return withLock(function () {
    replaceLinks_(o.id, [], ctx.actx);
    repoSoftDelete('PurchaseOrder', o.id, p.version, ctx.actx);
    return { deleted: true };
  });
});

// ---------------------------------------------------------------- constats (moteur de règles)

/**
 * Constats sur les PO : GR en retard ou attendue sous 7 jours, PO à lancer alors que l'activité a commencé, dépassement du
 * budget externe d'un CPN. Fonction pure. Aucun montant dans les messages (ils vont aux équipes et peuvent aller à l'IA).
 *   data : { orders: [{ id, po_number, projectId, cpn, status, start_date, gr_due_date, resource }], balances: { projectId: bilan } }
 */
function poFindings_(data, today) {
  var out = [];
  var soon = addCalendarDays(today, THRESHOLDS.dueSoonDays);
  (data.orders || []).forEach(function (o) {
    if (!o.projectId) return;
    var who = o.po_number + (o.resource ? ' (' + o.resource + ')' : '');
    if (o.status === 'Lancée' && !isBlank(o.gr_due_date)) {
      if (String(o.gr_due_date) < today) {
        out.push({ projectId: o.projectId, rule: 'PO_GR_LATE', severity: 'Alerte', targetType: 'PurchaseOrder', targetId: o.id,
          message: 'La GR de la PO ' + who + ' devait être faite le ' + o.gr_due_date + '.',
          suggestion: 'Faire la réception (GR) dans Click and Buy, puis passer la PO en « GR » dans l’outil.' });
      } else if (String(o.gr_due_date) <= soon) {
        out.push({ projectId: o.projectId, rule: 'PO_GR_SOON', severity: 'Vigilance', targetType: 'PurchaseOrder', targetId: o.id,
          message: 'La GR de la PO ' + who + ' est attendue le ' + o.gr_due_date + '.', suggestion: 'Préparer la réception de la prestation.' });
      }
    }
    if (o.status === 'À faire' && !isBlank(o.start_date) && String(o.start_date) <= today) {
      out.push({ projectId: o.projectId, rule: 'PO_TODO_LATE', severity: 'Vigilance', targetType: 'PurchaseOrder', targetId: o.id,
        message: 'La PO ' + who + ' est encore à faire alors que l’activité a commencé le ' + o.start_date + '.', suggestion: 'Lancer la PO ou corriger la période d’activité.' });
    }
  });
  Object.keys(data.balances || {}).forEach(function (projectId) {
    (data.balances[projectId].cpns || []).forEach(function (g) {
      if (g.overrun && g.budget.external > 0) {
        out.push({ projectId: projectId, rule: 'PO_OVERRUN', severity: 'Alerte', targetType: 'Project', targetId: projectId,
          message: 'Les PO engagées dépassent le budget externe du CPN ' + g.cpn + ' de ' + Math.round(100 * (g.po.committed - g.budget.external) / g.budget.external) + ' %.',
          suggestion: 'Revoir le budget externe, ou la répartition et le montant des PO.' });
      } else if (g.overrun && g.budget.external === 0 && g.po.committed > 0) {
        out.push({ projectId: projectId, rule: 'PO_UNBUDGETED', severity: 'Vigilance', targetType: 'Project', targetId: projectId,
          message: 'Des PO sont engagées sur le CPN ' + (g.cpn || '(sans CPN)') + ', qui n’a aucun budget externe.', suggestion: 'Saisir le budget externe correspondant.' });
      }
    });
  });
  return out;
}

/** Charge les données et calcule les constats des PO (appelée par runRules). */
function poRuleInputs_() {
  var projects = repoList('Project'), pos = attachLinks_(repoList('PurchaseOrder'));
  var idx = cpnIndex_(), resById = indexBy_(repoList('Resource'));
  var byProject = {};
  var orders = pos.map(function (o) {
    var own = idx[normCpn_(o.cpn)];
    var projectId = own ? own.project.id : '';
    if (projectId) (byProject[projectId] = byProject[projectId] || []).push(o);
    return { id: o.id, po_number: o.po_number, projectId: projectId, cpn: normCpn_(o.cpn), status: o.status, start_date: o.start_date || '',
      gr_due_date: o.gr_due_date || '', resource: resById[o.resource_id] ? resById[o.resource_id].name : '' };
  });
  var balances = {};
  projects.forEach(function (project) {
    if (project.status === 'Clos' || !byProject[project.id]) return;
    var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
    var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
    var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
    balances[project.id] = computeBalance_({ project: project, wps: wps, items: items, lines: repoList('BudgetLine', function (l) { return ids[l.deliverable_id]; }), pos: byProject[project.id] });
  });
  return { orders: orders, balances: balances };
}
