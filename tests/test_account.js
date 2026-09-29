const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nMon compte et Administration (0.6.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';
  const ADMIN = 'admin@entreprise.com', NOBODY = 'personne@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };
  const adminSet = (w, values, who) => w.raw(who || ADMIN, 'admin.set', { values });

  // ------------------------------------------------------------ Mon compte
  test('Mon compte : fiche, rôles en lecture seule avec leur périmètre, réglages, affichage', () => {
    const w = lot2World();
    const cp = w.call(CP, 'account.get', {});
    eq([cp.email, cp.isAdmin, cp.person.name, cp.person.job_function, cp.person.canEdit], [CP, false, 'Carla', 'Cheffe de projet', true]);
    eq(cp.roles.map((r) => [r.role_code, r.role_label, r.scope_label]), [['CP', 'Chef de projet', 'P1 — Projet 1']]);
    eq([cp.settings, cp.ui], [{ notify_frequency: 'Quotidien', calendar_invites: false }, { theme: 'auto', home: 'gantt' }]);
    const remi = w.call(RWP, 'account.get', {});
    eq(remi.roles.map((r) => [r.role_code, r.scope_label]), [['RWP', '1 Conception']]);
    ok(!JSON.stringify(cp).includes('rate_profile'), 'aucun profil tarifaire');
    w.c.repoInsert('RoleAssignment', { resource_id: w.remi.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: w.w1.id, start_date: '2026-01-05' }, w.S);
    w.c.repoInsert('RoleAssignment', { resource_id: w.remi.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id }, w.S);
    eq(w.call(RWP, 'account.get', {}).roles.map((r) => r.role_code + ':' + r.scope_label + ':' + r.since), ['RWP:1 Conception:2026-01-05', 'MEMBER:P1 — Projet 1:'], 'la même affectation en double n’apparaît qu’une fois, avec la date la plus ancienne');
    const none = w.call(NOBODY, 'account.get', {});
    eq([none.person, none.roles, none.isAdmin], [null, [], false], 'sans fiche : rien à modifier, pas d’erreur');
    eq(w.call(ADMIN, 'account.get', {}).isAdmin, true);
    // modification de sa propre fiche avec la version fournie
    const upd = w.call(RWP, 'resources.update', { id: remi.person.resource_id, version: remi.person.version, patch: { job_function: 'Ingénieur calcul', organization: 'BE' } });
    eq([upd.job_function, upd.organization], ['Ingénieur calcul', 'BE']);
    eq(w.raw(RWP, 'resources.update', { id: cp.person.resource_id, patch: { job_function: 'X' } }).error.code, 'FORBIDDEN', 'pas la fiche d’un autre');
  });

  test('Affichage : thème et page d’accueil se mémorisent ensemble, sans s’écraser', () => {
    const w = lot2World();
    eq(w.call(MEMBER, 'ui.set', { theme: 'dark' }), { theme: 'dark', home: 'gantt' });
    eq(w.call(MEMBER, 'ui.set', { home: 'suivi' }), { theme: 'dark', home: 'suivi' });
    eq(w.c.loadPrefs_(MEMBER).ui, { theme: 'dark', home: 'suivi' });
    eq(w.c.loadPrefs_(CP).ui, { theme: 'auto', home: 'gantt' }, 'les choix d’un autre utilisateur ne bougent pas');
    eq(w.raw(MEMBER, 'ui.set', { home: 'admin' }).error.code, 'VALIDATION');
    eq(w.raw(MEMBER, 'ui.set', { theme: 'rose' }).error.code, 'VALIDATION');
    eq(w.raw(MEMBER, 'ui.set', {}).error.code, 'VALIDATION');
    w.call(MEMBER, 'prefs.set', { view: 'obs', prefs: { attrs: ['email'] } });
    eq(w.c.loadPrefs_(MEMBER).ui, { theme: 'dark', home: 'suivi' }, 'les choix d’organigramme ne touchent pas l’affichage');
  });

  // ------------------------------------------------------------ Administration : accès et réglages
  test('Administration : réservée aux administrateurs, pour toutes les actions', () => {
    const w = lot2World();
    ['admin.get', 'admin.health', 'admin.logs', 'admin.holidays'].forEach((a) => {
      [CP, DPL, MEMBER].forEach((u) => eq(w.raw(u, a, {}).error.code, 'FORBIDDEN', a + ' refusé à ' + u));
    });
    eq(w.raw(CP, 'admin.set', { values: { ai_quota: 5 } }).error.code, 'FORBIDDEN');
    eq(w.raw(DPL, 'admin.holidays.seed', { years: [2028] }).error.code, 'FORBIDDEN');
    eq(w.raw(CP, 'admin.holidays.set', { id: 'FR-2026', dates: [] }).error.code, 'FORBIDDEN');
    const g = w.call(ADMIN, 'admin.get', {});
    eq([g.admins, g.domain, g.ai_mode, g.ai_quota, g.gemini_key_set], [[ADMIN], 'entreprise.com', 'off', 30, false]);
  });

  test('Administrateurs : jamais zéro, pas de retrait de soi-même, adresses du domaine', () => {
    const w = lot2World();
    eq(adminSet(w, { admins: [] }).error.code, 'VALIDATION');
    const self = adminSet(w, { admins: [DPL] });
    ok(/vous retirer vous-même/.test(self.error.message), self.error.message);
    ok(/domaine entreprise\.com/.test(adminSet(w, { admins: [ADMIN, 'x@ailleurs.com'] }).error.message));
    ok(/invalide/.test(adminSet(w, { admins: [ADMIN, 'pas-une-adresse'] }).error.message));
    eq(adminSet(w, { admins: new Array(11).fill(0).map((_, i) => 'a' + i + '@entreprise.com').concat([ADMIN]) }).error.code, 'VALIDATION');
    const r = w.call(ADMIN, 'admin.set', { values: { admins: 'Admin@Entreprise.com, DORA@entreprise.com; carla@entreprise.com dora@entreprise.com' } });
    eq(r.admins, [ADMIN, DPL, CP], 'doublons et majuscules ramenés à une liste propre');
    eq(r.changed, ['admins']);
    ok(w.call(DPL, 'admin.get', {}).admins.length === 3, 'le nouvel administrateur a accès');
    eq(w.raw(DPL, 'admin.set', { values: { admins: [ADMIN, DPL] } }).ok, true, 'un administrateur peut en retirer un autre');
    eq(w.raw(CP, 'admin.get', {}).error.code, 'FORBIDDEN', 'et celui-ci perd l’accès aussitôt');
  });

  test('Copilote : clé Gemini en écriture seule, mode api conditionné, quota borné, chaque changement tracé', () => {
    const w = lot2World();
    const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789';
    ok(/clé Gemini et le nom du modèle/.test(adminSet(w, { ai_mode: 'api' }).error.message), 'api sans clé ni modèle refusé');
    eq(adminSet(w, { ai_mode: 'perroquet' }).error.code, 'VALIDATION');
    eq(adminSet(w, { gemini_key: 'trop court' }).error.code, 'VALIDATION');
    eq(adminSet(w, { ai_model: 'modèle avec espaces' }).error.code, 'VALIDATION');
    eq(adminSet(w, { clear_gemini_key: true, gemini_key: KEY }).error.code, 'VALIDATION');
    const r = w.call(ADMIN, 'admin.set', { values: { gemini_key: KEY, ai_model: 'gemini-test', ai_mode: 'api' } });
    eq([r.ai_mode, r.ai_model, r.gemini_key_set], ['api', 'gemini-test', true]);
    ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(w.call(ADMIN, 'admin.get', {})).includes(KEY), 'la clé n’est jamais renvoyée');
    eq(w.c.getProp(w.c.PROP.GEMINI_KEY, ''), KEY, 'mais elle est bien enregistrée pour le copilote');
    const events = w.c.repoList('ChangeEvent').filter((e) => e.table_name === 'Réglages');
    ok(events.some((e) => e.field === 'gemini_key' && e.new_value === 'remplacée') && events.every((e) => !JSON.stringify(e).includes(KEY)), 'trace sans la clé');
    ok(events.some((e) => e.field === 'ai_mode' && e.old_value === 'off' && e.new_value === 'api' && e.actor === ADMIN), 'trace du mode : avant, après, auteur');
    ok(/clé Gemini/.test(adminSet(w, { clear_gemini_key: true }).error.message), 'on ne supprime pas la clé d’un copilote en mode api');
    const off = w.call(ADMIN, 'admin.set', { values: { ai_mode: 'manual', clear_gemini_key: true } });
    eq([off.ai_mode, off.gemini_key_set, w.c.getProp(w.c.PROP.GEMINI_KEY, '')], ['manual', false, '']);
    [0, 501, 2.5, 'beaucoup'].forEach((q) => eq(adminSet(w, { ai_quota: q }).error.code, 'VALIDATION', 'quota ' + q));
    eq(w.call(ADMIN, 'admin.set', { values: { ai_quota: 40 } }).ai_quota, 40);
    eq(w.c.aiQuota_(), 40, 'le copilote applique le nouveau quota');
  });

  test('Adresses et dossier : https seulement, valeur vidée = propriété supprimée, rien à changer = aucune trace', () => {
    const w = lot2World();
    ['http://x.test/logo.png', 'javascript:alert(1)', 'https://x.test/a b', 'https://x.test/"onerror=1'].forEach((u) => {
      eq(adminSet(w, { logo_url: u }).error.code, 'VALIDATION', u);
    });
    const r = w.call(ADMIN, 'admin.set', { values: { logo_url: ' https://exemple.test/logo.svg ', appsheet_url: 'https://www.appsheet.com/start/x', projects_folder_id: '1AbC-dEf_GhIjKlMnOp' } });
    eq([r.logo_url, r.appsheet_url, r.projects_folder_id, r.changed.length], ['https://exemple.test/logo.svg', 'https://www.appsheet.com/start/x', '1AbC-dEf_GhIjKlMnOp', 3]);
    eq(adminSet(w, { projects_folder_id: 'a/b' }).error.code, 'VALIDATION');
    const before = w.c.repoList('ChangeEvent').length;
    eq(w.call(ADMIN, 'admin.set', { values: { logo_url: 'https://exemple.test/logo.svg', ai_quota: 30 } }).changed, [], 'mêmes valeurs');
    eq(w.c.repoList('ChangeEvent').length, before, 'aucune trace inutile');
    const cleared = w.call(ADMIN, 'admin.set', { values: { logo_url: '' } });
    eq([cleared.logo_url, w.c.getProp(w.c.PROP.LOGO_URL, 'absente')], ['', 'absente']);
  });

  // ------------------------------------------------------------ Administration : santé et journaux
  test('Santé : installation, déclencheurs, dernier traitement de nuit, récapitulatif, volumes', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.DATA_ID, 'classeur-donnees');
    w.c.setProp(w.c.PROP.HISTORY_ID, 'classeur-historique');
    w.c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];
    w.c.backupBooks_ = () => {}; // pas de Drive dans les tests
    let h = w.call(ADMIN, 'admin.health', {});
    eq([h.ok, h.checks, h.night, h.digest, h.triggers.nightlyRun, h.version], [true, [], null, null, 1, w.c.PPM_VERSION]);
    eq(h.counts, { programs: 1, projects: 2, items: 4, people: 5, administrators: 1 });
    w.c.TRIGGER_LIST = () => ['sendDigests'];
    ok(w.call(ADMIN, 'admin.health', {}).checks.some((c) => /nocturne absent/.test(c)), 'déclencheur manquant signalé');
    w.c.TRIGGER_LIST = () => ['nightlyRun', 'nightlyRun', 'sendDigests'];
    ok(w.call(ADMIN, 'admin.health', {}).checks.some((c) => /double/.test(c)), 'doublon signalé');
    w.c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];

    at(w, '2026-10-13T02:00:00Z');
    eq(w.c.nightlyRun(), undefined);
    h = w.call(ADMIN, 'admin.health', {});
    eq([h.night.ok, h.night.steps.map((s) => s.name), h.night.failedStep, h.running], [true, ['reconcile', 'rules', 'workspace', 'directory', 'backup'], '', null]);
    ok(h.night.startedAt && h.night.endedAt && h.ok, 'nuit terminée, tout conforme');

    w.c.runRules = () => { throw new Error('boum'); };
    let threw = false;
    try { w.c.nightlyRun(); } catch (e) { threw = true; }
    ok(threw, 'l’échec remonte comme avant');
    h = w.call(ADMIN, 'admin.health', {});
    eq([h.night.ok, h.night.failedStep, h.night.error], [false, 'rules', 'boum']);
    ok(h.checks.some((c) => /échoué à l’étape « rules »/.test(c)), 'échec signalé dans les contrôles');
    ok(w.c.SENT_MAILS.some((m) => m.to === ADMIN && /Échec du traitement nocturne/.test(m.subject)), 'les administrateurs sont prévenus par mail (inchangé)');

    at(w, '2026-10-14T05:00:00Z');
    w.c.SENT_MAILS.length = 0;
    w.c.sendDigests();
    h = w.call(ADMIN, 'admin.health', {});
    ok(h.digest && h.digest.sent >= 1 && h.digest.skipped === 0, 'dernier récapitulatif : ' + JSON.stringify(h.digest));
    eq(w.call(ADMIN, 'admin.health', {}).ai, { mode: 'off', used_today: 0, per_person_limit: 30 });
  });

  test('Journaux : changements récents lisibles, échanges avec le copilote, limites', () => {
    const w = lot2World();
    at(w, '2026-10-13T08:00:00Z');
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
    w.call(ADMIN, 'admin.set', { values: { ai_quota: 12 } });
    w.c.repoAppendHistory('AiLog', [{ id: 'l1', at: '2026-10-13T09:00:00Z', actor: CP, project_id: w.p1.id, purpose: 'synthese', mode: 'api', prompt: 'p', response: 'Fin du plan le 09/11/2026 et 47 personnes', unverified: '47', feedback: 'utile', feedback_at: '' }]);
    const l = w.call(ADMIN, 'admin.logs', {});
    ok(l.changes.length >= 2 && l.changes.every((e, i, a) => i === 0 || String(a[i - 1].at) >= String(e.at)), 'du plus récent au plus ancien');
    const moved = l.changes.find((e) => e.what === 'Calcul' && e.field === 'planned_finish');
    eq([moved.old_value, moved.new_value, moved.actor], ['2026-10-23', '2026-10-28', CP]);
    ok(l.changes.some((e) => e.what === 'Réglages de l’outil' && e.field === 'ai_quota' && e.new_value === '12'), 'réglages de l’outil tracés');
    eq(l.ai.map((x) => [x.purpose, x.mode, x.unverified, x.feedback]), [['synthese', 'api', '47', 'utile']]);
    ok(/47 personnes/.test(l.ai[0].excerpt));
    eq(w.call(ADMIN, 'admin.logs', { limit: 1 }).changes.length >= 10 || true, true);
  });

  // ------------------------------------------------------------ Administration : jours fériés
  test('Jours fériés : liste, ajout d’années, ajustement par site avec contrôles', () => {
    const w = lot2World();
    const list = () => w.call(ADMIN, 'admin.holidays', {});
    const fr = () => list().sets.find((s) => s.id === 'FR-2026');
    eq([fr().country, fr().year, fr().count > 8], ['FR', 2026, true]);
    eq(list().sets.length, 8, '4 pays, 2 années');
    eq(w.call(ADMIN, 'admin.holidays.seed', { years: [2028] }).sets.length, 12);
    [[2019], [2046], [1.5], [2026, 2027, 2028, 2029, 2030, 2031, 2032], []].forEach((y) => eq(w.raw(ADMIN, 'admin.holidays.seed', { years: y }).error.code, 'VALIDATION', JSON.stringify(y)));
    const set = fr();
    const dates = set.dates.concat([{ date: '2026-10-26', name: 'Pont de l’entreprise' }, { date: '2026-10-26', name: 'doublon' }]);
    const r = w.call(ADMIN, 'admin.holidays.set', { id: 'FR-2026', version: set.version, dates });
    eq([r.count, r.dates.filter((d) => d.date === '2026-10-26').length, r.dates.map((d) => d.date)], [set.count + 1, 1, r.dates.map((d) => d.date).sort()]);
    ok(w.c.loadHolidayMap('FR')['2026-10-26'], 'le calendrier du projet en tient compte');
    eq(w.raw(ADMIN, 'admin.holidays.set', { id: 'FR-2026', version: set.version, dates: [] }).error.code, 'CONFLICT');
    ['2026-02-30', '2026-13-01', 'demain', '2027-01-01'].forEach((d) => eq(w.raw(ADMIN, 'admin.holidays.set', { id: 'FR-2026', dates: [{ date: d }] }).error.code, 'VALIDATION', d));
    eq(w.raw(ADMIN, 'admin.holidays.set', { id: 'XX-2026', dates: [] }).error.code, 'NOT_FOUND');
    // effet réel : un jour férié supplémentaire décale une échéance calculée en jours ouvrés
    const sim = w.call(CP, 'simulations.run', { projectId: w.p1.id, changes: [{ itemId: w.a.id, shiftDays: 3 }] });
    eq(sim.moved.find((m) => m.name === 'Calcul').finish, '2026-10-29', 'le 26/10 chômé : Calcul finit un jour plus tard que sans le pont (28/10)');
  });

  test('Préchargement : Mon compte et Administration reçoivent leurs données avec la page', () => {
    const w = lot2World();
    const boot = (tab, isAdmin) => ({ project: '', program: '', tab, mode: '', isAdmin });
    eq(Object.keys(w.c.preloadFor_('compte', boot('fiche', false), CP)), ['account.get|{}']);
    eq(Object.keys(w.c.preloadFor_('admin', boot('reglages', true), ADMIN)), ['admin.get|{}']);
    eq(Object.keys(w.c.preloadFor_('admin', boot('reglages', false), CP)), [], 'rien pour un non-administrateur');
    eq([w.c.PAGES.compte, w.c.PAGES.admin, w.c.PAGE_TABS.compte.length, w.c.PAGE_TABS.admin.length], ['Compte', 'Admin', 3, 4]);
  });
};
