const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBaselines par périmètre : projet, workpackage, sous-workpackage, en parallèle (0.15.5)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', WPL = 'remi@entreprise.com', SWPL = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  // WP 1 (Rémi, WPL) ⊃ 1.1 (Mia, SWPL) ; WP 2 (Carla) ; A (WP 1), B (1.1), C (WP 2) ; Zed : Contributor seulement
  function world() {
    const w = lot2World();
    w.call(CP, 'roles.assign', { values: { resource_id: w.mia.id, role_code: 'SWPL', scope_type: 'workpackage', scope_id: w.w11.id } });
    w.zed = w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zed', email: 'zed@entreprise.com', country: 'FR' }, w.S);
    w.c.repoInsert('RoleAssignment', { resource_id: w.zed.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: w.b.id }, w.S);
    w.ZED = 'zed@entreprise.com';
    w.create = (who, scope, extra) => w.raw(who, 'baselines.create', Object.assign({ projectId: w.p1.id, justification: 'Planning du périmètre validé en revue' }, scope ? { scopeType: 'workpackage', scopeId: scope.id } : {}, extra || {}));
    w.list = (who) => w.call(who, 'baselines.list', { projectId: w.p1.id });
    w.diff = (who, scope, extra) => w.call(who, 'baselines.diff', Object.assign({ projectId: w.p1.id }, scope ? { scopeType: 'workpackage', scopeId: scope.id } : {}, extra || {}));
    w.feed = (who, extra) => w.call(who, 'changes.feed', Object.assign({ projectId: w.p1.id }, extra || {}));
    w.wpRow = (wp) => w.c.repoGet('WorkPackage', wp.id);
    return w;
  }
  const creatable = (list) => list.scopes.filter((s) => s.canCreate).map((s) => s.label);

  test('La liste déroulante : chacun ne voit que les périmètres dont il peut modifier les objets, jamais un livrable', () => {
    const w = world();
    eq(creatable(w.list(CP)), ['Projet P1', '1 Conception', '1.1 Calcul', '2 Essais'], 'le chef de projet : le projet et tous les workpackages, dans l’ordre du WBS');
    eq(creatable(w.list(DPL)), ['Projet P1', '1 Conception', '1.1 Calcul', '2 Essais'], 'le DPL aussi');
    eq(creatable(w.list(WPL)), ['1 Conception', '1.1 Calcul'], 'un Workpackage leader : son workpackage et ses sous-workpackages, pas le projet ni les autres workpackages');
    eq(creatable(w.list(SWPL)), ['1.1 Calcul'], 'un Sub-workpackage leader : son sous-workpackage seulement');
    eq([creatable(w.list(w.ZED)), w.list(w.ZED).canBaseline], [[], false], 'un Contributor : aucun périmètre (il peut seulement demander)');
    eq(w.list(WPL).scopes.map((s) => s.depth), [0, 1, 2, 1], 'la liste donne la profondeur pour l’indentation : projet, WP 1, son sous-WP, WP 2');
    ok(w.list(CP).scopes.every((s) => s.type === 'project' || s.type === 'workpackage'), 'aucun livrable ni jalon dans les périmètres');
    eq(w.list(ADMIN).scopes.filter((s) => s.canCreate).length, 4, 'l’administrateur : tout');
  });

  test('Droits de figer : le niveau de l’objet et au-dessus ; jamais un livrable ; jamais en dehors de son périmètre', () => {
    const w = world();
    eq(w.create(WPL, null).error.code, 'FORBIDDEN', 'un Workpackage leader ne fige pas le projet');
    eq(w.create(WPL, w.w2).error.code, 'FORBIDDEN', 'ni un workpackage qui n’est pas le sien');
    eq(w.create(SWPL, w.w1).error.code, 'FORBIDDEN', 'un Sub-workpackage leader ne fige pas le workpackage parent');
    eq(w.create(w.ZED, w.w1).error.code, 'FORBIDDEN', 'un Contributor ne fige rien');
    eq(w.raw(WPL, 'baselines.create', { projectId: w.p1.id, scopeType: 'planitem', scopeId: w.a.id, justification: 'x' }).error.code, 'VALIDATION', 'jamais un livrable ni un jalon');
    const other = w.call(ADMIN, 'workpackages.create', { values: { project_id: w.p2.id, name: 'Ailleurs', wbs_code: '1' } });
    eq(w.create(ADMIN, other).error.code, 'VALIDATION', 'un workpackage d’un autre projet est refusé');
    const ok1 = w.create(WPL, w.w1);
    ok(ok1.ok, JSON.stringify(ok1.error));
    ok(w.create(SWPL, w.w11).ok && w.create(CP, w.w2).ok && w.create(DPL, w.w1).ok, 'le Sub-workpackage leader fige son sous-workpackage, le chef de projet et le DPL ceux qu’ils couvrent');
    eq(w.create(WPL, w.w1, { justification: '  ' }).error.code, 'VALIDATION', 'la justification reste obligatoire');
    const empty = w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Vide', wbs_code: '3' } });
    ok(/aucun livrable ni jalon/.test(w.create(CP, { id: empty.id }).error.message), 'un périmètre sans livrable ni jalon : rien à figer');
  });

  test('Ce qu’une baseline de workpackage fige : lui, ses sous-workpackages, leurs livrables, jalons, dépendances et budget, rien d’autre', () => {
    const w = world();
    const deps = w.c.repoList('Dependency');                       // la fixture : Spécification → Calcul → Essais → Revue
    ok(deps.some((d) => d.successor_id === w.b.id) && deps.some((d) => d.successor_id === w.cc.id), 'la fixture a une dépendance dans le périmètre et une en dehors');
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.b.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 600 } });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 400 } });
    const b = w.create(WPL, w.w1).data;
    const rows = w.c.repoList('BaselineItem', (r) => r.baseline_id === b.id);
    const ids = (type) => rows.filter((r) => r.entity_type === type).map((r) => r.entity_id).sort();
    eq(ids('WorkPackage'), [w.w1.id, w.w11.id].sort(), 'le workpackage et son sous-workpackage, pas WP 2');
    eq(ids('PlanItem'), [w.a.id, w.b.id].sort(), 'leurs livrables, pas ceux des autres workpackages');
    eq(ids('Project'), [], 'pas la ligne du projet');
    eq(ids('Dependency'), deps.filter((d) => d.successor_id === w.b.id).map((d) => d.id).sort(), 'la dépendance dont le successeur est dans le périmètre (Spécification → Calcul), pas Calcul → Essais ni Essais → Revue');
    eq(ids('BudgetLine').length, 1, 'la ligne de budget de B, pas celle de C');
    eq([b.scope_type, b.scope_id, b.label, b.items], ['workpackage', w.w1.id, 'P1_1_0', 2]);
  });

  test('Références parallèles : une baseline par périmètre ; la baseline du projet n’est jamais remplacée par celle d’un workpackage', () => {
    const w = world();
    const proj = w.create(CP, null).data;
    const w1a = w.create(WPL, w.w1).data, w11 = w.create(SWPL, w.w11).data;
    eq([proj.label, w1a.label, w11.label], ['P1_0', 'P1_1_0', 'P1_1_1.1_0'], 'chaque périmètre a sa propre numérotation, et son nom dit le périmètre : projet, workpackage, sous-workpackage');
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, proj.id, 'la référence du projet est celle du projet');
    eq([w.wpRow(w.w1).active_baseline_id, w.wpRow(w.w11).active_baseline_id, w.wpRow(w.w2).active_baseline_id || ''], [w1a.id, w11.id, ''], 'chaque workpackage pointe sur la sienne ; WP 2 n’en a pas');
    const w1b = w.create(WPL, w.w1, { justification: 'Replanification de la conception' }).data;
    eq(w1b.label, 'P1_1_1', 'la deuxième baseline de WP 1 est P1_1_1');
    const byId = {}; w.list(CP).baselines.forEach((x) => { byId[x.id] = x; });
    eq([byId[w1a.id].status, byId[w1b.id].status, byId[proj.id].status, byId[w11.id].status], ['Archivée', 'Active', 'Active', 'Active'], 'seule la précédente DU MÊME périmètre est archivée');
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, proj.id, 'la référence du projet n’a pas bougé');
    eq(w.list(CP).baselines.filter((x) => x.status === 'Active').length, 3, 'trois références actives en parallèle : projet, WP 1, 1.1');
    eq(byId[w1b.id].scope_label, '1 Conception', 'la liste dit le périmètre de chacune');
    // réactiver : seulement dans son périmètre
    w.call(WPL, 'baselines.activate', { id: w1a.id, reason: 'On revient à la première' });
    eq([w.wpRow(w.w1).active_baseline_id, w.c.repoGet('Project', w.p1.id).active_baseline_id, w.wpRow(w.w11).active_baseline_id], [w1a.id, proj.id, w11.id], 'réactiver B0 de WP 1 ne touche ni le projet ni 1.1');
    eq(w.raw(SWPL, 'baselines.activate', { id: w1b.id, reason: 'x' }).error.code, 'FORBIDDEN', 'un Sub-workpackage leader ne réactive pas une baseline du workpackage parent');
  });

  test('Écarts par périmètre ; contre la référence du projet, ils ne sont jamais remis à zéro par une baseline locale', () => {
    const w = world();
    w.create(CP, null);
    w.create(WPL, w.w1);
    w.call(WPL, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-30' } });      // « Calcul » prévu le 23/10 : glisse de 5 jours ouvrés
    const local = w.diff(WPL, w.w1), vsProject = w.diff(WPL, w.w1, { against: 'project' });
    eq([local.totals.compared, local.totals.slipped, local.totals.max_slip], [2, 1, 5], 'écarts de WP 1 contre sa baseline : 2 éléments comparés, un glisse de 5 jours');
    eq([vsProject.totals.compared, vsProject.totals.slipped], [2, 1], 'contre la référence du projet, restreinte à WP 1 : le même écart');
    eq(local.scope, { type: 'workpackage', id: w.w1.id, label: '1 Conception' }, 'la réponse dit le périmètre');
    // le Workpackage leader re-fige : ses écarts locaux repartent à zéro...
    w.create(WPL, w.w1, { justification: 'Nouvelle référence de la conception' });
    eq(w.diff(WPL, w.w1).totals.slipped, 0, 'contre sa nouvelle baseline : plus d’écart');
    // ... mais pas ceux contre la référence du projet : c'est le garde-fou
    const after = w.diff(WPL, w.w1, { against: 'project' });
    eq([after.totals.slipped, after.totals.max_slip, after.baseline.scope_type], [1, 5, 'project'], 'contre la référence du projet : l’écart est toujours là, visible des niveaux du dessus');
    eq(w.diff(CP, null).totals.slipped, 1, 'et la vue projet (écarts contre la baseline du projet) l’affiche toujours');
    ok(w.diff(WPL, w.w1).seeBudget && w.diff(WPL, w.w1).items.every((i) => 'budget' in i), 'le Workpackage leader voit le budget de SON workpackage');
    eq(w.diff(WPL, null).seeBudget, false, 'mais pas celui du projet');
    eq(w.diff(CP, w.w2).baseline, null, 'un périmètre sans baseline : rien à comparer');
    eq(w.raw(CP, 'baselines.diff', { projectId: w.p1.id, scopeType: 'planitem', scopeId: w.a.id }).error.code, 'VALIDATION', 'jamais un livrable');
  });

  test('Informer le niveau du dessus : la baseline d’un niveau inférieur est « à valider », avec son résumé ; celle de l’administrateur n’a personne au-dessus', () => {
    const w = world();
    w.create(CP, null);                                                                          // niveau 2 → à valider par le DPL
    w.create(WPL, w.w1);                                                                         // niveau 3 → par le chef de projet
    const baseEv = (f) => f.items.filter((e) => e.table === 'Baseline');
    const cpFeed = w.feed(CP), dplFeed = w.feed(DPL);
    eq(baseEv(cpFeed).map((e) => e.entity), ['Baseline P1_1_0 · 1 Conception'], 'le chef de projet voit la baseline du Workpackage leader (pas la sienne)');
    eq(baseEv(dplFeed).map((e) => e.entity).sort(), ['Baseline P1_0 · Projet P1', 'Baseline P1_1_0 · 1 Conception'], 'le DPL voit les deux');
    const ev = baseEv(cpFeed)[0];
    ok(ev.what === 'baseline' && ev.level === 3 && ev.can_validate && /première baseline de ce périmètre/.test(ev.new_value) && /Planning du périmètre validé/.test(ev.new_value), 'résumé : ' + ev.new_value);
    eq(w.feed(WPL).mine.filter((e) => e.table === 'Baseline').map((e) => e.validator), ['Chef de projet'], 'l’auteur voit qui doit la valider : le niveau juste au-dessus');
    eq(w.feed(CP).mine.filter((e) => e.table === 'Baseline').map((e) => e.validator), ['Domain Program Leader'], 'celle du chef de projet attend le DPL');
    // une replanification : le résumé dit ce qui a bougé
    w.call(WPL, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-30' } });
    w.create(WPL, w.w1, { justification: 'Replanification' });
    const second = baseEv(w.feed(CP)).find((e) => /depuis la précédente/.test(e.new_value));
    ok(second && /fin \+5 j ouvrés/.test(second.new_value) && /1 date\(s\) déplacée\(s\)/.test(second.new_value), 'résumé de la replanification : ' + (second && second.new_value));
    // l'administrateur n'a personne au-dessus
    const before = w.feed(DPL).pending;
    w.create(ADMIN, w.w2);
    eq(w.feed(DPL).pending, before, 'une baseline figée par l’administrateur n’est à valider par personne');
    // le Sub-workpackage leader : validé d'abord par son Workpackage leader
    w.create(SWPL, w.w11);
    eq(w.feed(WPL).items.filter((e) => e.table === 'Baseline').map((e) => e.entity), ['Baseline P1_1_1.1_0 · 1.1 Calcul'], 'le Workpackage leader voit la baseline de son Sub-workpackage leader');
    eq(w.feed(SWPL).mine.filter((e) => e.table === 'Baseline').map((e) => e.validator), ['Workpackage leader'], 'qui est son validateur nominal');
  });

  test('Valider ou refuser : une validation suffit ; refuser revient à la baseline précédente du périmètre', () => {
    const w = world();
    const first = w.create(WPL, w.w1).data;
    w.call(WPL, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-30' } });
    const second = w.create(WPL, w.w1, { justification: 'Replanification de la conception' }).data;
    const evOf = (b) => w.feed(CP).items.find((e) => e.table === 'Baseline' && e.entity_id === b.id);
    const ev1 = evOf(first), ev2 = evOf(second);
    ok(ev1 && ev2, 'les deux baselines attendent la validation du chef de projet');
    // droits
    eq(w.raw(WPL, 'changes.reject', { id: ev2.id, reason: 'x' }).error.code, 'FORBIDDEN', 'son auteur ne refuse pas sa propre baseline');
    eq(w.raw(SWPL, 'changes.reject', { id: ev2.id, reason: 'x' }).error.code, 'FORBIDDEN', 'ni un niveau en dessous');
    eq(w.raw(CP, 'changes.reject', { id: ev2.id, reason: '  ' }).error.code, 'VALIDATION', 'le motif est obligatoire');
    const ordinary = w.feed(CP).items.find((e) => e.table !== 'Baseline');
    if (ordinary) eq(w.raw(CP, 'changes.reject', { id: ordinary.id, reason: 'x' }).error.code, 'VALIDATION', 'seule une baseline se refuse');
    // refuser la deuxième : on revient à la première
    const r = w.call(CP, 'changes.reject', { id: ev2.id, reason: 'Le décalage de Calcul n’est pas acceptable' });
    eq(r.restored, first.id, 'la première baseline est rétablie');
    const byId = {}; w.list(CP).baselines.forEach((x) => { byId[x.id] = x; });
    eq([byId[first.id].status, byId[second.id].status, w.wpRow(w.w1).active_baseline_id], ['Active', 'Refusée', first.id], 'la refusée passe à « Refusée », la précédente redevient la référence de WP 1');
    eq(byId[second.id].validation, 'refused', 'et la liste le dit');
    eq(w.diff(WPL, w.w1).totals.slipped, 1, 'les écarts de WP 1 sont de nouveau mesurés contre la première baseline');
    ok(!w.feed(CP).items.some((e) => e.entity_id === second.id && !e.acknowledged), 'le changement est traité');
    eq(w.raw(CP, 'changes.reject', { id: ev2.id, reason: 'encore' }).error.code, 'VALIDATION', 'on ne refuse pas deux fois');
    // valider la première : une seule validation, la baseline reste la référence
    eq(w.call(CP, 'changes.ack', { ids: [ev1.id] }).acknowledged, 1, 'le chef de projet valide la première');
    eq([w.feed(CP).items.some((e) => e.entity_id === first.id && !e.acknowledged), w.feed(DPL).items.some((e) => e.entity_id === first.id && !e.acknowledged)], [false, false], 'disparue pour tous les niveaux');
    eq(w.list(CP).baselines.find((x) => x.id === first.id).validation, 'validated', 'la liste dit qu’elle est validée');
    eq(w.list(CP).baselines.find((x) => x.id === first.id).validated_by, CP, 'et par qui');
    // refuser une première baseline : le périmètre se retrouve sans référence
    const only = w.create(SWPL, w.w11).data, evOnly = w.feed(WPL).items.find((e) => e.entity_id === only.id);
    const r2 = w.call(WPL, 'changes.reject', { id: evOnly.id, reason: 'Pas maintenant' });
    eq([r2.restored, w.wpRow(w.w11).active_baseline_id || ''], [null, ''], 'sans baseline précédente : plus de référence sur ce périmètre');
    eq(w.diff(WPL, w.w11).baseline, null);
  });

  test('Demandes de baseline par périmètre : un Contributor demande, qui peut figer ce périmètre traite', () => {
    const w = world();
    const req = w.call(w.ZED, 'baselines.request', { projectId: w.p1.id, scopeType: 'workpackage', scopeId: w.w1.id, justification: 'La conception a changé' });
    eq([req.status, req.scope_type, req.scope_id], ['Demandée', 'workpackage', w.w1.id], 'la demande porte le périmètre');
    eq(w.raw(w.ZED, 'baselines.request', { projectId: w.p1.id, scopeType: 'planitem', scopeId: w.a.id, justification: 'x' }).error.code, 'VALIDATION', 'jamais sur un livrable');
    eq(w.raw(SWPL, 'baselines.create', { projectId: w.p1.id, requestId: req.id }).error.code, 'FORBIDDEN', 'un Sub-workpackage leader ne traite pas une demande sur le workpackage parent');
    eq(w.raw(SWPL, 'baselines.refuse', { id: req.id, reason: 'non' }).error.code, 'FORBIDDEN', 'ni ne la refuse');
    const b = w.raw(WPL, 'baselines.create', { projectId: w.p1.id, requestId: req.id });
    ok(b.ok, JSON.stringify(b.error));
    eq([b.data.scope_type, b.data.scope_id, b.data.status, b.data.justification], ['workpackage', w.w1.id, 'Active', 'La conception a changé'], 'le Workpackage leader la fige : périmètre et justification repris de la demande');
    const req2 = w.call(w.ZED, 'baselines.request', { projectId: w.p1.id, justification: 'Pour le projet' });
    eq(w.raw(WPL, 'baselines.create', { projectId: w.p1.id, requestId: req2.id }).error.code, 'FORBIDDEN', 'une demande sur le projet reste au chef de projet');
    ok(w.raw(CP, 'baselines.refuse', { id: req2.id, reason: 'Pas maintenant' }).ok, 'qui peut la refuser');
  });

  test('Les anciennes baselines (sans périmètre) restent des baselines du projet', () => {
    const w = world();
    const b = w.create(CP, null).data;
    eq([b.scope_type, b.scope_id], ['project', w.p1.id], 'une baseline du projet : périmètre « projet »');
    eq([w.c.repoGet('Baseline', b.id).scope_type || '', w.c.repoGet('Baseline', b.id).scope_id || ''], ['', ''], 'enregistrée sans périmètre, comme avant : aucune migration');
    eq(w.c.repoGet('Project', w.p1.id).active_baseline_id, b.id, 'toujours la référence active du projet');
  });
};
