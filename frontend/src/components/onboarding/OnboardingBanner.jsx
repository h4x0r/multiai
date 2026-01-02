import { createSignal, Show } from 'solid-js';

/**
 * OnboardingBanner - Non-blocking banner prompting API key setup
 *
 * Features:
 * - Dismissible with "Don't show again" option
 * - Accessible with proper ARIA roles
 * - Smooth enter/exit animations
 * - Respects reduced motion preferences
 *
 * @param {Object} props
 * @param {Function} props.onGetStarted - Callback when "Get Started" clicked
 * @param {boolean} props.show - Whether to show the banner
 * @param {Function} props.onDismiss - Callback when dismissed
 */
function OnboardingBanner(props) {
  const [isDismissing, setIsDismissing] = createSignal(false);

  function handleDismiss(permanent = false) {
    setIsDismissing(true);

    // Allow animation to complete before calling onDismiss
    setTimeout(() => {
      props.onDismiss?.(permanent);
    }, 200);
  }

  function handleGetStarted() {
    props.onGetStarted?.();
  }

  return (
    <Show when={props.show}>
      <div
        role="status"
        aria-live="polite"
        aria-label="API key setup required"
        class={`
          relative overflow-hidden
          bg-gradient-to-r from-blue-50 to-indigo-50
          dark:from-blue-900/20 dark:to-indigo-900/20
          border-b border-blue-200 dark:border-blue-800
          animate-banner-in
          ${isDismissing() ? 'opacity-0 -translate-y-full transition-all duration-200' : ''}
        `}
      >
        <div class="max-w-4xl mx-auto px-4 py-3 sm:py-2">
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
            {/* Icon */}
            <div class="flex-shrink-0 hidden sm:block">
              <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center">
                <svg
                  class="w-4 h-4 text-blue-600 dark:text-blue-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                  />
                </svg>
              </div>
            </div>

            {/* Message */}
            <div class="flex-1 min-w-0">
              <p class="text-sm text-blue-900 dark:text-blue-100">
                <span class="font-medium">Set up your free API keys</span>
                <span class="text-blue-700 dark:text-blue-300 ml-1">
                  to start comparing AI models side-by-side
                </span>
              </p>
            </div>

            {/* Actions */}
            <div class="flex items-center gap-2 w-full sm:w-auto">
              {/* Get Started button */}
              <button
                type="button"
                onClick={handleGetStarted}
                class="
                  flex-1 sm:flex-none
                  inline-flex items-center justify-center gap-2
                  px-4 py-2 sm:py-1.5
                  text-sm font-medium
                  text-white
                  bg-blue-600 hover:bg-blue-700
                  rounded-lg sm:rounded-md
                  transition-colors
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  dark:focus:ring-offset-gray-900
                  touch-target
                "
              >
                Get Started
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Dismiss button */}
              <button
                type="button"
                onClick={() => handleDismiss(false)}
                class="
                  p-2 sm:p-1.5
                  text-blue-600 dark:text-blue-400
                  hover:bg-blue-100 dark:hover:bg-blue-800/50
                  rounded-lg sm:rounded-md
                  transition-colors
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  touch-target
                "
                aria-label="Dismiss banner"
                title="Dismiss"
              >
                <svg
                  class="w-5 h-5 sm:w-4 sm:h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* "Don't show again" link - shown on hover/focus on desktop */}
          <div class="mt-2 sm:mt-0 sm:absolute sm:bottom-1 sm:right-4">
            <button
              type="button"
              onClick={() => handleDismiss(true)}
              class="
                text-xs text-blue-500 dark:text-blue-400
                hover:text-blue-700 dark:hover:text-blue-300
                hover:underline
                focus:outline-none focus:underline
              "
            >
              Don't show again
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default OnboardingBanner;
