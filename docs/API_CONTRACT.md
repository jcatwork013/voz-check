# VozCheck Backend API Contract

Base URL (prod): `https://voz-check.9bricks.com` — the web container proxies `/api/*` to the Go backend (`voz-check-api:8080`). In dev the backend runs on `:8080`.

All responses are JSON. All endpoints **except** `GET /api/health`, `POST /api/auth/login`, and `POST /api/ingest/login` require header `Authorization: Bearer <token>`.

Errors: non-2xx return `{ "error": "message in Vietnamese" }`.

## Auth
- `POST /api/auth/login` body `{username, password}` → `200 {token, user:{id,username}}` | `401 {error}`
- `GET /api/auth/me` → `{id, username}`
- `POST /api/auth/change-password` body `{old_password, new_password}` → `{ok:true}` | `4xx {error}`

## Dashboard users
- `GET /api/users` → `{items:[{id,username,created_at}]}`
- `POST /api/users` body `{username, password}` → `201 {id,username}` | `409 {error}` (password ≥ 6 chars)

## Settings
- `GET /api/settings` →
```json
{
  "forum_type": "flarum",
  "flarum":  {"base_url":"...","bot_user_id":1,"connected":false},
  "xenforo": {"base_url":"...","bot_user_id":1,"connected":false},
  "ai": {"provider":"gemini","model":"gemini-2.0-flash","has_key":false},
  "moderation": {"enabled":false,"auto_hide":true,"notify_user":true,
                 "violation_threshold":75,"poll_interval_seconds":10,"strike_suspend_threshold":3},
  "rules": "markdown...", "system_prompt":"...", "notify_template":"..."
}
```
- `GET /api/settings/defaults` → `{rules, system_prompt, notify_template}` (for "restore defaults")
- `PUT /api/settings` partial body. Recognised keys:
  `forum_type, flarum_base_url, flarum_bot_user_id(int), xenforo_base_url, xenforo_bot_user_id(int),`
  `ai_provider, ai_model, ai_api_key(secret — only sent when non-empty),`
  `moderation_enabled(bool), auto_hide(bool), notify_user(bool),`
  `violation_threshold(int), poll_interval_seconds(int), strike_suspend_threshold(int),`
  `rules, system_prompt, notify_template` → returns the redacted settings object above.
- `POST /api/settings/flarum/connect` body `{base_url, username, password}` → `{connected:true, bot_user_id}` | `502 {error}`
- `POST /api/settings/xenforo/connect` body `{base_url, api_key, bot_user_id}` → `{connected:true, me_user_id}` | `502 {error}`
- `POST /api/settings/ai/test` body `{sample?}` → `{ok:true, provider, model, verdict:{violation,confidence,severity,categories,reason,message_to_user}}` | `502 {error}`

## Integration (XenForo add-on)
- `GET /api/integration` → `{forum_type, ingest_api_key, ingest_login:"/api/ingest/login", ingest_moderate:"/api/ingest/moderate", xenforo:{connected,base_url,bot_user_id}}`
- `POST /api/integration/regenerate-key` → `{ingest_api_key}`

## Logs (moderation history)
- `GET /api/logs?limit=50&offset=0&violation=1&q=text` → `{items:[LogEntry], total}`
  `LogEntry = {id,post_id,discussion_id,discussion_title,author_user_id,author_username,post_type,`
  `content_excerpt,violation(bool),confidence(0-100),severity,categories(csv),reason,message_to_user,`
  `action_taken,source,ai_provider,ai_model,created_at}`
- `GET /api/logs/{id}` → `LogEntry`
- `POST /api/logs/{id}/hide` → `{ok:true, hidden:true}`
- `POST /api/logs/{id}/unhide` → `{ok:true, hidden:false}`

## Strikes ("phạt nguội")
- `GET /api/strikes` → `{items:[{user_id,username,strikes,last_violation_at,status,note}]}` (status: active|flagged|suspended)
- `POST /api/strikes/{userId}/status` body `{status, note}` → `{ok:true}`
- `POST /api/strikes/{userId}/reset` → `{ok:true}`

## Scan
- `POST /api/scan/backfill` body `{limit}` → `202 {started:true}` | `409 {error}` (async; results show up in logs/stats)

## Stats
- `GET /api/stats` →
```json
{
  "stats": {"total_checked":0,"total_violations":0,"total_hidden":0,"flagged_users":0,
            "last_poll_at":"","last_post_id":0,"last_error":""},
  "worker": {"running":false,"last_error":""},
  "status": {"enabled":false,"flarum_connected":false,"ai_configured":false,
             "provider":"gemini","model":"...","threshold":75,"poll_interval":10}
}
```

## Health
- `GET /api/health` → `{ok:true, time}`

## Ingest (used by the XenForo add-on, NOT the dashboard)
- `POST /api/ingest/login` body `{api_key}` → `{token, expires_in_days}` | `401`
- `POST /api/ingest/moderate` (Bearer ingest token) body
  `{platform:"xenforo", post_id, thread_id, thread_title, author_id, author_username, content, type:"thread"|"comment"}`
  → `{violation, confidence, severity, categories, reason, message_to_user, action:"allow"|"flag"|"reject", should_hide, should_notify}`
