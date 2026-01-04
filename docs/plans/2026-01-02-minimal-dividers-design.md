# Minimal Dividers UI Design

**Date:** 2026-01-02
**Status:** Completed

## Problem

The current 3-pane comparison view uses bordered cards with headers and footers, wasting screen real estate. Each pane loses ~100px vertically to chrome and 4px+ horizontally to borders and gaps.

## Solution

Replace bordered cards with minimal vertical dividers. Remove all unnecessary chrome to maximize content area.

## Design

### Comparison View Layout

**Before:**
```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ ● Model 1       │  │ ● Model 2       │  │ ● Model 3       │
│ via Zen    ✓    │  │ via OR     ✓    │  │ via Zen    ✓    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│  Response...    │  │  Response...    │  │  Response...    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ 📋 Copy         │  │ 📋 Copy         │  │ 📋 Copy         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**After:**
```
● Model 1          │ ● Model 2          │ ● Model 3
                   │                    │
Response text      │ Response text      │ Response text
flows naturally    │ flows naturally    │ flows naturally
                   │                    │
           [copy]  │            [copy]  │            [copy]
```

**Changes:**
- Remove all borders and background colors
- 1px vertical divider lines only (between panes, not on edges)
- Inline model indicator: colored dot + model name (single line)
- Copy button appears on hover, bottom-right aligned
- Full-width content with minimal padding

### Collapsible Sidebar

**Expanded (240px):**
- New Chat button
- Chat list grouped by date
- Settings button
- Version info
- Collapse button at bottom

**Collapsed (48px):**
- New Chat icon (+)
- Settings icon (⚙)
- Expand button (▶)
- No chat list (too narrow)
- Tooltips on hover

**Behavior:**
- Toggle via button or keyboard shortcut
- State persists in localStorage
- Smooth transition animation

### Responsive Breakpoints

**Desktop (>1024px):**
- 3 equal-width panes with vertical dividers
- Sidebar expanded by default

**Tablet (768px - 1024px):**
- 3 panes still visible but narrower
- Sidebar auto-collapsed to icons
- Sidebar overlays content when expanded

**Mobile (<768px):**
- Tabbed view instead of columns
- Tabs: [Model 1] [Model 2] [Model 3]
- One response visible at a time
- Swipe to switch models
- Sidebar becomes hamburger menu

### Pane Width Calculation

```
Available = WindowWidth - SidebarWidth - (DividerCount × 1px)
PaneWidth = Available / PaneCount

Example (1200px window, expanded sidebar):
Available = 1200 - 240 - 2 = 958px
PaneWidth = 319px each
```

## Implementation

### Files to Modify

1. `frontend/src/components/ChatView.jsx` - Rewrite ComparisonView
2. `frontend/src/components/Sidebar.jsx` - Add collapse functionality
3. `frontend/src/App.jsx` - Manage sidebar collapsed state
4. `frontend/src/index.css` - Add divider and transition styles

### Test Plan (TDD)

1. **ComparisonPane tests**
   - Renders model name with colored dot
   - Shows "Ready" state when no response
   - Shows loading spinner during fetch
   - Shows response content when available
   - Copy button appears on hover only

2. **ComparisonView tests**
   - Renders correct number of panes
   - Panes have equal widths
   - Vertical dividers between panes only
   - No dividers on outer edges

3. **Sidebar tests**
   - Toggle between expanded/collapsed states
   - Collapsed shows only icons
   - Expanded shows full content
   - State persists in localStorage
   - Tooltips show on hover when collapsed

4. **Responsive tests**
   - Desktop: 3 columns visible
   - Tablet: sidebar auto-collapses
   - Mobile: switches to tabbed view
