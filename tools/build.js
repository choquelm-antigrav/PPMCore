/**
 * Fabrique la version à installer (dossier dist/) à partir des sources modulaires (dossier src/).
 *
 *   node tools/build.js
 *
 * Résultat : 9 fichiers au lieu d'une trentaine.
 *   PPM_Core.gs      tous les .gs de src/, dans l'ordre de leur numéro (l'ordre de chargement compte :
 *                    00_Config doit passer avant 30_Api, qui doit passer avant les modules qui déclarent des actions) ;
 *   Gantt, Structure, Suivi, Copilote, Compte, Admin, Budget (un .html chacun)   avec le style commun et la bannière intégrés ;
 *   appsscript.json  le manifeste.
 *
 * Les sources restent la référence : on ne modifie jamais dist/ à la main (il est réécrit à chaque fabrication).
 * Le fichier .clasp.json éventuellement présent dans dist/ est conservé.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const PAGES = ['Gantt', 'Structure', 'Suivi', 'Copilote', 'Compte', 'Admin', 'Budget'];

function build() {
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.gs')).sort();
  const config = fs.readFileSync(path.join(src, '00_Config.gs'), 'utf8');
  const version = (/var PPM_VERSION = '([^']+)'/.exec(config) || [])[1];
  if (!version) throw new Error('PPM_VERSION introuvable dans 00_Config.gs');

  const parts = files.map((f) => {
    const body = fs.readFileSync(path.join(src, f), 'utf8').replace(/\s+$/, '');
    return '// ' + '='.repeat(70) + '\n// ' + f + '\n// ' + '='.repeat(70) + '\n\n' + body + '\n';
  });
  const hash = crypto.createHash('sha256').update(parts.join('')).digest('hex').slice(0, 12);
  const header = [
    '/**',
    ' * PPM Core ' + version + ' — fichier unique à installer (fabriqué par tools/build.js, empreinte ' + hash + ').',
    ' * NE PAS MODIFIER ICI : modifier les sources (dossier src/), puis refabriquer.',
    ' * Contient, dans cet ordre : ' + files.join(', ') + '.',
    ' */',
    ''
  ].join('\n');

  fs.mkdirSync(dist, { recursive: true });
  fs.readdirSync(dist).forEach((f) => { if (f !== '.clasp.json') fs.rmSync(path.join(dist, f), { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dist, 'PPM_Core.gs'), header + '\n' + parts.join('\n'));

  const partial = (n) => fs.readFileSync(path.join(src, n + '.html'), 'utf8').replace(/\s+$/, '');
  PAGES.forEach((p) => {
    let html = fs.readFileSync(path.join(src, p + '.html'), 'utf8');
    ['Style', 'Header'].forEach((n) => {
      if (html.indexOf("<?!= include('" + n + "') ?>") < 0) throw new Error(p + '.html : include(\'' + n + '\') absent');
      html = html.replace("<?!= include('" + n + "') ?>", partial(n));
    });
    if (/include\(/.test(html.replace(/function include\(/g, ''))) throw new Error(p + '.html : un include() n’a pas été intégré');
    const meta = /<meta name="ppm-version" content="([^"]+)">/.exec(html);
    if (!meta) throw new Error(p + '.html : balise <meta name="ppm-version"> absente');
    if (meta[1] !== version) throw new Error(p + '.html annonce la version ' + meta[1] + ' au lieu de ' + version);
    fs.writeFileSync(path.join(dist, p + '.html'), html);
  });
  JSON.parse(fs.readFileSync(path.join(src, 'appsscript.json'), 'utf8'));
  fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(dist, 'appsscript.json'));
  return { version, hash, files: files.length, out: fs.readdirSync(dist).filter((f) => f !== '.clasp.json').sort() };
}

module.exports = { build };

if (require.main === module) {
  const r = build();
  console.log('PPM Core ' + r.version + ' fabriqué dans dist/ (' + r.files + ' fichiers .gs réunis, empreinte ' + r.hash + ') :\n  ' + r.out.join('\n  '));
}
