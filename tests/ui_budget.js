/**
 * Essai de la page Budget : bilan par CPN, commandes d'achat, parts d'équipe et forfaits, exercice budgétaire (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_budget.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', NOBODY = 'personne@entreprise.com', ADMIN = 'admin@entreprise.com';
w.team = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'FR' } });   // l'équipe des parts de budget ; plus aucun taux journalier (0.17.1)
w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2026, annual_cost: 130000 } });
w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nacelle moteur' });
w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-200', cpn_label: 'Essais en vol' } });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.b.id, team_id: w.team.id, planned_amount: 5200 } });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 8000 } });
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => String(s).replace(/\s/g, ' ');

function openPage(user, startTab) {
  const html = src('Budget.html').replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: startTab || '', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'budget', home: 'gantt', isAdmin: false, canBudget: true }))
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
  const change = (n) => n.dispatchEvent(new win.Event('change', { bubbles: true }));
  const text = (id) => flat(($(id) || { textContent: '' }).textContent);
  // plus d'onglets : les zones auxquelles on a droit sont affichées ensemble
  const zones = () => ['bilan', 'po', 'enveloppe', 'budget'].filter((z) => { const n = doc.getElementById('zone-' + z); return n && !n.hidden && !doc.getElementById('panel-' + z).hidden; });
  const submitGf = () => $('gf-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const submitPo = () => $('po-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const set = (id, v) => { $(id).value = v; };
  const row = (table, key, attr) => doc.querySelector('#' + table + ' tr[' + attr + '="' + key + '"]');
  return { win, doc, until, $, click, change, text, zones, submitGf, submitPo, set, row };
}

(async () => {
  console.log('\nPage Budget (jsdom)');

  // ---------------------------------------------------------------- bilan par CPN
  let p = openPage(CP);
  await p.until(() => p.$('bal-table'));
  check(p.text('title') === 'P1 Projet 1' && p.text('cpn-chip') === 'CPN-100 — Nacelle moteur', 'titre et CPN du projet : ' + p.text('cpn-chip'));
  check(JSON.stringify(p.zones()) === JSON.stringify(['bilan', 'po', 'enveloppe', 'budget']), 'le chef de projet voit les quatre zones d’un coup, sans onglet : bilan, achats, enveloppe par workpackage, budget');
  await p.until(() => p.$('po-add') && p.$('lines-table'));
  check(!!p.$('bal-table') && !!p.$('po-table') === false && !!p.$('line-add'), 'bilan, achats et lignes de budget sont chargés ensemble sur la page');
  const bal = [...p.doc.querySelectorAll('#bal-table tbody tr[data-cpn]')].map((r) => r.getAttribute('data-cpn'));
  check(JSON.stringify(bal) === JSON.stringify(['CPN-100', 'CPN-200']), 'une ligne par CPN : ' + bal.join(', '));
  check(/8 000 €/.test(p.text('bal-table')) && /5 200 €/.test(p.text('bal-table')), 'budget externe (8 000 €) et interne (5 200 €) par CPN');
  check(!p.$('cpn-edit').hidden && p.text('cpn-edit') === 'Modifier le CPN', 'bouton du CPN pour le pilotage');

  // ---------------------------------------------------------------- achats (PO)
  await p.until(() => p.$('po-add'));
  check(/Aucune PO pour ce projet/.test(p.text('panel-po')), 'aucune PO au départ');
  p.click(p.$('po-add'));
  await p.until(() => p.$('po-dialog').open);
  check(p.$('po-cpn').value === 'CPN-100' && p.$('po-status').value === 'À faire' && /Aucun livrable lié/.test(p.text('po-sum')), 'formulaire : CPN du projet proposé, statut « À faire »');
  p.set('po-number', 'CB-1001'); p.set('po-cpn', 'cpn-200'); p.set('po-resource', w.xavier.id); p.set('po-amount', '5000'); p.set('po-status', 'Lancée'); p.set('po-due', '2026-11-20');
  p.click(p.$('po-link-add'));
  p.doc.querySelector('.pl-deliv').value = w.cc.id;
  p.doc.querySelector('.pl-amount').value = '3000'; p.doc.querySelector('.pl-amount').dispatchEvent(new p.win.Event('input'));
  check(/Réparti : 3 000,00 € sur 5 000,00 € — reste 2 000,00 €/.test(p.text('po-sum')), 'somme en direct : ' + p.text('po-sum'));
  p.submitPo();
  await p.until(() => !p.$('po-error').hidden);
  check(/doit égaler le montant de la PO/.test(p.text('po-error')) && p.$('po-dialog').open, 'répartition incomplète refusée, boîte ouverte : ' + p.text('po-error'));
  p.click(p.$('po-split'));
  check(p.doc.querySelector('.pl-amount').value === '5000' && /complet/.test(p.text('po-sum')), '« Répartir à parts égales » complète le montant');
  p.submitPo();
  await p.until(() => c.repoList('PurchaseOrder').some((o) => o.po_number === 'CB-1001'));
  const o1 = c.repoList('PurchaseOrder').find((o) => o.po_number === 'CB-1001');
  check(o1.cpn === 'CPN-200' && o1.status === 'Lancée' && o1.launched_on === '2026-10-14' && o1.gr_due_date === '2026-11-20' && o1.owner_resource_id === w.carla.id, 'PO enregistrée : CPN normalisé, engagée à la date du jour, responsable de la GR = moi');
  await p.until(() => p.row('po-table', 'CB-1001', 'data-po'));
  check(/PO CB-1001 enregistrée sur le projet P1/.test(p.text('toast')) && p.row('po-table', 'CB-1001', 'data-po').querySelector('.po-status').value === 'Lancée', 'ligne affichée avec son statut');
  check(/Essais \(5 000 €\)/.test(flat(p.row('po-table', 'CB-1001', 'data-po').textContent)) && /engagée le 14\/10\/2026/.test(flat(p.row('po-table', 'CB-1001', 'data-po').textContent)), 'livrable lié et date d’engagement');
  const dl = p.row('deliv-table', w.cc.id, 'data-deliv');
  check(dl && /8 000 €/.test(flat(dl.textContent)) && /5 000 €/.test(flat(dl.textContent)) && /3 000 €/.test(flat(dl.textContent)), 'consommation du livrable : budget 8 000, engagé 5 000, reste 3 000');
  // erreur : numéro déjà pris
  p.click(p.$('po-add'));
  await p.until(() => p.$('po-dialog').open);
  p.set('po-number', ' cb-1001 '); p.set('po-resource', w.xavier.id); p.set('po-amount', '100'); p.set('po-due', '2026-12-01');
  p.submitPo();
  await p.until(() => !p.$('po-error').hidden);
  check(/existe déjà/.test(p.text('po-error')), 'numéro de PO déjà utilisé refusé : ' + p.text('po-error'));
  p.set('po-resource', ''); p.submitPo();
  await p.until(() => /Ressource externe introuvable|existe déjà/.test(p.text('po-error')));
  p.click(p.$('po-cancel'));
  // GR en retard
  w.call(CP, 'po.save', { values: { po_number: 'CB-LATE', cpn: 'CPN-100', resource_id: w.xavier.id, amount: 900, status: 'Lancée', gr_due_date: '2026-10-10' } });
  await p.win.__ppm.reload();
  await p.until(() => p.row('po-table', 'CB-LATE', 'data-po'));
  check(/GR en retard/.test(flat(p.row('po-table', 'CB-LATE', 'data-po').textContent)) && /1 GR en retard/.test(p.text('panel-po')), 'GR en retard signalée sur la ligne et dans l’en-tête');
  // changement de statut en un geste
  const sel = p.row('po-table', 'CB-1001', 'data-po').querySelector('.po-status');
  sel.value = 'GR'; p.change(sel);
  await p.until(() => c.repoGet('PurchaseOrder', o1.id).status === 'GR');
  check(c.repoGet('PurchaseOrder', o1.id).gr_on === '2026-10-14', 'statut « GR » : date de réception enregistrée');
  // bilan mis à jour
  await p.until(() => p.doc.querySelector('#bal-table tr[data-cpn="CPN-200"]'));
  const g200 = flat(p.doc.querySelector('#bal-table tr[data-cpn="CPN-200"]').textContent);
  check(/8 000 €/.test(g200) && /5 000 €/.test(g200) && /3 000 €/.test(g200), 'bilan du CPN-200 : engagé et réceptionné 5 000 €, reste 3 000 € : ' + g200);
  // suppression
  await p.until(() => p.row('po-table', 'CB-LATE', 'data-po'));
  p.click(p.row('po-table', 'CB-LATE', 'data-po').querySelector('.po-del'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('PurchaseOrder').every((o) => o.po_number !== 'CB-LATE'));
  await p.until(() => !p.row('po-table', 'CB-LATE', 'data-po'));
  check(true, 'PO supprimée de la liste');

  // ---------------------------------------------------------------- lignes de budget
  await p.until(() => p.$('lines-table'));
  check(p.doc.querySelectorAll('#lines-table tbody tr').length === 2 && /Part d’équipe/.test(p.text('lines-table')) && /T1A/.test(p.text('lines-table')) && /Forfait \(externe\)/.test(p.text('lines-table')) && !/Taux|TJM/.test(p.text('lines-table')), 'lignes existantes : une part d’équipe et un forfait, plus de taux');
  check(/ j$/.test(flat(p.row('lines-table', c.repoList('BudgetLine').find((l) => l.deliverable_id === w.b.id).id, 'data-line').cells[5].textContent).trim()), 'la part dit son équivalent en jours (coût d’un ETP paramétré) : ' + flat(p.row('lines-table', c.repoList('BudgetLine').find((l) => l.deliverable_id === w.b.id).id, 'data-line').cells[5].textContent));
  check(/Livrables sans budget/.test(p.text('panel-budget')), 'livrables sans budget signalés');
  p.click(p.$('line-add'));
  await p.until(() => p.$('genform').open);
  p.set('gf-deliverable_id', w.a.id);
  check(!p.$('gf-team_id').parentNode.hidden && p.$('gf-resource_id').parentNode.hidden, 'part d’équipe par défaut : l’équipe et le montant');
  p.set('gf-kind', 'forfait'); p.change(p.$('gf-kind'));
  check(p.$('gf-team_id').parentNode.hidden && !p.$('gf-resource_id').parentNode.hidden, 'forfait : une ressource externe');
  const exts = [...p.$('gf-resource_id').options].map((o) => o.textContent);
  check(exts.some((n) => /Xavier/.test(n)) && !exts.some((n) => /Mia|Rémi|Carla/.test(n)), 'seules les ressources externes sont proposées pour un forfait : ' + exts.join(' | '));
  p.set('gf-kind', 'team'); p.change(p.$('gf-kind')); p.set('gf-amount', '2080'); p.submitGf();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Choisissez une équipe/.test(p.text('gf-error')), 'sans équipe : message explicite : ' + p.text('gf-error'));
  const teamOpts = [...p.$('gf-team_id').options].map((o) => o.textContent);
  check(teamOpts.some((n) => /T1A — 3 caractères · FR/.test(n)), 'les équipes disent leur niveau budgétaire et leur pays : ' + teamOpts.join(' | '));
  p.set('gf-team_id', w.team.id); p.submitGf();
  await p.until(() => c.repoList('BudgetLine').length === 3);
  const l3 = c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id);
  check(l3.cost_type === 'Équipe' && Number(l3.planned_amount) === 2080 && l3.team_id === w.team.id, 'part d’équipe : 2 080 € pour T1A');
  await p.until(() => p.row('lines-table', l3.id, 'data-line'));
  check(/2 080 €/.test(flat(p.row('lines-table', l3.id, 'data-line').textContent)), 'ligne affichée');
  p.click(p.row('lines-table', l3.id, 'data-line').querySelector('.line-phase'));
  await p.until(() => p.$('genform').open && p.$('gf-text'));
  check(/^2026-10 2080/.test(p.$('gf-text').value), 'échéancier prérempli : ' + p.$('gf-text').value);
  p.set('gf-text', '2026-10 1000'); p.submitGf();
  await p.until(() => !p.$('gf-error').hidden);
  check(/doit égaler/.test(p.text('gf-error')), 'échéancier de somme fausse refusé');
  p.set('gf-text', '2026-10 1080\n2026-11 1000'); p.submitGf();
  await p.until(() => c.repoGet('BudgetLine', l3.id).phasing_mode === 'manuel');
  await p.until(() => { const r0 = p.row('lines-table', l3.id, 'data-line'); return r0 && /à la main/.test(flat(r0.textContent)); });
  check(true, 'échéancier à la main enregistré et signalé');
  p.click(p.row('lines-table', l3.id, 'data-line').querySelector('.line-del'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('BudgetLine').length === 2);
  check(true, 'ligne supprimée');

  // ---------------------------------------------------------------- CPN du projet
  w.call(CP, 'po.save', { values: { po_number: 'CB-100', cpn: 'CPN-100', resource_id: w.xavier.id, amount: 400, status: 'À faire', gr_due_date: '2026-12-15' } });
  await p.until(() => !p.$('genform').open);
  p.click(p.$('cpn-edit'));
  await p.until(() => p.$('genform').open && p.$('gf-cpn'));
  p.set('gf-cpn', 'cpn-300'); p.submitGf();
  await p.until(() => !p.$('gf-error').hidden);
  check(/commande\(s\) d’achat portent le CPN CPN-100/.test(p.text('gf-error')), 'un CPN qui porte des PO ne se change pas : ' + p.text('gf-error'));
  p.set('gf-cpn', 'CPN-100'); p.set('gf-cpn_label', 'Nacelle moteur v2'); p.submitGf();
  await p.until(() => /Nacelle moteur v2/.test(p.text('cpn-chip')));
  check(true, 'désignation du CPN mise à jour dans l’en-tête');

  // ---------------------------------------------------------------- droits
  const m = openPage(MEMBER);
  await m.until(() => m.$('po-add'));
  check(JSON.stringify(m.zones()) === JSON.stringify(['po']) && m.$('cpn-edit').hidden, 'un membre interne : seulement la zone des achats, pas de bouton de CPN');
  check(!!m.doc.querySelector('#po-table'), 'il voit les PO du projet et peut en créer');
  const r = openPage(RWP);
  await r.until(() => r.zones().length > 0 && r.$('panel-po'));
  check(JSON.stringify(r.zones()) === JSON.stringify(['po', 'enveloppe', 'budget']), 'un Workpackage leader : achats, l’enveloppe de son workpackage et son budget : ' + r.zones().join(','));
  await r.until(() => r.$('lines-table') || r.$('line-add'));
  check(/Budget de votre périmètre/.test(r.text('panel-budget')), 'budget limité à son périmètre (un Workpackage leader ne voit que celui de son workpackage)');
  const n = openPage(NOBODY);
  await n.until(() => /Accès réservé/.test(n.text('panel-bilan')));
  check(n.zones().length === 0, 'sans nomination dans l’équipe : rien d’accessible');


  const norm = (t) => String(t).replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  const programOptions = (x) => [...x.$('picker').options].filter((o) => /^program:/.test(o.value));
  const chooseProgram = (x) => { x.$('picker').value = 'program:' + w.prog.id; x.$('picker').dispatchEvent(new x.win.Event('change')); };
  // ---------------------------------------------------------------- 0.14.1 : vue programme (Program Leader et Domain Program Leader)
  const cpPage = openPage(CP);
  await cpPage.until(() => cpPage.$('picker').options.length >= 2);
  check(programOptions(cpPage).length === 0, 'un chef de projet n’a pas la vue programme dans la liste');
  const dp = openPage('dora@entreprise.com');
  await dp.until(() => programOptions(dp).length === 1);
  check(programOptions(dp)[0].textContent === 'Programme PG — tous les projets' || /Programme .* — tous les projets/.test(programOptions(dp)[0].textContent), 'le DPL a « Programme … — tous les projets » dans la liste : ' + programOptions(dp)[0].textContent);
  await dp.until(() => !dp.$('panel-bilan').hidden);
  chooseProgram(dp);
  await dp.until(() => dp.doc.querySelector('#panel-program table.consol'));
  const rowsB = [...dp.doc.querySelectorAll('#panel-program tbody tr')];
  check(rowsB.length === 2 && /P1 Projet 1/.test(rowsB[0].textContent) && /P2 Projet vide/.test(rowsB[1].textContent) && /^Total/.test(norm(dp.doc.querySelector('#panel-program tfoot').textContent)), 'budget du programme : une ligne par projet et un total : ' + rowsB.length);
  check(dp.doc.body.classList.contains('in-program') && ['cell-bilan', 'cell-po', 'cell-budget'].every((id) => [...dp.doc.querySelectorAll('style')].some((s) => s.textContent.includes('body.in-program #' + id))) && !dp.$('panel-program').hidden && /Budget — Programme/.test(dp.text('title')) && dp.$('cpn-edit').hidden, 'en vue programme, les cartes du projet sont masquées par une règle de la page (sans toucher à leur attribut) et le titre dit « Programme »');
  const balance = c.handleRequest({ action: 'budget.balance', params: { projectId: w.p1.id }, apiVersion: '1.0' }, 'admin@entreprise.com').data.totals;
  check(norm(rowsB[0].textContent).includes(norm(Math.round(balance.budget.total).toLocaleString('fr-FR') + ' €')), 'le montant d’un projet est celui de son bilan : ' + norm(rowsB[0].textContent).slice(0, 120));
  dp.click(dp.doc.querySelector('#panel-program tbody tr button.proj-open'));
  await dp.until(() => dp.$('panel-program').hidden && /^P1 /.test(dp.text('title')));
  check(dp.$('picker').value === w.p1.id && /^P1 /.test(dp.text('title')) && !dp.doc.body.classList.contains('in-program') && !dp.$('panel-bilan').hidden, 'un clic sur un projet ouvre son budget et revient aux zones du projet');
  chooseProgram(dp);
  await dp.until(() => !dp.$('panel-program').hidden && dp.doc.querySelector('#panel-program table.consol'));
  dp.$('picker').value = w.p2.id; dp.$('picker').dispatchEvent(new dp.win.Event('change'));
  await dp.until(() => dp.$('panel-program').hidden);
  check(dp.$('panel-program').hidden && dp.$('zone-program').hidden, 'revenir à un projet par la liste referme la vue programme');

  // ---------------------------------------------------------------- enveloppe par workpackage (0.15.3)
  await p.until(() => p.$('env-table'));
  const envRows = () => [...p.doc.querySelectorAll('#env-table tbody tr')];
  check(envRows().length === 3 && envRows().map((r) => r.cells[0].textContent.trim()).join('|') === '1 Conception|1.1 Calcul|2 Essais', 'un tableau en arbre : WP 1, son sous-workpackage 1.1, WP 2');
  check(/Budget autorisé\s*Non fixé/.test(p.text('panel-enveloppe')) && !!p.$('env-authorized'), 'rien n’est fixé : « pas de plafond », et le chef de projet a le champ du budget autorisé');
  p.set('env-authorized', '20000'); p.change(p.$('env-authorized'));
  await p.until(() => Number(c.repoGet('Project', w.p1.id).budget_authorized) === 20000);
  await p.until(() => /Enveloppe enregistrée/.test(p.text('toast')));
  check(Number(c.repoGet('Project', w.p1.id).budget_authorized) === 20000 && /Enveloppe enregistrée/.test(p.text('toast')), 'le budget autorisé s’enregistre en quittant le champ');
  await p.until(() => /Budget autorisé\s*20\s?000/.test(p.text('panel-enveloppe')));
  p.set('env-' + w.w1.id, '3000'); p.change(p.$('env-' + w.w1.id));
  await p.until(() => Number(c.repoGet('WorkPackage', w.w1.id).budget_allocated) === 3000);
  p.set('env-' + w.w2.id, '500'); p.change(p.$('env-' + w.w2.id));
  await p.until(() => Number(c.repoGet('WorkPackage', w.w2.id).budget_allocated) === 500);
  await p.until(() => /Dépassée de/.test(p.text('panel-enveloppe')));
  const wp2 = () => p.doc.querySelector('#env-table tr[data-wp="' + w.w2.id + '"]');
  check(/Dépassée de/.test(wp2().textContent) && /Réparti entre les workpackages\s*3\s?500/.test(p.text('panel-enveloppe')), 'WP 2 : 8 000 € de coût pour 500 € d’enveloppe, signalé « dépassée » sans rien bloquer ; réparti : 3 500 €');
  const before = p.$('env-' + w.w1.id).value;
  p.set('env-' + w.w1.id, '30000'); p.change(p.$('env-' + w.w1.id));
  await p.until(() => p.$('toast').classList.contains('error'));
  check(/dépassent le budget autorisé/.test(p.text('toast')) && p.$('env-' + w.w1.id).value === before && Number(c.repoGet('WorkPackage', w.w1.id).budget_allocated) === 3000, 'au-delà du budget autorisé : refusé, message clair, le champ revient à sa valeur : ' + p.text('toast'));
  const wl = openPage(RWP);
  await wl.until(() => wl.$('env-table'));
  check(!wl.$('env-authorized') && !wl.$('env-' + w.w1.id) && !!wl.$('env-' + w.w11.id) && [...wl.doc.querySelectorAll('#env-table tbody tr')].length === 2 && /budget de votre workpackage/.test(wl.text('panel-enveloppe')), 'un Workpackage leader : pas le budget du projet, pas l’enveloppe de son propre WP, seulement la répartition de ses sous-workpackages ; il ne voit que son workpackage');
  wl.set('env-' + w.w11.id, '1200'); wl.change(wl.$('env-' + w.w11.id));
  await wl.until(() => Number(c.repoGet('WorkPackage', w.w11.id).budget_allocated) === 1200);
  check(Number(c.repoGet('WorkPackage', w.w11.id).budget_allocated) === 1200, 'il répartit la sienne');
  const mm = openPage(MEMBER);
  await wait(250);
  check(mm.$('zone-enveloppe').hidden && mm.$('panel-enveloppe').hidden, 'un Contributor ne voit pas la zone');

  // ---------------------------------------------------------------- 0.17.1 : l'exercice budgétaire (année en préparation et année en exécution)
  const noEx = openPage(CP);
  await noEx.until(() => noEx.$('exercise-empty'));
  check(!noEx.$('zone-exercice').hidden && /Aucun exercice/.test(noEx.text('exercise-empty')) && noEx.$('exercise-picker').hidden, 'sans exercice : la zone le dit et renvoie vers l’administrateur ; pas de liste d’exercices');
  // l'administrateur crée l'exercice en exécution (2026) et celui en préparation (2027) ; des équipes à 3 et 4 caractères
  const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
  const exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });
  const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
  w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2027, annual_cost: 130000 } });
  const vm = w.call(CP, 'teams.create', { values: { name: '1vm', country: 'FR' } }), vmd = w.call(CP, 'teams.create', { values: { name: '1vmd', parent_team_id: vm.id, country: 'FR' } }), ae = w.call(CP, 'teams.create', { values: { name: '2ae', country: 'DE' } }), spare = w.call(CP, 'teams.create', { values: { name: '3xx', country: 'FR' } });
  const setTb = (team, f, v, ex) => w.call(CP, 'exercise.set', Object.assign({ projectId: w.p1.id, exerciseId: (ex || prep).id, teamId: team.id }, { [f]: v }));
  setTb(vm, 'expected', 100000); setTb(vmd, 'expected', 30000); setTb(ae, 'expected', 50000); setTb(vm, 'granted', 80000);
  const part = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: prep.id });
  const mk = (name) => { w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w1.id, values: { name, planned_start: '2026-11-02', planned_finish: '2026-11-13', owner_resource_id: w.mia.id } }); return c.repoList('PlanItem').find((i) => i.name === name); };
  const d1 = mk('Livrable 2027 A'), d2 = mk('Livrable 2027 B');
  part(d1, vm, 40000); part(d1, vmd, 20000); part(d2, vm, 30000); part(d2, ae, 60000);
  const ex = openPage(CP);
  await ex.until(() => ex.$('exercise-table'));
  const picks = [...ex.$('exercise-picker').options].map((o) => o.textContent);
  check(!ex.$('exercise-picker').hidden && picks.join('|') === 'Exercice Préparation 2027|Exercice Exécution 2026|Livrables sans exercice' && ex.$('exercise-picker').value === prep.id, 'la liste des exercices : l’année en préparation d’abord, puis celle en exécution ; la préparation est affichée au départ : ' + picks.join(' | '));
  const tr = (team) => ex.doc.querySelector('#exercise-table tr[data-team="' + team + '"]');
  const cells = (team) => [...tr(team).cells].map((x) => flat(x.textContent).trim());
  check(!!tr(vm.id + '-total') && /1vm \(total avec le détail\)/.test(cells(vm.id + '-total')[0]) && /130\s?000/.test(cells(vm.id + '-total')[1]) && /90\s?000/.test(cells(vm.id + '-total')[3]) && /\+40\s?000/.test(cells(vm.id + '-total')[4]), '1vm : total avec le détail de 1vmd — attendu 130 000 €, parts 90 000 €, reste à répartir +40 000 € : ' + cells(vm.id + '-total').join(' | '));
  check(!!tr(vm.id) && !!tr(vmd.id) && /1vmd/.test(cells(vmd.id)[0]) && /30\s?000/.test(ex.$('exp-' + vmd.id).value + '30000'), 'l’équipe seule et son détail à 4 caractères ont chacune leur ligne, modifiable');
  check(/−10\s?000/.test(cells(ae.id)[4]) && tr(ae.id).cells[4].classList.contains('late'), '2ae : les parts (60 000 €) dépassent l’attendu (50 000 €) : écart négatif, en rouge, rien n’est bloqué : ' + cells(ae.id)[4]);
  check(/clash/.test(cells(vm.id + '-total')[5]) || /clash/.test(cells(vm.id)[5]), 'un accordé (80 000 €) inférieur aux parts : « clash » affiché');
  check(/180\s?000/.test(ex.text('panel-exercice')) && /Écart avec l’accordé/.test(ex.text('panel-exercice')), 'cartes : attendu total et écart avec l’accordé');
  check(/Coût d’un ETP non paramétré pour DE en 2027/.test(ex.text('etp-missing')), 'l’Allemagne n’a pas de coût d’ETP en 2027 : la page le dit, sans inventer de jours : ' + ex.text('etp-missing').slice(0, 90));
  check(/ j/.test(cells(vm.id + '-total')[3]), 'équivalent en jours des parts de 1vm (coût de l’ETP de la France) : ' + cells(vm.id + '-total')[3]);
  // saisie directe de l'attendu
  ex.set('exp-' + ae.id, '65000'); ex.change(ex.$('exp-' + ae.id));
  await ex.until(() => w.c.repoList('TeamBudget').some((b) => b.team_id === ae.id && Number(b.expected) === 65000));
  await ex.until(() => /Budget enregistré/.test(ex.text('toast')));
  await ex.until(() => { const r = ex.doc.querySelector('#exercise-table tr[data-team="' + ae.id + '"]'); return !!r && /\+5\s?000/.test(flat(r.cells[4].textContent)); });
  check(/\+5\s?000/.test(cells(ae.id)[4]) && !tr(ae.id).cells[4].classList.contains('late'), 'l’attendu se saisit dans le tableau : l’écart de 2ae passe à +5 000 €, plus de rouge');
  ex.set('exp-' + ae.id, '-3'); ex.change(ex.$('exp-' + ae.id));
  await ex.until(() => ex.$('toast').classList.contains('error'));
  check(/positif/.test(ex.text('toast')) && ex.$('exp-' + ae.id).value === '65000', 'valeur négative refusée, valeur précédente rétablie : ' + ex.text('toast'));
  // ajouter une équipe au tableau
  check(![...ex.$('exercise-team-pick').options].some((o) => /Direction/.test(o.textContent)) && [...ex.$('exercise-team-pick').options].some((o) => /3xx/.test(o.textContent)) && ![...ex.$('exercise-team-pick').options].some((o) => /^2ae/.test(o.textContent)), 'les équipes proposées : 3 et 4 caractères, pas celles déjà au tableau');
  ex.set('exercise-team-pick', spare.id); ex.click(ex.$('exercise-team-add'));
  await ex.until(() => w.c.repoList('TeamBudget').some((b) => b.team_id === spare.id));
  await ex.until(() => ex.doc.querySelector('#exercise-table tr[data-team="' + spare.id + '"]'));
  check(!!ex.doc.querySelector('#exercise-table tr[data-team="' + spare.id + '"]'), 'une équipe ajoutée au tableau (attendu 0 €, à renseigner)');
  // le budget par livrable suit l'exercice choisi
  await ex.until(() => ex.$('lines-table'));
  check(ex.doc.querySelectorAll('#lines-table tbody tr').length === 4 && /2027/.test(ex.text('lines-table')) && /Livrables sans exercice/.test(ex.text('panel-budget')) && !!ex.$('assign-open'), 'le budget par livrable ne montre que les lignes de l’exercice 2027 (4 parts) et propose de rattacher les livrables sans exercice');
  // rattacher les livrables sans exercice
  ex.click(ex.$('assign-open'));
  await ex.until(() => ex.$('genform').open && ex.$('gf-deliverable_id'));
  check(/Tous les livrables sans exercice/.test([...ex.$('gf-deliverable_id').options][0].textContent), 'rattacher : « tous les livrables sans exercice » par défaut');
  ex.submitGf();
  await ex.until(() => c.repoList('PlanItem').filter((i) => i.item_type === 'Livrable' && i.project_id === w.p1.id).every((i) => i.exercise_id));
  check(c.repoList('PlanItem').filter((i) => i.item_type === 'Livrable' && i.project_id === w.p1.id).every((i) => i.exercise_id === prep.id), 'tous les livrables sans exercice sont rattachés à l’exercice 2027');
  // l'exercice en exécution : l'attendu est figé, l'accordé se révise
  ex.set('exercise-picker', exec.id); ex.change(ex.$('exercise-picker'));
  await ex.until(() => /Exercice 2026 \(exécution\)/.test(ex.text('exercise-note')));
  check(/Le budget attendu est figé/.test(ex.text('exercise-note')) && !ex.doc.querySelector('[id^="exp-"]'), 'exécution : le budget attendu est figé (aucun champ), on l’indique');
  setTb(vm, 'granted', 90000, exec);
  ex.set('exercise-picker', prep.id); ex.change(ex.$('exercise-picker'));
  await ex.until(() => ex.$('exercise-table'));
  // lecture seule pour un Workpackage leader
  const wl2 = openPage(RWP);
  await wl2.until(() => wl2.$('exercise-table'));
  check(!wl2.doc.querySelector('[id^="exp-"]') && /Lecture seule/.test(wl2.text('exercise-note')) && !wl2.$('exercise-team-add'), 'un Workpackage leader voit l’exercice du projet en lecture seule : ni champs, ni ajout');
  const mm2 = openPage(MEMBER);
  await wait(250);
  check(mm2.$('zone-exercice').hidden && mm2.$('panel-exercice').hidden, 'un Contributor ne voit pas la zone de l’exercice');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Budget : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
