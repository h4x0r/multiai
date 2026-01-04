import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import ComparisonPane from './ComparisonPane';
import * as store from '../stores/comparisonStore';

// Mock the comparisonStore
vi.mock('../stores/comparisonStore', () => {
  const { createSignal } = require('solid-js');
  const [responses, setResponses] = createSignal({});
  return {
    comparisonResponses: responses,
    setComparisonResponses: setResponses,
    clearResponses: () => setResponses({}),
    setModelResponse: (modelId, response) => {
      setResponses(prev => ({ ...prev, [modelId]: response }));
    },
  };
});

describe('ComparisonPane', () => {
  const defaultProps = {
    model: { id: 'test-model', name: 'GPT-4', source: 'openrouter' },
    colorDot: 'bg-blue-500',
    availableModels: [],
    hasMessages: false,
    userMessages: [],
  };

  beforeEach(() => {
    // Reset store before each test
    store.clearResponses();
  });

  describe('Model indicator', () => {
    it('renders model name with colored dot', () => {
      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.getByText('GPT-4')).toBeInTheDocument();
      // Dot should be present with the color class
      const dot = document.querySelector('.bg-blue-500');
      expect(dot).toBeInTheDocument();
    });

    it('shows model name inline (not in separate header)', () => {
      render(() => <ComparisonPane {...defaultProps} />);

      const modelName = screen.getByText('GPT-4');
      // Should not be inside a header element
      expect(modelName.closest('header')).toBeNull();
    });
  });

  describe('Empty state', () => {
    it('shows "Start typing to compare responses" when no messages', () => {
      render(() => <ComparisonPane {...defaultProps} userMessages={[]} hasMessages={false} />);

      expect(screen.getByText('Start typing to compare responses')).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner when loading', () => {
      // Set store to loading state for this model
      store.setModelResponse('test-model', { loading: true, content: '' });

      render(() => <ComparisonPane {...defaultProps} />);

      // Should have a spinning element
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows "Thinking..." text when loading', () => {
      store.setModelResponse('test-model', { loading: true, content: '' });

      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });

    it('shows content while still loading (streaming)', () => {
      store.setModelResponse('test-model', { loading: true, content: 'Partial response...' });

      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.getByText(/Partial response/)).toBeInTheDocument();
    });
  });

  describe('Response content', () => {
    it('displays response content when available', () => {
      store.setModelResponse('test-model', { content: 'This is the AI response.' });

      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.getByText('This is the AI response.')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('shows error message when response has error', () => {
      store.setModelResponse('test-model', { error: 'API rate limit exceeded' });

      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.getByText(/API rate limit exceeded/)).toBeInTheDocument();
    });
  });

  describe('Copy button', () => {
    it('does not show copy button when no content', () => {
      render(() => <ComparisonPane {...defaultProps} />);

      expect(screen.queryByTitle('Copy')).not.toBeInTheDocument();
    });

    it('shows copy button on hover when content is available', async () => {
      store.setModelResponse('test-model', { content: 'Some content', loading: false });

      const { container } = render(() => <ComparisonPane {...defaultProps} />);

      // Trigger mouseEnter to show copy button
      const pane = container.firstChild;
      await fireEvent.mouseEnter(pane);

      expect(screen.getByTitle('Copy')).toBeInTheDocument();
    });

    it('copies content to clipboard when clicked', async () => {
      const mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      Object.assign(navigator, { clipboard: mockClipboard });

      store.setModelResponse('test-model', { content: 'Copy this text', loading: false });

      const { container } = render(() => <ComparisonPane {...defaultProps} />);

      // Trigger mouseEnter to show copy button
      const pane = container.firstChild;
      await fireEvent.mouseEnter(pane);

      const copyBtn = screen.getByTitle('Copy');
      await fireEvent.click(copyBtn);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('Copy this text');
    });
  });

  describe('No borders', () => {
    it('does not have border classes on root', () => {
      const { container } = render(() => <ComparisonPane {...defaultProps} />);

      // Should not have any border-* number classes on the root element
      const root = container.firstChild;
      expect(root.className).not.toMatch(/border-\d/);
      expect(root.className).not.toMatch(/rounded-xl/);
    });
  });

  describe('User messages', () => {
    it('renders user messages', () => {
      const userMessages = [{ content: 'Hello, how are you?' }];

      render(() => <ComparisonPane {...defaultProps} userMessages={userMessages} />);

      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
    });
  });
});
