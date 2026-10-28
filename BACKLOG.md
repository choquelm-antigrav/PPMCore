# Backlog, dans l'ordre où je propose de le faire

*Mis à jour avec la 0.18.0. L'ordre suit trois idées : vérifier avant d'empiler, faire d'abord ce qui sert chaque semaine, ne construire une fonction que quand celle dont elle dépend existe.*

## Fait récemment

- **0.18.0 : versions figées de l'exercice** : instantané (attendu, accordé, parts des livrables), comparaison entre deux versions ou avec l'état actuel, validation par le niveau du dessus.
- **0.17.4 : l'exercice dans un tableur** : export et import Google Sheet du budget attendu et accordé par équipe et des parts des livrables (analyse avant écriture, copie de sécurité, rien de supprimé).
- **0.17.3 : jalons, finitions** (ancienne étape 6) : « Mes jalons » dans la page Compte, jalon à venir creux et jalon passé plein dans le Gantt, rappel du responsable puis de ceux qui pilotent dans le récapitulatif du matin, vérification que les autres consommateurs ignorent un jalon passé.
- **0.17.2 : jalon passé** : le responsable du jalon (Deliverable owner, ou un niveau au-dessus) déclare explicitement qu'un jalon est passé (ou le rouvre) ; il sort des alertes d'échéance. Voir le README.
- **0.17.1 : exercice budgétaire** (plan : `PLAN_EXERCICE_BUDGETAIRE.md`, phases 0, 1 et 2 ; la phase 3 en partie).

## À faire

| # | Étape | Pourquoi à cette place | Taille |
|---|---|---|---|
| 1 | **Vérifier dans le vrai Apps Script** : installer (`A1_INSTALLER_PPM`), semer la démo, exporter et importer sur une copie (projets et équipes), mesurer la durée d'un lot, vérifier la création et le partage des classeurs dans Drive, les nouvelles feuilles (`EtpCost`, `Exercise`, `TeamBudget`), les droits des vrais comptes | Presque tout a été vérifié sur de faux services. Chaque version ajoute un risque non mesuré : on le mesure avant d'empiler d'autres fonctions. | Moyenne (surtout du temps à la main) |
| 2 | **Exercice : constats du moteur de règles** : attendu dépassé par les livrables, accordé inférieur aux parts (clash), équipe sans budget, nom d'équipe hors règle ; **dépassement d'enveloppe de workpackage** (règle de constat prévue de longue date) | Réutilise les écarts et les versions (faits) : le moteur n'a plus qu'à les signaler. | Petite à moyenne |
| 3 | **Exercice : suivi en exécution** : accordé · prévu · engagé (commandes d'achat) · avancement par équipe ; révisions de février et d'avril enregistrées en versions ; passage d'un exercice de « préparation » à « exécution » avec ses livrables | Dépend des constats (étape 2) ; les versions sont faites ; c'est le dernier maillon du cycle annuel. | Moyenne à grande |
| 4 | **Baselines : finitions** : sélecteur de référence dans le Gantt, badges « référence locale non validée », relance d'une baseline à valider après N jours, conservation limitée des baselines archivées | Confort et hygiène de l'existant ; la relance d'une baseline à valider pourra reprendre le mécanisme du rappel de jalon (récapitulatif du matin), déjà en place. | Moyenne |
| 5 | **Équipes : finitions** : import de la structure aussi depuis la page Administration ; déplacer une personne d'une équipe à une autre et retirer une équipe (l'import actuel ne le fait jamais) ; liste des équipes dont le nom ne suit pas la règle des 3 ou 4 caractères | Demande de l'usage : à décider une fois la structure importée en vrai (étape 1). | Petite |
| 6 | **Nettoyage** : retrait de la migration des anciens codes de rôle (RWP, MEMBER) et de la démo historique ; règle pour les anciens « membres de projet » à trancher (en faire un Contributor de chaque livrable est déconseillé : 1 350 lignes sur l'ancienne démo) | Sans valeur tant que l'outil n'a pas de vraies données à migrer ; à faire quand on sait s'il y en aura. | Petite à moyenne |

## Règle de tenue

Chaque étape sort comme les précédentes : essais, sabotages de contrôle, documentation, publication sur `main`, avec son numéro de version.
