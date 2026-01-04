import { createParser } from 'eventsource-parser';

/**
 * Parse a single SSE data chunk and extract content/error/done status.
 * @param {string} data - The data portion of an SSE event (after "data: ")
 * @returns {{ content: string|null, done: boolean, error: string|null }}
 */
export function parseSSEChunk(data) {
  if (data === '[DONE]') {
    return { content: null, done: true, error: null };
  }

  try {
    const parsed = JSON.parse(data);

    // Check for error
    if (parsed.error) {
      return {
        content: null,
        done: false,
        error: parsed.error.message || parsed.error || 'Unknown error',
      };
    }

    // Extract content from delta
    const content = parsed.choices?.[0]?.delta?.content;
    if (content) {
      return { content, done: false, error: null };
    }

    return { content: null, done: false, error: null };
  } catch {
    // Malformed JSON - ignore gracefully
    return { content: null, done: false, error: null };
  }
}

/**
 * Create an SSE parser that handles OpenAI-compatible streaming responses.
 * @param {Object} options
 * @param {Function} options.onChunk - Called with each content chunk
 * @param {Function} options.onDone - Called when stream is complete
 * @param {Function} [options.onError] - Called on error
 * @returns {{ feed: (chunk: string) => void }}
 */
export function createSSEParser({ onChunk, onDone, onError }) {
  const parser = createParser({
    onEvent: (event) => {
      const result = parseSSEChunk(event.data);

      if (result.error && onError) {
        onError(result.error);
        return;
      }

      if (result.done) {
        onDone();
        return;
      }

      if (result.content) {
        onChunk(result.content);
      }
    },
  });

  return {
    feed: (chunk) => parser.feed(chunk),
  };
}
