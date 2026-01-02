import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import MessageInput from './components/MessageInput';

function App() {
  const params = useParams();
  const navigate = useNavigate();

  const [chats, setChats] = createSignal([]);
  const [currentChat, setCurrentChat] = createSignal(null);
  const [messages, setMessages] = createSignal([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal('');
  const [modelsAvailable, setModelsAvailable] = createSignal(null); // null = loading, true/false = checked
  const [modelCount, setModelCount] = createSignal(0);
  const [showExportMenu, setShowExportMenu] = createSignal(false);

  // Load chats and check models on mount
  onMount(async () => {
    await Promise.all([
      loadChats(),
      checkModels()
    ]);
    if (params.id) {
      await loadChat(params.id);
    }
  });

  // Load chat when route changes
  createEffect(async () => {
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
      }
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }

  async function sendMessage(content) {
    if (!content.trim() || isStreaming()) return;

    // Check if models are available before sending
    if (modelsAvailable() === false) {
      setMessages(prev => [...prev, {
        id: 'error-' + Date.now(),
        role: 'assistant',
        content: 'No free AI models are currently available. Please check back later or configure your API keys.',
        created_at: new Date().toISOString(),
        isError: true
      }]);
      return;
    }

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
        await loadChats();
        navigate(`/chat/${chatId}`);
        setCurrentChat({ id: chatId, title: content.slice(0, 50) });
      } catch (err) {
        console.error('Failed to create chat:', err);
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
      return;
    }

    // Get AI response
    setIsStreaming(true);
    setStreamingContent('');

    try {
      // Build messages array for API
      const apiMessages = messages().map(m => ({
        role: m.role,
        content: m.content
      }));
      apiMessages.push({ role: 'user', content });

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'auto',
          messages: apiMessages,
          stream: false
        })
      });

      const data = await res.json();

      if (data.choices && data.choices[0]) {
        const assistantContent = data.choices[0].message?.content ||
                                 data.choices[0].delta?.content ||
                                 'No response';

        // Save assistant message to database
        await fetch(`/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: assistantContent })
        });

        // Reload messages from server
        await loadChat(chatId);
      } else if (data.error) {
        // Parse specific error types
        let errorMessage = data.error.message;
        let isNoModels = false;

        if (data.error.type === 'service_unavailable' ||
            errorMessage.toLowerCase().includes('no free models') ||
            errorMessage.toLowerCase().includes('no models available')) {
          errorMessage = 'No free AI models are currently available. The providers may be experiencing issues or all free tiers are exhausted. Please try again later.';
          isNoModels = true;
          setModelsAvailable(false);
        } else if (data.error.type === 'configuration_error') {
          errorMessage = 'API key not configured. Please set your OPENROUTER_API_KEY or OPENCODE_ZEN_API_KEY environment variable.';
        } else if (data.error.type === 'upstream_error') {
          errorMessage = `The AI provider returned an error: ${data.error.message}. Please try again.`;
        }

        setMessages(prev => [...prev, {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: errorMessage,
          created_at: new Date().toISOString(),
          isError: true
        }]);
      }
    } catch (err) {
      console.error('Failed to get AI response:', err);
      setMessages(prev => [...prev, {
        id: 'error-' + Date.now(),
        role: 'assistant',
        content: `Connection error: ${err.message}. Please check your internet connection and try again.`,
        created_at: new Date().toISOString(),
        isError: true
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      await loadChats();
    }
  }

  function stopStreaming() {
    setIsStreaming(false);
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
    <div class="h-screen flex bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        chats={chats()}
        currentChatId={currentChat()?.id}
        onNewChat={createNewChat}
        onSelectChat={(id) => navigate(`/chat/${id}`)}
        onDeleteChat={deleteChat}
      />

      {/* Main content */}
      <div class="flex-1 flex flex-col">
        {/* Header */}
        <header class="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
          <h1 class="text-sm font-medium text-gray-600 dark:text-gray-300">
            {currentChat()?.title || 'MultiAI'}
          </h1>

          <div class="flex items-center gap-3">
            {/* Model status indicator */}
            <Show when={modelsAvailable() !== null}>
              <div class={`flex items-center gap-1.5 text-xs ${
                modelsAvailable() ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
              }`}>
                <span class={`w-2 h-2 rounded-full ${
                  modelsAvailable() ? 'bg-green-500' : 'bg-amber-500 animate-pulse'
                }`} />
                {modelsAvailable()
                  ? `${modelCount()} model${modelCount() !== 1 ? 's' : ''} available`
                  : 'No models available'
                }
                <button
                  onClick={checkModels}
                  class="ml-1 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Refresh"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </Show>

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

        {/* Privacy notice for free models */}
        <Show when={modelsAvailable() === true}>
          <div class="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2">
            <p class="text-xs text-amber-800 dark:text-amber-200 text-center font-medium">
              "If you're not paying for it, you're the product."
            </p>
            <p class="text-xs text-amber-700 dark:text-amber-300 text-center mt-1">
              Free models train on your data. Assume all conversations are leaked to the public.
            </p>
          </div>
        </Show>

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
          isStreaming={isStreaming()}
          streamingContent={streamingContent()}
        />

        {/* Input */}
        <MessageInput
          onSend={sendMessage}
          onUpload={uploadFile}
          isStreaming={isStreaming()}
          onStop={stopStreaming}
          disabled={modelsAvailable() === false}
        />
      </div>
    </div>
  );
}

export default App;
