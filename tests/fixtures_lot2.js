/**
 * Jeu de données des tests du lot 2 (date du jour : lundi 5 octobre 2026, calendrier FR).
 *
 *   Programme PG ─ projet P1 « Projet 1 » (chef de projet Carla)
 *     WP 1 Conception (Rémi)          A Spécification   05/10 → 09/10  (Rémi)
 *       WP 1.1 Calcul                 B Calcul          12/10 → 23/10  (Rémi)
 *     WP 2 Essais (Carla)             C Essais          26/10 → 06/11  (Carla)
 *     (hors WP)                       J Revue (jalon)   09/11          (Carla)
 *   A → B → C → J (fin-début)
 *
 *   Rôles : Dora DPL du programme, Carla CP, Rémi RWP du WP 1, Mia membre du projet.
 *   Xavier : externe, adresse hors domaine.
 */
const { freshCore } = require('./harness');

function lot2World(opts = {}) {
  const c = freshCore(opts);
  const S = { actor: 'setup', source: 'setup' };
  c.seedHolidays_([2026, 2027]);
  const A = 'admin@entreprise.com';
  const raw = (email, action, params) => c.handleRequest({ action, params: params || {}, apiVersion: '1.0' }, email);
  const call = (email, action, params) => {
    const r = raw(email, action, params);
    if (!r.ok) throw new Error(action + ' (' + email + ') : ' + JSON.stringify(r.error));
    return r.data;
  };
  const res = (name, email, extra) => c.repoInsert('Resource', Object.assign({ resource_type: 'Interne', name, email: email || '', country: 'FR' }, extra || {}), S);
  const carla = res('Carla', 'carla@entreprise.com', { job_function: 'Cheffe de projet' });
  const remi = res('Rémi', 'remi@entreprise.com');
  const mia = res('Mia', 'mia@entreprise.com');
  const dora = res('Dora', 'dora@entreprise.com');
  const xavier = res('Xavier', 'xavier@alpha-sous-traitance.com', { resource_type: 'Externe' });
  const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme' } });
  const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Projet 1', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: carla.id } });
  const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Projet vide', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } });
  const role = (r, code, type, id) => c.repoInsert('RoleAssignment', { resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, S);
  role(dora, 'DPL', 'program', prog.id);
  role(carla, 'CP', 'project', p1.id);
  role(mia, 'MEMBER', 'project', p1.id);
  const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, wbs_code: '1', name: 'Conception', owner_resource_id: remi.id } });
  const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, wbs_code: '1.1', name: 'Calcul', parent_wp_id: w1.id } });
  const w2 = call(A, 'workpackages.create', { values: { project_id: p1.id, wbs_code: '2', name: 'Essais', owner_resource_id: carla.id } });
  role(remi, 'RWP', 'workpackage', w1.id);
  const item = (name, type, s, f, wp, owner) => call(A, 'planitems.create', { values: {
    project_id: p1.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp ? wp.id : '', owner_resource_id: owner.id } });
  const a = item('Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1, remi);
  const b = item('Calcul', 'Livrable', '2026-10-12', '2026-10-23', w11, remi);
  const cc = item('Essais', 'Livrable', '2026-10-26', '2026-11-06', w2, carla);
  const j = item('Revue', 'Jalon', '2026-11-09', '2026-11-09', null, carla);
  [[a, b], [b, cc], [cc, j]].forEach((x) => call(A, 'dependencies.create', { values: { predecessor_id: x[0].id, successor_id: x[1].id, dep_type: 'FS' } }));
  c.SENT_MAILS.length = 0;
  return { c, S, A, raw, call, carla, remi, mia, dora, xavier, prog, p1, p2, w1, w11, w2, a, b, cc, j };
}

module.exports = { lot2World };
