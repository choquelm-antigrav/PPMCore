/* Aperçu de la démo complète (A2_SEED_DEMO) : node tests/preview_demo.js 8124 — puis ?view=overview, ?view=structure&project=p1, etc. Produit à partir de preview_server.js. */
/**
 * Aperçu de la démo complète local des pages (Planning, Structure, Suivi) avec un jeu de données fourni (hors production) :
 *   node tests/preview_server.js 8123   puis ouvrir http://localhost:8123/?view=suivi&project=p1
 * Le planning a besoin de frappe-gantt installé localement (variable UI_DEPS = dossier node_modules).
 * Agenda et Drive sont simulés ; ?as=<adresse> change l'utilisateur.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { freshCore, fakeWorkspace } = require('./harness');

const c = freshCore();
const A = 'admin@entreprise.com';
const S = { actor: 'setup', source: 'setup' };
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(action + ' : ' + JSON.stringify(r.error)); return r.data; };
c.Session = { getActiveUser: () => ({ getEmail: () => A }), getEffectiveUser: () => ({ getEmail: () => A }) };
console.log(c.seedDemo_());
const p1 = c.repoList('Project').find((p) => p.code === 'NAC-1');
const prog = c.repoList('Program')[0];
c.setProp(c.PROP.AI_MODE, process.env.AI_MODE || 'off');
c.runRules();
c.backupBooks_ = () => {};
c.setProp(c.PROP.DATA_ID, 'donnees'); c.setProp(c.PROP.HISTORY_ID, 'historique');
c.TRIGGER_LIST = () => ['nightlyRun', 'sendDigests'];
c.nightlyRun();
call('admin@entreprise.com', 'admin.set', { values: { ai_quota: 40, logo_url: 'https://exemple.test/logo.svg' } });
// (la démo complète contient déjà budget, CPN, commandes d'achat et risques)

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const deps = process.env.UI_DEPS || path.join(__dirname, '..', 'node_modules');
const pages = Object.fromEntries(c.PPM_PAGES.map((p) => [p.view, p.file + '.html'])); // registre des pages (src/00_Pages.gs)
function template(view) {
  let html = src(pages[view] || 'Structure.html').replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'));
  if (view === 'gantt') {
    const dist = path.join(deps, 'frappe-gantt', 'dist');
    html = html.replace(/<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr[^"]+">/, '<style>' + fs.readFileSync(path.join(dist, 'frappe-gantt.css'), 'utf8') + '</style>')
      .replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(path.join(dist, 'frappe-gantt.min.js'), 'utf8') + '</script>');
  }
  return html;
}
const stub = `<script>(function(){function mk(ok,fail){return{withSuccessHandler:function(f){return mk(f,fail)},withFailureHandler:function(f){return mk(ok,f)},uiCall:function(a,p,r){fetch('/rpc',{method:'POST',body:JSON.stringify({a:a,p:p,r:r})}).then(function(x){return x.json()}).then(ok).catch(fail)}}}window.google={script:{run:mk(),history:{replace:function(){}}}};})();</script>`;
let user = A;
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
  const defTab = (c.PPM_PAGES.find((p) => p.view === view) || { tabs: [''] }).tabs[0];
  const boot = { project: url.searchParams.get('project') === 'p1' ? p1.id : (url.searchParams.get('project') || ''), program: '', tab: url.searchParams.get('tab') || defTab, mode: url.searchParams.get('mode') || '', baseUrl: '', appsheetUrl: '', version: 'preview', view: view, home: 'gantt', isAdmin: (url.searchParams.get('as') || user) === 'admin@entreprise.com', canBudget: true };
  if (url.searchParams.get('program')) boot.program = prog.id;
  const as = url.searchParams.get('as');
  const rpc = as ? '/rpc?as=' + encodeURIComponent(as) : '/rpc';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(template(view).replace('<?!= boot ?>', JSON.stringify(boot)).replace('<script>\nvar BOOT', stub.replace("'/rpc'", "'" + rpc + "'") + '<script>\nvar BOOT'));
});
server.listen(Number(process.argv[2]) || 8123, () => console.log('Aperçu : http://localhost:' + (process.argv[2] || 8123) + '/?view=structure&project=p1'));
