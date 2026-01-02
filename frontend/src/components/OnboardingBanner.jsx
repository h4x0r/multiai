import { Show } from 'solid-js';

/**
 * OnboardingBanner - Non-blocking banner prompting API key setup
 *
 * @param {Object} props
 * @param {boolean} props.show - Whether to show the banner
 * @param {Function} props.onGetStarted - Called when user clicks Get Started
 * @param {Function} props.onDismiss - Called when user dismisses (permanent = true if "don't show again")
 */
export default function OnboardingBanner(props) {
  return (
    <Show when={props.show}>
      <div
        class="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-center justify-between max-w-4xl mx-auto">
          <div class="flex items-center gap-3">
            <span class="text-2xl" aria-hidden="true">🔑</span>
            <div>
              <p class="text-sm font-medium text-blue-800 dark:text-blue-200">
                Set up your free API keys to start comparing models
              </p>
              <p class="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                Takes about 2 minutes. No credit card required.
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              onClick={() => props.onGetStarted?.()}
              class="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Get Started
            </button>
            <button
              onClick={() => props.onDismiss?.(false)}
              class="p-1.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 rounded transition-colors"
              aria-label="Dismiss"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
