/**
 * PPM Core — 0.15.4 : le tableau des droits de la page Administration.
 *
 * Le tableau n'est JAMAIS écrit à la main : chaque case est calculée à partir des règles que le moteur applique vraiment (PERMISSION_LEVEL, PERMISSION_DEEP, WBS_RANK, ROLE_RANK).
 * Une case ✓ veut dire : le niveau peut, sur l'objet qu'il couvre (ou, pour un droit « en profondeur », où que son rôle soit posé dans le projet ou le programme).
 * Un test vérifie ce tableau contre can() lui-même, et qu'aucun droit de PERMISSION_LEVEL n'est oublié : ajouter un droit sans le décrire ici fait échouer les essais.
 */

/** Droits de PERMISSION_LEVEL qui n'ont pas de ligne propre, et pourquoi. */
var RIGHTS_NOT_LISTED = {
  'wbs.edit': 'affiché par type d’objet',
  'wbs.delete': 'affiché par type d’objet',
  'roles.assign': 'affiché par rôle posé',
  'changes.ack': 'la validation suit le niveau de l’auteur (voir les règles)',
  'addon.install': 'sans objet'
};

var WBS_KIND_LABELS = { program: 'un programme', project: 'un projet', workpackage: 'un workpackage', subworkpackage: 'un sous-workpackage', planitem: 'un livrable ou un jalon' };
var WBS_EDIT_NOTES = {
  program: '', project: 'y créer des workpackages, des livrables, des jalons', workpackage: 'y créer des sous-workpackages, des livrables, des jalons',
  subworkpackage: 'y créer des livrables, des jalons', planitem: 'dates, nom, responsable, rattachement'
};

/** Les lignes décrites à la main (libellé et groupe) ; la case de chaque niveau est calculée. perm = clé de PERMISSION_LEVEL. */
var RIGHTS_ROWS = [
  { group: 'Lire', all: true, label: 'Lire le WBS, le planning, l’avancement, les risques, les actualités', where: 'tout le monde, y compris sans rôle (Reader)' },
  { group: 'Lire', perm: 'sensitive.read', label: 'Lire les comptes rendus de réunion' },
  { group: 'Lire', perm: 'budget.edit', label: 'Lire et saisir le budget (lignes par livrable)', where: 'sur son périmètre : un Workpackage leader ne voit que son workpackage' },
  { group: 'Lire', perm: 'program.view', label: 'Vues consolidées d’un programme (Actualités, Suivi, Budget)' },
  { group: 'Planning et avancement', perm: 'progress.declare', label: 'Déclarer l’avancement d’un livrable' },
  { group: 'Planning et avancement', perm: 'milestone.pass', label: 'Marquer un jalon passé (ou le rouvrir)', where: 'le responsable du jalon (Deliverable owner) et les niveaux au-dessus' },
  { group: 'Planning et avancement', perm: 'baseline.request', label: 'Demander une baseline' },
  { group: 'Planning et avancement', perm: 'baseline.manage', label: 'Réactiver une baseline du projet, refuser une demande de baseline du projet' },
  { group: 'Planning et avancement', perm: 'import.run', label: 'Exporter et importer son projet par classeur Google Sheet (page WBS)', where: 'chef de projet et au-dessus, projet par projet ; plusieurs projets, programmes et personnes (page Administration) : l’administrateur seul' },
  { group: 'Budget et achats', perm: 'budget.authorize', label: 'Fixer l’enveloppe budgétaire du projet et des workpackages', where: 'celle d’un sous-workpackage : son Workpackage leader et au-dessus' },
  { group: 'Budget et achats', perm: 'exercise.read', label: 'Voir l’exercice budgétaire (attendu, accordé, parts par équipe)', where: 'en entier, au global du projet' },
  { group: 'Budget et achats', perm: 'exercise.edit', label: 'Saisir le budget attendu et accordé par équipe d’un projet (à la main ou par import d’un classeur Google Sheet)' },
  { group: 'Budget et achats', perm: 'cpn.edit', label: 'Définir le CPN du projet et des sous-projets' },
  { group: 'Budget et achats', perm: 'po.edit', label: 'Saisir les commandes d’achat (PO)' },
  { group: 'Budget et achats', perm: 'actuals.manage', label: 'Importer le réalisé comptable (classeur mensuel « CUC Total Cost »)', where: 'l’administrateur seul ; le réalisé se lit avec le budget du projet' },
  { group: 'Personnes', perm: 'resource.edit', label: 'Créer et modifier les personnes et les équipes, importer la structure des équipes (page Ressources)', where: 'chacun peut modifier sa propre fonction et son organisation' },
  { group: 'Projets et programmes', perm: 'program.create', label: 'Créer un programme' },
  { group: 'Projets et programmes', perm: 'project.create', label: 'Créer un projet' },
  { group: 'Risques, constats, actualités', perm: 'risk.create', label: 'Créer un risque ou une opportunité' },
  { group: 'Risques, constats, actualités', perm: 'risk.edit', label: 'Modifier un risque, décider de sa stratégie' },
  { group: 'Risques, constats, actualités', perm: 'insight.decide', label: 'Accepter ou rejeter un constat du moteur de règles' },
  { group: 'Risques, constats, actualités', perm: 'news.add', label: 'Ajouter une actualité ou un compte rendu' },
  { group: 'Risques, constats, actualités', perm: 'news.manage', label: 'Gérer les actualités du projet (réglages, tri, synthèse)' },
  { group: 'Classeur et espace de travail', perm: 'workspace.manage', label: 'Créer l’agenda et le dossier Drive du projet' },
  { group: 'Classeur et espace de travail', perm: 'sheet.roles', label: 'Modifier directement dans le classeur les feuilles Rôles et personnes' },
  { group: 'Classeur et espace de travail', perm: 'sheet.budget', label: 'Modifier directement dans le classeur les feuilles Budget et achats' }
];

var RIGHTS_RULES = [
  'Un niveau a les droits de ceux du dessous. Les rôles se cumulent, chacun là où il est posé.',
  'Chaque objet n’accepte que ses rôles : programme (Program Leader), projet (Domain Program Leader, Chef de projet), workpackage (Workpackage leader), sous-workpackage (Sub-workpackage leader), livrable ou jalon (Deliverable owner, Contributor).',
  'Un rôle se pose par un niveau strictement supérieur au rôle posé, détenu sur l’objet ou au-dessus ; le Program Leader est désigné par l’administrateur.',
  'Un changement part tout de suite et reste à valider (page Suivi) jusqu’à ce qu’un niveau strictement supérieur à celui de son auteur, sur l’objet, le valide ; une seule validation suffit. Un administrateur, un Program Leader et le système n’ont personne au-dessus.',
  'Un dépassement d’enveloppe budgétaire est signalé, jamais bloqué. Une enveloppe vide veut dire « pas de plafond ».',
  'Sans rôle, on est Reader : on lit tout, sauf les tarifs, les comptes rendus et le budget, qui se lisent à partir du Workpackage leader.',
  'L’administrateur du site a tous les droits, sans rôle.',
  'Un ✓ veut dire : sur l’objet que le niveau couvre. Pour les droits marqués « en profondeur », un rôle posé n’importe où dans le projet ou le programme suffit.'
];

/** Les cases d'une ligne : pour chaque rôle posable, vrai si son rang suffit ; Reader jamais, sauf une ligne « tout le monde ». */
function rightsLevels_(maxRank, everyone) {
  var out = {};
  ASSIGNABLE_ROLES.forEach(function (c) { out[c] = ROLE_RANK[c] <= maxRank; });
  out.READER = !!everyone;
  return out;
}

function rightsTable_() {
  var groups = [], byName = {};
  var add = function (g, row) { if (!byName[g]) { byName[g] = { title: g, rows: [] }; groups.push(byName[g]); } byName[g].rows.push(row); };
  RIGHTS_ROWS.forEach(function (r) {
    if (r.all) { add(r.group, { label: r.label, where: r.where || '', levels: rightsLevels_(99, true), deep: false }); return; }
    var min = PERMISSION_LEVEL[r.perm], deep = !!PERMISSION_DEEP[r.perm];
    add(r.group, { perm: r.perm, label: r.label, where: r.where || (deep ? 'en profondeur : un rôle posé n’importe où dans le projet ou le programme suffit' : ''), deep: deep, levels: rightsLevels_(ROLE_RANK[min], false) });
  });
  ['edit', 'delete'].forEach(function (kind) {
    Object.keys(WBS_KIND_LABELS).forEach(function (k) {
      var rank = WBS_RANK[kind][k];
      add(kind === 'edit' ? 'Structure du projet (WBS)' : 'Suppression', {
        perm: 'wbs.' + kind, kind: k, deep: false, levels: rightsLevels_(rank, false),
        label: (kind === 'edit' ? 'Modifier ' : 'Supprimer ') + WBS_KIND_LABELS[k] + (kind === 'edit' && WBS_EDIT_NOTES[k] ? ' — ' + WBS_EDIT_NOTES[k] : ''),
        where: kind === 'delete' && k === 'planitem' ? 'le Deliverable owner supprime son livrable mais n’en crée pas' : ''
      });
    });
  });
  // figer une baseline : il faut pouvoir MODIFIER l'objet visé (même rang que wbs.edit), jamais un livrable ni un jalon
  ['project', 'workpackage', 'subworkpackage'].forEach(function (k) {
    add('Planning et avancement', { perm: 'wbs.edit', kind: k, deep: false, levels: rightsLevels_(WBS_RANK.edit[k], false),
      label: 'Figer une baseline sur ' + WBS_KIND_LABELS[k], where: k === 'project' ? 'jamais sur un livrable ou un jalon ; une baseline de workpackage reste « à valider » par le niveau du dessus' : '' });
  });
  ASSIGNABLE_ROLES.forEach(function (code) {
    var rank = ROLE_RANK[code];
    add('Poser un rôle', { perm: 'roles.assign', role: code, deep: false, levels: rightsLevels_(rank - 1, false),
      label: 'Poser le rôle « ' + ROLE_LABELS[code] + ' » (sur ' + OBJECT_LABELS[ROLE_OBJECT[code]] + ')', where: rank === 0 ? 'seul l’administrateur désigne le Program Leader' : '' });
  });
  var order = ['Lire', 'Structure du projet (WBS)', 'Suppression', 'Poser un rôle', 'Planning et avancement', 'Budget et achats', 'Personnes', 'Projets et programmes', 'Risques, constats, actualités', 'Classeur et espace de travail'];
  groups.sort(function (a, b) { return order.indexOf(a.title) - order.indexOf(b.title); });
  return {
    roles: ASSIGNABLE_ROLES.concat(['READER']).map(function (c) {
      return c === 'READER' ? { code: 'READER', label: 'Reader', rank: 7, object: 'aucun : rôle par défaut, jamais posé' }
        : { code: c, label: ROLE_LABELS[c], rank: ROLE_RANK[c], object: OBJECT_LABELS[ROLE_OBJECT[c]] };
    }),
    groups: groups, rules: RIGHTS_RULES
  };
}

defineAction('admin.rights', function (p, ctx) {
  requireAdmin_(ctx);
  return rightsTable_();
});
