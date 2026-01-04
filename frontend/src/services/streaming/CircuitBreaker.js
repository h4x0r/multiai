/**
 * Circuit breaker for per-model rate limit protection.
 * States: closed (normal) → open (blocking) → half-open (testing)
 */
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeMs = options.resetTimeMs ?? 60000;
    this.state = new Map(); // model -> { failures, openedAt }
  }

  /**
   * Check if circuit is open (blocking requests).
   * @param {string} model - Model identifier
   * @returns {boolean} True if circuit is open
   */
  isOpen(model) {
    const state = this.state.get(model);
    if (!state || state.failures < this.failureThreshold) {
      return false;
    }

    // Check if reset time has passed (transition to half-open)
    if (Date.now() - state.openedAt > this.resetTimeMs) {
      // Don't delete state here - getState needs it for half-open detection
      return false;
    }

    return true;
  }

  /**
   * Record a successful request (resets failure count).
   * @param {string} model - Model identifier
   */
  recordSuccess(model) {
    this.state.delete(model);
  }

  /**
   * Record a failed request.
   * @param {string} model - Model identifier
   */
  recordFailure(model) {
    const state = this.state.get(model) || { failures: 0, openedAt: null };
    state.failures++;

    if (state.failures >= this.failureThreshold && !state.openedAt) {
      state.openedAt = Date.now();
    }

    this.state.set(model, state);
  }

  /**
   * Get the timestamp when circuit will reset.
   * @param {string} model - Model identifier
   * @returns {number|null} Reset timestamp or null if circuit not open
   */
  resetTime(model) {
    const state = this.state.get(model);
    if (!state || !state.openedAt) {
      return null;
    }
    return state.openedAt + this.resetTimeMs;
  }

  /**
   * Get current circuit state for a model.
   * @param {string} model - Model identifier
   * @returns {'closed'|'open'|'half-open'} Current state
   */
  getState(model) {
    const state = this.state.get(model);

    if (!state || state.failures < this.failureThreshold) {
      return 'closed';
    }

    if (Date.now() - state.openedAt > this.resetTimeMs) {
      return 'half-open';
    }

    return 'open';
  }
}
