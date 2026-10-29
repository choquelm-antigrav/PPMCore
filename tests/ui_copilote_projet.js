/**
 * Essai des zones du projet de la page Copilote (jsdom, vrai Core) dans les trois modes : désactivé, copier-coller, API (faux modèle).
 * La connexion de la clé Gemini est essayée dans ui_copilote.js.
 *   npm i --no-save jsdom@24 && node tests/ui_copilote_projet.js
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
c.setProp(c.PROP.COPILOT, 'oui');
w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
w.call('remi@entreprise.com', 'progress.declare', { planItemId: w.b.id, progressPct: 20, comment: 'Bloqué : en attente fournisseur' });
c.runRules();
const style = fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user, boot) {
  const calls = [];
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Copilote.html'), 'utf8')
    .replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", style).replace("<?!= include('Common') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Common.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'))
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: w.p1.id, program: '', tab: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test' }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
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
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; window.HTMLDialogElement.prototype.close = function () { this.open = false; };
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
  return { win, doc, until, click, text, button, calls };
}

(async () => {
  console.log('\nPage Copilote, zones du projet (jsdom)');

  // ---------------------------------------------------------------- IA désactivée
  let p = openPage(CP);
  await p.until(() => p.doc.getElementById('brief-lines'));
  check(p.text('title') === 'P1 Projet 1', 'titre');
  check(p.text('mode-badge') === 'IA désactivée', 'mode affiché : ' + p.text('mode-badge'));
  const lines = p.text('brief-lines');
  check(/1 élément en retard, dont « Spécification »/.test(lines) && /signal faible/.test(lines) && /tient la baseline P1_0/.test(lines), 'synthèse calculée : ' + lines.slice(0, 160));
  check([...p.doc.querySelectorAll('.card')].some((x) => /^En retard1/.test(x.textContent)), 'carte des retards');
  check(/Signaux faibles/.test(p.text('panel-synthese')) && /en attente fournisseur/.test(p.text('panel-synthese')), 'signaux faibles listés');
  check(!p.doc.getElementById('brief-ai') && /non activée/.test(p.text('panel-synthese')), 'pas de bouton IA, explication');
  check(p.doc.querySelectorAll('[data-tab]').length === 0 && !p.doc.querySelector('[role="tablist"]'), 'plus d’onglets');
  await p.until(() => p.doc.getElementById('sugg-list') && p.doc.getElementById('sim-open'));
  check(['synthese', 'suggestions', 'simulation', 'questions'].every((z) => !p.doc.getElementById('panel-' + z).hidden && !p.doc.getElementById('panel-' + z).closest('[hidden]')), 'les quatre zones sont affichées ensemble');
  check(p.doc.querySelector('.zones > .cell:first-child').id === 'cell-synthese' && p.doc.getElementById('key-state'), 'la synthèse vient en premier ; la connexion à Gemini est plus bas, sur la même page');
  check(/Mode actuel|désactivé/.test(p.text('mode-note')) && /le copilote IA est désactivé/i.test(p.text('mode-note')) && /la clé ne sert pas encore/.test(p.text('mode-note')), 'mode désactivé : la zone de la clé dit qu’elle ne sert pas encore : ' + p.text('mode-note').slice(0, 80));
  check(p.doc.querySelector('.ppm-bar [data-view="gantt"]').getAttribute('href') === 'https://app.test/exec?view=gantt&project=' + w.p1.id, 'le projet suit dans la barre du haut');

  check(p.calls.indexOf('gantt.project') < 0 && /Rien n’est enregistré/.test(p.text('panel-simulation')), 'simulation : le planning n’est pas chargé à l’ouverture (zone légère, bouton « Commencer »)');
  p.click(p.doc.getElementById('sim-open'));
  await p.until(() => p.doc.getElementById('sim-item'));
  check(p.calls.filter((a) => a === 'gantt.project').length === 1, 'le planning se charge au clic, une fois');
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

  check(/non activées/.test(p.text('panel-questions')) && /Administration › Réglages › Copilote IA/.test(p.text('panel-questions')) && /fonctionnent déjà sans IA/.test(p.text('panel-questions')), 'questions : explication quand l’IA est désactivée, avec où l’activer');

  await p.until(() => p.doc.getElementById('sugg-list'));
  const n0 = p.doc.querySelectorAll('#sugg-list article').length;
  check(n0 >= 2 && /Suggestions du moteur de règles \(\d+\)/.test(p.text('title-sugg')), n0 + ' suggestions en attente');
  const first = p.doc.querySelector('#sugg-list article');
  first.querySelector('input').value = 'Traité en réunion';
  p.click([...first.querySelectorAll('button')].find((b) => b.textContent === 'Accepter'));
  await p.until(() => p.doc.querySelectorAll('#sugg-list article').length === n0 - 1);
  check(/Traité en réunion/.test(p.text('panel-suggestions')) && /Taux d’acceptation100 %/.test(p.text('panel-suggestions')), 'décision tracée, taux d’acceptation');
  const m = openPage(MEMBER);
  await m.until(() => m.doc.getElementById('sugg-list'));
  check(!m.button('Accepter') && /décident/.test(m.text('panel-suggestions')), 'un membre voit sans décider');

  // ---------------------------------------------------------------- copier-coller
  c.setProp(c.PROP.AI_MODE, 'manual');
  p = openPage(CP);
  await p.until(() => p.doc.getElementById('brief-ai'));
  check(p.text('mode-badge') === 'IA : texte à coller dans Gemini', 'mode copier-coller');
  check(/Mode actuel : texte à coller dans Gemini/.test(p.text('mode-note')) && /Aucune clé n’est nécessaire/.test(p.text('mode-note')), 'mode copier-coller : la zone de la clé dit qu’aucune clé n’est nécessaire');
  check(p.doc.getElementById('brief-ai').textContent === 'Préparer le texte pour Gemini', 'bouton adapté au mode');
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('textarea.prompt'));
  check(/Demande : Rédige une synthèse/.test(p.doc.querySelector('textarea.prompt').value), 'texte prêt à copier');
  check(!!p.doc.querySelector('a[href="https://gemini.google.com/app"]'), 'lien vers Gemini');
  p.click(p.button('Copier le texte'));
  await p.until(() => /Ctrl\+C|copié/.test(p.text('toast')));
  check(true, 'copie : ' + p.text('toast'));
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
  check(/Mode actuel : Gemini\. Votre clé sert aux demandes d’IA de cette page/.test(p.text('mode-note')), 'mode Gemini : la zone de la clé dit qu’elle sert');
  script.push({ text: 'La Spécification a 3 jours de retard. Ajouter 47 heures.', calls: [] });
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('.ai .answer'));
  check(/Chiffres absents des données de l’outil : 47/.test(p.text('panel-synthese')), 'chiffre inventé signalé');
  p.click(p.button('Utile'));
  await p.until(() => /Merci/.test(p.text('toast')));
  check(c.repoList('AiLog').some((l) => l.feedback === 'utile'), 'avis enregistré');
  await p.until(() => /1\/30/.test(p.text('mode-badge')));
  check(true, 'compteur de quota mis à jour');
  script.push({ text: '', calls: [{ name: 'simulate_shift', args: { item: 'Calcul', shift_days: 3 } }] });
  script.push({ text: 'La Revue passerait au 13/11/2026.', calls: [] });
  p.doc.getElementById('question').value = 'Et si Calcul glisse de 3 jours ?';
  p.click(p.doc.getElementById('ask-btn'));
  await p.until(() => p.doc.querySelector('#qa .answer'));
  check(p.text('qa').includes('La Revue passerait au 13/11/2026.') && /Données consultées : simulation/.test(p.text('qa')), 'réponse vérifiée, données consultées affichées');

  // ---------------------------------------------------------------- 0.15.0 : mode Gemini, clé personnelle de chaque compte
  console.log('\nMode Gemini avec la clé personnelle');
  const KEY = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  c.AI_PROVIDER = null; c.setProp(c.PROP.AI_MODE, 'api'); c.setProp(c.PROP.GEMINI_MODEL, ''); c.setProp(c.PROP.GEMINI_KEY, '');
  [CP, MEMBER].forEach((u) => { try { c.deleteProp(c.userKeyProp_(u)); } catch (e) { /* aucune clé */ } });
  let google403 = false; const googleCalls = [];
  c.AI_FETCH = (url, opts) => {
    googleCalls.push((/\/models\?/.test(url) ? 'models' : 'generate') + ':' + ((opts.headers || {})['x-goog-api-key'] === KEY ? 'clé de Carla' : 'autre'));
    if (/\/models\?/.test(url)) return { code: 200, text: JSON.stringify({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }) };
    if (google403) return { code: 403, text: JSON.stringify({ error: { message: 'API key not valid (' + KEY + ')' } }) };
    return { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'La synthèse du projet est prête à être relue.' }] } }] }) };
  };
  const scrolled = [];
  p = openPage(CP);
  p.win.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  await p.until(() => p.doc.getElementById('brief-ai'));
  check(/^IA : Gemini — votre clé reste à connecter \(texte à coller en attendant\)$/.test(p.text('mode-badge')), 'sans clé : le badge le dit : ' + p.text('mode-badge'));
  check(/vous n’avez pas encore connecté votre clé/.test(p.text('mode-note')) && /texte à coller dans Gemini/.test(p.text('mode-note')), 'la zone de la clé explique la situation');
  check(p.doc.getElementById('brief-ai').textContent === 'Préparer le texte pour Gemini', 'le bouton propose le texte à coller, pas un appel direct');
  const hint = p.doc.querySelector('.key-hint');
  check(!!hint && /cette demande prépare un texte à coller/.test(hint.textContent) && /Connecter ma clé/.test(hint.textContent), 'une indication mène à la connexion de la clé');
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('textarea.prompt'));
  check(/Demande : Rédige une synthèse/.test(p.doc.querySelector('textarea.prompt').value) && googleCalls.length === 0, 'sans clé la demande marche quand même (texte à coller) et rien ne part chez Google');
  p.click(p.button('Connecter ma clé'));
  check(scrolled.includes('cell-key-status'), 'le bouton amène à la zone de connexion de la clé');
  // la personne colle sa clé dans la même page : les boutons suivent tout de suite
  const used0 = c.aiUsedToday_(CP); // les demandes en texte à coller ne comptent pas dans le quota ; celles déjà faites plus haut, si
  p.doc.getElementById('key-input').value = KEY;
  p.click(p.doc.getElementById('key-save'));
  await p.until(() => new RegExp('Gemini — ' + used0 + '/30').test(p.text('mode-badge')) && !p.doc.querySelector('.key-hint'));
  check(new RegExp('^IA : Gemini — ' + used0 + '/30 demandes aujourd’hui$').test(p.text('mode-badge')), 'clé enregistrée : le badge passe en Gemini direct, avec le quota : ' + p.text('mode-badge'));
  check(c.aiUsedToday_(CP) === used0, 'la demande préparée en texte à coller n’a pas consommé le quota');
  check(/avec votre clé personnelle \(se terminant par AAAA\)/.test(p.text('mode-note')) && /son propre quota/.test(p.text('mode-note')), 'la zone de la clé confirme laquelle sert');
  check(p.doc.getElementById('brief-ai').textContent === 'Rédiger la synthèse avec Gemini' && !p.doc.querySelector('.key-hint'), 'le bouton devient « avec Gemini », l’indication disparaît');
  googleCalls.length = 0;
  p.click(p.doc.getElementById('brief-ai'));
  await p.until(() => p.doc.querySelector('.ai .answer'));
  check(/La synthèse du projet est prête à être relue/.test(p.text('panel-synthese')) && googleCalls.join() === 'generate:clé de Carla', 'réponse directe de Gemini, avec la clé de Carla et un seul appel (le modèle est déjà retenu) : ' + googleCalls.join());
  await p.until(() => new RegExp('— ' + (used0 + 1) + '/30').test(p.text('mode-badge')));
  check(true, 'quota mis à jour : ' + p.text('mode-badge'));
  // Google refuse la clé
  google403 = true;
  p.click(p.doc.getElementById('sim-open')); await p.until(() => p.doc.getElementById('sim-item'));
  p.doc.getElementById('question').value = 'Quels risques ?'; p.click(p.doc.getElementById('ask-btn'));
  await p.until(() => /Google refuse votre clé/.test(p.text('toast')));
  check(/Google refuse votre clé Gemini/.test(p.text('toast')) && p.text('toast').indexOf(KEY) < 0 && /Connexion à Gemini/.test(p.text('toast')), 'clé refusée : message clair, sans la clé : ' + p.text('toast').slice(0, 100));
  google403 = false;
  // suppression de la clé : retour au texte à coller
  p.click(p.doc.getElementById('key-clear'));
  p.click(p.doc.getElementById('clear-ok'));
  await p.until(() => p.doc.querySelector('.key-hint') && /clé reste à connecter/.test(p.text('mode-badge')));
  check(p.doc.getElementById('brief-ai').textContent === 'Préparer le texte pour Gemini', 'clé supprimée : la page repasse au texte à coller');
  // plus de clé commune : même une ancienne propriété ne sert à personne
  c.setProp('PPM_GEMINI_API_KEY', 'AIzaSyCOMMUNECOMMUNECOMMUNECOMMUNECOM');
  const noShared = openPage(CP);
  await noShared.until(() => noShared.doc.getElementById('brief-ai'));
  check(/clé reste à connecter/.test(noShared.text('mode-badge')) && !/clé commune/.test(noShared.text('mode-badge') + noShared.text('mode-note')) && noShared.doc.getElementById('brief-ai').textContent === 'Préparer le texte pour Gemini', 'une ancienne clé commune ne change rien : la personne sans clé reste au texte à coller, sans mention d’une clé commune');
  c.setProp('PPM_GEMINI_API_KEY', ''); c.setProp(c.PROP.AI_MODE, 'off');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nZones du projet de la page Copilote : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
