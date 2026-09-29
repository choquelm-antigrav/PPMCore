const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nCréation et édition du WBS (0.7.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';
  // Rappel du jeu : WP 1 Conception (Rémi, RWP) ⊃ 1.1 Calcul ; WP 2 Essais ; éléments A, B (dans 1.1), C (dans 2), J (jalon sans WP) ; A→B→C→J.

  const create = (w, who, params) => w.raw(who, 'wbs.create', Object.assign({ projectId: w.p1.id }, params));
  const wp = (w, values, parentId, who) => w.call(who || CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', parentId: parentId || '', values });
  const codes = (w) => w.c.repoList('WorkPackage', (x) => x.project_id === w.p1.id).map((x) => x.wbs_code).sort();

  test('Workpackages : codes numérotés automatiquement, deux niveaux, jamais de doublon', () => {
    const w = lot2World();
    const a = wp(w, { name: '  Industrialisation  ' });
    eq([a.kind, a.record.name, a.record.wbs_code, a.record.parent_wp_id], ['wp', 'Industrialisation', '3', '']);
    eq(wp(w, { name: 'Qualité' }).record.wbs_code, '4');
    eq([wp(w, { name: 'Essais statiques' }, w.w2.id).record.wbs_code, wp(w, { name: 'Essais dynamiques' }, w.w2.id).record.wbs_code], ['2.1', '2.2']);
    eq(wp(w, { name: 'Calcul fin' }, w.w1.id).record.wbs_code, '1.2', 'après 1.1, le suivant est 1.2');
    eq([wp(w, { name: 'Imposé', wbs_code: '9' }).record.wbs_code, wp(w, { name: 'Suite' }).record.wbs_code], ['9', '10'], 'un code imposé décale la suite');
    eq(codes(w).length, new Set(codes(w)).size, 'aucun code en double');
    ok(/déjà utilisé/.test(create(w, CP, { kind: 'wp', values: { name: 'Doublon', wbs_code: '3' } }).error.message));
    ok(/deux niveaux/.test(create(w, CP, { kind: 'wp', parentId: w.w11.id, values: { name: 'Trop profond' } }).error.message));
    const other = w.call(ADMIN, 'workpackages.create', { values: { project_id: w.p2.id, name: 'Ailleurs', wbs_code: '1' } });
    ok(/autre projet/.test(create(w, CP, { kind: 'wp', parentId: other.id, values: { name: 'Mal rangé' } }).error.message));
    eq(create(w, CP, { kind: 'wp', values: { name: '   ' } }).error.code, 'VALIDATION');
    eq(create(w, CP, { kind: 'wp', values: { name: 'x'.repeat(121) } }).error.code, 'VALIDATION');
    ok(/Responsable introuvable/.test(create(w, CP, { kind: 'wp', values: { name: 'Sans chef', owner_resource_id: 'inconnu' } }).error.message));
    eq(create(w, CP, { kind: 'machin', values: { name: 'x' } }).error.code, 'VALIDATION');
    const withOwner = wp(w, { name: 'Avec chef', owner_resource_id: w.mia.id, charge_code: ' PIL-9 ' });
    eq([withOwner.record.owner_resource_id, withOwner.record.charge_code], [w.mia.id, 'PIL-9']);
  });

  test('Droits : chacun n’agit que dans son périmètre, y compris pour le rattachement', () => {
    const w = lot2World();
    eq(wp(w, { name: 'Sous-calcul' }, w.w1.id, RWP).record.wbs_code, '1.2', 'Rémi, RWP du WP 1, ajoute dans son WP');
    eq(create(w, RWP, { kind: 'wp', parentId: w.w2.id, values: { name: 'Chez un autre' } }).error.code, 'FORBIDDEN');
    eq(create(w, RWP, { kind: 'wp', values: { name: 'Premier niveau' } }).error.code, 'FORBIDDEN', 'créer un WP de premier niveau demande le pilotage du projet');
    ok(w.call(RWP, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w11.id, values: { name: 'Note' } }).ok !== false, 'livrable dans un sous-WP de son WP');
    eq(create(w, RWP, { kind: 'Livrable', parentId: '', values: { name: 'À la racine' } }).error.code, 'FORBIDDEN');
    eq(create(w, RWP, { kind: 'Jalon', parentId: w.w2.id, values: { name: 'Ailleurs', planned_finish: '2026-12-01' } }).error.code, 'FORBIDDEN');
    ['wp', 'Livrable', 'Jalon'].forEach((k) => eq(create(w, MEMBER, { kind: k, parentId: w.w1.id, values: { name: 'x' } }).error.code, 'FORBIDDEN', 'un membre ne crée rien : ' + k));
    ok(w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Admin' } }).kind === 'wp');
  });

  test('Livrables et jalons : dates contrôlées, un jalon n’a qu’une date, catégories', () => {
    const w = lot2World();
    const item = (kind, values, parentId) => w.call(CP, 'wbs.create', { projectId: w.p1.id, kind, parentId: parentId || '', values });
    const l = item('Livrable', { name: ' Rapport ', planned_start: '2026-11-09', planned_finish: '2026-11-20', owner_resource_id: w.mia.id }, w.w2.id).record;
    eq([l.item_type, l.name, l.wp_id, l.planned_start, l.planned_finish, l.status, l.progress_pct, l.owner_resource_id],
      ['Livrable', 'Rapport', w.w2.id, '2026-11-09', '2026-11-20', 'À faire', 0, w.mia.id]);
    const undated = item('Livrable', { name: 'Sans date' }).record;
    eq([undated.planned_start, undated.planned_finish, undated.wp_id], ['', '', ''], 'sans date, sans WP : rattaché au projet');
    ok(/ne peut pas précéder/.test(create(w, CP, { kind: 'Livrable', values: { name: 'x', planned_start: '2026-11-20', planned_finish: '2026-11-09' } }).error.message));
    ok(/date invalide/.test(create(w, CP, { kind: 'Livrable', values: { name: 'x', planned_start: '2026-02-30' } }).error.message));
    ok(/date invalide/.test(create(w, CP, { kind: 'Livrable', values: { name: 'x', planned_finish: 'demain' } }).error.message));
    const m = item('Jalon', { name: 'Revue préliminaire', planned_finish: '2026-12-01', milestone_category: 'Revue' }).record;
    eq([m.item_type, m.planned_start, m.planned_finish, m.milestone_category], ['Jalon', '2026-12-01', '2026-12-01', 'Revue']);
    eq(item('Jalon', { name: 'Début seul', planned_start: '2026-12-03' }).record.planned_finish, '2026-12-03', 'une seule date suffit');
    eq(item('Jalon', { name: 'Deux dates', planned_start: '2026-12-01', planned_finish: '2026-12-05' }).record.planned_start, '2026-12-05', 'la date du jalon est sa fin');
    ok(/Catégorie/.test(create(w, CP, { kind: 'Jalon', values: { name: 'x', milestone_category: 'Autre' } }).error.message));
    ok(/Catégorie/.test(create(w, CP, { kind: 'Livrable', values: { name: 'x', milestone_category: 'Revue' } }).error.message), 'une catégorie n’a de sens que pour un jalon');
    const foreign = w.call(ADMIN, 'workpackages.create', { values: { project_id: w.p2.id, name: 'Ailleurs', wbs_code: '1' } });
    ok(/autre projet/.test(create(w, CP, { kind: 'Livrable', parentId: foreign.id, values: { name: 'x' } }).error.message));
  });

  test('Modification : nom, responsable, dates, version ; les champs protégés ne bougent pas', () => {
    const w = lot2World();
    const u = w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { name: ' Essais en vol ', owner_resource_id: w.remi.id, charge_code: 'C-2' } });
    eq([u.record.name, u.record.owner_resource_id, u.record.charge_code], ['Essais en vol', w.remi.id, 'C-2']);
    eq(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, version: 1, patch: { name: 'Périmé' } }).error.code, 'CONFLICT');
    eq(w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, version: u.record.version, patch: { owner_resource_id: '' } }).record.owner_resource_id, '', 'on peut retirer le responsable');
    eq(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { wbs_code: '1' } }).error.code, 'VALIDATION', 'code déjà pris');
    const i = w.call(CP, 'wbs.update', { kind: 'item', id: w.cc.id, patch: { planned_start: '2026-10-27', planned_finish: '2026-11-13', item_type: 'Jalon', project_id: w.p2.id, status: 'Terminé', progress_pct: 100 } });
    eq([i.record.planned_start, i.record.planned_finish, i.record.item_type, i.record.project_id, i.record.status, i.record.progress_pct], ['2026-10-27', '2026-11-13', 'Livrable', w.p1.id, 'À faire', 0], 'type, projet, statut et avancement ne se modifient pas ici');
    eq(w.raw(CP, 'wbs.update', { kind: 'item', id: w.cc.id, patch: { planned_start: '2026-11-20' } }).error.code, 'VALIDATION', 'le début ne dépasse pas la fin existante');
    const jal = w.call(CP, 'wbs.update', { kind: 'item', id: w.j.id, patch: { planned_finish: '2026-11-16' } }).record;
    eq([jal.planned_start, jal.planned_finish], ['2026-11-16', '2026-11-16'], 'le jalon garde une seule date');
    eq(w.call(CP, 'wbs.update', { kind: 'item', id: w.j.id, patch: { milestone_category: 'Client' } }).record.milestone_category, 'Client');
    eq(w.raw(RWP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { name: 'Pas le mien' } }).error.code, 'FORBIDDEN');
    eq(w.raw(MEMBER, 'wbs.update', { kind: 'item', id: w.a.id, patch: { name: 'Non' } }).error.code, 'FORBIDDEN');
    ok(w.call(RWP, 'wbs.update', { kind: 'item', id: w.b.id, patch: { name: 'Calcul détaillé' } }).record.name === 'Calcul détaillé', 'Rémi modifie un élément de son WP');
  });

  test('Déplacements : renumérotation, deux niveaux, destination contrôlée', () => {
    const w = lot2World();
    const move = (who, id, parent, extra) => w.raw(who, 'wbs.update', { kind: 'wp', id, patch: Object.assign({ parent_wp_id: parent }, extra || {}) });
    ok(/sous-workpackages/.test(move(CP, w.w1.id, w.w2.id).error.message), 'un WP qui a des enfants ne devient pas un sous-niveau');
    ok(/propre parent/.test(move(CP, w.w1.id, w.w1.id).error.message));
    const under = move(CP, w.w2.id, w.w1.id);
    ok(under.ok, JSON.stringify(under.error));
    eq([under.data.record.parent_wp_id, under.data.record.wbs_code], [w.w1.id, '1.2'], 'sous le WP 1, le code suit : 1.2');
    ok(/deux niveaux/.test(move(CP, w.w2.id, w.w11.id).error.message), 'pas sous un sous-WP');
    const back = move(CP, w.w2.id, '');
    eq([back.data.record.parent_wp_id, back.data.record.wbs_code], ['', '2'], 'retour au premier niveau, renuméroté');
    eq(move(CP, w.w2.id, w.w1.id, { wbs_code: '7.7' }).data.record.wbs_code, '7.7', 'un code imposé est respecté');
    // éléments
    const it = w.call(CP, 'wbs.update', { kind: 'item', id: w.j.id, patch: { wp_id: w.w2.id } }).record;
    eq(it.wp_id, w.w2.id, 'le jalon sans WP est rattaché à un WP');
    eq(w.call(CP, 'wbs.update', { kind: 'item', id: w.j.id, patch: { wp_id: '' } }).record.wp_id, '', 'et peut revenir à la racine du projet');
    const foreign = w.call(ADMIN, 'workpackages.create', { values: { project_id: w.p2.id, name: 'Ailleurs', wbs_code: '1' } });
    ok(/autre projet/.test(w.raw(CP, 'wbs.update', { kind: 'item', id: w.a.id, patch: { wp_id: foreign.id } }).error.message));
    // Rémi peut modifier un élément de son WP, mais pas l'envoyer chez un autre
    const w2 = lot2World();
    eq(w2.raw(RWP, 'wbs.update', { kind: 'item', id: w2.b.id, patch: { wp_id: w2.w2.id } }).error.code, 'FORBIDDEN', 'destination hors de son périmètre');
    ok(w2.raw(RWP, 'wbs.update', { kind: 'item', id: w2.b.id, patch: { wp_id: w2.w1.id } }).ok, 'destination dans son périmètre');
  });

  test('Suppression d’un élément : ses dépendances et exigences de jalon partent avec lui', () => {
    const w = lot2World();
    const k = w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'Jalon', values: { name: 'Revue qualité', planned_finish: '2026-11-20' } }).record;
    w.c.repoInsert('MilestoneRequirement', { milestone_id: k.id, deliverable_id: w.cc.id }, w.S);
    const live = () => ({ deps: w.c.repoList('Dependency').length, reqs: w.c.repoList('MilestoneRequirement').length });
    eq(live(), { deps: 3, reqs: 1 });
    const r = w.call(CP, 'wbs.delete', { kind: 'item', id: w.b.id });
    eq(r.deleted, { wps: 0, items: 1, dependencies: 2, requirements: 0 }, 'B avait deux dépendances (A→B et B→C)');
    eq(live(), { deps: 1, reqs: 1 });
    const r2 = w.call(CP, 'wbs.delete', { kind: 'item', id: w.cc.id });
    eq([r2.deleted.dependencies, r2.deleted.requirements], [1, 1], 'C : la dépendance C→J et l’exigence du jalon');
    eq(live(), { deps: 0, reqs: 0 });
    const tree = w.call(CP, 'wbs.tree', { projectId: w.p1.id }).nodes;
    ok(!tree.some((n) => n.ref === w.b.id || n.ref === w.cc.id), 'les éléments supprimés ne sont plus dans l’arbre');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'PlanItem' && e.entity_id === w.b.id && e.field === 'deleted'), 'suppression tracée dans le journal');
    eq(w.raw(MEMBER, 'wbs.delete', { kind: 'item', id: w.a.id }).error.code, 'FORBIDDEN');
    eq(w.raw(CP, 'wbs.delete', { kind: 'item', id: w.a.id, version: 99 }).error.code, 'CONFLICT');
  });

  test('Suppression d’un workpackage : refus s’il n’est pas vide, sinon cascade explicite sans orphelin', () => {
    const w = lot2World();
    const refused = w.raw(CP, 'wbs.delete', { kind: 'wp', id: w.w1.id });
    eq([refused.error.code, refused.error.details], ['VALIDATION', { rule: 'NOT_EMPTY', wps: 1, items: 2 }]);
    ok(/1 sous-workpackage\(s\) et 2 élément\(s\)/.test(refused.error.message), refused.error.message);
    eq(w.c.repoList('WorkPackage').length, 3, 'rien n’a été supprimé');
    eq(w.raw(RWP, 'wbs.delete', { kind: 'wp', id: w.w2.id, cascade: true }).error.code, 'FORBIDDEN', 'pas dans le WP d’un autre');
    eq(w.raw(MEMBER, 'wbs.delete', { kind: 'wp', id: w.w1.id, cascade: true }).error.code, 'FORBIDDEN');
    const r = w.call(RWP, 'wbs.delete', { kind: 'wp', id: w.w1.id, cascade: true });
    eq(r.deleted, { wps: 2, items: 2, dependencies: 2, requirements: 0 }, 'Rémi supprime son WP avec son contenu : A→B et B→C partent, C→J reste');
    eq(w.c.repoList('Dependency').length, 1);
    const tree = w.call(CP, 'wbs.tree', { projectId: w.p1.id }).nodes;
    const ids = new Set(tree.map((n) => n.id));
    ok(tree.every((n) => !n.parent || ids.has(n.parent)), 'aucun nœud orphelin');
    eq(tree.map((n) => n.kind + ':' + n.name).sort(), ['item:Essais', 'item:Revue', 'project:Projet 1', 'wp:Essais'], 'reste le WP 2, ses éléments et le jalon');
    // un WP vide se supprime sans cascade
    const empty = w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Vide' } });
    eq(w.call(CP, 'wbs.delete', { kind: 'wp', id: empty.id }).deleted.wps, 1);
    eq(w.raw(CP, 'wbs.delete', { kind: 'wp', id: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Arbre du WBS : identifiants, versions, dépendances et droits de modification par carte', () => {
    const w = lot2World();
    const cp = w.call(CP, 'wbs.tree', { projectId: w.p1.id });
    const by = (t, ref) => t.nodes.find((n) => n.ref === ref);
    eq([cp.canCreate, cp.nodes.every((n) => n.canEdit)], [true, true]);
    const wp2 = by(cp, w.w2.id), b = by(cp, w.b.id);
    eq([wp2.kind, wp2.owner_id, wp2.parent_ref, wp2.version >= 1], ['wp', w.carla.id, '', true]);
    eq([by(cp, w.w11.id).parent_ref, b.wp_ref, b.raw_start, b.raw_finish, b.dep_count, by(cp, w.a.id).dep_count, by(cp, w.j.id).dep_count], [w.w1.id, w.w11.id, '2026-10-12', '2026-10-23', 2, 1, 1]);
    const rwp = w.call(RWP, 'wbs.tree', { projectId: w.p1.id });
    eq([rwp.canCreate, rwp.nodes.filter((n) => n.canEdit).map((n) => n.name).sort()], [false, ['Calcul', 'Calcul', 'Conception', 'Spécification']], 'Rémi : son WP, son sous-WP et leurs éléments');
    const mia = w.call(MEMBER, 'wbs.tree', { projectId: w.p1.id });
    eq([mia.canCreate, mia.nodes.some((n) => n.canEdit)], [false, false], 'un membre ne voit aucun bouton');
  });
};
