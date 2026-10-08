const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nCopilote en suspens (0.11.0)');

  const CP = 'carla@entreprise.com', ADMIN = 'admin@entreprise.com';

  /** Faux HtmlService : garde le modèle choisi et les données de démarrage envoyées à la page. */
  function pageRenderer(w) {
    const seen = {};
    w.c.HtmlService = {
      createTemplateFromFile(file) { seen.file = file; const t = { evaluate() { seen.boot = JSON.parse(t.boot); return { setTitle(x) { seen.title = x; return this; }, addMetaTag() { return this; } }; } }; return t; },
      createHtmlOutput() { return { setTitle() { return this; } }; }
    };
    return (user, view) => { w.c.Session = { getActiveUser: () => ({ getEmail: () => user }) }; w.c.renderPage_({ parameter: { view: view, project: w.p1.id } }); return seen; };
  }

  test('Suspendu : les demandes au copilote sont refusées, le reste de l’outil fonctionne', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.COPILOT, 'non');
    eq(w.c.copilotEnabled_(), false);
    [['copilot.status', { projectId: w.p1.id }], ['copilot.brief', { projectId: w.p1.id }], ['copilot.ask', { projectId: w.p1.id, question: 'x' }],
      ['copilot.feedback', {}], ['copilot.suggestions', { projectId: w.p1.id }], ['simulations.run', { projectId: w.p1.id, hypotheses: [] }]].forEach(([a, p]) => {
      const r = w.raw(CP, a, p);
      eq([a, r.error.code, r.error.message], [a, 'FORBIDDEN', 'Le copilote est en suspens.']);
    });
    ok(w.raw(CP, 'overview.get', {}).ok && w.raw(CP, 'baselines.list', { projectId: w.p1.id }).ok && w.raw(CP, 'budget.access', { projectId: w.p1.id }).ok, 'les autres fonctions ne sont pas touchées');
    w.c.setProp(w.c.PROP.COPILOT, 'oui');
    eq(w.c.copilotEnabled_(), true, 'réactivé par la propriété PPM_COPILOT = oui');
    ok(w.raw(CP, 'copilot.status', { projectId: w.p1.id }).ok);
    w.c.setProp(w.c.PROP.COPILOT, 'OUI');
    eq(w.c.copilotEnabled_(), true, 'sans tenir compte de la casse');
    w.c.setProp(w.c.PROP.COPILOT, '');
    eq(w.c.copilotEnabled_(), false, 'valeur vide : en suspens');
  });

  test('Suspendu : la page Copilote redirige vers l’Overview, la page d’accueil ne peut pas être le copilote', () => {
    const w = lot2World();
    const render = pageRenderer(w);
    w.c.setProp(w.c.PROP.COPILOT, 'non');
    let seen = render(CP, 'copilote');
    eq([seen.file, seen.boot.view, seen.boot.copilot], ['Overview', 'overview', false], 'on arrive sur l’Overview');
    w.call(CP, 'ui.set', { home: 'copilote' });
    seen = render(CP, 'budget');
    eq([seen.boot.home, seen.boot.copilot], ['overview', false], 'accueil « copilote » mémorisé : l’Overview le remplace');
    w.c.setProp(w.c.PROP.COPILOT, 'oui');
    seen = render(CP, 'copilote');
    eq([seen.file, seen.boot.view, seen.boot.copilot, render(CP, 'budget').boot.home], ['Copilote', 'copilote', true, 'copilote'], 'réactivé : la page et l’accueil reviennent');
  });

  test('Administration : le copilote disparaît des réglages, de la santé et des journaux tant qu’il est suspendu', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.COPILOT, 'non');
    eq([w.call(ADMIN, 'admin.get', {}).copilot_enabled, w.call(ADMIN, 'admin.health', {}).copilot_enabled, w.call(ADMIN, 'admin.logs', {}).copilot_enabled], [false, false, false]);
    w.c.setProp(w.c.PROP.COPILOT, 'oui');
    eq([w.call(ADMIN, 'admin.get', {}).copilot_enabled, w.call(ADMIN, 'admin.health', {}).copilot_enabled, w.call(ADMIN, 'admin.logs', {}).copilot_enabled], [true, true, true]);
    ok(w.call(ADMIN, 'admin.get', {}).ai_mode !== undefined, 'les réglages enregistrés sont conservés');
  });
};
