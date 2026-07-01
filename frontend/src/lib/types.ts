// ---- Domain types mirroring the backend API contract ----

export type ForumType = 'flarum' | 'xenforo';
export type AiProvider = 'gemini' | 'openai';
export type StrikeStatus = 'active' | 'flagged' | 'suspended';
export type Severity = 'low' | 'medium' | 'high' | string;

export interface AuthUser {
  id: number;
  username: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface DashboardUser {
  id: number;
  username: string;
  created_at: string;
}

export interface ForumConnection {
  base_url: string;
  bot_user_id: number;
  connected: boolean;
}

export interface AiSettings {
  provider: AiProvider;
  model: string;
  has_key: boolean;
}

export interface ModerationSettings {
  enabled: boolean;
  auto_hide: boolean;
  notify_user: boolean;
  violation_threshold: number;
  poll_interval_seconds: number;
  strike_suspend_threshold: number;
}

export interface Settings {
  forum_type: ForumType;
  flarum: ForumConnection;
  xenforo: ForumConnection;
  ai: AiSettings;
  moderation: ModerationSettings;
  rules: string;
  system_prompt: string;
  notify_template: string;
}

export interface SettingsDefaults {
  rules: string;
  system_prompt: string;
  notify_template: string;
}

/** Partial body for PUT /api/settings — only send what changed. */
export interface SettingsUpdate {
  forum_type?: ForumType;
  flarum_base_url?: string;
  flarum_bot_user_id?: number;
  xenforo_base_url?: string;
  xenforo_bot_user_id?: number;
  ai_provider?: AiProvider;
  ai_model?: string;
  ai_api_key?: string;
  moderation_enabled?: boolean;
  auto_hide?: boolean;
  notify_user?: boolean;
  violation_threshold?: number;
  poll_interval_seconds?: number;
  strike_suspend_threshold?: number;
  rules?: string;
  system_prompt?: string;
  notify_template?: string;
}

export interface FlarumConnectResponse {
  connected: boolean;
  bot_user_id: number;
}

export interface XenforoConnectResponse {
  connected: boolean;
  me_user_id: number;
}

export interface AiVerdict {
  violation: boolean;
  confidence: number;
  severity: Severity;
  categories: string;
  reason: string;
  message_to_user: string;
}

export interface AiTestResponse {
  ok: boolean;
  provider: string;
  model: string;
  /** Present only when ok === true. */
  verdict?: AiVerdict;
  /** Present only when ok === false — the real failure reason from the provider. */
  error?: string;
}

/** Lightweight provider+model+key connectivity check. */
export interface AiValidateResponse {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms?: number;
  error?: string;
}

// ---- Scan by URL ----
export interface ScanItem {
  post_id: number;
  thread_id: number;
  platform: string;
  is_first_post: boolean;
  author_id: number;
  author_username: string;
  excerpt: string;
  already_hidden: boolean;
  pending?: boolean;
  violation: boolean;
  confidence?: number;
  severity?: string;
  categories?: string;
  reason?: string;
  message_to_user?: string;
  hidden?: boolean;
  action?: string;
  skipped?: boolean;
  error?: string;
}

export type ScanAction = 'hide' | 'approve' | 'restore';

export interface ScanReport {
  ok: boolean;
  error?: string;
  platform: string;
  thread_id: number;
  title: string;
  total: number;
  scanned: number;
  violations: number;
  hidden: number;
  approved: number;
  auto: boolean;
  items: ScanItem[];
}

export interface TokenUsage {
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  updated_at: string;
}

export interface TokenStats {
  items: TokenUsage[];
  totals: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
  };
}

export interface FullScanState {
  running: boolean;
  done: boolean;
  stopped: boolean;
  platform: string;
  threads: number;
  scanned: number;
  violations: number;
  hidden: number;
  approved: number;
  current_thread: string;
  started_at: string;
  last_error: string;
}

export interface IntegrationInfo {
  forum_type: ForumType;
  ingest_api_key: string;
  ingest_login: string;
  ingest_moderate: string;
  xenforo: {
    connected: boolean;
    base_url: string;
    bot_user_id: number;
  };
}

export interface LogEntry {
  id: number;
  post_id: number;
  discussion_id: number;
  discussion_title: string;
  author_user_id: number;
  author_username: string;
  post_type: string;
  content_excerpt: string;
  violation: boolean;
  confidence: number;
  severity: Severity;
  categories: string;
  reason: string;
  message_to_user: string;
  action_taken: string;
  source: string;
  ai_provider: string;
  ai_model: string;
  created_at: string;
}

export interface LogsResponse {
  items: LogEntry[];
  total: number;
}

export interface StrikeEntry {
  user_id: number;
  username: string;
  strikes: number;
  last_violation_at: string;
  status: StrikeStatus;
  note: string;
}

export interface Stats {
  stats: {
    total_checked: number;
    total_violations: number;
    total_hidden: number;
    flagged_users: number;
    last_poll_at: string;
    last_post_id: number;
    last_error: string;
  };
  worker: {
    running: boolean;
    last_error: string;
  };
  status: {
    enabled: boolean;
    flarum_connected: boolean;
    xenforo_connected: boolean;
    ai_configured: boolean;
    provider: string;
    model: string;
    threshold: number;
    poll_interval: number;
    platform: string;
  };
}
