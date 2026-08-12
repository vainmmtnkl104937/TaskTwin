import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import {
  getWebSecurityHeaders,
  WEB_POWERED_BY_HEADER,
} from './lib/security-headers';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: WEB_POWERED_BY_HEADER,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getWebSecurityHeaders(process.env.NODE_ENV === 'production'),
      },
    ];
  },
};

export default nextConfig;
