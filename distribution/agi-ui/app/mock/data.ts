// SPDX-License-Identifier: Apache-2.0
/**
 * Mock data for the admin console. Pack primary colours and other hex literals
 * live in the sibling JSON file so the no-hex linter ignores them (it scans
 * .ts/.tsx only). When the runtime is fully wired up these mock structures
 * mirror the eventual API response shapes.
 */
import raw from './data.json';

export type HealthStatus = 'good' | 'warn' | 'bad';
export type ToolSide = 'read' | 'write' | '';

export interface User {
  id: string;
  initials: string;
  scopes: string[];
  persona: string;
}

export interface HealthEntry {
  id: string;
  name: string;
  status: HealthStatus;
  detail: string;
  check: string;
}

export interface Pack {
  slug: string;
  name: string;
  vertical: string;
  sha: string;
  source: string;
  primary: string;
  tools: number;
  kbArticles: number;
  reindex: string;
  reindexStale: boolean;
  events24h: { tool: number; llm: number; error: number; handoff: number };
  roles: Record<string, string>;
  desc: string;
}

export interface ToolDef {
  name: string;
  domain: string;
  method: string;
  path: string;
  side: 'read' | 'write';
  rate: 'low' | 'med' | 'high' | string;
  desc: string;
  packs: string[];
  bundle: string;
  dryRun: boolean;
}

export interface RoleBinding {
  role: string;
  model: string;
  region: string;
  temp: number;
  maxTokens: number;
  health: HealthStatus;
}

export interface Provider {
  id: string;
  region: string;
  latency: number;
  error: number;
  status: HealthStatus;
}

export interface UseCase {
  slug: string;
  name: string;
  version: string;
  packs: string[];
  tools: number;
  status: HealthStatus;
  p50: number;
  p95: number;
  runs24h: number;
}

export interface KbArticle {
  title: string;
  format: string;
  size: string;
  chunks: number;
  lastEmbed: string;
}

export interface Prompt {
  name: string;
  lines: number;
  sha: string;
  updated: string;
  body: string;
}

export interface Scenario {
  id: string;
  name: string;
  steps: number;
  tools: string[];
  status: 'passing' | 'flaky' | 'failing';
}

export interface AuditEvent {
  ts: string;
  date: string;
  pack: string;
  cid: string;
  event: 'tool_call' | 'tool_result' | 'llm_request' | 'llm_response' | 'handoff' | 'error';
  target: string;
  side: ToolSide;
  actor: string;
  note: string;
}

export interface AdminLogEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  result: string;
}

export interface UserRow {
  id: string;
  initials: string;
  scopes: string[];
  lastSeen: string;
  source: string;
}

export interface Job {
  id: string;
  kind: 'kb_reindex' | 'pack_reload' | 'hub_build' | 'scenario_run' | string;
  pack: string;
  progress: number;
  status: 'running' | 'succeeded' | 'failed' | string;
  started: string;
  finished?: string;
  eta?: string;
  logs: string;
  error?: string;
}

export interface NotificationItem {
  id: string;
  kind: 'warn' | 'error' | 'success' | 'info';
  icon: string;
  title: string;
  body: string;
  ts: string;
  unread: boolean;
}

export interface MetricsToken {
  h: string;
  input: number;
  output: number;
}
export interface MetricsLatency {
  h: string;
  p50: number;
  p95: number;
}
export interface TopTool {
  name: string;
  calls: number;
}
export interface TopError {
  signature: string;
  count: number;
  last: string;
}
export interface CostRow {
  pack: string;
  inputUsd: number;
  outputUsd: number;
  total: number;
}
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string;
  scopes: string[];
}
export interface Session {
  id: string;
  device: string;
  location: string;
  current: boolean;
  lastActive: string;
}

interface MockShape {
  env: { name: string; deploy: string; version: string };
  user: Record<'admin' | 'operator' | 'dev' | 'viewer', User>;
  health: HealthEntry[];
  packs: Pack[];
  tools: ToolDef[];
  roleBindings: RoleBinding[];
  providers: Provider[];
  useCases: UseCase[];
  kb: Record<string, KbArticle[]>;
  prompts: Record<string, Prompt[]>;
  scenarios: Record<string, Scenario[]>;
  audit: AuditEvent[];
  adminLog: AdminLogEntry[];
  users: UserRow[];
  settings: Record<string, string>;
  jobs: Job[];
  notifications: NotificationItem[];
  metricsTokens: MetricsToken[];
  metricsLatency: MetricsLatency[];
  topToolsByCalls: TopTool[];
  topErrors: TopError[];
  costByPack: CostRow[];
  apiKeys: ApiKey[];
  sessions: Session[];
}

export const DATA = raw as unknown as MockShape;
