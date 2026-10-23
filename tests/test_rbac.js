const { loadCore, test, eq, ok } = require('./harness');

module.exports = function () {
  const c = loadCore();
  console.log('\nDroits (RBAC) : huit niveaux, règles 2 et 3, attribution des rôles');

  // Programme PG1 ⊃ projets P1 et P2 ; P3 est hors programme. P1 ⊃ W1 (⊃ sous-WP W1a), W2. P2 ⊃ W3.
  const programs = { PG1: { id: 'PG1' } };
  const projects = { P1: { id: 'P1', program_id: 'PG1' }, P2: { id: 'P2', program_id: 'PG1' }, P3: { id: 'P3', program_id: '' } };
  const wps = {
    W1: { id: 'W1', project_id: 'P1', parent_wp_id: '' }, W1a: { id: 'W1a', project_id: 'P1', parent_wp_id: 'W1' },
    W2: { id: 'W2', project_id: 'P1', parent_wp_id: '' }, W3: { id: 'W3', project_id: 'P2', parent_wp_id: '' }
  };
  const items = {
    I1: { id: 'I1', project_id: 'P1', wp_id: 'W1a' }, I1b: { id: 'I1b', project_id: 'P1', wp_id: 'W1a' },
    I4: { id: 'I4', project_id: 'P1', wp_id: 'W1' }, I2: { id: 'I2', project_id: 'P1', wp_id: 'W2' },
    I5: { id: 'I5', project_id: 'P1', wp_id: '' }, I3: { id: 'I3', project_id: 'P2', wp_id: 'W3' }, I6: { id: 'I6', project_id: 'P3', wp_id: '' }
  };
  const risks = { R1: { id: 'R1', project_id: 'P1' } };
  const lookup = { project: (id) => projects[id], workpackage: (id) => wps[id], planitem: (id) => items[id], risk: (id) => risks[id] };
  const A = (resource_id, role_code, scope_type, scope_id, extra) => Object.assign({ resource_id, role_code, scope_type, scope_id }, extra || {});
  const assignments = [
    A('pl', 'PL', 'program', 'PG1'),
    A('dpl', 'DPL', 'project', 'P1'), A('dpl', 'DPL', 'project', 'P2'),
    A('cp', 'CP', 'project', 'P1'),
    A('wpl', 'WPL', 'workpackage', 'W1'),
    A('swpl', 'SWPL', 'workpackage', 'W1a'),
    A('do', 'DO', 'planitem', 'I1'),
    A('co', 'CONTRIB', 'planitem', 'I1'),
    A('multi', 'CONTRIB', 'planitem', 'I1'), A('multi', 'WPL', 'workpackage', 'W2'),   // règle 3 : plusieurs niveaux cumulés
    A('oldrwp', 'RWP', 'workpackage', 'W1'), A('oldrwp', 'RWP', 'workpackage', 'W1a'), A('oldmember', 'MEMBER', 'project', 'P1'),   // anciens codes, avant migration
    A('gone', 'CP', 'project', 'P2', { end_date: '2026-01-31' }),
    A('other', 'CONTRIB', 'planitem', 'I3')
  ];
  const ctx = (rid, admin) => ({ resourceId: rid, isAdmin: !!admin, lookup, assignments: c.activeAssignments(rid, assignments, '2026-10-05') });
  const S = (type, id) => ({ type: type, id: id });
  const can = (who, action, type, id) => c.can(ctx(who), action, type === 'global' ? S('global') : S(type, id));
  const rights = (who, action, targets) => targets.map((t) => can(who, action, t[0], t[1]));
  const P = ['project', 'P1'], W1 = ['workpackage', 'W1'], W1a = ['workpackage', 'W1a'], W2 = ['workpackage', 'W2'], I1 = ['planitem', 'I1'], I1b = ['planitem', 'I1b'], I4 = ['planitem', 'I4'], I2 = ['planitem', 'I2'], I5 = ['planitem', 'I5'];

  test('Reader : le rôle par défaut, lit tout, ne modifie rien', () => {
    ['wbs.edit', 'wbs.delete', 'progress.declare', 'baseline.request', 'budget.edit', 'risk.create', 'po.edit', 'sensitive.read', 'roles.assign', 'resource.edit'].forEach((a) => {
      ok(!can('reader', a, 'planitem', 'I1') && !can('reader', a, 'project', 'P1'), 'sans rôle : pas de « ' + a + ' »');
    });
    ok(can('reader', 'addon.install', 'global'), 'les droits ouverts à tous restent ouverts');
    eq(c.ROLE_RANK.READER, 7, 'Reader est le niveau 7');
    ok(!c.ASSIGNABLE_ROLES.includes('READER'), 'il ne s’enregistre jamais');
  });

  test('Contributor (6) : l’avancement de son livrable seulement', () => {
    ok(can('co', 'progress.declare', ...I1) && !can('co', 'progress.declare', ...I1b) && !can('co', 'progress.declare', ...I2), 'avancement : son livrable, pas le voisin');
    eq(rights('co', 'wbs.edit', [I1, I1b, W1a, P]), [false, false, false, false], 'ne modifie aucun objet');
    eq(rights('co', 'wbs.delete', [I1]), [false], 'ne supprime rien');
    ok(can('co', 'baseline.request', ...P) && can('co', 'risk.create', ...P) && can('co', 'po.edit', ...P), 'droits « en profondeur » : demander une baseline, créer un risque, bons de commande, pour son projet');
    ok(!can('co', 'baseline.request', 'project', 'P2'), 'mais pas pour un autre projet');
    eq(rights('co', 'budget.edit', [I1]).concat(rights('co', 'sensitive.read', [P]), rights('co', 'baseline.manage', [P])), [false, false, false], 'ni budget, ni lecture sensible, ni gestion des baselines');
  });

  test('Deliverable owner (5) : dates, création dedans impossible, suppression de son livrable', () => {
    eq(rights('do', 'wbs.edit', [I1, I1b, W1a, W1, P]), [true, false, false, false, false], 'modifie son livrable, pas le voisin ni son conteneur');
    eq(rights('do', 'wbs.delete', [I1, I1b]), [true, false], 'supprime son livrable (à valider), pas le voisin');
    ok(can('do', 'progress.declare', ...I1), 'et déclare son avancement (niveaux du dessus)');
    ok(!can('do', 'budget.edit', ...I1), 'le budget commence au Workpackage leader');
    ok(!can('do', 'sensitive.read', ...P), 'budgets, tarifs et comptes rendus : Workpackage leader et au-dessus');
  });

  test('Sub-workpackage leader (4) : son sous-WP et dedans ; pas le WP, pas le budget', () => {
    eq(rights('swpl', 'wbs.edit', [W1a, I1, I1b, W1, I4, W2]), [true, true, true, false, false, false], 'modifie son sous-WP et ses livrables, pas le WP au-dessus ni ce qui est à côté');
    eq(rights('swpl', 'wbs.delete', [W1a, I1, W1]), [false, true, false], 'supprime les livrables de son sous-WP, mais pas le sous-WP (niveau du dessus) ni le WP');
    ok(can('swpl', 'progress.declare', ...I1), 'avancement : oui');
    eq(rights('swpl', 'budget.edit', [I1]).concat(rights('swpl', 'sensitive.read', [P])), [false, false], 'pas de budget, pas de lecture sensible');
  });

  test('Workpackage leader (3) : son WP, ses sous-WP, leurs livrables ; budget et lecture sensible', () => {
    eq(rights('wpl', 'wbs.edit', [W1, W1a, I1, I1b, I4, W2, I2, P]), [true, true, true, true, true, false, false, false], 'modifie tout son WP, rien d’autre, pas le projet');
    eq(rights('wpl', 'wbs.delete', [W1, W1a, I1, I4]), [false, true, true, true], 'supprime sous-WP et livrables, pas son propre WP (niveau du dessus : chef de projet)');
    eq(rights('wpl', 'budget.edit', [I1, I4, I2]), [true, true, false], 'budget : son WP');
    ok(can('wpl', 'sensitive.read', ...P) && !can('wpl', 'sensitive.read', 'project', 'P2'), 'budgets, tarifs et comptes rendus : lisibles pour son projet seulement');
    eq(rights('wpl', 'baseline.manage', [P]).concat(rights('wpl', 'cpn.edit', [P]), rights('wpl', 'resource.edit', [['global']])), [false, false, false], 'ni baselines, ni CPN, ni création de personnes');
  });

  test('Chef de projet (2) : son projet et tout dedans ; baselines, CPN, personnes, tarifs', () => {
    eq(rights('cp', 'wbs.edit', [P, W1, W1a, W2, I1, I4, I2, I5]), [true, true, true, true, true, true, true, true], 'modifie le projet (et crée des WP dedans) et tout ce qu’il contient');
    eq(rights('cp', 'wbs.delete', [W1, W1a, I1, P]), [true, true, true, false], 'supprime workpackages, sous-WP et livrables, pas le projet (niveau du dessus : DPL)');
    eq(rights('cp', 'wbs.edit', [['project', 'P2'], ['workpackage', 'W3']]), [false, false], 'rien dans un autre projet');
    ok(c.can(ctx('cp'), 'baseline.manage', S('project', 'P1')) && can('cp', 'cpn.edit', ...P) && can('cp', 'resource.edit', 'global') && can('cp', 'ratecard.manage', 'global') && can('cp', 'sensitive.read', ...P), 'baselines, CPN, personnes, tarifs, lecture sensible');
    ok(!can('cp', 'project.create', 'program', 'PG1') && !can('cp', 'sheet.roles', 'global'), 'mais ni création de projet ni feuilles « Rôles »');
    ok(can('cp', 'risk.edit', 'risk', 'R1') && can('cp', 'changes.ack', ...P) && can('cp', 'sheet.budget', 'global'), 'risques, validation des changements, feuilles « Budget »');
  });

  test('Domain Program Leader (1) : posé sur plusieurs projets ; crée et supprime des projets', () => {
    eq(rights('dpl', 'wbs.edit', [P, ['project', 'P2'], W1, ['workpackage', 'W3'], I1, ['project', 'P3']]), [true, true, true, true, true, false], 'tout dans ses projets, rien dans un projet qui n’est pas le sien');
    eq(rights('dpl', 'wbs.delete', [P, ['project', 'P2'], ['project', 'P3']]), [true, true, false], 'supprime ses projets');
    ok(can('dpl', 'project.create', 'program', 'PG1') && can('dpl', 'program.view', 'program', 'PG1'), 'crée un projet dans le programme de ses projets et voit les vues consolidées (droit en profondeur)');
    ok(can('dpl', 'sheet.roles', 'global') && !can('dpl', 'program.create', 'global'), 'feuilles « Rôles » oui, création de programme non');
  });

  test('Program Leader (0) : tout le programme, y compris l’avancement', () => {
    eq(rights('pl', 'wbs.edit', [['program', 'PG1'], P, ['project', 'P2'], I1, ['workpackage', 'W3'], ['project', 'P3'], ['planitem', 'I6']]), [true, true, true, true, true, false, false], 'tout le programme, pas un projet hors programme');
    ok(can('pl', 'progress.declare', ...I2) && can('pl', 'program.create', 'global') && can('pl', 'project.create', 'program', 'PG1'), 'il déclare l’avancement (règle 2 : le niveau du dessus peut ce que peut celui du dessous), crée programme et projet');
    ok(can('pl', 'wbs.delete', 'project', 'P1'), 'supprime un projet');
  });

  test('Règle 2 : chaque niveau du dessus peut ce que peut celui du dessous', () => {
    const chain = ['pl', 'dpl', 'cp', 'wpl', 'swpl', 'do'];   // tous ont un rôle qui couvre I1
    chain.forEach((who) => ok(can(who, 'wbs.edit', ...I1) && can(who, 'progress.declare', ...I1), who + ' modifie I1 et déclare son avancement'));
    ok(!can('co', 'wbs.edit', ...I1) && !can('reader', 'progress.declare', ...I1), 'le Contributor et le Reader ne modifient pas I1');
    // chaque niveau a au moins les droits du niveau en dessous, sur tout ce qu’il couvre
    const order = ['wpl', 'swpl', 'do'];
    for (let i = 0; i < order.length - 1; i++) {
      ['wbs.edit', 'progress.declare'].forEach((a) => ok(!can(order[i + 1], a, ...I1) || can(order[i], a, ...I1), order[i] + ' ≥ ' + order[i + 1] + ' pour ' + a));
    }
  });

  test('Règle 3 : plusieurs niveaux cumulés, chacun là où il est posé', () => {
    ok(can('multi', 'progress.declare', ...I1) && !can('multi', 'wbs.edit', ...I1) && !can('multi', 'budget.edit', ...I1), 'Contributor de I1 : son avancement seulement');
    ok(can('multi', 'wbs.edit', ...I2) && can('multi', 'budget.edit', ...I2) && can('multi', 'wbs.edit', ...W2), 'Workpackage leader de W2 : tout W2');
    ok(!can('multi', 'wbs.edit', ...I4) && can('multi', 'baseline.request', ...P) && can('multi', 'sensitive.read', ...P), 'et le cumul ne déborde pas ailleurs ; le droit de lecture sensible vient de son rôle de WPL');
  });

  test('Anciens codes (avant migration) : mêmes droits que les nouveaux', () => {
    eq(rights('oldrwp', 'wbs.edit', [W1, W1a, I1, I4, W2]), [true, true, true, true, false], 'ancien « responsable de WP » = Workpackage leader (WP 1)');
    eq(rights('oldrwp', 'wbs.delete', [W1, W1a]), [false, true], 'avec les droits d’un Workpackage leader sur WP 1 (et Sub-WP leader sur le sous-WP)');
    ok(can('oldmember', 'progress.declare', ...I2) && can('oldmember', 'progress.declare', ...I5) && !can('oldmember', 'wbs.edit', ...I2), 'ancien « membre » = Contributor de ce qu’il couvrait');
    ok(!can('oldmember', 'progress.declare', 'planitem', 'I3'), 'et rien dans un autre projet');
  });

  test('Affectation expirée ignorée ; administrateur ; droit ouvert à tous ; portée globale', () => {
    eq(ctx('gone').assignments.length, 0);
    ok(!can('gone', 'wbs.edit', 'project', 'P2'));
    ok(c.can(ctx(null, true), 'program.create', S('global')) && c.can(ctx(null, true), 'wbs.delete', S('project', 'P1')), 'l’administrateur peut tout');
    ok(c.can(ctx(null), 'addon.install', S('global')) && !c.can(ctx(null), 'wbs.edit', S('project', 'P1')), 'sans fiche : seulement les droits ouverts à tous');
    ok(can('cp', 'ratecard.manage', 'global') && !can('wpl', 'ratecard.manage', 'global') && !can('do', 'resource.edit', 'global'), 'portée globale : accordée si le niveau est détenu quelque part');
    eq(c.can(ctx('wpl'), 'wbs.edit', null), true, 'sans périmètre : un rôle de niveau suffisant n’importe où suffit');
  });

  test('Droits en profondeur : un rôle dans le périmètre compte, pas un rôle d’un autre périmètre', () => {
    ok(!can('other', 'baseline.request', ...P) && can('other', 'baseline.request', 'project', 'P2'), 'Contributor d’un livrable de P2 : demande une baseline pour P2, pas pour P1');
    ok(can('swpl', 'po.edit', ...P) && !can('swpl', 'po.edit', 'project', 'P2'), 'un Sub-WP leader aussi, pour son projet seulement');
    ok(can('pl', 'program.view', 'program', 'PG1') && !can('cp', 'program.view', 'program', 'PG1'), 'les vues consolidées du programme : DPL et au-dessus');
  });

  test('Risque rattaché au projet', () => {
    ok(can('cp', 'risk.edit', 'risk', 'R1') && can('dpl', 'risk.edit', 'risk', 'R1') && !can('wpl', 'risk.edit', 'risk', 'R1'));
    ok(can('co', 'risk.create', 'risk', 'R1'), 'un Contributor déclare un risque sur son projet');
  });

  test('Poser un rôle : bon type d’objet, par un niveau strictement supérieur détenu sur l’objet ou au-dessus', () => {
    const chk = (who, role, type, id) => c.roleAssignCheck_(ctx(who, who === 'admin'), role, S(type, id));
    const okk = (who, role, type, id, msg) => ok(chk(who, role, type, id) === null, msg + ' : permis');
    const bad = (who, role, type, id, code, msg) => { const r = chk(who, role, type, id); ok(r && r.code === code, msg + ' : refusé (' + (r ? r.message : 'permis !') + ')'); };
    okk('pl', 'DPL', 'project', 'P1', 'le PL pose un DPL sur un projet');
    okk('pl', 'CP', 'project', 'P1', 'le PL pose un chef de projet');
    okk('dpl', 'CP', 'project', 'P1', 'un DPL pose un chef de projet sur son projet');
    okk('cp', 'WPL', 'workpackage', 'W1', 'un chef de projet pose un Workpackage leader');
    okk('wpl', 'SWPL', 'workpackage', 'W1a', 'un Workpackage leader pose un Sub-WP leader sur un sous-WP de son WP');
    okk('swpl', 'DO', 'planitem', 'I1', 'un Sub-WP leader pose le Deliverable owner d’un livrable de son sous-WP');
    okk('wpl', 'DO', 'planitem', 'I4', 'un Workpackage leader aussi, quand le livrable est directement dans son WP (pas de sous-WP)');
    okk('do', 'CONTRIB', 'planitem', 'I1', 'un Deliverable owner pose des Contributors sur son livrable');
    okk('cp', 'CONTRIB', 'planitem', 'I2', 'un niveau plus haut aussi');
    okk('admin', 'PL', 'program', 'PG1', 'l’administrateur pose le Program Leader');
    bad('cp', 'CP', 'project', 'P1', 'FORBIDDEN', 'un chef de projet ne pose pas un chef de projet (même niveau)');
    bad('cp', 'DPL', 'project', 'P1', 'FORBIDDEN', 'ni un DPL (niveau au-dessus)');
    bad('dpl', 'DPL', 'project', 'P1', 'FORBIDDEN', 'un DPL ne pose pas un DPL');
    bad('pl', 'PL', 'program', 'PG1', 'FORBIDDEN', 'le Program Leader est désigné par l’administrateur');
    bad('wpl', 'WPL', 'workpackage', 'W1', 'FORBIDDEN', 'un Workpackage leader ne se remplace pas lui-même');
    bad('swpl', 'SWPL', 'workpackage', 'W1a', 'FORBIDDEN', 'un Sub-WP leader non plus');
    bad('do', 'DO', 'planitem', 'I1', 'FORBIDDEN', 'un Deliverable owner ne pose pas un Deliverable owner');
    bad('do', 'CONTRIB', 'planitem', 'I1b', 'FORBIDDEN', 'un Deliverable owner ne pose rien sur le livrable d’à côté');
    bad('co', 'CONTRIB', 'planitem', 'I1', 'FORBIDDEN', 'un Contributor ne pose personne');
    bad('reader', 'CONTRIB', 'planitem', 'I1', 'FORBIDDEN', 'un Reader non plus');
    bad('wpl', 'WPL', 'workpackage', 'W2', 'FORBIDDEN', 'et un Workpackage leader ne pose rien dans le WP d’un autre');
    bad('cp', 'CP', 'planitem', 'I1', 'VALIDATION', 'pas de chef de projet sur un livrable');
    bad('cp', 'DO', 'workpackage', 'W1', 'VALIDATION', 'pas de Deliverable owner sur un workpackage');
    bad('cp', 'WPL', 'workpackage', 'W1a', 'VALIDATION', 'un sous-workpackage reçoit un Sub-WP leader, pas un Workpackage leader');
    bad('cp', 'SWPL', 'workpackage', 'W1', 'VALIDATION', 'un workpackage de premier niveau reçoit un Workpackage leader, pas un Sub-WP leader');
    bad('admin', 'DPL', 'program', 'PG1', 'VALIDATION', 'même l’administrateur ne pose pas un DPL sur un programme (il se pose sur ses projets)');
    bad('admin', 'READER', 'planitem', 'I1', 'VALIDATION', 'Reader ne se pose pas : c’est le rôle par défaut');
    bad('admin', 'MEMBER', 'project', 'P1', 'VALIDATION', 'les anciens codes ne se posent plus');
    bad('admin', 'INCONNU', 'project', 'P1', 'VALIDATION', 'un code inconnu');
  });

  test('Rôles que l’on peut poser sur un objet (assignableRolesOn_)', () => {
    const roles = (who, type, id) => c.assignableRolesOn_(ctx(who, who === 'admin'), S(type, id));
    eq(roles('pl', 'project', 'P1'), ['DPL', 'CP'], 'le PL sur un projet : DPL et chef de projet');
    eq(roles('dpl', 'project', 'P1'), ['CP'], 'un DPL sur son projet : chef de projet');
    eq(roles('cp', 'project', 'P1'), [], 'un chef de projet sur son projet : rien (ses pairs sont posés au-dessus)');
    eq(roles('cp', 'workpackage', 'W1'), ['WPL'], 'sur un workpackage : le Workpackage leader');
    eq(roles('cp', 'workpackage', 'W1a'), ['SWPL'], 'sur un sous-workpackage : le Sub-WP leader');
    eq(roles('cp', 'planitem', 'I1'), ['DO', 'CONTRIB'], 'sur un livrable ou un jalon : Deliverable owner et Contributor');
    eq(roles('do', 'planitem', 'I1'), ['CONTRIB'], 'le Deliverable owner : des Contributors seulement');
    eq(roles('co', 'planitem', 'I1').concat(roles('reader', 'planitem', 'I1')), [], 'un Contributor ou un Reader : rien');
    eq(roles('admin', 'program', 'PG1'), ['PL'], 'l’administrateur sur un programme : le Program Leader');
    eq(roles('admin', 'planitem', 'I1'), ['DO', 'CONTRIB']);
  });

  test('Table des droits : déduite des niveaux, sans Reader', () => {
    eq(c.PERMISSIONS['budget.edit'], ['PL', 'DPL', 'CP', 'WPL'], 'budget : Workpackage leader et au-dessus');
    eq(c.PERMISSIONS['progress.declare'], ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB'], 'avancement : Contributor et au-dessus');
    eq(c.PERMISSIONS['program.create'], ['PL']);
    eq(c.PERMISSIONS['addon.install'], ['*']);
    ok(Object.keys(c.PERMISSION_LEVEL).every((a) => c.PERMISSION_LEVEL[a] === '*' || c.ROLE_RANK[c.PERMISSION_LEVEL[a]] !== undefined), 'chaque droit a un niveau connu');
    eq(Object.keys(c.ROLE_OBJECT).sort(), c.ASSIGNABLE_ROLES.slice().sort(), 'chaque rôle enregistrable a son type d’objet');
    eq(c.ROLES.map((r) => c.ROLE_RANK[r]), [0, 1, 2, 3, 4, 5, 6, 7], 'huit niveaux, de 0 à 7');
  });
};
