<?php

namespace VozCheck\Moderation\Exception;

/**
 * Thrown for any transport / parse / non-2xx failure when talking to the
 * VozCheck backend (other than a 401, which uses AuthException).
 *
 * The listener catches this to apply the fail-open / fail-closed policy.
 */
class BackendException extends \RuntimeException
{
}
