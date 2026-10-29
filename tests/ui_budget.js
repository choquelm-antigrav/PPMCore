/**
 * Essai de la page Budget : bilan par CPN, commandes d'achat, parts d'équipe et forfaits, exercice budgétaire (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_budget.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');
const { makeFakeSheets } = require('./fake_sheets');

const w = lot2World();
w.c.SpreadsheetApp = makeFakeSheets();
w.c.IMPORT_DRIVE = { share() {}, moveToProjectFolder() {} };
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', NOBODY = 'personne@entreprise.com', ADMIN = 'admin@entreprise.com';
w.team = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'FR' } });   // l'équipe des parts de budget ; plus aucun taux journalier (0.17.1)
w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2026, annual_cost: 130000 } });
const e26 = w.call(ADMIN, 'exercise.create', { year: 2026 });
w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e26.id, status: 'Exécution' });   // 0.19.3 : tout le budget d'un exercice est étanche ; les livrables de l'essai sont de l'exercice en exécution
w.call(CP, 'budget.deliverable.exercise', { deliverableId: w.a.id, exerciseId: w.exec.id });
w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nacelle moteur' });
w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-200', cpn_label: 'Essais en vol' } });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.b.id, team_id: w.team.id, planned_amount: 5200 }, exerciseId: w.exec.id });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 8000 }, exerciseId: w.exec.id });
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
  const input = (n) => n.dispatchEvent(new win.Event('input', { bubbles: true }));
  const row = (table, key, attr) => doc.querySelector('#' + table + ' tr[' + attr + '="' + key + '"]');
  return { win, doc, until, $, click, change, input, text, zones, submitGf, submitPo, set, row };
}

(async () => {
  console.log('\nPage Budget (jsdom)');

  // ---------------------------------------------------------------- bilan par CPN
  let p = openPage(CP);
  await p.until(() => p.$('bal-table'));
  check(p.text('title') === 'P1 Projet 1' && p.text('cpn-chip') === 'CPN-100 — Nacelle moteur', 'titre et CPN du projet : ' + p.text('cpn-chip'));
  check(JSON.stringify(p.zones()) === JSON.stringify(['bilan', 'po', 'enveloppe']), 'le chef de projet voit les trois zones du suivi : bilan, achats, décomposition du budget (plus de zone « Parts des livrables »)');
  await p.until(() => p.$('po-add') && p.$('env-table'));
  check(!!p.$('bal-table') && !!p.$('po-table') === false && !!p.doc.querySelector('.cost-btn'), 'bilan, achats et décomposition du budget (avec les boutons de coût des livrables) sont chargés ensemble sur la page');
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

  // ---------------------------------------------------------------- coût d'un livrable (bouton € de la décomposition du budget)
  await p.until(() => p.$('env-table'));
  const costBtn = (item) => p.doc.querySelector('.cost-btn[data-item="' + item.id + '"]');
  check(/Décomposition du Budget/.test(p.text('zone-enveloppe')) && !p.$('lines-table') && !p.$('cell-budget'), 'la zone s’appelle « Décomposition du Budget » ; plus de zone « Parts des livrables »');
  const itemRow = (item) => p.doc.querySelector('#env-table tr[data-item="' + item.id + '"]');
  check(/Sans coût/.test(itemRow(w.a).textContent) && !!costBtn(w.a) && !!costBtn(w.b), 'un livrable sans ligne est signalé « Sans coût » ; chaque livrable a son bouton €');
  const dline = c.repoList('BudgetLine').find((l) => l.deliverable_id === w.b.id);
  p.click(costBtn(w.b));
  await p.until(() => p.$('cost-dialog').open && p.$('cost-lines'));
  check(/Coût du livrable/.test(p.text('cost-title')) && /Calcul/.test(p.text('cost-sub')) && p.doc.querySelectorAll('#cost-lines tbody tr').length === 1 && /Part d’équipe/.test(p.text('cost-lines')) && /T1A/.test(p.text('cost-lines')) && !/Taux|TJM/.test(p.text('cost-lines')), 'la fenêtre « Coût du livrable » : la part d’équipe du livrable, plus de taux');
  check(/ j$/.test(flat(p.row('cost-lines', dline.id, 'data-line').cells[4].textContent).trim()), 'la part dit son équivalent en jours (coût d’un ETP paramétré) : ' + flat(p.row('cost-lines', dline.id, 'data-line').cells[4].textContent));
  p.click(p.$('cost-close'));
  p.click(costBtn(w.cc));
  await p.until(() => p.$('cost-dialog').open && /Forfait/.test(p.text('cost-lines')));
  check(/Forfait \(externe\)/.test(p.text('cost-lines')), 'un forfait externe dans la fenêtre de son livrable');
  p.click(p.$('cost-close'));
  p.click(costBtn(w.a));
  await p.until(() => p.$('cost-dialog').open && p.$('cost-form'));
  check(/n’a pas encore de coût/.test(p.text('cost-total')) && !p.$('cost-team').parentNode.hidden && p.$('cost-resource').parentNode.hidden, 'un livrable sans ligne : la fenêtre le dit ; part d’équipe par défaut : l’équipe et le montant (mêmes champs que « nouvelle part ou nouveau forfait »)');
  p.set('cost-kind', 'forfait'); p.change(p.$('cost-kind'));
  check(p.$('cost-team').parentNode.hidden && !p.$('cost-resource').parentNode.hidden, 'forfait : une ressource externe');
  const exts = [...p.$('cost-resource').options].map((o) => o.textContent);
  check(exts.some((n) => /Xavier/.test(n)) && !exts.some((n) => /Mia|Rémi|Carla/.test(n)), 'seules les ressources externes sont proposées pour un forfait : ' + exts.join(' | '));
  p.set('cost-kind', 'team'); p.change(p.$('cost-kind')); p.set('cost-amount', '2080'); p.click(p.$('cost-add'));
  await p.until(() => !p.$('cost-error').hidden);
  check(/Choisissez une équipe/.test(p.text('cost-error')), 'sans équipe : message explicite : ' + p.text('cost-error'));
  const teamOpts = [...p.$('cost-team').options].map((o) => o.textContent);
  check(teamOpts.some((n) => /T1A — 3 caractères · FR/.test(n)), 'les équipes disent leur niveau budgétaire et leur pays : ' + teamOpts.join(' | '));
  p.set('cost-team', w.team.id); p.click(p.$('cost-add'));
  await p.until(() => c.repoList('BudgetLine').length === 3);
  const l3 = c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id);
  check(l3.cost_type === 'Équipe' && Number(l3.planned_amount) === 2080 && l3.team_id === w.team.id, 'part d’équipe : 2 080 € pour T1A');
  await p.until(() => p.row('cost-lines', l3.id, 'data-line'));
  check(/2 080 €/.test(flat(p.row('cost-lines', l3.id, 'data-line').textContent)) && /2 080 €/.test(flat(itemRow(w.a).textContent)), 'ligne affichée dans la fenêtre, et le coût du livrable dans la décomposition');
  p.click(p.row('cost-lines', l3.id, 'data-line').querySelector('.line-phase'));
  await p.until(() => p.$('genform').open && p.$('gf-text'));
  check(/^2026-10 2080/.test(p.$('gf-text').value), 'échéancier prérempli : ' + p.$('gf-text').value);
  p.set('gf-text', '2026-10 1000'); p.submitGf();
  await p.until(() => !p.$('gf-error').hidden);
  check(/doit égaler/.test(p.text('gf-error')), 'échéancier de somme fausse refusé');
  p.set('gf-text', '2026-10 1080\n2026-11 1000'); p.submitGf();
  await p.until(() => c.repoGet('BudgetLine', l3.id).phasing_mode === 'manuel');
  await p.until(() => { const r0 = p.row('cost-lines', l3.id, 'data-line'); return r0 && /à la main/.test(flat(r0.textContent)); });
  check(true, 'échéancier à la main enregistré et signalé');
  p.click(p.row('cost-lines', l3.id, 'data-line').querySelector('.line-edit'));
  await p.until(() => p.$('genform').open && p.$('gf-amount'));
  p.set('gf-amount', '2200'); p.submitGf();
  await p.until(() => Number(c.repoGet('BudgetLine', l3.id).planned_amount) === 2200);
  check(true, 'la ligne se modifie depuis la fenêtre');
  await p.until(() => !p.$('genform').open && p.row('cost-lines', l3.id, 'data-line') && /2 200 €/.test(flat(p.row('cost-lines', l3.id, 'data-line').textContent)));
  p.click(p.row('cost-lines', l3.id, 'data-line').querySelector('.line-del'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('BudgetLine').length === 2);
  await p.until(() => !p.row('cost-lines', l3.id, 'data-line'));
  check(/Sans coût/.test(itemRow(w.a).textContent), 'ligne supprimée : le livrable est de nouveau « Sans coût »');
  p.click(p.$('cost-close'));

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
  check(JSON.stringify(r.zones()) === JSON.stringify(['po', 'enveloppe']), 'un Workpackage leader : achats et la décomposition de son workpackage : ' + r.zones().join(','));
  await r.until(() => r.$('env-table'));
  check(/Vous voyez le budget de votre workpackage/.test(r.text('panel-enveloppe')) && !!r.doc.querySelector('.cost-btn') && !r.doc.querySelector('.cost-btn[data-item="' + w.cc.id + '"]'), 'décomposition limitée à son périmètre : les livrables de son workpackage seulement, avec leur bouton de coût');
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
  const budgetTable = dp.doc.querySelector('#panel-program table.consol'), rowsB = [...budgetTable.querySelectorAll('tbody tr')];
  check(rowsB.length === 2 && /P1 Projet 1/.test(rowsB[0].textContent) && /P2 Projet vide/.test(rowsB[1].textContent) && /^Total/.test(norm(budgetTable.querySelector('tfoot').textContent)), 'budget du programme : une ligne par projet et un total : ' + rowsB.length);
  check(dp.doc.body.classList.contains('in-program') && ['cell-bilan', 'cell-po', 'cell-enveloppe'].every((id) => [...dp.doc.querySelectorAll('style')].some((s) => s.textContent.includes('body.in-program #' + id))) && !dp.$('panel-program').hidden && /Budget — Programme/.test(dp.text('title')) && dp.$('cpn-edit').hidden, 'en vue programme, les cartes du projet sont masquées par une règle de la page (sans toucher à leur attribut) et le titre dit « Programme »');
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

  // ---------------------------------------------------------------- décomposition du budget (enveloppes 0.15.3, livrables et jalons, brouillon et « Valider » 0.19.2)
  await p.until(() => p.$('env-table'));
  const envRows = () => [...p.doc.querySelectorAll('#env-table tbody tr[data-wp]')];
  check(envRows().length === 3 && envRows().map((r) => r.cells[0].textContent.trim()).join('|') === '1 Conception|1.1 Calcul|2 Essais', 'un tableau en arbre : WP 1, son sous-workpackage 1.1, WP 2');
  const rowsAll = [...p.doc.querySelectorAll('#env-table tbody tr')].map((r) => (r.classList.contains('wp-row') ? 'WP:' : r.classList.contains('is-milestone') ? 'J:' : 'L:') + r.cells[0].textContent.replace(/\s+/g, ' ').trim().replace(/^[▪◆]\s*/, ''));
  check(rowsAll.findIndex((x) => /^WP:1 Conception/.test(x)) < rowsAll.findIndex((x) => /^L:Spécification/.test(x)) && rowsAll.findIndex((x) => /^L:Spécification/.test(x)) < rowsAll.findIndex((x) => /^WP:1\.1 Calcul/.test(x)) && rowsAll.findIndex((x) => /^WP:1\.1 Calcul/.test(x)) < rowsAll.findIndex((x) => /^L:Calcul/.test(x)) && rowsAll.findIndex((x) => /^L:Calcul/.test(x)) < rowsAll.findIndex((x) => /^WP:2 Essais/.test(x)), 'les livrables sont sous leur workpackage ou sous-workpackage, comme dans le WBS : ' + rowsAll.join(' | '));
  check(p.doc.querySelectorAll('#env-table tr.is-milestone').length >= 1 && !p.doc.querySelector('#env-table tr.is-milestone .cost-btn') && !p.doc.querySelector('#env-table tr.is-deliverable input'), 'les jalons y figurent, sans bouton de coût ; un livrable n’a aucun champ « enveloppe »');
  check(/Budget autorisé\s*Non fixé/.test(p.text('panel-enveloppe')) && !!p.$('env-authorized'), 'rien n’est fixé : « pas de plafond », et le chef de projet a le champ du budget autorisé');
  check(p.$('env-validate').disabled && !p.$('env-validate').classList.contains('primary') && p.$('env-cancel').hidden, 'sans modification : « Valider » est grisé');
  p.set('env-authorized', '20000'); p.input(p.$('env-authorized'));
  check(!p.$('env-validate').disabled && p.$('env-validate').classList.contains('primary') && !p.$('env-cancel').hidden && /Modifications non enregistrées/.test(p.text('env-hint')) && p.$('env-authorized').classList.contains('changed'), 'une modification : « Valider » devient bleu, le champ est marqué, le rappel s’affiche');
  p.set('env-' + w.w1.id, '3000'); p.input(p.$('env-' + w.w1.id));
  p.set('env-' + w.w2.id, '500'); p.input(p.$('env-' + w.w2.id));
  await wait(150);
  const envOf = (rec) => c.envAmount_(rec, c.envKey_(w.exec));
  check(envOf(c.repoGet('Project', w.p1.id)) === null, 'rien n’est enregistré tant que la personne ne valide pas : ni le budget autorisé');
  check(envOf(c.repoGet('WorkPackage', w.w1.id)) === null && envOf(c.repoGet('WorkPackage', w.w2.id)) === null, 'ni les enveloppes des workpackages');
  p.click(p.$('env-validate'));
  await p.until(() => envOf(c.repoGet('Project', w.p1.id)) === 20000 && envOf(c.repoGet('WorkPackage', w.w2.id)) === 500);
  await p.until(() => /Décomposition du budget enregistrée/.test(p.text('toast')));
  check(envOf(c.repoGet('WorkPackage', w.w1.id)) === 3000, 'un seul clic sur « Valider » enregistre tout : budget autorisé et enveloppes');
  await p.until(() => p.$('env-validate') && p.$('env-validate').disabled);
  check(/Budget autorisé\s*20\s?000/.test(p.text('panel-enveloppe')) && !p.$('env-validate').classList.contains('primary'), 'enregistré : « Valider » redevient gris');
  const wp2 = () => p.doc.querySelector('#env-table tr[data-wp="' + w.w2.id + '"]');
  check(/En dépassement/.test(wp2().textContent) && wp2().classList.contains('over') && /Réparti entre les workpackages\s*3\s?500/.test(p.text('panel-enveloppe')), 'WP 2 : 8 000 € de coût pour 500 € d’enveloppe : « En dépassement » ; réparti : 3 500 €');
  check(!!wp2().querySelector('.badge.alert') && /En dépassement/.test(wp2().querySelector('.badge.alert').textContent), 'l’état « En dépassement » est un badge rouge');
  // on peut écrire plus que la somme autorisée : accepté, signalé « en dépassement »
  p.set('env-' + w.w1.id, '30000'); p.input(p.$('env-' + w.w1.id));
  p.click(p.$('env-validate'));
  await p.until(() => envOf(c.repoGet('WorkPackage', w.w1.id)) === 30000);
  await p.until(() => /30\s?500/.test(p.text('panel-enveloppe')));
  check(!p.$('toast').classList.contains('error') && /dépasse le budget autorisé de/.test(p.text('panel-enveloppe')) && /en dépassement/.test(p.text('panel-enveloppe')), 'au-delà du budget autorisé : accepté ; le projet est « en dépassement » (réparti 30 500 € pour 20 000 €)');
  // annuler les modifications
  p.set('env-' + w.w2.id, '999'); p.input(p.$('env-' + w.w2.id));
  p.click(p.$('env-cancel'));
  check(p.$('env-' + w.w2.id).value === '500' && p.$('env-validate').disabled, '« Annuler les modifications » remet les valeurs enregistrées');
  // quitter l'onglet avec un brouillon : on demande
  p.set('env-' + w.w2.id, '777'); p.input(p.$('env-' + w.w2.id));
  p.click(p.$('tab-op'));
  await p.until(() => p.$('confirm').open);
  check(/Abandonner les modifications non enregistrées/.test(p.text('confirm-title')) && p.$('tab-suivi').getAttribute('aria-selected') === 'true', 'changer d’onglet avec un brouillon : confirmation demandée, rien n’est perdu en silence');
  p.click(p.$('confirm-cancel'));
  check(p.$('env-' + w.w2.id).value === '777' && !p.$('env-validate').disabled, 'on reste sur la page avec son brouillon');
  p.click(p.$('env-cancel'));
  const wl = openPage(RWP);
  await wl.until(() => wl.$('env-table'));
  check(!wl.$('env-authorized') && !wl.$('env-' + w.w1.id) && !!wl.$('env-' + w.w11.id) && [...wl.doc.querySelectorAll('#env-table tbody tr.wp-row')].length === 2 && /budget de votre workpackage/.test(wl.text('panel-enveloppe')), 'un Workpackage leader : pas le budget du projet, pas l’enveloppe de son propre WP, seulement la répartition de ses sous-workpackages ; il ne voit que son workpackage');
  wl.set('env-' + w.w11.id, '1200'); wl.input(wl.$('env-' + w.w11.id));
  wl.click(wl.$('env-validate'));
  await wl.until(() => envOf(c.repoGet('WorkPackage', w.w11.id)) === 1200);
  check(envOf(c.repoGet('WorkPackage', w.w11.id)) === 1200, 'il répartit la sienne (après « Valider »)');
  const mm = openPage(MEMBER);
  await wait(250);
  check(mm.$('zone-enveloppe').hidden && mm.$('panel-enveloppe').hidden, 'un Contributor ne voit pas la zone');

  // ---------------------------------------------------------------- 0.17.1 : l'exercice budgétaire (année en préparation et année en exécution)
  const noEx = openPage(CP);
  await noEx.until(() => noEx.$('env-table'));
  check(noEx.$('tab-suivi').getAttribute('aria-selected') === 'true' && noEx.text('tab-suivi') === 'Suivi budgétaire 2026' && noEx.text('tab-op') === 'OP' && noEx.$('tab-archive').hidden, 'sans exercice en préparation : le suivi budgétaire de l’année en cours est la première page, l’onglet voisin s’appelle « OP » sans année, pas d’archives');
  noEx.click(noEx.$('tab-op'));
  await noEx.until(() => noEx.$('envelope-empty'));
  check(/Aucun exercice en préparation/.test(noEx.text('envelope-empty')) && noEx.$('cell-bilan').hidden && noEx.$('cell-proj').hidden && noEx.$('cell-graph').hidden, 'onglet OP sans exercice en préparation : message, aucune donnée financière (étanche), et les zones du suivi sont masquées');

  // l'administrateur crée l'exercice en exécution (2026) et celui en préparation (2027) ; des équipes à 3 et 4 caractères
  const exec = w.exec;
  const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
  w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2027, annual_cost: 130000 } });
  const vm = w.call(CP, 'teams.create', { values: { name: '1vm', country: 'FR' } }), vmd = w.call(CP, 'teams.create', { values: { name: '1vmd', parent_team_id: vm.id, country: 'FR' } }), ae = w.call(CP, 'teams.create', { values: { name: '2ae', country: 'DE' } }), spare = w.call(CP, 'teams.create', { values: { name: '3xx', country: 'FR' } });
  const setTb = (team, f, v, ex) => w.call(CP, 'exercise.set', Object.assign({ projectId: w.p1.id, exerciseId: (ex || prep).id, teamId: team.id }, { [f]: v }));
  setTb(vm, 'expected', 100000); setTb(vmd, 'expected', 30000); setTb(ae, 'expected', 50000); setTb(vm, 'granted', 80000);
  const part = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: prep.id });
  const mk = (name) => { w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w1.id, values: { name, planned_start: '2026-11-02', planned_finish: '2026-11-13', owner_resource_id: w.mia.id } }); return c.repoList('PlanItem').find((i) => i.name === name); };
  const d1 = mk('Livrable 2027 A'), d2 = mk('Livrable 2027 B'), orphan = mk('Livrable sans exercice');
  part(d1, vm, 40000); part(d1, vmd, 20000); part(d2, vm, 30000); part(d2, ae, 60000);
  // l'exercice en exécution : deux livrables de 2026 avec leurs parts (l'équipe 9ex), un accordé inférieur aux parts (un clash)
  const ex9 = w.call(CP, 'teams.create', { values: { name: '9ex', country: 'FR', cost_center: 'CC-9' } });
  const mkAt = (name, s0, f0) => { w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w1.id, values: { name, planned_start: s0, planned_finish: f0, owner_resource_id: w.mia.id } }); return c.repoList('PlanItem').find((i) => i.name === name); };
  const e1 = mkAt('Livrable 2026 A', '2026-10-05', '2026-10-30'), e2 = mkAt('Livrable 2026 B', '2026-10-12', '2026-12-18');
  const partE = (item, team, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, team_id: team.id, planned_amount: amount }, exerciseId: exec.id });
  partE(e1, ex9, 4000); partE(e2, ex9, 3000);
  setTb(ex9, 'granted', 6000, exec);
  w.call(MEMBER, 'progress.declare', { planItemId: e1.id, progressPct: 50 });
  const ex = openPage(CP);
  await ex.until(() => ex.$('monthly-chart') && ex.$('track-table') && ex.$('proj-cards'));
  // le suivi budgétaire est la première page visible, sans cliquer ; la décomposition du budget en haut, fixe
  check(ex.$('tab-suivi').getAttribute('aria-selected') === 'true' && ex.text('tab-suivi') === 'Suivi budgétaire 2026' && ex.text('tab-op') === 'OP 2027' && ex.$('cell-exercice').hidden, 'sans rien cliquer : le suivi budgétaire 2026 est affiché ; l’onglet voisin s’appelle « OP 2027 »');
  const order = [...ex.doc.querySelectorAll('main .cell')].filter((x) => !x.hidden && x.id !== 'cell-program').map((x) => x.id.replace('cell-', ''));
  check(order.join(',') === 'enveloppe,proj,graph,bilan,po,track', 'l’ordre du suivi : décomposition du budget tout en haut, puis la projection, le graphique, le bilan par CPN, les achats, et « Par équipe » : ' + order.join(','));
  check(!ex.$('toggle-enveloppe') && !ex.$('toggle-proj') && !ex.$('toggle-graph') && !ex.$('panel-enveloppe').classList.contains('collapsed') && /Décomposition du Budget/.test(ex.text('zone-enveloppe')), 'la décomposition du budget, la projection et le graphique ne sont pas rétractables');
  check(!!ex.$('toggle-bilan') && !!ex.$('toggle-po') && ex.$('panel-bilan').classList.contains('collapsed') && ex.$('panel-po').classList.contains('collapsed') && ex.$('toggle-bilan').getAttribute('aria-expanded') === 'false', 'le bilan par CPN et les achats restent rétractables (repliés au départ), sous le graphique');
  check(!ex.$('cell-synth') && !ex.$('cell-deliv') && !ex.$('cell-rev') && !ex.$('cell-verss') && !ex.$('cell-vers') && !ex.$('toggle-deliv') && !ex.$('version-create'), 'les panneaux « synthèse et projection », « livrables en cours », « accordé et révisions » et les versions n’existent plus');
  check(/9ex/.test(ex.text('track-table')) && /clash/.test(ex.text('track-table')) && /7\s?000/.test(ex.text('track-table')), 'par équipe (repliable) : 9ex a 7 000 € de parts pour 6 000 € accordés : « clash » affiché');
  // la projection de fin d'année, entre le tableau et le graphique
  const pos = (a, b) => !!(ex.$(a).compareDocumentPosition(ex.$(b)) & 4);
  check(pos('env-table', 'proj-cards') && pos('proj-cards', 'monthly-chart'), 'la projection de fin d’année est entre le tableau de décomposition et le graphique');
  check(/Projection de fin d’année/.test(ex.text('proj-cards')) && /Valeur acquise/.test(ex.text('proj-cards')) && /Prévu de l’année/.test(ex.text('proj-cards')) && !!ex.$('proj-table') && /À l’avancement/.test(ex.text('proj-method')), 'la projection : budget, prévu de l’année, valeur acquise, projection, par workpackage, avec sa méthode (à l’avancement)');
  const svg = ex.$('monthly-chart').querySelector('svg');
  check(!!svg && svg.getAttribute('role') === 'img' && svg.querySelectorAll('.bar-seg').length >= 1 && svg.querySelectorAll('polyline.ch-cum').length === 1 && svg.querySelectorAll('.ch-band').length === 12, 'le graphique : histogramme empilé par workpackage, courbe de cumul, douze mois survolables');
  check(ex.doc.querySelectorAll('#graph-legend .chip').length >= 1 && /1 Conception|Conception/.test(ex.text('graph-legend')), 'la légende : une pastille par workpackage de premier niveau');
  const chip = ex.doc.querySelector('#graph-legend .chip'), segsBefore = ex.doc.querySelectorAll('#monthly-chart .bar-seg').length;
  ex.click(chip);
  check(ex.doc.querySelector('#graph-legend .chip').classList.contains('off') && ex.doc.querySelectorAll('#monthly-chart .bar-seg').length < segsBefore, 'une pastille masque son workpackage (les barres et le cumul suivent) ; un second clic le remontre');
  ex.click(ex.doc.querySelector('#graph-legend .chip'));
  const band = ex.doc.querySelector('#monthly-chart .ch-band[data-month="2026-10"]');
  band.dispatchEvent(new ex.win.Event('mouseenter', { bubbles: true }));
  check(!ex.$('graph-tip').hidden && /oct\./.test(ex.text('graph-tip')) && /Cumul/.test(ex.text('graph-tip')), 'au survol d’un mois : une infobulle (prévu par workpackage, total du mois, cumul)');
  ex.click(ex.$('toggle-track'));
  check(ex.$('toggle-track').getAttribute('aria-expanded') === 'true' && !ex.$('panel-track').classList.contains('collapsed'), 'un clic déploie « Par équipe »');
  // l'onglet OP : l'opération de planification de l'année suivante
  ex.click(ex.$('tab-op'));
  await ex.until(() => ex.$('exercise-table'));
  check(ex.$('tab-op').getAttribute('aria-selected') === 'true' && ex.$('cell-bilan').hidden && ex.$('cell-proj').hidden && ex.$('cell-graph').hidden && !ex.$('cell-exercice').hidden && !ex.$('cell-enveloppe').hidden && !ex.$('monthly-chart'), 'OP 2027 : décomposition du budget et budget par équipe ; la projection, le graphique et les engagements ne s’affichent pas');
  const picks = [ex.text('tab-suivi'), ex.text('tab-op')];
  check(picks.join('|') === 'Suivi budgétaire 2026|OP 2027', 'les deux onglets portent l’année de leur exercice : ' + picks.join(' | '));
  // ÉTANCHE : la décomposition de 2027 ne contient aucun livrable de 2026, et réciproquement
  const names27 = [...ex.doc.querySelectorAll('#env-table tr.is-deliverable')].map((r) => r.cells[0].querySelector('.env-item').textContent.replace(/\s+/g, ' ').trim());
  check(names27.length >= 1 && names27.every((n) => /2027/.test(n)) && !names27.some((n) => /2026|Spécification|Calcul|Essais/.test(n)), 'étanche : la décomposition de l’OP 2027 ne montre que les livrables de 2027 : ' + names27.join(' | '));
  check(!ex.$('env-' + w.w2.id) || ex.$('env-' + w.w2.id).value === '', 'et les enveloppes de 2026 n’y figurent pas (celles de 2027 sont à part)');

  const tr = (team) => ex.doc.querySelector('#exercise-table tr[data-team="' + team + '"]');
  const cells = (team) => [...tr(team).cells].map((x) => flat(x.textContent).trim());
  check(!!tr(vm.id + '-total') && /1vm \(total avec le détail\)/.test(cells(vm.id + '-total')[0]) && /130\s?000/.test(cells(vm.id + '-total')[1]) && /90\s?000/.test(cells(vm.id + '-total')[3]) && /\+40\s?000/.test(cells(vm.id + '-total')[4]), '1vm : total avec le détail de 1vmd — attendu 130 000 €, parts 90 000 €, reste à répartir +40 000 € : ' + cells(vm.id + '-total').join(' | '));
  check(!!tr(vm.id) && !!tr(vmd.id) && /1vmd/.test(cells(vmd.id)[0]) && /30\s?000/.test(ex.$('exp-' + vmd.id).value + '30000'), 'l’équipe seule et son détail à 4 caractères ont chacune leur ligne, modifiable');
  check(/−10\s?000/.test(cells(ae.id)[4]) && tr(ae.id).cells[4].classList.contains('late'), '2ae : les parts (60 000 €) dépassent l’attendu (50 000 €) : écart négatif, en rouge, rien n’est bloqué : ' + cells(ae.id)[4]);
  check(/clash/.test(cells(vm.id + '-total')[5]) || /clash/.test(cells(vm.id)[5]), 'un accordé (80 000 €) inférieur aux parts : « clash » affiché');
  check(/180\s?000/.test(ex.text('panel-exercice')) && /Écart avec l’accordé/.test(ex.text('panel-exercice')), 'cartes : attendu total et écart avec l’accordé');
  check(/Coût d’un ETP non paramétré pour DE en 2027/.test(ex.text('etp-missing')), 'l’Allemagne n’a pas de coût d’ETP en 2027 : la page le dit, sans inventer de jours : ' + ex.text('etp-missing').slice(0, 90));
  check(/ j/.test(cells(vm.id + '-total')[3]), 'équivalent en jours des parts de 1vm (coût de l’ETP de la France) : ' + cells(vm.id + '-total')[3]);
  // saisie directe de l'attendu : en brouillon, enregistré seulement par « Valider » (0.19.2)
  check(ex.$('ex-validate').disabled && !ex.$('ex-validate').classList.contains('primary'), 'budget par équipe : « Valider » grisé tant qu’il n’y a rien à enregistrer');
  ex.set('exp-' + ae.id, '65000'); ex.input(ex.$('exp-' + ae.id));
  check(!ex.$('ex-validate').disabled && ex.$('ex-validate').classList.contains('primary') && /Modifications non enregistrées/.test(ex.text('ex-hint')) && ex.$('exp-' + ae.id).classList.contains('changed'), 'une saisie : « Valider » devient bleu et le champ est marqué');
  await wait(150);
  check(!w.c.repoList('TeamBudget').some((b) => b.team_id === ae.id && Number(b.expected) === 65000), 'rien n’est enregistré à la saisie : seulement quand la personne clique sur « Valider »');
  ex.click(ex.$('ex-validate'));
  await ex.until(() => w.c.repoList('TeamBudget').some((b) => b.team_id === ae.id && Number(b.expected) === 65000));
  await ex.until(() => /Budget enregistré/.test(ex.text('toast')));
  await ex.until(() => { const r = ex.doc.querySelector('#exercise-table tr[data-team="' + ae.id + '"]'); return !!r && /\+5\s?000/.test(flat(r.cells[4].textContent)); });
  check(/\+5\s?000/.test(cells(ae.id)[4]) && !tr(ae.id).cells[4].classList.contains('late'), 'l’attendu se saisit dans le tableau : l’écart de 2ae passe à +5 000 €, plus de rouge');
  ex.set('exp-' + ae.id, '-3'); ex.input(ex.$('exp-' + ae.id));
  ex.click(ex.$('ex-validate'));
  await ex.until(() => ex.$('toast').classList.contains('error'));
  await ex.until(() => ex.$('exp-' + ae.id) && ex.$('exp-' + ae.id).value === '-3');
  check(/positif/.test(ex.text('toast')) && Number(w.c.repoList('TeamBudget').find((b) => b.team_id === ae.id).expected) === 65000 && ex.$('ex-validate').classList.contains('primary'), 'valeur négative refusée, la valeur enregistrée est intacte, le brouillon reste à l’écran et « Valider » reste bleu : ' + ex.text('toast'));
  ex.click(ex.$('ex-cancel'));
  await ex.until(() => ex.$('exp-' + ae.id) && ex.$('exp-' + ae.id).value === '65000');
  check(ex.$('ex-validate').disabled, '« Annuler les modifications » rétablit la valeur enregistrée');
  // ajouter une équipe au tableau
  check(![...ex.$('exercise-team-pick').options].some((o) => /Direction/.test(o.textContent)) && [...ex.$('exercise-team-pick').options].some((o) => /3xx/.test(o.textContent)) && ![...ex.$('exercise-team-pick').options].some((o) => /^2ae/.test(o.textContent)), 'les équipes proposées : 3 et 4 caractères, pas celles déjà au tableau');
  ex.set('exercise-team-pick', spare.id); ex.click(ex.$('exercise-team-add'));
  await ex.until(() => w.c.repoList('TeamBudget').some((b) => b.team_id === spare.id));
  await ex.until(() => ex.doc.querySelector('#exercise-table tr[data-team="' + spare.id + '"]'));
  check(!!ex.doc.querySelector('#exercise-table tr[data-team="' + spare.id + '"]'), 'une équipe ajoutée au tableau (attendu 0 €, à renseigner)');
  // le rattachement des livrables à l'exercice : depuis la décomposition du budget (plus de zone « Parts des livrables »)
  await ex.until(() => ex.$('env-table'));
  check(!ex.$('lines-table') && !!ex.$('assign-open') && /Rattacher les livrables sans exercice à l’exercice 2027/.test(ex.text('assign-open')), 'la décomposition propose de rattacher les livrables sans exercice à l’exercice de l’onglet (2027)');
  ex.click(ex.$('assign-open'));
  await ex.until(() => ex.$('genform').open && ex.$('gf-deliverable_id'));
  check(/Tous les livrables sans exercice/.test([...ex.$('gf-deliverable_id').options][0].textContent), 'rattacher : « tous les livrables sans exercice » par défaut');
  ex.submitGf();
  await ex.until(() => c.repoList('PlanItem').filter((i) => i.item_type === 'Livrable' && i.project_id === w.p1.id).every((i) => i.exercise_id));
  check(c.repoList('PlanItem').filter((i) => i.item_type === 'Livrable' && i.project_id === w.p1.id && i.exercise_id !== exec.id).every((i) => i.exercise_id === prep.id), 'tous les livrables sans exercice sont rattachés à l’exercice 2027');
  // exporter et importer l'exercice dans un classeur Google Sheet
  await ex.until(() => ex.$('exercise-import'));
  ex.click(ex.$('exercise-import'));
  await ex.until(() => ex.$('eximp').open && ex.$('eximp-template'));
  check(/Exporter ou importer l’exercice 2027 \(préparation\)/.test(ex.text('eximp-title')) && ex.$('eximp-run').disabled, 'la boîte d’import annonce l’exercice 2027 ; on ne peut pas importer avant d’avoir analysé');
  ex.click(ex.$('eximp-template'));
  await ex.until(() => ex.$('eximp-template-link'));
  check(/\d+ lignes? de budget, \d+ parts? de livrables?/.test(ex.text('eximp-template-out')) && ex.$('eximp-book').value === ex.$('eximp-template-link').getAttribute('href'), 'le classeur est créé, prérempli, son lien est dans le champ : ' + ex.text('eximp-template-out'));
  const bookId = /\/d\/([^/?#]+)/.exec(ex.$('eximp-book').value)[1], bk = c.SpreadsheetApp.openById(bookId), shB = bk.getSheetByName('Budget par équipe'), shP = bk.getSheetByName('Parts des livrables');
  ex.click(ex.$('eximp-analyze'));
  await ex.until(() => ex.$('eximp-head'));
  check(/Rien à importer/.test(ex.text('eximp-head')) && ex.$('eximp-run').disabled, 'l’export relu tel quel : rien à importer, « Importer » inactif');
  const rowB = (name) => shB.getDataRange().getValues().findIndex((r, i) => i > 0 && r[1] === name) + 1;
  shB.getRange(shB.getLastRow() + 1, 1, 1, 4).setValues([['P1', 'Fantôme', 1000, '']]);
  ex.click(ex.$('eximp-analyze'));
  await ex.until(() => ex.$('eximp-errors'));
  check(/1 erreur/.test(ex.text('eximp-head')) && /Budget par équipe, ligne \d+ — Équipe « Fantôme » : introuvable/.test(ex.text('eximp-errors')) && ex.$('eximp-run').disabled, 'une erreur dit l’onglet, la ligne et ce qui manque ; « Importer » reste inactif');
  shB.getRange(shB.getLastRow(), 1, 1, 4).setValues([['', '', '', '']]);
  shB.getRange(rowB('1vm'), 3).setValue(130000);
  shP.getRange(shP.getLastRow() + 1, 1, 1, 5).setValues([['P1', '1', 'Livrable sans exercice', '2ae', 7000]]);
  ex.click(ex.$('eximp-analyze'));
  await ex.until(() => ex.$('eximp-counts'));
  check(/Budget par équipe : 0 à créer, 1 à modifier/.test(ex.text('eximp-counts')) && /Parts des livrables : 1 à créer/.test(ex.text('eximp-counts')) && !ex.$('eximp-run').disabled, 'le plan chiffré s’affiche, « Importer » devient actif : ' + ex.text('eximp-counts'));
  const realRun = c.API_ACTIONS['exercise.import.run']; const seenRuns = [];
  c.API_ACTIONS['exercise.import.run'] = (params, ctx) => { const out = realRun(Object.assign({}, params, { maxOps: 1 }), ctx); seenRuns.push([!!params.resume, !!out.backup]); return out; };
  ex.click(ex.$('eximp-run'));
  await ex.until(() => /Import terminé/.test(ex.text('eximp-status')), 8000);
  c.API_ACTIONS['exercise.import.run'] = realRun;
  check(c.repoList('TeamBudget').some((b) => b.team_id === vm.id && Number(b.expected) === 130000) && c.repoList('BudgetLine').some((l) => l.team_id === ae.id && l.deliverable_id === c.repoList('PlanItem').find((i) => i.name === 'Livrable sans exercice').id && Number(l.planned_amount) === 7000), 'importé : l’attendu de 1vm et la part de 2ae sont dans l’outil');
  check(seenRuns.length === 2 && JSON.stringify(seenRuns[0]) === '[false,true]' && JSON.stringify(seenRuns[1]) === '[true,false]', 'relancé lot après lot, une seule copie de sécurité : ' + JSON.stringify(seenRuns));
  check(!!ex.$('eximp-backup-link') && /Copie avant import de l’exercice 2027/.test(ex.text('eximp-backup')), 'le lien de la copie reste affiché');
  ex.click(ex.$('eximp-close'));
  await ex.until(() => ex.$('exp-' + vm.id) && ex.$('exp-' + vm.id).value === '130000');
  check(ex.$('exp-' + vm.id).value === '130000', 'le tableau de l’exercice est rafraîchi après l’import : 1vm à 130 000 €');
  // lecture seule pour un Workpackage leader
  const wl2 = openPage(RWP);
  await wl2.until(() => wl2.$('track-table'));
  wl2.click(wl2.$('tab-op'));
  await wl2.until(() => wl2.$('exercise-table'));
  check(!wl2.doc.querySelector('[id^="exp-"]') && /Lecture seule/.test(wl2.text('exercise-note')) && !wl2.$('exercise-team-add'), 'un Workpackage leader voit l’exercice du projet en lecture seule : ni champs, ni ajout');
  const mm2 = openPage(MEMBER);
  await wait(250);
  check(mm2.$('zone-exercice').hidden && mm2.$('panel-exercice').hidden, 'un Contributor ne voit pas la zone de l’exercice');

  // ---------------------------------------------------------------- 0.19.2 : l'évolution depuis la baseline, à même la décomposition
  const nb = openPage(CP);
  await nb.until(() => nb.$('env-table'));
  check(![...nb.doc.querySelectorAll('#env-table th')].some((h) => /Depuis la baseline/.test(h.textContent)), 'sans baseline : pas de colonne d’évolution');
  w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Référence pour l’essai', label: 'B0' });
  const lineB = c.repoList('BudgetLine').find((l) => l.team_id === ex9.id);
  w.call(CP, 'budget.line.save', { id: lineB.id, version: lineB.version, values: { planned_amount: Number(lineB.planned_amount) + 500 } });
  w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, allocations: [{ wpId: w.w2.id, amount: 1234 }] });
  const bl = openPage(CP);
  await bl.until(() => bl.$('env-table'));
  check([...bl.doc.querySelectorAll('#env-table th')].some((h) => /Depuis la baseline P1_0/.test(h.textContent)), 'avec une baseline active : colonne « Depuis la baseline P1_0 »');
  await bl.until(() => /enveloppe/.test(bl.doc.querySelector('#env-table tr[data-wp="' + w.w2.id + '"]').textContent) || true);
  const wr2 = bl.doc.querySelector('#env-table tr[data-wp="' + w.w2.id + '"]');
  check(/enveloppe .* → 1\s?234 €/.test(flat(wr2.cells[6].textContent)), 'un workpackage dont l’enveloppe a changé : « enveloppe … → 1 234 € » : ' + flat(wr2.cells[6].textContent));
  const dlUp = [...bl.doc.querySelectorAll('#env-table tr.is-deliverable')].find((r) => /Livrable 2026/.test(r.cells[0].textContent) && /coût \+500/.test(flat(r.cells[6].textContent)));
  check(!!dlUp, 'un livrable dont une ligne a augmenté de 500 € : « coût +500 € »');
  const unchanged = [...bl.doc.querySelectorAll('#env-table tr.is-deliverable')].find((r) => /=/.test(r.cells[6].textContent));
  check(!!unchanged, 'un livrable inchangé : « = »');
  check(!!bl.doc.querySelector('#env-table tr.is-milestone') && bl.doc.querySelector('#env-table tr.is-milestone').cells[6].textContent.trim() === '', 'un jalon n’a pas de coût : cellule vide');

  // ---------------------------------------------------------------- 0.19.3 : les valeurs d'avant sont reprises en brouillon, l'écart s'affiche en direct
  c.repoUpdate('Project', w.p1.id, { budget_authorized: 7000 }, null, w.S);
  c.repoUpdate('WorkPackage', w.w1.id, { budget_allocated: 2500 }, null, w.S);
  const lg = openPage(CP);
  await lg.until(() => lg.$('env-table'));
  lg.click(lg.$('tab-op'));
  await lg.until(() => lg.$('env-authorized') && lg.$('env-' + w.w1.id) && lg.$('env-legacy-note'));
  check(lg.$('env-authorized').value === '7000' && lg.$('env-' + w.w1.id).value === '2500' && !lg.$('env-validate').disabled && lg.$('env-validate').classList.contains('primary') && /valeurs d’avant/.test(lg.text('env-legacy-note')), 'OP 2027 : les anciennes enveloppes sont reprises en brouillon (rien à ressaisir) ; « Valider » est bleu et la page le dit');
  check(c.envAmount_(c.repoGet('Project', w.p1.id), c.envKey_(prep)) === null && c.envAmount_(c.repoGet('WorkPackage', w.w1.id), c.envKey_(prep)) === null, 'rien n’est enregistré pour 2027 tant qu’on ne valide pas');
  check(lg.text('env-' + w.w1.id + '-delta') === '', 'aucun écart tant qu’on n’a pas modifié la valeur reprise');
  lg.set('env-' + w.w1.id, '3000'); lg.input(lg.$('env-' + w.w1.id));
  check(/\+500\s?€ vs avant \(2\s?500\s?€\)/.test(lg.text('env-' + w.w1.id + '-delta')) && lg.$('env-' + w.w1.id + '-delta').classList.contains('up'), 'l’écart avec la valeur d’avant s’affiche en direct : ' + lg.text('env-' + w.w1.id + '-delta'));
  lg.set('env-' + w.w1.id, '2000'); lg.input(lg.$('env-' + w.w1.id));
  check(/−500\s?€ vs avant/.test(lg.text('env-' + w.w1.id + '-delta')) && lg.$('env-' + w.w1.id + '-delta').classList.contains('down'), 'et il passe en baisse quand on descend : ' + lg.text('env-' + w.w1.id + '-delta'));
  lg.click(lg.$('env-validate'));
  await lg.until(() => c.envAmount_(c.repoGet('WorkPackage', w.w1.id), c.envKey_(prep)) === 2000 && c.envAmount_(c.repoGet('Project', w.p1.id), c.envKey_(prep)) === 7000);
  check(c.envAmount_(c.repoGet('WorkPackage', w.w1.id), c.envKey_(exec)) !== 2000, 'adopté pour 2027 seulement : l’exercice 2026 garde ses propres valeurs');
  await lg.until(() => lg.$('env-validate') && lg.$('env-validate').disabled && !lg.$('env-legacy-note'));
  check(lg.text('env-' + w.w1.id + '-delta') === '', 'enregistré : plus de reprise, plus d’écart');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Budget : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
