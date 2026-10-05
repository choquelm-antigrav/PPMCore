/**
 * PPM Core — 0.6.0 : « Mon compte » et « Administration ».
 *
 * Mon compte (tout utilisateur) : sa fiche (fonction, organisation), ses rôles en lecture seule, ses notifications,
 * ses choix d'affichage (thème, page d'accueil). La modification de la fiche passe par resources.update (mêmes droits).
 *
 * Administration (administrateurs seulement, propriété PPM_ADMINS) : réglages jusque-là cachés dans les propriétés
 * du script, état de santé, jours fériés, journaux. Garde-fous :
 *   - la clé Gemini se saisit mais ne se relit jamais (on sait seulement qu'elle existe) ;
 *   - on ne peut pas se retirer soi-même de la liste des administrateurs (jamais d'outil sans administrateur) ;
 *   - toute valeur est validée avant d'être écrite ; chaque réglage modifié est tracé (journal, sans la valeur des secrets).
 * Le manifeste et le déploiement restent dans l'éditeur Apps Script.
 */

var HOME_VIEWS = ['overview', 'gantt', 'structure', 'ressources', 'suivi', 'copilote', 'budget'];
var ADMIN_EMAIL_RE_ = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
var TRIGGER_LIST = null; // tests : () => [noms des fonctions déclenchées]

function requireAdmin_(ctx) {
  if (!ctx.isAdmin) throw new PpmError('FORBIDDEN', 'Réservé aux administrateurs de l’outil.');
}

// ---------------------------------------------------------------- Mon compte

defineAction('account.get', function (p, ctx) {
  var data = { programs: repoList('Program'), projects: repoList('Project'), workpackages: repoList('WorkPackage') };
  var res = ctx.resourceId ? repoGet('Resource', ctx.resourceId) : null;
  var teams = indexBy_(repoList('HierarchicalTeam'));
  var row = userSettingRow_(ctx.email);
  var roles = (ctx.assignments || []).map(function (a) {
    return {
      role_code: a.role_code, role_label: ROLE_LABELS[a.role_code] || a.role_code, rank: ROLE_RANK[a.role_code],
      scope_type: a.scope_type, scope_id: a.scope_id, scope_label: scopeLabel_(data, a.scope_type, a.scope_id),
      since: a.start_date || '', until: a.end_date || ''
    };
  }).filter(function (r) { return r.scope_label; }).reduce(function (acc, r) {
    var k = r.role_code + '|' + r.scope_type + '|' + r.scope_id;
    var i = acc.index[k];
    if (i === undefined) { acc.index[k] = acc.list.length; acc.list.push(r); }
    else if (r.since && (!acc.list[i].since || r.since < acc.list[i].since)) acc.list[i].since = r.since;
    return acc;
  }, { list: [], index: {} }).list.sort(function (a, b) {
    return (a.rank - b.rank) || String(a.scope_label).localeCompare(String(b.scope_label), 'fr');
  });
  return {
    email: ctx.email, isAdmin: ctx.isAdmin,
    person: res ? personCard_(res, teams, ctx, false) : null,
    roles: roles,
    settings: Object.assign({ notify_frequency: (row && row.notify_frequency) || 'Quotidien', calendar_invites: !!(row && isTrue(row.calendar_invites)) }, reminderSettingsView_(row)),
    ui: loadPrefs_(ctx.email).ui
  };
});

// ---------------------------------------------------------------- Administration : réglages

function adminView_() {
  return {
    admins: adminEmails(), domain: allowedDomains().join(', '),
    ai_mode: aiMode_(), ai_model: getProp(PROP.GEMINI_MODEL, ''), ai_quota: aiQuota_(),
    gemini_key_set: !!getProp(PROP.GEMINI_KEY, ''),
    reminder_on: reminderDefaults_().on, reminder_days: reminderDefaults_().days,
    appsheet_url: getProp(PROP.APPSHEET_URL, ''), logo_url: getProp(PROP.LOGO_URL, ''),
    projects_folder_id: getProp(PROP.PROJECTS_FOLDER, ''),
    backup_folder_id: getProp(PROP.BACKUP_FOLDER, ''), webapp_url: getProp(PROP.WEBAPP_URL, '')
  };
}

function checkHttpsUrl_(label, value) {
  var s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) return '';
  if (s.length > 500 || !/^https:\/\/[^\s"'<>\\]+$/.test(s)) {
    throw new PpmError('VALIDATION', label + ' : une adresse https:// valide est attendue (sans espace ni guillemet).');
  }
  return s;
}

/**
 * Valide un lot de réglages et calcule ce qui changerait, sans rien écrire.
 * cur : adminView_() ; actor : adresse de l'administrateur qui modifie.
 * Renvoie { props: { CLÉ_PROPRIÉTÉ: valeur | null (= supprimer) }, audit: [{ field, old, new }] }.
 */
function validateAdminSettings_(v, cur, actor) {
  v = v || {};
  var props = {}, audit = [];
  var change = function (field, propKey, oldVal, newVal, shown) {
    if (String(oldVal) === String(newVal === null ? '' : newVal)) return;
    props[propKey] = newVal === null ? null : String(newVal);
    audit.push({ field: field, old: shown ? shown[0] : String(oldVal), new: shown ? shown[1] : String(newVal === null ? '' : newVal) });
  };

  var domainsNow = allowedDomains();
  if (v.domains !== undefined) {
    var dl = (Array.isArray(v.domains) ? v.domains : String(v.domains).split(/[\s,;]+/)).map(function (d) { return String(d).trim().toLowerCase(); }).filter(function (d) { return d; });
    var uniq = dl.filter(function (d, i) { return dl.indexOf(d) === i; });
    if (!uniq.length) throw new PpmError('VALIDATION', 'Il faut au moins un domaine autorisé.');
    if (uniq.length > 5) throw new PpmError('VALIDATION', 'Cinq domaines au plus.');
    uniq.forEach(function (d) { if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) throw new PpmError('VALIDATION', 'Domaine invalide : ' + d); });
    if (uniq.indexOf(String(actor).split('@')[1]) < 0) throw new PpmError('VALIDATION', 'Vous ne pouvez pas retirer votre propre domaine : vous perdriez l’accès à l’outil.');
    change('domains', PROP.DOMAIN, cur.domain.split(/[\s,;]+/).filter(Boolean).join(','), uniq.join(','));
    domainsNow = uniq;
  }
  if (v.admins !== undefined) {
    var raw = Array.isArray(v.admins) ? v.admins : String(v.admins).split(/[\s,;]+/);
    var seen = {}, list = [];
    raw.forEach(function (m) {
      m = String(m).trim().toLowerCase();
      if (m && !seen[m]) { seen[m] = true; list.push(m); }
    });
    if (!list.length) throw new PpmError('VALIDATION', 'Il faut au moins un administrateur.');
    if (list.length > 10) throw new PpmError('VALIDATION', 'Dix administrateurs au plus.');
    list.forEach(function (m) {
      if (!ADMIN_EMAIL_RE_.test(m)) throw new PpmError('VALIDATION', 'Adresse invalide : ' + m);
      if (domainsNow.length && domainsNow.indexOf(m.split('@')[1]) < 0) throw new PpmError('VALIDATION', 'Adresse hors du domaine ' + domainsNow.join(', ') + ' : ' + m);
    });
    if (list.indexOf(actor) < 0) {
      throw new PpmError('VALIDATION', 'Vous ne pouvez pas vous retirer vous-même des administrateurs : demandez à un autre administrateur de le faire.');
    }
    change('admins', PROP.ADMINS, cur.admins.join(','), list.join(','));
  }

  var mode = v.ai_mode !== undefined ? String(v.ai_mode) : cur.ai_mode;
  var model = v.ai_model !== undefined ? String(v.ai_model).trim() : cur.ai_model;
  var keySet = cur.gemini_key_set;
  if (['off', 'manual', 'api'].indexOf(mode) < 0) throw new PpmError('VALIDATION', 'Mode du copilote inconnu : off, manual ou api.');
  if (model && !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new PpmError('VALIDATION', 'Nom de modèle invalide (lettres, chiffres, point, tiret, deux-points).');
  if (v.clear_gemini_key && !isBlank(v.gemini_key)) throw new PpmError('VALIDATION', 'Remplacer et supprimer la clé en même temps n’a pas de sens.');
  if (v.clear_gemini_key) {
    if (keySet) change('gemini_key', PROP.GEMINI_KEY, 'définie', null, ['définie', 'supprimée']);
    keySet = false;
  }
  if (!isBlank(v.gemini_key)) {
    var k = String(v.gemini_key).trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(k)) throw new PpmError('VALIDATION', 'Clé Gemini invalide : 20 à 200 caractères, lettres, chiffres, tiret ou souligné.');
    props[PROP.GEMINI_KEY] = k;
    audit.push({ field: 'gemini_key', old: keySet ? 'définie' : 'aucune', new: 'remplacée' });
    keySet = true;
  }
  if (mode === 'api' && (!keySet || !model)) {
    throw new PpmError('VALIDATION', 'Le mode « api » demande une clé Gemini et le nom du modèle (à n’activer qu’avec l’accord de la DSI).');
  }
  change('ai_mode', PROP.AI_MODE, cur.ai_mode, mode);
  change('ai_model', PROP.GEMINI_MODEL, cur.ai_model, model);
  if (v.ai_quota !== undefined) {
    var q = Number(v.ai_quota);
    if (!(q >= 1 && q <= 500) || Math.floor(q) !== q) throw new PpmError('VALIDATION', 'Quota : un nombre entier de 1 à 500 demandes par personne et par jour.');
    change('ai_quota', PROP.AI_QUOTA, cur.ai_quota, q);
  }
  if (v.reminder_on !== undefined) change('reminder_on', PROP.REMINDER_ON, cur.reminder_on ? 'oui' : 'non', v.reminder_on ? 'oui' : 'non');
  if (v.reminder_days !== undefined) {
    var rd = Number(v.reminder_days);
    if (isBlank(v.reminder_days) || isNaN(rd) || Math.floor(rd) !== rd || rd < 1 || rd > 60) throw new PpmError('VALIDATION', 'Délai du rappel : un nombre entier de jours ouvrés entre 1 et 60.');
    change('reminder_days', PROP.REMINDER_DAYS, cur.reminder_days, rd);
  }
  if (v.appsheet_url !== undefined) change('appsheet_url', PROP.APPSHEET_URL, cur.appsheet_url, checkHttpsUrl_('Adresse AppSheet', v.appsheet_url));
  if (v.logo_url !== undefined) change('logo_url', PROP.LOGO_URL, cur.logo_url, checkHttpsUrl_('Adresse du logo', v.logo_url));
  if (v.projects_folder_id !== undefined) {
    var f = String(v.projects_folder_id).trim();
    if (f && !/^[A-Za-z0-9_-]{10,80}$/.test(f)) throw new PpmError('VALIDATION', 'Identifiant de dossier invalide (le texte qui suit /folders/ dans l’adresse du dossier Drive).');
    change('projects_folder_id', PROP.PROJECTS_FOLDER, cur.projects_folder_id, f);
  }
  // Une valeur vidée supprime la propriété plutôt que d'en garder une vide.
  Object.keys(props).forEach(function (k2) { if (props[k2] === '' && k2 !== PROP.GEMINI_KEY) props[k2] = null; });
  return { props: props, audit: audit };
}

function applyAdminSettings_(result) {
  Object.keys(result.props).forEach(function (k) {
    if (result.props[k] === null) deleteProp(k); else setProp(k, result.props[k]);
  });
}

defineAction('admin.get', function (p, ctx) {
  requireAdmin_(ctx);
  return adminView_();
});

defineAction('admin.set', function (p, ctx) {
  requireAdmin_(ctx);
  var r = validateAdminSettings_(p.values, adminView_(), ctx.email);
  applyAdminSettings_(r);
  var at = nowIso();
  repoAppendHistory('ChangeEvent', r.audit.map(function (a) {
    return { id: newId(), at: at, table_name: 'Réglages', entity_id: 'PPM', project_id: '', field: a.field, old_value: a.old, new_value: a.new,
      actor: ctx.actx.actor, source: ctx.actx.source, acknowledged: true, acknowledged_by: '', acknowledged_at: '' };
  }));
  var out = adminView_();
  out.changed = r.audit.map(function (a) { return a.field; });
  return out;
});

// ---------------------------------------------------------------- Administration : santé

/** Fonctions déclenchées par les déclencheurs du projet ; null si la liste est indisponible (hors Apps Script). */
function listTriggers_() {
  if (TRIGGER_LIST) return TRIGGER_LIST();
  if (typeof ScriptApp === 'undefined') return null;
  try {
    return ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  } catch (e) {
    return null;
  }
}

defineAction('admin.health', function (p, ctx) {
  requireAdmin_(ctx);
  var checks = checkInstall_();
  var handlers = listTriggers_();
  var triggers = null;
  if (handlers) {
    triggers = { nightlyRun: 0, sendDigests: 0, continueNightly: 0 };
    handlers.forEach(function (h) { if (h in triggers) triggers[h]++; });
    if (!triggers.nightlyRun) checks.push('Déclencheur nocturne absent : exécuter installTriggers.');
    if (!triggers.sendDigests) checks.push('Déclencheur du récapitulatif de 7 h absent : exécuter installTriggers.');
    if (triggers.nightlyRun > 1 || triggers.sendDigests > 1) checks.push('Déclencheurs en double : relancer installTriggers (il les recrée proprement).');
  }
  var today = todayStr();
  var night = parseJsonSafe(getProp(PROP.LAST_NIGHTLY, ''), null);
  if (night && !night.ok) checks.push('Le dernier traitement nocturne a échoué à l’étape « ' + (night.failedStep || '?') + ' » : ' + (night.error || ''));
  var digest = parseJsonSafe(getProp(PROP.LAST_DIGEST, ''), null);
  var running = parseJsonSafe(getProp(PROP.JOB_STATE, ''), null);
  return {
    version: PPM_VERSION, apiVersion: PPM_API_VERSION, today: today,
    checks: checks, ok: !checks.length,
    night: night, running: running ? { step: NIGHTLY_STEPS[running.step] || '', startedAt: running.startedAt || '' } : null,
    digest: digest, triggers: triggers,
    mail_quota: typeof MailApp !== 'undefined' ? MailApp.getRemainingDailyQuota() : null,
    ai: { mode: aiMode_(), used_today: repoList('AiLog', function (l) { return l.mode === 'api' && String(l.at).slice(0, 10) === today; }).length, per_person_limit: aiQuota_() },
    cache: !!scriptCache_(),
    counts: {
      programs: repoList('Program').length, projects: repoList('Project').length, items: repoList('PlanItem').length,
      people: repoList('Resource').length, administrators: adminEmails().length
    }
  };
});

// ---------------------------------------------------------------- Administration : journaux

defineAction('admin.logs', function (p, ctx) {
  requireAdmin_(ctx);
  var limit = Math.max(10, Math.min(200, Math.floor(Number(p.limit)) || 60));
  var names = feedNames_();
  var projects = indexBy_(repoList('Project', null, { includeDeleted: true }));
  var label = function (e) {
    if (e.table_name === 'PlanItem') return names.item[e.entity_id] || 'Élément';
    if (e.table_name === 'WorkPackage') return names.wp[e.entity_id] ? 'WP ' + names.wp[e.entity_id] : 'WP';
    if (e.table_name === 'Resource') return names.resource[e.entity_id] || 'Personne';
    if (e.table_name === 'Project') return projects[e.entity_id] ? projects[e.entity_id].code : 'Projet';
    return e.table_name === 'Réglages' ? 'Réglages de l’outil' : e.table_name;
  };
  var byRecent = function (a, b) { return String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)); };
  var changes = repoList('ChangeEvent').sort(byRecent).slice(0, limit).map(function (e) {
    return { at: e.at, actor: e.actor, source: e.source, what: label(e), table: e.table_name, field: e.field,
      old_value: truncate(e.old_value, 120), new_value: truncate(e.new_value, 120) };
  });
  var ai = repoList('AiLog').sort(byRecent).slice(0, Math.min(limit, 50)).map(function (l) {
    return { at: l.at, actor: l.actor, purpose: l.purpose, mode: l.mode, unverified: l.unverified || '', feedback: l.feedback || '', excerpt: truncate(l.response, 160) };
  });
  return { changes: changes, ai: ai };
});

// ---------------------------------------------------------------- Administration : jours fériés

function holidaySetView_(h) {
  var dates = parseJsonSafe(h.dates_json, []).map(function (d) { return typeof d === 'string' ? { date: d, name: '' } : { date: d.date, name: d.name || '' }; });
  return { id: h.id, country: h.country, year: Number(h.year), label: h.label || '', count: dates.length, dates: dates, version: h.version };
}

function holidayList_() {
  return repoList('HolidaySet').map(holidaySetView_).sort(function (a, b) {
    return String(a.country).localeCompare(String(b.country)) || (a.year - b.year);
  });
}

defineAction('admin.holidays', function (p, ctx) {
  requireAdmin_(ctx);
  return { sets: holidayList_(), countries: COUNTRIES };
});

defineAction('admin.holidays.seed', function (p, ctx) {
  requireAdmin_(ctx);
  var years = (Array.isArray(p.years) ? p.years : []).map(Number);
  if (!years.length || years.length > 6 || years.some(function (y) { return !(y >= 2020 && y <= 2045) || Math.floor(y) !== y; })) {
    throw new PpmError('VALIDATION', 'Indiquez de 1 à 6 années entre 2020 et 2045.');
  }
  seedHolidays_(years);
  return { sets: holidayList_(), countries: COUNTRIES };
});

/** Remplace les dates d'un jeu de fériés (ajustement par site). dates : [{ date: 'AAAA-MM-JJ', name }]. */
defineAction('admin.holidays.set', function (p, ctx) {
  requireAdmin_(ctx);
  var set = mustGet('HolidaySet', requireParam(p, 'id'));
  var seen = {}, out = [];
  (Array.isArray(p.dates) ? p.dates : []).forEach(function (d) {
    var date = String(d && d.date !== undefined ? d.date : d).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    var real = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || real.getUTCFullYear() !== +m[1] || real.getUTCMonth() !== +m[2] - 1 || real.getUTCDate() !== +m[3]) {
      throw new PpmError('VALIDATION', 'Date invalide : « ' + date + ' » (format AAAA-MM-JJ).');
    }
    if (+m[1] !== Number(set.year)) throw new PpmError('VALIDATION', 'Ce jeu concerne ' + set.year + ' : « ' + date + ' » est d’une autre année.');
    if (seen[date]) return;
    seen[date] = true;
    out.push({ date: date, name: truncate(String((d && d.name) || ''), 60) });
  });
  if (out.length > 40) throw new PpmError('VALIDATION', 'Quarante jours fériés au plus par année.');
  out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var rec = repoUpdate('HolidaySet', set.id, { dates_json: JSON.stringify(out) }, p.version, ctx.actx);
  return holidaySetView_(rec);
});
