/**
 * Typed errors for streaming operations.
 * All errors are serializable for telemetry.
 */

export class StreamingError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'StreamingError';
    this.timestamp = Date.now();
    this.context = context;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      timestamp: this.timestamp,
      ...this.context,
    };
  }
}

export class NetworkError extends StreamingError {
  constructor(message, context = {}) {
    super(message, context);
    this.name = 'NetworkError';
    this.isRetryable = true;
    this.isNetworkError = true;
  }
}

export class RateLimitError extends StreamingError {
  constructor(model, retryAfter, context = {}) {
    super(`Rate limited on ${model}`, { model, retryAfter, ...context });
    this.name = 'RateLimitError';
    this.status = 429;
    this.isRetryable = true;
    this.isRateLimited = true;
  }
}

export class CircuitOpenError extends StreamingError {
  constructor(model, resetTime) {
    super(`Circuit open for ${model}`, { model, resetTime });
    this.name = 'CircuitOpenError';
    this.isRetryable = false;
  }
}

export class AbortError extends StreamingError {
  constructor(requestId) {
    super('Request aborted', { requestId });
    this.name = 'AbortError';
    this.isRetryable = false;
  }
}
