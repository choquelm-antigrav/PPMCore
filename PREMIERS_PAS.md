# Premiers pas : installer et essayer PPM (version 0.10.0)

Environ 15 minutes. Pas besoin d'AppSheet pour ces essais. Tout ce qu'il faut est dans le dossier `dist` de l'archive : **11 fichiers**.

## 1. Créer le projet

1. Aller sur **script.google.com**, cliquer **Nouveau projet**, le nommer **PPM Core**.
2. Roue dentée (**Paramètres du projet**) : cocher **Afficher le fichier manifeste « appsscript.json »**.

## 2. Copier les 11 fichiers

| Fichier de `dist` | Dans l'éditeur |
| --- | --- |
| `PPM_Core.gs` | Renommer `Code.gs` en `PPM_Core`, remplacer tout son contenu |
| `Gantt.html`, `Structure.html`, `Suivi.html`, `Copilote.html`, `Compte.html`, `Admin.html`, `Budget.html`, `Overview.html`, `Ressources.html` | Pour chacun : **+** → **HTML**, même nom sans `.html`, coller |
| `appsscript.json` | Ouvrir le fichier existant, remplacer tout son contenu |

## 3. Installer

En haut de l'éditeur, choisir **installerPpm** dans la liste des fonctions, puis **Exécuter**. Accepter les autorisations (si Google avertit que l'application n'est pas validée : **Paramètres avancés** → **Accéder à PPM Core**).

Le journal d'exécution doit finir par « Installation conforme ». Le domaine et l'administrateur sont déduits de votre compte.

Pour avoir des données d'essai : exécuter aussi **seedDemo** (un projet pilote dont vous êtes le chef de projet).

## 4. Publier

**Déployer** → **Nouveau déploiement** → type **Application Web** → Exécuter en tant que : **moi** ; Accès : **tous les utilisateurs du domaine** → **Déployer**. Copier l'URL qui finit par `/exec`.

## 5. Essayer

Ouvrir l'URL suivie de `?view=gantt`. Les onglets en haut de chaque page mènent aux autres :

| Page | Ce qu'on essaie |
| --- | --- |
| **Planning** | Chemin critique ; glisser une barre pour la déplacer ; cliquer une barre pour déclarer un avancement. |
| **Structure** | Organigramme (par rôles ou par équipes) et WBS ; bouton **Attributs affichés**. Onglet **Découpage (WBS)** : **Ajouter un workpackage**, puis cliquer une carte pour **Ajouter** un livrable ou un jalon, **Modifier** (nom, responsable, dates, rattachement) ou **Supprimer** ; sur un livrable, la section **Dépendances**. En **Organisation** : « Attribuer un rôle », « Ajouter une personne », « Ajouter une équipe », et les boutons de chaque carte. |
| **Suivi** | Onglet **Baselines** → **Figer la baseline B0**. Déplacer ensuite une barre dans le Planning : un trait gris garde l'ancienne place. **Changements à valider** → **Tout valider**. **Agenda et Drive** → **Créer l'agenda et le dossier du projet**.  |
| **Mon compte** (icône de personne, en haut à droite) | **Notifications** → **Me l'envoyer maintenant** : le mail récapitulatif arrive dans votre boîte. Même onglet : le **rappel avant livraison** (votre délai en jours ouvrés, 10 par défaut). **Affichage** : choisir le thème et la page d'accueil. |
| **Administration** (icône d'engrenage, administrateurs seulement) | **Santé** : l'installation doit être « Conforme ». **Réglages** : ajouter un second administrateur. **Jours fériés** : ajouter une année. |
| **Overview** (page d'accueil) | Créer un projet (« Nouveau projet »), le renommer, lire les indicateurs délais, qualité, coût. |
| **Ressources** | Ajouter les personnes (avec leur adresse professionnelle : c'est elle qui donne accès), créer les équipes, choisir le rôle de chacun dans le projet, saisir son taux journalier. La colonne **Accès** dit qui peut se connecter. |
| **Budget** (onglet de la bannière) | Définir le **CPN** du projet. **Taux** : ajouter un taux, donner un profil aux personnes. **Budget** : ajouter une ligne (interne : jours ; externe : forfait). **Achats (PO)** : ajouter une PO (numéro Click and Buy, CPN, ressource externe, montant, date de GR attendue, répartition par livrable), la passer en Lancée puis GR. **Bilan par CPN** : engagé et reste. |
| **Copilote** | **Synthèse** chiffrée du projet ; **Simulation** : choisir un livrable, +10 jours, **Simuler** (rien n'est enregistré) ; **Suggestions** : accepter ou ignorer. |

Le bouton en haut à droite de la bannière bascule en thème nuit (par défaut, celui de l'ordinateur) et mémorise votre choix. Pour mesurer la vitesse d'affichage : touche F12, onglet Console, chaque page y indique son temps de préparation.

Le logo Airbus n'est pas fourni : si vous avez son adresse `https://…` (portail de marque interne), ajoutez son adresse dans Administration → Réglages (ou la propriété du script `PPM_LOGO_URL`).

Le copilote fonctionne sans IA. Pour essayer la préparation de textes à coller dans Gemini : ajouter la propriété du script `PPM_AI_MODE` = `manual` (roue dentée → **Propriétés du script**). L'appel direct à Gemini (`api`) attend l'accord de la DSI (H12).

## Mettre à jour plus tard

1. Remplacer le contenu des 11 fichiers par ceux de la nouvelle archive (toujours les 11 : c'est plus sûr que de chercher ce qui a changé).
2. Exécuter **installerPpm** (il ajoute les nouvelles colonnes et vérifie que chaque page est à la bonne version).
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

En cas de doute, exécutez `diagnosticAcces` dans l'éditeur (Exécuter, puis Journal d'exécution) : il montre le compte qui exécute, le compte détecté et les domaines autorisés.

