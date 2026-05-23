// SPDX-License-Identifier: Apache-2.0
/**
 * OIDC sign-in stub (FR-AUTH). The real flow redirects to the configured
 * Keycloak / OIDC issuer; for the P3 phase gate this just renders the
 * entry point so layout + routing + theming all wire end-to-end.
 */

export default function SignInPage() {
  const issuer =
    process.env.NEXT_PUBLIC_AGI_OIDC_ISSUER ??
    process.env.NEXT_PUBLIC_OIDC_ISSUER ??
    'http://localhost:8081/realms/agi';

  return (
    <section className="mx-auto max-w-md space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted">
        project-agi delegates identity to your OIDC provider. Click below to
        continue to your configured IdP.
      </p>
      <a
        href={`/api/auth/oidc/start?issuer=${encodeURIComponent(issuer)}`}
        className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Continue with OIDC
      </a>
      <div className="rounded-md border border-border bg-muted/10 p-3 text-xs text-muted">
        Issuer: <code>{issuer}</code>
        <br />
        Dev mode? Set <code>AGI_AUTH=dev-noop</code> on the runtime to bypass.
      </div>
    </section>
  );
}
