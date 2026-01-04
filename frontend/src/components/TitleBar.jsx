import { Show } from 'solid-js';

/**
 * TitleBar - Custom title bar with collapse button next to traffic lights (macOS style)
 *
 * @param {Object} props
 * @param {boolean} props.sidebarCollapsed - Current sidebar collapsed state
 * @param {Function} props.onToggleSidebar - Toggle sidebar callback
 */
function TitleBar(props) {
  return (
    <div
      class="h-[28px] flex items-center"
      data-tauri-drag-region
    >
      {/* Spacer for traffic lights (macOS) */}
      <div class="w-[68px] flex-shrink-0" data-tauri-drag-region />

      {/* Sidebar toggle button - exactly like Claude Desktop */}
      <button
        onClick={props.onToggleSidebar}
        title={props.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        class="p-1.5 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
      >
        {/* Claude Desktop sidebar icon - single rectangle with vertical divider */}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>

      {/* Draggable title area - takes remaining space */}
      <div class="flex-1 h-full" data-tauri-drag-region />
    </div>
  );
}

export default TitleBar;
