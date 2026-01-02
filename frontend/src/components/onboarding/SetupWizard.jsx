import { createSignal, For, Show, createEffect } from 'solid-js';

/**
 * SetupWizard - Modal wizard for API key configuration
 *
 * Features:
 * - Step 1: Choose provider (Zen recommended, OpenRouter alternative)
 * - Step 2: Guided key retrieval with provider-specific instructions
 * - Step 3: Paste and verify API key
 * - Full keyboard navigation and focus management
 * - Mobile-responsive (fullscreen on mobile)
 * - Accessible with proper ARIA attributes
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether wizard is open
 * @param {Function} props.onClose - Callback when wizard is closed
 * @param {Function} props.onComplete - Callback when setup is complete
 * @param {Object} props.configuredProviders - Currently configured providers
 */
function SetupWizard(props) {
  const [currentStep, setCurrentStep] = createSignal(1);
  const [selectedProvider, setSelectedProvider] = createSignal(null);
  const [apiKey, setApiKey] = createSignal('');
  const [isVerifying, setIsVerifying] = createSignal(false);
  const [verifyError, setVerifyError] = createSignal(null);
  const [verifySuccess, setVerifySuccess] = createSignal(false);

  let modalRef;
  let previousActiveElement;

  // Provider configurations
  const providers = [
    {
      id: 'zen',
      name: 'OpenCode Zen',
      recommended: true,
      description: 'Recommended for best free model selection',
      signupUrl: 'https://opencode.ai/zen',
      instructions: [
        'Go to opencode.ai/zen and create a free account',
        'Navigate to Settings > API Keys',
        'Click "Create New Key" and copy the key',
        'Paste the key below',
      ],
      keyPattern: /^zen_[a-zA-Z0-9]{32,}$/,
      keyPlaceholder: 'zen_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      recommended: false,
      description: 'Alternative with wide model coverage',
      signupUrl: 'https://openrouter.ai/keys',
      instructions: [
        'Go to openrouter.ai/keys and sign in',
        'Click "Create Key" button',
        'Give your key a name (e.g., "MultiAI")',
        'Copy the key and paste it below',
      ],
      keyPattern: /^sk-or-[a-zA-Z0-9-]{40,}$/,
      keyPlaceholder: 'sk-or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
  ];

  // Focus trap and management
  createEffect(() => {
    if (props.isOpen) {
      previousActiveElement = document.activeElement;
      // Focus first focusable element after render
      requestAnimationFrame(() => {
        const firstFocusable = modalRef?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        firstFocusable?.focus();
      });
    } else {
      // Restore focus when closing
      previousActiveElement?.focus();
    }
  });

  // Handle escape key
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      handleClose();
    }

    // Focus trap
    if (e.key === 'Tab' && modalRef) {
      const focusableElements = modalRef.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }

  function handleClose() {
    // Reset state
    setCurrentStep(1);
    setSelectedProvider(null);
    setApiKey('');
    setVerifyError(null);
    setVerifySuccess(false);
    props.onClose?.();
  }

  function goToStep(step) {
    setCurrentStep(step);
    setVerifyError(null);
    setVerifySuccess(false);
  }

  function selectProvider(provider) {
    setSelectedProvider(provider);
    goToStep(2);
  }

  async function verifyApiKey() {
    const key = apiKey().trim();
    const provider = selectedProvider();

    if (!key || !provider) {
      setVerifyError('Please enter an API key');
      return;
    }

    // Basic format validation
    if (provider.keyPattern && !provider.keyPattern.test(key)) {
      setVerifyError(`Invalid key format. Expected format: ${provider.keyPlaceholder}`);
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);

    try {
      // Call backend to verify the key
      const response = await fetch('/api/settings/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider.id,
          apiKey: key,
        }),
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        setVerifySuccess(true);

        // Save the key
        await fetch('/api/settings/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider.id,
            apiKey: key,
          }),
        });

        // Complete after short delay to show success state
        setTimeout(() => {
          props.onComplete?.(provider.id);
          handleClose();
        }, 1500);
      } else {
        setVerifyError(data.error || 'Invalid API key. Please check and try again.');
      }
    } catch (error) {
      console.error('Key verification failed:', error);
      setVerifyError('Failed to verify key. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
    }
  }

  const currentProvider = () => providers.find(p => p.id === selectedProvider()?.id);

  return (
    <Show when={props.isOpen}>
      {/* Backdrop */}
      <div
        class="fixed inset-0 bg-black/50 z-40"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        onKeyDown={handleKeyDown}
        class="
          fixed z-50
          bg-white dark:bg-gray-800
          shadow-2xl

          /* Desktop: centered modal */
          sm:inset-x-auto sm:top-1/2 sm:left-1/2
          sm:-translate-x-1/2 sm:-translate-y-1/2
          sm:w-full sm:max-w-lg
          sm:rounded-xl
          sm:max-h-[85vh]

          /* Mobile: fullscreen */
          inset-0
          max-sm:rounded-none
        "
      >
        {/* Header */}
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2
              id="wizard-title"
              class="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Set Up API Keys
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Step {currentStep()} of 3
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            class="
              p-2 -m-2
              text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
              rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700
              transition-colors
              touch-target
            "
            aria-label="Close wizard"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress indicator */}
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-900/50">
          <div class="flex items-center gap-2">
            <For each={[1, 2, 3]}>
              {(step) => (
                <>
                  <div
                    class={`
                      w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                      transition-colors
                      ${step < currentStep()
                        ? 'bg-green-500 text-white'
                        : step === currentStep()
                          ? 'bg-accent text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }
                    `}
                    aria-current={step === currentStep() ? 'step' : undefined}
                  >
                    <Show when={step < currentStep()} fallback={step}>
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </Show>
                  </div>
                  <Show when={step < 3}>
                    <div class={`flex-1 h-0.5 ${step < currentStep() ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
                  </Show>
                </>
              )}
            </For>
          </div>
        </div>

        {/* Content */}
        <div class="px-6 py-6 overflow-y-auto max-h-[calc(85vh-200px)] sm:max-h-[400px]">
          {/* Step 1: Choose Provider */}
          <Show when={currentStep() === 1}>
            <div class="animate-step-in">
              <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">
                Choose your AI provider
              </h3>

              <div class="space-y-3">
                <For each={providers}>
                  {(provider) => (
                    <button
                      type="button"
                      onClick={() => selectProvider(provider)}
                      class={`
                        w-full p-4 text-left
                        border-2 rounded-xl
                        transition-all
                        hover:border-accent hover:shadow-md
                        focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:focus:ring-offset-gray-800
                        ${props.configuredProviders?.[provider.id]
                          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                        }
                      `}
                    >
                      <div class="flex items-start gap-3">
                        <div class={`
                          w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                          ${provider.recommended
                            ? 'bg-accent/10 text-accent'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }
                        `}>
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                        </div>

                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-gray-900 dark:text-gray-100">
                              {provider.name}
                            </span>
                            <Show when={provider.recommended}>
                              <span class="px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent rounded-full">
                                Recommended
                              </span>
                            </Show>
                            <Show when={props.configuredProviders?.[provider.id]}>
                              <span class="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 rounded-full">
                                Configured
                              </span>
                            </Show>
                          </div>
                          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {provider.description}
                          </p>
                        </div>

                        <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Step 2: Get API Key */}
          <Show when={currentStep() === 2}>
            <div class="animate-step-in">
              <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">
                Get your {currentProvider()?.name} API key
              </h3>

              <ol class="space-y-4 mb-6">
                <For each={currentProvider()?.instructions || []}>
                  {(instruction, index) => (
                    <li class="flex gap-3">
                      <span class="flex-shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-sm font-medium flex items-center justify-center">
                        {index() + 1}
                      </span>
                      <span class="text-sm text-gray-700 dark:text-gray-300 pt-0.5">
                        {instruction}
                      </span>
                    </li>
                  )}
                </For>
              </ol>

              <a
                href={currentProvider()?.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="
                  inline-flex items-center gap-2
                  px-4 py-2.5
                  text-sm font-medium
                  text-white
                  bg-accent hover:bg-accent-hover
                  rounded-lg
                  transition-colors
                  focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:focus:ring-offset-gray-800
                "
              >
                Open {currentProvider()?.name}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              <p class="mt-4 text-xs text-gray-500 dark:text-gray-400">
                Opens in a new tab. Return here after copying your key.
              </p>
            </div>
          </Show>

          {/* Step 3: Paste & Verify */}
          <Show when={currentStep() === 3}>
            <div class="animate-step-in">
              <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">
                Paste your API key
              </h3>

              <div class="space-y-4">
                <div>
                  <label
                    for="api-key-input"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                  >
                    {currentProvider()?.name} API Key
                  </label>
                  <input
                    id="api-key-input"
                    type="password"
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.target.value)}
                    placeholder={currentProvider()?.keyPlaceholder}
                    autocomplete="off"
                    spellcheck={false}
                    disabled={isVerifying() || verifySuccess()}
                    class={`
                      w-full px-4 py-3
                      text-sm font-mono
                      bg-gray-50 dark:bg-gray-900
                      border rounded-lg
                      transition-colors
                      focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent
                      disabled:opacity-50 disabled:cursor-not-allowed
                      ${verifyError()
                        ? 'border-red-300 dark:border-red-700'
                        : verifySuccess()
                          ? 'border-green-300 dark:border-green-700'
                          : 'border-gray-300 dark:border-gray-600'
                      }
                    `}
                  />
                </div>

                {/* Error message */}
                <Show when={verifyError()}>
                  <div class="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <svg class="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p class="text-sm text-red-700 dark:text-red-300">{verifyError()}</p>
                  </div>
                </Show>

                {/* Success message */}
                <Show when={verifySuccess()}>
                  <div class="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <p class="text-sm text-green-700 dark:text-green-300">
                      API key verified successfully! Saving...
                    </p>
                  </div>
                </Show>

                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Your API key is stored securely and never shared.
                </p>
              </div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          {/* Back button */}
          <Show
            when={currentStep() > 1}
            fallback={
              <button
                type="button"
                onClick={handleClose}
                class="
                  px-4 py-2
                  text-sm font-medium
                  text-gray-600 dark:text-gray-400
                  hover:text-gray-900 dark:hover:text-gray-100
                  rounded-lg
                  transition-colors
                  focus:outline-none focus:ring-2 focus:ring-gray-300
                "
              >
                Skip for now
              </button>
            }
          >
            <button
              type="button"
              onClick={() => goToStep(currentStep() - 1)}
              class="
                inline-flex items-center gap-1.5
                px-4 py-2
                text-sm font-medium
                text-gray-600 dark:text-gray-400
                hover:text-gray-900 dark:hover:text-gray-100
                rounded-lg
                transition-colors
                focus:outline-none focus:ring-2 focus:ring-gray-300
              "
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </Show>

          {/* Next/Verify button */}
          <Show when={currentStep() === 2}>
            <button
              type="button"
              onClick={() => goToStep(3)}
              class="
                inline-flex items-center gap-1.5
                px-4 py-2
                text-sm font-medium
                text-white
                bg-accent hover:bg-accent-hover
                rounded-lg
                transition-colors
                focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:focus:ring-offset-gray-800
              "
            >
              I have my key
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </Show>

          <Show when={currentStep() === 3}>
            <button
              type="button"
              onClick={verifyApiKey}
              disabled={!apiKey().trim() || isVerifying() || verifySuccess()}
              class="
                inline-flex items-center gap-2
                px-4 py-2
                text-sm font-medium
                text-white
                bg-accent hover:bg-accent-hover
                disabled:bg-gray-300 dark:disabled:bg-gray-700
                disabled:cursor-not-allowed
                rounded-lg
                transition-colors
                focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 dark:focus:ring-offset-gray-800
              "
            >
              <Show
                when={!isVerifying()}
                fallback={
                  <>
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Verifying...
                  </>
                }
              >
                <Show
                  when={!verifySuccess()}
                  fallback={
                    <>
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Done!
                    </>
                  }
                >
                  Verify & Save
                </>
                </Show>
              </Show>
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}

export default SetupWizard;
