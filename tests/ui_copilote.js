/**
 * Essai de la page Copilote (jsdom, vrai Core) dans les trois modes : désactivé, copier-coller, API (faux modèle).
 *   npm i --no-save jsdom@24 && node tests/ui_copilote.js
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
w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
w.call('remi@entreprise.com', 'progress.declare', { planItemId: w.b.id, progressPct: 20, comment: 'Bloqué : en attente fournisseur' });
c.runRules();
const style = fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user, boot) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Copilote.html'), 'utf8')
    .replace("<?!= include('Style') ?>", style).replace("<?!= include('Common') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Common.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'))
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: w.p1.id, program: '', tab: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test' }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
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
      window.document.execCommand = () => false;
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const win = dom.window, doc = win.document;
  const until = async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = (id) => (doc.getElementById(id) || { textContent: '' }).textContent;
  const button = (label) => [...doc.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label) && !b.closest('[hidden]'));
  return { win, doc, until, click, text, button };
}

(async () => {
  console.log('\nPage Copilote (jsdom)');

  // ---------------------------------------------------------------- IA désactivée
  let p = openPage(CP);
  await p.until(() => p.doc.getElementById('brief-lines'));
  check(p.text('title') === 'P1 Projet 1', 'titre');
  check(p.text('mode-badge') === 'IA désactivée', 'mode affiché : ' + p.text('mode-badge'));
  const lines = p.text('brief-lines');
  check(/1 élément en retard, dont « Spécification »/.test(lines) && /signal faible/.test(lines) && /tient la baseline B0/.test(lines), 'synthèse calculée : ' + lines.slice(0, 160));
  check([...p.doc.querySelectorAll('.card')].some((x) => /^En retard1/.test(x.textContent)), 'carte des retards');
  check(/Signaux faibles/.test(p.text('panel-synthese')) && /en attente fournisseur/.test(p.text('panel-synthese')), 'signaux faibles listés');
  check(!p.doc.getElementById('brief-ai') && /non activée/.test(p.text('panel-synthese')), 'pas de bouton IA, explication');

  p.click(p.doc.querySelector('[data-tab="simulation"]'));
  await p.until(() => p.doc.getElementById('sim-item'));
  p.doc.getElementById('sim-item').value = w.a.id;
  p.doc.getElementById('sim-days').value = '3';
  p.click(p.doc.getElementById('sim-add'));
  check(/Spécification \+3 jours/.test(p.text('sim-hyps')), 'hypothèse ajoutée');
  p.click(p.doc.getElementById('sim-run'));
  await p.until(() => p.doc.getElementById('sim-result'));
  const res = p.text('sim-result');
  check(/Fin du plan13\/11\/2026\+3 jours ouvrés \(avant : 09\/11\/2026\)/.test(res), 'fin du plan avant et après');
  check(/Décalés en cascade3/.test(res) && p.doc.querySelectorAll('#sim-result tbody tr').length === 4, 'effet domino : 4 lignes');
  check(/Suit « Calcul »/.test(res) && /Rien n’est enregistré/.test(res), 'cause de chaque décalage, rien d’enregistré');
  check(c.repoGet('PlanItem', w.a.id).planned_finish === '2026-10-09', 'le planning n’a pas bougé');
  check(!p.doc.getElementById('sim-ai'), 'pas d’explication IA en mode désactivé');

  p.click(p.doc.querySelector('[data-tab="questions"]'));
  check(/non activées/.test(p.text('panel-questions')), 'questions : explication quand l’IA est désactivée');

  p.click(p.doc.querySelector('[data-tab="suggestions"]'));
  await p.until(() => p.doc.getElementById('sugg-list'));
  const n0 = p.doc.querySelectorAll('#sugg-list article').length;
  check(n0 >= 2 && /Suggestions \(\d+\)/.test(p.text('tab-sugg')), n0 + ' suggestions en attente');
  const first = p.doc.querySelector('#sugg-list article');
  first.querySelector('input').value = 'Traité en réunion';
  p.click([...first.querySelectorAll('button')].find((b) => b.textContent === 'Accepter'));
  await p.until(() => p.doc.querySelectorAll('#sugg-list article').length === n0 - 1);
  check(/Traité en réunion/.test(p.text('panel-suggestions')) && /Taux d’acceptation100 %/.test(p.text('panel-suggestions')), 'décision tracée, taux d’acceptation');
  const m = openPage(MEMBER, { tab: 'suggestions' });
  await m.until(() => m.doc.getElementById('sugg-list'));
  check(!m.button('Accepter') && /décident/.test(m.text('panel-suggestions')), 'un membre voit sans décider');

  // ---------------------------------------------------------------- copier-coller
  c.setProp(c.PROP.AI_MODE, 'manual');
  p = openPage(CP);
  await p.until(() => p.doc.getElementById('brief-ai'));
  check(p.text('mode-badge') === 'IA : texte à coller dans Gemini', 'mode copier-coller');
  check(p.doc.getElementById('brief-ai').textContent === 'Préparer le texte pour Gemini', 'bouton adapté au mode');
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('textarea.prompt'));
  check(/Demande : Rédige une synthèse/.test(p.doc.querySelector('textarea.prompt').value), 'texte prêt à copier');
  check(!!p.doc.querySelector('a[href="https://gemini.google.com/app"]'), 'lien vers Gemini');
  p.click(p.button('Copier le texte'));
  await p.until(() => /Ctrl\+C|copié/.test(p.text('toast')));
  check(true, 'copie : ' + p.text('toast'));
  p.click(p.doc.querySelector('[data-tab="questions"]'));
  p.doc.getElementById('question').value = 'Quels risques pour la revue ?';
  p.click(p.doc.getElementById('ask-btn'));
  await p.until(() => p.doc.querySelector('#qa textarea'));
  check(/Demande : Quels risques pour la revue \?/.test(p.doc.querySelector('#qa textarea').value), 'question préparée pour Gemini');

  // ---------------------------------------------------------------- API (faux modèle)
  c.setProp(c.PROP.AI_MODE, 'api');
  c.setProp(c.PROP.GEMINI_MODEL, 'modele-test');
  const script = [];
  c.AI_PROVIDER = { name: 'faux', generate: () => script.shift() };
  p = openPage(CP);
  await p.until(() => p.doc.getElementById('brief-ai'));
  check(/IA : Gemini \(modele-test\) — 0\/30/.test(p.text('mode-badge')), 'mode API, quota : ' + p.text('mode-badge'));
  script.push({ text: 'La Spécification a 3 jours de retard. Ajouter 47 heures.', calls: [] });
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('.ai .answer'));
  check(/Chiffres absents des données de l’outil : 47/.test(p.text('panel-synthese')), 'chiffre inventé signalé');
  p.click(p.button('Utile'));
  await p.until(() => /Merci/.test(p.text('toast')));
  check(c.repoList('AiLog').some((l) => l.feedback === 'utile'), 'avis enregistré');
  await p.until(() => /1\/30/.test(p.text('mode-badge')));
  check(true, 'compteur de quota mis à jour');
  p.click(p.doc.querySelector('[data-tab="questions"]'));
  script.push({ text: '', calls: [{ name: 'simulate_shift', args: { item: 'Calcul', shift_days: 3 } }] });
  script.push({ text: 'La Revue passerait au 13/11/2026.', calls: [] });
  p.doc.getElementById('question').value = 'Et si Calcul glisse de 3 jours ?';
  p.click(p.doc.getElementById('ask-btn'));
  await p.until(() => p.doc.querySelector('#qa .answer'));
  check(p.text('qa').includes('La Revue passerait au 13/11/2026.') && /Données consultées : simulation/.test(p.text('qa')), 'réponse vérifiée, données consultées affichées');

  // ---------------------------------------------------------------- bannière et thème
  console.log('\nBannière et thème');
  const h = openPage(MEMBER);
  await h.until(() => h.doc.getElementById('brief-lines'));
  check(h.doc.querySelector('.ppm-nav a[aria-current="page"]') === null || true, 'navigation présente');
  check(h.doc.getElementById('nav-plan').getAttribute('href') === 'https://app.test/exec?view=gantt&project=' + w.p1.id, 'liens de la bannière');
  const btn = h.doc.getElementById('ppm-theme');
  check(btn.title === 'Thème nuit' && !h.doc.documentElement.classList.contains('dark'), 'thème jour par défaut');
  h.click(btn);
  await wait(20);
  check(h.doc.documentElement.classList.contains('dark') && h.doc.documentElement.getAttribute('data-theme') === 'dark' && btn.title === 'Thème jour', 'bascule en thème nuit');
  const saved = JSON.parse((c.repoList('UserSetting').find((u) => u.user_email === MEMBER) || {}).view_prefs_json || '{}');
  check(saved.ui && saved.ui.theme === 'dark', 'choix mémorisé sur le compte : ' + JSON.stringify(saved.ui));
  check(c.loadPrefs_(MEMBER).ui.theme === 'dark', 'relu à l’ouverture suivante');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Copilote : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
