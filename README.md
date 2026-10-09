# PPM Core — lots 0, 1, 2 et 4 (version 0.13.0)

Socle de l'outil de gestion de projets et programmes, et planning graphique. Le Core est une bibliothèque Apps Script qui travaille sur deux classeurs Google Sheets. Il fournit une API JSON, le journal des changements, les droits par périmètre, les calendriers FR/DE/UK/IN, le moteur de règles, le calcul des marges, le Gantt, la page Structure (organigramme OBS et découpage WBS, avec choix des attributs affichés) et, depuis le lot 2, les baselines et leurs écarts, le fil des changements du chef de projet, un agenda et un dossier Drive par projet, un mail récapitulatif par personne et, depuis le lot 4, le copilote : synthèse chiffrée, simulation « et si… », signaux faibles, suggestions à décider et, si la DSI l'autorise, Gemini. L'interface de saisie est une application AppSheet (guide dans `appsheet/`).

Référence fonctionnelle : la spécification (sections 3 à 14).

## Contenu

| Dossier | Rôle |
| --- | --- |
| `src/` | Les sources, modulaires : un fichier par sujet. C'est ici qu'on modifie le code. |
| `dist/` | La version à installer, fabriquée depuis `src/` par `node tools/build.js` : **12 fichiers** (`PPM_Core.gs`, dix pages, le manifeste). Ne jamais la modifier à la main. |
| `tools/` | `build.js`, qui fabrique `dist/` |
| `PREMIERS_PAS.md` | Installation et premiers essais, pas à pas |
| `tests/` | Tests hors ligne (Node 18+) : `node tests/run.js` |
| `appsheet/` | Configuration de l'application AppSheet ; `COLONNES.md` est généré depuis le schéma |
| `client/` | `PpmClient.gs`, bibliothèque cliente pour les futurs addons |
| `GEMINI.md` | Contexte à donner à Gemini pour faire évoluer le Core |

| Fichier | Contenu |
| --- | --- |
| `00_Config.gs` | Version, seuils, rôles et leur rang, matrice des droits, propriétés |
| `01_Schema.gs` | Les 28 tables, contrôles, champs calculés |
| `02_Util.gs` | Erreurs, horloge, identifiants, empreintes, mails |
| `03_Calendar.gs` | Fériés calculés et jours ouvrés |
| `04_Graph.gs` | Cycles et violations de dépendances |
| `05_Rbac.gs` | Droits par périmètre (programme ⊃ projet ⊃ WP ⊃ livrable) |
| `06_Rules.gs` | Contrôles déterministes → Insights |
| `07_Schedule.gs` | Marges totales et chemin critique sur les dates saisies |
| `10_Repository.gs` | Accès Sheets, verrou, versions |
| `11_ChangeLog.gs` | Journal, instantanés, point d'entrée AppSheet `onRowChanged`, contrôles des saisies AppSheet |
| `000_Menu.gs` | Les sept points d'entrée à lancer à la main, placés **en tête** du fichier fabriqué et de la liste des fonctions de l'éditeur : `A1_INSTALLER_PPM`, `A2_SEED_DEMO`, `A3_VERIFIER_INSTALLATION`, `A4_DIAGNOSTIC_ACCES`, `A5_INSTALLER_DECLENCHEURS` |
| `20_Setup.gs` | `installerPpm_()` (installation en une fois), `setupPpm()`, `selfCheck()` (vérifie aussi la version de chaque page), `diagnosticAcces_()` |
| `30_Api.gs` | Web app `doPost` / `doGet` et actions de base |
| `31_Pages.gs` | 0.12.2 : rendu des pages web (tables déduites du registre, données préchargées, assemblage d'une page) |
| `32_Views.gs` | Gantt projet, vue programme, organisation (OBS), attribution des rôles |
| `33_Structure.gs` | Fonction et organisation des personnes, arbres OBS (rôles, équipes) et WBS, catalogue des attributs affichables, préférences par utilisateur |
| `34_Baselines.gs` | Lot 2 : baselines (demande, gel, refus, réactivation), écarts, fil des changements à valider |
| `35_Workspace.gs` | Lot 2 : agenda Google et dossier Drive par projet, annuaire, import de personnes depuis une feuille |
| `36_Digest.gs` | Lot 2 : mail récapitulatif (un par personne, quotidien ou hebdomadaire), réglages personnels |
| `37_Simulation.gs` | Lot 4 : simulation « et si… », synthèse chiffrée d'un projet, signaux faibles (sans IA) |
| `43_Budget.gs` | 0.9.0 : CPN (projet et sous-projet), grille de taux, lignes de budget et étalement, bilan par CPN |
| `45_Overview.gs` | 0.10.0 : page Overview : création et renommage de projet, indicateurs délais, qualité et coût |
| `46_Resources.gs` | 0.10.0 : page Ressources : personnes, équipes, rôle de projet, taux journalier par personne |
| `00_Pages.gs` | 0.12.1 : registre des pages, source unique lue par le serveur, la fabrication, les aperçus et les tests |
| `47_Demo.gs` | 0.11.0 : démo complète (`seedDemo_()`), découpée en 17 étapes qui reprennent là où elles se sont arrêtées ; 0.12.0 : réunions, actions et synthèse du fil d'actualités |
| `47_DemoData.gs`, `47_DemoClean.gs` | 0.12.2 : les données de la démo ; `A6_EFFACER_ANCIENNE_DEMO` (suppression de l'ancienne démo). Les étapes restent dans `47_Demo.gs` |
| `48_NewsText.gs`, `49_NewsCollect.gs` | 0.12.2 : lecture des textes et rattachement des réunions (calcul sans service Google) ; collecteur d'agenda et déclencheur. Le reste du module est dans `48_News.gs` |
| `48_News.gs` | 0.12.0 : fil d'actualités du projet (lecture des comptes rendus, rattachement des réunions, actions, synthèse du matin, journal du projet, collecteur d'agenda) |
| `44_Orders.gs` | 0.9.0 : commandes d'achat (PO) : saisie, statuts, répartition par livrable, constats et rappels de GR |
| `42_Org.gs` | 0.8.0 : dépendances d'un élément (`deps.item`), rôles attribuables (`roles.options`), retrait d'une personne, équipes hiérarchiques (`teams.*`) |
| `41_Edit.gs` | 0.7.0 : création, modification, déplacement et suppression sûre du WBS (`wbs.create`, `wbs.update`, `wbs.delete`) |
| `39_Account.gs` | 0.6.0 : Mon compte (`account.get`) et Administration (`admin.*` : réglages validés, santé, journaux, jours fériés) |
| `38_CopilotKey.gs` | 0.13.0 : clé Gemini personnelle de chaque utilisateur (stockage privé, vérification chez Google, test, choix du modèle) |
| `38_Copilot.gs` | Lot 4 : copilote (modes off, manual, api), garde-fou des chiffres, journal AiLog, quota, questions, décisions sur les suggestions |
| `40_Jobs.gs` | Traitement nocturne par tranches (journal, règles, agenda et Drive, annuaire, sauvegardes), récapitulatif de 7 h |
| `Gantt.html` | Page du planning (Frappe Gantt 0.6.1, chargé depuis jsDelivr) |
| `Structure.html` | Page OBS/WBS (anciennement Structure) : mise en page, marquage, assemblage des deux schémas (organisation et découpage) dessinés en SVG sans bibliothèque externe. 0.12.2 : le code est coupé en six morceaux inclus dans l'ordre, voir ci-dessous |
| `StructureState.html`, `StructureDraw.html`, `StructureLoad.html`, `StructureDetail.html`, `StructureEdit.html`, `StructureOrg.html` | 0.12.2 : morceaux de `Structure.html` (état et choix d'affichage ; mise en page, cartes et dessin ; chargement et sélecteurs ; panneau de détail ; création et édition du WBS ; dépendances, rôles, personnes et équipes). Ils partagent la fermeture de `createStructure` : un morceau n'est pas un module indépendant |
| `Suivi.html` | Page Suivi : écarts à la baseline, changements à valider, baselines, agenda et Drive, mes notifications |
| `Overview.html` | Page d'accueil : verdict, indicateurs délais, qualité, coût, portefeuille, création de projet |
| `Ressources.html` | Page Ressources : personnes, équipes, rôle dans le projet, taux, accès |
| `Actualites.html` | Page Actualités : synthèse du matin, actions issues des réunions, fil des réunions, réunions à trier, ajout d'un compte rendu, repères et journal |
| `Budget.html` | Page Budget : bilan par CPN, achats (PO), lignes de budget |
| `Compte.html` | Page Mon compte : fiche, rôles en lecture seule, notifications, affichage (thème, page d'accueil) |
| `Admin.html` | Page Administration (réservée aux administrateurs) : réglages, santé, jours fériés, journaux |
| `Copilote.html` | Page Copilote (0.13.0) : obtenir et enregistrer sa clé Gemini en trois gestes ; masquée tant que le copilote n'est pas activé par un administrateur. Les synthèses, questions et suggestions reviendront sur cette page |
| `Header.html` | Bannière commune (navigation, bouton jour/nuit), données préchargées et fenêtres d'information (inclus par `include('Header')`) |
| `Style.html` | Charte graphique commune, thèmes jour et nuit, composants CSS communs (inclus par `include('Style')`) |
| `CommonForms.html` | 0.12.3 : formulaire générique et fenêtre de confirmation (`ppm.forms`), inclus par les seules pages qui en ont (Budget, Overview, Ressources, Structure ; champ `shared` du registre) |
| `21_LiveTest.gs` | 0.12.3 : `A7_TESTER_DANS_APPS_SCRIPT`, test de contrôle en lecture seule avec les vrais services Google |
| `Common.html` | 0.12.1 : outils JavaScript communs à toutes les pages (`ppm.el`, `ppm.call`, `ppm.toast`, `ppm.frDate`…), inclus par `include('Common')` |

## Déploiement (compte propriétaire : Max, environ 15 minutes)

Le pas à pas détaillé est dans `PREMIERS_PAS.md`. En résumé :

1. **Ranger dans un Drive partagé** : créer un Drive partagé « PPM » et y placer le projet Apps Script, les classeurs, les sauvegardes et un dossier « PPM Sources ». L'outil n'est alors pas lié à un compte personnel.
2. **Créer le projet** : sur script.google.com, *Nouveau projet* nommé **PPM Core**, puis cocher « Afficher le fichier manifeste » dans *Paramètres du projet*.
3. **Copier les 12 fichiers de `dist/`** : `PPM_Core.gs` (à la place de `Code.gs`), les pages `Gantt`, `Structure`, `Suivi`, `Copilote`, `Compte`, `Admin`, `Budget`, `Overview`, `Ressources`, `Actualites` (fichiers *HTML*, sans l'extension) et `appsscript.json` (il active le service avancé « Google Calendar API », qui sert à partager l'agenda d'un projet à ses membres). Ou bien les envoyer d'un coup avec `clasp` (voir `PREMIERS_PAS.md`).
4. **Installer** : dans la liste des fonctions de l'éditeur, **la première** est `A1_INSTALLER_PPM` : l'exécuter et accepter les autorisations. Il règle le domaine et l'administrateur d'après ton compte (propriétés `PPM_DOMAIN`, `PPM_ADMINS`, sans rien écraser s'ils existent), crée les classeurs **PPM Données** et **PPM Historique**, installe les déclencheurs (nuit à 2 h, récapitulatif à 7 h) et vérifie l'installation. Ajouter ensuite un second administrateur dans `PPM_ADMINS` (adresses séparées par des virgules) et déplacer les classeurs dans le Drive partagé.
5. **Données d'essai** (facultatif) : exécuter `A2_SEED_DEMO`, la deuxième de la liste. La démo est complète (voir « Démo complète » plus bas) ; elle représente plusieurs centaines d'écritures et s'arrête avant la limite de 6 minutes d'Apps Script : **relancer `A2_SEED_DEMO` jusqu'à « Démo complète »**, elle reprend à l'étape suivante. Une démo déjà complète n'est jamais recréée.
6. **Publier** : *Déployer → Nouveau déploiement → Application Web*, « Exécuter en tant que : moi », « Accès : tous les utilisateurs du domaine ». Noter l'URL `/exec`.
7. **Ouvrir les pages** : `<URL /exec>?view=gantt`, `?view=structure`, `?view=suivi`, `?view=copilote`, `?view=compte`, `?view=admin`, `?view=budget`, `?view=overview` (page d'accueil), `?view=ressources` (avec `&project=<id>` pour un projet précis ; `&tab=…` pour un onglet).
8. **AppSheet** : suivre `appsheet/APPSHEET_SETUP.md` (sections 1 à 9, puis 10 et 11 pour le lot 1, 12 pour le lot 2). `PPM_APPSHEET_URL` (propriété facultative) = l'URL de l'application, une fois créée.

**Pourquoi un fichier unique ?** Apps Script n'a pas de modules : tous les fichiers `.gs` partagent le même espace et sont chargés dans l'ordre où ils apparaissent dans l'éditeur. Réunir les sources dans `PPM_Core.gs` ne change rien au fonctionnement (la suite de tests tourne à l'identique sur les deux : `PPM_BUNDLE=dist/PPM_Core.gs node tests/run.js`), supprime le risque d'un mauvais ordre de fichiers (qui empêche tout le script de se charger) et ramène l'installation à 6 copier-coller. La modularité reste entière dans `src/`, où l'on travaille.

Facultatif (lot 2) :

- `PPM_PROJECTS_FOLDER_ID` (propriété du script) = l'identifiant d'un dossier du Drive partagé « PPM » où ranger les dossiers des projets. Sans elle, un dossier « PPM Projets » est créé dans ton Drive.
- `PPM_REMINDER_ON` (`oui` par défaut, `non` pour tout désactiver) et `PPM_REMINDER_DAYS` (10 par défaut) (0.9.1) : rappels avant livraison ; se règlent plutôt dans Administration → Réglages.
- `PPM_LOGO_URL` (0.5.1) = adresse `https://…` du logo officiel Airbus, à prendre sur le portail de marque interne (accès réservé aux salariés). Sans elle, la bannière affiche seulement « PPM ». Le logo n'est pas fourni avec l'outil.
- `PPM_AI_MODE` (lot 4) = `off` (par défaut : aucune IA), `manual` (le copilote prépare des textes à coller dans Gemini) ou `api` (appel direct). Pour `api`, avec l'accord de la DSI seulement (H12) : `PPM_GEMINI_API_KEY` (la clé, jamais dans le code), `PPM_GEMINI_MODEL` (le nom du modèle validé), `PPM_AI_DAILY_QUOTA` (30 demandes par personne et par jour par défaut), et ajouter `"https://www.googleapis.com/auth/script.external_request"` dans `oauthScopes` du manifeste. Le premier branchement réel est à vérifier sur une question simple : il n'a pu être testé qu'avec un faux modèle.
- **Annuaire** : pour qu'une adresse suffise à créer une personne (nom, fonction, service repris de l'annuaire), ajouter le service avancé « Admin SDK API » dans l'éditeur et la ligne `"https://www.googleapis.com/auth/admin.directory.user.readonly"` dans `oauthScopes`. À ne faire qu'avec l'accord de la DSI : si le domaine bloque cette autorisation, tout le script reste bloqué. Sinon, importer une liste depuis une feuille : `importPeopleFromSheet("https://docs.google.com/spreadsheets/d/…")` (colonnes reconnues : Nom, E-mail, Fonction, Organisation, Pays, Type, Fournisseur, Équipe).

Ne jamais partager les classeurs avec les utilisateurs : ils passent par AppSheet, le Gantt ou l'API.

Comme la web app s'exécute sous ton compte, les notifications partent de ton adresse et consomment tes quotas (1 500 destinataires par jour). Le récapitulatif s'arrête avant d'épuiser le quota et prévient les administrateurs s'il a dû en reporter. Les agendas de projet sont aussi créés sous ton compte.

## Mettre à jour le code (avec Git)

Le dépôt Git est la référence du code ; Apps Script n'en est que le lieu d'exécution.

1. Travailler sur une branche : `git switch -c ma-modification`.
2. Modifier `src/`, tester hors ligne : `node tests/run.js` doit rester entièrement vert.
3. Changer `PPM_VERSION` (`00_Config.gs`) et la balise `ppm-version` des neuf pages, puis fabriquer : `node tools/build.js` (il refuse une page dont la version ne correspond pas). `dist/` est versionné : il doit toujours correspondre aux sources.
4. Valider et pousser : `git add -A && git commit -m "…" && git push`, puis fusionner la branche.
5. Mettre en production : remplacer le contenu des 12 fichiers du dossier `dist/` dans le projet Apps Script (ou `clasp push -f` depuis `dist/`), puis exécuter `A1_INSTALLER_PPM`.
6. *Déployer → Gérer les déploiements → Modifier (crayon) → Version : nouvelle version*. L'URL `/exec` ne change pas, AppSheet continue de fonctionner.
7. Poser une étiquette sur la version publiée : `git tag v0.5.1 && git push --tags`. Elle remplace l'archive déposée dans « PPM Sources » (on peut en garder une copie).
8. Retour arrière : même écran Apps Script, choisir la version précédente ; côté code, `git revert`.

**Ce qui ne doit jamais entrer dans le dépôt** : clé Gemini, identifiants de classeurs, adresses de personnes, données réelles. Tout cela vit dans les propriétés du script (`PPM_GEMINI_API_KEY`, `PPM_DATA_ID`…), jamais dans le code. Le fichier `.gitignore` écarte aussi `node_modules/` et `.clasp.json`.

## Vérifier l'API

Depuis un autre projet Apps Script du domaine, avec `client/PpmClient.gs` et la propriété `PPM_CORE_URL` :

```js
function essai() {
  Logger.log(ppmCall('ping', {}));
  Logger.log(ppmCall('me.roles', {}));
}
```

Actions disponibles :

| Domaine | Actions |
| --- | --- |
| Général | `ping`, `me.roles` |
| Structure | `programs.list/create`, `projects.list/get/create/update`, `workpackages.list/create/update/delete`, `planitems.list/get/create/update/delete`, `dependencies.list/create/delete` |
| Planning (lot 1) | `planning.catalog`, `gantt.project`, `gantt.program` |
| Organisation (lot 1) | `obs.list`, `obs.tree`, `obs.teams`, `roles.assign`, `roles.end` |
| Structure (lot 1) | `wbs.tree`, `views.config`, `prefs.set` |
| Personnes (lot 1) | `resources.list`, `resources.create`, `resources.update` |
| Avancement et alertes | `progress.declare`, `changes.since`, `insights.list` |
| Baselines (lot 2) | `baselines.list`, `baselines.request`, `baselines.create`, `baselines.activate`, `baselines.refuse`, `baselines.diff` |
| Fil des changements (lot 2) | `changes.feed`, `changes.ack` |
| Workspace (lot 2) | `workspace.status`, `workspace.enable`, `workspace.sync` |
| Notifications (lot 2) | `settings.get`, `settings.set`, `digest.preview` |
| Budget et achats (0.9.0) | `cpn.set`, `budget.access`, `budget.get`, `budget.balance`, `budget.line.save`, `budget.line.delete`, `budget.phasing.set`, `rates.list`, `rates.set`, `rates.delete`, `rates.people`, `rates.assign`, `po.options`, `po.list`, `po.save`, `po.status`, `po.delete` |
| Organisation (0.8.0) | `deps.item`, `dependencies.update`, `roles.options`, `people.remove`, `teams.create`, `teams.update`, `teams.delete` (avec `dependencies.create/delete`, `roles.assign/end`, `resources.*`) |
| Édition du WBS (0.7.0) | `wbs.create`, `wbs.update`, `wbs.delete` (les actions `workpackages.*` et `planitems.*` restent disponibles pour l'API) |
| Compte et administration (0.6.0) | `account.get`, `ui.set` ; réservées aux administrateurs : `admin.get`, `admin.set`, `admin.health`, `admin.logs`, `admin.holidays`, `admin.holidays.seed`, `admin.holidays.set` |
| Copilote (lot 4, refusées tant que le copilote est en suspens) | `copilot.status`, `copilot.brief`, `simulations.run`, `copilot.ask`, `copilot.feedback`, `copilot.suggestions`, `insights.decide` |

## Tests

```bash
node tests/run.js                    # 177 tests : calendriers, graphe, droits, journal, règles, API, marges, vues, personnes, OBS, WBS,
                                     # préférences, baselines, écarts, fil des changements, agenda, Drive, annuaire, récapitulatif,
                                     # simulation, synthèse, copilote (faux modèle), signaux faibles, fabrication, installation
node tools/build.js                  # fabrique dist/ (12 fichiers)
PPM_BUNDLE=dist/PPM_Core.gs node tests/run.js   # la même suite, sur le fichier unique
node tests/gen_appsheet_columns.js   # régénère appsheet/COLONNES.md après une évolution du schéma

# Essai des pages dans un navigateur simulé (demande des paquets npm) :
npm i --no-save jsdom@24 frappe-gantt@0.6.1
node tests/ui_smoke.js        # page Gantt
node tests/ui_structure.js    # page OBS/WBS : organisation et découpage empilés
node tests/ui_suivi.js        # page Suivi et baseline du Gantt
node tests/ui_copilote.js     # page Copilote : clé Gemini (coller, enregistrer, tester, supprimer, refus de Google)
node tests/test_copilot_key.js  # (inclus dans run.js) clé personnelle : empreinte, isolation, jamais renvoyée ni journalisée
node tests/ui_compte.js       # pages Mon compte et Administration
node tests/ui_edit.js         # création et édition du WBS dans la page Structure
node tests/ui_org.js          # dépendances, rôles, personnes et équipes dans la page Structure
node tests/ui_budget.js       # page Budget : bilan, PO, lignes de budget
node tests/ui_overview.js     # page Overview : indicateurs, création et renommage de projet
node tests/ui_ressources.js   # page Ressources : personnes, équipes, rôles, taux, accès
node tests/test_pages.js        # (inclus dans run.js) cohérence du registre des pages, de la barre du haut et des fichiers
node tests/test_livetest.js     # (inclus dans run.js) le test A7 lui-même : lecture seule, détection de vrais défauts
node tests/ui_news.js         # page Actualités, carte de l'Overview, « Mes actions » de Mon compte
node tests/ui_nav.js          # barre du haut : pas de menu d'onglets, projet courant d'une page à l'autre, lien du copilote

# Aperçu visuel des pages avec un jeu de données fourni, Agenda et Drive simulés (hors production) :
node tests/preview_demo.js 8124     # aperçu de la démo complète, puis http://localhost:8124/?view=overview
node tests/preview_server.js 8123   # puis http://localhost:8123/?view=suivi&project=p1 (ou view=gantt, view=structure)
```

Les tests chargent les fichiers `.gs` tels quels, avec des tables en mémoire à la place de Sheets et de faux services Agenda, Drive et annuaire. Tout changement du Core doit les garder verts.

## Démo complète et points d'entrée de l'éditeur (0.11.0)

- **Remplacer l'ancienne démo** (`A6_EFFACER_ANCIENNE_DEMO`, `47_Demo.gs`) : l'ancienne démo (jusqu'en 0.10.0) était le programme `DEMO`, projet `PILOTE`, avec deux personnes fictives ; elle n'empêche pas la nouvelle de se créer, mais elle reste à côté (et une homonyme « Camille Durand » en double). A6 la supprime avec tout ce qui s'y est rattaché en l'essayant : découpage, planning, dépendances, budget et étalements, commandes d'achat, baselines, risques, rôles, et les deux personnes fictives si plus rien d'autre ne les cite. **Deux lancements** : le premier annonce ce qui serait supprimé et ne touche à rien (propriété `PPM_DEMO_CLEAN`), le second, dans les 10 minutes, supprime. Suppression douce, réversible dans les feuilles (colonne `deleted`) ; seul un administrateur la lance ; les personnes avec adresse, les autres programmes et les projets réels ne sont jamais touchés. Les éventuels agenda et dossier Drive créés pour le projet PILOTE ne sont pas supprimés. `A2_SEED_DEMO` signale à la fin si l'ancienne démo est toujours là.
- **A7_TESTER_DANS_APPS_SCRIPT** (`21_LiveTest.gs`, 0.12.3) : les tests de développement tournent hors de Google, avec de faux services. A7 se lance **dans** Apps Script et contrôle ce qu'ils ne voient pas : moteur JavaScript, services présents, fuseau horaire et changements d'heure, installation réelle, autorisation, déclencheurs, lecture réelle de l'agenda, quota de mails, et les appels de chaque page avec le compte qui l'exécute, chronométrés. **Lecture seule** : il n'écrit aucune ligne, ne crée aucun document, n'envoie aucun mail (vérifié par un test). Chaque contrôle rend OK, ATTENTION ou ÉCHEC ; le rapport est dans le journal d'exécution. Un refus de droits est normal pour un simple membre ; un service absent hors Apps Script est une attention.
- **Points d'entrée en tête de liste** : la liste des fonctions de l'éditeur Apps Script en compte plus de cent (presque toutes internes). Les six à connaître commencent par `A` et un numéro, donc passent devant quel que soit le tri, et sont aussi définies en premier dans le fichier : `A1_INSTALLER_PPM`, `A2_SEED_DEMO`, `A3_VERIFIER_INSTALLATION`, `A4_DIAGNOSTIC_ACCES`, `A5_INSTALLER_DECLENCHEURS`, `A6_EFFACER_ANCIENNE_DEMO`. Les anciens noms `installerPpm`, `seedDemo` et `diagnosticAcces` n'existent plus comme fonctions publiques (leurs implémentations finissent par `_` : elles sont privées, donc absentes de la liste). Un test vérifie cet ordre sur le fichier fabriqué.
- **Démo complète** (`A2_SEED_DEMO`) : un programme **NAC** et quatre projets aux situations contrastées. **NAC-1 « Nacelle moteur A »** est complexe : 4 workpackages et 12 sous-workpackages, 39 livrables et 9 jalons, 43 dépendances de tous types (dont des décalages négatifs), 3 CPN, du retard (livrables en retard, dépendances non respectées, jalons menacés, glissement critique sur le chemin critique, fin du plan après la fin visée), trois baselines (B0 archivée, B1 active, une demande en attente) avec des évolutions entre elles (retards, ajouts, retrait, changement de responsable), un historique d'avancement avec commentaires, 9 risques et opportunités, 39 lignes de budget (internes en jours, externes en jours ou au forfait), 10 commandes d'achat (GR en retard, PO à lancer en retard, dépassement du budget externe d'un CPN, PO sans livrable, PO hors outil). **NAC-2 « Systèmes embarqués »** est sain (avec son budget et une commande d'achat ; une PO d'un autre projet, hors de l'outil, complète le jeu), **NAC-3 « Industrialisation moteur »** est en préparation (un élément sans responsable ni date), **NAC-4 « Essais en vol »** est clos.
- **Autour** : 11 équipes sur trois niveaux, 38 personnes plus le compte qui lance la démo (30 internes, 8 externes de 4 fournisseurs, 4 pays) avec leur **taux journalier** (de 330 à 900 € par jour), plus de 80 rôles à tous les niveaux (programme, projet, workpackage), et **trois personnes sans aucun rôle** pour montrer la zone « Ressources à positionner ». Les dates se calculent à partir d'aujourd'hui.
- **Sûreté** : aucune personne fictive n'a d'adresse e-mail. Rien n'est envoyé, aucune invitation ne part, personne ne peut s'y connecter. Seul le compte qui lance la démo y figure, avec son adresse.
- **Reprise** : chaque étape est enregistrée dans la propriété `PPM_DEMO_STEP`. Si une étape échoue, le message dit laquelle, les précédentes sont conservées, et il suffit de relancer. **Limite** : il n'y a pas de fonction pour effacer la démo ; pour repartir de zéro, installer sur de nouveaux classeurs (les noms de la démo, retrouvés par leur plus récent homonyme, ne se mélangent pas à de vraies fiches).
- **Aperçu** : `node tests/preview_demo.js 8124` sert toutes les pages sur la démo complète.
- **Overview, repère « Personnes »** : il compte maintenant les membres du projet (il comptait les adresses joignables, ce qui est trompeur pour des personnes sans adresse). **Indicateur de coût** : un dépassement du budget externe sur un seul CPN le met en alerte, même si le total du projet reste sous son budget (les analyses se font par CPN).

## Copilote : la clé Gemini de chaque personne (0.13.0)

Le copilote se réactive d'une case à cocher : **Administration → Réglages → Copilote → « Activer le Copilote »** (tracé dans le journal des réglages ; il n'est plus nécessaire de toucher aux propriétés du script). Le lien « Copilote » apparaît alors dans la barre du haut après rechargement.

- **La page Copilote ne fait, pour l'instant, qu'une chose : connecter la clé Gemini de la personne.** Un gros bouton ouvre **directement** la page de Google où l'on crée la clé (`https://aistudio.google.com/apikey`, le lien officiel de la documentation de Google) ; trois gestes (ouvrir ; « Créer une clé API » puis « Copier » ; revenir « Coller » puis « Enregistrer et tester ») ; un bouton « Coller » qui lit le presse-papiers ; une aide si la création est bloquée par l'entreprise, avec **un message prêt à envoyer au support** ; un avertissement sur l'usage des données.
- **Stockage et confidentialité** : la clé est rangée dans une propriété **privée** du script, sous un nom dérivé de l'adresse par une empreinte SHA-256 (l'adresse n'y apparaît pas), **jamais dans une feuille** que l'équipe peut ouvrir. Elle n'est **jamais renvoyée** à une page ni écrite dans un journal : on ne montre que ses quatre derniers caractères. Elle ne sert qu'aux demandes de la personne qui l'a enregistrée ; à défaut de clé personnelle, la clé commune de l'administrateur (si elle existe) est utilisée. Un test vérifie que la clé n'apparaît ni dans les feuilles, ni dans le journal des changements, ni dans les réglages, ni dans le journal des échanges.
- **Vérifiée avant d'être gardée** : l'outil interroge Google (liste des modèles, clé envoyée dans l'en-tête `x-goog-api-key`, jamais dans l'adresse). Une clé que Google refuse n'est pas enregistrée, avec un message simple ; une panne ou un quota de Google n'empêche pas l'enregistrement mais est signalé. « Tester ma clé » refait la vérification en trois étapes lisibles (clé acceptée, modèle choisi, petite question à Gemini).
- **Le modèle n'est plus figé** : il se choisit dans la liste que Google renvoie pour la clé (l'alias `gemini-flash-latest` s'il existe, sinon le « flash » le plus récent, versions comparées par rangs : 3.10 > 3.9 ; jamais un modèle d'image, de voix ou d'embeddings). Le nom de modèle réglé par l'administrateur reste prioritaire.
- **Nouvelle autorisation Google** : `script.external_request` (appels vers Google), absente jusqu'ici : **réautoriser l'outil** (exécuter `A1_INSTALLER_PPM`) après la mise à jour. Un test compare désormais chaque service Google utilisé dans le code avec les autorisations du manifeste (et signale celles demandées pour rien) ; `A7_TESTER_DANS_APPS_SCRIPT` vérifie que Google répond.
- **Avant d'activer, à valider avec la DSI** (conditions de Google) : avec une clé gratuite (Google AI Studio et quota gratuit de l'API), Google peut utiliser le contenu envoyé et les réponses pour améliorer ses produits, et des personnes peuvent les relire ; avec un service payant, non. Les comptes professionnels peuvent aussi se voir interdire la création de clés par leur administrateur. Les anciennes clés « standard » sans restriction sont refusées par Google : il faut en créer une nouvelle.
- **Limites** : ni la création d'une clé, ni l'appel à Gemini n'ont été essayés avec un vrai compte Google (faux Google dans les tests) ; les synthèses, simulations, questions et suggestions du copilote ne sont plus proposées sur la page (le code serveur existe toujours) : elles reviendront une fois la connexion éprouvée.

## Fil d'actualités du projet (0.12.0, phase 1 de la spécification « step 1 et 2 »)

Une page **Actualités** (`?view=actualites`, lien dans la barre du haut) rassemble ce qui s'est dit en réunion. Visible des membres du projet (toute personne qui y a un rôle, et les administrateurs). Aucune IA n'est appelée.

- **A. Saisie manuelle** : le chef de projet colle des notes Gemini ou un compte rendu (ou le lien d'un Google Doc, lu avec le compte de l'outil). L'outil en tire un résumé, les décisions et les actions. Un même compte rendu n'est jamais ajouté deux fois.
- **D. Actions** : lues sans IA dans les « prochaines étapes » nominatives (`[Nom] action : avant le 30/10`, `Nom : action pour le 12 novembre`, `action (Nom)`) ou dans les lignes `Action : texte — Nom — date` et `Décision : texte`. Le nom est reconnu parmi les membres du projet sans ambiguïté ; sinon l'action reste « sans responsable » et le chef de projet la complète (personne, échéance, livrable). Chaque personne accepte, conteste ou déclare faite l'action qui lui est confiée (page Actualités ou **Mon compte → Mes actions**). Une contestation prévient le chef de projet par mail. Les actions en attente et celles qui arrivent à échéance figurent dans le récapitulatif du matin.
- **E. Repères** : par projet, jusqu'à dix mots (lettres, sigle, logo) qui rattachent une réunion au projet quand ils figurent dans son titre ; case « Activer la collecte automatique ».
- **F. Collecteur pilote** : deux déclencheurs, à **1 h et 13 h** (posés par `A5_INSTALLER_DECLENCHEURS`, fonction `newsCollectRun`), lisent l'**agenda du compte qui exécute les déclencheurs** (pas celui des autres membres : la spécification prévoit de commencer par le chef de projet), depuis la dernière passe. Une réunion est retenue si **au moins deux membres du projet y sont invités** ou si son **titre contient un repère** ; un repère l'emporte. Si plusieurs projets se la disputent à égalité, elle va dans la liste **« à trier »** du chef de projet (rattacher ou ignorer). Les **événements privés ou confidentiels ne sont jamais lus**, ni les annulés. Les notes jointes à l'invitation (Google Doc dont le titre évoque « Notes », « Gemini », « compte rendu », « CR », « minutes », « MoM ») sont lues et analysées. La passe est reprenable (150 secondes au plus) et ne crée jamais deux fois la même réunion.
- **B. Journal du projet** : un Google Doc tenu à jour par l'outil (fiche du projet, puis les réunions de la plus récente à la plus ancienne), créé dans le dossier Drive du projet quand il existe. Mis à jour par la collecte quand il y a du nouveau, ou à la demande (bouton). À ajouter comme source du carnet NotebookLM.
- **C. Synthèse du matin** : bouton « Copier le prompt du jour » (cinq sections : décisions, dates qui bougent, risques, blocages, actions, avec rappel des réunions) à coller dans NotebookLM ou Gemini ; bouton « Publier les actualités » : l'outil vérifie le format (au moins trois des cinq sections), publie, et prévient par mail les membres du projet qui ont une adresse. Une seule synthèse par jour et par projet (la seconde remplace la première). L'Overview montre la dernière synthèse (ou les dernières réunions) et le nombre d'actions ouvertes. Sans synthèse publiée, le récapitulatif de 7 h reprend le **journal brut** des réunions de la veille. *Écart avec la spécification : elle prévoyait un mail de repli à 9 h ; il passe dans le récapitulatif de 7 h déjà existant.*
- **Nouveau droit de Google** : l'outil lit et écrit des Google Docs (notes jointes, journal), d'où l'autorisation `documents` ajoutée au manifeste : **réautoriser l'outil** (exécuter une fonction depuis l'éditeur) après la mise à jour, et la faire valider par la sécurité informatique.
- **Données** : tables `Meeting`, `NewsAction`, `NewsDigest` ; colonnes `news_on`, `news_keywords`, `news_journal_id` du projet ; propriétés `PPM_NEWS_LAST` (fin de la dernière collecte) et `PPM_LAST_NEWS` (son résultat). Droits `news.add` et `news.manage` : PL, DPL, CP. Fonctions de calcul pures, testées sans service Google : `newsFindDate_`, `newsParseNotes_`, `newsParseActionLine_`, `newsMatchProject_`, `newsValidateDigest_`, `newsPrompt_`, `newsJournalLines_` ; l'agenda et les Docs passent par un adaptateur remplaçable (`NEWS_ADAPTER`).
- **Limites** : le collecteur et la lecture des Google Docs n'ont été essayés qu'avec un faux agenda ; l'analyse des notes repose sur la forme habituelle des notes Gemini en français, à confirmer sur un exemple réel ; pas encore de lecture des agendas des autres membres (accord de chacun et de la sécurité requis), ni de bouton « ne pas publier » par réunion.

## Pages sans onglets, OBS/WBS, copilote en suspens (0.11.0)

- **Plus aucun onglet** : chaque rubrique est une zone de la page, avec son titre, et toutes s'affichent ensemble (une zone dont on n'a pas le droit n'apparaît pas). Pages concernées : **Budget** (bilan par CPN, achats, budget par livrable), **Suivi** (écarts, changements à valider, baselines, agenda et Drive), **Mon compte** (fiche, notifications, affichage), **Administration** (réglages, santé, jours fériés, journaux) et **OBS/WBS**. Les données de toutes les zones sont préparées avec la page. Les pages restent séparées entre elles ; le menu ▾ de la barre du haut est retiré.
- **OBS/WBS** (nouveau nom de la page Structure) : l'organisation au-dessus du découpage, chacun avec sa barre d'outils, son panneau de détail et ses attributs affichés ; le sélecteur de projet ou de programme est partagé. Avec un programme choisi, le découpage demande de choisir un projet. Modifier une personne, un rôle ou une équipe recharge aussi le découpage (il affiche l'organisation de chaque responsable).
- **Ressources à positionner** : une personne créée dans Ressources n'a aucun rôle ; elle apparaît dans une zone dédiée de l'organisation (par rôles comme par équipes). Un clic sur sa pastille, puis « Positionner dans l'organigramme », ouvre l'attribution d'un rôle avec la personne et le périmètre déjà choisis. Dans Ressources, elle porte un repère « À positionner dans l'OBS ».
- **Copilote en suspens** : lien, page, réglages, santé, journaux et demandes à l'IA sont masqués ou refusés tant que la propriété `PPM_COPILOT` ne vaut pas `oui` ; rien n'est supprimé. Raison : pas de connexion automatique possible avec le compte Gemini de chaque personne (l'accès par programme passe par une clé ou Vertex AI, facturés à un projet Google Cloud).
- **Domaines autorisés** réglables dans Administration (Réglages) : au plus cinq, séparés par une virgule, sans pouvoir retirer le sien. (Annoncé à tort comme disponible en 0.10.0 : le champ n'existait pas à l'écran.)

## Overview, Ressources, charte et accès (0.10.0)

**Charte graphique** : reprise de la diapositive Airbus fournie (dégradé marine → bleu `#00205B` / `#00377A` / `#0085CA`, accent `#5FB4E5`, orange `#E8820C` réservé aux mises en garde, police Inter, libellés en capitales espacées, cartes à liseré bleu, pastilles numérotées). Les jetons sont dans `src/Style.html` ; thème nuit conservé.

**Overview projet** (`?view=overview`, page d'accueil par défaut) : créer un projet (code, nom, programme, chef de projet, dates, CPN), le renommer, et lire en un coup d'œil trois indicateurs, chacun *Maîtrisé*, en *Vigilance*, en *Alerte* ou *Non renseigné* ; le verdict global reprend le pire des trois.
- **Délais** : éléments en retard, dépendances non respectées, glissement de la fin du plan sur la baseline (alerte au-delà de 5 jours ouvrés), fin du plan face à la fin visée, avancement réel face à l'avancement attendu (alerte à 15 points d'écart).
- **Qualité** : *mesure de maîtrise*, faute de mesure de qualité propre : risques ouverts (élevé à partir de 15, critique à partir de 20), traitements en retard, jalons menacés, signaux faibles, livrables sans responsable. Registre des risques vide : non renseigné.
- **Coût** : PO engagées face au budget externe de chaque CPN (vigilance à 85 %, alerte au dépassement), GR en retard. Les montants ne s'affichent qu'avec le droit budget ; les autres voient le niveau et le pourcentage.

**Ressources** (`?view=ressources`) : un seul écran pour les personnes (créer, modifier, retirer), les équipes, le **rôle dans le projet** (chef de projet, membre, aucun : l'ancien rôle de projet est terminé et le chef de projet du projet suit) et le **taux journalier de chaque personne, interne ou externe**. Ce taux, saisi sur la fiche, remplace la grille profil × pays × date, conservée en secours côté serveur sans écran ; il se fige dans chaque ligne de budget à sa création, et ne se voit que du chef de projet et du DPL. Une ressource externe se budgète au forfait ou en jours × taux. La colonne **Accès** dit si la personne peut se connecter (adresse dans un domaine autorisé), est hors domaine ou n'a pas d'adresse.

**Projet courant** : il suit d'une page à l'autre dans la barre du haut (Overview, Ressources et Budget s'ouvrent sur le même projet que celui qu'on regarde). Le menu d'onglets ▾ introduit en 0.10.0 a disparu en 0.11.0 : voir « Pages sans onglets ».

**Mails** : tous les objets commencent par `[PPM✴️]` (`mailSubject_`, un test refuse tout envoi qui le contournerait).

**Accès par domaine** : `PPM_DOMAIN` accepte plusieurs domaines séparés par une virgule (réglables dans Administration → Réglages, sans pouvoir retirer le sien). Un refus indique le compte détecté et la marche à suivre. En cas de doute, exécuter `A4_DIAGNOSTIC_ACCES` depuis l'éditeur Apps Script : il montre le compte qui exécute, le compte détecté et les domaines autorisés.

## Rappels avant livraison (0.9.1)

Pour chaque livrable non terminé qui a un responsable et une date de livraison, l'outil ajoute **un rappel dans l'agenda du projet, daté N jours ouvrés avant la livraison, avec le responsable invité** : il apparaît dans le Google Agenda du responsable (« Rappel livraison · P1 · Calcul »). N vaut **10 par défaut** et se règle de deux façons : par l'administrateur (Administration → Réglages, délai par défaut et interrupteur général) et par chacun (Mon compte → Notifications : son propre délai, ou désinscription).

- Le rappel suit le livrable : **livraison décalée, responsable changé ou retiré, livrable terminé** (avancement à 100 %) l'adaptent ou le retirent aussitôt ; le traitement de nuit rattrape le reste, y compris un changement de délai.
- Les jours fériés du calendrier du projet comptent dans le décompte.
- Un rappel déjà créé est **conservé** quand sa date passe ; on n'en crée pas de nouveau pour une date déjà passée (un livrable créé à six jours de sa livraison n'a pas de rappel à dix jours).
- Il faut que le projet ait son agenda (page Suivi → Agenda et Drive). Aucune invitation par mail n'est envoyée.
- **Ce n'est pas une « tâche Google »** : l'outil s'exécute sous le compte du propriétaire, et l'API des tâches n'écrit que dans les listes du compte qui l'exécute, jamais dans celles d'un autre utilisateur. Le rappel est donc un événement de l'agenda, sans case à cocher.

## Budget, CPN et commandes d'achat (0.9.0)

Page **Budget** (`?view=budget`, visible des personnes internes nommées dans une équipe).

**CPN.** Le CPN est le code financier d'un projet, avec sa « désignation ». Un workpackage de premier niveau, le **sous-projet**, peut porter le sien (champs du formulaire de modification dans la page Structure). **Un CPN ne couvre qu'un seul projet**, au maximum ; le même CPN peut en revanche figurer sur un projet et sur ses propres sous-projets. Poser ou changer un CPN demande le rôle de chef de projet, DPL ou Program Leader ; un CPN qui porte des PO ne se retire ni ne se change. **Les analyses budgétaires se font par CPN** : un livrable relève du CPN de son premier workpackage ancêtre qui en porte un, à défaut de celui du projet.

**Budget** (zone « Budget par livrable » ; les taux se saisissent sur la fiche de chaque personne, dans Ressources). Une ligne relie un livrable à une ressource : *interne* = jours × taux journalier, **taux figé à la création de la ligne** (un changement de la grille n'y touche pas, sauf demande explicite) ; *externe* = forfait. L'étalement se calcule seul (interne : au prorata des jours ouvrés de chaque mois ; externe : en totalité le mois de la livraison), suit les dates du livrable, et peut être fixé à la main (la somme doit égaler le montant). La grille de taux (profil, pays, taux, date d'effet) et le profil tarifaire des personnes sont **réservés au chef de projet et au DPL** ; les autres ne voient jamais les taux. Un responsable de workpackage ne voit et n'édite que le budget de son périmètre.

**Commandes d'achat (PO).** Une PO se passe auprès d'une **ressource externe** ; son **numéro est saisi à la main** (celui de Click and Buy) et doit être unique. Elle porte un **CPN saisi à la main** : s'il correspond à un projet de l'outil (ou à l'un de ses sous-projets), le bilan budgétaire de ce projet en est impacté ; sinon la PO est enregistrée, sans effet sur aucun budget (elle apparaît dans « Mes PO hors périmètre de l'outil »).

- **Statuts** : *À faire* (prévisionnel, rien d'engagé), *Lancée* (engagée), *GR* (good receipt : prestation réceptionnée), *Terminée* (soldée). **Engagé = Lancée + GR + Terminée.**
- **Engagement en une fois** : la PO est engagée en totalité à sa date de lancement, **sans étalement** (dans la vue par mois, elle compte le mois du lancement). Sa période d'activité est indicative.
- **Répartition par livrable en montants réglables** : leur somme doit égaler le montant de la PO. Elle se compare au budget externe (forfait) de chaque livrable ; un dépassement, un livrable sans budget externe ou d'un autre CPN sont signalés sur la PO.
- **Date de GR attendue** (obligatoire tant que la PO est à faire ou lancée) : à l'approche (7 jours), puis au-delà, un rappel apparaît dans le **récapitulatif quotidien du responsable de la GR** (par défaut l'auteur de la PO) et un constat (`PO_GR_SOON`, `PO_GR_LATE`) remonte au pilotage. Autres constats : `PO_TODO_LATE` (PO à faire alors que l'activité a commencé), `PO_OVERRUN` (engagé supérieur au budget externe du CPN), `PO_UNBUDGETED`. **Aucun montant** dans les constats ni dans les mails.
- **Qui** : toute personne **interne** nommée dans l'équipe du projet (un rôle sur le projet, au-dessus, ou sur l'un de ses workpackages) crée et modifie les PO de ce projet, quel que soit son rôle ; un externe, même nommé, ne le peut pas. Une PO se supprime par son auteur ou par le pilotage du projet ; la suppression est tracée.

Le **bilan par CPN** met en regard, pour chaque CPN : budget interne, budget externe, PO à faire, engagé, réceptionné, soldé et reste sur le budget externe.

Pas encore : le réalisé (import d'actuals) et la valeur acquise (EVM), prochaine version.

## Dépendances, rôles, personnes et équipes (0.8.0)

Depuis la page **OBS/WBS** (anciennement Structure), sans AppSheet :

- **Dépendances** : la carte d'un livrable ou d'un jalon liste ses prédécesseurs et ses successeurs, avec le type de lien (fin → début, début → début, fin → fin, début → fin) et le décalage en jours ouvrés. On ajoute un lien avec un élément du projet ou d'un autre projet du même programme, on le retire d'un clic. Le serveur refuse un lien qui fermerait une boucle, un doublon, un lien d'un élément avec lui-même, et vérifie le droit d'écrire sur l'élément successeur.
- **Rôles** (organigramme par rôles) : sur la carte d'un rôle, « Ajouter une personne à ce rôle » et une croix pour retirer. Le bouton « Attribuer un rôle » de l'en-tête permet de choisir personne, périmètre et rôle. **On ne donne jamais un rôle plus élevé que le sien** sur le périmètre : la liste des rôles proposés s'adapte au périmètre choisi. Retirer un rôle le termine (il reste dans l'historique).
- **Personnes** : « Ajouter une personne » (nom, adresse, statut, pays, fonction, organisation, fournisseur, capacité, équipe) et « Modifier la fiche » pour le chef de projet, le DPL et le Program Leader ; chacun garde la modification de sa propre fonction et de sa propre organisation. « Retirer cette personne » annonce d'abord les conséquences : ses rôles se terminent, elle cesse de diriger une équipe, et ses livrables et workpackages redeviennent sans responsable (ils ressortent dans les constats). Impossible de retirer sa propre fiche.
- **Équipes** (organigramme par équipes) : créer une équipe ou une sous-équipe, la renommer, la rattacher, désigner son responsable, ajouter ou retirer des membres (une personne n'est que dans une équipe). Une équipe ne se supprime que vide, et jamais sous elle-même ni sous une de ses sous-équipes.

L'import d'un WBS depuis Google Sheets est abandonné (décision du propriétaire).

## Édition du WBS (0.7.0)

Dans la page **OBS/WBS**, zone **Découpage (WBS)** : cliquer une carte ouvre son détail ; selon vos droits, il propose **Ajouter** (sous-workpackage, livrable, jalon), **Modifier** et **Supprimer**. Le bouton **Ajouter un workpackage**, en haut de page, crée un workpackage de premier niveau. Les boutons n'apparaissent que là où le serveur autorise l'action : un simple membre n'en voit aucun ; un responsable de workpackage agit dans son workpackage et ses sous-niveaux ; le chef de projet, le DPL et le Program Leader agissent sur tout le projet.

Règles appliquées par le serveur (`41_Edit.gs`), donc aussi pour l'API :

- **Codes WBS** numérotés automatiquement (3, puis 3.1, 3.2…), uniques dans le projet ; un code saisi à la main est respecté. Déplacer un workpackage le renumérote, sauf si un code est imposé.
- **Deux niveaux** de workpackage au plus ; aucun rattachement à un autre projet ; un workpackage qui a des sous-niveaux ne peut pas devenir lui-même un sous-niveau.
- **Dates** contrôlées : la fin ne précède pas le début ; un jalon n'a qu'une date (début = fin) et une catégorie facultative (Revue, Client, Interne).
- **Déplacer** un élément ou un workpackage demande aussi le droit d'écrire à la destination.
- **Supprimer** : un workpackage non vide refuse la suppression, sauf confirmation explicite (« cascade ») qui emporte ses sous-workpackages et ses éléments. Supprimer un élément retire aussi ses liens de dépendance et ses exigences de jalon, pour ne rien laisser dans le vide. Rien n'est effacé pour de bon : les lignes sont marquées supprimées et la suppression reste dans le journal.
- L'avancement, le statut et le type d'un élément ne se modifient pas ici : l'avancement se déclare depuis le Planning.


## Mon compte et Administration (0.6.0)

**Mon compte** (`?view=compte`, icône de personne dans la bannière) : sa fiche (fonction et organisation modifiables ; le reste est géré par le chef de projet, le DPL ou le Program Leader), ses rôles en lecture seule, ses notifications (fréquence du récapitulatif, échéances dans son agenda, aperçu et envoi d'essai), son affichage (thème automatique, jour ou nuit ; page ouverte en cliquant sur « PPM »).

**Administration** (`?view=admin`, icône d'engrenage, visible des seuls administrateurs de `PPM_ADMINS`) :

- **Réglages** : administrateurs, **activation du copilote (case à cocher)**, mode du copilote, modèle, quota, clé Gemini commune, adresses AppSheet et logo, dossier des projets. Tout est validé avant écriture et chaque changement est tracé dans le journal. La clé se saisit mais ne se relit jamais ; on ne peut pas se retirer soi-même des administrateurs ; le mode `api` demande une clé et un modèle.
- **Santé** : vérification de l'installation (dont la version de chaque page), déclencheurs, résultat et durée de chaque étape de la dernière nuit, dernier récapitulatif, usage du copilote, quota de mails, volumes.
- **Jours fériés** : liste par pays et année, ajout d'années, ajustement par site (ponts, fermetures) ; les projets en tiennent compte aussitôt.
- **Journaux** : derniers changements de données et de réglages, échanges avec le copilote.

Ne se règlent toujours que dans l'éditeur Apps Script : le manifeste, les autorisations, le déploiement et les déclencheurs (`installTriggers`). Le créateur du projet est le premier administrateur : nommer un second administrateur depuis l'onglet Réglages évite que l'outil dépende d'une seule personne (décision H16).

## Performance (0.5.1)

Lire une feuille Google Sheets coûte plusieurs appels au serveur ; c'était la cause de 7 à 8 secondes d'attente sur le projet pilote. Trois mesures :

- **Cache des tables** (`CacheService`, 5 minutes au plus) : une table n'est relue dans Sheets que si elle a changé. Toute écriture du Core, et tout signal du bot AppSheet (`onRowChanged`), invalide la table concernée ; la réconciliation de nuit invalide tout. Une panne du cache ou une table trop grosse (plus d'environ 1,8 Mo) ne bloque rien : lecture directe.
- **Une lecture par table et par requête**, et les propriétés du script lues en une fois.
- **Premier écran préparé avec la page** (`preloadFor_`) : la page reçoit ses données au chargement, sans aller-retour supplémentaire. « Actualiser » interroge toujours le serveur.

Pour mesurer : ouvrir la console du navigateur (F12) ; chaque page y écrit « données préparées en … ms, page prête en … ms ». Le démarrage d'Apps Script (environ 1 seconde) est incompressible.

Limite : une saisie faite directement dans une feuille, sans passer par le Core ni par le bot AppSheet, n'apparaît qu'au plus tard 5 minutes plus tard.

## Limites connues

- Fériés : nationaux seulement. À compléter par site dans la table `HolidaySet` : Länder allemands, États indiens, fériés exceptionnels britanniques. Le lundi de Pentecôte est inclus pour la France ; le retirer si l'entreprise le travaille.
- Marges : calculées sur les dates saisies, par rapport à la fin prévue la plus tardive du périmètre. Un élément externe (autre projet) est une contrainte fixe.
- Page Structure : le WBS se lit projet par projet ; l'organisation par rôles se lit par programme ou par projet. Le texte des cartes est tronqué au-delà de leur largeur (le texte complet est dans l'info-bulle et dans le détail). Pas d'export en image pour l'instant.
- Fonction et organisation sont du texte libre (suggestions issues de l'existant) : « Alpha » et « alpha » sont deux valeurs.
- Le Gantt dessine toutes les dépendances comme des liens fin → début ; leur type (FS, SS, FF, SF) est bien pris en compte dans les calculs et la liste des écarts.
- Une attribution de rôle saisie dans AppSheet et non signalée par le bot n'est pas revérifiée par la réconciliation nocturne (l'auteur n'est pas connu à ce moment-là).
- Un Insight « Ignoré » bloque définitivement le même constat sur la même cible.
- Les mails qui répondent à une action (saisie AppSheet annulée, demande de baseline) partent aussitôt ; tout le reste est regroupé dans le récapitulatif du matin.
- Une baseline se fige depuis la page Suivi ou l'API, jamais en modifiant la ligne dans AppSheet (le Core annule ce type de modification).
- Écarts de budget : calculés dès maintenant, mais significatifs seulement quand le budget sera saisi (lot 3).
- Agenda : les événements portent la date de fin (échéance) ; une modification faite directement dans l'agenda est écrasée à la synchronisation suivante. Les suppressions d'éléments sont reportées dans l'agenda la nuit.
- Partages : l'agenda et le dossier sont partagés aux membres du projet, mais jamais retirés automatiquement à quelqu'un qui quitte le projet (à faire à la main). Un WP supprimé garde son dossier.
- Le récapitulatif n'est envoyé qu'aux adresses du domaine, les jours de semaine.
- Pas encore d'EVM ni d'import d'actuals (lot 3, en attente d'un exemple de fichier, H4).
- Copilote : **en suspens depuis 0.11.0** (réactivation : propriété `PPM_COPILOT = oui`). Sans décision sur H12, il fonctionne sans IA (mode `off`) ou en préparant des textes à coller dans Gemini (`manual`). Le mode `api` n'a été testé qu'avec un faux modèle.
- Simulation : elle mesure l'effet d'une hypothèse sur le plan tel qu'il est ; les dépendances déjà non respectées restent en l'état (elles sont signalées). Avancer un élément ne tire pas ses successeurs.
- Reste à faire au lot 4 : flash report COPIL dans Slides, relances ciblées, saisie assistée (livrables et risques depuis un texte), comptes rendus vers données, premier WBS, estimation assistée, dossier de revue de jalon, retour d'expérience. La proposition de mapping d'actuals viendra avec le lot 3.
