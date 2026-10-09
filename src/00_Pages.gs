/**
 * PPM Core — registre des pages : la source unique de ce qui existe, lue par le serveur (32_Views.gs), par la fabrication
 * (tools/build.js), par les aperçus et par les tests.
 *
 *   view    paramètre ?view=… de l'adresse
 *   file    fichier HTML de src/ (sans l'extension)
 *   title   titre de l'onglet du navigateur
 *   eyebrow petit libellé au-dessus du titre de la page (repris dans Header.html, vérifié par tests/test_pages.js)
 *   tabs    valeurs acceptées pour ?tab=… ; la première est celle par défaut ; [''] : la page n'a pas d'onglets
 *   nav     'bar' : lien de la barre du haut ; 'icon' : icône du coin (Mon compte, Administration)
 *   share   la page reprend le projet courant d'un lien à l'autre (liste SHARE de Header.html)
 *   parts   morceaux de la page, fichiers src/<nom>.html inclus dans l'ordre par la page (grosses pages coupées par sujet)
 *
 * AJOUTER UNE PAGE : une entrée ici, le fichier src/<file>.html (avec les inclusions Style, Common et Header et la balise
 * ppm-version), son lien et son libellé dans Header.html (liens, EYEBROW, et SHARE si elle partage le projet), puis
 * `node tests/run.js` : test_pages.js dit ce qui manque.
 */
var PPM_PAGES = [
  { view: 'overview',   file: 'Overview',   title: 'PPM — Overview projet', eyebrow: 'Overview · Projet',                     tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'gantt',      file: 'Gantt',      title: 'PPM — Planning',        eyebrow: 'Planning · Gantt',                      tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'structure',  file: 'Structure',  title: 'PPM — OBS/WBS',         eyebrow: 'OBS/WBS · Organisation et découpage',   tabs: [''], nav: 'bar',  share: true,
    parts: ['StructureState', 'StructureDraw', 'StructureLoad', 'StructureDetail', 'StructureEdit', 'StructureOrg'] },
  { view: 'ressources', file: 'Ressources', title: 'PPM — Ressources',      eyebrow: 'Ressources · Équipes et rôles',         tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'suivi',      file: 'Suivi',      title: 'PPM — Suivi',           eyebrow: 'Suivi · Baselines',                     tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'actualites', file: 'Actualites', title: 'PPM — Actualités',      eyebrow: 'Actualités · Réunions et actions',      tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'copilote',   file: 'Copilote',   title: 'PPM — Copilote',        eyebrow: 'Copilote · Analyse',                    tabs: ['synthese', 'simulation', 'questions', 'suggestions'], nav: 'bar', share: true, parts: [] },
  { view: 'budget',     file: 'Budget',     title: 'PPM — Budget',          eyebrow: 'Budget · CPN et achats',                tabs: [''], nav: 'bar',  share: true, parts: [] },
  { view: 'compte',     file: 'Compte',     title: 'PPM — Mon compte',      eyebrow: 'Mon compte',                            tabs: [''], nav: 'icon', share: false, parts: [] },
  { view: 'admin',      file: 'Admin',      title: 'PPM — Administration',  eyebrow: 'Administration',                        tabs: [''], nav: 'icon', share: false, parts: [] }
];
