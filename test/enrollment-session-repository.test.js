process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const {
  createEnrollmentSessionRepository,
} = require("../src/database/enrollment-session-repository");

let db;
let repository;

async function seedSessions() {
  const now = "2026-06-27T10:00:00.000Z";
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run("user_a", now);
  await db
    .prepare("INSERT INTO users (id, created_at, risk_level) VALUES (?, ?, 'low')")
    .run("user_b", now);

  const insertSession = db.prepare(
    `INSERT INTO enrollment_sessions (
      id, user_id, status, prompt_set_id, prompts_json, chunk_count,
      quality_metrics, started_at, expires_at, consent_version,
      consent_scopes, access_token
    ) VALUES (?, ?, 'completed', 'default', '[]', 0, '{}', ?, ?, ?, ?, ?)`,
  );
  await insertSession.run(
    "sess_a1",
    "user_a",
    now,
    now,
    "1.0",
    "voice_suno_persona_v1",
    "tok_a1",
  );
  await insertSession.run(
    "sess_a2",
    "user_a",
    now,
    now,
    "1.0",
    null,
    "tok_a2",
  );
  await insertSession.run(
    "sess_b1",
    "user_b",
    now,
    now,
    "1.0",
    null,
    "tok_b1",
  );
}

describe("EnrollmentSessionRepository", () => {
  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    repository = createEnrollmentSessionRepository(db);
    await seedSessions();
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("findTokenContextById returns provider token context columns", async () => {
    const row = await repository.findTokenContextById("sess_a1");

    assert.deepEqual(row, {
      id: "sess_a1",
      user_id: "user_a",
      access_token: "tok_a1",
      consent_version: "1.0",
      consent_scopes: "voice_suno_persona_v1",
    });
  });

  test("clearAccessTokenBySessionId only clears the target session", async () => {
    const result = await repository.clearAccessTokenBySessionId("sess_a1");
    assert.equal(result.changes, 1);

    assert.equal((await repository.findTokenContextById("sess_a1")).access_token, null);
    assert.equal((await repository.findTokenContextById("sess_a2")).access_token, "tok_a2");
    assert.equal((await repository.findTokenContextById("sess_b1")).access_token, "tok_b1");
  });

  test("clearAccessTokensByUserId clears only sessions for that user", async () => {
    const result = await repository.clearAccessTokensByUserId("user_a");
    assert.equal(result.changes, 2);

    assert.equal((await repository.findTokenContextById("sess_a1")).access_token, null);
    assert.equal((await repository.findTokenContextById("sess_a2")).access_token, null);
    assert.equal((await repository.findTokenContextById("sess_b1")).access_token, "tok_b1");
  });

  test("setAccessTokenBySessionId rotates one session token", async () => {
    const result = await repository.setAccessTokenBySessionId({
      sessionId: "sess_a1",
      accessToken: "tok_rotated",
    });
    assert.equal(result.changes, 1);

    assert.equal(
      (await repository.findTokenContextById("sess_a1")).access_token,
      "tok_rotated",
    );
    assert.equal((await repository.findTokenContextById("sess_a2")).access_token, "tok_a2");
  });

  test("createSession persists the lifecycle columns used by enrollment routes", async () => {
    const result = await repository.createSession({
      id: "sess_new",
      userId: "user_a",
      promptSetId: "default",
      promptsJson: '[{"id":"p1"}]',
      qualityMetricsJson: "{}",
      startedAt: "2026-06-27T10:01:00.000Z",
      expiresAt: "2026-06-27T10:31:00.000Z",
      consentVersion: "2.0",
      consentScopes: "voice_suno_persona_v1",
    });

    assert.equal(result.changes, 1);
    const row = await repository.findById("sess_new");
    assert.equal(row.user_id, "user_a");
    assert.equal(row.status, "recording");
    assert.equal(row.prompt_set_id, "default");
    assert.equal(row.prompts_json, '[{"id":"p1"}]');
    assert.equal(row.chunk_count, 0);
    assert.equal(row.quality_metrics, "{}");
    assert.equal(row.failure_reason, null);
    assert.equal(row.started_at, "2026-06-27T10:01:00.000Z");
    assert.equal(row.completed_at, null);
    assert.equal(row.expires_at, "2026-06-27T10:31:00.000Z");
    assert.equal(row.consent_version, "2.0");
    assert.equal(row.consent_scopes, "voice_suno_persona_v1");
  });

  test("claimForFinalization only claims owned open sessions", async () => {
    await repository.createSession({
      id: "sess_recording",
      userId: "user_a",
      promptSetId: "default",
      promptsJson: "[]",
      qualityMetricsJson: "{}",
      startedAt: "2026-06-27T10:02:00.000Z",
      expiresAt: "2026-06-27T10:32:00.000Z",
      consentVersion: "1.0",
    });

    assert.equal(
      (await repository.claimForFinalization({
        sessionId: "sess_recording",
        userId: "user_b",
      })).changes,
      0,
    );
    assert.equal((await repository.findById("sess_recording")).status, "recording");

    assert.equal(
      (await repository.claimForFinalization({
        sessionId: "sess_recording",
        userId: "user_a",
      })).changes,
      1,
    );
    assert.equal((await repository.findById("sess_recording")).status, "finalizing");

    assert.equal(
      (await repository.claimForFinalization({
        sessionId: "sess_recording",
        userId: "user_a",
      })).changes,
      0,
    );
  });

  test("status and metrics helpers update only the target session", async () => {
    await repository.markStatus({ sessionId: "sess_a1", status: "expired" });
    assert.equal((await repository.findById("sess_a1")).status, "expired");
    assert.equal((await repository.findById("sess_a2")).status, "completed");

    await repository.setQualityMetrics({
      sessionId: "sess_a1",
      qualityMetricsJson: '{"p1":{"accepted":false}}',
    });
    assert.equal(
      (await repository.findById("sess_a1")).quality_metrics,
      '{"p1":{"accepted":false}}',
    );

    await repository.incrementChunkCountAndSetQualityMetrics({
      sessionId: "sess_a2",
      status: "processing",
      qualityMetricsJson: '{"p1":{"accepted":true}}',
    });
    const row = await repository.findById("sess_a2");
    assert.equal(row.status, "processing");
    assert.equal(row.chunk_count, 1);
    assert.equal(row.quality_metrics, '{"p1":{"accepted":true}}');
  });

  test("setConsentScopesIfMissing preserves existing consent scopes", async () => {
    assert.equal(
      (await repository.setConsentScopesIfMissing({
        sessionId: "sess_a1",
        consentScopes: "new_scope",
      })).changes,
      0,
    );
    assert.equal(
      (await repository.findById("sess_a1")).consent_scopes,
      "voice_suno_persona_v1",
    );

    assert.equal(
      (await repository.setConsentScopesIfMissing({
        sessionId: "sess_a2",
        consentScopes: "voice_suno_persona_v1",
      })).changes,
      1,
    );
    assert.equal(
      (await repository.findById("sess_a2")).consent_scopes,
      "voice_suno_persona_v1",
    );
  });

  test("markCompletedStatus and setChunkQualityJson persist finalization data", async () => {
    await repository.markCompletedStatus({
      sessionId: "sess_a1",
      status: "failed_quality",
      completedAt: "2026-06-27T10:05:00.000Z",
    });
    await repository.setChunkQualityJson({
      sessionId: "sess_a1",
      chunkQualityJson: '[{"grade":"A"}]',
    });

    const row = await repository.findById("sess_a1");
    assert.equal(row.status, "failed_quality");
    assert.equal(row.completed_at, "2026-06-27T10:05:00.000Z");
    assert.equal(row.chunk_quality_json, '[{"grade":"A"}]');
  });

  test("voice profile completion helpers preserve route-owned row semantics", async () => {
    await repository.insertVoiceProfile({
      id: "vp_repo_active",
      userId: "user_a",
      status: "active",
      embeddingRef: "voice_profiles/user_a/vp_repo_active/embedding.bin",
      qualityScore: 91,
      qualityTier: "excellent",
      qualityMetricsJson: '{"average_score":91}',
      modelVersion: "embed_test",
      consentVersion: "2.0",
      consentAt: "2026-06-27T10:00:00.000Z",
      lastVerifiedAt: "2026-06-27T10:10:00.000Z",
      createdAt: "2026-06-27T10:10:00.000Z",
      elevenlabsVoiceId: "el_voice_repo",
    });

    const summary =
      await repository.findActiveVoiceProfileSummaryForUser("user_a");
    assert.deepEqual(summary, {
      id: "vp_repo_active",
      quality_score: 91,
    });
    assert.deepEqual(await repository.findActiveVoiceCloneForUser("user_a"), {
      elevenlabs_voice_id: "el_voice_repo",
    });

    await repository.markVoiceProfileReplaced({
      profileId: "vp_repo_active",
      deletedAt: "2026-06-27T10:20:00.000Z",
    });

    const replaced = await db
      .prepare(
        "SELECT status, embedding_ref, elevenlabs_voice_id, deleted_at FROM voice_profiles WHERE id = ?",
      )
      .get("vp_repo_active");
    assert.equal(replaced.status, "deleted");
    assert.equal(
      replaced.embedding_ref,
      "voice_profiles/user_a/vp_repo_active/embedding.bin",
    );
    assert.equal(replaced.elevenlabs_voice_id, "el_voice_repo");
    assert.equal(replaced.deleted_at, "2026-06-27T10:20:00.000Z");
  });

  test("voice profile deletion helper clears assets and audit helper writes row", async () => {
    await repository.insertVoiceProfile({
      id: "vp_repo_delete",
      userId: "user_a",
      status: "active",
      embeddingRef: "voice_profiles/user_a/vp_repo_delete/embedding.bin",
      qualityScore: 80,
      qualityTier: "good",
      qualityMetricsJson: '{"average_score":80}',
      modelVersion: "embed_test",
      consentVersion: "2.0",
      consentAt: "2026-06-27T10:00:00.000Z",
      lastVerifiedAt: "2026-06-27T10:10:00.000Z",
      createdAt: "2026-06-27T10:10:00.000Z",
      elevenlabsVoiceId: "el_voice_delete",
    });

    await repository.deleteVoiceProfileAndClearAssets({
      profileId: "vp_repo_delete",
      deletedAt: "2026-06-27T10:30:00.000Z",
    });
    await repository.insertAuditLog({
      id: "audit_repo_delete",
      userId: "user_a",
      action: "voice_profile_deleted",
      resourceType: "voice_profile",
      resourceId: "vp_repo_delete",
      metadataJson: '{"source":"test"}',
      createdAt: "2026-06-27T10:31:00.000Z",
    });

    const deleted = await db
      .prepare(
        "SELECT status, embedding_ref, elevenlabs_voice_id, deleted_at FROM voice_profiles WHERE id = ?",
      )
      .get("vp_repo_delete");
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.embedding_ref, null);
    assert.equal(deleted.elevenlabs_voice_id, null);
    assert.equal(deleted.deleted_at, "2026-06-27T10:30:00.000Z");

    const audit = await db
      .prepare("SELECT * FROM audit_logs WHERE id = ?")
      .get("audit_repo_delete");
    assert.equal(audit.user_id, "user_a");
    assert.equal(audit.action, "voice_profile_deleted");
    assert.equal(audit.resource_id, "vp_repo_delete");
    assert.equal(audit.metadata_json, '{"source":"test"}');
  });
});
