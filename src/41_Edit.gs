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
      var rec = repoInsert('WorkPackage', {
        project_id: projectId, parent_wp_id: parent ? parent.id : '', wbs_code: code, name: name, owner_resource_id: owner,
        charge_code: wbsShortText_(v.charge_code, 40, 'Code d’imputation')
      }, ctx.actx);
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
      return { kind: 'wp', id: id, record: repoUpdate('WorkPackage', id, out, p.version, ctx.actx) };
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
    return { kind: 'item', id: id, record: repoUpdate('PlanItem', id, out, p.version, ctx.actx) };
  });
});

// ---------------------------------------------------------------- suppression sans orphelin

/** Retire les dépendances et exigences de jalon qui touchent un élément ; renvoie leur nombre. */
function detachItem_(itemId, actx) {
  var deps = repoList('Dependency', function (d) { return d.predecessor_id === itemId || d.successor_id === itemId; });
  deps.forEach(function (d) { repoSoftDelete('Dependency', d.id, null, actx); });
  var reqs = repoList('MilestoneRequirement', function (r) { return r.milestone_id === itemId || r.deliverable_id === itemId; });
  reqs.forEach(function (r) { repoSoftDelete('MilestoneRequirement', r.id, null, actx); });
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

defineAction('wbs.delete', function (p, ctx) {
  var kind = requireParam(p, 'kind');
  if (['wp', 'item'].indexOf(kind) < 0) throw new PpmError('VALIDATION', 'Nature inconnue : wp ou item.');
  var id = requireParam(p, 'id');
  return withLock(function () {
    var res = { kind: kind, id: id, deleted: { wps: 0, items: 0, dependencies: 0, requirements: 0 } };
    var add = function (c) { res.deleted.dependencies += c.dependencies; res.deleted.requirements += c.requirements; };
    if (kind === 'item') {
      mustGet('PlanItem', id);
      requireCan(ctx, 'wbs.edit', wbsScope_('planitem', id));
      add(detachItem_(id, ctx.actx));
      repoSoftDelete('PlanItem', id, p.version, ctx.actx);
      res.deleted.items = 1;
      return res;
    }
    var w = mustGet('WorkPackage', id);
    requireCan(ctx, 'wbs.edit', wbsScope_('workpackage', id));
    var content = wpContent_(id, w.project_id);
    if ((content.wps.length || content.items.length) && !p.cascade) {
      throw new PpmError('VALIDATION', 'Ce workpackage contient ' + content.wps.length + ' sous-workpackage(s) et ' + content.items.length +
        ' élément(s) : déplacez-les, ou confirmez la suppression avec leur contenu.', { rule: 'NOT_EMPTY', wps: content.wps.length, items: content.items.length });
    }
    content.items.forEach(function (i) {
      requireCan(ctx, 'wbs.edit', wbsScope_('planitem', i.id));
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
