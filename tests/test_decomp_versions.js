const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nVersions du plan budgétaire : version en cours, versions figées par les baselines, version de référence du suivi (0.21.0)');
  const CP = 'carla@entreprise.com', DPL = 'dora@entreprise.com', ADMIN = 'admin@entreprise.com', WPL = 'remi@entreprise.com';

  /** Exercice 2026 en exécution ; dotations 1vm 5 000 et 2ae 2 000 ; cellules : Spécification 800 (1vm) et Calcul 500 (2ae). Rien n'est figé. */
  function world() {
    const w = lot2World();
    const e0 = w.call(ADMIN, 'exercise.create', { year: 2026 });
    w.exec = w.call(ADMIN, 'exercise.setStatus', { id: e0.id, status: 'Exécution' });
    w.vm = w.call(CP, 'teams.create', { values: { name: '1vm' } }); w.ae = w.call(CP, 'teams.create', { values: { name: '2ae' } });
    const dot = (team, amount) => w.call(CP, 'exercise.set', { projectId: w.p1.id, exerciseId: w.exec.id, teamId: team.id, amount });
    const cell = (item, team, amount) => w.call(CP, 'budget.cell.set', { deliverableId: item.id, teamId: team.id, amount, exerciseId: w.exec.id });
    dot(w.vm, 5000); dot(w.ae, 2000); cell(w.a, w.vm, 800); cell(w.b, w.ae, 500);
    w.env = (who, version) => w.call(who || CP, 'budget.plan.get', { projectId: w.p1.id, exerciseId: w.exec.id, version });
    w.freeze = (who) => w.call(who || CP, 'baselines.create', { projectId: w.p1.id, justification: 'Version du budget' });
    w.validate = (id) => { const ids = w.call(DPL, 'changes.feed', { projectId: w.p1.id }).items.filter((i) => i.table === 'Baseline' && i.entity_id === id).map((i) => i.id); return w.raw(DPL, 'changes.ack', { ids }); };
    // la saisie change après la figeage : une dotation (+1 000), une cellule modifiée (+200), une cellule ajoutée (+1 500)
    w.change = () => { dot(w.vm, 6000); cell(w.a, w.vm, 1000); cell(w.cc, w.ae, 1500); };
    return w;
  }
  const costOf = (v) => v.totals.total, dotOf = (v) => v.summary.totals.dotation;

  test('Sans baseline validée, le suivi lit la version en cours, et la page le sait', () => {
    const w = world(), v = w.env(CP, 'ref');
    eq([v.version, v.fallback_live, v.reference_id, v.versions.length, costOf(v), v.can_edit], [null, true, '', 0, 1300, true], 'aucune baseline : la référence du suivi est la version en cours (rien à attendre), signalée par fallback_live');
    w.freeze();
    const v1 = w.env(CP, 'ref');
    eq([v1.fallback_live, v1.reference_id, v1.versions.map((x) => x.label + ':' + x.validation), v1.pending_version.label, v1.pending_version.validators], [true, '', ['P1_0:pending'], 'P1_0', ['Dora']], 'une première baseline en attente de validation n’est pas prise en compte : le suivi suit encore la version en cours ; la page sait qui doit valider');
    eq(w.call(CP, 'budget.plan.versions', { projectId: w.p1.id }).versions.map((x) => x.label), ['P1_0'], 'la liste des versions se lit aussi seule (la page s’ouvre sans)');
    ok(!('versions' in w.call(CP, 'budget.plan.get', { projectId: w.p1.id, exerciseId: w.exec.id })), 'et le tableau s’ouvre sans lire baselines ni journal');
  });

  test('Une version validée est la référence du suivi : elle montre ce qui a été figé, pas la saisie en cours', () => {
    const w = world(), b0 = w.freeze();
    ok(w.validate(b0.id).ok, 'le DPL valide la version P1_0');
    w.change();
    const live = w.env(CP, 'live'), ref = w.env(CP, 'ref');
    eq([live.can_edit, live.version, dotOf(live), costOf(live)], [true, null, 8000, 3000], 'la version en cours : modifiable, avec la saisie d’aujourd’hui');
    eq([ref.version.label, ref.fallback_live, ref.reference_id === b0.id, ref.versions[0].is_reference, ref.can_edit, dotOf(ref), costOf(ref)], ['P1_0', false, true, true, false, 7000, 1300], 'la version de référence : P1_0, en lecture seule, avec les montants figés (7 000 € de dotation, 1 300 € de plan), pas ceux de la saisie');
    const row = (v, n) => v.rows.find((r) => r.kind === 'deliverable' && r.name === n);
    eq([row(ref, 'Spécification').total, row(live, 'Spécification').total, row(ref, 'Spécification').can_edit, row(live, 'Spécification').can_edit], [800, 1000, false, true], 'le plan d’un livrable : 800 € figés (non modifiables) contre 1 000 € en cours (modifiables)');
    ok(ref.rows.filter((r) => r.kind === 'deliverable').every((x) => x.can_edit === false) && ref.unassigned.length === 0 && ref.can_set_dotation === false, 'aucune cellule ni dotation ne se modifie dans une version figée, et rien n’y est à rattacher');
    ok(!row(ref, 'Essais'), 'une cellule ajoutée après la figeage n’est pas dans la version');
  });

  test('Tant que la nouvelle version n’est pas validée, le suivi continue de lire la précédente ; une fois validée, il la lit', () => {
    const w = world(), b0 = w.freeze(); w.validate(b0.id);
    w.change();
    const b1 = w.freeze();                                                       // la version P1_1 fige la saisie modifiée
    let ref = w.env(CP, 'ref');
    eq([ref.version.label, costOf(ref), dotOf(ref), ref.pending_version.label, ref.pending_version.validators, ref.versions.map((v) => v.label + ':' + v.validation + (v.is_reference ? '*' : ''))], ['P1_0', 1300, 7000, 'P1_1', ['Dora'], ['P1_0:validated*', 'P1_1:pending']], 'P1_1 est en attente de Dora : le suivi lit P1_0 (1 300 €, 7 000 €) ; la page sait qui doit valider');
    ok(w.validate(b1.id).ok, 'Dora valide P1_1');
    ref = w.env(CP, 'ref');
    eq([ref.version.label, costOf(ref), dotOf(ref), ref.pending_version, ref.versions.map((v) => v.label + (v.is_reference ? '*' : ''))], ['P1_1', 3000, 8000, null, ['P1_0', 'P1_1*']], 'validée : le suivi lit P1_1 (3 000 €, 8 000 €), plus rien n’est en attente');
  });

  test('Une version figée par l’administrateur n’a personne à attendre ; une version se consulte par son identifiant', () => {
    const w = world(), b0 = w.freeze(ADMIN);
    const r = w.env(CP, 'ref');
    eq([r.versions[0].validation, r.version.label, r.reference_id === b0.id], ['', 'P1_0', true], 'figée au niveau le plus haut : validée d’emblée, c’est la référence');
    w.change(); const b1 = w.freeze(ADMIN);
    const old = w.env(CP, b0.id), cur = w.env(CP, b1.id);
    eq([old.version.label, costOf(old), cur.version.label, costOf(cur)], ['P1_0', 1300, 'P1_1', 3000], 'chaque version se consulte par son identifiant : P1_0 (archivée) et P1_1');
    eq(w.raw(CP, 'budget.plan.get', { projectId: w.p1.id, exerciseId: w.exec.id, version: 'inconnue' }).error.code, 'NOT_FOUND', 'une version inconnue : refusée');
  });

  test('Le bilan par CPN et le suivi par équipe lisent la même version de référence', () => {
    const w = world(), b0 = w.freeze(); w.validate(b0.id);
    w.call(CP, 'cpn.set', { projectId: w.p1.id, cpn: 'cpn-100', cpn_label: 'N' });
    const t3 = w.call(CP, 'teams.create', { values: { name: '3xx' } });
    w.call(CP, 'budget.cell.set', { deliverableId: w.a.id, teamId: t3.id, amount: 400, exerciseId: w.exec.id });   // une part d'équipe ajoutée APRÈS la version
    w.change();
    const bal = (version) => w.call(CP, 'budget.balance', { projectId: w.p1.id, exerciseId: w.exec.id, version });
    eq([bal('live').totals.budget.total, bal('ref').totals.budget.total], [3400, 1300], 'bilan par CPN : la saisie d’aujourd’hui (3 400 €) contre la version de référence (1 300 €)');
    const trk = (version) => w.call(CP, 'exercise.tracking', { projectId: w.p1.id, exerciseId: w.exec.id, version });
    eq([trk('live').teams.map((t) => t.name), trk('ref').teams.map((t) => t.name)], [['1vm', '2ae', '3xx'], ['1vm', '2ae']], 'suivi par équipe : la part de 3xx ajoutée après la version n’y figure pas');
    eq([trk('live').totals.dotation, trk('ref').totals.dotation], [8000, 7000], 'ni la dotation révisée : la version figée garde 5 000 + 2 000');
  });
};
