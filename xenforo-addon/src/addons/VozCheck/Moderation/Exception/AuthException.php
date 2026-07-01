<?php

namespace VozCheck\Moderation\Exception;

/**
 * Thrown specifically when the backend responds with HTTP 401 to a moderate
 * call. The Client catches this internally to trigger a single re-login + retry.
 *
 * Extends BackendException so callers that only care about "the backend failed"
 * can catch the parent type and still handle it uniformly.
 */
class AuthException extends BackendException
{
}
