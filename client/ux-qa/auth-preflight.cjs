'use strict';

const required = ['UX_QA_AUTH_ENABLED', 'UX_QA_AUTH_USER', 'UX_QA_AUTH_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.UX_QA_AUTH_ENABLED !== '1') {
  process.stderr.write(`Authenticated UX QA is opt-in. Set ${required.join(', ')} in the environment; values are never written to reports.\n`);
  process.exit(2);
}
process.stdout.write('Explicit authenticated QA configuration detected; credentials remain environment-only.\n');
