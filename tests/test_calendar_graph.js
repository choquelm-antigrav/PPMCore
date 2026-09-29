const { loadCore, test, eq, ok } = require('./harness');

module.exports = function () {
  const c = loadCore();
  console.log('\nCalendriers');

  test('Pâques 2000, 2019, 2024–2027', () => {
    eq([2000, 2019, 2024, 2025, 2026, 2027].map(c.easterSunday),
      ['2000-04-23', '2019-04-21', '2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28']);
  });

  test('France 2026 : 11 fériés dont Ascension et Pentecôte', () => {
    const d = c.holidaysFor('FR', 2026).map((h) => h.date);
    eq(d.length, 11);
    ok(d.includes('2026-05-14') && d.includes('2026-05-25') && d.includes('2026-04-06'));
  });

  test('Allemagne 2026 : Vendredi saint et 3 octobre', () => {
    const d = c.holidaysFor('DE', 2026).map((h) => h.date);
    ok(d.includes('2026-04-03') && d.includes('2026-10-03') && d.includes('2026-12-26'));
  });

  test('Royaume-Uni 2026 : Boxing Day reporté au lundi 28', () => {
    eq(c.holidaysFor('UK', 2026).map((h) => h.date),
      ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  });

  test('Royaume-Uni 2027 : Noël un samedi → 27 et 28 décembre', () => {
    eq(c.holidaysFor('UK', 2027).map((h) => h.date),
      ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28']);
  });

  test('Royaume-Uni 2022 (Noël un dimanche) et 2028 (Nouvel An un samedi)', () => {
    const d22 = c.holidaysFor('UK', 2022).map((h) => h.date);
    ok(d22.includes('2022-12-26') && d22.includes('2022-12-27') && !d22.includes('2022-12-25'));
    ok(c.holidaysFor('UK', 2028).map((h) => h.date).includes('2028-01-03'));
  });

  test('Inde : trois fériés nationaux', () => {
    eq(c.holidaysFor('IN', 2026).map((h) => h.date), ['2026-01-26', '2026-08-15', '2026-10-02']);
  });

  test('Jours ouvrés : Pâques en France et en Allemagne', () => {
    const fr = c.holidayMap(c.holidaysFor('FR', 2026));
    const de = c.holidayMap(c.holidaysFor('DE', 2026));
    eq(c.addWorkingDays('2026-04-03', 1, fr), '2026-04-07');
    eq(c.addWorkingDays('2026-04-02', 1, de), '2026-04-07');
    eq(c.addWorkingDays('2026-04-07', -1, fr), '2026-04-03');
    eq(c.addWorkingDays('2026-05-13', 1, fr), '2026-05-15');
    eq(c.workingDaysBetween('2026-05-01', '2026-05-08', fr), 4);
    eq(c.addWorkingDays('2026-10-09', 0, fr), '2026-10-09');
  });

  console.log('\nGraphe de dépendances');
  const E = (from, to) => ({ from, to });

  test('Détection de cycle à l’ajout', () => {
    const edges = [E('A', 'B'), E('B', 'C')];
    ok(c.wouldCreateCycle(edges, E('C', 'A')), 'C→A ferme un cycle');
    ok(!c.wouldCreateCycle(edges, E('A', 'C')), 'A→C n’en ferme pas');
    ok(c.wouldCreateCycle(edges, E('D', 'D')), 'auto-dépendance');
  });

  test('findCycle renvoie la boucle', () => {
    const cyc = c.findCycle([E('A', 'B'), E('B', 'C'), E('C', 'A'), E('C', 'D')]);
    ok(cyc && cyc[0] === cyc[cyc.length - 1] && cyc.length === 4, JSON.stringify(cyc));
    eq(c.findCycle([E('A', 'B'), E('B', 'C')]), null);
  });

  const it = (id, type, start, finish, project) => ({ id, item_type: type, planned_start: start, planned_finish: finish, project_id: project || 'P1' });
  const dep = (id, p, s, type, lag) => ({ id, predecessor_id: p, successor_id: s, dep_type: type, lag_days: lag || 0 });

  test('FS : le successeur commence le jour ouvré suivant', () => {
    const items = [it('P', 'Livrable', '2026-10-05', '2026-10-09'), it('S', 'Livrable', '2026-10-09', '2026-10-15'),
      it('S2', 'Livrable', '2026-10-12', '2026-10-15')];
    const v = c.dependencyViolations(items, [dep('d1', 'P', 'S', 'FS'), dep('d2', 'P', 'S2', 'FS')], null);
    eq(v.length, 1);
    eq([v[0].dependency_id, v[0].required, v[0].gap_days], ['d1', '2026-10-12', 1]);
  });

  test('FS depuis un jalon : même jour autorisé ; décalage de 1 jour', () => {
    const items = [it('M', 'Jalon', '2026-10-09', '2026-10-09'), it('S', 'Livrable', '2026-10-09', '2026-10-15'),
      it('P', 'Livrable', '2026-10-05', '2026-10-09'), it('S3', 'Livrable', '2026-10-12', '2026-10-20')];
    eq(c.dependencyViolations(items, [dep('d1', 'M', 'S', 'FS')], null).length, 0);
    const v = c.dependencyViolations(items, [dep('d2', 'P', 'S3', 'FS', 1)], null);
    eq(v.map((x) => x.required), ['2026-10-13']);
  });

  test('SS avec décalage et FF', () => {
    const items = [it('P', 'Livrable', '2026-10-05', '2026-10-09'), it('S', 'Livrable', '2026-10-06', '2026-10-08')];
    const v = c.dependencyViolations(items, [dep('ss', 'P', 'S', 'SS', 2), dep('ff', 'P', 'S', 'FF')], null);
    eq(v.map((x) => x.dependency_id + ':' + x.required), ['ss:2026-10-07', 'ff:2026-10-09']);
  });

  test('Le calendrier du successeur compte (11 novembre en France, pas au Royaume-Uni)', () => {
    const items = [it('P', 'Livrable', '2026-11-02', '2026-11-10', 'FRP'), it('S', 'Livrable', '2026-11-11', '2026-11-20', 'FRP'),
      it('P2', 'Livrable', '2026-11-02', '2026-11-10', 'UKP'), it('S2', 'Livrable', '2026-11-11', '2026-11-20', 'UKP')];
    const cal = { FRP: c.holidayMap(c.holidaysFor('FR', 2026)), UKP: c.holidayMap(c.holidaysFor('UK', 2026)) };
    const v = c.dependencyViolations(items, [dep('fr', 'P', 'S', 'FS'), dep('uk', 'P2', 'S2', 'FS')], (p) => cal[p]);
    eq(v.map((x) => x.dependency_id + ':' + x.required), ['fr:2026-11-12']);
  });

  test('Éléments supprimés ignorés', () => {
    const items = [it('P', 'Livrable', '2026-10-05', '2026-10-09'), Object.assign(it('S', 'Livrable', '2026-10-06', '2026-10-08'), { deleted: true })];
    eq(c.dependencyViolations(items, [dep('d', 'P', 'S', 'FS')], null).length, 0);
  });
};
