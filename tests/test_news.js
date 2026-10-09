const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nFil d’actualités du projet (0.12.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', XAV = 'xavier@alpha-sous-traitance.com', ZOE = 'zoe@entreprise.com', ADMIN = 'admin@entreprise.com';
  // Jeu : Carla CP de P1 ; Rémi RWP du WP 1 ; Mia membre de P1 ; Dora DPL du programme (donc membre de P1 et de P2) ; Xavier externe sans rôle.

  /** Notes dans le style d'une note Gemini en français. */
  const NOTES = [
    'Notes de la réunion', 'Résumé', 'Revue de la conception avec le bureau d’études : le plan d’essais est stabilisé.', '',
    'Détails', 'On a passé en revue les hypothèses de charge.', '',
    'Décisions', '- Le plan d’essais est validé.', '- Le jalon Revue reste au 9 novembre.', '',
    'Étapes suivantes', '- [Carla] Envoyer le planning révisé : avant le 30/10', '- [Rémi Dupont] Mettre à jour le dossier de calcul', '- Mia: relancer le fournisseur pour le 12 novembre', '- Préparer la salle (Xavier)'
  ].join('\n');

  /** Une personne du bon domaine, sans aucun rôle : elle n'appartient à aucun projet. */
  const zoe = (w) => w.c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zoé', email: ZOE, country: 'FR' }, w.S);
  const people = (w, ids) => {
    const all = w.c.repoList('Resource').map((r) => ({ id: r.id, name: r.name }));
    return { members: all.filter((p) => ids.includes(p.id)), all };
  };

  // ---------------------------------------------------------------- fonctions pures

  test('Dates : formats français, année déduite, dates impossibles ignorées, mots de liaison retirés', () => {
    const w = lot2World(), f = (s, r) => w.c.newsFindDate_(s, r || '2026-10-05');
    eq(f('livrer le 30/10').date, '2026-10-30');
    eq(f('5 novembre').date, '2026-11-05');
    eq(f('le 12/01').date, '2027-01-12', 'sans année, la prochaine date plausible');
    eq(f('15 janv. 2027').date, '2027-01-15');
    eq(f('prévu 2026-12-01').date, '2026-12-01');
    eq(f('le 31/02').date, '', 'date impossible');
    eq(f('rien à signaler').date, '');
    const g = f('Envoyer le plan pour le 30/10');
    eq([g.date, g.text], ['2026-10-30', 'Envoyer le plan'], 'le mot de liaison part avec la date');
    eq(f('Valider avant le 3 décembre').text, 'Valider');
  });

  test('Notes Gemini : résumé, décisions et actions nominatives, personnes reconnues sans ambiguïté', () => {
    const w = lot2World();
    const team = [w.carla.id, w.remi.id, w.mia.id];
    const r = w.c.newsParseNotes_(NOTES, '2026-10-05', people(w, team));
    ok(/Revue de la conception/.test(r.summary), r.summary);
    eq(r.decisions, ['Le plan d’essais est validé.', 'Le jalon Revue reste au 9 novembre.']);
    eq(r.actions.length, 4, JSON.stringify(r.actions));
    const [a, b, c, d] = r.actions;
    eq([a.owner_resource_id, a.text, a.due], [w.carla.id, 'Envoyer le planning révisé', '2026-10-30'], 'forme « [Nom] action : avant le … »');
    eq([b.owner_resource_id, b.owner_label, b.due], [w.remi.id, 'Rémi Dupont', ''], '« Rémi Dupont » dans les notes, « Rémi » dans l’annuaire');
    eq([c.owner_resource_id, c.text, c.due], [w.mia.id, 'relancer le fournisseur', '2026-11-12'], 'forme « Nom : action pour le … »');
    eq([d.owner_resource_id, d.text], [w.xavier.id, 'Préparer la salle'], 'forme « action (Nom) », une personne hors projet reconnue par son nom complet');
  });

  test('Minutes à la main : « Action : … — Nom — date » et « Décision : … » comptent même sans titre de section', () => {
    const w = lot2World(), p = people(w, [w.carla.id, w.mia.id]);
    const r = w.c.newsParseNotes_(['Réunion hebdo', 'Décision : go pour la revue de novembre', 'Action : préparer le dossier de revue — Mia — 30/10', 'Action : réserver la salle ; Carla ; 2 novembre', 'Action : appeler le fournisseur'].join('\n'), '2026-10-05', p);
    eq(r.decisions, ['go pour la revue de novembre']);
    eq(r.actions.map((a) => [a.text, a.owner_resource_id, a.due]), [['préparer le dossier de revue', w.mia.id, '2026-10-30'], ['réserver la salle', w.carla.id, '2026-11-02'], ['appeler le fournisseur', '', '']]);
    eq(w.c.newsParseNotes_('', '2026-10-05', p), { summary: '', decisions: [], actions: [] }, 'un texte vide ne donne rien');
    const odd = w.c.newsParseNotes_('Actions :\n- Objectif : tenir le planning\n- ok', '2026-10-05', p);
    eq(odd.actions.map((a) => [a.text, a.owner_resource_id]), [['Objectif : tenir le planning', '']], 'un mot qui n’est pas une personne n’est pas pris pour un responsable ; une ligne trop courte est ignorée');
  });

  test('Rattachement : repère du titre, deux membres invités, égalités à trier, sans accent ni casse', () => {
    const w = lot2World(), m = (title, att, specs) => w.c.newsMatchProject_({ title, attendees: att }, specs);
    const sp = (id, keywords, members) => ({ id, keywords, members: Object.fromEntries(members.map((e) => [e, true])) });
    const A = sp('A', ['Nacelle', 'NAC-1'], ['a@x.com', 'b@x.com', 'c@x.com']), B = sp('B', ['Train'], ['b@x.com', 'c@x.com', 'd@x.com']);
    eq(m('Revue NACELLE moteur', [], [A, B]), { status: 'ok', projectId: 'A', why: 'repère' }, 'le repère l’emporte, sans tenir compte de la casse');
    eq(m('revue nacélle', [], [sp('A', ['Nacelle'], [])]).status, 'ok', 'ni des accents');
    eq(m('Point train et nacelle', [], [A, B]), { status: 'tie', candidates: ['A', 'B'] }, 'deux repères : à trier');
    eq(m('Point hebdo', ['a@x.com', 'b@x.com', 'c@x.com'], [A, B]), { status: 'ok', projectId: 'A', why: 'membres' }, 'le projet qui compte le plus de membres invités');
    eq(m('Point hebdo', ['b@x.com', 'c@x.com'], [A, B]), { status: 'tie', candidates: ['A', 'B'] }, 'même nombre de membres : à trier');
    eq(m('Point hebdo', ['a@x.com', 'z@x.com'], [A, B]), { status: 'none' }, 'un seul membre invité et aucun repère : pas retenue');
    eq(m('Point', ['A@X.com', 'B@x.com'], [A, B]).status, 'ok', 'adresses comparées sans tenir compte de la casse');
    eq(w.c.newsKeywords_({ news_keywords: 'NAC-1, nac-1 ; a, ✈️,\n Nacelle ' }), ['NAC-1', '✈️', 'Nacelle'], 'doublons retirés ; une seule lettre ignorée, un logo gardé');
  });

  test('Synthèse : le prompt demande cinq sections, la publication refuse un format inconnu', () => {
    const w = lot2World();
    const p = w.c.newsPrompt_(w.p1, [{ held_on: '2026-10-05', title: 'Revue', summary: 'Plan validé', decisions: ['Go'], actions: [{ text: 'Envoyer', owner: 'Carla', due_date: '2026-10-30' }] }], '2026-10-04', '2026-10-05');
    ['Décisions :', 'Dates qui bougent :', 'Risques :', 'Blocages :', 'Actions :', 'P1', 'Revue', 'Envoyer'].forEach((s) => ok(p.includes(s), 'le prompt contient « ' + s + ' »'));
    const good = 'Décisions : le plan est validé, voir la revue du 5 octobre.\nDates qui bougent : rien.\nRisques : retard fournisseur.\nBlocages : aucun.\nActions : Carla — planning — 30/10/2026';
    eq(w.c.newsValidateDigest_(good).ok, true);
    eq(w.c.newsValidateDigest_('## Décisions\nOui, c’est validé pour tout le monde.\n**Risques** : un.\n- Actions : trois').ok, true, 'titres en markdown et puces reconnus');
    const bad = w.c.newsValidateDigest_('Voici un joli résumé libre de la réunion, sans aucune section demandée par le prompt.');
    eq([bad.ok, bad.found.length], [false, 0]);
    eq(w.c.newsValidateDigest_('Décisions : a\nRisques : b').ok, false, 'trop court, deux sections seulement');
  });

  // ---------------------------------------------------------------- droits, saisie, actions

  test('Droits : un membre lit, le chef de projet saisit et gère, un étranger au projet ne voit rien', () => {
    const w = lot2World(); zoe(w);
    eq(w.raw(ZOE, 'news.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'sans rôle dans le projet : refusé');
    const mia = w.call(MEMBER, 'news.get', { projectId: w.p1.id });
    eq([mia.access.view, mia.access.add, mia.access.manage, mia.people, mia.items], [true, false, false, [], []], 'un membre lit, sans pouvoir saisir ni gérer, et ne reçoit pas l’annuaire');
    eq(w.call(RWP, 'news.get', { projectId: w.p1.id }).access.view, true, 'un responsable de lot est membre du projet');
    const carla = w.call(CP, 'news.get', { projectId: w.p1.id });
    eq([carla.access.add, carla.access.manage, carla.people.length > 3, carla.items.map((i) => i.name).sort()], [true, true, true, ['Calcul', 'Essais', 'Spécification']], 'le chef de projet reçoit l’annuaire et les livrables du projet');
    eq(w.call(DPL, 'news.get', { projectId: w.p2.id }).access.manage, true, 'le DPL gère aussi P2');
    eq(w.raw(MEMBER, 'news.meeting.add', { projectId: w.p1.id, title: 'x', text: 'y' }).error.code, 'FORBIDDEN');
    eq(w.raw(MEMBER, 'news.settings.set', { projectId: w.p1.id, enabled: true }).error.code, 'FORBIDDEN');
    eq(w.raw(MEMBER, 'news.digest.prompt', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    eq(w.raw(MEMBER, 'news.journal.update', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    eq(w.call(ZOE, 'news.summary', { projectId: w.p1.id }), { visible: false }, 'le résumé de l’Overview est vide pour qui n’est pas membre');
  });

  test('Saisie manuelle : réunion, actions proposées, doublon refusé, erreurs claires, lecture d’un document', () => {
    const w = lot2World(), c = w.c;
    const add = (v) => w.call(CP, 'news.meeting.add', Object.assign({ projectId: w.p1.id, title: 'Revue de conception', held_on: '2026-10-05', text: NOTES }, v || {}));
    const r = add();
    eq([r.duplicate, r.detected, r.meeting.title, r.meeting.status, r.meeting.decisions.length], [false, 4, 'Revue de conception', 'Publiée', 2]);
    const g = w.call(CP, 'news.get', { projectId: w.p1.id });
    eq(g.meetings.length, 1);
    const byText = Object.fromEntries(g.actions.map((a) => [a.text, a]));
    eq([byText['Envoyer le planning révisé'].owner, byText['Envoyer le planning révisé'].due_date, byText['Envoyer le planning révisé'].status], ['Carla', '2026-10-30', 'Proposée']);
    eq(byText['Préparer la salle'].owner, 'Xavier', 'une personne hors projet est reconnue par son nom complet');
    eq(g.actions.map((a) => a.due_date), ['2026-10-30', '2026-11-12', '', ''], 'triées par échéance, sans date à la fin');
    // doublon : même titre, même date, même texte
    const d = add();
    eq([d.duplicate, c.repoList('Meeting').length, c.repoList('NewsAction').length], [true, 1, 4], 'rien n’est recréé');
    eq(add({ text: NOTES + '\nAction : autre chose — Mia' }).duplicate, false, 'un texte différent n’est pas un doublon');
    // erreurs
    const code = (v) => w.raw(CP, 'news.meeting.add', Object.assign({ projectId: w.p1.id, title: 'T', text: 'x' }, v)).error;
    eq(code({ title: '' }).code, 'VALIDATION');
    eq(code({ held_on: '2026-02-30' }).code, 'VALIDATION', 'date impossible');
    ok(/Collez/.test(code({ text: '' }).message), 'ni texte ni lien');
    ok(/lien/.test(code({ text: '', docUrl: 'https://exemple.test/page' }).message), 'lien qui n’est pas un document Google');
    eq(code({ text: 'x'.repeat(60001) }).code, 'VALIDATION', 'texte trop long');
    // document lu avec le compte de l'outil
    const docs = { '1AbCdEfGhIjKlMnOpQrStUv': NOTES.replace('Revue de la conception', 'Revue lue dans le document') };
    c.NEWS_ADAPTER = { available: true, readDoc: (id) => { if (!docs[id]) throw new Error('refusé'); return docs[id]; } };
    const viaDoc = add({ title: 'Revue lue', text: '', docUrl: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit' });
    ok(/Revue lue dans le document/.test(viaDoc.meeting.summary) && viaDoc.detected === 4, 'le texte vient du document : ' + viaDoc.meeting.summary);
    eq(viaDoc.meeting.doc_url, 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit', 'le lien est gardé comme source');
    ok(/droits/.test(code({ title: 'Autre', text: '', docUrl: 'https://docs.google.com/document/d/9ZyXwVuTsRqPoNmLkJiHgFe/edit' }).message), 'document illisible : on demande de coller le texte');
  });

  test('Actions : la personne accepte, conteste ou termine ; le chef de projet complète ; la contestation le prévient', () => {
    const w = lot2World();
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue', held_on: '2026-10-05', text: NOTES });
    const open = () => w.call(CP, 'news.get', { projectId: w.p1.id }).actions;
    const miaAction = open().find((a) => a.owner === 'Mia'), carlaAction = open().find((a) => a.owner === 'Carla');
    const mine = w.call(MEMBER, 'news.mine', {});
    eq(mine.actions.map((a) => [a.text, a.project, a.status]), [['relancer le fournisseur', 'P1', 'Proposée']], 'Mia voit ses actions, tous projets confondus');
    eq(w.raw(RWP, 'news.action.decide', { id: miaAction.id, decision: 'accept' }).error.code, 'FORBIDDEN', 'une autre personne ne répond pas à sa place');
    eq(w.call(MEMBER, 'news.action.decide', { id: miaAction.id, decision: 'accept' }).status, 'Acceptée');
    w.c.SENT_MAILS.length = 0;
    eq(w.call(MEMBER, 'news.action.decide', { id: miaAction.id, decision: 'contest' }).status, 'Contestée');
    const mail = w.c.SENT_MAILS.filter((m) => m.to === CP);
    eq(mail.length, 1, 'le chef de projet est prévenu');
    ok(/Action contestée — P1/.test(mail[0].subject) && /relancer le fournisseur/.test(mail[0].body), mail[0].subject);
    eq(w.raw(MEMBER, 'news.action.decide', { id: miaAction.id, decision: 'reopen' }).error.code, 'FORBIDDEN', 'seul le chef de projet rouvre');
    eq(w.call(CP, 'news.action.decide', { id: miaAction.id, decision: 'reopen' }).status, 'Proposée');
    eq(w.raw(MEMBER, 'news.action.decide', { id: miaAction.id, decision: 'peut-être' }).error.code, 'VALIDATION');
    eq(w.call(CP, 'news.action.decide', { id: carlaAction.id, decision: 'done' }).status, 'Faite');
    ok(!open().some((a) => a.id === carlaAction.id), 'une action faite sort des actions ouvertes');
    // complétion par le chef de projet
    const noOwner = open().find((a) => a.text === 'Mettre à jour le dossier de calcul');
    const upd = w.call(CP, 'news.action.update', { id: noOwner.id, patch: { owner_resource_id: w.remi.id, due_date: '2026-11-03', item_id: w.b.id, text: 'Mettre à jour le dossier de calcul final' } });
    ok(upd.version > noOwner.version);
    const after = open().find((a) => a.id === noOwner.id);
    eq([after.owner, after.due_date, after.item, after.text], ['Rémi', '2026-11-03', 'Calcul', 'Mettre à jour le dossier de calcul final']);
    eq(w.raw(MEMBER, 'news.action.update', { id: noOwner.id, patch: { due_date: '2026-11-04' } }).error.code, 'FORBIDDEN');
    const foreign = w.call(ADMIN, 'planitems.create', { values: { project_id: w.p2.id, name: 'Moule', item_type: 'Livrable', planned_finish: '2026-11-30' } });
    eq(w.raw(CP, 'news.action.update', { id: noOwner.id, patch: { item_id: foreign.id } }).error.code, 'VALIDATION', 'un livrable d’un autre projet est refusé');
    eq(w.raw(CP, 'news.action.update', { id: noOwner.id, patch: { due_date: '2026-13-01' } }).error.code, 'VALIDATION');
  });

  test('Repères : réservés au chef de projet, dix au plus, gardés tels quels', () => {
    const w = lot2World();
    const r = w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: 'P1,  Nacelle ; ✈️' });
    eq(r, { enabled: true, keywords: 'P1, Nacelle, ✈️' });
    const g = w.call(CP, 'news.get', { projectId: w.p1.id });
    eq([g.project.news_on, g.project.keywords], [true, 'P1, Nacelle, ✈️']);
    eq(w.raw(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: Array.from({ length: 11 }, (_, i) => 'mot' + i).join(',') }).error.code, 'VALIDATION');
    eq(w.raw(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: 'x'.repeat(41) }).error.code, 'VALIDATION');
    eq(w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: false, keywords: '' }).enabled, false);
  });

  // ---------------------------------------------------------------- synthèse et journal

  test('Synthèse du matin : prompt du jour, format vérifié, mail aux membres, une seule publication par jour', () => {
    const w = lot2World(), today = w.c.todayStr();
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue du jour', held_on: today, text: NOTES });
    const pr = w.call(CP, 'news.digest.prompt', { projectId: w.p1.id });
    ok(pr.meetings === 1 && /Revue du jour/.test(pr.prompt) && /Actions :/.test(pr.prompt), pr.prompt.slice(0, 80));
    const err = w.raw(CP, 'news.digest.publish', { projectId: w.p1.id, text: 'Une synthèse libre sans les sections demandées, assez longue pour dépasser le minimum.' });
    ok(err.error.code === 'VALIDATION' && /Format non reconnu/.test(err.error.message), err.error.message);
    eq(w.c.repoList('NewsDigest').length, 0, 'rien n’est publié');
    const text = 'Décisions : le plan d’essais est validé (Revue du jour).\nDates qui bougent : rien.\nRisques : retard fournisseur.\nBlocages : aucun.\nActions : Carla — planning — 30/10/2026';
    w.c.SENT_MAILS.length = 0;
    const pub = w.call(CP, 'news.digest.publish', { projectId: w.p1.id, text });
    eq([pub.date, pub.notified], [today, 4], 'les quatre membres avec adresse, pas Xavier');
    eq(w.c.SENT_MAILS.map((m) => m.to).sort(), [CP, DPL, MEMBER, RWP].sort());
    ok(/Actualités P1/.test(w.c.SENT_MAILS[0].subject) && /plan d’essais est validé/.test(w.c.SENT_MAILS[0].body), w.c.SENT_MAILS[0].subject);
    // une seule synthèse par jour et par projet : la seconde remplace la première
    w.c.SENT_MAILS.length = 0;
    const again = w.call(CP, 'news.digest.publish', { projectId: w.p1.id, text: text.replace('validé', 'validé et signé'), notify: false });
    eq([again.notified, w.c.SENT_MAILS.length, w.c.repoList('NewsDigest').length], [0, 0, 1], 'sans mail si on le demande ; une seule synthèse vivante');
    ok(/signé/.test(w.call(MEMBER, 'news.get', { projectId: w.p1.id }).digest.text), 'les membres lisent la dernière');
    eq(w.raw(MEMBER, 'news.digest.publish', { projectId: w.p1.id, text }).error.code, 'FORBIDDEN');
    eq(w.raw(CP, 'news.digest.publish', { projectId: w.p1.id, text: 'x'.repeat(12001) }).error.code, 'VALIDATION');
  });

  test('Journal du projet : créé puis mis à jour dans le même document, avec fiche et réunions', () => {
    const w = lot2World(), calls = [];
    w.c.NEWS_ADAPTER = { available: true, upsertJournal: (title, lines, docId, folderId) => { calls.push({ title, lines, docId, folderId }); return { id: docId || 'doc-1', url: 'https://docs.test/' + (docId || 'doc-1'), created: !docId }; } };
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue A', held_on: '2026-10-05', text: NOTES });
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue B', held_on: '2026-10-09', text: 'Décisions\n- Go' });
    const first = w.call(CP, 'news.journal.update', { projectId: w.p1.id });
    eq([first.created, first.meetings, first.url], [true, 2, 'https://docs.test/doc-1']);
    const text = calls[0].lines.join('\n');
    ok(/^# Journal du projet — P1 Projet 1/.test(text) && /## Fiche du projet/.test(text) && /Équipe : .*Carla/.test(text) && /Livrables : 3 au total, 0 terminés/.test(text), text.slice(0, 300));
    ok(text.indexOf('Revue B') < text.indexOf('Revue A'), 'la réunion la plus récente en premier');
    ok(/Action : Envoyer le planning révisé — Carla — pour le 30\/10\/2026 \[Proposée\]/.test(text) && /Décision : Go/.test(text), 'actions et décisions écrites');
    const second = w.call(CP, 'news.journal.update', { projectId: w.p1.id });
    eq([second.created, calls[1].docId, w.call(CP, 'news.get', { projectId: w.p1.id }).project.journal_url], [false, 'doc-1', 'https://docs.test/doc-1'.replace('https://docs.test/', 'https://docs.google.com/document/d/') + '/edit'], 'le même document est mis à jour');
  });

  // ---------------------------------------------------------------- collecteur

  /** Fabrique un faux agenda et un faux Docs ; renvoie l'adaptateur et ses journaux d'appels. */
  function fakeNews(events, docs) {
    const calls = { list: [], read: [], journal: [] };
    return {
      calls, available: true,
      listEvents: (from, to) => { calls.list.push([from, to]); return JSON.parse(JSON.stringify(events)); },
      readDoc: (id) => { calls.read.push(id); if (docs[id] === undefined) throw new Error('droits'); return docs[id]; },
      upsertJournal: (title, lines, docId) => { calls.journal.push(title); return { id: docId || 'jr-' + (calls.journal.length), url: 'https://docs.test/x', created: !docId }; }
    };
  }

  test('Collecte : deux membres invités ou un repère ; privées, annulées et sans lien ignorées ; notes jointes lues ; jamais deux fois', () => {
    const w = lot2World(), c = w.c, today = c.todayStr();
    w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: 'P1, Nacelle' });
    const ev = (id, title, att, extra) => Object.assign({ id, title, date: today, start: today + 'T09:00:00+02:00', attendees: att, cancelled: false, isPrivate: false, attachments: [] }, extra || {});
    const events = [
      ev('e1', 'Revue de conception', [CP, MEMBER, 'inconnu@ailleurs.com'], { attachments: [{ fileId: 'n1', title: 'Notes de Gemini — Revue', mime: 'application/vnd.google-apps.document', url: 'https://docs.test/n1' }, { fileId: 'p1', title: 'Présentation', mime: 'application/vnd.google-apps.presentation', url: 'https://docs.test/p1' }] }),
      ev('e2', 'Point confidentiel', [CP, MEMBER], { isPrivate: true }),
      ev('e3', 'Point nacelle', [CP]),
      ev('e4', 'Café', [CP]),
      ev('e5', 'Revue annulée', [CP, MEMBER], { cancelled: true }),
      ev('e6', 'Réunion sans lien', [XAV, 'autre@ailleurs.com'])
    ];
    const fake = fakeNews(events, { n1: NOTES });
    c.NEWS_ADAPTER = fake;
    const r = c.newsCollect_({});
    eq([r.created, r.toTriage, r.skippedPrivate, r.ignored, r.notes, r.errors], [2, 0, 1, 3, 1, 0], JSON.stringify(r));
    const ms = c.repoList('Meeting').sort((a, b) => a.event_id.localeCompare(b.event_id));
    eq(ms.map((m) => [m.event_id, m.source, m.status, m.project_id === w.p1.id]), [['e1', 'Agenda', 'Publiée', true], ['e3', 'Agenda', 'Publiée', true]]);
    ok(/Carla/.test(ms[0].participants) && /Mia/.test(ms[0].participants) && /inconnu/.test(ms[0].participants), 'participants : noms connus, adresse sinon : ' + ms[0].participants);
    eq([ms[0].doc_url, /Revue de la conception/.test(ms[0].summary)], ['https://docs.test/n1', true], 'les notes jointes sont lues, pas la présentation');
    eq(fake.calls.read, ['n1'], 'une seule pièce jointe ouverte');
    eq(c.repoList('NewsAction').filter((a) => a.meeting_id === ms[0].id).length, 4, 'les actions des notes sont proposées');
    ok(!c.repoList('Meeting').some((m) => m.event_id === 'e2'), 'une réunion privée n’est jamais lue : aucune trace');
    // fenêtre : la passe suivante repart de la fin de la précédente, sans rien recréer
    const t1 = fake.calls.list[0][1];
    ok(Date.parse(t1) - Date.parse(fake.calls.list[0][0]) === 86400000, 'première passe : les dernières 24 h');
    eq(c.getProp(c.PROP.NEWS_LAST, ''), t1, 'fin de passe mémorisée');
    const r2 = c.newsCollect_({});
    eq([r2.created, c.repoList('Meeting').length], [0, 2], 'jamais deux fois la même réunion');
    eq(fake.calls.list[1][0], t1, 'la passe suivante commence où la précédente s’est arrêtée');
  });

  test('Collecte : égalité entre projets, « à trier », rattachement ou abandon par le chef de projet', () => {
    const w = lot2World(), c = w.c, today = c.todayStr();
    w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: '' });
    w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: '' });
    w.call(ADMIN, 'news.settings.set', { projectId: w.p2.id, enabled: true, keywords: '' });
    c.repoInsert('RoleAssignment', { resource_id: w.carla.id, role_code: 'CP', scope_type: 'project', scope_id: w.p2.id }, w.S); // Carla et Dora sont membres des deux projets
    const mk = (id, title) => ({ id, title, date: today, start: today + 'T14:00:00+02:00', attendees: [CP, DPL], cancelled: false, isPrivate: false, attachments: [{ fileId: 'n' + id, title: 'Notes Gemini', mime: 'application/vnd.google-apps.document', url: 'https://docs.test/' + id }] });
    c.NEWS_ADAPTER = fakeNews([mk('t1', 'Point transverse'), mk('t2', 'Point transverse bis')], { nt1: 'Étapes suivantes\n- [Mia] Relancer le fournisseur\n- [Carla] Valider le plan', nt2: 'Décision : à revoir' });
    const r = c.newsCollect_({});
    eq([r.created, r.toTriage], [0, 2], 'à égalité de membres invités, rien n’est attribué : à trier');
    const tri = c.repoList('Meeting').filter((m) => m.status === 'À trier');
    eq(tri.map((m) => [m.project_id, m.candidates.split(',').sort().join()]), [['', [w.p1.id, w.p2.id].sort().join()], ['', [w.p1.id, w.p2.id].sort().join()]]);
    // le chef de projet voit la réunion dans sa liste, pas dans le fil
    const g = w.call(CP, 'news.get', { projectId: w.p1.id });
    eq([g.meetings.length, g.triage.length], [0, 2]);
    eq(w.call(MEMBER, 'news.get', { projectId: w.p1.id }).triage, [], 'un membre ne voit pas la liste à trier');
    // rattachement : les actions suivent, les responsables sont retrouvés parmi les membres du projet
    const first = tri.find((m) => m.event_id === 't1');
    const res = w.call(CP, 'news.triage.assign', { id: first.id, projectId: w.p1.id });
    eq(res.actions, 2);
    const g2 = w.call(CP, 'news.get', { projectId: w.p1.id });
    eq([g2.meetings.map((m) => m.title), g2.triage.length, g2.actions.map((a) => a.owner).sort()], [['Point transverse'], 1, ['Carla', 'Mia']]);
    eq(w.raw(CP, 'news.triage.assign', { id: first.id, projectId: w.p1.id }).error.code, 'VALIDATION', 'une réunion déjà rattachée n’est plus à trier');
    eq(w.raw(MEMBER, 'news.triage.drop', { id: tri.find((m) => m.event_id === 't2').id }).error.code, 'FORBIDDEN');
    w.call(CP, 'news.triage.drop', { id: tri.find((m) => m.event_id === 't2').id });
    eq(w.call(CP, 'news.get', { projectId: w.p1.id }).triage.length, 0, 'ignorée');
    eq(c.repoList('Meeting').filter((m) => m.event_id === 't2').length, 0, 'et retirée du classeur (suppression douce)');
  });

  test('Collecte : agenda indisponible, aucun projet actif, passe partielle, déclencheur avec journaux', () => {
    const w = lot2World(), c = w.c, today = c.todayStr();
    ok(/n’est pas accessible/.test(c.newsCollect_({}).skipped), 'sans le service Calendar : ignorée proprement');
    c.NEWS_ADAPTER = fakeNews([], {});
    ok(/Aucun projet/.test(c.newsCollect_({}).skipped), 'aucun projet n’a activé le fil');
    w.call(CP, 'news.settings.set', { projectId: w.p1.id, enabled: true, keywords: 'P1' });
    const evs = ['a', 'b', 'c'].map((k) => ({ id: k, title: 'Réunion P1 ' + k, date: today, start: today + 'T10:00:00+02:00', attendees: [], cancelled: false, isPrivate: false, attachments: [] }));
    const fake = fakeNews(evs, {}); c.NEWS_ADAPTER = fake;
    const part = c.newsCollect_({ budgetMs: -1 });
    eq([part.partial, c.repoList('Meeting').length, c.getProp(c.PROP.NEWS_LAST, '')], [true, 0, ''], 'budget de temps épuisé : rien n’est perdu, la fin de passe n’est pas mémorisée');
    const msg = c.newsCollectRun();
    ok(/3 réunion\(s\) retenue\(s\)/.test(msg) && /1 journal\(aux\) mis à jour/.test(msg), msg);
    eq(fake.calls.journal.length, 1, 'le journal des projets touchés est mis à jour');
    ok(c.getProp(c.PROP.LAST_NEWS, '').includes('"created":3'), 'résultat gardé pour l’administration');
    const calm = c.newsCollectRun();
    ok(/0 réunion\(s\) retenue\(s\).*0 journal/.test(calm), 'rien de neuf, journal déjà créé : pas de mise à jour inutile : ' + calm);
    c.NEWS_ADAPTER = { available: true, listEvents: () => { throw new Error('quota agenda'); } };
    ok(/Collecte en échec : quota agenda/.test(c.newsCollectRun()), 'une panne est dite et mémorisée, sans planter le déclencheur');
    ok(/quota agenda/.test(c.getProp(c.PROP.LAST_NEWS, '')));
  });

  test('Déclencheurs : collecte à 1 h et à 13 h, posés sans doublon', () => {
    const w = lot2World(), c = w.c, made = [], deleted = [];
    c.ScriptApp = {
      getProjectTriggers: () => made.filter((t) => !t.gone).map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => { t._t.gone = true; deleted.push(t._t.fn); },
      newTrigger: (fn) => { const t = { fn, hour: null }; made.push(t); const b = { timeBased: () => b, atHour: (h) => { t.hour = h; return b; }, everyDays: () => b, after: () => b, create: () => t }; return b; }
    };
    const msg = c.installTriggers();
    eq(made.filter((t) => t.fn === 'newsCollectRun').map((t) => t.hour).sort((a, b) => a - b), [1, 13]);
    ok(/1 h et à 13 h/.test(msg), msg);
    c.installTriggers();
    eq(made.filter((t) => t.fn === 'newsCollectRun' && !t.gone).length, 2, 'une seconde installation ne double pas les déclencheurs');
    eq(typeof c.newsCollectRun, 'function', 'le gestionnaire est une fonction publique de l’éditeur');
  });

  // ---------------------------------------------------------------- récapitulatif et Overview

  test('Récapitulatif du matin : synthèse publiée ou journal brut, et les actions qui attendent la personne', () => {
    const w = lot2World(), c = w.c, today = c.todayStr(); zoe(w);
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue du jour', held_on: today, text: NOTES });
    const digestFor = (email) => c.buildDigests(c.loadDigestData_(), today, { baseUrl: 'https://ppm.test/exec' }).filter((d) => d.to === email)[0];
    let d = digestFor(MEMBER);
    ok(/ACTUALITÉS P1 \(JOURNAL BRUT : PAS DE SYNTHÈSE PUBLIÉE\)/.test(d.text) && /Revue du jour/.test(d.text), 'sans synthèse : le journal brut des réunions de la veille');
    ok(/VOS ACTIONS ISSUES DES RÉUNIONS/.test(d.text) && /P1 · relancer le fournisseur \(à accepter ou contester\)/.test(d.text), 'l’action proposée à Mia attend sa réponse');
    ok(/view=actualites&project=/.test(d.text), 'avec le lien vers la page');
    ok(!/ACTUALITÉS/.test((digestFor(ZOE) || { text: '' }).text), 'Zoé, sans rôle dans le projet, ne reçoit rien du projet');
    w.call(CP, 'news.digest.publish', { projectId: w.p1.id, notify: false, text: 'Décisions : plan validé.\nDates qui bougent : rien.\nRisques : aucun risque nouveau.\nBlocages : aucun.\nActions : voir la liste.' });
    d = digestFor(MEMBER);
    ok(/ACTUALITÉS P1\n/.test(d.text) && /Décisions : plan validé/.test(d.text) && !/journal brut/.test(d.text), 'avec une synthèse publiée : c’est elle qui part');
    const miaAction = w.call(MEMBER, 'news.mine', {}).actions[0];
    w.call(MEMBER, 'news.action.decide', { id: miaAction.id, decision: 'accept' });
    d = digestFor(MEMBER);
    ok(!/VOS ACTIONS/.test(d.text), 'acceptée et sans échéance proche : plus dans le récapitulatif');
    const ma = c.repoList('NewsAction').find((a) => a.id === miaAction.id);
    c.repoUpdate('NewsAction', ma.id, { due_date: c.addCalendarDays(today, -2) }, null, w.S);
    d = digestFor(MEMBER);
    ok(/en retard/.test(d.text), 'une action acceptée en retard est rappelée');
  });

  test('Overview : résumé des actualités pour les membres seulement', () => {
    const w = lot2World(), today = w.c.todayStr(); zoe(w);
    w.call(CP, 'news.meeting.add', { projectId: w.p1.id, title: 'Revue du jour', held_on: today, text: NOTES });
    w.call(CP, 'news.digest.publish', { projectId: w.p1.id, notify: false, text: 'Décisions : plan validé.\nDates qui bougent : rien.\nRisques : aucun risque nouveau.\nBlocages : aucun.\nActions : voir la liste.' });
    const s = w.call(MEMBER, 'news.summary', { projectId: w.p1.id });
    eq([s.visible, s.meetings.length, s.open_actions, s.mine, s.digest.date], [true, 1, 4, 1, today]);
    ok(/Décisions : plan validé/.test(s.digest.text));
    eq(w.call(ZOE, 'news.summary', { projectId: w.p1.id }), { visible: false });
  });
};
