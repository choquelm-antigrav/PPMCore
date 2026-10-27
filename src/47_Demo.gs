/**
 * PPM Core — 0.11.0 : démo complète (A2_SEED_DEMO).
 *
 * Un programme « NAC » et un projet complet :
 *   NAC-1  Nacelle moteur A      projet complexe : 4 workpackages, 15 sous-workpackages, une quarantaine de livrables, 8 jalons,
 *                                un réseau de dépendances, des retards, des dépendances non respectées, trois baselines (B0 archivée,
 *                                B1 active, une demande en attente), du budget, 3 CPN, des commandes d'achat (GR en retard, dépassement), des risques,
 *                                un fil d'actualités (réunions de l'agenda et saisies, actions à tous les états, synthèse du jour).
 * Autour : 11 équipes en arbre (le nom d'une équipe est son code : 3 caractères = budget, 4 = détail), 38 personnes plus vous (internes et externes, quatre pays), des rôles à tous les niveaux
 * (programme, projet, workpackage), trois personnes sans aucun rôle (Reader par défaut : sans rôle).
 *
 * Aucune personne fictive n'a d'adresse e-mail : rien n'est envoyé, aucune invitation ne part, personne ne peut s'y connecter.
 * Seul le compte qui lance la démo y figure, avec son adresse.
 *
 * Elle représente plusieurs centaines d'écritures : elle est découpée en étapes et s'arrête avant la limite de 6 minutes d'Apps Script.
 * Il suffit de relancer A2_SEED_DEMO jusqu'à « Démo complète » : elle reprend à l'étape suivante (propriété PPM_DEMO_STEP).
 * Les dates se calculent à partir d'aujourd'hui (le projet a commencé il y a douze semaines).
 */

var DEMO_BUDGET_MS = 150000; // une exécution lance de nouvelles étapes tant qu'elle a duré moins que cela

// ---------------------------------------------------------------- outils

function demoContext_() {
  var me = String(Session.getActiveUser().getEmail() || adminEmails()[0] || '').toLowerCase();
  var today = todayStr(), hol = loadHolidayMap('FR');
  var start0 = nextWorkingDay(addCalendarDays(today, -84), hol);
  var d = { me: me, a: { actor: me, source: 'setup' }, today: today, hol: hol, start0: start0 };
  d.wd = function (n) { return addWorkingDays(start0, n, hol); };
  d.day = function (n) { return addCalendarDays(today, n); };
  var latest = function (rows) { return rows[rows.length - 1]; }; // l'ordre des feuilles est l'ordre de création : la dernière est la plus récente
  d.person = function (name) {
    var r = latest(repoList('Resource', function (x) { return x.name === name; }));
    if (!r) throw new PpmError('NOT_FOUND', 'Démo : personne introuvable : ' + name);
    return r;
  };
  d.project = function (code) {
    var p = latest(repoList('Project', function (x) { return x.code === code; }));
    if (!p) throw new PpmError('NOT_FOUND', 'Démo : projet introuvable : ' + code);
    return p;
  };
  d.wp = function (code, wbs) {
    var project = d.project(code);
    var w = latest(repoList('WorkPackage', function (x) { return x.project_id === project.id && x.wbs_code === wbs; }));
    if (!w) throw new PpmError('NOT_FOUND', 'Démo : workpackage introuvable : ' + code + ' ' + wbs);
    return w;
  };
  d.item = function (code, name) {
    var project = d.project(code);
    var i = latest(repoList('PlanItem', function (x) { return x.project_id === project.id && x.name === name; }));
    if (!i) throw new PpmError('NOT_FOUND', 'Démo : élément introuvable : ' + code + ' ' + name);
    return i;
  };
  d.call = function (action, params) {
    var r = handleRequest({ action: action, params: params, apiVersion: PPM_API_VERSION }, me);
    if (!r.ok) throw new PpmError(r.error.code, 'Démo, ' + action + ' : ' + r.error.message);
    return r.data;
  };
  /** Comme d.call, mais avec le niveau d'un auteur imposé (la démo est lancée par un administrateur, dont les changements n'ont personne au-dessus et ne sont donc à valider par personne). */
  d.callAs = function (action, params, level) {
    var ctx = buildContext(me);
    ctx.actx = Object.assign({}, ctx.actx, { actor_level: level });
    return API_ACTIONS[action](params, ctx);
  };
  return d;
}

function demoShift_(d, code, name, startDelta, finishDelta) {
  var it = d.item(code, name), patch = {};
  if (startDelta) patch.planned_start = addWorkingDays(it.planned_start, startDelta, d.hol);
  if (finishDelta) patch.planned_finish = addWorkingDays(it.planned_finish, finishDelta, d.hol);
  repoUpdate('PlanItem', it.id, patch, null, d.a);
}

// ---------------------------------------------------------------- étapes

function demoPeople_(d) {
  var teams = {};
  DEMO_TEAMS.forEach(function (t) {
    teams[t[0]] = repoInsert('HierarchicalTeam', { name: t[0], parent_team_id: t[1] ? teams[t[1]].id : '', cost_center: t[2] }, d.a);
  });
  DEMO_PEOPLE.forEach(function (p) {
    repoInsert('Resource', {
      resource_type: p[1], name: p[0], team_id: teams[p[2]].id, job_function: p[3], organization: p[4], country: p[5],
      supplier: p[6] || '', capacity_days_month: p[1] === 'Interne' ? 18 : 20
    }, d.a);
  });
  DEMO_TEAMS.forEach(function (t) { repoUpdate('HierarchicalTeam', teams[t[0]].id, { manager_resource_id: d.person(t[3]).id }, null, d.a); });
  if (!findResourceByEmail(d.me)) {
    repoInsert('Resource', {
      resource_type: 'Interne', name: d.me.split('@')[0].split(/[._-]+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '), email: d.me, team_id: teams['DTE'].id, country: 'FR', capacity_days_month: 18,
      job_function: 'Directeur de programme', organization: 'Maison mère'
    }, d.a);
  }
}

function demoProjects_(d) {
  var me = findResourceByEmail(d.me);
  var prog = repoInsert('Program', { code: 'NAC', name: 'Programme nacelle', status: 'Actif', leader_resource_id: me.id, description: 'Programme de démonstration : nacelle moteur et systèmes associés.' }, d.a);
  DEMO_PROJECTS.forEach(function (p) {
    repoInsert('Project', {
      code: p[0], name: p[1], program_id: prog.id, manager_resource_id: d.person(p[3]).id, status: p[2], holiday_country: 'FR',
      start_date: d.wd(p[4]), end_date: d.wd(p[5]), cpn: p[6], cpn_label: p[7]
    }, d.a);
  });
}

/** Rôles du programme et des projets, puis membres de projet (les rôles de workpackage viennent après le découpage). */
function demoRoles_(d) {
  var me = findResourceByEmail(d.me), prog = repoList('Program', function (x) { return x.code === 'NAC'; })[0];
  var add = function (resourceId, role, type, scopeId) {
    repoInsert('RoleAssignment', { resource_id: resourceId, role_code: role, scope_type: type, scope_id: scopeId, start_date: d.wd(0) }, d.a);
  };
  add(me.id, 'PL', 'program', prog.id);
  DEMO_ROLES.forEach(function (r) {
    if (r[2] === 'program') add(d.person(r[0]).id, r[1], 'program', prog.id);
    else if (r[2] === 'project') add(d.person(r[0]).id, r[1], 'project', d.project(r[3]).id);
  });
  // les « membres du projet » ne sont plus posés au niveau du projet : la migration en ferait un Contributor de CHAQUE livrable (27 membres × 50 livrables = 1 350 lignes, 600 Ko
  // dans la feuille Rôles). Ils sont posés Contributors de quelques livrables, dans demoWpRoles_, une fois le planning créé.
  add(me.id, 'CP', 'project', d.project('NAC-1').id);
}

/** Rôles de responsable et de membre sur les workpackages. */
function demoWpRoles_(d) {
  DEMO_ROLES.forEach(function (r) {
    if (r[2] !== 'wp') return;
    var ref = r[3].split(':');
    repoInsert('RoleAssignment', { resource_id: d.person(r[0]).id, role_code: r[1], scope_type: 'workpackage', scope_id: d.wp(ref[0], ref[1]).id, start_date: d.wd(0) }, d.a);
  });
  // les membres de chaque projet : Contributors de trois livrables, répartis sur tout le planning (rôle posé directement au niveau 6 : pas de migration de masse)
  var k = 0;
  DEMO_MEMBERS.forEach(function (m) {
    var project = d.project(m[0]);
    var items = repoList('PlanItem', function (x) { return x.project_id === project.id && x.item_type === 'Livrable'; })
      .sort(function (a, b) { return String(a.planned_start).localeCompare(String(b.planned_start)) || String(a.name).localeCompare(String(b.name), 'fr'); });
    for (var i = 1; i < m.length; i++, k++) {
      var picked = {};
      for (var t = 0; t < 3 && items.length; t++) {
        var item = items[(k * 3 + t * 7) % items.length];
        if (picked[item.id]) continue;
        picked[item.id] = true;
        repoInsert('RoleAssignment', { resource_id: d.person(m[i]).id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: item.id, start_date: d.wd(0) }, d.a);
      }
    }
  });
}

/** Workpackages (premier niveau puis sous-niveaux) et éléments d'un ou plusieurs projets. */
function demoPlan_(d, codes) {
  DEMO_WPS.filter(function (w) { return codes.indexOf(w[0]) >= 0; }).forEach(function (w) {
    var parent = w[1].indexOf('.') > 0 ? d.wp(w[0], w[1].slice(0, w[1].lastIndexOf('.'))) : null;
    repoInsert('WorkPackage', {
      project_id: d.project(w[0]).id, parent_wp_id: parent ? parent.id : '', wbs_code: w[1], name: w[2], owner_resource_id: d.person(w[3]).id, charge_code: w[4],
      cpn: w[5] || '', cpn_label: w[6] || ''
    }, d.a);
  });
  DEMO_ITEMS.filter(function (i) { return codes.indexOf(i[0]) >= 0; }).forEach(function (i) {
    var o = i[7] || {}, milestone = o.type === 'Jalon', wp = i[1] ? d.wp(i[0], i[1]) : null;
    var finish = milestone ? d.wd(i[3]) : d.wd(i[3] + i[4] - 1);
    repoInsert('PlanItem', {
      project_id: d.project(i[0]).id, wp_id: wp ? wp.id : '', item_type: milestone ? 'Jalon' : 'Livrable', name: i[2], owner_resource_id: i[5] ? d.person(i[5]).id : '',
      planned_start: o.nodate ? '' : (milestone ? finish : d.wd(i[3])), planned_finish: o.nodate ? '' : finish, progress_pct: 0, status: 'À faire', milestone_category: milestone ? o.category : ''
    }, d.a);
  });
  DEMO_REQUIREMENTS.filter(function (r) { return codes.indexOf(r[0]) >= 0; }).forEach(function (r) {
    var jalon = d.item(r[0], r[1]);
    for (var k = 2; k < r.length; k++) repoInsert('MilestoneRequirement', { milestone_id: jalon.id, deliverable_id: d.item(r[0], r[k]).id }, d.a);
  });
}

/** Enveloppe du projet : 8 % au-dessus du coût prévu, répartie 10 % au-dessus du coût de chaque workpackage de premier niveau, sauf un (15 % en dessous) pour montrer un dépassement. */
function demoEnvelope_(d) {
  var p1 = d.project('NAC-1'), v = d.call('budget.envelope.get', { projectId: p1.id });
  var top = v.rows.filter(function (r) { return r.depth === 0 && r.cost > 0; });
  var allocations = top.map(function (r, i) { return { wpId: r.wp_id, amount: Math.round(r.cost * (i === 1 ? 0.85 : 1.1)) }; });
  var spread = allocations.reduce(function (s, a) { return s + a.amount; }, 0);
  d.call('budget.envelope.set', { projectId: p1.id, authorized: Math.max(Math.round(v.totals.cost * 1.08), spread), allocations: allocations });
}

/** Une tranche de la migration des rôles (A9_MIGRER_ROLES) sur la démo ; sans effet une fois la migration faite. */
function demoLevels_(d) {
  rolesMigrate_(d.a, false);
}

function demoDeps_(d) {
  DEMO_DEPS.forEach(function (x) {
    repoInsert('Dependency', { predecessor_id: d.item(x[0], x[1]).id, successor_id: d.item(x[0], x[2]).id, dep_type: x[3], lag_days: x[4] }, d.a);
  });
}

/**
 * B0 figée au lancement ; puis le planning évolue (retards, ajouts, retrait, changement de responsable) ; B1 ; nouvelles dérives ; une demande en attente.
 * Deux baselines de workpackage (0.15.5) : WP 2 Essais a sa référence locale B0 figée juste après B1, avant que ses dérives n'apparaissent (ses écarts se lisent contre elle ou contre
 * B1 du projet) ; WP 1 Conception a une B0 figée au niveau d'un Workpackage leader, donc à valider par le chef de projet (elle apparaît dans « Changements à valider »).
 */
function demoBaselines_(d) {
  var p1 = d.project('NAC-1').id;
  d.call('baselines.create', { projectId: p1, label: 'B0', justification: 'Planning validé en revue de lancement' });
  // évolutions après B0 : faites à un niveau de Deliverable owner (niveau 5), donc « à valider » par les niveaux du dessus ; l'administrateur qui lance la démo n'a personne au-dessus
  var adminActx = d.a;
  d.a = Object.assign({}, adminActx, { actor_level: 5 });
  demoShift_(d, 'NAC-1', 'Essais d’éprouvettes matériaux', 0, 18);
  demoShift_(d, 'NAC-1', 'Maquette soufflerie', 0, 15);
  demoShift_(d, 'NAC-1', 'Note de calcul de fatigue', 0, 10);
  demoShift_(d, 'NAC-1', 'Logiciel de régulation thermique', 0, 12);
  repoUpdate('PlanItem', d.item('NAC-1', 'Note de calcul de fatigue').id, { owner_resource_id: d.person('Rahul Sharma').id }, null, d.a);
  [['1.2', 'Étude de bruit nacelle', 62, 15, 'Émilie Fabre'], ['1.4', 'Étude thermique complémentaire', 66, 12, 'Greta Hoffmann'], ['1.3', 'Rapport d’écarts matériaux', 75, 10, 'Nadia Benali']]
    .forEach(function (n) {
      repoInsert('PlanItem', {
        project_id: p1, wp_id: d.wp('NAC-1', n[0]).id, item_type: 'Livrable', name: n[1], owner_resource_id: d.person(n[4]).id,
        planned_start: d.wd(n[2]), planned_finish: d.wd(n[2] + n[3] - 1), progress_pct: 0, status: 'À faire'
      }, d.a);
    });
  d.call('wbs.delete', { kind: 'item', id: d.item('NAC-1', 'Moyens de contrôle non destructif').id });
  d.a = adminActx;
  d.call('baselines.create', { projectId: p1, label: 'B1', justification: 'Replanification après le retard des éprouvettes matériaux' });
  d.call('baselines.create', { projectId: p1, scopeType: 'workpackage', scopeId: d.wp('NAC-1', '2').id, label: 'B0', justification: 'Référence locale des essais, figée avec le plan de campagne soufflerie' });
  // dérives après B1 (au même niveau)
  d.a = Object.assign({}, adminActx, { actor_level: 5 });
  demoShift_(d, 'NAC-1', 'Campagne d’essais statiques', 0, 6);
  demoShift_(d, 'NAC-1', 'Rapport soufflerie', 7, 7);
  demoShift_(d, 'NAC-1', 'Plans de définition structure', 0, 8);
  demoShift_(d, 'NAC-1', 'Optimisation de la lèvre d’entrée d’air', 0, 5);
  demoShift_(d, 'NAC-1', 'Dossier de certification complet', 0, 7);
  d.a = adminActx;
  d.callAs('baselines.create', { projectId: p1, scopeType: 'workpackage', scopeId: d.wp('NAC-1', '1').id, label: 'B0', justification: 'Conception : plan de la revue critique figé par le responsable du workpackage' }, 3);
  d.call('baselines.request', { projectId: p1, label: 'B2', justification: 'Replanifier la revue critique de conception et la campagne soufflerie après le retard de la maquette' });
}

/** Historique de déclarations d'avancement (trois dates au plus par livrable), avec quelques commentaires et des déclarations anciennes. */
function demoProgress_(d, codes) {
  var n = 0;
  DEMO_ITEMS.filter(function (i) { return codes.indexOf(i[0]) >= 0; }).forEach(function (i) {
    var o = i[7] || {}, pct = i[6];
    if (o.type === 'Jalon') {
      if (pct === 100) {
        var j = d.item(i[0], i[2]);
        repoUpdate('PlanItem', j.id, { progress_pct: 100, status: 'Terminé', actual_finish: j.planned_finish }, null, d.a);
      }
      return;
    }
    if (pct <= 0) return;
    var it = d.item(i[0], i[2]), owner = d.person(i[5]).id;
    var last = o.stale ? -35 : -(2 + (n % 9));
    var lastDate = d.day(last);
    if (pct === 100 && it.planned_finish < lastDate) lastDate = it.planned_finish < d.day(-1) ? it.planned_finish : d.day(-1);
    var steps = pct === 100 ? [30, 70, 100] : [Math.round(pct * 0.35), Math.round(pct * 0.7), pct];
    var dates = [addCalendarDays(lastDate, -36), addCalendarDays(lastDate, -18), lastDate];
    for (var k = 0; k < 3; k++) {
      if (dates[k] < it.planned_start || steps[k] <= 0) continue;
      repoInsert('ProgressUpdate', {
        deliverable_id: it.id, resource_id: owner, declared_at: dates[k] + 'T09:00:00.000Z', progress_pct: steps[k],
        comment: k === 2 ? (o.comment || '') : ''
      }, d.a);
    }
    n++;
  });
}

function demoRisks_(d) {
  DEMO_RISKS.forEach(function (r) {
    repoInsert('RiskOpportunity', {
      project_id: d.project(r[0]).id, kind: r[1], title: r[2], description: r[1] === 'Risque' ? 'Suivi dans le registre du projet.' : 'Piste à exploiter.',
      linked_item_id: r[3] ? d.item(r[0], r[3]).id : '', financial_value: r[10] || '', probability: r[4], impact: r[5],
      owner_resource_id: d.person(r[6]).id, strategy: r[7], status: r[8], review_date: d.day(15), treatment_due: r[8] === 'Clos' ? '' : d.day(r[9])
    }, d.a);
  });
}

/** L'équipe de la démo par son code. */
function demoTeam_(code) { return repoList('HierarchicalTeam', function (t) { return t.name === code; })[0]; }

/**
 * Les exercices de la démo : l'année en cours en exécution, la suivante en préparation, avec le coût d'un ETP par pays. Ce sont des paramètres globaux : s'ils existent déjà (exercice réel,
 * coût saisi par l'administrateur), la démo les réutilise et n'y touche pas.
 */
function demoExercises_() {
  var year = Number(todayStr().slice(0, 4));
  var find = function (y, status) { return repoList('Exercise', function (e) { return Number(e.year) === y; })[0] || repoInsert('Exercise', { year: y, status: status }, SETUP_ACTX); };
  var out = { year: year, exec: find(year, 'Exécution'), prep: find(year + 1, 'Préparation') };
  [[year, 1], [year + 1, 1.03]].forEach(function (yr) {
    [['FR', 118000], ['DE', 132000], ['UK', 126000], ['IN', 38000]].forEach(function (c) {
      if (!repoList('EtpCost', function (r) { return r.country === c[0] && Number(r.year) === yr[0]; })[0]) repoInsert('EtpCost', { country: c[0], year: yr[0], annual_cost: Math.round(c[1] * yr[1]) }, SETUP_ACTX);
    });
  });
  return out;
}

/**
 * Budget par équipe de NAC-1. Exercice en exécution : attendu et accordé d'après les parts existantes (l'équipe ESS est accordée en dessous de ses parts : un clash). Exercice en préparation :
 * cinq livrables de l'année suivante avec leurs parts par équipe, et un budget attendu par équipe (une équipe a de l'argent non réparti, une autre est en dépassement).
 */
function demoExercise_(d) {
  var ex = demoExercises_(), project = d.project('NAC-1');
  var rootOf = function (t) { return teamLevel_(t) === 4 && t.parent_team_id ? repoGet('HierarchicalTeam', t.parent_team_id) : t; };
  var ids = {};
  repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable' && i.exercise_id === ex.exec.id; }).forEach(function (i) { ids[i.id] = true; });
  var parts = {};
  repoList('BudgetLine', function (l) { return l.cost_type === 'Équipe' && ids[l.deliverable_id]; }).forEach(function (l) { var r = rootOf(repoGet('HierarchicalTeam', l.team_id)); parts[r.id] = (parts[r.id] || 0) + Number(l.planned_amount); });
  Object.keys(parts).forEach(function (tid) {
    var t = repoGet('HierarchicalTeam', tid), p = parts[tid];
    repoInsert('TeamBudget', { exercise_id: ex.exec.id, project_id: project.id, team_id: tid,
      expected: Math.round(p * 1.12 / 1000) * 1000, granted: Math.round(p * (t.name === 'ESS' ? 0.82 : 1.04) / 1000) * 1000 }, d.a);
  });
  var wp = repoList('WorkPackage', function (w) { return w.project_id === project.id && isBlank(w.parent_wp_id); })[0];
  // dates indicatives, dans la fenêtre du planning existant : des livrables datés de l'an prochain déplaceraient le chemin critique du projet (et ses constats)
  var last = repoList('PlanItem', function (i) { return i.project_id === project.id; }).reduce(function (m, i) { return String(i.planned_finish || '') > m ? String(i.planned_finish) : m; }, '');
  DEMO_NEXT_YEAR.forEach(function (n) {
    var finish = d.day(n[3]) > last ? last : d.day(n[3]);
    var item = repoInsert('PlanItem', { project_id: project.id, wp_id: wp ? wp.id : '', item_type: 'Livrable', name: n[0], status: 'À faire', progress_pct: 0,
      planned_start: d.day(n[2]) > finish ? finish : d.day(n[2]), planned_finish: finish, exercise_id: ex.prep.id }, d.a);
    n[1].forEach(function (s) { d.call('budget.line.save', { values: { deliverable_id: item.id, team_id: demoTeam_(s[0]).id, planned_amount: s[1] }, exerciseId: ex.prep.id }); });
  });
  DEMO_EXPECTED.forEach(function (e) {
    repoInsert('TeamBudget', { exercise_id: ex.prep.id, project_id: project.id, team_id: demoTeam_(e[0]).id, expected: e[1] }, d.a);
  });
}

function demoBudget_(d, from, to) {
  DEMO_BUDGET.slice(from, to).forEach(function (b) {
    var values = { deliverable_id: d.item(b[0], b[1]).id };
    if (b[2] === 'f') { values.resource_id = d.person(b[3]).id; values.fixed_amount = b[4]; }
    else { values.team_id = demoTeam_(b[3]).id; values.planned_amount = b[4]; }
    d.call('budget.line.save', { values: values, exerciseId: demoExercises_().exec.id });   // les livrables de la démo sont ceux de l'exercice en exécution
  });
}

function demoOrders_(d) {
  DEMO_ORDERS.forEach(function (o) {
    var status = o[5], launched = o[6], values = {
      po_number: o[0], cpn: o[1], resource_id: d.person(o[2]).id, description: o[3], amount: o[4], status: status, gr_due_date: d.day(o[7]),
      start_date: d.day(launched), end_date: d.day(o[7])
    };
    if (status !== 'À faire') values.launched_on = d.day(launched);
    if (status === 'GR' || status === 'Terminée') values.gr_on = d.day(o[7] < 0 ? o[7] + 2 : -3);
    if (status === 'Terminée') values.closed_on = d.day(o[7] < 0 ? o[7] + 6 : -1);
    var links = [];
    for (var k = 8; k < o.length; k++) {
      links.push({ deliverable_id: d.item('NAC-1', o[k][0]).id, amount: o[k][1] });
    }
    d.call('po.save', { values: values, links: links });
  });
}

function demoFindings_(d) {
  runRules();
}

var DEMO_STEPS = [
  { name: 'Équipes et personnes', run: function (d) { demoPeople_(d); } },
  { name: 'Programme et projets', run: function (d) { demoProjects_(d); } },
  { name: 'Rôles de l’organigramme', run: function (d) { demoRoles_(d); } },
  { name: 'Découpage et planning de NAC-1', run: function (d) { demoPlan_(d, ['NAC-1']); } },
  { name: 'Rôles sur les workpackages', run: function (d) { demoWpRoles_(d); } },
  { name: 'Dépendances', run: function (d) { demoDeps_(d); } },
  { name: 'Baselines et évolutions du planning', run: function (d) { demoBaselines_(d); } },
  { name: 'Avancement de NAC-1', run: function (d) { demoProgress_(d, ['NAC-1']); } },
  { name: 'Risques et opportunités', run: function (d) { demoRisks_(d); } },
  { name: 'Budget de NAC-1 (1/2)', run: function (d) { demoBudget_(d, 0, 20); } },
  { name: 'Budget de NAC-1 (2/2)', run: function (d) { demoBudget_(d, 20, 60); } },
  { name: 'Budget par équipe : exercices en exécution et en préparation', run: function (d) { demoExercise_(d); } },
  { name: 'Enveloppe budgétaire de NAC-1', run: function (d) { demoEnvelope_(d); } },
  { name: 'Commandes d’achat', run: function (d) { demoOrders_(d); } },
  { name: 'Actualités de NAC-1 : réunions', run: function (d) { demoNewsMeetings_(d); } },
  { name: 'Actualités : actions, synthèse du jour, réunions à trier', run: function (d) { demoNewsActions_(d); } },
  // Rôles aux huit niveaux (0.15.5) : les rôles de workpackage sont semés avec les anciens codes puis migrés, ce qui exerce A9_MIGRER_ROLES (responsables de workpackage, Deliverable
  // owners, Contributors des workpackages). Un lancement écrit au plus MIGRATION_MAX_WRITES lignes ; les étapes en trop ne font rien.
  { name: 'Rôles aux huit niveaux (1/3)', run: function (d) { demoLevels_(d); } },
  { name: 'Rôles aux huit niveaux (2/3)', run: function (d) { demoLevels_(d); } },
  { name: 'Rôles aux huit niveaux (3/3)', run: function (d) { demoLevels_(d); } },
  { name: 'Constats du moteur de règles', run: function (d) { demoFindings_(d); } }
];

/**
 * Crée la démo, étape par étape ; relançable jusqu'à « Démo complète ». Le compte qui la lance doit être administrateur.
 * Une démo déjà complète n'est jamais recréée (pas de doublons).
 */
/** Relit la base après la démo : chaque projet a-t-il son planning ? Une démo « terminée » sans livrables ne doit jamais être annoncée comme complète. */
function demoVerify_() {
  var progs = repoList('Program', function (p) { return p.code === 'NAC'; }), pid = {}; progs.forEach(function (p) { pid[p.id] = true; });
  var projects = repoList('Project', function (p) { return pid[p.program_id]; }), ids = {}; projects.forEach(function (p) { ids[p.id] = true; });
  var items = repoList('PlanItem', function (i) { return ids[i.project_id]; }), wps = repoList('WorkPackage', function (w) { return ids[w.project_id]; });
  var iid = {}; items.forEach(function (i) { iid[i.id] = true; });
  var deps = repoList('Dependency', function (d) { return iid[d.predecessor_id]; }).length, lines = repoList('BudgetLine', function (b) { return iid[b.deliverable_id]; }).length;
  var meetings = repoList('Meeting', function (m) { return ids[m.project_id]; }).length;
  var empty = projects.filter(function (p) { return !items.some(function (i) { return i.project_id === p.id; }); }).map(function (p) { return p.code; });
  var text = projects.length + (projects.length > 1 ? ' projets, ' : ' projet, ') + wps.length + ' workpackages, ' + items.length + ' livrables et jalons, ' + deps + ' dépendances, ' + lines + ' lignes de budget, ' + meetings + ' réunions';
  var ok = projects.length === 1 && items.length >= 40 && wps.length >= 15 && deps > 0 && lines > 0 && meetings > 0 && !empty.length;
  return { ok: ok, text: ok ? text : text + (empty.length ? ' ; projets sans aucun livrable : ' + empty.join(', ') : '') };
}

function seedDemo_() {
  var t0 = Date.now(), next = Number(getProp(PROP.DEMO_STEP, '0')) || 0;
  if (next === 0 && repoList('Program', function (p) { return p.code === 'NAC'; }).length) {
    var done = 'La démo existe déjà (programme NAC) : rien n’a été recréé.';
    console.log(done);
    return done;
  }
  var d = demoContext_(), ran = [];
  for (var i = next; i < DEMO_STEPS.length; i++) {
    if (i > next && Date.now() - t0 >= DEMO_BUDGET_MS) break;   // >= : un budget de 0 veut dire « une étape par lancement », même si l'étape a duré moins d'une milliseconde
    try {
      DEMO_STEPS[i].run(d);
    } catch (err) {
      throw new PpmError(err && err.code ? err.code : 'INTERNAL', 'Démo, étape ' + (i + 1) + '/' + DEMO_STEPS.length + ' « ' + DEMO_STEPS[i].name + ' » : ' +
        (err && err.message ? err.message : err) + '. Les étapes précédentes sont conservées ; corrigez la cause puis relancez.');
    }
    ran.push(DEMO_STEPS[i].name);
    setProp(PROP.DEMO_STEP, String(i + 1));
  }
  var at = Number(getProp(PROP.DEMO_STEP, '0')) || 0, msg;
  if (at >= DEMO_STEPS.length) {
    deleteProp(PROP.DEMO_STEP);
    var v = demoVerify_();
    msg = v.ok ? 'Démo complète : programme NAC, 1 projet, ' + DEMO_PEOPLE.length + ' personnes, ' + DEMO_TEAMS.length + ' équipes. Relu dans la base : ' + v.text + '. Ouvrez la page Overview.' + oldDemoNote_()
      : 'DÉMO INCOMPLÈTE malgré toutes les étapes : ' + v.text + '. Exécutez A6_EFFACER_DEMO (deux fois) puis A2_SEED_DEMO, et envoyez-moi le journal.';
  } else {
    msg = 'Démo en cours : étape ' + at + ' sur ' + DEMO_STEPS.length + ' terminée (' + ran.join(' ; ') + '). Relancez A2_SEED_DEMO pour continuer. ⚠ TANT QUE VOUS NE VOYEZ PAS « Démo complète », LA DÉMO EST INCOMPLÈTE (pas de planning, de budget ni d’actualités).';
  }
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- actualités du projet (0.12.0)

/** Jour et mois d'un jour relatif à aujourd'hui, tels qu'on les écrit dans un compte rendu : « 16/10 ». */
function demoDM_(d, n) { var s = d.day(n); return s.slice(8, 10) + '/' + s.slice(5, 7); }

/** Les réunions de NAC-1 : [jours avant aujourd'hui, titre, agenda ou saisie à la main, participants, texte du compte rendu]. */
function demoMeetings_(d) {
  var f = function (n) { return demoDM_(d, n); };
  return [
    [1, 'Revue d’avancement hebdomadaire NAC-1', true, 'Anaïs Moreau, Thomas Weber, Hélène Roux, Ravi Patel',
      ['Résumé', 'Point hebdomadaire : les essais statiques prennent du retard et la revue critique de conception est maintenue.', '',
        'Décisions', '- La revue critique de conception (CDR) est maintenue.', '- Les essais de fatigue passent avant les essais statiques.', '',
        'Étapes suivantes', '- [Thomas Weber] Confirmer la date de la campagne d’essais statiques avant le ' + f(8),
        '- [Hélène Roux] Livrer la note de calcul de fatigue pour le ' + f(6), '- [Anaïs Moreau] Informer le programme du glissement de la fin du plan'].join('\n')],
    [2, 'Point fournisseur Alpha Test', false, 'Anaïs Moreau, Thomas Weber, Carl Weber',
      ['Point avec le fournisseur des essais.', 'Décision : le devis complémentaire est accepté sous réserve de la réception.',
        'Action : relancer le fournisseur sur le planning des essais — Thomas Weber — ' + f(7),
        'Action : valider le devis complémentaire — Anaïs Moreau — ' + f(10)].join('\n')],
    [4, 'Préparation de la revue préliminaire de conception (PDR)', true, 'Marc Lefèvre, Hélène Roux, Paul Girard, Nadia Benali, Sophie Martin',
      ['Résumé', 'Dernière préparation de la PDR : dossier structure complet, aérodynamique à finaliser.', '',
        'Décisions', '- La PDR a lieu comme prévu, avec le dossier aérodynamique en annexe.', '',
        'Prochaines étapes', '- [Paul Girard] Finaliser le rapport aérodynamique préliminaire pour le ' + f(3),
        '- [Nadia Benali] Compléter la sélection des matériaux composites avant le ' + f(5), '- Sophie Martin: valider l’architecture système antigivrage pour le ' + f(4)].join('\n')],
    [5, 'Atelier risques NAC-1', false, 'Anaïs Moreau, Lucie Perrin, Olivier Faure',
      ['Atelier de revue du registre des risques.', 'Décision : le risque de retard fournisseur passe en critique.',
        'Action : proposer un plan de traitement du retard fournisseur — Lucie Perrin — ' + f(9),
        'Action : mettre à jour le registre des risques — Lucie Perrin — ' + f(4)].join('\n')],
    [7, 'Comité de pilotage programme nacelle', true, 'Anaïs Moreau, Marc Lefèvre, Karim Haddad',
      ['Résumé', 'Comité de pilotage : la fin visée du projet est maintenue, un point sur le budget externe est demandé.', '',
        'Décisions', '- Le budget externe est suivi chaque semaine jusqu’à la CDR.', '',
        'Étapes suivantes', '- [Anaïs Moreau] Présenter la consommation du budget externe au prochain comité pour le ' + f(14),
        '- [Karim Haddad] Confirmer le lancement des outillages pour le ' + f(20)].join('\n')],
    [8, 'Point soufflerie', true, 'Ravi Patel, Paul Girard, Thomas Weber',
      ['Résumé', 'Les essais en soufflerie démarrent avec une semaine de retard sur le créneau initial.', '',
        'Étapes suivantes', '- [Ravi Patel] Réserver un nouveau créneau en soufflerie avant le ' + f(5),
        '- Paul Girard: transmettre les cas de charge à la soufflerie pour le ' + f(2)].join('\n')],
    [10, 'Revue de lancement des outillages', false, 'Karim Haddad, Étienne Roche, Yann Leroy',
      ['Revue de lancement.', 'Décision : les outillages sont lancés après la CDR.',
        'Action : chiffrer les outillages de drapage — Étienne Roche — ' + f(12),
        'Action : préparer les gammes de fabrication — Yann Leroy — ' + f(25)].join('\n')],
    [13, 'Point certification', true, 'Olivier Faure, Lucie Perrin, Anaïs Moreau',
      ['Résumé', 'Premier point sur le dossier de certification : le plan de conformité est à stabiliser.', '',
        'Décisions', '- Le plan de conformité est partagé avec l’autorité avant la fin du mois.', '',
        'Étapes suivantes', '- [Olivier Faure] Stabiliser le plan de conformité pour le ' + f(6)].join('\n')]
  ];
}

function demoNewsMeetings_(d) {
  var nac1 = d.project('NAC-1');
  d.call('news.settings.set', { projectId: nac1.id, enabled: true, keywords: 'NAC-1, nacelle' });
  demoMeetings_(d).forEach(function (m, i) {
    var r = d.call('news.meeting.add', { projectId: nac1.id, title: m[1], held_on: d.day(-m[0]), participants: m[3], text: m[4] });
    if (m[2]) repoUpdate('Meeting', r.meeting.id, { source: 'Agenda', event_id: 'demo-evt-' + (i + 1), dedupe_key: 'ev:demo-evt-' + (i + 1), added_by: 'collecteur' }, null, d.a);
  });
}

function demoNewsActions_(d) { // (il n'y a plus de réunions à trier : elles demandaient au moins deux projets candidats)
  var nac1 = d.project('NAC-1');
  var byTitle = function (t) { return repoList('Meeting', function (m) { return m.title === t && m.project_id === nac1.id; })[0]; };
  var actionOf = function (title, startsWith) {
    var m = byTitle(title);
    return m ? repoList('NewsAction', function (a) { return a.meeting_id === m.id && a.text.indexOf(startsWith) === 0; })[0] : null;
  };
  var link = function (title, startsWith, item) { var a = actionOf(title, startsWith); if (a) repoUpdate('NewsAction', a.id, { item_id: d.item('NAC-1', item).id }, null, d.a); };
  var answer = function (title, startsWith, decision) { var a = actionOf(title, startsWith); if (a) d.call('news.action.decide', { id: a.id, decision: decision }); };
  // livrables concernés
  link('Revue d’avancement hebdomadaire NAC-1', 'Livrer la note de calcul de fatigue', 'Note de calcul de fatigue');
  link('Préparation de la revue préliminaire de conception (PDR)', 'Finaliser le rapport aérodynamique', 'Rapport aérodynamique préliminaire');
  link('Préparation de la revue préliminaire de conception (PDR)', 'Compléter la sélection des matériaux', 'Sélection des matériaux composites');
  link('Préparation de la revue préliminaire de conception (PDR)', 'valider l’architecture système', 'Architecture système antigivrage');
  // réponses des personnes : des actions acceptées, une contestée, des terminées
  answer('Revue d’avancement hebdomadaire NAC-1', 'Livrer la note de calcul de fatigue', 'accept');
  answer('Revue d’avancement hebdomadaire NAC-1', 'Confirmer la date de la campagne', 'accept');
  answer('Point fournisseur Alpha Test', 'relancer le fournisseur', 'accept');
  answer('Atelier risques NAC-1', 'proposer un plan de traitement', 'contest');
  answer('Préparation de la revue préliminaire de conception (PDR)', 'Finaliser le rapport aérodynamique', 'accept');
  answer('Point certification', 'Stabiliser le plan de conformité', 'done');
  answer('Revue de lancement des outillages', 'chiffrer les outillages', 'done');
  // synthèse du jour publiée par le chef de projet, sans envoi de mail
  d.call('news.digest.publish', { projectId: nac1.id, notify: false, text: [
    'Décisions : la revue critique de conception est maintenue ; les essais de fatigue passent avant les essais statiques (Revue d’avancement hebdomadaire NAC-1) ; le devis complémentaire du fournisseur est accepté sous réserve de la réception (Point fournisseur Alpha Test).',
    'Dates qui bougent : les essais en soufflerie démarrent avec une semaine de retard (Point soufflerie) ; la fin du plan reste à +2 jours ouvrés sur la baseline.',
    'Risques : le retard du fournisseur des essais passe en critique (Atelier risques NAC-1) ; le budget externe est suivi chaque semaine jusqu’à la CDR (Comité de pilotage programme nacelle).',
    'Blocages : le dossier aérodynamique de la PDR n’est pas finalisé ; le créneau de soufflerie reste à confirmer.',
    'Actions : Thomas Weber — confirmer la campagne d’essais statiques — ' + demoDM_(d, 8) + ' — Campagne d’essais statiques ; Hélène Roux — livrer la note de calcul de fatigue — ' + demoDM_(d, 6) + ' — Note de calcul de fatigue ; Paul Girard — finaliser le rapport aérodynamique — ' + demoDM_(d, 3) + ' — Rapport aérodynamique préliminaire.'
  ].join('\n') });
}
