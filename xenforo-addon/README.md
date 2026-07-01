# VozCheck AI Moderation — XenForo 2.2 / 2.3 Add-on

> **Status: BETA.** This add-on was written to the official XenForo 2.2+
> developer conventions but has **not** been run against a live XenForo
> instance. Several XenForo API details are version-sensitive and **must be
> verified on a real forum before production use** — see
> [BETA caveats & live-verification checklist](#beta-caveats--what-to-verify-on-a-live-instance).

Add-on ID: **`VozCheck/Moderation`** · Title: **VozCheck AI Moderation**

---

## What it does

When a user posts a **new thread** or a **reply/comment**, this add-on:

1. Intercepts the save **after** the post row is written (so it has a real
   `post_id`), without any polling.
2. Sends the post content to the **VozCheck** moderation backend over HTTP.
3. Enforces the returned verdict:
   - **reject / should_hide** → holds the post for approval (default) or
     soft-deletes it,
   - **should_notify** → sends the offending user a XenForo alert with the
     backend's `message_to_user`,
   - **allow** → does nothing.
4. Is **fail-open by default**: if the backend is unreachable or errors, the
   post is allowed through and the error is logged. An admin option can flip
   this to **fail-closed** (hold the post when the backend is down).

Staff/admin posts are skipped by default, and super-admin posts are always
skipped (so the "bot/admin" account is never moderated).

---

## How it hooks in (design)

It uses a **code event listener** on `entity_post_save`, hinted to the
`XF\Entity\Post` entity, rather than extending the Thread/Post services.

Why this approach:

- **One hook covers everything.** Threads, replies, and posts created by any
  code path (inline mod tools, the REST API, imports) all flow through
  `XF:Post` saving, so a single listener handles them uniformly. Extending
  `XF\Service\Thread\Creator` + `XF\Service\Thread\Replier` would require
  multiple class extensions and still miss some paths.
- **It fires after insert**, so the post already has its auto-increment
  `post_id` (needed for the backend payload and for targeting alerts), and we
  can use `$entity->isInsert()` to moderate **only brand-new** posts, never
  edits or our own enforcement re-saves.
- **It's decoupled** from XenForo service internals, shrinking the surface that
  can break across XF point releases.

A static, per-request re-entrancy guard (`Listener::$processing`, keyed by
`post_id`) prevents an infinite loop when our enforcement code saves the post
again (which re-fires `entity_post_save`).

> If you prefer the service-extension approach instead, the cleanest equivalents
> are class extensions on `XF\Service\Thread\Creator::afterInsert()` and
> `XF\Service\Thread\Replier::afterInsert()` wired via
> `_data/class_extensions.xml`. This add-on intentionally ships the listener
> approach only.

---

## File tree

```
voz-check/xenforo-addon/
├── README.md                                  ← this file
└── src/
    └── addons/
        └── VozCheck/
            └── Moderation/
                ├── addon.json                 ← add-on metadata
                ├── Setup.php                  ← install/upgrade/uninstall (no DB tables)
                ├── Listener.php               ← interception + enforcement logic
                ├── Service/
                │   └── Client.php             ← backend HTTP client: login, token cache, moderate
                ├── Exception/
                │   ├── BackendException.php    ← transport/parse/non-2xx failures
                │   └── AuthException.php       ← 401 → triggers single re-login + retry
                ├── install/
                │   └── NOTES.md               ← operator quick checklist
                └── _data/
                    ├── option_groups.xml      ← the "vozCheck" option group
                    ├── options.xml            ← all admin options
                    ├── code_event_listeners.xml ← entity_post_save → Listener
                    └── phrases.xml            ← option labels/explains + alert phrase
```

---

## Install

1. **Copy the files.** Put the contents of
   `src/addons/VozCheck/Moderation/` into your forum at
   `<xenforo-root>/src/addons/VozCheck/Moderation/`, so that
   `addon.json` lands at
   `<root>/src/addons/VozCheck/Moderation/addon.json`.

2. **Install via AdminCP.** AdminCP → **Add-ons** → **VozCheck AI Moderation**
   → **Install**. This imports the `_data/*.xml` files (options, option group,
   code event listener, phrases) and runs `Setup.php` (a no-op — there are no
   custom database tables).

   *CLI alternative (dev installs):*
   ```bash
   php cmd.php xf:addon-install VozCheck/Moderation
   # while iterating on the _data XML during development:
   php cmd.php xf-dev:import --addon VozCheck/Moderation
   ```

3. **Configure.** AdminCP → **Setup → Options → VozCheck AI Moderation**:

   | Option | Key | Default | Meaning |
   |---|---|---|---|
   | Enable VozCheck moderation | `vozCheckEnabled` | Off | Master switch |
   | Backend URL | `vozCheckBackendUrl` | `https://voz-check.9bricks.com` | Base URL (trailing slash stripped) |
   | Ingest API key | `vozCheckIngestKey` | *(empty)* | Secret used for the login handshake |
   | Hide mode for violations | `vozCheckHideMode` | `moderated` | `moderated` (hold) or `deleted` (soft-delete) |
   | Skip staff | `vozCheckSkipStaff` | On | Skip moderators/admins/staff |
   | Fail closed | `vozCheckFailClosed` | Off | Hold posts when the backend is down |

4. Turn **Enable VozCheck moderation** ON. Rebuild caches if prompted.

---

## Token handshake (login → cache → reuse)

The backend uses a bearer token obtained from an ingest key.

```
                         ┌────────────────────────────────────────────┐
  new post saved         │  Service\Client                            │
  ──────────────────────▶│                                            │
                         │  getToken():                               │
                         │    cached & not expired?  ── yes ──▶ reuse │
                         │            │ no                            │
                         │            ▼                               │
                         │  POST {backendUrl}/api/ingest/login        │
                         │       body {"api_key": "<ingestKey>"}      │
                         │  ◀── {"token":"...","expires_in_days":7}   │
                         │  store {token, expires} in XF registry     │
                         │                                            │
                         │  POST {backendUrl}/api/ingest/moderate     │
                         │       Authorization: Bearer <token>        │
                         │  ── 401? ──▶ forget token, re-login once,  │
                         │              retry exactly once            │
                         └────────────────────────────────────────────┘
```

- The token is cached in XenForo's **registry**
  (`\XF::registry()`, key `vozCheckToken`), which is an in-memory + DB-backed
  cache shared across requests/processes.
- We store an **absolute expiry** computed from `expires_in_days`, minus a
  1-hour safety margin, so we refresh proactively before the backend would
  reject the token.
- On a **401** from `/api/ingest/moderate`, the client forgets the cached token,
  logs in again **once**, and retries the moderate call a single time.
- Network timeout is **5 seconds** (connect + total) on every call, using
  XenForo's shared Guzzle client (`\XF::app()->http()->client()`), so a slow or
  dead backend can never block a user's post.

---

## Backend ingest contract (how fields map)

**Login** — `POST {backendUrl}/api/ingest/login`

```json
{ "api_key": "<vozCheckIngestKey>" }
```
→
```json
{ "token": "<bearer>", "expires_in_days": 7 }
```

**Moderate** — `POST {backendUrl}/api/ingest/moderate`
(header `Authorization: Bearer <token>`)

```json
{
  "platform": "xenforo",
  "post_id": 123,
  "thread_id": 45,
  "thread_title": "...",
  "author_id": 67,
  "author_username": "...",
  "content": "<raw message bbcode/text>",
  "type": "thread"
}
```

| Payload field | Source in add-on |
|---|---|
| `platform` | constant `"xenforo"` |
| `post_id` | `$post->post_id` |
| `thread_id` | `$post->Thread->thread_id` |
| `thread_title` | `$post->Thread->title` |
| `author_id` | `$post->user_id` |
| `author_username` | `$post->username` |
| `content` | `$post->message` (raw stored BBCode/text) |
| `type` | `"thread"` if it is the thread's first post, else `"comment"` |

**Verdict** (response):

```json
{
  "violation": true, "confidence": 88, "severity": "high",
  "reason": "...", "message_to_user": "...",
  "action": "reject|flag|allow",
  "should_hide": true, "should_notify": true
}
```

| Verdict field | Effect in add-on |
|---|---|
| `action === "reject"` **or** `should_hide === true` | Hide the post (per `vozCheckHideMode`) |
| `should_notify === true` (+ non-empty `message_to_user`) | Send the author a XenForo alert |
| `action === "allow"` | Do nothing |
| `action === "flag"` | Currently **notify-only** (no hide). Adjust `Listener::enforce()` if your backend expects `flag` to also hold the post. |

`violation`, `confidence`, `severity`, `reason` are received but not currently
acted on beyond the above; they're available for future use/logging.

---

## Enforcement details

- **Hold for approval (`hideMode = moderated`, default):** the post's
  `message_state` becomes `moderated` (moderation queue). Fully reversible — a
  moderator approves it. This is the recommended, least-destructive mode.
- **Soft-delete (`hideMode = deleted`):** done via XenForo's
  `XF\Service\Post\Deleter` service with mode `soft` and the reason
  `"VozCheck: vi phạm nội quy"`. The service writes the reason to
  `xf_deletion_log` and updates denormalised counters. Still reversible (soft,
  not hard, delete). We use the **service** rather than mutating the entity
  directly precisely because there is **no `delete_reason` column on the Post
  entity** and raw mutation does not log a reason or reliably fix counters.
- **Alerts:** sent through `XF\Repository\UserAlert::alert(...)` with content
  type `post` and action `vozCheck_moderation`, rendered from the phrase
  `alert_post_vozCheck_moderation` using the `{$extra.message}` token.

---

## Fail-open vs fail-closed

| Situation | `failClosed = false` (default) | `failClosed = true` |
|---|---|---|
| Backend unreachable / errors / not configured | Post allowed through, error logged | Post **held for approval**, error logged |
| Backend returns a verdict | Verdict enforced | Verdict enforced |

The listener also wraps **all** of its own logic in a try/catch so that an
unexpected add-on error can never block the user's post (it's logged and
swallowed, independent of the fail policy, which governs *backend* errors only).

---

## BETA caveats & what to verify on a live instance

This code follows documented XenForo 2.2+ conventions, but the following are
**version-sensitive** and were **not** run against a live forum. Verify each on a
real XF 2.2/2.3 instance before production:

1. **`entity_post_save` callback signature & `hint`.**
   Confirm the listener is invoked as `entityPostSave(\XF\Mvc\Entity\Entity $entity)`
   and that the `hint="XF\Entity\Post"` in
   `_data/code_event_listeners.xml` filters correctly so it only fires for
   `XF:Post`. (Defensive `instanceof Post` check is already in place.)

2. **`message_state` transitions & denormalised counters.**
   Confirm that holding a post (`message_state = 'moderated'` via entity save in
   `holdPostForApproval()`) correctly updates the **thread reply count**, the
   **moderation queue**, and **user post counts**. Direct entity mutation is
   *not* guaranteed to fix all counters across XF versions. If counters drift,
   switch this path to the appropriate approval/visibility service for your XF
   version, or run AdminCP → Tools → **Rebuild caches** (thread/user counters).

3. **`XF\Service\Post\Deleter` usage.**
   Confirm `\XF::service('XF:Post\Deleter', $post)->delete('soft', $reason)` is
   the correct constructor/argument shape for your XF version and that it logs
   the reason to `xf_deletion_log` and updates counters.

4. **`XF\Repository\UserAlert::alert(...)` signature.**
   Confirm the exact parameter order
   `(User $user, int $fromUserId, string $fromUsername, string $contentType, int $contentId, string $action, array $extraData = [], array $options = [])`
   and that an alert with content type `post` + action `vozCheck_moderation`
   resolves the phrase `alert_post_vozCheck_moderation` and exposes the
   `{$extra.message}` token. Some setups also require an **alert template**, not
   just a phrase — check AdminCP after a test and adjust if the alert renders
   blank. (`alertFromUser()` is an alternative if you prefer passing a User.)

5. **`message` content size & encoding.**
   `$post->message` is raw BBCode/text. Confirm the backend accepts large bodies
   within the 5 s timeout; consider truncation server-side if needed.

6. **Options XML import.**
   Confirm the `radio` `edit_format_params` (`key={{ phrase ... }}` lines) renders
   the two hide-mode choices correctly, and that `option.<id>` /
   `option_explain.<id>` phrases resolve as labels/explanations in the option
   editor.

7. **Registry cache behaviour.**
   Confirm `\XF::registry()->set()/get()/delete()` persists the token across
   requests on your deployment (it should; it's the standard global registry).
   If you run a multi-server setup with an external cache, confirm the registry
   is shared as expected.

8. **First-post detection.**
   `type` is `thread` when `$thread->first_post_id == $post->post_id`. On very
   fast first-post saves, confirm `first_post_id` is populated by the time
   `entity_post_save` fires for the first post; if not, treat the thread's
   initial post detection via `$post->position == 0` as a fallback.

If you confirm all of the above, this add-on is production-ready; until then,
treat it as **BETA**.

---

## License / support

Internal 9bricks add-on. Support: https://voz-check.9bricks.com
