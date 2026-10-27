/**
 * PPM Core — 0.17.4 : l'exercice budgétaire dans un classeur Google Sheet (export et import).
 *
 * La préparation de l'exercice se fait d'abord dans un tableur : le budget attendu par équipe et par projet (avant l'été), puis les parts de chaque livrable par équipe (septembre), puis
 * l'accordé (décembre, février, avril). On exporte l'exercice choisi, on le modifie dans le tableur, on le réimporte. Trois actions, pour qui saisit l'exercice (droit `exercise.edit` :
 * chef de projet et au-dessus ; chacun n'agit que sur les projets où il a ce droit) :
 *   exercise.import.template  crée dans Drive un classeur prérempli avec l'exercice (c'est l'export) et le partage avec la personne ;
 *   exercise.import.analyze   lit un classeur et rend un RAPPORT sans rien écrire (chaque erreur avec son onglet et sa ligne) ;
 *   exercise.import.run       applique le plan, par lots reprenables ; copie de sécurité avant le premier lot si des valeurs existantes vont changer.
 *
 * ONGLETS. « Budget par équipe » : Projet (code) · Équipe (nom) · Attendu (€) · Accordé (€). « Parts des livrables » (facultatif) : Projet · Code WBS du workpackage (vide : livrable à la racine du
 * projet) · Livrable · Équipe · Montant (€). Les livrables doivent exister déjà (import du WBS, page WBS) : cet import ne crée aucun livrable.
 *
 * RÈGLES. Les valeurs du classeur sont APPLIQUÉES (c'est l'usage : on modifie un montant dans le tableur et on réimporte) ; une cellule vide ne change rien et n'efface rien ; une ligne absente du
 * classeur est laissée telle quelle : l'import ne supprime jamais rien. Les règles de l'exercice s'appliquent ligne à ligne : l'attendu est figé quand l'exercice est en exécution, rien ne change dans
 * un exercice clos, une équipe qui porte un budget a un nom de 3 ou 4 caractères, un livrable n'a qu'un exercice. Tout est analysé avant d'écrire : une seule erreur et rien n'est écrit.
 */

var EXIMP_TABS = [
  { name: 'Budget par équipe', cols: ['Projet', 'Équipe', 'Attendu (€)', 'Accordé (€)'], text: [0, 1] },
  { name: 'Parts des livrables', cols: ['Projet', 'Code WBS du workpackage', 'Livrable', 'Équipe', 'Montant (€)'], text: [0, 1], optional: true }
];
var EXIMP_LIMITS = { budgets: 3000, parts: 5000 };

var EXIMP_README = [
  ['Exercice budgétaire — mode d’emploi'],
  [''],
  ['Deux onglets : « Budget par équipe » (l’attendu et l’accordé de chaque équipe sur chaque projet) et « Parts des livrables » (la part de chaque équipe sur chaque livrable). Ne changez ni les noms d’onglets ni les en-têtes de colonnes.'],
  ['Ce classeur est prérempli avec l’exercice choisi dans l’outil : modifiez les montants, ajoutez des lignes, puis revenez dans la page Budget (Importer l’exercice) pour « Analyser », puis « Importer ».'],
  [''],
  ['Projet : le code du projet. Équipe : le nom exact de l’équipe (3 caractères : elle porte le budget ; 4 caractères : un détail rattaché à son équipe parente à 3 caractères), sans tenir compte des accents ni de la casse.'],
  ['Budget par équipe : une cellule vide ne change rien et n’efface rien. L’attendu se fige quand l’exercice passe en exécution ; l’accordé reste modifiable jusqu’à la clôture ; un exercice clos ne change plus.'],
  ['Parts des livrables : le code WBS du workpackage qui contient le livrable (vide s’il est à la racine du projet), puis le nom du livrable, qui doit exister déjà (page WBS ou import du WBS). Un livrable n’a qu’un exercice.'],
  [''],
  ['Les valeurs du classeur sont appliquées ; ce qui n’est pas dans le classeur est laissé tel quel : l’import ne supprime jamais rien. Une copie de sécurité est enregistrée avant de modifier des valeurs existantes. Importer deux fois le même classeur ne change rien.']
];

/** Les projets dont la personne saisit l'exercice (chef de projet et au-dessus ; l'administrateur : tous). */
function eximpProjects_(ctx) {
  return repoList('Project').filter(function (p) { return ctx.isAdmin || can(ctx, 'exercise.edit', { type: 'project', id: p.id }); })
    .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
}

/** Les lignes du classeur pour un exercice : l'export. */
function eximpRows_(ctx, ex) {
  var projects = eximpProjects_(ctx), byId = indexBy_(projects), teamById = indexBy_(repoList('HierarchicalTeam')), wpById = indexBy_(repoList('WorkPackage'));
  var items = repoList('PlanItem', function (i) { return byId[i.project_id] && i.item_type === 'Livrable' && i.exercise_id === ex.id; }), itemById = indexBy_(items);
  var code = function (id) { return byId[id].code; }, num = function (v) { return isBlank(v) ? '' : Number(v); };
  var budgets = repoList('TeamBudget', function (b) { return b.exercise_id === ex.id && byId[b.project_id] && teamById[b.team_id]; })
    .sort(function (a, b) { return String(code(a.project_id)).localeCompare(String(code(b.project_id)), 'fr', { numeric: true }) || String(teamById[a.team_id].name).localeCompare(String(teamById[b.team_id].name), 'fr'); })
    .map(function (b) { return [code(b.project_id), teamById[b.team_id].name, num(b.expected), num(b.granted)]; });
  var parts = repoList('BudgetLine', function (l) { return l.cost_type === 'Équipe' && itemById[l.deliverable_id] && teamById[l.team_id]; })
    .map(function (l) {
      var it = itemById[l.deliverable_id], wp = it.wp_id ? wpById[it.wp_id] : null;
      return [code(it.project_id), wp ? String(wp.wbs_code || '') : '', it.name, teamById[l.team_id].name, Number(l.planned_amount) || 0];
    })
    .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0]), 'fr', { numeric: true }) || String(a[1]).localeCompare(String(b[1]), 'fr', { numeric: true }) || String(a[2]).localeCompare(String(b[2]), 'fr') || String(a[3]).localeCompare(String(b[3]), 'fr'); });
  return { 'Budget par équipe': budgets, 'Parts des livrables': parts };
}

/** Crée le classeur dans Drive, l'écrit et le partage ; un échec de création se propage, un échec de partage n'est qu'un avertissement. */
function eximpBuildWorkbook_(ctx, ex, title) {
  var rows = eximpRows_(ctx, ex);
  var ss = SpreadsheetApp.create(title);
  var readme = ss.insertSheet('Lisez-moi');
  readme.getRange(1, 1, EXIMP_README.length, 1).setValues(EXIMP_README);
  readme.getRange(1, 1).setFontWeight('bold');
  EXIMP_TABS.forEach(function (tab) {
    var sh = ss.insertSheet(tab.name), data = rows[tab.name] || [];
    sh.getRange(1, 1, 1, tab.cols.length).setValues([tab.cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // les codes en texte brut : sinon « 1.10 » deviendrait le nombre 1,1
    tab.text.forEach(function (c) { sh.getRange(2, c + 1, Math.max(data.length, 1) + 500, 1).setNumberFormat('@'); });
    if (data.length) sh.getRange(2, 1, data.length, tab.cols.length).setValues(data.map(function (row) { return row.map(function (v, c) { return tab.text.indexOf(c) >= 0 && v !== '' ? String(v) : v; }); }));
  });
  ['Feuille 1', 'Sheet1'].forEach(function (n) { var d = ss.getSheetByName(n); if (d && ss.getSheets().length > 1) { try { ss.deleteSheet(d); } catch (e) { /* laissée */ } } });
  var warnings = [], email = String(ctx.email || '').toLowerCase();
  try {
    if (IMPORT_DRIVE) IMPORT_DRIVE.share(ss.getId(), email);
    else if (email) DriveApp.getFileById(ss.getId()).addEditor(email);
  } catch (e) { warnings.push('Le classeur est créé mais n’a pas pu être partagé avec ' + email + ' : ' + String(e && e.message ? e.message : e).slice(0, 160) + ' Demandez le partage à l’administrateur.'); }
  return { id: ss.getId(), url: ss.getUrl(), name: ss.getName(), warnings: warnings, prefilled: { budgets: rows['Budget par équipe'].length, parts: rows['Parts des livrables'].length } };
}

function eximpExercise_(p) { return mustGet('Exercise', requireParam(p, 'exerciseId')); }
function eximpRequireEditor_(ctx) {
  if (!eximpProjects_(ctx).length) throw new PpmError('FORBIDDEN', 'Saisir l’exercice est réservé au chef de projet et aux niveaux au-dessus.');
}

/** Le plan d'import, sans rien écrire. */
function eximpAnalyze_(book, ex, ctx) {
  var P = book.parsed, errors = book.problems.slice(), warnings = [];
  var err = function (tab, row, msg) { errors.push({ tab: tab, row: row, message: msg }); };
  var warn = function (tab, row, msg) { warnings.push({ tab: tab, row: row, message: msg }); };
  var TB = EXIMP_TABS[0].name, TP = EXIMP_TABS[1].name;
  var rowsB = P[TB] || [], rowsP = P[TP] || [];
  if (rowsB.length > EXIMP_LIMITS.budgets) err(TB, rowsB[EXIMP_LIMITS.budgets]._row, 'Au plus ' + EXIMP_LIMITS.budgets + ' lignes par import.');
  if (rowsP.length > EXIMP_LIMITS.parts) err(TP, rowsP[EXIMP_LIMITS.parts]._row, 'Au plus ' + EXIMP_LIMITS.parts + ' lignes par import.');
  var closed = ex.status === 'Clos';
  var projectsByCode = {}; repoList('Project').forEach(function (p) { projectsByCode[String(p.code)] = p; });
  var editable = {}; eximpProjects_(ctx).forEach(function (p) { editable[p.id] = true; });
  var teamsByName = {}; repoList('HierarchicalTeam').forEach(function (t) { (teamsByName[teamNorm_(t.name)] = teamsByName[teamNorm_(t.name)] || []).push(t); });
  var project = function (tab, row, code) {
    var p = projectsByCode[code];
    if (!code) { err(tab, row, 'Projet obligatoire (le code du projet).'); return null; }
    if (!p || isTrue(p.deleted)) { err(tab, row, 'Projet « ' + code + ' » : introuvable.'); return null; }
    if (!editable[p.id]) { err(tab, row, 'Projet « ' + code + ' » : saisir son exercice est réservé à son chef de projet et aux niveaux au-dessus.'); return null; }
    return p;
  };
  var team = function (tab, row, name) {
    if (!name) { err(tab, row, 'Équipe obligatoire.'); return null; }
    var f = teamsByName[teamNorm_(name)] || [];
    if (f.length !== 1) { err(tab, row, f.length ? 'Plusieurs équipes s’appellent « ' + name + ' » : renommez-en une avant d’importer.' : 'Équipe « ' + name + ' » : introuvable (importez d’abord la structure des équipes, page Ressources).'); return null; }
    return f[0];
  };
  var budgetsNow = {}; repoList('TeamBudget', function (b) { return b.exercise_id === ex.id; }).forEach(function (b) { budgetsNow[b.project_id + '|' + b.team_id] = b; });
  var plan = { budgets: [], parts: [] };

  // ---- budget par équipe
  var seenB = {};
  rowsB.forEach(function (r) {
    var row = r._row, bad = false;
    var pr = project(TB, row, r['Projet']); if (!pr) bad = true;
    var tm = team(TB, row, r['Équipe']); if (!tm) bad = true;
    var exp = importAmount_(r._raw['Attendu (€)']), grt = importAmount_(r._raw['Accordé (€)']);
    if (exp !== exp) { err(TB, row, 'Attendu : un montant en euros positif ou nul.'); bad = true; }
    if (grt !== grt) { err(TB, row, 'Accordé : un montant en euros positif ou nul.'); bad = true; }
    if (tm) { var msg = exerciseTeamCheck_(tm); if (msg) { err(TB, row, msg); bad = true; } }
    if (pr && tm) {
      var key = pr.id + '|' + tm.id;
      if (seenB[key]) { err(TB, row, 'Cette équipe est déjà à la ligne ' + seenB[key] + ' pour ce projet.'); bad = true; }
      seenB[key] = row;
    }
    if (bad) return;
    if (exp === '' && grt === '') { warn(TB, row, 'Ni attendu ni accordé : ligne ignorée.'); return; }
    var cur = budgetsNow[pr.id + '|' + tm.id] || null;
    var diffE = exp !== '' && (!cur || isBlank(cur.expected) || Number(cur.expected) !== exp), diffG = grt !== '' && (!cur || isBlank(cur.granted) || Number(cur.granted) !== grt);
    if (diffE && ex.status !== 'Préparation' && !closed) { err(TB, row, 'Attendu : il est figé, l’exercice ' + ex.year + ' est en ' + ex.status.toLowerCase() + ' (laissez la cellule vide ou à sa valeur actuelle).'); return; }
    if ((diffE || diffG) && closed) { err(TB, row, 'L’exercice ' + ex.year + ' est clos : on n’y change plus rien.'); return; }
    plan.budgets.push({ row: row, project: pr, team: tm, expected: exp, granted: grt, diffE: diffE, diffG: diffG, current: cur, action: !(diffE || diffG) ? 'same' : (cur ? 'update' : 'create') });
  });

  // ---- parts des livrables
  var wpsByCode = {}; repoList('WorkPackage').forEach(function (w) { if (!isTrue(w.deleted)) wpsByCode[w.project_id + '|' + String(w.wbs_code || '')] = w; });
  var itemsByKey = {}; repoList('PlanItem', function (i) { return i.item_type === 'Livrable' && !isTrue(i.deleted); }).forEach(function (i) { var k = i.project_id + '|' + (i.wp_id || '') + '|' + teamNorm_(i.name); (itemsByKey[k] = itemsByKey[k] || []).push(i); });
  var exercises = indexBy_(repoList('Exercise'));
  var linesNow = {}; repoList('BudgetLine', function (l) { return l.cost_type === 'Équipe'; }).forEach(function (l) { linesNow[l.deliverable_id + '|' + l.team_id] = l; });
  var seenP = {};
  rowsP.forEach(function (r) {
    var row = r._row, bad = false;
    var pr = project(TP, row, r['Projet']); if (!pr) bad = true;
    var wbs = r['Code WBS du workpackage'], name = r['Livrable'];
    var wp = null;
    if (pr && wbs) { wp = wpsByCode[pr.id + '|' + wbs] || null; if (!wp) { err(TP, row, 'Workpackage « ' + wbs + ' » : introuvable dans ' + pr.code + ' (page WBS).'); bad = true; } }
    if (!name) { err(TP, row, 'Livrable obligatoire.'); bad = true; }
    var tm = team(TP, row, r['Équipe']); if (!tm) bad = true;
    var amount = importAmount_(r._raw['Montant (€)']);
    if (amount !== amount || amount === '' || amount <= 0) { err(TP, row, 'Montant : un montant en euros positif.'); bad = true; }
    var item = null;
    if (pr && name && !bad) {
      var found = itemsByKey[pr.id + '|' + (wp ? wp.id : '') + '|' + teamNorm_(name)] || [];
      if (found.length !== 1) { err(TP, row, found.length ? 'Plusieurs livrables s’appellent « ' + name + ' » dans ce workpackage : renommez-en un.' : 'Livrable « ' + name + ' » : introuvable' + (wbs ? ' dans le workpackage ' + wbs : ' à la racine de ' + pr.code) + ' (il doit exister : page WBS ou import du WBS).'); bad = true; }
      else item = found[0];
    }
    if (item && !isBlank(item.exercise_id) && item.exercise_id !== ex.id) {
      var other = exercises[item.exercise_id]; err(TP, row, 'Le livrable « ' + item.name + ' » appartient à l’exercice ' + (other ? other.year : '?') + ' : un livrable n’a qu’un exercice.'); bad = true;
    }
    if (item && tm) {
      var key = item.id + '|' + tm.id;
      if (seenP[key]) { err(TP, row, 'Cette équipe a déjà une part sur ce livrable (ligne ' + seenP[key] + ').'); bad = true; }
      seenP[key] = row;
    }
    if (bad || !item || !tm) return;
    if (teamLevel_(tm) === 0) warn(TP, row, 'L’équipe « ' + tm.name + ' » n’a pas un nom de 3 ou 4 caractères : sa part sera comptée à part (hors règle), pas dans une équipe du tableau.');
    var line = linesNow[item.id + '|' + tm.id] || null, same = line && Number(line.planned_amount) === amount;
    if (!same && closed) { err(TP, row, 'L’exercice ' + ex.year + ' est clos : on n’y change plus rien.'); return; }
    plan.parts.push({ row: row, project: pr, item: item, team: tm, amount: amount, line: line, action: same ? 'same' : (line ? 'update' : 'create') });
  });

  var count = function (list) { var c = { create: 0, update: 0, same: 0 }; list.forEach(function (x) { c[x.action]++; }); return c; };
  return { errors: errors, warnings: warnings, plan: plan, counts: { budgets: count(plan.budgets), parts: count(plan.parts) } };
}

function eximpRemaining_(c) { return c.budgets.create + c.budgets.update + c.parts.create + c.parts.update; }

function eximpReport_(book, ex, a) {
  return {
    book: { id: book.id, name: book.name }, exercise: { id: ex.id, year: Number(ex.year), status: ex.status }, ok: a.errors.length === 0,
    errors: a.errors.slice(0, 200), errors_count: a.errors.length, warnings: a.warnings.slice(0, 200), warnings_count: a.warnings.length, counts: a.counts,
    nothing_to_do: a.errors.length === 0 && eximpRemaining_(a.counts) === 0
  };
}

defineAction('exercise.import.template', function (p, ctx) {
  etpReset_();
  eximpRequireEditor_(ctx);
  var ex = eximpExercise_(p);
  return eximpBuildWorkbook_(ctx, ex, 'PPM — Exercice ' + ex.year + ' — Budget par équipe — ' + todayStr());
});

defineAction('exercise.import.analyze', function (p, ctx) {
  eximpRequireEditor_(ctx);
  var ex = eximpExercise_(p), book = importReadBook_(requireParam(p, 'book'), EXIMP_TABS);
  return eximpReport_(book, ex, eximpAnalyze_(book, ex, ctx));
});

/**
 * Applique le plan : budgets d'équipe (exercise.set), puis parts de livrables (budget.line.save, qui rattache le livrable à l'exercice). S'arrête au budget de temps ou à `maxOps` (essais) et dit
 * `done: false` ; relancer reprend, le plan étant recalculé. Au premier lancement (sans `resume`), une copie de sécurité est enregistrée si des valeurs EXISTANTES vont changer ; si elle échoue,
 * rien n'est écrit.
 */
defineAction('exercise.import.run', function (p, ctx) {
  etpReset_();
  eximpRequireEditor_(ctx);
  var ex = eximpExercise_(p), book = importReadBook_(requireParam(p, 'book'), EXIMP_TABS);
  var all = eximpAnalyze_(book, ex, ctx);
  if (all.errors.length) throw new PpmError('VALIDATION', 'Le classeur a ' + all.errors.length + ' erreur(s) : lancez « Analyser » et corrigez-les avant d’importer.', { rule: 'IMPORT_ERRORS', errors: all.errors.slice(0, 20) });
  var backup = null;
  if (!p.resume && all.counts.budgets.update + all.counts.parts.update > 0) {
    try {
      var wb = eximpBuildWorkbook_(ctx, ex, 'PPM — Copie avant import de l’exercice ' + ex.year + ' — ' + todayStr() + ' ' + String(nowIso()).slice(11, 16));
      backup = { id: wb.id, url: wb.url, name: wb.name };
    } catch (e) {
      throw new PpmError('VALIDATION', 'La copie de sécurité n’a pas pu être créée (' + String(e && e.message ? e.message : e).slice(0, 140) + ') : l’import est annulé, rien n’a été écrit.', { rule: 'IMPORT_BACKUP' });
    }
  }
  var started = nowMs(), ops = 0, maxOps = p.maxOps ? Number(p.maxOps) : 0, stopped = false, applied = { budgets: 0, parts: 0 };
  var full = function () { return (maxOps && ops >= maxOps) || nowMs() - started > IMPORT_BUDGET_MS; };
  var run = function (name, params) { ops++; return API_ACTIONS[name](params, ctx); };
  var step = function (fn) { if (stopped) return; if (full()) { stopped = true; return; } fn(); };
  all.plan.budgets.filter(function (b) { return b.action !== 'same'; }).forEach(function (b) {
    step(function () {
      var params = { projectId: b.project.id, exerciseId: ex.id, teamId: b.team.id };
      if (b.diffE) params.expected = b.expected;   // seulement ce qui change : l'attendu d'un exercice en exécution est figé, une valeur identique ne doit pas le toucher
      if (b.diffG) params.granted = b.granted;
      run('exercise.set', params);
      applied.budgets++;
    });
  });
  all.plan.parts.filter(function (x) { return x.action !== 'same'; }).forEach(function (x) {
    step(function () {
      var line = repoList('BudgetLine', function (l) { return l.cost_type === 'Équipe' && l.deliverable_id === x.item.id && l.team_id === x.team.id; })[0];
      if (line) {
        if (Number(line.planned_amount) === x.amount) return;
        run('budget.line.save', { id: line.id, version: line.version, values: { planned_amount: x.amount }, exerciseId: ex.id });
      } else {
        run('budget.line.save', { values: { deliverable_id: x.item.id, team_id: x.team.id, planned_amount: x.amount }, exerciseId: ex.id });
      }
      applied.parts++;
    });
  });
  var after = eximpAnalyze_(importReadBook_(book.id, EXIMP_TABS), ex, ctx);
  var remaining = eximpRemaining_(after.counts);
  return { done: remaining === 0, stopped: stopped, applied: applied, remaining: remaining, operations: ops, counts: after.counts, backup: backup };
});
