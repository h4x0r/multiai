import { createSignal, Show, onMount } from 'solid-js';

/**
 * FreeAiWarning - Session-dismissable warning about free AI privacy implications.
 * Shown at the start of each new chat (when no messages yet).
 * Persists dismissal in sessionStorage so it stays hidden for the browser session.
 *
 * @param {Object} props
 * @param {boolean} props.show - Whether to show (typically: messages.length === 0)
 */
function FreeAiWarning(props) {
  const STORAGE_KEY = 'freeAiWarningDismissed';

  const [dismissed, setDismissed] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  // Check sessionStorage on mount
  onMount(() => {
    const wasDismissed = sessionStorage.getItem(STORAGE_KEY) === 'true';
    setDismissed(wasDismissed);
  });

  function handleDismiss() {
    setDismissed(true);
    sessionStorage.setItem(STORAGE_KEY, 'true');
  }

  // Only show if: props.show is true AND not dismissed this session
  const shouldShow = () => props.show && !dismissed();

  return (
    <Show when={shouldShow()}>
      <div class="mx-4 my-3 animate-banner-in">
        <div class="max-w-2xl mx-auto bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg overflow-hidden">
          {/* Collapsed view */}
          <div class="px-4 py-3 flex items-start gap-3">
            {/* Warning icon */}
            <div class="flex-shrink-0 mt-0.5">
              <svg class="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            {/* Content */}
            <div class="flex-1 min-w-0">
              <p class="text-sm text-amber-800 dark:text-amber-200">
                <span class="font-medium">Privacy note:</span>{' '}
                Free AI services may use your conversations to improve their models.
                <button
                  onClick={() => setExpanded(!expanded())}
                  class="ml-1 text-amber-600 dark:text-amber-400 hover:underline font-medium"
                >
                  {expanded() ? 'Show less' : 'Learn more'}
                </button>
              </p>

              {/* Expanded content */}
              <Show when={expanded()}>
                <div class="mt-3 pt-3 border-t border-amber-200 dark:border-amber-700/50 text-sm text-amber-700 dark:text-amber-300 space-y-2">
                  <p>
                    <strong>"If you're not paying for it, you're the product."</strong>
                  </p>
                  <p>
                    Free AI providers typically retain and analyze conversations to train and improve their models.
                    While this helps make AI better, it means your prompts and conversations may be reviewed by humans
                    or used in training data.
                  </p>
                  <p class="font-medium">
                    Recommendations:
                  </p>
                  <ul class="list-disc list-inside space-y-1 ml-2">
                    <li>Avoid sharing sensitive personal information (SSN, passwords, health data)</li>
                    <li>Don't include confidential business information or trade secrets</li>
                    <li>Be cautious with private conversations or personal details</li>
                    <li>Consider paid tiers for sensitive use cases (they typically offer data privacy)</li>
                  </ul>
                </div>
              </Show>
            </div>

            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              class="flex-shrink-0 p-1 rounded text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-800/30 transition-colors"
              title="Dismiss for this session"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default FreeAiWarning;
