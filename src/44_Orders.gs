/**
 * PPM Core — 0.9.0 : commandes d'achat (PO).
 *
 * Une PO est passée auprès d'une ressource EXTERNE. Elle porte un CPN saisi à la main et un numéro unique saisi à la main
 * (celui de Click and Buy). Si son CPN est celui d'un projet de l'outil (ou d'un de ses sous-projets), elle impacte le bilan
 * budgétaire de ce projet ; sinon elle est simplement enregistrée, sans effet sur aucun budget de l'outil.
 *
 * Quatre statuts : À faire (prévisionnel, rien d'engagé), Lancée (engagée), GR (good receipt : prestation réceptionnée),
 * Terminée (soldée). L'engagement se fait EN UNE FOIS, en totalité, à la date de lancement : aucun étalement.
 * Chaque PO indique la date à laquelle la GR doit être faite ; à l'approche de cette date, puis au-delà, un rappel part
 * dans le récapitulatif quotidien de son responsable et un constat apparaît pour le pilotage.
 *
 * Le montant se répartit entre un ou plusieurs livrables du projet, montants réglables (leur somme égale celui de la PO).
 * Droits : toute personne INTERNE nommée dans l'équipe du projet crée et modifie les PO de ce projet.
 * Aucun montant n'apparaît dans les constats, les mails ni les demandes à l'IA.
 */

var PO_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
var PO_ORDER = { 'À faire': 0, 'Lancée': 1, 'GR': 2, 'Terminée': 3 };

// ---------------------------------------------------------------- droits

function isInternalUser_(ctx) {
  if (ctx.isAdmin) return true;
  if (!ctx.resourceId) return false;
  var r = repoGet('Resource', ctx.resourceId);
  return !!r && !isTrue(r.deleted) && r.resource_type === 'Interne';
}

/** Nommé dans l'équipe du projet : un rôle sur le projet (ou au-dessus), ou sur l'un de ses workpackages. */
function namedInProject_(ctx, projectId) {
  if (can(ctx, 'po.edit', { type: 'project', id: projectId })) return true;
  var wpIds = {};
  repoList('WorkPackage', function (w) { return w.project_id === projectId; }).forEach(function (w) { wpIds[w.id] = true; });
  return (ctx.assignments || []).some(function (a) { return a.scope_type === 'workpackage' && wpIds[a.scope_id]; });
}

function canPoEdit_(ctx, projectId) {
  if (ctx.isAdmin) return true;
  if (!isInternalUser_(ctx)) return false;
  return projectId ? namedInProject_(ctx, projectId) : (ctx.assignments || []).length > 0;
}

function canPoView_(ctx, projectId) {
  return canPoEdit_(ctx, projectId) || can(ctx, 'budget.edit', { type: 'project', id: projectId });
}

// ---------------------------------------------------------------- validations

function poNumber_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le numéro de PO est obligatoire (celui de Click and Buy).');
  if (!PO_NUMBER_RE.test(s)) throw new PpmError('VALIDATION', 'Numéro de PO invalide : 40 caractères au plus, lettres, chiffres, espace, point, tiret, barre oblique.');
  return s;
}

function poStatus_(s) {
  if (PO_STATUSES.indexOf(s) < 0) throw new PpmError('VALIDATION', 'Statut inconnu : ' + PO_STATUSES.join(', ') + '.');
  return s;
}

function poAmount_(v) {
  var n = Number(v);
  if (isBlank(v) || isNaN(n) || n <= 0 || n > 1e9) throw new PpmError('VALIDATION', 'Montant : un nombre strictement positif.');
  return round2(n);
}

/** Dates propres à chaque statut : l'engagement date du lancement, la réception de la GR, le solde de la clôture. */
function poDates_(status, cur, v, today) {
  var pick = function (key, label) { return key in v ? wbsDate_(v[key], label) : (cur ? String(cur[key] || '') : ''); };
  var launched = pick('launched_on', 'Date de lancement'), grOn = pick('gr_on', 'Date de GR'), closed = pick('closed_on', 'Date de clôture');
  if (status === 'À faire') { launched = ''; grOn = ''; closed = ''; }
  else {
    if (!launched) launched = today;
    if (status === 'Lancée') { grOn = ''; closed = ''; }
    else {
      if (!grOn) grOn = today;
      if (status === 'GR') closed = ''; else if (!closed) closed = today;
    }
  }
  if (grOn && grOn < launched) throw new PpmError('VALIDATION', 'La GR ne peut pas précéder le lancement de la PO.');
  if (closed && grOn && closed < grOn) throw new PpmError('VALIDATION', 'La clôture ne peut pas précéder la GR.');
  return { launched_on: launched, gr_on: grOn, closed_on: closed };
}

function poExternalResource_(id) {
  var r = isBlank(id) ? null : repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Ressource externe introuvable.');
  if (r.resource_type !== 'Externe') throw new PpmError('VALIDATION', 'Une PO est passée auprès d’une ressource externe : « ' + r.name + ' » est interne.');
  return r;
}

function poOwner_(id, ctx) {
  var target = isBlank(id) ? ctx.resourceId : id;
  if (isBlank(target)) return '';
  var r = repoGet('Resource', target);
  if (!r || isTrue(r.deleted) || r.resource_type !== 'Interne') throw new PpmError('VALIDATION', 'Le responsable de la GR doit être une personne interne.');
  return String(target);
}

/** Répartition entre livrables du projet : montants réglables, somme égale au montant de la PO. */
function poLinks_(links, project, amount) {
  if (!links.length) return [];
  if (!project) throw new PpmError('VALIDATION', 'Ce CPN ne correspond à aucun projet de l’outil : la PO ne peut pas être répartie sur des livrables.');
  var items = indexBy_(repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }));
  var seen = {}, out = [], sum = 0;
  links.forEach(function (l) {
    var it = items[l && l.deliverable_id];
    if (!it) throw new PpmError('VALIDATION', 'Livrable introuvable dans le projet ' + project.code + '.');
    if (seen[it.id]) throw new PpmError('VALIDATION', 'Le livrable « ' + it.name + ' » est indiqué deux fois.');
    seen[it.id] = true;
    var a = round2(budgetNumber_(l.amount, 'Montant du livrable « ' + it.name + ' »'));
    out.push({ deliverable_id: it.id, amount: a });
    sum = round2(sum + a);
  });
  if (Math.abs(sum - amount) > 0.005) throw new PpmError('VALIDATION', 'La somme des montants par livrable (' + sum + ') doit égaler le montant de la PO (' + amount + ').');
  return out;
}

// ---------------------------------------------------------------- lecture

function attachLinks_(pos) {
  var byId = {};
  pos.forEach(function (o) { o.links = []; byId[o.id] = o; });
  repoList('PurchaseOrderLink', function (l) { return byId[l.po_id]; }).forEach(function (l) {
    byId[l.po_id].links.push({ id: l.id, deliverable_id: l.deliverable_id, amount: Number(l.amount) || 0 });
  });
  return pos;
}

/** PO d'un projet : celles dont le CPN est celui du projet ou d'un de ses sous-projets. */
function projectOrders_(projectId, wps) {
  var project = repoGet('Project', projectId);
  var set = {};
  projectCpns_(project, wps).forEach(function (c) { set[c.cpn] = true; });
  return attachLinks_(repoList('PurchaseOrder', function (o) { return set[normCpn_(o.cpn)]; }));
}

function grFlag_(o, today) {
  if (o.status !== 'Lancée' || isBlank(o.gr_due_date)) return '';
  if (String(o.gr_due_date) < today) return 'late';
  return String(o.gr_due_date) <= addCalendarDays(today, THRESHOLDS.dueSoonDays) ? 'soon' : '';
}

defineAction('po.options', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!canPoView_(ctx, project.id)) throw new PpmError('FORBIDDEN', 'Les commandes d’achat sont réservées aux personnes internes nommées dans l’équipe du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var wpById = indexBy_(wps);
  var lines = repoList('BudgetLine', lineIsExternal_);
  var ext = {};
  lines.forEach(function (l) { ext[l.deliverable_id] = round2((ext[l.deliverable_id] || 0) + (Number(l.planned_amount) || 0)); });
  var resources = repoList('Resource');
  return {
    cpns: projectCpns_(project, wps),
    externals: resources.filter(function (r) { return r.resource_type === 'Externe'; }).map(function (r) { return { id: r.id, name: r.name, supplier: r.supplier || '' }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }),
    internals: resources.filter(function (r) { return r.resource_type === 'Interne'; }).map(function (r) { return { id: r.id, name: r.name }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'fr'); }),
    deliverables: repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }).map(function (i) {
      var w = i.wp_id ? wpById[i.wp_id] : null;
      return { id: i.id, name: i.name, wp: w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : '', budget_external: ext[i.id] || 0 };
    }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); }),
    canEdit: canPoEdit_(ctx, project.id)
  };
});

function orderView_(o, env, today) {
  var res = env.resById[o.resource_id], owner = env.resById[o.owner_resource_id];
  var links = o.links.map(function (l) { var it = env.itemById[l.deliverable_id]; return { deliverable_id: l.deliverable_id, name: it ? it.name : '(supprimé)', amount: l.amount }; });
  var allocated = round2(o.links.reduce(function (a, l) { return a + l.amount; }, 0));
  var warnings = [];
  var committed = PO_COMMITTED.indexOf(o.status) >= 0;
  if (env.project && o.links.length && Math.abs(allocated - Number(o.amount)) > 0.005) warnings.push('Répartition incomplète : ' + round2(Number(o.amount) - allocated) + ' non affecté à un livrable.');
  if (env.project && !o.links.length) warnings.push('Aucun livrable lié : le montant pèse sur le CPN sans être rattaché à un livrable.');
  o.links.forEach(function (l) {
    var it = env.itemById[l.deliverable_id];
    if (!it) return;
    var e = env.external[it.id] || 0;
    if (l.amount > 0 && e === 0) warnings.push('Le livrable « ' + it.name + ' » n’a pas de budget externe.');
    else if (committed && (env.committed[it.id] || 0) > e + 0.005) warnings.push('Le budget externe du livrable « ' + it.name + ' » est dépassé.');
    if (env.cpnOf && env.cpnOf(it) && env.cpnOf(it) !== normCpn_(o.cpn)) warnings.push('Le livrable « ' + it.name + ' » relève du CPN ' + env.cpnOf(it) + ', pas de ' + normCpn_(o.cpn) + '.');
  });
  if (o.status === 'À faire' && !isBlank(o.start_date) && String(o.start_date) <= today) warnings.push('À lancer : l’activité a commencé le ' + o.start_date + '.');
  return {
    id: o.id, version: o.version, po_number: o.po_number, cpn: normCpn_(o.cpn), cpn_label: env.cpnLabels ? env.cpnLabels[normCpn_(o.cpn)] || '' : '',
    resource: { id: o.resource_id, name: res ? res.name : '(supprimée)', supplier: res ? res.supplier || '' : '' },
    owner: { id: o.owner_resource_id || '', name: owner ? owner.name : '' }, description: o.description || '',
    start_date: o.start_date || '', end_date: o.end_date || '', amount: Number(o.amount) || 0, status: o.status,
    gr_due_date: o.gr_due_date || '', launched_on: o.launched_on || '', gr_on: o.gr_on || '', closed_on: o.closed_on || '',
    gr_flag: grFlag_(o, today), links: links, unallocated: round2(Number(o.amount) - allocated), warnings: warnings, created_by: o.created_by || ''
  };
}

function projectEnv_(project, wps, pos) {
  var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
  var itemById = indexBy_(items), wpById = indexBy_(wps);
  var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
  var external = {}, committed = {};
  repoList('BudgetLine', function (l) { return ids[l.deliverable_id] && lineIsExternal_(l); }).forEach(function (l) { external[l.deliverable_id] = round2((external[l.deliverable_id] || 0) + (Number(l.planned_amount) || 0)); });
  pos.forEach(function (o) { if (PO_COMMITTED.indexOf(o.status) >= 0) o.links.forEach(function (l) { committed[l.deliverable_id] = round2((committed[l.deliverable_id] || 0) + l.amount); }); });
  var cpnOf = function (item) {
    var w = item.wp_id ? wpById[item.wp_id] : null, guard = 0;
    while (w && guard++ < 5) { if (!isBlank(w.cpn)) return normCpn_(w.cpn); w = w.parent_wp_id ? wpById[w.parent_wp_id] : null; }
    return normCpn_(project.cpn);
  };
  var labels = {};
  projectCpns_(project, wps).forEach(function (c) { labels[c.cpn] = c.label; });
  return { project: project, resById: indexBy_(repoList('Resource')), itemById: itemById, external: external, committed: committed, cpnOf: cpnOf, cpnLabels: labels, wpById: wpById, items: items };
}

/** PO d'un projet (par CPN), avec la consommation par livrable ; ou, avec scope = 'outside', mes PO sans projet dans l'outil. */
defineAction('po.list', function (p, ctx) {
  var today = todayStr();
  if (p.scope === 'outside') {
    if (!canPoEdit_(ctx, '')) throw new PpmError('FORBIDDEN', 'Réservé aux personnes internes nommées dans une équipe.');
    var idx = cpnIndex_();
    var mine = attachLinks_(repoList('PurchaseOrder', function (o) {
      return !idx[normCpn_(o.cpn)] && (ctx.isAdmin || String(o.created_by || '').toLowerCase() === ctx.email || (ctx.resourceId && o.owner_resource_id === ctx.resourceId));
    }));
    var env0 = { project: null, resById: indexBy_(repoList('Resource')), itemById: {}, external: {}, committed: {} };
    return { orders: mine.map(function (o) { return orderView_(o, env0, today); }).sort(function (a, b) { return String(a.po_number).localeCompare(String(b.po_number)); }) };
  }
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!canPoView_(ctx, project.id)) throw new PpmError('FORBIDDEN', 'Les commandes d’achat sont réservées aux personnes internes nommées dans l’équipe du projet.');
  var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
  var pos = projectOrders_(project.id, wps);
  var env = projectEnv_(project, wps, pos);
  var orders = pos.map(function (o) { return orderView_(o, env, today); }).sort(function (a, b) {
    return (PO_ORDER[a.status] - PO_ORDER[b.status]) || String(a.gr_due_date || '9999').localeCompare(String(b.gr_due_date || '9999')) || String(a.po_number).localeCompare(String(b.po_number));
  });
  var planned = {};
  pos.forEach(function (o) { if (o.status === 'À faire') o.links.forEach(function (l) { planned[l.deliverable_id] = round2((planned[l.deliverable_id] || 0) + l.amount); }); });
  var deliverables = env.items.filter(function (i) { return env.external[i.id] || env.committed[i.id] || planned[i.id]; }).map(function (i) {
    var w = i.wp_id ? env.wpById[i.wp_id] : null, e = env.external[i.id] || 0, c = env.committed[i.id] || 0;
    return { id: i.id, name: i.name, wp: w ? (w.wbs_code ? w.wbs_code + ' ' : '') + w.name : '', cpn: env.cpnOf(i), budget_external: e, committed: c, planned: planned[i.id] || 0, remaining: round2(e - c), overrun: c > e + 0.005 };
  }).sort(function (a, b) { return String(a.wp).localeCompare(String(b.wp), 'fr', { numeric: true }) || String(a.name).localeCompare(String(b.name), 'fr'); });
  return { project: { id: project.id, code: project.code, name: project.name, cpn: project.cpn || '', cpn_label: project.cpn_label || '' }, orders: orders, deliverables: deliverables, canEdit: canPoEdit_(ctx, project.id) };
});

// ---------------------------------------------------------------- écriture

function replaceLinks_(poId, links, actx) {
  repoList('PurchaseOrderLink', function (l) { return l.po_id === poId; }).forEach(function (l) { repoSoftDelete('PurchaseOrderLink', l.id, null, actx); });
  links.forEach(function (l) { repoInsert('PurchaseOrderLink', { po_id: poId, deliverable_id: l.deliverable_id, amount: l.amount }, actx); });
}

/** Crée ou modifie une PO. values : numéro, CPN, ressource externe, période, montant, statut, échéance de GR, responsable de la GR… */
defineAction('po.save', function (p, ctx) {
  var v = p.values || {};
  var cur = isBlank(p.id) ? null : mustGet('PurchaseOrder', p.id);
  var today = todayStr();
  return withLock(function () {
    var number = !cur || 'po_number' in v ? poNumber_(v.po_number) : cur.po_number;
    if (repoList('PurchaseOrder', function (o) { return (!cur || o.id !== cur.id) && String(o.po_number).toLowerCase() === number.toLowerCase(); }).length) {
      throw new PpmError('VALIDATION', 'Le numéro de PO ' + number + ' existe déjà : il est unique.');
    }
    var cpn = !cur || 'cpn' in v ? checkCpnValue_(v.cpn) : normCpn_(cur.cpn);
    if (!cpn) throw new PpmError('VALIDATION', 'Le CPN est obligatoire.');
    var owner = cpnOwner_(cpn), project = owner ? owner.project : null;
    var before = cur ? cpnOwner_(cur.cpn) : null;
    if (!canPoEdit_(ctx, project ? project.id : '') || (before && !canPoEdit_(ctx, before.project.id))) {
      throw new PpmError('FORBIDDEN', project ? 'Seules les personnes internes nommées dans l’équipe du projet ' + project.code + ' créent ou modifient ses PO.'
        : 'Seules les personnes internes nommées dans une équipe créent une PO.');
    }
    var resource = poExternalResource_('resource_id' in v || !cur ? v.resource_id : cur.resource_id);
    var status = !cur || 'status' in v ? poStatus_(isBlank(v.status) ? 'À faire' : v.status) : cur.status;
    var amount = !cur || 'amount' in v ? poAmount_(v.amount) : Number(cur.amount);
    var start = 'start_date' in v ? wbsDate_(v.start_date, 'Début d’activité') : (cur ? cur.start_date || '' : '');
    var end = 'end_date' in v ? wbsDate_(v.end_date, 'Fin d’activité') : (cur ? cur.end_date || '' : '');
    if (start && end && start > end) throw new PpmError('VALIDATION', 'La fin d’activité ne peut pas précéder son début.');
    var due = 'gr_due_date' in v ? wbsDate_(v.gr_due_date, 'Date de GR attendue') : (cur ? cur.gr_due_date || '' : '');
    if (!due && (status === 'À faire' || status === 'Lancée')) throw new PpmError('VALIDATION', 'La date à laquelle la GR doit être faite est obligatoire : elle déclenche le rappel.');
    var dates = poDates_(status, cur, v, today);
    var links = Array.isArray(p.links) ? poLinks_(p.links, project, amount) : null;
    if (links === null && cur) {
      var existing = repoList('PurchaseOrderLink', function (l) { return l.po_id === cur.id; });
      if (existing.length && (Number(cur.amount) !== amount || (before && project && before.project.id !== project.id))) {
        throw new PpmError('VALIDATION', 'Le montant ou le CPN a changé : ajustez la répartition entre livrables.');
      }
    }
    var values = {
      po_number: number, cpn: cpn, resource_id: resource.id, owner_resource_id: poOwner_('owner_resource_id' in v ? v.owner_resource_id : (cur ? cur.owner_resource_id : ''), ctx),
      description: wbsShortText_('description' in v ? v.description : (cur ? cur.description : ''), 300, 'Description'),
      start_date: start, end_date: end, amount: amount, status: status, gr_due_date: due,
      launched_on: dates.launched_on, gr_on: dates.gr_on, closed_on: dates.closed_on
    };
    var rec = cur ? repoUpdate('PurchaseOrder', cur.id, values, p.version, ctx.actx) : repoInsert('PurchaseOrder', values, ctx.actx);
    if (links !== null) replaceLinks_(rec.id, links, ctx.actx);
    var stored = attachLinks_([rec])[0];
    var env = project ? projectEnv_(project, repoList('WorkPackage', function (w) { return w.project_id === project.id; }), projectOrders_(project.id, repoList('WorkPackage', function (w) { return w.project_id === project.id; })))
      : { project: null, resById: indexBy_(repoList('Resource')), itemById: {}, external: {}, committed: {} };
    var view = orderView_(stored, env, today);
    view.project = project ? { id: project.id, code: project.code, name: project.name } : null;
    return view;
  });
});

/** Changement de statut en un geste (les dates d'engagement, de GR et de clôture suivent). */
defineAction('po.status', function (p, ctx) {
  var o = mustGet('PurchaseOrder', requireParam(p, 'id'));
  poStatus_(p.status);
  var owner = cpnOwner_(o.cpn);
  if (!canPoEdit_(ctx, owner ? owner.project.id : '')) throw new PpmError('FORBIDDEN', 'Seules les personnes internes nommées dans l’équipe du projet modifient ses PO.');
  var dates = poDates_(p.status, o, {}, todayStr());
  var rec = repoUpdate('PurchaseOrder', o.id, Object.assign({ status: p.status }, dates), p.version, ctx.actx);
  return { id: rec.id, version: rec.version, status: rec.status, launched_on: rec.launched_on || '', gr_on: rec.gr_on || '', closed_on: rec.closed_on || '' };
});

defineAction('po.delete', function (p, ctx) {
  var o = mustGet('PurchaseOrder', requireParam(p, 'id'));
  var owner = cpnOwner_(o.cpn);
  var creator = String(o.created_by || '').toLowerCase() === ctx.email;
  var manager = owner ? can(ctx, 'cpn.edit', { type: 'project', id: owner.project.id }) : false;
  if (!ctx.isAdmin && !manager && !(creator && canPoEdit_(ctx, owner ? owner.project.id : ''))) {
    throw new PpmError('FORBIDDEN', 'Une PO se supprime par son auteur ou par le pilotage du projet.');
  }
  return withLock(function () {
    replaceLinks_(o.id, [], ctx.actx);
    repoSoftDelete('PurchaseOrder', o.id, p.version, ctx.actx);
    return { deleted: true };
  });
});

// ---------------------------------------------------------------- constats (moteur de règles)

/**
 * Constats sur les PO : GR en retard ou attendue sous 7 jours, PO à lancer alors que l'activité a commencé, dépassement du
 * budget externe d'un CPN. Fonction pure. Aucun montant dans les messages (ils vont aux équipes et peuvent aller à l'IA).
 *   data : { orders: [{ id, po_number, projectId, cpn, status, start_date, gr_due_date, resource }], balances: { projectId: bilan } }
 */
function poFindings_(data, today) {
  var out = [];
  var soon = addCalendarDays(today, THRESHOLDS.dueSoonDays);
  (data.orders || []).forEach(function (o) {
    if (!o.projectId) return;
    var who = o.po_number + (o.resource ? ' (' + o.resource + ')' : '');
    if (o.status === 'Lancée' && !isBlank(o.gr_due_date)) {
      if (String(o.gr_due_date) < today) {
        out.push({ projectId: o.projectId, rule: 'PO_GR_LATE', severity: 'Alerte', targetType: 'PurchaseOrder', targetId: o.id,
          message: 'La GR de la PO ' + who + ' devait être faite le ' + o.gr_due_date + '.',
          suggestion: 'Faire la réception (GR) dans Click and Buy, puis passer la PO en « GR » dans l’outil.' });
      } else if (String(o.gr_due_date) <= soon) {
        out.push({ projectId: o.projectId, rule: 'PO_GR_SOON', severity: 'Vigilance', targetType: 'PurchaseOrder', targetId: o.id,
          message: 'La GR de la PO ' + who + ' est attendue le ' + o.gr_due_date + '.', suggestion: 'Préparer la réception de la prestation.' });
      }
    }
    if (o.status === 'À faire' && !isBlank(o.start_date) && String(o.start_date) <= today) {
      out.push({ projectId: o.projectId, rule: 'PO_TODO_LATE', severity: 'Vigilance', targetType: 'PurchaseOrder', targetId: o.id,
        message: 'La PO ' + who + ' est encore à faire alors que l’activité a commencé le ' + o.start_date + '.', suggestion: 'Lancer la PO ou corriger la période d’activité.' });
    }
  });
  Object.keys(data.balances || {}).forEach(function (projectId) {
    (data.balances[projectId].cpns || []).forEach(function (g) {
      if (g.overrun && g.budget.external > 0) {
        out.push({ projectId: projectId, rule: 'PO_OVERRUN', severity: 'Alerte', targetType: 'Project', targetId: projectId,
          message: 'Les PO engagées dépassent le budget externe du CPN ' + g.cpn + ' de ' + Math.round(100 * (g.po.committed - g.budget.external) / g.budget.external) + ' %.',
          suggestion: 'Revoir le budget externe, ou la répartition et le montant des PO.' });
      } else if (g.overrun && g.budget.external === 0 && g.po.committed > 0) {
        out.push({ projectId: projectId, rule: 'PO_UNBUDGETED', severity: 'Vigilance', targetType: 'Project', targetId: projectId,
          message: 'Des PO sont engagées sur le CPN ' + (g.cpn || '(sans CPN)') + ', qui n’a aucun budget externe.', suggestion: 'Saisir le budget externe correspondant.' });
      }
    });
  });
  return out;
}

/** Charge les données et calcule les constats des PO (appelée par runRules). */
function poRuleInputs_() {
  var projects = repoList('Project'), pos = attachLinks_(repoList('PurchaseOrder'));
  var idx = cpnIndex_(), resById = indexBy_(repoList('Resource'));
  var byProject = {};
  var orders = pos.map(function (o) {
    var own = idx[normCpn_(o.cpn)];
    var projectId = own ? own.project.id : '';
    if (projectId) (byProject[projectId] = byProject[projectId] || []).push(o);
    return { id: o.id, po_number: o.po_number, projectId: projectId, cpn: normCpn_(o.cpn), status: o.status, start_date: o.start_date || '',
      gr_due_date: o.gr_due_date || '', resource: resById[o.resource_id] ? resById[o.resource_id].name : '' };
  });
  var balances = {};
  projects.forEach(function (project) {
    if (project.status === 'Clos' || !byProject[project.id]) return;
    var wps = repoList('WorkPackage', function (w) { return w.project_id === project.id; });
    var items = repoList('PlanItem', function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; });
    var ids = {}; items.forEach(function (i) { ids[i.id] = true; });
    balances[project.id] = computeBalance_({ project: project, wps: wps, items: items, lines: repoList('BudgetLine', function (l) { return ids[l.deliverable_id]; }), pos: byProject[project.id] });
  });
  return { orders: orders, balances: balances };
}
