/**
 * Essai de la page Budget : bilan par CPN, commandes d'achat, lignes de budget, taux (jsdom, vrai Core).
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
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', NOBODY = 'personne@entreprise.com';
w.call(CP, 'people.setRate', { resourceId: w.remi.id, daily_rate: 520 });
w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nacelle moteur' });
w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-200', cpn_label: 'Essais en vol' } });
w.call(CP, 'budget.line.save', { values: { deliverable_id: w.b.id, resource_id: w.remi.id, planned_days: 10 } });
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
  const zones = () => ['bilan', 'po', 'budget'].filter((z) => { const n = doc.getElementById('zone-' + z); return n && !n.hidden && !doc.getElementById('panel-' + z).hidden; });
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
  check(JSON.stringify(p.zones()) === JSON.stringify(['bilan', 'po', 'budget']), 'le chef de projet voit les trois zones d’un coup, sans onglet : bilan, achats, budget');
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
  check(p.doc.querySelectorAll('#lines-table tbody tr').length === 2 && /Taux figé/.test(p.text('lines-table')) && /520/.test(p.text('lines-table')), 'lignes existantes, taux figé visible du chef de projet');
  check(/Livrables sans budget/.test(p.text('panel-budget')), 'livrables sans budget signalés');
  p.click(p.$('line-add'));
  await p.until(() => p.$('genform').open);
  p.set('gf-deliverable_id', w.a.id); p.set('gf-resource_id', w.remi.id); p.change(p.$('gf-resource_id'));
  check(p.$('gf-fixed_amount').parentNode.hidden && !p.$('gf-planned_days').parentNode.hidden, 'interne : jours seulement');
  p.set('gf-resource_id', w.xavier.id); p.change(p.$('gf-resource_id'));
  check(!p.$('gf-fixed_amount').parentNode.hidden && !p.$('gf-planned_days').parentNode.hidden, 'externe : forfait ou jours');
  p.set('gf-resource_id', w.mia.id); p.change(p.$('gf-resource_id')); p.set('gf-planned_days', '3'); p.submitGf();
  await p.until(() => !p.$('gf-error').hidden);
  check(/Aucun taux journalier pour « Mia »/.test(p.text('gf-error')), 'sans taux : message explicite : ' + p.text('gf-error'));
  p.set('gf-resource_id', w.remi.id); p.change(p.$('gf-resource_id')); p.set('gf-planned_days', '4'); p.submitGf();
  await p.until(() => c.repoList('BudgetLine').length === 3);
  const l3 = c.repoList('BudgetLine').find((l) => l.deliverable_id === w.a.id);
  check(l3.cost_type === 'TJM' && Number(l3.frozen_rate) === 520 && Number(l3.planned_amount) === 2080, 'ligne interne : 4 jours × 520 € = 2 080 €');
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
  check(JSON.stringify(r.zones()) === JSON.stringify(['po', 'budget']), 'un responsable de WP : achats et son budget : ' + r.zones().join(','));
  await r.until(() => r.$('lines-table') || r.$('line-add'));
  check(/Budget de votre périmètre/.test(r.text('panel-budget')) && !/Taux figé/.test(r.text('panel-budget')), 'budget limité à son périmètre, sans les taux');
  const n = openPage(NOBODY);
  await n.until(() => /Accès réservé/.test(n.text('panel-bilan')));
  check(n.zones().length === 0, 'sans nomination dans l’équipe : rien d’accessible');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPage Budget : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
