import { describe, it, expect } from 'vitest';
import {
  StreamingError,
  NetworkError,
  RateLimitError,
  CircuitOpenError,
  AbortError,
} from '../errors';

describe('Streaming Errors', () => {
  describe('StreamingError (base)', () => {
    it('has name, message, timestamp, and context', () => {
      const error = new StreamingError('Test error', { requestId: '123' });

      expect(error.name).toBe('StreamingError');
      expect(error.message).toBe('Test error');
      expect(error.timestamp).toBeGreaterThan(0);
      expect(error.context.requestId).toBe('123');
    });

    it('is instanceof Error', () => {
      const error = new StreamingError('Test');
      expect(error).toBeInstanceOf(Error);
    });

    it('serializes to JSON with all properties', () => {
      const error = new StreamingError('Test error', { model: 'gpt-4' });
      const json = error.toJSON();

      expect(json.name).toBe('StreamingError');
      expect(json.message).toBe('Test error');
      expect(json.timestamp).toBeGreaterThan(0);
      expect(json.model).toBe('gpt-4');
    });
  });

  describe('NetworkError', () => {
    it('has isRetryable and isNetworkError flags', () => {
      const error = new NetworkError('Connection failed');

      expect(error.name).toBe('NetworkError');
      expect(error.isRetryable).toBe(true);
      expect(error.isNetworkError).toBe(true);
    });

    it('extends StreamingError', () => {
      const error = new NetworkError('Failed');
      expect(error).toBeInstanceOf(StreamingError);
    });
  });

  describe('RateLimitError', () => {
    it('has model, retryAfter, status, and rate limit flags', () => {
      const error = new RateLimitError('gpt-4', 30);

      expect(error.name).toBe('RateLimitError');
      expect(error.message).toBe('Rate limited on gpt-4');
      expect(error.context.model).toBe('gpt-4');
      expect(error.context.retryAfter).toBe(30);
      expect(error.status).toBe(429);
      expect(error.isRetryable).toBe(true);
      expect(error.isRateLimited).toBe(true);
    });
  });

  describe('CircuitOpenError', () => {
    it('has model, resetTime, and is not retryable', () => {
      const resetTime = Date.now() + 60000;
      const error = new CircuitOpenError('claude-3', resetTime);

      expect(error.name).toBe('CircuitOpenError');
      expect(error.message).toBe('Circuit open for claude-3');
      expect(error.context.model).toBe('claude-3');
      expect(error.context.resetTime).toBe(resetTime);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('AbortError', () => {
    it('has requestId and is not retryable', () => {
      const error = new AbortError('req-123');

      expect(error.name).toBe('AbortError');
      expect(error.message).toBe('Request aborted');
      expect(error.context.requestId).toBe('req-123');
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('JSON serialization', () => {
    it('all error types serialize properly for telemetry', () => {
      const errors = [
        new NetworkError('Network failed', { attempt: 1 }),
        new RateLimitError('gpt-4', 30, { requestId: '123' }),
        new CircuitOpenError('claude-3', Date.now() + 60000),
        new AbortError('req-456'),
      ];

      errors.forEach((error) => {
        const json = error.toJSON();
        expect(json.name).toBe(error.name);
        expect(json.message).toBe(error.message);
        expect(json.timestamp).toBeDefined();
        // Should be valid JSON (no circular refs, etc.)
        expect(() => JSON.stringify(json)).not.toThrow();
      });
    });
  });
});
