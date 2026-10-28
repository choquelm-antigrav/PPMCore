/**
 * PPM Core — 0.18.0 : les VERSIONS FIGÉES de l'exercice.
 *
 * Au fil du cycle (attendu avant l'été, livrables en septembre, accordé en décembre, révisions de février et d'avril), on fige l'état de l'exercice d'un projet : budget attendu, accordé et
 * parts des livrables par équipe. Une version est un instantané qui ne change plus ; on la compare à la précédente (ou à l'état actuel) pour voir ce qui a bougé : budgets d'équipe, livrables
 * ajoutés, retirés ou rechiffrés. Elle est à valider par le niveau du dessus de son auteur, comme les changements du WBS (54_Validation.gs).
 *
 *   exercise.version.create   figer l'état actuel (chef de projet et au-dessus : droit exercise.edit ; motif obligatoire) ;
 *   exercise.version.list     les versions d'un exercice pour un projet (droit exercise.read) ;
 *   exercise.version.compare  écart entre deux versions, ou entre une version et l'état actuel ;
 *   exercise.version.decide   valider ou refuser (niveau strictement supérieur à celui de l'auteur ; refus : motif obligatoire).
 *
 * NIVEAU DE L'AUTEUR : son meilleur rang sur le projet quand il fige (0 = administrateur ou Program Leader : personne au-dessus, la version est validée d'emblée). Le validateur est toute
 * personne dont le meilleur rang sur le projet est strictement inférieur ; l'administrateur valide toujours (sauf une version qu'il a lui-même figée, déjà validée).
 */

var EXVER_LABEL_MAX = 60;

/** Cette personne peut-elle valider (ou refuser) cette version ? Niveau strictement supérieur à celui de l'auteur sur le projet. */
function canValidateVersion_(ctx, v) {
  var rank = Number(v.author_level);
  if (isNaN(rank) || rank <= 0 || v.status !== 'À valider') return false;
  if (ctx.isAdmin) return true;
  return bestRankOn_(ctx, { type: 'project', id: v.project_id }) < rank;
}

/** Les lignes de l'instantané d'un exercice pour un projet : une ligne par équipe (attendu, accordé, total des parts) et une par part de livrable. */
function exverSnapshot_(ex, projectId) {
  etpReset_();
  var data = exerciseData_(ex, [projectId]), table = exerciseTable_(ex, data, projectId), teamLines = [];
  var add = function (id, e, g, parts) { if (e !== null || g !== null || parts) teamLines.push({ kind: 'team', team_id: id, expected: e, granted: g, amount: parts || 0 }); };
  table.rows.forEach(function (r) {
    add(r.team_id, r.own.expected, r.own.granted, r.own.parts);
    r.children.forEach(function (c) { add(c.team_id, c.expected, c.granted, c.parts); });
  });
  table.orphans.concat(table.unruled).forEach(function (r) { add(r.team_id, r.expected, r.granted, r.parts); });
  var partLines = data.lines.map(function (l) {
    var it = data.itemById[l.deliverable_id];
    return { kind: 'part', team_id: l.team_id, deliverable_id: l.deliverable_id, label: it ? it.name : '', amount: Number(l.planned_amount) || 0 };
  }).filter(function (x) { return x.amount || x.label; });
  return { lines: teamLines.concat(partLines), totals: table.totals };
}

function exverView_(v, ctx, authors) {
  return {
    id: v.id, version: v.version, number: Number(v.number), label: v.label, justification: v.justification, author: v.author, status: v.status,
    created_at: v.created_at || '', decided_by: v.decided_by || '', decided_at: v.decided_at || '', decision_note: v.decision_note || '',
    totals: { expected: isBlank(v.total_expected) ? null : Number(v.total_expected), granted: isBlank(v.total_granted) ? null : Number(v.total_granted), parts: Number(v.total_parts) || 0 },
    can_decide: canValidateVersion_(ctx, v)
  };
}

defineAction('exercise.version.create', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId')), ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  requireCan(ctx, 'exercise.edit', { type: 'project', id: project.id });
  if (ex.status === 'Clos') throw new PpmError('VALIDATION', 'L’exercice ' + ex.year + ' est clos : on n’y fige plus de version.');
  var justification = String(p.justification || '').trim();
  if (!justification) throw new PpmError('VALIDATION', 'Le motif est obligatoire : pourquoi fige-t-on cette version ?');
  var label = String(p.label || '').trim();
  if (label.length > EXVER_LABEL_MAX) throw new PpmError('VALIDATION', 'Libellé : ' + EXVER_LABEL_MAX + ' caractères au plus.');
  return withLock(function () {
    var snap = exverSnapshot_(ex, project.id);
    if (!snap.lines.length) throw new PpmError('VALIDATION', 'Rien à figer : cet exercice n’a encore ni budget d’équipe ni part de livrable pour ce projet.');
    var all = repoList('ExerciseVersion', function (v) { return v.exercise_id === ex.id && v.project_id === project.id; });
    var number = all.length ? Math.max.apply(null, all.map(function (v) { return Number(v.number) || 0; })) + 1 : 1;
    var level = ctx.isAdmin ? 0 : bestRankOn_(ctx, { type: 'project', id: project.id });
    var top = level <= 0;
    var rec = repoInsert('ExerciseVersion', {
      exercise_id: ex.id, project_id: project.id, number: number, label: label || 'V' + number, justification: justification, author: ctx.email, author_level: level,
      status: top ? 'Validée' : 'À valider', decided_by: top ? ctx.email : '', decided_at: top ? nowIso() : '', decision_note: '',
      total_expected: snap.totals.expected === null ? '' : snap.totals.expected, total_granted: snap.totals.granted === null ? '' : snap.totals.granted, total_parts: snap.totals.parts
    }, ctx.actx);
    repoAppendHistory('ExerciseVersionLine', snap.lines.map(function (l) {
      return { id: newId(), version_id: rec.id, kind: l.kind, team_id: l.team_id, deliverable_id: l.deliverable_id || '', label: l.label || '',
        expected: l.expected === undefined || l.expected === null ? '' : l.expected, granted: l.granted === undefined || l.granted === null ? '' : l.granted, amount: l.amount };
    }));
    return exverView_(rec, ctx);
  });
});

defineAction('exercise.version.list', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId')), ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  requireCan(ctx, 'exercise.read', { type: 'project', id: project.id });
  var list = repoList('ExerciseVersion', function (v) { return v.exercise_id === ex.id && v.project_id === project.id; })
    .sort(function (a, b) { return Number(b.number) - Number(a.number); }).map(function (v) { return exverView_(v, ctx); });
  return { exercise: { id: ex.id, year: Number(ex.year), status: ex.status }, versions: list, can_create: (ctx.isAdmin || can(ctx, 'exercise.edit', { type: 'project', id: project.id })) && ex.status !== 'Clos' };
});

/** Les lignes d'une version, ou de l'état actuel (`current`), sous une forme comparable : { team: { id: {expected, granted, parts} }, part: { 'livrable|équipe': {label, amount} } }. */
function exverIndex_(lines) {
  var out = { team: {}, part: {} };
  lines.forEach(function (l) {
    if (l.kind === 'team') out.team[l.team_id] = { expected: isBlank(l.expected) ? null : Number(l.expected), granted: isBlank(l.granted) ? null : Number(l.granted), parts: Number(l.amount) || 0 };
    else out.part[l.deliverable_id + '|' + l.team_id] = { deliverable_id: l.deliverable_id, team_id: l.team_id, label: l.label, amount: Number(l.amount) || 0 };
  });
  return out;
}

defineAction('exercise.version.compare', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId')), ex = mustGet('Exercise', requireParam(p, 'exerciseId'));
  requireCan(ctx, 'exercise.read', { type: 'project', id: project.id });
  var versions = repoList('ExerciseVersion', function (v) { return v.exercise_id === ex.id && v.project_id === project.id; }).sort(function (a, b) { return Number(a.number) - Number(b.number); });
  var side = function (ref, fallbackLast) {
    var id = isBlank(ref) ? (fallbackLast ? 'last' : 'current') : String(ref);
    if (id === 'current') { var s = exverSnapshot_(ex, project.id); return { meta: { id: 'current', label: 'État actuel', number: null }, index: exverIndex_(s.lines), totals: s.totals }; }
    var v = id === 'last' ? versions[versions.length - 1] : versions.filter(function (x) { return x.id === id; })[0];
    if (!v) throw new PpmError(id === 'last' ? 'VALIDATION' : 'NOT_FOUND', id === 'last' ? 'Aucune version figée à comparer : figez d’abord une version.' : 'Version introuvable.');
    var lines = repoList('ExerciseVersionLine', function (l) { return l.version_id === v.id; });
    return { meta: { id: v.id, label: v.label, number: Number(v.number), status: v.status }, index: exverIndex_(lines), totals: { expected: isBlank(v.total_expected) ? null : Number(v.total_expected), granted: isBlank(v.total_granted) ? null : Number(v.total_granted), parts: Number(v.total_parts) || 0 } };
  };
  var A = side(p.a, true), B = side(p.b, false);
  var teams = indexBy_(repoList('HierarchicalTeam')), delta = function (x, y) { return x === null && y === null ? null : Math.round(((y || 0) - (x || 0)) * 100) / 100; };
  var teamIds = {}; Object.keys(A.index.team).concat(Object.keys(B.index.team)).forEach(function (k) { teamIds[k] = true; });
  var zero = { expected: null, granted: null, parts: 0 };
  var teamRows = Object.keys(teamIds).map(function (id) {
    var a = A.index.team[id] || zero, b = B.index.team[id] || zero;
    return { team_id: id, name: teams[id] ? teams[id].name : '(équipe supprimée)', expected: { a: a.expected, b: b.expected, delta: delta(a.expected, b.expected) }, granted: { a: a.granted, b: b.granted, delta: delta(a.granted, b.granted) }, parts: { a: a.parts, b: b.parts, delta: delta(a.parts, b.parts) } };
  }).filter(function (r) { return r.expected.delta || r.granted.delta || r.parts.delta; }).sort(function (x, y) { return String(x.name).localeCompare(String(y.name), 'fr'); });
  var partIds = {}; Object.keys(A.index.part).concat(Object.keys(B.index.part)).forEach(function (k) { partIds[k] = true; });
  var partRows = Object.keys(partIds).map(function (k) {
    var a = A.index.part[k] || null, b = B.index.part[k] || null, ref = a || b;
    return { deliverable_id: ref.deliverable_id, deliverable: ref.label, team_id: ref.team_id, team: teams[ref.team_id] ? teams[ref.team_id].name : '(équipe supprimée)', a: a ? a.amount : null, b: b ? b.amount : null,
      status: !a ? 'ajoutée' : (!b ? 'retirée' : (a.amount !== b.amount ? 'rechiffrée' : 'identique')) };
  }).filter(function (r) { return r.status !== 'identique'; }).sort(function (x, y) { return String(x.deliverable).localeCompare(String(y.deliverable), 'fr') || String(x.team).localeCompare(String(y.team), 'fr'); });
  return {
    a: A.meta, b: B.meta, teams: teamRows, parts: partRows,
    totals: { expected: { a: A.totals.expected, b: B.totals.expected, delta: delta(A.totals.expected, B.totals.expected) }, granted: { a: A.totals.granted, b: B.totals.granted, delta: delta(A.totals.granted, B.totals.granted) }, parts: { a: A.totals.parts, b: B.totals.parts, delta: delta(A.totals.parts, B.totals.parts) } },
    identical: !teamRows.length && !partRows.length
  };
});

defineAction('exercise.version.decide', function (p, ctx) {
  var v = mustGet('ExerciseVersion', requireParam(p, 'id')), decision = String(p.decision || '');
  if (['validate', 'refuse'].indexOf(decision) < 0) throw new PpmError('VALIDATION', 'Décision : valider ou refuser.');
  requireCan(ctx, 'exercise.read', { type: 'project', id: v.project_id });
  if (v.status !== 'À valider') throw new PpmError('VALIDATION', 'Cette version n’est plus à valider (' + v.status.toLowerCase() + ').');
  if (!canValidateVersion_(ctx, v)) throw new PpmError('FORBIDDEN', 'Une version se valide par le niveau du dessus de son auteur : vous n’êtes pas au-dessus de ' + v.author + ' sur ce projet.');
  var note = String(p.note || '').trim();
  if (decision === 'refuse' && !note) throw new PpmError('VALIDATION', 'Le motif du refus est obligatoire.');
  return withLock(function () {
    var rec = repoUpdate('ExerciseVersion', v.id, { status: decision === 'validate' ? 'Validée' : 'Refusée', decided_by: ctx.email, decided_at: nowIso(), decision_note: note }, p.version, ctx.actx);
    return exverView_(rec, ctx);
  });
});
