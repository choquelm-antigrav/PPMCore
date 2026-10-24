/**
 * Essai de la création et de l'édition du WBS dans la page Structure (jsdom, vrai Core).
 *   npm i --no-save jsdom@24 && node tests/ui_edit.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, 'jsdom') : 'jsdom');
const { lot2World } = require('./fixtures_lot2');

const w = lot2World();
const c = w.c;
let t0 = Date.parse('2026-10-14T08:00:00Z');
c.CLOCK = () => (t0 += 1);
const CP = 'carla@entreprise.com', RWP = 'remi@entreprise.com', MEMBER = 'mia@entreprise.com';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user) {
  const html = src('Structure.html').replace(/<\?!= include\('(?!Style'|Common'|Header')(\w+)'\) \?>/g, (m, n) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', n + '.html'), 'utf8')).replace("<?!= include('Style') ?>", src('Style.html')).replace("<?!= include('Common') ?>", src('Common.html')).replace("<?!= include('Header') ?>", src('Header.html'))
    .replace('<?= theme ?>', 'auto')
    .replace('<?!= boot ?>', JSON.stringify({ project: w.p1.id, program: '', tab: 'wbs', mode: '', baseUrl: 'https://app.test/exec', appsheetUrl: '', version: 'test', view: 'structure', home: 'gantt', isAdmin: false }))
    .replace(/<link rel="stylesheet" href="https:[^"]+">/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      function runner(ok, fail) {
        return {
          withSuccessHandler: (f) => runner(f, fail), withFailureHandler: (f) => runner(ok, f),
          uiCall: (action, params, rid) => {
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
  const until = async (cond, ms = 3000) => { const s = Date.now(); while (Date.now() - s < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const $ = (id) => doc.getElementById(id + '-wbs') || doc.getElementById(id); // le découpage est la zone « -wbs »
  const text = (id) => ($(id) || { textContent: '' }).textContent;
  const node = (id) => doc.querySelector('#canvas-wbs .node[data-id="' + id + '"]');
  const nodes = () => doc.querySelectorAll('#canvas-wbs .node').length;
  const submit = () => $('editor-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
  const pick = async (id, title) => { await until(() => node(id)); click(node(id)); await until(() => !$('details').hidden && (!title || text('details').includes(title))); };
  const buttons = () => [...doc.querySelectorAll('#wbs-actions button')].map((b) => b.textContent);
  const fill = (id, v) => { $(id).value = v; };
  return { win, doc, until, click, $, text, node, nodes, submit, pick, buttons, fill };
}

(async () => {
  console.log('\nÉdition du WBS dans la page Structure (jsdom)');

  // ---------------------------------------------------------------- droits : les boutons n'apparaissent que là où c'est permis
  let r = openPage(RWP);
  await r.until(() => r.nodes() === 8);
  check(r.$('wbs-add').hidden, 'Rémi : pas de bouton « Ajouter un workpackage » (réservé au pilotage du projet)');
  await r.pick('project:' + w.p1.id, 'Projet 1');
  check(r.buttons().length === 0, 'Rémi : aucun bouton sur la carte du projet');
  await r.pick('wp:' + w.w1.id, 'Conception');
  check(JSON.stringify(r.buttons()) === JSON.stringify(['Ajouter un sous-workpackage', 'Ajouter un livrable', 'Ajouter un jalon', 'Modifier', 'Supprimer']), 'Rémi : tous les boutons sur son workpackage : ' + r.buttons().join(' | '));
  await r.pick('wp:' + w.w11.id, 'Calcul');
  check(!r.buttons().includes('Ajouter un sous-workpackage') && r.buttons().includes('Modifier'), 'sur un sous-workpackage : pas de troisième niveau');
  await r.pick('wp:' + w.w2.id, 'Essais');
  check(r.buttons().length === 0, 'Rémi : aucun bouton sur le workpackage d’un autre');
  const m = openPage(MEMBER);
  await m.until(() => m.nodes() === 8);
  await m.pick('wp:' + w.w1.id, 'Conception');
  check(m.$('wbs-add').hidden && m.buttons().length === 0, 'un simple membre ne voit aucun bouton de modification');

  // ---------------------------------------------------------------- création
  const p = openPage(CP);
  await p.until(() => p.nodes() === 8);
  check(!p.$('wbs-add').hidden, 'Carla : bouton « Ajouter un workpackage » en haut de page');
  p.click(p.$('wbs-add'));
  await p.until(() => p.$('editor').open);
  check(p.text('editor-title') === 'Nouveau workpackage' && p.$('ed-code').placeholder === 'automatique', 'boîte de création, code WBS automatique');
  p.fill('ed-name', '  Industrialisation ');
  p.submit();
  await p.until(() => c.repoList('WorkPackage').some((x) => x.name === 'Industrialisation'));
  const ind = c.repoList('WorkPackage').find((x) => x.name === 'Industrialisation');
  check(ind.wbs_code === '3' && ind.owner_resource_id === '' && ind.project_id === w.p1.id && !p.$('ed-owner'), 'workpackage créé : code 3, sans champ « Responsable » (le Workpackage leader se pose ensuite dans le panneau des rôles)');
  await p.until(() => /3 Industrialisation/.test(p.text('details')) && p.nodes() === 9);
  check(!p.$('editor').open && /Créé : Industrialisation/.test(p.text('toast')), 'boîte fermée, confirmation, la nouvelle carte est sélectionnée');

  p.click(p.$('add-subwp'));
  await p.until(() => p.$('editor').open);
  check(p.text('editor-title') === 'Nouveau sous-workpackage', 'sous-workpackage proposé depuis un workpackage');
  p.fill('ed-name', 'Moules'); p.submit();
  await p.until(() => /3\.1 Moules/.test(p.text('details')));
  const moules = c.repoList('WorkPackage').find((x) => x.name === 'Moules');
  check(moules.wbs_code === '3.1' && moules.parent_wp_id === ind.id, 'sous-workpackage : code 3.1 sous son parent');
  check(!p.$('add-subwp'), 'pas de bouton « sous-workpackage » sur un sous-workpackage');

  p.click(p.$('add-deliverable'));
  await p.until(() => p.$('editor').open);
  check(p.text('editor-title') === 'Nouveau livrable' && p.$('ed-start').type === 'date', 'livrable : dates de début et de fin');
  p.fill('ed-name', 'Outillage'); p.fill('ed-start', '2026-11-02'); p.fill('ed-finish', '2026-11-27');
  p.submit();
  await p.until(() => /Outillage/.test(p.text('details')) && p.$('edit-node'));
  const outil = c.repoList('PlanItem').find((x) => x.name === 'Outillage');
  check(outil.wp_id === moules.id && outil.planned_start === '2026-11-02' && outil.planned_finish === '2026-11-27' && outil.item_type === 'Livrable', 'livrable créé dans le sous-workpackage, avec ses dates');

  await p.pick('wp:' + ind.id, 'Industrialisation');
  p.click(p.$('add-milestone'));
  await p.until(() => p.$('editor').open);
  check(p.text('editor-title') === 'Nouveau jalon' && !p.$('ed-start') && p.$('ed-date') && p.$('ed-cat'), 'jalon : une seule date et une catégorie');
  p.fill('ed-name', 'Revue outillage'); p.fill('ed-date', '2026-12-04'); p.fill('ed-cat', 'Client'); p.submit();
  await p.until(() => c.repoList('PlanItem').some((x) => x.name === 'Revue outillage'));
  const rev = c.repoList('PlanItem').find((x) => x.name === 'Revue outillage');
  check(rev.item_type === 'Jalon' && rev.planned_start === '2026-12-04' && rev.planned_finish === '2026-12-04' && rev.milestone_category === 'Client', 'jalon créé : date unique, catégorie Client');
  await p.until(() => p.nodes() === 12);

  // ---------------------------------------------------------------- 0.14.0 : les trois boutons d'ajout sont toujours visibles, avec choix du parent
  const q = openPage(CP);
  await q.until(() => q.nodes() >= 12);
  check(!q.$('wbs-add').hidden && !q.$('wbs-add-deliverable').hidden && !q.$('wbs-add-milestone').hidden, 'sans rien sélectionner : « workpackage », « livrable » et « jalon » sont dans la barre');
  q.click(q.$('wbs-add-deliverable'));
  await q.until(() => q.$('editor').open);
  check(q.text('editor-title') === 'Nouveau livrable' && !!q.$('ed-parent') && q.$('ed-parent').value === '', 'livrable depuis la barre : liste « Rattaché à », par défaut la racine du projet');
  const labels = [...q.$('ed-parent').options].map((o) => o.textContent);
  check(labels[0] === 'Projet (racine)' && labels.some((l) => /Moules/.test(l)) && labels.some((l) => /Industrialisation/.test(l)), 'la liste propose le projet et tous les workpackages, sous-workpackages compris : ' + labels.join(' | '));
  q.fill('ed-name', 'Gabarit moule'); q.fill('ed-parent', moules.id); q.fill('ed-start', '2026-11-03'); q.fill('ed-finish', '2026-11-10'); q.submit();
  await q.until(() => c.repoList('PlanItem').some((x) => x.name === 'Gabarit moule'));
  check(c.repoList('PlanItem').find((x) => x.name === 'Gabarit moule').wp_id === moules.id, 'livrable créé dans le workpackage choisi dans la liste, sans l’avoir sélectionné avant');
  await q.until(() => !q.$('editor').open && /Créé : Gabarit moule/.test(q.text('toast')) && q.nodes() === 13); // la page a fini de se redessiner
  q.click(q.$('wbs-add-milestone'));
  await q.until(() => q.$('editor').open);
  q.fill('ed-name', 'Jalon racine'); q.fill('ed-date', '2026-12-18'); q.submit();
  await q.until(() => c.repoList('PlanItem').some((x) => x.name === 'Jalon racine'));
  const racine = c.repoList('PlanItem').find((x) => x.name === 'Jalon racine');
  check(racine.item_type === 'Jalon' && !racine.wp_id, 'jalon créé à la racine du projet quand on ne choisit aucun workpackage');
  await q.until(() => !q.$('editor').open && /Créé : Jalon racine/.test(q.text('toast')) && q.nodes() === 14);
  await q.pick('wp:' + ind.id, 'Industrialisation');
  q.click(q.$('wbs-add-deliverable'));
  await q.until(() => q.$('editor').open);
  check(q.$('ed-parent').value === ind.id, 'avec un workpackage sélectionné, il est proposé d’office comme parent');
  q.click(q.$('ed-cancel'));
  q.click(q.$('wbs-add'));
  await q.until(() => q.$('editor').open);
  const wpLabels = [...q.$('ed-parent').options].map((o) => o.textContent);
  check(q.$('ed-parent').value === '' && !wpLabels.some((l) => /Moules/.test(l)) && wpLabels.some((l) => /Industrialisation/.test(l)), 'workpackage : racine par défaut, et seuls les workpackages de premier niveau peuvent être parents : ' + wpLabels.join(' | '));
  q.click(q.$('ed-cancel'));
  const mm = openPage(MEMBER);
  await mm.until(() => mm.nodes() >= 1);
  check(mm.$('wbs-add').hidden && mm.$('wbs-add-deliverable').hidden && mm.$('wbs-add-milestone').hidden, 'un simple membre ne voit aucun des trois boutons');

  // ---------------------------------------------------------------- erreur : la boîte reste ouverte avec le message
  await p.pick('wp:' + w.w2.id, 'Essais');
  p.click(p.$('add-deliverable'));
  await p.until(() => p.$('editor').open);
  p.fill('ed-name', 'Erreur'); p.fill('ed-start', '2026-12-10'); p.fill('ed-finish', '2026-12-01'); p.submit();
  await p.until(() => !p.$('ed-error').hidden);
  check(/ne peut pas précéder/.test(p.text('ed-error')) && p.$('editor').open && !p.$('ed-save').disabled, 'dates incohérentes : message dans la boîte, saisie conservée');
  check(p.$('ed-name').value === 'Erreur' && !c.repoList('PlanItem').some((x) => x.name === 'Erreur'), 'rien n’a été créé');
  p.click(p.$('ed-cancel'));
  check(!p.$('editor').open, 'Annuler ferme la boîte');
  p.click(p.$('wbs-add')); await p.until(() => p.$('editor').open);
  p.fill('ed-name', ''); p.submit();
  await p.until(() => !p.$('ed-error').hidden);
  check(/nom est obligatoire/.test(p.text('ed-error')), 'nom vide refusé : ' + p.text('ed-error'));
  p.click(p.$('ed-cancel'));

  // ---------------------------------------------------------------- modification et déplacement
  await p.pick('item:' + w.a.id, 'Spécification');
  p.click(p.$('edit-node'));
  await p.until(() => p.$('editor').open);
  check(p.text('editor-title') === 'Modifier le livrable' && p.$('ed-name').value === 'Spécification' && p.$('ed-start').value === '2026-10-05' && p.$('ed-finish').value === '2026-10-09', 'formulaire prérempli');
  check(!p.$('ed-owner') && p.$('ed-parent').value === w.w1.id, 'plus de champ « Responsable » ; rattachement actuel');
  p.fill('ed-name', 'Spécification v2'); p.fill('ed-finish', '2026-10-13'); p.fill('ed-parent', w.w2.id); p.submit();
  await p.until(() => c.repoGet('PlanItem', w.a.id).wp_id === w.w2.id);
  const a2 = c.repoGet('PlanItem', w.a.id);
  check(a2.name === 'Spécification v2' && a2.planned_finish === '2026-10-13' && a2.wp_id === w.w2.id, 'élément modifié et déplacé dans un autre workpackage');
  await p.until(() => /Spécification v2/.test(p.text('details')));

  await p.pick('wp:' + moules.id, 'Moules');
  p.click(p.$('edit-node'));
  await p.until(() => p.$('editor').open);
  check(p.$('ed-code').value === '3.1' && p.$('ed-parent').value === ind.id, 'workpackage : code et parent affichés');
  p.fill('ed-parent', w.w2.id); p.submit();
  await p.until(() => c.repoGet('WorkPackage', moules.id).parent_wp_id === w.w2.id);
  check(c.repoGet('WorkPackage', moules.id).wbs_code === '2.1', 'déplacé sous le WP 2 sans toucher au code : il est renuméroté (2.1)');
  await p.until(() => /2\.1 Moules/.test(p.text('details')));

  await p.pick('wp:' + w.w1.id, 'Conception');
  p.click(p.$('edit-node'));
  await p.until(() => p.$('editor').open);
  check(!p.$('ed-parent'), 'un workpackage qui a des sous-niveaux ne propose pas de rattachement');
  p.fill('ed-code', '1'); p.fill('ed-name', 'Conception détaillée'); p.submit();
  await p.until(() => c.repoGet('WorkPackage', w.w1.id).name === 'Conception détaillée');
  check(c.repoGet('WorkPackage', w.w1.id).wbs_code === '1', 'renommage sans changement de code');
  await p.until(() => /Conception détaillée/.test(p.text('details')));
  p.click(p.$('edit-node')); await p.until(() => p.$('editor').open);
  p.fill('ed-code', '2'); p.submit();
  await p.until(() => !p.$('ed-error').hidden);
  check(/déjà utilisé/.test(p.text('ed-error')), 'code déjà pris refusé : ' + p.text('ed-error'));
  p.click(p.$('ed-cancel'));

  // ---------------------------------------------------------------- suppression
  await p.pick('item:' + w.j.id, 'Revue');
  p.click(p.$('delete-node'));
  await p.until(() => p.$('confirm').open);
  check(/Supprimer le jalon/.test(p.text('confirm-title')) && /1 lien de dépendance/.test(p.text('confirm-text')), 'confirmation d’un élément : ' + p.text('confirm-text'));
  p.click(p.$('confirm-cancel'));
  check(!p.$('confirm').open && c.repoGet('PlanItem', w.j.id), 'Annuler ne supprime rien');
  p.click(p.$('delete-node'));
  await p.until(() => p.$('confirm').open);
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('PlanItem').every((x) => x.id !== w.j.id));
  await p.until(() => /Supprimé/.test(p.text('toast')));
  check(/Supprimé : 1 livrable ou jalon, 1 dépendance/.test(p.text('toast')) && c.repoList('Dependency').length === 2, 'élément supprimé avec sa dépendance : ' + p.text('toast'));
  await p.until(() => p.$('details').hidden);

  await p.pick('wp:' + w.w1.id, 'Conception détaillée');
  p.click(p.$('delete-node'));
  await p.until(() => p.$('confirm').open);
  check(/contient 1 sous-workpackage et 1 livrable ou jalon\. Tout sera supprimé/.test(p.text('confirm-text')), 'confirmation d’un workpackage non vide, contenu annoncé : ' + p.text('confirm-text'));
  p.click(p.$('confirm-ok'));
  await p.until(() => c.repoList('WorkPackage').every((x) => x.id !== w.w1.id));
  await p.until(() => /Supprimé : 2 workpackages/.test(p.text('toast')));
  check(/Supprimé : 2 workpackages, 1 livrable ou jalon, 2 dépendances/.test(p.text('toast')), 'suppression en cascade : ' + p.text('toast'));
  check(c.repoList('WorkPackage').every((x) => x.id !== w.w11.id) && c.repoList('PlanItem').every((x) => x.id !== w.b.id) && c.repoList('Dependency').length === 0, 'sous-workpackage, élément et dépendances supprimés ensemble');
  await p.until(() => p.nodes() > 0 && !p.doc.querySelector('#canvas-wbs [data-id="wp:' + w.w1.id + '"]'));
  const tree = c.uiCall('wbs.tree', { projectId: w.p1.id }, null);
  const ids = new Set(tree.data.nodes.map((n) => n.id));
  check(tree.data.nodes.every((n) => !n.parent || ids.has(n.parent)), 'aucun élément orphelin dans l’arbre');

  // ---------------------------------------------------------------- 0.14.1 : le WBS d'un programme, tous les projets côte à côte
  const g = openPage(CP);
  await g.until(() => g.nodes() >= 12);
  g.$('picker').value = 'program:' + w.prog.id;
  g.$('picker').dispatchEvent(new g.win.Event('change'));
  await g.until(() => g.node('program:' + w.prog.id));
  const wpCard = g.doc.querySelector('#canvas-wbs .node[data-id^="wp:"]');
  check(g.node('program:' + w.prog.id) && g.node('project:' + w.p1.id) && g.node('project:' + w.p2.id) && !!wpCard, 'programme : la carte du programme, ses deux projets et leurs workpackages sont dessinés');
  check(!g.doc.querySelector('#canvas-wbs .node[data-id^="item:"]'), 'sans les livrables : ils se lisent projet par projet');
  check(/Programme/.test(g.text('ztitle')) && /2 projets, \d+ workpackages/.test(g.text('summary')), 'titre et résumé du programme : ' + g.text('summary'));
  check(g.$('wbs-add').hidden && g.$('wbs-add-deliverable').hidden && g.$('wbs-add-milestone').hidden, 'vue programme : aucun bouton d’ajout (rien ne se crée depuis ici)');
  const wpId = wpCard.getAttribute('data-id');
  await g.pick(wpId, '');
  check(!!g.$('open-project') && !g.$('edit-node') && !g.$('add-subwp') && /Workpackage/.test(g.text('details')), 'le détail d’un workpackage propose seulement « Ouvrir le WBS du projet »');
  g.click(g.$('open-project'));
  await g.until(() => g.doc.querySelector('#canvas-wbs .node[data-id^="item:"]'));
  check(/^project:/.test(g.$('picker').value) && !g.$('wbs-add').hidden, 'le bouton ouvre le WBS du projet : livrables dessinés, boutons d’ajout revenus');
  await g.until(() => g.doc.querySelector('#canvas-wbs .node.selected'));
  check(!!g.doc.querySelector('#canvas-wbs .node.selected[data-id="' + wpId + '"]'), 'et le workpackage choisi y est sélectionné');

  console.log(failed ? '\n' + failed + ' échec(s).' : '\nÉdition du WBS : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
