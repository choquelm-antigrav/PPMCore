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
    .replace("<?!= include('Style') ?>", style).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'))
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
  await p.until(() => p.doc.querySelectorAll('#panel-ecarts tbody tr').length === 3);
  const rows = [...p.doc.querySelectorAll('#panel-ecarts tbody tr')].map((r) => [...r.cells].map((c2) => c2.textContent));
  check(rows[0][0].startsWith('Calcul') && rows[0][3] === '+3 jours' && rows[0][6] === 'Modifié', 'Calcul glissé de 3 jours : ' + rows[0].join(' | '));
  check(rows.some((r) => r[0].startsWith('Essais') && r[4] === 'Carla → Rémi'), 'changement de responsable');
  check(rows.some((r) => r[0].startsWith('Rapport <img') && r[6] === 'Ajouté'), 'élément ajouté, nom affiché en texte');
  check(p.doc.querySelectorAll('img:not(#ppm-logo)').length === 0, 'aucune balise injectée');
  const cards = [...p.doc.querySelectorAll('#panel-ecarts .card')].map((x) => x.textContent);
  check(cards.some((x) => /^Éléments glissés1jusqu’à 3 jours ouvrés/.test(x)), 'carte des glissements : ' + cards.join(' / '));
  check(cards.some((x) => /^Budget prévu1\s200\s€\+200\s€ par rapport à la référence/.test(x)), 'budget et écart visibles pour le chef de projet : ' + cards.join(' / '));
  check(rows.some((r) => r[0].startsWith('Essais') && /\+200/.test(r[5])), 'écart de budget sur la ligne du livrable');
  const pm = openPage('Suivi.html', MEMBER);
  await pm.until(() => pm.doc.querySelector('#panel-ecarts .cards'));
  check(![...pm.doc.querySelectorAll('#panel-ecarts .card')].some((x) => /Budget/.test(x.textContent)) && ![...pm.doc.querySelectorAll('#panel-ecarts th')].some((x) => x.textContent === 'Budget'),
    'aucun montant pour un simple membre');
  const only = p.doc.getElementById('only-changes');
  only.checked = false; only.dispatchEvent(new p.win.Event('change'));
  check(p.doc.querySelectorAll('#panel-ecarts tbody tr').length === 5, 'tous les éléments, y compris identiques');

  // ---------------------------------------------------------------- changements à valider
  await p.until(() => /\(\d+\)/.test(p.text('tab-changes')));
  check(p.text('tab-changes') === 'Changements à valider (4)', 'compteur de l’onglet : ' + p.text('tab-changes'));
  await p.until(() => p.doc.querySelectorAll('#panel-changes tbody tr').length === 4);
  const feed = [...p.doc.querySelectorAll('#panel-changes tbody tr')].map((r) => r.textContent);
  check(feed.some((t) => t.includes('Calcul') && t.includes('fin prévue : 23/10/2026 → 28/10/2026')), 'changement de date lisible');
  check(feed.some((t) => t.includes('responsable : Carla → Rémi')), 'responsable par son nom');
  check(feed.some((t) => t.includes('Ajouté')), 'ajout de livrable');
  check(feed.some((t) => t.includes('Budget de Essais') && t.includes('forfait : 1000 → 1200')), 'budget : une seule ligne, sur le montant saisi');
  check(feed.some((t) => t.includes('Carla')), 'auteur affiché par son nom');
  const box = p.doc.querySelector('#panel-changes tbody input[type=checkbox]');
  box.checked = true; box.dispatchEvent(new p.win.Event('change'));
  p.click(p.doc.getElementById('ack-selected'));
  await p.until(() => p.doc.querySelectorAll('#panel-changes tbody tr').length === 3);
  check(p.text('tab-changes') === 'Changements à valider (3)', 'une validation : ' + p.text('tab-changes'));
  p.click(p.doc.getElementById('ack-all'));
  await p.until(() => p.text('panel-changes').includes('Rien à valider'));
  check(p.text('tab-changes') === 'Changements à valider', 'plus rien à valider');
  const all = p.doc.getElementById('show-all');
  all.checked = true; all.dispatchEvent(new p.win.Event('change'));
  await p.until(() => p.doc.querySelectorAll('#panel-changes tbody tr').length === 4);
  check([...p.doc.querySelectorAll('#panel-changes tbody tr')].every((r) => r.textContent.includes('Validé par ' + CP)), 'historique : validés, par qui');

  // ---------------------------------------------------------------- baselines : demande d'un membre, refus, B1, réactivation
  const m = openPage('Suivi.html', MEMBER, { tab: 'baselines' });
  await m.until(() => m.button('Demander une nouvelle baseline'));
  check(!m.button('Figer'), 'un membre ne peut pas figer');
  check(m.doc.getElementById('zone-changes').hidden && m.doc.getElementById('panel-changes').hidden, 'la zone des changements est masquée à un simple membre');
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
  await p.until(() => p.doc.querySelectorAll('#panel-ecarts tbody tr').length === 3);
  check(p.doc.querySelectorAll('#panel-ecarts tbody tr').length === 3, 'B0 comparée à B1 : les 3 écarts figés dans B1');

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

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nPages Suivi et Gantt (baseline) : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
