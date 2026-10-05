/**
 * PPM Core — lot 2 : intégration Google Workspace (section 8).
 *
 *  - Agenda Google par projet : un événement « journée entière » par jalon et par échéance de livrable,
 *    tenu à jour quand un élément est créé, déplacé ou supprimé. Partagé en lecture aux membres du projet.
 *    Sur option, le responsable d'un livrable est invité à son échéance (réglage personnel).
 *  - Dossier Drive par projet, un sous-dossier par WP (les sous-WP sont imbriqués), partagé aux membres.
 *    Un WP supprimé ne supprime jamais son dossier : les fichiers restent.
 *  - Annuaire : complète nom, fonction et organisation d'une personne à partir de son adresse ;
 *    import d'une liste de personnes depuis une feuille Google Sheets.
 *
 * Tous les appels passent par l'adaptateur ws_() : en production les services Google (compte propriétaire),
 * dans les tests un faux (variable WORKSPACE). Les identifiants externes et l'empreinte du dernier envoi
 * sont gardés dans la table SyncLink : une mise à jour modifie l'existant au lieu de dupliquer,
 * et rien n'est renvoyé si rien n'a changé.
 */

var WORKSPACE = null;

function ws_() {
  return WORKSPACE || realWorkspace_();
}

/** Date AAAA-MM-JJ → Date à minuit dans le fuseau du script (ce qu'attend un événement « journée entière »). */
function localDate_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function realWorkspace_() {
  var hasCalendar = typeof CalendarApp !== 'undefined';
  var hasDrive = typeof DriveApp !== 'undefined';
  return {
    available: hasCalendar && hasDrive,
    calendar: {
      create: function (name) {
        return CalendarApp.createCalendar(name, { timeZone: Session.getScriptTimeZone(), summary: 'Jalons et échéances, tenus à jour par PPM.' }).getId();
      },
      url: function (id) { return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(id); },
      upsert: function (calId, eventId, ev) {
        var cal = CalendarApp.getCalendarById(calId);
        if (!cal) throw new PpmError('CONFIG', 'Agenda introuvable : ' + calId);
        var e = eventId ? cal.getEventById(eventId) : null;
        if (e) {
          e.setTitle(ev.title);
          e.setAllDayDate(localDate_(ev.date));
          e.setDescription(ev.description);
          var have = {};
          e.getGuestList().forEach(function (g) { have[g.getEmail().toLowerCase()] = true; });
          ev.guests.forEach(function (g) { if (!have[g]) e.addGuest(g); });
          Object.keys(have).forEach(function (g) { if (ev.guests.indexOf(g) < 0) e.removeGuest(g); });
          return e.getId();
        }
        return cal.createAllDayEvent(ev.title, localDate_(ev.date),
          { description: ev.description, guests: ev.guests.join(','), sendInvites: false }).getId();
      },
      remove: function (calId, eventId) {
        var cal = CalendarApp.getCalendarById(calId);
        var e = cal ? cal.getEventById(eventId) : null;
        if (e) e.deleteEvent();
      },
      /** Partage en lecture (service avancé Calendar) ; -1 si le service n'est pas activé. */
      share: function (calId, emails) {
        if (typeof Calendar === 'undefined' || !Calendar.Acl) return -1;
        var have = {};
        (Calendar.Acl.list(calId).items || []).forEach(function (r) {
          if (r.scope && r.scope.type === 'user') have[String(r.scope.value).toLowerCase()] = true;
        });
        var added = 0;
        emails.forEach(function (m) {
          if (have[m]) return;
          Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: m } }, calId, { sendNotifications: false });
          added++;
        });
        return added;
      }
    },
    drive: {
      root: function () {
        var id = getProp(PROP.PROJECTS_FOLDER, '');
        if (id) return id;
        id = DriveApp.createFolder('PPM Projets').getId();
        setProp(PROP.PROJECTS_FOLDER, id);
        return id;
      },
      url: function (id) { return 'https://drive.google.com/drive/folders/' + id; },
      /** Crée le dossier, ou renomme et déplace le dossier existant ; renvoie son identifiant. */
      ensureFolder: function (parentId, name, folderId) {
        var parent = DriveApp.getFolderById(parentId);
        if (folderId) {
          try {
            var f = DriveApp.getFolderById(folderId);
            if (!f.isTrashed()) {
              if (f.getName() !== name) f.setName(name);
              var inParent = false, it = f.getParents();
              while (it.hasNext()) if (it.next().getId() === parentId) inParent = true;
              if (!inParent) f.moveTo(parent);
              return f.getId();
            }
          } catch (err) { /* dossier supprimé ou inaccessible : recréé */ }
        }
        return parent.createFolder(name).getId();
      },
      share: function (folderId, emails) {
        var f = DriveApp.getFolderById(folderId);
        var have = {};
        f.getEditors().forEach(function (u) { have[u.getEmail().toLowerCase()] = true; });
        try { have[f.getOwner().getEmail().toLowerCase()] = true; } catch (err) { /* Drive partagé : pas de propriétaire */ }
        var missing = emails.filter(function (m) { return !have[m]; });
        if (missing.length) f.addEditors(missing);
        return missing.length;
      }
    },
    directory: {
      /** Annuaire du domaine (service avancé Admin SDK, facultatif) ; null si indisponible. */
      lookup: function (email) {
        if (typeof AdminDirectory === 'undefined') return null;
        try {
          var u = AdminDirectory.Users.get(email, { viewType: 'domain_public' });
          var org = (u.organizations || [])[0] || {};
          return { name: u.name ? u.name.fullName || '' : '', job_function: org.title || '', organization: org.department || '' };
        } catch (err) {
          return null;
        }
      }
    }
  };
}

// ---------------------------------------------------------------- liens (table SyncLink)

function loadLinks_() {
  var t = getTable('SyncLink');
  var byId = {};
  t.readAll().forEach(function (r, i) { byId[r.id] = { row: i + 2, rec: r }; });
  return { table: t, byId: byId, dirty: {}, fresh: [] };
}

function setLink_(links, id, values) {
  var cur = links.byId[id];
  var rec = Object.assign({ id: id }, cur ? cur.rec : {}, values, { synced_at: nowIso() });
  if (cur) { cur.rec = rec; links.dirty[id] = cur; } else { links.byId[id] = { row: -1, rec: rec }; links.fresh.push(rec); }
}

function saveLinks_(links) {
  var updates = Object.keys(links.dirty).map(function (id) { return { row: links.dirty[id].row, obj: links.dirty[id].rec }; });
  if (updates.length) links.table.updateRows(updates);
  if (links.fresh.length) links.table.appendRows(links.fresh);
  links.dirty = {};
  links.fresh = [];
}

// ---------------------------------------------------------------- membres d'un projet

/**
 * Adresses du domaine qui travaillent sur le projet : chef de projet, rôles sur le projet, ses WP ou son programme,
 * responsables de WP et de livrables. Personnes supprimées ou sans adresse du domaine exclues.
 */
function projectMembers_(data, projectId, today) {
  var project = indexBy_(data.projects)[projectId];
  if (!project) return [];
  var wpIds = {};
  data.workpackages.forEach(function (w) { if (w.project_id === projectId) wpIds[w.id] = true; });
  var people = {};
  if (!isBlank(project.manager_resource_id)) people[project.manager_resource_id] = true;
  data.workpackages.forEach(function (w) { if (wpIds[w.id] && !isBlank(w.owner_resource_id)) people[w.owner_resource_id] = true; });
  data.planitems.forEach(function (i) { if (i.project_id === projectId && !isBlank(i.owner_resource_id)) people[i.owner_resource_id] = true; });
  (data.assignments || []).forEach(function (a) {
    if (isTrue(a.deleted)) return;
    if (!isBlank(a.end_date) && String(a.end_date) < today) return;
    var hit = (a.scope_type === 'project' && a.scope_id === projectId) || (a.scope_type === 'workpackage' && wpIds[a.scope_id]) ||
      (a.scope_type === 'program' && !isBlank(project.program_id) && a.scope_id === project.program_id);
    if (hit) people[a.resource_id] = true;
  });
  var domains = allowedDomains();
  var res = indexBy_(data.resources);
  var out = {};
  Object.keys(people).forEach(function (id) {
    var r = res[id];
    if (!r || isTrue(r.deleted) || isBlank(r.email)) return;
    var m = String(r.email).toLowerCase();
    if (!domains.length || isAllowedEmail_(m)) out[m] = true;
  });
  return Object.keys(out).sort();
}

// ---------------------------------------------------------------- agenda

/** Événements voulus pour un projet : un par jalon et par échéance de livrable datés. */
function desiredEvents_(data, project, baseUrl) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages);
  var invites = {};
  (data.settings || []).forEach(function (s) { if (isTrue(s.calendar_invites)) invites[String(s.user_email).toLowerCase()] = true; });
  var out = {};
  data.planitems.forEach(function (i) {
    if (i.project_id !== project.id || isTrue(i.deleted) || isBlank(i.planned_finish)) return;
    var done = i.status === 'Terminé' || Number(i.progress_pct) >= 100;
    var owner = res[i.owner_resource_id];
    var wp = wps[i.wp_id];
    var title = (done ? '✓ ' : '') + (i.item_type === 'Jalon' ? '◆ ' : 'Échéance · ') + project.code + ' · ' + i.name;
    var lines = ['Projet ' + project.code + ' — ' + project.name];
    if (wp) lines.push('Workpackage ' + (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name);
    if (owner) lines.push('Responsable : ' + owner.name);
    if (i.item_type === 'Livrable' && !isBlank(i.planned_start)) lines.push('Début prévu : ' + i.planned_start);
    if (baseUrl) lines.push('Planning : ' + baseUrl + '?view=gantt&project=' + project.id);
    lines.push('Événement tenu à jour par PPM : les modifications faites ici seront écrasées.');
    var guests = [];
    if (owner && !isBlank(owner.email) && invites[String(owner.email).toLowerCase()]) guests.push(String(owner.email).toLowerCase());
    out[i.id] = { title: title, date: i.planned_finish, description: lines.join('\n'), guests: guests };
  });
  return out;
}

function syncProjectCalendar_(data, project, links, report, baseUrl) {
  if (isBlank(project.calendar_id)) return;
  var wanted = desiredEvents_(data, project, baseUrl);
  Object.keys(wanted).forEach(function (itemId) {
    try {
      syncOneEvent_(project, itemId, wanted[itemId], links, report);
    } catch (err) {
      report.errors.push('Agenda, « ' + wanted[itemId].title + ' » : ' + (err && err.message ? err.message : err));
    }
  });
  Object.keys(links.byId).forEach(function (id) {
    var l = links.byId[id].rec;
    if (l.kind !== 'calendar' || l.project_id !== project.id || isBlank(l.external_id) || wanted[l.entity_id]) return;
    try {
      ws_().calendar.remove(l.container_id, l.external_id);
      setLink_(links, id, { external_id: '', hash: 'REMOVED' });
      report.removed++;
    } catch (err) {
      report.errors.push('Agenda, suppression : ' + (err && err.message ? err.message : err));
    }
  });
  syncProjectReminders_(data, project, links, report, baseUrl);
}

/** Crée ou met à jour un événement ; ne fait rien si son contenu n'a pas changé depuis le dernier envoi. */
function syncOneEvent_(project, itemId, ev, links, report, kind) {
  kind = kind || 'calendar';
  var id = (kind === 'reminder' ? 'rem:' : 'cal:') + itemId;
  var link = links.byId[id] ? links.byId[id].rec : null;
  var hash = hashString(project.calendar_id + '|' + JSON.stringify(ev));
  var sameCal = link && link.container_id === project.calendar_id && !isBlank(link.external_id);
  if (sameCal && link.hash === hash) return;
  var eventId = ws_().calendar.upsert(project.calendar_id, sameCal ? link.external_id : '', ev);
  setLink_(links, id, { kind: kind, entity_id: itemId, project_id: project.id, container_id: project.calendar_id, external_id: eventId, hash: hash });
  report[sameCal ? 'updated' : 'created']++;
}

// ---------------------------------------------------------------- rappels avant livraison

var REMINDER_DEFAULT_DAYS = 10;

/** Réglage de l'administrateur : rappels actifs (par défaut oui) et délai par défaut en jours ouvrés (par défaut 10). */
function reminderDefaults_() {
  var on = String(getProp(PROP.REMINDER_ON, 'oui')).toLowerCase() !== 'non';
  var d = Number(getProp(PROP.REMINDER_DAYS, String(REMINDER_DEFAULT_DAYS)));
  return { on: on, days: d >= 1 && d <= 60 && Math.floor(d) === d ? d : REMINDER_DEFAULT_DAYS };
}

/** Rappel voulu pour une personne : null si désactivé (par l'administrateur ou par elle), sinon son délai (le sien, à défaut celui par défaut). */
function reminderFor_(setting) {
  var def = reminderDefaults_();
  if (!def.on || (setting && isTrue(setting.reminder_off))) return null;
  var d = setting && !isBlank(setting.reminder_days) ? Number(setting.reminder_days) : def.days;
  return { days: d >= 1 && d <= 60 ? d : def.days };
}

function reminderSettingsView_(row) {
  return {
    reminder_off: !!(row && isTrue(row.reminder_off)),
    reminder_days: row && !isBlank(row.reminder_days) ? Number(row.reminder_days) : null,
    reminder_default: reminderDefaults_()
  };
}

/**
 * Un rappel par livrable non terminé, daté N jours ouvrés avant sa livraison, dans l'agenda du projet, avec son responsable invité :
 * il apparaît dans le Google Agenda du responsable. (Une vraie tâche Google ne peut pas être créée dans la liste d'un autre utilisateur.)
 * Un rappel déjà créé dont la date est passée est conservé ; on n'en crée pas de nouveau pour une date passée.
 */
function desiredReminders_(data, project, today, links, baseUrl) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages), settings = {};
  (data.settings || []).forEach(function (s) { settings[String(s.user_email).toLowerCase()] = s; });
  var hol = loadHolidayMap(project.holiday_country || 'FR');
  var domains = allowedDomains();
  var out = {};
  data.planitems.forEach(function (i) {
    if (i.project_id !== project.id || isTrue(i.deleted) || i.item_type !== 'Livrable' || isBlank(i.planned_finish)) return;
    if (i.status === 'Terminé' || Number(i.progress_pct) >= 100) return;
    var owner = res[i.owner_resource_id];
    if (!owner || isTrue(owner.deleted) || isBlank(owner.email)) return;
    var email = String(owner.email).toLowerCase();
    if (domains.length && !isAllowedEmail_(email)) return;
    var rem = reminderFor_(settings[email]);
    if (!rem) return;
    var date = addWorkingDays(i.planned_finish, -rem.days, hol);
    var link = links && links.byId['rem:' + i.id] ? links.byId['rem:' + i.id].rec : null;
    if (date < today && !(link && !isBlank(link.external_id))) return;
    var wp = wps[i.wp_id];
    var lines = ['Livrable à préparer : la livraison est prévue le ' + frDate_(i.planned_finish) + ' (dans ' + rem.days + ' jours ouvrés).',
      'Projet ' + project.code + ' — ' + project.name];
    if (wp) lines.push('Workpackage ' + (wp.wbs_code ? wp.wbs_code + ' ' : '') + wp.name);
    if (baseUrl) lines.push('Planning : ' + baseUrl + '?view=gantt&project=' + project.id);
    lines.push('Rappel tenu à jour par PPM : les modifications faites ici seront écrasées.');
    out[i.id] = { title: 'Rappel livraison · ' + project.code + ' · ' + i.name, date: date, description: lines.join('\n'), guests: [email] };
  });
  return out;
}

function removeReminder_(links, itemId, report) {
  var l = links.byId['rem:' + itemId];
  if (!l || isBlank(l.rec.external_id)) return;
  ws_().calendar.remove(l.rec.container_id, l.rec.external_id);
  setLink_(links, 'rem:' + itemId, { external_id: '', hash: 'REMOVED' });
  report.removed = (report.removed || 0) + 1;
}

function syncProjectReminders_(data, project, links, report, baseUrl) {
  var wanted = desiredReminders_(data, project, todayStr(), links, baseUrl);
  Object.keys(wanted).forEach(function (itemId) {
    try {
      syncOneEvent_(project, itemId, wanted[itemId], links, report, 'reminder');
    } catch (err) {
      report.errors.push('Rappel, « ' + wanted[itemId].title + ' » : ' + (err && err.message ? err.message : err));
    }
  });
  Object.keys(links.byId).forEach(function (id) {
    var l = links.byId[id].rec;
    if (l.kind !== 'reminder' || l.project_id !== project.id || isBlank(l.external_id) || wanted[l.entity_id]) return;
    try {
      removeReminder_(links, l.entity_id, report);
    } catch (err) {
      report.errors.push('Rappel, suppression : ' + (err && err.message ? err.message : err));
    }
  });
}

/**
 * Mise à jour immédiate de l'événement d'un élément (création ou déplacement), sans attendre la nuit.
 * Une panne de l'agenda ne bloque jamais la saisie : la synchronisation nocturne rattrape (et gère les suppressions).
 */
function hookCalendarItem(before, rec) {
  var fields = ['name', 'planned_finish', 'item_type', 'owner_resource_id', 'status', 'wp_id'];
  var crossedDone = !!before && ((Number(before.progress_pct) >= 100) !== (Number(rec.progress_pct) >= 100));
  if (before && !crossedDone && !fields.some(function (f) { return String(before[f]) !== String(rec[f]); })) return;
  try {
    if (!ws_().available) return;
    var project = repoGet('Project', rec.project_id);
    if (!project || isBlank(project.calendar_id)) return;
    var data = { planitems: [rec], resources: repoList('Resource'), workpackages: repoList('WorkPackage'), settings: repoList('UserSetting') };
    var baseUrl = getProp(PROP.WEBAPP_URL, '');
    var links = loadLinks_();
    var wanted = desiredEvents_(data, project, baseUrl);
    if (wanted[rec.id]) syncOneEvent_(project, rec.id, wanted[rec.id], links, { created: 0, updated: 0 });
    if (rec.item_type === 'Livrable' || (before && before.item_type === 'Livrable')) {
      var rem = desiredReminders_(data, project, todayStr(), links, baseUrl);
      if (rem[rec.id]) syncOneEvent_(project, rec.id, rem[rec.id], links, { created: 0, updated: 0 }, 'reminder');
      else removeReminder_(links, rec.id, { removed: 0 });
    }
    saveLinks_(links);
  } catch (err) {
    console.error('Agenda : ' + (err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------- Drive

function folderName_(s) {
  return String(s).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sans nom';
}

function syncProjectDrive_(data, project, links, report) {
  if (isBlank(project.drive_folder_id)) return;
  var w = ws_();
  var wps = data.workpackages.filter(function (x) { return x.project_id === project.id && !isTrue(x.deleted); });
  var byId = indexBy_(wps);
  var depth = function (x) { var d = 0, c = x; while (c && !isBlank(c.parent_wp_id) && byId[c.parent_wp_id] && d < 20) { d++; c = byId[c.parent_wp_id]; } return d; };
  wps.sort(function (a, b) { return depth(a) - depth(b) || byWbs_(a, b); });
  var folderOf = {};
  wps.forEach(function (x) {
    var parentFolder = !isBlank(x.parent_wp_id) && folderOf[x.parent_wp_id] ? folderOf[x.parent_wp_id] : project.drive_folder_id;
    var name = folderName_((x.wbs_code ? x.wbs_code + ' ' : '') + x.name);
    var id = 'drive:' + x.id;
    var link = links.byId[id] ? links.byId[id].rec : null;
    var hash = hashString(parentFolder + '|' + name);
    if (link && !isBlank(link.external_id) && link.hash === hash) { folderOf[x.id] = link.external_id; return; }
    try {
      var fid = w.drive.ensureFolder(parentFolder, name, link ? link.external_id : '');
      folderOf[x.id] = fid;
      setLink_(links, id, { kind: 'drive', entity_id: x.id, project_id: project.id, container_id: parentFolder, external_id: fid, hash: hash });
      report.folders++;
    } catch (err) {
      report.errors.push('Drive, « ' + name + ' » : ' + (err && err.message ? err.message : err));
    }
  });
}

/** Agenda, dossiers et partages d'un projet. */
function syncProjectWorkspace_(project, data, links) {
  var report = { created: 0, updated: 0, removed: 0, folders: 0, shared: 0, errors: [] };
  var w = ws_();
  if (!w.available) { report.errors.push('Services Google indisponibles.'); return report; }
  data = data || loadWorkspaceData_();
  var own = !links;
  links = links || loadLinks_();
  var baseUrl = getProp(PROP.WEBAPP_URL, '');
  syncProjectCalendar_(data, project, links, report, baseUrl);
  syncProjectDrive_(data, project, links, report);
  var members = projectMembers_(data, project.id, todayStr());
  if (!isBlank(project.calendar_id)) {
    try {
      var n = w.calendar.share(project.calendar_id, members);
      if (n < 0) report.errors.push('Partage de l’agenda : activer le service avancé « Google Calendar API » (voir le README).');
      else report.shared += n;
    } catch (err) { report.errors.push('Partage de l’agenda : ' + (err && err.message ? err.message : err)); }
  }
  if (!isBlank(project.drive_folder_id)) {
    try { report.shared += w.drive.share(project.drive_folder_id, members); } catch (err) {
      report.errors.push('Partage du dossier : ' + (err && err.message ? err.message : err));
    }
  }
  if (own) saveLinks_(links);
  report.members = members.length;
  return report;
}

function loadWorkspaceData_() {
  return {
    projects: repoList('Project'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    resources: repoList('Resource'), assignments: repoList('RoleAssignment'), settings: repoList('UserSetting')
  };
}

/** Traitement nocturne : tous les projets reliés à Workspace, par tranches. */
function syncWorkspaceAll(state, deadlineMs) {
  if (!ws_().available) return true;
  var data = loadWorkspaceData_();
  var projects = data.projects.filter(function (p) {
    return p.status !== 'Clos' && (!isBlank(p.calendar_id) || !isBlank(p.drive_folder_id));
  }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  state.index = state.index || 0;
  var links = loadLinks_();
  var errors = [];
  while (state.index < projects.length) {
    if (nowMs() > deadlineMs) { saveLinks_(links); return false; }
    var r = syncProjectWorkspace_(projects[state.index], data, links);
    r.errors.forEach(function (e) { errors.push(projects[state.index].code + ' : ' + e); });
    state.index++;
  }
  saveLinks_(links);
  if (errors.length) {
    adminEmails().forEach(function (a) {
      notifyUser(a, 'Synchronisation Agenda et Drive : ' + errors.length + ' erreur(s)', errors.slice(0, 50).join('\n'));
    });
  }
  return true;
}

function workspaceStatus_(project, report) {
  var w = ws_();
  return {
    project_id: project.id,
    calendar_id: project.calendar_id || '', calendar_url: project.calendar_id && w.calendar.url ? w.calendar.url(project.calendar_id) : '',
    drive_folder_id: project.drive_folder_id || '', drive_url: project.drive_folder_id && w.drive.url ? w.drive.url(project.drive_folder_id) : '',
    report: report || null
  };
}

defineAction('workspace.status', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  var st = workspaceStatus_(project, null);
  st.canManage = can(ctx, 'workspace.manage', { type: 'project', id: project.id });
  st.available = ws_().available;
  return st;
});

/** Crée l'agenda et le dossier du projet s'ils n'existent pas, puis synchronise (réservé au pilotage du projet). */
defineAction('workspace.enable', function (p, ctx) {
  var projectId = requireParam(p, 'projectId');
  var project = mustGet('Project', projectId);
  requireCan(ctx, 'workspace.manage', { type: 'project', id: projectId });
  var w = ws_();
  if (!w.available) throw new PpmError('CONFIG', 'Les services Google Agenda et Drive ne sont pas disponibles.');
  var patch = {};
  if (p.calendar !== false && isBlank(project.calendar_id)) patch.calendar_id = w.calendar.create('PPM · ' + project.code + ' ' + project.name);
  if (p.drive !== false && isBlank(project.drive_folder_id)) {
    patch.drive_folder_id = w.drive.ensureFolder(w.drive.root(), folderName_(project.code + ' — ' + project.name), '');
  }
  if (Object.keys(patch).length) project = repoUpdate('Project', projectId, patch, null, ctx.actx);
  return workspaceStatus_(project, syncProjectWorkspace_(project));
});

defineAction('workspace.sync', function (p, ctx) {
  var project = mustGet('Project', requireParam(p, 'projectId'));
  requireCan(ctx, 'workspace.manage', { type: 'project', id: project.id });
  return workspaceStatus_(project, syncProjectWorkspace_(project));
});

// ---------------------------------------------------------------- annuaire et import de personnes

/** Complète une fiche à partir de l'annuaire, sans jamais écraser une valeur saisie. */
function fillFromDirectory_(values) {
  if (isBlank(values.email)) return values;
  var found = ws_().directory.lookup(String(values.email).toLowerCase());
  if (!found) return values;
  var out = Object.assign({}, values);
  ['name', 'job_function', 'organization'].forEach(function (k) {
    if (isBlank(out[k]) && !isBlank(found[k])) out[k] = String(found[k]).slice(0, TEXT_MAX_LENGTH[k] || 200);
  });
  if (isBlank(out.resource_type)) out.resource_type = 'Interne';
  return out;
}

/** Nuit : complète les fiches incomplètes à partir de l'annuaire (au plus 200 par nuit). */
function refreshPeopleFromDirectory() {
  if (!WORKSPACE && typeof AdminDirectory === 'undefined') return 0;
  var n = 0;
  repoList('Resource', function (r) { return !isBlank(r.email) && (isBlank(r.job_function) || isBlank(r.organization)); })
    .slice(0, 200).forEach(function (r) {
      var filled = fillFromDirectory_(r);
      var patch = {};
      ['job_function', 'organization'].forEach(function (k) { if (filled[k] !== r[k]) patch[k] = filled[k]; });
      if (Object.keys(patch).length) { repoUpdate('Resource', r.id, patch, null, { actor: 'ppm-core', source: 'annuaire' }); n++; }
    });
  return n;
}

var PEOPLE_HEADERS = {
  name: ['nom', 'name', 'nom complet', 'full name', 'prenom nom', 'personne'],
  email: ['e-mail', 'email', 'mail', 'adresse', 'adresse e-mail', 'courriel'],
  job_function: ['fonction', 'poste', 'job', 'title', 'job title', 'metier'],
  organization: ['organisation', 'organization', 'service', 'departement', 'department', 'societe', 'entreprise'],
  country: ['pays', 'country'],
  resource_type: ['type', 'interne/externe', 'interne ou externe'],
  supplier: ['fournisseur', 'supplier'],
  team: ['equipe', 'team']
};

function normHeader_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Fusionne une liste de personnes (tableau de lignes, la première = en-têtes) avec les fiches existantes.
 * Clé : l'adresse e-mail, sinon le nom exact. Les fiches existantes ne sont complétées que sur les champs vides.
 * Renvoie { create: [valeurs], update: [{ id, patch }], skipped: [motifs] }.
 */
function mergePeople_(rows, existing, teams) {
  var out = { create: [], update: [], skipped: [] };
  if (!rows || rows.length < 2) return out;
  var col = {};
  rows[0].forEach(function (h, i) {
    var n = normHeader_(h);
    Object.keys(PEOPLE_HEADERS).forEach(function (k) { if (!(k in col) && PEOPLE_HEADERS[k].indexOf(n) >= 0) col[k] = i; });
  });
  if (!('name' in col) && !('email' in col)) { out.skipped.push('Ni colonne « Nom » ni colonne « E-mail » en première ligne.'); return out; }
  var byEmail = {}, byName = {}, teamByName = {};
  existing.forEach(function (r) {
    if (!isBlank(r.email)) byEmail[String(r.email).toLowerCase()] = r;
    byName[normHeader_(r.name)] = r;
  });
  (teams || []).forEach(function (t) { teamByName[normHeader_(t.name)] = t.id; });
  var seen = {};
  rows.slice(1).forEach(function (row, i) {
    var v = {};
    Object.keys(col).forEach(function (k) { var x = row[col[k]]; if (!isBlank(x)) v[k] = String(x).replace(/\s+/g, ' ').trim(); });
    if (isBlank(v.name) && isBlank(v.email)) return;
    if (v.email) v.email = v.email.toLowerCase();
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) { out.skipped.push('Ligne ' + (i + 2) + ' : adresse invalide « ' + v.email + ' ».'); return; }
    if (v.country) { v.country = v.country.toUpperCase(); if (v.country === 'GB') v.country = 'UK'; if (COUNTRIES.indexOf(v.country) < 0) delete v.country; }
    if (v.resource_type) v.resource_type = /ext/i.test(v.resource_type) ? 'Externe' : 'Interne';
    if (v.team) { var tid = teamByName[normHeader_(v.team)]; if (tid) v.team_id = tid; else out.skipped.push('Ligne ' + (i + 2) + ' : équipe inconnue « ' + v.team + ' » (ignorée).'); delete v.team; }
    ['job_function', 'organization'].forEach(function (k) { if (v[k]) v[k] = v[k].slice(0, TEXT_MAX_LENGTH[k]); });
    var key = v.email || 'nom:' + normHeader_(v.name);
    if (seen[key]) { out.skipped.push('Ligne ' + (i + 2) + ' : doublon.'); return; }
    seen[key] = true;
    var cur = (v.email && byEmail[v.email]) || (!v.email && byName[normHeader_(v.name)]) || null;
    if (cur) {
      var patch = {};
      Object.keys(v).forEach(function (k) { if (k !== 'email' && isBlank(cur[k])) patch[k] = v[k]; });
      if (Object.keys(patch).length) out.update.push({ id: cur.id, patch: patch });
      return;
    }
    if (isBlank(v.name)) { out.skipped.push('Ligne ' + (i + 2) + ' : nom manquant pour ' + v.email + '.'); return; }
    if (!v.resource_type) v.resource_type = 'Interne';
    out.create.push(v);
  });
  return out;
}

/**
 * À exécuter depuis l'éditeur (administrateur) : importe les personnes d'une feuille Google Sheets.
 * Colonnes reconnues en première ligne : Nom, E-mail, Fonction, Organisation, Pays, Type, Fournisseur, Équipe.
 */
function importPeopleFromSheet(url) {
  if (!url) throw new PpmError('VALIDATION', 'Passer l’adresse de la feuille : importPeopleFromSheet("https://docs.google.com/…")');
  var rows = SpreadsheetApp.openByUrl(url).getSheets()[0].getDataRange().getDisplayValues();
  var m = mergePeople_(rows, repoList('Resource'), repoList('HierarchicalTeam'));
  var actx = { actor: String(Session.getActiveUser().getEmail() || 'admin').toLowerCase(), source: 'import' };
  m.create.forEach(function (v) { repoInsert('Resource', fillFromDirectory_(v), actx); });
  m.update.forEach(function (u) { repoUpdate('Resource', u.id, u.patch, null, actx); });
  var msg = m.create.length + ' personne(s) créée(s), ' + m.update.length + ' complétée(s).' +
    (m.skipped.length ? '\nIgnoré :\n- ' + m.skipped.join('\n- ') : '');
  console.log(msg);
  return msg;
}
