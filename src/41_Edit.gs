/**
 * PPM Core — 0.7.0 : création et édition du WBS depuis les pages (workpackages, sous-workpackages, livrables, jalons).
 *
 * Les actions génériques (workpackages.*, planitems.*) restent disponibles pour l'API ; les pages passent par ces trois
 * actions, qui ajoutent ce qu'un écran exige :
 *   - numérotation automatique des codes WBS (3, puis 3.1, 3.2…), unicité dans le projet ;
 *   - deux niveaux de workpackage au plus, jamais de boucle, tout rattachement dans le même projet ;
 *   - dates contrôlées (la fin ne précède pas le début ; un jalon n'a qu'une date) ;
 *   - suppression sans orphelin : un workpackage non vide ne se supprime qu'avec son contenu (cascade explicite), et la
 *     suppression d'un élément retire aussi ses dépendances et ses exigences de jalon.
 * Les droits sont ceux de wbs.edit sur le périmètre concerné (et sur la destination d'un déplacement).
 * Rien n'est supprimé pour de bon : les lignes sont marquées supprimées et restent dans le journal.
 */

var WBS_NAME_MAX = 120;
var WBS_KINDS = ['wp', 'Livrable', 'Jalon'];
var MILESTONE_CATEGORIES = ['Revue', 'Client', 'Interne'];

function wbsName_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new PpmError('VALIDATION', 'Le nom est obligatoire.');
  if (s.length > WBS_NAME_MAX) throw new PpmError('VALIDATION', 'Le nom est limité à ' + WBS_NAME_MAX + ' caractères.');
  return s;
}

function wbsShortText_(v, max, label) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new PpmError('VALIDATION', label + ' : ' + max + ' caractères au plus.');
  return s;
}

function wbsOwner_(id) {
  if (isBlank(id)) return '';
  var r = repoGet('Resource', id);
  if (!r || isTrue(r.deleted)) throw new PpmError('VALIDATION', 'Responsable introuvable : la personne a peut-être été supprimée.');
  return String(id);
}

function wbsDate_(v, label) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  var d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new PpmError('VALIDATION', label + ' : date invalide « ' + s + ' » (format AAAA-MM-JJ).');
  }
  return s;
}

/** Début et fin d'un élément après contrôle. Un jalon n'a qu'une date (début = fin). */
function wbsDates_(type, start, finish) {
  var s = wbsDate_(start, 'Début'), f = wbsDate_(finish, type === 'Jalon' ? 'Date' : 'Fin');
  if (type === 'Jalon') { var d = f || s; return { planned_start: d, planned_finish: d }; }
  if (s && f && s > f) throw new PpmError('VALIDATION', 'La fin ne peut pas précéder le début.');
  return { planned_start: s, planned_finish: f };
}

function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Prochain code libre : 3 au premier niveau, 3.1 sous le WP 3. wps : workpackages vivants du projet. */
function nextWbsCode_(wps, parent) {
  var parentId = parent ? parent.id : '';
  var siblings = wps.filter(function (w) { return String(w.parent_wp_id || '') === parentId; });
  var prefix = parent && !isBlank(parent.wbs_code) ? String(parent.wbs_code) + '.' : '';
  var re = new RegExp('^' + escapeRe_(prefix) + '(\\d+)$');
  var max = 0;
  siblings.forEach(function (w) { var m = re.exec(String(w.wbs_code || '')); if (m && Number(m[1]) > max) max = Number(m[1]); });
  var used = {};
  wps.forEach(function (w) { if (!isBlank(w.wbs_code)) used[String(w.wbs_code)] = true; });
  var n = max + 1;
  while (used[prefix + n]) n++; // le père sans code, ou un code libre déjà pris ailleurs
  return prefix + n;
}

function checkWbsCode_(wps, code, exceptId) {
  var c = wbsShortText_(code, 20, 'Code WBS');
  if (c && wps.some(function (w) { return w.id !== exceptId && String(w.wbs_code || '') === c; })) {
    throw new PpmError('VALIDATION', 'Le code WBS « ' + c + ' » est déjà utilisé dans ce projet.');
  }
  return c;
}

function projectWps_(projectId) {
  return repoList('WorkPackage', function (w) { return w.project_id === projectId; });
}

/** Parent d'un workpackage : premier niveau uniquement, même projet, pas lui-même. Renvoie le WP parent ou null (racine). */
function wbsParentWp_(parentId, projectId, selfId) {
  if (isBlank(parentId)) return null;
  var parent = mustGet('WorkPackage', parentId);
  if (parent.project_id !== projectId) throw new PpmError('VALIDATION', 'Le workpackage parent appartient à un autre projet.');
  if (selfId && parent.id === selfId) throw new PpmError('VALIDATION', 'Un workpackage ne peut pas être son propre parent.');
  if (!isBlank(parent.parent_wp_id)) throw new PpmError('VALIDATION', 'Le WBS est limité à deux niveaux de workpackages.');
  return parent;
}

function wbsScope_(kindOrType, id) { return { type: kindOrType, id: id }; }

// ---------------------------------------------------------------- création

defineAction('wbs.create', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var kind = requireParam(p, 'kind');
  if (WBS_KINDS.indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp, Livrable ou Jalon.');
  var v = p.values || {};
  mustGet('Project', projectId);
  var parentId = p.parentId || '';
  return withLock(function () {
    var name = wbsName_(v.name);
    var owner = wbsOwner_(v.owner_resource_id);
    var parent = null;
    if (kind === 'wp') {
      parent = wbsParentWp_(parentId, projectId, '');
      requireCan(ctx, 'wbs.edit', parent ? wbsScope_('workpackage', parent.id) : wbsScope_('project', projectId));
      var wps = projectWps_(projectId);
      var code = isBlank(v.wbs_code) ? nextWbsCode_(wps, parent) : checkWbsCode_(wps, v.wbs_code, '');
      var newWp = {
        project_id: projectId, parent_wp_id: parent ? parent.id : '', wbs_code: code, name: name, owner_resource_id: owner,
        charge_code: wbsShortText_(v.charge_code, 40, 'Code d’imputation')
      };
      applyWpCpn_(ctx, { project_id: projectId, parent_wp_id: parent ? parent.id : '', cpn: '', cpn_label: '', id: '' }, v, newWp);
      var rec = repoInsert('WorkPackage', newWp, ctx.actx);
      applyPrincipal_(ctx.actx, parent ? 'subworkpackage' : 'workpackage', rec.id, '', owner);
      return { kind: 'wp', id: rec.id, record: rec };
    }
    if (!isBlank(parentId)) {
      parent = mustGet('WorkPackage', parentId);
      if (parent.project_id !== projectId) throw new PpmError('VALIDATION', 'Le workpackage appartient à un autre projet.');
    }
    requireCan(ctx, 'wbs.edit', parent ? wbsScope_('workpackage', parent.id) : wbsScope_('project', projectId));
    var cat = String(v.milestone_category || '');
    if (cat && (kind !== 'Jalon' || MILESTONE_CATEGORIES.indexOf(cat) < 0)) throw new PpmError('VALIDATION', 'Catégorie de jalon inconnue : Revue, Client ou Interne.');
    var dates = wbsDates_(kind, v.planned_start, v.planned_finish);
    var item = repoInsert('PlanItem', {
      project_id: projectId, wp_id: parent ? parent.id : '', item_type: kind, name: name, owner_resource_id: owner,
      planned_start: dates.planned_start, planned_finish: dates.planned_finish, milestone_category: cat,
      status: 'À faire', progress_pct: 0
    }, ctx.actx);
    applyPrincipal_(ctx.actx, 'planitem', item.id, '', owner);
    return { kind: 'item', id: item.id, record: item };
  });
});

// ---------------------------------------------------------------- modification et déplacement

defineAction('wbs.update', function (p, ctx) {
  var kind = requireParam(p, 'kind');
  if (['wp', 'item'].indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp ou item.');
  var id = requireParam(p, 'id');
  var patch = p.patch || {};
  return withLock(function () {
    var out = {};
    if (kind === 'wp') {
      var w = mustGet('WorkPackage', id);
      requireCan(ctx, 'wbs.edit', wbsScope_('workpackage', id));
      var wps = projectWps_(w.project_id);
      if ('name' in patch) out.name = wbsName_(patch.name);
      if ('owner_resource_id' in patch) out.owner_resource_id = wbsOwner_(patch.owner_resource_id);
      if ('charge_code' in patch) out.charge_code = wbsShortText_(patch.charge_code, 40, 'Code d’imputation');
      if ('wbs_code' in patch) out.wbs_code = checkWbsCode_(wps, patch.wbs_code, id);
      applyWpCpn_(ctx, w, patch, out);
      if ('parent_wp_id' in patch && String(patch.parent_wp_id || '') !== String(w.parent_wp_id || '')) {
        var np = wbsParentWp_(patch.parent_wp_id, w.project_id, id);
        if (np && wps.some(function (c) { return c.parent_wp_id === id; })) {
          throw new PpmError('VALIDATION', 'Ce workpackage a des sous-workpackages : il ne peut pas devenir lui-même un sous-niveau (deux niveaux au plus).');
        }
        requireCan(ctx, 'wbs.edit', np ? wbsScope_('workpackage', np.id) : wbsScope_('project', w.project_id));
        out.parent_wp_id = np ? np.id : '';
        // un déplacement renumérote, sauf si un code est imposé
        if (!('wbs_code' in patch)) out.wbs_code = nextWbsCode_(wps.filter(function (x) { return x.id !== id; }), np);
      }
      var wkind = isBlank(w.parent_wp_id) ? 'workpackage' : 'subworkpackage';
      if ('owner_resource_id' in out) assertCanSetPrincipal_(ctx, wkind, wbsScope_('workpackage', id), w.owner_resource_id, out.owner_resource_id);
      var wrec = repoUpdate('WorkPackage', id, out, p.version, ctx.actx);
      if ('owner_resource_id' in out) applyPrincipal_(ctx.actx, wkind, id, w.owner_resource_id, wrec.owner_resource_id);
      return { kind: 'wp', id: id, record: wrec };
    }
    var it = mustGet('PlanItem', id);
    requireCan(ctx, 'wbs.edit', wbsScope_('planitem', id));
    if ('name' in patch) out.name = wbsName_(patch.name);
    if ('owner_resource_id' in patch) out.owner_resource_id = wbsOwner_(patch.owner_resource_id);
    if ('planned_start' in patch || 'planned_finish' in patch) {
      var d = wbsDates_(it.item_type,
        'planned_start' in patch ? patch.planned_start : it.planned_start, 'planned_finish' in patch ? patch.planned_finish : it.planned_finish);
      out.planned_start = d.planned_start;
      out.planned_finish = d.planned_finish;
    }
    if ('milestone_category' in patch) {
      var cat = String(patch.milestone_category || '');
      if (cat && (it.item_type !== 'Jalon' || MILESTONE_CATEGORIES.indexOf(cat) < 0)) throw new PpmError('VALIDATION', 'Catégorie de jalon inconnue : Revue, Client ou Interne.');
      out.milestone_category = cat;
    }
    if ('wp_id' in patch && String(patch.wp_id || '') !== String(it.wp_id || '')) {
      var dest = null;
      if (!isBlank(patch.wp_id)) {
        dest = mustGet('WorkPackage', patch.wp_id);
        if (dest.project_id !== it.project_id) throw new PpmError('VALIDATION', 'Le workpackage de destination appartient à un autre projet.');
      }
      requireCan(ctx, 'wbs.edit', dest ? wbsScope_('workpackage', dest.id) : wbsScope_('project', it.project_id));
      out.wp_id = dest ? dest.id : '';
    }
    if ('owner_resource_id' in out) assertCanSetPrincipal_(ctx, 'planitem', wbsScope_('planitem', id), it.owner_resource_id, out.owner_resource_id);
    var irec = repoUpdate('PlanItem', id, out, p.version, ctx.actx);
    if ('owner_resource_id' in out) applyPrincipal_(ctx.actx, 'planitem', id, it.owner_resource_id, irec.owner_resource_id);
    return { kind: 'item', id: id, record: irec };
  });
});

// ---------------------------------------------------------------- suppression sans orphelin

/** Retire les dépendances et exigences de jalon qui touchent un élément ; renvoie leur nombre. */
function detachItem_(itemId, actx) {
  var deps = repoList('Dependency', function (d) { return d.predecessor_id === itemId || d.successor_id === itemId; });
  deps.forEach(function (d) { repoSoftDelete('Dependency', d.id, null, actx); });
  var reqs = repoList('MilestoneRequirement', function (r) { return r.milestone_id === itemId || r.deliverable_id === itemId; });
  reqs.forEach(function (r) { repoSoftDelete('MilestoneRequirement', r.id, null, actx); });
  // Budget et répartition des PO du livrable : la ligne de budget et ses mois, le lien de PO (le montant de la PO reste, « non affecté »).
  repoList('BudgetLine', function (l) { return l.deliverable_id === itemId; }).forEach(function (l) {
    repoList('BudgetPhasing', function (x) { return x.budget_line_id === l.id; }).forEach(function (x) { repoSoftDelete('BudgetPhasing', x.id, null, actx); });
    repoSoftDelete('BudgetLine', l.id, null, actx);
  });
  repoList('PurchaseOrderLink', function (l) { return l.deliverable_id === itemId; }).forEach(function (l) { repoSoftDelete('PurchaseOrderLink', l.id, null, actx); });
  return { dependencies: deps.length, requirements: reqs.length };
}

/** Contenu d'un workpackage : ses sous-workpackages et tous les éléments du niveau et des sous-niveaux. */
function wpContent_(wpId, projectId) {
  var kids = projectWps_(projectId).filter(function (w) { return w.parent_wp_id === wpId; });
  var wpIds = {};
  wpIds[wpId] = true;
  kids.forEach(function (k) { wpIds[k.id] = true; });
  var items = repoList('PlanItem', function (i) { return i.project_id === projectId && wpIds[i.wp_id]; });
  return { wps: kids, items: items };
}

/**
 * « Jalon passé » (0.17.2). Un jalon n'a pas d'avancement : il est atteint ou il ne l'est pas, et c'est le RESPONSABLE DU JALON (son Deliverable owner, ou un niveau au-dessus) qui le déclare,
 * explicitement. Sans cette déclaration un jalon dont la date est dépassée restait « en retard » pour toujours (alerte LATE_ITEM, glissement critique…) : il n'y avait aucun moyen de l'en sortir.
 * Marquer passé = statut Terminé, avancement 100 %, date réelle (aujourd'hui, ou une date passée donnée) ; toutes les règles qui regardent « terminé » cessent alors de l'alerter. Rouvrir remet le
 * jalon à faire. Déclarer un jalon passé alors que des livrables qu'il exige ne sont pas terminés reste signalé (MILESTONE_INCOMPLETE) : c'est une incohérence, pas un retard.
 */
defineAction('milestone.pass', function (p, ctx) {
  var item = mustGet('PlanItem', requireParam(p, 'id'));
  if (item.item_type !== 'Jalon') throw new PpmError('VALIDATION', 'Seul un jalon se marque passé : l’avancement d’un livrable se déclare.');
  requireCan(ctx, 'milestone.pass', { type: 'planitem', id: item.id });
  var passed = !('passed' in p) || isTrue(p.passed);
  var today = todayStr(), date = isBlank(p.date) ? today : String(p.date);
  if (passed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new PpmError('VALIDATION', 'Date du passage : une date valide (AAAA-MM-JJ).');
    if (date > today) throw new PpmError('VALIDATION', 'Un jalon ne peut pas être passé dans le futur : choisissez aujourd’hui ou une date passée.');
  }
  return withLock(function () {
    var patch = passed ? { status: 'Terminé', progress_pct: 100, actual_finish: date, last_progress_at: nowIso() }
      : { status: 'À faire', progress_pct: 0, actual_finish: '', last_progress_at: '' };
    var rec = repoUpdate('PlanItem', item.id, patch, p.version, ctx.actx);
    return { id: rec.id, version: rec.version, status: rec.status, progress_pct: Number(rec.progress_pct) || 0, actual_finish: rec.actual_finish || '' };
  });
});

/**
 * Mes jalons (0.17.3), tous projets confondus : ceux dont la personne connectée est responsable, échus ou à venir dans 30 jours et pas encore déclarés passés (`pending`), et ceux qu'elle a
 * déclarés passés depuis 30 jours (`recent`, pour les rouvrir en cas d'erreur). Alimente la zone « Mes jalons » de la page Compte, d'où le responsable déclare ses jalons passés sans
 * chercher le projet.
 */
defineAction('milestones.mine', function (p, ctx) {
  var today = todayStr(), me = ctx.resourceId;
  if (!me) return { today: today, pending: [], recent: [] };
  var projects = indexBy_(repoList('Project')), wps = indexBy_(repoList('WorkPackage'));
  var soon = addCalendarDays(today, 30), since = addCalendarDays(today, -30);
  var active = function (i) { var pr = projects[i.project_id]; return pr && !isTrue(pr.deleted) && pr.status !== 'Clos'; };
  var mine = repoList('PlanItem', function (i) { return i.item_type === 'Jalon' && i.owner_resource_id === me && active(i); });
  var view = function (i) {
    var pr = projects[i.project_id], wp = i.wp_id ? wps[i.wp_id] : null, f = i.planned_finish || '';
    return { id: i.id, version: i.version, name: i.name, project: pr.code, project_id: pr.id, wp: wp ? ((wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name) : '', date: f,
      late: !!f && f < today, late_days: f && f < today ? Math.round((parseYmd(today) - parseYmd(f)) / DAY_MS) : 0 };
  };
  return {
    today: today,
    pending: mine.filter(function (i) { return !isDone_(i) && !isBlank(i.planned_finish) && i.planned_finish <= soon; }).map(view)
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name), 'fr'); }),
    recent: mine.filter(function (i) { return isDone_(i) && !isBlank(i.actual_finish) && String(i.actual_finish) >= since; })
      .map(function (i) { return Object.assign(view(i), { passed_on: String(i.actual_finish) }); }).sort(function (a, b) { return String(b.passed_on).localeCompare(String(a.passed_on)); })
  };
});

defineAction('wbs.delete', function (p, ctx) {
  var kind = requireParam(p, 'kind');
  if (['wp', 'item'].indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp ou item.');
  var id = requireParam(p, 'id');
  return withLock(function () {
    var res = { kind: kind, id: id, deleted: { wps: 0, items: 0, dependencies: 0, requirements: 0 } };
    var add = function (c) { res.deleted.dependencies += c.dependencies; res.deleted.requirements += c.requirements; };
    if (kind === 'item') {
      mustGet('PlanItem', id);
      requireCan(ctx, 'wbs.delete', wbsScope_('planitem', id));
      add(detachItem_(id, ctx.actx));
      repoSoftDelete('PlanItem', id, p.version, ctx.actx);
      res.deleted.items = 1;
      return res;
    }
    var w = mustGet('WorkPackage', id);
    requireCan(ctx, 'wbs.delete', wbsScope_('workpackage', id));
    var content = wpContent_(id, w.project_id);
    if ((content.wps.length || content.items.length) && !p.cascade) {
      throw new PpmError('VALIDATION', 'Ce workpackage contient ' + content.wps.length + ' sous-workpackage(s) et ' + content.items.length +
        ' élément(s) : déplacez-les, ou confirmez la suppression avec leur contenu.', { rule: 'NOT_EMPTY', wps: content.wps.length, items: content.items.length });
    }
    content.items.forEach(function (i) {
      requireCan(ctx, 'wbs.delete', wbsScope_('planitem', i.id));
      add(detachItem_(i.id, ctx.actx));
      repoSoftDelete('PlanItem', i.id, null, ctx.actx);
      res.deleted.items++;
    });
    content.wps.forEach(function (k) { repoSoftDelete('WorkPackage', k.id, null, ctx.actx); res.deleted.wps++; });
    repoSoftDelete('WorkPackage', id, p.version, ctx.actx);
    res.deleted.wps++;
    return res;
  });
});
