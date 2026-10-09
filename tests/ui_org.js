/**
 * Essai des écrans de dépendances, rôles, personnes et équipes dans la page Structure (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_org.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com';
const ADMIN = 'admin@entreprise.com';
const outil = w.call(ADMIN, 'planitems.create', { values: { project_id: w.p1.id, name: 'Outillage', item_type: 'Livrable', planned_start: '2026-10-05', planned_finish: '2026-10-09' } });
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user, tab, mode) {
  const html = src('Structure.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: tab, mode: mode || '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'structure', home: 'gantt', isAdmin: false }))
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
  const SUF = tab === 'wbs' ? '-wbs' : ''; // dépendances : zone du découpage ; rôles, personnes, équipes : zone de l'organisation
  const $ = (id) => doc.getElementById(id + SUF) || doc.getElementById(id);
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = (id) => ($(id) || { textContent: '' }).textContent;
  const node = (id) => doc.querySelector('#canvas' + SUF + ' .node[data-id="' + id + '"]');
  const pick = async (id, title) => { await until(() => node(id)); click(node(id)); await until(() => !$('details').hidden && (!title || text('details').includes(title))); };
  const submit = () => $('gf-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const set = (id, v) => { $('gf-' + id).value = v; };
  const opts = (id) => [...doc.querySelectorAll('#gf-' + id + ' option')].map((o) => o.value);
  const person = async (id) => { await until(() => doc.querySelector('#canvas [data-person="' + id + '"]')); click(doc.querySelector('#canvas [data-person="' + id + '"]')); await until(() => !$('details').hidden); };
  const formOpen = () => $('genform').open;
  return { win, doc, until, $, click, text, node, pick, submit, set, opts, person, formOpen };
}

(async () => {
  console.log('\nDépendances, rôles, personnes et équipes dans la page (jsdom)');

  // ---------------------------------------------------------------- dépendances (onglet WBS)
  let p = openPage(CP, 'wbs');
  await p.pick('item:' + w.b.id, 'Calcul');
  await p.until(() => p.doc.querySelector('#deps-box .dep-row'));
  const rows = () => [...p.doc.querySelectorAll('#deps-box .dep-row')].map((r) => r.textContent);
  check(rows().length === 2 && rows().some((t) => /Spécification.*Fin → début/.test(t)) && rows().some((t) => /Essais/.test(t)), 'liens du livrable : amont et aval : ' + rows().join(' | '));
  check(!!p.$('add-pred') && !!p.$('add-succ'), 'boutons d’ajout d’un prédécesseur et d’un successeur');
  p.click(p.$('add-pred'));
  await p.until(() => p.formOpen());
  check(/Ajouter un prédécesseur à « Calcul »/.test(p.text('gf-title')) && !p.opts('other').includes(w.a.id) && !p.opts('other').includes(w.cc.id), 'les éléments déjà liés ne sont pas proposés');
  p.submit();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Choisissez un élément/.test(p.text('gf-error')), 'sans choix : message dans la boîte');
  p.set('other', w.j.id); p.submit();
  await p.until(() => /boucle/.test(p.text('gf-error')));
  check(p.formOpen(), 'un lien qui fermerait une boucle est refusé, la boîte reste ouverte : ' + p.text('gf-error'));
  p.set('other', outil.id); p.set('dep_type', 'SS'); p.set('lag_days', '2'); p.submit();
  await p.until(() => c.repoList('Dependency').some((d) => d.predecessor_id === outil.id));
  const dep = c.repoList('Dependency').find((d) => d.predecessor_id === outil.id);
  check(dep.successor_id === w.b.id && dep.dep_type === 'SS' && Number(dep.lag_days) === 2, 'lien créé : début → début, 2 jours');
  await p.until(() => rows().some((t) => /Outillage.*Début → début \+2 j/.test(t)));
  check(true, 'affiché dans la carte : ' + rows().find((t) => /Outillage/.test(t)));
  const removeBtn = [...p.doc.querySelectorAll('#deps-box .dep-row')].find((r) => /Outillage/.test(r.textContent)).querySelector('button');
  p.click(removeBtn);
  await p.until(() => c.repoList('Dependency').every((d) => d.predecessor_id !== outil.id));
  await p.until(() => !rows().some((t) => /Outillage/.test(t)));
  check(true, 'lien retiré depuis la carte');
  const mia = openPage(MEMBER, 'wbs');
  await mia.pick('item:' + w.b.id, 'Calcul');
  await mia.until(() => mia.doc.querySelector('#deps-box .dep-row'));
  check(!mia.$('add-pred') && !mia.$('add-succ') && !mia.doc.querySelector('#deps-box .dep-row button'), 'un membre lit les liens, sans bouton pour les modifier');

  // ---------------------------------------------------------------- rôles (organigramme par rôles)
  p = openPage(CP, 'obs', 'roles');
  const memberNode = 'role:MEMBER|project|' + w.p1.id;
  await p.pick(memberNode, 'Membre');
  check(!!p.$('role-add') && p.doc.querySelectorAll('#details .member-list button').length === 1, 'le chef de projet peut ajouter et retirer sur le rôle « Membre » de son projet');
  p.click(p.$('role-add'));
  await p.until(() => p.formOpen());
  check(!p.opts('resource_id').includes(w.mia.id) && p.opts('resource_id').includes(w.remi.id), 'la personne déjà présente n’est pas proposée');
  p.set('resource_id', w.remi.id); p.submit();
  await p.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === w.remi.id && a.role_code === 'MEMBER'));
  await p.until(() => /Rémi/.test(p.text('details')) && p.doc.querySelectorAll('#details .member-list li').length === 2);
  check(true, 'Rémi ajouté au rôle, la carte reste sélectionnée');
  const miaX = [...p.doc.querySelectorAll('#details .member-list li')].find((li) => /Mia/.test(li.textContent)).querySelector('button');
  p.click(miaX);
  await p.until(() => p.$('confirm').open);
  check(/Retirer Mia \?/.test(p.text('confirm-title')), 'confirmation avant de retirer');
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('RoleAssignment').filter((a) => a.resource_id === w.mia.id && a.role_code === 'MEMBER' && a.scope_type === 'project' && (!a.end_date || a.end_date >= c.todayStr())).length === 0);
  await p.until(() => !/Mia/.test(p.text('details')));
  check(true, 'Mia retirée du rôle');
  await p.pick('role:DPL|program|' + w.prog.id, 'Domain');
  check(!p.$('role-add') && p.doc.querySelectorAll('#details .member-list button').length === 0, 'rôle du programme : aucun bouton pour un chef de projet');
  p.click(p.$('org-role'));
  await p.until(() => p.formOpen() && p.doc.querySelector('#gf-scope'));
  const scopeKinds = p.opts('scope').map((v) => v.split(':')[0]);
  check(!scopeKinds.includes('program') && scopeKinds.includes('project') && scopeKinds.includes('workpackage'), 'périmètres proposés : projet et workpackages, pas le programme');
  check(!p.opts('role_code').includes('PL') && !p.opts('role_code').includes('DPL') && p.opts('role_code').includes('CP') && p.opts('role_code').includes('MEMBER'), 'rôles proposés : pas plus haut que le sien : ' + p.opts('role_code').join(','));
  p.set('resource_id', w.mia.id); p.set('scope', 'workpackage:' + w.w2.id); p.doc.getElementById('gf-scope').dispatchEvent(new p.win.Event('change')); p.set('role_code', 'RWP'); p.submit();
  await p.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === w.mia.id && a.role_code === 'RWP' && a.scope_id === w.w2.id));
  check(true, 'rôle attribué depuis le bouton général : Mia responsable du WP 2');

  // ---------------------------------------------------------------- personnes
  await p.until(() => !p.formOpen());
  p.click(p.$('org-person'));
  await p.until(() => p.formOpen() && p.doc.querySelector('#gf-email'));
  p.submit();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Nom/.test(p.text('gf-error')), 'nom vide refusé, champ nommé : ' + p.text('gf-error'));
  p.set('name', 'Léo Martin'); p.set('email', 'Leo@Entreprise.com'); p.set('job_function', 'Ingénieur essais'); p.set('resource_type', 'Externe'); p.set('country', 'DE'); p.set('capacity', '12'); p.submit();
  await p.until(() => c.repoList('Resource').some((r) => r.name === 'Léo Martin'));
  const leo = c.repoList('Resource').find((r) => r.name === 'Léo Martin');
  check(leo.email === 'leo@entreprise.com' && leo.resource_type === 'Externe' && leo.country === 'DE' && Number(leo.capacity_days_month) === 12 && leo.job_function === 'Ingénieur essais', 'personne ajoutée avec ses attributs');
  await p.person(w.remi.id);
  check(!!p.$('person-edit') && !!p.$('person-remove'), 'fiche d’une personne : modifier et retirer');
  p.click(p.$('person-remove'));
  await p.until(() => p.$('confirm').open);
  check(/Retirer Rémi \?/.test(p.text('confirm-title')) && /2 livrables et jalons à réattribuer/.test(p.text('confirm-text')) && /1 workpackage à réattribuer/.test(p.text('confirm-text')), 'conséquences annoncées : ' + p.text('confirm-text'));
  p.click(p.$('confirm-cancel'));
  check(!c.isTrue(c.repoGet('Resource', w.remi.id).deleted), 'Annuler ne retire personne');
  p.click(p.$('person-remove'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.isTrue(c.repoGet('Resource', w.remi.id).deleted));
  check(c.repoGet('WorkPackage', w.w1.id).owner_resource_id === '' && c.repoGet('PlanItem', w.a.id).owner_resource_id === '', 'personne retirée, responsabilités libérées');

  // ---------------------------------------------------------------- équipes
  await p.until(() => !p.$('confirm').open);
  p.click(p.doc.querySelector('[data-mode="teams"]'));
  await p.until(() => !p.$('org-team').hidden);
  p.click(p.$('org-team'));
  await p.until(() => p.formOpen() && p.doc.querySelector('#gf-cost_center'));
  p.set('name', 'Bureau d’études'); p.set('cost_center', 'CC-1'); p.set('manager_resource_id', w.carla.id); p.submit();
  await p.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Bureau d’études'));
  const be = c.repoList('HierarchicalTeam').find((t) => t.name === 'Bureau d’études');
  check(be.cost_center === 'CC-1' && be.manager_resource_id === w.carla.id, 'équipe créée avec son responsable');
  await p.until(() => /Bureau d’études/.test(p.text('details')) && p.$('team-actions'));
  p.click(p.$('team-add-sub'));
  await p.until(() => p.formOpen() && /Nouvelle sous-équipe de « Bureau d’études »/.test(p.text('gf-title')));
  check(p.$('gf-parent_team_id').value === be.id, 'sous-équipe : parent prérempli');
  p.set('name', 'Calcul'); p.submit();
  await p.until(() => c.repoList('HierarchicalTeam').some((t) => t.name === 'Calcul'));
  const calc = c.repoList('HierarchicalTeam').find((t) => t.name === 'Calcul');
  check(calc.parent_team_id === be.id, 'sous-équipe créée sous son parent');
  await p.until(() => /Calcul/.test(p.text('details')) && p.$('team-add-member'));
  p.click(p.$('team-add-member'));
  await p.until(() => p.formOpen());
  p.set('resource_id', w.mia.id); p.submit();
  await p.until(() => c.repoGet('Resource', w.mia.id).team_id === calc.id);
  await p.until(() => /Mia/.test(p.text('details')) && p.doc.querySelectorAll('#details .member-list button').length === 1);
  check(true, 'membre ajouté à l’équipe');
  p.click(p.$('team-delete'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => !p.$('confirm-error').hidden);
  check(/1 membre/.test(p.text('confirm-error')) && !c.isTrue(c.repoGet('HierarchicalTeam', calc.id).deleted), 'équipe non vide : suppression refusée, raison affichée : ' + p.text('confirm-error'));
  p.click(p.$('confirm-cancel'));
  p.click(p.doc.querySelector('#details .member-list button'));
  await p.until(() => c.repoGet('Resource', w.mia.id).team_id === '');
  await p.until(() => !/Mia/.test(p.text('details')));
  check(true, 'membre retiré de l’équipe');
  await p.until(() => p.$('team-delete')); // le panneau se redessine après le retrait : on attend le bouton
  p.click(p.$('team-delete'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.isTrue(c.repoGet('HierarchicalTeam', calc.id).deleted));
  check(true, 'équipe vide supprimée');

  // ---------------------------------------------------------------- un simple membre ne voit aucun bouton d'organisation
  const m = openPage(MEMBER, 'obs', 'roles');
  await m.until(() => m.doc.querySelectorAll('#canvas .node').length > 0);
  check(['org-person', 'org-role', 'org-team'].every((id) => m.$(id).hidden), 'aucun bouton d’ajout dans l’en-tête');
  await m.pick('role:CP|project|' + w.p1.id, 'Chef de projet');
  check(!m.$('role-add') && m.doc.querySelectorAll('#details .member-list button').length === 0, 'aucune action sur les rôles');
  await m.person(w.carla.id);
  check(!m.$('person-edit') && !m.$('person-remove'), 'aucune action sur la fiche d’un autre');

  // ---------------------------------------------------------------- ressources à positionner (personnes créées sans rôle)
  const nina = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Nina Roux', email: 'nina@entreprise.com', country: 'FR' }, w.S);
  const place = openPage(CP, 'obs', 'roles');
  await place.until(() => place.doc.getElementById('unplaced') && !place.doc.getElementById('unplaced').hidden);
  check(/Ressources à positionner/.test(place.text('unplaced')) && !!place.doc.querySelector('[data-unplaced="' + nina.id + '"]'), 'la personne créée sans rôle apparaît dans « Ressources à positionner » : ' + place.text('unplaced-list'));
  check(!place.doc.querySelector('[data-unplaced="' + w.mia.id + '"]'), 'une personne qui a un rôle n’y est pas');
  place.click(place.doc.querySelector('[data-unplaced="' + nina.id + '"]'));
  await place.until(() => place.doc.getElementById('person-place'));
  check(/Nina Roux/.test(place.text('details')) && /pas encore positionnée/.test(place.text('details')), 'sa fiche dit qu’elle n’est pas encore positionnée : ' + place.text('details').slice(0, 120));
  place.click(place.doc.getElementById('person-place'));
  await place.until(() => place.formOpen() && place.doc.getElementById('gf-scope'));
  check(place.doc.getElementById('gf-resource_id').value === nina.id, 'le formulaire de rôle est prérempli avec la personne');
  check(place.doc.getElementById('gf-scope').value === 'project:' + w.p1.id, 'périmètre proposé : celui qu’on regarde');
  check(!place.opts('role_code').includes('PL') && !place.opts('role_code').includes('DPL') && place.opts('role_code').includes('MEMBER'), 'seuls les rôles qu’on peut donner sont proposés');
  place.set('role_code', 'MEMBER'); place.submit();
  await place.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === nina.id && a.role_code === 'MEMBER'));
  await place.until(() => !place.doc.querySelector('[data-unplaced="' + nina.id + '"]'));
  check(true, 'positionnée : elle quitte la zone des ressources à positionner');
  await place.until(() => place.doc.querySelectorAll('#canvas .node').length > 0);
  check([...place.doc.querySelectorAll('#canvas .node text')].some((t) => /Nina Roux/.test(t.textContent)), 'et figure maintenant dans l’organigramme');
  const viewer = openPage(MEMBER, 'obs', 'roles');
  c.repoInsert('Resource', { resource_type: 'Externe', name: 'Paul Roy' }, w.S);
  const viewer2 = openPage(MEMBER, 'obs', 'roles');
  await viewer2.until(() => viewer2.doc.getElementById('unplaced') && !viewer2.doc.getElementById('unplaced').hidden);
  viewer2.click(viewer2.doc.querySelector('[data-unplaced]'));
  await viewer2.until(() => !viewer2.$('details').hidden);
  check(!viewer2.doc.getElementById('person-place') && !viewer2.doc.getElementById('person-edit'), 'un simple membre voit la zone mais ne peut ni positionner ni modifier');
  void viewer;

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nDépendances, rôles, personnes et équipes : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
