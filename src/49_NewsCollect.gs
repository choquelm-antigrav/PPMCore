/**
 * PPM Core — fil d'actualités : collecteur d'agenda (brique F), adaptateur Calendar/Docs et déclencheur newsCollectRun.
 * Voir 48_News.gs pour l'ensemble du module.
 */

// ---------------------------------------------------------------- collecteur (F)

function realNews_() {
  var hasCal = typeof Calendar !== 'undefined' && Calendar.Events;
  var hasDoc = typeof DocumentApp !== 'undefined';
  var tz = function () { return typeof Session !== 'undefined' && Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'Europe/Paris'; };
  return {
    available: !!hasCal,
    /** Les événements d'UN agenda (celui d'un projet) : `calendarId` est l'adresse de l'agenda. */
    listEvents: function (calendarId, fromIso, toIso) {
      var out = [], token = '';
      do {
        var res = Calendar.Events.list(calendarId, { timeMin: fromIso, timeMax: toIso, singleEvents: true, orderBy: 'startTime', maxResults: 250, showDeleted: false, supportsAttachments: true, pageToken: token || undefined });
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
    /** Crée l'agenda d'un projet (propriété du compte qui exécute l'outil) et le rend lisible par tout le domaine ; rend son adresse. */
    createCalendar: hasCal && Calendar.Calendars ? function (name, description) {
      var cal = Calendar.Calendars.insert({ summary: name, description: description || '', timeZone: tz() });
      var domain = '';
      try { domain = String(Session.getEffectiveUser().getEmail()).split('@')[1] || ''; } catch (e) { domain = ''; }
      if (domain) { try { Calendar.Acl.insert({ role: 'reader', scope: { type: 'domain', value: domain } }, cal.id); } catch (e) { /* le partage au domaine reste à faire à la main */ } }
      return { id: cal.id, shared: !!domain };
    } : null,
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
 * Une passe de collecte : pour chaque projet qui a activé le fil ET qui a son agenda (0.21.2), les réunions de cet agenda dans la fenêtre (depuis la dernière passe, un jour au plus par défaut).
 * Toute réunion de l'agenda d'un projet appartient à ce projet : il n'y a plus de repère de titre ni de réunion « à trier ». Les personnes invitent simplement l'agenda du projet à leur réunion.
 * Reprenable : une réunion déjà créée pour ce projet (même identifiant d'événement dans son agenda) n'est jamais recréée.
 */
function newsCollect_(opts) {
  opts = opts || {};
  var ad = newsAdapter_();
  var res = { created: 0, toTriage: 0, skippedPrivate: 0, ignored: 0, notes: 0, errors: 0, projects: 0, partial: false };
  if (!ad.available) { res.skipped = 'L’agenda n’est pas accessible (service Calendar).'; return res; }
  var all = repoList('Project', function (p) { return isTrue(p.news_on) && p.status !== 'Clos'; });
  if (!all.length) { res.skipped = 'Aucun projet n’a activé le fil d’actualités.'; return res; }
  var projects = all.filter(function (p) { return !isBlank(p.news_calendar_id); });
  res.projects = projects.length;
  if (!projects.length) { res.skipped = 'Aucun projet n’a d’agenda : créez-le dans les réglages du fil du projet.'; return res; }
  var nowMsV = opts.nowMs || nowMs();
  var last = getProp(PROP.NEWS_LAST, '');
  var fromMs = last ? Math.max(Date.parse(last), nowMsV - 3 * 86400000) : nowMsV - 86400000;
  var base = newsBase_(), byEmail = {};
  base.resources.forEach(function (r) { if (!isBlank(r.email)) byEmail[String(r.email).toLowerCase()] = r; });
  var known = {}; repoList('Meeting', function (m) { return !isBlank(m.event_id); }).forEach(function (m) { known[m.project_id + '|' + m.event_id] = true; });
  var deadline = nowMsV + (opts.budgetMs || NEWS_COLLECT_MS);
  var actx = JOB_ACTX, touched = {};
  for (var pi = 0; pi < projects.length && !res.partial; pi++) {
    var pr = projects[pi], events;
    try { events = ad.listEvents(pr.news_calendar_id, new Date(fromMs).toISOString(), new Date(nowMsV).toISOString()); }
    catch (e) { res.errors++; res.failed = (res.failed || []).concat(pr.code); continue; }   // l'agenda d'un projet illisible n'arrête pas les autres
    var memberIds = newsProjectMembers_(pr, base), people = newsPeople_(base, memberIds);
    for (var i = 0; i < events.length; i++) {
      if (nowMs() > deadline) { res.partial = true; break; }
      var ev = events[i];
      if (ev.cancelled) { res.ignored++; continue; }
      if (ev.isPrivate) { res.skippedPrivate++; continue; }
      if (known[pr.id + '|' + ev.id]) continue;
      var texts = [], docUrl = '';
      (ev.attachments || []).filter(newsLooksLikeNotes_).slice(0, 3).forEach(function (att) {
        if (!ad.readDoc) return;
        try { texts.push(ad.readDoc(att.fileId)); docUrl = docUrl || att.url; res.notes++; } catch (e) { res.errors++; }
      });
      var parsed = newsParseNotes_(texts.join('\n\n'), ev.date, people);
      var names = ev.attendees.map(function (e) { return byEmail[e] ? byEmail[e].name : e.split('@')[0]; });
      var mt = repoInsert('Meeting', {
        project_id: pr.id, source: 'Agenda', event_id: ev.id, held_on: ev.date, title: newsClip_(ev.title, 140),
        participants: newsClip_(names.join(', '), 400), doc_url: docUrl, attachments: newsAttachmentsJson_(ev.attachments), summary: parsed.summary, decisions: parsed.decisions.join('\n'),
        status: 'Publiée', candidates: '', dedupe_key: 'cal:' + pr.id + ':' + ev.id, added_by: 'collecteur'
      }, actx);
      known[pr.id + '|' + ev.id] = true;
      newsInsertActions_(mt, pr.id, parsed.actions, actx);
      res.created++; touched[pr.id] = true;
    }
  }
  if (!res.partial && !res.failed) setProp(PROP.NEWS_LAST, new Date(nowMsV).toISOString());
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
  var msg = r.skipped ? r.skipped : (r.failed ? 'Agenda illisible pour ' + r.failed.join(', ') + ' ; ' : '') + r.created + ' réunion(s) retenue(s), ' + r.toTriage + ' à trier, ' + r.notes + ' note(s) lue(s), ' + journals + ' journal(aux) mis à jour' + (r.partial ? ' (collecte partielle : reprise au prochain passage)' : '') + '.';
  setProp(PROP.LAST_NEWS, JSON.stringify({ at: nowIso(), created: r.created || 0, toTriage: r.toTriage || 0, journals: journals }));
  console.log('[actualités] ' + msg);
  return msg;
}
