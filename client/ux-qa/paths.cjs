'use strict';

const path = require('node:path');

const defaultRunDir = path.resolve(__dirname, '../../_recovery-work/ux-qa-automation-prep1/runs/latest');
const runDir = path.resolve(process.env.UX_QA_REPORT_DIR || defaultRunDir);

module.exports = {
  runDir,
  screenshotDir: path.join(runDir, 'screenshots'),
  playwrightOutputDir: path.join(runDir, 'playwright-output'),
};
