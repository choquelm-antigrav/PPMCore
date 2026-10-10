const fs = require('fs');
const path = require('path');
const { test, eq, ok, freshCore } = require('./harness');

module.exports = function () {
  console.log('\nDémo complète et points d’entrée de l’éditeur (0.11.0)');

  const ME = 'admin@entreprise.com';
  function core() {
    const c = freshCore();
    c.Session = { getActiveUser: () => ({ getEmail: () => ME }), getEffectiveUser: () => ({ getEmail: () => ME }) };
    return c;
  }
  const call = (c, action, params) => {
    const r = c.handleRequest({ action: action, params: params || {}, apiVersion: c.PPM_API_VERSION }, ME);
    if (!r.ok) throw new Error(action + ' : ' + JSON.stringify(r.error));
    return r.data;
  };
  const counts = (c) => ['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'MilestoneRequirement', 'Resource', 'HierarchicalTeam', 'RoleAssignment', 'Baseline', 'BudgetLine', 'PurchaseOrder', 'RiskOpportunity', 'ProgressUpdate']
    .map((t) => t + ':' + c.repoList(t).length).join(' ');

  const demo = (() => { const c = core(); const msg = c.seedDemo_(); return { c, msg }; })();
  const c = demo.c;

  test('Les huit points d’entrée sont en tête de la liste des fonctions, avant les cent autres', () => {
    const names = ['A1_INSTALLER_PPM', 'A2_SEED_DEMO', 'A3_VERIFIER_INSTALLATION', 'A4_DIAGNOSTIC_ACCES', 'A5_INSTALLER_DECLENCHEURS', 'A6_EFFACER_DEMO', 'A7_TESTER_DANS_APPS_SCRIPT', 'A8_VERIFIER_ECRITURE'];
    names.forEach((n) => eq(typeof c[n], 'function', n));
    ['installerPpm', 'seedDemo', 'diagnosticAcces'].forEach((n) => eq(typeof c[n], 'undefined', 'l’ancien nom public ' + n + ' a disparu : il encombrait la liste'));
    // dans le fichier fabriqué : définis en premier (ordre de définition) ...
    const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'PPM_Core.gs'), 'utf8');
    const decl = [...bundle.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
    eq(decl.slice(0, 8), names, 'les huit premières fonctions du fichier');
    // ... et en tête dans l'ordre alphabétique, avec ou sans casse (les fonctions finissant par « _ » sont privées : absentes de la liste)
    const publics = decl.filter((n) => !n.endsWith('_'));
    ok(publics.length > 100, publics.length + ' fonctions publiques dans la liste');
    eq([...publics].sort().slice(0, 8), names, 'en tête dans l’ordre des codes de caractères');
    eq([...publics].sort((a, b) => a.localeCompare(b, 'fr')).slice(0, 8), names, 'en tête dans l’ordre alphabétique des langues');
    eq([...publics].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).slice(0, 8), names, 'en tête, sans tenir compte de la casse');
  });

  test('La démo se crée d’un coup et annonce sa fin', () => {
    ok(/^Démo complète/.test(demo.msg), demo.msg);
    eq(c.getProp(c.PROP.DEMO_STEP, ''), '', 'plus de reprise en attente');
    ok(/La démo existe déjà/.test(c.seedDemo_()), 'relancée, elle ne recrée rien');
  });

  test('Contenu : un programme, quatre projets, un projet complexe, des ressources avec leurs taux', () => {
    eq([c.repoList('Program').length, c.repoList('Project').map((p) => p.code + ':' + p.status).sort()], [1, ['NAC-1:Actif', 'NAC-2:Actif', 'NAC-3:Préparation', 'NAC-4:Clos']]);
    const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1');
    const wps = c.repoList('WorkPackage', (w) => w.project_id === p1.id), items = c.repoList('PlanItem', (i) => i.project_id === p1.id);
    ok(wps.filter((w) => !w.parent_wp_id).length === 4 && wps.filter((w) => w.parent_wp_id).length >= 12, 'WBS : 4 workpackages et plus de 12 sous-workpackages (' + wps.length + ')');
    ok(items.filter((i) => i.item_type === 'Livrable').length >= 35 && items.filter((i) => i.item_type === 'Jalon').length >= 8, 'plus de 35 livrables et 8 jalons : ' + items.length);
    eq([...new Set(wps.filter((w) => w.cpn).map((w) => w.cpn))].sort(), ['CPN-2402', 'CPN-2403'], 'deux sous-projets avec leur CPN, en plus de celui du projet (' + p1.cpn + ')');
    ok(c.repoList('Dependency').length >= 55 && ['FS', 'SS', 'FF'].every((t) => c.repoList('Dependency').some((d) => d.dep_type === t)) && c.repoList('Dependency').some((d) => Number(d.lag_days) < 0), 'un réseau de dépendances de plusieurs types, avec décalages');
    const people = c.repoList('Resource');
    ok(people.length === 39 && people.filter((r) => r.resource_type === 'Externe').length === 8, '38 personnes plus le compte qui lance la démo, dont 8 externes');
    ok(people.filter((r) => Number(r.daily_rate) > 0).length === 38, 'tout le panel a un taux journalier');
    eq([...new Set(people.map((r) => r.country))].sort(), ['DE', 'FR', 'IN', 'UK'], 'quatre pays');
    const rates = people.filter((r) => Number(r.daily_rate) > 0).map((r) => Number(r.daily_rate));
    ok(Math.min(...rates) < 400 && Math.max(...rates) > 800, 'taux de ' + Math.min(...rates) + ' à ' + Math.max(...rates) + ' € par jour');
    const teams = c.repoList('HierarchicalTeam'), depth = (t) => (t.parent_team_id ? 1 + depth(teams.find((x) => x.id === t.parent_team_id)) : 0);
    ok(teams.length === 11 && Math.max(...teams.map(depth)) === 2 && teams.every((t) => t.manager_resource_id), 'équipes en arbre sur trois niveaux, toutes avec un responsable');
  });

  test('Organigramme : des rôles à tous les niveaux et trois personnes à positionner', () => {
    const roles = c.repoList('RoleAssignment');
    ['PL', 'DPL', 'CP', 'RWP', 'MEMBER'].forEach((r) => ok(roles.some((a) => a.role_code === r), 'rôle ' + r));
    ['program', 'project', 'workpackage'].forEach((t) => ok(roles.some((a) => a.scope_type === t), 'périmètre ' + t));
    ok(roles.length >= 80, roles.length + ' affectations');
    const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1');
    const tree = call(c, 'obs.tree', { scopeType: 'project', scopeId: p1.id });
    ok(tree.nodes.length >= 20, 'organigramme de ' + tree.nodes.length + ' cartes');
    eq(tree.unplaced.people.map((p) => p.name).sort(), ['Brigitte Stahl', 'Julie Fontaine', 'Omar Diallo'], 'personnes sans rôle : à positionner');
  });

  test('Quatre projets, quatre situations : en alerte, sain, en préparation, clos', () => {
    const ov = call(c, 'overview.get', {});
    const by = Object.fromEntries(ov.projects.map((p) => [p.code, p.kpis]));
    eq([by['NAC-1'].time.level, by['NAC-1'].quality.level, by['NAC-1'].cost.level, by['NAC-1'].overall], ['alert', 'alert', 'alert', 'alert'], 'NAC-1 : délais, qualité et coût en alerte');
    eq([by['NAC-2'].time.level, by['NAC-2'].quality.level, by['NAC-2'].cost.level, by['NAC-2'].overall], ['ok', 'ok', 'ok', 'ok'], 'NAC-2 : sain');
    eq([by['NAC-3'].cost.level, by['NAC-3'].overall], ['none', 'warn'], 'NAC-3 : budget non renseigné, points de vigilance');
    eq(by['NAC-4'].overall, 'ok', 'NAC-4 : clos');
    const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1');
    ok(call(c, 'overview.get', { projectId: p1.id }).detail.people >= 30, 'repères : les membres du projet sont comptés, adresse ou non');
    ok(ov.projects.filter((p) => p.code === 'NAC-1')[0].kpis.time.facts.some((f) => /après la fin visée/.test(f)), 'la fin du plan dépasse la fin visée');
  });

  test('Retards, baselines et dérives : de quoi exercer tout l’écran Suivi', () => {
    const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1'), p2 = c.repoList('Project').find((p) => p.code === 'NAC-2');
    eq(c.repoList('Baseline', (b) => b.project_id === p1.id).map((b) => b.label + ':' + b.status).sort(), ['B0:Archivée', 'B1:Active', 'B2:Demandée'], 'NAC-1 : B0 archivée, B1 active, une demande en attente');
    eq(c.repoList('Baseline', (b) => b.project_id === p2.id).map((b) => b.label + ':' + b.status), ['B0:Active']);
    const diff = call(c, 'baselines.diff', { projectId: p1.id, base: c.repoList('Baseline').find((b) => b.project_id === p1.id && b.label === 'B0').id, to: 'current' });
    ok(diff && JSON.stringify(diff).length > 500, 'les écarts B0 → aujourd’hui sont lisibles');
    const feed = call(c, 'changes.feed', { projectId: p1.id, all: true });
    ok(JSON.stringify(feed).length > 1000, 'fil des changements non vide');
  });

  test('Constats : toutes les familles que sait produire le moteur de règles', () => {
    const codes = new Set(c.repoList('Insight').map((i) => i.rule_code));
    ['LATE_ITEM', 'STALE_PROGRESS', 'WEAK_SIGNAL', 'DEPENDENCY_VIOLATION', 'CRITICAL_SLIP', 'MILESTONE_THREATENED', 'MILESTONE_INCOMPLETE', 'MISSING_OWNER', 'MISSING_DATE', 'EMPTY_WP', 'RISK_OVERDUE',
      'PO_GR_LATE', 'PO_GR_SOON', 'PO_TODO_LATE', 'PO_OVERRUN'].forEach((k) => ok(codes.has(k), 'constat ' + k));
    ok(c.repoList('Insight').length >= 25, c.repoList('Insight').length + ' constats ouverts');
  });

  test('Budget et achats : lignes existantes, trois CPN, un dépassement, des GR en retard', () => {
    const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1');
    const bal = call(c, 'budget.balance', { projectId: p1.id });
    eq(bal.cpns.map((g) => g.cpn), ['CPN-2401', 'CPN-2402', 'CPN-2403'], 'trois CPN dans le bilan de NAC-1');
    eq(bal.cpns.filter((g) => g.overrun).map((g) => g.cpn), ['CPN-2403'], 'dépassement sur le CPN des outillages');
    ok(bal.cpns.every((g) => g.budget.external > 0 && g.budget.internal > 0 && g.po.committed > 0), 'budget interne et externe, engagements : sur chaque CPN');
    const lines = c.repoList('BudgetLine');
    ok(lines.length >= 45 && lines.some((l) => l.cost_type === 'Forfait') && lines.some((l) => l.cost_type === 'TJM' && isTrue(l.is_external)) && lines.some((l) => l.cost_type === 'TJM' && !isTrue(l.is_external)), lines.length + ' lignes : forfaits, externes en jours, internes en jours');
    const po = call(c, 'po.list', { projectId: p1.id });
    eq([...new Set(po.orders.map((o) => o.status))].sort(), ['GR', 'Lancée', 'Terminée', 'À faire'], 'les quatre statuts de PO');
    eq(po.orders.filter((o) => o.gr_flag === 'late').length, 2, 'deux GR en retard');
    ok(po.orders.some((o) => o.warnings.length), 'avertissements sur des PO (non affectée, dépassement…)');
    const outside = call(c, 'po.list', { scope: 'outside' });
    eq(outside.orders.map((o) => o.po_number), ['CB-499001'], 'une PO hors périmètre de l’outil');
    function isTrue(v) { return v === true || v === 'true' || v === 'TRUE'; }
  });

  test('Sûreté : aucune adresse fictive, aucun mail, aucune invitation', () => {
    eq(c.repoList('Resource').filter((r) => r.email).map((r) => r.email), [ME], 'seul le compte qui lance la démo a une adresse');
    eq(c.SENT_MAILS.length, 0, 'aucun mail envoyé');
    eq(c.repoList('SyncLink').length, 0, 'aucun agenda ni dossier créé');
  });

  test('Reprise : chaque lancement avance d’une étape quand le temps manque, sans rien dupliquer', () => {
    const one = demo.c; const reference = counts(one);
    const w = core();
    w.DEMO_BUDGET_MS = -1; // plus aucun temps de reste : une seule étape par lancement
    let calls = 0, last = '';
    do { last = w.seedDemo_(); calls++; } while (!/^Démo complète/.test(last) && calls < 40);
    eq(calls, w.DEMO_STEPS.length, 'autant de lancements que d’étapes');
    eq(counts(w), reference, 'au final : exactement la même démo');
    ok(/Démo en cours/.test((() => { const x = core(); x.DEMO_BUDGET_MS = -1; return x.seedDemo_(); })()), 'un lancement incomplet dit combien d’étapes sont faites et de relancer');
    ok(/La démo existe déjà/.test(w.seedDemo_()), 'et une démo terminée ne se recrée pas');
  });

  test('Une étape qui échoue le dit, garde les précédentes et se relance', () => {
    const w = core();
    const real = w.runRules;
    w.runRules = () => { throw new Error('panne simulée'); };
    let err;
    try { w.seedDemo_(); } catch (e) { err = e; }
    ok(err && /étape 17\/17/.test(err.message) && /panne simulée/.test(err.message) && /relancez/.test(err.message), err && err.message);
    eq(w.getProp(w.PROP.DEMO_STEP, ''), '16', 'les 16 premières étapes sont conservées');
    w.runRules = real;
    ok(/^Démo complète/.test(w.seedDemo_()), 'relancée, elle termine');
    eq(counts(w), counts(demo.c), 'sans doublon');
  });

  test('Démo : le fil d’actualités de NAC-1 (réunions de l’agenda et saisies, actions à tous les états, synthèse du jour, réunions à trier)', () => {
    const nac1 = c.repoList('Project').find((p) => p.code === 'NAC-1'), nac2 = c.repoList('Project').find((p) => p.code === 'NAC-2');
    const g = call(c, 'news.get', { projectId: nac1.id });
    eq([g.project.news_on, g.project.keywords], [true, 'NAC-1, nacelle'], 'la collecte est activée sur NAC-1');
    eq(g.meetings.length, 8, 'huit réunions des deux dernières semaines');
    eq([...new Set(g.meetings.map((m) => m.source))].sort(), ['Agenda', 'Manuel'], 'des réunions de l’agenda et des saisies à la main');
    ok(g.meetings.every((m) => m.summary || m.decisions.length || m.action_list.length), 'chaque réunion a un contenu');
    const all = g.meetings.reduce((a, m) => a.concat(m.action_list), []);
    ok(all.length >= 17, all.length + ' actions');
    eq(all.filter((a) => !a.owner_id).length, 0, 'tous les responsables des notes sont reconnus parmi les membres du projet : ' + all.filter((a) => !a.owner_id).map((a) => a.owner_label + ' / ' + a.text).join(' ; '));
    eq([...new Set(all.map((a) => a.status))].sort(), ['Acceptée', 'Contestée', 'Faite', 'Proposée'], 'les quatre états d’une action');
    ok(all.filter((a) => a.item).length >= 4 && all.filter((a) => a.due_date).length >= 15, 'des actions rattachées à un livrable, la plupart avec une échéance');
    ok(all.every((a) => !a.due_date || a.due_date >= c.addCalendarDays(c.todayStr(), -20)), 'des échéances plausibles : proches d’aujourd’hui');
    eq(g.digest.date, c.todayStr(), 'une synthèse publiée aujourd’hui');
    eq(c.newsValidateDigest_(g.digest.text).ok, true, 'et au format attendu : ' + c.newsValidateDigest_(g.digest.text).found.join(', '));
    eq(g.triage.length, 2, 'deux réunions à trier, dont NAC-1 est candidat');
    const n2 = call(c, 'news.get', { projectId: nac2.id });
    eq([n2.meetings.length, n2.triage.length], [1, 2], 'NAC-2 a sa réunion et voit les mêmes réunions à trier');
    ok(c.repoList('Resource').every((r) => !r.email || r.email === ME), 'personne n’a d’adresse e-mail : aucune action ne peut déclencher de mail à un tiers');
    eq(c.repoList('Meeting', (m) => m.status === 'À trier').length, 2);
  });

  // ---------------------------------------------------------------- remplacer l'ancienne démo (A6_EFFACER_DEMO)
  const A = { actor: ME, source: 'setup' };
  /** Base avec l'ancienne démo (0.10.0), ce qu'on a pu y ajouter en essayant les versions suivantes, et des données réelles à ne pas toucher. */
  function oldDemoBase(opts) {
    const w = core(); opts = opts || {};
    const me = w.repoInsert('Resource', { resource_type: 'Interne', name: 'Admin', email: ME, country: 'FR' }, A);
    const ins = (t, v) => w.repoInsert(t, v, A);
    const prog = ins('Program', { code: 'DEMO', name: 'Programme de démonstration', status: 'Actif', leader_resource_id: me.id });
    const proj = ins('Project', { code: 'PILOTE', name: 'Projet pilote', program_id: prog.id, manager_resource_id: me.id, status: 'Actif', holiday_country: 'FR', start_date: w.todayStr() });
    const camille = ins('Resource', { resource_type: 'Interne', name: 'Camille Durand', country: 'FR', job_function: 'Ingénieure structure', organization: 'Bureau d’études' });
    const sam = ins('Resource', { resource_type: 'Externe', name: 'Sam Weber', country: 'DE', job_function: 'Responsable essais', organization: 'Sous-traitant Alpha', supplier: 'Alpha Test GmbH' });
    const wp1 = ins('WorkPackage', { project_id: proj.id, wbs_code: '1', name: 'Conception', owner_resource_id: camille.id, charge_code: 'PIL-001' });
    const wp2 = ins('WorkPackage', { project_id: proj.id, wbs_code: '2', name: 'Validation', owner_resource_id: sam.id, charge_code: 'PIL-002' });
    ins('RoleAssignment', { resource_id: me.id, role_code: 'CP', scope_type: 'project', scope_id: proj.id });
    ins('RoleAssignment', { resource_id: camille.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp1.id });
    ins('RoleAssignment', { resource_id: sam.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: wp2.id });
    const item = (wp, name, type) => ins('PlanItem', { project_id: proj.id, wp_id: wp.id, item_type: type || 'Livrable', name: name, owner_resource_id: me.id, planned_start: w.todayStr(), planned_finish: w.todayStr(), progress_pct: 0, status: 'À faire' });
    const l1 = item(wp1, 'Spécification'), l2 = item(wp2, 'Plan de tests'), j1 = item(wp2, 'Revue de conception', 'Jalon');
    ins('Dependency', { predecessor_id: l1.id, successor_id: l2.id, dep_type: 'FS', lag_days: 0 });
    ins('MilestoneRequirement', { milestone_id: j1.id, deliverable_id: l2.id });
    // ajouts faits en essayant les versions suivantes : budget, étalement, baseline, commande d'achat
    const line = ins('BudgetLine', { deliverable_id: l1.id, resource_id: camille.id, cost_type: 'TJM', planned_days: 5, frozen_rate: 600, planned_amount: 3000, phasing_mode: 'auto', is_external: false });
    ins('BudgetPhasing', { budget_line_id: line.id, month: '2026-11', amount: 3000 });
    ins('Baseline', { project_id: proj.id, number: 0, label: 'B0', justification: 'Planning validé', status: 'Active' });
    const po = ins('PurchaseOrder', { po_number: 'CB-PILOTE', cpn: 'CPN-0001', resource_id: sam.id, amount: 1000, status: 'À faire', gr_due_date: w.todayStr() });
    ins('PurchaseOrderLink', { po_id: po.id, deliverable_id: l1.id, amount: 1000 });
    // données réelles, à ne jamais toucher
    const alice = ins('Resource', { resource_type: 'Interne', name: 'Alice Réelle', email: 'alice@entreprise.com', country: 'FR' });
    const realProg = ins('Program', { code: 'REEL', name: 'Programme réel', status: 'Actif', leader_resource_id: alice.id });
    const realProj = ins('Project', { code: 'R-1', name: 'Projet réel', program_id: realProg.id, manager_resource_id: alice.id, status: 'Actif', holiday_country: 'FR', start_date: w.todayStr() });
    const realWp = ins('WorkPackage', { project_id: realProj.id, wbs_code: '1', name: 'Lot réel', owner_resource_id: opts.samCited ? sam.id : alice.id, charge_code: 'REEL-1' });
    const autreCamille = ins('Resource', { resource_type: 'Interne', name: 'Camille Durand', country: 'FR', job_function: 'Ingénieure méthodes', organization: 'Bureau d’études' }); // homonyme réelle : sa fonction n'est celle d'aucune personne de la démo
    return { w, me, prog, proj, camille, sam, alice, realProj, realWp, autreCamille, line, po };
  }
  const live = (w, t) => w.repoList(t);
  const liveCount = (w) => ['Program', 'Project', 'WorkPackage', 'PlanItem', 'Dependency', 'MilestoneRequirement', 'BudgetLine', 'BudgetPhasing', 'Baseline', 'PurchaseOrder', 'PurchaseOrderLink', 'RoleAssignment', 'Resource']
    .map((t) => t + ':' + live(w, t).length).join(' ');

  test('Ancienne démo : le premier lancement montre ce qui serait supprimé et ne touche à rien', () => {
    const b = oldDemoBase(), w = b.w, before = liveCount(w);
    const m = w.A6_EFFACER_DEMO();
    ok(/Rien n’est supprimé/.test(m) && /relancez A6_EFFACER_DEMO dans les 10 minutes/.test(m), m);
    ok(/1 programme/.test(m) && /1 projet/.test(m) && /2 workpackages/.test(m) && /3 livrables ou jalons/.test(m) && /1 ligne de budget/.test(m) && /1 baseline/.test(m) && /1 commande d’achat/.test(m) && /2 personnes fictives/.test(m), m);
    eq(liveCount(w), before, 'aucune ligne supprimée');
    ok(Number(w.getProp(w.PROP.DEMO_CLEAN, '0')) > 0, 'la demande est mémorisée');
  });

  test('Ancienne démo : le second lancement supprime, et seulement elle', () => {
    const b = oldDemoBase(), w = b.w;
    const realBefore = ['Project:R-1', 'Program:REEL'].map((x) => x);
    w.A6_EFFACER_DEMO();
    const m = w.A6_EFFACER_DEMO();
    ok(/^Démo supprimée/.test(m) && /Lancez maintenant A2_SEED_DEMO/.test(m), m);
    eq([live(w, 'Program').map((p) => p.code), live(w, 'Project').map((p) => p.code)], [['REEL'], ['R-1']], 'seuls le programme et le projet réels restent');
    eq([live(w, 'WorkPackage').length, live(w, 'PlanItem').length, live(w, 'Dependency').length, live(w, 'MilestoneRequirement').length, live(w, 'BudgetLine').length, live(w, 'BudgetPhasing').length, live(w, 'Baseline').length, live(w, 'PurchaseOrder').length, live(w, 'PurchaseOrderLink').length], [1, 0, 0, 0, 0, 0, 0, 0, 0], 'découpage, planning, budget, baseline et achats de l’ancienne démo supprimés ; le lot réel reste');
    eq(live(w, 'RoleAssignment').length, 0, 'ses rôles sont supprimés');
    eq(live(w, 'Resource').map((r) => r.name + '|' + (r.job_function || '')).sort(), ['Admin|', 'Alice Réelle|', 'Camille Durand|Ingénieure méthodes'], 'les deux personnes fictives partent ; l’administrateur, la personne réelle et une homonyme d’une autre fonction restent');
    ok(realBefore.length === 2 && w.repoList('Project', null, { includeDeleted: true }).some((p) => p.code === 'PILOTE' && w.isTrue(p.deleted)), 'suppression douce : la ligne reste dans la feuille, marquée supprimée (réversible)');
    eq(w.getProp(w.PROP.DEMO_CLEAN, ''), '', 'demande de confirmation effacée');
    ok(/Aucune démo/.test(w.A6_EFFACER_DEMO()), 'relancée, elle ne trouve plus rien');
  });

  test('Ancienne démo : confirmation périmée, personne encore citée ailleurs, droits', () => {
    const b = oldDemoBase({ samCited: true }), w = b.w;
    const m1 = w.A6_EFFACER_DEMO();
    ok(/1 personne fictive/.test(m1) && /Conservées car citées ailleurs : Sam Weber/.test(m1), m1);
    w.A6_EFFACER_DEMO();
    ok(live(w, 'Resource').some((r) => r.name === 'Sam Weber') && live(w, 'WorkPackage').some((x) => x.owner_resource_id === b.sam.id), 'une personne fictive encore responsable d’un lot réel est conservée');
    ok(!live(w, 'Resource').some((r) => r.name === 'Camille Durand' && r.job_function === 'Ingénieure structure'), 'l’autre personne fictive, plus citée, est supprimée');
    // confirmation trop ancienne : on redemande, on ne supprime pas
    const o = oldDemoBase(), x = o.w;
    x.setProp(x.PROP.DEMO_CLEAN, String(Date.now() - 11 * 60 * 1000));
    const before = liveCount(x);
    ok(/Rien n’est supprimé/.test(x.A6_EFFACER_DEMO()) && liveCount(x) === before, 'après 10 minutes, la confirmation ne vaut plus : on redemande');
    // droits
    const n = oldDemoBase().w;
    n.Session = { getActiveUser: () => ({ getEmail: () => 'alice@entreprise.com' }), getEffectiveUser: () => ({ getEmail: () => 'alice@entreprise.com' }) };
    let err; try { n.A6_EFFACER_DEMO(); } catch (e) { err = e; }
    ok(err && err.code === 'FORBIDDEN', 'réservé aux administrateurs');
  });

  const nacCount = (w) => ({ projects: live(w, 'Project').filter((p) => /^NAC-/.test(p.code)).length, wps: live(w, 'WorkPackage').length, items: live(w, 'PlanItem').length, deps: live(w, 'Dependency').length,
    budget: live(w, 'BudgetLine').length, orders: live(w, 'PurchaseOrder').length, meetings: live(w, 'Meeting').length, teams: live(w, 'HierarchicalTeam').length });

  /** Ce qui appartient aux projets NAC (la démo courante), sans les objets de l'ancienne démo ni les données réelles. */
  const nacOnly = (w) => {
    const ids = new Set(live(w, 'Project').filter((p) => /^NAC-/.test(p.code)).map((p) => p.id)), items = live(w, 'PlanItem').filter((i) => ids.has(i.project_id)), iid = new Set(items.map((i) => i.id));
    return { projects: ids.size, wps: live(w, 'WorkPackage').filter((x) => ids.has(x.project_id)).length, items: items.length, deps: live(w, 'Dependency').filter((d) => iid.has(d.predecessor_id)).length,
      budget: live(w, 'BudgetLine').filter((b) => iid.has(b.deliverable_id)).length, meetings: live(w, 'Meeting').length, teams: live(w, 'HierarchicalTeam').length };
  };

  test('A6 efface les deux démos (DEMO et NAC), leurs équipes et leurs actualités, remet A2 à zéro, et la démo se recrée à l’identique', () => {
    const b = oldDemoBase(), w = b.w; w.DEMO_BUDGET_MS = 1e9;
    const msg = w.seedDemo_();
    ok(/^Démo complète/.test(msg) && /l’ancienne démo \(programme DEMO\) est toujours là/.test(msg) && /A6_EFFACER_DEMO/.test(msg), msg);
    const first = nacOnly(w);
    ok(first.projects === 4 && first.items >= 70 && first.meetings >= 8 && first.teams >= 11, JSON.stringify(first));
    w.A6_EFFACER_DEMO();
    const done = w.A6_EFFACER_DEMO();
    ok(/^Démo supprimée/.test(done) && /équipes/.test(done) && /réunions/.test(done), done);
    eq(live(w, 'Program').map((p) => p.code), ['REEL'], 'il ne reste que le programme réel');
    eq(nacCount(w), { projects: 0, wps: 1, items: 0, deps: 0, budget: 0, orders: 0, meetings: 0, teams: 0 }, 'plus rien des deux démos (le lot réel reste)');
    eq(live(w, 'Resource').map((r) => r.name + '|' + (r.job_function || '')).sort(), ['Admin|', 'Alice Réelle|', 'Camille Durand|Ingénieure méthodes'], 'les personnes fictives des deux démos partent, la réelle et l’administrateur restent');
    eq(w.getProp(w.PROP.DEMO_STEP, ''), '', 'la reprise de A2 est remise à zéro');
    ok(/^Démo complète/.test(w.seedDemo_()), 'et A2 la recrée');
    eq(nacOnly(w), first, 'à l’identique : mêmes nombres de projets, workpackages, livrables, dépendances, lignes de budget, réunions et équipes');
    ok(/existe déjà/.test(w.seedDemo_()), 'relancée, A2 dit que la démo existe');
  });

  test('Démo interrompue (comme chez vous : arrêtée à l’étape 3), effacée, puis recréée en entier', () => {
    const w = core(); w.DEMO_BUDGET_MS = 0; // une seule étape par lancement
    let step = ''; for (let i = 0; i < 3; i++) { const m = w.seedDemo_(); step = w.getProp(w.PROP.DEMO_STEP, ''); ok(/^Démo en cours/.test(m) && /Relancez A2_SEED_DEMO/.test(m), 'lancement ' + (i + 1) + ' : ' + m.slice(0, 60)); }
    eq(step, '3', 'arrêtée après trois étapes, comme dans votre journal');
    eq([live(w, 'Project').length, live(w, 'PlanItem').length], [4, 0], 'les projets existent, aucun livrable : exactement ce que montrait votre Overview');
    w.A6_EFFACER_DEMO(); const done = w.A6_EFFACER_DEMO();
    ok(/^Démo supprimée/.test(done), done);
    eq([live(w, 'Project').length, live(w, 'Resource').filter((r) => !r.email).length, w.getProp(w.PROP.DEMO_STEP, '')], [0, 0, ''], 'démo effacée, reprise remise à zéro');
    w.DEMO_BUDGET_MS = 1e9;
    ok(/^Démo complète/.test(w.seedDemo_()), 'recréée en entier');
    ok(nacCount(w).items >= 70 && nacCount(w).projects === 4, JSON.stringify(nacCount(w)));
  });
};
