import { For, Show } from 'solid-js';
import ComparisonPane from './ComparisonPane';
import { comparisonResponses } from '../stores/comparisonStore';

/**
 * ChatView - Unified pane-based chat view
 * Each pane shows the full conversation for its model
 *
 * @param {Object} props
 * @param {Array} props.messages - Array of message objects (user messages)
 * @param {Array} props.selectedModels - Array of selected models (1-3)
 * @param {Array} props.availableModels - All available models for pane dropdowns
 * @param {Function} props.onModelChange - (index, model) => void
 * @param {Function} props.onAddPane - () => void
 * @param {Function} props.onRemovePane - (index) => void
 * @param {number} props.maxPanes - Maximum panes allowed (responsive)
 * @param {Object} props.configuredProviders - { openCodeZen: bool, openRouter: bool }
 */
function ChatView(props) {
  function hasActiveResponses() {
    return Object.keys(comparisonResponses()).length > 0;
  }

  // Get only user messages for display in panes
  const userMessages = () => props.messages.filter(m => m.role === 'user');

  return (
    <div class="chat-view-container flex-1 flex flex-col overflow-hidden">
      {/* Unified pane view - each pane shows full conversation */}
      <PanesView
        selectedModels={props.selectedModels}
        availableModels={props.availableModels}
        onModelChange={props.onModelChange}
        onAddPane={props.onAddPane}
        onRemovePane={props.onRemovePane}
        maxPanes={props.maxPanes}
        configuredProviders={props.configuredProviders}
        userMessages={userMessages()}
        hasMessages={props.messages.length > 0 || hasActiveResponses()}
        onOpenSettings={props.onOpenSettings}
      />
    </div>
  );
}

/**
 * PanesView - 1-3 panes with inline model selection
 */
function PanesView(props) {
  const paneCount = () => props.selectedModels?.length || 0;
  const maxPanes = () => props.maxPanes || 3;
  const canAddPane = () => paneCount() < maxPanes();
  const canRemovePane = () => paneCount() > 1; // Allow removing down to 1 pane

  // Color dots for each model
  const colorDots = ['bg-blue-500', 'bg-purple-500', 'bg-green-500'];

  return (
    <div class="flex-1 flex message-enter min-h-0">
      <For each={props.selectedModels}>
        {(model, index) => (
          <>
            {/* Pane */}
            <div class="flex-1 min-w-0 flex flex-col min-h-0">
              <ComparisonPane
                model={model}
                colorDot={colorDots[index() % colorDots.length]}
                availableModels={props.availableModels}
                configuredProviders={props.configuredProviders}
                selectedModelIds={props.selectedModels?.map(m => m.id) || []}
                onModelChange={(newModel) => props.onModelChange?.(index(), newModel)}
                onRemove={() => props.onRemovePane?.(index())}
                canRemove={canRemovePane()}
                userMessages={props.userMessages}
                hasMessages={props.hasMessages}
                onOpenSettings={props.onOpenSettings}
              />
            </div>
            {/* Vertical divider - not on last pane */}
            <Show when={index() < paneCount() - 1}>
              <div class="w-px bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
            </Show>
          </>
        )}
      </For>

      {/* Add pane button */}
      <Show when={canAddPane()}>
        <div class="w-px bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
        <button
          onClick={props.onAddPane}
          class="w-12 flex-shrink-0 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          title="Add comparison pane"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span class="text-xs">Add</span>
        </button>
      </Show>
    </div>
  );
}

export default ChatView;
