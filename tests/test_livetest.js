const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nTest de contrôle dans Apps Script (A7, lecture seule)');
  const ADMIN = 'admin@entreprise.com', MEMBER = 'mia@entreprise.com';
  const as = (w, email) => { w.c.Session = { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => email }) }; };
  const names = (res) => res.rows.map((r) => r.name);
  /** Le Core installé : propriétés des deux classeurs (le banc d'essai n'a pas de vrais classeurs, on en simule l'identifiant). */
  const installed = (w) => { w.c.setProp(w.c.PROP.DATA_ID, 'classeur-donnees'); w.c.setProp(w.c.PROP.HISTORY_ID, 'classeur-historique'); return w; };
  const snapshot = (c) => JSON.stringify(Object.keys(c.SCHEMA).map((t) => { try { return [t, c.repoList(t, null, { includeDeleted: true }).length]; } catch (e) { return [t, -1]; } }));

  test('A7 : un Core sain, avec un compte administrateur, ne signale aucun échec', () => {
    const w = installed(lot2World()); as(w, ADMIN);
    const res = w.c.liveSmokeTest_();
    const bad = res.rows.filter((r) => r.status === 'ÉCHEC');
    eq(bad.map((r) => r.name + ' — ' + r.detail), [], 'aucun échec');
    ok(res.rows.length >= 18, res.rows.length + ' contrôles');
    ['Moteur JavaScript', 'Calcul des dates', 'Lecture d’un compte rendu', 'Installation', 'Compte qui exécute', 'Appel serveur : Overview (P1)', 'Appel serveur : Actualités (P1)', 'Appel serveur : planning du projet'].forEach((n) => ok(names(res).some((x) => x.indexOf(n) === 0), 'contrôle présent : ' + n));
    ok(res.rows.every((r) => typeof r.ms === 'number' && r.ms >= 0), 'chaque contrôle est chronométré');
    eq(res.counts.OK + res.counts.ATTENTION + res.counts['ÉCHEC'], res.rows.length, 'les compteurs recoupent les lignes');
  });

  test('A7 : lecture seule, il n’écrit aucune ligne et n’envoie aucun mail', () => {
    const w = installed(lot2World()); as(w, ADMIN);
    const propsOf = (c) => JSON.stringify(Object.keys(c.PROP).sort().map((k) => [k, c.getProp(c.PROP[k], null)]));
    const before = snapshot(w.c), mails = w.c.SENT_MAILS.length, props = propsOf(w.c);
    w.c.liveSmokeTest_();
    eq(snapshot(w.c), before, 'même nombre de lignes dans toutes les tables, suppressions douces comprises');
    eq(w.c.SENT_MAILS.length, mails, 'aucun mail');
    eq(propsOf(w.c), props, 'aucune propriété modifiée');
  });

  test('A7 : il détecte de vrais défauts, un par un, sans s’arrêter', () => {
    const fail = (mutate, expectName, expectDetail) => {
      const w = installed(lot2World()); as(w, ADMIN); mutate(w.c);
      const res = w.c.liveSmokeTest_(), bad = res.rows.filter((r) => r.status === 'ÉCHEC');
      ok(bad.some((r) => r.name.indexOf(expectName) === 0 && (!expectDetail || expectDetail.test(r.detail))), expectName + ' : ' + JSON.stringify(bad.map((r) => r.name + ' / ' + r.detail)));
      ok(res.rows.length >= 18, 'les autres contrôles tournent quand même : ' + res.rows.length);
      return res;
    };
    fail((c) => { c.newsParseNotes_ = () => ({ summary: '', decisions: [], actions: [] }); }, 'Lecture d’un compte rendu', /notes mal lues/);
    fail((c) => { const orig = c.addCalendarDays; c.addCalendarDays = (d, n) => (d === '2026-03-28' && n === 1 ? '2026-03-30' : orig(d, n)); }, 'Calcul des dates', /décalage faux/); // sabotage ciblé : le planning, lui, continue de tourner
    fail((c) => { c.newsFindDate_ = () => ({ date: '2026-10-30', text: 'x' }); }, 'Lecture d’un compte rendu', /impossible|mal lus/);
    fail((c) => { const h = c.handleRequest; c.handleRequest = (req, e) => req.action === 'overview.get' ? { ok: false, error: { code: 'INTERNAL', message: 'panne simulée' } } : h(req, e); }, 'Appel serveur : Overview', /overview\.get : INTERNAL panne simulée/);
    fail((c) => { c.PPM_PAGES.pop(); }, 'Registre des pages', /incohérent/);
    fail((c) => { c.deleteProp(c.PROP.DATA_ID); }, 'Installation', /Propriété manquante/);
    const sans = installed(lot2World()); as(sans, ''); const r = sans.c.liveSmokeTest_();
    ok(r.rows.some((x) => x.name.indexOf('Compte qui exécute') === 0 && x.status === 'ÉCHEC' && /illisible/.test(x.detail)), 'sans adresse de compte : échec expliqué');
  });

  test('A7 : un refus de droits est normal pour un simple membre, un service absent est une attention et non un échec', () => {
    const w = installed(lot2World()); as(w, MEMBER);
    const res = w.c.liveSmokeTest_();
    eq(res.rows.filter((r) => r.status === 'ÉCHEC').map((r) => r.name + ' — ' + r.detail), [], 'aucun échec pour un membre');
    const budget = res.rows.find((r) => r.name.indexOf('Appel serveur : Budget') === 0);
    ok(budget && budget.status === 'OK', 'budget : ' + (budget && budget.status + ' ' + budget.detail));
    const cal = res.rows.find((r) => r.name.indexOf('Agenda') === 0);
    ok(cal && cal.status === 'ATTENTION' && /Calendar non activé/.test(cal.detail), 'sans service Calendar : attention explicite');
    ok(res.counts.ATTENTION >= 1, res.counts.ATTENTION + ' attention(s) hors Apps Script');
    w.c.Calendar = { Events: { list: () => ({ items: [] }) } };
    const present = w.c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Agenda') === 0);
    eq([present.status, present.detail], ['OK', 'lecture autorisée'], 'avec le service : lecture autorisée');
    w.c.Calendar = { Events: { list: () => { throw new Error('Accès refusé à l’agenda'); } } };
    const refused = w.c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Agenda') === 0);
    ok(refused.status === 'ÉCHEC' && /Accès refusé/.test(refused.detail), 'agenda refusé : échec expliqué');
  });

  test('A7 : le rapport et le point d’entrée', () => {
    const w = installed(lot2World()); as(w, ADMIN);
    const msg = w.c.A7_TESTER_DANS_APPS_SCRIPT();
    ok(/^A7 — PPM Core \d+\.\d+\.\d+ : \d+ OK, \d+ attention, 0 échec en [\d.]+ s \(lecture seule, rien n’a été écrit\)\./.test(msg), msg.split('\n')[0]);
    ok(msg.split('\n').length === 1 + w.c.liveSmokeTest_().rows.length, 'une ligne par contrôle');
    ok(/✓ OK · Moteur JavaScript/.test(msg) && /\(\d+ ms\)/.test(msg), 'lignes lisibles, avec leur durée');
  });

  test('A7 : le droit d’appeler Google (clé Gemini) est contrôlé, et son absence est expliquée', () => {
    const run = (mutate) => { const w = installed(lot2World()); as(w, ADMIN); mutate(w.c); return w.c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Appels externes') === 0); };
    const none = run(() => {});
    eq([none.status, none.detail], ['ATTENTION', 'non vérifiable ici'], 'hors Apps Script : attention, pas d’échec');
    const good = run((c) => { c.AI_FETCH = () => ({ code: 403, text: '{"error":{"message":"API key missing"}}' }); });
    ok(good.status === 'OK' && /Google répond \(403/.test(good.detail), 'Google répond « clé manquante » : le droit et le réseau sont bons : ' + good.detail);
    const perm = run((c) => { c.AI_FETCH = () => { throw new Error('You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request'); }; });
    ok(perm.status === 'ÉCHEC' && /external_request/.test(perm.detail), 'autorisation manquante : échec qui nomme l’autorisation : ' + perm.detail);
    const down = run((c) => { c.AI_FETCH = () => ({ code: 503, text: 'unavailable' }); });
    ok(down.status === 'ÉCHEC' && /503/.test(down.detail), 'Google en panne : échec avec le code');
  });

  test('A7 et A2 : une démo interrompue ou vide est signalée, jamais annoncée comme complète', () => {
    const row = (w) => w.c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Démo : contenu') === 0);
    const none = installed(lot2World()); as(none, ADMIN);
    eq([row(none).status, row(none).detail], ['OK', 'aucune démo NAC dans ce classeur'], 'sans démo : rien à signaler');
    // démo interrompue après trois étapes : exactement le cas rencontré en vrai
    const cut = installed(lot2World()); as(cut, ADMIN); cut.c.DEMO_BUDGET_MS = 0;
    const m1 = cut.c.seedDemo_(), m2 = cut.c.seedDemo_(); cut.c.seedDemo_();
    eq(cut.c.getProp(cut.c.PROP.DEMO_STEP, ''), '3', 'après trois lancements, la démo est arrêtée à l’étape 3 : exactement le cas rencontré en vrai');
    ok(/^Démo en cours/.test(m2), 'chaque lancement intermédiaire commence par « Démo en cours »');
    ok(/TANT QUE VOUS NE VOYEZ PAS « Démo complète », LA DÉMO EST INCOMPLÈTE/.test(m1) && /Relancez A2_SEED_DEMO/.test(m1), 'le message d’étape intermédiaire dit en toutes lettres que la démo est incomplète : ' + m1.slice(-140));
    const r1 = row(cut);
    ok(r1.status === 'ATTENTION' && /INTERROMPUE/.test(r1.detail) && /relancez A2_SEED_DEMO/.test(r1.detail), 'A7 signale la démo interrompue : ' + r1.detail);
    // démo complète : relue dans la base
    const full = installed(lot2World()); as(full, ADMIN); full.c.DEMO_BUDGET_MS = 1e9;
    const done = full.c.seedDemo_();
    ok(/^Démo complète/.test(done) && /Relu dans la base : 4 projets, \d+ workpackages, \d+ livrables et jalons, \d+ dépendances, \d+ lignes de budget, \d+ réunions/.test(done), done);
    const r2 = row(full);
    ok(r2.status === 'OK' && /^4 projets/.test(r2.detail), 'A7 : ' + r2.detail);
    // une démo « terminée » dont les livrables ont disparu : jamais « complète »
    full.c.repoList('PlanItem').forEach((i) => full.c.repoSoftDelete('PlanItem', i.id, null, { actor: ADMIN, source: 'test' }));
    const v = full.c.demoVerify_();
    ok(!v.ok && /projets sans aucun livrable : NAC-1, NAC-2, NAC-3, NAC-4/.test(v.text), 'la relecture voit des projets sans livrable : ' + v.text);
    const r3 = row(full);
    ok(r3.status === 'ATTENTION' && /démo incomplète/.test(r3.detail) && /A6_EFFACER_DEMO/.test(r3.detail), 'A7 : ' + r3.detail);
    // et A2, si la relecture échoue après toutes les étapes
    const bad = installed(lot2World()); as(bad, ADMIN); bad.c.DEMO_BUDGET_MS = 1e9; bad.c.demoVerify_ = () => ({ ok: false, text: '0 livrable' });
    ok(/^DÉMO INCOMPLÈTE malgré toutes les étapes : 0 livrable\. Exécutez A6_EFFACER_DEMO/.test(bad.c.seedDemo_()), 'A2 refuse de dire « Démo complète » quand la base dit le contraire');
  });
};
