import { For, Show, createSignal } from 'solid-js';

function Sidebar(props) {
  const [hoveredId, setHoveredId] = createSignal(null);

  // Group chats by date
  function groupByDate(chats) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = {
      today: [],
      yesterday: [],
      older: []
    };

    chats.forEach(chat => {
      const date = new Date(chat.updated_at);
      const chatDate = date.toDateString();

      if (chatDate === today.toDateString()) {
        groups.today.push(chat);
      } else if (chatDate === yesterday.toDateString()) {
        groups.yesterday.push(chat);
      } else {
        groups.older.push(chat);
      }
    });

    return groups;
  }

  const groups = () => groupByDate(props.chats);

  return (
    <aside class="w-60 border-r border-gray-200 dark:border-gray-700 bg-gray-100/50 dark:bg-gray-800/50 flex flex-col">
      {/* New Chat Button */}
      <div class="p-3">
        <button
          onClick={props.onNewChat}
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Chat List */}
      <div class="flex-1 overflow-y-auto px-2">
        <Show when={groups().today.length > 0}>
          <div class="mb-2">
            <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Today</h3>
            <For each={groups().today}>
              {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} />}
            </For>
          </div>
        </Show>

        <Show when={groups().yesterday.length > 0}>
          <div class="mb-2">
            <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Yesterday</h3>
            <For each={groups().yesterday}>
              {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} />}
            </For>
          </div>
        </Show>

        <Show when={groups().older.length > 0}>
          <div class="mb-2">
            <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Older</h3>
            <For each={groups().older}>
              {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} />}
            </For>
          </div>
        </Show>

        <Show when={props.chats.length === 0}>
          <p class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No chats yet.<br />Start a new conversation!
          </p>
        </Show>
      </div>

      {/* Footer */}
      <div class="p-3 border-t border-gray-200 dark:border-gray-700">
        <div class="text-xs text-gray-500 dark:text-gray-400 text-center">
          FreeTier v0.1.0
        </div>
      </div>
    </aside>
  );
}

function ChatItem(props) {
  const isActive = () => props.currentChatId === props.chat.id;
  const isHovered = () => props.hoveredId() === props.chat.id;

  return (
    <div
      class={`group relative flex items-center rounded-lg cursor-pointer transition-colors ${
        isActive()
          ? 'bg-gray-200 dark:bg-gray-700'
          : 'hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
      }`}
      onMouseEnter={() => props.setHoveredId(props.chat.id)}
      onMouseLeave={() => props.setHoveredId(null)}
    >
      <button
        onClick={() => props.onSelectChat(props.chat.id)}
        class="flex-1 text-left px-3 py-2 text-sm truncate"
      >
        {props.chat.title || 'New Chat'}
      </button>

      <Show when={isHovered()}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onDeleteChat(props.chat.id);
          }}
          class="absolute right-2 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500"
          title="Delete chat"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </Show>
    </div>
  );
}

export default Sidebar;
