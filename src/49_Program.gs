/**
 * PPM Core — 0.14.1 : vues programme consolidées des pages Actualités, Suivi et Budget.
 *
 * Réservées à ceux qui ont le droit « program.view » sur le programme (Program Leader, Domain Program Leader ; l'administrateur aussi). Chaque action reprend
 * les calculs existants projet par projet (news.get, baselines.diff, changes.feed, budget.balance) et en rend une ligne par projet, plus les totaux :
 * on ne recalcule rien, donc la vue du programme ne peut pas contredire celle d'un projet.
 */

function programScope_(p, ctx) {
  var program = mustGet('Program', requireParam(p, 'programId'));
  requireCan(ctx, 'program.view', { type: 'program', id: program.id });
  var projects = repoList('Project', function (x) { return x.program_id === program.id; })
    .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
  return { program: { id: program.id, code: program.code, name: program.name }, projects: projects };
}

function programRow_(pr) { return { id: pr.id, code: pr.code, name: pr.name, status: pr.status || '' }; }

function programSum_(rows, keys) {
  var t = {};
  keys.forEach(function (k) { t[k] = rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); });
  return t;
}

defineAction('news.program', function (p, ctx) {
  var sc = programScope_(p, ctx), today = todayStr(), since30 = addCalendarDays(today, -30), since14 = addCalendarDays(today, -14);
  var names = {}; repoList('Resource').forEach(function (r) { names[r.id] = r.name; });
  var meetings = repoList('Meeting'), actions = repoList('NewsAction'), digests = repoList('NewsDigest');
  var codeOf = {}; sc.projects.forEach(function (pr) { codeOf[pr.id] = pr.code; });
  var rows = sc.projects.map(function (pr) {
    var published = meetings.filter(function (m) { return m.project_id === pr.id && m.status === 'Publiée'; });
    var open = actions.filter(function (a) { return a.project_id === pr.id && NEWS_OPEN.indexOf(a.status) >= 0; });
    var dates = published.map(function (m) { return String(m.held_on); }).sort();
    var digest = digests.filter(function (d) { return d.project_id === pr.id; }).map(function (d) { return String(d.digest_date); }).sort().pop() || '';
    return Object.assign(programRow_(pr), {
      news_on: pr.news_on === true || String(pr.news_on).toLowerCase() === 'true',
      meetings_30d: published.filter(function (m) { return String(m.held_on) >= since30; }).length,
      last_meeting: dates.length ? dates[dates.length - 1] : '',
      actions_open: open.length,
      actions_overdue: open.filter(function (a) { return !isBlank(a.due_date) && String(a.due_date) < today; }).length,
      actions_contested: open.filter(function (a) { return a.status === 'Contestée'; }).length,
      to_sort: meetings.filter(function (m) { return m.status === 'À trier' && String(m.candidates || '').split(',').indexOf(pr.id) >= 0; }).length,
      digest_date: digest, digest_today: digest === today
    });
  });
  var recent = meetings.filter(function (m) { return codeOf[m.project_id] && m.status === 'Publiée' && String(m.held_on) >= since14; })
    .sort(function (a, b) { return String(b.held_on).localeCompare(String(a.held_on)) || String(a.title).localeCompare(String(b.title)); }).slice(0, 12)
    .map(function (m) { return { id: m.id, project_id: m.project_id, project_code: codeOf[m.project_id], title: m.title, held_on: m.held_on }; });
  var open = actions.filter(function (a) { return codeOf[a.project_id] && NEWS_OPEN.indexOf(a.status) >= 0; })
    .sort(function (a, b) { return (isBlank(a.due_date) ? '9999' : String(a.due_date)).localeCompare(isBlank(b.due_date) ? '9999' : String(b.due_date)); }).slice(0, 25)
    .map(function (a) {
      return { id: a.id, project_id: a.project_id, project_code: codeOf[a.project_id], text: a.text, status: a.status, due_date: a.due_date || '',
        owner: names[a.owner_resource_id] || a.owner_label || '', overdue: !isBlank(a.due_date) && String(a.due_date) < today };
    });
  var untriaged = meetings.filter(function (m) { return m.status === 'À trier'; }).length;
  return { today: today, program: sc.program, projects: rows, recent: recent, actions: open, totals: Object.assign(programSum_(rows, ['meetings_30d', 'actions_open', 'actions_overdue', 'actions_contested']), { to_sort: untriaged }) };
});

defineAction('suivi.program', function (p, ctx) {
  var sc = programScope_(p, ctx);
  var baselines = repoList('Baseline');
  var rows = sc.projects.map(function (pr) {
    var mine = baselines.filter(function (b) { return b.project_id === pr.id; });
    var base = mine.filter(function (b) { return b.id === pr.active_baseline_id; })[0] || null;
    var row = Object.assign(programRow_(pr), {
      baseline: base ? base.label : '', baselines: mine.length, requested: mine.filter(function (b) { return b.status === 'Demandée'; }).length,
      compared: 0, slipped: 0, max_slip: 0, end_slip: 0, end: '', pending_changes: 0
    });
    if (base) {
      var d = API_ACTIONS['baselines.diff']({ projectId: pr.id }, ctx).totals;
      row.compared = d.compared; row.slipped = d.slipped; row.max_slip = d.max_slip; row.end_slip = d.end_slip; row.end = d.end || '';
      try { row.pending_changes = API_ACTIONS['changes.feed']({ projectId: pr.id }, ctx).pending; } catch (e) { row.pending_changes = 0; }
    }
    return row;
  });
  return { today: todayStr(), program: sc.program, projects: rows,
    totals: Object.assign(programSum_(rows, ['baselines', 'requested', 'compared', 'slipped', 'pending_changes']), { without_baseline: rows.filter(function (r) { return !r.baseline; }).length, max_slip: rows.reduce(function (m, r) { return Math.max(m, r.max_slip); }, 0) }) };
});

defineAction('budget.program', function (p, ctx) {
  var sc = programScope_(p, ctx);
  var rows = sc.projects.map(function (pr) {
    var row = Object.assign(programRow_(pr), { cpn: pr.cpn || '', restricted: false, budget_total: 0, budget_internal: 0, budget_external: 0, po_planned: 0, po_committed: 0, po_received: 0, po_closed: 0, po_count: 0, remaining_external: 0, overrun: false });
    try {
      var b = API_ACTIONS['budget.balance']({ projectId: pr.id }, ctx).totals;
      row.budget_total = b.budget.total; row.budget_internal = b.budget.internal; row.budget_external = b.budget.external;
      row.po_planned = b.po.planned; row.po_committed = b.po.committed; row.po_received = b.po.received; row.po_closed = b.po.closed; row.po_count = b.po.count;
      row.remaining_external = b.remaining_external; row.overrun = !!b.overrun;
    } catch (e) { row.restricted = true; }
    return row;
  });
  return { today: todayStr(), program: sc.program, projects: rows,
    totals: Object.assign(programSum_(rows, ['budget_total', 'budget_internal', 'budget_external', 'po_planned', 'po_committed', 'po_received', 'po_closed', 'po_count', 'remaining_external']),
      { overruns: rows.filter(function (r) { return r.overrun; }).length, restricted: rows.filter(function (r) { return r.restricted; }).length }) };
});
