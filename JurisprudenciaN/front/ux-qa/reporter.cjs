'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runDir } = require('./paths.cjs');
const viewports = require('./viewports.cjs');
const { publicRoutes, authenticatedRoutes, authScenarios } = require('./route-registry.cjs');

function gitValue(args) {
  try { return execFileSync('git', args, { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }).trim(); }
  catch { return null; }
}

class UxQaReporter {
  constructor() { this.records = []; this.tests = []; }

  onTestEnd(test, result) {
    const testRecords = test.annotations
      .filter((annotation) => annotation.type === 'ux-qa-scenario')
      .map((annotation) => {
        try { return JSON.parse(annotation.description); } catch { return null; }
      })
      .filter(Boolean);
    this.records.push(...testRecords.map((record) => ({
      ...record,
      status: result.status === 'failed' || result.status === 'timedOut' ? 'FAIL' : record.status,
      durationMs: record.durationMs ?? result.duration,
    })));
    this.tests.push({ title: test.title, status: result.status, durationMs: result.duration });
    if (!testRecords.length && (result.status === 'failed' || result.status === 'timedOut')) {
      this.records.push({ scenarioId: test.title, title: test.title, route: null, viewport: null, status: 'FAIL', notes: [result.error?.message || 'Scenario failed before diagnostics were captured.'] });
    } else if (!testRecords.length && /@auth/u.test(test.titlePath().join(' '))) {
      this.records.push({ scenarioId: test.title, title: test.title, route: null, viewport: null, status: 'AUTH_E2E_RUN_SEPARATELY', notes: ['Mock-only public harness; authenticated ACL behavior is covered by the DB-backed UX E2E.'] });
    }
  }

  onEnd(result) {
    fs.mkdirSync(runDir, { recursive: true });
    const counts = this.records.reduce((acc, record) => {
      acc[record.status] = (acc[record.status] || 0) + 1;
      return acc;
    }, {});
    const failed = this.records.filter((record) => record.status === 'FAIL');
    const report = {
      generatedAt: new Date().toISOString(),
      gitSha: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      baseUrl: process.env.UX_QA_BASE_URL || null,
      browser: 'chromium',
      viewportMatrix: viewports,
      routeRegistry: publicRoutes,
      scenarios: this.records,
      tests: this.tests,
      counts: { total: this.records.length, pass: counts.PASS || 0, fail: counts.FAIL || 0, deferred: Object.entries(counts).filter(([status]) => status.startsWith('DEFERRED') || status === 'AUTH_E2E_RUN_SEPARATELY').reduce((sum, [, count]) => sum + count, 0), byStatus: counts },
      consoleErrors: this.records.flatMap((record) => record.consoleErrors || []),
      reactWarnings: this.records.flatMap((record) => record.reactWarnings || []),
      pageErrors: this.records.flatMap((record) => record.pageErrors || []),
      networkFailures: this.records.flatMap((record) => record.networkErrors || []),
      fixtureMisses: this.records.flatMap((record) => record.fixtureMisses || []),
      overflows: this.records.filter((record) => record.horizontalOverflow && !record.horizontalOverflow.passes),
      screenshots: this.records.map((record) => record.screenshotPath).filter(Boolean),
      authenticatedRoutes: authenticatedRoutes.map((route) => ({ ...route, status: 'PRESENT_AUTHENTICATED' })),
      authenticatedScenarios: authScenarios,
      playwrightStatus: result.status,
    };
    fs.writeFileSync(path.join(runDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const failures = failed.map((record) => `- ${record.scenarioId} ${record.viewport ? `(${record.viewport.width}×${record.viewport.height})` : ''}: ${record.title}`);
    const summary = [
      '# UX QA run',
      '',
      `- Generated: ${report.generatedAt}`,
      `- Branch / SHA: ${report.branch || 'unknown'} / ${report.gitSha || 'unknown'}`,
      `- Browser: ${report.browser}`,
      `- Scenarios: ${report.counts.total} total, ${report.counts.pass} pass, ${report.counts.fail} fail, ${report.counts.deferred} deferred`,
      `- Screenshots: ${path.join(runDir, 'screenshots')}`,
      `- Unexpected console errors: ${report.consoleErrors.length}`,
      `- React warnings: ${report.reactWarnings.length}`,
      `- Unexpected network failures: ${report.networkFailures.length}`,
      `- Horizontal overflow findings: ${report.overflows.length}`,
      '',
      '## Failures',
      '',
      ...(failures.length ? failures : ['- None']),
      '',
      '## Authenticated routes',
      '',
      ...report.authenticatedRoutes.map((route) => `- ${route.route}: ${route.status}`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(runDir, 'qa-summary.md'), summary, 'utf8');
  }
}

module.exports = UxQaReporter;
