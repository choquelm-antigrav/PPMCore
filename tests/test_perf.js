const { test, eq, ok, fakeCache } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nPerformance : cache des lectures (0.5.1)');
  const CP = 'carla@entreprise.com';

  /** Compte les lectures complètes de tables faites dans les « feuilles » (le fournisseur en mémoire). */
  function instrument(w) {
    const cache = fakeCache();
    const reads = {};
    const provider = w.c.TABLE_PROVIDER;
    w.c.TABLE_PROVIDER = (name) => {
      const t = provider(name);
      if (!t.__counted) {
        const orig = t.readAll;
        t.readAll = () => { reads[name] = (reads[name] || 0) + 1; return orig(); };
        t.__counted = true;
      }
      return t;
    };
    w.c.CACHE_PROVIDER = cache;
    const total = () => Object.values(reads).reduce((a, b) => a + b, 0);
    const reset = () => Object.keys(reads).forEach((k) => delete reads[k]);
    return { cache, reads, total, reset };
  }

  test('Deuxième affichage du planning : aucune table relue dans les feuilles', () => {
    const w = lot2World();
    const m = instrument(w);
    const g1 = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    ok(m.total() > 5, 'premier affichage : lectures dans les feuilles (' + m.total() + ')');
    ok(Object.values(m.reads).every((n) => n === 1), 'chaque table lue une seule fois par requête : ' + JSON.stringify(m.reads));
    m.reset();
    const g2 = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    eq([m.total(), JSON.stringify(g2.rows)], [0, JSON.stringify(g1.rows)], 'second affichage servi par le cache, identique');
    const obs = w.call(CP, 'obs.tree', { scopeType: 'project', scopeId: w.p1.id });
    ok(obs.nodes.length > 0 && m.total() <= 1, 'l’organigramme profite du même cache (' + m.total() + ' lecture)');
  });

  test('Une écriture est visible aussitôt ; seule la table modifiée est relue', () => {
    const w = lot2World();
    const m = instrument(w);
    w.call(CP, 'gantt.project', { projectId: w.p1.id });
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
    m.reset();
    const g = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    eq(g.rows.find((r) => r.id === w.b.id).finish, '2026-10-28');
    ok(m.reads.PlanItem === 1 && !m.reads.Project && !m.reads.Resource, 'relu : ' + JSON.stringify(m.reads));
  });

  test('Saisie AppSheet signalée par le bot : le cache est invalidé', () => {
    const w = lot2World();
    const m = instrument(w);
    w.call(CP, 'gantt.project', { projectId: w.p1.id });
    const t = w.c.TABLE_PROVIDER('PlanItem');
    t._rows[t.findRow(w.b.id) - 2].planned_finish = '2026-10-30'; // écriture directe dans la feuille
    eq(w.call(CP, 'gantt.project', { projectId: w.p1.id }).rows.find((r) => r.id === w.b.id).finish, '2026-10-23', 'sans signal : ancienne valeur (au plus 5 minutes)');
    w.c.onRowChanged('PlanItem', w.b.id, 'remi@entreprise.com');
    eq(w.call(CP, 'gantt.project', { projectId: w.p1.id }).rows.find((r) => r.id === w.b.id).finish, '2026-10-30', 'après le signal AppSheet : nouvelle valeur');
  });

  test('Cache en panne ou table trop grosse : tout fonctionne, sans cache', () => {
    const w = lot2World();
    const m = instrument(w);
    m.cache.fail = true;
    eq(w.call(CP, 'gantt.project', { projectId: w.p1.id }).rows.length > 0, true, 'panne du cache : lecture directe');
    m.cache.fail = false;
    w.c.CACHE_MAX_CHUNKS = 0;
    m.reset();
    w.call(CP, 'gantt.project', { projectId: w.p1.id });
    w.call(CP, 'gantt.project', { projectId: w.p1.id });
    ok(m.reads.PlanItem === 2, 'rien en cache au-delà de la taille limite : relu à chaque requête');
    eq(Object.keys(m.cache.store).filter((k) => k.startsWith('rows:')).length, 0);
  });

  test('Données découpées en morceaux et relues à l’identique ; expiration', () => {
    const w = lot2World();
    const m = instrument(w);
    w.c.CACHE_CHUNK = 300; // force plusieurs morceaux
    w.c.CACHE_MAX_CHUNKS = 500;
    const g1 = w.call(CP, 'gantt.project', { projectId: w.p1.id });
    ok(Object.keys(m.cache.store).filter((k) => k.startsWith('rows:PlanItem:')).length > 3, 'plusieurs morceaux');
    m.reset();
    eq(JSON.stringify(w.call(CP, 'gantt.project', { projectId: w.p1.id }).rows), JSON.stringify(g1.rows));
    eq(m.total(), 0);
    m.cache.expireAll();
    w.call(CP, 'gantt.project', { projectId: w.p1.id });
    ok(m.total() > 5, 'après expiration, relecture dans les feuilles');
  });

  test('Premier écran préparé avec la page : bonnes clés, réponses complètes, pour chaque page', () => {
    const w = lot2World();
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    const keys = (view, extra) => {
      const boot = Object.assign({ project: '', program: '', tab: w.c.PAGE_TABS[view][0], mode: '' }, extra || {});
      const pre = w.c.preloadFor_(view, boot, CP);
      ok(Object.values(pre).every((r) => r.ok), view + ' : toutes les réponses préparées sont valides');
      return Object.keys(pre);
    };
    const id = w.p1.id;
    eq(keys('gantt'), ['planning.catalog|{}', 'gantt.project|{"projectId":"' + id + '"}']);
    eq(keys('structure'), ['planning.catalog|{}', 'views.config|{}', 'wbs.tree|{"projectId":"' + id + '"}', 'obs.tree|{"scopeId":"' + id + '","scopeType":"project"}'], 'plus d’onglets : l’organisation et le découpage se chargent ensemble');
    eq(keys('suivi'), ['planning.catalog|{}', 'baselines.list|{"projectId":"' + id + '"}', 'changes.feed|{"limit":1,"projectId":"' + id + '"}', 'changes.feed|{"all":false,"projectId":"' + id + '"}', 'baselines.diff|{"projectId":"' + id + '"}', 'workspace.status|{"projectId":"' + id + '"}'], 'plus d’onglets : toutes les zones de Suivi sont préparées avec la page');
    eq(keys('copilote'), ['copilot.key.status|{}'], 'la page Copilote ne précharge que l’état de la clé de la personne');
    eq(keys('gantt', { program: w.prog.id }).pop(), 'gantt.program|{"programId":"' + w.prog.id + '"}');
    eq(w.c.stableJson_({ b: [2, { d: 1, c: null }], a: 'x' }), '{"a":"x","b":[2,{"c":null,"d":1}]}');
  });
};

