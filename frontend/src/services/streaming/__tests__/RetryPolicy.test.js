import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryPolicy } from '../RetryPolicy';
import { NetworkError, RateLimitError, StreamingError } from '../errors';

describe('RetryPolicy', () => {
  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const policy = new RetryPolicy();

      expect(policy.maxAttempts).toBe(3);
      expect(policy.baseDelayMs).toBe(1000);
      expect(policy.maxDelayMs).toBe(30000);
    });

    it('accepts custom options', () => {
      const policy = new RetryPolicy({
        maxAttempts: 5,
        baseDelayMs: 500,
        maxDelayMs: 10000,
      });

      expect(policy.maxAttempts).toBe(5);
      expect(policy.baseDelayMs).toBe(500);
      expect(policy.maxDelayMs).toBe(10000);
    });
  });

  describe('shouldRetry', () => {
    let policy;

    beforeEach(() => {
      policy = new RetryPolicy({ maxAttempts: 3 });
    });

    it('returns false when max attempts reached', () => {
      const error = new NetworkError('Failed');
      expect(policy.shouldRetry(error, 3)).toBe(false);
      expect(policy.shouldRetry(error, 4)).toBe(false);
    });

    it('returns true for NetworkError before max attempts', () => {
      const error = new NetworkError('Connection failed');
      expect(policy.shouldRetry(error, 1)).toBe(true);
      expect(policy.shouldRetry(error, 2)).toBe(true);
    });

    it('returns true for RateLimitError (429) before max attempts', () => {
      const error = new RateLimitError('gpt-4', 30);
      expect(policy.shouldRetry(error, 1)).toBe(true);
    });

    it('returns true for errors with status >= 500', () => {
      const error = new StreamingError('Server error');
      error.status = 500;
      expect(policy.shouldRetry(error, 1)).toBe(true);

      error.status = 503;
      expect(policy.shouldRetry(error, 1)).toBe(true);
    });

    it('returns false for 4xx errors (except 429)', () => {
      const error = new StreamingError('Bad request');
      error.status = 400;
      expect(policy.shouldRetry(error, 1)).toBe(false);

      error.status = 401;
      expect(policy.shouldRetry(error, 1)).toBe(false);

      error.status = 403;
      expect(policy.shouldRetry(error, 1)).toBe(false);
    });

    it('respects explicit isRetryable flag', () => {
      const retryable = new StreamingError('Custom');
      retryable.isRetryable = true;
      expect(policy.shouldRetry(retryable, 1)).toBe(true);

      const notRetryable = new StreamingError('Custom');
      notRetryable.isRetryable = false;
      expect(policy.shouldRetry(notRetryable, 1)).toBe(false);
    });
  });

  describe('getDelay', () => {
    let policy;

    beforeEach(() => {
      policy = new RetryPolicy({
        baseDelayMs: 1000,
        maxDelayMs: 30000,
      });
    });

    it('returns exponentially increasing delays', () => {
      // Run multiple times to account for jitter
      const delays1 = [];
      const delays2 = [];
      const delays3 = [];

      for (let i = 0; i < 10; i++) {
        delays1.push(policy.getDelay(1));
        delays2.push(policy.getDelay(2));
        delays3.push(policy.getDelay(3));
      }

      const avg1 = delays1.reduce((a, b) => a + b) / delays1.length;
      const avg2 = delays2.reduce((a, b) => a + b) / delays2.length;
      const avg3 = delays3.reduce((a, b) => a + b) / delays3.length;

      // Average should be close to base * 2^(attempt-1)
      expect(avg1).toBeGreaterThan(800);
      expect(avg1).toBeLessThan(1400);

      expect(avg2).toBeGreaterThan(1600);
      expect(avg2).toBeLessThan(2800);

      expect(avg3).toBeGreaterThan(3200);
      expect(avg3).toBeLessThan(5600);
    });

    it('caps delay at maxDelayMs', () => {
      const policy = new RetryPolicy({
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      });

      // Attempt 10 would be 1000 * 2^9 = 512000ms without cap
      for (let i = 0; i < 10; i++) {
        const delay = policy.getDelay(10);
        expect(delay).toBeLessThanOrEqual(5000);
      }
    });

    it('adds jitter to prevent thundering herd', () => {
      const delays = [];
      for (let i = 0; i < 100; i++) {
        delays.push(policy.getDelay(1));
      }

      // Check that not all delays are identical (jitter is working)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // Check delays are within ±30% of base
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(700); // 1000 * 0.7
        expect(delay).toBeLessThanOrEqual(1300); // 1000 * 1.3
      });
    });
  });
});
