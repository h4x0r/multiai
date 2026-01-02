import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';

/**
 * ModelSelector - Grouped dropdown for selecting AI models and providers
 *
 * Features:
 * - Models grouped by name with providers indented below
 * - Zen provider listed first when available
 * - Radio selection within each model group
 * - Grayed out providers if API key not configured
 * - Clicking grayed provider triggers settings callback
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - WCAG 2.1 AA compliant focus indicators
 * - Mobile-responsive with touch-friendly targets
 *
 * @param {Object} props
 * @param {Array} props.models - Array of model configs with providers
 * @param {Object} props.selectedModel - Currently selected { modelId, providerId }
 * @param {Function} props.onSelect - Callback when selection changes
 * @param {Function} props.onConfigureProvider - Callback when unconfigured provider clicked
 * @param {Object} props.configuredProviders - Map of providerId -> boolean
 * @param {boolean} props.disabled - Whether selector is disabled
 * @param {string} props.class - Additional CSS classes
 */
function ModelSelector(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [searchQuery, setSearchQuery] = createSignal('');

  let triggerRef;
  let listboxRef;
  let searchTimeoutId;

  // Flatten models with providers for keyboard navigation
  const flatOptions = () => {
    const options = [];
    const models = filteredModels();

    models.forEach((model, modelIndex) => {
      model.providers.forEach((provider, providerIndex) => {
        options.push({
          modelId: model.id,
          modelName: model.name,
          providerId: provider.id,
          providerName: provider.name,
          isFree: provider.isFree,
          isConfigured: props.configuredProviders?.[provider.id] !== false,
          modelIndex,
          providerIndex,
          isFirstProvider: providerIndex === 0,
        });
      });
    });

    return options;
  };

  // Filter models based on search query
  const filteredModels = () => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return sortedModels();

    return sortedModels().filter(model =>
      model.name.toLowerCase().includes(query) ||
      model.providers.some(p => p.name.toLowerCase().includes(query))
    );
  };

  // Sort models: prioritize those with Zen provider, then alphabetically
  const sortedModels = () => {
    if (!props.models) return [];

    return [...props.models].map(model => ({
      ...model,
      // Sort providers: Zen first, then by name
      providers: [...model.providers].sort((a, b) => {
        if (a.id === 'zen' && b.id !== 'zen') return -1;
        if (a.id !== 'zen' && b.id === 'zen') return 1;
        return a.name.localeCompare(b.name);
      })
    })).sort((a, b) => a.name.localeCompare(b.name));
  };

  // Get display text for current selection
  const selectedDisplayText = () => {
    if (!props.selectedModel) return 'Select a model';

    const model = props.models?.find(m => m.id === props.selectedModel.modelId);
    if (!model) return 'Select a model';

    const provider = model.providers.find(p => p.id === props.selectedModel.providerId);
    const providerSuffix = provider ? ` (${provider.name})` : '';

    return `${model.name}${providerSuffix}`;
  };

  // Handle keyboard navigation
  function handleKeyDown(e) {
    if (props.disabled) return;

    const options = flatOptions();
    const currentIndex = focusedIndex();

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!isOpen()) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else if (currentIndex >= 0 && currentIndex < options.length) {
          selectOption(options[currentIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        triggerRef?.focus();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen()) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else {
          setFocusedIndex(Math.min(currentIndex + 1, options.length - 1));
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (isOpen()) {
          setFocusedIndex(Math.max(currentIndex - 1, 0));
        }
        break;

      case 'Home':
        e.preventDefault();
        if (isOpen()) {
          setFocusedIndex(0);
        }
        break;

      case 'End':
        e.preventDefault();
        if (isOpen()) {
          setFocusedIndex(options.length - 1);
        }
        break;

      case 'Tab':
        if (isOpen()) {
          setIsOpen(false);
          setSearchQuery('');
        }
        break;

      default:
        // Type-ahead search
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          handleTypeAhead(e.key);
        }
        break;
    }
  }

  // Type-ahead search functionality
  function handleTypeAhead(char) {
    clearTimeout(searchTimeoutId);
    setSearchQuery(prev => prev + char);

    // Clear search after 500ms of no typing
    searchTimeoutId = setTimeout(() => {
      setSearchQuery('');
    }, 500);

    // Focus first matching option
    const options = flatOptions();
    const query = (searchQuery() + char).toLowerCase();
    const matchIndex = options.findIndex(opt =>
      opt.modelName.toLowerCase().startsWith(query)
    );

    if (matchIndex >= 0) {
      setFocusedIndex(matchIndex);
    }
  }

  // Select an option
  function selectOption(option) {
    if (!option.isConfigured) {
      // Trigger settings for unconfigured provider
      props.onConfigureProvider?.(option.providerId);
      return;
    }

    props.onSelect?.({
      modelId: option.modelId,
      providerId: option.providerId,
    });

    setIsOpen(false);
    setSearchQuery('');
    triggerRef?.focus();
  }

  // Toggle dropdown
  function toggleOpen() {
    if (props.disabled) return;

    setIsOpen(!isOpen());
    if (!isOpen()) {
      setFocusedIndex(0);
    }
  }

  // Close on outside click
  function handleClickOutside(e) {
    if (isOpen() && triggerRef && !triggerRef.contains(e.target) &&
        listboxRef && !listboxRef.contains(e.target)) {
      setIsOpen(false);
      setSearchQuery('');
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
    clearTimeout(searchTimeoutId);
  });

  // Scroll focused option into view
  createEffect(() => {
    const index = focusedIndex();
    if (isOpen() && index >= 0 && listboxRef) {
      const option = listboxRef.querySelector(`[data-index="${index}"]`);
      option?.scrollIntoView({ block: 'nearest' });
    }
  });

  // Generate unique ID for ARIA
  const listboxId = `model-selector-listbox-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div class={`relative ${props.class || ''}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
        aria-controls={listboxId}
        aria-label="Select AI model"
        class={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 sm:py-2
          text-sm text-left
          bg-white dark:bg-gray-800
          border border-gray-300 dark:border-gray-600
          rounded-lg
          transition-all duration-150
          ${props.disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-gray-400 dark:hover:border-gray-500 cursor-pointer'
          }
          ${isOpen()
            ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-gray-900 border-accent'
            : ''
          }
          focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 dark:focus:ring-offset-gray-900
        `}
      >
        <span class="truncate text-gray-900 dark:text-gray-100">
          {selectedDisplayText()}
        </span>

        <svg
          class={`w-4 h-4 flex-shrink-0 text-gray-500 transition-transform duration-150 ${isOpen() ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Listbox */}
      <Show when={isOpen()}>
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="AI models and providers"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          class={`
            absolute z-50 mt-1
            w-full min-w-[280px] max-h-[60vh] sm:max-h-80
            overflow-y-auto
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg
            py-1
            focus:outline-none

            /* Mobile: bottom sheet style on small screens */
            max-sm:fixed max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-auto
            max-sm:w-auto max-sm:max-h-[70vh]
            max-sm:rounded-xl max-sm:shadow-2xl
            max-sm:border-0
            max-sm:animate-slide-up
          `}
        >
          {/* Mobile header with close button */}
          <div class="sm:hidden flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <span class="font-medium text-gray-900 dark:text-gray-100">Select Model</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close"
            >
              <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Model Groups */}
          <For each={filteredModels()}>
            {(model) => (
              <ModelGroup
                model={model}
                selectedModel={props.selectedModel}
                configuredProviders={props.configuredProviders}
                flatOptions={flatOptions()}
                focusedIndex={focusedIndex()}
                onSelect={selectOption}
              />
            )}
          </For>

          {/* Empty state */}
          <Show when={filteredModels().length === 0}>
            <div class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <p class="text-sm">No models available</p>
              <p class="text-xs mt-1">Configure API keys to enable models</p>
            </div>
          </Show>
        </div>

        {/* Mobile backdrop */}
        <div
          class="sm:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}

/**
 * ModelGroup - A single model with its provider options
 */
function ModelGroup(props) {
  const isSelected = (providerId) =>
    props.selectedModel?.modelId === props.model.id &&
    props.selectedModel?.providerId === providerId;

  const getFlatIndex = (providerId) =>
    props.flatOptions.findIndex(opt =>
      opt.modelId === props.model.id && opt.providerId === providerId
    );

  return (
    <div class="py-1" role="group" aria-label={props.model.name}>
      {/* Model Header */}
      <div class="px-3 py-1.5 flex items-center gap-2">
        <svg
          class="w-4 h-4 text-amber-500"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {props.model.name}
        </span>
        <Show when={props.model.capabilities?.length > 0}>
          <div class="flex gap-1 ml-auto">
            <For each={props.model.capabilities?.slice(0, 2)}>
              {(cap) => (
                <span class="px-1.5 py-0.5 text-[10px] font-medium uppercase rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                  {cap}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Provider Options */}
      <For each={props.model.providers}>
        {(provider) => {
          const flatIndex = getFlatIndex(provider.id);
          const isFocused = () => props.focusedIndex === flatIndex;
          const isConfigured = props.configuredProviders?.[provider.id] !== false;

          return (
            <ProviderOption
              provider={provider}
              modelId={props.model.id}
              isSelected={isSelected(provider.id)}
              isFocused={isFocused()}
              isConfigured={isConfigured}
              flatIndex={flatIndex}
              onSelect={props.onSelect}
            />
          );
        }}
      </For>
    </div>
  );
}

/**
 * ProviderOption - Individual provider radio option
 */
function ProviderOption(props) {
  const optionId = `provider-${props.modelId}-${props.provider.id}`;

  function handleClick() {
    props.onSelect({
      modelId: props.modelId,
      providerId: props.provider.id,
      providerName: props.provider.name,
      modelName: props.provider.name,
      isConfigured: props.isConfigured,
    });
  }

  return (
    <div
      role="option"
      id={optionId}
      data-index={props.flatIndex}
      aria-selected={props.isSelected}
      aria-disabled={!props.isConfigured}
      onClick={handleClick}
      class={`
        relative flex items-center gap-3
        ml-6 mr-2 px-3 py-2.5 sm:py-2
        rounded-md cursor-pointer
        transition-colors duration-100

        /* Touch-friendly sizing */
        min-h-[44px] sm:min-h-0

        /* States */
        ${props.isConfigured
          ? props.isSelected
            ? 'bg-accent/10 text-accent'
            : props.isFocused
              ? 'bg-gray-100 dark:bg-gray-700'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
          : 'opacity-50 cursor-pointer hover:opacity-75'
        }

        /* Focus indicator */
        ${props.isFocused ? 'ring-2 ring-accent ring-inset' : ''}
      `}
    >
      {/* Tree connector line */}
      <div
        class="absolute left-0 top-1/2 w-3 h-px bg-gray-300 dark:bg-gray-600 -translate-x-3"
        aria-hidden="true"
      />

      {/* Radio indicator */}
      <div
        class={`
          w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
          transition-colors duration-100
          ${props.isSelected
            ? 'border-accent bg-accent'
            : 'border-gray-300 dark:border-gray-600'
          }
          ${!props.isConfigured ? 'border-dashed' : ''}
        `}
        aria-hidden="true"
      >
        <Show when={props.isSelected}>
          <div class="w-1.5 h-1.5 rounded-full bg-white" />
        </Show>
      </div>

      {/* Provider name and status */}
      <div class="flex-1 flex items-center gap-2 min-w-0">
        <span class={`text-sm truncate ${
          props.isSelected
            ? 'font-medium'
            : 'text-gray-700 dark:text-gray-300'
        }`}>
          {props.provider.name}
        </span>

        {/* Free badge */}
        <Show when={props.provider.isFree}>
          <span class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
            free
          </span>
        </Show>

        {/* Unconfigured indicator */}
        <Show when={!props.isConfigured}>
          <span class="text-xs text-gray-400 dark:text-gray-500">
            (configure)
          </span>
        </Show>
      </div>

      {/* Latency indicator (optional) */}
      <Show when={props.provider.latency}>
        <span class={`text-xs ${
          props.provider.latency === 'fast'
            ? 'text-green-600 dark:text-green-400'
            : props.provider.latency === 'slow'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-500'
        }`}>
          {props.provider.latency === 'fast' && 'Fast'}
          {props.provider.latency === 'medium' && 'Medium'}
          {props.provider.latency === 'slow' && 'Slow'}
        </span>
      </Show>
    </div>
  );
}

export default ModelSelector;

// Export sub-components for flexibility
export { ModelGroup, ProviderOption };
