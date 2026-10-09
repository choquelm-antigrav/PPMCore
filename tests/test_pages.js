const fs = require('fs');
const path = require('path');
const { freshCore, test, eq, ok } = require('./harness');

module.exports = function () {
  console.log('\nRegistre des pages (src/00_Pages.gs) : rien ne doit manquer quand on ajoute une page');
  const root = path.join(__dirname, '..');
  const c = freshCore(), pages = c.PPM_PAGES;
  const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
  const header = read('Header.html');
  const evalLiteral = (re, what) => { const m = re.exec(header); if (!m) throw new Error(what + ' introuvable dans Header.html'); return new Function('return ' + m[1])(); };
  const EYEBROW = evalLiteral(/var EYEBROW = (\{[^;]*\});/, 'EYEBROW'), SHARE = evalLiteral(/var SHARE = (\[[^\]]*\]);/, 'SHARE');
  const nav = (/<nav class="ppm-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(header) || [])[1] || '';

  test('Registre : une entrée complète par page, sans doublon', () => {
    ok(pages.length >= 10, pages.length + ' pages');
    pages.forEach((p) => {
      ok(/^[a-z]+$/.test(p.view) && /^[A-Z][A-Za-z]+$/.test(p.file) && /^PPM — /.test(p.title) && p.eyebrow && Array.isArray(p.tabs) && p.tabs.length >= 1 && ['bar', 'icon'].includes(p.nav) && typeof p.share === 'boolean' && Array.isArray(p.parts), 'entrée complète : ' + p.view);
    });
    eq(new Set(pages.map((p) => p.view)).size, pages.length, 'une vue par entrée');
    eq(new Set(pages.map((p) => p.file)).size, pages.length, 'un fichier par entrée');
  });

  test('Registre : chaque page est un fichier de src/ qui inclut Style, Common et Header et annonce sa version', () => {
    pages.forEach((p) => {
      ok(fs.existsSync(path.join(root, 'src', p.file + '.html')), p.file + '.html existe');
      const h = read(p.file + '.html');
      ['Style', 'Common', 'Header'].forEach((n) => ok(h.includes("<?!= include('" + n + "') ?>"), p.file + ' : inclusion de ' + n));
      ok(/<meta name="ppm-version" content="[^"]+">/.test(h), p.file + ' : balise ppm-version');
    });
  });

  test('Registre : aucune page de src/ n’échappe au registre', () => {
    const parts = [].concat(...pages.map((p) => p.parts));
    const files = fs.readdirSync(path.join(root, 'src')).filter((f) => /\.html$/.test(f) && !['Style.html', 'Common.html', 'Header.html'].includes(f) && !parts.includes(f.replace(/\.html$/, ''))).sort();
    eq(files, pages.map((p) => p.file + '.html').sort(), 'les fichiers de src/ sont les pages du registre, leurs morceaux et les trois parties communes');
    eq(new Set(parts).size, parts.length, 'un morceau n’appartient qu’à une page');
    pages.forEach((p) => {
      const h = read(p.file + '.html'), order = p.parts.map((n) => h.indexOf("<?!= include('" + n + "') ?>"));
      p.parts.forEach((n, i) => { ok(fs.existsSync(path.join(root, 'src', n + '.html')) && order[i] >= 0, p.file + ' : le morceau ' + n + ' existe et est inclus'); });
      ok(order.every((x, i) => i === 0 || x > order[i - 1]), p.file + ' : morceaux inclus dans l’ordre du registre');
    });
  });

  test('Registre : la barre du haut connaît chaque page (lien ou icône, libellé, partage du projet courant)', () => {
    pages.forEach((p) => {
      ok(header.includes('data-view="' + p.view + '"'), p.view + ' : lien ou icône dans Header.html');
      eq(nav.includes('data-view="' + p.view + '"'), p.nav === 'bar', p.view + ' : dans la barre de liens seulement si nav = bar');
      eq(EYEBROW[p.view], p.eyebrow, p.view + ' : libellé de Header.html (EYEBROW) identique à celui du registre');
      eq(SHARE.includes(p.view), p.share, p.view + ' : partage du projet courant (SHARE) conforme au registre');
    });
    eq(Object.keys(EYEBROW).sort(), pages.map((p) => p.view).sort(), 'aucun libellé d’une page inconnue');
    ok(SHARE.every((v) => pages.some((p) => p.view === v)), 'SHARE ne cite que des pages connues');
  });

  test('Registre : les tables du serveur en sont déduites, les aperçus ne gardent pas de copie', () => {
    pages.forEach((p) => eq([c.PAGES[p.view], c.PAGE_TITLES[p.view], c.PAGE_TABS[p.view]], [p.file, p.title, p.tabs], p.view));
    eq(Object.keys(c.PAGES).length, pages.length);
    ['preview_server.js', 'preview_demo.js'].forEach((f) => {
      const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
      ok(/c\.PPM_PAGES/.test(s) && !/structure: 'Structure\.html'/.test(s), f + ' lit le registre');
    });
    eq(require('../tools/build').build().out.filter((f) => /\.html$/.test(f)).sort(), pages.map((p) => p.file + '.html').sort(), 'la fabrication produit exactement les pages du registre');
  });
};
