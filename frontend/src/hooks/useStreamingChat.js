/**
 * Solid.js reactive hook for streaming chat completions.
 * Bridges StreamingClient to reactive UI state.
 */
import { createSignal, onCleanup } from 'solid-js';
import { StreamingClient } from '../services/streaming';

// Singleton client - shared across all hook instances
let client = null;

function getClient() {
  if (!client) {
    client = new StreamingClient({
      retry: { maxAttempts: 3, baseDelayMs: 1000 },
      circuit: { failureThreshold: 5, resetTimeMs: 60000 },
      // Telemetry disabled - self-contained app, no external dependencies
      telemetryOptions: { endpoint: null },
    });
  }
  return client;
}

/**
 * Generate a unique request ID.
 */
function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Hook for streaming chat to multiple models.
 * @returns {{
 *   responses: () => Object,
 *   isStreaming: () => boolean,
 *   streamToModels: (models: Array, messages: Array) => Promise<Object[]>,
 *   abort: () => void
 * }}
 */
export function useStreamingChat() {
  const [responses, setResponses] = createSignal({});
  const [isStreaming, setIsStreaming] = createSignal(false);
  const activeRequestIds = new Set();

  /**
   * Stream chat completion to multiple models in parallel.
   * @param {Array} models - Array of { id, name } model objects
   * @param {Array} messages - Array of chat messages
   * @returns {Promise<Object[]>} Results for each model
   */
  async function streamToModels(models, messages) {
    const streamingClient = getClient();
    setIsStreaming(true);

    // Initialize loading state for all models
    const initial = {};
    models.forEach((model) => {
      initial[model.id] = {
        loading: true,
        content: '',
        error: null,
        modelName: model.name,
      };
    });
    setResponses(initial);

    // Stream to all models in parallel
    const promises = models.map((model) => {
      const requestId = createRequestId();
      activeRequestIds.add(requestId);

      return new Promise((resolve) => {
        streamingClient.stream(requestId, {
          model: model.id,
          messages,
          onChunk: (chunk) => {
            setResponses((prev) => ({
              ...prev,
              [model.id]: {
                ...prev[model.id],
                content: prev[model.id].content + chunk,
              },
            }));
          },
          onComplete: (result) => {
            activeRequestIds.delete(requestId);
            setResponses((prev) => ({
              ...prev,
              [model.id]: {
                ...prev[model.id],
                loading: false,
                responseTimeMs: Math.round(result.responseTimeMs),
                ttftMs: result.ttftMs ? Math.round(result.ttftMs) : null,
              },
            }));
            resolve({
              modelId: model.id,
              success: true,
              content: result.content,
            });
          },
          onError: (error) => {
            activeRequestIds.delete(requestId);
            const errorMessage = error.message || error;
            setResponses((prev) => ({
              ...prev,
              [model.id]: {
                ...prev[model.id],
                loading: false,
                error: errorMessage,
              },
            }));
            resolve({
              modelId: model.id,
              success: false,
              error: errorMessage,
            });
          },
        });
      });
    });

    const results = await Promise.all(promises);
    setIsStreaming(false);
    return results;
  }

  /**
   * Abort all active streaming requests.
   */
  function abort() {
    getClient().abortAll();
    activeRequestIds.clear();
    setIsStreaming(false);
  }

  // Cleanup on unmount
  onCleanup(() => abort());

  return {
    responses,
    isStreaming,
    streamToModels,
    abort,
  };
}
