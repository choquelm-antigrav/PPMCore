# Journal des versions

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
