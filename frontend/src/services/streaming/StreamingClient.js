/**
 * Main streaming client with abort, retry, and circuit breaker support.
 */
import { streamChatCompletion } from '../streamingApi';
import { RetryPolicy } from './RetryPolicy';
import { CircuitBreaker } from './CircuitBreaker';
import { TelemetryLogger } from './TelemetryLogger';
import { CircuitOpenError, AbortError } from './errors';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StreamingClient {
  constructor(options = {}) {
    this.retryPolicy = options.telemetry instanceof RetryPolicy
      ? options.retry
      : new RetryPolicy(options.retry);

    this.circuitBreaker = options.circuit instanceof CircuitBreaker
      ? options.circuit
      : new CircuitBreaker(options.circuit);

    this.telemetry = options.telemetry instanceof TelemetryLogger
      ? options.telemetry
      : (options.telemetry || new TelemetryLogger(options.telemetryOptions));

    this.activeRequests = new Map(); // requestId -> AbortController
  }

  /**
   * Stream a chat completion with resilience features.
   */
  async stream(requestId, { model, messages, onChunk, onComplete, onError }) {
    // Check circuit breaker first
    if (this.circuitBreaker.isOpen(model)) {
      const error = new CircuitOpenError(model, this.circuitBreaker.resetTime(model));
      this.telemetry.logError?.({ requestId, model, error: error.toJSON() });
      if (onError) onError(error);
      return;
    }

    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);

    try {
      await this.attemptStream(requestId, {
        model,
        messages,
        onChunk,
        onComplete,
        onError,
        signal: controller.signal,
        attemptNumber: 1,
      });
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  async attemptStream(requestId, { model, messages, onChunk, onComplete, onError, signal, attemptNumber }) {
    return new Promise((resolve) => {
      let completed = false;
      let lastError = null;

      streamChatCompletion({
        model,
        messages,
        signal,
        onChunk: (chunk) => {
          if (!signal.aborted) {
            onChunk(chunk);
          }
        },
        onComplete: (result) => {
          completed = true;
          this.circuitBreaker.recordSuccess(model);
          this.telemetry.logSuccess?.({
            requestId,
            model,
            attemptNumber,
            responseTimeMs: result.responseTimeMs,
            ttftMs: result.ttftMs,
          });
          onComplete(result);
          resolve();
        },
        onError: async (error) => {
          lastError = error;

          // Wrap string errors
          if (typeof error === 'string') {
            lastError = new Error(error);
            lastError.isRetryable = true;
          }

          this.telemetry.logError?.({
            requestId,
            model,
            attemptNumber,
            error: lastError.toJSON?.() || { message: lastError.message },
          });

          // Check if we should retry
          if (this.retryPolicy.shouldRetry(lastError, attemptNumber)) {
            const delay = this.retryPolicy.getDelay(attemptNumber);
            await sleep(delay);

            if (!signal.aborted) {
              await this.attemptStream(requestId, {
                model,
                messages,
                onChunk,
                onComplete,
                onError,
                signal,
                attemptNumber: attemptNumber + 1,
              });
            }
            resolve();
            return;
          }

          // Record failure for circuit breaker
          if (lastError.isRateLimited) {
            this.circuitBreaker.recordFailure(model);
          }

          if (onError) onError(lastError);
          resolve();
        },
      });
    });
  }

  /**
   * Abort a specific request by ID.
   */
  abort(requestId) {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Abort all active requests.
   */
  abortAll() {
    this.activeRequests.forEach((controller) => controller.abort());
    this.activeRequests.clear();
  }

  /**
   * Get count of active requests.
   */
  getActiveRequests() {
    return this.activeRequests.size;
  }
}
