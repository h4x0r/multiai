import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatCompletion } from './streamingApi';
import { createSSEParser, parseSSEChunk } from './sseParser';

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

describe('Streaming Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('Full streaming flow: API -> Parser -> Callbacks', () => {
    it('handles a complete conversation turn with multiple chunks', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"! I"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" am"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" an"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" AI"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"."}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const receivedChunks = [];
      let completionResult = null;

      await streamChatCompletion({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: (result) => { completionResult = result; },
      });

      expect(receivedChunks).toEqual(['Hello', '! I', ' am', ' an', ' AI', '.']);
      expect(completionResult.content).toBe('Hello! I am an AI.');
      expect(completionResult.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(completionResult.ttftMs).toBeGreaterThanOrEqual(0);
    });

    it('handles rapid sequential chunks in a single network packet', async () => {
      // Multiple SSE events in a single network chunk
      const singlePacket = [
        'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"B"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"C"}}]}\n\n' +
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(singlePacket));

      const receivedChunks = [];
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => {},
      });

      expect(receivedChunks).toEqual(['A', 'B', 'C']);
    });

    it('handles chunks split across network boundaries', async () => {
      // SSE data split mid-JSON
      const splitChunks = [
        'data: {"choices":[{"delta":{"con',
        'tent":"split"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(splitChunks));

      const receivedChunks = [];
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => {},
      });

      expect(receivedChunks).toEqual(['split']);
    });

    it('handles unicode content in streaming response', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" 🌍"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let completionContent = '';
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
        onChunk: () => {},
        onComplete: (result) => { completionContent = result.content; },
      });

      expect(completionContent).toBe('Hello 世界 🌍');
    });

    it('handles markdown and code blocks in streaming response', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Here is code:\\n\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"```javascript\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"console.log(\\"hello\\");"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n```"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let completionContent = '';
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Show code' }],
        onChunk: () => {},
        onComplete: (result) => { completionContent = result.content; },
      });

      expect(completionContent).toContain('```javascript');
      expect(completionContent).toContain('console.log("hello");');
    });
  });

  describe('Error handling flow', () => {
    it('handles API error before streaming starts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({
          error: { message: 'Rate limit exceeded. Please try again later.' }
        }),
      });

      let errorMessage = null;
      let completeCalled = false;

      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        onComplete: () => { completeCalled = true; },
        onError: (err) => { errorMessage = err; },
      });

      expect(errorMessage).toContain('Rate limit exceeded');
      expect(completeCalled).toBe(false);
    });

    it('handles error in the middle of a stream', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Starting"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" response"}}]}\n\n',
        'data: {"error":{"message":"Context length exceeded"}}\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const receivedChunks = [];
      let errorMessage = null;

      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => {},
        onError: (err) => { errorMessage = err; },
      });

      expect(receivedChunks).toEqual(['Starting', ' response']);
      expect(errorMessage).toBe('Context length exceeded');
    });

    it('handles network failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      let errorMessage = null;
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        onComplete: () => {},
        onError: (err) => { errorMessage = err; },
      });

      expect(errorMessage).toContain('Failed to fetch');
    });

    it('handles malformed JSON in stream without crashing', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Before"}}]}\n\n',
        'data: {malformed json here}\n\n',
        'data: {"choices":[{"delta":{"content":"After"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const receivedChunks = [];
      let completeCalled = false;

      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => { completeCalled = true; },
      });

      // Should continue processing after malformed JSON
      expect(receivedChunks).toEqual(['Before', 'After']);
      expect(completeCalled).toBe(true);
    });
  });

  describe('Timing accuracy', () => {
    it('TTFT is less than or equal to total response time', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"First"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" Last"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let timing = null;
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        onComplete: (result) => { timing = result; },
      });

      expect(timing.ttftMs).toBeLessThanOrEqual(timing.responseTimeMs);
    });

    it('provides reasonable timing values (not negative)', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Response"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let timing = null;
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        onComplete: (result) => { timing = result; },
      });

      expect(timing.ttftMs).toBeGreaterThanOrEqual(0);
      expect(timing.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SSE Parser direct tests', () => {
    it('handles OpenAI-style finish_reason in delta', () => {
      const result = parseSSEChunk('{"choices":[{"delta":{},"finish_reason":"stop"}]}');
      expect(result.content).toBeNull();
      expect(result.done).toBe(false);
      expect(result.error).toBeNull();
    });

    it('handles function_call delta (no content)', () => {
      const result = parseSSEChunk('{"choices":[{"delta":{"function_call":{"name":"test"}}}]}');
      expect(result.content).toBeNull();
      expect(result.error).toBeNull();
    });

    it('handles empty choices array', () => {
      const result = parseSSEChunk('{"choices":[]}');
      expect(result.content).toBeNull();
      expect(result.error).toBeNull();
    });

    it('handles missing choices key', () => {
      const result = parseSSEChunk('{"id":"chatcmpl-123"}');
      expect(result.content).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('handles very long content chunks', async () => {
      const longContent = 'x'.repeat(10000);
      const chunks = [
        `data: {"choices":[{"delta":{"content":"${longContent}"}}]}\n\n`,
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let completionContent = '';
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Generate long text' }],
        onChunk: () => {},
        onComplete: (result) => { completionContent = result.content; },
      });

      expect(completionContent.length).toBe(10000);
    });

    it('handles empty stream (only DONE)', async () => {
      const chunks = ['data: [DONE]\n\n'];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      let completionResult = null;
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: () => {},
        onComplete: (result) => { completionResult = result; },
      });

      expect(completionResult.content).toBe('');
    });

    it('handles SSE with event type field', async () => {
      // Some APIs include event: field
      const chunks = [
        'event: message\ndata: {"choices":[{"delta":{"content":"With event type"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const receivedChunks = [];
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => {},
      });

      expect(receivedChunks).toEqual(['With event type']);
    });

    it('handles SSE keepalive comments', async () => {
      const chunks = [
        ': keepalive\n',
        'data: {"choices":[{"delta":{"content":"After keepalive"}}]}\n\n',
        ': another comment\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      const receivedChunks = [];
      await streamChatCompletion({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        onChunk: (chunk) => receivedChunks.push(chunk),
        onComplete: () => {},
      });

      expect(receivedChunks).toEqual(['After keepalive']);
    });

    it('handles multiple messages in conversation context', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Based on our conversation"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      mockFetch.mockResolvedValueOnce(createMockResponse(chunks));

      await streamChatCompletion({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Continue' },
        ],
        onChunk: () => {},
        onComplete: () => {},
      });

      expect(mockFetch).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({
        body: expect.stringContaining('"messages"'),
      }));

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(4);
    });
  });

  describe('Parser <-> StreamingAPI integration', () => {
    it('createSSEParser correctly integrates with fetch stream', async () => {
      // This tests the direct parser usage pattern
      const receivedChunks = [];
      let doneReceived = false;

      const parser = createSSEParser({
        onChunk: (content) => receivedChunks.push(content),
        onDone: () => { doneReceived = true; },
        onError: () => {},
      });

      // Simulate feeding raw SSE data
      parser.feed('data: {"choices":[{"delta":{"content":"Direct"}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":" parser"}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":" test"}}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(receivedChunks).toEqual(['Direct', ' parser', ' test']);
      expect(doneReceived).toBe(true);
    });
  });
});
