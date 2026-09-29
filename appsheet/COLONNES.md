# Colonnes AppSheet (généré depuis src/01_Schema.gs — ne pas modifier à la main)

Légende : **Clé** = cocher Key ; **Lecture seule** = Editable OFF ; **Masquée** = Show OFF.
Colonnes techniques de toutes les tables vivantes : `created_at`, `created_by`, `updated_at`, `updated_by`, `version` (lecture seule, masquées), `deleted` (Yes/No, masquée).

## Program

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `code` | Text | Require ON |
| `name` | Text | Require ON ; Label |
| `leader_resource_id` | Ref → Resource |  |
| `status` | Enum | Valeurs : Actif, En pause, Clos |
| `description` | LongText |  |

## Project

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `code` | Text | Require ON |
| `name` | Text | Require ON ; Label |
| `program_id` | Ref → Program |  |
| `manager_resource_id` | Ref → Resource |  |
| `status` | Enum | Valeurs : Préparation, Actif, En pause, Clos |
| `holiday_country` | Enum | Valeurs : FR, DE, UK, IN |
| `start_date` | Date |  |
| `end_date` | Date |  |
| `active_baseline_id` | Ref → Baseline |  |
| `drive_folder_id` | Text |  |
| `calendar_id` | Text |  |

## WorkPackage

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `project_id` | Ref → Project | Require ON |
| `parent_wp_id` | Ref → WorkPackage |  |
| `wbs_code` | Text |  |
| `name` | Text | Require ON ; Label |
| `owner_resource_id` | Ref → Resource |  |
| `charge_code` | Text |  |

## PlanItem

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `project_id` | Ref → Project | Require ON |
| `wp_id` | Ref → WorkPackage |  |
| `item_type` | Enum | Valeurs : Livrable, Jalon ; Require ON |
| `name` | Text | Require ON ; Label |
| `owner_resource_id` | Ref → Resource |  |
| `planned_start` | Date |  |
| `planned_finish` | Date |  |
| `actual_finish` | Date | Lecture seule (calculé par le Core) |
| `progress_pct` | Number | Valid_If `AND([_THIS] >= 0, [_THIS] <= 100)` ; Lecture seule (calculé par le Core) |
| `status` | Enum | Valeurs : À faire, En cours, Terminé ; Lecture seule (calculé par le Core) |
| `milestone_category` | Enum | Valeurs : Revue, Client, Interne |
| `drive_url` | Url |  |
| `calendar_event_id` | Text | Lecture seule (calculé par le Core) |
| `last_progress_at` | Text | Lecture seule (calculé par le Core) |

## MilestoneRequirement

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `milestone_id` | Ref → PlanItem | Require ON |
| `deliverable_id` | Ref → PlanItem | Require ON |

## Dependency

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `predecessor_id` | Ref → PlanItem | Require ON |
| `successor_id` | Ref → PlanItem | Require ON |
| `dep_type` | Enum | Valeurs : FS, SS, FF, SF ; Require ON |
| `lag_days` | Number |  |

## Resource

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `resource_type` | Enum | Valeurs : Interne, Externe ; Require ON |
| `name` | Text | Require ON ; Label |
| `email` | Email |  |
| `team_id` | Ref → HierarchicalTeam |  |
| `rate_profile` | Text |  |
| `supplier` | Text |  |
| `capacity_days_month` | Number |  |
| `country` | Enum | Valeurs : FR, DE, UK, IN |
| `job_function` | Enum (Base type Text) | Allow other values ON ; Auto-add new values ON ; Suggested values : `SELECT(Resource[job_function], NOT(ISBLANK([job_function])), TRUE)` (liste sans doublon) |
| `organization` | Enum (Base type Text) | Allow other values ON ; Auto-add new values ON ; Suggested values : `SELECT(Resource[organization], NOT(ISBLANK([organization])), TRUE)` (liste sans doublon) |

## HierarchicalTeam

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `name` | Text | Require ON ; Label |
| `parent_team_id` | Ref → HierarchicalTeam |  |
| `manager_resource_id` | Ref → Resource |  |
| `cost_center` | Text |  |

## HolidaySet

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `country` | Enum | Valeurs : FR, DE, UK, IN ; Require ON |
| `year` | Number | Require ON |
| `label` | Text |  |
| `dates_json` | LongText |  |

## Role

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `code` | Text | Require ON |
| `label` | Text |  |
| `scope_level` | Text |  |

## RoleAssignment

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `resource_id` | Ref → Resource | Require ON |
| `role_code` | Enum | Valeurs : PL, DPL, CP, RWP, MEMBER ; Require ON |
| `scope_type` | Enum | Valeurs : program, project, workpackage ; Require ON |
| `scope_id` | Text | Require ON |
| `start_date` | Date |  |
| `end_date` | Date |  |

## RateCard

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `profile` | Text | Require ON |
| `country` | Enum | Valeurs : FR, DE, UK, IN ; Require ON |
| `daily_rate` | Price (EUR) | Require ON |
| `effective_date` | Date |  |

## BudgetLine

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `deliverable_id` | Ref → PlanItem | Require ON |
| `resource_id` | Ref → Resource | Require ON |
| `cost_type` | Enum | Valeurs : TJM, Forfait ; Require ON |
| `planned_days` | Number |  |
| `frozen_rate` | Text |  |
| `fixed_amount` | Price (EUR) |  |
| `planned_amount` | Price (EUR) | Lecture seule (calculé par le Core) |

## BudgetPhasing

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `budget_line_id` | Ref → BudgetLine | Require ON |
| `month` | Text | Require ON |
| `amount` | Price (EUR) |  |

## ProgressUpdate

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `deliverable_id` | Ref → PlanItem | Require ON |
| `resource_id` | Ref → Resource |  |
| `declared_at` | Text | Lecture seule (calculé par le Core) |
| `progress_pct` | Number | Valid_If `AND([_THIS] >= 0, [_THIS] <= 100)` ; Require ON |
| `comment` | LongText |  |

## ActualImport

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `period` | Text |  |
| `source_file_id` | Text |  |
| `mapping_json` | LongText |  |
| `status` | Enum | Valeurs : Brouillon, Contrôlé, Publié, Remplacé |
| `imported_by` | Text |  |

## RiskOpportunity

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `project_id` | Ref → Project | Require ON |
| `kind` | Enum | Valeurs : Risque, Opportunité ; Require ON |
| `title` | Text | Require ON ; Label |
| `description` | LongText |  |
| `linked_item_id` | Ref → PlanItem |  |
| `financial_value` | Price (EUR) |  |
| `probability` | Number |  |
| `impact` | Number |  |
| `score` | Number | Lecture seule (calculé par le Core) |
| `owner_resource_id` | Ref → Resource |  |
| `strategy` | Enum | Valeurs : Éviter, Réduire, Transférer, Accepter, Exploiter, Partager, Améliorer |
| `review_date` | Date |  |
| `treatment_due` | Date |  |
| `status` | Enum | Valeurs : Ouvert, En traitement, Clos |

## Baseline

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `project_id` | Ref → Project | Require ON |
| `number` | Number |  |
| `label` | Text |  |
| `justification` | LongText | Require ON |
| `requested_by` | Email |  |
| `status` | Enum | Valeurs : Demandée, Active, Archivée, Refusée |
| `decided_by` | Email |  |
| `decided_at` | Text |  |

## Insight

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `project_id` | Ref → Project |  |
| `rule_code` | Text |  |
| `severity` | Enum | Valeurs : Info, Vigilance, Alerte |
| `target_type` | Text |  |
| `target_id` | Text |  |
| `message` | Text |  |
| `suggestion` | Text |  |
| `status` | Enum | Valeurs : Nouveau, Accepté, Ignoré |
| `generated_on` | Date |  |
| `decided_by` | Email |  |
| `decided_at` | Text |  |
| `decision_note` | Text |  |

## Addon

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `name` | Text | Require ON ; Label |
| `url` | Url | Require ON |
| `manifest_json` | LongText | Require ON |
| `author_email` | Email |  |
| `visibility` | Enum | Valeurs : Privé, Partagé, Catalogue |
| `review_status` | Enum | Valeurs : Non revu, Approuvé, Refusé |

## AddonInstallation

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `addon_id` | Ref → Addon | Require ON |
| `user_email` | Email | Require ON |
| `enabled` | Yes/No |  |

## AddonRecord

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `addon_id` | Ref → Addon | Require ON |
| `collection` | Text | Require ON |
| `entity_type` | Text | Require ON |
| `entity_id` | Text | Require ON |
| `data_json` | LongText |  |

## UserSetting

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `user_email` | Email |  |
| `language` | Enum | Valeurs : FR, EN, DE |
| `notify_frequency` | Enum | Valeurs : Quotidien, Hebdomadaire, Aucun |
| `view_prefs_json` | LongText | Masquée ; Lecture seule (écrite par la page Structure) |
| `calendar_invites` | Yes/No | Échéances de mes livrables dans mon agenda (aussi réglable depuis la page Suivi) |

## ChangeEvent (classeur Historique, lecture seule sauf `acknowledged`)

| Colonne | Type AppSheet | Réglages |
| --- | --- | --- |
| `id` | Text | Clé ; Initial value `UNIQUEID()` ; Masquée ; Lecture seule |
| `at` | Text |  |
| `table_name` | Text |  |
| `entity_id` | Text |  |
| `project_id` | Ref → Project |  |
| `field` | Text |  |
| `old_value` | Text |  |
| `new_value` | Text |  |
| `actor` | Email |  |
| `source` | Text |  |
| `acknowledged` | Yes/No |  |
| `acknowledged_by` | Text |  |
| `acknowledged_at` | Text |  |

