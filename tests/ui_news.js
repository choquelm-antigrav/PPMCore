/**
 * Essai de la page Actualités : synthèse du matin, actions, fil des réunions, à trier, ajout d'un compte rendu, repères (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_news.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

const NOTES = ['Résumé', 'Revue de la conception.', '', 'Décisions', '- Le plan d’essais est validé.', '', 'Étapes suivantes', '- [Carla] Envoyer le planning révisé : avant le 30/10', '- Mia: relancer le fournisseur pour le 12 novembre', '- [Rémi] Mettre à jour le dossier de calcul'].join('\n');

function openPage(user, file, view) {
  const html = src(file || 'Actualites.html').replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: view || 'actualites', home: 'overview', isAdmin: false, canBudget: true }))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const copied = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
      function runner(ok, fail) {
        return {
          withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
          uiCall: (action, params, rid) => {
            c.Session = { getActiveUser: () => ({ getEmail: () => user }) };
            const out = JSON.parse(JSON.stringify(c.uiCall(action, params, rid)));
            if (ok) setTimeout(() => ok(out), 0);
          }
        };
      }
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const win = dom.window, doc = win.document;
  const until = async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; };
  const $ = (id) => doc.getElementById(id);
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = (id) => flat(($(id) || { textContent: '' }).textContent);
  const type = (id, v) => { $(id).value = v; $(id).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const row = (id) => doc.querySelector('#actions-table tr[data-id="' + id + '"]');
  return { win, doc, until, $, click, text, type, row, copied };
}

(async () => {
  console.log('\nPage Actualités (jsdom)');

  // ---------------------------------------------------------------- chef de projet, projet vide
  let p = openPage(CP);
  await p.until(() => p.$('panel-feed').textContent.length > 0);
  check(/Aucune réunion retenue/.test(p.text('feed-empty')) && /Ajoutez un compte rendu/.test(p.text('feed-empty')), 'projet sans réunion : le fil explique quoi faire');
  check(/Aucune synthèse publiée/.test(p.text('digest-empty')), 'pas de synthèse publiée');
  check(!p.$('zone-add').hidden && !p.$('zone-settings').hidden && p.$('zone-triage').hidden, 'le chef de projet voit l’ajout et les repères ; rien à trier');
  check(/P1 Projet 1 · 0 réunion · 0 action ouverte/.test(p.text('context')), 'contexte : ' + p.text('context'));

  // ---------------------------------------------------------------- ajout d'un compte rendu
  p.$('add-title').value = 'Revue de conception';
  p.$('add-date').value = '2026-10-05';
  p.$('add-text').value = NOTES;
  p.click(p.$('add-ok'));
  await p.until(() => p.doc.querySelectorAll('#panel-feed .meeting').length === 1);
  check(/Revue de conception/.test(p.text('panel-feed')) && /Le plan d’essais est validé/.test(p.text('panel-feed')) && /saisi à la main/.test(p.text('panel-feed')), 'la réunion apparaît dans le fil avec sa décision');
  check(p.doc.querySelectorAll('#actions-table tbody tr').length === 3 && /3 actions ouvertes/.test(p.text('actions-count')), 'trois actions proposées : ' + p.text('actions-count'));
  check(/05\/10\/2026/.test(p.text('panel-feed')) && /30\/10\/2026/.test(p.text('actions-table')), 'dates à la française');
  // doublon
  p.$('add-title').value = 'Revue de conception'; p.$('add-date').value = '2026-10-05'; p.$('add-text').value = NOTES;
  p.click(p.$('add-ok'));
  await p.until(() => /déjà dans le fil/.test(p.text('toast')));
  check(p.doc.querySelectorAll('#panel-feed .meeting').length === 1, 'le même compte rendu n’est pas ajouté deux fois');

  // ---------------------------------------------------------------- disposition : le fil du projet à gauche, le reste en sections repliables à droite
  const cols = p.$('news-cols'), main = p.$('news-main'), side = p.$('news-side');
  const css = [...p.doc.querySelectorAll('style')].map((x) => x.textContent).join('\n');
  check(cols && cols.firstElementChild === main && cols.lastElementChild === side, 'deux colonnes ; la colonne du fil du projet vient d’abord dans le code (donc en premier sur téléphone)');
  check(main.contains(p.$('zone-feed')) && main.contains(p.$('panel-feed')) && !main.contains(p.$('zone-digest')) && ['digest', 'actions', 'triage', 'add', 'settings'].every((z) => side.contains(p.$('zone-' + z)) && side.contains(p.$('panel-' + z))), 'le fil du projet est seul dans la colonne principale ; la synthèse, les actions, les réunions à trier, l’ajout et les repères sont dans l’autre');
  check(/\.news-cols \{[^}]*flex-direction: row;/.test(css) && !/row-reverse/.test(css) && /@media \(max-width: 980px\)[^{]*\{[^}]*\.news-cols \{[^}]*flex-direction: column/.test(css), 'le fil est à GAUCHE sur grand écran (plus de colonne inversée) ; une seule colonne sous 980 px');
  const sec = (n) => ({ btn: p.$('toggle-' + n), panel: p.$('panel-' + n), open: p.$('toggle-' + n).getAttribute('aria-expanded') === 'true', sum: p.text('sum-' + n) });
  check(['digest', 'actions', 'triage', 'add', 'settings'].every((n) => sec(n).btn.getAttribute('aria-controls') === 'panel-' + n && sec(n).open === !sec(n).panel.classList.contains('collapsed')), 'chaque section est un bouton lié à son contenu : l’état déplié et le contenu replié ne se contredisent jamais');
  check(sec('actions').open && /ouvertes/.test(sec('actions').sum) && /pour moi/.test(sec('actions').sum) && sec('actions').btn.classList.contains('needs'), 'des actions m’attendent (à accepter) : la section s’ouvre toute seule et le résumé le dit : ' + sec('actions').sum);
  check(!sec('add').open && sec('add').panel.classList.contains('collapsed') && sec('add').sum === '', 'l’ajout d’un compte rendu reste replié tant qu’on n’en a pas besoin');
  check(sec('digest').open && /aucune publiée/.test(sec('digest').sum) && sec('digest').btn.classList.contains('needs'), 'le chef de projet n’a pas encore publié la synthèse du jour : la section est ouverte, « aucune publiée »');
  check(sec('settings').open && /collecte non activée/.test(sec('settings').sum), 'collecte pas encore réglée : la section des repères est ouverte : ' + sec('settings').sum);
  p.click(p.$('toggle-add'));
  check(sec('add').open && !sec('add').panel.classList.contains('collapsed') && p.$('toggle-add').querySelector('.chev').textContent === '▾', 'un clic ouvre la section');
  p.click(p.$('toggle-actions'));
  check(!sec('actions').open && sec('actions').panel.classList.contains('collapsed'), 'et un clic ferme même une section ouverte d’office');
  await p.win.__ppm.load();
  await p.until(() => p.$('toggle-add').getAttribute('aria-expanded') === 'true');
  check(sec('add').open && !sec('actions').open, 'le choix de la personne est gardé quand la page se recharge');
  p.click(p.$('toggle-add'));
  check(/Sans repère dans le titre, une réunion n’est jamais collectée/.test(p.text('panel-settings')) && /une réunion n’est collectée que si son titre contient un de ces mots/.test(p.text('panel-settings')) && !/au moins deux membres/.test(p.text('panel-settings')), 'la zone des repères dit la règle : pas de repère dans le titre, pas de collecte, même avec des membres invités');

  // ---------------------------------------------------------------- réunions du fil : repliées, dépliées au clic, avec leurs pièces jointes
  c.repoInsert('Meeting', { project_id: w.p1.id, source: 'Agenda', event_id: 'evx', held_on: '2026-10-12', title: 'Revue structure P1', participants: 'Carla, Mia', doc_url: 'https://docs.test/cr', summary: 'On a validé le plan de calcul de la structure.',
    decisions: 'Le calcul est gelé.\nLes essais commencent le 19.', status: 'Publiée', dedupe_key: 'ev:evx',
    attachments: JSON.stringify([{ title: 'Plan de calcul.pdf', url: 'https://docs.test/pdf', mime: 'application/pdf' }, { title: 'Maquette', url: 'https://docs.test/pres', mime: 'application/vnd.google-apps.presentation' }, { title: 'Piège', url: 'javascript:alert(1)', mime: '' }]) }, w.S);
  await p.win.__ppm.load();
  await p.until(() => p.doc.querySelectorAll('#panel-feed .meeting').length === 2);
  const card = () => [...p.doc.querySelectorAll('#panel-feed .meeting')].find((x) => /Revue structure P1/.test(x.textContent));
  const head = () => card().querySelector('.meeting-head'), bodyOf = () => card().querySelector('.meeting-body');
  check(head().getAttribute('aria-expanded') === 'false' && bodyOf().hidden && [...p.doc.querySelectorAll('#panel-feed .meeting-body')].every((b) => b.hidden), 'toutes les réunions du fil sont repliées au départ');
  check(/12\/10\/2026/.test(card().querySelector('.meta').textContent) && /2 décisions · 2 pièces jointes/.test(card().querySelector('.meta').textContent), 'replié, on voit la date et ce que la réunion contient : ' + flat(card().querySelector('.meta').textContent));
  p.click(head());
  check(head().getAttribute('aria-expanded') === 'true' && !bodyOf().hidden && /On a validé le plan de calcul/.test(bodyOf().textContent) && /Participants : Carla, Mia/.test(bodyOf().textContent) && /Le calcul est gelé/.test(bodyOf().textContent), 'un clic sur le titre déplie la réunion : résumé, participants, décisions');
  const links = [...bodyOf().querySelectorAll('a[data-kind="attachment"]')];
  check(links.length === 2 && links[0].getAttribute('href') === 'https://docs.test/pdf' && /Plan de calcul\.pdf/.test(links[0].textContent) && links[0].getAttribute('target') === '_blank' && /noopener/.test(links[0].getAttribute('rel')), 'les pièces jointes sont des liens qui s’ouvrent dans un nouvel onglet : ' + links.map((a) => a.textContent).join(' | '));
  check(!bodyOf().querySelector('a[href^="javascript"]') && bodyOf().querySelector('a[data-kind="source"]').getAttribute('href') === 'https://docs.test/cr', 'une adresse qui n’est pas en https n’est jamais affichée comme lien ; le compte rendu source reste accessible');
  p.click(head());
  check(head().getAttribute('aria-expanded') === 'false' && bodyOf().hidden, 'un second clic la replie');
  // la page se défend aussi toute seule : même si le serveur laissait passer une adresse non sécurisée, elle n'est jamais un lien
  const realGet = c.API_ACTIONS['news.get'];
  c.API_ACTIONS['news.get'] = (params, ctx) => { const r = realGet(params, ctx); r.meetings.forEach((m) => { m.attachments = (m.attachments || []).concat([{ title: 'Piège', url: 'javascript:alert(2)', mime: '' }]); m.doc_url = m.doc_url || 'javascript:alert(3)'; }); return r; };
  await p.win.__ppm.load();
  await p.until(() => p.doc.querySelectorAll('#panel-feed .meeting').length === 2);
  check(!p.doc.querySelector('#panel-feed a[href^="javascript"]') && p.doc.querySelectorAll('#panel-feed a[data-kind="attachment"]').length === 2, 'côté page : une adresse qui n’est pas en https n’est jamais affichée comme lien (ni pièce jointe, ni source)');
  c.API_ACTIONS['news.get'] = realGet;
  await p.win.__ppm.load();
  await p.until(() => p.doc.querySelectorAll('#panel-feed .meeting').length === 2);
  p.click(p.$('feed-open-all'));
  check([...p.doc.querySelectorAll('#panel-feed .meeting-head')].every((b) => b.getAttribute('aria-expanded') === 'true'), '« Tout déplier »');
  await p.win.__ppm.load();
  await p.until(() => p.doc.querySelectorAll('#panel-feed .meeting').length === 2);
  check([...p.doc.querySelectorAll('#panel-feed .meeting-head')].every((b) => b.getAttribute('aria-expanded') === 'true'), 'ce qui est déplié le reste quand la page se recharge');
  p.click(p.$('feed-close-all'));
  check([...p.doc.querySelectorAll('#panel-feed .meeting-body')].every((b) => b.hidden), '« Tout replier »');
  check(/Aucune pièce jointe/.test(([...p.doc.querySelectorAll('#panel-feed .meeting')].find((x) => /Revue de conception$/.test(x.querySelector('.mt').textContent)) || { textContent: '' }).textContent), 'une réunion sans pièce jointe le dit');
  // erreur lisible
  p.$('add-title').value = ''; p.$('add-text').value = 'x';
  p.click(p.$('add-ok'));
  await p.until(() => !p.$('add-error').hidden);
  check(/titre/.test(p.text('add-error')), 'erreur claire sans titre : ' + p.text('add-error'));

  // ---------------------------------------------------------------- actions : compléter, répondre
  const rows = () => [...p.doc.querySelectorAll('#actions-table tbody tr')];
  const remiRow = rows().find((r) => /Mettre à jour le dossier/.test(r.textContent));
  check(/Rémi/.test(remiRow.textContent), 'responsable reconnu : Rémi');
  p.click(rows().find((r) => /Envoyer le planning/.test(r.textContent)).querySelector('[data-act="edit"]'));
  await p.until(() => p.$('action-dialog').open);
  check(p.$('af-owner').value === w.carla.id && p.$('af-due').value === '2026-10-30', 'le formulaire reprend le responsable et l’échéance');
  p.$('af-item').value = w.b.id;
  p.$('af-due').value = '2026-11-02';
  p.$('action-form').dispatchEvent(new p.win.Event('submit', { cancelable: true }));
  await p.until(() => !p.$('action-dialog').open && /Calcul/.test(p.text('actions-table')));
  check(/02\/11\/2026/.test(p.text('actions-table')) && /Calcul/.test(p.text('actions-table')), 'échéance et livrable enregistrés');
  p.click(rows().find((r) => /relancer le fournisseur/.test(r.textContent)).querySelector('[data-act="contest"]'));
  await p.until(() => /Contestée/.test(p.text('actions-table')));
  check(!c.SENT_MAILS.some((m) => m.to === CP && /Action contestée/.test(m.subject)), 'le chef de projet qui conteste lui-même n’est pas prévenu de sa propre action');
  check(/Contestée/.test(rows().find((r) => /relancer le fournisseur/.test(r.textContent)).textContent), 'statut « Contestée » affiché');
  p.click(rows().find((r) => /Mettre à jour le dossier/.test(r.textContent)).querySelector('[data-act="done"]'));
  await p.until(() => rows().length === 2);
  check(rows().length === 2, 'une action faite sort de la liste ouverte');

  // ---------------------------------------------------------------- synthèse : prompt, format, publication
  p.click(p.$('prompt-btn'));
  await p.until(() => p.$('prompt-dialog').open);
  check(/Décisions :/.test(p.$('prompt-text').value) && /Actions :/.test(p.$('prompt-text').value) && /P1/.test(p.$('prompt-text').value), 'le prompt du jour demande les cinq sections');
  p.click(p.$('prompt-copy'));
  await p.until(() => p.copied.length === 1);
  check(p.copied[0] === p.$('prompt-text').value, 'copié dans le presse-papiers');
  const dayLogo = (/Logo du jour : (\S+) — commence la synthèse/.exec(p.$('prompt-text').value) || [])[1];
  check(!!dayLogo && c.NEWS_LOGOS.includes(dayLogo) && p.text('prompt-note').indexOf('Logo du jour : ' + dayLogo) >= 0, 'le prompt contient le logo du jour et la fenêtre le rappelle : ' + dayLogo);
  check(/Gemini/.test(p.text('prompt-note')) && !/NotebookLM|carnet/i.test(p.doc.documentElement.textContent), 'la page ne parle plus de NotebookLM : elle renvoie à Gemini');
  p.click(p.$('prompt-close'));
  p.click(p.$('publish-btn'));
  await p.until(() => p.$('publish-dialog').open);
  p.$('publish-text').value = 'Une synthèse libre sans les sections demandées mais assez longue pour passer le contrôle de longueur.';
  p.$('publish-form').dispatchEvent(new p.win.Event('submit', { cancelable: true }));
  await p.until(() => !p.$('publish-error').hidden);
  check(/Format non reconnu/.test(p.text('publish-error')) && p.$('publish-dialog').open, 'format inconnu : refusé dans la fenêtre, sans rien publier');
  p.$('publish-text').value = 'Décisions : le plan d’essais est validé.\nDates qui bougent : rien.\nRisques : retard fournisseur.\nBlocages : aucun.\nActions : Carla — planning — 02/11/2026';
  c.SENT_MAILS.length = 0;
  p.$('publish-form').dispatchEvent(new p.win.Event('submit', { cancelable: true }));
  await p.until(() => !p.$('publish-dialog').open && p.$('digest-text'));
  check(/Décisions : le plan d’essais est validé/.test(p.text('digest-text')) && /publiée aujourd’hui|pas celle d’aujourd’hui/.test(p.text('panel-digest')), 'la synthèse publiée s’affiche');
  check(!p.$('digest-logo') && /ne figure pas dans la synthèse/.test(p.text('toast')) && /publiée aujourd’hui/.test(p.text('sum-digest')) && !p.$('toggle-digest').classList.contains('needs'), 'sans le logo du jour dans le texte : le message le dit, aucun logo n’est affiché ; la synthèse du jour est publiée, la section n’a plus rien à demander');
  // republier avec le logo du jour : il s'affiche en tête de la synthèse
  p.click(p.$('publish-btn'));
  await p.until(() => p.$('publish-dialog').open);
  p.$('publish-notify').checked = false;   // pas de nouveaux mails : la publication précédente a déjà prévenu les membres
  p.$('publish-text').value = dayLogo + '\nDécisions : le plan d’essais est validé.\nDates qui bougent : rien.\nRisques : retard fournisseur.\nBlocages : aucun.\nActions : Carla — planning — 02/11/2026';
  p.$('publish-form').dispatchEvent(new p.win.Event('submit', { cancelable: true }));
  await p.until(() => !p.$('publish-dialog').open && p.$('digest-logo'));
  check(p.text('digest-logo') === dayLogo && !/ne figure pas/.test(p.text('toast')), 'avec le logo du jour dans la synthèse : il s’affiche en tête de la synthèse');
  check(c.SENT_MAILS.length === 3, 'trois mails partis (chef de projet, DPL, Workpackage leader : ceux qui peuvent lire les comptes rendus) : ' + c.SENT_MAILS.length);

  // ---------------------------------------------------------------- repères et journal
  p.$('set-on').checked = true;
  p.$('set-words').value = 'P1, Nacelle';
  p.click(p.$('set-save'));
  await p.until(() => /Réglages enregistrés/.test(p.text('toast')));
  check(c.repoList('Project').find((x) => x.id === w.p1.id).news_on === true && /Nacelle/.test(c.repoList('Project').find((x) => x.id === w.p1.id).news_keywords), 'repères enregistrés dans le projet');
  check(/Pas encore créé/.test(p.text('journal-note')), 'journal : pas encore créé');
  c.NEWS_ADAPTER = { available: true, upsertJournal: () => ({ id: 'jr1', url: 'https://docs.google.com/document/d/jr1/edit', created: true }) };
  p.click(p.$('journal-btn'));
  await p.until(() => p.$('journal-link'));
  check(/jr1/.test(p.$('journal-link').getAttribute('href')), 'le journal est créé et le lien apparaît');

  // ---------------------------------------------------------------- réunions à trier
  const cands = [w.p1.id, w.p2.id].join(',');
  const tri = c.repoInsert('Meeting', { project_id: '', source: 'Agenda', event_id: 'zz1', held_on: '2026-10-06', title: 'Point transverse', participants: 'Carla, Dora', summary: 'Alignement.', decisions: '', status: 'À trier', candidates: cands, dedupe_key: 'ev:zz1', added_by: 'collecteur' }, w.S);
  c.repoInsert('NewsAction', { meeting_id: tri.id, project_id: '', owner_resource_id: '', owner_label: 'Mia', text: 'Aligner les interfaces', due_date: '', item_id: '', status: 'Proposée' }, w.S);
  p = openPage(CP);
  await p.until(() => !p.$('zone-triage').hidden);
  check(/Point transverse/.test(p.text('panel-triage')), 'la réunion à trier est proposée au chef de projet');
  p.click(p.doc.querySelector('#panel-triage [data-act="assign"]'));
  await p.until(() => p.$('zone-triage').hidden);
  check(/Point transverse/.test(p.text('panel-feed')) && /Aligner les interfaces/.test(p.text('actions-table')), 'rattachée : elle entre dans le fil et ses actions dans la liste');
  check(rows2(p).some((r) => /Aligner les interfaces/.test(r.textContent) && /Mia/.test(r.textContent)), 'le responsable est retrouvé parmi les membres du projet');
  function rows2(pg) { return [...pg.doc.querySelectorAll('#actions-table tbody tr')]; }

  // ---------------------------------------------------------------- un Workpackage leader : lecture seule ; un Contributor : les comptes rendus lui sont fermés
  const m = openPage(RWP);
  await m.until(() => m.$('actions-table'));
  check(m.$('zone-add').hidden && m.$('zone-settings').hidden && m.$('zone-triage').hidden, 'un Workpackage leader ne voit ni l’ajout, ni les repères, ni la liste à trier');
  check(!m.$('prompt-btn') && !m.$('publish-btn'), 'ni le prompt ni la publication');
  check(!!m.$('digest-text'), 'mais il lit la synthèse');
  const other = [...m.doc.querySelectorAll('#actions-table tbody tr')].find((r) => /Aligner les interfaces/.test(r.textContent) === false && !/Mia/.test(r.textContent));
  check(!other || !other.querySelector('[data-act]'), 'sur l’action d’un autre : aucun bouton');
  const mia = openPage(MEMBER);
  await mia.until(() => /réservés aux Workpackage leaders/.test(mia.doc.body.textContent));
  check(/réservés aux Workpackage leaders/.test(mia.doc.body.textContent) && !mia.$('digest-text'), 'un Contributor : message clair, pas de comptes rendus (ses actions restent dans Mon compte)');

  // ---------------------------------------------------------------- Overview : la carte « Actualités du projet »
  const ov = openPage(RWP, 'Overview.html', 'overview');
  await ov.until(() => !ov.$('news-box').hidden);
  check(/Décisions : le plan d’essais est validé/.test(ov.text('news-digest')), 'Overview : la dernière synthèse publiée s’affiche : ' + ov.text('news-digest').slice(0, 60));
  check(/3 actions ouvertes/.test(ov.text('news-actions')), 'Overview : les actions ouvertes : ' + ov.text('news-actions'));
  check(/view=actualites&project=/.test(ov.$('news-link').getAttribute('href')), 'Overview : lien vers la page Actualités du projet');
  const ovm = openPage(MEMBER, 'Overview.html', 'overview');
  await ovm.until(() => ovm.$('kpis') && ovm.$('kpis').children.length > 0);
  await wait(150);
  check(ovm.$('news-box').hidden, 'Overview : la carte reste masquée pour un Contributor (comptes rendus à partir du Workpackage leader)');
  c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zoé', email: 'zoe@entreprise.com', country: 'FR' }, w.S);
  const ovz = openPage('zoe@entreprise.com', 'Overview.html', 'overview');
  await ovz.until(() => ovz.$('kpis') && ovz.$('kpis').children.length > 0);
  await wait(150);
  check(ovz.$('news-box').hidden, 'Overview : la carte reste masquée pour qui n’est pas membre du projet');

  // ---------------------------------------------------------------- Mon compte : « Mes actions issues des réunions »
  const co = openPage(MEMBER, 'Compte.html', 'compte');
  await co.until(() => !co.$('zone-mine').hidden);
  const mineRows = () => [...co.doc.querySelectorAll('#mine-table tbody tr')];
  const relance = () => mineRows().find((r) => /relancer le fournisseur/.test(r.textContent));
  check(mineRows().length === 2 && !!relance() && /P1/.test(relance().textContent) && /Contestée/.test(relance().textContent), 'Mon compte : les deux actions de Mia, avec leur projet et leur statut');
  co.click(relance().querySelector('[data-act="accept"]'));
  await co.until(() => /Acceptée/.test(co.text('mine-table')));
  check(c.repoList('NewsAction').find((a) => /relancer le fournisseur/.test(a.text)).status === 'Acceptée', 'Mon compte : « Accepter » enregistre la réponse');
  co.click(mineRows()[0].querySelector('[data-act="done"]'));
  await co.until(() => mineRows().length === 1);
  co.click(mineRows()[0].querySelector('[data-act="done"]'));
  await co.until(() => co.$('zone-mine').hidden);
  check(co.$('zone-mine').hidden, 'Mon compte : sans action ouverte, la zone disparaît');
  const cz = openPage('zoe@entreprise.com', 'Compte.html', 'compte');
  await cz.until(() => cz.$('panel-fiche').children.length > 0);
  await wait(150);
  check(cz.$('zone-mine').hidden, 'Mon compte : pas de zone pour qui n’a aucune action');


  const norm = (t) => String(t).replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  const programOptions = (x) => [...x.$('picker').options].filter((o) => /^program:/.test(o.value));
  const chooseProgram = (x) => { x.$('picker').value = 'program:' + w.prog.id; x.$('picker').dispatchEvent(new x.win.Event('change')); };
  // ---------------------------------------------------------------- 0.14.1 : vue programme (Program Leader et Domain Program Leader)
  const cpN = openPage(CP);
  await cpN.until(() => cpN.$('picker').options.length >= 2);
  check(programOptions(cpN).length === 0, 'un chef de projet n’a pas la vue programme dans la liste');
  const dn = openPage('dora@entreprise.com');
  await dn.until(() => programOptions(dn).length === 1);
  await dn.until(() => !dn.$('panel-feed').hidden);
  chooseProgram(dn);
  await dn.until(() => dn.doc.querySelector('#panel-program table.consol'));
  const rowsN = [...dn.doc.querySelectorAll('#panel-program tbody tr')];
  check(rowsN.length >= 2 && /Actions ouvertes/.test(dn.text('panel-program')) && /Réunions des 14 derniers jours/.test(dn.text('panel-program')) && /Actions ouvertes, toutes équipes/.test(dn.text('panel-program')), 'actualités du programme : tableau des projets, réunions récentes, actions ouvertes');
  check(dn.doc.body.classList.contains('in-program') && ['digest', 'actions', 'feed', 'triage', 'add', 'settings'].every((z) => [...dn.doc.querySelectorAll('style')].some((s) => s.textContent.includes('body.in-program #panel-' + z))) && /Actualités — Programme/.test(dn.text('title')), 'les zones du projet sont masquées en vue programme par une règle de la page');
  dn.click(dn.doc.querySelector('#panel-program tbody tr button.proj-open'));
  await dn.until(() => dn.$('panel-program').hidden && !dn.doc.body.classList.contains('in-program'));
  check(/^[\w-]+$/.test(dn.$('picker').value) && !/^program:/.test(dn.$('picker').value) && dn.$('zone-program').hidden && !dn.$('panel-feed').hidden, 'un clic sur un projet ouvre son fil et referme la vue programme');
  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Actualités : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
