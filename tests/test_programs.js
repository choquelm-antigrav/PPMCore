const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nCréer un programme depuis la page Administration (0.19.1)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';

  test('Création : code et nom obligatoires, code unique sans tenir compte de la casse, statut Actif par défaut', () => {
    const w = lot2World();
    const create = (who, v) => w.raw(who || ADMIN, 'programs.create', { values: v });
    const g = create(ADMIN, { code: ' NAC ', name: ' Programme nacelle ', description: 'Nacelles A et B' });
    ok(g.ok, JSON.stringify(g.error));
    eq([g.data.code, g.data.name, g.data.status, g.data.description], ['NAC', 'Programme nacelle', 'Actif', 'Nacelles A et B'], 'les espaces sont retirés ; le statut par défaut est Actif');
    eq(create(ADMIN, { code: 'NAC', name: 'Autre' }).error.message, 'Le code « NAC » est déjà utilisé par un autre programme.', 'code déjà pris');
    eq(create(ADMIN, { code: 'nac', name: 'Autre' }).error.code, 'VALIDATION', 'même sans tenir compte de la casse');
    eq([create(ADMIN, { name: 'Sans code' }).error.message, create(ADMIN, { code: 'X1' }).error.message, create(ADMIN, { code: 'x'.repeat(21), name: 'Long' }).error.message],
      ['Le code du programme est obligatoire.', 'Le nom du programme est obligatoire.', 'Code du programme : 20 caractères au plus.'], 'code et nom obligatoires, code de 20 caractères au plus');
    ok(create(ADMIN, { code: 'AIR', name: 'Aéro', status: 'En pause' }).data.status === 'En pause', 'un autre statut se choisit');
    ok(w.call(ADMIN, 'planning.catalog', {}).programs.some((p) => p.code === 'NAC'), 'le programme apparaît dans le catalogue (sélecteurs de programme, vue programme)');
  });

  test('Qui peut créer un programme : l’administrateur ; ni un chef de projet, ni un DPL, ni un Workpackage leader', () => {
    const w = lot2World();
    eq([w.raw(CP, 'programs.create', { values: { code: 'A1', name: 'A' } }).error.code, w.raw(WPL, 'programs.create', { values: { code: 'A2', name: 'A' } }).error.code, w.raw(DPL, 'programs.create', { values: { code: 'A3', name: 'A' } }).error.code], ['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN'], 'ni chef de projet, ni Workpackage leader, ni DPL');
    ok(w.raw(ADMIN, 'programs.create', { values: { code: 'A4', name: 'A' } }).ok, 'l’administrateur');
  });

  test('Ensuite : l’administrateur désigne le Program Leader sur le programme (page WBS) ; un projet peut y être rattaché', () => {
    const w = lot2World();
    const g = w.call(ADMIN, 'programs.create', { values: { code: 'NEW', name: 'Nouveau' } });
    const r = w.raw(ADMIN, 'roles.assign', { values: { role_code: 'PL', scope_type: 'program', scope_id: g.id, resource_id: w.carla.id } });
    ok(r.ok, JSON.stringify(r.error));
    eq(w.raw(CP, 'roles.assign', { values: { role_code: 'PL', scope_type: 'program', scope_id: g.id, resource_id: w.mia.id } }).ok, false, 'un chef de projet ne pose pas de Program Leader');
    const p = w.call(ADMIN, 'projects.create', { values: { code: 'PX', name: 'Projet X', program_id: g.id, status: 'Actif', holiday_country: 'FR' } });
    eq(w.call(ADMIN, 'planning.catalog', {}).projects.find((x) => x.id === p.id).program_id, g.id, 'le projet est rattaché au programme');
  });
};
