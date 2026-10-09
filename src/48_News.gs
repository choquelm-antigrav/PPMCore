/**
 * PPM Core — 0.12.0 : fil d'actualités du projet (phase 1, briques A à F de la spécification « step 1 et 2 »).
 *
 *  A. Saisie manuelle d'un compte rendu (texte collé ou lien d'un Google Doc) → une réunion et ses actions.
 *  B. Journal du projet : un Google Doc consolidé (fiche projet, puis les réunions de la plus récente à la plus ancienne).
 *  C. Actualités : « prompt du jour » à copier dans NotebookLM ou Gemini, publication de la synthèse (format vérifié, mail
 *     aux membres), carte dans l'Overview, section dans le récapitulatif du matin.
 *  D. Actions : lues sans IA dans les « prochaines étapes » nominatives, proposées à chaque personne qui les accepte,
 *     les conteste ou les déclare faites.
 *  E. Repères : mots du titre qui rattachent une réunion à un projet (réglés par projet).
 *  F. Collecteur pilote : lit l'agenda du compte qui exécute le script (la spécification prévoit de commencer par le chef
 *     de projet), deux fois par jour. Une réunion est retenue si au moins deux membres du projet y sont invités ou si son titre
 *     contient un repère ; en cas d'égalité entre projets elle va dans la liste « à trier ». Les événements privés ne sont jamais lus.
 *
 * Fonctions de calcul pures (testées sans service Google) : newsNorm_, newsFindDate_, newsParseNotes_, newsParseActionLine_,
 * newsMatchProject_, newsValidateDigest_, newsPrompt_, newsJournalLines_.
 * Les services Google (agenda, Docs) passent par un adaptateur remplaçable dans les tests (NEWS_ADAPTER).
 */

var NEWS_SECTIONS = ['Décisions', 'Dates qui bougent', 'Risques', 'Blocages', 'Actions'];
var NEWS_OPEN = ['Proposée', 'Acceptée', 'Contestée'];
var NEWS_TEXT_MAX = 60000;
var NEWS_ACTIONS_MAX = 40;
var NEWS_DOC_MAX = 30000;
var NEWS_COLLECT_MS = 150 * 1000;
var NEWS_MONTHS = { janv: 1, janvier: 1, fevr: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8,
  sept: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, dec: 12, decembre: 12 };

var NEWS_ADAPTER = null;
function newsAdapter_() { return NEWS_ADAPTER || realNews_(); }

// ---------------------------------------------------------------- droits

/** Qui voit les actualités d'un projet : l'administrateur et toute personne qui y a un rôle. */
function newsMember_(ctx, project) {
  if (ctx.isAdmin) return true;
  if (!ctx.resourceId) return false;
  var base = { wps: repoList('WorkPackage', function (w) { return w.project_id === project.id; }), items: repoList('PlanItem', function (i) { return i.project_id === project.id; }), assignments: ctx.assignments || [] };
  return !!newsProjectMembers_(project, base)[ctx.resourceId];
}

function newsAccess_(ctx, project) {
  var scope = { type: 'project', id: project.id };
  var member = newsMember_(ctx, project);
  return { member: member, view: member, add: can(ctx, 'news.add', scope), manage: can(ctx, 'news.manage', scope) };
}

function newsMustView_(ctx, project) {
  var a = newsAccess_(ctx, project);
  if (!a.view) throw new PpmError('FORBIDDEN', 'Les actualités sont réservées aux membres du projet.');
  return a;
}

function newsMustManage_(ctx, project) {
  var a = newsAccess_(ctx, project);
  if (!a.manage) throw new PpmError('FORBIDDEN', 'Réservé au chef de projet.');
  return a;
}

// ---------------------------------------------------------------- création de réunions et d'actions

function newsInsertActions_(meeting, projectId, parsed, actx) {
  return parsed.map(function (a) {
    return repoInsert('NewsAction', {
      meeting_id: meeting.id, project_id: projectId || '', owner_resource_id: a.owner_resource_id || '', owner_label: a.owner_label || '',
      text: a.text, due_date: a.due || '', item_id: '', status: 'Proposée'
    }, actx);
  });
}

function newsDocId_(url) {
  var u = String(url || '');
  var m = /\/d\/([A-Za-z0-9_-]{15,})/.exec(u) || /[?&]id=([A-Za-z0-9_-]{15,})/.exec(u);
  return m ? m[1] : '';
}

/** Une réunion saisie à la main : texte collé, ou lien d'un Google Doc lu avec le compte du propriétaire. */
defineAction('news.meeting.add', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = newsAccess_(ctx, project);
  if (!access.add) throw new PpmError('FORBIDDEN', 'Réservé au chef de projet.');
  var title = String(p.title || '').trim();
  if (!title) throw new PpmError('VALIDATION', 'Le titre de la réunion est obligatoire.');
  var held = isBlank(p.held_on) ? todayStr() : String(p.held_on).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(held) || fmtYmd(parseYmd(held)) !== held) throw new PpmError('VALIDATION', 'La date de la réunion est invalide.');
  var text = String(p.text || ''), docUrl = String(p.docUrl || '').trim();
  if (!text.trim() && !docUrl) throw new PpmError('VALIDATION', 'Collez le compte rendu, ou indiquez le lien du document.');
  if (!text.trim()) {
    var id = newsDocId_(docUrl), ad = newsAdapter_();
    if (!id) throw new PpmError('VALIDATION', 'Ce lien n’est pas celui d’un document Google : collez plutôt le texte.');
    if (!ad.readDoc) throw new PpmError('VALIDATION', 'La lecture d’un document n’est pas disponible ici : collez son texte.');
    try { text = ad.readDoc(id); } catch (e) { throw new PpmError('VALIDATION', 'Le document n’a pas pu être lu avec le compte de l’outil (droits ?) : collez son texte.'); }
  }
  if (text.length > NEWS_TEXT_MAX) throw new PpmError('VALIDATION', 'Le texte dépasse ' + NEWS_TEXT_MAX + ' caractères : collez l’essentiel.');
  var key = 'man:' + project.id + '|' + held + '|' + newsNorm_(title).slice(0, 60) + '|' + newsHash_(text.slice(0, 600));
  return withLock(function () {
    var dup = repoList('Meeting', function (m) { return m.dedupe_key === key; })[0];
    if (dup) return { duplicate: true, meeting: newsMeetingView_(dup, []) };
    var base = newsBase_(), members = newsProjectMembers_(project, base);
    var parsed = newsParseNotes_(text, held, newsPeople_(base, members));
    var mt = repoInsert('Meeting', {
      project_id: project.id, source: 'Manuel', event_id: '', held_on: held, title: newsClip_(title, 140),
      participants: newsClip_(String(p.participants || '').trim(), 400), doc_url: docUrl, summary: parsed.summary,
      decisions: parsed.decisions.join('\n'), status: 'Publiée', candidates: '', dedupe_key: key, added_by: ctx.email
    }, ctx.actx);
    var acts = newsInsertActions_(mt, project.id, parsed.actions, ctx.actx);
    return { duplicate: false, meeting: newsMeetingView_(mt, acts), detected: acts.length };
  });
});

// ---------------------------------------------------------------- lecture

function newsNames_(base) { var m = {}; base.resources.forEach(function (r) { m[r.id] = r.name; }); return m; }

function newsMeetingView_(m, actions) {
  return {
    id: m.id, project_id: m.project_id, source: m.source, held_on: m.held_on, title: m.title, participants: m.participants || '', doc_url: m.doc_url || '',
    summary: m.summary || '', decisions: String(m.decisions || '').split('\n').filter(Boolean), status: m.status, candidates: String(m.candidates || '').split(',').filter(Boolean),
    version: m.version, actions: actions.map(function (a) { return a.id; })
  };
}

function newsActionView_(a, names, itemsById) {
  return {
    id: a.id, meeting_id: a.meeting_id, project_id: a.project_id, text: a.text, due_date: a.due_date || '', status: a.status, version: a.version,
    owner_id: a.owner_resource_id || '', owner: a.owner_resource_id ? (names[a.owner_resource_id] || '') : '', owner_label: a.owner_label || '',
    item_id: a.item_id || '', item: a.item_id && itemsById[a.item_id] ? itemsById[a.item_id].name : '', decided_by: a.decided_by || '', decided_on: a.decided_on || ''
  };
}

defineAction('news.get', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var access = newsMustView_(ctx, project);
  var base = newsBase_(), names = newsNames_(base), today = todayStr();
  var itemsById = indexBy_(base.items.filter(function (i) { return i.project_id === project.id; }));
  var since = addCalendarDays(today, -45);
  var meetings = repoList('Meeting', function (m) { return m.project_id === project.id && m.status === 'Publiée' && String(m.held_on) >= since; })
    .sort(function (a, b) { return String(b.held_on).localeCompare(String(a.held_on)) || String(b.title).localeCompare(String(a.title)); }).slice(0, 60);
  var allActions = repoList('NewsAction', function (a) { return a.project_id === project.id; });
  var byMeeting = {};
  allActions.forEach(function (a) { (byMeeting[a.meeting_id] = byMeeting[a.meeting_id] || []).push(a); });
  var digest = repoList('NewsDigest', function (d) { return d.project_id === project.id; }).sort(function (a, b) { return String(b.digest_date).localeCompare(String(a.digest_date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')); })[0] || null;
  var out = {
    access: access, me: ctx.resourceId || '',
    project: { id: project.id, code: project.code, name: project.name, version: project.version, news_on: isTrue(project.news_on), keywords: String(project.news_keywords || ''),
      journal_url: project.news_journal_id ? 'https://docs.google.com/document/d/' + project.news_journal_id + '/edit' : '', last_collect: getProp(PROP.NEWS_LAST, '') },
    meetings: meetings.map(function (m) { var v = newsMeetingView_(m, byMeeting[m.id] || []); v.action_list = (byMeeting[m.id] || []).map(function (a) { return newsActionView_(a, names, itemsById); }); return v; }),
    actions: allActions.filter(function (a) { return NEWS_OPEN.indexOf(a.status) >= 0; })
      .sort(function (a, b) { return (String(a.due_date || '9999')).localeCompare(String(b.due_date || '9999')); }).map(function (a) { return newsActionView_(a, names, itemsById); }),
    digest: digest ? { id: digest.id, date: digest.digest_date, text: digest.text, by: digest.published_by } : null,
    triage: [], people: [], items: [], today: today
  };
  if (access.manage) {
    out.triage = repoList('Meeting', function (m) { return m.status === 'À trier' && String(m.candidates || '').split(',').indexOf(project.id) >= 0; })
      .map(function (m) { return newsMeetingView_(m, []); });
    out.people = base.resources.filter(function (r) { return !isTrue(r.deleted); }).map(function (r) { return { id: r.id, name: r.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
    out.items = base.items.filter(function (i) { return i.project_id === project.id && i.item_type === 'Livrable'; }).map(function (i) { return { id: i.id, name: i.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
  }
  return out;
});

/** Pour l'Overview : la dernière synthèse, les dernières réunions, le nombre d'actions ouvertes. Vide pour qui n'est pas membre. */
defineAction('news.summary', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  if (!newsAccess_(ctx, project).view) return { visible: false };
  var meetings = repoList('Meeting', function (m) { return m.project_id === project.id && m.status === 'Publiée'; })
    .sort(function (a, b) { return String(b.held_on).localeCompare(String(a.held_on)); }).slice(0, 3);
  var digest = repoList('NewsDigest', function (d) { return d.project_id === project.id; }).sort(function (a, b) { return String(b.digest_date).localeCompare(String(a.digest_date)); })[0] || null;
  var open = repoList('NewsAction', function (a) { return a.project_id === project.id && NEWS_OPEN.indexOf(a.status) >= 0; });
  var mine = open.filter(function (a) { return ctx.resourceId && a.owner_resource_id === ctx.resourceId; });
  return {
    visible: true, news_on: isTrue(project.news_on), digest: digest ? { date: digest.digest_date, text: newsClip_(digest.text, 700) } : null,
    meetings: meetings.map(function (m) { return { held_on: m.held_on, title: m.title, summary: newsClip_(m.summary, 160) }; }),
    open_actions: open.length, mine: mine.length
  };
});

/** Mes actions, tous projets confondus (Mon compte). */
defineAction('news.mine', function (p, ctx) {
  if (!ctx.resourceId) return { actions: [] };
  var base = newsBase_(), names = newsNames_(base), projects = indexBy_(base.projects), itemsById = indexBy_(base.items);
  var meetings = indexBy_(repoList('Meeting'));
  return {
    actions: repoList('NewsAction', function (a) { return a.owner_resource_id === ctx.resourceId && NEWS_OPEN.indexOf(a.status) >= 0 && !isBlank(a.project_id); })
      .sort(function (a, b) { return (String(a.due_date || '9999')).localeCompare(String(b.due_date || '9999')); })
      .map(function (a) {
        var v = newsActionView_(a, names, itemsById), pr = projects[a.project_id] || {}, mt = meetings[a.meeting_id] || {};
        v.project = pr.code || ''; v.meeting = mt.title || ''; v.held_on = mt.held_on || '';
        return v;
      })
  };
});

// ---------------------------------------------------------------- actions de chacun

defineAction('news.action.decide', function (p, ctx) {
  var a = mustGet('NewsAction', requireParam(p, 'id'));
  var project = isBlank(a.project_id) ? null : mustGet('Project', a.project_id);
  var mine = ctx.resourceId && a.owner_resource_id === ctx.resourceId;
  var manage = project ? newsAccess_(ctx, project).manage : ctx.isAdmin;
  if (!mine && !manage) throw new PpmError('FORBIDDEN', 'Seule la personne concernée ou le chef de projet peut répondre à cette action.');
  var map = { accept: 'Acceptée', contest: 'Contestée', done: 'Faite', reopen: 'Proposée' };
  var status = map[String(p.decision)];
  if (!status) throw new PpmError('VALIDATION', 'Réponse inconnue.');
  if (status === 'Proposée' && !manage) throw new PpmError('FORBIDDEN', 'Seul le chef de projet rouvre une action.');
  var upd = repoUpdate('NewsAction', a.id, { status: status, decided_by: ctx.email, decided_on: todayStr() }, p.version === undefined ? null : p.version, ctx.actx);
  if (status === 'Contestée' && project && project.manager_resource_id) {
    var mgr = repoGet('Resource', project.manager_resource_id);
    if (mgr && mgr.email && String(mgr.email).toLowerCase() !== ctx.email) {
      notifyUser(mgr.email, 'Action contestée — ' + project.code, ctx.email + ' conteste l’action « ' + newsClip_(a.text, 160) + ' ». À reprendre dans la page Actualités du projet.');
    }
  }
  return { id: upd.id, status: upd.status, version: upd.version };
});

/** Le chef de projet complète une action : personne, échéance, livrable, texte. */
defineAction('news.action.update', function (p, ctx) {
  var a = mustGet('NewsAction', requireParam(p, 'id'));
  var project = mustGet('Project', a.project_id);
  newsMustManage_(ctx, project);
  var v = p.patch || {}, patch = {};
  if ('owner_resource_id' in v) { if (!isBlank(v.owner_resource_id)) mustGet('Resource', v.owner_resource_id); patch.owner_resource_id = v.owner_resource_id || ''; }
  if ('due_date' in v) {
    var d = String(v.due_date || '').slice(0, 10);
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || fmtYmd(parseYmd(d)) !== d)) throw new PpmError('VALIDATION', 'L’échéance est invalide.');
    patch.due_date = d;
  }
  if ('item_id' in v) {
    if (!isBlank(v.item_id)) { var it = mustGet('PlanItem', v.item_id); if (it.project_id !== project.id) throw new PpmError('VALIDATION', 'Ce livrable n’appartient pas au projet.'); }
    patch.item_id = v.item_id || '';
  }
  if ('text' in v) { var t = String(v.text || '').trim(); if (t.length < 4) throw new PpmError('VALIDATION', 'Le texte de l’action est trop court.'); patch.text = newsClip_(t, 300); }
  var upd = repoUpdate('NewsAction', a.id, patch, p.version === undefined ? null : p.version, ctx.actx);
  return { id: upd.id, version: upd.version };
});

// ---------------------------------------------------------------- réunions à trier, repères, journal

defineAction('news.triage.assign', function (p, ctx) {
  var m = mustGet('Meeting', requireParam(p, 'id'));
  var project = mustGet('Project', requireParam(p, 'projectId'));
  newsMustManage_(ctx, project);
  if (m.status !== 'À trier') throw new PpmError('VALIDATION', 'Cette réunion n’est plus à trier.');
  if (String(m.candidates || '').split(',').indexOf(project.id) < 0 && !ctx.isAdmin) throw new PpmError('VALIDATION', 'Ce projet ne fait pas partie des projets candidats.');
  var base = newsBase_(), people = newsPeople_(base, newsProjectMembers_(project, base));
  repoUpdate('Meeting', m.id, { project_id: project.id, status: 'Publiée', candidates: '' }, null, ctx.actx);
  var acts = repoList('NewsAction', function (a) { return a.meeting_id === m.id; });
  acts.forEach(function (a) {
    var owner = a.owner_resource_id || newsResolvePerson_(a.owner_label, people);
    repoUpdate('NewsAction', a.id, { project_id: project.id, owner_resource_id: owner }, null, ctx.actx);
  });
  return { id: m.id, project_id: project.id, actions: acts.length };
});

defineAction('news.triage.drop', function (p, ctx) {
  var m = mustGet('Meeting', requireParam(p, 'id'));
  var cands = String(m.candidates || '').split(',').filter(Boolean);
  var ok = ctx.isAdmin || cands.some(function (id) { var pr = repoGet('Project', id); return pr && newsAccess_(ctx, pr).manage; });
  if (!ok) throw new PpmError('FORBIDDEN', 'Réservé au chef de projet.');
  repoList('NewsAction', function (a) { return a.meeting_id === m.id; }).forEach(function (a) { repoSoftDelete('NewsAction', a.id, null, ctx.actx); });
  repoSoftDelete('Meeting', m.id, null, ctx.actx);
  return { id: m.id };
});

defineAction('news.settings.set', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  newsMustManage_(ctx, project);
  var words = String(p.keywords || '').split(/[,;\n]+/).map(function (k) { return k.trim(); }).filter(Boolean);
  if (words.length > 10) throw new PpmError('VALIDATION', 'Dix repères au plus par projet.');
  if (words.some(function (k) { return k.length > 40; })) throw new PpmError('VALIDATION', 'Un repère fait 40 caractères au plus.');
  var upd = repoUpdate('Project', project.id, { news_on: !!p.enabled, news_keywords: words.join(', ') }, null, ctx.actx);
  return { enabled: isTrue(upd.news_on), keywords: upd.news_keywords };
});

/** Les lignes du Journal : fiche du projet, puis chaque réunion de la plus récente à la plus ancienne. */
function newsJournalLines_(project, info, meetings, today) {
  var L = ['# Journal du projet — ' + project.code + ' ' + project.name, 'Mis à jour le ' + frDate_(today) + '. Ce document est tenu à jour par PPM : ne le modifiez pas à la main.', ''];
  L.push('## Fiche du projet');
  L.push('Équipe : ' + (info.team.length ? info.team.join(', ') : 'à renseigner') + '.');
  L.push('Jalons à venir : ' + (info.milestones.length ? info.milestones.map(function (m) { return m.name + ' (' + frDate_(m.date) + ')'; }).join(' ; ') : 'aucun') + '.');
  L.push('Livrables : ' + info.deliverables + ' au total, ' + info.done + ' terminés.');
  L.push('');
  L.push('## Réunions');
  if (!meetings.length) L.push('Aucune réunion retenue pour l’instant.');
  meetings.forEach(function (m) {
    L.push('### ' + frDate_(m.held_on) + ' — ' + m.title);
    if (m.participants) L.push('Participants : ' + m.participants + '.');
    if (m.summary) L.push('Résumé : ' + m.summary);
    (m.decisions || []).forEach(function (d) { L.push('Décision : ' + d); });
    (m.actions || []).forEach(function (a) { L.push('Action : ' + a.text + ' — ' + (a.owner || a.owner_label || 'sans responsable') + (a.due_date ? ' — pour le ' + frDate_(a.due_date) : '') + ' [' + a.status + ']'); });
    if (m.doc_url) L.push('Source : ' + m.doc_url);
    L.push('');
  });
  return L;
}

function newsJournalUpdate_(project, actx) {
  var ad = newsAdapter_();
  if (!ad.upsertJournal) throw new PpmError('VALIDATION', 'La création de documents n’est pas disponible ici.');
  var base = newsBase_(), names = newsNames_(base), today = todayStr();
  var members = newsProjectMembers_(project, base);
  var items = base.items.filter(function (i) { return i.project_id === project.id && !isTrue(i.deleted); });
  var done = function (i) { return i.status === 'Terminé' || Number(i.progress_pct) >= 100; };
  var info = {
    team: Object.keys(members).map(function (id) { return names[id]; }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'fr'); }),
    milestones: items.filter(function (i) { return i.item_type === 'Jalon' && !done(i) && !isBlank(i.planned_finish) && i.planned_finish >= today; })
      .sort(function (a, b) { return String(a.planned_finish).localeCompare(String(b.planned_finish)); }).slice(0, 8).map(function (i) { return { name: i.name, date: i.planned_finish }; }),
    deliverables: items.filter(function (i) { return i.item_type === 'Livrable'; }).length,
    done: items.filter(function (i) { return i.item_type === 'Livrable' && done(i); }).length
  };
  var actionsBy = {};
  repoList('NewsAction', function (a) { return a.project_id === project.id; }).forEach(function (a) { (actionsBy[a.meeting_id] = actionsBy[a.meeting_id] || []).push(newsActionView_(a, names, {})); });
  var meetings = repoList('Meeting', function (m) { return m.project_id === project.id && m.status === 'Publiée'; })
    .sort(function (a, b) { return String(b.held_on).localeCompare(String(a.held_on)); }).slice(0, 200)
    .map(function (m) { var v = newsMeetingView_(m, []); v.actions = actionsBy[m.id] || []; return v; });
  var res = ad.upsertJournal('Journal du projet — ' + project.code + ' ' + project.name, newsJournalLines_(project, info, meetings, today), project.news_journal_id || '', project.drive_folder_id || '');
  if (res.id !== project.news_journal_id) repoUpdate('Project', project.id, { news_journal_id: res.id }, null, actx);
  return { url: res.url, created: !!res.created, meetings: meetings.length };
}

defineAction('news.journal.update', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  newsMustManage_(ctx, project);
  return newsJournalUpdate_(project, ctx.actx);
});

// ---------------------------------------------------------------- synthèse du jour (prompt, publication)

function newsPrompt_(project, meetings, since, today) {
  var L = [];
  L.push('Projet : ' + project.code + ' — ' + project.name + '.');
  L.push('Rédige la synthèse des actualités du projet depuis le ' + frDate_(since) + ' (jusqu’au ' + frDate_(today) + ').');
  L.push('Appuie-toi uniquement sur les sources du carnet et cite-les entre parenthèses (titre de la réunion, date). N’invente rien.');
  L.push('Réponds en français, en cinq sections, dans cet ordre et avec ces titres exacts :');
  NEWS_SECTIONS.forEach(function (s) { L.push(s + ' :'); });
  L.push('Section « Actions » : une ligne par action, sous la forme « Personne — action — échéance JJ/MM/AAAA — livrable concerné ».');
  L.push('Si une section est vide, écris « Rien à signaler ».');
  if (meetings.length) {
    L.push('');
    L.push('Rappel des réunions de la période (utile si la source du carnet n’est pas à jour) :');
    meetings.slice(0, 15).forEach(function (m) {
      L.push('- ' + frDate_(m.held_on) + ' · ' + m.title + (m.summary ? ' — ' + newsClip_(m.summary, 220) : ''));
      (m.decisions || []).slice(0, 4).forEach(function (d) { L.push('    décision : ' + newsClip_(d, 160)); });
      (m.actions || []).slice(0, 6).forEach(function (a) { L.push('    action : ' + newsClip_(a.text, 140) + ' (' + (a.owner || a.owner_label || '?') + (a.due_date ? ', ' + frDate_(a.due_date) : '') + ')'); });
    });
  }
  return L.join('\n');
}

/** Reconnaît les cinq sections demandées ; au moins trois et un texte consistant, sinon la publication est refusée. */
function newsValidateDigest_(text) {
  var t = String(text === undefined || text === null ? '' : text).trim();
  var found = {}, rules = [['Décisions', /^d[ée]cisions?$/], ['Dates qui bougent', /^dates?( qui bougent| cl[ée]s?)?$/], ['Risques', /^risques?$/], ['Blocages', /^blocages?$/], ['Actions', /^actions?$/]];
  t.split(/\r?\n/).forEach(function (line) {
    var core = newsNorm_(line.replace(/^[#>*_\s\-–—•\d.)]+/, '').replace(/[*_]+/g, ''));
    var m = /^([^:]{2,30}?)\s*:/.exec(core), title = m ? m[1] : core;
    rules.forEach(function (r) { if (r[1].test(title)) found[r[0]] = true; });
  });
  var have = rules.map(function (r) { return r[0]; }).filter(function (n) { return found[n]; });
  var missing = rules.map(function (r) { return r[0]; }).filter(function (n) { return !found[n]; });
  return { ok: t.length >= 40 && have.length >= 3, found: have, missing: missing, length: t.length };
}

defineAction('news.digest.prompt', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  newsMustManage_(ctx, project);
  var base = newsBase_(), names = newsNames_(base), today = todayStr(), since = addCalendarDays(today, -1);
  var actionsBy = {};
  repoList('NewsAction', function (a) { return a.project_id === project.id; }).forEach(function (a) { (actionsBy[a.meeting_id] = actionsBy[a.meeting_id] || []).push(newsActionView_(a, names, {})); });
  var meetings = repoList('Meeting', function (m) { return m.project_id === project.id && m.status === 'Publiée' && String(m.held_on) >= since; })
    .sort(function (a, b) { return String(a.held_on).localeCompare(String(b.held_on)); }).map(function (m) { var v = newsMeetingView_(m, []); v.actions = actionsBy[m.id] || []; return v; });
  return { prompt: newsPrompt_(project, meetings, since, today), since: since, meetings: meetings.length };
});

defineAction('news.digest.publish', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  newsMustManage_(ctx, project);
  var text = String(p.text || '').trim();
  if (text.length > 12000) throw new PpmError('VALIDATION', 'La synthèse dépasse 12 000 caractères.');
  var check = newsValidateDigest_(text);
  if (!check.ok) {
    throw new PpmError('VALIDATION', 'Format non reconnu' + (check.missing.length ? ' : il manque les sections ' + check.missing.join(', ') : '') + '. Redemandez la synthèse avec le prompt du jour.', { missing: check.missing });
  }
  var today = todayStr();
  return withLock(function () {
    repoList('NewsDigest', function (d) { return d.project_id === project.id && d.digest_date === today; }).forEach(function (d) { repoSoftDelete('NewsDigest', d.id, null, ctx.actx); });
    var d = repoInsert('NewsDigest', { project_id: project.id, digest_date: today, text: text, published_by: ctx.email }, ctx.actx);
    var notified = 0;
    if (p.notify !== false) {
      var base = newsBase_(), members = newsProjectMembers_(project, base);
      var url = getProp(PROP.WEBAPP_URL, '');
      base.resources.filter(function (r) { return members[r.id] && !isTrue(r.deleted) && !isBlank(r.email) && (!allowedDomains().length || isAllowedEmail_(String(r.email).toLowerCase())); }).slice(0, 150).forEach(function (r) {
        var body = 'Bonjour ' + r.name + ',\n\nActualités du projet ' + project.code + ' ' + project.name + ' au ' + frDate_(today) + ' :\n\n' + text + '\n' + (url ? '\nDétail et vos actions : ' + url + '?view=actualites&project=' + project.id + '\n' : '');
        var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2A33;max-width:640px"><p>Bonjour ' + escHtml_(r.name) + ',</p><p>Actualités du projet <b>' + escHtml_(project.code + ' ' + project.name) + '</b> au ' + escHtml_(frDate_(today)) + ' :</p>' +
          text.split(/\n+/).map(function (l) { return '<p style="margin:4px 0">' + escHtml_(l) + '</p>'; }).join('') + (url ? '<p style="margin-top:18px"><a href="' + escHtml_(url + '?view=actualites&project=' + project.id) + '">Détail et vos actions</a></p>' : '') + '</div>';
        if (sendMail_(String(r.email).toLowerCase(), 'Actualités ' + project.code + ' du ' + frDate_(today), body, html)) notified++;
      });
    }
    return { id: d.id, date: today, notified: notified, found: check.found };
  });
});

// ---------------------------------------------------------------- récapitulatif du matin

/** Sections « Actualités » et « Vos actions » ajoutées au récapitulatif d'une personne. */
function newsDigestSections_(data, person, today, windowStart, link) {
  var n = data.news;
  if (!n) return [];
  var out = [], mine = [];
  var scopeOf = {};
  data.projects.forEach(function (p) { scopeOf[p.id] = p.id; if (p.program_id) scopeOf[p.program_id] = p.id; });
  (data.workpackages || []).forEach(function (w) { scopeOf[w.id] = w.project_id; });
  (data.planitems || []).forEach(function (i) { scopeOf[i.id] = i.project_id; });
  var memberOf = {};
  (data.assignments || []).forEach(function (a) { if (a.resource_id === person.id && scopeOf[a.scope_id]) memberOf[scopeOf[a.scope_id]] = true; });
  data.projects.forEach(function (p) { if (p.manager_resource_id === person.id) memberOf[p.id] = true; });
  data.projects.filter(function (p) { return memberOf[p.id] && !isTrue(p.deleted) && p.status !== 'Clos'; }).forEach(function (p) {
    var digest = n.digests.filter(function (d) { return d.project_id === p.id && !isTrue(d.deleted) && d.digest_date >= windowStart; })
      .sort(function (a, b) { return String(b.digest_date).localeCompare(String(a.digest_date)); })[0];
    var lines = [];
    if (digest) {
      String(digest.text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 14).forEach(function (l) { lines.push({ text: newsClip_(l, 220), url: lines.length ? '' : link('actualites', p.id) }); });
    } else {
      n.meetings.filter(function (m) { return m.project_id === p.id && m.status === 'Publiée' && !isTrue(m.deleted) && m.held_on >= windowStart; })
        .sort(function (a, b) { return String(b.held_on).localeCompare(String(a.held_on)); }).slice(0, 6).forEach(function (m) {
          lines.push({ text: frDate_(m.held_on) + ' · ' + m.title, note: newsClip_(m.summary, 140), url: link('actualites', p.id) });
        });
    }
    if (lines.length) out.push({ title: 'Actualités ' + p.code + (digest ? '' : ' (journal brut : pas de synthèse publiée)'), lines: lines });
  });
  var soon = addCalendarDays(today, 7), project = indexBy_(data.projects);
  n.actions.filter(function (a) { return a.owner_resource_id === person.id && !isTrue(a.deleted) && NEWS_OPEN.indexOf(a.status) >= 0 && !isBlank(a.project_id); }).forEach(function (a) {
    var late = a.due_date && a.due_date < today, soonDue = a.due_date && a.due_date <= soon;
    if (a.status === 'Proposée' || late || soonDue) {
      var pr = project[a.project_id] || { code: '' };
      mine.push({ text: pr.code + ' · ' + a.text, note: a.status === 'Proposée' ? 'à accepter ou contester' : (late ? 'en retard : ' + frDate_(a.due_date) : 'pour le ' + frDate_(a.due_date)), tone: late ? 'alert' : '', url: link('actualites', a.project_id) });
    }
  });
  if (mine.length) out.push({ title: 'Vos actions issues des réunions', lines: mine });
  return out;
}
