import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  const defaultProps = {
    chats: [],
    currentChatId: null,
    onNewChat: vi.fn(),
    onSelectChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onOpenSettings: vi.fn(),
    collapsed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Expanded state', () => {
    it('shows full New Chat button text when expanded', () => {
      render(() => <Sidebar {...defaultProps} collapsed={false} />);

      expect(screen.getByText('New Chat')).toBeInTheDocument();
    });

    it('shows chat list when expanded', () => {
      const chats = [
        { id: '1', title: 'Test Chat 1', updated_at: new Date().toISOString() },
        { id: '2', title: 'Test Chat 2', updated_at: new Date().toISOString() },
      ];
      render(() => <Sidebar {...defaultProps} chats={chats} collapsed={false} />);

      expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
      expect(screen.getByText('Test Chat 2')).toBeInTheDocument();
    });

    it('shows Settings text when expanded', () => {
      render(() => <Sidebar {...defaultProps} collapsed={false} />);

      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

  });

  describe('Collapsed state', () => {
    it('shows only icon for New Chat when collapsed', () => {
      render(() => <Sidebar {...defaultProps} collapsed={true} />);

      // Should have new chat button but not the text
      expect(screen.queryByText('New Chat')).not.toBeInTheDocument();
      expect(screen.getByTitle('New Chat')).toBeInTheDocument();
    });

    it('hides chat list when collapsed', () => {
      const chats = [
        { id: '1', title: 'Test Chat 1', updated_at: new Date().toISOString() },
      ];
      render(() => <Sidebar {...defaultProps} chats={chats} collapsed={true} />);

      expect(screen.queryByText('Test Chat 1')).not.toBeInTheDocument();
    });

    it('shows only icon for Settings when collapsed', () => {
      render(() => <Sidebar {...defaultProps} collapsed={true} />);

      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
      expect(screen.getByTitle('Settings')).toBeInTheDocument();
    });

  });

  describe('Actions', () => {
    it('calls onNewChat when new chat button clicked', async () => {
      const onNewChat = vi.fn();
      render(() => <Sidebar {...defaultProps} onNewChat={onNewChat} />);

      await fireEvent.click(screen.getByText('New Chat'));

      expect(onNewChat).toHaveBeenCalled();
    });

    it('calls onOpenSettings when settings clicked', async () => {
      const onOpenSettings = vi.fn();
      render(() => <Sidebar {...defaultProps} onOpenSettings={onOpenSettings} />);

      await fireEvent.click(screen.getByText('Settings'));

      expect(onOpenSettings).toHaveBeenCalled();
    });
  });

  describe('Width', () => {
    it('does not have collapsed width class when expanded', () => {
      const { container } = render(() => <Sidebar {...defaultProps} collapsed={false} />);

      const aside = container.querySelector('aside');
      // When expanded, sidebar uses flexbox sizing, no explicit width class
      expect(aside.className).not.toMatch(/w-12/);
    });

    it('has collapsed width class when collapsed', () => {
      const { container } = render(() => <Sidebar {...defaultProps} collapsed={true} />);

      const aside = container.querySelector('aside');
      expect(aside.className).toMatch(/w-12/);
    });
  });
});
