/**
 * PPM Core — points d'entrée à lancer à la main depuis l'éditeur Apps Script.
 *
 * Ce fichier passe en TÊTE du fichier fabriqué, et ses noms commencent par « A » puis un numéro : ils arrivent donc les premiers dans la
 * liste des fonctions de l'éditeur, quel que soit son tri (codes de caractères, alphabétique, sans tenir compte de la casse) ; elle en compte plus de cent,
 * presque toutes internes. Ce sont les seules à connaître pour installer.
 *   A1_INSTALLER_PPM          installation et mises à jour (relançable sans risque)
 *   A2_SEED_DEMO              données de démonstration complètes (relançable : elle reprend là où elle s'est arrêtée)
 *   A3_VERIFIER_INSTALLATION  contrôle de l'installation
 *   A4_DIAGNOSTIC_ACCES       quand « Accès réservé » s'affiche
 *   A5_INSTALLER_DECLENCHEURS (re)pose les déclencheurs de la nuit et du récapitulatif de 7 h
 *   A6_EFFACER_ANCIENNE_DEMO  supprime l'ancienne démo (programme DEMO, jusqu'en 0.10.0) ; deux lancements : le premier montre, le second supprime
 *   A7_TESTER_DANS_APPS_SCRIPT  test de contrôle avec les vrais services Google, en lecture seule (rien n'est écrit)
 * Les implémentations sont dans 20_Setup.gs, 21_LiveTest.gs, 40_Jobs.gs et 47_Demo.gs.
 */
function A1_INSTALLER_PPM() { return installerPpm_(); }
function A2_SEED_DEMO() { return seedDemo_(); }
function A3_VERIFIER_INSTALLATION() { return selfCheck(); }
function A4_DIAGNOSTIC_ACCES() { return diagnosticAcces_(); }
function A5_INSTALLER_DECLENCHEURS() { return installTriggers(); }
function A6_EFFACER_ANCIENNE_DEMO() { return effacerAncienneDemo_(); }
function A7_TESTER_DANS_APPS_SCRIPT() { return testerDansAppsScript_(); }
