import { Show, For, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { SolidMarkdown } from 'solid-markdown';
import { comparisonResponses } from '../stores/comparisonStore';

// Helper to open external URLs (works in both browser and Tauri)
async function openExternal(url) {
  try {
    // Try Tauri shell API first
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    // Fallback to window.open for browser
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * ComparisonPane - Minimal pane with inline model selector
 *
 * @param {Object} props
 * @param {Object} props.model - Current model { id, name, source }
 * @param {string} props.colorDot - Tailwind class for color dot
 * @param {Array} props.availableModels - All available models for dropdown
 * @param {Function} props.onModelChange - Callback when model is changed
 * @param {Function} props.onRemove - Optional callback to remove this pane
 * @param {boolean} props.canRemove - Whether remove button should show
 * @param {boolean} props.hasMessages - Whether there are messages in the chat
 * @param {Object} props.configuredProviders - { openCodeZen: bool, openRouter: bool }
 */
function ComparisonPane(props) {
  const [showCopy, setShowCopy] = createSignal(false);
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  // Track clicked unconfigured model: { source, providerId, rect }
  const [clickedUnconfigured, setClickedUnconfigured] = createSignal(null);

  // Access this model's response from the shared signal
  // Signal getter comparisonResponses() returns the full object
  const response = () => {
    const modelId = props.model?.id;
    const all = comparisonResponses(); // Call signal getter
    const resp = all[modelId] || {};
    // Debug logging
    if (props.hasMessages && !resp.loading && !resp.content) {
      console.log('[ComparisonPane] Waiting state - modelId:', modelId, 'all keys:', Object.keys(all), 'resp:', resp);
    }
    return resp;
  };

  const hasContent = () => !!response().content;
  const isLoading = () => response().loading;
  const hasError = () => !!response().error;

  function sourceToKey(source) {
    if (source === 'ollama') return 'ollama';
    if (source === 'open_code_zen') return 'openCodeZen';
    if (source === 'openrouter' || source === 'open_router') return 'openRouter';
    return null;
  }

  function sourceLabel(source) {
    if (source === 'ollama') return 'Local';
    return source === 'open_code_zen' ? 'Zen' : 'OR';
  }

  function isProviderConfigured(source) {
    // Ollama is always "configured" (no API key needed)
    if (source === 'ollama') return true;
    return props.configuredProviders?.[sourceToKey(source)] ?? false;
  }

  function getApiKeyUrl(source) {
    if (source === 'open_code_zen') return 'https://zen.opencode.ai';
    return 'https://openrouter.ai/keys';
  }

  function getProviderDisplayName(source) {
    if (source === 'open_code_zen') return 'OpenCode Zen';
    return 'OpenRouter';
  }

  async function handleCopy() {
    if (response().content) {
      try {
        await navigator.clipboard.writeText(response().content);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  }

  function handleModelSelect(model, provider, event) {
    if (!isProviderConfigured(provider.source)) {
      // Show speech bubble next to the clicked unconfigured model
      const rect = event.currentTarget.getBoundingClientRect();
      setClickedUnconfigured({ source: provider.source, providerId: provider.id, rect });
      return;
    }
    setClickedUnconfigured(null);
    props.onModelChange?.({
      id: provider.id,
      name: model.name,
      source: provider.source
    });
    setDropdownOpen(false);
  }

  function handleCloseDropdown() {
    setDropdownOpen(false);
    setClickedUnconfigured(null);
  }

  return (
    <div
      class="flex flex-col h-full"
      onMouseEnter={() => setShowCopy(true)}
      onMouseLeave={() => setShowCopy(false)}
    >
      {/* Header with model selector dropdown */}
      <div class="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-800 overflow-hidden">
        <span class={`w-2 h-2 rounded-full ${props.colorDot} flex-shrink-0`} />

        {/* Model dropdown trigger - takes remaining space */}
        <div class="relative min-w-0 flex-1">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen())}
            class="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <span class="truncate max-w-[120px]">{props.model?.name || 'Select model'}</span>
            <svg class="w-3 h-3 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown menu */}
          <Show when={dropdownOpen()}>
            <div class="absolute top-full left-0 mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
              <For each={props.availableModels || []}>
                {(model) => (
                  <For each={model.providers}>
                    {(provider) => {
                      const configured = isProviderConfigured(provider.source);
                      const isSelected = props.model?.id === provider.id;
                      const isInOtherPane = !isSelected && (props.selectedModelIds || []).includes(provider.id);
                      const isClicked = () => clickedUnconfigured()?.providerId === provider.id;

                      return (
                        <button
                          onClick={(e) => !isInOtherPane && handleModelSelect(model, provider, e)}
                          class={`group w-full text-left px-3 py-1.5 text-xs tracking-tight flex items-center gap-2 ${
                            isSelected
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : isInOtherPane
                              ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-40'
                              : configured
                              ? 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                              : isClicked()
                              ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'
                              : 'text-gray-400 dark:text-gray-600 cursor-pointer opacity-50 hover:opacity-70'
                          }`}
                          title={isInOtherPane ? 'Already selected' : !configured ? 'API key required' : undefined}
                        >
                          <span class="flex-1 truncate">{model.name}</span>
                          <span class="text-xs text-gray-500">{sourceLabel(provider.source)}</span>
                        </button>
                      );
                    }}
                  </For>
                )}
              </For>
            </div>

            {/* Speech bubble tooltip - rendered via Portal to escape overflow clipping */}
            <Show when={clickedUnconfigured()}>
              <Portal>
                <div
                  class="fixed z-[100] w-56"
                  style={{
                    left: `${clickedUnconfigured().rect.right + 8}px`,
                    top: `${clickedUnconfigured().rect.top - 4}px`,
                  }}
                >
                  {/* Arrow pointing left */}
                  <div class="absolute left-0 top-4 -translate-x-full">
                    <div class="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[8px] border-r-amber-100 dark:border-r-amber-800" />
                  </div>
                  {/* Tooltip content */}
                  <div class="bg-amber-50 dark:bg-amber-900 border border-amber-200 dark:border-amber-700 rounded-lg shadow-xl px-3 py-2.5 text-xs">
                    <div class="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center justify-between">
                      <span>{getProviderDisplayName(clickedUnconfigured()?.source)} key needed</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setClickedUnconfigured(null);
                        }}
                        class="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-0.5"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <ol class="list-decimal list-inside space-y-1.5 text-gray-700 dark:text-gray-300">
                      <li>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openExternal(getApiKeyUrl(clickedUnconfigured()?.source));
                          }}
                          class="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Get free key
                        </button>
                      </li>
                      <li>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseDropdown();
                            props.onOpenSettings?.(clickedUnconfigured()?.source);
                          }}
                          class="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Open Settings
                        </button>
                        {' '}→ paste → Save
                      </li>
                    </ol>
                  </div>
                </div>
              </Portal>
            </Show>
          </Show>
        </div>

        {/* Performance badge - unified pill: TTFT | Total */}
        <Show when={!isLoading() && (response().responseTimeMs || response().ttftMs)}>
          <div class="flex items-center flex-shrink-0 text-[10px] rounded-full overflow-hidden border border-gray-200 dark:border-gray-700" title="Time to first token | Total response time">
            <Show when={response().ttftMs}>
              <span class="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 whitespace-nowrap">
                {response().ttftMs >= 1000 ? `${(response().ttftMs / 1000).toFixed(1)}s` : `${response().ttftMs}ms`}
              </span>
            </Show>
            <Show when={response().responseTimeMs}>
              <span class="px-1.5 py-0.5 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {response().responseTimeMs >= 1000 ? `${(response().responseTimeMs / 1000).toFixed(1)}s` : `${response().responseTimeMs}ms`}
              </span>
            </Show>
          </div>
        </Show>

        {/* Remove button */}
        <Show when={props.canRemove}>
          <button
            onClick={props.onRemove}
            class="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            title="Remove pane"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </Show>
      </div>

      {/* Click outside to close dropdown */}
      <Show when={dropdownOpen()}>
        <div class="fixed inset-0 z-40" onClick={handleCloseDropdown} />
      </Show>

      {/* Content area - unified conversation view */}
      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {/* User messages */}
        <For each={props.userMessages || []}>
          {(message) => (
            <div class="text-sm bg-accent/10 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2">
              <SolidMarkdown children={message.content} />
            </div>
          )}
        </For>

        {/* Loading spinner (before first content) */}
        <Show when={isLoading() && !hasContent()}>
          <div class="flex items-center gap-2 py-2">
            <svg class="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span class="text-sm text-gray-400">Thinking...</span>
          </div>
        </Show>

        {/* Error state */}
        <Show when={hasError()}>
          <div class="text-sm text-red-600 dark:text-red-400 py-1 px-2 bg-red-50 dark:bg-red-900/20 rounded">
            {response().error}
          </div>
        </Show>

        {/* Model response */}
        <Show when={hasContent()}>
          <div class="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100">
            <SolidMarkdown children={response().content} />
            <Show when={isLoading()}>
              <span class="cursor-blink">|</span>
            </Show>
          </div>
        </Show>

        {/* Empty state - no messages yet */}
        <Show when={!props.userMessages?.length && !isLoading() && !hasError() && !hasContent()}>
          <div class="text-sm text-gray-400 dark:text-gray-500 italic text-center py-8">
            Start typing to compare responses
          </div>
        </Show>
      </div>

      {/* Copy button - appears on hover */}
      <Show when={hasContent() && !isLoading()}>
        <div class={`flex justify-end px-3 pb-2 transition-opacity ${showCopy() ? 'opacity-100' : 'opacity-0'}`}>
          <button
            onClick={handleCopy}
            title="Copy"
            class="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  );
}

export default ComparisonPane;
