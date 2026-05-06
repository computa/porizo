# Internal Callbacks

## Suno Callback

`POST /internal/suno/callback` is an authenticated no-op observability hook for SunoAPI `callBackUrl` payloads.

The route verifies `SUNO_CALLBACK_HMAC_SECRET` before logging a redacted receipt and does not mutate application state. The configured callback URL may include a `token` query parameter generated from `SUNO_CALLBACK_HMAC_SECRET`; the secret must be at least 32 characters.

Any future change that uses this callback to update jobs or provider profiles must replace token fallback with provider-confirmed HMAC verification over the raw body, include a timestamp in the signed payload, reject stale timestamps, and dedupe replayed `(taskId, status)` events before writing state.
