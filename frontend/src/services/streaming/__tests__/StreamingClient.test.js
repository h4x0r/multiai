import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingClient } from '../StreamingClient';
import { NetworkError, RateLimitError, CircuitOpenError, AbortError } from '../errors';

// Mock streamingApi
vi.mock('../../streamingApi', () => ({
  streamChatCompletion: vi.fn(),
}));

import { streamChatCompletion } from '../../streamingApi';

describe('StreamingClient', () => {
  let client;
  let mockTelemetry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockTelemetry = {
      logError: vi.fn(),
      logSuccess: vi.fn(),
    };

    client = new StreamingClient({
      retry: { maxAttempts: 3, baseDelayMs: 100 },
      circuit: { failureThreshold: 3, resetTimeMs: 1000 },
      telemetry: mockTelemetry,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stream', () => {
    it('calls streamChatCompletion with correct parameters', async () => {
      streamChatCompletion.mockImplementation(({ onComplete }) => {
        onComplete({ content: 'test', responseTimeMs: 100, ttftMs: 50 });
      });

      const onChunk = vi.fn();
      const onComplete = vi.fn();

      await client.stream('req-1', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk,
        onComplete,
      });

      expect(streamChatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('passes chunks to onChunk callback', async () => {
      streamChatCompletion.mockImplementation(({ onChunk, onComplete }) => {
        onChunk('Hello');
        onChunk(' world');
        onComplete({ content: 'Hello world', responseTimeMs: 100, ttftMs: 50 });
      });

      const chunks = [];
      await client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: (chunk) => chunks.push(chunk),
        onComplete: vi.fn(),
      });

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('logs success to telemetry', async () => {
      streamChatCompletion.mockImplementation(({ onComplete }) => {
        onComplete({ content: 'test', responseTimeMs: 100, ttftMs: 50 });
      });

      await client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      expect(mockTelemetry.logSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          model: 'gpt-4',
        })
      );
    });

    it('retries on retryable errors', async () => {
      let attempts = 0;
      streamChatCompletion.mockImplementation(({ onComplete, onError }) => {
        attempts++;
        if (attempts < 3) {
          const error = new NetworkError('Failed');
          onError(error);
        } else {
          onComplete({ content: 'success', responseTimeMs: 100, ttftMs: 50 });
        }
      });

      const onComplete = vi.fn();
      const promise = client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete,
      });

      // Run all pending timers (includes retry delays)
      await vi.runAllTimersAsync();
      await promise;

      expect(attempts).toBe(3);
      expect(onComplete).toHaveBeenCalled();
    });

    it('calls onError after max retry attempts', async () => {
      streamChatCompletion.mockImplementation(({ onError }) => {
        onError(new NetworkError('Always fails'));
      });

      const onError = vi.fn();
      const promise = client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      });

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(400);

      await promise;

      expect(onError).toHaveBeenCalled();
    });

    it('opens circuit breaker after threshold failures', async () => {
      streamChatCompletion.mockImplementation(({ onError }) => {
        const error = new RateLimitError('gpt-4', 30);
        onError(error);
      });

      // Fail 3 times to open circuit
      for (let i = 0; i < 3; i++) {
        const promise = client.stream(`req-${i}`, {
          model: 'gpt-4',
          messages: [],
          onChunk: vi.fn(),
          onComplete: vi.fn(),
          onError: vi.fn(),
        });
        await vi.runAllTimersAsync();
        await promise;
      }

      // Now circuit should be open
      const onError = vi.fn();
      await client.stream('req-final', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(CircuitOpenError));
    });
  });

  describe('abort', () => {
    it('aborts a specific request by ID', async () => {
      let abortSignal;
      streamChatCompletion.mockImplementation(({ signal }) => {
        abortSignal = signal;
        // Mock doesn't complete - just stores the signal
      });

      // Start request (it will hang until aborted)
      client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      });

      // Abort it
      client.abort('req-1');
      expect(abortSignal.aborted).toBe(true);
    });

    it('does nothing for unknown request ID', () => {
      expect(() => client.abort('unknown')).not.toThrow();
    });
  });

  describe('abortAll', () => {
    it('aborts all active requests', async () => {
      const signals = [];
      streamChatCompletion.mockImplementation(({ signal, onComplete }) => {
        signals.push(signal);
        return new Promise((resolve) => {
          setTimeout(() => {
            if (!signal.aborted) {
              onComplete({ content: 'done', responseTimeMs: 100, ttftMs: 50 });
            }
            resolve();
          }, 1000);
        });
      });

      // Start multiple requests
      client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });
      client.stream('req-2', {
        model: 'claude-3',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      client.abortAll();

      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(true);
    });
  });

  describe('getActiveRequests', () => {
    it('returns count of active requests', async () => {
      streamChatCompletion.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
      });

      expect(client.getActiveRequests()).toBe(0);

      client.stream('req-1', {
        model: 'gpt-4',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      expect(client.getActiveRequests()).toBe(1);

      client.stream('req-2', {
        model: 'claude-3',
        messages: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      expect(client.getActiveRequests()).toBe(2);
    });
  });
});
