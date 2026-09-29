const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nCopilote : simulation, synthèse, IA et garde-fous (lot 4)');

  const CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com';
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };
  const sim = (w, changes) => w.call(CP, 'simulations.run', { projectId: w.p1.id, changes });

  // Rappel : A 05/10→09/10, B 12/10→23/10, C 26/10→06/11, J 09/11 ; A→B→C→J ; 11/11 férié.
  test('Simulation : effet domino en jours ouvrés, fin du plan, écart à la baseline', () => {
    const w = lot2World();
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    const r = sim(w, [{ itemId: w.a.id, shiftDays: 3 }]);
    const m = (n) => r.moved.find((x) => x.name === n);
    eq([m('Spécification').finish, m('Calcul').start, m('Calcul').finish, m('Essais').finish, m('Revue').finish],
      ['2026-10-14', '2026-10-15', '2026-10-28', '2026-11-12', '2026-11-13']);
    eq([m('Calcul').cause, m('Essais').cause, m('Revue').cause], ['Spécification', 'Calcul', 'Essais']);
    eq(r.moved.every((x) => x.shift === 3), true);
    eq([r.domino, r.plan_end.before, r.plan_end.after, r.plan_end.shift, r.plan_end.slip_vs_baseline], [3, '2026-11-09', '2026-11-13', 3, 3]);
    eq(r.milestones.map((x) => [x.name, x.slip_vs_baseline]), [['Revue', 3]]);
    eq(w.c.repoGet('PlanItem', w.a.id).planned_finish, '2026-10-09', 'rien n’est enregistré');
  });

  test('Simulation : la marge absorbe un décalage ; au-delà, l’élément devient critique', () => {
    const w = lot2World();
    const e = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Outillage', item_type: 'Livrable', planned_start: '2026-10-05', planned_finish: '2026-10-07' } });
    w.call(CP, 'dependencies.create', { values: { predecessor_id: e.id, successor_id: w.cc.id, dep_type: 'FS' } });
    const small = sim(w, [{ itemId: e.id, shiftDays: 5 }]);
    eq([small.domino, small.plan_end.shift, small.newly_critical], [0, 0, []]);
    const edge = sim(w, [{ itemId: e.id, shiftDays: 12 }]);
    eq([edge.domino, edge.plan_end.shift, edge.newly_critical], [0, 0, ['Outillage']], 'marge de 12 jours entièrement consommée');
    const over = sim(w, [{ itemId: e.id, shiftDays: 13 }]);
    eq([over.domino, over.plan_end.shift], [2, 1], 'un jour de trop décale Essais et la Revue');
  });

  test('Simulation : une dépendance déjà non respectée n’est pas « corrigée » au compte de l’hypothèse', () => {
    const w = lot2World();
    // Essais démarre le 20/10 alors que Calcul finit le 23/10 : déjà 4 jours ouvrés de retard sur la dépendance.
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { planned_start: '2026-10-20' } });
    const r = sim(w, [{ itemId: w.a.id, shiftDays: 3 }]);
    const m = (n) => r.moved.find((x) => x.name === n);
    eq([m('Calcul').shift, m('Essais').shift, m('Essais').start], [3, 3, '2026-10-23'], 'Essais ne bouge que des 3 jours de l’hypothèse, pas des 7');
    ok(r.notes.some((n) => /1 dépendance était déjà non respectée/.test(n)), r.notes.join(' / '));
  });

  test('Simulation : avancer ne tire pas les successeurs ; date cible ; jalon menacé ; autre projet', () => {
    const w = lot2World();
    const back = sim(w, [{ itemId: w.b.id, shiftDays: -2 }]);
    eq([back.moved.length, back.moved[0].finish], [1, '2026-10-21']);
    ok(/ne sont pas avancés automatiquement/.test(back.notes[0]));
    const to = sim(w, [{ itemId: w.j.id, finish: '2026-11-13' }]);
    eq([to.changes[0].shift, to.plan_end.after], [3, '2026-11-13'], 'hypothèse par date cible');
    // Jalon K sans dépendance, mais qui exige Essais : menacé si Essais glisse trop.
    const k = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Revue qualité', item_type: 'Jalon', planned_start: '2026-11-20', planned_finish: '2026-11-20' } });
    w.c.repoInsert('MilestoneRequirement', { milestone_id: k.id, deliverable_id: w.cc.id }, w.S);
    const thr = sim(w, [{ itemId: w.cc.id, shiftDays: 12 }]);
    eq(thr.newly_threatened.map((t) => [t.milestone, t.deliverable]), [['Revue qualité', 'Essais']]);
    // Livrable de P2 qui attend la Revue de P1.
    const x = w.call('admin@entreprise.com', 'planitems.create', { values: { project_id: w.p2.id, name: 'Moule', item_type: 'Livrable', planned_start: '2026-11-10', planned_finish: '2026-11-20' } });
    w.call('admin@entreprise.com', 'dependencies.create', { values: { predecessor_id: w.j.id, successor_id: x.id, dep_type: 'FS' } });
    const ext = sim(w, [{ itemId: w.j.id, shiftDays: 3 }]);
    eq(ext.external_impacts.map((e) => [e.name, e.project, e.gap, e.because]), [['Moule', 'P2', 2, 'Revue']], 'Moule avait un jour d’avance ; le 11/11 est férié');
    ok(!ext.moved.some((m) => m.name === 'Moule'), 'un autre projet n’est jamais déplacé');
    eq(w.raw(CP, 'simulations.run', { projectId: w.p1.id, changes: [{ itemId: 'zzz', shiftDays: 1 }] }).error.code, 'VALIDATION');
    eq(w.raw(CP, 'simulations.run', { projectId: w.p1.id, changes: [] }).error.code, 'VALIDATION');
  });

  test('Synthèse chiffrée sans IA : retards, jalons, signaux faibles, rien de sensible', () => {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    w.call('remi@entreprise.com', 'progress.declare', { planItemId: w.b.id, progressPct: 20, comment: 'Bloqué : en attente fournisseur pour les éprouvettes' });
    w.c.repoUpdate('Project', w.p1.id, { end_date: '2026-11-20' }, null, w.S);
    const b = w.call(CP, 'copilot.brief', { projectId: w.p1.id });
    const f = b.facts;
    eq([f.project.code, f.project.manager, f.schedule.plan_end, f.schedule.target_end, f.schedule.margin_to_target], ['P1', 'Carla', '2026-11-09', '2026-11-20', 8]);
    eq([f.late_count, f.late[0].name, f.late[0].days_late, f.late[0].owner], [1, 'Spécification', 3, 'Rémi']);
    eq(f.upcoming_milestones.map((m) => [m.name, m.date, m.in_days]), [['Revue', '2026-11-09', 26]]);
    eq(f.weak_signals.map((s) => s.item), ['Calcul']);
    const text = b.lines.map((l) => l.text).join('\n');
    ok(/8 jours ouvrés de marge sur la fin visée \(20\/11\/2026\)/.test(text), text);
    ok(/1 élément en retard, dont « Spécification » \(3 jours ouvrés\)/.test(text), text);
    ok(/Jalon « Revue » le 09\/11\/2026 \(dans 26 jours\)/.test(text), text);
    ok(/signal faible/.test(text) && /Pas de baseline/.test(text), text);
    const json = JSON.stringify(f);
    ok(json.indexOf('@') < 0 && !/rate|amount|montant/i.test(json), 'ni adresse, ni montant, ni taux dans les faits');
    eq(b.ai, null);
  });

  test('Mode désactivé (par défaut) : pas d’IA, message clair', () => {
    const w = lot2World();
    eq(w.call(CP, 'copilot.status', { projectId: w.p1.id }).mode, 'off');
    const r = w.raw(CP, 'copilot.brief', { projectId: w.p1.id, ai: true });
    eq(r.error.code, 'CONFIG');
    ok(/PPM_AI_MODE/.test(r.error.message));
    eq(w.raw(CP, 'copilot.ask', { projectId: w.p1.id, question: 'Où en est-on ?' }).error.code, 'CONFIG');
    eq(w.c.repoList('AiLog').length, 0);
  });

  test('Mode « copier-coller » : texte prêt pour Gemini, journalisé, rien d’envoyé', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.AI_MODE, 'manual');
    const b = w.call(CP, 'copilot.brief', { projectId: w.p1.id, ai: true });
    eq(b.ai.mode, 'manual');
    ok(/Tu ne cites que des chiffres/.test(b.ai.prompt) && /"plan_end": "2026-11-09"/.test(b.ai.prompt) && /Demande : Rédige une synthèse/.test(b.ai.prompt), b.ai.prompt.slice(0, 300));
    const q = w.call(CP, 'copilot.ask', { projectId: w.p1.id, question: 'Quel livrable surveiller ?' });
    ok(/Demande : Quel livrable surveiller \?/.test(q.prompt) && /Livrables et jalons/.test(q.prompt) && /"name":"Calcul"/.test(q.prompt));
    ok(q.prompt.indexOf('@entreprise.com') < 0, 'aucune adresse dans le texte à copier');
    eq(w.c.repoList('AiLog').map((l) => [l.mode, l.purpose, l.actor]), [['manual', 'synthese', CP], ['manual', 'question', CP]]);
  });

  test('Mode API : questions par fonctions en lecture seule, chiffres vérifiés, avis, quota', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.AI_MODE, 'api');
    const requests = [];
    const script = [];
    w.c.AI_PROVIDER = { name: 'faux', generate: (req) => { requests.push(JSON.parse(JSON.stringify(req))); return script.shift(); } };
    // 1. Synthèse : un chiffre inventé (47) est signalé.
    script.push({ text: 'Fin du plan le 09/11/2026. Prévoir 47 personnes en renfort.', calls: [] });
    const b = w.call(CP, 'copilot.brief', { projectId: w.p1.id, ai: true });
    eq([b.ai.mode, b.ai.unverified], ['api', ['47']]);
    ok(/Tu ne cites que des chiffres/.test(requests[0].system));
    // 2. Question : le modèle demande une simulation, puis répond avec les dates renvoyées par le Core.
    script.push({ text: '', calls: [{ name: 'simulate_shift', args: { item: 'spécification', shift_days: 3 } }] });
    script.push({ text: 'Si la Spécification glisse de 3 jours, la Revue passe au 13/11/2026.', calls: [] });
    const q = w.call(CP, 'copilot.ask', { projectId: w.p1.id, question: 'Et si la spécification glisse de 3 jours ?' });
    eq([q.steps, q.unverified], [['simulate_shift'], []]);
    const second = requests[2].contents;
    const resp = second[second.length - 1].parts[0].functionResponse;
    eq([resp.name, resp.response.content.plan_end.after], ['simulate_shift', '2026-11-13'], 'le résultat du Core est renvoyé au modèle');
    ok(requests[1].tools.map((t) => t.name).includes('list_items') && !requests[1].tools.some((t) => /create|update|delete|set/.test(t.name)), 'fonctions en lecture seule uniquement');
    ok(requests.every((r) => JSON.stringify(r).indexOf('@entreprise.com') < 0), 'aucune adresse transmise au modèle');
    // 3. Avis et journal.
    w.call(CP, 'copilot.feedback', { logId: q.logId, useful: true });
    eq(w.raw(MEMBER, 'copilot.feedback', { logId: q.logId, useful: false }).error.code, 'FORBIDDEN');
    const logs = w.c.repoList('AiLog');
    eq([logs.length, logs[0].unverified, logs[1].feedback], [2, '47', 'utile']);
    ok(/13\/11\/2026/.test(logs[1].response) && /simulate_shift/.test(logs[1].prompt), 'question, appels et réponse journalisés');
    // 4. Quota.
    w.c.setProp(w.c.PROP.AI_QUOTA, '2');
    eq(w.raw(CP, 'copilot.brief', { projectId: w.p1.id, ai: true }).error.code, 'QUOTA');
    eq(w.call(CP, 'copilot.status', {}).quota, { used: 2, limit: 2 });
    eq(w.call(MEMBER, 'copilot.status', {}).quota.used, 0, 'quota par personne');
  });

  test('Garde-fou des chiffres : dates, décimales, numéros de liste', () => {
    const w = lot2World();
    const g = (t, s) => w.c.checkGrounding(t, s);
    eq(g('1. Fin le 18/12/2026, soit 3 jours de retard.', [{ finish: '2026-12-18', slip: 3 }]), { ok: true, unverified: [] });
    eq(g('Avancement 20,5 % et 7 livrables.', [{ pct: 20.5 }]), { ok: false, unverified: ['7'] });
    eq(g('- 2) Revoir le jalon du 05/11/2026', [{ d: '2026-11-05' }]).ok, true);
  });

  test('Signaux faibles : un commentaire de blocage récent devient une vigilance', () => {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    w.call('remi@entreprise.com', 'progress.declare', { planItemId: w.b.id, progressPct: 30, comment: 'Calculs lancés, mais en attente fournisseur pour les données matière' });
    w.call(CP, 'progress.declare', { planItemId: w.cc.id, progressPct: 10, comment: 'Démarrage conforme au plan' });
    w.c.repoInsert('ProgressUpdate', { deliverable_id: w.a.id, progress_pct: 50, comment: 'Bloqué par la revue', declared_at: '2026-08-01T10:00:00Z' }, w.S);
    w.c.runRules();
    const ws = w.c.repoList('Insight').filter((i) => i.rule_code === 'WEAK_SIGNAL');
    eq(ws.map((i) => i.target_id), [w.b.id], 'seul le commentaire récent avec un mot de blocage compte');
    ok(/en attente fournisseur/.test(ws[0].message) && ws[0].severity === 'Vigilance');
  });

  test('Suggestions : décider, tracer, taux d’acceptation ; une décision n’est pas écrasée la nuit', () => {
    const w = lot2World();
    at(w, '2026-10-14T08:00:00Z');
    w.c.runRules();
    let s = w.call(CP, 'copilot.suggestions', { projectId: w.p1.id });
    ok(s.canDecide && s.pending.length >= 2, JSON.stringify(s.pending.map((x) => x.rule)));
    eq(s.pending[0].severity, 'Alerte', 'les alertes d’abord');
    const late = s.pending.find((x) => x.rule === 'LATE_ITEM');
    eq(w.raw(MEMBER, 'insights.decide', { id: late.id, decision: 'Accepté' }).error.code, 'FORBIDDEN');
    eq(w.raw(CP, 'insights.decide', { id: late.id, decision: 'Peut-être' }).error.code, 'VALIDATION');
    const d = w.call(CP, 'insights.decide', { id: late.id, decision: 'Accepté', note: 'Renfort demandé à Rémi' });
    eq([d.status, d.decided_by, d.decision_note], ['Accepté', CP, 'Renfort demandé à Rémi']);
    eq(w.raw(CP, 'insights.decide', { id: late.id, decision: 'Ignoré' }).error.code, 'VALIDATION');
    const other = s.pending.find((x) => x.id !== late.id);
    w.call(CP, 'insights.decide', { id: other.id, decision: 'Ignoré' });
    w.c.runRules();
    eq(w.c.repoGet('Insight', late.id).status, 'Accepté', 'la nuit ne réécrit pas une décision');
    s = w.call(CP, 'copilot.suggestions', { projectId: w.p1.id });
    eq([s.stats.accept_rate, s.recent.length, s.recent.some((r) => r.note === 'Renfort demandé à Rémi')], [50, 2, true]);
    ok(!s.pending.some((x) => x.id === late.id));
  });
};
