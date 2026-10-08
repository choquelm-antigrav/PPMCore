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

  test('Les cinq points d’entrée sont en tête de la liste des fonctions, avant les cent autres', () => {
    const names = ['A1_INSTALLER_PPM', 'A2_SEED_DEMO', 'A3_VERIFIER_INSTALLATION', 'A4_DIAGNOSTIC_ACCES', 'A5_INSTALLER_DECLENCHEURS'];
    names.forEach((n) => eq(typeof c[n], 'function', n));
    ['installerPpm', 'seedDemo', 'diagnosticAcces'].forEach((n) => eq(typeof c[n], 'undefined', 'l’ancien nom public ' + n + ' a disparu : il encombrait la liste'));
    // dans le fichier fabriqué : définis en premier (ordre de définition) ...
    const bundle = fs.readFileSync(path.join(__dirname, '..', 'dist', 'PPM_Core.gs'), 'utf8');
    const decl = [...bundle.matchAll(/^function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
    eq(decl.slice(0, 5), names, 'les cinq premières fonctions du fichier');
    // ... et en tête dans l'ordre alphabétique, avec ou sans casse (les fonctions finissant par « _ » sont privées : absentes de la liste)
    const publics = decl.filter((n) => !n.endsWith('_'));
    ok(publics.length > 100, publics.length + ' fonctions publiques dans la liste');
    eq([...publics].sort().slice(0, 5), names, 'en tête dans l’ordre des codes de caractères');
    eq([...publics].sort((a, b) => a.localeCompare(b, 'fr')).slice(0, 5), names, 'en tête dans l’ordre alphabétique des langues');
    eq([...publics].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).slice(0, 5), names, 'en tête, sans tenir compte de la casse');
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
    ok(err && /étape 15\/15/.test(err.message) && /panne simulée/.test(err.message) && /relancez/.test(err.message), err && err.message);
    eq(w.getProp(w.PROP.DEMO_STEP, ''), '14', 'les 14 premières étapes sont conservées');
    w.runRules = real;
    ok(/^Démo complète/.test(w.seedDemo_()), 'relancée, elle termine');
    eq(counts(w), counts(demo.c), 'sans doublon');
  });
};
