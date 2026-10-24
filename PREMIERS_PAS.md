# Premiers pas : installer et essayer PPM (version 0.15.3)

Environ 15 minutes. Pas besoin d'AppSheet pour ces essais. Tout ce qu'il faut est dans le dossier `dist` de l'archive : **12 fichiers**.

## 1. Créer le projet

1. Aller sur **script.google.com**, cliquer **Nouveau projet**, le nommer **PPM Core**.
2. Roue dentée (**Paramètres du projet**) : cocher **Afficher le fichier manifeste « appsscript.json »**.

## 2. Copier les 12 fichiers

| Fichier de `dist` | Dans l'éditeur |
| --- | --- |
| `PPM_Core.gs` | Renommer `Code.gs` en `PPM_Core`, remplacer tout son contenu |
| `Gantt.html`, `Structure.html`, `Suivi.html`, `Copilote.html`, `Compte.html`, `Admin.html`, `Budget.html`, `Overview.html`, `Ressources.html`, `Actualites.html` | Pour chacun : **+** → **HTML**, même nom sans `.html`, coller |
| `appsscript.json` | Ouvrir le fichier existant, remplacer tout son contenu |

## 3. Installer

En haut de l'éditeur, choisir **A1_INSTALLER_PPM** (la première de la liste des fonctions), puis **Exécuter**. Accepter les autorisations (si Google avertit que l'application n'est pas validée : **Paramètres avancés** → **Accéder à PPM Core**).

Le journal d'exécution doit finir par « Installation conforme ». Le domaine et l'administrateur sont déduits de votre compte.

Pour avoir des données d'essai : exécuter aussi **A2_SEED_DEMO** (la deuxième de la liste) : un programme et un projet complexe, NAC-1 (planning en retard, baselines, budget, commandes d'achat, risques, réunions) et 38 personnes avec leurs taux. Cela prend plusieurs minutes : **relancez-la jusqu'à voir « Démo complète »** ; elle reprend là où elle s'est arrêtée. Si le journal répond « La démo existe déjà (programme NAC) », une démo est déjà dans le classeur : rien n'est recréé ni remplacé. **Si vous aviez essayé une version antérieure à la 0.11.0**, son ancienne démo (programme DEMO, projet PILOTE) est encore là : exécutez d'abord **A6_EFFACER_DEMO** (la sixième de la liste) ; le premier lancement dit seulement ce qui serait supprimé, relancez-la dans les 10 minutes pour confirmer, puis lancez A2_SEED_DEMO. Personne d'autre que vous n'a d'adresse : rien n'est envoyé.

## 4. Publier

**Déployer** → **Nouveau déploiement** → type **Application Web** → Exécuter en tant que : **moi** ; Accès : **tous les utilisateurs du domaine** → **Déployer**. Copier l'URL qui finit par `/exec`.

## 5. Essayer

Ouvrir l'URL suivie de `?view=gantt`. Les liens en haut de chaque page mènent aux autres (il n'y a plus d'onglets : chaque page affiche toutes ses rubriques d'un coup) :

| Page | Ce qu'on essaie |
| --- | --- |
| **Planning** | S'ouvre sur **aujourd'hui** (bouton « Aujourd'hui » pour y revenir) ; **survoler** une barre pour un résumé (dates, responsable, avancement, marge) ; chemin critique ; glisser une barre pour la déplacer (**enregistré tout de suite**, bouton « Annuler » 9 secondes) ; **liste de gauche** avec recherche, filtres et workpackages repliables ; cliquer une barre pour déclarer un avancement ; **créer une dépendance** : cliquer un livrable, section « Dépendances » du panneau, **« + Doit attendre… »** ou **« + Bloque… »**, puis choisir l'autre élément dans la liste **ou cliquer sa barre**, **Créer le lien** (« Retirer », en deux clics, pour supprimer). |
| **WBS** | Le découpage du projet ; bouton **Attributs affichés**. **Ajouter un workpackage**, puis cliquer une carte pour **Ajouter** un livrable ou un jalon, **Modifier** (nom, dates, rattachement) ou **Supprimer** ; sur un livrable, la section **Dépendances**. La section **Rôles** de chaque carte : qui est responsable de ce workpackage, livrable ou jalon, et **Poser le rôle** (une personne se crée dans **Ressources** ; sans rôle, elle est **Reader** : elle lit tout, ne modifie rien). Les équipes se gèrent dans **Ressources**. |
| **Suivi** | Zone **Baselines** → **Figer la baseline B0**. Déplacer ensuite une barre dans le Planning : un trait gris garde l'ancienne place. **Changements à valider** → **Tout valider**. **Agenda et Drive** → **Créer l'agenda et le dossier du projet**.  |
| **Mon compte** (icône de personne, en haut à droite) | **Notifications** → **Me l'envoyer maintenant** : le mail récapitulatif arrive dans votre boîte. Même page : le **rappel avant livraison** (votre délai en jours ouvrés, 10 par défaut). **Affichage** : choisir le thème et la page d'accueil. |
| **Administration** (icône d'engrenage, administrateurs seulement) | **Santé** : l'installation doit être « Conforme ». **Réglages** : ajouter un second administrateur. **Jours fériés** : ajouter une année. |
| **Actualités** | **Ajouter un compte rendu** : coller des notes Gemini ou des minutes (`Action : faire X — Nom — 30/10`) → les actions sont proposées à chacun. **Copier le prompt du jour** puis **Publier les actualités** : coller la réponse de NotebookLM ou de Gemini. **Repères et journal** : cocher « Activer la collecte automatique », saisir des repères (sigle du projet), **Mettre à jour le journal maintenant**. Mon compte → **Mes actions** : accepter, contester ou terminer. |
| **Overview** (page d'accueil) | Créer un projet (« Nouveau projet »), le renommer, lire les indicateurs délais, qualité, coût. |
| **Ressources** | Ajouter les personnes (avec leur adresse professionnelle : c'est elle qui donne accès), créer les équipes, choisir le rôle de chacun dans le projet, saisir son taux journalier. La colonne **Accès** dit qui peut se connecter. |
| **Budget** | Définir le **CPN** du projet. Les taux se saisissent dans **Ressources**. **Budget par livrable** : ajouter une ligne (interne : jours ; externe : forfait). **Achats (PO)** : ajouter une PO (numéro Click and Buy, CPN, ressource externe, montant, date de GR attendue, répartition par livrable), la passer en Lancée puis GR. **Bilan par CPN** : engagé et reste. |
| **Copilote** (en suspens : masqué tant que `PPM_COPILOT` n'est pas `oui`) | **Synthèse** chiffrée du projet ; **Suggestions** : accepter ou ignorer ; **Simulation** : « Commencer une simulation », choisir un livrable, +10 jours, **Simuler** (rien n'est enregistré) ; **Questions** et rédaction par l'IA selon le mode ; **Connexion à Gemini** (la clé). Toutes ces zones sont sur la même page. |

Le bouton en haut à droite de la bannière bascule en thème nuit (par défaut, celui de l'ordinateur) et mémorise votre choix. Pour mesurer la vitesse d'affichage : touche F12, onglet Console, chaque page y indique son temps de préparation.

Le logo Airbus n'est pas fourni : si vous avez son adresse `https://…` (portail de marque interne), ajoutez son adresse dans Administration → Réglages (ou la propriété du script `PPM_LOGO_URL`).

Le copilote est **suspendu par défaut**. Pour l'activer : **Administration → Réglages → Copilote → « Activer le Copilote »**, puis Enregistrer et recharger la page. Avant cela, validez avec votre DSI l'usage de clés Gemini personnelles (voir README, « Copilote : la clé Gemini de chaque personne »). Choisissez ensuite le mode, dans **Administration → Réglages → Copilote IA** : **Désactivé** (la synthèse chiffrée, les suggestions et la simulation marchent déjà), **Texte à coller dans Gemini** (**pour commencer** : aucune clé ; l'outil prépare un texte que l'on copie et colle soi-même dans Gemini) ou **Gemini : clé personnelle de chaque compte** (accord de la DSI requis ; **l'administrateur ne saisit aucune clé**, chacun enregistre la sienne). Dans ce dernier mode, une personne qui n'a pas encore sa clé n'est pas bloquée : ses demandes préparent le texte à coller. Pour obtenir les réponses directement, elle ouvre la zone **Connexion à Gemini** de la page **Copilote** (le bouton « Connecter ma clé » l'y amène) et suit les trois gestes : bouton bleu (ouvre la page de Google), « Créer une clé API » puis « Copier », retour sur la page, « Coller » puis « Enregistrer et tester ». Après la mise à jour 0.13.0, exécutez `A1_INSTALLER_PPM` et acceptez la nouvelle autorisation (appels vers Google).

## Mettre à jour plus tard

**À lire d'abord : [`MISE_A_JOUR.md`](MISE_A_JOUR.md)** (sauvegarde avant de commencer, ce que fait `A1` sur des données existantes, les pièges qui font perdre des données, le retour en arrière, et qui fait quoi entre le propriétaire du script, l'administrateur de l'outil et les utilisateurs). En bref :

1. Remplacer le contenu des 12 fichiers par ceux de la nouvelle archive (toujours les 12 : c'est plus sûr que de chercher ce qui a changé).
2. Exécuter **A1_INSTALLER_PPM** (il ajoute les nouvelles colonnes et vérifie que chaque page est à la bonne version).
3. **Déployer** → **Gérer les déploiements** → crayon → Version : **Nouvelle version** → **Déployer**. L'URL ne change pas.

## Encore plus simple : clasp (si votre poste le permet)

`clasp` est l'outil de Google qui envoie tous les fichiers d'un coup, sans copier-coller. Il demande Node.js sur le poste et l'option **Google Apps Script API** activée sur script.google.com/home/usersettings (votre DSI peut l'avoir bloquée). Depuis le dossier de l'archive :

```bash
npm install -g @google/clasp
clasp login
node tools/build.js
cd dist
clasp create --type standalone --title "PPM Core"
cd .. && node tools/build.js && cd dist     # remet le manifeste de PPM, que clasp remplace à la création
clasp push -f
```

Puis étapes 3 et 4 ci-dessus dans l'éditeur. Mise à jour suivante : `node tools/build.js && cd dist && clasp push -f`, puis nouvelle version du déploiement.

## Dépannage : « Accès réservé »

Le message dit pourquoi et quoi faire. Les causes habituelles :

- **Compte détecté d'un autre domaine** (par exemple un compte personnel) : plusieurs comptes Google sont connectés et l'adresse s'ouvre avec le mauvais. Ouvrez l'application dans une fenêtre de navigation privée, avec votre compte professionnel.
- **Domaine mal réglé** : l'installation fixe le domaine d'après le compte qui l'a lancée. Dans l'éditeur Apps Script, ⚙ Paramètres du projet → Propriétés du script → `PPM_DOMAIN` doit contenir le domaine des utilisateurs (ce qui suit le `@`) ; plusieurs domaines se séparent par une virgule. Un administrateur peut aussi les régler dans **Administration → Réglages**.
- **Compte non identifié** : le propriétaire du déploiement et l'utilisateur doivent être dans le même domaine Google Workspace.

En cas de doute, exécutez `A4_DIAGNOSTIC_ACCES` dans l'éditeur (Exécuter, puis Journal d'exécution) : il montre le compte qui exécute, le compte détecté et les domaines autorisés.

## Fil d'actualités : à savoir avant de l'essayer sur de vrais comptes

- **Réautoriser l'outil** : la version 0.12.0 demande en plus l'accès aux Google Docs. Après avoir copié les fichiers, exécuter `A1_INSTALLER_PPM` et accepter la nouvelle autorisation.
- **Collecte automatique** : exécuter `A5_INSTALLER_DECLENCHEURS` pour poser les deux déclencheurs (1 h et 13 h). Elle lit **l'agenda du compte qui les a posés**, pas celui des autres membres.
- **Sans collecte, rien n'est perdu** : la saisie manuelle d'un compte rendu et la synthèse du matin fonctionnent seules.

## Le classeur de données, ouvert aux personnes invitées (0.14.2)

Toute personne invitée dans la page **Ressources** (fiche avec une adresse de votre domaine) peut ouvrir et **modifier** le classeur Google Sheets qui contient les données : son lien est la première carte de **Mon compte** (les administrateurs le voient aussi dans Administration → Réglages, où se trouvent l'interrupteur et le bouton « Partager maintenant »). **Attention : modifier le classeur directement contourne les règles de l'outil** (droits, historique, contrôle de version) ; ne touchez pas aux colonnes id et version, ni aux dates de création, et supprimez les lignes depuis l'outil. Google envoie un courriel de partage à chaque personne.

## Pages plus réactives : le déclencheur facultatif `warmCache` (0.14.2)

Après la mise à jour, exécutez **`A5_INSTALLER_DECLENCHEURS`** pour poser un déclencheur qui garde les données prêtes en mémoire toutes les 5 minutes, en semaine de 6 h à 21 h : la première page après une pause s'ouvre alors aussi vite que les suivantes. Il consomme de l'ordre d'un quart d'heure par jour de votre quota de déclencheurs. Sans lui, tout fonctionne, simplement avec une première page plus lente après 6 minutes d'inactivité. `A7` mesure le temps d'ouverture de chaque page : lancez-le avant et après.

## Si la démo est vide ou s'arrête (0.13.2)

La démo se crée en plusieurs lancements. **Relancez `A2_SEED_DEMO` tant que le message ne commence pas par « Démo complète »** : un message « Démo en cours… » signifie qu'elle est INCOMPLÈTE. À la fin, le message donne les chiffres relus dans la base (projets, workpackages, livrables et jalons…). Si la démo est cassée ou à moitié faite : `A6_EFFACER_DEMO` **deux fois** (le premier lancement montre, le second supprime), puis `A2_SEED_DEMO`. Après chaque mise à jour, exécutez aussi **`A8_VERIFIER_ECRITURE`** (il écrit dans une feuille temporaire qu'il supprime) : il vérifie que les textes comme les codes de workpackage « 1.1 » ou « 2.10 » restent intacts dans votre Google Sheets.

## Vérifier dans votre Apps Script : A7

Après avoir copié les fichiers et exécuté `A1_INSTALLER_PPM`, exécutez **`A7_TESTER_DANS_APPS_SCRIPT`** (Exécuter, puis Journal d'exécution). C'est un test **en lecture seule** : il n'écrit rien et n'envoie aucun mail. Il vérifie avec les vrais services Google : le moteur, le fuseau horaire et les changements d'heure, l'installation, les déclencheurs, l'accès à l'agenda, et chaque appel de page avec votre compte, chronométré.

- **✓ OK** : rien à faire. **⚠ ATTENTION** : à lire, sans blocage (par exemple « déclencheurs à poser : exécuter A5 »). **✗ ÉCHEC** : à corriger ; le message dit quoi.
- Une ligne « accès refusé à ce compte » est normale si vous n'avez pas le rôle voulu.
- Pour demander de l'aide, copiez-collez tout le journal : chaque ligne porte le nom du contrôle, le résultat et la durée.
