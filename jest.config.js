// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
  // d3 (and its sub-packages) ship as ES modules, so they must be transformed too —
  // otherwise importing the panel (which pulls in d3) throws "Cannot use import statement
  // outside a module". Extend the scaffolded allowlist rather than editing it.
  transformIgnorePatterns: [
    nodeModulesToTransform([
      ...grafanaESModules,
      'd3',
      'd3-[a-z-]+',
      'internmap',
      'delaunator',
      'robust-predicates',
    ]),
  ],
};
