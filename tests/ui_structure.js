/**
 * Essai de la page WBS (ex-OBS/WBS : l'organigramme a été supprimé en 0.15.3) dans un navigateur simulé (jsdom), avec le vrai Core :
 * affichage, panneau des rôles à chaque niveau, pose et retrait d'un rôle, lecture seule du Reader, échappement des noms, préférences, repli, vue programme.
 *   npm i --no-save jsdom@24 && node tests/ui_structure.js
 * (variable UI_DEPS = dossier node_modules à utiliser, si les paquets ne sont pas installés ici)
 */
const fs = require('fs');
const path = require('path');
const dep = (m) => require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, m) : m);
const { JSDOM } = dep('jsdom');
const { freshCore } = require('./harness');
const { makeFakeSheets } = require('./fake_sheets');

const c = freshCore();
c.SpreadsheetApp = makeFakeSheets();
c.IMPORT_DRIVE = { share() {}, moveToProjectFolder() {} };
const S = { actor: 'setup', source: 'setup' };
const A = 'admin@entreprise.com';
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(action + ' : ' + JSON.stringify(r.error)); return r.data; };
const res = (name, extra) => c.repoInsert('Resource', Object.assign({ resource_type: 'Interne', name, country: 'FR' }, extra || {}), S);
const anna = res('Anna', { email: 'anna@entreprise.com', job_function: 'Directrice de programme', organization: 'Maison mère' });
const dan = res('Dan', { email: 'dan@entreprise.com', job_function: 'Responsable de domaine', organization: 'Maison mère' });
const alice = res('Alice', { email: 'alice@entreprise.com', job_function: 'Cheffe de projet', organization: 'Bureau d’études' });
const carl = res('Carl', { email: 'carl@entreprise.com', job_function: 'Ingénieur essais', organization: 'Sous-traitant Alpha' });
const eve = res('Eve <img src=x onerror=alert(1)>', { email: 'eve@entreprise.com' });
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Vide', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } });
c.repoInsert('RoleAssignment', { resource_id: anna.id, role_code: 'PL', scope_type: 'program', scope_id: prog.id }, S);
c.repoInsert('RoleAssignment', { resource_id: dan.id, role_code: 'DPL', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1', owner_resource_id: alice.id, charge_code: 'C-1' } });
const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Structure', wbs_code: '1.1', parent_wp_id: w1.id, owner_resource_id: carl.id } });
const it = (name, type, s, f, wp, owner) => call(A, 'planitems.create', { values: { project_id: p1.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '', owner_resource_id: owner.id } });
const spec = it('Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id, alice);
const plans = it('Plans', 'Livrable', '2026-10-12', '2026-10-16', w11.id, carl);
const rev = it('Revue', 'Jalon', '2026-10-19', '2026-10-19', '', alice);
call(A, 'dependencies.create', { values: { predecessor_id: spec.id, successor_id: plans.id, dep_type: 'FS' } });

const template = fs.readFileSync(path.join(__dirname, '..', 'src', 'Structure.html'), 'utf8')
  .replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'))
  .replace("<?!= include('Style') ?>", '<style>' + fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8').replace(/<\/?style>/g, '') + '</style>')
  .replace("<?!= include('Common') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Common.html'), 'utf8'))
  .replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'));

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user, boot) {
  const html = template.replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: p1.id, program: '', baseUrl: 'https://exemple.test/exec', appsheetUrl: '', version: 'test' }, boot || {})));
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      function runner(ok, fail) {
        return {
          withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
          uiCall: (action, params, rid) => {
            calls.push(action);
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
  const w = dom.window, doc = w.document;
  const $ = (id) => doc.getElementById(id + '-wbs') || doc.getElementById(id);
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const nodes = () => [...doc.querySelectorAll('#canvas-wbs .node')];
  const node = (id) => doc.querySelector('#canvas-wbs [data-id="' + id + '"]');
  const box = (g) => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')); const r = g.querySelector('rect.card'); return { x: +m[1], y: +m[2], w: +r.getAttribute('width'), h: +r.getAttribute('height') }; };
  const overlaps = () => { const b = nodes().map(box); for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { if (b[i].x < b[j].x + b[j].w && b[j].x < b[i].x + b[i].w && b[i].y < b[j].y + b[j].h && b[j].y < b[i].y + b[i].h) return [i, j]; } return null; };
  const open = async (id) => { await until(() => node(id)); click(node(id)); await until(() => { const h = $('details').querySelector('h2'); return !$('details').hidden && h; }); };
  const rolesReady = async () => { await until(() => $('roles-box') && !/Chargement/.test($('roles-box').textContent)); };
  const holders = (code) => [...doc.querySelectorAll('#roles-box .role-row[data-role="' + code + '"] ul.holders li span')].map((x) => x.textContent);
  const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
  return { w, doc, calls, $, until, click, nodes, node, box, overlaps, open, rolesReady, holders, flat };
}

(async () => {
  console.log('\nPage WBS (jsdom)');

  // ---------------------------------------------------------------- une page, un seul découpage, plus d'organigramme
  let p = openPage('alice@entreprise.com');
  await p.until(() => p.nodes().length > 0);
  check(!p.doc.getElementById('zone-obs') && !p.doc.querySelector('[data-mode]') && !p.doc.getElementById('org-role') && !p.doc.getElementById('unplaced'), 'plus d’organigramme OBS : ni zone, ni « Par rôles / Par équipes », ni « Ressources à positionner »');
  check(p.doc.getElementById('title').textContent === 'WBS' && /WBS/.test(p.doc.getElementById('nav-struct').textContent) && ![...p.doc.querySelectorAll('header, nav, h1, h2, label, button')].some((x) => /OBS/.test(x.textContent)), 'la page et son lien de navigation s’appellent « WBS », plus un seul « OBS » à l’écran : ' + p.doc.getElementById('nav-struct').textContent);
  check(p.nodes().length === 6 && p.calls.includes('wbs.tree') && !p.calls.some((x) => /^obs\./.test(x)), 'six cartes (projet, deux workpackages, deux livrables, un jalon) ; aucun appel à l’OBS : ' + p.calls.join(','));
  check(!p.overlaps(), 'aucune carte ne se chevauche');

  // ---------------------------------------------------------------- panneau des rôles d'un workpackage (chef de projet)
  await p.open('wp:' + w1.id);
  await p.rolesReady();
  check(p.$('details').querySelector('h2').textContent === '1 Conception' && !!p.$('roles-box') && /Rôles/.test(p.$('roles-box').textContent), 'le détail d’un workpackage a une section « Rôles »');
  check(JSON.stringify(p.holders('WPL')) === JSON.stringify(['Alice · principal']) && !p.doc.querySelector('#roles-box .role-row[data-role="DO"]') && !p.doc.querySelector('#roles-box .role-row[data-role="CP"]'), 'un workpackage n’a que son rôle : Workpackage leader (Alice, principale) — pas de Deliverable owner ni de chef de projet');
  const pick = () => p.$('role-pick'), person = () => p.$('role-person');
  check(!!pick() && [...pick().options].map((o) => o.value).join() === 'WPL' && ![...person().options].some((o) => /Alice/.test(o.text)) && [...person().options].some((o) => /Dan/.test(o.text)), 'le chef de projet peut poser le Workpackage leader ; la liste ne propose pas la personne qui le détient déjà');
  person().value = dan.id;
  p.click(p.$('role-add'));
  await p.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === dan.id && a.role_code === 'WPL' && a.scope_id === w1.id));
  await p.rolesReady();
  await p.until(() => p.holders('WPL').length === 2);
  check(JSON.stringify(p.holders('WPL')) === JSON.stringify(['Alice · principal', 'Dan']), 'Dan est posé Workpackage leader : deux titulaires, Alice reste la principale (première posée)');
  check(c.repoGet('WorkPackage', w1.id).owner_resource_id === alice.id, 'dans les données aussi : le responsable principal du workpackage reste Alice');
  const danX = [...p.doc.querySelectorAll('#roles-box ul.holders li')].find((li) => /Dan/.test(li.textContent)).querySelector('button');
  check(/Retirer le rôle de Dan/.test(danX.getAttribute('aria-label')), 'chaque titulaire a un bouton « Retirer le rôle de … » accessible');
  p.click(danX);
  await p.until(() => !c.repoList('RoleAssignment').some((a) => a.resource_id === dan.id && a.role_code === 'WPL' && a.scope_id === w1.id && (!a.end_date || a.end_date >= c.todayStr())));
  await p.rolesReady();
  await p.until(() => p.holders('WPL').length === 1);
  check(JSON.stringify(p.holders('WPL')) === JSON.stringify(['Alice · principal']), 'retiré : l’affectation est terminée et le panneau se met à jour');

  // ---------------------------------------------------------------- un livrable : Deliverable owner et Contributors
  await p.open('item:' + spec.id);
  await p.rolesReady();
  check(JSON.stringify(p.holders('DO')) === JSON.stringify(['Alice · principal']) && !!p.doc.querySelector('#roles-box .role-row[data-role="CONTRIB"]'), 'un livrable : Deliverable owner et Contributors');
  check([...pick().options].map((o) => o.value).join() === 'DO,CONTRIB', 'le chef de projet peut poser l’un ou l’autre');
  pick().value = 'CONTRIB'; pick().dispatchEvent(new p.w.Event('change'));
  person().value = eve.id;
  p.click(p.$('role-add'));
  await p.until(() => c.repoList('RoleAssignment').some((a) => a.resource_id === eve.id && a.role_code === 'CONTRIB' && a.scope_id === spec.id));
  await p.rolesReady();
  await p.until(() => p.holders('CONTRIB').length === 1);
  check(/^Eve <img/.test(p.holders('CONTRIB')[0]) && !p.$('details').querySelector('img'), 'un nom qui contient du HTML s’affiche comme du texte, jamais interprété');
  const cardCount = p.nodes().length;
  check(cardCount === 6, 'poser un rôle ne change pas le découpage (' + cardCount + ' cartes)');

  // ---------------------------------------------------------------- chaque niveau voit ce qu'il peut poser
  const k = openPage('carl@entreprise.com');       // Sub-workpackage leader du sous-WP « Structure »
  await k.until(() => k.nodes().length > 0);
  await k.open('item:' + plans.id); await k.rolesReady();
  check(!!k.$('role-add') && [...k.$('role-pick').options].map((o) => o.value).join() === 'DO,CONTRIB', 'Carl (Sub-WP leader) : pose le Deliverable owner et les Contributors d’un livrable de son sous-workpackage');
  await k.open('wp:' + w11.id); await k.rolesReady();
  check(!k.$('role-add') && !!k.$('roles-note') && /niveau supérieur/.test(k.$('roles-note').textContent), 'mais pas le Sub-WP leader de son propre sous-workpackage : « un rôle est posé par un niveau supérieur au sien »');
  check(!k.doc.querySelector('#roles-box ul.holders button'), 'ni retirer son propre rôle');
  await k.open('item:' + spec.id); await k.rolesReady();
  check(!k.$('role-add'), 'et rien sur un livrable hors de son sous-workpackage');

  const e = openPage('eve@entreprise.com');        // Reader : lit tout, ne modifie rien
  await e.until(() => e.nodes().length > 0);
  check(e.nodes().length === 6, 'un Reader voit tout le WBS (' + e.nodes().length + ' cartes)');
  await e.open('item:' + spec.id); await e.rolesReady();
  check(!e.$('role-add') && !e.doc.querySelector('#roles-box ul.holders button') && !e.$('edit-node') && !e.$('delete-node') && /Reader/.test(e.$('roles-note').textContent), 'un Reader : voit les titulaires, aucune pose, aucun retrait, aucun bouton de modification ; la note rappelle qu’il est Reader');

  // ---------------------------------------------------------------- préférences, repli, zoom
  p = openPage('alice@entreprise.com');
  await p.until(() => p.nodes().length > 0);
  p.$('options-btn').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
  check(!p.$('options').hidden && p.$('options-btn').getAttribute('aria-expanded') === 'true', 'les attributs affichés s’ouvrent');
  const attr = (key) => p.doc.querySelector('#opt-attrs-wbs input[data-attr="' + key + '"]');
  const owner = attr('owner');
  check(!!owner && /Responsable \(leader ou propriétaire\)/.test(owner.parentNode.textContent), 'l’attribut « Responsable » se lit « Responsable (leader ou propriétaire) »');
  owner.checked = false; owner.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  await p.until(() => c.loadPrefs_('alice@entreprise.com').wbs.attrs.indexOf('owner') < 0);
  check(c.loadPrefs_('alice@entreprise.com').wbs.attrs.indexOf('owner') < 0 && c.loadPrefs_('alice@entreprise.com').obs === undefined, 'le choix est mémorisé côté serveur ; il n’y a plus de préférences d’organigramme');
  const toggle = p.doc.querySelector('#canvas-wbs [data-toggle="wp:' + w1.id + '"]');
  p.click(toggle);
  await p.until(() => p.nodes().length === 3);
  check(p.nodes().length === 3, 'replier « Conception » cache ses trois descendants (' + p.nodes().length + ' cartes restent)');
  p.click(p.doc.querySelector('#canvas-wbs [data-toggle="wp:' + w1.id + '"]'));
  await p.until(() => p.nodes().length === 6);
  check(p.nodes().length === 6 && !p.overlaps(), 'déplier les ramène, sans chevauchement');
  const width = () => Number(p.doc.querySelector('#canvas-wbs svg').getAttribute('width'));
  const w0 = width(); p.click(p.$('zoom-in')); const w1z = width(); p.click(p.$('zoom-out')); p.click(p.$('zoom-out'));
  check(w1z > w0 && width() < w1z, 'le zoom agrandit et réduit le schéma');

  // ---------------------------------------------------------------- importer / exporter par classeur (0.15.3)
  p = openPage('alice@entreprise.com');
  await p.until(() => p.nodes().length > 0);
  check(!p.$('import-btn').hidden, 'le chef de projet a le bouton « Importer / exporter »');
  check(k.$('import-btn').hidden && e.$('import-btn').hidden, 'ni un Sub-workpackage leader ni un Reader');
  p.click(p.$('import-btn'));
  await p.until(() => p.$('imp-template'));
  check(!!p.$('import').getAttribute('open') || p.$('import').open, 'la boîte s’ouvre');
  check(p.$('imp-run').disabled, 'on ne peut pas importer avant d’avoir analysé');
  p.click(p.$('imp-template'));
  await p.until(() => p.$('imp-template-link'));
  check(/2 workpackage\(s\), 2 livrable\(s\), 1 jalon\(s\)/.test(p.$('imp-template-out').textContent), 'le modèle est créé, avec ce qu’il contient déjà : ' + p.$('imp-template-out').textContent.replace(/\s+/g, ' ').slice(0, 120));
  const bookId = c.SpreadsheetApp.openById(/\/d\/([^/?#]+)/.exec(p.$('imp-book').value)[1]);
  p.click(p.$('imp-analyze'));
  await p.until(() => p.$('imp-head'));
  check(/Rien à importer/.test(p.$('imp-head').textContent) && p.$('imp-run').disabled, 'le modèle tel quel : rien à importer, bouton « Importer » inactif');
  // un classeur avec une erreur : personne inconnue
  const add = (tab, rows) => { const sh = bookId.getSheetByName(tab); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
  add('Workpackages', [['P1', '2', '', 'Qualification', 'inconnu@entreprise.com', '', '']]);
  p.click(p.$('imp-analyze'));
  await p.until(() => p.$('imp-errors'));
  check(/1 erreur/.test(p.$('imp-head').textContent) && /Workpackages, ligne 4/.test(p.$('imp-errors').textContent) && /n’est pas dans Ressources/.test(p.$('imp-errors').textContent) && p.$('imp-run').disabled, 'l’erreur dit l’onglet, la ligne et quoi faire ; « Importer » reste inactif : ' + p.$('imp-errors').textContent.slice(0, 140));
  // correction, puis import
  bookId.getSheetByName('Workpackages').getRange(4, 5).setValue('dan@entreprise.com');
  add('Livrables', [['P1', '2', 'Rapport final', '2026-12-01', '2026-12-11', 'dan@entreprise.com', '']]);
  p.click(p.$('imp-analyze'));
  await p.until(() => p.$('imp-counts'));
  check(/Workpackages : 1 à créer/.test(p.$('imp-counts').textContent) && /Livrables et jalons : 1 à créer/.test(p.$('imp-counts').textContent) && !p.$('imp-run').disabled, 'le plan chiffré s’affiche, « Importer » devient actif : ' + p.$('imp-counts').textContent.replace(/\s+/g, ' '));
  // des lots d'une seule opération : la page doit relancer jusqu'à « terminé » (l'import de test n'en compte que deux)
  const realRun = c.API_ACTIONS['import.run']; let lots = 0; const seen = [];
  c.API_ACTIONS['import.run'] = (params, ctx) => { lots++; const out = realRun(Object.assign({}, params, { maxOps: 1 }), ctx); seen.push([!!params.resume, !!out.backup]); return out; };
  p.click(p.$('imp-run'));
  await p.until(() => p.nodes().length === 8, 6000);
  c.API_ACTIONS['import.run'] = realRun;
  check(lots >= 2, 'la page relance l’import lot après lot jusqu’à « terminé » : ' + lots + ' lots d’une opération');
  check(JSON.stringify(seen[0]) === '[false,true]' && seen.slice(1).every((x) => x[0] === true && x[1] === false), 'le premier lot enregistre la copie de sécurité ; les suivants reprennent sans en refaire : ' + JSON.stringify(seen));
  check(p.nodes().length === 8 && c.repoList('PlanItem').some((i) => i.name === 'Rapport final') && c.repoList('WorkPackage').some((x) => String(x.wbs_code) === '2' && x.owner_resource_id === dan.id), 'importé : le WBS affiche 8 cartes, le workpackage a son leader : ' + p.nodes().length);
  await p.until(() => !(p.$('import').open || p.$('import').getAttribute('open') !== null));
  check(!(p.$('import').open), 'la boîte se referme à la fin');

  // ---------------------------------------------------------------- vue programme : on n'y pose pas de rôle
  const g = openPage('alice@entreprise.com', { project: '', program: prog.id });
  await g.until(() => g.nodes().length > 0);
  check(g.calls.includes('wbs.tree') && !g.calls.some((x) => /^obs\./.test(x)), 'vue programme : le découpage de tous les projets (aucun appel à l’OBS)');
  await g.open(g.nodes().map((n) => n.getAttribute('data-id')).find((id) => /^project:/.test(id)));
  check(!!g.$('open-project') && !g.$('roles-box'), 'depuis un projet du programme : « Ouvrir le WBS du projet », sans panneau de rôles (les rôles se posent dans le WBS du projet)');

  // ---------------------------------------------------------------- projet sans rien : on le remplit avec les boutons de la barre
  const v = openPage(A, { project: p2.id });
  await v.until(() => v.nodes().length > 0);
  await v.until(() => !v.$('wbs-add').hidden);
  check(v.nodes().length === 1 && !v.$('wbs-add').hidden && !v.$('wbs-add-deliverable').hidden && !v.$('wbs-add-milestone').hidden, 'projet vide : seule sa carte, avec les boutons pour ajouter un workpackage, un livrable, un jalon');
  const none = openPage('alice@entreprise.com', { project: p2.id });
  await none.until(() => none.nodes().length > 0);
  await wait(100);
  check(none.$('wbs-add').hidden, 'qui n’a aucun droit sur ce projet ne voit pas ces boutons');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage WBS : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
