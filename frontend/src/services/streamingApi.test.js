import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatCompletion } from './streamingApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create a mock ReadableStream from SSE data
function createMockStream(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create mock response
function createMockResponse(chunks, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: createMockStream(chunks),
    json: vi.fn().mockResolvedValue({}),
  };
}

describe('Streaming API Service', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('streamChatCompletion', () => {
    it('calls onChunk for each content delta in the stream', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onChunk = vi.fn();
      const onComplete = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk,
        onComplete,
      });

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world');
    });

    it('calls onComplete with full content and timing when stream ends', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Complete"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onComplete = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      const result = onComplete.mock.calls[0][0];
      expect(result.content).toBe('Complete');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    });

    it('measures TTFT (time to first token) accurately', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"First"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Second"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onComplete = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete,
      });

      const result = onComplete.mock.calls[0][0];
      expect(result.ttftMs).toBeDefined();
      expect(typeof result.ttftMs).toBe('number');
      expect(result.ttftMs).toBeLessThanOrEqual(result.responseTimeMs);
    });

    it('calls onError when receiving error in stream', async () => {
      const chunks = [
        'data: {"error":{"message":"Rate limit exceeded"}}\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onError = vi.fn();
      const onComplete = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete,
        onError,
      });

      expect(onError).toHaveBeenCalledWith('Rate limit exceeded');
    });

    it('calls onError when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const onError = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });

    it('calls onError when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: { message: 'Server error' } }),
      });

      const onError = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Server error'));
    });

    it('sends correct request to API endpoint', async () => {
      const chunks = ['data: [DONE]\n\n'];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      await streamChatCompletion({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      expect(mockFetch).toHaveBeenCalledWith('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
          stream: true,
        }),
      });
    });

    it('accumulates full content correctly across chunks', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"The "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"quick "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"brown "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"fox"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onComplete = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete,
      });

      expect(onComplete.mock.calls[0][0].content).toBe('The quick brown fox');
    });

    it('handles empty responses gracefully', async () => {
      const chunks = ['data: [DONE]\n\n'];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const onComplete = vi.fn();
      const onError = vi.fn();

      await streamChatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: vi.fn(),
        onComplete,
        onError,
      });

      expect(onComplete).toHaveBeenCalled();
      expect(onComplete.mock.calls[0][0].content).toBe('');
      expect(onError).not.toHaveBeenCalled();
    });
  });
});
