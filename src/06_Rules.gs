/**
 * PPM Core — moteur de règles déterministe (section 9).
 *
 * Produit des constats chiffrés et rattachés à une entité. Aucune IA ici :
 * Gemini ne fera que hiérarchiser et expliquer ces constats (lot 4), et
 * l'IA ne fait jamais d'action directe (H7).
 *
 * evaluateRules(data, today, holFor) → Insight[] (sans id ni statut)
 *   data : { projects, workpackages, planitems, dependencies, requirements, risks,
 *            baselineFinish?: { planItemId: date figée }, critical?: { planItemId: true } }
 */

function evaluateRules(data, today, holFor) {
  var out = [];
  var live = function (r) { return !isTrue(r.deleted); };
  var projects = (data.projects || []).filter(live);
  var activeProject = {};
  projects.forEach(function (p) { if (p.status !== 'Clos') activeProject[p.id] = p; });
  var items = (data.planitems || []).filter(function (i) { return live(i) && activeProject[i.project_id]; });
  var itemById = {};
  items.forEach(function (i) { itemById[i.id] = i; });

  function push(projectId, rule, severity, targetType, targetId, message, suggestion) {
    out.push({
      project_id: projectId, rule_code: rule, severity: severity, target_type: targetType,
      target_id: targetId, message: message, suggestion: suggestion, generated_on: today
    });
  }

  items.forEach(function (it) {
    var done = it.status === 'Terminé' || Number(it.progress_pct) >= 100;
    var label = (it.item_type === 'Jalon' ? 'Le jalon' : 'Le livrable') + ' « ' + it.name + ' »';

    if (!done && !isBlank(it.planned_finish) && it.planned_finish < today) {
      push(it.project_id, 'LATE_ITEM', 'Alerte', 'PlanItem', it.id,
        label + ' devait être terminé le ' + it.planned_finish + ' (avancement ' + (Number(it.progress_pct) || 0) + ' %).',
        'Déclarer l’avancement ou mettre à jour la prévision ; si le retard est confirmé, vérifier l’impact sur les successeurs.');
    }
    if (isBlank(it.owner_resource_id)) {
      push(it.project_id, 'MISSING_OWNER', 'Vigilance', 'PlanItem', it.id,
        label + ' n’a pas de responsable.', 'Désigner un responsable.');
    }
    if (isBlank(it.planned_finish)) {
      push(it.project_id, 'MISSING_DATE', 'Vigilance', 'PlanItem', it.id,
        label + ' n’a pas de date prévue.', 'Renseigner la date de fin prévue.');
    }
    if (it.item_type === 'Livrable' && !done && Number(it.progress_pct) > 0) {
      var last = !isBlank(it.last_progress_at) ? String(it.last_progress_at).slice(0, 10)
        : (!isBlank(it.created_at) ? String(it.created_at).slice(0, 10) : '');
      if (last && addCalendarDays(last, THRESHOLDS.staleProgressDays) < today) {
        push(it.project_id, 'STALE_PROGRESS', 'Vigilance', 'PlanItem', it.id,
          label + ' n’a pas été mis à jour depuis le ' + last + '.',
          'Relancer le responsable pour une déclaration d’avancement.');
      }
    }
  });

  // Glissement critique (section 9) : prévision au-delà de la baseline de plus de N jours ouvrés, sur le chemin critique.
  var baseFinish = data.baselineFinish || {}, critical = data.critical || {};
  items.forEach(function (it) {
    var bf = baseFinish[it.id];
    if (!bf || isBlank(it.planned_finish) || !critical[it.id] || it.status === 'Terminé' || Number(it.progress_pct) >= 100) return;
    var slip = workingDayOffset(bf, it.planned_finish, holFor(it.project_id));
    if (slip > THRESHOLDS.criticalSlipDays) {
      push(it.project_id, 'CRITICAL_SLIP', 'Alerte', 'PlanItem', it.id,
        (it.item_type === 'Jalon' ? 'Le jalon' : 'Le livrable') + ' « ' + it.name + ' », sur le chemin critique, finit le ' + it.planned_finish +
        ' : ' + slip + ' jours ouvrés après la baseline (' + bf + ').',
        'Chercher à rattraper le retard (renfort, re-séquencement) ou, s’il est acté, demander une nouvelle baseline.');
    }
  });

  // Signaux faibles : un commentaire d'avancement récent annonce un blocage avant que la date ne glisse.
  weakSignals_(data.progressUpdates || [], items.filter(function (i) { return activeProject[i.project_id]; }),
    addCalendarDays(today, -THRESHOLDS.staleProgressDays)).forEach(function (sig) {
    push(sig.item.project_id, 'WEAK_SIGNAL', 'Vigilance', 'PlanItem', sig.item.id,
      'Signal faible sur « ' + sig.item.name + ' » : le commentaire d’avancement du ' + sig.date + ' dit « ' + sig.comment + ' ».',
      'Vérifier avec le responsable si la date de fin tient toujours.');
  });

  // Commandes d'achat : GR à faire, PO à lancer, dépassement du budget externe (calculés par poFindings_, sans montant).
  (data.poFindings || []).forEach(function (f) {
    if (activeProject[f.projectId]) push(f.projectId, f.rule, f.severity, f.targetType, f.targetId, f.message, f.suggestion);
  });

  // Projet actif, planifié, sans baseline : les écarts ne peuvent pas être mesurés.
  projects.forEach(function (p) {
    if (p.status !== 'Actif' || !isBlank(p.active_baseline_id)) return;
    var dated = items.some(function (i) { return i.project_id === p.id && !isBlank(i.planned_finish); });
    if (dated) {
      push(p.id, 'NO_BASELINE', 'Info', 'Project', p.id,
        'Le projet « ' + p.name + ' » n’a pas de baseline : ses écarts ne sont pas mesurés.',
        'Figer la baseline B0 depuis la page Suivi, une fois le planning validé.');
    }
  });

  dependencyViolations(items, (data.dependencies || []).filter(live), holFor).forEach(function (v) {
    var s = itemById[v.successor_id], p = itemById[v.predecessor_id];
    push(s.project_id, 'DEPENDENCY_VIOLATION', 'Alerte', 'Dependency', v.dependency_id,
      '« ' + s.name + ' » (' + v.actual + ') est placé avant la date permise par « ' + p.name + ' » (' +
      v.required + ', lien ' + v.dep_type + ').',
      'Décaler « ' + s.name + ' » de ' + v.gap_days + ' jour(s) ouvré(s) ou revoir la dépendance ; décision du chef de projet.');
  });

  (data.requirements || []).filter(live).forEach(function (r) {
    var ms = itemById[r.milestone_id], dl = itemById[r.deliverable_id];
    if (!ms || !dl) return;
    var dlDone = dl.status === 'Terminé' || Number(dl.progress_pct) >= 100;
    if (dlDone) return;
    if (!isBlank(ms.actual_finish)) {
      push(ms.project_id, 'MILESTONE_INCOMPLETE', 'Alerte', 'PlanItem', ms.id,
        'Le jalon « ' + ms.name + ' » est marqué atteint alors que « ' + dl.name + ' » n’est pas terminé.',
        'Vérifier le passage du jalon ou terminer le livrable requis.');
    } else if (!isBlank(dl.planned_finish) && !isBlank(ms.planned_finish) && dl.planned_finish > ms.planned_finish) {
      push(ms.project_id, 'MILESTONE_THREATENED', 'Alerte', 'PlanItem', ms.id,
        'Le jalon « ' + ms.name + ' » (' + ms.planned_finish + ') est menacé : « ' + dl.name + ' » finit le ' + dl.planned_finish + '.',
        'Accélérer le livrable, décaler le jalon ou retirer le livrable des prérequis.');
    }
  });

  (data.risks || []).filter(function (r) { return live(r) && activeProject[r.project_id] && r.status !== 'Clos'; })
    .forEach(function (r) {
      var late = [];
      if (!isBlank(r.review_date) && r.review_date < today) late.push('revue prévue le ' + r.review_date);
      if (!isBlank(r.treatment_due) && r.treatment_due < today) late.push('traitement attendu le ' + r.treatment_due);
      if (late.length) {
        push(r.project_id, 'RISK_OVERDUE', 'Vigilance', 'RiskOpportunity', r.id,
          (r.kind === 'Opportunité' ? 'L’opportunité' : 'Le risque') + ' « ' + r.title + ' » est en retard : ' + late.join(', ') + '.',
          'Revoir la fiche avec son responsable et mettre à jour les dates.');
      }
    });

  var wpHasContent = {};
  items.forEach(function (i) { if (!isBlank(i.wp_id)) wpHasContent[i.wp_id] = true; });
  (data.workpackages || []).filter(live).forEach(function (w) {
    if (!isBlank(w.parent_wp_id)) wpHasContent[w.parent_wp_id] = true;
  });
  (data.workpackages || []).filter(function (w) { return live(w) && activeProject[w.project_id]; }).forEach(function (w) {
    if (!wpHasContent[w.id]) {
      push(w.project_id, 'EMPTY_WP', 'Info', 'WorkPackage', w.id,
        'Le workpackage « ' + w.name + ' » ne contient aucun livrable ni jalon.',
        'Ajouter ses livrables ou le supprimer.');
    }
  });

  return out;
}

/**
 * Fusionne les constats du jour avec les Insights existants.
 * Clé = rule_code + target_id.
 *   - un constat déjà « Ignoré » ou « Accepté » n'est pas recréé ;
 *   - un « Nouveau » existant est mis à jour (même id) ;
 *   - un « Nouveau » qui n'est plus constaté disparaît (le problème est résolu).
 * Renvoie la liste complète à écrire.
 */
function mergeInsights(existing, fresh, actor) {
  var byKey = {};
  var kept = [];
  (existing || []).forEach(function (e) {
    if (isTrue(e.deleted)) return;
    if (e.status === 'Nouveau') byKey[e.rule_code + '|' + e.target_id] = e;
    else kept.push(e);
  });
  var closedKeys = {};
  kept.forEach(function (e) { closedKeys[e.rule_code + '|' + e.target_id] = true; });
  var now = nowIso();
  var result = kept.slice();
  fresh.forEach(function (f) {
    var key = f.rule_code + '|' + f.target_id;
    if (closedKeys[key]) return;
    var prev = byKey[key];
    var rec = Object.assign({}, f, {
      id: prev ? prev.id : newId(),
      status: 'Nouveau',
      created_at: prev ? prev.created_at : now,
      created_by: prev ? prev.created_by : actor,
      updated_at: now,
      updated_by: actor,
      version: prev ? Number(prev.version || 1) + 1 : 1,
      deleted: false
    });
    result.push(rec);
  });
  return result;
}
