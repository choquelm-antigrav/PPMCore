# Mettre à jour PPM sans perdre les données

À lire avant de publier une nouvelle version. Pour la toute première installation, voir `PREMIERS_PAS.md`.

## En une phrase

**Le code se remplace, les données ne bougent pas** : elles sont dans deux classeurs Google Sheets, que la mise à jour ne touche pas, tant qu'on reste dans le **même projet Apps Script**.

## Où sont les données

| Quoi | Où | Ce qu'il contient |
|---|---|---|
| Classeur **« PPM Données »** | Google Drive | projets, planning, personnes, rôles, budget, achats, réunions |
| Classeur **« PPM Historique »** | Google Drive | journal des modifications, écarts de baseline (ne se réécrit jamais) |
| Identifiants des classeurs, domaine, administrateurs, clés | **Propriétés du script** (⚙ Paramètres du projet) | `PPM_DATA_ID`, `PPM_HISTORY_ID`, `PPM_DOMAIN`, `PPM_ADMINS`… |

Le code (`PPM_Core.gs` et les pages) ne contient **aucune donnée**.

## Ce que fait `A1_INSTALLER_PPM` quand on le relance

Il est conçu pour être relancé sans risque sur des données existantes :

- il **ajoute les colonnes manquantes en fin de feuille** ; il ne renomme ni ne supprime jamais rien (règle de `01_Schema.gs`) ;
- il ne réinsère les rôles et les jours fériés **que s'ils manquent** ;
- il recrée les déclencheurs de l'outil (il supprime d'abord les siens) ;
- il ne touche **ni aux projets, ni aux personnes, ni aux saisies**.

**À ne jamais lancer sur de vraies données** : `A2_SEED_DEMO` (crée une démo) et `A6_EFFACER_DEMO` (efface la démo, repérée par les programmes `NAC` et `DEMO`). Ne lancez pas A2 « pour voir » sur votre installation de production.

## La procédure, pas à pas

1. **Sauvegarder.** Dans Drive, faites une copie de « PPM Données » et de « PPM Historique » (clic droit › *Faire une copie*). L'outil copie aussi les deux classeurs chaque nuit dans le dossier « PPM Sauvegardes » et **supprime les copies de plus de 30 jours** : ne comptez pas dessus seul.
2. **Remplacer le code** dans le **même** projet Apps Script : collez les fichiers de la nouvelle version (toujours **tous** : c'est plus sûr que de chercher ce qui a changé), y compris `appsscript.json`, puis enregistrez.
3. **Relancer `A1_INSTALLER_PPM`.** Il peut demander une nouvelle autorisation (quand le manifeste ajoute une permission) : acceptez-la. C'est le propriétaire du script qui l'accepte.
3 ter. **Depuis la 0.15.3 : lancer `A9_MIGRER_ROLES_SIMULATION`** (compte sans rien écrire), puis **`A9_MIGRER_ROLES`**, **autant de fois que nécessaire jusqu'à « Migration faite »** (un lancement écrit au plus 300 lignes). Faites-le après une copie des deux classeurs. Tant que ce n'est pas fini, les anciens rôles gardent leurs droits.
3 quater. **Depuis la 0.15.5** : `A1_INSTALLER_PPM` ajoute les colonnes `scope_type` et `scope_id` à la feuille Baseline et `active_baseline_id` à WorkPackage ; les baselines existantes restent des baselines du projet, sans migration. **Avant `A9_MIGRER_ROLES`**, lancez `A9_MIGRER_ROLES_SIMULATION` : la migration d'un « membre de projet » écrit une ligne de Contributor par livrable et jalon, et avertit au-delà de 500 lignes.
4. **Lancer `A7_TESTER_DANS_APPS_SCRIPT`** : il contrôle l'installation, les services, les déclencheurs, le temps d'ouverture de chaque page et les accès au classeur, sans rien écrire (sauf, au plus une fois par heure, l'adresse mémorisée de l'application). Gardez le journal pour comparer avant et après.
5. **Publier sans changer l'adresse** : **Déployer › Gérer les déploiements › crayon › Version : Nouvelle version › Déployer**. N'utilisez **pas** « Nouveau déploiement » : l'adresse changerait et les anciens liens (collègues, AppSheet) cesseraient de fonctionner.
6. **Vérifier** : ouvrez l'outil, regardez quelques projets et personnes, puis Administration › santé de l'installation.

À partir de la 0.14.2, `A1` pose aussi le déclencheur facultatif `warmCache` (cache gardé plein toutes les 5 minutes en semaine, de 6 h à 21 h).

## Exporter vos projets dans un classeur, et les remettre (depuis la 0.16.0)

La **page Administration › Projets : export et import** exporte des projets (ou un programme entier) dans un classeur Google Sheet, et importe un classeur. C'est le moyen de **garder ses projets en repartant d'une installation neuve**, et un complément à la copie des classeurs.

**Garder vos projets en réinstallant à neuf**
1. **Exporter** : page Administration, cochez tous vos programmes, **Exporter la sélection**. Gardez le classeur créé dans Drive (c'est votre sauvegarde ; vous pouvez en faire une copie).
2. **Réinstaller** : dans les propriétés du script, supprimez **seulement** `PPM_DATA_ID` et `PPM_HISTORY_ID` (gardez le reste : domaine, administrateurs, adresse AppSheet), collez le nouveau code, lancez `A1_INSTALLER_PPM` : deux classeurs neufs, vides, sont créés.
3. **Importer** : page Administration, collez le lien du classeur, **Analyser**, puis **Importer**. Le classeur recrée les programmes, les projets, les personnes, le découpage, les dépendances, le budget et les enveloppes. Vérifiez le rapport avant d'importer : il dit chaque erreur avec son onglet et sa ligne.
4. **Reconfigurer AppSheet** vers les nouveaux classeurs.
5. Les **Program Leaders** et les **DPL** ne sont pas dans le classeur (leurs rôles de programme et de projet ne s'exportent pas) : reposez-les dans la page WBS, section Rôles. Le chef de projet, lui, vient de la colonne « Chef de projet ».

**Ce que cette sauvegarde ne contient pas** : les baselines (historique figé), les risques, les réunions et actualités, les achats (PO), le journal des modifications, les équipes. Si vous tenez à l'un d'eux, la copie des deux classeurs « PPM Données » et « PPM Historique » (étape 1 de la procédure) reste la référence : **ne supprimez pas les anciens classeurs avant d'avoir vérifié le nouveau**.

**Importer dans une installation qui contient déjà des projets** est sans risque : rien n'est supprimé, ce qui existe déjà et qui est identique n'est pas touché, et une **copie de sécurité** des projets concernés est enregistrée avant d'écrire.

## Les pièges à éviter

- **Ne copiez jamais le projet Apps Script dans un nouveau fichier ou un autre compte.** Les propriétés du script ne suivent pas : si `PPM_DATA_ID` est absent, `A1` crée **deux classeurs vides**. Vos données semblent perdues, mais elles sont toujours dans l'ancien classeur. Gardez un seul projet Apps Script.
- **Ne supprimez pas les classeurs** pour « repartir propre » : l'outil ne sait plus les retrouver.
- **Ne renommez pas une feuille ni une colonne** à la main : l'outil ne sait plus la relire.
- **Déclencheurs en double** (si `A5` a été lancé plusieurs fois) : la santé de l'installation le signale ; relancer `A1` les remet d'aplomb.
- **Une nouvelle version ne convertit pas les données** : elle ajoute seulement des colonnes. Si une version devait changer le sens d'une colonne, le journal des versions (`CHANGELOG.md`) le dirait, et il faudrait un script de migration explicite.

## Si quelque chose ne va pas

Revenez au code précédent : **Gérer les déploiements › crayon › Version** : choisissez la version précédente (Apps Script les conserve). Les classeurs n'ont pas à être restaurés, car la mise à jour ne les a pas modifiés. Si une donnée a été écrasée, la copie de l'étape 1 et le classeur « PPM Historique » permettent de la retrouver.

## Qui fait quoi : propriétaire, administrateur, utilisateur

Il y a trois statuts différents, et on peut en cumuler plusieurs (c'est le cas du compte qui a installé l'outil).

| | **Propriétaire du script** | **Administrateur de l'outil** | **Utilisateur** |
|---|---|---|---|
| Qui est-ce | le compte qui a créé le projet Apps Script et qui déploie | une adresse listée dans `PPM_ADMINS` (Administration › Réglages, ou propriétés du script) | toute personne du domaine autorisé |
| Installer (`A1`, `A5`) | **oui**, depuis l'éditeur Apps Script, une seule fois | non, sauf s'il est aussi éditeur du projet Apps Script | **jamais** : rien à installer |
| Mettre à jour (code, `A1`, `A7`, déploiement) | **oui, seul** : c'est lui qui accepte les autorisations | non | **jamais** |
| Autoriser les permissions Google | **oui** (une fois, et à chaque nouvelle permission) | non | **non** : l'outil s'exécute « en tant que le propriétaire », donc aucune fenêtre d'autorisation |
| Page Administration (réglages, partage du classeur, protections, copilote, jours fériés) | si aussi administrateur | **oui** | non |
| Ce qu'il fait des données | tout (il est propriétaire des classeurs) | gère les réglages, voit tout | agit selon ses **rôles** (PL, DPL, CP, WPL, SWPL, DO, Contributor ; Reader par défaut) |
| Ce qu'il doit faire pour se connecter | — | — | ouvrir l'adresse en `/exec` avec son compte du domaine |

**Les trois points qui surprennent**

1. **Administrateur de l'outil ≠ éditeur du script.** Un second administrateur ajouté dans `PPM_ADMINS` gère les réglages dans l'outil, mais ne peut ni lancer `A1`/`A5`/`A7`, ni mettre à jour le code, ni publier, tant qu'il n'a pas été ajouté comme **éditeur du projet Apps Script** (Partager le projet). Même alors, gardez **un seul compte qui déploie** : l'outil s'exécute en tant que ce compte, et changer de compte de déploiement change l'identité sous laquelle tout s'exécute. Je n'ai pas vérifié ce que fait Google quand un autre éditeur republie un déploiement existant : testez avant de le faire.
2. **Un utilisateur n'a rien à faire pour une mise à jour.** Dès que la nouvelle version est publiée sur le même déploiement, il la reçoit à sa prochaine ouverture de page (rechargez la page s'il garde un onglet ouvert). Il ne réautorise rien.
3. **Un utilisateur doit exister dans l'outil pour avoir des droits.** Son adresse doit être dans le domaine autorisé (`PPM_DOMAIN`) pour ouvrir l'outil ; ses droits viennent ensuite de sa **fiche** (page Ressources, avec son adresse) et des **rôles** qu'on lui pose sur chaque objet (page WBS › section *Rôles*). Sans rôle, il est **Reader** : il lit tout (sauf budgets, tarifs et comptes rendus, à partir du Workpackage leader), il ne modifie rien. Depuis la 0.14.2, créer sa fiche avec une adresse lui ouvre aussi le classeur de données (voir `README.md`), et un rôle de PL, DPL ou chef de projet lui donne en plus le droit de modifier certaines feuilles de ce classeur (0.15.0).

## Attention au compte qui déploie

L'outil identifie chaque utilisateur par son adresse Google. **Google ne la transmet que si le propriétaire du déploiement et l'utilisateur sont dans le même domaine Google Workspace.** Avec un propriétaire sur un compte **Gmail personnel**, les collègues d'un autre domaine peuvent apparaître comme « compte non identifié » et se voir refuser l'accès (voir « Dépannage : Accès réservé » dans `PREMIERS_PAS.md` ; `A4_DIAGNOSTIC_ACCES` montre le compte détecté). Le manifeste déclare un accès « tous les utilisateurs du domaine », prévu pour Workspace.

Pour un usage avec une vraie équipe, **déployez depuis le compte Workspace de l'entreprise** : c'est aussi ce qui devrait retirer le bandeau « créée par un utilisateur de Google Apps Script » (non vérifié). Le passage d'un compte à l'autre demande de **reprendre les mêmes classeurs** : voir le piège « ne copiez jamais le projet » ci-dessus, et faites-le d'abord sur une copie, jamais sur vos données de production.

## Passer à la 0.17.1 (exercice budgétaire, plus de taux journalier)

1. Remplacer les fichiers de l'outil, puis relancer **`A1_INSTALLER_PPM`** : il ajoute les feuilles `EtpCost`, `Exercise`, `TeamBudget` et les colonnes `country` (équipes), `exercise_id` (livrables) et `team_id` (lignes de budget).
2. Les colonnes `daily_rate` et `rate_profile` des personnes, les colonnes `planned_days` et `frozen_rate` des lignes de budget et la feuille `RateCard` ne servent plus : elles restent dans le classeur, inutilisées (on peut les supprimer à la main). **Les anciennes lignes de budget « TJM » ne sont plus reconnues** : l'outil étant en phase de test, il n'y a pas de reprise ; à ressaisir en parts d'équipe.
3. Page **Administration**, zone « Budget : exercices et coût d'un ETP » : créer l'exercice en préparation (et celui en exécution), et saisir le coût annuel d'un ETP des pays utilisés.
4. Page **Ressources** : donner un **pays** aux équipes (France par défaut) ; nommer les équipes avec leur code (3 caractères : porte le budget, 4 : détail rattaché).
5. Classeurs d'import d'avant la 0.17.1 : l'onglet **Budget** a changé (Équipe ou Forfait, un montant) et l'onglet **Personnes** n'a plus de taux (une colonne Équipe) ; regénérer le modèle depuis la page.

## Passer à la 0.19.3 (enveloppes par exercice, baselines à nom automatique)

1. Remplacer les fichiers, relancer **`A1_INSTALLER_PPM`** : il ajoute la colonne `envelopes_json` aux projets et aux workpackages.
2. **Adopter les enveloppes** : le budget autorisé et les enveloppes de workpackages sont maintenant **par exercice**. Les anciennes valeurs sont **reprises en brouillon** (0.19.4) dans la **Décomposition du Budget** de chaque exercice : les vérifier et cliquer sur « Valider », onglet par onglet. **Rattacher les livrables à leur exercice** (bouton de la décomposition) : un livrable sans exercice ne compte plus dans aucun budget.
3. Les feuilles `ExerciseVersion` et `ExerciseVersionLine` (versions figées de l'exercice, retirées) ne servent plus : on peut les supprimer à la main.
4. Les baselines déjà figées gardent leur nom ; les nouvelles s'appellent `P1_n`, `P1_wp_n`, `P1_wp_sous-wp_n`. Les baselines figées avant cette version n'ont pas d'enveloppes par exercice : l'écart le dit (« non figé à l'époque »).
