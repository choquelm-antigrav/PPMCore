# Contexte pour Gemini — contribuer au Core PPM

Tu aides un contributeur à faire évoluer le **Core** d'un outil interne de gestion de projets et programmes. Lis ce fichier en entier avant de proposer du code.

## Architecture

- **Apps Script (V8)**, projet autonome « PPM Core ». Tous les fichiers `.gs` partagent une seule portée globale ; ils sont chargés par ordre alphabétique (préfixes `00_` à `40_`).
- **Données** : classeur « PPM Données » (tables courantes, source de l'application AppSheet) et classeur « PPM Historique » (ChangeEvent, BaselineItem, ActualLine, EvmSnapshot, _Snapshot).
- **Interface** : AppSheet écrit directement dans le classeur Données, puis un bot appelle `onRowChanged(table, id, email)`.
- **API** : web app `doPost` en JSON, exécutée par le compte propriétaire ; les addons l'utilisent.
- **Page Gantt** (`Gantt.html`, servie par `doGet?view=gantt`) : elle appelle le Core par `google.script.run.uiCall(action, params)`, qui passe par `handleRequest` avec les mêmes droits que l'API. Les libellés sont échappés avant d'être passés à Frappe Gantt (qui les insère en HTML).
- **Page Structure** (`Structure.html`, `?view=structure`) : OBS et WBS dessinés en SVG. Le serveur renvoie TOUS les attributs de chaque nœud (`33_Structure.gs`) ; la page filtre selon les choix de l'utilisateur, mémorisés dans `UserSetting.view_prefs_json`. Le style commun est dans `Style.html` (`<?!= include('Style') ?>`).
- **Lot 2** : `34_Baselines.gs` (baselines, écarts, fil des changements), `35_Workspace.gs` (agenda, Drive, annuaire), `36_Digest.gs` (récapitulatif), page `Suivi.html` (`?view=suivi`).
- **Lot 4** : `37_Simulation.gs` (simulation, synthèse chiffrée, signaux faibles — sans IA), `38_Copilot.gs` (modes off/manual/api, garde-fou des chiffres, journal AiLog), page `Copilote.html` (`?view=copilote`).
- **Sources et installation** : on ne travaille que dans `src/`. `dist/` est fabriqué par `node tools/build.js` (un fichier `PPM_Core.gs` + six pages avec le style et la bannière intégrés + le manifeste) ; ne jamais le modifier à la main.
- **Vues** (`32_Views.gs`) : les tables sont lues une fois par requête (`loadPlanningData_`), puis traitées en mémoire (`memoryLookup`, `holidayResolver`). Jamais de `repoGet` dans une boucle : chaque lecture de feuille coûte cher.

## Règles à ne jamais enfreindre

1. **Gemini et le Core ne modifient jamais le planning d'eux-mêmes** (H7) : pas de recalcul automatique des dates. Le moteur de règles produit des constats (`Insight`) et des propositions ; un humain décide.
2. **Toute écriture passe par `repoInsert` / `repoUpdate` / `repoSoftDelete`** : verrou, version, contrôle, journal et crochets. Jamais de `setValues` direct sur une table vivante.
3. **Jamais de suppression physique** : `deleted = TRUE`.
4. **Schéma additif** : ajouter une colonne en fin de liste dans `01_Schema.gs`, relancer `setupPpm()`, régénérer `appsheet/COLONNES.md`. Ne jamais renommer ni supprimer une colonne sans script de migration approuvé.
5. **Droits** : toute action d'API appelle `requireCan(ctx, action, scope)` avec une action de `PERMISSIONS` (00_Config.gs). Une nouvelle action d'écriture ajoute sa ligne à la matrice.
6. **Plafonds Apps Script** : 6 minutes par exécution, 6 h par jour de déclencheurs, 20 déclencheurs. Tout traitement de masse se découpe en tranches avec point de reprise (voir `40_Jobs.gs`).
7. **Aucun secret dans le code** : propriétés du script uniquement.
8. **WBS limité à deux niveaux** ; dates en `AAAA-MM-JJ` ; montants en EUR, deux décimales.
9. **Rôles** : on n'attribue jamais un rôle plus élevé que le sien (`ROLE_RANK`), ni par l'API ni par AppSheet (`hookRoleAssignmentGuard`).
10. **Attributs affichables** : pour en ajouter un à la page Structure, trois endroits et pas un de plus : une ligne dans `VIEW_CATALOG` (`33_Structure.gs`), la valeur dans `buildObsTree` / `buildTeamTree` / `buildWbsTree`, et son affichage dans `personLines` ou `wbsSpec` (`Structure.html`). Ne jamais y exposer `rate_profile` (visibilité des TJM non tranchée). Les textes viennent des données : toujours `textContent` / `createTextNode`, jamais `innerHTML`.
11. **Fiches des personnes** : elles se modifient par `resources.update` ou dans AppSheet, avec les mêmes règles (`resource.edit` pour PL, DPL et CP ; chacun modifie sa fonction et son organisation). Le crochet `hookResourceGuard` annule ce qui n'est pas permis.
12. **Baselines** : une baseline ne se fige que par `baselines.create` (droit `baseline.manage`, justification obligatoire) ; ne jamais modifier `Baseline.status` directement. Les champs figés sont listés dans `BASELINE_FIELDS` : c'est la même liste qui alimente le fil des changements. Ajouter un champ figé = l'ajouter là, et à `FEED_COMPUTED` s'il est calculé.
13. **Google Workspace** : tout appel à l'agenda, à Drive ou à l'annuaire passe par `ws_()` (faux services dans les tests : variable `WORKSPACE`). Une panne de ces services ne doit jamais bloquer une saisie (try/catch, la nuit rattrape). Ne jamais supprimer un dossier Drive ni retirer un partage automatiquement. Les identifiants externes vont dans `SyncLink`, pas dans les tables métier.
14. **Mails** : un seul récapitulatif par personne et par jour (`buildDigests`, pure). Un mail immédiat n'est permis que pour répondre à une action de la personne (saisie annulée) ou pour une demande qui attend une décision.
15. **Copilote** : le modèle ne cite que des chiffres calculés par le Core (`checkGrounding` signale les autres) ; il ne lit les données que par des fonctions en lecture seule (`copilotTools_`) et n'écrit jamais ; aucune adresse, aucun montant ni taux ne lui est transmis ; chaque échange passe par `runAi_` (journal AiLog, quota). Tout nouvel usage de l'IA suit ce chemin.
16. **Version** : changer `PPM_VERSION` impose de changer la balise `<meta name="ppm-version">` des six pages ; `tools/build.js` refuse sinon et `selfCheck` le signale après installation.
17. **Édition du WBS** : les pages créent, modifient, déplacent et suppriment par `wbs.create`, `wbs.update`, `wbs.delete` (`41_Edit.gs`) et jamais par les actions génériques `workpackages.*` / `planitems.*`, qui n'ont pas les garde-fous (numérotation, niveaux, dates, suppression sans orphelin). Une suppression retire toujours les dépendances et exigences de jalon de l'élément. Les droits par carte (`canEdit`) sont calculés côté serveur dans `buildWbsTree` ; la page ne fait que les afficher, ne jamais les recalculer. Un nouveau champ éditable = sa règle dans `wbs.create` et `wbs.update`, sa valeur brute dans le nœud de `buildWbsTree`, son champ dans `openEditor` (`Structure.html`).
18. **Organisation** : un rôle s'attribue par `roles.assign` et se termine par `roles.end` (jamais en modifiant `end_date` à la main) ; la règle du rang (`bestRankOn_`) s'applique partout, y compris pour les listes proposées (`roles.options`). Une personne se retire par `people.remove` (annonce `dryRun`, puis rôles terminés et responsabilités libérées), jamais par suppression brute. Les équipes passent par `teams.*` ; les membres par `resources.update` (`team_id`, l'équipe doit exister). Les formulaires de la page Structure passent tous par `openForm` : un nouveau formulaire = une spécification de champs et un `onSubmit`.
19. **Réglages et administration** : tout réglage modifiable depuis l'interface passe par `admin.set` (`validateAdminSettings_`, pure et testée) : validation, trace dans le journal, jamais d'écriture directe des propriétés depuis une page. La clé Gemini ne se relit jamais (on ne renvoie que « définie ou non »). Toute action `admin.*` commence par `requireAdmin_`. Un nouveau réglage = une clé dans `PROP`, un champ dans `adminView_`, sa règle dans `validateAdminSettings_`, sa ligne dans `Admin.html`.
20. **Git** : le dépôt est la référence. On travaille sur une branche, `node tests/run.js` doit rester vert, `node tools/build.js` régénère `dist/` (versionné, jamais modifié à la main). Aucun secret dans le dépôt : clé Gemini, identifiants de classeurs et adresses vont dans les propriétés du script. Chaque mise en production est étiquetée (`vX.Y.Z`).

## Conventions

- Fonctions globales déclarées avec `function`, variables globales avec `var` (nécessaire aux tests hors ligne). Suffixe `_` pour les fonctions internes.
- Fonctions **pures** (calendrier, graphe, marges, droits, règles, `build*` des vues) séparées des accès Sheets : elles reçoivent leurs données en paramètre.
- Erreurs : `throw new PpmError(code, message, details)` avec `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `QUOTA`, `BUSY`, `CONFIG`.
- Messages utilisateur en français, courts, qui disent quoi faire.

## Avant de proposer une modification

1. Écrire ou adapter un test dans `tests/` (harnais : `freshCore()` donne un Core avec des tables en mémoire).
2. `node tests/run.js` doit rester entièrement vert.
3. Décrire l'impact sur AppSheet (colonnes, bots, actions) si le schéma change.
