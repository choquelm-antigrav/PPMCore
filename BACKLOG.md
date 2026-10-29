# Backlog, dans l'ordre où je propose de le faire

*Mis à jour avec la 0.19.0. L'ordre suit trois idées : vérifier avant d'empiler, faire d'abord ce qui sert chaque semaine, ne construire une fonction que quand celle dont elle dépend existe.*

## Fait récemment

- **0.20.1 : réalisé comptable** par projet, équipe et mois (import mensuel du classeur « CUC Total Cost »), projection sur le réalisé, courbe du réalisé, outil budgétaire de l'assistant Gemini entreprise.
- **0.20.0 : versions de la décomposition du budget** : onglets V0, V1… (une version par baseline), version de référence du suivi = dernière baseline validée, bouton « Figer une nouvelle version ».
- **0.19.3 : étanchéité par exercice, projection, graphique, baselines** : enveloppes et coûts propres à chaque exercice, projection de fin d'année à l'avancement, graphique par workpackage, versions du budget portées par les baselines (nom automatique, carte, validateurs en nom complet). Les « versions figées de l'exercice » sont retirées.
- **0.19.0 : page Budget en onglets et suivi budgétaire** : « Suivi budgétaire N » (première page), « OP N+1 », archives ; sections rétractables ; synthèse, graphique, tableaux par équipe et par livrable, prévu, valeur acquise, engagé ; versions en deux colonnes.
- **0.18.1 : constats du moteur de règles sur l'exercice** : clash, dépassement de l'attendu, équipe sans budget, équipe sans livrable, équipe hors règle, version à valider depuis plus de 7 jours, dépassement d'enveloppe de workpackage et de projet ; sans montant, lisibles selon les droits.
- **0.18.0 : versions figées de l'exercice** : instantané (attendu, accordé, parts des livrables), comparaison entre deux versions ou avec l'état actuel, validation par le niveau du dessus.
- **0.17.4 : l'exercice dans un tableur** : export et import Google Sheet du budget attendu et accordé par équipe et des parts des livrables (analyse avant écriture, copie de sécurité, rien de supprimé).
- **0.17.3 : jalons, finitions** (ancienne étape 6) : « Mes jalons » dans la page Compte, jalon à venir creux et jalon passé plein dans le Gantt, rappel du responsable puis de ceux qui pilotent dans le récapitulatif du matin, vérification que les autres consommateurs ignorent un jalon passé.
- **0.17.2 : jalon passé** : le responsable du jalon (Deliverable owner, ou un niveau au-dessus) déclare explicitement qu'un jalon est passé (ou le rouvre) ; il sort des alertes d'échéance. Voir le README.
- **0.17.1 : exercice budgétaire** (plan : `PLAN_EXERCICE_BUDGETAIRE.md`, phases 0, 1 et 2 ; la phase 3 en partie).

## À faire

| # | Étape | Pourquoi à cette place | Taille |
|---|---|---|---|
| 1 | **Vérifier dans le vrai Apps Script** : installer (`A1_INSTALLER_PPM`), semer la démo, exporter et importer sur une copie (projets et équipes), mesurer la durée d'un lot, vérifier la création et le partage des classeurs dans Drive, les nouvelles feuilles (`EtpCost`, `Exercise`, `TeamBudget`), les droits des vrais comptes | Presque tout a été vérifié sur de faux services. Chaque version ajoute un risque non mesuré : on le mesure avant d'empiler d'autres fonctions. | Moyenne (surtout du temps à la main) |
| 3 | **Baselines : finitions** : sélecteur de référence dans le Gantt, badges « référence locale non validée », relance d'une baseline à valider après N jours, conservation limitée des baselines archivées | Confort et hygiène de l'existant ; la relance d'une baseline à valider pourra reprendre le mécanisme du rappel de jalon (récapitulatif du matin), déjà en place. | Moyenne |
| 4 | **Équipes : finitions** : import de la structure aussi depuis la page Administration ; déplacer une personne d'une équipe à une autre et retirer une équipe (l'import actuel ne le fait jamais) ; liste des équipes dont le nom ne suit pas la règle des 3 ou 4 caractères | Demande de l'usage : à décider une fois la structure importée en vrai (étape 1). | Petite |
| 5 | **Nettoyage** : retrait de la migration des anciens codes de rôle (RWP, MEMBER) et de la démo historique ; règle pour les anciens « membres de projet » à trancher (en faire un Contributor de chaque livrable est déconseillé : 1 350 lignes sur l'ancienne démo) | Sans valeur tant que l'outil n'a pas de vraies données à migrer ; à faire quand on sait s'il y en aura. | Petite à moyenne |

## Règle de tenue

Chaque étape sort comme les précédentes : essais, sabotages de contrôle, documentation, publication sur `main`, avec son numéro de version.
