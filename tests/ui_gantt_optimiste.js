/**
 * Essai de la mise à jour optimiste du Planning (0.15.2) : file d'écritures, une seule relecture, relecture périmée écartée,
 * avancement immédiat, refus au milieu d'une file. Navigateur simulé (jsdom), vrai Core.
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_gantt_optimiste.js
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
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1' } });
const it = (name, s, f) => call(A, 'planitems.create', { values: { project_id: p1.id, name, item_type: 'Livrable', planned_start: s, planned_finish: f, wp_id: w1.id, owner_resource_id: alice.id } });
const a = it('Alpha', '2026-10-05', '2026-10-09'), b = it('Bravo', '2026-10-12', '2026-10-16'), g = it('Gamma', '2026-10-19', '2026-10-23');
call(A, 'dependencies.create', { values: { predecessor_id: a.id, successor_id: b.id, dep_type: 'FS' } });

const baseHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
  html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'));
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
  return html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
})();
c.todayStr = () => '2026-10-14';
c.Session = { getActiveUser: () => ({ getEmail: () => 'alice@entreprise.com' }), getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }), getScriptTimeZone: () => 'Europe/Paris' };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };

let hook = null; const log = [];
function openPage() {
  const dom = new JSDOM(baseHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      const Real = window.Date;
      class FakeDate extends Real { constructor(...x) { if (x.length) super(...x); else super(2026, 9, 14, 10, 0, 0); } static now() { return new Real(2026, 9, 14, 10).getTime(); } }
      window.Date = FakeDate;
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      const runner = (ok, fail) => ({
        withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => { log.push(action); if (hook) hook(action, params); const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid))); setTimeout(() => ok(res), 5); }
      });
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { console.error('Erreur page :', m); failed++; };
    }
  });
  return { dom, w: dom.window, doc: dom.window.document };
}
const dates = (item) => { const r = c.repoGet('PlanItem', item.id); return r.planned_start + '→' + r.planned_finish; };

(async () => {
  console.log('\nPage Planning : mise à jour optimiste');
  const p = openPage(), w = p.w, doc = p.doc;
  const waitFor = async (cond, n) => { for (let i = 0; i < (n || 150) && !cond(); i++) await tick(); return !!cond(); };
  await waitFor(() => doc.querySelector('.bar-wrapper'));
  const row = (item) => w.__ppm.state.data.rows.find((r) => r.id === item.id);
  const reloads = () => log.filter((x) => x === 'gantt.project').length;
  const move = (item, d1, d2) => { w.__ppm.state.lastDrag = 0; w.__ppm.onDateChange({ id: item.id }, new w.Date(2026, 9, d1), new w.Date(2026, 9, d2, 23, 59, 59)); };
  const idle = () => doc.getElementById('pl-busy').hidden && w.__ppm.state.pendingWrites === 0;

  // ---- deux déplacements rapprochés : dans l'ordre, une seule relecture
  const r0 = reloads(), updates0 = log.filter((x) => x === 'planitems.update').length;
  move(g, 20, 24); move(g, 21, 25); move(a, 6, 10);
  check(row(g).start === '2026-10-21' && row(a).start === '2026-10-06' && !doc.getElementById('pl-busy').hidden && w.__ppm.state.pendingWrites === 3, 'trois déplacements enchaînés : l’écran les montre tous, trois écritures en attente');
  await waitFor(idle);
  check(dates(g) === '2026-10-21→2026-10-25' && dates(a) === '2026-10-06→2026-10-10', 'le serveur les a reçus dans l’ordre (le second déplacement de Gamma l’emporte) : ' + dates(g));
  check(log.filter((x) => x === 'planitems.update').length - updates0 === 3 && reloads() === r0 + 1, 'trois écritures mais UNE seule relecture, une fois la file vide (' + (reloads() - r0) + ')');
  check(row(g).start === '2026-10-21' && row(g).version > 1, 'et l’écran garde les dates, avec la version à jour');

  // ---- une relecture devenue périmée ne doit pas écraser une modification plus récente
  const r1 = reloads();
  let injected = false;
  hook = (action) => { if (action === 'gantt.project' && !injected) { injected = true; move(b, 14, 18); } }; // une nouvelle modification part PENDANT la relecture
  move(g, 22, 26);
  await waitFor(() => injected);
  await tick(30);
  check(row(b).start === '2026-10-14' && w.__ppm.state.pendingWrites >= 0, 'la relecture arrivée trop tard est écartée : Bravo reste à ses nouvelles dates à l’écran (' + row(b).start + ')');
  await waitFor(() => idle() && dates(b) === '2026-10-14→2026-10-18');
  hook = null;
  check(dates(g) === '2026-10-22→2026-10-26' && dates(b) === '2026-10-14→2026-10-18' && row(b).start === '2026-10-14' && row(g).start === '2026-10-22', 'au final, serveur et écran portent les deux modifications');
  check(reloads() - r1 === 2, 'deux relectures : l’obsolète (écartée) puis la bonne (' + (reloads() - r1) + ')');

  // ---- un refus au milieu de la file : les autres passent, celui-là revient en arrière
  const gRow = row(g); gRow.version = 1; // version périmée
  move(g, 5, 9); move(a, 12, 16);
  await waitFor(() => /Quelqu’un a modifié cet élément/.test(doc.getElementById('toast').textContent));
  await waitFor(idle);
  check(dates(a) === '2026-10-12→2026-10-16' && dates(g) === '2026-10-22→2026-10-26', 'Gamma refusé (modifié ailleurs) : inchangé ; Alpha, derrière lui dans la file, est bien enregistré');
  check(row(g).start === '2026-10-22' && row(a).start === '2026-10-12', 'l’écran montre la vérité du serveur pour les deux, sans écran de chargement');

  // ---- avancement : immédiat dans la liste, la barre et le détail
  w.__ppm.state.lastDrag = 0; w.__ppm.onBarClick(b.id);
  await waitFor(() => doc.querySelector('#details h2') && doc.querySelector('#details h2').textContent === 'Bravo');
  doc.getElementById('pct').value = '60';
  doc.querySelector('form.declare').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const listPct = () => doc.querySelector('.pl-row[data-id="' + b.id + '"] .pl-pct').textContent;
  check(listPct() === '60 %' && doc.querySelector('.bar-wrapper[data-id="' + b.id + '"]').classList.contains('s-doing') && c.repoGet('PlanItem', b.id).progress_pct != 60, 'avancement 60 % : la liste et la couleur de la barre changent AVANT la réponse du serveur');
  await waitFor(idle);
  check(c.repoGet('PlanItem', b.id).progress_pct == 60 && listPct() === '60 %' && doc.querySelector('#details h2').textContent === 'Bravo', 'puis il est enregistré, le détail reste ouvert');

  // ---- l'état de la page survit à la relecture : replis, filtres, sélection
  doc.querySelector('.pl-row[data-id="wp:' + w1.id + '"] .pl-toggle').click();
  doc.querySelector('.pl-row[data-id="wp:' + w1.id + '"] .pl-toggle').click();
  doc.querySelector('#plan-tools .pill[data-filter="mine"]').click();
  check(w.__ppm.state.filter === 'mine' && doc.querySelectorAll('.pl-row.kind-item').length === 3, 'filtre « Les miens » actif : les trois éléments d’Alice');
  const before = reloads();
  await w.__ppm.silentReload();
  check(reloads() === before + 1 && w.__ppm.state.filter === 'mine' && !doc.querySelector('#host .skeleton') && doc.querySelectorAll('.pl-row.kind-item').length === 3, 'une relecture silencieuse garde le filtre, ne montre pas de squelette et redessine la liste');
  p.dom.window.close();

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPlanning, mise à jour optimiste : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
