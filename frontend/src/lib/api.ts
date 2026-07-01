import type {
  AiProvider,
  AiTestResponse,
  AiValidateResponse,
  AuthUser,
  DashboardUser,
  FlarumConnectResponse,
  IntegrationInfo,
  LogEntry,
  LoginResponse,
  FullScanState,
  LogsResponse,
  ScanAction,
  ScanItem,
  ScanReport,
  Settings,
  SettingsDefaults,
  SettingsUpdate,
  Stats,
  TokenStats,
  StrikeEntry,
  StrikeStatus,
  XenforoConnectResponse,
} from './types';

export const TOKEN_KEY = 'voz_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Typed API error so callers can show the Vietnamese message from the backend. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** When true, do not attach the Authorization header (used for /auth/login). */
  noAuth?: boolean;
}

/** Called on any 401 so the app can redirect to /login. Wired up by AuthProvider. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (!opts.noAuth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
  }

  if (res.status === 401 && !opts.noAuth) {
    clearToken();
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }

  // 204 / empty body
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const msg = isErrorBody(parsed) ? parsed.error : `Lỗi máy chủ (HTTP ${res.status})`;
    throw new ApiError(res.status, msg);
  }

  return parsed as T;
}

// ---- Auth ----
export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      noAuth: true,
    }),

  me: () => request<AuthUser>('/api/auth/me'),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: { old_password: oldPassword, new_password: newPassword },
    }),

  // ---- Dashboard users ----
  listUsers: () => request<{ items: DashboardUser[] }>('/api/users'),

  createUser: (username: string, password: string) =>
    request<{ id: number; username: string }>('/api/users', {
      method: 'POST',
      body: { username, password },
    }),

  // ---- Settings ----
  getSettings: () => request<Settings>('/api/settings'),

  getDefaults: () => request<SettingsDefaults>('/api/settings/defaults'),

  updateSettings: (patch: SettingsUpdate) =>
    request<Settings>('/api/settings', { method: 'PUT', body: patch }),

  connectFlarum: (base_url: string, username: string, password: string) =>
    request<FlarumConnectResponse>('/api/settings/flarum/connect', {
      method: 'POST',
      body: { base_url, username, password },
    }),

  connectXenforo: (base_url: string, api_key: string, bot_user_id: number) =>
    request<XenforoConnectResponse>('/api/settings/xenforo/connect', {
      method: 'POST',
      body: { base_url, api_key, bot_user_id },
    }),

  testAi: (sample?: string) =>
    request<AiTestResponse>('/api/settings/ai/test', {
      method: 'POST',
      body: sample ? { sample } : {},
    }),

  /**
   * Validate provider + model + key with one minimal real call. Omitted fields
   * fall back to the stored settings (so the saved key can be re-tested without
   * retyping); pass the form values to validate edits before saving.
   */
  validateAi: (body: { provider?: AiProvider; model?: string; api_key?: string }) =>
    request<AiValidateResponse>('/api/settings/ai/validate', { method: 'POST', body }),

  // ---- Scan by URL ----
  scanUrl: (url: string, auto: boolean) =>
    request<ScanReport>('/api/scan/url', {
      method: 'POST',
      body: { url, auto },
    }),

  /** Hide, approve, or restore a single post from a scan report. */
  scanPostAction: (item: ScanItem, action: ScanAction) =>
    request<{ ok: boolean; action?: string }>('/api/scan/post-action', {
      method: 'POST',
      body: {
        action,
        platform: item.platform,
        post_id: item.post_id,
        thread_id: item.thread_id,
        author_id: item.author_id,
        author_username: item.author_username,
        content: item.excerpt,
        confidence: item.confidence,
        severity: item.severity,
        categories: item.categories,
        reason: item.reason,
        message_to_user: item.message_to_user,
      },
    }),

  // ---- Full-forum scan ----
  scanFullStart: () =>
    request<{ ok: boolean; error?: string }>('/api/scan/full/start', { method: 'POST' }),
  scanFullStop: () => request<{ ok: boolean }>('/api/scan/full/stop', { method: 'POST' }),
  scanFullStatus: () => request<FullScanState>('/api/scan/full/status'),

  // ---- Integration ----
  getIntegration: () => request<IntegrationInfo>('/api/integration'),

  regenerateIngestKey: () =>
    request<{ ingest_api_key: string }>('/api/integration/regenerate-key', { method: 'POST' }),

  // ---- Logs ----
  getLogs: (params: { limit?: number; offset?: number; violation?: boolean; q?: string }) => {
    const sp = new URLSearchParams();
    if (params.limit !== undefined) sp.set('limit', String(params.limit));
    if (params.offset !== undefined) sp.set('offset', String(params.offset));
    if (params.violation) sp.set('violation', '1');
    if (params.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<LogsResponse>(`/api/logs${qs ? `?${qs}` : ''}`);
  },

  getLog: (id: number) => request<LogEntry>(`/api/logs/${id}`),

  hideLog: (id: number) =>
    request<{ ok: boolean; hidden: boolean }>(`/api/logs/${id}/hide`, { method: 'POST' }),

  unhideLog: (id: number) =>
    request<{ ok: boolean; hidden: boolean }>(`/api/logs/${id}/unhide`, { method: 'POST' }),

  // ---- Strikes ----
  getStrikes: () => request<{ items: StrikeEntry[] }>('/api/strikes'),

  setStrikeStatus: (userId: number, status: StrikeStatus, note: string) =>
    request<{ ok: boolean }>(`/api/strikes/${userId}/status`, {
      method: 'POST',
      body: { status, note },
    }),

  resetStrike: (userId: number) =>
    request<{ ok: boolean }>(`/api/strikes/${userId}/reset`, { method: 'POST' }),

  // ---- Scan ----
  backfill: (limit: number) =>
    request<{ started: boolean }>('/api/scan/backfill', { method: 'POST', body: { limit } }),

  // ---- Stats ----
  getStats: (platform?: string) =>
    request<Stats>(`/api/stats${platform ? `?platform=${platform}` : ''}`),

  getTokenStats: () => request<TokenStats>('/api/stats/tokens'),
};
