/**
 * PPM Core — 0.21.0 : les CONSTATS du moteur de règles sur l'exercice budgétaire (dotation et plan).
 *
 * Le moteur (06_Rules.gs) transforme un écart en un constat que le chef de projet voit dans sa routine (page Suivi, récapitulatif du matin) : il ne bloque rien. Ces règles regardent les
 * mêmes chiffres que la page Budget (exerciseData_ et exerciseTable_) : le constat et le tableau ne peuvent pas se contredire. Un constat disparaît tout seul quand l'écart est résorbé ;
 * « Accepté » ou « Ignoré » n'est pas recréé (clé : règle + objet, l'exercice et le projet étant dans l'objet).
 *
 *   EXERCISE_CLASH           Alerte     le plan d'une équipe (ses parts de livrables) dépasse sa dotation ;
 *   EXERCISE_UNFUNDED        Vigilance  une équipe a des parts mais pas de dotation ;
 *   EXERCISE_NO_PARTS        Info       en préparation, une fois les livrables commencés : une équipe a une dotation mais aucune part ;
 *   EXERCISE_TEAM_RULE       Vigilance  des parts ou une dotation sur une équipe dont le nom n'a pas 3 ou 4 caractères, ou à 4 caractères sans parente à 3 : elles ne comptent nulle part.
 *
 * AUCUN MONTANT dans un constat (comme pour les commandes d'achat) : il part dans le récapitulatif du matin ; les chiffres sont dans la page Budget. Un constat de l'exercice ne se lit que par
 * qui peut lire l'exercice (Workpackage leader et au-dessus).
 */

/** Les constats de l'exercice, au format de `data.poFindings` : { projectId, rule, severity, targetType, targetId, message, suggestion }. */
function exerciseFindings_(today) {
  var out = [], live = function (r) { return !isTrue(r.deleted); };
  var projects = repoList('Project', function (p) { return live(p) && p.status !== 'Clos'; });
  var exercises = repoList('Exercise', function (e) { return live(e) && e.status !== 'Clos'; });
  etpReset_();
  exercises.forEach(function (ex) {
    projects.forEach(function (pr) {
      var data = exerciseData_(ex, [pr.id]);
      if (!data.budgets.length && !data.lines.length) return;
      var t = exerciseTable_(ex, data, pr.id), where = ' de l’exercice ' + ex.year + ' du projet ' + pr.code, prep = ex.status === 'Préparation';
      var push = function (rule, sev, teamId, msg, sug) {
        out.push({ projectId: pr.id, rule: rule, severity: sev, targetType: 'ExerciseTeam', targetId: ex.id + ':' + pr.id + ':' + teamId, message: msg, suggestion: sug });
      };
      var seeBudget = 'L’écart est dans la page Budget, zone « Plan budgétaire ».';
      t.rows.forEach(function (r) {
        var team = 'L’équipe « ' + r.name + ' »';
        if (r.dotation !== null && r.parts > r.dotation) push('EXERCISE_CLASH', 'Alerte', r.team_id, 'Clash : le plan de ' + team + ' dépasse sa dotation' + where + '.', 'Redéfinir les livrables (retirer, reporter ou rechiffrer) ou obtenir une révision de la dotation. ' + seeBudget);
        if (r.dotation === null && r.parts > 0) push('EXERCISE_UNFUNDED', 'Vigilance', r.team_id, team + ' porte des parts de livrables' + where + ' mais n’a pas de dotation.', 'Saisir sa dotation dans la page Budget, ou déplacer ses parts vers une équipe dotée.');
        if (prep && t.totals.parts > 0 && r.dotation !== null && r.dotation > 0 && r.parts === 0) push('EXERCISE_NO_PARTS', 'Info', r.team_id, team + ' a une dotation' + where + ' mais aucun livrable chiffré.', 'Chiffrer ses livrables avant la convergence, ou revoir sa dotation.');
      });
      t.orphans.concat(t.unruled).forEach(function (r) {
        var orphan = String(r.name).trim().length === 4;
        push('EXERCISE_TEAM_RULE', 'Vigilance', r.team_id, 'L’équipe « ' + r.name + ' » porte des parts ou une dotation' + where + (orphan ? ' mais, à 4 caractères, elle n’a pas d’équipe parente à 3 caractères' : ' mais son nom n’a pas 3 ou 4 caractères') + ' : elles ne comptent dans aucune équipe du tableau.',
          orphan ? 'La rattacher à une équipe de 3 caractères (page Ressources) ou la renommer.' : 'La renommer selon sa place (3 caractères : elle porte la dotation ; 4 : détail rattaché à une équipe de 3) ou déplacer ses parts.');
      });
    });
  });
  return out;
}

/** Ce constat est-il lisible par cette personne ? Exercice : qui lit l'exercice du projet ; tout le reste : oui. */
function insightReadable_(ctx, i) {
  var code = String(i.rule_code || '');
  if (code.indexOf('EXERCISE_') === 0 || code.indexOf('ENVELOPE_') === 0) return !!ctx.isAdmin || can(ctx, 'exercise.read', { type: 'project', id: i.project_id });
  return true;
}
