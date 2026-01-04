/**
 * Comprehensive tests for useStreamingChat hook.
 * TDD: These tests are written BEFORE implementation changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'solid-js';

// Track mock functions
const mockStream = vi.fn();
const mockAbort = vi.fn();
const mockAbortAll = vi.fn();
let mockClientInstance = null;

// Mock the streaming module
vi.mock('../../services/streaming', () => {
  class MockStreamingClient {
    constructor(options) {
      this.options = options;
      mockClientInstance = this;
    }
    stream = mockStream;
    abort = mockAbort;
    abortAll = mockAbortAll;
  }

  return {
    StreamingClient: MockStreamingClient,
  };
});

// Reset singleton between tests
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockClientInstance = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useStreamingChat', () => {
  describe('initialization', () => {
    it('returns responses signal initialized to empty object', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { responses } = useStreamingChat();
        expect(responses()).toEqual({});
        dispose();
      });
    });

    it('returns isStreaming signal initialized to false', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { isStreaming } = useStreamingChat();
        expect(isStreaming()).toBe(false);
        dispose();
      });
    });

    it('returns streamToModels function', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { streamToModels } = useStreamingChat();
        expect(typeof streamToModels).toBe('function');
        dispose();
      });
    });

    it('returns abort function', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { abort } = useStreamingChat();
        expect(typeof abort).toBe('function');
        dispose();
      });
    });

    it('creates StreamingClient with disabled telemetry', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { streamToModels } = useStreamingChat();
        // Trigger client creation
        mockStream.mockImplementation((requestId, options) => {
          options.onComplete({ content: 'test', responseTimeMs: 100 });
        });
        streamToModels([{ id: 'test', name: 'Test' }], [{ role: 'user', content: 'hi' }]);

        expect(mockClientInstance.options.telemetryOptions).toEqual({ endpoint: null });
        dispose();
      });
    });

    it('creates StreamingClient with retry policy', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { streamToModels } = useStreamingChat();
        mockStream.mockImplementation((requestId, options) => {
          options.onComplete({ content: 'test', responseTimeMs: 100 });
        });
        streamToModels([{ id: 'test', name: 'Test' }], [{ role: 'user', content: 'hi' }]);

        expect(mockClientInstance.options.retry).toEqual({ maxAttempts: 3, baseDelayMs: 1000 });
        dispose();
      });
    });

    it('creates StreamingClient with circuit breaker', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { streamToModels } = useStreamingChat();
        mockStream.mockImplementation((requestId, options) => {
          options.onComplete({ content: 'test', responseTimeMs: 100 });
        });
        streamToModels([{ id: 'test', name: 'Test' }], [{ role: 'user', content: 'hi' }]);

        expect(mockClientInstance.options.circuit).toEqual({ failureThreshold: 5, resetTimeMs: 60000 });
        dispose();
      });
    });
  });

  describe('streamToModels', () => {
    it('sets isStreaming to true when called', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, isStreaming } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'test', responseTimeMs: 100 }), 0);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hello' }];

          const promise = streamToModels(models, messages);
          expect(isStreaming()).toBe(true);

          await promise;
          dispose();
          resolve();
        });
      });
    });

    it('sets isStreaming to false when all streams complete', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, isStreaming } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'test', responseTimeMs: 100 }), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hello' }];

          await streamToModels(models, messages);
          expect(isStreaming()).toBe(false);

          dispose();
          resolve();
        });
      });
    });

    it('initializes loading state for all models', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          let capturedResponses;
          mockStream.mockImplementation((requestId, options) => {
            capturedResponses = responses();
            setTimeout(() => options.onComplete({ content: 'test', responseTimeMs: 100 }), 10);
          });

          const models = [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' },
          ];
          const messages = [{ role: 'user', content: 'Hello' }];

          await streamToModels(models, messages);

          expect(capturedResponses['model-1']).toEqual({
            loading: true,
            content: '',
            error: null,
            modelName: 'Model 1',
          });
          expect(capturedResponses['model-2']).toEqual({
            loading: true,
            content: '',
            error: null,
            modelName: 'Model 2',
          });

          dispose();
          resolve();
        });
      });
    });

    it('calls StreamingClient.stream for each model', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'test', responseTimeMs: 100 }), 0);
          });

          const models = [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' },
          ];
          const messages = [{ role: 'user', content: 'Hello' }];

          await streamToModels(models, messages);
          expect(mockStream).toHaveBeenCalledTimes(2);

          dispose();
          resolve();
        });
      });
    });

    it('passes correct model and messages to StreamingClient.stream', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'test', responseTimeMs: 100 }), 0);
          });

          const models = [{ id: 'gpt-4', name: 'GPT-4' }];
          const messages = [{ role: 'user', content: 'Hello world' }];

          await streamToModels(models, messages);

          expect(mockStream).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              model: 'gpt-4',
              messages: [{ role: 'user', content: 'Hello world' }],
            })
          );

          dispose();
          resolve();
        });
      });
    });

    it('accumulates chunks in response content', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => {
              options.onChunk('Hello ');
              options.onChunk('world');
              options.onComplete({ content: 'Hello world', responseTimeMs: 100 });
            }, 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);
          expect(responses()['model-1'].content).toBe('Hello world');

          dispose();
          resolve();
        });
      });
    });

    it('sets loading to false on complete', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'Done', responseTimeMs: 100 }), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);
          expect(responses()['model-1'].loading).toBe(false);

          dispose();
          resolve();
        });
      });
    });

    it('captures responseTimeMs on complete', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'Done', responseTimeMs: 1234.56 }), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);
          expect(responses()['model-1'].responseTimeMs).toBe(1235);

          dispose();
          resolve();
        });
      });
    });

    it('captures ttftMs on complete', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'Done', responseTimeMs: 100, ttftMs: 42.7 }), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);
          expect(responses()['model-1'].ttftMs).toBe(43);

          dispose();
          resolve();
        });
      });
    });

    it('returns results array with success for each model', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onComplete({ content: 'Response', responseTimeMs: 100 }), 10);
          });

          const models = [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' },
          ];
          const messages = [{ role: 'user', content: 'Hi' }];

          const results = await streamToModels(models, messages);

          expect(results).toHaveLength(2);
          expect(results[0]).toEqual({ modelId: 'model-1', success: true, content: 'Response' });
          expect(results[1]).toEqual({ modelId: 'model-2', success: true, content: 'Response' });

          dispose();
          resolve();
        });
      });
    });
  });

  describe('error handling', () => {
    it('sets error in response on stream error', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onError(new Error('API rate limit exceeded')), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);

          expect(responses()['model-1'].error).toBe('API rate limit exceeded');
          expect(responses()['model-1'].loading).toBe(false);

          dispose();
          resolve();
        });
      });
    });

    it('returns error result for failed model', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onError(new Error('Network error')), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          const results = await streamToModels(models, messages);

          expect(results[0]).toEqual({
            modelId: 'model-1',
            success: false,
            error: 'Network error',
          });

          dispose();
          resolve();
        });
      });
    });

    it('handles mixed success and error results', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          let callCount = 0;
          mockStream.mockImplementation((requestId, options) => {
            callCount++;
            if (callCount === 1) {
              setTimeout(() => options.onComplete({ content: 'Success', responseTimeMs: 100 }), 10);
            } else {
              setTimeout(() => options.onError(new Error('Failed')), 10);
            }
          });

          const models = [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' },
          ];
          const messages = [{ role: 'user', content: 'Hi' }];

          const results = await streamToModels(models, messages);

          expect(results[0].success).toBe(true);
          expect(results[1].success).toBe(false);

          dispose();
          resolve();
        });
      });
    });

    it('handles string errors', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels, responses } = useStreamingChat();

          mockStream.mockImplementation((requestId, options) => {
            setTimeout(() => options.onError('Simple error string'), 10);
          });

          const models = [{ id: 'model-1', name: 'Model 1' }];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);

          expect(responses()['model-1'].error).toBe('Simple error string');

          dispose();
          resolve();
        });
      });
    });
  });

  describe('abort', () => {
    it('calls StreamingClient.abortAll', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { abort, streamToModels } = useStreamingChat();

        // Trigger client creation first
        mockStream.mockImplementation(() => {});
        streamToModels([{ id: 'test', name: 'Test' }], [{ role: 'user', content: 'hi' }]);

        abort();
        expect(mockAbortAll).toHaveBeenCalled();

        dispose();
      });
    });

    it('sets isStreaming to false', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      createRoot((dispose) => {
        const { abort, isStreaming, streamToModels } = useStreamingChat();

        // Trigger streaming
        mockStream.mockImplementation(() => {});
        streamToModels([{ id: 'test', name: 'Test' }], [{ role: 'user', content: 'hi' }]);

        expect(isStreaming()).toBe(true);

        abort();
        expect(isStreaming()).toBe(false);

        dispose();
      });
    });
  });

  describe('request ID generation', () => {
    it('generates unique request IDs for each stream', async () => {
      const { useStreamingChat } = await import('../useStreamingChat');

      await new Promise((resolve) => {
        createRoot(async (dispose) => {
          const { streamToModels } = useStreamingChat();

          const requestIds = [];
          mockStream.mockImplementation((requestId, options) => {
            requestIds.push(requestId);
            setTimeout(() => options.onComplete({ content: 'Done', responseTimeMs: 100 }), 10);
          });

          const models = [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' },
          ];
          const messages = [{ role: 'user', content: 'Hi' }];

          await streamToModels(models, messages);

          expect(requestIds[0]).not.toBe(requestIds[1]);
          expect(requestIds[0]).toMatch(/^\d+-[a-z0-9]+$/);
          expect(requestIds[1]).toMatch(/^\d+-[a-z0-9]+$/);

          dispose();
          resolve();
        });
      });
    });
  });
});
