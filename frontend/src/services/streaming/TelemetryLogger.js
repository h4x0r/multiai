/**
 * Batched telemetry logger for Vercel OTel.
 * Silently fails on errors - never interrupts user flow.
 */
export class TelemetryLogger {
  constructor(options = {}) {
    this.endpoint = options.endpoint !== undefined
      ? options.endpoint
      : 'https://multiai-telemetry.vercel.app/api/telemetry';
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 5000;
    this.appVersion = options.appVersion ?? '0.1.0';
    this.queue = [];
    this.intervalId = null;

    if (this.endpoint !== null) {
      this.startFlushing();
    }
  }

  /**
   * Log a generic event.
   * @param {Object} event - Event data
   */
  log(event) {
    this.queue.push({
      ...event,
      timestamp: Date.now(),
      appVersion: this.appVersion,
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    });

    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Log a streaming error.
   * @param {Object} context - Error context
   */
  logError(context) {
    this.log({ type: 'streaming_error', ...context });
  }

  /**
   * Log a streaming success.
   * @param {Object} context - Success context
   */
  logSuccess(context) {
    this.log({ type: 'streaming_success', ...context });
  }

  /**
   * Flush queued events to the endpoint.
   */
  async flush() {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0);

    if (this.endpoint === null) {
      // Console-only mode - just clear the queue
      return;
    }

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // Silent fail - never interrupt user flow
    }
  }

  /**
   * Start automatic flushing on interval.
   */
  startFlushing() {
    this.intervalId = setInterval(() => this.flush(), this.flushInterval);
  }

  /**
   * Stop flushing and flush remaining events.
   */
  async destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    await this.flush();
  }
}
