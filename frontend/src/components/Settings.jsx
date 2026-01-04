import { createSignal, onMount, Show } from 'solid-js';

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
 * Validation state enum-like constants
 */
const ValidationState = {
  IDLE: 'idle',
  VALIDATING: 'validating',
  SUCCESS: 'success',
  ERROR: 'error',
};

export default function Settings(props) {
  const [openRouterKey, setOpenRouterKey] = createSignal('');
  const [openCodeZenKey, setOpenCodeZenKey] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [showOpenRouter, setShowOpenRouter] = createSignal(false);
  const [showZen, setShowZen] = createSignal(false);
  const [theme, setTheme] = createSignal(localStorage.getItem('theme') || 'system');

  // Refs for input focus
  let openRouterInputRef;
  let openCodeZenInputRef;

  // Validation states for each provider
  const [openRouterValidation, setOpenRouterValidation] = createSignal({
    state: ValidationState.IDLE,
    message: null,
  });
  const [openCodeZenValidation, setOpenCodeZenValidation] = createSignal({
    state: ValidationState.IDLE,
    message: null,
  });

  // Check if key is a masked placeholder (can't be revealed)
  const isMaskedKey = (key) => key && key.includes('••••');

  // Check if key is new (not masked and not empty)
  const isNewKey = (key) => key && !isMaskedKey(key);

  // Load current settings on mount
  onMount(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        // Keys come back masked, so we show placeholders
        if (data.openrouter_configured) {
          setOpenRouterKey('••••••••••••••••');
        }
        if (data.opencode_zen_configured) {
          setOpenCodeZenKey('••••••••••••••••');
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }

    // Focus the correct input if focusField is specified
    setTimeout(() => {
      if (props.focusField === 'openrouter' || props.focusField === 'open_router') {
        openRouterInputRef?.focus();
        openRouterInputRef?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (props.focusField === 'opencode_zen' || props.focusField === 'open_code_zen') {
        openCodeZenInputRef?.focus();
        openCodeZenInputRef?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  });

  /**
   * Validate an API key by making a test request
   * @param {string} provider - 'openrouter' or 'opencode_zen'
   * @param {string} key - The API key to validate
   * @returns {Promise<{valid: boolean, message: string}>}
   */
  async function validateApiKey(provider, key) {
    const endpoint = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/models'
      : 'https://zen.opencode.ai/v1/models';

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        return { valid: true, message: 'API key is valid' };
      } else if (response.status === 401 || response.status === 403) {
        return { valid: false, message: 'Invalid API key' };
      } else {
        return { valid: false, message: `Validation failed (${response.status})` };
      }
    } catch (err) {
      if (err.name === 'TimeoutError') {
        return { valid: false, message: 'Validation timed out - key may still work' };
      }
      // Network errors might be CORS - key could still be valid
      return { valid: false, message: 'Could not verify - network error' };
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const updates = {};
    let hasValidationErrors = false;

    // Validate OpenRouter key if new
    if (isNewKey(openRouterKey())) {
      setOpenRouterValidation({ state: ValidationState.VALIDATING, message: null });

      const result = await validateApiKey('openrouter', openRouterKey());

      if (result.valid) {
        setOpenRouterValidation({ state: ValidationState.SUCCESS, message: result.message });
        updates.openrouter_api_key = openRouterKey();
      } else {
        setOpenRouterValidation({ state: ValidationState.ERROR, message: result.message });
        // Don't block save, but warn user
        hasValidationErrors = true;
        updates.openrouter_api_key = openRouterKey(); // Still allow saving
      }
    } else if (openRouterKey() === '') {
      // User cleared the key
      updates.openrouter_api_key = '';
    }

    // Validate OpenCode Zen key if new
    if (isNewKey(openCodeZenKey())) {
      setOpenCodeZenValidation({ state: ValidationState.VALIDATING, message: null });

      const result = await validateApiKey('opencode_zen', openCodeZenKey());

      if (result.valid) {
        setOpenCodeZenValidation({ state: ValidationState.SUCCESS, message: result.message });
        updates.opencode_zen_api_key = openCodeZenKey();
      } else {
        setOpenCodeZenValidation({ state: ValidationState.ERROR, message: result.message });
        hasValidationErrors = true;
        updates.opencode_zen_api_key = openCodeZenKey(); // Still allow saving
      }
    } else if (openCodeZenKey() === '') {
      updates.opencode_zen_api_key = '';
    }

    // If no updates, just close
    if (Object.keys(updates).length === 0) {
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (res.ok) {
        setSaved(true);
        if (hasValidationErrors) {
          setError('Saved with validation warnings - keys may not work correctly');
        }
        setTimeout(() => {
          setSaved(false);
          setError(null);
        }, 3000);
        // Notify parent to refresh models
        props.onSettingsChanged?.();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save settings');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleClearKey(provider) {
    if (provider === 'openrouter') {
      setOpenRouterKey('');
      setOpenRouterValidation({ state: ValidationState.IDLE, message: null });
    } else {
      setOpenCodeZenKey('');
      setOpenCodeZenValidation({ state: ValidationState.IDLE, message: null });
    }
  }

  function handleKeyInput(provider, value) {
    if (provider === 'openrouter') {
      setOpenRouterKey(value);
      // Reset validation state when typing
      if (openRouterValidation().state !== ValidationState.IDLE) {
        setOpenRouterValidation({ state: ValidationState.IDLE, message: null });
      }
    } else {
      setOpenCodeZenKey(value);
      if (openCodeZenValidation().state !== ValidationState.IDLE) {
        setOpenCodeZenValidation({ state: ValidationState.IDLE, message: null });
      }
    }
  }

  function handleThemeChange(newTheme) {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
    props.onThemeChange?.(newTheme);
  }

  function applyTheme(themeSetting) {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');

    if (themeSetting === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      root.classList.add(themeSetting);
    }
  }

  // Apply theme on mount
  onMount(() => {
    applyTheme(theme());
  });

  /**
   * Render validation status indicator
   */
  function ValidationIndicator(props) {
    const { validation } = props;

    return (
      <Show when={validation.state !== ValidationState.IDLE}>
        <div class={`flex items-center gap-1.5 mt-1.5 text-xs ${
          validation.state === ValidationState.VALIDATING ? 'text-blue-600 dark:text-blue-400' :
          validation.state === ValidationState.SUCCESS ? 'text-green-600 dark:text-green-400' :
          'text-amber-600 dark:text-amber-400'
        }`}>
          <Show when={validation.state === ValidationState.VALIDATING}>
            <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Validating...</span>
          </Show>

          <Show when={validation.state === ValidationState.SUCCESS}>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <span>{validation.message}</span>
          </Show>

          <Show when={validation.state === ValidationState.ERROR}>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{validation.message}</span>
          </Show>
        </div>
      </Show>
    );
  }

  return (
    <div class="p-6 max-w-2xl mx-auto">
      <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
        Settings
      </h2>

      {/* Theme Section */}
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          Appearance
        </h3>

        <div class="flex gap-3">
          <button
            onClick={() => handleThemeChange('system')}
            class={`flex-1 p-3 rounded-lg border-2 transition-all ${
              theme() === 'system'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div class="flex flex-col items-center gap-2">
              <svg class="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">System</span>
            </div>
          </button>

          <button
            onClick={() => handleThemeChange('light')}
            class={`flex-1 p-3 rounded-lg border-2 transition-all ${
              theme() === 'light'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div class="flex flex-col items-center gap-2">
              <svg class="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Light</span>
            </div>
          </button>

          <button
            onClick={() => handleThemeChange('dark')}
            class={`flex-1 p-3 rounded-lg border-2 transition-all ${
              theme() === 'dark'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div class="flex flex-col items-center gap-2">
              <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Dark</span>
            </div>
          </button>
        </div>
      </div>

      {/* API Keys Section */}
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          API Keys
        </h3>

        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Configure API keys to access AI models. Keys are validated before saving and stored locally.
        </p>

        {/* OpenRouter API Key */}
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            OpenRouter API Key
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Get your key at{' '}
            <button onClick={() => openExternal('https://openrouter.ai/keys')} class="text-blue-600 dark:text-blue-400 hover:underline">
              openrouter.ai/keys
            </button>
          </p>
          <div class="flex gap-2">
            <div class="flex-1 relative">
              <Show when={showOpenRouter()} fallback={
                <input
                  ref={openRouterInputRef}
                  type="password"
                  value={openRouterKey()}
                  onInput={(e) => handleKeyInput('openrouter', e.target.value)}
                  placeholder="sk-or-v1-..."
                  class={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    openRouterValidation().state === ValidationState.ERROR
                      ? 'border-amber-400 dark:border-amber-500'
                      : openRouterValidation().state === ValidationState.SUCCESS
                      ? 'border-green-400 dark:border-green-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
              }>
                <input
                  ref={openRouterInputRef}
                  type="text"
                  value={openRouterKey()}
                  onInput={(e) => handleKeyInput('openrouter', e.target.value)}
                  placeholder="sk-or-v1-..."
                  class={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    openRouterValidation().state === ValidationState.ERROR
                      ? 'border-amber-400 dark:border-amber-500'
                      : openRouterValidation().state === ValidationState.SUCCESS
                      ? 'border-green-400 dark:border-green-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
              </Show>
              <Show when={openRouterKey() && !isMaskedKey(openRouterKey())}>
                <button
                  type="button"
                  onClick={() => setShowOpenRouter(!showOpenRouter())}
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                  title={showOpenRouter() ? 'Hide key' : 'Show key'}
                >
                  <Show when={showOpenRouter()} fallback={
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  }>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  </Show>
                </button>
              </Show>
            </div>
            <Show when={openRouterKey()}>
              <button
                onClick={() => handleClearKey('openrouter')}
                class="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                Clear
              </button>
            </Show>
          </div>
          <ValidationIndicator validation={openRouterValidation()} />
        </div>

        {/* OpenCode Zen API Key */}
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            OpenCode Zen API Key
          </label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Get your key at{' '}
            <button onClick={() => openExternal('https://zen.opencode.ai')} class="text-blue-600 dark:text-blue-400 hover:underline">
              zen.opencode.ai
            </button>
          </p>
          <div class="flex gap-2">
            <div class="flex-1 relative">
              <Show when={showZen()} fallback={
                <input
                  ref={openCodeZenInputRef}
                  type="password"
                  value={openCodeZenKey()}
                  onInput={(e) => handleKeyInput('opencode_zen', e.target.value)}
                  placeholder="sk-..."
                  class={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    openCodeZenValidation().state === ValidationState.ERROR
                      ? 'border-amber-400 dark:border-amber-500'
                      : openCodeZenValidation().state === ValidationState.SUCCESS
                      ? 'border-green-400 dark:border-green-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
              }>
                <input
                  ref={openCodeZenInputRef}
                  type="text"
                  value={openCodeZenKey()}
                  onInput={(e) => handleKeyInput('opencode_zen', e.target.value)}
                  placeholder="sk-..."
                  class={`w-full px-3 py-2 pr-10 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    openCodeZenValidation().state === ValidationState.ERROR
                      ? 'border-amber-400 dark:border-amber-500'
                      : openCodeZenValidation().state === ValidationState.SUCCESS
                      ? 'border-green-400 dark:border-green-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
              </Show>
              <Show when={openCodeZenKey() && !isMaskedKey(openCodeZenKey())}>
                <button
                  type="button"
                  onClick={() => setShowZen(!showZen())}
                  class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                  title={showZen() ? 'Hide key' : 'Show key'}
                >
                  <Show when={showZen()} fallback={
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  }>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  </Show>
                </button>
              </Show>
            </div>
            <Show when={openCodeZenKey()}>
              <button
                onClick={() => handleClearKey('zen')}
                class="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                Clear
              </button>
            </Show>
          </div>
          <ValidationIndicator validation={openCodeZenValidation()} />
        </div>

        {/* Save button and status */}
        <div class="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving() || openRouterValidation().state === ValidationState.VALIDATING || openCodeZenValidation().state === ValidationState.VALIDATING}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving() || openRouterValidation().state === ValidationState.VALIDATING || openCodeZenValidation().state === ValidationState.VALIDATING
              ? 'Validating...'
              : 'Save Changes'}
          </button>

          <Show when={saved()}>
            <span class="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              Settings saved
            </span>
          </Show>

          <Show when={error()}>
            <span class="text-sm text-amber-600 dark:text-amber-400">
              {error()}
            </span>
          </Show>
        </div>
      </div>

      {/* About Section */}
      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          About MultiAI
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Compare answers from multiple free AI models side by side. No subscriptions, no limits.
        </p>
        <div class="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Version 0.0.1
        </div>
        <div class="pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => openExternal('https://www.securityronin.com')}
            class="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
          >
            <img src="/security-ronin-logo.png" alt="Security Ronin" class="h-8 w-auto" />
            <span>A Security Ronin production</span>
          </button>
        </div>
      </div>
    </div>
  );
}
