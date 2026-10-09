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
