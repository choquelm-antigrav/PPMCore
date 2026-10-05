/**
 * Essai des pages Mon compte et Administration (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_compte.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
c.backupBooks_ = () => {};
c.setProp(c.PROP.DATA_ID, 'donnees'); c.setProp(c.PROP.HISTORY_ID, 'historique');
c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];
const RWP = 'remi@entreprise.com', CP = 'carla@entreprise.com', ADMIN = 'admin@entreprise.com', NOBODY = 'personne@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(file, user, boot) {
  const html = src(file).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: '', program: '', tab: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', home: 'gantt', isAdmin: user === ADMIN, view: file === 'Compte.html' ? 'compte' : 'admin' }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const calls = [];
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
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const win = dom.window, doc = win.document;
  const until = async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const change = (n) => n.dispatchEvent(new win.Event('change', { bubbles: true }));
  const submit = (form) => form.dispatchEvent(new win.Event('submit', { cancelable: true }));
  const text = (id) => (doc.getElementById(id) || { textContent: '' }).textContent;
  const tab = (name) => click(doc.querySelector('[data-tab="' + name + '"]'));
  return { win, doc, calls, until, click, change, submit, text, tab };
}

(async () => {
  console.log('\nPage Mon compte (jsdom)');

  // ---------------------------------------------------------------- Ma fiche
  let p = openPage('Compte.html', RWP);
  await p.until(() => p.doc.getElementById('roles-table'));
  check(p.text('title') === 'Mon compte' && p.doc.getElementById('admin-chip').hidden, 'titre, pas de mention « administrateur »');
  check(/Rémi/.test(p.text('panel-fiche')) && /remi@entreprise\.com/.test(p.text('panel-fiche')), 'nom et adresse');
  const rows = [...p.doc.querySelectorAll('#roles-table tbody tr')].map((r) => r.textContent);
  check(rows.length === 1 && /Responsable de workpackage/.test(rows[0]) && /1 Conception/.test(rows[0]), 'rôle et périmètre en lecture seule : ' + rows.join('|'));
  check(!p.doc.querySelector('#roles-table input, #roles-table button'), 'aucun contrôle de modification sur les rôles');
  check(p.doc.getElementById('edit-function') && !p.doc.getElementById('edit-name'), 'seuls fonction et organisation sont modifiables');
  p.doc.getElementById('edit-function').value = 'Ingénieur calcul';
  p.doc.getElementById('edit-org').value = '  Bureau   d’études ';
  p.submit(p.doc.querySelector('form.form'));
  await p.until(() => /Fiche enregistrée/.test(p.text('toast')));
  const me = c.repoList('Resource').find((r) => r.email === RWP);
  check(me.job_function === 'Ingénieur calcul' && me.organization === 'Bureau d’études', 'fiche enregistrée, espaces nettoyés');
  await p.until(() => p.doc.getElementById('edit-function').value === 'Ingénieur calcul');
  p.doc.getElementById('edit-function').value = 'x'.repeat(81);
  p.submit(p.doc.querySelector('form.form'));
  await p.until(() => p.doc.getElementById('toast').classList.contains('error'));
  check(/Fonction : maximum 80 caractères/.test(p.text('toast')), 'saisie trop longue refusée, avec le champ en cause : ' + p.text('toast'));
  check(p.doc.getElementById('ppm-admin').hidden, 'pas d’accès à l’administration dans la bannière');
  check(p.doc.querySelector('.ppm-bar [data-view="compte"]').getAttribute('aria-current') === 'page', 'bouton « Mon compte » marqué comme page courante');
  check(p.doc.getElementById('nav-plan').getAttribute('href') === 'https://app.test/exec?view=gantt' && p.doc.getElementById('ppm-account').getAttribute('href') === 'https://app.test/exec?view=compte', 'liens de la bannière sans projet');

  const n = openPage('Compte.html', NOBODY);
  await n.until(() => /Aucune fiche/.test(n.text('panel-fiche')));
  check(!n.doc.getElementById('edit-function'), 'sans fiche : message clair, rien à modifier');

  // ---------------------------------------------------------------- Notifications
  p.tab('notifications');
  await p.until(() => p.doc.querySelector('input[name=freq]'));
  check(p.doc.querySelector('input[name=freq][value="Quotidien"]').checked, 'fréquence par défaut : quotidien');
  const weekly = p.doc.querySelector('input[name=freq][value="Hebdomadaire"]');
  weekly.checked = true; p.change(weekly);
  await p.until(() => p.text('notif-state') === 'Réglage enregistré.');
  check(c.repoList('UserSetting').find((s) => s.user_email === RWP).notify_frequency === 'Hebdomadaire', 'fréquence enregistrée');
  p.click(p.doc.getElementById('preview-btn'));
  await p.until(() => !p.doc.getElementById('preview').hidden);
  check(/Bonjour Rémi/.test(p.doc.getElementById('preview').getAttribute('srcdoc')) && p.doc.getElementById('preview').getAttribute('sandbox') === '', 'aperçu dans un cadre sans script');
  c.SENT_MAILS.length = 0;
  p.click(p.doc.getElementById('send-btn'));
  await p.until(() => /Envoyé/.test(p.text('preview-note')));
  check(c.SENT_MAILS.length === 1 && c.SENT_MAILS[0].to === RWP, 'récapitulatif d’essai envoyé à soi-même');

  // rappel avant livraison
  check(p.doc.getElementById('reminder-on').checked && p.doc.getElementById('reminder-days').value === '' && p.doc.getElementById('reminder-days').placeholder === '10', 'rappel actif par défaut, délai vide = 10');
  p.doc.getElementById('reminder-days').value = '3'; p.change(p.doc.getElementById('reminder-days'));
  await p.until(() => Number((c.repoList('UserSetting').find((s) => s.user_email === RWP) || {}).reminder_days) === 3);
  check(true, 'délai personnel de 3 jours ouvrés enregistré');
  p.doc.getElementById('reminder-days').value = '0'; p.change(p.doc.getElementById('reminder-days'));
  await p.until(() => p.doc.getElementById('toast').classList.contains('error'));
  check(/entre 1 et 60/.test(p.text('toast')), 'délai hors bornes refusé : ' + p.text('toast'));
  p.doc.getElementById('reminder-on').checked = false; p.change(p.doc.getElementById('reminder-on'));
  await p.until(() => c.isTrue((c.repoList('UserSetting').find((s) => s.user_email === RWP) || {}).reminder_off));
  check(true, 'désinscription enregistrée');

  // ---------------------------------------------------------------- Affichage
  p.tab('affichage');
  await p.until(() => p.doc.getElementById('home'));
  check(p.doc.querySelector('input[name=theme][value="auto"]').checked && p.doc.getElementById('home').value === 'overview', 'réglages par défaut : automatique, Overview projet');
  const dark = p.doc.querySelector('input[name=theme][value="dark"]');
  dark.checked = true; p.change(dark);
  await p.until(() => c.loadPrefs_(RWP).ui.theme === 'dark');
  check(p.doc.documentElement.classList.contains('dark') && p.doc.documentElement.getAttribute('data-theme') === 'dark', 'thème nuit appliqué aussitôt');
  check(p.doc.getElementById('ppm-theme').title === 'Thème jour', 'le bouton de la bannière suit');
  const auto = p.doc.querySelector('input[name=theme][value="auto"]');
  auto.checked = true; p.change(auto);
  await p.until(() => c.loadPrefs_(RWP).ui.theme === 'auto');
  check(!p.doc.documentElement.hasAttribute('data-theme'), 'retour à « automatique » : le réglage de l’ordinateur reprend la main');
  p.doc.getElementById('home').value = 'suivi'; p.change(p.doc.getElementById('home'));
  await p.until(() => c.loadPrefs_(RWP).ui.home === 'suivi');
  check(c.loadPrefs_(RWP).ui.theme === 'auto', 'la page d’accueil et le thème se mémorisent ensemble');
  const home = openPage('Compte.html', RWP, { home: 'suivi' });
  await home.until(() => home.doc.getElementById('ppm-brand').getAttribute('href') !== '#');
  check(home.doc.getElementById('ppm-brand').getAttribute('href') === 'https://app.test/exec?view=suivi', 'cliquer sur « PPM » ouvre la page d’accueil choisie');

  // ---------------------------------------------------------------- Administration : accès
  console.log('\nPage Administration (jsdom)');
  const denied = openPage('Admin.html', CP);
  await denied.until(() => /Réservé aux administrateurs/.test(denied.text('panel-reglages')));
  check(denied.doc.getElementById('tabs').hidden && !denied.calls.some((a) => a.startsWith('admin.')), 'non-administrateur : message, onglets cachés, aucune demande à l’administration');
  check(denied.doc.getElementById('ppm-admin').hidden, 'lien « Administration » absent de sa bannière');

  // ---------------------------------------------------------------- Réglages
  const a = openPage('Admin.html', ADMIN);
  await a.until(() => a.doc.getElementById('f-admins'));
  check(!a.doc.getElementById('ppm-admin').hidden && a.doc.getElementById('ppm-admin').getAttribute('aria-current') === 'page', 'lien « Administration » visible et marqué pour un administrateur');
  check(a.doc.getElementById('f-admins').value === ADMIN && a.doc.getElementById('f-mode').value === 'off' && a.doc.getElementById('f-quota').value === '30', 'réglages actuels affichés');
  check(/entreprise\.com/.test(a.text('panel-reglages')) && !a.doc.getElementById('f-key').value, 'domaine en lecture seule ; champ de clé toujours vide');
  a.doc.getElementById('f-admins').value = 'dora@entreprise.com';
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => !a.doc.getElementById('cfg-error').hidden);
  check(/vous retirer vous-même/.test(a.text('cfg-error')) && /DPL|dora/.test(c.getProp(c.PROP.ADMINS, '')) === false, 'se retirer des administrateurs refusé, message sous le formulaire : ' + a.text('cfg-error'));
  a.doc.getElementById('f-admins').value = ADMIN + '\ndora@entreprise.com';
  a.doc.getElementById('f-mode').value = 'api'; a.doc.getElementById('f-model').value = '';
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => /clé Gemini et le nom du modèle/.test(a.text('cfg-error')));
  check(c.adminEmails().length === 1, 'mode api sans clé ni modèle refusé : rien n’a été enregistré, même pour le reste du formulaire');
  const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789';
  a.doc.getElementById('f-mode').value = 'manual'; a.doc.getElementById('f-key').value = KEY;
  a.doc.getElementById('f-quota').value = '40';
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => /réglages? enregistrés?/.test(a.text('toast')));
  check(/4 réglages enregistrés/.test(a.text('toast')), 'confirmation avec le nombre de réglages modifiés : ' + a.text('toast'));
  check(c.adminEmails().join() === ADMIN + ',dora@entreprise.com' && c.aiQuota_() === 40 && c.aiMode_() === 'manual' && c.getProp(c.PROP.GEMINI_KEY, '') === KEY, 'administrateurs, quota, mode et clé enregistrés');
  await a.until(() => a.doc.getElementById('f-key').placeholder.includes('clé enregistrée'));
  check(!a.doc.documentElement.outerHTML.includes(KEY), 'la clé n’apparaît nulle part dans la page après enregistrement');

  a.tab('reglages');
  await a.until(() => a.doc.getElementById('f-reminder-days'));
  check(a.doc.getElementById('f-reminder-on').checked && a.doc.getElementById('f-reminder-days').value === '10', 'rappels : actifs, 10 jours ouvrés par défaut');
  a.doc.getElementById('f-reminder-days').value = '7'; a.doc.getElementById('f-reminder-on').checked = false;
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => /2 réglages enregistrés/.test(a.text('toast')));
  check(c.reminderDefaults_().on === false && c.reminderDefaults_().days === 7, 'réglage par défaut des rappels enregistré par l’administrateur : ' + JSON.stringify(c.reminderDefaults_()));
  const rp = openPage('Compte.html', RWP, { tab: 'notifications' });
  await rp.until(() => rp.doc.getElementById('reminder-on'));
  check(rp.doc.getElementById('reminder-on').disabled && rp.doc.getElementById('reminder-days').disabled && /désactivés par l’administrateur/.test(rp.text('reminder-note')), 'rappels désactivés : les réglages personnels sont grisés, avec la raison');
  c.setProp(c.PROP.REMINDER_ON, 'oui');

  // ---------------------------------------------------------------- Santé
  c.nightlyRun();
  a.tab('sante');
  await a.until(() => a.doc.querySelector('#panel-sante .cards'));
  const cards = [...a.doc.querySelectorAll('#panel-sante .card')].map((x) => x.textContent);
  check(cards.some((x) => /^InstallationConforme/.test(x)) && cards.some((x) => /^Dernière nuitRéussie/.test(x)), 'installation conforme, dernière nuit réussie : ' + cards.slice(0, 2).join(' / '));
  check(a.doc.querySelectorAll('#panel-sante tbody tr').length === 5 && /Sauvegarde des classeurs/.test(a.text('panel-sante')), 'les 5 étapes de la nuit avec leur durée');
  check(/Déclencheurs : nuit 1, récapitulatif de 7 h 1/.test(a.text('triggers')), 'déclencheurs comptés');
  c.TRIGGER_LIST = () => ['sendDigests'];
  a.click(a.doc.getElementById('health-reload'));
  await a.until(() => a.doc.getElementById('checks'));
  check(/Déclencheur nocturne absent/.test(a.text('checks')) && [...a.doc.querySelectorAll('#panel-sante .card')].some((x) => /point à corriger/.test(x.textContent)), 'un déclencheur manquant devient un point à corriger');
  c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];

  // ---------------------------------------------------------------- Jours fériés
  a.tab('feries');
  await a.until(() => a.doc.querySelectorAll('#panel-feries tbody tr').length === 8);
  check(a.doc.querySelectorAll('#panel-feries tbody tr').length === 8 && /France \(FR\)/.test(a.text('panel-feries')), '4 pays, 2 années');
  a.doc.getElementById('hol-years').value = '2028';
  a.click(a.doc.getElementById('hol-add'));
  await a.until(() => a.doc.querySelectorAll('#panel-feries tbody tr').length === 12);
  check(true, 'année ajoutée : 12 lignes');
  a.doc.getElementById('hol-years').value = '2019';
  a.click(a.doc.getElementById('hol-add'));
  await a.until(() => a.doc.getElementById('toast').classList.contains('error'));
  check(/entre 2020 et 2045/.test(a.text('toast')), 'année hors limites refusée : ' + a.text('toast'));
  a.click(a.doc.querySelector('tr[data-set="FR-2026"] button'));
  await a.until(() => a.doc.getElementById('hol-text'));
  const before = c.repoList('HolidaySet').find((s) => s.id === 'FR-2026');
  const lines = a.doc.getElementById('hol-text').value.split('\n');
  check(/^2026-01-01/.test(lines[0]) && lines.length === JSON.parse(before.dates_json).length, 'dates du jeu listées, une par ligne');
  a.doc.getElementById('hol-text').value += '\n2026-10-26 Pont de l’entreprise';
  a.click(a.doc.getElementById('hol-save'));
  await a.until(() => /Jours fériés enregistrés/.test(a.text('toast')));
  check(c.loadHolidayMap('FR')['2026-10-26'] === true, 'jour ajouté, pris en compte par les projets');
  a.click(a.doc.querySelector('tr[data-set="FR-2026"] button'));
  await a.until(() => a.doc.getElementById('hol-text'));
  a.doc.getElementById('hol-text').value = '2026-02-30 inexistant';
  a.click(a.doc.getElementById('hol-save'));
  await a.until(() => a.doc.getElementById('toast').classList.contains('error'));
  check(/Date invalide/.test(a.text('toast')), 'date inexistante refusée : ' + a.text('toast'));

  // ---------------------------------------------------------------- Journaux
  a.tab('journaux');
  await a.until(() => a.doc.querySelector('#panel-journaux table'));
  const logs = a.text('panel-journaux');
  check(/Réglages de l’outil/.test(logs) && /gemini_key/.test(logs) && /remplacée/.test(logs) && !logs.includes(KEY), 'réglages tracés, sans jamais montrer la clé');
  check(/Aucun échange enregistré/.test(logs), 'échanges avec le copilote : vide tant que l’IA n’est pas utilisée');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPages Mon compte et Administration : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
