import { createSignal, createEffect, onMount, For, Show, onCleanup } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import MessageInput from './components/MessageInput';
import Settings from './components/Settings';
import NoApiKeysBanner from './components/NoApiKeysBanner';
import { comparisonResponses, clearResponses, setComparisonResponses, removeModelResponse } from './stores/comparisonStore';
import { useStreamingChat } from './hooks/useStreamingChat';

// Loading screen component with progress bar
function LoadingScreen(props) {
  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900 transition-opacity duration-500 ${
        props.fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div class="flex flex-col items-center gap-6 px-8">
        {/* Logo / Branding */}
        <div class="flex items-center gap-3">
          <img
            src="/multiai-logo.svg"
            alt="MultiAI"
            class="w-12 h-12"
          />
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
            MultiAI
          </h1>
        </div>

        {/* Progress bar container */}
        <div class="w-64 sm:w-80">
          <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-accent to-blue-500 rounded-full transition-all duration-500 ease-out progress-bar-animate"
              style={{ width: `${props.progress}%` }}
            />
          </div>
        </div>

        {/* Status text */}
        <p class="text-sm text-gray-600 dark:text-gray-400 min-h-[1.5rem] transition-all duration-300">
          {props.status}
        </p>
      </div>
    </div>
  );
}

function App() {
  const params = useParams();
  const navigate = useNavigate();

  // Use the new streaming hook with retry, circuit breaker, and abort support
  const streaming = useStreamingChat();

  const [chats, setChats] = createSignal([]);
  const [currentChat, setCurrentChat] = createSignal(null);
  const [messages, setMessages] = createSignal([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [modelsAvailable, setModelsAvailable] = createSignal(null); // null = loading, true/false = checked
  const [modelCount, setModelCount] = createSignal(0);
  const [showExportMenu, setShowExportMenu] = createSignal(false);
  const [configuredProviders, setConfiguredProviders] = createSignal({ openCodeZen: false, openRouter: false });

  // Selected models for panes (always in comparison/pane mode)
  const [selectedModelsForComparison, setSelectedModelsForComparison] = createSignal([]);
  // comparisonResponses store is imported from ./stores/comparisonStore
  const [availableModels, setAvailableModels] = createSignal([]);

  // Responsive max panes based on window width
  const [maxPanes, setMaxPanes] = createSignal(3);

  function updateMaxPanes() {
    const width = window.innerWidth;
    if (width < 768) {
      setMaxPanes(1); // Mobile: 1 pane (tabs later)
    } else if (width < 1024) {
      setMaxPanes(2); // Tablet: 2 panes
    } else {
      setMaxPanes(3); // Desktop: 3 panes
    }
  }

  // Settings modal state
  const [showSettings, setShowSettings] = createSignal(false);
  const [settingsFocusField, setSettingsFocusField] = createSignal(null);

  // Helper to open settings with optional field focus
  function openSettings(focusField = null) {
    setSettingsFocusField(focusField);
    setShowSettings(true);
  }

  // Sidebar collapsed state - persisted in localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    localStorage.getItem('sidebarCollapsed') === 'true'
  );

  // Sidebar width for drag resizing (persisted)
  const [sidebarWidth, setSidebarWidth] = createSignal(
    parseInt(localStorage.getItem('sidebarWidth')) || 240
  );
  const [isResizing, setIsResizing] = createSignal(false);

  function handleResizeStart(e) {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResizeMove(e) {
    if (!isResizing()) return;
    const newWidth = Math.max(180, Math.min(400, e.clientX));
    setSidebarWidth(newWidth);
  }

  function handleResizeEnd() {
    if (isResizing()) {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebarWidth', sidebarWidth().toString());
    }
  }

  function toggleSidebarCollapsed() {
    const newValue = !sidebarCollapsed();
    setSidebarCollapsed(newValue);
    localStorage.setItem('sidebarCollapsed', String(newValue));
  }

  // Loading state for app startup
  const [appReady, setAppReady] = createSignal(false);
  const [loadingStatus, setLoadingStatus] = createSignal('Starting up...');
  const [loadingProgress, setLoadingProgress] = createSignal(0);
  const [loadingFadeOut, setLoadingFadeOut] = createSignal(false);

  // Initialize theme from localStorage
  function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'system';
    const root = document.documentElement;
    root.classList.remove('light', 'dark');

    if (savedTheme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      root.classList.add(savedTheme);
    }
  }

  // App startup sequence
  onMount(async () => {
    // Initialize theme immediately
    initializeTheme();

    // === Native app behavior: disable browser-like interactions ===
    // Disable default context menu (elements can opt-in with data-context-menu attribute)
    const handleContextMenu = (e) => {
      if (!e.target.closest('[data-context-menu]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);

    // Disable browser keyboard shortcuts to feel more native
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Block browser shortcuts (allow Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z for text editing)
      if (modifier) {
        const allowedKeys = ['c', 'v', 'x', 'a', 'z', 'y']; // Copy, Paste, Cut, Select All, Undo, Redo
        if (!allowedKeys.includes(e.key.toLowerCase())) {
          // Block Cmd+R (refresh), Cmd+P (print), Cmd+S (save), Cmd+F (find), etc.
          if (['r', 'p', 's', 'f', 'g', 'o', 'n', 'w', 't', 'l', 'd', 'u', 'i', 'j', 'k', 'b'].includes(e.key.toLowerCase())) {
            e.preventDefault();
          }
        }
      }
      // Block F5 (refresh), F12 (devtools in some browsers)
      if (['F5', 'F7', 'F12'].includes(e.key)) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (localStorage.getItem('theme') === 'system') {
        initializeTheme();
      }
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    // Set up responsive pane tracking
    updateMaxPanes();
    window.addEventListener('resize', updateMaxPanes);

    // Set up sidebar resize listeners
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);

    onCleanup(() => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMaxPanes);
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    });

    await initializeApp();
  });

  async function initializeApp() {
    try {
      // Step 1: Check backend health
      setLoadingStatus('Connecting to server...');
      setLoadingProgress(10);

      const healthOk = await checkBackendHealth();
      if (!healthOk) {
        setLoadingStatus('Waiting for server...');
        // Retry health check with shorter intervals
        let retries = 0;
        const maxRetries = 10;
        while (retries < maxRetries) {
          await delay(Math.min(300 * Math.pow(1.3, retries), 2000));
          setLoadingProgress(10 + (retries * 2));
          const ok = await checkBackendHealth();
          if (ok) break;
          retries++;
          setLoadingStatus(`Waiting for server... (attempt ${retries + 1})`);
        }
      }

      setLoadingProgress(30);
      setLoadingStatus('Server connected!');

      // Step 2: Load provider settings and models
      setLoadingStatus('Checking providers...');
      setLoadingProgress(45);
      await loadProviderSettings();

      setLoadingStatus('Loading models...');
      setLoadingProgress(55);
      await checkModels();
      setLoadingProgress(65);

      // Step 2b: Auto-select first 3 models for comparison mode (default)
      setLoadingStatus('Setting up comparison view...');
      await autoSelectModels();
      setLoadingProgress(70);

      // Step 3: Load chats
      setLoadingStatus('Loading chats...');
      setLoadingProgress(85);
      await loadChats();

      // Step 4: Load specific chat if in route
      if (params.id) {
        setLoadingStatus('Loading conversation...');
        setLoadingProgress(95);
        await loadChat(params.id);
      }

      // Complete!
      setLoadingProgress(100);
      setLoadingStatus('Ready!');

      // Fade out loading screen quickly
      setLoadingFadeOut(true);
      await delay(200);
      setAppReady(true);

    } catch (err) {
      console.error('App initialization error:', err);
      setLoadingStatus('Error starting app. Retrying...');
      await delay(2000);
      await initializeApp();
    }
  }

  async function checkBackendHealth() {
    try {
      const res = await fetch('/health', {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        const data = await res.json();
        return data.status === 'ok';
      }
      return false;
    } catch (err) {
      console.warn('Health check failed:', err.message);
      return false;
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Load chat when route changes (but not while streaming)
  createEffect(async () => {
    // Skip loading if we're actively streaming - prevents clearing responses mid-stream
    if (isStreaming()) return;
    if (params.id && params.id !== currentChat()?.id) {
      await loadChat(params.id);
    }
  });

  async function checkModels() {
    try {
      const res = await fetch('/v1/models');
      const data = await res.json();
      const count = data.data?.length || 0;
      setModelCount(count);
      setModelsAvailable(count > 0);
    } catch (err) {
      console.error('Failed to check models:', err);
      setModelsAvailable(false);
    }
  }

  async function loadProviderSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setConfiguredProviders({
        openCodeZen: data.opencode_zen_configured || false,
        openRouter: data.openrouter_configured || false,
      });
    } catch (err) {
      console.error('Failed to load provider settings:', err);
    }
  }

  // Auto-select models for panes on startup (with localStorage persistence)
  async function autoSelectModels() {
    try {
      const res = await fetch('/v1/models/grouped');
      const data = await res.json();

      // Store all models for pane dropdowns
      const models = data.models || [];
      setAvailableModels(models);

      // Try to restore from localStorage first
      const saved = localStorage.getItem('selectedModels');
      if (saved) {
        try {
          const savedModels = JSON.parse(saved);
          if (Array.isArray(savedModels) && savedModels.length > 0) {
            // Validate saved models still exist and have configured providers
            const validModels = savedModels.filter(sm => {
              for (const model of models) {
                for (const provider of (model.providers || [])) {
                  if (provider.id === sm.id && isProviderConfigured(provider.source)) {
                    return true;
                  }
                }
              }
              return false;
            });
            if (validModels.length > 0) {
              setSelectedModelsForComparison(validModels);
              return;
            }
          }
        } catch (e) {
          console.warn('Failed to parse saved models:', e);
        }
      }

      // Flatten models - only include configured providers
      const flat = [];
      models.forEach(model => {
        (model.providers || []).forEach(provider => {
          if (isProviderConfigured(provider.source)) {
            flat.push({
              id: provider.id,
              name: model.name,
              source: provider.source,
            });
          }
        });
      });

      // Auto-select models for panes (prefer 2 if available, otherwise 1)
      if (flat.length >= 2) {
        setSelectedModelsForComparison(flat.slice(0, 2));
      } else if (flat.length === 1) {
        setSelectedModelsForComparison([flat[0]]);
      }
      // If no models, panes will be empty and UI handles gracefully
    } catch (err) {
      console.error('Failed to auto-select models:', err);
    }
  }

  // Helper to check if provider is configured
  function isProviderConfigured(source) {
    const providers = configuredProviders();
    if (source === 'open_code_zen') return providers.openCodeZen;
    if (source === 'openrouter' || source === 'open_router') return providers.openRouter;
    return false;
  }

  // Persist model selections to localStorage
  createEffect(() => {
    const models = selectedModelsForComparison();
    if (models.length > 0) {
      localStorage.setItem('selectedModels', JSON.stringify(models));
    }
  });

  // Sync hook's responses to the store for child components
  createEffect(() => {
    const hookResponses = streaming.responses();
    if (Object.keys(hookResponses).length > 0) {
      setComparisonResponses(hookResponses);
    }
  });

  // Sync hook's isStreaming to local state
  createEffect(() => {
    setIsStreaming(streaming.isStreaming());
  });

  // Pane management functions
  function handlePaneModelChange(paneIndex, newModel) {
    const current = selectedModelsForComparison();
    const oldModelId = current[paneIndex]?.id;
    const updated = [...current];
    updated[paneIndex] = newModel;
    setSelectedModelsForComparison(updated);
    // Clear response for old model
    if (oldModelId) {
      removeModelResponse(oldModelId);
    }
  }

  function handleAddPane() {
    const current = selectedModelsForComparison();
    if (current.length >= maxPanes()) return;

    // Find a model not already selected AND with configured provider
    const selectedIds = new Set(current.map(m => m.id));

    for (const model of availableModels()) {
      for (const provider of (model.providers || [])) {
        if (!selectedIds.has(provider.id) && isProviderConfigured(provider.source)) {
          setSelectedModelsForComparison([...current, {
            id: provider.id,
            name: model.name,
            source: provider.source
          }]);
          return;
        }
      }
    }
  }

  function handleRemovePane(paneIndex) {
    const current = selectedModelsForComparison();
    if (current.length <= 1) return; // Keep minimum 1 pane

    const removed = current[paneIndex];
    const updated = current.filter((_, i) => i !== paneIndex);
    setSelectedModelsForComparison(updated);

    // Clear response for removed model
    if (removed?.id) {
      removeModelResponse(removed.id);
    }
  }

  async function loadChats() {
    try {
      const res = await fetch('/api/chats');
      const data = await res.json();
      setChats(data.chats || []);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  }

  async function loadChat(id) {
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentChat({ id: data.id, title: data.title });
        setMessages(data.messages || []);
        // Clear comparison responses when switching chats, but not if streaming
        if (!isStreaming()) {
          clearResponses();
        }
      } else {
        // Chat not found, navigate home
        navigate('/');
        setCurrentChat(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  }

  async function createNewChat() {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      await loadChats();
      navigate(`/chat/${data.id}`);
      // Clear comparison responses for new chat
      clearResponses();
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  async function deleteChat(id) {
    try {
      await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      await loadChats();
      if (currentChat()?.id === id) {
        navigate('/');
        setCurrentChat(null);
        setMessages([]);
        clearResponses();
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }

  async function deleteAllChats() {
    console.log('deleteAllChats called');
    try {
      const chatList = chats();
      console.log('Deleting chats:', chatList.length);
      for (const chat of chatList) {
        console.log('Deleting chat:', chat.id);
        await fetch(`/api/chats/${chat.id}`, { method: 'DELETE' });
      }
      await loadChats();
      navigate('/');
      setCurrentChat(null);
      setMessages([]);
      clearResponses();
      console.log('All chats deleted');
    } catch (err) {
      console.error('Failed to delete all chats:', err);
    }
  }

  // Send message to all selected model panes
  async function sendMessage(content) {
    if (!content.trim() || isStreaming()) return;

    const models = selectedModelsForComparison();
    if (models.length < 1) {
      return;
    }

    // Set streaming state early to prevent loadChat effect from clearing responses
    setIsStreaming(true);

    let chatId = currentChat()?.id;

    // Create a new chat if we don't have one
    if (!chatId) {
      try {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: content.slice(0, 50) })
        });
        const data = await res.json();
        chatId = data.id;
        // Set currentChat directly - avoid navigate() to prevent full redraw
        setCurrentChat({ id: chatId, title: content.slice(0, 50) });
        await loadChats();
        // Update URL without triggering router navigation (prevents redraw)
        window.history.replaceState(null, '', `/chat/${chatId}`);
      } catch (err) {
        console.error('Failed to create chat:', err);
        setIsStreaming(false);
        clearResponses();
        return;
      }
    }

    // Add user message
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const userMsg = await res.json();
      setMessages(prev => [...prev, userMsg]);
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsStreaming(false);
      clearResponses();
      return;
    }

    // Build messages array for API (messages() already includes the user message we just added)
    const apiMessages = messages().map(m => ({
      role: m.role,
      content: m.content
    }));

    // Send to all selected models in parallel
    await sendComparisonMessages(chatId, apiMessages);
  }

  // Send to multiple models in parallel for comparison (with streaming)
  async function sendComparisonMessages(chatId, apiMessages) {
    const models = selectedModelsForComparison();

    // Use the new streaming hook - handles retry, circuit breaker, abort
    const results = await streaming.streamToModels(models, apiMessages);

    // Check if at least one succeeded and save to DB
    const successfulResults = results.filter(r => r.success);

    // Save each model's response as a separate message
    for (const result of successfulResults) {
      const model = models.find(m => m.id === result.modelId);
      try {
        await fetch(`/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `**${model?.name || result.modelId}:**\n${result.content}`
          })
        });
      } catch (err) {
        console.error('Failed to save response for', result.modelId, ':', err);
      }
    }

    // Hook sets isStreaming(false) when complete
    await loadChats();
  }

  function stopStreaming() {
    streaming.abort();
  }

  async function uploadFile(file) {
    let chatId = currentChat()?.id;

    // Create a new chat if we don't have one
    if (!chatId) {
      try {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Document: ${file.name}` })
        });
        const data = await res.json();
        chatId = data.id;
        await loadChats();
        navigate(`/chat/${chatId}`);
        setCurrentChat({ id: chatId, title: `Document: ${file.name}` });
      } catch (err) {
        throw new Error('Failed to create chat for upload');
      }
    }

    // Upload the file
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`/api/chats/${chatId}/upload`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Upload failed');
    }

    // Reload chat to show the uploaded document
    await loadChat(chatId);
    await loadChats();
  }

  function exportChat(format) {
    const chatId = currentChat()?.id;
    if (!chatId) return;

    // Create download link and trigger download
    const url = `/api/chats/${chatId}/export?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentChat()?.title || 'chat'}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  }

  return (
    <>
      {/* Loading Screen */}
      <Show when={!appReady() || loadingFadeOut()}>
        <LoadingScreen
          progress={loadingProgress()}
          status={loadingStatus()}
          fadeOut={loadingFadeOut()}
        />
      </Show>

      <div class="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        {/* Custom title bar with sidebar toggle */}
        <TitleBar
          sidebarCollapsed={sidebarCollapsed()}
          onToggleSidebar={toggleSidebarCollapsed}
        />

        <div class="flex-1 flex min-h-0">
          {/* Sidebar */}
          <Sidebar
            chats={chats()}
            currentChatId={currentChat()?.id}
            onNewChat={createNewChat}
            onSelectChat={(id) => navigate(`/chat/${id}`)}
            onDeleteChat={deleteChat}
            onDeleteAllChats={deleteAllChats}
            onOpenSettings={openSettings}
            collapsed={sidebarCollapsed()}
            width={sidebarWidth()}
          />

          {/* Resize Handle - subtle border that highlights on hover */}
          <Show when={!sidebarCollapsed()}>
            <div
              onMouseDown={handleResizeStart}
              class="w-px bg-gray-200 dark:bg-gray-700 hover:bg-accent cursor-col-resize flex-shrink-0 relative transition-colors"
              style={{ "min-width": "1px" }}
            >
              {/* Invisible wider hit area for easier grabbing */}
              <div class="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            </div>
          </Show>

        {/* Main content */}
        <div class="flex-1 flex flex-col">
          {/* Header */}
          <header class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
            <h1 class="text-sm font-medium text-gray-600 dark:text-gray-300">
              {currentChat()?.title || 'MultiAI'}
            </h1>

            <div class="flex items-center gap-3">
              {/* Export dropdown */}
              <Show when={currentChat()}>
                <div class="relative">
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu())}
                    class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                    title="Export chat"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>

                  <Show when={showExportMenu()}>
                    <div
                      class="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => exportChat('md')}
                        class="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        Markdown (.md)
                      </button>
                      <button
                        onClick={() => exportChat('pdf')}
                        class="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        PDF (.pdf)
                      </button>
                      <button
                        onClick={() => exportChat('docx')}
                        class="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        Word (.docx)
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </header>

          {/* No API Keys Banner - for first-time users */}
          <NoApiKeysBanner
            configuredProviders={configuredProviders()}
            onOpenSettings={openSettings}
          />

          {/* No models warning banner */}
          <Show when={modelsAvailable() === false}>
            <div class="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
              <div class="flex items-start gap-3 max-w-3xl mx-auto">
                <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div class="flex-1">
                  <h3 class="text-sm font-medium text-amber-800 dark:text-amber-200">
                    No Free AI Models Available
                  </h3>
                  <p class="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    All free tier quotas may be exhausted, or the providers are experiencing issues.
                    You can still view your chat history. Check back later.
                  </p>
                </div>
              </div>
            </div>
          </Show>

          {/* Chat area */}
          <ChatView
            messages={messages()}
            selectedModels={selectedModelsForComparison()}
            availableModels={availableModels()}
            onModelChange={handlePaneModelChange}
            onAddPane={handleAddPane}
            onRemovePane={handleRemovePane}
            maxPanes={maxPanes()}
            configuredProviders={configuredProviders()}
            onOpenSettings={openSettings}
          />

          {/* Input */}
          <MessageInput
            onSend={sendMessage}
            onUpload={uploadFile}
            isStreaming={isStreaming()}
            onStop={stopStreaming}
            disabled={!appReady() || modelsAvailable() === false || selectedModelsForComparison().length < 1}
            placeholder={
              !appReady()
                ? 'Loading...'
                : selectedModelsForComparison().length < 1
                ? 'No models available...'
                : 'Type your message...'
            }
          />
        </div>

        {/* Settings Modal */}
        <Show when={showSettings()}>
          <div class="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
              class="absolute inset-0 bg-black/50"
              onClick={() => setShowSettings(false)}
            />

            {/* Modal */}
            <div class="relative bg-gray-50 dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
              {/* Close button */}
              <button
                onClick={() => setShowSettings(false)}
                class="absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <Settings
                focusField={settingsFocusField()}
                onSettingsChanged={async () => {
                  await loadProviderSettings();
                  await checkModels();
                  await autoSelectModels();
                  setShowSettings(false);
                  setSettingsFocusField(null);
                }}
              />
            </div>
          </div>
        </Show>
        </div>
      </div>
    </>
  );
}

export default App;
