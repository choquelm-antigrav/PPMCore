const fs = require('fs');
const path = require('path');
const { freshCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nFabrication du fichier unique et installation');
  const root = path.join(__dirname, '..');

  test('Fabrication : 8 fichiers, sources dans l’ordre, style et bannière intégrés, versions cohérentes', () => {
    const r = require('../tools/build').build();
    eq(r.out, ['Admin.html', 'Compte.html', 'Copilote.html', 'Gantt.html', 'PPM_Core.gs', 'Structure.html', 'Suivi.html', 'appsscript.json']);
    const core = fs.readFileSync(path.join(root, 'dist', 'PPM_Core.gs'), 'utf8');
    const gs = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.gs')).sort();
    const pos = gs.map((f) => core.indexOf('// ' + f + '\n'));
    ok(pos.every((p) => p > 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), 'tous les fichiers, dans l’ordre de leur numéro');
    const c = freshCore();
    ['Gantt', 'Structure', 'Suivi', 'Copilote', 'Compte', 'Admin'].forEach((p) => {
      const html = fs.readFileSync(path.join(root, 'dist', p + '.html'), 'utf8');
      ok(html.indexOf("include('") < 0 && html.indexOf('.ppm-bar {') > 0 && html.indexOf('id="ppm-theme"') > 0, p + ' : style et bannière intégrés');
      ok(html.indexOf('family=Inter') > 0 && html.indexOf('data-theme="<?= theme ?>"') > 0, p + ' : police Inter, thème appliqué au chargement');
      ok(html.indexOf('<meta name="ppm-version" content="' + c.PPM_VERSION + '">') > 0, p + ' : version ' + c.PPM_VERSION);
      ok(Object.values(c.PAGES).includes(p), p + ' : page déclarée dans le routeur');
    });
  });

  test('Installation en une fonction : domaine et administrateur déduits du compte, puis installation', () => {
    const c = freshCore();
    c.setProp(c.PROP.DOMAIN, '');
    c.setProp(c.PROP.ADMINS, '');
    const calls = [];
    c.Session = { getEffectiveUser: () => ({ getEmail: () => 'Max.Martin@Entreprise.com' }), getActiveUser: () => ({ getEmail: () => '' }) };
    c.setupPpm = () => { calls.push('setup'); return 'Installation terminée'; };
    c.installTriggers = () => { calls.push('triggers'); return 'Déclencheurs installés'; };
    c.selfCheck = () => { calls.push('check'); return 'Installation conforme'; };
    const msg = c.installerPpm();
    eq(calls, ['setup', 'triggers', 'check']);
    eq([c.allowedDomain(), c.adminEmails()], ['entreprise.com', ['max.martin@entreprise.com']]);
    ok(/Domaine réglé sur entreprise\.com/.test(msg) && /Application Web/.test(msg), msg);
    c.setProp(c.PROP.ADMINS, 'a@entreprise.com,b@entreprise.com');
    c.installerPpm();
    eq(c.adminEmails(), ['a@entreprise.com', 'b@entreprise.com'], 'des réglages existants ne sont jamais écrasés');
  });
};
