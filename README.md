# PPM Core — lots 0, 1, 2 et 4 (version 0.5.1)

Socle de l'outil de gestion de projets et programmes, et planning graphique. Le Core est une bibliothèque Apps Script qui travaille sur deux classeurs Google Sheets. Il fournit une API JSON, le journal des changements, les droits par périmètre, les calendriers FR/DE/UK/IN, le moteur de règles, le calcul des marges, le Gantt, la page Structure (organigramme OBS et découpage WBS, avec choix des attributs affichés) et, depuis le lot 2, les baselines et leurs écarts, le fil des changements du chef de projet, un agenda et un dossier Drive par projet, un mail récapitulatif par personne et, depuis le lot 4, le copilote : synthèse chiffrée, simulation « et si… », signaux faibles, suggestions à décider et, si la DSI l'autorise, Gemini. L'interface de saisie est une application AppSheet (guide dans `appsheet/`).

Référence fonctionnelle : la spécification (sections 3 à 14).

## Contenu

| Dossier | Rôle |
| --- | --- |
| `src/` | Les sources, modulaires : un fichier par sujet. C'est ici qu'on modifie le code. |
| `dist/` | La version à installer, fabriquée depuis `src/` par `node tools/build.js` : **6 fichiers** (`PPM_Core.gs`, quatre pages, le manifeste). Ne jamais la modifier à la main. |
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
| `20_Setup.gs` | `installerPpm()` (installation en une fois), `setupPpm()`, `selfCheck()` (vérifie aussi la version de chaque page), `seedDemo()` |
| `30_Api.gs` | Web app `doPost` / `doGet` et actions de base |
| `32_Views.gs` | Gantt projet, vue programme, organisation (OBS), attribution des rôles, pages web |
| `33_Structure.gs` | Fonction et organisation des personnes, arbres OBS (rôles, équipes) et WBS, catalogue des attributs affichables, préférences par utilisateur |
| `34_Baselines.gs` | Lot 2 : baselines (demande, gel, refus, réactivation), écarts, fil des changements à valider |
| `35_Workspace.gs` | Lot 2 : agenda Google et dossier Drive par projet, annuaire, import de personnes depuis une feuille |
| `36_Digest.gs` | Lot 2 : mail récapitulatif (un par personne, quotidien ou hebdomadaire), réglages personnels |
| `37_Simulation.gs` | Lot 4 : simulation « et si… », synthèse chiffrée d'un projet, signaux faibles (sans IA) |
| `38_Copilot.gs` | Lot 4 : copilote (modes off, manual, api), garde-fou des chiffres, journal AiLog, quota, questions, décisions sur les suggestions |
| `40_Jobs.gs` | Traitement nocturne par tranches (journal, règles, agenda et Drive, annuaire, sauvegardes), récapitulatif de 7 h |
| `Gantt.html` | Page du planning (Frappe Gantt 0.6.1, chargé depuis jsDelivr) |
| `Structure.html` | Page Structure : OBS et WBS dessinés en SVG, sans bibliothèque externe |
| `Suivi.html` | Page Suivi : écarts à la baseline, changements à valider, baselines, agenda et Drive, mes notifications |
| `Copilote.html` | Page Copilote : synthèse, simulation, questions, suggestions |
| `Header.html` | Bannière commune (navigation, bouton jour/nuit), données préchargées et fenêtres d'information (inclus par `include('Header')`) |
| `Style.html` | Charte graphique commune, thèmes jour et nuit (inclus par `include('Style')`) |

## Déploiement (compte propriétaire : Max, environ 15 minutes)

Le pas à pas détaillé est dans `PREMIERS_PAS.md`. En résumé :

1. **Ranger dans un Drive partagé** : créer un Drive partagé « PPM » et y placer le projet Apps Script, les classeurs, les sauvegardes et un dossier « PPM Sources ». L'outil n'est alors pas lié à un compte personnel.
2. **Créer le projet** : sur script.google.com, *Nouveau projet* nommé **PPM Core**, puis cocher « Afficher le fichier manifeste » dans *Paramètres du projet*.
3. **Copier les 6 fichiers de `dist/`** : `PPM_Core.gs` (à la place de `Code.gs`), les pages `Gantt`, `Structure`, `Suivi`, `Copilote` (fichiers *HTML*, sans l'extension) et `appsscript.json` (il active le service avancé « Google Calendar API », qui sert à partager l'agenda d'un projet à ses membres). Ou bien les envoyer d'un coup avec `clasp` (voir `PREMIERS_PAS.md`).
4. **Installer** : exécuter `installerPpm` et accepter les autorisations. Il règle le domaine et l'administrateur d'après ton compte (propriétés `PPM_DOMAIN`, `PPM_ADMINS`, sans rien écraser s'ils existent), crée les classeurs **PPM Données** et **PPM Historique**, installe les déclencheurs (nuit à 2 h, récapitulatif à 7 h) et vérifie l'installation. Ajouter ensuite un second administrateur dans `PPM_ADMINS` (adresses séparées par des virgules) et déplacer les classeurs dans le Drive partagé.
5. **Données d'essai** (facultatif) : exécuter `seedDemo`.
6. **Publier** : *Déployer → Nouveau déploiement → Application Web*, « Exécuter en tant que : moi », « Accès : tous les utilisateurs du domaine ». Noter l'URL `/exec`.
7. **Ouvrir les pages** : `<URL /exec>?view=gantt`, `?view=structure`, `?view=suivi`, `?view=copilote` (avec `&project=<id>` pour un projet précis ; `&tab=…` pour un onglet).
8. **AppSheet** : suivre `appsheet/APPSHEET_SETUP.md` (sections 1 à 9, puis 10 et 11 pour le lot 1, 12 pour le lot 2). `PPM_APPSHEET_URL` (propriété facultative) = l'URL de l'application, une fois créée.

**Pourquoi un fichier unique ?** Apps Script n'a pas de modules : tous les fichiers `.gs` partagent le même espace et sont chargés dans l'ordre où ils apparaissent dans l'éditeur. Réunir les sources dans `PPM_Core.gs` ne change rien au fonctionnement (la suite de tests tourne à l'identique sur les deux : `PPM_BUNDLE=dist/PPM_Core.gs node tests/run.js`), supprime le risque d'un mauvais ordre de fichiers (qui empêche tout le script de se charger) et ramène l'installation à 6 copier-coller. La modularité reste entière dans `src/`, où l'on travaille.

Facultatif (lot 2) :

- `PPM_PROJECTS_FOLDER_ID` (propriété du script) = l'identifiant d'un dossier du Drive partagé « PPM » où ranger les dossiers des projets. Sans elle, un dossier « PPM Projets » est créé dans ton Drive.
- `PPM_LOGO_URL` (0.5.1) = adresse `https://…` du logo officiel Airbus, à prendre sur le portail de marque interne (accès réservé aux salariés). Sans elle, la bannière affiche seulement « PPM ». Le logo n'est pas fourni avec l'outil.
- `PPM_AI_MODE` (lot 4) = `off` (par défaut : aucune IA), `manual` (le copilote prépare des textes à coller dans Gemini) ou `api` (appel direct). Pour `api`, avec l'accord de la DSI seulement (H12) : `PPM_GEMINI_API_KEY` (la clé, jamais dans le code), `PPM_GEMINI_MODEL` (le nom du modèle validé), `PPM_AI_DAILY_QUOTA` (30 demandes par personne et par jour par défaut), et ajouter `"https://www.googleapis.com/auth/script.external_request"` dans `oauthScopes` du manifeste. Le premier branchement réel est à vérifier sur une question simple : il n'a pu être testé qu'avec un faux modèle.
- **Annuaire** : pour qu'une adresse suffise à créer une personne (nom, fonction, service repris de l'annuaire), ajouter le service avancé « Admin SDK API » dans l'éditeur et la ligne `"https://www.googleapis.com/auth/admin.directory.user.readonly"` dans `oauthScopes`. À ne faire qu'avec l'accord de la DSI : si le domaine bloque cette autorisation, tout le script reste bloqué. Sinon, importer une liste depuis une feuille : `importPeopleFromSheet("https://docs.google.com/spreadsheets/d/…")` (colonnes reconnues : Nom, E-mail, Fonction, Organisation, Pays, Type, Fournisseur, Équipe).

Ne jamais partager les classeurs avec les utilisateurs : ils passent par AppSheet, le Gantt ou l'API.

Comme la web app s'exécute sous ton compte, les notifications partent de ton adresse et consomment tes quotas (1 500 destinataires par jour). Le récapitulatif s'arrête avant d'épuiser le quota et prévient les administrateurs s'il a dû en reporter. Les agendas de projet sont aussi créés sous ton compte.

## Mettre à jour le code (avec Git)

Le dépôt Git est la référence du code ; Apps Script n'en est que le lieu d'exécution.

1. Travailler sur une branche : `git switch -c ma-modification`.
2. Modifier `src/`, tester hors ligne : `node tests/run.js` doit rester entièrement vert.
3. Changer `PPM_VERSION` (`00_Config.gs`) et la balise `ppm-version` des quatre pages, puis fabriquer : `node tools/build.js` (il refuse une page dont la version ne correspond pas). `dist/` est versionné : il doit toujours correspondre aux sources.
4. Valider et pousser : `git add -A && git commit -m "…" && git push`, puis fusionner la branche.
5. Mettre en production : remplacer le contenu des 6 fichiers du dossier `dist/` dans le projet Apps Script (ou `clasp push -f` depuis `dist/`), puis exécuter `installerPpm`.
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
| Copilote (lot 4) | `copilot.status`, `copilot.brief`, `simulations.run`, `copilot.ask`, `copilot.feedback`, `copilot.suggestions`, `insights.decide` |

## Tests

```bash
node tests/run.js                    # 99 tests : calendriers, graphe, droits, journal, règles, API, marges, vues, personnes, OBS, WBS,
                                     # préférences, baselines, écarts, fil des changements, agenda, Drive, annuaire, récapitulatif,
                                     # simulation, synthèse, copilote (faux modèle), signaux faibles, fabrication, installation
node tools/build.js                  # fabrique dist/ (6 fichiers)
PPM_BUNDLE=dist/PPM_Core.gs node tests/run.js   # la même suite, sur le fichier unique
node tests/gen_appsheet_columns.js   # régénère appsheet/COLONNES.md après une évolution du schéma

# Essai des pages dans un navigateur simulé (demande des paquets npm) :
npm i --no-save jsdom@24 frappe-gantt@0.6.1
node tests/ui_smoke.js        # page Gantt
node tests/ui_structure.js    # page Structure
node tests/ui_suivi.js        # page Suivi et baseline du Gantt
node tests/ui_copilote.js     # page Copilote, dans les trois modes

# Aperçu visuel des pages avec un jeu de données fourni, Agenda et Drive simulés (hors production) :
node tests/preview_server.js 8123   # puis http://localhost:8123/?view=suivi&project=p1 (ou view=gantt, view=structure)
```

Les tests chargent les fichiers `.gs` tels quels, avec des tables en mémoire à la place de Sheets et de faux services Agenda, Drive et annuaire. Tout changement du Core doit les garder verts.

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
- Copilote : sans décision sur H12, il fonctionne sans IA (mode `off`) ou en préparant des textes à coller dans Gemini (`manual`). Le mode `api` n'a été testé qu'avec un faux modèle.
- Simulation : elle mesure l'effet d'une hypothèse sur le plan tel qu'il est ; les dépendances déjà non respectées restent en l'état (elles sont signalées). Avancer un élément ne tire pas ses successeurs.
- Reste à faire au lot 4 : flash report COPIL dans Slides, relances ciblées, saisie assistée (livrables et risques depuis un texte), comptes rendus vers données, premier WBS, estimation assistée, dossier de revue de jalon, retour d'expérience. La proposition de mapping d'actuals viendra avec le lot 3.
