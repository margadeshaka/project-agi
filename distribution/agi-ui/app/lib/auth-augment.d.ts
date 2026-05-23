// SPDX-License-Identifier: Apache-2.0
/**
 * Augment next-auth's `Session` so that consumers see the AuthSession shape
 * we project in auth.ts. Keep this file declaration-only — adding runtime
 * code here causes ts to drop the ambient module declarations.
 */
import type { AuthScope } from './auth-types';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      scopes: AuthScope[];
      tenantId: string;
    };
    accessToken: string;
    expires: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: AuthScope[];
    tenantId?: string;
    error?: 'RefreshAccessTokenError';
  }
}
