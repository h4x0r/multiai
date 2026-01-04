import { For, Show, createSignal, onCleanup } from 'solid-js';

function Sidebar(props) {
  const [hoveredId, setHoveredId] = createSignal(null);
  const [contextMenu, setContextMenu] = createSignal(null); // { x, y, chatId }
  const [showConfirm, setShowConfirm] = createSignal(false);

  // Close context menu on click outside
  const handleClickOutside = () => setContextMenu(null);

  // Close on escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setContextMenu(null);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    });
  }

  const isCollapsed = () => props.collapsed;

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

  // Use dynamic width when not collapsed
  const sidebarStyle = () => {
    if (isCollapsed()) return {};
    return { width: `${props.width || 240}px` };
  };

  return (
    <aside
      class={`${isCollapsed() ? 'w-12 border-r border-gray-200 dark:border-gray-700' : ''} bg-gray-100/50 dark:bg-gray-800/50 flex flex-col transition-all duration-200 flex-shrink-0`}
      style={sidebarStyle()}
    >
      {/* Header with New Chat */}
      <div class={`${isCollapsed() ? 'p-2' : 'p-3'}`}>
        {/* New Chat Button */}
        <button
          onClick={props.onNewChat}
          title="New Chat"
          class={`flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors ${
            isCollapsed() ? 'w-8 h-8 p-0 mx-auto' : 'w-full px-3 py-2'
          }`}
        >
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <Show when={!isCollapsed()}>
            New Chat
          </Show>
        </button>
      </div>

      {/* Chat List - Hidden when collapsed */}
      <Show when={!isCollapsed()}>
        <div class="flex-1 overflow-y-auto px-2">
          <Show when={groups().today.length > 0}>
            <div class="mb-2">
              <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">Today</h3>
              <For each={groups().today}>
                {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} setContextMenu={setContextMenu} />}
              </For>
            </div>
          </Show>

          <Show when={groups().yesterday.length > 0}>
            <div class="mb-2">
              <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">Yesterday</h3>
              <For each={groups().yesterday}>
                {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} setContextMenu={setContextMenu} />}
              </For>
            </div>
          </Show>

          <Show when={groups().older.length > 0}>
            <div class="mb-2">
              <h3 class="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">Older</h3>
              <For each={groups().older}>
                {chat => <ChatItem chat={chat} {...props} hoveredId={hoveredId} setHoveredId={setHoveredId} setContextMenu={setContextMenu} />}
              </For>
            </div>
          </Show>

          <Show when={props.chats.length === 0}>
            <p class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No chats yet.<br />Start a new conversation!
            </p>
          </Show>
        </div>
      </Show>

      {/* Spacer when collapsed */}
      <Show when={isCollapsed()}>
        <div class="flex-1" />
      </Show>

      {/* Footer with Settings and Collapse Toggle */}
      <div class={`border-t border-gray-200 dark:border-gray-700 ${isCollapsed() ? 'p-2' : 'p-3'}`}>
        {/* Settings Button */}
        <button
          onClick={props.onOpenSettings}
          title="Settings"
          class={`flex items-center justify-center gap-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
            isCollapsed() ? 'w-8 h-8 p-0' : 'w-full px-3 py-2'
          }`}
        >
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <Show when={!isCollapsed()}>
            Settings
          </Show>
        </button>

      </div>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <div
          class="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]"
          style={{ left: `${contextMenu().x}px`, top: `${contextMenu().y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              props.onDeleteChat(contextMenu().chatId);
              setContextMenu(null);
            }}
            class="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
          <div class="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(null);
              setShowConfirm(true);
            }}
            class="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete All
          </button>
        </div>
      </Show>

      {/* Confirm Delete All Dialog */}
      <Show when={showConfirm()}>
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowConfirm(false)}>
          <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 mx-4 max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Delete All Chats</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Are you sure? This cannot be undone.</p>
            <div class="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                class="px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  props.onDeleteAllChats?.();
                }}
                class="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      </Show>
    </aside>
  );
}

function ChatItem(props) {
  const isActive = () => props.currentChatId === props.chat.id;
  const isHovered = () => props.hoveredId() === props.chat.id;

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    props.setContextMenu({ x: e.clientX, y: e.clientY, chatId: props.chat.id });
  };

  return (
    <div
      class={`group relative flex items-center rounded-lg cursor-pointer transition-colors ${
        isActive()
          ? 'bg-gray-200 dark:bg-gray-700'
          : 'hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
      }`}
      onMouseEnter={() => props.setHoveredId(props.chat.id)}
      onMouseLeave={() => props.setHoveredId(null)}
      onContextMenu={handleContextMenu}
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
