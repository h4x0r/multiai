import { For, Show, createSignal, onMount, createEffect } from 'solid-js';

function ChatView(props) {
  let messagesEndRef;

  // Auto-scroll to bottom on new messages
  createEffect(() => {
    // Access messages to create dependency
    const _ = props.messages.length;
    const __ = props.streamingContent;
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' });
    }
  });

  return (
    <div class="flex-1 overflow-y-auto px-4 py-6">
      <div class="max-w-3xl mx-auto space-y-4">
        <Show when={props.messages.length === 0 && !props.isStreaming}>
          <WelcomeMessage />
        </Show>

        <For each={props.messages}>
          {(message) => <Message message={message} />}
        </For>

        <Show when={props.isStreaming}>
          <StreamingMessage content={props.streamingContent} />
        </Show>

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <div class="w-16 h-16 mb-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
        Welcome to FreeTier AI
      </h2>
      <p class="text-gray-500 dark:text-gray-400 max-w-md">
        Chat with free AI models. Ask questions, get help with code, or just have a conversation.
      </p>
    </div>
  );
}

function Message(props) {
  const [showActions, setShowActions] = createSignal(false);
  const isUser = () => props.message.role === 'user';

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(props.message.content);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  return (
    <div
      class={`group flex ${isUser() ? 'justify-end' : 'justify-start'} message-enter`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div class="relative max-w-[80%]">
        <div
          class={`px-4 py-3 rounded-2xl ${
            isUser()
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md'
          }`}
        >
          <div class="text-sm whitespace-pre-wrap break-words">
            {props.message.content}
          </div>
        </div>

        {/* Actions (hover only) */}
        <Show when={showActions()}>
          <div class={`absolute top-0 ${isUser() ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} flex items-center gap-1`}>
            <button
              onClick={copyToClipboard}
              class="p-1.5 rounded-lg bg-white dark:bg-gray-700 shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
              title="Copy"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function StreamingMessage(props) {
  return (
    <div class="flex justify-start message-enter">
      <div class="max-w-[80%]">
        <div class="px-4 py-3 rounded-2xl rounded-bl-md bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          <div class="text-sm whitespace-pre-wrap break-words">
            {props.content || ''}
            <span class="cursor-blink">|</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatView;
