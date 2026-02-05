/**
 * Inline test for token rotation race condition
 * This tests the auth-service.js rotateRefreshToken function directly
 */

// Set up test environment
process.env.JWT_SECRET = 'test-jwt-secret-32-characters-long';

const authService = require('../src/services/auth-service');

// Create a minimal in-memory mock database
const mockDb = {
  tokenFamilies: new Map(),
  refreshTokens: new Map(),

  prepare: function(sql) {
    const self = this;
    return {
      async run(...params) {
        if (sql.includes('INSERT INTO token_families')) {
          self.tokenFamilies.set(params[0], { id: params[0], user_id: params[1] });
          return { changes: 1 };
        }
        if (sql.includes('INSERT INTO refresh_tokens')) {
          self.refreshTokens.set(params[2], { // token_hash is key
            id: params[0],
            user_id: params[1],
            token_hash: params[2],
            token_family: params[3],
            generation: params[4],
            expires_at: params[5],
            revoked_at: null
          });
          return { changes: 1 };
        }
        if (sql.includes('UPDATE refresh_tokens SET revoked_at') && sql.includes('WHERE id')) {
          // Find by ID and check revoked_at IS NULL condition
          const tokenId = params[0];
          const token = [...self.refreshTokens.values()].find(t => t.id === tokenId);
          if (token && !token.revoked_at) {
            token.revoked_at = new Date().toISOString();
            return { changes: 1 };
          }
          return { changes: 0 }; // Already revoked - optimistic lock failed
        }
        if (sql.includes('UPDATE token_families SET compromised_at')) {
          const family = self.tokenFamilies.get(params[0]);
          if (family) family.compromised_at = new Date().toISOString();
          return { changes: 1 };
        }
        return { changes: 0 };
      },
      async get(...params) {
        if (sql.includes('FROM refresh_tokens') && sql.includes('token_hash')) {
          return self.refreshTokens.get(params[0]) || null;
        }
        if (sql.includes('FROM token_families WHERE id')) {
          return self.tokenFamilies.get(params[0]) || null;
        }
        if (sql.includes('FROM refresh_tokens') && sql.includes('generation')) {
          // Look for replacement token
          const family = params[0];
          const gen = params[1];
          return [...self.refreshTokens.values()].find(
            t => t.token_family === family && t.generation === gen && !t.revoked_at
          ) || null;
        }
        return null;
      },
      async all() { return []; }
    };
  },

  async transaction(fn) {
    return await fn();
  }
};

// Initialize auth service
authService.initialize(mockDb);

async function runTest() {
  console.log('Creating test user and refresh token...');

  // Create a refresh token
  const result = await authService.createRefreshToken('test-user-123');
  const token = result.token;
  console.log('Created refresh token');

  console.log('\nStarting concurrent rotation test...');

  // Fire two concurrent rotations
  const [result1, result2] = await Promise.allSettled([
    authService.rotateRefreshToken(token),
    authService.rotateRefreshToken(token),
  ]);

  const successes = [result1, result2].filter(r => r.status === 'fulfilled');
  const failures = [result1, result2].filter(r => r.status === 'rejected');

  console.log('\nResults:');
  console.log('  Successes: ' + successes.length);
  console.log('  Failures: ' + failures.length);

  if (failures.length > 0) {
    const codes = failures.map(f => f.reason?.code || f.reason?.message);
    console.log('  Failure codes: ' + codes.join(', '));
  }

  // Validate results
  if (successes.length === 1 && failures.length === 1) {
    const failureCode = failures[0].reason?.code;
    if (['TOKEN_ALREADY_ROTATED', 'TOKEN_ROTATION_CONFLICT'].includes(failureCode)) {
      console.log('\n✅ PASS: Race condition properly handled');
      console.log('   - Only one concurrent rotation succeeded');
      console.log('   - Second rotation failed with expected error code');
      process.exit(0);
    }
  }

  console.log('\n❌ FAIL: Race condition NOT properly handled');
  console.log('   Expected: 1 success, 1 failure with TOKEN_ALREADY_ROTATED');
  console.log('   Got: ' + successes.length + ' successes, ' + failures.length + ' failures');
  process.exit(1);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
