/** @type {import('next').NextConfig} */
// SPDX-License-Identifier: Apache-2.0
//
// Headers: NFR-SEC-03 (CSP), NFR-SEC-02 (cookie hardening done in route handlers).
// connect-src is restricted to self because the browser only ever talks to
// /api/runtime/* (the same-origin proxy). The proxy then dials the runtime
// server-side, so the runtime origin never leaks to the client.

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval' 'unsafe-inline'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    instrumentationHook: false,
  },
  env: {
    AGI_RUNTIME_URL: process.env.AGI_RUNTIME_URL || 'http://localhost:9000',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspDirectives },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
