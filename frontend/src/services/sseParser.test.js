import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSSEParser, parseSSEChunk } from './sseParser';

describe('SSE Parser Service', () => {
  describe('createSSEParser', () => {
    it('creates a parser that calls onChunk with content from delta', () => {
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const parser = createSSEParser({ onChunk, onDone });

      const sseData = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
      parser.feed(sseData);

      expect(onChunk).toHaveBeenCalledWith('Hello');
      expect(onDone).not.toHaveBeenCalled();
    });

    it('accumulates multiple chunks into full content', () => {
      const chunks = [];
      const onChunk = vi.fn((chunk) => chunks.push(chunk));
      const onDone = vi.fn();
      const parser = createSSEParser({ onChunk, onDone });

      parser.feed('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":"!"}}]}\n\n');

      expect(chunks).toEqual(['Hello', ' world', '!']);
    });

    it('calls onDone when receiving [DONE] message', () => {
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const parser = createSSEParser({ onChunk, onDone });

      parser.feed('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(onChunk).toHaveBeenCalledWith('Hi');
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('calls onError when receiving error in stream', () => {
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const parser = createSSEParser({ onChunk, onDone, onError });

      parser.feed('data: {"error":{"message":"Rate limit exceeded"}}\n\n');

      expect(onError).toHaveBeenCalledWith('Rate limit exceeded');
      expect(onChunk).not.toHaveBeenCalled();
    });

    it('ignores empty delta content', () => {
      const onChunk = vi.fn();
      const parser = createSSEParser({ onChunk, onDone: vi.fn() });

      parser.feed('data: {"choices":[{"delta":{}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":""}}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":"real"}}]}\n\n');

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith('real');
    });

    it('handles malformed JSON gracefully without crashing', () => {
      const onChunk = vi.fn();
      const onError = vi.fn();
      const parser = createSSEParser({ onChunk, onDone: vi.fn(), onError });

      // Should not throw
      expect(() => {
        parser.feed('data: {invalid json}\n\n');
        parser.feed('data: {"choices":[{"delta":{"content":"still works"}}]}\n\n');
      }).not.toThrow();

      expect(onChunk).toHaveBeenCalledWith('still works');
    });

    it('handles SSE comments (lines starting with :)', () => {
      const onChunk = vi.fn();
      const parser = createSSEParser({ onChunk, onDone: vi.fn() });

      parser.feed(': this is a comment\n');
      parser.feed('data: {"choices":[{"delta":{"content":"content"}}]}\n\n');

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith('content');
    });

    it('handles multi-line data correctly', () => {
      const onChunk = vi.fn();
      const parser = createSSEParser({ onChunk, onDone: vi.fn() });

      // Single chunk containing multiple SSE events
      const multiData =
        'data: {"choices":[{"delta":{"content":"one"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"two"}}]}\n\n';

      parser.feed(multiData);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, 'one');
      expect(onChunk).toHaveBeenNthCalledWith(2, 'two');
    });
  });

  describe('parseSSEChunk (utility)', () => {
    it('extracts content from valid OpenAI-style chunk', () => {
      const result = parseSSEChunk('{"choices":[{"delta":{"content":"test"}}]}');
      expect(result).toEqual({ content: 'test', done: false, error: null });
    });

    it('returns done:true for [DONE] marker', () => {
      const result = parseSSEChunk('[DONE]');
      expect(result).toEqual({ content: null, done: true, error: null });
    });

    it('extracts error message from error response', () => {
      const result = parseSSEChunk('{"error":{"message":"Something went wrong"}}');
      expect(result).toEqual({ content: null, done: false, error: 'Something went wrong' });
    });

    it('returns null content for empty delta', () => {
      const result = parseSSEChunk('{"choices":[{"delta":{}}]}');
      expect(result).toEqual({ content: null, done: false, error: null });
    });

    it('handles malformed JSON by returning null values', () => {
      const result = parseSSEChunk('not valid json');
      expect(result).toEqual({ content: null, done: false, error: null });
    });
  });
});
