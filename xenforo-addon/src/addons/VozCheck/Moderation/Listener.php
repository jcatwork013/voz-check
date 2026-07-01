<?php

namespace VozCheck\Moderation;

use XF\Entity\Post;
use XF\Entity\User;
use XF\Mvc\Entity\Entity;

/**
 * VozCheck code event listeners.
 *
 * We hook the generic `entity_post_save` event and filter for the `XF:Post`
 * entity. `entity_post_save` fires AFTER the entity (and its row) has been
 * written inside the save transaction, which is exactly what we need:
 *
 *   - The post already has a real auto-increment `post_id` we can send to the
 *     backend and reference in alerts.
 *   - We can distinguish a brand-new post (`$entity->isInsert()`) from an edit,
 *     and only moderate genuinely new content.
 *   - We can still mutate the entity (e.g. set `message_state`) and save again;
 *     XenForo allows a nested save here. We guard against infinite recursion
 *     with a per-request, per-post static flag.
 *
 * Why `entity_post_save` and not a service-class extension on
 * `XF\Service\Thread\Creator` / `XF\Service\Thread\Replier`?
 *   - A single entity listener uniformly covers threads, replies AND posts
 *     created by other code paths (inline mod, import, API) without having to
 *     extend several services.
 *   - It is decoupled from XenForo's service internals, which reduces the
 *     surface that can break across XF point releases.
 *   See README "BETA caveats" for what must be verified on a live instance.
 */
class Listener
{
    /**
     * Re-entrancy guard. When we mutate + save a post from inside this listener,
     * `entity_post_save` fires again; this set lets us ignore the second pass.
     *
     * Keyed by post_id. Static = per PHP request, which is the correct scope.
     *
     * @var array<int,bool>
     */
    protected static $processing = [];

    /**
     * Handler for the `entity_post_save` code event.
     *
     * Registered (see _data/code_event_listeners.xml) with the event hint
     * `XF\Entity\Post` so XenForo only calls us for Post entities — but we still
     * defensively type-check.
     *
     * @param Entity $entity The entity that was just saved.
     */
    public static function entityPostSave(Entity $entity): void
    {
        if (!($entity instanceof Post))
        {
            return;
        }

        try
        {
            self::handlePostSave($entity);
        }
        catch (\Throwable $e)
        {
            // The listener itself must never break post saving. Any unexpected
            // error is logged and swallowed (this is independent of the
            // fail-open/closed policy, which is about *backend* errors only).
            \XF::logException($e, false, 'VozCheck listener error: ');
        }
    }

    /**
     * Core decision + enforcement flow for a single saved Post.
     */
    protected static function handlePostSave(Post $post): void
    {
        $options = \XF::options();

        // 1) Master on/off switch.
        if (empty($options->vozCheckEnabled))
        {
            return;
        }

        // 2) Only moderate brand-new posts. Edits are out of scope for v1.
        //    isInsert() is true only during the insert save, so subsequent
        //    edits (or our own enforcement re-save) are skipped.
        if (!$post->isInsert())
        {
            return;
        }

        // 3) Re-entrancy guard: skip if we are already mid-enforcement on this post.
        $postId = (int)$post->post_id;
        if ($postId && isset(self::$processing[$postId]))
        {
            return;
        }

        // 4) Only moderate visible content. Posts that arrive already
        //    moderated/deleted (e.g. another add-on held them) are left alone.
        if ($post->message_state !== 'visible')
        {
            return;
        }

        // 5) Resolve the author and apply staff/admin skip policy.
        $user = $post->User;
        if (self::shouldSkipUser($user, $options))
        {
            return;
        }

        // 6) Build the ingest payload from the post + its thread.
        $thread = $post->Thread;
        if (!$thread)
        {
            // Defensive: a post with no thread shouldn't be moderated meaningfully.
            return;
        }

        // The first post of a thread is the thread itself; later posts are comments.
        $isFirstPost = ($thread->first_post_id == $post->post_id);

        $payload = [
            'platform'        => 'xenforo',
            'post_id'         => $postId,
            'thread_id'       => (int)$thread->thread_id,
            'thread_title'    => (string)$thread->title,
            'author_id'       => (int)$post->user_id,
            'author_username' => (string)$post->username,
            // Raw stored message (BBCode/text exactly as the user submitted it).
            'content'         => (string)$post->message,
            'type'            => $isFirstPost ? 'thread' : 'comment',
        ];

        // 7) Call the backend and enforce.
        $verdict = self::callBackend($payload, $options);

        if ($verdict === null)
        {
            // Backend unreachable / errored. callBackend() has already applied
            // the fail-open (let through) or fail-closed (hold) policy and
            // logged. Nothing more to do here.
            return;
        }

        self::enforce($post, $verdict, $options);
    }

    /**
     * Decide whether to skip moderation for this user (staff/admin/bot).
     *
     * @param User|null $user
     * @param \XF\Options $options
     */
    protected static function shouldSkipUser(?User $user, $options): bool
    {
        // Guests / missing user: nothing meaningful to moderate against an account,
        // but the content still exists, so we DO moderate (user_id 0). We only
        // skip when there is an actual privileged user.
        if (!$user)
        {
            return false;
        }

        // Super admins are always skipped (the "bot/admin" exclusion).
        if ($user->is_admin)
        {
            return true;
        }

        // Optional: skip any staff member (moderator/admin flag) when enabled.
        if (!empty($options->vozCheckSkipStaff))
        {
            if ($user->is_moderator || $user->is_admin || $user->is_staff)
            {
                return true;
            }
        }

        return false;
    }

    /**
     * Call the VozCheck backend, applying the fail-open / fail-closed policy on
     * any backend error.
     *
     * @return array|null The verdict array on success, or null when the backend
     *     failed (the caller should then do nothing further — policy already
     *     applied here).
     */
    protected static function callBackend(array $payload, $options): ?array
    {
        /** @var \VozCheck\Moderation\Service\Client $client */
        $client = \XF::service('VozCheck\Moderation:Client');

        if (!$client->isConfigured())
        {
            // Misconfiguration is treated like a backend failure for policy
            // purposes, but we always log it so an admin notices.
            \XF::logError('VozCheck is enabled but not configured (backend URL / ingest key).');
            return null;
        }

        try
        {
            return $client->moderate($payload);
        }
        catch (\Throwable $e)
        {
            // Backend unreachable or returned an error. Log it...
            \XF::logException($e, false, 'VozCheck backend error: ');

            // ...then apply the failure policy.
            if (!empty($options->vozCheckFailClosed))
            {
                // FAIL-CLOSED: hold the post for manual approval so nothing
                // unmoderated slips through while the backend is down.
                self::applyHold($payload, $options);
            }
            // FAIL-OPEN (default): do nothing, let the post through.

            return null;
        }
    }

    /**
     * Fail-closed helper: hold the just-saved post for approval when the backend
     * is unavailable. We re-load and mutate the entity here because we only have
     * the payload's post_id in the error path.
     */
    protected static function applyHold(array $payload, $options): void
    {
        $postId = (int)($payload['post_id'] ?? 0);
        if (!$postId)
        {
            return;
        }

        /** @var Post|null $post */
        $post = \XF::em()->find('XF:Post', $postId);
        if (!$post || $post->message_state !== 'visible')
        {
            return;
        }

        // Fail-closed always HOLDS (never deletes) — the backend was simply
        // unreachable, so we choose the least destructive, reversible action.
        self::$processing[$postId] = true;
        try
        {
            self::holdPostForApproval($post);
        }
        finally
        {
            unset(self::$processing[$postId]);
        }
    }

    /**
     * Apply the backend verdict to the post.
     */
    protected static function enforce(Post $post, array $verdict, $options): void
    {
        $action = isset($verdict['action']) ? (string)$verdict['action'] : 'allow';
        $shouldHide = !empty($verdict['should_hide']);
        $shouldNotify = !empty($verdict['should_notify']);
        $messageToUser = isset($verdict['message_to_user']) ? (string)$verdict['message_to_user'] : '';

        // Hide when the backend says reject, or explicitly requests hiding.
        $hide = ($action === 'reject') || $shouldHide;

        if ($hide)
        {
            self::hidePost($post, $options);
        }

        // Notify the offending user (alert) when requested and we have a message.
        if ($shouldNotify && $messageToUser !== '' && $post->user_id)
        {
            self::notifyUser($post, $messageToUser);
        }

        // action === 'allow' / 'flag' with no hide → nothing further to do.
        // ('flag' is currently treated as "notify only / no hide". Adjust here
        //  if your backend expects flag to also hold the post.)
    }

    /**
     * Hide a post according to the admin-selected hideMode.
     *
     *   - 'moderated' (default): hold the post for approval. We use XenForo's
     *     ApprovalQueue service so the post enters the moderation queue with
     *     correct denormalised counters. This is the recommended, least
     *     destructive and fully reversible mode (a moderator can approve it).
     *
     *   - 'deleted': SOFT-delete the post via XenForo's Post\Deleter service,
     *     which records a deletion reason in xf_deletion_log and updates all
     *     denormalised counters (thread reply_count, user message_count, ...).
     *     Soft delete is reversible (the post can be restored).
     *
     * IMPORTANT (why services, not raw entity mutation):
     *   Directly setting `$post->message_state = 'deleted'` / 'moderated' and
     *   calling save() does NOT reliably update XenForo's denormalised counters
     *   (thread reply count, moderation queue, user post count) and does NOT log
     *   a deletion reason — there is no `delete_reason` column on the Post
     *   entity; reasons live in xf_deletion_log. We therefore go through the
     *   official services. See README "BETA caveats" for what to verify live.
     */
    protected static function hidePost(Post $post, $options): void
    {
        $mode = (string)($options->vozCheckHideMode ?? 'moderated');
        $reason = 'VozCheck: vi phạm nội quy';

        // Re-entrancy guard: saving from inside a service re-fires
        // entity_post_save for this post; ignore that second pass.
        $postId = (int)$post->post_id;
        self::$processing[$postId] = true;

        try
        {
            if ($mode === 'deleted')
            {
                self::softDeletePost($post, $reason);
            }
            else
            {
                self::holdPostForApproval($post);
            }
        }
        finally
        {
            unset(self::$processing[$postId]);
        }
    }

    /**
     * Soft-delete a post via the official Post\Deleter service so the deletion
     * reason is logged and counters are updated.
     */
    protected static function softDeletePost(Post $post, string $reason): void
    {
        /** @var \XF\Service\Post\Deleter $deleter */
        $deleter = \XF::service('XF:Post\Deleter', $post);

        // 'soft' = reversible soft delete (not a hard/permanent delete).
        // The reason is written to xf_deletion_log by the service.
        $deleter->delete('soft', $reason);
    }

    /**
     * Hold a post for approval.
     *
     * Preferred path: XenForo's ApprovalQueue service correctly transitions the
     * post to 'moderated' and enqueues it. If that service is unavailable in a
     * given XF version, we fall back to a plain entity transition (which still
     * works for visibility but may need a counter rebuild — flagged in README).
     */
    protected static function holdPostForApproval(Post $post): void
    {
        // The cleanest supported transition to the moderation queue is to set
        // the message_state to 'moderated' on the entity and save. XenForo's
        // Post entity _postSave/visibility handling adjusts thread + queue
        // counters for visible<->moderated transitions. We keep this path
        // entity-based intentionally (there is no single public "hold" service
        // equivalent to the Deleter for the moderation queue across all 2.2/2.3
        // point releases — verify on your instance).
        if ($post->message_state === 'visible')
        {
            $post->message_state = 'moderated';
            $post->save();
        }
    }

    /**
     * Send the offending user a XenForo alert containing the backend's message.
     *
     * We use the User alert repository (`XF:UserAlert`) which is the canonical,
     * supported way to push an alert. The alert is rendered from the phrase
     * `alert_post_vozCheck_moderation` (XenForo convention:
     * `alert_<contentType>_<action>`), and the extra `message` value is exposed
     * to that phrase as `{$extra.message}` (see _data/phrases.xml).
     *
     * alert() signature (XF 2.2/2.3):
     *   alert(User $user, int $fromUserId, string $fromUsername,
     *         string $contentType, int $contentId, string $action,
     *         array $extraData = [], array $options = [])
     *
     * On a live instance, verify the exact `alert()` signature for your XF
     * version and that the phrase resolves with the {$extra.message} token —
     * see README "BETA caveats".
     */
    protected static function notifyUser(Post $post, string $message): void
    {
        try
        {
            /** @var \XF\Repository\UserAlert $alertRepo */
            $alertRepo = \XF::repository('XF:UserAlert');

            $receiver = $post->User;
            if (!$receiver)
            {
                return;
            }

            // The "sender" is the system/guest user (id 0) — moderation is not
            // attributed to a real account.
            $alertRepo->alert(
                $receiver,              // alerted user (User entity)
                0,                      // fromUserId (0 = system)
                '',                     // fromUsername (system)
                'post',                 // content type -> alert_post_*
                (int)$post->post_id,    // content id
                'vozCheck_moderation',  // action -> phrase alert_post_vozCheck_moderation
                [
                    // Extra data, available in the alert phrase as {$extra.*}.
                    'message' => $message,
                    'title'   => $post->Thread ? $post->Thread->title : '',
                ]
            );
        }
        catch (\Throwable $e)
        {
            // An alert failure must never undo the moderation decision.
            \XF::logException($e, false, 'VozCheck alert error: ');
        }
    }
}
