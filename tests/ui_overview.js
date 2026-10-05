/**
 * Essai de la page Overview projet : verdict, trois indicateurs, portefeuille, création et renommage (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_overview.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com';
w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nacelle' });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 10000 } });
w.call(CP, 'po.save', { values: { po_number: 'CB-1', cpn: 'CPN-100', resource_id: w.xavier.id, amount: 8800, status: 'Lancée', gr_due_date: '2026-12-01' }, links: [{ deliverable_id: w.cc.id, amount: 8800 }] });
c.runRules();
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s/g, ' ');

function openPage(user, project) {
  const html = src('Overview.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: project || '', program: '', tab: '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'overview', home: 'overview', isAdmin: false, canBudget: true }))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
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
  const until = async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; };
  const $ = (id) => doc.getElementById(id);
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = (id) => flat(($(id) || { textContent: '' }).textContent);
  const kpi = (k) => doc.querySelector('[data-kpi="' + k + '"]');
  const submit = () => $('gf-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const set = (id, v) => { $('gf-' + id).value = v; };
  return { win, doc, until, $, click, text, kpi, submit, set };
}

(async () => {
  console.log('\nPage Overview projet (jsdom)');

  let p = openPage(CP);
  await p.until(() => p.kpi('time'));
  check(p.text('title') === 'Projet 1' && /P1/.test(p.text('chips')) && /CPN CPN-100/.test(p.text('chips')) && /Chef de projet : Carla/.test(p.text('chips')), 'titre et repères du projet : ' + p.text('chips'));
  check(p.doc.querySelectorAll('.kpi').length === 3 && ['time', 'quality', 'cost'].every((k) => p.kpi(k)), 'trois indicateurs : délais, qualité, coût');
  check(p.kpi('time').getAttribute('data-level') === 'alert' && /Alerte/.test(p.kpi('time').textContent) && /1 élément en retard/.test(p.kpi('time').textContent), 'délais en alerte : ' + flat(p.kpi('time').textContent).slice(0, 120));
  check(p.kpi('quality').getAttribute('data-level') === 'none' && /Aucun risque saisi/.test(p.kpi('quality').textContent), 'qualité non renseignée : registre des risques vide');
  check(p.kpi('cost').getAttribute('data-level') === 'warn' && /88 %/.test(p.kpi('cost').textContent) && /8 800 € sur 10 000 €/.test(flat(p.kpi('cost').textContent)), 'coût en vigilance, avec les montants pour le chef de projet');
  check(p.$('verdict').getAttribute('data-level') === 'alert' && /alerte/.test(p.text('verdict-text')) && /délais/.test(p.text('verdict-text')), 'verdict global = le pire des trois : ' + p.text('verdict-text'));
  check(p.kpi('time').querySelector('a.more').getAttribute('href') === 'https://app.test/exec?view=gantt&project=' + w.p1.id && /view=budget/.test(p.kpi('cost').querySelector('a.more').getAttribute('href')), 'liens vers le détail de chaque indicateur');
  check(p.doc.querySelectorAll('#portfolio .proj').length === 2 && p.doc.querySelector('#portfolio .proj[aria-current="true"]').getAttribute('data-id') === w.p1.id, 'portefeuille : deux projets, le courant est marqué');
  check(/Revue/.test(p.text('milestones')) && /Repères|Début|Fin visée/.test(p.text('facts')), 'jalons à venir et repères');
  check(p.$('project-new').hidden && !p.$('project-edit').hidden, 'un chef de projet renomme son projet mais n’en crée pas');
  check(p.doc.getElementById('nav-overview').getAttribute('aria-current') === 'page' && !!p.doc.getElementById('nav-res'), 'bannière : onglet Overview courant, onglet Ressources présent');

  // changer de projet depuis le portefeuille
  p.click(p.doc.querySelector('#portfolio .proj[data-id="' + w.p2.id + '"]'));
  await p.until(() => p.text('title') === 'Projet 2');
  check(p.kpi('time').getAttribute('data-level') === 'none' && /Pas encore de planning daté/.test(p.kpi('time').textContent) && p.$('verdict').getAttribute('data-level') === 'none', 'un projet sans planning n’est pas évalué');

  // renommer
  p = openPage(CP, w.p1.id);
  await p.until(() => p.kpi('time'));
  p.click(p.$('project-edit'));
  await p.until(() => p.$('genform').open);
  check(p.$('gf-name').value === 'Projet 1' && p.$('gf-code').value === 'P1', 'formulaire prérempli');
  p.set('name', 'Nacelle moteur v2'); p.set('code', 'P2'); p.submit();
  await p.until(() => !p.$('gf-error').hidden);
  check(/déjà utilisé/.test(p.text('gf-error')), 'code déjà pris refusé : ' + p.text('gf-error'));
  p.set('code', 'NAC-1'); p.submit();
  await p.until(() => p.text('title') === 'Nacelle moteur v2');
  check(c.repoGet('Project', w.p1.id).code === 'NAC-1' && /Projet NAC-1|NAC-1/.test(p.text('chips')), 'projet renommé, en-tête et code mis à jour');

  // créer (DPL)
  const d = openPage(DPL, w.p1.id);
  await d.until(() => !d.$('project-new').hidden);
  d.click(d.$('project-new'));
  await d.until(() => d.$('genform').open);
  check(d.text('gf-title') === 'Nouveau projet' && d.doc.querySelectorAll('#gf-manager_resource_id option').length >= 4, 'formulaire de création : programme, chef de projet, dates, CPN');
  d.submit();
  await d.until(() => !d.$('gf-error').hidden);
  check(/nom est obligatoire/.test(d.text('gf-error')), 'nom vide refusé : ' + d.text('gf-error'));
  d.set('code', 'P7'); d.set('name', 'Système de dégivrage'); d.set('program_id', w.prog.id); d.set('manager_resource_id', w.carla.id); d.set('start_date', '2026-11-02'); d.set('end_date', '2027-06-30'); d.set('cpn', 'cpn-700'); d.set('cpn_label', 'Dégivrage');
  d.submit();
  await d.until(() => d.text('title') === 'Système de dégivrage');
  const p7 = c.repoList('Project').find((x) => x.code === 'P7');
  check(p7 && p7.cpn === 'CPN-700' && p7.manager_resource_id === w.carla.id && p7.status === 'Actif', 'projet créé avec son CPN et son chef de projet');
  check(/CPN CPN-700/.test(d.text('chips')) && d.doc.querySelectorAll('#portfolio .proj').length === 3 && d.kpi('time').getAttribute('data-level') === 'none', 'affiché aussitôt, ajouté au portefeuille, pas encore évalué');

  // simple membre
  const m = openPage(MEMBER, w.p1.id);
  await m.until(() => m.kpi('cost'));
  check(m.$('project-new').hidden && m.$('project-edit').hidden, 'un membre ne crée ni ne renomme');
  check(!/€/.test(m.kpi('cost').textContent) && /88 %/.test(m.kpi('cost').textContent), 'un membre voit le niveau et le pourcentage du coût, sans montant');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Overview projet : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
