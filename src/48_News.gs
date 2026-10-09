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

// ---------------------------------------------------------------- texte

/** Minuscules, sans accents, espaces simples : pour comparer des noms et des titres. */
function newsNorm_(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function newsClip_(s, n) {
  s = String(s === undefined || s === null ? '' : s).trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function newsHash_(s) {
  var h = 5381, i;
  s = newsNorm_(s);
  for (i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Cherche une date dans un texte (AAAA-MM-JJ, J/M, J/M/AAAA, « 30 octobre ») ; sans année, la prochaine date plausible après la réunion. */
function newsFindDate_(text, ref) {
  var s = String(text === undefined || text === null ? '' : text), m, y, mo, d, hit;
  var refY = Number(String(ref || todayStr()).slice(0, 4));
  var valid = function (yy, mm, dd) {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    var t = new Date(Date.UTC(yy, mm - 1, dd)); // une date qui « déborde » (31/02) change de mois : refusée
    return t.getUTCFullYear() === yy && t.getUTCMonth() === mm - 1 && t.getUTCDate() === dd;
  };
  var infer = function (mm, dd) {
    var cand = ymd(refY, mm, dd);
    return cand < addCalendarDays(ref || todayStr(), -60) ? ymd(refY + 1, mm, dd) : cand;
  };
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s)) && valid(+m[1], +m[2], +m[3])) { hit = { date: m[1] + '-' + m[2] + '-' + m[3], raw: m[0] }; }
  else if ((m = /\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}|\d{2}))?\b/.exec(s)) && valid(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : refY, +m[2], +m[1])) {
    d = +m[1]; mo = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0;
    hit = { date: y ? ymd(y, mo, d) : infer(mo, d), raw: m[0] };
  } else if ((m = /\b(\d{1,2})(?:er)?\s+(janv(?:ier)?|f[ée]vr(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?)\.?(?:\s+(\d{4}))?/i.exec(s))) {
    mo = NEWS_MONTHS[newsNorm_(m[2])]; d = +m[1]; y = m[3] ? +m[3] : 0;
    if (mo && valid(y || refY, mo, d)) hit = { date: y ? ymd(y, mo, d) : infer(mo, d), raw: m[0] };
  }
  if (!hit) return { date: '', text: s };
  var rest = s.replace(hit.raw, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s*(?:pour|avant|d['’]ici|jusqu['’]au|[ée]ch[ée]ance|deadline|due|by)(?:\s+le)?\s*[:\-–—]?\s*(?=$|[.,;)])/i, ' ').replace(/\s+/g, ' ').trim().replace(/[\s,;:(–—-]+$/, '');
  return { date: hit.date, text: rest };
}

/** Un titre de section d'un compte rendu : { kind: 'summary' | 'decisions' | 'actions' | 'other', rest } ou null. */
function newsHeading_(line) {
  var t = String(line).trim();
  if (!t || /^[-*•·▪◦‣⁃–—+]\s/.test(t) || /^\[[^\]]*\]/.test(t)) return null;
  var core = t.replace(/^[#>*_\s]+/, '').replace(/[*_]+$/, '').trim();
  var m = /^([^:]{2,40}?)\s*:\s*(.*)$/.exec(core);
  var title = m ? m[1] : core, rest = m ? m[2] : '';
  var n = newsNorm_(title);
  if (/^(resume|synthese|recapitulatif|apercu|summary|points? cles?)$/.test(n)) return { kind: 'summary', rest: rest };
  if (/^(decisions?( prises?)?|points? decides?|conclusions?)$/.test(n)) return { kind: 'decisions', rest: rest };
  if (/^(prochaines? etapes?|etapes? suivantes?|actions?( a mener| a suivre| items?)?|plan d.?actions?|a faire|suivi( des actions)?|next steps?|action items?|follow.?ups?|taches?)$/.test(n)) return { kind: 'actions', rest: rest };
  if (/^(details?|risques?|blocages?|dates?( cles?)?|participants?|ordre du jour|questions?|points? ouverts?|notes?|divers|agenda|invites?)$/.test(n)) return { kind: 'other', rest: '' };
  if (/^#/.test(t) || (m && !rest && core.length <= 60)) return { kind: 'other', rest: '' };
  return null;
}

/** people = { members: [{ id, name }], all: [{ id, name }] } : un libellé désigne une personne s'il n'y a pas d'ambiguïté. */
function newsResolvePerson_(label, people) {
  var n = newsNorm_(label).replace(/^@/, '');
  if (!n) return '';
  var unique = function (list, test) {
    var hit = list.filter(function (p) { return test(newsNorm_(p.name).split(' '), newsNorm_(p.name)); });
    return hit.length === 1 ? hit[0].id : '';
  };
  var ntok = n.split(' ');
  var id = unique((people && people.members) || [], function (parts, full) {
    return full === n || (ntok.length === 1 && (parts[0] === n || parts[parts.length - 1] === n)) ||
      (ntok.length > 1 && parts.every(function (t) { return ntok.indexOf(t) >= 0; })); // « Rémi Dupont » dans les notes, « Rémi » dans l'annuaire
  });
  if (id) return id;
  return unique((people && people.all) || [], function (parts, full) { return full === n; });
}

/** Une ligne de « prochaines étapes » → { owner_resource_id, owner_label, text, due } ou null. */
function newsParseActionLine_(raw, ref, people) {
  var s = String(raw === undefined || raw === null ? '' : raw).replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s>*•·▪◦‣⁃+\-–—]+/, '').replace(/^\(?\d{1,2}[.)]\s+/, '').replace(/^(?:\[[ xX]?\]|[☐☑✔✅])\s*/, '').trim();
  if (s.length < 4) return null;
  var m, who = '', body = s, convention = false;
  if ((m = /^(?:action|à faire|a faire|todo)\s*[:\-–—]\s*(.+)$/i.exec(s))) { body = m[1]; s = m[1]; convention = true; }
  if ((m = /^\[([^\]]{2,60})\]\s*[:\-–—]?\s*(.+)$/.exec(s))) { who = m[1]; body = m[2]; }
  else if ((m = /^@([^:–—]{2,40}?)\s*[:\-–—]\s*(.+)$/.exec(s))) { who = m[1]; body = m[2]; }
  else if ((m = /^([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?: [A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,2})\s*:\s+(.+)$/.exec(s)) &&
    (newsResolvePerson_(m[1], people) || m[1].indexOf(' ') > 0)) { who = m[1]; body = m[2]; }
  else if (convention || /\s[—–|]\s|;/.test(s)) {
    var parts = s.split(/\s+[—–|]\s+|\s*;\s*/), rest = [], due = '';
    parts.forEach(function (part, i) {
      var f = newsFindDate_(part, ref);
      if (i > 0 && f.date && f.text.length < 3) { due = due || f.date; return; }
      if (i > 0 && !who && (newsResolvePerson_(part, people) || /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?: [A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+){0,2}$/.test(part.trim()))) { who = part.trim(); return; }
      rest.push(part);
    });
    body = rest.join(' — ');
    if (due) return finish_(who, body, due);
  } else if ((m = /^(.+?)\s*\(([A-ZÀ-Ý][^()]{1,40})\)\s*\.?$/.exec(s)) && newsResolvePerson_(m[2], people)) { who = m[2]; body = m[1]; }
  var f2 = newsFindDate_(body, ref);
  return finish_(who, f2.date ? f2.text : body, f2.date);

  function finish_(w, text, due2) {
    text = String(text).replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');
    if (text.length < 4) return null;
    return { owner_resource_id: newsResolvePerson_(w, people), owner_label: w, text: newsClip_(text, 300), due: due2 || '' };
  }
}

/** Notes Gemini ou minutes manuelles → { summary, decisions[], actions[] }. Les lignes « Action : … » et « Décision : … » comptent où qu'elles soient. */
function newsParseNotes_(text, ref, people) {
  var buckets = { summary: [], decisions: [], actions: [] }, sec = null, first = [];
  String(text === undefined || text === null ? '' : text).split(/\r?\n/).forEach(function (line) {
    var t = line.trim();
    if (!t) return;
    var cm = /^[-*•\s]*(action|d[ée]cision)\s*[:\-–—]\s*(.+)$/i.exec(t);
    if (cm) { (/^a/i.test(cm[1]) ? buckets.actions : buckets.decisions).push(/^a/i.test(cm[1]) ? t : cm[2]); return; }
    var h = newsHeading_(t);
    if (h) { sec = h.kind; if (h.rest && buckets[h.kind]) buckets[h.kind].push(h.rest); return; }
    if (sec && buckets[sec]) buckets[sec].push(t);
    else if (!sec && first.length < 6) first.push(t);
  });
  var clean = function (l) { return String(l).replace(/^[\s>*•·▪◦‣⁃+\-–—]+/, '').replace(/^\(?\d{1,2}[.)]\s+/, '').trim(); };
  var actions = [];
  buckets.actions.forEach(function (l) { var a = newsParseActionLine_(l, ref, people); if (a && actions.length < NEWS_ACTIONS_MAX) actions.push(a); });
  var summaryLines = (buckets.summary.length ? buckets.summary : first).map(clean).filter(function (l) { return l.length > 2; });
  return {
    summary: newsClip_(summaryLines.join(' '), 700),
    decisions: buckets.decisions.map(clean).filter(function (l) { return l.length > 1; }).slice(0, 12).map(function (l) { return newsClip_(l, 300); }),
    actions: actions
  };
}

// ---------------------------------------------------------------- rattachement d'une réunion à un projet

/** Mots qui désignent un projet dans un titre : séparés par virgule, point-virgule ou ligne ; un seul caractère seulement s'il n'est pas alphanumérique (logo). */
function newsKeywords_(project) {
  var seen = {};
  return String(project.news_keywords || '').split(/[,;\n]+/).map(function (k) { return k.trim(); })
    .filter(function (k) { return k && (k.length >= 2 || /[^A-Za-z0-9À-ÿ]/.test(k)); })
    .filter(function (k) { var n = newsNorm_(k); if (seen[n]) return false; seen[n] = true; return true; });
}

/**
 * event = { title, attendees: [e-mails] } ; projects = [{ id, keywords: [..], members: { e-mail: true } }].
 * Un repère dans le titre l'emporte ; sinon au moins deux membres invités, le projet qui en compte le plus gagne ; égalité : « à trier ».
 */
function newsMatchProject_(event, projects) {
  var title = newsNorm_(event.title), att = (event.attendees || []).map(function (e) { return String(e).toLowerCase(); });
  var byKey = projects.filter(function (p) { return (p.keywords || []).some(function (k) { return title.indexOf(newsNorm_(k)) >= 0; }); });
  if (byKey.length === 1) return { status: 'ok', projectId: byKey[0].id, why: 'repère' };
  if (byKey.length > 1) return { status: 'tie', candidates: byKey.map(function (p) { return p.id; }) };
  var counted = projects.map(function (p) { return { id: p.id, n: att.filter(function (e) { return p.members && p.members[e]; }).length }; }).filter(function (x) { return x.n >= 2; });
  if (!counted.length) return { status: 'none' };
  var max = Math.max.apply(null, counted.map(function (x) { return x.n; }));
  var best = counted.filter(function (x) { return x.n === max; });
  if (best.length === 1) return { status: 'ok', projectId: best[0].id, why: 'membres' };
  return { status: 'tie', candidates: best.map(function (x) { return x.id; }) };
}

function newsActiveAssignments_() { return repoList('RoleAssignment', function (a) { return isBlank(a.end_date) || String(a.end_date) >= todayStr(); }); }

/** Personnes du projet : rôle actif sur le projet, un de ses lots ou livrables, ou son programme ; plus son chef de projet. */
function newsProjectMembers_(project, base) {
  var scope = {};
  scope[project.id] = true;
  if (project.program_id) scope[project.program_id] = true;
  base.wps.forEach(function (w) { if (w.project_id === project.id) scope[w.id] = true; });
  base.items.forEach(function (i) { if (i.project_id === project.id) scope[i.id] = true; });
  var ids = {};
  if (project.manager_resource_id) ids[project.manager_resource_id] = true;
  base.assignments.forEach(function (a) { if (scope[a.scope_id]) ids[a.resource_id] = true; });
  return ids;
}

function newsBase_() {
  return {
    projects: repoList('Project'), wps: repoList('WorkPackage'), items: repoList('PlanItem'), resources: repoList('Resource'),
    assignments: newsActiveAssignments_()
  };
}

function newsPeople_(base, memberIds) {
  var all = base.resources.map(function (r) { return { id: r.id, name: r.name }; });
  return { members: all.filter(function (p) { return memberIds[p.id]; }), all: all };
}

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

// ---------------------------------------------------------------- collecteur (F)

function realNews_() {
  var hasCal = typeof Calendar !== 'undefined' && Calendar.Events;
  var hasDoc = typeof DocumentApp !== 'undefined';
  var tz = function () { return typeof Session !== 'undefined' && Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'Europe/Paris'; };
  return {
    available: !!hasCal,
    listEvents: function (fromIso, toIso) {
      var out = [], token = '';
      do {
        var res = Calendar.Events.list('primary', { timeMin: fromIso, timeMax: toIso, singleEvents: true, orderBy: 'startTime', maxResults: 250, showDeleted: false, supportsAttachments: true, pageToken: token || undefined });
        (res.items || []).forEach(function (e) {
          var dt = (e.start && (e.start.dateTime || e.start.date)) || '';
          out.push({
            id: e.id, title: e.summary || '(sans titre)', date: e.start && e.start.dateTime ? Utilities.formatDate(new Date(e.start.dateTime), tz(), 'yyyy-MM-dd') : String(dt).slice(0, 10),
            start: dt, cancelled: e.status === 'cancelled', isPrivate: e.visibility === 'private' || e.visibility === 'confidential',
            attendees: (e.attendees || []).filter(function (a) { return !a.resource && a.responseStatus !== 'declined' && a.email; }).map(function (a) { return String(a.email).toLowerCase(); }),
            attachments: (e.attachments || []).map(function (a) { return { fileId: a.fileId || '', title: a.title || '', mime: a.mimeType || '', url: a.fileUrl || '' }; })
          });
        });
        token = res.nextPageToken || '';
      } while (token);
      return out;
    },
    readDoc: hasDoc ? function (fileId) { return String(DocumentApp.openById(fileId).getBody().getText()).slice(0, NEWS_DOC_MAX); } : null,
    upsertJournal: hasDoc ? function (title, lines, docId, folderId) {
      var doc = null, created = false;
      if (docId) { try { doc = DocumentApp.openById(docId); } catch (e) { doc = null; } }
      if (!doc) {
        doc = DocumentApp.create(title); created = true;
        if (folderId) { try { var f = DriveApp.getFileById(doc.getId()); DriveApp.getFolderById(folderId).addFile(f); DriveApp.getRootFolder().removeFile(f); } catch (e) { /* le document reste à la racine */ } }
      }
      var body = doc.getBody();
      body.clear();
      lines.forEach(function (l) {
        if (l.indexOf('### ') === 0) body.appendParagraph(l.slice(4)).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        else if (l.indexOf('## ') === 0) body.appendParagraph(l.slice(3)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        else if (l.indexOf('# ') === 0) body.appendParagraph(l.slice(2)).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        else body.appendParagraph(l).setHeading(DocumentApp.ParagraphHeading.NORMAL);
      });
      doc.saveAndClose();
      return { id: doc.getId(), url: 'https://docs.google.com/document/d/' + doc.getId() + '/edit', created: created };
    } : null
  };
}

function newsLooksLikeNotes_(att) {
  return /document/.test(att.mime || '') && !!att.fileId && /notes|gemini|compte.?rendu|\bCR\b|minutes|\bMoM\b|r[ée]union/i.test(att.title || '');
}

/**
 * Une passe de collecte : les réunions de la fenêtre (depuis la dernière passe, un jour au plus par défaut) de l'agenda du compte du script.
 * Reprenable : une réunion déjà créée (même identifiant d'événement) n'est jamais recréée.
 */
function newsCollect_(opts) {
  opts = opts || {};
  var ad = newsAdapter_();
  var res = { created: 0, toTriage: 0, skippedPrivate: 0, ignored: 0, notes: 0, errors: 0, projects: 0, partial: false };
  if (!ad.available) { res.skipped = 'L’agenda n’est pas accessible (service Calendar).'; return res; }
  var projects = repoList('Project', function (p) { return isTrue(p.news_on) && p.status !== 'Clos'; });
  res.projects = projects.length;
  if (!projects.length) { res.skipped = 'Aucun projet n’a activé le fil d’actualités.'; return res; }
  var nowMsV = opts.nowMs || nowMs();
  var last = getProp(PROP.NEWS_LAST, '');
  var fromMs = last ? Math.max(Date.parse(last), nowMsV - 3 * 86400000) : nowMsV - 86400000;
  var base = newsBase_(), byEmail = {};
  base.resources.forEach(function (r) { if (!isBlank(r.email)) byEmail[String(r.email).toLowerCase()] = r; });
  var specs = projects.map(function (pr) {
    var ids = newsProjectMembers_(pr, base), emails = {};
    base.resources.forEach(function (r) { if (ids[r.id] && !isBlank(r.email)) emails[String(r.email).toLowerCase()] = true; });
    return { id: pr.id, keywords: newsKeywords_(pr), members: emails, memberIds: ids, project: pr };
  });
  var specById = {}; specs.forEach(function (s) { specById[s.id] = s; });
  var known = {}; repoList('Meeting', function (m) { return !isBlank(m.event_id); }).forEach(function (m) { known[m.event_id] = true; });
  var deadline = nowMsV + (opts.budgetMs || NEWS_COLLECT_MS);
  var events = ad.listEvents(new Date(fromMs).toISOString(), new Date(nowMsV).toISOString());
  var actx = JOB_ACTX, touched = {};
  for (var i = 0; i < events.length; i++) {
    if (nowMs() > deadline) { res.partial = true; break; }
    var ev = events[i];
    if (ev.cancelled) { res.ignored++; continue; }
    if (ev.isPrivate) { res.skippedPrivate++; continue; }
    var key = 'ev:' + ev.id;
    if (known[ev.id] || known[key]) continue;
    var match = newsMatchProject_({ title: ev.title, attendees: ev.attendees }, specs);
    if (match.status === 'none') { res.ignored++; continue; }
    var spec = match.status === 'ok' ? specById[match.projectId] : specById[match.candidates[0]];
    var people = newsPeople_(base, spec.memberIds), texts = [], docUrl = '';
    (ev.attachments || []).filter(newsLooksLikeNotes_).slice(0, 3).forEach(function (att) {
      if (!ad.readDoc) return;
      try { texts.push(ad.readDoc(att.fileId)); docUrl = docUrl || att.url; res.notes++; } catch (e) { res.errors++; }
    });
    var parsed = newsParseNotes_(texts.join('\n\n'), ev.date, people);
    var names = ev.attendees.map(function (e) { return byEmail[e] ? byEmail[e].name : e.split('@')[0]; });
    var mt = repoInsert('Meeting', {
      project_id: match.status === 'ok' ? match.projectId : '', source: 'Agenda', event_id: ev.id, held_on: ev.date, title: newsClip_(ev.title, 140),
      participants: newsClip_(names.join(', '), 400), doc_url: docUrl, summary: parsed.summary, decisions: parsed.decisions.join('\n'),
      status: match.status === 'ok' ? 'Publiée' : 'À trier', candidates: match.status === 'tie' ? match.candidates.join(',') : '', dedupe_key: key, added_by: 'collecteur'
    }, actx);
    known[ev.id] = true;
    newsInsertActions_(mt, match.status === 'ok' ? match.projectId : '', parsed.actions, actx);
    if (match.status === 'ok') { res.created++; touched[match.projectId] = true; } else res.toTriage++;
  }
  if (!res.partial) setProp(PROP.NEWS_LAST, new Date(nowMsV).toISOString());
  res.touched = Object.keys(touched);
  return res;
}

/** Déclencheur de 1 h et de 13 h : collecte, puis mise à jour du journal des projets où il y a du nouveau (ou pas encore de journal). */
function newsCollectRun() {
  resetExecution_();
  var r;
  try { r = newsCollect_({}); } catch (e) { console.log('[actualités] collecte en échec : ' + e.message); setProp(PROP.LAST_NEWS, JSON.stringify({ at: nowIso(), error: String(e.message).slice(0, 200) })); return 'Collecte en échec : ' + e.message; }
  var journals = 0;
  if (!r.skipped) {
    repoList('Project', function (p) { return isTrue(p.news_on) && p.status !== 'Clos'; }).forEach(function (pr) {
      if ((r.touched || []).indexOf(pr.id) >= 0 || isBlank(pr.news_journal_id)) {
        try { newsJournalUpdate_(pr, JOB_ACTX); journals++; } catch (e) { console.log('[actualités] journal de ' + pr.code + ' : ' + e.message); }
      }
    });
  }
  var msg = r.skipped ? r.skipped : r.created + ' réunion(s) retenue(s), ' + r.toTriage + ' à trier, ' + r.notes + ' note(s) lue(s), ' + journals + ' journal(aux) mis à jour' + (r.partial ? ' (collecte partielle : reprise au prochain passage)' : '') + '.';
  setProp(PROP.LAST_NEWS, JSON.stringify({ at: nowIso(), created: r.created || 0, toTriage: r.toTriage || 0, journals: journals }));
  console.log('[actualités] ' + msg);
  return msg;
}

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
