import { Show, createSignal, onMount } from 'solid-js';

// Helper to open external URLs (works in both browser and Tauri)
async function openExternal(url) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * NoApiKeysBanner - Welcome banner shown at start of each session.
 * Session-dismissable - stays hidden for the browser session after dismissal.
 *
 * @param {Object} props
 * @param {Object} props.configuredProviders - { openCodeZen: bool, openRouter: bool }
 * @param {Function} props.onOpenSettings - Callback to open settings modal
 */
function NoApiKeysBanner(props) {
  const STORAGE_KEY = 'welcomeBannerDismissed';
  const [dismissed, setDismissed] = createSignal(false);

  // Check sessionStorage on mount
  onMount(() => {
    const wasDismissed = sessionStorage.getItem(STORAGE_KEY) === 'true';
    setDismissed(wasDismissed);
  });

  function handleDismiss() {
    setDismissed(true);
    sessionStorage.setItem(STORAGE_KEY, 'true');
  }

  const hasAnyKey = () => {
    const providers = props.configuredProviders;
    return providers?.openCodeZen || providers?.openRouter;
  };

  return (
    <Show when={!dismissed()}>
      <div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-amber-200 dark:border-amber-800 animate-banner-in">
        <div class="max-w-4xl mx-auto px-4 py-4 sm:py-5">
          <div class="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            {/* Warning Icon */}
            <div class="flex-shrink-0 hidden sm:block mt-0.5">
              <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center">
                <svg class="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>

            {/* Content */}
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-amber-800 dark:text-amber-200">
                "If you're not paying for it, you're the product."
              </h3>
              <p class="text-sm text-gray-700 dark:text-gray-300 mt-1">
                Free AI services may use your conversations to train their models. Avoid sharing sensitive personal, financial, or confidential information.
              </p>
              <Show when={!hasAnyKey()}>
                <p class="text-sm text-blue-700 dark:text-blue-300 mt-2">
                  To get started, add an API key from OpenRouter or OpenCode Zen. Both offer free tiers.
                </p>
              </Show>
            </div>

            {/* CTA Button - only show if no keys configured */}
            <Show when={!hasAnyKey()}>
              <div class="flex-shrink-0">
                <button
                  onClick={props.onOpenSettings}
                  class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Add API Key
                </button>
              </div>
            </Show>

            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              class="flex-shrink-0 p-1.5 rounded text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
              title="Dismiss for this session"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Quick links - only show if no keys configured */}
          <Show when={!hasAnyKey()}>
            <div class="mt-3 pt-3 border-t border-blue-200/50 dark:border-blue-700/50 flex flex-wrap gap-4 text-xs">
              <button
                onClick={() => openExternal('https://openrouter.ai/keys')}
                class="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                Get OpenRouter key (free)
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
              <button
                onClick={() => openExternal('https://zen.opencode.ai')}
                class="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                Get OpenCode Zen key (free)
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

export default NoApiKeysBanner;
