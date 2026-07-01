<?php

namespace VozCheck\Moderation\Service;

use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\Exception\GuzzleException;
use Psr\Http\Message\ResponseInterface;
use XF\Service\AbstractService;

/**
 * VozCheck backend HTTP client.
 *
 * Responsibilities:
 *   1. Authenticate against the VozCheck ingest API (login handshake) and
 *      CACHE the returned bearer token in XenForo's registry so it is reused
 *      across requests (and across PHP processes) until it expires.
 *   2. Send post content to the `/api/ingest/moderate` endpoint and return the
 *      decoded verdict.
 *   3. Transparently re-authenticate ONCE on a 401 from the moderate call, then
 *      retry, so an expired/rotated token never causes a spurious failure.
 *
 * Design notes:
 *   - We use XenForo's shared HTTP client (`\XF::app()->http()->client()`),
 *     which is a configured Guzzle client. We pass a short timeout so a slow or
 *     dead backend can never block a user's post indefinitely.
 *   - The token is stored in the global registry (cached in memory + the
 *     `xf_registry` table) under a single key. We persist both the token and an
 *     absolute expiry timestamp, derived from the `expires_in_days` field
 *     returned by the login endpoint (with a safety margin).
 *   - This service NEVER throws for "violation" results — a violation is a
 *     normal, expected outcome and is returned as data. It DOES throw
 *     (\VozCheck\Moderation\Exception\BackendException) for transport/auth/parse
 *     failures so the caller can implement the fail-open / fail-closed policy.
 */
class Client extends AbstractService
{
    /**
     * Registry key under which the cached token payload is stored.
     * The payload shape is: ['token' => string, 'expires' => int (unix ts)].
     */
    public const REGISTRY_KEY = 'vozCheckToken';

    /**
     * Network timeout for every backend call, in seconds. Deliberately short:
     * moderation must not be allowed to stall the post-save request.
     */
    public const HTTP_TIMEOUT = 5.0;

    /**
     * Safety margin (in seconds) subtracted from the real token expiry so we
     * proactively refresh before the backend would reject the token. 1 hour.
     */
    protected const EXPIRY_MARGIN = 3600;

    /**
     * The backend base URL, e.g. "https://voz-check.9bricks.com" (no trailing slash).
     *
     * @var string
     */
    protected $backendUrl;

    /**
     * The ingest API key used for the login handshake.
     *
     * @var string
     */
    protected $ingestKey;

    /**
     * Initialise from admin options. We read from the live options registry so a
     * trailing slash in the configured URL is normalised away once, here.
     */
    protected function setup(): void
    {
        $options = $this->app->options();

        $this->backendUrl = rtrim((string)($options->vozCheckBackendUrl ?? ''), '/');
        $this->ingestKey = trim((string)($options->vozCheckIngestKey ?? ''));
    }

    /**
     * True only when both the backend URL and ingest key are configured.
     * The listener uses this to decide whether moderation is even possible.
     */
    public function isConfigured(): bool
    {
        return $this->backendUrl !== '' && $this->ingestKey !== '';
    }

    /**
     * Send a post to the VozCheck moderation endpoint and return the decoded verdict.
     *
     * @param array $payload The ingest contract body. Expected keys:
     *     platform, post_id, thread_id, thread_title, author_id, author_username,
     *     content, type. See README for the full contract.
     *
     * @return array Decoded JSON verdict, e.g.:
     *     [
     *       'violation' => bool, 'confidence' => int, 'severity' => string,
     *       'reason' => string, 'message_to_user' => string,
     *       'action' => 'reject'|'flag'|'allow',
     *       'should_hide' => bool, 'should_notify' => bool,
     *     ]
     *
     * @throws \VozCheck\Moderation\Exception\BackendException on any transport,
     *     auth or parse failure. The caller decides fail-open vs fail-closed.
     */
    public function moderate(array $payload): array
    {
        if (!$this->isConfigured())
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck is not configured (missing backend URL or ingest key).'
            );
        }

        // First attempt with whatever token we have (logging in if necessary).
        $token = $this->getToken();

        try
        {
            return $this->doModerate($payload, $token);
        }
        catch (\VozCheck\Moderation\Exception\AuthException $e)
        {
            // 401: token is stale/rotated. Force a fresh login exactly once, retry.
            $this->forgetToken();
            $token = $this->getToken(true);

            return $this->doModerate($payload, $token);
        }
    }

    /**
     * Perform the actual POST to /api/ingest/moderate with a bearer token.
     *
     * @throws \VozCheck\Moderation\Exception\AuthException on HTTP 401 (so the
     *     caller can retry after re-login).
     * @throws \VozCheck\Moderation\Exception\BackendException on any other failure.
     */
    protected function doModerate(array $payload, string $token): array
    {
        $url = $this->backendUrl . '/api/ingest/moderate';

        try
        {
            $response = $this->client()->post($url, [
                'headers' => [
                    'Authorization' => 'Bearer ' . $token,
                    'Accept'        => 'application/json',
                ],
                'json'            => $payload,
                'timeout'         => self::HTTP_TIMEOUT,
                'connect_timeout' => self::HTTP_TIMEOUT,
                // Do not let Guzzle throw on non-2xx; we inspect the status ourselves
                // so we can distinguish 401 (retryable) from everything else.
                'http_errors'     => false,
            ]);
        }
        catch (RequestException $e)
        {
            // Network-level failure (timeout, DNS, connection refused, ...).
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck moderate request failed: ' . $e->getMessage(), 0, $e
            );
        }
        catch (GuzzleException $e)
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck moderate request error: ' . $e->getMessage(), 0, $e
            );
        }

        $status = $response->getStatusCode();

        if ($status === 401)
        {
            throw new \VozCheck\Moderation\Exception\AuthException(
                'VozCheck moderate returned 401 Unauthorized.'
            );
        }

        if ($status < 200 || $status >= 300)
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck moderate returned HTTP ' . $status . ': '
                . $this->snippet($response)
            );
        }

        return $this->decodeJson($response);
    }

    /**
     * Get a valid bearer token, logging in if there is no cached/valid one.
     *
     * @param bool $forceLogin When true, ignore any cached token and log in fresh.
     *
     * @throws \VozCheck\Moderation\Exception\BackendException if login fails.
     */
    public function getToken(bool $forceLogin = false): string
    {
        if (!$forceLogin)
        {
            $cached = $this->readCachedToken();
            if ($cached !== null)
            {
                return $cached;
            }
        }

        return $this->login();
    }

    /**
     * Read a still-valid token from the registry cache, or null if absent/expired.
     */
    protected function readCachedToken(): ?string
    {
        $data = \XF::registry()->get(self::REGISTRY_KEY);

        if (!is_array($data) || empty($data['token']) || empty($data['expires']))
        {
            return null;
        }

        if ($data['expires'] <= \XF::$time)
        {
            // Expired (with margin already baked into the stored value).
            return null;
        }

        return (string)$data['token'];
    }

    /**
     * Perform the login handshake, cache and return the token.
     *
     * POST {backendUrl}/api/ingest/login  body: {"api_key": "<ingestKey>"}
     * Expected response: {"token": "...", "expires_in_days": 7}
     *
     * @throws \VozCheck\Moderation\Exception\BackendException on failure.
     */
    protected function login(): string
    {
        $url = $this->backendUrl . '/api/ingest/login';

        try
        {
            $response = $this->client()->post($url, [
                'headers' => [
                    'Accept' => 'application/json',
                ],
                'json'            => ['api_key' => $this->ingestKey],
                'timeout'         => self::HTTP_TIMEOUT,
                'connect_timeout' => self::HTTP_TIMEOUT,
                'http_errors'     => false,
            ]);
        }
        catch (GuzzleException $e)
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck login request failed: ' . $e->getMessage(), 0, $e
            );
        }

        $status = $response->getStatusCode();
        if ($status < 200 || $status >= 300)
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck login returned HTTP ' . $status . ': ' . $this->snippet($response)
            );
        }

        $data = $this->decodeJson($response);

        if (empty($data['token']) || !is_string($data['token']))
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck login response did not contain a token.'
            );
        }

        $token = $data['token'];

        // Compute an absolute expiry. Default to 7 days if the field is missing
        // or invalid, then subtract a safety margin so we refresh proactively.
        $days = isset($data['expires_in_days']) ? (int)$data['expires_in_days'] : 7;
        if ($days < 1)
        {
            $days = 7;
        }
        $expires = \XF::$time + ($days * 86400) - self::EXPIRY_MARGIN;

        $this->writeCachedToken($token, $expires);

        return $token;
    }

    /**
     * Persist the token + absolute expiry into the registry cache.
     */
    protected function writeCachedToken(string $token, int $expires): void
    {
        \XF::registry()->set(self::REGISTRY_KEY, [
            'token'   => $token,
            'expires' => $expires,
        ]);
    }

    /**
     * Drop the cached token (used after a 401 before re-login).
     */
    public function forgetToken(): void
    {
        \XF::registry()->delete(self::REGISTRY_KEY);
    }

    /**
     * Decode a JSON response body into an associative array.
     *
     * @throws \VozCheck\Moderation\Exception\BackendException on invalid JSON.
     */
    protected function decodeJson(ResponseInterface $response): array
    {
        $body = (string)$response->getBody();
        $decoded = json_decode($body, true);

        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded))
        {
            throw new \VozCheck\Moderation\Exception\BackendException(
                'VozCheck returned invalid JSON: ' . json_last_error_msg()
            );
        }

        return $decoded;
    }

    /**
     * A short, safe snippet of a response body for error messages/logs.
     */
    protected function snippet(ResponseInterface $response): string
    {
        $body = (string)$response->getBody();

        return mb_substr($body, 0, 300);
    }

    /**
     * The shared XenForo Guzzle HTTP client.
     *
     * @return \GuzzleHttp\Client
     */
    protected function client()
    {
        return $this->app->http()->client();
    }
}
