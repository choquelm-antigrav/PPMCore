/**
 * PPM Core — fil d'actualités : lecture des textes (dates, notes Gemini, minutes, actions) et rattachement d'une réunion à un projet.
 * Fonctions de calcul sans service Google, testées seules (voir 48_News.gs pour l'ensemble du module).
 */

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
