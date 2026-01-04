import { createSignal } from 'solid-js';

// Module-level SIGNAL (not store) - simpler reactivity model
// Signals always trigger updates when set, regardless of nested structure
const [comparisonResponses, setComparisonResponses] = createSignal({});

// Helper to clear all responses
function clearResponses() {
  setComparisonResponses({});
}

// Helper to set initial loading state for multiple models
function setInitialResponses(models) {
  const initial = {};
  models.forEach(model => {
    initial[model.id] = {
      loading: true,
      content: '',
      error: null,
      modelName: model.name
    };
  });
  setComparisonResponses(initial);
}

// Helper to update a single model's response
function setModelResponse(modelId, response) {
  setComparisonResponses(prev => ({
    ...prev,
    [modelId]: response
  }));
}

// Helper to append content for streaming (preserves other fields)
function appendModelContent(modelId, chunk) {
  setComparisonResponses(prev => {
    const current = prev[modelId] || { loading: true, content: '', error: null };
    return {
      ...prev,
      [modelId]: {
        ...current,
        content: current.content + chunk
      }
    };
  });
}

// Helper to remove a model's response
function removeModelResponse(modelId) {
  setComparisonResponses(prev => {
    const next = { ...prev };
    delete next[modelId];
    return next;
  });
}

export {
  comparisonResponses,
  setComparisonResponses,
  clearResponses,
  setInitialResponses,
  setModelResponse,
  appendModelContent,
  removeModelResponse
};
