/**
 * Essai de la barre du haut : plus de menu d'onglets, le projet courant se transmet de lien en lien, le lien du copilote suit sa suspension (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_nav.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(file, view, boot) {
  const html = src(file).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: w.p1.id, program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: view, home: 'overview', isAdmin: false, canBudget: true, copilot: false }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error(e.message); });
  const dom = new JSDOM(html, {
    virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      function runner(ok, fail) {
        return {
          withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
          uiCall: (action, params, rid) => {
            c.Session = { getActiveUser: () => ({ getEmail: () => CP }) };
            const out = JSON.parse(JSON.stringify(c.uiCall(action, params, rid)));
            if (ok) setTimeout(() => ok(out), 0);
          }
        };
      }
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const doc = dom.window.document;
  const link = (v) => doc.querySelector('.ppm-nav a[data-view="' + v + '"]');
  return { doc, link };
}

(async () => {
  console.log('\nBarre du haut (jsdom)');

  // plus de menu d'onglets : une page = un lien, ses rubriques sont des zones de la page
  for (const [file, view] of [['Suivi.html', 'suivi'], ['Budget.html', 'budget'], ['Structure.html', 'structure']]) {
    const p = openPage(file, view, {});
    await wait(700);
    check(!p.doc.querySelector('.ppm-caret') && !p.doc.getElementById('ppm-sub') && !p.doc.querySelector('.ppm-nav [aria-haspopup]'), file + ' : aucune flèche de menu dans la barre du haut');
  }

  // le projet courant suit de lien en lien
  for (const [file, view] of [['Gantt.html', 'gantt'], ['Structure.html', 'structure'], ['Suivi.html', 'suivi']]) {
    const p = openPage(file, view, {});
    await wait(1100);
    const ok3 = ['overview', 'ressources', 'budget', 'suivi', 'actualites'].every((v) => (p.link(v).getAttribute('href') || '').indexOf('project=' + w.p1.id) >= 0);
    check(ok3, file + ' : tous les liens de la barre reprennent le projet courant : ' + ['overview', 'ressources', 'budget', 'actualites'].map((v) => p.link(v).getAttribute('href')).join(' | '));
  }

  // le copilote est en suspens : pas de lien ; réactivé : le lien revient
  let p = openPage('Overview.html', 'overview', { copilot: false });
  await wait(300);
  check(p.link('copilote').hidden, 'copilote en suspens : le lien est masqué');
  p = openPage('Overview.html', 'overview', { copilot: true });
  await wait(300);
  check(!p.link('copilote').hidden, 'copilote réactivé : le lien revient');
  p = openPage('Suivi.html', 'suivi', { canBudget: false });
  await wait(300);
  check(p.link('budget').hidden, 'sans accès au budget : pas de lien Budget');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nBarre du haut : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
