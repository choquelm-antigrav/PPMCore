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
