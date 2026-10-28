const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nJalon passé : déclaré explicitement par son responsable, il sort des alertes d’échéance (0.17.2)');
  const CP = 'carla@entreprise.com', WPL = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', EXT = 'xavier@alpha-sous-traitance.com';

  /** Un jalon dont la date est dépassée (20 septembre ; aujourd'hui : 5 octobre), sous le workpackage 1 (Rémi), dont le responsable est Mia (Deliverable owner du jalon, Contributor ailleurs). */
  function world() {
    const w = lot2World();
    w.late = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Revue à date dépassée', item_type: 'Jalon', planned_start: '2026-09-20', planned_finish: '2026-09-20', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    w.pass = (who, p) => w.raw(who || MEMBER, 'milestone.pass', Object.assign({ id: w.late.id }, p || {}));
    w.codes = () => { w.c.runRules(); return w.c.repoList('Insight').map((i) => i.rule_code + ':' + i.target_id); };
    w.item = (id) => w.c.repoGet('PlanItem', id);
    return w;
  }

  test('Le défaut d’origine : un jalon dont la date est dépassée restait en retard pour toujours ; le responsable le déclare passé et l’alerte disparaît', () => {
    const w = world();
    ok(w.codes().includes('LATE_ITEM:' + w.late.id), 'avant : l’alerte de retard du jalon');
    eq(w.raw(MEMBER, 'progress.declare', { planItemId: w.late.id, progressPct: 100 }).error.code, 'VALIDATION', 'l’avancement ne se déclare pas sur un jalon : il n’y avait aucun moyen de l’en sortir');
    const r = w.pass(MEMBER);
    ok(r.ok, JSON.stringify(r.error));
    eq([r.data.status, r.data.progress_pct, r.data.actual_finish], ['Terminé', 100, w.c.todayStr()], 'passé : terminé, 100 %, date réelle d’aujourd’hui');
    const it = w.item(w.late.id);
    eq([it.status, Number(it.progress_pct), it.actual_finish, String(it.last_progress_at).slice(0, 10)], ['Terminé', 100, w.c.todayStr(), w.c.todayStr()], 'enregistré dans le planning');
    ok(!w.codes().includes('LATE_ITEM:' + w.late.id), 'après : plus d’alerte de retard pour ce jalon');
    ok(w.c.repoList('ChangeEvent').some((e) => e.entity_id === w.late.id && /actual_finish/.test(JSON.stringify(e))), 'le passage est tracé dans le journal des changements');
    // le rouvrir : il redevient à faire, l'alerte revient
    const back = w.pass(MEMBER, { passed: false });
    eq([back.data.status, back.data.progress_pct, back.data.actual_finish], ['À faire', 0, ''], 'rouvert : à faire, sans date réelle');
    ok(w.codes().includes('LATE_ITEM:' + w.late.id), 'et l’alerte de retard revient, puisque la date est dépassée');
    // une date passée donnée
    eq(w.pass(MEMBER, { date: '2026-09-18' }).data.actual_finish, '2026-09-18', 'le jalon est passé à la date indiquée si elle est dans le passé');
  });

  test('Qui peut le déclarer : le responsable du jalon et les niveaux au-dessus, pas un Contributor, pas un externe ; contrôles de la date', () => {
    const w = world();
    eq(w.pass(EXT).error.code, 'FORBIDDEN', 'une personne hors du domaine, sans rôle : non');
    eq(w.raw(MEMBER, 'milestone.pass', { id: w.j.id }).error.code, 'FORBIDDEN', 'Mia est Contributor (pas responsable) du jalon « Revue » : non');
    ok(w.pass(WPL).ok, 'le Workpackage leader du workpackage qui contient le jalon : oui');
    ok(w.pass(CP, { passed: false }).ok && w.pass(DPL).ok, 'le chef de projet et le DPL : oui');
    eq(w.raw(WPL, 'milestone.pass', { id: w.cc.id }).error.code, 'VALIDATION', 'un livrable ne se marque pas passé');
    const future = w.pass(MEMBER, { passed: false });
    ok(future.ok);
    [['2026-12-31', 'dans le futur'], ['hier', 'illisible'], ['2026-13-45', 'impossible']].forEach((c) => eq(w.pass(MEMBER, { date: c[0] }).error.code, 'VALIDATION', 'date ' + c[1]));
    eq(w.item(w.late.id).status, 'À faire', 'une date refusée ne change rien');
    eq(w.raw(MEMBER, 'milestone.pass', { id: 'inconnu' }).error.code, 'NOT_FOUND');
  });

  test('Ce que le passage fait taire, et ce qu’il ne fait pas taire : retard et glissement critique cessent ; un jalon passé alors qu’un prérequis n’est pas terminé reste signalé', () => {
    const w = world();
    // glissement critique : baseline, puis le jalon « Revue » (responsable : Carla) glisse sur le chemin critique
    w.call(CP, 'baselines.create', { projectId: w.p1.id, justification: 'Planning initial' });
    w.call(CP, 'planitems.update', { id: w.j.id, patch: { planned_start: '2026-11-18', planned_finish: '2026-11-18' } });
    w.call(CP, 'planitems.update', { id: w.cc.id, patch: { planned_finish: '2026-11-09' } });
    ok(w.codes().includes('CRITICAL_SLIP:' + w.j.id), 'avant : le jalon critique décalé est signalé');
    ok(w.raw(CP, 'milestone.pass', { id: w.j.id }).ok, 'le responsable du jalon (ici le chef de projet) le déclare passé');
    ok(!w.codes().includes('CRITICAL_SLIP:' + w.j.id), 'le glissement critique d’un jalon passé n’est plus signalé');
    // prérequis : le jalon exige un livrable qui n'est pas terminé
    w.c.repoInsert('MilestoneRequirement', { milestone_id: w.late.id, deliverable_id: w.b.id }, w.S);
    ok(w.pass(MEMBER).ok);
    const codes = w.codes();
    ok(!codes.includes('LATE_ITEM:' + w.late.id) && codes.includes('MILESTONE_INCOMPLETE:' + w.late.id), 'plus de retard, mais « jalon marqué atteint alors que son livrable n’est pas terminé » reste : une incohérence, pas un retard');
    // un jalon à venir n'a jamais d'alerte d'échéance, passé ou non
    ok(!w.codes().includes('LATE_ITEM:' + w.j.id), 'un jalon à venir : aucune alerte de retard');
  });

  test('Le WBS dit quel jalon on peut déclarer passé et lequel l’est déjà', () => {
    const w = world();
    w.pass(MEMBER);
    const tree = (who) => w.call(who, 'wbs.tree', { projectId: w.p1.id }).nodes;
    const node = (who, id) => tree(who).find((n) => n.ref === id);
    eq([node(MEMBER, w.late.id).canPass, node(MEMBER, w.late.id).passed_on, node(MEMBER, w.late.id).late], [true, w.c.todayStr(), false], 'le responsable : peut le rouvrir, la date du passage, plus en retard');
    eq([node(MEMBER, w.j.id).canPass, node(MEMBER, w.cc.id).canPass], [false, false], 'Mia ne peut pas déclarer le jalon « Revue » (elle n’en est pas responsable), et un livrable n’a pas de passage');
    eq([node(CP, w.j.id).canPass, node(WPL, w.late.id).canPass, node(DPL, w.late.id).canPass], [true, true, true], 'le chef de projet, le Workpackage leader et le DPL : oui');
    eq(node(CP, w.j.id).passed_on, '', 'un jalon non passé : pas de date');
  });

  test('Mes jalons : ceux dont on est responsable, échus ou à venir sous 30 jours, puis passés depuis 30 jours ; tout projet confondu', () => {
    const w = world(), today = w.c.todayStr();
    const mk = (name, date, owner, extra) => w.call(CP, 'planitems.create', { values: Object.assign({ project_id: w.p1.id, name, item_type: 'Jalon', planned_start: date, planned_finish: date, wp_id: w.w1.id, owner_resource_id: owner.id }, extra || {}) });
    const soon = mk('Jalon sous dix jours', '2026-10-15', w.mia), far = mk('Jalon lointain', '2026-12-31', w.mia), others = mk('Jalon d’une autre personne', '2026-09-25', w.remi);
    const mine = () => w.call(MEMBER, 'milestones.mine', {});
    const m = mine();
    eq(m.pending.map((x) => x.name), ['Revue à date dépassée', 'Jalon sous dix jours'], 'le jalon échu d’abord, puis celui du mois ; ni le lointain, ni celui d’une autre personne');
    const late = m.pending[0];
    eq(w.call(WPL, 'milestones.mine', {}).pending.map((x) => x.name), ['Jalon d’une autre personne'], 'chacun ne voit que ses propres jalons : Rémi, le sien seulement');
    eq([late.late, late.late_days, late.project, late.wp, m.pending[1].late, m.pending[1].late_days], [true, 15, 'P1', '1 Conception', false, 0], 'échu depuis quinze jours, avec son projet et son workpackage ; l’autre n’est pas en retard');
    ok(w.pass(MEMBER).ok, 'le responsable déclare le jalon échu passé');
    const after = mine();
    eq([after.pending.map((x) => x.name), after.recent.map((x) => x.name + ':' + x.passed_on)], [['Jalon sous dix jours'], ['Revue à date dépassée:' + today]], 'il quitte la liste à traiter et passe dans « passés depuis 30 jours », avec sa date');
    w.c.repoUpdate('PlanItem', w.late.id, { actual_finish: w.c.addCalendarDays(today, -45) }, null, w.S);
    eq(mine().recent.length, 0, 'passé depuis plus de 30 jours : n’est plus proposé à la réouverture ici');
    w.c.repoUpdate('Project', w.p1.id, { status: 'Clos' }, null, w.S);
    eq([mine().pending.length, mine().recent.length], [0, 0], 'un projet clos n’apparaît plus');
  });

  test('Récapitulatif du matin : un jalon échu est rappelé à son responsable, puis à ceux qui pilotent s’il dure ; un jalon passé n’y figure plus', () => {
    const w = world(), today = w.c.todayStr();
    w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Jalon échu depuis peu', item_type: 'Jalon', planned_start: '2026-10-03', planned_finish: '2026-10-03', wp_id: w.w1.id, owner_resource_id: w.mia.id } });
    const recap = (email) => w.c.buildDigests(w.c.loadDigestData_(), today, { baseUrl: 'https://ppm.test/exec' }).filter((d) => d.to === email)[0];
    let mia = recap(MEMBER).text;
    ok(/◆ Revue à date dépassée/.test(mia) && /jalon échu depuis 15 jours \(le 20\/09\/2026\) : à déclarer passé ou à replanifier/.test(mia), 'le responsable lit : « jalon échu depuis 15 jours … à déclarer passé ou à replanifier » : ' + (mia.match(/◆ Revue à date dépassée[^\n]*\n?[^\n]*/) || [''])[0]);
    ok(/jalon échu depuis 2 jours/.test(mia), 'un jalon échu depuis deux jours est rappelé aussi, avec le bon nombre de jours');
    ok(mia.indexOf('view=structure&project=' + w.p1.id) >= 0, 'et le lien mène au WBS du projet, où se fait le passage');
    const cp = recap(CP).text;
    ok(/1 jalon échu depuis plus de 7 jours, non déclaré passé : Revue à date dépassée \(Mia\)/.test(cp) && !/Jalon échu depuis peu \(/.test(cp), 'le chef de projet est prévenu des jalons échus depuis plus de 7 jours (un seul ici : celui de deux jours attend encore)');
    ok(w.pass(MEMBER).ok);
    mia = recap(MEMBER).text;
    ok(!/Revue à date dépassée/.test(mia) && /Jalon échu depuis peu/.test(mia), 'déclaré passé : il disparaît du récapitulatif de son responsable ; l’autre y reste');
    ok(!/jalon échu depuis plus de 7 jours/.test(recap(CP).text) && !/jalons? échus? depuis plus de 7 jours/.test(recap(CP).text), 'et du rappel de ceux qui pilotent');
  });

  test('Les autres endroits qui parlent des jalons ne mentionnent plus un jalon passé : Overview, agenda, prochains jalons des actualités', () => {
    const w = world();
    const upcoming = () => w.call(CP, 'overview.get', { projectId: w.p1.id }).detail.milestones.map((m) => m.name);
    ok(upcoming().includes('Revue'), 'avant : le jalon « Revue » (9 novembre) est dans les prochains jalons de l’Overview');
    ok(w.raw(CP, 'milestone.pass', { id: w.j.id }).ok, 'son responsable le déclare passé (en avance)');
    ok(!upcoming().includes('Revue'), 'après : il n’est plus dans les prochains jalons');
    const project = w.c.repoGet('Project', w.p1.id), data = { planitems: w.c.repoList('PlanItem'), resources: w.c.repoList('Resource'), workpackages: w.c.repoList('WorkPackage'), settings: [] };
    const ev = w.c.desiredEvents_(data, project, '');
    ok(/^✓ ◆ /.test(ev[w.j.id].title) && !/^✓/.test(ev[w.late.id].title), 'l’agenda marque le jalon passé d’un ✓ et pas les autres : ' + ev[w.j.id].title);
    const prompt = w.call(CP, 'news.digest.prompt', { projectId: w.p1.id }).prompt;
    ok(!/Jalons à venir :.*Revue \(/.test(prompt), 'le prompt des actualités ne l’annonce plus comme à venir');
  });

  test('L’avancement d’un workpackage ou d’un sous-workpackage est hérité de ses livrables ET de ses jalons : un workpackage qui n’a qu’un jalon passé est à 100 %', () => {
    const w = world();
    const wp = (name, code, parent) => w.call(CP, 'wbs.create', { projectId: w.p1.id, kind: 'wp', parentId: parent ? parent.id : undefined, values: { name, wbs_code: code } });
    const ms = (wpx, name, date) => w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name, item_type: 'Jalon', planned_start: date, planned_finish: date, wp_id: wpx.id, owner_resource_id: w.mia.id } });
    const node = (kind, id) => w.call(CP, 'wbs.tree', { projectId: w.p1.id }).nodes.find((n) => n.ref === id && n.kind === kind);
    const ganttWp = (id) => w.call(CP, 'gantt.project', { projectId: w.p1.id }).rows.find((r) => r.kind === 'wp' && r.wp_id === id);
    // un workpackage qui n'a qu'un jalon
    const alone = wp('Jalons seuls', 'J1'), only = ms(alone, 'Revue seule', '2026-10-02');
    eq([node('wp', alone.id).progress, ganttWp(alone.id).progress], [0, 0], 'un jalon pas encore passé : le workpackage est à 0 %');
    ok(w.raw(MEMBER, 'milestone.pass', { id: only.id }).ok);
    eq([node('wp', alone.id).progress, ganttWp(alone.id).progress], [100, 100], 'le jalon est passé : le workpackage est à 100 % (arbre du WBS et planning)');
    w.raw(MEMBER, 'milestone.pass', { id: only.id, passed: false });
    eq(node('wp', alone.id).progress, 0, 'rouvert : retour à 0 %');
    // un sous-workpackage qui n'a qu'un jalon passé : son parent en hérite
    const parent = wp('Parent', 'P9'), child = wp('Enfant', 'P9.1', parent), cm = ms(child, 'Jalon enfant', '2026-10-02');
    w.raw(MEMBER, 'milestone.pass', { id: cm.id });
    eq([node('wp', child.id).progress, node('wp', parent.id).progress], [100, 100], 'le sous-workpackage est à 100 % et son parent, qui n’a que lui, aussi');
    // un mélange : un livrable de 5 jours ouvrés à 50 % et un jalon passé (un jour) : (5 × 50 + 1 × 100) / 6 = 42
    const mix = wp('Mélange', 'M1');
    const del = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable mélange', item_type: 'Livrable', planned_start: '2026-10-12', planned_finish: '2026-10-16', wp_id: mix.id, owner_resource_id: w.mia.id } });
    const mm = ms(mix, 'Jalon mélange', '2026-10-16');
    w.call(MEMBER, 'progress.declare', { planItemId: del.id, progressPct: 50 });
    eq(node('wp', mix.id).progress, 42, 'livrable à 50 % et jalon pas passé : (5 × 50 + 1 × 0) / 6 = 42');
    w.raw(MEMBER, 'milestone.pass', { id: mm.id });
    eq(node('wp', mix.id).progress, 58, 'jalon passé : (5 × 50 + 1 × 100) / 6 = 58');
    // un livrable seul n'est pas changé : un workpackage de livrables garde son avancement pondéré par la durée
    const dl = wp('Livrables seuls', 'L1');
    const d2 = w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Livrable seul', item_type: 'Livrable', planned_start: '2026-10-12', planned_finish: '2026-10-16', wp_id: dl.id, owner_resource_id: w.mia.id } });
    w.call(MEMBER, 'progress.declare', { planItemId: d2.id, progressPct: 40 });
    eq(node('wp', dl.id).progress, 40, 'sans jalon : l’avancement du livrable, comme avant');
  });
};
