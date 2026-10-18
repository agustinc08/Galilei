const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

const backDirectory = path.resolve(__dirname, '..');

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Git',
      'usr',
      'bin',
      'openssl.exe',
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {}
  }
  throw new Error('OPENSSL_REQUIRED_FOR_PRISMA_TLS_BLACKBOX');
}

function runOpenSsl(openssl, args) {
  execFileSync(openssl, args, { stdio: 'ignore' });
}

function makeCertificates(root, openssl) {
  const caKey = path.join(root, 'trusted-ca.key');
  const caCert = path.join(root, 'trusted-ca.pem');
  const otherCaKey = path.join(root, 'untrusted-ca.key');
  const otherCaCert = path.join(root, 'untrusted-ca.pem');
  for (const ca of [
    { key: caKey, cert: caCert, subject: '/CN=Fix3 Trusted Test CA' },
    {
      key: otherCaKey,
      cert: otherCaCert,
      subject: '/CN=Fix3 Untrusted Test CA',
    },
  ]) {
    runOpenSsl(openssl, [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      ca.key,
      '-out',
      ca.cert,
      '-sha256',
      '-days',
      '3',
      '-subj',
      ca.subject,
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
  }
  const matchingExt = path.join(root, 'matching.ext');
  const wrongExt = path.join(root, 'wrong.ext');
  const baseExt = [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
  ];
  fs.writeFileSync(
    matchingExt,
    [...baseExt, 'subjectAltName=IP:127.0.0.1', ''].join('\n'),
  );
  fs.writeFileSync(
    wrongExt,
    [...baseExt, 'subjectAltName=DNS:wronghost.fix3.invalid', ''].join('\n'),
  );
  const leaves = [
    { name: 'matching', caKey, caCert, ext: matchingExt, cn: '127.0.0.1' },
    {
      name: 'wrong',
      caKey,
      caCert,
      ext: wrongExt,
      cn: 'wronghost.fix3.invalid',
    },
    {
      name: 'untrusted',
      caKey: otherCaKey,
      caCert: otherCaCert,
      ext: matchingExt,
      cn: '127.0.0.1',
    },
  ];
  for (const leaf of leaves) {
    const key = path.join(root, `${leaf.name}.key`);
    const csr = path.join(root, `${leaf.name}.csr`);
    const cert = path.join(root, `${leaf.name}.pem`);
    runOpenSsl(openssl, [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      csr,
      '-subj',
      `/CN=${leaf.cn}`,
    ]);
    runOpenSsl(openssl, [
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      leaf.caCert,
      '-CAkey',
      leaf.caKey,
      '-CAcreateserial',
      '-out',
      cert,
      '-days',
      '2',
      '-sha256',
      '-extfile',
      leaf.ext,
    ]);
  }
  return caCert;
}

function urlFor(port, query, caPath) {
  return `postgresql://synthetic_user:synthetic_only@127.0.0.1:${port}/synthetic_db?${query.replaceAll('CA', encodeURIComponent(caPath))}`;
}

function createListener(root, trial) {
  const observations = {
    connections: 0,
    sslRequests: 0,
    tlsHandshakes: 0,
    startupMessages: [],
    errors: [],
  };
  const sockets = new Set();
  const context = tls.createSecureContext({
    key: fs.readFileSync(path.join(root, `${trial.cert}.key`)),
    cert: fs.readFileSync(path.join(root, `${trial.cert}.pem`)),
  });
  const server = net.createServer((socket) => {
    observations.connections++;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let initial = Buffer.alloc(0);
    const onInitial = (chunk) => {
      initial = Buffer.concat([initial, chunk]);
      if (initial.length < 8) return;
      socket.pause();
      socket.removeListener('data', onInitial);
      if (initial.readInt32BE(0) !== 8 || initial.readInt32BE(4) !== 80877103) {
        observations.startupMessages.push({
          protocol: initial.length >= 8 ? initial.readUInt32BE(4) : null,
          plain: true,
        });
        socket.destroy();
        return;
      }
      observations.sslRequests++;
      socket.write('S');
      const remaining = initial.subarray(8);
      if (remaining.length) socket.unshift(remaining);
      const secure = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext: context,
      });
      secure.on('secure', () => observations.tlsHandshakes++);
      secure.on('error', (error) =>
        observations.errors.push(error.code || error.message),
      );
      secure.on('data', (data) => {
        observations.startupMessages.push({
          protocol: data.length >= 8 ? data.readUInt32BE(4) : null,
          plain: false,
        });
        secure.destroy();
      });
      secure.resume();
    };
    socket.on('data', onInitial);
    socket.on('error', (error) =>
      observations.errors.push(error.code || error.message),
    );
  });
  return { server, sockets, observations };
}

function runPrisma(databaseUrl) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    };
    const windows = process.platform === 'win32';
    const command = windows ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
    const args = windows
      ? ['/d', '/s', '/c', 'pnpm.cmd exec prisma migrate status']
      : ['exec', 'prisma', 'migrate', 'status'];
    const child = spawn(command, args, {
      cwd: backDirectory,
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, timedOut: true });
    }, 30000);
    child.once('error', (error) =>
      finish({ exitCode: null, spawnError: error.code || error.message }),
    );
    child.once('close', (code, signal) => finish({ exitCode: code, signal }));
  });
}

async function runTrial(root, caCert, trial) {
  const { server, sockets, observations } = createListener(root, trial);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const child = await runPrisma(urlFor(port, trial.query, caCert));
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  return { name: trial.name, ...observations, ...child };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-prisma-tls-fix3-'));
  try {
    const openssl = findOpenSsl();
    const caCert = makeCertificates(root, openssl);
    const trials = [
      {
        name: 'legacy-require-trusted-wrong-host',
        cert: 'wrong',
        query: 'sslmode=require&sslcert=CA',
      },
      {
        name: 'legacy-require-untrusted',
        cert: 'untrusted',
        query: 'sslmode=require&sslcert=CA',
      },
      {
        name: 'strict-trusted-matching-host',
        cert: 'matching',
        query: 'sslmode=require&sslcert=CA&sslaccept=strict',
      },
      {
        name: 'strict-trusted-wrong-host',
        cert: 'wrong',
        query: 'sslmode=require&sslcert=CA&sslaccept=strict',
      },
      {
        name: 'strict-untrusted',
        cert: 'untrusted',
        query: 'sslmode=require&sslcert=CA&sslaccept=strict',
      },
      {
        name: 'verify-full-rootcert-matching-host',
        cert: 'matching',
        query: 'sslmode=verify-full&sslrootcert=CA',
      },
      {
        name: 'verify-full-rootcert-wrong-host',
        cert: 'wrong',
        query: 'sslmode=verify-full&sslrootcert=CA',
      },
    ];
    const results = [];
    for (const trial of trials)
      results.push(await runTrial(root, caCert, trial));
    const byName = Object.fromEntries(results.map((item) => [item.name, item]));
    const startup = (name) => byName[name].startupMessages.length > 0;
    assert.equal(startup('legacy-require-trusted-wrong-host'), true);
    assert.equal(startup('legacy-require-untrusted'), true);
    assert.equal(startup('strict-trusted-matching-host'), true);
    assert.equal(startup('strict-trusted-wrong-host'), false);
    assert.equal(startup('strict-untrusted'), false);
    assert.equal(startup('verify-full-rootcert-matching-host'), true);
    assert.equal(startup('verify-full-rootcert-wrong-host'), true);
    for (const item of results) {
      assert.notEqual(item.timedOut, true, `${item.name} timed out`);
      assert.equal(
        item.exitCode,
        1,
        `${item.name} must stop at the synthetic no-database boundary`,
      );
      assert.ok(
        item.startupMessages.every((packet) => packet.protocol === 196608),
      );
    }
    const report = {
      prismaCli: '7.8.0',
      node: process.version,
      harness:
        'loopback-only PostgreSQL SSLRequest/TLS listener; closes after first StartupMessage; no authentication, SQL, or real database',
      openssl,
      findings: {
        previousRequireUrlAcceptedTrustedWrongHost: startup(
          'legacy-require-trusted-wrong-host',
        ),
        strictAcceptsTrustedMatchingHost: startup(
          'strict-trusted-matching-host',
        ),
        strictRejectsTrustedWrongHostBeforeStartup: !startup(
          'strict-trusted-wrong-host',
        ),
        strictRejectsUntrustedChainBeforeStartup: !startup('strict-untrusted'),
        verifyFullUrlAloneAcceptsWrongHost: startup(
          'verify-full-rootcert-wrong-host',
        ),
      },
      results: results.map(
        ({
          name,
          connections,
          sslRequests,
          tlsHandshakes,
          startupMessages,
          errors,
          exitCode,
          timedOut,
        }) => ({
          name,
          connections,
          sslRequests,
          tlsHandshakes,
          startupMessageCount: startupMessages.length,
          startupProtocols: startupMessages.map((packet) => packet.protocol),
          errors,
          exitCode,
          timedOut: timedOut || false,
        }),
      ),
      fixtureCleanup:
        'temporary certificates and private keys removed in finally',
      passed: true,
    };
    const reportPath = process.env.PREPROD_FIX3_TLS_RESULT_PATH;
    if (reportPath)
      fs.writeFileSync(
        reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'PRISMA_TLS_BLACKBOX_FAILED',
  );
  process.exitCode = 1;
});
