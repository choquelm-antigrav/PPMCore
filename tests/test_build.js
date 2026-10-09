const fs = require('fs');
const path = require('path');
const { freshCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nFabrication du fichier unique et installation');
  const root = path.join(__dirname, '..');

  test('Fabrication : 12 fichiers, sources dans l’ordre, style et bannière intégrés, versions cohérentes', () => {
    const r = require('../tools/build').build();
    eq(r.out, freshCore().PPM_PAGES.map((p) => p.file + '.html').concat(['PPM_Core.gs', 'appsscript.json']).sort(), 'les pages du registre, le Core et le manifeste');
    const core = fs.readFileSync(path.join(root, 'dist', 'PPM_Core.gs'), 'utf8');
    const gs = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.gs')).sort();
    const pos = gs.map((f) => core.indexOf('// ' + f + '\n'));
    ok(pos.every((p) => p > 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), 'tous les fichiers, dans l’ordre de leur numéro');
    const c = freshCore();
    ['Gantt', 'Structure', 'Suivi', 'Copilote', 'Compte', 'Admin', 'Budget', 'Overview', 'Ressources'].forEach((p) => {
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
    const msg = c.A1_INSTALLER_PPM();
    eq(calls, ['setup', 'triggers', 'check']);
    eq([c.allowedDomain(), c.adminEmails()], ['entreprise.com', ['max.martin@entreprise.com']]);
    ok(/Domaine réglé sur entreprise\.com/.test(msg) && /Application Web/.test(msg), msg);
    c.setProp(c.PROP.ADMINS, 'a@entreprise.com,b@entreprise.com');
    c.A1_INSTALLER_PPM();
    eq(c.adminEmails(), ['a@entreprise.com', 'b@entreprise.com'], 'des réglages existants ne sont jamais écrasés');
  });

  test('Manifeste : chaque service Google utilisé dans le code a son autorisation déclarée (sinon il échoue dans le vrai Apps Script)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'appsscript.json'), 'utf8'));
    const scopes = manifest.oauthScopes || [];
    const code = fs.readdirSync(path.join(root, 'src')).filter((f) => /\.gs$/.test(f)).map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8'))
      .join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const need = [
      [/\bSpreadsheetApp\./, 'https://www.googleapis.com/auth/spreadsheets'], [/\bDriveApp\./, 'https://www.googleapis.com/auth/drive'],
      [/\bCalendarApp\.|\bCalendar\.(Events|Calendars|Acl|CalendarList)\b/, 'https://www.googleapis.com/auth/calendar'], [/\bDocumentApp\./, 'https://www.googleapis.com/auth/documents'],
      [/\bUrlFetchApp\.fetch/, 'https://www.googleapis.com/auth/script.external_request'], [/\bMailApp\./, 'https://www.googleapis.com/auth/script.send_mail'],
      [/\bScriptApp\./, 'https://www.googleapis.com/auth/script.scriptapp'], [/Session\.getActiveUser\(\)/, 'https://www.googleapis.com/auth/userinfo.email']
    ];
    const missing = need.filter(([re, scope]) => re.test(code) && !scopes.includes(scope)).map(([, scope]) => scope);
    eq(missing, [], 'autorisations manquantes au manifeste');
    const unused = scopes.filter((s) => !need.some(([re, scope]) => scope === s && re.test(code)));
    eq(unused, [], 'autorisations déclarées mais sans usage (à ne pas demander aux utilisateurs pour rien)');
    ok(!/\bGmailApp\./.test(code), 'GmailApp n’est pas utilisé : son autorisation (très large) n’est donc pas demandée');
    eq(manifest.runtimeVersion, 'V8', 'moteur V8 : requis par String.normalize et la syntaxe employée');
    ok(!manifest.urlFetchWhitelist, 'aucune liste blanche d’adresses : elle bloquerait Google si elle était incomplète');
  });
};
