# Plan : l'exercice budgétaire annuel

*Document de cadrage, sans code. Version après arbitrages avec Max (la ligne de coupe, la priorité et l'étape de novembre sont abandonnées).*

## 1. Le besoin, en une page

Chaque année, il faut passer d'un **budget attendu par équipe** à **une liste de livrables chiffrés par équipe** qui tient dans ce budget, puis suivre l'exécution.

| Moment (approximatif) | Ce que l'on fait | Ce que l'outil montre |
|---|---|---|
| **Avant l'été** | Un budget attendu **par équipe à 3 caractères** (ex. `1vm`), **par projet**. Rien en dessous n'est obligatoire. | Un tableau **projets × équipes** |
| **Septembre** | Les **livrables** que chaque équipe fournira. Chaque livrable porte un **montant libre par équipe** (un livrable est souvent réparti sur plusieurs équipes). Le total des livrables d'une équipe doit rejoindre son budget d'avant l'été. | Par équipe : **budget attendu · total des livrables · écart** |
| **Décembre** | Le **budget réellement accordé** est cascadé au programme et aux projets. Il peut être **réduit** : c'est le **clash** avec les livrables, que l'on résorbe en redéfinissant les livrables. | Même vue, contre le **budget accordé** : l'écart est le clash |
| **Année en exécution** | Suivi de l'avancement des livrables contre le budget. **Février et avril** : le budget accordé peut être réduit ou augmenté. | Accordé · prévu · engagé · avancement, par équipe |

Règles de cadrage retenues :
- **Une équipe à 3 caractères porte le budget** ; une équipe à **4 caractères** (ex. `1vmd`, rattachée à `1vm`) est un détail **facultatif** qui s'additionne dans sa parente. Le niveau se lit au **nombre de caractères du nom** de l'équipe.
- On **affiche les écarts, on ne bloque jamais**.
- **Deux exercices au plus à la fois** : un **en préparation** (l'année qui vient), un **en exécution** (l'année en cours), jamais sur les mêmes livrables : **chaque livrable appartient à un seul exercice**.
- **Le Workpackage leader et les niveaux au-dessus voient l'exercice en entier** ; en dessous, rien.
- Les montants sont **libres** ; la conversion en jours est un **calcul à la demande**.

## 2. Hors périmètre (volontairement)

La ligne de coupe, la priorité des livrables, l'étape de novembre, les lignes de budget par personne et par jour, les scénarios multiples d'un même exercice. Une priorité pourra s'ajouter plus tard si le clash de décembre devient trop lourd à arbitrer à la main.

## 3. Changement préalable : plus aucun taux journalier

Décision : **supprimer la notion de taux journalier dans tout l'outil** et ne garder que le **coût d'un ETP par pays et par an**, paramétré par **l'administrateur** (Administration, une zone « Coût d'un ETP »).

- **Conversion montant → jours** : `jours = montant ÷ (coût annuel d'un ETP du pays ÷ jours ouvrés de l'année du pays)`. Les jours ouvrés viennent des jours fériés déjà gérés par pays. Si le coût du pays pour l'année n'est pas paramétré, la conversion affiche « à paramétrer », jamais un faux chiffre.
- **Ce qui disparaît** : le taux sur la fiche d'une personne, le profil tarifaire, la grille de taux (profil, pays, taux, date d'effet), le taux figé d'une ligne de budget, les jours × taux, la colonne « Taux journalier » de la page Ressources, la colonne « Taux journalier (€) » des classeurs d'import et d'export, le droit « fixer les tarifs ».
- **Ce qui devient** : le budget interne d'un livrable est un **montant par équipe** ; le budget externe reste un **forfait par ressource externe** (les commandes d'achat sont inchangées).
- **Impact mesuré** : 15 fichiers de code (165 occurrences, surtout `43_Budget.gs`, `56_Import.gs`, `46_Resources.gs`, `Ressources.html`, `01_Schema.gs`, `Budget.html`), 17 fichiers d'essais (132 occurrences) et 5 documents. C'est la partie la plus large du chantier.
- Aucune reprise de données : l'outil est en phase de test et n'a pas de données réelles.

## 4. Modèle de données proposé

| Objet | Rôle | Colonnes principales |
|---|---|---|
| **Exercice** | L'année budgétée | année, état (Préparation, Exécution, Clos) ; un seul de chaque état à la fois |
| **Budget d'équipe** | Le tableau projets × équipes | exercice, projet, équipe, **attendu**, **accordé** |
| **Part de livrable** | Le montant d'une équipe sur un livrable | livrable, équipe, montant ; la somme des parts est le coût interne du livrable |
| **Version de l'exercice** | Un instantané figé, comparable au précédent | exercice, libellé (Attendu, Accordé, Révision), date, auteur ; lignes figées du tableau |
| **Coût d'un ETP** | Paramètre de l'administrateur | pays, année, coût annuel |

- Un livrable (`PlanItem`) reçoit son **exercice**.
- Les **parts** remplacent les lignes de budget internes en jours × taux. Les lignes de **forfait externe** restent.
- Le **cumul par équipe à 3 caractères** additionne ses parts propres et celles de ses équipes à 4 caractères. Une équipe à 4 caractères dont la parente n'a pas 3 caractères est signalée ; une équipe d'une autre longueur n'est pas budgétée (avertissement).

## 5. Les écrans

- **Page « Exercice »** (nouvelle, dans la navigation, visible à partir du Workpackage leader) avec un sélecteur d'exercice (préparation ou exécution) et trois vues :
  1. **Budget attendu** : le tableau projets × équipes, modifiable par les chefs de projet pour leurs projets ; la vue programme additionne ses projets ; le non réparti apparaît à chaque niveau.
  2. **Livrables par équipe** : pour chaque équipe, **attendu · total des livrables · écart**, puis la liste de ses livrables avec leur part ; une équipe à 4 caractères se replie dans sa parente. L'écart se résorbe en ajoutant, retirant ou rechiffrant des livrables.
  3. **Accordé et clash** : le budget accordé par équipe et par projet (cascadé du programme), comparé au total des livrables : l'écart est le clash ; les révisions de février et d'avril s'y saisissent.
- **Suivi** (exercice en exécution) : accordé · prévu · engagé (commandes d'achat) · avancement des livrables, par équipe.
- **Administration** : la zone « Coût d'un ETP » (pays × année).
- **Import et export par Google Sheet** du tableau projets × équipes et des parts de livrables, car ces tableaux se préparent d'abord dans un tableur ; mêmes garanties que les imports actuels (analyse avant écriture, copie de sécurité, rien d'écrasé).

## 6. Droits

- Lecture de l'exercice : **Workpackage leader et au-dessus**.
- **Budget attendu** d'un projet : chef de projet et au-dessus. **Budget accordé** : à trancher (DPL et au-dessus ?).
- Parts des livrables : celui qui peut modifier le livrable.
- **Coût d'un ETP** : administrateur seulement.
- Les changements du budget accordé sont des **changements à valider** par le niveau du dessus, comme le reste de l'outil.

## 7. Phases de construction

| Phase | Contenu | Taille |
|---|---|---|
| **0** | Suppression des taux journaliers, coût d'un ETP par pays et par an (zone d'administration), aide de conversion, lignes de budget internes en montants par équipe, imports adaptés | Grande |
| **1** | Exercice, tableau projets × équipes (attendu), vue programme, import et export | Moyenne |
| **2** | Livrables rattachés à un exercice, parts par équipe, vue « attendu · livrables · écart » avec le cumul des équipes à 4 caractères | Moyenne |
| **3** | Budget accordé, clash, versions figées et leur comparaison, validation par le niveau du dessus | Moyenne |
| **4** | Exécution : suivi accordé / prévu / engagé / avancement, révisions de février et d'avril, passage d'un exercice de « préparation » à « exécution » | Moyenne |

Chaque phase est livrée avec ses essais, ses sabotages de contrôle et sa documentation, comme les précédentes, et se publie sur `main` quand elle est terminée.

## 8. Risques et points ouverts

- **La phase 0 est large** : elle touche aux budgets, aux imports, aux ressources et aux essais. C'est elle qu'on fait d'abord, seule, pour rester sûr de ne rien casser.
- **Pays d'une équipe** : la conversion en jours demande un pays par équipe (ou une règle). À trancher.
- **Équipes de pays différents** dans une même équipe à 3 caractères : le pays d'une équipe suffit-il ?
- **Base des jours ouvrés** : jours ouvrés du calendrier du pays (proposé) ou un nombre fixe par an ?
- **Programme** : « chaque projet et programme demande du budget » : le programme est-il la somme de ses projets (proposé) ou a-t-il aussi des lignes propres ?
- **Qui saisit l'accordé** et à quel niveau se fait la validation.
- **Équipes mal nommées** : le niveau budgétaire se lit au nom ; une faute de frappe d'un caractère change le niveau. L'import des équipes et l'écran signalent les noms qui ne suivent pas la règle.

## 9. État d'avancement (0.17.1)

- **Phase 0 faite** : plus aucun taux journalier, coût d'un ETP par pays et par an, conversion en jours, lignes de budget en parts d'équipe et forfaits, imports adaptés.
- **Phase 1 faite** : exercices, tableau par équipe de l'attendu et de l'accordé, vue programme. L'import et l'export Google Sheet de ce tableau ne sont **pas** faits (la saisie se fait dans la page Budget).
- **Phase 2 faite** : livrables rattachés à un exercice, parts par équipe, vue « attendu · livrables · écart » avec le détail des équipes à 4 caractères.
- **Phase 3 en partie** : l'accordé, l'écart et le clash sont faits ; les **versions figées** et leur comparaison, et la **validation par le niveau du dessus**, restent à faire.
- **Phase 4 à faire** : suivi accordé / prévu / engagé / avancement, révisions de février et d'avril, passage d'un exercice de « préparation » à « exécution » avec ses livrables.
- Choix tranchés avec Max : pays par équipe (oui), jours ouvrés du calendrier du pays (oui), accordé saisi par le chef de projet et au-dessus.
