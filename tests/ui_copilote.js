/**
 * Essai de la page Copilote (0.13.0) : obtenir et enregistrer sa clé Gemini (jsdom, vrai Core, faux Google).
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
const KEY = 'AIzaSyD-aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Faux Google : accepte la clé, ou la refuse, ou tombe en panne de génération. */
function google(scn) {
  c.AI_FETCH = (url, opts) => {
    if (/\/models\?/.test(url)) {
      if (scn.refuse) return { code: 403, text: JSON.stringify({ error: { message: 'API key not valid for this project' } }) };
      return { code: 200, text: JSON.stringify({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }) };
    }
    if (/:generateContent$/.test(url)) return scn.genFail ? { code: 500, text: JSON.stringify({ error: { message: 'internal' } }) } : { code: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) };
    return { code: 404, text: '{}' };
  };
}

function openPage(user, clip) {
  const html = src('Copilote.html')
    .replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => src(n + '.html'))
    .replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'copilote', home: 'overview', isAdmin: false, canBudget: false, copilot: true }))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const written = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      const clipboard = { writeText: (t) => { written.push(t); return Promise.resolve(); } };
      if (clip === 'blocked') clipboard.readText = () => Promise.reject(new Error('NotAllowedError'));
      else if (typeof clip === 'string') clipboard.readText = () => Promise.resolve(clip);
      Object.defineProperty(window.navigator, 'clipboard', { value: clipboard });
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
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const win = dom.window, doc = win.document;
  const $ = (id) => doc.getElementById(id);
  return {
    win, doc, $, written,
    until: async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; },
    click: (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    text: (id) => flat(($(id) || { textContent: '' }).textContent),
    html: () => doc.documentElement.outerHTML
  };
}

(async () => {
  console.log('\nPage Copilote : la clé Gemini en trois gestes (jsdom)');
  google({});

  // ---------------------------------------------------------------- sans clé : ce que la personne voit et ce qu'elle peut faire
  let p = openPage(MEMBER, ' ' + KEY + ' ');
  await p.until(() => p.$('key-state'));
  check(/Pas encore de clé/.test(p.text('key-state')), 'sans clé : « Pas encore de clé »');
  const link = p.$('get-key');
  check(link.getAttribute('href') === 'https://aistudio.google.com/apikey' && link.getAttribute('target') === '_blank' && /noopener/.test(link.getAttribute('rel')), 'le gros bouton ouvre directement la page de création de clé de Google, dans un nouvel onglet');
  check(/Ouvrir la page de Google/.test(link.textContent) && link.className.indexOf('big') >= 0, 'bouton bien visible, avec une phrase claire');
  const steps = p.doc.querySelectorAll('ol.steps li');
  check(steps.length === 3 && /nouvel onglet/.test(steps[0].textContent) && /Créer une clé API/.test(steps[1].textContent) && /Coller/.test(steps[2].textContent), 'le mode d’emploi tient en trois gestes : ouvrir, créer et copier, revenir coller');
  check(p.$('key-input').type === 'password' && p.$('key-input').getAttribute('autocomplete') === 'off', 'la case est un champ mot de passe, sans mémorisation du navigateur');
  check(/clé gratuite/.test(p.text('data-warning')) && /améliorer les produits de Google/.test(p.text('data-warning')) && /accord/.test(p.text('data-warning')), 'l’avertissement sur l’usage des données avec une clé gratuite est affiché');
  check(/coffre privé/.test(p.text('panel-know')) && /réaffichée/.test(p.text('panel-save')), 'on dit où va la clé et qu’elle ne se réaffiche pas');
  check(!p.$('key-test') && !p.$('key-clear'), 'sans clé : ni « Tester » ni « Supprimer »');

  // ---------------------------------------------------------------- erreurs : dites en mots simples, sans rien enregistrer
  p.click(p.$('key-save'));
  await p.until(() => !p.$('key-error').hidden);
  check(/Collez d’abord/.test(p.text('key-error')), 'case vide : « Collez d’abord votre clé »');
  p.$('key-input').value = 'AIzaSyD aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';
  p.click(p.$('key-save'));
  await p.until(() => /espace/.test(p.text('key-error')));
  check(/ni espace ni retour/.test(p.text('key-error')) && c.userKeyGet_(MEMBER) === null, 'espace dans la clé : refusée, rien d’enregistré');

  // ---------------------------------------------------------------- coller (bouton), enregistrer et tester
  p.$('key-input').value = '';
  p.click(p.$('key-paste'));
  await p.until(() => p.$('key-input').value !== '');
  check(p.$('key-input').value === KEY, 'le bouton « Coller » lit le presse-papiers et retire les espaces autour');
  p.click(p.$('key-save'));
  await p.until(() => p.$('key-last4'));
  check(/Clé enregistrée/.test(p.text('key-state')) && p.text('key-last4') === '…' + KEY.slice(-4), 'enregistrée : on montre seulement les quatre derniers caractères : ' + p.text('key-last4'));
  check(p.$('key-input').value === '', 'la case est vidée : la clé ne reste pas à l’écran');
  check(!p.html().includes(KEY) && !p.text('toast').includes(KEY), 'la clé n’apparaît nulle part dans la page, ni dans le message');
  check(/vérifiée par Google/.test(p.text('toast')) && /gemini-flash-latest/.test(p.text('toast')), 'message de confirmation, avec le modèle choisi : ' + p.text('toast'));
  check(c.userKeyGet_(MEMBER) && c.userKeyGet_(MEMBER).k === KEY, 'côté serveur, la clé est rangée au nom de cette personne');
  check(!!p.$('key-test') && !!p.$('key-clear'), 'les boutons « Tester » et « Supprimer » apparaissent');

  // ---------------------------------------------------------------- tester
  p.click(p.$('key-test'));
  await p.until(() => p.$('test-verdict'));
  const items = [...p.doc.querySelectorAll('#test-result li')];
  check(items.length === 4 && items.slice(0, 3).every((li) => /✓/.test(li.textContent)) && /Tout fonctionne/.test(p.text('test-verdict')), 'le test montre ses trois étapes, toutes réussies, puis « Tout fonctionne » : ' + p.text('test-result'));
  check(/Clé acceptée par Google/.test(p.text('test-result')) && /Modèle choisi — gemini-flash-latest/.test(p.text('test-result')) && /Petite question à Gemini/.test(p.text('test-result')), 'chaque étape porte son nom, et le modèle choisi est nommé');
  google({ genFail: true });
  p.click(p.$('key-test'));
  await p.until(() => p.$('test-verdict') && /souci/.test(p.text('test-verdict')));
  check(/✗/.test(p.text('test-result')) && /Google a répondu 500/.test(p.text('test-verdict')), 'si Gemini échoue, la page le dit et montre l’étape en cause : ' + p.text('test-verdict'));
  google({ refuse: true });
  p.click(p.$('key-test'));
  await p.until(() => p.$('test-verdict') && /Supprimez cette clé/.test(p.text('test-verdict')));
  check(/créez-en une nouvelle/.test(p.text('test-verdict')), 'une clé que Google refuse désormais : on dit d’en créer une nouvelle');
  google({});

  // ---------------------------------------------------------------- une autre personne n'a pas cette clé
  const other = openPage(CP);
  await other.until(() => other.$('key-state'));
  check(/Pas encore de clé/.test(other.text('key-state')) && !other.$('key-test'), 'Carla n’a pas la clé de Mia');
  other.$('key-input').value = 'AQ.Ab8RN6Kexample_key-0123456789zzzz';
  other.$('key-input').dispatchEvent(new other.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await other.until(() => other.$('key-last4'));
  check(other.text('key-last4') === '…zzzz' && c.userKeyGet_(MEMBER).k === KEY, 'la touche Entrée enregistre ; la clé de Mia est intacte');

  // ---------------------------------------------------------------- Google refuse : rien n'est enregistré
  google({ refuse: true });
  const refused = openPage('remi@entreprise.com');
  await refused.until(() => refused.$('key-state'));
  refused.$('key-input').value = KEY;
  refused.click(refused.$('key-save'));
  await refused.until(() => !refused.$('key-error').hidden);
  check(/Google refuse cette clé/.test(refused.text('key-error')) && /Créez-en une nouvelle/.test(refused.text('key-error')) && !refused.text('key-error').includes(KEY), 'clé refusée : message simple, sans recopier la clé');
  check(c.userKeyGet_('remi@entreprise.com') === null && /Pas encore de clé/.test(refused.text('key-state')), 'rien d’enregistré, la page reste « sans clé »');
  google({});

  // ---------------------------------------------------------------- supprimer
  p.click(p.$('key-clear'));
  check(p.$('clear-dialog').open, 'supprimer : une fenêtre demande confirmation');
  p.click(p.$('clear-cancel'));
  check(!p.$('clear-dialog').open && c.userKeyGet_(MEMBER) !== null, '« Garder » : la clé reste');
  p.click(p.$('key-clear'));
  p.click(p.$('clear-ok'));
  await p.until(() => /Pas encore de clé/.test(p.text('key-state')));
  check(c.userKeyGet_(MEMBER) === null && !p.$('key-test'), '« Supprimer » : la clé est oubliée du serveur, la page revient à « sans clé »');

  // ---------------------------------------------------------------- aide : message pour le support
  p.click(p.$('support-copy'));
  await p.until(() => p.written.length === 1);
  check(/aistudio\.google\.com\/apikey/.test(p.written[0]) && /Créer une clé API/.test(p.written[0]) && /Pouvez-vous/.test(p.written[0]), 'le message pour le support est copié, prêt à envoyer : il cite la page et le bouton');
  check(p.$('help-doc').getAttribute('href') === 'https://ai.google.dev/gemini-api/docs/workspace' && /noopener/.test(p.$('help-doc').getAttribute('rel')), 'lien vers l’explication de Google pour les comptes professionnels');
  const blocked = openPage(MEMBER, 'blocked');
  await blocked.until(() => blocked.$('key-state'));
  blocked.click(blocked.$('key-paste'));
  await blocked.until(() => /bloque « Coller »/.test(blocked.text('toast')));
  check(/Ctrl\+V/.test(blocked.text('toast')), 'navigateur qui bloque « Coller » : on explique Ctrl+V');

  // ---------------------------------------------------------------- copilote suspendu : la page le dit au lieu de planter
  c.setProp(c.PROP.COPILOT, 'non');
  const off = openPage(MEMBER);
  await off.until(() => off.$('status-error'));
  check(/suspens/.test(off.text('status-error')), 'copilote suspendu : message clair : ' + off.text('status-error'));

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Copilote : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
