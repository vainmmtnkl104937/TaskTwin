import { getRunnerStatus } from './status.js';

const status = getRunnerStatus();

console.info(`TaskTwin local runner started safely. Status: ${status.status}.`);
