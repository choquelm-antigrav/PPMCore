# Architecture de PPM

Une application web Google Apps Script : un **Core** (le serveur, un seul fichier `PPM_Core.gs` fabriqué depuis `src/*.gs`) et des **pages** HTML (une par fichier). Les données sont dans deux classeurs Google Sheets (données, historique). Rien n'est hébergé hors de Google Workspace.

## Côté serveur : des couches, numérotées par fichier

Un fichier ne dépend que de ceux qui le précèdent dans cette liste (la fabrication les assemble dans l'ordre des numéros).

| Couche | Fichiers | Rôle |
|---|---|---|
| Points d'entrée | `000_Menu.gs` | les fonctions à lancer à la main (`A1_…` à `A6_…`) |
| Fondations | `00_Config`, `00_Pages`, `01_Schema`, `02_Util` | constantes et droits, **registre des pages**, tables et colonnes, outils |
| Calcul pur | `03_Calendar`, `04_Graph`, `05_Rbac`, `06_Rules`, `07_Schedule` | jours ouvrés, graphe, droits, règles, ordonnancement : sans service Google, testés seuls |
| Données | `10_Repository`, `11_ChangeLog` | lecture et écriture des feuilles, suppression douce, journal des changements |
| Installation | `20_Setup` | création des classeurs, vérifications |
| Accès | `30_Api` | `defineAction`, contrôle des droits, une réponse uniforme |
| Pages et vues | `31_Pages`, `32_Views` | rendu des pages web et données préchargées ; vues du planning |
| Modules métier | `33_Structure` … `49_NewsCollect` | un module par sujet (structure, baselines, Workspace, récapitulatif, copilote, compte, tâches nocturnes, édition, organisation, budget, achats, Overview, ressources, démo, actualités) |

Règles :
- **Une action = `defineAction('module.action', function (p, ctx) {…})`**, qui commence par vérifier les droits (`can`, `requireCan`). Le résultat est une donnée simple.
- **Le calcul est pur et séparé des services Google** : une fonction qui décide (`newsParseNotes_`, `computeBalance_`…) ne touche ni feuille ni agenda. Les services passent par un **adaptateur** remplaçable dans les tests (`WORKSPACE`, `NEWS_ADAPTER`).
- **Les suppressions sont douces** (`repoSoftDelete`) ; aucune écriture n'ignore le verrou ni l'identifiant d'écriture.
- Une donnée qui n'est pas sûre ne se devine pas : on la laisse vide et on le dit (« sans responsable », « à trier »).

## Côté pages : trois parties communes et une logique propre

Chaque page est `src/<Nom>.html` et inclut, dans cet ordre, `Style` (charte et composants CSS communs), `Common` (outils JavaScript communs : `ppm.el`, `ppm.call`, `ppm.toast`, `ppm.frDate`…) et `Header` (barre du haut, données préchargées). Une page qui a des formulaires inclut en plus `CommonForms` (`ppm.forms` : formulaire générique et confirmation ; champ `shared` du registre) : les autres pages n'en portent pas le poids. Elle ne contient que sa mise en page et sa logique. Elle parle au serveur par `call('module.action', params, write)`.

Les pages existantes sont listées dans le **registre `src/00_Pages.gs`**, lu par le serveur, la fabrication, les aperçus et les tests.

**Une grosse page se coupe en morceaux** (champ `parts` du registre) : `Structure.html` garde le marquage et l'assemblage, et inclut dans l'ordre `StructureState`, `StructureDraw`, `StructureLoad`, `StructureDetail`, `StructureEdit` et `StructureOrg`. La fabrication les assemble en une seule page. Les morceaux partagent la fermeture de la page : ce sont des tranches de lecture, pas des modules indépendants. Les fichiers serveur d'un même module se coupent de la même façon (`47_Demo*.gs`, `48_News*.gs`, `49_NewsCollect.gs`) et se retrouvent par leur préfixe.

## Ajouter

- **Une page** : voir l'en-tête de `00_Pages.gs`. `node tests/run.js` dit ce qui manque (`test_pages.js`).
- **Une action** : dans le module concerné, avec ses droits et ses tests. Si la page doit la précharger : `preloadFor_` (`31_Pages.gs`).
- **Une table** : `01_Schema.gs` (colonnes, obligatoires, énumérations). Les colonnes ajoutées à une table existante sont créées toutes seules à l'installation.
- **Un droit** : `00_Config.gs` (`PERMISSIONS`).

## Fabriquer et vérifier

- `node tools/build.js` fabrique `dist/` (le fichier à installer). Ne jamais le modifier à la main.
- `node tests/run.js` : les tests du serveur. `PPM_BUNDLE=dist/PPM_Core.gs node tests/run.js` : les mêmes sur le fichier fabriqué.
- `node tests/ui_*.js` : un essai par page dans jsdom, avec le vrai Core.
- **`A7_TESTER_DANS_APPS_SCRIPT`** : le seul test qui tourne dans le vrai Apps Script (`21_LiveTest.gs`), en lecture seule. Les tests de développement utilisent de faux services : à lancer après chaque mise à jour pour ce qu'ils ne voient pas (droits réels, fuseau horaire, autorisation, déclencheurs, agenda, temps de réponse). Tout nouvel appel de page en lecture seule s'y ajoute ; il ne doit jamais écrire.
- `node tests/preview_demo.js 8124` : la démo complète dans un navigateur ; pour s'assurer qu'un nettoyage ne change rien, lancer l'ancienne et la nouvelle version côte à côte et comparer les captures.
