/**
 * Essai de la liste de gauche du Planning (0.15.2) : lignes alignées sur les barres, repli, recherche, filtres, entête de dates fixe,
 * survol et sélection liés, éléments sans dates. Navigateur simulé (jsdom), vrai Core, « aujourd'hui » figé.
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_gantt_liste.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const frappePath = require.resolve(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'frappe-gantt/dist/frappe-gantt.min.js') : 'frappe-gantt/dist/frappe-gantt.min.js');
const { freshCore } = require('./harness');

const c = freshCore();
const S = { actor: 'setup', source: 'setup' };
const A = 'admin@entreprise.com';
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; };
const person = (name, email) => c.repoInsert('Resource', { resource_type: 'Interne', name, email, country: 'FR' }, S);
const alice = person('Alice', 'alice@entreprise.com'), bob = person('Bob', 'bob@entreprise.com');
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
const p2 = call(A, 'projects.create', { values: { code: 'P2', name: 'Outillage', program_id: prog.id, status: 'Actif', holiday_country: 'FR' } });
c.repoInsert('RoleAssignment', { resource_id: alice.id, role_code: 'CP', scope_type: 'project', scope_id: p1.id }, S);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1' } });
const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Structure', wbs_code: '1.1', parent_wp_id: w1.id } });
const w2 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Essais', wbs_code: '2' } });
const it = (p, name, type, s, f, wp, owner) => call(A, 'planitems.create', { values: { project_id: p.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '', owner_resource_id: owner ? owner.id : '' } });
const spec = it(p1, 'Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id, alice);        // finie depuis 5 jours : en retard
const plans = it(p1, 'Plans structure', 'Livrable', '2026-10-12', '2026-10-30', w11.id, alice);
const calc = it(p1, 'Note de calcul', 'Livrable', '2026-10-13', '2026-10-23', w11.id, bob);
const essai = it(p1, 'Essai statique', 'Livrable', '2026-11-02', '2026-11-13', w2.id, bob);
const cdr = it(p1, 'Revue CDR', 'Jalon', '2026-11-16', '2026-11-16', null);
const kick = it(p1, 'Lancement', 'Jalon', '2026-10-01', '2026-10-01', null);
const libre = it(p1, 'Sans date', 'Livrable', '', '', w2.id, null);
const tool = it(p2, 'Moule', 'Livrable', '2026-10-01', '2026-10-14', null, null);
c.repoUpdate('PlanItem', plans.id, { progress_pct: 40 }, null, S);
c.repoUpdate('PlanItem', kick.id, { progress_pct: 100, status: 'Terminé' }, null, S);
const mk = (a, b) => call(A, 'dependencies.create', { values: { predecessor_id: a.id, successor_id: b.id, dep_type: 'FS' } });
mk(spec, plans); mk(tool, plans); mk(plans, cdr);

const baseHtml = (() => {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Gantt.html'), 'utf8');
  html = html.replace('<?!= boot ?>', JSON.stringify({ project: p1.id, program: '', appsheetUrl: '', version: 'test' }));
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(__dirname, '..', 'src', n + '.html'), 'utf8'));
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + fs.readFileSync(frappePath, 'utf8') + '</script>');
  return html.replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
})();

c.todayStr = () => '2026-10-14'; // le serveur et la page ont le même « aujourd’hui » : le retard ne dépend pas de l’horloge de la machine
c.Session = { getActiveUser: () => ({ getEmail: () => 'alice@entreprise.com' }), getEffectiveUser: () => ({ getEmail: () => 'proprio@entreprise.com' }), getScriptTimeZone: () => 'Europe/Paris' };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 25));
let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };

function openPage(opts) {
  opts = opts || {};
  const dom = new JSDOM(baseHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      const Real = window.Date;
      class FakeDate extends Real {
        constructor(...a) { if (a.length) super(...a); else super(2026, 9, 14, 10, 0, 0); }
        static now() { return new Real(2026, 9, 14, 10, 0, 0).getTime(); }
      }
      window.Date = FakeDate;
      if (opts.width) Object.defineProperty(window, 'innerWidth', { value: opts.width, configurable: true });
      // les positions de défilement se retiennent, comme dans un vrai navigateur
      ['scrollLeft', 'scrollTop'].forEach((k) => Object.defineProperty(window.Element.prototype, k, { get() { return this['_' + k] || 0; }, set(v) { this['_' + k] = v; }, configurable: true }));
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      const runner = (ok, fail) => ({
        withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
        uiCall: (action, params, rid) => { const res = JSON.parse(JSON.stringify(c.uiCall(action, params, rid))); setTimeout(() => ok(res), 0); }
      });
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { console.error('Erreur page :', m); failed++; };
    }
  });
  const w = dom.window, doc = w.document;
  const until = async (cond, ms) => { for (let i = 0; i < (ms || 1500) / 20; i++) { if (cond()) return true; await tick(20); } return !!cond(); };
  return { dom, w, doc, until, flat: (t) => String(t).replace(/\s+/g, ' ').trim() };
}

(async () => {
  console.log('\nPage Planning : liste de gauche');
  const p = openPage(); await p.until(() => p.doc.querySelector('.bar-wrapper'));
  const doc = p.doc, w = p.w;
  const rowsL = () => [...doc.querySelectorAll('.pl-row')];
  const idsL = () => rowsL().map((r) => r.getAttribute('data-id'));
  const idsBars = () => [...doc.querySelectorAll('.bar-wrapper')].map((b) => b.getAttribute('data-id'));
  const names = () => rowsL().map((r) => p.flat(r.querySelector('.pl-text').textContent));
  const plan = () => doc.querySelector('.plan');

  // ---- alignement avec le diagramme
  check(!!doc.getElementById('plan-left') && !!doc.querySelector('.pl-head') && p.flat(doc.querySelector('.pl-head').textContent) === 'Élément Resp. Fin %', 'une liste de gauche, avec son entête : ' + p.flat(doc.querySelector('.pl-head').textContent));
  check(JSON.stringify(idsL()) === JSON.stringify(idsBars()) && idsL().length === doc.querySelectorAll('.grid-row').length, 'une ligne par barre, dans le même ordre (' + idsL().length + ' lignes)');
  check(names()[0] === '1 Conception' && names().indexOf('1.1 Structure') > names().indexOf('Spécification') && names().indexOf('1.1 Structure') < names().indexOf('2 Essais'), 'l’arbre : « 1 Conception », ses éléments, puis son sous-workpackage « 1.1 Structure » avant « 2 Essais »');
  const row = (id) => doc.querySelector('.pl-row[data-id="' + id + '"]');
  const lvl = (id) => Number(row(id).querySelector('.pl-name').getAttribute('style').match(/padding-left:(\d+)/)[1]);
  check(lvl('wp:' + w11.id) > lvl('wp:' + w1.id) && lvl(plans.id) > lvl('wp:' + w11.id), 'indentation : workpackage, sous-workpackage, ses éléments');
  check(p.flat(row(plans.id).textContent) === 'Plans structure Alice 30/10 40 %', 'un élément : nom, responsable, fin, avancement, séparés par des espaces : ' + p.flat(row(plans.id).textContent));
  check(/◆ Lancement/.test(row(kick.id).textContent) && /✓/.test(row(kick.id).textContent) && /◆ Revue CDR/.test(row(cdr.id).textContent) && !/✓/.test(row(cdr.id).textContent), 'jalons : losange devant le nom, coche s’ils sont terminés');
  check(/\[P2\] Moule/.test(row(tool.id).textContent) && row(tool.id).classList.contains('kind-external'), 'voisin d’un autre projet : [P2], en italique');
  check(row(spec.id).classList.contains('is-late') && row(plans.id).classList.contains('is-violated'), 'retard et dépendance non respectée en rouge');

  // ---- éléments sans dates
  const und = doc.getElementById('pl-undated');
  check(!!und && /Sans dates, donc sans barre \(1\)/.test(und.textContent) && /Sans date/.test(und.querySelector('button').textContent), 'sous la liste : les éléments sans dates, introuvables sur le diagramme');
  und.querySelector('button').click();
  await p.until(() => doc.querySelector('#details h2') && doc.querySelector('#details h2').textContent === 'Sans date');
  check(!!doc.getElementById('dep-add-pred') && !!doc.getElementById('deps'), 'on peut l’ouvrir : ses dépendances se gèrent enfin (liens vers un élément sans date)');
  doc.querySelector('#details .close').click();

  // ---- sélection et survol liés
  const scrolled = []; plan().scrollTo = (o) => scrolled.push(o);
  row(essai.id).click();
  await p.until(() => doc.querySelector('#details h2') && doc.querySelector('#details h2').textContent === 'Essai statique');
  check(row(essai.id).classList.contains('active') && scrolled.length === 1, 'cliquer une ligne ouvre le détail, la ligne reste marquée et le diagramme défile jusqu’à la barre');
  row(plans.id).dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
  check(row(plans.id).classList.contains('hover') && doc.querySelector('.bar-wrapper[data-id="' + plans.id + '"]').classList.contains('row-hover'), 'survoler une ligne met la barre en évidence');
  doc.getElementById('plan-left').dispatchEvent(new w.MouseEvent('mouseleave'));
  check(!doc.querySelector('.pl-row.hover') && !doc.querySelector('.bar-wrapper.row-hover'), 'sortie de la liste : plus rien en évidence');
  doc.querySelector('.bar-wrapper[data-id="' + calc.id + '"]').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 }));
  check(row(calc.id).classList.contains('hover'), 'survoler une barre met sa ligne en évidence');
  doc.querySelector('#details .close').click();
  check(!doc.querySelector('.pl-row.active'), 'fermer le détail retire la marque');

  // ---- replier, déplier
  const toggle = (id) => row(id).querySelector('.pl-toggle');
  const before = idsL().length;
  plan().scrollLeft = 500; plan().scrollTop = 120;
  toggle('wp:' + w1.id).click();
  check(idsL().length === before - 5 + 0 || idsL().length < before, 'replier « 1 Conception » cache ses éléments et son sous-workpackage : ' + before + ' → ' + idsL().length + ' lignes');
  check(!idsL().includes(spec.id) && !idsL().includes(plans.id) && !idsL().includes('wp:' + w11.id) && idsL().includes('wp:' + w1.id) && idsL().includes('wp:' + w2.id), 'ses descendants disparaissent, les autres workpackages restent');
  check(JSON.stringify(idsL()) === JSON.stringify(idsBars()), 'le diagramme suit : mêmes lignes, même ordre');
  check(toggle('wp:' + w1.id).getAttribute('aria-expanded') === 'false' && toggle('wp:' + w1.id).textContent === '▸', 'le bouton passe à « ▸ » et annonce « replié »');
  check(plan().scrollLeft === 500 && plan().scrollTop === 120, 'la position de défilement est conservée (pas de retour sur aujourd’hui ni en haut)');
  toggle('wp:' + w1.id).click();
  check(idsL().length === before && toggle('wp:' + w1.id).getAttribute('aria-expanded') === 'true', 'déplier rétablit tout');
  doc.getElementById('pl-collapse').click();
  check(idsL().filter((i) => /^wp:/.test(i)).length === 3 && !idsL().includes('wp:' + w11.id) && !idsL().includes(spec.id) && !idsL().includes(cdr.id) && idsL().includes(tool.id), '« Tout replier » : les trois workpackages de premier niveau (dont « Hors workpackage ») et le voisin d’un autre projet, qui n’est dans aucun');
  doc.getElementById('pl-expand').click();
  check(idsL().length === before, '« Tout déplier » rétablit tout');

  // ---- filtres
  const pill = (f) => doc.querySelector('#plan-tools .pill[data-filter="' + f + '"]');
  const items = () => idsL().filter((i) => !/^wp:/.test(i));
  pill('late').click();
  check(items().length === 1 && items()[0] === spec.id, '« En retard » : seule Spécification (finie le 09/10, nous sommes le 14) : ' + names().join(' | '));
  check(idsL().includes('wp:' + w1.id) && !idsL().includes('wp:' + w2.id), 'ses workpackages parents restent, les autres disparaissent');
  check(/1 élément affiché sur 8/.test(p.flat(doc.getElementById('pl-count').textContent)) && pill('late').getAttribute('aria-pressed') === 'true' && pill('all').getAttribute('aria-pressed') === 'false', 'le compteur dit « 1 élément affiché sur 8 » ; le filtre actif est marqué');
  pill('violated').click();
  check(items().length === 1 && items()[0] === plans.id, '« Non respectés » : Plans structure');
  pill('mine').click();
  check(items().sort().join() === [spec.id, plans.id].sort().join(), '« Les miens » : les éléments dont Alice est responsable (' + items().length + ')');
  pill('critical').click();
  check(items().length >= 1 && items().every((i) => row(i).classList.contains('kind-item')), '« Critiques » : éléments du chemin critique, sans les voisins d’un autre projet');
  pill('all').click();
  check(idsL().length === before && doc.getElementById('pl-count').textContent === '', '« Tous » : tout revient, le compteur s’efface');

  // ---- recherche
  const q = doc.getElementById('pl-q');
  q.value = 'plans'; q.dispatchEvent(new w.Event('input'));
  await p.until(() => items().length === 1);
  check(items()[0] === plans.id && idsL().includes('wp:' + w11.id) && idsL().includes('wp:' + w1.id), 'recherche « plans » : l’élément et son arbre de workpackages');
  q.value = 'bob'; q.dispatchEvent(new w.Event('input'));
  await p.until(() => items().length === 2);
  check(items().sort().join() === [calc.id, essai.id].sort().join(), 'recherche par responsable : « bob » trouve ses deux éléments');
  q.value = 'zzz'; q.dispatchEvent(new w.Event('input'));
  await p.until(() => /Aucun élément ne correspond/.test(doc.getElementById('host').textContent));
  check(/Aucun élément ne correspond/.test(doc.getElementById('host').textContent) && !doc.getElementById('plan-tools').hidden, 'rien trouvé : message clair, la barre de recherche reste là pour corriger');
  q.value = ''; q.dispatchEvent(new w.Event('input'));
  await p.until(() => idsL().length === before);
  check(idsL().length === before, 'effacer la recherche rétablit tout');
  plan().scrollLeft = 700;
  pill('late').click();
  check(plan().scrollLeft === 700 && plan().scrollTop === 0, 'un filtre garde la position horizontale et revient en haut de la liste');
  pill('all').click();

  // ---- entête de dates fixe
  const hdr = doc.querySelector('#host svg .sticky-header');
  check(!!hdr && !!hdr.querySelector('.grid-header') && hdr.querySelectorAll('.lower-text').length > 3 && !!hdr.querySelector('.today-chip') && doc.querySelector('#host svg').lastElementChild === hdr, 'l’entête (fond, mois, jours, pastille « Aujourd’hui ») est regroupé et passe au-dessus des barres');
  plan().scrollTop = 230; plan().dispatchEvent(new w.Event('scroll'));
  check(hdr.getAttribute('transform') === 'translate(0,230)', 'en descendant, l’entête se décale pour rester en haut : ' + hdr.getAttribute('transform'));
  plan().scrollTop = 0; plan().dispatchEvent(new w.Event('scroll'));

  // ---- masquer la liste
  doc.getElementById('pl-list').click();
  check(doc.getElementById('host').classList.contains('list-off') && doc.getElementById('pl-list').getAttribute('aria-pressed') === 'false', '« Liste » masque la liste de gauche');
  doc.getElementById('pl-list').click();
  check(!doc.getElementById('host').classList.contains('list-off'), 'et la réaffiche');

  // ---- changement de projet : on repart à zéro
  toggle('wp:' + w2.id).click(); pill('late').click();
  check(w.__ppm.state.filter === 'late' && w.__ppm.state.collapsed['wp:' + w2.id], 'un filtre et un repli sont en place avant de changer de projet');
  doc.getElementById('picker').value = 'project:' + p2.id; doc.getElementById('picker').dispatchEvent(new w.Event('change'));
  await p.until(() => /Moule/.test(doc.getElementById('host').textContent) && w.__ppm.state.projectId === p2.id);
  doc.getElementById('picker').value = 'project:' + p1.id; doc.getElementById('picker').dispatchEvent(new w.Event('change'));
  await p.until(() => w.__ppm.state.projectId === p1.id && doc.querySelector('.pl-row'));
  check(w.__ppm.state.filter === 'all' && JSON.stringify(w.__ppm.state.collapsed) === '{}' && idsL().length === before && pill('all').getAttribute('aria-pressed') === 'true', 'changer de projet réinitialise filtre et replis');

  // ---- vue programme
  doc.getElementById('picker').value = 'program:' + prog.id; doc.getElementById('picker').dispatchEvent(new w.Event('change'));
  await p.until(() => w.__ppm.state.mode === 'program' && doc.querySelector('.pl-row'));
  const head = p.flat(doc.querySelector('.pl-head').textContent);
  check(doc.getElementById('plan-tools').hidden && /^Projet Chef Fin %$/.test(head), 'vue programme : pas de filtres, entête « Projet / Chef / Fin / % »');
  check(rowsL().some((r) => /P1 Nacelle/.test(r.textContent) && r.classList.contains('kind-project')) && rowsL().some((r) => /◆/.test(r.textContent)) && JSON.stringify(idsL()) === JSON.stringify(idsBars()), 'les projets et leurs jalons, alignés sur les barres');
  p.dom.window.close();

  // ---- téléphone : la liste est fermée au départ
  const m = openPage({ width: 390 }); await m.until(() => m.doc.querySelector('.bar-wrapper'));
  check(m.doc.getElementById('host').classList.contains('list-off') && m.doc.getElementById('pl-list').getAttribute('aria-pressed') === 'false', 'sur un écran étroit, la liste est fermée au départ (le diagramme garde toute la largeur)');
  m.doc.getElementById('pl-list').click();
  check(!m.doc.getElementById('host').classList.contains('list-off'), 'et un bouton l’ouvre');
  m.dom.window.close();

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPlanning, liste de gauche : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
