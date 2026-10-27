'use strict';

function validateDevelopmentDatabaseUrl(rawUrl, options = {}) {
  const allowIsolatedQa = options.allowIsolatedQa === true;
  const allowSuite7Qa = options.allowSuite7Qa === true;
  const allowSuite8Qa = options.allowSuite8Qa === true;
  const deploymentEnvironment =
    options.deploymentEnvironment ?? (allowIsolatedQa ? '' : 'development');
  let target;

  try {
    target = new URL(rawUrl);
  } catch {
    return {
      valid: false,
      target: allowSuite8Qa ? 'suite8-qa' : allowSuite7Qa ? 'suite7-qa' : allowIsolatedQa ? 'deep-qa' : 'dev',
    };
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
    !allowSuite7Qa &&
    !allowSuite8Qa &&
    deploymentEnvironment === 'development' &&
    common &&
    target.port === '55434' &&
    target.pathname === '/buscador_juridico_civil_deepqa';
  const validSuite7Qa =
    allowSuite7Qa &&
    !allowSuite8Qa &&
    deploymentEnvironment === 'development' &&
    common &&
    target.port === '55434' &&
    target.pathname === '/buscador_juridico_civil_deepqa';
  const validSuite8Qa =
    allowSuite8Qa &&
    deploymentEnvironment === 'development' &&
    common &&
    target.port === '55434' &&
    [
      '/galilei_ocr_review_suite8_qa',
      '/galilei_ocr_review_suite8_fresh',
      '/galilei_ocr_review_suite8_from37',
      '/galilei_ocr_review_suite8_from38',
    ].includes(target.pathname);
  const validDev =
    !allowIsolatedQa &&
    common &&
    target.port === '55432' &&
    target.pathname === '/buscador_juridico_civil_dev';

  return {
    valid: validQa || validSuite7Qa || validSuite8Qa || validDev,
    target: allowSuite8Qa ? 'suite8-qa' : allowSuite7Qa ? 'suite7-qa' : allowIsolatedQa ? 'deep-qa' : 'dev',
  };
}

module.exports = { validateDevelopmentDatabaseUrl };
