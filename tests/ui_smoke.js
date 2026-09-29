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
html = html.replace("<?!= include('Style') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'));
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

  // Déplacement confirmé
  w.__ppm.state.lastDrag = 0;
  w.__ppm.onDateChange({ id: spec.id }, new w.Date(2026, 9, 7), new w.Date(2026, 9, 13, 23, 59, 59));
  check(doc.getElementById('confirm').open, 'confirmation demandée avant déplacement');
  check(doc.getElementById('confirm-text').textContent.includes('07/10/2026 au 13/10/2026'), 'nouvelles dates dans la confirmation');
  w.__ppm.confirmMove();
  for (let i = 0; i < 20 && c.repoGet('PlanItem', spec.id).planned_start !== '2026-10-07'; i++) await tick();
  for (let i = 0; i < 10; i++) await tick();
  const moved = c.repoGet('PlanItem', spec.id);
  check(moved.planned_start === '2026-10-07' && moved.planned_finish === '2026-10-13', 'dates enregistrées');
  check(c.repoGet('PlanItem', plans.id).planned_start === '2026-10-12', 'successeur inchangé (H7)');
  check(doc.querySelectorAll('.arrow path.is-violated').length === 2, 'nouvelle violation en rouge après rechargement');

  // Utilisateur sans droit
  user = 'bob@entreprise.com';
  doc.getElementById('reload').click();
  for (let i = 0; i < 20; i++) await tick();
  w.__ppm.onDateChange({ id: plans.id }, new w.Date(2026, 9, 14), new w.Date(2026, 9, 20, 23, 59, 59));
  check(!doc.getElementById('confirm').open, 'pas de confirmation pour un lecteur');
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
