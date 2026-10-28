const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nVersions figées de l’exercice : figer, comparer, valider par le niveau du dessus (0.18.0)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** Équipes 1vm ⊃ 1vmd, 2ae ; exercices 2026 (exécution) et 2027 (préparation) ; sur P1 : attendu 1vm 100 000, 1vmd 30 000, 2ae 50 000, accordé 1vm 80 000 ; parts : Spécification 1vm 40 000 et 1vmd 20 000, Calcul 1vm 30 000 et 2ae 60 000. */
  function world() {
    const w = lot2World();
    w.team = (name, extra) => w.call(CP, 'teams.create', { values: Object.assign({ name }, extra || {}) });
    w.vm = w.team('1vm'); w.vmd = w.team('1vmd', { parent_team_id: w.vm.id }); w.ae = w.team('2ae');
    const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
    w.prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
    w.set = (team, f, v) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.prep.id, teamId: team.id, [f]: v });
    w.part = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: w.prep.id });
    w.set(w.vm, 'expected', 100000); w.set(w.vmd, 'expected', 30000); w.set(w.ae, 'expected', 50000); w.set(w.vm, 'granted', 80000);
    w.part(w.a, w.vm, 40000); w.part(w.a, w.vmd, 20000); w.part(w.b, w.vm, 30000); w.part(w.b, w.ae, 60000);
    w.freeze = (who, p) => w.raw(who || CP, 'exercise.version.create', Object.assign({ projectId: w.p1.id, exerciseId: w.prep.id, justification: 'Attendu avant l’été', label: 'Attendu' }, p || {}));
    w.list = (who) => w.raw(who || CP, 'exercise.version.list', { projectId: w.p1.id, exerciseId: w.prep.id });
    w.cmp = (p, who) => w.raw(who || CP, 'exercise.version.compare', Object.assign({ projectId: w.p1.id, exerciseId: w.prep.id }, p || {}));
    w.decide = (who, id, p) => w.raw(who, 'exercise.version.decide', Object.assign({ id, decision: 'validate' }, p || {}));
    return w;
  }

  test('Figer une version : chef de projet et au-dessus, motif obligatoire, instantané complet ; à valider par le niveau du dessus, validée d’emblée si personne n’est au-dessus', () => {
    const w = world();
    eq([w.freeze(WPL).error.code, w.freeze(MEMBER).error.code], ['FORBIDDEN', 'FORBIDDEN'], 'ni le Workpackage leader, ni un Contributor ne figent');
    ok(/motif est obligatoire/.test(w.freeze(CP, { justification: ' ' }).error.message), 'sans motif : refusé');
    ok(/60 caractères/.test(w.freeze(CP, { label: 'x'.repeat(61) }).error.message), 'libellé trop long : refusé');
    const v1 = w.freeze(CP);
    ok(v1.ok, JSON.stringify(v1.error));
    eq([v1.data.number, v1.data.label, v1.data.status, v1.data.author, v1.data.totals], [1, 'Attendu', 'À valider', CP, { expected: 180000, granted: 80000, parts: 150000 }], 'version 1, à valider par le niveau du dessus (le DPL) ; totaux de l’instantané');
    const lines = w.c.repoList('ExerciseVersionLine').filter((l) => l.version_id === v1.data.id);
    eq([lines.filter((l) => l.kind === 'team').length, lines.filter((l) => l.kind === 'part').length], [3, 4], 'trois lignes d’équipe (1vm, 1vmd, 2ae) et quatre parts de livrables');
    eq(lines.find((l) => l.kind === 'part' && l.team_id === w.ae.id).label, 'Calcul', 'une part garde le nom du livrable');
    const v2 = w.freeze(CP, { label: '', justification: 'Livrables de septembre' });
    eq([v2.data.number, v2.data.label], [2, 'V2'], 'la numérotation continue ; le libellé par défaut est V2');
    const top = w.freeze(ADMIN, { label: 'Décision' });
    eq([top.data.number, top.data.status, top.data.decided_by], [3, 'Validée', ADMIN], 'figée par l’administrateur : personne au-dessus, validée d’emblée');
    // rien à figer
    eq(w.raw(ADMIN, 'exercise.version.create', { projectId: w.p2.id, exerciseId: w.prep.id, justification: 'x' }).error.message, 'Rien à figer : cet exercice n’a encore ni budget d’équipe ni part de livrable pour ce projet.', 'un projet sans rien dans l’exercice : rien à figer');
    w.call(ADMIN, 'exercise.setStatus', { id: w.exec.id, status: 'Clos' });
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Exécution' });
    ok(w.freeze(CP).ok, 'en exécution, on fige encore (révisions de février et d’avril)');
    w.call(ADMIN, 'exercise.setStatus', { id: w.prep.id, status: 'Clos' });
    ok(/est clos/.test(w.freeze(CP).error.message), 'exercice clos : plus de version');
  });

  test('Une version ne change jamais ; la liste dit qui peut la valider', () => {
    const w = world(), v1 = w.freeze(CP).data;
    w.set(w.vm, 'expected', 999999); w.part(w.cc, w.ae, 5000);
    const before = w.list().data.versions[0];
    eq([before.totals.expected, before.totals.parts], [180000, 150000], 'l’état change, la version figée garde ses totaux');
    eq(w.c.repoList('ExerciseVersionLine').filter((l) => l.version_id === v1.id).length, 7, 'et ses lignes');
    w.freeze(CP, { justification: 'Deuxième' });
    const list = w.list(DPL).data;
    eq(list.versions.map((v) => v.number), [2, 1], 'les plus récentes d’abord');
    eq(list.versions.map((v) => v.can_decide), [true, true], 'le DPL peut valider les deux versions de la cheffe de projet');
    eq(w.list(CP).data.versions.map((v) => v.can_decide), [false, false], 'l’auteur ne valide pas sa propre version');
    eq([w.list(WPL).data.versions.length, w.list(WPL).data.can_create, w.list(CP).data.can_create], [2, false, true], 'le Workpackage leader lit, sans pouvoir figer');
    eq(w.list(MEMBER).error.code, 'FORBIDDEN', 'un Contributor ne voit pas les versions');
    eq(w.raw(CP, 'exercise.version.list', { projectId: w.p1.id, exerciseId: 'inconnu' }).error.code, 'NOT_FOUND');
    ok(w.c.repoList('ExerciseVersion').every((v) => !w.c.isTrue(v.deleted)), 'aucune version n’est supprimée');
  });

  test('Comparer : écart par équipe (attendu, accordé, parts) et livrables ajoutés, retirés ou rechiffrés ; deux versions ou la dernière et l’état actuel', () => {
    const w = world();
    eq(w.cmp().error.code, 'VALIDATION', 'sans version : on demande d’en figer une d’abord');
    const v1 = w.freeze(CP).data;
    const same = w.cmp().data;
    eq([same.identical, same.teams, same.parts, same.a.label, same.b.label], [true, [], [], 'Attendu', 'État actuel'], 'rien n’a bougé depuis la version : aucun écart');
    w.set(w.vm, 'expected', 120000);                                           // l'attendu de 1vm monte de 20 000
    w.set(w.ae, 'granted', 45000);                                             // un accordé apparaît pour 2ae
    w.part(w.cc, w.ae, 5000);                                                  // un livrable chiffré en plus
    const lineB = w.c.repoList('BudgetLine').find((l) => l.deliverable_id === w.b.id && l.team_id === w.ae.id);
    w.call(CP, 'budget.line.save', { id: lineB.id, version: lineB.version, values: { planned_amount: 55000 } });   // une part rechiffrée
    const lineA = w.c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id && l.team_id === w.vmd.id);
    w.call(CP, 'budget.line.delete', { id: lineA.id });                        // une part retirée
    const d = w.cmp().data;
    eq(d.identical, false);
    const t = (n) => d.teams.find((x) => x.name === n);
    eq([t('1vm').expected.delta, t('2ae').granted.a, t('2ae').granted.b, t('2ae').granted.delta, t('2ae').parts.delta, t('1vmd').parts.delta], [20000, null, 45000, 45000, 0, -20000], 'écarts par équipe : 1vm +20 000 d’attendu ; 2ae : un accordé de 45 000 apparaît, ses parts ne bougent pas au total ; 1vmd perd ses 20 000 de parts');
    eq([t('2ae').parts.a, t('2ae').parts.b], [60000, 60000], 'les parts de 2ae : 60 000 → 55 000 + 5 000 = 60 000 au total');
    eq(d.parts.map((x) => x.deliverable + '|' + x.team + '|' + x.status + '|' + x.a + '|' + x.b).sort(), ['Calcul|2ae|rechiffrée|60000|55000', 'Essais|2ae|ajoutée|null|5000', 'Spécification|1vmd|retirée|20000|null'], 'une part rechiffrée, une ajoutée, une retirée');
    eq([d.totals.expected.delta, d.totals.granted.delta, d.totals.parts.delta], [20000, 45000, -20000], 'totaux : attendu +20 000, accordé +45 000 ; parts de 150 000 à 130 000 (−20 000 de 1vmd, −5 000 et +5 000 pour 2ae)');
    // deux versions entre elles, puis avec l'état actuel
    const v2 = w.freeze(CP, { justification: 'Après ajustements' }).data;
    const ab = w.cmp({ a: v1.id, b: v2.id }).data;
    eq([ab.a.number, ab.b.number, ab.parts.length, ab.identical], [1, 2, 3, false], 'comparer la version 1 à la version 2');
    eq(w.cmp({ a: v2.id }).data.identical, true, 'la dernière version et l’état actuel : identiques juste après avoir figé');
    eq(w.cmp({ a: 'inconnue' }).error.code, 'NOT_FOUND', 'version inconnue');
    eq(w.cmp({}, MEMBER).error.code, 'FORBIDDEN', 'un Contributor ne compare pas');
    eq(w.cmp({ a: v1.id }, WPL).ok, true, 'un Workpackage leader lit la comparaison');
  });

  test('Valider ou refuser : par le niveau strictement supérieur à l’auteur ; motif du refus obligatoire ; une décision est définitive', () => {
    const w = world(), v = w.freeze(CP).data;
    eq(w.decide(CP, v.id).error.code, 'FORBIDDEN', 'la cheffe de projet ne valide pas sa propre version');
    eq(w.decide(WPL, v.id).error.code, 'FORBIDDEN', 'ni un niveau en dessous');
    eq(w.decide(MEMBER, v.id).error.code, 'FORBIDDEN');
    eq(w.raw(DPL, 'exercise.version.decide', { id: v.id, decision: 'peut-être' }).error.code, 'VALIDATION', 'décision inconnue');
    ok(/motif du refus est obligatoire/.test(w.decide(DPL, v.id, { decision: 'refuse' }).error.message), 'refuser sans motif : non');
    const ok1 = w.decide(DPL, v.id, { note: 'Conforme au cadrage' });
    ok(ok1.ok, JSON.stringify(ok1.error));
    eq([ok1.data.status, ok1.data.decided_by, ok1.data.decision_note, ok1.data.can_decide], ['Validée', DPL, 'Conforme au cadrage', false], 'validée par le DPL, avec sa note');
    ok(/n’est plus à valider \(validée\)/.test(w.decide(DPL, v.id).error.message), 'une décision est définitive');
    const v2 = w.freeze(CP, { justification: 'Deuxième' }).data;
    const refused = w.decide(ADMIN, v2.id, { decision: 'refuse', note: 'Dépasse l’enveloppe' });
    eq([refused.data.status, refused.data.decision_note], ['Refusée', 'Dépasse l’enveloppe'], 'refusée par l’administrateur, avec son motif');
    eq(w.list(CP).data.versions.map((x) => x.status), ['Refusée', 'Validée'], 'la liste montre les décisions');
    const top = w.freeze(ADMIN, { label: 'Décidée' }).data;
    ok(/n’est plus à valider \(validée\)/.test(w.decide(ADMIN, top.id).error.message), 'une version figée par l’administrateur est déjà validée : rien à décider');
    eq(w.raw(DPL, 'exercise.version.decide', { id: 'inconnue', decision: 'validate' }).error.code, 'NOT_FOUND');
  });

  test('Le récapitulatif du matin signale les versions à valider à ceux qui peuvent les valider, pas à leur auteur', () => {
    const w = world(), today = w.c.todayStr();
    const v = w.freeze(CP).data;
    const recap = (email) => w.c.buildDigests(w.c.loadDigestData_(), today, { baseUrl: 'https://ppm.test/exec' }).filter((d) => d.to === email)[0];
    const dpl = recap(DPL);
    ok(dpl && /P1 · 1 version de l’exercice figée/.test(dpl.text) && /view=budget&project=/.test(dpl.text), 'le DPL lit « 1 version de l’exercice figée : à valider », avec le lien du budget');
    ok(!recap(CP) || !/version de l’exercice figée/.test(recap(CP).text), 'l’auteur ne reçoit pas cette ligne');
    w.decide(DPL, v.id);
    ok(!recap(DPL) || !/version de l’exercice figée/.test(recap(DPL).text), 'une fois validée, plus de ligne');
  });
};
