function validateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEB_CONFIGURATION_INVALID');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('WEB_CONFIGURATION_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !loopback &&
    process.env.TASKTWIN_ALLOW_HTTP_INTERNAL_API !== 'true'
  ) {
    throw new Error('WEB_CONFIGURATION_INVALID');
  }
}

try {
  const origin = process.env.TASKTWIN_API_BASE_URL;
  if (origin === undefined) throw new Error('WEB_CONFIGURATION_INVALID');
  validateOrigin(origin);
  const timeout = Number(
    process.env.TASKTWIN_WEB_READINESS_TIMEOUT_MS ?? '3000',
  );
  if (!Number.isInteger(timeout) || timeout < 250 || timeout > 10_000) {
    throw new Error('WEB_CONFIGURATION_INVALID');
  }
  await import('./server.js');
} catch {
  console.error('WEB_STARTUP_FAILED');
  process.exitCode = 1;
}
