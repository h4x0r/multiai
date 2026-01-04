/**
 * Retry policy with exponential backoff and jitter.
 */
export class RetryPolicy {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
  }

  /**
   * Determine if an error should trigger a retry.
   * @param {Error} error - The error that occurred
   * @param {number} attemptNumber - Current attempt number (1-based)
   * @returns {boolean} Whether to retry
   */
  shouldRetry(error, attemptNumber) {
    if (attemptNumber >= this.maxAttempts) {
      return false;
    }

    // Respect explicit isRetryable flag if set
    if (typeof error.isRetryable === 'boolean') {
      return error.isRetryable;
    }

    // Retry on network errors
    if (error.isNetworkError) {
      return true;
    }

    // Retry on 5xx and 429
    if (error.status >= 500 || error.status === 429) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay before next retry attempt.
   * Uses exponential backoff with jitter.
   * @param {number} attemptNumber - Current attempt number (1-based)
   * @returns {number} Delay in milliseconds
   */
  getDelay(attemptNumber) {
    // Exponential backoff: base * 2^(attempt-1)
    const exponential = this.baseDelayMs * Math.pow(2, attemptNumber - 1);

    // Add jitter: ±30% of the delay
    const jitterRange = 0.3 * exponential;
    const jitter = (Math.random() * 2 - 1) * jitterRange;

    const delay = exponential + jitter;

    // Cap at maxDelayMs
    return Math.min(delay, this.maxDelayMs);
  }
}
