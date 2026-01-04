import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../CircuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const breaker = new CircuitBreaker();

      expect(breaker.failureThreshold).toBe(5);
      expect(breaker.resetTimeMs).toBe(60000);
    });

    it('accepts custom options', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeMs: 30000,
      });

      expect(breaker.failureThreshold).toBe(3);
      expect(breaker.resetTimeMs).toBe(30000);
    });
  });

  describe('isOpen', () => {
    it('returns false for unknown model (closed by default)', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      expect(breaker.isOpen('gpt-4')).toBe(false);
    });

    it('returns false when failures below threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');

      expect(breaker.isOpen('gpt-4')).toBe(false);
    });

    it('returns true when failures reach threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');

      expect(breaker.isOpen('gpt-4')).toBe(true);
    });

    it('returns false after reset time passes (half-open)', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeMs: 60000,
      });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      expect(breaker.isOpen('gpt-4')).toBe(true);

      // Advance time past reset
      vi.advanceTimersByTime(60001);

      expect(breaker.isOpen('gpt-4')).toBe(false);
    });

    it('isolates state per model', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('claude-3');

      expect(breaker.isOpen('gpt-4')).toBe(true);
      expect(breaker.isOpen('claude-3')).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count for model', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordSuccess('gpt-4');
      breaker.recordFailure('gpt-4');

      expect(breaker.isOpen('gpt-4')).toBe(false);
    });

    it('closes circuit after success in half-open state', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeMs: 60000,
      });

      // Open the circuit
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      expect(breaker.isOpen('gpt-4')).toBe(true);

      // Advance to half-open
      vi.advanceTimersByTime(60001);
      expect(breaker.isOpen('gpt-4')).toBe(false);

      // Success closes it
      breaker.recordSuccess('gpt-4');

      // Should stay closed even after more failures
      breaker.recordFailure('gpt-4');
      expect(breaker.isOpen('gpt-4')).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });

      breaker.recordFailure('gpt-4');
      expect(breaker.isOpen('gpt-4')).toBe(false);

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      expect(breaker.isOpen('gpt-4')).toBe(true);
    });

    it('records openedAt timestamp when threshold reached', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      const now = Date.now();
      vi.setSystemTime(now);

      breaker.recordFailure('gpt-4');
      expect(breaker.resetTime('gpt-4')).toBeNull();

      breaker.recordFailure('gpt-4');
      expect(breaker.resetTime('gpt-4')).toBe(now + 60000);
    });
  });

  describe('resetTime', () => {
    it('returns null for unknown model', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.resetTime('unknown')).toBeNull();
    });

    it('returns null when circuit not open', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      breaker.recordFailure('gpt-4');
      expect(breaker.resetTime('gpt-4')).toBeNull();
    });

    it('returns reset timestamp when circuit is open', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeMs: 30000,
      });
      const now = Date.now();
      vi.setSystemTime(now);

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');

      expect(breaker.resetTime('gpt-4')).toBe(now + 30000);
    });
  });

  describe('getState', () => {
    it('returns closed for unknown model', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState('unknown')).toBe('closed');
    });

    it('returns closed when below threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      breaker.recordFailure('gpt-4');
      expect(breaker.getState('gpt-4')).toBe('closed');
    });

    it('returns open when at threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      expect(breaker.getState('gpt-4')).toBe('open');
    });

    it('returns half-open after reset time', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeMs: 60000,
      });

      breaker.recordFailure('gpt-4');
      breaker.recordFailure('gpt-4');
      expect(breaker.getState('gpt-4')).toBe('open');

      vi.advanceTimersByTime(60001);
      expect(breaker.getState('gpt-4')).toBe('half-open');
    });
  });
});
