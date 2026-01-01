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

  // Load chats on mount
  onMount(async () => {
    await loadChats();
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

    // Get AI response via streaming
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
          stream: false // For now, non-streaming
        })
      });

      const data = await res.json();

      if (data.choices && data.choices[0]) {
        const assistantContent = data.choices[0].message?.content ||
                                 data.choices[0].delta?.content ||
                                 'No response';

        // Save assistant message to database
        const saveRes = await fetch(`/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: assistantContent })
        });

        // Reload messages from server to get correct message with assistant role
        await loadChat(chatId);
      } else if (data.error) {
        // Show error as assistant message
        setMessages(prev => [...prev, {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: `Error: ${data.error.message}`,
          created_at: new Date().toISOString()
        }]);
      }
    } catch (err) {
      console.error('Failed to get AI response:', err);
      setMessages(prev => [...prev, {
        id: 'error-' + Date.now(),
        role: 'assistant',
        content: `Error: ${err.message}`,
        created_at: new Date().toISOString()
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      await loadChats(); // Refresh chat list for updated timestamp
    }
  }

  function stopStreaming() {
    setIsStreaming(false);
    // TODO: Implement actual stream cancellation
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
        <header class="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
          <h1 class="text-sm font-medium text-gray-600 dark:text-gray-300">
            {currentChat()?.title || 'FreeTier AI'}
          </h1>
        </header>

        {/* Chat area */}
        <ChatView
          messages={messages()}
          isStreaming={isStreaming()}
          streamingContent={streamingContent()}
        />

        {/* Input */}
        <MessageInput
          onSend={sendMessage}
          isStreaming={isStreaming()}
          onStop={stopStreaming}
        />
      </div>
    </div>
  );
}

export default App;
