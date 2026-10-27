# Backlog, dans l'ordre où je propose de le faire

*Mis à jour avec la 0.17.2. L'ordre suit trois idées : vérifier avant d'empiler, faire d'abord ce qui sert chaque semaine, ne construire une fonction que quand celle dont elle dépend existe.*

## Fait récemment

- **0.17.2 : jalon passé** : le responsable du jalon (Deliverable owner, ou un niveau au-dessus) déclare explicitement qu'un jalon est passé (ou le rouvre) ; il sort des alertes d'échéance. Voir le README.
- **0.17.1 : exercice budgétaire** (plan : `PLAN_EXERCICE_BUDGETAIRE.md`, phases 0, 1 et 2 ; la phase 3 en partie).

## À faire

| # | Étape | Pourquoi à cette place | Taille |
|---|---|---|---|
| 1 | **Vérifier dans le vrai Apps Script** : installer (`A1_INSTALLER_PPM`), semer la démo, exporter et importer sur une copie (projets et équipes), mesurer la durée d'un lot, vérifier la création et le partage des classeurs dans Drive, les nouvelles feuilles (`EtpCost`, `Exercise`, `TeamBudget`), les droits des vrais comptes | Presque tout a été vérifié sur de faux services. Chaque version ajoute un risque non mesuré : on le mesure avant d'empiler d'autres fonctions. | Moyenne (surtout du temps à la main) |
| 2 | **Exercice : saisie dans un tableur** : import et export Google Sheet du tableau « attendu par équipe » (projets × équipes) et des parts de livrables, avec les garanties des autres imports (analyse avant écriture, copie de sécurité, rien d'écrasé) | La préparation de mi-année se fait dans un tableur, pas équipe par équipe dans une page. Peu de risque, grand gain, et il faut que la saisie soit fluide avant de la figer. | Moyenne |
| 3 | **Exercice : versions figées** : instantané (Attendu, Accordé, Révision), comparaison avec la précédente, validation par le niveau du dessus comme pour les baselines | Suppose une saisie qui marche (étape 2) ; c'est ce qui rend les révisions de février et d'avril lisibles. | Moyenne |
| 4 | **Exercice : constats du moteur de règles** : attendu dépassé par les livrables, accordé inférieur aux parts (clash), équipe sans budget, nom d'équipe hors règle ; **dépassement d'enveloppe de workpackage** (règle de constat prévue de longue date) | Réutilise les écarts de l'étape 3 : le moteur n'a plus qu'à les signaler. | Petite à moyenne |
| 5 | **Exercice : suivi en exécution** : accordé · prévu · engagé (commandes d'achat) · avancement par équipe ; révisions de février et d'avril enregistrées en versions ; passage d'un exercice de « préparation » à « exécution » avec ses livrables | Dépend des versions (étape 3) et des constats (étape 4) ; c'est le dernier maillon du cycle annuel. | Moyenne à grande |
| 6 | **Jalons : finitions** : le bouton « Marquer passé » aussi dans l'espace du responsable (page Compte), jalon passé dessiné plein dans le Gantt, vérifier que les récapitulatifs et mails ne mentionnent plus un jalon passé, rappel du responsable d'un jalon échu non déclaré après N jours | Petites suites de la 0.17.2, utiles chaque semaine, sans dépendance. Peut passer avant l'étape 2 si les alertes de jalons gênent trop. | Petite |
| 7 | **Baselines : finitions** : sélecteur de référence dans le Gantt, badges « référence locale non validée », relance d'une baseline à valider après N jours, conservation limitée des baselines archivées | Confort et hygiène de l'existant ; la relance partage son mécanisme avec le rappel de l'étape 6, d'où cet ordre. | Moyenne |
| 8 | **Équipes : finitions** : import de la structure aussi depuis la page Administration ; déplacer une personne d'une équipe à une autre et retirer une équipe (l'import actuel ne le fait jamais) ; liste des équipes dont le nom ne suit pas la règle des 3 ou 4 caractères | Demande de l'usage : à décider une fois la structure importée en vrai (étape 1). | Petite |
| 9 | **Nettoyage** : retrait de la migration des anciens codes de rôle (RWP, MEMBER) et de la démo historique ; règle pour les anciens « membres de projet » à trancher (en faire un Contributor de chaque livrable est déconseillé : 1 350 lignes sur l'ancienne démo) | Sans valeur tant que l'outil n'a pas de vraies données à migrer ; à faire quand on sait s'il y en aura. | Petite à moyenne |

## Règle de tenue

Chaque étape sort comme les précédentes : essais, sabotages de contrôle, documentation, publication sur `main`, avec son numéro de version.
