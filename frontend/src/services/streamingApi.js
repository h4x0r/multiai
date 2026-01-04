/**
 * Streaming API service for chat completions.
 * Uses SSE (Server-Sent Events) for real-time streaming responses.
 */
import { createSSEParser } from './sseParser';

/**
 * Stream a chat completion request.
 * @param {Object} options
 * @param {string} options.model - The model to use
 * @param {Array} options.messages - The messages to send
 * @param {Function} options.onChunk - Called with each content chunk
 * @param {Function} options.onComplete - Called when stream completes
 * @param {Function} [options.onError] - Called on error
 * @param {AbortSignal} [options.signal] - Optional abort signal
 */
export async function streamChatCompletion({
  model,
  messages,
  onChunk,
  onComplete,
  onError,
  signal,
}) {
  const startTime = performance.now();
  let ttftMs = null;
  let fullContent = '';

  try {
    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error?.message || 'Request failed';
      if (onError) {
        onError(errorMessage);
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let completed = false;

    const parser = createSSEParser({
      onChunk: (content) => {
        if (ttftMs === null) {
          ttftMs = performance.now() - startTime;
        }
        fullContent += content;
        onChunk(content);
      },
      onDone: () => {
        if (completed) return;
        completed = true;
        const responseTimeMs = performance.now() - startTime;
        onComplete({
          content: fullContent,
          responseTimeMs,
          ttftMs: ttftMs ?? responseTimeMs,
        });
      },
      onError: (error) => {
        if (onError) {
          onError(error);
        }
      },
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
    }

    // Ensure completion is called even if stream closes without [DONE]
    if (!completed && fullContent) {
      completed = true;
      const responseTimeMs = performance.now() - startTime;
      onComplete({
        content: fullContent,
        responseTimeMs,
        ttftMs: ttftMs ?? responseTimeMs,
      });
    }
  } catch (error) {
    if (onError) {
      onError(error.message || 'Unknown error');
    }
  }
}
