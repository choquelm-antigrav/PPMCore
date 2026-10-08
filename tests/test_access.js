const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nAccès par domaine (0.10.0)');

  const CP = 'carla@entreprise.com', ADMIN = 'admin@entreprise.com';

  test('Un compte hors domaine est refusé avec un message qui dit pourquoi et quoi faire', () => {
    const w = lot2World();
    const wrong = w.raw('max@gmail.com', 'account.get', {});
    eq(wrong.error.code, 'FORBIDDEN');
    ok(/Votre compte \(max@gmail\.com\) n’est pas dans un domaine autorisé \(entreprise\.com\)/.test(wrong.error.message) && /PPM_DOMAIN/.test(wrong.error.message), wrong.error.message);
    const anon = w.raw('', 'account.get', {});
    ok(/n’a pas pu être identifié/.test(anon.error.message) && /navigation privée/.test(anon.error.message), anon.error.message);
    w.c.setProp(w.c.PROP.DOMAIN, '');
    ok(/domaine n’est pas réglé/.test(w.raw(CP, 'account.get', {}).error.message), 'domaine non réglé : message dédié');
  });

  test('Plusieurs domaines : séparés par une virgule dans PPM_DOMAIN', () => {
    const w = lot2World();
    w.c.setProp(w.c.PROP.DOMAIN, ' Entreprise.com ,filiale.fr; autre.org');
    eq(w.c.allowedDomains(), ['entreprise.com', 'filiale.fr', 'autre.org']);
    eq(w.c.allowedDomain(), 'entreprise.com', 'le premier sert à l’affichage');
    ok(w.raw('zoe@filiale.fr', 'account.get', {}).ok, 'un compte du second domaine est accepté');
    ok(w.raw('x@autre.org', 'account.get', {}).ok);
    eq(w.raw('x@ailleurs.com', 'account.get', {}).error.code, 'FORBIDDEN');
    ok(/entreprise\.com, filiale\.fr, autre\.org/.test(w.raw('x@ailleurs.com', 'account.get', {}).error.message), 'le message liste les domaines autorisés');
    eq(w.c.isAllowedEmail_('Zoe@FILIALE.fr'), true);
    eq(w.c.isAllowedEmail_('zoe@filiale.fr.evil.com'), false, 'pas de correspondance partielle');
  });

  test('L’administrateur règle les domaines, sans pouvoir retirer le sien', () => {
    const w = lot2World();
    const set = (domains) => w.raw(ADMIN, 'admin.set', { values: { domains } });
    eq(set('').error.code, 'VALIDATION');
    ok(/retirer votre propre domaine/.test(set('filiale.fr').error.message), 'on ne se verrouille pas dehors');
    eq(set('entreprise.com, pas-un-domaine').error.code, 'VALIDATION');
    eq(set('a.com,b.com,c.com,d.com,e.com,f.com,entreprise.com').error.code, 'VALIDATION');
    const r = set('entreprise.com, filiale.fr');
    eq([r.data.domain, r.data.changed], ['entreprise.com, filiale.fr', ['domains']]);
    ok(w.raw('zoe@filiale.fr', 'account.get', {}).ok, 'effet immédiat');
    ok(w.raw(ADMIN, 'admin.set', { values: { admins: [ADMIN, 'zoe@filiale.fr'] } }).ok, 'une adresse du nouveau domaine peut être administratrice');
    ok(w.c.repoList('ChangeEvent').some((e) => e.table_name === 'Réglages' && e.field === 'domains' && e.new_value === 'entreprise.com,filiale.fr'), 'changement tracé');
    eq(w.raw(CP, 'admin.set', { values: { domains: 'x.com' } }).error.code, 'FORBIDDEN');
  });

  test('Diagnostic depuis l’éditeur : montre le compte détecté, les domaines et la conduite à tenir', () => {
    const w = lot2World();
    w.c.Session = { getEffectiveUser: () => ({ getEmail: () => 'max@gmail.com' }), getActiveUser: () => ({ getEmail: () => '' }) };
    const t = w.c.A4_DIAGNOSTIC_ACCES();
    ok(/Compte qui exécute le script : max@gmail\.com/.test(t) && /non identifié/.test(t) && /Domaines autorisés \(PPM_DOMAIN\) : entreprise\.com/.test(t) && /REFUSÉ/.test(t), t);
    w.c.Session = { getEffectiveUser: () => ({ getEmail: () => CP }), getActiveUser: () => ({ getEmail: () => CP }) };
    ok(/ACCEPTÉ/.test(w.c.A4_DIAGNOSTIC_ACCES()));
  });
};
