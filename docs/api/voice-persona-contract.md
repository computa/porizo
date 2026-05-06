# Voice Persona API Contract

## Render Responses

`POST /tracks/:id/versions/:version/render_preview` and `POST /tracks/:id/versions/:version/render_full` may include:

- `user_voice_engine`: `"suno_voice_persona"` when a `user_voice` render is backed by a Suno voice persona; otherwise `null`.

## Voice Profile

`GET /voice/profile` returns:

- `model_version`: `"embed_stub"` when local voice embedding was skipped, or the configured embedding model version when embedding ran.
- `local_voice_ready`: boolean. True when Porizo has a completed local voice profile.
- `my_voice_ready`: boolean. True only when the user can render with My Voice through the active Suno persona path.
- `voice_provider_profile`: optional object with `provider`, `status`, `ready`, `id`, and `provider_profile_id`.

`voice_provider_profile.status` is a closed enum:

- `pending`
- `upload_submitted`
- `cover_submitted`
- `persona_submitted`
- `active`
- `failed`
- `cancelled`
- `manual_cleanup_required`
- `deleted`
- `consent_required`
- `source_audio_unavailable`

Older iOS clients may receive `status: "preparing"` for the top-level profile status until the Suno persona is ready, even when the local voice profile is active.

## Persona Recovery Errors

Persona-readiness failures use HTTP `422`. Error payloads may include optional `requires_voice_enrollment: true` as a client recovery hint. Treat absence of the field as `false`.
