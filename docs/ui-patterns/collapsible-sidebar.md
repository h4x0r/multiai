# Collapsible Sidebar with Drag Resize

A macOS-native collapsible sidebar pattern with drag-to-resize functionality, implemented in SolidJS with Tauri.

## Overview

- **Toggle button** in title bar (next to macOS traffic lights)
- **Collapsible sidebar** with smooth transitions
- **Drag-to-resize** with subtle visual feedback
- **State persistence** in localStorage

## Layout Structure

```
┌──────────────────────────────────────────────────────┐
│ TitleBar (28px, data-tauri-drag-region)              │
│ ┌─────────┬─────────┬─────────────────────────────┐  │
│ │ Traffic │ Toggle  │     Draggable Area          │  │
│ │ Lights  │ Button  │                             │  │
│ │ (68px)  │         │                             │  │
│ └─────────┴─────────┴─────────────────────────────┘  │
├─────────────┬──────────────────────────────────────┬─┤
│             │                                      │ │
│   Sidebar   │          Main Content               │ │
│  (dynamic   │                                      │ │
│   width)    │                                      │ │
│             │                                      │ │
└─────────────┴──────────────────────────────────────┴─┘
              ↑
         1px resize handle (highlights on hover)
```

## Implementation

### 1. State Management (App.jsx)

```jsx
// Collapsed state - persisted
const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
  localStorage.getItem('sidebarCollapsed') === 'true'
);

// Width state - persisted (only applies when expanded)
const [sidebarWidth, setSidebarWidth] = createSignal(
  parseInt(localStorage.getItem('sidebarWidth')) || 240
);

// Resize drag state
const [isResizing, setIsResizing] = createSignal(false);

function toggleSidebarCollapsed() {
  const newValue = !sidebarCollapsed();
  setSidebarCollapsed(newValue);
  localStorage.setItem('sidebarCollapsed', String(newValue));
}
```

### 2. Resize Handlers

```jsx
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

// Global listeners in onMount
onMount(() => {
  window.addEventListener('mousemove', handleResizeMove);
  window.addEventListener('mouseup', handleResizeEnd);

  onCleanup(() => {
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
  });
});
```

### 3. Toggle Button (TitleBar.jsx)

Positioned after macOS traffic lights spacer:

```jsx
<div class="h-[28px] flex items-center" data-tauri-drag-region>
  {/* Spacer for traffic lights */}
  <div class="w-[68px] flex-shrink-0" data-tauri-drag-region />

  {/* Toggle button */}
  <button
    onClick={props.onToggleSidebar}
    title={props.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
    class="p-1.5 rounded text-gray-500 hover:text-gray-700
           dark:text-gray-400 dark:hover:text-gray-200
           hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor"
         viewBox="0 0 24 24" stroke-width="1.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  </button>

  {/* Draggable area */}
  <div class="flex-1 h-full" data-tauri-drag-region />
</div>
```

### 4. Sidebar Component

Dynamic width via inline styles (more flexible than Tailwind classes):

```jsx
const sidebarStyle = () => {
  if (isCollapsed()) return {};
  return { width: `${props.width || 240}px` };
};

<aside
  class={`${isCollapsed() ? 'w-12 border-r border-gray-200 dark:border-gray-700' : ''}
         bg-gray-100/50 dark:bg-gray-800/50 flex flex-col
         transition-all duration-200 flex-shrink-0`}
  style={sidebarStyle()}
>
```

Collapsed state (48px / `w-12`):
- Icon-only buttons
- Hidden chat list
- Shows border

Expanded state:
- Full content visible
- Dynamic width from props
- No border (resize handle acts as separator)

### 5. Resize Handle

Subtle 1px line with invisible wider hit area:

```jsx
<Show when={!sidebarCollapsed()}>
  <div
    onMouseDown={handleResizeStart}
    class="w-px bg-gray-200 dark:bg-gray-700 hover:bg-accent
           cursor-col-resize flex-shrink-0 relative transition-colors"
    style={{ "min-width": "1px" }}
  >
    {/* Invisible wider hit area for easier grabbing */}
    <div class="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
  </div>
</Show>
```

Key design decisions:
- **1px visible line** - matches standard border styling
- **Highlights on hover** - accent color indicates interactivity
- **Invisible 16px hit area** - easy to grab without visual bulk
- **Only shown when expanded** - collapsed sidebar uses standard border

### 6. Tauri Configuration

```json
{
  "app": {
    "windows": [{
      "decorations": false,
      "transparent": true,
      "titleBarStyle": "overlay"
    }]
  }
}
```

## Constraints

| Property | Value |
|----------|-------|
| Min width | 180px |
| Max width | 400px |
| Collapsed width | 48px (`w-12`) |
| Default width | 240px |

## Persistence

Both states saved to localStorage:
- `sidebarCollapsed`: `"true"` or `"false"`
- `sidebarWidth`: number (pixels)
