/**
 * Circuit Breaker Pattern Implementation
 *
 * Protects against cascading failures when external services (ElevenLabs, Replicate) fail.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests blocked for cooldown period
 * - HALF-OPEN: After cooldown, allow test requests to probe if service recovered
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30000 });
 *
 *   // Option 1: Manual recording
 *   if (!breaker.canExecute('elevenlabs')) {
 *     throw new Error('Service unavailable');
 *   }
 *   try {
 *     const result = await callElevenLabs();
 *     breaker.recordSuccess('elevenlabs');
 *   } catch (err) {
 *     breaker.recordFailure('elevenlabs');
 *     throw err;
 *   }
 *
 *   // Option 2: Wrapped execution
 *   const result = await breaker.execute('elevenlabs', async () => {
 *     return await callElevenLabs();
 *   });
 */

/**
 * Custom error thrown when circuit is open
 */
class CircuitOpenError extends Error {
  constructor(provider, message) {
    super(message || `Circuit breaker open for provider: ${provider}`);
    this.name = "CircuitOpenError";
    this.provider = provider;
  }
}

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} options.failureThreshold - Number of failures before opening circuit (default: 5)
   * @param {number} options.cooldownMs - Time to wait before allowing test requests (default: 30000)
   * @param {number} options.halfOpenRequests - Number of requests allowed in half-open state (default: 1)
   */
  constructor({
    failureThreshold = 5,
    cooldownMs = 30000,
    halfOpenRequests = 1,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.halfOpenRequests = halfOpenRequests;

    // Map of provider name -> state object
    this.providers = new Map();
  }

  /**
   * Get or create state object for a provider
   * @private
   */
  _getProviderState(provider) {
    if (!this.providers.has(provider)) {
      this.providers.set(provider, {
        state: "closed",
        failures: 0,
        lastFailure: null,
        halfOpenAttempts: 0,
      });
    }
    return this.providers.get(provider);
  }

  /**
   * Update state based on current conditions
   * @private
   */
  _updateState(providerState) {
    if (providerState.state === "open") {
      // Check if cooldown has passed
      if (Date.now() - providerState.lastFailure >= this.cooldownMs) {
        providerState.state = "half-open";
        providerState.halfOpenAttempts = 0;
      }
    }
  }

  /**
   * Check if circuit is open (blocking requests)
   * Does NOT create state for unknown providers (returns false)
   * @param {string} provider - Provider name (e.g., 'elevenlabs', 'replicate')
   * @returns {boolean} True if circuit is open and blocking requests
   */
  isOpen(provider) {
    // Don't create state for unknown providers - they're not open
    if (!this.providers.has(provider)) {
      return false;
    }

    const providerState = this.providers.get(provider);
    this._updateState(providerState);

    return providerState.state === "open";
  }

  /**
   * Get current state of circuit for a provider
   * @param {string} provider - Provider name
   * @returns {'closed'|'open'|'half-open'} Current circuit state
   */
  getState(provider) {
    const providerState = this._getProviderState(provider);
    this._updateState(providerState);

    return providerState.state;
  }

  /**
   * Check if a request can be executed (circuit not open)
   * @param {string} provider - Provider name
   * @returns {boolean} True if request can proceed
   */
  canExecute(provider) {
    return !this.isOpen(provider);
  }

  /**
   * Record a successful call to a provider
   * Resets failure count and closes circuit if half-open
   * @param {string} provider - Provider name
   */
  async recordSuccess(provider) {
    const providerState = this._getProviderState(provider);

    // Update state in case cooldown has passed (open -> half-open)
    this._updateState(providerState);

    // Reset failures
    providerState.failures = 0;

    // Close circuit if it was half-open (success in half-open = recovered)
    if (providerState.state === "half-open") {
      providerState.state = "closed";
    }
  }

  /**
   * Record a failed call to a provider
   * Increments failure count and may open circuit
   * @param {string} provider - Provider name
   */
  async recordFailure(provider) {
    const providerState = this._getProviderState(provider);

    // Update state in case cooldown has passed (open -> half-open)
    this._updateState(providerState);

    providerState.failures++;
    providerState.lastFailure = Date.now();

    // If in half-open state, immediately re-open on failure
    if (providerState.state === "half-open") {
      providerState.state = "open";
      return;
    }

    // Check if we should open the circuit
    if (providerState.failures >= this.failureThreshold) {
      providerState.state = "open";
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {string} provider - Provider name
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>} Result of the function
   * @throws {CircuitOpenError} If circuit is open
   */
  async execute(provider, fn) {
    if (this.isOpen(provider)) {
      throw new CircuitOpenError(provider);
    }

    try {
      const result = await fn();
      await this.recordSuccess(provider);
      return result;
    } catch (error) {
      await this.recordFailure(provider);
      throw error;
    }
  }

  /**
   * Get statistics for a provider
   * @param {string} provider - Provider name
   * @returns {Object} Provider statistics
   */
  getStats(provider) {
    const providerState = this._getProviderState(provider);
    this._updateState(providerState);

    return {
      state: providerState.state,
      failures: providerState.failures,
      lastFailure: providerState.lastFailure,
      halfOpenAttempts: providerState.halfOpenAttempts,
    };
  }

  /**
   * Get statistics for all tracked providers
   * @returns {Object} Map of provider name -> statistics
   */
  getAllStats() {
    const stats = {};
    for (const [provider] of this.providers) {
      stats[provider] = this.getStats(provider);
    }
    return stats;
  }

  /**
   * Force a circuit open (for testing or manual intervention)
   * @param {string} provider - Provider name
   */
  forceOpen(provider) {
    const providerState = this._getProviderState(provider);
    providerState.state = "open";
    providerState.lastFailure = Date.now();
  }

  /**
   * Force a circuit closed (for testing or manual intervention)
   * @param {string} provider - Provider name
   */
  forceClose(provider) {
    const providerState = this._getProviderState(provider);
    providerState.state = "closed";
    providerState.failures = 0;
  }

  /**
   * Reset all provider state
   */
  reset() {
    this.providers.clear();
  }
}

module.exports = {
  CircuitBreaker,
  CircuitOpenError,
};
