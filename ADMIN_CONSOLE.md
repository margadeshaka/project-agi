# project-agi — admin console (agi-ui) design

**Owner:** project-agi maintainers
**Created:** 2026-05-22
**Status:** Draft for review
**Maps to:** `PLAN.html` § 11 Phase 4 (Optional admin UI)
**Folder:** `packages/agi-ui/`

---

## 0. Mission & non-goals

### What this UI is

A **minimal, opinionated operator console** for a `project-agi` deployment. It exists for the operator (the person standing up the stack at a customer site) and the platform admin (the delivery engineer), not the end user of the agent.

> "Day-to-day trace work is in Langfuse. Day-to-day eval work is in Promptfoo CLI. The admin console handles everything those tools don't."

### Explicit non-goals

| Not this UI | Lives in |
|---|---|
| LLM trace browsing, span trees, cost dashboards | **Langfuse** (linked from the console) |
| Eval runs, regression diffs across prompt versions | **Promptfoo CLI** (CI-driven, results surfaced via Langfuse) |
| End-user agent chat | The use-case service exposes its own HTTP/MCP; this console only previews |
| Authoring agent code | IDE + repo; the console is read-only on code |
| Editing prompts at runtime | Prompts are baked into containers at build (v0 rule). The console **shows** prompts but does not edit them. |
| A vendor marketplace | Out of scope. Tools come from packs and from auto-MCP-from-OpenAPI. |
| Real-time event-stream UX | Langfuse owns this. The console reads from the runtime's API only. |

### What it deliberately does

| Concern | Why here |
|---|---|
| Pack management (list, inspect, reload, diff) | Packs are the unit of multi-tenant config; reviewers need a clickable surface to confirm what's deployed. |
| Tool catalogue (browse, test-invoke, side-effect badges) | The auto-MCP hub generates dozens of tools; a UI that shows the catalogue is faster than reading YAML. |
| AI-Trail (audit) viewer | Audit trail is *separate* from engineering traces (Langfuse). Regulators want a tamper-evident audit UI distinct from observability. |
| Role bindings — "which role → which model right now" | Operators swap providers; a visible truth surface prevents "but the YAML says Claude" arguments. |
| Knowledge-base browser | RAG content per pack; uploads + reindex without leaving the console. |
| Use-case registry | What's deployed, which version, what tools each one allow-lists. |
| Health & readiness | Auto-MCP hub freshness, vector index freshness, LLM provider ping, Langfuse reachability. |
| Admin audit log | Every admin action (pack reload, KB upload, role rebinding) is itself trailed. |

---

## 1. Personas

| Persona | Primary needs | Auth scope |
|---|---|---|
| **Platform admin** | Stand up the stack, configure global LLM roles, manage packs, debug deployment health. | `agi:admin` |
| **Tenant operator** | Manage one pack only — its KB, tool allow-list, scenarios, audit trail. | `agi:operator:<pack-slug>` |
| **Developer** | Inspect tools the auto-MCP hub generated, test-invoke them, read AI-Trail for one correlation_id. | `agi:dev` |
| **Auditor / viewer** | Read AI-Trail. Cannot edit anything. | `agi:viewer` |

RBAC is scope-based, not role-based. The four "personas" above are just convenient bundles of scopes.

---

## 2. Information architecture

```
agi-ui
├── /                                  → Health · Quick status dashboard
├── /packs                             → All packs (admin) / one pack (operator)
│   └── /packs/:slug
│       ├── overview                   → identity, theme preview, model role bindings
│       ├── tools                      → pack's allow-listed tools (from hub catalogue)
│       ├── kb                         → KB browser + upload + reindex
│       ├── prompts                    → read-only prompts viewer (no editing)
│       ├── scenarios                  → demo scenarios (optional)
│       └── audit                      → AI-Trail filtered to this pack
├── /tools                             → Full hub catalogue (cross-pack)
│   └── /tools/:name                   → schema, side-effect, last-build, test-invoke panel
├── /use-cases                         → registered use-case services + versions + health
│   └── /use-cases/:slug               → tool dependencies, model roles required, status
├── /audit                             → AI-Trail viewer (admin-wide)
│   └── /audit/:correlation_id         → event tree for one agent run
├── /llm                               → Role → model bindings, provider health, override
├── /admin
│   ├── /admin/users                   → OIDC-issued identities + scope mapping
│   ├── /admin/log                     → admin action log (who reloaded what when)
│   └── /admin/settings                → operator-level config (Langfuse URL, Qdrant URL, …)
└── /sign-in                           → OIDC redirect (or static-token for dev)
```

The IA is intentionally flat. Operators get one entry point (`/packs/:slug`); admins get the full tree.

---

## 3. Screen-by-screen

### 3.1 `/` — Health

The landing page. Tells you in one glance whether the deployment is operating.

```
┌─────────────────────────────────────────────────────────────────────┐
│  project-agi · production                                  v1.0.0   │
│                                                                     │
│  ●  agi-runtime          OK  · 12ms                                 │
│  ●  agi-core hub         OK  · bundle v2026-05-21 (3 tools added)   │
│  ●  vector / qdrant      OK  · 4 indexes · 1.2M vectors             │
│  ●  langfuse             OK  · 12,481 traces today                  │
│  ●  llm · openai         OK  · 142ms median                         │
│  ◐  llm · ollama         WARN · ec2 not reachable from this pod     │
│  ●  storage              OK  · postgres 14                          │
│                                                                     │
│  Packs deployed: 3                                                  │
│    bluemarble  · 6 tools  · 41 KB articles  · KB last reindex 4h    │
│    care-demo  · 8 tools  · 12 KB articles  · KB last reindex 12m   │
│    fleet-demo  · 5 tools  · 9 KB articles   · KB last reindex 3d ⚠  │
└─────────────────────────────────────────────────────────────────────┘
```

Each row links to its deep page. The KB-reindex warning is a chip, not a modal.

### 3.2 `/packs` and `/packs/:slug/overview`

Pack list (admin) shows all packs. Tenant operator sees only their own pack and is auto-redirected.

```
/packs/care-demo/overview

┌─────────────────────────────────────────────────────────────────────┐
│  care-demo · Care Demo                              [Reload pack] │
│  vertical: telco · loaded from packs/care-demo · sha 8a3f...       │
│                                                                     │
│  Theme preview            Model role bindings                       │
│  ┌──────────────┐         reasoning  → openai/gpt-4o      [healthy] │
│  │ ▮ #0066CC    │         fast       → ollama/llama3.2    [healthy] │
│  │   "primary"  │         extractor  → openai/gpt-4o-mini [healthy] │
│  └──────────────┘                                                   │
│                                                                     │
│  Allow-listed tools  ───────────────────  Top events (24h)          │
│  • billing.adjust_charge          [write]   ▮▮▮▮▮▮▮▮▯▯ 142 tool     │
│  • billing.list_invoices          [read]    ▮▮▮▮▮▯▯▯▯▯  78 llm      │
│  • catalog.list_offers            [read]    ▮▮▮▯▯▯▯▯▯▯  23 error    │
│  • escalate_to_tier2              [write]   ▮▮▯▯▯▯▯▯▯▯   3 handoff  │
│                                                                     │
│  [View KB]  [View scenarios]  [View audit]  [Open in Langfuse ↗]    │
└─────────────────────────────────────────────────────────────────────┘
```

`[Reload pack]` calls `POST /admin/packs/:slug/reload` and re-reads the YAML.

### 3.3 `/packs/:slug/tools` and `/tools`

Tool catalogue. Shows tools allow-listed for the pack (or all tools if at `/tools`).

```
/tools

┌─────────────────────────────────────────────────────────────────────┐
│  Tool catalogue                            45 tools across 7 domains│
│  ─────────────────────────────────────────────────────────────────  │
│  Search: [billing             ]   Domain: [billing ▾]  Side: [any ▾]│
│                                                                     │
│  billing.adjust_charge                        [write] [rate: high]  │
│    POST /billManagement/v4/billingAccount/{id}/adjustments          │
│    "Apply a one-time adjustment to a billing account."              │
│    bundle v2026-05-21 · used by 2 packs · [Test invoke]             │
│                                                                     │
│  billing.list_invoices                        [read]  [rate: low]   │
│    GET /billManagement/v4/customerBill                              │
│    "List invoices for a customer."                                  │
│    bundle v2026-05-21 · used by 4 packs · [Test invoke]             │
│  …                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

Click a tool → details page with full JSON Schema (args + result), source OpenAPI op, side-effect flag, rate-limit class, and a `Test invoke` panel that calls `POST /tools/:name` with form-rendered JSON and shows the result + the generated AI-Trail correlation_id.

### 3.4 `/packs/:slug/kb`

Knowledge-base browser per pack.

```
/packs/care-demo/kb

┌─────────────────────────────────────────────────────────────────────┐
│  KB · care-demo                          12 articles · 184 chunks  │
│  Vector index: qdrant://shared/care-demo · last reindex 12m ago    │
│  [Reindex now]  [Upload markdown/json]                              │
│                                                                     │
│  Search: [esim activation                                       🔍] │
│                                                                     │
│  ☐ eSIM activation                            md · 4.2KB · 12 chunks│
│  ☐ Bill explanation                           md · 3.1KB · 8 chunks │
│  ☐ Plan change                                md · 2.8KB · 6 chunks │
│  …                                                                  │
│                                                                     │
│  Selected (1):  [Preview]  [Re-embed]  [Delete]                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.5 `/audit` and `/audit/:correlation_id`

AI-Trail. The audit-grade event stream — NOT the engineering trace (that's Langfuse). Append-only, tamper-evident, regulator-friendly.

```
/audit

┌─────────────────────────────────────────────────────────────────────┐
│  AI-Trail                                                           │
│  Pack: [any ▾]  Event: [any ▾]  Range: [last 24h ▾]  [⤓ Export CSV] │
│                                                                     │
│  2026-05-22 13:11:09  care-demo  run-9af3  tool_call               │
│       billing.adjust_charge  side-effect:write                      │
│  2026-05-22 13:11:08  care-demo  run-9af3  llm_response            │
│       openai/gpt-4o · 142 in / 84 out tokens                        │
│  2026-05-22 13:11:07  care-demo  run-9af3  llm_request             │
│  2026-05-22 13:08:42  bluemarble  run-7c12  handoff                 │
│       tier2-network                                                 │
│  …                                                                  │
└─────────────────────────────────────────────────────────────────────┘

/audit/run-9af3

┌─────────────────────────────────────────────────────────────────────┐
│  Correlation: run-9af3 · pack care-demo · session sess-XYZ         │
│  Started 13:11:07 · ended 13:11:14 · duration 7s · 4 events         │
│                                                                     │
│  ├── llm_request          → openai/gpt-4o · system + user           │
│  │   prompt cache hit: 0.0                                          │
│  ├── llm_response         ← 142 in / 84 out tokens                  │
│  ├── tool_call            → billing.adjust_charge   [write]         │
│  │     args: { account_id: "C-91823", amount: -12.50, ... }         │
│  └── tool_result          ← 200 · adjustment_id "ADJ-77381"         │
│                                                                     │
│  [Open same run in Langfuse ↗]   [Copy correlation_id]              │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.6 `/llm` — role bindings

The single most asked operator question: "which role uses which model right now?"

```
/llm

┌─────────────────────────────────────────────────────────────────────┐
│  Role bindings                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  Role         Model id                              Region   Health │
│  reasoning    bedrock/anthropic.claude-3-7-sonnet  eu-west-1  ●     │
│               temperature 0.3 · max_tokens 4096                     │
│  fast         bedrock/anthropic.claude-3-5-haiku    eu-west-1  ●    │
│  extractor    openai/gpt-4o-mini                    us-east-1  ●    │
│  fallback     ollama/llama3.2                       local      ◐    │
│                                                                     │
│  [Edit operator.yaml ↗]  [Re-bind for this session]                 │
└─────────────────────────────────────────────────────────────────────┘
```

`Re-bind for this session` sets a process-scope override via `X-LLM-Override` for the admin's own subsequent test invocations — never global, never persisted.

### 3.7 `/use-cases`

The framework v0 model: one container per use case. The console lists them.

```
/use-cases

┌─────────────────────────────────────────────────────────────────────┐
│  Use-case services                                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  Service              Version  Pack(s)             Health  Tools    │
│  bill_explainer       0.3.0    care-demo,         ●       3        │
│                                bluemarble                           │
│  order_fallout        0.2.1    bluemarble          ●       6        │
│  catalog_composer     0.1.0    care-demo          ◐ slow  4        │
│                                                                     │
│  [Open in Langfuse ↗]                                               │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.8 `/admin/log`

Every admin write action is itself written to a separate `admin_log` stream.

```
13:14  admin@example.com   POST /admin/packs/care-demo/reload     OK
13:11  admin@example.com   POST /admin/kb/care-demo/reindex       OK
12:42  ops@partner.com     PATCH /admin/llm/roles/fast { … }       OK
```

---

## 4. API contract the UI consumes

All endpoints served by `agi-runtime`. Each is `X-Pack`-scoped where it makes sense.

| Method | Path | Used by | Auth scope |
|---|---|---|---|
| `GET` | `/healthz` | `/` | any |
| `GET` | `/admin/status` | `/` | `agi:admin` |
| `GET` | `/admin/packs` | `/packs` | `agi:admin` |
| `GET` | `/admin/packs/:slug` | `/packs/:slug/overview` | `agi:operator:slug` or `agi:admin` |
| `POST` | `/admin/packs/:slug/reload` | overview "Reload pack" | `agi:admin` |
| `GET` | `/tools` | `/tools`, `/packs/:slug/tools` | `agi:dev` |
| `GET` | `/tools/:name` | `/tools/:name` | `agi:dev` |
| `POST` | `/tools/:name` | test-invoke panel | `agi:dev` + tool's own scope |
| `GET` | `/kb` | `/packs/:slug/kb` | `agi:operator:slug` |
| `POST` | `/kb` (multipart) | KB upload | `agi:operator:slug` |
| `POST` | `/admin/kb/:slug/reindex` | KB reindex | `agi:operator:slug` |
| `GET` | `/trail?pack=&event=&from=&to=` | `/audit` | `agi:viewer` |
| `GET` | `/trail/:correlation_id` | `/audit/:cid` | `agi:viewer` |
| `GET` | `/admin/llm/bindings` | `/llm` | `agi:admin` |
| `GET` | `/admin/llm/providers` | `/llm` health | `agi:admin` |
| `GET` | `/admin/use-cases` | `/use-cases` | `agi:admin` |
| `GET` | `/admin/log` | `/admin/log` | `agi:admin` |
| `GET` | `/admin/users` | `/admin/users` | `agi:admin` |

All endpoints return JSON. Errors follow RFC 9457 (Problem Details).

---

## 5. Auth & RBAC

- The UI itself does **not** issue tokens. It redirects to the configured OIDC issuer (or accepts a static dev token).
- After OIDC callback, the UI holds the access token in an httpOnly cookie. Every API call is sent with `Authorization: Bearer …`.
- The runtime is the single point of authorisation; the UI's job is only to *hide* what the runtime would reject.
- Scopes are intersected on every request: e.g., `agi:operator:bluemarble` cannot read `/packs/care-demo`.
- Pack-scoped operators are auto-redirected to their pack on sign-in.

---

## 6. Theming

| Surface | Theme source |
|---|---|
| Console chrome (sidebar, top bar, admin pages) | Operator-level theme (`operator.yaml` → `console.theme`). Defaults to a neutral OSS theme — no vendor-specific colours. |
| Pack overview "Theme preview" card | Reads from the **active pack's** `pack.yaml`. Shown as a preview, not applied to the chrome. |
| The agent's own surfaces (when previewed via a use-case service) | Active pack's theme tokens — same way care-intelligence applies BrandProvider. |

No hex literals in components. All colours come from CSS custom properties resolved at render time. Dark/light follows `prefers-color-scheme`.

---

## 7. Tech choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14+ (app router) | Same as bm-ai-platform UI; familiar to the team. SSR for auth + initial paint. |
| Component library | shadcn/ui + Radix | Open-source, themeable via CSS variables, copy-into-tree (no runtime dep). |
| Styling | Tailwind v4 with CSS variables | Pack tokens map cleanly to `--primary` etc. |
| Data fetching | TanStack Query | Server-state cache, retry, suspense-friendly. |
| Forms | React Hook Form + Zod | Tool test-invoke needs schema-driven forms; Zod's compatibility with JSON Schema makes that almost free. |
| Tables | TanStack Table | Tool catalogue + audit list both need virtualised tables. |
| Auth | Auth.js (NextAuth) with OIDC adapter | Pluggable issuer; static-token mode for dev. |
| Test | Vitest + Playwright | Match the wider stack. |
| i18n | next-intl, English-only at v1 | Hook is there for later; no translations in v1. |
| Build | Turbopack | Default in Next 14+. |
| Distribution | One container image; static export possible | The UI is stateless; backend pairing via `AGI_RUNTIME_URL`. |

---

## 8. Wireframe — landing

ASCII sketch only; not a binding visual design. Real Figma file lives outside the repo.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⌂  project-agi · production                          ◧ light  hitesh ▾    │
├─────────────┬───────────────────────────────────────────────────────────────┤
│  Health     │   Health                                                     │
│  Packs      │   ────────────────────────────────────────────────────────    │
│   • blue    │                                                              │
│   • telco   │   ● agi-runtime         OK · 12ms                            │
│   • fleet   │   ● agi-core hub        OK · bundle v2026-05-21              │
│  Tools      │   ● qdrant              OK · 4 indexes · 1.2M vectors        │
│  Use cases  │   ● langfuse            OK · 12,481 traces today             │
│  Audit      │   ● openai              OK · 142ms median                    │
│  LLM        │   ◐ ollama              WARN · ec2 not reachable             │
│  Admin      │   ● storage             OK · postgres 14                     │
│   • users   │                                                              │
│   • log     │   Packs deployed: 3                                          │
│   • settings│   …                                                          │
└─────────────┴───────────────────────────────────────────────────────────────┘
```

---

## 9. Empty / error states

| State | Where | Handling |
|---|---|---|
| No packs deployed | `/packs` | "Drop a folder under `packs/` and reload — see the docs." Link to getting-started. |
| Auto-MCP hub never generated | `/tools` | "Hub bundle not built yet. Run `agi-core build-tools <openapi.yaml>` or wait for the operator to deploy a bundle." |
| Langfuse unreachable | `/`, tool detail "Open in Langfuse" | Show last-known status with timestamp; disable the open link. |
| OIDC issuer down | `/sign-in` | Static-token fallback if `AGI_AUTH_MODE=dev-noop`, otherwise a clear error and a retry. |
| Tool test-invoke fails | tool detail panel | Render the full error problem-details JSON; surface the correlation_id with a link to `/audit/:cid`. |
| KB reindex fails | `/packs/:slug/kb` | Show last successful timestamp + the failure reason; do not block other actions. |
| Insufficient scope | any | Show "You don't have access to this page" and a link back to `/`. Never 500. |

---

## 10. Phasing inside Phase 4

Maps to `PLAN.html` § 11 Phase 4 (Weeks 8–9). Three iterations:

| Iteration | Includes | Cuts |
|---|---|---|
| 4a (week 8 first half) | Health, Packs list, Pack overview, LLM bindings (read-only) | No edit actions; no KB upload; no test-invoke |
| 4b (week 8 second half) | Tool catalogue, Test invoke, Use cases | No reindex; no admin log |
| 4c (week 9) | Audit viewer (list + correlation_id page), KB browser + upload + reindex, Admin log, Settings | i18n, dark mode polish ship in v1.0 |

---

## 11. Open decisions

| # | Question |
|---|---|
| 1 | Do we accept the UI is **read-mostly** at v1? (Pack edits via PR, KB upload + reindex + pack reload are the only writes.) |
| 2 | Should `/audit/:correlation_id` deep-link to Langfuse using a `bm.correlation_id` attribute, or use Langfuse's own search? The first needs us to consistently set the attribute on every span. |
| 3 | Tenant operators with `agi:operator:<slug>` — do they see *only* their pack, or do they see other packs in read-only? |
| 4 | Does the UI ship as a separate container image, or baked into agi-runtime as a static export? Separate is cleaner; baked is one less moving piece. |
| 5 | Multi-pack admins with several `agi:operator:<slug>` scopes — single pack switcher in top bar, or list-then-drill IA? |
| 6 | Pack-private themes — should the chrome ever adopt a pack's theme, or always stay neutral? Recommendation: chrome stays neutral; only the pack preview tile shows the pack's tokens. |

---

## 12. Definition of done (UI v1.0)

- An operator can sign in via OIDC, land on `/packs/<their-slug>`, browse tools, upload a KB article, trigger a reindex, and see the AI-Trail for one run — without reading docs.
- An admin can confirm at a glance whether the deployment is operating (services up, hub bundle current, vector indexes fresh, LLM providers reachable).
- Every write action is in `/admin/log` within 1 s.
- The UI runs on a separate container image; takes < 60 MB; first paint < 1 s on cable.
- Lighthouse a11y ≥ 95; Playwright smoke covers each top-level route signed-in and signed-out.
- No imports of `@bluemarble/*` or any Comviva-internal package.
