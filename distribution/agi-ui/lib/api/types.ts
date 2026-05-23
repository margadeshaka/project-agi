// SPDX-License-Identifier: Apache-2.0
/**
 * Types matching the agi-runtime response shapes. The runtime publishes
 * an OpenAPI spec at /openapi.json (FR-INT-03); these hand-rolled types
 * are a stopgap for v1 — codegen lands in P5.
 *
 * Authoritative source: ADMIN_CONSOLE.md § 4 "API contract".
 */

/** RFC 9457 problem-details — what the runtime returns on error (FR-INT-02). */
export interface ProblemDetails {
  type?: string;
  title: string;
  status?: number;
  detail?: string;
  instance?: string;
  // RFC 9457 allows arbitrary additional members.
  [key: string]: unknown;
}

/** The runtime's pack list item (GET /admin/packs). */
export interface Pack {
  slug: string;
  display_name: string;
  vertical: string;
  source_path: string;
  sha: string;
  tool_count: number;
  kb_article_count: number;
  kb_last_reindex_iso?: string | null;
}

/** The runtime's pack overview (GET /admin/packs/:slug). */
export interface PackOverview {
  slug: string;
  display_name: string;
  vertical: string;
  source_path: string;
  sha: string;
  theme: {
    primary: string;
    secondary?: string;
    accent?: string;
  };
  role_bindings: ModelBinding[];
  allowed_tools: ToolSummary[];
  recent_events_24h: {
    tool: number;
    llm: number;
    error: number;
    handoff: number;
  };
  hotfix_branches?: HotfixBranch[];
}

export interface HotfixBranch {
  name: string;
  merged: boolean;
  deployed_at_iso?: string | null;
}

/** Side-effect flag from the tool catalogue. */
export type SideEffect = 'read' | 'write';

/** Rate-limit class. */
export type RateLimitClass = 'low' | 'medium' | 'high';

/** Single tool catalogue row (GET /tools). */
export interface ToolSummary {
  name: string;
  domain: string;
  description: string;
  side_effect: SideEffect;
  rate_limit_class: RateLimitClass;
  bundle_version: string;
  consuming_pack_count: number;
  dry_run_supported: boolean;
}

/** Full tool detail (GET /tools/:name). */
export interface ToolDetail extends ToolSummary {
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  source_openapi_op: string;
  last_build_sha: string;
}

/** Minimal JSON Schema subset we render — runtime guarantees draft 2020-12. */
export interface JsonSchema {
  $schema?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  /** OpenAPI 3.1 / JSON-Schema 2020-12 variant union. */
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  /** OpenAPI 3.x discriminator object — `{ propertyName, mapping? }`. */
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
  /** Const used for variant tagging in `oneOf` branches. */
  const?: unknown;
  [key: string]: unknown;
}

/** Result of POST /tools/:name. */
export interface ToolInvokeResult {
  ok: boolean;
  correlation_id: string;
  result?: unknown;
  problem?: ProblemDetails;
}

/** AI-Trail event row (GET /trail). */
export interface TrailEvent {
  correlation_id: string;
  pack: string;
  event_type: TrailEventType;
  timestamp_iso: string;
  side_effect: boolean;
  // Type-specific summary the runtime computes for the list view.
  summary?: string;
  tool_name?: string | null;
  model_id?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

export type TrailEventType =
  | 'tool_call'
  | 'tool_result'
  | 'llm_request'
  | 'llm_response'
  | 'handoff'
  | 'error'
  | 'kb_search'
  | 'kb_hit';

/** Detail of one agent run (GET /trail/:correlation_id). */
export interface TrailRun {
  correlation_id: string;
  pack: string;
  session_id: string;
  started_iso: string;
  ended_iso?: string | null;
  duration_ms?: number | null;
  event_count: number;
  langfuse_url?: string | null;
  events: TrailEventDetail[];
}

export interface TrailEventDetail extends TrailEvent {
  payload: Record<string, unknown>;
}

/** Model role binding (GET /admin/llm/bindings). */
export interface ModelBinding {
  role: string;
  model_id: string;
  region: string;
  health: 'ok' | 'warn' | 'down';
  default_params: {
    temperature?: number;
    max_tokens?: number;
    [key: string]: unknown;
  };
}

/** KB article (GET /kb?pack=:slug). */
export interface KbArticle {
  id: string;
  title: string;
  source_format: 'md' | 'json';
  size_bytes: number;
  chunk_count: number;
  last_reindex_iso?: string | null;
}

/** Use-case service (GET /admin/use-cases). */
export interface UseCaseService {
  name: string;
  version: string;
  packs: string[];
  health: 'ok' | 'slow' | 'down';
  tool_count: number;
}

/** Health row (GET /admin/status or /healthz). */
export interface HealthStatus {
  status: 'ready' | 'degraded' | 'down';
  checks: Record<string, boolean>;
  details?: Record<string, { latency_ms?: number; message?: string; checked_iso?: string }>;
  degraded?: string[];
}

/** Admin write-action log entry (GET /admin/log). */
export interface AdminLogEntry {
  timestamp_iso: string;
  actor: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  detail?: string;
}

/** Active OIDC identity (GET /admin/users). */
export interface AdminUser {
  subject: string;
  email?: string;
  scopes: string[];
  last_seen_iso: string;
}

/** Operator-level settings (GET /admin/settings). */
export interface AdminSettings {
  oidc_issuer: string;
  langfuse_url?: string | null;
  vector_store_url?: string;
  telemetry_sampling: number;
  env: string;
}

/** Session shape from auth-provider — derived from OIDC ID token claims. */
export interface SessionUser {
  subject: string;
  email?: string;
  name?: string;
  scopes: string[];
}

/** Convenience: scope predicates. */
export function isAdmin(user: SessionUser | null | undefined): boolean {
  return !!user?.scopes.includes('agi:admin');
}

export function isViewer(user: SessionUser | null | undefined): boolean {
  return !!user?.scopes.some((s) => s === 'agi:viewer' || s === 'agi:admin');
}

export function isDev(user: SessionUser | null | undefined): boolean {
  return !!user?.scopes.some((s) => s === 'agi:dev' || s === 'agi:admin');
}

export function operatorSlugs(user: SessionUser | null | undefined): string[] {
  if (!user) return [];
  return user.scopes
    .filter((s) => s.startsWith('agi:operator:'))
    .map((s) => s.slice('agi:operator:'.length));
}

export function canManagePack(
  user: SessionUser | null | undefined,
  slug: string,
): boolean {
  if (isAdmin(user)) return true;
  return operatorSlugs(user).includes(slug);
}
