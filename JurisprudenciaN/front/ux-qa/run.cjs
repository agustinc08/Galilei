'use strict';

const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createMockServer } = require('./mock-server.cjs');

const frontDir = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'public';
const grepByMode = { public: '@public', responsive: '@responsive', viewer: '@viewer', auth: '@auth' };
if (!grepByMode[mode]) {
  process.stderr.write('Usage: node ux-qa/run.cjs public|responsive|viewer|auth\n');
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

async function stopOwnedProcess(child) {
  if (!child || !child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function waitForPreview(url, child) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js preview exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/login`, { signal: AbortSignal.timeout(2500) });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local preview did not become ready: ${lastError || 'timeout'}`);
}

async function main() {
  let previewProcess;
  let runnerProcess;
  let mockServer;
  let mockOrigin;
  let baseURL = process.env.UX_QA_BASE_URL;
  try {
    if (!baseURL) {
      mockServer = createMockServer();
      await new Promise((resolve, reject) => {
        mockServer.once('error', reject);
        mockServer.listen(0, '127.0.0.1', resolve);
      });
      const mockPort = mockServer.address().port;
      mockOrigin = `http://127.0.0.1:${mockPort}/api`;

      const frontPort = await freePort();
      baseURL = `http://127.0.0.1:${frontPort}`;
      const nextCli = path.join(frontDir, 'node_modules', 'next', 'dist', 'bin', 'next');
      previewProcess = spawn(process.execPath, [nextCli, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(frontPort)], {
        cwd: frontDir,
        env: { ...process.env, NEXT_PUBLIC_API_URL: mockOrigin },
        stdio: 'inherit',
        windowsHide: true,
      });
      await waitForPreview(baseURL, previewProcess);
      process.stdout.write(`Using temporary local preview ${baseURL} with synthetic API ${mockOrigin}.\n`);
    }

    const playwrightCli = require.resolve('@playwright/test/cli');
    const configPath = path.join(__dirname, 'playwright.config.ts');
    runnerProcess = spawn(process.execPath, [playwrightCli, 'test', '--config', configPath, '--grep', grepByMode[mode]], {
      cwd: frontDir,
      env: { ...process.env, UX_QA_BASE_URL: baseURL },
      stdio: 'inherit',
      windowsHide: true,
    });
    const exitCode = await new Promise((resolve, reject) => {
      runnerProcess.once('error', reject);
      runnerProcess.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    await stopOwnedProcess(runnerProcess);
    await stopOwnedProcess(previewProcess);
    if (mockServer?.listening) await new Promise((resolve) => mockServer.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
