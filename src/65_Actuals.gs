/**
 * PPM Core — 0.20.1 : le RÉALISÉ comptable, importé chaque mois depuis le classeur de la finance.
 *
 * Chaque mois, un NOUVEAU classeur Google Sheet, onglet « CUC Total Cost » :
 *   colonne J « WBS élément » : la clé de recherche : le ou les CPN (celui d'un projet ou d'un workpackage de l'outil) ;
 *   colonne W « Actuals »     : le montant consommé ;
 *   colonne L « cost center group » : l'ÉQUIPE qui a consommé ;
 *   colonne T : le MOIS, colonne U : l'ANNÉE de cette consommation.
 * On obtient la consommation réelle d'un projet par ÉQUIPE et par MOIS. Le réalisé n'est PAS suivi au livrable.
 *
 * RÈGLES. Les lignes du fichier sont additionnées par (CPN, équipe, année-mois) ; chaque cumul est une ligne `ActualLine`. Importer un nouveau fichier REMPLACE le montant d'une ligne qui existe déjà
 * (même CPN, équipe, mois : un fichier qui reprend les mois précédents ne double rien), ajoute les nouvelles, ne supprime jamais rien. Un CPN que l'outil ne connaît pas n'est pas stocké (il est
 * signalé) ; une équipe inconnue est stockée « Équipe inconnue » (le réalisé compte au projet, pas à une équipe). Les lignes sans CPN, sans mois ou sans montant lisible sont ignorées et comptées.
 * L'ANALYSE ne lit que le classeur et ne change rien ; l'IMPORT est réservé à l'administrateur et se reprend (lots) s'il dépasse le temps imparti.
 */

var ACTUALS_MAP = { sheet: 'CUC Total Cost', wbs: 'J', team: 'L', month: 'T', year: 'U', amount: 'W' };
var ACTUALS_MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

function actualsCol_(letters) { var n = 0; String(letters).toUpperCase().split('').forEach(function (c) { n = n * 26 + (c.charCodeAt(0) - 64); }); return n - 1; }
function actualsNorm_(s) { return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').trim().toUpperCase().replace(/\s+/g, ' '); }
function actualsCpnKey_(s) { return actualsNorm_(s).replace(/\s+/g, ''); }

/** Le mois (1 à 12) d'une cellule : un nombre, un nom de mois (français ou anglais), une date, « 2026-03 ». null si illisible. */
function actualsMonth_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getMonth() + 1;
  if (typeof v === 'number') return v >= 1 && v <= 12 && Math.floor(v) === v ? v : null;
  var t = actualsNorm_(v).replace(/\./g, '');
  var m = /^(\d{4})[-\/](\d{1,2})$/.exec(t); if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) : null;
  if (/^\d{1,2}$/.test(t)) return Number(t) >= 1 && Number(t) <= 12 ? Number(t) : null;
  var names = ['JANV', 'FEVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOUT', 'SEPT', 'OCT', 'NOV', 'DEC'], en = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  for (var i = 0; i < 12; i++) { if (t.indexOf(names[i]) === 0 || t.indexOf(en[i]) === 0) return i + 1; }
  return null;
}
function actualsYear_(v) { var n = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(/\s/g, '')); return n >= 2000 && n <= 2100 && Math.floor(n) === n ? n : null; }
/** Un montant signé (un avoir est négatif) : « 12 345,67 », « -300 », « (300) ». null si illisible. */
function actualsAmount_(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var t = String(v === null || v === undefined ? '' : v).replace(/\u00a0/g, ' ').trim();
  if (!t) return null;
  var neg = /^\(.*\)$/.test(t); t = t.replace(/^\(|\)$/g, '').replace(/\s/g, '').replace(/€/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  var n = Number(t); return neg ? -n : n;
}

/** Lit l'onglet « CUC Total Cost » du classeur. Rend les lignes lisibles, celles qu'on ignore (avec la raison) et les problèmes de structure. */
function actualsRead_(ref) {
  var id = importBookId_(ref), ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    var who = ''; try { who = Session.getEffectiveUser().getEmail(); } catch (e2) { who = ''; }
    throw new PpmError('VALIDATION', 'Classeur illisible. Partagez-le en lecture avec ' + (who || 'le compte qui exécute l’outil') + '.');
  }
  var sh = ss.getSheetByName(ACTUALS_MAP.sheet);
  if (!sh) throw new PpmError('VALIDATION', 'Onglet « ' + ACTUALS_MAP.sheet + ' » introuvable dans ce classeur.');
  var data = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
  var cW = actualsCol_(ACTUALS_MAP.wbs), cT = actualsCol_(ACTUALS_MAP.team), cM = actualsCol_(ACTUALS_MAP.month), cY = actualsCol_(ACTUALS_MAP.year), cA = actualsCol_(ACTUALS_MAP.amount);
  var header = -1;
  for (var i = 0; i < Math.min(data.length, 30); i++) { if (actualsNorm_(data[i][cW]).indexOf('WBS') >= 0) { header = i; break; } }
  if (header < 0) throw new PpmError('VALIDATION', 'En-têtes introuvables : la colonne ' + ACTUALS_MAP.wbs + ' devrait s’appeler « WBS élément » (dans les 30 premières lignes de l’onglet « ' + ACTUALS_MAP.sheet + ' »).');
  var warnings = [];
  var expect = [[cT, ACTUALS_MAP.team, 'COST CENTER'], [cA, ACTUALS_MAP.amount, 'ACTUAL']];
  expect.forEach(function (e) { var h = actualsNorm_(data[header][e[0]]); if (h.indexOf(e[2]) < 0) warnings.push('La colonne ' + e[1] + ' s’appelle « ' + String(data[header][e[0]]) + ' » (on attend « ' + (e[2] === 'ACTUAL' ? 'Actuals' : 'cost center group') + ' ») : vérifiez que c’est le bon classeur.'); });
  var rows = [], ignored = [], blank = 0;
  for (var r = header + 1; r < data.length; r++) {
    var row = data[r], wbs = actualsNorm_(row[cW]);
    if (!wbs) { blank++; continue; }
    var m = actualsMonth_(row[cM]), y = actualsYear_(row[cY]), amount = actualsAmount_(row[cA]), team = String(row[cT] === null || row[cT] === undefined ? '' : row[cT]).trim();
    var why = m === null ? 'mois illisible (colonne ' + ACTUALS_MAP.month + ')' : y === null ? 'année illisible (colonne ' + ACTUALS_MAP.year + ')' : amount === null ? 'montant illisible (colonne ' + ACTUALS_MAP.amount + ')' : '';
    if (why) { ignored.push({ row: r + 1, message: why }); continue; }
    rows.push({ row: r + 1, wbs: wbs, cpn: actualsCpnKey_(wbs), team: team, month: y + '-' + (m < 10 ? '0' : '') + m, amount: amount });
  }
  return { id: id, name: ss.getName(), header_row: header + 1, rows: rows, ignored: ignored, blank: blank, warnings: warnings };
}

/** Le plan : cumul par (CPN, équipe, mois), rattachement au projet et à l'équipe, lignes à créer, à remplacer, inchangées. Ne change rien. */
function actualsPlan_(read) {
  var projects = repoList('Project', function (p) { return !isTrue(p.deleted); }), wps = repoList('WorkPackage', function (w) { return !isTrue(w.deleted); });
  var byCpn = {};
  var add = function (key, projectId, wpId) { if (!key) return; (byCpn[key] = byCpn[key] || []).push({ project_id: projectId, wp_id: wpId }); };
  projects.forEach(function (p) { add(actualsCpnKey_(p.cpn), p.id, ''); });
  wps.forEach(function (w) { add(actualsCpnKey_(w.cpn), w.project_id, w.id); });
  var teams = repoList('HierarchicalTeam', function (t) { return !isTrue(t.deleted); }), byTeam = {};
  teams.forEach(function (t) { [t.name, t.cost_center].forEach(function (k) { var n = actualsNorm_(k); if (n) (byTeam[n] = byTeam[n] || {})[t.id] = t; }); });
  var agg = {}, unknownCpn = {}, unknownTeam = {};
  read.rows.forEach(function (r) {
    var hit = byCpn[r.cpn], projectIds = {}; (hit || []).forEach(function (h) { projectIds[h.project_id] = h; });
    var ids = Object.keys(projectIds);
    if (ids.length !== 1) { var u = unknownCpn[r.wbs] = unknownCpn[r.wbs] || { cpn: r.wbs, rows: 0, ambiguous: ids.length > 1 }; u.rows++; return; }
    var h = projectIds[ids[0]], tk = actualsNorm_(r.team), tm = tk ? Object.keys(byTeam[tk] || {}) : [], team = tm.length === 1 ? byTeam[tk][tm[0]] : null;
    if (!team) { var ut = unknownTeam[r.team || '(vide)'] = unknownTeam[r.team || '(vide)'] || { team: r.team || '(vide)', rows: 0 }; ut.rows++; }
    var key = [r.month, r.cpn, tk].join('|'), a = agg[key];
    if (!a) a = agg[key] = { month: r.month, charge_code: r.wbs, cost_center: r.team, amount: 0, project_id: h.project_id, wp_id: h.wp_id, team_id: team ? team.id : '', match_status: team ? 'Rattaché' : 'Équipe inconnue', source_rows: 0 };
    a.amount = Math.round((a.amount + r.amount) * 100) / 100; a.source_rows++;
  });
  var existing = {}; repoList('ActualLine').forEach(function (l) { existing[[l.month, actualsCpnKey_(l.charge_code), actualsNorm_(l.cost_center)].join('|')] = l; });
  var lines = Object.keys(agg).map(function (k) {
    var a = agg[k], cur = existing[k] || null;
    a.action = !cur ? 'create' : (Number(cur.amount) === a.amount && cur.team_id === a.team_id && cur.project_id === a.project_id ? 'same' : 'update'); a.current = cur;
    return a;
  });
  var count = { create: 0, update: 0, same: 0 }; lines.forEach(function (l) { count[l.action]++; });
  var months = lines.map(function (l) { return l.month; }).sort();
  return { lines: lines, counts: count, months: months.length ? { from: months[0], to: months[months.length - 1] } : null,
    unknown_cpn: Object.keys(unknownCpn).map(function (k) { return unknownCpn[k]; }).sort(function (a, b) { return b.rows - a.rows; }),
    unknown_team: Object.keys(unknownTeam).map(function (k) { return unknownTeam[k]; }).sort(function (a, b) { return b.rows - a.rows; }),
    total: Math.round(lines.reduce(function (t, l) { return t + l.amount; }, 0) * 100) / 100 };
}

function actualsReport_(read, plan) {
  var warnings = read.warnings.slice();
  if (plan.unknown_cpn.length) warnings.push(plan.unknown_cpn.length + ' CPN du fichier ne correspondent à aucun projet ni workpackage de l’outil (lignes non importées) : ' + plan.unknown_cpn.slice(0, 8).map(function (u) { return u.cpn + (u.ambiguous ? ' (plusieurs projets)' : '') + ' (' + u.rows + ')'; }).join(', ') + (plan.unknown_cpn.length > 8 ? '…' : '') + '.');
  if (plan.unknown_team.length) warnings.push(plan.unknown_team.length + ' équipe(s) du fichier n’existent pas dans l’outil (le réalisé est gardé au projet, sans équipe) : ' + plan.unknown_team.slice(0, 8).map(function (u) { return u.team + ' (' + u.rows + ')'; }).join(', ') + (plan.unknown_team.length > 8 ? '…' : '') + '.');
  if (read.ignored.length) warnings.push(read.ignored.length + ' ligne(s) ignorée(s) (mois, année ou montant illisible), par exemple la ligne ' + read.ignored[0].row + ' : ' + read.ignored[0].message + '.');
  return { book: { id: read.id, name: read.name }, header_row: read.header_row, rows_read: read.rows.length, rows_ignored: read.ignored.length, rows_blank: read.blank, counts: plan.counts, months: plan.months, total: plan.total,
    unknown_cpn: plan.unknown_cpn.slice(0, 20), unknown_team: plan.unknown_team.slice(0, 20), warnings: warnings, ok: plan.lines.length > 0,
    nothing_to_do: plan.counts.create + plan.counts.update === 0, errors: plan.lines.length ? [] : [{ message: 'Aucune ligne exploitable : vérifiez le classeur (onglet « ' + ACTUALS_MAP.sheet + ' », colonnes J, L, T, U, W) et que les CPN existent dans l’outil.' }] };
}

function actualsRequireAdmin_(ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'L’import du réalisé comptable est réservé à l’administrateur.');
}

defineAction('actuals.import.analyze', function (p, ctx) {
  actualsRequireAdmin_(ctx);
  var read = actualsRead_(requireParam(p, 'book'));
  return actualsReport_(read, actualsPlan_(read));
});

/** Applique le plan par lots ; s'arrête au budget de temps (ou à `maxOps`, essais) et dit `done: false` : relancer reprend (le plan est recalculé). */
defineAction('actuals.import.run', function (p, ctx) {
  actualsRequireAdmin_(ctx);
  var read = actualsRead_(requireParam(p, 'book')), plan = actualsPlan_(read);
  if (!plan.lines.length) throw new PpmError('VALIDATION', 'Aucune ligne exploitable dans ce classeur : lancez « Analyser ».');
  if (!plan.counts.create && !plan.counts.update) return { done: true, stopped: false, applied: { create: 0, update: 0 }, remaining: 0, operations: 0, report: actualsReport_(read, plan) };   // rien à importer : aucun import n'est créé
  var imp = repoList('ActualImport', function (i) { return i.source_file_id === read.id && i.status === 'Brouillon'; })[0] || null;
  if (!imp) imp = repoInsert('ActualImport', { period: plan.months ? plan.months.from + '..' + plan.months.to : '', source_file_id: read.id, mapping_json: JSON.stringify(ACTUALS_MAP), status: 'Brouillon', imported_by: ctx.email }, ctx.actx);
  var started = nowMs(), ops = 0, maxOps = p.maxOps ? Number(p.maxOps) : 0, stopped = false, applied = { create: 0, update: 0 };
  plan.lines.filter(function (l) { return l.action !== 'same'; }).forEach(function (l) {
    if (stopped) return;
    if ((maxOps && ops >= maxOps) || nowMs() - started > IMPORT_BUDGET_MS) { stopped = true; return; }
    var rec = { import_id: imp.id, month: l.month, charge_code: l.charge_code, cost_center: l.cost_center, amount: l.amount, project_id: l.project_id, wp_id: l.wp_id, team_id: l.team_id, match_status: l.match_status, source_rows: l.source_rows };
    if (l.current) repoUpdate('ActualLine', l.current.id, rec, null, ctx.actx); else repoInsert('ActualLine', rec, ctx.actx);
    ops++; applied[l.action]++;
  });
  var after = actualsPlan_(actualsRead_(read.id)), remaining = after.counts.create + after.counts.update;
  if (!remaining) repoUpdate('ActualImport', imp.id, { status: 'Publié', mapping_json: JSON.stringify({ map: ACTUALS_MAP, rows: read.rows.length, lines: plan.lines.length, total: plan.total, unknown_cpn: plan.unknown_cpn.length, unknown_team: plan.unknown_team.length }) }, null, ctx.actx);
  return { done: remaining === 0, stopped: stopped, applied: applied, remaining: remaining, operations: ops, report: actualsReport_(read, after) };
});

defineAction('actuals.imports', function (p, ctx) {
  actualsRequireAdmin_(ctx);
  return repoList('ActualImport').sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); }).slice(0, 24)
    .map(function (i) { var m = parseJsonSafe(i.mapping_json, {}); return { id: i.id, period: i.period, status: i.status, imported_by: i.imported_by, created_at: i.created_at || '', rows: m.rows || null, lines: m.lines || null, total: m.total === undefined ? null : m.total }; });
});

/**
 * Le réalisé d'un projet pour un exercice (son année) : par mois, par équipe (l'équipe à 4 caractères compte dans sa parente à 3), et le cumul à ce jour. Lecture : qui voit le budget du projet.
 */
function actualsView_(project, ex, today) {
  var year = Number(ex.year), months = []; for (var m = 1; m <= 12; m++) months.push(year + '-' + (m < 10 ? '0' : '') + m);
  var idx = {}; months.forEach(function (mm, i) { idx[mm] = i; });
  var lines = repoList('ActualLine', function (l) { return l.project_id === project.id && idx[l.month] !== undefined; });
  var teamById = indexBy_(repoList('HierarchicalTeam')), tYear = Number(String(today).slice(0, 4)), curIdx = year < tYear ? 12 : (year > tYear ? 0 : Number(String(today).slice(5, 7)));
  var byTeam = {}, total = months.map(function () { return 0; }), last = -1, unattached = 0;
  lines.forEach(function (l) {
    var i = idx[l.month], amount = Number(l.amount) || 0, root = l.team_id ? exerciseRootTeam_({ teamById: teamById }, teamById[l.team_id]) : null;
    total[i] = Math.round((total[i] + amount) * 100) / 100; if (i > last) last = i;
    if (!root) { unattached = Math.round((unattached + amount) * 100) / 100; return; }
    var t = byTeam[root.id] = byTeam[root.id] || { team_id: root.id, name: root.name, values: months.map(function () { return 0; }) };
    t.values[i] = Math.round((t.values[i] + amount) * 100) / 100;
  });
  var run = 0, cum = total.map(function (v, i) { run = Math.round((run + v) * 100) / 100; return i <= last ? run : null; });
  var toDate = 0; total.forEach(function (v, i) { if (i + 1 <= curIdx) toDate = Math.round((toDate + v) * 100) / 100; });
  var teams = Object.keys(byTeam).map(function (k) { var t = byTeam[k]; t.total = Math.round(t.values.reduce(function (s, v) { return s + v; }, 0) * 100) / 100; t.to_date = Math.round(t.values.reduce(function (s, v, i) { return i + 1 <= curIdx ? s + v : s; }, 0) * 100) / 100; return t; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
  var lastImport = repoList('ActualImport', function (i) { return i.status === 'Publié'; }).sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })[0] || null;
  return { available: lines.length > 0, year: year, months: months, monthly: total, cumulative: cum, to_date: toDate, last_month: last + 1, unattached: unattached, teams: teams, last_import: lastImport ? { period: lastImport.period, at: lastImport.created_at || '' } : null };
}
