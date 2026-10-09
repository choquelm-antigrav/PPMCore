/**
 * PPM Core — lot 4 : copilote (section 9).
 *
 * Trois modes, réglés par la propriété du script PPM_AI_MODE (H12) :
 *   off    (par défaut) : aucune IA. Synthèse chiffrée, simulation, signaux faibles et suggestions
 *                         du moteur de règles restent disponibles : ils ne dépendent pas de Gemini.
 *   manual : le Core prépare un texte (consignes, faits chiffrés, question) que l'utilisateur colle
 *            lui-même dans Gemini (Workspace). Rien ne part automatiquement.
 *   api    : appel direct de l'API Gemini avec la clé PPM_GEMINI_API_KEY et le modèle PPM_GEMINI_MODEL,
 *            à n'activer qu'une fois le canal validé par la DSI.
 *
 * Garde-fous : l'IA ne reçoit que les faits nécessaires (aucun montant, aucun taux, aucune adresse) ;
 * elle ne lit les données que par des fonctions en lecture seule ; elle n'écrit jamais ;
 * tout chiffre de sa réponse absent des données du Core est signalé ; chaque échange est journalisé
 * (AiLog) avec l'avis de l'utilisateur ; un quota quotidien limite les appels par personne.
 */

var AI_PROVIDER = null; // tests : faux modèle { name, generate(req) → { text, calls, raw } }

function aiMode_() {
  var m = String(getProp(PROP.AI_MODE, 'off') || 'off').toLowerCase().trim();
  return ['off', 'manual', 'api'].indexOf(m) >= 0 ? m : 'off';
}

function aiQuota_() {
  var q = Number(getProp(PROP.AI_QUOTA, '30'));
  return q > 0 ? Math.floor(q) : 30;
}

/** Le fournisseur d'IA de la personne qui demande : sa clé personnelle (38_CopilotKey.gs), à défaut la clé commune de l'administrateur. */
function aiProvider_(ctx) {
  if (AI_PROVIDER) return AI_PROVIDER;
  return geminiProviderFor_(ctx);
}

/** API Gemini (REST generateContent). Les parties renvoyées par le modèle sont rejouées telles quelles. */
function geminiRest_(key, model) {
  return {
    name: 'gemini:' + model,
    generate: function (req) {
      var body = { contents: req.contents, generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (req.tools && req.tools.length) body.tools = [{ functionDeclarations: req.tools }];
      var r;
      try {
        r = aiFetch_(GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body)
        });
      } catch (err) {
        throw new PpmError('CONFIG', 'Appel à Gemini impossible (autorisation « script.external_request » ajoutée au manifeste ?) : ' + (err && err.message ? err.message : err));
      }
      var code = r.code;
      var json = parseJsonSafe(r.text, {});
      if (code === 429) throw new PpmError('QUOTA', 'Gemini : quota atteint, réessayer plus tard.');
      if (code >= 300) throw new PpmError('INTERNAL', 'Gemini a répondu ' + code + ' : ' + truncate((json.error && json.error.message) || r.text, 300));
      var parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      return {
        raw: parts,
        text: parts.filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join(''),
        calls: parts.filter(function (x) { return x.functionCall; }).map(function (x) { return { name: x.functionCall.name, args: x.functionCall.args || {} }; })
      };
    }
  };
}

// ---------------------------------------------------------------- garde-fou des chiffres

function normNum_(n) {
  var v = Number(String(n).replace(',', '.'));
  return isNaN(v) ? String(n) : String(v);
}

/**
 * Tout nombre du texte doit figurer dans les sources (faits du Core, résultats des fonctions, question).
 * Les numéros de liste en début de ligne sont ignorés. Les dates JJ/MM/AAAA se vérifient composante par composante.
 */
function checkGrounding(text, sources) {
  var allowed = {};
  sources.forEach(function (s) {
    (String(typeof s === 'string' ? s : JSON.stringify(s)).match(/\d+(?:[.,]\d+)?/g) || []).forEach(function (n) { allowed[normNum_(n)] = true; });
  });
  var seen = {}, unverified = [];
  (String(text || '').replace(/^\s*(?:[-*•]\s*)?\d{1,2}[.)]\s/gm, '').match(/\d+(?:[.,]\d+)?/g) || []).forEach(function (n) {
    var k = normNum_(n);
    if (!allowed[k] && !seen[k]) { seen[k] = true; unverified.push(n); }
  });
  return { ok: !unverified.length, unverified: unverified };
}

// ---------------------------------------------------------------- journal et quota

function aiUsedToday_(email) {
  var today = todayStr();
  return repoList('AiLog', function (l) { return l.actor === email && l.mode === 'api' && String(l.at).slice(0, 10) === today; }).length;
}

function logAi_(ctx, projectId, purpose, mode, prompt, response, unverified) {
  var rec = {
    id: newId(), at: nowIso(), actor: ctx.email, project_id: projectId || '', purpose: purpose, mode: mode,
    prompt: truncate(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), 45000),
    response: truncate(response || '', 20000), unverified: (unverified || []).join(' '), feedback: '', feedback_at: ''
  };
  repoAppendHistory('AiLog', [rec]);
  return rec.id;
}

var AI_SYSTEM = [
  'Tu es le copilote PMO de l’outil PPM d’un bureau d’études aéronautique. Tu aides un chef de projet à piloter.',
  'Règles impératives :',
  '1. Tu ne cites que des chiffres et des dates présents dans les faits fournis ou dans les résultats des fonctions. Tu ne calcules aucun nouveau chiffre.',
  '2. Si une information manque, dis-le simplement ; n’invente rien.',
  '3. Tu ne modifies rien : tu proposes, le chef de projet décide.',
  '4. Réponds en français, en phrases courtes, sans jargon ; dates au format JJ/MM/AAAA.'
].join('\n');

/** Texte à coller dans Gemini (mode manual) : consignes, faits, demande. */
function manualPrompt_(task, facts, extra) {
  return [AI_SYSTEM, '', 'Faits calculés par l’outil (JSON) :', JSON.stringify(facts, null, 1), extra ? '\n' + extra : '', '', 'Demande : ' + task].join('\n');
}

/**
 * Point d'entrée commun : selon le mode, renvoie le texte à copier (manual) ou la réponse du modèle (api).
 * sources : données autorisées pour le garde-fou des chiffres.
 */
function runAi_(ctx, projectId, purpose, task, facts, opts) {
  opts = opts || {};
  var mode = aiMode_();
  if (mode === 'off') {
    throw new PpmError('CONFIG', 'Le copilote IA n’est pas activé (propriété PPM_AI_MODE). Les synthèses chiffrées, simulations et suggestions restent disponibles.');
  }
  if (mode === 'manual' && !AI_PROVIDER) {
    var prompt = manualPrompt_(task, facts, opts.extra);
    var id = logAi_(ctx, projectId, purpose, 'manual', prompt, '', []);
    return { mode: 'manual', prompt: prompt, logId: id };
  }
  if (aiUsedToday_(ctx.email) >= aiQuota_()) throw new PpmError('QUOTA', 'Quota du copilote atteint pour aujourd’hui (' + aiQuota_() + ' demandes).');
  var provider = aiProvider_(ctx);
  var contents = [{ role: 'user', parts: [{ text: 'Faits calculés par l’outil (JSON) :\n' + JSON.stringify(facts) + (opts.extra ? '\n\n' + opts.extra : '') + '\n\nDemande : ' + task }] }];
  var sources = [facts, task, opts.extra || ''];
  var steps = [];
  var res;
  for (var turn = 0; turn < 6; turn++) {
    res = provider.generate({ system: AI_SYSTEM, contents: contents, tools: opts.tools ? opts.tools.declarations : null });
    if (!res.calls || !res.calls.length || !opts.tools) break;
    contents.push({ role: 'model', parts: res.raw && res.raw.length ? res.raw : res.calls.map(function (c) { return { functionCall: { name: c.name, args: c.args } }; }) });
    contents.push({ role: 'user', parts: res.calls.map(function (c) {
      var out;
      try {
        var h = opts.tools.handlers[c.name];
        out = h ? h(c.args || {}) : { error: 'Fonction inconnue : ' + c.name };
      } catch (err) {
        out = { error: err && err.message ? err.message : String(err) };
      }
      steps.push(c.name);
      sources.push(out);
      var json = JSON.stringify(out);
      return { functionResponse: { name: c.name, response: { content: json.length > 20000 ? truncate(json, 20000) : out } } };
    }) });
  }
  var text = String((res && res.text) || '').trim() || 'Pas de réponse du modèle.';
  var g = checkGrounding(text, sources);
  var logId = logAi_(ctx, projectId, purpose, 'api', { system: AI_SYSTEM, contents: contents }, text, g.unverified);
  return { mode: 'api', text: text, unverified: g.unverified, steps: steps, logId: logId, model: provider.name };
}

// ---------------------------------------------------------------- données d'un projet

function loadCopilotData_(projectId) {
  var projects = repoList('Project');
  var project = indexBy_(projects)[projectId];
  if (!project) throw new PpmError('NOT_FOUND', 'Projet introuvable : ' + projectId);
  var events = repoList('ChangeEvent', function (e) { return e.project_id === projectId; });
  var data = {
    projects: projects, programs: repoList('Program'), workpackages: repoList('WorkPackage'), planitems: repoList('PlanItem'),
    dependencies: repoList('Dependency'), resources: repoList('Resource'), insights: repoList('Insight'),
    risks: repoList('RiskOpportunity'), requirements: repoList('MilestoneRequirement'), holidaySets: repoList('HolidaySet'),
    progressUpdates: repoList('ProgressUpdate', function (u) { return String(u.declared_at || u.created_at || '') >= addCalendarDays(todayStr(), -THRESHOLDS.staleProgressDays); }),
    baseline: activeBaselineOf_(project),
    pendingChanges: pendingChangeCounts_([project], events)[projectId] || 0,
    pendingRequests: repoList('Baseline', function (b) { return b.project_id === projectId && b.status === 'Demandée'; }).length
  };
  data.holFor = holidayResolver(data);
  return data;
}

/** Hypothèses de simulation, périmètre du projet plus ses voisins externes. */
function runSimulation_(data, projectId, changes) {
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var deps = data.dependencies.filter(function (d) { return !isTrue(d.deleted) && (ids[d.predecessor_id] || ids[d.successor_id]); });
  var all = indexBy_(data.planitems);
  var ext = {};
  deps.forEach(function (d) {
    [d.predecessor_id, d.successor_id].forEach(function (id) { if (!ids[id] && all[id] && !isTrue(all[id].deleted)) ext[id] = Object.assign({}, all[id], { external: true }); });
  });
  var baseFinish = {};
  if (data.baseline) Object.keys(data.baseline.snap.PlanItem).forEach(function (id) { baseFinish[id] = data.baseline.snap.PlanItem[id].planned_finish; });
  var r = simulateChanges(items.concat(Object.keys(ext).map(function (k) { return ext[k]; })), deps, data.holFor, changes,
    { requirements: data.requirements, baselineFinish: baseFinish, projectId: projectId });
  var projects = indexBy_(data.projects);
  r.external_impacts.forEach(function (e) { e.project = projects[e.project_id] ? projects[e.project_id].code : ''; });
  if (data.baseline) {
    var base = '';
    Object.keys(baseFinish).forEach(function (id) { if (!isBlank(baseFinish[id]) && baseFinish[id] > base) base = baseFinish[id]; });
    r.plan_end.baseline = base || null;
    r.plan_end.slip_vs_baseline = base && r.plan_end.after ? workingDayOffset(base, r.plan_end.after, data.holFor(projectId)) : null;
  }
  return r;
}

/** Fonctions en lecture seule proposées au modèle pour répondre aux questions. */
function copilotTools_(data, projectId, brief) {
  var res = indexBy_(data.resources), wps = indexBy_(data.workpackages);
  var items = data.planitems.filter(function (i) { return i.project_id === projectId && !isTrue(i.deleted); });
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var floats = computeFloats(items, data.dependencies.filter(function (d) { return !isTrue(d.deleted) && ids[d.predecessor_id] && ids[d.successor_id]; }), data.holFor);
  var today = todayStr();
  var view = function (i) {
    var f = floats.byId[i.id] || {};
    return { id: i.id, name: i.name, type: i.item_type, workpackage: wps[i.wp_id] ? (wps[i.wp_id].wbs_code ? wps[i.wp_id].wbs_code + ' ' : '') + wps[i.wp_id].name : '',
      start: i.planned_start || null, finish: i.planned_finish || null, progress_pct: Number(i.progress_pct) || 0, status: i.status || '',
      owner: res[i.owner_resource_id] ? res[i.owner_resource_id].name : '', float_days: f.float === undefined ? null : f.float, critical: !!f.critical };
  };
  var findItem = function (ref) {
    var r = String(ref || '').toLowerCase().trim();
    return items.filter(function (i) { return i.id === ref; })[0] || items.filter(function (i) { return String(i.name).toLowerCase() === r; })[0] ||
      items.filter(function (i) { return String(i.name).toLowerCase().indexOf(r) >= 0; })[0] || null;
  };
  return {
    declarations: [
      { name: 'get_brief', description: 'Faits chiffrés du projet : avancement, fin du plan, baseline, retards, jalons, alertes, risques.', parameters: { type: 'object', properties: {} } },
      { name: 'list_items', description: 'Livrables et jalons du projet avec dates, avancement, responsable, marge et chemin critique.',
        parameters: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'late', 'critical', 'milestones', 'open'] } } } },
      { name: 'simulate_shift', description: 'Simule le décalage d’un livrable ou jalon (en jours ouvrés) et renvoie l’effet sur les successeurs, les jalons et la fin du plan. N’enregistre rien.',
        parameters: { type: 'object', properties: { item: { type: 'string', description: 'nom ou identifiant' }, shift_days: { type: 'integer' } }, required: ['item', 'shift_days'] } },
      { name: 'list_risks', description: 'Risques ouverts du projet.', parameters: { type: 'object', properties: {} } },
      { name: 'list_alerts', description: 'Constats du moteur de règles en attente de décision.', parameters: { type: 'object', properties: {} } }
    ],
    handlers: {
      get_brief: function () { return brief.facts; },
      list_items: function (a) {
        var f = a.filter || 'all';
        var list = items.filter(function (i) {
          var done = i.status === 'Terminé' || Number(i.progress_pct) >= 100;
          if (f === 'late') return !done && !isBlank(i.planned_finish) && i.planned_finish < today;
          if (f === 'critical') return (floats.byId[i.id] || {}).critical;
          if (f === 'milestones') return i.item_type === 'Jalon';
          if (f === 'open') return !done;
          return true;
        });
        return { count: list.length, items: list.slice(0, 80).map(view) };
      },
      simulate_shift: function (a) {
        var it = findItem(a.item);
        if (!it) return { error: 'Élément introuvable : ' + a.item };
        var r = runSimulation_(data, projectId, [{ itemId: it.id, shiftDays: a.shift_days }]);
        return { item: it.name, shift_days: Number(a.shift_days), plan_end: r.plan_end, moved: r.moved.slice(0, 20).map(function (m) {
          return { name: m.name, before_finish: m.before_finish, finish: m.finish, shift: m.shift, cause: m.cause };
        }), newly_threatened: r.newly_threatened, external_impacts: r.external_impacts, newly_critical: r.newly_critical };
      },
      list_risks: function () {
        return (data.risks || []).filter(function (r) { return !isTrue(r.deleted) && r.project_id === projectId && r.status !== 'Clos'; }).slice(0, 30).map(function (r) {
          return { title: r.title, kind: r.kind, probability: r.probability, impact: r.impact, score: r.score, strategy: r.strategy, status: r.status,
            owner: res[r.owner_resource_id] ? res[r.owner_resource_id].name : '', treatment_due: r.treatment_due || null };
        });
      },
      list_alerts: function () {
        return (data.insights || []).filter(function (x) { return !isTrue(x.deleted) && x.project_id === projectId && x.status === 'Nouveau'; })
          .slice(0, 30).map(function (x) { return { severity: x.severity, message: x.message, suggestion: x.suggestion }; });
      }
    }
  };
}

// ---------------------------------------------------------------- actions

defineAction('copilot.status', function (p, ctx) {
  requireCopilot_();
  var mode = aiMode_();
  return {
    mode: mode, model: mode === 'api' ? getProp(PROP.GEMINI_MODEL, '') : '',
    quota: { used: mode === 'api' ? aiUsedToday_(ctx.email) : 0, limit: aiQuota_() },
    canDecide: isBlank(p.projectId) ? false : can(ctx, 'insight.decide', { type: 'project', id: p.projectId })
  };
});

/** Synthèse du projet : faits et phrases du Core ; ai = true ajoute la rédaction du copilote (ou le texte à copier). */
defineAction('copilot.brief', function (p, ctx) {
  requireCopilot_();
  var projectId = requireParam(p, 'projectId');
  var data = loadCopilotData_(projectId);
  var brief = buildProjectBrief(data, projectId, todayStr(), data.holFor);
  if (!p.ai) return { facts: brief.facts, lines: brief.lines, ai: null };
  var ai = runAi_(ctx, projectId, 'synthese',
    'Rédige une synthèse de l’état du projet pour son chef de projet : 5 à 8 lignes, d’abord les points d’attention, puis 2 ou 3 actions possibles.', brief.facts);
  return { facts: brief.facts, lines: brief.lines, ai: ai };
});

/** Simulation « et si… » : changes = [{ itemId, shiftDays } | { itemId, finish }]. Rien n'est enregistré. */
defineAction('simulations.run', function (p, ctx) {
  requireCopilot_();
  var projectId = requireParam(p, 'projectId');
  if (!Array.isArray(p.changes) || !p.changes.length || p.changes.length > 20) {
    throw new PpmError('VALIDATION', 'Indiquez entre 1 et 20 hypothèses de décalage.');
  }
  var data = loadCopilotData_(projectId);
  var r = runSimulation_(data, projectId, p.changes);
  if (p.explain) {
    r.ai = runAi_(ctx, projectId, 'simulation',
      'Explique au chef de projet les conséquences de cette hypothèse en 4 à 6 lignes : ce qui bouge, ce qui est menacé, ce qu’il pourrait faire.',
      { hypotheses: r.changes, resultat: { fin_du_plan: r.plan_end, elements_decales: r.moved, jalons_menaces: r.newly_threatened, autres_projets: r.external_impacts, nouveaux_critiques: r.newly_critical } });
  }
  return r;
});

/** Question en langage naturel : le modèle consulte les données par des fonctions en lecture seule. */
defineAction('copilot.ask', function (p, ctx) {
  requireCopilot_();
  var projectId = requireParam(p, 'projectId');
  var question = String(p.question || '').trim();
  if (!question) throw new PpmError('VALIDATION', 'Posez une question.');
  if (question.length > 1000) throw new PpmError('VALIDATION', 'Question trop longue (1 000 caractères au plus).');
  var data = loadCopilotData_(projectId);
  var brief = buildProjectBrief(data, projectId, todayStr(), data.holFor);
  var tools = copilotTools_(data, projectId, brief);
  if (aiMode_() === 'manual' && !AI_PROVIDER) {
    var items = tools.handlers.list_items({ filter: 'all' });
    return runAi_(ctx, projectId, 'question', question, brief.facts, { extra: 'Livrables et jalons (JSON) :\n' + JSON.stringify(items) });
  }
  return runAi_(ctx, projectId, 'question', question, { projet: brief.facts.project, aujourd_hui: brief.facts.today }, { tools: tools });
});

/** Avis de l'utilisateur sur une réponse du copilote (mesure de la pertinence). */
defineAction('copilot.feedback', function (p, ctx) {
  requireCopilot_();
  var id = requireParam(p, 'logId');
  var t = getTable('AiLog');
  var n = t.findRow(id);
  if (!n) throw new PpmError('NOT_FOUND', 'Échange introuvable.');
  var rec = t.readRow(n);
  if (rec.actor !== ctx.email) throw new PpmError('FORBIDDEN', 'Seul l’auteur de la demande donne son avis.');
  t.writeRow(n, Object.assign(rec, { feedback: p.useful ? 'utile' : 'pas utile', feedback_at: nowIso() }));
  return { ok: true };
});

/** Décision sur une suggestion du moteur de règles : Accepté ou Ignoré, avec une note facultative. */
defineAction('insights.decide', function (p, ctx) {
  var ins = mustGet('Insight', requireParam(p, 'id'));
  requireCan(ctx, 'insight.decide', { type: 'project', id: ins.project_id });
  if (['Accepté', 'Ignoré'].indexOf(p.decision) < 0) throw new PpmError('VALIDATION', 'Décision attendue : Accepté ou Ignoré.');
  if (ins.status !== 'Nouveau') throw new PpmError('VALIDATION', 'Cette suggestion a déjà été traitée.');
  return repoUpdate('Insight', ins.id, { status: p.decision, decided_by: ctx.email, decided_at: nowIso(), decision_note: truncate(String(p.note || ''), 500) }, p.version, ctx.actx);
});

/** Suggestions du projet et taux d'acceptation, par règle, plus l'avis sur les réponses de l'IA. */
defineAction('copilot.suggestions', function (p, ctx) {
  requireCopilot_();
  var projectId = requireParam(p, 'projectId');
  var all = repoList('Insight', function (x) { return x.project_id === projectId; });
  var order = { Alerte: 0, Vigilance: 1, Info: 2 };
  var pending = all.filter(function (x) { return x.status === 'Nouveau'; })
    .sort(function (a, b) { return (order[a.severity] - order[b.severity]) || String(a.message).localeCompare(String(b.message)); });
  var byRule = {};
  all.forEach(function (x) {
    var r = byRule[x.rule_code] = byRule[x.rule_code] || { rule: x.rule_code, pending: 0, accepted: 0, ignored: 0 };
    if (x.status === 'Nouveau') r.pending++; else if (x.status === 'Accepté') r.accepted++; else r.ignored++;
  });
  var logs = repoList('AiLog', function (l) { return l.project_id === projectId && l.mode === 'api'; });
  var decided = all.filter(function (x) { return x.status !== 'Nouveau'; });
  return {
    canDecide: can(ctx, 'insight.decide', { type: 'project', id: projectId }),
    pending: pending.map(function (x) { return { id: x.id, version: x.version, rule: x.rule_code, severity: x.severity, message: x.message, suggestion: x.suggestion, target_type: x.target_type, target_id: x.target_id }; }),
    recent: decided.sort(function (a, b) { return String(b.decided_at || b.updated_at).localeCompare(String(a.decided_at || a.updated_at)); }).slice(0, 20)
      .map(function (x) { return { rule: x.rule_code, message: x.message, status: x.status, decided_by: x.decided_by || x.updated_by, decided_at: x.decided_at || x.updated_at, note: x.decision_note || '' }; }),
    stats: {
      rules: Object.keys(byRule).sort().map(function (k) { return byRule[k]; }),
      accept_rate: decided.length ? Math.round(100 * decided.filter(function (x) { return x.status === 'Accepté'; }).length / decided.length) : null,
      ai_answers: logs.length, ai_useful: logs.filter(function (l) { return l.feedback === 'utile'; }).length,
      ai_not_useful: logs.filter(function (l) { return l.feedback === 'pas utile'; }).length
    }
  };
});
