/**
 * Circuit Breaker Tests
 *
 * Tests the circuit breaker pattern for provider failure handling.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { CircuitBreaker } = require("../../src/workflows/circuit-breaker");

describe("CircuitBreaker", () => {
  test("circuit breaker starts in closed state", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "closed");
  });

  test("circuit breaker opens after consecutive failures", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Record 3 failures
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), true);
    assert.strictEqual(breaker.getState("elevenlabs"), "open");
  });

  test("circuit breaker stays closed with fewer failures than threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "closed");
  });

  test("circuit breaker resets failure count on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordSuccess("elevenlabs");

    // Failure count reset, should still be closed even with more failures
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "closed");
  });

  test("circuit breaker allows requests after cooldown (half-open)", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });

    // Open the circuit
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    assert.strictEqual(breaker.isOpen("elevenlabs"), true);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 150));

    // Should be half-open now
    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "half-open");
  });

  test("half-open circuit closes on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 50 });

    // Open the circuit
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 100));

    // Record success in half-open state
    await breaker.recordSuccess("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "closed");
  });

  test("half-open circuit opens again on failure", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 50 });

    // Open the circuit
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 100));

    // Verify half-open
    assert.strictEqual(breaker.getState("elevenlabs"), "half-open");

    // Record failure in half-open state
    await breaker.recordFailure("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), true);
    assert.strictEqual(breaker.getState("elevenlabs"), "open");
  });

  test("circuit breaker tracks multiple providers independently", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Open circuit for elevenlabs
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    // replicate should still be closed
    assert.strictEqual(breaker.isOpen("elevenlabs"), true);
    assert.strictEqual(breaker.isOpen("replicate"), false);

    // Fail replicate once, still closed
    await breaker.recordFailure("replicate");
    assert.strictEqual(breaker.isOpen("replicate"), false);
  });

  test("canExecute returns false when circuit is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    assert.strictEqual(breaker.canExecute("elevenlabs"), true);

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    assert.strictEqual(breaker.canExecute("elevenlabs"), false);
  });

  test("execute runs function when circuit is closed", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    let executed = false;

    const result = await breaker.execute("elevenlabs", async () => {
      executed = true;
      return "success";
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(result, "success");
  });

  test("execute throws CircuitOpenError when circuit is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Open circuit
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    await assert.rejects(
      async () => {
        await breaker.execute("elevenlabs", async () => "should not run");
      },
      (err) => {
        assert.strictEqual(err.name, "CircuitOpenError");
        assert.strictEqual(err.provider, "elevenlabs");
        return true;
      }
    );
  });

  test("execute records failure when function throws", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await assert.rejects(async () => {
      await breaker.execute("elevenlabs", async () => {
        throw new Error("API error");
      });
    });

    // Verify failure was recorded
    const stats = breaker.getStats("elevenlabs");
    assert.strictEqual(stats.failures, 1);
  });

  test("execute records success when function succeeds", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Record some failures first
    await breaker.recordFailure("elevenlabs");

    await breaker.execute("elevenlabs", async () => "success");

    // Failures should be reset
    const stats = breaker.getStats("elevenlabs");
    assert.strictEqual(stats.failures, 0);
  });

  test("getStats returns provider statistics", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");

    const stats = breaker.getStats("elevenlabs");

    assert.strictEqual(stats.state, "closed");
    assert.strictEqual(stats.failures, 2);
    assert.strictEqual(typeof stats.lastFailure, "number");
  });

  test("getAllStats returns all provider statistics", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("replicate");
    await breaker.recordFailure("replicate");

    const allStats = breaker.getAllStats();

    assert.strictEqual(allStats.elevenlabs.failures, 1);
    assert.strictEqual(allStats.replicate.failures, 2);
  });

  test("forceOpen opens circuit immediately", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 10 });

    breaker.forceOpen("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), true);
    assert.strictEqual(breaker.getState("elevenlabs"), "open");
  });

  test("forceClose closes circuit immediately", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Open naturally
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    assert.strictEqual(breaker.isOpen("elevenlabs"), true);

    // Force close
    breaker.forceClose("elevenlabs");

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.getState("elevenlabs"), "closed");
  });

  test("reset clears all provider state", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("elevenlabs");
    await breaker.recordFailure("replicate");

    breaker.reset();

    assert.strictEqual(breaker.isOpen("elevenlabs"), false);
    assert.strictEqual(breaker.isOpen("replicate"), false);
    assert.deepStrictEqual(breaker.getAllStats(), {});
  });
});
