# API Error Envelope

The current public HTTP error envelope is a flat object:

```json
{
  "error": "machine_readable_error",
  "message": "Human-readable message"
}
```

Endpoint-specific top-level fields may exist for already-shipped contracts. New
endpoints must not add undocumented top-level error fields.

A nested versioned envelope such as `{ "error": { "code": "...", "message": "...", "details": {} } }`
is a future client-coordinated migration and is not part of this refactor.

The `E1xx` / `R2xx` / `B3xx` / `S5xx` taxonomy is an internal planning
taxonomy only. It is not the current wire contract.
