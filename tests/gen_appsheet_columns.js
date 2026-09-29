/** Génère appsheet/COLONNES.md depuis le schéma : node tests/gen_appsheet_columns.js */
const fs = require('fs');
const path = require('path');
const { loadCore } = require('./harness');
const c = loadCore();
const tech = { created_at: 'Text', created_by: 'Email', updated_at: 'Text', updated_by: 'Email', version: 'Number', deleted: 'Yes/No' };
const numbers = ['progress_pct', 'lag_days', 'planned_days', 'daily_rate', 'capacity_days_month', 'fixed_amount',
  'planned_amount', 'financial_value', 'probability', 'impact', 'score', 'amount', 'year', 'number'];
const pct = ['progress_pct'];
const price = ['daily_rate', 'fixed_amount', 'planned_amount', 'financial_value', 'amount'];
const computed = { RiskOpportunity: ['score'], BudgetLine: ['planned_amount'],
  PlanItem: ['progress_pct', 'status', 'last_progress_at', 'actual_finish', 'calendar_event_id'],
  ProgressUpdate: ['declared_at'] };
let out = '# Colonnes AppSheet (généré depuis src/01_Schema.gs — ne pas modifier à la main)\n\n' +
  'Légende : **Clé** = cocher Key ; **Lecture seule** = Editable OFF ; **Masquée** = Show OFF.\n' +
  'Colonnes techniques de toutes les tables vivantes : `created_at`, `created_by`, `updated_at`, `updated_by`, `version` (lecture seule, masquées), `deleted` (Yes/No, masquée).\n\n';
Object.keys(c.SCHEMA).forEach((t) => {
  const def = c.SCHEMA[t];
  if (t === '_Snapshot' || (def.book === 'history' && t !== 'ChangeEvent')) return;
  out += '## ' + t + (def.book === 'history' ? ' (classeur Historique, lecture seule sauf `acknowledged`)' : '') + '\n\n| Colonne | Type AppSheet | Réglages |\n| --- | --- | --- |\n';
  def.cols.forEach((col) => {
    let type = 'Text', notes = [];
    if (col === 'id') { type = 'Text'; notes.push('Clé', 'Initial value `UNIQUEID()`', 'Masquée', 'Lecture seule'); }
    else if (c.REF_TARGETS[col]) { type = 'Ref → ' + c.REF_TARGETS[col]; }
    else if (def.enums && def.enums[col]) { type = 'Enum'; notes.push('Valeurs : ' + def.enums[col].join(', ')); }
    else if (c.DATE_COLS.includes(col)) type = 'Date';
    else if (pct.includes(col)) { type = 'Number'; notes.push('Valid_If `AND([_THIS] >= 0, [_THIS] <= 100)`'); }
    else if (price.includes(col)) { type = 'Price (EUR)'; }
    else if (numbers.includes(col)) type = 'Number';
    else if (/email/.test(col) || col === 'actor' || col === 'requested_by' || col === 'decided_by') type = 'Email';
    else if (/_json$/.test(col) || col === 'description' || col === 'comment' || col === 'justification') type = 'LongText';
    else if (col === 'drive_url' || col === 'url') type = 'Url';
    else if (col === 'enabled' || col === 'acknowledged') type = 'Yes/No';
    if (t === 'Resource' && (col === 'job_function' || col === 'organization')) {
      type = 'Enum (Base type Text)';
      notes.push('Allow other values ON', 'Auto-add new values ON', 'Suggested values : `SELECT(Resource[' + col + '], NOT(ISBLANK([' + col + '])), TRUE)` (liste sans doublon)');
    }
    if (t === 'UserSetting' && col === 'calendar_invites') { type = 'Yes/No'; notes.push('Échéances de mes livrables dans mon agenda (aussi réglable depuis la page Suivi)'); }
    if (t === 'UserSetting' && col === 'view_prefs_json') { type = 'LongText'; notes.push('Masquée', 'Lecture seule (écrite par la page Structure)'); }
    if ((def.required || []).includes(col)) notes.push('Require ON');
    if ((computed[t] || []).includes(col)) notes.push('Lecture seule (calculé par le Core)');
    if (col === 'name' || col === 'title') notes.push('Label');
    out += '| `' + col + '` | ' + type + ' | ' + notes.join(' ; ') + ' |\n';
  });
  out += '\n';
});
fs.writeFileSync(path.join(__dirname, '..', 'appsheet', 'COLONNES.md'), out);
console.log('appsheet/COLONNES.md généré (' + out.split('\n').length + ' lignes)');
