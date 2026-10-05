/**
 * PPM Core — 0.9.0 : budget, taux, CPN (lot 3, première partie).
 *
 *  - CPN : code financier d'un projet, avec sa désignation. Un workpackage de premier niveau (le « sous-projet »)
 *    peut porter le sien. Un CPN ne couvre qu'un seul projet, au maximum. Les analyses budgétaires se font par CPN.
 *  - Grille de taux (RateCard) : taux journalier par profil et par pays, avec date d'effet. Réservée au chef de projet
 *    et au DPL (décision par défaut, à relâcher si besoin).
 *  - Lignes de budget par livrable : ressource interne = jours × taux (taux FIGÉ à la création de la ligne) ;
 *    ressource externe = forfait. Étalement automatique (interne : au prorata des jours ouvrés de chaque mois ;
 *    externe : en totalité le mois de la livraison), modifiable à la main.
 *  - Bilan par CPN : budget (interne, externe) face aux commandes d'achat engagées (44_Orders.gs).
 * Fonctions de calcul pures : phasingFor_, computeBalance_.
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

// ---------------------------------------------------------------- grille de taux

function rateFor_(profile, country, onDate) {
  var p = String(profile || '').toLowerCase().trim();
  var rows = repoList('RateCard', function (r) { return String(r.profile).toLowerCase().trim() === p && r.country === country; })
    .filter(function (r) { return isBlank(r.effective_date) || String(r.effective_date) <= onDate; })
    .sort(function (a, b) { return String(b.effective_date || '').localeCompare(String(a.effective_date || '')); });
  return rows.length ? Number(rows[0].daily_rate) : null;
}

function requireRates_(ctx) {
  if (!ctx.isAdmin && !can(ctx, 'ratecard.manage', { type: 'global' })) throw new PpmError('FORBIDDEN', 'Les taux journaliers sont réservés au chef de projet et au DPL.');
}

defineAction('rates.list', function (p, ctx) {
  requireRates_(ctx);
  var rows = repoList('RateCard').map(function (r) {
    return { id: r.id, version: r.version, profile: r.profile, country: r.country, daily_rate: Number(r.daily_rate), effective_date: r.effective_date || '' };
  }).sort(function (a, b) { return String(a.profile).localeCompare(String(b.profile), 'fr') || String(a.country).localeCompare(String(b.country)) || String(b.effective_date).localeCompare(String(a.effective_date)); });
  var profiles = {};
  rows.forEach(function (r) { profiles[r.profile] = true; });
  repoList('Resource').forEach(function (r) { if (!isBlank(r.rate_profile)) profiles[r.rate_profile] = true; });
  return { rates: rows, profiles: Object.keys(profiles).sort(function (a, b) { return a.localeCompare(b, 'fr'); }), countries: COUNTRIES };
});

defineAction('rates.set', function (p, ctx) {
  requireRates_(ctx);
  var v = p.values || {};
  var profile = wbsShortText_(v.profile, 60, 'Profil');
  if (!profile) throw new PpmError('VALIDATION', 'Le profil est obligatoire.');
  if (COUNTRIES.indexOf(v.country) < 0) throw new PpmError('VALIDATION', 'Pays inconnu : ' + COUNTRIES.join(', ') + '.');
  var rate = Number(v.daily_rate);
  if (isBlank(v.daily_rate) || isNaN(rate) || rate <= 0 || rate > 100000) throw new PpmError('VALIDATION', 'Taux journalier : un nombre positif.');
  var date = wbsDate_(v.effective_date, 'Date d’effet');
  var values = { profile: profile, country: v.country, daily_rate: round2(rate), effective_date: date };
  var dup = repoList('RateCard', function (r) {
    return r.id !== p.id && String(r.profile).toLowerCase() === profile.toLowerCase() && r.country === v.country && String(r.effective_date || '') === date;
  });
  if (dup.length) throw new PpmError('VALIDATION', 'Ce profil a déjà un taux pour ce pays à cette date d’effet : modifiez-le.');
  return isBlank(p.id) ? repoInsert('RateCard', values, ctx.actx) : repoUpdate('RateCard', p.id, values, p.version, ctx.actx);
});

defineAction('rates.delete', function (p, ctx) {
  requireRates_(ctx);
  return repoSoftDelete('RateCard', requireParam(p, 'id'), p.version, ctx.actx);
});

/** Profil tarifaire des personnes internes (réservé à ceux qui gèrent les taux). */
defineAction('rates.people', function (p, ctx) {
  requireRates_(ctx);
  return repoList('Resource').filter(function (r) { return r.resource_type === 'Interne'; }).map(function (r) {
    return { resource_id: r.id, name: r.name, country: r.country || '', rate_profile: r.rate_profile || '', version: r.version };
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); });
});

defineAction('rates.assign', function (p, ctx) {
  requireRates_(ctx);
  var r = mustGet('Resource', requireParam(p, 'resource_id'));
  return repoUpdate('Resource', r.id, { rate_profile: wbsShortText_(p.rate_profile, 60, 'Profil') }, p.version, ctx.actx);
});

// ---------------------------------------------------------------- étalement (fonction pure)

function monthOf_(d) { return String(d).slice(0, 7); }

/** Étalement d'une ligne : [{ month, amount }], somme = montant planifié. hol : jours fériés du calendrier du projet. */
function phasingFor_(line, deliverable, hol) {
  var amount = round2(Number(line.planned_amount) || 0);
  var start = deliverable.planned_start || '', finish = deliverable.planned_finish || '';
  if (!amount || (!start && !finish)) return [];
  if (line.cost_type === 'Forfait' || !start || !finish) return [{ month: monthOf_(finish || start), amount: amount }];
  var counts = {}, total = 0, months = [];
  for (var d = start; d <= finish; d = addCalendarDays(d, 1)) {
    if (!isWorkingDay(d, hol)) continue;
    var m = monthOf_(d);
    if (!counts[m]) { counts[m] = 0; months.push(m); }
    counts[m]++; total++;
  }
  if (!total) return [{ month: monthOf_(finish), amount: amount }];
  var out = [], acc = 0;
  months.forEach(function (m, i) {
    var a = i === months.length - 1 ? round2(amount - acc) : round2(amount * counts[m] / total);
    acc = round2(acc + a);
    out.push({ month: m, amount: a });
  });
  return out;
}

function holidaysOfProject_(projectId) {
  var project = repoGet('Project', projectId);
  return loadHolidayMap((project && project.holiday_country) || 'FR');
}

/** Remplace l'étalement d'une ligne (mode auto : recalculé depuis les dates du livrable). */
function writePhasing_(line, months, actx) {
  repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, actx); });
  months.forEach(function (m) { repoInsert('BudgetPhasing', { budget_line_id: line.id, month: m.month, amount: m.amount }, actx); });
}

function rephaseLine_(line, deliverable, actx) {
  writePhasing_(line, phasingFor_(line, deliverable, holidaysOfProject_(deliverable.project_id)), actx);
}

/** Les dates d'un livrable changent : les lignes en étalement automatique suivent. Ne bloque jamais la saisie. */
function hookRephase(before, rec) {
  try {
    if (rec.item_type !== 'Livrable' || !before) return;
    if (String(before.planned_start || '') === String(rec.planned_start || '') && String(before.planned_finish || '') === String(rec.planned_finish || '')) return;
    var actx = { actor: 'ppm-core', source: 'core' };
    repoList('BudgetLine', function (l) { return l.deliverable_id === rec.id && l.phasing_mode !== 'manuel'; }).forEach(function (l) { rephaseLine_(l, rec, actx); });
  } catch (err) {
    console.error('Étalement : ' + (err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------- lignes de budget

/** Une ligne est « externe » si sa ressource l'est (jours × taux ou forfait) ; les anciennes lignes au forfait le sont par nature. */
function lineIsExternal_(l) { return isTrue(l.is_external) || l.cost_type === 'Forfait'; }

/** Taux journalier d'une personne : celui qu'on a saisi sur sa fiche ; à défaut, la grille (profil, pays, date d'effet), conservée en secours. */
function dailyRateOf_(res, date) {
  if (!isBlank(res.daily_rate) && Number(res.daily_rate) > 0) return Number(res.daily_rate);
  return rateFor_(res.rate_profile, res.country, date);
}

function budgetNumber_(v, label, max) {
  var n = Number(v);
  if (isBlank(v) || isNaN(n) || n < 0 || n > (max || 1e9)) throw new PpmError('VALIDATION', label + ' : un nombre positif ou nul.');
  return n;
}

function lineView_(l, ctx, phasing, resById, projectId) {
  var res = resById[l.resource_id];
  var seeRate = ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'project', id: projectId });
  return {
    id: l.id, version: l.version, deliverable_id: l.deliverable_id,
    resource: { id: l.resource_id, name: res ? res.name : '', type: res ? res.resource_type : '' },
    external: lineIsExternal_(l), cost_type: l.cost_type, planned_days: isBlank(l.planned_days) ? null : Number(l.planned_days),
    frozen_rate: seeRate && !isBlank(l.frozen_rate) ? Number(l.frozen_rate) : null,
    fixed_amount: isBlank(l.fixed_amount) ? null : Number(l.fixed_amount), planned_amount: Number(l.planned_amount) || 0,
    phasing_mode: l.phasing_mode === 'manuel' ? 'manuel' : 'auto',
    phasing: (phasing || []).map(function (x) { return { month: x.month, amount: Number(x.amount) || 0 }; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; })
  };
}

defineAction('budget.line.save', function (p, ctx) {
  var v = p.values || {};
  var isUpdate = !isBlank(p.id);
  var line = isUpdate ? mustGet('BudgetLine', p.id) : null;
  var deliverable = mustGet('PlanItem', isUpdate ? line.deliverable_id : requireParam(v, 'deliverable_id'));
  if (deliverable.item_type !== 'Livrable') throw new PpmError('VALIDATION', 'Le budget se rattache à un livrable, pas à un jalon.');
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  return withLock(function () {
    var resId = 'resource_id' in v ? v.resource_id : (line ? line.resource_id : requireParam(v, 'resource_id'));
    var res = repoGet('Resource', resId);
    if (!res || isTrue(res.deleted)) throw new PpmError('VALIDATION', 'Ressource introuvable.');
    if (repoList('BudgetLine', function (l) { return l.deliverable_id === deliverable.id && l.resource_id === resId && (!line || l.id !== line.id); }).length) {
      throw new PpmError('VALIDATION', 'Cette ressource a déjà une ligne sur ce livrable : modifiez-la.');
    }
    var out = { resource_id: resId };
    var resourceChanged = !line || line.resource_id !== resId;
    var external = res.resource_type === 'Externe';
    var given = function (k) { return k in v && !isBlank(v[k]); };
    // Une ressource externe se budgète au forfait OU en jours × taux ; une ressource interne, toujours en jours × taux.
    var fixed = external && (given('fixed_amount') || (!given('planned_days') && !!line && line.cost_type === 'Forfait'));
    if (fixed) {
      var amount = budgetNumber_('fixed_amount' in v ? v.fixed_amount : (line ? line.fixed_amount : ''), 'Forfait');
      Object.assign(out, { cost_type: 'Forfait', fixed_amount: round2(amount), planned_days: '', frozen_rate: '', planned_amount: round2(amount), is_external: true });
    } else {
      var days = budgetNumber_('planned_days' in v ? v.planned_days : (line ? line.planned_days : ''), 'Jours prévus', 100000);
      var rate = line && !resourceChanged && !v.refresh_rate && line.cost_type === 'TJM' ? Number(line.frozen_rate) : null;
      if (rate === null || isNaN(rate)) {
        rate = dailyRateOf_(res, todayStr());
        if (rate === null) throw new PpmError('VALIDATION', 'Aucun taux journalier pour « ' + res.name + ' » : à renseigner dans Ressources (réservé au chef de projet et au DPL).');
      }
      Object.assign(out, { cost_type: 'TJM', planned_days: days, frozen_rate: rate, planned_amount: round2(days * rate), fixed_amount: '', is_external: external });
    }
    var amountChanged = !line || Number(line.planned_amount) !== out.planned_amount;
    if (!line || amountChanged || line.phasing_mode !== 'manuel') out.phasing_mode = 'auto';
    var rec = line ? repoUpdate('BudgetLine', line.id, out, p.version, ctx.actx)
      : repoInsert('BudgetLine', Object.assign({ deliverable_id: deliverable.id }, out), ctx.actx);
    if (out.phasing_mode === 'auto') rephaseLine_(rec, deliverable, ctx.actx);
    var phasing = repoList('BudgetPhasing', function (x) { return x.budget_line_id === rec.id; });
    return lineView_(rec, ctx, phasing, indexBy_([res]), deliverable.project_id);
  });
});

defineAction('budget.line.delete', function (p, ctx) {
  var line = mustGet('BudgetLine', requireParam(p, 'id'));
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: line.deliverable_id });
  return withLock(function () {
    repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, ctx.actx); });
    repoSoftDelete('BudgetLine', line.id, p.version, ctx.actx);
    return { deleted: true };
  });
});

/** Étalement à la main : la somme doit égaler le montant planifié de la ligne. mode = 'auto' revient au calcul. */
defineAction('budget.phasing.set', function (p, ctx) {
  var line = mustGet('BudgetLine', requireParam(p, 'lineId'));
  var deliverable = mustGet('PlanItem', line.deliverable_id);
  requireCan(ctx, 'budget.edit', { type: 'planitem', id: deliverable.id });
  return withLock(function () {
    if (p.mode === 'auto') {
      var rec0 = repoUpdate('BudgetLine', line.id, { phasing_mode: 'auto' }, null, ctx.actx);
      rephaseLine_(rec0, deliverable, ctx.actx);
      return { mode: 'auto', months: repoList('BudgetPhasing', function (x) { return x.budget_line_id === line.id; }).map(function (x) { return { month: x.month, amount: Number(x.amount) }; }) };
    }
    var seen = {}, months = [], sum = 0;
    (Array.isArray(p.months) ? p.months : []).forEach(function (m) {
      var month = String(m && m.month || '').trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PpmError('VALIDATION', 'Mois invalide : « ' + month + ' » (format AAAA-MM).');
      if (seen[month]) throw new PpmError('VALIDATION', 'Le mois ' + month + ' est indiqué deux fois.');
      seen[month] = true;
      var a = budgetNumber_(m.amount, 'Montant de ' + month);
      months.push({ month: month, amount: round2(a) });
      sum = round2(sum + a);
    });
    if (!months.length) throw new PpmError('VALIDATION', 'Indiquez au moins un mois.');
    if (Math.abs(sum - Number(line.planned_amount)) > 0.005) {
      throw new PpmError('VALIDATION', 'La somme des mois (' + sum + ') doit égaler le montant de la ligne (' + Number(line.planned_amount) + ').');
    }
    months.sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    repoUpdate('BudgetLine', line.id, { phasing_mode: 'manuel' }, null, ctx.actx);
    writePhasing_(line, months, ctx.actx);
    return { mode: 'manuel', months: months };
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
    rates: ctx.isAdmin || can(ctx, 'ratecard.manage', { type: 'global' }), cpn: can(ctx, 'cpn.edit', scope)
  };
}

defineAction('budget.access', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var a = budgetAccess_(ctx, project.id);
  return Object.assign({ project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '', version: project.version } }, a);
});

/** Lignes de budget d'un projet, par livrable, avec étalement ; les lignes hors périmètre de l'utilisateur sont masquées. */
defineAction('budget.get', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.budget) throw new PpmError('FORBIDDEN', 'Le budget est réservé aux responsables de budget du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps);
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var editable = {};
  items.forEach(function (i) { if (access.all || can(ctx, 'budget.edit', { type: 'planitem', id: i.id })) editable[i.id] = true; });
  var lines = repoList('BudgetLine', function (l) { return editable[l.deliverable_id]; });
  var lineIds = {}; lines.forEach(function (l) { lineIds[l.id] = true; });
  var phasing = {};
  repoList('BudgetPhasing', function (x) { return lineIds[x.budget_line_id]; }).forEach(function (x) { (phasing[x.budget_line_id] = phasing[x.budget_line_id] || []).push(x); });
  var resById = indexBy_(repoList('Resource'));
  var views = lines.map(function (l) { return lineView_(l, ctx, phasing[l.id], resById, project.id); });
  var topWp = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && w.parent_wp_id && wpById[w.parent_wp_id] && guard++ < 5) w = wpById[w.parent_wp_id];
    return w;
  };
  var byId = indexBy_(items);
  var months = {}, byWp = {};
  views.forEach(function (l) {
    l.phasing.forEach(function (m) { months[m.month] = round2((months[m.month] || 0) + m.amount); });
    var it = byId[l.deliverable_id], w = it ? topWp(it) : null, key = w ? w.id : '';
    var g = byWp[key] = byWp[key] || { wp_id: key, code: w ? w.wbs_code || '' : '', name: w ? w.name : 'Sans workpackage', internal: 0, external: 0, total: 0 };
    if (l.external) g.external = round2(g.external + l.planned_amount); else g.internal = round2(g.internal + l.planned_amount);
    g.total = round2(g.internal + g.external);
  });
  var withBudget = {}; lines.forEach(function (l) { withBudget[l.deliverable_id] = true; });
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(project.cpn);
  };
  var wpLabel = function (item) { var w = item.wp_id ? wpById[item.wp_id] : null; return w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : ''; };
  var deliverables = items.filter(function (i) { return editable[i.id]; }).map(function (i) {
    return { id: i.id, name: i.name, wp: wpLabel(i), cpn: cpnOf(i), start: i.planned_start || null, finish: i.planned_finish || null, has_budget: !!withBudget[i.id] };
  }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); });
  var total = 0, ext = 0;
  views.forEach(function (l) { total = round2(total + l.planned_amount); if (l.external) ext = round2(ext + l.planned_amount); });
  return {
    project: { id: project.id, code: project.code, name: project.name }, partial: !access.all,
    lines: views, deliverables: deliverables,
    totals: { total: total, external: ext, internal: round2(total - ext), by_wp: Object.keys(byWp).map(function (k) { return byWp[k]; }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); }) },
    months: Object.keys(months).sort().map(function (m) { return { month: m, planned: months[m] }; }),
    missing: { deliverables_without_budget: deliverables.filter(function (d) { return !d.has_budget; }).length, undated_lines: views.filter(function (l) { return !l.phasing.length; }).length }
  };
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

/** Engagements par mois : chaque PO engagée compte en totalité le mois de son lancement. */
function committedByMonth_(pos) {
  var out = {};
  pos.forEach(function (po) {
    if (PO_COMMITTED.indexOf(po.status) < 0 || isBlank(po.launched_on)) return;
    var m = monthOf_(po.launched_on);
    out[m] = round2((out[m] || 0) + (Number(po.amount) || 0));
  });
  return out;
}

defineAction('budget.balance', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = budgetAccess_(ctx, project.id);
  if (!access.all) throw new PpmError('FORBIDDEN', 'Le bilan du projet est réservé à ses responsables de budget.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var lines = repoList('BudgetLine', function (l) { return ids[l.deliverable_id]; });
  var pos = projectOrders_(project.id, wps);
  var bal = computeBalance_({ project: project, wps: wps, items: items, lines: lines, pos: pos });
  var planned = {};
  repoList('BudgetPhasing', function (x) { return lines.some(function (l) { return l.id === x.budget_line_id; }); }).forEach(function (x) { planned[x.month] = round2((planned[x.month] || 0) + Number(x.amount)); });
  var committed = committedByMonth_(pos), months = {};
  Object.keys(planned).concat(Object.keys(committed)).forEach(function (m) { months[m] = true; });
  return Object.assign({
    project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '' },
    months: Object.keys(months).sort().map(function (m) { return { month: m, planned: planned[m] || 0, committed: committed[m] || 0 }; })
  }, bal);
});
