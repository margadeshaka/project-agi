// SPDX-License-Identifier: Apache-2.0
/**
 * Sign-in page — Auth.js v5 server-action style.
 *
 * The form posts to a server action which calls `signIn("keycloak")`. v5
 * handles the OIDC code-flow redirect; the user lands back on `/` (or the
 * `callbackUrl` we hand it).
 *
 * Keeping this RSC means we don't ship the next-auth/react bundle to the
 * sign-in page itself.
 */

import { signIn } from '@/auth';

export default function SignInPage() {
  const issuer = process.env.AGI_OIDC_ISSUER ?? 'http://localhost:8081/realms/agi';

  async function doSignIn() {
    'use server';
    await signIn('keycloak', { redirectTo: '/' });
  }

  return (
    <section className="mx-auto max-w-md space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted">
        project-agi delegates identity to your OIDC provider. Click below to
        continue to your configured Keycloak realm.
      </p>
      <form action={doSignIn}>
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Continue with Keycloak
        </button>
      </form>
      <div className="rounded-md border border-border bg-muted/10 p-3 text-xs text-muted">
        Issuer: <code>{issuer}</code>
      </div>
    </section>
  );
}
