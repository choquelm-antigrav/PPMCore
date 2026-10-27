/**
 * Essai de la page Ressources : personnes, équipes, rôle dans le projet ; plus aucun taux journalier depuis 0.17.1 (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_ressources.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');

const w = lot2World();
const c = w.c;
c.SpreadsheetApp = makeFakeSheets();
c.IMPORT_DRIVE = { share() {}, moveToProjectFolder() {} };
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s/g, ' ');

function openPage(user) {
  const html = src('Ressources.html').replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
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
  check(/Rôles/.test(p.text('res-table')) && !/Rôle dans le projet/.test(p.text('res-table')) && !/Taux/.test(p.text('res-table')), 'colonnes des rôles, plus de colonne de taux');
  check(!p.doc.querySelector('.role-select'), 'plus de choix de rôle dans le tableau : les rôles se posent dans le WBS');
  check(/Chef de projet \(P1/.test(flat(p.row(w.carla.id).textContent)) && /Contributor \(4 livrables ou jalons\)/.test(flat(p.row(w.mia.id).textContent)), 'rôles en lecture seule : Carla chef de projet, Mia Contributor de quatre livrables ou jalons');
  check(/Workpackage leader \(1 Conception\)/.test(flat(p.row(w.remi.id).textContent)) && /Deliverable owner/.test(flat(p.row(w.remi.id).textContent)), 'Rémi : Workpackage leader du WP 1 et Deliverable owner de ses livrables');
  check(/Reader/.test(flat(p.row(w.xavier.id).textContent)) && !!p.row(w.xavier.id).querySelector('a'), 'Xavier, sans rôle, est Reader, avec un lien pour lui en poser un dans le WBS');
  // 0.14.0 : livrables et jalons de chaque personne
  const deliv = (id) => flat(p.row(id).querySelector('td.deliv').textContent);
  check(/Livrables/.test([...p.doc.querySelectorAll('#res-table th')].map((h) => h.textContent).join('|')), 'colonne « Livrables »');
  check(deliv(w.remi.id) === '22 livrables' && deliv(w.carla.id) === '21 livrable · 1 jalon' && /contribue à 4/.test(deliv(w.mia.id)) && deliv(w.dora.id) === '—', 'responsable de : Rémi 2 livrables, Carla 1 livrable et 1 jalon, Mia contribue à 4 sans en être responsable, Dora « — » : ' + [w.remi, w.carla, w.mia].map((x) => deliv(x.id)).join(' ; '));
  check(p.row(w.remi.id).querySelector('.deliv-n').textContent === '2' && p.row(w.carla.id).querySelector('.deliv-n').textContent === '2', 'le total (livrables et jalons) est mis en avant : 2 pour Rémi, 2 pour Carla');
  check(p.row(w.xavier.id).querySelector('.badge').textContent === 'Externe', 'les externes sont repérés');
  const access = (id) => [...p.row(id).querySelectorAll('.badge')].map((b) => b.textContent).find((t) => /connecter|domaine|adresse/i.test(t));
  check(access(w.carla.id) === 'Peut se connecter' && access(w.xavier.id) === 'Hors domaine', 'colonne Accès : adresse du domaine = peut se connecter, autre domaine = hors domaine');

  // plus de taux journalier : ni colonne, ni champ, ni appel
  check(!p.doc.querySelector('.rate-input') && !p.doc.querySelector('.rate-text'), 'aucun champ de taux dans le tableau');

  // ajouter une personne
  p.click(p.$('person-add'));
  await p.until(() => p.$('genform').open && p.$('gf-email'));
  p.submit();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Nom/.test(p.text('gf-error')), 'nom vide refusé, champ nommé : ' + p.text('gf-error'));
  p.set('name', 'Léo Martin'); p.set('email', 'Leo@Entreprise.com'); p.set('resource_type', 'Externe'); p.set('country', 'DE'); p.set('job_function', 'Ingénieur essais'); p.set('supplier', 'Alpha Test GmbH');
  p.submit();
  await p.until(() => c.repoList('Resource').some((r) => r.name === 'Léo Martin'));
  const leo = c.repoList('Resource').find((r) => r.name === 'Léo Martin');
  await p.until(() => p.row(leo.id));
  check(leo.email === 'leo@entreprise.com' && leo.resource_type === 'Externe' && !('daily_rate' in leo), 'personne ajoutée avec son statut et son adresse (et aucun taux)');
  check(/Alpha Test GmbH/.test(flat(p.row(leo.id).textContent)), 'fournisseur affiché pour un externe');
  check(/Reader/.test(p.row(leo.id).textContent) && /view=structure&project=/.test(p.row(leo.id).querySelector('a').getAttribute('href')) && !/Reader/.test(p.row(w.carla.id).textContent), 'une personne sans rôle est Reader, avec un lien vers le WBS pour lui en poser un ; celles qui ont un rôle ne le sont pas');
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
  check(p.$('gf-name').value === 'Rémi' && !p.$('gf-daily_rate'), 'fiche préremplie, sans champ de taux');
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
  check(m.$('person-add').hidden && m.$('team-add').hidden && m.$('teams-import').hidden && !/Taux/.test(m.text('res-table')), 'un membre : liste en lecture seule, ni rôles à choisir, ni ajout');
  check(/Chef de projet/.test(flat(m.row(w.carla.id).textContent)) && /Workpackage leader/.test(flat(m.row(w.remi.id).textContent)), 'mais il voit les rôles de chacun');
  const r = openPage(RWP);
  await r.until(() => r.$('res-table'));
  check(r.$('person-add').hidden && !/Taux/.test(r.text('res-table')), 'un Workpackage leader : ne peut pas ajouter de personne, et ne voit aucun taux (ils n’existent plus)');
  const d = openPage(DPL);
  await d.until(() => d.$('res-table'));
  check(!d.$('person-add').hidden && !d.doc.querySelector('.rate-input'), 'le DPL ajoute des personnes');

  // ---------------------------------------------------------------- 0.14.1 : l'arbre des équipes est un organigramme (25 % de la largeur), la liste des ressources a 75 %
  const team = (values) => w.call(CP, 'teams.create', { values });
  const rootA = team({ name: 'Direction ouest', manager_resource_id: w.carla.id }), branchA = team({ name: 'Branche calcul', parent_team_id: rootA.id, manager_resource_id: w.remi.id });
  const leafA = team({ name: 'Cellule fatigue', parent_team_id: branchA.id }), rootB = team({ name: 'Direction est' });
  const org = openPage(CP);
  await org.until(() => org.$('teams-all-row') && !org.$('teams-all-row').hidden);
  org.$('teams-all').checked = true; org.change(org.$('teams-all'));   // ces équipes n'ont encore aucun participant : on les affiche toutes pour vérifier l'organigramme
  await org.until(() => org.doc.querySelector('#teams-list li[data-team="' + leafA.id + '"]'));
  const q = (sel) => org.doc.querySelector(sel);
  check(!!q('#teams-list > li[data-team="' + rootA.id + '"] > ul > li[data-team="' + branchA.id + '"] > ul > li[data-team="' + leafA.id + '"]'), 'organigramme : la cellule est sous sa branche, elle-même sous sa direction (arbre imbriqué)');
  check(q('li[data-team="' + rootA.id + '"]').getAttribute('data-depth') === '0' && q('li[data-team="' + leafA.id + '"]').getAttribute('data-depth') === '2', 'la profondeur de chaque équipe est portée par sa carte');
  check(!q('li[data-team="' + leafA.id + '"] > ul') && !q('li[data-team="' + rootB.id + '"] > ul'), 'une équipe sans sous-équipe n’a pas de branche vide');
  check(q('li[data-team="' + rootB.id + '"] > .team-card').classList.contains('noboss') && !q('li[data-team="' + rootA.id + '"] > .team-card').classList.contains('noboss'), 'une équipe sans responsable est signalée');
  check(/Branche calcul/.test(flat(q('li[data-team="' + branchA.id + '"] > .team-card').textContent)) && /Rémi/.test(flat(q('li[data-team="' + branchA.id + '"] > .team-card').textContent)) && !!q('li[data-team="' + branchA.id + '"] > .team-card .team-sub'), 'la carte d’une équipe porte son nom, son responsable et ses actions');
  org.click(q('li[data-team="' + branchA.id + '"] > .team-card .t-name'));
  await org.until(() => q('li[data-team="' + branchA.id + '"] > .team-card.on'));
  check(!!q('li[data-team="' + branchA.id + '"] > .team-card.on') && q('#team-filter').value === branchA.id, 'cliquer une équipe la met en évidence et filtre les personnes');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'Ressources.html'), 'utf8');
  check(/grid-template-columns: minmax\(0, 3fr\) minmax\(0, 1fr\)/.test(css) && /\.teams ul > li::before/.test(css) && /\.teams ul > li:last-child::after/.test(css), 'mise en page 75 % pour la liste, 25 % pour les équipes, avec traits de liaison entre équipes');


  // ---------------------------------------------------------------- 0.17.0 : équipes du projet, toutes les équipes dans les formulaires, import de la structure des équipes
  const tp = openPage(CP);
  await tp.until(() => tp.$('teams-all-row') && !tp.$('teams-all-row').hidden && tp.doc.querySelector('#teams-list [data-team]'));
  const listed = (pg) => [...pg.doc.querySelectorAll('#teams-list .t-name')].map((n) => n.textContent);
  check(listed(tp).includes('Calcul') && listed(tp).includes('Bureau d’études') && !listed(tp).some((n) => /Direction|Cellule|Branche/.test(n)), 'par défaut : seulement les équipes dont un membre participe au projet (Rémi, dans Calcul) et leur parent ; pas les équipes sans participant : ' + listed(tp).join(' | '));
  check(tp.doc.querySelector('#teams-list li[data-team="' + be.id + '"] > .team-card').classList.contains('ctx') && !tp.doc.querySelector('#teams-list li[data-team="' + calc.id + '"] > .team-card').classList.contains('ctx') && /1 au projet/.test(flat(tp.doc.querySelector('#teams-list li[data-team="' + calc.id + '"] > .team-card').textContent)), 'le parent est grisé (aucun participant direct), l’équipe qui participe dit combien de ses membres sont au projet');
  check(/dont au moins un membre participe à ce projet/.test(tp.text('teams-note')) && !tp.$('teams-all').checked, 'la note dit la règle et propose « Toutes les équipes »');
  check(![...tp.$('team-filter').options].some((o) => /Direction est/.test(o.textContent)) && [...tp.$('team-filter').options].some((o) => /Calcul/.test(o.textContent)), 'le filtre des personnes ne propose, lui aussi, que les équipes du projet');
  tp.click(tp.doc.querySelector('#res-table tr[data-id="' + w.mia.id + '"] .person-edit'));
  await tp.until(() => tp.$('genform').open && tp.$('gf-team_id'));
  const formTeams = [...tp.$('gf-team_id').options].map((o) => o.textContent.replace(/^[— ]+/, ''));
  check(['Direction est', 'Direction ouest', 'Cellule fatigue', 'Branche calcul', 'Calcul', 'Bureau d’études'].every((n) => formTeams.includes(n)), 'le formulaire d’une personne propose TOUTES les équipes existantes, même celles qui ne participent pas au projet : ' + formTeams.join(' | '));
  tp.click(tp.$('gf-cancel'));
  tp.$('teams-all').checked = true; tp.change(tp.$('teams-all'));
  check(listed(tp).includes('Direction est') && listed(tp).includes('Cellule fatigue') && !tp.doc.querySelector('#teams-list .team-card.ctx') && /toutes les équipes sont affichées/.test(tp.text('teams-note')), '« Toutes les équipes » les montre toutes, sans grisé');
  tp.$('teams-all').checked = false; tp.change(tp.$('teams-all'));
  check(!listed(tp).includes('Direction est'), 'décochée : elles disparaissent de nouveau');
  // créer une équipe à la main reste possible ; une équipe toute neuve est visible tout de suite
  tp.click(tp.$('team-add'));
  await tp.until(() => tp.$('genform').open);
  tp.set('name', 'Pôle créé à la main'); tp.submit();
  await tp.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Pôle créé à la main'));
  await tp.until(() => listed(tp).includes('Pôle créé à la main'));
  check(tp.$('teams-all').checked && /apparaîtra parmi les équipes du projet quand un de ses membres y participera/.test(tp.text('toast')), 'une équipe créée à la main s’affiche aussitôt (toutes les équipes sont montrées) et le message explique quand elle sera « du projet »');
  // importer la structure des équipes
  check(!tp.$('teams-import').hidden, 'le chef de projet a le bouton « Importer des équipes »');
  const lola = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Lola Libre', email: 'lola@entreprise.com', country: 'FR' }, w.S);
  tp.click(tp.$('teams-import'));
  await tp.until(() => tp.$('timp').open && tp.$('timp-template'));
  check(tp.$('timp-run').disabled, 'on ne peut pas importer avant d’avoir analysé');
  tp.click(tp.$('timp-template'));
  await tp.until(() => tp.$('timp-template-link'));
  check(/équipes?, \d+ membres?/.test(tp.text('timp-template-out')) && tp.$('timp-book').value === tp.$('timp-template-link').getAttribute('href'), 'le modèle est créé, prérempli, son lien est dans le champ d’import : ' + tp.text('timp-template-out'));
  const book = c.SpreadsheetApp.openById(/\/d\/([^/?#]+)/.exec(tp.$('timp-book').value)[1]);
  const add = (tab, rows2) => { const sh = book.getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows2.length, rows2[0].length).setValues(rows2); };
  tp.click(tp.$('timp-analyze'));
  await tp.until(() => tp.$('timp-head'));
  check(/Rien à importer/.test(tp.text('timp-head')) && tp.$('timp-run').disabled, 'le modèle relu tel quel : rien à importer, « Importer » inactif');
  add('Équipes', [['Pôle essais', 'Parent fantôme', '', '']]);
  tp.click(tp.$('timp-analyze'));
  await tp.until(() => tp.$('timp-errors'));
  check(/1 erreur/.test(tp.text('timp-head')) && /Équipes, ligne \d+ — Équipe parente « Parent fantôme » : introuvable/.test(tp.text('timp-errors')) && tp.$('timp-run').disabled, 'une erreur dit l’onglet, la ligne et ce qui manque ; « Importer » reste inactif : ' + tp.text('timp-errors').slice(0, 120));
  const last = book.getSheetByName('Équipes'); last.getRange(last.getLastRow(), 2).setValue('Bureau d’études');
  add('Membres', [['Pôle essais', 'Lola Libre', 'lola@entreprise.com', 'Interne', '', '', 'FR', ''], ['Pôle essais', 'Nina Roux', 'nina@entreprise.com', 'Interne', 'Ingénieure', '', 'FR', '']]);
  tp.click(tp.$('timp-analyze'));
  await tp.until(() => tp.$('timp-counts'));
  check(/Équipes : 1 à créer/.test(tp.text('timp-counts')) && /Personnes : 1 à créer, 1 à rattacher/.test(tp.text('timp-counts')) && !tp.$('timp-run').disabled, 'le plan chiffré s’affiche, « Importer » devient actif : ' + tp.text('timp-counts'));
  const realRun = c.API_ACTIONS['teams.import.run']; const seen = [];
  c.API_ACTIONS['teams.import.run'] = (params, ctx) => { const out = realRun(Object.assign({}, params, { maxOps: 1 }), ctx); seen.push([!!params.resume, !!out.backup]); return out; };
  tp.click(tp.$('timp-run'));
  await tp.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Pôle essais') && c.findResourceByEmail('nina@entreprise.com') && /Import terminé/.test(tp.text('timp-status')), 8000);
  c.API_ACTIONS['teams.import.run'] = realRun;
  const pe = c.repoList('HierarchicalTeam').find((t) => t.name === 'Pôle essais');
  check(pe.parent_team_id === be.id && c.repoGet('Resource', lola.id).team_id === pe.id && c.findResourceByEmail('nina@entreprise.com').team_id === pe.id, 'importé : l’équipe sous son parent, la personne existante rattachée, la personne neuve créée dans l’équipe');
  check(seen.length >= 3 && JSON.stringify(seen[0]) === '[false,true]' && seen.slice(1).every((x) => x[0] === true && x[1] === false), 'relancé lot après lot, une seule copie de sécurité (une personne existante a changé) : ' + JSON.stringify(seen));
  check(!!tp.$('timp-backup-link') && /Copie avant import d’équipes/.test(tp.text('timp-backup')), 'le lien de la copie reste affiché');
  tp.click(tp.$('timp-close'));
  await tp.until(() => listed(tp).includes('Pôle essais'));
  check(listed(tp).includes('Pôle essais'), 'la liste des équipes est rafraîchie après l’import');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Ressources : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
