/**
 * Essai de la page Gantt dans un navigateur simulé (jsdom), avec le vrai Core
 * derrière google.script.run. Hors suite principale (dépendances npm) :
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_smoke.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const frappePath = require.resolve(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'frappe-gantt/dist/frappe-gantt.min.js') : 'frappe-gantt/dist/frappe-gantt.min.js');
const { freshCore } = require('./harness');

const c = freshCore();
const S = { actor: 'setup', source: 'setup' };
const A = 'admin@entreprise.com';
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
const alice = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Alice', email: 'alice@entreprise.com', country: 'FR' }, S);
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Outillage', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } });
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1' } });
const it = (p, name, type, s, f, wp) => call(A, 'planitems.create', { values: { project_id: p.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '', owner_resource_id: alice.id } });
const spec = it(p1, 'Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id);
const plans = it(p1, 'Plans <b>structure</b>', 'Livrable', '2026-10-12', '2026-10-16', w1.id);
const cdr = it(p1, 'Revue CDR', 'Jalon', '2026-10-19', '2026-10-19');
const tool = it(p2, 'Moule', 'Livrable', '2026-10-01', '2026-10-14');
it(p1, 'Sans date', 'Livrable', '', '');
call(A, 'dependencies.create', { values: { predecessor_id: spec.id, successor_id: plans.id, dep_type: 'FS' } });
call(A, 'dependencies.create', { values: { predecessor_id: plans.id, successor_id: cdr.id, dep_type: 'FS' } });
call(A, 'dependencies.create', { values: { predecessor_id: tool.id, successor_id: plans.id, dep_type: 'FS' } });

let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
html = html.replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8')).replace("<?!= include('Common') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Common.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'));
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
html = html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');

let user = 'alice@entreprise.com';
c.Session = { getActiveUser: () => ({ getEmail: () => user }) };
const calls = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(window) {
    window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    function runner(ok, fail) {
      return {
        withSuccessHandler: (f) => runner(f, fail),
        withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => {
          calls.push(action);
          const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid)));
          setTimeout(() => ok(res), 0);
        }
      };
    }
    window.google = { script: { run: runner(null, null), history: { replace() {} } } };
    window.onerror = (m) => { console.error('Erreur page :', m); process.exitCode = 1; };
  }
});
const w = dom.window, doc = w.document;
const tick = () => new Promise((r) => setTimeout(r, 30));
const check = (cond, msg) => { if (!cond) { console.error('✗ ' + msg); process.exitCode = 1; } else console.log('  ✓ ' + msg); };

(async () => {
  console.log('\nPage Gantt (jsdom)');
  for (let i = 0; i < 20 && !doc.querySelector('.bar-wrapper'); i++) await tick();
  const bars = [...doc.querySelectorAll('.bar-wrapper')];
  check(bars.length === 6, 'six barres : 2 WP (dont « Hors workpackage »), 3 éléments, 1 voisin externe (' + bars.length + ')');
  check(doc.getElementById('title').textContent === 'P1 Nacelle', 'titre du projet');
  check(doc.getElementById('undated').textContent.includes('Sans date'), 'élément sans dates signalé sous le Gantt');
  const bar = (id) => doc.querySelector('.bar-wrapper[data-id="' + id + '"]');
  check(bar(spec.id).classList.contains('is-critical'), 'spécification sur le chemin critique');
  check(bar(tool.id).classList.contains('is-external') && bar(tool.id).classList.contains('is-locked'), 'voisin P2 grisé et verrouillé');
  check(bar(plans.id).classList.contains('is-violated'), 'plans en violation (moule fini trop tard)');
  check(doc.querySelectorAll('.arrow path.is-violated').length === 1, 'une flèche rouge');
  check(!doc.getElementById('issues').hidden && doc.querySelectorAll('#issues-body tr').length === 1, 'tableau des dépendances non respectées');
  check(doc.getElementById('summary').textContent.includes('1 dépendance non respectée'), 'résumé chiffré');
  check(doc.querySelector('.bar-label') && [...doc.querySelectorAll('.bar-label')].some((l) => l.textContent === 'Plans <b>structure</b>'), 'libellé affiché en texte, sans HTML interprété');
  check(doc.querySelectorAll('.gantt b').length === 0, 'aucune balise injectée');

  // Détail et déclaration d'avancement
  w.__ppm.onBarClick(spec.id);
  check(!doc.getElementById('details').hidden && doc.querySelector('#details h2').textContent === 'Spécification', 'panneau de détail');
  check(!!doc.querySelector('form.declare'), 'formulaire d’avancement pour le chef de projet');
  doc.getElementById('pct').value = '40';
  doc.querySelector('form.declare').dispatchEvent(new w.Event('submit', { cancelable: true }));
  for (let i = 0; i < 20 && calls.filter((x) => x === 'gantt.project').length < 2; i++) await tick();
  await tick();
  check(c.repoGet('PlanItem', spec.id).progress_pct == 40, 'avancement 40 % enregistré');

  // Déplacement immédiat, avec « Annuler » (0.15.2) : plus de boîte de confirmation
  const waitFor = async (cond, n) => { for (let i = 0; i < (n || 80) && !cond(); i++) await tick(); return !!cond(); };
  const reloads = () => calls.filter((x) => x === 'gantt.project').length;
  const specRow = () => w.__ppm.state.data.rows.find((r) => r.id === spec.id);
  const orig = { start: c.repoGet('PlanItem', spec.id).planned_start, finish: c.repoGet('PlanItem', spec.id).planned_finish };
  w.__ppm.state.lastDrag = 0;
  const r0 = reloads();
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7), new w.Date(2026, 9, 13, 23, 59, 59));
  check(!doc.getElementById('undo-toast').hidden && doc.getElementById('undo-text').textContent.includes('du 07/10/2026 au 13/10/2026') && !doc.getElementById('undo-text').textContent.includes('week-end'), 'plus de boîte de confirmation : le déplacement s’applique tout de suite, un message rappelle les nouvelles dates et propose « Annuler »');
  check(specRow().start === '2026-10-07' && specRow().finish === '2026-10-13' && !doc.getElementById('pl-busy').hidden, 'l’écran est déjà à jour avant la réponse du serveur, et « Enregistrement… » le dit');
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === '2026-10-07' && reloads() > r0 && doc.getElementById('pl-busy').hidden);
  const moved = c.repoGet('PlanItem', spec.id);
  check(moved.planned_start === '2026-10-07' && moved.planned_finish === '2026-10-13', 'dates enregistrées en arrière-plan');
  check(c.repoGet('PlanItem', plans.id).planned_start === '2026-10-12', 'successeur inchangé (H7)');
  check(reloads() === r0 + 1 && doc.getElementById('pl-busy').hidden, 'le planning est relu une seule fois, sans écran de chargement, puis l’indicateur disparaît');
  check(doc.querySelectorAll('.arrow path.is-violated').length === 2, 'nouvelle violation en rouge après la relecture (marges et dépendances recalculées)');
  check(/ce déplacement laisse 1 dépendance non respectée/.test(doc.getElementById('toast').textContent), 'et un message prévient que le déplacement laisse une dépendance non respectée : ' + doc.getElementById('toast').textContent.slice(0, 80));
  // annuler
  doc.getElementById('undo-btn').click();
  check(specRow().start === orig.start && doc.getElementById('undo-toast').hidden && /Déplacement annulé/.test(doc.getElementById('toast').textContent), '« Annuler » remet l’écran tout de suite');
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === orig.start && doc.getElementById('pl-busy').hidden);
  check(c.repoGet('PlanItem', spec.id).planned_start === orig.start && c.repoGet('PlanItem', spec.id).planned_finish === orig.finish, 'et les dates d’origine sont réécrites');
  // l'erreur d'arrondi d'une heure de la bibliothèque (début à 23 h la veille du jour voulu) ne doit ni décaler le début ni allonger l'élément
  const durBefore = (Date.parse(specRow().finish) - Date.parse(specRow().start)) / 86400000;
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7, 23, 0, 0), new w.Date(2026, 9, 12, 22, 59, 59));
  check(specRow().start === '2026-10-08' && specRow().finish === '2026-10-12' && (Date.parse(specRow().finish) - Date.parse(specRow().start)) / 86400000 === durBefore, 'un début reçu à 23 h la veille est ramené au bon jour : la durée est conservée (' + specRow().start + ' → ' + specRow().finish + ')');
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === '2026-10-08' && doc.getElementById('pl-busy').hidden);
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7), new w.Date(2026, 9, 13, 23, 59, 59));
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === '2026-10-07' && doc.getElementById('pl-busy').hidden);
  // week-end : prévenu, pas interdit
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 10), new w.Date(2026, 9, 13, 23, 59, 59));
  check(/tombe un week-end/.test(doc.getElementById('undo-text').textContent) && /10\/10\/2026/.test(doc.getElementById('undo-text').textContent), 'une date de week-end est signalée dans le message, sans bloquer');
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === '2026-10-10' && doc.getElementById('pl-busy').hidden);
  // le serveur refuse (modifié ailleurs entre-temps) : retour arrière et explication
  specRow().version = 1;
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7), new w.Date(2026, 9, 13, 23, 59, 59));
  check(specRow().start === '2026-10-07', 'refus à venir : l’écran avance quand même');
  await waitFor(() => /Quelqu’un a modifié cet élément/.test(doc.getElementById('toast').textContent));
  check(/Quelqu’un a modifié cet élément entre-temps/.test(doc.getElementById('toast').textContent) && doc.getElementById('undo-toast').hidden, 'modifié ailleurs : message clair, plus d’« Annuler »');
  await waitFor(() => specRow().start === '2026-10-10' && doc.getElementById('pl-busy').hidden);
  check(specRow().start === '2026-10-10' && c.repoGet('PlanItem', spec.id).planned_start === '2026-10-10', 'l’écran est revenu aux dates du serveur');
  // rétablit le déplacement attendu par la suite
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7), new w.Date(2026, 9, 13, 23, 59, 59));
  await waitFor(() => c.repoGet('PlanItem', spec.id).planned_start === '2026-10-07' && doc.getElementById('pl-busy').hidden);
  check(c.repoGet('PlanItem', spec.id).planned_start === '2026-10-07', 'le déplacement s’enregistre de nouveau avec la version à jour');

  w.__ppm.hideUndo(); // le message « Annuler » du déplacement précédent est encore affiché : on le ferme pour voir si un lecteur en obtient un
  // Utilisateur sans droit
  user = 'bob@entreprise.com';
  doc.getElementById('reload').click();
  for (let i = 0; i < 20; i++) await tick();
  w.__ppm.onDateChange({ id: plans.id }, new w.Date(2026, 9, 14), new w.Date(2026, 9, 20, 23, 59, 59));
  check(doc.getElementById('undo-toast').hidden, 'aucun déplacement ni « Annuler » pour un lecteur');
  check(doc.getElementById('toast').textContent.includes('Vous ne pouvez pas déplacer'), 'message clair pour un lecteur');
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onBarClick(plans.id);
  check(doc.querySelector('#details h2').textContent === 'Plans <b>structure</b>', 'détail ouvert pour un lecteur');
  check(!doc.querySelector('form.declare'), 'pas de formulaire d’avancement pour un lecteur');

  // Vue programme
  const picker = doc.getElementById('picker');
  picker.value = 'program:' + prog.id;
  picker.dispatchEvent(new w.Event('change'));
  for (let i = 0; i < 20 && doc.getElementById('title').textContent !== 'PG Programme A'; i++) await tick();
  await tick();
  check(doc.getElementById('title').textContent === 'PG Programme A', 'vue programme');
  check(doc.querySelectorAll('.bar-wrapper.is-project').length === 2 && doc.querySelectorAll('.bar-wrapper.is-milestone').length === 1, 'deux projets et le jalon');
  check(doc.querySelectorAll('#issues-body tr').length === 1, 'dépendance entre projets listée');
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onBarClick('prj:' + p1.id);
  check(doc.querySelector('#details h2').textContent === 'P1 Nacelle', 'détail du projet depuis le programme');
  console.log(process.exitCode ? '\nÉchecs dans la page.' : '\nPage Gantt : tout est conforme.');
})();
