/**
 * PPM Core — 0.15.3 : budget par workpackage, de haut en bas.
 *
 * Le chef de projet fixe l'ENVELOPPE AUTORISÉE du projet (`Project.budget_authorized`) et la répartit entre les workpackages (`WorkPackage.budget_allocated`) ; le Workpackage
 * leader répartit à son tour la sienne entre ses sous-workpackages. Les lignes de budget des livrables (page Budget, « Budget par livrable ») restent la mesure du coût prévu :
 * la page les met en regard de l'enveloppe, workpackage par workpackage.
 *
 * RÈGLES. Les sous-workpackages d'un workpackage ne dépassent pas son enveloppe ; les workpackages de premier niveau ne dépassent pas l'enveloppe du projet (si elle est fixée) ;
 * un sous-workpackage ne reçoit rien tant que son parent n'a pas d'enveloppe. Dépasser l'enveloppe avec des lignes de budget n'est PAS bloqué : c'est signalé (« dépassé »), parce
 * que le coût d'un livrable est une information vraie qu'on ne refuse pas de saisir. Une enveloppe non fixée (vide) veut dire « pas de plafond », pas zéro.
 *
 * QUI. Fixer l'enveloppe du projet et celles des workpackages de premier niveau : `budget.authorize` (chef de projet et au-dessus). Celle d'un sous-workpackage : un niveau strictement
 * supérieur au sien sur le workpackage parent (son Workpackage leader, et au-dessus). Chacun ne voit que ce qui relève de son budget : un Workpackage leader, son workpackage seulement.
 * Toute modification est un changement à valider par le niveau du dessus (54_Validation.gs).
 */

/** Les enveloppes ne s'écrivent que par budget.envelope.set : on les retire de ce que les écritures génériques reçoivent. */
function stripEnvelope_(obj) {
  var out = Object.assign({}, obj || {});
  delete out.budget_authorized; delete out.budget_allocated;
  return out;
}

function envNumber_(v, label) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new PpmError('VALIDATION', label + ' : un montant en euros, positif ou nul (ou vide pour « pas de plafond »).');
  return round2(n);
}

/** Peut-on fixer l'enveloppe de ce workpackage ? Un niveau strictement supérieur au sien, sur son parent (le projet pour un workpackage de premier niveau). */
function canAllocateWp_(ctx, wp) {
  if (ctx.isAdmin) return true;
  if (isBlank(wp.parent_wp_id)) return can(ctx, 'budget.authorize', { type: 'project', id: wp.project_id });
  return bestRankOn_(ctx, { type: 'workpackage', id: wp.parent_wp_id }) < ROLE_RANK.SWPL;
}

/** Coût prévu par workpackage (lui et tout ce qu'il contient) et hors workpackage, à partir des lignes de budget des livrables du projet. */
function envelopeCosts_(projectId, wpById) {
  var cost = {}, none = 0;
  var items = indexBy_(repoList('PlanItem', function (i) { return i.project_id === projectId && i.item_type === 'Livrable'; }));
  repoList('BudgetLine', function (l) { return !!items[l.deliverable_id]; }).forEach(function (l) {
    var amount = Number(l.planned_amount) || 0, w = items[l.deliverable_id].wp_id ? wpById[items[l.deliverable_id].wp_id] : null, guard = 0;
    if (!w) { none = round2(none + amount); return; }
    while (w && guard++ < 5) { cost[w.id] = round2((cost[w.id] || 0) + amount); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
  });
  return { byWp: cost, none: none };
}

function envelopeView_(ctx, project) {
  var access = budgetAccess_(ctx, project.id);
  if (!access.budget) throw new PpmError('FORBIDDEN', 'Le budget est réservé aux responsables de budget du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps), costs = envelopeCosts_(project.id, wpById);
  var visible = function (w) { return access.all || can(ctx, 'budget.edit', { type: 'workpackage', id: w.id }); };
  var num = function (v) { return isBlank(v) ? null : Number(v); };
  var kids = {}; wps.forEach(function (w) { if (w.parent_wp_id) (kids[w.parent_wp_id] = kids[w.parent_wp_id] || []).push(w); });
  var rows = [];
  var order = function (a, b) { return String(a.wbs_code).localeCompare(String(b.wbs_code), 'fr', { numeric: true }); };
  var walk = function (w, depth) {
    if (visible(w)) {
      var alloc = num(w.budget_allocated), cost = costs.byWp[w.id] || 0;
      var childSum = round2((kids[w.id] || []).reduce(function (s, k) { return s + (Number(k.budget_allocated) || 0); }, 0));
      rows.push({
        wp_id: w.id, version: w.version, code: w.wbs_code || '', name: w.name, parent_id: w.parent_wp_id && visible(wpById[w.parent_wp_id] || {}) ? w.parent_wp_id : '', depth: depth,
        allocated: alloc, cost: cost, remaining: alloc === null ? null : round2(alloc - cost), over: alloc !== null && cost > alloc,
        children_allocated: childSum, unallocated: alloc === null || !(kids[w.id] || []).length ? null : round2(alloc - childSum), canSet: canAllocateWp_(ctx, w)
      });
    }
    (kids[w.id] || []).sort(order).forEach(function (k) { walk(k, depth + 1); });
  };
  wps.filter(function (w) { return isBlank(w.parent_wp_id) || !wpById[w.parent_wp_id]; }).sort(order).forEach(function (w) { walk(w, 0); });
  var top = wps.filter(function (w) { return isBlank(w.parent_wp_id); });
  var authorized = num(project.budget_authorized), allocated = round2(top.reduce(function (s, w) { return s + (Number(w.budget_allocated) || 0); }, 0));
  var total = 0; Object.keys(costs.byWp).forEach(function (k) { if (!wpById[k].parent_wp_id) total = round2(total + costs.byWp[k]); });
  total = round2(total + costs.none);
  var out = { project: { id: project.id, code: project.code, name: project.name, version: project.version }, rows: rows, partial: !access.all, canSetProject: ctx.isAdmin || can(ctx, 'budget.authorize', { type: 'project', id: project.id }) };
  if (access.all) {
    out.totals = { authorized: authorized, allocated: allocated, reserve: authorized === null ? null : round2(authorized - allocated), cost: total, cost_without_wp: costs.none,
      remaining: authorized === null ? null : round2(authorized - total), over: authorized !== null && total > authorized };
  }
  return out;
}

defineAction('budget.envelope.get', function (p, ctx) {
  return envelopeView_(ctx, mustGet('Project', requireParam(p, 'projectId')));
});

/**
 * Fixe l'enveloppe du projet (`authorized`, vide = pas de plafond) et/ou celles de workpackages (`allocations` : [{ wpId, amount }], vide = pas de plafond). Tout ou rien :
 * les droits et les règles de somme se vérifient sur l'état final avant la moindre écriture.
 */
defineAction('budget.envelope.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var allocations = Array.isArray(p.allocations) ? p.allocations : [];
  if (!('authorized' in p) && !allocations.length) throw new PpmError('VALIDATION', 'Rien à enregistrer.');
  return withLock(function () {
    var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; }), wpById = indexBy_(wps);
    var next = {}; wps.forEach(function (w) { next[w.id] = isBlank(w.budget_allocated) ? '' : Number(w.budget_allocated); });
    var changes = [];
    var authorized = isBlank(project.budget_authorized) ? '' : Number(project.budget_authorized);
    if ('authorized' in p) {
      if (!ctx.isAdmin && !can(ctx, 'budget.authorize', { type: 'project', id: project.id })) throw new PpmError('FORBIDDEN', 'Seul le chef de projet (ou un niveau au-dessus) fixe l’enveloppe du projet.');
      var a = envNumber_(p.authorized, 'Budget autorisé');
      if (a !== authorized) { authorized = a; changes.push({ table: 'Project', id: project.id, patch: { budget_authorized: a === '' ? '' : a }, version: project.version }); }
    }
    allocations.forEach(function (x) {
      var w = wpById[String(x.wpId)];
      if (!w) throw new PpmError('NOT_FOUND', 'Workpackage introuvable dans ce projet : ' + x.wpId);
      if (!canAllocateWp_(ctx, w)) throw new PpmError('FORBIDDEN', 'L’enveloppe de « ' + w.name + ' » est fixée par ' + (isBlank(w.parent_wp_id) ? 'le chef de projet (ou au-dessus)' : 'son Workpackage leader (ou au-dessus)') + '.');
      var v = envNumber_(x.amount, 'Enveloppe de « ' + w.name + ' »');
      if (v !== next[w.id]) { next[w.id] = v; changes.push({ table: 'WorkPackage', id: w.id, patch: { budget_allocated: v === '' ? '' : v }, version: w.version }); }
    });
    // sommes : sur l'état final
    var sumOf = function (list) { return round2(list.reduce(function (s, w) { return s + (next[w.id] === '' ? 0 : next[w.id]); }, 0)); };
    var top = wps.filter(function (w) { return isBlank(w.parent_wp_id); });
    if (authorized !== '' && sumOf(top) > authorized) throw new PpmError('VALIDATION', 'Les enveloppes des workpackages (' + sumOf(top) + ' €) dépassent le budget autorisé du projet (' + authorized + ' €).', { rule: 'ENVELOPE_PROJECT', allocated: sumOf(top), authorized: authorized });
    wps.filter(function (w) { return isBlank(w.parent_wp_id); }).forEach(function (w) {
      var kids = wps.filter(function (k) { return k.parent_wp_id === w.id; }), s = sumOf(kids);
      if (!kids.length || s === 0) return;
      if (next[w.id] === '') throw new PpmError('VALIDATION', 'Fixez d’abord l’enveloppe de « ' + w.name + ' » : ses sous-workpackages ne peuvent pas en recevoir tant qu’elle est vide.', { rule: 'ENVELOPE_PARENT_EMPTY', wp: w.id });
      if (s > next[w.id]) throw new PpmError('VALIDATION', 'Les enveloppes des sous-workpackages de « ' + w.name + ' » (' + s + ' €) dépassent la sienne (' + next[w.id] + ' €).', { rule: 'ENVELOPE_WP', wp: w.id, allocated: s, envelope: next[w.id] });
    });
    changes.forEach(function (c) { repoUpdate(c.table, c.id, c.patch, null, ctx.actx); });
    var fresh = mustGet('Project', project.id);
    var view = envelopeView_(ctx, fresh);
    view.changed = changes.length;
    return view;
  });
});
