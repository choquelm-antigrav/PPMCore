const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nTableau des droits de la page Administration (0.15.4)');
  const ADMIN = 'admin@entreprise.com', CP = 'carla@entreprise.com';

  test('Réservé à l’administrateur du site', () => {
    const w = lot2World();
    eq(w.raw(CP, 'admin.rights', {}).error.code, 'FORBIDDEN', 'un chef de projet ne le voit pas');
    eq(w.raw('dora@entreprise.com', 'admin.rights', {}).error.code, 'FORBIDDEN', 'ni un DPL');
    const t = w.call(ADMIN, 'admin.rights', {});
    eq(t.roles.map((r) => r.code), ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB', 'READER'], 'huit niveaux, du plus haut au Reader');
    eq(t.roles.map((r) => r.rank), [0, 1, 2, 3, 4, 5, 6, 7]);
    ok(t.rules.length >= 6 && t.groups.length >= 8, t.groups.length + ' groupes, ' + t.rules.length + ' règles');
  });

  test('Aucun droit oublié : tout droit de PERMISSION_LEVEL est décrit ou écarté avec sa raison', () => {
    const c = lot2World().c;
    const shown = {}; c.RIGHTS_ROWS.forEach((r) => { if (r.perm) shown[r.perm] = true; });
    const missing = Object.keys(c.PERMISSION_LEVEL).filter((k) => !shown[k] && !c.RIGHTS_NOT_LISTED[k]);
    eq(missing, [], 'un droit ajouté sans ligne dans le tableau (57_Rights.gs) fait échouer ce test');
    const unknown = c.RIGHTS_ROWS.filter((r) => r.perm && !(r.perm in c.PERMISSION_LEVEL)).map((r) => r.perm);
    eq(unknown, [], 'et aucune ligne ne décrit un droit qui n’existe plus');
    ok(Object.keys(c.RIGHTS_NOT_LISTED).every((k) => k in c.PERMISSION_LEVEL), 'les exclusions visent des droits qui existent');
  });

  test('Chaque case du tableau est celle que can() donne vraiment', () => {
    const w = lot2World(), c = w.c, t = w.call(ADMIN, 'admin.rights', {});
    const lookup = c.repoLookup_();
    const place = { PL: ['program', w.prog.id], DPL: ['project', w.p1.id], CP: ['project', w.p1.id], WPL: ['workpackage', w.w1.id], SWPL: ['workpackage', w.w11.id], DO: ['planitem', w.b.id], CONTRIB: ['planitem', w.b.id] };
    const ctxOf = (role) => ({ resourceId: 'x', email: 'x@entreprise.com', isAdmin: false, lookup, assignments: [{ resource_id: 'x', role_code: role, scope_type: place[role][0], scope_id: place[role][1] }] });
    const objectOfKind = { program: { type: 'program', id: w.prog.id }, project: { type: 'project', id: w.p1.id }, workpackage: { type: 'workpackage', id: w.w1.id }, subworkpackage: { type: 'workpackage', id: w.w11.id }, planitem: { type: 'planitem', id: w.b.id } };
    const projectScope = { type: 'project', id: w.p1.id };
    let checked = 0; const wrong = [];
    t.groups.forEach((g) => g.rows.forEach((row) => {
      if (!row.perm || row.role) return;                       // les lignes « poser un rôle » ont leur propre vérification
      ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB'].forEach((role) => {
        let scope;
        if (row.kind) scope = objectOfKind[row.kind];
        else if (row.perm === 'program.create' || row.perm === 'project.create') scope = { type: 'global' };
        else if (row.deep || ['PL', 'DPL', 'CP'].indexOf(role) >= 0) scope = projectScope;
        else scope = { type: place[role][0], id: place[role][1] };
        const actual = c.can(ctxOf(role), row.perm, scope);
        checked++;
        if (actual !== row.levels[role]) wrong.push(row.label + ' | ' + role + ' : tableau ' + row.levels[role] + ', can() ' + actual);
      });
    }));
    eq(wrong, [], 'cases en désaccord avec can()');
    ok(checked > 150, checked + ' cases vérifiées contre can()');
    // le Reader n'a aucun droit d'écriture ; seule la ligne « lire » est pour tout le monde
    const readerYes = [];
    t.groups.forEach((g) => g.rows.forEach((row) => { if (row.levels.READER) readerYes.push(row.label); }));
    eq(readerYes.length, 1, 'une seule ligne est ouverte au Reader : ' + readerYes.join(' ; '));
    eq(c.can({ resourceId: '', isAdmin: false, lookup, assignments: [] }, 'progress.declare', projectScope), false, 'et can() le refuse bien à qui n’a aucun rôle');
  });

  test('Poser un rôle : chaque ligne suit roleAssignError_ ; le Program Leader n’est désigné que par l’administrateur', () => {
    const w = lot2World(), c = w.c, t = w.call(ADMIN, 'admin.rights', {});
    const lookup = c.repoLookup_();
    const place = { PL: ['program', w.prog.id], DPL: ['project', w.p1.id], CP: ['project', w.p1.id], WPL: ['workpackage', w.w1.id], SWPL: ['workpackage', w.w11.id], DO: ['planitem', w.b.id], CONTRIB: ['planitem', w.b.id] };
    const target = { PL: { type: 'program', id: w.prog.id }, DPL: { type: 'project', id: w.p1.id }, CP: { type: 'project', id: w.p1.id }, WPL: { type: 'workpackage', id: w.w1.id }, SWPL: { type: 'workpackage', id: w.w11.id }, DO: { type: 'planitem', id: w.b.id }, CONTRIB: { type: 'planitem', id: w.b.id } };
    const rows = t.groups.find((g) => g.title === 'Poser un rôle').rows;
    eq(rows.map((r) => r.role), ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'CONTRIB'], 'une ligne par rôle posable');
    const wrong = [];
    rows.forEach((row) => Object.keys(place).forEach((actor) => {
      const ctx = { resourceId: 'x', email: 'x@entreprise.com', isAdmin: false, lookup, assignments: [{ resource_id: 'x', role_code: actor, scope_type: place[actor][0], scope_id: place[actor][1] }] };
      const actual = c.assignableRolesOn_(ctx, target[row.role]).indexOf(row.role) >= 0;
      if (actual !== row.levels[actor]) wrong.push('poser ' + row.role + ' par ' + actor + ' : tableau ' + row.levels[actor] + ', serveur ' + actual);
    }));
    eq(wrong, [], 'cases en désaccord avec le serveur');
    eq(Object.keys(rows[0].levels).filter((k) => rows[0].levels[k]), [], 'personne ne pose le Program Leader : l’administrateur seul');
    ok(/administrateur/.test(rows[0].where), 'et la ligne le dit');
  });

  test('Les lignes WBS viennent de la même table que le moteur (WBS_RANK) : un livrable se supprime depuis son Deliverable owner, un projet depuis le DPL', () => {
    const w = lot2World(), t = w.call(ADMIN, 'admin.rights', {});
    const row = (title, re) => t.groups.find((g) => g.title === title).rows.find((r) => re.test(r.label));
    const who = (r) => Object.keys(r.levels).filter((k) => r.levels[k]);
    eq(who(row('Suppression', /un projet/)), ['PL', 'DPL'], 'supprimer un projet : DPL et au-dessus');
    eq(who(row('Suppression', /un workpackage/)), ['PL', 'DPL', 'CP'], 'supprimer un workpackage : chef de projet et au-dessus');
    eq(who(row('Suppression', /un livrable ou un jalon/)), ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO'], 'supprimer un livrable : son Deliverable owner aussi');
    eq(who(row('Structure du projet (WBS)', /Modifier un projet/)), ['PL', 'DPL', 'CP'], 'modifier un projet : chef de projet et au-dessus');
    eq(who(row('Structure du projet (WBS)', /Modifier un livrable/)), ['PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO'], 'modifier un livrable : jusqu’au Deliverable owner');
    eq(who(row('Lire', /tarifs journaliers/)), ['PL', 'DPL', 'CP', 'WPL'], 'les tarifs et comptes rendus se lisent à partir du Workpackage leader');
    eq(who(row('Planning et avancement', /Figer une baseline sur un projet/)), ['PL', 'DPL', 'CP'], 'figer une baseline du projet : chef de projet et au-dessus');
    eq(who(row('Planning et avancement', /Figer une baseline sur un workpackage/)), ['PL', 'DPL', 'CP', 'WPL'], 'figer celle d’un workpackage : jusqu’au Workpackage leader');
    eq(who(row('Planning et avancement', /Figer une baseline sur un sous-workpackage/)), ['PL', 'DPL', 'CP', 'WPL', 'SWPL'], 'celle d’un sous-workpackage : jusqu’au Sub-workpackage leader');
    ok(!t.groups.some((g) => g.rows.some((r) => /Figer une baseline sur un livrable/.test(r.label))), 'jamais sur un livrable ou un jalon');
    ok(row('Lire', /tarifs journaliers/).deep && /en profondeur/.test(row('Lire', /tarifs journaliers/).where), 'et la ligne dit que c’est « en profondeur »');
  });
};
