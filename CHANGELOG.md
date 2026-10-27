# Journal des versions

## 0.17.3 — jalons : « Mes jalons », Gantt creux ou plein, rappels

- **Page Compte, « Mes jalons »** (`milestones.mine`) : les jalons dont on est responsable (échus ou à venir sous 30 jours), tous projets confondus ; **Marquer passé** avec confirmation en deux temps ; **Rouvrir** pour ceux passés depuis 30 jours.
- **Gantt** : un jalon à venir est **creux**, un jalon passé est **plein et vert**, un jalon échu non déclaré est creux et rouge ; légende mise à jour.
- **Récapitulatif du matin** : un jalon échu est rappelé à son responsable avec « à déclarer passé ou à replanifier » et le lien du WBS ; **au bout de 7 jours** (`THRESHOLDS.milestoneStaleDays`) il est signalé aussi à ceux qui pilotent le projet ; un jalon passé n'y figure plus. L'alerte de retard d'un jalon indique la marche à suivre.
- Vérifié par essai : un jalon passé disparaît des prochains jalons de l'Overview, de ceux du prompt des actualités, et son événement d'agenda est marqué ✓.
- Tests : `test_milestone.js` (7), `ui_compte.js` (128), `ui_gantt_look.js` (35) ; dix sabotages vérifiés. **Backlog** : l'étape des jalons est faite (`BACKLOG.md`).

## 0.17.2 — jalon passé, déclaré par son responsable

- **Défaut corrigé** : un jalon n'a pas d'avancement et rien ne permettait de le déclarer atteint ; un jalon à date dépassée restait donc « en retard » (alerte de retard, glissement critique) pour toujours.
- **`milestone.pass`** : le responsable du jalon (Deliverable owner) et les niveaux au-dessus marquent un jalon **passé** (statut Terminé, 100 %, date réelle d'aujourd'hui ou passée, jamais future) ou le **rouvrent**, avec confirmation et trace dans le journal. Les alertes de retard, de glissement critique et de jalon menacé cessent ; `MILESTONE_INCOMPLETE` (jalon passé alors qu'un livrable exigé n'est pas terminé) reste signalé.
- **Page WBS** : bouton « Marquer le jalon passé » / « Rouvrir le jalon » sur la carte d'un jalon (seulement si le serveur l'autorise : `canPass`), et le détail dit « À venir », « Échéance dépassée : pas encore marqué passé » ou « Passé le … ». Nouveau droit `milestone.pass` (niveau Deliverable owner), ligne du tableau des droits.
- **`BACKLOG.md`** : le reste à faire dans l'ordre proposé (vérification en réel, exercice : tableur, versions, constats, suivi ; jalons, baselines, équipes, nettoyage).
- Tests : `test_milestone.js` (4), `ui_edit.js` (61) ; neuf sabotages vérifiés, dont celui de la défense côté page.

## 0.17.1 — l'exercice budgétaire annuel ; plus aucun taux journalier

- **Plus de taux journalier dans tout l'outil** : ni sur les personnes, ni profil tarifaire, ni grille de taux, ni taux figé, ni colonne d'import ou d'export, ni droit « fixer les tarifs ». Le seul coût du personnel est le **coût annuel d'un ETP par pays et par an** (administrateur) ; un montant se convertit en jours par `montant ÷ (coût ÷ jours ouvrés du pays)`, avec le pays de l'équipe et l'année de l'exercice ; sans coût paramétré : « à paramétrer ».
- **Lignes de budget** : une **part d'équipe** en montant libre (pays de l'équipe) ou un **forfait** pour une ressource externe ; un livrable n'a qu'un **exercice**. Les imports de projets en tiennent compte (onglet Budget : Équipe ou Forfait, un montant ; onglet Personnes : colonne Équipe). Le pays d'une équipe se saisit dans la page Ressources et dans l'import d'équipes.
- **Exercices** (préparation, exécution, clos), **budget attendu et accordé par équipe** (3 caractères = porte le budget, 4 = détail rattaché), **écarts et clash** affichés sans rien bloquer, vue programme ; **page Budget** avec sélecteur d'exercice (l'exercice en préparation au départ) et zone « Exercice budgétaire » ; **page Administration** : exercices (avec confirmation) et coût d'un ETP. Droits : lecture à partir du Workpackage leader, saisie par le chef de projet et au-dessus.
- **Démo** : équipes à code (`DTE`, `STR`, `ESSB`…), un exercice en exécution (avec un clash) et un exercice en préparation (un dépassement, un budget non réparti), coût d'un ETP des quatre pays. Les livrables de l'exercice en préparation y ont des dates dans le planning existant (datés de l'an prochain, ils déplaceraient le chemin critique et ses constats).
- **Défaut corrigé en route** : un livrable chiffré avant l'existence des exercices ne pouvait être rattaché à aucun exercice.
- Tests : `test_exercise.js` (6) ; `ui_budget.js` (75), `ui_compte.js` (121), `ui_ressources.js` (55) ; vingt sabotages vérifiés. Mise à jour : voir `MISE_A_JOUR.md`.
- **Pas encore** : versions figées de l'exercice et leur validation, suivi accordé / engagé / avancement, révisions de février et d'avril en versions, passage automatique d'un exercice à l'autre.

## 0.17.0 — structure des équipes importée, équipes du projet

- **Import de la structure des équipes** par un classeur Google Sheet dédié (onglets Équipes et Membres), depuis la page Ressources (« Importer des équipes ») : modèle prérempli (aussi un export), analyse sans écriture avec chaque erreur à son onglet et sa ligne, import par lots, **copie de sécurité** si des équipes ou personnes existantes changent. **Rien n'est supprimé ni écrasé** (champs vides complétés, personne déjà dans une autre équipe non déplacée), clé = nom d'équipe sans accent ni casse, boucles refusées. Module `59_TeamImport.gs`.
- **Liste de droite de la page Ressources = les équipes qui ont au moins un membre qui participe au projet** (avec leurs parents en grisé, et le nombre de participants), case « Toutes les équipes », sans projet : toutes. **Les formulaires proposent toujours toutes les équipes existantes** pour attribuer une équipe à une personne. Créer des équipes à la main reste possible ; une équipe toute neuve s'affiche aussitôt.
- **Import de projets** : l'onglet Personnes a une colonne **Équipe** ; une personne créée reçoit une équipe déjà importée (sinon avertissement, créée sans équipe).
- Tableau des droits : le droit de gérer les personnes couvre aussi les équipes et leur import.
- Tests : `test_team_import.js` (9, dont l'**aller-retour vers une installation neuve**), `ui_ressources.js` (57) ; quatorze sabotages vérifiés.

## 0.16.3 — le logo évoque le sujet, la synthèse précédente reste

- **Logo en rapport avec le contenu** : en 0.16.2 le logo était tiré par l'outil avant que la synthèse existe, donc **sans aucun lien avec son contenu**. Désormais le prompt donne à Gemini la liste des logos libres (aucun servi pour ce projet ces 100 derniers jours) et lui demande **le logo qui évoque le mieux le sujet principal**, avec un logo par défaut si aucun ne convient. À la publication, l'outil **relit le logo qui ouvre le texte** (séquences d'émojis, lignes vides, « ✈ » = « ✈️ »), le mémorise, **accepte un logo hors catalogue**, et **signale avec la date** un logo déjà servi dans les 100 jours ; sans logo en tête, rien n'est mémorisé. `news.digest.prompt` rend la liste (`logos`), `news.digest.publish` rend `logo`, `logo_reused`, `logo_previous`.
- **La synthèse précédente reste** tant qu'il n'y en a pas de nouvelle. **Défaut corrigé** : le récapitulatif de 7 h ne gardait la synthèse que sur la fenêtre d'un jour et retombait sur le journal brut dès le lendemain d'un oubli. Il garde maintenant la dernière synthèse, **datée** (« pas de nouvelle depuis »), et lui ajoute **les réunions tenues depuis** sa date. La page affiche « pas de nouvelle depuis N jours » avec une note, la rubrique s'ouvre d'office pour le chef de projet, l'Overview garde la dernière.
- Tests : `test_news.js` (20), `ui_news.js` (75) ; dix sabotages vérifiés, dont celui qui rétablit le défaut du récapitulatif.

## 0.16.2 — synthèses par Gemini, logo du jour, fil du projet à gauche, rubriques condensées

- **Gemini seul** : la synthèse du matin est rédigée directement par Gemini. Plus aucune mention de NotebookLM ni de carnet (prompt, page, documentation) ; le prompt demande de s'appuyer sur le journal du projet (Google Doc à joindre, son lien est dans le prompt) et sur les réunions de la période.
- **Logo du jour** : le prompt demande de commencer la synthèse par un logo (émoji) pris dans un catalogue de 132, **qui n'a pas servi pour ce projet ces 100 derniers jours** ; choix stable (même projet, même jour : même logo), colonne `NewsDigest.logo` ; un logo ne compte comme servi que s'il figure dans la synthèse publiée ; affiché en tête de la synthèse.
- **Disposition** : le fil du projet passe **à gauche** (la colonne principale). À droite, la synthèse du matin, les actions, les réunions à trier, l'ajout d'un compte rendu et les repères sont **repliés sur une ligne de résumé** (« 15 ouvertes · 2 en retard », « collecte active · 2 repères »…) et **s'ouvrent seuls quand il y a quelque chose à faire** : synthèse du jour pas encore publiée, action en retard ou à accepter, réunions à trier, collecte à régler. Le choix de la personne est gardé tant que la page reste ouverte.
- Tests : `test_news.js` (18, dont le logo : frontière des 100 jours, synthèse supprimée, projets indépendants), `ui_news.js` (71) ; dix sabotages vérifiés.

## 0.16.1 — page Actualités : repères obligatoires, réunions dépliables, pièces jointes, deux colonnes

- **Collecte** : une réunion n'est retenue **que si son titre contient un repère** du projet. Les membres invités ne rattachent plus une réunion à un projet (c'était la règle « au moins deux membres »). Plusieurs projets reconnus dans le même titre : « à trier ». Le texte de la zone « Repères et journal du projet » dit la règle.
- **Fil du projet** : chaque réunion est **repliée** (titre, date, origine, ce qu'elle contient) et **se déplie au clic** : résumé, participants, décisions, actions, pièces jointes, compte rendu source ; « Tout déplier » et « Tout replier » ; ce qui est déplié le reste après un rechargement.
- **Pièces jointes** : celles de l'invitation d'agenda sont conservées sur la réunion (colonne `attachments`, https seulement, dix au plus) et s'ouvrent dans un nouvel onglet. Les réunions déjà collectées n'en ont pas (rien n'est reconstitué).
- **Deux colonnes** : le fil du projet en haut à droite ; la synthèse du matin, les actions et les repères à gauche ; une colonne sous 980 px, le fil d'abord.
- Tests : `test_news.js` (17), `ui_news.js` (59) ; six sabotages vérifiés.

## 0.16.0 — export et import de plusieurs projets, programmes et personnes

- **Un seul format de classeur pour un ou plusieurs projets** : onglets Programmes, Projets, Personnes, Workpackages, Livrables, Jalons, Dépendances, Budget (les cinq derniers commencent par le code du projet). **Remplace** le classeur à un projet de la 0.15.4 (onglet « Projet » devenu « Projets », colonne « Projet » ajoutée) ; les contributors des jalons sont maintenant exportés.
- **Page Administration › Projets : export et import** : choisir des projets ou un programme, exporter, analyser, importer ; l'import peut **créer des programmes, des projets et des personnes** (c'est aujourd'hui la seule façon de créer un programme dans l'outil). La page WBS garde l'import d'**un** projet et refuse un classeur qui en contient d'autres.
- **Personnes** : celles de l'onglet Personnes qui n'existent pas sont créées d'abord (un leader ou un chef de projet créé par le même classeur est reconnu) ; une personne existante n'est jamais modifiée ; le taux n'est exporté et pris en compte que pour le chef de projet et au-dessus.
- **Dépendances** exportées et importées (par les noms de leurs deux bouts), avec contrôle des boucles.
- **Copie de sécurité automatique** avant le premier lot (classeur « Copie avant import » avec lien) ; **si elle échoue, l'import est annulé**. Tout est analysé avant d'écrire : une erreur, et rien n'est écrit pour aucun projet.
- Actions : `import.template` (projectId, projectIds, programId ou all), `import.catalog` (nouvelle), `import.analyze`, `import.run` (paramètre `resume`) ; libellé du droit `import.run` mis à jour dans le tableau des droits.
- Défaut trouvé par l'aller-retour et corrigé : le chef de projet d'un projet neuf n'était pas posé (les personnes sont maintenant créées avant les projets).
- Tests : `test_import.js` (16, dont l'**aller-retour vers une installation neuve** qui compare programmes, projets, personnes, workpackages, éléments, dépendances, budget et rôles), `ui_compte.js` (110, zone d'export et d'import), `ui_structure.js` (43) ; sept sabotages de l'import et quatre de la zone vérifiés ; 335 tests serveur, seize essais de pages.

## 0.15.5 — baselines par périmètre, démo aux huit niveaux

- **Baselines par périmètre** (projet, workpackage, sous-workpackage ; jamais un livrable) : une baseline active par périmètre, numérotation et historique par périmètre ; **figer demande de pouvoir modifier l'objet** (un Workpackage leader fige son workpackage et ses sous-workpackages, pas le projet) ; instantané restreint au périmètre (`58_ScopeBaselines.gs`). **Références parallèles** : la baseline du projet n'est jamais remplacée par celle d'un workpackage ; les écarts d'un workpackage se lisent contre sa baseline ou contre celle du projet (`against: 'project'`).
- **Informer le niveau du dessus** : la baseline figée reste « à valider » (événement `baseline_frozen`, avec son niveau d'auteur et un résumé des écarts) ; le niveau du dessus la valide ou la **refuse** (`changes.reject`) : la précédente du périmètre redevient la référence. Les baselines figées par le chef de projet sont désormais aussi à valider par le DPL. Aucun nouveau mail.
- **Page Suivi** : liste « Figer une baseline sur », sélecteurs de périmètre et « Écarts contre », périmètre et état de validation dans l'historique, bouton **Refuser** dans les changements à valider ; demandes de baseline par périmètre.
- **Tableau des droits** : trois lignes « Figer une baseline sur un projet / un workpackage / un sous-workpackage ».
- **Démo** : deux baselines de workpackage (WP 2 : référence locale ; WP 1 : figée à un niveau de Workpackage leader, donc à valider) ; rôles de workpackage migrés aux huit niveaux par trois étapes de `A2_SEED_DEMO` ; membres posés Contributors de trois livrables ; `A6_EFFACER_DEMO` efface aussi les rôles des livrables supprimés.
- **Migration des rôles** : la simulation et la migration **avertissent au-delà de 500 Contributors** (un membre de projet devient Contributor de chaque livrable : 1 350 lignes sur l'ancienne démo, près de 600 Ko). Voir le README avant de lancer `A9_MIGRER_ROLES`.
- Tests : `test_baseline_scopes.js` (9), `ui_suivi.js` (78, périmètres, référence du projet, refus), démo (`test_demo.js`) et cache (`test_speed.js`, rangements groupés quel que soit le volume) adaptés ; 330 tests serveur, seize essais de pages ; douze sabotages du serveur et quatre de la page vérifiés.

## 0.15.4 — import et export du WBS par classeur, tableau des droits

- **Page WBS › Importer / exporter** (chef de projet et au-dessus) : classeur modèle créé dans Drive, partagé avec la personne et **prérempli avec le projet** (donc export aussi) ; onglets **Projet, Workpackages, Livrables, Jalons, Budget** ; **Analyser** (rapport sans rien écrire, chaque erreur avec son onglet et sa ligne) puis **Importer** (par lots reprenables, quatre minutes au plus par lot, la page relance jusqu'à « terminé »).
- Clés : code WBS pour un workpackage ; workpackage et nom pour un livrable ou un jalon ; livrable et ressource pour une ligne de budget. **Idempotent, ne supprime jamais rien**, ne crée jamais de personne (adresse e-mail dans Ressources). Passe par les actions ordinaires : mêmes droits, mêmes règles, même journal, changements « à valider » par le niveau du dessus.
- Une personne sans adresse sur sa fiche se désigne par son nom exact (l'export l'écrit ainsi ; un nom ambigu est refusé) : trouvé en ouvrant l'export de la démo, dont les 39 lignes de budget sortaient avec une cellule vide ; une démo complète exportée se ré-importe désormais sans erreur ni changement.
- **Page Administration › Droits par niveau** : tableau des droits (une ligne par droit, une colonne par niveau, filtre, légende des niveaux, règles), calculé par le serveur depuis les règles réelles (`admin.rights`, `57_Rights.gs`, `WBS_RANK`) ; chaque case comparée à `can()` dans les essais, et un droit ajouté sans ligne dans le tableau fait échouer les essais.
- Actions `import.template`, `import.analyze`, `import.run` ; droit `import.run` (chef de projet) ; `56_Import.gs`, `StructureImport.html`.
- Tests : `test_rights_table.js` (5), `ui_compte.js` (98 ; l'attente d'une ligne des jours fériés rendue robuste), `test_import.js` (11), `ui_structure.js` (42, dont le dialogue d'import avec des lots forcés) ; sabotages vérifiés : sans erreur bloquante, sans droit, objets non reconnus, dates inversées, leader non posé, budget de temps ignoré, bouton actif malgré les erreurs, bouton montré à tous, lots non relancés.

## 0.15.3 — rôles par niveau, WBS seul

- **Huit niveaux** (PL, DPL, CP, Workpackage leader, Sub-workpackage leader, Deliverable owner, Contributor, Reader implicite), posés chacun sur son type d'objet par un niveau strictement supérieur ; droits par type d'objet, cumul des rôles, droits « en profondeur » ; moteur réécrit (`05_Rbac.gs`, `00_Config.gs`), anciens codes reconnus jusqu'à la migration.
- **Page WBS** : l'**organigramme OBS est supprimé** (actions `obs.*`, préférences d'affichage, essais) ; section **Rôles** dans le détail de chaque carte (action `roles.of`) ; le champ « Responsable » du formulaire disparaît. **Ressources** : création des personnes et des équipes seulement, colonne des rôles en lecture seule, Reader par défaut ; `people.setProjectRole` supprimée.
- **Lecture** : tout ouvert à tous, sauf tarifs et comptes rendus (à partir du Workpackage leader) et budget (sur son workpackage) ; lire les tarifs n'est pas les fixer ; la synthèse par mail suit.
- **Responsable principal** conservé et tenu par les rôles ; un DPL créateur d'un projet en devient le DPL.
- **Migration `A9_MIGRER_ROLES`** (et `_SIMULATION`) : additive, relançable, **300 écritures au plus par lancement** (Apps Script coupe à six minutes) ; `A7` signale les anciens rôles restants.
- **Validation par le niveau du dessus** (page Suivi) : chaque événement du journal garde le niveau de son auteur (`actor_level`, `54_Validation.gs`) ; on ne valide que ce qu'un niveau strictement inférieur a fait sur l'objet, une seule validation suffit ; l'avancement déclaré se valide ; « vos modifications en attente » et le validateur nominal ; administrateur, Program Leader et système n'ont rien à valider ; mail du matin par personne. `changes.feed`, `changes.ack` et `pendingChangeCounts_` réécrits sur la même valeur.
- **Budget par workpackage** (page Budget, zone « Enveloppe par workpackage », `55_Envelope.gs`) : budget autorisé du projet fixé par le chef de projet et réparti entre les workpackages, puis entre les sous-workpackages par leur Workpackage leader ; coût prévu des livrables mis en regard ; dépassement signalé, jamais bloqué ; chacun ne voit que son budget ; changements à valider ; écriture par `budget.envelope.set` seulement. Colonnes numériques déclarées pour les vraies feuilles (relues en nombres).
- Tests : `test_rbac.js` réécrit en matrice des huit niveaux (17), `test_roles.js` (8 : chaîne de désignation, WBS par niveau, DPL créateur, migration, migration interrompue puis reprise, panneau des rôles, lecture), migration de la démo en plusieurs lancements, fil de validation par niveau (`test_baselines.js`) ; `ui_structure.js` réécrit pour le WBS seul (31), `ui_suivi.js` (62) ; `ui_org.js` retiré ; 304 tests serveur (dont `test_envelope.js`, 6), seize essais de pages (`ui_budget.js` : 53).

## 0.15.2 — Planning : liste de gauche, filtres, enregistrement immédiat

- **Liste de gauche** alignée sur le diagramme (nom indenté, responsable, fin, avancement), **arbre des workpackages repliable**, **recherche** et filtres (en retard, critiques, non respectés, les miens), éléments sans dates listés et ouvrables, survol et sélection liés, entêtes (dates et liste) qui restent en haut, bouton « Liste », fermée au départ sur téléphone. Le serveur indique quels éléments sont « à moi » (`mine`).
- **Mise à jour optimiste** : déplacement (message « Annuler » à la place de la boîte de confirmation, avertissement de week-end), liens et avancement s'affichent tout de suite ; écritures en file, **une seule relecture silencieuse** une fois la file vide (position, sélection, replis et filtres gardés), relecture obsolète écartée, retour arrière expliqué en cas de refus.
- **Défaut corrigé** : un déplacement à la souris allongeait l'élément d'un jour (erreur d'arrondi d'une heure de la bibliothèque, début pris la veille) ; le début est arrondi au jour le plus proche.
- Tests : `ui_gantt_liste.js` (45), `ui_gantt_optimiste.js` (13), `ui_smoke.js` réécrit pour le déplacement immédiat (37), `ui_gantt_liens.js` (47), un test serveur ; 285 tests serveur, dix-sept essais de pages.

## 0.15.1 — dépendances créées depuis le Planning

- **Planning plus moderne** (même bibliothèque, habillage revu) : ouverture sur aujourd'hui avec ligne et pastille « Aujourd'hui » et bouton de retour ; barres teintées, avancement plein, couleur par statut (à faire, en cours, terminé, critique, retard), plus hautes et arrondies ; workpackages en fine barre, jalons en losange ; noms qui suivent le défilement ; infobulle au survol et flèches accentuées de l'élément ; week-ends estompés ; barres de projet nommées avec leur avancement en vue programme ; chargement en barres fantômes ; barre d'outils en pastilles et entête compact sur téléphone ; légende mise à jour. Tests : `ui_gantt_look.js` (33 vérifications, date figée).
- **Créer une dépendance depuis la page Planning** : dans le panneau d'un livrable ou jalon, section « Dépendances » (ce qu'il doit attendre, ce qu'il bloque, type et décalage, lien non respecté en rouge) et boutons « + Doit attendre… » / « + Bloque… » ; l'autre élément se choisit dans une liste (par workpackage, autres projets du programme compris, éléments déjà liés exclus) **ou en cliquant sa barre** ; une phrase dit ce que le lien signifie ; options repliées (type, décalage) ; lien non respecté signalé à la création ; « Retirer » en deux clics ; Échap abandonne ; le formulaire reste à l'écran. Mêmes règles qu'OBS/WBS (droit `wbs.edit` sur l'élément aval, pas de doublon, pas de boucle).
- `gantt.project` renvoie la **version** de chaque dépendance (retrait sans conflit silencieux). Aucune nouvelle action serveur.
- Tests : `ui_gantt_liens.js` (42 vérifications : liste, clic sur barre, options, lien non respecté, boucle, doublon, retrait, Échap, droits d'un chef de projet, d'un responsable de workpackage et d'un membre) et un test serveur ; 284 tests serveur, quinze essais de pages.

## 0.15.0 — Copilote complet (clé Gemini strictement personnelle), classeur ouvert et protégé selon les rôles, pages plus rapides

- **Rôles et personnes** (`RoleAssignment`, `Role`, `Resource`) : modifiables par les administrateurs, PL et DPL seulement. **Budget et achats** (`BudgetLine`, `BudgetPhasing`, `PurchaseOrder`, `PurchaseOrderLink`, `RateCard`, `ActualImport`) : en plus, les chefs de projet. Droits `sheet.roles` et `sheet.budget` dans `PERMISSIONS`.
- **Déduite des rôles, rien à gérer** : éditeurs recalculés des rôles actifs, mis à jour à chaque changement de rôle ou de fiche, chaque nuit et à la demande ; interrupteur et liste des éditeurs dans Administration ; Mon compte dit à chacun ce qu'il peut modifier.
- `Resource` est protégée aussi (l'adresse de la fiche donne les rôles) ; les protections posées à la main ne sont jamais touchées ; les écritures de l'outil ne sont jamais bloquées ; la lecture reste ouverte (limite documentée).
- **Page Copilote : les fonctions reviennent à l'écran** (elles n'avaient plus de page depuis la 0.13.0) : synthèse du projet, suggestions du moteur de règles, simulation « et si… », questions, en zones sans onglets, avec la connexion de la clé plus bas. Trois modes (désactivé, texte à coller dans Gemini, appel direct) ; le mode « texte à coller » ne demande aucune clé. Statut, synthèse et suggestions sont préchargés avec la page ; la simulation charge le planning au clic ; la zone de la clé dit si elle sert selon le mode. Tests : `ui_copilote_projet.js` (trois modes, faux modèle).
- **Mode Gemini avec la clé personnelle de chaque compte, rendu complet** : chaque demande part avec la clé de la personne qui la fait ; **sans clé, repli automatique sur le texte à coller** (aucun appel à Google, quota intact) ; la page dit où en est la personne (badge, note, bouton « Connecter ma clé ») et se met à jour dès que la clé est enregistrée ou supprimée ; **le modèle est retenu à l'enregistrement de la clé** (plus un appel à Google par demande) ; **erreurs claires** quand Google refuse la clé, retire le modèle ou limite le débit, sans jamais afficher la clé ; **plus aucune clé commune** (voir ci-dessous). Libellé du réglage : « Gemini : clé personnelle de chaque compte ». Tests : `test_copilot_api.js` (8) et le mode Gemini de `ui_copilote_projet.js`, avec un faux Google qui note la clé envoyée.
- **La clé Gemini est strictement personnelle : la clé commune de l'administrateur est supprimée** (le champ d'Administration, son réglage, son secours et le mot « commune » dans la page). L'API d'administration refuse d'en recevoir une (« strictement personnelle… ») ; l'ancienne propriété `PPM_GEMINI_API_KEY`, si elle existe, n'est jamais utilisée et est supprimée par `A1_INSTALLER_PPM` (qui le dit) et chaque nuit. Une personne sans clé passe par le texte à coller. Je m'étais trompé en écrivant qu'aucun écran ne permettait de saisir cette clé : Administration avait bien un champ, désormais retiré.
- Défaut corrigé avant publication : une application « terminée » alors qu'un éditeur voulu n'avait pas encore accès au classeur ne l'aurait jamais ajouté ensuite.
- Tests : 283 serveur (dont 11 pour la protection, avec un faux Sheets qui simule les protections, et 8 pour le mode Gemini), plus treize essais de pages. Numérotation : la 0.14.2, publiée, avait ouvert la démo à NAC-1 seul et accéléré les pages ; la 0.15.0 réunit tout ce qui a suivi.

## 0.14.2 — démo réduite à NAC-1, pages plus rapides

- **Démo réduite à NAC-1** (15 étapes au lieu de 18 ; plus de réunions « à trier »), avec un livrable sans responsable et un sans date pour garder toutes les familles de constats. Vue programme à un seul projet.
- **Ouverture des pages** : à cache vide 12 à 48 appels aux services Google au lieu de 71 à 188 (Administration 126) ; à cache plein 5 au lieu de 14 à 26. Lecture d'une table en un appel, cache lu et écrit en groupe, tables d'une page demandées d'avance, `repoGet` sans lecture ligne par ligne, identité et adresse de l'application mémorisées, Overview et Compte préchargent leurs cartes d'actualités (plus d'aller-retour après l'ouverture). Nombres d'appels exacts ; temps réel non mesuré ici.
- **Trois pistes à faible risque** : chaque page ne tire du cache que ses tables (−82 % pour Copilote, −64 % Ressources, −61 % Actualités, −60 % Compte, −53 % Structure, −51 % Budget) ; Compte charge ses suggestions à la demande ; déclencheur facultatif `warmCache` (toutes les 5 minutes, en semaine de 6 h à 21 h) posé par A5, cache de 6 minutes.
- **`A7`** mesure le temps réel d'ouverture de chaque page (première ouverture → cache plein) et signale l'absence de `warmCache`.
- **Accès au classeur de données** : toute personne invitée (fiche avec une adresse du domaine) reçoit l'accès en modification au classeur Données et en voit le lien, bien visible, en tête de Mon compte (et dans Administration → Réglages). Accordé à la création de la fiche, à l'ouverture de Mon compte, la nuit, ou par « Partager maintenant » ; interrupteur dans les réglages (retire les accès accordés par l'outil, jamais les partages manuels) ; le classeur Historique n'est jamais partagé ; `A7` le contrôle. **L'édition directe contourne les règles de l'outil** (droits, historique, version) : choix assumé, avertissement affiché ; risques connus à traiter ensuite (rôles modifiables, taux et budget lisibles).
- **Tests** : `test_speed.js` (budget d'appels, lecture en un appel, écriture groupée, table périmée jamais rangée, mémoïsation) ; les optimisations ont été retirées une à une pour vérifier que les tests les voient.
- Tests : 265 serveur, plus douze essais de pages.

## 0.14.1 — versions B et C : OBS en mosaïque, WBS du programme, équipes en organigramme, vues programme

- **OBS** : personnes d'une boîte de rôle en mosaïque (1 à 4 colonnes), schéma centré, ajustement à la largeur plus tolérant.
- **WBS du programme** : programme → projets → workpackages, lecture seule, avec « Ouvrir le WBS du projet ».
- **Ressources** : liste 75 % / équipes 25 %, arbre des équipes en organigramme avec traits de liaison, « Statut et accès » regroupés, colonne des boutons épinglée.
- **Vues programme** d'Actualités, de Suivi et de Budget pour les Program Leader et Domain Program Leader (droit `program.view`, `49_Program.gs`, `CommonProgram.html`) : tableau consolidé par projet avec totaux, repris des calculs de chaque projet.
- **Démo** : actualités, budget, commandes et baseline pour NAC-2, NAC-3 et NAC-4 (étape « Actualités et suivi des autres projets »).
- **En attente** : accélérer la démo (6 à 7 lancements d'A2 chez vous). Non commencé.
- Tests : 243 serveur, plus douze essais de pages.

## 0.14.0 — version A : ajout toujours possible, livrables par personne, pages en grille

- **WBS** : « Ajouter un workpackage », « un livrable » et « un jalon » toujours dans la barre ; le formulaire propose « Rattaché à » (projet ou workpackage, sous-workpackages compris), avec le workpackage sélectionné proposé d'office. Correction au passage : la liste des parents possibles d'un nouveau workpackage n'offrait que la racine.
- **Ressources** : colonne « Livrables » (responsable de N livrables et M jalons ; contribue à P).
- **Compte, Budget, Administration** : grille de cartes qui se réagence selon la largeur, sans colonne vide ni tableau rogné ; réglages de l'administration sur toute la largeur en colonnes.
- **Démo** : contributeurs affectés aux workpackages de NAC-2, NAC-3 et NAC-4.
- Tests : 238 serveur, plus douze essais de pages.

## 0.13.2 — textes protégés dans les feuilles, démo réparable

- **Défaut corrigé (constaté dans le vrai Apps Script)** : Sheets interprétait les textes écrits comme une saisie au clavier. Le code de workpackage « 1 » devenait le nombre 1 et ne se retrouvait plus (la démo s'arrêtait à l'étape 4 : « workpackage introuvable NAC-1 1 », donc aucun livrable ni planning), « 2.10 » et « 2.1 » se confondaient, « TRUE » devenait un booléen, « 2026-11 » une date, et un texte commençant par « = » **une formule exécutée** (injection). Les colonnes de texte écrivent désormais une apostrophe devant les textes à risque et relisent du texte, même pour les anciennes cellules.
- **Faux Google Sheets fidèle** (`tests/fake_sheets.js`) et `test_sheets_layer.js` : la vraie couche d'écriture est enfin testée ; la démo complète y donne exactement les mêmes données qu'en mémoire.
- **`A8_VERIFIER_ECRITURE`** : écrit 25 textes à risque dans une feuille temporaire du vrai Sheets, les relit, compare, supprime la feuille.
- **`A6_EFFACER_DEMO`** (ex-`A6_EFFACER_ANCIENNE_DEMO`) efface aussi la démo NAC (équipes, réunions, commandes, personnes fictives), détache l'administrateur des équipes fictives et remet A2 à zéro. A2 annonce qu'une démo en cours est incomplète, relit la base à la fin et refuse de dire « complète » si un projet n'a aucun livrable ; A7 signale une démo interrompue ou vide.
- Tests : 235 serveur (dont 11 nouveaux), plus douze essais de pages.

## 0.13.1 — page Administration plus rapide

- **Mesure dans le vrai Apps Script** (premier journal de A7, 0.13.0, 24 contrôles OK) : le contrôle d'installation, qui lit les en-têtes de toutes les feuilles, durait **10 s**, et la page Administration l'appelait à chaque ouverture. Un résultat « aucun problème » est désormais gardé 10 minutes (mémoire du script, par version du Core) ; un problème n'est jamais gardé et s'affiche aussitôt ; les déclencheurs et le dernier traitement nocturne restent calculés en direct. `A7_TESTER_DANS_APPS_SCRIPT` et `selfCheck` relisent toujours tout. Les autres appels de pages mesurés vont de 94 ms à 976 ms.
- Tests : 224 serveur, plus douze essais de pages.

## 0.13.0 — Copilote : la clé Gemini de chaque personne

- **Réactivation du copilote d'une case à cocher** dans Administration (tracée), sans toucher aux propriétés du script.
- **Page Copilote refaite** : un gros bouton ouvre directement la page de Google où créer la clé ; trois gestes ; « Coller » depuis le presse-papiers ; « Enregistrer et tester » ; aide et message prêt à envoyer au support si l'entreprise bloque la création ; avertissement sur l'usage des données avec une clé gratuite. Les anciens onglets (synthèse, simulation, questions, suggestions) ne sont plus proposés, le code serveur reste.
- **Clé personnelle** (`38_CopilotKey.gs`) : rangée dans une propriété privée du script (jamais dans une feuille), jamais renvoyée ni journalisée, vérifiée chez Google avant d'être gardée, avec test en trois étapes et suppression ; utilisée pour les demandes de cette personne seulement.
- **Modèle choisi chez Google** (plus figé) : alias `gemini-flash-latest` sinon le « flash » le plus récent, versions comparées par rangs.
- **Correction importante** : le manifeste n'autorisait pas les appels externes (`script.external_request`) ; sans elle, tout appel à Gemini échouait dans le vrai Apps Script. Ajoutée ; **à réautoriser** (`A1_INSTALLER_PPM`).
- **Nouveau garde-fou** : un test compare chaque service Google utilisé dans le code avec les autorisations du manifeste, dans les deux sens. `A7` vérifie que Google répond.
- Le mode « api » n'exige plus de clé commune ni de nom de modèle (chacun a sa clé). Le lien « Voir les suggestions » de l'Overview est retiré (la page n'a plus ces suggestions).
- Tests : 223 serveur, plus douze essais de pages.

## 0.12.3 — formulaires communs, test dans Apps Script

- **`A7_TESTER_DANS_APPS_SCRIPT`** : test de contrôle à lancer dans le vrai Apps Script, en lecture seule (rien n'est écrit ni envoyé, vérifié par un test). Il contrôle le moteur, les services, le fuseau horaire et les changements d'heure, l'installation, l'autorisation, les déclencheurs, l'agenda, le quota de mails, et les appels de chaque page avec le compte qui l'exécute, chronométrés.
- **Formulaire générique et confirmation** (`ppm.forms`) : une seule version à la place de quatre copies dans Budget, Overview, Ressources et Structure ; elle accepte l'union de leurs options. Elle est dans `CommonForms.html`, incluse par ces seules pages (champ `shared` du registre) : les six autres pages sont inchangées, au même octet.
- **Mesure de performance** (0.12.2 contre 0.12.3, démo complète, passages alternés) : taille des pages +1,5 % au total (les quatre pages à formulaires gagnent 2 à 3 Ko, les six autres 0) ; temps d'affichage sans écart mesurable (page Structure : premier schéma dessiné en 181 ms avant, 179 ms après ; découpage 233 ms avant, 225 ms après).
- Tests : 209 serveur (dont 5 pour A7), plus douze essais de pages.

## 0.12.2 — découpage des gros fichiers

Aucun changement de fonctionnement, vérifié deux fois.

- **`Structure.html` (1 593 lignes) coupée en six morceaux** par sujet (`StructureState`, `StructureDraw`, `StructureLoad`, `StructureDetail`, `StructureEdit`, `StructureOrg`) ; le fichier garde le marquage et l'assemblage (397 lignes). La page fabriquée est identique à l'octet près à celle de la 0.12.1.
- **Fichiers serveur coupés** : le rendu des pages web de `32_Views.gs` vers `31_Pages.gs` ; `47_Demo.gs` en étapes, données (`47_DemoData.gs`) et effacement de l'ancienne démo (`47_DemoClean.gs`) ; `48_News.gs` en lecture des textes (`48_NewsText.gs`), cœur et collecteur (`49_NewsCollect.gs`). Les 502 fonctions et variables du Core fabriqué sont textuellement identiques à celles de la 0.12.1 : seul leur emplacement change.
- **Fabrication** : toutes les inclusions sont résolues (plus seulement `Style`, `Common` et `Header`), et un morceau de code contenant `$'` n'est plus mal interprété.
- **Registre** : champ `parts` ; `test_pages.js` vérifie que chaque morceau existe, est inclus dans l'ordre et n'est à aucune autre page.
- Tests : 204 serveur, plus douze essais de pages.

## 0.12.1 — nettoyage : outils communs, CSS commun, registre des pages

Aucun changement de fonctionnement, sauf les deux corrections ci-dessous.

- **Outils JavaScript communs** (`Common.html`, `ppm.el`, `ppm.call`, `ppm.toast`, `ppm.frDate`…) : une seule version à la place d'une copie par page (il en existait jusqu'à cinq variantes pour le formatage des dates). Environ 480 lignes retirées des pages.
- **Les pages fabriquées (`dist/`) restent autonomes** : Apps Script sert chaque page seule, donc la partie commune y est recopiée à la fabrication ; le gain est dans les **sources** (une seule version à corriger), pas dans le poids servi, qui augmente d'environ 25 Ko au total sur les dix pages (environ 2,5 Ko par page).
- **CSS commun** : 23 règles identiques dans trois pages ou plus déplacées dans `Style.html`.
- **Registre des pages** (`00_Pages.gs`) : la liste des pages n'est plus écrite à six endroits ; le serveur, la fabrication et les aperçus la lisent ; `test_pages.js` vérifie la cohérence avec la barre du haut et les fichiers.
- **`ARCHITECTURE.md`** : les couches, les règles et la marche à suivre pour ajouter une page, une action ou une table.
- **Correction** : le lien « Actualités » de la barre du haut reprend désormais le projet courant (oublié en 0.12.0).
- **Correction visuelle** : dans Ressources, le compteur « n personnes » prend le gris des textes secondaires, comme partout ailleurs.
- Vérifié en comparant neuf pages pixel par pixel avec la 0.12.0 (démo complète) : sept strictement identiques, Ressources (le compteur) et Administration (ordre de lignes de journal à la même seconde) mis à part.
- Essai instable corrigé (`ui_org.js` cliquait sur un bouton avant qu'il soit redessiné ; reproduit sous charge, puis six essais sous charge sans échec).
- Tests : 204 serveur, plus douze essais de pages.

## 0.12.0 — fil d'actualités du projet (phase 1)

- **Page Actualités** : synthèse du matin, actions issues des réunions, fil des réunions, réunions à trier, ajout d'un compte rendu, repères et journal.
- **Saisie manuelle** de notes Gemini ou de minutes (texte ou lien d'un Google Doc) ; **actions** lues sans IA, proposées à chacun qui accepte, conteste ou termine ; contestation notifiée au chef de projet.
- **Collecteur pilote** de l'agenda du compte du script, à 1 h et 13 h : deux membres invités ou un repère dans le titre ; égalités « à trier » ; événements privés jamais lus.
- **Journal du projet** (Google Doc) et **synthèse du matin** : prompt à copier, publication vérifiée, mail aux membres ; carte dans l'Overview ; section dans le récapitulatif de 7 h.
- **Mon compte** : zone « Mes actions issues des réunions ».
- **Démo** : deux étapes d'actualités (8 réunions, 17 actions, synthèse du jour, 2 réunions à trier).
- Nouvelle autorisation Google : lecture et écriture de Google Docs (à réautoriser).
- Tests : 199 serveur, plus douze essais de pages.

## 0.11.1 — remplacer l'ancienne démo

- **`A6_EFFACER_ANCIENNE_DEMO`** : supprime l'ancienne démo (programme `DEMO`, projet `PILOTE`, deux personnes fictives) et ce qui s'y est rattaché ; deux lancements (le premier montre, le second supprime), suppression douce, réservée aux administrateurs. `A2_SEED_DEMO` signale si l'ancienne démo est toujours là.
- Tests : 181.

## 0.11.0

- **Plus aucun onglet** sur Budget, Suivi, Mon compte, Administration et OBS/WBS : chaque rubrique est une zone, toutes affichées ensemble. Le menu ▾ de la barre du haut est retiré. Premier écran préparé avec la page.
- **OBS/WBS** : la page Structure est renommée ; l'organisation et le découpage s'affichent l'un sous l'autre, chacun avec sa barre d'outils et son panneau de détail.
- **Ressources à positionner** : une personne créée sans rôle apparaît dans l'organisation, avec « Positionner dans l'organigramme » ; repère « À positionner dans l'OBS » dans Ressources.
- **Copilote en suspens** (lien, page, réglages, demandes à l'IA) ; réactivation par `PPM_COPILOT = oui`.
- **Domaines autorisés** : champ ajouté dans Administration (il manquait à l'écran en 0.10.0).
- **Points d'entrée en tête de la liste** des fonctions de l'éditeur : `A1_INSTALLER_PPM`, `A2_SEED_DEMO`, `A3_VERIFIER_INSTALLATION`, `A4_DIAGNOSTIC_ACCES`, `A5_INSTALLER_DECLENCHEURS` (fichier `000_Menu.gs`). Les anciens noms `installerPpm`, `seedDemo`, `diagnosticAcces` ne sont plus publics.
- **Démo complète** : un programme, quatre projets dont un complexe (WBS de 16 workpackages et 48 éléments, 43 dépendances, retards, trois baselines, budget, commandes d'achat, risques ; 60 dépendances et 47 lignes de budget en tout), 38 personnes avec leurs taux, 11 équipes, plus de 80 rôles, trois personnes à positionner. Découpée en 15 étapes qui reprennent là où elles se sont arrêtées ; aucune adresse e-mail fictive.
- **Overview** : le repère « Personnes » compte les membres du projet (et non plus les adresses joignables) ; un dépassement du budget externe sur un seul CPN met l'indicateur de coût en alerte.
- Aperçu de la démo : `node tests/preview_demo.js`.
- Tests : 177 serveur (dont `test_demo.js`), plus onze essais de pages.

## 0.10.0 — Overview, Ressources, charte Airbus, menu des onglets, accès par domaine

- **Charte** reprise de la diapositive Airbus fournie, sur toutes les pages (hero dégradé, libellés en capitales espacées, cartes à liseré, pastilles numérotées, orange réservé aux mises en garde).
- **Overview projet**, nouvelle page d'accueil : créer et renommer un projet, verdict global et trois indicateurs (délais, qualité, coût), portefeuille, jalons et alertes. L'indicateur qualité mesure la maîtrise (risques, jalons), faute de mesure de qualité propre.
- **Ressources**, nouvelle page : personnes, équipes, rôle dans le projet (chef de projet, membre), taux journalier par personne interne ou externe, colonne Accès. Le taux de la fiche remplace la grille (conservée en secours) ; l'onglet Taux de Budget disparaît. Une ressource externe se budgète au forfait ou en jours × taux.
- **Menu des onglets** : Suivi, Copilote et Budget gardent leurs pages ; une flèche ▾ de la bannière ouvre directement chaque onglet. Correctif : le projet courant se transmet désormais à tous les liens de la bannière (Overview, Ressources et Budget l'oubliaient depuis le Planning et la Structure).
- **Mails** : tous les objets commencent par `[PPM✴️]`, avec un test garde-fou.
- **Accès** : `PPM_DOMAIN` accepte plusieurs domaines, réglables dans Administration ; le refus dit pourquoi et quoi faire ; fonction `diagnosticAcces` à lancer depuis l'éditeur. Corrige « Accès réservé aux comptes du domaine » quand l'installation avait fixé un autre domaine que celui de l'utilisateur.
- `dist/` : 11 fichiers. Tests : 162, plus les essais de pages.

## 0.9.1 — rappels avant livraison dans l'agenda du responsable

- Un rappel est ajouté à l'agenda du projet, **N jours ouvrés avant la livraison** de chaque livrable non terminé, avec son responsable invité (il le voit dans son Google Agenda). N vaut 10 par défaut.
- Délai réglable par l'administrateur (défaut et interrupteur général) et par chacun (son délai, ou désinscription dans Mon compte).
- Le rappel suit la livraison, le responsable et l'avancement ; les jours fériés comptent ; un rappel déjà créé est conservé quand sa date passe.
- Ce n'est pas une tâche Google (impossible dans la liste d'un autre utilisateur) : c'est un événement d'agenda.
- Tests : 144.

## 0.9.0 — budget, CPN et commandes d'achat (lot 3, première partie)

- **CPN** : code financier du projet avec sa désignation, portable aussi par un sous-projet (workpackage de premier niveau) ; un CPN ne couvre qu'un projet ; les analyses budgétaires se font par CPN.
- **Commandes d'achat (PO)** : numéro unique saisi à la main (Click and Buy), ressource externe, CPN saisi à la main, période d'activité, montant, répartition en montants réglables entre livrables, statuts À faire / Lancée / GR / Terminée. **Engagement en une fois** à la date de lancement, sans étalement. Elles pèsent sur le budget du projet dont elles portent le CPN.
- **Date de GR attendue** : rappel dans le récapitulatif quotidien du responsable de la GR, et constats pour le pilotage (GR en retard, GR sous 7 jours, PO à lancer, dépassement du budget externe). Aucun montant dans les constats et les mails.
- **Budget** : lignes par livrable (interne : jours × taux **figé** ; externe : forfait), étalement automatique qui suit les dates du livrable ou fixé à la main, grille de taux par profil, pays et date d'effet (réservée au chef de projet et au DPL), profil tarifaire des personnes.
- **Bilan par CPN** : budget interne et externe, PO à faire, engagé, réceptionné, soldé, reste.
- Toute personne **interne** nommée dans l'équipe du projet peut faire une PO.
- Nouvelle page Budget ; lien dans la bannière pour les personnes concernées. `dist/` : 9 fichiers. Tests : 138, plus l'essai de la page.
- Pas encore : import du réalisé (actuals) et valeur acquise (EVM), prévus pour la suite.

## 0.8.0 — dépendances, rôles, personnes et équipes depuis la page Structure

- **Dépendances** : liste amont et aval sur la carte d'un livrable ou d'un jalon, ajout (même programme), retrait, type et décalage ; refus des boucles, doublons et liens d'un élément avec lui-même.
- **Rôles** : ajouter ou retirer une personne sur la carte d'un rôle, bouton « Attribuer un rôle » ; jamais de rôle plus élevé que le sien, même dans les listes proposées.
- **Personnes** : ajouter, modifier (formulaire complet pour les responsables), retirer avec annonce des conséquences (rôles terminés, responsabilités libérées).
- **Équipes** : créer, sous-équipes, responsable, membres, suppression seulement si vide, jamais de boucle.
- Formulaire générique réutilisable dans la page ; la fiche d'une personne pour un responsable est désormais le formulaire complet.
- L'import d'un WBS depuis Google Sheets est abandonné. Tests : 128, plus l'essai du parcours dans la page.

## 0.7.0 — création et édition du WBS depuis la page Structure

- **Ajouter, modifier, déplacer, supprimer** des workpackages, sous-workpackages, livrables et jalons dans l'onglet Découpage (WBS) : boutons dans le détail de chaque carte, et « Ajouter un workpackage » en haut de page. Les boutons n'apparaissent que là où le serveur autorise l'action.
- Règles côté serveur (`wbs.create`, `wbs.update`, `wbs.delete`) : codes WBS numérotés automatiquement et uniques, deux niveaux au plus, dates contrôlées, un jalon n'a qu'une date, droits vérifiés sur la destination d'un déplacement.
- **Suppression sans orphelin** : un workpackage non vide refuse la suppression sauf confirmation explicite (cascade) ; supprimer un élément retire ses dépendances et ses exigences de jalon. Le nombre d'éléments et de liens concernés est annoncé avant confirmation.
- L'arbre du WBS porte désormais les identifiants, versions, responsables, dates brutes, nombre de dépendances et droit de modification de chaque carte.
- Tests : 123, plus l'essai du parcours complet dans la page.

## 0.6.0 — Mon compte et Administration

- **Mon compte** : fiche personnelle (fonction, organisation), rôles en lecture seule (les affectations en double sont regroupées), notifications déplacées depuis la page Suivi, affichage (thème automatique, jour ou nuit ; page d'accueil au choix).
- **Administration** (administrateurs seulement) : réglages validés et tracés (administrateurs, copilote, clé Gemini en écriture seule, adresses, dossier), santé de l'installation et du traitement de nuit, jours fériés (ajout d'années, ajustement par site), journaux.
- Bannière : boutons « Mon compte » et « Administration » ; sur téléphone elle passe sur deux lignes au lieu de couper le menu.
- Le résultat de chaque traitement de nuit et du récapitulatif est désormais conservé (affiché dans Santé).
- Les messages de refus indiquent le champ en cause (« Fonction : maximum 80 caractères »).
- Le pied de page du mail récapitulatif renvoie vers Mon compte.
- `dist/` : 8 fichiers. Tests : 115, plus l'essai des six pages.

## 0.5.1 — correctif : vitesse d'affichage et charte graphique

- **Performance** : cache partagé des tables Sheets (invalidé à chaque écriture, 5 minutes au plus), une lecture par table et par requête, propriétés lues en une fois, premier écran préparé avec la page. Objectif : environ 2 secondes au premier affichage, moins d'une seconde ensuite (7 à 8 secondes mesurées sur le projet pilote en 0.5.0).
- **Charte** inspirée d'airbus.com : police Inter (police numérique officielle d'Airbus), bleu de marque #00205B, tous les gris remplacés par des bleus. Rouge, ambre et vert réservés aux états.
- **Bannière commune** aux quatre pages (navigation, bouton jour/nuit) ; logo réglable par `PPM_LOGO_URL`.
- **Thème nuit** : suit l'ordinateur par défaut, choix mémorisé par compte (`ui.set`).
- **Écrans allégés** : contexte et compteurs derrière un bouton « i », légende derrière « ? », pastilles pour les seules exceptions, introductions supprimées, boutons d'actualisation en icône.
- Tests : 105 (dont performance, données préchargées, thème).

## 0.5.0 — lot 4 (partie sans IA) et installation simplifiée

- Page Copilote : synthèse chiffrée, simulation « et si… », signaux faibles, suggestions à décider ; copilote Gemini en trois modes (désactivé, copier-coller, API) avec garde-fou des chiffres, journal et quota.
- `dist/` : 6 fichiers fabriqués par `tools/build.js` ; `installerPpm()` : installation en une fonction ; contrôle de version des pages.

## 0.4.0 — lot 2

- Baselines (demande, gel, refus, réactivation), écarts, fil des changements à valider, agenda Google et dossier Drive par projet, annuaire, import de personnes, mail récapitulatif, page Suivi.

## 0.3.0 — lot 1 (suite)

- Fonction et organisation des personnes ; page Structure : OBS (par rôles ou par équipes) et WBS, attributs affichables au choix, mémorisés par compte.

## 0.2.0 — lot 1

- Planning : Gantt, chemin critique, marges, vue programme, déclaration d'avancement, attribution des rôles.

## 0.1.0 — lot 0

- Socle : schéma de données, droits par rôle et périmètre, journal des changements, moteur de règles, API JSON, calendriers FR/DE/UK/IN, installation, jeu de démonstration.
