# Journal des versions

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
