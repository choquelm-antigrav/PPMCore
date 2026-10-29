/**
 * PPM Core — 0.18.1 : les CONSTATS du moteur de règles sur l'exercice budgétaire et les enveloppes.
 *
 * Le moteur (06_Rules.gs) transforme un écart en un constat que le chef de projet voit dans sa routine (page Suivi, récapitulatif du matin) : il ne bloque rien. Ces règles regardent les
 * mêmes chiffres que la page Budget (exerciseData_ et exerciseTable_) : le constat et le tableau ne peuvent pas se contredire. Un constat disparaît tout seul quand l'écart est résorbé ;
 * « Accepté » ou « Ignoré » n'est pas recréé (clé : règle + objet, l'exercice et le projet étant dans l'objet).
 *
 *   EXERCISE_CLASH           Alerte     l'accordé d'une équipe est inférieur à ses parts de livrables (le clash de décembre, des révisions de février et d'avril) ;
 *   EXERCISE_OVER_EXPECTED   Vigilance  en préparation : les parts d'une équipe dépassent son budget attendu ;
 *   EXERCISE_UNFUNDED        Vigilance  une équipe a des parts mais ni attendu ni accordé ;
 *   EXERCISE_NO_PARTS        Info       en préparation, une fois les livrables commencés : une équipe a un attendu mais aucune part ;
 *   EXERCISE_TEAM_RULE       Vigilance  des parts ou un budget sur une équipe dont le nom n'a pas 3 ou 4 caractères, ou à 4 caractères sans parente à 3 : ils ne comptent nulle part ;
 *   ENVELOPE_WP_EXCEEDED     Vigilance  les lignes de budget des livrables d'un workpackage dépassent son enveloppe ;
 *   ENVELOPE_PROJECT_EXCEEDED Vigilance le coût prévu du projet dépasse son budget autorisé.
 *
 * AUCUN MONTANT dans un constat (comme pour les commandes d'achat) : il part dans le récapitulatif du matin ; les chiffres sont dans la page Budget. Un constat de l'exercice ne se lit que par
 * qui peut lire l'exercice (Workpackage leader et au-dessus), un constat d'enveloppe que par qui lit le budget du projet (`insightReadable_`).
 */

/** Les constats de l'exercice et des enveloppes, au format de `data.poFindings` : { projectId, rule, severity, targetType, targetId, message, suggestion }. */
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
      var seeBudget = 'L’écart est dans la page Budget, zone « Exercice budgétaire ».';
      t.rows.forEach(function (r) {
        var team = 'L’équipe « ' + r.name + ' »';
        if (r.granted !== null && r.parts > r.granted) push('EXERCISE_CLASH', 'Alerte', r.team_id, 'Clash : les livrables de ' + team + ' dépassent son budget accordé' + where + '.', 'Redéfinir les livrables (retirer, reporter ou rechiffrer) ou obtenir une révision de l’accordé. ' + seeBudget);
        if (prep && r.expected !== null && r.parts > r.expected) push('EXERCISE_OVER_EXPECTED', 'Vigilance', r.team_id, team + ' dépasse son budget attendu avec les parts de ses livrables' + where + '.', 'Rechiffrer ou retirer des livrables, ou demander plus de budget. ' + seeBudget);
        if (r.expected === null && r.granted === null && r.parts > 0) push('EXERCISE_UNFUNDED', 'Vigilance', r.team_id, team + ' porte des parts de livrables' + where + ' mais n’a ni budget attendu ni budget accordé.', 'Saisir son budget attendu (ou accordé) dans la page Budget, ou déplacer ses parts vers une équipe budgétée.');
        if (prep && t.totals.parts > 0 && r.expected !== null && r.expected > 0 && r.parts === 0) push('EXERCISE_NO_PARTS', 'Info', r.team_id, team + ' a un budget attendu' + where + ' mais aucun livrable chiffré.', 'Chiffrer ses livrables avant la convergence, ou revoir son budget attendu.');
      });
      t.orphans.concat(t.unruled).forEach(function (r) {
        var orphan = String(r.name).trim().length === 4;
        push('EXERCISE_TEAM_RULE', 'Vigilance', r.team_id, 'L’équipe « ' + r.name + ' » porte des parts ou un budget' + where + (orphan ? ' mais, à 4 caractères, elle n’a pas d’équipe parente à 3 caractères' : ' mais son nom n’a pas 3 ou 4 caractères') + ' : ils ne comptent dans aucune équipe du tableau.',
          orphan ? 'La rattacher à une équipe de 3 caractères (page Ressources) ou la renommer.' : 'La renommer selon sa place (3 caractères : elle porte le budget ; 4 : détail rattaché à une équipe de 3) ou déplacer ses parts.');
      });
    });
  });
  // enveloppes : workpackages et projet, exercice par exercice (0.19.3)
  exercises.forEach(function (ex) {
    projects.forEach(function (pr) {
      var wps = repoList('WorkPackage', function (w) { return live(w) && w.project_id === pr.id; }), wpById = indexBy_(wps), costs = envelopeCosts_(pr.id, wpById, ex.id);
      var where = ' (exercice ' + ex.year + ')';
      wps.forEach(function (w) {
        var al = envAmount_(w, envKey_(ex));
        if (al === null || !((costs.byWp[w.id] || 0) > al)) return;
        out.push({ projectId: pr.id, rule: 'ENVELOPE_WP_EXCEEDED', severity: 'Vigilance', targetType: 'WorkPackage', targetId: ex.id + ':' + w.id,
          message: 'Les lignes de budget des livrables du workpackage « ' + w.name + ' » (' + pr.code + ') dépassent son enveloppe' + where + '.',
          suggestion: 'Rechiffrer ou retirer des livrables, ou revoir l’enveloppe du workpackage (page Budget, zone « Décomposition du Budget »).' });
      });
      var au = envAmount_(pr, envKey_(ex));
      if (au !== null) {
        var total = costs.none; Object.keys(costs.byWp).forEach(function (k) { if (wpById[k] && !wpById[k].parent_wp_id) total = round2(total + costs.byWp[k]); });
        if (total > au) out.push({ projectId: pr.id, rule: 'ENVELOPE_PROJECT_EXCEEDED', severity: 'Vigilance', targetType: 'Project', targetId: ex.id + ':' + pr.id,
          message: 'Le coût prévu du projet ' + pr.code + ' dépasse son budget autorisé' + where + '.', suggestion: 'Rechiffrer ou retirer des livrables, ou revoir le budget autorisé du projet (page Budget, zone « Décomposition du Budget »).' });
      }
    });
  });
  return out;
}

/** Ce constat est-il lisible par cette personne ? Exercice : qui lit l'exercice du projet ; enveloppe : qui lit le budget du projet ; tout le reste : oui. */
function insightReadable_(ctx, i) {
  var code = String(i.rule_code || '');
  if (code.indexOf('EXERCISE_') === 0) return !!ctx.isAdmin || can(ctx, 'exercise.read', { type: 'project', id: i.project_id });
  if (code.indexOf('ENVELOPE_') === 0) return !!ctx.isAdmin || !!budgetAccess_(ctx, i.project_id).budget;
  return true;
}
