# Premiers pas : installer et essayer PPM (version 0.5.1)

Environ 15 minutes. Pas besoin d'AppSheet pour ces essais. Tout ce qu'il faut est dans le dossier `dist` de l'archive : **6 fichiers**.

## 1. Créer le projet

1. Aller sur **script.google.com**, cliquer **Nouveau projet**, le nommer **PPM Core**.
2. Roue dentée (**Paramètres du projet**) : cocher **Afficher le fichier manifeste « appsscript.json »**.

## 2. Copier les 6 fichiers

| Fichier de `dist` | Dans l'éditeur |
| --- | --- |
| `PPM_Core.gs` | Renommer `Code.gs` en `PPM_Core`, remplacer tout son contenu |
| `Gantt.html`, `Structure.html`, `Suivi.html`, `Copilote.html` | Pour chacun : **+** → **HTML**, même nom sans `.html`, coller |
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
| **Structure** | Organigramme (par rôles ou par équipes) et WBS ; bouton **Attributs affichés**. |
| **Suivi** | Onglet **Baselines** → **Figer la baseline B0**. Déplacer ensuite une barre dans le Planning : un trait gris garde l'ancienne place. **Changements à valider** → **Tout valider**. **Agenda et Drive** → **Créer l'agenda et le dossier du projet**. **Mes notifications** → **Me l'envoyer maintenant**. |
| **Copilote** | **Synthèse** chiffrée du projet ; **Simulation** : choisir un livrable, +10 jours, **Simuler** (rien n'est enregistré) ; **Suggestions** : accepter ou ignorer. |

Le bouton en haut à droite de la bannière bascule en thème nuit (par défaut, celui de l'ordinateur) et mémorise votre choix. Pour mesurer la vitesse d'affichage : touche F12, onglet Console, chaque page y indique son temps de préparation.

Le logo Airbus n'est pas fourni : si vous avez son adresse `https://…` (portail de marque interne), ajoutez la propriété du script `PPM_LOGO_URL`.

Le copilote fonctionne sans IA. Pour essayer la préparation de textes à coller dans Gemini : ajouter la propriété du script `PPM_AI_MODE` = `manual` (roue dentée → **Propriétés du script**). L'appel direct à Gemini (`api`) attend l'accord de la DSI (H12).

## Mettre à jour plus tard

1. Remplacer le contenu des 6 fichiers par ceux de la nouvelle archive (toujours les 6 : c'est plus sûr que de chercher ce qui a changé).
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
