/**
 * CloudFront Signed URL Tests
 *
 * Tests for CloudFront signed URL generation.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Generate a test RSA key pair for testing
function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

describe('CloudFront Signed URLs', () => {
  let testPrivateKey;

  before(() => {
    const keys = generateTestKeyPair();
    testPrivateKey = keys.privateKey;
    // Public key generated but not used in tests (CloudFront only needs private key)
  });

  test('createCloudFrontSigner validates required configuration', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    assert.throws(() => {
      createCloudFrontSigner({});
    }, /CloudFront signer requires/);

    assert.throws(() => {
      createCloudFrontSigner({ CLOUDFRONT_DOMAIN: 'test.cloudfront.net' });
    }, /CloudFront signer requires/);

    assert.throws(() => {
      createCloudFrontSigner({
        CLOUDFRONT_DOMAIN: 'test.cloudfront.net',
        CLOUDFRONT_KEY_PAIR_ID: 'K12345',
      });
    }, /CloudFront signer requires/);

    assert.throws(() => {
      createCloudFrontSigner({
        CLOUDFRONT_DOMAIN: 'test.cloudfront.net',
        CLOUDFRONT_KEY_PAIR_ID: 'K12345',
        CLOUDFRONT_PRIVATE_KEY: 'not-a-pem-key',
      });
    }, /must be in PEM format/);
  });

  test('createCloudFrontSigner returns signer interface', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    assert.strictEqual(typeof signer.createSignedUrl, 'function');
    assert.strictEqual(typeof signer.createSignedStreamUrl, 'function');
    assert.strictEqual(typeof signer.createSignedPlaylistUrls, 'function');
    assert.strictEqual(typeof signer.healthCheck, 'function');
    assert.strictEqual(signer.domain, 'd123456.cloudfront.net');
    assert.strictEqual(signer.keyPairId, 'K12345EXAMPLE');
  });

  test('createSignedUrl generates valid signed URL', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    const result = signer.createSignedUrl({
      path: '/tracks/user123/track456/master.aac',
      expiresInSeconds: 3600,
    });

    // Verify URL structure
    assert.ok(result.url.startsWith('https://d123456.cloudfront.net'));
    assert.ok(result.url.includes('/tracks/user123/track456/master.aac'));
    assert.ok(result.url.includes('Expires='));
    assert.ok(result.url.includes('Signature='));
    assert.ok(result.url.includes('Key-Pair-Id=K12345EXAMPLE'));

    // Verify expiration
    assert.ok(result.expiresAt);
    const expiresAt = new Date(result.expiresAt);
    const now = new Date();
    const diff = (expiresAt - now) / 1000;
    assert.ok(diff > 3500 && diff < 3700, `Expected ~3600s, got ${diff}s`);

    // Verify metadata
    assert.strictEqual(result.domain, 'd123456.cloudfront.net');
    assert.strictEqual(result.path, '/tracks/user123/track456/master.aac');
  });

  test('createSignedUrl handles paths without leading slash', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    const result = signer.createSignedUrl({
      path: 'tracks/user123/file.mp3',
    });

    assert.ok(result.url.includes('/tracks/user123/file.mp3'));
  });

  test('createSignedStreamUrl uses shorter expiration', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    const result = signer.createSignedStreamUrl({
      path: '/stream/video.mp4',
    });

    // Default stream expiration is 900 seconds (15 min)
    const expiresAt = new Date(result.expiresAt);
    const now = new Date();
    const diff = (expiresAt - now) / 1000;
    assert.ok(diff > 850 && diff < 950, `Expected ~900s, got ${diff}s`);
  });

  test('createSignedPlaylistUrls returns playlist and segment signer', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    const result = signer.createSignedPlaylistUrls({
      basePath: '/tracks/user123/track456/hls',
      expiresInSeconds: 600,
    });

    // Verify playlist URL
    assert.ok(result.playlist.url.includes('/hls/playlist.m3u8'));
    assert.ok(result.playlist.url.includes('Signature='));

    // Verify segment signing helper
    assert.strictEqual(typeof result.signSegment, 'function');

    // Sign a segment
    const segment = result.signSegment('segment001.ts');
    assert.ok(segment.url.includes('/hls/segment001.ts'));
    assert.ok(segment.url.includes('Signature='));
  });

  test('healthCheck returns healthy status', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    const health = signer.healthCheck();
    assert.strictEqual(health.healthy, true);
  });

  test('signature is URL-safe encoded', () => {
    const { createCloudFrontSigner } = require('../../src/storage/cloudfront.js');

    const signer = createCloudFrontSigner({
      CLOUDFRONT_DOMAIN: 'd123456.cloudfront.net',
      CLOUDFRONT_KEY_PAIR_ID: 'K12345EXAMPLE',
      CLOUDFRONT_PRIVATE_KEY: testPrivateKey,
    });

    // Generate many URLs to test encoding variety
    for (let i = 0; i < 10; i++) {
      const result = signer.createSignedUrl({
        path: `/test/file${i}.mp3`,
        expiresInSeconds: i * 100 + 100,
      });

      // URL should not contain characters that need encoding
      const signatureMatch = result.url.match(/Signature=([^&]+)/);
      assert.ok(signatureMatch, 'Should have signature');

      const signature = signatureMatch[1];
      // CloudFront uses ~ instead of / and - instead of + and _ instead of =
      assert.ok(!signature.includes('+'), 'Signature should not contain +');
      assert.ok(!signature.includes('/'), 'Signature should not contain /');
      assert.ok(!signature.includes('='), 'Signature should not contain =');
    }
  });
});

describe('CloudFront Signing Functions', () => {
  let testPrivateKey;

  before(() => {
    const keys = generateTestKeyPair();
    testPrivateKey = keys.privateKey;
  });

  test('signCannedPolicy generates valid signature', () => {
    const { signCannedPolicy } = require('../../src/storage/cloudfront.js');

    const url = 'https://d123.cloudfront.net/test.mp3';
    const expires = Math.floor(Date.now() / 1000) + 3600;

    const signature = signCannedPolicy(url, expires, testPrivateKey);

    assert.ok(signature.length > 0, 'Signature should not be empty');
    assert.ok(!signature.includes('+'), 'Should be URL-safe');
    assert.ok(!signature.includes('/'), 'Should be URL-safe');
  });

  test('signCustomPolicy generates policy and signature', () => {
    const { signCustomPolicy } = require('../../src/storage/cloudfront.js');

    const policy = {
      Statement: [
        {
          Resource: 'https://d123.cloudfront.net/*',
          Condition: {
            DateLessThan: {
              'AWS:EpochTime': Math.floor(Date.now() / 1000) + 3600,
            },
            IpAddress: {
              'AWS:SourceIp': '192.168.1.0/24',
            },
          },
        },
      ],
    };

    const result = signCustomPolicy(policy, testPrivateKey);

    assert.ok(result.signature.length > 0);
    assert.ok(result.policy.length > 0);
    assert.ok(!result.signature.includes('+'));
    assert.ok(!result.policy.includes('+'));
  });
});
