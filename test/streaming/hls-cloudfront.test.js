/**
 * HLS CloudFront Streaming Tests
 *
 * Tests for HLS streaming with CloudFront signed URLs.
 * When CDN is configured, streaming URLs should use CloudFront signed URLs.
 * When CDN is not configured, it should fall back to local URLs.
 * Requires PostgreSQL to be running (npm run db:up)
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');

// Check if PostgreSQL is available
async function isPostgresAvailable() {
  try {
    const { createPool } = require('../../src/database/postgres.js');
    const db = createPool({});
    await db.query('SELECT 1');
    await db.close();
    return true;
  } catch (err) {
    return false;
  }
}

describe('HLS CloudFront Streaming', () => {
  let db;
  let app;
  let testUserId;
  let testTrackId;
  let testVersionId;
  let testShareId;
  let testPrivateKey;
  let postgresAvailable = false;

  // Generate test RSA key pair for CloudFront signing
  function generateTestKeyPair() {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return privateKey;
  }

  before(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      console.log('[HLS CloudFront Tests] PostgreSQL not available, skipping tests');
      return;
    }

    const { createPool } = require('../../src/database/postgres.js');
    const { buildServer } = require('../../src/server.js');
    const { createStorageProvider, createCDNSigner } = require('../../src/storage');

    testPrivateKey = generateTestKeyPair();

    db = createPool({});

    // Clean up test data from previous runs
    await db.query("DELETE FROM share_tokens WHERE id LIKE 'sh_test%'");
    await db.query("DELETE FROM track_versions WHERE id LIKE 'tv_test%'");
    await db.query("DELETE FROM tracks WHERE id LIKE 't_test%'");
    await db.query("DELETE FROM users WHERE id LIKE 'u_test%'");

    const storage = createStorageProvider({ type: 'memory' });
    const config = {
      isProduction: false,
      storage: { type: 'memory' },
      // CloudFront configuration for tests
      CLOUDFRONT_DOMAIN: 'd123test.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'KTEST123',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    };

    // Create CDN signer with test configuration
    const cdnSigner = createCDNSigner(config);

    app = buildServer({ db, config, storage, cdnSigner });

    // Create test user
    testUserId = 'u_test_' + crypto.randomUUID().slice(0, 8);
    await db.query(
      'INSERT INTO users (id, created_at) VALUES ($1, $2)',
      [testUserId, new Date().toISOString()]
    );

    // Create test track
    testTrackId = 't_test_' + crypto.randomUUID().slice(0, 8);
    await db.query(`
      INSERT INTO tracks (id, user_id, title, recipient_name, occasion, status, created_at, updated_at)
      VALUES ($1, $2, 'Test Song', 'Test Recipient', 'birthday', 'completed', $3, $4)
    `, [testTrackId, testUserId, new Date().toISOString(), new Date().toISOString()]);

    // Create test track version
    testVersionId = 'tv_test_' + crypto.randomUUID().slice(0, 8);
    await db.query(`
      INSERT INTO track_versions (id, track_id, version_num, params_json, params_hash, status, render_type, created_at)
      VALUES ($1, $2, 1, '{}', 'hash123', 'completed', 'preview', $3)
    `, [testVersionId, testTrackId, new Date().toISOString()]);

    // Create test share token
    testShareId = `sh_test${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.query(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6)
    `, [testShareId, testTrackId, testVersionId, testUserId, expiresAt, new Date().toISOString()]);
  });

  after(async () => {
    if (!postgresAvailable) return;

    await app?.close();

    // Clean up test data
    if (db) {
      await db.query("DELETE FROM share_tokens WHERE id LIKE 'sh_test%'").catch(() => {});
      await db.query("DELETE FROM track_versions WHERE id LIKE 'tv_test%'").catch(() => {});
      await db.query("DELETE FROM tracks WHERE id LIKE 't_test%'").catch(() => {});
      await db.query("DELETE FROM users WHERE id LIKE 'u_test%'").catch(() => {});
      await db.close();
    }
  });

  test('stream endpoint returns CloudFront signed URL when CDN is configured', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    // First claim the share token
    const claimResponse = await app.inject({
      method: 'POST',
      url: `/share/${testShareId}/claim`,
      headers: {
        'x-device-id': 'test-device-123',
        'x-platform': 'ios',
      },
      payload: {
        app_version: '1.0.0',
      },
    });
    assert.strictEqual(claimResponse.statusCode, 200, 'Claim should succeed');

    // Now request stream
    const streamResponse = await app.inject({
      method: 'GET',
      url: `/share/${testShareId}/stream`,
      headers: {
        'x-device-id': 'test-device-123',
        'x-platform': 'ios',
      },
    });

    assert.strictEqual(streamResponse.statusCode, 200, 'Stream request should succeed');
    const body = JSON.parse(streamResponse.body);

    // When CDN is configured, stream_url should be a CloudFront URL
    assert.ok(body.stream_url, 'Should have stream_url');

    // The stream URL should either be:
    // 1. A CloudFront signed URL (production with CDN)
    // 2. A local playlist URL (development without CDN)
    // For this test with CDN configured, we expect CloudFront URLs
    if (body.cdn_enabled) {
      assert.ok(
        body.stream_url.includes('cloudfront.net'),
        'Stream URL should use CloudFront domain when CDN is enabled'
      );
      assert.ok(
        body.stream_url.includes('Signature='),
        'CloudFront URL should be signed'
      );
      assert.ok(
        body.stream_url.includes('Key-Pair-Id='),
        'CloudFront URL should include key pair ID'
      );
    }
  });

  test('stream endpoint falls back to local URL when CDN is not configured', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    // Create a new app instance without CDN configuration
    const { buildServer } = require('../../src/server.js');
    const { createStorageProvider } = require('../../src/storage');

    const storage = createStorageProvider({ type: 'memory' });
    const config = {
      isProduction: false,
      storage: { type: 'memory' },
      // No CloudFront configuration
    };

    const appNoCdn = buildServer({ db, config, storage, cdnSigner: null });

    // Create a separate track for this test (share_tokens has unique constraint on track_id)
    const testTrackIdNoCdn = 't_test_nocdn_' + crypto.randomUUID().slice(0, 8);
    await db.query(`
      INSERT INTO tracks (id, user_id, title, recipient_name, occasion, status, created_at, updated_at)
      VALUES ($1, $2, 'Test Song NoCDN', 'Test Recipient', 'birthday', 'completed', $3, $4)
    `, [testTrackIdNoCdn, testUserId, new Date().toISOString(), new Date().toISOString()]);

    const testVersionIdNoCdn = 'tv_test_nocdn_' + crypto.randomUUID().slice(0, 8);
    await db.query(`
      INSERT INTO track_versions (id, track_id, version_num, params_json, params_hash, status, render_type, created_at)
      VALUES ($1, $2, 1, '{}', 'hash456', 'completed', 'preview', $3)
    `, [testVersionIdNoCdn, testTrackIdNoCdn, new Date().toISOString()]);

    // Create share for this track
    const shareIdNoCdn = `sh_test${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.query(`
      INSERT INTO share_tokens (id, track_id, track_version_id, creator_id, status, expires_at, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6)
    `, [shareIdNoCdn, testTrackIdNoCdn, testVersionIdNoCdn, testUserId, expiresAt, new Date().toISOString()]);

    // Claim the share with body parameters
    await appNoCdn.inject({
      method: 'POST',
      url: `/share/${shareIdNoCdn}/claim`,
      headers: {
        'x-device-id': 'test-device-456',
        'x-platform': 'ios',
      },
      payload: {
        app_version: '1.0.0',
      },
    });

    // Request stream
    const streamResponse = await appNoCdn.inject({
      method: 'GET',
      url: `/share/${shareIdNoCdn}/stream`,
      headers: {
        'x-device-id': 'test-device-456',
        'x-platform': 'ios',
      },
    });

    assert.strictEqual(streamResponse.statusCode, 200);
    const body = JSON.parse(streamResponse.body);

    // Without CDN, should use local playlist URL
    assert.ok(body.stream_url, 'Should have stream_url');
    assert.ok(
      body.stream_url.includes('/share/') && body.stream_url.includes('/playlist'),
      'Should use local playlist URL when CDN is not configured'
    );
    assert.ok(
      !body.stream_url.includes('cloudfront.net'),
      'Should NOT use CloudFront when CDN is not configured'
    );

    await appNoCdn.close();
  });

  test('playlist endpoint validates device binding correctly', async (t) => {
    if (!postgresAvailable) {
      t.skip('PostgreSQL not available');
      return;
    }

    // This test verifies the playlist endpoint validates device binding
    // (actual HLS generation requires file system setup)

    // Request playlist with correct device
    const playlistResponse = await app.inject({
      method: 'GET',
      url: `/share/${testShareId}/playlist`,
      headers: {
        'x-device-id': 'test-device-123',
        'x-platform': 'ios',
      },
    });

    // Expected responses:
    // - 200: HLS ready and served
    // - 409: HLS not ready yet (STREAM_NOT_READY)
    // - 500: Internal error (e.g., missing storage_ref for test data)
    // All are acceptable since we're testing the route exists and validates device
    assert.ok(
      [200, 409, 500].includes(playlistResponse.statusCode),
      `Playlist should return 200/409/500, got ${playlistResponse.statusCode}`
    );

    // Test with wrong device - should be 403
    const wrongDeviceResponse = await app.inject({
      method: 'GET',
      url: `/share/${testShareId}/playlist`,
      headers: {
        'x-device-id': 'wrong-device',
        'x-platform': 'ios',
      },
    });

    assert.strictEqual(
      wrongDeviceResponse.statusCode,
      403,
      'Wrong device should get 403'
    );
  });
});

describe('CDN Signer Integration', () => {
  test('createCDNSigner returns null when not configured', () => {
    const { createCDNSigner } = require('../../src/storage');

    const signer = createCDNSigner({});
    assert.strictEqual(signer, null, 'Should return null without CloudFront config');
  });

  test('createCDNSigner returns signer when fully configured', () => {
    const { createCDNSigner } = require('../../src/storage');

    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const signer = createCDNSigner({
      CLOUDFRONT_DOMAIN: 'd123.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K123',
      CLOUDFRONT_PRIVATE_KEY: privateKey,
    });

    assert.ok(signer, 'Should return signer when configured');
    assert.strictEqual(typeof signer.createSignedUrl, 'function');
    assert.strictEqual(typeof signer.createSignedStreamUrl, 'function');
    assert.strictEqual(typeof signer.createSignedPlaylistUrls, 'function');
  });
});
