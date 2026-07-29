import baseConfig from '@tasktwin/config/eslint/base';
import nodeConfig from '@tasktwin/config/eslint/node';

export default [
  {
    ignores: ['src/generated/**'],
  },
  ...baseConfig,
  ...nodeConfig,
];
