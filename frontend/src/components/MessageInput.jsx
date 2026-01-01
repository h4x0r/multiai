import { createSignal, Show } from 'solid-js';

function MessageInput(props) {
  const [content, setContent] = createSignal('');
  let textareaRef;

  function handleSubmit(e) {
    e?.preventDefault();
    const text = content().trim();
    if (text && !props.isStreaming) {
      props.onSend(text);
      setContent('');
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    }
  }

  function handleKeyDown(e) {
    // Cmd/Ctrl + Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e) {
    setContent(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }

  return (
    <div class="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div class="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} class="relative">
          <div class="flex items-end gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
            {/* Attachment button */}
            <button
              type="button"
              class="p-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Attach file"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={content()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Message... (⌘↩ to send)"
              rows="1"
              class="flex-1 py-3 pr-3 bg-transparent resize-none outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 text-sm max-h-48"
              disabled={props.isStreaming}
            />

            {/* Send/Stop button */}
            <Show
              when={!props.isStreaming}
              fallback={
                <button
                  type="button"
                  onClick={props.onStop}
                  class="m-2 p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                  title="Stop"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
              }
            >
              <button
                type="submit"
                disabled={!content().trim()}
                class={`m-2 p-2 rounded-lg transition-colors ${
                  content().trim()
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
                title="Send (⌘↩)"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            </Show>
          </div>

          {/* Keyboard hint */}
          <div class="mt-2 text-center">
            <span class="text-xs text-gray-400">
              Press <kbd class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono">⌘</kbd> + <kbd class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono">↩</kbd> to send
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MessageInput;
