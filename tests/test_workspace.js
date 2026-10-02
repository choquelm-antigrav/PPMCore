const { test, eq, ok, fakeWorkspace } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nAgenda, Drive, annuaire et récapitulatif (lot 2)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';
  const far = () => Date.now() * 10;

  function withWs(dir) {
    const w = lot2World();
    w.W = fakeWorkspace(dir);
    w.c.WORKSPACE = w.W;
    w.events = () => {
      const calId = w.c.repoGet('Project', w.p1.id).calendar_id;
      return Object.values(w.W._cal.calendars[calId].events);
    };
    w.event = (title) => w.events().find((e) => e.title.indexOf(title) >= 0);
    return w;
  }

  test('Activer l’agenda et le dossier du projet : événements, sous-dossiers par WP, partage aux membres', () => {
    const w = withWs();
    eq(w.raw(MEMBER, 'workspace.enable', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    const st = w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    ok(st.calendar_id && st.drive_folder_id, JSON.stringify(st));
    eq([st.report.created, st.report.folders, st.report.errors], [6, 3, []], '4 échéances et jalons, plus 2 rappels de livraison (0.9.1)');
    eq(w.events().filter((e) => !/^Rappel livraison/.test(e.title)).map((e) => e.title + ' @ ' + e.date).sort(), [
      'Échéance · P1 · Calcul @ 2026-10-23', 'Échéance · P1 · Essais @ 2026-11-06',
      'Échéance · P1 · Spécification @ 2026-10-09', '◆ P1 · Revue @ 2026-11-09'
    ]);
    ok(/Responsable : Rémi/.test(w.event('Calcul').description) && /Workpackage 1.1 Calcul/.test(w.event('Calcul').description));
    const f = w.W._drive.folders;
    const name = (id) => f[id].name;
    const project = Object.keys(f).find((id) => f[id].parent === 'root');
    eq(name(project), 'P1 — Projet 1');
    const kids = (pid) => Object.keys(f).filter((id) => f[id].parent === pid).map(name).sort();
    eq(kids(project), ['1 Conception', '2 Essais']);
    eq(kids(Object.keys(f).find((id) => f[id].name === '1 Conception')), ['1.1 Calcul']);
    const shared = Object.keys(w.W._cal.shares[st.calendar_id]).sort();
    eq(shared, ['carla@entreprise.com', 'dora@entreprise.com', 'mia@entreprise.com', 'remi@entreprise.com'],
      'membres du projet, DPL du programme ; pas l’externe hors domaine');
    eq(Object.keys(w.W._drive.editors[st.drive_folder_id]).sort(), shared);
    const again = w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    eq([again.calendar_id, again.report.created, again.report.updated, again.report.folders, again.report.shared], [st.calendar_id, 0, 0, 0, 0],
      'relancer ne duplique rien et ne renvoie rien qui n’a pas changé');
  });

  test('Déplacer un élément met son événement à jour aussitôt ; la nuit retire ceux des éléments supprimés', () => {
    const w = withWs();
    w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    const calls = w.W.calls.length;
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
    eq(w.event('Calcul').date, '2026-10-28');
    eq(w.W.calls.slice(calls), ['update', 'update'], 'mise à jour de l’événement existant et de son rappel, sans doublon');
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { status: 'En cours' } });
    eq(w.W.calls.length, calls + 2, 'un changement sans effet sur l’événement et son rappel ne rappelle pas l’agenda');
    w.call(CP, 'planitems.delete', { id: w.a.id });
    ok(w.event('Spécification'), 'la suppression attend la synchronisation de la nuit');
    ok(w.c.syncWorkspaceAll({}, far()));
    ok(!w.event('Spécification'));
    eq(w.events().filter((e) => !/^Rappel livraison/.test(e.title)).length, 3, 'échéances et jalons restants');
    eq(w.events().filter((e) => /^Rappel livraison/.test(e.title)).length, 2, 'et les rappels des livrables restants');
  });

  test('Renommer un WP renomme son dossier ; un WP supprimé garde son dossier', () => {
    const w = withWs();
    w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    const before = Object.keys(w.W._drive.folders).length;
    w.call(RWP, 'workpackages.update', { id: w.w1.id, patch: { name: 'Conception détaillée' } });
    w.c.syncWorkspaceAll({}, far());
    eq(Object.keys(w.W._drive.folders).length, before, 'pas de nouveau dossier');
    ok(Object.values(w.W._drive.folders).some((f) => f.name === '1 Conception détaillée'));
    w.call(CP, 'workpackages.delete', { id: w.w2.id });
    w.c.syncWorkspaceAll({}, far());
    ok(Object.values(w.W._drive.folders).some((f) => f.name === '2 Essais'), 'les fichiers ne sont jamais supprimés');
  });

  test('Échéances dans l’agenda personnel, sur option du responsable', () => {
    const w = withWs();
    w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    eq(w.event('Revue').guests, []);
    eq(w.call(CP, 'settings.set', { calendar_invites: true }).calendar_invites, true);
    w.c.syncWorkspaceAll({}, far());
    eq([w.event('Revue').guests, w.event('Essais').guests, w.event('Calcul').guests], [[CP], [CP], []]);
  });

  test('Une panne de l’agenda ne bloque pas la saisie ; la nuit rattrape', () => {
    const w = withWs();
    w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    w.W.fail = true;
    const r = w.raw(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-27' } });
    ok(r.ok, 'la saisie est enregistrée');
    eq(w.event('Calcul').date, '2026-10-23');
    w.W.fail = false;
    w.c.syncWorkspaceAll({}, far());
    eq(w.event('Calcul').date, '2026-10-27');
  });

  test('Annuaire : une adresse suffit pour créer une personne ; rien n’est écrasé', () => {
    const w = withWs({
      'nora@entreprise.com': { name: 'Nora Petit', job_function: 'Ingénieure structure', organization: 'BE Nord' },
      'mia@entreprise.com': { name: 'Mia L.', job_function: 'Analyste', organization: 'PMO' }
    });
    const n = w.call(CP, 'resources.create', { values: { email: 'Nora@Entreprise.com' } });
    eq([n.name, n.email, n.job_function, n.organization, n.resource_type], ['Nora Petit', 'nora@entreprise.com', 'Ingénieure structure', 'BE Nord', 'Interne']);
    const k = w.raw(CP, 'resources.create', { values: { email: 'inconnu@entreprise.com' } });
    eq(k.error.code, 'VALIDATION', 'sans annuaire ni nom, la fiche ne peut pas être créée');
    w.c.repoUpdate('Resource', w.mia.id, { organization: 'Direction' }, null, w.S);
    eq(w.c.refreshPeopleFromDirectory(), 1);
    const m = w.c.repoGet('Resource', w.mia.id);
    eq([m.name, m.job_function, m.organization], ['Mia', 'Analyste', 'Direction'], 'seuls les champs vides sont complétés');
  });

  test('Import de personnes depuis une feuille : en-têtes souples, doublons, équipes, compléments', () => {
    const w = lot2World();
    const team = w.c.repoInsert('HierarchicalTeam', { name: 'Bureau d’études' }, w.S);
    const rows = [
      ['Nom', 'E-mail', 'Fonction', 'Département', 'Pays', 'Équipe', 'Type'],
      ['Paul Roy', 'Paul.Roy@entreprise.com', 'Ingénieur calcul', 'BE', 'fr', 'bureau d’études', 'Interne'],
      ['Mia', 'mia@entreprise.com', 'Analyste', 'PMO', '', '', ''],
      ['Bad', 'pas-une-adresse', '', '', '', '', ''],
      ['Paul Roy', 'paul.roy@entreprise.com', 'Autre', '', '', '', ''],
      ['Ext Consultant', '', 'Consultant', 'Alpha', 'GB', 'Inconnue', 'externe'],
      ['', '', '', '', '', '', '']
    ];
    const m = w.c.mergePeople_(rows, w.c.repoList('Resource'), w.c.repoList('HierarchicalTeam'));
    eq(m.create.map((v) => [v.name, v.email || '', v.job_function, v.organization, v.country || '', v.resource_type, v.team_id || '']), [
      ['Paul Roy', 'paul.roy@entreprise.com', 'Ingénieur calcul', 'BE', 'FR', 'Interne', team.id],
      ['Ext Consultant', '', 'Consultant', 'Alpha', 'UK', 'Externe', '']
    ]);
    eq(m.update, [{ id: w.mia.id, patch: { job_function: 'Analyste', organization: 'PMO' } }], 'fiche existante : seuls les champs vides');
    eq(m.skipped.length, 3, m.skipped.join(' / '));
    ok(m.skipped.some((s) => /adresse invalide/.test(s)) && m.skipped.some((s) => /doublon/.test(s)) && m.skipped.some((s) => /équipe inconnue/.test(s)));
    eq(w.c.mergePeople_([['Prénom', 'Téléphone'], ['a', 'b']], [], []).skipped.length, 1, 'sans colonne Nom ni E-mail, rien n’est importé');
  });

  // ------------------------------------------------------------ récapitulatif

  function digestWorld() {
    const w = lot2World();
    // Rémi : Spécification en retard (fin 09/10… on se place le 12/10), Calcul à échéance, pas de déclaration depuis 40 jours.
    w.c.CLOCK = (() => { let t = Date.parse('2026-10-12T05:00:00.000Z'); return () => (t += 1); })();
    w.c.repoUpdate('PlanItem', w.b.id, { progress_pct: 20, status: 'En cours', last_progress_at: '2026-08-20T10:00:00Z', planned_finish: '2026-10-16' }, null, w.S);
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { planned_finish: '2026-11-10' } });
    w.call(MEMBER, 'baselines.request', { projectId: w.p1.id, justification: 'Décaler les essais' });
    w.c.runRules();
    w.c.repoUpdate('Resource', w.remi.id, { name: 'Rémi <b>R</b>' }, null, w.S);
    return w;
  }

  test('Récapitulatif : mes livrables (retard, échéance, relance), pilotage, une personne sans rien n’en reçoit pas', () => {
    const w = digestWorld();
    const list = w.c.buildDigests(w.c.loadDigestData_(), '2026-10-12', { baseUrl: 'https://app.test/exec', weekly: true });
    const to = list.map((d) => d.to).sort();
    eq(to, ['carla@entreprise.com', 'dora@entreprise.com', 'remi@entreprise.com'], 'Mia n’a rien à faire ; Xavier est hors domaine');
    const remi = list.find((d) => d.to === RWP);
    ok(/EN RETARD\n- P1 · Spécification \(fin prévue le 09\/10\/2026\)/.test(remi.text), remi.text);
    ok(/À ÉCHÉANCE DANS LES 7 JOURS\n- P1 · Calcul \(le 16\/10\/2026\)/.test(remi.text), remi.text);
    ok(/AVANCEMENT À DÉCLARER\n- P1 · Calcul \(dernière déclaration le 20\/08\/2026\)/.test(remi.text), remi.text);
    ok(remi.html.indexOf('Rémi &lt;b&gt;R&lt;/b&gt;') > 0 && remi.html.indexOf('<b>R</b>') < 0, 'noms échappés dans le HTML');
    ok(/Votre point du 12\/10\/2026 — 3 éléments/.test(remi.subject), remi.subject);
    const carla = list.find((d) => d.to === CP);
    ok(/P1 · 1 changement sur des données figées \(à valider\)/.test(carla.text), carla.text);
    ok(/P1 · demande de baseline de mia@entreprise.com \(Décaler les essais\)/.test(carla.text), carla.text);
    ok(/https:\/\/app.test\/exec\?view=suivi&project=.*&tab=changes/.test(carla.text), 'lien direct vers les changements à valider');
    ok(/Le livrable « Spécification » devait être terminé/.test(carla.text), 'alertes du moteur de règles');
    ok(list.find((d) => d.to === 'dora@entreprise.com').text.indexOf('changement sur des données figées') > 0, 'le DPL du programme suit aussi');
  });

  test('Récapitulatif : fréquence personnelle, week-end, décision sur une demande, aperçu et envoi d’essai', () => {
    const w = digestWorld();
    w.call(RWP, 'settings.set', { notify_frequency: 'Hebdomadaire' });
    w.call(CP, 'settings.set', { notify_frequency: 'Aucun' });
    eq(w.raw(CP, 'settings.set', { notify_frequency: 'Jamais' }).error.code, 'VALIDATION');
    const tuesday = w.c.buildDigests(w.c.loadDigestData_(), '2026-10-13', { weekly: false }).map((d) => d.to);
    eq(tuesday, ['dora@entreprise.com'], 'hebdomadaire : rien le mardi ; « Aucun » : jamais');
    const monday = w.c.buildDigests(w.c.loadDigestData_(), '2026-10-12', { weekly: true });
    ok(monday.some((d) => d.to === RWP && /de la semaine/.test(d.subject)));
    const req = w.c.repoList('Baseline').find((b) => b.status === 'Demandée');
    w.call(CP, 'baselines.refuse', { id: req.id, reason: 'Rattrapable' });
    const mia = w.c.buildDigests(w.c.loadDigestData_(), '2026-10-12', {}).find((d) => d.to === MEMBER);
    ok(mia && /VOS DEMANDES DE BASELINE\n- P1 · refusée \(par carla@entreprise.com\)/.test(mia.text), mia ? mia.text : 'pas de mail pour Mia');
    // Envoi réel : lundi 12/10 → Rémi (hebdo) et Dora, Mia ; pas Carla.
    w.c.SENT_MAILS.length = 0;
    ok(/3 récapitulatif\(s\) envoyé\(s\)/.test(w.c.sendDigests()));
    eq(w.c.SENT_MAILS.map((m) => m.to).sort(), ['dora@entreprise.com', MEMBER, RWP]);
    ok(w.c.SENT_MAILS.every((m) => m.html && m.html.indexOf('<ul') > 0));
    w.c.CLOCK = (() => { let t = Date.parse('2026-10-17T05:00:00.000Z'); return () => (t += 1); })();
    ok(/Week-end/.test(w.c.sendDigests()));
    // Aperçu : Carla (« Aucun ») peut quand même voir et s'envoyer son récapitulatif.
    w.c.SENT_MAILS.length = 0;
    const prev = w.call(CP, 'digest.preview', {});
    ok(prev.html.indexOf('Pilotage de vos projets') > 0 && !prev.sent);
    eq(w.c.SENT_MAILS.length, 0);
    const sent = w.call(CP, 'digest.preview', { send: true });
    eq([sent.sent, w.c.SENT_MAILS.length, /\(essai\)$/.test(w.c.SENT_MAILS[0].subject)], [true, 1, true]);
    const none = w.call('personne@entreprise.com', 'digest.preview', {});
    ok(none.empty && /Aucune fiche/.test(none.reason));
  });
};
