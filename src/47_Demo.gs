/**
 * PPM Core — 0.11.0 : démo complète (A2_SEED_DEMO).
 *
 * Un programme « NAC » et quatre projets aux situations contrastées :
 *   NAC-1  Nacelle moteur A      projet complexe : 4 workpackages, 15 sous-workpackages, une quarantaine de livrables, 8 jalons,
 *                                un réseau de dépendances, des retards, des dépendances non respectées, trois baselines (B0 archivée,
 *                                B1 active, une demande en attente), du budget, 3 CPN, des commandes d'achat (GR en retard, dépassement), des risques ;
 *   NAC-2  Systèmes embarqués    projet sain : dans les temps, budget et achats maîtrisés ;
 *   NAC-3  Industrialisation     en préparation : presque rien n'est renseigné ;
 *   NAC-4  Essais en vol         clos.
 * Autour : 11 équipes en arbre, 38 personnes plus vous (internes et externes, quatre pays) avec leur taux journalier, des rôles à tous les niveaux
 * (programme, projet, workpackage), trois personnes sans aucun rôle (à positionner dans l'OBS).
 *
 * Aucune personne fictive n'a d'adresse e-mail : rien n'est envoyé, aucune invitation ne part, personne ne peut s'y connecter.
 * Seul le compte qui lance la démo y figure, avec son adresse.
 *
 * Elle représente plusieurs centaines d'écritures : elle est découpée en étapes et s'arrête avant la limite de 6 minutes d'Apps Script.
 * Il suffit de relancer A2_SEED_DEMO jusqu'à « Démo complète » : elle reprend à l'étape suivante (propriété PPM_DEMO_STEP).
 * Les dates se calculent à partir d'aujourd'hui (le projet a commencé il y a douze semaines).
 */

var DEMO_BUDGET_MS = 150000; // une exécution lance de nouvelles étapes tant qu'elle a duré moins que cela

// ---------------------------------------------------------------- données

/** [équipe, équipe parente, centre de coût, responsable] */
var DEMO_TEAMS = [
  ['Direction technique', '', 'CC-100', 'Claire Dubois'],
  ['Conception', 'Direction technique', 'CC-110', 'Marc Lefèvre'],
  ['Structure', 'Conception', 'CC-111', 'Hélène Roux'],
  ['Aérodynamique', 'Conception', 'CC-112', 'Paul Girard'],
  ['Matériaux et procédés', 'Conception', 'CC-113', 'Nadia Benali'],
  ['Essais', 'Direction technique', 'CC-120', 'Thomas Weber'],
  ['Banc d’essais', 'Essais', 'CC-121', 'Lukas Schneider'],
  ['Essais en vol', 'Essais', 'CC-122', 'Inès Girard'],
  ['Systèmes', 'Direction technique', 'CC-130', 'Sophie Martin'],
  ['Industrialisation', 'Direction technique', 'CC-140', 'Karim Haddad'],
  ['PMO', 'Direction technique', 'CC-150', 'Lucie Perrin']
];

/** [nom, statut, équipe, fonction, organisation, pays, taux journalier, fournisseur] */
var DEMO_PEOPLE = [
  ['Claire Dubois', 'Interne', 'Direction technique', 'Directrice technique', 'Maison mère', 'FR', 850],
  ['Marc Lefèvre', 'Interne', 'Conception', 'Responsable conception', 'Bureau d’études', 'FR', 780],
  ['Chloé Bernard', 'Interne', 'Conception', 'Architecte nacelle', 'Bureau d’études', 'FR', 760],
  ['Hélène Roux', 'Interne', 'Structure', 'Ingénieure structure senior', 'Bureau d’études', 'FR', 690],
  ['Camille Durand', 'Interne', 'Structure', 'Ingénieure calcul', 'Bureau d’études', 'FR', 640],
  ['Julien Petit', 'Interne', 'Structure', 'Ingénieur dimensionnement', 'Bureau d’études', 'FR', 630],
  ['Rahul Sharma', 'Interne', 'Structure', 'Analyste calcul', 'Bureau d’études', 'IN', 330],
  ['Paul Girard', 'Interne', 'Aérodynamique', 'Ingénieur aérodynamique', 'Bureau d’études', 'FR', 680],
  ['Émilie Fabre', 'Interne', 'Aérodynamique', 'Ingénieure CFD', 'Bureau d’études', 'FR', 650],
  ['Arjun Mehta', 'Interne', 'Aérodynamique', 'Analyste CFD', 'Bureau d’études', 'IN', 340],
  ['Nadia Benali', 'Interne', 'Matériaux et procédés', 'Ingénieure matériaux', 'Bureau d’études', 'FR', 660],
  ['Antoine Garnier', 'Interne', 'Matériaux et procédés', 'Ingénieur procédés composites', 'Bureau d’études', 'FR', 640],
  ['Thomas Weber', 'Interne', 'Essais', 'Responsable essais', 'Essais', 'DE', 720],
  ['Lukas Schneider', 'Interne', 'Banc d’essais', 'Ingénieur essais', 'Essais', 'DE', 690],
  ['Léa Marchand', 'Interne', 'Banc d’essais', 'Technicienne essais', 'Essais', 'FR', 480],
  ['Hugo Blanc', 'Interne', 'Banc d’essais', 'Technicien instrumentation', 'Essais', 'FR', 470],
  ['Inès Girard', 'Interne', 'Essais en vol', 'Ingénieure essais en vol', 'Essais', 'FR', 700],
  ['Sophie Martin', 'Interne', 'Systèmes', 'Responsable systèmes embarqués', 'Systèmes', 'FR', 740],
  ['Greta Hoffmann', 'Interne', 'Systèmes', 'Ingénieure logiciel embarqué', 'Systèmes', 'DE', 710],
  ['James Walker', 'Interne', 'Systèmes', 'Ingénieur intégration', 'Systèmes', 'UK', 700],
  ['Priya Nair', 'Interne', 'Systèmes', 'Ingénieure validation', 'Systèmes', 'IN', 360],
  ['Karim Haddad', 'Interne', 'Industrialisation', 'Responsable industrialisation', 'Industrialisation', 'FR', 700],
  ['Yann Leroy', 'Interne', 'Industrialisation', 'Ingénieur méthodes', 'Industrialisation', 'FR', 620],
  ['Mathieu Collin', 'Interne', 'Industrialisation', 'Technicien méthodes', 'Industrialisation', 'FR', 520],
  ['Anaïs Moreau', 'Interne', 'PMO', 'Cheffe de projet nacelle A', 'PMO', 'FR', 760],
  ['Lucie Perrin', 'Interne', 'PMO', 'Planificatrice', 'PMO', 'FR', 600],
  ['Sandrine Lopez', 'Interne', 'PMO', 'Contrôleuse de gestion', 'PMO', 'FR', 640],
  ['Olivier Faure', 'Interne', 'Direction technique', 'Responsable qualité et certification', 'Maison mère', 'FR', 720],
  ['Julie Fontaine', 'Interne', 'Structure', 'Ingénieure débutante', 'Bureau d’études', 'FR', 520],
  ['Omar Diallo', 'Interne', 'Banc d’essais', 'Technicien essais', 'Essais', 'FR', 480],
  ['Carl Weber', 'Externe', 'Essais', 'Ingénieur essais', 'Sous-traitant Alpha', 'DE', 780, 'Alpha Test GmbH'],
  ['Hana Iyer', 'Externe', 'Structure', 'Analyste calcul', 'Sous-traitant Alpha', 'IN', 350, 'Alpha Test GmbH'],
  ['Brigitte Stahl', 'Externe', 'Banc d’essais', 'Contrôleuse métrologie', 'Sous-traitant Alpha', 'DE', 650, 'Alpha Test GmbH'],
  ['Dora Schmidt', 'Externe', 'Essais', 'Responsable qualification', 'Sous-traitant Beta', 'DE', 820, 'Beta Aero Consulting'],
  ['Ravi Patel', 'Externe', 'Aérodynamique', 'Spécialiste soufflerie', 'Sous-traitant Beta', 'UK', 860, 'Beta Aero Consulting'],
  ['Marta Kowalski', 'Externe', 'Matériaux et procédés', 'Ingénieure matériaux', 'Sous-traitant Gamma', 'DE', 740, 'Gamma Matériaux'],
  ['Étienne Roche', 'Externe', 'Industrialisation', 'Consultant outillages', 'Sous-traitant Gamma', 'FR', 690, 'Gamma Matériaux'],
  ['Sven Larsen', 'Externe', 'Direction technique', 'Consultant certification', 'Sous-traitant Delta', 'DE', 900, 'Delta Conseil']
];

/** [code, nom, statut, chef de projet, début (jours ouvrés), fin visée (jours ouvrés), CPN, désignation du CPN] */
var DEMO_PROJECTS = [
  ['NAC-1', 'Nacelle moteur A', 'Actif', 'Anaïs Moreau', 0, 165, 'CPN-2401', 'Nacelle A — conception et certification'],
  ['NAC-2', 'Systèmes embarqués', 'Actif', 'Sophie Martin', 10, 150, 'CPN-2501', 'Systèmes embarqués de nacelle'],
  ['NAC-3', 'Industrialisation moteur', 'Préparation', 'Karim Haddad', 62, 230, 'CPN-2601', 'Industrialisation de la nacelle'],
  ['NAC-4', 'Essais en vol', 'Clos', 'Thomas Weber', 0, 55, 'CPN-2301', 'Campagne d’essais en vol']
];

/** [projet, code WBS, nom, responsable, code d'imputation, CPN, désignation du CPN] ; un CPN n'existe que sur un workpackage de premier niveau (sous-projet) */
var DEMO_WPS = [
  ['NAC-1', '1', 'Conception', 'Marc Lefèvre', 'N1-100'],
  ['NAC-1', '1.1', 'Structure primaire', 'Hélène Roux', 'N1-110'],
  ['NAC-1', '1.2', 'Aérodynamique', 'Paul Girard', 'N1-120'],
  ['NAC-1', '1.3', 'Matériaux et procédés', 'Nadia Benali', 'N1-130'],
  ['NAC-1', '1.4', 'Systèmes embarqués intégrés', 'Sophie Martin', 'N1-140'],
  ['NAC-1', '2', 'Essais', 'Thomas Weber', 'N1-200', 'CPN-2402', 'Nacelle A — essais'],
  ['NAC-1', '2.1', 'Essais statiques', 'Thomas Weber', 'N1-210'],
  ['NAC-1', '2.2', 'Essais en soufflerie', 'Ravi Patel', 'N1-220'],
  ['NAC-1', '2.3', 'Qualification', 'Dora Schmidt', 'N1-230'],
  ['NAC-1', '3', 'Industrialisation', 'Karim Haddad', 'N1-300', 'CPN-2403', 'Nacelle A — industrialisation'],
  ['NAC-1', '3.1', 'Outillages', 'Étienne Roche', 'N1-310'],
  ['NAC-1', '3.2', 'Gammes de fabrication', 'Yann Leroy', 'N1-320'],
  ['NAC-1', '3.3', 'Moyens de contrôle', 'Mathieu Collin', 'N1-330'],
  ['NAC-1', '4', 'Pilotage et certification', 'Lucie Perrin', 'N1-400'],
  ['NAC-1', '4.1', 'Dossier de certification', 'Olivier Faure', 'N1-410'],
  ['NAC-1', '4.2', 'Gestion de projet et risques', 'Lucie Perrin', 'N1-420'],
  ['NAC-2', '1', 'Architecture', 'Sophie Martin', 'N2-100'],
  ['NAC-2', '1.1', 'Calculateurs', 'Greta Hoffmann', 'N2-110'],
  ['NAC-2', '1.2', 'Capteurs et actionneurs', 'James Walker', 'N2-120'],
  ['NAC-2', '2', 'Logiciel', 'Greta Hoffmann', 'N2-200'],
  ['NAC-2', '3', 'Intégration et validation', 'Priya Nair', 'N2-300'],
  ['NAC-3', '1', 'Étude d’industrialisation', 'Yann Leroy', 'N3-100'],
  ['NAC-3', '2', 'Moyens de production', 'Mathieu Collin', 'N3-200'],
  ['NAC-4', '1', 'Campagne d’essais en vol', 'Inès Girard', 'N4-100']
];

/**
 * Éléments : [projet, WP, nom, début (jours ouvrés), durée, responsable, avancement %, options]. Un jalon : durée 0 et options.type = 'Jalon'.
 * options : stale (dernière déclaration ancienne), comment (dernier commentaire).
 */
var DEMO_ITEMS = [
  ['NAC-1', '1.1', 'Spécification structure nacelle', 0, 15, 'Chloé Bernard', 100],
  ['NAC-1', '1.1', 'Modèle éléments finis primaire', 15, 25, 'Camille Durand', 100],
  ['NAC-1', '1.1', 'Note de calcul statique primaire', 40, 25, 'Julien Petit', 65],
  ['NAC-1', '1.1', 'Note de calcul de fatigue', 38, 20, 'Julien Petit', 55],
  ['NAC-1', '1.1', 'Plans de définition structure', 55, 30, 'Chloé Bernard', 20],
  ['NAC-1', '1.2', 'Maillage CFD nacelle', 5, 15, 'Émilie Fabre', 100],
  ['NAC-1', '1.2', 'Calcul CFD point de dimensionnement', 20, 25, 'Arjun Mehta', 100],
  ['NAC-1', '1.2', 'Rapport aérodynamique préliminaire', 45, 15, 'Paul Girard', 80],
  ['NAC-1', '1.2', 'Optimisation de la lèvre d’entrée d’air', 60, 25, 'Émilie Fabre', 0],
  ['NAC-1', '1.3', 'Sélection des matériaux composites', 5, 20, 'Nadia Benali', 100],
  ['NAC-1', '1.3', 'Essais d’éprouvettes matériaux', 25, 30, 'Marta Kowalski', 40, { comment: 'Bloqué : en attente de la livraison des éprouvettes par le fournisseur.' }],
  ['NAC-1', '1.3', 'Qualification des procédés de drapage', 55, 30, 'Antoine Garnier', 10],
  ['NAC-1', '1.4', 'Architecture système antigivrage', 10, 20, 'Sophie Martin', 100],
  ['NAC-1', '1.4', 'Logiciel de régulation thermique', 30, 40, 'Greta Hoffmann', 50, { stale: true }],
  ['NAC-1', '1.4', 'Intégration capteurs et câblage', 50, 30, 'James Walker', 15, { comment: 'Pas encore reçu les connecteurs commandés.' }],
  ['NAC-1', '1.4', 'Banc de validation logicielle', 70, 25, 'Priya Nair', 0],
  ['NAC-1', '2.1', 'Plan d’essais statiques', 40, 15, 'Thomas Weber', 100],
  ['NAC-1', '2.1', 'Préparation du banc statique', 55, 25, 'Léa Marchand', 30],
  ['NAC-1', '2.1', 'Campagne d’essais statiques', 80, 30, 'Carl Weber', 0],
  ['NAC-1', '2.1', 'Rapport d’essais statiques', 110, 15, 'Carl Weber', 0],
  ['NAC-1', '2.2', 'Maquette soufflerie', 35, 40, 'Ravi Patel', 45, { comment: 'Fabrication en cours, risque sur la date de livraison à la soufflerie.' }],
  ['NAC-1', '2.2', 'Campagne soufflerie', 75, 20, 'Ravi Patel', 0],
  ['NAC-1', '2.2', 'Rapport soufflerie', 95, 10, 'Ravi Patel', 0],
  ['NAC-1', '2.3', 'Programme de qualification', 60, 20, 'Dora Schmidt', 10],
  ['NAC-1', '2.3', 'Dossier de qualification', 120, 30, 'Dora Schmidt', 0],
  ['NAC-1', '3.1', 'Cahier des charges outillages', 45, 15, 'Étienne Roche', 90, { comment: 'Dernières validations avec le bureau d’études.' }],
  ['NAC-1', '3.1', 'Conception des moules', 60, 35, 'Étienne Roche', 5],
  ['NAC-1', '3.1', 'Réception des moules', 100, 25, 'Étienne Roche', 0],
  ['NAC-1', '3.2', 'Gamme de drapage', 70, 30, 'Yann Leroy', 0],
  ['NAC-1', '3.2', 'Gamme d’assemblage', 100, 30, 'Mathieu Collin', 0],
  ['NAC-1', '3.3', 'Moyens de contrôle non destructif', 85, 30, 'Mathieu Collin', 0],
  ['NAC-1', '4.1', 'Plan de certification', 20, 20, 'Sven Larsen', 100],
  ['NAC-1', '4.1', 'Démonstration de conformité structure', 85, 40, 'Sven Larsen', 0],
  ['NAC-1', '4.1', 'Dossier de certification complet', 130, 30, 'Olivier Faure', 0],
  ['NAC-1', '4.2', 'Plan de management du projet', 0, 10, 'Anaïs Moreau', 100],
  ['NAC-1', '4.2', 'Registre des risques initial', 5, 10, 'Lucie Perrin', 100],
  ['NAC-1', '4.2', 'Planning de référence', 10, 10, 'Lucie Perrin', 100],
  ['NAC-1', '', 'Revue de lancement', 15, 0, 'Anaïs Moreau', 100, { type: 'Jalon', category: 'Revue' }],
  ['NAC-1', '', 'Revue préliminaire de conception (PDR)', 62, 0, 'Anaïs Moreau', 0, { type: 'Jalon', category: 'Revue' }],
  ['NAC-1', '', 'Revue critique de conception (CDR)', 85, 0, 'Anaïs Moreau', 0, { type: 'Jalon', category: 'Revue' }],
  ['NAC-1', '', 'Lancement des outillages', 90, 0, 'Karim Haddad', 0, { type: 'Jalon', category: 'Interne' }],
  ['NAC-1', '', 'Fin des essais statiques', 125, 0, 'Thomas Weber', 0, { type: 'Jalon', category: 'Interne' }],
  ['NAC-1', '', 'Revue de qualification', 150, 0, 'Olivier Faure', 0, { type: 'Jalon', category: 'Client' }],
  ['NAC-1', '', 'Dossier de certification soumis', 162, 0, 'Olivier Faure', 0, { type: 'Jalon', category: 'Client' }],
  ['NAC-1', '', 'Choix des matériaux validé', 50, 0, 'Nadia Benali', 100, { type: 'Jalon', category: 'Interne' }],
  ['NAC-1', '', 'Revue de fin de projet', 164, 0, 'Anaïs Moreau', 0, { type: 'Jalon', category: 'Revue' }],

  ['NAC-2', '1.1', 'Spécification calculateur', 10, 15, 'Greta Hoffmann', 100],
  ['NAC-2', '1.1', 'Choix du calculateur', 25, 10, 'Sophie Martin', 100],
  ['NAC-2', '1.1', 'Prototype calculateur', 35, 25, 'Greta Hoffmann', 100],
  ['NAC-2', '1.2', 'Spécification capteurs', 12, 12, 'James Walker', 100],
  ['NAC-2', '1.2', 'Qualification capteurs', 30, 25, 'James Walker', 100],
  ['NAC-2', '1.2', 'Câblage prototype', 55, 20, 'James Walker', 20],
  ['NAC-2', '2', 'Architecture logicielle', 20, 15, 'Greta Hoffmann', 100],
  ['NAC-2', '2', 'Boucle de régulation', 35, 30, 'Greta Hoffmann', 80],
  ['NAC-2', '2', 'Tests unitaires logiciels', 55, 25, 'Priya Nair', 25],
  ['NAC-2', '3', 'Plan d’intégration', 30, 15, 'Priya Nair', 100],
  ['NAC-2', '3', 'Banc d’intégration', 50, 30, 'Priya Nair', 35],
  ['NAC-2', '3', 'Validation système', 85, 25, 'Priya Nair', 0],
  ['NAC-2', '', 'Revue de conception système', 40, 0, 'Sophie Martin', 100, { type: 'Jalon', category: 'Revue' }],
  ['NAC-2', '', 'Fin d’intégration', 100, 0, 'Priya Nair', 0, { type: 'Jalon', category: 'Interne' }],
  ['NAC-2', '', 'Revue de validation', 115, 0, 'Sophie Martin', 0, { type: 'Jalon', category: 'Client' }],

  ['NAC-3', '1', 'Analyse de fabricabilité', 65, 20, 'Yann Leroy', 0],
  ['NAC-3', '1', 'Étude des cadences', 86, 15, 'Karim Haddad', 0],
  ['NAC-3', '2', 'Spécification des moyens de production', 85, 20, 'Mathieu Collin', 0],
  ['NAC-3', '2', 'Consultation des fournisseurs', 105, 25, 'Mathieu Collin', 0],
  ['NAC-3', '2', 'Étude de sourcing', 0, 0, '', 0, { nodate: true }],
  ['NAC-3', '', 'Revue de faisabilité', 132, 0, 'Karim Haddad', 0, { type: 'Jalon', category: 'Revue' }],

  ['NAC-4', '1', 'Plan d’essais en vol', 0, 10, 'Inès Girard', 100],
  ['NAC-4', '1', 'Campagne d’essais en vol', 10, 30, 'Inès Girard', 100],
  ['NAC-4', '1', 'Rapport d’essais en vol', 40, 10, 'Inès Girard', 100],
  ['NAC-4', '', 'Revue de clôture', 52, 0, 'Thomas Weber', 100, { type: 'Jalon', category: 'Revue' }]
];

/** Dépendances : [projet, prédécesseur, successeur, type, décalage en jours ouvrés] */
var DEMO_DEPS = [
  ['NAC-1', 'Spécification structure nacelle', 'Modèle éléments finis primaire', 'FS', 0],
  ['NAC-1', 'Modèle éléments finis primaire', 'Note de calcul statique primaire', 'FS', 0],
  ['NAC-1', 'Modèle éléments finis primaire', 'Note de calcul de fatigue', 'SS', 5],
  ['NAC-1', 'Note de calcul statique primaire', 'Plans de définition structure', 'FS', -5],
  ['NAC-1', 'Maillage CFD nacelle', 'Calcul CFD point de dimensionnement', 'FS', 0],
  ['NAC-1', 'Calcul CFD point de dimensionnement', 'Rapport aérodynamique préliminaire', 'FS', 0],
  ['NAC-1', 'Rapport aérodynamique préliminaire', 'Optimisation de la lèvre d’entrée d’air', 'FS', 0],
  ['NAC-1', 'Sélection des matériaux composites', 'Essais d’éprouvettes matériaux', 'FS', 0],
  ['NAC-1', 'Essais d’éprouvettes matériaux', 'Qualification des procédés de drapage', 'FS', 0],
  ['NAC-1', 'Architecture système antigivrage', 'Logiciel de régulation thermique', 'FS', 0],
  ['NAC-1', 'Logiciel de régulation thermique', 'Intégration capteurs et câblage', 'SS', 10],
  ['NAC-1', 'Intégration capteurs et câblage', 'Banc de validation logicielle', 'FS', 0],
  ['NAC-1', 'Plan d’essais statiques', 'Préparation du banc statique', 'FS', 0],
  ['NAC-1', 'Préparation du banc statique', 'Campagne d’essais statiques', 'FS', 0],
  ['NAC-1', 'Note de calcul statique primaire', 'Campagne d’essais statiques', 'FS', 0],
  ['NAC-1', 'Campagne d’essais statiques', 'Rapport d’essais statiques', 'FS', 0],
  ['NAC-1', 'Calcul CFD point de dimensionnement', 'Maquette soufflerie', 'SS', 10],
  ['NAC-1', 'Maquette soufflerie', 'Campagne soufflerie', 'FS', 0],
  ['NAC-1', 'Campagne soufflerie', 'Rapport soufflerie', 'FS', 0],
  ['NAC-1', 'Programme de qualification', 'Dossier de qualification', 'FS', 0],
  ['NAC-1', 'Rapport d’essais statiques', 'Dossier de qualification', 'FS', 0],
  ['NAC-1', 'Rapport soufflerie', 'Dossier de qualification', 'FS', 0],
  ['NAC-1', 'Cahier des charges outillages', 'Conception des moules', 'FS', 0],
  ['NAC-1', 'Conception des moules', 'Réception des moules', 'FS', 0],
  ['NAC-1', 'Qualification des procédés de drapage', 'Gamme de drapage', 'FF', 0],
  ['NAC-1', 'Gamme de drapage', 'Gamme d’assemblage', 'FS', 0],
  ['NAC-1', 'Réception des moules', 'Gamme d’assemblage', 'FS', 0],
  ['NAC-1', 'Gamme d’assemblage', 'Moyens de contrôle non destructif', 'SS', 5],
  ['NAC-1', 'Plan de certification', 'Démonstration de conformité structure', 'FS', 0],
  ['NAC-1', 'Note de calcul statique primaire', 'Démonstration de conformité structure', 'FS', 0],
  ['NAC-1', 'Démonstration de conformité structure', 'Dossier de certification complet', 'FS', 0],
  ['NAC-1', 'Plan de management du projet', 'Registre des risques initial', 'SS', 5],
  ['NAC-1', 'Registre des risques initial', 'Planning de référence', 'FS', 0],
  ['NAC-1', 'Plan de management du projet', 'Revue de lancement', 'FS', 0],
  ['NAC-1', 'Revue de lancement', 'Revue préliminaire de conception (PDR)', 'FS', 0],
  ['NAC-1', 'Rapport aérodynamique préliminaire', 'Revue préliminaire de conception (PDR)', 'FS', 0],
  ['NAC-1', 'Revue préliminaire de conception (PDR)', 'Revue critique de conception (CDR)', 'FS', 0],
  ['NAC-1', 'Plans de définition structure', 'Revue critique de conception (CDR)', 'FS', 0],
  ['NAC-1', 'Maquette soufflerie', 'Revue critique de conception (CDR)', 'FS', 0],
  ['NAC-1', 'Cahier des charges outillages', 'Lancement des outillages', 'FS', 0],
  ['NAC-1', 'Rapport d’essais statiques', 'Fin des essais statiques', 'FS', 0],
  ['NAC-1', 'Dossier de qualification', 'Revue de qualification', 'FS', 0],
  ['NAC-1', 'Dossier de certification complet', 'Dossier de certification soumis', 'FS', 0],
  ['NAC-1', 'Dossier de certification soumis', 'Revue de fin de projet', 'FS', 0],
  ['NAC-2', 'Spécification calculateur', 'Choix du calculateur', 'FS', 0],
  ['NAC-2', 'Choix du calculateur', 'Prototype calculateur', 'FS', 0],
  ['NAC-2', 'Spécification capteurs', 'Qualification capteurs', 'FS', 0],
  ['NAC-2', 'Qualification capteurs', 'Câblage prototype', 'FS', 0],
  ['NAC-2', 'Architecture logicielle', 'Boucle de régulation', 'FS', 0],
  ['NAC-2', 'Boucle de régulation', 'Tests unitaires logiciels', 'SS', 15],
  ['NAC-2', 'Plan d’intégration', 'Banc d’intégration', 'FS', 0],
  ['NAC-2', 'Prototype calculateur', 'Banc d’intégration', 'SS', 10],
  ['NAC-2', 'Banc d’intégration', 'Validation système', 'FS', 0],
  ['NAC-2', 'Spécification calculateur', 'Revue de conception système', 'FS', 0],
  ['NAC-2', 'Validation système', 'Revue de validation', 'FS', 0],
  ['NAC-3', 'Analyse de fabricabilité', 'Étude des cadences', 'FS', 0],
  ['NAC-3', 'Spécification des moyens de production', 'Consultation des fournisseurs', 'FS', 0],
  ['NAC-3', 'Consultation des fournisseurs', 'Revue de faisabilité', 'FS', 0],
  ['NAC-4', 'Plan d’essais en vol', 'Campagne d’essais en vol', 'FS', 0],
  ['NAC-4', 'Campagne d’essais en vol', 'Rapport d’essais en vol', 'FS', 0],
  ['NAC-4', 'Rapport d’essais en vol', 'Revue de clôture', 'FS', 0]
];

/** Livrables exigés par un jalon : [projet, jalon, livrables…] */
var DEMO_REQUIREMENTS = [
  ['NAC-1', 'Revue de lancement', 'Plan de management du projet'],
  ['NAC-1', 'Choix des matériaux validé', 'Sélection des matériaux composites', 'Essais d’éprouvettes matériaux'],
  ['NAC-1', 'Revue préliminaire de conception (PDR)', 'Spécification structure nacelle', 'Rapport aérodynamique préliminaire', 'Architecture système antigivrage', 'Sélection des matériaux composites'],
  ['NAC-1', 'Revue critique de conception (CDR)', 'Note de calcul statique primaire', 'Plans de définition structure', 'Logiciel de régulation thermique', 'Qualification des procédés de drapage', 'Maquette soufflerie'],
  ['NAC-1', 'Lancement des outillages', 'Cahier des charges outillages'],
  ['NAC-1', 'Fin des essais statiques', 'Rapport d’essais statiques'],
  ['NAC-1', 'Revue de qualification', 'Dossier de qualification', 'Rapport soufflerie'],
  ['NAC-1', 'Dossier de certification soumis', 'Dossier de certification complet'],
  ['NAC-1', 'Revue de fin de projet', 'Dossier de qualification', 'Dossier de certification complet'],
  ['NAC-2', 'Revue de conception système', 'Spécification calculateur', 'Choix du calculateur'],
  ['NAC-2', 'Revue de validation', 'Validation système']
];

/** Rôles : [personne, rôle, niveau (program / project / wp), repère] ; repère : 'NAC', un code de projet, ou « projet:code WBS » */
var DEMO_ROLES = [
  ['Marc Lefèvre', 'DPL', 'program', 'NAC'], ['Sophie Martin', 'DPL', 'program', 'NAC'],
  ['Anaïs Moreau', 'CP', 'project', 'NAC-1'], ['Sophie Martin', 'CP', 'project', 'NAC-2'], ['Karim Haddad', 'CP', 'project', 'NAC-3'], ['Thomas Weber', 'CP', 'project', 'NAC-4'],
  ['Marc Lefèvre', 'RWP', 'wp', 'NAC-1:1'], ['Hélène Roux', 'RWP', 'wp', 'NAC-1:1.1'], ['Paul Girard', 'RWP', 'wp', 'NAC-1:1.2'], ['Nadia Benali', 'RWP', 'wp', 'NAC-1:1.3'],
  ['Sophie Martin', 'RWP', 'wp', 'NAC-1:1.4'], ['Thomas Weber', 'RWP', 'wp', 'NAC-1:2'], ['Thomas Weber', 'RWP', 'wp', 'NAC-1:2.1'], ['Ravi Patel', 'RWP', 'wp', 'NAC-1:2.2'],
  ['Dora Schmidt', 'RWP', 'wp', 'NAC-1:2.3'], ['Karim Haddad', 'RWP', 'wp', 'NAC-1:3'], ['Étienne Roche', 'RWP', 'wp', 'NAC-1:3.1'], ['Yann Leroy', 'RWP', 'wp', 'NAC-1:3.2'],
  ['Mathieu Collin', 'RWP', 'wp', 'NAC-1:3.3'], ['Lucie Perrin', 'RWP', 'wp', 'NAC-1:4'], ['Olivier Faure', 'RWP', 'wp', 'NAC-1:4.1'], ['Lucie Perrin', 'RWP', 'wp', 'NAC-1:4.2'],
  ['Sophie Martin', 'RWP', 'wp', 'NAC-2:1'], ['Greta Hoffmann', 'RWP', 'wp', 'NAC-2:1.1'], ['James Walker', 'RWP', 'wp', 'NAC-2:1.2'], ['Greta Hoffmann', 'RWP', 'wp', 'NAC-2:2'],
  ['Priya Nair', 'RWP', 'wp', 'NAC-2:3'], ['Yann Leroy', 'RWP', 'wp', 'NAC-3:1'], ['Mathieu Collin', 'RWP', 'wp', 'NAC-3:2'], ['Inès Girard', 'RWP', 'wp', 'NAC-4:1'],
  ['Camille Durand', 'MEMBER', 'wp', 'NAC-1:1.1'], ['Julien Petit', 'MEMBER', 'wp', 'NAC-1:1.1'], ['Rahul Sharma', 'MEMBER', 'wp', 'NAC-1:1.1'],
  ['Émilie Fabre', 'MEMBER', 'wp', 'NAC-1:1.2'], ['Arjun Mehta', 'MEMBER', 'wp', 'NAC-1:1.2'], ['Antoine Garnier', 'MEMBER', 'wp', 'NAC-1:1.3'], ['Marta Kowalski', 'MEMBER', 'wp', 'NAC-1:1.3'],
  ['Greta Hoffmann', 'MEMBER', 'wp', 'NAC-1:1.4'], ['James Walker', 'MEMBER', 'wp', 'NAC-1:1.4'], ['Priya Nair', 'MEMBER', 'wp', 'NAC-1:1.4'],
  ['Léa Marchand', 'MEMBER', 'wp', 'NAC-1:2.1'], ['Hugo Blanc', 'MEMBER', 'wp', 'NAC-1:2.1'], ['Carl Weber', 'MEMBER', 'wp', 'NAC-1:2.1'], ['Hana Iyer', 'MEMBER', 'wp', 'NAC-1:2.1'],
  ['Lukas Schneider', 'MEMBER', 'wp', 'NAC-1:2.1'], ['Sven Larsen', 'MEMBER', 'wp', 'NAC-1:4.1']
];
/** Membres au niveau du projet : [projet, personnes…] */
var DEMO_MEMBERS = [
  ['NAC-1', 'Claire Dubois', 'Chloé Bernard', 'Camille Durand', 'Julien Petit', 'Rahul Sharma', 'Émilie Fabre', 'Arjun Mehta', 'Antoine Garnier', 'Léa Marchand', 'Hugo Blanc', 'Inès Girard',
    'Lukas Schneider', 'Greta Hoffmann', 'James Walker', 'Priya Nair', 'Yann Leroy', 'Mathieu Collin', 'Lucie Perrin', 'Sandrine Lopez', 'Olivier Faure', 'Dora Schmidt',
    'Carl Weber', 'Ravi Patel', 'Hana Iyer', 'Marta Kowalski', 'Étienne Roche', 'Sven Larsen'],
  ['NAC-2', 'Greta Hoffmann', 'James Walker', 'Priya Nair', 'Hana Iyer', 'Lukas Schneider', 'Lucie Perrin'],
  ['NAC-3', 'Yann Leroy', 'Mathieu Collin', 'Étienne Roche', 'Sandrine Lopez']
];

/** Risques : [projet, genre, titre, élément lié, probabilité, impact, responsable, stratégie, statut, jours avant l'échéance de traitement (négatif : dépassée), valeur financière] */
var DEMO_RISKS = [
  ['NAC-1', 'Risque', 'Retard de livraison des éprouvettes composites', 'Essais d’éprouvettes matériaux', 4, 5, 'Nadia Benali', 'Réduire', 'En traitement', -10, 150000],
  ['NAC-1', 'Risque', 'Pénurie de fibre de carbone', 'Qualification des procédés de drapage', 5, 4, 'Nadia Benali', 'Réduire', 'Ouvert', 20, 220000],
  ['NAC-1', 'Risque', 'Indisponibilité de la soufflerie', 'Campagne soufflerie', 3, 5, 'Paul Girard', 'Transférer', 'Ouvert', 20, 120000],
  ['NAC-1', 'Risque', 'Écart de masse de la nacelle', 'Note de calcul statique primaire', 3, 4, 'Hélène Roux', 'Réduire', 'Ouvert', 35, 60000],
  ['NAC-1', 'Risque', 'Dérive du coût des moules', 'Réception des moules', 4, 3, 'Karim Haddad', 'Accepter', 'Ouvert', 45, 40000],
  ['NAC-1', 'Risque', 'Non-conformité à la certification', 'Démonstration de conformité structure', 2, 5, 'Olivier Faure', 'Éviter', 'En traitement', 45, 300000],
  ['NAC-1', 'Risque', 'Départ d’un expert logiciel embarqué', 'Logiciel de régulation thermique', 2, 3, 'Sophie Martin', 'Réduire', 'Ouvert', 60, 0],
  ['NAC-1', 'Opportunité', 'Réutilisation du maillage CFD d’un projet voisin', 'Optimisation de la lèvre d’entrée d’air', 3, 3, 'Paul Girard', 'Exploiter', 'Ouvert', 30, 25000],
  ['NAC-1', 'Risque', 'Choix du fournisseur de câblage', '', 2, 2, 'Sophie Martin', 'Accepter', 'Clos', 0, 0],
  ['NAC-2', 'Risque', 'Obsolescence du calculateur', 'Prototype calculateur', 2, 3, 'Greta Hoffmann', 'Réduire', 'Ouvert', 50, 30000],
  ['NAC-2', 'Opportunité', 'Mutualisation du banc d’intégration', 'Banc d’intégration', 3, 2, 'Priya Nair', 'Partager', 'Ouvert', 40, 15000]
];

/** Budget : [projet, livrable, personne, 'j' (jours × taux de la fiche) ou 'f' (forfait), valeur] */
var DEMO_BUDGET = [
  ['NAC-1', 'Spécification structure nacelle', 'Chloé Bernard', 'j', 20], ['NAC-1', 'Modèle éléments finis primaire', 'Camille Durand', 'j', 30],
  ['NAC-1', 'Modèle éléments finis primaire', 'Rahul Sharma', 'j', 25], ['NAC-1', 'Note de calcul statique primaire', 'Julien Petit', 'j', 40],
  ['NAC-1', 'Note de calcul de fatigue', 'Rahul Sharma', 'j', 22], ['NAC-1', 'Plans de définition structure', 'Chloé Bernard', 'j', 35],
  ['NAC-1', 'Maillage CFD nacelle', 'Émilie Fabre', 'j', 15], ['NAC-1', 'Calcul CFD point de dimensionnement', 'Arjun Mehta', 'j', 35],
  ['NAC-1', 'Rapport aérodynamique préliminaire', 'Paul Girard', 'j', 12], ['NAC-1', 'Optimisation de la lèvre d’entrée d’air', 'Émilie Fabre', 'j', 25],
  ['NAC-1', 'Étude de bruit nacelle', 'Émilie Fabre', 'j', 10], ['NAC-1', 'Sélection des matériaux composites', 'Nadia Benali', 'j', 18],
  ['NAC-1', 'Essais d’éprouvettes matériaux', 'Marta Kowalski', 'j', 25], ['NAC-1', 'Qualification des procédés de drapage', 'Antoine Garnier', 'j', 30],
  ['NAC-1', 'Architecture système antigivrage', 'Sophie Martin', 'j', 15], ['NAC-1', 'Logiciel de régulation thermique', 'Greta Hoffmann', 'j', 45],
  ['NAC-1', 'Intégration capteurs et câblage', 'James Walker', 'j', 25], ['NAC-1', 'Banc de validation logicielle', 'Priya Nair', 'j', 20],
  ['NAC-1', 'Plan d’essais statiques', 'Thomas Weber', 'j', 10], ['NAC-1', 'Préparation du banc statique', 'Léa Marchand', 'j', 20],
  ['NAC-1', 'Préparation du banc statique', 'Hugo Blanc', 'j', 18], ['NAC-1', 'Campagne d’essais statiques', 'Carl Weber', 'f', 60000],
  ['NAC-1', 'Rapport d’essais statiques', 'Carl Weber', 'f', 18000], ['NAC-1', 'Maquette soufflerie', 'Ravi Patel', 'f', 85000],
  ['NAC-1', 'Campagne soufflerie', 'Ravi Patel', 'j', 20], ['NAC-1', 'Rapport soufflerie', 'Ravi Patel', 'j', 8],
  ['NAC-1', 'Programme de qualification', 'Dora Schmidt', 'j', 15], ['NAC-1', 'Dossier de qualification', 'Dora Schmidt', 'f', 30000],
  ['NAC-1', 'Cahier des charges outillages', 'Étienne Roche', 'j', 12], ['NAC-1', 'Conception des moules', 'Étienne Roche', 'j', 30],
  ['NAC-1', 'Réception des moules', 'Étienne Roche', 'f', 120000], ['NAC-1', 'Gamme de drapage', 'Yann Leroy', 'j', 20],
  ['NAC-1', 'Gamme d’assemblage', 'Mathieu Collin', 'j', 22], ['NAC-1', 'Plan de certification', 'Sven Larsen', 'j', 15],
  ['NAC-1', 'Démonstration de conformité structure', 'Sven Larsen', 'f', 45000], ['NAC-1', 'Dossier de certification complet', 'Olivier Faure', 'j', 30],
  ['NAC-1', 'Plan de management du projet', 'Anaïs Moreau', 'j', 8], ['NAC-1', 'Registre des risques initial', 'Lucie Perrin', 'j', 6],
  ['NAC-1', 'Planning de référence', 'Lucie Perrin', 'j', 8],
  ['NAC-2', 'Spécification calculateur', 'Greta Hoffmann', 'j', 12], ['NAC-2', 'Prototype calculateur', 'Greta Hoffmann', 'j', 25],
  ['NAC-2', 'Spécification capteurs', 'James Walker', 'j', 10], ['NAC-2', 'Qualification capteurs', 'James Walker', 'j', 22],
  ['NAC-2', 'Boucle de régulation', 'Greta Hoffmann', 'j', 30], ['NAC-2', 'Tests unitaires logiciels', 'Hana Iyer', 'f', 26000],
  ['NAC-2', 'Banc d’intégration', 'Priya Nair', 'j', 28], ['NAC-2', 'Validation système', 'Priya Nair', 'j', 22]
];

/**
 * Commandes d'achat : [n° de PO, CPN, personne externe, description, montant, statut, jours de lancement, jours de GR attendue, [livrable, montant]…]
 * Jours relatifs à aujourd'hui (négatif : dans le passé) ; lancement, GR et clôture suivent le statut.
 */
var DEMO_ORDERS = [
  ['CB-458812', 'CPN-2402', 'Carl Weber', 'Essais statiques, banc 2', 52000, 'Lancée', -35, -5, ['Campagne d’essais statiques', 52000]],
  ['CB-458990', 'CPN-2402', 'Ravi Patel', 'Maquette soufflerie', 80000, 'Lancée', -50, 6, ['Maquette soufflerie', 80000]],
  ['CB-459107', 'CPN-2402', 'Ravi Patel', 'Pré-essais soufflerie', 17000, 'GR', -60, -10, ['Campagne soufflerie', 17000]],
  ['CB-459302', 'CPN-2402', 'Dora Schmidt', 'Programme de qualification', 12000, 'Terminée', -70, -20, ['Programme de qualification', 12000]],
  ['CB-459455', 'CPN-2402', 'Hana Iyer', 'Analyses complémentaires', 8000, 'Lancée', -15, 25],
  ['CB-459610', 'CPN-2402', 'Carl Weber', 'Rapport d’essais statiques', 18000, 'À faire', -5, 120, ['Rapport d’essais statiques', 18000]],
  ['CB-460118', 'CPN-2403', 'Étienne Roche', 'Conception des moules', 21000, 'Terminée', -45, -12, ['Conception des moules', 21000]],
  ['CB-460245', 'CPN-2403', 'Étienne Roche', 'Réception des moules', 135000, 'Lancée', -20, 40, ['Réception des moules', 135000]],
  ['CB-460391', 'CPN-2401', 'Marta Kowalski', 'Éprouvettes matériaux', 18000, 'Lancée', -55, -12, ['Essais d’éprouvettes matériaux', 18000]],
  ['CB-460502', 'CPN-2401', 'Sven Larsen', 'Démonstration de conformité', 45000, 'Lancée', -25, 120, ['Démonstration de conformité structure', 45000]],
  ['CB-470001', 'CPN-2501', 'Hana Iyer', 'Validation logicielle externalisée', 20000, 'Lancée', -30, 30, ['Tests unitaires logiciels', 20000]],
  ['CB-499001', 'CPN-9999', 'Brigitte Stahl', 'PO d’un autre projet (hors de l’outil)', 5000, 'Lancée', -10, 15]
];

// ---------------------------------------------------------------- outils

function demoContext_() {
  var me = String(Session.getActiveUser().getEmail() || adminEmails()[0] || '').toLowerCase();
  var today = todayStr(), hol = loadHolidayMap('FR');
  var start0 = nextWorkingDay(addCalendarDays(today, -84), hol);
  var d = { me: me, a: { actor: me, source: 'setup' }, today: today, hol: hol, start0: start0 };
  d.wd = function (n) { return addWorkingDays(start0, n, hol); };
  d.day = function (n) { return addCalendarDays(today, n); };
  var latest = function (rows) { return rows[rows.length - 1]; }; // l'ordre des feuilles est l'ordre de création : la dernière est la plus récente
  d.person = function (name) {
    var r = latest(repoList('Resource', function (x) { return x.name === name; }));
    if (!r) throw new PpmError('NOT_FOUND', 'Démo : personne introuvable : ' + name);
    return r;
  };
  d.project = function (code) {
    var p = latest(repoList('Project', function (x) { return x.code === code; }));
    if (!p) throw new PpmError('NOT_FOUND', 'Démo : projet introuvable : ' + code);
    return p;
  };
  d.wp = function (code, wbs) {
    var project = d.project(code);
    var w = latest(repoList('WorkPackage', function (x) { return x.project_id === project.id && x.wbs_code === wbs; }));
    if (!w) throw new PpmError('NOT_FOUND', 'Démo : workpackage introuvable : ' + code + ' ' + wbs);
    return w;
  };
  d.item = function (code, name) {
    var project = d.project(code);
    var i = latest(repoList('PlanItem', function (x) { return x.project_id === project.id && x.name === name; }));
    if (!i) throw new PpmError('NOT_FOUND', 'Démo : élément introuvable : ' + code + ' ' + name);
    return i;
  };
  d.call = function (action, params) {
    var r = handleRequest({ action: action, params: params, apiVersion: PPM_API_VERSION }, me);
    if (!r.ok) throw new PpmError(r.error.code, 'Démo, ' + action + ' : ' + r.error.message);
    return r.data;
  };
  return d;
}

function demoShift_(d, code, name, startDelta, finishDelta) {
  var it = d.item(code, name), patch = {};
  if (startDelta) patch.planned_start = addWorkingDays(it.planned_start, startDelta, d.hol);
  if (finishDelta) patch.planned_finish = addWorkingDays(it.planned_finish, finishDelta, d.hol);
  repoUpdate('PlanItem', it.id, patch, null, d.a);
}

// ---------------------------------------------------------------- étapes

function demoPeople_(d) {
  var teams = {};
  DEMO_TEAMS.forEach(function (t) {
    teams[t[0]] = repoInsert('HierarchicalTeam', { name: t[0], parent_team_id: t[1] ? teams[t[1]].id : '', cost_center: t[2] }, d.a);
  });
  DEMO_PEOPLE.forEach(function (p) {
    repoInsert('Resource', {
      resource_type: p[1], name: p[0], team_id: teams[p[2]].id, job_function: p[3], organization: p[4], country: p[5], daily_rate: p[6],
      supplier: p[7] || '', capacity_days_month: p[1] === 'Interne' ? 18 : 20
    }, d.a);
  });
  DEMO_TEAMS.forEach(function (t) { repoUpdate('HierarchicalTeam', teams[t[0]].id, { manager_resource_id: d.person(t[3]).id }, null, d.a); });
  if (!findResourceByEmail(d.me)) {
    repoInsert('Resource', {
      resource_type: 'Interne', name: d.me.split('@')[0].split(/[._-]+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '), email: d.me, team_id: teams['Direction technique'].id, country: 'FR', capacity_days_month: 18,
      job_function: 'Directeur de programme', organization: 'Maison mère'
    }, d.a);
  }
}

function demoProjects_(d) {
  var me = findResourceByEmail(d.me);
  var prog = repoInsert('Program', { code: 'NAC', name: 'Programme nacelle', status: 'Actif', leader_resource_id: me.id, description: 'Programme de démonstration : nacelle moteur et systèmes associés.' }, d.a);
  DEMO_PROJECTS.forEach(function (p) {
    repoInsert('Project', {
      code: p[0], name: p[1], program_id: prog.id, manager_resource_id: d.person(p[3]).id, status: p[2], holiday_country: 'FR',
      start_date: d.wd(p[4]), end_date: d.wd(p[5]), cpn: p[6], cpn_label: p[7]
    }, d.a);
  });
}

/** Rôles du programme et des projets, puis membres de projet (les rôles de workpackage viennent après le découpage). */
function demoRoles_(d) {
  var me = findResourceByEmail(d.me), prog = repoList('Program', function (x) { return x.code === 'NAC'; })[0];
  var add = function (resourceId, role, type, scopeId) {
    repoInsert('RoleAssignment', { resource_id: resourceId, role_code: role, scope_type: type, scope_id: scopeId, start_date: d.wd(0) }, d.a);
  };
  add(me.id, 'PL', 'program', prog.id);
  DEMO_ROLES.forEach(function (r) {
    if (r[2] === 'program') add(d.person(r[0]).id, r[1], 'program', prog.id);
    else if (r[2] === 'project') add(d.person(r[0]).id, r[1], 'project', d.project(r[3]).id);
  });
  DEMO_MEMBERS.forEach(function (m) {
    for (var i = 1; i < m.length; i++) add(d.person(m[i]).id, 'MEMBER', 'project', d.project(m[0]).id);
  });
  add(me.id, 'CP', 'project', d.project('NAC-1').id);
}

/** Rôles de responsable et de membre sur les workpackages. */
function demoWpRoles_(d) {
  DEMO_ROLES.forEach(function (r) {
    if (r[2] !== 'wp') return;
    var ref = r[3].split(':');
    repoInsert('RoleAssignment', { resource_id: d.person(r[0]).id, role_code: r[1], scope_type: 'workpackage', scope_id: d.wp(ref[0], ref[1]).id, start_date: d.wd(0) }, d.a);
  });
}

/** Workpackages (premier niveau puis sous-niveaux) et éléments d'un ou plusieurs projets. */
function demoPlan_(d, codes) {
  DEMO_WPS.filter(function (w) { return codes.indexOf(w[0]) >= 0; }).forEach(function (w) {
    var parent = w[1].indexOf('.') > 0 ? d.wp(w[0], w[1].slice(0, w[1].lastIndexOf('.'))) : null;
    repoInsert('WorkPackage', {
      project_id: d.project(w[0]).id, parent_wp_id: parent ? parent.id : '', wbs_code: w[1], name: w[2], owner_resource_id: d.person(w[3]).id, charge_code: w[4],
      cpn: w[5] || '', cpn_label: w[6] || ''
    }, d.a);
  });
  DEMO_ITEMS.filter(function (i) { return codes.indexOf(i[0]) >= 0; }).forEach(function (i) {
    var o = i[7] || {}, milestone = o.type === 'Jalon', wp = i[1] ? d.wp(i[0], i[1]) : null;
    var finish = milestone ? d.wd(i[3]) : d.wd(i[3] + i[4] - 1);
    repoInsert('PlanItem', {
      project_id: d.project(i[0]).id, wp_id: wp ? wp.id : '', item_type: milestone ? 'Jalon' : 'Livrable', name: i[2], owner_resource_id: i[5] ? d.person(i[5]).id : '',
      planned_start: o.nodate ? '' : (milestone ? finish : d.wd(i[3])), planned_finish: o.nodate ? '' : finish, progress_pct: 0, status: 'À faire', milestone_category: milestone ? o.category : ''
    }, d.a);
  });
  DEMO_REQUIREMENTS.filter(function (r) { return codes.indexOf(r[0]) >= 0; }).forEach(function (r) {
    var jalon = d.item(r[0], r[1]);
    for (var k = 2; k < r.length; k++) repoInsert('MilestoneRequirement', { milestone_id: jalon.id, deliverable_id: d.item(r[0], r[k]).id }, d.a);
  });
}

function demoDeps_(d) {
  DEMO_DEPS.forEach(function (x) {
    repoInsert('Dependency', { predecessor_id: d.item(x[0], x[1]).id, successor_id: d.item(x[0], x[2]).id, dep_type: x[3], lag_days: x[4] }, d.a);
  });
}

/** B0 figée au lancement ; puis le planning évolue (retards, ajouts, retrait, changement de responsable) ; B1 ; nouvelles dérives ; une demande en attente. */
function demoBaselines_(d) {
  var p1 = d.project('NAC-1').id, p2 = d.project('NAC-2').id;
  d.call('baselines.create', { projectId: p2, label: 'B0', justification: 'Planning validé en revue de conception système' });
  demoShift_(d, 'NAC-2', 'Câblage prototype', 0, 3);
  d.call('baselines.create', { projectId: p1, label: 'B0', justification: 'Planning validé en revue de lancement' });
  // évolutions après B0
  demoShift_(d, 'NAC-1', 'Essais d’éprouvettes matériaux', 0, 18);
  demoShift_(d, 'NAC-1', 'Maquette soufflerie', 0, 15);
  demoShift_(d, 'NAC-1', 'Note de calcul de fatigue', 0, 10);
  demoShift_(d, 'NAC-1', 'Logiciel de régulation thermique', 0, 12);
  repoUpdate('PlanItem', d.item('NAC-1', 'Note de calcul de fatigue').id, { owner_resource_id: d.person('Rahul Sharma').id }, null, d.a);
  [['1.2', 'Étude de bruit nacelle', 62, 15, 'Émilie Fabre'], ['1.4', 'Étude thermique complémentaire', 66, 12, 'Greta Hoffmann'], ['1.3', 'Rapport d’écarts matériaux', 75, 10, 'Nadia Benali']]
    .forEach(function (n) {
      repoInsert('PlanItem', {
        project_id: p1, wp_id: d.wp('NAC-1', n[0]).id, item_type: 'Livrable', name: n[1], owner_resource_id: d.person(n[4]).id,
        planned_start: d.wd(n[2]), planned_finish: d.wd(n[2] + n[3] - 1), progress_pct: 0, status: 'À faire'
      }, d.a);
    });
  d.call('wbs.delete', { kind: 'item', id: d.item('NAC-1', 'Moyens de contrôle non destructif').id });
  d.call('baselines.create', { projectId: p1, label: 'B1', justification: 'Replanification après le retard des éprouvettes matériaux' });
  // dérives après B1
  demoShift_(d, 'NAC-1', 'Campagne d’essais statiques', 0, 6);
  demoShift_(d, 'NAC-1', 'Rapport soufflerie', 7, 7);
  demoShift_(d, 'NAC-1', 'Plans de définition structure', 0, 8);
  demoShift_(d, 'NAC-1', 'Optimisation de la lèvre d’entrée d’air', 0, 5);
  demoShift_(d, 'NAC-1', 'Dossier de certification complet', 0, 7);
  d.call('baselines.request', { projectId: p1, label: 'B2', justification: 'Replanifier la revue critique de conception et la campagne soufflerie après le retard de la maquette' });
}

/** Historique de déclarations d'avancement (trois dates au plus par livrable), avec quelques commentaires et des déclarations anciennes. */
function demoProgress_(d, codes) {
  var n = 0;
  DEMO_ITEMS.filter(function (i) { return codes.indexOf(i[0]) >= 0; }).forEach(function (i) {
    var o = i[7] || {}, pct = i[6];
    if (o.type === 'Jalon') {
      if (pct === 100) {
        var j = d.item(i[0], i[2]);
        repoUpdate('PlanItem', j.id, { progress_pct: 100, status: 'Terminé', actual_finish: j.planned_finish }, null, d.a);
      }
      return;
    }
    if (pct <= 0) return;
    var it = d.item(i[0], i[2]), owner = d.person(i[5]).id;
    var last = o.stale ? -35 : -(2 + (n % 9));
    var lastDate = d.day(last);
    if (pct === 100 && it.planned_finish < lastDate) lastDate = it.planned_finish < d.day(-1) ? it.planned_finish : d.day(-1);
    var steps = pct === 100 ? [30, 70, 100] : [Math.round(pct * 0.35), Math.round(pct * 0.7), pct];
    var dates = [addCalendarDays(lastDate, -36), addCalendarDays(lastDate, -18), lastDate];
    for (var k = 0; k < 3; k++) {
      if (dates[k] < it.planned_start || steps[k] <= 0) continue;
      repoInsert('ProgressUpdate', {
        deliverable_id: it.id, resource_id: owner, declared_at: dates[k] + 'T09:00:00.000Z', progress_pct: steps[k],
        comment: k === 2 ? (o.comment || '') : ''
      }, d.a);
    }
    n++;
  });
}

function demoRisks_(d) {
  DEMO_RISKS.forEach(function (r) {
    repoInsert('RiskOpportunity', {
      project_id: d.project(r[0]).id, kind: r[1], title: r[2], description: r[1] === 'Risque' ? 'Suivi dans le registre du projet.' : 'Piste à exploiter.',
      linked_item_id: r[3] ? d.item(r[0], r[3]).id : '', financial_value: r[10] || '', probability: r[4], impact: r[5],
      owner_resource_id: d.person(r[6]).id, strategy: r[7], status: r[8], review_date: d.day(15), treatment_due: r[8] === 'Clos' ? '' : d.day(r[9])
    }, d.a);
  });
}

function demoBudget_(d, from, to) {
  DEMO_BUDGET.slice(from, to).forEach(function (b) {
    var values = { deliverable_id: d.item(b[0], b[1]).id, resource_id: d.person(b[2]).id };
    if (b[3] === 'f') values.fixed_amount = b[4]; else values.planned_days = b[4];
    d.call('budget.line.save', { values: values });
  });
}

function demoOrders_(d) {
  DEMO_ORDERS.forEach(function (o) {
    var status = o[5], launched = o[6], values = {
      po_number: o[0], cpn: o[1], resource_id: d.person(o[2]).id, description: o[3], amount: o[4], status: status, gr_due_date: d.day(o[7]),
      start_date: d.day(launched), end_date: d.day(o[7])
    };
    if (status !== 'À faire') values.launched_on = d.day(launched);
    if (status === 'GR' || status === 'Terminée') values.gr_on = d.day(o[7] < 0 ? o[7] + 2 : -3);
    if (status === 'Terminée') values.closed_on = d.day(o[7] < 0 ? o[7] + 6 : -1);
    var links = [];
    for (var k = 8; k < o.length; k++) {
      var code = o[1] === 'CPN-2501' ? 'NAC-2' : 'NAC-1';
      links.push({ deliverable_id: d.item(code, o[k][0]).id, amount: o[k][1] });
    }
    d.call('po.save', { values: values, links: links });
  });
}

function demoFindings_(d) {
  runRules();
}

var DEMO_STEPS = [
  { name: 'Équipes et personnes (taux journaliers)', run: function (d) { demoPeople_(d); } },
  { name: 'Programme et projets', run: function (d) { demoProjects_(d); } },
  { name: 'Rôles de l’organigramme', run: function (d) { demoRoles_(d); } },
  { name: 'Découpage et planning du projet NAC-1', run: function (d) { demoPlan_(d, ['NAC-1']); } },
  { name: 'Découpage et planning des autres projets', run: function (d) { demoPlan_(d, ['NAC-2', 'NAC-3', 'NAC-4']); } },
  { name: 'Rôles sur les workpackages', run: function (d) { demoWpRoles_(d); } },
  { name: 'Dépendances', run: function (d) { demoDeps_(d); } },
  { name: 'Baselines et évolutions du planning', run: function (d) { demoBaselines_(d); } },
  { name: 'Avancement de NAC-1', run: function (d) { demoProgress_(d, ['NAC-1']); } },
  { name: 'Avancement des autres projets', run: function (d) { demoProgress_(d, ['NAC-2', 'NAC-4']); } },
  { name: 'Risques et opportunités', run: function (d) { demoRisks_(d); } },
  { name: 'Budget de NAC-1 (1/2)', run: function (d) { demoBudget_(d, 0, 20); } },
  { name: 'Budget de NAC-1 (2/2) et de NAC-2', run: function (d) { demoBudget_(d, 20, 60); } },
  { name: 'Commandes d’achat', run: function (d) { demoOrders_(d); } },
  { name: 'Constats du moteur de règles', run: function (d) { demoFindings_(d); } }
];

/**
 * Crée la démo, étape par étape ; relançable jusqu'à « Démo complète ». Le compte qui la lance doit être administrateur.
 * Une démo déjà complète n'est jamais recréée (pas de doublons).
 */
function seedDemo_() {
  var t0 = Date.now(), next = Number(getProp(PROP.DEMO_STEP, '0')) || 0;
  if (next === 0 && repoList('Program', function (p) { return p.code === 'NAC'; }).length) {
    var done = 'La démo existe déjà (programme NAC) : rien n’a été recréé.';
    console.log(done);
    return done;
  }
  var d = demoContext_(), ran = [];
  for (var i = next; i < DEMO_STEPS.length; i++) {
    if (i > next && Date.now() - t0 > DEMO_BUDGET_MS) break;
    try {
      DEMO_STEPS[i].run(d);
    } catch (err) {
      throw new PpmError(err && err.code ? err.code : 'INTERNAL', 'Démo, étape ' + (i + 1) + '/' + DEMO_STEPS.length + ' « ' + DEMO_STEPS[i].name + ' » : ' +
        (err && err.message ? err.message : err) + '. Les étapes précédentes sont conservées ; corrigez la cause puis relancez.');
    }
    ran.push(DEMO_STEPS[i].name);
    setProp(PROP.DEMO_STEP, String(i + 1));
  }
  var at = Number(getProp(PROP.DEMO_STEP, '0')) || 0, msg;
  if (at >= DEMO_STEPS.length) {
    deleteProp(PROP.DEMO_STEP);
    msg = 'Démo complète : programme NAC, 4 projets, ' + DEMO_PEOPLE.length + ' personnes, ' + DEMO_TEAMS.length + ' équipes. Ouvrez la page Overview.';
  } else {
    msg = 'Démo en cours : étape ' + at + ' sur ' + DEMO_STEPS.length + ' terminée (' + ran.join(' ; ') + '). Relancez A2_SEED_DEMO pour continuer.';
  }
  console.log(msg);
  return msg;
}
