/**
 * Essai du menu des onglets dans la bannière : chaque onglet de Suivi, Copilote et Budget est accessible depuis n'importe quelle page (jsdom, vrai Core).
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
  const html = src(file).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: w.p1.id, program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: view, home: 'overview', isAdmin: false, canBudget: true }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented: navigation/.test(e.message)) console.error(e.message); }); // suivre un lien vers une autre page est voulu
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
  const win = dom.window, doc = win.document;
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const caret = (v) => doc.querySelector('.ppm-nav .ppm-caret[data-menu="' + v + '"]');
  const items = () => [...doc.querySelectorAll('#ppm-sub a')];
  const open = () => !doc.getElementById('ppm-sub').hidden;
  const pressed = (t) => { const b = doc.querySelector('.seg [data-tab="' + t + '"]'); return !!b && b.getAttribute('aria-pressed') === 'true'; };
  return { win, doc, click, caret, items, open, pressed };
}

(async () => {
  console.log('\nMenu des onglets dans la bannière (jsdom)');

  // Suivi : quatre onglets, changement instantané, onglet courant marqué
  let p = openPage('Suivi.html', 'suivi', { tab: 'ecarts' });
  await wait(900);
  check(!!p.caret('suivi') && !!p.caret('copilote') && !!p.caret('budget'), 'une flèche de menu à côté de Suivi, Copilote et Budget');
  check(!p.caret('gantt') && !p.caret('structure'), 'pas de menu pour les pages sans onglets de ce type');
  p.click(p.caret('suivi'));
  check(p.open() && p.items().map((a) => a.getAttribute('data-tab')).join() === 'ecarts,changes,baselines,workspace', 'le menu de Suivi liste ses quatre onglets : ' + p.items().map((a) => a.textContent).join(' | '));
  check(p.items()[0].getAttribute('aria-current') === 'true', 'l’onglet courant (Écarts) est marqué');
  check(p.items()[2].getAttribute('href') === 'https://app.test/exec?view=suivi&tab=baselines&project=' + w.p1.id, 'chaque entrée est un lien direct vers l’onglet : ' + p.items()[2].getAttribute('href'));
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  p.items()[2].dispatchEvent(ev);
  await wait(300);
  check(ev.defaultPrevented && !p.open() && p.pressed('baselines'), 'sur la même page : l’onglet change sans recharger, le menu se ferme');
  p.click(p.caret('suivi'));
  check(p.items()[2].getAttribute('aria-current') === 'true' && p.items()[0].getAttribute('aria-current') === null, 'l’onglet courant suit');
  p.items()[3].dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(300);
  check(p.pressed('workspace'), 'Agenda et Drive atteint depuis le menu');

  // depuis Suivi, les onglets de Budget et de Copilote sont des liens vers l'autre page
  p.click(p.caret('budget'));
  check(p.open() && p.items().map((a) => a.getAttribute('data-tab')).join() === 'bilan,po,budget', 'le menu de Budget : bilan, achats, budget');
  const other = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  p.items()[1].dispatchEvent(other);
  check(!other.defaultPrevented && p.items()[1].getAttribute('href') === 'https://app.test/exec?view=budget&tab=po&project=' + w.p1.id, 'depuis une autre page : on suit le lien (la page s’ouvre sur le bon onglet)');
  p.win.document.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!p.open(), 'Échap ferme le menu');
  p.click(p.caret('copilote'));
  check(p.open() && p.items().length === 4, 'menu de Copilote ouvert');
  p.click(p.win.document.body);
  check(!p.open(), 'un clic ailleurs ferme le menu');
  p.click(p.caret('suivi')); p.click(p.caret('suivi'));
  check(!p.open(), 'recliquer la flèche referme le menu');

  // Copilote
  p = openPage('Copilote.html', 'copilote', { tab: 'synthese' });
  await wait(900);
  p.click(p.caret('copilote'));
  check(p.items().map((a) => a.getAttribute('data-tab')).join() === 'synthese,simulation,questions,suggestions' && p.items()[0].getAttribute('aria-current') === 'true', 'Copilote : quatre onglets, Synthèse marquée');
  p.items()[2].dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(300);
  check(p.pressed('questions') && !p.open(), 'Copilote : Questions atteint sans recharger');
  p.click(p.caret('copilote'));
  p.items()[1].dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(300);
  check(p.pressed('simulation'), 'Copilote : Simulation atteinte');

  // Budget
  p = openPage('Budget.html', 'budget', { tab: 'bilan' });
  await wait(900);
  p.click(p.caret('budget'));
  check(p.items().map((a) => a.getAttribute('data-tab')).join() === 'bilan,po,budget' && p.items()[0].getAttribute('aria-current') === 'true', 'Budget : trois onglets, Bilan marqué');
  p.items()[1].dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(400);
  check(p.pressed('po') && !p.open(), 'Budget : Achats atteint sans recharger');
  p.click(p.caret('budget'));
  p.items()[2].dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(400);
  check(p.pressed('budget'), 'Budget : lignes de budget atteintes');

  // le projet courant suit : depuis le Planning ou la Structure, Overview, Ressources et Budget s'ouvrent sur le même projet
  for (const [file, view] of [['Gantt.html', 'gantt'], ['Structure.html', 'structure']]) {
    p = openPage(file, view, {});
    await wait(1100);
    const ok3 = ['overview', 'ressources', 'budget', 'suivi', 'copilote'].every((v) => (p.doc.querySelector('.ppm-nav a[data-view="' + v + '"]').getAttribute('href') || '').indexOf('project=' + w.p1.id) >= 0);
    check(ok3, file + ' : tous les liens de la bannière reprennent le projet courant : ' + ['overview', 'ressources', 'budget'].map((v) => p.doc.querySelector('.ppm-nav a[data-view="' + v + '"]').getAttribute('href')).join(' | '));
  }
  p.click(p.caret('budget'));
  check(p.items()[1].getAttribute('href') === 'https://app.test/exec?view=budget&tab=po&project=' + w.p1.id, 'et le menu d’onglets aussi, depuis la Structure');

  // la flèche de Budget suit l'accès à la page
  p = openPage('Suivi.html', 'suivi', { tab: 'ecarts', canBudget: false });
  await wait(300);
  check(p.caret('budget').hidden && !p.caret('suivi').hidden, 'sans accès au budget : ni lien ni flèche pour Budget');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nMenu des onglets : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
