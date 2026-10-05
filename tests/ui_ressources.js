/**
 * Essai de la page Ressources : personnes, équipes, rôle dans le projet, taux journalier (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_ressources.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s/g, ' ');

function openPage(user) {
  const html = src('Ressources.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'ressources', home: 'overview', isAdmin: false, canBudget: true }))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
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
  const change = (n) => n.dispatchEvent(new win.Event('change', { bubbles: true }));
  const text = (id) => flat(($(id) || { textContent: '' }).textContent);
  const submit = () => $('gf-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const set = (id, v) => { $('gf-' + id).value = v; };
  const row = (id) => doc.querySelector('#res-table tr[data-id="' + id + '"]');
  const names = () => [...doc.querySelectorAll('#res-table tbody tr')].map((r) => r.querySelector('td').childNodes[0].textContent);
  return { win, doc, until, $, click, change, text, submit, set, row, names };
}

(async () => {
  console.log('\nPage Ressources (jsdom)');

  let p = openPage(CP);
  await p.until(() => p.$('res-table'));
  check(p.text('title') === 'Ressources de Projet 1' && !p.$('person-add').hidden && !p.$('team-add').hidden, 'titre et boutons d’ajout pour le chef de projet');
  check(['Carla', 'Dora', 'Mia', 'Rémi', 'Xavier'].every((n) => p.names().includes(n)), 'personnes listées : ' + p.names().join(', '));
  check(/Rôle dans le projet/.test(p.text('res-table')) && /Taux journalier/.test(p.text('res-table')), 'colonnes du rôle dans le projet et du taux');
  check(p.row(w.carla.id).querySelector('.role-select').value === 'CP' && p.row(w.mia.id).querySelector('.role-select').value === 'MEMBER' && p.row(w.remi.id).querySelector('.role-select').value === '', 'rôles de projet actuels : Carla chef de projet, Mia membre, Rémi aucun');
  check(/Responsable de workpackage \(1 Conception\)/.test(flat(p.row(w.remi.id).textContent)), 'les autres rôles (workpackage) sont rappelés');
  check(p.row(w.xavier.id).querySelector('.badge').textContent === 'Externe', 'les externes sont repérés');
  const access = (id) => [...p.row(id).querySelectorAll('.badge')].map((b) => b.textContent).find((t) => /connecter|domaine|adresse/i.test(t));
  check(access(w.carla.id) === 'Peut se connecter' && access(w.xavier.id) === 'Hors domaine', 'colonne Accès : adresse du domaine = peut se connecter, autre domaine = hors domaine');

  // rôle dans le projet
  const sel = p.row(w.mia.id).querySelector('.role-select');
  sel.value = 'CP'; p.change(sel);
  await p.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === w.mia.id && a.role_code === 'CP' && a.scope_id === w.p1.id));
  await p.until(() => /chef de projet/.test(p.text('toast')));
  check(/chef de projet/.test(p.text('toast')), 'Mia passe chef de projet, la ligne se met à jour : ' + p.text('toast'));
  const none = p.row(w.mia.id).querySelector('.role-select');
  none.value = ''; p.change(none);
  await p.until(() => !c.repoList('RoleAssignment').some((a) => a.resource_id === w.mia.id && a.scope_id === w.p1.id && (!a.end_date || a.end_date >= c.todayStr())));
  check(true, 'sans rôle de projet : l’affectation est terminée');

  // taux journalier
  const rate = () => p.row(w.remi.id).querySelector('.rate-input');
  rate().value = '520'; p.change(rate());
  await p.until(() => Number(c.repoGet('Resource', w.remi.id).daily_rate) === 520);
  await p.until(() => /Taux de Rémi enregistré/.test(p.text('toast')));
  check(/Taux de Rémi enregistré/.test(p.text('toast')), 'taux saisi directement dans le tableau');
  rate().value = '0'; p.change(rate());
  await p.until(() => p.$('toast').classList.contains('error'));
  check(/positif/.test(p.text('toast')) && rate().value === '520', 'taux nul refusé, valeur précédente rétablie : ' + p.text('toast'));
  const xr = p.row(w.xavier.id).querySelector('.rate-input');
  xr.value = '450'; p.change(xr);
  await p.until(() => Number(c.repoGet('Resource', w.xavier.id).daily_rate) === 450);
  check(true, 'un externe a aussi son taux');

  // ajouter une personne
  p.click(p.$('person-add'));
  await p.until(() => p.$('genform').open && p.$('gf-email'));
  p.submit();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Nom/.test(p.text('gf-error')), 'nom vide refusé, champ nommé : ' + p.text('gf-error'));
  p.set('name', 'Léo Martin'); p.set('email', 'Leo@Entreprise.com'); p.set('resource_type', 'Externe'); p.set('country', 'DE'); p.set('job_function', 'Ingénieur essais'); p.set('supplier', 'Alpha Test GmbH'); p.set('daily_rate', '480');
  p.submit();
  await p.until(() => c.repoList('Resource').some((r) => r.name === 'Léo Martin'));
  const leo = c.repoList('Resource').find((r) => r.name === 'Léo Martin');
  await p.until(() => p.row(leo.id));
  check(leo.email === 'leo@entreprise.com' && leo.resource_type === 'Externe' && Number(leo.daily_rate) === 480, 'personne ajoutée avec son statut, son adresse et son taux');
  check(/Alpha Test GmbH/.test(flat(p.row(leo.id).textContent)), 'fournisseur affiché pour un externe');
  check(access(leo.id) === 'Peut se connecter' && /adresse e-mail professionnelle/.test(p.text('people-note')), 'une adresse du domaine donne l’accès aussitôt ; la page explique comment faire intervenir quelqu’un');

  // équipes
  p.click(p.$('team-add'));
  await p.until(() => p.$('genform').open && p.$('gf-cost_center'));
  p.set('name', 'Bureau d’études'); p.set('manager_resource_id', w.carla.id); p.set('cost_center', 'CC-1'); p.submit();
  await p.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Bureau d’études'));
  const be = c.repoList('HierarchicalTeam').find((t) => t.name === 'Bureau d’études');
  await p.until(() => p.doc.querySelector('#teams-list [data-team="' + be.id + '"]'));
  p.click(p.doc.querySelector('#teams-list [data-team="' + be.id + '"] .team-sub'));
  await p.until(() => p.$('genform').open && /Nouvelle sous-équipe de « Bureau d’études »/.test(p.text('gf-title')));
  p.set('name', 'Calcul'); p.submit();
  await p.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Calcul'));
  const calc = c.repoList('HierarchicalTeam').find((t) => t.name === 'Calcul');
  check(calc.parent_team_id === be.id, 'sous-équipe créée sous son parent');
  await p.until(() => p.doc.querySelector('#teams-list [data-team="' + calc.id + '"]'));
  p.click(p.row(w.remi.id).querySelector('.person-edit'));
  await p.until(() => p.$('genform').open && p.$('gf-team_id'));
  check(p.$('gf-name').value === 'Rémi' && Number(p.$('gf-daily_rate').value) === 520, 'fiche préremplie, avec le taux');
  p.set('team_id', calc.id); p.submit();
  await p.until(() => c.repoGet('Resource', w.remi.id).team_id === calc.id);
  await p.until(() => /Calcul/.test(flat(p.row(w.remi.id).textContent)));
  check(/1 membre/.test(p.text('teams-list')), 'Rémi dans l’équipe Calcul, effectif de l’équipe mis à jour');
  p.click(p.doc.querySelector('#teams-list [data-team="' + calc.id + '"] .t-name'));
  await p.until(() => p.names().length === 1);
  check(p.names()[0] === 'Rémi', 'cliquer une équipe filtre les personnes');
  p.click(p.doc.querySelector('#teams-list [data-team="' + calc.id + '"] .t-name'));
  await p.until(() => p.names().length > 1);
  p.doc.getElementById('res-search').value = 'mia'; p.doc.getElementById('res-search').dispatchEvent(new p.win.Event('input'));
  check(JSON.stringify(p.names()) === JSON.stringify(['Mia']), 'la recherche filtre par nom');
  p.doc.getElementById('res-search').value = ''; p.doc.getElementById('res-search').dispatchEvent(new p.win.Event('input'));
  p.click(p.doc.querySelector('#teams-list [data-team="' + calc.id + '"] .team-del'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => !p.$('confirm-error').hidden);
  check(/1 membre/.test(p.text('confirm-error')), 'équipe non vide : suppression refusée, raison affichée : ' + p.text('confirm-error'));
  p.click(p.$('confirm-cancel'));

  // retirer une personne
  p.click(p.row(leo.id).querySelector('.person-remove'));
  await p.until(() => p.$('confirm').open);
  check(/Retirer Léo Martin \?/.test(p.text('confirm-title')), 'confirmation avant de retirer');
  p.click(p.$('confirm-ok'));
  await p.until(() => c.isTrue(c.repoGet('Resource', leo.id).deleted));
  await p.until(() => !p.row(leo.id));
  check(true, 'personne retirée de la liste');

  // droits
  const m = openPage(MEMBER);
  await m.until(() => m.$('res-table'));
  check(m.$('person-add').hidden && m.$('team-add').hidden && !m.doc.querySelector('.role-select') && !m.doc.querySelector('.rate-input') && !/Taux journalier/.test(m.text('res-table')), 'un membre : liste en lecture seule, ni rôles à choisir, ni taux, ni ajout');
  check(/Chef de projet/.test(flat(m.row(w.carla.id).textContent)) && /Responsable de workpackage/.test(flat(m.row(w.remi.id).textContent)), 'mais il voit les rôles de chacun');
  const r = openPage(RWP);
  await r.until(() => r.$('res-table'));
  check(r.$('person-add').hidden && !r.doc.querySelector('.rate-input') && !r.doc.querySelector('.role-select'), 'un responsable de workpackage : lecture seule');
  const d = openPage(DPL);
  await d.until(() => d.$('res-table'));
  check(!!d.doc.querySelector('.role-select') && !!d.doc.querySelector('.rate-input') && !d.$('person-add').hidden, 'le DPL attribue les rôles, fixe les taux et ajoute des personnes');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Ressources : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
