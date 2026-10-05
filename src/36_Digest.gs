/**
 * PPM Core — lot 2 : mail récapitulatif (section 8, Gmail).
 *
 * Un seul mail par personne : chaque matin de semaine (réglage « Quotidien », par défaut),
 * le lundi seulement (« Hebdomadaire »), ou jamais (« Aucun »). Il est calculé à partir de l'état
 * des données, sans file d'attente : ce qui est réglé depuis la veille n'y figure plus.
 *
 *   - Mes livrables et jalons : en retard, à échéance dans les 7 jours, avancement non déclaré depuis 30 jours ;
 *   - Pilotage (chef de projet, DPL) : changements à valider, demandes de baseline, alertes du moteur de règles ;
 *   - Mes demandes de baseline tranchées depuis le dernier récapitulatif.
 *
 * Seules les adresses du domaine reçoivent un récapitulatif. buildDigests est pure (testée hors ligne).
 */

var DIGEST_MAX_LINES = 12;

function escHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function frDate_(s) {
  if (isBlank(s)) return '';
  var p = String(s).slice(0, 10).split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

/**
 * data : { projects, planitems, resources, assignments, settings, insights, baselines, workpackages,
 *          pendingChanges: { projectId: n } }
 * opts : { baseUrl, weekly: true le lundi (les réglages « Hebdomadaire » reçoivent alors leur mail), onlyEmail }
 * Renvoie [{ to, subject, text, html, counts }] ; une personne sans rien à signaler ne reçoit rien.
 */
function buildDigests(data, today, opts) {
  opts = opts || {};
  var domains = allowedDomains();
  var projects = indexBy_(data.projects);
  var live = function (r) { return !isTrue(r.deleted); };
  var activeProject = function (id) { var p = projects[id]; return p && live(p) && p.status !== 'Clos'; };
  var settings = {};
  (data.settings || []).forEach(function (s) { settings[String(s.user_email).toLowerCase()] = s; });
  var lookup = memoryLookup(data);
  var soon = addCalendarDays(today, THRESHOLDS.dueSoonDays);
  var staleLimit = addCalendarDays(today, -THRESHOLDS.staleProgressDays);
  var link = function (view, projectId, extra) {
    return opts.baseUrl ? opts.baseUrl + '?view=' + view + '&project=' + projectId + (extra || '') : '';
  };
  var out = [];

  data.resources.filter(live).forEach(function (r) {
    if (isBlank(r.email)) return;
    var email = String(r.email).toLowerCase();
    if (domains.length && !isAllowedEmail_(email)) return;
    if (opts.onlyEmail && opts.onlyEmail !== email) return;
    var freq = (settings[email] && settings[email].notify_frequency) || 'Quotidien';
    if (!opts.onlyEmail) {
      if (freq === 'Aucun') return;
      if (freq === 'Hebdomadaire' && !opts.weekly) return;
    }
    var windowStart = freq === 'Hebdomadaire' ? addCalendarDays(today, -7) : addCalendarDays(today, -1);
    var sections = [];

    // 1. Mes livrables et jalons
    var mine = data.planitems.filter(function (i) {
      return live(i) && i.owner_resource_id === r.id && activeProject(i.project_id) && !isDone_(i);
    });
    var late = [], due = [], stale = [];
    mine.forEach(function (i) {
      var f = i.planned_finish;
      var p = projects[i.project_id];
      var line = { text: p.code + ' · ' + i.name, date: f, url: link('gantt', i.project_id) };
      if (!isBlank(f) && f < today) late.push(line);
      else if (!isBlank(f) && f <= soon) due.push(line);
      if (i.item_type === 'Livrable' && Number(i.progress_pct) > 0) {
        var last = !isBlank(i.last_progress_at) ? String(i.last_progress_at).slice(0, 10) : String(i.created_at || '').slice(0, 10);
        if (last && last < staleLimit) stale.push({ text: p.code + ' · ' + i.name, date: last, url: link('gantt', i.project_id) });
      }
    });
    var byDate = function (a, b) { return String(a.date).localeCompare(String(b.date)); };
    if (late.length) sections.push({ title: 'En retard', tone: 'alert', lines: late.sort(byDate).map(function (l) { return Object.assign(l, { note: 'fin prévue le ' + frDate_(l.date) }); }) });
    if (due.length) sections.push({ title: 'À échéance dans les ' + THRESHOLDS.dueSoonDays + ' jours', lines: due.sort(byDate).map(function (l) { return Object.assign(l, { note: 'le ' + frDate_(l.date) }); }) });
    if (stale.length) sections.push({ title: 'Avancement à déclarer', lines: stale.sort(byDate).map(function (l) { return Object.assign(l, { note: 'dernière déclaration le ' + frDate_(l.date) }); }) });

    // 1b. Mes GR à faire : PO lancées dont la date de GR attendue est passée ou approche (aucun montant dans le mail)
    var resNames = {};
    data.resources.forEach(function (x) { resNames[x.id] = x.name; });
    var grLines = (data.purchaseOrders || []).filter(function (o) {
      return live(o) && o.status === 'Lancée' && !isBlank(o.gr_due_date) && String(o.gr_due_date) <= soon &&
        (o.owner_resource_id === r.id || (isBlank(o.owner_resource_id) && String(o.created_by || '').toLowerCase() === email));
    }).sort(function (a, b) { return String(a.gr_due_date).localeCompare(String(b.gr_due_date)); }).map(function (o) {
      var late = String(o.gr_due_date) < today, pid = (data.cpnProject || {})[normCpn_(o.cpn)];
      return { text: 'PO ' + o.po_number + (resNames[o.resource_id] ? ' · ' + resNames[o.resource_id] : ''), tone: late ? 'alert' : '',
        note: late ? 'GR à faire, attendue depuis le ' + frDate_(o.gr_due_date) : 'GR attendue le ' + frDate_(o.gr_due_date), url: pid ? link('budget', pid, '&tab=po') : '' };
    });
    if (grLines.length) sections.push({ title: 'Bons de réception (GR) à faire', tone: grLines.some(function (l) { return l.tone === 'alert'; }) ? 'alert' : '', lines: grLines });

    // 2. Pilotage : projets dont la personne valide les changements (chef de projet, DPL)
    var ctx = { resourceId: r.id, isAdmin: false, assignments: activeAssignments(r.id, data.assignments, today), lookup: lookup };
    var pilot = data.projects.filter(function (p) {
      return activeProject(p.id) && (p.manager_resource_id === r.id || can(ctx, 'changes.ack', { type: 'project', id: p.id }));
    }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); });
    var pilotLines = [];
    pilot.forEach(function (p) {
      var n = (data.pendingChanges || {})[p.id] || 0;
      if (n) pilotLines.push({ text: p.code + ' · ' + n + (n > 1 ? ' changements' : ' changement') + ' sur des données figées', note: 'à valider', url: link('suivi', p.id, '&tab=changes') });
      (data.baselines || []).filter(function (b) { return live(b) && b.project_id === p.id && b.status === 'Demandée'; }).forEach(function (b) {
        pilotLines.push({ text: p.code + ' · demande de baseline de ' + b.requested_by, note: truncate(b.justification, 140), url: link('suivi', p.id, '&tab=baselines') });
      });
      var ins = (data.insights || []).filter(function (x) { return live(x) && x.project_id === p.id && x.status === 'Nouveau'; });
      var alerts = ins.filter(function (x) { return x.severity === 'Alerte'; });
      alerts.slice(0, 3).forEach(function (x) { pilotLines.push({ text: p.code + ' · ' + x.message, tone: 'alert', url: link('gantt', p.id) }); });
      var others = ins.length - Math.min(3, alerts.length);
      if (others > 0) pilotLines.push({ text: p.code + ' · ' + others + (others > 1 ? ' autres constats' : ' autre constat') + ' du moteur de règles', url: link('suivi', p.id) });
    });
    if (pilotLines.length) sections.push({ title: 'Pilotage de vos projets', lines: pilotLines });

    // 3. Mes demandes de baseline tranchées
    var decided = (data.baselines || []).filter(function (b) {
      return live(b) && String(b.requested_by).toLowerCase() === email && String(b.decided_by).toLowerCase() !== email &&
        (b.status === 'Refusée' || b.status === 'Active' || b.status === 'Archivée') && String(b.decided_at).slice(0, 10) >= windowStart;
    });
    if (decided.length) {
      sections.push({ title: 'Vos demandes de baseline', lines: decided.map(function (b) {
        var p = projects[b.project_id] || { code: '' };
        return { text: p.code + ' · ' + (b.status === 'Refusée' ? 'refusée' : 'acceptée : ' + (b.label || 'B' + b.number)), note: 'par ' + b.decided_by, url: link('suivi', b.project_id, '&tab=baselines') };
      }) });
    }

    if (!sections.length && !opts.onlyEmail) return;
    var count = sections.reduce(function (a, s) { return a + s.lines.length; }, 0);
    var subject = (freq === 'Hebdomadaire' && !opts.onlyEmail ? 'Votre point de la semaine' : 'Votre point du ' + frDate_(today)) +
      (count ? ' — ' + count + (count > 1 ? ' éléments' : ' élément') : '');
    out.push(Object.assign({ to: email, subject: subject, counts: { lines: count, late: late.length } }, renderDigest_(r, sections, opts)));
  });
  return out;
}

/** Les constats du moteur de règles citent des dates AAAA-MM-JJ : on les écrit à la française. */
function frDatesIn_(s) {
  return String(s).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

function renderDigest_(person, sections, opts) {
  var text = ['Bonjour ' + person.name + ',', ''];
  var html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2A33;max-width:640px">',
    '<p>Bonjour ' + escHtml_(person.name) + ',</p>'];
  if (!sections.length) {
    text.push('Rien à signaler aujourd’hui.');
    html.push('<p>Rien à signaler aujourd’hui.</p>');
  }
  sections.forEach(function (s) {
    text.push(s.title.toUpperCase());
    html.push('<h3 style="font-size:15px;margin:18px 0 6px;color:' + (s.tone === 'alert' ? '#B3261E' : '#2B3A48') + '">' + escHtml_(s.title) + '</h3><ul style="margin:0;padding-left:18px">');
    s.lines.slice(0, DIGEST_MAX_LINES).forEach(function (l) {
      l.text = frDatesIn_(l.text);
      text.push('- ' + l.text + (l.note ? ' (' + l.note + ')' : '') + (l.url ? '\n  ' + l.url : ''));
      var label = escHtml_(l.text);
      html.push('<li style="margin:3px 0' + (l.tone === 'alert' ? ';color:#B3261E' : '') + '">' +
        (l.url ? '<a href="' + escHtml_(l.url) + '" style="color:inherit">' + label + '</a>' : label) +
        (l.note ? ' <span style="color:#5B6B7A">— ' + escHtml_(l.note) + '</span>' : '') + '</li>');
    });
    if (s.lines.length > DIGEST_MAX_LINES) {
      var more = s.lines.length - DIGEST_MAX_LINES;
      text.push('- … et ' + more + ' autre(s)');
      html.push('<li style="color:#5B6B7A">… et ' + more + ' autre(s)</li>');
    }
    html.push('</ul>');
    text.push('');
  });
  var foot = 'Ce récapitulatif remplace les notifications une à une. Fréquence : Mon compte, onglet Notifications.';
  text.push(foot);
  html.push('<p style="margin-top:22px;font-size:12px;color:#5B6B7A">' + escHtml_(foot) +
    (opts.baseUrl ? ' <a href="' + escHtml_(opts.baseUrl + '?view=compte&tab=notifications') + '" style="color:#5B6B7A">Ouvrir</a>' : '') + '</p></div>');
  return { text: text.join('\n'), html: html.join('') };
}

function loadDigestData_() {
  var projects = repoList('Project');
  return {
    projects: projects, planitems: repoList('PlanItem'), resources: repoList('Resource'),
    assignments: repoList('RoleAssignment'), settings: repoList('UserSetting'), insights: repoList('Insight'),
    baselines: repoList('Baseline'), workpackages: repoList('WorkPackage'), budgetLines: repoList('BudgetLine'),
    pendingChanges: pendingChangeCounts_(projects, repoList('ChangeEvent')),
    purchaseOrders: repoList('PurchaseOrder', function (o) { return o.status === 'Lancée'; }),
    cpnProject: (function () { var m = {}, idx = cpnIndex_(); Object.keys(idx).forEach(function (k) { m[k] = idx[k].project.id; }); return m; })()
  };
}

/** Envoi d'un mail au format texte et HTML ; capturé dans les tests. */
function sendMail_(to, subject, text, html) {
  var full = mailSubject_(subject);
  if (SENT_MAILS) { SENT_MAILS.push({ to: to, subject: full, body: text, html: html }); return true; }
  if (typeof MailApp === 'undefined') { console.log('[mail] ' + to + ' — ' + full); return false; }
  MailApp.sendEmail({ to: to, subject: mailSubject_(subject), body: text, htmlBody: html, name: 'PPM' });
  return true;
}

/** Déclencheur du matin (7 h, jours de semaine) : un mail par personne concernée, dans la limite du quota du jour. */
function sendDigests() {
  resetExecution_();
  var today = todayStr();
  var wd = weekdayOf(today);
  if (wd === 0 || wd === 6) return 'Week-end : pas de récapitulatif.';
  var digests = buildDigests(loadDigestData_(), today, { baseUrl: getProp(PROP.WEBAPP_URL, ''), weekly: wd === 1 });
  var quota = typeof MailApp !== 'undefined' ? MailApp.getRemainingDailyQuota() : Infinity;
  var sent = 0, skipped = 0;
  digests.forEach(function (d) {
    if (sent >= quota - 20) { skipped++; return; } // garde une marge pour les alertes du jour
    if (sendMail_(d.to, d.subject, d.text, d.html)) sent++;
  });
  if (skipped) {
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Récapitulatifs non envoyés', skipped + ' récapitulatif(s) non envoyé(s) : quota de mails du jour atteint.');
    });
  }
  setProp(PROP.LAST_DIGEST, JSON.stringify({ at: nowIso(), sent: sent, skipped: skipped }));
  var msg = sent + ' récapitulatif(s) envoyé(s)' + (skipped ? ', ' + skipped + ' reporté(s) (quota).' : '.');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- réglages personnels et aperçu

defineAction('settings.get', function (p, ctx) {
  var row = userSettingRow_(ctx.email);
  return {
    notify_frequency: (row && row.notify_frequency) || 'Quotidien',
    calendar_invites: !!(row && isTrue(row.calendar_invites)),
    reminder_off: reminderSettingsView_(row).reminder_off, reminder_days: reminderSettingsView_(row).reminder_days, reminder_default: reminderDefaults_(),
    email: ctx.email, hasResource: !!ctx.resourceId
  };
});

defineAction('settings.set', function (p, ctx) {
  var patch = {};
  if (p.notify_frequency !== undefined) {
    if (['Quotidien', 'Hebdomadaire', 'Aucun'].indexOf(p.notify_frequency) < 0) throw new PpmError('VALIDATION', 'Fréquence inconnue.');
    patch.notify_frequency = p.notify_frequency;
  }
  if (p.calendar_invites !== undefined) patch.calendar_invites = !!p.calendar_invites;
  if (p.reminder_off !== undefined) patch.reminder_off = !!p.reminder_off;
  if (p.reminder_days !== undefined) {
    if (p.reminder_days === null || String(p.reminder_days).trim() === '') patch.reminder_days = '';
    else {
      var n = Number(p.reminder_days);
      if (isNaN(n) || Math.floor(n) !== n || n < 1 || n > 60) throw new PpmError('VALIDATION', 'Délai du rappel : un nombre entier de jours ouvrés entre 1 et 60.');
      patch.reminder_days = n;
    }
  }
  var row = userSettingRow_(ctx.email);
  if (row) repoUpdate('UserSetting', row.id, patch, null, ctx.actx);
  else repoInsert('UserSetting', Object.assign({ user_email: ctx.email }, patch), ctx.actx);
  return API_ACTIONS['settings.get']({}, ctx);
});

/** Aperçu de son propre récapitulatif ; send = true l'envoie aussitôt à soi-même (pour essayer). */
defineAction('digest.preview', function (p, ctx) {
  var list = buildDigests(loadDigestData_(), todayStr(), { baseUrl: getProp(PROP.WEBAPP_URL, ''), onlyEmail: ctx.email });
  if (!list.length) {
    return { subject: '', html: '', text: '', empty: true, sent: false,
      reason: ctx.resourceId ? 'Votre adresse n’est pas dans le domaine.' : 'Aucune fiche de personne n’a votre adresse : créez-la dans AppSheet.' };
  }
  var d = list[0];
  var sent = p.send ? sendMail_(d.to, d.subject + ' (essai)', d.text, d.html) : false;
  return { subject: mailSubject_(d.subject), html: d.html, text: d.text, empty: d.counts.lines === 0, sent: sent };
});
