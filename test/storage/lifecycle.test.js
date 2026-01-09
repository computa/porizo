/**
 * S3 Lifecycle Policy Tests
 *
 * Tests for S3 lifecycle policy configuration and path categorization.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

describe('S3 Lifecycle Policies', () => {
  test('getRetentionCategory returns correct category for enrollment paths', () => {
    const { getRetentionCategory } = require('../../src/storage/lifecycle.js');

    // Raw enrollment chunks
    assert.strictEqual(
      getRetentionCategory('enrollment/raw/user123/session456/chunk1.wav'),
      'enrollment_raw'
    );

    // Clean enrollment audio
    assert.strictEqual(
      getRetentionCategory('enrollment/clean/user123/session456/clean.wav'),
      'enrollment_clean'
    );
  });

  test('getRetentionCategory returns correct category for voice profiles', () => {
    const { getRetentionCategory } = require('../../src/storage/lifecycle.js');

    assert.strictEqual(
      getRetentionCategory('voice_profiles/user123/vp456/embedding.bin'),
      'voice_profile'
    );
  });

  test('getRetentionCategory returns correct category for track files', () => {
    const { getRetentionCategory } = require('../../src/storage/lifecycle.js');

    // Master audio
    assert.strictEqual(
      getRetentionCategory('tracks/user123/track456/v1/master.aac'),
      'track'
    );

    // Preview
    assert.strictEqual(
      getRetentionCategory('tracks/user123/track456/v1/preview.aac'),
      'track'
    );

    // HLS segments
    assert.strictEqual(
      getRetentionCategory('tracks/user123/track456/v1/hls/playlist.m3u8'),
      'track'
    );

    // Stems (internal)
    assert.strictEqual(
      getRetentionCategory('tracks/user123/track456/v1/stems/vocals.wav'),
      'track_stems'
    );
  });

  test('getRetentionCategory returns unknown for unrecognized paths', () => {
    const { getRetentionCategory } = require('../../src/storage/lifecycle.js');

    assert.strictEqual(getRetentionCategory('some/random/path.txt'), 'unknown');
    assert.strictEqual(getRetentionCategory(''), 'unknown');
  });

  test('RETENTION_POLICIES has correct days for each category', () => {
    const { RETENTION_POLICIES } = require('../../src/storage/lifecycle.js');

    // Enrollment data - 7 days (privacy)
    assert.strictEqual(RETENTION_POLICIES.enrollment_raw.days, 7);
    assert.strictEqual(RETENTION_POLICIES.enrollment_clean.days, 7);

    // Voice profiles - indefinite (null means no expiration)
    assert.strictEqual(RETENTION_POLICIES.voice_profile.days, null);

    // Tracks - indefinite
    assert.strictEqual(RETENTION_POLICIES.track.days, null);

    // Stems - 30 days (internal processing only)
    assert.strictEqual(RETENTION_POLICIES.track_stems.days, 30);
  });

  test('generateLifecycleConfiguration returns valid AWS lifecycle config', () => {
    const { generateLifecycleConfiguration } = require('../../src/storage/lifecycle.js');

    const config = generateLifecycleConfiguration();

    // Should be valid lifecycle configuration format
    assert.ok(config.Rules);
    assert.ok(Array.isArray(config.Rules));

    // Should have rules for enrollment and stems (expiration rules only)
    const ruleIds = config.Rules.map((r) => r.ID);
    assert.ok(ruleIds.includes('enrollment-raw-expiration'));
    assert.ok(ruleIds.includes('enrollment-clean-expiration'));
    assert.ok(ruleIds.includes('track-stems-expiration'));

    // Each rule should have required fields
    for (const rule of config.Rules) {
      assert.ok(rule.ID);
      assert.ok(rule.Filter);
      assert.ok(rule.Status);
      assert.strictEqual(rule.Status, 'Enabled');
    }
  });

  test('generateLifecycleConfiguration rules have correct prefixes', () => {
    const { generateLifecycleConfiguration } = require('../../src/storage/lifecycle.js');

    const config = generateLifecycleConfiguration();

    const rawRule = config.Rules.find((r) => r.ID === 'enrollment-raw-expiration');
    assert.strictEqual(rawRule.Filter.Prefix, 'enrollment/raw/');
    assert.strictEqual(rawRule.Expiration.Days, 7);

    const cleanRule = config.Rules.find((r) => r.ID === 'enrollment-clean-expiration');
    assert.strictEqual(cleanRule.Filter.Prefix, 'enrollment/clean/');
    assert.strictEqual(cleanRule.Expiration.Days, 7);

    const stemsRule = config.Rules.find((r) => r.ID === 'track-stems-expiration');
    // Stems use tag-based filtering with And clause since AWS doesn't support regex
    assert.ok(stemsRule.Filter.And, 'Stems rule should use And filter for tag-based lifecycle');
    assert.strictEqual(stemsRule.Filter.And.Prefix, 'tracks/');
    assert.ok(stemsRule.Filter.And.Tags.some((t) => t.Key === 'lifecycle' && t.Value === 'stems'));
    assert.strictEqual(stemsRule.Expiration.Days, 30);
  });

  test('isExpirableKey correctly identifies keys subject to expiration', () => {
    const { isExpirableKey } = require('../../src/storage/lifecycle.js');

    // Enrollment files should expire
    assert.strictEqual(isExpirableKey('enrollment/raw/user/session/chunk.wav'), true);
    assert.strictEqual(isExpirableKey('enrollment/clean/user/session/clean.wav'), true);

    // Stems should expire
    assert.strictEqual(isExpirableKey('tracks/user/track/v1/stems/vocals.wav'), true);

    // Voice profiles should NOT expire
    assert.strictEqual(isExpirableKey('voice_profiles/user/vp/embedding.bin'), false);

    // Tracks should NOT expire
    assert.strictEqual(isExpirableKey('tracks/user/track/v1/master.aac'), false);
    assert.strictEqual(isExpirableKey('tracks/user/track/v1/hls/playlist.m3u8'), false);
  });

  test('getExpirationDays returns correct days for expirable keys', () => {
    const { getExpirationDays } = require('../../src/storage/lifecycle.js');

    assert.strictEqual(getExpirationDays('enrollment/raw/user/session/chunk.wav'), 7);
    assert.strictEqual(getExpirationDays('enrollment/clean/user/session/clean.wav'), 7);
    assert.strictEqual(getExpirationDays('tracks/user/track/v1/stems/vocals.wav'), 30);

    // Non-expiring keys return null
    assert.strictEqual(getExpirationDays('tracks/user/track/v1/master.aac'), null);
    assert.strictEqual(getExpirationDays('voice_profiles/user/vp/embedding.bin'), null);
  });
});

describe('Lifecycle Configuration Export', () => {
  test('toJSON returns valid JSON string', () => {
    const { generateLifecycleConfiguration } = require('../../src/storage/lifecycle.js');

    const config = generateLifecycleConfiguration();
    const json = JSON.stringify(config);

    // Should be valid JSON
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, config);
  });

  test('toAWSCLI returns valid AWS CLI command', () => {
    const { toAWSCLI } = require('../../src/storage/lifecycle.js');

    const command = toAWSCLI('my-bucket');

    assert.ok(command.includes('aws s3api put-bucket-lifecycle-configuration'));
    assert.ok(command.includes('--bucket my-bucket'));
    assert.ok(command.includes('--lifecycle-configuration'));
  });
});
