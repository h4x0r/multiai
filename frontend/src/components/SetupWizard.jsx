import { createSignal, Show, Switch, Match, For } from 'solid-js';

/**
 * SetupWizard - 3-step modal for API key setup
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether wizard is open
 * @param {Function} props.onClose - Called when wizard is closed
 * @param {Function} props.onComplete - Called with provider ID when setup completes
 * @param {Object} props.configuredProviders - { openCodeZen: bool, openRouter: bool }
 */
export default function SetupWizard(props) {
  const [step, setStep] = createSignal(1);
  const [provider, setProvider] = createSignal(null); // 'zen' or 'openrouter'
  const [apiKey, setApiKey] = createSignal('');
  const [verifying, setVerifying] = createSignal(false);
  const [error, setError] = createSignal(null);

  function reset() {
    setStep(1);
    setProvider(null);
    setApiKey('');
    setError(null);
  }

  function handleClose() {
    reset();
    props.onClose?.();
  }

  function selectProvider(p) {
    setProvider(p);
    setStep(2);
  }

  async function verifyAndSave() {
    setVerifying(true);
    setError(null);

    try {
      // Save to localStorage (in production, would verify with backend)
      const key = provider() === 'zen' ? 'OPENCODE_ZEN_API_KEY' : 'OPENROUTER_API_KEY';
      localStorage.setItem(key, apiKey());

      // Signal completion
      props.onComplete?.(provider() === 'zen' ? 'openCodeZen' : 'openRouter');

      setStep(3);
    } catch (err) {
      setError('Failed to verify API key. Please check and try again.');
    } finally {
      setVerifying(false);
    }
  }

  const providerInfo = {
    zen: {
      name: 'OpenCode Zen',
      models: '5 free models',
      signupUrl: 'https://opencode.ai/signup',
      keysUrl: 'https://opencode.ai/settings/api',
      steps: [
        'Go to opencode.ai and create a free account',
        'Navigate to Settings → API Keys',
        'Click "Create new key" and copy it',
        'Paste your key below'
      ]
    },
    openrouter: {
      name: 'OpenRouter',
      models: '10+ free models',
      signupUrl: 'https://openrouter.ai/signup',
      keysUrl: 'https://openrouter.ai/keys',
      steps: [
        'Go to openrouter.ai and sign up (Google/GitHub works)',
        'Navigate to Keys in your dashboard',
        'Click "Create Key" and copy it',
        'Paste your key below'
      ]
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* Backdrop */}
      <div class="fixed inset-0 bg-black/50 z-50" onClick={handleClose} />

      {/* Modal */}
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Set Up API Keys
            </h2>
            <button
              onClick={handleClose}
              class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress */}
          <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-750">
            <For each={[1, 2, 3]}>
              {(s) => (
                <div class="flex items-center">
                  <div class={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    s < step()
                      ? 'bg-green-500 text-white'
                      : s === step()
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                  }`}>
                    {s < step() ? '✓' : s}
                  </div>
                  <Show when={s < 3}>
                    <div class={`w-12 h-0.5 mx-1 ${
                      s < step() ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'
                    }`} />
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Content */}
          <div class="p-6">
            <Switch>
              {/* Step 1: Choose provider */}
              <Match when={step() === 1}>
                <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">
                  Which provider do you want to set up?
                </h3>

                <div class="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => selectProvider('zen')}
                    class="p-4 border-2 border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-left"
                  >
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      OpenCode Zen
                    </div>
                    <div class="text-xs text-green-600 dark:text-green-400 mt-1">
                      5 free models
                    </div>
                    <div class="text-xs text-blue-600 dark:text-blue-400 mt-2">
                      Recommended
                    </div>
                  </button>

                  <button
                    onClick={() => selectProvider('openrouter')}
                    class="p-4 border-2 border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-left"
                  >
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      OpenRouter
                    </div>
                    <div class="text-xs text-green-600 dark:text-green-400 mt-1">
                      10+ free models
                    </div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-2">
                      More variety
                    </div>
                  </button>
                </div>

                <p class="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
                  Set up both for maximum coverage
                </p>
              </Match>

              {/* Step 2: Get key */}
              <Match when={step() === 2}>
                <h3 class="text-base font-medium text-gray-900 dark:text-gray-100 mb-4">
                  Get your {providerInfo[provider()]?.name} API key
                </h3>

                <ol class="space-y-3 mb-6">
                  <For each={providerInfo[provider()]?.steps || []}>
                    {(stepText, i) => (
                      <li class="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
                        <span class="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-center">
                          {i() + 1}
                        </span>
                        <span>{stepText}</span>
                      </li>
                    )}
                  </For>
                </ol>

                <a
                  href={providerInfo[provider()]?.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block w-full py-2 text-center text-sm bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors mb-4"
                >
                  Open {providerInfo[provider()]?.name} →
                </a>

                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Paste your API key
                  </label>
                  <input
                    type="password"
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <Show when={error()}>
                  <p class="text-sm text-red-600 dark:text-red-400 mt-2">{error()}</p>
                </Show>

                <div class="flex gap-3 mt-6">
                  <button
                    onClick={() => setStep(1)}
                    class="flex-1 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={verifyAndSave}
                    disabled={!apiKey() || verifying()}
                    class="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                  >
                    {verifying() ? 'Verifying...' : 'Save Key'}
                  </button>
                </div>
              </Match>

              {/* Step 3: Done */}
              <Match when={step() === 3}>
                <div class="text-center py-6">
                  <div class="text-4xl mb-4">✅</div>
                  <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                    {providerInfo[provider()]?.name} is set up!
                  </h3>
                  <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    You now have access to {providerInfo[provider()]?.models}.
                  </p>

                  <div class="flex gap-3">
                    <button
                      onClick={() => { reset(); setStep(1); }}
                      class="flex-1 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                    >
                      Add another provider
                    </button>
                    <button
                      onClick={handleClose}
                      class="flex-1 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Start chatting
                    </button>
                  </div>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  );
}
