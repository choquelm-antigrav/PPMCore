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
  const zones = () => ['plan', 'track', 'actuals', 'bilan', 'po'].filter((z) => { const n = doc.getElementById('zone-' + z); return n && !n.hidden && !doc.getElementById('panel-' + z).hidden; });
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
  check(JSON.stringify(p.zones()) === JSON.stringify(['plan', 'track', 'actuals', 'bilan', 'po']), 'le chef de projet voit les zones du suivi : plan budgétaire, suivi par équipe, réalisé, bilan, achats');
  await p.until(() => p.$('po-add') && p.$('plan-table'));
  check(!!p.$('bal-table') && !!p.$('po-table') === false && !!p.doc.querySelector('.cost-btn'), 'bilan, achats et plan budgétaire (avec les boutons des forfaits des livrables) sont chargés ensemble sur la page');
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

  // ---------------------------------------------------------------- 0.21.0 : le plan budgétaire, matrice livrable × équipe (+ colonne Externe)
  await p.until(() => p.$('plan-table'));
  const cellId = (item, team) => 'cell-' + item.id + '-' + team.id;
  const costBtn = (item) => p.doc.querySelector('.cost-btn[data-item="' + item.id + '"]');
  const itemRow = (item) => p.doc.querySelector('#plan-table tr[data-item="' + item.id + '"]');
  check(/Plan budgétaire/.test(p.text('zone-plan')) && !p.$('env-table') && !p.$('lines-table') && !p.$('monthly-chart') && !p.$('proj-cards'), 'la zone s’appelle « Plan budgétaire » ; plus de décomposition par enveloppes, de graphique mensuel ni de projection d’avant');
  check(!!itemRow(w.a) && !!itemRow(w.b) && !!itemRow(w.cc), 'une ligne par livrable de l’exercice');
  check(p.$(cellId(w.b, w.team)).value === '5200' && p.$(cellId(w.a, w.team)).value === '', 'la cellule livrable × équipe porte la part (5 200 € pour T1A) ; vide quand l’équipe n’a pas de part');
  check(/8 000 €/.test(flat(itemRow(w.cc).textContent)) && !!costBtn(w.cc), 'la colonne Externe : le forfait de 8 000 € du livrable, avec son bouton €');
  check(!!p.doc.querySelector('#plan-table tr.dot-row') && !!p.$('dot-' + w.team.id) && p.$('dot-' + w.team.id).value === '', 'première ligne : la dotation de chaque équipe, vide tant qu’elle n’est pas fixée');
  check(p.$('plan-validate').disabled && !p.$('plan-validate').classList.contains('primary') && p.$('plan-cancel').hidden, 'sans modification : « Valider » grisé');
  // brouillon : une part et une dotation, rien n'est enregistré avant « Valider »
  p.set(cellId(w.a, w.team), '2080'); p.input(p.$(cellId(w.a, w.team)));
  p.set('dot-' + w.team.id, '4000'); p.input(p.$('dot-' + w.team.id));
  check(!p.$('plan-validate').disabled && p.$('plan-validate').classList.contains('primary') && p.$(cellId(w.a, w.team)).classList.contains('changed') && c.repoList('BudgetLine').length === 2 && c.repoList('TeamBudget').length === 0, 'brouillon : « Valider » devient bleu, les champs modifiés sont marqués, rien n’est enregistré');
  check(/2 080 €/.test(flat(itemRow(w.a).textContent)) && /7 280 €/.test(flat(p.doc.querySelector('#plan-table tr.total').textContent)) && c.repoList('BudgetLine').length === 2, 'totaux en direct : le total du livrable et le total des livrables suivent la saisie, avant « Valider »');
  p.click(p.$('plan-validate'));
  await p.until(() => c.repoList('BudgetLine').some((l) => l.deliverable_id === w.a.id && Number(l.planned_amount) === 2080) && c.repoList('TeamBudget').length === 1);
  const tb0 = c.repoList('TeamBudget')[0];
  check(Number(tb0.amount) === 4000 && tb0.team_id === w.team.id && tb0.exercise_id === w.exec.id && tb0.project_id === w.p1.id, 'la dotation de l’équipe : 4 000 € pour l’exercice en exécution');
  await p.until(() => { const r0 = p.doc.querySelector('#exercise-table tr[data-team="' + w.team.id + '"]'); return r0 && /4 000 €/.test(flat(r0.textContent)) && /7 280 €/.test(flat(r0.textContent)); });
  await p.until(() => /Plan budgétaire enregistré/.test(p.text('toast')));
  check(/clash/.test(flat(p.doc.querySelector('#exercise-table tr[data-team="' + w.team.id + '"]').textContent)) && /Plan budgétaire enregistré/.test(p.text('toast')) && p.$('plan-validate').disabled, 'dotation 4 000 €, plan 7 280 € : le clash s’affiche dans le tableau des dotations ; brouillon vidé');
  check(/7 280 €/.test(flat(itemRow(w.a).textContent + p.doc.querySelector('#plan-table tr.total').textContent)), 'les totaux sont recalculés à la validation');
  // vider une cellule retire la part
  p.set(cellId(w.a, w.team), ''); p.input(p.$(cellId(w.a, w.team)));
  p.click(p.$('plan-validate'));
  await p.until(() => c.repoList('BudgetLine').every((l) => l.deliverable_id !== w.a.id));
  await p.until(() => { const r0 = p.doc.querySelector('#exercise-table tr[data-team="' + w.team.id + '"]'); return r0 && /5 200 €/.test(flat(r0.textContent)); });
  check(/clash/.test(flat(p.doc.querySelector('#exercise-table tr[data-team="' + w.team.id + '"]').textContent)), 'une cellule vidée retire la part : le plan retombe à 5 200 €, toujours au-dessus de la dotation de 4 000 € (clash)');
  // annuler les modifications
  p.set(cellId(w.b, w.team), '9999'); p.input(p.$(cellId(w.b, w.team)));
  check(!p.$('plan-cancel').hidden, 'après une modification : « Annuler les modifications » apparaît');
  p.click(p.$('plan-cancel'));
  check(p.$(cellId(w.b, w.team)).value === '5200' && p.$('plan-validate').disabled, 'annuler restaure les valeurs enregistrées');
  // quitter avec un brouillon : on demande
  p.set(cellId(w.b, w.team), '9999'); p.input(p.$(cellId(w.b, w.team)));
  p.click(p.$('tab-op'));
  await p.until(() => p.$('confirm').open);
  check(/Abandonner les modifications/.test(p.text('confirm-title')) && p.$('tab-suivi').getAttribute('aria-selected') === 'true', 'changer d’onglet avec un brouillon : confirmation demandée, onglet inchangé');
  p.click(p.$('confirm-cancel'));
  p.click(p.$('plan-cancel'));
  check(Number(c.repoList('BudgetLine').find((l) => l.deliverable_id === w.b.id && l.team_id === w.team.id).planned_amount) === 5200, 'rien n’a été enregistré');

  // ---------------------------------------------------------------- forfaits (externe) d'un livrable : bouton € de la colonne Externe
  p.click(costBtn(w.cc));
  await p.until(() => p.$('ext-dialog').open && p.$('ext-lines') && p.$('ext-resource'));
  check(/Forfaits du livrable/.test(p.text('ext-title')) && p.doc.querySelectorAll('#ext-lines tbody tr').length === 1 && /Xavier/.test(p.text('ext-lines')) && /8 000 €/.test(p.text('ext-lines')), 'la fenêtre liste le forfait de Xavier : 8 000 €');
  p.click(p.$('ext-close'));
  p.click(costBtn(w.a));
  await p.until(() => p.$('ext-dialog').open && /Aucun forfait/.test(p.text('ext-total')) && p.$('ext-resource'));
  const exts = [...p.$('ext-resource').options].map((o) => o.textContent);
  check(exts.some((n) => /Xavier/.test(n)) && !exts.some((n) => /Mia|Rémi|Carla/.test(n)), 'seules les ressources externes sont proposées : ' + exts.join(' | '));
  p.set('ext-amount', '500'); p.click(p.$('ext-add'));
  await p.until(() => !p.$('ext-error').hidden);
  check(/Choisissez une ressource externe/.test(p.text('ext-error')), 'sans ressource : message explicite');
  p.set('ext-resource', w.xavier.id); p.click(p.$('ext-add'));
  await p.until(() => c.repoList('BudgetLine').some((l) => l.deliverable_id === w.a.id && l.cost_type === 'Forfait'));
  const f1 = c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id && l.cost_type === 'Forfait');
  check(Number(f1.fixed_amount) === 500 && f1.resource_id === w.xavier.id, 'forfait de 500 € enregistré');
  await p.until(() => p.row('ext-lines', f1.id, 'data-line'));
  p.click(p.row('ext-lines', f1.id, 'data-line').querySelector('.line-edit'));
  await p.until(() => p.$('genform').open && p.$('gf-amount'));
  p.set('gf-amount', '650'); p.submitGf();
  await p.until(() => Number(c.repoGet('BudgetLine', f1.id).fixed_amount) === 650);
  await p.until(() => p.row('ext-lines', f1.id, 'data-line') && /650 €/.test(flat(p.row('ext-lines', f1.id, 'data-line').textContent)));
  check(/650 €/.test(flat(itemRow(w.a).textContent)), 'le forfait modifié : 650 €, visible dans la colonne Externe du tableau');
  p.click(p.row('ext-lines', f1.id, 'data-line').querySelector('.line-del'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('BudgetLine').every((l) => l.id !== f1.id));
  await p.until(() => /Aucun forfait/.test(p.text('ext-total')));
  p.click(p.$('ext-close'));
  check(true, 'forfait supprimé');
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
  check(JSON.stringify(r.zones()) === JSON.stringify(['plan', 'track', 'po']), 'un Workpackage leader : plan de son workpackage, suivi par équipe (lecture) et achats : ' + r.zones().join(','));
  await r.until(() => r.$('plan-table'));
  check(/Vous voyez les livrables dont vous êtes responsable/.test(r.text('plan-partial')) && !r.doc.querySelector('[id^="dot-"]') && !!r.doc.querySelector('.cost-btn') && !r.doc.querySelector('.cost-btn[data-item="' + w.cc.id + '"]'), 'décomposition limitée à son périmètre : les livrables de son workpackage seulement, avec leur bouton de coût');
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
  check(dp.doc.body.classList.contains('in-program') && ['cell-plan', 'cell-track', 'cell-actuals', 'cell-bilan', 'cell-po'].every((id) => [...dp.doc.querySelectorAll('style')].some((s) => s.textContent.includes('body.in-program #' + id))) && !dp.$('panel-program').hidden && /Budget — Programme/.test(dp.text('title')) && dp.$('cpn-edit').hidden, 'en vue programme, les cartes du projet sont masquées par une règle de la page (sans toucher à leur attribut) et le titre dit « Programme »');
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


  // ---------------------------------------------------------------- 0.21.0 : l'exercice (année en exécution et année en préparation)
  const fmt = (n) => norm(Math.round(n).toLocaleString('fr-FR') + ' €');
  const serverTracking = (user, extra) => c.handleRequest({ action: 'exercise.tracking', params: Object.assign({ projectId: w.p1.id, exerciseId: w.exec.id, version: 'ref' }, extra || {}), apiVersion: '1.0' }, user || ADMIN).data;
  const noEx = openPage(CP);
  await noEx.until(() => noEx.$('plan-table'));
  check(noEx.$('tab-suivi').getAttribute('aria-selected') === 'true' && noEx.text('tab-suivi') === 'Suivi budgétaire 2026' && noEx.text('tab-op') === 'OP' && noEx.$('tab-archive').hidden, 'sans exercice en préparation : le suivi budgétaire de l’année en cours est la première page, l’onglet voisin s’appelle « OP » sans année');
  noEx.click(noEx.$('tab-op'));
  await noEx.until(() => noEx.$('plan-empty'));
  check(/Aucun exercice en préparation/.test(noEx.text('plan-empty')) && noEx.$('cell-bilan').hidden && noEx.$('cell-track').hidden && noEx.$('cell-actuals').hidden, 'onglet OP sans exercice en préparation : message, aucune donnée financière (étanche), et les zones du suivi sont masquées');

  // l'administrateur crée l'exercice en préparation (2027) ; des équipes à 3 et 4 caractères
  const exec = w.exec;
  const prep = w.call(ADMIN, 'exercise.create', { year: 2027 });
  w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2027, annual_cost: 130000 } });
  const vm = w.call(CP, 'teams.create', { values: { name: '1vm', country: 'FR' } }), vmd = w.call(CP, 'teams.create', { values: { name: '1vmd', parent_team_id: vm.id, country: 'FR' } }), ae = w.call(CP, 'teams.create', { values: { name: '2ae', country: 'DE' } }), spare = w.call(CP, 'teams.create', { values: { name: '3xx', country: 'FR' } });
  const setDot = (team, amount, ex) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: (ex || prep).id, teamId: team.id, amount });
  setDot(vm, 80000); setDot(vmd, 30000); setDot(ae, 50000);
  const part = (item, team, amount) => w.call(CP, 'budget.cell.set', { deliverableId: item.id, teamId: team.id, amount, exerciseId: prep.id });
  const mk = (name) => { w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w1.id, values: { name, planned_start: '2026-11-02', planned_finish: '2026-11-13', owner_resource_id: w.mia.id } }); return c.repoList('PlanItem').find((i) => i.name === name); };
  const d1 = mk('Livrable 2027 A'), d2 = mk('Livrable 2027 B'), orphan = mk('Livrable sans exercice');
  part(d1, vm, 40000); part(d1, vmd, 20000); part(d2, vm, 30000); part(d2, ae, 60000);
  // l'exercice en exécution : deux livrables de 2026 avec leurs parts (l'équipe 9ex), une dotation inférieure aux parts (un clash)
  const ex9 = w.call(CP, 'teams.create', { values: { name: '9ex', country: 'FR', cost_center: 'CC-9' } });
  const mkAt = (name, s0, f0) => { w.call(ADMIN, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w1.id, values: { name, planned_start: s0, planned_finish: f0, owner_resource_id: w.mia.id } }); return c.repoList('PlanItem').find((i) => i.name === name); };
  const e1 = mkAt('Livrable 2026 A', '2026-10-05', '2026-10-30'), e2 = mkAt('Livrable 2026 B', '2026-10-12', '2026-12-18');
  const partE = (item, team, amount) => w.call(CP, 'budget.cell.set', { deliverableId: item.id, teamId: team.id, amount, exerciseId: exec.id });
  partE(e1, ex9, 4000); partE(e2, ex9, 3000);
  setDot(ex9, 6000, exec);
  w.call(MEMBER, 'progress.declare', { planItemId: e1.id, progressPct: 50 });
  const ex = openPage(CP);
  await ex.until(() => ex.$('plan-table') && ex.$('track-table') && ex.$('actuals-empty'));
  check(ex.$('tab-suivi').getAttribute('aria-selected') === 'true' && ex.text('tab-suivi') === 'Suivi budgétaire 2026' && ex.text('tab-op') === 'OP 2027', 'sans rien cliquer : le suivi budgétaire 2026 est affiché ; l’onglet voisin s’appelle « OP 2027 »');
  const order = [...ex.doc.querySelectorAll('main .cell')].filter((x) => !x.hidden && x.id !== 'cell-program').map((x) => x.id.replace('cell-', ''));
  check(JSON.stringify(order) === JSON.stringify(['plan', 'track', 'actuals', 'bilan', 'po']), 'ordre des zones : plan budgétaire en haut (fixe), puis suivi par équipe, réalisé, bilan, achats : ' + order.join(', '));
  // ÉTANCHE : le plan de 2026 ne contient aucun livrable de 2027
  check(!ex.doc.querySelector('#plan-table tr[data-item="' + d1.id + '"]') && !!ex.doc.querySelector('#plan-table tr[data-item="' + e1.id + '"]') && !ex.doc.querySelector('#plan-table tr[data-item="' + orphan.id + '"]'), 'étanche : le plan de 2026 montre les livrables de 2026, ni ceux de 2027 ni ceux sans exercice');
  // suivi par équipe : les chiffres sont ceux du serveur (une seule source)
  const trk = serverTracking();
  const t9 = trk.teams.find((t) => t.team_id === ex9.id);
  const tr9 = ex.doc.querySelector('#track-table tr[data-team="' + ex9.id + '"]');
  check(!!tr9 && t9.plan === 7000 && t9.dotation === 6000 && norm(tr9.textContent).includes(fmt(6000)) && norm(tr9.textContent).includes(fmt(7000)) && norm(tr9.textContent).includes(fmt(t9.ev)) && /Clash/.test(tr9.textContent), 'suivi : dotation 6 000 €, plan 7 000 €, valeur acquise ' + fmt(t9.ev) + ', « Clash » : ' + norm(tr9.textContent));
  check(/Aucun réalisé saisi/.test(ex.text('proj-no-actuals')) && trk.totals.landing === null && /Non saisi/.test(ex.text('track-cards')), 'sans réalisé : l’atterrissage n’est pas calculé, la page invite à le saisir');
  check(/Dotation et plan par équipe/.test(ex.text('dotations-title')) && /7 000 €/.test(flat(ex.doc.querySelector('#exercise-table tr[data-team="' + ex9.id + '"]').textContent)) && /clash/.test(flat(ex.doc.querySelector('#exercise-table tr[data-team="' + ex9.id + '"]').textContent)), 'le tableau des dotations donne les mêmes chiffres : plan 7 000 € pour une dotation de 6 000 € (clash)');

  // ---------------------------------------------------------------- réalisé : saisi à la main par CPN, équipe et mois
  check(!!ex.$('act-form') && !!ex.$('act-cpn') && [...ex.$('act-cpn').options].map((o) => o.value).join() === 'CPN-100,CPN-200', 'le formulaire de saisie propose les CPN du projet : ' + [...ex.$('act-cpn').options].map((o) => o.value).join());
  ex.click(ex.$('act-save'));
  await ex.until(() => !ex.$('act-error').hidden);
  check(/Choisissez une équipe/.test(ex.text('act-error')), 'sans équipe : message explicite');
  ex.set('act-team', ex9.id); ex.set('act-month', '2026-10'); ex.set('act-amount', '1500'); ex.set('act-cpn', 'CPN-100');
  ex.click(ex.$('act-save'));
  await ex.until(() => c.repoList('ActualLine').length === 1 && ex.$('actuals-table'));
  const a1 = c.repoList('ActualLine')[0];
  check(a1.team_id === ex9.id && a1.month === '2026-10' && a1.charge_code === 'CPN-100' && Number(a1.amount) === 1500, 'réalisé saisi : 1 500 € pour 9ex en octobre sur CPN-100');
  await ex.until(() => { const r0 = ex.doc.querySelector('#track-table tr[data-team="' + ex9.id + '"]'); return r0 && /1 500 €/.test(flat(r0.textContent)); });
  const trk2 = serverTracking(), t92 = trk2.teams.find((t) => t.team_id === ex9.id);
  check(t92.actual_to_date === 1500 && t92.landing === Math.round((1500 + Math.max(0, 7000 - t92.ev)) * 100) / 100 && norm(ex.doc.querySelector('#track-table tr[data-team="' + ex9.id + '"]').textContent).includes(fmt(t92.landing)), 'atterrissage = réalisé à ce jour + reste à faire : ' + fmt(t92.landing) + ' (comme le serveur)');
  check(/CPN-100 1 500 €/.test(ex.text('actuals-cpn')) && !ex.$('proj-no-actuals'), 'le réalisé par CPN s’affiche et l’invitation à saisir disparaît');
  // modifier la même combinaison remplace le montant
  ex.click(ex.doc.querySelector('#actuals-lines .act-edit'));
  check(ex.$('act-team').value === ex9.id && ex.$('act-month').value === '2026-10' && ex.$('act-amount').value === '1500', 'Modifier remplit le formulaire avec la saisie');
  ex.set('act-amount', '1800'); ex.click(ex.$('act-save'));
  await ex.until(() => Number(c.repoGet('ActualLine', a1.id).amount) === 1800);
  check(c.repoList('ActualLine').length === 1, 'saisir à nouveau la même combinaison remplace le montant (l’historique des autres mois est conservé)');
  await ex.until(() => ex.doc.querySelectorAll('#actuals-lines tbody tr').length === 1 && /1 800 €/.test(ex.text('actuals-lines')));
  // un autre mois s'ajoute (l'historique), un avoir se saisit en négatif
  ex.set('act-team', ex9.id); ex.set('act-month', '2026-09'); ex.set('act-amount', '-200'); ex.click(ex.$('act-save'));
  await ex.until(() => c.repoList('ActualLine').length === 2);
  check(c.repoList('ActualLine').some((l) => l.month === '2026-09' && Number(l.amount) === -200), 'un avoir (montant négatif) sur un autre mois : l’historique est conservé');
  await ex.until(() => ex.doc.querySelectorAll('#actuals-lines tbody tr').length === 2);
  ex.click(ex.doc.querySelector('#actuals-lines tr[data-line="' + c.repoList('ActualLine').find((l) => l.month === '2026-09').id + '"] .act-del'));
  await ex.until(() => c.repoList('ActualLine').length === 1);
  check(true, 'Retirer supprime la saisie du mois');
  // un Workpackage leader ne saisit pas le réalisé
  const wl3 = openPage(RWP);
  await wl3.until(() => wl3.$('track-table'));
  check(wl3.$('zone-actuals').hidden && wl3.$('cell-actuals').hidden, 'le réalisé est réservé au chef de projet et au-dessus : un Workpackage leader ne voit pas la zone');

  // ---------------------------------------------------------------- l'onglet OP : le plan de l'année suivante
  const opP = openPage(CP);
  await opP.until(() => opP.$('plan-table') && opP.$('tab-op'));
  opP.click(opP.$('tab-op'));
  await opP.until(() => opP.$('dot-' + vm.id) && opP.doc.querySelector('#plan-table tr[data-item="' + d1.id + '"]'));
  check(opP.text('tab-op') === 'OP 2027' && opP.$('tab-op').getAttribute('aria-selected') === 'true' && !opP.$('version-bar') && !opP.doc.querySelector('#plan-table tr[data-item="' + e1.id + '"]'), 'onglet OP 2027 : le plan de 2027 sans les livrables de 2026 (étanche) ; pas de versions dans l’OP');
  const rowVm = opP.doc.querySelector('#exercise-table tr[data-team="' + vm.id + '-total"]'), rowAe = opP.doc.querySelector('#exercise-table tr[data-team="' + ae.id + '"]');
  check(/110 000 €/.test(flat(rowVm.textContent)) && /90 000 €/.test(flat(rowVm.textContent)) && /\+20 000 €/.test(flat(rowVm.textContent)), '1vm avec son détail 1vmd : dotation 110 000 €, plan 90 000 €, reste 20 000 € : ' + flat(rowVm.textContent));
  check(/50 000 €/.test(flat(rowAe.textContent)) && /60 000 €/.test(flat(rowAe.textContent)) && /clash/.test(flat(rowAe.textContent)), '2ae : plan 60 000 € pour 50 000 € de dotation : clash');
  check(!!opP.doc.querySelector('#plan-table th[data-team="' + vmd.id + '"]') && /détail de 1vm/.test(flat(opP.doc.querySelector('#plan-table th[data-team="' + vmd.id + '"]').textContent)), 'l’équipe à 4 caractères est une colonne « détail de 1vm »');
  // la dotation se saisit dans la première ligne
  opP.set('dot-' + vm.id, '85000'); opP.input(opP.$('dot-' + vm.id));
  opP.click(opP.$('plan-validate'));
  await opP.until(() => c.repoList('TeamBudget').some((b) => b.team_id === vm.id && b.exercise_id === prep.id && Number(b.amount) === 85000));
  await opP.until(() => { const r0 = opP.doc.querySelector('#exercise-table tr[data-team="' + vm.id + '-total"]'); return r0 && /115 000 €/.test(flat(r0.textContent)); });
  check(true, 'dotation 1vm : 80 000 € → 85 000 € ; avec le détail : 115 000 €');
  // une colonne équipe ajoutée à la main, puis une part dans cette colonne
  const pick = opP.$('plan-team-pick');
  check(!![...pick.options].find((o) => o.value === spare.id) && ![...pick.options].find((o) => o.value === vm.id), 'on ajoute une colonne pour une équipe qui n’en a pas encore : 3xx proposée, 1vm déjà présente');
  pick.value = spare.id; opP.click(opP.$('plan-team-add'));
  await opP.until(() => opP.$('cell-' + d1.id + '-' + spare.id));
  opP.set('cell-' + d1.id + '-' + spare.id, '1000'); opP.input(opP.$('cell-' + d1.id + '-' + spare.id));
  opP.click(opP.$('plan-validate'));
  await opP.until(() => c.repoList('BudgetLine').some((l) => l.deliverable_id === d1.id && l.team_id === spare.id && Number(l.planned_amount) === 1000));
  check(true, 'une part dans la colonne ajoutée : 1 000 € de 3xx sur le livrable 2027 A');
  // livrables sans exercice : rattachement groupé à l'exercice de l'onglet
  await opP.until(() => opP.$('assign-open'));
  check(/\(1\)/.test(opP.text('assign-open')) && /2027/.test(opP.text('assign-open')), 'un livrable sans exercice : bouton de rattachement à 2027 : ' + opP.text('assign-open'));
  opP.click(opP.$('assign-open'));
  await opP.until(() => opP.$('genform').open);
  opP.submitGf();
  await opP.until(() => c.repoGet('PlanItem', orphan.id).exercise_id === prep.id);
  check(true, 'rattaché à l’exercice 2027');
  // lecture seule pour un Workpackage leader
  const wl2 = openPage(RWP);
  await wl2.until(() => wl2.$('track-table'));
  wl2.click(wl2.$('tab-op'));
  await wl2.until(() => wl2.$('plan-table') && wl2.$('exercise-table'));
  check(!wl2.doc.querySelector('[id^="dot-"]') && /Plan budgétaire/.test(wl2.text('zone-plan')), 'un Workpackage leader voit les dotations en lecture seule : aucun champ de dotation');
  const mm2 = openPage(MEMBER);
  await wait(250);
  check(mm2.$('zone-plan').hidden && mm2.$('panel-plan').hidden && mm2.$('zone-track').hidden, 'un Contributor ne voit ni le plan ni le suivi par équipe');

  // ---------------------------------------------------------------- l'évolution depuis la baseline, à même le plan
  const nb = openPage(CP);
  await nb.until(() => nb.$('plan-table'));
  check(![...nb.doc.querySelectorAll('#plan-table th')].some((h) => /Depuis/.test(h.textContent)), 'sans baseline : pas de colonne d’évolution');
  w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Référence pour l’essai', label: 'B0' });
  w.call(CP, 'budget.cell.set', { deliverableId: e1.id, teamId: ex9.id, amount: 4500, exerciseId: exec.id });
  setDot(ex9, 6500, exec);
  const bl = openPage(CP);
  await bl.until(() => bl.$('plan-table') && bl.$('version-bar'));
  check(![...bl.doc.querySelectorAll('#plan-table th')].some((h) => /Depuis/.test(h.textContent)), 'baseline figée mais pas encore validée : pas de comparaison (le suivi lit la version de référence, il n’y en a pas encore)');

  // ---------------------------------------------------------------- les versions du plan (suivi)
  const DPL = 'dora@entreprise.com';
  const vp = openPage(CP);
  await vp.until(() => vp.$('version-bar') && vp.$('plan-table'));
  check(/P1_0/.test(vp.text('ver-pending')) && /en attente de validation/.test(vp.text('ver-pending')) && /Dora/.test(vp.text('ver-pending')) && /pas prise en compte dans le suivi/.test(vp.text('ver-pending')), 'la baseline P1_0 est en attente : la page le dit, nomme Dora, et précise qu’elle n’est pas prise en compte dans le suivi : ' + vp.text('ver-pending'));
  const p0 = c.repoList('Baseline').find((b) => b.label === 'P1_0');
  check(!vp.$('vt-ref') && vp.$('vt-live').getAttribute('aria-selected') === 'true' && /à valider/.test(vp.text('vt-' + p0.id)) && vp.$('vt-' + p0.id).classList.contains('pending') && !!vp.$('version-new'), 'onglets : « Version en cours » (aucune version validée : le suivi la lit) et la version P1_0 à valider');
  check(!!vp.doc.querySelector('#plan-table input.env-input'), 'tant que rien n’est validé, le plan du suivi reste modifiable (c’est la version en cours)');
  // le DPL valide P1_0 ; la saisie change ensuite ; le suivi lit toujours P1_0
  const ackIds = w.call(DPL, 'changes.feed', { projectId: w.p1.id }).items.filter((x) => x.table === 'Baseline' && x.entity_id === p0.id).map((x) => x.id);
  w.call(DPL, 'changes.ack', { ids: ackIds });
  const bl2 = openPage(CP);
  await bl2.until(() => bl2.$('plan-table') && bl2.$('version-bar'));
  await bl2.until(() => bl2.$('vt-live'));
  bl2.click(bl2.$('vt-live'));
  await bl2.until(() => [...bl2.doc.querySelectorAll('#plan-table th')].some((h) => /Depuis P1_0/.test(h.textContent)));
  check(true, 'baseline validée : la version en cours se compare à elle, colonne « Depuis P1_0 »');
  const rowE1 = bl2.doc.querySelector('#plan-table tr[data-item="' + e1.id + '"]'), rowE2 = bl2.doc.querySelector('#plan-table tr[data-item="' + e2.id + '"]');
  check(/\+500 €/.test(flat(rowE1.cells[rowE1.cells.length - 1].textContent)) && /=/.test(rowE2.cells[rowE2.cells.length - 1].textContent), 'un livrable dont la part a augmenté de 500 € : « +500 € » ; un inchangé : « = »');
  const rowD9 = bl2.doc.querySelector('#exercise-table tr[data-team="' + ex9.id + '"]');
  check(/6 000 €/.test(flat(rowD9.cells[rowD9.cells.length - 1].textContent)) && /\+500 €/.test(flat(rowD9.cells[rowD9.cells.length - 1].textContent)), 'la dotation à la baseline (6 000 €) et son évolution (+500 €) : ' + flat(rowD9.cells[rowD9.cells.length - 1].textContent));
  // totaux en direct vs baseline : un brouillon change le delta avant « Valider »
  bl2.set('cell-' + e2.id + '-' + ex9.id, '1234'); bl2.input(bl2.$('cell-' + e2.id + '-' + ex9.id));
  check(/\+/.test(flat(rowE2.cells[rowE2.cells.length - 1].textContent)) || /−/.test(flat(rowE2.cells[rowE2.cells.length - 1].textContent)), 'l’écart à la baseline suit la saisie en direct');
  const planRef = serverTracking().totals.plan;
  w.call(CP, 'budget.cell.set', { deliverableId: e2.id, teamId: ex9.id, amount: 9999, exerciseId: exec.id });
  const vq = openPage(CP);
  await vq.until(() => vq.$('vt-ref') && vq.$('plan-table') && vq.$('track-table'));
  check(/Suivi · P1_0/.test(vq.text('vt-ref')) && vq.$('vt-ref').getAttribute('aria-selected') === 'true' && vq.$('vt-ref').classList.contains('ref') && /lue par le suivi/.test(vq.text('vt-ref')), 'P1_0 validée : l’onglet « Suivi · P1_0 » ✓ est sélectionné : c’est la version lue par le suivi');
  check(!vq.doc.querySelector('#plan-table input.env-input') && /lecture seule/.test(vq.text('ver-frozen')) && !vq.$('plan-validate') && /Version figée/.test(vq.text('plan-readonly')), 'la version figée est en lecture seule : aucun champ, pas de « Valider » : ' + vq.text('ver-frozen'));
  check(!/9 999/.test(vq.text('plan-table')) && !/9 999/.test(vq.text('track-table')), 'elle montre ce qui a été figé, pas la saisie d’aujourd’hui (9 999 €)');
  check(norm(vq.text('track-cards')).includes(fmt(planRef)) && planRef < 9999 + 4500, 'le suivi par équipe lit la version de référence : plan ' + fmt(planRef));
  vq.click(vq.$('vt-live'));
  await vq.until(() => vq.doc.querySelector('#plan-table input.env-input') && vq.$('ver-live'));
  check(vq.$('cell-' + e2.id + '-' + ex9.id).value === '9999' && /pas prises en compte dans le suivi/.test(vq.text('ver-live')) && !!vq.$('plan-validate'), 'la version en cours montre la saisie (9 999 €), modifiable ; elle précise que ces modifications ne sont pas prises en compte dans le suivi tant qu’une version figée qui les contient n’est pas validée');
  check(norm(vq.text('track-cards')).includes(fmt(planRef)), 'le suivi reste sur la version de référence pendant qu’on lit la version en cours');
  // figer une nouvelle version
  vq.click(vq.$('version-new'));
  await vq.until(() => vq.$('genform').open && vq.$('gf-reason'));
  vq.submitGf();
  await vq.until(() => !vq.$('gf-error').hidden);
  check(/justification est obligatoire|motif/i.test(vq.text('gf-error')), 'sans motif : refusé : ' + vq.text('gf-error'));
  vq.set('gf-reason', 'Plan revu après la revue de décembre'); vq.submitGf();
  await vq.until(() => c.repoList('Baseline').some((b) => b.label === 'P1_1'));
  await vq.until(() => vq.$('ver-pending') && /P1_1/.test(vq.text('ver-pending')));
  const p1 = c.repoList('Baseline').find((b) => b.label === 'P1_1');
  check(/Suivi · P1_0/.test(vq.text('vt-ref')) && /à valider/.test(vq.text('vt-' + p1.id)), 'la nouvelle version P1_1 apparaît en attente ; le suivi continue de lire P1_0');
  vq.click(vq.$('vt-' + p1.id));
  await vq.until(() => vq.$('ver-frozen') && /P1_1/.test(vq.text('ver-frozen')));
  check(/P1_1/.test(vq.text('ver-frozen')) && !/version lue par le suivi/.test(vq.text('ver-frozen')) && /9 999/.test(vq.text('plan-table')), 'l’onglet de P1_1 : lecture seule, avec le plan figé (9 999 €), et ce n’est pas la version lue par le suivi');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Budget : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
