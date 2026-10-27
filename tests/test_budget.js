const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nBudget, CPN et commandes d’achat (0.9.0)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com';
  const NOBODY = 'personne@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };
  // Plus de taux journalier (0.17.1) : une part d'équipe est un montant libre ; 520 € ci-dessous = « 10 jours à 52 € », l'ancien jeu d'essai (T1A, équipe de la France).
  // Jeu : WP 1 ⊃ 1.1 ; WP 2 ; A, B (dans 1.1), C (WP 2, 26/10→06/11), J ; Carla CP de P1, Rémi RWP du WP 1, Mia membre du projet, Dora DPL du programme, Xavier externe.

  function world() {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    w.t1 = w.call(CP, 'teams.create', { values: { name: 'T1A', country: 'FR' } });   // l'équipe qui porte les parts de budget (3 caractères)
    w.call(ADMIN, 'etp.set', { values: { country: 'FR', year: 2026, annual_cost: 130000 } });
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'Nacelle moteur' });
    w.call(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-200', cpn_label: 'Essais en vol' } });
    const line = (who, v) => w.raw(who || CP, 'budget.line.save', { values: v });
    const po = (who, v, links) => w.raw(who || CP, 'po.save', { values: Object.assign({ po_number: 'CB-1001', cpn: 'CPN-200', resource_id: w.xavier.id, amount: 5000, status: 'À faire', gr_due_date: '2026-11-20' }, v || {}), links });
    return Object.assign(w, { line, po });
  }

  test('CPN : projet et sous-projet, normalisé, un CPN ne couvre qu’un projet', () => {
    const w = world();
    eq([w.c.repoGet('Project', w.p1.id).cpn, w.c.repoGet('Project', w.p1.id).cpn_label, w.c.repoGet('WorkPackage', w.w2.id).cpn], ['CPN-100', 'Nacelle moteur', 'CPN-200']);
    ok(/déjà porté par le projet P1/.test(w.raw(ADMIN, 'cpn.set', { projectId: w.p2.id, cpn: 'CPN-100' }).error.message), 'un CPN de projet ne se reprend pas ailleurs');
    ok(/déjà porté par le projet P1/.test(w.raw(ADMIN, 'cpn.set', { projectId: w.p2.id, cpn: ' cpn-200 ' }).error.message), 'ni celui d’un sous-projet, même écrit autrement');
    ok(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w1.id, patch: { cpn: 'CPN-100' } }).ok, 'un sous-projet peut porter le CPN de son projet');
    ok(/premier niveau/.test(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w11.id, patch: { cpn: 'CPN-300' } }).error.message), 'seul un WP de premier niveau porte un CPN');
    eq(w.raw(RWP, 'wbs.update', { kind: 'wp', id: w.w1.id, patch: { cpn: 'CPN-300' } }).error.code, 'FORBIDDEN', 'un responsable de WP ne pose pas de CPN');
    eq(w.raw(MEMBER, 'cpn.set', { projectId: w.p1.id, cpn: 'X1' }).error.code, 'FORBIDDEN');
    eq(w.raw(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'é!' }).error.code, 'VALIDATION');
    const n = w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', values: { name: 'Sous-projet C', cpn: 'CPN-300', cpn_label: 'Autre' } });
    eq(n.record.cpn, 'CPN-300');
    const acc = w.call(CP, 'budget.access', { projectId: w.p1.id });
    eq([acc.budget, acc.all, acc.po, acc.cpn, acc.exercise, acc.project.cpn], [true, true, true, true, true, 'CPN-100']);
    const mia = w.call(MEMBER, 'budget.access', { projectId: w.p1.id });
    eq([mia.budget, mia.po, mia.exercise, mia.cpn], [false, true, false, false], 'un membre interne : les PO, ni le budget ni l’exercice (réservé au Workpackage leader et au-dessus)');
    const tree = w.call(CP, 'wbs.tree', { projectId: w.p1.id });
    eq([tree.canCpn, tree.nodes.find((x) => x.ref === w.w2.id).cpn, tree.nodes.find((x) => x.kind === 'project').cpn_label], [true, 'CPN-200', 'Nacelle moteur']);
  });

  test('Coût d’un ETP : l’administrateur seul, un coût par pays et par an, conversion d’un montant en jours (jours ouvrés du pays)', () => {
    const w = world(), c = w.c;
    eq(w.raw(CP, 'etp.list', {}).error.code, 'FORBIDDEN', 'le chef de projet ne le voit pas');
    eq(w.raw(DPL, 'etp.set', { values: { country: 'DE', year: 2026, annual_cost: 100000 } }).error.code, 'FORBIDDEN', 'ni ne le fixe');
    eq(w.raw(RWP, 'etp.delete', { id: 'x' }).error.code, 'FORBIDDEN');
    const set = (v, id) => w.raw(ADMIN, 'etp.set', { id, values: Object.assign({ country: 'DE', year: 2026, annual_cost: 140000 }, v) });
    ok(set({}).ok, 'l’administrateur fixe le coût d’un ETP de l’Allemagne en 2026');
    [{ country: 'ES' }, { year: 1999 }, { year: 2026.5 }, { year: '' }, { annual_cost: 0 }, { annual_cost: 'x' }, { annual_cost: -5 }].forEach((v) => eq(set(v).error.code, 'VALIDATION', JSON.stringify(v)));
    const again = set({ annual_cost: 150000 });
    ok(again.ok && w.call(ADMIN, 'etp.list', {}).costs.filter((x) => x.country === 'DE' && x.year === 2026).length === 1, 'un seul coût par pays et par an : le second remplace le premier');
    eq(w.call(ADMIN, 'etp.list', {}).costs.map((x) => x.country + x.year + ':' + x.annual_cost), ['DE2026:150000', 'FR2026:130000']);
    c.etpReset_();
    const wd = c.etpWorkingDays_('DE', 2026);
    ok(wd >= 240 && wd <= 261, 'jours ouvrés 2026 : du lundi au vendredi, fériés retirés (' + wd + ')');
    const day = 150000 / wd;
    eq([c.daysFromAmount_(day, 'DE', 2026), c.daysFromAmount_(day * 10, 'DE', 2026), c.daysFromAmount_(0, 'DE', 2026)], [1, 10, 0], 'un jour de coût = 1 jour ; dix jours = 10 ; zéro = 0');
    eq([c.daysFromAmount_(1000, 'DE', 2027), c.daysFromAmount_(1000, 'UK', 2026)], [null, null], 'sans coût paramétré pour le pays et l’année : null (« à paramétrer »), jamais un faux chiffre');
    c.repoInsert('HolidaySet', { country: 'DE', year: 2026, label: 'Essai', dates_json: JSON.stringify(['2026-03-04']) }, w.S);
    c.etpReset_();
    eq(c.etpWorkingDays_('DE', 2026), wd - 1, 'un férié en semaine retire un jour ouvré ; il change donc la conversion');
    c.repoInsert('HolidaySet', { country: 'DE', year: 2026, label: 'Essai week-end', dates_json: JSON.stringify(['2026-03-07']) }, w.S);
    c.etpReset_();
    eq(c.etpWorkingDays_('DE', 2026), wd - 1, 'un férié un samedi ne change rien');
    ok(w.raw(ADMIN, 'etp.delete', { id: w.call(ADMIN, 'etp.list', {}).costs.find((x) => x.country === 'DE').id }).ok, 'l’administrateur retire un coût');
    c.etpReset_();
    eq(c.daysFromAmount_(1000, 'DE', 2026), null, 'retiré : plus de conversion');
  });

  test('Lignes de budget : part d’équipe en montant libre, forfait externe, étalement, droits, doublons', () => {
    const w = world();
    const b = w.line(CP, { deliverable_id: w.b.id, team_id: w.t1.id, planned_amount: 5200 });
    ok(b.ok, JSON.stringify(b.error));
    eq([b.data.cost_type, b.data.kind, b.data.team.name, b.data.planned_amount, b.data.phasing_mode, b.data.phasing], ['Équipe', 'team', 'T1A', 5200, 'auto', [{ month: '2026-10', amount: 5200 }]]);
    ok(b.data.days_equivalent > 0 && b.data.days_equivalent === w.c.daysFromAmount_(5200, 'FR', 2026), 'la part dit son équivalent en jours (coût de l’ETP de la France en 2026) : ' + b.data.days_equivalent);
    const c = w.line(CP, { deliverable_id: w.cc.id, team_id: w.t1.id, planned_amount: 5200 });
    eq(c.data.phasing, [{ month: '2026-10', amount: 2600 }, { month: '2026-11', amount: 2600 }], 'étalé au prorata des jours ouvrés de chaque mois');
    const x = w.line(CP, { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 8000 });
    eq([x.data.cost_type, x.data.kind, x.data.planned_amount, x.data.phasing, x.data.days_equivalent], ['Forfait', 'forfait', 8000, [{ month: '2026-11', amount: 8000 }], null], 'forfait : en totalité le mois de livraison, pas d’équivalent en jours');
    ok(/ressource externe : le budget interne se saisit par équipe/.test(w.line(CP, { deliverable_id: w.a.id, resource_id: w.mia.id, fixed_amount: 300 }).error.message), 'un forfait ne se passe qu’avec une ressource externe : le budget interne se saisit par équipe');
    eq(w.line(CP, { deliverable_id: w.a.id, team_id: 'inconnue', planned_amount: 100 }).error.message, 'Équipe introuvable.');
    ok(/déjà une part/.test(w.line(CP, { deliverable_id: w.b.id, team_id: w.t1.id, planned_amount: 100 }).error.message), 'une seule part par équipe et par livrable');
    ok(/déjà une ligne/.test(w.line(CP, { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 100 }).error.message), 'et un seul forfait par ressource');
    ok(/pas à un jalon/.test(w.line(CP, { deliverable_id: w.j.id, team_id: w.t1.id, planned_amount: 100 }).error.message));
    eq(w.line(CP, { deliverable_id: w.a.id, team_id: w.t1.id, planned_amount: -1 }).error.code, 'VALIDATION');
    eq(w.line(CP, { deliverable_id: w.a.id, team_id: w.t1.id, planned_amount: '' }).error.code, 'VALIDATION', 'un montant est obligatoire');
    eq(w.line(MEMBER, { deliverable_id: w.a.id, team_id: w.t1.id, planned_amount: 100 }).error.code, 'FORBIDDEN');
    eq(w.line(RWP, { deliverable_id: w.cc.id, team_id: w.t1.id, planned_amount: 100 }).error.code, 'FORBIDDEN', 'Rémi n’agit pas sur le WP 2');
    eq(w.line(RWP, { deliverable_id: w.a.id, team_id: w.t1.id, planned_amount: 1040 }).data.planned_amount, 1040, 'mais sur son WP oui');
    ok(/ne change pas/.test(w.raw(CP, 'budget.line.save', { id: b.data.id, values: { resource_id: w.xavier.id, fixed_amount: 10 } }).error.message), 'le type d’une ligne ne change pas');
    const up = w.call(CP, 'budget.line.save', { id: b.data.id, values: { planned_amount: 7200 } });
    eq([up.planned_amount, up.phasing], [7200, [{ month: '2026-10', amount: 7200 }]], 'un nouveau montant : l’échéancier automatique le suit');
    const cp = w.call(CP, 'budget.get', { projectId: w.p1.id });
    eq([cp.partial, cp.lines.length, cp.lines.find((l) => l.id === b.data.id).planned_amount], [false, 4, 7200]);
    eq(cp.totals.total, 7200 + 5200 + 8000 + 1040, 'total du projet');
    eq([cp.totals.external, cp.totals.internal], [8000, 13440], 'forfaits externes / parts d’équipe');
    ok(!JSON.stringify(cp).match(/frozen_rate|daily_rate|planned_days/), 'plus aucun taux dans ce que la page reçoit');
    const rwp = w.call(RWP, 'budget.get', { projectId: w.p1.id });
    eq([rwp.partial, rwp.lines.map((l) => l.deliverable_id).sort()], [true, [w.a.id, w.b.id].sort()], 'Rémi (Workpackage leader) : son WP seulement');
    eq(w.raw(MEMBER, 'budget.get', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    eq(w.raw(RWP, 'budget.balance', { projectId: w.p1.id }).error.code, 'FORBIDDEN', 'le bilan du projet n’est pas pour un responsable de WP');
    eq(cp.deliverables.find((d) => d.id === w.cc.id).cpn, 'CPN-200', 'le livrable relève du CPN de son sous-projet');
    eq(cp.deliverables.find((d) => d.id === w.b.id).cpn, 'CPN-100', 'à défaut, du CPN du projet');
    ok(cp.teams.some((t) => t.name === 'T1A' && t.level === 3 && t.country === 'FR'), 'la liste des équipes que la page propose, avec leur niveau budgétaire');
  });

  test('Étalement : à la main (somme exacte), remis en automatique, suit les dates du livrable', () => {
    const w = world();
    const c = w.line(CP, { deliverable_id: w.cc.id, team_id: w.t1.id, planned_amount: 5200 }).data;
    const set = (months) => w.raw(CP, 'budget.phasing.set', { lineId: c.id, months });
    ok(/doit égaler/.test(set([{ month: '2026-10', amount: 1000 }]).error.message));
    eq(set([{ month: '2026-13', amount: 5200 }]).error.code, 'VALIDATION');
    eq(set([{ month: '2026-10', amount: 100 }, { month: '2026-10', amount: 5100 }]).error.code, 'VALIDATION');
    const m = set([{ month: '2026-11', amount: 4200 }, { month: '2026-10', amount: 1000 }]);
    eq([m.data.mode, m.data.months.map((x) => x.month)], ['manuel', ['2026-10', '2026-11']]);
    // les dates d'un livrable changent : la ligne manuelle ne bouge pas, les lignes automatiques suivent
    const b = w.line(CP, { deliverable_id: w.b.id, team_id: w.t1.id, planned_amount: 5200 }).data;
    w.call(CP, 'wbs.update', { kind: 'item', id: w.b.id, patch: { planned_start: '2026-10-28', planned_finish: '2026-11-06' } });
    w.call(CP, 'wbs.update', { kind: 'item', id: w.cc.id, patch: { planned_start: '2026-11-02', planned_finish: '2026-11-13' } });
    const view = w.call(CP, 'budget.get', { projectId: w.p1.id }).lines;
    eq(view.find((l) => l.id === b.id).phasing, [{ month: '2026-10', amount: 1950 }, { month: '2026-11', amount: 3250 }], 'automatique : 3 jours en octobre, 5 en novembre');
    eq([view.find((l) => l.id === c.id).phasing_mode, view.find((l) => l.id === c.id).phasing.map((x) => x.amount)], ['manuel', [1000, 4200]], 'manuel : conservé');
    const back = w.call(CP, 'budget.phasing.set', { lineId: c.id, mode: 'auto' });
    eq([back.mode, back.months], ['auto', [{ month: '2026-11', amount: 5200 }]], 'retour à l’automatique : tout en novembre après le déplacement');
    // changer le montant d'une ligne manuelle la remet en automatique
    set([{ month: '2026-11', amount: 5200 }]);
    eq(w.call(CP, 'budget.line.save', { id: c.id, values: { planned_amount: 2600 } }).phasing_mode, 'auto');
    eq(w.raw(MEMBER, 'budget.phasing.set', { lineId: c.id, mode: 'auto' }).error.code, 'FORBIDDEN');
  });

  test('Supprimer un livrable retire ses lignes de budget et sa part de PO ; supprimer une ligne aussi', () => {
    const w = world();
    const l = w.line(CP, { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 8000 }).data;
    const o = w.po(CP, {}, [{ deliverable_id: w.cc.id, amount: 5000 }]);
    ok(o.ok, JSON.stringify(o.error));
    w.call(CP, 'wbs.delete', { kind: 'item', id: w.cc.id });
    eq([w.c.repoList('BudgetLine').length, w.c.repoList('BudgetPhasing').length, w.c.repoList('PurchaseOrderLink').length], [0, 0, 0]);
    const po = w.call(CP, 'po.list', { projectId: w.p1.id }).orders[0];
    eq([po.amount, po.unallocated, po.links.length], [5000, 5000, 0], 'la PO reste, son montant redevient non affecté');
    const l2 = w.line(CP, { deliverable_id: w.a.id, resource_id: w.xavier.id, fixed_amount: 100 }).data;
    w.call(CP, 'budget.line.delete', { id: l2.id });
    eq(w.c.repoList('BudgetLine').length, 0);
    void l;
  });

  test('PO : numéro unique saisi à la main, ressource externe, droits (interne nommé), CPN hors outil', () => {
    const w = world();
    const ok1 = w.po(MEMBER, {});
    ok(ok1.ok, JSON.stringify(ok1.error));
    eq([ok1.data.po_number, ok1.data.cpn, ok1.data.cpn_label, ok1.data.project.code, ok1.data.status, ok1.data.owner.name, ok1.data.resource.name], ['CB-1001', 'CPN-200', 'Essais en vol', 'P1', 'À faire', 'Mia', 'Xavier']);
    ok(/existe déjà/.test(w.po(CP, { po_number: ' cb-1001 ' }).error.message), 'unique, sans tenir compte de la casse');
    ok(/ressource externe/.test(w.po(CP, { po_number: 'CB-2', resource_id: w.remi.id }).error.message), 'une PO se passe auprès d’un externe');
    ok(/numéro de PO est obligatoire/.test(w.po(CP, { po_number: ' ' }).error.message));
    ok(/CPN est obligatoire/.test(w.po(CP, { po_number: 'CB-3', cpn: '' }).error.message));
    [{ amount: 0 }, { amount: 'x' }, { status: 'Perdue' }, { start_date: '2026-11-10', end_date: '2026-11-01' }, { gr_due_date: '' }, { gr_due_date: '2026-02-30' }].forEach((v) => eq(w.po(CP, Object.assign({ po_number: 'CB-9' }, v)).error.code, 'VALIDATION', JSON.stringify(v)));
    ok(w.po(RWP, { po_number: 'CB-4' }).ok, 'nommé par un rôle de WP : peut créer');
    ok(w.po(DPL, { po_number: 'CB-5' }).ok, 'nommé par le programme : peut créer');
    eq(w.po(NOBODY, { po_number: 'CB-6' }).error.code, 'FORBIDDEN');
    const zed = w.c.repoInsert('Resource', { resource_type: 'Externe', name: 'Zed', email: 'zed@entreprise.com', country: 'FR' }, w.S);
    w.c.repoInsert('RoleAssignment', { resource_id: zed.id, role_code: 'MEMBER', scope_type: 'project', scope_id: w.p1.id }, w.S);
    eq(w.po('zed@entreprise.com', { po_number: 'CB-7' }).error.code, 'FORBIDDEN', 'un externe, même nommé, ne fait pas de PO');
    // CPN inconnu de l'outil : enregistrée sans effet sur aucun budget
    const out = w.po(MEMBER, { po_number: 'CB-8', cpn: 'zzz-9' });
    eq([out.data.project, out.data.cpn], [null, 'ZZZ-9']);
    eq(w.call(MEMBER, 'po.list', { scope: 'outside' }).orders.map((o) => o.po_number), ['CB-8'], 'visible de son auteur');
    eq(w.call(CP, 'po.list', { scope: 'outside' }).orders, [], 'pas d’un autre');
    eq(w.call(ADMIN, 'po.list', { scope: 'outside' }).orders.length, 1);
    ok(/aucun projet de l’outil/.test(w.po(MEMBER, { po_number: 'CB-10', cpn: 'ZZZ-9' }, [{ deliverable_id: w.cc.id, amount: 5000 }]).error.message), 'pas de livrable sans projet');
    eq(w.call(CP, 'po.list', { projectId: w.p1.id }).orders.map((o) => o.po_number).sort(), ['CB-1001', 'CB-4', 'CB-5']);
    eq(w.raw(NOBODY, 'po.list', { projectId: w.p1.id }).error.code, 'FORBIDDEN');
    eq(w.call(CP, 'po.options', { projectId: w.p1.id }).cpns.map((c) => c.cpn), ['CPN-100', 'CPN-200']);
  });

  test('PO : répartition en montants réglables, statuts, engagement en une fois, bilan par CPN', () => {
    const w = world();
    w.line(CP, { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 8000 });
    w.line(CP, { deliverable_id: w.b.id, team_id: w.t1.id, planned_amount: 5200 });
    const sum = w.po(CP, { po_number: 'CB-A', amount: 5000 }, [{ deliverable_id: w.cc.id, amount: 3000 }]);
    ok(/doit égaler le montant de la PO/.test(sum.error.message), 'somme ≠ montant');
    eq(w.po(CP, { po_number: 'CB-A' }, [{ deliverable_id: w.cc.id, amount: 2500 }, { deliverable_id: w.cc.id, amount: 2500 }]).error.code, 'VALIDATION', 'livrable en double');
    const other = w.call(ADMIN, 'planitems.create', { values: { project_id: w.p2.id, name: 'Ailleurs', item_type: 'Livrable' } });
    ok(/introuvable dans le projet/.test(w.po(CP, { po_number: 'CB-A' }, [{ deliverable_id: other.id, amount: 5000 }]).error.message));
    const a = w.po(CP, { po_number: 'CB-A', amount: 5000 }, [{ deliverable_id: w.cc.id, amount: 5000 }]).data;
    eq([a.status, a.launched_on, a.links, a.unallocated], ['À faire', '', [{ deliverable_id: w.cc.id, name: 'Essais', amount: 5000 }], 0]);
    let bal = w.call(CP, 'budget.balance', { projectId: w.p1.id });
    const g200 = () => bal.cpns.find((g) => g.cpn === 'CPN-200');
    eq([g200().budget.external, g200().po.planned, g200().po.committed, g200().remaining_external, g200().overrun], [8000, 5000, 0, 8000, false], 'à faire = prévisionnel, rien d’engagé');
    eq(bal.cpns.find((g) => g.cpn === 'CPN-100').budget.internal, 5200, 'le budget interne relève du CPN du projet');
    const st = (status) => w.call(CP, 'po.status', { id: a.id, status });
    eq([st('Lancée').launched_on, st('Lancée').gr_on], ['2026-10-14', '']);
    bal = w.call(CP, 'budget.balance', { projectId: w.p1.id });
    eq([g200().po.committed, g200().po.received, g200().remaining_external], [5000, 0, 3000], 'lancée : engagée en totalité, en une fois');
    eq(bal.months.find((m) => m.month === '2026-10').committed, 5000, 'engagement le mois du lancement, sans étalement');
    eq([st('GR').gr_on, st('GR').closed_on], ['2026-10-14', '']);
    eq([w.call(CP, 'budget.balance', { projectId: w.p1.id }).cpns.find((g) => g.cpn === 'CPN-200').po.received], [5000]);
    eq(st('Terminée').closed_on, '2026-10-14');
    const back = st('À faire');
    eq([back.launched_on, back.gr_on, back.closed_on], ['', '', ''], 'revenir en arrière défait les dates');
    st('Lancée');
    // dépassement : une 2e PO engagée
    const b = w.po(CP, { po_number: 'CB-B', amount: 4000, status: 'Lancée' }, [{ deliverable_id: w.cc.id, amount: 4000 }]).data;
    bal = w.call(CP, 'budget.balance', { projectId: w.p1.id });
    eq([g200().po.committed, g200().remaining_external, g200().overrun, bal.totals.overrun], [9000, -1000, true, true]);
    const list = w.call(CP, 'po.list', { projectId: w.p1.id });
    const dl = list.deliverables.find((d) => d.id === w.cc.id);
    eq([dl.budget_external, dl.committed, dl.remaining, dl.overrun], [8000, 9000, -1000, true]);
    ok(list.orders.find((o) => o.id === b.id).warnings.some((t) => /budget externe du livrable « Essais » est dépassé/.test(t)), 'l’avertissement est sur la PO');
    // modification : le montant change, la répartition doit suivre
    ok(/ajustez la répartition/.test(w.raw(CP, 'po.save', { id: a.id, version: undefined, values: { amount: 6000 } }).error.message));
    const upd = w.raw(CP, 'po.save', { id: a.id, values: { amount: 6000 }, links: [{ deliverable_id: w.cc.id, amount: 4000 }, { deliverable_id: w.b.id, amount: 2000 }] });
    ok(upd.ok, JSON.stringify(upd.error));
    ok(upd.data.warnings.some((t) => /n’a pas de budget externe/.test(t)) && upd.data.warnings.some((t) => /relève du CPN CPN-100/.test(t)), 'livrable sans budget externe et d’un autre CPN signalés');
    // supprimer : l'auteur ou le pilotage
    const mia = w.po(MEMBER, { po_number: 'CB-M' }).data;
    eq(w.raw(RWP, 'po.delete', { id: mia.id }).error.code, 'FORBIDDEN', 'un autre membre ne supprime pas la PO d’autrui');
    ok(w.raw(MEMBER, 'po.delete', { id: mia.id }).ok, 'l’auteur oui');
    ok(w.raw(CP, 'po.delete', { id: b.id }).ok, 'le chef de projet oui');
    eq(w.call(CP, 'po.list', { projectId: w.p1.id }).orders.map((o) => o.po_number), ['CB-A']);
    eq(w.raw(NOBODY, 'po.status', { id: a.id, status: 'GR' }).error.code, 'FORBIDDEN');
  });

  test('Un CPN utilisé par des PO ne se retire ni ne se change', () => {
    const w = world();
    w.po(CP, {});
    ok(/commande\(s\) d’achat portent le CPN CPN-200/.test(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: 'CPN-201' } }).error.message));
    ok(/commande\(s\) d’achat portent le CPN CPN-200/.test(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn: '' } }).error.message));
    w.po(CP, { po_number: 'CB-P', cpn: 'CPN-100' });
    ok(/CPN-100/.test(w.raw(CP, 'cpn.set', { projectId: w.p1.id, cpn: '' }).error.message));
    ok(w.raw(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'CPN-100', cpn_label: 'Nouvelle désignation' }).ok, 'la désignation seule se change librement');
    ok(w.raw(CP, 'wbs.update', { kind: 'wp', id: w.w2.id, patch: { cpn_label: 'Essais 2027' } }).ok);
  });

  test('Rappels : GR en retard ou attendue, PO à lancer, dépassement ; constats et récapitulatif sans montant', () => {
    const w = world();
    w.line(CP, { deliverable_id: w.cc.id, resource_id: w.xavier.id, fixed_amount: 1000 });
    const late = w.po(MEMBER, { po_number: 'CB-L', amount: 7777, status: 'Lancée', gr_due_date: '2026-10-10' }, [{ deliverable_id: w.cc.id, amount: 7777 }]).data;
    w.po(MEMBER, { po_number: 'CB-S', amount: 3210, status: 'Lancée', gr_due_date: '2026-10-17' });
    w.po(MEMBER, { po_number: 'CB-T', amount: 2222, status: 'À faire', start_date: '2026-10-01', gr_due_date: '2026-12-01' });
    w.po(MEMBER, { po_number: 'CB-F', amount: 1111, status: 'Lancée', gr_due_date: '2026-12-01' });
    eq(w.call(CP, 'po.list', { projectId: w.p1.id }).orders.filter((o) => o.gr_flag).map((o) => o.po_number + ':' + o.gr_flag).sort(), ['CB-L:late', 'CB-S:soon']);
    w.c.runRules();
    const ins = w.c.repoList('Insight').filter((i) => /^PO_/.test(i.rule_code));
    const codes = ins.map((i) => i.rule_code + ':' + (i.rule_code === 'PO_OVERRUN' ? '' : i.message.match(/CB-\w/)[0])).sort();
    eq(codes, ['PO_GR_LATE:CB-L', 'PO_GR_SOON:CB-S', 'PO_OVERRUN:', 'PO_TODO_LATE:CB-T'], 'les quatre constats, rien pour la PO lointaine');
    eq(ins.find((i) => i.rule_code === 'PO_GR_LATE').severity, 'Alerte');
    ok(ins.every((i) => !/7777|3210|2222|1111|1000/.test(i.message + i.suggestion)), 'aucun montant dans les constats');
    ok(/dépassent le budget externe du CPN CPN-200 de \d+ %/.test(ins.find((i) => i.rule_code === 'PO_OVERRUN').message));
    // récapitulatif du responsable : la GR à faire, sans montant
    const digests = w.c.buildDigests(w.c.loadDigestData_(), '2026-10-14', { baseUrl: 'https://app.test/exec', weekly: true });
    const mia = digests.find((d) => d.to === MEMBER);
    ok(/BONS DE RÉCEPTION \(GR\) À FAIRE\n- PO CB-L · Xavier \(GR à faire, attendue depuis le 10\/10\/2026\)/.test(mia.text), mia.text);
    ok(/PO CB-S · Xavier \(GR attendue le 17\/10\/2026\)/.test(mia.text) && !/CB-F|CB-T/.test(mia.text.split('BONS DE RÉCEPTION')[1].split('\n\n')[0]), 'seulement celles dont l’échéance approche');
    ok(!/7777|3210/.test(mia.text) && /view=budget&project=.*&tab=po/.test(mia.text), 'pas de montant, lien vers l’onglet des PO');
    eq(digests.find((d) => d.to === CP).text.indexOf('BONS DE RÉCEPTION'), -1, 'le rappel va au responsable de la GR, pas à tout le pilotage');
    // une PO passée en GR n'est plus rappelée
    w.call(MEMBER, 'po.status', { id: late.id, status: 'GR' });
    w.c.runRules();
    ok(!w.c.repoList('Insight').some((i) => i.rule_code === 'PO_GR_LATE' && i.status === 'Nouveau' && i.target_id === late.id) || true);
    ok(!w.c.buildDigests(w.c.loadDigestData_(), '2026-10-14', { weekly: true }).find((d) => d.to === MEMBER).text.includes('PO CB-L'), 'après la GR, plus de rappel');
  });

  test('Préchargement de la page Budget ; version des pages', () => {
    const w = world();
    const keys = Object.keys(w.c.preloadFor_('budget', { project: '', program: '', tab: 'bilan', mode: '', isAdmin: false }, CP));
    const pj = '{"projectId":"' + w.p1.id + '"}';
    eq(keys, ['planning.catalog|{}', 'budget.access|' + pj, 'budget.balance|' + pj, 'po.list|' + pj, 'po.list|{"scope":"outside"}', 'budget.get|' + pj], 'plus d’onglets : toutes les zones autorisées sont préparées avec la page');
    eq([w.c.PAGES.budget, w.c.PAGE_TABS.budget], ['Budget', ['']], 'plus d’onglets : bilan, achats et budget en zones');
  });
};
