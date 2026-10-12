const { test, eq, ok } = require('./harness');
const { lot2World } = require('./fixtures_lot2');

module.exports = function () {
  console.log('\nAccès au classeur Données (0.14.2)');
  const ADMIN = 'admin@entreprise.com', CP = 'carla@entreprise.com', MEMBER = 'mia@entreprise.com', DPL = 'dora@entreprise.com', S = { actor: 'setup', source: 'setup' };

  /** Un monde avec un classeur « Données » et un faux Drive qui note les partages ; le propriétaire du script est le compte « proprio ». */
  function world() {
    const w = lot2World(), c = w.c, editors = new Set(), calls = [];
    c.setProp(c.PROP.DATA_ID, 'classeur-donnees'); c.setProp(c.PROP.HISTORY_ID, 'classeur-historique');
    c.SHEET_DRIVE = { addEditor: (e) => { calls.push('+' + e); if (c.__driveFail) throw new Error(c.__driveFail); editors.add(e); }, removeEditor: (e) => { calls.push('-' + e); editors.delete(e); } };
    c.Session = { getEffectiveUser: () => ({ getEmail: () => c.__owner || 'proprio@entreprise.com' }), getActiveUser: () => ({ getEmail: () => ADMIN }), getScriptTimeZone: () => 'Europe/Paris' };
    return { w, c, editors, calls };
  }
  const sheet = (x, who) => x.w.call(who, 'account.get', {}).sheet;

  test('Une personne invitée reçoit l’accès en modification en ouvrant Mon compte, une seule fois, et voit le lien', () => {
    const x = world(), s = sheet(x, CP);
    eq([s.state, s.url, s.enabled], ['granted', 'https://docs.google.com/spreadsheets/d/classeur-donnees/edit', true], 'accès accordé et lien du classeur Données');
    eq(x.calls, ['+' + CP], 'un seul partage, à cette personne');
    sheet(x, CP); sheet(x, CP);
    eq(x.calls, ['+' + CP], 'les ouvertures suivantes ne redemandent rien à Drive');
    eq(JSON.parse(x.c.getProp(x.c.PROP.SHEET_GRANTED, '[]')), [CP], 'l’outil retient à qui il a accordé l’accès');
    eq(sheet(x, MEMBER).state, 'granted', 'un simple membre invité l’a aussi');
    ok(!/historique/i.test(JSON.stringify(s)), 'le classeur Historique n’est jamais mentionné');
  });

  test('Le fichier partagé est le classeur Données, jamais l’Historique ; une adresse hors domaine n’y a pas droit', () => {
    const x = world(), c = x.c, files = [];
    c.SHEET_DRIVE = null;
    c.DriveApp = { getFileById: (id) => { files.push(id); return { addEditor: () => {}, removeEditor: () => {}, getName: () => 'Données PPM' }; } };
    c.sheetGrant_(CP);
    eq(files, ['classeur-donnees'], 'Drive est interrogé sur le classeur Données seulement');
    eq(['x@autre.fr', 'pas une adresse', '', null, '@entreprise.com'].map((e) => c.sheetGrant_(e).state), ['not_eligible', 'not_eligible', 'not_eligible', 'not_eligible', 'not_eligible'], 'domaine non autorisé ou adresse invalide : aucun accès');
    eq(c.sheetGrant_('  Dora@Entreprise.COM ').ok, true, 'majuscules et espaces ignorés');
    ok(c.sheetGranted_().includes('dora@entreprise.com'), 'adresse mémorisée en minuscules');
  });

  test('Administrateur : il voit toujours le lien ; sans classeur, rien ; le propriétaire du script n’est pas ajouté', () => {
    const x = world();
    eq(sheet(x, ADMIN).state, 'granted', 'l’administrateur reçoit l’accès comme les autres');
    x.c.__owner = ADMIN; x.calls.length = 0; x.c.sheetSetGranted_([]);
    eq([sheet(x, ADMIN).state, x.calls], ['granted', []], 'propriétaire du script : il a déjà le classeur, Drive n’est pas sollicité');
    const none = world(); none.c.setProp(none.c.PROP.DATA_ID, '');
    eq([sheet(none, CP).state, sheet(none, CP).url], ['hidden', ''], 'aucun classeur (A1 pas lancé) : rien à montrer');
  });

  test('Drive refuse : l’échec est dit, jamais enregistré comme un accès, et réessayé à l’ouverture suivante', () => {
    const x = world(); x.c.__driveFail = 'Cette adresse n’a pas de compte Google';
    const s = sheet(x, CP);
    eq([s.state, s.url, /pas de compte Google/.test(s.reason)], ['failed', '', true], 'état « échec » avec la raison, sans lien');
    eq(x.c.sheetGranted_(), [], 'rien n’est retenu comme accordé');
    x.c.__driveFail = null;
    eq([sheet(x, CP).state, x.calls.length], ['granted', 2], 'l’ouverture suivante réessaie et réussit');
    x.c.__driveFail = 'quota'; const adminFail = world(); adminFail.c.__driveFail = 'quota';
    eq([adminFail.w.call(ADMIN, 'account.get', {}).sheet.url !== '', adminFail.w.call(ADMIN, 'account.get', {}).sheet.state], [true, 'failed'], 'l’administrateur voit le lien même si son partage échoue (il peut se partager le classeur)');
  });

  test('Créer une personne avec une adresse lui donne l’accès tout de suite ; sans adresse, rien', () => {
    const x = world();
    x.w.call(ADMIN, 'resources.create', { values: { name: 'Nina Invitée', email: 'nina@entreprise.com', resource_type: 'Interne', country: 'FR' } });
    eq(x.calls, ['+nina@entreprise.com'], 'invitée dans Ressources : accès accordé');
    x.w.call(ADMIN, 'resources.create', { values: { name: 'Sans Adresse', resource_type: 'Externe', country: 'FR' } });
    eq(x.calls.length, 1, 'sans adresse : pas de partage');
    x.c.__driveFail = 'panne Drive';
    ok(x.w.call(ADMIN, 'resources.create', { values: { name: 'Oscar Panne', email: 'oscar@entreprise.com', resource_type: 'Interne', country: 'FR' } }).name === 'Oscar Panne', 'une panne de Drive ne bloque jamais la création de la personne');
  });

  test('Synchronisation : accorde aux invités, retire ceux qui sont partis, ne touche jamais un partage fait à la main', () => {
    const x = world(), c = x.c;
    x.editors.add('manuel@entreprise.com'); // partagé par le propriétaire, hors outil
    c.repoInsert('Resource', { name: 'Paul', email: 'paul@entreprise.com', resource_type: 'Interne', country: 'FR' }, S);
    c.repoInsert('Resource', { name: 'Quentin', email: 'quentin@autre.fr', resource_type: 'Externe', country: 'FR' }, S); // hors domaine
    const r = x.w.call(ADMIN, 'admin.sheet.sync', {});
    ok(r.enabled && r.failed.length === 0 && r.granted >= 5, JSON.stringify({ granted: r.granted, already: r.already, failed: r.failed }));
    ok(x.editors.has('paul@entreprise.com') && !x.editors.has('quentin@autre.fr'), 'Paul invité, Quentin hors domaine écarté');
    const again = x.w.call(ADMIN, 'admin.sheet.sync', {});
    eq([again.granted, again.already >= r.granted, again.revoked], [0, true, 0], 'une seconde synchronisation ne refait rien');
    c.repoSoftDelete('Resource', c.repoList('Resource').find((p) => p.name === 'Paul').id, null, S);
    const after = x.w.call(ADMIN, 'admin.sheet.sync', {});
    eq([after.revoked, x.editors.has('paul@entreprise.com'), x.editors.has('manuel@entreprise.com')], [1, false, true], 'Paul n’est plus dans l’outil : son accès est retiré ; le partage manuel reste');
    eq(x.w.raw(CP, 'admin.sheet.sync', {}).error.code, 'FORBIDDEN', 'réservé aux administrateurs');
    eq(x.w.raw(DPL, 'admin.sheet.sync', {}).error.code, 'FORBIDDEN', 'même pour un DPL');
  });

  test('Couper le partage : les accès accordés par l’outil sont retirés, pas les autres ; le lien reste à l’administrateur seul ; tracé', () => {
    const x = world(), c = x.c;
    sheet(x, CP); sheet(x, MEMBER); x.editors.add('manuel@entreprise.com');
    eq(x.w.call(ADMIN, 'admin.get', {}).sheet_granted, 2, 'deux accès accordés par l’outil');
    const off = x.w.call(ADMIN, 'admin.set', { values: { sheet_share: false } });
    eq([off.sheet_share, off.changed, off.sheet_revoked.revoked, off.sheet_granted], [false, ['sheet_share'], 2, 0], 'partage coupé, deux accès retirés');
    ok(!x.editors.has(CP) && !x.editors.has(MEMBER) && x.editors.has('manuel@entreprise.com'), 'le partage manuel n’est pas touché');
    eq([sheet(x, CP).state, sheet(x, CP).url], ['disabled', ''], 'un invité ne voit plus le lien');
    eq([sheet(x, ADMIN).state, sheet(x, ADMIN).url !== ''], ['disabled', true], 'l’administrateur le voit encore');
    ok(c.repoList('ChangeEvent').some((e) => e.table_name === 'Réglages' && e.field === 'sheet_share' && e.old_value === 'oui' && e.new_value === 'non' && e.actor === ADMIN), 'tracé dans le journal des réglages : avant, après, auteur');
    const on = x.w.call(ADMIN, 'admin.set', { values: { sheet_share: true } });
    eq([on.sheet_share, on.sheet_granted, x.calls.filter((k) => k[0] === '+').length], [true, 0, 2], 'rétabli : aucun partage en masse, chacun le retrouve à l’ouverture de Mon compte');
    eq(sheet(x, CP).state, 'granted', 'accès rendu à l’ouverture');
    eq(x.w.raw(CP, 'admin.set', { values: { sheet_share: false } }).error.code, 'FORBIDDEN', 'seul un administrateur coupe le partage');
  });

  test('Traitement de nuit : les personnes invitées dans la journée reçoivent leur accès', () => {
    const x = world(), c = x.c;
    c.repoInsert('Resource', { name: 'Rita', email: 'rita@entreprise.com', resource_type: 'Interne', country: 'FR' }, S); // invitée sans passer par l'action
    eq(x.calls, [], 'pas encore partagé');
    c.nightlyRun();
    ok(x.calls.includes('+rita@entreprise.com'), 'la nuit, Rita reçoit son accès : ' + x.calls.join(','));
    c.SHEET_DRIVE = null; c.sheetSync_ = () => { throw new Error('Drive indisponible'); };
    let thrown = null; try { c.nightlyRun(); } catch (e) { thrown = e; }
    eq(thrown, null, 'une panne du partage ne fait jamais échouer le traitement de nuit');
  });

  test('A7 : le partage du classeur est contrôlé (accès accordés, personnes attendues, partage coupé)', () => {
    const x = world(), c = x.c; c.Session.getActiveUser = () => ({ getEmail: () => ADMIN });
    const row = () => c.liveSmokeTest_().rows.find((r) => r.name.indexOf('Classeur Données') === 0);
    sheet(x, CP);
    ok(row().status === 'OK' && /1 accès accordé\(s\) par l’outil, \d+ personne\(s\) attendue\(s\)/.test(row().detail), row().detail);
    c.setProp(c.PROP.SHEET_SHARE, 'non');
    ok(row().status === 'ATTENTION' && /le partage est coupé/.test(row().detail), row().detail);
    c.setProp(c.PROP.DATA_ID, '');
    ok(row().status === 'ATTENTION' && /A1_INSTALLER_PPM/.test(row().detail), row().detail);
  });
};
