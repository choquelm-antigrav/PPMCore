/**
 * Essai de la création de dépendances depuis la page Planning (Gantt), dans un navigateur simulé (jsdom), avec le vrai Core.
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_gantt_liens.js
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
const person = (name, email) => c.repoInsert('Resource', { resource_type: 'Interne', name, email, country: 'FR' }, S);
const alice = person('Alice', 'alice@entreprise.com'), remi = person('Rémi', 'remi@entreprise.com'), mia = person('Mia', 'mia@entreprise.com');
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Outillage', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } });
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
c.repoInsert('RoleAssignment', { resource_id: mia.id, role_code: 'MEMBER', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1' } });
const w2 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Essais', wbs_code: '2' } });
c.repoInsert('RoleAssignment', { resource_id: remi.id, role_code: 'RWP', scope_type: 'workpackage', scope_id: w1.id }, S);
const it = (p, name, type, s, f, wp) => call(A, 'planitems.create', { values: { project_id: p.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '' } });
const spec = it(p1, 'Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id);
const plans = it(p1, 'Plans <b>structure</b>', 'Livrable', '2026-10-12', '2026-10-16', w1.id);
const cdr = it(p1, 'Revue CDR', 'Jalon', '2026-10-19', '2026-10-19');
const libre = it(p1, 'Dossier libre', 'Livrable', '2026-10-13', '2026-10-15', w1.id);
const maq = it(p1, 'Maquette', 'Livrable', '2026-10-20', '2026-10-23', w2.id);
const rapport = it(p1, 'Rapport', 'Livrable', '2026-10-26', '2026-10-30', w2.id);
const tool = it(p2, 'Moule', 'Livrable', '2026-10-01', '2026-10-14');
const mk = (pred, succ) => call(A, 'dependencies.create', { values: { predecessor_id: pred.id, successor_id: succ.id, dep_type: 'FS' } });
mk(spec, plans); mk(plans, cdr); mk(tool, plans);

const baseHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
  html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'));
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
  return html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
})();

let user = A;
c.Session = { getActiveUser: () => ({ getEmail: () => user }), getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }), getScriptTimeZone: () => 'Europe/Paris' };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 25));
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };

function openPage(email) {
  user = email;
  const calls = [];
  const dom = new JSDOM(baseHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      const runner = (ok, fail) => ({
        withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => { calls.push(action); user = email; const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid))); setTimeout(() => ok(res), 0); }
      });
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { console.error('Erreur page :', m); failed++; };
    }
  });
  const w = dom.window, doc = w.document;
  const until = async (cond, ms) => { for (let i = 0; i < (ms || 1500) / 20; i++) { if (cond()) return true; await tick(20); } return !!cond(); };
  const text = (id) => (doc.getElementById(id) ? doc.getElementById(id).textContent : '');
  const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
  return { dom, w, doc, calls, until, text, flat, toast: () => flat(text('toast')) };
}

const deps = () => c.repoList('Dependency');
const has = (pred, succ) => deps().filter((d) => d.predecessor_id === pred.id && d.successor_id === succ.id);
const optionsOf = (p) => [...p.doc.querySelectorAll('#dep-pick option')].filter((o) => o.value).map((o) => o.textContent);
const optionIds = (p) => [...p.doc.querySelectorAll('#dep-pick option')].map((o) => o.value).filter(Boolean);
const submit = (p) => p.doc.getElementById('dep-form').dispatchEvent(new p.w.Event('submit', { cancelable: true }));
const choose = (p, id) => { const s = p.doc.getElementById('dep-pick'); s.value = id; s.dispatchEvent(new p.w.Event('change')); };
const openItem = async (p, item) => { p.w.__ppm.onBarClick(item.id); await p.until(() => p.doc.querySelector('#details h2') && p.doc.querySelector('#details h2').textContent === item.name); };
const startLink = async (p, btn) => { p.doc.getElementById(btn).click(); await p.until(() => optionIds(p).length > 0 || /Aucun élément/.test(p.text('dep-pick'))); };
const ready = async (p) => { for (let i = 0; i < 30 && !p.doc.querySelector('.bar-wrapper'); i++) await tick(); };

(async () => {
  console.log('\nPage Planning : créer des dépendances entre livrables');
  let p = openPage('alice@entreprise.com'); await ready(p);

  // ---- la section Dépendances du détail
  await openItem(p, spec);
  check(!!p.doc.getElementById('deps') && /Doit attendre/.test(p.text('deps')) && /Bloque/.test(p.text('deps')), 'le détail d’un livrable montre une section « Dépendances »');
  check(p.flat(p.text('deps-succs')).includes('Plans <b>structure</b> Fin → Début') && !p.doc.querySelector('#deps-succs b'), 'ce que Spécification bloque : Plans, type « Fin → Début », nom affiché en texte (pas de HTML injecté)');
  check(/Aucun\./.test(p.text('deps')) && !p.doc.getElementById('deps-preds'), 'aucun prédécesseur : « Aucun. »');
  check(!!p.doc.getElementById('dep-add-pred') && !!p.doc.getElementById('dep-add-succ') && !!p.doc.querySelector('#deps-succs .dep-remove'), 'le chef de projet a les deux boutons d’ajout et peut retirer');
  await openItem(p, plans);
  const predTexts = [...p.doc.querySelectorAll('#deps-preds li')].map((li) => p.flat(li.textContent));
  check(predTexts.length === 2 && predTexts.some((t) => /^Spécification/.test(t)) && predTexts.some((t) => /^\[P2\] Moule .*non respecté/.test(t)), 'Plans attend Spécification et [P2] Moule (le voisin d’un autre projet, signalé « non respecté »)');
  check(p.doc.querySelectorAll('#deps-preds li.alert').length === 1, 'le lien non respecté est en alerte');

  // ---- créer un lien en choisissant dans la liste
  await openItem(p, libre);
  await startLink(p, 'dep-add-pred');
  check(!!p.doc.getElementById('dep-form') && p.doc.getElementById('main').classList.contains('linking') && /doit attendre/.test(p.text('dep-form')), 'un formulaire s’ouvre dans le détail, le diagramme passe en mode « choix »');
  const ids = optionIds(p);
  check(!ids.includes(libre.id) && ids.includes(spec.id) && ids.includes(maq.id) && ids.includes(tool.id) && ids.includes(cdr.id), 'la liste propose les autres livrables et jalons, dont ceux des autres projets du programme (pas l’élément lui-même)');
  check([...p.doc.querySelectorAll('#dep-pick optgroup')].map((g) => g.label).join('|').includes('2 Essais') && [...p.doc.querySelectorAll('#dep-pick optgroup')].some((g) => /^\[P2\]/.test(g.label)), 'regroupés par workpackage, avec le code du projet pour les autres projets');
  check(optionsOf(p).some((t) => /Revue CDR \(jalon\)/.test(t)) && optionsOf(p).some((t) => /Spécification — 09\/10\/2026/.test(t)), 'chaque choix dit son type (jalon) et sa date de fin');
  check(p.doc.getElementById('dep-submit').disabled, 'tant qu’aucun élément n’est choisi, « Créer le lien » est grisé');
  choose(p, spec.id);
  check(!p.doc.getElementById('dep-submit').disabled && p.flat(p.text('dep-sentence')) === '« Spécification » doit être fini avant que « Dossier libre » commence.', 'une phrase claire dit ce que le lien signifie : ' + p.flat(p.text('dep-sentence')));
  check(p.doc.querySelector('.bar-wrapper[data-id="' + spec.id + '"]').classList.contains('link-target'), 'l’élément choisi est mis en évidence dans le diagramme');
  submit(p);
  await p.until(() => has(spec, libre).length === 1 && p.doc.querySelector('#details h2') && p.doc.querySelector('#details h2').textContent === 'Dossier libre' && p.doc.getElementById('deps-preds'));
  const d1 = has(spec, libre)[0];
  check(d1 && d1.dep_type === 'FS' && Number(d1.lag_days) === 0, 'lien créé : Fin → Début, sans décalage, par défaut');
  check(/Lien créé : Spécification → Dossier libre\./.test(p.toast()), 'confirmation : ' + p.toast());
  check(p.flat(p.text('deps-preds')).includes('Spécification Fin → Début') && !p.doc.getElementById('dep-form') && !p.doc.getElementById('main').classList.contains('linking'), 'le détail est rouvert avec le nouveau lien ; le mode « choix » est terminé');
  check(!!p.doc.querySelector('.arrow path'), 'et la flèche est dessinée dans le diagramme');

  // ---- créer un lien en cliquant sur la barre, avec les options
  await startLink(p, 'dep-add-succ');
  p.w.__ppm.onBarClick(rapport.id);
  check(p.doc.getElementById('dep-pick').value === rapport.id && p.doc.querySelector('#details h2').textContent === 'Dossier libre', 'un clic sur la barre d’un autre élément le choisit, sans quitter le détail courant');
  check(p.doc.querySelector('.bar-wrapper[data-id="' + rapport.id + '"]').classList.contains('link-target') && /« Dossier libre » doit être fini avant que « Rapport » commence/.test(p.text('dep-sentence')), 'barre mise en évidence ; phrase mise à jour (« Dossier libre » bloque « Rapport »)');
  const type = p.doc.getElementById('dep-type'); type.value = 'SS'; type.dispatchEvent(new p.w.Event('change'));
  const lag = p.doc.getElementById('dep-lag'); lag.value = '2'; lag.dispatchEvent(new p.w.Event('input'));
  check(/doit avoir commencé avant que « Rapport » commence \(\+2 jours ouvrés\)/.test(p.text('dep-sentence')), 'la phrase suit le type et le décalage : ' + p.flat(p.text('dep-sentence')));
  submit(p);
  await p.until(() => has(libre, rapport).length === 1 && p.doc.getElementById('deps-succs'));
  const d2 = has(libre, rapport)[0];
  check(d2 && d2.dep_type === 'SS' && Number(d2.lag_days) === 2, 'lien créé : Début → Début, +2 jours ouvrés');
  check(/Rapport Début → Début, \+2 j/.test(p.flat(p.text('deps-succs'))), 'la liste « Bloque » l’affiche : ' + p.flat(p.text('deps-succs')));
  p.w.__ppm.onBarClick(plans.id);
  await p.until(() => p.doc.querySelector('#details h2').textContent === 'Plans <b>structure</b>');
  check(p.doc.querySelector('#details h2').textContent === 'Plans <b>structure</b>', 'hors du mode « choix », un clic sur une barre rouvre normalement le détail');

  // ---- un lien non respecté par les dates : créé, mais signalé
  await openItem(p, libre);
  await startLink(p, 'dep-add-pred');
  choose(p, maq.id); submit(p);
  await p.until(() => has(maq, libre).length === 1 && /non respecté/.test(p.toast()));
  check(has(maq, libre).length === 1 && /Lien créé, mais non respecté par les dates actuelles : il manque \d+ jours? ouvrés? \(date requise le \d\d\/\d\d\/2026\)/.test(p.toast()), 'lien créé mais signalé non respecté, avec ce qu’il manque : ' + p.toast());
  check(/non respecté/.test(p.flat(p.text('deps-preds'))) && p.doc.querySelectorAll('#issues-body tr').length >= 2, 'il apparaît en alerte dans le détail et dans le tableau des dépendances non respectées');

  // ---- une boucle est refusée, le formulaire reste ouvert
  await openItem(p, spec);
  await startLink(p, 'dep-add-pred');
  const before = deps().length;
  choose(p, cdr.id); submit(p);
  await p.until(() => /boucle/.test(p.toast()));
  check(/boucle dans le planning/.test(p.toast()) && deps().length === before && has(cdr, spec).length === 0, 'Revue CDR → Spécification fermerait une boucle : refusé avec une explication, rien d’enregistré : ' + p.toast());
  check(!!p.doc.getElementById('dep-form') && !p.doc.getElementById('dep-submit').disabled, 'le formulaire reste ouvert pour choisir autre chose');
  p.doc.getElementById('dep-cancel').click();
  check(!p.doc.getElementById('dep-form') && !p.doc.getElementById('main').classList.contains('linking') && p.doc.querySelector('#details h2').textContent === 'Spécification', '« Annuler » referme le formulaire, le détail reste ouvert');

  // ---- pas de doublon : les éléments déjà liés ne sont pas proposés
  await openItem(p, plans);
  await startLink(p, 'dep-add-pred');
  const idsPlans = optionIds(p);
  check(!idsPlans.includes(spec.id) && !idsPlans.includes(tool.id) && !idsPlans.includes(cdr.id) && !idsPlans.includes(plans.id) && idsPlans.includes(maq.id), 'Plans n’est pas proposé deux fois avec Spécification, Moule ou Revue CDR (déjà liés), ni avec lui-même');
  p.doc.getElementById('dep-cancel').click();
  p.w.__ppm.onBarClick(spec.id); await p.until(() => p.doc.querySelector('#details h2').textContent === 'Spécification');

  // ---- Échap : d'abord le lien, ensuite le détail
  await openItem(p, libre);
  await startLink(p, 'dep-add-pred');
  p.doc.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!p.doc.getElementById('dep-form') && !p.doc.getElementById('main').classList.contains('linking') && !p.doc.getElementById('details').hidden, 'Échap abandonne le lien en cours, le détail reste ouvert');
  p.doc.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(p.doc.getElementById('details').hidden, 'un second Échap ferme le détail');
  await openItem(p, libre);
  await startLink(p, 'dep-add-pred');
  p.doc.querySelector('#details .close').click();
  check(p.doc.getElementById('details').hidden && !p.doc.getElementById('main').classList.contains('linking') && !p.doc.getElementById('dep-form'), 'fermer le détail abandonne aussi le lien en cours');

  // ---- retirer un lien : deux clics
  await openItem(p, libre);
  const rm = p.doc.querySelector('#deps-preds li[data-dep="' + d1.id + '"] .dep-remove');
  rm.click();
  check(/Confirmer le retrait/.test(rm.textContent) && rm.classList.contains('armed') && has(spec, libre).length === 1, 'un premier clic demande confirmation, sans rien retirer');
  rm.click();
  await p.until(() => has(spec, libre).length === 0 && !p.doc.querySelector('#deps-preds li[data-dep="' + d1.id + '"]'));
  check(has(spec, libre).length === 0 && /Lien retiré\./.test(p.toast()) && p.doc.querySelector('#details h2').textContent === 'Dossier libre', 'le second clic retire le lien (supprimé dans les données), le détail est rafraîchi : ' + p.toast());

  // ---- le mode programme n'offre pas de liens
  await p.until(() => true);
  p.w.document.getElementById('picker').value = 'program:' + prog.id; p.w.document.getElementById('picker').dispatchEvent(new p.w.Event('change'));
  await p.until(() => p.w.__ppm.state.mode === 'program' && p.doc.querySelector('.bar-wrapper'));
  p.w.__ppm.onBarClick('prj:' + p1.id);
  await p.until(() => /Projet/.test(p.text('details')));
  check(!p.doc.getElementById('deps') && !p.doc.getElementById('dep-add-pred'), 'vue programme : les barres sont des projets, pas de création de lien');
  p.dom.window.close();

  // ---- droits : un membre sans droit d'édition
  p = openPage('mia@entreprise.com'); await ready(p);
  await openItem(p, plans);
  check(!!p.doc.getElementById('deps') && p.doc.querySelectorAll('#deps-preds li').length === 2, 'un membre voit les dépendances');
  check(!p.doc.getElementById('dep-add-pred') && !p.doc.getElementById('dep-add-succ') && !p.doc.querySelector('.dep-remove'), 'mais ne peut ni en ajouter ni en retirer : aucun bouton');
  p.dom.window.close();

  // ---- droits : un responsable de workpackage ne modifie que son workpackage
  p = openPage('remi@entreprise.com'); await ready(p);
  await openItem(p, libre);
  check(!!p.doc.getElementById('dep-add-pred') && !!p.doc.getElementById('dep-add-succ'), 'Rémi (responsable du workpackage Conception) peut lier un élément de son workpackage');
  await openItem(p, maq);
  check(!p.doc.getElementById('dep-add-pred') && !!p.doc.getElementById('dep-add-succ'), 'Maquette est dans Essais, qu’il ne gère pas : pas de « Doit attendre » (ce serait modifier Maquette), mais il peut faire attendre un de ses éléments');
  await startLink(p, 'dep-add-succ');
  const mine = optionIds(p);
  check(mine.length > 0 && mine.every((id) => [spec.id, plans.id, libre.id].includes(id)) && !mine.includes(rapport.id), 'et la liste ne propose que ce qu’il peut modifier (Conception) : ' + mine.length + ' élément(s), jamais Rapport');
  p.doc.getElementById('dep-cancel').click();
  await openItem(p, plans);
  check(p.doc.querySelectorAll('#deps-preds li .dep-remove').length === 2, 'il retire les liens dont l’élément aval est dans son workpackage (Plans)');
  await openItem(p, rapport);
  check(p.doc.querySelectorAll('.dep-remove').length === 0, 'et aucun lien dont l’élément aval est hors de son workpackage');
  p.dom.window.close();

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPlanning, liens de dépendance : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
