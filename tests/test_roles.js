const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nRôles par niveau (0.15.3) : WBS par niveau, responsable principal, DPL créateur, migration');

  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', CONTRIB = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const person = (w, name) => w.c.repoInsert('Resource', { resource_type: 'Interne', name, email: name.toLowerCase() + '@entreprise.com', country: 'FR' }, w.S);
  const login = (name) => name.toLowerCase() + '@entreprise.com';
  const assign = (w, who, role, type, id, resource) => w.raw(who, 'roles.assign', { values: { resource_id: resource.id, role_code: role, scope_type: type, scope_id: id } });
  const holders = (w, code, type, id) => w.c.repoList('RoleAssignment', (a) => a.role_code === code && a.scope_type === type && a.scope_id === id && (!a.end_date || a.end_date >= w.c.todayStr())).map((a) => w.c.repoGet('Resource', a.resource_id).name);

  /** Une chaîne complète, posée par les niveaux du dessus : Rémi (WPL du WP 1) pose Sam, Sam pose Olga, Olga pose Paul. Zed n'a aucun rôle. */
  function chain() {
    const w = lot2World();
    const sam = person(w, 'Sam'), olga = person(w, 'Olga'), paul = person(w, 'Paul'), zed = person(w, 'Zed');
    ok(assign(w, WPL, 'SWPL', 'workpackage', w.w11.id, sam).ok, 'Rémi pose Sam, Sub-WP leader du sous-WP 1.1');
    ok(assign(w, login('Sam'), 'DO', 'planitem', w.b.id, olga).ok, 'Sam pose Olga, Deliverable owner du livrable « Calcul »');
    ok(assign(w, login('Olga'), 'CONTRIB', 'planitem', w.b.id, paul).ok, 'Olga pose Paul, Contributor du même livrable');
    return Object.assign(w, { sam, olga, paul, zed });
  }

  test('Chaîne de désignation : chaque niveau pose celui du dessous, et le principal suit', () => {
    const w = chain();
    eq(holders(w, 'SWPL', 'workpackage', w.w11.id), ['Sam']);
    eq(w.c.repoGet('WorkPackage', w.w11.id).owner_resource_id, w.sam.id, 'le sous-WP a pour principal son Sub-WP leader');
    eq(holders(w, 'DO', 'planitem', w.b.id), ['Rémi', 'Olga'], 'Rémi (posé à la création) puis Olga');
    eq(w.c.repoGet('PlanItem', w.b.id).owner_resource_id, w.remi.id, 'le principal est le premier titulaire (Rémi)');
    eq(w.raw(login('Olga'), 'roles.assign', { values: { resource_id: w.zed.id, role_code: 'DO', scope_type: 'planitem', scope_id: w.b.id } }).error.code, 'FORBIDDEN', 'un Deliverable owner ne pose pas un Deliverable owner');
    eq(w.raw(login('Paul'), 'roles.assign', { values: { resource_id: w.zed.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: w.b.id } }).error.code, 'FORBIDDEN', 'un Contributor ne pose personne');
    eq(w.raw(login('Sam'), 'roles.assign', { values: { resource_id: w.zed.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: w.a.id } }).error.code, 'FORBIDDEN', 'un Sub-WP leader ne pose rien en dehors de son sous-WP');
    // retirer Rémi : Olga devient le principal ; retirer Olga : plus personne
    const remiDo = w.c.repoList('RoleAssignment').find((a) => a.resource_id === w.remi.id && a.role_code === 'DO' && a.scope_id === w.b.id);
    ok(w.raw(login('Sam'), 'roles.end', { id: remiDo.id }).ok, 'Sam retire le Deliverable owner Rémi');
    eq(w.c.repoGet('PlanItem', w.b.id).owner_resource_id, w.olga.id, 'Olga devient le principal');
    const olgaDo = w.c.repoList('RoleAssignment').find((a) => a.resource_id === w.olga.id && a.role_code === 'DO');
    ok(w.raw(login('Sam'), 'roles.end', { id: olgaDo.id }).ok);
    eq(w.c.repoGet('PlanItem', w.b.id).owner_resource_id, '', 'plus de Deliverable owner : plus de responsable (le constat « sans responsable » le verra)');
    eq(w.raw(login('Paul'), 'roles.end', { id: olgaDo.id }).error.code, 'FORBIDDEN', 'un Contributor ne retire aucun rôle');
  });

  test('Droits sur le WBS, de bout en bout : chaque niveau agit sur son objet et dessous, rien au-dessus', () => {
    const w = chain();
    const upd = (who, kind, id, patch) => w.raw(who, 'wbs.update', { kind, id, patch });
    // Reader (Zed) : rien, mais il lit
    eq(upd(login('Zed'), 'item', w.b.id, { name: 'X' }).error.code, 'FORBIDDEN', 'Reader : rien ne se modifie');
    eq(w.raw(login('Zed'), 'wbs.delete', { kind: 'item', id: w.b.id }).error.code, 'FORBIDDEN');
    eq(w.raw(login('Zed'), 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'X' } }).error.code, 'FORBIDDEN');
    ok(w.raw(login('Zed'), 'wbs.tree', { projectId: w.p1.id }).ok && w.raw(login('Zed'), 'gantt.project', { projectId: w.p1.id }).ok, 'mais il lit le WBS et le planning');
    // Contributor (Paul) : l'avancement seulement
    eq(upd(login('Paul'), 'item', w.b.id, { name: 'X' }).error.code, 'FORBIDDEN', 'Contributor : ne modifie pas');
    ok(w.raw(login('Paul'), 'progress.declare', { planItemId: w.b.id, progressPct: 30, comment: '' }).ok, 'Contributor : déclare l’avancement');
    eq(w.raw(login('Paul'), 'progress.declare', { planItemId: w.a.id, progressPct: 30, comment: '' }).error.code, 'FORBIDDEN', 'pas sur un autre livrable');
    // Deliverable owner (Olga) : son livrable
    ok(upd(login('Olga'), 'item', w.b.id, { name: 'Calcul v2', planned_start: '2026-10-13', planned_finish: '2026-10-22' }).ok, 'Deliverable owner : modifie nom et dates de son livrable');
    eq(upd(login('Olga'), 'item', w.a.id, { name: 'X' }).error.code, 'FORBIDDEN', 'pas celui d’à côté');
    eq(upd(login('Olga'), 'wp', w.w11.id, { name: 'X' }).error.code, 'FORBIDDEN', 'pas son conteneur');
    eq(w.raw(login('Olga'), 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w11.id, values: { name: 'N', planned_start: '2026-10-13', planned_finish: '2026-10-14' } }).error.code, 'FORBIDDEN', 'et ne crée pas de livrable : il n’a pas de rôle sur le conteneur');
    // Sub-WP leader (Sam) : son sous-WP et dedans
    ok(upd(login('Sam'), 'wp', w.w11.id, { name: 'Calcul avancé' }).ok, 'Sub-WP leader : modifie son sous-WP');
    const made = w.raw(login('Sam'), 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w11.id, values: { name: 'Note', planned_start: '2026-10-13', planned_finish: '2026-10-14', owner_resource_id: w.olga.id } });
    ok(made.ok, JSON.stringify(made.error));
    eq(holders(w, 'DO', 'planitem', made.data.id), ['Olga'], 'créer un livrable avec un responsable lui pose le rôle de Deliverable owner');
    eq(w.raw(login('Sam'), 'wbs.delete', { kind: 'item', id: made.data.id }).data.deleted.items, 1, 'il supprime un livrable de son sous-WP');
    eq(w.raw(login('Sam'), 'wbs.delete', { kind: 'wp', id: w.w11.id, cascade: true }).error.code, 'FORBIDDEN', 'mais pas son sous-WP (niveau du dessus)');
    eq(upd(login('Sam'), 'wp', w.w1.id, { name: 'X' }).error.code, 'FORBIDDEN', 'ni le WP au-dessus');
    eq(upd(login('Sam'), 'wp', w.w11.id, { owner_resource_id: w.zed.id }).error.code, 'FORBIDDEN', 'ni se désigner un remplaçant : le Sub-WP leader est désigné par le niveau du dessus');
    // Workpackage leader (Rémi)
    const sub = w.raw(WPL, 'wbs.create', { projectId: w.p1.id, kind: 'wp', parentId: w.w1.id, values: { name: 'Sous-lot', owner_resource_id: w.zed.id } });
    ok(sub.ok, JSON.stringify(sub.error));
    eq(holders(w, 'SWPL', 'workpackage', sub.data.id), ['Zed'], 'créer un sous-WP avec un responsable lui pose le rôle de Sub-WP leader');
    eq(w.raw(WPL, 'wbs.delete', { kind: 'wp', id: sub.data.id }).data.deleted.wps, 1, 'le Workpackage leader supprime un sous-WP');
    eq(w.raw(WPL, 'wbs.delete', { kind: 'wp', id: w.w1.id, cascade: true }).error.code, 'FORBIDDEN', 'pas son propre WP');
    eq(w.raw(WPL, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Autre WP' } }).error.code, 'FORBIDDEN', 'pas de nouveau WP : c’est le niveau du chef de projet');
    eq(upd(WPL, 'wp', w.w2.id, { name: 'X' }).error.code, 'FORBIDDEN', 'pas le WP d’un autre');
    eq(upd(WPL, 'wp', w.w1.id, { owner_resource_id: w.zed.id }).error.code, 'FORBIDDEN', 'pas se désigner un remplaçant');
    // Chef de projet (Carla)
    const wp = w.raw(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Nouveau WP', owner_resource_id: w.paul.id } });
    ok(wp.ok, JSON.stringify(wp.error));
    eq(holders(w, 'WPL', 'workpackage', wp.data.id), ['Paul'], 'le chef de projet crée un WP et son Workpackage leader');
    ok(upd(CP, 'wp', wp.data.id, { owner_resource_id: w.zed.id }).ok, 'et peut le remplacer');
    eq([holders(w, 'WPL', 'workpackage', wp.data.id).join(), w.c.repoGet('WorkPackage', wp.data.id).owner_resource_id === w.zed.id], ['Zed', true], 'l’ancien perd son rôle, le nouveau le reçoit');
    eq(w.raw(CP, 'wbs.delete', { kind: 'wp', id: wp.data.id }).data.deleted.wps, 1, 'il supprime un WP');
    // DPL (Dora) : le projet lui-même
    ok(w.raw(DPL, 'projects.update', { id: w.p1.id, patch: { name: 'Projet 1 bis' } }).ok, 'DPL : modifie son projet');
    eq(w.raw(CP, 'projects.update', { id: w.p1.id, patch: { manager_resource_id: w.zed.id } }).error.code, 'FORBIDDEN', 'un chef de projet ne désigne pas son remplaçant');
    ok(w.raw(DPL, 'projects.update', { id: w.p1.id, patch: { manager_resource_id: w.zed.id } }).ok, 'le DPL, si');
    eq(holders(w, 'CP', 'project', w.p1.id).sort(), ['Carla', 'Zed'].sort().filter((n) => n === 'Zed'), 'Carla a perdu son rôle de chef de projet, Zed l’a reçu');
  });

  test('Création de projet : le DPL qui crée en devient le DPL ; le Program Leader et l’administrateur n’en ont pas besoin', () => {
    const w = lot2World();
    const pl = person(w, 'Pia');
    w.c.repoInsert('RoleAssignment', { resource_id: pl.id, role_code: 'PL', scope_type: 'program', scope_id: w.prog.id }, w.S);
    const made = w.raw(DPL, 'projects.create', { values: { code: 'P3', name: 'Projet 3', program_id: w.prog.id, status: 'Actif', holiday_country: 'FR' } });
    ok(made.ok, JSON.stringify(made.error));
    eq(holders(w, 'DPL', 'project', made.data.id), ['Dora'], 'Dora est posée DPL du projet qu’elle crée');
    ok(w.raw(DPL, 'projects.update', { id: made.data.id, patch: { name: 'Projet 3 bis' } }).ok, 'et peut le modifier tout de suite');
    const byPl = w.raw(login('Pia'), 'projects.create', { values: { code: 'P4', name: 'Projet 4', program_id: w.prog.id, status: 'Actif', holiday_country: 'FR' } });
    ok(byPl.ok);
    eq(holders(w, 'DPL', 'project', byPl.data.id), [], 'le Program Leader n’est posé nulle part : il couvre tout le programme');
    const byAdmin = w.raw(ADMIN, 'projects.create', { values: { code: 'P5', name: 'Projet 5', program_id: w.prog.id, status: 'Actif', holiday_country: 'FR' } });
    eq(holders(w, 'DPL', 'project', byAdmin.data.id), []);
    eq(w.raw(CP, 'projects.create', { values: { code: 'P6', name: 'Projet 6', program_id: w.prog.id } }).error.code, 'FORBIDDEN', 'un chef de projet ne crée pas de projet');
    const viaOverview = w.raw(DPL, 'projects.save', { values: { code: 'P7', name: 'Projet 7', program_id: w.prog.id, manager_resource_id: w.carla.id } });
    ok(viaOverview.ok, JSON.stringify(viaOverview.error));
    eq([holders(w, 'DPL', 'project', viaOverview.data.id), holders(w, 'CP', 'project', viaOverview.data.id)], [['Dora'], ['Carla']], 'depuis la Vue d’ensemble aussi : le créateur DPL, et le chef de projet désigné');
  });

  test('Migration : DPL du programme sur ses projets, RWP en WPL/SWPL, membres en Contributors, responsables en rôles ; additive et relançable', () => {
    const w = lot2World();
    // on repart d'un classeur « d'avant » : seulement des anciens rôles et des responsables
    w.c.repoList('RoleAssignment').forEach((a) => w.c.repoSoftDelete('RoleAssignment', a.id, null, w.S));
    const old = (r, code, type, id, extra) => w.c.repoInsert('RoleAssignment', Object.assign({ resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, extra || {}), w.S);
    old(w.dora, 'DPL', 'program', w.prog.id);
    old(w.remi, 'RWP', 'workpackage', w.w1.id);
    old(w.carla, 'RWP', 'workpackage', w.w11.id);                                   // sur un sous-WP : Sub-WP leader
    old(w.mia, 'MEMBER', 'project', w.p1.id);
    const zed = person(w, 'Zed'); old(zed, 'MEMBER', 'workpackage', w.w2.id);       // membre d'un WP : Contributor de ses livrables
    const gone = person(w, 'Gone'); old(gone, 'RWP', 'workpackage', w.w2.id, { end_date: '2020-01-01' });  // terminé : ignoré
    const bud = person(w, 'Bud'); w.c.repoInsert('BudgetLine', { deliverable_id: w.b.id, resource_id: bud.id, cost_type: 'Forfait', fixed_amount: 100, planned_amount: 100 }, w.S);
    const rolesBefore = w.c.repoList('RoleAssignment').length;
    const sim = w.c.migrerRoles_(true);
    ok(/^Simulation/.test(sim) && w.c.repoList('RoleAssignment').length === rolesBefore, 'la simulation ne compte que : ' + sim);
    const msg = w.c.migrerRoles_(false);
    ok(/^Migration faite/.test(msg), msg);
    const live = (r, code, type, id) => w.c.repoList('RoleAssignment').filter((a) => a.resource_id === r.id && a.role_code === code && a.scope_type === type && a.scope_id === id && (!a.end_date || a.end_date >= w.c.todayStr())).length;
    eq([live(w.dora, 'DPL', 'project', w.p1.id), live(w.dora, 'DPL', 'project', w.p2.id), live(w.dora, 'DPL', 'program', w.prog.id)], [1, 1, 0], 'DPL : posée sur chacun des projets du programme, l’ancienne ligne (programme) est terminée');
    eq([live(w.remi, 'WPL', 'workpackage', w.w1.id), live(w.carla, 'SWPL', 'workpackage', w.w11.id), live(w.remi, 'RWP', 'workpackage', w.w1.id)], [1, 1, 0], 'RWP : Workpackage leader sur un WP, Sub-WP leader sur un sous-WP');
    eq(['a', 'b', 'cc', 'j'].map((k) => live(w.mia, 'CONTRIB', 'planitem', w[k].id)), [1, 1, 1, 1], 'membre du projet : Contributor de chaque livrable et jalon du projet');
    eq([live(zed, 'CONTRIB', 'planitem', w.cc.id), live(zed, 'CONTRIB', 'planitem', w.a.id)], [1, 0], 'membre d’un WP : Contributor de ses livrables seulement');
    eq(live(bud, 'CONTRIB', 'planitem', w.b.id), 1, 'une ligne budgétaire sur un livrable : Contributor de ce livrable');
    eq([live(w.remi, 'DO', 'planitem', w.a.id), live(w.remi, 'DO', 'planitem', w.b.id), live(w.carla, 'DO', 'planitem', w.cc.id), live(w.carla, 'DO', 'planitem', w.j.id)], [1, 1, 1, 1], 'les responsables d’éléments deviennent Deliverable owners');
    eq([live(w.carla, 'WPL', 'workpackage', w.w2.id), live(w.carla, 'CP', 'project', w.p1.id)], [1, 1], 'responsable du WP 2 → Workpackage leader ; chef de projet de la fiche → Chef de projet');
    eq(live(gone, 'WPL', 'workpackage', w.w2.id), 0, 'un rôle déjà terminé n’est pas repris');
    ok(w.c.repoList('RoleAssignment').filter((a) => a.role_code === 'MEMBER' || a.scope_type === 'program' && a.role_code === 'DPL').every((a) => a.end_date && a.end_date < w.c.todayStr()), 'les anciennes lignes sont terminées, pas supprimées');
    // les droits que donnaient les anciens rôles sont retrouvés, par les nouveaux
    ok(w.raw('mia@entreprise.com', 'progress.declare', { planItemId: w.cc.id, progressPct: 10 }).ok, 'Mia (ancien membre) déclare toujours l’avancement');
    ok(w.raw('dora@entreprise.com', 'projects.update', { id: w.p2.id, patch: { name: 'Projet vide bis' } }).ok, 'Dora (ancien DPL du programme) modifie toujours les projets du programme');
    // relançable : rien de plus
    const n = w.c.repoList('RoleAssignment').length;
    const again = w.c.migrerRoles_(false);
    eq(w.c.repoList('RoleAssignment').length, n, 'relancée : aucune ligne de plus (' + again + ')');
    ok(/^Migration faite : 0 DPL posé\(s\) sur des projets, 0 responsable\(s\) de workpackage converti\(s\), 0 Contributor\(s\)/.test(again), 'et le compte rendu le dit');
  });

  test('Migration interrompue puis reprise : un budget d’écritures par lancement, aucune ligne en double, l’ancienne ligne terminée seulement quand tout est posé', () => {
    const w = lot2World();
    w.c.repoList('RoleAssignment').forEach((a) => w.c.repoSoftDelete('RoleAssignment', a.id, null, w.S));
    const old = (r, code, type, id) => w.c.repoInsert('RoleAssignment', { resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, w.S);
    old(w.mia, 'MEMBER', 'project', w.p1.id);                 // 4 livrables ou jalons : quatre Contributors à poser
    old(w.dora, 'DPL', 'program', w.prog.id);                 // deux projets : deux DPL à poser
    const active = (code) => w.c.repoList('RoleAssignment').filter((a) => a.role_code === code && (!a.end_date || a.end_date >= w.c.todayStr()));
    const actx = { actor: 'essai', source: 'migration' };
    const first = w.c.rolesMigrate_(actx, false, { maxWrites: 2 });
    eq([first.partial, w.c.repoList('RoleAssignment').filter((a) => a.role_code === 'CONTRIB' || (a.role_code === 'DPL' && a.scope_type === 'project')).length], [true, 2], 'premier lancement : exactement deux écritures (le budget), et il dit qu’il est partiel');
    ok(active('MEMBER').length === 1 && active('DPL').filter((a) => a.scope_type === 'program').length === 1, 'les anciennes lignes sont encore actives : on ne termine un « membre » qu’une fois tous ses livrables posés');
    let runs = 1, r = first;
    while (r.partial && runs < 40) { r = w.c.rolesMigrate_(actx, false, { maxWrites: 2 }); runs++; }
    ok(!r.partial && runs > 3, 'terminée en ' + runs + ' lancements');
    const keys = w.c.repoList('RoleAssignment').filter((a) => !a.end_date || a.end_date >= w.c.todayStr()).map((a) => [a.resource_id, a.role_code, a.scope_type, a.scope_id].join('|'));
    eq(new Set(keys).size, keys.length, 'aucune ligne en double après les reprises');
    eq([active('MEMBER').length, active('DPL').filter((a) => a.scope_type === 'program').length], [0, 0], 'anciennes lignes terminées');
    eq(['a', 'b', 'cc', 'j'].filter((k) => w.c.repoList('RoleAssignment').some((x) => x.resource_id === w.mia.id && x.role_code === 'CONTRIB' && x.scope_id === w[k].id && (!x.end_date || x.end_date >= w.c.todayStr()))).length, 4, 'les quatre Contributors de Mia');
    const same = w.c.rolesMigrate_(actx, false);
    eq([same.dpl, same.contrib, same.owners, same.ended, same.partial], [0, 0, 0, 0, false], 'relancée : plus rien à faire');
  });

  test('Avant la migration, les anciens codes gardent leurs droits ; on ne peut plus en poser', () => {
    const w = lot2World();
    w.c.repoList('RoleAssignment', (a) => a.resource_id === w.mia.id).forEach((a) => w.c.repoSoftDelete('RoleAssignment', a.id, null, w.S));
    w.c.repoInsert('RoleAssignment', { resource_id: w.mia.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id }, w.S);
    ok(w.raw(CONTRIB, 'progress.declare', { planItemId: w.cc.id, progressPct: 5 }).ok, 'ancien membre = Contributor');
    eq(w.raw(CONTRIB, 'wbs.update', { kind: 'item', id: w.cc.id, patch: { name: 'X' } }).error.code, 'FORBIDDEN', 'sans pouvoir modifier');
    eq(w.raw(CP, 'roles.assign', { values: { resource_id: w.mia.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id } }).error.code, 'VALIDATION', 'on ne pose plus d’ancien rôle');
    eq(w.raw(CP, 'roles.assign', { values: { resource_id: w.mia.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: w.w2.id } }).error.code, 'VALIDATION');
  });

  test('Panneau des rôles d’un objet (roles.of) : les rôles qui s’y posent, leurs titulaires, ce que l’appelant peut poser ou retirer', () => {
    const w = chain();
    const of = (who, type, id) => w.call(who, 'roles.of', { scopeType: type, scopeId: id });
    const codes = (v) => v.roles.map((r) => r.code);
    eq([codes(of(CP, 'project', w.p1.id)), codes(of(CP, 'workpackage', w.w1.id)), codes(of(CP, 'workpackage', w.w11.id)), codes(of(CP, 'planitem', w.b.id))],
      [['DPL', 'CP'], ['WPL'], ['SWPL'], ['DO', 'CONTRIB']], 'chaque objet ne propose que ses rôles : pas de Deliverable owner sur un workpackage, pas de chef de projet sur un livrable');
    eq(codes(of(CP, 'program', w.prog.id)), ['PL']);
    const b = of(CP, 'planitem', w.b.id);
    eq(b.roles.map((r) => r.code + ':' + r.holders.map((h) => h.name).join('+')), ['DO:Rémi+Olga', 'CONTRIB:Mia+Paul'], 'les titulaires, dans l’ordre où ils ont été posés (Mia est la Contributor posée par la fixture, puis Paul)');
    eq(b.roles[0].holders.map((h) => h.principal), [true, false], 'le premier Deliverable owner est le principal');
    ok(b.roles.every((r) => r.canAssign && r.holders.every((h) => h.canEnd)) && b.people.length >= 6, 'le chef de projet peut tout poser et retirer, et reçoit la liste des personnes');
    // un niveau voit ce qu'il peut faire, pas plus
    const asDo = of(login('Olga'), 'planitem', w.b.id);
    eq(asDo.roles.map((r) => [r.code, r.canAssign]), [['DO', false], ['CONTRIB', true]], 'un Deliverable owner pose des Contributors, pas un Deliverable owner');
    eq(asDo.roles[0].holders.every((h) => !h.canEnd) && asDo.roles[1].holders.every((h) => h.canEnd), true, 'et ne retire que ceux d’en dessous');
    const asReader = of(login('Zed'), 'planitem', w.b.id);
    eq([asReader.roles.every((r) => !r.canAssign && r.holders.every((h) => !h.canEnd)), asReader.people], [true, []], 'un Reader lit les titulaires, ne peut rien poser et ne reçoit pas la liste des personnes');
    eq(w.raw(CP, 'roles.of', { scopeType: 'planitem', scopeId: 'inconnu' }).error.code, 'NOT_FOUND');
    eq(w.raw(CP, 'roles.of', { scopeType: 'risque', scopeId: w.b.id }).error.code, 'VALIDATION');
    // un ancien code se lit sous son nouveau nom
    w.c.repoInsert('RoleAssignment', { resource_id: w.zed.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: w.w2.id }, w.S);
    eq(of(CP, 'workpackage', w.w2.id).roles[0].holders.map((h) => h.name).sort(), ['Carla', 'Zed'], 'un ancien responsable de workpackage apparaît comme Workpackage leader, avant la migration');
  });

  test('Lecture : tout est ouvert à tous, sauf l’exercice budgétaire et les comptes rendus (à partir du Workpackage leader) et budgets (sur son périmètre)', () => {
    const w = chain();
    const team = w.call(CP, 'teams.create', { values: { name: 'T1A' } }), ex = w.call(ADMIN, 'exercise.create', { year: 2027 });
    const exGet = (who) => w.raw(who, 'exercise.get', { projectId: w.p1.id, exerciseId: ex.id });
    const line = (item, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, resource_id: w.xavier.id, fixed_amount: amount } });
    line(w.a, 1000); line(w.cc, 2000);       // un livrable dans le WP de Rémi, un dans le WP 2
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue', held_on: w.c.todayStr(), text: 'Décision : le plan est validé.' });
    // ouverts à tous : le WBS, le planning, la liste des personnes
    ['Zed', 'Paul', 'Olga', 'Sam'].forEach((n) => ['gantt.project', 'wbs.tree', 'ressources.get'].forEach((a) => ok(w.raw(login(n), a, { projectId: w.p1.id }).ok, n + ' lit : ' + a)));
    // exercice budgétaire, comptes rendus : Workpackage leader et au-dessus
    [['Zed', 'Reader'], ['Paul', 'Contributor'], ['Olga', 'Deliverable owner'], ['Sam', 'Sub-WP leader']].forEach(([n, lvl]) => {
      eq(exGet(login(n)).error.code, 'FORBIDDEN', lvl + ' : ne voit pas l’exercice budgétaire');
      ok(!JSON.stringify(w.call(login(n), 'ressources.get', { projectId: w.p1.id })).match(/daily_rate|rate_source/), lvl + ' : plus aucun taux nulle part');
      eq(w.raw(login(n), 'news.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN', lvl + ' : ne lit pas les comptes rendus');
      eq(w.call(login(n), 'news.summary', { projectId: w.p1.id }), { visible: false }, lvl + ' : pas de résumé des comptes rendus');
      eq(w.raw(login(n), 'budget.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN', lvl + ' : pas de budget');
    });
    ok(exGet(WPL).ok, 'Workpackage leader : voit l’exercice budgétaire, au global du projet');
    eq(w.call(WPL, 'news.get', { projectId: w.p1.id }).access.view, true, 'et lit les comptes rendus du projet');
    ok(exGet(CP).ok, 'chef de projet : aussi');
    // le budget : un Workpackage leader ne voit que celui de son WP, le chef de projet tout
    const remiBudget = w.call(WPL, 'budget.get', { projectId: w.p1.id });
    eq([remiBudget.partial, remiBudget.lines.map((l) => l.deliverable_id)], [true, [w.a.id]], 'Rémi : son workpackage seulement (le livrable du WP 2 n’apparaît pas)');
    const carlaBudget = w.call(CP, 'budget.get', { projectId: w.p1.id });
    eq([carlaBudget.partial, carlaBudget.lines.map((l) => l.deliverable_id).sort()], [false, [w.a.id, w.cc.id].sort()], 'le chef de projet voit tout');
    // saisir l'exercice reste au chef de projet
    eq(w.raw(WPL, 'exercise.set', { projectId: w.p1.id, exerciseId: ex.id, teamId: team.id, expected: 1000 }).error.code, 'FORBIDDEN', 'lire n’est pas saisir : le Workpackage leader ne modifie pas le budget d’une équipe');
    ok(w.raw(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: ex.id, teamId: team.id, expected: 1000 }).ok, 'le chef de projet, si');
    // la synthèse par mail ne part qu'à ceux qui peuvent lire les comptes rendus
    w.c.SENT_MAILS.length = 0;
    const pub = w.call(CP, 'news.digest.publish', { projectId: w.p1.id, text: 'Décisions : plan validé.\nDates qui bougent : rien.\nRisques : aucun.\nBlocages : aucun.\nActions : voir la liste.' });
    eq(w.c.SENT_MAILS.map((m) => m.to).sort(), [CP, DPL, WPL].sort(), 'chef de projet, DPL, Workpackage leader : pas Mia, Sam, Olga ni Paul');
    eq(pub.notified, 3);
  });
};
