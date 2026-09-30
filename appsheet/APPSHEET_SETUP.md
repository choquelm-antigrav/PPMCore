# Configuration de l'application AppSheet « PPM » — lot 0

Toutes les opérations se font **avec le compte propriétaire** (H16), celui qui possède déjà le projet Apps Script et les deux classeurs. AppSheet appelle les scripts de ce compte, et les utilisateurs n'ont jamais accès aux classeurs eux-mêmes.

Prérequis : `setupPpm()` exécuté (les deux classeurs existent), et de préférence `seedDemo()` pour qu'AppSheet détecte les types sur des données réelles.

## 1. Créer l'application

1. Sur appsheet.com : **Create → App → Start with existing data**, choisir le classeur **PPM Données**.
2. Dans **Data**, ajouter chaque feuille du classeur Données comme table (bouton **+**), sauf `_Snapshot` qui n'existe que dans l'Historique.
3. Ajouter aussi la table **ChangeEvent** depuis le classeur **PPM Historique** (fil des changements du chef de projet).
4. **Settings → Security → Require sign-in** : activé, et restreindre au domaine de l'entreprise.

## 2. Régler les colonnes

Le détail table par table est dans `COLONNES.md` (généré depuis le schéma, donc toujours à jour). Principes :

- `id` : clé, valeur initiale `UNIQUEID()`, masquée, non éditable.
- Colonnes `*_id` : type **Ref** vers la table indiquée. AppSheet crée alors automatiquement les listes liées (les livrables d'un WP, etc.).
- Colonnes techniques (`created_*`, `updated_*`, `version`) : non éditables et masquées. `deleted` : Yes/No, masquée.
- Colonnes calculées par le Core (score de risque, montant budgété, avancement et statut d'un livrable) : non éditables.
- Après toute évolution du schéma : relancer `setupPpm()` puis, dans AppSheet, **Regenerate structure** sur la table concernée.

## 3. Pas de suppression physique

Pour garder la traçabilité, une ligne n'est jamais effacée :

1. Pour chaque table, **Data → Table → Are updates allowed?** : cocher Adds et Updates, **décocher Deletes**.
2. Créer une action **Supprimer** (Behavior : *Data: set the values of some columns in this row*) qui met `[deleted]` à `TRUE`, avec confirmation.
3. **Security filter** de chaque table : `NOT([deleted])`.

## 4. Relier AppSheet au Core (bots)

Pour **chaque table vivante journalisée** (toutes celles du classeur Données sauf `Insight`) :

1. **Automation → Bots → New bot**, nom `Journal <Table>`.
2. Event : **Data change**, table `<Table>`, types **Adds** et **Updates**.
3. Step : **Run a task → Call a script**, projet Apps Script **PPM Core**, fonction `onRowChanged`.
4. Paramètres :
   - `tableName` : `"<Table>"` (texte entre guillemets, ex. `"PlanItem"`)
   - `rowId` : `[id]`
   - `actorEmail` : `USEREMAIL()`

Le Core journalise, incrémente la version, annule une dépendance qui fermerait un cycle, propage les déclarations d'avancement et prévient le chef de projet d'une demande de rebaselining. Si un appel échoue, la réconciliation nocturne le rattrape.

Ne pas créer de bot « For Each Row in Table » sur `PlanItem` : la plateforme le plafonne à 10 000 lignes (section 3 de la spécification).

## 5. Droits dans AppSheet (première barrière)

Le Core revérifie tout ce qui passe par lui ; AppSheet sert de première barrière pour l'édition directe.

**Slice « Mes rôles »** sur `RoleAssignment` :

```
AND([resource_id].[email] = USEREMAIL(), NOT([deleted]))
```

**Condition de l'action système Edit de `PlanItem`** (Behavior → *Only if this condition is true*) :

```
COUNT(SELECT(RoleAssignment[id], AND(
  [resource_id].[email] = USEREMAIL(),
  NOT([deleted]),
  IN([role_code], LIST("PL", "DPL", "CP", "RWP")),
  OR(
    AND([scope_type] = "project", [scope_id] = [_THISROW].[project_id]),
    AND([scope_type] = "workpackage", OR([scope_id] = [_THISROW].[wp_id], [scope_id] = [_THISROW].[wp_id].[parent_wp_id])),
    AND([scope_type] = "program", [scope_id] = [_THISROW].[project_id].[program_id])
  )
))) > 0
```

Même principe pour `WorkPackage` (portée projet, WP ou programme) et `Project` (portée projet ou programme). Simplification assumée : les dates de début et de fin des affectations ne sont contrôlées que par le Core.

## 6. Actions métier du lot 0

| Action | Table | Comportement | Condition d'affichage |
| --- | --- | --- | --- |
| Déclarer l'avancement | PlanItem | *App: go to another view* avec `LINKTOFORM("ProgressUpdate_Form", "deliverable_id", [id])` | `[item_type] = "Livrable"` |
| Demander un rebaselining | Project | `LINKTOFORM("Baseline_Form", "project_id", [id])` | toujours |
| Supprimer | toutes | met `[deleted]` à `TRUE` | droit d'édition |

Valeurs initiales utiles :

- `ProgressUpdate.resource_id` : `ANY(SELECT(Resource[id], [email] = USEREMAIL()))` ; `declared_at` laissé vide (le Core l'horodate).
- `ProgressUpdate` : Adds uniquement (une déclaration ne se modifie pas, on en fait une nouvelle).
- `Baseline.status` : `"Demandée"` ; `Baseline.requested_by` : `USEREMAIL()`.

## 7. Vues minimales

- **Projets** (deck) → détail avec WP, livrables, risques en listes liées.
- **Livrables** (table groupée par WP), **Dépendances**, **Risques**.
- **Mes alertes** : slice de `Insight` avec `[status] = "Nouveau"`.
- **Fil des changements** : `ChangeEvent`, filtré sur les projets dont l'utilisateur est chef de projet :

```
IN([project_id], SELECT(RoleAssignment[scope_id], AND(
  [resource_id].[email] = USEREMAIL(), [role_code] = "CP", [scope_type] = "project", NOT([deleted]))))
```

  Seule la colonne `acknowledged` est éditable.

## 8. Langues

AppSheet n'a qu'une langue d'interface par application (**Settings → Localize**). Pour le français, l'anglais et l'allemand, les libellés visibles se calculent par expression à partir de `UserSetting.language` de l'utilisateur. À trancher au lot 1 : expressions de libellés, ou une copie de l'application par langue.

## 9. Recette du lot 0

1. Créer un livrable dans AppSheet → une ligne `ChangeEvent` « (création) » apparaît, `version` = 1.
2. Modifier sa date → événement `planned_finish` avec ancienne et nouvelle valeur, `version` = 2.
3. Créer A → B puis B → A → la seconde dépendance disparaît (supprimée logiquement) et son auteur reçoit un mail.
4. Déclarer 100 % sur un livrable → statut « Terminé », date de fin réelle posée.
5. Lancer `nightlyRun()` depuis l'éditeur → alertes créées dans `Insight`, sauvegarde dans « PPM Sauvegardes ».

## 10. Lot 1 — structure, organisation et planning

Le lot 1 ajoute trois panneaux dans AppSheet et le planning graphique (Gantt) servi par la web app du Core. Les saisies restent dans AppSheet ; le Gantt sert à voir, à déplacer des dates et à déclarer l'avancement.

### 10.1 Panneau D — Structure (WBS)

- Vue **Structure** : table sur `WorkPackage`, groupée par `project_id` puis `parent_wp_id`, triée par `wbs_code`.
- `WorkPackage.parent_wp_id`, **Valid If** (limite de deux niveaux, aussi contrôlée par le Core) :

```
SELECT(WorkPackage[id], AND(
  [project_id] = [_THISROW].[project_id],
  ISBLANK([parent_wp_id]),
  [id] <> [_THISROW].[id],
  NOT([deleted])
))
```

- `WorkPackage.parent_wp_id`, **Show If** (un WP qui a déjà des sous-WP ne peut pas devenir sous-WP) :

```
ISBLANK(FILTER("WorkPackage", AND([parent_wp_id] = [_THISROW].[id], NOT([deleted]))))
```

- `PlanItem.wp_id`, **Valid If** : `SELECT(WorkPackage[id], AND([project_id] = [_THISROW].[project_id], NOT([deleted])))`.
- `Dependency.successor_id`, **Valid If** : `SELECT(PlanItem[id], AND(NOT([deleted]), [id] <> [_THISROW].[predecessor_id]))`. Les boucles sont détectées par le Core (section 4 de ce guide).

### 10.2 Panneau C — Organisation (OBS)

- Colonne virtuelle `RoleAssignment.[Périmètre]` (texte) :

```
IFS(
  [scope_type] = "program", LOOKUP([scope_id], "Program", "id", "name"),
  [scope_type] = "project", LOOKUP([scope_id], "Project", "id", "name"),
  [scope_type] = "workpackage", LOOKUP([scope_id], "WorkPackage", "id", "name")
)
```

- `RoleAssignment.scope_id`, **Valid If** :

```
IFS(
  [scope_type] = "program", Program[id],
  [scope_type] = "project", Project[id],
  [scope_type] = "workpackage", WorkPackage[id]
)
```

- Vue **Organisation** : table sur `RoleAssignment`, groupée par `scope_type` puis `[Périmètre]`, filtrée sur les affectations en cours : `AND(NOT([deleted]), OR(ISBLANK([end_date]), [end_date] >= TODAY()))`.
- Pour retirer un rôle, renseigner `end_date` (ne pas supprimer) : l'historique reste lisible.
- **Contrôle par le Core** : toute attribution saisie dans AppSheet est revérifiée par le bot. Il faut le droit d'attribuer les rôles sur le périmètre (PL, DPL ou chef de projet) et un rôle au moins aussi élevé que celui attribué ; on ne peut pas s'en servir pour se nommer soi-même. Sinon l'attribution est annulée et son auteur reçoit un mail.

### 10.3 Panneau A — Planning

1. **URL de la web app** : celle du déploiement (`…/exec`), notée à l'étape 6 du README.
2. Action **Ouvrir le planning** sur `Project` : *External: go to a website*, cible :

```
CONCATENATE("https://script.google.com/a/macros/<domaine>/s/<id-de-deploiement>/exec?view=gantt&project=", [id])
```

3. Action **Ouvrir la vue programme** sur `Program` : même URL avec `&program=` au lieu de `&project=`.
4. Mettre ces deux actions en évidence (*Display prominently*) dans le détail du projet et du programme.
5. Propriété du script `PPM_APPSHEET_URL` (facultative) : l'URL de l'application AppSheet. Le Gantt affiche alors un bouton « Modifier dans AppSheet » dans le détail d'un élément.

Ce que fait le Gantt :

- **Chemin critique** en ambre : éléments dont la marge totale est nulle ou négative. La marge est calculée sur les dates saisies, en jours ouvrés du calendrier de chaque projet ; rien n'est recalculé automatiquement (H7).
- **Retards et dépendances non respectées** en rouge, avec la liste des écarts sous le graphique.
- **Déplacement d'un élément** par glisser-déposer, après confirmation, pour qui a le droit de modifier le WBS. Les successeurs ne bougent pas : l'écart apparaît en rouge.
- **Déclaration d'avancement** depuis le détail d'un livrable, pour tout membre affecté.
- **Vue programme** : une barre par projet, ses jalons, les dépendances entre projets.

### 10.4 Recette du lot 1

1. Créer un sous-WP sous un sous-WP → refusé (liste vide dans AppSheet, et `VALIDATION` par l'API).
2. Ouvrir le planning du projet pilote → WP, livrables, jalon et flèches de dépendance visibles ; chaîne tendue en ambre.
3. Glisser un livrable au-delà du début de son successeur → confirmation, puis flèche rouge et ligne dans « Dépendances non respectées ». Le successeur n'a pas bougé.
4. En tant que simple membre : le déplacement est refusé avec un message ; la déclaration d'avancement fonctionne.
5. Dans AppSheet, un chef de projet se nomme DPL du programme → l'attribution est annulée et il reçoit un mail.
6. Vue programme → une barre par projet ; un clic ouvre le planning du projet.

## 11. Personnes (fonction, organisation) et page Structure (OBS et WBS)

### 11.1 Fonction et organisation d'une personne

Deux colonnes s'ajoutent à la table `Resource` : `job_function` (fonction) et `organization` (organisation, par exemple le service, la société ou le sous-traitant). Après mise à jour du code : exécuter `setupPpm()` (il ajoute les colonnes en fin de feuille), puis dans AppSheet **Regenerate structure** sur `Resource` et `UserSetting`.

Réglages dans AppSheet (détail dans `COLONNES.md`) :

- `job_function` et `organization` : type **Enum** (base Text), **Allow other values** et **Auto-add new values** activés, **Suggested values** :

```
SELECT(Resource[organization], NOT(ISBLANK([organization])), TRUE)
```

(même expression avec `job_function`). La liste se construit toute seule à partir de ce qui est déjà saisi : on choisit une valeur existante plutôt que d'en réécrire une variante. Le Core retire les espaces superflus ; il ne corrige pas les majuscules, « Alpha » et « alpha » restent deux valeurs.
- Longueur maximale : 80 caractères (contrôlée par le Core).
- Colonne `UserSetting.view_prefs_json` : masquée, non éditable. Elle mémorise les attributs que chacun choisit d'afficher sur la page Structure.

Qui peut modifier une fiche :

| Qui | Peut modifier |
| --- | --- |
| La personne elle-même | sa fonction et son organisation |
| Program Leader, DPL, chef de projet | toute fiche, et ajouter une personne |
| Administrateur | tout, y compris l'adresse e-mail (via AppSheet) |

Première barrière, **Editable_If** de la table `Resource` (colonnes fonction, organisation et les autres) :

```
OR(
  [email] = USEREMAIL(),
  COUNT(SELECT(RoleAssignment[id], AND(
    [resource_id].[email] = USEREMAIL(), NOT([deleted]),
    IN([role_code], LIST("PL", "DPL", "CP"))
  ))) > 0
)
```

Pour la personne elle-même, limiter l'édition aux deux colonnes : **Editable_If** de toutes les autres colonnes de `Resource` = même condition sans la ligne `[email] = USEREMAIL()`.

**Contrôle par le Core** : le bot de `Resource` (section 4 de ce guide) revérifie chaque saisie. Une modification non permise est annulée champ par champ, et son auteur reçoit un mail. Une personne ajoutée par quelqu'un qui n'en a pas le droit est annulée.

Le profil tarifaire (`rate_profile`) n'est jamais affiché sur la page Structure : la visibilité des TJM reste une question ouverte.

### 11.2 Ouvrir la page Structure depuis AppSheet

Actions *External: go to a website*, à mettre en évidence :

| Sur la table | Cible |
| --- | --- |
| `Project` | `CONCATENATE("https://script.google.com/a/macros/<domaine>/s/<id-de-deploiement>/exec?view=structure&tab=obs&project=", [id])` (organisation) |
| `Project` | même adresse avec `&tab=wbs` (découpage) |
| `Program` | même adresse avec `&program=` à la place de `&project=` (organisation du programme) |

La page a aussi un onglet **Planning** (le Gantt) : on passe de l'un à l'autre sans revenir à AppSheet.

### 11.3 Ce que montre la page Structure

- **Organisation (OBS) par rôles** : un organigramme où chaque carte est un rôle sur un périmètre (Program Leader, DPL, chef de projet, responsable de workpackage, membre) avec ses titulaires. Chaque rôle dépend du rôle supérieur qui couvre son périmètre. Pour un projet, les rôles du programme au-dessus restent affichés ; ceux des autres projets n'apparaissent pas.
- **Organisation (OBS) par équipes** : l'arbre des équipes hiérarchiques (table `HierarchicalTeam`) avec le responsable de chaque équipe, ses membres (facultatif), et un nœud « Sans équipe » pour les personnes non rattachées. On peut partir d'une équipe précise.
- **Découpage (WBS)** : projet → workpackages → sous-workpackages → livrables et jalons, avec les synthèses (dates, avancement pondéré, chemin critique) sur chaque workpackage. Un projet à la fois.
- **Attributs affichés** (bouton en haut de page) : chacun coche ce qu'il veut voir sur les cartes (fonction, organisation, e-mail, équipe, pays, interne ou externe, fournisseur, capacité, centre de coût, membres ; pour le WBS : code, responsable, organisation du responsable, dates, avancement, statut, imputation, marge). Le nom et le titre restent toujours affichés. Le choix se mémorise par compte et se retrouve à la prochaine ouverture ; « Rétablir les valeurs par défaut » revient au réglage d'origine.
- **Couleur selon** : rôle, organisation, interne ou externe (OBS) ; type de nœud ou organisation du responsable (WBS). La légende est affichée au-dessus du graphique.
- **Replier une branche** avec le bouton sur la carte, zoom, ajustement à l'écran. Un clic sur une carte ou une personne ouvre son détail complet, y compris les attributs masqués.
- **Compléter une fiche** : le détail d'une personne propose de saisir sa fonction et son organisation, avec des suggestions tirées de l'existant, si l'on a le droit de la modifier.

### 11.4 Recette

1. Dans AppSheet, ouvrir la fiche d'une personne, renseigner fonction et organisation → la page Structure les affiche.
2. Page Structure, onglet OBS, projet pilote → l'organigramme montre les rôles ; cocher/décocher « Organisation » → les cartes changent aussitôt. Fermer puis rouvrir la page → le choix est conservé.
3. « Couleur selon : Organisation » → une couleur par organisation, légende au-dessus du graphique.
4. Cliquer sur une personne, changer sa fonction, enregistrer → l'organigramme est rechargé avec la nouvelle valeur.
5. En tant que simple membre : modifier la fiche d'un collègue → refusé ; modifier la sienne (fonction, organisation) → accepté ; dans AppSheet, changer son propre pays → la valeur revient et un mail arrive.
6. Onglet WBS → arbre du projet ; décocher « Livrables et jalons » → il ne reste que les workpackages ; replier une branche → le bouton indique le nombre de cartes cachées.
7. Onglet OBS, « Par équipes » → arbre des équipes ; cocher « Membres de l'équipe » → les personnes sont listées.

## 12. Lot 2 — baselines, changements à valider, agenda, Drive, récapitulatif

Après mise à jour du code : exécuter `setupPpm()` (colonnes et table `SyncLink` ajoutées), puis `installTriggers()` (récapitulatif de 7 h). Dans AppSheet, **Regenerate structure** sur `UserSetting` (nouvelle colonne `calendar_invites`, type Yes/No).

### 12.1 Baselines dans AppSheet

La page **Suivi** (web app, `?view=suivi`) est l'endroit où l'on fige, refuse ou réactive une baseline : c'est elle qui contrôle les droits et prend la copie figée du projet.

Dans AppSheet, la table `Baseline` sert seulement à **demander** une baseline :

- Vue formulaire « Demander une baseline » : colonnes `project_id` et `justification` éditables ; `status` initialisé à `Demandée` (Initial value) et non éditable ; `number`, `decided_by`, `decided_at`, `requested_by` masquées.
- Editable_If des colonnes `status`, `number`, `decided_by`, `decided_at` : `FALSE`.

Contrôle par le Core : une ligne créée dans un autre état est ramenée à « Demandée » ; toute modification des champs de décision est annulée, et son auteur prévenu par mail. Le chef de projet reçoit la demande par mail.

### 12.2 Ouvrir la page Suivi depuis AppSheet

Actions *External: go to a website* sur la table `Project` :

| Action | Cible |
| --- | --- |
| Suivi du projet | `CONCATENATE("https://script.google.com/a/macros/<domaine>/s/<id-de-deploiement>/exec?view=suivi&project=", [id])` |
| Changements à valider | même adresse suivie de `&tab=changes` |
| Agenda et Drive | même adresse suivie de `&tab=workspace` |

Les colonnes `Project.calendar_id` et `Project.drive_folder_id` sont remplies par le Core : les mettre en lecture seule dans AppSheet.

### 12.3 Ce que montre la page Suivi

- **Écarts à la baseline** : fin du plan, éléments glissés (en jours ouvrés), ajoutés, retirés, responsables changés, budget (pour ceux qui gèrent le budget, et seulement s'il est saisi). On peut comparer la baseline active au planning d'aujourd'hui, ou deux baselines entre elles.
- **Changements à valider** (chef de projet, DPL) : chaque modification des dates, responsables, budget ou périmètre depuis la baseline active, avec son auteur. On valide une sélection ou tout d'un coup ; l'historique reste consultable. L'avancement déclaré n'y figure pas : ce n'est pas une donnée figée.
- **Baselines** : liste, demandes en attente (Figer ou Refuser, avec motif), réactivation d'une ancienne baseline (avec motif).
- **Agenda et Drive** : création de l'agenda et du dossier du projet, liens, synchronisation immédiate.
- **Notifications** (déplacées dans la page **Mon compte**, icône de personne en haut à droite) : fréquence du récapitulatif (chaque matin de semaine, le lundi, jamais), échéances personnelles dans son agenda, aperçu du récapitulatif et envoi d'essai.

Le Gantt montre la baseline active sous forme d'un trait gris sous chaque barre (case « Baseline » pour le masquer) ; le détail d'un élément indique son glissement.

### 12.4 Recette du lot 2 (porte : B0 du pilote figée, notifications et agendas en service)

1. Page Suivi, projet pilote, onglet Baselines : **Figer la baseline B0** avec une justification. Le contexte affiche « Baseline active : B0 ».
2. Dans le Gantt, déplacer un livrable de quelques jours : le trait gris reste à l'ancienne position ; le résumé indique « 1 élément glissé ».
3. Page Suivi, onglet Écarts : le livrable apparaît avec son glissement. Onglet Changements à valider : la modification y est, avec votre nom ; la valider.
4. En tant que simple membre (autre compte) : demander une baseline depuis la page Suivi ou AppSheet. Le chef de projet reçoit un mail ; il la refuse avec un motif.
5. Onglet Agenda et Drive : **Créer l'agenda et le dossier du projet**. Ouvrir l'agenda : un événement par jalon et par échéance. Ouvrir le dossier : un sous-dossier par workpackage.
6. Déplacer un jalon dans le Gantt : son événement change de date dans la minute.
7. Mon compte, onglet Notifications : **Voir mon récapitulatif**, puis **Me l'envoyer maintenant** : le mail arrive, avec des liens vers les pages.
8. Le lendemain matin (jour de semaine) : chaque membre concerné reçoit un seul récapitulatif.

## 13. Depuis la version 0.7.0 : le WBS se crée dans les pages web

Les workpackages, sous-workpackages, livrables et jalons se créent, se modifient, se déplacent et se suppriment depuis la page **Structure** (onglet Découpage), avec les règles décrites dans le README (codes automatiques, deux niveaux, dates, suppression sans orphelin).

AppSheet reste utilisable pour ces tables, mais **il ne passe pas par ces règles** :

- **Ne supprimez pas** un workpackage dans AppSheet : son contenu resterait sans rattachement, et les dépendances d'un élément supprimé resteraient en place. Utilisez le bouton « Supprimer » de la page Structure.
- Les codes WBS ne sont pas numérotés automatiquement dans AppSheet.
- Pour éviter les écarts, vous pouvez rendre les tables `WorkPackage` et `PlanItem` en lecture seule dans AppSheet (Update et Delete désactivés) et n'y garder que la consultation.

Même remarque pour les personnes, les rôles et les équipes (0.8.0) : ils se gèrent depuis la page Structure, qui applique la règle du rang pour les rôles et libère les responsabilités d'une personne retirée. AppSheet ne le fait pas : retirer une personne dans AppSheet laisserait ses rôles en cours et ses livrables à son nom. Depuis la 0.8.0, l'outil se passe entièrement d'AppSheet.
