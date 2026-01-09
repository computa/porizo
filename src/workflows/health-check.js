/**
 * Provider Health Check Service
 *
 * Checks the health status of external providers (ElevenLabs, Replicate).
 * Used for monitoring and circuit breaker integration.
 *
 * Usage:
 *   const healthCheck = createHealthCheckService({
 *     elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
 *     elevenlabsBaseUrl: 'https://api.elevenlabs.io',
 *     replicateToken: process.env.REPLICATE_API_TOKEN,
 *     replicateBaseUrl: 'https://api.replicate.com',
 *   });
 *
 *   // Check single provider
 *   const result = await healthCheck.checkElevenLabsHealth();
 *   // { healthy: true, provider: 'elevenlabs', latencyMs: 123, error: null }
 *
 *   // Check all providers
 *   const all = await healthCheck.checkAllProviders();
 *   // { elevenlabs: {...}, replicate: {...}, checkedAt: '...' }
 *
 *   // Get overall health status
 *   const overall = await healthCheck.getOverallHealth();
 *   // { healthy: true, healthyCount: 2, totalCount: 2, providers: {...} }
 */

/**
 * Create a health check service instance
 * @param {Object} params
 * @param {Function} params.fetch - Fetch function (default: global fetch)
 * @param {string} params.elevenlabsApiKey - ElevenLabs API key
 * @param {string} params.elevenlabsBaseUrl - ElevenLabs base URL
 * @param {string} params.replicateToken - Replicate API token
 * @param {string} params.replicateBaseUrl - Replicate base URL
 * @param {number} params.timeoutMs - Request timeout in ms (default: 5000)
 * @returns {Object} Health check service interface
 */
function createHealthCheckService({
  fetch: customFetch,
  elevenlabsApiKey,
  elevenlabsBaseUrl,
  replicateToken,
  replicateBaseUrl,
  timeoutMs = 5000,
} = {}) {
  const fetchFn = customFetch || global.fetch;

  /**
   * Helper to make a timed request
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<{response: Response, latencyMs: number}>}
   */
  async function timedFetch(url, options = {}) {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startTime;
      return { response, latencyMs };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check ElevenLabs API health
   * Uses the /v1/user endpoint to verify API key and connectivity
   * @returns {Promise<Object>} Health status
   */
  async function checkElevenLabsHealth() {
    const provider = "elevenlabs";

    if (!elevenlabsApiKey || !elevenlabsBaseUrl) {
      return {
        healthy: false,
        provider,
        latencyMs: 0,
        error: "ElevenLabs not configured",
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      const { response, latencyMs } = await timedFetch(
        `${elevenlabsBaseUrl}/v1/user`,
        {
          method: "GET",
          headers: {
            "xi-api-key": elevenlabsApiKey,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          healthy: false,
          provider,
          latencyMs,
          error: `HTTP ${response.status}: ${response.statusText}`,
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        healthy: true,
        provider,
        latencyMs,
        error: null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error.name === "AbortError"
          ? `Request timeout after ${timeoutMs}ms`
          : error.message;

      return {
        healthy: false,
        provider,
        latencyMs: timeoutMs,
        error: errorMessage,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Replicate API health
   * Uses the /v1/predictions endpoint to verify token and connectivity
   * @returns {Promise<Object>} Health status
   */
  async function checkReplicateHealth() {
    const provider = "replicate";

    if (!replicateToken || !replicateBaseUrl) {
      return {
        healthy: false,
        provider,
        latencyMs: 0,
        error: "Replicate not configured",
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      const { response, latencyMs } = await timedFetch(
        `${replicateBaseUrl}/v1/predictions`,
        {
          method: "GET",
          headers: {
            Authorization: `Token ${replicateToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          healthy: false,
          provider,
          latencyMs,
          error: `HTTP ${response.status}: ${response.statusText}`,
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        healthy: true,
        provider,
        latencyMs,
        error: null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error.name === "AbortError"
          ? `Request timeout after ${timeoutMs}ms`
          : error.message;

      return {
        healthy: false,
        provider,
        latencyMs: timeoutMs,
        error: errorMessage,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Check health of all configured providers
   * @returns {Promise<Object>} Health status for all providers
   */
  async function checkAllProviders() {
    const [elevenlabs, replicate] = await Promise.all([
      checkElevenLabsHealth(),
      checkReplicateHealth(),
    ]);

    return {
      elevenlabs,
      replicate,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Get overall health status
   * @returns {Promise<Object>} Overall health summary
   */
  async function getOverallHealth() {
    const providers = await checkAllProviders();

    const providerList = [providers.elevenlabs, providers.replicate];
    const healthyProviders = providerList.filter((p) => p.healthy);
    const unhealthyProviders = providerList
      .filter((p) => !p.healthy)
      .map((p) => p.provider);

    return {
      healthy: healthyProviders.length === providerList.length,
      healthyCount: healthyProviders.length,
      totalCount: providerList.length,
      unhealthyProviders,
      providers,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    checkElevenLabsHealth,
    checkReplicateHealth,
    checkAllProviders,
    getOverallHealth,
  };
}

module.exports = {
  createHealthCheckService,
};
