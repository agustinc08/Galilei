'use strict';

function validateDevelopmentDatabaseUrl(rawUrl, options = {}) {
  const allowIsolatedQa = options.allowIsolatedQa === true;
  const deploymentEnvironment =
    options.deploymentEnvironment ?? (allowIsolatedQa ? '' : 'development');
  let target;

  try {
    target = new URL(rawUrl);
  } catch {
    return { valid: false, target: allowIsolatedQa ? 'deep-qa' : 'dev' };
  }

  const common =
    target.protocol === 'postgresql:' &&
    target.hostname === '127.0.0.1' &&
    target.username === 'bjc_dev' &&
    target.search === '' &&
    target.hash === '' &&
    !rawUrl.includes('?') &&
    !rawUrl.includes('#') &&
    Boolean(target.password);
  const validQa =
    allowIsolatedQa &&
    deploymentEnvironment === 'development' &&
    common &&
    target.port === '55434' &&
    target.pathname === '/buscador_juridico_civil_deepqa';
  const validDev =
    !allowIsolatedQa &&
    common &&
    target.port === '55432' &&
    target.pathname === '/buscador_juridico_civil_dev';

  return {
    valid: validQa || validDev,
    target: allowIsolatedQa ? 'deep-qa' : 'dev',
  };
}

module.exports = { validateDevelopmentDatabaseUrl };
