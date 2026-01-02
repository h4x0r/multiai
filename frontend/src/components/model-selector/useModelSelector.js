import { createSignal, createResource, createMemo } from 'solid-js';

/**
 * useModelSelector - State management hook for model selection
 *
 * Handles:
 * - Fetching available models from API
 * - Tracking configured providers
 * - Persisting selection to localStorage
 * - Auto-selecting best available provider
 *
 * @returns {Object} State and actions for model selection
 */
export function useModelSelector() {
  // Persisted selection state
  const [selectedModel, setSelectedModel] = createSignal(
    loadFromStorage('multiAI:selectedModel', null)
  );

  // Provider configuration status
  const [configuredProviders, setConfiguredProviders] = createSignal(
    loadFromStorage('multiAI:configuredProviders', {})
  );

  // Fetch models from API
  const [models, { refetch: refetchModels }] = createResource(fetchModels);

  // Derived: models grouped for display
  const groupedModels = createMemo(() => {
    const data = models();
    if (!data) return [];

    // Group by model name, aggregate providers
    const grouped = new Map();

    data.forEach(model => {
      const existing = grouped.get(model.name);
      if (existing) {
        // Add provider to existing model
        if (!existing.providers.find(p => p.id === model.provider)) {
          existing.providers.push({
            id: model.provider,
            name: getProviderDisplayName(model.provider),
            isFree: model.isFree !== false,
            latency: model.latency,
          });
        }
      } else {
        // Create new model entry
        grouped.set(model.name, {
          id: model.id,
          name: model.name,
          capabilities: model.capabilities || [],
          providers: [{
            id: model.provider,
            name: getProviderDisplayName(model.provider),
            isFree: model.isFree !== false,
            latency: model.latency,
          }],
        });
      }
    });

    return Array.from(grouped.values());
  });

  // Select a model and provider
  function selectModel(selection) {
    setSelectedModel(selection);
    saveToStorage('multiAI:selectedModel', selection);
  }

  // Mark a provider as configured
  function configureProvider(providerId, isConfigured = true) {
    setConfiguredProviders(prev => {
      const next = { ...prev, [providerId]: isConfigured };
      saveToStorage('multiAI:configuredProviders', next);
      return next;
    });
  }

  // Get the best available provider for a model
  function getBestProvider(modelId) {
    const model = groupedModels().find(m => m.id === modelId);
    if (!model) return null;

    const configured = configuredProviders();

    // Prefer Zen if configured
    const zenProvider = model.providers.find(p => p.id === 'zen');
    if (zenProvider && configured.zen !== false) {
      return zenProvider;
    }

    // Fall back to first configured provider
    return model.providers.find(p => configured[p.id] !== false);
  }

  // Auto-select model if none selected and models available
  function autoSelectIfNeeded() {
    if (selectedModel()) return;

    const models = groupedModels();
    if (models.length === 0) return;

    const firstModel = models[0];
    const bestProvider = getBestProvider(firstModel.id);

    if (bestProvider) {
      selectModel({
        modelId: firstModel.id,
        providerId: bestProvider.id,
      });
    }
  }

  return {
    // State
    models: groupedModels,
    selectedModel,
    configuredProviders,
    isLoading: () => models.loading,
    error: () => models.error,

    // Actions
    selectModel,
    configureProvider,
    refetchModels,
    getBestProvider,
    autoSelectIfNeeded,
  };
}

/**
 * Fetch models from the API
 */
async function fetchModels() {
  try {
    const response = await fetch('/v1/models');
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();

    // Transform API response to our format
    return (data.data || []).map(model => ({
      id: model.id,
      name: model.name || extractModelName(model.id),
      provider: extractProvider(model.id),
      isFree: model.pricing?.free !== false,
      capabilities: model.capabilities || [],
      latency: model.latency,
    }));
  } catch (error) {
    console.error('Failed to fetch models:', error);
    throw error;
  }
}

/**
 * Extract model name from ID
 * e.g., "zen/glm-4.7" -> "GLM 4.7"
 */
function extractModelName(id) {
  const parts = id.split('/');
  const name = parts[parts.length - 1];

  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract provider from model ID
 * e.g., "zen/glm-4.7" -> "zen"
 */
function extractProvider(id) {
  const parts = id.split('/');
  return parts.length > 1 ? parts[0] : 'unknown';
}

/**
 * Get display name for provider
 */
function getProviderDisplayName(provider) {
  const names = {
    zen: 'Zen',
    openrouter: 'OpenRouter',
    opencode: 'OpenCode',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
  };

  return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Load value from localStorage with fallback
 */
function loadFromStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Save value to localStorage
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to save to localStorage:', error);
  }
}

export default useModelSelector;
