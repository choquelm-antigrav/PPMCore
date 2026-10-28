/**
 * Essai de la page Planning : avancement des livrables et passage des jalons depuis le panneau de détail (0.19.1), avec l'avancement hérité du workpackage.
 * Navigateur simulé (jsdom), vrai Core.   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_gantt_jalons.js
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
const bob = c.repoInsert('Resource', { resource_type: 'Interne', name: 'Bob', email: 'bob@entreprise.com', country: 'FR' }, S);
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1' } });
const w2 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Jalons seuls', wbs_code: '2' } });
const del = call(A, 'planitems.create', { values: { project_id: p1.id, name: 'Alpha', item_type: 'Livrable', planned_start: '2026-10-05', planned_finish: '2026-10-09', wp_id: w1.id, owner_resource_id: alice.id } });
const ms = call(A, 'planitems.create', { values: { project_id: p1.id, name: 'Revue seule', item_type: 'Jalon', planned_start: '2026-10-02', planned_finish: '2026-10-02', wp_id: w2.id, owner_resource_id: alice.id } });
const ms2 = call(A, 'planitems.create', { values: { project_id: p1.id, name: 'Revue de Bob', item_type: 'Jalon', planned_start: '2026-10-20', planned_finish: '2026-10-20', wp_id: w1.id, owner_resource_id: alice.id } });
c.repoInsert('RoleAssignment', { resource_id: bob.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: del.id }, S);
c.repoInsert('RoleAssignment', { resource_id: bob.id, role_code: 'CONTRIB', scope_type: 'planitem', scope_id: ms2.id }, S);

const baseHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
  html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'));
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
  return html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
})();
c.todayStr = () => '2026-10-14';
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };

function openPage(email) {
  c.Session = { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }), getScriptTimeZone: () => 'Europe/Paris' };
  const dom = new JSDOM(baseHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      const Real = window.Date;
      class FakeDate extends Real { constructor(...x) { if (x.length) super(...x); else super(2026, 9, 14, 10, 0, 0); } static now() { return new Real(2026, 9, 14, 10).getTime(); } }
      window.Date = FakeDate;
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      const runner = (ok, fail) => ({
        withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => { const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid))); setTimeout(() => ok(res), 5); }
      });
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { console.error('Erreur page :', m); failed++; };
    }
  });
  return { dom, w: dom.window, doc: dom.window.document };
}

(async () => {
  console.log('\nPage Planning : avancement des livrables et passage des jalons');
  const p = openPage('alice@entreprise.com'), w = p.w, doc = p.doc;
  const waitFor = async (cond, n) => { for (let i = 0; i < (n || 150) && !cond(); i++) await tick(); return !!cond(); };
  await waitFor(() => doc.querySelector('.bar-wrapper'));
  const row = (id) => w.__ppm.state.data.rows.find((r) => r.id === id);
  const idle = () => doc.getElementById('pl-busy').hidden && w.__ppm.state.pendingWrites === 0;
  const open = async (item) => { w.__ppm.state.lastDrag = 0; w.__ppm.onBarClick(item.id); await waitFor(() => doc.querySelector('#details h2') && doc.querySelector('#details h2').textContent === item.name); };
  const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  const wp = (id) => w.__ppm.state.data.rows.find((r) => r.kind === 'wp' && r.wp_id === id);

  // ---- un jalon à date dépassée, seul dans son workpackage
  await open(ms);
  check(!!doc.getElementById('milestone-section') && /Échéance dépassée/.test(doc.getElementById('milestone-state').textContent) && !!doc.getElementById('milestone-pass') && !doc.getElementById('progress-section'), 'un jalon : section « Jalon » (échéance dépassée), bouton « Marquer le jalon passé » ; pas de formulaire d’avancement');
  check(wp(w2.id).progress === 0, 'le workpackage qui n’a que ce jalon est à 0 %');
  click(doc.getElementById('milestone-pass'));
  check(!!doc.getElementById('milestone-pass-ok') && !!doc.getElementById('milestone-pass-cancel') && c.repoGet('PlanItem', ms.id).status !== 'Terminé', 'un premier clic demande confirmation : rien n’est changé');
  click(doc.getElementById('milestone-pass-cancel'));
  check(!!doc.getElementById('milestone-pass') && c.repoGet('PlanItem', ms.id).status !== 'Terminé', 'Annuler ne change rien');
  click(doc.getElementById('milestone-pass')); click(doc.getElementById('milestone-pass-ok'));
  check(row(ms.id).status === 'Terminé' && row(ms.id).progress === 100, 'confirmé : le jalon est passé tout de suite à l’écran (optimiste)');
  await waitFor(idle); await waitFor(() => doc.getElementById('milestone-reopen'));
  check(c.repoGet('PlanItem', ms.id).status === 'Terminé' && Number(c.repoGet('PlanItem', ms.id).progress_pct) === 100 && !!c.repoGet('PlanItem', ms.id).actual_finish, 'enregistré : terminé, 100 %, date réelle');
  check(wp(w2.id).progress === 100 && /Jalon passé/.test(doc.getElementById('milestone-state').textContent) && !!doc.getElementById('milestone-reopen'), 'le workpackage hérite : 100 % (son seul jalon est passé) ; le détail dit « Jalon passé » et propose de le rouvrir');
  click(doc.getElementById('milestone-reopen'));
  await waitFor(idle);
  check(c.repoGet('PlanItem', ms.id).status === 'À faire' && wp(w2.id).progress === 0, 'rouvert : à faire, et le workpackage revient à 0 %');

  // ---- un refus du serveur : l'écran revient en arrière et le dit
  const real = c.API_ACTIONS['milestone.pass'];
  c.API_ACTIONS['milestone.pass'] = () => { throw new c.PpmError('FORBIDDEN', 'Refusé pour l’essai.'); };
  await open(ms);
  click(doc.getElementById('milestone-pass')); click(doc.getElementById('milestone-pass-ok'));
  await waitFor(idle);
  check(row(ms.id).status !== 'Terminé' && /Refusé pour l’essai/.test(doc.getElementById('toast').textContent), 'refusé par le serveur : le jalon revient à son état et le message s’affiche');
  c.API_ACTIONS['milestone.pass'] = real;

  // ---- un livrable : terminé d'un clic, puis correction
  await open(del);
  check(!!doc.getElementById('progress-section') && !!doc.getElementById('mark-done') && /Déclarer un avancement/.test(doc.querySelector('form.declare h4').textContent) && !doc.getElementById('milestone-section'), 'un livrable : « Marquer terminé (100 %) » et la déclaration d’un pourcentage');
  click(doc.getElementById('mark-done'));
  check(row(del.id).progress === 100 && row(del.id).status === 'Terminé', 'terminé tout de suite à l’écran');
  await waitFor(idle); await waitFor(() => doc.getElementById('progress-done'));
  check(c.repoGet('PlanItem', del.id).status === 'Terminé' && Number(c.repoGet('PlanItem', del.id).progress_pct) === 100 && wp(w1.id).progress > 0, 'enregistré (terminé, 100 %) ; l’avancement du workpackage suit');
  check(!!doc.getElementById('progress-done') && !doc.getElementById('mark-done') && /Corriger l’avancement/.test(doc.querySelector('form.declare h4').textContent), 'un livrable terminé : le formulaire reste, pour corriger');
  doc.getElementById('pct').value = '30';
  doc.querySelector('form.declare').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await waitFor(idle);
  check(Number(c.repoGet('PlanItem', del.id).progress_pct) === 30 && c.repoGet('PlanItem', del.id).status !== 'Terminé', 'corrigé à 30 % : le livrable n’est plus terminé');
  p.dom.window.close();

  // ---- les droits : un Contributor déclare l'avancement de son livrable mais ne passe pas le jalon d'un autre
  const b = openPage('bob@entreprise.com'), bw = b.w, bdoc = b.doc;
  await (async () => { for (let i = 0; i < 150 && !bdoc.querySelector('.bar-wrapper'); i++) await tick(); })();
  const bopen = async (item) => { bw.__ppm.state.lastDrag = 0; bw.__ppm.onBarClick(item.id); for (let i = 0; i < 150 && !(bdoc.querySelector('#details h2') && bdoc.querySelector('#details h2').textContent === item.name); i++) await tick(); };
  await bopen(del);
  check(!!bdoc.getElementById('progress-section') && !bdoc.getElementById('milestone-section'), 'un Contributor du livrable : peut déclarer son avancement');
  await bopen(ms2);
  check(!bdoc.getElementById('milestone-section') && !bdoc.getElementById('progress-section'), 'un Contributor d’un jalon : ne le déclare pas passé (réservé à son responsable et au-dessus)');
  b.dom.window.close();

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPlanning, avancement et jalons : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
