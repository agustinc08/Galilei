const pkg = require('./package.json');

module.exports = {
  ...pkg.jest,
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  testPathIgnorePatterns: [],
};
