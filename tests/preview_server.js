/**
 * Aperçu local des pages (Planning, Structure, Suivi) avec un jeu de données fourni (hors production) :
 *   node tests/preview_server.js 8123   puis ouvrir http://localhost:8123/?view=suivi&project=p1
 * Le planning a besoin de frappe-gantt installé localement (variable UI_DEPS = dossier node_modules).
 * Agenda et Drive sont simulés ; ?as=<adresse> change l'utilisateur.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { freshCore, fakeWorkspace } = require('./harness');

const c = freshCore();
const S = { actor: 'setup', source: 'setup' };
const A = 'admin@entreprise.com';
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(action + ' : ' + JSON.stringify(r.error)); return r.data; };
const orgs = ['Maison mère', 'Bureau d’études', 'Sous-traitant Alpha', 'Sous-traitant Beta'];
const team = c.repoInsert('HierarchicalTeam', { name: 'Direction technique', cost_center: 'CC-100' }, S);
const tConc = c.repoInsert('HierarchicalTeam', { name: 'Conception', parent_team_id: team.id, cost_center: 'CC-110' }, S);
const tEss = c.repoInsert('HierarchicalTeam', { name: 'Essais', parent_team_id: team.id, cost_center: 'CC-120' }, S);
const tStr = c.repoInsert('HierarchicalTeam', { name: 'Structure', parent_team_id: tConc.id }, S);
const P = (name, email, fn, org, extra) => c.repoInsert('Resource', Object.assign({ resource_type: 'Interne', name, email, job_function: fn, organization: org, country: 'FR' }, extra || {}), S);
const anna = P('Anna Lefèvre', 'anna@entreprise.com', 'Directrice de programme', orgs[0], { team_id: team.id });
const dan = P('Dan Moreau', 'dan@entreprise.com', 'Responsable de domaine structure', orgs[0], { team_id: team.id });
const emma = P('Emma Roussel', 'emma@entreprise.com', 'Responsable de domaine systèmes', orgs[0], { team_id: team.id });
const alice = P('Alice Bernard', 'alice@entreprise.com', 'Cheffe de projet nacelle', orgs[1], { team_id: tConc.id });
const bob = P('Bob Martin', 'bob@entreprise.com', 'Planificateur', orgs[1], { team_id: tConc.id });
const carl = P('Carl Weber', '', 'Ingénieur essais', orgs[2], { resource_type: 'Externe', country: 'DE', supplier: 'Alpha Test GmbH', team_id: tEss.id });
const dora = P('Dora Schmidt', '', 'Responsable qualification', orgs[3], { resource_type: 'Externe', country: 'DE', team_id: tEss.id });
const fay = P('Fay Colin', 'fay@entreprise.com', 'Ingénieure structure', orgs[1], { team_id: tStr.id });
const gus = P('Gustave Petit', 'gus@entreprise.com', 'Ingénieur matériaux', orgs[1], { team_id: tStr.id });
const hana = P('Hana Iyer', '', 'Analyste calcul', orgs[2], { resource_type: 'Externe', country: 'IN', team_id: tStr.id });
P('Nina Roux', 'nina@entreprise.com', 'Ingénieure calcul', orgs[1], { team_id: tStr.id });
P('Paul Roy', '', 'Contrôleur essais', orgs[2], { resource_type: 'Externe', country: 'DE', supplier: 'Alpha Test GmbH' });
const ines = P('Inès Girard', 'ines@entreprise.com', '', '', { team_id: tConc.id });
c.repoUpdate('HierarchicalTeam', team.id, { manager_resource_id: anna.id }, null, S);
c.repoUpdate('HierarchicalTeam', tConc.id, { manager_resource_id: alice.id }, null, S);
c.repoUpdate('HierarchicalTeam', tEss.id, { manager_resource_id: dora.id }, null, S);
c.repoUpdate('HierarchicalTeam', tStr.id, { manager_resource_id: fay.id }, null, S);
const prog = call(A, 'programs.create', { values: { code: 'NAC', name: 'Programme nacelle' } });
const p1 = call(A, 'projects.create', { values: { code: 'NAC-1', name: 'Nacelle moteur', program_id: prog.id, status: 'Actif', manager_resource_id: alice.id, end_date: '2027-03-31' } });
const p2 = call(A, 'projects.create', { values: { code: 'NAC-2', name: 'Systèmes embarqués', program_id: prog.id, status: 'Actif', manager_resource_id: emma.id } });
const role = (r, code, type, id) => c.repoInsert('RoleAssignment', { resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, S);
role(anna, 'PL', 'program', prog.id); role(dan, 'DPL', 'program', prog.id); role(emma, 'DPL', 'program', prog.id);
role(alice, 'CP', 'project', p1.id); role(bob, 'CP', 'project', p1.id); role(emma, 'CP', 'project', p2.id);
const wp = (name, code, owner, parent, cc) => call(A, 'workpackages.create', { values: { project_id: p1.id, name, wbs_code: code, owner_resource_id: owner.id, parent_wp_id: parent || '', charge_code: cc || '' } });
const w1 = wp('Conception', '1', alice, '', 'NAC-001'), w11 = wp('Structure primaire', '1.1', fay, w1.id), w12 = wp('Matériaux et procédés', '1.2', gus, w1.id);
const w2 = wp('Essais', '2', carl, '', 'NAC-002'), w21 = wp('Essais statiques', '2.1', carl, w2.id), w22 = wp('Qualification', '2.2', dora, w2.id);
const w3 = wp('Industrialisation', '3', bob, '', 'NAC-003');
[[fay, 'RWP', w11], [gus, 'RWP', w12], [carl, 'RWP', w21], [dora, 'RWP', w22], [bob, 'RWP', w3]].forEach((x) => role(x[0], x[1], 'workpackage', x[2].id));
role(hana, 'MEMBER', 'workpackage', w11.id); role(ines, 'MEMBER', 'project', p1.id); role(carl, 'MEMBER', 'workpackage', w22.id);
const it = (name, type, s, f, w, owner, pct) => call(A, 'planitems.create', { values: { project_id: p1.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: w ? w.id : '', owner_resource_id: owner.id, progress_pct: pct || 0 } });
const l = [
  it('Spécification structure', 'Livrable', '2026-10-05', '2026-10-30', w11, fay, 100),
  it('Note de calcul primaire', 'Livrable', '2026-11-02', '2026-12-11', w11, hana, 40),
  it('Choix matériaux', 'Livrable', '2026-10-12', '2026-11-13', w12, gus, 60),
  it('Plan d’essais statiques', 'Livrable', '2026-11-16', '2026-12-18', w21, carl),
  it('Rapport d’essais statiques', 'Livrable', '2027-01-11', '2027-02-26', w21, carl),
  it('Dossier de qualification', 'Livrable', '2027-02-01', '2027-03-19', w22, dora),
  it('Gamme d’industrialisation', 'Livrable', '2026-12-14', '2027-02-12', w3, bob),
  it('Revue critique de conception', 'Jalon', '2026-12-18', '2026-12-18', null, alice)
];
[[0, 1], [2, 1], [1, 3], [3, 4], [4, 5], [1, 6], [1, 7]].forEach((d) => call(A, 'dependencies.create', { values: { predecessor_id: l[d[0]].id, successor_id: l[d[1]].id, dep_type: 'FS' } }));

// Lot 2 : baseline B0 figée, puis quelques écarts, une demande de rebaselining, agenda et Drive simulés.
c.WORKSPACE = fakeWorkspace();
c.seedHolidays_([2026, 2027]);
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
call('alice@entreprise.com', 'baselines.create', { projectId: p1.id, justification: 'Planning validé en revue de lancement' });
const byName = (n) => c.repoList('PlanItem').find((i) => i.name === n);
call('alice@entreprise.com', 'planitems.update', { id: byName('Note de calcul primaire').id, patch: { planned_finish: '2026-12-18' } });
call('alice@entreprise.com', 'planitems.update', { id: byName('Rapport d’essais statiques').id, patch: { planned_finish: '2027-03-09' } });
call('alice@entreprise.com', 'planitems.update', { id: byName('Choix matériaux').id, patch: { owner_resource_id: fay.id } });
call('alice@entreprise.com', 'planitems.create', { values: { project_id: p1.id, wp_id: w12.id, name: 'Essais de fatigue matériaux', item_type: 'Livrable', planned_start: '2026-11-16', planned_finish: '2026-12-04', owner_resource_id: gus.id } });
c.repoInsert('RoleAssignment', { resource_id: ines.id, role_code: 'MEMBER', scope_type: 'project', scope_id: p1.id }, S);
call('ines@entreprise.com', 'baselines.request', { projectId: p1.id, justification: 'Le fournisseur des éprouvettes annonce deux semaines de retard.' });
call('fay@entreprise.com', 'progress.declare', { planItemId: byName('Note de calcul primaire').id, progressPct: 35, comment: 'Calculs en cours, mais en attente fournisseur pour les données matière' });
c.setProp(c.PROP.AI_MODE, process.env.AI_MODE || 'off');
c.runRules();
c.backupBooks_ = () => {};
c.setProp(c.PROP.DATA_ID, 'donnees'); c.setProp(c.PROP.HISTORY_ID, 'historique');
c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];
c.nightlyRun();
call('admin@entreprise.com', 'admin.set', { values: { ai_quota: 40, logo_url: 'https://exemple.test/logo.svg' } });
{ // budget, CPN et commandes d'achat d'exemple
  const A = 'alice@entreprise.com';
  const res = (n) => c.repoList('Resource').find((r) => r.name === n);
  const wp = (n) => c.repoList('WorkPackage').find((x) => x.name === n && !x.parent_wp_id);
  const pid = byName('Note de calcul primaire').project_id;
  call(A, 'rates.set', { values: { profile: 'Ingénieur', country: 'FR', daily_rate: 540, effective_date: '2026-01-01' } });
  call(A, 'rates.assign', { resource_id: res('Fay Colin').id, rate_profile: 'Ingénieur' });
  call(A, 'cpn.set', { projectId: pid, cpn: 'CPN-2401', cpn_label: 'Nacelle NAC-1 — conception' });
  call(A, 'wbs.update', { kind: 'wp', id: wp('Essais').id, patch: { cpn: 'CPN-2402', cpn_label: 'Nacelle NAC-1 — essais' } });
  call(A, 'budget.line.save', { values: { deliverable_id: byName('Note de calcul primaire').id, resource_id: res('Fay Colin').id, planned_days: 22 } });
  call(A, 'budget.line.save', { values: { deliverable_id: byName('Rapport d’essais statiques').id, resource_id: res('Carl Weber').id, fixed_amount: 18000 } });
  call(A, 'budget.line.save', { values: { deliverable_id: byName('Plan d’essais statiques').id, resource_id: res('Carl Weber').id, fixed_amount: 6000 } });
  const link = (name, amount) => ({ deliverable_id: byName(name).id, amount });
  call(A, 'po.save', { values: { po_number: 'CB-458812', cpn: 'CPN-2402', resource_id: res('Carl Weber').id, description: 'Essais statiques, banc 2', start_date: '2026-09-01', end_date: '2026-12-18', amount: 15000, status: 'Lancée', gr_due_date: '2026-10-01' }, links: [link('Rapport d’essais statiques', 15000)] });
  call(A, 'po.save', { values: { po_number: 'CB-459107', cpn: 'CPN-2402', resource_id: res('Carl Weber').id, description: 'Plan d’essais', start_date: '2026-10-05', end_date: '2026-11-13', amount: 6500, status: 'Lancée', gr_due_date: '2026-10-09' }, links: [link('Plan d’essais statiques', 6500)] });
  c.repoInsert('RiskOpportunity', { project_id: pid, kind: 'Risque', title: 'Retard du banc d’essais', probability: 4, impact: 5, score: 20, status: 'Ouvert' }, S);
  c.repoInsert('RiskOpportunity', { project_id: pid, kind: 'Risque', title: 'Données matière tardives', probability: 3, impact: 3, score: 9, status: 'Ouvert' }, S);
  call(A, 'po.save', { values: { po_number: 'CB-460001', cpn: 'CPN-2402', resource_id: res('Dora Schmidt').id, description: 'Qualification', amount: 4000, status: 'À faire', gr_due_date: '2027-01-20' }, links: [] });
}

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const deps = process.env.UI_DEPS || path.join(__dirname, '..', 'node_modules');
const pages = { structure: 'Structure.html', suivi: 'Suivi.html', gantt: 'Gantt.html', copilote: 'Copilote.html', compte: 'Compte.html', admin: 'Admin.html', budget: 'Budget.html', overview: 'Overview.html', ressources: 'Ressources.html', actualites: 'Actualites.html' };
function template(view) {
  let html = src(pages[view] || 'Structure.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Header') ?>", src('Header.html'));
  if (view === 'gantt') {
    const dist = path.join(deps, 'frappe-gantt', 'dist');
    html = html.replace(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr[^"]+">/, '<style>' + fs.readFileSync(path.join(dist, 'frappe-gantt.css'), 'utf8') + '</style>')
      .replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(path.join(dist, 'frappe-gantt.min.js'), 'utf8') + '</script>');
  }
  return html;
}
const stub = `<script>(function(){function mk(ok,fail){return{withSuccessHandler:function(f){return mk(f,fail)},withFailureHandler:function(f){return mk(ok,f)},uiCall:function(a,p,r){fetch('/rpc',{method:'POST',body:JSON.stringify({a:a,p:p,r:r})}).then(function(x){return x.json()}).then(ok).catch(fail)}}}window.google={script:{run:mk(),history:{replace:function(){}}}};})();</script>`;
let user = 'alice@entreprise.com';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const q = JSON.parse(body);
      c.Session = { getActiveUser: () => ({ getEmail: () => url.searchParams.get('as') || user }) };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(c.uiCall(q.a, q.p, q.r)));
    }); return;
  }
  const view = url.searchParams.get('view') || 'structure';
  const defTab = { structure: 'obs', suivi: 'ecarts', gantt: '', copilote: 'synthese', compte: 'fiche', admin: 'reglages', budget: 'bilan', overview: '', ressources: '', actualites: '' }[view];
  const boot = { project: url.searchParams.get('project') === 'p1' ? p1.id : (url.searchParams.get('project') || ''), program: '', tab: url.searchParams.get('tab') || defTab, mode: url.searchParams.get('mode') || '', baseUrl: '', appsheetUrl: '', version: 'preview', view: view, home: 'gantt', isAdmin: (url.searchParams.get('as') || user) === 'admin@entreprise.com', canBudget: true };
  if (url.searchParams.get('program')) boot.program = prog.id;
  const as = url.searchParams.get('as');
  const rpc = as ? '/rpc?as=' + encodeURIComponent(as) : '/rpc';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(template(view).replace('<?!= boot ?>', JSON.stringify(boot)).replace('<script>\nvar BOOT', stub.replace("'/rpc'", "'" + rpc + "'") + '<script>\nvar BOOT'));
});
server.listen(Number(process.argv[2]) || 8123, () => console.log('Aperçu : http://localhost:' + (process.argv[2] || 8123) + '/?view=structure&project=p1'));
