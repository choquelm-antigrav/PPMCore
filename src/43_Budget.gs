/**
 * PPM Core — 0.9.0 : budget, CPN (lot 3, première partie) ; 0.17.1 : parts par équipe ; 0.21.0 : plan budgétaire sans dimension de temps.
 *
 *  - CPN : code financier d'un projet, avec sa désignation. Un workpackage de premier niveau (le « sous-projet »)
 *    peut porter le sien. Un CPN ne couvre qu'un seul projet, au maximum. Les analyses budgétaires se font par CPN.
 *  - Lignes de budget par livrable : une PART PAR ÉQUIPE, en montant libre (la conversion en jours est un calcul à la demande, à partir du coût d'un ETP du pays de l'équipe : 60_Exercise.gs),
 *    ou un FORFAIT (colonne « Externe ») auprès d'une ressource externe. Aucun taux journalier ni étalement par mois : un montant est une valeur annuelle. Un livrable appartient à un seul
 *    exercice budgétaire (voir exerciseForLine_).
 *  - Bilan par CPN : budget (interne, externe) face aux commandes d'achat engagées (44_Orders.gs).
 * Fonction de calcul pure : computeBalance_.
 */

var CPN_RE = /^[A-Z0-9][A-Z0-9 ._\/-]{0,29}$/;

// ---------------------------------------------------------------- CPN

function normCpn_(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase(); }

function checkCpnValue_(v) {
  var c = normCpn_(v);
  if (!c) return '';
  if (!CPN_RE.test(c)) throw new PpmError('VALIDATION', 'CPN invalide : 30 caractères au plus, lettres, chiffres, espace, point, tiret, barre oblique.');
  return c;
}

/** CPN → { project, wp } : le projet (et le workpackage, s'il est porté par un sous-projet) qui l'utilise. */
function cpnIndex_() {
  var idx = {}, projects = repoList('Project'), byId = indexBy_(projects);
  projects.forEach(function (p) { var k = normCpn_(p.cpn); if (k && !idx[k]) idx[k] = { project: p, wp: null }; });
  repoList('WorkPackage').forEach(function (w) {
    var k = normCpn_(w.cpn);
    if (k && !idx[k] && byId[w.project_id]) idx[k] = { project: byId[w.project_id], wp: w };
  });
  return idx;
}

function cpnOwner_(cpn) {
  var k = normCpn_(cpn);
  return k ? cpnIndex_()[k] || null : null;
}

function assertCpnFree_(cpn, projectId) {
  if (!cpn) return;
  var o = cpnIndex_()[cpn];
  if (o && o.project.id !== projectId) {
    throw new PpmError('VALIDATION', 'Le CPN ' + cpn + ' est déjà porté par le projet ' + o.project.code + ' : un CPN ne couvre qu’un seul projet.');
  }
}

/** CPN d'un projet : le sien et ceux de ses sous-projets, sans doublon. */
function projectCpns_(project, wps) {
  var out = [], seen = {};
  var add = function (cpn, label, source) {
    var k = normCpn_(cpn);
    if (!k) return;
    if (!seen[k]) { seen[k] = { cpn: k, label: label || '', sources: [] }; out.push(seen[k]); }
    if (label && !seen[k].label) seen[k].label = label;
    seen[k].sources.push(source);
  };
  add(project.cpn, project.cpn_label, 'Projet');
  wps.forEach(function (w) { add(w.cpn, w.cpn_label, (w.wbs_code ? w.wbs_code + ' ' : '') + w.name); });
  return out;
}

/** Changer ou retirer un CPN est refusé tant que des commandes d'achat s'y rattachent (elles ne seraient plus reliées au projet). */
function assertCpnRemovable_(projectId, oldCpn, remaining) {
  var k = normCpn_(oldCpn);
  if (!k || remaining.indexOf(k) >= 0) return;
  var n = repoList('PurchaseOrder', function (o) { return normCpn_(o.cpn) === k; }).length;
  if (n) throw new PpmError('VALIDATION', n + ' commande(s) d’achat portent le CPN ' + k + ' : supprimez-les ou conservez ce CPN.');
}

defineAction('cpn.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'cpn.edit', { type: 'project', id: project.id });
  var cpn = checkCpnValue_(p.cpn);
  var label = cpn ? wbsShortText_(p.cpn_label, 120, 'Désignation du CPN') : '';
  assertCpnFree_(cpn, project.id);
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var remaining = projectCpns_({ cpn: cpn, cpn_label: label }, wps).map(function (x) { return x.cpn; });
  assertCpnRemovable_(project.id, project.cpn, remaining);
  return repoUpdate('Project', project.id, { cpn: cpn, cpn_label: label }, p.version, ctx.actx);
});

/** Sous-projet : un workpackage de premier niveau porte un CPN (utilisé par wbs.create et wbs.update). */
function applyWpCpn_(ctx, wp, values, out) {
  if (!('cpn' in values) && !('cpn_label' in values)) return;
  var cpn = 'cpn' in values ? checkCpnValue_(values.cpn) : normCpn_(wp.cpn);
  var label = cpn ? ('cpn_label' in values ? wbsShortText_(values.cpn_label, 120, 'Désignation du CPN') : (wp.cpn_label || '')) : '';
  if (cpn === normCpn_(wp.cpn) && label === String(wp.cpn_label || '')) return;
  if (cpn && !isBlank(wp.parent_wp_id)) throw new PpmError('VALIDATION', 'Seul un workpackage de premier niveau (sous-projet) porte un CPN.');
  requireCan(ctx, 'cpn.edit', { type: 'project', id: wp.project_id });
  assertCpnFree_(cpn, wp.project_id);
  var project = mustGet('Project', wp.project_id);
  var others = repoList('WorkPackage', function (w) { return w.project_id === wp.project_id && w.id !== wp.id; });
  var remaining = projectCpns_(project, others).map(function (x) { return x.cpn; });
  if (cpn) remaining.push(cpn);
  assertCpnRemovable_(wp.project_id, wp.cpn, remaining);
  out.cpn = cpn;
  out.cpn_label = label;
}

// ---------------------------------------------------------------- le plan budgétaire : une cellule livrable × équipe

/**
 * LE PLAN BUDGÉTAIRE (0.21.0). Le budget d'un projet est UN tableau annuel : une ligne par livrable, une colonne par équipe (plus la colonne « Externe »), un montant libre par cellule. Il n'y a plus
 * de dimension de temps (ni étalement par mois, ni enveloppe saisie) : une cellule est une part d'équipe sur un livrable (BudgetLine « Équipe »), un forfait externe est une ligne « Forfait ».
 * Les totaux par workpackage, par équipe et par projet sont des SOMMES du plan ; la seule autre saisie est la dotation de l'équipe (60_Exercise.gs).
 */

function monthOf_(d) { return String(d).slice(0, 7); }

/** Une ligne est « externe » si c'est un forfait auprès d'une ressource externe (colonne Externe du plan). */
function lineIsExternal_(l) { return isTrue(l.is_external) || l.cost_type === 'Forfait'; }

function budgetNumber_(v, label, max) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(',', '.'));
  if (isBlank(v) || isNaN(n) || n < 0 || n > (max || 1e9)) throw new PpmError('VALIDATION', label + ' : un nombre positif ou nul.');
  return n;
}

/**
 * La vue d'une ligne de budget. `lookups` : { resById, teamById, exById }. Une part d'équipe dit son équivalent en jours (montant ÷ coût journalier de l'ETP du pays de l'équipe, pour l'année de l'exercice
 * du livrable, à défaut celle de ses dates) ; `days_equivalent` est null tant que le coût d'un ETP du pays et de l'année n'est pas paramétré : on n'invente jamais un chiffre.
 */
function lineView_(l, ctx, lookups, deliverable) {
  var res = lookups.resById[l.resource_id], team = lookups.teamById[l.team_id];
  var isTeam = l.cost_type === 'Équipe';
  var ex = deliverable && !isBlank(deliverable.exercise_id) && lookups.exById ? lookups.exById[deliverable.exercise_id] : null;
  var year = ex ? Number(ex.year) : Number(String((deliverable && (deliverable.planned_finish || deliverable.planned_start)) || todayStr()).slice(0, 4));   // l'année de l'exercice, sinon celle des dates
  var country = team ? (team.country || 'FR') : '';
  return {
    id: l.id, version: l.version, deliverable_id: l.deliverable_id,
    kind: isTeam ? 'team' : 'forfait',
    resource: { id: l.resource_id || '', name: res ? res.name : '', type: res ? res.resource_type : '' },
    team: isTeam ? { id: l.team_id || '', name: team ? team.name : '', country: country } : null,
    external: lineIsExternal_(l), cost_type: l.cost_type,
    fixed_amount: isBlank(l.fixed_amount) ? null : Number(l.fixed_amount), planned_amount: Number(l.planned_amount) || 0,
    days_equivalent: isTeam && team ? daysFromAmount_(Number(l.planned_amount) || 0, country, year) : null
  };
}

function budgetViewLookups_(extraRes) {
  return { resById: indexBy_(extraRes || repoList('Resource')), teamById: indexBy_(repoList('HierarchicalTeam')), exById: indexBy_(repoList('Exercise')) };
}

defineAction('budget.line.save', function (p, ctx) {
  etpReset_();
  var v = p.values || {};
  var isUpdate = !isBlank(p.id);
  var line = isUpdate ? mustGet('BudgetLine', p.id) : null;
  var deliverable = mustGet('PlanItem', isUpdate ? line.deliverable_id : requireParam(v, 'deliverable_id'));
  if (deliverable.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'Le budget se rattache à un livrable, pas à un jalon.');
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  return withLock(function () {
    var ex = exerciseForLine_(deliverable, p.exerciseId);
    // une part d'équipe (team_id + montant libre) ou un forfait auprès d'une ressource externe (resource_id + forfait) ; le type d'une ligne existante ne change pas
    var isTeam = line ? line.cost_type === 'Équipe' : !isBlank(v.team_id);
    if (line && (isTeam ? !isBlank(v.resource_id) : !isBlank(v.team_id))) throw new PpmError('VALIDATION', 'Le type d’une ligne ne change pas : supprimez-la puis créez-en une autre.');
    var out;
    if (isTeam) {
      var teamId = 'team_id' in v && !isBlank(v.team_id) ? v.team_id : (line ? line.team_id : requireParam(v, 'team_id'));
      var team = repoGet('HierarchicalTeam', teamId);
      if (!team || isTrue(team.deleted)) throw new PpmError('VALIDATION', 'Équipe introuvable.');
      if (repoList('BudgetLine', function (l) { return l.deliverable_id === deliverable.id && l.team_id === teamId && (!line || l.id !== line.id); }).length) {
        throw new PpmError('VALIDATION', 'Cette équipe a déjà une part sur ce livrable : modifiez-la.');
      }
      var amount = budgetNumber_('planned_amount' in v ? v.planned_amount : (line ? line.planned_amount : ''), 'Montant');
      out = { team_id: teamId, resource_id: '', cost_type: 'Équipe', planned_amount: round2(amount), fixed_amount: '', is_external: false };
    } else {
      var resId = 'resource_id' in v && !isBlank(v.resource_id) ? v.resource_id : (line ? line.resource_id : requireParam(v, 'resource_id'));
      var res = repoGet('Resource', resId);
      if (!res || isTrue(res.deleted)) throw new PpmError('VALIDATION', 'Ressource introuvable.');
      if (res.resource_type !== 'Externe') throw new PpmError('VALIDATION', 'Un forfait se passe auprès d’une ressource externe : le budget interne se saisit par équipe.');
      if (repoList('BudgetLine', function (l) { return l.deliverable_id === deliverable.id && l.resource_id === resId && (!line || l.id !== line.id); }).length) {
        throw new PpmError('VALIDATION', 'Cette ressource a déjà une ligne sur ce livrable : modifiez-la.');
      }
      var fixed = budgetNumber_('fixed_amount' in v ? v.fixed_amount : (line ? line.fixed_amount : ''), 'Forfait');
      out = { resource_id: resId, team_id: '', cost_type: 'Forfait', fixed_amount: round2(fixed), planned_amount: round2(fixed), is_external: true };
    }
    var rec = line ? repoUpdate('BudgetLine', line.id, out, p.version, ctx.actx)
      : repoInsert('BudgetLine', Object.assign({ deliverable_id: deliverable.id }, out), ctx.actx);
    if (ex && isBlank(deliverable.exercise_id)) deliverable = repoUpdate('PlanItem', deliverable.id, { exercise_id: ex.id }, null, ctx.actx);   // un livrable n'a qu'un exercice : celui de sa première part
    return lineView_(rec, ctx, budgetViewLookups_(), deliverable);
  });
});

/**
 * Une CELLULE du plan : le montant d'une équipe sur un livrable. Un montant vide (ou nul) retire la part ; sinon elle est créée ou remplacée. C'est la saisie du tableau livrable × équipe.
 * Mêmes droits et mêmes règles que `budget.line.save` : qui peut modifier le budget du livrable, jamais dans un exercice clos, un livrable n'a qu'un exercice.
 */
defineAction('budget.cell.set', function (p, ctx) {
  etpReset_();
  var deliverable = mustGet('PlanItem', requireParam(p, 'deliverableId'));
  if (deliverable.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'Le budget se rattache à un livrable, pas à un jalon.');
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  var team = mustGet('HierarchicalTeam', requireParam(p, 'teamId'));
  if (isTrue(team.deleted)) throw new PpmError('VALIDATION', 'Équipe introuvable.');
  var clear = isBlank(p.amount) || Number(String(p.amount).replace(',', '.')) === 0;
  var amount = clear ? 0 : round2(budgetNumber_(p.amount, 'Montant'));
  return withLock(function () {
    var ex = exerciseForLine_(deliverable, p.exerciseId);
    var line = repoList('BudgetLine', function (l) { return l.deliverable_id === deliverable.id && l.team_id === team.id; })[0] || null;
    if (clear) {
      if (line) repoSoftDelete('BudgetLine', line.id, null, ctx.actx);
      return { cleared: true, deliverable_id: deliverable.id, team_id: team.id };
    }
    var vals = { team_id: team.id, resource_id: '', cost_type: 'Équipe', planned_amount: amount, fixed_amount: '', is_external: false };
    var rec = line ? repoUpdate('BudgetLine', line.id, vals, null, ctx.actx) : repoInsert('BudgetLine', Object.assign({ deliverable_id: deliverable.id }, vals), ctx.actx);
    if (ex && isBlank(deliverable.exercise_id)) deliverable = repoUpdate('PlanItem', deliverable.id, { exercise_id: ex.id }, null, ctx.actx);
    return lineView_(rec, ctx, budgetViewLookups_(), deliverable);
  });
});

defineAction('budget.line.delete', function (p, ctx) {
  var line = mustGet('BudgetLine', requireParam(p, 'id'));
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: line.deliverable_id });
  return withLock(function () {
    exerciseForLine_(mustGet('PlanItem', line.deliverable_id), '');   // rien ne se retire d'un exercice clos
    repoSoftDelete('BudgetLine', line.id, p.version, ctx.actx);
    return { deleted: true };
  });
});

// ---------------------------------------------------------------- vues : accès, lignes, bilan

function budgetAccess_(ctx, projectId) {
  var scope = { type: 'project', id: projectId };
  var all = can(ctx, 'budget.edit', scope);
  var hasWp = !all && repoList('PlanItem', function (i) { return i.project_id === projectId && i.item_type === 'Livrable'; })
    .some(function (i) { return can(ctx, 'budget.edit', { type: 'planitem', id: i.id }); });
  return {
    budget: all || hasWp, all: all, po: ctx.isAdmin || all || canPoView_(ctx, projectId),
    cpn: can(ctx, 'cpn.edit', scope), exercise: ctx.isAdmin || can(ctx, 'exercise.read', scope)
  };
}

defineAction('budget.access', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var a = budgetAccess_(ctx, project.id);
  return Object.assign({ project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '', version: project.version } }, a);
});

// ---------------------------------------------------------------- bilan par CPN (fonction pure)

var PO_COMMITTED = ['Lancée', 'GR', 'Terminée'];

/**
 * d : { project, wps, items, lines, pos: [{ cpn, status, amount, launched_on }] }.
 * Un livrable relève du CPN de son premier workpackage ancêtre qui en porte un, à défaut de celui du projet.
 * Les PO relèvent du CPN qu'elles portent. Engagé = lancée + GR + terminée, en une fois (aucun étalement).
 */
function computeBalance_(d) {
  var wpById = indexBy_(d.wps), itemById = indexBy_(d.items);
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(d.project.cpn);
  };
  var groups = {}, order = [];
  var group = function (cpn, label) {
    var k = cpn || '';
    if (!groups[k]) {
      groups[k] = { cpn: k, label: label || '', sources: [], budget: { total: 0, internal: 0, external: 0 }, po: { planned: 0, committed: 0, received: 0, closed: 0, count: 0 } };
      order.push(k);
    }
    if (label && !groups[k].label) groups[k].label = label;
    return groups[k];
  };
  projectCpns_(d.project, d.wps).forEach(function (c) { var g = group(c.cpn, c.label); g.sources = c.sources; });
  d.lines.forEach(function (l) {
    var it = itemById[l.deliverable_id];
    if (!it) return;
    var g = group(cpnOf(it), ''), a = Number(l.planned_amount) || 0;
    g.budget.total += a;
    if (lineIsExternal_(l)) g.budget.external += a; else g.budget.internal += a;
  });
  d.pos.forEach(function (po) {
    var g = group(normCpn_(po.cpn), ''), a = Number(po.amount) || 0;
    g.po.count++;
    if (po.status === 'À faire') g.po.planned += a;
    if (PO_COMMITTED.indexOf(po.status) >= 0) g.po.committed += a;
    if (po.status === 'GR' || po.status === 'Terminée') g.po.received += a;
    if (po.status === 'Terminée') g.po.closed += a;
  });
  var tot = { budget: { total: 0, internal: 0, external: 0 }, po: { planned: 0, committed: 0, received: 0, closed: 0, count: 0 } };
  var cpns = order.map(function (k) {
    var g = groups[k];
    ['total', 'internal', 'external'].forEach(function (f) { g.budget[f] = round2(g.budget[f]); tot.budget[f] = round2(tot.budget[f] + g.budget[f]); });
    ['planned', 'committed', 'received', 'closed'].forEach(function (f) { g.po[f] = round2(g.po[f]); tot.po[f] = round2(tot.po[f] + g.po[f]); });
    tot.po.count += g.po.count;
    g.remaining_external = round2(g.budget.external - g.po.committed);
    g.overrun = g.po.committed > g.budget.external + 0.005;
    return g;
  }).sort(function (a, b) { return (a.cpn === '') - (b.cpn === '') || a.cpn.localeCompare(b.cpn); });
  return { cpns: cpns, totals: Object.assign(tot, { remaining_external: round2(tot.budget.external - tot.po.committed), overrun: tot.po.committed > tot.budget.external + 0.005 }) };
}

defineAction('budget.balance', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.all) throw new PpmError('FORBIDDEN', 'Le bilan du projet est réservé à ses responsables de budget.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  // un exercice demandé : les livrables de son exercice et les commandes de son année seulement (étanchéité)
  var exB = isBlank(p.exerciseId) ? null : mustGet('Exercise', p.exerciseId);
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable' && (!exB || i.exercise_id === exB.id); });
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var lines = repoList('BudgetLine', function (l) { return ids[l.deliverable_id]; });
  // une version du plan (une baseline) : le suivi lit la version de référence, pas le brouillon
  var rvB = exB && !isBlank(p.version) ? resolveDecompVersion_(project, p.version) : null;
  if (rvB && rvB.version) {
    var Dv = decompDataset_(project, exB, rvB.version);
    items = Dv.items.filter(function (i) { return i.item_type === 'Livrable' && i.exercise_id === exB.id; });
    ids = {}; items.forEach(function (i) { ids[i.id] = true; });
    lines = Dv.lines.filter(function (l) { return ids[l.deliverable_id]; });
  }
  var pos = projectOrders_(project.id, wps);
  if (exB) pos = pos.filter(function (o) { return poYear_(o) === Number(exB.year); });
  var bal = computeBalance_({ project: project, wps: wps, items: items, lines: lines, pos: pos });
  return Object.assign({ project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '' } }, bal);
});
