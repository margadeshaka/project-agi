# Security policy

## Supported versions

Until v1.0, the only supported version is the latest `main`. After v1.0, security fixes will be backported to the current major version.

## Reporting a vulnerability

**Do not file a public GitHub issue for security bugs.**

Report privately to: `security@<org>.<tld>` (placeholder — final address set during Phase 0 by the project owner).

What to include:
- A description of the issue and its potential impact.
- Steps to reproduce (or proof-of-concept).
- The version / commit affected.

We will acknowledge receipt within 3 business days and aim to provide a remediation plan within 10 business days for critical issues.

## Disclosure timeline

We follow coordinated disclosure. We will:

1. Acknowledge the report within 3 business days.
2. Confirm or refute the issue within 10 business days.
3. Prepare a fix and a CVE (if applicable) within 30 days for high/critical issues.
4. Publish the fix and a security advisory.

## Scope

In scope:
- All code in this repository (`packages/`, `distribution/`).
- Default Docker images published from this repository.
- Helm chart in `distribution/agi-chart/`.

Out of scope:
- Third-party services we integrate with (Langfuse, Qdrant, MCP, LLM providers) — report to them directly.
- Customer-specific packs and KB content.
- Misconfiguration at adopter sites (use the docs and SECURITY notes in `docs/operations/`).
