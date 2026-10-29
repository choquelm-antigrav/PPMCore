/**
 * Essai de la page Suivi et de la baseline « fantôme » du Gantt (jsdom, vrai Core, faux Workspace).
 *   npm i --no-save jsdom@24 frappe-gantt@0.6.1 && node tests/ui_suivi.js
 */
const fs = require('fs');
const path = require('path');
const dep = (m) => (process.env.UI_DEPS ? path.join(process.env.UI_DEPS, m) : m);
const { JSDOM } = require(dep('jsdom'));
const frappePath = require.resolve(dep('frappe-gantt/dist/frappe-gantt.min.js'));
const { fakeWorkspace } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
c.WORKSPACE = fakeWorkspace();
const CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com', RWP = 'remi@entreprise.com';
const budgetLine = c.repoInsert('BudgetLine', { deliverable_id: w.cc.id, resource_id: w.carla.id, cost_type: 'Forfait', fixed_amount: 1000 }, w.S);
const style = fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(file, user, boot, extraScript) {
  let html = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')
    .replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", style).replace("<?!= include('Common') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Common.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'))
    .replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: w.p1.id, program: '', tab: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test' }, boot || {})))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '');
  if (extraScript) html = html.replace(/<script src="https:\/\/cdn\.jsdelivr[^"]+"><\/script>/, '<script>' + extraScript + '</script>');
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.SVGElement.prototype.getBBox = function () { return { x: 0, y: 0, width: 40, height: 12, x2: 40 }; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      function runner(ok, fail) {
        return {
          withSuccessHandler: (f) => runner(f, fail),
          withFailureHandler: (f) => runner(ok, f),
          uiCall: (action, params, rid) => {
            calls.push(action);
            c.Session = { getActiveUser: () => ({ getEmail: () => user }) };
            const out = JSON.parse(JSON.stringify(c.uiCall(action, params, rid)));
            if (ok) setTimeout(() => ok(out), 0);
          }
        };
      }
      window.google = { script: { run: runner(null, null), history: { replace() {} } } };
      window.onerror = (m) => { failed++; console.error('Erreur dans la page :', m); };
    }
  });
  const win = dom.window, doc = win.document;
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = (id) => (doc.getElementById(id) || { textContent: '' }).textContent;
  const button = (label, root) => [...(root || doc).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label) && !b.closest('[hidden]'));
  const fill = (id, v) => { doc.getElementById(id).value = v; };
  return { win, doc, calls, until, click, text, button, fill };
}

(async () => {
  console.log('\nPage Suivi (jsdom)');

  // ---------------------------------------------------------------- sans baseline, chef de projet
  let p = openPage('Suivi.html', CP);
  await p.until(() => p.text('panel-ecarts').includes('Pas encore de baseline'));
  check(p.text('title') === 'P1 Projet 1', 'titre : ' + p.text('title'));
  check(p.text('context') === 'Pas de baseline', 'contexte : ' + p.text('context'));
  check(p.doc.getElementById('nav-plan').getAttribute('href') === 'https://app.test/exec?view=gantt&project=' + w.p1.id, 'lien vers le planning');
  const b0btn = p.button('Figer la baseline B0', p.doc.getElementById('panel-ecarts'));
  check(!!b0btn, 'bouton « Figer la baseline B0 » proposé au chef de projet');
  p.click(b0btn);
  check(p.doc.getElementById('form').open && p.doc.getElementById('form-label').value === 'B0', 'boîte de gel ouverte, libellé B0 proposé');
  p.click(p.doc.getElementById('form-ok'));
  check(/obligatoire/.test(p.text('toast')), 'justification obligatoire : ' + p.text('toast'));
  p.fill('form-reason', 'Planning validé en revue de lancement');
  p.click(p.doc.getElementById('form-ok'));
  await p.until(() => /Baseline B0 figée/.test(p.text('toast')));
  check(/4 éléments/.test(p.text('toast')), 'confirmation : ' + p.text('toast'));
  await p.until(() => p.doc.querySelector('#panel-ecarts .cards'));
  check(/B0 active/.test(p.text('context')), 'contexte : ' + p.text('context'));
  check(p.text('panel-ecarts').includes('Aucun écart'), 'aucun écart juste après le gel');

  // ---------------------------------------------------------------- écarts après modifications
  w.call(RWP, 'planitems.update', { id: w.b.id, patch: { planned_finish: '2026-10-28' } });
  w.call(CP, 'planitems.update', { id: w.cc.id, patch: { owner_resource_id: w.remi.id } });
  c.repoUpdate('BudgetLine', budgetLine.id, { fixed_amount: 1200 }, null, w.S);
  w.call(CP, 'planitems.create', { values: { project_id: w.p1.id, name: 'Rapport <img src=x>', item_type: 'Livrable', planned_start: '2026-11-02', planned_finish: '2026-11-06' } });
  p.click(p.doc.getElementById('reload'));
  await p.until(() => p.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]').length === 3);
  const rows = [...p.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]')].map((r) => [...r.cells].map((c2) => c2.textContent));
  check(rows[0][0].startsWith('Calcul') && rows[0][3] === '+3 jours' && rows[0][6] === 'Modifié', 'Calcul glissé de 3 jours : ' + rows[0].join(' | '));
  check(rows.some((r) => r[0].startsWith('Essais') && r[4] === 'Carla → Rémi'), 'changement de responsable');
  check(rows.some((r) => r[0].startsWith('Rapport <img') && r[6] === 'Ajouté'), 'élément ajouté, nom affiché en texte');
  check(p.doc.querySelectorAll('img:not(#ppm-logo)').length === 0, 'aucune balise injectée');
  const cards = [...p.doc.querySelectorAll('#panel-ecarts .card')].map((x) => x.textContent);
  check(cards.some((x) => /^Éléments glissés1jusqu’à 3 jours ouvrés/.test(x)), 'carte des glissements : ' + cards.join(' / '));
  check(cards.some((x) => /^Budget prévu1\s200\s€\+200\s€ par rapport à la référence/.test(x)), 'budget et écart visibles pour le chef de projet : ' + cards.join(' / '));
  check(rows.some((r) => r[0].startsWith('Essais') && /\+200/.test(r[5])), 'écart de budget sur la ligne du livrable');
  // la décomposition du budget figée avec la baseline (0.19.2) : section dépliable, lue à la demande
  await p.until(() => p.doc.getElementById('decomp-toggle'));
  const callsBefore = p.calls.filter((x) => x === 'baselines.decomposition').length;
  check(p.doc.getElementById('decomp-toggle').getAttribute('aria-expanded') === 'false' && p.doc.getElementById('decomp-body').hidden && callsBefore === 0, 'écarts de baseline : la section « Décomposition du budget » est repliée et rien n’est chargé tant qu’on ne la déplie pas');
  p.doc.getElementById('decomp-toggle').dispatchEvent(new p.win.Event('click', { bubbles: true }));
  await p.until(() => p.doc.querySelector('#decomp-body tr[data-line]'));
  check(p.calls.filter((x) => x === 'baselines.decomposition').length === 1 && !p.doc.getElementById('decomp-body').hidden, 'dépliée : l’action baselines.decomposition est appelée une seule fois');
  check(/Essais/.test(p.text('decomp-body')) && /Modifié/.test(p.text('decomp-body')) && /1\s?000/.test(p.text('decomp-body')) && /1\s?200/.test(p.text('decomp-body')), 'la ligne de coût modifiée : 1 000 € → 1 200 € : ' + p.text('decomp-body').slice(0, 140));
  check(/1 ligne de coût modifiée/.test(p.text('decomp-sum')) && /\+/.test(p.text('decomp-sum')), 'le titre résume : ' + p.text('decomp-sum'));
  p.doc.getElementById('decomp-toggle').dispatchEvent(new p.win.Event('click', { bubbles: true }));
  p.doc.getElementById('decomp-toggle').dispatchEvent(new p.win.Event('click', { bubbles: true }));
  check(p.calls.filter((x) => x === 'baselines.decomposition').length === 1, 'replier puis déplier : pas de nouvel appel');
  const pm = openPage('Suivi.html', MEMBER);
  await pm.until(() => pm.doc.querySelector('#panel-ecarts .cards'));
  check(![...pm.doc.querySelectorAll('#panel-ecarts .card')].some((x) => /Budget/.test(x.textContent)) && ![...pm.doc.querySelectorAll('#panel-ecarts th')].some((x) => x.textContent === 'Budget'),
    'aucun montant pour un simple membre');
  check(!pm.doc.getElementById('decomp-toggle'), 'et pas de section « Décomposition du budget » : réservée à ceux qui voient le budget');
  const only = p.doc.getElementById('only-changes');
  only.checked = false; only.dispatchEvent(new p.win.Event('change'));
  check(p.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]').length === 5, 'tous les éléments, y compris identiques');

  // ---------------------------------------------------------------- changements à valider (0.15.3 : par le niveau du dessus)
  // le chef de projet ne valide que ce que font les niveaux en dessous de lui : ici, les dates de Rémi (Workpackage leader)
  await p.until(() => /\(\d+\)/.test(p.text('tab-changes')));
  check(p.text('tab-changes') === 'Changements à valider (1)', 'compteur de l’onglet du chef de projet : ' + p.text('tab-changes'));
  await p.until(() => p.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]').length === 1);
  const cpRows = [...p.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]')].map((r) => r.textContent);
  check(cpRows.length === 1 && cpRows[0].includes('Calcul') && cpRows[0].includes('fin prévue : 23/10/2026 → 28/10/2026') && cpRows[0].includes('Workpackage leader'), 'sa liste : la date de Rémi, avec le niveau de son auteur : ' + cpRows.join(' | '));
  check(/Vos modifications en attente de validation \(3\)/.test(p.text('panel-changes')) && /Domain Program Leader/.test(p.text('panel-changes')), 'et ses trois changements à lui (deux modifications et la baseline qu’il a figée), qui attendent le DPL');
  check(/le Deliverable owner valide les Contributors/.test(p.text('feed-rule')), 'la règle est écrite sur la page');
  // le DPL valide tout, y compris ce que fait le chef de projet
  const dp = openPage('Suivi.html', 'dora@entreprise.com');
  await dp.until(() => /\(4\)/.test(dp.text('tab-changes')));
  check(dp.text('tab-changes') === 'Changements à valider (4)', 'le DPL : quatre changements à valider (dont la baseline du chef de projet) : ' + dp.text('tab-changes'));
  await dp.until(() => dp.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]').length === 4);
  const feed = [...dp.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]')].map((r) => r.textContent);
  check(feed.some((t) => t.includes('Calcul') && t.includes('fin prévue : 23/10/2026 → 28/10/2026')), 'changement de date lisible');
  check(feed.some((t) => t.includes('responsable : Carla → Rémi') && t.includes('Chef de projet')), 'responsable par son nom, fait au niveau chef de projet');
  check(feed.some((t) => t.includes('Ajouté')), 'ajout de livrable');
  check(!feed.some((t) => t.includes('Budget de Essais')), 'la ligne de budget saisie par le système n’a personne au-dessus : elle n’est soumise à personne');
  check(feed.some((t) => t.includes('Carla')), 'auteur affiché par son nom');
  const box = dp.doc.querySelector('#panel-changes tbody input[type=checkbox]');
  box.checked = true; box.dispatchEvent(new dp.win.Event('change'));
  dp.click(dp.doc.getElementById('ack-selected'));
  await dp.until(() => dp.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]').length === 3);
  check(dp.text('tab-changes') === 'Changements à valider (3)', 'une validation : ' + dp.text('tab-changes'));
  dp.click(dp.doc.getElementById('ack-all'));
  await dp.until(() => dp.text('panel-changes').includes('Rien à valider'));
  check(dp.text('tab-changes') === 'Changements à valider', 'plus rien à valider');
  const all = dp.doc.getElementById('show-all');
  all.checked = true; all.dispatchEvent(new dp.win.Event('change'));
  await dp.until(() => dp.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]').length === 4);
  check([...dp.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]')].every((r) => r.textContent.includes('Validé par dora@entreprise.com')), 'historique : validés, par qui');
  p.click(p.doc.getElementById('reload'));
  await p.until(() => !/Vos modifications en attente/.test(p.text('panel-changes')) || p.doc.querySelectorAll('#panel-changes tbody tr[data-event-row]').length === 0);
  check(!p.doc.querySelector('#feed-mine-title') || p.doc.querySelectorAll('[data-mine-row]').length === 0, 'validés par le DPL, les changements du chef de projet ne sont plus « en attente »');

  // ---------------------------------------------------------------- baselines : demande d'un membre, refus, B1, réactivation
  const m = openPage('Suivi.html', MEMBER, { tab: 'baselines' });
  await m.until(() => m.button('Demander une nouvelle baseline'));
  check(!m.button('Figer'), 'un membre ne peut pas figer');
  await m.until(() => !m.doc.getElementById('zone-changes').hidden && /Rien à valider/.test(m.text('panel-changes')));
  check(!m.doc.getElementById('zone-changes').hidden && !m.doc.getElementById('ack-selected') && !m.doc.getElementById('ack-all') && /Rien à valider/.test(m.text('panel-changes')), 'un Contributor voit la zone, mais n’a rien à valider : ni « Valider la sélection » ni « Tout valider »');
  c.repoInsert('Resource', { resource_type: 'Interne', name: 'Zed', email: 'zed@entreprise.com', country: 'FR' }, w.S);
  const zed = openPage('Suivi.html', 'zed@entreprise.com', { tab: 'baselines' });
  await zed.until(() => zed.doc.getElementById('zone-changes') && zed.doc.getElementById('panel-ecarts') && zed.text('title').length > 0);
  await wait(150);
  check(zed.doc.getElementById('zone-changes').hidden && zed.doc.getElementById('panel-changes').hidden, 'sans aucun rôle (Reader), la zone des changements est masquée');
  m.click(m.button('Demander une nouvelle baseline'));
  m.fill('form-reason', 'Le fournisseur livre 2 semaines plus tard');
  m.click(m.doc.getElementById('form-ok'));
  await m.until(() => m.text('toast') === 'Demande envoyée.');
  await m.until(() => m.text('panel-baselines').includes('Demandée'));
  check(m.text('context').includes('1 demande en attente'), 'contexte : ' + m.text('context'));

  p.click(p.doc.getElementById('reload'));
  await p.until(() => p.button('Refuser'));
  p.click(p.button('Refuser'));
  check(p.text('form-reason-label') === 'Motif du refus', 'motif du refus demandé');
  p.fill('form-reason', 'Le retard se rattrape');
  p.click(p.doc.getElementById('form-ok'));
  await p.until(() => p.text('toast') === 'Demande refusée.');
  await p.until(() => p.text('panel-baselines').includes('Refusée'));
  p.click(p.button('Figer une nouvelle baseline'));
  check(p.doc.getElementById('form-label').value === 'B1', 'libellé suivant proposé : B1');
  p.fill('form-reason', 'Replanification après revue');
  p.click(p.doc.getElementById('form-ok'));
  await p.until(() => /Baseline B1 figée/.test(p.text('toast')));
  await p.until(() => p.button('Réactiver'));
  check(p.doc.querySelectorAll('#panel-baselines .badge.active').length === 1, 'une seule baseline active');
  p.click(p.button('Réactiver'));
  p.fill('form-reason', 'Le client refuse le nouveau planning');
  p.click(p.doc.getElementById('form-ok'));
  await p.until(() => p.text('toast') === 'B0 réactivée.');
  await p.until(() => /B0 active/.test(p.text('context')));
  check(true, 'B0 réactivée, contexte à jour');
  // comparer B0 et B1
  await p.until(() => p.doc.getElementById('cmp-to'));
  const onlyAgain = p.doc.getElementById('only-changes');
  onlyAgain.checked = true; onlyAgain.dispatchEvent(new p.win.Event('change'));
  const to = p.doc.getElementById('cmp-to');
  to.value = [...to.options].find((o) => /B1/.test(o.textContent)).value;
  to.dispatchEvent(new p.win.Event('change'));
  await p.until(() => p.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]').length === 3);
  check(p.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]').length === 3, 'B0 comparée à B1 : les 3 écarts figés dans B1');

  // ---------------------------------------------------------------- agenda et Drive
  await p.until(() => p.doc.getElementById('ws-enable'));
  p.click(p.doc.getElementById('ws-enable'));
  await p.until(() => p.doc.getElementById('ws-report'));
  const rep = p.text('ws-report');
  check(/7 événements créés/.test(rep) && /3 dossiers créés ou renommés/.test(rep) && /Partagés avec les 4 membres du projet \(8 nouveaux accès\)/.test(rep), 'compte rendu (5 échéances et jalons, 2 rappels) : ' + rep);
  check(!!p.doc.querySelector('a[href^="https://calendar.test/"]') && !!p.doc.querySelector('a[href^="https://drive.test/"]'), 'liens vers l’agenda et le dossier');
  check(!!p.doc.getElementById('ws-sync'), 'ensuite : « Synchroniser maintenant »');
  const mw = openPage('Suivi.html', MEMBER, { tab: 'workspace' });
  await mw.until(() => mw.text('panel-workspace').includes('En service'));
  check(!mw.doc.getElementById('ws-sync') && /Seuls le chef de projet/.test(mw.text('panel-workspace')), 'un membre voit les liens sans pouvoir synchroniser');

  // ---------------------------------------------------------------- Gantt : baseline en fantôme
  console.log('\nGantt : baseline (jsdom)');
  const g = openPage('Gantt.html', CP, {}, fs.readFileSync(frappePath, 'utf8'));
  await g.until(() => g.doc.querySelector('.baseline-ghost'));
  const ghosts = [...g.doc.querySelectorAll('.baseline-ghost')];
  const bar = (id) => g.doc.querySelector('.bar-wrapper[data-id="' + id + '"] rect.bar');
  const ghost = (id) => g.doc.querySelector('.baseline-ghost[data-for="' + id + '"]');
  check(ghosts.length >= 5, 'un trait de baseline par élément figé (' + ghosts.length + ')');
  const added = c.repoList('PlanItem').find((i) => /Rapport/.test(i.name));
  check(!ghost(added.id), 'pas de trait pour un élément ajouté depuis la baseline');
  const bx = Number(bar(w.a.id).getAttribute('x')), gx = Number(ghost(w.a.id).getAttribute('x'));
  check(Math.abs(bx - gx) < 0.5 && Math.abs(Number(bar(w.a.id).getAttribute('width')) - Number(ghost(w.a.id).getAttribute('width'))) < 0.5,
    'élément non modifié : le trait est exactement sous la barre');
  const bEnd = Number(bar(w.b.id).getAttribute('x')) + Number(bar(w.b.id).getAttribute('width'));
  const gEnd = Number(ghost(w.b.id).getAttribute('x')) + Number(ghost(w.b.id).getAttribute('width'));
  check(bEnd - gEnd > 1, 'Calcul glissé : la barre dépasse son trait de baseline');
  check(Number(ghost(w.b.id).getAttribute('y')) > Number(bar(w.b.id).getAttribute('y')), 'le trait est sous la barre');
  check(/Baseline B0 du \d\d\/\d\d\/\d{4} : 1 élément glissé, 1 ajouté/.test(g.text('summary')), 'résumé : ' + g.text('summary'));
  check(!g.doc.getElementById('baseline-toggle').hidden && !g.doc.getElementById('legend-baseline').hidden, 'case et légende « Baseline » affichées');
  const cb = g.doc.getElementById('baseline');
  cb.checked = false; cb.dispatchEvent(new g.win.Event('change'));
  check(g.doc.getElementById('main').classList.contains('baseline-off'), 'la case masque les traits');
  cb.checked = true; cb.dispatchEvent(new g.win.Event('change'));
  g.click(g.doc.querySelector('.bar-wrapper[data-id="' + w.b.id + '"]'));
  await g.until(() => !g.doc.getElementById('details').hidden);
  const det = g.text('details');
  check(/Finit 3 jours ouvrés après la baseline B0/.test(det) && /Baseline12\/10\/2026 → 23\/10\/2026/.test(det), 'détail : glissement et dates figées');
  g.click(g.doc.querySelector('[data-mode="Month"]'));
  await wait(50);
  check(g.doc.querySelectorAll('.baseline-ghost').length === ghosts.length, 'les traits sont redessinés au changement d’échelle');
  check(g.doc.getElementById('nav-suivi').getAttribute('href') === 'https://app.test/exec?view=suivi&project=' + w.p1.id, 'lien vers la page Suivi');

  // ---------------------------------------------------------------- premier écran préparé par le serveur
  console.log('\nDonnées préparées avec la page');
  const bootP = { project: '', program: '', tab: 'ecarts', mode: '' };
  const pre = c.preloadFor_('suivi', bootP, CP);
  const q = openPage('Suivi.html', CP, { project: '', tab: 'ecarts', preload: pre });
  await q.until(() => q.doc.querySelector('#panel-ecarts .cards') || q.doc.querySelector('#panel-ecarts .empty'));
  await wait(30);
  check(!q.calls.includes('planning.catalog') && !q.calls.includes('baselines.list') && !q.calls.includes('baselines.diff') && !q.calls.includes('changes.feed'),
    'aucun appel au serveur pour le premier écran : ' + JSON.stringify(q.calls));
  q.click(q.doc.getElementById('reload'));
  await q.until(() => q.calls.includes('baselines.list'));
  check(true, 'Actualiser interroge bien le serveur (les données préparées ne servent qu’une fois)');


  const norm = (t) => String(t).replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  const programOptions = (x) => [...x.$('picker').options].filter((o) => /^program:/.test(o.value));
  const chooseProgram = (x) => { x.$('picker').value = 'program:' + w.prog.id; x.$('picker').dispatchEvent(new x.win.Event('change')); };
  // ---------------------------------------------------------------- 0.14.1 : vue programme (Program Leader et Domain Program Leader)
  const cpS = openPage('Suivi.html', CP);
  await cpS.until(() => cpS.doc.getElementById('picker').options.length >= 2);
  check(programOptions({ $: (id) => cpS.doc.getElementById(id) }).length === 0, 'un chef de projet n’a pas la vue programme dans la liste');
  const ds = openPage('Suivi.html', 'dora@entreprise.com');
  const dsx = { $: (id) => ds.doc.getElementById(id), win: ds.win };
  await ds.until(() => programOptions(dsx).length === 1);
  await ds.until(() => !ds.doc.getElementById('panel-ecarts').hidden);
  chooseProgram(dsx);
  await ds.until(() => ds.doc.querySelector('#panel-program table.consol'));
  const rowsS = [...ds.doc.querySelectorAll('#panel-program tbody tr')];
  check(rowsS.length === 2 && /Baseline active/.test(norm(ds.doc.querySelector('#panel-program thead').textContent)) && rowsS.every((r) => /Aucune|B\d/.test(r.textContent)) && /Aucune/.test(rowsS[1].textContent), 'suivi du programme : une ligne par projet, la baseline active ou « Aucune » : ' + rowsS.map((r) => norm(r.textContent).slice(0, 30)).join(' | '));
  check(ds.doc.body.classList.contains('in-program') && ['ecarts', 'changes', 'baselines', 'workspace'].every((z) => [...ds.doc.querySelectorAll('style')].some((s) => s.textContent.includes('body.in-program #panel-' + z))) && /Suivi — Programme/.test(ds.doc.getElementById('title').textContent), 'les zones du projet sont masquées en vue programme par une règle de la page');
  ds.click(ds.doc.querySelector('#panel-program tbody tr button.proj-open'));
  await ds.until(() => ds.doc.getElementById('panel-program').hidden && !ds.doc.body.classList.contains('in-program'));
  check(ds.doc.getElementById('picker').value === w.p1.id && !ds.doc.getElementById('panel-ecarts').hidden, 'un clic sur un projet ouvre son suivi et referme la vue programme');

  // ---------------------------------------------------------------- 0.15.5 : baselines par périmètre (projet, workpackage, sous-workpackage)
  const wl = openPage('Suivi.html', RWP, { tab: 'baselines' });                   // Rémi : Workpackage leader du WP 1 (et de 1.1)
  await wl.until(() => wl.doc.getElementById('create-scope'));
  const optLabels = (sel) => [...sel.options].map((o) => o.textContent.replace(/\u00a0/g, '').split(' · ')[0]);
  check(JSON.stringify(optLabels(wl.doc.getElementById('create-scope'))) === JSON.stringify(['1 Conception', '1.1 Calcul']), 'la liste des périmètres d’un Workpackage leader : son workpackage et son sous-workpackage, ni le projet ni WP 2 : ' + optLabels(wl.doc.getElementById('create-scope')).join(' | '));
  check(!wl.button('Demander une nouvelle baseline'), 'il peut figer : pas de bouton « demander »');
  const cpScopes = openPage('Suivi.html', CP, { tab: 'baselines' });
  await cpScopes.until(() => cpScopes.doc.getElementById('create-scope'));
  check(JSON.stringify(optLabels(cpScopes.doc.getElementById('create-scope'))) === JSON.stringify(['Projet P1', '1 Conception', '1.1 Calcul', '2 Essais']), 'le chef de projet : le projet et tous les workpackages, sans livrable ni jalon : ' + optLabels(cpScopes.doc.getElementById('create-scope')).join(' | '));
  check(cpScopes.doc.getElementById('create-scope').value === 'project:' + w.p1.id, 'par défaut : le périmètre affiché, ici le projet');
  const wlSel = wl.doc.getElementById('create-scope');
  wlSel.value = 'workpackage:' + w.w1.id; wlSel.dispatchEvent(new wl.win.Event('change'));
  check(wl.doc.getElementById('create-btn').textContent === 'Figer la baseline B0', 'WP 1 n’a pas encore de baseline : « Figer la baseline B0 »');
  const projectBase = c.repoGet('Project', w.p1.id).active_baseline_id;
  wl.click(wl.doc.getElementById('create-btn'));
  check(wl.doc.getElementById('form').open && /1 Conception/.test(wl.text('form-title')) && /référence locale/.test(wl.text('form-text')) && /baseline du projet n’est pas modifiée/.test(wl.text('form-text')), 'la boîte dit le périmètre et que la baseline du projet n’est pas modifiée : ' + wl.text('form-title'));
  wl.fill('form-reason', 'Conception figée après la revue');
  wl.click(wl.doc.getElementById('form-ok'));
  await wl.until(() => /Baseline B0 figée/.test(wl.text('toast')));
  const wpBase = c.repoList('Baseline').find((b) => b.scope_type === 'workpackage' && b.scope_id === w.w1.id);
  check(!!wpBase && wpBase.status === 'Active' && c.repoGet('WorkPackage', w.w1.id).active_baseline_id === wpBase.id && c.repoGet('Project', w.p1.id).active_baseline_id === projectBase, 'la baseline de WP 1 est active ; la référence du projet n’a pas bougé');
  check(/à valider par le niveau du dessus/.test(wl.text('toast')), 'la page dit qu’elle est à valider par le niveau du dessus');
  await wl.until(() => wl.doc.getElementById('view-scope') && wl.doc.getElementById('view-scope').value === 'workpackage:' + w.w1.id);
  await wl.until(() => wl.doc.querySelectorAll('#panel-ecarts tbody tr[data-item]').length >= 1 || /Aucun écart/.test(wl.text('panel-ecarts')));
  check(wl.doc.getElementById('view-scope').value === 'workpackage:' + w.w1.id, 'les écarts s’affichent pour le périmètre qu’on vient de figer');
  check(/Spécification|Aucun écart/.test(wl.text('panel-ecarts')) && !/Essais|Revue/.test([...wl.doc.querySelectorAll('#panel-ecarts tbody td:first-child')].map((t) => t.textContent).join(' ')), 'seuls les éléments du périmètre sont comparés (pas Essais, pas Revue)');
  check(/Conception/.test([...wl.doc.querySelectorAll('#baselines-scope-tag, #panel-baselines .scope-tag')].map((t) => t.textContent).join(' ')) && /À valider/.test(wl.text('panel-baselines')), 'l’historique dit le périmètre et « À valider »');
  // les écarts d'un workpackage se lisent aussi contre la baseline du projet
  await wl.until(() => wl.doc.getElementById('view-ref'));
  const refSel = wl.doc.getElementById('view-ref');
  refSel.value = 'project'; refSel.dispatchEvent(new wl.win.Event('change'));
  await wl.until(() => wl.doc.getElementById('ref-project-note'));
  check(/baseline B\d+ du projet, restreinte à ce périmètre/.test(wl.text('ref-project-note')) && /1 Conception/.test(wl.text('ref-project-note')) && wl.doc.getElementById('ref-project-note').getAttribute('data-against') === 'project' && wl.doc.getElementById('ref-project-note').getAttribute('data-baseline-scope') === 'project', 'contre la baseline du projet : la page le dit : ' + wl.text('ref-project-note'));
  // le niveau du dessus est informé : le chef de projet voit la baseline et peut la refuser
  const cpFeed = openPage('Suivi.html', CP);
  await cpFeed.until(() => cpFeed.doc.querySelector('#panel-changes [data-reject]'));
  const rejectBtn = cpFeed.doc.querySelector('#panel-changes [data-reject]');
  const baselineRow = rejectBtn.closest('tr');
  check(/Baseline B0 · 1 Conception/.test(baselineRow.textContent) && /Workpackage leader/.test(baselineRow.textContent) && /première baseline de ce périmètre/.test(baselineRow.textContent), 'le chef de projet voit la baseline du Workpackage leader, avec son niveau et son résumé : ' + baselineRow.textContent.replace(/\s+/g, ' ').slice(0, 160));
  cpFeed.click(rejectBtn);
  check(cpFeed.doc.getElementById('form').open && /Refuser la baseline/.test(cpFeed.text('form-title')), 'Refuser ouvre la boîte du motif');
  cpFeed.fill('form-reason', 'Pas avant la revue de planning');
  cpFeed.click(cpFeed.doc.getElementById('form-ok'));
  await cpFeed.until(() => /Baseline refusée/.test(cpFeed.text('toast')));
  check(c.repoGet('Baseline', wpBase.id).status === 'Refusée' && !(c.repoGet('WorkPackage', w.w1.id).active_baseline_id), 'refusée : WP 1 se retrouve sans baseline (il n’y en avait pas avant)');
  await cpFeed.until(() => !cpFeed.doc.querySelector('#panel-changes [data-reject]'));   // le fil se recharge après le message
  check(!cpFeed.doc.querySelector('#panel-changes [data-reject]'), 'le changement est traité : plus de bouton « Refuser »');
  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPages Suivi et Gantt (baseline) : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
