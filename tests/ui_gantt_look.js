/**
 * Essai de l'aspect moderne de la page Planning (0.15.1) dans un navigateur simulé (jsdom), avec le vrai Core et une date « aujourd'hui » figée.
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_gantt_look.js
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
const it = (p, name, type, s, f, wp) => call(A, 'planitems.create', { values: { project_id: p.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '' } });
const spec = it(p1, 'Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id);
const plans = it(p1, 'Plans structure', 'Livrable', '2026-10-12', '2026-10-30', w1.id);
const cdr = it(p1, 'Revue CDR', 'Jalon', '2026-11-02', '2026-11-02');
const fini = it(p1, 'Note terminée', 'Livrable', '2026-10-05', '2026-10-08', w1.id);
const tool = it(p2, 'Moule', 'Livrable', '2026-10-01', '2026-10-14');
c.repoUpdate('PlanItem', spec.id, { progress_pct: 0 }, null, S);
c.repoUpdate('PlanItem', plans.id, { progress_pct: 40 }, null, S);
c.repoUpdate('PlanItem', fini.id, { progress_pct: 100 }, null, S);
call(A, 'dependencies.create', { values: { predecessor_id: spec.id, successor_id: plans.id, dep_type: 'FS' } });
call(A, 'dependencies.create', { values: { predecessor_id: plans.id, successor_id: cdr.id, dep_type: 'FS' } });
call(A, 'dependencies.create', { values: { predecessor_id: tool.id, successor_id: plans.id, dep_type: 'FS' } });

const baseHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
  html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'));
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
  return html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
})();

c.Session = { getActiveUser: () => ({ getEmail: () => 'alice@entreprise.com' }), getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }), getScriptTimeZone: () => 'Europe/Paris' };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 25));
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };

/** Ouvre la page avec « aujourd'hui » figé (jour, mois 1-12, année). */
function openPage(today, onStart) {
  const dom = new JSDOM(baseHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      const Real = window.Date;
      class FakeDate extends Real {
        constructor(...a) { if (a.length) super(...a); else super(today[2], today[1] - 1, today[0], 10, 0, 0); }
        static now() { return new Real(today[2], today[1] - 1, today[0], 10, 0, 0).getTime(); }
      }
      window.Date = FakeDate;
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      const runner = (ok, fail) => ({
        withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => { const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid))); setTimeout(() => ok(res), 0); }
      });
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { console.error('Erreur page :', m); failed++; };
      if (onStart) onStart(window);
    }
  });
  const w = dom.window, doc = w.document;
  const until = async (cond, ms) => { for (let i = 0; i < (ms || 1500) / 20; i++) { if (cond()) return true; await tick(20); } return !!cond(); };
  return { dom, w, doc, until, flat: (t) => String(t).replace(/\s+/g, ' ').trim() };
}

(async () => {
  console.log('\nPage Planning : aspect moderne');
  // le chargement s'affiche en barres fantômes dès l'ouverture
  const early = openPage([14, 10, 2026]);
  check(early.doc.querySelectorAll('#host .skeleton .sk-bar').length >= 5 && early.doc.querySelector('#host .skeleton').getAttribute('role') === 'status', 'avant l’arrivée des données : des barres fantômes (squelette), pas une ligne de texte');
  let p = early; await p.until(() => p.doc.querySelector('.bar-wrapper'));
  const doc = p.doc, w = p.w;
  check(!doc.querySelector('#host .skeleton'), 'le squelette disparaît quand le planning arrive');

  // barres : taille, arrondi, statut
  const wrap = (id) => doc.querySelector('.bar-wrapper[data-id="' + id + '"]');
  const barOf = (id) => wrap(id).querySelector('rect.bar');
  check(barOf(spec.id).getAttribute('height') === '26' && barOf(spec.id).getAttribute('rx') === '8', 'barres plus hautes (26 px) et plus arrondies (8)');
  check(wrap(spec.id).classList.contains('s-todo') && wrap(plans.id).classList.contains('s-doing') && wrap(fini.id).classList.contains('s-done') && wrap(fini.id).classList.contains('is-done'), 'couleur par statut : à faire, en cours (40 %), terminé (100 %)');
  check(wrap(cdr.id).classList.contains('s-todo') && wrap(cdr.id).classList.contains('is-milestone'), 'le jalon porte son statut');

  // jalons en losange
  const marks = [...doc.querySelectorAll('.milestone-mark')];
  check(marks.length === 1 && marks[0].getAttribute('data-for') === cdr.id && /s-todo/.test(marks[0].getAttribute('class')) && !/bar-wrapper/.test(marks[0].getAttribute('class')), 'un losange pour le jalon, qui reprend son statut');
  const poly = marks[0].querySelector('polygon'), pts = poly.getAttribute('points').split(' ').map(Number), bar = barOf(cdr.id);
  const cx = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
  check(pts.length === 8 && Math.abs((pts[0] + pts[4]) / 2 - cx) < 0.01 && pts[2] - pts[6] === 22, 'losange centré sur la date du jalon (22 px de large) : la barre d’origine, invisible, garde le clic et le glisser');

  // repère « aujourd'hui »
  const line = doc.querySelector('.today-line');
  check(!!line && doc.querySelector('.today-chip text').textContent === 'Aujourd’hui', 'une ligne et une pastille « Aujourd’hui »');
  const tx = w.__ppm.todayX();
  check(Math.abs(Number(line.getAttribute('x1')) - tx) < 0.01 && tx > 0, 'positionnée sur le jour courant (' + Math.round(tx) + ' px)');
  const sc = doc.querySelector('.plan'); const asked = [];
  sc.scrollTo = (o) => asked.push(o);
  check(!doc.getElementById('today-btn').disabled, 'le bouton « Aujourd’hui » est actif');
  doc.getElementById('today-btn').click();
  check(asked.length === 1 && asked[0].behavior === 'smooth' && Math.abs(asked[0].left - tx) < 1, 'il fait défiler en douceur vers le jour courant');

  // week-ends
  const wk = () => [...doc.querySelectorAll('.weekends rect')];
  check(wk().length >= 5 && wk().every((r) => Number(r.getAttribute('width')) > 0), 'week-ends estompés en vue semaine : ' + wk().length + ' bandes');
  doc.querySelector('.seg button[data-mode="Day"]').click();
  await p.until(() => wk().length > 0 && Number(wk()[0].getAttribute('width')) > 40);
  check(wk().some((r) => Number(r.getAttribute('width')) === 76) || wk().some((r) => Number(r.getAttribute('width')) === 38), 'en vue jour : samedi et dimanche d’un seul tenant (2 × 38 px)');
  doc.querySelector('.seg button[data-mode="Month"]').click();
  await p.until(() => wk().length === 0);
  check(wk().length === 0, 'pas de bandes de week-end en vue mois (un jour y fait 4 pixels)');
  doc.querySelector('.seg button[data-mode="Week"]').click();
  await p.until(() => wk().length > 0);

  // les noms suivent le défilement
  const lab = wrap(plans.id).querySelector('.bar-label'), pb = barOf(plans.id);
  const bx = Number(pb.getAttribute('x')), bw = Number(pb.getAttribute('width'));
  check(!lab.classList.contains('big') && bw > 100, 'le nom de « Plans structure » est dans sa barre (' + Math.round(bw) + ' px)');
  Object.defineProperty(doc.querySelector('.plan'), 'scrollLeft', { value: bx + 60, configurable: true });
  w.__ppm.updateLabels();
  const x1 = Number(wrap(plans.id).querySelector('.bar-label').getAttribute('x'));
  check(Math.abs(x1 - (bx + 70)) < 0.01 && wrap(plans.id).querySelector('.bar-label').style.textAnchor === 'start', 'barre à moitié défilée : le nom se cale sur le bord visible, à gauche (x = ' + Math.round(x1) + ')');
  Object.defineProperty(doc.querySelector('.plan'), 'scrollLeft', { value: bx + bw + 500, configurable: true });
  w.__ppm.updateLabels();
  const x2 = Number(wrap(plans.id).querySelector('.bar-label').getAttribute('x'));
  check(x2 <= bx + bw - 40 - 8 + 0.01 && x2 >= bx, 'barre presque sortie de l’écran : le nom reste dans la barre, calé sur son extrémité (x = ' + Math.round(x2) + ')');

  // infobulle au survol
  const over = (g, x, y) => g.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, clientX: x || 200, clientY: y || 200 }));
  const tip = () => doc.getElementById('tip');
  over(wrap(plans.id));
  check(tip() && !tip().hidden && tip().querySelector('h4').textContent === 'Plans structure', 'au survol, une infobulle apparaît');
  const tt = p.flat(tip().textContent);
  check(/Livrable/.test(tt) && /12\/10\/2026 → 30\/10\/2026/.test(tt) && /Responsable/.test(tt) && /Avancement 40 %/.test(tt) && /Chemin critique|Marge/.test(tt), 'elle donne le type, les dates, le responsable, l’avancement et la marge : ' + tt.slice(0, 110));
  check(doc.querySelectorAll('.arrow path.hl').length === 3 && [...doc.querySelectorAll('.arrow path.hl')].every((a) => a.getAttribute('data-from') === plans.id || a.getAttribute('data-to') === plans.id), 'les trois flèches qui touchent l’élément (Spécification, Moule, Revue CDR) sont accentuées, aucune autre');
  w.document.getElementById('host').dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: doc.body }));
  check(tip().hidden && doc.querySelectorAll('.arrow path.hl').length === 0, 'elle disparaît à la sortie, les flèches reprennent leur teinte');
  over(wrap(cdr.id));
  check(/Revue CDR/.test(tip().textContent) && /Jalon/.test(tip().textContent) && /Date 02\/11\/2026/.test(p.flat(tip().textContent)), 'infobulle d’un jalon : sa date');
  over(wrap(tool.id));
  check(/Livrable du projet P2/.test(tip().textContent) && !/Responsable/.test(tip().textContent), 'infobulle d’un voisin d’un autre projet : son projet, sans responsable');
  over(wrap(spec.id)); wrap(spec.id).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  check(tip().hidden, 'elle se ferme dès qu’on saisit une barre pour la glisser');
  const wpId = [...doc.querySelectorAll('.bar-wrapper.is-wp')][0].getAttribute('data-id');
  over(wrap(wpId));
  check(/1 Conception/.test(tip().textContent) && /Workpackage/.test(tip().textContent), 'infobulle d’un workpackage');
  doc.getElementById('host').dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: doc.body }));

  // légende et barre d'outils
  const legend = [...doc.querySelectorAll('#legend-pop .legend li')].map((l) => l.textContent.trim());
  check(['À faire', 'En cours', 'Terminé', 'Chemin critique', 'Jalon', 'Aujourd’hui'].every((t) => legend.some((l) => l.indexOf(t) === 0)) && legend.some((l) => /Workpackage \(fine barre\)/.test(l)), 'légende mise à jour : statuts, jalon en losange, workpackage en fine barre, aujourd’hui');
  check(!!doc.getElementById('critical') && !!doc.getElementById('baseline') && doc.querySelector('label.toggle input#critical'), 'les interrupteurs « Critique » et « Baseline » sont toujours des cases (accessibles), mises en forme de pastilles');
  doc.getElementById('critical').checked = false; doc.getElementById('critical').dispatchEvent(new w.Event('change'));
  check(doc.getElementById('main').classList.contains('critical-off'), 'décocher « Critique » retire la couleur du chemin critique');
  p.dom.window.close();

  // aujourd'hui hors de la période : bouton grisé, pas de ligne
  const past = openPage([1, 6, 2027]); await past.until(() => past.doc.querySelector('.bar-wrapper'));
  check(!past.doc.querySelector('.today-line') && past.doc.getElementById('today-btn').disabled && /hors de la période/.test(past.doc.getElementById('today-btn').title), 'projet passé : pas de ligne, bouton « Aujourd’hui » grisé et expliqué');
  past.dom.window.close();
  const future = openPage([1, 6, 2026]); await future.until(() => future.doc.querySelector('.bar-wrapper'));
  check(!future.doc.querySelector('.today-line') && future.doc.getElementById('today-btn').disabled, 'projet à venir : de même');
  future.dom.window.close();

  // vue programme : nom et avancement sur la barre, jalons en losange
  const pr = openPage([14, 10, 2026]); await pr.until(() => pr.doc.querySelector('.bar-wrapper'));
  pr.doc.getElementById('picker').value = 'program:' + prog.id; pr.doc.getElementById('picker').dispatchEvent(new pr.w.Event('change'));
  await pr.until(() => pr.w.__ppm.state.mode === 'program' && pr.doc.querySelector('.bar-wrapper.is-project'));
  const lbls = [...pr.doc.querySelectorAll('.bar-wrapper.is-project .bar-label')].map((l) => l.textContent);
  check(lbls.some((t) => /^P1 Nacelle · \d+ %$/.test(t)), 'vue programme : chaque barre de projet porte son nom et son avancement (' + lbls.join(' | ') + ')');
  check(pr.doc.querySelectorAll('.milestone-mark').length >= 1, 'les jalons des projets sont des losanges');
  const pbar = pr.doc.querySelector('.bar-wrapper.is-project');
  pbar.dispatchEvent(new pr.w.MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 }));
  check(/Projet/.test(pr.doc.getElementById('tip').textContent) && /Chef de projet/.test(pr.doc.getElementById('tip').textContent), 'infobulle d’un projet : chef de projet, dates, avancement');
  pr.dom.window.close();

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPlanning, aspect moderne : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
