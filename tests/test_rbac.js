const { loadCore, test, eq, ok } = require('./harness');

module.exports = function () {
  const c = loadCore();
  console.log('\nDroits (RBAC)');

  const projects = { P1: { id: 'P1', program_id: 'PG1' }, P2: { id: 'P2', program_id: '' } };
  const wps = { W1: { id: 'W1', project_id: 'P1', parent_wp_id: '' }, W1a: { id: 'W1a', project_id: 'P1', parent_wp_id: 'W1' },
    W2: { id: 'W2', project_id: 'P1', parent_wp_id: '' } };
  const items = { I1: { id: 'I1', project_id: 'P1', wp_id: 'W1a' }, I2: { id: 'I2', project_id: 'P1', wp_id: 'W2' },
    I3: { id: 'I3', project_id: 'P2', wp_id: '' } };
  const risks = { R1: { id: 'R1', project_id: 'P1' } };
  const lookup = {
    project: (id) => projects[id], workpackage: (id) => wps[id], planitem: (id) => items[id], risk: (id) => risks[id],
    budgetMember: (res, item) => res === 'r6' && item === 'I3'
  };
  const assignments = [
    { resource_id: 'r1', role_code: 'CP', scope_type: 'project', scope_id: 'P1' },
    { resource_id: 'r2', role_code: 'RWP', scope_type: 'workpackage', scope_id: 'W1' },
    { resource_id: 'r3', role_code: 'PL', scope_type: 'program', scope_id: 'PG1' },
    { resource_id: 'r4', role_code: 'DPL', scope_type: 'program', scope_id: 'PG1' },
    { resource_id: 'r5', role_code: 'MEMBER', scope_type: 'project', scope_id: 'P1' },
    { resource_id: 'r7', role_code: 'CP', scope_type: 'project', scope_id: 'P2', end_date: '2026-01-31' }
  ];
  const ctx = (rid, admin) => ({
    resourceId: rid, isAdmin: !!admin, lookup,
    assignments: c.activeAssignments(rid, assignments, '2026-10-05')
  });
  const I = (id) => ({ type: 'planitem', id });

  test('Chef de projet : son projet, pas un autre', () => {
    ok(c.can(ctx('r1'), 'wbs.edit', I('I1')));
    ok(!c.can(ctx('r1'), 'wbs.edit', I('I3')));
    ok(c.can(ctx('r1'), 'baseline.manage', { type: 'project', id: 'P1' }));
  });

  test('Responsable de WP : son WP et ses sous-WP seulement', () => {
    ok(c.can(ctx('r2'), 'wbs.edit', I('I1')), 'I1 est dans W1a, sous-WP de W1');
    ok(!c.can(ctx('r2'), 'wbs.edit', I('I2')));
    ok(!c.can(ctx('r2'), 'baseline.manage', { type: 'project', id: 'P1' }));
  });

  test('PL : édite tout le programme mais ne déclare pas d’avancement', () => {
    ok(c.can(ctx('r3'), 'wbs.edit', I('I2')));
    ok(!c.can(ctx('r3'), 'progress.declare', I('I2')));
    ok(!c.can(ctx('r3'), 'wbs.edit', I('I3')), 'P2 hors programme');
  });

  test('DPL : crée des projets et gère les baselines de son périmètre', () => {
    ok(c.can(ctx('r4'), 'project.create', { type: 'program', id: 'PG1' }));
    ok(c.can(ctx('r4'), 'baseline.manage', { type: 'project', id: 'P1' }));
    ok(!c.can(ctx('r1'), 'project.create', { type: 'program', id: 'PG1' }), 'un CP ne crée pas de projet');
  });

  test('Membre affecté : déclare l’avancement, ne gère pas les baselines', () => {
    ok(c.can(ctx('r5'), 'progress.declare', I('I1')));
    ok(c.can(ctx('r5'), 'baseline.request', { type: 'project', id: 'P1' }));
    ok(!c.can(ctx('r5'), 'baseline.manage', { type: 'project', id: 'P1' }));
  });

  test('Membre par ligne budgétaire : seulement sur son livrable', () => {
    ok(c.can(ctx('r6'), 'progress.declare', I('I3')));
    ok(!c.can(ctx('r6'), 'progress.declare', I('I1')));
  });

  test('Portée globale : rate card pour tout CP, pas pour un membre', () => {
    ok(c.can(ctx('r1'), 'ratecard.manage', { type: 'global' }));
    ok(!c.can(ctx('r5'), 'ratecard.manage', { type: 'global' }));
  });

  test('Affectation expirée ignorée ; admin et addons', () => {
    eq(ctx('r7').assignments.length, 0);
    ok(!c.can(ctx('r7'), 'wbs.edit', I('I3')));
    ok(c.can(ctx(null, true), 'program.create', { type: 'global' }));
    ok(c.can(ctx(null), 'addon.install', { type: 'global' }));
  });

  test('Risque rattaché au projet', () => {
    ok(c.can(ctx('r1'), 'risk.edit', { type: 'risk', id: 'R1' }));
    ok(!c.can(ctx('r2'), 'risk.edit', { type: 'risk', id: 'R1' }));
  });
};
