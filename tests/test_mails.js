const fs = require('fs');
const path = require('path');
const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nObjet des mails : « [PPM✴️] » partout (0.10.0)');

  const PREFIX = '[PPM✴️] ';
  const CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com', ADMIN = 'admin@entreprise.com';

  test('Le préfixe est posé une seule fois, quel que soit l’objet de départ', () => {
    const w = lot2World();
    eq(w.c.MAIL_PREFIX, '[PPM\u2734\uFE0F]', '✴ suivi du sélecteur d’emoji');
    eq(w.c.mailSubject_('Test'), PREFIX + 'Test');
    eq(w.c.mailSubject_('[PPM] Test'), PREFIX + 'Test', 'l’ancien préfixe est remplacé, pas doublé');
    eq(w.c.mailSubject_('[PPM✴️] Test'), PREFIX + 'Test', 'un préfixe déjà posé n’est pas doublé');
    eq(w.c.mailSubject_('  [PPM] Test'), PREFIX + 'Test');
    eq(w.c.mailSubject_('Échec [PPM] ailleurs'), PREFIX + 'Échec [PPM] ailleurs', 'seul le début de l’objet compte');
    eq(w.c.mailSubject_(''), PREFIX, 'objet vide');
  });

  test('Tous les mails envoyés commencent par [PPM✴️] : notifications, récapitulatifs, essais', () => {
    const w = lot2World();
    w.c.SENT_MAILS = [];
    w.c.notifyUser(ADMIN, 'Échec du traitement nocturne', 'détail');
    w.c.notifyUser(CP, '[PPM] Déjà préfixé à l’ancienne', 'x');
    const prev = w.call(MEMBER, 'digest.preview', { send: true });
    ok(prev.sent && /^\[PPM✴️\] Votre point/.test(prev.subject), 'l’aperçu montre l’objet réellement envoyé : ' + prev.subject);
    const mails = w.c.SENT_MAILS;
    ok(mails.length >= 3, mails.length + ' mails');
    mails.forEach((m) => ok(m.subject.startsWith(PREFIX), 'objet : ' + m.subject));
    eq(mails.filter((m) => /\[PPM/.test(m.subject.slice(PREFIX.length))).length, 0, 'aucun préfixe doublé');
    ok(/\(essai\)$/.test(mails[mails.length - 1].subject), 'le mail d’essai le garde aussi');
  });

  test('Garde-fou : aucun envoi de mail dans le code ne contourne mailSubject_', () => {
    const dir = path.join(__dirname, '..', 'src');
    let calls = 0;
    fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).forEach((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /MailApp\.sendEmail\(([^;]*)\);/g;
      let m;
      while ((m = re.exec(src))) {
        calls++;
        ok(/subject:\s*mailSubject_\(/.test(m[1]), f + ' : MailApp.sendEmail doit passer l’objet par mailSubject_ → ' + m[0].slice(0, 90));
      }
      ok(!/GmailApp\.send|GmailApp\.createDraft|MailApp\.sendEmail\([^)]*\bsubject:\s*'/.test(src), f + ' : pas d’autre moyen d’envoi, ni d’objet en dur');
    });
    ok(calls >= 2, calls + ' envois trouvés dans le code');
  });
};
