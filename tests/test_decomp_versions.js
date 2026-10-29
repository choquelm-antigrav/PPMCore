const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nVersions de la décomposition du budget : version en cours, versions figées par les baselines, version de référence du suivi (0.20.0)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com', WPL = 'remi@entreprise.com';

  /** Exercice 2026 en exécution ; budget autorisé 10 000, enveloppes WP 1 : 2 000 et WP 2 : 1 000 ; lignes : Spécification 800 et Calcul 500. Rien n'est figé. */
  function world() {
    const w = lot2World();
    const e0 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    const line = (item, amount) => w.call(CP, 'budget.line.save', { values: { deliverable_id: item.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: amount }, exerciseId: w.exec.id });
    w.l1 = line(w.a, 800); w.l2 = line(w.b, 500);
    w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, authorized: 10000, allocations: [{ wpId: w.w1.id, amount: 2000 }, { wpId: w.w2.id, amount: 1000 }] });
    w.env = (who, version) => w.call(who || CP, 'budget.envelope.get', { projectId: w.p1.id, version });
    w.freeze = (who) => w.call(who || CP, 'baselines.create', { projectId: w.p1.id, justification: 'Version du budget' });
    w.validate = (id) => { const ids = w.call(DPL, 'changes.feed', { projectId: w.p1.id }).items.filter((i) => i.table === 'Baseline' && i.entity_id === id).map((i) => i.id); return w.raw(DPL, 'changes.ack', { ids }); };
    // la saisie change après la figeage : une enveloppe, une ligne modifiée (+200), une ligne ajoutée (+1 500)
    w.change = () => {
      w.call(CP, 'budget.envelope.set', { projectId: w.p1.id, authorized: 12000, allocations: [{ wpId: w.w1.id, amount: 2500 }] });
      w.call(CP, 'budget.line.save', { id: w.l1.id, version: w.l1.version, values: { fixed_amount: 1000 } });
      w.call(CP, 'budget.line.save', { values: { deliverable_id: w.cc.id, resource_id: w.xavier.id, cost_type: 'Forfait', fixed_amount: 1500 }, exerciseId: w.exec.id });
    };
    return w;
  }
  const costOf = (v) => v.totals.cost, authOf = (v) => v.totals.authorized;

  test('Sans baseline validée, le suivi lit la version en cours, et la page le sait', () => {
    const w = world(), v = w.env(CP, 'ref');
    eq([v.version, v.fallback_live, v.reference_id, v.versions.length, costOf(v), v.can_edit], [null, true, '', 0, 1300, true], 'aucune baseline : la référence du suivi est la version en cours (rien à attendre), signalée par fallback_live');
    w.freeze();
    const v1 = w.env(CP, 'ref');
    eq([v1.fallback_live, v1.reference_id, v1.versions.map((x) => x.label + ':' + x.validation), v1.pending_version.label, v1.pending_version.validators], [true, '', ['P1_0:pending'], 'P1_0', ['Dora']], 'une première baseline en attente de validation n’est pas prise en compte : le suivi suit encore la version en cours ; la page sait qui doit valider');
  });

  test('Une version validée est la référence du suivi : elle montre ce qui a été figé, pas la saisie en cours', () => {
    const w = world(), b0 = w.freeze();
    ok(w.validate(b0.id).ok, 'le DPL valide la version P1_0');
    w.change();
    const live = w.env(CP, 'live'), ref = w.env(CP, 'ref');
    eq([live.can_edit, live.version, authOf(live), costOf(live)], [true, null, 12000, 3000], 'la version en cours : modifiable, avec la saisie d’aujourd’hui');
    eq([ref.version.label, ref.fallback_live, ref.reference_id === b0.id, ref.versions[0].is_reference, ref.can_edit, authOf(ref), costOf(ref)], ['P1_0', false, true, true, false, 10000, 1300], 'la version de référence : P1_0, en lecture seule, avec les montants figés (10 000 € autorisés, 1 300 € de coût), pas ceux de la saisie');
    const wp1 = (v) => v.rows.find((r) => r.wp_id === w.w1.id);
    eq([wp1(ref).allocated, wp1(ref).canSet, wp1(live).allocated, wp1(live).canSet], [2000, false, 2500, true], 'l’enveloppe de WP 1 : 2 000 € figée (non modifiable) contre 2 500 € en cours (modifiable)');
    ok(ref.items.every((x) => x.canEdit === false) && ref.unassigned.length === 0, 'aucun coût ne se modifie dans une version figée, et rien n’y est à rattacher');
    eq(ref.items.find((x) => x.name === 'Spécification').cost, 800, 'le coût d’un livrable : celui du jour de la figeage (800 €, pas 1 000 €)');
  });

  test('Tant que la nouvelle version n’est pas validée, le suivi continue de lire la précédente ; une fois validée, il la lit', () => {
    const w = world(), b0 = w.freeze(); w.validate(b0.id);
    w.change();
    const b1 = w.freeze();                                                       // la version P1_1 fige la saisie modifiée
    let ref = w.env(CP, 'ref');
    eq([ref.version.label, costOf(ref), authOf(ref), ref.pending_version.label, ref.pending_version.validators, ref.versions.map((v) => v.label + ':' + v.validation + (v.is_reference ? '*' : ''))], ['P1_0', 1300, 10000, 'P1_1', ['Dora'], ['P1_0:validated*', 'P1_1:pending']], 'P1_1 est en attente de Dora : le suivi lit P1_0 (1 300 €, 10 000 €) ; la page nomme la version en attente et son validateur');
    ok(w.validate(b1.id).ok, 'Dora valide P1_1');
    ref = w.env(CP, 'ref');
    eq([ref.version.label, costOf(ref), authOf(ref), ref.pending_version, ref.versions.map((v) => v.label + (v.is_reference ? '*' : ''))], ['P1_1', 3000, 12000, null, ['P1_0', 'P1_1*']], 'validée : le suivi lit P1_1 (3 000 €, 12 000 €), plus rien n’est en attente');
  });

  test('Une version figée par l’administrateur n’a personne à attendre ; une version se consulte par son identifiant', () => {
    const w = world(), b0 = w.freeze(ADMIN);
    const r = w.env(CP, 'ref');
    eq([r.versions[0].validation, r.version.label, r.reference_id === b0.id], ['', 'P1_0', true], 'figée au niveau le plus haut : validée d’emblée, c’est la référence');
    w.change(); const b1 = w.freeze(ADMIN);
    const old = w.env(CP, b0.id), cur = w.env(CP, b1.id);
    eq([old.version.label, costOf(old), cur.version.label, costOf(cur)], ['P1_0', 1300, 'P1_1', 3000], 'chaque version se consulte par son identifiant : P1_0 (archivée) et P1_1');
    eq(w.raw(CP, 'budget.envelope.get', { projectId: w.p1.id, version: 'inconnue' }).error.code, 'NOT_FOUND', 'une version inconnue : refusée');
  });

  test('Le bilan par CPN et le suivi par équipe lisent la même version de référence', () => {
    const w = world(), b0 = w.freeze(); w.validate(b0.id);
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'N' });
    const t1 = w.team = w.call(CP, 'teams.create', { values: { name: '1vm' } });
    w.call(CP, 'budget.line.save', { values: { deliverable_id: w.a.id, team_id: t1.id, planned_amount: 400 }, exerciseId: w.exec.id });   // une part d'équipe ajoutée APRÈS la version
    w.change();
    const bal = (version) => w.call(CP, 'budget.balance', { projectId: w.p1.id, exerciseId: w.exec.id, version });
    eq([bal('live').totals.budget.total, bal('ref').totals.budget.total], [3400, 1300], 'bilan par CPN : la saisie d’aujourd’hui (3 400 €) contre la version de référence (1 300 €)');
    const trk = (version) => w.call(CP, 'exercise.tracking', { projectId: w.p1.id, exerciseId: w.exec.id, version });
    eq([trk('live').teams.length, trk('ref').teams.length], [1, 0], 'suivi par équipe : la part d’équipe ajoutée après la version n’y figure pas');
  });
};
