import baseConfig from '@tasktwin/config/eslint/base';
import browserConfig from '@tasktwin/config/eslint/browser';
import nextVitalsConfig from 'eslint-config-next/core-web-vitals';

const webConfig = [...baseConfig, ...browserConfig, ...nextVitalsConfig];

export default webConfig;
