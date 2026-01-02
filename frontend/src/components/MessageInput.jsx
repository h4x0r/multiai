import { createSignal, Show } from 'solid-js';

function MessageInput(props) {
  const [content, setContent] = createSignal('');
  const [isUploading, setIsUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal(null);
  let textareaRef;
  let fileInputRef;

  const isDisabled = () => props.isStreaming || props.disabled || isUploading();

  function handleSubmit(e) {
    e?.preventDefault();
    const text = content().trim();
    if (text && !isDisabled()) {
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

  function handleAttachClick() {
    if (fileInputRef && !isDisabled()) {
      fileInputRef.click();
    }
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['.pdf', '.docx', '.txt', '.md'];
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(extension)) {
      setUploadError(`Unsupported file type. Allowed: ${allowedTypes.join(', ')}`);
      setTimeout(() => setUploadError(null), 5000);
      e.target.value = '';
      return;
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError('File too large. Maximum size is 10MB.');
      setTimeout(() => setUploadError(null), 5000);
      e.target.value = '';
      return;
    }

    if (props.onUpload) {
      setIsUploading(true);
      setUploadError(null);
      try {
        await props.onUpload(file);
      } catch (err) {
        setUploadError(err.message || 'Upload failed');
        setTimeout(() => setUploadError(null), 5000);
      } finally {
        setIsUploading(false);
        e.target.value = '';
      }
    }
  }

  return (
    <div class={`border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 ${
      props.disabled ? 'opacity-60' : ''
    }`}>
      <div class="max-w-3xl mx-auto">
        {/* Upload error message */}
        <Show when={uploadError()}>
          <div class="mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p class="text-sm text-red-600 dark:text-red-400">{uploadError()}</p>
          </div>
        </Show>

        <form onSubmit={handleSubmit} class="relative">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={handleFileSelect}
            class="hidden"
          />

          <div class={`flex items-end gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl border ${
            props.disabled
              ? 'border-gray-300 dark:border-gray-600'
              : 'border-gray-200 dark:border-gray-700 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent'
          }`}>
            {/* Attachment button */}
            <button
              type="button"
              onClick={handleAttachClick}
              class={`p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isUploading()
                  ? 'text-accent animate-pulse'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
              title={isUploading() ? "Uploading..." : "Attach file (PDF, DOCX, TXT)"}
              disabled={isDisabled()}
            >
              <Show
                when={!isUploading()}
                fallback={
                  <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                }
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </Show>
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={content()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={
                props.disabled
                  ? "No models available..."
                  : isUploading()
                  ? "Uploading document..."
                  : "Message... (⌘↩ to send)"
              }
              rows="1"
              class="flex-1 py-3 pr-3 bg-transparent resize-none outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 text-sm max-h-48 disabled:cursor-not-allowed"
              disabled={isDisabled()}
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
                disabled={!content().trim() || isDisabled()}
                class={`m-2 p-2 rounded-lg transition-colors ${
                  content().trim() && !isDisabled()
                    ? 'bg-accent hover:bg-accent-hover text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
                title={props.disabled ? "No models available" : "Send (⌘↩)"}
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            </Show>
          </div>

          {/* Keyboard hint or disabled message */}
          <div class="mt-2 text-center">
            <Show
              when={!props.disabled}
              fallback={
                <span class="text-xs text-amber-600 dark:text-amber-400">
                  Messaging disabled - no AI models available
                </span>
              }
            >
              <Show
                when={!isUploading()}
                fallback={
                  <span class="text-xs text-accent">
                    Processing document...
                  </span>
                }
              >
                <span class="text-xs text-gray-400">
                  Press <kbd class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono">⌘</kbd> + <kbd class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-mono">↩</kbd> to send
                </span>
              </Show>
            </Show>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MessageInput;
