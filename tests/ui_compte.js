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
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();

function openPage(file, user, boot) {
  const html = src(file).replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: '', program: '', tab: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', home: 'overview', isAdmin: user === ADMIN, view: file === 'Compte.html' ? 'compte' : 'admin' }, boot || {})))
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
  return { win, doc, calls, until, click, change, submit, text };
}

(async () => {
  console.log('\nPage Mon compte (jsdom)');

  // ---------------------------------------------------------------- Ma fiche
  let p = openPage('Compte.html', RWP);
  await p.until(() => p.doc.getElementById('roles-table'));
  check(p.text('title') === 'Mon compte' && p.doc.getElementById('admin-chip').hidden, 'titre, pas de mention « administrateur »');
  check(/Rémi/.test(p.text('panel-fiche')) && /remi@entreprise\.com/.test(p.text('panel-fiche')), 'nom et adresse');
  const rows = [...p.doc.querySelectorAll('#roles-table tbody tr')].map((r) => r.textContent);
  check(rows.length === 2 && /Workpackage leader/.test(rows[0]) && /1 Conception/.test(rows[0]) && /Deliverable owner/.test(rows[1]) && /2 livrables ou jalons/.test(rows[1]), 'rôles et périmètres en lecture seule (leader du WP 1, propriétaire de deux livrables regroupés) : ' + rows.join('|'));
  check(!p.doc.querySelector('#roles-table input, #roles-table button'), 'aucun contrôle de modification sur les rôles');
  check(p.doc.getElementById('edit-function') && !p.doc.getElementById('edit-name'), 'seuls fonction et organisation sont modifiables');
  // 0.14.2 : les suggestions de fonction et d'organisation (jusqu'à 500 personnes) ne se chargent que si l'on touche à ces champs, une seule fois
  const listCalls = () => p.calls.filter((a) => a === 'resources.list').length;
  check(listCalls() === 0 && p.doc.querySelectorAll('#dl-functions option').length === 0, 'à l’ouverture : aucune liste de personnes demandée, aucune suggestion chargée (un aller-retour et 500 lignes de moins)');
  p.doc.getElementById('edit-function').dispatchEvent(new p.win.Event('focus'));
  await p.until(() => p.doc.querySelectorAll('#dl-functions option').length > 0);
  const distinct = (k) => new Set(c.repoList('Resource').map((r) => r[k]).filter(Boolean)).size;
  check(listCalls() === 1 && p.doc.querySelectorAll('#dl-functions option').length === distinct('job_function') && p.doc.querySelectorAll('#dl-orgs option').length === distinct('organization'), 'au premier contact avec la fonction : la liste est demandée une fois, et les suggestions sont exactement les fonctions (' + distinct('job_function') + ') et organisations (' + distinct('organization') + ') connues');
  p.doc.getElementById('edit-org').dispatchEvent(new p.win.Event('focus')); p.doc.getElementById('edit-function').dispatchEvent(new p.win.Event('focus'));
  await new Promise((r) => setTimeout(r, 120));
  check(listCalls() === 1, 'les contacts suivants, avec la fonction ou l’organisation, ne redemandent rien');
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
  check(['reglages', 'sante', 'feries', 'droits', 'journaux'].every((z) => denied.doc.getElementById('zone-' + z).hidden) && !denied.calls.some((a) => a.startsWith('admin.')), 'non-administrateur : message, aucune zone d’administration, aucune demande à l’administration');
  check(denied.doc.getElementById('ppm-admin').hidden, 'lien « Administration » absent de sa bannière');

  // ---------------------------------------------------------------- Réglages
  const a = openPage('Admin.html', ADMIN);
  await a.until(() => a.doc.getElementById('f-admins'));
  check(!a.doc.getElementById('ppm-admin').hidden && a.doc.getElementById('ppm-admin').getAttribute('aria-current') === 'page', 'lien « Administration » visible et marqué pour un administrateur');
  check(a.doc.getElementById('f-admins').value === ADMIN && a.doc.getElementById('f-mode').value === 'off' && a.doc.getElementById('f-quota').value === '30', 'réglages actuels affichés');
  check(/entreprise\.com/.test(a.text('panel-reglages')) && !a.doc.getElementById('f-key') && !a.doc.getElementById('f-clear-key'), 'domaine en lecture seule ; plus de champ de clé commune');
  check(/strictement personnelle/.test(a.text('key-note')) && /page Copilote/.test(a.text('key-note')) && /rien n’est partagé/.test(a.text('key-note')), 'la note dit que la clé est strictement personnelle : ' + a.text('key-note').slice(0, 90));
  a.doc.getElementById('f-admins').value = 'dora@entreprise.com';
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => !a.doc.getElementById('cfg-error').hidden);
  check(/vous retirer vous-même/.test(a.text('cfg-error')) && /DPL|dora/.test(c.getProp(c.PROP.ADMINS, '')) === false, 'se retirer des administrateurs refusé, message sous le formulaire : ' + a.text('cfg-error'));
  a.doc.getElementById('f-admins').value = ADMIN + '\ndora@entreprise.com';
  a.doc.getElementById('f-mode').value = 'manual';
  a.doc.getElementById('f-quota').value = '40';
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => /réglages? enregistrés?/.test(a.text('toast')));
  check(/3 réglages enregistrés/.test(a.text('toast')), 'confirmation avec le nombre de réglages modifiés : ' + a.text('toast'));
  check(c.adminEmails().join() === ADMIN + ',dora@entreprise.com' && c.aiQuota_() === 40 && c.aiMode_() === 'manual', 'administrateurs, quota et mode enregistrés');
  // 0.13.0 : l'administrateur active ou suspend le copilote d'une case à cocher
  check(a.doc.getElementById('f-copilot').checked === true && /rechargement de la page/.test(a.text('copilot-note')) && /accord de votre entreprise/.test(a.text('copilot-note')), 'copilote : case d’activation visible, cochée car activé, avec l’avertissement et la note de rechargement');
  a.doc.getElementById('f-copilot').checked = false;
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => c.copilotEnabled_() === false && /1 réglage enregistré/.test(a.text('toast')));
  check(c.copilotEnabled_() === false && /1 réglage enregistré/.test(a.text('toast')), 'décocher suspend le copilote, tracé comme un réglage : ' + a.text('toast'));
  await a.until(() => !a.doc.getElementById('f-mode'));
  check(!a.doc.getElementById('f-mode') && !!a.doc.getElementById('f-copilot'), 'suspendu : les réglages techniques de l’IA disparaissent, la case reste');
  await a.until(() => a.doc.getElementById('f-copilot'));
  a.doc.getElementById('f-copilot').checked = true;
  a.submit(a.doc.querySelector('form.form'));
  await a.until(() => c.copilotEnabled_() === true && !!a.doc.getElementById('f-mode'));
  check(c.copilotEnabled_() === true && !!a.doc.getElementById('f-mode'), 'recocher réactive le copilote et rend ses réglages');

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
  a.win.__ppm.render(); // la page charge santé et journaux dès l'ouverture : on les recharge après la nuit
  await a.until(() => /Dernière nuitRéussie/.test(a.text('panel-sante')));
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
  await a.until(() => a.doc.querySelector('tr[data-set="FR-2026"] button'));   // le tableau peut être en cours de rechargement
  a.click(a.doc.querySelector('tr[data-set="FR-2026"] button'));
  await a.until(() => a.doc.getElementById('hol-text'));
  a.doc.getElementById('hol-text').value = '2026-02-30 inexistant';
  a.click(a.doc.getElementById('hol-save'));
  await a.until(() => a.doc.getElementById('toast').classList.contains('error'));
  check(/Date invalide/.test(a.text('toast')), 'date inexistante refusée : ' + a.text('toast'));

  // ---------------------------------------------------------------- Droits par niveau (0.15.4)
  await a.until(() => a.doc.getElementById('rights-table'));
  const rt = a.doc.getElementById('rights-table');
  const headRoles = [...rt.querySelectorAll('thead th')].map((th) => th.textContent);
  check(JSON.stringify(headRoles) === JSON.stringify(['Droit', 'PL', 'DPL', 'CP', 'WPL', 'SWPL', 'DO', 'Contrib.', 'Reader']), 'le tableau a une colonne par niveau, du plus haut au Reader : ' + headRoles.join(' | '));
  const rrow = (re) => [...rt.querySelectorAll('tr.right')].find((tr) => re.test(tr.cells[0].textContent));
  const marks = (tr) => [...tr.querySelectorAll('td.lvl')].map((td) => (td.classList.contains('yes') ? '✓' : '—')).join('');
  check(marks(rrow(/Supprimer un projet/)) === '✓✓——————' && marks(rrow(/Supprimer un livrable ou un jalon/)) === '✓✓✓✓✓✓——' && marks(rrow(/Déclarer l’avancement/)) === '✓✓✓✓✓✓✓—', 'les cases : supprimer un projet (PL, DPL), supprimer un livrable (jusqu’au Deliverable owner), déclarer l’avancement (jusqu’au Contributor)');
  check(marks(rrow(/Lire le WBS/)) === '✓✓✓✓✓✓✓✓' && /^—+$/.test(marks(rrow(/Poser le rôle « Program Leader »/))), 'seule la lecture est ouverte au Reader ; personne ne pose le Program Leader');
  check(/Reader/.test(rrow(/Lire le WBS/).cells[0].textContent) && /en profondeur/.test(rrow(/tarifs journaliers/).cells[0].textContent), 'les précisions s’affichent sous le libellé (Reader, en profondeur)');
  check(!!a.doc.querySelector('#rights-table td.yes .sr') && a.doc.querySelector('#rights-table td.yes .sr').textContent === 'oui', 'chaque case a aussi un texte « oui » ou « non » pour les lecteurs d’écran');
  check(/strictement supérieur/.test(a.text('rights-rules')) && /administrateur du site a tous les droits/.test(a.text('rights-admin')), 'les règles et la note sur l’administrateur sont affichées');
  const filt = a.doc.getElementById('rights-filter');
  filt.value = 'budget'; filt.dispatchEvent(new a.win.Event('input', { bubbles: true }));
  const visible = [...rt.querySelectorAll('tr.right')].filter((tr) => !tr.hidden), grpVisible = [...rt.querySelectorAll('tr.grp')].filter((tr) => !tr.hidden);
  check(visible.length >= 3 && visible.length < 15 && visible.every((tr) => /budget/.test(tr.getAttribute('data-search'))) && grpVisible.length >= 1 && grpVisible.length < 5, 'le filtre « budget » ne garde que les lignes concernées et leurs groupes : ' + visible.length + ' lignes, ' + grpVisible.length + ' groupes');
  filt.value = 'zzzz'; filt.dispatchEvent(new a.win.Event('input', { bubbles: true }));
  check([...rt.querySelectorAll('tr.right')].every((tr) => tr.hidden) && [...rt.querySelectorAll('tr.grp')].every((tr) => tr.hidden), 'un filtre sans résultat cache tout');
  filt.value = ''; filt.dispatchEvent(new a.win.Event('input', { bubbles: true }));
  check([...rt.querySelectorAll('tr.right')].every((tr) => !tr.hidden), 'filtre vidé : tout revient');

  // ---------------------------------------------------------------- Journaux
  a.win.__ppm.render();
  await a.until(() => /Réglages de l’outil/.test(a.text('panel-journaux')));
  const logs = a.text('panel-journaux');
  check(/Réglages de l’outil/.test(logs) && /ai_mode/.test(logs) && !/gemini_key/.test(logs), 'réglages tracés, sans aucune clé');
  check(/Aucun échange enregistré/.test(logs), 'échanges avec le copilote : vide tant que l’IA n’est pas utilisée');

  // ---------------------------------------------------------------- domaines autorisés : un champ, avec ses garde-fous
  const dm = openPage('Admin.html', ADMIN, { isAdmin: true });
  await dm.until(() => dm.doc.getElementById('f-domains'));
  check(dm.doc.getElementById('f-domains').value === 'entreprise.com', 'les domaines autorisés se lisent et se modifient dans les réglages : ' + dm.doc.getElementById('f-domains').value);
  dm.doc.getElementById('f-domains').value = 'filiale.fr';
  dm.submit(dm.doc.querySelector('form.form'));
  await dm.until(() => !dm.doc.getElementById('cfg-error').hidden);
  check(/retirer votre propre domaine/.test(dm.text('cfg-error')), 'on ne peut pas retirer son propre domaine : ' + dm.text('cfg-error'));
  dm.doc.getElementById('f-domains').value = 'entreprise.com, filiale.fr';
  dm.submit(dm.doc.querySelector('form.form'));
  await dm.until(() => c.allowedDomains().length === 2);
  check(c.allowedDomains().join() === 'entreprise.com,filiale.fr', 'second domaine enregistré, effet immédiat');
  c.setProp(c.PROP.DOMAIN, 'entreprise.com');

  // ---------------------------------------------------------------- copilote en suspens : absent des réglages, de la santé, des journaux et de la page d'accueil
  c.setProp(c.PROP.COPILOT, 'non');
  const sus = openPage('Admin.html', ADMIN, { isAdmin: true, copilot: false });
  await sus.until(() => sus.doc.getElementById('f-domains') && /Santé de l’installation|Conforme/.test(sus.text('panel-sante')) && sus.doc.querySelector('#panel-journaux table'));
  check(!sus.doc.getElementById('f-mode') && !/Copilote IA/.test(sus.text('panel-reglages')), 'réglages : plus de section « Copilote IA »');
  check(![...sus.doc.querySelectorAll('#panel-sante .card')].some((x) => /^Copilote/.test(x.textContent)), 'santé : plus de carte « Copilote »');
  check(!/Échanges avec le copilote/.test(sus.text('panel-journaux')), 'journaux : plus d’échanges avec le copilote');
  const homeOff = openPage('Compte.html', CP, { copilot: false });
  await homeOff.until(() => homeOff.doc.getElementById('home'));
  check(![...homeOff.doc.querySelectorAll('#home option')].some((o) => o.value === 'copilote') && [...homeOff.doc.querySelectorAll('#home option')].some((o) => o.value === 'budget'), 'page d’accueil : le copilote n’est plus proposé');
  const on = openPage('Compte.html', CP, { copilot: true });
  await on.until(() => on.doc.getElementById('home'));
  check([...on.doc.querySelectorAll('#home option')].some((o) => o.value === 'copilote'), 'réactivé : il revient');
  c.setProp(c.PROP.COPILOT, 'oui');

  // ---------------------------------------------------------------- 0.14.2 : le lien du classeur de données, en tête de Mon compte et dans Administration
  const editors = new Set(), driveCalls = [];
  c.SHEET_DRIVE = { addEditor: (e) => { driveCalls.push('+' + e); if (c.__driveFail) throw new Error(c.__driveFail); editors.add(e); }, removeEditor: (e) => { driveCalls.push('-' + e); editors.delete(e); } };
  c.sheetSetGranted_([]); c.setProp(c.PROP.SHEET_SHARE, 'oui'); c.Session = Object.assign({}, c.Session || {}, { getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }) });
  const mine = openPage('Compte.html', RWP);
  await mine.until(() => mine.doc.getElementById('sheet-link'));
  const link = mine.doc.getElementById('sheet-link');
  check(!mine.doc.getElementById('panel-sheet').hidden && !mine.doc.getElementById('zone-sheet').hidden, 'Mon compte : la carte du classeur est affichée, en tête de page');
  check(mine.doc.querySelector('.zones > .cell:first-child').id === 'cell-sheet', 'et c’est la première carte');
  check(link.getAttribute('href') === 'https://docs.google.com/spreadsheets/d/donnees/edit' && link.getAttribute('target') === '_blank' && /noopener/.test(link.getAttribute('rel')) && /Ouvrir le classeur Google Sheets/.test(link.textContent) && link.className.indexOf('big') >= 0, 'un gros bouton ouvre le classeur Données dans un nouvel onglet');
  check(/ne passe pas par les règles de l’outil/.test(flat(mine.doc.getElementById('sheet-warning').textContent)) && /6 minutes/.test(mine.doc.getElementById('sheet-warning').textContent) && /id et version/.test(mine.doc.getElementById('sheet-warning').textContent) && /données sensibles/.test(mine.doc.getElementById('sheet-warning').textContent), 'l’avertissement dit ce que la modification directe contourne, le délai, les colonnes à ne pas toucher et la sensibilité des données');
  check(driveCalls.filter((k) => k === '+' + RWP).length === 1 && editors.has(RWP), 'l’accès a été accordé à l’ouverture, une fois');
  check(![...mine.doc.querySelectorAll('#panel-sheet a')].some((a) => /historique/.test(a.getAttribute('href'))) && !/spreadsheets\/d\/historique/.test(mine.doc.documentElement.innerHTML), 'aucun lien ne mène au classeur Historique (qui n’est jamais partagé)');
  // Drive refuse
  c.sheetSetGranted_([]); editors.clear(); c.__driveFail = 'pas de compte Google';
  const failing = openPage('Compte.html', RWP);
  await failing.until(() => failing.doc.getElementById('sheet-failed'));
  check(!failing.doc.getElementById('sheet-link') && /pas de compte Google/.test(failing.doc.getElementById('sheet-failed').textContent) && /Partager maintenant/.test(failing.doc.getElementById('sheet-failed').textContent), 'Drive refuse : un message dit pourquoi et quoi faire, sans lien trompeur');
  c.__driveFail = null;
  // partage coupé : seul l'administrateur voit le lien
  c.setProp(c.PROP.SHEET_SHARE, 'non');
  const off = openPage('Compte.html', RWP);
  await wait(500);
  check(off.doc.getElementById('panel-sheet').hidden && !off.doc.getElementById('sheet-link'), 'partage coupé : un invité ne voit plus la carte');
  const offAdmin = openPage('Compte.html', ADMIN);
  await offAdmin.until(() => offAdmin.doc.getElementById('sheet-link'));
  check(!!offAdmin.doc.getElementById('sheet-disabled') && /seuls les administrateurs voient ce lien/.test(offAdmin.doc.getElementById('sheet-disabled').textContent), 'partage coupé : l’administrateur voit encore le lien, avec la raison');
  c.setProp(c.PROP.SHEET_SHARE, 'oui');
  // Administration
  const adm = openPage('Admin.html', ADMIN);
  await adm.until(() => adm.doc.getElementById('f-sheet-share'));
  check(adm.doc.getElementById('sheet-link').getAttribute('href') === 'https://docs.google.com/spreadsheets/d/donnees/edit' && adm.doc.getElementById('sheet-link').getAttribute('target') === '_blank' && adm.doc.getElementById('f-sheet-share').checked, 'Administration → Réglages : le lien du classeur et la case de partage (cochée)');
  check(/contourne les règles de l’outil/.test(adm.doc.getElementById('sheet-note').textContent) && /jamais ceux que vous avez donnés à la main/.test(adm.doc.getElementById('sheet-note').textContent) && /courriel de partage/.test(adm.doc.getElementById('sheet-note').textContent), 'la note dit le contournement des règles, les courriels de Google et que les partages manuels ne sont pas touchés');
  c.repoInsert('Resource', { name: 'Tess', email: 'tess@entreprise.com', resource_type: 'Interne', country: 'FR' }, { actor: 'setup', source: 'setup' });
  adm.click(adm.doc.getElementById('sheet-sync'));
  await adm.until(() => /accès accordé/.test(adm.doc.getElementById('sheet-sync-result').textContent));
  check(editors.has('tess@entreprise.com') && /\d+ accès accordé\(s\), \d+ déjà en place, 0 retiré\(s\)\./.test(adm.doc.getElementById('sheet-sync-result').textContent), '« Partager maintenant » accorde l’accès aux invités et rend le compte rendu : ' + adm.doc.getElementById('sheet-sync-result').textContent);
  adm.doc.getElementById('f-sheet-share').checked = false;
  adm.submit(adm.doc.querySelector('form.form'));
  await adm.until(() => c.getProp(c.PROP.SHEET_SHARE, 'oui') === 'non');
  await adm.until(() => editors.size === 0);
  check(c.getProp(c.PROP.SHEET_SHARE, 'oui') === 'non' && editors.size === 0 && c.sheetGranted_().length === 0, 'décocher et enregistrer coupe le partage et retire les accès accordés par l’outil');
  c.setProp(c.PROP.SHEET_SHARE, 'oui');

  // ---------------------------------------------------------------- 0.15.0 : la protection du classeur, déduite des rôles
  const lockedOf = async (user) => { const q = openPage('Compte.html', user); await q.until(() => q.doc.getElementById('sheet-locked')); return Object.fromEntries([...q.doc.querySelectorAll('#sheet-locked li')].map((li) => [li.getAttribute('data-group'), li.className])); };
  const lk = { rwp: await lockedOf(RWP), cp: await lockedOf(CP), dpl: await lockedOf('dora@entreprise.com'), member: await lockedOf('mia@entreprise.com'), admin: await lockedOf(ADMIN) };
  check(JSON.stringify(lk.rwp) === '{"roles":"cannot","budget":"cannot"}' && JSON.stringify(lk.member) === '{"roles":"cannot","budget":"cannot"}', 'responsable de workpackage et membre : rôles et budget verrouillés pour eux');
  check(JSON.stringify(lk.cp) === '{"roles":"cannot","budget":"can"}', 'chef de projet : peut modifier le budget, pas les rôles');
  check(JSON.stringify(lk.dpl) === '{"roles":"can","budget":"can"}' && JSON.stringify(lk.admin) === '{"roles":"can","budget":"can"}', 'DPL et administrateur : les deux');
  const cpCard = openPage('Compte.html', CP); await cpCard.until(() => cpCard.doc.getElementById('sheet-locked'));
  const lis = [...cpCard.doc.querySelectorAll('#sheet-locked li')].map((li) => flat(li.textContent));
  check(/Rôles et personnes \(RoleAssignment, Role, Resource\) : verrouillée pour vous, réservée aux administrateurs, Program Leader, Domain Program Leader\./.test(lis[0]) && /Budget et achats \(BudgetLine.*RateCard.*\) : vous pouvez la modifier\./.test(lis[1]), 'la liste nomme les feuilles, qui peut les modifier et ce que la personne peut faire : ' + lis[0].slice(0, 90));
  check(/Les autres feuilles \(planning, actualités…\) se modifient librement/.test(cpCard.doc.getElementById('sheet-locked-note').textContent) && /vous pouvez toujours lire/.test(cpCard.doc.getElementById('sheet-locked-note').textContent) && /suit vos rôles tout seul/.test(cpCard.doc.getElementById('sheet-locked-note').textContent), 'la note dit que le reste est libre, que la lecture reste possible et que le verrouillage suit les rôles');
  c.setProp(c.PROP.SHEET_PROTECT, 'non');
  const noLock = openPage('Compte.html', CP); await noLock.until(() => noLock.doc.getElementById('sheet-link'));
  check(!noLock.doc.getElementById('sheet-locked'), 'protection coupée : plus de liste de feuilles verrouillées');
  c.setProp(c.PROP.SHEET_PROTECT, 'oui');
  // Administration
  const adm2 = openPage('Admin.html', ADMIN); await adm2.until(() => adm2.doc.getElementById('f-sheet-protect'));
  const groups = [...adm2.doc.querySelectorAll('.prot-group')];
  check(adm2.doc.getElementById('f-sheet-protect').checked && groups.length === 2, 'Administration : la case de protection (cochée) et les deux groupes de feuilles');
  check(/Rôles et personnes/.test(groups[0].textContent) && /RoleAssignment, Role, Resource/.test(groups[0].textContent) && /administrateurs, Program Leader, Domain Program Leader/.test(groups[0].textContent) && /Chef de projet/.test(groups[1].textContent) && /BudgetLine/.test(groups[1].textContent), 'chaque groupe nomme ses feuilles et les rôles qui peuvent les modifier');
  check(/carla@entreprise\.com/.test(groups[1].querySelector('details').textContent) && !/carla@entreprise\.com/.test(groups[0].querySelector('details').textContent) && /dora@entreprise\.com/.test(groups[0].querySelector('details').textContent), 'les adresses éditrices : le chef de projet pour le budget seulement, le DPL pour les deux');
  check(/MODIFICATION/.test(adm2.doc.getElementById('protect-note').textContent) && /LIRE ces feuilles/.test(adm2.doc.getElementById('protect-note').textContent) && /Aucune adresse à gérer/.test(adm2.doc.getElementById('protect-note').textContent), 'la note dit qu’il n’y a rien à gérer, que seule la modification est interdite et que la lecture reste ouverte');
  c.sheetProtectApply_ = () => ({ enabled: true, ready: true, groups: [{ key: 'roles', protectedSheets: ['RoleAssignment', 'Role', 'Resource'] }, { key: 'budget', protectedSheets: ['BudgetLine', 'BudgetPhasing', 'PurchaseOrder', 'PurchaseOrderLink', 'RateCard', 'ActualImport'] }], failed: [{ table: 'Role', reason: 'quota' }], skipped: ['carla@entreprise.com', 'carla@entreprise.com'], created: 9, removedProtections: 0 });
  adm2.click(adm2.doc.getElementById('protect-now'));
  await adm2.until(() => /feuille\(s\) protégée\(s\)/.test(adm2.doc.getElementById('protect-result').textContent));
  check(/9 feuille\(s\) protégée\(s\), 9 protection\(s\) posée\(s\), 1 en échec : Role \(quota\) ; pas encore éditeurs, faute d’accès au classeur : carla@entreprise\.com\./.test(adm2.doc.getElementById('protect-result').textContent), '« Appliquer maintenant » rend un compte rendu complet : ' + adm2.doc.getElementById('protect-result').textContent);
  let offReport = null; c.sheetProtectApply_ = () => { offReport = { removedProtections: 9 }; return { enabled: false, ready: true, groups: [], failed: [], skipped: [], created: 0, removedProtections: 9 }; };
  adm2.doc.getElementById('f-sheet-protect').checked = false; adm2.submit(adm2.doc.querySelector('form.form'));
  await adm2.until(() => c.getProp(c.PROP.SHEET_PROTECT, 'oui') === 'non');
  check(c.getProp(c.PROP.SHEET_PROTECT, 'oui') === 'non' && offReport && offReport.removedProtections === 9, 'décocher et enregistrer coupe la protection et retire celles de l’outil tout de suite');
  c.setProp(c.PROP.SHEET_PROTECT, 'oui');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPages Mon compte et Administration : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
