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
  const html = src(file || 'Actualites.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'))
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
  check(c.SENT_MAILS.length === 4, 'quatre mails partis (les membres du projet) : ' + c.SENT_MAILS.length);

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

  // ---------------------------------------------------------------- un membre : lecture, ses propres actions
  const m = openPage(MEMBER);
  await m.until(() => m.$('actions-table'));
  check(m.$('zone-add').hidden && m.$('zone-settings').hidden && m.$('zone-triage').hidden, 'un membre ne voit ni l’ajout, ni les repères, ni la liste à trier');
  check(!m.$('prompt-btn') && !m.$('publish-btn'), 'ni le prompt ni la publication');
  check(!!m.$('digest-text'), 'mais il lit la synthèse');
  const mineRow = [...m.doc.querySelectorAll('#actions-table tbody tr')].find((r) => /relancer le fournisseur/.test(r.textContent));
  check(!!mineRow.querySelector('[data-act="accept"]') && !mineRow.querySelector('[data-act="edit"]'), 'sur sa propre action : répondre oui, compléter non');
  const other = [...m.doc.querySelectorAll('#actions-table tbody tr')].find((r) => /Aligner les interfaces/.test(r.textContent) === false && !/Mia/.test(r.textContent));
  check(!other || !other.querySelector('[data-act]'), 'sur l’action d’un autre : aucun bouton');
  m.click(m.$('mine-only'));
  check([...m.doc.querySelectorAll('#actions-table tbody tr')].every((r) => /Mia/.test(r.textContent)), '« Seulement les miennes » filtre la liste');

  // ---------------------------------------------------------------- un responsable de lot (membre du projet)
  const r = openPage(RWP);
  await r.until(() => r.$('actions-table'));
  check(r.$('zone-add').hidden, 'un responsable de lot lit sans saisir');

  // ---------------------------------------------------------------- Overview : la carte « Actualités du projet »
  const ov = openPage(MEMBER, 'Overview.html', 'overview');
  await ov.until(() => !ov.$('news-box').hidden);
  check(/Décisions : le plan d’essais est validé/.test(ov.text('news-digest')), 'Overview : la dernière synthèse publiée s’affiche : ' + ov.text('news-digest').slice(0, 60));
  check(/3 actions ouvertes, dont 2 pour vous/.test(ov.text('news-actions')), 'Overview : les actions ouvertes, dont celles de la personne (Mia en a deux) : ' + ov.text('news-actions'));
  check(/view=actualites&project=/.test(ov.$('news-link').getAttribute('href')), 'Overview : lien vers la page Actualités du projet');
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

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Actualités : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
