const { test, eq, ok, fakeWorkspace } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nRappels avant livraison dans l’agenda du responsable (0.9.1)');

  const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';
  // Jeu : A Spécification (Rémi) 05→09/10 ; B Calcul (Rémi) 12→23/10 ; C Essais 26/10→06/11 ; J Revue (jalon). Aujourd'hui : 05/10/2026.
  const at = (w, iso) => { let t = Date.parse(iso); w.c.CLOCK = () => (t += 1); };

  function world(enable = true) {
    const w = lot2World();
    at(w, '2026-10-05T08:00:00Z');
    w.W = fakeWorkspace();
    w.c.WORKSPACE = w.W;
    const calId = () => w.c.repoGet('Project', w.p1.id).calendar_id;
    w.events = () => Object.values(w.W._cal.calendars[calId()].events);
    w.rem = () => w.events().filter((e) => /^Rappel livraison/.test(e.title));
    w.remOf = (name) => w.rem().find((e) => e.title.endsWith('· ' + name));
    w.sync = () => w.call(CP, 'workspace.sync', { projectId: w.p1.id });
    if (enable) w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    return w;
  }

  test('Un rappel par livrable, 10 jours ouvrés avant sa livraison, avec le responsable invité', () => {
    const w = world();
    eq(w.rem().length, 2, 'Calcul et Essais ; Spécification : la date du rappel est déjà passée, rien n’est créé');
    const calc = w.remOf('Calcul'), essais = w.remOf('Essais');
    eq([calc.date, essais.date], ['2026-10-09', '2026-10-23'], '10 jours ouvrés avant le 23/10 et avant le 06/11');
    eq([calc.title, calc.guests], ['Rappel livraison · P1 · Calcul', ['remi@entreprise.com']]);
    ok(/livraison est prévue le 23\/10\/2026 \(dans 10 jours ouvrés\)/.test(calc.description) && /Workpackage 1\.1 Calcul/.test(calc.description), calc.description);
    ok(!w.remOf('Revue') && !w.remOf('Spécification'), 'ni pour un jalon, ni pour une date passée');
    const owner = w.c.repoList('Resource').find((r) => r.id === w.c.repoGet('PlanItem', w.cc.id).owner_resource_id);
    eq(essais.guests, owner && owner.email ? [owner.email.toLowerCase()] : [], 'le responsable du livrable est invité, lui seul');
    const again = w.sync();
    eq([again.report.created, again.report.updated], [0, 0], 'relancer ne change ni ne duplique rien');
  });

  test('Délai par défaut réglé par l’administrateur, avec ses bornes', () => {
    const w = world();
    const set = (v, who) => w.raw(who || ADMIN, 'admin.set', { values: v });
    eq(w.call(ADMIN, 'admin.get', {}).reminder_days, 10);
    [0, 61, 2.5, 'x', ''].forEach((d) => eq(set({ reminder_days: d }).error.code, 'VALIDATION', 'délai ' + d));
    eq(set({ reminder_days: 5 }, CP).error.code, 'FORBIDDEN');
    const r = set({ reminder_days: 5 });
    eq([r.data.reminder_days, r.data.changed], [5, ['reminder_days']]);
    const n = w.W.calls.length;
    w.sync();
    eq([w.rem().length, w.remOf('Calcul').date, w.remOf('Essais').date], [2, '2026-10-16', '2026-10-30'], '5 jours ouvrés avant : les rappels existants se déplacent, sans doublon');
    ok(w.W.calls.slice(n).every((c) => c === 'update'), 'mis à jour, pas recréés');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Réglages' && e.field === 'reminder_days' && e.old_value === '10' && e.new_value === '5'), 'changement tracé');
  });

  test('Chacun règle son délai ou se désinscrit ; l’administrateur peut tout désactiver', () => {
    const w = world();
    eq(w.call(RWP, 'settings.get', {}).reminder_default, { on: true, days: 10 });
    [0, 61, 2.5, 'x'].forEach((d) => eq(w.raw(RWP, 'settings.set', { reminder_days: d }).error.code, 'VALIDATION', 'délai ' + d));
    const s = w.call(RWP, 'settings.set', { reminder_days: 3 });
    eq([s.reminder_days, s.reminder_off], [3, false]);
    w.sync();
    eq(w.remOf('Calcul').date, '2026-10-20', '3 jours ouvrés avant le 23/10 pour Rémi');
    eq(w.remOf('Essais').date, '2026-10-23', 'le délai des autres ne bouge pas');
    eq(w.call(RWP, 'settings.set', { reminder_days: '' }).reminder_days, null, 'vider le champ : retour au délai par défaut');
    w.sync();
    eq(w.remOf('Calcul').date, '2026-10-09');
    w.call(RWP, 'settings.set', { reminder_off: true });
    w.sync();
    ok(!w.remOf('Calcul'), 'désinscrit : son rappel disparaît de l’agenda');
    ok(w.events().some((e) => /Échéance · P1 · Calcul/.test(e.title)), 'mais l’échéance reste');
    eq(w.rem().length, 1, 'les rappels des autres restent');
    w.call(RWP, 'settings.set', { reminder_off: false });
    w.sync();
    ok(w.remOf('Calcul'), 'réinscrit : il revient');
    w.call(ADMIN, 'admin.set', { values: { reminder_on: false } });
    w.sync();
    eq(w.rem().length, 0, 'désactivés par l’administrateur : plus aucun rappel');
    eq(w.call(MEMBER, 'settings.get', {}).reminder_default.on, false, 'et chacun le voit');
    w.call(ADMIN, 'admin.set', { values: { reminder_on: true } });
    w.sync();
    eq(w.rem().length, 2, 'réactivés : ils reviennent');
  });

  test('Mises à jour immédiates : livraison décalée, livrable terminé, responsable changé ou retiré', () => {
    const w = world();
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-30' } });
    eq(w.remOf('Calcul').date, '2026-10-16', 'la date de livraison bouge, le rappel suit aussitôt');
    ok(/livraison est prévue le 30\/10\/2026/.test(w.remOf('Calcul').description));
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { owner_resource_id: w.carla.id } });
    eq(w.remOf('Calcul').guests, ['carla@entreprise.com'], 'nouveau responsable : le rappel change de destinataire');
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { owner_resource_id: '' } });
    ok(!w.remOf('Calcul'), 'plus de responsable : plus de rappel');
    w.call(CP, 'planitems.update', { id: w.b.id, patch: { owner_resource_id: w.remi.id } });
    ok(w.remOf('Calcul'), 'responsable rétabli : le rappel revient');
    w.call(RWP, 'progress.declare', { planItemId: w.b.id, progressPct: 100 });
    ok(!w.remOf('Calcul'), 'livrable terminé : le rappel disparaît aussitôt');
    eq(w.rem().length, 1, 'les autres restent');
  });

  test('Un rappel déjà créé est conservé quand sa date passe ; aucun nouveau pour une date passée', () => {
    const w = world();
    at(w, '2026-10-12T08:00:00Z');
    w.sync();
    ok(w.remOf('Calcul'), 'la date du rappel (09/10) est passée : l’événement reste dans l’agenda');
    ok(!w.remOf('Spécification'), 'et rien n’est inventé pour Spécification');
    w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'Livrable', parentId: w.w2.id, values: { name: 'Tardif', planned_start: '2026-10-12', planned_finish: '2026-10-16', owner_resource_id: w.remi.id } });
    w.sync();
    ok(!w.remOf('Tardif'), 'un livrable créé trop près de sa livraison n’a pas de rappel (sa date serait passée)');
    w.call(CP, 'wbs.update', { kind: 'item', id: w.c.repoList('PlanItem').find((i) => i.name === 'Tardif').id, patch: { planned_finish: '2026-12-18' } });
    eq(w.remOf('Tardif').date, '2026-12-04', 'repoussé à décembre : le rappel est créé aussitôt');
  });

  test('Jours fériés pris en compte ; projet sans agenda : rien ne se passe', () => {
    const w = world(false);
    const n = w.W.calls.length;
    w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-30' } });
    eq(w.W.calls.length, n, 'sans agenda de projet, aucun appel et aucune erreur');
    w.call(CP, 'workspace.enable', { projectId: w.p1.id });
    eq(w.remOf('Calcul').date, '2026-10-16');
    // un jour férié ajouté dans la période : le rappel recule d'un jour ouvré
    const fr = w.call(ADMIN, 'admin.holidays', {}).sets.find((s) => s.id === 'FR-2026');
    w.call(ADMIN, 'admin.holidays.set', { id: 'FR-2026', version: fr.version, dates: fr.dates.concat([{ date: '2026-10-19', name: 'Pont' }]) });
    w.sync();
    eq(w.remOf('Calcul').date, '2026-10-15', '10 jours ouvrés avant le 30/10 en sautant le pont du 19/10');
  });
};
