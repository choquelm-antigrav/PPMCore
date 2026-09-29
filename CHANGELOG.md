# Journal des versions

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
