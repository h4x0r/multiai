import { createSignal, createEffect, For, Show } from 'solid-js';

/**
 * ModelSelector - Grouped dropdown with Zen-first provider ordering
 *
 * @param {Object} props
 * @param {Function} props.onSelect - Called with (modelId, source) when selected
 * @param {Object} props.configuredProviders - { openCodeZen: bool, openRouter: bool }
 * @param {Function} props.onConfigureProvider - Called when user clicks unconfigured provider
 */
export default function ModelSelector(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [models, setModels] = createSignal([]);
  const [selected, setSelected] = createSignal(null);
  const [loading, setLoading] = createSignal(true);

  // Fetch grouped models on mount
  createEffect(async () => {
    try {
      const res = await fetch('/v1/models/grouped');
      const data = await res.json();
      setModels(data.models || []);

      // Auto-select first available model
      if (data.models?.length > 0 && !selected()) {
        const first = data.models[0];
        const provider = first.providers.find(p =>
          props.configuredProviders?.[sourceToKey(p.source)]
        ) || first.providers[0];

        if (provider) {
          setSelected({ name: first.name, ...provider });
          props.onSelect?.(provider.id, provider.source);
        }
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoading(false);
    }
  });

  function sourceToKey(source) {
    return source === 'open_code_zen' ? 'openCodeZen' : 'openRouter';
  }

  function sourceLabel(source) {
    return source === 'open_code_zen' ? 'Zen' : 'OpenRouter';
  }

  function handleSelect(model, provider) {
    const isConfigured = props.configuredProviders?.[sourceToKey(provider.source)];

    if (!isConfigured) {
      props.onConfigureProvider?.(sourceToKey(provider.source));
      return;
    }

    setSelected({ name: model.name, ...provider });
    props.onSelect?.(provider.id, provider.source);
    setIsOpen(false);
  }

  return (
    <div class="relative">
      {/* Selected display */}
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="flex items-center gap-2 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors min-w-[160px]"
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
      >
        <Show when={!loading()} fallback={<span class="text-gray-400">Loading...</span>}>
          <span class="truncate">
            {selected()?.name || 'Select model'}
          </span>
          <Show when={selected()}>
            <span class="text-xs text-gray-400">
              ({sourceLabel(selected()?.source)})
            </span>
          </Show>
        </Show>
        <svg class="w-4 h-4 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      <Show when={isOpen()}>
        <div
          class="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto"
          role="listbox"
        >
          <For each={models()}>
            {(model) => (
              <div class="py-1">
                {/* Model name header */}
                <div class="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                  {model.name}
                </div>

                {/* Provider options */}
                <For each={model.providers}>
                  {(provider) => {
                    const isConfigured = () => props.configuredProviders?.[sourceToKey(provider.source)];
                    const isSelected = () => selected()?.id === provider.id;

                    return (
                      <button
                        onClick={() => handleSelect(model, provider)}
                        class={`w-full text-left px-3 py-2 pl-6 text-sm flex items-center gap-2 transition-colors ${
                          isSelected()
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : isConfigured()
                            ? 'hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300'
                            : 'text-gray-400 dark:text-gray-500'
                        }`}
                        role="option"
                        aria-selected={isSelected()}
                        aria-disabled={!isConfigured()}
                      >
                        <span class={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isSelected()
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          <Show when={isSelected()}>
                            <span class="w-2 h-2 bg-white rounded-full" />
                          </Show>
                        </span>

                        <span>{sourceLabel(provider.source)}</span>
                        <span class="text-xs text-green-600 dark:text-green-400">(free)</span>

                        <Show when={!isConfigured()}>
                          <span class="ml-auto text-xs text-amber-600 dark:text-amber-400">
                            Set up
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>

          <Show when={models().length === 0 && !loading()}>
            <div class="px-3 py-4 text-sm text-gray-500 text-center">
              No models available
            </div>
          </Show>
        </div>
      </Show>

      {/* Click outside to close */}
      <Show when={isOpen()}>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      </Show>
    </div>
  );
}
