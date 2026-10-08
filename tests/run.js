/** Lance toute la suite : node tests/run.js */
const { results } = require('./harness');
require('./test_calendar_graph')();
require('./test_rbac')();
require('./test_repo_rules')();
require('./test_api')();
require('./test_schedule_views')();
require('./test_structure')();
require('./test_baselines')();
require('./test_workspace')();
require('./test_copilot')();
require('./test_build')();
require('./test_perf')();
require('./test_account')();
require('./test_edit')();
require('./test_org')();
require('./test_budget')();
require('./test_reminders')();
require('./test_access')();
require('./test_overview')();
require('./test_resources')();
require('./test_mails')();
require('./test_suspension')();
require('./test_demo')();
console.log('\n' + results.passed + ' réussis, ' + results.failed + ' en échec');
if (results.failed) {
  results.failures.forEach((f) => console.log('\n✗ ' + f.name + '\n' + (f.error && f.error.stack)));
  process.exit(1);
}
