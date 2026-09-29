/**
 * Essai de la page Structure (OBS et WBS) dans un navigateur simulé (jsdom), avec le vrai Core.
 *   npm i --no-save jsdom@24 && node tests/ui_structure.js
 * (variable UI_DEPS = dossier node_modules à utiliser, si les paquets ne sont pas installés ici)
 */
const fs = require('fs');
const path = require('path');
const dep = (m) => require(process.env.UI_DEPS ? path.join(process.env.UI_DEPS, m) : m);
const { JSDOM } = dep('jsdom');
const { freshCore } = require('./harness');

const c = freshCore();
const S = { actor: 'setup', source: 'setup' };
const A = 'admin@entreprise.com';
const call = (email, action, params) => { const r = c.handleRequest({ action, params, apiVersion: '1.0' }, email); if (!r.ok) throw new Error(action + ' : ' + JSON.stringify(r.error)); return r.data; };
const res = (name, extra) => c.repoInsert('Resource', Object.assign({ resource_type: 'Interne', name, country: 'FR' }, extra || {}), S);
const team = c.repoInsert('HierarchicalTeam', { name: 'Bureau d’études' }, S);
const team2 = c.repoInsert('HierarchicalTeam', { name: 'Conception', parent_team_id: team.id }, S);
const anna = res('Anna', { email: 'anna@entreprise.com', job_function: 'Directrice de programme', organization: 'Maison mère' });
const dan = res('Dan', { email: 'dan@entreprise.com', job_function: 'Responsable de domaine', organization: 'Maison mère', team_id: team.id });
const alice = res('Alice', { email: 'alice@entreprise.com', job_function: 'Cheffe de projet', organization: 'Bureau d’études', team_id: team2.id });
const carl = res('Carl', { resource_type: 'Externe', country: 'DE', job_function: 'Ingénieur essais', organization: 'Sous-traitant Alpha', supplier: 'Alpha GmbH' });
const eve = res('Eve <img src=x onerror=alert(1)>', { email: 'eve@entreprise.com' });
const prog = call(A, 'programs.create', { values: { code: 'PG', name: 'Programme A' } });
const p1 = call(A, 'projects.create', { values: { code: 'P1', name: 'Nacelle', program_id: prog.id, status: 'Actif', holiday_country: 'FR', manager_resource_id: alice.id } });
const role = (r, code, type, id) => c.repoInsert('RoleAssignment', { resource_id: r.id, role_code: code, scope_type: type, scope_id: id }, S);
role(anna, 'PL', 'program', prog.id); role(dan, 'DPL', 'program', prog.id); role(alice, 'CP', 'project', p1.id);
const w1 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Conception', wbs_code: '1', owner_resource_id: alice.id, charge_code: 'C-1' } });
const w11 = call(A, 'workpackages.create', { values: { project_id: p1.id, name: 'Structure', wbs_code: '1.1', parent_wp_id: w1.id, owner_resource_id: carl.id } });
role(carl, 'RWP', 'workpackage', w11.id);
role(eve, 'MEMBER', 'project', p1.id);
role(eve, 'MEMBER', 'workpackage', w11.id);
const it = (name, type, s, f, wp, owner) => call(A, 'planitems.create', { values: { project_id: p1.id, name, item_type: type, planned_start: s, planned_finish: f, wp_id: wp || '', owner_resource_id: owner.id } });
const spec = it('Spécification', 'Livrable', '2026-10-05', '2026-10-09', w1.id, alice);
const plans = it('Plans', 'Livrable', '2026-10-12', '2026-10-16', w11.id, carl);
const rev = it('Revue', 'Jalon', '2026-10-19', '2026-10-19', '', alice);
call(A, 'dependencies.create', { values: { predecessor_id: spec.id, successor_id: plans.id, dep_type: 'FS' } });
call(A, 'dependencies.create', { values: { predecessor_id: plans.id, successor_id: rev.id, dep_type: 'FS' } });

const template = fs.readFileSync(path.join(__dirname, '..', 'src', 'Structure.html'), 'utf8')
  .replace("<?!= include('Style') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Style.html'), 'utf8')).replace("<?!= include('Header') ?>", fs.readFileSync(path.join(__dirname, '..', 'src', 'Header.html'), 'utf8'));

let failed = 0;
const check = (cond, msg) => { if (!cond) { failed++; console.error('✗ ' + msg); } else console.log('  ✓ ' + msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(user, boot) {
  const html = template.replace('<?!= boot ?>', JSON.stringify(Object.assign({ project: p1.id, program: '', tab: 'obs', mode: '', baseUrl: 'https://exemple.test/exec', appsheetUrl: '', version: 'test' }, boot || {})));
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
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
  const w = dom.window, doc = w.document;
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(10); } return false; };
  const click = (n) => n.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const texts = () => [...doc.querySelectorAll('#canvas .node text')].map((t) => t.textContent);
  const nodes = () => [...doc.querySelectorAll('#canvas .node')];
  const box = (g) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform'));
    const r = g.querySelector('rect.card');
    return { x: +m[1], y: +m[2], w: +r.getAttribute('width'), h: +r.getAttribute('height') };
  };
  const overlaps = () => {
    const b = nodes().map(box);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      if (b[i].x < b[j].x + b[j].w && b[j].x < b[i].x + b[i].w && b[i].y < b[j].y + b[j].h && b[j].y < b[i].y + b[i].h) return [i, j];
    }
    return null;
  };
  const checkbox = (key) => doc.querySelector('#opt-attrs input[data-attr="' + key + '"]');
  const setChecked = (input, v) => { input.checked = v; input.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { w, doc, calls, until, click, texts, nodes, box, overlaps, checkbox, setChecked };
}

(async () => {
  console.log('\nPage Structure (jsdom)');

  // ---------------------------------------------------------------- OBS par rôles
  let p = openPage('alice@entreprise.com');
  await p.until(() => p.nodes().length > 0);
  check(p.nodes().length === 6, 'organigramme : 6 rôles (PL, DPL, CP, RWP et deux affectations de membre) — ' + p.nodes().length);
  check(p.doc.querySelectorAll('#canvas .edge').length === 5, 'cinq liens hiérarchiques');
  check(!p.overlaps(), 'aucune carte ne recouvre une autre');
  check(p.doc.getElementById('title').textContent === 'Organisation — P1 — Nacelle', 'titre : ' + p.doc.getElementById('title').textContent);
  let t = p.texts();
  check(t.includes('Fonction : Ingénieur essais') && t.includes('Organisation : Sous-traitant Alpha'), 'fonction et organisation affichées par défaut');
  check(t.includes('Fonction : —'), 'une fonction absente est signalée par un tiret');
  check(!t.some((x) => x.startsWith('E-mail')), 'e-mail masqué par défaut');
  check(t.includes('P1 — Nacelle'), 'périmètre dans l’en-tête');
  check(p.doc.querySelectorAll('img:not(#ppm-logo)').length === 0 && t.some((x) => x.startsWith('Eve <img')), 'un nom contenant du HTML reste du texte');
  check(p.doc.getElementById('nav-plan').getAttribute('href') === 'https://exemple.test/exec?view=gantt&project=' + p1.id, 'lien vers la page Planning');

  // choix des attributs
  p.click(p.doc.getElementById('options-btn'));
  check(!p.doc.getElementById('options').hidden, 'panneau « Attributs affichés » ouvert');
  const boxes = [...p.doc.querySelectorAll('#opt-attrs input')].map((i) => i.getAttribute('data-attr') + ':' + i.checked);
  check(boxes.includes('job_function:true') && boxes.includes('organization:true') && boxes.includes('email:false'), 'cases cochées = valeurs par défaut');
  p.setChecked(p.checkbox('organization'), false);
  t = p.texts();
  check(!t.some((x) => x.startsWith('Organisation :')) && t.some((x) => x.startsWith('Fonction :')), 'décocher « Organisation » la retire des cartes');
  p.setChecked(p.checkbox('job_function'), false);
  p.setChecked(p.checkbox('scope'), false);
  p.setChecked(p.checkbox('email'), true);
  t = p.texts();
  check(!t.some((x) => x.startsWith('Fonction')) && t.includes('E-mail : dan@entreprise.com') && !t.includes('P1 — Nacelle'), 'fonction retirée, e-mail ajouté, périmètre retiré');
  check(!p.overlaps(), 'toujours aucun chevauchement après changement d’attributs');
  await wait(800);
  const saved = JSON.parse(c.repoList('UserSetting').find((u) => u.user_email === 'alice@entreprise.com').view_prefs_json);
  check(JSON.stringify(saved.obs.attrs) === JSON.stringify(['email']), 'choix mémorisés côté serveur : ' + JSON.stringify(saved.obs.attrs));
  check(p.doc.getElementById('prefs-state').textContent === 'Choix enregistrés.', 'confirmation « Choix enregistrés »');

  // couleurs
  const radio = (v) => p.doc.querySelector('#opt-colors input[value="' + v + '"]');
  radio('organization').checked = true; radio('organization').dispatchEvent(new p.w.Event('change', { bubbles: true }));
  let legend = [...p.doc.querySelectorAll('#legend li')].map((l) => l.textContent);
  check(['Bureau d’études', 'Maison mère', 'Sous-traitant Alpha', 'Non renseignée'].every((x) => legend.includes(x)), 'légende par organisation : ' + legend.join(', '));
  radio('role').checked = true; radio('role').dispatchEvent(new p.w.Event('change', { bubbles: true }));
  legend = [...p.doc.querySelectorAll('#legend li')].map((l) => l.textContent);
  check(legend.includes('Chef de projet') && legend.length === 5, 'légende par rôle');

  // repli d'une branche
  const dpl = p.nodes().find((g) => g.getAttribute('aria-label').startsWith('Domain Program Leader'));
  const tog = p.doc.querySelector('.toggle-badge[data-toggle="' + dpl.getAttribute('data-id') + '"]');
  check(!!tog && tog.textContent === '−', 'bouton de repli sur le DPL');
  p.click(tog);
  check(p.nodes().length === 2, 'branche repliée : ne restent que PL et DPL — ' + p.nodes().length);
  check(p.doc.querySelector('.toggle-badge[data-toggle="' + dpl.getAttribute('data-id') + '"]').textContent === '+4', 'le bouton annonce 4 cartes cachées');
  p.click(p.doc.querySelector('.toggle-badge[data-toggle="' + dpl.getAttribute('data-id') + '"]'));
  check(p.nodes().length === 6, 'branche dépliée');

  // détail d'une personne et modification
  p.setChecked(p.checkbox('job_function'), true);
  p.setChecked(p.checkbox('organization'), true);
  const carlG = [...p.doc.querySelectorAll('#canvas [data-person]')].find((g) => g.getAttribute('data-person') === carl.id);
  p.click(carlG);
  check(p.doc.querySelector('#details h2').textContent === 'Carl', 'détail de Carl');
  check(p.doc.getElementById('details').textContent.includes('Sous-traitant Alpha') && p.doc.getElementById('details').textContent.includes('Alpha GmbH'), 'tous les attributs dans le détail, même ceux masqués sur la carte');
  check(!!p.doc.getElementById('edit-function'), 'formulaire de fiche pour un chef de projet');
  p.doc.getElementById('edit-function').value = 'Ingénieur essais senior';
  p.doc.getElementById('edit-org').value = '  Alpha   Test ';
  p.doc.querySelector('form.edit').dispatchEvent(new p.w.Event('submit', { cancelable: true }));
  await p.until(() => c.repoGet('Resource', carl.id).job_function === 'Ingénieur essais senior');
  check(c.repoGet('Resource', carl.id).organization === 'Alpha Test', 'fiche enregistrée, espaces nettoyés');
  await p.until(() => p.texts().includes('Fonction : Ingénieur essais senior'));
  check(p.texts().includes('Organisation : Alpha Test'), 'l’organigramme est rechargé avec les nouvelles valeurs');

  // ---------------------------------------------------------------- OBS par équipes
  p.click(p.doc.querySelector('[data-mode="teams"]'));
  await p.until(() => p.calls.includes('obs.teams') && p.nodes().length > 0);
  check(p.doc.getElementById('scope-pick').hidden && !p.doc.getElementById('team-pick').hidden, 'vue par équipes : sélecteur d’équipe à la place du périmètre');
  t = p.texts();
  check(t.includes('Bureau d’études') && t.includes('Conception') && t.includes('Sans équipe'), 'équipes et « Sans équipe » affichées : ' + t.filter((x) => !x.includes(' : ')).join(' | '));
  check(t.some((x) => /membres?$/.test(x)), 'nombre de membres par défaut');
  check(!p.overlaps(), 'équipes sans chevauchement');
  p.setChecked(p.checkbox('members'), true);
  check(p.texts().some((x) => x.startsWith('Carl')), 'option « Membres de l’équipe » : les personnes sont listées');
  await wait(800);

  // ---------------------------------------------------------------- WBS
  p.click(p.doc.querySelector('[data-tab="wbs"]'));
  await p.until(() => p.calls.includes('wbs.tree') && p.nodes().length > 0);
  check(p.nodes().length === 6, 'WBS : projet, 2 WP, 3 éléments — ' + p.nodes().length);
  check(p.doc.querySelectorAll('#canvas .edge').length === 5 && !p.overlaps(), 'liens du WBS, sans chevauchement');
  t = p.texts();
  check(t.includes('1 Conception') && t.includes('1.1 Structure') && t.includes('Responsable : Alice'), 'code WBS, titre et responsable');
  check(t.includes('Sous-workpackage') && t.includes('Workpackage') && t.includes('Jalon') && t.includes('Livrable'), 'nature de chaque carte écrite en toutes lettres');
  check(t.includes('Date : 19/10/2026'), 'jalon : une seule date');
  check(!t.some((x) => x.startsWith('Imputation')) && !t.some((x) => x.startsWith('Statut')), 'imputation et statut masqués par défaut');
  p.setChecked(p.checkbox('charge_code'), true);
  p.setChecked(p.checkbox('float'), true);
  p.setChecked(p.checkbox('owner_org'), true);
  t = p.texts();
  check(t.includes('Imputation : C-1') && t.includes('Organisation : Alpha Test'), 'imputation et organisation du responsable ajoutées');
  check(t.some((x) => x.startsWith('Sur le chemin critique')), 'marge et chemin critique ajoutés');
  check(!p.overlaps(), 'pas de chevauchement avec davantage d’attributs');
  const showItems = p.doc.getElementById('show-items');
  p.setChecked(showItems, false);
  check(p.nodes().length === 3 && !p.texts().includes('Livrable'), 'sans les livrables et jalons : projet et 2 WP');
  p.setChecked(showItems, true);
  const wp = p.doc.querySelector('#opt-colors input[value="organization"]');
  wp.checked = true; wp.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  legend = [...p.doc.querySelectorAll('#legend li')].map((l) => l.textContent);
  check(legend.includes('Alpha Test') && legend.includes('Bureau d’études'), 'WBS coloré par organisation du responsable');
  p.click(p.nodes().find((g) => g.getAttribute('aria-label') === 'Sous-workpackage Structure'));
  check(p.doc.querySelector('#details h2').textContent === '1.1 Structure' && p.doc.getElementById('details').textContent.includes('Ingénieur essais'), 'détail d’un WP avec fonction du responsable');
  await wait(800);
  const saved2 = JSON.parse(c.repoList('UserSetting').find((u) => u.user_email === 'alice@entreprise.com').view_prefs_json);
  check(saved2.wbs.colorBy === 'organization' && saved2.wbs.attrs.includes('charge_code') && saved2.obs.mode === 'teams', 'choix du WBS et du mode d’organisation mémorisés');

  // ---------------------------------------------------------------- réouverture : les choix sont retrouvés
  const p2 = openPage('alice@entreprise.com', { tab: 'wbs' });
  await p2.until(() => p2.nodes().length > 0);
  check(p2.texts().includes('Imputation : C-1'), 'à la réouverture, les attributs choisis sont déjà appliqués');
  check(p2.checkbox('charge_code').checked && !p2.checkbox('status').checked, 'cases cochées cohérentes');

  // ---------------------------------------------------------------- lecteur sans droit d'édition
  const p3 = openPage('eve@entreprise.com');
  await p3.until(() => p3.nodes().length > 0);
  p3.click([...p3.doc.querySelectorAll('#canvas [data-person]')].find((g) => g.getAttribute('data-person') === carl.id));
  check(!p3.doc.getElementById('edit-function') && /Seuls la personne elle-même/.test(p3.doc.getElementById('details').textContent), 'un simple membre ne peut pas modifier la fiche d’un autre');
  p3.click([...p3.doc.querySelectorAll('#canvas [data-person]')].find((g) => g.getAttribute('data-person') === eve.id));
  check(!!p3.doc.getElementById('edit-function'), 'mais peut compléter sa propre fiche');
  check(p3.doc.querySelectorAll('img:not(#ppm-logo)').length === 0, 'aucune balise injectée par un nom');

  // ---------------------------------------------------------------- programme et WBS
  const p4 = openPage('alice@entreprise.com', { project: '', program: prog.id });
  await p4.until(() => p4.nodes().length > 0);
  check(p4.doc.getElementById('title').textContent === 'Organisation par équipes', 'le mode « par équipes » choisi plus tôt est retrouvé à la réouverture');
  p4.click(p4.doc.querySelector('[data-mode="roles"]'));
  await p4.until(() => p4.doc.getElementById('title').textContent.startsWith('Organisation — '));
  check(p4.doc.getElementById('title').textContent === 'Organisation — PG — Programme A', 'organisation du programme : ' + p4.doc.getElementById('title').textContent);
  p4.click(p4.doc.querySelector('[data-tab="wbs"]'));
  await p4.until(() => p4.calls.includes('wbs.tree'));
  check(p4.doc.getElementById('picker').value === 'project:' + p1.id, 'passer au WBS depuis un programme choisit un de ses projets');

  console.log(failed ? '\n' + failed + ' échec(s) dans la page.' : '\nPage Structure : tout est conforme.');
  process.exit(failed ? 1 : 0);
})();
